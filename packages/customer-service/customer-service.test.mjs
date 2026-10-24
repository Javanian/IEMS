import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTenantFoundation } from '../tenant-foundation/index.mjs';
import { createCustomerService, SYNTHETIC_ORDER_SOURCE } from './index.mjs';

import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let repl, client, db, foundation, cs, clock;
const k = Object.fromEntries(['t1','t2','e1','e2','p1','p2','agentA','agentB','admin','viewer','agentT2','m1','m2','m3','m4','m5','c1','c2','c3','b1','b2','b3'].map(x => [x, randomUUID()]));
const scopes = {};
const principals = {};
const ACCOUNT = 'SIMULATED';
const roleActions = {
  viewer: ['cs.ticket.read'],
  agent: ['cs.ticket.read', 'cs.ticket.write', 'cs.conversation.handoff', 'cs.reply', 'cs.note.internal'],
  admin: ['cs.ticket.read', 'cs.ticket.write', 'cs.conversation.handoff', 'cs.reply', 'cs.note.internal', 'cs.fixture.admin', 'cs.ticket.reopen_closed', 'cs.delivery.review']
};

before(async () => {
  repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await MongoClient.connect(repl.getUri());
  db = client.db(`customer_service_owned_${randomUUID().replaceAll('-', '')}`);
  foundation = createTenantFoundation({ client, db, roleActions });
  await foundation.initialize();
  await foundation.provisionTenant({ id: k.t1 });
  await foundation.provisionTenant({ id: k.t2 });
  await foundation.provisionLegalEntity({ id: k.e1, tenantId: k.t1 });
  await foundation.provisionLegalEntity({ id: k.e2, tenantId: k.t2 });
  await foundation.provisionPlant({ id: k.p1, tenantId: k.t1, legalEntityId: k.e1 });
  await foundation.provisionPlant({ id: k.p2, tenantId: k.t2, legalEntityId: k.e2 });
  const members = [['agentA', k.t1, k.e1, k.p1, 'agent', 'm1'], ['agentB', k.t1, k.e1, k.p1, 'agent', 'm2'], ['admin', k.t1, k.e1, k.p1, 'admin', 'm3'], ['viewer', k.t1, k.e1, k.p1, 'viewer', 'm4'], ['agentT2', k.t2, k.e2, k.p2, 'admin', 'm5']];
  for (const [user, tenantId, entity, plant, role, m] of members) {
    await foundation.provisionUser({ id: k[user], tenantId });
    await foundation.provisionMembership({ id: k[m], tenantId, userId: k[user], legalEntityIds: [entity], plantIds: [plant], roles: [{ role, plantIds: [plant] }] });
    const issued = await foundation.issueSession({ userId: k[user], tenantId, selectedPlantId: plant, ttlMs: 3600000 });
    scopes[user] = await foundation.authenticate(issued.token);
  }
  clock = { now: Date.now() };
  cs = createCustomerService({ client, db, foundation, now: () => new Date(clock.now), allowSyntheticOrders: true });
  await cs.initialize();
  for (const [scope, plantId, customerId, bindingId, contact] of [['admin', k.p1, k.c1, k.b1, 'opaque-contact-1'], ['admin', k.p1, k.c2, k.b2, 'opaque-contact-2'], ['agentT2', k.p2, k.c3, k.b3, 'opaque-contact-1']]) {
    await cs.provisionFixtureCustomer(scopes[scope], { plantId, customerId, label: `Synthetic customer ${customerId.slice(0, 4)}` });
    await cs.bindContact(scopes[scope], { plantId, bindingId, customerId, channelAccountId: ACCOUNT, providerContactId: contact });
  }
  await cs.registerSyntheticOrderSnapshot(scopes.admin, { plantId: k.p1, customerId: k.c1, orderNumber: 'SO-DEMO-001', publicStage: 'QUALITY_INSPECTION', progress: { released: 6, total: 10 } });
  await cs.registerSyntheticOrderSnapshot(scopes.admin, { plantId: k.p1, customerId: k.c2, orderNumber: 'SO-DEMO-002', publicStage: 'PRODUCTION' });
  await cs.registerSyntheticOrderSnapshot(scopes.agentT2, { plantId: k.p2, customerId: k.c3, orderNumber: 'SO-DEMO-001', publicStage: 'ACCEPTED' });
  principals.c1 = await cs.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-1' });
  principals.c2 = await cs.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-2' });
  principals.c3 = await cs.resolveCustomerPrincipal({ tenantId: k.t2, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-1' });
});
after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); if (repl) await repl.stop(); });

const code = c => ({ code: c });
const count = (name, filter = {}) => db.collection(name).countDocuments(filter);
async function previewDraft(principal, orderNumber = 'SO-DEMO-001', category = 'DELIVERY_DELAY') {
  let d = await cs.startComplaintDraft(principal, { requestKey: randomUUID() });
  d = await cs.updateComplaintDraft(principal, { draftId: d.draftId, expectedVersion: d.version, action: orderNumber ? { type: 'SELECT_ORDER', orderNumber } : { type: 'GENERAL_INQUIRY' } });
  d = await cs.updateComplaintDraft(principal, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'SELECT_CATEGORY', category } });
  return cs.updateComplaintDraft(principal, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'DESCRIBE', text: 'Shipment is late by two days.' } });
}

