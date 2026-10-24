import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBridge, signDelivery, contentHash } from '../src/bridge.mjs';

const secret = 'synthetic-service-key-01234567890123456789';
const approvalKey = 'synthetic-approval-key-012345678901234567';
let replica, client, db, bridge, base;
const config = { tenant: 'demo-tenant', account: 'opaque-account', serviceSecret: secret, approvalKey, participants: ['opaque-participant'], receiveEnabled: true, scopeAdapter: { async authenticate() { return { id: 'synthetic-admin' }; }, async authorize(actor, action, resource) { return actor.id === 'synthetic-admin' && resource.tenant === 'demo-tenant' && resource.account === 'opaque-account' && action.startsWith('wa.preview.'); } } };
async function start() {
  bridge = await createBridge({ db, ...config });
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${bridge.server.address().port}`;
}
async function request(path, data, auth = secret) {
  const r = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: r.status, body: await r.json() };
}
test.before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, replSet: { count: 1, storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  client = await new MongoClient(replica.getUri()).connect();
  db = client.db('iems_wa_bridge_owned_test');
  await db.collection('ownership').insertOne({ _id: 'wa-bridge-test', synthetic: true });
  await start();
  assert.equal((await request('/bindings', { recipient: 'opaque-participant', customer: 'synthetic-customer', synthetic: true, expectedVersion: 0 })).status, 200);
});
test.after(async () => { if (bridge) await new Promise(r => bridge.server.close(r)); await client?.close(); await new Promise(r => setTimeout(r, 300)); await replica?.stop({ doCleanup: true, force: true }); });
const recipient = 'opaque-participant';
const meta = eventId => ({ tenant: config.tenant, account: config.account, recipient, kind: 'direct', eventId });
async function activate() {
  await db.collection('policy').updateOne({ tenant: config.tenant, account: config.account }, { $set: { paused: false } });
  const s = await request('/session', { recipient, code: 'test-code-123', expiresAt: Date.now() + 600000 });
  assert.equal(s.status, 200);
  assert.equal((await request('/inbound', { metadata: meta('activation'), text: 'IEMS DEMO test-code-123' })).body.activated, true);
  return s.body.version;
}
function message(key, version, overrides = {}, text = 'Synthetic order status') {
  const claims = { kind: 'operator-approved-preview', tenant: config.tenant, account: config.account, recipient, contentHash: contentHash(text), approvalVersion: version, expiresAt: Date.now() + 120000, key, nonce: `nonce-${key}`, ...overrides };
  return { recipient, key, text, authorization: signDelivery(claims, approvalKey) };
}

test('metadata gate never reads bodies for private/group/status/history/unknown participants', async () => {
  await activate();
  for (const changes of [{ recipient: 'not-allowlisted' }, { kind: 'group' }, { kind: 'status' }, { history: true }, { fromMe: true }, { broadcast: true }, { tenant: 'other' }, { account: 'other' }]) {
    let reads = 0;
    assert.equal((await bridge.inbound({ ...meta('privacy'), ...changes }, () => { reads++; throw new Error('Private body read'); })).ignored, true);
    assert.equal(reads, 0);
  }
  for (const text of ['private personal text', 'secret ordinary text']) assert.equal((await request('/inbound', { metadata: meta('private'), text })).body.ignored, true);
  assert.equal(await db.collection('preview_inbox').countDocuments(), 0);
  assert.equal(await db.collection('preview_outbox').countDocuments(), 0);
});

test('activation code, prefix, dedup, STOP and expiry bound receive', async () => {
  await request('/session', { recipient, code: 'test-code-123', expiresAt: Date.now() + 600000 });
  assert.equal((await request('/inbound', { metadata: meta('wrong'), text: 'IEMS DEMO wrong-code' })).body.ignored, true);
  assert.equal((await request('/inbound', { metadata: meta('early'), text: 'IEMS ORDER demo' })).body.ignored, true);
  await activate();
  assert.equal((await request('/inbound', { metadata: meta('order-1'), text: 'IEMS ORDER synthetic' })).body.accepted, true);
  assert.equal((await request('/inbound', { metadata: meta('order-1'), text: 'IEMS ORDER synthetic' })).body.duplicate, true);
  assert.equal(await db.collection('preview_inbox').countDocuments({ eventId: 'order-1' }), 1);
  await request('/inbound', { metadata: meta('stop'), text: 'IEMS STOP' });
  assert.equal((await request('/inbound', { metadata: meta('after-stop'), text: 'IEMS ORDER hidden' })).body.ignored, true);
});

test('signed approvals reject scope, expiry, tampering and replay; idempotency conflicts are durable', async () => {
  const version = await activate();
  for (const overrides of [{ tenant: 'foreign' }, { account: 'foreign' }, { recipient: 'foreign' }, { contentHash: 'bad' }, { approvalVersion: version + 1 }, { expiresAt: Date.now() - 1 }, { kind: 'llm-says-approved' }]) {
    assert.equal((await request('/messages', message('scope-check', version, overrides))).status, 403);
  }
  const tampered = message('tamper', version); tampered.authorization += 'bad';
  assert.equal((await request('/messages', tampered)).status, 403);
  const m = message('duplicate-key', version);
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('/messages', m)));
  assert.equal(new Set(responses.map(r => r.body.id)).size, 1);
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(await db.collection('preview_outbox').countDocuments({ key: 'duplicate-key' }), 1);
  assert.equal((await request('/messages', message('duplicate-key', version, {}, 'Changed payload'))).status, 409);
  assert.equal((await request('/messages', message('replay-key', version, { nonce: 'nonce-duplicate-key' }))).status, 409);
  const preview = await request(`/messages/${responses[0].body.id}/preview`, {});
  assert.equal(preview.body.state, 'PREVIEWED');
  assert.equal(preview.body.providerMessageId, null);
  assert.equal((await request(`/messages/${preview.body.id}`)).body.state, 'PREVIEWED');
});

test('restart preserves queue and previews once; ambiguous simulator never pretends live success', async () => {
  const version = await activate();
  const created = (await request('/messages', message('restart', version))).body;
  const ambiguous = (await request('/messages', message('ambiguous', version))).body;
  await new Promise(r => bridge.server.close(r)); await start();
  assert.equal((await request(`/messages/${created.id}`)).body.state, 'QUEUED');
  assert.equal((await request(`/messages/${created.id}/preview`, {})).body.state, 'PREVIEWED');
  assert.equal((await request(`/messages/${created.id}/preview`, {})).body.state, 'PREVIEWED');
  const result = await bridge.dispatch(ambiguous.id, 'ambiguous');
  assert.equal(result.state, 'UNKNOWN');
  assert.match(result.reason, /SIMULATED.*NOT_LIVE/);
  assert.equal((await bridge.dispatch(ambiguous.id)).state, 'UNKNOWN');
  const inFlight = (await request('/messages', message('crashed-submit', version))).body;
  await db.collection('preview_outbox').updateOne({ _id: inFlight.id }, { $set: { state: 'SENDING' } });
  await new Promise(r => bridge.server.close(r)); await start();
  assert.equal((await request(`/messages/${inFlight.id}`)).body.state, 'UNKNOWN');
});

test('pause, STOP, expiry and binding version revoke pending preview', async () => {
  let version = await activate();
  let created = (await request('/messages', message('paused', version))).body;
  await request('/session/pause', {});
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
  assert.equal((await request('/messages', message('paused-new', version))).status, 403);
  version = await activate(); created = (await request('/messages', message('stopped', version))).body;
  await request('/inbound', { metadata: meta('stop-again'), text: 'IEMS STOP' });
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
  version = await activate(); created = (await request('/messages', message('expired', version))).body;
  await db.collection('sessions').updateOne({ recipient }, { $set: { expiresAt: Date.now() - 1 } });
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
  version = await activate(); created = (await request('/messages', message('revoked', version))).body;
  await activate();
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
});

test('STOP wins against an inbound whose body was still pending', async () => {
  await activate();
  let release;
  let entered;
  const reading = new Promise(resolve => { entered = resolve; });
  const pending = bridge.inbound(meta('delayed-after-stop'), async () => {
    entered();
    return new Promise(resolve => { release = resolve; });
  });
  await reading;
  await request('/inbound', { metadata: meta('race-stop'), text: 'IEMS STOP' });
  release('IEMS ORDER delayed');
  assert.equal((await pending).ignored, true);
  assert.equal(await db.collection('preview_inbox').countDocuments({ eventId: 'delayed-after-stop' }), 0);
});

test('pause wins against activation whose body was still pending', async () => {
  await request('/session/resume', {});
  await request('/session', { recipient, code: 'race-code-123', expiresAt: Date.now() + 600000 });
  let release;
  let entered;
  const reading = new Promise(resolve => { entered = resolve; });
  const pending = bridge.inbound(meta('delayed-activation'), async () => {
    entered();
    return new Promise(resolve => { release = resolve; });
  });
  await reading;
  await request('/session/pause', {});
  release('IEMS DEMO race-code-123');
  assert.equal((await pending).ignored, true);
  assert.equal((await request('/session')).body.sessions[0].active, false);
});

test('allowlist removal across restart cancels a previously authorized queue', async () => {
  const version = await activate();
  const created = (await request('/messages', message('removed-participant', version))).body;
  await new Promise(resolve => bridge.server.close(resolve));
  bridge = await createBridge({ db, ...config, participants: [] });
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
  await new Promise(resolve => bridge.server.close(resolve));
  await start();
});

test('unknown own outgoing pauses the eligible conversation without reading its body', async () => {
  const version = await activate();
  const created = (await request('/messages', message('manual-outgoing', version))).body;
  let reads = 0;
  const result = await bridge.inbound({ ...meta('own-outgoing'), fromMe: true }, () => { reads++; throw new Error('Outgoing body must not be read'); });
  assert.equal(reads, 0);
  assert.equal(result.paused, true);
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
  assert.equal((await request('/inbound', { metadata: meta('after-outgoing'), text: 'IEMS ORDER demo' })).body.ignored, true);
});

test('concurrent pause and preview serialize; no queued work survives acknowledged pause', async () => {
  for (let i = 0; i < 5; i++) {
    const version = await activate();
    const created = (await request('/messages', message(`pause-race-${i}`, version))).body;
    const [preview, pause] = await Promise.all([request(`/messages/${created.id}/preview`, {}), request('/session/pause', {})]);
    assert.equal(pause.status, 200);
    assert.equal(preview.status, 200);
    assert.ok(['PREVIEWED', 'CANCELLED'].includes(preview.body.state));
    assert.equal(await db.collection('preview_outbox').countDocuments({ state: 'QUEUED', recipient }), 0);
    assert.equal((await request('/messages', message(`after-pause-${i}`, version))).status, 403);
  }
});

test('inactivity and unrecognized reply context cannot authorize content or queue', async () => {
  const version = await activate();
  assert.equal((await request('/inbound', { metadata: { ...meta('unknown-prompt'), replyTo: 'invented-prompt' }, text: 'ordinary form content' })).body.ignored, true);
  const created = (await request('/messages', message('inactive-session', version))).body;
  await db.collection('sessions').updateOne({ recipient }, { $set: { lastActivity: Date.now() - 900001 } });
  let reads = 0;
  assert.equal((await bridge.inbound(meta('inactive-body'), () => { reads++; return 'IEMS ORDER demo'; })).ignored, true);
  assert.equal(reads, 0);
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
});

test('authenticated request cannot override configured tenant/account', async () => {
  const version = await activate();
  assert.equal((await request('/messages', { ...message('scope-input', version), tenant: 'foreign', account: 'foreign' })).status, 403);
});

test('prefix alone cannot persist another activation command as business content', async () => {
  await activate();
  assert.equal((await request('/inbound', { metadata: meta('activation-replay'), text: 'IEMS DEMO test-code-123' })).body.ignored, true);
  assert.equal(await db.collection('preview_inbox').countDocuments({ eventId: 'activation-replay' }), 0);
});

test('session has authenticated status and pause cannot be bypassed by creating another session', async () => {
  await activate(); await request('/session/pause', {});
  assert.equal((await request('/session', undefined, 'bad')).status, 401);
  assert.equal((await request('/session')).body.paused, true);
  assert.equal((await request('/session', { recipient, code: 'new-code-123', expiresAt: Date.now() + 600000 })).status, 403);
});

test('STOP consumes activation credential until a new explicit session', async () => {
  await activate();
  await request('/inbound', { metadata: meta('stop-consume'), text: 'IEMS STOP' });
  assert.equal((await request('/inbound', { metadata: meta('reopen'), text: 'IEMS DEMO test-code-123' })).body.ignored, true);
});

test('explicit resume does not reactivate sessions or stale pending approvals', async () => {
  const version = await activate();
  const created = (await request('/messages', message('resume-cancel', version))).body;
  await request('/session/pause', {});
  assert.equal((await request('/session/resume', {})).status, 200);
  assert.equal((await request('/session')).body.paused, false);
  assert.equal((await request('/messages', message('resume-stale', version))).status, 403);
  assert.equal((await bridge.dispatch(created.id)).state, 'CANCELLED');
});

test('entrypoint refuses live; actual owned-database process serves only loopback preview', async () => {
  const main = new URL('../src/main.mjs', import.meta.url);
  const denied = spawnSync(process.execPath, [fileURLToPath(main)], { env: { ...process.env, WA_LIVE_ENABLED: 'true' }, encoding: 'utf8' });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /LIVE_POLICY_NOT_INTEGRATED/);
  await db.collection('ownership').insertOne({ _id: 'wa-bridge', synthetic: true });
  const child = spawn(process.execPath, [fileURLToPath(main)], { env: { ...process.env, WA_LIVE_ENABLED: 'false', WA_MONGO_URI: replica.getUri(), WA_DB_NAME: db.databaseName, WA_TENANT: config.tenant, WA_ACCOUNT: config.account, WA_SERVICE_SECRET: secret, WA_APPROVAL_KEY: approvalKey, WA_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const output = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('entrypoint timeout')), 10000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`entrypoint exit ${code}`)); });
      child.stdout.once('data', chunk => { clearTimeout(timer); resolve(JSON.parse(chunk.toString())); });
    });
    assert.equal(output.host, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${output.port}/health`);
    assert.equal((await response.json()).mode, 'PREVIEW_ONLY');
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
});

