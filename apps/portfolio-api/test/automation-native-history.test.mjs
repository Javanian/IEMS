import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {startOwned} from './support/owned-mongo.mjs';
import {initialize,createApp} from '../src/app.mjs';
import {contentHash} from '../../../packages/tenant-foundation/commands.mjs';
import {effectHash} from '../../../packages/tenant-lifecycle/effects.mjs';
import {admissionProfile} from '../../../packages/tenant-lifecycle/admission.mjs';
import {nativeN8nWorkflowHash,nativeN8nBinding} from '../../../packages/tenant-lifecycle/native-n8n-provider.mjs';

process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
const cleanup=[];let h,runtime,send,call,service,root,claimLost=false;
before(async()=>{
  h=await startOwned({after:fn=>cleanup.push(fn)});
  const parent=resolve(process.env.IEMS_NATIVE_TEST_ROOT??tmpdir());await mkdir(parent,{recursive:true});root=await mkdtemp(join(parent,'native-automation-synthetic-'));
  const marker=(await h.db.collection('ownedRun').findOne({}))._id,instanceId=randomUUID();
  await writeFile(join(root,'native-owner.json'),JSON.stringify({schema:'IEMS_NATIVE_N8N_OWNER_V1',marker,instanceId,databaseName:h.db.databaseName,n8nVersion:'1.121.3',evidenceClass:'SYNTHETIC'}));
  const workflows=[];
  for(const workflowId of ['wf-sla-escalation','wf-cs-weekly-digest','wf-approved-resolution','wf-automation-recovery']){
    const workflow=JSON.parse(await readFile(new URL(`../../../ops/automation-lab/workflows/${workflowId}.json`,import.meta.url),'utf8'));
    workflows.push({workflowId,workflowHash:nativeN8nWorkflowHash(workflow),inputNode:'IEMS_NATIVE_INPUT',resultNode:'IEMS_NATIVE_RESULT',webhookUrl:`http://127.0.0.1:32743/webhook/${workflowId}`});
  }
  runtime=await initialize({client:h.client,db:h.db,ownedRunMarker:marker,integrations:{effects:{mode:'NATIVE_LOCAL_N8N',controlFault:async(boundary)=>{if(boundary==='afterClaimCommit'&&claimLost){claimLost=false;throw Error('Synthetic claim ACK loss');}},nativeN8n:{root,instanceId,evidenceClass:'SYNTHETIC',webhookToken:randomUUID(),n8nPackageRoot:process.env.IEMS_N8N_PACKAGE_ROOT??'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n',workflows}}}});
  const server=createApp(runtime,{origins:['http://localhost:4173']}).listen(32747,'127.0.0.1');await new Promise(r=>server.once('listening',r));cleanup.unshift(()=>new Promise(r=>server.close(r)));
  send=async(path,{body,cookie=h.alpha,headers={}}={})=>{const response=await fetch(`http://127.0.0.1:32747/api${path}`,{method:body===undefined?'GET':'POST',headers:{origin:'http://localhost:4173','content-type':'application/json',cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json()};};
  call=(path,body={},key=randomUUID())=>send('/cs/automation'+path,{body,headers:{'Idempotency-Key':key}});
  const issued=await call('/service-credentials',{label:'Native synthetic service',ttlMinutes:30});assert.equal(issued.status,201,JSON.stringify(issued));service=issued.data;runtime.automation={serviceToken:service.token};
  const a=h.seeded[0];await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles:[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasUser',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true}]}});
  const sub=await send('/saas/subscribe',{body:{key:randomUUID(),expectedRevision:0,reason:'Synthetic native admission checks',plan:'pilot',admissionProfile}});assert.equal(sub.status,200,JSON.stringify(sub));
},{timeout:120000});
after(async()=>{for(const fn of cleanup)await fn();},{timeout:60000});

test('native handlers preserve original intent and refuse synthetic settlement',{timeout:180000},async t=>{
  const db=h.db,sub=()=>db.collection('saasSubscriptions').findOne({tenantId:h.seeded[0].tenantId});
  const digest=async()=>{const result=await call('/digest/dispatch',{mode:'DEMO',periodKey:randomUUID()});assert.equal(result.status,200,JSON.stringify(result));return db.collection('cs_outbox').findOne({_id:result.data.deliveryId});};
  const control=(id,phase,action='continue')=>send(`/saas/effects/${id}/${action}`,{body:phase?{phase}:{}});
  let delivery,parentId,attempt;
  await t.test('enrolled scoped service owns its intent, replays once and cannot perform human or subscription administration',async()=>{
    const cookie='portfolio_session='+service.token,key=randomUUID(),payload={mode:'DEMO',periodKey:randomUUID()},before=BigInt((await sub()).usage.apiCalls);
    assert.deepEqual(service.grants,['cs.automation.read','cs.automation.execute','saas.use']);
    assert.equal((await db.collection('memberships').findOne({_id:service.membershipId})).roles[0].role,'nativeAutomationService');
    const request=()=>send('/cs/automation/digest/dispatch',{body:payload,cookie,headers:{'Idempotency-Key':key}}),first=await request();assert.equal(first.status,200,JSON.stringify(first));
    const d=await db.collection('cs_outbox').findOne({_id:first.data.deliveryId}),command=await db.collection('saasEffectCommands').findOne({_id:d.controlCommandId});assert.equal(command.actor.userId,service.userId);assert.equal(command.actor.membershipId,service.membershipId);
    assert.equal(BigInt((await sub()).usage.apiCalls),before+1n);assert.equal((await request()).data.deliveryId,d._id);assert.equal(BigInt((await sub()).usage.apiCalls),before+1n);
    const human=await control(command._id,d._id);assert.equal(human.status,403);assert.equal(human.error.code,'EFFECT_ORIGINAL_ACTOR_CHANGED');assert.equal(await db.collection('saasEffectAttempts').countDocuments({commandId:command._id}),0);
    assert.equal((await send(`/saas/effects/${command._id}`,{cookie})).status,200);assert.equal((await send(`/saas/effects/${command._id}`,{cookie:h.beta})).status,404);
    for(const [path,body] of [['/cs/automation/pause',{paused:true}],['/cs/automation/service-credentials',{label:'Forbidden service mint'}],['/saas/subscribe',{key:randomUUID(),expectedRevision:1,reason:'Forbidden service administration',plan:'pilot',admissionProfile}]])assert.equal((await send(path,{body,cookie,headers:{'Idempotency-Key':randomUUID()}})).status,403,path);
    await db.collection('sessions').updateOne({_id:service.sessionId},{$set:{revoked:true}});try{assert.equal((await request()).status,401);}finally{await db.collection('sessions').updateOne({_id:service.sessionId},{$set:{revoked:false}});}
    assert.equal(BigInt((await sub()).usage.apiCalls),before+1n);
    const other=await call('/service-credentials',{label:'Revocable native service',ttlMinutes:30});assert.equal(other.status,201,JSON.stringify(other));
    assert.equal((await send(`/cs/automation/service-credentials/${other.data.sessionId}/revoke`,{body:{},cookie:h.beta,headers:{'Idempotency-Key':randomUUID()}})).status,404);
    const revoked=await call(`/service-credentials/${other.data.sessionId}/revoke`,{});assert.equal(revoked.status,200,JSON.stringify(revoked));assert.equal((await db.collection('sessions').findOne({_id:other.data.sessionId})).revoked,true);
  });
  await t.test('recovery uses a frozen native child; BEGIN stays unknown and never becomes preview proof',async()=>{
    delivery=await digest();const child=await db.collection('saasEffectCommands').findOne({_id:delivery.controlCommandId});assert.equal(child.kind,'automation.native-delivery');assert.equal(child.plan.native.providerId,'native.n8n');
    const accepted=await call('/reconcile',{deliveryIds:[delivery._id]});assert.equal(accepted.status,202,JSON.stringify(accepted));parentId=accepted.effect.commandId;
    const usage=(await sub()).usage.apiCalls,result=await control(parentId);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'NEEDS_REVIEW');assert.equal((await sub()).usage.apiCalls,usage);
    attempt=await db.collection('saasEffectAttempts').findOne({commandId:child._id});assert.equal(attempt.state,'UNKNOWN');assert.equal(attempt.provider.state,'UNKNOWN');assert.equal(attempt.provider.dispatched,true);
    assert.equal(attempt.inputHash,effectHash(attempt.input));assert.equal(attempt.parent.commandId,parentId);assert.equal(nativeN8nBinding(attempt,{providerId:'native.n8n',instanceId:child.plan.native.instanceId}).attemptId,attempt._id);
    assert.equal(await runtime.nativeN8nProvider.observe(attempt),null);assert.equal((await db.collection('cs_outbox').findOne({_id:delivery._id})).deliveryState,'SENDING');
    const again=await call('/reconcile',{deliveryIds:[delivery._id]});assert.equal(again.status,202);assert.equal((await control(again.effect.commandId)).data.status,'NEEDS_REVIEW');assert.equal(await db.collection('saasEffectAttempts').countDocuments({commandId:child._id}),1);
    const receipt=await db.collection('automation_audit_logs').findOne(child.owner.identity);assert.deepEqual(receipt.result,child.acceptedResult);
  });
  await t.test('legacy local receipt observation cannot bypass the native attempt',async()=>{
    const r=await call('/reconcile',{mode:'LOCAL_OBSERVE_V1',deliveryIds:[delivery._id]});assert.equal(r.status,409);assert.equal(r.error.code,'MANAGED_NATIVE_RECONCILIATION_REQUIRED');
    assert.equal((await db.collection('saasEffectAttempts').findOne({_id:attempt._id})).state,'UNKNOWN');
  });
  await t.test('human retry after BEGIN cannot create a fresh native ordinal',async()=>{
    await db.collection('cs_outbox').updateOne({_id:delivery._id},{$set:{state:'UNKNOWN',deliveryState:'UNKNOWN'}});
    const review=await call(`/deliveries/${delivery._id}/review`,{decision:'CONFIRMED_NOT_SUBMITTED',evidence:'Synthetic assertion cannot prove no native send'});assert.equal(review.status,409,JSON.stringify(review));assert.equal(review.error.code,'NATIVE_DELIVERY_RECONCILIATION_REQUIRED');
    await control(delivery.controlCommandId,delivery._id);assert.equal(await db.collection('saasEffectAttempts').countDocuments({commandId:delivery.controlCommandId}),1);assert.equal((await db.collection('saasEffectAttempts').findOne({_id:attempt._id})).provider.state,'UNKNOWN');
  });
  await t.test('native engine acceptance keeps a null execution ID until real history exists',async()=>{
    const accepted=await call('/run/wf-sla-escalation',{});assert.equal(accepted.status,202,JSON.stringify(accepted));assert.equal(accepted.effect.mode,'NATIVE_LOCAL_N8N');const id=accepted.effect.commandId;
    assert.equal((await db.collection('automation_engine_runs').findOne({_id:id})).executionId,null);
    const result=await control(id);assert.equal(result.status,503,JSON.stringify(result));assert.equal(result.error.code,'SYNTHETIC_NATIVE_IO_FORBIDDEN');assert.equal((await db.collection('automation_engine_runs').findOne({_id:id})).state,'ACCEPTED');
  });
  await t.test('current service revocation blocks a fresh child before BEGIN',async()=>{
    const d=await digest();await db.collection('sessions').updateOne({_id:service.sessionId},{$set:{revoked:true}});
    try{const r=await control(d.controlCommandId,d._id);assert.equal(r.status,403);assert.equal(await db.collection('saasEffectAttempts').countDocuments({commandId:d.controlCommandId}),0);}finally{await db.collection('sessions').updateOne({_id:service.sessionId},{$set:{revoked:false}});}
  });
  await t.test('native engine source mismatch uses the publication-conflict code before BEGIN',async()=>{
    const a=h.seeded[0],bindingId=randomUUID(),ticketId=randomUUID(),customerId=randomUUID();
    await db.collection('cs_contact_bindings').insertOne({_id:bindingId,tenantId:a.tenantId,plantId:a.plantId,customerId,synthetic:true,channelAccountId:'SIMULATED',status:'ACTIVE',expiresAt:null,version:1});
    await db.collection('cs_tickets').insertOne({_id:ticketId,tenantId:a.tenantId,plantId:a.plantId,customerId,bindingId,version:1,stage:'RESOLVED'});
    const accepted=await call('/run/wf-sla-escalation',{ticketId});assert.equal(accepted.status,202,JSON.stringify(accepted));
    await db.collection('cs_tickets').updateOne({_id:ticketId},{$inc:{version:1}});
    const result=await control(accepted.effect.commandId);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.error.code,'ENGINE_RUN_SOURCE_CHANGED');assert.equal(await db.collection('saasEffectAttempts').countDocuments({commandId:accepted.effect.commandId}),0);
  });
  await t.test('status is read-only and foreign scope does not reveal native attempts',async()=>{
    const snapshot=async()=>{const result={};for(const {name} of await db.listCollections().toArray())result[name]=await db.collection(name).find({}).sort({_id:1}).toArray();return result;};
    const before=await snapshot();assert.equal((await send(`/saas/effects/${delivery.controlCommandId}`)).status,200);assert.equal((await send(`/saas/effects/${parentId}`)).status,200);assert.equal((await send(`/saas/effects/${parentId}`,{cookie:h.beta})).status,404);assert.deepEqual(await snapshot(),before);
  });
  await t.test('orchestration collections contain no transient message or service token',async()=>{
    for(const name of ['saasEffectCommands','saasEffectAttempts','saasEffectEvents','saasEffectBarriers']){const serialized=JSON.stringify(await db.collection(name).find({}).toArray());assert.ok(!serialized.includes(service.token),name);assert.ok(!serialized.includes(delivery.body),name);}
  });
});
