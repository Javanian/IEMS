export function quoteContent(values, count) {
  return { expiresAt: values.expiresAt, taxPolicy: values.taxPolicy || 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: Array.from({ length: count }, (_, i) => ({ description: values[`description${i}`], quantity: values[`quantity${i}`], uom: values[`uom${i}`], unitPrice: values[`unitPrice${i}`], currency: values[`currency${i}`] })) };
}
export function conversionAttempt(quote, key) {
  return { expectedVersion: quote.version, revision: quote.revisions.at(-1).number, idempotencyKey: key };
}
