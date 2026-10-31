import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readVendorPurchaseOrder } from '../../apps/portfolio-api/src/portals.mjs';
import { createApprovedOrderDocumentSource } from './issued-documents.mjs';

test('approved PO extraction preserves original hash/decimal facts and requires current business permission', async () => {
  const grant = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId', 'userId'].map(k => [k, randomUUID()]));
  const orderId = randomUUID(), vendorId = randomUUID(), session = { inTransaction: () => true }, scope = {};
  let denied = false, fenced = 0;
  const order = { _id: orderId, ...grant, vendorId, status: 'ISSUED', version: 8, documentRevision: 1,
    issuedAt: new Date('2026-01-01T00:00:00Z'), issuedBy: grant.userId, lineIds: [randomUUID()],
    snapshot: { currency: 'USD', lines: [{ description: 'Part', quantity: '1.50', uom: 'EA', unitPrice: '12.00' }] } };
  const runtime = { foundation: { async authorizeInTransaction(s, target, opts) {
    assert.equal(s, scope); assert.equal(opts.session, session); assert.equal(target.action, 'ai.vendor.source.read');
    if (denied) throw Object.assign(new Error('DENIED'), { status: 403 }); return grant;
  } }, db: { collection(name) { return {
    async findOne(filter) { assert.equal(filter.tenantId, grant.tenantId); assert.equal(filter.plantId, grant.plantId);
      return name === 'purchaseOrders' ? (filter.vendorId === vendorId ? order : null) : name === 'vendors' ? { _id: vendorId } : null; },
    async updateOne() { fenced++; throw new Error('AI_MUST_NOT_WRITE_PO'); },
    find() { return { sort() { return this; }, limit() { return this; }, async toArray() { return []; } }; },
  }; } } };
  const source = await readVendorPurchaseOrder(runtime.db, { ...grant, cohort: 'LEGACY', vendorId, orderId }, session);
  const reference = { cohort: 'LEGACY', vendorId, orderId, documentRevision: 1, sourceHash: source.sourceHash };
  const reader = createApprovedOrderDocumentSource(runtime), args = { scope, grant, reference, session };
  const result = await reader.readAuthorized(args);
  assert.ok(result.text.includes('"quantity":"1.50"')); assert.ok(result.text.includes(source.sourceHash)); assert.equal(fenced, 0);
  await assert.rejects(reader.readAuthorized({ ...args, reference: { ...reference, sourceHash: 'a'.repeat(64) } }), { code: 'AI_ISSUED_SOURCE_SUPERSEDED' });
  denied = true; await assert.rejects(reader.readAuthorized(args), { status: 403 });
  await assert.rejects(reader.readAuthorized({ ...args, scope: null }), { code: 'AI_ISSUED_SOURCE_SCOPE_REQUIRED' });
});