test('synthetic order snapshot is labelled fixture data, scoped to customer and tenant, never a live lookup', async () => {
  const own = await cs.getOrderStatusForCustomer(principals.c1, { orderNumber: 'SO-DEMO-001' });
  assert.equal(own.source, SYNTHETIC_ORDER_SOURCE);
  assert.equal(own.liveLookup, false);
  assert.equal(own.publicStage, 'QUALITY_INSPECTION');
  assert.equal(own.customerId, undefined);
  await assert.rejects(cs.getOrderStatusForCustomer(principals.c2, { orderNumber: 'SO-DEMO-001' }), code('NOT_FOUND'));
  await assert.rejects(cs.getOrderStatusForCustomer(principals.c1, { orderNumber: 'SO-DEMO-404' }), code('NOT_FOUND'));
  assert.equal((await cs.getOrderStatusForCustomer(principals.c3, { orderNumber: 'SO-DEMO-001' })).publicStage, 'ACCEPTED');
  await assert.rejects(cs.getOrderStatusForCustomer({ ...principals.c1 }, { orderNumber: 'SO-DEMO-001' }), code('DENIED'));
  await assert.rejects(cs.registerSyntheticOrderSnapshot(scopes.agentA, { plantId: k.p1, customerId: k.c1, orderNumber: 'SO-DEMO-009', publicStage: 'PRODUCTION' }), { code: 'SCOPE_DENIED' });
  await assert.rejects(cs.registerSyntheticOrderSnapshot(scopes.admin, { plantId: k.p1, customerId: k.c3, orderNumber: 'SO-DEMO-009', publicStage: 'PRODUCTION' }), code('NOT_FOUND'));
});

test('complaint draft enforces explicit stages, back/cancel and optimistic versions', async () => {
  let d = await cs.startComplaintDraft(principals.c1, { requestKey: 'draft-key-1' });
  assert.equal(d.stage, 'ORDER_SELECTION');
  assert.deepEqual(await cs.startComplaintDraft(principals.c1, { requestKey: 'draft-key-1' }), d);
  await assert.rejects(cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'SELECT_CATEGORY', category: 'OTHER' } }), code('INVALID_TRANSITION'));
  await assert.rejects(cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'SELECT_ORDER', orderNumber: 'SO-DEMO-002' } }), code('NOT_FOUND'));
  await assert.rejects(cs.updateComplaintDraft(principals.c2, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'GENERAL_INQUIRY' } }), code('NOT_FOUND'));
  d = await cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'SELECT_ORDER', orderNumber: 'SO-DEMO-001' } });
  assert.equal(d.stage, 'CATEGORY');
  await assert.rejects(cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version - 1, action: { type: 'BACK' } }), code('VERSION_CONFLICT'));
  await assert.rejects(cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'SELECT_CATEGORY', category: 'REFUND_NOW' } }), code('INVALID_INPUT'));
  d = await cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'BACK' } });
  assert.equal(d.stage, 'ORDER_SELECTION');
  d = await cs.updateComplaintDraft(principals.c1, { draftId: d.draftId, expectedVersion: d.version, action: { type: 'CANCEL' } });
  assert.equal(d.stage, 'CANCELLED');
  await assert.rejects(cs.confirmComplaint(principals.c1, { draftId: d.draftId, expectedVersion: d.version, inboundKey: randomUUID() }), code('INVALID_TRANSITION'));
  const p = await previewDraft(principals.c1);
  assert.equal(p.stage, 'PREVIEW');
  assert.equal(p.orderNumber, 'SO-DEMO-001');
  clock.now += 25 * 3600000;
  await assert.rejects(cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version, inboundKey: randomUUID() }), code('DRAFT_EXPIRED'));
  clock.now -= 25 * 3600000;
  assert.equal(await count('cs_tickets'), 0);
});

test('confirmation commits ticket, history, conversation link, ack outbox, idempotency and audit atomically', async () => {
  const p = await previewDraft(principals.c1);
  const r = await cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version, inboundKey: 'inbound-confirm-1' });
  assert.match(r.ticketNumber, /^CS-\d{6}$/);
  const ticket = await db.collection('cs_tickets').findOne({ _id: r.ticketId });
  assert.equal(ticket.tenantId, k.t1);
  assert.equal(ticket.customerId, k.c1);
  assert.equal(ticket.stage, 'NEW');
  assert.equal(ticket.version, 1);
  assert.equal(ticket.orderNumber, 'SO-DEMO-001');
  assert.equal(ticket.orderSource, SYNTHETIC_ORDER_SOURCE);
  assert.equal(await count('cs_ticket_events', { ticketId: r.ticketId, kind: 'CREATED' }), 1);
  const ack = await db.collection('cs_outbox').find({ ticketId: r.ticketId }).toArray();
  assert.equal(ack.length, 1);
  assert.equal(ack[0].state, 'QUEUED');
  assert.equal(ack[0].kind, 'TICKET_ACK');
  assert.equal(ack[0].payload.ticketNumber, r.ticketNumber);
  assert.match(ack[0].payloadHash, /^[0-9a-f]{64}$/);
  assert.equal((await db.collection('cs_conversations').findOne({ bindingId: k.b1 })).activeTicketId, r.ticketId);
  assert.equal((await db.collection('cs_complaint_drafts').findOne({ _id: p.draftId })).stage, 'CONFIRMED');
  assert.equal(await count('cs_audit', { action: 'complaint.confirmed', subjectId: r.ticketId }), 1);
  const replay = await cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version, inboundKey: 'inbound-confirm-1' });
  assert.deepEqual(replay, r);
  await assert.rejects(cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version + 1, inboundKey: 'inbound-confirm-1' }), code('IDEMPOTENCY_CONFLICT'));
  const other = await cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version, inboundKey: 'inbound-confirm-other' });
  assert.equal(other.ticketId, r.ticketId);
  assert.equal(await count('cs_tickets', { draftId: p.draftId }), 1);
  assert.equal(await count('cs_outbox', { ticketId: r.ticketId }), 1);
});

