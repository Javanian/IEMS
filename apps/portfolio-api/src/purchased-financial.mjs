import { validatePurchasedInvoiceState } from './purchased-billing-state.mjs';
import { stockHash as hash, stockHashless as hashless, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { validateCatalogOrder } from './quote-catalog.mjs';
import { purchasedFulfillmentContext } from './purchased-fulfillment.mjs';
import { purchasedInvalid, shipmentSemantic, invoiceSemantic } from './purchased-stock-proof.mjs';
import { randomUUID } from 'node:crypto';

const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const stamp = value => ({ ...value, contentHash: hash(value) });

export async function hasPurchasedShipmentEvidence(db, filter, shipmentId, session) {
  const options = { session }, row = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: shipmentId }, options);
  if (row?.schema === 'PURCHASED_SHIPMENT_V1') return true;
  for (const [name, extra] of [['purchasedShipmentProofs', { shipmentId }], ['catalogCustomerShipments', { shipmentId }], ['purchasedFulfillmentHeads', { 'shipmentRefs.shipmentId': shipmentId }], ['purchasedFulfillmentEvents', { 'snapshot.shipmentRefs.shipmentId': shipmentId }], ['purchasedFulfillmentKeys', { 'result.shipmentId': shipmentId }]]) if (await db.collection(name).findOne({ ...filter, ...extra }, options)) return true;
  return false;
}

export async function validatePurchasedShipment(db, filter, shipmentId, session) {
  const options = { session }, shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: shipmentId }, options), proof = await db.collection('purchasedShipmentProofs').findOne({ ...filter, shipmentId }, options);
  if (!shipment) { if (proof) purchasedInvalid(); fail(404, 'NOT_FOUND'); }
  const ledger = await db.collection('catalogCustomerShipments').findOne({ ...filter, shipmentId }, options);
  const typed = Boolean(proof || ledger || await hasPurchasedShipmentEvidence(db, filter, shipmentId, session) || Array.isArray(shipment.sources) && shipment.sources.some(source => source.sourceType === 'CATALOG_RESERVATION'));
  if (!typed) return null;
  if (!proof || shipment.schema !== 'PURCHASED_SHIPMENT_V1') purchasedInvalid();
  const current = await purchasedFulfillmentContext(db, filter, proof.salesOrderId, session);
  if (shipment.salesOrderId !== current.order._id || proof.orderHash !== current.orderProof.orderHash || hash(hashless(proof)) !== proof.contentHash || hash(shipmentSemantic(shipment)) !== proof.shipmentHash || hash(proof.snapshot) !== proof.shipmentHash || shipment.version !== 1 || shipment.status !== 'SHIPPED' || !Array.isArray(shipment.sources) || shipment.sources.length !== shipment.stockMovementCount || !shipment.sources.length || shipment.sources.length > 20 || new Set(shipment.sources.map(source => source.sourceId)).size !== shipment.sources.length) purchasedInvalid();
  const movements = await db.collection('catalogCustomerShipments').find({ ...filter, shipmentId }, options).limit(21).toArray();
  if (movements.length !== shipment.sources.length || !Array.isArray(proof.movementRefs) || movements.length !== proof.movementRefs.length) purchasedInvalid();
  let quantity = 0n; const serials = [], unitIds = [];
  for (const part of shipment.sources) {
    const claim = current.reservations.find(row => row._id === part.sourceId), movement = movements.find(row => row._id === part.movementId);
    if (!claim || !movement || part.sourceType !== 'CATALOG_RESERVATION' || claim.lineIndex !== shipment.lineIndex || claim.receiptId !== part.receiptId || movement.reservationId !== claim._id || movement.receiptId !== claim.receiptId || movement.salesOrderId !== shipment.salesOrderId || movement.accountId !== shipment.accountId || movement.lineIndex !== shipment.lineIndex || movement.uom !== shipment.uom || movement.quantity !== part.quantity || hash(movement.unitIds) !== hash(part.unitIds) || hash(movement.serials) !== hash(part.serials || []) || part.movementHash !== movement.contentHash || hash(hashless(movement)) !== movement.contentHash || !proof.movementRefs.some(ref => ref.movementId === movement._id && ref.contentHash === movement.contentHash)) purchasedInvalid();
    quantity += units(part.quantity); serials.push(...(part.serials || [])); unitIds.push(...part.unitIds);
  }
  if (quantity !== units(shipment.quantity) || new Set(serials).size !== serials.length || new Set(unitIds).size !== unitIds.length) purchasedInvalid();
  return { shipment: shipmentSemantic(shipment), proof, current, serials: serials.sort(), sourceReceiptIds: proof.sourceReceiptIds };
}

