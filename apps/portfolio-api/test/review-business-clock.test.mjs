import test from 'node:test';
import assert from 'node:assert/strict';
import { businessNow, bindBusinessClock } from '../src/business-clock.mjs';

test('synthetic business clock requires both owned namespace and exact process marker', async () => {
  const date = new Date('2026-04-12T14:30:00Z'), clock = () => date;
  for (const [databaseName, marker, present] of [['ordinary_database', 'owned-marker', true], ['portfolio_test_clock', 'wrong-marker', false], ['portfolio_test_clock', undefined, true]]) {
    const runtime = { db: { databaseName, collection: () => ({ findOne: async () => present ? { _id: 'owned-marker' } : null }) } };
    await assert.rejects(bindBusinessClock(runtime, clock, marker), error => error.code === 'OWNED_DATABASE_REQUIRED');
    assert.equal(runtime.businessClock, undefined);
  }
  const runtime = { db: { databaseName: 'portfolio_test_clock', collection: () => ({ findOne: async query => query._id === 'owned-marker' ? { _id: 'owned-marker' } : null }) } };
  await assert.rejects(bindBusinessClock(runtime, () => 'invalid-date', 'owned-marker'), /Invalid synthetic business clock/);
  assert.equal(runtime.businessClock, undefined);
  const wallBefore = Date.now(); await bindBusinessClock(runtime, clock, 'owned-marker');
  assert.equal(businessNow(runtime).toISOString(), '2026-04-12T14:30:00.000Z');
  assert.ok(Date.now() >= wallBefore); assert.equal(new Date().getUTCFullYear(), new Date(wallBefore).getUTCFullYear());
  date.setUTCDate(13); assert.equal(businessNow(runtime).getUTCDate(), 13);
  assert.notEqual(businessNow(runtime), date);
});