test('concurrent duplicate confirmations produce one ticket and one logical acknowledgement', async () => {
  const p = await previewDraft(principals.c2, 'SO-DEMO-002', 'WRONG_ITEM');
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => cs.confirmComplaint(principals.c2, { draftId: p.draftId, expectedVersion: p.version, inboundKey: i % 2 ? 'dup-a' : 'dup-b' })));
  assert.equal(new Set(results.map(r => r.ticketId)).size, 1);
  assert.equal(await count('cs_tickets', { draftId: p.draftId }), 1);
  assert.equal(await count('cs_outbox', { ticketId: results[0].ticketId }), 1);
  assert.equal(await count('cs_audit', { action: 'complaint.confirmed', subjectId: results[0].ticketId }), 1);
});

test('audit failure rolls back ticket, number counter, outbox, draft transition and idempotency record', async () => {
  const p = await previewDraft(principals.c1, null, 'INVOICE_QUESTION');
  const before = { tickets: await count('cs_tickets'), outbox: await count('cs_outbox'), idem: await count('cs_idempotency'), counter: await db.collection('cs_counters').findOne({ _id: `${k.t1}:ticket` }) };
  await db.command({ collMod: 'cs_audit', validator: { action: { $ne: 'complaint.confirmed' } }, validationLevel: 'strict' });
  try {
    await assert.rejects(cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version, inboundKey: 'rollback-key' }));
  } finally {
    await db.command({ collMod: 'cs_audit', validator: {} });
  }
  assert.equal(await count('cs_tickets'), before.tickets);
  assert.equal(await count('cs_outbox'), before.outbox);
  assert.equal(await count('cs_idempotency'), before.idem);
  assert.deepEqual(await db.collection('cs_counters').findOne({ _id: `${k.t1}:ticket` }), before.counter);
  assert.equal((await db.collection('cs_complaint_drafts').findOne({ _id: p.draftId })).stage, 'PREVIEW');
  const r = await cs.confirmComplaint(principals.c1, { draftId: p.draftId, expectedVersion: p.version, inboundKey: 'rollback-key' });
  assert.equal(Number(r.ticketNumber.slice(3)), Number(before.counter.seq) + 1);
});

async function confirmedTicket(principal, orderNumber = 'SO-DEMO-001', category = 'QUALITY') {
  const p = await previewDraft(principal, orderNumber, category);
  return cs.confirmComplaint(principal, { draftId: p.draftId, expectedVersion: p.version, inboundKey: randomUUID() });
}
async function drain(tenantId = k.t1) {
  const out = [];
  for (let d; (d = await cs.claimNextDelivery({ tenantId, channelAccountId: ACCOUNT, leaseOwner: 'drain' })); ) {
    out.push(d);
    await cs.recordDeliveryResult({ tenantId, deliveryId: d.deliveryId, fence: d.fence, outcome: 'SENT', providerMessageId: `fixture-${d.deliveryId}` });
  }
  return out;
}

