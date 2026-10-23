import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

test('procurement owned Mongo HTTP vertical slice', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: fileURLToPath(new URL('../../../packages/mongodb-spike/.runtime/binary/mongod-x64-win32-7.0.14.exe', import.meta.url)), version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`);
  const marker = randomUUID(); await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db });
  const password = randomUUID(), seeded = await seedSynthetic(runtime, { password });
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  async function req(path, body, cookie) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...(await response.json()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const alpha = (await req('/api/session/login', { username: 'alpha.owner', password })).cookie;
  const beta = (await req('/api/session/login', { username: 'beta.owner', password })).cookie;
  const post = (path, body, cookie = alpha) => req('/api/procurement' + path, body, cookie);
  let vendor, pr, order;
  const payload = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Precision material', quantity: '1.250', uom: 'KG', unitPrice: '9007199254740993.01', currency: 'USD' }] };
  await t.test('vendor PR approval conversion issue confirmation persists exact immutable snapshot', async () => {
    const v = await post('/vendors', { name: 'Synthetic vendor' }); assert.equal(v.status, 201, JSON.stringify(v)); vendor = v.data;
    const created = await post('/requests', { ...payload, vendorId: vendor._id }); assert.equal(created.status, 201, JSON.stringify(created)); pr = created.data;
    assert.deepEqual(pr.snapshot.lines, payload.lines); assert.equal(pr.snapshot.total, '11258999068426241.26');
    assert.equal((await post(`/requests/${pr._id}/approve`, { expectedVersion: 1 })).status, 200);
    const body = { expectedVersion: 2, idempotencyKey: 'procurement-conversion-1' };
    const converted = await Promise.all(Array.from({ length: 4 }, () => post(`/requests/${pr._id}/convert`, body)));
    assert.deepEqual(converted.map(r => r.status), [200, 200, 200, 200]);
    assert.equal(new Set(converted.map(r => r.data._id)).size, 1); order = converted[0].data;
    assert.deepEqual(order.snapshot, pr.snapshot); assert.equal(order.status, 'DRAFT');
    assert.equal((await post(`/orders/${order._id}/issue`, { expectedVersion: 1 })).status, 200);
    const confirmed = await post(`/orders/${order._id}/vendor-confirmation`, { expectedVersion: 2, vendorId: vendor._id, reference: 'SYNTHETIC-ACK-1' });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed)); assert.equal(confirmed.data.status, 'CONFIRMED');
    assert.equal(confirmed.data.confirmation.recordedBy, seeded[0].userId);
    assert.equal((await post(`/orders/${order._id}`)).data.version, 3);
    assert.equal((await post('/orders?limit=1')).data[0]._id, order._id);
    assert.equal(await db.collection('purchaseOrders').countDocuments({ requestId: pr._id }), 1);
    assert.equal(await db.collection('procurementAudit').countDocuments(), 6);
    assert.equal(await db.collection('procurementOutbox').countDocuments(), 6);
  });
  const createApproved = async () => {
    const result = await post('/requests', { ...payload, vendorId: vendor._id });
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.equal((await post(`/requests/${result.data._id}/approve`, { expectedVersion: 1 })).status, 200);
    return result.data;
  };
  await t.test('wrong tenant plant aliases vendor references stale versions and states fail closed', async () => {
    const before = await db.collection('procurementAudit').countDocuments();
    for (const path of [`/vendors/${vendor._id}`, `/requests/${pr._id}`, `/orders/${order._id}`]) assert.equal((await post(path, undefined, beta)).status, 404);
    for (const path of ['/vendors', '/requests', '/orders']) assert.deepEqual((await post(path, undefined, beta)).data, []);
    assert.equal((await post('/requests', { ...payload, vendorId: vendor._id }, beta)).status, 404);
    assert.equal((await post('/requests', { ...payload, vendorId: vendor._id, tenant_id: seeded[1].tenantId })).status, 403);
    assert.equal((await post('/orders?plant_id=' + seeded[1].plantId)).status, 403);
    for (const path of ['/requests?limit=0', '/orders?cursor=bad', '/vendors?limit=1.2']) assert.equal((await post(path)).status, 400);
    assert.equal((await post(`/requests/${pr._id}/approve`, { expectedVersion: 1 })).status, 409);
    assert.equal((await post(`/requests/${pr._id}/convert`, { expectedVersion: 3, idempotencyKey: 'different-conversion' })).status, 409);
    assert.equal((await post(`/requests/${pr._id}/convert`, { expectedVersion: 1, idempotencyKey: 'procurement-conversion-1' })).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await post(`/orders/${order._id}/issue`, { expectedVersion: 3 })).status, 409);
    assert.equal((await post(`/orders/${order._id}/issue`, { expectedVersion: 1 }, beta)).status, 404);
    assert.equal(await db.collection('procurementAudit').countDocuments(), before);
    const q = await createApproved();
    const po = (await post(`/requests/${q._id}/convert`, { expectedVersion: 2, idempotencyKey: 'wrong-vendor-conversion' })).data;
    assert.equal((await post(`/orders/${po._id}/vendor-confirmation`, { expectedVersion: 1, vendorId: vendor._id, reference: 'early' })).status, 409);
    assert.equal((await post(`/orders/${po._id}/issue`, { expectedVersion: 1 })).status, 200);
    const otherVendor = (await post('/vendors', { name: 'Other vendor' })).data;
    assert.equal((await post(`/orders/${po._id}/vendor-confirmation`, { expectedVersion: 2, vendorId: otherVendor._id, reference: 'wrong' })).error.code, 'VENDOR_CONFLICT');
    assert.equal((await post(`/orders/${po._id}/vendor-confirmation`, { expectedVersion: 1, vendorId: vendor._id, reference: 'stale' })).status, 409);
    assert.equal((await post(`/orders/${po._id}`)).data.status, 'ISSUED');
  });
  await t.test('currency precision UOM bounded canonical input and line rounding are exact', async () => {
    for (const change of [{ quantity: 1.25 }, { quantity: '0' }, { quantity: '1e2' }, { quantity: '1.1234567' }, { uom: 'kg' }, { uom: 1 }, { unitPrice: 1.1 }, { unitPrice: '1.001' }, { currency: 'XXX' }, { currency: 'constructor' }]) {
      assert.equal((await post('/requests', { ...payload, vendorId: vendor._id, lines: [{ ...payload.lines[0], ...change }] })).status, 400);
    }
    for (const [currency, unitPrice, total] of [['USD', '0.01', '0.02'], ['JPY', '1', '2'], ['KWD', '0.001', '0.002']]) {
      const lines = Array.from({ length: 2 }, () => ({ ...payload.lines[0], quantity: '0.5', unitPrice, currency }));
      const r = await post('/requests', { ...payload, vendorId: vendor._id, lines }); assert.equal(r.status, 201); assert.equal(r.data.snapshot.total, total);
    }
    for (const change of [{ taxPolicy: 'VAT' }, { roundingPolicy: 'FLOAT' }, { lines: [] }, { vendorId: randomUUID() }]) assert.ok([400, 404].includes((await post('/requests', { ...payload, vendorId: vendor._id, ...change })).status));
    assert.equal((await post('/requests', { ...payload, vendorId: vendor._id, lines: [...payload.lines, { ...payload.lines[0], currency: 'EUR' }] })).status, 400);
    assert.equal((await post('/requests', { ...payload, vendorId: vendor._id, status: 'APPROVED' })).status, 400);
  });
  await t.test('concurrent conversion keys and version races create only one PO and one transition', async () => {
    const q = await createApproved();
    const converted = await Promise.all(['a', 'b'].map(key => post(`/requests/${q._id}/convert`, { expectedVersion: 2, idempotencyKey: 'race-conversion-' + key })));
    assert.deepEqual(converted.map(r => r.status).sort(), [200, 409]);
    const po = converted.find(r => r.status === 200).data;
    const issued = await Promise.all(Array.from({ length: 3 }, () => post(`/orders/${po._id}/issue`, { expectedVersion: 1 })));
    assert.deepEqual(issued.map(r => r.status).sort(), [200, 409, 409]);
    assert.equal(await db.collection('purchaseOrders').countDocuments({ requestId: q._id }), 1);
    const qa = await createApproved(), qb = await createApproved();
    const shared = await Promise.all([qa, qb].map(q => post(`/requests/${q._id}/convert`, { expectedVersion: 2, idempotencyKey: 'shared-procurement-key' })));
    assert.deepEqual(shared.map(r => r.status).sort(), [200, 409]);
  });
  await t.test('real Mongo validators prove audit and outbox rollback across conversion issue confirmation', async () => {
    const q = await createApproved();
    const conversion = { expectedVersion: 2, idempotencyKey: 'rollback-procurement-key' };
    for (const collection of ['procurementAudit', 'procurementOutbox']) {
      const before = await db.collection('purchaseRequests').findOne({ _id: q._id });
      const counts = await Promise.all(['procurementAudit', 'procurementOutbox', 'purchaseOrders', 'procurementConversions'].map(n => db.collection(n).countDocuments()));
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try {
        assert.equal((await post(`/requests/${q._id}/convert`, conversion)).status, 500);
        assert.deepEqual(await db.collection('purchaseRequests').findOne({ _id: q._id }), before);
        assert.deepEqual(await Promise.all(['procurementAudit', 'procurementOutbox', 'purchaseOrders', 'procurementConversions'].map(n => db.collection(n).countDocuments())), counts);
      } finally { await db.command({ collMod: collection, validator: {} }); }
    }
    const po = (await post(`/requests/${q._id}/convert`, conversion)).data;
    for (const operation of ['issue', 'vendor-confirmation']) {
      const expectedVersion = operation === 'issue' ? 1 : 2;
      const body = { expectedVersion, ...(operation === 'vendor-confirmation' ? { vendorId: vendor._id, reference: 'rollback-ack' } : {}) };
      for (const collection of ['procurementAudit', 'procurementOutbox']) {
        const before = await db.collection('purchaseOrders').findOne({ _id: po._id });
        await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
        try { assert.equal((await post(`/orders/${po._id}/${operation}`, body)).status, 500); assert.deepEqual(await db.collection('purchaseOrders').findOne({ _id: po._id }), before); }
        finally { await db.command({ collMod: collection, validator: {} }); }
      }
      assert.equal((await post(`/orders/${po._id}/${operation}`, body)).status, 200);
    }
  });
  await t.test('distinct roles allow only their operation and transactional role revocation blocks mutation', async () => {
    const q = (await post('/requests', { ...payload, vendorId: vendor._id })).data;
    const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const setRole = role => db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role, plantIds: member.plantIds, tenantWide: false }] } });
    let po;
    const operations = [
      ['procurementWrite', '/vendors', { name: 'Role vendor' }],
      ['procurementApprove', `/requests/${q._id}/approve`, { expectedVersion: 1 }],
      ['procurementConvert', `/requests/${q._id}/convert`, { expectedVersion: 2, idempotencyKey: 'role-procurement-key' }],
      ['procurementIssue', null, { expectedVersion: 1 }],
      ['procurementConfirm', null, { expectedVersion: 2, vendorId: vendor._id, reference: 'role-ack' }],
    ];
    for (const [role, path, body] of operations) {
      await setRole(role);
      assert.equal((await post('/orders')).status, 200);
      const forbidden = role === 'procurementWrite' ? `/requests/${q._id}/approve` : '/vendors';
      assert.equal((await post(forbidden, role === 'procurementWrite' ? { expectedVersion: 1 } : { name: 'Forbidden' })).status, 403);
      const r = await post(path || `/orders/${po._id}/${role === 'procurementIssue' ? 'issue' : 'vendor-confirmation'}`, body);
      assert.ok([200, 201].includes(r.status), JSON.stringify(r)); if (role === 'procurementConvert') po = r.data;
    }
    await setRole('procurementRead'); assert.equal((await post('/vendors', { name: 'No write' })).status, 403);
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
    const original = runtime.foundation;
    runtime.foundation = { ...original, authorize: async (...args) => { const result = await original.authorize(...args); await setRole('procurementRead'); return result; } };
    const count = await db.collection('vendors').countDocuments();
    try { assert.equal((await post('/vendors', { name: 'Revoked before tx' })).status, 403); assert.equal(await db.collection('vendors').countDocuments(), count); }
    finally { runtime.foundation = original; await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  });
});
