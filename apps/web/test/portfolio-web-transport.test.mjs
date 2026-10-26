import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { join,dirname,resolve,win32,posix } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from '@babel/parser';
import { runInNewContext } from 'node:vm';
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

async function actualChromeLauncher() {
  const source=await readFile(new URL('./portfolio-browser.mjs',import.meta.url),'utf8'),ast=parse(source,{sourceType:'module'});
  const main=ast.program.body.find(node=>node.type==='TryStatement'&&node.block.body.some(statement=>statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression'&&statement.expression.left.name==='chrome'))?.block.body;
  assert.ok(main,'Inspect the actual runner Chrome spawn, without importing or running its services');
  const start=main.findIndex(node=>node.type==='VariableDeclaration'&&node.declarations.some(declaration=>declaration.id.name==='chromeArgs'));
  const spawn=main.findIndex(node=>node.type==='ExpressionStatement'&&node.expression.type==='AssignmentExpression'&&node.expression.left.name==='chrome');
  assert.ok(start>=0&&spawn>start);
  const update=main.findIndex(node=>node.type==='ExpressionStatement'&&node.expression.type==='AssignmentExpression'&&node.expression.left.object?.name==='browserRuntime'&&node.expression.left.property?.name==='browserVersion');
  assert.ok(update>spawn);
  const cleanup=ast.program.body.find(node=>node.type==='TryStatement'&&node.finalizer)?.finalizer.body;
  assert.ok(cleanup?.[2]?.test?.left?.object?.name==='chrome');
  return {launch:source.slice(main[start].start,main[spawn].end),update:source.slice(main[update].start,main[update+2].end),cleanup:source.slice(cleanup[0].start,cleanup[2].end)};
}
function executeLaunch(source,{evidence,profile,platform,joinPath=join,write=async()=>{},spawn=()=>({}),binary,web='http://127.0.0.1:4173'}={}) {
  return runInNewContext(`(async()=>{${source}})()`,{evidence,profile,web,join:joinPath,process:{platform,arch:'test-architecture',env:{PORTFOLIO_CHROME_BINARY:binary,PRIVATE_PASSWORD:'not-to-be-recorded'}},writeFile:write,spawn,chrome:null},{timeout:1000});
}

test('actual Chrome spawn preserves default behavior and serializes bounded Default NetLog into its external evidence path',async()=>{
  const actual=await actualChromeLauncher();
  for(const [platform,paths,binary]of [['win32',win32,'C:/Program Files/Google/Chrome/Application/chrome.exe'],['darwin',posix,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],['linux',posix,'google-chrome']]){
    const evidence=paths.join(platform==='win32'?'C:/owned evidence 測試':'/owned evidence 測試','fresh-attempt'),profile=paths.join(platform==='win32'?'C:/owned profiles':'/owned profiles','separate-profile'),writes=[],launches=[];
    await executeLaunch(actual.launch,{evidence,profile,platform,joinPath:paths.join,write:async(...args)=>writes.push(args),spawn:(...args)=>{launches.push(args);return {};}});
    assert.equal(launches.length,1);assert.equal(launches[0][0],binary);
    const args=Array.from(launches[0][1]),netlog=paths.join(evidence,'chrome-netlog.json');
    assert.deepEqual(args.filter(arg=>!arg.startsWith('--log-net-log=')&&!arg.startsWith('--net-log-')),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank']);
    assert.equal(args.filter(arg=>arg===`--log-net-log=${netlog}`).length,1);
    assert.equal(paths.dirname(netlog),evidence);assert.notEqual(paths.dirname(netlog),profile);
    assert.equal(args.filter(arg=>arg==='--net-log-capture-mode=Default').length,1);assert.equal(args.filter(arg=>arg==='--net-log-max-size-mb=8').length,1);
    assert.equal(args.some(arg=>/disable-features|enable-features|retry|timeout|ignore-certificate|IncludeSensitive|Everything/i.test(arg)),false);
    assert.deepEqual(JSON.parse(JSON.stringify(launches[0][2])),{stdio:['ignore','ignore','pipe']});
    assert.deepEqual(writes.map(([path,,options])=>[path,options.flag]),[[paths.join(evidence,'browser-runtime.json'),'wx'],[netlog,'wx']]);
    const metadata=JSON.parse(writes[0][1]);assert.deepEqual(metadata.launch.arguments,args);assert.equal(metadata.ownedWebOrigin,'http://127.0.0.1:4173');assert.equal(metadata.platform.host,platform);assert.equal(metadata.netLog.configuredMaxSizeMiB,8);assert.equal(metadata.netLog.captureMode,'Default');assert.equal(metadata.browserVersion,null);assert.doesNotMatch(writes[0][1],/not-to-be-recorded/);
  }
});

test('actual launch refuses reused NetLog or runtime artifacts before spawning and preserves earlier evidence',async()=>{
  const actual=await actualChromeLauncher(),owned=await mkdtemp(join(tmpdir(),'iems-netlog-launch-'));
  assert.equal(dirname(owned),resolve(tmpdir()));
  try{
    const evidence=join(owned,'fresh evidence 測試'),profile=join(owned,'separate profile');await mkdir(evidence);let launches=0;
    const options={evidence,profile,platform:process.platform,write:writeFile,spawn:()=>{launches++;return {};}};
    await executeLaunch(actual.launch,options);assert.equal(launches,1);
    const metadata=await readFile(join(evidence,'browser-runtime.json'),'utf8');await writeFile(join(evidence,'chrome-netlog.json'),'earlier NetLog evidence');
    await assert.rejects(executeLaunch(actual.launch,options),{code:'EEXIST'});assert.equal(launches,1);
    assert.equal(await readFile(join(evidence,'browser-runtime.json'),'utf8'),metadata);assert.equal(await readFile(join(evidence,'chrome-netlog.json'),'utf8'),'earlier NetLog evidence');
    const other=join(owned,'new evidence with existing netlog');await mkdir(other);await writeFile(join(other,'chrome-netlog.json'),'existing partial log');
    await assert.rejects(executeLaunch(actual.launch,{...options,evidence:other}),{code:'EEXIST'});assert.equal(launches,1);assert.equal(await readFile(join(other,'chrome-netlog.json'),'utf8'),'existing partial log');
  }finally{await rm(owned,{recursive:true,force:true});}
});

test('actual runtime metadata records the CDP version and browser platform without claiming a flushed NetLog',async()=>{
  const actual=await actualChromeLauncher(),version={protocolVersion:'1.3',product:'Chrome/actual-protocol-response',revision:'actual-revision',userAgent:'actual-browser-agent',jsVersion:'actual-v8'},calls=[],writes=[],browserRuntime={platform:{host:'linux',architecture:'test'},netLog:{configuredMaxSizeMiB:8,flushVerification:'Not checked by this runner'}};
  await runInNewContext(`(async()=>{${actual.update}})()`,{browserRuntime,chromeRuntimePath:'/owned evidence 測試/fresh/browser-runtime.json',call:async(...args)=>{calls.push(args);return version;},evaluate:async expression=>{assert.equal(expression,'navigator.platform');return 'actual-browser-platform';},writeFile:async(...args)=>writes.push(args)},{timeout:1000});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['Browser.getVersion',{},null]]);assert.equal(writes.length,1);
  const metadata=JSON.parse(writes[0][1]);assert.deepEqual(metadata.browserVersion,version);assert.equal(metadata.platform.browser,'actual-browser-platform');assert.equal(metadata.netLog.flushVerification,'Not checked by this runner');assert.equal(metadata.netLog.configuredMaxSizeMiB,8);assert.equal(Object.hasOwn(metadata,'environment'),false);
});

test('actual Chrome cleanup requests browser exit before bounded owned-child grace and preserves fallback kill',async()=>{
  const actual=await actualChromeLauncher();
  for(const outcome of ['graceful','timeout','already-exited']){
    const events=[],listeners=new Map(),timers=new Set();let pending,reached;
    const boundary=new Promise(resolve=>{reached=resolve;});
    const chrome={exitCode:outcome==='already-exited'?0:null,signalCode:null,once(name,callback){events.push(`listen:${name}`);listeners.set(name,callback);},removeListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);},kill(){events.push('owned-kill');}};
    const ws={readyState:1,close(){events.push('socket-close');if(outcome==='already-exited')reached();}};
    const completion=runInNewContext(`(async()=>{${actual.cleanup}})()`,{chrome,ws,call:async(method,params,session)=>{assert.equal(method,'Browser.close');assert.deepEqual(JSON.parse(JSON.stringify(params)),{});assert.equal(session,null);events.push('browser-close');},setTimeout(callback,ms){assert.equal(ms,5000);events.push('exit-grace');pending=callback;timers.add(1);reached();return 1;},clearTimeout(id){timers.delete(id);}},{timeout:1000});
    await boundary;
    assert.deepEqual(events.slice(0,2),['browser-close','socket-close']);
    if(outcome==='graceful'){assert.equal(events.includes('owned-kill'),false);chrome.exitCode=0;listeners.get('exit')();}
    else if(outcome==='timeout'){assert.equal(events.includes('owned-kill'),false);pending();}
    await completion;
    assert.equal(events.includes('owned-kill'),outcome==='timeout');
    assert.equal(events.includes('exit-grace'),outcome!=='already-exited');
    if(outcome==='timeout')assert.ok(events.indexOf('exit-grace')<events.indexOf('owned-kill'));
    assert.equal(listeners.size,0);assert.equal(timers.size,0);
  }
});
