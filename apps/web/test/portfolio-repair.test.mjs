import test from 'node:test';
import assert from 'node:assert/strict';
import { repairCommand, repairActions } from '../src/features/portfolio/repair.mjs';
test('repair commands preserve exact money and freeze expected version for retry', () => {
 const c = repairCommand({version: 7}, 'deposit', {amount:'9999999999999999999999999999.99',currency:'USD',reference:'owned'}, 'owned-key');
 assert.deepEqual(c,{expectedVersion:7,idempotencyKey:'owned-key',amount:'9999999999999999999999999999.99',currency:'USD',reference:'owned'});
});
test('repair lifecycle requires rework after failure and never offers QC before pass', () => {
 const failed=repairActions({status:'REWORK',tests:[{run:1,result:'FAIL'}]});
 assert.deepEqual(failed,['rework','test-plan','hold']);
 for(const action of ['test','qc','execute','start'])assert.equal(failed.includes(action),false);
 assert.ok(failed.includes('rework'));
 assert.deepEqual(repairActions({status:'RETURNED'}),[]);
 assert.ok(!repairActions({status:'TESTING'}).includes('qc'));
 assert.ok(repairActions({status:'TESTING'}).includes('test'));
 assert.ok(repairActions({status:'TEST_PASSED',tests:[{run:2,result:'PASS'}]}).includes('qc'));
 assert.deepEqual(repairActions({status:'AUTHORIZED',serviceProfile:'REPAIR_SERVICE_V1'}),['deposit','orders','test-plan','hold']);
 assert.ok(!repairActions({status:'AUTHORIZED',serviceProfile:'REPAIR_SERVICE_V1'}).includes('start'));
 assert.ok(repairActions({status:'AUTHORIZED',serviceProfile:'REPAIR_SERVICE_V1',serviceOrders:{salesOrderId:'so',workOrderId:'wo'}}).includes('start'));
});
