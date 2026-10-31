import { randomUUID } from 'node:crypto';
import { CommandError, contentHash } from '../tenant-foundation/commands.mjs';
import { addUsage, plans } from './index.mjs';
import { validateAdmissionRoutes } from './admission-registry.mjs';
import { localCommandPolicies } from './local-commands.mjs';
const fail = (code, status = 409) => { throw new CommandError(code, status); };
export const admissionProfile = 'RECEIPTED_COMMANDS_V1';
export const admissionReceipts = Object.freeze(Object.fromEntries([
  ['foundationCommandResults','inputHash'], ['fulfillmentKeys','payloadHash'], ['manufacturingKeys','payloadHash'],
  ['warehouseKeys','payloadHash'], ['qualityKeys','payloadHash'], ['maintenanceKeys','payloadHash'], ['operationsKeys','payloadHash'],
  ['repairKeys','payloadHash'], ['internalPlanningKeys','payloadHash'], ['internalExecutionKeys','payloadHash'],
  ['stockHoldKeys','requestHash'], ['inquiryKeys','payloadHash'], ['materialShortageKeys','payloadHash'],
  ['catalogKeys','payloadHash'], ['catalogDispositionKeys','payloadHash'], ['purchasedFulfillmentKeys','payloadHash'],
  ['deliveryKeys','payloadHash'], ['fulfillmentReturnKeys','payloadHash'], ['workforceResults','inputHash'],
  ['purchaseOrderAmendmentKeys','payloadHash'], ['procurementRfqKeys','payloadHash'], ['procurementPromiseKeys','payloadHash'],
  ['procurementConversions','payloadHash'], ['quoteCatalogKeys','payloadHash'], ['quoteConversions','payloadHash'], ['companyStockKeys','payloadHash'],
  ['documentIssues','contentHash'], ['crmCommandResults','inputHash'], ['legacyQuoteCommandResults','inputHash'], ['procurementCommandResults','inputHash'],
].map(([collection,hashField]) => [collection,Object.freeze({collection,hashField})])));
const operatorActions = new Set(['saas.subscribe','saas.meter','saas.suspend','saas.resume','saas.export','saas.delete','saas.restore']);
export function createSaasAdmission({db,foundation,integrations={},clock=()=>new Date(),coverage=null}={}) {
  if(coverage!==null && coverage!==admissionProfile) fail('SAAS_ADMISSION_UNSUPPORTED_CONFIGURATION',400);
  const subscriptions=db.collection('saasSubscriptions'), pending=new WeakMap();
  let hostReady=false;
  async function active(scope,{plantId,session}) {
    if(!session?.inTransaction()) fail('TRANSACTION_REQUIRED',500);
    // Enrollment and legacy effects contend even before a subscription exists.
    const fence=await db.collection('tenants').updateOne({_id:scope?.tenantId,active:true},{$inc:{saasEnrollmentFence:1}},{session});
    if(fence.matchedCount!==1) fail('SCOPE_DENIED',403);
    const row=await subscriptions.findOne({tenantId:scope.tenantId},{session});
    if(!row) return null;
    if(!hostReady || row.admissionProfile!==admissionProfile || coverage!==admissionProfile) fail('SAAS_ADMISSION_INCOMPLETE',503);
    if(row.state!=='ACTIVE') fail('SAAS_ADMISSION_SUSPENDED',403);
    const grant=await foundation.authorizeInTransaction(scope,{tenantId:scope.tenantId,plantId,action:'saas.use'},{session});
    const write=await subscriptions.updateOne({tenantId:grant.tenantId,revision:row.revision,state:'ACTIVE'},{$inc:{admissionFence:1}},{session});
    if(write.matchedCount!==1) fail('SAAS_ADMISSION_CHANGED');
    return {row,grant};
  }
  async function authorize(scope,options) {
    const authority=await active(scope,options);
    return {state:authority?'AUTHORIZED':'LEGACY_UNENROLLED',charged:false};
  }
  async function unsupported(scope,options) {
    if(await active(scope,options)) fail('SAAS_ADMISSION_UNSUPPORTED_EFFECT',403);
    return {state:'LEGACY_UNENROLLED',charged:false};
  }
  async function unkeyed(scope,options) {
    if(await active(scope,options)) fail('COMMAND_KEY_REQUIRED',400);
    return {state:'LEGACY_UNENROLLED',charged:false};
  }
  async function unsupportedTenant({tenantId,session}) {
    if(!session?.inTransaction()) fail('TRANSACTION_REQUIRED',500);
    const fence=await db.collection('tenants').updateOne({_id:tenantId,active:true},{$inc:{saasEnrollmentFence:1}},{session});
    if(fence.matchedCount!==1) fail('SCOPE_DENIED',403);
    if(await subscriptions.findOne({tenantId},{session})) fail('SAAS_ADMISSION_UNSUPPORTED_EFFECT',403);
  }
  async function effect({scope,grant:supplied,session,namespace,key,action,aggregateId,payloadHash,replayed,identity}) {
    const plantId=supplied?.plantId??scope?.selectedPlantId, authority=await active(scope,{plantId,session});
    if(!authority) return {state:'LEGACY_UNENROLLED',charged:false};
    const spec=admissionReceipts[namespace];
    if(!spec || typeof action!=='string' || (namespace!=='documentIssues' && (typeof key!=='string' || !key || key.length>128)) ||
       typeof payloadHash!=='string' || !/^[a-f0-9]{64}$/.test(payloadHash) || typeof replayed!=='boolean') fail('SAAS_ADMISSION_IDENTITY_REQUIRED',400);
    const local=Object.hasOwn(localCommandPolicies,namespace),permission=local?localCommandPolicies[namespace][action]:action;
    if(!permission) fail('SAAS_ADMISSION_IDENTITY_REQUIRED',400);
    const grant=await foundation.authorizeInTransaction(scope,{tenantId:scope.tenantId,plantId,action:permission},{session});
    let filter={tenantId:grant.tenantId,plantId:grant.plantId,...(namespace==='foundationCommandResults'||local?{userId:grant.userId,action}:{}),
      ...(namespace==='workforceResults'?{actorId:grant.userId}:{}),...(namespace==='purchaseOrderAmendmentKeys'?{cohort:'LEGACY'}:{}),key};
    if(namespace==='documentIssues') {
      const fields=['kind','legalEntityId','plantId','sourceId','sourceVersion','tenantId'];
      if(!identity || Object.keys(identity).sort().join(',')!==fields.join(',') || ['tenantId','plantId','legalEntityId'].some(k=>identity[k]!==grant[k]) || !['quote','purchaseRequest','purchaseOrder','catalogPurchaseRequest','catalogPurchaseOrder','invoice','shipment'].includes(identity.kind) || typeof identity.sourceId!=='string' || !identity.sourceId || identity.sourceId.length>100 || !Number.isSafeInteger(identity.sourceVersion) || identity.sourceVersion<1 || action!=='document.issue') fail('SAAS_ADMISSION_IDENTITY_REQUIRED',400);
      filter={...identity};
    }
    const receipt=await db.collection(spec.collection).findOne(filter,{session});
    if(receipt && receipt[spec.hashField]!==payloadHash) fail('IDEMPOTENCY_CONFLICT');
    if(replayed!==Boolean(receipt)) fail('SAAS_RECEIPT_STATE_MISMATCH');
    if(receipt) return {state:'REPLAY',charged:false};
    const commandHash=contentHash({namespace,filter});
    // Retry starts a new transaction number; only this exact in-flight receipt inherits admission.
    const transaction=session.serverSession?.txnNumber?.toString();
    if(transaction===undefined) fail('SAAS_TRANSACTION_ID_REQUIRED',500);
    let context=pending.get(session);
    if(context?.transaction!==transaction) { context={transaction,receipts:new Map()}; pending.set(session,context); }
    if(context.receipts.has(commandHash)) {
      if(context.receipts.get(commandHash)!==payloadHash) fail('IDEMPOTENCY_CONFLICT');
      return {state:'INHERITED',charged:false};
    }
    if(await db.collection('audit').findOne({tenantId:grant.tenantId,kind:'saas.effect.metered',commandHash},{session})) fail('SAAS_METER_RECEIPT_WITHOUT_DOMAIN_RESULT');
    const {row}=authority, period=clock().toISOString().slice(0,7), usage=row.period===period?row.usage:{apiCalls:'0',exports:'0',storageBytes:'0'};
    if(!Object.hasOwn(plans,row.plan)) fail('SAAS_PLAN_INVALID',500);
    const next=addUsage(usage,'apiCalls','1',plans[row.plan]);
    const write=await subscriptions.updateOne({tenantId:grant.tenantId,revision:row.revision,state:'ACTIVE'},{$set:{usage:next,period},$inc:{revision:1}},{session});
    if(write.matchedCount!==1) fail('SAAS_ADMISSION_CHANGED');
    const occurredAt=clock();
    await db.collection('audit').insertOne({_id:randomUUID(),...grant,kind:'saas.effect.metered',subjectId:grant.tenantId,commandHash,payloadHash,namespace,action,aggregateId:aggregateId??null,occurredAt},{session});
    await db.collection('outbox').insertOne({_id:randomUUID(),tenantId:grant.tenantId,plantId:grant.plantId,legalEntityId:grant.legalEntityId,
      type:'saas.effect.metered',schemaVersion:1,aggregateId:grant.tenantId,aggregateRevision:row.revision+1,
      data:{commandHash,namespace,metric:'apiCalls',amount:'1'},occurredAt,publishedAt:null},{session});
    context.receipts.set(commandHash,payloadHash);
    return {state:'ADMITTED',charged:true,commandHash};
  }
  return Object.freeze({coverage:{profile:coverage,unit:'command-count',fullEndpointCoverage:false},
    validateHost(app) { validateAdmissionRoutes(app); hostReady=true; },
    async enrollmentGuard(profile) {
      if(!hostReady || coverage!==admissionProfile || profile!==admissionProfile) fail('SAAS_ADMISSION_INCOMPLETE',503);
      if(integrations.rag?.embeddings || integrations.rag?.vectors || integrations.vendorDrafts?.transport || integrations.voice?.store) fail('SAAS_ADMISSION_EXTERNAL_ADAPTER_UNCOVERED',503);
    },
    authorize,guard:authorize,unsupported,unsupportedTenant,unkeyed,effect,
    async controlPlane(d) {
      if(d.namespace!=='foundationCommandResults' || !operatorActions.has(d.action)) fail('SAAS_CONTROL_PLANE_COMMAND_INVALID',500);
      return {state:'CONTROL_PLANE',charged:false};
    },
  });
}
