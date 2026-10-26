import { randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { validateCatalogReceiptOrigin } from './catalog-procurement.mjs';
import { validateCatalogDispositionState } from './catalog-disposition-state.mjs';
import { requireCatalogInventoryItem, requireQualifiedCompanyLocation } from './internal-production.mjs';
import { receiptHoldState, validHoldCache } from './stock-holds.mjs';
import { validateCatalogStockUse, stockHash as hash, stockHashless as hashless, stockSemantic as semantic, stockUnits as units, stockDecimal as decimal, stockInvalid } from './catalog-stock-use-state.mjs';

export const catalogStockActions = ['catalog.stock.read'];
export const catalogStockRoles = { catalogStockReader: ['catalog.stock.read'] };
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
export async function catalogStockContext(db, filter, receiptId, session, { fresh = false, fence = false } = {}) {
  const receipt = await db.collection('warehouseReceipts').findOne({ ...filter, _id: receiptId }, { session }); if (!receipt) fail(404, 'NOT_FOUND');
  const origin = await db.collection('warehouseReceiptOrigins').findOne({ ...filter, receiptId }, { session }); await validateCatalogReceiptOrigin(db, receipt, origin, session);
  const opening = await validateCatalogDispositionState(db, receipt, origin, session), use = await validateCatalogStockUse(db, receipt, origin, opening, session), blockers = [];
  const plant = await db.collection('plants').findOne({ tenantId: filter.tenantId, _id: filter.plantId, active: true }, { session });
  if (!plant || plant.legalEntityId !== origin.source.ownerLegalEntityId || !await db.collection('legalEntities').findOne({ tenantId: filter.tenantId, _id: plant.legalEntityId, active: true }, { session })) fail(403, 'SCOPE_DENIED');
  const hold = await receiptHoldState(db, receipt, session), malformed = receipt.hold !== undefined && receipt.hold !== null && !validHoldCache(receipt.hold), held = hold.held || malformed;
  if (held) blockers.push('SOURCE_HELD'); if (opening.head?.status !== 'STORED') blockers.push('NOT_STORED');
  if (fresh && held) fail(409, 'STOCK_ENCUMBERED');
  try { const source = origin.source, item = await requireCatalogInventoryItem(db, filter, source.itemId, source.itemVersion, source.itemRevision, session, fence); if (item.contentHash !== source.itemContentHash || item.ownerLegalEntityId !== source.ownerLegalEntityId) stockInvalid(); }
  catch (error) { if (!['CATALOG_DEPENDENCY_CHANGED', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('ITEM_CHANGED'); }
  if (opening.head?.status === 'STORED') { const location = opening.balance.locationSnapshot; try { const live = await requireQualifiedCompanyLocation(db, filter, location._id, location.version, origin.source.ownerLegalEntityId, session, fence); if (live.authorityHash !== location.authorityHash) blockers.push('LOCATION_CHANGED'); } catch (error) { if (!['CATALOG_DEPENDENCY_CHANGED', 'VERSION_CONFLICT', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('LOCATION_CHANGED'); } }
  if (use.version >= 401) blockers.push('STOCK_HISTORY_LIMIT');
  if (fresh && blockers.includes('STOCK_HISTORY_LIMIT')) fail(409, 'STOCK_HISTORY_LIMIT');
  if (fresh && blockers.length) fail(409, 'CATALOG_DEPENDENCY_CHANGED');
  if (fence) { if (!session?.inTransaction()) throw new Error('stock source fence requires transaction'); const changed = await db.collection('warehouseReceipts').updateOne({ ...filter, _id: receipt._id, version: receipt.version }, { $inc: { catalogStockUseFence: 1 } }, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
  return { receipt, origin, opening, use, blockers, sourceHolds: { held, activeHoldIds: hold.activeHolds.map(row => row._id), reasonCodes: [...new Set([...hold.activeHolds.map(row => row.reasonCode), ...hold.legacy, ...(malformed ? ['INVALID_HOLD_CACHE'] : [])])], legacy: malformed || hold.legacy.length > 0 } };
}
export function catalogStockView(context) {
  const { receipt, origin, opening, use, blockers, sourceHolds } = context;
  return { receiptId: receipt._id, receiptVersion: receipt.version, version: use.version, source: origin.source, receipt: { quantity: receipt.quantity, uom: receipt.uom, serials: receipt.serials, ...(receipt.lotNumber ? { lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber } : {}) }, opening: opening.balance, onHandQuantity: use.onHandQuantity, reservedQuantity: use.reservedQuantity, issuedQuantity: use.issuedQuantity, consumedQuantity: use.consumedQuantity, ...(use.shippedQuantity !== undefined ? { shippedQuantity: use.shippedQuantity } : {}), availableQuantity: use.availableQuantity, eligibleQuantity: blockers.length ? '0' : use.availableQuantity, units: use.units.map(unit => ({ ...unit, eligible: !blockers.length && unit.status === 'AVAILABLE' })), sourceHolds, blockers, canAllocate: !blockers.length && use.reservations.length < 100 && units(use.availableQuantity) > 0n, canReserve: !blockers.length && use.reservations.length < 100 && units(use.availableQuantity) > 0n, reservationLimitReached: use.reservations.length >= 100 };
}
export async function writeCatalogReservation(db, filter, context, reservation, actor, reason, session) {
  if (context.use.version >= 401) fail(409, 'STOCK_HISTORY_LIMIT');
  if (reservation.schema === 'CATALOG_CUSTOMER_RESERVATION_V1' && reservation.status !== 'RELEASED' && context.blockers.length) fail(409, 'CATALOG_DEPENDENCY_CHANGED');
  const previous = await db.collection('catalogMaterialReservations').findOne({ ...filter, _id: reservation._id }, { session });
  const row = { ...hashless(reservation), version: previous ? previous.version + 1 : 1, previousHash: previous?.contentHash || null }; row.contentHash = hash(row);
  if (previous) { const changed = await db.collection('catalogMaterialReservations').replaceOne({ ...filter, _id: row._id, version: previous.version }, row, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
  else await db.collection('catalogMaterialReservations').insertOne(row, { session });
  const history = { _id: randomUUID(), ...filter, receiptId: row.receiptId, reservationId: row._id, version: row.version, snapshot: row, reason, recordedBy: actor, recordedAt: new Date() }; history.contentHash = hash(history); await db.collection('catalogMaterialReservationRevisions').insertOne(history, { session });
  const reservations = await db.collection('catalogMaterialReservations').find({ ...filter, receiptId: row.receiptId }, { session }).limit(101).toArray(); if (reservations.length > 100) fail(409, 'STOCK_HISTORY_LIMIT');
  const customer = reservations.filter(value => value.schema === 'CATALOG_CUSTOMER_RESERVATION_V1');
  const sum = status => decimal(reservations.filter(value => value.schema !== 'CATALOG_CUSTOMER_RESERVATION_V1' && value.status === status).reduce((total, value) => total + units(value.quantity), status === 'RESERVED' ? customer.reduce((total, value) => total + units(value.remainingQuantity), 0n) : 0n));
  const head = { _id: row.receiptId, ...filter, receiptId: row.receiptId, originHash: context.origin.contentHash, openingBalanceHash: context.opening.balance.contentHash, version: context.use.version + 1, refs: reservations.map(value => ({ reservationId: value._id, version: value.version, contentHash: value.contentHash })), reservedQuantity: sum('RESERVED'), issuedQuantity: sum('ISSUED'), consumedQuantity: sum('CONSUMED'), ...(customer.length ? { shippedQuantity: decimal(customer.reduce((total, value) => total + units(value.shippedQuantity), 0n)) } : {}) };
  if (head.version > 401) fail(409, 'STOCK_HISTORY_LIMIT');
  if (units(head.reservedQuantity) + units(head.issuedQuantity) + units(head.consumedQuantity) + units(head.shippedQuantity || '0') > units(context.opening.balance.acceptedQuantity)) fail(409, 'INSUFFICIENT_STOCK');
  const eventId = randomUUID(), snapshot = semantic(head); head.authorityHash = hash(snapshot); head.eventId = eventId;
  await db.collection('catalogUseEvents').insertOne({ _id: eventId, ...filter, receiptId: row.receiptId, version: head.version, kind: row.status, reservationId: row._id, reservationHash: row.contentHash, snapshot, contentHash: head.authorityHash, recordedBy: actor, recordedAt: new Date(), reason }, { session });
  if (context.use.head) { const changed = await db.collection('catalogUseHeads').replaceOne({ ...filter, _id: head._id, version: context.use.version }, head, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
  else await db.collection('catalogUseHeads').insertOne(head, { session });
  const receiptWrite = await db.collection('warehouseReceipts').updateOne({ ...filter, _id: row.receiptId, version: context.receipt.version }, { $inc: { version: 1 } }, { session }); if (receiptWrite.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  context.use.head = head; context.use.version = head.version; context.receipt.version++;
  return row;
}
export async function initializeCatalogStock(db) {
  for (const [name, keys] of [['catalogUseHeads', { tenantId: 1, plantId: 1, receiptId: 1 }], ['catalogUseEvents', { tenantId: 1, plantId: 1, receiptId: 1, version: 1 }], ['catalogMaterialReservationRevisions', { tenantId: 1, plantId: 1, reservationId: 1, version: 1 }], ['catalogMaterialIssues', { tenantId: 1, plantId: 1, reservationId: 1 }], ['catalogMaterialConsumptions', { tenantId: 1, plantId: 1, reservationId: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('catalogMaterialReservations').createIndex({ tenantId: 1, plantId: 1, receiptId: 1, _id: 1 });
  await db.collection('warehouseReceiptOrigins').createIndex({ tenantId: 1, plantId: 1, 'source.itemId': 1, 'source.itemRevision': 1, receiptId: 1 }, { name: 'catalog_stock_options' });
}
export function installCatalogStock(app, runtime, { id }) {
  const root = '/api/catalog-stock', db = runtime.db;
  app.use(root, async (req, res, next) => { req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers }); if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED'); if (req.method !== 'GET') fail(404, 'NOT_FOUND'); await runtime.foundation.authorize(req.scope, { ...req.filter, action: 'catalog.stock.read' }); next(); });
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  app.get(`${root}/receipts/:id`, async (req, res) => res.json({ data: await read(async session => catalogStockView(await catalogStockContext(db, req.filter, id(req.params.id), session))) }));
  app.get(`${root}/receipts`, async (req, res) => {
    const itemId = id(req.query.itemId), itemRevision = Number(req.query.itemRevision), limit = req.query.limit === undefined ? 25 : Number(req.query.limit), q = req.query.q === undefined ? '' : req.query.q;
    if (!Number.isSafeInteger(itemRevision) || itemRevision < 1 || !/^[1-9][0-9]*$/.test(req.query.itemRevision) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || typeof q !== 'string' || q.trim().length > 80) fail(400, 'INVALID_SEARCH');
    const cursor = req.query.cursor === undefined ? null : id(req.query.cursor);
    res.json(await read(async session => { const rows = await db.collection('warehouseReceiptOrigins').find({ ...req.filter, 'source.itemId': itemId, 'source.itemRevision': itemRevision, ...(cursor ? { receiptId: { $gt: cursor } } : {}) }, { session }).hint('catalog_stock_options').sort({ receiptId: 1 }).limit(limit + 1).toArray(), data = [];
      for (const row of rows.slice(0, limit)) { const context = await catalogStockContext(db, req.filter, row.receiptId, session), view = catalogStockView(context); if (units(view.eligibleQuantity) > 0n && (!q || [view.receipt.lotNumber, view.receipt.heatNumber].some(value => value?.toLowerCase().startsWith(q.trim().toLowerCase())))) data.push(view); }
      return { data, page: { limit, nextCursor: rows.length > limit ? rows[limit - 1].receiptId : null } };
    }));
  });
}
