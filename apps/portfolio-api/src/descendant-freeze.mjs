import { randomUUID } from 'node:crypto';
import { stockHash as hash } from './catalog-stock-values.mjs';
import { requireQualityGates } from './quality.mjs';
import { readRepairManufacturedGraph } from './repair-stock.mjs';
import { manufacturedGraphLimits } from '../../../packages/contracts/src/domains/planning-execution/manufactured-graph.mjs';
import { requireMaintenanceCapacity } from './maintenance.mjs';

const fail = code => { throw Object.assign(new Error(code), { status: 409, code }); };

export async function requireDispatchResources(db, filter, actor, handling, session, at) {
  await requireQualityGates(db, filter, [{ resourceType: 'OPERATOR', resourceId: actor }], session, { at });
  if (handling === undefined) return null;
  if (!handling || typeof handling !== 'object' || Array.isArray(handling) || Object.keys(handling).some(key => !['equipmentId', 'expectedEquipmentVersion', 'expectedMaintenanceVersion', 'from', 'until', 'requiredMinutes'].includes(key)) || !Number.isSafeInteger(handling.expectedEquipmentVersion) || handling.expectedEquipmentVersion < 1 || !Number.isSafeInteger(handling.expectedMaintenanceVersion) || handling.expectedMaintenanceVersion < 0) throw Object.assign(new Error('INVALID_DISPATCH_RESOURCES'), { status: 400, code: 'INVALID_DISPATCH_RESOURCES' });
  if (new Date(handling.from) > at || new Date(handling.until) <= at) fail('DISPATCH_WINDOW_NOT_CURRENT');
  const result = await requireMaintenanceCapacity(db, filter, handling.equipmentId, { from: handling.from, until: handling.until, requiredMinutes: handling.requiredMinutes, expectedVersion: handling.expectedMaintenanceVersion }, session);
  if (result.equipmentVersion !== handling.expectedEquipmentVersion) fail('QUALITY_VERSION_CONFLICT');
  return { ...handling, validatedCapacity: result };
}

export async function readDispatchManufacturedGraph(db, filter, receiptId, unitId, session, options = {}) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const { companyStockContext } = await import('./company-stock.mjs');
  const context = await companyStockContext(db, filter, receiptId, session, { fresh: options.fence, fence: options.fence });
  const claims = context.use.reservations.filter(row => row.companyUnitIds.includes(unitId));
  if (!claims.some(row => row.authorityKind === 'FULFILLMENT_SHIPMENT')) return readRepairManufacturedGraph(db, filter, receiptId, unitId, session, options);
  const { buildFulfillmentCompanyTrace } = await import('./manufactured-dispatch.mjs');
  const trace = await buildFulfillmentCompanyTrace(db, filter, context, unitId, session, () => { throw new Error('SHIPMENT_TRACE_DISPATCH_REQUIRED'); });
  const snapshot = { schema: 'MANUFACTURED_GRAPH_V1', ...filter, ownerLegalEntityId: context.receipt.ownerLegalEntityId, companyReceiptId: receiptId, companyUnitId: unitId, outputUnitId: trace.outputUnitId, serial: trace.serial, producer: { executionId: trace.producer.executionId, attributionRevision: context.producer.head.attributionRevision, provenanceHash: trace.producer.provenanceHash }, ancestry: trace.ancestry };
  return { snapshot, contentHash: hash(snapshot), stockVersion: context.use.version, unit: context.use.units.find(row => row._id === unitId), blockers: context.blockers };
}

