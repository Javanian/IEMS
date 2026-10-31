import { randomUUID } from 'node:crypto';
import { businessNow } from './business-clock.mjs';
import { scopedModule, qualityText, qualityResource, requireQualityGates } from './quality.mjs';
import { capacityFor, utcMinute, gateId, domainError as fail } from '../../../packages/contracts/src/domains/engineering-repair/gates.mjs';

export const maintenanceActions = ['maintenance.read', 'maintenance.schedule', 'maintenance.start', 'maintenance.complete', 'maintenance.cancel'];
export const maintenanceRoles = Object.fromEntries(maintenanceActions.map(action => [`maintenance${action.split('.')[1][0].toUpperCase()}${action.split('.')[1].slice(1)}`, [...new Set(['maintenance.read', action])]]));
const headId = (filter, equipmentId) => gateId(`${filter.tenantId}:${filter.plantId}:MAINTENANCE`, equipmentId);
const empty = (filter, equipmentId) => ({ _id: headId(filter, equipmentId), ...filter, schema: 'MAINTENANCE_CAPACITY_V1', resourceId: equipmentId, version: 0, windows: [] });
export async function initializeMaintenance(db) {
  for (const [name, keys] of [['maintenanceHeads', { tenantId: 1, plantId: 1, resourceId: 1 }], ['maintenanceKeys', { tenantId: 1, plantId: 1, key: 1 }], ['maintenanceRevisions', { tenantId: 1, plantId: 1, resourceId: 1, version: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
}
async function head(db, filter, equipmentId, session, fence = false) {
  const key = { ...filter, _id: headId(filter, equipmentId) };
  if (fence) {
    if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
    return db.collection('maintenanceHeads').findOneAndUpdate(key, { $setOnInsert: empty(filter, equipmentId), $inc: { useFence: 1 } }, { upsert: true, session, returnDocument: 'after' });
  }
  return await db.collection('maintenanceHeads').findOne(key, { session }) || empty(filter, equipmentId);
}
export async function maintenanceCapacity(db, filter, equipmentId, interval, session, { fence = false } = {}) {
  const equipment = await qualityResource(db, filter, 'EQUIPMENT', equipmentId, session, fence);
  if (!equipment.label) fail(404, 'EQUIPMENT_NOT_FOUND');
  const row = await head(db, filter, equipmentId, session, fence), capacity = capacityFor(row.windows, interval.from, interval.until);
  if (equipment.disabled || equipment.holds.some(h => h.active)) { capacity.unavailableMinutes = capacity.totalMinutes; capacity.availableMinutes = '0'; }
  return { schema: 'MAINTENANCE_CAPACITY_V1', equipmentId, equipmentVersion: equipment.version, maintenanceVersion: row.version, ...capacity, disabled: Boolean(equipment.disabled), activeHolds: equipment.holds.filter(h => h.active).map(h => h._id) };
}
export async function requireMaintenanceCapacity(db, filter, equipmentId, interval, session) {
  if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  await requireQualityGates(db, filter, [{ resourceType: 'EQUIPMENT', resourceId: equipmentId, requireCalibration: true }], session, { at: interval.from });
  const result = await maintenanceCapacity(db, filter, equipmentId, interval, session, { fence: true });
  const equipment = await qualityResource(db, filter, 'EQUIPMENT', equipmentId, session);
  if (new Date(equipment.calibration.validUntil) < new Date(interval.until)) fail(409, 'CALIBRATION_REQUIRED');
  if (interval.expectedVersion !== undefined && result.maintenanceVersion !== interval.expectedVersion) fail(409, 'MAINTENANCE_VERSION_CONFLICT');
  if (typeof interval.requiredMinutes !== 'string' || !/^[1-9][0-9]{0,6}$/.test(interval.requiredMinutes)) fail(400, 'INVALID_REQUIRED_MINUTES');
  if (BigInt(interval.requiredMinutes) > BigInt(result.availableMinutes)) fail(409, 'MAINTENANCE_CAPACITY_EXCEEDED');
  return result;
}
export function installMaintenance(app, runtime, helpers) {
  const root = '/api/repair/maintenance', db = runtime.db, { id, fields, transaction } = scopedModule(app, runtime, root, 'maintenance', helpers);
  app.get(`${root}/equipment/:id`, async (req, res) => res.json({ data: await head(db, req.filter, id(req.params.id)) }));
  app.get(`${root}/equipment/:id/capacity`, async (req, res) => {
    const session = runtime.client.startSession();
    try { const data = await session.withTransaction(() => maintenanceCapacity(db, req.filter, id(req.params.id), { from: req.query.from, until: req.query.until }, session), { readConcern: { level: 'snapshot' } }); res.json({ data }); } finally { await session.endSession(); }
  });
  for (const action of ['schedule', 'start', 'complete', 'cancel']) app.post(`${root}/equipment/:id/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'evidence', ...(action === 'schedule' ? ['from', 'until', 'kind'] : ['windowId'])]);
    const equipmentId = id(req.params.id), b = req.body, evidence = qualityText(b.evidence);
    const data = await transaction(req, async session => {
      const equipment = await qualityResource(db, req.filter, 'EQUIPMENT', equipmentId, session, true);
      if (!equipment.label) fail(404, 'EQUIPMENT_NOT_FOUND');
      const row = await head(db, req.filter, equipmentId, session, true);
      if (row.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      const now = businessNow(runtime), recorded = { evidence, recordedBy: req.scope.userId, recordedAt: now };
      if (action === 'schedule') {
        const from = utcMinute(b.from), until = utcMinute(b.until);
        if (from >= until || until <= now.getTime() || until - from > 366 * 86400000 || !['PREVENTIVE', 'CORRECTIVE', 'CALIBRATION'].includes(b.kind)) fail(400, 'INVALID_MAINTENANCE_WINDOW');
        if (row.windows.length >= 100) fail(409, 'MAINTENANCE_HISTORY_LIMIT');
        row.windows.push({ _id: randomUUID(), kind: b.kind, from: b.from, until: b.until, status: 'PLANNED', scheduled: recorded });
      } else {
        const window = row.windows.find(w => w._id === id(b.windowId)); if (!window) fail(404, 'NOT_FOUND');
        if (action === 'start') { if (window.status !== 'PLANNED' || now < new Date(window.from) || now >= new Date(window.until)) fail(409, 'MAINTENANCE_STATE_CONFLICT'); window.status = 'ACTIVE'; window.started = recorded; }
        if (action === 'cancel') { if (window.status !== 'PLANNED' || now >= new Date(window.from)) fail(409, 'MAINTENANCE_STATE_CONFLICT'); window.status = 'CANCELLED'; window.cancelled = recorded; }
        if (action === 'complete') {
          if (!['PLANNED', 'ACTIVE'].includes(window.status) || now < new Date(window.from)) fail(409, 'MAINTENANCE_STATE_CONFLICT');
          window.status = 'COMPLETED'; window.completed = recorded;
          window.actualUntil = new Date(Math.ceil(now.getTime() / 60000) * 60000).toISOString();
        }
      }
      row.version++; row.updatedAt = now;
      const saved = await db.collection('maintenanceHeads').replaceOne({ ...req.filter, _id: row._id, version: b.expectedVersion }, row, { session }); if (saved.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await db.collection('maintenanceRevisions').insertOne({ _id: randomUUID(), ...req.filter, resourceId: equipmentId, version: row.version, snapshot: row }, { session }); return row;
    }); res.json({ data });
  });
}
