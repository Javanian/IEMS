import { randomUUID } from 'node:crypto';
import { receiptHoldState, requireEligibleReceipt, validHoldCache } from './stock-holds.mjs';

export const custodyActions = ['custody.read', 'custody.adopt', 'custody.claim', 'custody.abandon'];
export const custodyRoles = Object.fromEntries(['Reader', 'Adopter', 'Claimer', 'Abandoner'].map((name, index) => [`custody${name}`, ['warehouse.read', 'manufacturing.read', 'custody.read', ...(index ? [custodyActions[index]] : [])]]));
const ACTIVE = ['CLAIMED', 'RESERVED', 'CONSUMED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scope = row => ({ tenantId: row.tenantId, plantId: row.plantId });
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const number = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID'); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const traceOf = receipt => ({ receiptId: receipt._id, lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber });
const hasMarker = receipt => Object.hasOwn(receipt, 'serialCustody');
const validMarker = receipt => receipt.serialCustody?.mode === 'RECEIVED_V1' && typeof receipt.serialCustody.adoptedBy === 'string' && UUID.test(receipt.serialCustody.adoptedBy) && receipt.serialCustody.adoptedAt instanceof Date && Number.isFinite(receipt.serialCustody.adoptedAt.getTime());
const reason = value => { if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) fail(400, 'INVALID_SERIAL_CUSTODY'); return value.trim(); };
const version = value => { if (!Number.isSafeInteger(value) || value < 1) fail(400, 'INVALID_VERSION'); return value; };
const unencumbered = receipt => ['reservedQuantity', 'shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].every(k => number(receipt[k] || '0') === 0n);

export async function initializeSerialCustody(db) {
  await db.collection('serialCustodyUnits').createIndex({ tenantId: 1, plantId: 1, registryId: 1 }, { unique: true });
  await db.collection('serialCustodyUnits').createIndex({ tenantId: 1, plantId: 1, receiptId: 1 });
  await db.collection('serialCustodyClaims').createIndex({ tenantId: 1, plantId: 1, workOrderId: 1, receiptId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ACTIVE } } });
  await db.collection('serialCustodyEvents').createIndex({ tenantId: 1, plantId: 1, receiptId: 1, _id: 1 });
  await db.collection('serialCustodyEvents').createIndex({ tenantId: 1, plantId: 1, workOrderId: 1, _id: 1 });
}

export function requireQuantityOnlyReceipt(receipt) {
  if (hasMarker(receipt)) fail(409, 'SERIAL_CUSTODY_REQUIRED');
}

async function holds(db, receipt, session, enforce = false) {
  const invalid = receipt.hold !== undefined && receipt.hold !== null && !validHoldCache(receipt.hold);
  if (enforce) {
    if (invalid) fail(409, 'STOCK_ENCUMBERED');
    await requireEligibleReceipt(db, receipt, session); return [];
  }
  const state = await receiptHoldState(db, receipt, session);
  return state.held || invalid ? [{ receiptId: receipt._id, holdIds: state.activeHolds.map(h => h._id), reasonCodes: invalid ? ['INVALID_HOLD_CACHE'] : state.activeHolds.map(h => h.reasonCode), legacy: invalid || state.legacy.length > 0 || (state.cacheActive && !state.activeHolds.length) }] : [];
}

async function registry(db, receipt, session) {
  if (!Array.isArray(receipt.serials) || !receipt.serials.length || receipt.serials.length > 100 || new Set(receipt.serials).size !== receipt.serials.length || receipt.serials.some(s => typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(s)) || number(receipt.quantity) !== BigInt(receipt.serials.length) * 1000000n) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  const rows = await db.collection('warehouseSerials').find({ ...scope(receipt), receiptId: receipt._id }, { session }).limit(101).toArray();
  if (rows.length !== receipt.serials.length || rows.some(row => !receipt.serials.includes(row.serial) || Object.hasOwn(row, 'sourceType') || Object.hasOwn(row, 'workOrderId') || Object.hasOwn(row, 'unitId')) || new Set(rows.map(row => row.serial)).size !== rows.length) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  return rows;
}

