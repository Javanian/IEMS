import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createTenantFoundation } from '../../../packages/tenant-foundation/index.mjs';
import { createCustomerService, SIMULATED_CHANNEL_ACCOUNT } from '@iems/customer-service';
import { createBridge } from '../src/bridge.mjs';
import { operatorRoleActions } from '../src/foundation-operator.mjs';

const run = randomUUID().replaceAll('-', '').slice(0, 12);
const BRIDGE_DB = `iems_wa_bridge_owned_cs_${run}`, IDENTITY_DB = `iems_wa_bridge_owned_csid_${run}`;
const ACCOUNT = SIMULATED_CHANNEL_ACCOUNT;
const secret = 'owned-cs-service-secret-0123456789012345';
const approvalKey = 'owned-cs-approval-key-01234567890123456';
const contacts = ['contact-a', 'contact-b', 'contact-c', 'contact-d', 'contact-e', 'contact-f', 'contact-g'];
const roleActions = { ...operatorRoleActions, csAdmin: ['cs.fixture.admin', 'cs.ticket.read', 'cs.conversation.handoff', 'cs.delivery.review', 'cs.reply', 'cs.ticket.write'] };
const ids = Object.fromEntries(['t1', 't2', 'e1', 'e2', 'p1', 'p2'].map(x => [x, randomUUID()]));
const clock = { offset: 0 };
const nowMs = () => Date.now() + clock.offset;
let replica, client, db, identityDb, foundation, adminCs, bridgeCs, bridge, base, scopes = {};
const bindings = {};

const allowAll = { async authenticate() { return { id: 'synthetic-admin' }; }, async authorize() { return true; } };
async function request(path, body, auth = secret) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const meta = (recipient, eventId) => ({ tenant: ids.t1, account: ACCOUNT, recipient, kind: 'direct', eventId });
let eventSeq = 0;
const say = (recipient, text, eventId = `ev-${++eventSeq}`) => bridge.inbound(meta(recipient, eventId), () => text);
const outbox = filter => identityDb.collection('cs_outbox').find(filter).sort({ seq: 1 }).toArray();
async function activate(recipient) {
  await db.collection('policy').updateOne({ tenant: ids.t1, account: ACCOUNT }, { $set: { paused: false } });
  if (!await db.collection('preview_bindings').findOne({ recipient })) assert.equal((await request('/bindings', { recipient, customer: `customer-${recipient}`, synthetic: true, expectedVersion: 0 })).status, 200);
  assert.equal((await request('/session', { recipient, code: 'owned-code-123', expiresAt: nowMs() + 3600000 })).status, 200);
  assert.equal((await say(recipient, 'IEMS DEMO owned-code-123')).activated, true);
}
async function fixture(scope, plantId, contact, orderNumber) {
  const customerId = randomUUID(), bindingId = randomUUID();
  await adminCs.provisionFixtureCustomer(scope, { plantId, customerId, label: `Synthetic ${contact}` });
  await adminCs.bindContact(scope, { plantId, bindingId, customerId, channelAccountId: ACCOUNT, providerContactId: contact });
  if (orderNumber) await adminCs.registerSyntheticOrderSnapshot(scope, { plantId, customerId, orderNumber, publicStage: 'QUALITY_INSPECTION', progress: { released: 6, total: 10 } });
  return { customerId, bindingId };
}
async function drainPreviews() {
  const out = [];
  for (let r = await request('/cs/dispatch', {}); r.status === 200 && r.body.delivery; r = await request('/cs/dispatch', {})) out.push(r.body.delivery);
  return out;
}

