// Pure command builders for /api/manufacturing. Decimal strings and UOM pass through unchanged;
// the server is the conservation authority. expectedVersion is captured once per command so an
// uncertain response can be retried with the identical idempotent payload.
const words = text => (text || '').trim().split(/\s+/).filter(Boolean);

export function planCommand(order, values, key) {
  const lineIndex = Number(values.lineIndex);
  return { salesOrderId: order._id, expectedVersion: order.version, lineIndex, uom: order.snapshot.lines[lineIndex]?.uom, quantities: words(values.quantities), idempotencyKey: key };
}
export function releaseCommand(wo, values, operationCount, materialCount, key) {
  const operations = Array.from({ length: operationCount }, (_, i) => ({ code: values[`code${i}`], instruction: values[`instruction${i}`] }));
  const materials = Array.from({ length: materialCount }, (_, i) => ({ receiptId: values[`receiptId${i}`], quantityPerUnit: values[`quantityPerUnit${i}`], uom: values[`materialUom${i}`] }));
  return { expectedVersion: wo.version, operations, materials, idempotencyKey: key };
}
export function nextOperation(wo) {
  const index = wo.records.length, operation = wo.routing?.operations[index];
  return operation ? { index, code: operation.code, inputQuantity: wo.records.at(-1)?.goodQuantity || wo.quantity } : null;
}
export function recordCommand(wo, values, key) {
  const next = nextOperation(wo);
  return { expectedVersion: wo.version, operationIndex: next.index, inputQuantity: next.inputQuantity, goodQuantity: values.goodQuantity, scrapQuantity: values.scrapQuantity, uom: wo.uom, evidence: values.evidence, idempotencyKey: key };
}
export function qcCommand(wo, values, key) {
  return { expectedVersion: wo.version, acceptedQuantity: values.acceptedQuantity, rejectedQuantity: values.rejectedQuantity, uom: wo.uom, evidence: values.evidence, idempotencyKey: key };
}
const hints = {
  QUANTITY_EXCEEDED: 'The split total plus quantities already planned would exceed the sales order line. Review existing work orders for this line.',
  INSUFFICIENT_STOCK: 'A selected receipt is not STORED or lacks available quantity for WO quantity x quantity per unit. Open the receipt to check its balance.',
  UOM_CONFLICT: 'UOM must match exactly: work order UOM equals the sales order line, material UOM equals its receipt. No conversion is applied.',
  CONSERVATION_CONFLICT: 'Quantities must balance: good + scrap equals input for an operation, accepted + rejected equals final output for QC.',
  OPERATION_SEQUENCE_CONFLICT: 'Another operator recorded this operation first. Refresh to record the next operation in order.',
  STATE_CONFLICT: 'The work order is no longer in the state this action requires. Refresh to see its current status.',
  STOCK_ENCUMBERED: 'A material receipt is on hold. Nothing was consumed and the reservation is still recorded. Review the stock exception and the hold before continuing.',
  INEXACT_MATERIAL_QUANTITY:'WO quantity x quantity per unit needs more than six decimal places. Adjust the ratio.',
};
export function manufacturingHint(error) { return error?.code ? hints[error.code] || null : null; }