async function authority(db, receipt, session) {
  if (!hasMarker(receipt)) fail(409, 'SERIAL_CUSTODY_UNTRACKED');
  if (!validMarker(receipt) || !receipt.lotNumber || !receipt.heatNumber) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  const source = await registry(db, receipt, session), rows = await db.collection('serialCustodyUnits').find({ ...scope(receipt), receiptId: receipt._id }, { session }).sort({ _id: 1 }).limit(101).toArray();
  if (rows.length !== source.length || rows.some(unit => unit.uom !== receipt.uom || !equal(unit.materialTrace, traceOf(receipt)) || !Number.isSafeInteger(unit.version) || unit.version < 1 || !['AVAILABLE', ...ACTIVE].includes(unit.status) || !source.some(row => row._id === unit.registryId && row.serial === unit.serial)) || new Set(rows.map(unit => unit.registryId)).size !== rows.length) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  for (const unit of rows) {
    if (unit.status === 'AVAILABLE' && (unit.claimId || unit.workOrderId)) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
    if (unit.status !== 'AVAILABLE' && (!unit.claimId || !unit.workOrderId)) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  }
  const active = await db.collection('serialCustodyClaims').find({ ...scope(receipt), receiptId: receipt._id, status: { $in: ACTIVE } }, { session }).limit(101).toArray();
  if (active.length > 100 || rows.some(unit => unit.status !== 'AVAILABLE' && !active.some(claim => claim._id === unit.claimId))) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  for (const claim of active) verifyClaim(claim, rows, { _id: claim.workOrderId }, receipt, claim.status);
  if (!unencumberedSales(receipt) || number(receipt.availableQuantity) !== BigInt(rows.filter(unit => ['AVAILABLE', 'CLAIMED'].includes(unit.status)).length) * 1000000n || number(receipt.manufacturingReservedQuantity || '0') !== BigInt(rows.filter(unit => unit.status === 'RESERVED').length) * 1000000n || number(receipt.manufacturingConsumedQuantity || '0') !== BigInt(rows.filter(unit => unit.status === 'CONSUMED').length) * 1000000n) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  return rows;
}

const unencumberedSales = receipt => ['reservedQuantity', 'shippedQuantity'].every(k => number(receipt[k] || '0') === 0n);

async function claims(db, wo, session) {
  const rows = await db.collection('serialCustodyClaims').find({ ...scope(wo), workOrderId: wo._id, status: { $in: ACTIVE } }, { session }).sort({ _id: 1 }).limit(21).toArray();
  if (rows.length > 20) fail(409, 'SERIAL_CLAIM_CONFLICT'); return rows;
}

async function woView(db, wo, session) {
  const rows = await claims(db, wo, session);
  return { workOrderId: wo._id, required: wo.serialCustodyRequired === true, workOrderVersion: wo.version, status: wo.status, claims: rows.map(({ _id, receiptId, version, status, serialUnitIds, serials, quantity, uom, materialTrace, reason, claimedBy, claimedAt }) => ({ _id, receiptId, version, status, serialUnitIds, serials, quantity, uom, materialTrace, reason, claimedBy, claimedAt })) };
}

async function adoptionBlockers(db, receipt, session) {
  const blockers = [];
  if (hasMarker(receipt)) return [validMarker(receipt) ? 'ALREADY_TRACKED' : 'INVALID_CUSTODY_MARKER'];
  if (receipt.status !== 'STORED') blockers.push('RECEIPT_NOT_STORED');
  if (!receipt.lotNumber || !receipt.heatNumber) blockers.push('MATERIAL_TRACE_REQUIRED');
  try { await registry(db, receipt, session); } catch (error) { if (error.code !== 'SERIAL_CUSTODY_SOURCE_INVALID') throw error; blockers.push('SERIAL_REGISTRY_INVALID'); }
  try { if (!unencumbered(receipt) || number(receipt.availableQuantity) !== number(receipt.quantity)) blockers.push('STOCK_USED'); } catch { blockers.push('STOCK_USED'); }
  const options = { session, projection: { _id: 1 } }, filter = { ...scope(receipt), receiptId: receipt._id };
  if (await db.collection('warehouseReservations').findOne(filter, options) || await db.collection('manufacturingMovements').findOne({ ...filter, kind: { $in: ['MATERIAL_RESERVED', 'MATERIAL_CONSUMED'] } }, options) || await db.collection('warehouseMovements').findOne({ ...filter, kind: { $in: ['RESERVE', 'SHIP', 'COUNT', 'TRANSFER'] } }, options) || await db.collection('serialCustodyUnits').findOne(filter, options) || await db.collection('serialCustodyClaims').findOne(filter, options) || await db.collection('serialCustodyEvents').findOne(filter, options)) blockers.push('STOCK_HISTORY_USED');
  if ((await holds(db, receipt, session)).length) blockers.push('STOCK_ENCUMBERED');
  return blockers;
}

