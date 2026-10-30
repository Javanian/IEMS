import { readApprovedOrderRevision } from '../../../packages/contracts/src/domains/commercial/purchase-orders.mjs';
import { readCatalogOrderRevision } from './catalog-procurement.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const select = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, structuredClone(row[key])]));

// This source adapter is not an authorization entry point. Its caller must resolve
// the authenticated principal's vendor grant in the same snapshot transaction.
export async function readVendorPurchaseOrder(db, { tenantId, plantId, vendorId, cohort, orderId, documentRevision }, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (![tenantId, plantId, vendorId, orderId].every(uuid) || !['LEGACY', 'CATALOG'].includes(cohort) || (documentRevision !== undefined && !positive(documentRevision))) fail(400, 'INVALID_PORTAL_SOURCE');
  const filter = { tenantId, plantId };
  const vendorField = cohort === 'CATALOG' ? 'content.vendorId' : 'vendorId';
  const collection = cohort === 'CATALOG' ? 'catalogPurchaseOrders' : 'purchaseOrders';
  const row = await db.collection(collection).findOne({ ...filter, _id: orderId, [vendorField]: vendorId }, { session });
  if (!row || !['ISSUED', 'CONFIRMED'].includes(row.status)) return null;
  if (!await db.collection('vendors').findOne({ ...filter, _id: vendorId }, { session })) return null;
  const currentRevision = row.documentRevision ?? 1;
  if (!positive(currentRevision)) fail(409, 'PORTAL_SOURCE_INVALID');
  const revision = documentRevision ?? currentRevision;
  const approved = cohort === 'CATALOG'
    ? await readCatalogOrderRevision(db, filter, orderId, revision, session)
    : await readApprovedOrderRevision(db, filter, cohort, row, revision, session);
  if (approved.orderId !== orderId || approved.cohort !== cohort || approved.tenantId !== tenantId || approved.plantId !== plantId || approved.revision !== revision || (cohort === 'CATALOG' && approved.snapshot.vendorId !== vendorId)) fail(409, 'PORTAL_SOURCE_INVALID');
  const snapshot = approved.snapshot;
  if (!Array.isArray(snapshot.lines) || !snapshot.lines.length || !Array.isArray(approved.lineIds) || approved.lineIds.length !== snapshot.lines.length || !approved.lineIds.every(uuid) || new Set(approved.lineIds).size !== approved.lineIds.length || typeof approved.contentHash !== 'string') fail(409, 'PORTAL_SOURCE_INVALID');
  return {
    schema: 'PORTAL_PURCHASE_ORDER_V1', cohort, orderId, vendorId,
    documentRevision: approved.revision, currentDocumentRevision: currentRevision,
    sourceHash: approved.contentHash, source: 'COMMERCIAL_APPROVED_REVISION',
    status: row.status,
    ...select(snapshot, ['currency', 'taxPolicy', 'roundingPolicy', 'subtotal', 'tax', 'total']),
    lines: snapshot.lines.map((line, index) => ({
      ...select(line, ['description', 'itemCode', 'quantity', 'uom', 'unitPrice', 'lineTotal', 'amount']),
      lineId: approved.lineIds[index],
    })),
  };
}
