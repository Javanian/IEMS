import { randomBytes, randomUUID } from 'node:crypto';
import { submitLocalMail, verifiedSinkReceipt, localUrl, hashText } from './automation-transport.mjs';
import { effectHash, effectTransaction } from '../../../packages/tenant-lifecycle/effects.mjs';

export const automationRoles = {
  automationViewer: ['cs.automation.read'],
  automationOperator: ['cs.automation.read', 'cs.automation.execute'],
  automationAdmin: ['cs.automation.read', 'cs.automation.execute', 'cs.automation.admin'],
  automationService: ['cs.automation.read', 'cs.automation.execute']
};
export const automationActions = ['cs.automation.read', 'cs.automation.execute', 'cs.automation.admin'];
const c = (runtime, name) => runtime.db.collection(name);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const digest = value => hashText(JSON.stringify(canonical(value)));
const scope = req => ({ tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId });
const dueTicketFilter = (req, at, minutes) => ({ ...scope(req), stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null, assignedUserId: null, isEscalated: { $ne: true }, createdAt: { $lte: new Date(at.getTime() - minutes * 60000) } });
const workflows = [
  { id: 'wf-sla-escalation', name: 'Unassigned ticket escalation', type: 'POLL_AND_RECHECK', path: 'iems-sla-escalation' },
  { id: 'wf-cs-weekly-digest', name: 'Weekly CS digest', type: 'SCHEDULED_DIGEST', path: 'iems-cs-weekly-digest' },
  { id: 'wf-approved-resolution', name: 'Approved resolution update', type: 'APPROVAL_GATE', path: 'iems-approved-resolution' }
];

export async function initializeAutomation(db) {
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, plantId: 1, occurredAt: -1 });
  const indexes = await db.collection('automation_audit_logs').listIndexes().toArray().catch(() => []);
  const previous = indexes.find(x => x.name === 'tenantId_1_idempotencyKey_1' && x.sparse);
  if (previous) await db.collection('automation_audit_logs').dropIndex(previous.name);
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
  await db.collection('cs_resolution_drafts').createIndex({ tenantId: 1, plantId: 1, status: 1 });
  await db.collection('automation_tasks').createIndex({ tenantId: 1, plantId: 1, kind: 1, occurrence: 1 }, { unique: true });
  await db.collection('cs_tickets').createIndex({ tenantId: 1, plantId: 1, stage: 1, assigneeId: 1, assignedUserId: 1, createdAt: 1, _id: 1 });
  await db.collection('cs_outbox').createIndex({ tenantId: 1, origin: 1, plantId: 1, state: 1 });
}

