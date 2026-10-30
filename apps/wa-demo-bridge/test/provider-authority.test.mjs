import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableProviderPolicy } from '../src/provider-authority.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const replyId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const scope = { tenantId, accountId: 'synthetic' };
const input = { ...scope, replyId, deliveryId: customerId, ownerId: 'owner', generation: 1 };
function fixture({ missing, conflict, storageFailure } = {}) {
  const common = { ...scope, authorityRevision: 1, recipient: 'test:recipient', expiresAt: 2000 };
  const versions = { policyRevision: 1, identityVersion: 2, bindingVersion: 3 };
  const rows = {
    policy: { ...common, enabled: true, paused: false, revision: 1, prefix: 'IEMS ', allowlist: [common.recipient] },
    identity: { ...common, active: true, version: 2 },
    binding: { ...common, active: true, version: 3, customerId },
    reply: { ...common, ...versions, replyId, customerId, mode: 'LIVE', state: 'APPROVED', contentHash: 'a'.repeat(64), commandPrefix: 'IEMS ' },
    approval: { ...common, ...versions, replyId, customerId, revoked: false, state: 'APPROVED', approvedBy: customerId, contentHash: 'a'.repeat(64) },
  };
  const calls = [];
  const session = {};
  const db = { collection: name => {
    assert.equal(name, 'provider_authority');
    return {
      async findOne(key, options) {
        assert.equal(options.session, session);
        assert.equal(key.tenantId, tenantId);
        assert.equal(key.accountId, scope.accountId);
        assert.equal(key.resourceId, ['reply', 'approval'].includes(key.kind) ? replyId : key.kind === 'policy' ? 'account' : 'test:recipient');
        assert.equal(options.projection.text, undefined);
        assert.equal(options.projection.body, undefined);
        calls.push(['read', key.kind]);
        return key.kind === missing ? null : structuredClone(rows[key.kind]);
      },
      async updateOne(key, update, options) {
        assert.equal(options.session, session);
        assert.equal(key.authorityRevision, 1);
        assert.deepEqual(update, { $inc: { registrationFences: 1 } });
        calls.push(['fence', key.kind]);
        if (storageFailure) throw new Error('UNKNOWN_STORAGE');
        return { matchedCount: key.kind === conflict ? 0 : 1 };
      },
    };
  } };
  return { authorize: createDurableProviderPolicy({ db, ...scope, now: () => 1000 }), session, rows, calls };
}

test('all five scoped authorities are write-fenced in the supplied effect transaction', async () => {
  const f = fixture();
  assert.equal(await f.authorize(input, f.session), true);
  assert.equal(f.calls.filter(([operation]) => operation === 'fence').length, 5);
  f.rows.identity.active = false;
  await assert.rejects(f.authorize(input, f.session), /PROVIDER_POLICY_DENIED/);
});

test('missing rows and every failed revision fence deny registration', async () => {
  for (const kind of ['reply', 'policy', 'identity', 'binding', 'approval']) {
    for (const option of ['missing', 'conflict']) {
      const f = fixture({ [option]: kind });
      await assert.rejects(f.authorize(input, f.session), /PROVIDER_AUTHORITY_FENCED/);
    }
  }
});

test('malformed request performs no storage access; uncertain storage is never retried', async () => {
  const f = fixture();
  await assert.rejects(f.authorize({ ...input, accountId: 'other' }, f.session), /PROVIDER_POLICY_DENIED/);
  assert.equal(f.calls.length, 0);
  const failed = fixture({ storageFailure: true });
  await assert.rejects(failed.authorize(input, failed.session), /UNKNOWN_STORAGE/);
  assert.equal(failed.calls.length, 2);
});
