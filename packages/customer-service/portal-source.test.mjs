import test from 'node:test';
import assert from 'node:assert/strict';
import { readVendorPurchaseOrder } from '../../apps/portfolio-api/src/portals.mjs';
import { purchaseHash } from '../contracts/src/domains/commercial/purchase-orders.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { tenantId: id(1), plantId: id(2), vendorId: id(3), orderId: id(4), cohort: 'LEGACY' };
const session = { inTransaction: () => true };
const snapshot = {
  currency: 'USD', total: '12345678901234567890.12', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP',
  internalNotes: 'not public', margin: 'do not expose',
  lines: [{ description: 'Pump', quantity: '1.123456', uom: 'EA', currency: 'USD', unitPrice: '12.34', internalCost: '10.00' }],
};
function database({ row = {}, revisions = [], vendor = true } = {}) {
  const calls = [];
  const order = { _id: input.orderId, tenantId: input.tenantId, plantId: input.plantId, vendorId: input.vendorId, lineIds: [id(5)], snapshot: structuredClone(snapshot), version: 4, status: 'ISSUED', issuedAt: new Date('2026-01-01T00:00:00Z'), issuedBy: id(6), ...row };
  const db = { collection(name) {
    return {
      async findOne(filter, opts) {
        assert.equal(opts.session, session);
        calls.push({ name, filter });
        if (name === 'vendors') return vendor ? { _id: input.vendorId } : null;
        if (name !== 'purchaseOrders') return null;
        return Object.entries(filter).every(([key, value]) => order[key] === value) ? structuredClone(order) : null;
      },
      find(filter, opts) {
        assert.equal(name, 'purchaseOrderDocumentRevisions');
        assert.equal(opts.session, session);
        assert.equal(filter.cohort, 'LEGACY');
        const cursor = { sort() { return cursor; }, limit() { return cursor; }, async toArray() { return revisions.filter(r => r.revision <= filter.revision.$lte); } };
        return cursor;
      },
    };
  } };
  return { db, calls, order };
}

test('vendor projection preserves decimal strings and excludes private source fields', async () => {
  const { db, calls } = database();
  const result = await readVendorPurchaseOrder(db, input, session);
  assert.equal(result.total, snapshot.total);
  assert.equal(result.lines[0].quantity, '1.123456');
  assert.equal(result.lines[0].lineId, id(5));
  assert.equal(result.currency, 'USD');
  assert.equal(result.documentRevision, 1);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.internalNotes, undefined);
  assert.equal(result.margin, undefined);
  assert.equal(result.lines[0].internalCost, undefined);
  assert.deepEqual(calls[0].filter, { tenantId: input.tenantId, plantId: input.plantId, _id: input.orderId, vendorId: input.vendorId });
});

test('wrong vendor, tenant, plant and missing vendor produce the same absent result', async () => {
  for (const field of ['vendorId', 'tenantId', 'plantId']) {
    const { db } = database();
    assert.equal(await readVendorPurchaseOrder(db, { ...input, [field]: id(99) }, session), null);
  }
  assert.equal(await readVendorPurchaseOrder(database({ vendor: false }).db, input, session), null);
});

test('catalog cohort cannot fall back to a matching legacy order', async () => {
  const { db, calls } = database();
  assert.equal(await readVendorPurchaseOrder(db, { ...input, cohort: 'CATALOG' }, session), null);
  assert.deepEqual(calls.map(call => call.name), ['catalogPurchaseOrders']);
  assert.equal(calls[0].filter['content.vendorId'], input.vendorId);
});

test('draft orders are not visible', async () => {
  assert.equal(await readVendorPurchaseOrder(database({ row: { status: 'DRAFT' } }).db, input, session), null);
});

test('caller transaction and strict identifiers, cohort and revision are mandatory', async () => {
  await assert.rejects(readVendorPurchaseOrder(database().db, input, null), /ACTIVE_CALLER_TRANSACTION_REQUIRED/);
  for (const patch of [{ cohort: 'AUTO' }, { vendorId: { $ne: null } }, { orderId: 'not-uuid' }, { documentRevision: '1' }, { documentRevision: 0 }]) {
    await assert.rejects(readVendorPurchaseOrder(database().db, { ...input, ...patch }, session), { code: 'INVALID_PORTAL_SOURCE' });
  }
});

test('historical revision is returned with original lines and current revision separately', async () => {
  const revision = { schema: 'PURCHASE_ORDER_APPROVED_REVISION_V1', tenantId: input.tenantId, plantId: input.plantId, cohort: 'LEGACY', orderId: input.orderId, revision: 1, snapshot: structuredClone(snapshot), lineIds: [id(5)], previousHash: null, approval: {}, reason: 'Original issued purchase order', issuedBy: id(6), issuedAt: new Date('2026-01-01T00:00:00Z') };
  revision.contentHash = purchaseHash(revision);
  const { db } = database({ row: { documentRevision: 2, snapshot: { ...snapshot, total: '999.00' } }, revisions: [revision] });
  const result = await readVendorPurchaseOrder(db, { ...input, documentRevision: 1 }, session);
  assert.equal(result.documentRevision, 1);
  assert.equal(result.currentDocumentRevision, 2);
  assert.equal(result.total, snapshot.total);
  assert.equal(result.sourceHash, revision.contentHash);
  revision.snapshot.total = '888.00';
  await assert.rejects(readVendorPurchaseOrder(db, { ...input, documentRevision: 1 }, session), { code: 'PO_REVISION_INTEGRITY' });
});

test('missing or future document revision cannot invent an approved snapshot', async () => {
  await assert.rejects(readVendorPurchaseOrder(database().db, { ...input, documentRevision: 2 }, session), { code: 'SOURCE_NOT_ISSUED' });
  await assert.rejects(readVendorPurchaseOrder(database({ row: { documentRevision: 2 } }).db, input, session), { code: 'PO_REVISION_INTEGRITY' });
});

test('duplicate stable line IDs fail closed', async () => {
  const row = { lineIds: [id(5), id(5)], snapshot: { ...snapshot, lines: [snapshot.lines[0], snapshot.lines[0]] } };
  await assert.rejects(readVendorPurchaseOrder(database({ row }).db, input, session), { code: 'PORTAL_SOURCE_INVALID' });
});
