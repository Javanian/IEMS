const ACTIONS = {
  'genealogy.read':'You need genealogy read permission to inspect lot allocations and reconciliation.',
  'genealogy.record':'You need genealogy record permission to assign consumed lots or record process losses.',
  'genealogy.finalize':'You need genealogy finalize permission to complete this work order genealogy.',
};

export function genealogyCapability(action, permissions) {
  if (!Array.isArray(permissions)) return { enabled:false, reason:'Effective genealogy permissions are unavailable. Refresh your session before continuing.' };
  return !permissions.includes(action) ? { enabled:false, reason:ACTIONS[action] || 'You need permission for this genealogy action.' } : { enabled:true, reason:'' };
}

const commandBase = (view, values, key) => ({ expectedVersion:view.workOrderVersion, expectedGenealogyVersion:view.version, reason:values.reason, idempotencyKey:key });

export function allocationCommand(view, values, key) {
  return { ...commandBase(view, values, key), outputUnitId:values.outputUnitId, materials:view.sources.flatMap((source, index) => values[`materialQuantity${index}`]?.trim() ? [{ receiptId:source.receiptId, quantity:values[`materialQuantity${index}`], uom:source.uom }] : []) };
}

export function lossCommand(view, values, key) {
  return { ...commandBase(view, values, key), losses:view.sources.flatMap((source, index) => values[`lossQuantity${index}`]?.trim() ? [{ receiptId:source.receiptId, quantity:values[`lossQuantity${index}`], uom:source.uom, reason:values[`lossReason${index}`] }] : []) };
}

export function finalizeGenealogyCommand(view, values, key) {
  return commandBase(view, values, key);
}

export function genealogyPath(workOrderId) {
  return `/api/manufacturing/work-orders/${encodeURIComponent(workOrderId)}/genealogy`;
}

export function genealogyPage(path, cursor) {
  return `${path}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}

const HINTS = {
  GENEALOGY_VERSION_CONFLICT:'Another operator changed the genealogy. Discard this command and review the refreshed allocations before trying again.',
  VERSION_CONFLICT:'The work order changed. Discard this command and review its current quantities and genealogy.',
  GENEALOGY_QUANTITY_CONFLICT:'Check each output quantity against the released material ratio, and total allocations plus losses against actual consumption.',
  GENEALOGY_SOURCE_INVALID:'A material source lacks matching frozen release and consumption evidence. Refresh and inspect the source receipt.',
  GENEALOGY_INCOMPLETE:'Every output must have its exact released material ratios, and allocations plus process losses must reconcile each source.',
  GENEALOGY_FROZEN:'The first shipment froze the entire work order genealogy. Later changes require a separate correction workflow.',
  GENEALOGY_NOT_REQUIRED:'This work order did not opt into required lot genealogy when planned.',
  STOCK_ENCUMBERED:'An active source receipt hold blocks new finalization and shipment. Historical lot attribution remains recordable.',
  STATE_CONFLICT:'Attribution needs final output, and finalization needs completed QC. Refresh the work order to review its current state.',
};

export function genealogyHint(error) {
  return HINTS[error?.code] || null;
}
