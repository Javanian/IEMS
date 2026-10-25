import assert from 'node:assert/strict';
import { startOwned, command, makeFixture, makeConsumer, getCompany, reserveCompanyBody, reserveDirectLot, executionRoot } from '../../company-stock-use/qa/support.mjs';

export { startOwned, command, makeFixture, makeConsumer, getCompany, reserveCompanyBody, executionRoot };

export async function allSnapshot(h) {
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export const tracePath = (receiptId, unitId) => `/company-stock/receipts/${receiptId}/units/${unitId}/trace`;

export async function readTrace(h, receiptId, unitId, { status = 200, code, cookie = h.alpha } = {}) {
  const before = await allSnapshot(h), response = await h.req(tracePath(receiptId, unitId), undefined, cookie);
  assert.equal(response.status, status, JSON.stringify(response));
  if (code) assert.equal(response.error.code, code);
  assert.deepEqual(await allSnapshot(h), before, 'GET trace changed durable state, including authority fences or authentication records');
  if (status !== 200) assert.equal(Object.hasOwn(response, 'data'), false);
  return status === 200 ? response.data : response;
}

export async function replaceWhile(h, collection, row, replacement, effect) {
  await h.db.collection(collection).replaceOne({ _id: row._id }, replacement);
  try { return await effect(); }
  finally { await h.db.collection(collection).replaceOne({ _id: row._id }, row); }
}

export async function traceFixture(h, { onPhase = async () => {}, qcDisposition = 'ACCEPTED' } = {}) {
  assert.ok(['ACCEPTED', 'REJECTED'].includes(qcDisposition));
  const base = await makeFixture(h), sourceId = base.producer.companyStock._id;
  const rootUnits = base.produced.slice(0, 2).map(serial => base.producer.companyStock.units.find(unit => unit.serial === serial));
  assert.equal(rootUnits.length, 2); assert.ok(rootUnits.every(Boolean));
  const state = { ...base, sourceId, rootUnits, job: null, phase: 'AVAILABLE' };
  const emit = async phase => { state.phase = phase; await onPhase({ ...state }); };
  const path = () => `${executionRoot}/${state.job._id}`;
  const change = values => command({ expectedVersion: state.job.version, ...values });
  await emit('AVAILABLE');
  state.job = await makeConsumer(h, base);
  let stock = await getCompany(h, sourceId);
  state.job = await h.ok(`${path()}/reservations`, reserveCompanyBody(state.job, stock, stock.units, base.componentItem._id));
  await emit('RESERVED');
  const abandoned = state.job.reservations.find(row => row.sourceKind === 'COMPANY_OUTPUT' && row.status === 'RESERVED');
  state.abandonedReservationId = abandoned._id;
  stock = await getCompany(h, sourceId);
  state.job = await h.ok(`${path()}/reservations/${abandoned._id}/release`, change({ expectedStockVersion: stock.version }));
  await emit('ABANDONED');
  stock = await getCompany(h, sourceId);
  state.job = await h.ok(`${path()}/reservations`, reserveCompanyBody(state.job, stock, stock.units, base.componentItem._id));
  state.activeReservationId = state.job.reservations.find(row => row.sourceKind === 'COMPANY_OUTPUT' && row.status === 'RESERVED')._id;
  state.job = await reserveDirectLot(h, base, state.job);
  state.job = await h.ok(`${path()}/release`, change());
  state.job = await h.ok(`${path()}/issue`, change());
  await emit('ISSUED');
  state.job = await h.ok(`${path()}/records`, change({ operationIndex: 0, inputQuantity: '2', goodQuantity: '1', scrapQuantity: '1', laborMinutes: '1', machineMinutes: '0', evidence: 'Trace fixture actual one-generation input and process scrap' }));
  await emit('CONSUMED_UNATTRIBUTED');
  state.job = await h.ok(`${path()}/records`, change({ operationIndex: 1, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: 'Trace fixture actual output before disposition', outputSerials: [`${base.prefix}_TRACE_LEAF`] }));
  state.output = state.job.outputUnits[0];
  const sources = unit => [{ sourceKind: 'COMPANY_OUTPUT', companyReceiptId: sourceId, quantity: '1', companyUnitIds: [unit._id] }, { sourceKind: 'CATALOG_RECEIPT', receiptId: base.consumerLot._id, quantity: '1.25' }];
  state.job = await h.ok(`${path()}/allocations`, change({ outputUnitId: state.output._id, sources: sources(rootUnits[0]) }));
  await emit('OUTPUT_UNREVIEWED');
  state.job = await h.ok(`${path()}/losses`, change({ sources: sources(rootUnits[1]) }));
  await emit('LOSS_RECORDED');
  state.job = await h.ok(`${path()}/qc`, change({ acceptedSerials: qcDisposition === 'ACCEPTED' ? [state.output.serial] : [], rejectedSerials: qcDisposition === 'REJECTED' ? [state.output.serial] : [], evidence: 'Trace fixture actual final inspection disposition' }));
  await emit(`QC_${qcDisposition}`);
  if (qcDisposition === 'ACCEPTED') {
    state.job = await h.ok(`${path()}/putaway`, change({ locationId: base.location._id, expectedLocationVersion: base.location.version }));
    await emit('STORED');
  }
  return state;
}
