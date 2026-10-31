import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { ownerPurchasedFixture } from '../../apps/portfolio-api/test/support/purchased-owner-fixture.mjs';
import { companyOwnerFixture } from '../../apps/portfolio-api/test/support/company-stock-owner-fixture.mjs';
import { createReportingSource } from '../../apps/portfolio-api/src/reporting-source.mjs';
import { appendFulfillmentReporting } from '../../apps/portfolio-api/src/fulfillment.mjs';
import { initializeReportingSnapshots } from './snapshot-source.mjs';

async function source(h) {
  const scope = await h.scopeOf(h.alpha);
  const adapter = createReportingSource({ ...h.runtime, authorizeResource: async ({ grant, resource }) => {
    assert.equal(resource.tenantId, grant.tenantId);
    assert.equal(resource.plantId, grant.plantId);
  } });
  await adapter.initialize();
  return { scope, adapter };
}
const outbox = h => h.db.collection('reportingSnapshotOutbox').find({}).sort({ _id: 1 }).toArray();
async function overlap(h, collection) {
  const { scope, adapter } = await source(h), before = await outbox(h);
  const page = await adapter.reconcile({ scope, collection });
  assert.equal(page.manifest.coverage, 'INCOMPLETE');
  assert.equal(page.manifest.trustedZero, false);
  assert.deepEqual(await outbox(h), before, 'bootstrap must reuse actual live event IDs, sequence and times');
  await adapter.reconcile({ scope, collection });
  assert.deepEqual(await outbox(h), before);
  return { scope, adapter, page };
}
async function bootstrapFirst(h, collection, rows) {
  // A fresh projection namespace retains every source receipt and existing live projection.
  const db = { collection: name => h.db.collection(name.startsWith('reporting') ? `parity_${name}` : name) };
  const runtime = { ...h.runtime, db }, scope = await h.scopeOf(h.alpha);
  const adapter = createReportingSource({ ...runtime, authorizeResource: async ({ grant, resource }) => {
    assert.equal(resource.tenantId, grant.tenantId); assert.equal(resource.plantId, grant.plantId);
  } });
  await initializeReportingSnapshots(db); await adapter.initialize();
  await adapter.reconcile({ scope, collection });
  const before = await db.collection('reportingSnapshotOutbox').find({}).sort({ _id: 1 }).toArray();
  assert.ok(before.length > 0); assert.ok(before.every(row => row.envelope.payload.baseline));
  const session = h.client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const row of rows) {
        const original = before.find(e => e.envelope.payload.source.id === row._id).envelope;
        const kind = original.payload.resourceType === 'payment' ? 'payment.recorded' : 'shipment.recorded';
        await appendFulfillmentReporting(runtime, { scope, filter: { tenantId: scope.tenantId, plantId: scope.selectedPlantId }, fulfillmentAction: 'fulfillment.read' }, kind, row, session, original.payload.source.eventIds[0]);
      }
    });
  } finally { await session.endSession(); }
  assert.deepEqual(await db.collection('reportingSnapshotOutbox').find({}).sort({ _id: 1 }).toArray(), before, 'live overlap preserves baseline identity/time instead of creating a revision');
}

test('generic shipment and multi-order cash/deposit/credit bootstrap preserve live identity and metadata', async t => {
  const h = await startOwned(t), first = await orderWithStock(h, { orderQuantity: '1', reserve: '1' });
  const second = await orderWithStock(h, { orderQuantity: '1', reserve: null });
  // Both orders belong to one real customer; create the second approved order through the same account.
  let quote = await h.ok('/commercial/quotes', { accountId: first.account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Second grouped order', quantity: '1', uom: 'KG', unitPrice: '0.05', currency: 'USD' }] }, 201);
  for (const action of ['approve', 'accept']) quote = await h.ok(`/commercial/quotes/${quote._id}/${action}`, { expectedVersion: quote.version, revision: 1 });
  const so2 = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: quote.version, revision: 1, idempotencyKey: randomUUID() });
  await h.ok(`/warehouse/receipts/${second.receipt._id}/reserve`, { expectedVersion: 3, salesOrderId: so2._id, accountId: first.account._id, lineIndex: 0, quantity: '1', uom: 'KG', idempotencyKey: randomUUID() });
  const reservation2 = await h.db.collection('warehouseReservations').findOne({ salesOrderId: so2._id });
  const invoices = [];
  for (const [so, reservation] of [[first.so, first.reservation], [so2, reservation2]]) {
    const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '1' }], reference: 'Bootstrap parity', idempotencyKey: randomUUID() }, 201);
    invoices.push(await h.ok('/fulfillment/invoices', { salesOrderId: so._id, expectedVersion: so.version, lines: [{ shipmentId: shipment._id, quantity: '1' }], idempotencyKey: randomUUID() }, 201));
  }
  const deposit = await h.ok('/fulfillment/deposits', { accountId: first.account._id, amount: '0.02', currency: 'USD', reference: 'Parity deposit', idempotencyKey: randomUUID() }, 201);
  const payments = [];
  for (const settlementKind of ['CASH', 'DEPOSIT', 'CREDIT']) {
    const current = await Promise.all(invoices.map(i => h.ok(`/fulfillment/invoices/${i._id}`)));
    payments.push(await h.ok('/fulfillment/payments', { accountId: first.account._id, amount: '0.02', currency: 'USD', reference: 'Parity settlement', settlementKind, ...(settlementKind === 'DEPOSIT' ? { depositId: deposit._id, expectedDepositVersion: 1 } : {}), ...(settlementKind === 'CREDIT' ? { creditReason: 'Approved synthetic adjustment' } : {}), allocations: current.map(i => ({ invoiceId: i._id, expectedVersion: i.version, amount: '0.01' })), idempotencyKey: randomUUID() }, 201));
  }
  const { scope, adapter, page } = await overlap(h, 'fulfillmentKeys');
  await bootstrapFirst(h, 'fulfillmentKeys', [...payments, ...await h.db.collection('fulfillmentShipments').find({}).toArray()]);
  assert.equal(page.manifest.unsupported[0].kind, 'deposit.recorded');
  for (const p of payments) {
    const events = page.envelopes.filter(e => e.payload.source.id === p._id);
    assert.equal(events.length, 2);
    assert.equal(new Set(events.map(e => e.aggregateId)).size, 2);
    for (const e of events) {
      assert.equal(e.payload.amount, '0.010000000000');
      assert.equal(e.payload.source.settlementKind, p.settlementKind);
      assert.equal(e.payload.source.cashEffect, p.settlementKind === 'CASH' ? 'RECEIPT' : 'NONE');
    }
  }
  const coverage = await adapter.reconcileScope({ scope });
  assert.equal(coverage.manifest.coverage, 'INCOMPLETE'); assert.equal(coverage.manifest.trustedZero, false);
  const before = await outbox(h);
  await h.db.collection('fulfillmentCreditNotes').updateOne({ paymentId: payments[2]._id }, { $set: { amount: '999.00' } });
  await assert.rejects(adapter.reconcile({ scope, collection: 'fulfillmentKeys' }), /SETTLEMENT_AUTHORITY_MISSING/);
  assert.deepEqual(await outbox(h), before);
  assert.equal((await h.db.collection('reportingSourceQuarantine').findOne({ reason: 'SETTLEMENT_AUTHORITY_MISSING' })).cursorAdvanced, false);
  const restore = await h.setRoles(h.seeded[0], ['fulfillmentRead']);
  try { await assert.rejects(adapter.reconcile({ scope, collection: 'fulfillmentKeys' })); } finally { await restore(); }
});

