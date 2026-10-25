import { randomUUID, createHash } from 'node:crypto';
import { saveCatalogOptionProjection } from './catalog-option-index.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';

export const internalPlanningActions = ['master.read', 'master.item.write', 'master.item.approve', 'master.item.deactivate', 'master.location.write', 'master.location.qualify', 'master.location.deactivate', 'internal.read', 'internal.plan', 'internal.engineering.write', 'internal.engineering.approve', 'internal.engineering.revoke', 'internal.cancel'];
export const internalPlanningRoles = {
  masterReader: ['master.read'], masterItemWriter: ['master.read', 'master.item.write'], masterItemApprover: ['master.read', 'master.item.approve'], masterItemDeactivator: ['master.read', 'master.item.deactivate'],
  masterLocationWriter: ['master.read', 'master.location.write'], masterLocationQualifier: ['master.read', 'master.location.qualify'], masterLocationDeactivator: ['master.read', 'master.location.deactivate'],
  internalReader: ['internal.read'], internalPlanner: ['internal.read', 'master.read', 'internal.plan'], internalEngineer: ['internal.read', 'master.read', 'internal.engineering.write'], internalApprover: ['internal.read', 'internal.engineering.approve'], internalRevoker: ['internal.read', 'internal.engineering.revoke'], internalCanceller: ['internal.read', 'internal.cancel'],
};
const HEADS = { ITEM: 'inventoryItems', LOCATION: 'companyLocations', ORDER: 'internalProductionOrders' };
const REVISIONS = { ITEM: 'inventoryItemRevisions', ORDER: 'internalEngineeringRevisions' };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v)) ?? 'undefined').digest('hex');
const semantic = row => Object.fromEntries(Object.entries(row).filter(([k]) => !['useFence', 'eventId', 'authorityHash'].includes(k)));
const revisionContent = row => Object.fromEntries(['_id', 'tenantId', 'plantId', 'ownerLegalEntityId', 'subjectId', 'revision', 'content', 'reason', 'recordedBy', 'recordedAt'].map(k => [k, row[k]]));
const scope = req => req.filter;
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const positive = v => { if (!Number.isSafeInteger(v) || v < 1) fail(400, 'INVALID_VERSION'); return v; };
const text = (v, max = 200, min = 1) => { if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) fail(400, 'INVALID_MASTER'); return v.trim(); };
const code = v => { if (typeof v !== 'string' || !/^[A-Z][A-Z0-9_-]{0,39}$/.test(v)) fail(400, 'INVALID_MASTER'); return v; };
const uom = v => { if (typeof v !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(v)) fail(400, 'INVALID_MASTER'); return v; };
const qty = v => { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(v) || !/[1-9]/.test(v)) fail(400, 'INVALID_INTERNAL_PLAN'); return BigInt(v.split('.')[0]) * 1000000n + BigInt((v.split('.')[1] || '').padEnd(6, '0')); };
const decimal = n => { const s = n.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };

