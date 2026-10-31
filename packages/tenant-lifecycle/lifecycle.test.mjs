import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTenantLifecycle, addUsage } from './index.mjs';
import { contentHash } from '../tenant-foundation/commands.mjs';

function fixture() {
  const tenantId=randomUUID(),plantId=randomUUID(),userId=randomUUID(),membershipId=randomUUID();
  const grant={tenantId,plantId,userId,membershipId,membershipVersion:1,legalEntityId:randomUUID()};
  let state={},before; let denied=false, wide=true, failOutbox=false, sourceRevision='1', removed=false;
  const match=(r,f)=>Object.entries(f).every(([k,v])=>v && typeof v==='object' && '$in' in v ? v.$in.includes(r[k]) : r[k]===v);
  const db={collection(name){return {
    async createIndex(){}, async findOne(filter){return structuredClone((state[name]??[]).find(r=>match(r,filter))??null);},
    find(filter){let limit=Infinity;return {limit(n){limit=n;return this;},async toArray(){return structuredClone((state[name]??[]).filter(r=>match(r,filter)).slice(0,limit));}};},
    async insertOne(row){if(name==='outbox'&&failOutbox)throw new Error('outbox unavailable');(state[name]??=[]).push(structuredClone(row));},
    async insertMany(rows){for(const r of rows)await this.insertOne(r);},
    async replaceOne(filter,row){const i=(state[name]??[]).findIndex(r=>match(r,filter));if(i<0)return {matchedCount:0};state[name][i]=structuredClone(row);return {matchedCount:1};},
    async updateOne(filter,update){const row=(state[name]??[]).find(r=>match(r,filter));if(!row)return {matchedCount:0};Object.assign(row,structuredClone(update.$set??{}));for(const [k,v]of Object.entries(update.$inc??{}))row[k]=(row[k]??0)+v;return {matchedCount:1};},
  };}};
  state.memberships=[{_id:membershipId,tenantId,active:true,version:1,tenantWide:true,roles:[{role:'saasOperator',tenantWide:true}]}];
  const foundation={async authorize(scope,target){
    if(denied||scope.tenantId!==tenantId||target.plantId!==plantId)throw Object.assign(new Error('denied'),{status:403});
    state.memberships[0].tenantWide=wide;return grant;
  },async authorizeInTransaction(scope,target,{session}){
    assert.ok(session.inTransaction());return this.authorize(scope,target);
  }};
  const client={startSession(){return {startTransaction(){before=structuredClone(state);},inTransaction:()=>true,
    async commitTransaction(){},async abortTransaction(){state=before;},async endSession(){}};}};
  const snapshot=()=>({schema:'TENANT_EXPORT_V1',tenantId,coverage:'COMPLETE',sourceRevision,resources:[{id:randomUUID(),tenantId}]});
  const original=snapshot();
  const domainPort={async snapshot(){return {...original,sourceRevision};},async remove({snapshot}){removed=true;return {state:'REMOVED',sourceRevision:snapshot.sourceRevision};},
    async restore({snapshot}){removed=false;return {state:'RESTORED',digest:contentHash(snapshot)};}};
  const runtime={client,db,foundation,domainPort,clock:()=>new Date('2026-10-31T00:00:00.000Z')};
  const api=createTenantLifecycle(runtime),scope={tenantId};let key=0;
  const input=(revision,extra={})=>({plantId,key:`cmd-${++key}`,expectedRevision:revision,reason:'Synthetic operator exercise',...extra});
  return {api,scope,input,grant,runtime,state:()=>state,deny:()=>{denied=true;},narrow:()=>{wide=false;},fail:()=>{failOutbox=true;},change:()=>{sourceRevision='2';},removed:()=>removed};
}
test('exact usage and quota enforce separate tenant budgets',()=>{
  assert.deepEqual(addUsage({apiCalls:'9007199254740993'},'apiCalls','1',{apiCalls:'9007199254740994'}),{apiCalls:'9007199254740994'});
  assert.throws(()=>addUsage({apiCalls:'9'},'apiCalls','2',{apiCalls:'10'}),{code:'SAAS_QUOTA_EXCEEDED'});
  assert.throws(()=>addUsage({apiCalls:'0'},'apiCalls',1,{apiCalls:'10'}),{code:'INVALID_METER'});
  assert.throws(()=>addUsage({apiCalls:'0'},['apiCalls'],'1',{apiCalls:'10'}),{code:'INVALID_METER'});
});
test('subscription, meter, stale revision, replay and revoked replay',async()=>{
  const f=fixture();const sub=f.input(0,{plan:'pilot'});await f.api.subscribe(f.scope,sub);
  assert.equal((await f.api.subscribe(f.scope,sub)).replayed,true);
  await f.api.meter(f.scope,f.input(1,{metric:'apiCalls',amount:'2'}));
  await assert.rejects(f.api.meter(f.scope,f.input(1,{metric:'apiCalls',amount:'3'})),{code:'REVISION_CONFLICT'});
  const before=structuredClone(f.state());
  assert.equal((await f.api.status(f.scope,{plantId:f.grant.plantId})).subscription.usage.apiCalls,'2');
  assert.deepEqual(f.state(),before,'status is read-only');
  f.deny();await assert.rejects(f.api.subscribe(f.scope,sub),{status:403});
});
test('tenant-wide authority is required even on idempotent replay',async()=>{
  const f=fixture(),sub=f.input(0,{plan:'pilot'});await f.api.subscribe(f.scope,sub);f.narrow();
  await assert.rejects(f.api.subscribe(f.scope,sub),{code:'TENANT_WIDE_SAAS_GRANT_REQUIRED'});
});
test('outbox failure rolls back subscription and result',async()=>{
  const f=fixture();f.fail();await assert.rejects(f.api.subscribe(f.scope,f.input(0,{plan:'pilot'})),/outbox/);
  assert.equal(f.state().saasSubscriptions?.length??0,0);assert.equal(f.state().foundationCommandResults?.length??0,0);
});
test('export, suspend, reversible delete and restore preserve digest and admission gate',async()=>{
  const f=fixture();await f.api.subscribe(f.scope,f.input(0,{plan:'pilot'}));
  const e=(await f.api.export(f.scope,f.input(1))).data;
  await f.api.suspend(f.scope,f.input(2));
  await assert.rejects(f.api.meter(f.scope,f.input(3,{metric:'apiCalls',amount:'1'})),{code:'SAAS_INVALID_STATE'});
  const proof={archiveId:e.archiveId,digest:e.digest};
  await f.api.delete(f.scope,f.input(3,proof));assert.equal(f.removed(),true);
  await assert.rejects(f.api.download(f.scope,{plantId:f.grant.plantId,archiveId:e.archiveId}),{code:'ARCHIVE_UNAVAILABLE'});
  await f.api.restore(f.scope,f.input(4,proof));assert.equal(f.removed(),false);
  assert.equal((await f.api.status(f.scope,{plantId:f.grant.plantId})).subscription.state,'SUSPENDED');
});
test('source changes and absent domain adapter fail closed',async()=>{
  const f=fixture();await f.api.subscribe(f.scope,f.input(0,{plan:'pilot'}));const e=(await f.api.export(f.scope,f.input(1))).data;
  await f.api.suspend(f.scope,f.input(2));f.change();
  await assert.rejects(f.api.delete(f.scope,f.input(3,{archiveId:e.archiveId,digest:e.digest})),{code:'EXPORT_STALE'});
  assert.equal(f.removed(),false);
  const api=createTenantLifecycle({...f.runtime,domainPort:null});await assert.rejects(api.export(f.scope,f.input(3)),{code:'TENANT_DATA_PORT_UNAVAILABLE'});
});

