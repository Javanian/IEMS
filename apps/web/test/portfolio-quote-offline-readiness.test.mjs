import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { runInNewContext } from 'node:vm';
import { isOfflineQuoteRoot, isRecoveredQuoteRoot, observeOfflineQuoteRead,requireOwnedOnlineNetwork } from './quote-offline-readiness.mjs';

const url='http://localhost/portfolio-api/api/commercial/quotes/quote-a';
function events(){const listeners=new Set();return {subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},emit:(method,params)=>{for(const listener of [...listeners])listener({method,params});},listeners};}
test('a stale DOM connection error and unrelated account failures cannot prove a newly completed quote offline request',async()=>{
  const state={pathname:'/portfolio/quotes/quote-a',heading:null,statusText:null,loading:false,rootError:{text:'Check the connection and retry',retryButtons:1}};assert.equal(isOfflineQuoteRoot(state,'quote-a'),true);
  const stream=events(),read=observeOfflineQuoteRead({...stream,url,timeoutMs:10});stream.emit('Network.requestWillBeSent',{requestId:'account',request:{method:'GET',url:'http://localhost/portfolio-api/api/crm/accounts/a'}});stream.emit('Network.loadingFailed',{requestId:'account',errorText:'net::ERR_INTERNET_DISCONNECTED'});stream.emit('Network.loadingFailed',{requestId:'old-quote',errorText:'net::ERR_INTERNET_DISCONNECTED'});await assert.rejects(read.response,/No completed new offline quote GET/);assert.equal(stream.listeners.size,0);
});
test('offline quote completion retains canceled lifecycle candidates but requires the newest actual disconnected request',async()=>{
  const stream=events(),read=observeOfflineQuoteRead({...stream,url});stream.emit('Network.requestWillBeSent',{requestId:'mount',timestamp:10,request:{method:'GET',url}});stream.emit(undefined,undefined);stream.emit('Network.requestWillBeSent',{requestId:'replacement',timestamp:11,request:{method:'GET',url}});stream.emit('Network.loadingFailed',{requestId:'mount',timestamp:12,errorText:'net::ERR_ABORTED',canceled:true});stream.emit('Network.loadingFailed',{requestId:'replacement',timestamp:13,errorText:'net::ERR_INTERNET_DISCONNECTED',canceled:false});const result=await read.response;assert.equal(result.requestId,'replacement');assert.deepEqual(result.attempts.map(row=>row.outcome),['aborted','offline']);assert.equal(result.attempts[1].finishedAt,13);assert.equal(stream.listeners.size,0);
});
test('denial, other network failures and abort without replacement never count as the intended offline fault',async()=>{
  for(const failure of [{method:'Network.responseReceived',response:{status:403}},{method:'Network.loadingFailed',errorText:'net::ERR_CONNECTION_CLOSED',canceled:false},{method:'Network.loadingFailed',errorText:'net::ERR_ABORTED',canceled:false}]){const stream=events(),read=observeOfflineQuoteRead({...stream,url});stream.emit('Network.requestWillBeSent',{requestId:'q',request:{method:'GET',url}});const {method,...params}=failure;stream.emit(method,{requestId:'q',...params});await assert.rejects(read.response,/instead of|required|Unexpected offline/);assert.equal(stream.listeners.size,0);}
  const stream=events(),read=observeOfflineQuoteRead({...stream,url,timeoutMs:10});stream.emit('Network.requestWillBeSent',{requestId:'q',request:{method:'GET',url}});stream.emit('Network.loadingFailed',{requestId:'q',errorText:'net::ERR_ABORTED',canceled:true});await assert.rejects(read.response,/No completed new offline quote GET/);
});
test('top-level resource and recovered quote identity cannot be replaced by nested errors or an old success status',()=>{
  const offline={pathname:'/portfolio/quotes/q',heading:null,statusText:null,loading:false,rootError:{text:'Check the connection and retry',retryButtons:1}};assert.equal(isOfflineQuoteRoot(offline,'q'),true);for(const patch of [{heading:'Quote'},{statusText:'Status: Order created'},{loading:true},{rootError:{text:'Access denied',retryButtons:1}},{pathname:'/portfolio/quotes/other'}])assert.equal(isOfflineQuoteRoot({...offline,...patch},'q'),false);
  const expected={_id:'q',version:6,orderId:'order-a'},loaded={pathname:'/portfolio/quotes/q',heading:'Quote',statusText:'Status: Order created',loading:false,rootError:null,auditText:'Quote ID: q · Version 6',orderLinks:['/portfolio/orders/order-a']};assert.equal(isRecoveredQuoteRoot(loaded,expected),true);for(const patch of [{auditText:'Quote ID: q · Version 5'},{orderLinks:['/portfolio/orders/other']},{rootError:offline.rootError},{heading:null}])assert.equal(isRecoveredQuoteRoot({...loaded,...patch},expected),false);
});

