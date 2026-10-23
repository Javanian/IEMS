import { deliveryLabel } from './fulfillment.mjs';

const TRANSITIONS = {
  NEW: ['TRIAGED', 'ASSIGNED'], TRIAGED: ['ASSIGNED'], ASSIGNED: ['ASSIGNED', 'IN_PROGRESS'],
  IN_PROGRESS: ['WAITING_FOR_CUSTOMER', 'RESOLVED'], WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'], REOPENED: ['ASSIGNED', 'IN_PROGRESS'], CLOSED: ['REOPENED'],
};
const ORIGINS = { CUSTOMER: 'Customer', BOT: 'Bot', SYSTEM: 'System', OPERATOR: 'Agent' };

export function persistedIdentity(row, kind) {
  const id = row[`${kind}Id`] || row.eventId || row._id;
  if (!id) throw Error(`Missing persisted ${kind} identity`);
  return `${kind}:${id}`;
}

export const nextStages = stage => TRANSITIONS[stage] ?? [];
export const humanize = value => value ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : '';

export function stageCommand(ticket, values, userId, key) {
  if (values.toStage === 'ASSIGNED' && !userId) throw Error('Your user is unavailable. Refresh and retry');
  return { expectedVersion: ticket.version, toStage: values.toStage, reason: values.reason, ...(values.toStage === 'ASSIGNED' ? { assigneeId: userId } : {}), commandKey: key };
}

export function messageLabel(message) {
  const who = `${ORIGINS[message.origin] ?? humanize(message.origin)} · Public`;
  return message.direction === 'INBOUND' ? who : `${who} · ${deliveryLabel(message.deliveryState ?? message.state)}`;
}

export function inboxPath(kind, { stage, cursor } = {}) {
  const query = new URLSearchParams({ limit: '25' });
  if (stage) query.set('stage', stage);
  if (cursor) query.set('cursor', cursor);
  return `/api/cs/${kind}?${query}`;
}

// Wave 4f (contract wave4f-v1, section 2): rendered preview projection, bindings, simulator and metrics.
const SOURCE_KINDS = { MANUFACTURE: 'Manufacture order', SALES_ORDER: 'Manufacture order', REPAIR: 'Repair case', REPAIR_CASE: 'Repair case' };
export function sourceLink(source) {
  if (!source?.id || /^[a-f0-9]{64}$/i.test(source.id)) return null;
  return /REPAIR/.test(source.kind || '') ? `/portfolio/repair/cases/${source.id}` : `/portfolio/orders/${source.id}`;
}
export function previewView(message) {
  const state = message.deliveryState ?? message.state;
  const body = typeof message.body === 'string' && message.body ? message.body : null;
  return {
    body,
    fallback: body ? null : message.direction === 'OUTBOUND' && message.origin !== 'OPERATOR' ? `Preview template: ${humanize(message.text)}` : message.text,
    template: message.template?.id ? `Template ${message.template.id} · v${message.template.version}` : null,
    source: message.source?.kind ? { label: `${SOURCE_KINDS[message.source.kind] ?? humanize(message.source.kind)} ${message.source.number || message.source.id?.slice(0, 8) || ''}`.trim(), link: sourceLink(message.source), version: message.source.sourceVersion, asOf: message.source.asOf } : null,
    state, previewOnly: state === 'PREVIEWED', uncertain: ['UNKNOWN', 'SENDING'].includes(state),
  };
}
// PREVIEWED is never SENT; delivery and read receipts only come from a provider, which this wave does not use.
export const DELIVERY_NOTES = {
  PREVIEWED: 'Rendered for review only. Nothing was sent to the customer.',
  UNKNOWN: 'Delivery could not be confirmed. Review before resending to avoid a duplicate.',
  SENDING: 'Send started but is not confirmed.',
  QUEUED: 'Waiting to be dispatched. Not sent yet.',
  CANCELLED: 'Cancelled before sending.',
  FAILED: 'The provider reported a failure.',
};

