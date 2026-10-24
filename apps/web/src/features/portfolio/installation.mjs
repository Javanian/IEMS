const NEED = {
  'installation.read':'You need received installation read permission to inspect parent and component evidence.',
  'installation.record':'You need received installation record permission to add component or process-loss evidence.',
  'installation.finalize':'You need received installation finalize permission to complete the evidence.',
  'installation.remove':'You need received installation removal permission for permanent component quarantine.',
};
export function installationCapability(action, permissions) {
  if (!Array.isArray(permissions)) return { enabled:false, reason:'Effective installation permissions are unavailable. Refresh your session.' };
  return permissions.includes(action) ? { enabled:true, reason:'' } : { enabled:false, reason:NEED[action] || 'You need permission for this installation action.' };
}
export const installationPath = workOrderId => `/api/manufacturing/work-orders/${encodeURIComponent(workOrderId)}/installations`;
export const installationPage = (path, cursor) => `${path}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
const baseCommand = (view, values, key) => ({ expectedVersion:view.workOrderVersion, expectedInstallationVersion:view.version, reason:values.reason, idempotencyKey:key });
const selectedComponents = (view, ids = []) => ids.map(serialUnitId => ({ serialUnitId, expectedUnitVersion:view.components.find(component => component._id === serialUnitId)?.version }));
export function recordInstallationCommand(view, values, key) {
  return { ...baseCommand(view, values, key), outputUnitId:values.outputUnitId, components:selectedComponents(view, values.serialUnitIds) };
}
export function installationLossCommand(view, values, key) {
  return { ...baseCommand(view, values, key), components:selectedComponents(view, values.lossSerialUnitIds) };
}
export function removeInstallationCommand(view, values, key) {
  const edge = view.edges.find(row => row._id === values.edgeId), component = view.components.find(row => row._id === edge?.childId);
  return { ...baseCommand(view, values, key), edgeId:values.edgeId, expectedEdgeVersion:edge?.version, expectedUnitVersion:component?.version };
}
export const finalizeInstallationCommand = baseCommand;
const HINTS = {
  VERSION_CONFLICT:'The work order changed. Discard this command and inspect its current installation and source evidence.',
  INSTALLATION_VERSION_CONFLICT:'Another operator changed installation evidence. Discard the command and refresh before selecting identities again.',
  INSTALLATION_SOURCE_INVALID:'The identity does not match valid consumed source authority. Review its receipt, claim and consumption evidence.',
  INSTALLATION_QUANTITY_CONFLICT:'The selected parent or process-loss quantities exceed the released ratios or current K1 allocation/loss evidence.',
  INSTALLATION_CHILD_UNAVAILABLE:'An identity is already assigned, lost, retired or has a different version. Removed and process-loss identities cannot be reused.',
  INSTALLATION_INCOMPLETE:'Each parent must have its exact source ratios, all consumed identities need a disposition, and current K1 evidence must reconcile. Retired identities block completion.',
  INSTALLATION_FROZEN:'The first shipment froze installation evidence for the whole work order. New assignments and removals are unavailable.',
  INSTALLATION_NOT_REQUIRED:'Received installation evidence was not required when this work order was planned.',
  STOCK_ENCUMBERED:'Source holds block new finalization and shipment. Recording valid historical installation evidence remains available.',
};
export const installationHint = error => HINTS[error?.code] || null;
