import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { summarizeServiceMetrics } from './service-metrics.mjs';

export const customerServiceDisposition=Symbol('customer-service-current-admission');
export const SYNTHETIC_ORDER_SOURCE = 'SYNTHETIC_FIXTURE_SNAPSHOT';
export const DRAFT_STAGES = Object.freeze(['ORDER_SELECTION', 'CATEGORY', 'DESCRIPTION', 'PREVIEW', 'CONFIRMED', 'CANCELLED']);
export const COMPLAINT_CATEGORIES = Object.freeze(['DELIVERY_DELAY', 'QUALITY', 'WRONG_ITEM', 'INVOICE_QUESTION', 'SAFETY_OR_DAMAGE', 'OTHER']);
export const TICKET_STAGES = Object.freeze(['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'REOPENED', 'CLOSED']);
export const CONVERSATION_MODES = Object.freeze(['BOT_ACTIVE', 'HUMAN_PENDING', 'HUMAN_ACTIVE', 'PAUSED', 'CLOSED']);
export const DELIVERY_STATES = Object.freeze(['PREVIEWED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED']);
export const ORDER_PUBLIC_STAGES = Object.freeze(['ACCEPTED', 'PLANNING', 'PRODUCTION', 'QUALITY_INSPECTION', 'READY_TO_SHIP', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'RECEIVED', 'DIAGNOSIS', 'AWAITING_APPROVAL', 'REPAIR', 'TESTING', 'READY_TO_RETURN', 'RETURNED']);
export const BOT_TEMPLATES = Object.freeze(['menu', 'order_status', 'status_unavailable', 'draft_order', 'draft_category', 'draft_description', 'draft_preview', 'validation_error', 'draft_back', 'draft_cancel', 'ticket_ack', 'ticket_status', 'handoff_queued', 'operator_text', 'resolved']);

const TICKET_TRANSITIONS = Object.freeze({
  NEW: ['TRIAGED', 'ASSIGNED'],
  TRIAGED: ['ASSIGNED'],
  ASSIGNED: ['ASSIGNED', 'IN_PROGRESS'],
  IN_PROGRESS: ['WAITING_FOR_CUSTOMER', 'RESOLVED'],
  WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  REOPENED: ['ASSIGNED', 'IN_PROGRESS'],
  CLOSED: ['REOPENED']
});
const DRAFT_BACK = Object.freeze({ CATEGORY: 'ORDER_SELECTION', DESCRIPTION: 'CATEGORY', PREVIEW: 'DESCRIPTION' });
const OPEN_DRAFT = ['ORDER_SELECTION', 'CATEGORY', 'DESCRIPTION', 'PREVIEW'];
const STATUS = { DENIED: 403, NOT_FOUND: 404, INVALID_INPUT: 400, INVALID_TRANSITION: 409, VERSION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, DRAFT_EXPIRED: 410, STALE_FENCE: 409, STATUS_UNAVAILABLE: 503, VALIDATION: 400, BINDING_REVOKED: 409, BINDING_CONFLICT: 409, IDEMPOTENCY_KEY_REUSED: 409, HISTORICAL_RESULT_RECEIPT_REQUIRED:409, SYNTHETIC_ADDRESS_REQUIRED: 422 };
export const BINDING_CHANNELS = Object.freeze(['SIMULATED']);
export const SIMULATED_CHANNEL_ACCOUNT = 'SIMULATED';
export const SYNTHETIC_ADDRESS = /^\+62000\d{6,9}$/;
export const ORDER_KINDS = Object.freeze(['MANUFACTURE', 'REPAIR']);
export const MILESTONE_STATES = Object.freeze(['DONE', 'CURRENT', 'PENDING']);
const TXN = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
const HOUR = 3600000;

export class CustomerServiceError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'CustomerServiceError'; this.code = code; this.status = STATUS[code] ?? 400; if (Number.isSafeInteger(details.currentVersion)) this.currentVersion = details.currentVersion; }
}
const fail = (code, details) => { throw new CustomerServiceError(code, details); };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = v => (typeof v === 'string' && UUID_RE.test(v) ? v : fail('INVALID_INPUT'));
const key = v => (typeof v === 'string' && /^[A-Za-z0-9:_.-]{1,128}$/.test(v) ? v : fail('INVALID_INPUT'));
const text = (v, max = 1000) => {
  if (typeof v !== 'string') fail('INVALID_INPUT');
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : fail('INVALID_INPUT');
};
const orderNo = v => (typeof v === 'string' && /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(v) ? v : fail('INVALID_INPUT'));
const version = v => (Number.isSafeInteger(v) && v >= 1 ? v : fail('INVALID_INPUT'));
const oneOf = (v, list) => (list.includes(v) ? v : fail('INVALID_INPUT'));
const canonical = v => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object' && !(v instanceof Date)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
export const requestHash = v => createHash('sha256').update(canonical(v)).digest('hex');

// Deterministic customer-facing preview text for a stored outbox payload (same wording as the preview bridge).
// Only template params reach the body: internal notes, costs and margins are never part of a payload.
export function renderTemplate(payload) {
  const p = payload ?? {}, q = p.params ?? {};
  switch (p.template) {
    case 'ticket_ack': return `IEMS preview: complaint received as ticket ${p.ticketNumber ?? q.ticketNumber}. A team member will review it.`;
    case 'handoff_queued': return 'IEMS preview: a team member has been requested. Automated replies are paused.';
    case 'menu': return 'IEMS preview commands: ORDER <number>, COMPLAINT, TICKET <number>, HUMAN, STOP.';
    case 'order_status': {
      const progress = q.total ? ` ${q.released} of ${q.total} ${q.kind === 'MANUFACTURE' ? 'work orders' : 'units'} released.` : '';
      const next = q.nextMilestone ? ` Next: ${q.nextMilestone}.` : '';
      const kind = q.kind === 'REPAIR' ? 'repair order' : 'order';
      return `${q.orderNumber}: ${q.publicStage}.${progress}${next} ${q.source === 'PORTFOLIO_API_OWNED' ? `Authoritative owned ${kind}.` : 'Synthetic fixture snapshot, not a live lookup.'}`;
    }
    case 'status_unavailable': return 'IEMS preview: status cannot be confirmed right now. Send IEMS HUMAN for a team member.';
    case 'draft_order': return 'Select an order: IEMS COMPLAINT ORDER <number>, or IEMS COMPLAINT GENERAL.';
    case 'draft_category': return 'Select category: IEMS COMPLAINT CATEGORY DELIVERY_DELAY, QUALITY, WRONG_ITEM, INVOICE_QUESTION, SAFETY_OR_DAMAGE or OTHER.';
    case 'draft_description': return 'Describe the issue: IEMS COMPLAINT DESCRIBE <text>.';
    case 'draft_preview': return `Review: ${q.description ?? ''}. Send IEMS COMPLAINT CONFIRM, BACK or CANCEL.`;
    case 'draft_back': return `Back to ${q.stage}. Continue the complaint or send IEMS COMPLAINT CANCEL.`;
    case 'draft_cancel': return 'Complaint cancelled. Send IEMS MENU to start again.';
    case 'validation_error': return `Cannot continue: ${q.error}. Please check your input and try again.`;
    case 'ticket_status': return `${q.ticketNumber}: ${q.stage}.`;
    case 'resolved': return `${q.ticketNumber}: resolved. Contact the team if you need further help.`;
    case 'operator_text': return typeof p.text === 'string' ? p.text : null;
    default: return null;
  }
}

// Same command grammar as the preview bridge; the leading "IEMS " is optional for the simulator.
export function parseInboundText(raw) {
  const body = String(raw).trim().replace(/^IEMS\s+/i, '');
  let m;
  if (body === 'MENU') return { op: 'MENU' };
  if (body === 'HUMAN') return { op: 'HUMAN' };
  if ((m = /^ORDER (\S{1,64})$/.exec(body))) return { op: 'ORDER', orderNumber: m[1] };
  if ((m = /^TICKET (\S{1,64})$/.exec(body))) return { op: 'TICKET', ticketNumber: m[1] };
  if (body === 'COMPLAINT') return { op: 'COMPLAINT' };
  if (body === 'COMPLAINT CONFIRM') return { op: 'CONFIRM' };
  if (body === 'COMPLAINT GENERAL') return { op: 'DRAFT', action: { type: 'GENERAL_INQUIRY' } };
  if (body === 'COMPLAINT BACK') return { op: 'DRAFT', action: { type: 'BACK' } };
  if (body === 'COMPLAINT CANCEL') return { op: 'DRAFT', action: { type: 'CANCEL' } };
  if ((m = /^COMPLAINT ORDER (\S{1,64})$/.exec(body))) return { op: 'DRAFT', action: { type: 'SELECT_ORDER', orderNumber: m[1] } };
  if ((m = /^COMPLAINT CATEGORY ([A-Z_]{1,40})$/.exec(body))) return { op: 'DRAFT', action: { type: 'SELECT_CATEGORY', category: m[1] } };
  if ((m = /^COMPLAINT DESCRIBE ([\s\S]{1,1000})$/.exec(body))) return { op: 'DRAFT', action: { type: 'DESCRIBE', text: m[1] } };
  return { op: 'UNKNOWN_COMMAND' };
}

