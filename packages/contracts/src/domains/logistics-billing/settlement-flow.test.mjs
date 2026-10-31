import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from '../../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { minorUnits, formatMinor, agingBucket } from './values.mjs';
import { ownerPurchasedFixture } from '../../../../../apps/portfolio-api/test/support/purchased-owner-fixture.mjs';

test('currency precision and aging do not round through Number or infer missing due dates', () => {
  const value = '1234567890123456789012345678.123';
  assert.equal(formatMinor(minorUnits(value, 'KWD'), 'KWD'), value);
  assert.throws(() => minorUnits('1.001', 'USD'));
  assert.equal(agingBucket(null, new Date()), 'UNDATED');
  assert.equal(agingBucket('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'), 'DAYS_1_30');
  assert.equal(agingBucket('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), 'DAYS_31_60');
});

test('canonical purchased invoice proofs accept credit settlement without changing issued contents', async t => {
  const h = await startOwned(t), f = await ownerPurchasedFixture(h);
  const reserved = await f.reserve(0, f.lotReceipt, '0.5');
  const claim = reserved.view.reservations.find(row => row.lineIndex === 0);
  const { shipment } = await f.ship(claim._id, '0.5');
  let invoice = await h.ok('/fulfillment/invoices', { salesOrderId: f.so._id, expectedVersion: f.so.version, lines: [{ shipmentId: shipment._id, quantity: '0.5' }], idempotencyKey: randomUUID() }, 201);
  await h.ok('/fulfillment/payments', { accountId: f.account._id, amount: '0.25', currency: 'USD', reference: 'Purchased credit', settlementKind: 'CREDIT', creditReason: 'Synthetic approved price allowance', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '0.25' }], idempotencyKey: randomUUID() }, 201);
  invoice = await h.ok(`/fulfillment/invoices/${invoice._id}`);
  assert.equal(invoice.paidAmount, '0.00'); assert.equal(invoice.creditedAmount, '0.25'); assert.equal(invoice.outstandingAmount, '0.75');
  assert.equal((await f.read()).shipments.length, 1);
  assert.equal((await h.ok(`/fulfillment/accounts/${f.account._id}/ledger`)).invoices[0].agingBucket, 'UNDATED');
});

