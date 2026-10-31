import { stockHash as hash, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';

const fail = code => { throw Object.assign(new Error(code), { status: 409, code }); };

// A customer invoice is not supplier invoicing authority. Unknown I must never become zero.
export async function readProcurementCommitments({ db, session, scope, purchaseOrderId, lineId }) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const filter = { tenantId: scope.tenantId, plantId: scope.plantId ?? scope.selectedPlantId };
  const options = { session }, catalog = await db.collection('catalogPurchaseOrders').findOne({ ...filter, _id: purchaseOrderId }, options);
  const legacy = await db.collection('purchaseOrders').findOne({ ...filter, _id: purchaseOrderId }, options);
  if (catalog && legacy) fail('PURCHASE_ORDER_AUTHORITY_CONFLICT');
  const order = catalog || legacy;
  if (!order) fail('PURCHASE_ORDER_NOT_FOUND');
  const { readApprovedOrderRevision } = await import('../../../packages/contracts/src/domains/commercial/purchase-orders.mjs');
  const revision = await readApprovedOrderRevision(db, filter, catalog ? 'CATALOG' : 'LEGACY', order, order.documentRevision ?? 1, session);
  const lines = revision.snapshot.lines, index = catalog ? lines.findIndex(line => line.lineId === lineId) : revision.lineIds.indexOf(lineId), line = lines[index];
  if (!line || !line.uom) fail('PURCHASE_ORDER_LINE_NOT_FOUND');
  const receipts = await db.collection('warehouseReceipts').find({ ...filter, purchaseOrderId, lineIndex: index }, options).limit(101).toArray();
  if (receipts.length > 100) fail('COMMITMENT_HISTORY_LIMIT');
  const evidence = []; let received = 0n;
  for (const receipt of receipts) {
    if (catalog) {
      const { validateCatalogReceiptOrigin } = await import('./catalog-procurement.mjs');
      const origin = await db.collection('warehouseReceiptOrigins').findOne({ ...filter, receiptId: receipt._id }, options);
      await validateCatalogReceiptOrigin(db, receipt, origin, session);
      evidence.push({ receiptId: receipt._id, receiptVersion: receipt.version, originHash: origin.contentHash, purchaseOrderRevision: origin.source.purchaseOrderRevision });
    } else {
      const { requireLegacyReceipt } = await import('./receipt-origin.mjs');
      await requireLegacyReceipt(db, receipt, session);
      evidence.push({ receiptId: receipt._id, receiptVersion: receipt.version, purchaseSource: receipt.purchaseSource ?? null });
    }
    if (receipt.uom !== line.uom) fail('COMMITMENT_UOM_CONFLICT');
    received += units(receipt.quantity);
  }
  return {
    supported: false, status: 'UNSUPPORTED', code: 'SUPPLIER_INVOICE_AUTHORITY_UNAVAILABLE',
    purchaseOrderId, lineId, uom: line.uom, observedReceivedQuantity: decimal(received), receivedQuantity: null, committedQuantity: null, invoicedQuantity: null,
    sourceRevision: revision.revision, sourceHash: revision.contentHash, evidence, evidenceHash: hash(evidence),
    completeness: { received: false, committed: false, invoiced: false },
    requiredFences: ['purchase-order-head', 'receiving-tally-for-stable-line', 'receipt-and-canonical-stock-use-heads', 'supplier-invoicing-authority'],
    blocker: 'Reductions and repricing remain disabled until distinct committed quantity and supplier-invoiced quantity have complete authoritative evidence under the amendment transaction fences.'
  };
}