export async function validateInventoryItemAuthority(db, filter, itemId, session) {
  const row = await db.collection('inventoryItems').findOne({ ...filter, _id: itemId }, { session });
  if (!row) fail(404, 'NOT_FOUND');
  const event = await db.collection('internalPlanningEvents').findOne({ ...filter, _id: row.eventId, subjectType: 'ITEM', subjectId: row._id }, { session });
  const rev = await db.collection('inventoryItemRevisions').findOne({ ...filter, subjectId: row._id, revision: row.currentRevision }, { session });
  if (!Number.isSafeInteger(row.version) || row.version < 1 || !Number.isSafeInteger(row.currentRevision) || row.currentRevision < 1 || !['DRAFT', 'APPROVED', 'INACTIVE'].includes(row.status) || !event || event.version !== row.version || event.status !== row.status || event.contentHash !== row.authorityHash || hash(event.snapshot) !== row.authorityHash || hash(semantic(row)) !== row.authorityHash || !rev || hash(revisionContent(rev)) !== rev.contentHash || rev.ownerLegalEntityId !== row.ownerLegalEntityId || row.contentHash !== rev.contentHash || hash(row.content) !== hash(rev.content) || (row.status === 'APPROVED' && (row.approval?.revision !== row.currentRevision || row.approval?.contentHash !== row.contentHash))) fail(409, 'MASTER_SOURCE_INVALID');
  return row;
}
export async function requireCatalogInventoryItem(db, filter, itemId, itemVersion, itemRevision, session, fence = false) {
  const row = await validateInventoryItemAuthority(db, filter, itemId, session);
  if (row.status !== 'APPROVED' || row.version !== itemVersion || row.currentRevision !== itemRevision || row.content.schema !== 'INVENTORY_ITEM_V2' || !['LOT', 'SERIAL'].includes(row.content.trackingPolicy) || row.content.kind !== 'PURCHASED') fail(409, 'CATALOG_DEPENDENCY_CHANGED');
  if (fence) { const result = await db.collection('inventoryItems').updateOne({ ...filter, _id: row._id, version: row.version }, { $inc: { useFence: 1 } }, { session }); if (result.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
  return row;
}

export async function requireInternalExecutionDemand(db, filter, orderId, expectedVersion, engineeringRevision, ownerLegalEntityId, session, fence = false) {
  const row = await db.collection('internalProductionOrders').findOne({ ...filter, _id: orderId }, { session }); if (!row) fail(404, 'NOT_FOUND');
  const event = await db.collection('internalPlanningEvents').findOne({ ...filter, subjectType: 'ORDER', subjectId: row._id, _id: row.eventId }, { session });
  const revision = await db.collection('internalEngineeringRevisions').findOne({ ...filter, subjectId: row._id, revision: row.engineering?.currentRevision }, { session });
  if (!Number.isSafeInteger(row.version) || row.version < 1 || row.ownerLegalEntityId !== ownerLegalEntityId || !event || event.version !== row.version || event.status !== row.status || hash(event.snapshot) !== row.authorityHash || event.contentHash !== row.authorityHash || hash(semantic(row)) !== row.authorityHash || !revision || hash(revisionContent(revision)) !== revision.contentHash || row.engineering.contentHash !== revision.contentHash || hash(row.engineering.content) !== hash(revision.content)) fail(409, 'MASTER_SOURCE_INVALID');
  if (row.schema !== 'INTERNAL_PLAN_V1' || row.purpose !== 'INTERNAL_STOCK' || row.version !== expectedVersion || row.status !== 'PLANNED' || row.engineering.currentRevision !== engineeringRevision || row.engineering.status !== 'APPROVED_DEMAND' || row.engineering.approval?.revision !== engineeringRevision || row.engineering.approval?.contentHash !== revision.contentHash) fail(409, 'INTERNAL_DEMAND_CHANGED');
  const item = await validateInventoryItemAuthority(db, filter, row.itemSnapshot._id, session);
  if (item.status !== 'APPROVED' || item.version !== row.itemSnapshot.version || item.currentRevision !== row.itemSnapshot.currentRevision || item.contentHash !== row.itemSnapshot.contentHash || item.ownerLegalEntityId !== ownerLegalEntityId || item.content.kind !== 'MANUFACTURED' || item.content.schema !== 'INVENTORY_ITEM_V2' || item.content.trackingPolicy !== 'SERIAL') fail(409, 'INTERNAL_DEMAND_CHANGED');
  const location = await requireQualifiedCompanyLocation(db, filter, row.locationSnapshot._id, row.locationSnapshot.version, ownerLegalEntityId, session, fence);
  if (location.authorityHash !== row.locationSnapshot.authorityHash) fail(409, 'INTERNAL_DEMAND_CHANGED');
  for (const material of revision.content.materials) { const source = await requireCatalogInventoryItem(db, filter, material.itemId, material.itemVersion, material.itemRevision, session, fence); if (source.ownerLegalEntityId !== ownerLegalEntityId || source.contentHash !== material.itemSnapshot.contentHash || source.content.uom !== material.uom) fail(409, 'INTERNAL_DEMAND_CHANGED'); }
  if (fence) {
    const changed = await db.collection('internalProductionOrders').updateOne({ ...filter, _id: row._id, version: row.version }, { $inc: { useFence: 1 } }, { session }), itemWrite = await db.collection('inventoryItems').updateOne({ ...filter, _id: item._id, version: item.version }, { $inc: { useFence: 1 } }, { session });
    if (changed.matchedCount !== 1 || itemWrite.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  }
  return { ...semantic(row), authorityHash: row.authorityHash };
}

export async function requireQualifiedCompanyLocation(db, filter, locationId, expectedVersion, ownerLegalEntityId, session, fence = false) {
  const row = await db.collection('companyLocations').findOne({ ...filter, _id: locationId }, { session });
  if (!row) fail(404, 'NOT_FOUND');
  const event = await db.collection('internalPlanningEvents').findOne({ ...filter, _id: row.eventId, subjectType: 'LOCATION', subjectId: row._id }, { session });
  if (!Number.isSafeInteger(row.version) || row.version < 1 || !['DRAFT', 'QUALIFIED', 'INACTIVE'].includes(row.status) || !event || event.version !== row.version || event.status !== row.status || event.contentHash !== row.authorityHash || hash(event.snapshot) !== row.authorityHash || hash(semantic(row)) !== row.authorityHash || row.ownerLegalEntityId !== ownerLegalEntityId) fail(409, 'MASTER_SOURCE_INVALID');
  if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
  if (row.status !== 'QUALIFIED' || !row.qualification) fail(409, 'CATALOG_DEPENDENCY_CHANGED');
  const bin = await db.collection('warehouseBins').findOne({ ...filter, _id: row.binId }, { session });
  if (!bin || !Number.isSafeInteger(bin.version) || bin.version < 1 || typeof bin.code !== 'string' || !bin.code.trim() || (Object.hasOwn(bin, 'active') && bin.active !== true)) fail(409, 'CATALOG_DEPENDENCY_CHANGED');
  if (row.binSnapshot?._id !== bin._id || row.binSnapshot?.version !== bin.version || row.binSnapshot?.code !== bin.code) fail(409, 'CATALOG_DEPENDENCY_CHANGED');
  if (fence) {
    if (!session?.inTransaction()) throw new Error('location fence requires transaction');
    const locationWrite = await db.collection('companyLocations').updateOne({ ...filter, _id: row._id, version: row.version }, { $inc: { useFence: 1 } }, { session });
    const binWrite = await db.collection('warehouseBins').updateOne({ ...filter, _id: bin._id, version: bin.version }, { $inc: { internalPlanningUseFence: 1 } }, { session });
    if (locationWrite.matchedCount !== 1 || binWrite.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  }
  return { ...semantic(row), authorityHash: row.authorityHash };
}

export async function initializeInternalPlanning(db) {
  for (const [name, keys] of [
    ['inventoryItems', { tenantId: 1, plantId: 1, code: 1 }], ['companyLocations', { tenantId: 1, plantId: 1, code: 1 }], ['companyLocations', { tenantId: 1, plantId: 1, binId: 1 }],
    ['inventoryItemRevisions', { tenantId: 1, plantId: 1, subjectId: 1, revision: 1 }], ['internalEngineeringRevisions', { tenantId: 1, plantId: 1, subjectId: 1, revision: 1 }],
    ['internalEngineeringLineIds', { tenantId: 1, plantId: 1, orderId: 1, itemId: 1 }], ['internalPlanningKeys', { tenantId: 1, plantId: 1, key: 1 }],
  ]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('internalPlanningEvents').createIndex({ tenantId: 1, plantId: 1, subjectType: 1, subjectId: 1, _id: 1 });
}

export function installInternalPlanning(app, runtime, { guard, fields, id }) {
  const db = runtime.db, c = name => db.collection(name);
  const owner = async (req, session) => {
    const plant = await c('plants').findOne({ _id: req.filter.plantId, tenantId: req.filter.tenantId, active: true }, { session });
    if (!plant || !await c('legalEntities').findOne({ _id: plant.legalEntityId, tenantId: req.filter.tenantId, active: true }, { session })) fail(403, 'SCOPE_DENIED'); return plant.legalEntityId;
  };
  const find = async (type, req, value, session) => { const row = await c(HEADS[type]).findOne({ ...scope(req), _id: id(value) }, { session }); if (!row) fail(404, 'NOT_FOUND'); await validate(type, row, session); return row; };
  async function revision(type, row, number, session) {
    const result = await c(REVISIONS[type]).findOne({ tenantId: row.tenantId, plantId: row.plantId, subjectId: row._id, revision: number }, { session });
    if (!result || hash(revisionContent(result)) !== result.contentHash || result.ownerLegalEntityId !== row.ownerLegalEntityId) fail(409, 'MASTER_SOURCE_INVALID'); return result;
  }
  async function validate(type, row, session) {
    if (!Number.isSafeInteger(row.version) || row.version < 1 || typeof row.eventId !== 'string') fail(409, 'MASTER_SOURCE_INVALID');
    const event = await c('internalPlanningEvents').findOne({ tenantId: row.tenantId, plantId: row.plantId, _id: row.eventId, subjectType: type, subjectId: row._id }, { session });
    if (!event || event.version !== row.version || event.status !== row.status || event.contentHash !== row.authorityHash || hash(event.snapshot) !== event.contentHash || hash(semantic(row)) !== event.contentHash) fail(409, 'MASTER_SOURCE_INVALID');
    if (type === 'ITEM') {
      if (!['DRAFT', 'APPROVED', 'INACTIVE'].includes(row.status) || !Number.isSafeInteger(row.currentRevision) || row.currentRevision < 1) fail(409, 'MASTER_SOURCE_INVALID');
      const rev = await revision(type, row, row.currentRevision, session);
      if (row.contentHash !== rev.contentHash || hash(row.content) !== hash(rev.content) || (row.status === 'APPROVED' && (row.approval?.revision !== row.currentRevision || row.approval?.contentHash !== row.contentHash))) fail(409, 'MASTER_SOURCE_INVALID');
    } else if (type === 'LOCATION') {
      if (!['DRAFT', 'QUALIFIED', 'INACTIVE'].includes(row.status) || (row.status === 'QUALIFIED' && !row.qualification)) fail(409, 'MASTER_SOURCE_INVALID');
    } else {
      if (!['PLANNED', 'CANCELLED'].includes(row.status) || row.purpose !== 'INTERNAL_STOCK' || row.schema !== 'INTERNAL_PLAN_V1' || !row.engineering || !Number.isSafeInteger(row.engineering.currentRevision) || row.engineering.currentRevision < 0) fail(409, 'MASTER_SOURCE_INVALID');
      const engineering = row.engineering;
      if (!['UNRECORDED', 'DRAFT', 'APPROVED_DEMAND', 'REVOKED'].includes(engineering.status)) fail(409, 'MASTER_SOURCE_INVALID');
      if (engineering.currentRevision) { const rev = await revision(type, row, engineering.currentRevision, session); if (engineering.contentHash !== rev.contentHash || hash(engineering.content) !== hash(rev.content) || (engineering.status === 'APPROVED_DEMAND' && (engineering.approval?.revision !== engineering.currentRevision || engineering.approval?.contentHash !== engineering.contentHash))) fail(409, 'MASTER_SOURCE_INVALID'); }
      else if (engineering.status !== 'UNRECORDED' || engineering.content !== null || engineering.contentHash !== null || engineering.approval !== null) fail(409, 'MASTER_SOURCE_INVALID');
    }
  }
  const use = async (type, row, session) => { const changed = await c(HEADS[type]).updateOne({ _id: row._id, tenantId: row.tenantId, plantId: row.plantId, version: row.version }, { $inc: { useFence: 1 } }, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); };
  const bin = async (req, location, session, fence = false) => {
    const raw = await c('warehouseBins').findOne({ ...scope(req), _id: location.binId }, { session });
    if (!raw || !Number.isSafeInteger(raw.version) || raw.version < 1 || typeof raw.code !== 'string' || !raw.code.trim() || raw.active === false) fail(409, 'MASTER_SOURCE_INVALID');
    if (location.binSnapshot && (location.binSnapshot._id !== raw._id || location.binSnapshot.version !== raw.version || location.binSnapshot.code !== raw.code)) fail(409, 'INTERNAL_DEPENDENCY_CHANGED');
    if (fence) { const changed = await c('warehouseBins').updateOne({ ...scope(req), _id: raw._id, version: raw.version }, { $inc: { internalPlanningUseFence: 1 } }, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
    return { _id: raw._id, version: raw.version, code: raw.code };
  };
  const itemView = async (req, row, session) => ({ ...semantic(row), authorityHash: row.authorityHash, blockers: row.ownerLegalEntityId === await owner(req, session) ? [] : ['OWNER_MISMATCH'] });
  const locationView = async (req, row, session) => {
    const blockers = row.ownerLegalEntityId === await owner(req, session) ? [] : ['OWNER_MISMATCH'];
    try { await bin(req, row, session); } catch (error) { if (!['MASTER_SOURCE_INVALID', 'INTERNAL_DEPENDENCY_CHANGED'].includes(error.code)) throw error; blockers.push('LOCATION_CHANGED'); }
    return { ...semantic(row), authorityHash: row.authorityHash, blockers };
  };
  async function dependencies(req, row, session, fence = false) {
    const blockers = [], currentOwner = await owner(req, session), item = await find('ITEM', req, row.itemSnapshot._id, session), location = await find('LOCATION', req, row.locationSnapshot._id, session);
    if ([row, item, location].some(r => r.ownerLegalEntityId !== currentOwner)) blockers.push('OWNER_MISMATCH');
    if (item.status !== 'APPROVED') blockers.push('ITEM_NOT_APPROVED');
    if (item.version !== row.itemSnapshot.version || item.currentRevision !== row.itemSnapshot.currentRevision || item.contentHash !== row.itemSnapshot.contentHash || item.content.kind !== 'MANUFACTURED') blockers.push('ITEM_CHANGED');
    if (location.status !== 'QUALIFIED') blockers.push('LOCATION_NOT_QUALIFIED');
    if (location.version !== row.locationSnapshot.version || location.authorityHash !== row.locationSnapshot.authorityHash) blockers.push('LOCATION_CHANGED');
    try { await bin(req, location, session, fence && !blockers.length); } catch (error) { if (!['MASTER_SOURCE_INVALID', 'INTERNAL_DEPENDENCY_CHANGED'].includes(error.code)) throw error; blockers.push('LOCATION_CHANGED'); }
    for (const material of row.engineering.content?.materials || []) {
      const source = await find('ITEM', req, material.itemId, session);
      if (source.ownerLegalEntityId !== currentOwner || source.status !== 'APPROVED' || source.version !== material.itemVersion || source.currentRevision !== material.itemRevision || source.contentHash !== material.itemSnapshot.contentHash || source.content.uom !== material.uom) blockers.push('MATERIAL_CHANGED');
      if (fence) await use('ITEM', source, session);
    }
    if (fence) { if (blockers.length) fail(409, 'INTERNAL_DEPENDENCY_CHANGED'); await use('ITEM', item, session); await use('LOCATION', location, session); }
    return [...new Set(blockers)];
  }
  const orderView = async (req, row, session) => {
    const blockers = await dependencies(req, row, session);
    if (row.status === 'CANCELLED') blockers.push('ORDER_CANCELLED');
    if (row.engineering.status !== 'APPROVED_DEMAND') blockers.push('ENGINEERING_NOT_APPROVED');
    return { ...semantic(row), authorityHash: row.authorityHash, blockers, planningReady: blockers.length === 0, execution: 'NOT_IMPLEMENTED', canExecute: false };
  };
  const view = (type, req, row, session) => type === 'ITEM' ? itemView(req, row, session) : type === 'LOCATION' ? locationView(req, row, session) : orderView(req, row, session);
  async function save(type, req, row, previous, kind, reason, session) {
    const snapshot = semantic(row), eventId = randomUUID(), authorityHash = hash(snapshot);
    await c('internalPlanningEvents').insertOne({ _id: eventId, ...scope(req), subjectType: type, subjectId: row._id, version: row.version, kind, status: row.status, contentHash: authorityHash, reason, recordedBy: req.scope.userId, recordedAt: new Date(), snapshot }, { session });
    row.eventId = eventId; row.authorityHash = authorityHash;
    if (previous) { const changed = await c(HEADS[type]).replaceOne({ ...scope(req), _id: row._id, version: previous }, row, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
    else await c(HEADS[type]).insertOne(row, { session });
    if (type === 'ITEM') await saveCatalogOptionProjection(db, 'items', row, session);
    return view(type, req, row, session);
  }
  async function addRevision(type, req, row, revision, content, reason, session) {
    const record = { _id: randomUUID(), ...scope(req), ownerLegalEntityId: row.ownerLegalEntityId, subjectId: row._id, revision, content, reason, recordedBy: req.scope.userId, recordedAt: new Date() };
    record.contentHash = hash(revisionContent(record)); await c(REVISIONS[type]).insertOne(record, { session }); return record;
  }
  const mutation = async (req, kind, effect) => {
    positive(req.body.expectedVersion); const reason = text(req.body.reason, 500, 3), key = req.body.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = hash({ kind, resource: req.params.id || null, body: req.body });
    for (let attempt = 1; ; attempt++) {
      const session = runtime.client.startSession();
      try { return await session.withTransaction(async () => {
        await guard(runtime, req, session, req.planningAction);
        const prior = await c('internalPlanningKeys').findOne({ ...scope(req), key }, { session });
        if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
        const legalEntityId = await owner(req, session), result = await effect(session, reason, legalEntityId);
        const event = { _id: randomUUID(), ...scope(req), kind, subjectId: result._id, version: result.version, recordedBy: req.scope.userId, recordedAt: new Date() };
        await c('internalPlanningAudit').insertOne(event, { session }); await c('internalPlanningOutbox').insertOne({ ...event, _id: randomUUID(), state: 'PENDING' }, { session });
        await c('internalPlanningKeys').insertOne({ _id: randomUUID(), ...scope(req), key, payloadHash, result }, { session }); return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
      catch (error) { if (error.code === 11000 && attempt < 4) continue; if (error.code === 11000) fail(409, 'MASTER_CONFLICT'); throw error; }
      finally { await session.endSession(); }
    }
  };
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  for (const namespace of ['/api/inventory-master', '/api/internal-production']) app.use(namespace, async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    const kind = req.path.split('/')[1], tail = req.path.split('/').at(-1);
    req.planningAction = req.method === 'GET' ? namespace.includes('inventory-master') ? 'master.read' : 'internal.read' : req.method !== 'POST' ? null : kind === 'items' ? `master.item.${tail === 'approve' ? 'approve' : tail === 'deactivate' ? 'deactivate' : 'write'}` : kind === 'locations' ? `master.location.${tail === 'qualify' ? 'qualify' : tail === 'deactivate' ? 'deactivate' : 'write'}` : kind === 'orders' ? req.path.includes('/engineering/') ? `internal.engineering.${tail === 'approve' ? 'approve' : tail === 'revoke' ? 'revoke' : 'write'}` : tail === 'cancel' ? 'internal.cancel' : 'internal.plan' : null;
    if (!req.planningAction) fail(404, 'NOT_FOUND'); await runtime.foundation.authorize(req.scope, { ...scope(req), action: req.planningAction }); next();
  });
  const paths = { ITEM: '/api/inventory-master/items', LOCATION: '/api/inventory-master/locations', ORDER: '/api/internal-production/orders' };
  const pageArgs = req => { const limit = req.query.limit === undefined ? 25 : Number(req.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION'); return { limit, cursor: req.query.cursor === undefined ? null : id(req.query.cursor) }; };
  for (const [type, path] of Object.entries(paths)) {
    app.get(path, async (req, res) => res.json(await read(async session => { const { limit, cursor } = pageArgs(req), rows = await c(HEADS[type]).find({ ...scope(req), ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(), data = []; for (const row of rows.slice(0, limit)) { await validate(type, row, session); data.push(await view(type, req, row, session)); } return { data, page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } }; })));
    app.get(`${path}/:id`, async (req, res) => res.json({ data: await read(async session => view(type, req, await find(type, req, req.params.id, session), session)) }));
    app.get(`${path}/:id/events`, async (req, res) => res.json(await read(async session => { await find(type, req, req.params.id, session); const { limit, cursor } = pageArgs(req), rows = await c('internalPlanningEvents').find({ ...scope(req), subjectType: type, subjectId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(); return { data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } }; })));
    if (type === 'LOCATION') continue;
    const revisionPath = type === 'ORDER' ? `${path}/:id/engineering/revisions` : `${path}/:id/revisions`;
    app.get(revisionPath, async (req, res) => res.json(await read(async session => { await find(type, req, req.params.id, session); const { limit, cursor } = pageArgs(req), rows = await c(REVISIONS[type]).find({ ...scope(req), subjectId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session, projection: { revision: 1, contentHash: 1, recordedBy: 1, recordedAt: 1, reason: 1 } }).sort({ _id: 1 }).limit(limit + 1).toArray(); return { data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } }; })));
    app.get(`${revisionPath}/:revision`, async (req, res) => res.json({ data: await read(async session => { const row = await find(type, req, req.params.id, session); if (!/^[1-9][0-9]*$/.test(req.params.revision) || !Number.isSafeInteger(Number(req.params.revision))) fail(400, 'INVALID_MASTER'); return revision(type, row, Number(req.params.revision), session); }) }));
  }
  const itemContent = b => { if (!['PURCHASED', 'MANUFACTURED'].includes(b.kind)) fail(400, 'INVALID_MASTER'); const v2 = Object.hasOwn(b, 'schema') || Object.hasOwn(b, 'trackingPolicy'); if (v2 && (b.schema !== 'INVENTORY_ITEM_V2' || !['LOT', 'SERIAL'].includes(b.trackingPolicy))) fail(400, 'INVALID_MASTER'); return { description: text(b.description), uom: uom(b.uom), kind: b.kind, ...(v2 ? { schema: b.schema, trackingPolicy: b.trackingPolicy } : {}) }; };
  app.post(paths.ITEM, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey', 'code', 'description', 'uom', 'kind', 'schema', 'trackingPolicy']); const content = itemContent(req.body), itemCode = code(req.body.code);
    const data = await mutation(req, 'item.create', async (session, reason, legalEntityId) => { if (req.body.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT'); const row = { _id: randomUUID(), ...scope(req), ownerLegalEntityId: legalEntityId, version: 1, code: itemCode, status: 'DRAFT', currentRevision: 1, content, approval: null }, rev = await addRevision('ITEM', req, row, 1, content, reason, session); row.contentHash = rev.contentHash; return save('ITEM', req, row, null, 'CREATED', reason, session); }); res.status(201).json({ data });
  });
  for (const action of ['revisions', 'approve', 'deactivate']) app.post(`${paths.ITEM}/:id/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey', ...(action === 'revisions' ? ['description', 'uom', 'kind', 'schema', 'trackingPolicy'] : action === 'approve' ? ['revision'] : [])]); const content = action === 'revisions' ? itemContent(req.body) : null; if (action === 'approve') positive(req.body.revision);
    const data = await mutation(req, `item.${action}`, async (session, reason, legalEntityId) => {
      const row = await find('ITEM', req, req.params.id, session), previous = row.version; if (previous !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT'); if (row.ownerLegalEntityId !== legalEntityId) fail(409, 'MASTER_SOURCE_INVALID'); if (row.status === 'INACTIVE') fail(409, 'STATE_CONFLICT');
      if (action === 'revisions') { if (row.currentRevision >= 100) fail(409, 'REVISION_CONFLICT'); const rev = await addRevision('ITEM', req, row, row.currentRevision + 1, content, reason, session); row.currentRevision++; row.content = content; row.contentHash = rev.contentHash; row.approval = null; row.status = 'DRAFT'; }
      else if (action === 'approve') { if (row.status !== 'DRAFT' || req.body.revision !== row.currentRevision) fail(409, 'REVISION_CONFLICT'); row.status = 'APPROVED'; row.approval = { revision: row.currentRevision, contentHash: row.contentHash, approvedBy: req.scope.userId, approvedAt: new Date() }; }
      else row.status = 'INACTIVE'; row.version++; return save('ITEM', req, row, previous, action.toUpperCase(), reason, session);
    }); res.json({ data });
  });
  app.post(paths.LOCATION, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey', 'code', 'binId']); const locationCode = code(req.body.code), binId = id(req.body.binId);
    const data = await mutation(req, 'location.create', async (session, reason, legalEntityId) => { if (req.body.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT'); const row = { _id: randomUUID(), ...scope(req), ownerLegalEntityId: legalEntityId, version: 1, code: locationCode, binId, status: 'DRAFT', qualification: null }; row.binSnapshot = await bin(req, row, session, true); return save('LOCATION', req, row, null, 'CREATED', reason, session); }); res.status(201).json({ data });
  });
  for (const action of ['qualify', 'deactivate']) app.post(`${paths.LOCATION}/:id/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey']);
    const data = await mutation(req, `location.${action}`, async (session, reason, legalEntityId) => { const row = await find('LOCATION', req, req.params.id, session), previous = row.version; if (previous !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT'); if (row.ownerLegalEntityId !== legalEntityId) fail(409, 'MASTER_SOURCE_INVALID'); if (row.status === 'INACTIVE' || (action === 'qualify' && row.status !== 'DRAFT')) fail(409, 'STATE_CONFLICT'); if (action === 'qualify') await bin(req, row, session, true); row.status = action === 'qualify' ? 'QUALIFIED' : 'INACTIVE'; if (action === 'qualify') row.qualification = { qualifiedBy: req.scope.userId, qualifiedAt: new Date() }; row.version++; return save('LOCATION', req, row, previous, action.toUpperCase(), reason, session); }); res.json({ data });
  });
  app.post(paths.ORDER, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey', 'itemId', 'itemRevision', 'expectedItemVersion', 'locationId', 'expectedLocationVersion', 'quantity']); positive(req.body.itemRevision); positive(req.body.expectedItemVersion); positive(req.body.expectedLocationVersion); const amount = qty(req.body.quantity); if (amount % 1000000n || amount > 100000000n) fail(400, 'INVALID_INTERNAL_PLAN');
    const data = await mutation(req, 'internal.plan', async (session, reason, legalEntityId) => {
      if (req.body.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT');
      const item = await find('ITEM', req, req.body.itemId, session), location = await find('LOCATION', req, req.body.locationId, session);
      if (item.version !== req.body.expectedItemVersion || location.version !== req.body.expectedLocationVersion) fail(409, 'VERSION_CONFLICT');
      if (item.status !== 'APPROVED' || item.currentRevision !== req.body.itemRevision || item.content.kind !== 'MANUFACTURED') fail(409, 'MASTER_NOT_APPROVED');
      if (location.status !== 'QUALIFIED') fail(409, 'LOCATION_NOT_QUALIFIED');
      if (item.ownerLegalEntityId !== legalEntityId || location.ownerLegalEntityId !== legalEntityId) fail(409, 'MASTER_SOURCE_INVALID');
      await use('ITEM', item, session); await use('LOCATION', location, session); await bin(req, location, session, true);
      const row = { _id: randomUUID(), ...scope(req), ownerLegalEntityId: legalEntityId, version: 1, purpose: 'INTERNAL_STOCK', schema: 'INTERNAL_PLAN_V1', status: 'PLANNED', quantity: decimal(amount), itemSnapshot: await itemView(req, item, session), locationSnapshot: await locationView(req, location, session), engineering: { status: 'UNRECORDED', currentRevision: 0, contentHash: null, content: null, approval: null } };
      return save('ORDER', req, row, null, 'PLANNED', reason, session);
    }); res.status(201).json({ data });
  });
  app.post(`${paths.ORDER}/:id/engineering/revisions`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey', 'operations', 'materials']); const b = req.body;
    if (!Array.isArray(b.operations) || !b.operations.length || b.operations.length > 20 || !Array.isArray(b.materials) || !b.materials.length || b.materials.length > 20 || [...b.operations, ...b.materials].some(v => !v || typeof v !== 'object' || Array.isArray(v))) fail(400, 'INVALID_INTERNAL_PLAN');
    const operations = b.operations.map(op => { fields(op, ['code', 'instruction']); return { code: code(op.code), instruction: text(op.instruction, 1000) }; }); if (new Set(operations.map(op => op.code)).size !== operations.length || new Set(b.materials.map(m => m.itemId)).size !== b.materials.length) fail(400, 'INVALID_INTERNAL_PLAN');
    for (const material of b.materials) { fields(material, ['itemId', 'itemRevision', 'expectedItemVersion', 'quantityPerUnit', 'uom']); id(material.itemId); positive(material.itemRevision); positive(material.expectedItemVersion); qty(material.quantityPerUnit); uom(material.uom); }
    const data = await mutation(req, 'internal.engineering.revisions', async (session, reason, legalEntityId) => {
      const row = await find('ORDER', req, req.params.id, session), previous = row.version; if (previous !== b.expectedVersion) fail(409, 'VERSION_CONFLICT'); if (row.status !== 'PLANNED') fail(409, 'STATE_CONFLICT'); if (row.ownerLegalEntityId !== legalEntityId) fail(409, 'MASTER_SOURCE_INVALID');
      const draftBase = { ...row, engineering: { ...row.engineering, content: null } }; await dependencies(req, draftBase, session, true);
      if (row.engineering.currentRevision >= 100) fail(409, 'REVISION_CONFLICT'); const materials = [];
      for (const input of b.materials) {
        if (input.itemId === row.itemSnapshot._id) fail(400, 'INVALID_INTERNAL_PLAN'); const item = await find('ITEM', req, input.itemId, session);
        if (item.ownerLegalEntityId !== legalEntityId || item.status !== 'APPROVED' || item.version !== input.expectedItemVersion || item.currentRevision !== input.itemRevision || item.content.uom !== input.uom) fail(409, 'INTERNAL_DEPENDENCY_CHANGED');
        const product = qty(row.quantity) * qty(input.quantityPerUnit); if (product % 1000000n || product / 1000000n >= 10n ** 24n) fail(400, 'INVALID_INTERNAL_PLAN'); await use('ITEM', item, session);
        let line = await c('internalEngineeringLineIds').findOne({ ...scope(req), orderId: row._id, itemId: item._id }, { session }); if (!line) { line = { _id: randomUUID(), ...scope(req), orderId: row._id, itemId: item._id }; await c('internalEngineeringLineIds').insertOne(line, { session }); }
        materials.push({ lineId: line._id, sourceKind: 'ITEM_REQUIREMENT', itemId: item._id, itemRevision: item.currentRevision, itemVersion: item.version, itemSnapshot: await itemView(req, item, session), quantityPerUnit: decimal(qty(input.quantityPerUnit)), requiredQuantity: decimal(product / 1000000n), uom: input.uom });
      }
      const number = row.engineering.currentRevision + 1, content = { operations, materials }, rev = await addRevision('ORDER', req, row, number, content, reason, session);
      row.engineering = { status: 'DRAFT', currentRevision: number, contentHash: rev.contentHash, content, approval: null }; row.version++; return save('ORDER', req, row, previous, 'ENGINEERING_REVISED', reason, session);
    }); res.json({ data });
  });
  for (const action of ['approve', 'revoke', 'cancel']) app.post(action === 'cancel' ? `${paths.ORDER}/:id/cancel` : `${paths.ORDER}/:id/engineering/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey', ...(action === 'cancel' ? [] : ['revision'])]); if (action !== 'cancel') positive(req.body.revision);
    const data = await mutation(req, `internal.${action}`, async (session, reason, legalEntityId) => {
      const row = await find('ORDER', req, req.params.id, session), previous = row.version; if (previous !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT'); if (row.status !== 'PLANNED') fail(409, 'STATE_CONFLICT'); if (row.ownerLegalEntityId !== legalEntityId) fail(409, 'MASTER_SOURCE_INVALID');
      if (action === 'cancel') row.status = 'CANCELLED';
      else {
        if (row.engineering.currentRevision !== req.body.revision || row.engineering.status !== (action === 'approve' ? 'DRAFT' : 'APPROVED_DEMAND')) fail(409, 'REVISION_CONFLICT');
        if (action === 'approve') { await dependencies(req, row, session, true); row.engineering.status = 'APPROVED_DEMAND'; row.engineering.approval = { revision: row.engineering.currentRevision, contentHash: row.engineering.contentHash, approvedBy: req.scope.userId, approvedAt: new Date() }; }
        else row.engineering.status = 'REVOKED';
      }
      row.version++; return save('ORDER', req, row, previous, action.toUpperCase(), reason, session);
    }); res.json({ data });
  });
}
