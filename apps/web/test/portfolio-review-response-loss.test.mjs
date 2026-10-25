import test from 'node:test';
import assert from 'node:assert/strict';
import { responseLoss } from './portfolio-wave3d-transport.mjs';

function fixture(timeoutMs=25) {
  let listener,unsubscribed=0;const calls=[];
  const lose=responseLoss({timeoutMs,subscribe:value=>{listener=value;return ()=>unsubscribed++;},call:async(method,params)=>{calls.push({method,params});if(method==='Fetch.getResponseBody')return {body:JSON.stringify({data:{_id:'actual-result',status:'APPROVED'}})};return {};}});
  const intercepted=()=>listener({method:'Fetch.requestPaused',params:{requestId:'response-1',responseStatusCode:200,request:{postData:JSON.stringify({idempotencyKey:'captured-key',expectedVersion:3}),headers:{cookie:'owned-session'}}}});
  return {lose,calls,intercepted,unsubscribed:()=>unsubscribed};
}
test('response loss verifies the committed result before failing the real response and returns captured command',async()=>{
  const f=fixture(),order=[];
  const result=await f.lose('*/api/actual/approve',async()=>{order.push('native-submit');await f.intercepted();},async({command,receipt})=>{assert.equal(command.expectedVersion,3);assert.equal(receipt.data.status,'APPROVED');assert.equal(f.calls.some(row=>row.method==='Fetch.failRequest'),false);order.push('committed-proof');});
  assert.equal(result.command.idempotencyKey,'captured-key');assert.deepEqual(order,['native-submit','committed-proof']);
  assert.deepEqual(f.calls.map(row=>row.method),['Fetch.enable','Fetch.getResponseBody','Fetch.failRequest','Fetch.disable']);assert.equal(f.unsubscribed(),1);
});
test('a native submit which produces no matching response has a bounded explicit failure and no automatic repeat',async()=>{
  const f=fixture();let submits=0;
  await assert.rejects(f.lose('*/api/missing-response',async()=>{submits++;},async()=>{}),/Response-loss deadline 25ms:.*missing-response.*waiting for matching response/);
  assert.equal(submits,1);assert.equal(f.unsubscribed(),1);assert.equal(f.calls.at(-1).method,'Fetch.disable');
});
test('a stalled submit callback is also bounded and interception is cleaned up',async()=>{
  const f=fixture();await assert.rejects(f.lose('*/api/stalled',()=>new Promise(()=>{}),async()=>{}),/dispatching native submit/);
  assert.equal(f.unsubscribed(),1);assert.equal(f.calls.at(-1).method,'Fetch.disable');
});
test('committed proof and submit failures remain visible and are never converted into successful loss probes',async()=>{
  const f=fixture();await assert.rejects(f.lose('*/api/actual',f.intercepted,async()=>{throw Error('Independent database mismatch');}),/Independent database mismatch/);
  assert.equal(f.calls.some(row=>row.method==='Fetch.failRequest'),false);assert.equal(f.calls.at(-1).method,'Fetch.disable');
  const g=fixture();await assert.rejects(g.lose('*/api/actual',async()=>{throw Error('Native control unavailable');},async()=>{}),/Native control unavailable/);assert.equal(g.unsubscribed(),1);
});
test('missing native submit or committed proof is rejected before interception is armed',async()=>{
  const f=fixture();await assert.rejects(f.lose('*/api/actual'),/native submit callback/);await assert.rejects(f.lose('*/api/actual',async()=>{}),/committed-state proof/);assert.deepEqual(f.calls,[]);
});
