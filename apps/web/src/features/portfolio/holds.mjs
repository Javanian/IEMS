// Stock hold view logic (contract wave4f-v1, section 1). Pure functions so the UI rules are unit tested.
export const HOLD_REASONS = [
  ['QC_SUSPECT', 'QC suspect'], ['DAMAGED', 'Damaged'], ['DOCUMENT_MISMATCH', 'Document mismatch'],
  ['CUSTOMER_COMPLAINT', 'Customer complaint'], ['OTHER', 'Other'],
];
export const RELEASE_REASONS = [
  ['INSPECTION_PASSED', 'Inspection passed'], ['DISPOSITION_ACCEPTED', 'Disposition accepted'],
  ['APPLIED_IN_ERROR', 'Applied in error'], ['OTHER', 'Other'],
];
const LABELS = Object.fromEntries([...HOLD_REASONS, ...RELEASE_REASONS, ['LEGACY_HOLD_REPRESENTATION', 'Legacy hold flag'], ['HOLD_CACHE_WITHOUT_AUTHORITY', 'Hold flag without hold record']]);
export const reasonLabel = code => LABELS[code] ?? code ?? '';
export const HOLD_STATUSES = ['ACTIVE', 'RELEASED', 'ALL'];

// Lists may arrive as the contract shape { items, nextCursor } or the existing { data, page } envelope.
export function normalizePage(envelope = {}) {
  if (Array.isArray(envelope.items)) return { items: envelope.items, nextCursor: envelope.nextCursor ?? null };
  if (Array.isArray(envelope.data)) return { items: envelope.data, nextCursor: envelope.page?.nextCursor ?? null };
  if (envelope.data && Array.isArray(envelope.data.items)) return { items: envelope.data.items, nextCursor: envelope.data.nextCursor ?? null };
  return { items: [], nextCursor: null };
}
// Single-object responses may be enveloped in { data } or returned bare.
export const unwrap = envelope => (envelope && typeof envelope === 'object' && 'data' in envelope && !Array.isArray(envelope.data) ? envelope.data : envelope);

export function holdsPath({ status = 'ACTIVE', receiptId, cursor, limit = 25 } = {}) {
  const q = new URLSearchParams({ status: HOLD_STATUSES.includes(status) ? status : 'ACTIVE', limit: String(limit) });
  if (receiptId) q.set('receiptId', receiptId);
  if (cursor) q.set('cursor', cursor);
  return `/api/warehouse/holds?${q}`;
}

export function validNote(note) { return typeof note === 'string' && note.trim().length >= 3 && note.length <= 500; }
export function applyHoldCommand(receipt, values) {
  if (!HOLD_REASONS.some(([code]) => code === values.reasonCode)) throw Object.assign(Error('Select a hold reason.'), { local: true });
  if (!validNote(values.reasonNote)) throw Object.assign(Error('Enter a note of 3 to 500 characters.'), { local: true });
  return { reasonCode: values.reasonCode, reasonNote: values.reasonNote.trim(), expectedReceiptVersion: receipt.version };
}
export function releaseHoldCommand(hold, values) {
  if (!RELEASE_REASONS.some(([code]) => code === values.reasonCode)) throw Object.assign(Error('Select a release reason.'), { local: true });
  if (!validNote(values.reasonNote)) throw Object.assign(Error('Enter a note of 3 to 500 characters.'), { local: true });
  return { reasonCode: values.reasonCode, reasonNote: values.reasonNote.trim(), expectedVersion: hold.version };
}

// Legacy representations stay fail-closed: the server refuses new hold commands on them.
export function legacyHold(receipt = {}) {
  if (Array.isArray(receipt.legacyHoldRepresentation) && receipt.legacyHoldRepresentation.length) return true;
  const held = receipt.held === true;
  const quantity = typeof receipt.heldQuantity === 'string' ? /[1-9]/.test(receipt.heldQuantity) : Number(receipt.heldQuantity || 0) !== 0;
  return held || quantity;
}
export function holdState(receipt = {}) {
  const ids = receipt.hold?.activeHoldIds ?? [];
  if (legacyHold(receipt)) return { held: true, label: 'On hold (legacy flag)', count: ids.length };
  if (receipt.hold?.active || ids.length) return { held: true, label: ids.length === 1 ? 'On hold · 1 active hold' : `On hold · ${ids.length} active holds`, count: ids.length };
  return { held: false, label: 'No active hold', count: 0 };
}

