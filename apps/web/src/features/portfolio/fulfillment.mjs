export function validQuantity(value) {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value) && /[1-9]/.test(value);
}
export function shipmentCommand(order, values, key) {
  const lineIndex = Number(values.lineIndex);
  const serials = values.sourceType === 'WORK_ORDER' && values.serials !== undefined ? { serials:Array.isArray(values.serials) ? [...values.serials] : values.serials.trim().split(/\s+/).filter(Boolean) } : {};
  return { salesOrderId: order._id, expectedVersion: order.version, lineIndex, uom: order.snapshot.lines[lineIndex].uom, reference: values.reference, sources: [{ sourceType: values.sourceType, sourceId: values.sourceId, quantity: values.quantity, ...serials }], ...dispatchHandling(values), idempotencyKey: key };
}
export function dispatchHandling(values) {
  if (!values.equipmentId) return {};
  if (!/^[1-9][0-9]{0,6}$/.test(values.requiredMinutes)) throw Error('Enter the actual whole minutes of equipment use.');
  return { handling: { equipmentId: values.equipmentId, expectedEquipmentVersion: Number(values.equipmentVersion), expectedMaintenanceVersion: Number(values.maintenanceVersion), from: new Date(`${values.handlingFrom}Z`).toISOString(), until: new Date(`${values.handlingUntil}Z`).toISOString(), requiredMinutes: values.requiredMinutes } };
}
export function invoiceCommand(order, values, key) {
  return { salesOrderId: order._id, expectedVersion: order.version, lines: [{ shipmentId: values.shipmentId, quantity: values.quantity }], ...(values.dueAt ? { dueAt: new Date(`${values.dueAt}Z`).toISOString() } : {}), idempotencyKey: key };
}
export function paymentCommand(invoice, values, key) {
  return { accountId: invoice.accountId, amount: values.amount, currency: invoice.currency, reference: values.reference, allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: values.amount }], idempotencyKey: key };
}
export function deliveryLabel(state) {
  const labels = { PREVIEWED: 'Preview only (not sent)', UNKNOWN: 'Unknown (delivery unconfirmed)', QUEUED: 'Queued (not sent)', SENDING: 'Sending (unconfirmed)', SENT: 'Sent (delivery not confirmed)', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', CANCELLED: 'Cancelled (not sent)' };
  return labels[state] ?? 'Status unavailable';
}

export function fulfillmentHint(error) {
  return {
    QUALITY_HOLD_ACTIVE: 'A current source or operator quality hold blocks dispatch. Review the quality record before trying a new command.',
    CALIBRATION_REQUIRED: 'The selected equipment needs calibration valid throughout the handling window.',
    MAINTENANCE_CAPACITY_EXCEEDED: 'The selected handling window has insufficient available equipment minutes. Review maintenance and choose an available window.',
    DISPATCH_WINDOW_NOT_CURRENT: 'Record a handling window that contains the current plant business time.',
    MAINTENANCE_VERSION_CONFLICT: 'The equipment schedule changed. Discard this attempt and load the current maintenance state.',
    QUALITY_VERSION_CONFLICT: 'The equipment quality record changed. Discard this attempt and select the current equipment record.',
    DEPOSIT_AMOUNT_EXCEEDED: 'The allocation exceeds the remaining deposit balance. Refresh the ledger and enter an available amount.',
    DEPOSIT_SOURCE_CONFLICT: 'Select a deposit for this account and currency.',
    DEPOSIT_AUTHORITY_INVALID: 'Deposit receipts and allocations do not reconcile. Ask the finance owner to inspect the evidence.',
    FINANCIAL_POSTING_INVALID: 'The invoice and its immutable posting or settlement evidence do not reconcile. Ask the finance owner to inspect the evidence.',
    IMMUTABLE_INVOICE_POSTING_REQUIRED: 'This legacy invoice needs an authorized posting review before a credit adjustment can be issued.',
    PACKING_SOURCE_CONFLICT: 'The dispatch must contain the exact packed quantities and serials. Review the package and current source availability.',
    RETURN_QUANTITY_EXCEEDED: 'Select only delivered goods that have not already been returned. Refresh delivery and return evidence.',
    FULFILLMENT_STOCK_AUTHORITY_INVALID: 'Shipment authorization and canonical stock evidence do not reconcile. Ask an authorized reviewer to inspect the source trace.',
    GENEALOGY_SOURCE_INVALID: 'The manufactured ancestry cannot be verified. Review the source genealogy before dispatch.'
  }[error?.code] || '';
}