test.before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, replSet: { count: 1, storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  client = await new MongoClient(replica.getUri()).connect();
  db = client.db(BRIDGE_DB); identityDb = client.db(IDENTITY_DB);
  assert.match(db.databaseName, /^iems_wa_bridge_owned_/); assert.match(identityDb.databaseName, /^iems_wa_bridge_owned_/);
  foundation = createTenantFoundation({ client, db: identityDb, roleActions });
  await foundation.initialize();
  for (const [t, e, p] of [[ids.t1, ids.e1, ids.p1], [ids.t2, ids.e2, ids.p2]]) {
    await foundation.provisionTenant({ id: t }); await foundation.provisionLegalEntity({ id: e, tenantId: t }); await foundation.provisionPlant({ id: p, tenantId: t, legalEntityId: e });
    const userId = randomUUID();
    await foundation.provisionUser({ id: userId, tenantId: t });
    await foundation.provisionMembership({ id: randomUUID(), tenantId: t, userId, legalEntityIds: [e], plantIds: [p], roles: [{ role: 'csAdmin', plantIds: [p] }] });
    scopes[t] = await foundation.authenticate((await foundation.issueSession({ userId, tenantId: t, selectedPlantId: p, ttlMs: 3600000 })).token);
  }
  const csNow = () => new Date(nowMs());
  adminCs = createCustomerService({ client, db: identityDb, foundation, now: csNow, allowSyntheticOrders:true });
  await adminCs.initialize();
  bridgeCs = createCustomerService({ client, db: identityDb, foundation, now: csNow, maxSendAttempts: 1, allowSyntheticOrders:true, previewDispatcher:true });
  for (const c of contacts) bindings[c] = await fixture(scopes[ids.t1], ids.p1, c, 'SO-DEMO-001');
  // Same contact and account in another tenant: the bridge must never resolve or dispatch it.
  bindings.foreign = await fixture(scopes[ids.t2], ids.p2, 'contact-a', 'SO-DEMO-001');
  bridge = await createBridge({ db, tenant: ids.t1, account: ACCOUNT, serviceSecret: secret, approvalKey, participants: contacts, receiveEnabled: true, scopeAdapter: allowAll, customerService: bridgeCs, now: nowMs });
  await new Promise(r => bridge.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${bridge.server.address().port}`;
});
test.after(async () => {
  if (bridge) await new Promise(r => bridge.server.close(r));
  await db?.dropDatabase(); await identityDb?.dropDatabase();
  await client?.close(); await new Promise(r => setTimeout(r, 300)); await replica?.stop({ doCleanup: true, force: true });
});

test('complaint draft to confirm creates one ticket and its ack is PREVIEWED, never SENT', async () => {
  await activate('contact-a');
  const start = await say('contact-a', 'IEMS COMPLAINT');
  assert.equal(start.cs.draft.stage, 'ORDER_SELECTION');
  assert.equal((await say('contact-a', 'IEMS COMPLAINT ORDER SO-DEMO-404')).cs.error, 'NOT_FOUND');
  assert.equal((await say('contact-a', 'IEMS COMPLAINT ORDER SO-DEMO-001')).cs.draft.stage, 'CATEGORY');
  assert.equal((await say('contact-a', 'IEMS COMPLAINT BACK')).cs.draft.stage, 'ORDER_SELECTION');
  await say('contact-a', 'IEMS COMPLAINT ORDER SO-DEMO-001');
  assert.equal((await say('contact-a', 'IEMS COMPLAINT CATEGORY DELIVERY_DELAY')).cs.draft.stage, 'DESCRIPTION');
  const preview = await say('contact-a', 'IEMS COMPLAINT DESCRIBE Shipment is two days late.');
  assert.deepEqual([preview.cs.draft.stage, preview.cs.draft.description], ['PREVIEW', 'Shipment is two days late.']);
  const confirmed = await say('contact-a', 'IEMS COMPLAINT CONFIRM', 'confirm-a');
  assert.match(confirmed.cs.ticket.ticketNumber, /^CS-\d{6}$/);
  const replay = await say('contact-a', 'IEMS COMPLAINT CONFIRM', 'confirm-a');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.cs.ticket.ticketNumber, confirmed.cs.ticket.ticketNumber);
  assert.equal(await identityDb.collection('cs_tickets').countDocuments({ tenantId: ids.t1, bindingId: bindings['contact-a'].bindingId }), 1);
  assert.equal((await say('contact-a', 'IEMS COMPLAINT CONFIRM')).cs.error, 'NO_ACTIVE_DRAFT');

  const previews = await drainPreviews();
  assert.ok(previews.length>=8); assert.ok(previews.every(p=>p.state==='PREVIEWED' && p.mode==='PREVIEW_ONLY' && p.providerMessageId===null && typeof p.text==='string'));
  assert.match(previews.find(p=>p.kind==='TICKET_ACK').text, new RegExp(confirmed.cs.ticket.ticketNumber));
  const [ack] = await outbox({ tenantId: ids.t1, kind: 'TICKET_ACK', bindingId: bindings['contact-a'].bindingId });
  assert.deepEqual([ack.state, ack.lastError, ack.providerMessageId], ['PREVIEWED', null, null]);
  assert.equal(await identityDb.collection('cs_outbox').countDocuments({ state: 'SENT' }), 0);
  assert.equal(await db.collection('cs_previews').countDocuments({ deliveryId: ack._id, state: 'PREVIEWED' }), 1);
  assert.equal((await request('/cs/dispatch', {})).body.delivery, null);
});

test('dispatcher tenant and channel come from authenticated bridge context, never caller input', async () => {
  for (const body of [{ tenantId: ids.t2 }, { tenant: ids.t2 }, { channelAccountId: 'other' }, { account: 'other' }, { leaseOwner: 'x' }, { simulation: 'live' }]) {
    assert.equal((await request('/cs/dispatch', body)).status, 403, JSON.stringify(Object.keys(body)));
  }
  for (const header of ['x-tenant-id', 'x-plant-id', 'x-channel-account', 'x-account']) {
    const h = await fetch(`${base}/cs/dispatch`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, [header]: ids.t1 }, body: '{}' });
    assert.equal(h.status, 403, header);
  }
  for (const query of [`?tenantId=${ids.t2}`, '?channelAccountId=other']) assert.equal((await fetch(`${base}/cs/dispatch${query}`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{}' })).status, 404);
  assert.equal((await request('/cs/dispatch', {}, 'wrong-secret-wrong-secret-wrong-secret')).status, 401);
  const r = await fetch(`${base}/cs/dispatch`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
  // Foreign-tenant fixture with the same contact and account stays untouched.
  const foreignPrincipal = await adminCs.resolveCustomerPrincipal({ tenantId: ids.t2, channelAccountId: ACCOUNT, providerContactId: 'contact-a' });
  await adminCs.enqueueBotReply(foreignPrincipal, { inboundKey: 'foreign-1', template: 'menu' });
  // Inbound metadata naming another tenant is ignored before any customer-service call.
  let reads = 0;
  assert.equal((await bridge.inbound({ ...meta('contact-a', 'foreign-meta'), tenant: ids.t2 }, () => { reads++; return 'IEMS COMPLAINT'; })).ignored, true);
  assert.equal(reads, 0);
  assert.deepEqual(await drainPreviews(), []);
  assert.equal((await outbox({ tenantId: ids.t2 }))[0].state, 'QUEUED');
  assert.equal(await identityDb.collection('cs_complaint_drafts').countDocuments({ tenantId: ids.t2 }), 0);
});

test('human handoff cancels queued bot replies and suppresses later bot output', async () => {
  await activate('contact-b');
  const status = await say('contact-b', 'IEMS ORDER SO-DEMO-001');
  assert.equal(status.cs.reply.state, 'QUEUED');
  const handoff = await say('contact-b', 'IEMS HUMAN');
  assert.equal(handoff.cs.mode, 'HUMAN_PENDING');
  assert.deepEqual(handoff.cs.cancelledDeliveryIds, [status.cs.reply.deliveryId]);
  const suppressed = await say('contact-b', 'IEMS ORDER SO-DEMO-001');
  assert.deepEqual([suppressed.cs.reply.state, suppressed.cs.reply.deliveryId], ['SUPPRESSED', null]);
  assert.equal((await say('contact-b', 'IEMS MENU')).cs.reply.state, 'SUPPRESSED');
  const rows = await outbox({ tenantId: ids.t1, bindingId: bindings['contact-b'].bindingId });
  assert.deepEqual(rows.map(r => [r.kind, r.state]), [['BOT_REPLY', 'CANCELLED'], ['HANDOFF_ACK', 'QUEUED']]);
  const previews = await drainPreviews();
  assert.deepEqual(previews.map(p => [p.kind, p.state]), [['HANDOFF_ACK', 'PREVIEWED']]);
  assert.equal(await db.collection('cs_previews').countDocuments({ kind: 'BOT_REPLY', recipient: 'contact-b' }), 0);
});

test('operator takeover and safety complaints suppress the bot; operator reply is only previewed', async () => {
  await activate('contact-f'); await activate('contact-g');
  const safety = [['IEMS COMPLAINT'], ['IEMS COMPLAINT GENERAL'], ['IEMS COMPLAINT CATEGORY SAFETY_OR_DAMAGE'], ['IEMS COMPLAINT DESCRIBE Damaged unit sparked.']];
  for (const [text] of safety) await say('contact-g', text);
  const ticket = await say('contact-g', 'IEMS COMPLAINT CONFIRM', 'confirm-g');
  assert.match(ticket.cs.ticket.ticketNumber, /^CS-/);
  const gConv = await adminCs.findConversationByBinding(scopes[ids.t1], { plantId: ids.p1, bindingId: bindings['contact-g'].bindingId });
  assert.equal(gConv.mode, 'HUMAN_PENDING');
  assert.equal((await say('contact-g', 'IEMS MENU')).cs.reply.state, 'SUPPRESSED');

  await say('contact-f', 'IEMS MENU');
  const conv = await adminCs.findConversationByBinding(scopes[ids.t1], { plantId: ids.p1, bindingId: bindings['contact-f'].bindingId });
  const taken = await adminCs.takeOverConversation(scopes[ids.t1], { plantId: ids.p1, conversationId: conv.conversationId, expectedVersion: conv.version, commandKey: `takeover-${run}` });
  assert.equal(taken.mode, 'HUMAN_ACTIVE'); assert.equal(taken.cancelledDeliveryIds.length, 1);
  assert.equal((await say('contact-f', 'IEMS ORDER SO-DEMO-001')).cs.reply.state, 'SUPPRESSED');
  await adminCs.operatorReply(scopes[ids.t1], { plantId: ids.p1, conversationId: conv.conversationId, text: 'We are checking your order.', commandKey: `reply-${run}` });
  const previews = (await drainPreviews()).filter(p => p.deliveryId);
  const reply = previews.find(p => p.kind === 'OPERATOR_REPLY');
  assert.deepEqual([reply.state, reply.providerMessageId, reply.text], ['PREVIEWED', null, 'We are checking your order.']);
  assert.equal(await identityDb.collection('cs_outbox').countDocuments({ state: 'SENT' }), 0);
  assert.equal(await db.collection('cs_previews').countDocuments({ recipient: 'contact-f', kind: 'BOT_REPLY' }), 0);
});

test('UNKNOWN deliveries are never resent and block their conversation FIFO', async () => {
  await activate('contact-c');
  const first = await say('contact-c', 'IEMS ORDER SO-DEMO-001');
  const ambiguous = await bridge.dispatchCustomerService('ambiguous');
  assert.deepEqual([ambiguous.deliveryId, ambiguous.state, ambiguous.providerMessageId], [first.cs.reply.deliveryId, 'UNKNOWN', null]);
  const second = await say('contact-c', 'IEMS MENU');
  assert.equal(second.cs.reply.state, 'QUEUED');
  for (let i = 0; i < 3; i++) assert.equal((await request('/cs/dispatch', {})).body.delivery, null);
  const rows = await outbox({ tenantId: ids.t1, bindingId: bindings['contact-c'].bindingId });
  assert.deepEqual(rows.map(r => [r.state, r.attempt]), [['UNKNOWN', 1], ['QUEUED', 0]]);
  assert.equal(await db.collection('cs_previews').countDocuments({ deliveryId: first.cs.reply.deliveryId }), 1);
  assert.equal((await db.collection('cs_previews').findOne({ deliveryId: first.cs.reply.deliveryId })).state, 'UNKNOWN');

  // Operator-evidenced requeue still cannot produce a second preview for the same delivery.
  const requeued = await adminCs.resolveUnknownDelivery(scopes[ids.t1], { plantId: ids.p1, deliveryId: first.cs.reply.deliveryId, resolution: 'CONFIRMED_NOT_SENT_REQUEUE', evidence: 'Synthetic review: no provider call was made.', commandKey: `requeue-${run}` });
  assert.equal(requeued.state, 'QUEUED');
  await drainPreviews();
  assert.equal(await db.collection('cs_previews').countDocuments({ deliveryId: first.cs.reply.deliveryId }), 1);
  assert.equal((await db.collection('cs_previews').findOne({ deliveryId: first.cs.reply.deliveryId })).state, 'UNKNOWN');

  // A dispatcher that crashed after claiming leaves SENDING; lease expiry becomes UNKNOWN, never a re-preview.
  await activate('contact-d');
  const crashed = await say('contact-d', 'IEMS MENU');
  const claim = await bridgeCs.claimNextDelivery({ tenantId: ids.t1, channelAccountId: ACCOUNT, leaseOwner: 'crashed-dispatcher', leaseMs: 1000 });
  assert.equal(claim.deliveryId, crashed.cs.reply.deliveryId);
  clock.offset += 5000;
  assert.equal((await request('/cs/dispatch', {})).body.delivery, null);
  assert.equal((await outbox({ _id: crashed.cs.reply.deliveryId }))[0].state, 'UNKNOWN');
  assert.equal(await db.collection('cs_previews').countDocuments({ deliveryId: crashed.cs.reply.deliveryId }), 0);
  for (const s of ['live', 'SENT']) await assert.rejects(bridge.dispatchCustomerService(s), /INVALID_SIMULATION/);
});

test('bridge pause and inactive session gate customer-service previews; live provider stays denied', async () => {
  await activate('contact-e');
  const queued = await say('contact-e', 'IEMS MENU');
  assert.equal((await request('/session/pause', {})).status, 200);
  assert.equal((await request('/cs/dispatch', {})).status, 403);
  assert.equal((await outbox({ _id: queued.cs.reply.deliveryId }))[0].state, 'QUEUED');
  assert.equal((await request('/session/resume', {})).status, 200);
  // Resume does not reactivate the session, so the claimed row is proven not sent and cancelled locally.
  const gated = (await request('/cs/dispatch', {})).body.delivery;
  assert.deepEqual([gated.deliveryId, gated.state, gated.reason], [queued.cs.reply.deliveryId, 'CANCELLED', 'BRIDGE_SESSION_INACTIVE']);
  assert.equal((await outbox({ _id: queued.cs.reply.deliveryId }))[0].state, 'FAILED');
  assert.equal((await request('/session/live', {})).status, 403);
  await assert.rejects(createBridge({ db, tenant: ids.t1, account: ACCOUNT, serviceSecret: secret, approvalKey, liveEnabled: true, customerService: bridgeCs }), /LIVE_POLICY_NOT_INTEGRATED/);
  await assert.rejects(createBridge({ db, tenant: 'not-a-uuid', account: ACCOUNT, serviceSecret: secret, approvalKey, customerService: bridgeCs }), /Invalid bridge configuration/);
  await assert.rejects(createBridge({ db, tenant: ids.t1, account: 'other-channel', serviceSecret: secret, approvalKey, customerService: bridgeCs }), /requires the SIMULATED channel account/);
});

test('without a customer-service port, IEMS commands keep the original preview-only behaviour', async () => {
  const plain = await createBridge({ db: client.db(`${BRIDGE_DB}_plain`), tenant: ids.t1, account: ACCOUNT, serviceSecret: secret, approvalKey, participants: contacts, receiveEnabled: true, scopeAdapter: allowAll });
  assert.equal(plain.dispatchCustomerService, undefined);
  await client.db(`${BRIDGE_DB}_plain`).dropDatabase();
});

test('CLI wires customer service only with the foundation adapter and owned markers', async () => {
  await db.collection('ownership').updateOne({ _id: 'wa-bridge' }, { $set: { synthetic: true } }, { upsert: true });
  await identityDb.collection('ownership').updateOne({ _id: 'wa-bridge-foundation' }, { $set: { synthetic: true } }, { upsert: true });
  const env = { ...process.env, WA_MONGO_URI: replica.getUri(), WA_DB_NAME: BRIDGE_DB, WA_FOUNDATION_DB_NAME: IDENTITY_DB, WA_TENANT: ids.t1, WA_PLANT_ID: ids.p1, WA_ACCOUNT: ACCOUNT, WA_SERVICE_SECRET: secret, WA_APPROVAL_KEY: approvalKey, WA_PORT: '0', WA_PARTICIPANTS: contacts.join(','), WA_RECEIVE_PREVIEW: 'true', WA_OPERATOR_ADAPTER: 'foundation', WA_CUSTOMER_SERVICE: 'enabled' };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['src/main.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', d => { stderr += d; });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const ready = JSON.parse(String(chunk));
    assert.equal(ready.customerService, 'enabled');
    assert.equal(ready.liveEnabled, false);
    assert.doesNotMatch(String(chunk) + stderr, new RegExp(secret));
    const r = await fetch(`http://127.0.0.1:${ready.port}/cs/dispatch`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{}' });
    assert.equal(r.status, 200);
  } finally { child.kill(); await once(child, 'exit'); }
  for (const overrides of [{ WA_OPERATOR_ADAPTER: 'none' }, { WA_CUSTOMER_SERVICE: 'maybe' }, { WA_LIVE_ENABLED: 'true' }]) {
    const refused = spawn(process.execPath, ['src/main.mjs'], { env: { ...env, ...overrides }, stdio: 'ignore' });
    assert.notEqual((await once(refused, 'exit'))[0], 0, JSON.stringify(overrides));
  }
});

