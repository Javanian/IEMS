import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{startOwned}from'../../apps/portfolio-api/test/support/owned-mongo.mjs';import{admissionProfile}from'./admission.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('v12 public job ingress shares rate, receipt, quota and enqueue transaction',{timeout:120000},async t=>{
 const h=await startOwned(t,{integrations:{platform:{handlers:{'test.local':async()=>{}}}}}),a=h.seeded[0],db=h.db;
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}];await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});
 await h.ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'Owned v12 ingress',admissionProfile});
 const subscription=()=>db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});const request={kind:'test.local',key:randomUUID(),input:{value:'owned'}};
 const first=await h.req('/platform/jobs',request,h.alpha);assert.equal(first.status,201,JSON.stringify(first));assert.equal((await subscription()).usage.apiCalls,'1');let bucket=await db.collection('platformRateLimits').findOne({tenantId:a.tenantId});assert.equal(bucket.used,1);
 assert.equal((await h.req('/platform/jobs',request,h.alpha)).status,200);assert.equal((await db.collection('platformRateLimits').findOne({_id:bucket._id})).used,1);assert.equal((await subscription()).usage.apiCalls,'1');
 assert.equal((await h.req('/platform/jobs',{...request,input:{value:'changed'}},h.alpha)).status,409);assert.equal((await subscription()).usage.apiCalls,'1');
 await db.collection('platformRateLimits').updateOne({_id:bucket._id},{$set:{used:20}});const before=await subscription();assert.equal((await h.req('/platform/jobs',{...request,key:randomUUID()},h.alpha)).status,429);assert.deepEqual((await subscription()).usage,before.usage);assert.equal(await db.collection('jobs').countDocuments({tenantId:a.tenantId}),1);
 assert.equal((await h.req('/platform/jobs',request,h.alpha)).status,200,'rate exhausted replay is free');await db.collection('platformRateLimits').updateOne({_id:bucket._id},{$set:{used:1}});
 for(const name of ['jobs','platformRateLimits','foundationCommandResults','audit','outbox']){
  const usage=(await subscription()).usage;await db.command({collMod:name,validator:{$expr:{$eq:[1,2]}},validationLevel:'strict',validationAction:'error'});
  try{assert.equal((await h.req('/platform/jobs',{...request,key:randomUUID()},h.alpha)).status,500,name);}finally{await db.command({collMod:name,validator:{},validationLevel:'strict',validationAction:'error'});}
  assert.deepEqual((await subscription()).usage,usage,name);assert.equal((await db.collection('platformRateLimits').findOne({_id:bucket._id})).used,1,name);assert.equal(await db.collection('jobs').countDocuments({tenantId:a.tenantId}),1,name);
 }
 await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:roles.filter(r=>r.role!=='saasUser')}});try{assert.equal((await h.req('/platform/jobs',request,h.alpha)).status,403);}finally{await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles}});}
 await db.collection('jobs').updateOne({_id:first.data.id},{$set:{active:false}});assert.equal((await h.req('/platform/jobs',request,h.alpha)).status,403);assert.equal((await subscription()).usage.apiCalls,'1');
 await assert.rejects(h.runtime.platform.rateLimiter.consumeInTransaction({},{}),{code:'RATE_TRANSACTION_REQUIRED'});
});
