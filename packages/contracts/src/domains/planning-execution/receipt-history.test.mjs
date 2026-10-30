import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReceiptOrigin, legacyReceiptPurchaseSource } from '../../../../../apps/portfolio-api/src/receipt-origin.mjs';
import { archiveInitialOrderRevision, applyOrderAmendment } from '../commercial/purchase-orders.mjs';

const scope = { tenantId: 'tenant', plantId: 'plant' };
const session = { inTransaction: () => true };
function store() {
  const tables = new Map();
  const matches = (row, query) => Object.entries(query).every(([key, value]) => key === '$or'
    ? value.some(clause => matches(row, clause))
    : value && typeof value === 'object' ? '$lte' in value && row[key] <= value.$lte : row[key] === value);
  return { collection(name) {
    if (!tables.has(name)) tables.set(name, []);
    const rows = tables.get(name);
    return {
      async insertOne(row) { rows.push(structuredClone(row)); },
      async findOne(query) { return rows.find(row => matches(row, query)) || null; },
      find(query) {
        let result = rows.filter(row => matches(row, query));
        return { sort(spec) { const key = Object.keys(spec)[0]; result.sort((a, b) => (a[key] - b[key]) * spec[key]); return this; },
          limit(count) { result = result.slice(0, count); return this; }, async toArray() { return structuredClone(result); } };
      }
    };
  } };
}
async function fixture() {
  const db = store(), vendorId = 'vendor', order = { _id: 'order', ...scope, vendorId, version: 1, status: 'ISSUED',
    snapshot: { vendorId, currency: 'USD', lines: [{ description: 'Seal', quantity: '2', unitPrice: '1.00', uom: 'EA' }] } };
  await db.collection('purchaseOrders').insertOne(order);
  await db.collection('vendors').insertOne({ _id: vendorId, ...scope });
  const addReceipt = async (key, pin) => {
    const receipt = { _id: key, ...scope, purchaseOrderId: order._id, vendorId, lineIndex: 0, quantity: '1', uom: 'EA', ...(pin ? { purchaseSource: pin } : {}) };
    await db.collection('warehouseMovements').insertOne({ ...receipt, _id: `movement-${key}`, receiptId: key, kind: 'RECEIVE', from: null, to: 'QUARANTINE' });
    return receipt;
  };
  return { db, order: await db.collection('purchaseOrders').findOne({ _id: order._id }), addReceipt };
}
async function amend(db, order) {
  const original = await archiveInitialOrderRevision(db, scope, 'LEGACY', order, session);
  const build = async () => ({ snapshot: { ...order.snapshot, lines: [{ ...order.snapshot.lines[0], quantity: '3' }] }, lineIds: original.lineIds });
  const input = { expectedVersion: order.version, baseDocumentRevision: 1, reason: 'Increase requirement' };
  await applyOrderAmendment(db, scope, 'LEGACY', order, input, 'actor', 'create', null, build, async () => {}, session);
  const draft = order.amendments[0];
  for (const action of ['approve', 'issue']) await applyOrderAmendment(db, scope, 'LEGACY', order,
    { ...input, expectedVersion: order.version, amendmentHash: draft.amendmentHash }, 'actor', action, draft.amendmentId, build, async () => {}, session);
}

test('unmarked legacy and pinned receipts retain their original PO revision across amendments', async () => {
  const { db, order, addReceipt } = await fixture();
  const old = await addReceipt('old');
  const first = await legacyReceiptPurchaseSource(db, order, 0, 1, session);
  const pinned = await addReceipt('pinned', first.purchaseSource);
  const before = structuredClone(pinned);
  await amend(db, order);
  for (const receipt of [old, pinned]) assert.deepEqual(await classifyReceiptOrigin(db, receipt, session), { cohort: 'LEGACY', legacyEligible: true });
  const second = await legacyReceiptPurchaseSource(db, order, 0, 2, session);
  assert.equal(second.purchaseSource.documentRevision, 2);
  assert.equal(second.purchaseSource.lineId, first.purchaseSource.lineId);
  assert.notEqual(second.purchaseSource.contentHash, first.purchaseSource.contentHash);
  assert.deepEqual(await classifyReceiptOrigin(db, await addReceipt('new', second.purchaseSource), session), { cohort: 'LEGACY', legacyEligible: true });
  assert.deepEqual(pinned, before);
});

test('receipt pin mismatch, wrong scope, broken history and typed markers fail closed', async () => {
  const { db, order, addReceipt } = await fixture();
  const { purchaseSource } = await legacyReceiptPurchaseSource(db, order, 0, 1, session);
  const receipt = await addReceipt('pinned', purchaseSource);
  assert.equal((await classifyReceiptOrigin(db, { ...receipt, purchaseSource: { ...purchaseSource, lineHash: 'tampered' } }, session)).legacyEligible, false);
  assert.equal((await classifyReceiptOrigin(db, { ...receipt, plantId: 'another' }, session)).legacyEligible, false);
  assert.equal((await classifyReceiptOrigin(db, { ...receipt, catalogSource: null }, session)).cohort, 'CATALOG');
  await amend(db, order);
  const revision = await db.collection('purchaseOrderDocumentRevisions').findOne({ revision: 1 });
  revision.snapshot.lines[0].quantity = '999';
  assert.equal((await classifyReceiptOrigin(db, receipt, session)).legacyEligible, false);
});
