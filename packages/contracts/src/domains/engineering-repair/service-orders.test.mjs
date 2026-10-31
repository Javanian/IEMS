import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { runE02Prefix, e02Fixture } from '../../../../../apps/portfolio-api/test/support/review-e02-flow.mjs';
import { validateRepairSnapshot, diagnosticRepairSnapshot } from '../../../../../apps/portfolio-api/src/repair-orders.mjs';

test('repair snapshot validates exact VAT rather than trusting stored totals', () => {
  const scope = { currency: 'USD', total: '9990.00', netAmount: '9000.00', taxAmount: '990.00', grossAmount: '9990.00', taxRate: '0.11', taxPolicyVersion: 1, taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Repair', quantity: '1', unitPrice: '9000.00', currency: 'USD', netAmount: '9000.00', taxAmount: '990.00', grossAmount: '9990.00' }] };
  assert.equal(validateRepairSnapshot(scope).grossAmount, '9990.00');
  assert.throws(() => validateRepairSnapshot({ ...scope, taxAmount: '0.00' }), /SCOPE_CONFLICT/);
  assert.equal(diagnosticRepairSnapshot(scope, '1200.00').total, '1332.00');
});

test('canonical accepted/rejected scope creates reciprocal service orders and gross diagnostic billing atomically', async t => {
  let clock = new Date(e02Fixture.repair_case.intake_date);
  const h = await startOwned(t, { businessClock: () => clock }), cmd = values => ({ idempotencyKey: randomUUID(), ...values });
  for (const rejected of [false, true]) {
    const flow = await runE02Prefix(h, { setClock: date => { clock = date; } });
    let row = flow.case, path = `/repair/cases/${row._id}`;
    if (rejected) {
      const cap = await h.req(`${path}/decide`, cmd({ expectedVersion: row.version, revision: 1, decision: 'REJECT', diagnosticFee: '1332.00', evidence: 'Cannot bill gross as diagnostic net' }), h.alpha);
      assert.equal(cap.error.code, 'DIAGNOSTIC_CAP_EXCEEDED');
    }
    row = await h.ok(`${path}/decide`, cmd({ expectedVersion: row.version, revision: 1, decision: rejected ? 'REJECT' : 'ACCEPT', ...(rejected ? { diagnosticFee: '1200.00' } : {}), evidence: 'Original E02 scope decision' }));
    if (!rejected) assert.equal((await h.req(`${path}/start`, cmd({ expectedVersion: row.version }), h.alpha)).error.code, 'REPAIR_ORDERS_REQUIRED');
    const body = cmd({ expectedVersion: row.version, evidence: 'Create typed customer service commitments' });
    assert.equal((await h.req(`${path}/orders`, body, h.beta)).status, 404);
    await h.db.command({ collMod: 'repairOutbox', validator: { forbidden: { $exists: true } } });
    try { await assert.rejects(h.ok(`${path}/orders`, body)); } finally { await h.db.command({ collMod: 'repairOutbox', validator: {} }); }
    assert.equal(await h.db.collection('repairWorkOrders').countDocuments({ caseId: row._id }), 0);
    row = await h.ok(`${path}/orders`, body); assert.deepEqual(await h.ok(`${path}/orders`, body), row);
    const conflict = await h.req(`${path}/orders`, { ...body, evidence: 'Different command' }, h.alpha); assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
    const so = await h.db.collection('repairSalesOrders').findOne({ _id: row.serviceOrders.salesOrderId }), wo = await h.db.collection('repairWorkOrders').findOne({ _id: row.serviceOrders.workOrderId });
    assert.equal(so.workOrderId, wo._id); assert.equal(wo.salesOrderId, so._id); assert.equal(wo.serial, e02Fixture.customer_asset.serial_no); assert.equal(so.quoteRevision, 2); assert.equal(so.grossAmount, '9990.00');
    assert.equal(wo.status, rejected ? 'CANCELLED' : 'AUTHORIZED');
    if (rejected) {
      assert.equal(wo.cancelledBeforeRelease, true);
      let invoice = await h.ok(`/repair/invoices/${row.diagnosticInvoiceId}`);
      assert.equal(invoice.netAmount, '1200.00'); assert.equal(invoice.taxAmount, '132.00'); assert.equal(invoice.total, '1332.00');
      invoice = await h.ok(`/repair/invoices/${invoice._id}/settle`, cmd({ expectedVersion: invoice.version, amount: '1332.00', currency: 'USD', reference: 'E02-DIAGNOSTIC-SERVICE-TEST' }));
      assert.equal(invoice.remaining, '0.00');
      assert.equal((await h.req(`${path}/start`, cmd({ expectedVersion: row.version }), h.alpha)).status, 409);
    }
  }
  assert.equal(await h.db.collection('salesOrders').countDocuments(), 0);
  assert.equal(await h.db.collection('manufacturingWorkOrders').countDocuments(), 0);
});
