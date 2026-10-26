import { validatePurchasedBillingAggregate } from './purchased-billing-state.mjs';
import { randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { validateCatalogOrder } from './quote-catalog.mjs';
import { businessNow } from './business-clock.mjs';
import { validateInventoryItemAuthority } from './internal-production.mjs';
import { catalogStockContext, catalogStockView, writeCatalogReservation } from './catalog-stock.mjs';
import { stockHash as hash, stockHashless as hashless, stockSemantic as semantic, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { purchasedSchema, customerClaimSchema, purchasedHeadProof, purchasedInvalid, shipmentSemantic } from './purchased-stock-proof.mjs';

export const purchasedFulfillmentActions = ['catalog.stock.reserve', 'catalog.stock.ship'];
const reads = ['fulfillment.read', 'catalog.stock.read'];
export const purchasedFulfillmentRoles = { purchasedFulfillmentReader: reads, purchasedFulfillmentReserver: [...reads, 'catalog.stock.reserve'], purchasedFulfillmentShipper: [...reads, 'fulfillment.ship', 'catalog.stock.ship'] };
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const positive = value => { if (!Number.isSafeInteger(value) || value < 1) fail(400, 'INVALID_VERSION'); return value; };
const quantity = value => { let result; try { result = units(value); } catch { fail(400, 'INVALID_QUANTITY'); } if (result <= 0n) fail(400, 'INVALID_QUANTITY'); return result; };
const stamp = row => ({ ...row, contentHash: hash(row) });
const index = value => { if (!Number.isSafeInteger(value) || value < 0) fail(400, 'INVALID_LINE'); return value; };

export async function purchasedFulfillmentContext(db, filter, salesOrderId, session) {
  const order = await db.collection('salesOrders').findOne({ ...filter, _id: salesOrderId }, { session });
  if (!order) fail(404, 'NOT_FOUND');
  const current = await purchasedHeadProof(db, filter, salesOrderId, session), rows = await db.collection('catalogMaterialReservations').find({ ...filter, salesOrderId }, { session }).limit(101).toArray();
  if (rows.length > 100 || (current.head?.refs.length || 0) !== rows.length) purchasedInvalid();
  const stocks = new Map();
  for (const row of rows) {
    if (!stocks.has(row.receiptId)) stocks.set(row.receiptId, await catalogStockContext(db, filter, row.receiptId, session));
    const actual = stocks.get(row.receiptId).use.reservations.find(claim => claim._id === row._id);
    if (!actual || actual.schema !== customerClaimSchema || hash(actual) !== hash(row)) purchasedInvalid();
  }
  const proofs = await db.collection('purchasedShipmentProofs').find({ ...filter, salesOrderId }, { session }).limit(101).toArray(), shipments = [];
  const actualShipments = await db.collection('fulfillmentShipments').find({ ...filter, salesOrderId }, { session }).limit(101).toArray();
  if (proofs.length > 100 || actualShipments.length !== proofs.length || actualShipments.some(row => !proofs.some(proof => proof.shipmentId === row._id)) || proofs.length !== (current.head?.shipmentRefs.length || 0)) purchasedInvalid();
  for (const proof of proofs) {
    const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: proof.shipmentId }, { session });
    if (!shipment || !Array.isArray(shipment.sources) || !Array.isArray(proof.snapshot?.sources) || hash(hashless(proof)) !== proof.contentHash || hash(shipmentSemantic(shipment)) !== proof.shipmentHash || !current.head.shipmentRefs.some(ref => ref.shipmentId === shipment._id && ref.contentHash === proof.contentHash) || shipment.sources.some(source => !rows.some(row => row._id === source.sourceId && row.receiptId === source.receiptId))) purchasedInvalid();
    shipments.push(shipmentSemantic(shipment));
  }
  for (const [lineIndex, line] of order.snapshot.lines.entries()) {
    const claims = rows.filter(row => row.lineIndex === lineIndex), committed = claims.reduce((sum, row) => sum + units(row.remainingQuantity) + units(row.shippedQuantity), 0n), shipped = shipments.filter(row => row.lineIndex === lineIndex).reduce((sum, row) => sum + units(row.quantity), 0n);
    if (committed > units(line.quantity) || shipped !== claims.reduce((sum, row) => sum + units(row.shippedQuantity), 0n)) purchasedInvalid();
    const tally = await db.collection('fulfillmentTallies').findOne({ ...filter, kind: 'SO_LINE_SHIPPED', subjectId: salesOrderId, lineIndex }, { session });
    if (units(tally?.quantity || '0') !== shipped) purchasedInvalid();
  }
  for (const row of rows) { const tally = await db.collection('fulfillmentTallies').findOne({ ...filter, kind: 'SOURCE_SHIPPED', subjectId: row._id, lineIndex: 0 }, { session }); if (units(tally?.quantity || '0') !== units(row.shippedQuantity)) purchasedInvalid(); }
  const billing = await validatePurchasedBillingAggregate(db, filter, order, shipments, session);
  return { ...current, reservations: rows, stocks, shipments, billing };
}


