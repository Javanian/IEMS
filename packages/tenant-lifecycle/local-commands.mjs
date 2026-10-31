import { randomUUID } from 'node:crypto';
import { CommandError, contentHash } from '../tenant-foundation/commands.mjs';

export const localCommandPolicies = Object.freeze({
  crmCommandResults: { 'account.created':'crm.write', 'contact.created':'crm.write', 'opportunity.created':'crm.write', 'opportunity.stage':'crm.write' },
  legacyQuoteCommandResults: { 'quote.created':'quote.write', 'quote.revisions':'quote.write', 'quote.approve':'quote.approve', 'quote.accept':'quote.accept' },
  procurementCommandResults: { 'vendor.created':'procurement.write', 'purchaseRequest.created':'procurement.write', 'purchaseRequest.approve':'procurement.approve', 'purchaseOrder.issue':'procurement.issue', 'purchaseOrder.vendor-confirmation':'procurement.confirm' },
});
export function checkLocalCommandKeys(body,{allowed=true}={}) {
  if(Object.hasOwn(body??{},'commandKey')&&Object.hasOwn(body??{},'idempotencyKey')) throw new CommandError('MIXED_COMMAND_KEYS',400);
  if(!allowed&&Object.hasOwn(body??{},'commandKey')) throw new CommandError('COMMAND_KEY_NOT_ALLOWED',400);
}
export async function initializeLocalCommandReceipt(db, namespace) {
  if(!Object.hasOwn(localCommandPolicies,namespace)) throw new TypeError('Unknown local receipt namespace');
  await db.collection(namespace).createIndex({tenantId:1,plantId:1,userId:1,action:1,key:1},{unique:true});
}
export async function localCommandTransaction(session,effect,options) {
  for(let attempt=1;attempt<=3;attempt++) {
    try { return await session.withTransaction(effect,options); }
    catch(error) {
      const fields=Object.keys(error.keyPattern??{}).sort().join(',');
      if(error.code!==11000||fields!=='action,key,plantId,tenantId,userId'||attempt===3) throw error;
    }
  }
}
export function createLocalCommandReceipts({db,foundation,saasAdmission}) {
  return Object.freeze({
    async run({scope,session,namespace,action,resourceId=null,body,authorizeSources=async()=>{}},effect) {
      const permission=localCommandPolicies[namespace]?.[action];
      if(!permission||!session?.inTransaction()) throw new CommandError('INVALID_LOCAL_COMMAND_BOUNDARY',500);
      const {commandKey:key,...input}=body;
      if(key!==undefined&&(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(key))) throw new CommandError('INVALID_COMMAND_KEY',400);
      const grant=await foundation.authorizeInTransaction(scope,{tenantId:scope.tenantId,plantId:scope.selectedPlantId,action:permission},{session});
      if(key===undefined) {
        await saasAdmission.unkeyed(scope,{plantId:grant.plantId,session});
        await authorizeSources(null);
        return effect(async()=>{});
      }
      const inputHash=contentHash({action,resourceId,input});
      const filter={tenantId:grant.tenantId,plantId:grant.plantId,userId:grant.userId,action,key};
      const previous=await db.collection(namespace).findOne(filter,{session});
      if(previous&&previous.inputHash!==inputHash) throw new CommandError('IDEMPOTENCY_CONFLICT',409);
      if(previous&&(previous.schemaVersion!==1||previous.resourceId!==resourceId||!previous.result||typeof previous.result!=='object')) throw new CommandError('LOCAL_COMMAND_RECEIPT_INVALID',409);
      await authorizeSources(previous?.result??null);
      const descriptor={scope,grant,session,namespace,key,action,aggregateId:resourceId,payloadHash:inputHash,replayed:Boolean(previous)};
      if(previous) { await saasAdmission.effect(descriptor); return previous.result; }
      let admitted=false;
      const admit=async()=>{const result=await saasAdmission.effect(descriptor);admitted=true;return result;};
      const result=await effect(admit);
      if(!admitted) throw new CommandError('LOCAL_COMMAND_ADMISSION_REQUIRED',500);
      await db.collection(namespace).insertOne({_id:randomUUID(),...filter,resourceId,inputHash,result,schemaVersion:1,occurredAt:new Date()},{session});
      return result;
    },
  });
}
