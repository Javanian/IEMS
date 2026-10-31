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
  ['saasEffectCommands','payloadHash'], ['automation_audit_logs','payloadHash'], ['cs_idempotency','requestHash'], ['documentIssues','contentHash'], ['crmCommandResults','inputHash'], ['legacyQuoteCommandResults','inputHash'], ['procurementCommandResults','inputHash'],
].map(([collection,hashField]) => [collection,Object.freeze({collection,hashField})])));
export const automationReceiptPolicies=Object.freeze({AUTOMATION_RECOVERY:'cs.automation.execute',AUTOMATION_ENGINE_RUN:'cs.automation.execute',TICKET_ESCALATE:'cs.automation.execute',RESOLUTION_DRAFT_CREATE:'cs.automation.execute',RESOLUTION_DISPATCH_INTENT:'cs.automation.execute',DIGEST_DISPATCH_INTENT:'cs.automation.execute',AUTOMATION_PAUSE:'cs.automation.admin',RESOLUTION_APPROVE:'cs.ticket.write',RESOLUTION_REJECT:'cs.ticket.write',RESOLUTION_CANCEL:'cs.ticket.write',DELIVERY_MANUAL_REVIEW:'cs.automation.admin',SERVICE_CREDENTIAL_ISSUE:'cs.automation.admin',SERVICE_CREDENTIAL_REVOKE:'cs.automation.admin',LOCAL_DELIVERY_RECONCILE:'cs.automation.execute'});
export const csReceiptPolicies=Object.freeze({
 'simulator.dispatch':{permission:'cs.simulator.use',owner:'user'},
 'complaint.start':{customer:true},'complaint.update':{customer:true},'conversation.bot_reply':{customer:true},'conversation.operator_reply':{permission:'cs.reply',owner:'user'},
 'inbound.command':{customer:true},'complaint.confirm':{customer:true},'ticket.customer_comment':{customer:true},'conversation.handoff_request':{customer:true},
 'ticket.transition':{permission:'cs.ticket.write',owner:'user'},'ticket.public_update':{permission:'cs.ticket.write',owner:'user'},'ticket.internal_note':{permission:'cs.note.internal',owner:'user'},
 'conversation.takeover':{permission:'cs.conversation.handoff',owner:'user'},'conversation.mode':{permission:'cs.conversation.handoff',owner:'user'},
 'binding.create':{permission:'cs.binding.manage',owner:'plant'},'binding.revoke':{permission:'cs.binding.manage',owner:'plant'},'delivery.review':{permission:'cs.delivery.review',owner:'user'},
});
for(const policy of Object.values(csReceiptPolicies))Object.freeze(policy);
const operatorActions = new Set(['saas.subscribe','saas.meter','saas.suspend','saas.resume','saas.export','saas.delete','saas.restore']);
export function createSaasAdmission({db,foundation,integrations={},clock=()=>new Date(),coverage=null,controlledIndexReady}={}) {
  if(coverage!==null && coverage!==admissionProfile) fail('SAAS_ADMISSION_UNSUPPORTED_CONFIGURATION',400);
  const subscriptions=db.collection('saasSubscriptions'), pending=new WeakMap();
  let hostReady=false;const csContexts=new WeakMap();
  async function active(scope,{plantId,session},customerAuthority) {
    if(!session?.inTransaction()) fail('TRANSACTION_REQUIRED',500);
    // Enrollment and legacy effects contend even before a subscription exists.
    const fence=await db.collection('tenants').updateOne({_id:scope?.tenantId,active:true},{$inc:{saasEnrollmentFence:1}},{session});
    if(fence.matchedCount!==1) fail('SCOPE_DENIED',403);
    const row=await subscriptions.findOne({tenantId:scope.tenantId},{session});
    if(!row) return null;
    if(!hostReady || row.admissionProfile!==admissionProfile || coverage!==admissionProfile) fail('SAAS_ADMISSION_INCOMPLETE',503);
    if(row.state!=='ACTIVE') fail('SAAS_ADMISSION_SUSPENDED',403);
    const grant=customerAuthority??await foundation.authorizeInTransaction(scope,{tenantId:scope.tenantId,plantId,action:'saas.use'},{session});
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
  async function effect({scope,grant:supplied,session,namespace,key,action,aggregateId,payloadHash,replayed,identity,parent,operation,rootIdentity}) {
    if(namespace==='cs_idempotency')return operatorCsEffect({scope,session,identity,payloadHash,replayed,action,parent});
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
    if(namespace==='automation_audit_logs') {
      if(!identity||Object.keys(identity).sort().join(',')!=='idempotencyKey,tenantId'||identity.tenantId!==grant.tenantId||identity.idempotencyKey!==key||action!==automationReceiptPolicies[operation]||!Object.hasOwn(automationReceiptPolicies,operation))fail('SAAS_ADMISSION_IDENTITY_REQUIRED',400);
      filter={...identity};
      const receipt=await db.collection(namespace).findOne(filter,{session});
      if(receipt&&(receipt.plantId!==grant.plantId||receipt.action!==operation||receipt.targetEntity?.id!==aggregateId))fail('IDEMPOTENCY_CONFLICT');
    }
    if(namespace==='saasEffectCommands') {
      const fields=['action','key','plantId','resourceId','tenantId','userId'];if(!identity||Object.keys(identity).sort().join(',')!=='ownerIdentityHash,ownerNamespace,tenantId'||identity.tenantId!==grant.tenantId||identity.ownerNamespace!=='AI_INDEX_ROOT_V1'||!rootIdentity||Object.keys(rootIdentity).sort().join(',')!==fields.join(',')||rootIdentity.tenantId!==grant.tenantId||rootIdentity.plantId!==grant.plantId||rootIdentity.userId!==grant.userId||rootIdentity.key!==key||rootIdentity.resourceId!==aggregateId||rootIdentity.action!==operation||!['ai.index.rebuild','ai.index.cleanup'].includes(operation)||action!=='ai.index'||identity.ownerIdentityHash!==contentHash(rootIdentity))fail('SAAS_ADMISSION_IDENTITY_REQUIRED',400);filter={...identity};
    }
    if(namespace==='documentIssues') {
      const fields=['kind','legalEntityId','plantId','sourceId','sourceVersion','tenantId'];
      if(!identity || Object.keys(identity).sort().join(',')!==fields.join(',') || ['tenantId','plantId','legalEntityId'].some(k=>identity[k]!==grant[k]) || !['quote','purchaseRequest','purchaseOrder','catalogPurchaseRequest','catalogPurchaseOrder','invoice','shipment'].includes(identity.kind) || typeof identity.sourceId!=='string' || !identity.sourceId || identity.sourceId.length>100 || !Number.isSafeInteger(identity.sourceVersion) || identity.sourceVersion<1 || action!=='document.issue') fail('SAAS_ADMISSION_IDENTITY_REQUIRED',400);
      filter={...identity};
    }
    return applyMeter({authority,grant,session,namespace,action,aggregateId,payloadHash,replayed,filter});
  }
  async function applyMeter({authority,grant,session,namespace,action,aggregateId,payloadHash,replayed,filter}) {
    const spec=admissionReceipts[namespace];
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
  function csIdentity(identity) {
    if(!identity || Object.keys(identity).sort().join(',')!=='key,owner,scope,tenantId' || !csReceiptPolicies[identity.scope] || ['tenantId','owner','key'].some(k=>typeof identity[k]!=='string'||!identity[k]) || identity.key.length>128) fail('SAAS_CS_IDENTITY_REQUIRED',400);
    return {...identity};
  }
  function parentContext(parent,grant,session) {
    if(!parent)return false;const stored=csContexts.get(parent);
    if(!stored || stored.session!==session || stored.transaction!==session.serverSession?.txnNumber?.toString() || ['tenantId','plantId'].some(k=>stored.grant[k]!==grant[k]) || (grant.bindingId?stored.grant.bindingId!==grant.bindingId:stored.grant.userId!==grant.userId)) fail('SAAS_CS_NESTED_CONTEXT_INVALID',403);
    return true;
  }
  async function csAdmission(descriptor,authority,grant) {
    const {session,identity,payloadHash,replayed,parent}=descriptor,filter=csIdentity(identity);
    if(typeof payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(payloadHash)||typeof replayed!=='boolean')fail('SAAS_CS_IDENTITY_REQUIRED',400);
    const prior=await db.collection('cs_idempotency').findOne(filter,{session});
    if(prior && prior.requestHash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');
    if(Boolean(prior)!==replayed)fail('SAAS_RECEIPT_STATE_MISMATCH');
    let result;
    if(parentContext(parent,grant,session))result={state:'INHERITED',charged:false};
    else if(!authority)result={state:'LEGACY_UNENROLLED',charged:false};
    else result=await applyMeter({authority,grant,session,namespace:'cs_idempotency',action:identity.scope,aggregateId:null,payloadHash,replayed,filter});
    const context=Object.freeze({});csContexts.set(context,{grant,session,transaction:session.serverSession?.txnNumber?.toString()});
    return {...result,context:parent??context};
  }
  async function operatorCsEffect(descriptor) {
    const {scope,session,identity,action}=descriptor,filter=csIdentity(identity),policy=csReceiptPolicies[filter.scope];
    if(policy.customer || policy.permission!==action)fail('SAAS_CS_PRINCIPAL_REQUIRED',403);
    const grant=await foundation.authorizeInTransaction(scope,{tenantId:filter.tenantId,plantId:scope.selectedPlantId,action},{session});
    if(filter.owner!==(policy.owner==='plant'?grant.plantId:grant.userId))fail('SAAS_CS_IDENTITY_REQUIRED',403);
    return csAdmission(descriptor,await active(scope,{plantId:grant.plantId,session}),grant);
  }
  function createCustomerServicePort({resolvePrincipal}) {
    if(typeof resolvePrincipal!=='function')throw new TypeError('Closed customer principal resolver required');
    async function authority(principal,session) {
      if(!session?.inTransaction()||session.client!==db.client)fail('TRANSACTION_REQUIRED',500);
      const binding=await resolvePrincipal(principal,{session});
      if(!binding || ['tenantId','plantId','customerId','_id'].some(k=>typeof binding[k]!=='string'))fail('SAAS_CS_PRINCIPAL_REQUIRED',403);
      const plant=await db.collection('plants').findOne({_id:binding.plantId,tenantId:binding.tenantId,active:true},{session});
      if(!plant)fail('SCOPE_DENIED',403);
      for(const [name,filter]of [['legalEntities',{_id:plant.legalEntityId,tenantId:binding.tenantId,active:true}],['cs_customers',{_id:binding.customerId,tenantId:binding.tenantId,plantId:binding.plantId}]]) {
        if((await db.collection(name).updateOne(filter,{$inc:{saasCustomerFence:1}},{session})).matchedCount!==1)fail('SCOPE_DENIED',403);
      }
      const grant={tenantId:binding.tenantId,plantId:binding.plantId,legalEntityId:plant.legalEntityId,customerId:binding.customerId,bindingId:binding._id,principalKind:'CUSTOMER'};
      return {grant,enrolled:await active({tenantId:grant.tenantId},{plantId:grant.plantId,session},grant)};
    }
    return Object.freeze({
      async authorize(principal,{session}) {const {enrolled}=await authority(principal,session);return {state:enrolled?'AUTHORIZED':'LEGACY_UNENROLLED',charged:false};},
      async effect({principal,...descriptor}) {
        const {grant,enrolled}=await authority(principal,descriptor.session),filter=csIdentity(descriptor.identity);
        if(!csReceiptPolicies[filter.scope]?.customer || filter.tenantId!==grant.tenantId || filter.owner!==grant.bindingId)fail('SAAS_CS_PRINCIPAL_REQUIRED',403);
        return csAdmission(descriptor,enrolled,grant);
      },
    });
  }
  return Object.freeze({coverage:{profile:coverage,unit:'command-count',fullEndpointCoverage:false},
    validateHost(app) { validateAdmissionRoutes(app); hostReady=true; },
    async enrollmentGuard(profile) {
      if(!hostReady || coverage!==admissionProfile || profile!==admissionProfile) fail('SAAS_ADMISSION_INCOMPLETE',503);
      if(integrations.rag?.embeddings || integrations.rag?.vectors || integrations.vendorDrafts?.transport || integrations.voice?.store) fail('SAAS_ADMISSION_EXTERNAL_ADAPTER_UNCOVERED',503);
      if(integrations.effects?.ai&&controlledIndexReady?.()!==true)fail('SAAS_ADMISSION_EXTERNAL_ADAPTER_UNCOVERED',503);
    },
    authorize,guard:authorize,unsupported,unsupportedTenant,unkeyed,effect,createCustomerServicePort,
    async controlPlane(d) {
      if(d.namespace!=='foundationCommandResults' || !operatorActions.has(d.action)) fail('SAAS_CONTROL_PLANE_COMMAND_INVALID',500);
      return {state:'CONTROL_PLANE',charged:false};
    },
  });
}
