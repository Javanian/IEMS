import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateIncreaseOnlyAmendment, applyOrderAmendment, readApprovedOrderRevision } from './purchase-orders.mjs';

const lineId = randomUUID(), extraId = randomUUID();
const original = { currency: 'USD', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', total: '10.00', lines: [{ description: 'Seal', uom: 'EA', quantity: '10', unitPrice: '1.00', currency: 'USD' }] };
const changed = quantity => ({ ...structuredClone(original), total: `${quantity}.00`, lines: [{ ...original.lines[0], quantity }] });
test('without a financial reader, decreases/repricing/retirement fail closed and safe increases preserve identity', () => {
  assert.doesNotThrow(() => validateIncreaseOnlyAmendment(original, changed('11'), [lineId], [lineId]));
  for (const snapshot of [changed('9'), { ...changed('11'), lines: [{ ...original.lines[0], quantity: '11', unitPrice: '2.00' }] }, { ...changed('0'), lines: [{ ...original.lines[0], quantity: '0', retired: true }] }]) assert.throws(() => validateIncreaseOnlyAmendment(original, snapshot, [lineId], [lineId]), /FINANCIAL_COMMITMENT_READER_REQUIRED/);
  assert.throws(() => validateIncreaseOnlyAmendment(original, changed('11'), [lineId], [extraId]), /PO_IDENTITY_IMMUTABLE/);
});
test('separate amendment approval/issue keeps revision1 immutable and verifies the document hash chain', async () => {
  const records = [];
  const db = { collection: () => ({ async findOne(query) { return records.find(record => record.revision === query.revision) || null; }, async insertOne(record) { records.push(structuredClone(record)); }, find(query) { return { sort() { return this; }, limit() { return this; }, async toArray() { return records.filter(record => record.revision <= query.revision.$lte); } }; } }) };
  const scope = { tenantId: randomUUID(), plantId: randomUUID() }, actor = randomUUID();
  const order = { _id: randomUUID(), ...scope, status: 'ISSUED', version: 1, documentRevision: 1, snapshot: structuredClone(original), lineIds: [lineId], requestId: randomUUID(), issuedBy: actor, issuedAt: new Date() };
  const build = async () => ({ snapshot: changed('11'), lineIds: [lineId] }), validate = async () => {};
  const base = { expectedVersion: 1, baseDocumentRevision: 1, reason: 'Additional demand' };
  await applyOrderAmendment(db, scope, 'LEGACY', order, base, actor, 'create', null, build, validate, { inTransaction: () => true });
  assert.equal(order.documentRevision, 1); assert.equal(order.snapshot.total, '10.00');
  const draft = order.amendments[0];
  await assert.rejects(applyOrderAmendment(db, scope, 'LEGACY', order, { ...base, expectedVersion: 2, amendmentHash: draft.amendmentHash }, actor, 'issue', draft.amendmentId, build, validate, { inTransaction: () => true }), /NOT_APPROVED/);
  await applyOrderAmendment(db, scope, 'LEGACY', order, { ...base, expectedVersion: 2, amendmentHash: draft.amendmentHash }, actor, 'approve', draft.amendmentId, build, validate, { inTransaction: () => true });
  await applyOrderAmendment(db, scope, 'LEGACY', order, { ...base, expectedVersion: 3, amendmentHash: draft.amendmentHash }, actor, 'issue', draft.amendmentId, build, validate, { inTransaction: () => true });
  assert.equal(order.documentRevision, 2); assert.equal(order.snapshot.total, '11.00');
  assert.equal((await readApprovedOrderRevision(db, scope, 'LEGACY', order, 1, {})).snapshot.total, '10.00');
  records[0].snapshot.total = '999.00';
  await assert.rejects(readApprovedOrderRevision(db, scope, 'LEGACY', order, 2, {}), /PO_REVISION_INTEGRITY/);
});
