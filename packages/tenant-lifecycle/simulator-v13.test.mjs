import{createTenantFoundation}from'../tenant-foundation/index.mjs';import{createCustomerService}from'../customer-service/index.mjs';import{createSaasAdmission}from'./admission.mjs';import{createApp}from'../../apps/portfolio-api/src/app.mjs';import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{startOwned}from'../../apps/portfolio-api/test/support/owned-mongo.mjs';import{admissionProfile}from'./admission.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('v13 actual simulator HTTP keeps enrolled inbound queued without worker execution',{timeout:120000},async t=>{
 const h=await startOwned(t),db=h.db,a=h.seeded[0],b=h.seeded[1];
 const roles=member=>[{role:'owner',plantIds:[member.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[member.plantId],tenantWide:false}];
 for(const member of[a,b])await db.collection('memberships').updateOne({_id:member.membershipId},{$set:{tenantWide:true,roles:roles(member)}});
 async function setup(member,cookie,address){const account=await h.ok('/crm/accounts',{name:'Owned v13 customer'},201,cookie),contact=await h.ok(`/crm/accounts/${account._id}/contacts`,{name:'Owned contact',email:'owned@iems.local'},201,cookie);const r=await h.send('/cs/bindings',{cookie,headers:{'Idempotency-Key':randomUUID()},body:{accountId:account._id,contactId:contact._id,channel:'SIMULATED',address}});assert.equal(r.status,201,JSON.stringify(r));return r.data.binding;}
 const binding=await setup(a,h.alpha,'+620001111111'),betaBinding=await setup(b,h.beta,'+620002222222');
 const sub=tenantId=>db.collection('saasSubscriptions').findOne({tenantId});
 const enroll=async(member,cookie)=>h.ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'Owned v13 current disposition',admissionProfile},200,cookie);
 const legacy={bindingId:binding.bindingId,inboundKey:randomUUID(),text:'MENU'},old=await h.ok('/cs/simulator/inbound',legacy);assert.ok(old.previewedDeliveryIds.length>0);assert.equal(old.reply.state,'PREVIEWED');
 await enroll(a,h.alpha);let claims=0;const originalPreview=h.runtime.customerServicePreview;h.runtime.customerServicePreview=Object.freeze({...originalPreview,async claimNextDelivery(input){claims++;return originalPreview.claimNextDelivery(input);}});t.after(()=>{h.runtime.customerServicePreview=originalPreview;});
 await t.test('legacy receipt replay is reclassified under current enrollment, not its original mode',async()=>{const before=await db.collection('cs_outbox').find({tenantId:a.tenantId}).toArray();const result=await h.ok('/cs/simulator/inbound',legacy);assert.deepEqual(result.previewedDeliveryIds,[]);assert.equal(result.reply.state,'PREVIEWED','actual historic projection retained');assert.deepEqual(await db.collection('cs_outbox').find({tenantId:a.tenantId}).toArray(),before);assert.equal(claims,0);assert.equal((await sub(a.tenantId)).usage.apiCalls,'0');});
 const command={bindingId:binding.bindingId,inboundKey:randomUUID(),text:'MENU'};let once;
 await t.test('new enrolled command and exact replay return real queued projections; no private marker leak',async()=>{
  once=await h.ok('/cs/simulator/inbound',command);assert.deepEqual(once.previewedDeliveryIds,[]);assert.equal(once.reply.state,'QUEUED');assert.equal(claims,0);assert.equal((await sub(a.tenantId)).usage.apiCalls,'1');
  for(const message of once.deliveries){const row=await db.collection('cs_outbox').findOne({_id:message.messageId});assert.equal(row.state,'QUEUED');assert.equal(row.attempt,0);assert.equal(row.fence,0);assert.equal(row.leaseOwner,null);assert.equal(row.providerMessageId,null);}
  assert.deepEqual(await h.ok('/cs/simulator/inbound',command),once);assert.equal((await sub(a.tenantId)).usage.apiCalls,'1');assert.equal(claims,0);
  const receipt=await db.collection('cs_idempotency').findOne({tenantId:a.tenantId,scope:'inbound.command',key:command.inboundKey});assert.ok(receipt);assert.ok(!JSON.stringify(receipt.result).match(/disposition|enrolled/i));assert.ok(!JSON.stringify(once).match(/disposition|enrolled/i));
  assert.equal((await h.req('/cs/simulator/inbound',{...command,enrolled:false},h.alpha)).status,400);
  assert.equal((await h.req('/cs/simulator/inbound',{...command,text:'HUMAN'},h.alpha)).status,409);
 });
 await t.test('known read denial and wrong scope reject before root receipt/effect/usage',async()=>{
  const before=await db.collection('cs_idempotency').countDocuments({tenantId:a.tenantId}),usage=(await sub(a.tenantId)).usage;
  await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:[{role:'csSimulator',plantIds:[a.plantId],tenantWide:false},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}]}});
  try{
    // A real foundation with a narrower configured role proves the preflight; the default host's csSimulator already grants read.
    const foundation=createTenantFoundation({client:h.client,db,roleActions:{csSimulator:['cs.simulator.use'],saasUser:['saas.use']}});
    const strictScope=await foundation.authenticate(h.alpha.slice('portfolio_session='.length));
    assert.equal((await foundation.authorize(strictScope,{plantId:a.plantId,action:'cs.simulator.use'})).userId,a.userId);
    await assert.rejects(foundation.authorize(strictScope,{plantId:a.plantId,action:'cs.ticket.read'}),{code:'SCOPE_DENIED'});
    const admission=createSaasAdmission({...h.runtime,foundation,coverage:admissionProfile});admission.validateHost(createApp(h.runtime,{origins:['http://localhost:4173']}));
    const service=createCustomerService({client:h.client,db,foundation,saasAdmission:admission,createCustomerServicePort:admission.createCustomerServicePort});
    await assert.rejects(service.simulateInbound(strictScope,{...command,plantId:a.plantId,inboundKey:randomUUID()}),{code:'SCOPE_DENIED'});
  }finally{await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:roles(a)}});}
  assert.equal((await h.req('/cs/simulator/inbound',{...command,inboundKey:randomUUID()},h.beta)).status,404);assert.equal(await db.collection('cs_idempotency').countDocuments({tenantId:a.tenantId}),before);assert.deepEqual((await sub(a.tenantId)).usage,usage);
 });
 await t.test('suspension/revoked binding deny replay; separate dispatch remains unsupported',async()=>{
  const usage=(await sub(a.tenantId)).usage;await h.ok('/saas/suspend',{key:randomUUID(),expectedRevision:(await sub(a.tenantId)).revision,reason:'Owned suspension'});assert.equal((await h.req('/cs/simulator/inbound',command,h.alpha)).status,403);await h.ok('/saas/resume',{key:randomUUID(),expectedRevision:(await sub(a.tenantId)).revision,reason:'Owned recovery'});
  const row=await db.collection('cs_contact_bindings').findOne({_id:binding.bindingId});await db.collection('cs_contact_bindings').updateOne({_id:binding.bindingId},{$set:{status:'REVOKED'}});try{assert.equal((await h.req('/cs/simulator/inbound',command,h.alpha)).status,409);}finally{await db.collection('cs_contact_bindings').replaceOne({_id:binding.bindingId},row);}
  const before=await db.collection('cs_outbox').find({tenantId:a.tenantId}).toArray();assert.equal((await h.req('/cs/simulator/dispatch',{},h.alpha)).status,403);assert.deepEqual(await db.collection('cs_outbox').find({tenantId:a.tenantId}).toArray(),before);assert.deepEqual((await sub(a.tenantId)).usage,usage);
 });
 await t.test('enrollment between root commit and actual worker call returns queued outcome without weakening worker gate',async()=>{
  let raced=false;h.runtime.customerServicePreview=Object.freeze({...originalPreview,async claimNextDelivery(input){if(input.tenantId===b.tenantId&&!raced){raced=true;await enroll(b,h.beta);}return originalPreview.claimNextDelivery(input);}});
  const input={bindingId:betaBinding.bindingId,inboundKey:randomUUID(),text:'MENU'},result=await h.ok('/cs/simulator/inbound',input,200,h.beta);assert.equal(raced,true);assert.deepEqual(result.previewedDeliveryIds,[]);assert.equal(result.reply.state,'QUEUED');const row=await db.collection('cs_outbox').findOne({_id:result.reply.messageId});assert.equal(row.attempt,0);assert.equal(row.fence,0);assert.equal((await sub(b.tenantId)).usage.apiCalls,'0');
  assert.deepEqual(await h.ok('/cs/simulator/inbound',input,200,h.beta),result);assert.equal((await sub(b.tenantId)).usage.apiCalls,'0');
 });
});
