import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCustomerService } from './index.mjs';
import { summarizeServiceMetrics } from './service-metrics.mjs';

const date = minute => new Date(Date.UTC(2026, 0, 1, 0, minute));
const ticket = (id, dataOrigin) => ({ _id: id, createdAt: date(0), assigneeId: null, bindingId: 'same-binding', dataOrigin });
const metrics = input => summarizeServiceMetrics({ open: [ticket('a')], inWindow: [ticket('a')],
  updates: [], replies: [], resolved: [], from: date(0), to: date(60), at: date(60), cap: 10000, slaMinutes: 30, ...input });

test('human metrics exclude unrelated tickets, unlinked replies, queued/failed and future responses', () => {
  const replies = [
    { ticketId: 'b', state: 'SENT', sentAt: date(5) },
    { bindingId: 'same-binding', state: 'SENT', sentAt: date(5) },
    { ticketId: 'a', state: 'QUEUED', sentAt: date(5) },
    { ticketId: 'a', state: 'FAILED', sentAt: date(5) },
    { ticketId: 'a', state: 'SENT', sentAt: date(61) },
  ];
  const m = metrics({ replies });
  assert.equal(m.firstHumanResponse, null); assert.equal(m.overdue.count, 1);
});
test('confirmed preview uses preview time and explicit ticket; public updates and resolution are bounded by observed time', () => {
  const m = metrics({ replies: [{ ticketId: 'a', state: 'PREVIEWED', createdAt: date(1), previewedAt: date(10) }],
    updates: [{ ticketId: 'a', at: date(20) }], resolved: [{ ticketId: 'a', at: date(-1) }, { ticketId: 'a', at: date(40) }] });
  assert.equal(m.firstHumanResponse.p50Minutes, 10); assert.equal(m.resolution.p50Minutes, 40); assert.equal(m.overdue.count, 0);
});
test('historical window never makes current overdue ignore a later observed response', () => {
  const m = metrics({ to: date(15), updates: [{ ticketId: 'a', at: date(20) }] });
  assert.equal(m.firstHumanResponse, null); assert.equal(m.overdue.count, 0);
});
test('coverage truncation suppresses percentiles and provenance separates explicit synthetic, seeded and unknown tickets', () => {
  const inWindow = [ticket('a', 'SYNTHETIC_RUNTIME'), ticket('b', 'SEEDED'), ticket('c')];
  assert.deepEqual(metrics({ inWindow }).provenance, { syntheticRuntime: 1, seeded: 1, unknown: 1 });
  const m = metrics({ cap: 1, updates: [{ ticketId: 'a', at: date(5) }, { ticketId: 'a', at: date(6) }] });
  assert.equal(m.coverage, 'INCOMPLETE'); assert.equal(m.firstHumanResponse, null);
});

