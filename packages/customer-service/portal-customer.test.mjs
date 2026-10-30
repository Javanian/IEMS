import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerPortalReader, installPortals } from '../../apps/portfolio-api/src/portals.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = Object.freeze({ selectedPlantId: id(2) });
const input = { plantId: id(2), customerId: id(3), orderNumber: 'SO-001' };
function fixture() {
  const c = { denied: false, missing: false, ended: 0, sourceCalls: 0, work: [], shipments: [],
    row: { _id: id(4), version: 2, snapshot: { lines: [{ quantity: '2.000000', uom: 'EA' }, { quantity: '1', uom: 'KG' }] }, privateBody: 'excluded' } };
  let active = false;
  const session = { inTransaction: () => active, async withTransaction(fn) {
    active = true; try { return await fn(); } finally { active = false; }
  }, async endSession() { c.ended++; } };
  const runtime = { client: { startSession: () => session }, foundation: { async authorizeInTransaction(s, target, opts) {
    assert.equal(s, scope); assert.deepEqual(target, { plantId: id(2), action: 'portal.customer.read' });
    assert.equal(opts.session, session); assert.ok(active);
    return { tenantId: id(1), userId: id(6), plantId: id(2) };
  } }, db: { collection(name) { return {
    async findOneAndUpdate(filter, update, opts) {
      assert.equal(opts.session, session); assert.equal(filter.partyId, id(3));
      assert.equal(filter.kind, 'CUSTOMER'); assert.equal(filter.userId, id(6));
      return c.denied ? null : { _id: id(7) };
    },
    async findOne(filter, opts) {
      assert.ok(active); assert.equal(opts.session, session);
      assert.equal(filter.tenantId, id(1)); assert.equal(filter.plantId, id(2));
      if (name === 'accounts') return { _id: id(3) };
      c.sourceCalls++;
      assert.equal(filter[name === 'repairCases' ? 'ownerAccountId' : 'accountId'], id(3));
      assert.equal(filter[name === 'repairCases' ? 'caseNumber' : 'orderNumber'], name === 'repairCases' ? 'RP-001' : 'SO-001');
      return c.missing ? null : c.row;
    },
    find(filter, opts) {
      assert.ok(active); assert.equal(opts.session, session);
      assert.deepEqual(filter, { tenantId: id(1), plantId: id(2), accountId: id(3), salesOrderId: id(4) });
      const cursor = { sort(value) { assert.deepEqual(value, { _id: 1 }); return cursor; },
        limit(n) { assert.equal(n, 501); return cursor; }, async toArray() { return name === 'manufacturingWorkOrders' ? c.work : c.shipments; } };
      return cursor;
    },
  }; } } };
  return { c, runtime, reader: createCustomerPortalReader(runtime) };
}
const shipment = (n, lineIndex, quantity, uom) => ({ _id: id(n), lineIndex, quantity, uom, status: 'SHIPPED', shippedAt: new Date('2026-01-01Z'), privateBody: 'excluded' });

test('customer reads live scoped status and projects shipment facts without mixing UOM', async () => {
  const f = fixture(); f.c.work = [{ status: 'IN_PROGRESS' }];
  f.c.shipments = [shipment(8, 0, '2', 'EA')];
  const partial = await f.reader.order(scope, input);
  assert.equal(partial.publicStage, 'PARTIALLY_SHIPPED');
  assert.equal(partial.privateBody, undefined); assert.equal(partial.shipments[0].privateBody, undefined);
  f.c.shipments.push(shipment(9, 1, '1', 'KG'));
  assert.equal((await f.reader.order(scope, input)).publicStage, 'SHIPPED');
  assert.equal(f.c.ended, 2);
});
test('denied party and absent cross-customer order fail closed with session cleanup', async () => {
  for (const denied of [true, false]) {
    const f = fixture(); f.c.denied = denied; f.c.missing = !denied;
    await assert.rejects(f.reader.order(scope, input), { code: denied ? 'PORTAL_ACCESS_DENIED' : 'PORTAL_ORDER_NOT_FOUND' });
    assert.equal(f.c.sourceCalls, denied ? 0 : 1); assert.equal(f.c.ended, 1);
  }
});
test('repair status is public and malformed or corrupt sources never imply progress', async () => {
  const f = fixture(); f.c.row.status = 'TEARDOWN';
  const repair = await f.reader.order(scope, { ...input, orderNumber: 'RP-001' });
  assert.equal(repair.publicStage, 'DIAGNOSIS'); assert.deepEqual(repair.confirmedDates, {});
  f.c.row.status = 'NEW_UNKNOWN';
  await assert.rejects(f.reader.order(scope, { ...input, orderNumber: 'RP-001' }), { code: 'PORTAL_SOURCE_INVALID' });
  for (const patch of [{ tenantId: id(99) }, { orderNumber: [] }, { orderNumber: 'SECRET-001' }]) {
    await assert.rejects(f.reader.order(scope, { ...input, ...patch }), { code: 'INVALID_PORTAL_READ' });
  }
  f.c.shipments = [shipment(8, 0, '2', 'KG')];
  await assert.rejects(f.reader.order(scope, input), { code: 'PORTAL_SOURCE_INVALID' });
});
test('bounded collection reports incomplete coverage instead of a fabricated aggregate', async () => {
  const f = fixture(); f.c.work = Array.from({ length: 501 }, () => ({ status: 'QC_COMPLETED' }));
  const result = await f.reader.order(scope, input);
  assert.equal(result.coverage, 'INCOMPLETE'); assert.equal(result.publicStage, null);
});
test('customer HTTP route derives plant from authenticated scope and denies query overrides', async () => {
  const f = fixture(), routes = new Map();
  installPortals({ get(path, fn) { routes.set(path, fn); }, post() {} }, f.runtime);
  const handler = routes.get('/api/portals/customers/:customerId/orders/:orderNumber');
  const req = { scope, params: { customerId: id(3), orderNumber: 'SO-001' }, query: {} };
  let result; await handler(req, { json(value) { result = value; } });
  assert.equal(result.data.orderNumber, 'SO-001');
  await assert.rejects(handler({ ...req, query: { plantId: id(99) } }, {}), { code: 'UNKNOWN_FIELD' });
  await assert.rejects(handler({ ...req, scope: null }, {}), { code: 'SCOPE_DENIED' });
});