async function receiptView(db, receipt, session) {
  const tracked = validMarker(receipt), sourceHolds = await holds(db, receipt, session), blockers = await adoptionBlockers(db, receipt, session);
  let units = [], corrupt = false;
  if (sourceHolds.length && !blockers.includes('STOCK_ENCUMBERED')) blockers.push('STOCK_ENCUMBERED');
  if (tracked) { try { units = await authority(db, receipt, session); } catch (error) { if (error.code !== 'SERIAL_CUSTODY_SOURCE_INVALID') throw error; corrupt = true; blockers.push('SERIAL_CUSTODY_SOURCE_INVALID'); } }
  const eligible = tracked && !corrupt && receipt.status === 'STORED' && !sourceHolds.length;
  return { _id: receipt._id, version: receipt.version, receiptId: receipt._id, receiptVersion: receipt.version, tracked, mode: tracked ? 'RECEIVED_V1' : 'UNTRACKED', canAdopt: blockers.length === 0, adoptionBlockers: blockers, quantity: receipt.quantity, quantityAvailable: receipt.availableQuantity || '0', uom: receipt.uom, claimableQuantity: tracked ? eligible ? String(units.filter(unit => unit.status === 'AVAILABLE').length) : '0' : null, sourceHolds, units: units.map(({ _id, version, receiptId, serial, uom, status, claimId, workOrderId, materialTrace }) => ({ _id, version, receiptId, serial, uom, status, claimId: claimId || null, workOrderId: workOrderId || null, materialTrace })) };
}

async function event(db, row, kind, userId, note, session) {
  const { receiptId, workOrderId, serialUnitIds, serials } = row;
  await db.collection('serialCustodyEvents').insertOne({ _id: randomUUID(), ...scope(row), receiptId, ...(workOrderId ? { workOrderId, claimId: row._id } : {}), kind, version: row.version, serialUnitIds: [...serialUnitIds], serials: [...serials], materialTrace: structuredClone(row.materialTrace), reason: note, recordedBy: userId, recordedAt: new Date() }, { session });
}

async function fenceReceipt(db, receipt, session) {
  const changed = await db.collection('warehouseReceipts').updateOne({ ...scope(receipt), _id: receipt._id, version: receipt.version }, { $inc: { version: 1, serialCustodyFence: 1 } }, { session });
  if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); receipt.version++;
}

async function fenceWo(db, wo, session) {
  const changed = await db.collection('manufacturingWorkOrders').updateOne({ ...scope(wo), _id: wo._id, version: wo.version }, { $inc: { version: 1, serialCustodyFence: 1 } }, { session });
  if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); wo.version++;
}

export async function requireCustodyTransfer(db, receipt, session) {
  if (!hasMarker(receipt)) return;
  const units = await authority(db, receipt, session);
  await holds(db, receipt, session, true);
  const active = await db.collection('serialCustodyClaims').findOne({ ...scope(receipt), receiptId: receipt._id, status: { $in: ACTIVE } }, { session });
  if (active || units.some(unit => unit.status !== 'AVAILABLE') || !unencumbered(receipt) || number(receipt.availableQuantity) !== number(receipt.quantity)) fail(409, 'SERIAL_CUSTODY_STATE_CONFLICT');
}

function pagination(req, id) {
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
  return { limit, ...(req.query.cursor === undefined ? {} : { cursor: id(req.query.cursor) }) };
}

function installEventRoute(app, path, runtime, find, subjectCollection, subjectField, id) {
  app.get(`${path}/events`, async (req, res) => {
    const { limit, cursor } = pagination(req, id); await find(subjectCollection, req, req.params.id);
    const rows = await runtime.db.collection('serialCustodyEvents').find({ ...req.filter, [subjectField]: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).limit(limit + 1).toArray();
    res.json({ data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } });
  });
}

