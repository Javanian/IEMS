import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { createCustomerService } from '../../../../packages/customer-service/index.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Queue integration gate did not complete')), 15000); })]); }
  finally { clearTimeout(timer); }
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('CS tenant entry scheduling preserves real Mongo authorization and effects', async t => {
  const h = await startOwned(t, { customerService: { allowSyntheticOrders: true } }), f = h.runtime.foundation, cs = h.runtime.customerService;
  const fixtures = [];
  for (const [i, member] of h.seeded.slice(0, 2).entries()) {
    await h.db.collection('memberships').updateOne({ _id: member.membershipId }, { $push: { roles: { role: 'csFixtureAdmin', plantIds: [member.plantId] } } });
    const cookie = i === 0 ? h.alpha : h.beta, scope = await h.scopeOf(cookie), customerId = randomUUID(), bindingId = randomUUID(), contact = 'SYNTHETIC-' + randomUUID();
    await cs.provisionFixtureCustomer(scope, { plantId: member.plantId, customerId, label: 'Synthetic queue regression' });
    await cs.bindContact(scope, { plantId: member.plantId, bindingId, customerId, channelAccountId: 'SIMULATED', providerContactId: contact });
    const principal = await cs.resolveCustomerPrincipal({ tenantId: member.tenantId, channelAccountId: 'SIMULATED', providerContactId: contact });
    let draft = await cs.startComplaintDraft(principal, { requestKey: randomUUID() });
    for (const action of [{ type: 'GENERAL_INQUIRY' }, { type: 'SELECT_CATEGORY', category: 'OTHER' }, { type: 'DESCRIBE', text: 'Synthetic real queue regression ticket' }]) draft = await cs.updateComplaintDraft(principal, { draftId: draft.draftId, expectedVersion: draft.version, action });
    const ticket = await cs.confirmComplaint(principal, { draftId: draft.draftId, expectedVersion: draft.version, inboundKey: randomUUID() });
    fixtures.push({ ...member, cookie, scope, ticketId: ticket.ticketId, route: `/cs/tickets/${ticket.ticketId}/internal-notes` });
  }
  const [alpha, beta] = fixtures;
  assert.notEqual(alpha.tenantId, beta.tenantId);

  await t.test('same tenant waits before creating a session while a different tenant progresses', async () => {
    const entered = deferred(), release = deferred(), queuedAuthorized = deferred(); let hold = true, authorizations = 0, sessions = 0;
    const originalStart = h.client.startSession;
    h.client.startSession = function(...args) { if (args[0]?.explicit !== false) sessions++; return originalStart.apply(this, args); };
    h.runtime.foundation = { ...f,
      authorize: async (...args) => { const grant = await f.authorize(...args); if (!hold && grant.tenantId === alpha.tenantId && args[1].action === 'cs.note.internal' && ++authorizations === 1) queuedAuthorized.resolve(); return grant; },
      authorizeInTransaction: async (...args) => { if (hold && args[0].tenantId === alpha.tenantId && args[1].action === 'cs.note.internal') { hold = false; entered.resolve(); await release.promise; } return f.authorizeInTransaction(...args); },
    };
    const firstBody = { text: 'Synthetic active queue note', commandKey: randomUUID() }, secondBody = { text: 'Synthetic queued note', commandKey: randomUUID() };
    let first, second;
    try {
      first = h.req(alpha.route, firstBody, alpha.cookie); await bounded(entered.promise);
      const activeSessions = sessions; assert.equal(activeSessions, 1);
      second = h.req(alpha.route, secondBody, alpha.cookie); await bounded(queuedAuthorized.promise); await nextTurn();
      assert.equal(sessions, activeSessions, 'Waiting request must not start a Mongo session');
      const other = await bounded(h.req(beta.route, { text: 'Synthetic independent tenant note', commandKey: randomUUID() }, beta.cookie)); assert.equal(other.status, 201);
      assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ tenantId: alpha.tenantId, text: { $in: [firstBody.text, secondBody.text] } }), 0);
      release.resolve(); assert.equal((await bounded(first)).status, 201); assert.equal((await bounded(second)).status, 201);
      assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ tenantId: alpha.tenantId, text: { $in: [firstBody.text, secondBody.text] } }), 2);
    } finally { release.resolve(); await Promise.allSettled([first, second].filter(Boolean)); h.runtime.foundation = f; h.client.startSession = originalStart; }
  });

  for (const replay of [false, true]) await t.test(`revocation committed during queue wait denies ${replay ? 'acknowledged replay' : 'fresh mutation'}`, async () => {
    const userId = randomUUID(), membershipId = randomUUID(), plant = await h.db.collection('plants').findOne({ _id: alpha.plantId });
    await f.provisionUser({ id: userId, tenantId: alpha.tenantId });
    await f.provisionMembership({ id: membershipId, tenantId: alpha.tenantId, userId, plantIds: [alpha.plantId], legalEntityIds: [plant.legalEntityId], roles: [{ role: 'owner', plantIds: [alpha.plantId] }] });
    const issued = await f.issueSession({ userId, tenantId: alpha.tenantId, selectedPlantId: alpha.plantId, ttlMs: 3600000 }), cookie = `portfolio_session=${issued.token}`;
    const body = { text: 'Synthetic revoked queued note ' + randomUUID(), commandKey: randomUUID() };
    if (replay) assert.equal((await h.req(alpha.route, body, cookie)).status, 201);
    const before = await h.db.collection('cs_internal_notes').countDocuments({ text: body.text }), beforeKeys = await h.db.collection('cs_idempotency').countDocuments({ key: body.commandKey });
    const auditFilter = { tenantId: alpha.tenantId, action: 'ticket.internal_note', 'actor.userId': userId }, beforeAudit = await h.db.collection('cs_audit').countDocuments(auditFilter);
    assert.equal(before, Number(replay)); assert.equal(beforeKeys, Number(replay));
    const entered = deferred(), release = deferred(), queuedAuthorized = deferred(); let hold = true, authorizations = 0, first, queued;
    h.runtime.foundation = { ...f,
      authorize: async (...args) => { const grant = await f.authorize(...args); if (grant.userId === userId && args[1].action === 'cs.note.internal' && ++authorizations === 1) queuedAuthorized.resolve(); return grant; },
      authorizeInTransaction: async (...args) => { if (hold && args[0].userId === alpha.userId && args[1].action === 'cs.note.internal') { hold = false; entered.resolve(); await release.promise; } return f.authorizeInTransaction(...args); },
    };
    try {
      first = h.req(alpha.route, { text: 'Synthetic active separate actor ' + randomUUID(), commandKey: randomUUID() }, alpha.cookie); await bounded(entered.promise);
      queued = h.req(alpha.route, body, cookie); await bounded(queuedAuthorized.promise); await nextTurn();
      await f.revokeSession({ tenantId: alpha.tenantId, sessionId: issued.sessionId });
      release.resolve(); assert.equal((await bounded(first)).status, 201); assert.equal((await bounded(queued)).status, 403);
      assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ text: body.text }), before);
      assert.equal(await h.db.collection('cs_idempotency').countDocuments({ key: body.commandKey }), beforeKeys);
      assert.equal(await h.db.collection('cs_audit').countDocuments(auditFilter), beforeAudit);
    } finally { release.resolve(); await Promise.allSettled([first, queued].filter(Boolean)); h.runtime.foundation = f; }
  });

  await t.test('nested operator transaction shares the session, rolls back, and releases the queue', async () => {
    const customerId = randomUUID(); let outerSession, nestedSession, once = true;
    h.runtime.foundation = { ...f, authorizeInTransaction: async (...args) => {
      const grant = await f.authorizeInTransaction(...args);
      if (once && args[1].action === 'cs.note.internal') { once = false; outerSession = args[2].session; await cs.provisionFixtureCustomer(args[0], { plantId: alpha.plantId, customerId, label: 'Synthetic nested rollback' }); }
      else if (args[1].action === 'cs.fixture.admin') nestedSession = args[2].session;
      return grant;
    } };
    try {
      await assert.rejects(bounded(cs.addInternalNote(alpha.scope, { plantId: alpha.plantId, ticketId: randomUUID(), text: 'Synthetic missing ticket', commandKey: randomUUID() })), { code: 'NOT_FOUND' });
      assert.ok(outerSession); assert.equal(nestedSession, outerSession);
      assert.equal(await h.db.collection('cs_customers').countDocuments({ _id: customerId }), 0);
      h.runtime.foundation = f;
      assert.equal((await bounded(h.req(alpha.route, { text: 'Synthetic queue recovered after rollback', commandKey: randomUUID() }, alpha.cookie))).status, 201);
    } finally { h.runtime.foundation = f; }
  });

  await t.test('two service instances retain original database conflict and replay protection', async () => {
    const entered = deferred(), release = deferred(); let hold = true, conflicts = 0, first, second;
    h.runtime.foundation = { ...f, authorizeInTransaction: async (...args) => {
      const grant = await f.authorizeInTransaction(...args);
      if (hold && args[1].action === 'cs.note.internal') { hold = false; entered.resolve(); await release.promise; }
      return grant;
    } };
    const otherFoundation = { ...f, authorizeInTransaction: async (...args) => {
      try { return await f.authorizeInTransaction(...args); }
      catch (error) {
        if (error.hasErrorLabel?.('TransientTransactionError')) { conflicts++; release.resolve(); }
        throw error;
      }
    } };
    const other = createCustomerService({ client: h.client, db: h.db, foundation: otherFoundation, saasAdmission: h.runtime.saasAdmission, separateEffects: h.runtime.separateEffects });
    const input = { plantId: alpha.plantId, ticketId: alpha.ticketId, text: 'Synthetic two-instance same key', commandKey: randomUUID() };
    const auditFilter = { tenantId: alpha.tenantId, action: 'ticket.internal_note', subjectId: alpha.ticketId }, beforeAudit = await h.db.collection('cs_audit').countDocuments(auditFilter);
    try {
      first = cs.addInternalNote(alpha.scope, input); await bounded(entered.promise);
      second = other.addInternalNote(alpha.scope, input);
      const [one, two] = await bounded(Promise.all([first, second]));
      assert.ok(conflicts > 0, 'The independent instance must encounter a real transaction conflict');
      assert.deepEqual(two, one);
      assert.equal(await h.db.collection('cs_internal_notes').countDocuments({ text: input.text, tenantId: alpha.tenantId }), 1);
      assert.equal(await h.db.collection('cs_idempotency').countDocuments({ key: input.commandKey, tenantId: alpha.tenantId }), 1);
      assert.equal(await h.db.collection('cs_audit').countDocuments(auditFilter), beforeAudit + 1);
    } finally { release.resolve(); await Promise.allSettled([first, second].filter(Boolean)); h.runtime.foundation = f; }
  });
});
