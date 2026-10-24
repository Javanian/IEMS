import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

test('VAT cumulative fractional minor units conserve tax independently across currencies and lines', async t => {
  const h = await startOwned(t), { ok, db } = h;
  const post = (path, body) => h.req(path, body, h.alpha);
  const account = await ok('/crm/accounts', { name: 'Synthetic rounding customer' }, 201);
  for (const [currency, price, expected] of [['USD', '0.05', ['0.08', '0.01', '0.09']], ['JPY', '5', ['8', '1', '9']], ['KWD', '0.005', ['0.008', '0.001', '0.009']]]) {
    const content = { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Fractional fixture', quantity: '1.5', unitPrice: price, currency, uom: 'KG' }] };
    const q = await ok('/commercial/quotes', content, 201);
    assert.deepEqual([q.revisions[0].netAmount, q.revisions[0].taxAmount, q.revisions[0].grossAmount], expected);
    await ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
    await ok(`/commercial/quotes/${q._id}/accept`, { expectedVersion: 2, revision: 1 });
    const so = await ok(`/commercial/quotes/${q._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: randomUUID() });
    // This test isolates invoice arithmetic; only the canonical test creates shipment sources through mounted product commands.
    const shipmentId = randomUUID();
    await db.collection('fulfillmentShipments').insertOne({ _id: shipmentId, tenantId: so.tenantId, plantId: so.plantId, salesOrderId: so._id, lineIndex: 0, quantity: '1.5', uom: 'KG', status: 'SHIPPED' });
    const invoices = [];
    for (const quantity of ['0.5', '0.5', '0.5']) invoices.push(await ok('/fulfillment/invoices', { salesOrderId: so._id, expectedVersion: 1, lines: [{ shipmentId, quantity }], idempotencyKey: randomUUID() }, 201));
    const minor = s => BigInt(s.replace('.', ''));
    for (const [i, field] of ['netAmount', 'taxAmount', 'grossAmount'].entries()) assert.equal(invoices.reduce((n, r) => n + minor(r[field]), 0n), minor(expected[i]));
    assert.deepEqual(invoices.map(r => minor(r.taxAmount)), [0n, 1n, 0n]);
    const entitlement = await ok(`/fulfillment/orders/${so._id}/entitlement`);
    assert.deepEqual(entitlement.billed, entitlement.authorized);
    for (const invoice of invoices) {
      const line = invoice.lines[0];
      assert.equal(minor(line.rounding.afterTaxAmount) - minor(line.rounding.beforeTaxAmount), minor(line.taxAmount));
      assert.equal(minor(line.netAmount) + minor(line.taxAmount), minor(line.grossAmount));
    }
    const unchanged = await db.collection('quotes').findOne({ _id: q._id });
    for (const extra of [{ taxRate: '0.2' }, { taxPolicyVersion: 2 }, { lines: [{ ...content.lines[0], taxRate: '0.11' }] }, { taxPolicy: 'VAT' }]) assert.equal((await post('/commercial/quotes', { ...content, ...extra })).status, 400);
    assert.deepEqual(await db.collection('quotes').findOne({ _id: q._id }), unchanged);
  }
});
