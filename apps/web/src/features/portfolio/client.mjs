import {useEffect,useRef,useState} from 'react';
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
 if(/^\/api\/cs\/automation\/run\/(wf-sla-escalation|wf-cs-weekly-digest|wf-approved-resolution|wf-automation-recovery)$/.test(path)||path==='/api/cs/automation/reconcile'&&body.mode===undefined)return 'HEADER';
 return null;
}
function serviceResponse(path,data){
 if(!data||typeof data!=='object')return false;
 if(path.endsWith('/service-credentials'))return typeof data.sessionId==='string'&&data.deliveryProtocol==='ONE_TIME_NO_RECOVERY_V1'&&(data.replayed? !Object.hasOwn(data,'token')&&data.recovery==='REVOKE_AND_REISSUE':typeof data.token==='string'&&data.token.length>=32);
 if(path.endsWith('/revoke'))return typeof data.sessionId==='string'&&data.revoked===true;
 if(path.endsWith('/pause'))return typeof data.paused==='boolean';
 if(path.endsWith('/simulator/dispatch'))return Array.isArray(data.previewedDeliveryIds)&&data.previewedDeliveryIds.every(x=>typeof x==='string');
 if(path.endsWith('/reconcile'))return data.mode==='LOCAL_OBSERVE_V1'&&Array.isArray(data.items)||data.state==='ACCEPTED'&&typeof data.recoveryId==='string';
 if(path.includes('/automation/run/'))return data.state==='ACCEPTED'&&typeof data.runId==='string';
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
  reconcileAccepted(identity,{receipt,status}){const original=attempt??lostInfo,action=original?.path.includes('/automation/run/')?'AUTOMATION_ENGINE_RUN':original?.path==='/api/cs/automation/reconcile'?'AUTOMATION_RECOVERY':null,commandId=receipt?.result?.runId??receipt?.result?.recoveryId;if(busy||!action||original.scope!==scopeKey(identity)||receipt?.action!==action||receipt.idempotencyKey!==original.key||receipt.tenantId!==identity.scope.tenantId||receipt.plantId!==identity.scope.plantId||receipt.result.state!=='ACCEPTED'||status?.commandId!==commandId||status?.acceptedResult?.state!=='ACCEPTED')throw new Error('The original accepted receipt and authorized intent status are required.');attempt=null;lostInfo=null;lost=false;warning='Original intent accepted; inspect its phases separately.';storage.removeItem(marker);changed();},
  reconcileNoEffect(evidence){if((attempt??lostInfo)?.path==='/api/cs/automation/service-credentials')throw new Error('Resolve the original issuance receipt and confirm revocation before a replacement.');if(busy||typeof evidence!=='string'||evidence.trim().length<12)throw new Error('Record the checked server history and evidence that no effect occurred.');attempt=null;lost=false;warning='';storage.removeItem(marker);changed();},
 });
}
export function useStableCommand(slot,identity,options={}){
 slot=options.profile?options.profile+':'+slot:slot;
 if(!commandAttempts.has(slot))commandAttempts.set(slot,createCommandAttempt(slot,options));
 const command=commandAttempts.get(slot),[state,setState]=useState(()=>command.snapshot());
 useEffect(()=>{setState(command.snapshot());return command.subscribe(()=>setState(command.snapshot()));},[command]);
 return {...state,send:(path,options)=>command.send(identity,path,options.body,options),retry:options=>command.retry(identity,options),reconcileNoEffect:command.reconcileNoEffect,reconcileRecoveredCredential:evidence=>command.reconcileRecoveredCredential(identity,evidence),reconcileAccepted:evidence=>command.reconcileAccepted(identity,evidence)};
}

