import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServiceOrderReader } from './order-source.mjs';
import { createCustomerService } from './index.mjs';
import { serviceOrderFixtures } from './order-fixtures.mjs';

const ids = () => ({ tenantId: randomUUID(), plantId: randomUUID(), customerId: randomUUID() });
function readerFixture({ work = [], shipments = [], lines = [{ quantity: '2', uom: 'EA' }], repair } = {}) {
  const scope = ids(), session = {}, calls = [];
  const order = { _id: randomUUID(), version: 4, createdAt: new Date(), snapshot: { lines } };
  const db = { collection: name => ({
    async findOne(query, options) {
      calls.push({ name, query }); assert.equal(options.session, session);
      assert.equal(query.tenantId, scope.tenantId); assert.equal(query.plantId, scope.plantId);
      if (name === 'accounts') { assert.equal(query._id, scope.customerId); return {}; }
      assert.equal(query[name === 'repairCases' ? 'ownerAccountId' : 'accountId'], scope.customerId);
      return name === 'repairCases' ? repair : order;
    },
    find(query, options) {
      assert.equal(options.session, session); assert.equal(query.accountId, scope.customerId);
      assert.equal(query.salesOrderId, order._id);
      return { sort() { return this; }, limit(n) { assert.equal(n, 501); return this; }, async toArray() { return name === 'manufacturingWorkOrders' ? work : shipments; } };
    },
  }) };
  const reader = createServiceOrderReader({ db, client: { startSession() { throw new Error('nested transaction'); } } });
  return { calls, read: (orderNumber = 'SO-TEST') => reader.readCustomerOrder({ ...scope, orderNumber }, { session }) };
}

test('manufacture source uses caller transaction, current statuses and domain revision', async () => {
  const result = await readerFixture({ work: [{ status: 'QC_COMPLETED', version: 4 }, { status: 'PLANNED', version: 1 }] }).read();
  assert.equal(result.publicStage, 'PLANNING'); assert.equal(result.sourceVersion, 9);
  assert.equal(result.kind, 'MANUFACTURE'); assert.deepEqual(result.confirmedDates, {});
});
test('aggregate revision advances for WO transitions and shipment creation and is stable on replay', async () => {
  const work = [{ status: 'PLANNED', version: 1 }], shipments = [];
  const f = readerFixture({ work, shipments });
  const first = await f.read();
  assert.equal((await f.read()).sourceVersion, first.sourceVersion);
  work[0] = { status: 'QC_COMPLETED', version: 5 };
  const ready = await f.read();
  assert.equal(ready.publicStage, 'READY_TO_SHIP');
  assert.ok(ready.sourceVersion > first.sourceVersion);
  shipments.push({ _id: randomUUID(), lineIndex: 0, quantity: '1', uom: 'EA', status: 'SHIPPED', shippedAt: new Date() });
  const partial = await f.read();
  assert.equal(partial.publicStage, 'PARTIALLY_SHIPPED');
  assert.ok(partial.sourceVersion > ready.sourceVersion);
  assert.equal((await f.read()).sourceVersion, partial.sourceVersion);
  work[0].version = Number.MAX_SAFE_INTEGER;
  await assert.rejects(f.read(), /STATUS_UNAVAILABLE/);
});
test('shipment quantities are compared per line and UOM, never added across units', async () => {
  const lines = [{ quantity: '2', uom: 'EA' }, { quantity: '10', uom: 'KG' }];
  const shipment = { _id: randomUUID(), lineIndex: 0, quantity: '2', uom: 'EA', status: 'SHIPPED', shippedAt: new Date() };
  assert.equal((await readerFixture({ lines, shipments: [shipment] }).read()).publicStage, 'PARTIALLY_SHIPPED');
  await assert.rejects(readerFixture({ lines, shipments: [{ ...shipment, uom: 'KG' }] }).read(), /STATUS_UNAVAILABLE/);
});
test('incomplete source coverage fails closed without an invented stage', async () => {
  await assert.rejects(readerFixture({ work: Array.from({ length: 501 }, () => ({ status: 'PLANNED' })) }).read(), /STATUS_UNAVAILABLE/);
});
test('repair projects public milestones without private diagnostics or dates', async () => {
  const result = await readerFixture({ repair: { _id: randomUUID(), version: 3, status: 'DIAGNOSIS_AUTHORIZED', history: [], privateNotes: 'excluded' } }).read('RP-TEST');
  assert.equal(result.kind, 'REPAIR'); assert.equal(result.publicStage, 'DIAGNOSIS');
  assert.equal(JSON.stringify(result).includes('excluded'), false); assert.deepEqual(result.confirmedDates, {});
});
test('manufacture and repair fixtures persist only public detail and require transactional authority', async () => {
  const scope = ids(), session = { withTransaction: fn => fn(), endSession: async () => {} }, rows = [];
  const service = createCustomerService({ client: { startSession: () => session }, db: { collection: name => ({
    findOne: async (query, options) => { assert.equal(options.session, session); return name === 'saasSubscriptions' ? null : { _id: scope.customerId }; },
    updateOne: async (query, update, options) => {
      assert.equal(name, 'tenants'); assert.equal(query._id, scope.tenantId);
      assert.deepEqual(update, { $inc: { saasEnrollmentFence: 1 } }); assert.equal(options.session, session);
      return { matchedCount: 1 };
    },
    insertOne: async (row, options) => { assert.equal(options.session, session); if (name === 'cs_order_snapshots') rows.push(row); },
  }) }, foundation: { authorize: async () => scope, authorizeInTransaction: async () => scope } });
  for (const fixture of serviceOrderFixtures(scope)) await service.registerSyntheticOrderSnapshot({}, fixture);
  assert.deepEqual(rows.map(r => r.kind), ['MANUFACTURE', 'REPAIR']);
  assert.ok(rows.every(r => r.source === 'SYNTHETIC_FIXTURE_SNAPSHOT' && r.liveLookup === false));
  const bad = serviceOrderFixtures(scope)[0]; bad.milestones.push(bad.milestones[0]);
  await assert.rejects(service.registerSyntheticOrderSnapshot({}, bad), { code: 'INVALID_INPUT' });
  assert.equal(rows.length, 2);
});
