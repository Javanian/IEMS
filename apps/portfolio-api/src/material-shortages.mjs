import { randomUUID } from 'node:crypto';
import { requireInternalExecutionDemand as requireApprovedInternalDemand } from './internal-production.mjs';
import { catalogStockContext, catalogStockView } from './catalog-stock.mjs';
import { stockHash as hash, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { createCatalogRequestFromShortage, cancelCatalogShortageRequest } from './catalog-procurement.mjs';

const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const options = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
const checked = value => { try { return units(value); } catch { fail(400, 'INVALID_QUANTITY'); } };
const keyOf = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) fail(400, 'INVALID_IDEMPOTENCY_KEY'); return value; };
const reasonOf = value => { if (typeof value !== 'string' || value.trim().length < 3 || value.length > 500) fail(400, 'INVALID_REASON'); return value.trim(); };
export const materialDemandKind = value => {
  if (value === undefined) return 'INTERNAL_PRODUCTION';
  if (!['INTERNAL_PRODUCTION', 'SALES_ORDER_WORK_ORDER'].includes(value)) fail(400, 'INVALID_DEMAND_KIND');
  return value;
};
const identity = row => ({ tenantId: row.tenantId, plantId: row.plantId, ownerLegalEntityId: row.ownerLegalEntityId, demandKind: materialDemandKind(row.demandKind), demandId: row.demandId, materialLineId: row.materialLineId });
function verify(snapshot) {
  const { authorityHash, ...body } = snapshot;
  if (authorityHash !== hash(body)) fail(409, 'SHORTAGE_SOURCE_INVALID');
  return snapshot;
}
export async function initializeMaterialShortages(db) {
  await db.collection('materialShortageHeads').createIndex({ tenantId: 1, plantId: 1, ownerLegalEntityId: 1, demandKind: 1, demandId: 1, materialLineId: 1 }, { unique: true });
  await db.collection('materialShortageRevisions').createIndex({ tenantId: 1, plantId: 1, sourceId: 1, revision: 1 }, { unique: true });
  await db.collection('materialShortageKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('materialShortageClaims').createIndex({ tenantId: 1, plantId: 1, claimId: 1 }, { unique: true });
}
async function owner(db, filter, session) {
  const plant = await db.collection('plants').findOne({ tenantId: filter.tenantId, _id: filter.plantId, active: true }, { session });
  if (!plant || !await db.collection('legalEntities').findOne({ tenantId: filter.tenantId, _id: plant.legalEntityId, active: true }, { session })) fail(403, 'SCOPE_DENIED');
  return plant.legalEntityId;
}
async function observe(db, filter, demand, line, sourceId, revision, session, fence) {
  const item = line.itemSnapshot;
  if (item.content.kind !== 'PURCHASED' || line.sourceKind === 'COMPANY_OUTPUT') fail(409, 'NON_PURCHASED_MATERIAL');
  const origins = await db.collection('warehouseReceiptOrigins').find({ ...filter, originType: 'CATALOG_PURCHASE', 'source.itemId': line.itemId }, { session }).limit(501).toArray();
  if (origins.length > 500) fail(409, 'SHORTAGE_EVIDENCE_LIMIT');
  const seen = new Set(), stockEvidence = []; let eligible = 0n;
  for (const origin of origins) {
    if (seen.has(origin.receiptId)) fail(409, 'SHORTAGE_SOURCE_INVALID'); seen.add(origin.receiptId);
    const context = await catalogStockContext(db, filter, origin.receiptId, session, { fence });
    const view = catalogStockView(context), blockers = [...view.blockers];
    if (view.source.ownerLegalEntityId !== demand.ownerLegalEntityId) blockers.push('OWNER_MISMATCH');
    if (view.receipt.uom !== line.uom) blockers.push('UOM_MISMATCH');
    if (view.source.itemVersion !== line.itemVersion || view.source.itemRevision !== line.itemRevision || view.source.itemContentHash !== item.contentHash) blockers.push('ITEM_CHANGED');
    const quantity = blockers.length ? '0' : view.eligibleQuantity;
    eligible += checked(quantity);
    const evidence = { receiptId: origin.receiptId, receiptVersion: view.receiptVersion, useVersion: view.version, holdIds: view.sourceHolds.activeHoldIds, eligibleQuantity: quantity, blockers, originHash: origin.contentHash };
    stockEvidence.push({ ...evidence, evidenceHash: hash(evidence) });
  }
  const claims = await db.collection('materialShortageClaims').find({ ...filter, sourceId, status: 'ACTIVE' }, { session }).limit(501).toArray();
  if (claims.length > 500) fail(409, 'SHORTAGE_CLAIM_LIMIT');
  let active = 0n;
  for (const claim of claims) {
    if (claim.contentHash !== hash(claim.snapshot) || claim.snapshot.quantity !== claim.quantity || claim.snapshot.sourceId !== sourceId) fail(409, 'SHORTAGE_SOURCE_INVALID');
    active += checked(claim.quantity);
  }
  const required = checked(line.requiredQuantity), uncovered = required - eligible - active;
  const snapshot = { schema: 'MATERIAL_SHORTAGE_V1', ...filter, sourceId, revision, ownerLegalEntityId: demand.ownerLegalEntityId, demandKind: materialDemandKind(demand.demandKind), demandId: demand._id, demandVersion: demand.version, engineeringRevision: demand.engineering.currentRevision, materialLineId: line.lineId, itemId: line.itemId, itemVersion: line.itemVersion, itemRevision: line.itemRevision, itemContentHash: item.contentHash, uom: line.uom, requiredQuantity: decimal(required), eligibleQuantity: decimal(eligible), activeClaimQuantity: decimal(active), shortageQuantity: decimal(uncovered > 0n ? uncovered : 0n), stockEvidence: stockEvidence.sort((a, b) => a.receiptId.localeCompare(b.receiptId)), observedAt: new Date() };
  return { ...snapshot, authorityHash: hash(snapshot) };
}
async function demandFor(db, filter, input, session) {
  const kind = materialDemandKind(input.demandKind), legalEntityId = await owner(db, filter, session);
  if (kind === 'SALES_ORDER_WORK_ORDER') {
    const { requireApprovedSalesOrderWorkOrderDemand } = await import('./manufacturing.mjs');
    return requireApprovedSalesOrderWorkOrderDemand(db, filter, input.demandId, input.expectedDemandVersion, input.engineeringRevision, legalEntityId, session, true);
  }
  const demand = await requireApprovedInternalDemand(db, filter, input.demandId, input.expectedDemandVersion, input.engineeringRevision, legalEntityId, session, true);
  return { ...demand, demandKind: kind };
}
export async function refreshShortage(db, filter, input, actor, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (!positive(input.expectedDemandVersion) || !positive(input.engineeringRevision) || !Number.isSafeInteger(input.expectedShortageRevision) || input.expectedShortageRevision < 0) fail(400, 'INVALID_VERSION');
  const demand = await demandFor(db, filter, input, session), snapshots = [];
  const materials = input.materialLineId ? demand.engineering.content.materials.filter(line => line.lineId === input.materialLineId) : demand.engineering.content.materials;
  if (input.materialLineId && !materials.length) fail(404, 'MATERIAL_LINE_NOT_FOUND');
  for (const line of materials) {
    if (line.sourceKind === 'COMPANY_OUTPUT' || line.itemSnapshot.content.kind !== 'PURCHASED') continue;
    const demandKey = identity({ ...filter, ownerLegalEntityId: demand.ownerLegalEntityId, demandKind: demand.demandKind, demandId: demand._id, materialLineId: line.lineId });
    const head = await db.collection('materialShortageHeads').findOne(demandKey, { session });
    if ((head?.revision || 0) !== input.expectedShortageRevision) fail(409, 'SHORTAGE_REVISION_CONFLICT');
    if (head) verify(head.snapshot);
    const sourceId = head?._id || randomUUID(), snapshot = await observe(db, filter, demand, line, sourceId, (head?.revision || 0) + 1, session, true);
    await db.collection('materialShortageRevisions').insertOne({ _id: randomUUID(), ...filter, sourceId, revision: snapshot.revision, snapshot, reason: input.reason, recordedBy: actor }, { session });
    const next = { _id: sourceId, ...demandKey, revision: snapshot.revision, version: (head?.version || 0) + 1, snapshot };
    if (head) { const result = await db.collection('materialShortageHeads').replaceOne({ ...filter, _id: sourceId, version: head.version }, next, { session }); if (result.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
    else await db.collection('materialShortageHeads').insertOne(next, { session });
    snapshots.push(snapshot);
  }
  return { snapshots, blockers: snapshots.length ? [] : ['NO_PURCHASED_MATERIALS'] };
}
export async function claimShortage(db, filter, input, actor, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const head = await db.collection('materialShortageHeads').findOne({ ...filter, _id: input.sourceId }, { session });
  if (!head) fail(404, 'NOT_FOUND');
  const source = verify(head.snapshot), amount = checked(input.quantity);
  if (source.revision !== input.sourceRevision || source.authorityHash !== input.sourceHash || source.materialLineId !== input.materialLineId) fail(409, 'SHORTAGE_REVISION_CONFLICT');
  if (amount <= 0n || amount > checked(source.shortageQuantity)) fail(409, 'QUANTITY_EXCEEDED');
  const demand = await demandFor(db, filter, { demandKind: source.demandKind, demandId: source.demandId, expectedDemandVersion: source.demandVersion, engineeringRevision: source.engineeringRevision }, session);
  const line = demand.engineering.content.materials.find(row => row.lineId === source.materialLineId);
  if (!line) fail(409, 'INTERNAL_DEMAND_CHANGED');
  const current = await observe(db, filter, demand, line, source.sourceId, source.revision, session, true);
  if (amount > checked(current.shortageQuantity)) fail(409, 'QUANTITY_EXCEEDED');
  const requestId = randomUUID(), lineId = randomUUID(), claimId = randomUUID();
  const changed = await db.collection('materialShortageHeads').updateOne({ ...filter, _id: head._id, version: head.version }, { $inc: { version: 1 } }, { session });
  if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  const linkage = { sourceId: source.sourceId, sourceRevision: source.revision, sourceHash: source.authorityHash, materialLineId: source.materialLineId, claimId };
  const result = await createCatalogRequestFromShortage(db, filter, { ...source, requestId, lineId, quantity: decimal(amount), vendorId: input.vendorId, pricing: input.pricing, shortageSource: linkage, reason: input.reason }, actor, session);
  const snapshot = { ...linkage, ...filter, quantity: decimal(amount), requestId, requestLineId: lineId, evidence: current, reason: input.reason, recordedBy: actor, recordedAt: new Date() };
  await db.collection('materialShortageClaims').insertOne({ _id: claimId, ...filter, claimId, sourceId: source.sourceId, requestId, quantity: snapshot.quantity, status: 'ACTIVE', version: 1, snapshot, contentHash: hash(snapshot) }, { session });
  return { ...result, ...linkage, quantity: snapshot.quantity };
}
export function installMaterialShortages(app, runtime, { guard, fields, id }) {
  const db = runtime.db, root = '/api/procurement/material-shortages';
  const authorize = async (req, session, read = false) => {
    for (const action of read ? ['procurement.read', 'manufacturing.read', 'catalog.stock.read'] : ['procurement.write', 'manufacturing.plan', 'catalog.stock.read', 'catalog.write']) await guard(runtime, req, session, action);
  };
  const command = async (req, operation, effect) => {
    const key = keyOf(req.body.idempotencyKey), reason = reasonOf(req.body.reason), payloadHash = hash({ operation, resource: req.params.sourceId || null, body: { ...req.body, reason } });
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await authorize(req, session);
      const previous = await db.collection('materialShortageKeys').findOne({ ...req.filter, key }, { session });
      if (previous) {
        if (previous.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
        if (operation === 'refreshed' && materialDemandKind(req.body.demandKind) === 'SALES_ORDER_WORK_ORDER') await demandFor(db, req.filter, req.body, session);
        if (operation === 'claimed') {
          const sourceHead = await db.collection('materialShortageHeads').findOne({ ...req.filter, _id: req.body.sourceId }, { session });
          if (!sourceHead) fail(409, 'SHORTAGE_SOURCE_INVALID');
          const source = verify(sourceHead.snapshot);
          if (materialDemandKind(source.demandKind) === 'SALES_ORDER_WORK_ORDER') await demandFor(db, req.filter, { demandKind: source.demandKind, demandId: source.demandId, expectedDemandVersion: source.demandVersion, engineeringRevision: source.engineeringRevision }, session);
        }
        return previous.result;
      }
      const result = await effect(session, { ...req.body, reason });
      const event = { _id: randomUUID(), ...req.filter, kind: `materialShortage.${operation}`, result, userId: req.scope.userId, occurredAt: new Date() };
      await db.collection('procurementAudit').insertOne(event, { session });
      await db.collection('procurementOutbox').insertOne({ ...event, state: 'PENDING' }, { session });
      await db.collection('materialShortageKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, result }, { session });
      return result;
    }, options); } finally { await session.endSession(); }
  };
  app.post(`${root}/refresh`, async (req, res) => {
    fields(req.body, ['demandKind', 'demandId', 'expectedDemandVersion', 'engineeringRevision', 'expectedShortageRevision', 'materialLineId', 'reason', 'idempotencyKey']); id(req.body.demandId); materialDemandKind(req.body.demandKind);
    if (req.body.materialLineId !== undefined) id(req.body.materialLineId);
    res.json({ data: await command(req, 'refreshed', (session, input) => refreshShortage(db, req.filter, input, req.scope.userId, session)) });
  });
  app.get(`${root}/:sourceId`, async (req, res) => {
    const session = runtime.client.startSession();
    try { res.json({ data: await session.withTransaction(async () => {
      await authorize(req, session, true);
      const head = await db.collection('materialShortageHeads').findOne({ ...req.filter, _id: id(req.params.sourceId) }, { session });
      if (!head) fail(404, 'NOT_FOUND'); verify(head.snapshot);
      const claims = await db.collection('materialShortageClaims').find({ ...req.filter, sourceId: head._id }, { session }).limit(501).toArray();
      if (claims.length > 500) fail(409, 'SHORTAGE_CLAIM_LIMIT');
      return { snapshot: head.snapshot, claims };
    }, options) }); } finally { await session.endSession(); }
  });
  app.post('/api/procurement/requests/from-shortage', async (req, res) => {
    fields(req.body, ['sourceId', 'sourceRevision', 'sourceHash', 'materialLineId', 'quantity', 'vendorId', 'pricing', 'reason', 'idempotencyKey']);
    id(req.body.sourceId); id(req.body.materialLineId); id(req.body.vendorId); fields(req.body.pricing, ['unitPrice', 'currency', 'taxPolicy', 'roundingPolicy']);
    res.status(201).json({ data: await command(req, 'claimed', (session, input) => claimShortage(db, req.filter, input, req.scope.userId, session)) });
  });
  app.post(`${root}/:sourceId/release`, async (req, res) => {
    fields(req.body, ['claimId', 'expectedClaimVersion', 'expectedRequestVersion', 'reason', 'idempotencyKey']);
    res.json({ data: await command(req, 'released', async (session, input) => {
      const claim = await db.collection('materialShortageClaims').findOne({ ...req.filter, _id: id(input.claimId), sourceId: id(req.params.sourceId) }, { session });
      if (!claim) fail(404, 'NOT_FOUND');
      if (claim.contentHash !== hash(claim.snapshot) || claim.snapshot.requestId !== claim.requestId || claim.snapshot.quantity !== claim.quantity) fail(409, 'SHORTAGE_SOURCE_INVALID');
      if (claim.status !== 'ACTIVE' || claim.version !== input.expectedClaimVersion) fail(409, 'VERSION_CONFLICT');
      const request = await cancelCatalogShortageRequest(db, req.filter, claim.requestId, input.expectedRequestVersion, claim.claimId, req.scope.userId, input.reason, session);
      const changed = await db.collection('materialShortageClaims').updateOne({ ...req.filter, _id: claim._id, version: claim.version }, { $set: { status: 'RELEASED', release: { reason: input.reason, recordedBy: req.scope.userId, recordedAt: new Date() } }, $inc: { version: 1 } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await db.collection('materialShortageHeads').updateOne({ ...req.filter, _id: claim.sourceId }, { $inc: { version: 1 } }, { session });
      return { sourceId: claim.sourceId, claimId: claim.claimId, requestId: request._id, requestVersion: request.version, status: 'RELEASED' };
    }) });
  });
}