export async function validatePurchasedInvoice(db, filter, invoiceId, session) { return validatePurchasedInvoiceState(db, filter, invoiceId, session, validatePurchasedShipment); }

export async function validatePurchasedPayment(db, filter, paymentId, session) {
  const options = { session }, proof = await db.collection('purchasedPaymentProofs').findOne({ ...filter, paymentId }, options), payment = await db.collection('fulfillmentPayments').findOne({ ...filter, _id: paymentId }, options);
  if (!proof) {
    const key = await db.collection('fulfillmentKeys').findOne({ ...filter, 'result._id': paymentId, $or: [{ 'result.schema': 'PURCHASED_PAYMENT_V1' }, { 'result.sourceReceiptIds': { $exists: true } }, { purchasedProofHash: { $exists: true } }] }, options);
    if (payment?.schema === 'PURCHASED_PAYMENT_V1' || payment && Object.hasOwn(payment, 'sourceReceiptIds') || key || payment && await db.collection('fulfillmentKeys').findOne({ ...filter, salesOrderId: payment.salesOrderId, purchasedProofHash: { $exists: true } }, options)) purchasedInvalid();
    if (payment && await db.collection('quoteCatalogOrders').findOne({ ...filter, orderId: payment.salesOrderId }, options)) fail(409, 'CATALOG_ORDER_UNSUPPORTED');
    return null;
  }
  if (!payment || !Array.isArray(proof.invoiceRefs) || proof.invoiceRefs.some(ref => !ref || typeof ref !== 'object') || !proof.snapshot || hash(hashless(proof)) !== proof.contentHash || hash(payment) !== proof.paymentHash || hash(proof.snapshot) !== proof.paymentHash) purchasedInvalid();
  const key = await db.collection('fulfillmentKeys').findOne({ ...filter, key: proof.key }, options);
  if (!key || key.purchasedProofHash !== proof.contentHash || hash(key.result) !== proof.paymentHash) purchasedInvalid();
  for (const ref of proof.invoiceRefs) if (!await validatePurchasedInvoice(db, filter, ref.invoiceId, session)) purchasedInvalid();
  return { payment, proof };
}

export async function preparePurchasedFinancial(db, filter, kind, body, session, replay = false) {
  const options = { session };
  if (kind === 'invoice.issued') {
    const order = await db.collection('salesOrders').findOne({ ...filter, _id: body.salesOrderId }, options);
    if (!order || !await validateCatalogOrder(db, filter, order, session)) return null;
    if (!replay && await db.collection('purchasedInvoiceProofs').countDocuments({ ...filter, salesOrderId: order._id }, options) >= 100) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
    const sources = [];
    for (const line of body.lines) { const source = await validatePurchasedShipment(db, filter, line.shipmentId, session); if (!source) fail(409, 'CATALOG_ORDER_UNSUPPORTED'); if (source.shipment.salesOrderId !== order._id) fail(409, 'SOURCE_CONFLICT'); sources.push(source); }
    return { salesOrderId: order._id, sourceReceiptIds: [...new Set(sources.flatMap(source => source.sourceReceiptIds))], shipmentRefs: sources.map(source => ({ shipmentId: source.shipment._id, shipmentHash: source.proof.shipmentHash })) };
  }
  if (kind !== 'payment.recorded') return null;
  const sources = []; let legacy = false;
  for (const allocation of body.allocations) {
    const source = await validatePurchasedInvoice(db, filter, allocation.invoiceId, session);
    if (source) sources.push(source);
    else {
      const invoice = await db.collection('fulfillmentInvoices').findOne({ ...filter, _id: allocation.invoiceId }, options), order = invoice && await db.collection('salesOrders').findOne({ ...filter, _id: invoice.salesOrderId }, options);
      if (order && await validateCatalogOrder(db, filter, order, session)) fail(409, 'CATALOG_ORDER_UNSUPPORTED');
      legacy = true;
    }
  }
  if (!sources.length) return null;
  if (legacy || new Set(sources.map(source => source.invoice.salesOrderId)).size !== 1) fail(409, 'PURCHASED_FULFILLMENT_MODE_CONFLICT');
  if (!replay && await db.collection('purchasedPaymentProofs').countDocuments({ ...filter, salesOrderId: sources[0].invoice.salesOrderId }, options) >= 100) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
  return { salesOrderId: sources[0].invoice.salesOrderId, sourceReceiptIds: [...new Set(sources.flatMap(source => source.proof.sourceReceiptIds))], invoices: sources.map(source => source.invoice) };
}

