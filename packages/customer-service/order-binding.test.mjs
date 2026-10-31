import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCustomerService } from './index.mjs';

function fixture({ denied = false, fence = 1, foreignPlant = false, reader } = {}) {
  const tenantId = randomUUID(), plantId = randomUUID(), customerId = randomUUID(), bindingId = randomUUID();
  const binding = { _id: bindingId, tenantId, plantId, customerId, version: 2 };
  const snapshot = { ...binding, plantId: foreignPlant ? randomUUID() : plantId, orderNumber: 'RP-TEST', publicStage: 'DIAGNOSIS', source: 'SYNTHETIC_FIXTURE_SNAPSHOT', progress: null, asOf: new Date() };
  const session = { withTransaction: async fn => fn(), endSession: async () => {} };
  const calls = [];
  const db = { collection: name => ({
    async findOne(query, options) {
      calls.push({ name, query, options });
      assert.equal(options.session, session);
      if (name === 'cs_contact_bindings') return binding;
      assert.equal(name, 'cs_order_snapshots');
      return Object.entries(query).every(([k, v]) => snapshot[k] === v) ? snapshot : null;
    },
    async updateOne(query, update, options) {
      assert.equal(name, 'cs_contact_bindings');
      assert.equal(options.session, session);
      assert.deepEqual([query.tenantId, query.plantId, query.version], [tenantId, plantId, 2]);
      assert.deepEqual(update, { $inc: { commandFence: 1 } });
      calls.push({ fence: true });
      return { matchedCount: fence };
    }
  }) };
  const foundation = {
    authorize: async () => ({ tenantId, plantId }),
    async authorizeInTransaction(scope, request, options) {
      assert.equal(options.session, session);
      assert.equal(request.action, 'cs.ticket.read');
      if (denied) throw Object.assign(new Error('DENIED'), { code: 'DENIED' });
      return { tenantId, plantId };
    }
  };
  const cs = createCustomerService({ client: { startSession: () => session }, db, foundation, allowSyntheticOrders: true,
    ...(reader ? { orderReader: { readCustomerOrder: reader } } : {}) });
  return { read: () => cs.getOrderStatusForBinding({}, { plantId, bindingId, orderNumber: 'RP-TEST' }), calls };
}

test('synthetic repair status uses plant/customer scope and fences the authorized binding', async () => {
  const f = fixture();
  assert.equal((await f.read()).publicStage, 'DIAGNOSIS');
  assert.ok(f.calls.at(-1).fence);
});

test('another plant snapshot is not visible', async () => {
  await assert.rejects(fixture({ foreignPlant: true }).read(), { code: 'NOT_FOUND' });
});

test('transactional authorization denial prevents all source reads', async () => {
  const f = fixture({ denied: true });
  await assert.rejects(f.read(), { code: 'DENIED' });
  assert.equal(f.calls.length, 0);
});

test('binding revocation fence rejects status instead of releasing source data', async () => {
  await assert.rejects(fixture({ fence: 0 }).read(), { code: 'NOT_FOUND' });
});

test('failed authoritative source never falls back to synthetic data', async () => {
  const f = fixture({ reader: async () => { throw new Error('offline'); } });
  await assert.rejects(f.read(), { code: 'STATUS_UNAVAILABLE' });
  assert.equal(f.calls.some(c => c.name === 'cs_order_snapshots'), false);
});
