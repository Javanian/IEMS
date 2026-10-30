import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { planMigration } from '../../database/migrations/platform-foundation/v1.mjs';
const tenantId = randomUUID();
const source = () => ({ version: 1, tenantId, runId: randomUUID(), records: [
  { domain: 'orders', sourceId: 'legacy/1', data: { quantity: '1', uom: 'EA' }, ledger: [{ amount: '9007199254740993.99', unit: 'USD' }] },
  { domain: 'lines', sourceId: 'legacy/2', data: { quantity: '1', uom: 'EA' }, references: [{ domain: 'orders', sourceId: 'legacy/1' }], ledger: [{ amount: '-9007199254740993.98', unit: 'USD' }] }
] });
test('migration IDs hashes counts and exact ledger parity survive input order and run changes', () => {
  const input = source(), a = planMigration(input), b = planMigration({ ...input, runId: randomUUID(), records: [...input.records].reverse() });
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.rows.map(row => row.stableId), b.rows.map(row => row.stableId));
  assert.equal(a.ledgerTotals.USD, '0.010000000000');
  assert.equal(a.authority, 'staging-only');
  assert.notEqual(a.hash, planMigration({ ...input, tenantId: randomUUID() }).hash);
});
test('migration rejects missing relationships duplicate source keys and parity drift', () => {
  const input = source(), plan = planMigration(input);
  assert.throws(() => planMigration({ ...input, records: [input.records[1]] }), { code: 'MIGRATION_RELATIONSHIP_MISSING' });
  assert.throws(() => planMigration({ ...input, records: [input.records[0], input.records[0]] }), { code: 'MIGRATION_MANIFEST_INVALID' });
  assert.throws(() => planMigration({ ...input, expected: { hash: plan.hash, counts: plan.counts, ledgerTotals: { USD: '0' } } }), { code: 'MIGRATION_PARITY_FAILED' });
});
