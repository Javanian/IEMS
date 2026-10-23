import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createTenantFoundation } from '../../../packages/tenant-foundation/index.mjs';
import { createFoundationOperatorAdapter, operatorRoleActions } from '../src/foundation-operator.mjs';
import { createBridge } from '../src/bridge.mjs';
let replica, client, db, foundationDb, foundation, bridge, base, authorizationGate;
const tenant = randomUUID(), plant = randomUUID(), entity = randomUUID();
const serviceSecret = 'owned-service-012345678901234567890123456';
const binding = recipient => ({ recipient, customer: 'synthetic-customer', synthetic: true, expectedVersion: 0 });
async function request(path, body, token) {
  const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function operator(role = 'bridgeAdmin', t = tenant, p = plant, e = entity) {
  const userId = randomUUID(), membershipId = randomUUID();
  await foundation.provisionUser({ id: userId, tenantId: t });
  await foundation.provisionMembership({ id: membershipId, tenantId: t, userId, legalEntityIds: [e], plantIds: [p], roles: [{ role, plantIds: [p] }] });
  return { ...await foundation.issueSession({ userId, tenantId: t, selectedPlantId: p, ttlMs: 600000 }), membershipId, userId };
}
test.before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, replSet: { count: 1, storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  client = await new MongoClient(replica.getUri()).connect();
  db = client.db('iems_wa_bridge_owned_http'); foundationDb = client.db('iems_wa_bridge_owned_identity');
  foundation = createTenantFoundation({ client, db: foundationDb, roleActions: operatorRoleActions });
  await foundation.initialize();
  await foundation.provisionTenant({ id: tenant });
  await foundation.provisionLegalEntity({ id: entity, tenantId: tenant });
  await foundation.provisionPlant({ id: plant, tenantId: tenant, legalEntityId: entity });
  const gatedFoundation = { authenticate: (...args) => foundation.authenticate(...args), async authorize(...args) {
    const grant = await foundation.authorize(...args);
    if (authorizationGate) { const gate = authorizationGate; authorizationGate = null; await gate(); }
    return grant;
  } };
  const scopeAdapter = createFoundationOperatorAdapter({ foundation: gatedFoundation, db: foundationDb, tenantId: tenant, plantId: plant, account: 'preview' });
  bridge = await createBridge({ db, tenant, account: 'preview', serviceSecret, approvalKey: serviceSecret, participants: Array.from({ length: 30 }, (_, i) => `contact${i}`), receiveEnabled: true, scopeAdapter });
  await new Promise(r => bridge.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${bridge.server.address().port}`;
});
test.after(async () => { if (bridge) await new Promise(r => bridge.server.close(r)); await client?.close(); await replica?.stop(); });
test('actual foundation bearer creates scoped binding and prompt; service secret is not operator authority', async () => {
  const op = await operator();
  assert.equal((await request('/bindings', binding('contact0'), serviceSecret)).status, 403);
  assert.equal((await request('/bindings', binding('contact0'), op.token)).status, 200);
  assert.equal((await db.collection('preview_bindings').findOne({ recipient: 'contact0' })).verifiedBy, op.userId);
  const s = await request('/session', { recipient: 'contact0', code: 'owned-code', expiresAt: Date.now() + 60000 }, op.token);
  assert.equal(s.status, 200);
  await bridge.inbound({ tenant, account: 'preview', recipient: 'contact0', kind: 'direct', eventId: 'activation' }, () => 'IEMS DEMO owned-code');
  assert.equal((await request('/prompts', { recipient: 'contact0', sessionVersion: s.body.version, expiresAt: Date.now() + 30000 }, op.token)).status, 200);
  assert.equal((await request('/bindings/revoke', { recipient: 'contact0', expectedVersion: 1 }, op.token)).status, 200);
  assert.equal((await request('/messages', {}, op.token)).status, 401);
  assert.equal((await request('/session/live', {}, serviceSecret)).status, 403);
});
test('two tenant, role, revoked membership/session and expired token deny without writes', async () => {
  const t = randomUUID(), e = randomUUID(), p = randomUUID();
  await foundation.provisionTenant({ id: t }); await foundation.provisionLegalEntity({ id: e, tenantId: t }); await foundation.provisionPlant({ id: p, tenantId: t, legalEntityId: e });
  const foreign = await operator('bridgeAdmin', t, p, e), reader = await operator('bridgeReader'), revoked = await operator(), invalid = await operator(), expired = await operator();
  await foundation.revokeSession({ tenantId: tenant, sessionId: revoked.sessionId });
  await foundation.invalidateMembership({ tenantId: tenant, membershipId: invalid.membershipId, expectedVersion: 1, active: false });
  await foundationDb.collection('sessions').updateOne({ _id: expired.sessionId }, { $set: { expiresAt: new Date(0) } });
  for (const op of [foreign, reader, revoked, invalid, expired]) {
    for (const path of ['/bindings', '/bindings/revoke', '/prompts']) assert.equal((await request(path, binding('contact1'), op.token)).status, 403);
  }
  assert.equal(await db.collection('preview_bindings').countDocuments({ recipient: 'contact1' }), 0);
});
test('revocation, permission version and expiry win after real authorization but before mutation', async () => {
  const changes = [
    op => foundation.revokeSession({ tenantId: tenant, sessionId: op.sessionId }),
    op => foundation.invalidateMembership({ tenantId: tenant, membershipId: op.membershipId, expectedVersion: 1, active: false }),
    op => foundation.invalidateMembership({ tenantId: tenant, membershipId: op.membershipId, expectedVersion: 1, active: true }),
    op => foundationDb.collection('sessions').updateOne({ _id: op.sessionId }, { $set: { expiresAt: new Date(0) } })
  ];
  for (const [i, change] of changes.entries()) {
    const op = await operator();
    let entered, release;
    const waiting = new Promise(r => { entered = r; });
    authorizationGate = async () => { entered(); await new Promise(r => { release = r; }); };
    const pending = request('/bindings', binding(`contact${i + 10}`), op.token);
    await waiting;
    await change(op);
    release();
    assert.equal((await pending).status, 403);
    assert.equal(await db.collection('preview_bindings').countDocuments({ recipient: `contact${i + 10}` }), 0);
  }
});
test('actual CLI startup explicitly selects foundation and rejects unknown adapter', async () => {
  await db.collection('ownership').insertOne({ _id: 'wa-bridge', synthetic: true });
  await foundationDb.collection('ownership').insertOne({ _id: 'wa-bridge-foundation', synthetic: true });
  const env = { ...process.env, WA_MONGO_URI: replica.getUri(), WA_DB_NAME: db.databaseName, WA_FOUNDATION_DB_NAME: foundationDb.databaseName, WA_TENANT: tenant, WA_PLANT_ID: plant, WA_ACCOUNT: 'preview', WA_SERVICE_SECRET: serviceSecret, WA_APPROVAL_KEY: serviceSecret, WA_PORT: '0', WA_PARTICIPANTS: 'cli-contact', WA_RECEIVE_PREVIEW: 'true', WA_OPERATOR_ADAPTER: 'foundation' };
  const child = spawn(process.execPath, ['src/main.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const ready = JSON.parse(String(chunk));
    assert.equal(ready.operatorAdapter, 'foundation');
    const health = await fetch(`http://127.0.0.1:${ready.port}/health`);
    assert.equal(health.status, 200);
    const op = await operator();
    const result = await fetch(`http://127.0.0.1:${ready.port}/bindings`, { method: 'POST', headers: { authorization: `Bearer ${op.token}`, 'content-type': 'application/json' }, body: JSON.stringify(binding('cli-contact')) });
    assert.equal(result.status, 200);
  } finally { child.kill(); await once(child, 'exit'); }
  const refused = spawn(process.execPath, ['src/main.mjs'], { env: { ...env, WA_OPERATOR_ADAPTER: 'personal-provider' }, stdio: 'ignore' });
  assert.notEqual((await once(refused, 'exit'))[0], 0);
});
test('binding version race has one winner and scoped overrides fail closed', async () => {
  const op = await operator();
  assert.equal((await request('/bindings', { ...binding('contact2'), tenantId: randomUUID() }, op.token)).status, 403);
  assert.equal((await request('/bindings', binding('contact2'), op.token)).status, 200);
  const results = await Promise.all([1, 2].map(() => request('/bindings/revoke', { recipient: 'contact2', expectedVersion: 1 }, op.token)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
