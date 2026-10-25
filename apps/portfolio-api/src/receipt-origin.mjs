const scope = row => ({ tenantId: row.tenantId, plantId: row.plantId });
const invalid = () => ({ cohort: 'INVALID', legacyEligible: false });
const quantity = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)
  ? BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')) : null;

// Marker absence is not legacy authority: the independent origin and RECEIVE
// evidence must agree with an actual scoped legacy purchase order.
export async function classifyReceiptOrigin(db, receipt, session) {
  const filter = scope(receipt), options = { session };
  const origin = await db.collection('warehouseReceiptOrigins').findOne({ ...filter, receiptId: receipt._id }, options);
  const catalogOrder = receipt.purchaseOrderId && await db.collection('catalogPurchaseOrders').findOne({ ...filter, _id: receipt.purchaseOrderId }, options);
  if (Object.hasOwn(receipt, 'catalogSource') || Object.hasOwn(receipt, 'catalogDisposition') || origin || catalogOrder) return { cohort: 'CATALOG', legacyEligible: false };
  for (const name of ['catalogDispositionHeads', 'catalogInspections', 'catalogDispositionEvents', 'catalogStockBalances', 'catalogStockUnits', 'catalogStockMovements', 'catalogDispositionKeys', 'catalogDispositionAudit', 'catalogDispositionOutbox']) {
    const proof = name === 'catalogDispositionHeads' ? { ...filter, $or: [{ _id: receipt._id }, { receiptId: receipt._id }] } : { ...filter, receiptId: receipt._id };
    if (await db.collection(name).findOne(proof, options)) return { cohort: 'CATALOG', legacyEligible: false };
  }
  const movements = await db.collection('warehouseMovements').find({ ...filter, receiptId: receipt._id, kind: 'RECEIVE' }, options).limit(2).toArray();
  if (movements.length !== 1) return invalid();
  const receive = movements[0];
  if (Object.hasOwn(receive, 'catalogSource')) return { cohort: 'CATALOG', legacyEligible: false };
  if (receive.purchaseOrderId !== receipt.purchaseOrderId || receive.vendorId !== receipt.vendorId || receive.lineIndex !== receipt.lineIndex || receive.uom !== receipt.uom || receive.quantity !== receipt.quantity || receive.from !== null || receive.to !== 'QUARANTINE') return invalid();
  if (await db.collection('catalogPurchaseOrders').findOne({ ...filter, _id: receive.purchaseOrderId }, options)) return { cohort: 'CATALOG', legacyEligible: false };
  const order = await db.collection('purchaseOrders').findOne({ ...filter, _id: receipt.purchaseOrderId }, options);
  const line = order?.snapshot?.lines?.[receipt.lineIndex];
  const amount = quantity(receipt.quantity), maximum = quantity(line?.quantity);
  if (!order || !['ISSUED', 'CONFIRMED'].includes(order.status) || order.vendorId !== receipt.vendorId || !Number.isSafeInteger(receipt.lineIndex) || receipt.lineIndex < 0 || !line || line.uom !== receipt.uom || amount === null || amount <= 0n || maximum === null || amount > maximum) return invalid();
  if (!await db.collection('vendors').findOne({ ...filter, _id: receipt.vendorId }, options)) return invalid();
  const traced = Object.hasOwn(receipt, 'lotNumber') || Object.hasOwn(receipt, 'heatNumber');
  if (traced ? !receipt.lotNumber || !receipt.heatNumber || receive.materialTrace?.receiptId !== receipt._id || receive.materialTrace.lotNumber !== receipt.lotNumber || receive.materialTrace.heatNumber !== receipt.heatNumber : Object.hasOwn(receive, 'materialTrace')) return invalid();
  return { cohort: 'LEGACY', legacyEligible: true };
}

export async function requireLegacyReceipt(db, receipt, session) {
  const origin = await classifyReceiptOrigin(db, receipt, session);
  if (!origin.legacyEligible) {
    const code = origin.cohort === 'CATALOG' ? 'CATALOG_RECEIPT_UNSUPPORTED' : 'RECEIPT_ORIGIN_INVALID';
    throw Object.assign(new Error(code), { status: 409, code });
  }
}
