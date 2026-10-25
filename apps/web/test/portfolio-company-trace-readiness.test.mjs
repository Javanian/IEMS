import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTraceRead } from './company-trace-readiness.mjs';

const url='http://localhost/portfolio-api/api/company-stock/receipts/r/units/u/trace';
function events(call) {
  const listeners=new Set();return { subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},call,emit:async(method,params)=>Promise.all([...listeners].map(listener=>listener({method,params}))),listeners };
}
test('fresh trace readiness ignores other units, methods and old responses, and waits for the matching body to finish', async()=>{
  const expected={serial:'COMP-α',current:{stockVersion:8}},calls=[],stream=events(async(method,params)=>{calls.push({method,...params});return {base64Encoded:true,body:Buffer.from(JSON.stringify({data:expected})).toString('base64')};}),read=observeTraceRead({...stream,url});let resolved=false;read.response.then(()=>{resolved=true;});
  try {
    await stream.emit('Network.requestWillBeSent',{requestId:'wrong-unit',request:{method:'GET',url:url.replace('/u/trace','/other/trace')}});
    await stream.emit('Network.requestWillBeSent',{requestId:'wrong-method',request:{method:'POST',url}});
    await stream.emit('Network.responseReceived',{requestId:'old',response:{status:200}});await stream.emit('Network.loadingFinished',{requestId:'old'});assert.equal(resolved,false);
    await stream.emit('Network.requestWillBeSent',{requestId:'fresh',request:{method:'GET',url}});await stream.emit(undefined,undefined);await stream.emit('Network.responseReceived',{requestId:'fresh',response:{status:200}});assert.equal(resolved,false);assert.equal(calls.length,0);
    await stream.emit('Network.loadingFinished',{requestId:'fresh'});assert.deepEqual(await read.response,{requestId:'fresh',url,status:200,data:expected,attempts:[{requestId:'fresh',status:200,outcome:'completed'}]});assert.deepEqual(calls,[{method:'Network.getResponseBody',requestId:'fresh'}]);assert.equal(stream.listeners.size,0);
  } finally {read.close();}
});
test('a genuinely canceled mount read permits only a completed actual replacement, including replacement-before-abort ordering', async()=>{
  for(const replacementFirst of [false,true]) {
    const calls=[],data={serial:'COMP-1',current:{stockVersion:9}},stream=events(async(method,{requestId})=>{calls.push(requestId);return {body:JSON.stringify({data})};}),read=observeTraceRead({...stream,url});
    await stream.emit('Network.requestWillBeSent',{requestId:'mount',request:{method:'GET',url}});
    if(replacementFirst)await stream.emit('Network.requestWillBeSent',{requestId:'replacement',request:{method:'GET',url}});
    await stream.emit('Network.loadingFailed',{requestId:'mount',errorText:'net::ERR_ABORTED',canceled:true});
    if(!replacementFirst)await stream.emit('Network.requestWillBeSent',{requestId:'replacement',request:{method:'GET',url}});
    await stream.emit('Network.responseReceived',{requestId:'replacement',response:{status:200}});await stream.emit('Network.loadingFinished',{requestId:'replacement'});
    const result=await read.response;assert.equal(result.requestId,'replacement');assert.deepEqual(result.data,data);assert.deepEqual(calls,['replacement']);assert.deepEqual(result.attempts.map(row=>row.outcome),['aborted','completed']);assert.equal(result.attempts[0].canceled,true);assert.equal(stream.listeners.size,0);
  }
});
test('abort without replacement stays bounded, and denied or other failed candidates cannot be hidden by a later replacement', async()=>{
  const lone=events(async()=>{}),read=observeTraceRead({...lone,url,timeoutMs:10});await lone.emit('Network.requestWillBeSent',{requestId:'mount',request:{method:'GET',url}});await lone.emit('Network.loadingFailed',{requestId:'mount',errorText:'net::ERR_ABORTED',canceled:true});await assert.rejects(read.response,/Timed out.*aborted/);assert.equal(lone.listeners.size,0);
  for(const failure of [{status:403},{status:409},{errorText:'net::ERR_ABORTED',canceled:false},{errorText:'net::ERR_INTERNET_DISCONNECTED',canceled:true}]) {
    const stream=events(async()=>({body:'{"data":{"serial":"unexpected"}}'})),candidate=observeTraceRead({...stream,url});await stream.emit('Network.requestWillBeSent',{requestId:'first',request:{method:'GET',url}});await stream.emit('Network.requestWillBeSent',{requestId:'replacement',request:{method:'GET',url}});
    if(failure.status) {await stream.emit('Network.responseReceived',{requestId:'first',response:{status:failure.status}});await stream.emit('Network.loadingFailed',{requestId:'first',errorText:'net::ERR_ABORTED',canceled:true});}
    else await stream.emit('Network.loadingFailed',{requestId:'first',...failure});
    await stream.emit('Network.responseReceived',{requestId:'replacement',response:{status:200}});await stream.emit('Network.loadingFinished',{requestId:'replacement'});await assert.rejects(candidate.response,/returned 40[39]|failed:/);assert.equal(stream.listeners.size,0);
  }
});
test('a canceled newest candidate cannot fall back to an earlier completed body', async()=>{
  for(const replacement of [false,true]) {
    const stream=events(async(method,{requestId})=>({body:JSON.stringify({data:{serial:requestId}})})),read=observeTraceRead({...stream,url,timeoutMs:30});
    await stream.emit('Network.requestWillBeSent',{requestId:'earlier',request:{method:'GET',url}});await stream.emit('Network.requestWillBeSent',{requestId:'newer',request:{method:'GET',url}});
    await stream.emit('Network.responseReceived',{requestId:'earlier',response:{status:200}});await stream.emit('Network.loadingFinished',{requestId:'earlier'});await stream.emit('Network.loadingFailed',{requestId:'newer',errorText:'net::ERR_ABORTED',canceled:true});
    if(!replacement)await assert.rejects(read.response,/Timed out.*earlier.*newer/);
    else {await stream.emit('Network.requestWillBeSent',{requestId:'actual-replacement',request:{method:'GET',url}});await stream.emit('Network.responseReceived',{requestId:'actual-replacement',response:{status:200}});await stream.emit('Network.loadingFinished',{requestId:'actual-replacement'});const result=await read.response;assert.equal(result.requestId,'actual-replacement');assert.equal(result.data.serial,'actual-replacement');assert.deepEqual(result.attempts.map(row=>row.outcome),['completed','aborted','completed']);}
    assert.equal(stream.listeners.size,0);
  }
});
test('failed or denied fresh reads cannot be accepted as a successful old matching trace', async()=>{
  for(const status of [403,409]) {
    const stream=events(async()=>{throw Error('Body should not be treated as successful');}),read=observeTraceRead({...stream,url});
    await stream.emit('Network.requestWillBeSent',{requestId:'fresh',request:{method:'GET',url}});await stream.emit('Network.responseReceived',{requestId:'fresh',response:{status}});await stream.emit('Network.loadingFinished',{requestId:'fresh'});await assert.rejects(read.response,new RegExp(`returned ${status}`));assert.equal(stream.listeners.size,0);
  }
  const stream=events(async()=>{}),read=observeTraceRead({...stream,url});await stream.emit('Network.requestWillBeSent',{requestId:'fresh',request:{method:'GET',url}});await stream.emit('Network.loadingFailed',{requestId:'fresh',errorText:'net::ERR_INTERNET_DISCONNECTED'});await assert.rejects(read.response,/INTERNET_DISCONNECTED/);assert.equal(stream.listeners.size,0);
});
test('an action that never starts its intended trace read has a bounded failure and removes its observer', async()=>{
  const stream=events(async()=>{}),read=observeTraceRead({...stream,url,timeoutMs:10});await assert.rejects(read.response,/Timed out waiting for a fresh completed trace GET/);assert.equal(stream.listeners.size,0);
});