test('v2 full customer exchange consumes outbound preview records through resolution', async () => {
  await drainPreviews();
  const exchange = [];
  async function send(text) { await say('contact-e', text); const rows = await drainPreviews(); exchange.push(...rows); return rows; }
  await activate('contact-e');
  assert.match((await send('IEMS COMPLAINT'))[0].text, /order/i);
  assert.match((await send('IEMS COMPLAINT GENERAL'))[0].text, /category/i);
  assert.match((await send('IEMS COMPLAINT CATEGORY OTHER'))[0].text, /describe/i);
  assert.match((await send('IEMS COMPLAINT DESCRIBE Please investigate.'))[0].text, /CONFIRM/);
  const ack = (await send('IEMS COMPLAINT CONFIRM')).find(r => r.kind === 'TICKET_ACK');
  const number = ack.text.match(/CS-\d{6}/)[0];
  assert.match((await send(`IEMS TICKET ${number}`))[0].text, new RegExp(`${number}: NEW`));
  assert.equal((await send('IEMS HUMAN'))[0].kind, 'HANDOFF_ACK');
  const conv = await adminCs.findConversationByBinding(scopes[ids.t1], { plantId: ids.p1, bindingId: bindings['contact-e'].bindingId });
  await adminCs.takeOverConversation(scopes[ids.t1], { plantId: ids.p1, conversationId: conv.conversationId, expectedVersion: conv.version, commandKey: `v2-take-${run}` });
  await adminCs.operatorReply(scopes[ids.t1], { plantId: ids.p1, conversationId: conv.conversationId, text: 'Investigation complete.', commandKey: `v2-reply-${run}` });
  exchange.push(...await drainPreviews());
  const ticket = await identityDb.collection('cs_tickets').findOne({ ticketNumber: number, tenantId: ids.t1 });
  let version = ticket.version;
  for (const toStage of ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED']) {
    version = (await adminCs.transitionTicket(scopes[ids.t1], { plantId: ids.p1, ticketId: ticket._id, expectedVersion: version, toStage, reason: 'Owned exchange', ...(toStage === 'ASSIGNED' ? { assigneeId: conv.conversationId } : {}), commandKey: `v2-${toStage}-${run}` })).version;
  }
  exchange.push(...await drainPreviews());
  assert.deepEqual(exchange.map(r => r.kind), ['BOT_REPLY', 'BOT_REPLY', 'BOT_REPLY', 'BOT_REPLY', 'TICKET_ACK', 'BOT_REPLY', 'HANDOFF_ACK', 'OPERATOR_REPLY', 'TICKET_RESOLVED']);
  assert.ok(exchange.every(r => r.state === 'PREVIEWED' && r.providerMessageId === null));
  assert.match(exchange.at(-2).text, /Investigation complete/);
  assert.match(exchange.at(-1).text, new RegExp(`${number}: resolved`));
  const thread = await bridgeCs.getConversationThread(scopes[ids.t1], { plantId: ids.p1, conversationId: conv.conversationId, limit: 100 });
  assert.ok(thread.items.some(m => m.direction === 'INBOUND' && m.text === 'IEMS COMPLAINT DESCRIBE Please investigate.'));
  assert.equal(await identityDb.collection('cs_outbox').countDocuments({ state: 'SENT' }), 0);
});

