import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePortalParty, readVendorPurchaseOrderForPrincipal } from '../../apps/portfolio-api/src/portals.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { tenantId: id(1), plantId: id(2), userId: id(3) };
const input = { plantId: actor.plantId, partyId: id(4), kind: 'VENDOR', action: 'portal.vendor.read' };
const session = { inTransaction: () => true };
const opaqueScope = Object.freeze({});
function fixture({ denied = false, grant = true, party = true } = {}) {
  const calls = [];
  return { calls, runtime: {
    foundation: { async authorizeInTransaction(scope, permission, options) {
      assert.equal(scope, opaqueScope);
      assert.equal(options.session, session);
      calls.push({ foundation: permission });
      if (denied) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      return actor;
    } },
    db: { collection(name) { return {
      async findOneAndUpdate(filter, update, options) {
        assert.equal(name, 'portal_party_grants');
        assert.equal(options.session, session);
        assert.equal(options.returnDocument, 'after');
        calls.push({ name, filter, update });
        return grant ? { _id: id(5) } : null;
      },
      async findOne(filter, options) {
        assert.equal(options.session, session);
        calls.push({ name, filter });
        return name === 'vendors' && party ? { _id: input.partyId } : null;
      },
    }; } },
  } };
}

test('access binds opaque authentication, exact party, permission and expiry in transaction', async () => {
  const { runtime, calls } = fixture();
  const result = await authorizePortalParty(runtime, opaqueScope, input, session);
  assert.equal(result.userId, actor.userId);
  assert.equal(result.partyId, input.partyId);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(calls[0].foundation, { plantId: input.plantId, action: input.action });
  const grant = calls[1];
  assert.deepEqual({ ...grant.filter, expiresAt: undefined }, {
    tenantId: actor.tenantId, plantId: actor.plantId, userId: actor.userId,
    partyId: input.partyId, kind: 'VENDOR', active: true, actions: input.action, expiresAt: undefined,
  });
  assert.ok(grant.filter.expiresAt.$gt instanceof Date);
  assert.deepEqual(grant.update, { $inc: { authorizationFence: 1 } });
  assert.deepEqual(calls[2].filter, { tenantId: actor.tenantId, plantId: actor.plantId, _id: input.partyId });
});

test('foundation denial prevents any party/grant lookup', async () => {
  const { runtime, calls } = fixture({ denied: true });
  await assert.rejects(authorizePortalParty(runtime, opaqueScope, input, session), { code: 'FORBIDDEN' });
  assert.equal(calls.length, 1);
});

test('absent, revoked, expired or wrong-party grant cannot fall back to source access', async () => {
  const { runtime, calls } = fixture({ grant: false });
  await assert.rejects(readVendorPurchaseOrderForPrincipal(runtime, opaqueScope, {
    plantId: input.plantId, vendorId: input.partyId, orderId: id(6), cohort: 'LEGACY',
  }, session), { code: 'PORTAL_ACCESS_DENIED' });
  assert.equal(calls.length, 2);
  // The fake models a non-matching grant; Mongo expiry/revocation races remain final QA.
});

test('missing source party is denied after the grant fence', async () => {
  const { runtime } = fixture({ party: false });
  await assert.rejects(authorizePortalParty(runtime, opaqueScope, input, session), { code: 'PORTAL_ACCESS_DENIED' });
});

test('malformed identifiers, kind/action escalation and missing transaction fail before authentication', async () => {
  const { runtime, calls } = fixture();
  for (const patch of [{ partyId: { $ne: null } }, { plantId: 'x' }, { kind: 'ADMIN' }, { action: 'portal.access.manage' }, { kind: 'CUSTOMER' }]) {
    await assert.rejects(authorizePortalParty(runtime, opaqueScope, { ...input, ...patch }, session), { code: 'INVALID_PORTAL_ACCESS' });
  }
  await assert.rejects(authorizePortalParty(runtime, opaqueScope, input, null), /ACTIVE_CALLER_TRANSACTION_REQUIRED/);
  assert.equal(calls.length, 0);
});

test('protected source read obtains tenant from foundation rather than request fields', async () => {
  const { runtime, calls } = fixture();
  const result = await readVendorPurchaseOrderForPrincipal(runtime, opaqueScope, {
    tenantId: id(99), userId: id(99), plantId: input.plantId, vendorId: input.partyId,
    orderId: id(6), cohort: 'LEGACY',
  }, session);
  assert.equal(result, null);
  const source = calls.find(call => call.name === 'purchaseOrders');
  assert.equal(source.filter.tenantId, actor.tenantId);
  assert.equal(source.filter.vendorId, input.partyId);
});