const ownedOrigin='http://127.0.0.1:4173',frameId='current-main',nonce='01234567-89ab-4cde-8fab-0123456789ab';
function probeCalls(resource,{frame={id:frameId,url:`${ownedOrigin}/portfolio/quotes/q`},closeError}={}){
  const calls=[];
  return {calls,call:async(method,params)=>{calls.push({method,params});if(method==='Page.getFrameTree')return {frameTree:{frame}};if(method==='Network.loadNetworkResource'){if(resource instanceof Error)throw resource;return {resource};}if(method==='IO.close'){if(closeError)throw closeError;return {};}throw Error(`Unexpected command ${method}`);}};
}

test('actual owned-network precondition completes one uncached nonbusiness read and closes its stream before continuation',async()=>{
  const h=probeCalls({success:true,httpStatusCode:200,netError:0,stream:'owned-stream'}),evidence={};let continued=false;
  await requireOwnedOnlineNetwork({...h,ownedOrigin,frameId,nonce,evidence});continued=true;
  assert.equal(continued,true);assert.deepEqual(h.calls.map(x=>x.method),['Page.getFrameTree','Network.loadNetworkResource','IO.close']);
  const request=h.calls[1].params,target=new URL(request.url);assert.equal(request.frameId,frameId);assert.equal(target.origin,ownedOrigin);assert.equal(target.pathname,'/');assert.equal(target.searchParams.get('portfolio_network_probe'),nonce);assert.deepEqual(request.options,{disableCache:true,includeCredentials:false});assert.deepEqual(h.calls[2].params,{handle:'owned-stream'});
  assert.deepEqual(evidence.result,{success:true,httpStatusCode:200,netError:0,netErrorName:null});assert.equal(evidence.closed,true);assert.equal(evidence.closeAttempted,true);assert.equal(Object.hasOwn(evidence,'body'),false);
  for(const key of ['startedUTC','closedUTC','completedUTC'])assert.ok(Number.isFinite(Date.parse(evidence[key])));assert.ok(Date.parse(evidence.startedUTC)<=Date.parse(evidence.closedUTC)&&Date.parse(evidence.closedUTC)<=Date.parse(evidence.completedUTC));
});

test('failed, denied, incomplete or unclosed owned reads stop continuation without a second probe',async()=>{
  for(const resource of [{success:false,httpStatusCode:200},{success:true,httpStatusCode:503},{httpStatusCode:200},{success:true,httpStatusCode:200,netError:-106},{success:true,httpStatusCode:200,netErrorName:'net::ERR_INTERNET_DISCONNECTED'},Error('protocol failure')]){
    const h=probeCalls(resource instanceof Error?resource:{...resource,stream:'returned-even-on-failure'}),evidence={};let continued=false;
    await assert.rejects(async()=>{await requireOwnedOnlineNetwork({...h,ownedOrigin,frameId,nonce,evidence});continued=true;});assert.equal(continued,false);assert.equal(h.calls.filter(x=>x.method==='Network.loadNetworkResource').length,1);
    assert.equal(h.calls.filter(x=>x.method==='IO.close').length,resource instanceof Error?0:1);if(!(resource instanceof Error))assert.equal(evidence.closed,true);assert.equal(Object.hasOwn(evidence,'completedUTC'),false);
  }
  const h=probeCalls({success:true,httpStatusCode:200,stream:'unclosed'},{closeError:Error('close failed')}),evidence={};let continued=false;
  await assert.rejects(async()=>{await requireOwnedOnlineNetwork({...h,ownedOrigin,frameId,nonce,evidence});continued=true;},/close failed/);assert.equal(continued,false);assert.equal(evidence.closeAttempted,true);assert.equal(evidence.closed,false);assert.match(evidence.closeError,/close failed/);assert.equal(h.calls.length,3);
});

