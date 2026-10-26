import { randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { validateCatalogReceiptOrigin } from './catalog-procurement.mjs';
import { requireCatalogInventoryItem, requireQualifiedCompanyLocation } from './internal-production.mjs';
import { receiptHoldState, validHoldCache } from './stock-holds.mjs';
import { validateCatalogDispositionState, normalizeCatalogInspection, dispositionHash as hash, dispositionHashless as hashless, dispositionSemantic as semantic, dispositionUnits as units, dispositionDecimal as decimal } from './catalog-disposition-state.mjs';
import { validateCatalogStockUse } from './catalog-stock-use-state.mjs';

export const catalogDispositionActions = ['catalog.qc.read', 'catalog.qc.record', 'catalog.qc.approve', 'catalog.putaway'];
export const catalogDispositionRoles = { catalogQCReader: ['catalog.qc.read'], catalogQCRecorder: ['catalog.qc.read', 'catalog.qc.record'], catalogQCApprover: ['catalog.qc.read', 'catalog.qc.approve'], catalogPutaway: ['catalog.qc.read', 'catalog.putaway'] };
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const stamp = row => ({ ...row, contentHash: hash(row) });

export async function initializeCatalogDisposition(db) {
  for (const [name, keys] of [
    ['catalogDispositionHeads', { tenantId: 1, plantId: 1, receiptId: 1 }], ['catalogInspections', { tenantId: 1, plantId: 1, receiptId: 1, revision: 1 }],
    ['catalogStockBalances', { tenantId: 1, plantId: 1, receiptId: 1 }], ['catalogStockUnits', { tenantId: 1, plantId: 1, receiptId: 1, serial: 1 }],
    ['catalogStockUnits', { tenantId: 1, plantId: 1, registryId: 1 }], ['catalogStockMovements', { tenantId: 1, plantId: 1, receiptId: 1 }], ['catalogDispositionKeys', { tenantId: 1, plantId: 1, key: 1 }],
  ]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('catalogDispositionEvents').createIndex({ tenantId: 1, plantId: 1, receiptId: 1, version: 1 }, { unique: true });
  for (const name of ['catalogDispositionKeys', 'catalogDispositionAudit', 'catalogDispositionOutbox']) await db.collection(name).createIndex({ tenantId: 1, plantId: 1, receiptId: 1 });
}

export function installCatalogDisposition(app, runtime, { guard, fields, id }) {
  const db = runtime.db, c = name => db.collection(name), root = '/api/catalog-disposition/receipts/:id';
  const owner = async (req, session) => { const plant = await c('plants').findOne({ tenantId: req.filter.tenantId, _id: req.filter.plantId, active: true }, { session }); if (!plant || !await c('legalEntities').findOne({ tenantId: req.filter.tenantId, _id: plant.legalEntityId, active: true }, { session })) fail(403, 'SCOPE_DENIED'); return plant.legalEntityId; };
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  app.use('/api/catalog-disposition', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers }); if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.dispositionAction = req.method === 'GET' ? 'catalog.qc.read' : req.method === 'POST' ? /^\/receipts\/[^/]+\/inspections$/.test(req.path) ? 'catalog.qc.record' : /^\/receipts\/[^/]+\/approve$/.test(req.path) ? 'catalog.qc.approve' : /^\/receipts\/[^/]+\/putaway$/.test(req.path) ? 'catalog.putaway' : null : null;
    if (!req.dispositionAction) fail(404, 'NOT_FOUND'); await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.dispositionAction }); next();
  });
  async function context(req, session) {
    const receipt = await c('warehouseReceipts').findOne({ ...req.filter, _id: id(req.params.id) }, { session }); if (!receipt) fail(404, 'NOT_FOUND');
    const origin = await c('warehouseReceiptOrigins').findOne({ ...req.filter, receiptId: receipt._id }, { session }); await validateCatalogReceiptOrigin(db, receipt, origin, session);
    if (origin.source.ownerLegalEntityId !== await owner(req, session)) fail(409, 'CATALOG_SOURCE_INVALID');
    return { receipt, origin, ...await validateCatalogDispositionState(db, receipt, origin, session) };
  }
  async function holds(receipt, session) {
    const state = await receiptHoldState(db, receipt, session), malformed = receipt.hold !== undefined && receipt.hold !== null && !validHoldCache(receipt.hold);
    return { held: state.held || malformed, activeHoldIds: state.activeHolds.map(row => row._id), reasonCodes: [...new Set([...state.activeHolds.map(row => row.reasonCode), ...state.legacy, ...(malformed ? ['INVALID_HOLD_CACHE'] : [])])], legacy: state.legacy.length > 0 || malformed };
  }
  async function live(req, current, session) {
    const blockers = [], sourceHolds = await holds(current.receipt, session), source = current.origin.source;
    if (sourceHolds.held) blockers.push('SOURCE_HELD');
    try { const item = await requireCatalogInventoryItem(db, req.filter, source.itemId, source.itemVersion, source.itemRevision, session); if (item.contentHash !== source.itemContentHash || item.ownerLegalEntityId !== source.ownerLegalEntityId) fail(409, 'MASTER_SOURCE_INVALID'); }
    catch (error) { if (!['CATALOG_DEPENDENCY_CHANGED', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('ITEM_CHANGED'); }
    if (current.head?.status === 'STORED') {
      const location = current.balance.locationSnapshot;
      try { const fresh = await requireQualifiedCompanyLocation(db, req.filter, location._id, location.version, source.ownerLegalEntityId, session); if (fresh.authorityHash !== location.authorityHash) blockers.push('LOCATION_CHANGED'); }
      catch (error) { if (!['CATALOG_DEPENDENCY_CHANGED', 'VERSION_CONFLICT', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('LOCATION_CHANGED'); }
    }
    return { blockers: [...new Set(blockers)], sourceHolds };
  }
  async function view(req, current, session) {
    const { receipt, origin, head, inspection, balance } = current, eligibility = await live(req, current, session), status = head?.status || 'UNRECORDED', accepted = inspection ? units(inspection.content.acceptedQuantity) : 0n, blockers = [...eligibility.blockers];
    const use = await validateCatalogStockUse(db, receipt, origin, current, session);
    if (status !== 'STORED') blockers.push(inspection && head.status !== 'DRAFT' && accepted === 0n ? 'ALL_REJECTED' : 'NOT_STORED');
    const eligible = status === 'STORED' && !eligibility.blockers.length;
    return { receiptId: receipt._id, receiptVersion: receipt.version, receipt: Object.fromEntries(['_id', 'status', 'quantity', 'uom', 'serials', 'lotNumber', 'heatNumber', 'availableQuantity', 'reservedQuantity'].filter(key => Object.hasOwn(receipt, key)).map(key => [key, receipt[key]])), version: head?.version || 1, status, currentRevision: head?.currentRevision || 0, originHash: origin.contentHash, source: origin.source, trackingPolicy: origin.source.trackingPolicy, receivedQuantity: decimal(units(receipt.quantity)), inspection: inspection ? { revision: inspection.revision, contentHash: inspection.contentHash, content: inspection.content, recordedBy: inspection.recordedBy, recordedAt: inspection.recordedAt, reason: inspection.reason } : null, approval: head?.approval || null, openingStock: balance, openingUnits: current.units, stock: balance ? { ...balance, onHandQuantity: use.onHandQuantity, reservedQuantity: use.reservedQuantity, issuedQuantity: use.issuedQuantity, consumedQuantity: use.consumedQuantity, ...(use.shippedQuantity !== undefined ? { shippedQuantity: use.shippedQuantity } : {}), availableQuantity: use.availableQuantity, physicalAvailableQuantity: use.onHandQuantity, eligibleQuantity: eligible ? use.availableQuantity : '0' } : null, units: use.units.map(unit => ({ ...unit, eligible: eligible && unit.status === 'AVAILABLE' })), sourceHolds: eligibility.sourceHolds, blockers, canRecord: ['UNRECORDED', 'DRAFT'].includes(status) && (head?.currentRevision || 0) < 100, canApprove: status === 'DRAFT' && !eligibility.blockers.length, canPutaway: status === 'APPROVED' && accepted > 0n && !eligibility.blockers.length, canAllocate: false, canExecute: false };
  }
  async function requireFresh(req, current, session) {
    if ((await holds(current.receipt, session)).held) fail(409, 'STOCK_ENCUMBERED');
    const source = current.origin.source, item = await requireCatalogInventoryItem(db, req.filter, source.itemId, source.itemVersion, source.itemRevision, session, true);
    if (item.ownerLegalEntityId !== source.ownerLegalEntityId || item.contentHash !== source.itemContentHash) fail(409, 'MASTER_SOURCE_INVALID');
  }
  async function save(req, current, head, kind, reason, session) {
    const previous = current.head?.version, eventId = randomUUID(), snapshot = semantic(head); head.eventId = eventId; head.authorityHash = hash(snapshot);
    await c('catalogDispositionEvents').insertOne({ _id: eventId, ...req.filter, receiptId: current.receipt._id, version: head.version, status: head.status, kind, reason, recordedBy: req.scope.userId, recordedAt: new Date(), snapshot, contentHash: head.authorityHash }, { session });
    if (previous) { const changed = await c('catalogDispositionHeads').replaceOne({ ...req.filter, _id: head._id, version: previous }, head, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
    else await c('catalogDispositionHeads').insertOne(head, { session });
    const status = head.status === 'STORED' ? 'CATALOG_STORED' : head.status === 'APPROVED' ? units(head.content.acceptedQuantity) > 0n ? 'CATALOG_QC_APPROVED' : 'CATALOG_REJECTED' : 'QUARANTINED', marker = { headId: head._id, version: head.version, authorityHash: head.authorityHash };
    const receiptWrite = await c('warehouseReceipts').updateOne({ ...req.filter, _id: current.receipt._id, version: current.receipt.version }, { $set: { status, catalogDisposition: marker }, $inc: { version: 1 } }, { session }); if (receiptWrite.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
    const receipt = { ...current.receipt, status, catalogDisposition: marker, version: current.receipt.version + 1 }, stored = await validateCatalogDispositionState(db, receipt, current.origin, session);
    return view(req, { receipt, origin: current.origin, ...stored }, session);
  }
  async function mutation(req, kind, effect) {
    const body = req.body, key = body.idempotencyKey;
    if (!positive(body.expectedVersion) || !positive(body.expectedReceiptVersion)) fail(400, 'INVALID_VERSION');
    if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 500) fail(400, 'INVALID_REASON');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = hash({ kind, resource: req.params.id, body });
    for (let attempt = 0; ; attempt++) {
      const session = runtime.client.startSession();
      try { return await session.withTransaction(async () => {
        await guard(runtime, req, session, req.dispositionAction);
        const prior = await c('catalogDispositionKeys').findOne({ ...req.filter, key }, { session }); if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
        const current = await context(req, session);
        if ((current.head?.version || 1) !== body.expectedVersion || current.receipt.version !== body.expectedReceiptVersion) fail(409, 'VERSION_CONFLICT');
        const result = await effect(current, body.reason.trim(), session), event = { ...req.filter, kind, receiptId: result.receiptId, version: result.version, receiptVersion: result.receiptVersion, recordedBy: req.scope.userId, recordedAt: new Date() };
        await c('catalogDispositionAudit').insertOne({ _id: randomUUID(), ...event }, { session }); await c('catalogDispositionOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await c('catalogDispositionKeys').insertOne({ _id: randomUUID(), ...req.filter, receiptId: result.receiptId, key, payloadHash, result }, { session }); return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
      catch (error) { if (error.code === 11000 && attempt < 3) continue; if (error.code === 11000) fail(409, 'CATALOG_DISPOSITION_STATE_CONFLICT'); throw error; }
      finally { await session.endSession(); }
    }
  }
  app.get(root, async (req, res) => res.json({ data: await read(async session => view(req, await context(req, session), session)) }));
  const args = req => { const limit = req.query.limit === undefined ? 25 : Number(req.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION'); return { limit, cursor: req.query.cursor === undefined ? null : id(req.query.cursor) }; };
  for (const [path, name] of [['inspections', 'catalogInspections'], ['events', 'catalogDispositionEvents'], ['stock-movements', 'catalogStockMovements']]) app.get(`${root}/${path}`, async (req, res) => res.json(await read(async session => { await context(req, session); const { limit, cursor } = args(req), rows = await c(name).find({ ...req.filter, receiptId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session, ...(path === 'inspections' ? { projection: { revision: 1, contentHash: 1, reason: 1, recordedBy: 1, recordedAt: 1 } } : {}) }).sort({ _id: 1 }).limit(limit + 1).toArray(); return { data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } }; })));
  app.get(`${root}/inspections/:revision`, async (req, res) => res.json({ data: await read(async session => { await context(req, session); const number = Number(req.params.revision); if (!positive(number) || !/^[1-9][0-9]*$/.test(req.params.revision)) fail(400, 'INVALID_REVISION'); const row = await c('catalogInspections').findOne({ ...req.filter, receiptId: req.params.id, revision: number }, { session }); if (!row) fail(404, 'NOT_FOUND'); return row; }) }));
  const common = ['expectedVersion', 'expectedReceiptVersion', 'reason', 'idempotencyKey'];
  app.post(`${root}/inspections`, async (req, res) => {
    fields(req.body, [...common, 'acceptedQuantity', 'rejectedQuantity', 'acceptedSerials', 'rejectedSerials', 'evidence']);
    const data = await mutation(req, 'catalog.inspection.record', async (current, reason, session) => {
      if (current.head && current.head.status !== 'DRAFT') fail(409, 'CATALOG_DISPOSITION_STATE_CONFLICT'); if ((current.head?.currentRevision || 0) >= 100) fail(409, 'REVISION_CONFLICT');
      const content = normalizeCatalogInspection(current.receipt, req.body), revision = (current.head?.currentRevision || 0) + 1, inspection = stamp({ _id: randomUUID(), ...req.filter, receiptId: current.receipt._id, originHash: current.origin.contentHash, revision, content, reason, recordedBy: req.scope.userId, recordedAt: new Date() });
      await c('catalogInspections').insertOne(inspection, { session });
      const head = { _id: current.receipt._id, ...req.filter, receiptId: current.receipt._id, originHash: current.origin.contentHash, version: (current.head?.version || 1) + 1, status: 'DRAFT', currentRevision: revision, inspectionHash: inspection.contentHash, content, approval: null, balanceHash: null, unitHashes: [], putaway: null };
      return save(req, current, head, 'INSPECTION_RECORDED', reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/approve`, async (req, res) => {
    fields(req.body, [...common, 'revision']); if (!positive(req.body.revision)) fail(400, 'INVALID_REVISION');
    const data = await mutation(req, 'catalog.inspection.approve', async (current, reason, session) => {
      if (current.head?.status !== 'DRAFT') fail(409, 'CATALOG_DISPOSITION_STATE_CONFLICT'); if (req.body.revision !== current.head.currentRevision) fail(409, 'REVISION_CONFLICT'); await requireFresh(req, current, session);
      const { origin, receipt, inspection } = current, source = origin.source, content = inspection.content, time = new Date(), refs = [];
      const binding = { ...req.filter, receiptId: receipt._id, originHash: origin.contentHash, inspectionRevision: inspection.revision, inspectionHash: inspection.contentHash, ownerLegalEntityId: source.ownerLegalEntityId, itemId: source.itemId, itemRevision: source.itemRevision, uom: source.uom };
      const balance = stamp({ _id: randomUUID(), ...binding, trackingPolicy: source.trackingPolicy, version: 1, receivedQuantity: decimal(units(receipt.quantity)), acceptedQuantity: content.acceptedQuantity, rejectedQuantity: content.rejectedQuantity, acceptedPendingQuantity: content.acceptedQuantity, storedQuantity: '0', availableQuantity: '0', locationSnapshot: null }); await c('catalogStockBalances').insertOne(balance, { session });
      if (source.trackingPolicy === 'SERIAL') {
        const registry = await c('warehouseSerials').find({ ...req.filter, receiptId: receipt._id }, { session }).toArray();
        for (const serial of receipt.serials) { const identity = registry.find(row => row.serial === serial), unit = stamp({ _id: randomUUID(), ...binding, registryId: identity._id, serial, version: 1, status: content.acceptedSerials.includes(serial) ? 'ACCEPTED_QUARANTINE' : 'REJECTED_QUARANTINE', locationSnapshot: null }); await c('catalogStockUnits').insertOne(unit, { session }); refs.push({ unitId: unit._id, contentHash: unit.contentHash }); }
      }
      const head = { ...semantic(current.head), version: current.head.version + 1, status: 'APPROVED', approval: { revision: inspection.revision, contentHash: inspection.contentHash, approvedBy: req.scope.userId, approvedAt: time }, balanceHash: balance.contentHash, unitHashes: refs };
      return save(req, current, head, 'INSPECTION_APPROVED', reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/putaway`, async (req, res) => {
    fields(req.body, [...common, 'locationId', 'expectedLocationVersion']); id(req.body.locationId); if (!positive(req.body.expectedLocationVersion)) fail(400, 'INVALID_VERSION');
    const data = await mutation(req, 'catalog.stock.putaway', async (current, reason, session) => {
      if (current.head?.status !== 'APPROVED' || units(current.inspection.content.acceptedQuantity) === 0n) fail(409, 'CATALOG_DISPOSITION_STATE_CONFLICT'); await requireFresh(req, current, session);
      const location = await requireQualifiedCompanyLocation(db, req.filter, req.body.locationId, req.body.expectedLocationVersion, current.origin.source.ownerLegalEntityId, session, true), time = new Date(), accepted = current.inspection.content.acceptedQuantity;
      const balance = stamp({ ...hashless(current.balance), version: 2, acceptedPendingQuantity: '0', storedQuantity: accepted, availableQuantity: accepted, locationSnapshot: location });
      const changed = await c('catalogStockBalances').replaceOne({ ...req.filter, _id: balance._id, version: current.balance.version }, balance, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      const refs = [];
      for (const previous of current.units) {
        let unit = previous;
        if (previous.status === 'ACCEPTED_QUARANTINE') { unit = stamp({ ...hashless(previous), version: 2, status: 'AVAILABLE', locationSnapshot: location }); const changedUnit = await c('catalogStockUnits').replaceOne({ ...req.filter, _id: previous._id, version: previous.version }, unit, { session }); if (changedUnit.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
        refs.push({ unitId: unit._id, contentHash: unit.contentHash });
      }
      const movement = stamp({ _id: randomUUID(), ...req.filter, receiptId: current.receipt._id, originHash: current.origin.contentHash, inspectionRevision: current.inspection.revision, inspectionHash: current.inspection.contentHash, kind: 'PUTAWAY', quantity: accepted, serials: current.inspection.content.acceptedSerials || [], locationSnapshot: location, recordedBy: req.scope.userId, recordedAt: time, reason }); await c('catalogStockMovements').insertOne(movement, { session });
      const head = { ...semantic(current.head), version: current.head.version + 1, status: 'STORED', balanceHash: balance.contentHash, unitHashes: refs, putaway: { movementId: movement._id, contentHash: movement.contentHash, locationSnapshot: location, storedBy: req.scope.userId, storedAt: time } };
      return save(req, current, head, 'ACCEPTED_STOCK_PUTAWAY', reason, session);
    }); res.json({ data });
  });
}
