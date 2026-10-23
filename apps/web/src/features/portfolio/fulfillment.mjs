export function validQuantity(value) {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value) && /[1-9]/.test(value);
}
export function shipmentCommand(order, values, key) {
  const lineIndex = Number(values.lineIndex);
  return { salesOrderId: order._id, expectedVersion: order.version, lineIndex, uom: order.snapshot.lines[lineIndex].uom, reference: values.reference, sources: [{ sourceType: values.sourceType, sourceId: values.sourceId, quantity: values.quantity }], idempotencyKey: key };
}
export function invoiceCommand(order, values, key) {
  return { salesOrderId: order._id, expectedVersion: order.version, lines: [{ shipmentId: values.shipmentId, quantity: values.quantity }], idempotencyKey: key };
}
export function paymentCommand(invoice, values, key) {
  return { accountId: invoice.accountId, amount: values.amount, currency: invoice.currency, reference: values.reference, allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: values.amount }], idempotencyKey: key };
}
export function deliveryLabel(state) {
  const labels = { PREVIEWED: 'Preview only (not sent)', UNKNOWN: 'Unknown (delivery unconfirmed)', QUEUED: 'Queued (not sent)', SENDING: 'Sending (unconfirmed)', SENT: 'Sent (delivery not confirmed)', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', CANCELLED: 'Cancelled (not sent)' };
  return labels[state] ?? 'Status unavailable';
}
