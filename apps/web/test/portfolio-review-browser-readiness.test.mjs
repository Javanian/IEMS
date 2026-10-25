import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationContextChanged,documentNavigationCall } from './browser-readiness.mjs';
test('readiness retries only known CDP navigation context transitions and preserves actual failures',()=>{for(const message of ['Inspected target navigated or closed','Execution context was destroyed.','Cannot find context with specified id'])assert.equal(navigationContextChanged({code:-32000,message}),true);for(const error of [{code:-32000,message:'Target crashed'},{code:-32601,message:'Inspected target navigated or closed'},Error('Assertion failed'),{code:500,message:'Database unavailable'}])assert.equal(navigationContextChanged(error),false);});
const documentState=(timeOrigin,readyState='complete')=>({result:{value:{timeOrigin,readyState,href:'http://owned/portfolio/repair/cases/actual-id'}}});
function navigationFixture(states,result={loaderId:'new-loader'}) {
  const calls=[];
  const call=documentNavigationCall(async(method,params,sessionId)=>{
    calls.push({method,params,sessionId});
    if(method!=='Runtime.evaluate')return result;
    const next=states.shift();
    if(next instanceof Error || next?.code)throw next;
    assert.ok(next,'unexpected document inspection');return next;
  },{attempts:5,pause:async()=>{}});
  return {call,calls};
}
test('reload waits through old visible DOM and new loading document before any caller status assertion',async()=>{
  const {call,calls}=navigationFixture([documentState(10),documentState(10),documentState(10),documentState(20,'loading'),documentState(20)]);
  await call('Page.reload',{},'actor');
  assert.equal(calls.filter(row=>row.method==='Page.reload').length,1);
  assert.equal(calls.filter(row=>row.method==='Runtime.evaluate').length,5);
  assert.ok(calls.every(row=>row.sessionId==='actor'));
});
test('full navigation requires a new complete document after the navigation is dispatched once',async()=>{
  const {call,calls}=navigationFixture([documentState(10),documentState(10),documentState(20,'interactive'),documentState(20)]);
  assert.deepEqual(await call('Page.navigate',{url:'http://owned/portfolio/orders'}),{loaderId:'new-loader'});
  assert.equal(calls.filter(row=>row.method==='Page.navigate').length,1);
  assert.equal(calls.at(-1).method,'Runtime.evaluate');
});
test('same-document hash navigation without a loader does not wait for an impossible new time origin',async()=>{
  const {call,calls}=navigationFixture([documentState(10)],{frameId:'same-frame'});
  await call('Page.navigate',{url:'http://owned/portfolio/orders#details'});
  assert.deepEqual(calls.map(row=>row.method),['Runtime.evaluate','Page.navigate']);
});
test('navigation readiness retries known context resets but never repeats the navigation command',async()=>{
  const transient={code:-32000,message:'Inspected target navigated or closed'};
  const {call,calls}=navigationFixture([transient,documentState(10),transient,documentState(20)]);
  await call('Page.reload');
  assert.equal(calls.filter(row=>row.method==='Page.reload').length,1);
});
test('failed navigation commands are never retried or converted into a successful readiness result',async()=>{
  let navigations=0;
  const call=documentNavigationCall(async method=>{
    if(method==='Runtime.evaluate')return documentState(10);
    navigations++;throw Object.assign(Error('Target crashed'),{code:-32000});
  },{pause:async()=>{}});
  await assert.rejects(call('Page.reload'),/Target crashed/);
  assert.equal(navigations,1);
});
test('unrelated evaluation failures and explicit navigation errorText remain visible failures',async()=>{
  const {call}=navigationFixture([documentState(10),Object.assign(Error('Unexpected evaluation failure'),{code:-32000})]);
  await assert.rejects(call('Page.reload'),/Unexpected evaluation failure/);
  const failed=navigationFixture([documentState(10)],{errorText:'net::ERR_CONNECTION_REFUSED'});
  await assert.rejects(failed.call('Page.navigate',{url:'http://owned/unavailable'}),/ERR_CONNECTION_REFUSED/);
});
test('an unchanged complete old document times out instead of satisfying the reload barrier',async()=>{
  const {call,calls}=navigationFixture(Array.from({length:6},()=>documentState(10)));
  await assert.rejects(call('Page.reload'),/Timed out: new complete document/);
  assert.equal(calls.filter(row=>row.method==='Page.reload').length,1);
});
