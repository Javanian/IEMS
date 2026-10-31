import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startOwned} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {admissionProfile} from './admission.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('v15 mounted engine original receipts and actual local phase lifecycle',{timeout:150000},async t=>{
 let calls=0,lostAck=false,hold=null,revokeAtBegin=false,ownedDb,serviceId;
 const h=await startOwned(t,{integrations:{effects:{mode:'LOCAL_SIMULATED',controlFault:async boundary=>{if(boundary==='beforeProviderBegin'&&revokeAtBegin){revokeAtBegin=false;await ownedDb.collection('sessions').updateOne({_id:serviceId},{$set:{revoked:true}});}},adapterFault:async boundary=>{if(boundary==='afterProviderReceipt'&&lostAck){lostAck=false;throw Error('Owned local ACK loss');}},engine:{execute:async()=>{calls++;if(hold)await hold.promise;}}}}}),db=h.db,a=h.seeded[0];ownedDb=db;
 const call=(path,body={},key=randomUUID(),cookie=h.alpha)=>h.send('/cs/automation'+path,{body,cookie,headers:{'Idempotency-Key':key}});
 const issued=await call('/service-credentials',{label:'Owned engine service',ttlMinutes:30});assert.equal(issued.status,201);serviceId=issued.data.sessionId;h.runtime.automation={serviceToken:issued.data.token};
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasUser',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true}];await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});
 await h.ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,reason:'Owned managed phases',plan:'pilot',admissionProfile});const sub=()=>db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});
 const accept=async(k=randomUUID(),body={})=>{const r=await call('/run/wf-sla-escalation',body,k);assert.equal(r.status,202,JSON.stringify(r));return r;};
 const control=(commandId,action)=>h.send(`/saas/effects/${commandId}/${action}`,{body:{}});
 await t.test('acceptance once, exact original receipt, immutable replay and concurrent claim',async()=>{
  const k=randomUUID(),first=await accept(k),id=first.effect.commandId;assert.equal(first.data.state,'ACCEPTED');assert.equal(calls,0);assert.equal((await sub()).usage.apiCalls,'1');
  const again=await accept(k);assert.equal(again.data.runId,first.data.runId);assert.equal(again.data.state,'ACCEPTED');assert.equal(again.data.replayed,true);assert.equal((await sub()).usage.apiCalls,'1');
  assert.equal((await call('/run/wf-sla-escalation',{mode:'changed'},k)).error?.code,'IDEMPOTENCY_CONFLICT');
  const results=await Promise.all([control(id,'continue'),control(id,'continue')]);assert.ok(results.some(r=>r.status===200));assert.equal(calls,1);assert.equal((await sub()).usage.apiCalls,'1');
  const status=await h.send(`/saas/effects/${id}`);assert.equal(status.status,200);assert.equal(status.data.state,'COMPLETED');assert.equal(status.data.phases[0].phaseResult.state,'COMPLETED_LOCAL');
  const audit=await db.collection('automation_audit_logs').findOne({tenantId:a.tenantId,idempotencyKey:k});assert.deepEqual(audit.result,{runId:first.data.runId,state:'ACCEPTED'});assert.equal((await accept(k)).data.state,'ACCEPTED');
  assert.equal((await control(id,'continue')).status,200);assert.equal(calls,1);
  const errorKey=randomUUID(),error={runId:id,workflowId:'wf-sla-escalation',executionId:`local:${id}`,message:'Owned controlled callback'},cookie='portfolio_session='+issued.data.token,before=(await sub()).usage.apiCalls;
  assert.equal((await call('/engine-error',error,errorKey)).status,403);const observed=await call('/engine-error',error,errorKey,cookie);assert.equal(observed.status,201,JSON.stringify(observed));assert.equal(observed.data.state,'ERROR_OBSERVED');assert.equal((await call('/engine-error',error,errorKey,cookie)).data.replayed,true);assert.equal((await call('/engine-error',{...error,message:'Conflict'},errorKey,cookie)).error?.code,'IDEMPOTENCY_CONFLICT');assert.equal((await call('/engine-error',{...error,executionId:'other'},randomUUID(),cookie)).status,403);assert.equal((await sub()).usage.apiCalls,before);assert.equal((await db.collection('automation_engine_runs').findOne({_id:id})).state,'COMPLETED_LOCAL');
 });
 await t.test('lost ACK observes durable same attempt, no resend or worker charge',async()=>{
  const accepted=await accept(),id=accepted.effect.commandId,before=calls;lostAck=true;assert.equal((await control(id,'continue')).status,500);assert.equal(calls,before+1);assert.equal((await control(id,'observe')).status,200);assert.equal(calls,before+1);assert.equal((await sub()).usage.apiCalls,'2');
 });
 await t.test('quota denial and audit abort leave no root intent',async()=>{
  const before=await sub(),k=randomUUID(),n=await db.collection('automation_engine_runs').countDocuments({tenantId:a.tenantId});await db.collection('saasSubscriptions').updateOne({_id:before._id},{$set:{'usage.apiCalls':'10000'}});try{assert.equal((await call('/run/wf-sla-escalation',{},k)).error?.code,'SAAS_QUOTA_EXCEEDED');}finally{await db.collection('saasSubscriptions').replaceOne({_id:before._id},before);}assert.equal(await db.collection('automation_engine_runs').countDocuments({tenantId:a.tenantId}),n);
  h.runtime.automation.beforeAudit=async()=>{throw Error('Owned engine acceptance abort');};try{assert.equal((await call('/run/wf-sla-escalation',{},k)).status,500);}finally{delete h.runtime.automation.beforeAudit;}assert.equal(await db.collection('automation_engine_runs').countDocuments({tenantId:a.tenantId}),n);assert.equal(await db.collection('saasEffectCommands').countDocuments({'owner.identity.idempotencyKey':k}),0);assert.deepEqual((await sub()).usage,before.usage);
 });
 await t.test('service revocation blocks new claim with zero invocation',async()=>{
  const accepted=await accept(),before=calls;await db.collection('sessions').updateOne({_id:issued.data.sessionId},{$set:{revoked:true}});try{assert.equal((await control(accepted.effect.commandId,'continue')).status,403);assert.equal(calls,before);}finally{await db.collection('sessions').updateOne({_id:issued.data.sessionId},{$set:{revoked:false}});}
 });
 await t.test('revocation after invoke claim but before durable provider BEGIN prevents work',async()=>{
  const accepted=await accept(),id=accepted.effect.commandId,before=calls;revokeAtBegin=true;try{assert.equal((await control(id,'continue')).status,403);assert.equal(calls,before);const attempt=await db.collection('saasEffectAttempts').findOne({commandId:id});assert.equal(attempt.state,'UNKNOWN');assert.equal(attempt.provider,undefined);}finally{await db.collection('sessions').updateOne({_id:serviceId},{$set:{revoked:false}});}
 });
 await t.test('suspend closes dispatch atomically, real drain waits begun work, no late publication',async()=>{
  const accepted=await accept(),id=accepted.effect.commandId;let release;hold={promise:new Promise(r=>release=r)};const pending=control(id,'continue');for(let i=0;i<200&&!await db.collection('saasEffectAttempts').findOne({commandId:id,'provider.state':'BEGUN'});i++)await new Promise(r=>setTimeout(r,5));
  const current=await sub();await h.ok('/saas/suspend',{key:randomUUID(),expectedRevision:current.revision,reason:'Owned stop race'});let drained=false;const drain=h.send('/saas/quiesce',{body:{}}).then(r=>{drained=true;return r;});await new Promise(r=>setTimeout(r,30));assert.equal(drained,false);release();hold=null;const result=await pending;assert.equal(result.data.state,'PUBLICATION_DENIED');assert.equal((await drain).data.state,'QUIESCENT');assert.equal((await db.collection('automation_engine_runs').findOne({_id:id})).state,'ACCEPTED');assert.ok(await db.collection('saasEffectAttempts').findOne({commandId:id,'provider.state':'TERMINAL'}));
  const status=await h.send('/saas/status');assert.equal(status.data.subscription.state,'SUSPENDED');assert.equal(status.data.quiescence.state,'QUIESCENT');assert.equal((await control(id,'continue')).status,403);
 });
});
