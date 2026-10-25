import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';
import { companyCommand as command } from './support/company-stock-owner-fixture.mjs';
import { companyTraceOwnerFixture } from './support/company-stock-trace-owner-fixture.mjs';
import { companyTraceLimits, enforceCompanyTraceResponseLimit } from '../src/company-stock-trace.mjs';
import { stockHash, stockHashless } from '../src/catalog-stock-use-state.mjs';
import { request as httpRequest } from 'node:http';

test('trace envelope budget measures UTF8 bytes and includes the data wrapper', () => {
  const overhead = Buffer.byteLength(JSON.stringify({ data: { text: '' } }), 'utf8');
  const exact = { text: 'x'.repeat(companyTraceLimits.responseBytes - overhead) };
  assert.equal(enforceCompanyTraceResponseLimit(exact), exact);
  assert.throws(() => enforceCompanyTraceResponseLimit({ text: `${exact.text}x` }), { code: 'TRACE_LIMIT_EXCEEDED' });
  const multibyte = { text: 'é'.repeat(Math.floor((companyTraceLimits.responseBytes - overhead) / 2) + 1) };
  assert.ok(JSON.stringify({ data: multibyte }).length < companyTraceLimits.responseBytes);
  assert.throws(() => enforceCompanyTraceResponseLimit(multibyte), { code: 'TRACE_LIMIT_EXCEEDED' });
});

