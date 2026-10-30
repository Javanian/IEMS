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
  const h = await startOwned(t), { so, reservation, account } = await orderWithStock(h);
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '0.7' }], reference: 'SETTLEMENT-SHIP', idempotencyKey: randomUUID() }, 201);
  let invoice = await h.ok('/fulfillment/invoices', { salesOrderId: so._id, expectedVersion: so.version, lines: [{ shipmentId: shipment._id, quantity: '0.7' }], dueAt: '2020-01-01T00:00:00.000Z', idempotencyKey: randomUUID() }, 201);
  assert.equal(invoice.total, '0.04');
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
  assert.deepEqual(await h.db.collection('fulfillmentInvoicePostings').findOne({ invoiceId: invoice._id }), original);
  assert.equal(await h.db.collection('fulfillmentCreditNotes').countDocuments({}), 1);
  const payments = await h.db.collection('reportingSnapshotOutbox').find({ 'envelope.payload.resourceType': 'payment' }).toArray();
  assert.equal(payments.length, 3); assert.equal(payments.filter(row => row.envelope.payload.source.cashEffect === 'NONE').length, 2);
  await h.db.collection('fulfillmentInvoices').updateOne({ _id: invoice._id }, { $set: { total: '99.99' } });
  assert.equal((await h.req(`/fulfillment/invoices/${invoice._id}`, undefined, h.alpha)).status, 409);
});
