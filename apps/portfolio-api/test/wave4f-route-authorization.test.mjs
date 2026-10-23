import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

test('privileged actions reject path aliases without durable effects; canonical owners still work', { timeout: 180000 }, async t => {
  const h = await startOwned(t), f = await orderWithStock(h, { orderQuantity: '4', receiptQuantity: '20', reserve: '2' });
  const viewer = h.seeded.find(x => x.username === 'alpha.viewer');
  const held = await h.send(`/warehouse/receipts/${f.receipt._id}/holds`, { body: { reasonCode: 'QC_SUSPECT', reasonNote: 'Path authorization test', expectedReceiptVersion: 4 }, headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal(held.status, 201);
  const holdId = held.data.hold.id;
  const q = await h.ok('/commercial/quotes', { accountId: f.account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Authorization fixture', quantity: '1', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] }, 201);
  const targets = [
    ['warehouseRelease', `/warehouse/holds/${holdId}/release`, { expectedVersion: 1, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Authorized release only' }],
    ['warehouseRead', `/warehouse/receipts/${f.receipt._id}/holds`, { expectedReceiptVersion: 5, reasonCode: 'QC_SUSPECT', reasonNote: 'Authorized apply only' }],
    ...['approve', 'accept', 'convert'].map(action => ['quoteEditor', `/commercial/quotes/${q._id}/${action}`, { expectedVersion: 1, revision: 1, idempotencyKey: randomUUID() }]),
    ...['shipments', 'invoices', 'payments'].map(resource => ['fulfillmentRead', `/fulfillment/${resource}`, { idempotencyKey: randomUUID() }]),
    ...['approve', 'convert'].map(action => ['procurementWrite', `/procurement/requests/${randomUUID()}/${action}`, { expectedVersion: 1, idempotencyKey: randomUUID() }]),
    ...['issue', 'vendor-confirmation'].map(action => ['procurementWrite', `/procurement/orders/${randomUUID()}/${action}`, { expectedVersion: 1, idempotencyKey: randomUUID() }]),
  ];
  const collections = ['stockHolds', 'warehouseReceipts', 'warehouseAudit', 'warehouseOutbox', 'quotes', 'salesOrders', 'commercialAudit', 'purchaseRequests', 'purchaseOrders', 'procurementAudit', 'procurementOutbox', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentAudit', 'fulfillmentOutbox'];
  const snapshot = async () => Object.fromEntries(await Promise.all(collections.map(async n => [n, await h.db.collection(n).find().sort({ _id: 1 }).toArray()])));
  const before = await snapshot();
  let checks = 0;
  for (const [role, path, body] of targets) {
    await h.setRoles(viewer, [role]);
    const cookie = await h.login('alpha.viewer');
    const segments = path.split('/');
    const encoded = segments.map((s, i) => i && !s.includes('-') && !/^[0-9a-f]{8}/.test(s) ? `%${s.charCodeAt(0).toString(16)}${s.slice(1)}` : s).join('/');
    const variants = new Set([path, path.toUpperCase(), `${path}/`, `${path}//`, `${path.toUpperCase()}/`, encoded, `${path.slice(0, path.lastIndexOf('/') + 1)}%${path.at(-1).charCodeAt(0).toString(16)}`]);
    for (const variant of variants) {
      const r = await h.send(variant, { body, cookie, headers: { 'Idempotency-Key': randomUUID() } });
      assert.ok([403, 404].includes(r.status), `${role} ${variant}: ${JSON.stringify(r)}`);
      checks++;
    }
  }
  assert.deepEqual(await snapshot(), before);
  const release = await h.send(`/warehouse/holds/${holdId}/release`, { body: targets[0][2], headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal(release.status, 200);
  assert.equal(release.data.hold.status, 'RELEASED');
  const approved = await h.ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  assert.equal(approved.status, 'APPROVED');
  const ship = await h.ok('/fulfillment/shipments', { salesOrderId: f.so._id, expectedVersion: f.so.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: f.reservation._id, quantity: '1' }], reference: 'Canonical owner shipment', idempotencyKey: randomUUID() }, 201);
  assert.equal(ship.sources[0].quantity, '1');
  console.log(`A_PATH_AUTHORIZATION denial_checks=${checks} canonical_commands=3 unchanged_collections=${collections.length}`);
});
