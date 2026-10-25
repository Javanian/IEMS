const PERMISSIONS = {
  'custody.read':'You need serial custody read permission to inspect identity availability.',
  'custody.adopt':'You need serial custody adoption permission for this permanent receipt action.',
  'custody.claim':'You need serial custody claim permission to select incoming identities for a planned work order.',
  'custody.abandon':'You need serial custody abandon permission to clear a planned claim.',
};
export function custodyCapability(action, permissions) {
  if (!Array.isArray(permissions)) return { enabled:false, reason:'Effective custody permissions are unavailable. Refresh your session.' };
  return permissions.includes(action) ? { enabled:true, reason:'' } : { enabled:false, reason:PERMISSIONS[action] || 'You need permission for this custody action.' };
}
export const hasCustodyMarker = receipt => Object.hasOwn(receipt, 'serialCustody');
export const receiptCustodyPath = receiptId => `/api/warehouse/receipts/${encodeURIComponent(receiptId)}/serial-custody`;
export const workOrderClaimsPath = workOrderId => `/api/manufacturing/work-orders/${encodeURIComponent(workOrderId)}/serial-claims`;
export const custodyEventPath = (path, cursor) => `${path}/events?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
export function adoptCustodyCommand(receipt, values, key) {
  return { expectedVersion:receipt.receiptVersion, reason:values.reason, idempotencyKey:key };
}
export function claimCustodyCommand(wo, receipt, values, key) {
  return { expectedVersion:wo.workOrderVersion, expectedReceiptVersion:receipt.receiptVersion, receiptId:receipt.receiptId, serialUnitIds:[...(values.serialUnitIds || [])], reason:values.reason, idempotencyKey:key };
}
export function abandonCustodyCommand(wo, values, key) {
  const claim = wo.claims.find(row => row._id === values.claimId);
  return { expectedVersion:wo.workOrderVersion, expectedClaimVersion:claim?.version, claimId:values.claimId, reason:values.reason, idempotencyKey:key };
}
export function releaseSerialClaims(wo, claims = []) {
  return wo.serialCustodyRequired ? { serialClaims:claims.filter(claim => claim.status === 'CLAIMED').map(claim => ({ receiptId:claim.receiptId, claimId:claim._id })) } : {};
}
const whole = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(\.0+)?$/.test(value) ? BigInt(value.split('.')[0]) : null;
export function custodyTransferReason(view) {
  if (!view) return 'Read current serial custody authority before transferring this receipt.';
  if (!view.tracked || view.mode !== 'RECEIVED_V1') return 'This receipt has an invalid or unavailable custody authority. Quantity transfer remains blocked.';
  if (view.sourceHolds.length) return 'Active source holds block transfer. Review the receipt hold panel.';
  if (!view.units.length || whole(view.quantity) !== BigInt(view.units.length) || whole(view.quantityAvailable) !== whole(view.quantity) || view.units.some(unit => unit.status !== 'AVAILABLE')) return 'Whole-receipt transfer requires every custody identity AVAILABLE and the full original quantity unencumbered.';
  return '';
}
const HINTS = {
  SERIAL_CUSTODY_REQUIRED:'This receipt requires incoming identity custody. Quantity-only reservation, counting and legacy manufacturing use are unavailable.',
  SERIAL_CUSTODY_UNTRACKED:'Adopt untouched incoming serial stock explicitly before claiming identities. Registry uniqueness alone is not availability.',
  SERIAL_CUSTODY_STATE_CONFLICT:'The receipt, work order or custody identities no longer have the required state. Refresh the current authority.',
  SERIAL_CUSTODY_SOURCE_INVALID:'Receipt history, registry origin or custody evidence is inconsistent. Review the source; no automatic repair or adoption is applied.',
  SERIAL_CLAIM_CONFLICT:'One or more identities are no longer available or this work order already has a claim for the receipt. Refresh claims and source identities.',
  SERIAL_CLAIM_QUANTITY_CONFLICT:'Claims must exactly match the released source quantities in integral source UOM units, at most 100 identities per source.',
  STOCK_ENCUMBERED:'A source hold blocks fresh adoption, claim, release or consumption. A planned metadata claim may still be abandoned.',
  VERSION_CONFLICT:'The receipt, work order or claim changed. Discard this command and review current authority before changing the selection.',
};
export const custodyHint = error => HINTS[error?.code] || null;
