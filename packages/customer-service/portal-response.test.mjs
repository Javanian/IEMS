import test from 'node:test';
import assert from 'node:assert/strict';
import { createVendorResponseService, readVendorPurchaseOrder } from '../../apps/portfolio-api/src/portals.mjs';
import { purchaseHash } from '../contracts/src/domains/commercial/purchase-orders.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = Object.freeze({});
async function fixture() {
  let state = { vendors: [{ _id: id(3), tenantId: id(1), plantId: id(2) }], purchaseOrders: [{
    _id: id(4), tenantId: id(1), plantId: id(2), vendorId: id(3), status: 'ISSUED', version: 1,
    issuedAt: new Date('2026-01-01T00:00:00Z'), issuedBy: id(6), lineIds: [id(5)],
    snapshot: { currency: 'USD', lines: [{ quantity: '1', uom: 'EA' }] },
  }], purchaseOrderDocumentRevisions: [], portal_vendor_responses: [], foundationCommandResults: [], audit: [], outbox: [] };
  let pending, active = false;
  const control = { denied: false, revoked: false, auditFailure: false, checks: 0 };
  const session = { inTransaction: () => active, startTransaction() { pending = structuredClone(state); active = true; },
    async commitTransaction() { state = pending; active = false; }, async abortTransaction() { active = false; }, async endSession() {} };
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const runtime = { client: { startSession: () => session }, foundation: { async authorizeInTransaction(s, target, options) {
    assert.equal(s, scope); assert.equal(options.session, session); assert.equal(target.action, 'portal.vendor.respond'); control.checks++;
    if (control.denied) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
    return { tenantId: id(1), plantId: id(2), userId: id(6), legalEntityId: id(7) };
  } }, db: { collection(name) { return {
    async createIndex() {},
    async findOne(filter, options) { assert.equal(options.session, session); return pending[name]?.find(row => match(row, filter)) ?? null; },
    async findOneAndUpdate(filter, update, options) {
      assert.equal(name, 'portal_party_grants'); assert.equal(filter.partyId, id(3)); assert.equal(filter.userId, id(6));
      assert.equal(filter.actions, 'portal.vendor.respond'); assert.equal(options.session, session);
      return control.revoked ? null : { _id: id(8) };
    },
    find() { const cursor = { sort() { return cursor; }, limit() { return cursor; }, async toArray() { return pending[name]; } }; return cursor; },
    async insertOne(row) {
      if (name === 'audit' && control.auditFailure) throw new Error('AUDIT_UNAVAILABLE');
      if (pending[name].some(item => item._id === row._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      pending[name].push(structuredClone(row));
    },
    async insertMany(rows) { pending[name].push(...structuredClone(rows)); },
  }; } } };
  session.startTransaction();
  const source = await readVendorPurchaseOrder(runtime.db, { tenantId: id(1), plantId: id(2), vendorId: id(3), orderId: id(4), cohort: 'LEGACY' }, session);
  await session.abortTransaction();
  return { service: createVendorResponseService(runtime), control, state: () => state,
    input: { plantId: id(2), vendorId: id(3), orderId: id(4), responseId: id(9), cohort: 'LEGACY', documentRevision: 1,
      sourceHash: source.sourceHash, decision: 'ACCEPT', promises: [{ lineId: id(5), promisedAt: '2026-12-01T00:00:00.000Z' }], commandKey: 'response-1' } };
}
test('response and promise are immutable, source stays unchanged, receipt/audit/outbox atomic', async () => {
  const f = await fixture(), before = structuredClone(f.state().purchaseOrders);
  const first = await f.service.respond(scope, f.input);
  assert.equal(first.revision, 1); assert.equal(f.state().portal_vendor_responses.length, 1);
  assert.deepEqual(f.state().portal_vendor_responses[0].promises, f.input.promises);
  assert.deepEqual(f.state().purchaseOrders, before);
  assert.equal(f.state().audit.length, 1); assert.equal(f.state().outbox.length, 1);
  assert.deepEqual(f.state().outbox[0].data, { responseId: id(9), orderId: id(4), documentRevision: 1 });
  assert.equal((await f.service.respond(scope, f.input)).replayed, true);
  assert.equal(f.state().portal_vendor_responses.length, 1);
  await assert.rejects(f.service.respond(scope, { ...f.input, commandKey: 'new-key' }), { code: 'PORTAL_RESPONSE_EXISTS' });
  await assert.rejects(f.service.respond(scope, { ...f.input, decision: 'DECLINE', promises: [] }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('replay reauthorizes foundation, party grant and source; revoked access cannot retrieve receipt', async () => {
  const f = await fixture(); await f.service.respond(scope, f.input);
  f.control.revoked = true;
  await assert.rejects(f.service.respond(scope, f.input), { code: 'PORTAL_ACCESS_DENIED' });
  f.control.revoked = false; f.control.denied = true;
  await assert.rejects(f.service.respond(scope, f.input), { code: 'FORBIDDEN' });
  f.control.denied = false; f.state().purchaseOrders[0].vendorId = id(99);
  await assert.rejects(f.service.respond(scope, f.input), { code: 'PORTAL_ORDER_NOT_FOUND' });
  assert.equal(f.state().foundationCommandResults.length, 1);
});
test('hash/line mismatch and unissued source fail closed', async () => {
  const f = await fixture();
  for (const patch of [{ sourceHash: 'a'.repeat(64) }, { promises: [{ lineId: id(99), promisedAt: '2026-12-01T00:00:00.000Z' }] }]) {
    await assert.rejects(f.service.respond(scope, { ...f.input, ...patch }), { code: 'PORTAL_SOURCE_MISMATCH' });
  }
  f.state().purchaseOrders[0].status = 'DRAFT';
  await assert.rejects(f.service.respond(scope, f.input), { code: 'PORTAL_ORDER_NOT_FOUND' });
  assert.equal(f.state().portal_vendor_responses.length, 0);
});
test('audit failure rolls back response, receipt and event', async () => {
  const f = await fixture(); f.control.auditFailure = true;
  await assert.rejects(f.service.respond(scope, f.input), /AUDIT_UNAVAILABLE/);
  for (const key of ['portal_vendor_responses', 'foundationCommandResults', 'audit', 'outbox']) assert.equal(f.state()[key].length, 0);
});
test('superseded document rejects new response but authorized historical replay remains readable', async () => {
  const f = await fixture(); await f.service.respond(scope, f.input);
  const state = f.state(), order = state.purchaseOrders[0];
  const original = { schema: 'PURCHASE_ORDER_APPROVED_REVISION_V1', tenantId: id(1), plantId: id(2),
    cohort: 'LEGACY', orderId: id(4), revision: 1, snapshot: structuredClone(order.snapshot), lineIds: [id(5)],
    previousHash: null, approval: {}, reason: 'Original issued purchase order', issuedBy: id(6), issuedAt: order.issuedAt };
  original.contentHash = purchaseHash(original);
  assert.equal(original.contentHash, f.input.sourceHash);
  state.purchaseOrderDocumentRevisions.push(original);
  order.documentRevision = 2;
  assert.equal((await f.service.respond(scope, f.input)).replayed, true);
  await assert.rejects(f.service.respond(scope, { ...f.input, responseId: id(10), commandKey: 'response-2' }), { code: 'PORTAL_DOCUMENT_SUPERSEDED' });
  assert.equal(f.state().portal_vendor_responses.length, 1);
});
test('strict response shape rejects malformed or injected input before authorization', async () => {
  const f = await fixture();
  for (const patch of [{ tenantId: id(1) }, { documentRevision: 0 }, { sourceHash: {} }, { decision: 'SEND' },
    { promises: [{ lineId: id(5), promisedAt: 'tomorrow' }] }, { promises: [...f.input.promises, ...f.input.promises] },
    { decision: 'DECLINE' }, { promises: [{ ...f.input.promises[0], privateBody: 'excluded' }] }]) {
    await assert.rejects(f.service.respond(scope, { ...f.input, ...patch }), { code: 'INVALID_VENDOR_RESPONSE' });
  }
  assert.equal(f.control.checks, 0);
});
