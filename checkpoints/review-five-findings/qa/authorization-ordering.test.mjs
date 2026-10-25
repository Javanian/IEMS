import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bounded = promise => Promise.race([promise, new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Test-only authorization seam did not arrive')), 15000); timer.unref(); })]);
const omitted = new Set(['ownedRun', 'sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'audit']);
async function snapshot(h) { const result = {}; for (const row of await h.db.listCollections().toArray()) if (!omitted.has(row.name)) result[row.name] = await h.db.collection(row.name).find().sort({ _id: 1 }).toArray(); return result; }

test('independent authoritative revocation ordering on the real CS transaction port', async t => {
  const h = await startOwned(t, { customerService: { allowSyntheticOrders: true } }), member = { ...h.seeded[0], userId: randomUUID(), membershipId: randomUUID() }, f = h.runtime.foundation, cs = h.runtime.customerService;
  const ownerEntity = (await h.db.collection('plants').findOne({ _id: member.plantId })).legalEntityId;
  await f.provisionUser({ id: member.userId, tenantId: member.tenantId });
  await f.provisionMembership({ id: member.membershipId, tenantId: member.tenantId, userId: member.userId, plantIds: [member.plantId], legalEntityIds: [ownerEntity], roles: [{ role: 'owner', plantIds: [member.plantId] }, { role: 'csFixtureAdmin', plantIds: [member.plantId] }] });
  const initial = await f.issueSession({ userId: member.userId, tenantId: member.tenantId, selectedPlantId: member.plantId, ttlMs: 3600000 });
  const actor = await f.authenticate(initial.token), customerId = randomUUID(), bindingId = randomUUID(), contact = `SYNTHETIC-${randomUUID()}`;
  await cs.provisionFixtureCustomer(actor, { plantId: member.plantId, customerId, label: 'Synthetic independent ordering customer' });
  await cs.bindContact(actor, { plantId: member.plantId, bindingId, customerId, channelAccountId: 'SIMULATED', providerContactId: contact });
  const principal = await cs.resolveCustomerPrincipal({ tenantId: member.tenantId, channelAccountId: 'SIMULATED', providerContactId: contact });
  let draft = await cs.startComplaintDraft(principal, { requestKey: randomUUID() });
  for (const action of [{ type: 'GENERAL_INQUIRY' }, { type: 'SELECT_CATEGORY', category: 'OTHER' }, { type: 'DESCRIBE', text: 'Synthetic actual complaint for independent ordering tests' }]) draft = await cs.updateComplaintDraft(principal, { draftId: draft.draftId, expectedVersion: draft.version, action });
  const ticket = await cs.confirmComplaint(principal, { draftId: draft.draftId, expectedVersion: draft.version, inboundKey: randomUUID() }), route = `/cs/tickets/${ticket.ticketId}/internal-notes`;
  const fresh = async () => { const issued = await f.issueSession({ userId: member.userId, tenantId: member.tenantId, selectedPlantId: member.plantId, ttlMs: 3600000 }); return { ...issued, cookie: `portfolio_session=${issued.token}` }; };
  const edit = async (name, filter, update) => { const session = h.client.startSession(); try { await session.withTransaction(() => h.db.collection(name).updateOne(filter, update, { session }), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); } finally { await session.endSession(); } };
  const cases = [
    ['session revoke', async issued => { await f.revokeSession({ tenantId: member.tenantId, sessionId: issued.sessionId }); return async () => {}; }],
    ['membership role withdrawal without version increment', async () => { const row = await h.db.collection('memberships').findOne({ _id: member.membershipId }); await edit('memberships', { _id: row._id }, { $set: { roles: [] } }); return () => h.db.collection('memberships').updateOne({ _id: row._id }, { $set: { roles: row.roles } }); }],
    ['membership scope withdrawal', async () => { const row = await h.db.collection('memberships').findOne({ _id: member.membershipId }); await edit('memberships', { _id: row._id }, { $set: { plantIds: [] } }); return () => h.db.collection('memberships').updateOne({ _id: row._id }, { $set: { plantIds: row.plantIds } }); }],
    ...[['user deactivation', 'users', member.userId], ['tenant deactivation', 'tenants', member.tenantId], ['plant deactivation', 'plants', member.plantId], ['legal entity deactivation', 'legalEntities', ownerEntity]].map(([label, name, subject]) => [label, async () => { const row = await h.db.collection(name).findOne({ _id: subject }); await edit(name, { _id: subject }, { $set: { active: false } }); return () => h.db.collection(name).updateOne({ _id: subject }, { $set: { active: row.active } }); }]),
  ];
  for (const [name, change] of cases) await t.test(`${name} committed before authoritative verification denies fresh mutation and acknowledged replay`, async () => {
    for (const replay of [false, true]) {
      const issued = await fresh(), body = { text: `Synthetic ${name} note`, commandKey: randomUUID() };
      if (replay) assert.equal((await h.req(route, body, issued.cookie)).status, 201);
      const before = await snapshot(h), entered = deferred(), resume = deferred(); let once = true, restore = async () => {};
      h.runtime.foundation = { ...f, authorizeInTransaction: async (...args) => { if (once && args[1].action === 'cs.note.internal') { once = false; entered.resolve(); await resume.promise; } return f.authorizeInTransaction(...args); } };
      const pending = h.req(route, body, issued.cookie);
      try {
        await bounded(entered.promise); restore = await change(issued); resume.resolve(); const response = await pending;
        assert.equal(response.status, 403, JSON.stringify(response)); assert.deepEqual(await snapshot(h), before);
      } finally { resume.resolve(); await pending.catch(() => {}); h.runtime.foundation = f; await restore(); }
    }
  });

  await t.test('overlap after authority writes has an explicit mutation-first order, then replay is denied', async () => {
    const issued = await fresh(), body = { text: 'Synthetic mutation-first ordered note', commandKey: randomUUID() }, entered = deferred(), resume = deferred(); let once = true;
    h.runtime.foundation = { ...f, authorizeInTransaction: async (...args) => { const grant = await f.authorizeInTransaction(...args); if (once && args[1].action === 'cs.note.internal') { once = false; entered.resolve(); await resume.promise; } return grant; } };
    const pending = h.req(route, body, issued.cookie);
    try {
      await bounded(entered.promise);
      const revocation = f.revokeSession({ tenantId: member.tenantId, sessionId: issued.sessionId }).then(async () => { assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ ticketId: ticket.ticketId, text: body.text }), 1, 'Committed revoke observes the earlier mutation effect'); });
      resume.resolve(); const [response] = await Promise.all([pending, revocation]); assert.equal(response.status, 201);
      h.runtime.foundation = f; const before = await snapshot(h); assert.equal((await h.req(route, body, issued.cookie)).status, 401); assert.deepEqual(await snapshot(h), before);
    } finally { resume.resolve(); await pending.catch(() => {}); h.runtime.foundation = f; }
  });
});
