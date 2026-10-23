import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

test('fulfillment owned Mongo HTTP shipment, invoice and payment slice', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`), marker = randomUUID();
  await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db }), password = randomUUID(), seeded = await seedSynthetic(runtime, { password });
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  async function req(path, body, cookie) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const alpha = (await req('/session/login', { username: 'alpha.owner', password })).cookie, beta = (await req('/session/login', { username: 'beta.owner', password })).cookie;
  const post = (path, body, cookie = alpha) => req(path, body, cookie);
  const ok = async (path, body, status = 200) => { const r = await post(path, body); assert.equal(r.status, status, `${path} ${JSON.stringify(r)}`); return r.data; };
  const key = () => randomUUID();
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic shipped item', quantity: '1.5', uom: 'KG', unitPrice: '0.05', currency: 'USD' }] };
  const account = await ok('/crm/accounts', { name: 'Synthetic fulfillment customer' }, 201);
  const other = await ok('/crm/accounts', { name: 'Synthetic other customer' }, 201);
  const quote = await ok('/commercial/quotes', { ...content, accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' }, 201);
  await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  assert.equal(so.snapshot.total, '0.08');
  const vendor = await ok('/procurement/vendors', { name: 'Synthetic vendor' }, 201);
  const pr = await ok('/procurement/requests', { ...content, lines: [{ ...content.lines[0], quantity: '5' }], vendorId: vendor._id }, 201);
  await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '5', uom: 'KG', idempotencyKey: key() }, 201);
  await ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic inspection', idempotencyKey: key() });
  await ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'SYNTHETIC-BIN', idempotencyKey: key() });
  await ok(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: 3, salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: '0.7', uom: 'KG', idempotencyKey: key() });
  const reservation = await db.collection('warehouseReservations').findOne({ salesOrderId: so._id });
  const plan = await ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1', '0.5'], idempotencyKey: key() }, 201);
  const [wo, planned] = plan.workOrders, woPath = `/manufacturing/work-orders/${wo._id}`;
  await ok(`${woPath}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Operator records make' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '2', uom: 'KG' }], idempotencyKey: key() });
  await ok(`${woPath}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic operator entry', idempotencyKey: key() });
  await ok(`${woPath}/qc`, { expectedVersion: 3, acceptedQuantity: '0.9', rejectedQuantity: '0.1', uom: 'KG', evidence: 'Synthetic inspector record', idempotencyKey: key() });
  const ship = (sources, extra = {}) => ({ salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', reference: 'SYN-DN-1', sources, idempotencyKey: key(), ...extra });
  const fromWo = quantity => ({ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity });
  const fromRes = quantity => ({ sourceType: 'RESERVATION', sourceId: reservation._id, quantity });
  const names = ['fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentTallies', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox', 'warehouseReceipts', 'salesOrders', 'manufacturingWorkOrders'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  async function rollback(path, body, status) {
    for (const collection of ['fulfillmentAudit', 'fulfillmentOutbox']) {
      const before = await snapshot();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try { const r = await post(path, body); assert.equal(r.status, 500, JSON.stringify(r)); assert.deepEqual(await snapshot(), before); }
      finally { await db.command({ collMod: collection, validator: {} }); }
    }
    const results = await Promise.all([1, 2, 3].map(() => post(path, body)));
    assert.deepEqual(results.map(r => r.status), [status, status, status], JSON.stringify(results));
    assert.deepEqual(results[1].data, results[0].data); assert.deepEqual(results[2].data, results[0].data);
    return results[0].data;
  }
  const shipments = [];
  await t.test('partial shipments draw only QC-accepted WO output and SO-line reservations, never overshipping', async () => {
    const before = await snapshot();
    assert.equal((await post('/fulfillment/shipments', ship([{ sourceType: 'WORK_ORDER', sourceId: planned._id, quantity: '0.1' }]))).error.code, 'STATE_CONFLICT');
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.91')]))).error.code, 'QUANTITY_EXCEEDED');
    assert.equal((await post('/fulfillment/shipments', ship([fromRes('0.71')]))).error.code, 'QUANTITY_EXCEEDED');
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1')], { uom: 'EA' }))).error.code, 'UOM_CONFLICT');
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1')], { expectedVersion: 2 }))).error.code, 'VERSION_CONFLICT');
    for (const quantity of [0.1, '0', '-1', '1e-1', '0.0000001']) assert.equal((await post('/fulfillment/shipments', ship([fromWo(quantity)]))).status, 400);
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1'), fromWo('0.1')]))).status, 400);
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1')], { salesOrderId: randomUUID() }))).status, 404);
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1')]), beta)).status, 404);
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1')], { tenant_id: seeded[1].tenantId }))).status, 403);
    assert.deepEqual(await snapshot(), before);
    const s1 = await ok('/fulfillment/shipments', ship([fromWo('0.5')]), 201);
    assert.deepEqual([s1.quantity, s1.uom, s1.status, s1.dispatchMode, s1.accountId], ['0.5', 'KG', 'SHIPPED', 'OPERATOR_RECORDED', account._id]);
    shipments.push(s1, await ok('/fulfillment/shipments', ship([fromWo('0.3'), fromRes('0.5')]), 201));
    assert.equal(shipments[1].quantity, '0.8');
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.1'), fromRes('0.2')]))).error.code, 'QUANTITY_EXCEEDED');
    shipments.push(await rollback('/fulfillment/shipments', ship([fromRes('0.2')]), 201));
    assert.equal((await post('/fulfillment/shipments', ship([fromWo('0.000001')]))).error.code, 'QUANTITY_EXCEEDED');
    const stock = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    assert.deepEqual([stock.reservedQuantity, stock.shippedQuantity, stock.availableQuantity], ['0', '0.7', '2.3']);
    const balances = await post(`/fulfillment/orders/${so._id}/balances`);
    assert.deepEqual(balances.data.lines[0], { lineIndex: 0, uom: 'KG', orderedQuantity: '1.5', shippedQuantity: '1.5', invoicedQuantity: '0' });
    assert.equal(await db.collection('fulfillmentShipments').countDocuments(), 3);
    assert.equal(await db.collection('fulfillmentAudit').countDocuments({ kind: 'shipment.recorded' }), 3);
    assert.equal((await db.collection('salesOrders').findOne({ _id: so._id })).version, 1);
  });
  const invoices = [];
  await t.test('invoices bill shipped quantity only with cumulative half-up exact decimal money', async () => {
    const invoice = (lines, extra = {}) => ({ salesOrderId: so._id, expectedVersion: 1, lines, idempotencyKey: key(), ...extra });
    assert.equal((await post('/fulfillment/invoices', invoice([{ shipmentId: shipments[0]._id, quantity: '0.500001' }]))).error.code, 'QUANTITY_EXCEEDED');
    assert.equal((await post('/fulfillment/invoices', invoice([{ shipmentId: randomUUID(), quantity: '0.1' }]))).status, 404);
    assert.equal((await post('/fulfillment/invoices', invoice([{ shipmentId: shipments[0]._id, quantity: '0.1' }]), beta)).status, 404);
    const i1 = await ok('/fulfillment/invoices', invoice([{ shipmentId: shipments[0]._id, quantity: '0.25' }]), 201);
    assert.deepEqual([i1.total, i1.currency, i1.outstandingAmount, i1.status, i1.lines[0].amount, i1.lines[0].uom], ['0.01', 'USD', '0.01', 'ISSUED', '0.01', 'KG']);
    assert.equal((await post('/fulfillment/invoices', invoice([{ shipmentId: shipments[0]._id, quantity: '0.26' }]))).error.code, 'QUANTITY_EXCEEDED');
    const i2 = await rollback('/fulfillment/invoices', invoice([{ shipmentId: shipments[0]._id, quantity: '0.25' }, { shipmentId: shipments[1]._id, quantity: '0.8' }, { shipmentId: shipments[2]._id, quantity: '0.2' }]), 201);
    assert.deepEqual(i2.lines.map(l => l.amount), ['0.02', '0.04', '0.01']);
    assert.equal(i2.total, '0.07');
    assert.equal((await post('/fulfillment/invoices', invoice([{ shipmentId: shipments[2]._id, quantity: '0.000001' }]))).error.code, 'QUANTITY_EXCEEDED');
    assert.equal((await post(`/fulfillment/orders/${so._id}/balances`)).data.lines[0].invoicedQuantity, '1.5');
    invoices.push(i1, i2);
  });
  await t.test('payments allocate exact currency amounts without overpayment, mismatch or cross-customer use', async () => {
    const pay = (allocations, extra = {}) => ({ accountId: account._id, currency: 'USD', reference: 'SYN-BANK-1', amount: allocations[0].amount, allocations, idempotencyKey: key(), ...extra });
    const before = await snapshot();
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.08' }]))).error.code, 'OVERPAYMENT');
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.05' }], { amount: '0.06' }))).error.code, 'ALLOCATION_MISMATCH');
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.1' }], { amount: '0.1' }))).error.code, 'INVALID_MONEY');
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '1' }], { amount: '1', currency: 'JPY' }))).error.code, 'CURRENCY_CONFLICT');
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.05' }], { amount: 0.05 }))).status, 400);
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.05' }], { accountId: other._id }))).error.code, 'ACCOUNT_CONFLICT');
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 2, amount: '0.05' }]))).error.code, 'VERSION_CONFLICT');
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.05' }]), beta)).status, 404);
    assert.deepEqual(await snapshot(), before);
    const races = await Promise.all([1, 2].map(() => post('/fulfillment/payments', pay([{ invoiceId: invoices[1]._id, expectedVersion: 1, amount: '0.05' }]))));
    assert.deepEqual(races.map(r => r.status).sort(), [201, 409], JSON.stringify(races));
    const final = await rollback('/fulfillment/payments', pay([{ invoiceId: invoices[0]._id, expectedVersion: 1, amount: '0.01' }, { invoiceId: invoices[1]._id, expectedVersion: 2, amount: '0.02' }], { amount: '0.03' }), 201);
    assert.deepEqual(final.allocations.map(a => [a.amount, a.invoiceStatus]), [['0.01', 'PAID'], ['0.02', 'PAID']]);
    const stored = await db.collection('fulfillmentInvoices').find().sort({ total: 1 }).toArray();
    assert.deepEqual(stored.map(i => [i.total, i.paidAmount, i.outstandingAmount, i.status, i.allocations.length]), [['0.01', '0.01', '0.00', 'PAID', 1], ['0.07', '0.07', '0.00', 'PAID', 2]]);
    assert.equal((await post('/fulfillment/payments', pay([{ invoiceId: invoices[0]._id, expectedVersion: 2, amount: '0.01' }]))).error.code, 'STATE_CONFLICT');
    assert.equal(await db.collection('fulfillmentPayments').countDocuments(), 2);
    assert.equal((await post('/fulfillment/payments')).data.length, 2);
  });
  await t.test('role grants, in-transaction revocation and idempotency conflicts deny without effects', async () => {
    const before = await snapshot();
    const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const setRole = role => db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role, plantIds: member.plantIds, tenantWide: false }] } });
    const bodies = { shipments: ship([fromWo('0.1')]), invoices: { salesOrderId: so._id, expectedVersion: 1, lines: [{ shipmentId: shipments[0]._id, quantity: '0.1' }], idempotencyKey: key() }, payments: { accountId: account._id, amount: '0.01', currency: 'USD', reference: 'X', allocations: [{ invoiceId: invoices[0]._id, expectedVersion: 2, amount: '0.01' }], idempotencyKey: key() } };
    try {
      for (const role of ['fulfillmentRead', 'fulfillmentShip', 'fulfillmentInvoice', 'fulfillmentPay', 'quoteReader']) {
        await setRole(role);
        assert.equal((await post('/fulfillment/shipments')).status, role === 'quoteReader' ? 403 : 200);
        for (const [path, action] of [['shipments', 'Ship'], ['invoices', 'Invoice'], ['payments', 'Pay']]) if (role !== `fulfillment${action}`) assert.equal((await post(`/fulfillment/${path}`, bodies[path])).status, 403, `${role} ${path}`);
      }
    } finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    const foundation = runtime.foundation;
    runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await setRole('fulfillmentRead'); return result; } };
    try { assert.equal((await post('/fulfillment/shipments', bodies.shipments)).status, 403); }
    finally { runtime.foundation = foundation; await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    const used = (await db.collection('fulfillmentKeys').findOne()).key;
    assert.equal((await post('/fulfillment/shipments', { ...bodies.shipments, idempotencyKey: used })).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await post('/fulfillment/payments', { ...bodies.payments, idempotencyKey: 'short' })).status, 400);
    assert.deepEqual(await snapshot(), before);
  });
});
