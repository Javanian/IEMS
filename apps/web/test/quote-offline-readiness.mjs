export async function requireOwnedOnlineNetwork({call,ownedOrigin,frameId,nonce,evidence={}}) {
  const origin=new URL(ownedOrigin);
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||Number(origin.port)<1||origin.origin!==ownedOrigin||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Network probe requires the exact owned IPv4 origin');
  if(typeof frameId!=='string'||!frameId||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce))throw Error('Network probe requires a main frame and fresh UUID nonce');
  const {frameTree}=await call('Page.getFrameTree');
  if(frameTree?.frame?.id!==frameId||frameTree.frame.parentId||new URL(frameTree.frame.url).origin!==ownedOrigin)throw Error('Network probe frame is not the current owned main frame');
  const url=new URL('/',origin);url.searchParams.set('portfolio_network_probe',nonce);
  Object.assign(evidence,{url:url.href,frameId,options:{disableCache:true,includeCredentials:false},startedUTC:new Date().toISOString(),result:null,streamReturned:false,closeAttempted:false,closed:false});
  let stream;
  try {
    const {resource}=await call('Network.loadNetworkResource',{frameId,url:url.href,options:{disableCache:true,includeCredentials:false}});
    stream=resource?.stream;
    evidence.streamReturned=typeof stream==='string'&&stream.length>0;
    evidence.result={success:resource?.success===true,httpStatusCode:resource?.httpStatusCode??null,netError:resource?.netError??null,netErrorName:resource?.netErrorName??null};
    if(resource?.success!==true||resource.httpStatusCode!==200||(resource.netError!==undefined&&resource.netError!==0)||resource.netErrorName)throw Error('Owned browser network probe did not complete with HTTP200');
  } finally {
    if(typeof stream==='string'&&stream){evidence.closeAttempted=true;try{await call('IO.close',{handle:stream});evidence.closed=true;evidence.closedUTC=new Date().toISOString();}catch(error){evidence.closeError=String(error);throw error;}}
  }
  evidence.completedUTC=new Date().toISOString();
  return evidence;
}

export function observeOfflineQuoteRead({ subscribe, url, timeoutMs=30000 }) {
  const attempts=new Map();let settled=false,unsubscribe=()=>{},timer,resolve,reject;
  const response=new Promise((yes,no)=>{resolve=yes;reject=no;});response.catch(()=>{});
  const close=()=>{clearTimeout(timer);unsubscribe();};
  const history=()=>[...attempts.values()].map(row=>({...row}));
  const finish=(error,value)=>{if(settled)return;settled=true;close();if(error)reject(error);else resolve(value);};
  unsubscribe=subscribe(event=>{
    const params=event.params;if(!params||settled)return;
    if(event.method==='Network.requestWillBeSent'&&params.request.method==='GET'&&params.request.url===url&&!attempts.has(params.requestId))attempts.set(params.requestId,{requestId:params.requestId,url,outcome:'pending',startedAt:params.timestamp,wallTime:params.wallTime});
    const attempt=attempts.get(params.requestId);if(!attempt)return;
    if(event.method==='Network.responseReceived'||event.method==='Network.loadingFinished')finish(Error(`Offline quote GET ${attempt.requestId} returned an HTTP response instead of the required offline failure`));
    if(event.method!=='Network.loadingFailed')return;
    Object.assign(attempt,{errorText:params.errorText,canceled:params.canceled===true,finishedAt:params.timestamp});
    if(params.canceled===true&&params.errorText==='net::ERR_ABORTED')attempt.outcome='aborted';
    else if(params.canceled!==true&&params.errorText==='net::ERR_INTERNET_DISCONNECTED')attempt.outcome='offline';
    else {finish(Error(`Unexpected offline quote GET failure ${attempt.requestId}: ${params.errorText}`));return;}
    const rows=[...attempts.values()],latest=rows.at(-1);
    if(latest.outcome==='offline'&&rows.every(row=>row.outcome!=='pending'))finish(null,{requestId:latest.requestId,url,errorText:latest.errorText,canceled:false,attempts:history()});
  });
  timer=setTimeout(()=>finish(Error(`No completed new offline quote GET: ${url}; attempts=${JSON.stringify(history())}`)),timeoutMs);
  return {response,close};
}

export function quoteRecoveryDOMState() {
  const main=document.querySelector('#portfolio-content'),error=main?.querySelector(':scope > .pf-error[role="alert"]'),status=[...main?.querySelectorAll(':scope > section.pf-panel > p')||[]].find(node=>node.textContent.startsWith('Status:'));
  return {href:location.href,pathname:location.pathname,online:navigator.onLine,timeOrigin:performance.timeOrigin,performanceNow:performance.now(),heading:main?.querySelector('h1')?.textContent||null,statusText:status?.textContent||null,loading:[...main?.querySelectorAll('[role="status"]')||[]].some(node=>node.textContent.includes('Loading current records')),auditText:[...main?.querySelectorAll(':scope > [data-audit-details] .pf-id')||[]].map(node=>node.textContent).join('\n'),orderLinks:[...main?.querySelectorAll('a[href^="/portfolio/orders/"]')||[]].map(node=>new URL(node.href).pathname),rootError:error?{text:error.querySelector('p')?.textContent||'',retryButtons:[...error.querySelectorAll(':scope > button')].filter(button=>button.textContent.trim()==='Refresh and retry'&&!button.disabled).length}:null};
}
export function isOfflineQuoteRoot(state,quoteId) {
  return state.pathname===`/portfolio/quotes/${quoteId}`&&!state.heading&&!state.statusText&&!state.loading&&state.rootError?.retryButtons===1&&state.rootError.text.includes('Check the connection and retry');
}
export function isRecoveredQuoteRoot(state,expected) {
  return state.pathname===`/portfolio/quotes/${expected._id}`&&state.heading==='Quote'&&state.statusText==='Status: Order created'&&!state.rootError&&!state.loading&&state.auditText.includes(`Quote ID: ${expected._id} · Version ${expected.version}`)&&state.orderLinks.includes(`/portfolio/orders/${expected.orderId}`);
}
