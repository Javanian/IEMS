import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedProviderApprovalCommands } from '../src/provider-operator.mjs';
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const scope = { tenantId, accountId: 'account' };
const input = () => ({ commandId: userId, replyId: tenantId, recipient: 'contact', customerId: tenantId,
  contentHash: 'a'.repeat(64), commandPrefix: 'IEMS ', policyRevision: 1, identityVersion: 1, bindingVersion: 1, expiresAt: 2000, expectedReplyRevision: 1 });
function fixture() {
  let rows = { provider_authority: [
    { kind: 'policy', resourceId: 'account', enabled: true, paused: false, revision: 1, allowlist: ['contact'], prefix: 'IEMS ' },
    { kind: 'identity', resourceId: 'contact', recipient: 'contact', active: true, version: 1 },
    { kind: 'binding', resourceId: 'contact', recipient: 'contact', active: true, version: 1,
      customerId: tenantId, sourceBindingId: userId, sourceBindingVersion: 1 },
  ].map(r => ({ ...scope, authorityRevision: 1, registrationFences: 0, expiresAt: 3000, ...r })),
  provider_commands: [], provider_audit: [], provider_outbox: [] };
  const { commandId, expectedReplyRevision, ...metadata } = input();
  rows.provider_authority.push({ ...scope, kind: 'reply', resourceId: tenantId, ...metadata, authorityRevision: 1, mode: 'LIVE', state: 'QUEUED' });
  let session;
  const f = { denied: false, badSource: false, loseCAS: false, failOutbox: false, calls: 0 };
  const match = (r,k) => Object.entries(k).every(([a,b]) => r[a] === b);
  const db = { collection(name) { return {
    async findOne(key, opts) { assert.equal(opts.session, session); return structuredClone(rows[name].find(r => match(r,key))); },
    async updateOne(key, update, opts) { assert.equal(opts.session, session); const row = rows[name].find(r => match(r,key));
      if (!row || f.loseCAS) return { matchedCount: 0 };
      Object.assign(row, update.$set ?? {});
      for (const [k,v] of Object.entries(update.$inc)) row[k] = (row[k] ?? 0) + v;
      return { matchedCount: 1 }; },
    async insertOne(row, opts) { assert.equal(opts.session, session);
      if (name === 'provider_outbox' && f.failOutbox) throw Error('UNKNOWN_STORAGE'); rows[name].push(structuredClone(row)); },
  }; } };
  f.approve = createScopedProviderApprovalCommands({ db, ...scope, plantId: userId, now: () => 1000,
    async transaction(fn) { const before = structuredClone(rows); session = { inTransaction: () => true };
      try { return await fn(session); } catch(e) { rows = before; throw e; } },
    foundation: { async authorizeInTransaction(actor, request, opts) { f.calls++; assert.equal(opts.session, session);
      assert.equal(request.action, 'provider.reply.approve'); if (f.denied) throw Error('DENIED');
      return { tenantId, plantId: userId, userId }; } },
    async verifyBindingSource(request, s) { assert.equal(s, session); if (f.badSource) throw Error('SOURCE_DENIED');
      return { ...scope, ...request, expiresAt: 3000 }; },
  });
  f.rows = () => structuredClone(rows);
  f.change = (kind, patch) => Object.assign(rows.provider_authority.find(r => r.kind === kind), patch);
  return f;
}

test('approval pins queued metadata, CAS advances reply and receipt replay reauthorizes', async () => {
  const f = fixture(); const result = await f.approve('actor', input());
  assert.deepEqual(result, { replyId: tenantId, authorityRevision: 2, state: 'APPROVED' });
  assert.equal(f.rows().provider_authority[3].state, 'APPROVED');
  const approval = f.rows().provider_authority[4];
  assert.equal(approval.kind, 'approval'); assert.equal(approval.approvedBy, userId);
  assert.equal(approval.revoked, false); assert.equal(approval.contentHash, input().contentHash);
  assert.deepEqual(await f.approve('actor', input()), result);
  assert.equal(f.rows().provider_audit.length, 1);
  f.badSource = true; await assert.rejects(f.approve('actor', input()), /SOURCE_DENIED/);
  f.denied = true; await assert.rejects(f.approve('actor', input()), /DENIED/);
});

test('revocation, stale authority, paused policy and altered metadata deny approval and replay', async () => {
  for (const [kind, patch] of [['policy', { paused: true }], ['identity', { active: false }],
    ['binding', { version: 2 }], ['reply', { state: 'REVOKED' }], ['approval', { revoked: true }]]) {
    const f = fixture(); await f.approve('actor', input()); f.change(kind, patch);
    await assert.rejects(f.approve('actor', input())); assert.equal(f.rows().provider_commands.length, 1);
  }
  const f = fixture();
  for (const patch of [{ contentHash: 'b'.repeat(64) }, { expiresAt: 1999 }, { expectedReplyRevision: 2 }, { body: 'private' }]) {
    await assert.rejects(f.approve('actor', { ...input(), ...patch }));
  }
  assert.equal(f.rows().provider_audit.length, 0);
});

test('CAS and uncertain outbox failures roll back without issuing another approval', async () => {
  const f = fixture(); const before = f.rows(); f.loseCAS = true;
  await assert.rejects(f.approve('actor', input()), /FENCED/); assert.deepEqual(f.rows(), before);
  f.loseCAS = false; f.failOutbox = true;
  await assert.rejects(f.approve('actor', input()), /UNKNOWN_STORAGE/); assert.deepEqual(f.rows(), before);
  f.failOutbox = false; await f.approve('actor', input());
  await assert.rejects(f.approve('actor', { ...input(), expectedReplyRevision: 2 }), /CONFLICT/);
  await assert.rejects(f.approve('actor', { ...input(), commandId: tenantId }), /REVISION_CONFLICT/);
});
