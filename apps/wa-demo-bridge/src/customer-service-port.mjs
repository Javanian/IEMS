import { randomUUID } from 'node:crypto';
import { CustomerServiceError } from '@iems/customer-service';

const LEASE_OWNER = 'wa-demo-bridge.preview';
const fail = (status, code) => { throw Object.assign(new Error(code), { status }); };

// Deterministic local preview text. Nothing here reaches a provider.
function render(payload) {
  const p = payload ?? {};
  switch (p.template) {
    case 'ticket_ack': return `IEMS preview: complaint received as ticket ${p.ticketNumber}. A team member will review it.`;
    case 'handoff_queued': return 'IEMS preview: a team member has been requested. Automated replies are paused.';
    case 'menu': return 'IEMS preview commands: ORDER <number>, COMPLAINT, TICKET <number>, HUMAN, STOP.';
    case 'order_status': {
      const q = p.params ?? {};
      const progress = q.total ? ` ${q.released} of ${q.total} units released.` : '';
      return `${q.orderNumber}: ${q.publicStage}.${progress} ${q.source === 'PORTFOLIO_API_OWNED' ? 'Authoritative owned order.' : 'Synthetic fixture snapshot, not a live lookup.'}`;
    }
    case 'status_unavailable': return 'IEMS preview: status cannot be confirmed right now. Send IEMS HUMAN for a team member.';
    case 'draft_order': return 'Select an order: IEMS COMPLAINT ORDER <number>, or IEMS COMPLAINT GENERAL.';
    case 'draft_category': return 'Select category: IEMS COMPLAINT CATEGORY DELIVERY_DELAY, QUALITY, WRONG_ITEM, INVOICE_QUESTION, SAFETY_OR_DAMAGE or OTHER.';
    case 'draft_description': return 'Describe the issue: IEMS COMPLAINT DESCRIBE <text>.';
    case 'draft_preview': return `Review: ${p.params?.description ?? ''}. Send IEMS COMPLAINT CONFIRM, BACK or CANCEL.`;
    case 'draft_back': return `Back to ${p.params?.stage}. Continue the complaint or send IEMS COMPLAINT CANCEL.`;
    case 'draft_cancel': return 'Complaint cancelled. Send IEMS MENU to start again.';
    case 'validation_error': return `Cannot continue: ${p.params?.error}. Please check your input and try again.`;
    case 'ticket_status': return `${p.params?.ticketNumber}: ${p.params?.stage}.`;
    case 'resolved': return `${p.params?.ticketNumber}: resolved. Contact the team if you need further help.`;
    case 'operator_text': return typeof p.text === 'string' ? p.text : null;
    default: return null;
  }
}

function parse(text) {
  const body = text.slice('IEMS '.length);
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

/**
 * Bridges preview inbound commands to the customer-service domain and runs the single local dispatcher.
 * Tenant and channel account always come from the bridge's configured scope, never from the request.
 */
export async function createCustomerServicePort({ customerService: cs, db, scope, transaction, active, isPaused, now }) {
  const tenantId = scope.tenant, channelAccountId = scope.account;
  const previews = db.collection('cs_previews');
  await previews.createIndex({tenant:1,account:1,deliveryId:1},{unique:true});
  async function handle(recipient,eventId,text) {
    try {
      const principal=await cs.resolveCustomerPrincipal({tenantId,channelAccountId,providerContactId:recipient});
      return await cs.handleInboundCommand(principal,{inboundKey:eventId,text,command:parse(text)});
    } catch(e) {if(!(e instanceof CustomerServiceError))throw e;return {error:e.code};}
  }

  const view = (claim, record) => ({ deliveryId: claim.deliveryId, kind: claim.kind, state: record.state, reason: record.reason, mode: 'PREVIEW_ONLY', providerMessageId: null, text: record.text });

  async function dispatch(simulation = 'preview') {
    if (!['preview', 'ambiguous'].includes(simulation)) fail(400, 'INVALID_SIMULATION');
    // Expired leases may already have reached a provider in a live system; they become UNKNOWN, never re-previewed.
    await cs.reconcileExpiredSending({ tenantId });
    if (await isPaused()) fail(403, 'GLOBAL_PAUSE');
    const claim = await cs.claimNextDelivery({ tenantId, channelAccountId, leaseOwner: LEASE_OWNER });
    if (!claim) return null;
    if (claim.recipient.channelAccountId !== channelAccountId) fail(500, 'DISPATCH_SCOPE_MISMATCH');
    const recipient = claim.recipient.providerContactId;
    const record = await transaction(async session => {
      const existing = await previews.findOne({ ...scope, deliveryId: claim.deliveryId }, { session });
      if (existing) return { ...existing, repeated: true };
      const gated = !await active(recipient, undefined, session);
      const row = {
        _id: randomUUID(), ...scope, deliveryId: claim.deliveryId, fence: claim.fence, attempt: claim.attempt, kind: claim.kind, recipient,
        state: gated ? 'CANCELLED' : simulation === 'ambiguous' ? 'UNKNOWN' : 'PREVIEWED',
        reason: gated ? 'BRIDGE_SESSION_INACTIVE' : simulation === 'ambiguous' ? 'SIMULATED_PROVIDER_TIMEOUT_NOT_LIVE' : 'LOCAL_PREVIEW_NO_PROVIDER_CALL',
        text: gated ? null : render(claim.payload), providerMessageId: null, at: now()
      };
      await previews.insertOne(row, { session });
      return row;
    });
    // Preview completion never implies provider submission.
    const outcome = record.state === 'PREVIEWED' ? 'PREVIEWED' : record.state === 'UNKNOWN' && !record.repeated ? 'SUBMIT_UNCERTAIN' : 'NOT_SENT';
    const error = record.repeated ? 'PREVIEW_ALREADY_RECORDED' : record.state === 'CANCELLED' ? record.reason : record.state === 'UNKNOWN' ? record.reason : 'PREVIEW_ONLY_NO_PROVIDER';
    await cs.recordDeliveryResult({ tenantId, deliveryId: claim.deliveryId, fence: claim.fence, outcome, error });
    return view(claim, record);
  }

  return { handle, dispatch };
}
