import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createProviderReconciler } from '../src/provider-reconciliation.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '22222222-2222-4222-8222-222222222222';
const accountId = 'synthetic-account';
const secret = Buffer.alloc(32, 9);
const time = 1793385000000;
function fixture({ failInsert = false, mismatch = false } = {}) {
  let rows = { provider_callback_events: [], provider_deliveries: [{ tenantId, accountId, deliveryId, state: 'UNKNOWN', revision: 1 }] };
  const session = {};
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const db = { collection: name => ({
    async findOne(filter, options) { assert.equal(options.session, session); return structuredClone(rows[name].find(row => matches(row, filter))); },
    async updateOne(filter, update, options) {
      assert.equal(options.session, session);
      const row = rows[name].find(row => matches(row, filter));
      if (!row || mismatch) return { matchedCount: 0 };
      Object.assign(row, update.$set); row.revision += update.$inc.revision;
      return { matchedCount: 1 };
    },
    async insertOne(row, options) {
      assert.equal(options.session, session);
      if (failInsert) throw new Error('SYNTHETIC_STORAGE_FAILURE');
      rows[name].push(structuredClone(row));
    },
  }) };
  const transaction = async work => {
    const before = structuredClone(rows);
    try { return await work(session); } catch (error) { rows = before; throw error; }
  };
  const reconcile = createProviderReconciler({ db, transaction, tenantId, accountId, secret, now: () => time });
  function send(overrides = {}) {
    const rawBody = Buffer.from(JSON.stringify({ version: 1, tenantId, accountId, eventId: 'event:1', deliveryId, providerMessageId: 'provider:1', status: 'DELIVERED', ...overrides }));
    const timestamp = String(time);
    return reconcile({ rawBody, timestamp, signature: createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex') });
  }
  return { send, rows: () => rows };
}

test('UNKNOWN reconciles without sending; exact replay is durable and terminal state never regresses', async () => {
  const f = fixture();
  assert.deepEqual(await f.send(), { deliveryId, state: 'DELIVERED', duplicate: false });
  assert.equal((await f.send()).duplicate, true);
  assert.equal((await f.send({ eventId: 'event:2', status: 'ACCEPTED' })).state, 'DELIVERED');
  assert.equal(f.rows().provider_callback_events.length, 2);
  assert.equal(f.rows().provider_deliveries[0].revision, 3);
  assert.equal(Object.hasOwn(f.rows().provider_callback_events[0], 'rawBody'), false);
});

test('rejects event collisions, different provider IDs and conflicting terminal receipts', async () => {
  const f = fixture();
  await f.send();
  await assert.rejects(f.send({ status: 'ACCEPTED' }), /PROVIDER_EVENT_CONFLICT/);
  await assert.rejects(f.send({ providerMessageId: 'other' }), /PROVIDER_MESSAGE_CONFLICT/);
  await assert.rejects(f.send({ eventId: 'event:2', status: 'FAILED' }), /PROVIDER_TERMINAL_CONFLICT/);
  assert.equal(f.rows().provider_callback_events.length, 1);
});

test('unknown delivery and authenticated cross-account callbacks cannot consume an event', async () => {
  const f = fixture();
  await assert.rejects(f.send({ deliveryId: '33333333-3333-4333-8333-333333333333' }), /UNREGISTERED_PROVIDER_DELIVERY/);
  await assert.rejects(f.send({ accountId: 'other' }), /INVALID_PROVIDER_CALLBACK/);
  assert.equal(f.rows().provider_callback_events.length, 0);
});

test('storage failure rolls back delivery and CAS failure cannot consume an event', async () => {
  for (const config of [{ failInsert: true }, { mismatch: true }]) {
    const f = fixture(config);
    await assert.rejects(f.send(), /SYNTHETIC_STORAGE_FAILURE|PROVIDER_DELIVERY_CONFLICT/);
    assert.equal(f.rows().provider_deliveries[0].state, 'UNKNOWN');
    assert.equal(f.rows().provider_deliveries[0].revision, 1);
    assert.equal(f.rows().provider_callback_events.length, 0);
  }
});
