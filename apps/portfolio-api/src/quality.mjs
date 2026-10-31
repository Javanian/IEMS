import { randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { stockHash as hash } from './catalog-stock-values.mjs';
import { businessNow } from './business-clock.mjs';
import { gateId, resourceTypes, domainError as fail } from '../../../packages/contracts/src/domains/engineering-repair/gates.mjs';

export const qualityActions = ['quality.read', 'quality.configure', 'quality.hold', 'quality.release', 'quality.calibrate', 'quality.qualify'];
export const qualityRoles = Object.fromEntries(qualityActions.map(action => [`quality${action.split('.')[1][0].toUpperCase()}${action.split('.')[1].slice(1)}`, [...new Set(['quality.read', action])]]));
export const qualityText = value => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000) fail(400, 'INVALID_TEXT'); return value.trim(); };
const scope = req => req.filter;
const resourceKey = (filter, type, resourceId) => gateId(`${filter.tenantId}:${filter.plantId}:${type}`, resourceId);
const empty = (filter, type, resourceId) => ({ _id: resourceKey(filter, type, resourceId), ...filter, schema: 'QUALITY_GATE_V1', resourceType: type, resourceId, version: 0, holds: [], qualifications: [], calibration: null });
export async function initializeQuality(db) {
  for (const [name, keys] of [['qualityResources', { tenantId: 1, plantId: 1, resourceType: 1, resourceId: 1 }], ['qualityKeys', { tenantId: 1, plantId: 1, key: 1 }], ['qualityRevisions', { tenantId: 1, plantId: 1, resourceType: 1, resourceId: 1, version: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
}
export function scopedModule(app, runtime, root, prefix, helpers) {
  const { id, fields, guard } = helpers, db = runtime.db;
  app.use(root, async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.domainAction = `${prefix}.${req.method === 'GET' ? 'read' : req.path.split('/').at(-1)}`;
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.domainAction }); next();
  });
  const transaction = async (req, effect) => {
    const key = req.body.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    if (!Number.isSafeInteger(req.body.expectedVersion) || req.body.expectedVersion < 0) fail(400, 'INVALID_VERSION');
    const payloadHash = hash({ action: req.domainAction, params: req.params, body: req.body });
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await guard(runtime, req, session, req.domainAction);
      const prior = await db.collection(`${prefix}Keys`).findOne({ ...scope(req), key }, { session });
      if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
      const result = await effect(session), event = { ...scope(req), kind: req.domainAction, resourceId: result.resourceId, subjectId: result._id, subjectVersion: result.version, recordedBy: req.scope.userId, recordedAt: businessNow(runtime) };
      await db.collection(`${prefix}Audit`).insertOne({ _id: randomUUID(), ...event }, { session });
      await db.collection(`${prefix}Outbox`).insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
      await db.collection(`${prefix}Keys`).insertOne({ _id: randomUUID(), ...scope(req), key, payloadHash, result }, { session }); return result;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); } finally { await session.endSession(); }
  };
  return { id, fields, transaction };
}
export async function qualityResource(db, filter, type, resourceId, session, fence = false) {
  if (!resourceTypes.includes(type)) fail(400, 'INVALID_RESOURCE_TYPE');
  if (typeof resourceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId)) fail(400, 'INVALID_RESOURCE_ID');
  const key = { ...filter, _id: resourceKey(filter, type, resourceId) };
  if (fence) {
    if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
    return db.collection('qualityResources').findOneAndUpdate(key, { $setOnInsert: empty(filter, type, resourceId), $inc: { useFence: 1 } }, { session, upsert: true, returnDocument: 'after' });
  }
  return await db.collection('qualityResources').findOne(key, { session }) || empty(filter, type, resourceId);
}
export async function requireQualityGates(db, filter, targets, session, { at = new Date() } = {}) {
  if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (!Array.isArray(targets) || targets.length > 100 || !Number.isFinite(new Date(at).getTime())) fail(400, 'INVALID_GATE_TARGETS');
  at = new Date(at);
  const result = [];
  for (const target of targets) {
    const row = await qualityResource(db, filter, target.resourceType, target.resourceId, session, true);
    if (row.holds.some(hold => hold.active)) fail(409, 'QUALITY_HOLD_ACTIVE');
    if (target.expectedVersion !== undefined && target.expectedVersion !== row.version) fail(409, 'QUALITY_VERSION_CONFLICT');
    if (row.disabled) fail(409, 'QUALITY_RESOURCE_DISABLED');
    if (row.resourceType === 'OPERATOR' && target.operation) {
      const member = await db.collection('memberships').findOneAndUpdate({ tenantId: filter.tenantId, userId: row.resourceId, active: true, $or: [{ tenantWide: true }, { plantIds: filter.plantId }] }, { $inc: { qualityFence: 1 } }, { session, returnDocument: 'after' });
      const user = await db.collection('users').findOneAndUpdate({ _id: row.resourceId, active: true }, { $inc: { qualityFence: 1 } }, { session, returnDocument: 'after' });
      if (!member || !user) fail(409, 'QUALIFICATION_REQUIRED');
    }
    if (target.requireCalibration && (row.resourceType !== 'EQUIPMENT' || !row.calibration || new Date(row.calibration.validFrom) > at || new Date(row.calibration.validUntil) <= at)) fail(409, 'CALIBRATION_REQUIRED');
    if (target.operation && (row.resourceType !== 'OPERATOR' || !row.qualifications.some(q => q.operation === target.operation && q.active && new Date(q.validFrom) <= at && new Date(q.validUntil) > at))) fail(409, 'QUALIFICATION_REQUIRED');
    result.push({ resourceType: row.resourceType, resourceId: row.resourceId, version: row.version });
  }
  return result;
}
async function existingTarget(db, filter, type, resourceId, session) {
  const collection = { REPAIR_CASE: 'repairCases', WORK_ORDER: 'manufacturingWorkOrders', COMPANY_UNIT: 'internalCompanyStockUnits', RECEIPT: 'warehouseReceipts' }[type];
  if (collection && !await db.collection(collection).findOne({ ...filter, _id: resourceId }, { session })) fail(404, 'NOT_FOUND');
  if (type === 'OPERATOR' && !await db.collection('memberships').findOne({ tenantId: filter.tenantId, userId: resourceId, active: true, $or: [{ tenantWide: true }, { plantIds: filter.plantId }] }, { session })) fail(404, 'NOT_FOUND');
}
export function installQuality(app, runtime, helpers) {
  const root = '/api/repair/quality', db = runtime.db, { id, fields, transaction } = scopedModule(app, runtime, root, 'quality', helpers);
  app.get(`${root}/resources`, async (req, res) => {
    const filter = { ...scope(req) }; if (req.query.cursor) filter._id = { $gt: qualityText(req.query.cursor) };
    const rows = await db.collection('qualityResources').find(filter).sort({ _id: 1 }).limit(26).toArray();
    res.json({ data: rows.slice(0, 25), page: { nextCursor: rows.length > 25 ? rows[24]._id : null } });
  });
  app.get(`${root}/resources/:type/:id`, async (req, res) => res.json({ data: await qualityResource(db, scope(req), req.params.type, id(req.params.id)) }));
  for (const action of ['configure', 'hold', 'release', 'calibrate', 'qualify']) app.post(`${root}/resources/:type/:id/${action}`, async (req, res) => {
    const extra = { configure: ['label', 'disabled'], hold: ['reasonCode'], release: ['holdId'], calibrate: ['validFrom', 'validUntil', 'certificate'], qualify: ['operation', 'validFrom', 'validUntil', 'active'] }[action];
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'evidence', ...extra]);
    const resourceId = id(req.params.id), type = req.params.type, b = req.body, evidence = qualityText(b.evidence);
    const data = await transaction(req, async session => {
      await existingTarget(db, scope(req), type, resourceId, session);
      const row = await qualityResource(db, scope(req), type, resourceId, session, true);
      if (row.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      const recorded = { evidence, recordedBy: req.scope.userId, recordedAt: businessNow(runtime) };
      if (action === 'configure') { if (typeof b.disabled !== 'boolean') fail(400, 'INVALID_DISABLED'); row.label = qualityText(b.label); row.disabled = b.disabled; }
      if (action === 'hold') {
        if (row.holds.length >= 100) fail(409, 'HOLD_HISTORY_LIMIT');
        if (!['QUALITY_SUSPECT', 'TRACE_REVIEW', 'SAFETY', 'MAINTENANCE'].includes(b.reasonCode)) fail(400, 'INVALID_HOLD_REASON');
        row.holds.push({ _id: randomUUID(), active: true, reasonCode: b.reasonCode, ...recorded });
      }
      if (action === 'release') { const hold = row.holds.find(h => h._id === id(b.holdId) && h.active); if (!hold) fail(409, 'HOLD_CONFLICT'); hold.active = false; hold.released = recorded; }
      if (['calibrate', 'qualify'].includes(action)) {
        const from = Date.parse(b.validFrom), until = Date.parse(b.validUntil);
        if (typeof b.validFrom !== 'string' || typeof b.validUntil !== 'string' || !Number.isFinite(from) || !Number.isFinite(until) || new Date(from).toISOString() !== b.validFrom || new Date(until).toISOString() !== b.validUntil || from >= until || until <= businessNow(runtime).getTime()) fail(400, 'INVALID_VALIDITY_PERIOD');
        if (row.disabled) fail(409, 'QUALITY_RESOURCE_DISABLED');
        if (action === 'calibrate') {
          if (type !== 'EQUIPMENT' || !row.label) fail(409, 'EQUIPMENT_REQUIRED');
          row.calibration = { ...recorded, validFrom: b.validFrom, validUntil: b.validUntil, certificate: qualityText(b.certificate) };
        } else {
          if (type !== 'OPERATOR' || typeof b.active !== 'boolean') fail(400, 'INVALID_QUALIFICATION');
          const operation = qualityText(b.operation), prior = row.qualifications.find(q => q.operation === operation);
          const qualification = { ...recorded, operation, active: b.active, validFrom: b.validFrom, validUntil: b.validUntil };
          if (prior) Object.assign(prior, qualification); else { if (row.qualifications.length >= 100) fail(409, 'QUALIFICATION_LIMIT'); row.qualifications.push(qualification); }
        }
      }
      row.version++; row.updatedAt = businessNow(runtime);
      const saved = await db.collection('qualityResources').replaceOne({ ...scope(req), _id: row._id, version: b.expectedVersion }, row, { session }); if (saved.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await db.collection('qualityRevisions').insertOne({ _id: randomUUID(), ...scope(req), resourceType: type, resourceId, version: row.version, snapshot: row }, { session });
      return row;
    }); res.json({ data });
  });
}
