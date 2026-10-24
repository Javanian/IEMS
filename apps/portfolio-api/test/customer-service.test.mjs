import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

const ACCOUNT = 'synthetic-preview-account';
test('customer-service operator HTTP routes over the read-only package API', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`), marker = randomUUID();
  await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db, customerService: { allowSyntheticOrders: true } }), password = randomUUID(), seeded = await seedSynthetic(runtime, { password });
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  async function req(path, body, cookie, method = body ? 'POST' : 'GET') {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...await r.json() };
  }
  const login = async username => (await fetch(`http://127.0.0.1:${server.address().port}/api/session/login`, { method: 'POST', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).headers.get('set-cookie').split(';')[0];
  const alpha = await login('alpha.owner'), beta = await login('beta.owner');
  const cs = runtime.customerService, [a, b] = seeded;
  // Fixture provisioning is a trusted-harness step through the package API; HTTP never exposes cs.fixture.admin.
  const scopeOf = async (cookie, member) => {
    const row = await db.collection('memberships').findOne({ _id: member.membershipId });
    await db.collection('memberships').updateOne({ _id: row._id }, { $set: { roles: [...row.roles, { role: 'csFixtureAdmin', plantIds: row.plantIds, tenantWide: false }] } });
    return { scope: await runtime.foundation.authenticate(cookie.slice('portfolio_session='.length)), restore: () => db.collection('memberships').updateOne({ _id: row._id }, { $set: { roles: row.roles } }) };
  };
  const principals = {}, bindings = {};
  for (const [name, cookie, member] of [['a', alpha, a], ['b', beta, b]]) {
    const { scope, restore } = await scopeOf(cookie, member), customerId = randomUUID();
    bindings[name] = randomUUID();
    await cs.provisionFixtureCustomer(scope, { plantId: member.plantId, customerId, label: `Synthetic customer ${name}` });
    await cs.bindContact(scope, { plantId: member.plantId, bindingId: bindings[name], customerId, channelAccountId: ACCOUNT, providerContactId: `synthetic-contact-${name}` });
    await cs.registerSyntheticOrderSnapshot(scope, { plantId: member.plantId, customerId, orderNumber: 'SO-SYN-001', publicStage: 'PRODUCTION' });
    await restore();
    principals[name] = await cs.resolveCustomerPrincipal({ tenantId: member.tenantId, channelAccountId: ACCOUNT, providerContactId: `synthetic-contact-${name}` });
  }
  const complain = async (principal, category = 'DELIVERY_DELAY') => {
    let d = await cs.startComplaintDraft(principal, { requestKey: randomUUID() });
    for (const action of [{ type: 'SELECT_ORDER', orderNumber: 'SO-SYN-001' }, { type: 'SELECT_CATEGORY', category }, { type: 'DESCRIBE', text: 'Synthetic delay report' }]) d = await cs.updateComplaintDraft(principal, { draftId: d.draftId, expectedVersion: d.version, action });
    return cs.confirmComplaint(principal, { draftId: d.draftId, expectedVersion: d.version, inboundKey: randomUUID() });
  };
  const ticketA = await complain(principals.a), ticketB = await complain(principals.b);
  const count = (name, filter = {}) => db.collection(name).countDocuments(filter);
  const snapshot = () => Promise.all(['cs_tickets', 'cs_ticket_events', 'cs_internal_notes', 'cs_conversations', 'cs_outbox', 'cs_idempotency', 'cs_audit'].map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));

  await t.test('cookie session scopes ticket list/detail to tenant and plant; dispatcher and customer ports are not routed', async () => {
    assert.equal((await req('/cs/tickets')).status, 401);
    const list = await req('/cs/tickets', undefined, alpha);
    assert.equal(list.status, 200); assert.deepEqual(list.data.map(v => v.ticketId), [ticketA.ticketId]);
    assert.equal(list.data[0].orderSource, 'SYNTHETIC_FIXTURE_SNAPSHOT');
    assert.deepEqual((await req('/cs/tickets?stage=CLOSED', undefined, alpha)).data, []);
    assert.equal((await req('/cs/tickets?stage=BOGUS', undefined, alpha)).status, 400);
    assert.equal((await req('/cs/tickets?limit=1e2', undefined, alpha)).status, 400);
    assert.equal((await req('/cs/tickets?limit=500', undefined, alpha)).status, 400);
    assert.equal((await req(`/cs/tickets?tenant_id=${b.tenantId}`, undefined, alpha)).status, 403);
    assert.equal((await req(`/cs/tickets/${ticketA.ticketId}`, undefined, beta)).status, 404);
    assert.equal((await req(`/cs/tickets/${ticketB.ticketId}`, undefined, alpha)).status, 404);
    const detail = await req(`/cs/tickets/${ticketA.ticketId}`, undefined, alpha);
    assert.equal(detail.status, 200); assert.equal(detail.data.ticketNumber, ticketA.ticketNumber); assert.equal(detail.data.history[0].kind, 'CREATED');
    for (const path of ['/cs/deliveries/claim', '/cs/dispatch/claim', '/cs/deliveries/record', '/cs/reconcile', '/cs/complaints', '/cs/fixtures/customers']) assert.equal((await req(path, { tenantId: a.tenantId, channelAccountId: ACCOUNT, leaseOwner: 'browser' }, alpha)).status, 404, path);
    assert.equal(await count('cs_outbox', { state: 'SENDING' }), 0);
  });

  await t.test('stage transition and internal notes are versioned, idempotent and kept out of customer history', async () => {
    const path = `/cs/tickets/${ticketA.ticketId}`, commandKey = `stage-${randomUUID()}`;
    assert.equal((await req(`${path}/stage`, { expectedVersion: 1, toStage: 'TRIAGED', reason: 'Synthetic triage', commandKey }, beta)).status, 404);
    assert.equal((await req(`${path}/stage`, { expectedVersion: 1, toStage: 'CLOSED', reason: 'Skip', commandKey: `x-${randomUUID()}` }, alpha)).error.code, 'INVALID_TRANSITION');
    assert.equal((await req(`${path}/stage`, { expectedVersion: 1, toStage: 'TRIAGED', reason: 'X', commandKey: 'k', extra: 1 }, alpha)).status, 400);
    const results = await Promise.all([1, 2].map(() => req(`${path}/stage`, { expectedVersion: 1, toStage: 'TRIAGED', reason: 'Synthetic triage', commandKey }, alpha)));
    assert.deepEqual(results.map(r => r.status), [200, 200]); assert.deepEqual(results[0].data, { ticketId: ticketA.ticketId, stage: 'TRIAGED', version: 2 }); assert.deepEqual(results[1].data, results[0].data);
    assert.equal((await req(`${path}/stage`, { expectedVersion: 1, toStage: 'ASSIGNED', reason: 'Synthetic triage', assigneeId: a.userId, commandKey }, alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await req(`${path}/stage`, { expectedVersion: 1, toStage: 'ASSIGNED', reason: 'Stale', assigneeId: a.userId, commandKey: `s-${randomUUID()}` }, alpha)).error.code, 'VERSION_CONFLICT');
    const assigned = await req(`${path}/stage`, { expectedVersion: 2, toStage: 'ASSIGNED', reason: 'Owner takes it', assigneeId: a.userId, commandKey: `s-${randomUUID()}` }, alpha);
    assert.equal(assigned.status, 200, JSON.stringify(assigned)); assert.equal((await req(`/cs/tickets?assignee=${a.userId}`, undefined, alpha)).data.length, 1);
    assert.equal(await count('cs_ticket_events', { ticketId: ticketA.ticketId, kind: 'STAGE_CHANGED' }), 2);
    const note = await req(`${path}/internal-notes`, { text: 'Synthetic internal-only remark', commandKey: `n-${randomUUID()}` }, alpha);
    assert.equal(note.status, 201, JSON.stringify(note));
    assert.equal((await req(`${path}/internal-notes`, { text: ' ', commandKey: `n-${randomUUID()}` }, alpha)).status, 400);
    assert.deepEqual((await req(`${path}/internal-notes`, undefined, alpha)).data.map(n => [n.noteId, n.authorUserId, n.text]), [[note.data.noteId, a.userId, 'Synthetic internal-only remark']]);
    assert.equal((await req(`${path}/internal-notes`, undefined, beta)).data.length, 0);
    const customer = await cs.getTicketForCustomer(principals.a, { ticketNumber: ticketA.ticketNumber });
    assert.ok(!JSON.stringify(customer).includes('internal-only'));
    assert.equal(await count('cs_ticket_events', { text: 'Synthetic internal-only remark' }), 0);
  });

  await t.test('handoff takeover/mode and UNKNOWN delivery review route through operator grants only', async () => {
    const handoff = await cs.requestHandoff(principals.a, { inboundKey: randomUUID() });
    assert.equal(handoff.mode, 'HUMAN_PENDING');
    // The trusted dispatcher is simulated in-process only: lease the ticket ack, then report an uncertain submit.
    const queued = await db.collection('cs_outbox').findOne({ ticketId: ticketA.ticketId, kind: 'TICKET_ACK' });
    const claimed = await cs.claimNextDelivery({ tenantId: a.tenantId, channelAccountId: ACCOUNT, leaseOwner: 'test-dispatcher' });
    assert.equal(claimed.deliveryId, queued._id);
    await cs.recordDeliveryResult({ tenantId: a.tenantId, deliveryId: claimed.deliveryId, fence: claimed.fence, outcome: 'SUBMIT_UNCERTAIN' });
    const found = await req(`/cs/conversations/by-binding/${bindings.a}`, undefined, alpha);
    assert.deepEqual(found.data, { conversationId: handoff.conversationId, mode: 'HUMAN_PENDING', version: handoff.version });
    assert.equal((await req(`/cs/conversations/by-binding/${bindings.a}`, undefined, beta)).status, 404);
    const path = `/cs/conversations/${handoff.conversationId}`;
    assert.equal((await req(`${path}/takeover`, { expectedVersion: handoff.version + 1, commandKey: `t-${randomUUID()}` }, alpha)).error.code, 'VERSION_CONFLICT');
    const take = await req(`${path}/takeover`, { expectedVersion: handoff.version, commandKey: `t-${randomUUID()}` }, alpha);
    assert.equal(take.status, 200, JSON.stringify(take)); assert.equal(take.data.mode, 'HUMAN_ACTIVE');
    assert.equal((await req(path, undefined, alpha)).data.assigneeId, a.userId); assert.deepEqual(take.data.inFlightDeliveryIds, [claimed.deliveryId]);
    assert.equal((await req(`${path}/mode`, { expectedVersion: take.data.version, toMode: 'HUMAN_ACTIVE', reason: 'x', commandKey: `m-${randomUUID()}` }, alpha)).status, 400);
    const paused = await req(`${path}/mode`, { expectedVersion: take.data.version, toMode: 'PAUSED', reason: 'Synthetic pause', commandKey: `m-${randomUUID()}` }, alpha);
    assert.equal(paused.data.mode, 'PAUSED');
    const conversation = await req(path, undefined, alpha);
    assert.deepEqual(conversation.data.deliveries.find(d => d.deliveryId === claimed.deliveryId).state, 'UNKNOWN');
    const resolvePath = `/cs/deliveries/${claimed.deliveryId}/resolve`, body = { resolution: 'ABANDON', evidence: 'Synthetic provider log shows nothing', commandKey: `r-${randomUUID()}` };
    assert.equal((await req(resolvePath, body, beta)).status, 404);
    const member = await db.collection('memberships').findOne({ _id: a.membershipId });
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'csAgent', plantIds: member.plantIds, tenantWide: false }] } });
    const before = await snapshot();
    try {
      assert.equal((await req(resolvePath, body, alpha)).status, 403);
      assert.equal((await req('/cs/tickets', undefined, alpha)).status, 200);
      await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'csViewer', plantIds: member.plantIds, tenantWide: false }] } });
      assert.equal((await req(`/cs/tickets/${ticketA.ticketId}/stage`, { expectedVersion: 3, toStage: 'IN_PROGRESS', reason: 'x', commandKey: `v-${randomUUID()}` }, alpha)).status, 403);
      assert.equal((await req(`/cs/tickets/${ticketA.ticketId}/internal-notes`, undefined, alpha)).status, 403);
      assert.equal((await req(`${path}/takeover`, { expectedVersion: paused.data.version, commandKey: `v-${randomUUID()}` }, alpha)).status, 403);
      assert.deepEqual(await snapshot(), before);
    } finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    const results = await Promise.all([1, 2].map(() => req(resolvePath, body, alpha)));
    assert.deepEqual(results.map(r => [r.status, r.data?.state]), [[200, 'CANCELLED'], [200, 'CANCELLED']]);
    assert.equal((await req(resolvePath, { ...body, commandKey: `r-${randomUUID()}` }, alpha)).error.code, 'INVALID_TRANSITION');
    assert.equal(await count('cs_audit', { action: 'delivery.reviewed' }), 1);
    assert.equal((await db.collection('cs_outbox').findOne({ _id: claimed.deliveryId })).review.userId, a.userId);
  });
});
