import { Buffer } from 'node:buffer';
import { validateInternalExecution, reconcileInternalAttribution, executionInvalid } from './internal-execution-state.mjs';
import { catalogStockContext } from './catalog-stock.mjs';
import { stockHash as hash } from './catalog-stock-use-state.mjs';
import { companyStockInvalid } from './company-stock-state.mjs';

export const companyTraceLimits = Object.freeze({ executions: 32, companyReceipts: 32, rawReceipts: 128, outputUnits: 2000, useReservations: 100, responseBytes: 512 * 1024 });
const limitExceeded = () => { throw Object.assign(new Error('TRACE_LIMIT_EXCEEDED'), { status: 409, code: 'TRACE_LIMIT_EXCEEDED' }); };
const notFound = () => { throw Object.assign(new Error('NOT_FOUND'), { status: 404, code: 'NOT_FOUND' }); };
export function enforceCompanyTraceResponseLimit(data) {
  if (Buffer.byteLength(JSON.stringify({ data }), 'utf8') > companyTraceLimits.responseBytes) limitExceeded();
  return data;
}
export async function initializeCompanyStockTrace(db) {
  await db.collection('companyMaterialReservations').createIndex({ tenantId: 1, plantId: 1, companyReceiptId: 1, companyUnitIds: 1, _id: 1 }, { name: 'company_unit_trace_uses' });
}

