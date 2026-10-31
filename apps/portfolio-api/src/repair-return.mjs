import { randomUUID } from 'node:crypto';
import { stockHash as hash } from './catalog-stock-values.mjs';
import { shipmentSemantic } from './purchased-stock-proof.mjs';
import { readRepairOrders, fulfillRepairSalesOrder } from './repair-orders.mjs';
import { requireQualityGates } from './quality.mjs';
import { readDeliveryState } from './delivery.mjs';
import { domainError as fail } from '../../../packages/contracts/src/domains/engineering-repair/gates.mjs';

const active = session => { if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED'); };
const invalid = () => fail(409, 'REPAIR_RETURN_SOURCE_INVALID');
const text = value => { if (typeof value !== 'string' || !value.trim() || value.length > 500) fail(400, 'INVALID_RETURN_EVIDENCE'); return value.trim(); };
const withoutHash = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contentHash'));

export async function initializeRepairReturns(db) {
  await db.collection('repairReturnAuthorities').createIndex({ tenantId: 1, plantId: 1, caseId: 1 }, { unique: true });
  await db.collection('repairReturnAuthorities').createIndex({ tenantId: 1, plantId: 1, shipmentId: 1 }, { unique: true });
}

export async function dispatchRepairAsset(db, filter, row, body, actor, now, session) {
  active(session);
  if (row.serviceProfile !== 'REPAIR_SERVICE_V1' || row.returnDispatch || row.holdActive) fail(409, 'REPAIR_RETURN_STATE_CONFLICT');
  const rejected = row.decision?.decision === 'REJECT', mode = rejected ? 'RETURN_UNREPAIRED' : 'CUSTOMER_ASSET_RETURN';
  const { so, wo } = await readRepairOrders(db, filter, row, session);
  if (body.shipmentMode !== mode || (rejected ? row.status !== 'REJECTED' || wo.status !== 'CANCELLED' || !wo.cancelledBeforeRelease : row.status !== 'READY_FOR_RETURN' || wo.status !== 'COMPLETED' || !row.qc)) fail(409, 'REPAIR_RETURN_STATE_CONFLICT');
  if (body.uom !== row.scopes.at(-1).snapshot.lines[0].uom) fail(409, 'REPAIR_RETURN_UOM_CONFLICT');
  await requireQualityGates(db, filter, [{ resourceType: 'REPAIR_CASE', resourceId: row._id }], session, { at: now });
  if (!rejected) await fulfillRepairSalesOrder(db, filter, row, so, now, session);
  const shipmentId = randomUUID(), authorityId = randomUUID();
  const shipment = { _id: shipmentId, ...filter, version: 1, schema: 'REPAIR_RETURN_SHIPMENT_V1', sourceKind: 'CUSTOMER_ASSET_RETURN', ownerLegalEntityId: so.ownerLegalEntityId, shipmentMode: mode, caseId: row._id, assetId: row.assetId, serial: row.serial, repairSalesOrderId: so._id, repairWorkOrderId: wo._id, accountId: row.ownerAccountId, quantity: '1', uom: body.uom, status: 'SHIPPED', reference: text(body.reference), carrier: text(body.carrier), packaging: text(body.packaging), shippedAt: now, createdBy: actor, authorityId };
  const authority = { _id: authorityId, ...filter, caseId: row._id, shipmentId, shipmentHash: hash(shipment), binding: { caseVersion: row.version + 1, assetId: row.assetId, serial: row.serial, accountId: row.ownerAccountId, decisionHash: hash(row.decision), scopeHash: hash(row.scopes.at(-1)), qcHash: hash(row.qc || null), repairSalesOrderId: so._id, repairWorkOrderId: wo._id, salesOrderHash: so.contentHash, workOrderHash: wo.contentHash }, createdAt: now, createdBy: actor };
  authority.contentHash = hash(authority);
  await db.collection('fulfillmentShipments').insertOne(shipment, { session });
  await db.collection('repairReturnAuthorities').insertOne(authority, { session });
  row.returnDispatch = { shipmentId, authorityId, contentHash: authority.contentHash, shippedAt: now, shipmentMode: mode };
  row.returnedAt = now; row.status = 'RETURNED'; row.custodyState = rejected ? 'DISPATCHED_UNREPAIRED_TO_CUSTOMER' : 'DISPATCHED_TO_CUSTOMER';
  row.custody.push({ kind: row.custodyState, shipmentId, recordedBy: actor, recordedAt: now, evidence: body.evidence, source: 'OPERATOR_RECORDED' });
}

export async function validateRepairReturnShipment(db, filter, shipment, session) {
  active(session);
  if (shipment?.sourceKind !== 'CUSTOMER_ASSET_RETURN' || shipment.schema !== 'REPAIR_RETURN_SHIPMENT_V1' || shipment.status !== 'SHIPPED' || shipment.version !== 1 || shipment.quantity !== '1' || Object.hasOwn(shipment, 'salesOrderId') || Object.hasOwn(shipment, 'sources')) invalid();
  const row = await db.collection('repairCases').findOne({ ...filter, _id: shipment.caseId }, { session });
  const authority = await db.collection('repairReturnAuthorities').findOne({ ...filter, _id: shipment.authorityId, shipmentId: shipment._id, caseId: shipment.caseId }, { session });
  if (!row || !authority || hash(withoutHash(authority)) !== authority.contentHash || authority.shipmentHash !== hash(shipmentSemantic(shipment)) || row.returnDispatch?.shipmentId !== shipment._id || row.returnDispatch.authorityId !== authority._id || row.returnDispatch.contentHash !== authority.contentHash || row.status !== 'RETURNED' || row.holdActive) invalid();
  const { so, wo } = await readRepairOrders(db, filter, row, session), binding = authority.binding;
  if (shipment.ownerLegalEntityId !== so.ownerLegalEntityId || shipment.accountId !== row.ownerAccountId || shipment.assetId !== row.assetId || shipment.serial !== row.serial || shipment.repairSalesOrderId !== so._id || shipment.repairWorkOrderId !== wo._id || shipment.uom !== row.scopes.at(-1).snapshot.lines[0].uom || binding.assetId !== row.assetId || binding.serial !== row.serial || binding.accountId !== row.ownerAccountId || binding.decisionHash !== hash(row.decision) || binding.scopeHash !== hash(row.scopes.at(-1)) || binding.qcHash !== hash(row.qc || null) || binding.salesOrderHash !== so.contentHash || binding.workOrderHash !== wo.contentHash || binding.repairSalesOrderId !== so._id || binding.repairWorkOrderId !== wo._id || !Number.isSafeInteger(binding.caseVersion) || binding.caseVersion > row.version) invalid();
  const rejected = row.decision.decision === 'REJECT';
  if (rejected ? shipment.shipmentMode !== 'RETURN_UNREPAIRED' || wo.status !== 'CANCELLED' || !wo.cancelledBeforeRelease : row.decision.decision !== 'ACCEPT' || shipment.shipmentMode !== 'CUSTOMER_ASSET_RETURN' || wo.status !== 'COMPLETED' || !row.qc) invalid();
  await requireQualityGates(db, filter, [{ resourceType: 'REPAIR_CASE', resourceId: row._id }], session);
  const fenced = await db.collection('repairCases').updateOne({ ...filter, _id: row._id, version: row.version, 'returnDispatch.contentHash': authority.contentHash }, { $inc: { repairUseFence: 1 } }, { session });
  if (!fenced.matchedCount) fail(409, 'VERSION_CONFLICT');
  return { shipment, serials: [row.serial], sourceHash: hash(shipmentSemantic(shipment)) };
}

export function repairDeliveryReferences(original, current) {
  if (original.shipment.sourceKind !== 'CUSTOMER_ASSET_RETURN') return {};
  const shipment = original.shipment, returned = current.head?.status === 'DELIVERED';
  return { sourceKind: shipment.sourceKind, caseId: shipment.caseId, assetId: shipment.assetId, repairWorkOrderId: shipment.repairWorkOrderId, repairSalesOrderId: shipment.repairSalesOrderId, shipmentMode: shipment.shipmentMode, custodyState: returned ? shipment.shipmentMode === 'RETURN_UNREPAIRED' ? 'RETURNED_UNREPAIRED_TO_CUSTOMER' : 'RETURNED_TO_CUSTOMER' : 'DISPATCHED_TO_CUSTOMER' };
}

export function warrantyCalendarExpiry(deliveredAt, months) {
  if (!Number.isSafeInteger(months) || months < 1 || months > 120) fail(400, 'INVALID_WARRANTY_PERIOD');
  const start = new Date(deliveredAt);
  if (!Number.isFinite(start.getTime())) fail(409, 'WARRANTY_POD_REQUIRED');
  const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(start.getUTCDate(), lastDay), 23, 59, 59));
}

