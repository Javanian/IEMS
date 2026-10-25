import assert from 'node:assert/strict';
import { get } from 'node:http';

export function assertOwnedWebAddress(server,port) {
  const address=server?.address();
  assert.equal(server?.listening,true,'Owned Vite HTTP server must be listening');
  assert.equal(address?.address,'127.0.0.1','Owned Vite must bind IPv4 loopback only');
  assert.equal(address?.port,port,'Owned Vite port must match browser origin');
  return address;
}

export function probeOwnedWeb(origin,path,{timeoutMs=1500}={}) {
  const target=new URL(path,origin);
  assert.equal(target.origin,origin,'Diagnostic probe must stay on owned origin');
  assert.equal(target.hostname,'127.0.0.1','Diagnostic probe must stay on IPv4 loopback');
  return new Promise(resolve=>{
    const startedUTC=new Date().toISOString();let settled=false,request;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve({url:target.href,startedUTC,finishedUTC:new Date().toISOString(),...value});};
    const timer=setTimeout(()=>{finish({error:'PROBE_TIMEOUT'});request?.destroy();},timeoutMs);
    request=get(target,{headers:{'Cache-Control':'no-cache'}},response=>{
      const result={status:response.statusCode,remoteAddress:response.socket?.remoteAddress,remotePort:response.socket?.remotePort};
      response.on('error',error=>finish({...result,error:error.code||error.message}));
      response.on('end',()=>finish(result));response.resume();
    });
    request.on('error',error=>finish({error:error.code||error.message}));
  });
}

export function webTransportTelemetry(origin,{limit=600,logLimit=40}={}) {
  const resources=new Map(),lifecycle=[],logs=[],commands=[];
  let evictedResources=0;
  const stamp=()=>new Date().toISOString();
  const bounded=(rows,value,cap)=>{rows.push(value);if(rows.length>cap)rows.shift();};
  const snapshot=server=>({origin,server:{listening:server?.listening===true,address:server?.address()||null},lifecycle:[...lifecycle],commands:[...commands],resources:[...resources.values()].map(row=>({...row})),evictedResources,logs:[...logs]});
  return {
    attachServer(server){
      for(const name of ['listening','close','error'])server.on(name,error=>bounded(lifecycle,{event:name,utc:stamp(),listening:server.listening,address:server.address(),...(error?{error:error.code||error.message}:{})},40));
      bounded(lifecycle,{event:'attached-before-listen',utc:stamp(),listening:server.listening,address:server.address()},40);
    },
    command(phase,method,params,result){bounded(commands,{phase,method,utc:stamp(),...(method==='Network.emulateNetworkConditions'?{offline:params.offline}:{}),...(method==='Page.navigate'?{url:params.url}:{}),...(result?.errorText?{errorText:result.errorText}:{})},100);},
    event(event){
      const p=event.params;if(!p)return;
      if(event.method==='Log.entryAdded'){const e=p.entry;bounded(logs,{utc:stamp(),source:e.source,level:e.level,text:e.text?.slice(0,2000),timestamp:e.timestamp,url:e.url,networkRequestId:e.networkRequestId},logLimit);return;}
      if(event.method==='Page.frameNavigated'){bounded(commands,{phase:'frame-navigated',utc:stamp(),frameId:p.frame.id,loaderId:p.frame.loaderId,url:p.frame.url},100);return;}
      if(event.method==='Network.requestWillBeSent'&&['Document','Script','Stylesheet'].includes(p.type)&&p.request.url.startsWith(`${origin}/`)){
        if(!resources.has(p.requestId)&&resources.size>=limit){resources.delete(resources.keys().next().value);evictedResources++;}
        resources.set(p.requestId,{requestId:p.requestId,url:p.request.url,type:p.type,method:p.request.method,startedUTC:stamp(),timestamp:p.timestamp,wallTime:p.wallTime,frameId:p.frameId,loaderId:p.loaderId,initiator:p.initiator?.type});
      }
      const row=resources.get(p.requestId);if(!row)return;
      if(event.method==='Network.responseReceived')Object.assign(row,{status:p.response.status,responseTimestamp:p.timestamp,responseUTC:stamp(),remoteIPAddress:p.response.remoteIPAddress,remotePort:p.response.remotePort,connectionId:p.response.connectionId,connectionReused:p.response.connectionReused,protocol:p.response.protocol,fromDiskCache:p.response.fromDiskCache,fromServiceWorker:p.response.fromServiceWorker});
      if(event.method==='Network.loadingFinished')Object.assign(row,{finishedTimestamp:p.timestamp,finishedUTC:stamp(),encodedDataLength:p.encodedDataLength});
      if(event.method==='Network.loadingFailed')Object.assign(row,{failedTimestamp:p.timestamp,failedUTC:stamp(),errorText:p.errorText,canceled:p.canceled===true,blockedReason:p.blockedReason});
    },
    snapshot,
    async failure(server){
      const failed=[...resources.values()].filter(row=>row.errorText).at(-1),paths=[...new Set(['/', '/src/main.jsx','/src/index.css',...(failed?[new URL(failed.url).pathname]:[])])].slice(0,4);
      const state=snapshot(server);
      return {...state,...(lifecycle.some(row=>row.event==='listening')?{probes:await Promise.all(paths.map(path=>probeOwnedWeb(origin,path)))}:{probes:[],probeSkipped:'Owned listener never started'})};
    }
  };
}
