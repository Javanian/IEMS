import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

test('commercial quote contract on owned replica set', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: fileURLToPath(new URL('../../../packages/mongodb-spike/.runtime/binary/mongod-x64-win32-7.0.14.exe', import.meta.url)), version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`);
  const marker = randomUUID(); await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db });
  const password = randomUUID(); const seeded = await seedSynthetic(runtime, { password });
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  async function req(path, body, cookie) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...(await response.json()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const alpha = (await req('/api/session/login', { username: 'alpha.owner', password })).cookie;
  const beta = (await req('/api/session/login', { username: 'beta.owner', password })).cookie;
  const account = (await req('/api/crm/accounts', { name: 'Synthetic quote account' }, alpha)).data;
  const payload = { accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Precision item', quantity: '1.250', uom: 'EA', unitPrice: '9007199254740993.01', currency: 'USD' }] };
  const post = (path, body, cookie = alpha) => req('/api/commercial/quotes' + path, body, cookie);
  let quote;
  await t.test('persists exact line strings and named integer rounding boundary', async () => {
    const r = await post('', payload); assert.equal(r.status, 201, JSON.stringify(r)); quote = r.data;
    assert.equal(quote.version, 1); assert.deepEqual(quote.revisions[0].lines, payload.lines);
    assert.equal(quote.revisions[0].total, '11258999068426241.26');
  });
  await t.test('half-up is applied per line at currency minor units without Number arithmetic', async () => {
    for (const [currency, unitPrice, total] of [['USD', '0.01', '0.02'], ['JPY', '1', '2'], ['KWD', '0.001', '0.002']]) {
      const lines = Array.from({ length: 2 }, () => ({ ...payload.lines[0], quantity: '0.5', unitPrice, currency }));
      const r = await post('', { ...payload, lines });
      assert.equal(r.status, 201); assert.equal(r.data.revisions[0].total, total);
    }
  });
  await t.test('versions, immutable approval, superseding revision, acceptance and concurrent conversion', async () => {
    const path = '/' + quote._id;
    const approved = await post(path + '/approve', { expectedVersion: 1, revision: 1 });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    const snapshot = approved.data.approvals[0];
    assert.equal((await post(path + '/approve', { expectedVersion: 1, revision: 1 })).status, 409);
    const revision = await post(path + '/revisions', { ...payload, expectedVersion: 2 });
    assert.equal(revision.status, 200); assert.deepEqual(revision.data.approvals[0], snapshot);
    assert.equal((await post(path + '/accept', { expectedVersion: 3, revision: 1 })).status, 409);
    assert.equal((await post(path + '/accept', { expectedVersion: 3, revision: 2 })).status, 409);
    assert.equal((await post(path + '/approve', { expectedVersion: 3, revision: 2 })).status, 200);
    assert.equal((await post(path + '/accept', { expectedVersion: 4, revision: 2 })).status, 200);
    const body = { expectedVersion: 5, revision: 2, idempotencyKey: 'convert-synthetic-1' };
    const converted = await Promise.all(Array.from({ length: 6 }, () => post(path + '/convert', body)));
    assert.deepEqual(converted.map(r => r.status), Array(6).fill(200));
    assert.equal(new Set(converted.map(r => r.data._id)).size, 1);
    assert.equal(converted[0].data.snapshot.total, '11258999068426241.26');
    const orderId = converted[0].data._id;
    assert.equal((await req('/api/commercial/orders/' + orderId, undefined, alpha)).data._id, orderId);
    assert.ok((await req('/api/commercial/orders?limit=100', undefined, alpha)).data.some(o => o._id === orderId));
    assert.equal((await req('/api/commercial/orders/' + orderId, undefined, beta)).status, 404);
    assert.equal((await req('/api/commercial/orders', undefined, beta)).data.length, 0);
    assert.equal(await db.collection('salesOrders').countDocuments({ quoteId: quote._id }), 1);
    assert.equal(await db.collection('commercialAudit').countDocuments({ kind: 'quote.converted', subjectId: converted[0].data._id }), 1);
    assert.equal(await db.collection('commercialOutbox').countDocuments({ subjectId: converted[0].data._id }), 1);
    assert.equal((await post(path + '/convert', { ...body, revision: 1 })).status, 409);
    assert.equal((await post(path + '/convert', { ...body, idempotencyKey: 'different-key' })).status, 409);
    assert.equal((await post(path + '/revisions', { ...payload, expectedVersion: 6 })).status, 409);
  });
  await t.test('concurrent key reuse across different quotes produces one winner and a conflict', async () => {
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const q = (await post('', payload)).data; ids.push(q._id);
      await post('/' + q._id + '/approve', { expectedVersion: 1, revision: 1 });
      await post('/' + q._id + '/accept', { expectedVersion: 2, revision: 1 });
    }
    const results = await Promise.all(ids.map(key => post('/' + key + '/convert', { expectedVersion: 3, revision: 1, idempotencyKey: 'shared-concurrent-key' })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(await db.collection('salesOrders').countDocuments({ quoteId: { $in: ids } }), 1);
  });
  await t.test('different concurrent keys cannot create two orders for the same accepted quote', async () => {
    const q = (await post('', payload)).data;
    await post('/' + q._id + '/approve', { expectedVersion: 1, revision: 1 });
    await post('/' + q._id + '/accept', { expectedVersion: 2, revision: 1 });
    const results = await Promise.all(['one', 'two'].map(key => post('/' + q._id + '/convert', { expectedVersion: 3, revision: 1, idempotencyKey: 'concurrent-' + key })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(await db.collection('salesOrders').countDocuments({ quoteId: q._id }), 1);
    assert.equal(await db.collection('quoteConversions').countDocuments({ quoteId: q._id }), 1);
  });
  await t.test('two-tenant and scope alias negatives never expose or mutate quotes', async () => {
    assert.equal((await post('/' + quote._id, undefined, beta)).status, 404);
    assert.equal((await post('', undefined, beta)).data.length, 0);
    for (const operation of ['approve', 'accept', 'convert', 'revisions']) {
      const body = operation === 'revisions' ? { ...payload, expectedVersion: 6 } : { expectedVersion: 6, revision: 2, ...(operation === 'convert' ? { idempotencyKey: 'beta-conversion' } : {}) };
      assert.equal((await post('/' + quote._id + '/' + operation, body, beta)).status, 404);
    }
    assert.equal((await post('', payload, beta)).status, 404);
    assert.equal((await post('', { ...payload, tenant_id: seeded[1].tenantId })).status, 403);
    assert.equal((await post('?plant_id=' + seeded[1].plantId)).status, 403);
  });
  await t.test('rejects invalid decimals, mixed currencies, tax policies and expired/stale lifecycle', async () => {
    for (const change of [{ quantity: 1.25 }, { quantity: '0' }, { quantity: '1e2' }, { quantity: '1.1234567' }, { uom: 1 }, { unitPrice: 1.1 }, { unitPrice: '1.001' }, { currency: 'XXX' }]) {
      assert.equal((await post('', { ...payload, lines: [{ ...payload.lines[0], ...change }] })).status, 400);
    }
    assert.equal((await post('', { ...payload, taxPolicy: 'VAT' })).status, 400);
    assert.equal((await post('', { ...payload, roundingPolicy: 'FLOAT' })).status, 400);
    assert.equal((await post('', { ...payload, lines: [...payload.lines, { ...payload.lines[0], currency: 'EUR' }] })).status, 400);
    assert.equal((await post('', { ...payload, expiresAt: '2020-01-01T00:00:00.000Z' })).status, 400);
    const q = (await post('', payload)).data;
    assert.equal((await post('/' + q._id + '/convert', { expectedVersion: 1, revision: 1, idempotencyKey: 'draft-convert' })).status, 409);
    await db.collection('quotes').updateOne({ _id: q._id }, { $set: { 'revisions.0.expiresAt': new Date(0) } });
    assert.equal((await post('/' + q._id + '/approve', { expectedVersion: 1, revision: 1 })).error.code, 'QUOTE_EXPIRED');
    const accepted = (await post('', payload)).data;
    await post('/' + accepted._id + '/approve', { expectedVersion: 1, revision: 1 });
    await post('/' + accepted._id + '/accept', { expectedVersion: 2, revision: 1 });
    await db.collection('quotes').updateOne({ _id: accepted._id }, { $set: { 'revisions.0.expiresAt': new Date(0) } });
    assert.equal((await post('/' + accepted._id + '/convert', { expectedVersion: 3, revision: 1, idempotencyKey: 'expired-convert' })).error.code, 'QUOTE_EXPIRED');
  });
  await t.test('conversion rolls back SO, quote, idempotency, audit and outbox on real Mongo validation failure', async () => {
    const q = (await post('', payload)).data;
    const path = '/' + q._id;
    await post(path + '/approve', { expectedVersion: 1, revision: 1 });
    await post(path + '/accept', { expectedVersion: 2, revision: 1 });
    const before = await db.collection('quotes').findOne({ _id: q._id });
    const body = { expectedVersion: 3, revision: 1, idempotencyKey: 'rollback-convert' };
    for (const collection of ['commercialAudit', 'commercialOutbox']) {
      const auditCount = await db.collection('commercialAudit').countDocuments();
      const outboxCount = await db.collection('commercialOutbox').countDocuments();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      assert.equal((await post(path + '/convert', body)).status, 500);
      assert.deepEqual(await db.collection('quotes').findOne({ _id: q._id }), before);
      assert.equal(await db.collection('salesOrders').countDocuments({ quoteId: q._id }), 0);
      assert.equal(await db.collection('quoteConversions').countDocuments({ quoteId: q._id }), 0);
      assert.equal(await db.collection('commercialAudit').countDocuments(), auditCount);
      assert.equal(await db.collection('commercialOutbox').countDocuments(), outboxCount);
      await db.command({ collMod: collection, validator: {} });
    }
    assert.equal((await post(path + '/convert', body)).status, 200);
  });
  await t.test('scoped role action permissions and transaction-bound revocation', async () => {
    const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const roleQuote = (await post('', payload)).data;
    for (const [role, allowed, forbidden] of [['quoteEditor', 'revisions', 'approve'], ['quoteApprover', 'approve', 'accept'], ['quoteAcceptor', 'accept', 'convert'], ['quoteConverter', 'convert', 'revisions']]) {
      await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role, plantIds: member.plantIds, tenantWide: false }] } });
      assert.equal((await post('')).status, 200);
      const bodies = { revisions: { ...payload, expectedVersion: 6 }, approve: { expectedVersion: 6, revision: 2 }, accept: { expectedVersion: 6, revision: 2 }, convert: { expectedVersion: 6, revision: 2, idempotencyKey: 'role-convert' } };
      assert.equal((await post('/' + quote._id + '/' + forbidden, bodies[forbidden])).status, 403);
      assert.equal((await post('/' + quote._id + '/' + allowed, bodies[allowed])).status, 409);
      const version = { quoteEditor: 1, quoteApprover: 2, quoteAcceptor: 3, quoteConverter: 4 }[role];
      const successfulBody = allowed === 'revisions' ? { ...payload, expectedVersion: version } : { expectedVersion: version, revision: 2, ...(allowed === 'convert' ? { idempotencyKey: 'role-positive-conversion' } : {}) };
      assert.equal((await post('/' + roleQuote._id + '/' + allowed, successfulBody)).status, 200);
    }
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
    const original = runtime.foundation;
    runtime.foundation = { ...original, authorize: async (...args) => {
      const result = await original.authorize(...args);
      await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'quoteReader', plantIds: member.plantIds, tenantWide: false }] } });
      return result;
    } };
    const count = await db.collection('quotes').countDocuments();
    assert.equal((await post('', payload)).status, 403);
    assert.equal(await db.collection('quotes').countDocuments(), count);
    runtime.foundation = original;
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'quoteEditor', plantIds: [seeded[1].plantId], tenantWide: false }] } });
    assert.equal((await post('', payload)).status, 403);
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
  });
});
