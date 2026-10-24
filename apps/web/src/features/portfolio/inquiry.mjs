export const inquiryPermission = permission => permission.startsWith('inquiry.') ? 'quote.write' : permission;

export function sourcedQuoteContent(values, revision) {
  const sourceFields = ['provenance', 'description', 'quantity', 'uom'];
  return { expiresAt: values.expiresAt, taxPolicy: values.taxPolicy || 'NO_TAX', roundingPolicy: 'LINE_HALF_UP',
    lines: revision.lines.map((line, i) => ({ ...Object.fromEntries(sourceFields.filter(field => line[field] !== undefined).map(field => [field, line[field]])), unitPrice: values[`unitPrice${i}`], currency: values[`currency${i}`] })) };
}

export function inquiryConversion(inquiry, values, key) {
  const revision = inquiry.revisions.at(-1);
  return { expectedVersion: inquiry.version, revision: revision.number, expiresAt: values.expiresAt,
    taxPolicy: values.taxPolicy || 'NO_TAX', roundingPolicy: 'LINE_HALF_UP',
    prices: revision.lines.map((line, i) => ({ inquiryLineId: line.lineId, unitPrice: values[`unitPrice${i}`], currency: values[`currency${i}`] })), idempotencyKey: key };
}

export function inquiryLines(values, count, existing = []) {
  return Array.from({ length: count }, (_, i) => ({
    ...(existing[i]?.lineId ? { lineId: existing[i].lineId } : {}),
    ...Object.fromEntries(['itemCode', 'description', 'quantity', 'uom', 'drawingNumber', 'drawingRevision'].map(field => [field, values[`${field}${i}`]])),
  }));
}