test('unmanaged engine, vendor and uncertain delivery history still blocks export atomically',async()=>{
  for(const [collection,state] of [['automation_engine_runs','ENGINE_ACKNOWLEDGED'],['aiVendorDeliveryAttempts','UNKNOWN'],['cs_outbox','SENDING'],['cs_outbox','UNKNOWN']]){
    const f=fixture();await f.api.subscribe(f.scope,f.input(0,{plan:'pilot'}));
    f.state()[collection]=[{_id:randomUUID(),tenantId:f.grant.tenantId,state}];
    const before=structuredClone(f.state());
    await assert.rejects(f.api.export(f.scope,f.input(1)),{code:'SAAS_ENROLLMENT_EXTERNAL_EFFECT_PENDING'});
    assert.deepEqual(f.state(),before);
  }
});
test('cross tenant scope is rejected and counters do not leak',async()=>{
  const f=fixture();await assert.rejects(f.api.subscribe({tenantId:randomUUID()},f.input(0,{plan:'pilot'})),{status:403});
  assert.equal(f.state().saasSubscriptions?.length??0,0);
});
test('transactional admission consumes quota and suspension denies further use',async()=>{
  const f=fixture();await f.api.subscribe(f.scope,f.input(0,{plan:'pilot'}));
  await assert.rejects(f.api.assertEntitled(f.scope,{plantId:f.grant.plantId,metric:'apiCalls'}),{code:'TRANSACTION_REQUIRED'});
  const session={inTransaction:()=>true};
  await f.api.assertEntitled(f.scope,{plantId:f.grant.plantId,session,metric:'apiCalls',amount:'10000'});
  assert.equal(f.state().saasSubscriptions[0].usage.apiCalls,'10000');
  await assert.rejects(f.api.assertEntitled(f.scope,{plantId:f.grant.plantId,session,metric:'apiCalls'}),{code:'SAAS_QUOTA_EXCEEDED'});
  await f.api.suspend(f.scope,f.input(2));
  await assert.rejects(f.api.assertEntitled(f.scope,{plantId:f.grant.plantId,session,metric:'exports'}),{code:'SAAS_INVALID_STATE'});
  const other=fixture();await other.api.subscribe(other.scope,other.input(0,{plan:'pilot'}));
  assert.equal((await other.api.status(other.scope,{plantId:other.grant.plantId})).subscription.usage.apiCalls,'0');
});