test('ticket stages follow explicit transitions with versions, history, idempotent commands and reopen permission', async () => {
  const r = await confirmedTicket(principals.c1);
  const t = { plantId: k.p1, ticketId: r.ticketId };
  await assert.rejects(cs.transitionTicket(scopes.agentA, { ...t, expectedVersion: 1, toStage: 'RESOLVED', reason: 'skip', commandKey: randomUUID() }), code('INVALID_TRANSITION'));
  await assert.rejects(cs.transitionTicket(scopes.viewer, { ...t, expectedVersion: 1, toStage: 'TRIAGED', reason: 'x', commandKey: randomUUID() }), { code: 'SCOPE_DENIED' });
  const tri = await cs.transitionTicket(scopes.agentA, { ...t, expectedVersion: 1, toStage: 'TRIAGED', reason: 'quality report', commandKey: 'tr-1' });
  assert.deepEqual(await cs.transitionTicket(scopes.agentA, { ...t, expectedVersion: 1, toStage: 'TRIAGED', reason: 'quality report', commandKey: 'tr-1' }), tri);
  await assert.rejects(cs.transitionTicket(scopes.agentA, { ...t, expectedVersion: 1, toStage: 'ASSIGNED', assigneeId: k.agentA, reason: 'x', commandKey: 'tr-1' }), code('IDEMPOTENCY_CONFLICT'));
  const racers = await Promise.allSettled([k.agentA, k.agentB].map((who, i) => cs.transitionTicket(i ? scopes.agentB : scopes.agentA, { ...t, expectedVersion: 2, toStage: 'ASSIGNED', assigneeId: who, reason: 'claim', commandKey: randomUUID() })));
  assert.equal(racers.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(racers.find(x => x.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  let v = 3;
  for (const toStage of ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) v = (await cs.transitionTicket(scopes.agentA, { ...t, expectedVersion: v, toStage, reason: `to ${toStage}`, commandKey: randomUUID() })).version;
  await assert.rejects(cs.transitionTicket(scopes.agentA, { ...t, expectedVersion: v, toStage: 'REOPENED', reason: 'customer disagrees', commandKey: randomUUID() }), { code: 'SCOPE_DENIED' });
  await assert.rejects(cs.addCustomerComment(principals.c1, { ticketNumber: r.ticketNumber, inboundKey: randomUUID(), text: 'still broken' }), code('INVALID_TRANSITION'));
  v = (await cs.transitionTicket(scopes.admin, { ...t, expectedVersion: v, toStage: 'REOPENED', reason: 'customer disagrees', commandKey: randomUUID() })).version;
  const view = await cs.getTicketForOperator(scopes.viewer, t);
  assert.equal(view.stage, 'REOPENED');
  assert.equal(view.version, v);
  assert.deepEqual(view.history.map(h => h.toStage), ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED']);
  assert.ok(view.history.slice(1).every(h => h.actor.type === 'OPERATOR' && h.reason && h.version));
  await assert.rejects(cs.getTicketForOperator(scopes.agentT2, { plantId: k.p2, ticketId: r.ticketId }), code('NOT_FOUND'));
  await assert.rejects(cs.getTicketForOperator(scopes.agentT2, t), { code: 'SCOPE_DENIED' });
});

test('internal notes are stored separately and never appear in customer ticket projection', async () => {
  const r = await confirmedTicket(principals.c1);
  const t = { plantId: k.p1, ticketId: r.ticketId };
  await cs.addInternalNote(scopes.agentA, { ...t, text: 'INTERNAL margin issue with vendor batch 7', commandKey: 'note-1' });
  await cs.addInternalNote(scopes.agentA, { ...t, text: 'INTERNAL margin issue with vendor batch 7', commandKey: 'note-1' });
  await assert.rejects(cs.addInternalNote(scopes.viewer, { ...t, text: 'x', commandKey: randomUUID() }), { code: 'SCOPE_DENIED' });
  await assert.rejects(cs.addInternalNote(scopes.agentT2, { plantId: k.p2, ticketId: r.ticketId, text: 'x', commandKey: randomUUID() }), code('NOT_FOUND'));
  await cs.addPublicUpdate(scopes.agentA, { ...t, expectedVersion: 1, text: 'We are checking the batch.', commandKey: randomUUID() });
  await cs.addCustomerComment(principals.c1, { ticketNumber: r.ticketNumber, inboundKey: 'c-1', text: 'Photo shows a crack.' });
  await cs.addCustomerComment(principals.c1, { ticketNumber: r.ticketNumber, inboundKey: 'c-1', text: 'Photo shows a crack.' });
  const customerView = await cs.getTicketForCustomer(principals.c1, { ticketNumber: r.ticketNumber });
  assert.ok(!JSON.stringify(customerView).includes('INTERNAL'));
  assert.deepEqual(customerView.updates.map(u => u.kind), ['CREATED', 'PUBLIC_UPDATE', 'CUSTOMER_COMMENT']);
  assert.equal(await count('cs_ticket_events', { ticketId: r.ticketId, text: /INTERNAL/ }), 0);
  assert.equal((await cs.listInternalNotes(scopes.agentA, t)).length, 1);
  await assert.rejects(cs.listInternalNotes(scopes.viewer, t), { code: 'SCOPE_DENIED' });
  await assert.rejects(cs.getTicketForCustomer(principals.c2, { ticketNumber: r.ticketNumber }), code('NOT_FOUND'));
  await assert.rejects(cs.getTicketForCustomer(principals.c3, { ticketNumber: r.ticketNumber }), code('NOT_FOUND'));
});

test('handoff cancels queued bot replies, suppresses new ones, and records in-flight boundary', async () => {
  await drain();
  const first = await cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-1', template: 'order_status', params: { orderNumber: 'SO-DEMO-002' } });
  const queued = await cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-2', template: 'menu' });
  assert.deepEqual(await cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-2', template: 'menu' }), queued);
  await assert.rejects(cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-2', template: 'order_status' }), code('IDEMPOTENCY_CONFLICT'));
  const inflight = await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'worker-1' });
  assert.equal(inflight.deliveryId, first.deliveryId);
  const h = await cs.requestHandoff(principals.c2, { inboundKey: 'human-1' });
  assert.equal(h.mode, 'HUMAN_PENDING');
  assert.deepEqual(h.cancelledDeliveryIds, [queued.deliveryId]);
  assert.deepEqual(h.inFlightDeliveryIds, [first.deliveryId]);
  assert.deepEqual(await cs.requestHandoff(principals.c2, { inboundKey: 'human-1' }), h);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: queued.deliveryId })).state, 'CANCELLED');
  assert.equal((await cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-3', template: 'menu' })).state, 'SUPPRESSED');
  await cs.recordDeliveryResult({ tenantId: k.t1, deliveryId: inflight.deliveryId, fence: inflight.fence, outcome: 'SENT', providerMessageId: 'fixture-provider-1' });
  const conv = await cs.findConversationByBinding(scopes.agentA, { plantId: k.p1, bindingId: k.b2 });
  const raced = await Promise.allSettled([scopes.agentA, scopes.agentB].map(s => cs.takeOverConversation(s, { plantId: k.p1, conversationId: conv.conversationId, expectedVersion: conv.version, commandKey: randomUUID() })));
  assert.equal(raced.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(raced.find(x => x.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  const winner = raced[0].status === 'fulfilled' ? scopes.agentA : scopes.agentB;
  const loser = winner === scopes.agentA ? scopes.agentB : scopes.agentA;
  await assert.rejects(cs.operatorReply(loser, { plantId: k.p1, conversationId: conv.conversationId, text: 'Hi', commandKey: randomUUID() }), code('INVALID_TRANSITION'));
  const reply = await cs.operatorReply(winner, { plantId: k.p1, conversationId: conv.conversationId, text: 'Hello, I am looking into it.', commandKey: 'op-1' });
  const sent = await drain();
  assert.deepEqual(sent.map(d => d.kind), ['HANDOFF_ACK', 'OPERATOR_REPLY']);
  assert.equal(sent[1].deliveryId, reply.deliveryId);
  const events = await db.collection('cs_conversation_events').find({ conversationId: conv.conversationId }).sort({ version: 1 }).toArray();
  assert.deepEqual(events.map(e => e.toMode), ['HUMAN_PENDING', 'HUMAN_ACTIVE']);
});

test('dispatch rechecks mode epoch and binding version so stale bot replies are cancelled not sent', async () => {
  const conv = await cs.findConversationByBinding(scopes.agentA, { plantId: k.p1, bindingId: k.b2 });
  const resumed = await cs.setConversationMode(scopes.agentA, { plantId: k.p1, conversationId: conv.conversationId, expectedVersion: conv.version, toMode: 'BOT_ACTIVE', reason: 'resume bot explicitly', commandKey: randomUUID() });
  assert.equal(resumed.mode, 'BOT_ACTIVE');
  const stale = await cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-epoch', template: 'menu' });
  // Out-of-band epoch bump: only the dispatch-time recheck stands between this stale row and a send.
  await db.collection('cs_conversations').updateOne({ _id: conv.conversationId }, { $inc: { modeEpoch: 1 } });
  assert.equal(await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'w' }), null);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: stale.deliveryId })).cancelReason, 'MODE_CHANGED');
  await db.collection('cs_conversations').updateOne({ _id: conv.conversationId }, { $inc: { modeEpoch: -1 } });
  const pending = await cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-revoke', template: 'menu' });
  const rv = await cs.revokeBinding(scopes.admin, { plantId: k.p1, bindingId: k.b2, expectedVersion: 1 });
  assert.equal(rv.cancelledDeliveries, 1);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: pending.deliveryId })).state, 'CANCELLED');
  await assert.rejects(cs.enqueueBotReply(principals.c2, { inboundKey: 'bot-after', template: 'menu' }), code('DENIED'));
  await assert.rejects(cs.getOrderStatusForCustomer(principals.c2, { orderNumber: 'SO-DEMO-002' }), code('DENIED'));
  await assert.rejects(cs.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-2' }), code('DENIED'));
});

