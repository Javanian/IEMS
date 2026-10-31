import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalAccessService } from '../../apps/portfolio-api/src/portals.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = Object.freeze({});
const input = () => ({ plantId: id(2), grantId: id(4), userId: id(5), partyId: id(6), kind: 'VENDOR',
  actions: ['portal.vendor.read', 'portal.vendor.respond'], expiresAt: new Date(Date.now() + 86400000).toISOString(), commandKey: 'grant-1' });
function fixture() {
  let state = { memberships: [{ _id: id(7), tenantId: id(1), userId: id(5), active: true, version: 1, plantIds: [id(2)], legalEntityIds: [id(8)] }],
    users: [{ _id: id(5), active: true }], vendors: [{ _id: id(6), tenantId: id(1), plantId: id(2) }], accounts: [],
    portal_party_grants: [], foundationCommandResults: [], audit: [], outbox: [], saasSubscriptions: [] };
  let pending, active = false;
  const control = { denied: false, auditFailure: false, authorizations: 0, indexes: [] };
  const session = {
    startTransaction() { pending = structuredClone(state); active = true; }, inTransaction: () => active,
    async commitTransaction() { state = pending; active = false; }, async abortTransaction() { active = false; }, async endSession() {},
  };
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const service = createPortalAccessService({ client: { startSession: () => session },
    foundation: { async authorizeInTransaction(received, target, options) {
      assert.equal(received, scope); assert.equal(options.session, session); assert.equal(target.action, 'portal.access.manage');
      control.authorizations++;
      if (control.denied) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      return { tenantId: id(1), plantId: id(2), userId: id(3), legalEntityId: id(8) };
    } },
    db: { collection(name) { return {
      async createIndex(keys, options) { control.indexes.push({ name, keys, options }); },
      async findOne(filter, options) {
        assert.equal(options.session, session);
        if (name === 'saasSubscriptions') assert.deepEqual(filter, { tenantId: id(1) });
        return pending[name].find(row => match(row, filter));
      },
      async updateOne(filter, update, options) {
        assert.equal(options.session, session);
        const row = pending[name].find(row => match(row, filter));
        if (!row) return { matchedCount: 0 };
        row.authorizationFence = (row.authorizationFence ?? 0) + update.$inc.authorizationFence;
        return { matchedCount: 1 };
      },
      async insertOne(row) {
        if (name === 'audit' && control.auditFailure) throw new Error('AUDIT_UNAVAILABLE');
        if (name === 'portal_party_grants' && pending[name].some(r => r._id === row._id ||
          (r.active && ['tenantId', 'plantId', 'userId', 'partyId', 'kind'].every(k => r[k] === row[k])))) {
          throw Object.assign(new Error('duplicate'), { code: 11000 });
        }
        pending[name].push(row);
      },
      async insertMany(rows) { pending[name].push(...rows); },
    }; } },
  });
  return { service, control, state: () => state };
}

test('provision stores bounded grant with recipient fences and atomic receipt; replay reauthorizes admin', async () => {
  const f = fixture(), request = input();
  const first = await f.service.provision(scope, request);
  assert.equal(first.revision, 1);
  const row = f.state().portal_party_grants[0];
  assert.ok(row.expiresAt instanceof Date);
  assert.equal(row.revision, 1); assert.equal(row.createdBy, id(3));
  assert.equal(f.state().memberships[0].authorizationFence, 1);
  assert.equal(f.state().users[0].authorizationFence, 1);
  assert.equal(f.state().audit.length, 1);
  assert.deepEqual(f.state().outbox[0].data, { grantId: id(4), revision: 1 });
  assert.equal((await f.service.provision(scope, request)).replayed, true);
  assert.equal(f.control.authorizations, 2);
  assert.equal(f.state().portal_party_grants.length, 1);
  f.control.denied = true;
  await assert.rejects(f.service.provision(scope, request), { code: 'FORBIDDEN' });
});

test('target disabled, wrong plant/entity/tenant or absent party denies creation', async () => {
  for (const mutate of [s => { s.users[0].active = false; }, s => { s.memberships[0].active = false; },
    s => { s.memberships[0].plantIds = []; }, s => { s.memberships[0].legalEntityIds = []; },
    s => { s.memberships[0].tenantId = id(9); }, s => { s.vendors[0].plantId = id(9); }]) {
    const f = fixture(); mutate(f.state());
    await assert.rejects(f.service.provision(scope, input()), { code: 'PORTAL_TARGET_DENIED' });
    assert.equal(f.state().portal_party_grants.length, 0);
    assert.equal(f.state().foundationCommandResults.length, 0);
    assert.equal(f.state().memberships[0].authorizationFence, undefined);
  }
});

test('enrolled tenant requires admission before provisioning any grant', async () => {
  const f = fixture(); f.state().saasSubscriptions.push({ tenantId: id(1) });
  const before = structuredClone(f.state());
  await assert.rejects(f.service.provision(scope, input()), { code: 'SAAS_ADMISSION_PORT_REQUIRED' });
  assert.deepEqual(f.state(), before);
});

test('audit failure rolls back grant and recipient fences', async () => {
  const f = fixture(); f.control.auditFailure = true;
  await assert.rejects(f.service.provision(scope, input()), /AUDIT_UNAVAILABLE/);
  assert.equal(f.state().portal_party_grants.length, 0);
  assert.equal(f.state().foundationCommandResults.length, 0);
  assert.equal(f.state().outbox.length, 0);
  assert.equal(f.state().users[0].authorizationFence, undefined);
});

test('reject malformed fields, permission escalation and expiry outside policy', async () => {
  const f = fixture();
  for (const patch of [{ tenantId: id(9) }, { userId: { $ne: null } }, { actions: ['portal.access.manage'] },
    { actions: ['portal.vendor.respond'] }, { actions: ['portal.vendor.read', 'portal.vendor.read'] },
    { kind: 'CUSTOMER' }, { expiresAt: 'tomorrow' }]) {
    await assert.rejects(f.service.provision(scope, { ...input(), ...patch }), { code: 'INVALID_PORTAL_GRANT' });
  }
  for (const delta of [-1000, 31 * 86400000]) {
    await assert.rejects(f.service.provision(scope, { ...input(), expiresAt: new Date(Date.now() + delta).toISOString() }), { code: 'INVALID_PORTAL_EXPIRY' });
  }
  assert.equal(f.state().portal_party_grants.length, 0);
});

test('duplicate active party grant conflicts and changed command input cannot replay', async () => {
  const f = fixture(), request = input(); await f.service.provision(scope, request);
  await assert.rejects(f.service.provision(scope, { ...request, userId: id(9) }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.service.provision(scope, { ...request, grantId: id(10), commandKey: 'grant-2' }), { code: 'PORTAL_GRANT_EXISTS' });
  assert.equal(f.state().portal_party_grants.length, 1);
});

test('initialization declares unique active grant boundary without TTL deletion of history', async () => {
  const f = fixture(); await f.service.initialize();
  const index = f.control.indexes.find(row => row.name === 'portal_party_grants');
  assert.deepEqual(index.options, { unique: true, partialFilterExpression: { active: true } });
  assert.deepEqual(Object.keys(index.keys), ['tenantId', 'plantId', 'userId', 'partyId', 'kind']);
});