export function installWarehouseSerialCustody(app, runtime, { tx, find, fields, id }) {
  const db = runtime.db, path = '/api/warehouse/receipts/:id/serial-custody';
  app.get(path, async (req, res) => {
    const session = runtime.client.startSession();
    try { res.json({ data: await session.withTransaction(async () => receiptView(db, await find('warehouseReceipts', req, req.params.id, session), session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }) }); }
    finally { await session.endSession(); }
  });
  installEventRoute(app, path, runtime, find, 'warehouseReceipts', 'receiptId', id);
  app.post(`${path}/adopt`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'reason', 'idempotencyKey']); const note = reason(req.body.reason);
    const data = await tx(req, 'serialCustody.adopt', { expectedVersion: req.body.expectedVersion, reason: req.body.reason }, async session => {
      const receipt = await find('warehouseReceipts', req, req.params.id, session);
      if (receipt.version !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT');
      const blockers = await adoptionBlockers(db, receipt, session);
      if (blockers.includes('STOCK_ENCUMBERED')) fail(409, 'STOCK_ENCUMBERED');
      if (blockers.length) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
      await holds(db, receipt, session, true);
      const rows = await registry(db, receipt, session), now = new Date();
      const units = rows.map(row => ({ _id: randomUUID(), ...req.filter, version: 1, receiptId: receipt._id, registryId: row._id, serial: row.serial, uom: receipt.uom, status: 'AVAILABLE', materialTrace: traceOf(receipt), adoptedBy: req.scope.userId, adoptedAt: now }));
      await db.collection('serialCustodyUnits').insertMany(units, { session });
      const marker = { mode: 'RECEIVED_V1', adoptedBy: req.scope.userId, adoptedAt: now };
      const changed = await db.collection('warehouseReceipts').updateOne({ ...req.filter, _id: receipt._id, version: receipt.version }, { $set: { serialCustody: marker }, $inc: { version: 1, serialCustodyFence: 1 } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      receipt.serialCustody = marker; receipt.version++;
      await event(db, { ...receipt, receiptId: receipt._id, serialUnitIds: units.map(u => u._id), materialTrace: traceOf(receipt) }, 'ADOPTED', req.scope.userId, note, session);
      return receiptView(db, receipt, session);
    }); res.json({ data });
  });
}