export function installAutomation(app, runtime, { fail, id, fields }) {
  const cfg = () => runtime.automation || {};
  const effects=runtime.separateEffects,recoveryRequests=new WeakMap(),intentCandidates=new WeakMap();
  const auth = async (req, action = 'cs.automation.read', session) => session
    ? runtime.foundation.authorizeInTransaction(req.scope, { ...scope(req), action }, { session })
    : runtime.foundation.authorize(req.scope, { ...scope(req), action });
  const human = async (req, action = 'cs.ticket.write', session) => {
    if (req.automationService) fail(403, 'HUMAN_APPROVAL_REQUIRED');
    return auth(req, action, session);
  };
  const text = (value, max = 2000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /\r/.test(value)) fail(400, 'INVALID_TEXT');
    return value.trim();
  };
  const recipient = value => {
    const out = text(value, 100).toLowerCase();
    if (!/^[a-z0-9._+-]+@iems\.local$/.test(out)) fail(400, 'SYNTHETIC_RECIPIENT_REQUIRED');
    return out;
  };
  const version = value => {
    if (!Number.isSafeInteger(value) || value < 1) fail(400, 'INVALID_VERSION');
    return value;
  };
  const key = req => {
    const value = req.headers['idempotency-key'];
    if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{8,120}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
    return value;
  };
  const administrativeActions={AUTOMATION_PAUSE:'cs.automation.admin',RESOLUTION_APPROVE:'cs.ticket.write',RESOLUTION_REJECT:'cs.ticket.write',RESOLUTION_CANCEL:'cs.ticket.write',DELIVERY_MANUAL_REVIEW:'cs.automation.admin',SERVICE_CREDENTIAL_ISSUE:'cs.automation.admin',SERVICE_CREDENTIAL_REVOKE:'cs.automation.admin'};
  const admittedOperations = new Set([...Object.keys(administrativeActions),'TICKET_ESCALATE','RESOLUTION_DRAFT_CREATE','RESOLUTION_DISPATCH_INTENT','DIGEST_DISPATCH_INTENT','LOCAL_DELIVERY_RECONCILE']);
  const localIntent = Symbol('automation local admission'), observationProofs=new WeakMap();
  const tx = async (req, action, effect, mode = 'UNSUPPORTED') => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => { await auth(req, action, session); if(mode==='READ') await runtime.saasAdmission.authorize(req.scope,{plantId:req.scope.selectedPlantId,session});
      else if(mode!=='RECEIPTED') await runtime.saasAdmission.unsupported(req.scope, {plantId:req.scope.selectedPlantId,session}); return effect(session); }); }
    finally { await session.endSession(); }
  };
  const audit = async (req, session, action, entityId, result, extra = {}) => {
    await cfg().beforeAudit?.({ action, entityId });
    const executionId = req.headers['x-iems-execution-id'];
    const status = action.endsWith('_DELIVERY_RESULT') && !['ACCEPTED_LOCAL', 'PREVIEWED'].includes(result.deliveryState) ? result.deliveryState : 'SUCCESS';
    const row = { _id: randomUUID(), ...scope(req), workflowId: action.startsWith('DIGEST') ? 'wf-cs-weekly-digest' : action.startsWith('RESOLUTION') ? 'wf-approved-resolution' : 'wf-sla-escalation', action, targetEntity: { type: 'AUTOMATION', id: entityId }, status, result, executionId: typeof executionId === 'string' ? executionId.slice(0, 100) : null, occurredAt: new Date(), reconciliationState: status === 'UNKNOWN' ? 'NEEDS_REVIEW' : 'CONFIRMED', ...extra };
    await c(runtime, 'automation_audit_logs').insertOne(row, { session });
    return row;
  };
  const replay = async (req, session, action, entityId, payload, idem) => {
    const row = await c(runtime, 'automation_audit_logs').findOne({ tenantId: req.scope.tenantId, idempotencyKey: idem }, { session });
    if (!row) return null;
    if (row.plantId !== req.scope.selectedPlantId || row.action !== action || row.targetEntity?.id !== entityId || row.payloadHash !== digest(payload)) fail(409, 'IDEMPOTENCY_CONFLICT', 'Key metadata is missing or does not match this operation');
    return { ...row.result, auditId: row._id, idempotencyKey: idem, replayed: true };
  };
  const operation = async (req, action, entityId, payload, effect, permission = 'cs.automation.execute', prepared=null) => {
    const idem = key(req);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await tx(req, permission, async session => {
          const child=recoveryRequests.get(req);if(child){const parent=await effects.worker(child.capability,{session,publish:true});if(parent.command.kind!=='automation.recovery'||parent.attempt.provider?.state!=='BEGUN'||action!=='RESOLUTION_DISPATCH_INTENT'||!parent.command.plan.drafts.some(d=>d.draftId===entityId&&d.receiptKey===idem)||child.draftId!==entityId)fail(403,'RECOVERY_CHILD_CONTEXT_REQUIRED');}
          const previous = await replay(req, session, action, entityId, payload, idem);
          await recheckOperationSources(req,session,action,entityId,payload,previous,prepared);
          const admission = admittedOperations.has(action) ? await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'automation_audit_logs',key:idem,identity:{tenantId:req.scope.tenantId,idempotencyKey:idem},action:permission,operation:action,aggregateId:entityId,payloadHash:digest(payload),replayed:Boolean(previous)}) : null;
          const mark=result=>Object.defineProperty(result,localIntent,{value:admission?.state!=='LEGACY_UNENROLLED'});
          if (previous) return mark(previous);
          const result = await effect(session);
          if(['RESOLUTION_DISPATCH_INTENT','DIGEST_DISPATCH_INTENT'].includes(action)&&effects?.supports('automation.local-delivery'))await managedDeliveryIntent(req,session,{action,entityId,payload,idem,result});
          const row = await audit(req, session, action, entityId, result, { idempotencyKey: idem, payloadHash: digest(payload) });
          return mark({ ...result, auditId: row._id, idempotencyKey: idem, replayed: false });
        },admittedOperations.has(action)?'RECEIPTED':'UNSUPPORTED');
      } catch (error) { if (error.code !== 11000 || attempt) throw error; }
    }
  };
  const adminOperation=async(req,action,target,payload,effect,permission=administrativeActions[action])=>{
    if(req.headers['idempotency-key']!==undefined)return operation(req,action,target,payload,effect,permission);
    return tx(req,permission,async session=>{await human(req,permission,session);return effect(session);});
  };
  const policy = () => {
    const minutes = Number(cfg().slaMinutes ?? process.env.IEMS_AUTOMATION_SLA_MINUTES ?? 15);
    return { version: `UNASSIGNED_V1_${String(minutes).replaceAll('.', '_')}`, minutes };
  };
  const eligible = (ticket, at = new Date()) => !!ticket && ['NEW', 'TRIAGED'].includes(ticket.stage) && !ticket.assigneeId && !ticket.assignedUserId && !ticket.isEscalated && new Date(ticket.createdAt).getTime() + policy().minutes * 60000 <= at.getTime();
  const schedule = async req => tx(req, 'cs.automation.read', async session => {
    const p = policy();
    if (!(p.minutes >= 0 && p.minutes <= 1440)) fail(503, 'INVALID_SLA_POLICY');
    const now = new Date(), limit = 100;
    const tickets = await c(runtime, 'cs_tickets').find(dueTicketFilter(req, now, p.minutes), { session }).sort({ createdAt: 1, _id: 1 }).limit(limit).toArray();
    return tickets.filter(t => eligible(t, now));
  },'READ');
  const getDraft = async (req, draftId, session) => {
    const draft = await c(runtime, 'cs_resolution_drafts').findOne({ ...scope(req), _id: id(draftId) }, { session });
    if (!draft) fail(404, 'NOT_FOUND');
    return draft;
  };
  const approvedHash = draft => digest({ ticketId: draft.ticketId, ticketVersion: draft.expectedTicketVersion, recipient: draft.recipient, channel: draft.channel, content: draft.proposedResolution, tenantId: draft.tenantId, plantId: draft.plantId, bindingId: draft.bindingId, bindingVersion: draft.bindingVersion, customerId: draft.customerId, recipientPolicy: draft.recipientPolicy, expiresAt: new Date(draft.expiresAt).toISOString() });
  const sourceBinding = async (req, ticket, session, expectedBindingVersion) => {
    const filter = { ...scope(req), _id: ticket.bindingId, customerId: ticket.customerId, synthetic: true, channelAccountId: 'SIMULATED', status: 'ACTIVE', ...(expectedBindingVersion === undefined ? {} : { version: expectedBindingVersion }), $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    const binding = await c(runtime, 'cs_contact_bindings').findOneAndUpdate(filter, { $inc: { automationFence: 1 } }, { session, returnDocument: 'after' });
    if (!binding) fail(409, 'SOURCE_BINDING_INELIGIBLE', 'An active synthetic binding matching the ticket customer is required');
    return binding;
  };
  const checkSource = async (req, draft, session, fence = false) => {
    if (new Date(draft.expiresAt) <= new Date()) fail(409, 'APPROVAL_EXPIRED');
    if (approvedHash(draft) !== draft.approvalHash) fail(409, 'APPROVAL_CONTENT_CHANGED');
    const filter = { ...scope(req), _id: draft.ticketId, stage: 'RESOLVED', version: draft.expectedTicketVersion };
    const ticket = fence ? await c(runtime, 'cs_tickets').findOneAndUpdate(filter, { $inc: { automationFence: 1 } }, { session, returnDocument: 'after' }) : await c(runtime, 'cs_tickets').findOne(filter, { session });
    if (!ticket) fail(409, 'STALE_DRAFT', 'Ticket must remain resolved at the approved source version');
    if (ticket.bindingId !== draft.bindingId || ticket.customerId !== draft.customerId) fail(409, 'SOURCE_BINDING_CHANGED');
    await sourceBinding(req, ticket, session, draft.bindingVersion);
    if (draft.status !== 'PENDING_APPROVAL') {
      const approvingMembership = await c(runtime, 'memberships').findOneAndUpdate({ _id: draft.approvedMembershipId, tenantId: draft.tenantId, userId: draft.approvedBy, active: true, version: draft.approvedMembershipVersion }, { $inc: { automationApprovalFence: 1 } }, { session, returnDocument: 'after' });
      const approvingUser = await c(runtime, 'users').findOneAndUpdate({ _id: draft.approvedBy, active: true }, { $inc: { automationApprovalFence: 1 } }, { session, returnDocument: 'after' });
      if (!approvingMembership || !approvingUser) fail(409, 'APPROVER_AUTHORITY_CHANGED');
    }
    return ticket;
  };
  const deliveryOrigin=(actorScope,plan)=>({context:{scope:actorScope},authorize:async({command,session,observation})=>{
    const request={scope:actorScope},grant=await auth(request,'cs.automation.execute',session);if(!observation){await runtime.saasAdmission.authorize(actorScope,{plantId:grant.plantId,session});if((await c(runtime,'automation_settings').findOne({_id:`${grant.tenantId}:${grant.plantId}`},{session}))?.paused)fail(409,'AUTOMATION_PAUSED');}
    const receipt=await c(runtime,'automation_audit_logs').findOne(command.owner.identity,{session});if(receipt&&(receipt.plantId!==grant.plantId||receipt.action!==plan.action||receipt.targetEntity?.id!==plan.entityId))fail(409,'IDEMPOTENCY_CONFLICT');await recheckOperationSources(request,session,plan.action,plan.entityId,plan.payload,command.acceptedResult);
    for(const deliveryId of plan.deliveryIds){await recheckDelivery(request,session,deliveryId,{});const delivery=await c(runtime,'cs_outbox').findOne({...scope(request),_id:deliveryId,origin:'AUTOMATION'},{session}),proof=plan.proofs[deliveryId];if(!proof||proof.contentHash!==delivery.contentHash||proof.payloadHash!==delivery.payloadHash||proof.recipientHash!==hashText(delivery.recipient)||proof.messageId!==delivery.messageId||delivery.controlCommandId&&delivery.controlCommandId!==command._id)fail(409,'DELIVERY_RECEIPT_SOURCE_CHANGED');if(delivery.draftId){const draft=await getDraft(request,delivery.draftId,session);if(draft.approvalHash!==proof.approvalHash)fail(409,'APPROVAL_CONTENT_CHANGED');await checkSource(request,draft,session,true);}else if(delivery.kind!=='DIGEST'||delivery.recipient!=='reports@iems.local')fail(409,'SOURCE_BINDING_CHANGED');}
    return grant;
  }});
  async function managedDeliveryIntent(req,session,{action,entityId,payload,idem,result}){
    const candidate=intentCandidates.get(session);if(candidate?.transaction!==session.serverSession?.txnNumber?.toString()||!candidate.ids.has(result.deliveryId))fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');const grant=await auth(req,'cs.automation.execute',session),identity={tenantId:grant.tenantId,idempotencyKey:idem},delivery=await c(runtime,'cs_outbox').findOne({...scope(req),_id:result.deliveryId,origin:'AUTOMATION'},{session});if(!delivery)fail(409,'DELIVERY_RECEIPT_SOURCE_CHANGED');const approvalHash=delivery.draftId?(await getDraft(req,delivery.draftId,session)).approvalHash:null,plan={action,entityId,payload,deliveryIds:[result.deliveryId],proofs:{[result.deliveryId]:{contentHash:delivery.contentHash,payloadHash:delivery.payloadHash,recipientHash:hashText(delivery.recipient),messageId:delivery.messageId,approvalHash}}},command=await effects.accept({session,grant,actor:{type:'USER',userId:grant.userId,membershipId:grant.membershipId},owner:{namespace:'automation_audit_logs',identity,hashField:'payloadHash',payloadHash:digest(payload),resultPath:'result',resultHash:effectHash(result)},kind:'automation.local-delivery',plan,accepted:result,origin:deliveryOrigin(req.scope,plan)});
    const changed=await c(runtime,'cs_outbox').updateOne({...scope(req),_id:result.deliveryId,origin:'AUTOMATION',controlCommandId:{$exists:false}},{$set:{controlCommandId:command._id}},{session});if(changed.matchedCount!==1)fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');
  }
  const deliveryView = row => ({ deliveryId: row._id, draftId: row.draftId, ticketId: row.ticketId, kind: row.kind, recipient: row.recipient, subject: row.subject, body: row.body, state: row.state, deliveryState: row.deliveryState || row.state, receiptStatus: row.receiptStatus || null, sinkMessageId: row.providerMessageId || null, lastError: row.lastError || null, leaseUntil: row.leaseUntil, attempt: row.attempt, createdAt: row.createdAt, updatedAt: row.updatedAt,...(row.controlCommandId?{effect:{commandId:row.controlCommandId,phase:row._id,mode:'LOCAL_SIMULATED'}}:{}) });
  async function recoveryDelivery(req,session,deliveryId){
    await recheckDelivery(req,session,deliveryId,{});const d=await c(runtime,'cs_outbox').findOne({...scope(req),_id:deliveryId,origin:'AUTOMATION'},{session});
    if(!d.controlCommandId)fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');const command=await c(runtime,'saasEffectCommands').findOne({_id:d.controlCommandId,...scope(req),kind:'automation.local-delivery',ownerNamespace:'automation_audit_logs'},{session});if(!command||!command.plan.deliveryIds.includes(d._id))fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');
    const receipt=await c(runtime,'automation_audit_logs').findOne(command.owner.identity,{session});if(!receipt||receipt.plantId!==req.scope.selectedPlantId||receipt.action!==command.plan.action||receipt.targetEntity?.id!==command.plan.entityId||receipt.payloadHash!==command.owner.payloadHash||effectHash(receipt.result)!==command.owner.resultHash||receipt.result.deliveryId!==d._id)fail(409,'EFFECT_OWNER_RECEIPT_MISSING_OR_CONFLICT');
    if(d.draftId)await checkSource(req,await getDraft(req,d.draftId,session),session,true);else if(d.kind!=='DIGEST'||d.recipient!=='reports@iems.local')fail(409,'SOURCE_BINDING_CHANGED');
    return {deliveryId:d._id,commandId:command._id,contentHash:d.contentHash,payloadHash:d.payloadHash,recipientHash:hashText(d.recipient)};
  }
  const recoveryOrigin=(actorScope,plan)=>({context:{scope:actorScope},authorize:async({session,observation})=>{
    const request={scope:actorScope},grant=await auth(request,'cs.automation.execute',session);if(!observation)await runtime.saasAdmission.authorize(actorScope,{plantId:grant.plantId,session});
    for(const proof of plan.deliveries){if(effectHash(await recoveryDelivery(request,session,proof.deliveryId))!==effectHash(proof))fail(409,'RECOVERY_SOURCE_CHANGED');}
    for(const selected of plan.drafts){const draft=await getDraft(request,selected.draftId,session);if(!['APPROVED','DISPATCHED','QUEUED','UNKNOWN','FAILED'].includes(draft.status)||draft.approvalHash!==selected.approvalHash)fail(409,'RECOVERY_SOURCE_CHANGED');await checkSource(request,draft,session,true);}
    return grant;
  }});
  async function acceptRecovery(req){
    fields(req.body,['deliveryIds','draftIds']);const payload={};for(const name of ['deliveryIds','draftIds'])if(req.body[name]!==undefined){if(!Array.isArray(req.body[name])||req.body[name].length<1||req.body[name].length>100||new Set(req.body[name]).size!==req.body[name].length)fail(400,'INVALID_RECOVERY_BOUND');payload[name]=req.body[name].map(id).sort();}
    const idem=key(req);if(!effects?.supports('automation.recovery'))fail(503,'EFFECT_ADAPTER_UNPROVEN');
    return effectTransaction(runtime.client,async session=>{
      const grant=await auth(req,'cs.automation.execute',session),identity={tenantId:grant.tenantId,idempotencyKey:idem},previous=await replay(req,session,'AUTOMATION_RECOVERY',grant.plantId,payload,idem);
      if(previous){const command=await effects.managed('automation_audit_logs',identity,{session});if(!command)fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');await effects.accept({session,grant,actor:command.actor,owner:command.owner,kind:command.kind,plan:command.plan,accepted:command.acceptedResult,origin:recoveryOrigin(req.scope,command.plan)});await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'automation_audit_logs',identity,key:idem,action:'cs.automation.execute',operation:'AUTOMATION_RECOVERY',aggregateId:grant.plantId,payloadHash:digest(payload),replayed:true});return {result:previous,commandId:command._id};}
      const selectedDeliveries=await c(runtime,'cs_outbox').find({...scope(req),origin:'AUTOMATION',...(payload.deliveryIds?{_id:{$in:payload.deliveryIds}}:Object.keys(payload).length?{_id:{$in:[]}}:{state:{$in:['QUEUED','FAILED','SENDING','UNKNOWN']}})},{session}).sort({createdAt:1,_id:1}).limit(100).toArray(),selectedDrafts=await c(runtime,'cs_resolution_drafts').find({...scope(req),...(payload.draftIds?{_id:{$in:payload.draftIds}}:Object.keys(payload).length?{_id:{$in:[]}}:{status:'APPROVED'})},{session}).sort({_id:1}).limit(100).toArray();
      if(payload.deliveryIds&&selectedDeliveries.length!==payload.deliveryIds.length||payload.draftIds&&selectedDrafts.length!==payload.draftIds.length)fail(404,'NOT_FOUND');
      const deliveries=[];for(const d of selectedDeliveries)deliveries.push(await recoveryDelivery(req,session,d._id));const drafts=[];for(const draft of selectedDrafts){if(draft.status!=='APPROVED')fail(409,'DRAFT_NOT_APPROVED');await checkSource(req,draft,session,true);drafts.push({draftId:draft._id,receiptKey:`resolution:${draft._id}`,approvalHash:draft.approvalHash});}
      const recoveryId=randomUUID(),plan={deliveries,drafts},result={recoveryId,state:'ACCEPTED',deliveryIds:deliveries.map(x=>x.deliveryId),draftIds:drafts.map(x=>x.draftId)};
      await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'automation_audit_logs',identity,key:idem,action:'cs.automation.execute',operation:'AUTOMATION_RECOVERY',aggregateId:grant.plantId,payloadHash:digest(payload),replayed:false});
      await effects.accept({session,id:recoveryId,grant,actor:{type:'USER',userId:grant.userId,membershipId:grant.membershipId},owner:{namespace:'automation_audit_logs',identity,hashField:'payloadHash',payloadHash:digest(payload),resultPath:'result',resultHash:effectHash(result)},kind:'automation.recovery',plan,accepted:result,origin:recoveryOrigin(req.scope,plan)});const row=await audit(req,session,'AUTOMATION_RECOVERY',grant.plantId,result,{idempotencyKey:idem,payloadHash:digest(payload)});return {result:{...result,auditId:row._id,idempotencyKey:idem,replayed:false},commandId:recoveryId};
    });
  }
  const enqueue = async (req, session, { actionKey, kind, draft, recipient: to, subject, body, summary }) => {
    const existing = await c(runtime, 'cs_outbox').findOne({ tenantId: req.scope.tenantId, actionKey }, { session });
    if (existing) return existing;
    const now = new Date(), deliveryId = randomUUID();
    const row = { _id: deliveryId, ...scope(req), actionKey, origin: 'AUTOMATION', kind, channelAccountId: 'IEMS_LOCAL_SMTP', conversationId: draft?.conversationId || deliveryId, bindingId: draft?.bindingId || null, draftId: draft?._id || null, ticketId: draft?.ticketId || null, recipient: to, subject, body: body.trim(), contentHash: hashText(body.trim()), summary, payload: { kind }, payloadHash: digest({ to, subject, body }), messageId: `<${deliveryId}@iems.local>`, state: 'QUEUED', deliveryState: 'QUEUED', attempt: 0, fence: 0, nextAttemptAt: now, leaseUntil: null, createdAt: now, updatedAt: now, history: [{ state: 'QUEUED', at: now }] };
    await c(runtime, 'cs_outbox').insertOne(row, { session });
    const transaction=session.serverSession?.txnNumber?.toString();let candidate=intentCandidates.get(session);if(candidate?.transaction!==transaction){candidate={transaction,ids:new Set()};intentCandidates.set(session,candidate);}candidate.ids.add(row._id);
    return row;
  };
  const finish = async (req, delivery, state, receipt = null, error = null) => tx(req, 'cs.automation.execute', async session => {
    const now = new Date(), display = state === 'SENT' ? 'ACCEPTED_LOCAL' : state;
    const update = await c(runtime, 'cs_outbox').updateOne({ ...scope(req), _id: delivery._id, origin: 'AUTOMATION',controlCommandId:{$exists:false}, state: { $in: ['SENDING', 'UNKNOWN'] }, fence: delivery.fence }, { $set: { state, deliveryState: display, providerMessageId: receipt?.id || null, receiptStatus: receipt ? 'Accepted by local mail sink' : null, lastError: error, leaseUntil: null, updatedAt: now }, $push: { history: { state, at: now, reason: error, sinkMessageId: receipt?.id || null } } }, { session });
    if (update.matchedCount !== 1) fail(409, 'STALE_DELIVERY_FENCE');
    if (delivery.draftId) await c(runtime, 'cs_resolution_drafts').updateOne({ ...scope(req), _id: delivery.draftId }, { $set: { status: state === 'SENT' || state === 'PREVIEWED' ? 'DISPATCHED' : state, deliveryState: display, deliveryProof: receipt?.id || null, updatedAt: now }, $inc: { version: 1 } }, { session });
    await audit(req, session, delivery.kind === 'DIGEST' ? 'DIGEST_DELIVERY_RESULT' : 'RESOLUTION_DELIVERY_RESULT', delivery._id, { deliveryId: delivery._id, deliveryState: display, sinkMessageId: receipt?.id || null, error });
    return deliveryView(await c(runtime, 'cs_outbox').findOne({ _id: delivery._id }, { session }));
  });
  const dispatch = async (req, deliveryId) => {
    const delivery = await tx(req, 'cs.automation.execute', async session => {
      const d = await c(runtime, 'cs_outbox').findOne({ ...scope(req), _id: deliveryId, origin: 'AUTOMATION' }, { session });
      if (!d) fail(404, 'NOT_FOUND');
      if(d.controlCommandId)fail(403,'EFFECT_WORKER_CAPABILITY_REQUIRED');
      if (!['QUEUED', 'FAILED'].includes(d.state)) return d;
      if (d.attempt >= 3) fail(409, 'DELIVERY_ATTEMPTS_EXHAUSTED', 'Three known-unsent attempts failed; operator review is required');
      const settingId = `${req.scope.tenantId}:${req.scope.selectedPlantId}`;
      await c(runtime, 'automation_settings').updateOne({ _id: settingId }, { $setOnInsert: { ...scope(req), paused: false } }, { session, upsert: true });
      const setting = await c(runtime, 'automation_settings').findOneAndUpdate({ _id: settingId, paused: false }, { $inc: { dispatchFence: 1 } }, { session, returnDocument: 'after' });
      if (!setting) fail(409, 'AUTOMATION_PAUSED');
      if (d.draftId) {
        const draft = await getDraft(req, d.draftId, session);
        if (!['APPROVED', 'FAILED'].includes(draft.status)) fail(409, 'DRAFT_NOT_APPROVED');
        await checkSource(req, draft, session, true);
      }
      const at = new Date();
      const claimed = await c(runtime, 'cs_outbox').findOneAndUpdate({ _id: d._id, state: d.state, fence: d.fence }, { $set: { state: 'SENDING', deliveryState: 'SENDING', leaseOwner: req.scope.userId, leaseUntil: new Date(at.getTime() + Number(cfg().leaseMs || 30000)), updatedAt: at }, $inc: { attempt: 1, fence: 1 }, $push: { history: { state: 'SENDING', at } } }, { session, returnDocument: 'after' });
      if (!claimed) fail(409, 'DELIVERY_ALREADY_CLAIMED');
      return { ...claimed, claimed: true };
    });
    if (!delivery.claimed) return { ...deliveryView(delivery), replayed: true };
    if (delivery.kind === 'RESOLUTION_PREVIEW') return finish(req, delivery, 'PREVIEWED');
    let submitted = false;
    try {
      await (cfg().submitMail || submitLocalMail)(delivery, cfg());
      submitted = true;
      await cfg().afterTransport?.(delivery);
      const receipt = await (cfg().verifyReceipt || verifiedSinkReceipt)(delivery, cfg());
      if (!receipt) return finish(req, delivery, 'UNKNOWN', null, 'SINK_RECEIPT_NOT_VERIFIED');
      return finish(req, delivery, 'SENT', receipt);
    } catch (error) {
      return finish(req, delivery, submitted || error.submitted ? 'UNKNOWN' : 'FAILED', null, submitted || error.submitted ? 'SUBMISSION_UNCERTAIN' : 'SMTP_UNAVAILABLE');
    }
  };
  const publishIntent=async(req,result)=>{
    if(!result[localIntent]){const row=await c(runtime,'cs_outbox').findOne({...scope(req),_id:result.deliveryId,origin:'AUTOMATION'});if(row?.controlCommandId){await effects.run(row.controlCommandId,row._id);return deliveryView(await c(runtime,'cs_outbox').findOne({_id:row._id,...scope(req)}));}return dispatch(req,result.deliveryId);}
    const row=await c(runtime,'cs_outbox').findOne({...scope(req),_id:result.deliveryId,origin:'AUTOMATION'});
    if(!row)fail(409,'DELIVERY_RECEIPT_SOURCE_MISSING');
    return deliveryView(row);
  };
  const recheckOperationSources=async(req,session,action,entityId,payload,previous,prepared)=>{
    if(action==='LOCAL_DELIVERY_RECONCILE'){
      const proof=observationProofs.get(prepared);if(!proof||JSON.stringify(proof.ids)!==JSON.stringify(payload.deliveryIds))fail(400,'LOCAL_OBSERVATION_PROOF_REQUIRED');
      for(const entry of proof.entries){
        await recheckDelivery(req,session,entry.delivery._id,{});
        const d=await c(runtime,'cs_outbox').findOne({...scope(req),_id:entry.delivery._id,origin:'AUTOMATION'},{session});
        const intent=await c(runtime,'automation_audit_logs').findOne({...scope(req),action:{$in:['RESOLUTION_DISPATCH_INTENT','DIGEST_DISPATCH_INTENT']},'result.deliveryId':d._id,idempotencyKey:{$type:'string'},payloadHash:{$type:'string'}},{session});
        if(!intent)fail(409,'LOCAL_INTENT_RECEIPT_REQUIRED');
        if(intent.action==='RESOLUTION_DISPATCH_INTENT'?(intent.targetEntity?.id!==d.draftId||intent.result.draftId!==d.draftId||intent.payloadHash!==digest({draftId:d.draftId})||d.actionKey!==`automation:resolution:${d.draftId}`):(intent.payloadHash!==digest({mode:intent.result.mode,periodKey:intent.result.periodKey})||intent.targetEntity?.id!==d.actionKey||d.actionKey!==`automation:digest:${d.plantId}:${intent.result.mode}:${intent.result.periodKey}:reports@iems.local`))fail(409,'LOCAL_INTENT_RECEIPT_INVALID');
        if(d.draftId)await checkSource(req,await getDraft(req,d.draftId,session),session,true);else if(d.kind!=='DIGEST'||d.recipient!=='reports@iems.local')fail(409,'SOURCE_BINDING_CHANGED');
        if(previous){const saved=previous.items?.find(x=>x.deliveryId===d._id);if(!saved||saved.proofHash!==entry.proofHash)fail(409,'LOCAL_OBSERVATION_EVIDENCE_CHANGED');}
        else if(observationFingerprint(d)!==observationFingerprint(entry.delivery))fail(409,'LOCAL_OBSERVATION_SOURCE_CHANGED');
      }
    }
    if(administrativeActions[action]) {
      await human(req,administrativeActions[action],session);
      if(action==='AUTOMATION_PAUSE'&&entityId!==req.scope.selectedPlantId)fail(403,'SCOPE_DENIED');
      if(action.startsWith('RESOLUTION_')){
        const draft=await getDraft(req,entityId,session),ticket=await c(runtime,'cs_tickets').findOneAndUpdate({...scope(req),_id:draft.ticketId},{$inc:{automationFence:1}},{session,returnDocument:'after'});
        if(!ticket||ticket.customerId!==draft.customerId||ticket.bindingId!==draft.bindingId||draft.approvalHash!==approvedHash(draft))fail(409,'SOURCE_BINDING_CHANGED');
        await sourceBinding(req,ticket,session,draft.bindingVersion);
        if(previous&&['ticketId','expectedTicketVersion','bindingId','bindingVersion','customerId','approvalHash','recipient','channel'].some(k=>previous[k]!==draft[k]))fail(409,'APPROVAL_CONTENT_CHANGED');
        if(action==='RESOLUTION_APPROVE')await checkSource(req,previous??draft,session,true);
      }
      if(action==='DELIVERY_MANUAL_REVIEW'){
        await recheckDelivery(req,session,entityId,{});const d=await c(runtime,'cs_outbox').findOne({...scope(req),_id:entityId},{session});
        if(d.draftId)await checkSource(req,await getDraft(req,d.draftId,session),session,true);else if(d.kind!=='DIGEST'||d.recipient!=='reports@iems.local')fail(409,'SOURCE_BINDING_CHANGED');
      }
      if(action==='SERVICE_CREDENTIAL_ISSUE'){
        const plant=await c(runtime,'plants').findOneAndUpdate({_id:req.scope.selectedPlantId,tenantId:req.scope.tenantId,active:true},{$inc:{credentialFence:1}},{session,returnDocument:'after'});if(!plant)fail(404,'NOT_FOUND');
        if(previous)await credentialSource(req,session,previous.sessionId,previous);
      }
      if(action==='SERVICE_CREDENTIAL_REVOKE')await credentialSource(req,session,entityId);
    }
    if(action==='TICKET_ESCALATE'||action==='RESOLUTION_DRAFT_CREATE'){
      const ticket=await c(runtime,'cs_tickets').findOneAndUpdate({...scope(req),_id:entityId},{$inc:{automationFence:1}},{session,returnDocument:'after'});
      if(!ticket)fail(404,'NOT_FOUND');
      if(action==='RESOLUTION_DRAFT_CREATE')await sourceBinding(req,ticket,session);
      else if(ticket.bindingId){
        // SLA escalation has no transport/channel policy; retain the ticket's actual binding authority.
        const binding=await c(runtime,'cs_contact_bindings').findOneAndUpdate({...scope(req),_id:ticket.bindingId,customerId:ticket.customerId,status:'ACTIVE',$or:[{expiresAt:null},{expiresAt:{$gt:new Date()}}]},{$inc:{automationFence:1}},{session,returnDocument:'after'});
        if(!binding)fail(409,'SOURCE_BINDING_INELIGIBLE');
      }
      if(!previous&&action==='TICKET_ESCALATE'){
        if(ticket.version!==payload.expectedVersion)fail(409,'VERSION_CONFLICT');
        if(!eligible(ticket))fail(409,'ELIGIBILITY_CHECK_FAILED');
      }
      if(!previous&&action==='RESOLUTION_DRAFT_CREATE'&&(ticket.stage!=='RESOLVED'||ticket.version!==payload.expectedTicketVersion))fail(409,'RESOLVED_TICKET_REQUIRED');
      if(action==='TICKET_ESCALATE'&&previous){
        const task=await c(runtime,'automation_tasks').findOne({...scope(req),kind:'SLA',ticketId:entityId,state:'COMPLETED',policyVersion:policy().version,occurrence:`${entityId}:${policy().version}`},{session});
        const note=await c(runtime,'cs_internal_notes').findOne({...scope(req),_id:previous.noteId,ticketId:entityId},{session});
        if(!task||!note||!ticket.isEscalated)fail(409,'ESCALATION_SOURCE_CHANGED');
      }
      if(action==='RESOLUTION_DRAFT_CREATE'&&previous){
        const draft=await getDraft(req,previous.draftId,session);
        if(draft.ticketId!==ticket._id||draft.bindingId!==ticket.bindingId||draft.customerId!==ticket.customerId||draft.approvalHash!==approvedHash(draft))fail(409,'SOURCE_BINDING_CHANGED');
        await sourceBinding(req,ticket,session,draft.bindingVersion);
      }
    }
    if(action==='RESOLUTION_DISPATCH_INTENT'){
      const draft=await getDraft(req,entityId,session);
      if(!['APPROVED','FAILED','DISPATCHED','QUEUED','UNKNOWN'].includes(draft.status))fail(409,'DRAFT_NOT_APPROVED');
      await checkSource(req,draft,session,true);
      if(previous)await recheckDelivery(req,session,previous.deliveryId,{draftId:draft._id,ticketId:draft.ticketId,bindingId:draft.bindingId,recipient:draft.recipient,body:draft.proposedResolution,kind:draft.channel==='EMAIL'?'RESOLUTION':'RESOLUTION_PREVIEW'});
    }
    if(action==='DIGEST_DISPATCH_INTENT'&&previous)await recheckDelivery(req,session,previous.deliveryId,{recipient:'reports@iems.local',kind:'DIGEST',actionKey:entityId});
  };
  const credentialSource=async(req,session,sessionId,expected)=>{
    const row=await c(runtime,'sessions').findOneAndUpdate({_id:sessionId,tenantId:req.scope.tenantId,selectedPlantId:req.scope.selectedPlantId,automationService:true},{$inc:{credentialFence:1}},{session,returnDocument:'after'});
    if(!row||expected&&(row.userId!==expected.userId||row.membershipId!==expected.membershipId||row.label!==expected.label||new Date(row.expiresAt).toISOString()!==new Date(expected.expiresAt).toISOString()))fail(404,'NOT_FOUND');
    const member=await c(runtime,'memberships').findOne({_id:row.membershipId,userId:row.userId,tenantId:req.scope.tenantId,active:true},{session});const user=await c(runtime,'users').findOne({_id:row.userId,active:true},{session});
    if(!member||!user||!member.plantIds.includes(req.scope.selectedPlantId)||!member.roles.some(r=>r.role==='automationService'))fail(403,'SOURCE_AUTHORITY_CHANGED');return row;
  };
  const recheckDelivery=async(req,session,deliveryId,expected)=>{
    const d=await c(runtime,'cs_outbox').findOneAndUpdate({...scope(req),_id:deliveryId,origin:'AUTOMATION'},{$inc:{automationFence:1}},{session,returnDocument:'after'});
    if(!d||Object.entries(expected).some(([k,v])=>d[k]!==v)||d.contentHash!==hashText(d.body.trim())||d.payloadHash!==digest({to:d.recipient,subject:d.subject,body:d.kind==='DIGEST'&&d.summary?.previewCount===0?d.body+'\n':d.body}))fail(409,'DELIVERY_RECEIPT_SOURCE_CHANGED');
  };
  const observationFingerprint=d=>digest({id:d._id,state:d.state,fence:d.fence,attempt:d.attempt,leaseUntil:d.leaseUntil?new Date(d.leaseUntil).toISOString():null,updatedAt:d.updatedAt?new Date(d.updatedAt).toISOString():null,contentHash:d.contentHash,payloadHash:d.payloadHash,recipient:d.recipient,draftId:d.draftId});
  const localObserve=async(req)=>{
    fields(req.body,['mode','deliveryIds']);
    if(req.body.mode!=='LOCAL_OBSERVE_V1'||!Array.isArray(req.body.deliveryIds)||req.body.deliveryIds.length<1||req.body.deliveryIds.length>100||new Set(req.body.deliveryIds).size!==req.body.deliveryIds.length)fail(400,'INVALID_LOCAL_OBSERVATION');
    const ids=req.body.deliveryIds.map(id).sort(),payload={mode:'LOCAL_OBSERVE_V1',deliveryIds:ids},idem=key(req);
    await auth(req,'cs.automation.execute');
    const previous=await c(runtime,'automation_audit_logs').findOne({tenantId:req.scope.tenantId,idempotencyKey:idem});
    if(previous&&(previous.plantId!==req.scope.selectedPlantId||previous.action!=='LOCAL_DELIVERY_RECONCILE'||previous.targetEntity?.id!==req.scope.selectedPlantId||previous.payloadHash!==digest(payload)))fail(409,'IDEMPOTENCY_CONFLICT');
    localUrl(cfg().sinkUrl||process.env.IEMS_AUTOMATION_SINK_URL,'http://127.0.0.1:8027');
    const entries=[];
    for(const deliveryId of ids){
      const delivery=await c(runtime,'cs_outbox').findOne({...scope(req),_id:deliveryId,origin:'AUTOMATION'});if(!delivery)fail(404,'NOT_FOUND');
      if(!/^[a-z0-9._+-]+@iems\.local$/.test(delivery.recipient)||typeof delivery.body!=='string'||Buffer.byteLength(delivery.body)>65536||delivery.contentHash!==hashText(delivery.body.trim()))fail(409,'LOCAL_OBSERVATION_SOURCE_INVALID');
      const sinkBase=localUrl(cfg().sinkUrl||process.env.IEMS_AUTOMATION_SINK_URL,'http://127.0.0.1:8027'),sinkToken=cfg().sinkToken||process.env.IEMS_AUTOMATION_SINK_TOKEN;
      let receipt=null,supported=Boolean(sinkToken);
      if(supported){
        const response=await fetch(sinkBase+'/api/emails?messageId='+encodeURIComponent(delivery.messageId),{headers:{authorization:'Bearer '+sinkToken},signal:AbortSignal.timeout(2000),redirect:'error'});
        if(response.status===401||response.status===403)fail(403,'LOCAL_EVIDENCE_AUTH_DENIED');if(!response.ok)fail(503,'LOCAL_EVIDENCE_UNAVAILABLE');
        const raw=await response.text();if(raw.length>524288)fail(409,'LOCAL_EVIDENCE_TOO_LARGE');let data;try{data=JSON.parse(raw).data;}catch{fail(409,'LOCAL_EVIDENCE_INVALID');}
        if(data===undefined)fail(409,'LOCAL_EVIDENCE_INVALID');const candidates=Array.isArray(data)?data:data?[data]:[];
        if(candidates.length){receipt=await verifiedSinkReceipt(delivery,cfg());if(!receipt)fail(409,'LOCAL_RECEIPT_INTEGRITY_FAILED');}
      }
      const proofHash=digest({deliveryId,tenantId:delivery.tenantId,plantId:delivery.plantId,contentHash:delivery.contentHash,recipient:delivery.recipient,messageId:delivery.messageId,receiptId:receipt?.id??null});
      entries.push(Object.freeze({delivery:Object.freeze(delivery),receipt:receipt?Object.freeze({id:receipt.id}):null,supported,proofHash}));
    }
    const prepared=Object.freeze({});observationProofs.set(prepared,Object.freeze({ids:Object.freeze(ids),entries:Object.freeze(entries)}));
    return operation(req,'LOCAL_DELIVERY_RECONCILE',req.scope.selectedPlantId,payload,async session=>{
      const items=[];
      for(const entry of entries){
        const d=entry.delivery,at=new Date();let state=d.state,observation='UNKNOWN',reason='NO_AUTHORITATIVE_LOCAL_RECEIPT',set=null;
        if(!entry.supported){observation='UNSUPPORTED_EVIDENCE';reason='LOCAL_SINK_AUTHORITY_NOT_CONFIGURED';}
        else if(!['SENDING','UNKNOWN','SENT'].includes(d.state)){observation='UNSUPPORTED_EVIDENCE';reason='NO_SUBMISSION_STATE';}
        else if(entry.receipt){state='SENT';observation='OBSERVED_LOCAL';reason=null;if(d.state!=='SENT')set={state:'SENT',deliveryState:'ACCEPTED_LOCAL',providerMessageId:entry.receipt.id,receiptStatus:'Accepted by local mail sink',lastError:null,leaseUntil:null,updatedAt:at};else if(d.providerMessageId!==entry.receipt.id)fail(409,'LOCAL_RECEIPT_CONFLICT');}
        else if(d.state==='SENDING'&&d.leaseUntil&&new Date(d.leaseUntil)<=at){state='UNKNOWN';set={state:'UNKNOWN',deliveryState:'UNKNOWN',leaseUntil:null,lastError:'LEASE_EXPIRED',updatedAt:at};reason='LEASE_EXPIRED_NO_VERIFIED_RECEIPT';}
        if(set){const changed=await c(runtime,'cs_outbox').updateOne({...scope(req),_id:d._id,origin:'AUTOMATION',state:d.state,fence:d.fence,leaseUntil:d.leaseUntil,updatedAt:d.updatedAt},{$set:set,$push:{history:{state,at,reason,sinkMessageId:entry.receipt?.id??null,observation:'LOCAL_OBSERVE_V1'}}},{session});if(changed.matchedCount!==1)fail(409,'STALE_DELIVERY_FENCE');
          if(d.draftId){const draft=await getDraft(req,d.draftId,session);const update=await c(runtime,'cs_resolution_drafts').updateOne({...scope(req),_id:d.draftId,version:draft.version},{$set:{status:state==='SENT'?'DISPATCHED':'UNKNOWN',deliveryState:set.deliveryState,deliveryProof:entry.receipt?.id??null,updatedAt:at},$inc:{version:1}},{session});if(update.matchedCount!==1)fail(409,'STALE_DRAFT');}
        }
        items.push({deliveryId:d._id,state,observation,reason,receiptId:entry.receipt?.id??null,proofHash:entry.proofHash});
      }
      return {mode:'LOCAL_OBSERVE_V1',items};
    },'cs.automation.execute',prepared);
  };
  const buildDigest = async (req, session) => {
    const filter = scope(req), now = new Date(), from = new Date(now.getTime() - 7 * 86400000);
    const [created, resolved, escalations, count, unassigned, open] = await (async()=>{const rows=[];for(const read of [
      ()=>c(runtime, 'cs_tickets').countDocuments({ ...filter, createdAt: { $gte: from, $lt: now } }, { session }),
      ()=>c(runtime, 'cs_tickets').countDocuments({ ...filter, resolvedAt: { $gte: from, $lt: now } }, { session }),
      ()=>c(runtime, 'automation_audit_logs').countDocuments({ ...filter, action: 'TICKET_ESCALATE', occurredAt: { $gte: from, $lt: now } }, { session }),
      ()=>c(runtime, 'cs_tickets').countDocuments({ ...filter, stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }, { session }),
      ()=>c(runtime, 'cs_tickets').countDocuments({ ...filter, stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null }, { session }),
      ()=>c(runtime, 'cs_tickets').find({ ...filter, stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }, { session }).sort({ createdAt: 1 }).limit(20).toArray()
    ])rows.push(await read());return rows;})();
    const overdue = await c(runtime, 'cs_tickets').countDocuments({ ...filter, stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null, createdAt: { $lte: new Date(now.getTime() - policy().minutes * 60000) } }, { session });
    const summary = { periodDays: 7, since: from.toISOString(), until: now.toISOString(), timezone: 'UTC', ticketsCreated: created, ticketsResolved: resolved, escalationsTriggered: escalations, currentlyOpenCount: count, unassignedCount: unassigned, overdueCount: overdue, previewCount: open.length, slaComplianceRatePercent: null, slaMetricState: 'NO_DATA', slaMetricDefinition: 'Compliance is not measured by escalation-to-created ratios' };
    const markdown = `# IEMS CS digest\nUTC window: ${summary.since} to ${summary.until}\nOpen: ${count}\nUnassigned: ${unassigned}\nOverdue: ${overdue}\nCreated: ${created}\nResolved: ${resolved}\nSLA compliance: Not measured\nPreview: first ${open.length} of ${count} open tickets\n${open.map(t => `Ticket #${t.ticketNumber}: ${t.stage}`).join('\n')}`;
    return { summary, markdown, html: `<pre>${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` };
  };
  const resolutionIntent = (req, draftId) => operation(req, 'RESOLUTION_DISPATCH_INTENT', draftId, { draftId }, async session => {
    const draft = await getDraft(req, draftId, session);
    if (draft.status !== 'APPROVED') fail(409, 'DRAFT_NOT_APPROVED');
    await checkSource(req, draft, session, true);
    const delivery = await enqueue(req, session, { actionKey: `automation:resolution:${draftId}`, kind: draft.channel === 'EMAIL' ? 'RESOLUTION' : 'RESOLUTION_PREVIEW', draft, recipient: draft.recipient, subject: `Resolution update for ticket ${draft.ticketId}`, body: draft.proposedResolution });
    return { draftId, deliveryId: delivery._id };
  });

  app.post('/api/cs/automation/service-credentials', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, ['label', 'ttlMinutes']);
    const label = text(req.body.label || 'n8n local orchestrator', 80), ttlMinutes = Number(req.body.ttlMinutes ?? 60);
    if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) fail(400, 'INVALID_EXPIRY');
    let secret;
    const out=await adminOperation(req,'SERVICE_CREDENTIAL_ISSUE','service-credential:create',{label,ttlMinutes},async session=>{
      const grant=await auth(req,'cs.automation.admin',session),plant=await c(runtime,'plants').findOne({_id:req.scope.selectedPlantId,tenantId:req.scope.tenantId,active:true},{session});
      if(!plant||plant.legalEntityId!==grant.legalEntityId)fail(404,'NOT_FOUND');
      const userId=randomUUID(),membershipId=randomUUID(),sessionId=randomUUID(),token=randomBytes(32).toString('base64url'),createdAt=new Date(),expiresAt=new Date(createdAt.getTime()+ttlMinutes*60000);secret=token;
      await c(runtime,'users').insertOne({_id:userId,active:true,version:1},{session});
      await c(runtime,'memberships').insertOne({_id:membershipId,tenantId:req.scope.tenantId,userId,legalEntityIds:[plant.legalEntityId],plantIds:[plant._id],tenantWide:false,roles:[{role:'automationService',plantIds:[plant._id],tenantWide:false}],active:true,version:1},{session});
      await c(runtime,'sessions').insertOne({_id:sessionId,userId,tenantId:req.scope.tenantId,selectedPlantId:plant._id,membershipId,membershipVersion:1,tokenHash:hashText(token),expiresAt,revoked:false,automationService:true,label},{session});
      await c(runtime,'audit').insertOne({_id:randomUUID(),tenantId:req.scope.tenantId,kind:'sessions.issued',subjectId:sessionId,occurredAt:createdAt},{session});
      return {sessionId,userId,membershipId,label,expiresAt:expiresAt.toISOString(),deliveryProtocol:'ONE_TIME_NO_RECOVERY_V1'};
    });
    res.set('Cache-Control','no-store');res.status(out.replayed?200:201).json({data:{...out,...(!out.replayed?{token:secret}:{tokenAvailable:false,recovery:'REVOKE_AND_REISSUE'}),scope:scope(req),grants:['cs.automation.read','cs.automation.execute']}});
  });
  app.post('/api/cs/automation/service-credentials/:id/revoke',async(req,res)=>{
    await human(req,'cs.automation.admin');fields(req.body,[]);const sessionId=id(req.params.id);
    const result=await adminOperation(req,'SERVICE_CREDENTIAL_REVOKE',sessionId,{},async session=>{
      await credentialSource(req,session,sessionId);
      const changed=await c(runtime,'sessions').updateOne({_id:sessionId,tenantId:req.scope.tenantId,selectedPlantId:req.scope.selectedPlantId,automationService:true,revoked:false},{$set:{revoked:true}},{session});if(changed.matchedCount!==1)fail(404,'NOT_FOUND');
      await c(runtime,'audit').insertOne({_id:randomUUID(),tenantId:req.scope.tenantId,kind:'sessions.revoked',subjectId:sessionId,occurredAt:new Date()},{session});return {sessionId,revoked:true};
    });res.json({data:result});
  });
  app.get('/api/cs/automation/status', async (req, res) => {
    await auth(req);
    const n8nUrl = localUrl(cfg().n8nUrl || process.env.IEMS_AUTOMATION_N8N_URL, 'http://127.0.0.1:5687');
    const sinkUrl = localUrl(cfg().sinkUrl || process.env.IEMS_AUTOMATION_SINK_URL, 'http://127.0.0.1:8027');
    const healthy = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(600), redirect: 'error' })).ok; } catch { return false; } };
    const [engineUp, sinkUp, audits, success, digests, open, pending] = await Promise.all([healthy(`${n8nUrl}/healthz`), healthy(`${sinkUrl}/health`), c(runtime, 'automation_audit_logs').countDocuments(scope(req)), c(runtime, 'automation_audit_logs').countDocuments({ ...scope(req), status: 'SUCCESS' }), c(runtime, 'cs_outbox').countDocuments({ ...scope(req), origin: 'AUTOMATION', kind: 'DIGEST', state: 'SENT' }), c(runtime, 'cs_tickets').countDocuments({ ...scope(req), stage: { $nin: ['RESOLVED', 'CLOSED', 'CANCELLED'] } }), c(runtime, 'cs_resolution_drafts').countDocuments({ ...scope(req), status: 'PENDING_APPROVAL' })]);
    const setting = await c(runtime, 'automation_settings').findOne({ _id: `${req.scope.tenantId}:${req.scope.selectedPlantId}` });
    const observed = await Promise.all(workflows.map(async workflow => {
      const [engineRun, domainEffect] = await Promise.all([
        c(runtime, 'automation_engine_runs').find({ ...scope(req), workflowId: workflow.id }).sort({ observedAt: -1, completedAt: -1, startedAt: -1 }).limit(1).next(),
        c(runtime, 'automation_audit_logs').find({ ...scope(req), workflowId: workflow.id, executionId: { $type: 'string' } }).sort({ occurredAt: -1 }).limit(1).next()
      ]);
      const engineAt = engineRun ? new Date(engineRun.observedAt || engineRun.completedAt || engineRun.startedAt).getTime() : 0;
      if (domainEffect && new Date(domainEffect.occurredAt).getTime() > engineAt) return { workflowId: workflow.id, executionId: domainEffect.executionId, state: ['FAILED', 'UNKNOWN'].includes(domainEffect.status) ? domainEffect.status : 'DOMAIN_EFFECT_RECORDED', completedAt: domainEffect.occurredAt, observationSource: 'IEMS_DOMAIN_AUDIT', result: domainEffect.result };
      return engineRun;
    }));
    const capturedCount = await c(runtime, 'cs_outbox').countDocuments({ ...scope(req), origin: 'AUTOMATION', state: 'SENT', deliveryState: 'ACCEPTED_LOCAL' });
    res.json({ data: { engine: { n8n: { status: engineUp ? 'HEALTHY' : 'DOWN', url: n8nUrl, mode: 'STANDALONE_SQLITE', loopbackOnly: true }, smtpSink: { status: sinkUp ? 'HEALTHY' : 'DOWN', port: Number(cfg().smtpPort || process.env.IEMS_AUTOMATION_SMTP_PORT || 2527), httpPort: Number(new URL(sinkUrl).port), capturedCount, receiptGuarantee: 'Accepted by local mail sink' } }, workflows: workflows.map(w => { const lastRun = observed.find(r => r?.workflowId === w.id) || null; return { ...w, state: setting?.paused ? 'PAUSED' : lastRun?.state || 'NOT_OBSERVED', lastRun }; }), paused: !!setting?.paused, policy: { ...policy(), label: policy().minutes < 15 ? 'Demo SLA' : 'Unassigned SLA' }, metrics: { openTicketsCount: open, totalAutomationsExecuted: audits, successfulAutomations: success, digestsGenerated: digests, pendingDraftsCount: pending } } });
  });
  app.post('/api/cs/automation/pause', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, ['paused']);
    if (typeof req.body.paused !== 'boolean') fail(400, 'INVALID_STATE');
    const result=await adminOperation(req,'AUTOMATION_PAUSE',req.scope.selectedPlantId,{paused:req.body.paused},async session=>{await c(runtime,'automation_settings').updateOne({_id:`${req.scope.tenantId}:${req.scope.selectedPlantId}`},{$set:{...scope(req),paused:req.body.paused,updatedAt:new Date()}},{session,upsert:true});return {paused:req.body.paused};});
    res.json({data:result});
  });
  app.get('/api/cs/automation/sla-breaches', async (req, res) => {
    await auth(req);
    const now = new Date(), p = policy();
    const [due, totalBreached] = await Promise.all([schedule(req), c(runtime, 'cs_tickets').countDocuments(dueTicketFilter(req, now, p.minutes))]);
    const items = due.map(t => ({ ticketId: t._id, ticketNumber: t.ticketNumber, stage: t.stage, expectedVersion: t.version, createdAt: t.createdAt, dueAt: new Date(new Date(t.createdAt).getTime() + p.minutes * 60000), ageMinutes: Math.floor((now.getTime() - new Date(t.createdAt)) / 60000), thresholdMinutes: p.minutes, policyVersion: p.version, occurrenceKey: `sla:${t._id}:${p.version}`, assigneeId: null, slaStatus: 'BREACHED' }));
    res.json({ data: { totalBreached, thresholdMinutes: p.minutes, items } });
  });
  app.post('/api/cs/automation/recheck', async (req, res) => {
    await auth(req); fields(req.body, ['ticketId', 'expectedVersion', 'action']);
    const ticket = await c(runtime, 'cs_tickets').findOne({ ...scope(req), _id: id(req.body.ticketId) });
    const ready = eligible(ticket) && ticket.version === req.body.expectedVersion;
    res.json({ data: { ticketId: req.body.ticketId, eligible: ready, status: ready ? 'READY_FOR_EXECUTION' : ticket && ticket.version !== req.body.expectedVersion ? 'STALE_VERSION' : 'INELIGIBLE_STAGE', reason: ready ? 'SLA_BREACH_CONFIRMED_ELIGIBLE' : 'AUTHORITATIVE_ELIGIBILITY_FAILED', currentStage: ticket?.stage, currentVersion: ticket?.version } });
  });
  app.post('/api/cs/automation/escalate', async (req, res) => {
    fields(req.body, ['ticketId', 'expectedVersion', 'reason']);
    const ticketId = id(req.body.ticketId), expectedVersion = version(req.body.expectedVersion), reason = text(req.body.reason || 'Unassigned ticket SLA breached', 500);
    await auth(req, 'cs.automation.execute');
    const result = await operation(req, 'TICKET_ESCALATE', ticketId, { ticketId, expectedVersion, reason }, async session => {
      const ticket = await c(runtime, 'cs_tickets').findOne({ ...scope(req), _id: ticketId }, { session });
      if (!ticket) fail(404, 'NOT_FOUND');
      if (ticket.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!eligible(ticket)) fail(409, 'ELIGIBILITY_CHECK_FAILED');
      const p=policy(); if(!(p.minutes>=0&&p.minutes<=1440))fail(503,'INVALID_SLA_POLICY');
      const occurrence=`${ticketId}:${p.version}`;
      await c(runtime,'automation_tasks').updateOne({...scope(req),kind:'SLA',occurrence},{$setOnInsert:{_id:randomUUID(),...scope(req),kind:'SLA',occurrence,ticketId,dueAt:new Date(new Date(ticket.createdAt).getTime()+p.minutes*60000),policyVersion:p.version,policyMinutes:p.minutes,state:'PENDING',createdAt:new Date()}},{session,upsert:true});
      const task=await c(runtime,'automation_tasks').findOne({...scope(req),kind:'SLA',occurrence,state:'PENDING',dueAt:{$lte:new Date()},policyMinutes:p.minutes},{session});
      if(!task)fail(409,'ELIGIBILITY_CHECK_FAILED');
      const at = new Date();
      const changed = await c(runtime, 'cs_tickets').updateOne({ ...scope(req), _id: ticketId, version: expectedVersion, stage: { $in: ['NEW', 'TRIAGED'] }, assigneeId: null, assignedUserId: null, isEscalated: { $ne: true } }, { $set: { priority: 'URGENT', isEscalated: true, escalatedAt: at, slaBreached: true, requiresHuman: true, updatedAt: at }, $inc: { version: 1 } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await c(runtime, 'automation_tasks').updateOne({ _id: task._id, state: 'PENDING' }, { $set: { state: 'COMPLETED', completedAt: at } }, { session });
      const noteId = randomUUID();
      await c(runtime, 'cs_internal_notes').insertOne({ _id: noteId, ...scope(req), ticketId, authorUserId: req.scope.userId, text: `[AUTOMATED SLA ESCALATION] ${reason}. Stage remains ${ticket.stage}.`, createdAt: at }, { session });
      await c(runtime, 'cs_ticket_events').insertOne({ _id: randomUUID(), ...scope(req), ticketId, kind: 'SLA_ESCALATED', visibility: 'INTERNAL', fromStage: ticket.stage, toStage: ticket.stage, version: expectedVersion + 1, actor: { type: 'AUTOMATION', userId: req.scope.userId }, reason, at }, { session });
      return { ticketId, ticketNumber: ticket.ticketNumber, previousStage: ticket.stage, newStage: ticket.stage, stage: ticket.stage, priority: 'URGENT', isEscalated: true, version: expectedVersion + 1, escalatedAt: at.toISOString(), noteId };
    });
    res.json({ data: result });
  });
  app.post('/api/cs/automation/resolution-draft', async (req, res) => {
    fields(req.body, ['ticketId', 'expectedTicketVersion', 'channel', 'recipient', 'proposedResolution']);
    const payload = { ticketId: id(req.body.ticketId), expectedTicketVersion: version(req.body.expectedTicketVersion), channel: req.body.channel, recipient: recipient(req.body.recipient), proposedResolution: text(req.body.proposedResolution) };
    if (!['EMAIL', 'SIMULATED'].includes(payload.channel)) fail(400, 'INVALID_CHANNEL');
    const out = await operation(req, 'RESOLUTION_DRAFT_CREATE', payload.ticketId, payload, async session => {
      const ticket = await c(runtime, 'cs_tickets').findOneAndUpdate({ ...scope(req), _id: payload.ticketId, stage: 'RESOLVED', version: payload.expectedTicketVersion }, { $inc: { automationFence: 1 } }, { session, returnDocument: 'after' });
      if (!ticket) fail(409, 'RESOLVED_TICKET_REQUIRED', 'Resolve the ticket through its domain transition before drafting a resolution update');
      const binding = await sourceBinding(req, ticket, session);
      const now = new Date(), row = { _id: randomUUID(), ...scope(req), ...payload, customerId: ticket.customerId, conversationId: ticket.conversationId || null, bindingId: binding._id, bindingVersion: binding.version, recipientPolicy: 'SYNTHETIC_LOCAL_OPERATOR_APPROVAL', version: 1, status: 'PENDING_APPROVAL', expiresAt: new Date(now.getTime() + 7200000), createdAt: now, updatedAt: now };
      row.approvalHash = approvedHash(row);
      await c(runtime, 'cs_resolution_drafts').insertOne(row, { session });
      return { ...row, draftId: row._id };
    });
    res.status(out.replayed ? 200 : 201).json({ data: out });
  });
  app.get('/api/cs/automation/resolution-drafts', async (req, res) => { await auth(req); res.json({ data: await c(runtime, 'cs_resolution_drafts').find(scope(req)).sort({ createdAt: -1 }).limit(100).toArray() }); });
  app.get('/api/cs/automation/resolution-drafts/:id', async (req, res) => { await auth(req); res.json({ data: await getDraft(req, req.params.id) }); });
  for (const decision of ['approve', 'reject', 'cancel']) app.post(`/api/cs/automation/resolution-drafts/:id/${decision}`, async (req, res) => {
    await human(req); fields(req.body, ['expectedVersion', 'reason']);
    const expectedVersion=version(req.body.expectedVersion),reason=req.body.reason?text(req.body.reason,300):null;
    const out = await adminOperation(req,'RESOLUTION_'+decision.toUpperCase(),id(req.params.id),{expectedVersion,reason},async session => {
      await human(req, 'cs.ticket.write', session);
      const draft = await getDraft(req, req.params.id, session), expected = version(req.body.expectedVersion);
      if (draft.version !== expected) fail(409, 'VERSION_CONFLICT');
      if (decision === 'approve') { if (draft.status !== 'PENDING_APPROVAL') fail(409, 'DRAFT_NOT_PENDING'); await checkSource(req, draft, session, true); }
      else if (!['PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(draft.status)) fail(409, 'INVALID_DRAFT_STATUS');
      const status = { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }[decision], now = new Date();
      const changed = await c(runtime, 'cs_resolution_drafts').findOneAndUpdate({ _id: draft._id, version: expected, status: draft.status }, { $set: { status, approvedBy: decision === 'approve' ? req.scope.userId : null, approvedMembershipId: decision === 'approve' ? req.scope.membershipId : null, approvedMembershipVersion: decision === 'approve' ? req.scope.membershipVersion : null, approvedAt: decision === 'approve' ? now : null, decisionReason: req.body.reason ? text(req.body.reason, 300) : null, updatedAt: now }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
      if (!changed) fail(409, 'VERSION_CONFLICT');
      if (decision !== 'approve') {
        const sending = await c(runtime, 'cs_outbox').findOne({ ...scope(req), draftId: draft._id, origin: 'AUTOMATION', state: { $in: ['SENDING', 'UNKNOWN', 'SENT'] } }, { session });
        if (sending) fail(409, 'DELIVERY_ALREADY_SUBMITTED', 'Reconcile the in-flight delivery before cancellation');
        await c(runtime, 'cs_outbox').updateMany({ ...scope(req), draftId: draft._id, origin: 'AUTOMATION', state: { $in: ['QUEUED', 'FAILED'] } }, { $set: { state: 'CANCELLED', deliveryState: 'CANCELLED', updatedAt: now } }, { session });
      }
      await audit(req, session, `RESOLUTION_DRAFT_${status}`, draft._id, { draftId: draft._id, status, version: changed.version });
      return { ...changed, draftId: changed._id };
    });
    res.json({ data: out });
  });
  app.post('/api/cs/automation/resolution-drafts/:id/dispatch', async (req, res) => {
    fields(req.body, []);
    const draftId = id(req.params.id);
    const result = await resolutionIntent(req, draftId);
    res.json({ data: { ...result, ...await publishIntent(req, result) } });
  });
  app.get('/api/cs/automation/digest', async (req, res) => { await auth(req); res.json({ data: await buildDigest(req) }); });
  app.post('/api/cs/automation/digest/dispatch', async (req, res) => {
    fields(req.body, ['mode', 'periodKey']);
    const mode = req.body.mode || 'WEEKLY';
    if (!['WEEKLY', 'DEMO'].includes(mode)) fail(400, 'INVALID_DIGEST_MODE');
    const now = new Date(), week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
    const periodKey = mode === 'WEEKLY' ? week : text(req.body.periodKey || key(req), 100);
    if (!/^[A-Za-z0-9:_-]{1,100}$/.test(periodKey)) fail(400, 'INVALID_PERIOD');
    if (mode === 'WEEKLY' && req.body.periodKey && req.body.periodKey !== week) fail(400, 'INVALID_PERIOD');
    const actionKey = `automation:digest:${req.scope.selectedPlantId}:${mode}:${periodKey}:reports@iems.local`;
    const result = await operation(req, 'DIGEST_DISPATCH_INTENT', actionKey, { mode, periodKey }, async session => {
      const content = await buildDigest(req, session);
      const delivery = await enqueue(req, session, { actionKey, kind: 'DIGEST', recipient: 'reports@iems.local', subject: `IEMS ${mode === 'DEMO' ? 'demo' : 'weekly'} CS digest ${periodKey}`, body: content.markdown, summary: content.summary });
      return { deliveryId: delivery._id, mode, periodKey };
    });
    res.json({ data: { ...result, ...await publishIntent(req, result) } });
  });
  app.post('/api/cs/automation/digest/record', async (req, res) => { await auth(req, 'cs.automation.execute'); fail(400, 'CALLER_RECEIPT_NOT_TRUSTED', 'Use the authoritative digest dispatch operation'); });
  app.get('/api/cs/automation/deliveries', async (req, res) => { await auth(req); res.json({ data: (await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION' }).sort({ createdAt: -1 }).limit(100).toArray()).map(deliveryView) }); });
  app.get('/api/cs/automation/sink-messages', async (req, res) => {
    await auth(req);
    const rows = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: 'SENT', deliveryState: 'ACCEPTED_LOCAL' }).sort({ updatedAt: -1 }).limit(100).toArray();
    const verified = [];
    for (const row of rows) { try { const receipt = await (cfg().verifyReceipt || verifiedSinkReceipt)(row, cfg()); if (receipt) verified.push({ ...deliveryView(row), receiptId: receipt.id, receivedAt: receipt.receivedAt }); } catch {} }
    res.json({ data: verified });
  });
  app.get('/api/cs/automation/audit-logs', async (req, res) => {
    await auth(req); const filter = scope(req);
    for (const field of ['workflowId', 'action', 'status', 'idempotencyKey']) if (req.query[field]) filter[field] = String(req.query[field]);
    res.json({ data: await c(runtime, 'automation_audit_logs').find(filter).sort({ occurredAt: -1 }).limit(100).toArray() });
  });
  app.post('/api/cs/automation/reconcile', async (req, res) => {
    if(req.body?.mode==='LOCAL_OBSERVE_V1'){res.json({data:await localObserve(req)});return;}
    await auth(req, 'cs.automation.execute');
    const enrolled=await tx(req,'cs.automation.execute',session=>c(runtime,'saasSubscriptions').findOne({tenantId:req.scope.tenantId},{session}),'READ');if(enrolled||effects?.supports('automation.recovery')){const accepted=await acceptRecovery(req);return res.status(202).set('Cache-Control','no-store').json({data:accepted.result,effect:{commandId:accepted.commandId,mode:'LOCAL_SIMULATED'}});}
    fields(req.body, []);
    const expired = await tx(req, 'cs.automation.execute', async session => {
      const rows = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: 'SENDING', leaseUntil: { $lte: new Date() } }, { session }).toArray();
      for (const row of rows) {
        await c(runtime, 'cs_outbox').updateOne({ _id: row._id, state: 'SENDING', fence: row.fence }, { $set: { state: 'UNKNOWN', deliveryState: 'UNKNOWN', leaseUntil: null, lastError: 'LEASE_EXPIRED', updatedAt: new Date() }, $push: { history: { state: 'UNKNOWN', reason: 'LEASE_EXPIRED', at: new Date() } } }, { session });
        if (row.draftId) await c(runtime, 'cs_resolution_drafts').updateOne({ _id: row.draftId, ...scope(req) }, { $set: { status: 'UNKNOWN', deliveryState: 'UNKNOWN', updatedAt: new Date() } }, { session });
      }
      return rows.map(r => r._id);
    });
    const recovered = [], pending = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: 'UNKNOWN' }).toArray();
    for (const row of pending) { try { const receipt = await (cfg().verifyReceipt || verifiedSinkReceipt)(row, cfg()); if (receipt) recovered.push(await finish(req, row, 'SENT', receipt)); } catch {} }
    const recoveryErrors = [];
    const approved = await c(runtime, 'cs_resolution_drafts').find({ ...scope(req), status: 'APPROVED' }).limit(100).toArray();
    for (const draft of approved) {
      try {
        const child = Object.create(req);
        child.headers = { ...req.headers, 'idempotency-key': `resolution:${draft._id}` };
        await resolutionIntent(child, draft._id);
      } catch (error) { recoveryErrors.push({ draftId: draft._id, code: error.status ? error.code : 'RECOVERY_FAILED' }); }
    }
    const safePending = await c(runtime, 'cs_outbox').find({ ...scope(req), origin: 'AUTOMATION', state: { $in: ['QUEUED', 'FAILED'] } }).limit(100).toArray();
    for (const row of safePending) {
      try { recovered.push(await dispatch(req, row._id)); }
      catch (error) { recoveryErrors.push({ deliveryId: row._id, code: error.status ? error.code : 'RECOVERY_FAILED' }); }
    }
    const due = await schedule(req), unreconciledCount = await c(runtime, 'cs_outbox').countDocuments({ ...scope(req), origin: 'AUTOMATION', state: 'UNKNOWN' });
    res.json({ data: { reconciledAt: new Date().toISOString(), expiredDeliveryIds: expired, recoveredDeliveries: recovered, recoveryErrors, recoveredEscalations: [], recoveredDrafts: recovered, dueEscalations: due.length, unreconciledCount, status: unreconciledCount || recoveryErrors.length ? 'NEEDS_REVIEW' : 'RECONCILED', message: unreconciledCount ? 'Unknown submissions require receipt reconciliation or an operator decision' : 'Receipt reconciliation complete; due SLA tasks remain available to n8n' } });
  });
  app.post('/api/cs/automation/deliveries/:id/review', async (req, res) => {
    await human(req, 'cs.automation.admin'); fields(req.body, ['decision', 'evidence']);
    if (!['ABANDON', 'CONFIRMED_NOT_SUBMITTED'].includes(req.body.decision)) fail(400, 'INVALID_DECISION');
    const evidence = text(req.body.evidence, 1000);
    const out = await adminOperation(req,'DELIVERY_MANUAL_REVIEW',id(req.params.id),{decision:req.body.decision,evidence},async session => {
      const row = await c(runtime, 'cs_outbox').findOne({ ...scope(req), _id: id(req.params.id), origin: 'AUTOMATION', state: 'UNKNOWN' }, { session });
      if (!row) fail(409, 'UNKNOWN_DELIVERY_REQUIRED');
      const state = req.body.decision === 'ABANDON' ? 'CANCELLED' : 'FAILED';
      await c(runtime, 'cs_outbox').updateOne({ _id: row._id, state: 'UNKNOWN' }, { $set: { state, deliveryState: state, manualReview: { userId: req.scope.userId, decision: req.body.decision, evidence, at: new Date() } } }, { session });
      if (row.draftId) await c(runtime, 'cs_resolution_drafts').updateOne({ _id: row.draftId, ...scope(req) }, { $set: { status: state, deliveryState: state }, $inc: { version: 1 } }, { session });
      await audit(req, session, row.kind === 'DIGEST' ? 'DIGEST_UNKNOWN_REVIEW' : 'RESOLUTION_UNKNOWN_REVIEW', row._id, { deliveryId: row._id, state, decision: req.body.decision });
      return { deliveryId: row._id, state };
    });
    res.json({ data: out });
  });
  const engineSources=async(userScope,payload,session)=>{
    const request={scope:userScope},proof={};
    if(payload.ticketId){const ticket=await c(runtime,'cs_tickets').findOneAndUpdate({...scope(request),_id:payload.ticketId},{$inc:{automationFence:1}},{session,returnDocument:'after'});if(!ticket)fail(404,'NOT_FOUND');const binding=await sourceBinding(request,ticket,session);proof.ticket={id:ticket._id,version:ticket.version,bindingId:binding._id,bindingVersion:binding.version};}
    if(payload.draftId){const draft=await getDraft(request,payload.draftId,session);if(!draft.approvedBy||!draft.approvalHash)fail(409,'APPROVAL_REQUIRED');await checkSource(request,draft,session,true);proof.draft={id:draft._id,approvalHash:draft.approvalHash,sourceVersion:draft.expectedTicketVersion};}
    return digest(proof);
  };
  const engineOrigin=(userScope,plan)=>({authorize:async({session,observation})=>{
    const grant=await runtime.foundation.authorizeInTransaction(userScope,{tenantId:userScope.tenantId,plantId:userScope.selectedPlantId,action:'cs.automation.execute'},{session});
    const humanSession=await c(runtime,'sessions').findOne({userId:grant.userId,membershipId:grant.membershipId,tenantId:grant.tenantId,automationService:true,revoked:false},{session});if(humanSession?.automationService)fail(403,'HUMAN_APPROVAL_REQUIRED');
    const configured=cfg().serviceToken||process.env.IEMS_AUTOMATION_SERVICE_TOKEN;if(!configured)fail(503,'ENGINE_SERVICE_NOT_CONFIGURED');
    let serviceScope;try{serviceScope=await runtime.foundation.authenticate(configured);}catch{fail(403,'ENGINE_SERVICE_CREDENTIAL_EXPIRED');}
    const serviceGrant=await runtime.foundation.authorizeInTransaction(serviceScope,{tenantId:grant.tenantId,plantId:grant.plantId,action:'cs.automation.execute'},{session});
    const service=await c(runtime,'sessions').findOne({_id:plan.serviceSessionId,tokenHash:hashText(configured),automationService:true,tenantId:grant.tenantId},{session});
    if(!service||serviceScope.selectedPlantId!==grant.plantId||serviceGrant.legalEntityId!==grant.legalEntityId)fail(403,'ENGINE_SCOPE_DENIED');
    if(await engineSources(userScope,plan.payload,session)!==plan.sourceHash)fail(409,'ENGINE_SOURCE_CHANGED');
    if(!observation){if((await c(runtime,'automation_settings').findOne({_id:`${grant.tenantId}:${grant.plantId}`},{session}))?.paused)fail(409,'AUTOMATION_PAUSED');await runtime.saasAdmission.authorize(userScope,{plantId:grant.plantId,session});}
    return grant;
  }});
  if(effects?.hasAdapter('local.engine')&&!effects.supports('automation.engine'))effects.registerKind('automation.engine',{
    adapterId:'local.engine',statusAction:'cs.automation.read',rebind:async({scope:actorScope,command})=>engineOrigin(actorScope,command.plan),
    childEvents:['ENGINE_ERROR_OBSERVED'],authorizeChild:async({scope:serviceScope,command,attempt,session})=>{const grant=await runtime.foundation.authorizeInTransaction(serviceScope,{tenantId:command.tenantId,plantId:command.plantId,action:'cs.automation.execute'},{session});const service=await c(runtime,'sessions').findOne({_id:command.plan.serviceSessionId,tenantId:command.tenantId,userId:grant.userId,membershipId:grant.membershipId,automationService:true,revoked:false,expiresAt:{$gt:new Date()}},{session});if(!service||attempt.input.executionId!==command.plan.executionId)fail(403,'ENGINE_ERROR_UNCORRELATED');return grant;},
    prepare:async({command})=>({runId:command.plan.runId,executionId:command.plan.executionId,sourceHash:command.plan.sourceHash}),
    invoke:async({command,attempt})=>{const configured=runtime.integrations.effects.engine;if(configured?.execute)await configured.execute({runId:command.plan.runId,executionId:command.plan.executionId,workflowId:command.plan.workflowId,payload:command.plan.payload,providerKey:attempt.providerKey});else await new Promise(resolve=>setImmediate(resolve));return {runId:command.plan.runId,executionId:command.plan.executionId,outcome:'COMPLETED_LOCAL'};},
    publish:async({command,observation,session})=>{const result={runId:command.plan.runId,executionId:command.plan.executionId,state:'COMPLETED_LOCAL'};const changed=await c(runtime,'automation_engine_runs').updateOne({_id:command.plan.runId,tenantId:command.tenantId,plantId:command.plantId,controlCommandId:command._id,state:'ACCEPTED'},{$set:{...result,providerReceiptHash:observation.proofHash,observedAt:new Date(),completedAt:new Date()}},{session});if(changed.matchedCount!==1)fail(409,'ENGINE_RUN_SOURCE_CHANGED');return result;}
  });
  if(effects?.hasAdapter('local.cs')&&!effects.supports('automation.local-delivery'))effects.registerKind('automation.local-delivery',{
    adapterId:'local.cs',statusAction:'cs.automation.read',phases:command=>command.plan.deliveryIds,rebind:async({scope:actorScope,command})=>deliveryOrigin(actorScope,command.plan),
    prepare:async({command,attempt,phase,session,context})=>{
      const request={scope:context.scope},d=await c(runtime,'cs_outbox').findOne({_id:phase,tenantId:command.tenantId,plantId:command.plantId,origin:'AUTOMATION',controlCommandId:command._id},{session});if(!d)fail(404,'NOT_FOUND');
      if(d.state==='PREVIEWED')return {deliveryId:d._id,fence:d.fence,contentHash:d.contentHash,payloadHash:d.payloadHash,alreadyPreviewed:true};if(d.state!=='QUEUED'||d.nextAttemptAt>new Date()||d.attempt>=3)fail(409,'DELIVERY_RECONCILIATION_REQUIRED');
      const at=new Date(),claimed=await c(runtime,'cs_outbox').findOneAndUpdate({_id:d._id,...scope(request),origin:'AUTOMATION',state:'QUEUED',fence:d.fence,controlCommandId:command._id},{$set:{state:'SENDING',deliveryState:'SENDING',leaseOwner:attempt._id,leaseUntil:new Date(at.getTime()+Number(cfg().leaseMs||30000)),updatedAt:at},$inc:{attempt:1,fence:1},$push:{history:{state:'SENDING',at}}},{session,returnDocument:'after'});if(!claimed)fail(409,'DELIVERY_ALREADY_CLAIMED');return {deliveryId:claimed._id,fence:claimed.fence,contentHash:claimed.contentHash,payloadHash:claimed.payloadHash,alreadyPreviewed:false};
    },
    beforeInvoke:async({command,attempt,session})=>{if(!await c(runtime,'cs_outbox').findOne({_id:attempt.phase,tenantId:command.tenantId,plantId:command.plantId,controlCommandId:command._id,fence:attempt.input.fence,contentHash:attempt.input.contentHash,payloadHash:attempt.input.payloadHash,...(attempt.input.alreadyPreviewed?{state:'PREVIEWED'}:{state:'SENDING',leaseOwner:attempt._id,leaseUntil:{$gt:new Date()}})},{session}))fail(409,'STALE_DELIVERY_FENCE');},
    invoke:async({command,attempt})=>{await runtime.integrations.effects.transport?.execute?.({commandId:command._id,deliveryId:attempt.phase,contentHash:attempt.input.contentHash,payloadHash:attempt.input.payloadHash,providerKey:attempt.providerKey});return {deliveryId:attempt.phase,fence:attempt.input.fence,contentHash:attempt.input.contentHash,payloadHash:attempt.input.payloadHash,state:'PREVIEWED',mode:'LOCAL_SIMULATED'};},
    publish:async({command,attempt,observation,session,context})=>{
      const result={deliveryId:attempt.phase,state:'PREVIEWED',deliveryState:'PREVIEWED',mode:'LOCAL_SIMULATED',proofHash:observation.proofHash};if(attempt.input.alreadyPreviewed)return result;const at=new Date(),changed=await c(runtime,'cs_outbox').updateOne({_id:attempt.phase,tenantId:command.tenantId,plantId:command.plantId,origin:'AUTOMATION',controlCommandId:command._id,state:{$in:['SENDING','UNKNOWN']},fence:attempt.input.fence},{$set:{state:'PREVIEWED',deliveryState:'PREVIEWED',receiptStatus:'Local simulation only; no message sent',providerMessageId:null,leaseUntil:null,leaseOwner:null,updatedAt:at},$push:{history:{state:'PREVIEWED',mode:'LOCAL_SIMULATED',proofHash:observation.proofHash,at}}},{session});if(changed.matchedCount!==1)fail(409,'STALE_DELIVERY_FENCE');
      const d=await c(runtime,'cs_outbox').findOne({_id:attempt.phase,tenantId:command.tenantId},{session});if(d.draftId){const draft=await getDraft({scope:context.scope},d.draftId,session),update=await c(runtime,'cs_resolution_drafts').updateOne({_id:d.draftId,tenantId:command.tenantId,plantId:command.plantId,version:draft.version},{$set:{status:'DISPATCHED',deliveryState:'PREVIEWED',updatedAt:at},$inc:{version:1}},{session});if(update.matchedCount!==1)fail(409,'STALE_DRAFT');}await audit({scope:context.scope,headers:{}},session,d.kind==='DIGEST'?'DIGEST_DELIVERY_RESULT':'RESOLUTION_DELIVERY_RESULT',d._id,result);return result;
    }
  });
  if(effects?.hasAdapter('local.engine')&&!effects.supports('automation.recovery'))effects.registerKind('automation.recovery',{
    adapterId:'local.engine',statusAction:'cs.automation.read',rebind:async({scope:actorScope,command})=>recoveryOrigin(actorScope,command.plan),
    allowsChild:async({parent,child,phase})=>child.kind==='automation.local-delivery'&&child.plan.deliveryIds.includes(phase)&&(parent.plan.deliveries.some(x=>x.commandId===child._id&&x.deliveryId===phase)||parent.plan.drafts.some(x=>x.draftId===child.plan.entityId&&x.receiptKey===child.owner.identity.idempotencyKey)),
    prepare:async({command})=>({deliveryIds:command.plan.deliveries.map(x=>x.deliveryId),draftIds:command.plan.drafts.map(x=>x.draftId)}),
    invoke:async({command,capability,context})=>{
      const items=[],seen=new Set(),request={scope:context.scope};
      const recover=async(deliveryId,commandId)=>{
        if(seen.has(deliveryId))return;seen.add(deliveryId);
        try{
          await effectTransaction(runtime.client,async session=>{const parent=await effects.worker(capability,{session,publish:false});if(parent.command._id!==command._id)fail(403,'RECOVERY_CHILD_CONTEXT_REQUIRED');await recoveryDelivery(request,session,deliveryId);const d=await c(runtime,'cs_outbox').findOne({...scope(request),_id:deliveryId,controlCommandId:commandId,origin:'AUTOMATION'},{session});if(!d)fail(404,'NOT_FOUND');if(d.state==='SENDING'&&d.leaseUntil&&d.leaseUntil<=new Date()){const at=new Date();await c(runtime,'cs_outbox').updateOne({_id:d._id,...scope(request),controlCommandId:commandId,state:'SENDING',fence:d.fence,leaseUntil:d.leaseUntil},{$set:{state:'UNKNOWN',deliveryState:'UNKNOWN',lastError:'LEASE_EXPIRED',leaseUntil:null,updatedAt:at},$push:{history:{state:'UNKNOWN',reason:'LEASE_EXPIRED',at}}},{session});if(d.draftId)await c(runtime,'cs_resolution_drafts').updateOne({_id:d.draftId,...scope(request)},{$set:{status:'UNKNOWN',deliveryState:'UNKNOWN',updatedAt:at}},{session});}});
          const d=await c(runtime,'cs_outbox').findOne({...scope(request),_id:deliveryId,controlCommandId:commandId}),attempt=await c(runtime,'saasEffectAttempts').findOne({tenantId:command.tenantId,commandId,phase:deliveryId},{sort:{ordinal:-1}}),result=await effects.runChild(capability,commandId,deliveryId,{observeOnly:Boolean(attempt)||['SENDING','UNKNOWN'].includes(d.state)});items.push({deliveryId,commandId,state:result.state,phaseResultHash:effectHash(result)});
        }catch(error){items.push({deliveryId,commandId,state:'NEEDS_REVIEW',code:typeof error.code==='string'?error.code:'RECOVERY_CHILD_UNCERTAIN'});}
      };
      for(const selected of command.plan.deliveries)await recover(selected.deliveryId,selected.commandId);
      for(const selected of command.plan.drafts){
        const child=Object.freeze({scope:context.scope,headers:Object.freeze({'idempotency-key':selected.receiptKey})});recoveryRequests.set(child,{capability,draftId:selected.draftId});
        try{const intent=await resolutionIntent(child,selected.draftId),d=await c(runtime,'cs_outbox').findOne({...scope(request),_id:intent.deliveryId,origin:'AUTOMATION'});if(!d?.controlCommandId)fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');await recover(d._id,d.controlCommandId);}catch(error){items.push({draftId:selected.draftId,state:'NEEDS_REVIEW',code:typeof error.code==='string'?error.code:'RECOVERY_CHILD_UNCERTAIN'});}
      }
      return {mode:'LOCAL_SIMULATED',status:items.some(x=>x.state!=='PREVIEWED')?'NEEDS_REVIEW':'RECONCILED_LOCAL',items};
    },
    publish:async({command,observation,session,context})=>{for(const item of observation.result.items)if(item.state==='PREVIEWED'){const proof=await c(runtime,'saasEffectAttempts').findOne({tenantId:command.tenantId,commandId:item.commandId,phase:item.deliveryId,state:'SETTLED'},{session,sort:{ordinal:-1}});if(!proof||effectHash(proof.phaseResult)!==item.phaseResultHash)fail(409,'RECOVERY_PHASE_PROOF_CHANGED');}await audit({scope:context.scope,headers:{}},session,'AUTOMATION_RECOVERY_RESULT',command.plantId,observation.result);return observation.result;}
  });
  const acceptEngine=async(req,wf)=>effectTransaction(runtime.client,async session=>{
    const grant=await human(req,'cs.automation.execute',session),idem=key(req),payload={...req.body},previous=await replay(req,session,'AUTOMATION_ENGINE_RUN',wf.id,payload,idem),identity={tenantId:grant.tenantId,idempotencyKey:idem};
    if(previous){const command=await effects.managed('automation_audit_logs',identity,{session});if(!command)fail(409,'HISTORICAL_EFFECT_BINDING_REQUIRED');await effects.accept({session,grant,actor:command.actor,owner:command.owner,kind:command.kind,plan:command.plan,accepted:command.acceptedResult,origin:engineOrigin(req.scope,command.plan)});await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'automation_audit_logs',identity,key:idem,action:'cs.automation.execute',operation:'AUTOMATION_ENGINE_RUN',aggregateId:wf.id,payloadHash:digest(payload),replayed:true});return {result:previous,commandId:command._id};}
    if(!effects?.supports('automation.engine'))fail(503,'EFFECT_ADAPTER_UNPROVEN');
    const configured=cfg().serviceToken||process.env.IEMS_AUTOMATION_SERVICE_TOKEN;if(!configured)fail(503,'ENGINE_SERVICE_NOT_CONFIGURED');
    const service=await c(runtime,'sessions').findOne({tenantId:grant.tenantId,tokenHash:hashText(configured),automationService:true},{session});if(!service)fail(403,'ENGINE_SERVICE_CREDENTIAL_EXPIRED');
    const runId=randomUUID(),plan={runId,workflowId:wf.id,executionId:`local:${runId}`,payload,serviceSessionId:service._id,sourceHash:await engineSources(req.scope,payload,session)},result={runId,state:'ACCEPTED'};
    await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'automation_audit_logs',identity,key:idem,action:'cs.automation.execute',operation:'AUTOMATION_ENGINE_RUN',aggregateId:wf.id,payloadHash:digest(payload),replayed:false});
    const command=await effects.accept({session,id:runId,grant,actor:{type:'USER',userId:grant.userId,membershipId:grant.membershipId},owner:{namespace:'automation_audit_logs',identity,hashField:'payloadHash',payloadHash:digest(payload),resultPath:'result',resultHash:effectHash(result)},kind:'automation.engine',plan,accepted:result,origin:engineOrigin(req.scope,plan)});
    await c(runtime,'automation_engine_runs').insertOne({_id:runId,...scope(req),workflowId:wf.id,executionId:plan.executionId,state:'ACCEPTED',startedAt:new Date(),observedAt:new Date(),controlCommandId:command._id,serviceSessionId:plan.serviceSessionId},{session});
    const row=await audit(req,session,'AUTOMATION_ENGINE_RUN',wf.id,result,{idempotencyKey:idem,payloadHash:digest(payload)});return {result:{...result,auditId:row._id,idempotencyKey:idem,replayed:false},commandId:command._id};
  });
  app.post('/api/cs/automation/run/:workflowId', async (req, res) => {
    await human(req, 'cs.automation.execute'); fields(req.body, ['draftId', 'mode', 'ticketId', 'periodKey']);
    const wf = [...workflows, { id: 'wf-automation-recovery', path: 'iems-automation-recovery' }].find(w => w.id === req.params.workflowId);
    if (!wf) fail(404, 'NOT_FOUND');
    const enrolled=await tx(req,'cs.automation.execute',session=>c(runtime,'saasSubscriptions').findOne({tenantId:req.scope.tenantId},{session}),'READ');
    if(enrolled||effects?.supports('automation.engine')){
      for(const name of ['draftId','ticketId'])if(req.body[name]!==undefined)id(req.body[name]);for(const name of ['mode','periodKey'])if(req.body[name]!==undefined&&text(req.body[name],100)!==req.body[name])fail(400,'INVALID_TEXT');
      const accepted=await acceptEngine(req,wf);return res.status(202).set('Cache-Control','no-store').json({data:accepted.result,effect:{commandId:accepted.commandId,mode:'LOCAL_SIMULATED'}});
    }
    const url = localUrl(cfg().n8nUrl || process.env.IEMS_AUTOMATION_N8N_URL, 'http://127.0.0.1:5687'), token = cfg().webhookToken || process.env.IEMS_AUTOMATION_WEBHOOK_TOKEN;
    if (!token) fail(503, 'ENGINE_NOT_CONFIGURED');
    const setting = await c(runtime, 'automation_settings').findOne({ _id: `${req.scope.tenantId}:${req.scope.selectedPlantId}` });
    if (setting?.paused) fail(409, 'AUTOMATION_PAUSED');
    const configured = cfg().serviceToken || process.env.IEMS_AUTOMATION_SERVICE_TOKEN;
    if (!configured) fail(503, 'ENGINE_SERVICE_NOT_CONFIGURED');
    let engineScope; try { engineScope = await runtime.foundation.authenticate(configured); } catch { fail(503, 'ENGINE_SERVICE_CREDENTIAL_EXPIRED'); }
    if (engineScope.tenantId !== req.scope.tenantId || engineScope.selectedPlantId !== req.scope.selectedPlantId) fail(403, 'ENGINE_SCOPE_DENIED');
    const engineSession = await c(runtime, 'sessions').findOne({ tokenHash: hashText(configured), automationService: true });
    if (!engineSession) fail(503, 'ENGINE_SERVICE_NOT_CONFIGURED');
    const row = { _id: randomUUID(), ...scope(req), workflowId: wf.id, executionId: null, startedAt: new Date(), observedAt: new Date(), state: 'IN_PROGRESS' };
    await tx(req, 'cs.automation.execute', session => c(runtime, 'automation_engine_runs').insertOne(row,{session}));
    let response;
    try { response = await fetch(`${url}/webhook/${wf.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-iems-webhook-token': token }, body: JSON.stringify({ ...req.body, correlationId: row._id }), signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch {
      await c(runtime, 'automation_engine_runs').updateOne({ _id: row._id }, { $set: { state: 'UNKNOWN', error: 'ENGINE_ACKNOWLEDGMENT_UNCERTAIN', completedAt: new Date(), observedAt: new Date() } });
      fail(503, 'ENGINE_UNAVAILABLE', 'n8n did not acknowledge the run; inspect Runs before retrying');
    }
    if (!response.ok) {
      await c(runtime, 'automation_engine_runs').updateOne({ _id: row._id }, { $set: { state: 'FAILED', error: 'ENGINE_RUN_FAILED', completedAt: new Date(), observedAt: new Date() } });
      fail(502, 'ENGINE_RUN_FAILED', 'Inspect n8n execution and reconcile delivery state');
    }
    const result = await response.json().catch(() => ({}));
    const observed = { executionId: result.n8nExecutionId || result.executionId || result.data?.executionId || null, result, completedAt: new Date(), observedAt: new Date(), state: 'ENGINE_ACKNOWLEDGED' };
    await c(runtime, 'automation_engine_runs').updateOne({ _id: row._id }, { $set: observed });
    res.json({ data: { ...row, ...observed } });
  });
  app.post('/api/cs/automation/engine-error', async (req, res) => {
    await auth(req, 'cs.automation.execute'); fields(req.body, ['workflowId', 'executionId', 'message','runId']);
    if (!req.automationService) fail(403, 'SERVICE_IDENTITY_REQUIRED');
    if(req.body.runId!==undefined){
      const runId=id(req.body.runId),workflowId=text(req.body.workflowId,100),executionId=text(String(req.body.executionId),100),errorDescriptorHash=digest({message:text(req.body.message,500)}),payload={runId,workflowId,executionId,errorDescriptorHash},idem=key(req);
      const result=await effectTransaction(runtime.client,async session=>{
        await auth(req,'cs.automation.execute',session);const previous=await replay(req,session,'AUTOMATION_ENGINE_ERROR',runId,payload,idem);
        const run=await c(runtime,'automation_engine_runs').findOne({...scope(req),_id:runId,controlCommandId:runId,workflowId,executionId},{session});if(!run)fail(403,'ENGINE_ERROR_UNCORRELATED');
        const correlatedSession=await c(runtime,'sessions').findOne({_id:run.serviceSessionId,tenantId:req.scope.tenantId,userId:req.scope.userId,membershipId:req.scope.membershipId,tokenHash:hashText(req.token),automationService:true,revoked:false,expiresAt:{$gt:new Date()}},{session});if(!correlatedSession)fail(403,'ENGINE_ERROR_UNCORRELATED');const cap=await effects.childCapability(req.scope,runId,'EFFECT',{session});if(previous)return previous;
        await effects.recordChild(cap,{session,kind:'ENGINE_ERROR_OBSERVED',proof:{runId,workflowId,executionId,errorDescriptorHash}});
        await c(runtime,'automation_engine_runs').updateOne({_id:runId,...scope(req),controlCommandId:runId},{$set:{engineErrorObserved:{executionId,errorDescriptorHash,observedAt:new Date()}}},{session});
        const value={runId,workflowId,executionId,state:'ERROR_OBSERVED'},row=await audit(req,session,'AUTOMATION_ENGINE_ERROR',runId,value,{idempotencyKey:idem,payloadHash:digest(payload)});return {...value,auditId:row._id,idempotencyKey:idem,replayed:false};
      });return res.status(201).set('Cache-Control','no-store').json({data:result});
    }
    const workflowId = text(req.body.workflowId, 100), executionId = text(String(req.body.executionId), 100);
    const row = { _id: randomUUID(), ...scope(req), workflowId, executionId, state: 'FAILED', error: 'N8N_EXECUTION_FAILED', completedAt: new Date(), observedAt: new Date() };
    await tx(req, 'cs.automation.execute', session => c(runtime, 'automation_engine_runs').insertOne(row,{session}));
    res.status(201).json({ data: { runId: row._id, workflowId, executionId, state: row.state } });
  });
  app.post('/api/cs/automation/whatsapp-handoff', async (req, res) => { await auth(req, 'cs.automation.execute'); fail(409, 'USE_AUTHORITATIVE_HANDOFF', 'Use the customer service conversation handoff operation; WhatsApp remains preview only'); });
}
