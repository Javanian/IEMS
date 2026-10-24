import test from 'node:test';
import assert from 'node:assert/strict';
import { repairCommand, repairActions } from '../src/features/portfolio/repair.mjs';
test('repair commands preserve exact money and freeze expected version for retry', () => {
 const c = repairCommand({version: 7}, 'deposit', {amount:'9999999999999999999999999999.99',currency:'USD',reference:'owned'}, 'owned-key');
 assert.deepEqual(c,{expectedVersion:7,idempotencyKey:'owned-key',amount:'9999999999999999999999999999.99',currency:'USD',reference:'owned'});
});
test('repair lifecycle requires rework after failure and never offers QC before pass', () => {
 assert.deepEqual(repairActions({status:'REWORK'}),['rework','hold']);
 assert.deepEqual(repairActions({status:'RETURNED'}),[]);
 assert.ok(!repairActions({status:'TESTING'}).includes('qc'));
});
