import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { assertOwnedWebAddress,probeOwnedWeb,webTransportTelemetry } from './web-transport-telemetry.mjs';

const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

test('owned IPv4 HTTP probe reads real response without credentials or browser state',async()=>{
  const seen=[],server=createServer((request,response)=>{seen.push({method:request.method,url:request.url,headers:request.headers});response.writeHead(200);response.end('actual diagnostic response');});
  const telemetry=webTransportTelemetry('http://127.0.0.1:1');telemetry.attachServer(server);
  await listen(server);
  try{
    const {port}=server.address(),origin=`http://127.0.0.1:${port}`;
    assert.equal(assertOwnedWebAddress(server,port).address,'127.0.0.1');assert.throws(()=>assertOwnedWebAddress(server,port+1));
    const result=await probeOwnedWeb(origin,'/src/main.jsx');
    assert.equal(result.status,200);assert.equal(result.remoteAddress,'127.0.0.1');assert.equal(result.remotePort,port);
    assert.equal(seen[0].method,'GET');assert.equal(seen[0].url,'/src/main.jsx');assert.equal(seen[0].headers.cookie,undefined);assert.equal(seen[0].headers.authorization,undefined);
    assert.throws(()=>probeOwnedWeb(origin,'http://localhost:1/'),/owned origin/);
  }finally{await close(server);}
  assert.deepEqual(telemetry.snapshot(server).lifecycle.map(row=>row.event),['attached-before-listen','listening','close']);
  assert.equal(telemetry.snapshot(server).server.listening,false);
});

test('diagnostic HTTP stalls are bounded and refused listeners remain failure evidence',async()=>{
  const server=createServer(()=>{});await listen(server);const origin=`http://127.0.0.1:${server.address().port}`;
  try{assert.equal((await probeOwnedWeb(origin,'/',{timeoutMs:25})).error,'PROBE_TIMEOUT');}
  finally{server.closeAllConnections();await close(server);}
  assert.equal((await probeOwnedWeb(origin,'/',{timeoutMs:1000})).error,'ECONNREFUSED');
});

test('resource telemetry keeps bounded exact request timing, address and terminal failure evidence',()=>{
  const origin='http://127.0.0.1:4173',telemetry=webTransportTelemetry(origin,{limit:2,logLimit:1});
  const start=(id,type='Script')=>telemetry.event({method:'Network.requestWillBeSent',params:{requestId:id,request:{url:`${origin}/src/${id}.jsx`,method:'GET'},type,timestamp:10,wallTime:20,frameId:'frame',loaderId:'loader',initiator:{type:'parser'}}});
  telemetry.event({id:1,result:{}});start('ignored','XHR');start('old');start('style','Stylesheet');start('current');
  telemetry.event({method:'Network.responseReceived',params:{requestId:'current',timestamp:11,response:{status:200,remoteIPAddress:'127.0.0.1',remotePort:4173,connectionId:7,connectionReused:true,protocol:'http/1.1'}}});
  telemetry.event({method:'Network.loadingFinished',params:{requestId:'current',timestamp:12,encodedDataLength:45}});
  telemetry.event({method:'Network.loadingFailed',params:{requestId:'style',timestamp:13,errorText:'net::ERR_CONNECTION_REFUSED',canceled:false}});
  for(const text of ['earlier','latest'])telemetry.event({method:'Log.entryAdded',params:{entry:{source:'network',level:'error',text}}});
  telemetry.command('ack','Network.emulateNetworkConditions',{offline:false});
  const result=telemetry.snapshot();assert.equal(result.evictedResources,1);assert.equal(result.resources.length,2);assert.equal(result.logs[0].text,'latest');
  const current=result.resources.find(row=>row.requestId==='current');assert.equal(current.timestamp,10);assert.equal(current.responseTimestamp,11);assert.equal(current.finishedTimestamp,12);assert.equal(current.remoteIPAddress,'127.0.0.1');assert.equal(current.remotePort,4173);assert.equal(current.frameId,'frame');assert.equal(current.loaderId,'loader');assert.equal(current.connectionReused,true);
  assert.equal(result.resources.find(row=>row.requestId==='style').errorText,'net::ERR_CONNECTION_REFUSED');assert.equal(result.commands[0].offline,false);
});

test('failure probes never run before an owned listener starts',async()=>{
  const server=createServer((request,response)=>response.end('read only')),telemetry=webTransportTelemetry('http://127.0.0.1:1');telemetry.attachServer(server);
  assert.deepEqual((await telemetry.failure(server)).probes,[]);
  assert.equal((await telemetry.failure(server)).probeSkipped,'Owned listener never started');
});
