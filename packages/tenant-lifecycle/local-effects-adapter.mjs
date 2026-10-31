import{randomUUID}from'node:crypto';
import{boundedTransaction,CommandError,contentHash}from'../tenant-foundation/commands.mjs';
import{effectHash,effectTransaction}from'./effect-primitives.mjs';
import{verifiedLocalProviderObservation}from'./local-ai-provider.mjs';
const controlledAdapters=new WeakSet();
export const isControlledLocalAdapter=value=>controlledAdapters.has(value);
const fail=(code,status=409)=>{throw new CommandError(code,status);};
const publicResult=value=>{const out=JSON.parse(JSON.stringify(value));const walk=v=>{if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(/^(token|tokenHash|password|secret|authorization|body|text|prompt|chunks|messageBody)$/i.test(k))fail('PRIVATE_ADAPTER_RESULT',400);walk(x);}};walk(out);if(JSON.stringify(out).length>2000000)fail('ADAPTER_RESULT_TOO_LARGE');return out;};
export function createControlledLocalAdapter({client,db,id,instanceEpoch=randomUUID(),fault=async()=>{}}){
 if(typeof id!=='string'||!id||typeof instanceEpoch!=='string'||!instanceEpoch)fail('LOCAL_ADAPTER_ID_REQUIRED',500);
 const attempts=db.collection('saasEffectAttempts'),commands=db.collection('saasEffectCommands'),events=db.collection('saasEffectEvents'),barriers=db.collection('saasEffectBarriers'),inFlight=new Map();
 const tx=fn=>effectTransaction(client,fn);
 async function record(commandId,tenantId,session,kind,proof){const command=await commands.findOne({_id:commandId,tenantId},{session});if(!command)fail('LOCAL_ADAPTER_PARENT_REQUIRED');const version=command.version+1,result=await commands.updateOne({_id:commandId,tenantId,version:command.version},{$set:{version,updatedAt:new Date().toISOString()}},{session});if(result.matchedCount!==1)fail('EFFECT_VERSION_CONFLICT');await events.insertOne({_id:randomUUID(),schemaVersion:1,tenantId,commandId,version,kind,proof,occurredAt:new Date().toISOString()},{session});}
 const setProof=rows=>rows.map(x=>({attemptId:x._id,instanceEpoch:x.instanceEpoch,epoch:x.epoch,fence:x.fence,providerKey:x.providerKey,providerState:x.provider?.state??'NOT_PERFORMED',providerProofHash:x.provider?.proofHash??null})).sort((a,b)=>a.attemptId.localeCompare(b.attemptId));
 const adapter={id,instanceEpoch,mode:'LOCAL_SIMULATED',
  async invoke(attempt,work,{authorize}={}){
   if(typeof work!=='function'||attempt.adapterId!==id||attempt.instanceEpoch!==instanceEpoch)fail('LOCAL_ADAPTER_BINDING_REQUIRED');
   const existing=await attempts.findOne({_id:attempt._id,tenantId:attempt.tenantId,adapterId:id,instanceEpoch,providerKey:attempt.providerKey});
   if(existing?.provider?.state==='TERMINAL')return existing.provider.result;
   if(existing?.provider)fail('LOCAL_PROVIDER_OUTCOME_UNKNOWN');
   await tx(async session=>{
    if(authorize)await authorize(session);
    const tenant=await db.collection('tenants').findOneAndUpdate({_id:attempt.tenantId,active:true,saasEffectDispatchOpen:{$ne:false},...(attempt.epoch===0?{$or:[{saasEffectEpoch:0},{saasEffectEpoch:{$exists:false}}]}:{saasEffectEpoch:attempt.epoch})},{$inc:{saasEffectFence:1,saasEffectHighWater:1}},{session,returnDocument:'after'});if(!tenant)fail('LOCAL_ADAPTER_STOPPED');
    const changed=await attempts.updateOne({_id:attempt._id,tenantId:attempt.tenantId,adapterId:id,instanceEpoch,providerKey:attempt.providerKey,inputHash:attempt.inputHash,state:'INVOKING',fence:attempt.fence,provider:{$exists:false}},{$set:{provider:{state:'BEGUN',highWater:tenant.saasEffectHighWater,startedAt:new Date().toISOString(),instanceEpoch,providerKey:attempt.providerKey}}},{session});if(changed.matchedCount!==1)fail('LOCAL_PROVIDER_ALREADY_BEGUN');
    await record(attempt.commandId,attempt.tenantId,session,'PROVIDER_BEGUN',{attemptId:attempt._id,adapterId:id,instanceEpoch,highWater:tenant.saasEffectHighWater,inputHash:attempt.inputHash,fence:attempt.fence});
   });
   const promise=(async()=>{
    try{
     const result=publicResult(await work()),proofHash=effectHash({attemptId:attempt._id,adapterId:id,instanceEpoch,providerKey:attempt.providerKey,inputHash:attempt.inputHash,result});
     await tx(async session=>{const changed=await attempts.updateOne({_id:attempt._id,tenantId:attempt.tenantId,instanceEpoch,'provider.state':'BEGUN',fence:attempt.fence},{$set:{'provider.state':'TERMINAL','provider.result':result,'provider.proofHash':proofHash,'provider.completedAt':new Date().toISOString()}},{session});if(changed.matchedCount!==1){const previous=await attempts.findOne({_id:attempt._id,tenantId:attempt.tenantId,'provider.state':'TERMINAL'},{session});if(previous?.provider.proofHash!==proofHash)fail('LOCAL_PROVIDER_RECEIPT_CONFLICT');return;}await record(attempt.commandId,attempt.tenantId,session,'PROVIDER_TERMINAL',{attemptId:attempt._id,adapterId:id,instanceEpoch,providerProofHash:proofHash});});
     await fault('afterProviderReceipt',attempt);return result;
    }catch(error){await tx(async session=>{const changed=await attempts.updateOne({_id:attempt._id,tenantId:attempt.tenantId,instanceEpoch,'provider.state':'BEGUN'},{$set:{'provider.state':'UNKNOWN','provider.errorCode':typeof error.code==='string'?error.code:'LOCAL_PROVIDER_UNKNOWN'}},{session});if(changed.matchedCount)await record(attempt.commandId,attempt.tenantId,session,'PROVIDER_UNKNOWN',{attemptId:attempt._id,adapterId:id,instanceEpoch});});throw error;}
   })();inFlight.set(attempt._id,{tenantId:attempt.tenantId,promise});try{return await promise;}finally{inFlight.delete(attempt._id);}
  },
  async observe(attempt,{session}={}){
   const row=await attempts.findOne({_id:attempt._id,tenantId:attempt.tenantId,commandId:attempt.commandId,adapterId:id,instanceEpoch:attempt.instanceEpoch,providerKey:attempt.providerKey,inputHash:attempt.inputHash,fence:attempt.fence},{session});if(!row)fail('LOCAL_PROVIDER_BINDING_CHANGED');
   if(row.provider?.state!=='TERMINAL')return {state:row.provider?'UNKNOWN':'NOT_BEGUN'};
   const expected=effectHash({attemptId:row._id,adapterId:id,instanceEpoch:row.instanceEpoch,providerKey:row.providerKey,inputHash:row.inputHash,result:row.provider.result});if(expected!==row.provider.proofHash)fail('LOCAL_PROVIDER_RECEIPT_CORRUPT');
   return {state:'TERMINAL',mode:'LOCAL_SIMULATED',adapterId:id,instanceEpoch:row.instanceEpoch,providerKey:row.providerKey,proofHash:expected,result:row.provider.result};
  },
  async reconcile(attempt,observation,{session}){
   if(!session?.inTransaction()||session.client!==client)fail('EFFECT_TRANSACTION_REQUIRED',500);const proof=verifiedLocalProviderObservation(observation,attempt),command=await commands.findOne({_id:attempt.commandId,tenantId:attempt.tenantId,ownerNamespace:'AI_INDEX_ROOT_V1'},{session});if(!command||command.plan.providerId!==proof.providerId)fail('LOCAL_PROVIDER_OBSERVATION_INVALID');
   const row=await attempts.findOne({_id:attempt._id,tenantId:attempt.tenantId,commandId:attempt.commandId,adapterId:id,instanceEpoch:attempt.instanceEpoch,providerKey:attempt.providerKey,inputHash:attempt.inputHash,fence:attempt.fence},{session});if(!row?.provider)fail('LOCAL_PROVIDER_BINDING_CHANGED');const result=publicResult(proof.result),proofHash=effectHash({attemptId:row._id,adapterId:id,instanceEpoch:row.instanceEpoch,providerKey:row.providerKey,inputHash:row.inputHash,result});if(row.provider.state==='TERMINAL'){if(row.provider.proofHash!==proofHash)fail('LOCAL_PROVIDER_RECEIPT_CONFLICT');return adapter.observe(row,{session});}
   if(!['BEGUN','UNKNOWN'].includes(row.provider.state))fail('LOCAL_PROVIDER_OBSERVATION_INVALID');await attempts.updateOne({_id:row._id,fence:row.fence,'provider.state':row.provider.state},{$set:{'provider.state':'TERMINAL','provider.result':result,'provider.proofHash':proofHash,'provider.nativeReceiptId':proof.receiptId,'provider.nativeProofHash':proof.receiptProofHash,'provider.completedAt':new Date().toISOString()}},{session});await record(row.commandId,row.tenantId,session,'PROVIDER_OBSERVED',{attemptId:row._id,adapterId:id,instanceEpoch:row.instanceEpoch,providerProofHash:proofHash,nativeReceiptId:proof.receiptId,nativeProofHash:proof.receiptProofHash});return adapter.observe(row,{session});
  },
  async stopAndDrain({tenantId,stopEpoch}){
   const tenant=await db.collection('tenants').findOne({_id:tenantId,active:true,saasEffectDispatchOpen:false,saasEffectEpoch:stopEpoch});if(!tenant)fail('LOCAL_STOP_GATE_REQUIRED');
   await Promise.all([...inFlight.values()].filter(x=>x.tenantId===tenantId).map(x=>x.promise.catch(()=>{})));
   return tx(async session=>{
    const fence=await db.collection('tenants').findOneAndUpdate({_id:tenantId,active:true,saasEffectDispatchOpen:false,saasEffectEpoch:stopEpoch},{$inc:{saasEffectFence:1}},{session,returnDocument:'after'});if(!fence)fail('LOCAL_STOP_EPOCH_CHANGED');
    await attempts.updateMany({tenantId,adapterId:id,provider:{$exists:false},state:{$in:['CLAIMED','INVOKING','UNKNOWN']}},{$set:{state:'NOT_PERFORMED',stopEpoch,leaseOwner:null,leaseUntil:null},$inc:{version:1}},{session});
    const rows=await attempts.find({tenantId,adapterId:id},{session}).toArray();for(const row of rows)if(row.provider?.state==='TERMINAL')await adapter.observe(row,{session});
    if(rows.some(x=>x.provider&&!['TERMINAL'].includes(x.provider.state)))return {state:'PENDING',adapterId:id,instanceEpoch,stopEpoch,unsettled:rows.filter(x=>x.provider&&x.provider.state!=='TERMINAL').map(x=>x._id)};
    const proof={schema:'LOCAL_DRAIN_BARRIER_V1',mode:'LOCAL_SIMULATED',tenantId,adapterId:id,instanceEpoch,stopEpoch,highWater:fence.saasEffectHighWater??0,attemptSet:setProof(rows)},proofHash=effectHash(proof),identity={tenantId,adapterId:id,instanceEpoch,stopEpoch};
    await barriers.updateOne(identity,{$setOnInsert:{_id:randomUUID(),schemaVersion:1,...identity},$set:{proof,proofHash,verifiedAt:new Date().toISOString()}},{session,upsert:true});return {state:'QUIESCENT',...identity,proofHash,highWater:proof.highWater};
   });
  },
  async verifyBarrier({tenantId,stopEpoch,session}){
   const tenant=await db.collection('tenants').findOne({_id:tenantId,active:true,saasEffectDispatchOpen:false,saasEffectEpoch:stopEpoch},{session}),row=await barriers.findOne({tenantId,adapterId:id,instanceEpoch,stopEpoch},{session});if(!tenant||!row||row.proofHash!==effectHash(row.proof)||row.proof.highWater!==(tenant.saasEffectHighWater??0))return false;
   const attemptsNow=await attempts.find({tenantId,adapterId:id},{session}).toArray();if(attemptsNow.some(x=>x.provider&&x.provider.state!=='TERMINAL')||attemptsNow.some(x=>!x.provider&&x.state!=='NOT_PERFORMED'))return false;
   for(const attempt of attemptsNow)if(attempt.provider)await adapter.observe(attempt,{session});return effectHash(setProof(attemptsNow))===effectHash(row.proof.attemptSet);
  },
 };
 const frozen=Object.freeze(adapter);controlledAdapters.add(frozen);return frozen;
}