test('purchased bootstrap uses actual shipment authority event, canonical fences and live source key', async t => {
  const h = await startOwned(t), f = await ownerPurchasedFixture(h);
  const reserved = await f.reserve(0, f.lotReceipt, '0.5');
  const { shipment } = await f.ship(reserved.view.reservations.find(r => r.lineIndex === 0)._id, '0.5');
  await h.db.collection('fulfillmentShipments').updateOne({ _id: shipment._id }, { $set: { documentFence: 1, deliveryUseFence: 2 } });
  const { scope, adapter, page } = await overlap(h, 'fulfillmentShipments');
  await bootstrapFirst(h, 'fulfillmentShipments', [shipment]);
  const e = page.envelopes.find(e => e.aggregateId === shipment._id);
  assert.equal(e.payload.source.collection, 'fulfillmentShipments');
  assert.equal(e.payload.quantity, '0.5');
  assert.ok(await h.db.collection('purchasedFulfillmentEvents').findOne({ _id: e.payload.source.eventIds[0], kind: 'SHIPMENT_POSTED' }));
  await h.db.collection('purchasedShipmentProofs').updateOne({ shipmentId: shipment._id }, { $set: { shipmentHash: '0'.repeat(64) } });
  await assert.rejects(adapter.reconcile({ scope, collection: 'fulfillmentShipments' }));
  assert.equal((await h.db.collection('reportingSourceQuarantine').findOne({ collection: 'fulfillmentShipments' })).cursorAdvanced, false);
});

test('manufactured bootstrap validates company output authority and rejects missing immutable receipt', async t => {
  const h = await startOwned(t), f = await companyOwnerFixture(h);
  const account = await h.ok('/crm/accounts', { name: 'Synthetic reporting manufactured' }, 201);
  let quote = await h.ok('/commercial/quotes', { schema: 'CATALOG_QUOTE_V1', accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Manufactured parity', quantity: '1', uom: 'UN', unitPrice: '10.00', currency: 'USD', catalogItem: { itemId: f.component._id, itemVersion: f.component.version, itemRevision: f.component.currentRevision } }], idempotencyKey: randomUUID() }, 201);
  for (const action of ['approve', 'accept']) quote = await h.ok(`/commercial/quotes/${quote._id}/${action}`, { expectedVersion: quote.version, revision: 1, idempotencyKey: randomUUID() });
  const so = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: quote.version, revision: 1, idempotencyKey: randomUUID() });
  const stock = await f.company(), unit = stock.units.find(u => u.status === 'AVAILABLE');
  const shipment = await h.ok('/fulfillment/manufactured-shipments', { salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'UN', reference: 'Manufactured parity', packageReference: 'PARITY-1', sources: [{ companyReceiptId: stock._id, expectedStockVersion: stock.version, units: [{ companyUnitId: unit._id, expectedUnitVersion: unit.version }] }], idempotencyKey: randomUUID() }, 201);
  const { scope, adapter, page } = await overlap(h, 'fulfillmentShipments');
  await bootstrapFirst(h, 'fulfillmentShipments', [shipment]);
  assert.equal(page.envelopes.find(e => e.aggregateId === shipment._id).payload.quantity, '1');
  await h.db.collection('fulfillmentKeys').updateOne({ 'result._id': shipment._id }, { $set: { 'result.quantity': '2' } });
  await assert.rejects(adapter.reconcile({ scope, collection: 'fulfillmentShipments' }), /SHIPMENT_IMMUTABLE_RECEIPT_CONFLICT/);
  assert.equal((await h.db.collection('reportingSourceQuarantine').findOne({ collection: 'fulfillmentShipments' })).cursorAdvanced, false);
});