const PERMISSION = { apply: 'warehouse.hold.apply', release: 'warehouse.hold.release' };
const NEED = { apply: 'You need hold apply permission', release: 'You need hold release permission' };
// Returns whether an action button is usable and, when it is not, the specific reason shown next to it.
export function actionState(action, { permissions, denied = {}, conflict = {}, receipt, hold, busy = false } = {}) {
  if (busy) return { enabled: false, reason: 'Saving, wait for the server response' };
  if (denied[action]) return { enabled: false, reason: NEED[action] };
  // permissions = effective actions from /api/session/me; when absent the server 403 path still applies.
  if (Array.isArray(permissions) && !permissions.includes(PERMISSION[action])) return { enabled: false, reason: NEED[action] };
  if (action === 'apply') {
    if (conflict.receipt) return { enabled: false, reason: 'Receipt changed, reload to continue' };
    if (receipt && legacyHold(receipt)) return { enabled: false, reason: 'Receipt carries a legacy hold flag. An administrator must normalise it first' };
  }
  if (action === 'release') {
    if (hold && conflict[hold.id]) return { enabled: false, reason: 'Hold changed, reload to continue' };
    if (hold && hold.status !== 'ACTIVE') return { enabled: false, reason: 'This hold is already released' };
  }
  return { enabled: true, reason: '' };
}

// Maps a failed command to the state change the UI applies and the message it shows.
export function commandOutcome(action, error, hold) {
  const code = error?.code, status = error?.status;
  if (status === 403) return { denied: action, message: `${NEED[action]}. Ask a ${action === 'release' ? 'quality lead' : 'warehouse lead'} to grant it.` };
  if (code === 'VERSION_CONFLICT') return { conflict: action === 'apply' ? 'receipt' : hold?.id, message: `${action === 'apply' ? 'Receipt' : 'Hold'} changed${error.currentVersion ? ` (now version ${error.currentVersion})` : ''}, reload to continue. Nothing was saved.` };
  if (code === 'HOLD_NOT_ACTIVE') return { conflict: hold?.id, message: 'This hold was already released. Reload to see the current holds.' };
  if (code === 'HOLD_LEGACY_REPRESENTATION') return { conflict: 'receipt', message: 'Receipt carries a legacy hold flag. New holds are refused until an administrator normalises it.' };
  if (code === 'HOLD_PARTIAL_UNSUPPORTED') return { message: 'Partial holds are not supported. A hold always covers the whole receipt.' };
  if (code === 'IDEMPOTENCY_KEY_REUSED') return { message: 'This retry no longer matches the original request. Reload and submit again.' };
  if (code === 'VALIDATION' || status === 400) return { message: `${error.message || 'Check the reason and note'}.`.replace(/\.\.$/, '.') };
  if (status === 404) return { message: 'Receipt or hold not found in your plant. Return to the list.' };
  if (status === 401) return { message: 'Your session expired. Sign in again.' };
  if (!status || status >= 500) return { retry: true, message: 'The result could not be confirmed. Retry sends the same request, so it cannot apply twice.' };
  return { message: error?.message || 'Request failed' };
}

export function impactRows(impacts = {}) {
  const reservations = (impacts.reservations ?? []).map(r => ({
    key: `reservation:${r.id}`, kind: r.kind === 'MANUFACTURING' ? 'Manufacturing reservation' : 'Sales reservation', quantity: r.quantity,
    link: r.workOrderId ? `/portfolio/manufacturing/work-orders/${r.workOrderId}` : r.salesOrderId ? `/portfolio/orders/${r.salesOrderId}` : `/portfolio/warehouse/reservations/${r.id}`,
    linkLabel: r.workOrderId ? 'Open work order' : r.salesOrderId ? 'Open sales order' : 'Open reservation',
    state: r.state === 'BLOCKED_BY_HOLD' ? 'Blocked by hold · still reserved' : r.state,
  }));
  const workOrders = (impacts.workOrders ?? []).map(w => ({
    key: `wo:${w.id}`, kind: `Work order ${w.number || w.id.slice(0, 8)}`, status: w.status,
    link: `/portfolio/manufacturing/work-orders/${w.id}`, linkLabel: 'Open work order',
    state: w.stockException === 'BLOCKED_BY_HOLD' ? 'Stock exception · not cleared to consume held stock' : w.stockException,
  }));
  return { reservations, workOrders, total: reservations.length + workOrders.length };
}

// Copy for an affected WO or order. It states what the domain did, and does not claim cancellation or safety.
export function stockExceptionText(exception) {
  return `Material receipt ${exception.receiptId.slice(0, 8)}${exception.materialCode ? ` (${exception.materialCode})` : ''} is on hold: ${reasonLabel(exception.reasonCode)}${exception.since ? ` since ${new Date(exception.since).toLocaleString('en-US')}` : ''}.`;
}
export function orderReceiptIds(orderId, reservations = [], workOrders = []) {
  return [...new Set([
    ...reservations.filter(r => r.salesOrderId === orderId && !['RELEASED', 'CANCELLED', 'CONSUMED', 'SHIPPED'].includes(r.status)).map(r => r.receiptId),
    ...workOrders.filter(w => w.salesOrderId === orderId && !w.records?.length).flatMap(w => (w.routing?.materials ?? []).map(m => m.receiptId)),
  ].filter(Boolean))];
}
export const STOCK_EXCEPTION_NOTE = 'The reservation is still recorded and has not been cancelled. Consumption and shipment from held stock are blocked until the hold is released. Review the hold before continuing.';
