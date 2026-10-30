import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedProviderPolicyCommands } from '../src/provider-operator.mjs';
const tenantId = '11111111-1111-4111-8111-111111111111';
const plantId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const commandId = '44444444-4444-4444-8444-444444444444';
const input = () => ({ commandId, expectedRevision: 1, policy: { enabled: true, paused: false,
  expiresAt: 2000, allowlist: ['synthetic'], prefix: 'IEMS ' } });
function fixture() {
  let rows = { provider_authority: [{ tenantId, accountId: 'synthetic', kind: 'policy', resourceId: 'account', authorityRevision: 1, revision: 1 }],
    provider_commands: [], provider_audit: [], provider_outbox: [] };
  let active;
  const f = { denied: false, failOutbox: false, loseCAS: false, calls: 0, at: 1000 };
  const matches = (row, key) => Object.entries(key).every(([k, v]) => row[k] === v);
  const db = { collection(name) { return {
    async findOne(key, { session }) { assert.equal(session, active); return structuredClone(rows[name].find(row => matches(row, key))); },
    async updateOne(key, update, { session }) {
      assert.equal(session, active);
      const row = rows[name].find(row => matches(row, key));
      if (!row || f.loseCAS) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      for (const [key, value] of Object.entries(update.$inc)) row[key] += value;
      return { matchedCount: 1 };
    },
    async insertOne(row, { session }) { assert.equal(session, active);
      if (name === 'provider_outbox' && f.failOutbox) throw new Error('UNKNOWN_STORAGE');
      rows[name].push(structuredClone(row)); },
  }; } };
  f.commands = createScopedProviderPolicyCommands({ db, tenantId, plantId, accountId: 'synthetic', now: () => f.at,
    async transaction(fn) { const before = structuredClone(rows); active = { inTransaction: () => true };
      try { return await fn(active); } catch (error) { rows = before; throw error; } },
    foundation: { async authorizeInTransaction(actor, request, { session }) {
      f.calls++; assert.equal(actor, 'opaque'); assert.equal(session, active);
      assert.deepEqual(request, { tenantId, plantId, action: 'provider.authority.configure' });
      if (f.denied) throw new Error('DENIED'); return { tenantId, plantId, userId };
    } },
  });
  f.rows = () => structuredClone(rows);
  return f;
}
test('policy CAS advances both revisions and replay reauthorizes without restoring old policy', async () => {
  const f = fixture();
  const first = await f.commands.configurePolicy('opaque', input());
  assert.equal(first.authorityRevision, 2); assert.equal(first.policyRevision, 2);
  await f.commands.configurePolicy('opaque', { ...input(), commandId: tenantId, expectedRevision: 2,
    policy: { ...input().policy, paused: true } });
  f.at = 3000;
  assert.deepEqual(await f.commands.configurePolicy('opaque', input()), first);
  assert.equal(f.rows().provider_authority[0].paused, true);
  assert.equal(f.rows().provider_authority[0].revision, 3);
  assert.equal(f.rows().provider_audit.length, 2);
  f.denied = true;
  await assert.rejects(f.commands.configurePolicy('opaque', input()), /DENIED/);
});
test('stale revision, failed CAS and unknown outbox outcome leave all effects unchanged', async () => {
  const f = fixture(); const before = f.rows();
  await assert.rejects(f.commands.configurePolicy('opaque', { ...input(), expectedRevision: 2 }), /FENCED/);
  f.loseCAS = true;
  await assert.rejects(f.commands.configurePolicy('opaque', input()), /FENCED/);
  f.loseCAS = false; f.failOutbox = true;
  await assert.rejects(f.commands.configurePolicy('opaque', input()), /UNKNOWN_STORAGE/);
  assert.deepEqual(f.rows(), before); assert.equal(f.calls, 3);
});
test('private metadata, malformed policies, expiry and conflicting replay are rejected', async () => {
  const f = fixture();
  for (const patch of [{ body: 'private' }, { enabled: 'true' }, { expiresAt: 1000 },
    { expiresAt: 1000 + 31 * 86400000 }, { prefix: '' }, { allowlist: ['x', 'x'] }]) {
    await assert.rejects(f.commands.configurePolicy('opaque', { ...input(), policy: { ...input().policy, ...patch } }), /INVALID_PROVIDER_POLICY/);
  }
  assert.equal(f.rows().provider_commands.length, 0);
  await f.commands.configurePolicy('opaque', input());
  await assert.rejects(f.commands.configurePolicy('opaque', { ...input(), policy: { ...input().policy, paused: true } }), /CONFLICT/);
});
