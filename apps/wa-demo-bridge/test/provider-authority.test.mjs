import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableProviderPolicy, revokeProviderAuthority } from '../src/provider-authority.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const replyId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const scope = { tenantId, accountId: 'synthetic' };
const input = { ...scope, replyId, deliveryId: customerId, ownerId: 'owner', generation: 1 };
function fixture({ missing, conflict, storageFailure, sourcePatch, sourceFailure } = {}) {
  const common = { ...scope, authorityRevision: 1, recipient: 'test:recipient', expiresAt: 2000 };
  const versions = { policyRevision: 1, identityVersion: 2, bindingVersion: 3 };
  const rows = {
    policy: { ...common, enabled: true, paused: false, revision: 1, prefix: 'IEMS ', allowlist: [common.recipient] },
    identity: { ...common, active: true, version: 2 },
    binding: { ...common, active: true, version: 3, customerId, sourceBindingId: customerId, sourceBindingVersion: 7 },
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
  const verifyBindingSource = async (request, effectSession) => {
    assert.equal(effectSession, session);
    assert.deepEqual(request, { bindingId: customerId, version: 7, recipient: common.recipient, customerId });
    calls.push(['source', 'binding']);
    if (sourceFailure) throw new Error('SOURCE_REVOKED');
    return { ...scope, ...request, expiresAt: 2000, ...sourcePatch };
  };
  return { authorize: createDurableProviderPolicy({ db, ...scope, verifyBindingSource, now: () => 1000 }), session, rows, calls };
}

test('source authority is mandatory and revalidated on every registration including replay', async () => {
  assert.throws(() => createDurableProviderPolicy({ db: { collection() {} }, ...scope }), /INVALID_PROVIDER_AUTHORITY_CONFIGURATION/);
  const f = fixture();
  await f.authorize(input, f.session);
  await f.authorize(input, f.session);
  assert.equal(f.calls.filter(([op]) => op === 'source').length, 2);
  for (const sourcePatch of [{ tenantId: customerId }, { accountId: 'other' }, { bindingId: replyId },
    { version: 8 }, { recipient: 'other' }, { customerId: tenantId }, { expiresAt: 1999 }, { expiresAt: NaN }]) {
    const denied = fixture({ sourcePatch });
    await assert.rejects(denied.authorize(input, denied.session), /PROVIDER_AUTHORITY_FENCED/);
  }
  const revoked = fixture({ sourceFailure: true });
  await assert.rejects(revoked.authorize(input, revoked.session), /SOURCE_REVOKED/);
  assert.equal(revoked.calls.filter(([op]) => op === 'source').length, 1);
});

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

test('revocation disables each authority using scoped revision CAS in the effect session', async () => {
  for (const kind of ['policy', 'identity', 'binding', 'reply', 'approval']) {
    const session = {};
    const resourceId = kind === 'policy' ? 'account' : ['reply', 'approval'].includes(kind) ? replyId : 'test:recipient';
    const db = { collection(name) {
      assert.equal(name, 'provider_authority');
      return { async updateOne(key, update, options) {
        assert.deepEqual(key, { ...scope, kind, resourceId, authorityRevision: 7 });
        assert.equal(options.session, session);
        assert.deepEqual(update.$inc, { authorityRevision: 1 });
        assert.deepEqual(update.$set, {
          policy: { enabled: false, paused: true }, identity: { active: false },
          binding: { active: false }, reply: { state: 'REVOKED' },
          approval: { revoked: true, state: 'REVOKED' },
        }[kind]);
        return { matchedCount: 1 };
      } };
    } };
    assert.deepEqual(await revokeProviderAuthority({ db, ...scope, kind, resourceId, expectedRevision: 7 }, session),
      { kind, resourceId, authorityRevision: 8 });
  }
});

test('revocation rejects malformed input, missing session, stale revisions and uncertain writes without retry', async () => {
  let calls = 0;
  let fail = false;
  const db = { collection: () => ({ async updateOne() {
    calls++;
    if (fail) throw new Error('UNKNOWN_STORAGE');
    return { matchedCount: 0 };
  } }) };
  const input = { db, ...scope, kind: 'policy', resourceId: 'account', expectedRevision: 1 };
  for (const delta of [{ kind: '__proto__' }, { expectedRevision: 0 }, { expectedRevision: Number.MAX_SAFE_INTEGER },
    { tenantId: 'other' }, { resourceId: 'other' }, { kind: 'reply', resourceId: 'invalid' }]) {
    await assert.rejects(revokeProviderAuthority({ ...input, ...delta }, {}), /PROVIDER_AUTHORITY_FENCED/);
  }
  await assert.rejects(revokeProviderAuthority(input), /PROVIDER_AUTHORITY_FENCED/);
  assert.equal(calls, 0);
  await assert.rejects(revokeProviderAuthority(input, {}), /PROVIDER_AUTHORITY_FENCED/);
  fail = true;
  await assert.rejects(revokeProviderAuthority(input, {}), /UNKNOWN_STORAGE/);
  assert.equal(calls, 2);
});