export function installManufacturingSerialCustody(app, runtime, { tx, find, fields, id }) {
  const db = runtime.db, path = '/api/manufacturing/work-orders/:id/serial-claims';
  app.get(path, async (req, res) => {
    const session = runtime.client.startSession();
    try { res.json({ data: await session.withTransaction(async () => woView(db, await find('manufacturingWorkOrders', req, req.params.id, session), session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }) }); }
    finally { await session.endSession(); }
  });
  installEventRoute(app, path, runtime, find, 'manufacturingWorkOrders', 'workOrderId', id);
  app.post(path, async (req, res) => {
    fields(req.body, ['expectedVersion', 'expectedReceiptVersion', 'receiptId', 'serialUnitIds', 'reason', 'idempotencyKey']);
    const b = req.body, note = reason(b.reason); version(b.expectedReceiptVersion); id(b.receiptId);
    if (!Array.isArray(b.serialUnitIds) || !b.serialUnitIds.length || b.serialUnitIds.length > 100 || new Set(b.serialUnitIds).size !== b.serialUnitIds.length) fail(400, 'INVALID_SERIAL_CLAIMS');
    b.serialUnitIds.forEach(id);
    const data = await tx(req, 'serialCustody.claim', async session => {
      const wo = await find('manufacturingWorkOrders', req, req.params.id, session), receipt = await find('warehouseReceipts', req, b.receiptId, session);
      if (wo.version !== b.expectedVersion || receipt.version !== b.expectedReceiptVersion) fail(409, 'VERSION_CONFLICT');
      if (!wo.serialCustodyRequired) fail(409, 'SERIAL_CUSTODY_REQUIRED');
      if (wo.status !== 'PLANNED' || receipt.status !== 'STORED') fail(409, 'SERIAL_CUSTODY_STATE_CONFLICT');
      const active = await claims(db, wo, session);
      if (active.length >= 20 || active.some(claim => claim.receiptId === receipt._id)) fail(409, 'SERIAL_CLAIM_CONFLICT');
      const units = await authority(db, receipt, session), selected = b.serialUnitIds.map(unitId => units.find(u => u._id === unitId));
      if (selected.some(unit => !unit)) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
      if (selected.some(unit => unit.status !== 'AVAILABLE')) fail(409, 'SERIAL_CLAIM_CONFLICT');
      await holds(db, receipt, session, true);
      const claim = { _id: randomUUID(), ...req.filter, version: 1, status: 'CLAIMED', workOrderId: wo._id, receiptId: receipt._id, serialUnitIds: [...b.serialUnitIds], serials: selected.map(u => u.serial), quantity: String(selected.length), uom: receipt.uom, materialTrace: traceOf(receipt), reason: note, claimedBy: req.scope.userId, claimedAt: new Date() };
      const changed = await db.collection('serialCustodyUnits').updateMany({ ...req.filter, receiptId: receipt._id, _id: { $in: claim.serialUnitIds }, status: 'AVAILABLE' }, { $set: { status: 'CLAIMED', claimId: claim._id, workOrderId: wo._id }, $inc: { version: 1 } }, { session });
      if (changed.matchedCount !== selected.length) fail(409, 'SERIAL_CLAIM_CONFLICT');
      await db.collection('serialCustodyClaims').insertOne(claim, { session });
      await event(db, claim, 'CLAIMED', req.scope.userId, note, session);
      await fenceReceipt(db, receipt, session); await fenceWo(db, wo, session);
      return woView(db, wo, session);
    }); res.json({ data });
  });
  app.post(`${path}/abandon`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'expectedClaimVersion', 'claimId', 'reason', 'idempotencyKey']);
    const b = req.body, note = reason(b.reason); version(b.expectedClaimVersion); id(b.claimId);
    const data = await tx(req, 'serialCustody.abandon', async session => {
      const wo = await find('manufacturingWorkOrders', req, req.params.id, session);
      if (wo.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      const claim = await db.collection('serialCustodyClaims').findOne({ ...req.filter, _id: b.claimId, workOrderId: wo._id }, { session });
      if (!claim) fail(404, 'NOT_FOUND');
      if (claim.version !== b.expectedClaimVersion) fail(409, 'VERSION_CONFLICT');
      if (wo.status !== 'PLANNED' || claim.status !== 'CLAIMED') fail(409, 'SERIAL_CUSTODY_STATE_CONFLICT');
      const receipt = await find('warehouseReceipts', req, claim.receiptId, session), units = await authority(db, receipt, session);
      verifyClaim(claim, units, wo, receipt, 'CLAIMED');
      const changed = await db.collection('serialCustodyUnits').updateMany({ ...req.filter, receiptId: receipt._id, _id: { $in: claim.serialUnitIds }, claimId: claim._id, status: 'CLAIMED' }, { $set: { status: 'AVAILABLE' }, $unset: { claimId: '', workOrderId: '' }, $inc: { version: 1 } }, { session });
      if (changed.matchedCount !== claim.serialUnitIds.length) fail(409, 'SERIAL_CLAIM_CONFLICT');
      const saved = await db.collection('serialCustodyClaims').updateOne({ ...req.filter, _id: claim._id, version: claim.version, status: 'CLAIMED' }, { $set: { status: 'ABANDONED', abandonedBy: req.scope.userId, abandonedAt: new Date() }, $inc: { version: 1 } }, { session });
      if (saved.matchedCount !== 1) fail(409, 'SERIAL_CLAIM_CONFLICT');
      claim.status = 'ABANDONED'; claim.version++;
      await event(db, claim, 'ABANDONED', req.scope.userId, note, session);
      await fenceReceipt(db, receipt, session); await fenceWo(db, wo, session);
      return woView(db, wo, session);
    }); res.json({ data });
  });
}

function verifyClaim(claim, units, wo, receipt, status) {
  if (!claim || !Number.isSafeInteger(claim.version) || claim.version < 1 || claim.workOrderId !== wo._id || claim.receiptId !== receipt._id || claim.status !== status || claim.uom !== receipt.uom || !equal(claim.materialTrace, traceOf(receipt)) || !Array.isArray(claim.serialUnitIds) || !claim.serialUnitIds.length || claim.serialUnitIds.length > 100 || new Set(claim.serialUnitIds).size !== claim.serialUnitIds.length || !Array.isArray(claim.serials) || claim.serials.length !== claim.serialUnitIds.length || new Set(claim.serials).size !== claim.serialUnitIds.length || number(claim.quantity) !== BigInt(claim.serialUnitIds.length) * 1000000n) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  const selected = claim.serialUnitIds.map(id => units.find(u => u._id === id));
  if (selected.some((unit, index) => !unit || unit.status !== status || unit.workOrderId !== wo._id || unit.claimId !== claim._id || unit.serial !== claim.serials[index])) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
}

