export function planningCapability(action, permissions) {
  if (!Array.isArray(permissions)) return { enabled:false, reason:'Effective planning permissions are unavailable. Refresh your session.' };
  return permissions.includes(action) ? { enabled:true, reason:'' } : { enabled:false, reason:`You need ${action} permission for this action.` };
}
export const masterBase = '/api/inventory-master';
export const internalBase = '/api/internal-production/orders';
export function planningPage(path, cursor = '') { return `${path}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`; }
export function approvedItems(items, manufacturedOnly = false) {
  return items.filter(item => item.status === 'APPROVED' && item.approval && item.approval.revision === item.currentRevision && item.approval.contentHash === item.contentHash && Array.isArray(item.blockers) && !item.blockers.length && (!manufacturedOnly || item.content.kind === 'MANUFACTURED'));
}
export function qualifiedLocations(locations) { return locations.filter(location => location.status === 'QUALIFIED' && location.qualification && Array.isArray(location.blockers) && !location.blockers.length); }
const common = (head, values, key) => ({ expectedVersion:head?.version ?? 1, reason:values.reason, idempotencyKey:key });
export function itemCommand(head, values, key, action = 'create') {
  const body = common(head, values, key);
  if (action === 'approve') return { ...body, revision:head.currentRevision };
  if (action === 'deactivate') return body;
  return { ...body, ...(head ? {} : { code:values.code }), description:values.description, uom:values.uom, kind:values.kind };
}
export function locationCommand(head, values, key) { return { ...common(head, values, key), ...(head ? {} : { code:values.code, binId:values.binId }) }; }
export function internalPlanCommand(items, locations, values, key) {
  const item = items.find(row => row._id === values.itemId), location = locations.find(row => row._id === values.locationId);
  return { ...common(null, values, key), ...(values.schema === 'INTERNAL_PLAN_V2' ? { schema:values.schema } : {}), itemId:values.itemId, itemRevision:item?.currentRevision, expectedItemVersion:item?.version, locationId:values.locationId, expectedLocationVersion:location?.version, quantity:values.quantity };
}
export function internalEngineeringCommand(order, items, values, operationCount, materialCount, key) {
  return { ...common(order, values, key), operations:Array.from({ length:operationCount }, (_, i) => ({ code:values[`code${i}`], instruction:values[`instruction${i}`] })), materials:Array.from({ length:materialCount }, (_, i) => {
    const item = items.find(row => row._id === values[`materialItemId${i}`]);
    return { itemId:values[`materialItemId${i}`], itemRevision:item?.currentRevision, expectedItemVersion:item?.version, quantityPerUnit:values[`quantityPerUnit${i}`], uom:item?.content.uom };
  }) };
}
export function internalTransitionCommand(order, values, key, engineering = false) { return { ...common(order, values, key), ...(engineering ? { revision:order.engineering.currentRevision } : {}) }; }
export function planningHint(error) {
  if (['MASTER_NOT_APPROVED', 'MASTER_SOURCE_INVALID', 'LOCATION_NOT_QUALIFIED', 'INTERNAL_DEPENDENCY_CHANGED'].includes(error?.code)) return 'A required master authority changed or is unavailable. Discard the command, review current item and location evidence, then create a new draft or order where needed. Frozen history is retained.';
  if (['VERSION_CONFLICT', 'REVISION_CONFLICT', 'STATE_CONFLICT', 'MASTER_CONFLICT'].includes(error?.code)) return 'Review the current version and immutable history before changing inputs. An approved demand does not release execution or create stock.';
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return 'This key belongs to a different captured command. Discard and review server evidence before starting a new command.';
  return null;
}
