export function navigationContextChanged(error) {
  return error?.code === -32000 && /^(Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id)/.test(String(error.message || ''));
}
export function documentNavigationCall(send,{attempts=300,intervalMs=100,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const state=async sessionId=>{
    const result=await send('Runtime.evaluate',{expression:'({timeOrigin:performance.timeOrigin,readyState:document.readyState,href:location.href})',returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error(`Document readiness evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    const value=result.result?.value;
    if(!Number.isFinite(value?.timeOrigin))throw Error('Document readiness did not return a time origin.');
    return value;
  };
  const inspect=async(sessionId,accept,label)=>{
    let current;
    for(let attempt=0;attempt<attempts;attempt++){
      try { current=await state(sessionId);if(accept(current))return current; }
      catch(error){if(!navigationContextChanged(error))throw error;}
      if(attempt+1<attempts)await pause(intervalMs);
    }
    throw Error(`Timed out: ${label}. Last document: ${JSON.stringify(current)}`);
  };
  return async(method,params={},sessionId)=>{
    if(method!=='Page.reload' && method!=='Page.navigate')return send(method,params,sessionId);
    const before=await inspect(sessionId,()=>true,`read document before ${method}`);
    const result=await send(method,params,sessionId);
    if(result.errorText)throw Error(`${method} failed: ${result.errorText}`);
    if(method==='Page.navigate' && !result.loaderId)return result;
    await inspect(sessionId,current=>current.timeOrigin!==before.timeOrigin && current.readyState==='complete',`new complete document after ${method} from ${before.timeOrigin}`);
    return result;
  };
}
export async function inspectTechnicalDetails(evaluate,needle) {
  return evaluate(`(()=>{const needle=${JSON.stringify(needle)};const details=[...document.querySelectorAll('details')].filter(x=>/^(Audit details|Technical details|Replay technical details)$/.test(x.querySelector(':scope > summary')?.textContent.trim()||'')&&x.textContent.includes(needle));for(const detail of details)if(!detail.open)detail.querySelector(':scope > summary').click();return details.length})()`);
}
export async function waitForTechnicalDetails({wait,evaluate},needle) {
  await wait(`document.body.innerText.includes(${JSON.stringify(needle)})||[...document.querySelectorAll('details')].some(detail=>detail.textContent.includes(${JSON.stringify(needle)}))`);
  await inspectTechnicalDetails(evaluate,needle);
  await wait(`document.body.innerText.includes(${JSON.stringify(needle)})`);
}
