import test from 'node:test';
import assert from 'node:assert/strict';
import { procurementContent, procurementConversion } from '../src/features/portfolio/procurement.mjs';

test('procurement preserves exact line strings and excludes quote expiry', () => {
  const values = { vendorId: 'vendor', description0: ' Material ', quantity0: '1.250', uom0: 'KG', unitPrice0: '100.01', currency0: 'USD', expiresAt: 'not-applicable' };
  assert.deepEqual(procurementContent(values, 1), { vendorId: 'vendor', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: ' Material ', quantity: '1.250', uom: 'KG', unitPrice: '100.01', currency: 'USD' }] });
});
test('procurement conversion captures version once for identical retry', () => {
  const record = { version: 2 };
  const attempt = procurementConversion(record, 'owned-key'); record.version = 3;
  assert.deepEqual(attempt, { expectedVersion: 2, idempotencyKey: 'owned-key' });
});
