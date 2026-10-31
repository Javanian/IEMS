import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {startOwned} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {admissionProfile} from './admission.mjs';
import {contentHash} from '../tenant-foundation/commands.mjs';
import {createSnapshot,renderPdf,createIssuer} from '../document-rendering/src/index.mjs';
const require=createRequire(new URL('../../apps/portfolio-api/package.json',import.meta.url));
const {MongoClient}=require('mongodb');
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
const financial={taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'Atomic document actual source',quantity:'2',uom:'KG',unitPrice:'1.00',currency:'USD'}]};
test('v8 renderer and READY publication share caller transaction', {timeout:240000},async t=>{
 const h=await startOwned(t),a=h.seeded[0],b=h.seeded[1],db=h.db,issuer=h.runtime.documents;
 const account=await h.ok('/crm/accounts',{name:'Atomic document customer'},201);
 const newQuote=async()=>{let q=await h.ok('/commercial/quotes',{...financial,accountId:account._id,expiresAt:'2027-01-01T00:00:00.000Z'},201);return h.ok(`/commercial/quotes/${q._id}/approve`,{expectedVersion:q.version,revision:1});};
 const quote=await newQuote(),otherQuote=await newQuote(),changedQuote=await newQuote();
 const body={kind:'quote',sourceId:quote._id,sourceVersion:1};
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}];
 await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});
 const sub=()=>db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});
 const enroll=async()=>h.req('/saas/subscribe',{key:randomUUID(),expectedRevision:(await sub())?.revision??0,plan:'pilot',reason:'Owned document v8',admissionProfile},h.alpha);
 const alphaScope=await h.scopeOf(h.alpha),scope={tenantId:a.tenantId,plantId:a.plantId,legalEntityId:(await db.collection('plants').findOne({_id:a.plantId})).legalEntityId};
 const snapshot=createSnapshot('quote',scope,{...scope,_id:quote._id,version:1,snapshot:quote.approvals[0].snapshot});
 const counts=async()=>Object.fromEntries(await Promise.all(['documentIssues','documentArtifacts','documentIntents','documentAudit','documentOutbox'].map(async n=>[n,await db.collection(n).countDocuments({tenantId:a.tenantId})])));
 let prepared;
 await t.test('prepare is pure, PDF unchanged, active same-client session required',async()=>{
  const before=await counts();prepared=await issuer.prepare(scope,snapshot);assert.deepEqual(await counts(),before);assert.deepEqual(prepared.pdf,await renderPdf(snapshot));
  await assert.rejects(issuer.issueInTransaction({scope,snapshot,prepared}),/CALLER_SESSION_REQUIRED/);
  const foreign=await new MongoClient(h.client.s.url).connect(),foreignSession=foreign.startSession();foreignSession.startTransaction();
  try{await assert.rejects(issuer.issueInTransaction({scope,snapshot,prepared,session:foreignSession}),/CALLER_SESSION_REQUIRED/);}finally{await foreignSession.abortTransaction();await foreignSession.endSession();await foreign.close();}
  const session=h.client.startSession();session.startTransaction();
  try{await assert.rejects(issuer.issueInTransaction({scope,snapshot,prepared:{...prepared},session}),/PREPARED_ISSUE_INTEGRITY/);const bad=await issuer.prepare(scope,snapshot);bad.pdf[0]^=1;await assert.rejects(issuer.issueInTransaction({scope,snapshot,prepared:bad,session}),/PREPARED_ISSUE_INTEGRITY/);}
  finally{await session.abortTransaction();await session.endSession();}assert.deepEqual(await counts(),before);
 });
 assert.equal((await enroll()).status,200);
 await t.test('structured identity rejects extra or wrong dimensions',async()=>{
  const session=h.client.startSession();session.startTransaction();
  try{const identity={...scope,kind:'quote',sourceId:quote._id,sourceVersion:1};for(const bad of [{...identity,userId:a.userId},{...identity,legalEntityId:randomUUID()}])await assert.rejects(h.runtime.saasAdmission.effect({scope:alphaScope,session,namespace:'documentIssues',identity:bad,action:'document.issue',payloadHash:snapshot.contentHash,replayed:false}),{code:'SAAS_ADMISSION_IDENTITY_REQUIRED'});}
  finally{await session.abortTransaction();await session.endSession();}
 });
 await t.test('quota and every artifact/receipt/publication/meter audit failure roll back whole effect',async()=>{
  const original=await sub();await db.collection('saasSubscriptions').updateOne({_id:original._id},{$set:{'usage.apiCalls':'10000'}});
  let r=await h.req('/documents/issues',body,h.alpha);assert.equal(r.status,429,JSON.stringify(r));assert.deepEqual(await counts(),{documentIssues:0,documentArtifacts:0,documentIntents:0,documentAudit:0,documentOutbox:0});await db.collection('saasSubscriptions').replaceOne({_id:original._id},original);
  for(const collection of ['documentArtifacts','documentIssues','documentIntents','documentAudit','documentOutbox','audit','outbox','saasSubscriptions']){
   const before=await counts(),beforeSub=await sub(),source=await db.collection('quotes').findOne({_id:quote._id});
   const beforeMeter=await db.collection('audit').countDocuments({tenantId:a.tenantId,kind:'saas.effect.metered'}),beforeEvents=await db.collection('outbox').countDocuments({tenantId:a.tenantId,type:'saas.effect.metered'});
   if(!await db.listCollections({name:collection}).hasNext())await db.createCollection(collection);
   await db.command({collMod:collection,validator:{$expr:{$eq:[1,2]}},validationLevel:'strict',validationAction:'error'});
   try{r=await h.req('/documents/issues',body,h.alpha);assert.equal(r.status,500,JSON.stringify({collection,r}));}
   finally{await db.command({collMod:collection,validator:{},validationLevel:'strict',validationAction:'error'});}
   assert.deepEqual(await counts(),before,collection);assert.deepEqual((await sub()).usage,beforeSub.usage,collection);assert.equal((await db.collection('quotes').findOne({_id:quote._id})).documentFence,source.documentFence,collection);assert.equal(await db.collection('audit').countDocuments({tenantId:a.tenantId,kind:'saas.effect.metered'}),beforeMeter);assert.equal(await db.collection('outbox').countDocuments({tenantId:a.tenantId,type:'saas.effect.metered'}),beforeEvents);
  }
 });
 await t.test('source change after render prevents all publication effects',async()=>{
  const original=await db.collection('quotes').findOne({_id:changedQuote._id}),prepare=issuer.prepare;
  issuer.prepare=async(...args)=>{const result=await prepare(...args);await db.collection('quotes').updateOne({_id:changedQuote._id},{$set:{'approvals.0.snapshot.lines.0.description':'Changed actual approved source'}});return result;};
  try{const r=await h.req('/documents/issues',{...body,sourceId:changedQuote._id},h.alpha);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.error.code,'ISSUE_CONFLICT');assert.equal(await db.collection('documentIssues').countDocuments({sourceId:changedQuote._id}),0);}
  finally{issuer.prepare=prepare;await db.collection('quotes').replaceOne({_id:changedQuote._id},original);}
 });
 let once;
 await t.test('once/replay cross-actor receipt, direct READY, exact public ID/PDF and one charge',async()=>{
  once=await h.ok('/documents/issues',body);assert.equal((await sub()).usage.apiCalls,'1');const intent=await db.collection('documentIntents').findOne({_id:once._id});assert.equal(intent.state,'READY');assert.notEqual(intent.rendererId,intent._id);assert.equal(await db.collection('documentIntents').countDocuments({state:'PREPARED'}),0);
  const replay=await h.ok('/documents/issues',body);assert.deepEqual(replay,once);assert.equal((await sub()).usage.apiCalls,'1');
  const actor={_id:h.seeded.find(row=>row.username==='alpha.inspector').userId},membership=await db.collection('memberships').findOne({userId:actor._id,tenantId:a.tenantId});assert.ok(membership);
  await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:roles.filter(r=>r.role!=='saasOperator')}});const cookie=await h.login('alpha.inspector');assert.deepEqual(await h.ok('/documents/issues',body,200,cookie),once);assert.equal((await sub()).usage.apiCalls,'1');
  await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[{role:'documentIssuer',plantIds:[a.plantId],tenantWide:false},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}]}});const denied=await h.req('/documents/issues',body,cookie);assert.equal(denied.status,403,JSON.stringify(denied));
  const pdf=await h.raw(`/documents/issues/${once._id}/pdf`);assert.equal(pdf.status,200);assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),prepared.pdf);
  const meter=await db.collection('audit').findOne({namespace:'documentIssues',kind:'saas.effect.metered'});assert.equal(meter.commandHash,contentHash({namespace:'documentIssues',filter:{...scope,kind:'quote',sourceId:quote._id,sourceVersion:1}}));assert.equal(meter.payloadHash,snapshot.contentHash);
  assert.deepEqual(await counts(),{documentIssues:1,documentArtifacts:1,documentIntents:1,documentAudit:1,documentOutbox:1});
 });
 await t.test('revocation, suspension, missing/corrupt artifact and PREPARED history fail closed',async()=>{
  const user=await db.collection('users').findOne({_id:a.userId});await db.collection('users').updateOne({_id:a.userId},{$set:{active:false}});try{assert.ok([401,403].includes((await h.req('/documents/issues',body,h.alpha)).status));}finally{await db.collection('users').replaceOne({_id:a.userId},user);}
  const subscription=await sub();await db.collection('saasSubscriptions').updateOne({_id:subscription._id},{$set:{state:'SUSPENDED'}});try{assert.equal((await h.req('/documents/issues',body,h.alpha)).status,403);}finally{await db.collection('saasSubscriptions').replaceOne({_id:subscription._id},subscription);}
  const artifact=await db.collection('documentArtifacts').findOne({tenantId:a.tenantId});await db.collection('documentArtifacts').deleteOne({_id:artifact._id});try{assert.equal((await h.req('/documents/issues',body,h.alpha)).status,500);assert.equal((await enroll()).status,409);}finally{await db.collection('documentArtifacts').insertOne(artifact);}
  await db.collection('documentArtifacts').updateOne({_id:artifact._id},{$set:{pdf:Buffer.from('corrupt')}});try{assert.equal((await h.req('/documents/issues',body,h.alpha)).status,500);}finally{await db.collection('documentArtifacts').replaceOne({_id:artifact._id},artifact);}
  assert.equal((await enroll()).status,200,'healthy READY history enrolls');
  const legacy={_id:randomUUID(),...scope,kind:'quote',sourceId:otherQuote._id,sourceVersion:1,state:'PREPARED',snapshot};await db.collection('documentIntents').insertOne(legacy);
  try{const r=await enroll();assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.error.code,'DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');assert.equal((await h.req('/documents/issues',{...body,sourceId:otherQuote._id},h.alpha)).status,409);assert.equal((await db.collection('documentIntents').findOne({_id:legacy._id})).state,'PREPARED');}finally{await db.collection('documentIntents').deleteOne({_id:legacy._id});}
  assert.equal((await sub()).usage.apiCalls,'1');
 });
 await t.test('standalone compatible issue/read remains isolated; enrolled standalone cannot bypass admission',async()=>{
  const betaScope={tenantId:b.tenantId,plantId:b.plantId,legalEntityId:(await db.collection('plants').findOne({_id:b.plantId})).legalEntityId};
  const content=createSnapshot('quote',betaScope,{...betaScope,_id:randomUUID(),version:1,snapshot:quote.approvals[0].snapshot});const standalone=await createIssuer({client:h.client,db});const first=await standalone.issue(betaScope,content);assert.deepEqual(await standalone.issue(betaScope,content),first);assert.deepEqual((await standalone.read(betaScope,first._id)).pdf,await renderPdf(content));
  await assert.rejects(standalone.issue(scope,snapshot),/DOCUMENT_ADMISSION_REQUIRED/);
  const betaSession=h.client.startSession();betaSession.startTransaction();try{await assert.rejects(issuer.validateTenantHistory({tenantId:b.tenantId,session:betaSession}),/DOCUMENT_HISTORY_RECONCILIATION_REQUIRED/);}finally{await betaSession.abortTransaction();await betaSession.endSession();}
 });
});
