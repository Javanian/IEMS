import { randomUUID, createHash } from 'node:crypto';

// Wave 4f stock hold authority (contract wave4f-v1 section 1).
// Authority: `stockHolds` (one document per hold). The receipt keeps exactly one derived cache, `hold`,
// written only in the same transaction as a stockHolds change. Legacy `held === true`, nonzero `heldQuantity`
// and a `hold` object that is not a valid cache stay fail-closed in every eligibility guard.
export const HOLD_REASONS = Object.freeze(['QC_SUSPECT', 'DAMAGED', 'DOCUMENT_MISMATCH', 'CUSTOMER_COMPLAINT', 'OTHER']);
export const RELEASE_REASONS = Object.freeze(['INSPECTION_PASSED', 'DISPOSITION_ACCEPTED', 'APPLIED_IN_ERROR', 'OTHER']);
export const holdActions = ['warehouse.hold.apply', 'warehouse.hold.release'];
export const holdRoles = {
  warehouseHoldApply: ['warehouse.read', 'warehouse.hold.apply'],
  warehouseHoldRelease: ['warehouse.read', 'warehouse.hold.release'],
  warehouseQuality: ['warehouse.read', 'warehouse.hold.apply', 'warehouse.hold.release'],
};
const PARTIAL_KEYS = ['quantity', 'heldQuantity', 'partial', 'lot', 'lotId', 'lotNumber', 'serial', 'serials', 'scope'];
const SCOPE_KEYS = ['tenantId', 'tenant_id', 'plantId', 'plant_id', 'x-tenant-id', 'x-plant-id'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TXN = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const err = (status, code, message = code, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

export async function initializeStockHolds(db) {
  await db.collection('stockHolds').createIndex({ tenantId: 1, plantId: 1, receiptId: 1, status: 1 });
  await db.collection('stockHolds').createIndex({ tenantId: 1, plantId: 1, appliedAt: -1, _id: -1 });
  await db.collection('stockHoldKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
}

// A heldQuantity is eligible only when absent or an exact canonical zero string; anything else fails closed.
const zeroQuantity = v => v === undefined || v === null || (typeof v === 'string' && /^0+(\.0+)?$/.test(v));
export const validHoldCache = h => !!h && typeof h === 'object' && !Array.isArray(h) && typeof h.active === 'boolean' && Array.isArray(h.activeHoldIds) && h.activeHoldIds.every(x => typeof x === 'string' && UUID.test(x)) && new Set(h.activeHoldIds).size === h.activeHoldIds.length && Number.isSafeInteger(h.version) && h.version >= 0 && h.active === (h.activeHoldIds.length > 0);
export function legacyHoldForms(receipt) {
  const forms = [];
  if (receipt.held === true) forms.push('held');
  if (!zeroQuantity(receipt.heldQuantity)) forms.push('heldQuantity');
  if (receipt.hold !== undefined && receipt.hold !== null && !validHoldCache(receipt.hold) && receipt.hold?.active !== false) forms.push('hold');
  return forms;
}

// Authoritative eligibility. Must be called with the caller's transaction session; the caller must also write the
// receipt document in that transaction so a concurrent hold/release write conflicts and the driver retries.
export async function receiptHoldState(db, receipt, session) {
  const activeHolds = await db.collection('stockHolds').find({ tenantId: receipt.tenantId, plantId: receipt.plantId, receiptId: receipt._id, status: 'ACTIVE' }, { session }).sort({ appliedAt: 1, _id: 1 }).toArray();
  const legacy = legacyHoldForms(receipt);
  const cacheActive = receipt.hold?.active === true;
  return { held: activeHolds.length > 0 || legacy.length > 0 || cacheActive, activeHolds, legacy, cacheActive };
}
export async function requireEligibleReceipt(db, receipt, session) {
  if (!session?.inTransaction()) throw new Error('eligibility guard requires an active transaction');
  const state = await receiptHoldState(db, receipt, session);
  if (state.held) throw err(409, 'STOCK_ENCUMBERED');
  return state;
}

const materialCodeOf = async (db, receipt, session) => {
  const po = receipt.purchaseOrderId ? await db.collection('purchaseOrders').findOne({ tenantId: receipt.tenantId, plantId: receipt.plantId, _id: receipt.purchaseOrderId }, { session, projection: { snapshot: 1 } }) : null;
  return po?.snapshot?.lines?.[receipt.lineIndex]?.description ?? null;
};
const holdCacheView = receipt => validHoldCache(receipt.hold) ? { active: receipt.hold.active, activeHoldIds: [...receipt.hold.activeHoldIds], version: receipt.hold.version } : { active: receipt.hold?.active === true, activeHoldIds: [], version: 0 };
export async function receiptView(db, receipt, session) {
  const legacy = legacyHoldForms(receipt);
  return { id: receipt._id, version: receipt.version, status: receipt.status, materialCode: await materialCodeOf(db, receipt, session), quantity: receipt.quantity, uom: receipt.uom, availableQuantity: receipt.availableQuantity ?? '0', binCode: receipt.location ?? null, hold: holdCacheView(receipt), legacyHoldRepresentation: legacy };
}
export const holdView = h => ({
  id: h._id, receiptId: h.receiptId, status: h.status, reasonCode: h.reasonCode, reasonNote: h.reasonNote, appliedBy: h.appliedBy, appliedAt: h.appliedAt,
  ...(h.status === 'RELEASED' ? { releasedBy: h.releasedBy, releasedAt: h.releasedAt, releaseReasonCode: h.releaseReasonCode, releaseReasonNote: h.releaseReasonNote } : {}),
  version: h.version,
});
const workOrderNumber = id => `WO-${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`;

// Read-only: holds never cancel or rewrite reservations or WO snapshots.
export async function receiptImpacts(db, receipt, held, session) {
  if (!held) return { reservations: [], workOrders: [] };
  const scope = { tenantId: receipt.tenantId, plantId: receipt.plantId };
  const sales = await db.collection('warehouseReservations').find({ ...scope, receiptId: receipt._id, status: { $in: ['RESERVED', 'PARTIALLY_SHIPPED'] } }, { session }).sort({ _id: 1 }).limit(100).toArray();
  const reserved = await db.collection('manufacturingMovements').find({ ...scope, receiptId: receipt._id, kind: 'MATERIAL_RESERVED' }, { session }).sort({ _id: 1 }).limit(100).toArray();
  const orders = reserved.length ? await db.collection('manufacturingWorkOrders').find({ ...scope, _id: { $in: [...new Set(reserved.map(m => m.workOrderId))] } }, { session }).toArray() : [];
  const pending = new Map(orders.filter(w => w.status === 'RELEASED' && !(w.records?.length)).map(w => [w._id, w]));
  return {
    reservations: [
      ...sales.map(r => ({ kind: 'SALES', id: r._id, quantity: r.remainingQuantity ?? r.quantity, salesOrderId: r.salesOrderId, state: 'BLOCKED_BY_HOLD' })),
      ...reserved.filter(m => pending.has(m.workOrderId)).map(m => ({ kind: 'MANUFACTURING', id: m._id, quantity: m.quantity, workOrderId: m.workOrderId, salesOrderId: pending.get(m.workOrderId).salesOrderId, state: 'BLOCKED_BY_HOLD' })),
    ],
    workOrders: [...pending.values()].map(w => ({ id: w._id, number: workOrderNumber(w._id), status: w.status, stockException: 'BLOCKED_BY_HOLD' })),
  };
}

// Released-but-unconsumed WO materials on held receipts. Legacy forms appear with holdId null (fail closed, visible).
export async function workOrderStockExceptions(db, wo, session) {
  if (wo.status !== 'RELEASED' || wo.records?.length || !Array.isArray(wo.routing?.materials)) return [];
  const out = [];
  for (const m of wo.routing.materials) {
    const receipt = await db.collection('warehouseReceipts').findOne({ tenantId: wo.tenantId, plantId: wo.plantId, _id: m.receiptId }, { session });
    if (!receipt) continue;
    const state = await receiptHoldState(db, receipt, session);
    if (!state.held) continue;
    const materialCode = await materialCodeOf(db, receipt, session);
    for (const h of state.activeHolds) out.push({ holdId: h._id, receiptId: receipt._id, materialCode, reasonCode: h.reasonCode, since: h.appliedAt });
    if (!state.activeHolds.length) out.push({ holdId: null, receiptId: receipt._id, materialCode, reasonCode: state.legacy.length ? 'LEGACY_HOLD_REPRESENTATION' : 'HOLD_CACHE_WITHOUT_AUTHORITY', since: null });
  }
  return out;
}

export function installStockHolds(app, runtime, { guard }) {
  const db = () => runtime.db, c = name => runtime.db.collection(name);
  const forbidden = e => (e?.code === 'SCOPE_DENIED' ? err(403, 'FORBIDDEN', 'Forbidden') : e);
  const uuid = (v, code = 'NOT_FOUND', status = 404) => { if (typeof v !== 'string' || !UUID.test(v)) throw err(status, code); return v; };
  const validation = message => err(400, 'VALIDATION', message);
  const idempotencyKey = req => {
    const raw = req.headers['idempotency-key'];
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw)) throw validation('Idempotency-Key header (8..100 of A-Z a-z 0-9 _ -) is required');
    return raw;
  };
  const body = (req, allowed) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw validation('JSON object body required');
    if (Object.keys(b).some(k => PARTIAL_KEYS.includes(k))) throw err(422, 'HOLD_PARTIAL_UNSUPPORTED', 'Holds cover the whole warehouse receipt; partial quantity, lot or serial holds are not supported');
    const unknown = Object.keys(b).filter(k => !allowed.includes(k) && !SCOPE_KEYS.includes(k));
    if (unknown.length) throw validation(`Unknown field: ${unknown[0]}`);
    return b;
  };
  const note = v => { if (typeof v !== 'string' || v.trim().length < 3 || v.trim().length > 500) throw validation('reasonNote must be 3..500 characters'); return v.trim(); };
  const positive = (v, name) => { if (!Number.isSafeInteger(v) || v < 1) throw validation(`${name} must be a positive integer`); return v; };
  const displayName = async (userId, session) => (await c('credentials').findOne({ _id: userId }, { session, projection: { username: 1 } }))?.username ?? null;

  // Command + receipt cache + audit + outbox + idempotency record commit together or not at all.
  const command = async (req, res, { operation, subjectId, request, effect }) => {
    const key = idempotencyKey(req);
    const filter = { tenantId: req.filter.tenantId, plantId: req.filter.plantId };
    const requestHash = createHash('sha256').update(JSON.stringify(canonical({ operation, subjectId, request }))).digest('hex');
    for (let attempt = 1; ; attempt++) {
      const session = runtime.client.startSession();
      try {
        const out = await session.withTransaction(async () => {
          try { await guard(runtime, req, session, req.warehouseAction); } catch (e) { throw forbidden(e); }
          const prior = await c('stockHoldKeys').findOne({ ...filter, key }, { session });
          if (prior) { if (prior.requestHash !== requestHash) throw err(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used with a different request'); return { status: prior.status, body: prior.body, replayed: true }; }
          const result = await effect(session, filter);
          const occurredAt = new Date();
          const event = { ...filter, kind: result.event, subjectId: result.hold.id, receiptId: result.receipt.id, version: result.hold.version, receiptVersion: result.receipt.version, userId: req.scope.userId, occurredAt, payload: { reasonCode: result.hold.status === 'RELEASED' ? result.hold.releaseReasonCode : result.hold.reasonCode, holdStatus: result.hold.status, activeHoldIds: result.receipt.hold.activeHoldIds } };
          await c('warehouseAudit').insertOne({ _id: randomUUID(), ...event }, { session });
          await c('warehouseOutbox').insertOne({ _id: randomUUID(), ...event, type: `${result.event}.v1`, state: 'PENDING' }, { session });
          const stored = { status: result.status, body: { hold: result.hold, receipt: result.receipt } };
          await c('stockHoldKeys').insertOne({ _id: randomUUID(), ...filter, key, operation, subjectId, requestHash, ...stored, userId: req.scope.userId, createdAt: occurredAt }, { session });
          return stored;
        }, TXN);
        return res.status(out.status).json({ data: out.body });
      } catch (e) {
        if (e?.code === 11000 && attempt < 4) continue;
        throw e;
      } finally { await session.endSession(); }
    }
  };

  app.post('/api/warehouse/receipts/:id/holds', async (req, res) => {
    const b = body(req, ['reasonCode', 'reasonNote', 'expectedReceiptVersion']);
    if (!HOLD_REASONS.includes(b.reasonCode)) throw validation(`reasonCode must be one of ${HOLD_REASONS.join(', ')}`);
    const reasonNote = note(b.reasonNote), expectedReceiptVersion = positive(b.expectedReceiptVersion, 'expectedReceiptVersion');
    const receiptId = uuid(req.params.id);
    await command(req, res, { operation: 'hold.apply', subjectId: receiptId, request: { reasonCode: b.reasonCode, reasonNote, expectedReceiptVersion }, effect: async (session, filter) => {
      const receipt = await c('warehouseReceipts').findOne({ ...filter, _id: receiptId }, { session });
      if (!receipt) throw err(404, 'NOT_FOUND');
      const legacy = legacyHoldForms(receipt);
      if (legacy.length) throw err(409, 'HOLD_LEGACY_REPRESENTATION', `Receipt carries legacy hold representation (${legacy.join(', ')}); normalise it before using hold commands`);
      if (receipt.version !== expectedReceiptVersion) throw err(409, 'VERSION_CONFLICT', 'Receipt changed', { currentVersion: receipt.version });
      const active = await c('stockHolds').find({ ...filter, receiptId, status: 'ACTIVE' }, { session, projection: { _id: 1 } }).sort({ appliedAt: 1, _id: 1 }).toArray();
      const at = new Date();
      const hold = { _id: randomUUID(), ...filter, receiptId, status: 'ACTIVE', reasonCode: b.reasonCode, reasonNote, appliedBy: { userId: req.scope.userId, displayName: await displayName(req.scope.userId, session) }, appliedAt: at, version: 1, idempotency: { applyKeyHash: createHash('sha256').update(idempotencyKey(req)).digest('hex') } };
      await c('stockHolds').insertOne(hold, { session });
      const cache = { active: true, activeHoldIds: [...active.map(h => h._id), hold._id], version: (validHoldCache(receipt.hold) ? receipt.hold.version : 0) + 1 };
      const saved = await c('warehouseReceipts').findOneAndUpdate({ ...filter, _id: receiptId, version: receipt.version }, { $set: { hold: cache, updatedAt: at }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
      if (!saved) throw err(409, 'VERSION_CONFLICT', 'Receipt changed', { currentVersion: receipt.version });
      return { status: 201, event: 'stock.hold.applied', hold: holdView(hold), receipt: await receiptView(db(), saved, session) };
    } });
  });

  app.post('/api/warehouse/holds/:holdId/release', async (req, res) => {
    const b = body(req, ['reasonCode', 'reasonNote', 'expectedVersion']);
    if (!RELEASE_REASONS.includes(b.reasonCode)) throw validation(`reasonCode must be one of ${RELEASE_REASONS.join(', ')}`);
    const reasonNote = note(b.reasonNote), expectedVersion = positive(b.expectedVersion, 'expectedVersion');
    const holdId = uuid(req.params.holdId);
    await command(req, res, { operation: 'hold.release', subjectId: holdId, request: { reasonCode: b.reasonCode, reasonNote, expectedVersion }, effect: async (session, filter) => {
      const hold = await c('stockHolds').findOne({ ...filter, _id: holdId }, { session });
      if (!hold) throw err(404, 'NOT_FOUND');
      if (hold.status !== 'ACTIVE') throw err(409, 'HOLD_NOT_ACTIVE', 'Hold is already released', { currentVersion: hold.version });
      if (hold.version !== expectedVersion) throw err(409, 'VERSION_CONFLICT', 'Hold changed', { currentVersion: hold.version });
      const receipt = await c('warehouseReceipts').findOne({ ...filter, _id: hold.receiptId }, { session });
      if (!receipt) throw err(404, 'NOT_FOUND');
      const at = new Date();
      const released = await c('stockHolds').findOneAndUpdate({ ...filter, _id: holdId, status: 'ACTIVE', version: expectedVersion }, { $set: { status: 'RELEASED', releasedBy: { userId: req.scope.userId, displayName: await displayName(req.scope.userId, session) }, releasedAt: at, releaseReasonCode: b.reasonCode, releaseReasonNote: reasonNote, 'idempotency.releaseKeyHash': createHash('sha256').update(idempotencyKey(req)).digest('hex') }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
      if (!released) throw err(409, 'VERSION_CONFLICT', 'Hold changed', { currentVersion: hold.version });
      // The cache is recomputed from the authority, so releasing one hold never clears another.
      const remaining = await c('stockHolds').find({ ...filter, receiptId: receipt._id, status: 'ACTIVE' }, { session, projection: { _id: 1 } }).sort({ appliedAt: 1, _id: 1 }).toArray();
      const cache = { active: remaining.length > 0, activeHoldIds: remaining.map(h => h._id), version: (validHoldCache(receipt.hold) ? receipt.hold.version : 0) + 1 };
      const saved = await c('warehouseReceipts').findOneAndUpdate({ ...filter, _id: receipt._id, version: receipt.version }, { $set: { hold: cache, updatedAt: at }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
      if (!saved) throw err(409, 'VERSION_CONFLICT', 'Receipt changed', { currentVersion: hold.version });
      return { status: 200, event: 'stock.hold.released', hold: holdView(released), receipt: await receiptView(db(), saved, session) };
    } });
  });

  const decodeCursor = raw => {
    try {
      const [at, id] = JSON.parse(Buffer.from(raw, 'base64url').toString());
      const date = new Date(at);
      if (typeof id !== 'string' || !UUID.test(id) || !Number.isFinite(date.getTime())) throw 0;
      return { at: date, id };
    } catch { throw validation('Invalid cursor'); }
  };
  app.get('/api/warehouse/holds', async (req, res) => {
    const q = req.query;
    const unknown = Object.keys(q).filter(k => !['status', 'receiptId', 'limit', 'cursor', ...SCOPE_KEYS].includes(k));
    if (unknown.length) throw validation(`Unknown query parameter: ${unknown[0]}`);
    const status = q.status === undefined ? 'ACTIVE' : q.status;
    if (!['ACTIVE', 'RELEASED', 'ALL'].includes(status)) throw validation('status must be ACTIVE, RELEASED or ALL');
    if (q.limit !== undefined && (typeof q.limit !== 'string' || !/^[0-9]{1,3}$/.test(q.limit) || Number(q.limit) < 1 || Number(q.limit) > 100)) throw validation('limit must be 1..100');
    const limit = q.limit === undefined ? 25 : Number(q.limit);
    const filter = { tenantId: req.filter.tenantId, plantId: req.filter.plantId };
    if (status !== 'ALL') filter.status = status;
    if (q.receiptId !== undefined) filter.receiptId = uuid(q.receiptId, 'VALIDATION', 400);
    if (q.cursor !== undefined) {
      if (typeof q.cursor !== 'string' || q.cursor.length > 512) throw validation('Invalid cursor');
      const cur = decodeCursor(q.cursor);
      filter.$or = [{ appliedAt: { $lt: cur.at } }, { appliedAt: cur.at, _id: { $lt: cur.id } }];
    }
    const rows = await c('stockHolds').find(filter).sort({ appliedAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const items = rows.slice(0, limit), last = items.at(-1);
    res.json({ data: { items: items.map(holdView), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify([last.appliedAt.toISOString(), last._id])).toString('base64url') : null } });
  });

  app.get('/api/warehouse/receipts/:id/holds', async (req, res) => {
    const receiptId = uuid(req.params.id);
    const session = runtime.client.startSession();
    try {
      const data = await session.withTransaction(async () => {
        const receipt = await c('warehouseReceipts').findOne({ tenantId: req.filter.tenantId, plantId: req.filter.plantId, _id: receiptId }, { session });
        if (!receipt) throw err(404, 'NOT_FOUND');
        const holds = await c('stockHolds').find({ tenantId: receipt.tenantId, plantId: receipt.plantId, receiptId }, { session }).sort({ appliedAt: -1, _id: -1 }).limit(100).toArray();
        const state = await receiptHoldState(db(), receipt, session);
        return { receipt: await receiptView(db(), receipt, session), holds: holds.map(holdView), impacts: await receiptImpacts(db(), receipt, state.held, session), eligible: !state.held, asOf: new Date() };
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
      res.json({ data });
    } finally { await session.endSession(); }
  });
}
