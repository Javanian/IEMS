import { randomUUID } from 'node:crypto';
import { stockHash as hash, stockHashless as hashless, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { validateInventoryItemAuthority } from './internal-production.mjs';
import { requireQualityGates } from './quality.mjs';

const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const invalid = () => fail(409, 'REPAIR_STOCK_AUTHORITY_INVALID');
const same = (a, b) => hash(a) === hash(b);
const semantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['stockEventId', 'stockAuthorityHash', 'repairUseFence'].includes(key)));
const uuid = value => { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(400, 'INVALID_ID'); return value; };
const text = value => { if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(400, 'INVALID_TEXT'); return value.trim(); };
const qty = value => { let amount; try { amount = units(value); } catch { fail(400, 'INVALID_QUANTITY'); } if (amount <= 0n) fail(400, 'INVALID_QUANTITY'); return amount; };
export const repairClaimBinding = row => Object.fromEntries(['authorityKind', 'caseId', 'authorizationHash', 'authorizedCaseVersion'].map(key => [key, row[key]]));

export async function initializeRepairStock(db) {
  await db.collection('repairCaseEvents').createIndex({ tenantId: 1, plantId: 1, caseId: 1, version: 1 }, { unique: true });
}
export async function saveRepairStockAuthority(db, filter, row, actor, kind, session) {
  if (!row.spareMaterials) return;
  row.stockPreviousHash = row.stockAuthorityHash || null;
  const snapshot = semantic(row), eventId = randomUUID();
  row.stockEventId = eventId; row.stockAuthorityHash = hash(snapshot);
  await db.collection('repairCaseEvents').insertOne({ _id: eventId, ...filter, caseId: row._id, version: row.version, status: row.status, kind, recordedBy: actor, recordedAt: new Date(), snapshot, contentHash: row.stockAuthorityHash }, { session });
}
export async function validateRepairCaseAuthority(db, filter, caseId, session) {
  const row = await db.collection('repairCases').findOne({ ...filter, _id: caseId }, { session });
  const event = row && await db.collection('repairCaseEvents').findOne({ ...filter, _id: row.stockEventId, caseId, version: row.version }, { session });
  if (!row || !event || event.status !== row.status || event.contentHash !== row.stockAuthorityHash || hash(event.snapshot) !== row.stockAuthorityHash || hash(semantic(row)) !== row.stockAuthorityHash || row.decision?.decision !== 'ACCEPT' || !Array.isArray(row.spareMaterials) || !Array.isArray(row.spareClaims) || row.spareMaterials.length > 100 || row.spareClaims.length > 100 || new Set(row.spareMaterials.map(m => m.lineId)).size !== row.spareMaterials.length || new Set(row.spareClaims.map(r => r.reservationId)).size !== row.spareClaims.length) invalid();
  if (row.stockPreviousHash) {
    const prior = await db.collection('repairCaseEvents').findOne({ ...filter, caseId, version: row.version - 1 }, { session });
    if (!prior || prior.contentHash !== row.stockPreviousHash || hash(prior.snapshot) !== prior.contentHash) invalid();
  }
  return row;
}
export async function validateRepairStockClaim(db, filter, claim, session) {
  if (claim.authorityKind !== 'REPAIR_CASE' || Object.hasOwn(claim, 'executionId') || Object.hasOwn(claim, 'schema') || Object.hasOwn(claim, 'demandKind')) invalid();
  const row = await validateRepairCaseAuthority(db, filter, claim.caseId, session), material = row.spareMaterials.find(m => m.lineId === claim.materialLineId);
  const authorized = material && await db.collection('repairCaseEvents').findOne({ ...filter, caseId: row._id, version: material.authorizedCaseVersion }, { session });
  if (authorized && (authorized.kind !== 'spare-authorize' || authorized.snapshot._id !== row._id || !authorized.snapshot.scopes?.at(-1)?.findings?.some(f => f.component === material.component && (f.disposition === 'REPLACE' || f.disposition === 'REPAIR' && authorized.status === 'REWORK')))) invalid();
  const pointer = row.spareClaims.find(ref => ref.reservationId === claim._id);
  const effect = await db.collection('repairCaseEvents').findOne({ ...filter, caseId: row._id, version: claim.effectCaseVersion }, { session });
  if (!effect || hash(effect.snapshot) !== effect.contentHash || effect.kind !== ({ RESERVED: 'spare-reserve', ISSUED: 'spare-issue', CONSUMED: 'spare-install', RELEASED: 'spare-release' })[claim.status] || !['IN_PROGRESS', 'REWORK'].includes(effect.status) || !effect.snapshot.spareClaims?.some(ref => ref.reservationId === claim._id && ref.version === claim.version && ref.contentHash === claim.contentHash)) invalid();
  if (!material || !authorized || hash(authorized.snapshot) !== authorized.contentHash || !['IN_PROGRESS', 'REWORK'].includes(authorized.status) || authorized.snapshot.decision?.decision !== 'ACCEPT' || !same(authorized.snapshot.spareMaterials?.find(m => m.lineId === material.lineId), material) || claim.authorizationHash !== hash(material) || claim.authorizedCaseVersion !== material.authorizedCaseVersion || material.scopeRevision !== row.decision.revision || material.itemId !== claim.itemId || material.itemRevision !== claim.itemRevision || material.uom !== claim.uom || material.ownerLegalEntityId !== claim.ownerLegalEntityId || material.sourceKind !== claim.sourceKind || !pointer || pointer.version !== claim.version || pointer.contentHash !== claim.contentHash || pointer.status !== claim.status || pointer.quantity !== claim.quantity || pointer.materialLineId !== material.lineId || !same(pointer.sourceId, claim.receiptId || claim.companyReceiptId)) invalid();
  let claimed = 0n;
  for (const ref of row.spareClaims.filter(ref => ref.materialLineId === material.lineId)) {
    const source = await db.collection(ref.sourceKind === 'COMPANY_OUTPUT' ? 'companyMaterialReservations' : 'catalogMaterialReservations').findOne({ ...filter, _id: ref.reservationId }, { session });
    if (!['CATALOG_RECEIPT', 'COMPANY_OUTPUT'].includes(ref.sourceKind) || !source || source.sourceKind !== ref.sourceKind || source.authorityKind !== 'REPAIR_CASE' || source.caseId !== row._id || source.materialLineId !== material.lineId || source.contentHash !== ref.contentHash || hash(hashless(source)) !== source.contentHash || source.quantity !== ref.quantity || source.status !== ref.status || source.version !== ref.version || source.authorizationHash !== hash(material)) invalid();
    if (ref.status !== 'RELEASED') claimed += units(ref.quantity);
  }
  if (claimed > units(material.quantity)) invalid();
  return { row, material };
}
export function validateRepairMovement(claim, movement) {
  if (!same(repairClaimBinding(claim), repairClaimBinding(movement)) || movement.materialLineId !== claim.materialLineId || movement.sourceKind !== claim.sourceKind || movement.itemId !== claim.itemId || movement.itemRevision !== claim.itemRevision || movement.uom !== claim.uom || movement.ownerLegalEntityId !== claim.ownerLegalEntityId) invalid();
}
async function requireMaterial(db, filter, row, material, session) {
  const item = await validateInventoryItemAuthority(db, filter, material.itemId, session);
  const plant = await db.collection('plants').findOne({ tenantId: filter.tenantId, _id: filter.plantId, active: true }, { session });
  if (item.status !== 'APPROVED' || item.version !== material.itemVersion || item.currentRevision !== material.itemRevision || item.contentHash !== material.itemHash || item.ownerLegalEntityId !== material.ownerLegalEntityId || plant?.legalEntityId !== material.ownerLegalEntityId || item.content.uom !== material.uom || item.content.schema !== 'INVENTORY_ITEM_V2' || material.sourceKind !== (item.content.kind === 'PURCHASED' ? 'CATALOG_RECEIPT' : 'COMPANY_OUTPUT')) fail(409, 'REPAIR_MATERIAL_CHANGED');
  const touched = await db.collection('inventoryItems').updateOne({ ...filter, _id: item._id, version: item.version }, { $inc: { useFence: 1 } }, { session }); if (touched.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  if (row.holdActive) fail(409, 'QC_BLOCKED');
  await requireQualityGates(db, filter, [{ resourceType: 'REPAIR_CASE', resourceId: row._id }], session);
  return item;
}
async function sourceQuality(db, filter, sourceKind, sourceId, companyUnitIds, session) {
  await requireQualityGates(db, filter, sourceKind === 'COMPANY_OUTPUT' ? companyUnitIds.map(resourceId => ({ resourceType: 'COMPANY_UNIT', resourceId })) : [{ resourceType: 'RECEIPT', resourceId: sourceId }], session);
}
async function retainedGraph(db, filter, context, companyUnitId, session) {
  const graph = await db.collection('manufacturedGenealogySnapshots').findOne({ ...filter, companyReceiptId: context.receipt._id, companyUnitId }, { session });
  if (!graph) return null;
  const unit = context.producer.companyUnits.find(u => u._id === companyUnitId), snapshot = graph.snapshot;
  if (hash(snapshot) !== graph.contentHash || snapshot.schema !== 'MANUFACTURED_GRAPH_V1' || snapshot.tenantId !== filter.tenantId || snapshot.plantId !== filter.plantId || snapshot.companyReceiptId !== context.receipt._id || snapshot.companyUnitId !== companyUnitId || snapshot.outputUnitId !== unit?.outputUnitId || snapshot.serial !== unit?.serial || snapshot.ownerLegalEntityId !== context.receipt.ownerLegalEntityId || snapshot.producer?.executionId !== context.producer.head._id || snapshot.producer?.provenanceHash !== context.producer.head.attributionHash) invalid();
  return graph;
}
async function freezeRepairGraph(db, filter, context, selected, caseId, actor, session) {
  const prior = await retainedGraph(db, filter, context, selected.companyUnitId, session);
  if (!prior) {
    const { freezeManufacturedGraph } = await import('./genealogy.mjs');
    return freezeManufacturedGraph(db, filter, context.receipt._id, context.use.version, [selected], { type: 'REPAIR', id: caseId }, actor, session);
  }
  const match = { ...filter, companyReceiptId: context.receipt._id, companyUnitId: selected.companyUnitId, referenceType: 'REPAIR', referenceId: caseId };
  let row = await db.collection('manufacturedGenealogySnapshots').findOne(match, { session });
  if (row && (row.contentHash !== prior.contentHash || hash(row.snapshot) !== row.contentHash)) invalid();
  if (!row) {
    row = { _id: randomUUID(), ...match, snapshot: prior.snapshot, contentHash: prior.contentHash, recordedBy: actor, recordedAt: new Date() };
    await db.collection('manufacturedGenealogySnapshots').insertOne(row, { session });
    const event = { ...match, snapshotId: row._id, contentHash: row.contentHash, kind: 'manufacturedGraph.frozen', recordedBy: actor, recordedAt: row.recordedAt };
    await db.collection('manufacturedGenealogyAudit').insertOne({ _id: randomUUID(), ...event }, { session });
    await db.collection('manufacturedGenealogyOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
  }
  return [{ snapshotId: row._id, companyReceiptId: context.receipt._id, companyUnitId: selected.companyUnitId, contentHash: row.contentHash }];
}
export async function buildRepairCompanyTrace(db, filter, context, companyUnitId, session, original) {
  const claims = context.use.reservations.filter(r => r.companyUnitIds.includes(companyUnitId));
  if (!claims.some(r => r.authorityKind === 'REPAIR_CASE')) return original();
  const graph = await retainedGraph(db, filter, context, companyUnitId, session);
  if (!graph) invalid();
  const unit = context.use.units.find(u => u._id === companyUnitId), head = context.producer.head;
  const uses = { reserved: [], issued: [], consumedUnattributed: [], outputs: [], losses: [], abandoned: [], repair: [] };
  for (const claim of claims) {
    if (claim.authorityKind === 'REPAIR_CASE') {
      const { row, material } = await validateRepairStockClaim(db, filter, claim, session);
      uses.repair.push({ reservationId: claim._id, reservationVersion: claim.version, reservationStatus: claim.status, authorityKind: 'REPAIR_CASE', caseId: row._id, caseNumber: row.caseNumber, caseVersion: row.version, caseStatus: row.status, component: material.component, cycle: material.cycle, quantity: claim.quantity, uom: claim.uom, issueId: claim.issueId, consumptionId: claim.consumptionId, replacements: (row.replacements || []).filter(r => r.reservationId === claim._id), removals: (row.componentRemovals || []).filter(c => row.replacements?.some(r => r.reservationId === claim._id && r._id === c.sourceReplacementId)) });
      continue;
    }
    const { validateInternalExecution, reconcileInternalAttribution } = await import('./internal-execution-state.mjs');
    const current = await validateInternalExecution(db, filter, claim.executionId, session);
    if (current.head.ownerLegalEntityId !== context.receipt.ownerLegalEntityId) invalid();
    reconcileInternalAttribution(current.head, current.reservations, current.outputs, ['QC_RELEASED', 'STORED'].includes(current.head.status));
    if (!current.reservations.some(r => same(r, claim))) invalid();
    const use = { reservationId: claim._id, reservationVersion: claim.version, reservationStatus: claim.status, materialLineId: claim.materialLineId, reservationQuantity: claim.quantity, selectedQuantity: '1', consumer: { executionId: current.head._id, internalOrderId: current.head.internalOrderId, schema: current.head.schema, status: current.head.status, version: current.head.version, provenanceHash: current.head.attributionHash }, issue: claim.issueId ? { id: claim.issueId, contentHash: claim.issueHash } : null, consumption: claim.consumptionId ? { id: claim.consumptionId, contentHash: claim.consumptionHash } : null };
    if (claim.status === 'RELEASED') uses.abandoned.push(use);
    else if (claim.status === 'RESERVED') uses.reserved.push(use);
    else if (claim.status === 'ISSUED') uses.issued.push(use);
    else {
      let attributed = false;
      for (const allocation of current.head.allocations.filter(a => a.sources.some(s => s.sourceKind === 'COMPANY_OUTPUT' && s.companyReceiptId === context.receipt._id && s.companyUnitIds.includes(companyUnitId)))) {
        const output = current.outputs.find(o => o._id === allocation.outputUnitId), stored = current.companyUnits.find(u => u.outputUnitId === output?._id); if (!output) invalid();
        uses.outputs.push({ ...use, output: { outputUnitId: output._id, serial: output.serial, status: output.status, qcDisposition: current.head.qc ? current.head.qc.acceptedSerials.includes(output.serial) ? 'ACCEPTED' : 'REJECTED' : null, companyReceiptId: stored ? current.companyReceipt._id : null, companyUnitId: stored?._id || null } }); attributed = true;
      }
      if (current.head.losses.some(s => s.sourceKind === 'COMPANY_OUTPUT' && s.companyReceiptId === context.receipt._id && s.companyUnitIds.includes(companyUnitId))) { if (attributed) invalid(); uses.losses.push({ ...use, quantity: '1' }); attributed = true; }
      if (!attributed) uses.consumedUnattributed.push(use);
    }
  }
  const { enforceCompanyTraceResponseLimit } = await import('./company-stock-trace.mjs');
  return enforceCompanyTraceResponseLimit({ schema: context.sourcePolicy === 'MULTI_GENERATION_SOURCE' ? 'COMPANY_UNIT_TRACE_V2' : 'COMPANY_UNIT_TRACE_V1', repairUsesVersion: 1, companyReceiptId: context.receipt._id, companyUnitId, outputUnitId: unit.outputUnitId, serial: unit.serial, sourcePolicy: context.sourcePolicy, itemSnapshot: head.sourceDemand.itemSnapshot, ownerLegalEntityId: context.receipt.ownerLegalEntityId, locationSnapshot: context.receipt.locationSnapshot, current: { stockVersion: context.use.version, unitVersion: unit.version, status: unit.status, eligible: !context.blockers.length && unit.status === 'AVAILABLE', hold: context.use.hold, blockers: context.blockers }, producer: { executionId: head._id, internalOrderId: head.internalOrderId, schema: head.schema, status: head.status, version: head.version, engineeringRevision: head.sourceDemand.engineering.currentRevision, provenanceHash: head.attributionHash, qc: head.qc }, ancestry: graph.snapshot.ancestry, uses, holdPolicy: { basis: 'CONSERVATIVE_CONSUMED_BATCH', receiptIds: context.receipt.consumedAncestryReceiptIds || context.receipt.consumedReceiptIds, directHold: context.use.hold }, completeness: { complete: true, oneGeneration: context.sourcePolicy !== 'MULTI_GENERATION_SOURCE', multiGeneration: context.sourcePolicy === 'MULTI_GENERATION_SOURCE', basis: 'VALIDATED_IMMUTABLE_ANCESTRY_AND_CURRENT_CANONICAL_CLAIMS', counts: { useReservations: claims.length } } });
}
export async function readRepairManufacturedGraph(db, filter, companyReceiptId, companyUnitId, session, { fence = false } = {}) {
  if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const { companyStockContext } = await import('./company-stock.mjs');
  const { buildCompanyUnitTrace } = await import('./company-stock-trace.mjs');
  const root = await companyStockContext(db, filter, companyReceiptId, session, { fresh: fence, fence });
  const trace = await buildRepairCompanyTrace(db, filter, root, companyUnitId, session, () => buildCompanyUnitTrace(db, filter, root, companyUnitId, session, sourceId => companyStockContext(db, filter, sourceId, session, { fresh: fence, fence })));
  const snapshot = { schema: 'MANUFACTURED_GRAPH_V1', ...filter, ownerLegalEntityId: root.receipt.ownerLegalEntityId, companyReceiptId, companyUnitId, outputUnitId: trace.outputUnitId, serial: trace.serial, producer: { executionId: trace.producer.executionId, attributionRevision: root.producer.head.attributionRevision, provenanceHash: trace.producer.provenanceHash }, ancestry: trace.ancestry };
  return { snapshot, contentHash: hash(snapshot), stockVersion: root.use.version, unit: root.use.units.find(u => u._id === companyUnitId), blockers: root.blockers };
}
export async function recheckRepairStockSources(db, filter, row, session) {
  const { catalogStockContext } = await import('./catalog-stock.mjs');
  const { companyStockContext } = await import('./company-stock.mjs');
  if (!row.spareMaterials) return;
  await validateRepairCaseAuthority(db, filter, row._id, session);
  for (const ref of row.spareClaims.filter(ref => ref.status !== 'RELEASED')) {
    const material = row.spareMaterials.find(m => m.lineId === ref.materialLineId);
    await requireMaterial(db, filter, row, material, session);
    const context = await (ref.sourceKind === 'COMPANY_OUTPUT' ? companyStockContext(db, filter, ref.sourceId, session, { fresh: true, fence: true }) : catalogStockContext(db, filter, ref.sourceId, session, { fresh: true, fence: true }));
    const claim = context.use.reservations.find(r => r._id === ref.reservationId);
    await sourceQuality(db, filter, ref.sourceKind, ref.sourceId, claim?.companyUnitIds || [], session);
  }
}
export async function repairSpareCommand(db, filter, row, action, b, actor, session, now) {
  if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (row.decision?.decision !== 'ACCEPT' || !['IN_PROGRESS', 'REWORK'].includes(row.status) || row.holdActive || row.replacementFreeze) fail(409, 'REPAIR_SCOPE_CLOSED');
  if (row.spareMaterials) await validateRepairCaseAuthority(db, filter, row._id, session);
  row.spareMaterials ||= []; row.spareClaims ||= [];
  const cycle = row.tests?.at(-1)?.result === 'FAIL' ? row.tests.at(-1).run : 0;
  if (action === 'spare-authorize') {
    if (![b.itemVersion, b.itemRevision].every(v => Number.isSafeInteger(v) && v > 0)) fail(400, 'INVALID_VERSION');
    if (row.spareMaterials.length >= 100 || !['CATALOG_RECEIPT', 'COMPANY_OUTPUT'].includes(b.sourceKind)) fail(400, 'INVALID_REPAIR_MATERIAL');
    const component = text(b.component), finding = row.scopes.at(-1).findings.find(f => f.component === component);
    if (!finding || !(finding.disposition === 'REPLACE' || finding.disposition === 'REPAIR' && row.status === 'REWORK')) fail(409, 'SPARE_NOT_AUTHORIZED');
    if (row.spareMaterials.some(m => m.component === component && m.cycle === cycle)) fail(409, 'MATERIAL_ALREADY_AUTHORIZED');
    const item = await validateInventoryItemAuthority(db, filter, uuid(b.itemId), session);
    if (b.itemVersion !== item.version || b.itemRevision !== item.currentRevision) fail(409, 'VERSION_CONFLICT');
    if (item.content.trackingPolicy === 'SERIAL' && qty(b.quantity) !== 1000000n) fail(400, 'ONE_COMPONENT_SERIAL_REQUIRED');
    const material = { lineId: randomUUID(), component, cycle, scopeRevision: row.decision.revision, sourceKind: b.sourceKind, itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, itemHash: item.contentHash, ownerLegalEntityId: item.ownerLegalEntityId, quantity: decimal(qty(b.quantity)), uom: text(b.uom), authorizedCaseVersion: row.version + 1, authorizedBy: actor, authorizedAt: now, evidence: text(b.evidence) };
    await requireMaterial(db, filter, row, material, session); row.spareMaterials.push(material); return;
  }
  const material = row.spareMaterials.find(m => m.lineId === b.materialLineId);
  if (!material || material.cycle !== cycle) fail(409, 'REPAIR_MATERIAL_CHANGED');
  uuid(b.materialLineId);
  if (!Number.isSafeInteger(b.expectedStockVersion) || b.expectedStockVersion < 1 || (material.sourceKind === 'CATALOG_RECEIPT' && (!Number.isSafeInteger(b.expectedReceiptVersion) || b.expectedReceiptVersion < 1))) fail(400, 'INVALID_VERSION');
  if (material.sourceKind === 'COMPANY_OUTPUT' ? b.serials !== undefined || b.expectedReceiptVersion !== undefined : b.units !== undefined) fail(400, 'INVALID_SOURCE_FIELDS');
  if (action !== 'spare-reserve') { uuid(b.reservationId); if (!Number.isSafeInteger(b.expectedReservationVersion) || b.expectedReservationVersion < 1) fail(400, 'INVALID_VERSION'); }
  if (action === 'spare-install') uuid(b.removedComponentId);
  if (action !== 'spare-release') await requireMaterial(db, filter, row, material, session);
  const { catalogStockContext, writeCatalogReservation } = await import('./catalog-stock.mjs');
  const { companyStockContext, writeCompanyReservation } = await import('./company-stock.mjs');
  const company = material.sourceKind === 'COMPANY_OUTPUT';
  const read = sourceId => company ? companyStockContext(db, filter, sourceId, session, { fresh: action !== 'spare-release', fence: true }) : catalogStockContext(db, filter, sourceId, session, { fresh: action !== 'spare-release', fence: true });
  let context, claim;
  if (action === 'spare-reserve') {
    if (row.spareClaims.length >= 100) fail(409, 'REPAIR_HISTORY_LIMIT');
    context = await read(uuid(b.sourceId));
    if (context.use.version !== b.expectedStockVersion || (!company && context.receipt.version !== b.expectedReceiptVersion)) fail(409, 'VERSION_CONFLICT');
    const amount = qty(b.quantity), claimed = row.spareClaims.filter(r => r.materialLineId === material.lineId && r.status !== 'RELEASED').reduce((sum, r) => sum + units(r.quantity), 0n);
    if (amount + claimed > units(material.quantity) || amount > units(context.use.availableQuantity)) fail(409, 'INSUFFICIENT_STOCK');
    const source = company ? context.receipt : context.origin.source;
    if (source.itemId !== material.itemId || source.itemRevision !== material.itemRevision || context.receipt.uom !== material.uom || source.ownerLegalEntityId !== material.ownerLegalEntityId) fail(409, 'MATERIAL_SOURCE_CONFLICT');
    let serials = [], companyUnitIds = [], sourceSnapshot, graph = [];
    if (company) {
      if (!Array.isArray(b.units) || b.units.length !== 1 || amount !== 1000000n) fail(400, 'INVALID_SERIALS');
      for (const selected of b.units) { if (!selected || Object.keys(selected).some(k => !['companyUnitId', 'expectedUnitVersion'].includes(k)) || !Number.isSafeInteger(selected.expectedUnitVersion) || selected.expectedUnitVersion < 1) fail(400, 'INVALID_SERIALS'); uuid(selected.companyUnitId); }
      for (const selected of b.units) { const unit = context.use.units.find(u => u._id === selected.companyUnitId); if (!unit || unit.status !== 'AVAILABLE' || unit.version !== selected.expectedUnitVersion) fail(409, 'STOCK_ENCUMBERED'); companyUnitIds.push(unit._id); serials.push(unit.serial); }
      const { companySourceSnapshot } = await import('./company-stock-state.mjs'); sourceSnapshot = companySourceSnapshot(context.producer, companyUnitIds);
      graph = await freezeRepairGraph(db, filter, context, b.units[0], row._id, actor, session);
    } else {
      if (source.trackingPolicy === 'LOT') { if (b.serials !== undefined) fail(400, 'INVALID_SERIALS'); }
      else { if (!Array.isArray(b.serials) || !b.serials.length || b.serials.length > 100 || new Set(b.serials).size !== b.serials.length || amount !== BigInt(b.serials.length) * 1000000n || b.serials.some(s => !context.use.units.some(u => u.serial === s && u.status === 'AVAILABLE'))) fail(400, 'INVALID_SERIALS'); serials = b.serials; }
      sourceSnapshot = { ...source, locationSnapshot: context.opening.balance.locationSnapshot, lotNumber: context.receipt.lotNumber ?? null, heatNumber: context.receipt.heatNumber ?? null };
    }
    claim = { _id: randomUUID(), ...filter, authorityKind: 'REPAIR_CASE', caseId: row._id, materialLineId: material.lineId, authorizationHash: hash(material), authorizedCaseVersion: material.authorizedCaseVersion, sourceKind: material.sourceKind, ...(company ? { companyReceiptId: context.receipt._id, openingHash: context.receipt.contentHash, companyUnitIds } : { receiptId: context.receipt._id, originHash: context.origin.contentHash, openingBalanceHash: context.opening.balance.contentHash }), itemId: material.itemId, itemRevision: material.itemRevision, uom: material.uom, ownerLegalEntityId: material.ownerLegalEntityId, quantity: decimal(amount), serials, status: 'RESERVED', sourceSnapshot, issueId: null, issueHash: null, consumptionId: null, consumptionHash: null, recordedBy: actor, recordedAt: now };
    await sourceQuality(db, filter, material.sourceKind, context.receipt._id, companyUnitIds, session);
    row.manufacturedSpareGenealogy = [...new Map([...(row.manufacturedSpareGenealogy || []), ...graph].map(pointer => [pointer.snapshotId, pointer])).values()];
  } else {
    const ref = row.spareClaims.find(r => r.reservationId === b.reservationId && r.materialLineId === material.lineId);
    if (!ref) fail(404, 'NOT_FOUND');
    context = await read(ref.sourceId);
    if (context.use.version !== b.expectedStockVersion || (!company && context.receipt.version !== b.expectedReceiptVersion)) fail(409, 'VERSION_CONFLICT');
    claim = context.use.reservations.find(r => r._id === ref.reservationId);
    if (!claim || claim.caseId !== row._id || claim.authorityKind !== 'REPAIR_CASE' || claim.version !== b.expectedReservationVersion) fail(409, 'VERSION_CONFLICT');
    if (action !== 'spare-release') await sourceQuality(db, filter, material.sourceKind, context.receipt._id, claim.companyUnitIds || [], session);
    if (action === 'spare-release') { if (claim.status !== 'RESERVED') fail(409, 'STATE_CONFLICT'); claim = { ...claim, status: 'RELEASED' }; }
    else {
      const next = action === 'spare-issue' ? 'ISSUED' : 'CONSUMED';
      if (claim.status !== (next === 'ISSUED' ? 'RESERVED' : 'ISSUED')) fail(409, 'STATE_CONFLICT');
      if (next === 'CONSUMED') {
        if (claim.serials.length > 1) fail(400, 'ONE_COMPONENT_SERIAL_REQUIRED');
        const removal = row.componentRemovals?.find(c => c.componentId === b.removedComponentId && c.component === material.component);
        if (!removal || row.replacements?.some(r => r.removedComponentId === removal.componentId)) fail(409, 'REMOVAL_LINEAGE_REQUIRED');
        if (!['QUARANTINED', 'RETURNED_TO_CUSTOMER', 'SCRAPPED'].includes(removal.status)) invalid();
        row.replacements = [...(row.replacements || []), { _id: randomUUID(), component: material.component, cycle, removedComponentId: removal.componentId, reservationId: claim._id, sourceKind: material.sourceKind, sourceId: ref.sourceId, quantity: claim.quantity, uom: claim.uom, serials: claim.serials, sourceSnapshot: claim.sourceSnapshot, installedBy: actor, installedAt: now, evidence: text(b.evidence) }];
      }
      const movement = { _id: randomUUID(), ...filter, ...repairClaimBinding(claim), materialLineId: claim.materialLineId, sourceKind: claim.sourceKind, itemId: claim.itemId, itemRevision: claim.itemRevision, uom: claim.uom, ownerLegalEntityId: claim.ownerLegalEntityId, reservationId: claim._id, ...(company ? { companyReceiptId: claim.companyReceiptId, openingHash: claim.openingHash, companyUnitIds: claim.companyUnitIds, sourceSnapshot: claim.sourceSnapshot } : { receiptId: claim.receiptId, originHash: claim.originHash }), quantity: claim.quantity, serials: claim.serials, ...(next === 'CONSUMED' ? { issueId: claim.issueId } : {}), recordedBy: actor, recordedAt: now, evidence: text(b.evidence) }; movement.contentHash = hash(movement);
      await db.collection(`${company ? 'company' : 'catalog'}Material${next === 'ISSUED' ? 'Issues' : 'Consumptions'}`).insertOne(movement, { session });
      claim = { ...claim, status: next, ...(next === 'ISSUED' ? { issueId: movement._id, issueHash: movement.contentHash } : { consumptionId: movement._id, consumptionHash: movement.contentHash }) };
    }
  }
  claim.effectCaseVersion = row.version + 1;
  const saved = await (company ? writeCompanyReservation(db, filter, context, claim, actor, text(b.evidence), session) : writeCatalogReservation(db, filter, context, claim, actor, text(b.evidence), session));
  row.spareClaims = [...row.spareClaims.filter(r => r.reservationId !== saved._id), { reservationId: saved._id, materialLineId: saved.materialLineId, sourceKind: material.sourceKind, sourceId: context.receipt._id, version: saved.version, contentHash: saved.contentHash, status: saved.status, quantity: saved.quantity }];
}
export function requireRepairInstallations(row) {
  if (row.decision?.decision !== 'ACCEPT') return;
  if (row.spareClaims?.some(r => !['CONSUMED', 'RELEASED'].includes(r.status))) fail(409, 'REPAIR_SPARES_PENDING');
  if (row.replacementPolicy !== 'CANONICAL_SPARES_V1' && !row.spareMaterials) return;
  const current = (row.replacements || []).filter(r => !row.componentRemovals?.some(c => c.sourceReplacementId === r._id));
  const required = row.scopes?.at(-1)?.findings.filter(f => f.disposition === 'REPLACE') || [];
  if (row.scopes?.at(-1)?.findings.some(f => f.disposition === 'SCRAP' && !row.componentRemovals?.some(c => c.component === f.component))) fail(409, 'COMPONENT_REMOVAL_REQUIRED');
  if (required.some(f => !current.some(r => r.component === f.component)) || row.componentRemovals?.some(c => c.authorizedDisposition !== 'SCRAP' && !row.replacements?.some(r => r.removedComponentId === c.componentId))) fail(409, 'REPLACEMENT_REQUIRED');
}
