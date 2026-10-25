export const catalogBase = '/api/catalog-procurement';
export const catalogUi = '/portfolio/catalog-procurement';
export function legacyReceiptEligible(receipt) { return receipt?.receiptOrigin?.cohort === 'LEGACY' && receipt.receiptOrigin.legacyEligible === true; }
export function receiptDetailPath(receipt,permissions) {
  if(receipt?.receiptOrigin?.cohort !== 'CATALOG')return `/portfolio/warehouse/receipts/${receipt._id}`;
  return Array.isArray(permissions) && permissions.includes('catalog.qc.read') && !permissions.includes('catalog.read') ? `/portfolio/catalog-disposition/receipts/${receipt._id}` : `${catalogUi}/receipts/${receipt._id}`;
}
export function catalogCapability(action, permissions) {
  return Array.isArray(permissions) && permissions.includes(action) ? { enabled:true,reason:'' } : { enabled:false,reason:Array.isArray(permissions) ? `You need ${action} permission for this action.` : 'Effective catalog permissions are unavailable. Refresh your session.' };
}
export function catalogItems(items) { return items.filter(item => item.status === 'APPROVED' && item.content?.kind === 'PURCHASED' && item.content.schema === 'INVENTORY_ITEM_V2' && ['LOT','SERIAL'].includes(item.content.trackingPolicy) && item.approval?.revision === item.currentRevision && item.approval?.contentHash === item.contentHash && Array.isArray(item.blockers) && !item.blockers.length); }
const common = (head,values,key) => ({ expectedVersion:head?.version ?? 1,reason:values.reason,idempotencyKey:key });
export function trackedItemCommand(head,values,key) { return { ...common(head,values,key),...(head ? {} : { code:values.code }),description:values.description,uom:values.uom,kind:values.kind,schema:'INVENTORY_ITEM_V2',trackingPolicy:values.trackingPolicy }; }
export function catalogRequestCommand(head,items,values,count,key) {
  return { ...common(head,values,key),vendorId:values.vendorId,taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:Array.from({ length:count },(_,i) => {
    const item = items.find(row => row._id === values[`itemId${i}`]);
    return { itemId:values[`itemId${i}`],itemVersion:item?.version,itemRevision:item?.currentRevision,quantity:values[`quantity${i}`],unitPrice:values[`unitPrice${i}`],currency:values[`currency${i}`] };
  }) };
}
export function catalogTransitionCommand(head,values,key,approve = false) { return { ...common(head,values,key),...(approve ? { revision:head.currentRevision } : {}) }; }
export function catalogReceiptCommand(order,values,key) {
  const line = order.content.lines.find(row => row.lineId === values.lineId), trace = values.lotNumber || values.heatNumber ? { lotNumber:values.lotNumber,heatNumber:values.heatNumber } : {};
  return { ...common(order,values,key),purchaseOrderId:order._id,vendorId:order.content.vendorId,lineId:values.lineId,quantity:values.quantity,...trace,serials:line?.trackingPolicy === 'SERIAL' ? String(values.serials || '').trim().split(/\s+/).filter(Boolean) : [] };
}
export function catalogHint(error) {
  if (['CATALOG_DEPENDENCY_CHANGED','MASTER_NOT_APPROVED'].includes(error?.code)) return 'Current item approval or ownership changed. Review source blockers. Issued content and old receipts remain historical; fresh intake cannot silently use a different revision.';
  if (['CATALOG_SOURCE_INVALID','MASTER_SOURCE_INVALID','RECEIPT_ORIGIN_INVALID'].includes(error?.code)) return 'Source authority could not be validated. Review immutable source evidence before any further action.';
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return 'The retained key belongs to a different command. Discard and review the server record before creating a new command.';
  return null;
}
