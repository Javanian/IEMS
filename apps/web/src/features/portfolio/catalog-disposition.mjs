export function dispositionPath(receiptId) { return `/api/catalog-disposition/receipts/${receiptId}`; }
const common = (view,values,key) => ({ expectedVersion:view.version,expectedReceiptVersion:view.receiptVersion,reason:values.reason,idempotencyKey:key });
export function inspectionCommand(view,values,key) {
  const body = { ...common(view,values,key),acceptedQuantity:values.acceptedQuantity,rejectedQuantity:values.rejectedQuantity,evidence:values.evidence };
  if (view.trackingPolicy === 'SERIAL') { body.acceptedSerials = Array.isArray(values.acceptedSerials) ? [...values.acceptedSerials] : [];body.rejectedSerials = Array.isArray(values.rejectedSerials) ? [...values.rejectedSerials] : []; }
  return body;
}
export function approveInspectionCommand(view,values,key) { return { ...common(view,values,key),revision:view.currentRevision }; }
export function putawayCatalogCommand(view,locations,values,key) { const location = locations.find(row => row._id === values.locationId);return { ...common(view,values,key),locationId:values.locationId,expectedLocationVersion:location?.version }; }
export function dispositionHint(error) {
  if (error?.code === 'INVALID_INSPECTION') return 'Record both exact quantities. They must partition the original receipt; SERIAL also needs explicit exhaustive, disjoint accepted and rejected identities with matching counts. Nothing is assigned by subtraction.';
  if (error?.code === 'STOCK_ENCUMBERED') return 'An authoritative source hold blocks approval and putaway. Historical inspection may still be recorded; a hold release does not approve QC or allocate stock.';
  if (error?.code === 'CATALOG_DISPOSITION_STATE_CONFLICT') return 'Review the current inspection and stock phase. Approval is terminal; whole accepted putaway is allowed once. Rejected stock cannot be put away or reused.';
  if (['CATALOG_DEPENDENCY_CHANGED','MASTER_SOURCE_INVALID','CATALOG_SOURCE_INVALID','CATALOG_DISPOSITION_SOURCE_INVALID'].includes(error?.code)) return 'Current source, inspection or location authority could not be used. Refresh and review immutable evidence. Stored quantities remain separate from current eligibility; no legacy stock path is authorized.';
  if (error?.code === 'VERSION_CONFLICT') return 'The inspection, physical receipt or location changed. Discard the command and review current versions before recording a new action.';
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return 'This key belongs to a different retained command. Discard and read current evidence before starting another action.';
  return null;
}
