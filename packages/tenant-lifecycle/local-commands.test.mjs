import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startOwned} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {admissionProfile} from './admission.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
const financial={taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'V8 actual source',quantity:'2',uom:'KG',unitPrice:'1.00',currency:'USD'}]};

test('v8 new domain receipts preserve exact results and atomic admission', {timeout:240000},async t=>{
 const h=await startOwned(t),a=h.seeded[0],b=h.seeded[1],filter={tenantId:a.tenantId,plantId:a.plantId},ok=h.ok;
 const account=await ok('/crm/accounts',{name:'V8 parent account'},201);
 const opportunity=await ok('/crm/opportunities',{accountId:account._id,amount:'10.00',currency:'USD'},201);
 let linkedOpportunity=await ok('/crm/opportunities',{accountId:account._id,amount:'20.00',currency:'USD'},201);
 linkedOpportunity=await ok(`/crm/opportunities/${linkedOpportunity._id}/stage`,{expectedVersion:linkedOpportunity.version,stage:'QUALIFIED',reason:'V8 legacy compatibility'});
 const vendor=await ok('/procurement/vendors',{name:'V8 parent vendor'},201);
 const pr=await ok('/procurement/requests',{...financial,vendorId:vendor._id},201);
 const newOrder=async issue=>{let r=await ok('/procurement/requests',{...financial,vendorId:vendor._id},201);r=await ok(`/procurement/requests/${r._id}/approve`,{expectedVersion:r.version});let o=await ok(`/procurement/requests/${r._id}/convert`,{expectedVersion:r.version,idempotencyKey:randomUUID()});return issue?ok(`/procurement/orders/${o._id}/issue`,{expectedVersion:o.version}):o;};
 const order=await newOrder(false),issued=await newOrder(true);
 const quote=async approve=>{let q=await ok('/commercial/quotes',{...financial,accountId:account._id,expiresAt:'2027-01-01T00:00:00.000Z'},201);return approve?ok(`/commercial/quotes/${q._id}/approve`,{expectedVersion:q.version,revision:1}):q;};
 const revisionQuote=await quote(false),approveQuote=await quote(false),acceptQuote=await quote(true);
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}];
 await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});
 await ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'V8 actual local receipt proof',admissionProfile});
 const sub=()=>h.db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});
 const excluding=new Set(['tenants','plants','users','legalEntities','memberships','sessions','credentials','ownedRun','saasSubscriptions','audit','outbox']);
 async function snapshot(){const all={};for(const {name}of await h.db.listCollections({},{nameOnly:true}).toArray())if(!excluding.has(name))all[name]=await h.db.collection(name).find({tenantId:a.tenantId}).sort({_id:1}).limit(5001).toArray();return all;}
 const advanceVersion=(collection)=>async data=>{assert.ok(await h.db.collection('ownedRun').findOne());await h.db.collection(collection).updateOne({_id:data._id,...filter},{$inc:{version:1}});};
 const key=()=>randomUUID();
 const cases=[
  ['crmCommandResults','account.created','/crm/accounts',{name:'V8 keyed account'},201,'accounts',d=>d._id,advanceVersion('accounts')],
  ['crmCommandResults','contact.created',`/crm/accounts/${account._id}/contacts`,{name:'V8 keyed contact',email:'fixture@iems.local'},201,'accounts',()=>account._id,advanceVersion('contacts')],
  ['crmCommandResults','opportunity.created','/crm/opportunities',{accountId:account._id,amount:'12.00',currency:'USD'},201,'accounts',()=>account._id,d=>ok(`/crm/opportunities/${d._id}/stage`,{commandKey:key(),expectedVersion:d.version,stage:'QUALIFIED',reason:'Actual next stage'})],
  ['crmCommandResults','opportunity.stage',`/crm/opportunities/${opportunity._id}/stage`,{expectedVersion:opportunity.version,stage:'QUALIFIED',reason:'V8 keyed stage'},200,'opportunities',()=>opportunity._id,d=>ok(`/crm/opportunities/${d._id}/stage`,{commandKey:key(),expectedVersion:d.version,stage:'QUOTING',reason:'Actual advanced stage'})],
  ['legacyQuoteCommandResults','quote.created','/commercial/quotes',{...financial,accountId:account._id,opportunityId:linkedOpportunity._id,expectedOpportunityVersion:linkedOpportunity.version,expiresAt:'2027-01-01T00:00:00.000Z'},201,'quotes',d=>d._id,d=>ok(`/commercial/quotes/${d._id}/approve`,{commandKey:key(),expectedVersion:d.version,revision:1})],
  ['legacyQuoteCommandResults','quote.revisions',`/commercial/quotes/${revisionQuote._id}/revisions`,{...financial,expectedVersion:revisionQuote.version,expiresAt:'2027-01-01T00:00:00.000Z'},200,'quotes',()=>revisionQuote._id,d=>ok(`/commercial/quotes/${d._id}/approve`,{commandKey:key(),expectedVersion:d.version,revision:2})],
  ['legacyQuoteCommandResults','quote.approve',`/commercial/quotes/${approveQuote._id}/approve`,{expectedVersion:approveQuote.version,revision:1},200,'quotes',()=>approveQuote._id,d=>ok(`/commercial/quotes/${d._id}/accept`,{commandKey:key(),expectedVersion:d.version,revision:1})],
  ['legacyQuoteCommandResults','quote.accept',`/commercial/quotes/${acceptQuote._id}/accept`,{expectedVersion:acceptQuote.version,revision:1},200,'quotes',()=>acceptQuote._id,d=>ok(`/commercial/quotes/${d._id}/convert`,{idempotencyKey:key(),expectedVersion:d.version,revision:1})],
  ['procurementCommandResults','vendor.created','/procurement/vendors',{name:'V8 keyed vendor'},201,'vendors',d=>d._id,advanceVersion('vendors')],
  ['procurementCommandResults','purchaseRequest.created','/procurement/requests',{...financial,vendorId:vendor._id},201,'vendors',()=>vendor._id,d=>ok(`/procurement/requests/${d._id}/approve`,{commandKey:key(),expectedVersion:d.version})],
  ['procurementCommandResults','purchaseRequest.approve',`/procurement/requests/${pr._id}/approve`,{expectedVersion:pr.version},200,'purchaseRequests',()=>pr._id,d=>ok(`/procurement/requests/${d._id}/convert`,{idempotencyKey:key(),expectedVersion:d.version})],
  ['procurementCommandResults','purchaseOrder.issue',`/procurement/orders/${order._id}/issue`,{expectedVersion:order.version},200,'purchaseOrders',()=>order._id,d=>ok(`/procurement/orders/${d._id}/vendor-confirmation`,{commandKey:key(),expectedVersion:d.version,vendorId:vendor._id,reference:'V8 advanced acknowledgement'})],
  ['procurementCommandResults','purchaseOrder.vendor-confirmation',`/procurement/orders/${issued._id}/vendor-confirmation`,{expectedVersion:issued.version,vendorId:vendor._id,reference:'V8 keyed acknowledgement'},200,'purchaseOrders',()=>issued._id,d=>ok(`/procurement/orders/${d._id}/vendor-promise`,{idempotencyKey:key(),expectedVersion:d.version,vendorId:vendor._id,promisedAt:'2026-12-01T00:00:00.000Z',reference:'V8 next promise',reason:'Actual source advance'})],
 ];
 for(const [namespace,action,path,input,status,sourceCollection,sourceId,advance]of cases)await t.test(action,async()=>{
  const body={...input,commandKey:key()},send=(value,headers={})=>h.send(path,{body:value,headers,cookie:h.alpha});
  const before=await snapshot(),usage=(await sub()).usage.apiCalls;
  for(const invalid of [{...input},{...body,commandKey:'bad'},{...body,idempotencyKey:key()}]){const r=await send(invalid);assert.equal(r.status,400,JSON.stringify({action,r}));assert.deepEqual(await snapshot(),before);assert.equal((await sub()).usage.apiCalls,usage);}
  const forged=await send(body,{'x-tenant-id':b.tenantId});assert.equal(forged.status,403,JSON.stringify(forged));
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':'10000'}});
  const quota=await send(body);assert.equal(quota.status,429,JSON.stringify({action,quota}));assert.deepEqual(await snapshot(),before);
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':usage}});
  const meter=()=>h.db.collection('audit').countDocuments({tenantId:a.tenantId,kind:'saas.effect.metered',namespace});const meterBefore=await meter();const outbox=()=>h.db.collection('outbox').countDocuments({tenantId:a.tenantId,type:'saas.effect.metered','data.namespace':namespace});const outboxBefore=await outbox();
  const options=(await h.db.listCollections({name:namespace}).next()).options??{};
  await h.db.command({collMod:namespace,validator:{key:{$ne:body.commandKey}},validationLevel:'strict'});
  try{const r=await send(body);assert.equal(r.status,500,JSON.stringify({action,r}));assert.deepEqual(await snapshot(),before);assert.equal((await sub()).usage.apiCalls,usage);assert.equal(await meter(),meterBefore);assert.equal(await outbox(),outboxBefore);}
  finally{await h.db.command({collMod:namespace,validator:options.validator??{},validationLevel:options.validationLevel??'strict'});}
  const once=await send(body);assert.equal(once.status,status,JSON.stringify({action,once}));assert.equal((await sub()).usage.apiCalls,String(BigInt(usage)+1n));assert.equal(await meter(),meterBefore+1);assert.equal(await outbox(),outboxBefore+1);
  const identity={...filter,userId:a.userId,action,key:body.commandKey};assert.equal(await h.db.collection(namespace).countDocuments(identity),1);
  const receipt=await h.db.collection(namespace).findOne(identity);assert.equal(receipt.schemaVersion,1);assert.deepEqual(JSON.parse(JSON.stringify(receipt.result)),once.data);
  const mismatch={...body,...(body.expectedVersion!==undefined?{expectedVersion:body.expectedVersion+1}:body.name?{name:body.name+' changed'}:body.amount?{amount:'13.00'}:body.expiresAt?{expiresAt:'2027-02-01T00:00:00.000Z'}:{lines:body.lines.map(line=>({...line,description:'Changed valid line'}))})};
  const conflict=await send(mismatch);assert.equal(conflict.status,409,JSON.stringify({action,conflict}));assert.equal(conflict.error.code,'IDEMPOTENCY_CONFLICT');
  await advance(once.data);const replayUsage=(await sub()).usage.apiCalls,replayMeter=await meter(),replayOutbox=await outbox();
  const replay=await send(body);assert.equal(replay.status,status,JSON.stringify({action,replay}));assert.deepEqual(replay.data,once.data,'exact original result after real/synthetic resource advancement');assert.equal((await sub()).usage.apiCalls,replayUsage);assert.equal(await meter(),replayMeter);assert.equal(await outbox(),replayOutbox);
  const after=await snapshot();await h.db.collection('users').updateOne({_id:a.userId},{$set:{active:false}});
  try{const r=await send(body);assert.ok([401,403].includes(r.status),JSON.stringify({action,r}));assert.deepEqual(await snapshot(),after);}
  finally{await h.db.collection('users').updateOne({_id:a.userId},{$set:{active:true}});}
  await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:roles.filter(r=>r.role!=='owner')}});
  try{const r=await send(body);assert.equal(r.status,403,JSON.stringify({action,r}));assert.deepEqual(await snapshot(),after);}
  finally{await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles}});}
  const source=await h.db.collection(sourceCollection).findOne({_id:sourceId(once.data),...filter});assert.ok(source);
  await h.db.collection(sourceCollection).deleteOne({_id:source._id,...filter});
  try{const r=await send(body);assert.ok([403,404].includes(r.status),JSON.stringify({action,r}));assert.equal((await sub()).usage.apiCalls,replayUsage);}
  finally{await h.db.collection(sourceCollection).insertOne(source);}
 });
 await t.test('registered tenant export includes all three new authoritative receipt collections',async()=>{
  const exported=await ok('/saas/export',{key:key(),expectedRevision:(await sub()).revision,reason:'Owned new receipt export'});
  const download=await ok('/saas/download',{archiveId:exported.data.archiveId});assert.equal(download.snapshot.coverage,'COMPLETE');
  for(const collection of ['crmCommandResults','legacyQuoteCommandResults','procurementCommandResults'])assert.ok(download.snapshot.resources.some(row=>row.collection===collection),collection);
 });
 await t.test('duplicate same-key requests reconcile to one receipt/effect',async()=>{
  const body={name:'V8 duplicate proof',commandKey:key()},before=(await sub()).usage.apiCalls;
  const results=await Promise.all([h.req('/crm/accounts',body,h.alpha),h.req('/crm/accounts',body,h.alpha)]);
  assert.deepEqual(results.map(r=>r.status),[201,201],JSON.stringify(results));assert.deepEqual(results[0].data,results[1].data);assert.equal((await sub()).usage.apiCalls,String(BigInt(before)+1n));
 });
 await t.test('unkeyed legacy caller cannot cross concurrent enrollment',async()=>{
  const betaRoles=[{role:'owner',plantIds:[b.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[b.plantId],tenantWide:false}];
  await h.db.collection('memberships').updateOne({_id:b.membershipId},{$set:{tenantWide:true,roles:betaRoles}});
  const legacy=await h.req('/crm/accounts',{name:'V8 unkeyed compatible'},h.beta);assert.equal(legacy.status,201);
  const scope=await h.scopeOf(h.beta),session=h.client.startSession();session.startTransaction();
  try{await h.db.collection('tenants').findOne({_id:b.tenantId},{session});const enroll=await h.req('/saas/subscribe',{key:key(),expectedRevision:0,plan:'pilot',reason:'V8 enrollment fence',admissionProfile},h.beta);assert.equal(enroll.status,200);await assert.rejects(h.runtime.localCommands.run({scope,session,namespace:'crmCommandResults',action:'account.created',body:{name:'Stale unkeyed'}},()=>assert.fail('stale effect')),e=>e.hasErrorLabel?.('TransientTransactionError'));}
  finally{if(session.inTransaction())await session.abortTransaction();await session.endSession();}
 });
});