export async function buildCompanyUnitTrace(db, filter, root, companyUnitId, session, loadCompanyContext) {
  const openingUnit = root.producer.companyUnits.find(unit => unit._id === companyUnitId), unit = root.use.units.find(unit => unit._id === companyUnitId);
  if (!openingUnit || !unit || openingUnit.companyReceiptId !== root.receipt._id) notFound();
  const executions = new Map(), companies = new Map(), rawReceipts = new Map(), outputIds = new Set(), useIds = new Set(), checkedExecutions = new Set();
  const add = (map, key, value, maximum) => { if (!map.has(key) && map.size >= maximum) limitExceeded(); map.set(key, value); return value; };
  const outputBudget = current => { for (const output of current.outputs) { outputIds.add(output._id); if (outputIds.size > companyTraceLimits.outputUnits) limitExceeded(); } };
  async function raw(receiptId) { if (!rawReceipts.has(receiptId)) { if (rawReceipts.size >= companyTraceLimits.rawReceipts) limitExceeded(); add(rawReceipts, receiptId, await catalogStockContext(db, filter, receiptId, session), companyTraceLimits.rawReceipts); } return rawReceipts.get(receiptId); }
  async function executionSources(current) {
    if (checkedExecutions.has(current.head._id)) return;
    checkedExecutions.add(current.head._id);
    for (const receiptId of current.head.sourceReceiptIds) await raw(receiptId);
    for (const receiptId of current.head.companySourceReceiptIds || []) await company(receiptId);
  }
  async function registerExecution(current) {
    if (current.head.ownerLegalEntityId !== root.receipt.ownerLegalEntityId) executionInvalid();
    add(executions, current.head._id, current, companyTraceLimits.executions); outputBudget(current);
    reconcileInternalAttribution(current.head, current.reservations, current.outputs, ['QC_RELEASED', 'STORED'].includes(current.head.status));
    await executionSources(current); return current;
  }
  async function execution(executionId) {
    if (!executions.has(executionId)) { if (executions.size >= companyTraceLimits.executions) limitExceeded(); await registerExecution(await validateInternalExecution(db, filter, executionId, session)); }
    return executions.get(executionId);
  }
  async function company(receiptId) {
    if (!companies.has(receiptId)) { if (companies.size >= companyTraceLimits.companyReceipts) limitExceeded(); const value = await loadCompanyContext(receiptId); add(companies, receiptId, value, companyTraceLimits.companyReceipts); await registerExecution(value.producer); }
    return companies.get(receiptId);
  }
  add(companies, root.receipt._id, root, companyTraceLimits.companyReceipts); await registerExecution(root.producer);
  async function rawSource(current, source) {
    const reservation = current.reservations.find(row => row.sourceKind !== 'COMPANY_OUTPUT' && row.receiptId === source.receiptId && row.status === 'CONSUMED');
    if (!reservation || !reservation.consumptionId || !reservation.consumptionHash) executionInvalid();
    const context = await raw(source.receiptId);
    if (reservation.originHash !== context.origin.contentHash) executionInvalid();
    return { receiptId: source.receiptId, quantity: source.quantity, uom: reservation.uom, materialLineId: reservation.materialLineId, consumptionId: reservation.consumptionId, consumptionHash: reservation.consumptionHash, originHash: reservation.originHash, ...(Object.hasOwn(source, 'serials') ? { serials: source.serials } : {}), ...(context.receipt.lotNumber ? { lotNumber: context.receipt.lotNumber, heatNumber: context.receipt.heatNumber } : {}) };
  }
  async function ancestry(current, outputUnitId, allowCompany) {
    const allocation = current.head.allocations.find(row => row.outputUnitId === outputUnitId); if (!allocation) executionInvalid();
    const purchasedSources = [], companySources = [];
    for (const source of allocation.sources) {
      if (source.sourceKind !== 'COMPANY_OUTPUT') purchasedSources.push(await rawSource(current, source));
      else {
        if (!allowCompany) executionInvalid();
        const upstream = await company(source.companyReceiptId);
        if (upstream.producer.head.schema !== 'INTERNAL_EXECUTION_V1' || upstream.sourcePolicy !== 'ONE_HOP_SOURCE') companyStockInvalid();
        for (const upstreamId of source.companyUnitIds) { const actual = upstream.producer.companyUnits.find(unit => unit._id === upstreamId); if (!actual) companyStockInvalid(); const sources = await ancestry(upstream.producer, actual.outputUnitId, false); companySources.push({ companyReceiptId: upstream.receipt._id, companyUnitId: actual._id, outputUnitId: actual.outputUnitId, serial: actual.serial, quantity: '1', producerExecutionId: upstream.producer.head._id, provenanceHash: upstream.producer.head.attributionHash, purchasedSources: sources.purchasedSources }); }
      }
    }
    return { basis: 'EXACT_OUTPUT_ATTRIBUTION', purchasedSources, companySources };
  }
  const exactAncestry = await ancestry(root.producer, openingUnit.outputUnitId, root.producer.head.schema === 'INTERNAL_EXECUTION_V2');
  const uses = { reserved: [], issued: [], consumedUnattributed: [], outputs: [], losses: [], abandoned: [] };
  const rows = await db.collection('companyMaterialReservations').find({ ...filter, companyReceiptId: root.receipt._id, companyUnitIds: companyUnitId }, { session }).hint('company_unit_trace_uses').sort({ _id: 1 }).limit(companyTraceLimits.useReservations + 1).toArray();
  if (rows.length > companyTraceLimits.useReservations) limitExceeded();
  const expected = root.use.reservations.filter(row => row.companyUnitIds.includes(companyUnitId));
  if (hash(rows.map(row => row._id).sort()) !== hash(expected.map(row => row._id).sort())) companyStockInvalid();
  for (const reservation of rows) {
    useIds.add(reservation._id); const current = await execution(reservation.executionId), proof = current.reservations.find(row => row._id === reservation._id);
    if (!proof || hash(proof) !== hash(reservation)) executionInvalid();
    const use = { reservationId: reservation._id, reservationVersion: reservation.version, reservationStatus: reservation.status, materialLineId: reservation.materialLineId, reservationQuantity: reservation.quantity, selectedQuantity: '1', consumer: { executionId: current.head._id, internalOrderId: current.head.internalOrderId, schema: current.head.schema, status: current.head.status, version: current.head.version, provenanceHash: current.head.attributionHash }, issue: reservation.issueId ? { id: reservation.issueId, contentHash: reservation.issueHash } : null, consumption: reservation.consumptionId ? { id: reservation.consumptionId, contentHash: reservation.consumptionHash } : null };
    if (reservation.status === 'RELEASED') uses.abandoned.push(use);
    else if (reservation.status === 'RESERVED') uses.reserved.push(use);
    else if (reservation.status === 'ISSUED') uses.issued.push(use);
    else if (reservation.status === 'CONSUMED') {
      let attributed = false;
      for (const allocation of current.head.allocations.filter(row => row.sources.some(source => source.sourceKind === 'COMPANY_OUTPUT' && source.companyReceiptId === root.receipt._id && source.companyUnitIds.includes(companyUnitId)))) {
        const actual = current.outputs.find(output => output._id === allocation.outputUnitId); if (!actual) executionInvalid(); attributed = true;
        const stored = current.companyUnits.find(unit => unit.outputUnitId === actual._id);
        uses.outputs.push({ ...use, output: { outputUnitId: actual._id, serial: actual.serial, status: actual.status, qcDisposition: current.head.qc ? current.head.qc.acceptedSerials.includes(actual.serial) ? 'ACCEPTED' : 'REJECTED' : null, companyReceiptId: stored ? current.companyReceipt._id : null, companyUnitId: stored?._id || null } });
      }
      if (current.head.losses.some(source => source.sourceKind === 'COMPANY_OUTPUT' && source.companyReceiptId === root.receipt._id && source.companyUnitIds.includes(companyUnitId))) { if (attributed) executionInvalid(); attributed = true; uses.losses.push({ ...use, quantity: '1' }); }
      if (!attributed) uses.consumedUnattributed.push(use);
    } else companyStockInvalid();
  }
  const head = root.producer.head, trace = { schema: 'COMPANY_UNIT_TRACE_V1', companyReceiptId: root.receipt._id, companyUnitId, outputUnitId: openingUnit.outputUnitId, serial: openingUnit.serial, sourcePolicy: root.sourcePolicy, itemSnapshot: head.sourceDemand.itemSnapshot, ownerLegalEntityId: root.receipt.ownerLegalEntityId, locationSnapshot: root.receipt.locationSnapshot, current: { stockVersion: root.use.version, unitVersion: unit.version, status: unit.status, eligible: !root.blockers.length && unit.status === 'AVAILABLE', hold: root.use.hold, blockers: root.blockers }, producer: { executionId: head._id, internalOrderId: head.internalOrderId, schema: head.schema, status: head.status, version: head.version, engineeringRevision: head.sourceDemand.engineering.currentRevision, provenanceHash: head.attributionHash, qc: head.qc }, ancestry: exactAncestry, holdPolicy: { basis: 'CONSERVATIVE_CONSUMED_BATCH', receiptIds: (root.receipt.consumedAncestryReceiptIds || root.receipt.consumedReceiptIds).slice().sort(), directHold: root.use.hold }, uses, completeness: { complete: true, oneGeneration: true, counts: { executions: executions.size, companyReceipts: companies.size, rawReceipts: rawReceipts.size, outputUnits: outputIds.size, useReservations: useIds.size } } };
  return enforceCompanyTraceResponseLimit(trace);
}
