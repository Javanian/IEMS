import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTenantFoundation } from '../tenant-foundation/index.mjs';
import { createCustomerService, renderTemplate, parseInboundText, BOT_TEMPLATES, SIMULATED_CHANNEL_ACCOUNT } from './index.mjs';

// Wave 4f package behaviour on an owned single-member replica: rendering, onboarding, expiry, preview fence, reader detail, metrics.
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let repl, client, db, foundation, clock, scope, scopeB;
const k = Object.fromEntries(['t1', 't2', 'e1', 'e2', 'p1', 'p2', 'u1', 'u2', 'm1', 'm2', 'account', 'contact', 'foreignAccount'].map(x => [x, randomUUID()]));
const roleActions = { admin: ['cs.ticket.read', 'cs.ticket.write', 'cs.conversation.handoff', 'cs.reply', 'cs.binding.read', 'cs.binding.manage', 'cs.simulator.use'] };
// Trusted CRM directory stand-in: only the configured account/contact pair in tenant t1/plant p1 exists.
const partyDirectory = { async verifyCustomerContact({ tenantId, plantId, accountId, contactId }) { return tenantId === k.t1 && plantId === k.p1 && accountId === k.account && contactId === k.contact ? { accountLabel: 'Synthetic account' } : null; } };
const make = (extra = {}) => createCustomerService({ client, db, foundation, now: () => new Date(clock.now), partyDirectory, ...extra });
const code = c => ({ code: c });
const addr = () => `+62000${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

before(async () => {
  repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await MongoClient.connect(repl.getUri());
  db = client.db(`customer_service_owned_${randomUUID().replaceAll('-', '')}`);
  foundation = createTenantFoundation({ client, db, roleActions });
  await foundation.initialize();
  for (const [t, e, p, u, m] of [[k.t1, k.e1, k.p1, k.u1, k.m1], [k.t2, k.e2, k.p2, k.u2, k.m2]]) {
    await foundation.provisionTenant({ id: t });
    await foundation.provisionLegalEntity({ id: e, tenantId: t });
    await foundation.provisionPlant({ id: p, tenantId: t, legalEntityId: e });
    await foundation.provisionUser({ id: u, tenantId: t });
    await foundation.provisionMembership({ id: m, tenantId: t, userId: u, legalEntityIds: [e], plantIds: [p], roles: [{ role: 'admin', plantIds: [p] }] });
  }
  scope = await foundation.authenticate((await foundation.issueSession({ userId: k.u1, tenantId: k.t1, selectedPlantId: k.p1, ttlMs: 3600000 })).token);
  scopeB = await foundation.authenticate((await foundation.issueSession({ userId: k.u2, tenantId: k.t2, selectedPlantId: k.p2, ttlMs: 3600000 })).token);
  clock = { now: Date.now() };
  await make().initialize();
});
after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); if (repl) await repl.stop(); });

test('renderTemplate covers every bot template and never emits unknown payload fields', () => {
  for (const template of BOT_TEMPLATES) assert.equal(typeof renderTemplate({ template, params: { orderNumber: 'SO-1', publicStage: 'PRODUCTION', ticketNumber: 'CS-000001', stage: 'NEW', error: 'X', description: 'd' }, text: 'operator text', ticketNumber: 'CS-000001' }), 'string', template);
  assert.equal(renderTemplate({ template: 'nope' }), null);
  const body = renderTemplate({ template: 'order_status', params: { orderNumber: 'RP-1', publicStage: 'DIAGNOSIS', source: 'PORTFOLIO_API_OWNED', kind: 'REPAIR', nextMilestone: 'Awaiting your approval' }, internalNote: 'PRIVATE', margin: '42%' });
  assert.equal(body, 'RP-1: DIAGNOSIS. Next: Awaiting your approval. Authoritative owned repair order.');
  assert.deepEqual([parseInboundText('IEMS ORDER SO-1'), parseInboundText('ORDER SO-1'), parseInboundText('IEMS COMPLAINT DESCRIBE late'), parseInboundText('hello')], [{ op: 'ORDER', orderNumber: 'SO-1' }, { op: 'ORDER', orderNumber: 'SO-1' }, { op: 'DRAFT', action: { type: 'DESCRIBE', text: 'late' } }, { op: 'UNKNOWN_COMMAND' }]);
});

test('onboarding validates synthetic range, server scope and directory; expiry is enforced at query and dispatch', async () => {
  const cs = make(), preview = make({ previewDispatcher: true });
  const input = over => ({ plantId: k.p1, accountId: k.account, contactId: k.contact, channel: 'SIMULATED', address: addr(), idempotencyKey: randomUUID(), ...over });
  await assert.rejects(cs.createBinding(scope, input({ address: '+6281234567890' })), code('SYNTHETIC_ADDRESS_REQUIRED'));
  await assert.rejects(cs.createBinding(scope, input({ contactId: randomUUID() })), code('NOT_FOUND'));
  await assert.rejects(cs.createBinding(scopeB, input({ plantId: k.p2 })), code('NOT_FOUND'), 'other tenant cannot bind this account');
  await assert.rejects(cs.createBinding(scope, input({ plantId: k.p2 })), code('SCOPE_DENIED'));
  await assert.rejects(make({ partyDirectory: null }).createBinding(scope, input()), code('DENIED'));
  const { binding } = await cs.createBinding(scope, input({ expiresAt: new Date(clock.now + 60000).toISOString() }));
  const row = await db.collection('cs_contact_bindings').findOne({ _id: binding.bindingId });
  assert.deepEqual([row.tenantId, row.plantId, row.channelAccountId, binding.status], [k.t1, k.p1, SIMULATED_CHANNEL_ACCOUNT, 'ACTIVE']);
  const principal = await cs.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, providerContactId: row.providerContactId });
  const handoff = await cs.handleInboundCommand(principal, { inboundKey: randomUUID(), text: 'IEMS HUMAN', command: { op: 'HUMAN' } });
  assert.ok(handoff.deliveryIds.length >= 1);
  clock.now += 120000; // past expiry
  await assert.rejects(cs.handleInboundCommand(principal, { inboundKey: randomUUID(), text: 'IEMS MENU', command: { op: 'MENU' } }), code('DENIED'));
  await assert.rejects(cs.resolveCustomerPrincipal({ tenantId: k.t1, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, providerContactId: row.providerContactId }), code('DENIED'));
  await assert.rejects(cs.simulateInbound(scope, { plantId: k.p1, bindingId: binding.bindingId, inboundKey: randomUUID(), text: 'IEMS MENU' }), code('BINDING_REVOKED'));
  assert.equal(await preview.claimNextDelivery({ tenantId: k.t1, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, leaseOwner: 'test.preview' }), null);
  const cancelled = await db.collection('cs_outbox').find({ bindingId: binding.bindingId }).toArray();
  assert.ok(cancelled.length && cancelled.every(d => d.state === 'CANCELLED' && d.cancelReason === 'BINDING_EXPIRED'), JSON.stringify(cancelled.map(d => [d.state, d.cancelReason])));
  assert.equal((await cs.listBindingsPage(scope, { plantId: k.p1, status: 'EXPIRED' })).items.some(b => b.bindingId === binding.bindingId), true);
});

test('preview recording honours a revocation that lands between claim and record', async () => {
  const cs = make(), preview = make({ previewDispatcher: true });
  const { binding } = await cs.createBinding(scope, { plantId: k.p1, accountId: k.account, contactId: k.contact, channel: 'SIMULATED', address: addr(), idempotencyKey: randomUUID() });
  const sim = await cs.simulateInbound(scope, { plantId: k.p1, bindingId: binding.bindingId, inboundKey: randomUUID(), text: 'IEMS MENU' });
  let claim;
  do claim = await preview.claimNextDelivery({ tenantId: k.t1, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, leaseOwner: 'test.preview' }); while (claim && claim.deliveryId !== sim.result.reply.deliveryId && (await preview.recordDeliveryResult({ tenantId: k.t1, deliveryId: claim.deliveryId, fence: claim.fence, outcome: 'PREVIEWED' })));
  assert.equal(claim.deliveryId, sim.result.reply.deliveryId);
  await cs.revokeBindingByOperator(scope, { plantId: k.p1, bindingId: binding.bindingId, reason: 'Revoked mid-dispatch', expectedVersion: 1, idempotencyKey: randomUUID() });
  assert.deepEqual(await preview.recordDeliveryResult({ tenantId: k.t1, deliveryId: claim.deliveryId, fence: claim.fence, outcome: 'PREVIEWED' }), { deliveryId: claim.deliveryId, state: 'CANCELLED' });
  const row = await db.collection('cs_outbox').findOne({ _id: claim.deliveryId });
  assert.deepEqual([row.state, row.cancelReason, row.previewedAt], ['CANCELLED', 'BINDING_NOT_ACTIVE_AT_PREVIEW', undefined]);
  // A non-preview service still cannot record PREVIEWED.
  await assert.rejects(cs.recordDeliveryResult({ tenantId: k.t1, deliveryId: claim.deliveryId, fence: claim.fence, outcome: 'PREVIEWED' }), code('DENIED'));
});

test('reader kind/milestones are validated strictly and passed through; metrics ignore bot acknowledgements', async () => {
  const at = () => new Date(clock.now);
  const good = { orderNumber: 'RP-ABC', publicStage: 'DIAGNOSIS', progress: null, source: 'PORTFOLIO_API_OWNED', sourceId: 'opaque', sourceVersion: 3, kind: 'REPAIR', milestones: [{ code: 'RECEIVED', label: 'Received', at: new Date(clock.now - 1000), state: 'DONE' }, { code: 'DIAGNOSIS', label: 'Diagnosis', at: null, state: 'CURRENT' }], confirmedDates: {} };
  let reply = good;
  const cs = make({ orderReader: { readCustomerOrder: async () => reply && { ...reply, asOf: at() } } });
  const { binding } = await cs.createBinding(scope, { plantId: k.p1, accountId: k.account, contactId: k.contact, channel: 'SIMULATED', address: addr(), idempotencyKey: randomUUID() });
  const status = await cs.getOrderStatusForBinding(scope, { plantId: k.p1, bindingId: binding.bindingId, orderNumber: 'RP-ABC' });
  assert.deepEqual([status.kind, status.milestones.map(m => m.state), status.confirmedDates, status.sourceVersion], ['REPAIR', ['DONE', 'CURRENT'], {}, 3]);
  for (const bad of [{ ...good, kind: 'OTHER' }, { ...good, milestones: [{ code: 'x', label: 'bad code', at: null, state: 'DONE' }] }, { ...good, confirmedDates: { promisedShipDate: 'tomorrow' } }, { ...good, kind: undefined }]) {
    reply = bad;
    await assert.rejects(cs.getOrderStatusForBinding(scope, { plantId: k.p1, bindingId: binding.bindingId, orderNumber: 'RP-ABC' }), code('STATUS_UNAVAILABLE'));
  }
  reply = null;
  await assert.rejects(cs.getOrderStatusForBinding(scope, { plantId: k.p1, bindingId: binding.bindingId, orderNumber: 'RP-ABC' }), code('NOT_FOUND'));
  await assert.rejects(cs.getOrderStatusForBinding(scopeB, { plantId: k.p2, bindingId: binding.bindingId, orderNumber: 'RP-ABC' }), code('NOT_FOUND'));
  reply = good;
  const sim = await cs.simulateInbound(scope, { plantId: k.p1, bindingId: binding.bindingId, inboundKey: randomUUID(), text: 'IEMS COMPLAINT' });
  for (const text of ['IEMS COMPLAINT GENERAL', 'IEMS COMPLAINT CATEGORY OTHER', 'IEMS COMPLAINT DESCRIBE Synthetic question']) await cs.simulateInbound(scope, { plantId: k.p1, bindingId: binding.bindingId, inboundKey: randomUUID(), text });
  const confirmed = await cs.simulateInbound(scope, { plantId: k.p1, bindingId: binding.bindingId, inboundKey: randomUUID(), text: 'IEMS COMPLAINT CONFIRM' });
  assert.ok(confirmed.result.receipt.ticketNumber);
  const window = { plantId: k.p1, from: new Date(clock.now - 3600000), to: new Date(clock.now + 60000) };
  const m = await cs.getMetrics(scope, window);
  assert.equal(await db.collection('cs_outbox').countDocuments({ conversationId: sim.conversationId, origin: { $in: ['BOT', 'SYSTEM'] } }) > 0, true);
  assert.deepEqual([m.firstHumanResponse, m.resolution, m.unassigned >= 1, m.open >= 1], [null, null, true, true]);
  await assert.rejects(cs.getMetrics(scope, { ...window, from: new Date(clock.now - 40 * 86400000) }), code('VALIDATION'));
  clock.now += 300 * 60000; // beyond the 240 minute SLA with no human response
  assert.ok((await cs.getMetrics(scope, { ...window, to: new Date(clock.now) })).overdue.count >= 1);
});