async function transition(db, wo, receipt, claim, from, to, userId, session) {
  const changed = await db.collection('serialCustodyUnits').updateMany({ ...scope(wo), receiptId: receipt._id, claimId: claim._id, workOrderId: wo._id, _id: { $in: claim.serialUnitIds }, status: from }, { $set: { status: to }, $inc: { version: 1 } }, { session });
  const saved = await db.collection('serialCustodyClaims').updateOne({ ...scope(wo), _id: claim._id, workOrderId: wo._id, version: claim.version, status: from }, { $set: { status: to }, $inc: { version: 1 } }, { session });
  if (changed.matchedCount !== claim.serialUnitIds.length || saved.matchedCount !== 1) fail(409, 'SERIAL_CLAIM_CONFLICT');
  await event(db, { ...claim, version: claim.version + 1, status: to }, to, userId, `Work order ${to.toLowerCase()} received identities`, session);
}

export async function reserveSerialCustody(db, wo, materials, bindings, userId, session) {
  if (bindings !== undefined && (!Array.isArray(bindings) || bindings.length > 20 || bindings.some(b => !b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'claimId,receiptId' || typeof b.receiptId !== 'string' || !UUID.test(b.receiptId) || typeof b.claimId !== 'string' || !UUID.test(b.claimId)) || new Set(bindings.map(b => b.receiptId)).size !== bindings.length || new Set(bindings.map(b => b.claimId)).size !== bindings.length)) fail(400, 'INVALID_SERIAL_CLAIMS');
  const active = await claims(db, wo, session), result = new Map();
  if (!wo.serialCustodyRequired && ((bindings?.length || 0) || active.length)) fail(409, 'SERIAL_CUSTODY_REQUIRED');
  if (wo.serialCustodyRequired && (!Array.isArray(bindings) || bindings.length !== materials.length || active.length !== materials.length)) fail(409, 'SERIAL_CLAIM_CONFLICT');
  for (const material of materials) {
    const receipt = await db.collection('warehouseReceipts').findOne({ ...scope(wo), _id: material.receiptId }, { session });
    if (!receipt) fail(404, 'NOT_FOUND');
    if (!wo.serialCustodyRequired) { requireQuantityOnlyReceipt(receipt); continue; }
    const ratio = number(material.quantityPerUnit), required = number(wo.quantity) * ratio / 1000000n;
    if (ratio < 1000000n || ratio % 1000000n || required > 100000000n || required < 1000000n) fail(409, 'SERIAL_CLAIM_QUANTITY_CONFLICT');
    const binding = bindings.find(b => b.receiptId === receipt._id), claim = active.find(c => c._id === binding?.claimId);
    const units = await authority(db, receipt, session); verifyClaim(claim, units, wo, receipt, 'CLAIMED');
    if (receipt.status !== 'STORED' || material.uom !== receipt.uom || number(claim.quantity) !== required) fail(409, 'SERIAL_CLAIM_QUANTITY_CONFLICT');
    await holds(db, receipt, session, true);
    await transition(db, wo, receipt, claim, 'CLAIMED', 'RESERVED', userId, session);
    result.set(receipt._id, { claimId: claim._id, serialUnitIds: [...claim.serialUnitIds], serials: [...claim.serials] });
  }
  return result;
}

export async function consumeSerialCustody(db, wo, material, receipt, userId, session) {
  if (!wo.serialCustodyRequired) { requireQuantityOnlyReceipt(receipt); return; }
  const units = await authority(db, receipt, session), snapshot = material.serialCustody;
  if (!snapshot) fail(409, 'SERIAL_CLAIM_CONFLICT');
  const claim = await db.collection('serialCustodyClaims').findOne({ ...scope(wo), _id: snapshot.claimId }, { session });
  verifyClaim(claim, units, wo, receipt, 'RESERVED');
  if (!equal(snapshot, { claimId: claim._id, serialUnitIds: claim.serialUnitIds, serials: claim.serials }) || number(claim.quantity) !== number(material.quantity) || material.uom !== claim.uom || !equal(material.materialTrace, claim.materialTrace)) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  const moves = await db.collection('manufacturingMovements').find({ ...scope(wo), workOrderId: wo._id, receiptId: receipt._id, kind: 'MATERIAL_RESERVED' }, { session }).limit(2).toArray();
  if (moves.length !== 1 || !equal(moves[0].serialCustody, snapshot) || moves[0].quantity !== material.quantity || moves[0].quantityPerUnit !== material.quantityPerUnit || moves[0].uom !== material.uom || !equal(moves[0].materialTrace, material.materialTrace)) fail(409, 'SERIAL_CUSTODY_SOURCE_INVALID');
  await holds(db, receipt, session, true);
  await transition(db, wo, receipt, claim, 'RESERVED', 'CONSUMED', userId, session);
}
