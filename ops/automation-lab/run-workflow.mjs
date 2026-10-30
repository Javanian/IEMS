// Development API helpers. These functions do not execute or validate an n8n workflow export.
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4319';
async function request(options, path, body, key) {
  const { apiBase = API_BASE, cookie, token, origin = 'http://localhost:4173' } = options;
  const response = await fetch(`${apiBase}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const envelope = await response.json();
  if (!response.ok) throw Object.assign(new Error(`${path}: ${envelope.error?.code || response.status}`), { status: response.status, code: envelope.error?.code });
  return envelope.data;
}
export async function executeWorkflow1_SlaEscalation(options) {
  const breaches = await request(options, '/cs/automation/sla-breaches?limit=100');
  const ticket = options.ticketId ? breaches.items.find(row => row.ticketId === options.ticketId) : breaches.items[0];
  if (!ticket && !options.ticketId) return { skipped: true, reason: 'NO_BREACHES' };
  const ticketId = options.ticketId || ticket.ticketId;
  const expectedVersion = options.expectedVersion ?? ticket?.expectedVersion;
  const recheck = await request(options, '/cs/automation/recheck', { ticketId, expectedVersion, action: 'ESCALATE' });
  if (!recheck.eligible) return { eligible: false, recheck };
  const escalation = await request(options, '/cs/automation/escalate', { ticketId, expectedVersion, reason: 'Unassigned ticket exceeded its configured SLA' }, options.idempotencyKey || ticket?.occurrenceKey || `sla:${ticketId}:manual-v${expectedVersion}`);
  return { eligible: true, escalation };
}
export async function executeWorkflow2_WhatsAppHandoff(options) {
  return request(options, `/cs/conversations/${options.conversationId}/takeover`, { expectedVersion: options.expectedVersion, reason: options.reason || 'Synthetic operator takeover', commandKey: options.idempotencyKey || `takeover:${options.conversationId}:${options.expectedVersion}` });
}
export async function executeWorkflow3_WeeklyDigest(options) {
  const mode = options.mode || 'WEEKLY';
  const record = await request(options, '/cs/automation/digest/dispatch', { mode, ...(options.periodKey ? { periodKey: options.periodKey } : {}) }, options.idempotencyKey || `digest:${mode}:${options.periodKey || new Date().toISOString().slice(0, 10)}`);
  return { ...record, record };
}
export async function executeWorkflow3_ApprovedResolution(options) {
  if (!options.draftId) throw new Error('Provide an already reviewed and approved draftId; this helper cannot approve');
  return request(options, `/cs/automation/resolution-drafts/${options.draftId}/dispatch`, {}, options.idempotencyKey || `resolution:${options.draftId}`);
}
export const executeWorkflow4_ApprovedResolution = executeWorkflow3_ApprovedResolution;
export const executeDurableReconciliation = options => request(options, '/cs/automation/reconcile', {});
