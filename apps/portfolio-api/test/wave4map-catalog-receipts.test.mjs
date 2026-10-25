import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

const key = () => randomUUID(), command = values => ({ expectedVersion: 1, reason: 'Supplemental physical procurement evidence', idempotencyKey: key(), ...values });
const root = '/catalog-procurement', masters = '/inventory-master/items';

test('MAP actual typed procurement preserves immutable item identities through quarantined physical receipts', async t => {
  const h = await startOwned(t), post = (path, body, cookie = h.alpha) => h.req(path, body, cookie), ok = h.ok;
  const legacy = await orderWithStock(h, { reserve: null });
  const vendor = await ok('/procurement/vendors', { name: 'Supplemental real vendor' }, 201);
  const unchangedNames = ['accounts', 'quotes', 'salesOrders', 'purchaseRequests', 'purchaseOrders', 'manufacturingWorkOrders', 'manufacturingAllocated', 'manufacturingOutputUnits', 'manufacturingMovements', 'warehouseReservations', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentTallies', 'internalProductionOrders', 'serialCustodyUnits', 'serialCustodyClaims', 'installationEdges'];
  const unchanged = () => Promise.all(unchangedNames.map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray())), beforeLegacy = await unchanged();
  const names = ['inventoryItems', 'inventoryItemRevisions', 'internalPlanningEvents', 'internalPlanningKeys', 'catalogPurchaseRequests', 'catalogPurchaseOrders', 'catalogRequestRevisions', 'catalogOrderRevisions', 'catalogRequestLineIds', 'catalogEvents', 'catalogReceived', 'catalogKeys', 'catalogAudit', 'catalogOutbox', 'warehouseReceipts', 'warehouseReceiptOrigins', 'warehouseMovements', 'warehouseSerials'];
  const snapshot = () => Promise.all(names.map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const item = async (code, trackingPolicy, kind = 'PURCHASED') => {
    const created = await ok(masters, command({ code, description: `Supplemental ${code}`, kind, uom: 'KG', ...(trackingPolicy ? { schema: 'INVENTORY_ITEM_V2', trackingPolicy } : {}) }), 201);
    return ok(`${masters}/${created._id}/approve`, command({ expectedVersion: created.version, revision: 1 }));
  };
  const line = (source, quantity = '2.5') => ({ itemId: source._id, itemVersion: source.version, itemRevision: source.currentRevision, quantity, unitPrice: '1.25', currency: 'USD' });
  const requestBody = lines => command({ vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines });
  const issue = async lines => { const draft = await ok(`${root}/requests`, requestBody(lines), 201), approved = await ok(`${root}/requests/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: draft.currentRevision })), order = await ok(`${root}/requests/${draft._id}/convert`, command({ expectedVersion: approved.version })); return ok(`${root}/orders/${order._id}/issue`, command({ expectedVersion: order.version })); };
  const receiptBody = (order, source, quantity, extra = {}) => command({ expectedVersion: order.version, purchaseOrderId: order._id, vendorId: vendor._id, lineId: order.content.lines.find(row => row.itemId === source._id).lineId, quantity, ...(source.content.trackingPolicy === 'LOT' ? { lotNumber: 'SUPPLIER-LOT', heatNumber: 'SUPPLIER-HEAT' } : {}), ...extra });
  let lot, serial, order, lotReceipt, serialReceipt, initialRequest, initialBody, replayBody;

  await t.test('tracking policy requires a new approved revision and never defaults onto V1', async () => {
    const old = await item('OLD_V1'), manufactured = await item('NEW_MANUFACTURED', 'LOT', 'MANUFACTURED'), before = await snapshot();
    assert.equal(Object.hasOwn(old.content, 'schema'), false); assert.equal(Object.hasOwn(old.content, 'trackingPolicy'), false);
    for (const extra of [{ schema: 'INVENTORY_ITEM_V2' }, { trackingPolicy: 'LOT' }, { schema: null, trackingPolicy: 'LOT' }]) assert.equal((await post(masters, command({ code: 'BAD_POLICY', description: 'Invalid partial policy', kind: 'PURCHASED', uom: 'KG', ...extra }))).status, 400);
    assert.equal((await post(`${root}/requests`, requestBody([line(old)]))).error.code, 'CATALOG_DEPENDENCY_CHANGED');
    assert.equal((await post(`${root}/requests`, requestBody([line(manufactured)]))).error.code, 'CATALOG_DEPENDENCY_CHANGED'); assert.deepEqual(await snapshot(), before);
    lot = await item('TYPED_LOT', 'LOT'); serial = await item('TYPED_SERIAL', 'SERIAL');
    const original = await ok(`${masters}/${old._id}/revisions/1`), next = await ok(`${masters}/${old._id}/revisions`, command({ expectedVersion: old.version, description: 'New explicit tracking policy', kind: 'PURCHASED', uom: 'KG', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' }));
    assert.equal(next.status, 'DRAFT'); assert.deepEqual(await ok(`${masters}/${old._id}/revisions/1`), original);
  });
  await t.test('exact money and stable immutable lines survive removed/re-added request materials', async () => {
    const before = await snapshot();
    for (const lines of [[line(lot), line(lot)], [line(serial, '1.5')], [line(serial, '101')], [{ ...line(lot), uom: 'KG' }]]) assert.equal((await post(`${root}/requests`, requestBody(lines))).status, 400);
    assert.deepEqual(await snapshot(), before);
    initialBody = requestBody([line(lot)]); initialRequest = await ok(`${root}/requests`, initialBody, 201); const lineId = initialRequest.content.lines[0].lineId;
    assert.equal(initialRequest.content.total, '3.13'); assert.equal(initialRequest.content.lines[0].lineTotal, '3.13'); assert.equal(initialRequest.content.lines[0].trackingPolicy, 'LOT');
    for (const [currency, unitPrice, expected] of [['JPY', '1', '3'], ['KWD', '1.001', '2.503'], ['USD', '0.00', '0.00']]) { const priced = await ok(`${root}/requests`, requestBody([{ ...line(lot), currency, unitPrice }]), 201); assert.equal(priced.content.total, expected); }
    assert.deepEqual((await post(`${root}/requests`, initialBody)).data, initialRequest);
    assert.equal((await post(`${root}/requests`, { ...initialBody, reason: 'Different reason creates conflict' })).error.code, 'IDEMPOTENCY_CONFLICT');
    let current = await ok(`${root}/requests/${initialRequest._id}/revisions`, { ...requestBody([line(serial, '2')]), expectedVersion: initialRequest.version });
    current = await ok(`${root}/requests/${current._id}/revisions`, { ...requestBody([line(lot), line(serial, '2')]), expectedVersion: current.version }); assert.equal(current.content.lines[0].lineId, lineId);
    const immutable = await ok(`${root}/requests/${current._id}/revisions/3`), approved = await ok(`${root}/requests/${current._id}/approve`, command({ expectedVersion: current.version, revision: 3 })); assert.deepEqual(await ok(`${root}/requests/${current._id}/revisions/3`), immutable);
    const convert = command({ expectedVersion: approved.version }), converted = await ok(`${root}/requests/${current._id}/convert`, convert); assert.deepEqual((await post(`${root}/requests/${current._id}/convert`, convert)).data, converted);
    assert.equal(converted.requestId, current._id); assert.equal(converted.content.lines[0].lineId, lineId); assert.equal(converted.status, 'DRAFT');
    order = await ok(`${root}/orders/${converted._id}/issue`, command({ expectedVersion: converted.version })); assert.equal(order.status, 'ISSUED');
    assert.equal((await post(`${root}/requests/${current._id}/revisions`, { ...requestBody([line(lot)]), expectedVersion: approved.version + 1 })).error.code, 'STATE_CONFLICT');
    const revisions = await post(`${root}/requests/${current._id}/revisions?limit=2`); assert.equal(revisions.data.length, 2); assert.ok(revisions.page.nextCursor); assert.ok(revisions.data.every(row => !Object.hasOwn(row, 'content')));
  });
  await t.test('physical LOT partial and SERIAL receiving create one ledger identity each, never usable stock', async () => {
    const before = await snapshot();
    for (const patch of [{ lotNumber: null }, { heatNumber: undefined }, { serials: ['FAKE'] }, { serials: null }]) { const body = { ...receiptBody(order, lot, '1.25'), ...patch }; assert.equal((await post(`${root}/receipts`, body)).status, 400); }
    assert.equal((await post(`${root}/receipts`, receiptBody(order, serial, '2', { serials: ['SAME', 'SAME'] }))).status, 400); assert.deepEqual(await snapshot(), before);
    replayBody = receiptBody(order, lot, '1.25'); lotReceipt = await ok(`${root}/receipts`, replayBody, 201); const second = await ok(`${root}/receipts`, receiptBody(order, lot, '1.25', { lotNumber: 'SECOND-LOT' }), 201);
    serialReceipt = await ok(`${root}/receipts`, receiptBody(order, serial, '2', { serials: ['ACTUAL-SOURCE-001', 'ACTUAL-SOURCE-002'] }), 201);
    for (const receipt of [lotReceipt, second, serialReceipt]) {
      assert.equal(receipt.status, 'QUARANTINED'); assert.equal(receipt.availableQuantity, '0'); assert.equal(receipt.reservedQuantity, '0'); assert.equal(receipt.usable, false); assert.deepEqual(receipt.receiptOrigin, { cohort: 'CATALOG', legacyEligible: false });
      const origins = await h.db.collection('warehouseReceiptOrigins').find({ receiptId: receipt._id }).toArray(), movements = await h.db.collection('warehouseMovements').find({ receiptId: receipt._id }).toArray(); assert.equal(origins.length, 1); assert.equal(movements.length, 1); assert.equal(origins[0].receiveMovementId, movements[0]._id); assert.equal(movements[0].kind, 'RECEIVE'); assert.equal(movements[0].to, 'QUARANTINE');
    }
    assert.equal(await h.db.collection('warehouseSerials').countDocuments({ receiptId: serialReceipt._id }), 2); assert.equal(await h.db.collection('warehouseSerials').countDocuments({ receiptId: lotReceipt._id }), 0);
    const current = await ok(`${root}/orders/${order._id}`); assert.deepEqual(current.receiving.map(row => row.receivedQuantity), ['2.5', '2']); assert.deepEqual(current.receiving.map(row => row.remainingQuantity), ['0', '0']); assert.deepEqual(current.receiving.map(row => row.receiptCount), [2, 1]); assert.equal(current.version, order.version);
    const after = await snapshot(); assert.equal((await post(`${root}/receipts`, receiptBody(order, lot, '0.1'))).error.code, 'QUANTITY_EXCEEDED'); assert.deepEqual(await snapshot(), after);
    assert.deepEqual((await post(`${root}/receipts`, replayBody)).data, lotReceipt); assert.deepEqual(await snapshot(), after);
  });
  await t.test('concurrent receiving conserves exact entitlement and serial registry conflicts roll back', async () => {
    const race = await issue([line(lot, '1')]), outcomes = await Promise.all([post(`${root}/receipts`, receiptBody(race, lot, '1')), post(`${root}/receipts`, receiptBody(race, lot, '1'))]);
    assert.deepEqual(outcomes.map(row => row.status).sort(), [201, 409]); assert.equal((await ok(`${root}/orders/${race._id}`)).receiving[0].receivedQuantity, '1');
    const duplicateOrder = await issue([line(serial, '1')]), before = await snapshot(); assert.equal((await post(`${root}/receipts`, receiptBody(duplicateOrder, serial, '1', { serials: ['ACTUAL-SOURCE-001'] }))).error.code, 'SERIAL_CONFLICT'); assert.deepEqual(await snapshot(), before);
    const huge = await issue([{ ...line(lot, '9007199254740993.123456'), unitPrice: '0.01' }]); assert.equal(huge.content.total, '90071992547409.93');
  });
  await t.test('outbox failure rolls back actual receipt, source fences, entitlement, origin, registry and durable key', async () => {
    const rollback = await issue([line(serial, '1')]), before = await snapshot();
    await h.db.command({ collMod: 'catalogOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post(`${root}/receipts`, receiptBody(rollback, serial, '1', { serials: ['ROLLBACK-REAL-SERIAL'] }))).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: 'catalogOutbox', validator: {} }); }
  });
  await t.test('corrupt origin, marker, immutable PO, RECEIVE and serial registry fail closed on read/use', async () => {
    const origin = await h.db.collection('warehouseReceiptOrigins').findOne({ receiptId: lotReceipt._id }), raw = await h.db.collection('warehouseReceipts').findOne({ _id: lotReceipt._id }), rev = await h.db.collection('catalogOrderRevisions').findOne({ subjectId: order._id }), movement = await h.db.collection('warehouseMovements').findOne({ receiptId: lotReceipt._id }), registry = await h.db.collection('warehouseSerials').findOne({ receiptId: serialReceipt._id });
    for (const [name, original, update, path] of [
      ['warehouseReceiptOrigins', origin, { $set: { 'physical.quantity': '9' } }, `${root}/receipts/${lotReceipt._id}`],
      ['warehouseReceipts', raw, { $unset: { catalogSource: '' } }, `${root}/receipts/${lotReceipt._id}`],
      ['catalogOrderRevisions', rev, { $set: { 'content.lines.0.quantity': '999' } }, `${root}/orders/${order._id}`],
      ['warehouseMovements', movement, { $set: { quantity: '99' } }, `${root}/receipts/${lotReceipt._id}`],
      ['warehouseSerials', registry, { $set: { sourceType: 'UNKNOWN' } }, `${root}/receipts/${serialReceipt._id}`],
      ['warehouseSerials', registry, { $set: { workOrderId: null } }, `${root}/receipts/${serialReceipt._id}`],
      ['warehouseSerials', registry, { $set: { workOrderId: key() } }, `${root}/receipts/${serialReceipt._id}`],
      ['warehouseSerials', registry, { $set: { unitId: null } }, `${root}/receipts/${serialReceipt._id}`],
      ['warehouseSerials', registry, { $set: { unitId: key() } }, `${root}/receipts/${serialReceipt._id}`],
    ]) { await h.db.collection(name).updateOne({ _id: original._id }, update); try { assert.equal((await post(path)).error.code, 'CATALOG_SOURCE_INVALID'); } finally { await h.db.collection(name).replaceOne({ _id: original._id }, original); } }
    const duplicate = { ...movement, _id: key() }; await h.db.collection('warehouseMovements').insertOne(duplicate);
    try { assert.equal((await post(`${root}/receipts/${lotReceipt._id}`)).error.code, 'CATALOG_SOURCE_INVALID'); } finally { await h.db.collection('warehouseMovements').deleteOne({ _id: duplicate._id }); }
    const head = await h.db.collection('catalogPurchaseOrders').findOne({ _id: order._id }); await h.db.collection('catalogPurchaseOrders').updateOne({ _id: head._id }, { $set: { status: 'DRAFT' } });
    try { assert.equal((await post(`${root}/orders/${order._id}`)).error.code, 'CATALOG_SOURCE_INVALID'); } finally { await h.db.collection('catalogPurchaseOrders').replaceOne({ _id: head._id }, head); }
    const tally = await h.db.collection('catalogReceived').findOne({ purchaseOrderId: order._id, lineId: origin.source.purchaseOrderLineId }); await h.db.collection('warehouseReceiptOrigins').deleteOne({ _id: origin._id }); await h.db.collection('catalogReceived').updateOne({ _id: tally._id }, { $set: { quantity: '1.25', receiptCount: 1 } });
    try { assert.equal((await post(`${root}/orders/${order._id}`)).error.code, 'CATALOG_SOURCE_INVALID'); } finally { await h.db.collection('warehouseReceiptOrigins').insertOne(origin); await h.db.collection('catalogReceived').replaceOne({ _id: tally._id }, tally); }
    for (const counter of ['shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity']) { await h.db.collection('warehouseReceipts').updateOne({ _id: raw._id }, { $set: { [counter]: '1' } }); try { assert.equal((await post(`${root}/receipts/${raw._id}`)).error.code, 'CATALOG_SOURCE_INVALID'); } finally { await h.db.collection('warehouseReceipts').replaceOne({ _id: raw._id }, raw); } }
  });
  await t.test('scope and committing authorization guard fresh actions and durable replay without expanded grants', async () => {
    assert.equal((await post(`${root}/orders/${order._id}`, undefined, h.beta)).status, 404); assert.equal((await post(`${root}/receipts/${lotReceipt._id}`, undefined, h.beta)).status, 404);
    const restore = await h.setRoles(h.seeded[0], ['procurementWrite', 'warehouseReceive']); try { assert.equal((await post(`${root}/requests`, requestBody([line(lot)]))).status, 403); } finally { await restore(); }
    const before = await snapshot(), foundation = h.runtime.foundation, membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId });
    for (const body of [initialBody, { ...initialBody, idempotencyKey: key() }]) {
      h.runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [{ role: 'catalogReader', plantIds: membership.plantIds }] } }); return result; } };
      try { assert.equal((await post(`${root}/requests`, body)).status, 403); } finally { h.runtime.foundation = foundation; await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('new master revision blocks fresh intake while immutable historical identity/replay remains and old stock/customer effects stay exact', async () => {
    const pending = await issue([line(lot, '1')]), priorMasterRevision = await ok(`${masters}/${lot._id}/revisions/1`);
    await ok(`${masters}/${lot._id}/revisions`, command({ expectedVersion: lot.version, description: 'New pending catalogue definition', kind: 'PURCHASED', uom: 'KG', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' }));
    const before = await snapshot(); assert.equal((await post(`${root}/receipts`, receiptBody(pending, lot, '1'))).error.code, 'CATALOG_DEPENDENCY_CHANGED'); assert.deepEqual(await snapshot(), before);
    assert.ok((await ok(`${root}/orders/${order._id}`)).blockers.includes('ITEM_CHANGED')); assert.ok((await ok(`${root}/receipts/${lotReceipt._id}`)).blockers.includes('ITEM_CHANGED'));
    assert.deepEqual(await ok(`${masters}/${lot._id}/revisions/1`), priorMasterRevision); assert.deepEqual((await post(`${root}/receipts`, replayBody)).data, lotReceipt);
    assert.deepEqual(await unchanged(), beforeLegacy); assert.equal((await ok(`/warehouse/receipts/${legacy.receipt._id}`)).status, 'STORED');
    const page = await post(`${root}/receipts?limit=2`); assert.equal(page.data.length, 2); assert.ok(page.page.nextCursor); assert.ok(page.data.every(row => row.usable === false));
  });
});