export function createCustomerService({ client, db, foundation, saasAdmission, createCustomerServicePort = saasAdmission?.createCustomerServicePort, now = () => new Date(), draftTtlMs = 24 * HOUR, ackTtlMs = 24 * HOUR, botReplyTtlMs = 15 * 60000, maxSendAttempts = 3, orderReader, orderReaderTimeoutMs = 2000, orderMaxStaleMs = 60000, allowSyntheticOrders = false, previewDispatcher = false, faultInjector = async () => {}, partyDirectory = null, firstResponseSlaMinutes = 240 }) {
  if (!client || !db || !foundation) throw new TypeError('client, db and foundation are required');
  const c = name => db.collection(name);
  const principals = new WeakMap();

  const transactionContext = new AsyncLocalStorage();
  async function tx(fn) {
    if (transactionContext.getStore()) return fn(transactionContext.getStore().session);
    for (let attempt = 1; ; attempt++) {
      const session = client.startSession();
      try {
        return await session.withTransaction(() => transactionContext.run(Object.freeze({session,actor:null,principal:null,binding:null,admission:null}), () => fn(session)), TXN);
      } catch (e) {
        // A committed concurrent duplicate surfaces as E11000 instead of a transient write conflict; rerun to read it.
        if (e?.code === 11000 && attempt < 4) continue;
        throw e;
      } finally { await session.endSession(); }
    }
  }
  const audit = (session, tenantId, action, subjectId, actor) =>
    c('cs_audit').insertOne({ _id: randomUUID(), tenantId, action, subjectId, actor, at: now() }, { session });

  async function missingPort(tenantId,session) {
    if(session)await c('tenants').updateOne({_id:tenantId,active:true},{$inc:{saasEnrollmentFence:1}},{session});
    if(await c('saasSubscriptions').findOne({tenantId},{session}))fail('DENIED');
  }
  async function idempotent(session, { tenantId, scope, owner, key: k, request, principal, conflictCode = 'IDEMPOTENCY_CONFLICT' }, compute) {
    const hash=requestHash(request),identity={tenantId,scope,owner,key:k};
    const found=await c('cs_idempotency').findOne(identity,{session});
    if(found&&found.requestHash!==hash)fail(conflictCode);
    const parent=transactionContext.getStore();if(parent?.session!==session)fail('DENIED');
    const context=principal?Object.freeze({...parent,principal,binding:Object.freeze({...await loadCustomerContext(principal,session)})}):parent;
    await recheckReceiptSources(session,context,scope,request,found?.result);
    const descriptor={session,namespace:'cs_idempotency',identity,key:k,payloadHash:hash,replayed:Boolean(found),parent:context.admission};
    let admitted;
    if(['inbound.command','complaint.confirm','ticket.customer_comment','conversation.handoff_request','complaint.start','complaint.update','conversation.bot_reply'].includes(scope)) {
      if(!context.principal)fail('DENIED');
      if(customerPort)admitted=await customerPort.effect({...descriptor,principal:context.principal});else await missingPort(tenantId,session);
    } else {
      if(!context.actor)fail('DENIED');
      if(saasAdmission)admitted=await saasAdmission.effect({...descriptor,scope:context.actor.scope,action:context.actor.action});else await missingPort(tenantId,session);
    }
    if(admitted&&!['LEGACY_UNENROLLED','ADMITTED','REPLAY','INHERITED'].includes(admitted.state))fail('DENIED');
    if(!context.admission)context.onAdmission?.(Object.freeze({enrolled:admitted?admitted.state!=='LEGACY_UNENROLLED':false}));
    if(found)return found.result;
    return transactionContext.run(Object.freeze({...context,admission:admitted?.context??context.admission??Object.freeze({legacy:true})}),async()=>{
      const result=await compute();
      await c('cs_idempotency').insertOne({_id:randomUUID(),...identity,requestHash:hash,result,at:now()},{session});return result;
    });
  }

  async function immutableRoot(session,descriptor,compute,historical) {
    if(descriptor.principal&&transactionContext.getStore()?.admission)return compute();
    if(descriptor.key===undefined){await unreceiptedCustomer(session,await loadCustomerContext(descriptor.principal,session));return compute();}
    key(descriptor.key);
    const prior=await c('cs_idempotency').findOne({tenantId:descriptor.tenantId,scope:descriptor.scope,owner:descriptor.owner,key:descriptor.key},{session});
    if(!prior&&historical){const result=await historical();if(result){if(await c('saasSubscriptions').findOne({tenantId:descriptor.tenantId},{session}))fail('HISTORICAL_RESULT_RECEIPT_REQUIRED');if(!descriptor.principal)await recheckReceiptSources(session,transactionContext.getStore(),descriptor.scope,descriptor.request,result);return result;}}
    return idempotent(session,descriptor,compute);
  }
  async function operator(scope, plantId, action) {
    const session = transactionContext.getStore()?.session;
    return session ? foundation.authorizeInTransaction(scope, { plantId: uuid(plantId), action }, { session }) : foundation.authorize(scope, { plantId: uuid(plantId), action });
  }
  async function operatorTx(scope,plantId,action,fn,{onAdmission}={}) {
    return tx(async session=>{
      const grant=await operator(scope,plantId,action),context=transactionContext.getStore();
      if(saasAdmission) {
        if(['cs.ticket.read','cs.binding.read'].includes(action))await saasAdmission.authorize(scope,{plantId,session});
        else if(['cs.ticket.write','cs.note.internal','cs.conversation.handoff','cs.binding.manage','cs.delivery.review','cs.simulator.use','cs.reply'].includes(action))await saasAdmission.authorize(scope,{plantId,session});
        else await saasAdmission.unsupported(scope,{plantId,session});
      }else await missingPort(grant.tenantId,session);
      return transactionContext.run(Object.freeze({...context,actor:Object.freeze({scope,grant,action}),onAdmission:onAdmission??context.onAdmission}),()=>fn(session,grant));
    });
  }
  // Expiry is enforced at query and dispatch time; an ACTIVE binding past expiresAt is treated as unusable.
  const unexpired = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now() } }] });
  const usable = b => !!b && b.status === 'ACTIVE' && (b.expiresAt === undefined || b.expiresAt === null || b.expiresAt > now());
  function registerPrincipal(b) {
    const principal = Object.freeze({ kind: 'CUSTOMER', tenantId: b.tenantId, customerId: b.customerId, bindingId: b._id, bindingVersion: b.version });
    principals.set(principal, { tenantId: b.tenantId, plantId:b.plantId, customerId:b.customerId, bindingId: b._id, bindingVersion: b.version });
    return principal;
  }
  async function loadCustomerContext(principal, session) {
    const ref = principals.get(principal);
    if (!ref) fail('DENIED');
    const binding = await c('cs_contact_bindings').findOne({ _id: ref.bindingId, tenantId: ref.tenantId, plantId:ref.plantId, customerId:ref.customerId, status: 'ACTIVE', version: ref.bindingVersion, ...unexpired() }, { session });
    if (!binding) fail('DENIED');
    if (session) {
      await faultInjector('bindingSnapshot');
      const fenced = await c('cs_contact_bindings').updateOne({ _id: binding._id, tenantId: binding.tenantId, status: 'ACTIVE', version: binding.version }, { $inc: { commandFence: 1 } }, { session });
      if (fenced.matchedCount !== 1) fail('DENIED');
    }
    return binding;
  }
  const customerPort=createCustomerServicePort?.({resolvePrincipal:async(principal,{session})=>loadCustomerContext(principal,session)});
  async function customerContext(principal,session) {
    if(!session)return tx(inner=>customerContext(principal,inner));
    const binding=await loadCustomerContext(principal,session);
    if(customerPort)await customerPort.authorize(principal,{session});else await missingPort(binding.tenantId,session);
    return binding;
  }
  async function unreceiptedCustomer(session,binding) {
    if(transactionContext.getStore()?.admission)return;
    if(saasAdmission)await saasAdmission.unsupportedTenant({tenantId:binding.tenantId,session});else await missingPort(binding.tenantId,session);
  }
  async function recheckReceiptSources(session,context,namespace,request,result) {
    const binding=context.binding,g=context.actor?.grant,tenantId=binding?.tenantId??g?.tenantId,plantId=binding?.plantId??g?.plantId;
    const scoped={tenantId,plantId};
    async function ticket(filter) {
      const row=await c('cs_tickets').findOneAndUpdate({...scoped,...filter},{$inc:{admissionSourceFence:1}},{session,returnDocument:'after'});if(!row)fail('NOT_FOUND');
      if(binding&&row.customerId!==binding.customerId)fail('DENIED');
      if(row.bindingId) {
        const source=await c('cs_contact_bindings').findOne({...scoped,_id:row.bindingId,customerId:row.customerId,status:'ACTIVE',...unexpired()},{session});if(!source)fail('DENIED');
        if((await c('cs_contact_bindings').updateOne({_id:source._id,status:'ACTIVE',version:source.version},{$inc:{commandFence:1}},{session})).matchedCount!==1)fail('DENIED');
      }
      return row;
    }
    if(binding) {
      const conv=await c('cs_conversations').findOne({tenantId:binding.tenantId,bindingId:binding._id},{session});
      if(conv&&(conv.plantId!==binding.plantId||conv.customerId!==binding.customerId))fail('DENIED');
      if(namespace==='conversation.handoff_request'&&result?.conversationId&&(!conv||conv._id!==result.conversationId))fail('NOT_FOUND');
    }
    if(namespace.startsWith('ticket.')&&request.ticketId)await ticket({_id:request.ticketId});
    if(namespace==='ticket.customer_comment')await ticket({ticketNumber:request.ticketNumber});
    if(['complaint.start','complaint.update'].includes(namespace)) {
      if(!binding)fail('DENIED');const draftId=namespace==='complaint.update'?request.draftId:result?.draftId;
      if(draftId){const draft=await loadOwnDraft(session,binding,draftId);if(draft.orderNumber)await ownSnapshot(session,binding,draft.orderNumber);}
    }
    if(namespace==='conversation.bot_reply') {
      if(!binding)fail('DENIED');const conv=await c('cs_conversations').findOne({...scoped,bindingId:binding._id},{session});
      if(result&&(!conv||(result.state==='SUPPRESSED'?conv.mode!==result.mode:conv.mode!=='BOT_ACTIVE')))fail('DENIED');
      if(result?.deliveryId){const d=await c('cs_outbox').findOne({...scoped,_id:result.deliveryId,bindingId:binding._id,conversationId:conv._id},{session});if(!d||d.payloadHash!==requestHash(request))fail('DENIED');}
    }
    if(namespace==='complaint.confirm') {if(!binding)fail('DENIED');const draft=await loadOwnDraft(session,binding,request.draftId);if(draft.orderNumber)await ownSnapshot(session,binding,draft.orderNumber);}
    if(namespace==='inbound.command') {
      if(!binding)fail('DENIED');const cmd=request.command;
      if(cmd?.op==='ORDER')await ownSnapshot(session,binding,cmd.orderNumber);
      if(cmd?.op==='TICKET')await ticket({ticketNumber:cmd.ticketNumber});
      if(result?.draft?.draftId) {const draft=await loadOwnDraft(session,binding,result.draft.draftId);if(draft.orderNumber)await ownSnapshot(session,binding,draft.orderNumber);}
      const ticketNumber=result?.ticket?.ticketNumber??result?.receipt?.ticketNumber;if(ticketNumber){const current=await ticket({ticketNumber});if(cmd?.op==='CONFIRM'&&current.draftId){const draft=await loadOwnDraft(session,binding,current.draftId);if(draft.orderNumber)await ownSnapshot(session,binding,draft.orderNumber);}}
      const conv=await c('cs_conversations').findOne({...scoped,bindingId:binding._id},{session});if(result?.mode&&!conv)fail('NOT_FOUND');
    }
    if(namespace.startsWith('conversation.')&&request.conversationId) {
      const conv=await c('cs_conversations').findOneAndUpdate({...scoped,_id:request.conversationId},{$inc:{admissionSourceFence:1}},{session,returnDocument:'after'});if(!conv)fail('NOT_FOUND');
      if(namespace==='conversation.operator_reply'&&(conv.mode!=='HUMAN_ACTIVE'||conv.assigneeId!==g.userId))fail('DENIED');
      if(namespace==='conversation.mode'&&conv.assigneeId&&conv.assigneeId!==g.userId)fail('DENIED');
      if(!await c('cs_contact_bindings').findOne({...scoped,_id:conv.bindingId,customerId:conv.customerId,status:'ACTIVE',...unexpired()},{session}))fail('DENIED');
    }
    if(namespace==='binding.create') {
      if(!await partyDirectory?.verifyCustomerContact({...scoped,accountId:request.accountId,contactId:request.contactId},{session}))fail('NOT_FOUND');
      if(result?.binding?.bindingId&&!await c('cs_contact_bindings').findOne({...scoped,_id:result.binding.bindingId,customerId:request.accountId,accountId:request.accountId,contactId:request.contactId,address:request.address,status:'ACTIVE',...unexpired()},{session}))fail('DENIED');
    }
    if(namespace==='binding.revoke') {
      const current=await c('cs_contact_bindings').findOne({...scoped,_id:request.bindingId},{session});if(!current)fail('NOT_FOUND');
      if(result&&(current.status!=='REVOKED'||current.version!==result.binding?.version))fail('DENIED');
    }
    if(namespace==='simulator.dispatch')await previewRows(session,g,request.deliveryIds,result?.previewedDeliveryIds);
    if(namespace==='delivery.review') {
      const row=await c('cs_outbox').findOne({...scoped,_id:request.deliveryId},{session});if(!row)fail('NOT_FOUND');
      if(!await c('cs_contact_bindings').findOne({...scoped,_id:row.bindingId,version:row.bindingVersion,channelAccountId:row.channelAccountId,status:'ACTIVE',...unexpired()},{session}))fail('DENIED');
    }
  }
  async function previewRows(session,g,deliveryIds,replayIds) {
    const ids=replayIds??deliveryIds,at=now(),filter={tenantId:g.tenantId,plantId:g.plantId,channelAccountId:SIMULATED_CHANNEL_ACCOUNT,...(ids?{_id:{$in:ids}}:{state:'QUEUED',nextAttemptAt:{$lte:at}})};
    const rows=await c('cs_outbox').find(filter,{session}).sort({seq:1,_id:1}).limit(replayIds?25:ids?101:25).toArray();
    if(ids&&rows.length!==ids.length)fail('NOT_FOUND');
    if(rows.length>25)fail('INVALID_INPUT');
    for(const d of rows){
      if(!['QUEUED','PREVIEWED'].includes(d.state)||d.leaseOwner||d.leaseUntil||d.expiresAt<=at||d.nextAttemptAt>at)fail('DENIED');
      if(await c('cs_outbox').findOne({tenantId:g.tenantId,conversationId:d.conversationId,state:{$in:['SENDING','UNKNOWN']}},{session}))fail('DENIED');
      const b=await c('cs_contact_bindings').findOneAndUpdate({_id:d.bindingId,tenantId:g.tenantId,plantId:g.plantId,channel: 'SIMULATED',channelAccountId:SIMULATED_CHANNEL_ACCOUNT,status:'ACTIVE',version:d.bindingVersion,...unexpired()},{$inc:{previewFence:1}},{session,returnDocument:'after'});
      const conv=await c('cs_conversations').findOneAndUpdate({_id:d.conversationId,tenantId:g.tenantId,plantId:g.plantId},{$inc:{previewFence:1}},{session,returnDocument:'after'});
      if(!b||!conv||b.customerId!==conv.customerId||b._id!==conv.bindingId||['PAUSED','CLOSED'].includes(conv.mode)||(d.origin==='BOT'&&(conv.mode!=='BOT_ACTIVE'||conv.modeEpoch!==d.modeEpoch))||(d.origin==='OPERATOR'&&(conv.mode!=='HUMAN_ACTIVE'||conv.assigneeId!==d.actorUserId)))fail('DENIED');
    }
    return rows;
  }
  async function conversationFor(session, binding) {
    const at = now();
    return c('cs_conversations').findOneAndUpdate(
      { tenantId: binding.tenantId, bindingId: binding._id },
      { $setOnInsert: { _id: randomUUID(), plantId: binding.plantId, customerId: binding.customerId, mode: 'BOT_ACTIVE', modeEpoch: 1, version: 1, assigneeId: null, activeTicketId: null, createdAt: at }, $set: { lastActivityAt: at } },
      { upsert: true, returnDocument: 'after', session });
  }
  async function enqueue(session, conv, binding, { kind, origin, actionKey, payload, ttlMs, ticketId = null, actorUserId = null }) {
    const at = now();
    // Monotonic per-tenant sequence gives FIFO per conversation even when clock values tie.
    const seq = (await c('cs_counters').findOneAndUpdate({ _id: `${conv.tenantId}:outbox` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session })).seq;
    const row = {
      _id: randomUUID(), seq, tenantId: conv.tenantId, plantId: conv.plantId, conversationId: conv._id, bindingId: binding._id, bindingVersion: binding.version,
      channelAccountId: binding.channelAccountId, ticketId, kind, origin, actorUserId, modeEpoch: conv.modeEpoch, actionKey, payload: {...payload, templateVersion:1}, payloadHash: requestHash(payload),
      state: 'QUEUED', attempt: 0, fence: 0, nextAttemptAt: at, leaseOwner: null, leaseUntil: null, providerMessageId: null, lastError: null,
      createdAt: at, updatedAt: at, expiresAt: new Date(at.getTime() + ttlMs), history: [{ state: 'QUEUED', at }]
    };
    await c('cs_outbox').insertOne(row, { session });
    return row;
  }
  // Only QUEUED rows are cancelled; SENDING rows may already be at the provider and are reported, not retracted.
  async function cancelQueuedBotReplies(session, conv, reason) {
    const at = now();
    const filter = { tenantId: conv.tenantId, conversationId: conv._id, origin: 'BOT', kind: 'BOT_REPLY' };
    const cancelled = await c('cs_outbox').find({ ...filter, state: 'QUEUED' }, { session, projection: { _id: 1 } }).toArray();
    if (cancelled.length) await c('cs_outbox').updateMany({ ...filter, state: 'QUEUED' }, { $set: { state: 'CANCELLED', cancelReason: reason, updatedAt: at }, $push: { history: { state: 'CANCELLED', reason, at } } }, { session });
    const inFlight = await c('cs_outbox').find({ tenantId: conv.tenantId, conversationId: conv._id, state: { $in: ['SENDING', 'UNKNOWN'] } }, { session, projection: { _id: 1, state: 1 } }).toArray();
    return { cancelledDeliveryIds: cancelled.map(r => r._id), inFlightDeliveryIds: inFlight.map(r => r._id) };
  }
  async function changeMode(session, conv, toMode, actor, reason, extra = {}) {
    const res = await c('cs_conversations').updateOne({ _id: conv._id, tenantId: conv.tenantId, version: conv.version },
      { $set: { mode: toMode, updatedAt: now(), ...extra }, $inc: { version: 1, modeEpoch: 1 } }, { session });
    if (res.matchedCount !== 1) fail('VERSION_CONFLICT');
    const boundary = toMode === 'BOT_ACTIVE' ? { cancelledDeliveryIds: [], inFlightDeliveryIds: [] } : await cancelQueuedBotReplies(session, conv, `MODE_${toMode}`);
    await c('cs_conversation_events').insertOne({ _id: randomUUID(), tenantId: conv.tenantId, conversationId: conv._id, fromMode: conv.mode, toMode, version: conv.version + 1, actor, reason, ...boundary, at: now() }, { session });
    return { conversationId: conv._id, mode: toMode, version: conv.version + 1, ...boundary };
  }
  const pageLimit = v => (v === undefined ? 50 : Number.isSafeInteger(v) && v >= 1 && v <= 100 ? v : fail('INVALID_INPUT'));
  const encodeCursor = (at, id) => Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
  function decodeCursor(cursor) {
    if (cursor === undefined || cursor === null) return null;
    try {
      const [at, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
      const date = new Date(at);
      return typeof id === 'string' && Number.isFinite(date.getTime()) ? { at: date, id } : fail('INVALID_INPUT');
    } catch { fail('INVALID_INPUT'); }
  }
  const after = (field, cur) => (cur ? { $or: [{ [field]: { $gt: cur.at } }, { [field]: cur.at, _id: { $gt: cur.id } }] } : {});
  const page = (rows, limit, field, map) => ({ items: rows.slice(0, limit).map(map), nextCursor: rows.length > limit ? encodeCursor(rows[limit - 1][field], rows[limit - 1]._id) : null });

  // Safe outbound projection: rendered body, template id/version, public source and delivery state only.
  // PREVIEWED is a local preview and never implies SENT/DELIVERED/READ.
  const outboundView = m => ({
    messageId: m._id, direction: 'OUTBOUND', origin: m.origin, kind: m.kind, text: m.payload?.text ?? m.payload?.template ?? '', state: m.state, at: m.createdAt,
    body: renderTemplate(m.payload), template: { id: m.payload?.template ?? null, version: m.payload?.templateVersion ?? 1 },
    source: m.payload?.source ? { kind: m.payload.source.kind, id: m.payload.source.id, sourceVersion: m.payload.source.sourceVersion, asOf: m.payload.source.asOf } : null,
    deliveryState: m.state, ...(m.payload?.order ? { order: m.payload.order } : {}), ...(m.cancelReason ? { cancelReason: m.cancelReason } : {}),
    previewedAt: m.previewedAt ?? null, sentAt: m.sentAt ?? null,
  });
  const bindingView = b => ({
    bindingId: b._id, accountId: b.accountId ?? b.customerId, contactId: b.contactId ?? null, channel: b.channel ?? 'FIXTURE', address: b.channel === 'SIMULATED' ? b.address : null,
    status: b.status === 'ACTIVE' && b.expiresAt && b.expiresAt <= now() ? 'EXPIRED' : b.status, version: b.version, expiresAt: b.expiresAt ?? null,
    verifiedMethod: b.verifiedMethod, createdAt: b.createdAt ?? b.verifiedAt, createdBy: b.verifiedBy ?? null,
    revokedAt: b.revokedAt ?? null, revokedBy: b.revokedBy ?? null, revokeReason: b.revokeReason ?? null,
  });
  const draftView = d => ({ draftId: d._id, stage: d.stage, version: d.version, orderNumber: d.orderNumber, category: d.category, description: d.description, expiresAt: d.expiresAt });
  const ticketView = t => ({ ticketId: t._id, ticketNumber: t.ticketNumber, plantId: t.plantId, customerId: t.customerId, stage: t.stage, version: t.version, category: t.category, orderNumber: t.orderNumber, orderSource: t.orderSource, assigneeId: t.assigneeId, description: t.description, dataOrigin: t.seeded === true ? 'SEEDED' : t.dataOrigin ?? 'UNKNOWN', conversationId: t.conversationId ?? null, createdAt: t.createdAt, updatedAt: t.updatedAt });

  // kind/milestones/confirmedDates are optional (older readers omit them) but validated strictly when present.
  function validOrderDetail(s) {
    if (s.kind === undefined) return s.milestones === undefined && s.confirmedDates === undefined;
    const date = v => v === null || (v instanceof Date && Number.isFinite(v.getTime()));
    return ORDER_KINDS.includes(s.kind) && Array.isArray(s.milestones) && s.milestones.length <= 20
      && s.milestones.every(m => m && typeof m.code === 'string' && /^[A-Z_]{1,40}$/.test(m.code) && typeof m.label === 'string' && m.label.length <= 80 && date(m.at) && MILESTONE_STATES.includes(m.state))
      && new Set(s.milestones.map(m => m.code)).size === s.milestones.length
      && !!s.confirmedDates && typeof s.confirmedDates === 'object' && Object.entries(s.confirmedDates).every(([k, v]) => ['promisedShipDate', 'estimatedReturnDate'].includes(k) && v instanceof Date && Number.isFinite(v.getTime()));
  }
  async function loadOwnDraft(session, binding, draftId) {
    const d = await c('cs_complaint_drafts').findOne({ _id: uuid(draftId), tenantId: binding.tenantId, customerId: binding.customerId, bindingId: binding._id }, { session });
    return d ?? fail('NOT_FOUND');
  }
  async function ownSnapshot(session, binding, orderNumber) {
    if (orderReader) {
      let timer, snapshot;
      try {
        snapshot = await Promise.race([orderReader.readCustomerOrder({tenantId: binding.tenantId, plantId: binding.plantId, customerId: binding.customerId, orderNumber}, { session }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), orderReaderTimeoutMs); })]);
        if (snapshot !== null && (snapshot.source !== 'PORTFOLIO_API_OWNED' || snapshot.orderNumber !== orderNumber || !ORDER_PUBLIC_STAGES.includes(snapshot.publicStage) || !Number.isSafeInteger(snapshot.sourceVersion) || snapshot.sourceVersion < 1 || typeof snapshot.sourceId !== 'string' || !(snapshot.asOf instanceof Date) || !Number.isFinite(snapshot.asOf.getTime()) || now() - snapshot.asOf > orderMaxStaleMs || snapshot.asOf > now() || !validOrderDetail(snapshot))) fail('STATUS_UNAVAILABLE');
      } catch { fail('STATUS_UNAVAILABLE'); } finally { clearTimeout(timer); }
      if (!snapshot) fail('NOT_FOUND');
      return {orderNumber: snapshot.orderNumber, publicStage: snapshot.publicStage, progress: snapshot.progress, source: snapshot.source, sourceId: snapshot.sourceId, sourceVersion: snapshot.sourceVersion, asOf: snapshot.asOf, liveLookup: true, ...(snapshot.kind === undefined ? {} : { kind: snapshot.kind, milestones: snapshot.milestones.map(m => ({ code: m.code, label: m.label, at: m.at, state: m.state })), confirmedDates: { ...snapshot.confirmedDates } })};
    }
    if (!allowSyntheticOrders) fail('STATUS_UNAVAILABLE');
    const s = await c('cs_order_snapshots').findOne({ tenantId: binding.tenantId, plantId: binding.plantId, customerId: binding.customerId, orderNumber }, { session });
    if (!s) fail('NOT_FOUND');
    if (s.source !== SYNTHETIC_ORDER_SOURCE || !validOrderDetail(s)) fail('STATUS_UNAVAILABLE');
    return { orderNumber: s.orderNumber, publicStage: s.publicStage, progress: s.progress,
      source: SYNTHETIC_ORDER_SOURCE, liveLookup: false, asOf: s.asOf,
      ...(s.kind === undefined ? {} : { kind: s.kind, milestones: s.milestones.map(({ code, label, at, state }) => ({ code, label, at, state })), confirmedDates: structuredClone(s.confirmedDates) }) };
  }

  const api = {
    async getDraft(principal, {draftId}) { const b=await customerContext(principal); return draftView(await loadOwnDraft(undefined,b,draftId)); },
    async getDraftByRequestKey(principal,{requestKey}) { const b=await customerContext(principal);const d=await c('cs_complaint_drafts').findOne({tenantId:b.tenantId,bindingId:b._id,requestKey:key(requestKey)});return d?draftView(d):null; },
    async getActiveDraft(principal) { const b=await customerContext(principal);const conv=await c('cs_conversations').findOne({tenantId:b.tenantId,bindingId:b._id});if(!conv?.activeDraftId)return null;return draftView(await loadOwnDraft(undefined,b,conv.activeDraftId)); },
    async handleInboundCommand(principal,{inboundKey,text:body,command}) {
      key(inboundKey);const inboundText=text(body,4096);
      const result=await tx(async session=>{
        const b=await customerContext(principal,session);
        return idempotent(session,{tenantId:b.tenantId,scope:'inbound.command',principal,owner:b._id,key:inboundKey,request:{text:inboundText,command}},async()=>{
          let conv=await conversationFor(session,b);
          await c('cs_inbound').insertOne({_id:randomUUID(),tenantId:b.tenantId,plantId:b.plantId,conversationId:conv._id,bindingId:b._id,inboundKey,text:inboundText,at:now()},{session});
          const result={deliveryIds:[]};
          let template=null,params={},detail={};
          let d=conv.activeDraftId ? await loadOwnDraft(session,b,conv.activeDraftId):null;
          if(conv.mode!=='BOT_ACTIVE' && command.op!=='HUMAN') return {...result,mode:conv.mode,reply:{state:'SUPPRESSED',deliveryId:null}};
          try {
            switch(command.op) {
              case 'MENU':template='menu';break;
              case 'ORDER': {
                const status=await api.getOrderStatusForCustomer(principal,{orderNumber:command.orderNumber});template='order_status';
                const next=status.milestones?.find(m=>m.state==='PENDING');
                params={orderNumber:status.orderNumber,publicStage:status.publicStage,source:status.source,...(status.kind?{kind:status.kind}:{}),...(next?{nextMilestone:next.label}:{}),...(status.progress?{released:String(status.progress.released),total:String(status.progress.total)}:{})};
                // Public, customer-safe order detail; the source id is the reader's opaque hash, never a raw record id.
                detail={source:{kind:status.sourceId?`${status.kind ?? 'MANUFACTURE'}_ORDER`:status.source,id:status.sourceId ?? null,sourceVersion:status.sourceVersion ?? null,asOf:status.asOf},order:{kind:status.kind ?? null,orderNumber:status.orderNumber,publicStage:status.publicStage,progress:status.progress ?? null,milestones:status.milestones ?? [],confirmedDates:status.confirmedDates ?? {},sourceVersion:status.sourceVersion ?? null,asOf:status.asOf}};
                break;
              }
              case 'TICKET':result.ticket=await api.getTicketForCustomer(principal,{ticketNumber:command.ticketNumber});template='ticket_status';params={ticketNumber:result.ticket.ticketNumber,stage:result.ticket.stage};break;
              case 'HUMAN':Object.assign(result,await api.requestHandoff(principal,{inboundKey}));break;
              case 'COMPLAINT':result.draft=d && OPEN_DRAFT.includes(d.stage) && d.expiresAt>now()?draftView(d):await api.startComplaintDraft(principal,{requestKey:inboundKey});break;
              case 'DRAFT':if(!d)fail('NO_ACTIVE_DRAFT');result.draft=await api.updateComplaintDraft(principal,{draftId:d._id,expectedVersion:d.version,action:command.action});if(command.action.type==='CANCEL')template='draft_cancel';else if(command.action.type==='BACK')template='draft_back';break;
              case 'CONFIRM':if(!d)fail('NO_ACTIVE_DRAFT');result.receipt=await api.confirmComplaint(principal,{draftId:d._id,expectedVersion:d.version,inboundKey});result.ticket=result.receipt;break;
              default:fail('UNKNOWN_COMMAND');
            }
          } catch(e) {if(!(e instanceof CustomerServiceError))throw e;result.error=e.code;template=command.op==='ORDER'?'status_unavailable':'validation_error';params={error:e.code};}
          if(result.draft && !template)template={ORDER_SELECTION:'draft_order',CATEGORY:'draft_category',DESCRIPTION:'draft_description',PREVIEW:'draft_preview'}[result.draft.stage];
          if(result.draft)params={...params,stage:result.draft.stage,description:result.draft.description??''};
          if(template){const row=await enqueue(session,conv,b,{kind:'BOT_REPLY',origin:'BOT',actionKey:`inbound:${b._id}:${inboundKey}`,payload:{template,templateVersion:1,params,...detail},ttlMs:botReplyTtlMs});result.reply={deliveryId:row._id,state:row.state};}
          await faultInjector('domain');
          if(result.draft || result.receipt)await c('cs_conversations').updateOne({_id:conv._id},{$set:{activeDraftId:result.receipt || result.draft.stage==='CANCELLED'?null:result.draft.draftId}},{session});
          await faultInjector('pointer');
          result.deliveryIds=(await c('cs_outbox').find({tenantId:b.tenantId,conversationId:conv._id},{session}).toArray()).filter(row=>row.actionKey===`inbound:${b._id}:${inboundKey}` || (result.receipt && row.actionKey===`ticket-ack:${result.receipt.ticketId}`) || (command.op==='HUMAN' && row.kind==='HANDOFF_ACK')).map(row=>row._id);
          await faultInjector('result');
          return result;
        });
      });
      await faultInjector('afterCommit');
      return result;
    },

    async initialize() {
      const ix = [
        ['cs_inbound', {tenantId:1,bindingId:1,inboundKey:1}, {unique:true}],
        ['cs_customers', { tenantId: 1, plantId: 1 }, {}],
        ['cs_contact_bindings', { tenantId: 1, channelAccountId: 1, providerContactId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } }],
        ['cs_contact_bindings', { tenantId: 1, plantId: 1, verifiedAt: 1, _id: 1 }, {}],
        ['cs_order_snapshots', { tenantId: 1, customerId: 1, orderNumber: 1 }, { unique: true }],
        ['cs_complaint_drafts', { tenantId: 1, bindingId: 1, requestKey: 1 }, { unique: true }],
        ['cs_tickets', { draftId: 1 }, { unique: true }],
        ['cs_tickets', { tenantId: 1, ticketNumber: 1 }, { unique: true }],
        ['cs_tickets', { tenantId: 1, plantId: 1, stage: 1, assigneeId: 1 }, {}],
        ['cs_ticket_events', { tenantId: 1, ticketId: 1, at: 1 }, {}],
        ['cs_internal_notes', { tenantId: 1, ticketId: 1, at: 1 }, {}],
        ['cs_conversations', { tenantId: 1, bindingId: 1 }, { unique: true }],
        ['cs_conversation_events', { tenantId: 1, conversationId: 1, at: 1 }, {}],
        ['cs_outbox', { tenantId: 1, actionKey: 1 }, { unique: true }],
        ['cs_outbox', { tenantId: 1, channelAccountId: 1, state: 1, seq: 1 }, {}],
        ['cs_outbox', { tenantId: 1, conversationId: 1, state: 1 }, {}],
        ['cs_idempotency', { tenantId: 1, scope: 1, owner: 1, key: 1 }, { unique: true }],
        ['cs_counters', { _id: 1 }, null],
        ['cs_audit', { tenantId: 1, at: 1 }, {}]
      ];
      for (const [name, spec, opts] of ix) {
        if (opts === null) { if (!(await db.listCollections({ name }).toArray()).length) await db.createCollection(name); continue; }
        await c(name).createIndex(spec, opts);
      }
    },

    async provisionFixtureCustomer(scope, { plantId, customerId, label }) {
      const g = await operator(scope, plantId, 'cs.fixture.admin');
      uuid(customerId);
      return operatorTx(scope, plantId, 'cs.fixture.admin', async (session, g) => {
        await c('cs_customers').insertOne({ _id: customerId, tenantId: g.tenantId, plantId: g.plantId, label: text(label, 120), synthetic: true, createdAt: now() }, { session });
        await audit(session, g.tenantId, 'fixture.customer.created', customerId, { type: 'OPERATOR', userId: g.userId });
        return customerId;
      });
    },

    async bindContact(scope, { plantId, bindingId, customerId, channelAccountId, providerContactId }) {
      const g = await operator(scope, plantId, 'cs.fixture.admin');
      uuid(bindingId); uuid(customerId); key(channelAccountId); key(providerContactId);
      return operatorTx(scope, plantId, 'cs.fixture.admin', async (session, g) => {
        if (!(await c('cs_customers').findOne({ _id: customerId, tenantId: g.tenantId, plantId: g.plantId }, { session }))) fail('NOT_FOUND');
        await c('cs_contact_bindings').insertOne({ _id: bindingId, tenantId: g.tenantId, plantId: g.plantId, customerId, channelAccountId, providerContactId, verifiedMethod: 'ADMIN_FIXTURE', verifiedAt: now(), status: 'ACTIVE', version: 1 }, { session });
        await audit(session, g.tenantId, 'binding.created', bindingId, { type: 'OPERATOR', userId: g.userId });
        return bindingId;
      });
    },

    async revokeBinding(scope, { plantId, bindingId, expectedVersion }) {
      const g = await operator(scope, plantId, 'cs.fixture.admin');
      uuid(bindingId); version(expectedVersion);
      return operatorTx(scope, plantId, 'cs.fixture.admin', async (session, g) => {
        const res = await c('cs_contact_bindings').updateOne({ _id: bindingId, tenantId: g.tenantId, plantId: g.plantId, status: 'ACTIVE', version: expectedVersion }, { $set: { status: 'REVOKED', revokedAt: now() }, $inc: { version: 1 } }, { session });
        if (res.matchedCount !== 1) fail('VERSION_CONFLICT');
        const at = now();
        const cancelled = await c('cs_outbox').updateMany({ tenantId: g.tenantId, bindingId, state: 'QUEUED' }, { $set: { state: 'CANCELLED', cancelReason: 'BINDING_REVOKED', updatedAt: at }, $push: { history: { state: 'CANCELLED', reason: 'BINDING_REVOKED', at } } }, { session });
        await audit(session, g.tenantId, 'binding.revoked', bindingId, { type: 'OPERATOR', userId: g.userId });
        return { bindingId, version: expectedVersion + 1, cancelledDeliveries: cancelled.modifiedCount };
      });
    },

    async registerSyntheticOrderSnapshot(scope, { plantId, customerId, orderNumber, publicStage, progress = null, kind, milestones, confirmedDates }) {
      const g = await operator(scope, plantId, 'cs.fixture.admin');
      uuid(customerId); orderNo(orderNumber); oneOf(publicStage, ORDER_PUBLIC_STAGES);
      if (progress !== null && !(Number.isSafeInteger(progress?.released) && Number.isSafeInteger(progress?.total) && progress.released >= 0 && progress.total > 0 && progress.released <= progress.total)) fail('INVALID_INPUT');
      if (!validOrderDetail({ kind, milestones, confirmedDates })) fail('INVALID_INPUT');
      const detail = kind === undefined ? {} : { kind, milestones: structuredClone(milestones.map(({ code, label, at, state }) => ({ code, label, at, state }))), confirmedDates: structuredClone(confirmedDates) };
      const progressCopy = progress === null ? null : { released: progress.released, total: progress.total };
      return operatorTx(scope, plantId, 'cs.fixture.admin', async (session, g) => {
        if (!(await c('cs_customers').findOne({ _id: customerId, tenantId: g.tenantId, plantId: g.plantId }, { session }))) fail('NOT_FOUND');
        const at = now();
        await c('cs_order_snapshots').insertOne({ _id: randomUUID(), tenantId: g.tenantId, plantId: g.plantId, customerId, orderNumber, publicStage, progress: progressCopy, ...detail, source: SYNTHETIC_ORDER_SOURCE, liveLookup: false, asOf: at }, { session });
        await audit(session, g.tenantId, 'fixture.order_snapshot.created', customerId, { type: 'OPERATOR', userId: g.userId });
        return { orderNumber, source: SYNTHETIC_ORDER_SOURCE };
      });
    },

    // Trusted bridge-side call: tenantId must come from the configured channel account, never message text.
    async resolveCustomerPrincipal({ tenantId, channelAccountId, providerContactId }) {
      uuid(tenantId); key(channelAccountId); key(providerContactId);
      const b = await c('cs_contact_bindings').findOne({ tenantId, channelAccountId, providerContactId, status: 'ACTIVE', ...unexpired() });
      if (!b) fail('DENIED');
      return registerPrincipal(b);
    },

    async getOrderStatusForCustomer(principal, { orderNumber }) {
      orderNo(orderNumber);
      return tx(async session => {
        const b = await customerContext(principal, session);
        const s = await ownSnapshot(session, b, orderNumber);
        return { orderNumber: s.orderNumber, publicStage: s.publicStage, progress: s.progress, asOf: s.asOf, source: s.source, liveLookup: s.liveLookup ?? false, ...(s.sourceId ? {sourceId:s.sourceId, sourceVersion:s.sourceVersion} : {}), ...(s.kind ? { kind: s.kind, milestones: s.milestones, confirmedDates: s.confirmedDates } : {}) };
      });
    },

    async startComplaintDraft(principal, { requestKey }) {
      key(requestKey);
      return tx(async session => {
        const b = await customerContext(principal, session);
        return immutableRoot(session,{tenantId:b.tenantId,scope:'complaint.start',owner:b._id,key:requestKey,request:{},principal},async()=>{
        const existing = await c('cs_complaint_drafts').findOne({ tenantId: b.tenantId, bindingId: b._id, requestKey }, { session });
        if (existing) return draftView(existing);
        const at = now();
        const d = { _id: randomUUID(), tenantId: b.tenantId, plantId: b.plantId, customerId: b.customerId, bindingId: b._id, requestKey, stage: 'ORDER_SELECTION', version: 1, orderNumber: null, category: null, description: null, createdAt: at, updatedAt: at, expiresAt: new Date(at.getTime() + draftTtlMs) };
        await c('cs_complaint_drafts').insertOne(d, { session });
        return draftView(d);
        },async()=>{const d=await c('cs_complaint_drafts').findOne({tenantId:b.tenantId,bindingId:b._id,requestKey},{session});return d?draftView(d):null;});
      });
    },

    async updateComplaintDraft(principal, { draftId, expectedVersion, action, commandKey }) {
      version(expectedVersion);
      if (!action || typeof action.type !== 'string') fail('INVALID_INPUT');
      const types={SELECT_ORDER:()=>({type:action.type,orderNumber:orderNo(action.orderNumber)}),GENERAL_INQUIRY:()=>({type:action.type}),SELECT_CATEGORY:()=>({type:action.type,category:oneOf(action.category,COMPLAINT_CATEGORIES)}),DESCRIBE:()=>({type:action.type,text:text(action.text)}),BACK:()=>({type:action.type}),CANCEL:()=>({type:action.type})};
      if(!types[action.type])fail('INVALID_INPUT');action=types[action.type]();
      return tx(async session => {
        const b = await customerContext(principal, session);
        return immutableRoot(session,{tenantId:b.tenantId,scope:'complaint.update',owner:b._id,key:commandKey,request:{draftId,expectedVersion,action},principal},async()=>{
        const d = await loadOwnDraft(session, b, draftId);
        if (d.version !== expectedVersion) fail('VERSION_CONFLICT');
        if (!OPEN_DRAFT.includes(d.stage)) fail('INVALID_TRANSITION');
        if (d.expiresAt <= now()) fail('DRAFT_EXPIRED');
        const need = stage => { if (d.stage !== stage) fail('INVALID_TRANSITION'); };
        let set;
        switch (action.type) {
          case 'SELECT_ORDER': need('ORDER_SELECTION'); await ownSnapshot(session, b, orderNo(action.orderNumber)); set = { stage: 'CATEGORY', orderNumber: action.orderNumber }; break;
          case 'GENERAL_INQUIRY': need('ORDER_SELECTION'); set = { stage: 'CATEGORY', orderNumber: null }; break;
          case 'SELECT_CATEGORY': need('CATEGORY'); set = { stage: 'DESCRIPTION', category: oneOf(action.category, COMPLAINT_CATEGORIES) }; break;
          case 'DESCRIBE': need('DESCRIPTION'); set = { stage: 'PREVIEW', description: text(action.text) }; break;
          case 'BACK': if (!DRAFT_BACK[d.stage]) fail('INVALID_TRANSITION'); set = { stage: DRAFT_BACK[d.stage] }; break;
          case 'CANCEL': set = { stage: 'CANCELLED' }; break;
          default: fail('INVALID_INPUT');
        }
        const res = await c('cs_complaint_drafts').findOneAndUpdate({ _id: d._id, version: d.version }, { $set: { ...set, updatedAt: now() }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
        return res ? draftView(res) : fail('VERSION_CONFLICT');
        });
      });
    },

    // Ticket, CREATED history, conversation link, ack outbox, idempotency and audit commit together; the number is returned only after commit.
    async confirmComplaint(principal, { draftId, expectedVersion, inboundKey }) {
      uuid(draftId); version(expectedVersion); key(inboundKey);
      return tx(async session => {
        const b = await customerContext(principal, session);
        return idempotent(session, { tenantId: b.tenantId, scope: 'complaint.confirm', principal, owner: b._id, key: inboundKey, request: { draftId, expectedVersion } }, async () => {
          const d = await loadOwnDraft(session, b, draftId);
          if (d.stage === 'CONFIRMED') {
            const t = await c('cs_tickets').findOne({ draftId: d._id, tenantId: b.tenantId }, { session });
            return { ticketId: t._id, ticketNumber: t.ticketNumber };
          }
          if (d.stage !== 'PREVIEW') fail('INVALID_TRANSITION');
          if (d.version !== expectedVersion) fail('VERSION_CONFLICT');
          if (d.expiresAt <= now()) fail('DRAFT_EXPIRED');
          if (d.orderNumber) await ownSnapshot(session, b, d.orderNumber);
          const moved = await c('cs_complaint_drafts').updateOne({ _id: d._id, version: d.version, stage: 'PREVIEW' }, { $set: { stage: 'CONFIRMED', updatedAt: now() }, $inc: { version: 1 } }, { session });
          if (moved.matchedCount !== 1) fail('VERSION_CONFLICT');
          const counter = await c('cs_counters').findOneAndUpdate({ _id: `${b.tenantId}:ticket` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
          const at = now();
          let conv = await conversationFor(session, b);
          const ticket = {
            _id: randomUUID(), tenantId: b.tenantId, plantId: b.plantId, customerId: b.customerId, bindingId: b._id, draftId: d._id, conversationId: conv._id,
            ticketNumber: `CS-${String(counter.seq).padStart(6, '0')}`, category: d.category, orderNumber: d.orderNumber,
            orderSource: d.orderNumber ? (orderReader ? 'PORTFOLIO_API_OWNED' : SYNTHETIC_ORDER_SOURCE) : null, description: d.description, stage: 'NEW', version: 1, assigneeId: null,
            dataOrigin: b.channel === 'SIMULATED' || b.verifiedMethod === 'ADMIN_FIXTURE' ? 'SYNTHETIC_RUNTIME' : 'UNKNOWN',
            requiresHuman: d.category === 'SAFETY_OR_DAMAGE', createdAt: at, updatedAt: at
          };
          await c('cs_tickets').insertOne(ticket, { session });
          await c('cs_ticket_events').insertOne({ _id: randomUUID(), tenantId: b.tenantId, ticketId: ticket._id, kind: 'CREATED', visibility: 'CUSTOMER', historyOrigin: 'RECORDED', fromStage: null, toStage: 'NEW', version: 1, actor: { type: 'CUSTOMER', customerId: b.customerId }, reason: null, at }, { session });
          const linked = await c('cs_conversations').findOneAndUpdate({ _id: conv._id, version: conv.version }, { $set: { activeTicketId: ticket._id }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
          if (!linked) fail('VERSION_CONFLICT');
          conv = linked;
          await enqueue(session, conv, b, { kind: 'TICKET_ACK', origin: 'SYSTEM', actionKey: `ticket-ack:${ticket._id}`, payload: { template: 'ticket_ack', ticketNumber: ticket.ticketNumber }, ttlMs: ackTtlMs, ticketId: ticket._id });
          if (ticket.requiresHuman && conv.mode === 'BOT_ACTIVE') await changeMode(session, conv, 'HUMAN_PENDING', { type: 'SYSTEM' }, 'SAFETY_OR_DAMAGE_COMPLAINT');
          await audit(session, b.tenantId, 'complaint.confirmed', ticket._id, { type: 'CUSTOMER', customerId: b.customerId });
          return { ticketId: ticket._id, ticketNumber: ticket.ticketNumber };
        });
      });
    },

    async getTicketForCustomer(principal, { ticketNumber }) {
      if (typeof ticketNumber !== 'string' || !/^CS-\d{6}$/.test(ticketNumber)) fail('INVALID_INPUT');
      return tx(async session => {
        const b = await customerContext(principal, session);
        const t = await c('cs_tickets').findOne({ tenantId: b.tenantId, plantId: b.plantId, customerId: b.customerId, ticketNumber }, { session });
        if (!t) fail('NOT_FOUND');
        const events = await c('cs_ticket_events').find({ tenantId: b.tenantId, ticketId: t._id, visibility: 'CUSTOMER' }, { session }).sort({ at: 1, version: 1 }).toArray();
        return { ticketNumber: t.ticketNumber, stage: t.stage, category: t.category, orderNumber: t.orderNumber, updatedAt: t.updatedAt, updates: events.map(e => ({ kind: e.kind, stage: e.toStage, text: e.text ?? null, at: e.at })) };
      });
    },

    async addCustomerComment(principal, { ticketNumber, inboundKey, text: body }) {
      key(inboundKey); const t0 = text(body);
      return tx(async session => {
        const b = await customerContext(principal, session);
        return idempotent(session, { tenantId: b.tenantId, scope: 'ticket.customer_comment', principal, owner: b._id, key: inboundKey, request: { ticketNumber, text: t0 } }, async () => {
          const t = await c('cs_tickets').findOne({ tenantId: b.tenantId, customerId: b.customerId, ticketNumber }, { session });
          if (!t) fail('NOT_FOUND');
          if (t.stage === 'CLOSED') fail('INVALID_TRANSITION');
          const eventId = randomUUID();
          await c('cs_ticket_events').insertOne({ _id: eventId, tenantId: b.tenantId, ticketId: t._id, historyOrigin: 'RECORDED', kind: 'CUSTOMER_COMMENT', visibility: 'CUSTOMER', fromStage: t.stage, toStage: t.stage, version: t.version, actor: { type: 'CUSTOMER', customerId: b.customerId }, text: t0, at: now() }, { session });
          return { eventId };
        });
      });
    },

    async getTicketForOperator(scope, { plantId, ticketId }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      const t = await c('cs_tickets').findOne({ _id: uuid(ticketId), tenantId: g.tenantId, plantId: g.plantId });
      if (!t) fail('NOT_FOUND');
      const history = await c('cs_ticket_events').find({ tenantId: g.tenantId, ticketId: t._id, visibility: 'CUSTOMER' }).sort({ at: 1, version: 1 }).toArray();
      return { ...ticketView(t), history: history.map(e => ({ eventId: e._id, ticketId: t._id, visibility: e.visibility, actor: Object.fromEntries(['type', 'userId', 'customerId'].filter(k => Object.hasOwn(e.actor ?? {}, k)).map(k => [k, e.actor[k]])), assigneeId: e.assigneeId ?? null, kind: e.kind, fromStage: e.fromStage, toStage: e.toStage, version: e.version, text: e.text ?? null, reason: e.reason ?? null, at: e.at, historyOrigin: e.seeded === true ? 'SEEDED' : e.historyOrigin ?? 'UNKNOWN' })) };
    },

    async listTicketsPage(scope, { plantId, stage, assigneeId, limit, cursor }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      const n = pageLimit(limit), cur = decodeCursor(cursor);
      const filter = { tenantId: g.tenantId, plantId: g.plantId, ...after('createdAt', cur) };
      if (stage !== undefined) filter.stage = oneOf(stage, TICKET_STAGES);
      if (assigneeId !== undefined) filter.assigneeId = assigneeId === null ? null : uuid(assigneeId);
      return page(await c('cs_tickets').find(filter).sort({ createdAt: 1, _id: 1 }).limit(n + 1).toArray(), n, 'createdAt', ticketView);
    },

    async listConversationsPage(scope, { plantId, mode, limit, cursor }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      const n = pageLimit(limit), cur = decodeCursor(cursor);
      const filter = { tenantId: g.tenantId, plantId: g.plantId, ...after('createdAt', cur) };
      if (mode !== undefined) filter.mode = oneOf(mode, CONVERSATION_MODES);
      const rows = await c('cs_conversations').find(filter).sort({ createdAt: 1, _id: 1 }).limit(n + 1).toArray();
      const shown = rows.slice(0, n);
      const labels = new Map((await c('cs_customers').find({ tenantId: g.tenantId, _id: { $in: shown.map(r => r.customerId) } }).toArray()).map(x => [x._id, x.label]));
      const unknown = new Set(await c('cs_outbox').distinct('conversationId', { tenantId: g.tenantId, conversationId: { $in: shown.map(r => r._id) }, state: { $in: ['UNKNOWN', 'SENDING'] } }));
      return page(rows, n, 'createdAt', r => ({ conversationId: r._id, mode: r.mode, version: r.version, assigneeId: r.assigneeId, activeTicketId: r.activeTicketId, customerLabel: labels.get(r.customerId) ?? 'Customer', lastActivityAt: r.lastActivityAt, hasUnknownDelivery: unknown.has(r._id) }));
    },

    // Thread merges recorded inbound text and outbox rows; internal notes are a separate collection and never read here.
    async getConversationThread(scope, { plantId, conversationId, limit, cursor }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      const n = pageLimit(limit), cur = decodeCursor(cursor);
      const conv = await c('cs_conversations').findOne({ _id: uuid(conversationId), tenantId: g.tenantId, plantId: g.plantId });
      if (!conv) fail('NOT_FOUND');
      const scoped = { tenantId: g.tenantId, conversationId: conv._id };
      const inbound = (await c('cs_inbound').find({ ...scoped, ...after('at', cur) }).sort({ at: 1, _id: 1 }).limit(n + 1).toArray())
        .map(m => ({ _id: m._id, at: m.at, view: { messageId: m._id, direction: 'INBOUND', origin: 'CUSTOMER', kind: 'CUSTOMER_TEXT', text: m.text, state: 'RECEIVED', at: m.at } }));
      const outbound = (await c('cs_outbox').find({ ...scoped, ...after('createdAt', cur) }).sort({ createdAt: 1, _id: 1 }).limit(n + 1).toArray())
        .map(m => ({ _id: m._id, at: m.createdAt, view: outboundView(m) }));
      const rows = [...inbound, ...outbound].sort((a, b) => a.at - b.at || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
      return page(rows, n, 'at', r => r.view);
    },

    async listTickets(scope, { plantId, stage, assigneeId, limit = 50 }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('INVALID_INPUT');
      const filter = { tenantId: g.tenantId, plantId: g.plantId };
      if (stage !== undefined) filter.stage = oneOf(stage, TICKET_STAGES);
      if (assigneeId !== undefined) filter.assigneeId = assigneeId === null ? null : uuid(assigneeId);
      return (await c('cs_tickets').find(filter).sort({ createdAt: 1, _id: 1 }).limit(limit).toArray()).map(ticketView);
    },

    async transitionTicket(scope, { plantId, ticketId, expectedVersion, toStage, reason, assigneeId, commandKey }) {
      const g = await operator(scope, plantId, 'cs.ticket.write');
      uuid(ticketId); version(expectedVersion); oneOf(toStage, TICKET_STAGES); const why = text(reason, 500); key(commandKey);
      if (toStage === 'ASSIGNED') uuid(assigneeId); else if (assigneeId !== undefined) fail('INVALID_INPUT');
      return operatorTx(scope, plantId, 'cs.ticket.write', async (session, g) => {
        if (toStage === 'REOPENED') {
          const closed = await c('cs_tickets').findOne({ _id: ticketId, tenantId: g.tenantId, plantId: g.plantId, stage: 'CLOSED' }, { session });
          const replay = await c('cs_ticket_events').findOne({ tenantId: g.tenantId, ticketId, fromStage: 'CLOSED', toStage: 'REOPENED', version: expectedVersion + 1, 'actor.userId': g.userId }, { session });
          if (closed || replay) await operator(scope, plantId, 'cs.ticket.reopen_closed');
        }
        return idempotent(session, { tenantId: g.tenantId, scope: 'ticket.transition', owner: g.userId, key: commandKey, request: { ticketId, expectedVersion, toStage, reason: why, assigneeId: assigneeId ?? null } }, async () => {
        const t = await c('cs_tickets').findOne({ _id: ticketId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!t) fail('NOT_FOUND');
        if (t.version !== expectedVersion) fail('VERSION_CONFLICT');
        if (!TICKET_TRANSITIONS[t.stage].includes(toStage)) fail('INVALID_TRANSITION');
        if (t.stage === 'CLOSED') await operator(scope, plantId, 'cs.ticket.reopen_closed');
        const set = { stage: toStage, updatedAt: now() };
        if (toStage === 'ASSIGNED') set.assigneeId = assigneeId;
        if (toStage === 'RESOLVED') set.resolvedAt = now();
        if (toStage === 'CLOSED') set.closedAt = now();
        const res = await c('cs_tickets').updateOne({ _id: t._id, version: t.version }, { $set: set, $inc: { version: 1 } }, { session });
        if (res.matchedCount !== 1) fail('VERSION_CONFLICT');
        await c('cs_ticket_events').insertOne({ _id: randomUUID(), tenantId: g.tenantId, ticketId: t._id, historyOrigin: 'RECORDED', kind: 'STAGE_CHANGED', visibility: 'CUSTOMER', fromStage: t.stage, toStage, version: t.version + 1, actor: { type: 'OPERATOR', userId: g.userId }, reason: why, assigneeId: set.assigneeId ?? t.assigneeId, at: now() }, { session });
        if(toStage==='RESOLVED') {
          const b=await c('cs_contact_bindings').findOne({_id:t.bindingId,tenantId:g.tenantId,status:'ACTIVE',...unexpired()},{session});
          const conv=await c('cs_conversations').findOne({tenantId:g.tenantId,bindingId:t.bindingId},{session});
          if(b && conv)await enqueue(session,conv,b,{kind:'TICKET_RESOLVED',origin:'SYSTEM',actionKey:`resolved:${t._id}:${t.version+1}`,payload:{template:'resolved',params:{ticketNumber:t.ticketNumber}},ttlMs:ackTtlMs,ticketId:t._id});
        }
        await audit(session, g.tenantId, `ticket.${toStage.toLowerCase()}`, t._id, { type: 'OPERATOR', userId: g.userId });
        return { ticketId: t._id, stage: toStage, version: t.version + 1 };
        });
      });
    },

    async addPublicUpdate(scope, { plantId, ticketId, expectedVersion, text: body, commandKey }) {
      const g = await operator(scope, plantId, 'cs.ticket.write');
      uuid(ticketId); version(expectedVersion); const t0 = text(body); key(commandKey);
      return operatorTx(scope, plantId, 'cs.ticket.write', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'ticket.public_update', owner: g.userId, key: commandKey, request: { ticketId, expectedVersion, text: t0 } }, async () => {
        const res = await c('cs_tickets').findOneAndUpdate({ _id: ticketId, tenantId: g.tenantId, plantId: g.plantId, version: expectedVersion }, { $set: { updatedAt: now() }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
        if (!res) fail((await c('cs_tickets').countDocuments({ _id: ticketId, tenantId: g.tenantId, plantId: g.plantId }, { session })) ? 'VERSION_CONFLICT' : 'NOT_FOUND');
        await c('cs_ticket_events').insertOne({ _id: randomUUID(), tenantId: g.tenantId, ticketId, historyOrigin: 'RECORDED', kind: 'PUBLIC_UPDATE', visibility: 'CUSTOMER', fromStage: res.stage, toStage: res.stage, version: res.version, actor: { type: 'OPERATOR', userId: g.userId }, text: t0, at: now() }, { session });
        await audit(session, g.tenantId, 'ticket.public_update', ticketId, { type: 'OPERATOR', userId: g.userId });
        return { ticketId, version: res.version };
      }));
    },

    // Internal notes live in their own collection and are never joined into customer projections.
    async addInternalNote(scope, { plantId, ticketId, text: body, commandKey }) {
      const g = await operator(scope, plantId, 'cs.note.internal');
      uuid(ticketId); const t0 = text(body, 4000); key(commandKey);
      return operatorTx(scope, plantId, 'cs.note.internal', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'ticket.internal_note', owner: g.userId, key: commandKey, request: { ticketId, text: t0 } }, async () => {
        if (!(await c('cs_tickets').findOne({ _id: ticketId, tenantId: g.tenantId, plantId: g.plantId }, { session }))) fail('NOT_FOUND');
        const noteId = randomUUID();
        await c('cs_internal_notes').insertOne({ _id: noteId, tenantId: g.tenantId, plantId: g.plantId, ticketId, authorUserId: g.userId, text: t0, at: now() }, { session });
        await audit(session, g.tenantId, 'ticket.internal_note', ticketId, { type: 'OPERATOR', userId: g.userId });
        return { noteId };
      }));
    },

    async listInternalNotes(scope, { plantId, ticketId }) {
      const g = await operator(scope, plantId, 'cs.note.internal');
      const rows = await c('cs_internal_notes').find({ tenantId: g.tenantId, plantId: g.plantId, ticketId: uuid(ticketId) }).sort({ at: 1, _id: 1 }).toArray();
      return rows.map(n => ({ noteId: n._id, authorUserId: n.authorUserId, text: n.text, at: n.at }));
    },

    async enqueueBotReply(principal, { inboundKey, template, params = {} }) {
      key(inboundKey); oneOf(template, BOT_TEMPLATES);
      if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length > 10 || !Object.values(params).every(v => typeof v === 'string' && v.length <= 200)) fail('INVALID_INPUT');
      return tx(async session => {
        const b = await customerContext(principal, session);
        return immutableRoot(session,{tenantId:b.tenantId,scope:'conversation.bot_reply',owner:b._id,key:inboundKey,request:{template,params},principal},async()=>{
        const conv = await conversationFor(session, b);
        const existing = await c('cs_outbox').findOne({ tenantId: b.tenantId, actionKey: `bot-reply:${b._id}:${inboundKey}` }, { session });
        if (existing) return existing.payloadHash === requestHash({ template, params }) ? { deliveryId: existing._id, state: existing.state } : fail('IDEMPOTENCY_CONFLICT');
        if (conv.mode !== 'BOT_ACTIVE') return { deliveryId: null, state: 'SUPPRESSED', mode: conv.mode };
        const row = await enqueue(session, conv, b, { kind: 'BOT_REPLY', origin: 'BOT', actionKey: `bot-reply:${b._id}:${inboundKey}`, payload: { template, params }, ttlMs: botReplyTtlMs });
        return { deliveryId: row._id, state: row.state };
        },async()=>{const d=await c('cs_outbox').findOne({tenantId:b.tenantId,actionKey:`bot-reply:${b._id}:${inboundKey}`},{session});if(d&&d.payloadHash!==requestHash({template,params}))fail('IDEMPOTENCY_CONFLICT');return d?{deliveryId:d._id,state:d.state}:null;});
      });
    },

    async requestHandoff(principal, { inboundKey }) {
      key(inboundKey);
      return tx(async session => {
        const b = await customerContext(principal, session);
        return idempotent(session, { tenantId: b.tenantId, scope: 'conversation.handoff_request', principal, owner: b._id, key: inboundKey, request: {} }, async () => {
          const conv = await conversationFor(session, b);
          if (conv.mode !== 'BOT_ACTIVE') return { conversationId: conv._id, mode: conv.mode, version: conv.version, cancelledDeliveryIds: [], inFlightDeliveryIds: [] };
          const r = await changeMode(session, conv, 'HUMAN_PENDING', { type: 'CUSTOMER', customerId: b.customerId }, 'CUSTOMER_REQUESTED_HUMAN');
          await enqueue(session, { ...conv, modeEpoch: conv.modeEpoch + 1 }, b, { kind: 'HANDOFF_ACK', origin: 'SYSTEM', actionKey: `handoff-ack:${conv._id}:${conv.modeEpoch + 1}`, payload: { template: 'handoff_queued' }, ttlMs: ackTtlMs });
          await audit(session, b.tenantId, 'conversation.handoff_requested', conv._id, { type: 'CUSTOMER', customerId: b.customerId });
          return r;
        });
      });
    },

    async takeOverConversation(scope, { plantId, conversationId, expectedVersion, commandKey }) {
      const g = await operator(scope, plantId, 'cs.conversation.handoff');
      uuid(conversationId); version(expectedVersion); key(commandKey);
      return operatorTx(scope, plantId, 'cs.conversation.handoff', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'conversation.takeover', owner: g.userId, key: commandKey, request: { conversationId, expectedVersion } }, async () => {
        const conv = await c('cs_conversations').findOne({ _id: conversationId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!conv) fail('NOT_FOUND');
        if (conv.version !== expectedVersion) fail('VERSION_CONFLICT');
        if (!['BOT_ACTIVE', 'HUMAN_PENDING', 'PAUSED'].includes(conv.mode)) fail('INVALID_TRANSITION');
        const r = await changeMode(session, conv, 'HUMAN_ACTIVE', { type: 'OPERATOR', userId: g.userId }, 'TAKEOVER', { assigneeId: g.userId });
        await audit(session, g.tenantId, 'conversation.takeover', conv._id, { type: 'OPERATOR', userId: g.userId });
        return r;
      }));
    },

    async setConversationMode(scope, { plantId, conversationId, expectedVersion, toMode, reason, commandKey }) {
      const g = await operator(scope, plantId, 'cs.conversation.handoff');
      uuid(conversationId); version(expectedVersion); oneOf(toMode, ['BOT_ACTIVE', 'PAUSED', 'CLOSED']); const why = text(reason, 500); key(commandKey);
      return operatorTx(scope, plantId, 'cs.conversation.handoff', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'conversation.mode', owner: g.userId, key: commandKey, request: { conversationId, expectedVersion, toMode, reason: why } }, async () => {
        const conv = await c('cs_conversations').findOne({ _id: conversationId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!conv) fail('NOT_FOUND');
        if (conv.version !== expectedVersion) fail('VERSION_CONFLICT');
        if (conv.mode === toMode || conv.mode === 'CLOSED') fail('INVALID_TRANSITION');
        if (conv.assigneeId && conv.assigneeId !== g.userId) fail('DENIED');
        const r = await changeMode(session, conv, toMode, { type: 'OPERATOR', userId: g.userId }, why, toMode === 'BOT_ACTIVE' ? { assigneeId: null } : {});
        await audit(session, g.tenantId, `conversation.${toMode.toLowerCase()}`, conv._id, { type: 'OPERATOR', userId: g.userId });
        return r;
      }));
    },

    async getConversationForOperator(scope, { plantId, conversationId }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      const conv = await c('cs_conversations').findOne({ _id: uuid(conversationId), tenantId: g.tenantId, plantId: g.plantId });
      if (!conv) fail('NOT_FOUND');
      const deliveries = await c('cs_outbox').find({ tenantId: g.tenantId, conversationId: conv._id }).sort({ seq: 1 }).toArray();
      return {
        conversationId: conv._id, mode: conv.mode, version: conv.version, assigneeId: conv.assigneeId, activeTicketId: conv.activeTicketId,
        deliveries: deliveries.map(d => ({ deliveryId: d._id, kind: d.kind, origin: d.origin, state: d.state, attempt: d.attempt, cancelReason: d.cancelReason ?? null, deliveryUncertain: d.state === 'UNKNOWN' || d.state === 'SENDING' }))
      };
    },

    async findConversationByBinding(scope, { plantId, bindingId }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      const conv = await c('cs_conversations').findOne({ tenantId: g.tenantId, plantId: g.plantId, bindingId: uuid(bindingId) });
      return conv ? { conversationId: conv._id, mode: conv.mode, version: conv.version } : fail('NOT_FOUND');
    },

    async operatorReply(scope, { plantId, conversationId, text: body, commandKey }) {
      const g = await operator(scope, plantId, 'cs.reply');
      uuid(conversationId); const t0 = text(body, 2000); key(commandKey);
      return operatorTx(scope, plantId, 'cs.reply', async (session, g) => immutableRoot(session,{tenantId:g.tenantId,scope:'conversation.operator_reply',owner:g.userId,key:commandKey,request:{conversationId,text:t0}},async()=>{
        const conv = await c('cs_conversations').findOne({ _id: conversationId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!conv) fail('NOT_FOUND');
        const actionKey = `operator-reply:${g.userId}:${commandKey}`;
        const existing = await c('cs_outbox').findOne({ tenantId: g.tenantId, actionKey }, { session });
        if (existing) return existing.payloadHash === requestHash({ template: 'operator_text', text: t0 }) && existing.conversationId === conversationId ? { deliveryId: existing._id, state: existing.state } : fail('IDEMPOTENCY_CONFLICT');
        if (conv.mode !== 'HUMAN_ACTIVE' || conv.assigneeId !== g.userId) fail('INVALID_TRANSITION');
        const b = await c('cs_contact_bindings').findOne({ _id: conv.bindingId, tenantId: g.tenantId, status: 'ACTIVE', ...unexpired() }, { session });
        if (!b) fail('DENIED');
        const row = await enqueue(session, conv, b, { kind: 'OPERATOR_REPLY', origin: 'OPERATOR', actionKey, payload: { template: 'operator_text', text: t0 }, ttlMs: ackTtlMs, actorUserId: g.userId, ticketId: conv.activeTicketId ?? null });
        await audit(session, g.tenantId, 'conversation.operator_reply', conv._id, { type: 'OPERATOR', userId: g.userId });
        return { deliveryId: row._id, state: row.state };
      },async()=>{const d=await c('cs_outbox').findOne({tenantId:g.tenantId,actionKey:`operator-reply:${g.userId}:${commandKey}`},{session});if(d&&(d.payloadHash!==requestHash({template:'operator_text',text:t0})||d.conversationId!==conversationId))fail('IDEMPOTENCY_CONFLICT');return d?{deliveryId:d._id,state:d.state}:null;}));
    },

    // ---- Wave 4f: trusted operator onboarding of synthetic bindings (cs.binding.*) ----
    // The server derives tenant/plant from the verified scope; the CRM account/contact must belong to it.
    // Knowing an address or order number never creates a binding: only this authorized operator command does.
    async createBinding(scope, { plantId, accountId, contactId, channel, address, expiresAt = null, idempotencyKey }) {
      await operator(scope, plantId, 'cs.binding.manage');
      const v = (ok) => { if (!ok) fail('VALIDATION'); };
      v(typeof accountId === 'string' && UUID_RE.test(accountId)); v(typeof contactId === 'string' && UUID_RE.test(contactId)); v(BINDING_CHANNELS.includes(channel));
      v(typeof idempotencyKey === 'string' && /^[A-Za-z0-9:_.-]{8,128}$/.test(idempotencyKey));
      if (typeof address !== 'string' || !SYNTHETIC_ADDRESS.test(address)) fail('SYNTHETIC_ADDRESS_REQUIRED');
      let expiry = null;
      if (expiresAt !== null) {
        v(typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) && new Date(expiresAt).toISOString() === expiresAt);
        expiry = new Date(expiresAt);
        v(expiry > now() && expiry - now() <= 366 * 24 * HOUR);
      }
      if (!partyDirectory) fail('DENIED');
      const providerContactId = `sim-${address.slice(1)}`;
      return operatorTx(scope, plantId, 'cs.binding.manage', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'binding.create', owner: g.plantId, key: idempotencyKey, request: { accountId, contactId, channel, address, expiresAt: expiry ? expiry.toISOString() : null }, conflictCode: 'IDEMPOTENCY_KEY_REUSED' }, async () => {
        const party = await partyDirectory.verifyCustomerContact({ tenantId: g.tenantId, plantId: g.plantId, accountId, contactId }, { session });
        if (!party) fail('NOT_FOUND');
        const at = now();
        const current = await c('cs_contact_bindings').findOne({ tenantId: g.tenantId, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, providerContactId, status: 'ACTIVE' }, { session });
        if (current && usable(current)) fail('BINDING_CONFLICT');
        if (current) {
          // An expired ACTIVE row is closed out explicitly (and its queued replies cancelled) before the address is rebound.
          const closed = await c('cs_contact_bindings').updateOne({ _id: current._id, tenantId: g.tenantId, status: 'ACTIVE', version: current.version }, { $set: { status: 'EXPIRED', expiredAt: at }, $inc: { version: 1 } }, { session });
          if (closed.matchedCount !== 1) fail('VERSION_CONFLICT');
          await c('cs_outbox').updateMany({ tenantId: g.tenantId, bindingId: current._id, state: 'QUEUED' }, { $set: { state: 'CANCELLED', cancelReason: 'BINDING_EXPIRED', updatedAt: at }, $push: { history: { state: 'CANCELLED', reason: 'BINDING_EXPIRED', at } } }, { session });
        }
        const customer = await c('cs_customers').findOne({ _id: accountId }, { session });
        if (customer && (customer.tenantId !== g.tenantId || customer.plantId !== g.plantId)) fail('NOT_FOUND');
        if (!customer) await c('cs_customers').insertOne({ _id: accountId, tenantId: g.tenantId, plantId: g.plantId, label: String(party.accountLabel || 'Customer').trim().slice(0, 120) || 'Customer', synthetic: true, source: 'CRM_ACCOUNT', createdAt: at }, { session });
        const binding = { _id: randomUUID(), tenantId: g.tenantId, plantId: g.plantId, customerId: accountId, accountId, contactId, channel, address, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, providerContactId, verifiedMethod: 'OPERATOR_ONBOARDING', verifiedAt: at, verifiedBy: g.userId, createdAt: at, expiresAt: expiry, status: 'ACTIVE', version: 1, synthetic: true };
        await c('cs_contact_bindings').insertOne(binding, { session });
        await audit(session, g.tenantId, 'binding.onboarded', binding._id, { type: 'OPERATOR', userId: g.userId });
        return { binding: bindingView(binding) };
      }));
    },

    async revokeBindingByOperator(scope, { plantId, bindingId, reason, expectedVersion, idempotencyKey }) {
      await operator(scope, plantId, 'cs.binding.manage');
      if (typeof bindingId !== 'string' || !UUID_RE.test(bindingId)) fail('NOT_FOUND');
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500 || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9:_.-]{8,128}$/.test(idempotencyKey)) fail('VALIDATION');
      const why = reason.trim();
      return operatorTx(scope, plantId, 'cs.binding.manage', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'binding.revoke', owner: g.plantId, key: idempotencyKey, request: { bindingId, reason: why, expectedVersion }, conflictCode: 'IDEMPOTENCY_KEY_REUSED' }, async () => {
        const b = await c('cs_contact_bindings').findOne({ _id: bindingId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!b) fail('NOT_FOUND');
        if (b.status !== 'ACTIVE') fail('BINDING_REVOKED', { currentVersion: b.version });
        if (b.version !== expectedVersion) fail('VERSION_CONFLICT', { currentVersion: b.version });
        const at = now();
        const updated = await c('cs_contact_bindings').findOneAndUpdate({ _id: b._id, tenantId: g.tenantId, status: 'ACTIVE', version: expectedVersion }, { $set: { status: 'REVOKED', revokedAt: at, revokedBy: g.userId, revokeReason: why }, $inc: { version: 1 } }, { session, returnDocument: 'after' });
        if (!updated) fail('VERSION_CONFLICT', { currentVersion: b.version });
        const cancelled = await c('cs_outbox').updateMany({ tenantId: g.tenantId, bindingId: b._id, state: 'QUEUED' }, { $set: { state: 'CANCELLED', cancelReason: 'BINDING_REVOKED', updatedAt: at }, $push: { history: { state: 'CANCELLED', reason: 'BINDING_REVOKED', at } } }, { session });
        await audit(session, g.tenantId, 'binding.revoked', b._id, { type: 'OPERATOR', userId: g.userId });
        return { binding: bindingView(updated), cancelledDeliveries: cancelled.modifiedCount };
      }));
    },

    async listBindingsPage(scope, { plantId, accountId, status, limit, cursor }) {
      const g = await operator(scope, plantId, 'cs.binding.read');
      const n = pageLimit(limit), cur = decodeCursor(cursor);
      const and = [{ tenantId: g.tenantId, plantId: g.plantId }];
      if (accountId !== undefined) and.push({ customerId: uuid(accountId) });
      if (status !== undefined) {
        const at = now();
        and.push({ ACTIVE: { status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: at } }] }, EXPIRED: { $or: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { $lte: at } }] }, REVOKED: { status: 'REVOKED' } }[oneOf(status, ['ACTIVE', 'EXPIRED', 'REVOKED'])]);
      }
      if (cur) and.push(after('verifiedAt', cur));
      return page(await c('cs_contact_bindings').find({ $and: and }).sort({ verifiedAt: 1, _id: 1 }).limit(n + 1).toArray(), n, 'verifiedAt', bindingView);
    },

    // Operator view of what the bound customer would see; a revoked/expired/foreign binding reads as NOT_FOUND.
    async getOrderStatusForBinding(scope, { plantId, bindingId, orderNumber }) {
      await operator(scope, plantId, 'cs.ticket.read');
      if (typeof bindingId !== 'string' || !UUID_RE.test(bindingId)) fail('NOT_FOUND');
      orderNo(orderNumber);
      return operatorTx(scope, plantId, 'cs.ticket.read', async (session, g) => {
        const b = await c('cs_contact_bindings').findOne({ _id: bindingId, tenantId: g.tenantId, plantId: g.plantId, status: 'ACTIVE', ...unexpired() }, { session });
        if (!b) fail('NOT_FOUND');
        const s = await ownSnapshot(session, b, orderNumber);
        // The write conflicts with concurrent revocation; expiry is checked after the bounded source read.
        const fenced = await c('cs_contact_bindings').updateOne({ _id: b._id, tenantId: g.tenantId, plantId: g.plantId, status: 'ACTIVE', version: b.version, ...unexpired() }, { $inc: { commandFence: 1 } }, { session });
        if (fenced.matchedCount !== 1) fail('NOT_FOUND');
        return { orderNumber: s.orderNumber, publicStage: s.publicStage, progress: s.progress, asOf: s.asOf, source: s.source, liveLookup: s.liveLookup ?? false, sourceId: s.sourceId ?? null, sourceVersion: s.sourceVersion ?? null, kind: s.kind ?? null, milestones: s.milestones ?? [], confirmedDates: s.confirmedDates ?? {} };
      });
    },

    // Product path for simulated inbound messages: same handleInboundCommand as the bridge, inside an operator transaction.
    async simulateInbound(scope, { plantId, bindingId, inboundKey, text: body }) {
      await operator(scope, plantId, 'cs.simulator.use');
      if (typeof bindingId !== 'string' || !UUID_RE.test(bindingId)) fail('NOT_FOUND');
      if (typeof inboundKey !== 'string' || !/^[A-Za-z0-9:_.-]{1,128}$/.test(inboundKey) || typeof body !== 'string' || !body.trim() || body.length > 4096) fail('VALIDATION');
      const command = parseInboundText(body);let disposition;
      return operatorTx(scope, plantId, 'cs.simulator.use', async (session, g) => {
        await operator(scope,plantId,'cs.ticket.read');
        const b = await c('cs_contact_bindings').findOne({ _id: bindingId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!b || b.channel !== 'SIMULATED') fail('NOT_FOUND');
        if (!usable(b)) fail('BINDING_REVOKED', { currentVersion: b.version });
        const result = await api.handleInboundCommand(registerPrincipal(b), { inboundKey, text: body, command });
        const conv = await c('cs_conversations').findOne({ tenantId: b.tenantId, bindingId: b._id }, { session });
        if(typeof disposition?.enrolled!=='boolean')fail('DENIED');
        return Object.defineProperty({conversationId:conv._id,bindingId:b._id,command:command.op,result},customerServiceDisposition,{value:disposition});
      },{onAdmission:value=>{disposition=value;}});
    },

    async dispatchLocalPreviews(scope,{plantId,commandKey,deliveryIds=null}) {
      key(commandKey);
      if(deliveryIds!==null&&(!Array.isArray(deliveryIds)||deliveryIds.length<1||deliveryIds.length>25||new Set(deliveryIds).size!==deliveryIds.length))fail('INVALID_INPUT');
      deliveryIds=deliveryIds===null?null:deliveryIds.map(uuid).sort();
      return operatorTx(scope,plantId,'cs.simulator.use',async(session,g)=>{
        await operator(scope,plantId,'cs.ticket.read');
        if(await c('sessions').findOne({tenantId:g.tenantId,userId:g.userId,automationService:true},{session}))fail('DENIED');
        return idempotent(session,{tenantId:g.tenantId,scope:'simulator.dispatch',owner:g.userId,key:commandKey,request:{deliveryIds}},async()=>{
          const rows=await previewRows(session,g,deliveryIds),previewedDeliveryIds=[];
          for(const d of rows){
            if(d.state==='QUEUED'){
              const at=now(),change=await c('cs_outbox').updateOne({_id:d._id,tenantId:g.tenantId,plantId:g.plantId,state:'QUEUED',fence:d.fence,leaseOwner:null,leaseUntil:null},{$set:{state:'PREVIEWED',providerMessageId:null,previewedAt:at,updatedAt:at},$inc:{fence:1},$push:{history:{state:'PREVIEWED',outcome:'LOCAL_PREVIEW',actorUserId:g.userId,at}}},{session});if(change.matchedCount!==1)fail('STALE_FENCE');
            }
            previewedDeliveryIds.push(d._id);
          }
          await audit(session,g.tenantId,'simulator.local_preview',g.plantId,{type:'OPERATOR',userId:g.userId});return {previewedDeliveryIds};
        });
      });
    },

    async getOutboundMessages(scope, { plantId, deliveryIds }) {
      const g = await operator(scope, plantId, 'cs.ticket.read');
      if (!Array.isArray(deliveryIds) || deliveryIds.length > 100 || !deliveryIds.every(x => typeof x === 'string' && UUID_RE.test(x))) fail('VALIDATION');
      const rows = await c('cs_outbox').find({ tenantId: g.tenantId, plantId: g.plantId, _id: { $in: deliveryIds } }).sort({ seq: 1 }).toArray();
      return rows.map(outboundView);
    },

    async getMetrics(scope, { plantId, from, to }) {
      await operator(scope, plantId, 'cs.ticket.read');
      if (!(from instanceof Date) || !(to instanceof Date) || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to - from > 31 * 24 * HOUR) fail('VALIDATION');
      return operatorTx(scope, plantId, 'cs.ticket.read', async (session, g) => {
        const at = now(), cap = 10000, scoped = { tenantId: g.tenantId, plantId: g.plantId };
        const projection = { _id: 1, createdAt: 1, assigneeId: 1, bindingId: 1, stage: 1, dataOrigin: 1, seeded: 1 };
        const open = await c('cs_tickets').find({ ...scoped, createdAt: { $lt: at }, stage: { $nin: ['RESOLVED', 'CLOSED'] } }, { session, projection }).sort({ createdAt: 1, _id: 1 }).limit(cap + 1).toArray();
        const inWindow = await c('cs_tickets').find({ ...scoped, createdAt: { $gte: from, $lt: new Date(Math.min(to.getTime(), at.getTime())) } }, { session, projection }).sort({ createdAt: 1, _id: 1 }).limit(cap + 1).toArray();
        const ids = [...new Set([...open.slice(0, cap), ...inWindow.slice(0, cap)].map(t => t._id))];
        const eventScope = { tenantId: g.tenantId, ticketId: { $in: ids }, at: { $lt: at } };
        const updates = await c('cs_ticket_events').find({ ...eventScope, kind: 'PUBLIC_UPDATE', 'actor.type': 'OPERATOR' }, { session, projection: { ticketId: 1, at: 1 } }).sort({ at: 1, _id: 1 }).limit(cap + 1).toArray();
        const replies = await c('cs_outbox').find({ ...scoped, ticketId: { $in: ids }, origin: 'OPERATOR', kind: 'OPERATOR_REPLY', state: { $in: ['PREVIEWED', 'SENT', 'DELIVERED', 'READ'] } }, { session, projection: { ticketId: 1, state: 1, previewedAt: 1, sentAt: 1 } }).sort({ createdAt: 1, _id: 1 }).limit(cap + 1).toArray();
        const resolved = await c('cs_ticket_events').find({ ...eventScope, kind: 'STAGE_CHANGED', toStage: 'RESOLVED' }, { session, projection: { ticketId: 1, at: 1 } }).sort({ at: 1, _id: 1 }).limit(cap + 1).toArray();
        return summarizeServiceMetrics({ open, inWindow, updates, replies, resolved, from, to, at, cap, slaMinutes: firstResponseSlaMinutes });
      });
    },

    // Trusted dispatcher port. Marks SENDING durably before the caller performs any remote call.
    async claimNextDelivery({ tenantId, channelAccountId, leaseOwner, leaseMs = 30000, deliveryIds }) {
      uuid(tenantId); key(channelAccountId); key(leaseOwner);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 600000) fail('INVALID_INPUT');
      if (previewDispatcher && channelAccountId !== SIMULATED_CHANNEL_ACCOUNT) fail('DENIED');
      if (deliveryIds !== undefined && (!Array.isArray(deliveryIds) || deliveryIds.length > 100 || !deliveryIds.every(x => typeof x === 'string' && UUID_RE.test(x)))) fail('INVALID_INPUT');
      return tx(async session => {
        await saasAdmission?.unsupportedTenant({tenantId,session});
        const at = now();
        const candidates = await c('cs_outbox').find({ tenantId, channelAccountId, state: 'QUEUED', nextAttemptAt: { $lte: at }, ...(deliveryIds === undefined ? {} : { _id: { $in: deliveryIds } }) }, { session }).sort({ seq: 1 }).limit(20).toArray();
        const blocked = new Set();
        for (const d of candidates) {
          if (blocked.has(d.conversationId)) continue;
          if (await c('cs_outbox').findOne({ tenantId, conversationId: d.conversationId, state: { $in: ['SENDING', 'UNKNOWN'] } }, { session })) { blocked.add(d.conversationId); continue; }
          const binding = await c('cs_contact_bindings').findOne({ _id: d.bindingId, tenantId, status: 'ACTIVE', version: d.bindingVersion }, { session });
          const conv = await c('cs_conversations').findOne({ _id: d.conversationId, tenantId }, { session });
          let reason = null;
          if (d.expiresAt <= at) reason = 'EXPIRED';
          else if (!binding) reason = 'STALE_BINDING';
          else if (!usable(binding)) reason = 'BINDING_EXPIRED';
          else if (d.origin === 'BOT' && (conv.mode !== 'BOT_ACTIVE' || conv.modeEpoch !== d.modeEpoch)) reason = 'MODE_CHANGED';
          else if (d.origin === 'OPERATOR' && (conv.mode !== 'HUMAN_ACTIVE' || conv.assigneeId !== d.actorUserId)) reason = 'MODE_CHANGED';
          else if (conv.mode === 'PAUSED' || conv.mode === 'CLOSED') reason = `MODE_${conv.mode}`;
          if (reason) {
            await c('cs_outbox').updateOne({ _id: d._id, state: 'QUEUED' }, { $set: { state: 'CANCELLED', cancelReason: reason, updatedAt: at }, $push: { history: { state: 'CANCELLED', reason, at } } }, { session });
            blocked.add(d.conversationId);
            continue;
          }
          const claimed = await c('cs_outbox').findOneAndUpdate({ _id: d._id, state: 'QUEUED', fence: d.fence },
            { $set: { state: 'SENDING', leaseOwner, leaseUntil: new Date(at.getTime() + leaseMs), updatedAt: at }, $inc: { attempt: 1, fence: 1 }, $push: { history: { state: 'SENDING', leaseOwner, at } } }, { session, returnDocument: 'after' });
          if (!claimed) continue;
          return { deliveryId: claimed._id, fence: claimed.fence, attempt: claimed.attempt, kind: claimed.kind, recipient: { channelAccountId: binding.channelAccountId, providerContactId: binding.providerContactId }, payload: claimed.payload, payloadHash: claimed.payloadHash };
        }
        return null;
      });
    },

    // outcome: SENT (provider accepted, id required), NOT_SENT (provably never submitted), SUBMIT_UNCERTAIN (timeout/crash after submit -> UNKNOWN).
    async recordDeliveryResult({ tenantId, deliveryId, fence, outcome, providerMessageId = null, error = null }) {
      uuid(tenantId); uuid(deliveryId); version(fence); oneOf(outcome, ['PREVIEWED', 'SENT', 'NOT_SENT', 'SUBMIT_UNCERTAIN']);
      if (outcome === 'PREVIEWED' && !previewDispatcher) fail('DENIED');
      if (previewDispatcher && outcome === 'SENT') fail('DENIED');
      if (outcome === 'SENT') key(providerMessageId);
      return tx(async session => {
        await saasAdmission?.unsupportedTenant({tenantId,session});
        const d = await c('cs_outbox').findOne({ _id: deliveryId, tenantId }, { session });
        if (!d) fail('NOT_FOUND');
        if (previewDispatcher && d.channelAccountId !== SIMULATED_CHANNEL_ACCOUNT) fail('DENIED');
        if (d.state !== 'SENDING' || d.fence !== fence) fail('STALE_FENCE');
        // A local preview has not reached any provider, so a binding revoked/expired after the claim is honoured here.
        // The binding write fence serialises this with a concurrent revocation.
        const previewAllowed = outcome !== 'PREVIEWED' || (await c('cs_contact_bindings').updateOne({ _id: d.bindingId, tenantId, status: 'ACTIVE', version: d.bindingVersion, ...unexpired() }, { $inc: { previewFence: 1 } }, { session })).matchedCount === 1;
        const at = now();
        let set;
        if (outcome === 'PREVIEWED' && !previewAllowed) set = { state: 'CANCELLED', cancelReason: 'BINDING_NOT_ACTIVE_AT_PREVIEW', providerMessageId: null };
        else if (outcome === 'PREVIEWED') set = {state:'PREVIEWED', providerMessageId:null, previewedAt:at};
        else if (outcome === 'SENT') set = { state: 'SENT', providerMessageId, sentAt: at };
        else if (outcome === 'SUBMIT_UNCERTAIN') set = { state: 'UNKNOWN', lastError: error ? String(error).slice(0, 200) : 'SUBMIT_UNCERTAIN' };
        else set = d.attempt < maxSendAttempts ? { state: 'QUEUED', nextAttemptAt: new Date(at.getTime() + 1000 * 2 ** d.attempt), lastError: error ? String(error).slice(0, 200) : 'NOT_SENT' } : { state: 'FAILED', lastError: error ? String(error).slice(0, 200) : 'NOT_SENT' };
        await c('cs_outbox').updateOne({ _id: d._id, state: 'SENDING', fence }, { $set: { ...set, leaseOwner: null, leaseUntil: null, updatedAt: at }, $push: { history: { state: set.state, outcome, at } } }, { session });
        return { deliveryId, state: set.state };
      });
    },

    // Expired SENDING leases become UNKNOWN for manual review; they are never requeued automatically.
    async reconcileExpiredSending({ tenantId }) {
      uuid(tenantId);
      return tx(async session => {
        await saasAdmission?.unsupportedTenant({tenantId,session});
        const at = now();
        const rows = await c('cs_outbox').find({ tenantId, state: 'SENDING', leaseUntil: { $lte: at } }, { session, projection: { _id: 1 } }).toArray();
        if (rows.length) await c('cs_outbox').updateMany({ _id: { $in: rows.map(r => r._id) }, state: 'SENDING' }, { $set: { state: 'UNKNOWN', lastError: 'LEASE_EXPIRED', leaseOwner: null, leaseUntil: null, updatedAt: at }, $push: { history: { state: 'UNKNOWN', reason: 'LEASE_EXPIRED', at } } }, { session });
        return { unknownDeliveryIds: rows.map(r => r._id) };
      });
    },

    async resolveUnknownDelivery(scope, { plantId, deliveryId, resolution, evidence, providerMessageId = null, commandKey }) {
      const g = await operator(scope, plantId, 'cs.delivery.review');
      uuid(deliveryId); oneOf(resolution, ['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT_REQUEUE', 'ABANDON']); const proof = text(evidence, 1000); key(commandKey);
      if (resolution === 'CONFIRMED_SENT') key(providerMessageId);
      return operatorTx(scope, plantId, 'cs.delivery.review', async (session, g) => idempotent(session, { tenantId: g.tenantId, scope: 'delivery.review', owner: g.userId, key: commandKey, request: { deliveryId, resolution, evidence: proof, providerMessageId } }, async () => {
        const d = await c('cs_outbox').findOne({ _id: deliveryId, tenantId: g.tenantId, plantId: g.plantId }, { session });
        if (!d) fail('NOT_FOUND');
        if (d.state !== 'UNKNOWN') fail('INVALID_TRANSITION');
        const at = now();
        const state = { CONFIRMED_SENT: 'SENT', CONFIRMED_NOT_SENT_REQUEUE: 'QUEUED', ABANDON: 'CANCELLED' }[resolution];
        const set = { state, updatedAt: at, review: { userId: g.userId, resolution, evidence: proof, at } };
        if (state === 'SENT') set.providerMessageId = providerMessageId;
        if (state === 'QUEUED') set.nextAttemptAt = at;
        if (state === 'CANCELLED') set.cancelReason = 'REVIEW_ABANDONED';
        await c('cs_outbox').updateOne({ _id: d._id, state: 'UNKNOWN' }, { $set: set, $push: { history: { state, reason: resolution, at } } }, { session });
        await audit(session, g.tenantId, 'delivery.reviewed', d._id, { type: 'OPERATOR', userId: g.userId });
        return { deliveryId, state };
      }));
    }
  };
  return Object.freeze(api);
}