function operatorFixture({ foreign = true, denied = false } = {}) {
  const tenantId = randomUUID(), plantId = randomUUID(), userId = randomUUID(), conversationId = randomUUID();
  const session = { withTransaction: fn => fn(), endSession: async () => {} }, calls = [];
  const grant = { tenantId, plantId, userId };
  const cs = createCustomerService({ client: { startSession: () => session }, foundation: {
    authorize: async () => grant, authorizeInTransaction: async (scope, input, opts) => {
      assert.equal(opts.session, session); if (denied) throw Object.assign(new Error('DENIED'), { code: 'DENIED' }); return grant;
    },
  }, db: { collection: name => ({
    async findOne(query, opts) {
      calls.push(name); assert.equal(opts.session, session);
      if (name === 'saasSubscriptions') { assert.deepEqual(query, { tenantId }); return null; }
      if (name === 'cs_idempotency') return null;
      assert.equal(name, 'cs_conversations'); assert.equal(query.tenantId, tenantId); assert.equal(query.plantId, plantId);
      return { _id: conversationId, tenantId, plantId, mode: 'HUMAN_ACTIVE', version: 2, assigneeId: foreign ? randomUUID() : userId };
    },
    async updateOne(query, update, opts) {
      assert.equal(name, 'tenants'); assert.equal(opts.session, session);
      assert.deepEqual(query, { _id: tenantId, active: true });
      assert.deepEqual(update, { $inc: { saasEnrollmentFence: 1 } });
      return { matchedCount: 1 };
    },
    async findOneAndUpdate(query, update, opts) {
      calls.push(name); assert.equal(name, 'cs_conversations'); assert.equal(opts.session, session);
      assert.deepEqual(query, { tenantId, plantId, _id: conversationId });
      assert.deepEqual(update, { $inc: { admissionSourceFence: 1 } });
      assert.equal(opts.returnDocument, 'after');
      return { _id: conversationId, tenantId, plantId, mode: 'HUMAN_ACTIVE', version: 2, assigneeId: foreign ? randomUUID() : userId };
    },
  }) } });
  return { calls, resume: () => cs.setConversationMode({}, { plantId, conversationId, expectedVersion: 2, toMode: 'BOT_ACTIVE', reason: 'Resume after service', commandKey: 'resume-1' }) };
}
test('another agent cannot resume or cancel the assigned human conversation', async () => {
  const f = operatorFixture(); await assert.rejects(f.resume(), { code: 'DENIED' });
  assert.deepEqual(f.calls, ['saasSubscriptions', 'cs_idempotency', 'cs_conversations']);
});
test('transactional authorization denial prevents conversation reads and replay lookup', async () => {
  const f = operatorFixture({ denied: true }); await assert.rejects(f.resume(), { code: 'DENIED' }); assert.deepEqual(f.calls, []);
});
test('metrics source reads are plant-scoped, capped and share transactional authorization', async () => {
  const tenantId = randomUUID(), plantId = randomUUID(), session = { withTransaction: fn => fn(), endSession: async () => {} };
  let authorized = false, reads = 0;
  const cs = createCustomerService({ client: { startSession: () => session }, foundation: {
    authorize: async () => ({ tenantId, plantId }), authorizeInTransaction: async () => { authorized = true; return { tenantId, plantId }; },
  }, db: { collection: name => ({
    async updateOne(query, update, options) {
      assert.ok(authorized); assert.equal(name, 'tenants'); assert.equal(options.session, session);
      assert.deepEqual(query, { _id: tenantId, active: true });
      assert.deepEqual(update, { $inc: { saasEnrollmentFence: 1 } }); return { matchedCount: 1 };
    },
    async findOne(query, options) {
      assert.equal(name, 'saasSubscriptions'); assert.deepEqual(query, { tenantId });
      assert.equal(options.session, session); return null;
    },
    find(query, options) {
    assert.ok(authorized); assert.equal(options.session, session); assert.equal(query.tenantId, tenantId);
    if (name !== 'cs_ticket_events') assert.equal(query.plantId, plantId);
    reads++; return { sort() { return this; }, limit(n) { assert.equal(n, 10001); return this; }, toArray: async () => [] };
  } }) } });
  const m = await cs.getMetrics({}, { plantId, from: date(0), to: date(60) });
  assert.equal(reads, 5); assert.equal(m.coverage, 'COMPLETE'); assert.equal(m.firstHumanResponse, null);
});

test('customer ticket history shares the binding transaction and excludes staff-only fields and notes', async () => {
  const tenantId = randomUUID(), plantId = randomUUID(), customerId = randomUUID();
  const binding = { _id: randomUUID(), tenantId, plantId, customerId, version: 1, status: 'ACTIVE' };
  const session = { withTransaction: fn => fn(), endSession: async () => {} };
  const calls = [];
  const cs = createCustomerService({ client: { startSession: () => session }, foundation: {}, db: { collection: name => {
    calls.push(name); assert.notEqual(name, 'cs_internal_notes');
    return {
      async findOne(query, options) {
        if (name === 'saasSubscriptions') { assert.deepEqual(query, { tenantId }); assert.equal(options.session, session); return null; }
        if (name === 'cs_contact_bindings') return binding;
        assert.equal(options.session, session); assert.equal(query.plantId, plantId); assert.equal(query.customerId, customerId);
        return { _id: randomUUID(), ticketNumber: 'CS-000001', stage: 'NEW', description: 'private-description', internalNote: 'staff-secret' };
      },
      async updateOne(query, update, options) { assert.equal(options.session, session); return { matchedCount: 1 }; },
      find(query, options) {
        assert.equal(query.visibility, 'CUSTOMER'); assert.equal(options.session, session);
        return { sort() { return this; }, toArray: async () => [{ kind: 'PUBLIC_UPDATE', toStage: 'NEW', text: 'Public status', privateMetadata: 'staff-secret', at: date(5) }] };
      },
    };
  } } });
  const principal = await cs.resolveCustomerPrincipal({ tenantId, channelAccountId: 'SIMULATED', providerContactId: 'synthetic-contact' });
  const result = await cs.getTicketForCustomer(principal, { ticketNumber: 'CS-000001' });
  assert.equal(result.updates[0].text, 'Public status');
  assert.equal(JSON.stringify(result).includes('staff-secret'), false);
  assert.equal(JSON.stringify(result).includes('private-description'), false);
  assert.ok(calls.includes('cs_ticket_events'));
});
