import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('independent owned HTTP serialized shipment race, replay authorization and source isolation', async t => {
  const h = await startOwned(t);
  const key = () => randomUUID();
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic independent serial race part', quantity: '3', uom: 'EA', unitPrice: '1.00', currency: 'USD' }] };
  const commercialOrder = async (cookie, label) => {
    const ok = (path, body, status = 200) => h.ok(path, body, status, cookie);
    const account = await ok('/crm/accounts', { name: label }, 201);
    const quote = await ok('/commercial/quotes', { ...content, accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 201);
    await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
    await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
    return ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  };
  const so = await commercialOrder(h.alpha, 'Synthetic independent race customer');
  const foreignSo = await commercialOrder(h.beta, 'Synthetic foreign race customer');
  const vendor = await h.ok('/procurement/vendors', { name: 'Synthetic independent race vendor' }, 201);
  const request = await h.ok('/procurement/requests', { ...content, vendorId: vendor._id }, 201);
  await h.ok(`/procurement/requests/${request._id}/approve`, { expectedVersion: 1 });
  const purchaseOrder = await h.ok(`/procurement/requests/${request._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await h.ok(`/procurement/orders/${purchaseOrder._id}/issue`, { expectedVersion: 1 });
  const receipt = await h.ok('/warehouse/receipts', { purchaseOrderId: purchaseOrder._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '3', uom: 'EA', lotNumber: 'QA-LOT', heatNumber: 'QA-HEAT', idempotencyKey: key() }, 201);
  await h.ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic QA inspection', idempotencyKey: key() });
  await h.ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'QA-SERIAL-BIN', idempotencyKey: key() });
  const planned = await h.ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, quantities: ['2', '1'], uom: 'EA', serialized: true, idempotencyKey: key() }, 201);
  const [primary, other] = planned.workOrders;
  const serialA = `QA-${key()}`, serialB = `QA-${key()}`, serialOther = `QA-${key()}`;
  for (const [wo, outputSerials] of [[primary, [serialA, serialB]], [other, [serialOther]]]) {
    await h.ok(`/manufacturing/work-orders/${wo._id}/release`, { expectedVersion: 1, operations: [{ code: 'QA-OP', instruction: 'Synthetic independent operation' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'EA' }], idempotencyKey: key() });
    await h.ok(`/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: wo.quantity, scrapQuantity: '0', uom: 'EA', evidence: 'Synthetic independent output evidence', outputSerials, idempotencyKey: key() });
    await h.ok(`/manufacturing/work-orders/${wo._id}/qc`, { expectedVersion: 3, acceptedQuantity: wo.quantity, rejectedQuantity: '0', uom: 'EA', evidence: 'Synthetic independent QC evidence', acceptedSerials: outputSerials, rejectedSerials: [], idempotencyKey: key() });
  }
  const shipment = (serial, idempotencyKey, salesOrderId = so._id) => ({ salesOrderId, expectedVersion: 1, lineIndex: 0, uom: 'EA', reference: 'QA-SERIAL-RACE', sources: [{ sourceType: 'WORK_ORDER', sourceId: primary._id, quantity: '1', serials: [serial] }], idempotencyKey });
  const collections = ['fulfillmentShipments', 'fulfillmentTallies', 'warehouseMovements', 'fulfillmentAudit', 'fulfillmentOutbox', 'fulfillmentKeys', 'manufacturingOutputUnits', 'warehouseSerials', 'manufacturingWorkOrders', 'warehouseReceipts'];
  const snapshot = async () => Object.fromEntries(await Promise.all(collections.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  const counts = async () => Object.fromEntries(await Promise.all(collections.map(async name => [name, await h.db.collection(name).countDocuments()])));
  let winnerBody, winner, loserKey;

  await t.test('two distinct keys competing for one accepted serial commit exactly one shipment', async () => {
    const before = await counts();
    const bodies = [shipment(serialA, key()), shipment(serialA, key())];
    const results = await Promise.all(bodies.map(body => h.req('/fulfillment/shipments', body, h.alpha)));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409], JSON.stringify(results));
    const winnerIndex = results.findIndex(result => result.status === 201);
    winnerBody = bodies[winnerIndex]; winner = results[winnerIndex].data; loserKey = bodies[1 - winnerIndex].idempotencyKey;
    assert.equal(results[1 - winnerIndex].error.code, 'SERIAL_STATE_CONFLICT');
    const after = await counts();
    for (const name of ['fulfillmentShipments', 'warehouseMovements', 'fulfillmentAudit', 'fulfillmentOutbox', 'fulfillmentKeys']) assert.equal(after[name] - before[name], 1, name);
    assert.equal(after.fulfillmentTallies - before.fulfillmentTallies, 2);
    for (const name of ['manufacturingOutputUnits', 'warehouseSerials', 'manufacturingWorkOrders', 'warehouseReceipts']) assert.equal(after[name], before[name], name);
    const unit = await h.db.collection('manufacturingOutputUnits').findOne({ serial: serialA });
    assert.equal(unit.status, 'SHIPPED'); assert.equal(unit.shipmentId, winner._id); assert.equal(unit.version, 3);
    for (const serial of [serialB, serialOther]) assert.equal((await h.db.collection('manufacturingOutputUnits').findOne({ serial })).status, 'ACCEPTED');
    const moves = await h.db.collection('warehouseMovements').find({ shipmentId: winner._id }).toArray();
    assert.equal(moves.length, 1); assert.deepEqual(moves[0].serials, [serialA]); assert.equal(moves[0].quantity, '1');
    assert.deepEqual(winner.sources[0].serials, [serialA]);
    for (const [kind, subjectId] of [['SOURCE_SHIPPED', primary._id], ['SO_LINE_SHIPPED', so._id]]) {
      const tallies = await h.db.collection('fulfillmentTallies').find({ kind, subjectId }).toArray();
      assert.equal(tallies.length, 1); assert.equal(tallies[0].quantity, '1');
    }
    assert.equal(await h.db.collection('fulfillmentKeys').countDocuments({ key: winnerBody.idempotencyKey }), 1);
    assert.equal(await h.db.collection('fulfillmentKeys').countDocuments({ key: loserKey }), 0);
    for (const name of ['fulfillmentAudit', 'fulfillmentOutbox']) assert.equal(await h.db.collection(name).countDocuments({ subjectId: winner._id }), 1, name);
    const committed = await snapshot();
    assert.deepEqual(await h.ok('/fulfillment/shipments', winnerBody, 201), winner);
    assert.deepEqual(await snapshot(), committed);
  });

  await t.test('failed key has no receipt and may ship a different still-accepted unit', async () => {
    assert.equal(await h.db.collection('fulfillmentKeys').countDocuments({ key: loserKey }), 0);
    const result = await h.ok('/fulfillment/shipments', shipment(serialB, loserKey), 201);
    assert.notEqual(result._id, winner._id);
    const unit = await h.db.collection('manufacturingOutputUnits').findOne({ serial: serialB });
    assert.equal(unit.status, 'SHIPPED'); assert.equal(unit.shipmentId, result._id);
    assert.equal(await h.db.collection('fulfillmentKeys').countDocuments({ key: loserKey }), 1);
    assert.equal((await h.db.collection('fulfillmentTallies').findOne({ kind: 'SOURCE_SHIPPED', subjectId: primary._id })).quantity, '2');
    assert.equal((await h.db.collection('fulfillmentTallies').findOne({ kind: 'SO_LINE_SHIPPED', subjectId: so._id })).quantity, '2');
  });

  await t.test('foreign work-order unit and cross-tenant source cannot write effects', async () => {
    const before = await snapshot();
    const wrongUnit = await h.req('/fulfillment/shipments', shipment(serialOther, key()), h.alpha);
    assert.equal(wrongUnit.status, 409); assert.equal(wrongUnit.error.code, 'SERIAL_SOURCE_CONFLICT');
    assert.deepEqual(await snapshot(), before);
    const foreignSource = await h.req('/fulfillment/shipments', shipment(serialA, key(), foreignSo._id), h.beta);
    assert.equal(foreignSource.status, 404); assert.equal(foreignSource.error.code, 'NOT_FOUND');
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('committing authorization fence denies a stored replay after membership revocation', async () => {
    const before = await snapshot(), original = h.runtime.foundation;
    const membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId });
    let revoked = false;
    h.runtime.foundation = { ...original, authorize: async (...args) => {
      const result = await original.authorize(...args);
      if (!revoked && args[1]?.action === 'fulfillment.ship') {
        revoked = true;
        await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } });
      }
      return result;
    } };
    try {
      const replay = await h.req('/fulfillment/shipments', winnerBody, h.alpha);
      assert.equal(revoked, true); assert.equal(replay.status, 403); assert.equal(replay.error.code, 'SCOPE_DENIED');
      assert.deepEqual(await snapshot(), before);
    } finally {
      h.runtime.foundation = original;
      await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } });
    }
    assert.deepEqual(await h.ok('/fulfillment/shipments', winnerBody, 201), winner);
    assert.deepEqual(await snapshot(), before);
  });
});