export async function freezeDispatchDescendants(db, filter, receiptId, selected, shipmentId, actor, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const { freezeManufacturedGraph } = await import('./genealogy.mjs');
  const graph = await readDispatchManufacturedGraph(db, filter, receiptId, selected.companyUnitId, session, { fence: true });
  if (graph.unit?.status !== 'AVAILABLE' || graph.unit.version !== selected.expectedUnitVersion || graph.blockers.length) fail('STOCK_ENCUMBERED');
  const closure = [], seen = new Set(), active = new Set();
  async function visit(snapshot, contentHash, depth) {
    const key = `${snapshot.companyReceiptId}:${snapshot.companyUnitId}`;
    if (active.has(key)) fail('MANUFACTURED_GRAPH_CYCLE');
    if (seen.has(key)) fail('MANUFACTURED_UNIQUE_PARENT_REQUIRED');
    if (depth >= manufacturedGraphLimits.depth || seen.size >= manufacturedGraphLimits.executions) fail('MANUFACTURED_GRAPH_LIMIT');
    if (hash(snapshot) !== contentHash || snapshot.ownerLegalEntityId !== graph.snapshot.ownerLegalEntityId || snapshot.tenantId !== filter.tenantId || snapshot.plantId !== filter.plantId) fail('GENEALOGY_SOURCE_INVALID');
    seen.add(key); active.add(key);
    await requireQualityGates(db, filter, [{ resourceType: 'COMPANY_UNIT', resourceId: snapshot.companyUnitId }], session);
    await requireQualityGates(db, filter, snapshot.ancestry.purchasedSources.map(source => ({ resourceType: 'RECEIPT', resourceId: source.receiptId })), session);
    closure.push({ companyReceiptId: snapshot.companyReceiptId, companyUnitId: snapshot.companyUnitId, snapshot, contentHash });
    for (const parent of snapshot.ancestry.companySources) {
      if (parent.quantity !== '1') fail('MANUFACTURED_UNIQUE_PARENT_REQUIRED');
      const current = await readDispatchManufacturedGraph(db, filter, parent.companyReceiptId, parent.companyUnitId, session, { fence: true });
      if (current.blockers.length || current.snapshot.serial !== parent.serial || current.snapshot.outputUnitId !== parent.outputUnitId || current.snapshot.producer.executionId !== parent.producerExecutionId || current.snapshot.producer.provenanceHash !== parent.provenanceHash || hash(current.snapshot.ancestry.purchasedSources) !== hash(parent.purchasedSources) || hash(current.snapshot.ancestry.companySources) !== hash(parent.companySources)) fail('GENEALOGY_SOURCE_INVALID');
      await visit(current.snapshot, current.contentHash, depth + 1);
    }
    active.delete(key);
  }
  await visit(graph.snapshot, graph.contentHash, 0);
  const pointers = await freezeManufacturedGraph(db, filter, receiptId, graph.stockVersion, [selected], { type: 'SHIPMENT', id: shipmentId }, actor, session);
  const row = { _id: randomUUID(), ...filter, schema: 'SHIPMENT_DESCENDANT_FREEZE_V1', shipmentId, companyReceiptId: receiptId, companyUnitId: selected.companyUnitId, graphHash: graph.contentHash, closure, recordedBy: actor, recordedAt: new Date() };
  row.contentHash = hash(row);
  await db.collection('shipmentDescendantFreezes').insertOne(row, { session });
  return { ...pointers[0], descendantFreezeId: row._id, descendantFreezeHash: row.contentHash };
}

export async function validateDispatchFreeze(db, filter, pointer, shipmentId, session) {
  const graph = await db.collection('manufacturedGenealogySnapshots').findOne({ ...filter, _id: pointer.snapshotId, referenceType: 'SHIPMENT', referenceId: shipmentId }, { session });
  const row = await db.collection('shipmentDescendantFreezes').findOne({ ...filter, _id: pointer.descendantFreezeId, shipmentId }, { session });
  if (!graph || !row || graph.companyReceiptId !== pointer.companyReceiptId || graph.companyUnitId !== pointer.companyUnitId || graph.contentHash !== pointer.contentHash || hash(graph.snapshot) !== pointer.contentHash || row.contentHash !== pointer.descendantFreezeHash || hash(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contentHash'))) !== row.contentHash || row.graphHash !== graph.contentHash || row.companyReceiptId !== graph.companyReceiptId || row.companyUnitId !== graph.companyUnitId || !Array.isArray(row.closure) || !row.closure.length || row.closure.length > manufacturedGraphLimits.executions) fail('GENEALOGY_SOURCE_INVALID');
  for (const entry of row.closure) if (hash(entry.snapshot) !== entry.contentHash) fail('GENEALOGY_SOURCE_INVALID');
  return graph;
}
