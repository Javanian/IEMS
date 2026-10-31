import {useEffect,useState} from 'react';
const defaultBase = import.meta.env?.VITE_PORTFOLIO_API_BASE || '/portfolio-api';
export async function portfolioRequest(path, { body, base = defaultBase, signal, headers: extra = {} } = {}) {
  let response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
      headers: { ...(body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) { if (cause.name === 'AbortError') throw cause; throw Object.assign(new Error('Connection unavailable'), { status: 0 }); }
  let envelope;
  try { envelope = await response.json(); } catch { throw Object.assign(new Error('Invalid API response'), { status: response.status }); }
  if (!response.ok) { const e = envelope?.error && typeof envelope.error === 'object' ? envelope.error : envelope || {}; throw Object.assign(new Error(e.message || 'Request failed'), { status: response.status, code: e.code, ...(e.currentVersion === undefined ? {} : { currentVersion: e.currentVersion }) }); }
  return envelope;
}
export function errorMessage(error, mutation = false) {
  if(['COMMAND_SCOPE_CHANGED','COMMAND_RECONCILIATION_REQUIRED'].includes(error.code))return error.message;
  if (error.status === 401) return 'Your session expired or is unavailable. Sign in again.';
  if (error.status === 403) return 'Access denied. You do not have permission for this action or origin.';
  if (error.status === 409) return 'This record changed or its stage is closed. Review the record and its history to reconcile the submitted command before starting a new one.';
  if (error.status === 404) return 'Record not found in your current plant. Return to the list or refresh.';
  if (mutation && (!error.status || error.status >= 500)) return 'The result could not be confirmed. Refresh and check the records before submitting again to avoid a duplicate.';
  return `${error.message || 'Connection unavailable'}. ${mutation ? 'Review the form and submit again.' : 'Retry to load the latest records.'}`;
}
export function displayMoney(amount) {
  const [integer, fraction] = amount.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
}
export function validMoney(amount, currency) {
  const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
  const scale = scales[currency];
  return scale !== undefined && typeof amount === 'string' && new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(amount);
}

const commandAttempts=new Map();
const scopeKey=identity=>{
  const values=[identity?.user?.id,identity?.scope?.tenantId,identity?.scope?.plantId];
  if(values.some(value=>typeof value!=='string'||!value))throw Object.assign(new Error('Sign in and select the original plant before sending this command.'),{status:401});
  return JSON.stringify(values);
};
const keyedPath=path=>/^\/api\/crm\/(accounts(?:\/[^/]+\/contacts)?|opportunities(?:\/[^/]+\/stage)?)$/.test(path)
 || /^\/api\/commercial\/quotes(?:\/[^/]+\/(revisions|approve|accept))?$/.test(path)
 || /^\/api\/procurement\/(vendors|requests(?:\/[^/]+\/approve)?|orders\/[^/]+\/(issue|vendor-confirmation))$/.test(path);
export function serviceCommandContract(path,body={}) {
 if(/^\/api\/cs\/conversations\/[^/]+\/reply$/.test(path)||path==='/api/cs/simulator/dispatch')return 'BODY';
 if(/^\/api\/cs\/automation\/(pause|service-credentials(?:\/[^/]+\/revoke)?|resolution-drafts\/[^/]+\/(approve|reject|cancel|dispatch)|deliveries\/[^/]+\/review|resolution-draft|escalate|digest\/dispatch)$/.test(path))return 'HEADER';
 if(path==='/api/cs/automation/reconcile'&&body.mode==='LOCAL_OBSERVE_V1')return 'HEADER';
 return null;
}
function serviceResponse(path,data){
 if(!data||typeof data!=='object')return false;
 if(path.endsWith('/service-credentials'))return typeof data.sessionId==='string'&&data.deliveryProtocol==='ONE_TIME_NO_RECOVERY_V1'&&(data.replayed? !Object.hasOwn(data,'token')&&data.recovery==='REVOKE_AND_REISSUE':typeof data.token==='string'&&data.token.length>=32);
 if(path.endsWith('/revoke'))return typeof data.sessionId==='string'&&data.revoked===true;
 if(path.endsWith('/pause'))return typeof data.paused==='boolean';
 if(path.endsWith('/simulator/dispatch'))return Array.isArray(data.previewedDeliveryIds)&&data.previewedDeliveryIds.every(x=>typeof x==='string');
 if(path.endsWith('/reconcile'))return data.mode==='LOCAL_OBSERVE_V1'&&Array.isArray(data.items);
 if(path.endsWith('/reply')||path.includes('/deliveries/')||path.endsWith('/dispatch'))return typeof data.deliveryId==='string'&&typeof data.state==='string';
 if(path.endsWith('/escalate'))return typeof data.ticketId==='string'&&Number.isSafeInteger(data.version);
 return typeof data.draftId==='string'&&Number.isSafeInteger(data.version);
}
export function createCommandAttempt(slot,{storage=globalThis.sessionStorage,keyFactory=()=>crypto.randomUUID(),profile='V8'}={}) {
 let attempt=null,busy=false,warning='',lost=false,lostInfo=null;const listeners=new Set(),marker='iems.command.pending:'+slot;
 try{const raw=storage?.getItem(marker);lost=raw!==null;if(profile==='CS_AUTOMATION_V14'&&raw){try{const value=JSON.parse(raw);if(value&&typeof value.path==='string'&&typeof value.key==='string'&&typeof value.scope==='string')lostInfo=value;}catch{}}if(!storage)lost=true;}catch{lost=true;}
 const changed=()=>listeners.forEach(fn=>fn());
 const snapshot=()=>({path:attempt?.path??lostInfo?.path,key:attempt?.key??lostInfo?.key,scope:attempt?.scope??lostInfo?.scope,pending:Boolean(attempt)||lost,busy,reconcile:lost||attempt?.state==='RECONCILE',message:lost?'A previous command could not be reconciled after navigation or reload. Review the server record and history before starting another command.':warning});
 async function transmit(identity,requester,signal){
  if(busy)throw Object.assign(new Error('This command is already being sent.'),{code:'COMMAND_BUSY'});
  if(!attempt||attempt.scope!==scopeKey(identity))throw Object.assign(new Error('The account or plant changed. Reconcile the original command in its original scope.'),{code:'COMMAND_SCOPE_CHANGED'});
  if(attempt.state==='RECONCILE')throw Object.assign(new Error('Review the server record and history before reconciling this conflict.'),{code:'COMMAND_RECONCILIATION_REQUIRED'});
  busy=true;changed();
  try{
   const result=await requester(attempt.path,{body:JSON.parse(attempt.body),...(attempt.headers?{headers:{...attempt.headers}}:{}),signal});
   if(profile==='CS_AUTOMATION_V14'?!serviceResponse(attempt.path,result?.data):(!result?.data||typeof result.data._id!=='string'||!Number.isSafeInteger(result.data.version)))throw Object.assign(new Error('The success response could not be verified.'),{status:200,code:'INVALID_MUTATION_RESPONSE'});
   attempt=null;storage.removeItem(marker);warning='';return result;
  }catch(error){
   if(attempt){if([400,422].includes(error.status)){attempt=null;storage.removeItem(marker);warning='No change was accepted. Correct the validated input before starting a new command.';}
   else{attempt.state=error.status===409?'RECONCILE':'UNCERTAIN';warning=error.status===409?'This command conflicts with server history. Reconcile the record; refreshing does not start a new command.':'The result is uncertain. Inputs are locked. Retry the same command, or review the server record before leaving.';}}
   throw error;
  }finally{busy=false;changed();}
 }
 return Object.freeze({snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  async send(identity,path,body,{requester=portfolioRequest,signal}={}){
   if(attempt||lost)throw Object.assign(new Error('Reconcile or retry the retained command before starting another.'),{code:'COMMAND_RECONCILIATION_REQUIRED'});
   const contract=profile==='CS_AUTOMATION_V14'?serviceCommandContract(path,body):'BODY';
   if((profile==='CS_AUTOMATION_V14'?!contract:!keyedPath(path))||Object.hasOwn(body,'schema')||Object.hasOwn(body,'idempotencyKey')||Object.hasOwn(body,'commandKey'))throw new Error('This operation does not use the v8 commandKey contract.');
   const scope=scopeKey(identity),key=keyFactory();storage.setItem(marker,profile==='CS_AUTOMATION_V14'?JSON.stringify({path,key,scope}):'UNRESOLVED');
   attempt={scope,path,key,body:JSON.stringify(contract==='BODY'?{...body,commandKey:key}:body),...(contract==='HEADER'?{headers:{'Idempotency-Key':key}}:{}),state:'READY'};changed();return transmit(identity,requester,signal);
  },
  retry(identity,options={}){if(lost)throw new Error('The original request body is unavailable. Reconcile the server record.');return transmit(identity,options.requester??portfolioRequest,options.signal);},
  reconcileRecoveredCredential(identity,{receipt,revocation}){const original=attempt??lostInfo;if(busy||!original||original.path!=='/api/cs/automation/service-credentials'||original.scope!==scopeKey(identity)||receipt?.action!=='SERVICE_CREDENTIAL_ISSUE'||receipt.idempotencyKey!==original.key||receipt.tenantId!==identity.scope.tenantId||receipt.plantId!==identity.scope.plantId||!receipt.result?.sessionId||revocation?.sessionId!==receipt.result.sessionId||revocation.revoked!==true)throw new Error('The original issuance receipt and confirmed revocation are required.');attempt=null;lostInfo=null;lost=false;warning='Original issued session revoked. A reviewed new issuance can use a new key.';storage.removeItem(marker);changed();},
  reconcileNoEffect(evidence){if((attempt??lostInfo)?.path==='/api/cs/automation/service-credentials')throw new Error('Resolve the original issuance receipt and confirm revocation before a replacement.');if(busy||typeof evidence!=='string'||evidence.trim().length<12)throw new Error('Record the checked server history and evidence that no effect occurred.');attempt=null;lost=false;warning='';storage.removeItem(marker);changed();},
 });
}
export function useStableCommand(slot,identity,options={}){
 slot=options.profile?options.profile+':'+slot:slot;
 if(!commandAttempts.has(slot))commandAttempts.set(slot,createCommandAttempt(slot,options));
 const command=commandAttempts.get(slot),[state,setState]=useState(()=>command.snapshot());
 useEffect(()=>{setState(command.snapshot());return command.subscribe(()=>setState(command.snapshot()));},[command]);
 return {...state,send:(path,options)=>command.send(identity,path,options.body,options),retry:options=>command.retry(identity,options),reconcileNoEffect:command.reconcileNoEffect,reconcileRecoveredCredential:evidence=>command.reconcileRecoveredCredential(identity,evidence)};
}