test('SENDING crash becomes UNKNOWN, blocks conversation, never blind-resent; stale fences rejected; review is evidence-based', async () => {
  await drain();
  const a = await cs.enqueueBotReply(principals.c1, { inboundKey: 'unk-1', template: 'menu' });
  const b = await cs.enqueueBotReply(principals.c1, { inboundKey: 'unk-2', template: 'menu' });
  const claimed = await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'crashing-worker', leaseMs: 1000 });
  assert.equal(claimed.deliveryId, a.deliveryId);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: a.deliveryId })).state, 'SENDING');
  assert.equal(await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'other' }), null);
  clock.now += 5000;
  assert.deepEqual((await cs.reconcileExpiredSending({ tenantId: k.t1 })).unknownDeliveryIds, [a.deliveryId]);
  await assert.rejects(cs.recordDeliveryResult({ tenantId: k.t1, deliveryId: a.deliveryId, fence: claimed.fence, outcome: 'SENT', providerMessageId: 'late' }), code('STALE_FENCE'));
  assert.equal(await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'other' }), null);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: a.deliveryId })).attempt, 1);
  const convId = (await cs.findConversationByBinding(scopes.agentA, { plantId: k.p1, bindingId: k.b1 })).conversationId;
  const view = await cs.getConversationForOperator(scopes.agentA, { plantId: k.p1, conversationId: convId });
  assert.equal(view.deliveries.find(d => d.deliveryId === a.deliveryId).deliveryUncertain, true);
  await assert.rejects(cs.resolveUnknownDelivery(scopes.agentA, { plantId: k.p1, deliveryId: a.deliveryId, resolution: 'CONFIRMED_SENT', evidence: 'x', providerMessageId: 'p', commandKey: randomUUID() }), { code: 'SCOPE_DENIED' });
  await assert.rejects(cs.resolveUnknownDelivery(scopes.agentT2, { plantId: k.p2, deliveryId: a.deliveryId, resolution: 'ABANDON', evidence: 'x', commandKey: randomUUID() }), code('NOT_FOUND'));
  await cs.resolveUnknownDelivery(scopes.admin, { plantId: k.p1, deliveryId: a.deliveryId, resolution: 'CONFIRMED_SENT', evidence: 'provider console shows message accepted', providerMessageId: 'fixture-provider-reviewed', commandKey: randomUUID() });
  const next = await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'w2' });
  assert.equal(next.deliveryId, b.deliveryId);
  const u = await cs.recordDeliveryResult({ tenantId: k.t1, deliveryId: next.deliveryId, fence: next.fence, outcome: 'SUBMIT_UNCERTAIN', error: 'timeout after submit' });
  assert.equal(u.state, 'UNKNOWN');
  assert.equal(await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'w2' }), null);
  await cs.resolveUnknownDelivery(scopes.admin, { plantId: k.p1, deliveryId: b.deliveryId, resolution: 'CONFIRMED_NOT_SENT_REQUEUE', evidence: 'provider has no record of message', commandKey: randomUUID() });
  const retry = await cs.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'w3' });
  assert.equal(retry.deliveryId, b.deliveryId);
  assert.equal(retry.attempt, 2);
  assert.ok(retry.fence > next.fence);
  await assert.rejects(cs.recordDeliveryResult({ tenantId: k.t1, deliveryId: b.deliveryId, fence: next.fence, outcome: 'SENT', providerMessageId: 'old-worker' }), code('STALE_FENCE'));
  await cs.recordDeliveryResult({ tenantId: k.t1, deliveryId: b.deliveryId, fence: retry.fence, outcome: 'NOT_SENT', error: 'connection refused before submit' });
  const row = await db.collection('cs_outbox').findOne({ _id: b.deliveryId });
  assert.equal(row.state, 'QUEUED');
  assert.ok(row.nextAttemptAt > new Date(clock.now));
});

