import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderSessionRegistry } from '../src/provider-session.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '22222222-2222-4222-8222-222222222222';
const replyId = '33333333-3333-4333-8333-333333333333';
function fixture() {
  let rows = { provider_sessions: [], provider_deliveries: [] };
  let allowed = true;
  let failInsert = false;
  const session = {};
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const db = { collection: name => ({
    async findOne(filter, options) {
      assert.equal(options.session, session);
      return structuredClone(rows[name].find(row => matches(row, filter)));
    },
    async insertOne(row, options) {
      assert.equal(options.session, session);
      if (failInsert && name === 'provider_deliveries') throw new Error('STORAGE_FAILURE');
      rows[name].push(structuredClone(row));
    },
    async updateOne(filter, update, options) {
      assert.equal(options.session, session);
      const row = rows[name].find(row => matches(row, filter));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] += value;
      return { matchedCount: 1 };
    },
  }) };
  const transaction = async work => {
    const before = structuredClone(rows);
    try { return await work(session); } catch (error) { rows = before; throw error; }
  };
  const registry = createProviderSessionRegistry({ db, transaction, tenantId, accountId: 'synthetic',
    authorizeRegistration: async (input, activeSession) => {
      assert.equal(activeSession, session);
      assert.equal(input.tenantId, tenantId);
      return allowed;
    },
  });
  return { registry, rows: () => rows, deny: () => { allowed = false; }, fail: () => { failInsert = true; } };
}

test('only explicit closed session can be acquired again, with a new generation', async () => {
  const f = fixture();
  const first = await f.registry.acquire('owner:1');
  await assert.rejects(f.registry.acquire('owner:1'), /PROVIDER_SESSION_BUSY/);
  await assert.rejects(f.registry.acquire('owner:2'), /PROVIDER_SESSION_BUSY/);
  await assert.rejects(f.registry.release({ ...first, adapterClosed: false }), /PROVIDER_ADAPTER_NOT_CLOSED/);
  await f.registry.release({ ...first, adapterClosed: true });
  const second = await f.registry.acquire('owner:2');
  assert.equal(second.generation, 2);
  await assert.rejects(f.registry.release({ ...first, adapterClosed: true }), /PROVIDER_SESSION_FENCED/);
  await assert.rejects(f.registry.register({ ...first, deliveryId, replyId }), /PROVIDER_SESSION_FENCED/);
});

test('registration is metadata only and replay reauthorizes without another attempt', async () => {
  const f = fixture();
  const owner = await f.registry.acquire('owner:1');
  const input = { ...owner, deliveryId, replyId };
  assert.equal((await f.registry.register(input)).duplicate, false);
  assert.equal((await f.registry.register(input)).duplicate, true);
  assert.equal(f.rows().provider_sessions[0].registrations, 1);
  assert.equal(f.rows().provider_deliveries.length, 1);
  assert.deepEqual(Object.keys(f.rows().provider_deliveries[0]).sort(),
    ['tenantId', 'accountId', 'ownerId', 'generation', 'deliveryId', 'replyId', 'state', 'revision'].sort());
  f.deny();
  await assert.rejects(f.registry.register(input), /PROVIDER_REGISTRATION_DENIED/);
});

test('a reply cannot get a new delivery ID and a delivery cannot change its reply', async () => {
  const f = fixture();
  const owner = await f.registry.acquire('owner:1');
  await f.registry.register({ ...owner, deliveryId, replyId });
  await assert.rejects(f.registry.register({ ...owner, deliveryId: '44444444-4444-4444-8444-444444444444', replyId }), /PROVIDER_REPLY_ALREADY_REGISTERED/);
  await assert.rejects(f.registry.register({ ...owner, deliveryId, replyId: '55555555-5555-4555-8555-555555555555' }), /PROVIDER_REGISTRATION_CONFLICT/);
  await f.registry.release({ ...owner, adapterClosed: true });
  const next = await f.registry.acquire('owner:2');
  await assert.rejects(f.registry.register({ ...next, deliveryId, replyId }), /PROVIDER_REGISTRATION_CONFLICT/);
});

test('malformed and denied registration leave no delivery', async () => {
  const f = fixture();
  const owner = await f.registry.acquire('owner:1');
  await assert.rejects(f.registry.register({ ...owner, deliveryId: {}, replyId }), /INVALID_DELIVERY_REGISTRATION/);
  f.deny();
  await assert.rejects(f.registry.register({ ...owner, deliveryId, replyId }), /PROVIDER_REGISTRATION_DENIED/);
  assert.equal(f.rows().provider_deliveries.length, 0);
  assert.equal(f.rows().provider_sessions[0].registrations, 0);
});

test('delivery insert failure rolls back the ownership fence write', async () => {
  const f = fixture();
  const owner = await f.registry.acquire('owner:1');
  f.fail();
  await assert.rejects(f.registry.register({ ...owner, deliveryId, replyId }), /STORAGE_FAILURE/);
  assert.equal(f.rows().provider_sessions[0].registrations, 0);
  assert.equal(f.rows().provider_deliveries.length, 0);
});