test('unsafe origins, subframes, stale frames and missing fresh nonce cannot start the owned probe',async()=>{
  for(const origin of ['http://localhost:4173','https://127.0.0.1:4173','http://127.0.0.1:0','http://127.0.0.1:4173/other','http://user:password@127.0.0.1:4173']){
    const h=probeCalls({success:true,httpStatusCode:200});await assert.rejects(requireOwnedOnlineNetwork({...h,ownedOrigin:origin,frameId,nonce}));assert.equal(h.calls.length,0);
  }
  for(const frame of [{id:'other-main',url:ownedOrigin},{id:frameId,parentId:'parent',url:ownedOrigin},{id:frameId,url:'http://127.0.0.1:4313/'}]){
    const h=probeCalls({success:true,httpStatusCode:200},{frame});await assert.rejects(requireOwnedOnlineNetwork({...h,ownedOrigin,frameId,nonce}),/current owned main frame/);assert.deepEqual(h.calls.map(x=>x.method),['Page.getFrameTree']);
  }
  const h=probeCalls({success:true,httpStatusCode:200});await assert.rejects(requireOwnedOnlineNetwork({...h,ownedOrigin,frameId,nonce:''}),/fresh UUID/);assert.equal(h.calls.length,0);
});

test('actual renderer-online callback alone permits continuation without a network barrier; the new callsite places its probe before the single retry',async()=>{
  const source=await readFile(new URL('./portfolio-browser.mjs',import.meta.url),'utf8'),ast=parse(source,{sourceType:'module'});let main;
  const locate=(node,block)=>{if(!node||typeof node!=='object')return;const owner=node.type==='BlockStatement'?node:block;if(node.type==='VariableDeclaration'&&node.declarations.some(x=>x.id.name==='emulateQuoteNetwork'))main=owner.body;for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(child=>locate(child,owner));else if(value&&typeof value==='object')locate(value,owner);}};locate(ast);
  assert.ok(main);
  const callback=main.find(x=>x.type==='VariableDeclaration'&&x.declarations.some(z=>z.id.name==='emulateQuoteNetwork')).declarations[0].init;
  const calls=[],state={online:true},context={quoteRecoveryEvidence:{commands:[]},stamp:()=>'',recoveryState:async()=>state,call:async method=>{calls.push(method);return {};},wait:async expression=>{assert.equal(expression,'navigator.onLine===true');}};
  const actualCallback=runInNewContext(`(${source.slice(callback.start,callback.end)})`,context);await actualCallback(false);
  assert.deepEqual(calls,['Network.emulateNetworkConditions']);assert.equal(context.quoteRecoveryEvidence.commands.at(-1).phase,'browser-online-ready');
  const block=main.find(x=>x.type==='TryStatement'&&source.slice(x.start,x.end).includes("await emulateQuoteNetwork(true)"));
  const probeIndex=block.block.body.findIndex(x=>x.type==='ExpressionStatement'&&x.expression.type==='AwaitExpression'&&x.expression.argument.callee?.name==='requireOwnedOnlineNetwork'),onlineIndex=block.block.body.findIndex(x=>x.type==='ExpressionStatement'&&x.expression.type==='AwaitExpression'&&x.expression.argument.callee?.name==='emulateQuoteNetwork'&&x.expression.argument.arguments[0].value===false),retryIndex=block.block.body.findIndex(x=>x.type==='TryStatement'&&source.slice(x.start,x.end).includes("clickQuoteRoot(true,'Refresh and retry')"));
  assert.ok(onlineIndex>=0&&probeIndex>onlineIndex&&retryIndex>probeIndex);assert.equal((source.slice(block.start,block.end).match(/clickQuoteRoot\(true,'Refresh and retry'\)/g)||[]).length,1);
  const probe=block.block.body[probeIndex].expression.argument;assert.equal(probe.arguments[0].properties.find(x=>x.key.name==='nonce').value.callee.name,'randomUUID');assert.equal(block.block.body.filter(x=>x.type==='ExpressionStatement'&&x.expression.type==='AwaitExpression'&&x.expression.argument.callee?.name==='requireOwnedOnlineNetwork').length,1);
  const h=probeCalls({success:false,netError:-106});let continued=false;await assert.rejects(async()=>{await requireOwnedOnlineNetwork({...h,ownedOrigin,frameId,nonce});continued=true;});assert.equal(continued,false);
});