test('company unit trace validates exact upstream evidence and bounded reverse use without writes', async t => {
  const h = await startOwned(t), f = await companyTraceOwnerFixture(h), { db, ok } = h;
  const source = await f.company(), selected = source.units.find(unit => unit.serial === f.produced[0]), lossUnit = source.units.find(unit => unit.serial === f.produced[1]);
  const path = unitId => `${f.companyPath}/units/${unitId}/trace`;
  const snapshot = async () => {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await db.collection(name).find().sort({ _id: 1 }).toArray()])));
  };
  const trace = async unit => { const before = await snapshot(), result = await ok(path(unit._id)); assert.deepEqual(await snapshot(), before, 'GET must not change any collection including authorization fences'); return result; };
  let consumer;
  await t.test('exact chosen producer output serial subset differs from the conservative batch hold set', async () => {
    const result = await trace(selected);
    assert.equal(result.schema, 'COMPANY_UNIT_TRACE_V1'); assert.equal(result.companyUnitId, selected._id); assert.equal(result.outputUnitId, selected.outputUnitId);
    assert.deepEqual(result.ancestry.purchasedSources.find(row => row.receiptId === f.serialReceipt._id).serials, f.incomingSerials.slice(0, 2));
    assert.equal(result.ancestry.purchasedSources.find(row => row.receiptId === f.rawReceipt._id).quantity, '1');
    assert.equal(result.ancestry.purchasedSources.some(row => row.receiptId === f.abandoned._id), false);
    assert.deepEqual(result.holdPolicy.receiptIds, [f.rawReceipt._id, f.serialReceipt._id].sort());
    assert.equal(result.holdPolicy.receiptIds.includes(f.abandoned._id), false);
    assert.deepEqual(result.uses, { reserved: [], issued: [], consumedUnattributed: [], outputs: [], losses: [], abandoned: [] });
    assert.equal(result.completeness.counts.executions, 1);
    const before = await snapshot(); assert.equal((await h.req(path(selected._id), undefined, h.beta)).status, 404); assert.deepEqual(await snapshot(), before);
    assert.equal((await h.req(path(randomUUID()), undefined, h.alpha)).status, 404);
    assert.equal((await h.req(`${f.companyPath}/units/not-a-uuid/trace`, undefined, h.alpha)).status, 400);
    const wrongReceipt = await db.collection('internalCompanyStockUnits').findOne({ companyReceiptId: { $ne: source._id } });
    assert.equal((await h.req(path(wrongReceipt._id), undefined, h.alpha)).status, 404);
    const url = (await h.raw(path(selected._id))).url, body = JSON.stringify({ actor: randomUUID() }), beforeBody = await snapshot();
    const withBody = await new Promise((resolve, reject) => {
      const req = httpRequest(url, { method: 'GET', headers: { origin: 'http://localhost:4173', cookie: h.alpha, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      }); req.on('error', reject); req.end(body);
    });
    assert.equal(withBody.status, 400); assert.equal(withBody.error.code, 'INVALID_FIELDS'); assert.deepEqual(await snapshot(), beforeBody);
    const restore = await h.setRoles(h.seeded[0], ['internalExecutionReader']);
    try { assert.equal((await h.req(path(selected._id), undefined, h.alpha)).status, 403); } finally { await restore(); }
  });
  await t.test('reserve abandon and re-reserve remain visible without invented physical ancestry', async () => {
    consumer = await f.consumer(); consumer = await f.reserveCompany(consumer, [selected._id]);
    let result = await trace(selected); assert.equal(result.uses.reserved.length, 1); assert.equal(result.uses.reserved[0].reservationStatus, 'RESERVED'); assert.equal(result.uses.outputs.length, 0);
    let current = await f.company(); consumer = await f.mutate(consumer, `reservations/${consumer.reservations[0]._id}/release`, { expectedStockVersion: current.version });
    result = await trace(selected); assert.equal(result.uses.reserved.length, 0); assert.equal(result.uses.abandoned.length, 1); assert.equal(result.uses.abandoned[0].consumption, null);
    consumer = await f.reserveCompany(consumer, [selected._id, lossUnit._id]); consumer = await f.reserveRaw(consumer, f.directReceipt, f.direct, '2.5');
    result = await trace(selected); assert.equal(result.uses.reserved.length, 1); assert.equal(result.uses.abandoned.length, 1); assert.equal(result.uses.reserved[0].reservationQuantity, '2'); assert.equal(result.uses.reserved[0].selectedQuantity, '1');
  });
  await t.test('issued and consumed-unattributed reflect actual unit disposition and immutable pointers', async () => {
    consumer = await f.mutate(consumer, 'release'); consumer = await f.mutate(consumer, 'issue');
    let result = await trace(selected); assert.equal(result.uses.issued.length, 1); assert.ok(result.uses.issued[0].issue.contentHash); assert.equal(result.uses.issued[0].consumption, null);
    consumer = await f.mutate(consumer, 'records', { operationIndex: 0, inputQuantity: '2', goodQuantity: '1', scrapQuantity: '1', laborMinutes: '2', machineMinutes: '1', evidence: 'Actual mixed input process with one scrap' });
    result = await trace(selected); assert.equal(result.uses.issued.length, 0); assert.equal(result.uses.consumedUnattributed.length, 1); assert.ok(result.uses.consumedUnattributed[0].consumption.contentHash);
    consumer = await f.mutate(consumer, 'records', { operationIndex: 1, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', laborMinutes: '1', machineMinutes: '1', evidence: 'Actual completed serialized descendant', outputSerials: ['OWNER-TRACE-LEAF-1'] });
    assert.equal((await trace(selected)).uses.consumedUnattributed.length, 1);
  });
  await t.test('partial selected-unit output and explicit process loss precede QC and stored leaf evidence', async () => {
    consumer = await f.mutate(consumer, 'allocations', { outputUnitId: consumer.outputUnits[0]._id, sources: [{ sourceKind: 'COMPANY_OUTPUT', companyReceiptId: source._id, quantity: '1', companyUnitIds: [selected._id] }, { sourceKind: 'CATALOG_RECEIPT', receiptId: f.directReceipt._id, quantity: '1.25' }] });
    let result = await trace(selected); assert.equal(result.uses.outputs.length, 1); assert.equal(result.uses.outputs[0].output.status, 'QUARANTINED'); assert.equal(result.uses.outputs[0].output.qcDisposition, null); assert.equal(result.uses.consumedUnattributed.length, 0); assert.equal((await trace(lossUnit)).uses.consumedUnattributed.length, 1);
    consumer = await f.mutate(consumer, 'losses', { sources: [{ sourceKind: 'COMPANY_OUTPUT', companyReceiptId: source._id, quantity: '1', companyUnitIds: [lossUnit._id] }, { sourceKind: 'CATALOG_RECEIPT', receiptId: f.directReceipt._id, quantity: '1.25' }] });
    const loss = await trace(lossUnit); assert.equal(loss.uses.outputs.length, 0); assert.equal(loss.uses.losses[0].quantity, '1'); assert.equal(loss.uses.consumedUnattributed.length, 0);
    consumer = await f.mutate(consumer, 'qc', { acceptedSerials: ['OWNER-TRACE-LEAF-1'], rejectedSerials: [], evidence: 'Actual complete mixed output and loss QC' });
    result = await trace(selected); assert.equal(result.uses.outputs[0].output.qcDisposition, 'ACCEPTED'); assert.equal(result.uses.outputs[0].output.status, 'ACCEPTED'); assert.equal(result.uses.outputs[0].output.companyReceiptId, null);
    consumer = await f.mutate(consumer, 'putaway', { locationId: f.location._id, expectedLocationVersion: f.location.version });
    result = await trace(selected); assert.equal(result.uses.outputs[0].output.status, 'STORED'); assert.equal(result.uses.outputs[0].output.companyReceiptId, consumer.companyStock._id);
    const leafUnit = consumer.companyStock.units[0], before = await snapshot(), leaf = await ok(`/company-stock/receipts/${consumer.companyStock._id}/units/${leafUnit._id}/trace`);
    assert.deepEqual(await snapshot(), before); assert.equal(leaf.sourcePolicy, 'LEAF_ONLY'); assert.equal(leaf.current.eligible, false); assert.deepEqual(leaf.ancestry.purchasedSources.map(row => row.receiptId), [f.directReceipt._id]);
    assert.equal(leaf.ancestry.companySources.length, 1); assert.equal(leaf.ancestry.companySources[0].companyUnitId, selected._id); assert.deepEqual(leaf.ancestry.companySources[0].purchasedSources.find(row => row.receiptId === f.serialReceipt._id).serials, f.incomingSerials.slice(0, 2));
    assert.deepEqual(leaf.holdPolicy.receiptIds, [f.directReceipt._id, f.rawReceipt._id, f.serialReceipt._id].sort());
  });
  await t.test('historical held evidence stays readable and malformed or orphan source proof fails closed', async () => {
    let current = await f.company(); await ok(`${f.companyPath}/holds`, command({ expectedVersion: current.version, reasonCode: 'TRACE_REVIEW' }));
    const held = await trace(selected); assert.equal(held.current.hold.active, true); assert.equal(held.current.eligible, false); assert.equal(held.uses.outputs[0].output.status, 'STORED');
    current = await f.company(); await ok(`${f.companyPath}/holds/release`, command({ expectedVersion: current.version, expectedHoldId: current.hold._id }));
    const head = await db.collection('companyStockUseHeads').findOne({ _id: source._id }); await db.collection('companyStockUseHeads').deleteOne({ _id: source._id });
    try { const before = await snapshot(), response = await h.req(path(selected._id), undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'COMPANY_STOCK_SOURCE_INVALID'); assert.deepEqual(await snapshot(), before); } finally { await db.collection('companyStockUseHeads').insertOne(head); }
    const revision = await db.collection('internalAttributionRevisions').findOne({ executionId: consumer._id }, { sort: { revision: -1 } });
    const corrupt = { ...stockHashless(revision), allocations: [{ outputUnitId: randomUUID(), sources: [] }] }; corrupt.contentHash = stockHash(corrupt);
    await db.collection('internalAttributionRevisions').replaceOne({ _id: revision._id }, corrupt);
    try { const before = await snapshot(), response = await h.req(path(selected._id), undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'INTERNAL_EXECUTION_SOURCE_INVALID'); assert.deepEqual(await snapshot(), before); } finally { await db.collection('internalAttributionRevisions').replaceOne({ _id: revision._id }, revision); }
  });
});
