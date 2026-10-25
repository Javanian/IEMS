export function observeTraceRead({ subscribe, call, url, timeoutMs = 30000 }) {
  let settled=false, unsubscribe=()=>{}, timer, resolve, reject;
  const attempts=new Map();
  const response=new Promise((yes,no)=>{resolve=yes;reject=no;});
  response.catch(()=>{});
  const close=()=>{clearTimeout(timer);unsubscribe();};
  const finish=(error,value)=>{if(settled)return;settled=true;close();if(error)reject(error);else resolve(value);};
  const history=()=>[...attempts.values()].map(({requestId,status,outcome,errorText,canceled})=>({requestId,status,outcome,...(errorText?{errorText,canceled}:{})}));
  const complete=()=>{
    const rows=[...attempts.values()],latest=rows.at(-1);
    if(latest?.outcome!=='completed' || rows.some(row=>!['completed','aborted'].includes(row.outcome)))return;
    finish(null,{requestId:latest.requestId,url,status:latest.status,data:latest.data,attempts:history()});
  };
  unsubscribe=subscribe(async event=>{
    const params=event.params;
    if(!params || settled)return;
    if(event.method==='Network.requestWillBeSent' && params.request.method==='GET' && params.request.url===url && !attempts.has(params.requestId))attempts.set(params.requestId,{requestId:params.requestId,status:null,outcome:'pending'});
    const attempt=attempts.get(params.requestId);if(!attempt)return;
    if(event.method==='Network.responseReceived') {
      attempt.status=params.response.status;
      if(attempt.status!==200)finish(Error(`Trace GET ${attempt.requestId} returned ${attempt.status}`));
    }
    if(event.method==='Network.loadingFailed') {
      if(params.canceled===true && params.errorText==='net::ERR_ABORTED') {Object.assign(attempt,{outcome:'aborted',errorText:params.errorText,canceled:true});complete();}
      else finish(Error(`Trace GET ${attempt.requestId} failed: ${params.errorText}`));
    }
    if(event.method==='Network.loadingFinished' && attempt.outcome==='pending') {
      attempt.outcome='reading';
      try {
        if(attempt.status!==200)throw Error(`Trace GET ${attempt.requestId} returned ${attempt.status}`);
        const body=await call('Network.getResponseBody',{requestId:attempt.requestId});
        if(attempt.outcome==='aborted')return;
        const envelope=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body);
        if(!envelope.data)throw Error(`Trace GET ${attempt.requestId} has no complete response data`);
        Object.assign(attempt,{outcome:'completed',data:envelope.data});complete();
      } catch(error) {if(attempt.outcome!=='aborted')finish(error);}
    }
  });
  timer=setTimeout(()=>finish(Error(`Timed out waiting for a fresh completed trace GET: ${url}; attempts=${JSON.stringify(history())}`)),timeoutMs);
  return { response, close };
}