test('tenant isolation: same contact id and order number in two tenants never cross; forged principals deny', async () => {
  const t2 = await confirmedTicket(principals.c3, 'SO-DEMO-001', 'OTHER');
  assert.equal((await db.collection('cs_tickets').findOne({ _id: t2.ticketId })).tenantId, k.t2);
  assert.equal(t2.ticketNumber, 'CS-000001');
  assert.notEqual((await cs.getTicketForCustomer(principals.c1, { ticketNumber: 'CS-000001' })).category, 'OTHER');
  assert.equal((await cs.listTickets(scopes.agentT2, { plantId: k.p2 })).length, 1);
  assert.ok((await cs.listTickets(scopes.agentA, { plantId: k.p1 })).every(t => t.plantId === k.p1));
  await assert.rejects(cs.listTickets(scopes.agentA, { plantId: k.p2 }), { code: 'SCOPE_DENIED' });
  await assert.rejects(cs.startComplaintDraft({ kind: 'CUSTOMER', tenantId: k.t1, customerId: k.c1, bindingId: k.b1, bindingVersion: 1 }, { requestKey: 'forged' }), code('DENIED'));
  await assert.rejects(cs.resolveCustomerPrincipal({ tenantId: k.t2, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-2' }), code('DENIED'));
  await assert.rejects(cs.claimNextDelivery({ tenantId: 'not-a-uuid', channelAccountId: ACCOUNT, leaseOwner: 'w' }), code('INVALID_INPUT'));
  await assert.rejects(cs.startComplaintDraft(principals.c1, { requestKey: { $ne: null } }), code('INVALID_INPUT'));
  await assert.rejects(cs.getOrderStatusForCustomer(principals.c1, { orderNumber: { $gt: '' } }), code('INVALID_INPUT'));
});

test('safety/damage complaints route to a human immediately without bot substance', async () => {
  const r = await confirmedTicket(principals.c3, null, 'SAFETY_OR_DAMAGE');
  assert.equal((await db.collection('cs_tickets').findOne({ _id: r.ticketId })).requiresHuman, true);
  assert.equal((await db.collection('cs_conversations').findOne({ bindingId: k.b3 })).mode, 'HUMAN_PENDING');
  assert.equal((await cs.enqueueBotReply(principals.c3, { inboundKey: 'after-safety', template: 'menu' })).state, 'SUPPRESSED');
  const sent = await drain(k.t2);
  assert.deepEqual(sent.map(d => d.kind).sort(), ['TICKET_ACK', 'TICKET_ACK']);
});

 test('v2 authoritative reader refuses default fixture fallback and rejects stale/timeout', async () => {
 const base = {client, db, foundation, now: () => new Date(clock.now)};
 await db.collection('cs_contact_bindings').updateOne({_id:k.b2},{$set:{status:'ACTIVE'}});
 const check = async opts => { const service = createCustomerService({...base, ...opts}); const p = await service.resolveCustomerPrincipal({tenantId:k.t1,channelAccountId:ACCOUNT,providerContactId:'opaque-contact-2'}); return {service,p}; };
 let {service,p} = await check({});
 await assert.rejects(service.getOrderStatusForCustomer(p,{orderNumber:'SO-DEMO-002'}),code('STATUS_UNAVAILABLE'));
 ({service,p} = await check({orderReader:{readCustomerOrder:async () => ({orderNumber:'SO-DEMO-002',publicStage:'PRODUCTION',progress:null,source:'PORTFOLIO_API_OWNED',sourceId:'opaque',sourceVersion:2,asOf:new Date(clock.now)})}}));
 assert.equal((await service.getOrderStatusForCustomer(p,{orderNumber:'SO-DEMO-002'})).liveLookup,true);
 ({service,p} = await check({orderReader:{readCustomerOrder:async () => ({orderNumber:'SO-DEMO-002',publicStage:'PRODUCTION',progress:null,source:'PORTFOLIO_API_OWNED',sourceId:'opaque',sourceVersion:2,asOf:new Date(clock.now-60001)})}}));
 await assert.rejects(service.getOrderStatusForCustomer(p,{orderNumber:'SO-DEMO-002'}),code('STATUS_UNAVAILABLE'));
 ({service,p} = await check({orderReaderTimeoutMs:5,orderReader:{readCustomerOrder:() => new Promise(() => {})}}));
 await assert.rejects(service.getOrderStatusForCustomer(p,{orderNumber:'SO-DEMO-002'}),code('STATUS_UNAVAILABLE'));
 });

test('v2 inbound atomic rollback at domain/pointer/result and replay after committed restart', async () => {
 const base={client,db,foundation,allowSyntheticOrders:true,previewDispatcher:true,now:()=>new Date(clock.now)};
 const principal = async service => service.resolveCustomerPrincipal({tenantId:k.t1,channelAccountId:ACCOUNT,providerContactId:'opaque-contact-2'});
 for (const boundary of ['domain','pointer','result','afterCommit']) {
  let armed=true;
  let service=createCustomerService({...base,faultInjector:async b=>{if(armed && b===boundary){armed=false;throw new Error('CRASH_'+b);}}});
  const input={inboundKey:'crash-start-'+boundary,text:'IEMS COMPLAINT',command:{op:'COMPLAINT'}};
  await assert.rejects(service.handleInboundCommand(await principal(service),input),/CRASH_/);
  service=createCustomerService(base); const p=await principal(service);
  const result=await service.handleInboundCommand(p,input);
  assert.deepEqual(await service.handleInboundCommand(p,input),result);
  assert.equal((await service.getActiveDraft(p)).draftId,result.draft.draftId);
  assert.equal(await count('cs_complaint_drafts',{bindingId:k.b2,requestKey:input.inboundKey}),1);
  let d=result.draft;
  for(const [op,action] of [['general',{type:'GENERAL_INQUIRY'}],['category',{type:'SELECT_CATEGORY',category:'OTHER'}],['describe',{type:'DESCRIBE',text:'Please review the delayed service.'}]]) {
   const command={inboundKey:input.inboundKey+op,text:op,command:{op:'DRAFT',action}};
   const r=await service.handleInboundCommand(p,command);d=r.draft;
   assert.deepEqual(await service.handleInboundCommand(p,command),r);
  }
  const confirm={inboundKey:input.inboundKey+'confirm',text:'IEMS COMPLAINT CONFIRM',command:{op:'CONFIRM'}};
  armed=true;service=createCustomerService({...base,faultInjector:async b=>{if(armed && b===boundary){armed=false;throw new Error('CRASH_'+b);}}});
  await assert.rejects(service.handleInboundCommand(await principal(service),confirm),/CRASH_/);
  service=createCustomerService(base);const p2=await principal(service);
  const receipt=await service.handleInboundCommand(p2,confirm);
  assert.deepEqual(await service.handleInboundCommand(p2,confirm),receipt);
  assert.equal(await count('cs_tickets',{draftId:d.draftId}),1);
  assert.equal(await count('cs_outbox',{actionKey:'ticket-ack:'+receipt.receipt.ticketId}),1);
  assert.equal(await service.getActiveDraft(p2),null);
 }
});

test('v2 negatives: reader scope, revoked binding, cross-customer drafts, cursors, thread privacy, reply authorization and PREVIEWED gate', async () => {
  const calls = [];
  const reader = { async readCustomerOrder(input) { calls.push(input); return input.customerId === k.c1 && input.orderNumber === 'SO-LIVE-001' ? { orderNumber: 'SO-LIVE-001', publicStage: 'PRODUCTION', progress: { released: 1, total: 4 }, source: 'PORTFOLIO_API_OWNED', sourceId: 'opaque-1', sourceVersion: 3, asOf: new Date(clock.now) } : null; } };
  const live = createCustomerService({ client, db, foundation, now: () => new Date(clock.now), orderReader: reader });
  const c1 = await live.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-1' });
  const c2 = await live.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-2' });
  const own = await live.getOrderStatusForCustomer(c1, { orderNumber: 'SO-LIVE-001' });
  assert.deepEqual([own.source, own.liveLookup, own.sourceVersion, own.sourceId], ['PORTFOLIO_API_OWNED', true, 3, 'opaque-1']);
  assert.deepEqual(calls[0], { tenantId: k.t1, plantId: k.p1, customerId: k.c1, orderNumber: 'SO-LIVE-001' });
  await assert.rejects(live.getOrderStatusForCustomer(c2, { orderNumber: 'SO-LIVE-001' }), code('NOT_FOUND'));
  await assert.rejects(live.getOrderStatusForCustomer(c1, { orderNumber: 'SO-DEMO-001' }), code('NOT_FOUND'));
  const wrongSource = createCustomerService({ client, db, foundation, now: () => new Date(clock.now), orderReader: { readCustomerOrder: async () => ({ ...own, source: SYNTHETIC_ORDER_SOURCE }) } });
  await assert.rejects(wrongSource.getOrderStatusForCustomer(await wrongSource.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: ACCOUNT, providerContactId: 'opaque-contact-1' }), { orderNumber: 'SO-LIVE-001' }), code('STATUS_UNAVAILABLE'));

  const d1 = (await live.handleInboundCommand(c1, { inboundKey: 'neg-c1-start', text: 'IEMS COMPLAINT', command: { op: 'COMPLAINT' } })).draft;
  await assert.rejects(live.getDraft(c2, { draftId: d1.draftId }), code('NOT_FOUND'));
  assert.equal(await live.getDraftByRequestKey(c2, { requestKey: 'neg-c1-start' }), null);
  assert.equal((await live.getDraftByRequestKey(c1, { requestKey: 'neg-c1-start' })).draftId, d1.draftId);
  await assert.rejects(live.handleInboundCommand(c1, { inboundKey: 'neg-c1-start', text: 'IEMS MENU', command: { op: 'MENU' } }), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(await count('cs_inbound', { inboundKey: 'neg-c1-start' }), 1);

  const conv = await live.findConversationByBinding(scopes.agentA, { plantId: k.p1, bindingId: k.b1 });
  await assert.rejects(live.getConversationThread(scopes.agentT2, { plantId: k.p1, conversationId: conv.conversationId }), { code: 'SCOPE_DENIED' });
  await assert.rejects(live.getConversationThread(scopes.agentT2, { plantId: k.p2, conversationId: conv.conversationId }), code('NOT_FOUND'));
  await assert.rejects(live.listTicketsPage(scopes.agentA, { plantId: k.p1, limit: 101 }), code('INVALID_INPUT'));
  await assert.rejects(live.listTicketsPage(scopes.agentA, { plantId: k.p1, cursor: 'not-a-cursor' }), code('INVALID_INPUT'));
  const all = await live.listTickets(scopes.agentA, { plantId: k.p1, limit: 200 });
  const seen = [];
  for (let cursor; ;) { const pg = await live.listTicketsPage(scopes.agentA, { plantId: k.p1, limit: 2, cursor }); seen.push(...pg.items.map(t => t.ticketId)); if (!pg.nextCursor) break; cursor = pg.nextCursor; }
  assert.deepEqual(seen, all.map(t => t.ticketId));
  const convs = [];
  for (let cursor; ;) { const pg = await live.listConversationsPage(scopes.agentA, { plantId: k.p1, limit: 1, cursor }); convs.push(...pg.items); if (!pg.nextCursor) break; cursor = pg.nextCursor; }
  assert.equal(new Set(convs.map(x => x.conversationId)).size, convs.length);
  assert.ok(convs.every(x => typeof x.customerLabel === 'string' && typeof x.hasUnknownDelivery === 'boolean'));

  const ticket = all[0];
  await live.addInternalNote(scopes.agentA, { plantId: k.p1, ticketId: ticket.ticketId, text: 'PRIVATE-NOTE-NEVER-IN-THREAD', commandKey: 'neg-note' });
  const thread = [];
  for (let cursor; ;) { const pg = await live.getConversationThread(scopes.agentA, { plantId: k.p1, conversationId: conv.conversationId, limit: 2, cursor }); thread.push(...pg.items); if (!pg.nextCursor) break; cursor = pg.nextCursor; }
  assert.ok(thread.some(m => m.direction === 'INBOUND' && m.origin === 'CUSTOMER' && m.text === 'IEMS COMPLAINT'));
  assert.equal(new Set(thread.map(m => m.messageId)).size, thread.length);
  assert.ok(!JSON.stringify(thread).includes('PRIVATE-NOTE'));

  const fresh = await live.findConversationByBinding(scopes.agentA, { plantId: k.p1, bindingId: k.b1 });
  await assert.rejects(live.operatorReply(scopes.viewer, { plantId: k.p1, conversationId: fresh.conversationId, text: 'x', commandKey: 'neg-viewer' }), { code: 'SCOPE_DENIED' });
  await assert.rejects(live.operatorReply(scopes.agentT2, { plantId: k.p1, conversationId: fresh.conversationId, text: 'x', commandKey: 'neg-t2' }), { code: 'SCOPE_DENIED' });
  let current = fresh;
  if (current.mode !== 'PAUSED') current = await live.setConversationMode(scopes.agentA, { plantId: k.p1, conversationId: fresh.conversationId, expectedVersion: fresh.version, toMode: 'PAUSED', reason: 'Pause check', commandKey: 'neg-pause' });
  await assert.rejects(live.operatorReply(scopes.agentA, { plantId: k.p1, conversationId: fresh.conversationId, text: 'x', commandKey: 'neg-paused' }), code('INVALID_TRANSITION'));
  const taken = await live.takeOverConversation(scopes.agentA, { plantId: k.p1, conversationId: fresh.conversationId, expectedVersion: current.version, commandKey: 'neg-take' });
  await assert.rejects(live.operatorReply(scopes.agentB, { plantId: k.p1, conversationId: fresh.conversationId, text: 'x', commandKey: 'neg-other-agent' }), code('INVALID_TRANSITION'));
  const reply = await live.operatorReply(scopes.agentA, { plantId: k.p1, conversationId: fresh.conversationId, text: 'Operator answer', commandKey: 'neg-reply' });
  assert.equal(reply.state, 'QUEUED');
  assert.equal((await live.handleInboundCommand(c1, { inboundKey: 'neg-human-mode', text: 'IEMS MENU', command: { op: 'MENU' } })).reply.state, 'SUPPRESSED');
  assert.equal(taken.mode, 'HUMAN_ACTIVE');

  await db.collection('cs_outbox').updateMany({ tenantId: k.t1, state: { $in: ['SENDING', 'UNKNOWN'] } }, { $set: { state: 'CANCELLED' } });
  await db.collection('cs_outbox').updateMany({ tenantId: k.t1, state: 'QUEUED', _id: { $ne: reply.deliveryId } }, { $set: { state: 'CANCELLED' } });
  const claim = await live.claimNextDelivery({ tenantId: k.t1, channelAccountId: ACCOUNT, leaseOwner: 'neg-dispatcher' });
  assert.equal(claim.deliveryId, reply.deliveryId);
  await assert.rejects(live.recordDeliveryResult({ tenantId: k.t1, deliveryId: claim.deliveryId, fence: claim.fence, outcome: 'PREVIEWED' }), code('DENIED'));
  const preview = createCustomerService({ client, db, foundation, now: () => new Date(clock.now), previewDispatcher: true });
  assert.equal((await preview.recordDeliveryResult({ tenantId: k.t1, deliveryId: claim.deliveryId, fence: claim.fence, outcome: 'PREVIEWED' })).state, 'PREVIEWED');
  const row = await db.collection('cs_outbox').findOne({ _id: claim.deliveryId });
  assert.deepEqual([row.state, row.providerMessageId, row.sentAt], ['PREVIEWED', null, undefined]);

  const binding = await db.collection('cs_contact_bindings').findOne({ _id: k.b1 });
  await live.revokeBinding(scopes.admin, { plantId: k.p1, bindingId: k.b1, expectedVersion: binding.version });
  const before = calls.length;
  await assert.rejects(live.getOrderStatusForCustomer(c1, { orderNumber: 'SO-LIVE-001' }), code('DENIED'));
  await assert.rejects(live.handleInboundCommand(c1, { inboundKey: 'neg-revoked', text: 'IEMS ORDER SO-LIVE-001', command: { op: 'ORDER', orderNumber: 'SO-LIVE-001' } }), code('DENIED'));
  await assert.rejects(live.getActiveDraft(c1), code('DENIED'));
  assert.equal(calls.length, before);
  await assert.rejects(live.operatorReply(scopes.agentA, { plantId: k.p1, conversationId: fresh.conversationId, text: 'after revoke', commandKey: 'neg-after-revoke' }), code('DENIED'));
});
