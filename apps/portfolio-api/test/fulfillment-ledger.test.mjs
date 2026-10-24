import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

test('shipment stock ledger: scoped immutable SHIP movements commit with every fulfillment effect', async t => {
  const h = await startOwned(t), { db, req, ok, alpha, beta, seeded } = h;
  const { account, so, receipt, reservation, key } = await orderWithStock(h, { orderQuantity: '3', receiptQuantity: '5', reserve: '1' });
  const plan = await ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1'], idempotencyKey: key() }, 201);
  const wo = plan.workOrders[0], woPath = `/manufacturing/work-orders/${wo._id}`;
  await ok(`${woPath}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Operator records make' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: key() });
  const ship = (sources, extra = {}) => ({ salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', reference: 'SYN-DN-L', sources, idempotencyKey: key(), ...extra });
  const fromRes = quantity => ({ sourceType: 'RESERVATION', sourceId: reservation._id, quantity });
  const fromWo = quantity => ({ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity });
  const names = ['warehouseMovements', 'warehouseReservations', 'warehouseReceipts', 'manufacturingMovements', 'manufacturingWorkOrders', 'fulfillmentShipments', 'fulfillmentTallies', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox', 'salesOrders'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  const shipMoves = filter => db.collection('warehouseMovements').find({ kind: 'SHIP', ...filter }).sort({ createdAt: 1 }).toArray();

  await t.test('reconciliation replays receipt movements plus manufacturing material reservation', async () => {
    const r = await ok(`/warehouse/receipts/${receipt._id}/reconciliation`);
    assert.equal(r.matches, true, JSON.stringify(r));
    assert.deepEqual(r.replayed, { availableQuantity: '3', reservedQuantity: '1', shippedQuantity: '0', manufacturingReservedQuantity: '1', manufacturingConsumedQuantity: '0' });
    assert.deepEqual(r.cached, r.replayed);
    assert.equal(r.materialMovementCount, 1);
    assert.equal((await req(`/warehouse/receipts/${receipt._id}/reconciliation`, undefined, beta)).status, 404);
  });

  await t.test('partial reservation shipment appends one RESERVED->SHIPPED movement and marks the reservation partial', async () => {
    const s = await ok('/fulfillment/shipments', ship([fromRes('0.4')]), 201);
    assert.equal(s.stockMovementCount, 1);
    const [m] = await shipMoves({ shipmentId: s._id });
    assert.deepEqual([m.kind, m.from, m.to, m.quantity, m.uom, m.receiptId, m.reservationId, m.salesOrderId, m.accountId, m.tenantId, m.plantId, m.sourceType], ['SHIP', 'RESERVED', 'SHIPPED', '0.4', 'KG', receipt._id, reservation._id, so._id, account._id, seeded[0].tenantId, seeded[0].plantId, 'RESERVATION']);
    const res = await db.collection('warehouseReservations').findOne({ _id: reservation._id });
    assert.deepEqual([res.status, res.shippedQuantity, res.remainingQuantity, res.quantity, res.version], ['PARTIALLY_SHIPPED', '0.4', '0.6', '1', 2]);
    const r = await ok(`/warehouse/receipts/${receipt._id}/reconciliation`);
    assert.equal(r.matches, true); assert.deepEqual([r.replayed.reservedQuantity, r.replayed.shippedQuantity], ['0.6', '0.4']);
  });

  await t.test('fault injection at movement, audit and outbox writes rolls back movements, reservations and every tally', async () => {
    const body = ship([fromRes('0.1')]);
    for (const collection of ['warehouseMovements', 'fulfillmentAudit', 'fulfillmentOutbox']) {
      const before = await snapshot();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try { const r = await req('/fulfillment/shipments', body, alpha); assert.equal(r.status, 500, `${collection} ${JSON.stringify(r)}`); assert.deepEqual(await snapshot(), before, collection); }
      finally { await db.command({ collMod: collection, validator: {} }); }
    }
    const replays = await Promise.all([1, 2, 3].map(() => req('/fulfillment/shipments', body, alpha)));
    assert.deepEqual(replays.map(r => r.status), [201, 201, 201], JSON.stringify(replays));
    assert.deepEqual(replays[1].data, replays[0].data); assert.deepEqual(replays[2].data, replays[0].data);
    assert.equal((await shipMoves({ shipmentId: replays[0].data._id })).length, 1, 'same-key replay produces one movement');
  });

  await t.test('two different keys competing for the last reserved quantity: one wins, one movement, no overship', async () => {
    const before = (await shipMoves({})).length;
    const results = await Promise.all([1, 2].map(() => req('/fulfillment/shipments', ship([fromRes('0.5')]), alpha)));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409], JSON.stringify(results));
    assert.equal((await shipMoves({})).length, before + 1);
    const res = await db.collection('warehouseReservations').findOne({ _id: reservation._id });
    assert.deepEqual([res.status, res.shippedQuantity, res.remainingQuantity], ['CONSUMED', '1', '0']);
    assert.equal((await req('/fulfillment/shipments', ship([fromRes('0.000001')]), alpha)).error.code, 'STATE_CONFLICT');
    const r = await ok(`/warehouse/receipts/${receipt._id}/reconciliation`);
    assert.equal(r.matches, true); assert.deepEqual([r.replayed.reservedQuantity, r.replayed.shippedQuantity, r.cached.shippedQuantity], ['0', '1', '1']);
  });

  await t.test('work-order shipment moves QC-accepted output and leaves raw-material receipt counters untouched', async () => {
    await ok(`${woPath}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic operator entry', idempotencyKey: key() });
    await ok(`${woPath}/qc`, { expectedVersion: 3, acceptedQuantity: '0.8', rejectedQuantity: '0.2', uom: 'KG', evidence: 'Synthetic inspector', idempotencyKey: key() });
    const stockBefore = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const s = await ok('/fulfillment/shipments', ship([fromWo('0.8')]), 201);
    const [m] = await shipMoves({ shipmentId: s._id });
    assert.deepEqual([m.from, m.to, m.quantity, m.workOrderId, m.receiptId, m.sourceType], ['QC_ACCEPTED_OUTPUT', 'SHIPPED', '0.8', wo._id, undefined, 'WORK_ORDER']);
    assert.deepEqual(await db.collection('warehouseReceipts').findOne({ _id: receipt._id }), stockBefore);
    assert.equal((await req('/fulfillment/shipments', ship([fromWo('0.000001')]), alpha)).error.code, 'QUANTITY_EXCEEDED');
    const r = await ok(`/warehouse/receipts/${receipt._id}/reconciliation`);
    assert.equal(r.matches, true, JSON.stringify(r));
    assert.deepEqual([r.replayed.manufacturingReservedQuantity, r.replayed.manufacturingConsumedQuantity, r.materialMovementCount], ['0', '1', 2]);
  });

  await t.test('order reconciliation: SO tally = shipment rows = SHIP movements, per source too', async () => {
    const r = await ok(`/fulfillment/orders/${so._id}/reconciliation`);
    assert.equal(r.matches, true, JSON.stringify(r));
    assert.deepEqual(r.lines, [{ lineIndex: 0, uom: 'KG', talliedQuantity: '1.8', shipmentQuantity: '1.8', movementQuantity: '1.8', matches: true }]);
    assert.deepEqual(r.sources.map(s => [s.sourceType, s.talliedQuantity, s.movementQuantity]).sort(), [['RESERVATION', '1', '1'], ['WORK_ORDER', '0.8', '0.8']]);
    assert.equal(r.movementCount, 4); assert.equal(r.shipmentCount, 4);
    assert.equal((await req(`/fulfillment/orders/${so._id}/reconciliation`, undefined, beta)).status, 404);
  });

  await t.test('source, customer and plant conflicts are refused without stock effects', async () => {
    const other = await orderWithStock(h, { orderQuantity: '1', receiptQuantity: '2', reserve: '0.5' });
    const before = await snapshot();
    assert.equal((await req('/fulfillment/shipments', ship([{ sourceType: 'RESERVATION', sourceId: other.reservation._id, quantity: '0.1' }]), alpha)).error.code, 'SOURCE_CONFLICT');
    assert.equal((await req('/fulfillment/shipments', ship([fromWo('0.1')], { salesOrderId: other.so._id }), alpha)).error.code, 'SOURCE_CONFLICT');
    assert.equal((await req('/fulfillment/shipments', ship([fromRes('0.1')], { tenant_id: seeded[1].tenantId }), alpha)).status, 403);
    assert.equal((await req('/fulfillment/shipments', ship([fromRes('0.1')], { plantId: seeded[1].plantId }), alpha)).status, 403);
    assert.equal((await req('/fulfillment/shipments', ship([fromRes('0.1')]), beta)).status, 404);
    assert.deepEqual(await snapshot(), before);
    // Simulated corrupt reservation pointing at another customer: shipment must refuse rather than trust it.
    await db.collection('warehouseReservations').updateOne({ _id: other.reservation._id }, { $set: { accountId: account._id } });
    const forged = await snapshot();
    assert.equal((await req('/fulfillment/shipments', ship([{ sourceType: 'RESERVATION', sourceId: other.reservation._id, quantity: '0.1' }], { salesOrderId: other.so._id }), alpha)).error.code, 'ACCOUNT_CONFLICT');
    assert.deepEqual(await snapshot(), forged);
    await db.collection('manufacturingWorkOrders').updateOne({ _id: wo._id }, { $set: { accountId: other.account._id } });
    const forgedWo = await snapshot();
    assert.equal((await req('/fulfillment/shipments', ship([fromWo('0.1')]), alpha)).error.code, 'ACCOUNT_CONFLICT');
    assert.deepEqual(await snapshot(), forgedWo);
  });

  await t.test('tampered cached counter is reported as a reconciliation mismatch', async () => {
    await db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, { $set: { shippedQuantity: '0.9' } });
    const r = await ok(`/warehouse/receipts/${receipt._id}/reconciliation`);
    assert.equal(r.matches, false); assert.deepEqual([r.cached.shippedQuantity, r.replayed.shippedQuantity], ['0.9', '1']);
    await db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, { $set: { shippedQuantity: '1' } });
    assert.equal((await ok(`/warehouse/receipts/${receipt._id}/reconciliation`)).matches, true);
  });
});
