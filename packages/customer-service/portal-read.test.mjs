import test from 'node:test';
import assert from 'node:assert/strict';
import { createVendorPortalReader, installPortals } from '../../apps/portfolio-api/src/portals.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = Object.freeze({ selectedPlantId: id(2) });
const input = { plantId: id(2), vendorId: id(3), orderId: id(4), cohort: 'LEGACY' };
function fixture() {
  const control = { denied: false, missing: false, ended: 0, historyCalls: 0, filters: [] };
  let active = false;
  const session = { inTransaction: () => active, async withTransaction(fn) { active = true; try { return await fn(); } finally { active = false; } }, async endSession() { control.ended++; } };
  const runtime = { client: { startSession: () => session }, foundation: { async authorizeInTransaction(s, target, opts) {
    assert.equal(s, scope); assert.equal(target.action, 'portal.vendor.read'); assert.equal(opts.session, session); assert.ok(active);
    return { tenantId: id(1), plantId: id(2), userId: id(6) };
  } }, db: { collection(name) { return {
    async findOneAndUpdate() { return control.denied ? null : { _id: id(7) }; },
    async findOne(filter, opts) {
      assert.equal(opts.session, session);
      if (name === 'vendors') return { _id: id(3) };
      if (name === 'purchaseOrders' && !control.missing) return { _id: id(4), tenantId: id(1), plantId: id(2), vendorId: id(3), status: 'ISSUED', version: 1,
        issuedAt: new Date('2026-01-01Z'), issuedBy: id(6), lineIds: [id(5)], snapshot: { lines: [{ quantity: '1', uom: 'EA' }] } };
      return null;
    },
    find(filter, opts) {
      assert.equal(opts.session, session);
      if (name === 'portal_vendor_responses') { control.historyCalls++; control.filters.push(filter); }
      let limit;
      const cursor = { sort(sort) { assert.deepEqual(sort, name === 'portal_vendor_responses' ? { _id: 1 } : { revision: 1 }); return cursor; },
        limit(n) { limit = n; return cursor; }, async toArray() {
          if (name !== 'portal_vendor_responses') return [];
          assert.equal(limit, 2);
          return [8, 9].map(n => ({ _id: id(n), orderId: id(4), decision: 'ACCEPT', createdBy: id(6), tenantId: id(1), privateBody: 'excluded', revision: 1 }));
        } };
      return cursor;
    },
  }; } } };
  return { control, runtime, reader: createVendorPortalReader(runtime) };
}
test('history applies source/party authorization and bounded stable pagination with public projection', async () => {
  const f = fixture();
  const page = await f.reader.history(scope, { ...input, limit: 1, after: id(7), documentRevision: 1 });
  assert.equal(page.items.length, 1); assert.equal(page.nextCursor, id(8));
  assert.deepEqual(f.control.filters[0], { tenantId: id(1), plantId: id(2), vendorId: id(3), orderId: id(4), cohort: 'LEGACY', documentRevision: 1, _id: { $gt: id(7) } });
  assert.equal(page.items[0].privateBody, undefined); assert.equal(page.items[0].createdBy, undefined);
  assert.equal(f.control.ended, 1);
});
test('revoked grant or missing source prevents history lookup and always releases session', async () => {
  for (const key of ['denied', 'missing']) {
    const f = fixture(); f.control[key] = true;
    await assert.rejects(f.reader.history(scope, input), { code: key === 'denied' ? 'PORTAL_ACCESS_DENIED' : 'PORTAL_ORDER_NOT_FOUND' });
    assert.equal(f.control.historyCalls, 0); assert.equal(f.control.ended, 1);
  }
});
test('malformed read and injected identity are rejected before session creation', async () => {
  const f = fixture();
  for (const patch of [{ tenantId: id(99) }, { limit: 101 }, { limit: '1' }, { after: {} }, { cohort: ['LEGACY'] }, { documentRevision: 0 }]) {
    await assert.rejects(f.reader.history(scope, { ...input, ...patch }), { code: 'INVALID_PORTAL_READ' });
  }
  assert.equal(f.control.ended, 0);
});
test('HTTP installer uses authenticated scope and rejects identity overrides and malformed query', async () => {
  const f = fixture(), routes = new Map();
  installPortals({ get(path, fn) { routes.set(`GET ${path}`, fn); }, post(path, fn) { routes.set(`POST ${path}`, fn); } }, f.runtime);
  const get = routes.get('GET /api/portals/vendors/:vendorId/orders/:orderId');
  const req = { scope, params: { vendorId: id(3), orderId: id(4) }, query: { cohort: 'LEGACY' } };
  let result; await get(req, { json(value) { result = value; } });
  assert.equal(result.data.orderId, id(4));
  for (const query of [{ ...req.query, tenantId: id(99) }, { ...req.query, documentRevision: '1e2' }, { ...req.query, limit: '1' }]) {
    await assert.rejects(get({ ...req, query }, {}), { status: 400 });
  }
  await assert.rejects(get({ ...req, scope: null }, {}), { code: 'SCOPE_DENIED' });
  const post = routes.get('POST /api/portals/vendors/:vendorId/orders/:orderId/responses');
  await assert.rejects(post({ ...req, query: {}, body: { tenantId: id(99) } }, {}), { code: 'UNKNOWN_FIELD' });
});
