import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistrationPolicy } from '../src/provider-policy.mjs';

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', accountId: 'synthetic' };
const replyId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const input = { ...scope, replyId, deliveryId: '44444444-4444-4444-8444-444444444444', ownerId: 'owner:1', generation: 1 };
const session = {};
function fixture() {
  const common = { ...scope, recipient: 'test:recipient', expiresAt: 2000 };
  const snapshot = {
    policy: { ...scope, enabled: true, paused: false, revision: 1, expiresAt: 2000, prefix: 'IEMS ', allowlist: [common.recipient] },
    identity: { ...common, active: true, version: 2 },
    binding: { ...common, active: true, version: 3, customerId },
    reply: { ...common, replyId, customerId, mode: 'LIVE', state: 'APPROVED', contentHash: 'a'.repeat(64), commandPrefix: 'IEMS ', policyRevision: 1, identityVersion: 2, bindingVersion: 3 },
    approval: { ...common, replyId, customerId, revoked: false, state: 'APPROVED', approvedBy: customerId, contentHash: 'a'.repeat(64), policyRevision: 1, identityVersion: 2, bindingVersion: 3 },
  };
  let calls = 0;
  const authorize = createProviderRegistrationPolicy({ ...scope, now: () => 1000,
    readAndFence: async (request, activeSession) => {
      calls++;
      assert.equal(activeSession, session);
      assert.deepEqual(request, input);
      assert.ok(Object.isFrozen(request));
      return structuredClone(snapshot);
    },
  });
  return { snapshot, authorize, calls: () => calls };
}

test('policy checks metadata in the caller transaction and rechecks replay', async () => {
  const f = fixture();
  assert.equal(await f.authorize(input, session), true);
  f.snapshot.approval.revoked = true;
  await assert.rejects(f.authorize(input, session), /PROVIDER_POLICY_DENIED/);
  assert.equal(f.calls(), 2);
});

test('each authority rejects a different tenant or account', async () => {
  for (const row of ['policy', 'identity', 'binding', 'reply', 'approval']) {
    for (const field of ['tenantId', 'accountId']) {
      const f = fixture();
      f.snapshot[row][field] = 'other';
      await assert.rejects(f.authorize(input, session), /PROVIDER_POLICY_DENIED/);
    }
  }
});

test('pause, expiry, allowlist, prefix and version changes revoke queued authorization', async () => {
  const cases = [
    ['policy', 'paused', true], ['policy', 'enabled', false], ['policy', 'expiresAt', 1000],
    ['policy', 'allowlist', []], ['policy', 'prefix', 'OTHER '], ['policy', 'revision', 2],
    ['identity', 'active', false], ['identity', 'version', 3], ['identity', 'expiresAt', 1000],
    ['binding', 'active', false], ['binding', 'version', 4], ['binding', 'customerId', input.deliveryId],
    ['reply', 'mode', 'PREVIEW_ONLY'], ['reply', 'state', 'CANCELLED'], ['reply', 'expiresAt', 1000],
    ['approval', 'expiresAt', 1000], ['approval', 'contentHash', 'b'.repeat(64)], ['approval', 'replyId', input.deliveryId],
    ['approval', 'identityVersion', 1], ['approval', 'bindingVersion', 1], ['approval', 'recipient', 'other'],
    ['approval', 'state', 'PENDING'], ['approval', 'approvedBy', null], ['binding', 'expiresAt', 1000],
  ];
  for (const [row, field, value] of cases) {
    const f = fixture();
    f.snapshot[row][field] = value;
    await assert.rejects(f.authorize(input, session), /PROVIDER_POLICY_DENIED/, `${row}.${field}`);
  }
});

test('missing transaction and malformed scope fail before authority access', async () => {
  const f = fixture();
  await assert.rejects(f.authorize(input), /PROVIDER_POLICY_DENIED/);
  for (const patch of [{ tenantId: 'other' }, { accountId: 'other' }, { replyId: null }, { generation: 0 }]) {
    await assert.rejects(f.authorize({ ...input, ...patch }, session), /PROVIDER_POLICY_DENIED/);
  }
  assert.equal(f.calls(), 0);
});

test('authority failures propagate without retry', async () => {
  let calls = 0;
  const authorize = createProviderRegistrationPolicy({ ...scope, readAndFence: async () => { calls++; throw new Error('UNKNOWN_COMMIT'); } });
  await assert.rejects(authorize(input, session), /UNKNOWN_COMMIT/);
  assert.equal(calls, 1);
});
