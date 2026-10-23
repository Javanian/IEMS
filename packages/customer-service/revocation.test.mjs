import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTenantFoundation} from '../tenant-foundation/index.mjs';
import {createCustomerService} from './index.mjs';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
let repl,client,db;
before(async()=>{
  repl=await MongoMemoryReplSet.create({binary:{systemBinary: process.env.MONGOMS_SYSTEM_BINARY,version:'7.0.14'},replSet:{count:1,storageEngine:'wiredTiger'}});
  client=await MongoClient.connect(repl.getUri());db=client.db(`cs_revocation_owned_${randomUUID().replaceAll('-','')}`);
});
after(async()=>{if(db)await db.dropDatabase();if(client)await client.close();if(repl)await repl.stop();});
async function fixture(wrap=x=>x, faultInjector=async()=>{}) {
  const [tenantId,userId,entityId,plantId,membershipId,customerId,bindingId]=Array.from({length:7},()=>randomUUID());
  const actions=['cs.fixture.admin','cs.reply','cs.conversation.handoff','cs.ticket.write','cs.note.internal','cs.delivery.review','cs.ticket.reopen_closed'];
  const foundation=createTenantFoundation({client,db,roleActions:{admin:actions,viewer:[]}});
  await foundation.initialize();await foundation.provisionTenant({id:tenantId});await foundation.provisionUser({id:userId,tenantId});await foundation.provisionLegalEntity({id:entityId,tenantId});await foundation.provisionPlant({id:plantId,tenantId,legalEntityId:entityId});
  await foundation.provisionMembership({id:membershipId,tenantId,userId,legalEntityIds:[entityId],plantIds:[plantId],roles:[{role:'admin',plantIds:[plantId]}]});
  const issued=await foundation.issueSession({tenantId,userId,selectedPlantId:plantId,ttlMs:3600000}),scope=await foundation.authenticate(issued.token);
  const cs=createCustomerService({client,db,foundation:wrap(foundation),faultInjector});await cs.initialize();
  await cs.provisionFixtureCustomer(scope,{plantId,customerId,label:'Owned'});await cs.bindContact(scope,{plantId,customerId,bindingId,channelAccountId:tenantId,providerContactId:'owned'});
  const principal=await cs.resolveCustomerPrincipal({tenantId,channelAccountId:tenantId,providerContactId:'owned'});
  await cs.requestHandoff(principal,{inboundKey:randomUUID()});const conv=await db.collection('cs_conversations').findOne({bindingId});
  await cs.takeOverConversation(scope,{plantId,conversationId:conv._id,expectedVersion:conv.version,commandKey:randomUUID()});
  return {foundation,cs,scope,principal,tenantId,userId,plantId,membershipId,bindingId,customerId,sessionId:issued.sessionId,conversationId:conv._id};
}
for(const kind of ['grant','membership','session'])for(const timing of ['before transaction','after snapshot'])test(`${kind} revoke ${timing} denies reply and same-key retry without dispatchable reply`,async()=>{
  let armed=false, h;
  const revoke=async()=>{if(kind==='grant')await db.collection('memberships').updateOne({_id:h.membershipId},{$set:{roles:[{role:'viewer',plantIds:[h.plantId]}]}});else if(kind==='session')await h.foundation.revokeSession({tenantId:h.tenantId,sessionId:h.sessionId});else await h.foundation.invalidateMembership({tenantId:h.tenantId,membershipId:h.membershipId,expectedVersion:1,active:false});};
  h=await fixture(f=>({...f,authorize:async(...args)=>{const g=await f.authorize(...args);if(armed&&timing==='before transaction'){armed=false;await revoke();}return g;},authorizeInTransaction:async(...args)=>{if(armed&&timing==='after snapshot'){armed=false;await db.collection('memberships').findOne({_id:h.membershipId},{session:args[2].session});await revoke();}return f.authorizeInTransaction(...args);}}));
  const input={plantId:h.plantId,conversationId:h.conversationId,text:'Must not dispatch',commandKey:randomUUID()};armed=true;
  await assert.rejects(h.cs.operatorReply(h.scope,input),{code:'SCOPE_DENIED'});await assert.rejects(h.cs.operatorReply(h.scope,input),{code:'SCOPE_DENIED'});
  assert.equal(await db.collection('cs_outbox').countDocuments({tenantId:h.tenantId,kind:'OPERATOR_REPLY'}),0);
  const claim=await h.cs.claimNextDelivery({tenantId:h.tenantId,channelAccountId:h.tenantId,leaseOwner:'owned'});
  assert.notEqual(claim?.kind,'OPERATOR_REPLY');
});
test('every operator mutator fences permission before effects, including idempotent paths',async()=>{
 let h,armed=false;h=await fixture(f=>({...f,authorize:async(...args)=>{const grant=await f.authorize(...args);if(armed){armed=false;await db.collection('memberships').updateOne({_id:h.membershipId},{$set:{roles:[]}});}return grant;}}));
 const roles=[{role:'admin',plantIds:[h.plantId]}],id=randomUUID();
 const cases=[
 ['provisionFixtureCustomer',{customerId:id,label:'Blocked'}],
 ['bindContact',{bindingId:id,customerId:h.customerId,channelAccountId:'owned-new',providerContactId:'owned'}],
 ['revokeBinding',{bindingId:h.bindingId,expectedVersion:1}],
 ['registerSyntheticOrderSnapshot',{customerId:h.customerId,orderNumber:'SO-BLOCK',publicStage:'ACCEPTED'}],
 ['transitionTicket',{ticketId:id,expectedVersion:1,toStage:'TRIAGED',reason:'Blocked',commandKey:randomUUID()}],
 ['addPublicUpdate',{ticketId:id,expectedVersion:1,text:'Blocked',commandKey:randomUUID()}],
 ['addInternalNote',{ticketId:id,text:'Blocked',commandKey:randomUUID()}],
 ['takeOverConversation',{conversationId:h.conversationId,expectedVersion:1,commandKey:randomUUID()}],
 ['setConversationMode',{conversationId:h.conversationId,expectedVersion:1,toMode:'PAUSED',reason:'Blocked',commandKey:randomUUID()}],
 ['operatorReply',{conversationId:h.conversationId,text:'Blocked',commandKey:randomUUID()}],
 ['resolveUnknownDelivery',{deliveryId:id,resolution:'ABANDON',evidence:'Blocked',commandKey:randomUUID()}]
 ];
 for(const [method,input]of cases){await db.collection('memberships').updateOne({_id:h.membershipId},{$set:{roles}});armed=true;await assert.rejects(h.cs[method](h.scope,{plantId:h.plantId,...input}),{code:'SCOPE_DENIED'},method);}
 assert.equal(await db.collection('cs_customers').countDocuments({_id:id}),0);
 assert.equal(await db.collection('cs_idempotency').countDocuments({tenantId:h.tenantId,scope:{$in:['ticket.transition','ticket.public_update','ticket.internal_note','delivery.review','conversation.mode']}}),0);
});
test('successful same-key reply is denied on replay after revoke',async()=>{
 const h=await fixture(),input={plantId:h.plantId,conversationId:h.conversationId,text:'Once',commandKey:randomUUID()};
 const first=await h.cs.operatorReply(h.scope,input);assert.deepEqual(await h.cs.operatorReply(h.scope,input),first);
 await h.foundation.revokeSession({tenantId:h.tenantId,sessionId:h.sessionId});await assert.rejects(h.cs.operatorReply(h.scope,input),{code:'SCOPE_DENIED'});
 assert.equal(await db.collection('cs_outbox').countDocuments({tenantId:h.tenantId,kind:'OPERATOR_REPLY'}),1);
});
test('binding revoke after snapshot aborts customer command including replay',async()=>{
 let h,armed=false;h=await fixture(x=>x,async point=>{if(armed&&point==='bindingSnapshot'){armed=false;const revoker=createCustomerService({client,db,foundation:h.foundation});await revoker.revokeBinding(h.scope,{plantId:h.plantId,bindingId:h.bindingId,expectedVersion:1});}});
 const input={inboundKey:randomUUID(),text:'MENU',command:{op:'MENU'}};armed=true;
 await assert.rejects(h.cs.handleInboundCommand(h.principal,input),{code:'DENIED'});
 await assert.rejects(h.cs.handleInboundCommand(h.principal,input),{code:'DENIED'});
 assert.equal(await db.collection('cs_inbound').countDocuments({tenantId:h.tenantId}),0);
 assert.equal(await db.collection('cs_outbox').countDocuments({tenantId:h.tenantId,state:'QUEUED'}),0);
});
test('authoritative reader rechecks binding after await and retains customer scope',async()=>{
 const h=await fixture();let received;
 const cs=createCustomerService({client,db,foundation:h.foundation,orderReader:{readCustomerOrder:async input=>{received=input;await h.cs.revokeBinding(h.scope,{plantId:h.plantId,bindingId:h.bindingId,expectedVersion:1});return {source:'PORTFOLIO_API_OWNED',orderNumber:input.orderNumber,publicStage:'ACCEPTED',sourceVersion:1,sourceId:randomUUID(),asOf:new Date(),progress:null};}}});
 const p=await cs.resolveCustomerPrincipal({tenantId:h.tenantId,channelAccountId:h.tenantId,providerContactId:'owned'});
 await assert.rejects(cs.getOrderStatusForCustomer(p,{orderNumber:'SO-OWNED'}),{code:'DENIED'});
 assert.deepEqual(received,{tenantId:h.tenantId,plantId:h.plantId,customerId:h.customerId,orderNumber:'SO-OWNED'});
 await assert.rejects(cs.getOrderStatusForCustomer({...p},{orderNumber:'SO-OWNED'}),{code:'DENIED'});
});
