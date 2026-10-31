import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{startOwned}from'../../apps/portfolio-api/test/support/owned-mongo.mjs';import{admissionProfile}from'./admission.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('v12 real CS private principal and receipt admission smoke',{timeout:120000},async t=>{
 let loseAck=false;const h=await startOwned(t,{customerService:{faultInjector:async boundary=>{if(boundary==='afterCommit'&&loseAck){loseAck=false;throw new Error('Owned lost commit acknowledgement');}}}}),a=h.seeded[0],db=h.db,cs=h.runtime.customerService,scope=await h.scopeOf(h.alpha);
 const account=await h.ok('/crm/accounts',{name:'Owned private CS customer'},201),contact=await h.ok(`/crm/accounts/${account._id}/contacts`,{name:'Owned CS contact',email:'owned@iems.local'},201);
 const newBinding=async address=>{const result=await h.send('/cs/bindings',{body:{accountId:account._id,contactId:contact._id,channel:'SIMULATED',address},headers:{'Idempotency-Key':randomUUID()}});assert.equal(result.status,201,JSON.stringify(result));return result.data.binding;};
 const binding=await newBinding('+620001234567'),principal=await cs.resolveCustomerPrincipal({tenantId:a.tenantId,channelAccountId:'SIMULATED',providerContactId:'sim-620001234567'});
 let draft=await cs.startComplaintDraft(principal,{requestKey:randomUUID()});for(const action of [{type:'GENERAL_INQUIRY'},{type:'SELECT_CATEGORY',category:'OTHER'},{type:'DESCRIBE',text:'Owned private complaint'}])draft=await cs.updateComplaintDraft(principal,{draftId:draft.draftId,expectedVersion:draft.version,action});
 let secondDraft=await cs.startComplaintDraft(principal,{requestKey:randomUUID()});for(const action of [{type:'GENERAL_INQUIRY'},{type:'SELECT_CATEGORY',category:'OTHER'},{type:'DESCRIBE',text:'Owned second private complaint'}])secondDraft=await cs.updateComplaintDraft(principal,{draftId:secondDraft.draftId,expectedVersion:secondDraft.version,action});
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}];await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});await h.ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'Owned real private authority',admissionProfile});
 const sub=()=>db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});const command={draftId:draft.draftId,expectedVersion:draft.version,inboundKey:randomUUID()};
 const first=await cs.confirmComplaint(principal,command);const customerMeter=await db.collection('audit').findOne({kind:'saas.effect.metered',namespace:'cs_idempotency',action:'complaint.confirm'});assert.equal(customerMeter.customerId,account._id);assert.equal(customerMeter.bindingId,binding.bindingId);assert.equal(Object.hasOwn(customerMeter,'userId'),false);assert.equal((await sub()).usage.apiCalls,'1');assert.deepEqual(await cs.confirmComplaint(principal,command),first);assert.equal((await sub()).usage.apiCalls,'1');
 await assert.rejects(cs.confirmComplaint({...principal},command));await assert.rejects(h.runtime.customerServicePreview.confirmComplaint(principal,command));
 const transition={plantId:a.plantId,ticketId:first.ticketId,expectedVersion:1,toStage:'TRIAGED',reason:'Owned triage',commandKey:randomUUID()};const once=await cs.transitionTicket(scope,transition);assert.deepEqual(await cs.transitionTicket(scope,transition),once);assert.equal((await sub()).usage.apiCalls,'2');
 const inbound={inboundKey:randomUUID(),text:'HUMAN',command:{op:'HUMAN'}};const before=(await sub()).usage.apiCalls,result=await cs.handleInboundCommand(principal,inbound);assert.equal((await sub()).usage.apiCalls,String(BigInt(before)+1n),'nested receipt charged only top-level');assert.deepEqual(await cs.handleInboundCommand(principal,inbound),result);assert.equal((await sub()).usage.apiCalls,String(BigInt(before)+1n));

 const graph=async()=>{const snapshot={};for(const {name}of await db.listCollections({},{nameOnly:true}).toArray())if(name.startsWith('cs_'))snapshot[name]=await db.collection(name).find({}).sort({_id:1}).toArray();return snapshot;};
 const cases=[
  ['inbound.command',()=>cs.handleInboundCommand(principal,{inboundKey:caseKey,text:'MENU',command:{op:'MENU'}})],
  ['complaint.confirm',()=>cs.confirmComplaint(principal,{draftId:secondDraft.draftId,expectedVersion:secondDraft.version,inboundKey:caseKey})],
  ['ticket.transition',()=>cs.transitionTicket(scope,{plantId:a.plantId,ticketId:first.ticketId,expectedVersion:once.version,toStage:'ASSIGNED',assigneeId:a.userId,reason:'Owned assignment',commandKey:caseKey})],
  ['ticket.customer_comment',()=>cs.addCustomerComment(principal,{ticketNumber:first.ticketNumber,inboundKey:caseKey,text:'Owned comment'})],
  ['ticket.public_update',async()=>cs.addPublicUpdate(scope,{plantId:a.plantId,ticketId:first.ticketId,expectedVersion:fixedVersion??(fixedVersion=(await db.collection('cs_tickets').findOne({_id:first.ticketId})).version),text:'Owned public update',commandKey:caseKey})],
  ['ticket.internal_note',()=>cs.addInternalNote(scope,{plantId:a.plantId,ticketId:first.ticketId,text:'PRIVATE_INTERNAL_V12_SENTINEL',commandKey:caseKey})],
  ['conversation.takeover',async()=>{const conv=await db.collection('cs_conversations').findOne({bindingId:binding.bindingId});return cs.takeOverConversation(scope,{plantId:a.plantId,conversationId:conv._id,expectedVersion:fixedVersion??(fixedVersion=conv.version),commandKey:caseKey});}],
  ['conversation.mode',async()=>{const conv=await db.collection('cs_conversations').findOne({bindingId:binding.bindingId});return cs.setConversationMode(scope,{plantId:a.plantId,conversationId:conv._id,expectedVersion:fixedVersion??(fixedVersion=conv.version),toMode:'PAUSED',reason:'Owned pause',commandKey:caseKey});}],
  ['conversation.handoff_request',()=>cs.requestHandoff(principal,{inboundKey:caseKey})],
  ['binding.create',()=>cs.createBinding(scope,{plantId:a.plantId,accountId:account._id,contactId:contact._id,channel:'SIMULATED',address:'+620009876543',expiresAt:null,idempotencyKey:caseKey})],
  ['binding.revoke',async()=>{const b=await db.collection('cs_contact_bindings').findOne({address:'+620009876543'});return cs.revokeBindingByOperator(scope,{plantId:a.plantId,bindingId:b._id,expectedVersion:fixedVersion??(fixedVersion=b.version),reason:'Owned revoke',idempotencyKey:caseKey});}],
  ['delivery.review',async()=>{let delivery=await db.collection('cs_outbox').findOne({bindingId:binding.bindingId});if(!fixedVersion){await db.collection('cs_outbox').updateOne({_id:delivery._id},{$set:{state:'UNKNOWN'}});fixedVersion=1;}return cs.resolveUnknownDelivery(scope,{plantId:a.plantId,deliveryId:delivery._id,resolution:'ABANDON',evidence:'Owned synthetic transport uncertainty; no provider invoked',commandKey:caseKey});}],
 ];
 let caseKey,fixedVersion;
 for(const [namespace,invoke]of cases)await t.test(namespace,async()=>{
  caseKey=randomUUID();fixedVersion=null;
  // Prepare the existing uncertain delivery fixture before rollback comparisons.
  if(namespace==='delivery.review'){const d=await db.collection('cs_outbox').findOne({bindingId:binding.bindingId});await db.collection('cs_outbox').updateOne({_id:d._id},{$set:{state:'UNKNOWN'}});fixedVersion=1;}
  const before=await graph(),original=await sub();await db.collection('saasSubscriptions').updateOne({_id:original._id},{$set:{'usage.apiCalls':'10000'}});
  try{await assert.rejects(invoke(),{code:'SAAS_QUOTA_EXCEEDED'});}finally{await db.collection('saasSubscriptions').replaceOne({_id:original._id},original);}
  assert.deepEqual(await graph(),before,namespace+' quota rollback');
  await db.command({collMod:'cs_idempotency',validator:{$expr:{$eq:[1,2]}},validationLevel:'strict',validationAction:'error'});
  try{await assert.rejects(invoke());}finally{await db.command({collMod:'cs_idempotency',validator:{},validationLevel:'strict',validationAction:'error'});}
  assert.deepEqual(await graph(),before,namespace+' receipt fault rollback');assert.deepEqual((await sub()).usage,original.usage);
  const saved=await invoke(),charged=(await sub()).usage.apiCalls;assert.equal(charged,String(BigInt(original.usage.apiCalls)+1n));assert.deepEqual(await invoke(),saved);assert.equal((await sub()).usage.apiCalls,charged);
  const receipt=await db.collection('cs_idempotency').findOne({tenantId:a.tenantId,scope:namespace,key:caseKey});assert.ok(receipt);await db.collection('cs_idempotency').updateOne({_id:receipt._id},{$set:{requestHash:'f'.repeat(64)}});
  try{await assert.rejects(invoke(),{code:namespace.startsWith('binding.')?'IDEMPOTENCY_KEY_REUSED':'IDEMPOTENCY_CONFLICT'});}finally{await db.collection('cs_idempotency').replaceOne({_id:receipt._id},receipt);}
  assert.equal((await sub()).usage.apiCalls,charged);
  if(['inbound.command','complaint.confirm','conversation.handoff_request','ticket.customer_comment'].includes(namespace)) {
    const originalBinding=await db.collection('cs_contact_bindings').findOne({_id:binding.bindingId});await db.collection('cs_contact_bindings').updateOne({_id:binding.bindingId},{$set:{status:'REVOKED'}});
    try{await assert.rejects(invoke());}finally{await db.collection('cs_contact_bindings').replaceOne({_id:binding.bindingId},originalBinding);}
  }
  if(!['inbound.command','complaint.confirm','conversation.handoff_request','ticket.customer_comment'].includes(namespace)){await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:roles.filter(r=>r.role!=='owner')}});try{await assert.rejects(invoke());}finally{await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles}});}}
 });
 await t.test('private reads exclude notes; new root receipt and committed lost acknowledgement reconcile',async()=>{
  const view=await cs.getTicketForCustomer(principal,{ticketNumber:first.ticketNumber});assert.ok(!JSON.stringify(view).includes('PRIVATE_INTERNAL_V12_SENTINEL'));
  const root=await cs.startComplaintDraft(principal,{requestKey:randomUUID()});assert.ok(root.draftId);const before=(await sub()).usage.apiCalls;
  const cmd={inboundKey:randomUUID(),text:'MENU',command:{op:'MENU'}};loseAck=true;await assert.rejects(cs.handleInboundCommand(principal,cmd),/Owned lost commit acknowledgement/);assert.equal((await sub()).usage.apiCalls,String(BigInt(before)+1n));await cs.handleInboundCommand(principal,cmd);assert.equal((await sub()).usage.apiCalls,String(BigInt(before)+1n));
 });

 await t.test('nested inbound draft helpers and confirmation share one real transaction and charge',async()=>{
  const conv=await db.collection('cs_conversations').findOne({bindingId:binding.bindingId});await cs.setConversationMode(scope,{plantId:a.plantId,conversationId:conv._id,expectedVersion:conv.version,toMode:'BOT_ACTIVE',reason:'Owned bot workflow',commandKey:randomUUID()});
  const inbound=async(text,command)=>cs.handleInboundCommand(principal,{inboundKey:randomUUID(),text,command});
  await inbound('COMPLAINT',{op:'COMPLAINT'});await inbound('COMPLAINT GENERAL',{op:'DRAFT',action:{type:'GENERAL_INQUIRY'}});await inbound('COMPLAINT CATEGORY OTHER',{op:'DRAFT',action:{type:'SELECT_CATEGORY',category:'OTHER'}});await inbound('COMPLAINT DESCRIBE Nested real complaint',{op:'DRAFT',action:{type:'DESCRIBE',text:'Nested real complaint'}});
  const body={inboundKey:randomUUID(),text:'COMPLAINT CONFIRM',command:{op:'CONFIRM'}},usage=(await sub()).usage.apiCalls,before=await db.collection('cs_tickets').countDocuments({tenantId:a.tenantId});
  await db.command({collMod:'cs_idempotency',validator:{$expr:{$eq:[1,2]}},validationLevel:'strict',validationAction:'error'});
  try{await assert.rejects(cs.handleInboundCommand(principal,body));}finally{await db.command({collMod:'cs_idempotency',validator:{},validationLevel:'strict',validationAction:'error'});}
  assert.equal((await sub()).usage.apiCalls,usage);assert.equal(await db.collection('cs_tickets').countDocuments({tenantId:a.tenantId}),before);
  const result=await cs.handleInboundCommand(principal,body);assert.ok(result.receipt.ticketId);assert.equal(await db.collection('cs_tickets').countDocuments({tenantId:a.tenantId}),before+1);assert.equal(await db.collection('cs_idempotency').countDocuments({tenantId:a.tenantId,key:body.inboundKey}),2);assert.equal((await sub()).usage.apiCalls,String(BigInt(usage)+1n));assert.deepEqual(await cs.handleInboundCommand(principal,body),result);assert.equal((await sub()).usage.apiCalls,String(BigInt(usage)+1n));
 });
 await t.test('binding version and scoped-customer tamper invalidate the existing opaque capability',async()=>{
  const original=await db.collection('cs_contact_bindings').findOne({_id:binding.bindingId}),usage=(await sub()).usage.apiCalls;
  for(const delta of [{version:original.version+1},{plantId:h.seeded[1].plantId},{customerId:randomUUID()}]){
   await db.collection('cs_contact_bindings').updateOne({_id:binding.bindingId},{$set:delta});try{await assert.rejects(cs.getTicketForCustomer(principal,{ticketNumber:first.ticketNumber}));}finally{await db.collection('cs_contact_bindings').replaceOne({_id:binding.bindingId},original);}
  }
  assert.equal((await sub()).usage.apiCalls,usage);
 });
 await db.collection('cs_contact_bindings').updateOne({_id:binding.bindingId},{$set:{status:'REVOKED'}});await assert.rejects(cs.confirmComplaint(principal,command));assert.ok(BigInt((await sub()).usage.apiCalls)>=3n);
});
