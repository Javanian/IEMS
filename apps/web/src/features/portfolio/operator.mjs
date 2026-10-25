const PREFIX = { inquiry:'INQ',inquiries:'INQ',quote:'QUO',quotes:'QUO',order:'SO',orders:'SO',request:'PR',requests:'PR',purchaseOrder:'PO',purchaseOrders:'PO',receipt:'RCV',receipts:'RCV',workOrder:'WO',workOrders:'WO',internalOrder:'IP',internal:'IP',execution:'JOB',engineering:'ENG',shipment:'SHP',shipments:'SHP',invoice:'INV',invoices:'INV',payment:'PAY',payments:'PAY',item:'ITEM',location:'LOC',vendor:'VEN',account:'ACC' };
export function displayReference(kind,value) {
  const record = typeof value === 'string' ? { _id:value } : value || {};
  if(record.documentNumber || record.displayNumber || record.orderNumber || record.reference)return record.documentNumber || record.displayNumber || record.orderNumber || record.reference;
  if(['item','location'].includes(kind) && record.code)return record.code;
  const id=record._id || record.id;
  return typeof id === 'string' && id ? `${PREFIX[kind] || 'REF'}-${id.split('-')[0].slice(0,10).toUpperCase()}` : 'Reference unavailable';
}
const STATUS = { DRAFT:'Draft',SUBMITTED:'Submitted',IN_REVIEW:'Under review',QUOTED:'Quoted',APPROVED:'Approved',APPROVED_DEMAND:'Planning approved',CONVERTED:'Order created',ISSUED:'Issued',CONFIRMED:'Confirmed',OPEN:'Open',PLANNED:'Planned',RELEASED:'Ready to start',IN_PROGRESS:'In progress',QUARANTINED:'Awaiting inspection',CATALOG_QC_APPROVED:'Inspection approved',CATALOG_REJECTED:'Rejected in quarantine',CATALOG_STORED:'Stored',QC_RELEASED:'Quality approved',QC_COMPLETED:'Quality complete',STORED:'Stored',SHIPPED:'Shipped',DELIVERED:'Delivered',CANCELLED:'Cancelled',INACTIVE:'Inactive',QUALIFIED:'Qualified',UNRECORDED:'Not recorded',REVOKED:'Approval withdrawn',COMPLETE:'Complete',FROZEN:'Locked after dispatch',AVAILABLE:'Available',ACCEPTED_QUARANTINE:'Accepted, awaiting putaway',REJECTED_QUARANTINE:'Rejected in quarantine' };
export function operatorStatus(value) { return STATUS[value] || String(value || 'Not recorded').toLowerCase().replaceAll('_',' ').replace(/^./,letter => letter.toUpperCase()); }
const BLOCKERS = { VENDOR_INACTIVE:'This supplier is inactive. Choose a current active supplier before continuing.',VENDOR_SOURCE_INVALID:'Supplier details need review. Choose another current supplier or ask an administrator to review this source.',ITEM_NOT_PURCHASED:'Choose an approved purchased item for this purchase request.',TRACKING_POLICY_REQUIRED:'Choose a purchased item with lot or serial tracking.',MATERIAL_SHORTAGE:'Reserve the exact full material demand before releasing production.',INSUFFICIENT_STOCK:'The selected stock no longer has enough available material. Refresh it and choose a smaller amount or another eligible receipt.',PROVENANCE_INCOMPLETE:'Record the complete material attribution for every output and reconcile all process loss before QC.',DEMAND_CHANGED:'Current master or engineering authority no longer matches this frozen demand. Review the retained plan and current source approvals.',LABOR_EVIDENCE_REQUIRED:'Record the required labor evidence for this operation, then retry the operation.',OPERATION_SEQUENCE_CONFLICT:'Refresh the job and record its next eligible operation.',SERIAL_CONFLICT:'One of these serials is already registered. Review actual output identities before trying again.', SOURCE_HELD:'A quality hold is active. Review the hold before approval or moving stock.',STOCK_ENCUMBERED:'Stock is held or already committed. Refresh its availability before continuing.',ITEM_CHANGED:'The item specification changed. Review the current approved revision and select it explicitly.',MATERIAL_CHANGED:'A material specification changed. Record a new engineering revision before approval.',ITEM_NOT_APPROVED:'The item needs current approval before use.',LOCATION_CHANGED:'The recorded location or bin changed. Review its qualification.',LOCATION_NOT_QUALIFIED:'Choose a currently qualified company location.',OWNER_MISMATCH:'This source does not belong to the selected company or plant.',NOT_STORED:'Accepted stock must be put away before it is eligible.',ALL_REJECTED:'All received material was rejected. It cannot be put away or reused.',ENGINEERING_NOT_APPROVED:'Record and approve the engineering demand before continuing.',ORDER_CANCELLED:'This order was cancelled. Create a new order if work is still needed.',TYPED_QUARANTINE_ONLY:'Complete controlled inspection and putaway before using this catalog stock.',INVALID_HOLD_CACHE:'Hold evidence needs review. Stock remains blocked.' };
export function operatorBlocker(code) { return BLOCKERS[code] || 'This record has a workflow restriction. Refresh it and review the source record before continuing.'; }
export function operatorFailure(error,mutation = false) {
  if(error?.status === 401)return 'Your session expired. Sign in again to continue.';
  if(error?.status === 403)return 'Access denied. You do not have permission for this action. Ask an administrator to review your access.';
  if(error?.status === 404)return 'This record is unavailable in your selected plant. Return to the list and choose another record.';
  if(error?.code === 'CATALOG_ORDER_UNSUPPORTED')return 'This catalog sales order is awaiting item-aware fulfillment. Legacy stock, production and dispatch actions cannot use it.';
  if(mutation && (!error?.status || error.status >= 500))return 'The result is uncertain. Keep the current inputs locked and retry the same command, or discard it and refresh the record before making changes.';
  if(error?.status === 409)return BLOCKERS[error.code] || 'The record or one of its sources changed. Refresh it, review the current status, then try again.';
  if(error?.status === 400 || error?.status === 422)return 'Some inputs could not be accepted. Check the quantities, required selections and evidence, then submit again.';
  return 'The current records could not be loaded. Check the connection and retry.';
}
export function workflowStage(path) {
  if(/\/repair\//.test(path))return 'Repair';
  if(/\/inquiries/.test(path))return 'Inquiry';
  if(/\/quotes/.test(path))return 'Quotation';
  if(/\/catalog-disposition\//.test(path))return 'Quality';
  if(/\/catalog-procurement\/|\/procurement\/|\/warehouse\//.test(path))return 'Procurement';
  if(/\/internal-execution\/|\/manufacturing\//.test(path))return 'Production';
  if(/\/fulfillment\/(invoices|payments)/.test(path))return 'Billing';
  if(/\/fulfillment\/|\/deliveries\//.test(path))return 'Delivery';
  if(/\/orders/.test(path))return 'Order';
  return null;
}
export const WORKFLOW_STAGES = ['Inquiry','Quotation','Order','Procurement','Production','Quality','Delivery','Billing'];
export function quantitySummary(record) {
  if(record.quantity !== undefined)return `${record.quantity} ${record.uom || record.itemSnapshot?.content?.uom || ''}`.trim();
  const lines=record.content?.lines || record.snapshot?.lines || record.lines || [];
  return lines.slice(0,3).map(line => `${line.itemCode || line.description || 'Item'}: ${line.quantity} ${line.uom}`).join('; ');
}
export function executionQueueAction(row) {
  if(row.status==='STORED')return null;
  if(row.status==='PLANNED'){
    if(row.blockers?.some(code=>['SOURCE_HELD','STOCK_ENCUMBERED','INVALID_HOLD_CACHE'].includes(code)))return 'Review active source holds before releasing production';
    if(row.blockers?.length)return 'Review current source restrictions before continuing';
    return row.canRelease ? 'Release fully reserved production' : 'Materials to reserve before release';
  }
  return ({RELEASED:'Issue reserved materials',ISSUED:'Record actual operation',IN_PROGRESS:'Record next operation',QUARANTINED:'Reconcile output material and record QC',QC_RELEASED:'Put away accepted company output'})[row.status] || null;
}