export async function purchasedReadContext(db, filter, order, session) {
  if (!await validateCatalogOrder(db, filter, order, session)) return null;
  return purchasedFulfillmentContext(db, filter, order._id, session);
}

export async function purchasedReconciliation(db, filter, current, session) {
  const moves = await db.collection('catalogCustomerShipments').find({ ...filter, salesOrderId: current.order._id }, { session }).limit(2001).toArray();
  if (moves.length > 2000 || moves.length !== current.shipments.reduce((sum, shipment) => sum + shipment.sources.length, 0)) purchasedInvalid();
  const sum = rows => rows.reduce((total, row) => total + units(row.quantity), 0n);
  const lines = current.order.snapshot.lines.map((line, lineIndex) => {
    const shipped = sum(current.shipments.filter(row => row.lineIndex === lineIndex)), moved = sum(moves.filter(row => row.lineIndex === lineIndex));
    if (shipped !== moved) purchasedInvalid();
    return { lineIndex, uom: line.uom, talliedQuantity: decimal(shipped), shipmentQuantity: decimal(shipped), movementQuantity: decimal(moved), matches: true };
  });
  const sources = [...new Set(moves.map(row => row.reservationId))].map(sourceId => {
    const own = moves.filter(row => row.reservationId === sourceId), claim = current.reservations.find(row => row._id === sourceId), moved = sum(own);
    if (!claim || moved !== units(claim.shippedQuantity)) purchasedInvalid();
    return { sourceType: 'CATALOG_RESERVATION', sourceId, talliedQuantity: decimal(moved), movementQuantity: decimal(moved), matches: true };
  });
  return { salesOrderId: current.order._id, lines, sources, shipmentCount: current.shipments.length, movementCount: moves.length, matches: true };
}