test('deposit, credit and partial cash settlement keep posted invoice and cash facts distinct', async t => {
  const h = await startOwned(t), { so, reservation, account } = await orderWithStock(h, { orderQuantity: '0.7' });
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '0.7' }], reference: 'SETTLEMENT-SHIP', idempotencyKey: randomUUID() }, 201);
  let invoice = await h.ok('/fulfillment/invoices', { salesOrderId: so._id, expectedVersion: so.version, lines: [{ shipmentId: shipment._id, quantity: '0.7' }], dueAt: '2020-01-01T00:00:00.000Z', idempotencyKey: randomUUID() }, 201);
  assert.equal(invoice.total, '0.04');
  assert.equal(await h.db.collection('reportingSnapshotSources').countDocuments({ 'source.id': invoice._id }), 1);
  assert.equal(await h.db.collection('reportingSnapshotOutbox').countDocuments({ 'envelope.payload.resourceType': 'order', aggregateId: so._id }), 1);
  const original = await h.db.collection('fulfillmentInvoicePostings').findOne({ invoiceId: invoice._id });
  const receipt = { accountId: account._id, currency: 'USD', amount: '0.02', reference: 'Deposit receipt', idempotencyKey: randomUUID() };
  const deposit = await h.ok('/fulfillment/deposits', receipt, 201);
  assert.deepEqual(await h.ok('/fulfillment/deposits', receipt, 201), deposit);
  const apply = { accountId: account._id, currency: 'USD', amount: '0.02', reference: 'Deposit allocation', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '0.02' }], settlementKind: 'DEPOSIT', depositId: deposit._id, expectedDepositVersion: 1, idempotencyKey: randomUUID() };
  await h.ok('/fulfillment/payments', apply, 201);
  assert.equal((await h.ok(`/fulfillment/invoices/${invoice._id}`)).outstandingAmount, '0.02');
  assert.equal((await h.req('/fulfillment/payments', { ...apply, idempotencyKey: randomUUID() }, h.alpha)).status, 409);
  invoice = await h.ok(`/fulfillment/invoices/${invoice._id}`);
  const credit = { accountId: account._id, currency: 'USD', amount: '0.01', reference: 'Approved commercial credit', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '0.01' }], settlementKind: 'CREDIT', creditReason: 'Synthetic approved adjustment', idempotencyKey: randomUUID() };
  const note = await h.ok('/fulfillment/payments', credit, 201);
  assert.deepEqual(await h.ok('/fulfillment/payments', credit, 201), note);
  invoice = await h.ok(`/fulfillment/invoices/${invoice._id}`);
  assert.equal(invoice.paidAmount, '0.02'); assert.equal(invoice.creditedAmount, '0.01');
  await h.ok('/fulfillment/payments', { accountId: account._id, currency: 'USD', amount: '0.01', reference: 'Final partial payment', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '0.01' }], idempotencyKey: randomUUID() }, 201);
  invoice = await h.ok(`/fulfillment/invoices/${invoice._id}`);
  assert.equal(invoice.status, 'SETTLED'); assert.equal(invoice.paidAmount, '0.03'); assert.equal(invoice.outstandingAmount, '0.00');
  const ledger = await h.ok(`/fulfillment/accounts/${account._id}/ledger`);
  assert.equal(ledger.complete, true); assert.equal(ledger.deposits[0].availableAmount, '0.00');
  assert.equal(ledger.invoices[0].agingBucket, 'DAYS_91_PLUS');
  const closurePath = `/fulfillment/orders/${so._id}/closure`;
  assert.ok((await h.ok(closurePath)).reasons.includes('DELIVERY_NOT_CONFIRMED'));
  const deliveryPath = `/deliveries/shipments/${shipment._id}`, delivery = await h.ok(deliveryPath);
  await h.ok(`${deliveryPath}/confirmations`, { expectedVersion: delivery.version, expectedShipmentVersion: shipment.version, quantity: '0.7', deliveredAt: new Date().toISOString(), receiverName: 'Synthetic receiver', receiverReference: 'CLOSE-POD', evidenceReference: 'Closure receiving note', evidenceNotes: 'Synthetic full receipt', idempotencyKey: randomUUID() }, 201);
  assert.equal((await h.ok(closurePath)).status, 'FULFILLED_EVIDENCED');
  const returnPath = `${deliveryPath}/returns`, returns = await h.ok(returnPath);
  await h.ok(returnPath, { expectedVersion: returns.version, quantity: '0.1', serials: [], reference: 'Closure return', reason: 'Synthetic return after settlement', idempotencyKey: randomUUID() }, 201);
  assert.equal((await h.ok(closurePath)).status, 'OPEN_OBLIGATIONS');
  assert.ok((await h.ok(closurePath)).reasons.includes('QUARANTINED_RETURNS'));

  assert.deepEqual(await h.db.collection('fulfillmentInvoicePostings').findOne({ invoiceId: invoice._id }), original);
  assert.equal(await h.db.collection('fulfillmentCreditNotes').countDocuments({}), 1);
  const payments = await h.db.collection('reportingSnapshotOutbox').find({ 'envelope.payload.resourceType': 'payment' }).toArray();
  assert.equal(payments.length, 3); assert.equal(payments.filter(row => row.envelope.payload.source.cashEffect === 'NONE').length, 2);
  const otherInvoices = [];
  for (let index = 0; index < 2; index++) {
    let quote = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic same-account order', quantity: '0.1', uom: 'KG', unitPrice: '0.10', currency: 'USD' }] }, 201);
    for (const action of ['approve', 'accept']) quote = await h.ok(`/commercial/quotes/${quote._id}/${action}`, { expectedVersion: quote.version, revision: 1 });
    const order = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: quote.version, revision: 1, idempotencyKey: randomUUID() });
    const receipt = await h.db.collection('warehouseReceipts').findOne({ _id: reservation.receiptId });
    await h.ok(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: receipt.version, salesOrderId: order._id, accountId: account._id, lineIndex: 0, quantity: '0.1', uom: 'KG', idempotencyKey: randomUUID() });
    const claim = await h.db.collection('warehouseReservations').findOne({ salesOrderId: order._id });
    const part = await h.ok('/fulfillment/shipments', { salesOrderId: order._id, expectedVersion: order.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: claim._id, quantity: '0.1' }], reference: 'Grouped settlement dispatch', idempotencyKey: randomUUID() }, 201);
    otherInvoices.push(await h.ok('/fulfillment/invoices', { salesOrderId: order._id, expectedVersion: order.version, lines: [{ shipmentId: part._id, quantity: '0.1' }], idempotencyKey: randomUUID() }, 201));
  }
  const groupedBody = { accountId: account._id, amount: '0.02', currency: 'USD', reference: 'Two-order cash allocation', allocations: otherInvoices.map(row => ({ invoiceId: row._id, expectedVersion: row.version, amount: '0.01' })), idempotencyKey: randomUUID() };
  const grouped = await h.ok('/fulfillment/payments', groupedBody, 201);
  const snapshots = await h.db.collection('reportingSnapshotOutbox').find({ 'envelope.payload.source.id': grouped._id }).toArray();
  assert.equal(snapshots.length, 2);
  assert.equal(new Set(snapshots.map(row => row.envelope.aggregateId)).size, 2);
  assert.ok(snapshots.every(row => row.envelope.payload.amount === '0.010000000000'));
  assert.deepEqual(await h.ok('/fulfillment/payments', groupedBody, 201), grouped);
  assert.equal(await h.db.collection('reportingSnapshotOutbox').countDocuments({ 'envelope.payload.source.id': grouped._id }), 2);
  await h.db.collection('fulfillmentInvoices').updateOne({ _id: invoice._id }, { $set: { total: '99.99' } });
  assert.equal((await h.req(`/fulfillment/invoices/${invoice._id}`, undefined, h.alpha)).status, 409);
});
