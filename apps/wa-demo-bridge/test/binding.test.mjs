import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createBridge, signDelivery, contentHash } from '../src/bridge.mjs';
const secret = 'synthetic-service-secret-0123456789012345';
const approvalKey = 'synthetic-approval-secret-012345678901234';
const scope = { tenant: 'synthetic-tenant', account: 'synthetic-account' };
let replica, client, db, bridge, base;
const adapter = {
  async authenticate(req) { return req.headers['x-owned-actor'] === 'admin' ? { id: 'synthetic-admin' } : null; },
  async authorize(actor, action, resource) { return actor?.id === 'synthetic-admin' && resource.tenant === scope.tenant && resource.account === scope.account && action.startsWith('wa.preview.'); },
};
async function request(path, body, actor = 'admin') {
  const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'x-owned-actor': actor, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
test.before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, replSet: { count: 1, storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  client = await new MongoClient(replica.getUri()).connect(); db = client.db('iems_wa_bridge_owned_binding');
  bridge = await createBridge({ db, ...scope, serviceSecret: secret, approvalKey, participants: ['contact'], receiveEnabled: true, scopeAdapter: adapter });
  await new Promise(r => bridge.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${bridge.server.address().port}`;
});
test.after(async () => { await new Promise(r => bridge.server.close(r)); await client.close(); await new Promise(r => setTimeout(r, 300)); await replica.stop({ doCleanup: true, force: true }); });
const meta = eventId => ({ ...scope, recipient: 'contact', eventId, kind: 'direct' });
async function activate() {
  const s = await request('/session', { recipient: 'contact', code: 'owned-code', expiresAt: Date.now() + 600000 });
  assert.equal(s.status, 200);
  assert.equal((await request('/inbound', { metadata: meta('activate'), text: 'IEMS DEMO owned-code' })).body.activated, true);
  return s.body.version;
}
function message(version, key) {
  const text = 'Synthetic preview';
  return { recipient: 'contact', key, text, authorization: signDelivery({ kind: 'operator-approved-preview', ...scope, recipient: 'contact', key, nonce: key, contentHash: contentHash(text), approvalVersion: version, expiresAt: Date.now() + 60000 }, approvalKey) };
}
test('trusted binding is immutable, scoped and revocation cancels queued preview', async () => {
  assert.equal((await request('/session', { recipient: 'contact', code: 'owned-code', expiresAt: Date.now() + 60000 })).status, 403);
  const binding = { recipient: 'contact', customer: 'synthetic-customer', synthetic: true, expectedVersion: 0 };
  assert.equal((await request('/bindings', binding, 'intruder')).status, 403);
  assert.equal((await request('/bindings', { ...binding, tenant: 'foreign' })).status, 403);
  const bound = await request('/bindings', binding);
  assert.equal(bound.status, 200); assert.equal(bound.body.version, 1);
  assert.equal((await request('/bindings', { ...binding, customer: 'other', expectedVersion: 1 })).status, 409);
  const version = await activate();
  const m = await request('/messages', message(version, 'revoke-queued')); assert.equal(m.status, 200);
  const stored = await db.collection('preview_outbox').findOne({ _id: m.body.id });
  assert.equal(stored.bindingVersion, 1); assert.equal(stored.customer, 'synthetic-customer');
  assert.equal((await request('/bindings/revoke', { recipient: 'contact', expectedVersion: 1 }, 'intruder')).status, 403);
  assert.equal((await request('/bindings/revoke', { recipient: 'contact', expectedVersion: 1 })).status, 200);
  assert.equal((await bridge.dispatch(m.body.id)).state, 'CANCELLED');
  let reads = 0; await bridge.inbound(meta('revoked-body'), () => { reads++; return 'IEMS test'; }); assert.equal(reads, 0);
  assert.equal((await request('/messages', message(version, 'revoked-new'))).status, 403);
});
test('revoke wins over a pending body and dispatch rejects binding drift independently', async () => {
  await db.collection('preview_bindings').updateOne({ recipient: 'contact' }, { $set: { active: true } });
  const version = await activate();
  const m = await request('/messages', message(version, 'drift-queued'));
  await db.collection('preview_bindings').updateOne({ recipient: 'contact' }, { $inc: { version: 1 } });
  assert.equal((await bridge.dispatch(m.body.id)).state, 'CANCELLED');
  await activate();
  let entered, release;
  const reading = new Promise(r => { entered = r; });
  const pending = bridge.inbound(meta('revoked-pending'), async () => { entered(); return new Promise(r => { release = r; }); });
  await reading;
  assert.equal((await request('/bindings/revoke', { recipient: 'contact', expectedVersion: 3 })).status, 200);
  release('IEMS synthetic delayed');
  assert.equal((await pending).ignored, true);
  assert.equal(await db.collection('preview_inbox').countDocuments({ eventId: 'revoked-pending' }), 0);
});
test('pause and resume require scoped operator authority', async () => {
  assert.equal((await request('/session/pause', {}, 'intruder')).status, 403);
  assert.equal((await request('/session/pause', {})).status, 200);
  assert.equal((await request('/session/resume', {}, 'intruder')).status, 403);
  assert.equal((await request('/session/resume', {})).status, 200);
});
test('known prompt reply is owned by exact session and cannot capture broad free chat', async () => {
  await db.collection('preview_bindings').updateOne({ recipient: 'contact' }, { $set: { active: true } });
  const version = await activate();
  const prompt = await request('/prompts', { recipient: 'contact', sessionVersion: version, expiresAt: Date.now() + 60000 });
  assert.equal(prompt.status, 200);
  let reads = 0;
  assert.equal((await bridge.inbound({ ...meta('wrong-prompt'), replyTo: 'guessed' }, () => { reads++; return 'private text'; })).ignored, true);
  assert.equal(reads, 0);
  assert.equal((await request('/inbound', { metadata: { ...meta('owned-reply'), replyTo: prompt.body.id }, text: 'synthetic form answer' })).body.accepted, true);
  assert.equal(await db.collection('preview_inbox').countDocuments({ eventId: 'owned-reply', text: 'synthetic form answer', bindingVersion: 4 }), 1);
  assert.equal((await request('/inbound', { metadata: { ...meta('reuse-prompt'), replyTo: prompt.body.id }, text: 'not accepted' })).body.ignored, true);
  const stale = await request('/prompts', { recipient: 'contact', sessionVersion: version, expiresAt: Date.now() + 60000 });
  await activate();
  assert.equal((await request('/inbound', { metadata: { ...meta('stale-prompt'), replyTo: stale.body.id }, text: 'not retained' })).body.ignored, true);
  assert.equal(await db.collection('preview_inbox').countDocuments({ eventId: { $in: ['wrong-prompt', 'reuse-prompt', 'stale-prompt'] } }), 0);
});
