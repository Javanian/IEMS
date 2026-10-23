import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

test('warehouse real owned Mongo HTTP receipt to reservation', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: fileURLToPath(new URL('../../../packages/mongodb-spike/.runtime/binary/mongod-x64-win32-7.0.14.exe', import.meta.url)), version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
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
  const vendor = (await post('/procurement/vendors', { name: 'Synthetic warehouse vendor' })).data;
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic material', quantity: '1.250', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] };
  async function po() {
    const pr = (await post('/procurement/requests', { ...content, vendorId: vendor._id })).data;
    await post(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
    const order = (await post(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() })).data;
    await post(`/procurement/orders/${order._id}/issue`, { expectedVersion: 1 }); return order;
  }
  const order = await po();
  const body = { purchaseOrderId: order._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '1.250', uom: 'KG', idempotencyKey: randomUUID() };
  let receipt;
  await t.test('concurrent identical receipts quarantine exactly once from issued PO', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => post('/warehouse/receipts', body)));
    assert.deepEqual(results.map(r => r.status), [201, 201, 201, 201], JSON.stringify(results));
    assert.equal(new Set(results.map(r => r.data._id)).size, 1); receipt = results[0].data;
    assert.equal(receipt.status, 'QUARANTINED'); assert.equal(receipt.quantity, '1.250');
    assert.equal(await db.collection('warehouseMovements').countDocuments(), 1);
    assert.equal((await post('/warehouse/receipts', { ...body, idempotencyKey: randomUUID() })).status, 409);
    assert.equal((await post('/warehouse/receipts', { ...body, quantity: '1' })).status, 409);
  });
  await t.test('scope vendor UOM exact quantities and lifecycle fail closed', async () => {
    assert.equal((await post(`/warehouse/receipts/${receipt._id}`, undefined, beta)).status, 404);
    assert.equal((await post('/warehouse/receipts', { ...body, tenant_id: seeded[1].tenantId })).status, 403);
    for (const change of [{ quantity: 1 }, { quantity: '-1' }, { quantity: '1e0' }, { quantity: '0' }, { quantity: '1.0000001' }]) assert.equal((await post('/warehouse/receipts', { ...body, ...change, idempotencyKey: randomUUID() })).status, 400);
    assert.equal((await post('/warehouse/receipts', { ...body, uom: 'EA', idempotencyKey: randomUUID() })).status, 409);
    assert.equal((await post('/warehouse/receipts', { ...body, vendorId: randomUUID(), idempotencyKey: randomUUID() })).status, 404);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 1, location: 'BIN-1', idempotencyKey: randomUUID() })).status, 409);
  });
  await t.test('receipt audit outbox validators roll back every stock effect then allow retry', async () => {
    const next = await po(), b = { ...body, purchaseOrderId: next._id, idempotencyKey: randomUUID() };
    const names = ['warehouseReceipts', 'warehouseReceived', 'warehouseMovements', 'warehouseKeys', 'warehouseAudit', 'warehouseOutbox'];
    for (const collection of ['warehouseAudit', 'warehouseOutbox']) {
      const before = await Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try {
        assert.equal((await post('/warehouse/receipts', b)).status, 500);
        assert.deepEqual(await Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray())), before);
      } finally { await db.command({ collMod: collection, validator: {} }); }
    }
    assert.equal((await post('/warehouse/receipts', b)).status, 201);
  });
  await t.test('distinct keys contend on PO remaining quantity without changing procurement shape', async () => {
    const next = await po(), original = await db.collection('purchaseOrders').findOne({ _id: next._id });
    const b = { ...body, purchaseOrderId: next._id, quantity: '1' };
    const results = await Promise.all([1, 2, 3].map(() => post('/warehouse/receipts', { ...b, idempotencyKey: randomUUID() })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409, 409]);
    assert.deepEqual(await db.collection('purchaseOrders').findOne({ _id: next._id }), original);
    assert.equal((await post('/warehouse/receipts', { ...b, quantity: '0.250', idempotencyKey: randomUUID() })).status, 201);
    assert.equal((await post('/warehouse/receipts', { ...b, quantity: '0.000001', idempotencyKey: randomUUID() })).status, 409);
  });
  await t.test('serials are unique in scope and count matches exact received quantity', async () => {
    const a = await po(), b = await po();
    const serialBody = { ...body, purchaseOrderId: a._id, quantity: '1', serials: ['SYNTHETIC-SERIAL-1'], idempotencyKey: randomUUID() };
    assert.equal((await post('/warehouse/receipts', { ...serialBody, serials: ['DUP', 'DUP'] })).status, 400);
    assert.equal((await post('/warehouse/receipts', { ...serialBody, quantity: '0.5' })).status, 400);
    const results = await Promise.all([a, b].map(p => post('/warehouse/receipts', { ...serialBody, purchaseOrderId: p._id, idempotencyKey: randomUUID() })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(await db.collection('warehouseSerials').countDocuments(), 1);
  });
  await t.test('warehouse roles and revocation deny ungranted writes inside transaction', async () => {
    const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const setRole = role => db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role, plantIds: member.plantIds, tenantWide: false }] } });
    for (const role of ['warehouseRead', 'warehouseReceive', 'warehouseRelease', 'warehousePutaway', 'warehouseReserve']) {
      await setRole(role);
      assert.equal((await post('/warehouse/receipts')).status, 200);
      for (const action of ['receive', 'release', 'putaway', 'reserve']) {
        if (role.toLowerCase() === `warehouse${action}`) continue;
        const path = action === 'receive' ? '/warehouse/receipts' : `/warehouse/receipts/${receipt._id}/${action}`;
        assert.equal((await post(path, { ...body })).status, 403);
      }
    }
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
    const foundation = runtime.foundation, before = await db.collection('warehouseAudit').countDocuments();
    runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await setRole('warehouseRead'); return result; } };
    try { assert.equal((await post(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Denied', idempotencyKey: randomUUID() })).status, 403); assert.equal(await db.collection('warehouseAudit').countDocuments(), before); }
    finally { runtime.foundation = foundation; await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  });
  await t.test('release putaway and customer SO reservation persist without negative stock', async () => {
    const auditBefore = await db.collection('warehouseAudit').countDocuments();
    async function rollback(path, body) {
      const names = ['warehouseReceipts', 'warehouseAllocated', 'warehouseReservations', 'warehouseMovements', 'warehouseKeys', 'warehouseAudit', 'warehouseOutbox'];
      for (const collection of ['warehouseAudit', 'warehouseOutbox']) {
        const before = await Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
        await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
        try { assert.equal((await post(path, body)).status, 500); assert.deepEqual(await Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray())), before); }
        finally { await db.command({ collMod: collection, validator: {} }); }
      }
    }
    const release = { expectedVersion: 1, reason: 'Synthetic inspection passed', idempotencyKey: randomUUID() };
    await rollback(`/warehouse/receipts/${receipt._id}/release`, release);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/release`, release)).status, 200);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/release`, release)).status, 200);
    const putaway = { expectedVersion: 2, location: 'BIN-1', idempotencyKey: randomUUID() };
    await rollback(`/warehouse/receipts/${receipt._id}/putaway`, putaway);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/putaway`, putaway)).status, 200);
    const account = (await post('/crm/accounts', { name: 'Synthetic warehouse customer' })).data;
    const quote = (await post('/commercial/quotes', { ...content, accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' })).data;
    await post(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
    await post(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
    const so = (await post(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: randomUUID() })).data;
    const reserve = { expectedVersion: 3, salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: '1.000', uom: 'KG', idempotencyKey: randomUUID() };
    await rollback(`/warehouse/receipts/${receipt._id}/reserve`, reserve);
    const wrongAccount = (await post('/crm/accounts', { name: 'Synthetic wrong customer' })).data;
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/reserve`, { ...reserve, accountId: wrongAccount._id })).status, 409);
    assert.equal((await post(`/warehouse/receipts/${receipt._id}/reserve`, { ...reserve, salesOrderId: randomUUID() })).status, 404);
    const results = await Promise.all([1, 2].map(() => post(`/warehouse/receipts/${receipt._id}/reserve`, { ...reserve, idempotencyKey: randomUUID() })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const row = (await post(`/warehouse/receipts/${receipt._id}`)).data;
    assert.equal(row.availableQuantity, '0.25'); assert.equal(row.reservedQuantity, '1');
    assert.equal(await db.collection('warehouseReservations').countDocuments(), 1);
    assert.equal(await db.collection('warehouseAudit').countDocuments(), auditBefore + 3);
    assert.equal(await db.collection('warehouseOutbox').countDocuments(), auditBefore + 3);
  });
});
