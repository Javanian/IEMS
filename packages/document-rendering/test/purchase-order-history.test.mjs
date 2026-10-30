import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogReceiptOrigin } from '../../../apps/portfolio-api/src/catalog-procurement.mjs';
import { purchaseHash as hash, archiveInitialOrderRevision, applyOrderAmendment, readApprovedOrderRevision } from '../../contracts/src/domains/commercial/purchase-orders.mjs';
import { createSnapshot, renderPdf } from '../src/index.mjs';

const uuid = n => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const get = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);
function matches(row, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(option => matches(row, option));
    const value = get(row, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$in' in expected) return expected.$in.includes(value);
      if ('$lte' in expected) return value <= expected.$lte;
      if ('$ne' in expected) return value !== expected.$ne;
      throw new Error(`Unsupported fixture query: ${key}`);
    }
    return value === expected;
  });
}
function fixtureStore() {
  const rows = new Map();
  return { collection(name) {
    if (!rows.has(name)) rows.set(name, []);
    return {
      async findOne(query) { return structuredClone(rows.get(name).find(row => matches(row, query)) || null); },
      async insertOne(row) { rows.get(name).push(structuredClone(row)); },
      find(query) {
        let result = rows.get(name).filter(row => matches(row, query));
        return { sort(spec) { const key = Object.keys(spec)[0]; result.sort((a, b) => (a[key] - b[key]) * spec[key]); return this; }, limit(count) { result = result.slice(0, count); return this; }, async toArray() { return structuredClone(result); } };
      }
    };
  } };
}
test('historical V1 receipt and original PDF remain valid after an approved catalog amendment and document fence', async () => {
  const db = fixtureStore(), scope = { tenantId: uuid(1), plantId: uuid(2) }, owner = uuid(3), actor = uuid(4), at = new Date('2026-10-30T00:00:00.000Z');
  const session = { inTransaction: () => true };
  const revision = (subjectId, content, number, id) => {
    const row = { _id: id, ...scope, ownerLegalEntityId: owner, subjectId, revision: number, content: structuredClone(content), reason: 'Synthetic history fixture', recordedBy: actor, recordedAt: at };
    return { ...row, contentHash: hash(row) };
  };
  const itemContent = { schema: 'INVENTORY_ITEM_V2', kind: 'PURCHASED', trackingPolicy: 'LOT', description: 'Historical seal', uom: 'EA' };
  const itemRevision = revision(uuid(10), itemContent, 1, uuid(11)); await db.collection('inventoryItemRevisions').insertOne(itemRevision);
  const proof = { version: 2, status: 'APPROVED', code: 'SEAL', ownerLegalEntityId: owner, currentRevision: 1, contentHash: itemRevision.contentHash, content: itemContent, approval: { revision: 1, contentHash: itemRevision.contentHash } };
  await db.collection('internalPlanningEvents').insertOne({ _id: uuid(12), ...scope, subjectType: 'ITEM', subjectId: uuid(10), version: 2, status: 'APPROVED', snapshot: proof, contentHash: hash(proof) });
  await db.collection('vendors').insertOne({ _id: uuid(20), ...scope });
  const line = { lineId: uuid(30), itemId: uuid(10), itemVersion: 2, itemRevision: 1, itemContentHash: itemRevision.contentHash, itemCode: 'SEAL', description: itemContent.description, uom: 'EA', kind: 'PURCHASED', itemSchema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT', ownerLegalEntityId: owner, quantity: '10', unitPrice: '1.00', currency: 'USD', lineTotal: '10.00' };
  const content = { vendorId: uuid(20), lines: [line], currency: 'USD', total: '10.00', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP' };
  const prRevision = revision(uuid(40), content, 1, uuid(41)); await db.collection('catalogRequestRevisions').insertOne(prRevision);
  const pr = { _id: uuid(40), ...scope, ownerLegalEntityId: owner, schema: 'CATALOG_PURCHASE_V1', version: 3, currentRevision: 1, status: 'CONVERTED', content, contentHash: prRevision.contentHash, approval: { revision: 1, contentHash: prRevision.contentHash }, orderId: uuid(50) };
  async function publish(type, row, eventId) {
    const snapshot = Object.fromEntries(Object.entries(row).filter(([key]) => !['useFence', 'documentFence', 'eventId', 'authorityHash'].includes(key)));
    const event = { _id: eventId, ...scope, subjectType: type, subjectId: row._id, version: row.version, status: row.status, snapshot, contentHash: hash(snapshot) };
    await db.collection('catalogEvents').insertOne(event); row.eventId = eventId; row.authorityHash = event.contentHash;
  }
  await publish('REQUEST', pr, uuid(42)); await db.collection('catalogPurchaseRequests').insertOne(pr);
  const orderRevision = revision(uuid(50), content, 1, uuid(51)); await db.collection('catalogOrderRevisions').insertOne(orderRevision);
  const order = { _id: uuid(50), ...scope, ownerLegalEntityId: owner, schema: 'CATALOG_PURCHASE_V1', version: 2, currentRevision: 1, status: 'ISSUED', requestId: pr._id, requestRevision: 1, requestContentHash: pr.contentHash, content: structuredClone(content), contentHash: orderRevision.contentHash, issuedBy: actor, issuedAt: at };
  const first = await archiveInitialOrderRevision(db, scope, 'CATALOG', order, session);
  const pdfScope = { ...scope, legalEntityId: owner };
  const pdfSource = approved => createSnapshot('catalogPurchaseOrder', pdfScope, { _id: order._id, ...pdfScope, version: approved.revision, snapshot: approved.snapshot });
  const originalPdf = await renderPdf(pdfSource(first));
  const proposed = { ...structuredClone(content), total: '11.00', lines: [{ ...line, quantity: '11', lineTotal: '11.00' }] };
  const build = async () => ({ snapshot: proposed, lineIds: [line.lineId] });
  const base = { expectedVersion: 2, baseDocumentRevision: 1, reason: 'Additional synthetic requirement' };
  await applyOrderAmendment(db, scope, 'CATALOG', order, base, actor, 'create', null, build, async () => {}, session);
  const amendment = order.amendments[0];
  await applyOrderAmendment(db, scope, 'CATALOG', order, { ...base, expectedVersion: 3, amendmentHash: amendment.amendmentHash }, actor, 'approve', amendment.amendmentId, build, async () => {}, session);
  await applyOrderAmendment(db, scope, 'CATALOG', order, { ...base, expectedVersion: 4, amendmentHash: amendment.amendmentHash }, actor, 'issue', amendment.amendmentId, build, async () => {}, session);
  const nextRevision = revision(order._id, order.content, 2, uuid(52)); order.contentHash = nextRevision.contentHash; await db.collection('catalogOrderRevisions').insertOne(nextRevision);
  await publish('ORDER', order, uuid(53)); order.documentFence = 9; await db.collection('catalogPurchaseOrders').insertOne(order);
  const source = { schema: 'CATALOG_RECEIPT_V1', purchaseOrderId: order._id, purchaseOrderRevision: 1, purchaseOrderLineId: line.lineId, purchaseOrderLineHash: hash(line), itemId: line.itemId, itemRevision: 1, itemContentHash: line.itemContentHash, itemVersion: 2, ownerLegalEntityId: owner, uom: 'EA', trackingPolicy: 'LOT' };
  const physical = { purchaseOrderId: order._id, vendorId: uuid(20), lineIndex: 0, quantity: '1', uom: 'EA', serials: [], lotNumber: 'LOT-1', heatNumber: 'HEAT-1' };
  const receipt = { _id: uuid(60), ...scope, ...physical, version: 1, status: 'QUARANTINED', availableQuantity: '0', reservedQuantity: '0', catalogSource: source, createdBy: actor, createdAt: at };
  const originBody = { _id: uuid(61), ...scope, receiptId: receipt._id, originType: 'CATALOG_PURCHASE', schema: 'CATALOG_RECEIPT_ORIGIN_V1', source, physical, receiveMovementId: uuid(62), recordedBy: actor, recordedAt: at }, origin = { ...originBody, contentHash: hash(originBody) };
  await db.collection('warehouseMovements').insertOne({ _id: uuid(62), ...scope, version: 1, receiptId: receipt._id, purchaseOrderId: order._id, vendorId: uuid(20), lineIndex: 0, quantity: '1', uom: 'EA', kind: 'RECEIVE', from: null, to: 'QUARANTINE', catalogSource: source, createdBy: actor, createdAt: at, materialTrace: { receiptId: receipt._id, lotNumber: 'LOT-1', heatNumber: 'HEAT-1' } });
  const originalOriginHash = origin.contentHash;
  assert.equal((await validateCatalogReceiptOrigin(db, receipt, origin, session)).contentHash, originalOriginHash);
  const second = await readApprovedOrderRevision(db, scope, 'CATALOG', order, 2, session);
  const source2 = { ...source, schema: 'CATALOG_RECEIPT_V2', purchaseOrderRevision: 2, purchaseOrderLineHash: hash(order.content.lines[0]), approvedRevisionContentHash: second.contentHash };
  const physical2 = { ...physical, quantity: '2', lotNumber: 'LOT-2', heatNumber: 'HEAT-2' };
  const receipt2 = { ...receipt, ...physical2, _id: uuid(70), catalogSource: source2 };
  const body2 = { ...originBody, _id: uuid(71), receiptId: receipt2._id, schema: 'CATALOG_RECEIPT_ORIGIN_V2', source: source2, physical: physical2, receiveMovementId: uuid(72) }, origin2 = { ...body2, contentHash: hash(body2) };
  await db.collection('warehouseMovements').insertOne({ _id: uuid(72), ...scope, version: 1, receiptId: receipt2._id, purchaseOrderId: order._id, vendorId: uuid(20), lineIndex: 0, quantity: '2', uom: 'EA', kind: 'RECEIVE', from: null, to: 'QUARANTINE', catalogSource: source2, createdBy: actor, createdAt: at, materialTrace: { receiptId: receipt2._id, lotNumber: 'LOT-2', heatNumber: 'HEAT-2' } });
  assert.equal((await validateCatalogReceiptOrigin(db, receipt2, origin2, session)).source.purchaseOrderRevision, 2);
  assert.deepEqual(await renderPdf(pdfSource(await readApprovedOrderRevision(db, scope, 'CATALOG', order, 1, session))), originalPdf);
  assert.equal(order.documentRevision, 2); assert.equal(origin.source.purchaseOrderRevision, 1);
});