async function currentLine(db, filter, order, lineIndex, session, fence = false) {
  const line = order.snapshot.lines[lineIndex]; if (!line) fail(400, 'INVALID_LINE');
  const binding = line.catalogBinding;
  if (binding?.itemSnapshot?.content.kind !== 'PURCHASED') fail(409, 'PURCHASED_LINE_UNSUPPORTED');
  const item = await validateInventoryItemAuthority(db, filter, binding.itemId, session);
  if (order.status !== 'OPEN' || item.status !== 'APPROVED' || item.version !== binding.itemVersion || item.currentRevision !== binding.itemRevision || item.contentHash !== binding.contentHash || item.ownerLegalEntityId !== order.ownerLegalEntityId || item.content.schema !== 'INVENTORY_ITEM_V2' || item.content.kind !== 'PURCHASED' || item.content.uom !== line.uom || !['LOT', 'SERIAL'].includes(item.content.trackingPolicy)) fail(409, 'PURCHASED_ITEM_CHANGED');
  if (fence) { const written = await db.collection('inventoryItems').updateOne({ ...filter, _id: item._id, version: item.version, authorityHash: item.authorityHash }, { $inc: { useFence: 1 } }, { session }); if (written.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
  return line;
}

export function buildCustomerReservation(context, current, { lineIndex, quantity: amountText, unitIds = [], actor }) {
  const line = current.order.snapshot.lines[lineIndex], binding = line.catalogBinding, amount = quantity(amountText);
  if (!Array.isArray(unitIds) || new Set(unitIds).size !== unitIds.length || unitIds.length > 100) fail(400, 'INVALID_UNITS');
  const selected = unitIds.map(unitId => context.use.units.find(unit => unit._id === unitId));
  if (context.origin.source.trackingPolicy === 'LOT' ? unitIds.length !== 0 : !unitIds.length || amount !== BigInt(unitIds.length) * 1000000n || selected.some(unit => !unit || unit.status !== 'AVAILABLE' || unit.eligible === false)) fail(400, 'INVALID_UNITS');
  const source = context.origin.source;
  if (source.itemId !== binding.itemId || source.itemRevision !== binding.itemRevision || source.itemVersion !== binding.itemVersion || source.itemContentHash !== binding.contentHash || source.ownerLegalEntityId !== binding.ownerLegalEntityId || context.receipt.uom !== line.uom) fail(409, 'PURCHASED_ITEM_CHANGED');
  const allocated = current.reservations.filter(row => row.lineIndex === lineIndex).reduce((sum, row) => sum + units(row.remainingQuantity) + units(row.shippedQuantity), 0n);
  if (allocated + amount > units(line.quantity)) fail(409, 'QUANTITY_EXCEEDED');
  if (amount > units(context.use.availableQuantity)) fail(409, 'INSUFFICIENT_STOCK');
  return { _id: randomUUID(), tenantId: current.order.tenantId, plantId: current.order.plantId, schema: customerClaimSchema, demandKind: 'SALES_ORDER_LINE', sourceKind: 'CATALOG_RECEIPT', salesOrderId: current.order._id, salesOrderVersion: current.order.version, lineIndex, orderHash: current.orderProof.orderHash, bindingHash: hash(binding), receiptId: context.receipt._id, originHash: context.origin.contentHash, openingBalanceHash: context.opening.balance.contentHash, itemId: source.itemId, itemRevision: source.itemRevision, uom: line.uom, ownerLegalEntityId: source.ownerLegalEntityId, quantity: decimal(amount), unitIds: [...unitIds], serials: selected.map(unit => unit.serial), status: 'RESERVED', remainingQuantity: decimal(amount), shippedQuantity: '0', releasedQuantity: '0', shippedUnitIds: [], sourceSnapshot: { ...source, locationSnapshot: context.opening.balance.locationSnapshot, lotNumber: context.receipt.lotNumber ?? null, heatNumber: context.receipt.heatNumber ?? null, units: selected.map(unit => ({ unitId: unit._id, registryId: unit.registryId, serial: unit.serial, contentHash: unit.contentHash })) }, recordedBy: actor, recordedAt: new Date() };
}
export const writePurchasedReservation = writeCatalogReservation;

async function view(db, filter, current, session) {
  const lines = [];
  for (const [lineIndex, line] of current.order.snapshot.lines.entries()) {
    const supported = line.catalogBinding?.itemSnapshot?.content.kind === 'PURCHASED', blockers = [];
    if (current.version >= 401 || current.shipments.length >= 100) blockers.push('FULFILLMENT_HISTORY_LIMIT');
    try { await currentLine(db, filter, current.order, lineIndex, session); } catch (error) { if (!['PURCHASED_LINE_UNSUPPORTED', 'PURCHASED_ITEM_CHANGED', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push(error.code); }
    const claims = current.reservations.filter(row => row.lineIndex === lineIndex), reserved = claims.reduce((sum, row) => sum + units(row.remainingQuantity), 0n), shipped = claims.reduce((sum, row) => sum + units(row.shippedQuantity), 0n), released = claims.reduce((sum, row) => sum + units(row.releasedQuantity), 0n);
    const ready = claims.some(row => units(row.remainingQuantity) > 0n && !current.stocks.get(row.receiptId).blockers.length);
    const invoiced = current.billing.byLine.get(lineIndex) || 0n;
    lines.push({ lineIndex, description: line.description, quantity: line.quantity, uom: line.uom, catalogBinding: line.catalogBinding, supported, blockers, reserveBlockers: [...blockers, ...(current.reservations.length >= 100 ? ['FULFILLMENT_HISTORY_LIMIT'] : [])], reservedQuantity: decimal(reserved), shippedQuantity: decimal(shipped), releasedQuantity: decimal(released), invoicedQuantity: decimal(invoiced), remainingReserveQuantity: decimal(units(line.quantity) - shipped - reserved), remainingShipQuantity: decimal(reserved), canReserve: supported && !blockers.length && units(line.quantity) > shipped + reserved && current.reservations.length < 100, canShip: supported && !blockers.length && ready && current.shipments.length < 100 });
  }
  return { schema: purchasedSchema, salesOrder: current.order, version: current.version, sourceHash: current.orderProof.orderHash, authorityHash: current.head?.authorityHash || null, lines, reservations: current.reservations.map(row => ({ ...row, canRelease: units(row.remainingQuantity) > 0n && current.version < 401 && current.stocks.get(row.receiptId).use.version < 401, releaseBlockers: [...(current.version >= 401 ? ['FULFILLMENT_HISTORY_LIMIT'] : []), ...(current.stocks.get(row.receiptId).use.version >= 401 ? ['STOCK_HISTORY_LIMIT'] : [])], remainingUnitIds: row.status === 'RELEASED' ? [] : row.unitIds.filter(unitId => !row.shippedUnitIds.includes(unitId)) })), stockSources: [...current.stocks.values()].map(catalogStockView), shipments: current.shipments, canReserve: lines.some(line => line.canReserve), canShip: lines.some(line => line.canShip) };
}

async function save(db, filter, current, actor, kind, reason, key, payloadHash, receipt, session) {
  const reservations = await db.collection('catalogMaterialReservations').find({ ...filter, salesOrderId: current.order._id }, { session }).limit(101).toArray(), proofs = await db.collection('purchasedShipmentProofs').find({ ...filter, salesOrderId: current.order._id }, { session }).limit(101).toArray();
  if (reservations.length > 100 || proofs.length > 100 || current.version >= 401) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
  const snapshot = { _id: current.order._id, ...filter, schema: purchasedSchema, salesOrderId: current.order._id, ownerLegalEntityId: current.order.ownerLegalEntityId, orderHash: current.orderProof.orderHash, version: current.version + 1, refs: reservations.map(row => ({ reservationId: row._id, version: row.version, contentHash: row.contentHash })), shipmentRefs: proofs.map(row => ({ shipmentId: row.shipmentId, contentHash: row.contentHash })), sourceReceiptIds: [...new Set(reservations.map(row => row.receiptId))], commandProof: { key, kind, payloadHash, resultHash: hash(receipt) } }, contentHash = hash(snapshot), eventId = randomUUID(), head = { ...snapshot, authorityHash: contentHash, eventId };
  await db.collection('purchasedFulfillmentEvents').insertOne({ _id: eventId, ...filter, salesOrderId: current.order._id, version: head.version, kind, reason, recordedBy: actor, recordedAt: new Date(), previousHash: current.head?.authorityHash || null, snapshot, contentHash, sourceReceiptIds: head.sourceReceiptIds }, { session });
  if (current.head) { const write = await db.collection('purchasedFulfillmentHeads').replaceOne({ ...filter, _id: head._id, version: current.version }, head, { session }); if (write.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); } else await db.collection('purchasedFulfillmentHeads').insertOne(head, { session });
  await db.collection('purchasedFulfillmentKeys').insertOne({ _id: randomUUID(), ...filter, key, kind, salesOrderId: head.salesOrderId, payloadHash, result: receipt, sourceReceiptIds: head.sourceReceiptIds }, { session });
  const event = { ...filter, salesOrderId: head.salesOrderId, version: head.version, kind, reason, recordedBy: actor, recordedAt: new Date(), sourceReceiptIds: head.sourceReceiptIds };
  for (const name of ['purchasedFulfillmentAudit', 'purchasedFulfillmentOutbox']) await db.collection(name).insertOne({ _id: randomUUID(), ...event, ...(name.endsWith('Outbox') ? { state: 'PENDING' } : {}) }, { session });
}

export async function initializePurchasedFulfillment(db) {
  for (const [name, keys] of [['purchasedFulfillmentHeads', { tenantId: 1, plantId: 1, salesOrderId: 1 }], ['purchasedFulfillmentEvents', { tenantId: 1, plantId: 1, salesOrderId: 1, version: 1 }], ['purchasedFulfillmentKeys', { tenantId: 1, plantId: 1, key: 1 }], ['catalogCustomerShipments', { tenantId: 1, plantId: 1, shipmentId: 1, reservationId: 1 }], ['purchasedShipmentProofs', { tenantId: 1, plantId: 1, shipmentId: 1 }], ['purchasedInvoiceProofs', { tenantId: 1, plantId: 1, invoiceId: 1 }], ['purchasedPaymentProofs', { tenantId: 1, plantId: 1, paymentId: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  for (const name of ['purchasedFulfillmentHeads', 'purchasedFulfillmentEvents', 'purchasedFulfillmentKeys', 'purchasedFulfillmentAudit', 'purchasedFulfillmentOutbox', 'purchasedShipmentProofs', 'purchasedInvoiceProofs', 'purchasedPaymentProofs']) await db.collection(name).createIndex({ tenantId: 1, plantId: 1, sourceReceiptIds: 1 });
  await db.collection('catalogMaterialReservations').createIndex({ tenantId: 1, plantId: 1, salesOrderId: 1, _id: 1 });
  await db.collection('catalogCustomerShipments').createIndex({ tenantId: 1, plantId: 1, receiptId: 1, reservationId: 1 });
}

export function installPurchasedFulfillment(app, runtime, { guard, fields, id }) {
  const db = runtime.db, root = '/api/purchased-fulfillment';
  app.use(root, async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.purchasedActions = req.method === 'GET' ? reads : req.method === 'POST' && req.path.endsWith('/shipments') ? ['catalog.stock.ship', 'fulfillment.ship'] : req.method === 'POST' && (/\/reservations$/.test(req.path) || /\/reservations\/[^/]+\/release$/.test(req.path)) ? ['catalog.stock.reserve', 'fulfillment.read'] : null;
    if (!req.purchasedActions) fail(404, 'NOT_FOUND');
    for (const action of req.purchasedActions) await runtime.foundation.authorize(req.scope, { ...req.filter, action });
    next();
  });
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  const paging = req => { const limit = req.query.limit === undefined ? 25 : Number(req.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit)) fail(400, 'INVALID_PAGINATION'); return { limit, cursor: req.query.cursor === undefined ? null : id(req.query.cursor) }; };
  app.get(`${root}/orders`, async (req, res) => { const { limit, cursor } = paging(req); res.json(await read(async session => { const proofs = await db.collection('quoteCatalogOrders').find({ ...req.filter, ...(cursor ? { orderId: { $gt: cursor } } : {}) }, { session }).sort({ orderId: 1 }).limit(limit + 1).toArray(), data = []; for (const proof of proofs.slice(0, limit)) { const current = await purchasedFulfillmentContext(db, req.filter, proof.orderId, session), order = current.order; data.push({ _id: order._id, orderNumber: order.orderNumber, accountId: order.accountId, status: order.status, version: order.version, purchasedLineCount: order.snapshot.lines.filter(line => line.catalogBinding.itemSnapshot.content.kind === 'PURCHASED').length }); } return { data, page: { limit, nextCursor: proofs.length > limit ? proofs[limit - 1].orderId : null } }; })); });
  app.get(`${root}/orders/:id`, async (req, res) => res.json({ data: await read(async session => view(db, req.filter, await purchasedFulfillmentContext(db, req.filter, id(req.params.id), session), session)) }));
  app.get(`${root}/orders/:id/events`, async (req, res) => { const { limit, cursor } = paging(req); res.json(await read(async session => { await purchasedFulfillmentContext(db, req.filter, id(req.params.id), session); const rows = await db.collection('purchasedFulfillmentEvents').find({ ...req.filter, salesOrderId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(); return { data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } }; })); });

  async function mutate(req, kind, effect) {
    const body = req.body, reason = body.reason;
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) fail(400, 'INVALID_TEXT');
    positive(body.expectedVersion);
    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const orderId = id(req.params.id), payloadHash = hash({ kind, orderId, body });
    for (let attempt = 1; ; attempt++) {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      for (const action of req.purchasedActions) await guard(runtime, req, session, action);
      const prior = await db.collection('purchasedFulfillmentKeys').findOne({ ...req.filter, key: body.idempotencyKey }, { session });
      if (prior && prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
      const current = await purchasedFulfillmentContext(db, req.filter, orderId, session);
      if (prior) {
        const event = current.events.find(event => event.snapshot.commandProof.key === body.idempotencyKey);
        if (!event || event.snapshot.commandProof.resultHash !== hash(prior.result)) purchasedInvalid();
        if (kind === 'SHIPMENT_POSTED') { const shipment = current.shipments.find(row => row._id === prior.result.shipmentId); if (!shipment || hash(shipment) !== prior.result.shipmentHash) purchasedInvalid(); return shipment; }
        return { ...await view(db, req.filter, current, session), commandReceipt: prior.result };
      }
      if (await db.collection('fulfillmentKeys').findOne({ ...req.filter, key: body.idempotencyKey }, { session })) fail(409, 'IDEMPOTENCY_CONFLICT');
      if (current.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (current.version >= 401) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
      const result = await effect(current, session);
      const receipt = kind === 'SHIPMENT_POSTED' ? { kind, salesOrderId: orderId, version: current.version + 1, shipmentId: result._id, shipmentHash: hash(shipmentSemantic(result)) } : { kind, salesOrderId: orderId, version: current.version + 1, reservationId: result._id, reservationVersion: result.version, reservationHash: result.contentHash };
      await save(db, req.filter, current, req.scope.userId, kind, reason.trim(), body.idempotencyKey, payloadHash, receipt, session);
      if (kind === 'SHIPMENT_POSTED') return result;
      return { ...await view(db, req.filter, await purchasedFulfillmentContext(db, req.filter, orderId, session), session), commandReceipt: receipt };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); } catch (error) { if (error.code === 11000 && attempt < 4) continue; if (error.code === 11000) fail(409, 'VERSION_CONFLICT'); throw error; } finally { await session.endSession(); }
    }
  }
  const common = ['expectedVersion', 'reason', 'idempotencyKey'];
  app.post(`${root}/orders/:id/reservations`, async (req, res) => {
    fields(req.body, [...common, 'expectedSalesOrderVersion', 'lineIndex', 'receiptId', 'expectedReceiptVersion', 'expectedStockVersion', 'quantity', 'unitIds']);
    const body = req.body; index(body.lineIndex); id(body.receiptId); positive(body.expectedSalesOrderVersion); positive(body.expectedReceiptVersion); positive(body.expectedStockVersion); quantity(body.quantity);
    if (body.unitIds !== undefined) { if (!Array.isArray(body.unitIds)) fail(400, 'INVALID_UNITS'); body.unitIds.forEach(id); }
    res.json({ data: await mutate(req, 'RESERVATION_CREATED', async (current, session) => {
      if (current.order.version !== body.expectedSalesOrderVersion) fail(409, 'VERSION_CONFLICT'); if (current.reservations.length >= 100 || current.shipments.length >= 100) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
      await currentLine(db, req.filter, current.order, body.lineIndex, session, true);
      const source = await catalogStockContext(db, req.filter, body.receiptId, session, { fresh: true, fence: true });
      if (source.receipt.version !== body.expectedReceiptVersion || source.use.version !== body.expectedStockVersion) fail(409, 'VERSION_CONFLICT');
      return writeCatalogReservation(db, req.filter, source, buildCustomerReservation(source, current, { lineIndex: body.lineIndex, quantity: body.quantity, unitIds: body.unitIds, actor: req.scope.userId }), req.scope.userId, body.reason.trim(), session);
    }) });
  });
  app.post(`${root}/orders/:id/reservations/:reservationId/release`, async (req, res) => {
    fields(req.body, [...common, 'expectedReservationVersion', 'expectedReceiptVersion', 'expectedStockVersion']); id(req.params.reservationId);
    for (const key of ['expectedReservationVersion', 'expectedReceiptVersion', 'expectedStockVersion']) positive(req.body[key]);
    res.json({ data: await mutate(req, 'RESERVATION_RELEASED', async (current, session) => {
      const row = current.reservations.find(row => row._id === req.params.reservationId); if (!row) fail(404, 'NOT_FOUND');
      const source = current.stocks.get(row.receiptId);
      if (row.version !== req.body.expectedReservationVersion || source.receipt.version !== req.body.expectedReceiptVersion || source.use.version !== req.body.expectedStockVersion) fail(409, 'VERSION_CONFLICT');
      if (units(row.remainingQuantity) === 0n) fail(409, 'STATE_CONFLICT');
      return writeCatalogReservation(db, req.filter, source, { ...hashless(row), status: 'RELEASED', releasedQuantity: decimal(units(row.releasedQuantity) + units(row.remainingQuantity)), remainingQuantity: '0' }, req.scope.userId, req.body.reason.trim(), session);
    }) });
  });
  app.post(`${root}/orders/:id/shipments`, async (req, res) => {
    fields(req.body, [...common, 'expectedSalesOrderVersion', 'lineIndex', 'reference', 'sources']); const body = req.body; index(body.lineIndex); positive(body.expectedSalesOrderVersion);
    if (typeof body.reference !== 'string' || !body.reference.trim() || body.reference.length > 200 || !Array.isArray(body.sources) || !body.sources.length || body.sources.length > 20) fail(400, 'INVALID_SOURCE');
    for (const part of body.sources) { fields(part, ['reservationId', 'expectedReservationVersion', 'expectedReceiptVersion', 'expectedStockVersion', 'quantity', 'unitIds']); id(part.reservationId); for (const key of ['expectedReservationVersion', 'expectedReceiptVersion', 'expectedStockVersion']) positive(part[key]); quantity(part.quantity); if (part.unitIds !== undefined && (!Array.isArray(part.unitIds) || part.unitIds.length > 100 || new Set(part.unitIds).size !== part.unitIds.length)) fail(400, 'INVALID_UNITS'); part.unitIds?.forEach(id); }
    if (new Set(body.sources.map(row => row.reservationId)).size !== body.sources.length) fail(400, 'INVALID_SOURCE');
    res.status(201).json({ data: await mutate(req, 'SHIPMENT_POSTED', async (current, session) => {
      if (current.order.version !== body.expectedSalesOrderVersion) fail(409, 'VERSION_CONFLICT'); if (current.shipments.length >= 100) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
      await currentLine(db, req.filter, current.order, body.lineIndex, session, true);
      const sources = [], movements = [], planned = [], fresh = new Map(), shipmentId = randomUUID(); let total = 0n, selectedCount = 0;
      for (const part of body.sources) {
        const row = current.reservations.find(row => row._id === part.reservationId); if (!row || row.lineIndex !== body.lineIndex) fail(409, 'SOURCE_CONFLICT');
        if (!fresh.has(row.receiptId)) fresh.set(row.receiptId, await catalogStockContext(db, req.filter, row.receiptId, session, { fresh: true, fence: true }));
        const source = fresh.get(row.receiptId), amount = quantity(part.quantity), unitIds = part.unitIds || [];
        if (source.receipt.version !== part.expectedReceiptVersion || source.use.version !== part.expectedStockVersion || row.version !== part.expectedReservationVersion) fail(409, 'VERSION_CONFLICT');
        if (amount > units(row.remainingQuantity)) fail(409, 'QUANTITY_EXCEEDED');
        if (source.origin.source.trackingPolicy === 'LOT' ? unitIds.length !== 0 : !unitIds.length || amount !== BigInt(unitIds.length) * 1000000n || unitIds.some(unitId => !row.unitIds.includes(unitId) || row.shippedUnitIds.includes(unitId))) fail(400, 'INVALID_UNITS');
        selectedCount += unitIds.length; if (selectedCount > 100) fail(400, 'INVALID_UNITS');
        const serials = unitIds.map(unitId => source.opening.units.find(unit => unit._id === unitId).serial), trace = { receiptId: row.receiptId, ...(source.receipt.lotNumber ? { lotNumber: source.receipt.lotNumber, heatNumber: source.receipt.heatNumber } : {}) };
        const movement = stamp({ _id: randomUUID(), ...req.filter, shipmentId, reservationId: row._id, receiptId: row.receiptId, salesOrderId: current.order._id, accountId: current.order.accountId, lineIndex: row.lineIndex, originHash: row.originHash, openingBalanceHash: row.openingBalanceHash, bindingHash: row.bindingHash, quantity: decimal(amount), uom: row.uom, unitIds, serials, kind: 'SHIP', from: 'CUSTOMER_RESERVED', to: 'SHIPPED', reason: body.reason.trim(), recordedBy: req.scope.userId, recordedAt: new Date() });
        movements.push(movement); total += amount;
        sources.push({ sourceType: 'CATALOG_RESERVATION', sourceId: row._id, receiptId: row.receiptId, quantity: decimal(amount), unitIds, ...(serials.length ? { serials } : {}), materialTrace: trace, movementId: movement._id, movementHash: movement.contentHash, originHash: row.originHash, openingBalanceHash: row.openingBalanceHash, bindingHash: row.bindingHash });
        const shipped = units(row.shippedQuantity) + amount, remaining = units(row.remainingQuantity) - amount;
        planned.push({ source, row: { ...hashless(row), status: remaining ? 'PARTIALLY_SHIPPED' : 'SHIPPED', remainingQuantity: decimal(remaining), shippedQuantity: decimal(shipped), shippedUnitIds: [...row.shippedUnitIds, ...unitIds] } });
      }
      for (const movement of movements) await db.collection('catalogCustomerShipments').insertOne(movement, { session });
      for (const change of planned) await writeCatalogReservation(db, req.filter, change.source, change.row, req.scope.userId, body.reason.trim(), session);
      const shipment = { _id: shipmentId, ...req.filter, schema: 'PURCHASED_SHIPMENT_V1', sourceReceiptIds: [...fresh.keys()], version: 1, createdBy: req.scope.userId, createdAt: new Date(), salesOrderId: current.order._id, accountId: current.order.accountId, lineIndex: body.lineIndex, uom: current.order.snapshot.lines[body.lineIndex].uom, quantity: decimal(total), stockMovementCount: sources.length, sources, reference: body.reference.trim(), status: 'SHIPPED', dispatchMode: 'OPERATOR_RECORDED', shippedBy: req.scope.userId, shippedAt: businessNow(runtime) };
      await db.collection('fulfillmentShipments').insertOne(shipment, { session });
      const proof = stamp({ _id: randomUUID(), ...req.filter, salesOrderId: current.order._id, shipmentId, orderHash: current.orderProof.orderHash, shipmentHash: hash(shipment), snapshot: shipment, sourceReceiptIds: [...fresh.keys()], movementRefs: movements.map(row => ({ movementId: row._id, contentHash: row.contentHash })) }); await db.collection('purchasedShipmentProofs').insertOne(proof, { session });
      for (const [kind, subjectId, lineIndex, amount] of [['SO_LINE_SHIPPED', current.order._id, body.lineIndex, total], ...sources.map(source => ['SOURCE_SHIPPED', source.sourceId, 0, units(source.quantity)])]) {
        const filter = { ...req.filter, kind, subjectId, lineIndex }, tally = await db.collection('fulfillmentTallies').findOne(filter, { session }), value = decimal(units(tally?.quantity || '0') + amount);
        if (tally) await db.collection('fulfillmentTallies').updateOne({ _id: tally._id, quantity: tally.quantity }, { $set: { quantity: value } }, { session }); else await db.collection('fulfillmentTallies').insertOne({ _id: randomUUID(), ...filter, quantity: value }, { session });
      }
      return shipment;
    }) });
  });
}
