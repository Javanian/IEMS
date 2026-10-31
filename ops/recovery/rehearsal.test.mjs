import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { backup, restore, rehearse } from './rehearsal.mjs';
test('restore validates integrity, parity and observed synthetic SLO bounds', () => {
  const a = { schema: 'IEMS_SYNTHETIC_PILOT_V1', synthetic: true, tenantId: randomUUID(), legalEntityId: randomUUID(), plantId: randomUUID(), records: [] };
  const now = new Date(), b = backup(a, now);
  assert.deepEqual(restore(b), a); assert.equal(rehearse(b,a,{now}).state,'PASS');
  assert.equal(rehearse(b,a,{now:new Date(now.getTime()+86400001)}).state,'FAIL');
  b.payload.tenantId = randomUUID(); assert.throws(() => restore(b), /integrity/);
});
