import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalAccessService } from '../../apps/portfolio-api/src/portals.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = Object.freeze({});
const input = { plantId: id(2), grantId: id(4), expectedRevision: 1, commandKey: 'revoke-1' };
function fixture() {
  let state = { portal_party_grants: [{ _id: id(4), tenantId: id(1), plantId: id(2), revision: 1, active: true }], foundationCommandResults: [], audit: [], outbox: [], saasSubscriptions: [] };
  let pending, active = false;
  const control = { denied: false, auditFailure: false, authorizations: 0 };
  const session = {
    startTransaction() { pending = structuredClone(state); active = true; },
    inTransaction: () => active,
    async commitTransaction() { state = pending; active = false; },
    async abortTransaction() { active = false; },
    async endSession() {},
  };
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const service = createPortalAccessService({
    client: { startSession: () => session },
    foundation: { async authorizeInTransaction(received, target, options) {
      assert.equal(received, scope);
      assert.equal(options.session, session);
      assert.equal(target.action, 'portal.access.manage');
      control.authorizations++;
      if (control.denied || target.plantId !== id(2)) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      return { tenantId: id(1), plantId: id(2), userId: id(3) };
    } },
    db: { collection(name) { return {
      async findOne(filter, options) {
        assert.equal(options.session, session);
        if (name === 'saasSubscriptions') assert.deepEqual(filter, { tenantId: id(1) });
        return pending[name].find(row => match(row, filter));
      },
      async findOneAndUpdate(filter, update, options) {
        assert.equal(options.session, session);
        const row = pending[name].find(row => match(row, filter));
        if (!row) return null;
        Object.assign(row, update.$set);
        row.authorizationFence = (row.authorizationFence ?? 0) + update.$inc.authorizationFence;
        return row;
      },
      async insertOne(row) {
        if (name === 'audit' && control.auditFailure) throw new Error('AUDIT_UNAVAILABLE');
        pending[name].push(row);
      },
      async insertMany(rows) { pending[name].push(...rows); },
    }; } },
  });
  return { service, control, state: () => state };
}

test('revoke commits grant fence, result, audit and event; replay authorizes without another effect', async () => {
  const f = fixture();
  const first = await f.service.revoke(scope, input);
  assert.equal(first.revision, 2);
  const row = f.state().portal_party_grants[0];
  assert.equal(row.active, false);
  assert.equal(row.authorizationFence, 1);
  assert.equal(row.revokedBy, id(3));
  assert.equal(f.state().audit.length, 1);
  assert.equal(f.state().outbox[0].type, 'portal.grant.revoked');
  const replay = await f.service.revoke(scope, input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.commandId, first.commandId);
  assert.equal(f.control.authorizations, 2);
  assert.equal(f.state().audit.length, 1);
  f.control.denied = true;
  await assert.rejects(f.service.revoke(scope, input), { code: 'FORBIDDEN' });
});

test('audit failure aborts revocation and does not leave a result or event', async () => {
  const f = fixture();
  f.control.auditFailure = true;
  await assert.rejects(f.service.revoke(scope, input), /AUDIT_UNAVAILABLE/);
  assert.equal(f.state().portal_party_grants[0].active, true);
  assert.equal(f.state().foundationCommandResults.length, 0);
  assert.equal(f.state().outbox.length, 0);
});

test('enrolled tenant requires admission even on revocation replay', async () => {
  const f = fixture(); await f.service.revoke(scope, input);
  f.state().saasSubscriptions.push({ tenantId: id(1) });
  const before = structuredClone(f.state());
  await assert.rejects(f.service.revoke(scope, input), { code: 'SAAS_ADMISSION_PORT_REQUIRED' });
  assert.deepEqual(f.state(), before);
});

test('wrong plant, grant, stale revision and malformed fields cannot mutate grants', async () => {
  const denied = fixture();
  await assert.rejects(denied.service.revoke(scope, { ...input, plantId: id(9) }), { code: 'FORBIDDEN' });
  assert.equal(denied.state().portal_party_grants[0].active, true);
  for (const patch of [{ grantId: id(9) }, { expectedRevision: 2 }]) {
    const f = fixture();
    await assert.rejects(f.service.revoke(scope, { ...input, ...patch }), { code: 'PORTAL_GRANT_REVISION_CONFLICT' });
    assert.equal(f.state().portal_party_grants[0].active, true);
  }
  const f = fixture();
  for (const value of [null, undefined, [], 'invalid']) {
    await assert.rejects(f.service.revoke(scope, value), { code: 'INVALID_PORTAL_REVOCATION' });
  }
  for (const patch of [{ tenantId: id(9) }, { grantId: { $ne: null } }, { expectedRevision: 0 }, { expectedRevision: Number.MAX_SAFE_INTEGER }]) {
    await assert.rejects(f.service.revoke(scope, { ...input, ...patch }), { code: 'INVALID_PORTAL_REVOCATION' });
  }
  assert.equal(f.control.authorizations, 0);
});

test('reuse of command key with another revision is rejected', async () => {
  const f = fixture();
  await f.service.revoke(scope, input);
  await assert.rejects(f.service.revoke(scope, { ...input, expectedRevision: 2 }), { code: 'IDEMPOTENCY_CONFLICT' });
});
