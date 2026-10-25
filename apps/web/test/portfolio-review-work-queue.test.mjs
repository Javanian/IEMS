import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedQueueMap,operationalQueueEvidence,planningQueueAction,deliveryQueueAction } from '../src/features/portfolio/operator-queue.mjs';

test('queue hydration bounds concurrent source reads, preserves source order and honors cancellation',async()=>{
  let active=0,max=0;const rows=Array.from({length:25},(_,i)=>i),pending=[];
  const result=boundedQueueMap(rows,async value=>{active++;max=Math.max(max,active);await new Promise(resolve=>pending.push(resolve));active--;return value;});
  while(pending.length || active){const batch=pending.splice(0);batch.forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));}
  assert.deepEqual(await result,rows);assert.equal(max,4);
  const controller=new AbortController();controller.abort();await assert.rejects(boundedQueueMap([1],async()=>1,{signal:controller.signal}),{name:'AbortError'});
});
test('delivery actions use actual delivery authority rather than immutable SHIPPED source status',async()=>{
  const rows=[{_id:'done',status:'SHIPPED'},{_id:'partial',status:'SHIPPED'}],calls=[];
  const enriched=await operationalQueueEvidence('delivery',rows,async path=>{calls.push(path);return {data:path.endsWith('done')?{status:'DELIVERED',remainingQuantity:'0',canConfirm:false}:{status:'PARTIALLY_DELIVERED',remainingQuantity:'2',canConfirm:true}};});
  assert.equal(calls.length,2);assert.equal(deliveryQueueAction(enriched[0]),null);assert.match(deliveryQueueAction(enriched[1]),/remaining/);assert.equal(enriched[1].delivery.remainingQuantity,'2');
  await assert.rejects(operationalQueueEvidence('delivery',rows,async()=>{throw Error('Delivery evidence unavailable');}),/Delivery evidence unavailable/);
  assert.equal(deliveryQueueAction(rows[0]),null);
});
test('a pending delivery at its confirmation limit offers evidence review rather than an unavailable confirmation',()=>{
  const row={status:'SHIPPED',delivery:{status:'PARTIALLY_DELIVERED',remainingQuantity:'2',confirmationCount:100,canConfirm:false}};
  assert.equal(deliveryQueueAction(row),'Review delivery evidence and confirmation restrictions');
  assert.doesNotMatch(deliveryQueueAction(row),/^Confirm/);
  assert.match(deliveryQueueAction({...row,delivery:{...row.delivery,canConfirm:true}}),/^Confirm/);
});
test('existing production jobs are excluded from new-job actions and lookup never runs without execution read capability',async()=>{
  const rows=[{_id:'plan-a',status:'PLANNED',planningReady:true,engineering:{status:'APPROVED_DEMAND'}},{_id:'plan-b',status:'PLANNED',planningReady:true,engineering:{status:'APPROVED_DEMAND'}}];let reads=0;
  const noAccess=await operationalQueueEvidence('planning',rows,async()=>{reads++;throw Error('Unexpected source read');});assert.equal(reads,0);assert.match(planningQueueAction(noAccess[0]),/Review approved demand/);
  const enriched=await operationalQueueEvidence('planning',rows,async path=>{reads++;return {data:path.includes('plan-a')?[{_id:'stored-job',status:'STORED'}]:[]};},{canReadExecution:true});
  assert.equal(reads,2);assert.equal(planningQueueAction(enriched[0]),null);assert.equal(planningQueueAction(enriched[1]),'Start an internal production job');
  assert.match(planningQueueAction({...enriched[1],planningReady:false}),/source restrictions/);
});
