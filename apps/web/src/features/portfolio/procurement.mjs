import { quoteContent } from './commercial.mjs';
export function procurementContent(values, count) {
  const { expiresAt, ...content } = quoteContent(values, count);
  return { vendorId: values.vendorId, ...content };
}
export function procurementConversion(record, key) {
  return { expectedVersion: record.version, idempotencyKey: key };
}
