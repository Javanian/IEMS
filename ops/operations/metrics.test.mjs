import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, quantityBuckets, legacySnapshot } from '../../apps/portfolio-api/src/operations.mjs';

test('quantity buckets retain exact decimals and units; missing fields remain incomplete', () => {
  const result = quantityBuckets([{ quantity: '9007199254740993.1', uom: 'EA' }, { quantity: '0.9', uom: 'EA' }, { quantity: '2.25', uom: 'KG' }, { uom: 'KG' }], r => [r]);
  assert.equal(result.status, 'INCOMPLETE');
  assert.deepEqual(result.buckets, [{ uom: 'EA', quantity: '9007199254740994.000000000000' }, { uom: 'KG', quantity: '2.250000000000' }]);
  assert.equal(quantityBuckets([], r => [r]).status, 'NO_DATA');
});
test('freshness never reports absent or future timestamps as current', () => {
  const now = new Date('2026-10-31T00:00:00.000Z');
  assert.equal(freshness(null, now).status, 'NO_DATA');
  assert.equal(freshness('2026-10-31T00:01:00.000Z', now).status, 'INCOMPLETE');
  assert.equal(freshness('2026-10-30T23:00:00.000Z', now).status, 'STALE');
});
test('legacy adapters require scoped authorization and strip private fields', async () => {
  const sample = { resourceId: '11111111-1111-4111-8111-111111111111', sourceRevision: '3', value: '2', uom: 'MIN', sampleAt: '2026-10-30T23:00:00.000Z', windowFrom: '2026-10-30T22:00:00.000Z', windowUntil: '2026-10-30T23:00:00.000Z', biometricTemplate: 'must-not-leak' };
  let authorized = false;
  const result = await legacySnapshot({ kind: 'TIMESHEET', authorize: async () => { authorized = true; }, read: async () => { assert(authorized); return { observedAt: '2026-10-30T23:00:00.000Z', completeness: 'COMPLETE', samples: [sample] }; } }, { filter: {}, now: new Date('2026-10-31T00:00:00.000Z') });
  assert.equal(result.samples[0].biometricTemplate, undefined);
  assert.equal((await legacySnapshot(null, {})).status, 'NO_DATA');
  await assert.rejects(legacySnapshot({ kind: 'NFC', authorize: async () => {}, read: async () => ({ observedAt: '2026-10-30T23:00:00.000Z', completeness: 'COMPLETE', samples: [{ ...sample, uom: 'private value' }] }) }, { filter: {}, now: new Date('2026-10-31T00:00:00.000Z') }), /LEGACY_SAMPLE_INVALID/);
});