export async function recordPurchasedFinancial(db, filter, kind, body, result, current, actor, session) {
  if (!current) return;
  const options = { session };
  result.schema = kind === 'invoice.issued' ? 'PURCHASED_INVOICE_V1' : 'PURCHASED_PAYMENT_V1'; result.sourceReceiptIds = current.sourceReceiptIds; result.salesOrderId = current.salesOrderId;
  await db.collection(kind === 'invoice.issued' ? 'fulfillmentInvoices' : 'fulfillmentPayments').updateOne({ ...filter, _id: result._id }, { $set: { schema: result.schema, sourceReceiptIds: result.sourceReceiptIds, salesOrderId: result.salesOrderId } }, options);
  const common = { _id: randomUUID(), ...filter, salesOrderId: current.salesOrderId, key: body.idempotencyKey, sourceReceiptIds: current.sourceReceiptIds, recordedBy: actor, recordedAt: new Date() };
  if (kind === 'invoice.issued') {
    const proof = stamp({ ...common, invoiceId: result._id, snapshot: invoiceSemantic(result), invoiceHash: hash(invoiceSemantic(result)), shipmentRefs: current.shipmentRefs });
    await db.collection('purchasedInvoiceProofs').insertOne(proof, options); return proof.contentHash;
  } else {
    const refs = [];
    for (const before of current.invoices) { const after = await db.collection('fulfillmentInvoices').findOne({ ...filter, _id: before._id }, options); refs.push({ invoiceId: before._id, previousVersion: before.version, previousHash: hash(invoiceSemantic(before)), currentHash: hash(invoiceSemantic(after)), snapshot: invoiceSemantic(after) }); }
    const proof = stamp({ ...common, paymentId: result._id, snapshot: result, paymentHash: hash(result), invoiceRefs: refs });
    await db.collection('purchasedPaymentProofs').insertOne(proof, options); return proof.contentHash;
  }
}

export async function purchasedFinancialReplay(db, filter, kind, prior, session, required = false) {
  const invoiceProof = await db.collection('purchasedInvoiceProofs').findOne({ ...filter, key: prior.key }, { session });
  const paymentProof = await db.collection('purchasedPaymentProofs').findOne({ ...filter, key: prior.key }, { session });
  if (invoiceProof || paymentProof || required || typeof prior.result?.schema === 'string' && prior.result.schema.startsWith('PURCHASED_')) {
    if (!prior.result || typeof prior.result !== 'object') purchasedInvalid();
    if (kind === 'invoice.issued' && invoiceProof && !paymentProof) {
      if (prior.result._id !== invoiceProof.invoiceId) purchasedInvalid();
      const value = await validatePurchasedInvoice(db, filter, invoiceProof.invoiceId, session);
      if (!value || hash(invoiceSemantic(prior.result)) !== value.proof.invoiceHash) purchasedInvalid();
      return true;
    }
    if (kind === 'payment.recorded' && paymentProof && !invoiceProof) {
      if (prior.result._id !== paymentProof.paymentId) purchasedInvalid();
      const value = await validatePurchasedPayment(db, filter, paymentProof.paymentId, session);
      if (!value || hash(prior.result) !== value.proof.paymentHash) purchasedInvalid();
      return true;
    }
    purchasedInvalid();
  }
  return false;
}

export async function validatePurchasedDocumentSource(db, filter, kind, row, session) {
  if (kind === 'shipment') return validatePurchasedShipment(db, filter, row._id, session);
  if (kind === 'invoice') return validatePurchasedInvoice(db, filter, row._id, session);
  return null;
}
