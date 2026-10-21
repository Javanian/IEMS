import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createErrorEnvelope, ERROR_CODES } from '../src/common/error.js';
import {
  computeRequestHash,
  isValidIdempotencyKey,
  IDEMPOTENCY_HEADER
} from '../src/common/idempotency.js';

test('ErrorEnvelope creation and standard structure', () => {
  const envelope = createErrorEnvelope({
    code: ERROR_CODES.OPTIMISTIC_LOCK_CONFLICT,
    message: 'Work order version 2 is stale. Latest version is 3.',
    correlationId: 'req-trace-12345',
    path: '/api/v1/planning/work-orders/wo-1/release',
    fieldErrors: [
      { field: 'version', message: 'Version conflict', rejectedValue: 2 }
    ],
    details: { currentVersion: 3 }
  });

  assert.strictEqual(envelope.code, 'OPTIMISTIC_LOCK_CONFLICT');
  assert.strictEqual(envelope.correlationId, 'req-trace-12345');
  assert.strictEqual(envelope.path, '/api/v1/planning/work-orders/wo-1/release');
  assert.ok(envelope.timestamp);
  assert.ok(envelope.fieldErrors);
  assert.strictEqual(envelope.fieldErrors.length, 1);
  assert.strictEqual(envelope.fieldErrors[0]!.field, 'version');
  assert.strictEqual(envelope.details?.currentVersion, 3);
});

test('Idempotency key validator', () => {
  assert.strictEqual(IDEMPOTENCY_HEADER, 'idempotency-key');
  assert.strictEqual(isValidIdempotencyKey('idem-key-12345678'), true);
  assert.strictEqual(isValidIdempotencyKey('a'.repeat(8)), true);
  assert.strictEqual(isValidIdempotencyKey('a'.repeat(128)), true);

  assert.strictEqual(isValidIdempotencyKey('short'), false); // less than 8 chars
  assert.strictEqual(isValidIdempotencyKey('a'.repeat(129)), false); // more than 128 chars
  assert.strictEqual(isValidIdempotencyKey('invalid!chars'), false);
  assert.strictEqual(isValidIdempotencyKey(''), false);
  assert.strictEqual(isValidIdempotencyKey(null), false);
});

test('computeRequestHash - canonical SHA-256 digest', () => {
  const hash1 = computeRequestHash('POST', '/api/v1/commercial/sales-orders', { customerId: 'cust-1', qty: '10' });
  const hash2 = computeRequestHash('post', '/api/v1/commercial/sales-orders/', { customerId: 'cust-1', qty: '10' });
  const hashDifferentBody = computeRequestHash('POST', '/api/v1/commercial/sales-orders', { customerId: 'cust-1', qty: '11' });
  const hashDifferentPath = computeRequestHash('POST', '/api/v1/commercial/sales-orders/confirm', { customerId: 'cust-1', qty: '10' });

  // Normalization matches casing and trailing whitespace
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64);
  assert.strictEqual(/^[a-f0-9]{64}$/.test(hash1), true);

  // Different payload produces different digest
  assert.notStrictEqual(hash1, hashDifferentBody);
  assert.notStrictEqual(hash1, hashDifferentPath);
});
