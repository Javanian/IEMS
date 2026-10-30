import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderOperatorAuthorization, createScopedProviderRevocationCommands, providerOperatorRoles } from '../src/provider-operator.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const plantId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const accountId = 'synthetic-provider';
const request = { tenantId, accountId, action: 'provider.authority.revoke' };
const session = { inTransaction: () => true };
function fixture() {
  const actor = Object.freeze({});
  const f = { calls: 0, revoked: false, grant: { tenantId, plantId, userId } };
  f.authorize = createProviderOperatorAuthorization({ tenantId, plantId, accountId, foundation: {
    async authorizeInTransaction(scope, target, options) {
      f.calls++;
      assert.equal(scope, actor);
      assert.deepEqual(target, { tenantId, plantId, action: request.action });
      assert.equal(options.session, session);
      if (f.revoked) throw Object.assign(new Error('FOUNDATION_DENIED'), { status: 403 });
      return f.grant;
    },
  } });
  f.actor = actor;
  return f;
}

test('operator authority uses the opaque scope and the caller effect transaction on every call', async () => {
  const f = fixture();
  assert.deepEqual(await f.authorize(f.actor, request, session), { tenantId, accountId, userId });
  f.revoked = true;
  await assert.rejects(f.authorize(f.actor, request, session), /FOUNDATION_DENIED/);
  assert.equal(f.calls, 2);
});

test('wrong tenant, account, action and request-supplied plant reject before foundation access', async () => {
  const f = fixture();
  for (const change of [{ tenantId: userId }, { accountId: 'other' }, { action: 'provider.send' },
    { action: '__proto__' }, { plantId }, { userId }]) {
    await assert.rejects(f.authorize(f.actor, { ...request, ...change }, session), /PROVIDER_OPERATOR_DENIED/);
  }
  for (const inactive of [null, {}, { inTransaction: () => false }]) {
    await assert.rejects(f.authorize(f.actor, request, inactive), /PROVIDER_OPERATOR_DENIED/);
  }
  assert.equal(f.calls, 0);
});

test('foundation grants must match the configured tenant and plant and identify a user', async () => {
  const f = fixture();
  for (const grant of [null, { tenantId: userId, plantId, userId },
    { tenantId, plantId: userId, userId }, { tenantId, plantId, userId: 'bad' }]) {
    f.grant = grant;
    await assert.rejects(f.authorize(f.actor, request, session), /PROVIDER_OPERATOR_DENIED/);
  }
});

test('configuration and role declarations fail closed and cannot be expanded in place', () => {
  for (const change of [{ tenantId: 'bad' }, { plantId: 'bad' }, { accountId: '' }, { foundation: {} }]) {
    assert.throws(() => createProviderOperatorAuthorization({ tenantId, plantId, accountId,
      foundation: { authorizeInTransaction() {} }, ...change }), /INVALID_PROVIDER_OPERATOR_CONFIGURATION/);
  }
  assert.throws(() => providerOperatorRoles.providerAuthorityAdmin.push('provider.send'), TypeError);
  assert.equal(providerOperatorRoles.providerAuthorityAdmin.includes('provider.send'), false);
});

test('composed command rechecks revoked membership before returning a stored receipt', async () => {
  const commandId = '44444444-4444-4444-8444-444444444444';
  let revoked = false, receipt, writes = 0;
  const actor = {};
  const commands = createScopedProviderRevocationCommands({ tenantId, plantId, accountId,
    foundation: { async authorizeInTransaction(scope, target, options) {
      assert.equal(scope, actor);
      assert.deepEqual(target, { tenantId, plantId, action: 'provider.authority.revoke' });
      assert.equal(options.session, session);
      if (revoked) throw new Error('FOUNDATION_DENIED');
      return { tenantId, plantId, userId };
    } },
    transaction: async fn => fn(session),
    db: { collection(name) { return {
      async findOne(key, options) {
        assert.equal(name, 'provider_commands');
        assert.deepEqual(key, { tenantId, accountId, commandId });
        assert.equal(options.session, session);
        return receipt;
      },
      async updateOne(key, update, options) {
        assert.equal(name, 'provider_authority');
        assert.deepEqual(key, { tenantId, accountId, kind: 'policy', resourceId: 'account', authorityRevision: 1 });
        assert.equal(options.session, session);
        writes++;
        return { matchedCount: 1 };
      },
      async insertOne(row, options) {
        assert.equal(options.session, session);
        if (name === 'provider_commands') receipt = structuredClone(row);
      },
    }; } },
  });
  const input = { commandId, kind: 'policy', resourceId: 'account', expectedRevision: 1 };
  const result = await commands.revoke(actor, input);
  assert.deepEqual(await commands.revoke(actor, input), result);
  assert.equal(writes, 1);
  revoked = true;
  await assert.rejects(commands.revoke(actor, input), /FOUNDATION_DENIED/);
  assert.equal(writes, 1);
});
