import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteContent, conversionAttempt } from '../src/features/portfolio/commercial.mjs';
test('quote content retains exact submitted line strings', () => {
  const values = { expiresAt: '2027-01-01T00:00:00.000Z', description0: ' Exact item ', quantity0: '1.250', uom0: 'EA', unitPrice0: '9999999999999999999999999999.99', currency0: 'USD' };
  assert.deepEqual(quoteContent(values, 1), { expiresAt: values.expiresAt, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: ' Exact item ', quantity: '1.250', uom: 'EA', unitPrice: values.unitPrice0, currency: 'USD' }] });
});
test('conversion retry retains original version revision and stable key', () => {
  const first = conversionAttempt({ version: 4, revisions: [{number: 1}, {number: 2}] }, 'stable_key_123');
  assert.deepEqual(first, {expectedVersion: 4, revision: 2, idempotencyKey: 'stable_key_123'});
});