export const SYNTHETIC_ADDRESS = /^\+62000\d{6,9}$/;
export const bindingIdOf = b => b?.id ?? b?.bindingId ?? b?._id;
const local = message => Object.assign(Error(message), { local: true });
export function bindingCommand(values) {
  const address = (values.address || '').trim();
  if (!values.accountId) throw local('Select an account.');
  if (!values.contactId) throw local('Select a contact.');
  if (!SYNTHETIC_ADDRESS.test(address)) throw local('Use a synthetic address: +62000 followed by 6 to 9 digits.');
  const body = { accountId: values.accountId, contactId: values.contactId, channel: 'SIMULATED', address };
  if (values.expiresAt) {
    const at = new Date(values.expiresAt);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) throw local('Expiry must be in the future.');
    body.expiresAt = at.toISOString();
  }
  return body;
}
export function revokeCommand(binding, values) {
  const reason = (values.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw local('Enter a revoke reason of 3 to 500 characters.');
  return { reason, expectedVersion: binding.version };
}
export function bindingStatus(binding, now = Date.now()) {
  if (binding.status === 'REVOKED' || binding.revokedAt) return { code: 'REVOKED', label: 'Revoked', usable: false, reason: 'Binding revoked. Inbound messages are refused.' };
  if (binding.status === 'EXPIRED' || (binding.expiresAt && Date.parse(binding.expiresAt) <= now)) return { code: 'EXPIRED', label: 'Expired', usable: false, reason: 'Binding expired. Create a new binding to continue.' };
  return { code: 'ACTIVE', label: 'Active', usable: true, reason: '' };
}

const CS_NEED = {
  'cs.reply': 'You need customer service reply permission', 'cs.conversation.handoff': 'You need conversation handoff permission',
  'cs.ticket.write': 'You need ticket update permission', 'cs.note.internal': 'You need internal note permission',
  'cs.delivery.review': 'You need delivery review permission', 'cs.binding.manage': 'You need binding management permission',
  'cs.simulator.use': 'You need simulator permission',
};
export const permissionReason = action => CS_NEED[action] ?? 'You need permission for this action';
// Disables a control before submit when the session reports effective permissions without this action.
export function capabilityState(action, permissions) {
  if (Array.isArray(permissions) && !permissions.includes(action)) return { enabled: false, reason: permissionReason(action) };
  return { enabled: true, reason: '' };
}

export const MAX_METRIC_DAYS = 31;
export function metricsWindow(days, now = new Date()) {
  const span = Math.min(Math.max(1, Math.trunc(Number(days) || 7)), MAX_METRIC_DAYS);
  const to = new Date(now.getTime()), from = new Date(to.getTime() - span * 86400000);
  return { from: from.toISOString(), to: to.toISOString(), days: span };
}
export const metricsPath = ({ from, to }) => `/api/cs/metrics?${new URLSearchParams({ from, to })}`;
export function minutes(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'No data';
  const total = Math.round(Number(value));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Only values the API returned; a null distribution stays an explicit no-data state.
export function metricsView(m) {
  const duration = (d, noun, empty) => d && d.n > 0
    ? { value: `p50 ${minutes(d.p50Minutes)}`, detail: `p90 ${minutes(d.p90Minutes)} · n = ${plural(d.n, noun)}`, empty: false }
    : { value: 'No data', detail: empty, empty: true };
  return [
    { key: 'open', label: 'Open tickets', value: String(m.open), detail: 'Not resolved or closed', empty: false },
    { key: 'unassigned', label: 'Unassigned', value: String(m.unassigned), detail: `of ${m.open} open`, empty: false },
    { key: 'overdue', label: 'Overdue', value: String(m.overdue?.count ?? 0), detail: m.overdue?.slaMinutes ? `of ${m.open} open · SLA ${minutes(m.overdue.slaMinutes)}` : `of ${m.open} open`, empty: false },
    { key: 'firstHumanResponse', label: 'First human response', ...duration(m.firstHumanResponse, 'ticket', 'No agent replies in this window. Bot messages do not count.') },
    { key: 'resolution', label: 'Resolution time', ...duration(m.resolution, 'ticket', 'No tickets resolved in this window.') },
  ];
}

// Maps a failed binding/simulator command to a UI outcome; mirrors holds.mjs commandOutcome.
export function csOutcome(action, error) {
  const code = error?.code, status = error?.status;
  if (status === 403) return { denied: action, message: `${permissionReason(action)}. Ask a service lead to grant it.` };
  if (code === 'SYNTHETIC_ADDRESS_REQUIRED') return { message: 'Only synthetic addresses (+62000 followed by 6 to 9 digits) can be bound in this workspace.' };
  if (code === 'BINDING_REVOKED') return { conflict: true, message: 'This binding is revoked. Inbound messages through it are refused.' };
  if (code === 'VERSION_CONFLICT') return { conflict: true, message: 'Binding changed, reload to continue. Nothing was saved.' };
  if (code === 'IDEMPOTENCY_KEY_REUSED') return { message: 'This retry no longer matches the original request. Reload and submit again.' };
  if (code === 'STATUS_UNAVAILABLE' || status === 503) return { retry: true, message: 'Order status is temporarily unavailable. Retry sends the same message key.' };
  if (status === 404) return { message: 'Binding, account or contact not found in your plant.' };
  if (status === 401) return { message: 'Your session expired. Sign in again.' };
  if (status === 400 || status === 422) return { message: error.message && error.message !== code ? error.message : 'Check the form values.' };
  if (!status || status >= 500) return { retry: true, message: 'The result could not be confirmed. Retry sends the same request, so it cannot apply twice.' };
  return { message: error?.message || 'Request failed' };
}
