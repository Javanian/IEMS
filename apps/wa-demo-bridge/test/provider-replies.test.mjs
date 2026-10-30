import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedProviderReplyCommands } from '../src/provider-operator.mjs';
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const scope = { tenantId, accountId: 'account' };
const input = () => ({ commandId: userId, replyId: tenantId, recipient: 'contact', customerId: tenantId,
  contentHash: 'a'.repeat(64), commandPrefix: 'IEMS ', policyRevision: 1, identityVersion: 1, bindingVersion: 1, expiresAt: 2000 });
function fixture() {
  let rows = { provider_authority: [
    { kind: 'policy', resourceId: 'account', enabled: true, paused: false, revision: 1, allowlist: ['contact'], prefix: 'IEMS ' },
    { kind: 'identity', resourceId: 'contact', recipient: 'contact', active: true, version: 1 },
    { kind: 'binding', resourceId: 'contact', recipient: 'contact', active: true, version: 1,
      customerId: tenantId, sourceBindingId: userId, sourceBindingVersion: 1 },
  ].map(r => ({ ...scope, authorityRevision: 1, registrationFences: 0, expiresAt: 3000, ...r })),
  provider_commands: [], provider_audit: [], provider_outbox: [] };
  let session;
  const f = { denied: false, badSource: false, loseCAS: false, failOutbox: false, calls: 0 };
  const match = (r,k) => Object.entries(k).every(([a,b]) => r[a] === b);
  const db = { collection(name) { return {
    async findOne(key, opts) { assert.equal(opts.session, session); return structuredClone(rows[name].find(r => match(r,key))); },
    async updateOne(key, update, opts) { assert.equal(opts.session, session); const row = rows[name].find(r => match(r,key));
      if (!row || f.loseCAS) return { matchedCount: 0 };
      for (const [k,v] of Object.entries(update.$inc)) row[k] = (row[k] ?? 0) + v;
      return { matchedCount: 1 }; },
    async insertOne(row, opts) { assert.equal(opts.session, session);
      if (name === 'provider_outbox' && f.failOutbox) throw Error('UNKNOWN_STORAGE'); rows[name].push(structuredClone(row)); },
  }; } };
  f.queue = createScopedProviderReplyCommands({ db, ...scope, plantId: userId, now: () => 1000,
    async transaction(fn) { const before = structuredClone(rows); session = { inTransaction: () => true };
      try { return await fn(session); } catch(e) { rows = before; throw e; } },
    foundation: { async authorizeInTransaction(actor, request, opts) { f.calls++; assert.equal(opts.session, session);
      assert.equal(request.action, 'provider.reply.queue'); if (f.denied) throw Error('DENIED');
      return { tenantId, plantId: userId, userId }; } },
    async verifyBindingSource(request, s) { assert.equal(s, session); if (f.badSource) throw Error('SOURCE_DENIED');
      return { ...scope, ...request, expiresAt: 3000 }; },
  });
  f.rows = () => structuredClone(rows);
  f.change = (kind, patch) => Object.assign(rows.provider_authority.find(r => r.kind === kind), patch);
  return f;
}
test('queue persists metadata and atomic receipt, never approval; replay reauthorizes and revalidates source', async () => {
  const f = fixture(); const result = await f.queue('actor', input());
  assert.equal(result.state, 'QUEUED'); assert.equal(f.rows().provider_authority.length, 4);
  assert.equal(f.rows().provider_authority[3].state, 'QUEUED');
  assert.deepEqual(await f.queue('actor', input()), result); assert.equal(f.rows().provider_audit.length, 1);
  f.badSource = true; await assert.rejects(f.queue('actor', input()), /SOURCE_DENIED/);
  f.denied = true; await assert.rejects(f.queue('actor', input()), /DENIED/);
  assert.equal(f.calls, 4);
});
test('policy pause, allowlist, prefix, versions, customer mismatch and expiry fail closed including replay', async () => {
  for (const [kind, patch] of [['policy', { paused: true }], ['policy', { allowlist: [] }],
    ['policy', { prefix: 'OTHER ' }], ['identity', { version: 2 }], ['binding', { active: false }],
    ['binding', { customerId: userId }], ['identity', { expiresAt: 1500 }]]) {
    const f = fixture(); await f.queue('actor', input()); f.change(kind, patch);
    await assert.rejects(f.queue('actor', input())); assert.equal(f.rows().provider_commands.length, 1);
  }
});
test('CAS and outbox failure roll back fences, reply, audit and receipt without retry', async () => {
  const f = fixture(); const before = f.rows(); f.loseCAS = true;
  await assert.rejects(f.queue('actor', input()), /FENCED/); assert.deepEqual(f.rows(), before);
  f.loseCAS = false; f.failOutbox = true;
  await assert.rejects(f.queue('actor', input()), /UNKNOWN_STORAGE/); assert.deepEqual(f.rows(), before);
  assert.equal(f.calls, 2);
});
test('private body, malformed hashes, expired candidates and conflicting commands are rejected', async () => {
  const f = fixture();
  for (const patch of [{ body: 'private' }, { contentHash: 'bad' }, { expiresAt: 1000 }, { policyRevision: 0 }]) {
    await assert.rejects(f.queue('actor', { ...input(), ...patch }));
  }
  await f.queue('actor', input());
  await assert.rejects(f.queue('actor', { ...input(), contentHash: 'b'.repeat(64) }), /CONFLICT/);
  await assert.rejects(f.queue('actor', { ...input(), commandId: tenantId }), /EXISTS/);
});