// Called by the single receipt-wrapper owner before returning a typed repair replay.
export async function recheckRepairServiceSources(db, filter, row, session) {
  active(session);
  if (row.serviceProfile !== 'REPAIR_SERVICE_V1') return;
  await requireQualityGates(db, filter, [{ resourceType: 'REPAIR_CASE', resourceId: row._id }], session);
  if (row.serviceOrders) await readRepairOrders(db, filter, row, session);
  if (row.returnDispatch) {
    const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: row.returnDispatch.shipmentId }, { session });
    if (!shipment) invalid();
    const original = await validateRepairReturnShipment(db, filter, shipment, session);
    await readDeliveryState(db, filter, original, session);
  }
}

export async function issuePodWarranty(db, filter, row, body, actor, now, session) {
  active(session);
  if (row.serviceProfile !== 'REPAIR_SERVICE_V1' || row.decision?.decision !== 'ACCEPT' || !row.qc || row.status !== 'RETURNED' || row.warranty || row.holdActive) fail(409, 'WARRANTY_CONFLICT');
  if (!Number.isSafeInteger(body.operatingHoursLimit) || body.operatingHoursLimit < 1 || body.operatingHoursLimit > 1000000 || typeof body.terms !== 'string' || !body.terms.trim() || body.terms.length > 1000) fail(400, 'INVALID_WARRANTY_COVERAGE');
  const { so, wo } = await readRepairOrders(db, filter, row, session);
  const invoice = await db.collection('repairInvoices').findOne({ ...filter, _id: body.invoiceId, caseId: row._id, kind: 'FINAL' }, { session });
  const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: body.shipmentId }, { session });
  if (!invoice || !shipment || body.repairWorkOrderId !== wo._id || wo.status !== 'COMPLETED' || invoice._id !== row.finalInvoiceId || invoice.accountId !== row.ownerAccountId || invoice.repairWorkOrderId !== wo._id || invoice.repairSalesOrderId !== so._id || invoice.currency !== row.currency || hash(invoice.snapshot) !== hash(row.scopes.at(-1).snapshot)) fail(409, 'WARRANTY_SOURCE_CONFLICT');
  const original = await validateRepairReturnShipment(db, filter, shipment, session), delivery = await readDeliveryState(db, filter, original, session);
  const confirmation = delivery.confirmations.find(value => value._id === body.confirmationId);
  if (shipment.caseId !== row._id || delivery.head?.status !== 'DELIVERED' || delivery.confirmations.length !== 1 || !confirmation || confirmation.quantity !== '1' || confirmation.serials?.length !== 1 || confirmation.serials[0] !== row.serial || new Date(confirmation.deliveredAt) > now || new Date(confirmation.deliveredAt) < new Date(shipment.shippedAt)) fail(409, 'WARRANTY_POD_REQUIRED');
  const expiresAt = warrantyCalendarExpiry(confirmation.deliveredAt, body.coverageMonths);
  if (expiresAt <= now) fail(409, 'WARRANTY_EXPIRED');
  return { _id: randomUUID(), profile: 'POD_CALENDAR_MONTHS_V1', status: 'ACTIVE', startsAt: new Date(confirmation.deliveredAt), expiresAt, coverageMonths: body.coverageMonths, operatingHoursLimit: body.operatingHoursLimit, terms: body.terms.trim(), serial: row.serial, accountId: row.ownerAccountId, assetId: row.assetId, scopeRevision: row.decision.revision, repairWorkOrderId: wo._id, invoiceId: invoice._id, shipmentId: shipment._id, confirmationId: confirmation._id, sources: { workOrderHash: wo.contentHash, invoiceHash: hash(invoice), invoiceSnapshot: structuredClone(invoice), shipmentHash: original.sourceHash, confirmationHash: confirmation.contentHash, confirmation: structuredClone(confirmation) }, recordedBy: actor, recordedAt: now, evidence: body.evidence };
}