const effectTrackers=new Map(),effectId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
export function createEffectTracker(slot,{storage=globalThis.sessionStorage,requester=portfolioRequest,getIdentity}={}){
 const marker='iems.local.effects:'+slot,listeners=new Set();let entries=[],busy=false,error=null;
 try{const saved=JSON.parse(storage?.getItem(marker)||'[]');if(!Array.isArray(saved)||saved.length>25||saved.some(row=>!effectId(row.commandId)||typeof row.scope!=='string'||typeof row.label!=='string'||row.parentId!==undefined&&!effectId(row.parentId)||!Array.isArray(row.phases)||!row.phases.length||row.phases.length>100||row.phases.some(phase=>typeof phase!=='string'||!phase||phase.length>100)))throw Error('Invalid saved intent references');entries=saved;}catch{error=new Error('Saved intent references are unavailable. Recover the original receipt before starting another action.');}
 const changed=()=>listeners.forEach(fn=>fn()),save=()=>storage.setItem(marker,JSON.stringify(entries.map(({scope,commandId,phases,label,parentId})=>({scope,commandId,phases,label,...(parentId?{parentId}:{})}))));
 const current=()=>scopeKey(getIdentity()),find=id=>{const row=entries.find(entry=>entry.commandId===id);if(!row||row.scope!==current())throw Object.assign(new Error('Return to the original account and plant to inspect this intent.'),{code:'COMMAND_SCOPE_CHANGED'});return row;};
 async function inspect(id){if(busy)throw Error('An intent request is already pending');busy=true;error=null;changed();try{const row=find(id),scope=current(),result=await requester(`/api/saas/effects/${id}`);if(scope!==current())throw Object.assign(new Error('The account or plant changed during this observation.'),{code:'COMMAND_SCOPE_CHANGED'});if(result.data?.commandId!==id||!Array.isArray(result.data.phases))throw Error('Intent status could not be verified');row.status=result.data;changed();return result.data;}catch(e){error=e;throw e;}finally{busy=false;changed();}}
 async function operate(id,phase,action){const row=find(id);if(busy||!row.status||!row.phases.includes(phase))throw Error('Inspect the original intent before running a phase.');if(action==='reconcileChild'&&!effectId(row.parentId))throw Error('The original parent receipt is required');const previous=row.status.phases.find(item=>item.phase===phase);if(action==='continue'&&(previous&&['INVOKING','UNKNOWN','OBSERVED','SETTLED'].includes(previous.state)||['PUBLICATION_DENIED','STOPPED'].includes(row.status.state)))throw Error('Observe the same phase; its result cannot be replaced by another send.');busy=true;error=null;changed();try{const scope=current();await requester(action==='reconcileChild'?`/api/saas/effects/${row.parentId}/children/${id}/continue`:`/api/saas/effects/${id}/${action}`,{body:{phase}});if(scope!==current())throw Object.assign(new Error('The account or plant changed. Inspect the intent in its original scope.'),{code:'COMMAND_SCOPE_CHANGED'});}catch(e){error=e;throw e;}finally{busy=false;changed();}return inspect(id);}
 return Object.freeze({snapshot:()=>{let scope=null;try{scope=current();}catch{}return{items:entries.map(row=>row.scope===scope?{...row}:{scope:row.scope,commandId:row.commandId,phases:row.phases,label:row.label,scopeChanged:true}),busy,error};},bindIdentity(resolver){getIdentity=resolver;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  remember(commandId,phases,label,{parentId}={}){if(parentId!==undefined&&!effectId(parentId)||!effectId(commandId)||typeof label!=='string'||!label||label.length>200||!Array.isArray(phases)||!phases.length||phases.length>100||phases.some(value=>typeof value!=='string'||!value||value.length>100))throw Error('Invalid server intent reference');const scope=current(),prior=entries.find(row=>row.commandId===commandId);if(prior){if(prior.scope!==scope)throw Error('Intent scope changed');if(parentId)prior.parentId=parentId;const merged=[...new Set([...prior.phases,...phases])];if(merged.length>100)throw Error('Intent phase bound exceeded');prior.phases=merged;save();changed();return;}if(entries.length>=25)throw Error('Review and dismiss completed intents before accepting another.');const row={scope,commandId,phases:[...phases],label,...(parentId?{parentId}:{})};entries.push(row);try{save();}catch(e){entries.pop();throw e;}changed();},
  rememberChild(parentId,childId,phase,label){const parent=find(parentId),items=parent.status?.phases.flatMap(row=>row.observedOutcome?.items??row.phaseResult?.items??[])??[];if(!items.some(row=>row.commandId===childId&&row.deliveryId===phase))throw Error('Inspect the original parent recovery evidence first');this.remember(childId,[phase],label,{parentId});},inspect,report(e){error=e;changed();},continue:(id,phase)=>operate(id,phase,'continue'),observe:(id,phase)=>operate(id,phase,'observe'),reconcileChild:(id,phase)=>operate(id,phase,'reconcileChild'),
  dismiss(id){try{const row=find(id);if(busy||row.status?.state!=='COMPLETED')throw Error('Only an observed completed intent can be dismissed.');entries=entries.filter(entry=>entry!==row);save();changed();}catch(e){error=e;changed();throw e;}},
 });
}
export function useLocalEffects(slot,identity){
 const latest=useRef(identity);latest.current=identity;
 if(!effectTrackers.has(slot))effectTrackers.set(slot,createEffectTracker(slot,{getIdentity:()=>latest.current}));
 const tracker=effectTrackers.get(slot),[,render]=useState(0);tracker.bindIdentity(()=>latest.current);
 useEffect(()=>{latest.current=identity;const unsubscribe=tracker.subscribe(()=>render(version=>version+1));return()=>{unsubscribe();latest.current=null;};},[tracker]);
 const safely=async work=>{try{return await work();}catch(error){tracker.report(error);}};
 return {...tracker.snapshot(),remember:tracker.remember,trackChild:(parentId,id,phase)=>safely(async()=>{tracker.rememberChild(parentId,id,phase,'Recovery child delivery');return tracker.inspect(id);}),reconcileChild:(id,phase)=>safely(()=>tracker.reconcileChild(id,phase)),track:(id,phases,label)=>safely(async()=>{tracker.remember(id,phases,label);return tracker.inspect(id);}),inspect:id=>safely(()=>tracker.inspect(id)),continue:(id,phase)=>safely(()=>tracker.continue(id,phase)),observe:(id,phase)=>safely(()=>tracker.observe(id,phase)),dismiss:id=>safely(()=>tracker.dismiss(id))};
}
