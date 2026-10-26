import { stockHash, stockHashless, stockSemantic, stockUnits, stockDecimal, stockInvalid } from './catalog-stock-values.mjs';
export { stockHash, stockHashless, stockSemantic, stockUnits, stockDecimal, stockInvalid } from './catalog-stock-values.mjs';
import { validateCustomerStockClaim } from './purchased-stock-proof.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const scope = row => ({ tenantId: row.tenantId, plantId: row.plantId });

export async function validateCatalogStockUse(db, receipt, origin, opening, session) {
  const filter = { ...scope(receipt), receiptId: receipt._id }, options = { session }, hash = stockHash;
  const head = await db.collection('catalogUseHeads').findOne({ ...scope(receipt), _id: receipt._id }, options), reservations = await db.collection('catalogMaterialReservations').find(filter, options).limit(101).toArray(), events = await db.collection('catalogUseEvents').find(filter, options).limit(402).toArray(), histories = await db.collection('catalogMaterialReservationRevisions').find(filter, options).limit(402).toArray(), issues = await db.collection('catalogMaterialIssues').find(filter, options).limit(101).toArray(), consumptions = await db.collection('catalogMaterialConsumptions').find(filter, options).limit(101).toArray();
  const stored = opening.head?.status === 'STORED', initial = stored ? stockUnits(opening.balance.acceptedQuantity) : 0n;
  if (!head) {
    if (await db.collection('catalogCustomerShipments').findOne(filter, options) || reservations.length || events.length || histories.length || issues.length || consumptions.length || await db.collection('catalogUseHeads').findOne(filter, options) || await db.collection('internalExecutions').findOne({ ...scope(receipt), sourceReceiptIds: receipt._id }, options)) stockInvalid();
    for (const name of ['internalExecutionEvents', 'internalExecutionKeys', 'internalExecutionAudit', 'internalExecutionOutbox', 'internalAttributionRevisions', 'internalOutputUnits', 'internalCompanyStockReceipts', 'internalCompanyStockUnits', 'purchasedFulfillmentHeads', 'purchasedFulfillmentEvents', 'purchasedFulfillmentKeys', 'purchasedFulfillmentAudit', 'purchasedFulfillmentOutbox', 'purchasedShipmentProofs', 'purchasedInvoiceProofs', 'purchasedPaymentProofs', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentKeys']) if (await db.collection(name).findOne({ ...scope(receipt), sourceReceiptIds: receipt._id }, options)) stockInvalid();
    return { head: null, version: 1, reservations: [], onHandQuantity: stockDecimal(initial), reservedQuantity: '0', issuedQuantity: '0', consumedQuantity: '0', availableQuantity: stockDecimal(initial), units: opening.units.map(unit => ({ ...unit, openingStatus: unit.status, status: unit.status })) };
  }
  if (!stored || head.receiptId !== receipt._id || head.originHash !== origin.contentHash || head.openingBalanceHash !== opening.balance.contentHash || !positive(head.version) || head.version < 2 || reservations.length > 100 || events.length > 400 || histories.length > 400 || events.length !== head.version - 1 || !Array.isArray(head.refs) || head.refs.length !== reservations.length) stockInvalid();
  const currentEvent = events.find(event => event._id === head.eventId), versions = events.map(event => event.version).sort((a, b) => a - b);
  if (!currentEvent || currentEvent.contentHash !== head.authorityHash || hash(currentEvent.snapshot) !== head.authorityHash || hash(stockSemantic(head)) !== head.authorityHash || versions.some((version, index) => version !== index + 2)) stockInvalid();
  for (const event of events) if (hash(event.snapshot) !== event.contentHash || event.snapshot.receiptId !== receipt._id || event.snapshot.version !== event.version || event.snapshot.originHash !== origin.contentHash || event.snapshot.openingBalanceHash !== opening.balance.contentHash) stockInvalid();
  let reserved = 0n, issued = 0n, consumed = 0n, shipped = 0n;
  const customerMovements = await db.collection('catalogCustomerShipments').find(filter, options).limit(402).toArray(), seenCustomerMovements = new Set();
  let hasCustomer = false;
  const occupied = new Map(), seenIssues = new Set(), seenConsumptions = new Set();
  if (new Set(head.refs.map(row => row.reservationId)).size !== head.refs.length || histories.length !== reservations.reduce((count, row) => count + row.version, 0)) stockInvalid();
  for (const row of reservations) {
    const pointer = head.refs.find(ref => ref.reservationId === row._id), revisions = histories.filter(history => history.reservationId === row._id).sort((a, b) => a.version - b.version), amount = stockUnits(row.quantity);
    if (!pointer || !positive(row.version) || pointer.version !== row.version || pointer.contentHash !== row.contentHash || hash(stockHashless(row)) !== row.contentHash || row.originHash !== origin.contentHash || row.openingBalanceHash !== opening.balance.contentHash || row.itemId !== origin.source.itemId || row.itemRevision !== origin.source.itemRevision || row.uom !== receipt.uom || row.ownerLegalEntityId !== origin.source.ownerLegalEntityId || amount <= 0n || !Array.isArray(row.serials) || revisions.length !== row.version) stockInvalid();
    const customer = Object.hasOwn(row, 'schema') || Object.hasOwn(row, 'demandKind') || revisions.some(history => history.snapshot?.schema === 'CATALOG_CUSTOMER_RESERVATION_V1');
    if (customer) {
      hasCustomer = true;
      const claim = await validateCustomerStockClaim(db, receipt, origin, opening, row, revisions, session);
      reserved += claim.reserved; shipped += claim.shipped;
      for (const unit of claim.occupied) { if (occupied.has(unit.serial)) stockInvalid(); occupied.set(unit.serial, unit); }
      for (const movementId of claim.movementIds) seenCustomerMovements.add(movementId);
      continue;
    }
    if (row.version > 3 || !['RESERVED', 'ISSUED', 'CONSUMED', 'RELEASED'].includes(row.status)) stockInvalid();
    let previous = null;
    for (let index = 0; index < revisions.length; index++) {
      const history = revisions[index], snapshot = history.snapshot;
      const bindingKeys = ['executionId', 'materialLineId', 'receiptId', 'originHash', 'openingBalanceHash', 'itemId', 'itemRevision', 'uom', 'ownerLegalEntityId', 'quantity', 'serials', 'sourceSnapshot'];
      const binding = value => Object.fromEntries(bindingKeys.map(key => [key, value[key]]));
      if (history.version !== index + 1 || hash(stockHashless(history)) !== history.contentHash || snapshot._id !== row._id || snapshot.receiptId !== receipt._id || snapshot.version !== history.version || hash(stockHashless(snapshot)) !== snapshot.contentHash || snapshot.previousHash !== (previous?.contentHash || null) || (previous && hash(binding(snapshot)) !== hash(binding(previous)))) stockInvalid();
      if (index === 0 ? snapshot.status !== 'RESERVED' : previous.status === 'RESERVED' ? !['ISSUED', 'RELEASED'].includes(snapshot.status) : previous.status !== 'ISSUED' || snapshot.status !== 'CONSUMED') stockInvalid(); previous = snapshot;
    }
    if (hash(previous) !== hash(row)) stockInvalid();
    const execution = await db.collection('internalExecutions').findOne({ ...scope(receipt), _id: row.executionId }, options), executionEvent = execution && await db.collection('internalExecutionEvents').findOne({ ...scope(receipt), _id: execution.eventId, executionId: execution._id }, options);
    if (!execution || !executionEvent || executionEvent.contentHash !== execution.authorityHash || executionEvent.version !== execution.version || executionEvent.status !== execution.status || hash(executionEvent.snapshot) !== execution.authorityHash || hash(stockSemantic(execution)) !== execution.authorityHash || !execution.sourceReceiptIds.includes(receipt._id) || !execution.reservations.some(ref => ref.reservationId === row._id && ref.version === row.version && ref.contentHash === row.contentHash)) stockInvalid();
    if (origin.source.trackingPolicy === 'LOT' ? row.serials.length !== 0 : row.serials.length < 1 || new Set(row.serials).size !== row.serials.length || amount !== BigInt(row.serials.length) * 1000000n || row.serials.some(serial => !opening.units.some(unit => unit.serial === serial && unit.status === 'AVAILABLE'))) stockInvalid();
    if (row.status !== 'RELEASED') for (const serial of row.serials) { if (occupied.has(serial)) stockInvalid(); occupied.set(serial, row); }
    if (row.status === 'RESERVED') reserved += amount;
    if (row.status === 'ISSUED') issued += amount;
    if (row.status === 'CONSUMED') consumed += amount;
    if (['ISSUED', 'CONSUMED'].includes(row.status)) {
      const issue = issues.find(issue => issue._id === row.issueId);
      if (!issue || seenIssues.has(issue._id) || hash(stockHashless(issue)) !== issue.contentHash || issue.contentHash !== row.issueHash || issue.reservationId !== row._id || issue.executionId !== row.executionId || issue.quantity !== row.quantity || hash(issue.serials) !== hash(row.serials) || issue.originHash !== origin.contentHash) stockInvalid(); seenIssues.add(issue._id);
    } else if (row.issueId !== null || row.issueHash !== null) stockInvalid();
    if (row.status === 'CONSUMED') {
      const consumption = consumptions.find(value => value._id === row.consumptionId);
      if (!consumption || seenConsumptions.has(consumption._id) || hash(stockHashless(consumption)) !== consumption.contentHash || consumption.contentHash !== row.consumptionHash || consumption.reservationId !== row._id || consumption.executionId !== row.executionId || consumption.quantity !== row.quantity || hash(consumption.serials) !== hash(row.serials) || consumption.issueId !== row.issueId || consumption.originHash !== origin.contentHash) stockInvalid(); seenConsumptions.add(consumption._id);
    } else if (row.consumptionId !== null || row.consumptionHash !== null) stockInvalid();
  }
  if (customerMovements.length !== seenCustomerMovements.size || customerMovements.some(row => !seenCustomerMovements.has(row._id)) || issues.length !== seenIssues.size || consumptions.length !== seenConsumptions.size || reserved + issued + consumed + shipped > initial || (hasCustomer ? head.shippedQuantity !== stockDecimal(shipped) : Object.hasOwn(head, 'shippedQuantity')) || head.reservedQuantity !== stockDecimal(reserved) || head.issuedQuantity !== stockDecimal(issued) || head.consumedQuantity !== stockDecimal(consumed)) stockInvalid();
  return { head, version: head.version, reservations, onHandQuantity: stockDecimal(initial - consumed - shipped), reservedQuantity: stockDecimal(reserved), issuedQuantity: stockDecimal(issued), consumedQuantity: stockDecimal(consumed), ...(hasCustomer ? { shippedQuantity: stockDecimal(shipped) } : {}), availableQuantity: stockDecimal(initial - reserved - issued - consumed - shipped), units: opening.units.map(unit => { const claim = occupied.get(unit.serial); return { ...unit, openingStatus: unit.status, status: claim ? claim.status : unit.status, ...(claim ? claim.demandKind ? { reservationId: claim.reservationId, salesOrderId: claim.salesOrderId, demandKind: claim.demandKind } : { reservationId: claim._id, executionId: claim.executionId } : {}) }; }) };
}
