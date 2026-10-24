export function receiptCommand(po, values, key) {
  const trace = values.lotNumber || values.heatNumber ? { lotNumber:values.lotNumber, heatNumber:values.heatNumber } : {};
  return { purchaseOrderId:po._id, vendorId:po.vendorId, expectedVersion:po.version, lineIndex:Number(values.lineIndex), quantity:values.quantity, uom:values.uom, serials:(values.serials || '').trim() ? values.serials.trim().split(/\s+/) : [], ...trace, idempotencyKey:key };
}
export function warehouseCommand(action, receipt, values, key) {
  const body = {expectedVersion:receipt.version,idempotencyKey:key};
  if (action === 'release') return {...body,reason:values.reason};
  if (action === 'putaway') return {...body,location:values.location};
  if (action === 'count') return {...body,countedQuantity:values.countedQuantity,uom:values.uom,reason:values.reason};
  if (action === 'transfer') return {...body,binId:values.binId,uom:values.uom,reason:values.reason};
  return {...body,salesOrderId:values.salesOrderId,accountId:values.accountId,lineIndex:Number(values.lineIndex),quantity:values.quantity,uom:values.uom};
}
