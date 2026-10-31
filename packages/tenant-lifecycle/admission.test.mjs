import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startOwned} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {boundedTransaction,contentHash,createCommandExecutor} from '../tenant-foundation/commands.mjs';
import {createSaasAdmission,admissionProfile} from './admission.mjs';
import {admissionRegistry,validateAdmissionRoutes} from './admission-registry.mjs';
import {createAiDocuments} from '../scoped-ai/documents.mjs';
import {createApp} from '../../apps/portfolio-api/src/app.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('receipt admission on marker-owned Mongo', {timeout:120000}, async t=>{
 const h=await startOwned(t),a=h.seeded[0],filter={tenantId:a.tenantId,plantId:a.plantId},admission=h.runtime.saasAdmission;
 assert.throws(()=>createSaasAdmission({...h.runtime,coverage:'ALL_ENDPOINTS'}),{code:'SAAS_ADMISSION_UNSUPPORTED_CONFIGURATION'});
 const scope=await h.scopeOf(h.alpha),commands=h.runtime.commands;
 const command=(key,input={value:'one'})=>({...filter,action:'crm.write',aggregateId:'stable-aggregate',expectedRevision:0,key,input});
 const effect=async({session})=>{await h.db.collection('accounts').insertOne({_id:randomUUID(),...filter,name:'Owned callback effect'},{session});return {revision:1,data:{saved:true},events:[]};};
 await commands.execute(scope,command('legacy-before-enrollment'),effect);
 assert.equal(await h.db.collection('saasSubscriptions').countDocuments(),0);
 await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles:[{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false},{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'aiDocumentAdmin',plantIds:[a.plantId],tenantWide:false}]}});
 const admin=extra=>({key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'Owned admission test',admissionProfile,...extra});
 let response=await h.req('/saas/subscribe',admin({admissionProfile:'ALL_ENDPOINTS'}),h.alpha);
 assert.equal(response.status,503);
 response=await h.req('/saas/subscribe',admin(),h.alpha);assert.equal(response.status,200,JSON.stringify(response));
 const row=()=>h.db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});
 const usage=async()=> (await row()).usage.apiCalls;
 await t.test('guards authorize without charge; real warehouse receipt admits and replays once',async()=>{
  await boundedTransaction(h.client,async session=>{await admission.authorize(scope,{plantId:a.plantId,session});await admission.authorize(scope,{plantId:a.plantId,session});});
  assert.equal(await usage(),'0');
  const body={expectedVersion:1,idempotencyKey:randomUUID(),code:'SAAS_BIN'};
  let r=await h.req('/warehouse/bins',body,h.alpha);assert.equal(r.status,201,JSON.stringify(r));const id=r.data._id;
  r=await h.req('/warehouse/bins',body,h.alpha);assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data._id,id);assert.equal(await usage(),'1');
  r=await h.req('/warehouse/bins',{...body,code:'CHANGED'},h.alpha);assert.equal(r.status,409);assert.equal(r.error.code,'IDEMPOTENCY_CONFLICT');assert.equal(await usage(),'1');
  const before=await h.db.collection('accounts').countDocuments(filter);
  r=await h.req('/crm/accounts',{name:'Must not write'},h.alpha);assert.equal(r.status,400);assert.equal(r.error.code,'COMMAND_KEY_REQUIRED');assert.equal(await h.db.collection('accounts').countDocuments(filter),before);
  r=await h.req('/cs/simulator/dispatch',{},h.alpha);assert.equal(r.status,403,JSON.stringify(r));
  h.runtime.platform.handlers.ownedProbe=async()=>assert.fail('Job must not run');
  r=await h.req('/platform/jobs',{kind:'ownedProbe',input:{},key:randomUUID()},h.alpha);assert.equal(r.status,403,JSON.stringify(r));
  assert.equal(await h.db.collection('jobs').countDocuments(filter),0);assert.equal(await usage(),'1');
 });
 await t.test('foundation receipt, hash conflict, missing port and abort rollback',async()=>{
  const key=randomUUID(),c=command(key);await commands.execute(scope,c,effect);assert.equal(await usage(),'2');
  assert.equal((await commands.execute(scope,c,()=>assert.fail('replay effect'))).replayed,true);assert.equal(await usage(),'2');
  await assert.rejects(commands.execute(scope,command(key,{changed:true}),effect),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(await usage(),'2');
  const noPort=createCommandExecutor(h.runtime);await assert.rejects(noPort.execute(scope,c,effect),{code:'SAAS_ADMISSION_PORT_REQUIRED'});
  const retryKey=randomUUID();let calls=0;
  await commands.execute(scope,command(retryKey),async context=>{calls++;await effect(context);if(calls===1)throw Object.assign(new Error('Injected retry'),{errorLabels:['TransientTransactionError']});return {revision:1,data:{retry:true},events:[]};});
  assert.equal(calls,2);assert.equal(await usage(),'3');
  const count=await h.db.collection('accounts').countDocuments(filter);
  await assert.rejects(commands.execute(scope,command(randomUUID()),async context=>{await effect(context);throw new Error('Injected abort');}),/Injected abort/);
  assert.equal(await usage(),'3');assert.equal(await h.db.collection('accounts').countDocuments(filter),count);
 });
 await t.test('same-session repeated hook inherits one receipt; authority dimensions unchanged',async()=>{
  const key=randomUUID(),payloadHash=contentHash({fixture:true});
  await boundedTransaction(h.client,async session=>{
   const d={scope,session,namespace:'warehouseKeys',key,action:'warehouse.receive',payloadHash,replayed:false};
   assert.equal((await admission.effect(d)).charged,true);assert.equal((await admission.effect(d)).charged,false);
   await h.db.collection('warehouseKeys').insertOne({_id:randomUUID(),...filter,key,payloadHash,result:{fixture:true}},{session});
  });assert.equal(await usage(),'4');
 });
 await t.test('quota, revoked saas.use, wrong scope and concurrent suspension fail closed',async()=>{
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':'10000'}});
  await assert.rejects(commands.execute(scope,command(randomUUID()),effect),{code:'SAAS_QUOTA_EXCEEDED'});
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':'4'}});
  const membership=await h.db.collection('memberships').findOne({_id:a.membershipId});
  await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:membership.roles.filter(r=>r.role!=='saasUser')}});
  await assert.rejects(commands.execute(scope,command('legacy-before-enrollment'),effect),{code:'SCOPE_DENIED'});
  await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:membership.roles}});
  await assert.rejects(commands.execute(scope,{...command(randomUUID()),plantId:h.seeded[1].plantId},effect),{code:'SCOPE_DENIED'});
  const session=h.client.startSession();session.startTransaction();
  try {
   const before=await h.db.collection('saasSubscriptions').findOne({tenantId:a.tenantId},{session});
   const r=await h.req('/saas/suspend',{key:randomUUID(),expectedRevision:before.revision,reason:'Owned suspension'},h.alpha);assert.equal(r.status,200,JSON.stringify(r));
   await assert.rejects(admission.authorize(scope,{plantId:a.plantId,session}),e=>e.hasErrorLabel?.('TransientTransactionError')||e.code==='SAAS_ADMISSION_SUSPENDED');
  }finally{if(session.inTransaction())await session.abortTransaction();await session.endSession();}
  await assert.rejects(commands.execute(scope,command('legacy-before-enrollment'),effect),{code:'SAAS_ADMISSION_SUSPENDED'});
  const r=await h.req('/saas/resume',{key:randomUUID(),expectedRevision:(await row()).revision,reason:'Owned administrative recovery'},h.alpha);assert.equal(r.status,200,JSON.stringify(r));assert.equal(await usage(),'4');
 });
 await t.test('nested constructor forwarding and actual host registry',async()=>{
  for(const path of ['packages/scoped-ai/documents.mjs','packages/scoped-ai/indexing.mjs','packages/scoped-ai/models.mjs','packages/scoped-ai/vendor-drafts.mjs','apps/portfolio-api/src/portals.mjs']) {
   const text=await readFile(new URL(`../../${path}`,import.meta.url),'utf8');
   const calls=text.match(/createCommandExecutor\([^\n]+/g)||[];assert.ok(calls.length);assert.ok(calls.every(call=>call.includes('admission:')),'explicit callback at every constructor '+path);
  }
  assert.equal(admissionRegistry.routes.length,395);assert.equal(admissionRegistry.fullEndpointCoverage,false);
  assert.throws(()=>validateAdmissionRoutes({router:{stack:[]}}),{code:'SAAS_HOST_ROUTES_UNREGISTERED'});
  const unvalidated=createSaasAdmission({...h.runtime,coverage:admissionProfile});await assert.rejects(unvalidated.enrollmentGuard(admissionProfile),{code:'SAAS_ADMISSION_INCOMPLETE'});
  const configured=createSaasAdmission({...h.runtime,coverage:admissionProfile,integrations:{rag:{vectors:{}}}});
  configured.validateHost(createApp(h.runtime,{origins:['http://localhost:4173']}));
  await assert.rejects(configured.enrollmentGuard(admissionProfile),{code:'SAAS_ADMISSION_EXTERNAL_ADAPTER_UNCOVERED'});
 });
 await t.test('competing new commands cannot overspend the last quota unit',async()=>{
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':'9999'}});
  const inputs=[command(randomUUID()),command(randomUUID())];
  const results=await Promise.allSettled(inputs.map(input=>commands.execute(scope,input,effect)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.findIndex(r=>r.status==='rejected'),error=results[rejected].reason;
  if(error.hasErrorLabel?.('TransientTransactionError')||error.errorLabels?.includes('TransientTransactionError')) {
   // Existing bounded retries may exhaust during contention; reconcile the same authoritative key.
   await assert.rejects(commands.execute(scope,inputs[rejected],effect),{code:'SAAS_QUOTA_EXCEEDED'});
  } else assert.equal(error.code,'SAAS_QUOTA_EXCEEDED');
  assert.equal(await usage(),'10000');
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':'4'}});
 });
 await t.test('stale unenrolled effect contends with enrollment; external history blocks enrollment',async()=>{
  const b=h.seeded[1];
  await h.db.collection('memberships').updateOne({_id:b.membershipId},{$set:{tenantWide:true,roles:[{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[b.plantId],tenantWide:false},{role:'owner',plantIds:[b.plantId],tenantWide:false}]}});
  const betaScope=await h.scopeOf(h.beta),session=h.client.startSession();session.startTransaction();
  try {
   await h.db.collection('tenants').findOne({_id:b.tenantId},{session});
   const r=await h.req('/saas/subscribe',admin(),h.beta);assert.equal(r.status,200,JSON.stringify(r));
   await assert.rejects(admission.unsupported(betaScope,{plantId:b.plantId,session}),e=>e.hasErrorLabel?.('TransientTransactionError')||e.code==='SAAS_ADMISSION_UNSUPPORTED_EFFECT');
  }finally{if(session.inTransaction())await session.abortTransaction();await session.endSession();}
  await h.db.collection('automation_engine_runs').insertOne({_id:randomUUID(),tenantId:b.tenantId,plantId:b.plantId,state:'ENGINE_ACKNOWLEDGED'});
  const sub=await h.db.collection('saasSubscriptions').findOne({tenantId:b.tenantId});
  const r=await h.req('/saas/subscribe',admin({expectedRevision:sub.revision}),h.beta);assert.equal(r.status,409);assert.equal(r.error.code,'SAAS_ENROLLMENT_EXTERNAL_EFFECT_PENDING');
 });
 await t.test('actual nested publisher forwards callback; synthetic source revocation also denies replay',async()=>{
  let revoked=false,reads=0;
  const issuedSource={async readAuthorized({session}){assert.ok(session.inTransaction());reads++;if(revoked)throw Object.assign(new Error('Synthetic source revoked'),{code:'SCOPE_DENIED',status:403});return {title:'Owned issued source',text:'Synthetic authoritative document'};}};
  const documents=createAiDocuments({...h.runtime,issuedSource});
  const input={plantId:a.plantId,resourceId:randomUUID(),key:randomUUID(),expectedRevision:0,title:'Source selection',allowedUserIds:[a.userId],
   sourceReference:{cohort:'LEGACY',vendorId:randomUUID(),orderId:randomUUID(),documentRevision:1,sourceHash:contentHash({source:true})}};
  const before=await usage();await documents.publish(scope,input);assert.equal(await usage(),String(BigInt(before)+1n));
  assert.equal((await documents.publish(scope,input)).replayed,true);assert.equal(await usage(),String(BigInt(before)+1n));assert.ok(reads>=3);
  revoked=true;await assert.rejects(documents.publish(scope,input),{code:'SCOPE_DENIED'});assert.equal(await usage(),String(BigInt(before)+1n));
 });
});