test('R13-04 bridge crash at domain/pointer/result/afterCommit: restart replay returns original receipt without duplicates', async () => {
  const contact = 'contact-a';
  await drainPreviews();
  await activate(contact);
  const restart = async faultInjector => {
    const cs = createCustomerService({ client, db: identityDb, foundation, now: () => new Date(nowMs()), maxSendAttempts: 1, allowSyntheticOrders: true, previewDispatcher: true, ...(faultInjector ? { faultInjector } : {}) });
    return createBridge({ db, tenant: ids.t1, account: ACCOUNT, serviceSecret: secret, approvalKey, participants: contacts, receiveEnabled: true, scopeAdapter: allowAll, customerService: cs, now: nowMs });
  };
  const evidence = [];
  for (const boundary of ['domain', 'pointer', 'result', 'afterCommit']) {
    const steps = [['start', 'IEMS COMPLAINT'], ['general', 'IEMS COMPLAINT GENERAL'], ['category', 'IEMS COMPLAINT CATEGORY QUALITY'], ['describe', 'IEMS COMPLAINT DESCRIBE Crash-test complaint.'], ['confirm', 'IEMS COMPLAINT CONFIRM']];
    let receipt;
    for (const [name, text] of steps) {
      const eventId = `crash-${boundary}-${name}-${run}`;
      let armed = true;
      const crashing = await restart(b => { if (armed && b === boundary) { armed = false; throw new Error(`CRASH_${b}`); } });
      await assert.rejects(crashing.inbound(meta(contact, eventId), () => text), /CRASH_/);
      const healthy = await restart();
      const first = await healthy.inbound(meta(contact, eventId), () => text);
      assert.equal(first.duplicate, true, `${boundary}/${name} inbox already committed before the crash`);
      const again = await (await restart()).inbound(meta(contact, eventId), () => text);
      assert.deepEqual(again.cs, first.cs, `${boundary}/${name} replay returns stored result`);
      assert.equal(first.cs.error, undefined, `${boundary}/${name}`);
      if (name === 'confirm') receipt = first.cs.receipt;
      else assert.equal(first.cs.draft.stage, { start: 'ORDER_SELECTION', general: 'CATEGORY', category: 'DESCRIPTION', describe: 'PREVIEW' }[name], `${boundary}/${name} no double step advance`);
    }
    const ticketRows = await identityDb.collection('cs_tickets').find({ tenantId: ids.t1, bindingId: bindings[contact].bindingId, description: 'Crash-test complaint.' }).toArray();
    const ticket = ticketRows.find(t => t._id === receipt.ticketId);
    assert.ok(ticket);
    const draft = await identityDb.collection('cs_complaint_drafts').findOne({ _id: ticket.draftId });
    assert.equal(draft.version, 5, `${boundary}: draft advanced exactly once per step`);
    assert.equal(await identityDb.collection('cs_outbox').countDocuments({ actionKey: `ticket-ack:${ticket._id}` }), 1);
    const previews = await drainPreviews();
    assert.deepEqual(previews.map(p => p.kind), ['BOT_REPLY', 'BOT_REPLY', 'BOT_REPLY', 'BOT_REPLY', 'TICKET_ACK'], boundary);
    assert.match(previews.at(-1).text, new RegExp(receipt.ticketNumber));
    const principal = await bridgeCs.resolveCustomerPrincipal({ tenantId: ids.t1, channelAccountId: ACCOUNT, providerContactId: contact });
    assert.equal(await bridgeCs.getActiveDraft(principal), null, `${boundary}: pointer cleared with the receipt`);
    evidence.push({ boundary, ticketNumber: receipt.ticketNumber, draftVersion: draft.version, acks: 1, previews: previews.length });
  }
  const numbers = evidence.map(e => e.ticketNumber);
  assert.equal(new Set(numbers).size, 4);
  assert.equal(await db.collection('cs_draft_refs').countDocuments({}), 0, 'bridge keeps no separate draft pointer');
  assert.equal(await identityDb.collection('cs_outbox').countDocuments({ state: 'SENT' }), 0);
  console.log(`R13-04-EVIDENCE ${JSON.stringify(evidence)}`);
});
