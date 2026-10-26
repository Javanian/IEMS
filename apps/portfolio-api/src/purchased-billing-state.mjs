import { stockHash as hash, stockHashless as hashless, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { purchasedInvalid, invoiceSemantic } from './purchased-stock-proof.mjs';
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const without = (value, names) => Object.fromEntries(Object.entries(value).filter(([key]) => !names.includes(key)));
const invoiceCore = value => without(invoiceSemantic(value), ['version', 'status', 'paidAmount', 'outstandingAmount', 'allocations', 'updatedAt']);
const money = (value, scale) => { const text = value.toString().padStart(scale + 1, '0'); return scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text; };
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
const minor = value => { if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) purchasedInvalid(); return BigInt(value.replace('.', '')); };

export async function validatePurchasedInvoiceState(db, filter, invoiceId, session, verifyShipment) {
  const options = { session }, invoice = await db.collection('fulfillmentInvoices').findOne({ ...filter, _id: invoiceId }, options), proof = await db.collection('purchasedInvoiceProofs').findOne({ ...filter, invoiceId }, options);
  if (!proof) {
    const key = await db.collection('fulfillmentKeys').findOne({ ...filter, 'result._id': invoiceId, $or: [{ 'result.schema': 'PURCHASED_INVOICE_V1' }, { 'result.sourceReceiptIds': { $exists: true } }, { purchasedProofHash: { $exists: true } }] }, options);
    if (invoice?.schema === 'PURCHASED_INVOICE_V1' || invoice && Object.hasOwn(invoice, 'sourceReceiptIds') || key || invoice && await db.collection('fulfillmentKeys').findOne({ ...filter, salesOrderId: invoice.salesOrderId, purchasedProofHash: { $exists: true } }, options)) purchasedInvalid();
    if (invoice && await db.collection('quoteCatalogOrders').findOne({ ...filter, orderId: invoice.salesOrderId }, options)) fail(409, 'CATALOG_ORDER_UNSUPPORTED');
    return null;
  }
  if (!invoice || !proof.snapshot || !Array.isArray(proof.snapshot.lines) || !Array.isArray(proof.snapshot.allocations) || !Array.isArray(proof.shipmentRefs) || !Array.isArray(proof.sourceReceiptIds) || proof.shipmentRefs.some(ref => !ref || typeof ref !== 'object') || proof.snapshot.lines.some(line => !line || typeof line !== 'object') || invoice.schema !== 'PURCHASED_INVOICE_V1' || hash(hashless(proof)) !== proof.contentHash || hash(proof.snapshot) !== proof.invoiceHash || hash(invoiceCore(invoice)) !== hash(invoiceCore(proof.snapshot))) purchasedInvalid();
  const key = await db.collection('fulfillmentKeys').findOne({ ...filter, key: proof.key }, options);
  if (!key || key.purchasedProofHash !== proof.contentHash || hash(invoiceSemantic(key.result || {})) !== proof.invoiceHash) purchasedInvalid();
  for (const ref of proof.shipmentRefs) { if (verifyShipment) { const source = await verifyShipment(db, filter, ref.shipmentId, session); if (!source || source.proof.shipmentHash !== ref.shipmentHash || source.shipment.salesOrderId !== invoice.salesOrderId) purchasedInvalid(); } else { const source = await db.collection('purchasedShipmentProofs').findOne({ ...filter, shipmentId: ref.shipmentId }, options); if (!source || source.shipmentHash !== ref.shipmentHash || source.salesOrderId !== invoice.salesOrderId || hash(hashless(source)) !== source.contentHash) purchasedInvalid(); } }
  const payments = await db.collection('purchasedPaymentProofs').find({ ...filter, 'invoiceRefs.invoiceId': invoiceId }, options).limit(101).toArray();
  if (payments.length > 100) purchasedInvalid();
  const chain = [];
  for (const paymentProof of payments) {
    const payment = await db.collection('fulfillmentPayments').findOne({ ...filter, _id: paymentProof.paymentId }, options), paymentKey = await db.collection('fulfillmentKeys').findOne({ ...filter, key: paymentProof.key }, options);
    if (!payment || !paymentKey || paymentKey.purchasedProofHash !== paymentProof.contentHash || !Array.isArray(paymentProof.invoiceRefs) || paymentProof.invoiceRefs.some(ref => !ref || typeof ref !== 'object') || !Array.isArray(payment.allocations) || hash(hashless(paymentProof)) !== paymentProof.contentHash || hash(payment) !== paymentProof.paymentHash || hash(paymentProof.snapshot) !== paymentProof.paymentHash || hash(paymentKey.result) !== paymentProof.paymentHash || payment.schema !== 'PURCHASED_PAYMENT_V1' || paymentProof.salesOrderId !== invoice.salesOrderId) purchasedInvalid();
    const refs = paymentProof.invoiceRefs.filter(ref => ref.invoiceId === invoiceId); if (refs.length !== 1) purchasedInvalid();
    chain.push({ ...refs[0], payment });
  }
  chain.sort((a, b) => a.previousVersion - b.previousVersion);
  let previous = proof.snapshot;
  for (const step of chain) {
    const after = step.snapshot, allocation = step.payment.allocations.find(value => value.invoiceId === invoiceId), appended = after?.allocations?.at(-1);
    if (!after || !Array.isArray(after.allocations) || !Array.isArray(previous.allocations) || !allocation || !appended || step.previousVersion !== previous.version || step.previousHash !== hash(invoiceSemantic(previous)) || after.version !== previous.version + 1 || allocation.invoiceVersion !== after.version || allocation.invoiceStatus !== after.status || step.currentHash !== hash(invoiceSemantic(after)) || hash(invoiceCore(after)) !== hash(invoiceCore(previous)) || after.allocations.length !== previous.allocations.length + 1 || hash(after.allocations.slice(0, -1)) !== hash(previous.allocations) || appended.paymentId !== step.payment._id || appended.amount !== allocation.amount || appended.currency !== step.payment.currency || !(appended.at instanceof Date) || !(after.updatedAt instanceof Date)) purchasedInvalid();
    const paid = minor(previous.paidAmount) + minor(allocation.amount), outstanding = minor(previous.total) - paid;
    if (outstanding < 0n || after.paidAmount !== money(paid, scales[invoice.currency]) || after.outstandingAmount !== money(outstanding, scales[invoice.currency]) || after.status !== (outstanding ? 'PARTIALLY_PAID' : 'PAID')) purchasedInvalid();
    previous = after;
  }
  if (hash(invoiceSemantic(invoice)) !== hash(invoiceSemantic(previous))) purchasedInvalid();
  return { invoice, proof };
}


