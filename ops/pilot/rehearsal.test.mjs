import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reconcile, validateDataset } from './rehearsal.mjs';
export function dataset() {
  const scope = { tenantId: randomUUID(), legalEntityId: randomUUID(), plantId: randomUUID() };
  return { schema: 'IEMS_SYNTHETIC_PILOT_V1', synthetic: true, ...scope, records: [
    { ...scope, id: randomUUID(), resourceType: 'training_component', quantity: '9007199254740993.000001', uom: 'EA' }] };
}
test('reconciliation preserves exact decimal, identities and scope', () => {
  const a = dataset(), b = structuredClone(a); assert.equal(reconcile(a,b).state, 'MATCH');
  b.records[0].quantity = '9007199254740993.000002'; assert.equal(reconcile(a,b).state, 'MISMATCH');
  b.records[0].tenantId = randomUUID(); assert.throws(() => reconcile(a,b), /scope/);
});
test('live, duplicate, floating point and unbounded data fail closed', () => {
  const a = dataset(); a.synthetic = false; assert.throws(() => validateDataset(a)); a.synthetic = true;
  a.records.push(a.records[0]); assert.throws(() => validateDataset(a)); a.records.pop();
  a.records[0].quantity = 1.2; assert.throws(() => validateDataset(a));
});