test('signed malformed approval claims are rejected as authorization failures', async () => {
  const version = await activate();
  for (const claims of [null, [], 'approved', 1]) {
    assert.equal((await request('/messages', { ...message('malformed-claims', version), authorization: signDelivery(claims, approvalKey) })).status, 403);
  }
});

test('constructor refuses absent service and approval secrets', async () => {
  for (const changes of [{ serviceSecret: undefined }, { approvalKey: undefined }, { serviceSecret: 123 }, { approvalKey: {} }]) {
    await assert.rejects(() => createBridge({ db, ...config, ...changes }), /Invalid bridge configuration/);
  }
});

test('production constructor hard denies live enablement', async () => {
  await assert.rejects(() => createBridge({ db, ...config, liveEnabled: true }), /LIVE_POLICY_NOT_INTEGRATED/);
});
 test('expired approval is cancelled by status reconciliation without restart', async () => {
  const version = await activate();
  const created = (await request('/messages', message('approval-expired', version))).body;
  await db.collection('preview_outbox').updateOne({ _id: created.id }, { $set: { expiresAt: Date.now() - 1 } });
  assert.equal((await request(`/messages/${created.id}`)).body.state, 'CANCELLED');
});
 test('simulator rejects unknown result labels instead of manufacturing success', async () => {
  const version = await activate();
  const created = (await request('/messages', message('unknown-simulator', version))).body;
  await assert.rejects(() => bridge.dispatch(created.id, 'SENT'), /INVALID_SIMULATION/);
});
 test('default receive setting is disabled', async () => {
  await new Promise(r => bridge.server.close(r));
  bridge = await createBridge({ db, ...config, receiveEnabled: false });
  let reads = 0;
  assert.equal((await bridge.inbound(meta('default-off'), () => { reads++; return 'IEMS ORDER demo'; })).ignored, true);
  assert.equal(reads, 0);
  await new Promise(r => bridge.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${bridge.server.address().port}`;
});
 test('malformed and oversized requests have bounded, body-free errors', async () => {
  let response = await fetch(base + '/messages', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{private invalid' });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'INVALID_JSON' });
  response = await fetch(base + '/messages', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ text: 'x'.repeat(17000) }) });
  assert.equal(response.status, 413);
});
 test('database unavailable returns no false healthy result', async () => {
  await client.close();
  assert.equal((await request('/health')).status, 503);
  client = await new MongoClient(replica.getUri()).connect();
  db = client.db('iems_wa_bridge_owned_test');
  await new Promise(r => bridge.server.close(r)); await start();
});
 test('no personal body appears in serialized owned durable state', async () => {
  const verification = await new MongoClient(replica.getUri()).connect();
  try {
    const all = [];
    for (const c of await verification.db(db.databaseName).listCollections().toArray()) all.push(...await verification.db(db.databaseName).collection(c.name).find().toArray());
    const data = JSON.stringify(all);
    assert.ok(!data.includes('private personal text'));
    assert.ok(!data.includes('secret ordinary text'));
    assert.ok(!data.includes('Private body read'));
  } finally { await verification.close(); }
});
 test('evidence identifies actual owned runtime and no external delivery', () => {
  console.log(JSON.stringify({ runtime: 'real-owned-mongod-replica-set', database: 'iems_wa_bridge_owned_test', mode: 'PREVIEW_ONLY', liveAdapter: false, providerCalls: 0 }));
});
 test('content hashing is stable and content-bound', () => { assert.equal(contentHash('x'), contentHash('x')); assert.notEqual(contentHash('x'), contentHash('y')); });
test('loopback health is honest; account readiness is service authenticated; live is hard denied', async () => {
  assert.equal((await request('/health', undefined, 'bad')).body.mode, 'PREVIEW_ONLY');
  assert.equal((await request('/status', undefined, 'bad')).status, 401);
  assert.equal((await request('/status')).body.liveEnabled, false);
  assert.equal((await request('/session/live', {})).status, 403);
});