export async function validatePurchasedBillingAggregate(db, filter, order, shipments, session) {
  const options = { session }, salesOrderId = order._id;
  const proofs = await db.collection('purchasedInvoiceProofs').find({ ...filter, salesOrderId }, options).limit(101).toArray(), invoices = await db.collection('fulfillmentInvoices').find({ ...filter, salesOrderId }, options).limit(101).toArray(), paymentProofs = await db.collection('purchasedPaymentProofs').find({ ...filter, salesOrderId }, options).limit(101).toArray(), payments = await db.collection('fulfillmentPayments').find({ ...filter, salesOrderId }, options).limit(101).toArray();
  if (proofs.length > 100 || proofs.length !== invoices.length || paymentProofs.length > 100 || payments.length !== paymentProofs.length || new Set(proofs.map(proof => proof.invoiceId)).size !== proofs.length || new Set(paymentProofs.map(proof => proof.paymentId)).size !== paymentProofs.length) purchasedInvalid();
  const keys = await db.collection('fulfillmentKeys').find({ ...filter, $and: [{ $or: [{ salesOrderId }, { 'result.salesOrderId': salesOrderId }] }, { $or: [{ purchasedProofHash: { $exists: true } }, { sourceReceiptIds: { $exists: true } }, { 'result.sourceReceiptIds': { $exists: true } }, { 'result.schema': { $in: ['PURCHASED_INVOICE_V1', 'PURCHASED_PAYMENT_V1'] } }] }] }, options).limit(201).toArray();
  const financial = [...proofs, ...paymentProofs];
  if (keys.length !== financial.length || new Set(financial.map(proof => proof.key)).size !== financial.length || keys.some(key => !financial.some(proof => proof.key === key.key && proof.contentHash === key.purchasedProofHash))) purchasedInvalid();
  const byLine = new Map(), byShipment = new Map();
  for (const proof of proofs) {
    if (!invoices.some(invoice => invoice._id === proof.invoiceId)) purchasedInvalid();
    const current = await validatePurchasedInvoiceState(db, filter, proof.invoiceId, session);
    if (!current || current.invoice.accountId !== order.accountId || current.invoice.currency !== order.snapshot.currency) purchasedInvalid();
    for (const line of proof.snapshot.lines) {
      const source = shipments.find(shipment => shipment._id === line.shipmentId), commercial = order.snapshot.lines[line.lineIndex];
      if (!source || source.lineIndex !== line.lineIndex || !commercial || commercial.catalogBinding?.itemSnapshot?.content.kind !== 'PURCHASED' || line.uom !== source.uom || line.unitPrice !== commercial.unitPrice || line.currency !== order.snapshot.currency || units(line.quantity) <= 0n) purchasedInvalid();
      byShipment.set(source._id, (byShipment.get(source._id) || 0n) + units(line.quantity)); byLine.set(line.lineIndex, (byLine.get(line.lineIndex) || 0n) + units(line.quantity));
    }
  }
  for (const proof of paymentProofs) {
    const actual = payments.find(payment => payment._id === proof.paymentId);
    if (!actual || !Array.isArray(proof.invoiceRefs) || !Array.isArray(actual.allocations) || proof.invoiceRefs.some(ref => !ref || typeof ref !== 'object') || actual.allocations.some(row => !row || typeof row !== 'object') || !proof.invoiceRefs.length || proof.invoiceRefs.length !== actual.allocations.length || new Set(proof.invoiceRefs.map(ref => ref.invoiceId)).size !== proof.invoiceRefs.length || proof.invoiceRefs.some(ref => !proofs.some(invoice => invoice.invoiceId === ref.invoiceId) || !actual.allocations.some(allocation => allocation.invoiceId === ref.invoiceId)) || hash(proof.snapshot) !== hash(actual) || actual.currency !== order.snapshot.currency || actual.allocations.reduce((sum, allocation) => sum + minor(allocation.amount), 0n) !== minor(actual.amount)) purchasedInvalid();
  }
  for (const [lineIndex, line] of order.snapshot.lines.entries()) {
    const expected = byLine.get(lineIndex) || 0n, tally = await db.collection('fulfillmentTallies').findOne({ ...filter, kind: 'SO_LINE_INVOICED', subjectId: salesOrderId, lineIndex }, options);
    if (expected > units(line.quantity) || units(tally?.quantity || '0') !== expected) purchasedInvalid();
  }
  for (const shipment of shipments) {
    const expected = byShipment.get(shipment._id) || 0n, tally = await db.collection('fulfillmentTallies').findOne({ ...filter, kind: 'SHIPMENT_INVOICED', subjectId: shipment._id, lineIndex: 0 }, options);
    if (expected > units(shipment.quantity) || units(tally?.quantity || '0') !== expected) purchasedInvalid();
  }
  return { byLine, byShipment, invoiceCount: invoices.length, paymentCount: payments.length };
}
