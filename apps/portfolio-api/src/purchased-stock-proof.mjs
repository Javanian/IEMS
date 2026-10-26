import { stockHash as hash, stockHashless as hashless, stockSemantic as semantic, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { validateCatalogOrder } from './quote-catalog.mjs';

export const purchasedSchema = 'PURCHASED_FULFILLMENT_V1';
export const customerClaimSchema = 'CATALOG_CUSTOMER_RESERVATION_V1';
export const purchasedInvalid = () => { throw Object.assign(new Error('PURCHASED_FULFILLMENT_SOURCE_INVALID'), { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const scope = value => ({ tenantId: value.tenantId, plantId: value.plantId });
export const shipmentSemantic = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['documentFence', 'deliveryUseFence'].includes(key)));
export const invoiceSemantic = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'documentFence'));
const idsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && hash([...a].sort()) === hash([...b].sort());

export async function purchasedHeadProof(db, filter, salesOrderId, session) {
  const options = { session }, order = await db.collection('salesOrders').findOne({ ...filter, _id: salesOrderId }, options);
  if (!order) purchasedInvalid();
  if (!await validateCatalogOrder(db, filter, order, session)) throw Object.assign(new Error('PURCHASED_ORDER_UNSUPPORTED'), { status: 409, code: 'PURCHASED_ORDER_UNSUPPORTED' });
  const orderProof = await db.collection('quoteCatalogOrders').findOne({ ...filter, orderId: salesOrderId }, options);
  const head = await db.collection('purchasedFulfillmentHeads').findOne({ ...filter, _id: salesOrderId }, options);
  const events = await db.collection('purchasedFulfillmentEvents').find({ ...filter, salesOrderId }, options).sort({ version: 1 }).limit(402).toArray();
  if (!head) {
    if (events.length || await db.collection('purchasedFulfillmentHeads').findOne({ ...filter, salesOrderId }, options)) purchasedInvalid();
    for (const name of ['purchasedFulfillmentKeys', 'purchasedFulfillmentAudit', 'purchasedFulfillmentOutbox', 'catalogMaterialReservations', 'catalogCustomerShipments', 'purchasedShipmentProofs', 'purchasedInvoiceProofs', 'purchasedPaymentProofs', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentKeys']) if (await db.collection(name).findOne({ ...filter, salesOrderId }, options)) purchasedInvalid();
    return { order, orderProof, head: null, version: 1, events: [] };
  }
  if (head.schema !== purchasedSchema || head.salesOrderId !== salesOrderId || head.orderHash !== orderProof.orderHash || head.ownerLegalEntityId !== order.ownerLegalEntityId || !positive(head.version) || head.version < 2 || head.version > 401 || events.length !== head.version - 1 || !Array.isArray(head.refs) || head.refs.length > 100 || new Set(head.refs.map(ref => ref.reservationId)).size !== head.refs.length || !Array.isArray(head.shipmentRefs) || head.shipmentRefs.length > 100 || new Set(head.shipmentRefs.map(ref => ref.shipmentId)).size !== head.shipmentRefs.length) purchasedInvalid();
  const keys = await db.collection('purchasedFulfillmentKeys').find({ ...filter, salesOrderId }, options).limit(402).toArray();
  if (keys.length !== events.length) purchasedInvalid();
  const envelopes = [];
  for (const name of ['purchasedFulfillmentAudit', 'purchasedFulfillmentOutbox']) { const rows = await db.collection(name).find({ ...filter, salesOrderId }, options).limit(402).toArray(); if (rows.length !== events.length || new Set(rows.map(row => row.version)).size !== rows.length) purchasedInvalid(); envelopes.push(rows); }
  let previous = null, previousSnapshot = null;
  for (const [index, event] of events.entries()) {
    const command = event.snapshot?.commandProof, key = command && await db.collection('purchasedFulfillmentKeys').findOne({ ...filter, key: command.key, salesOrderId }, options);
    if (!Array.isArray(event.snapshot?.refs) || !Array.isArray(event.snapshot?.shipmentRefs) || !Array.isArray(event.sourceReceiptIds) || envelopes.some(rows => !rows.some(row => row.version === event.version && row.kind === event.kind && row.reason === event.reason && row.recordedBy === event.recordedBy && hash(row.sourceReceiptIds) === hash(event.sourceReceiptIds))) || event.version !== index + 2 || event.snapshot?.schema !== purchasedSchema || event.snapshot.salesOrderId !== salesOrderId || event.snapshot.orderHash !== head.orderHash || event.snapshot.version !== event.version || event.previousHash !== previous || hash(event.snapshot) !== event.contentHash || !key || key.kind !== command.kind || key.payloadHash !== command.payloadHash || hash(key.result) !== command.resultHash) purchasedInvalid();
    const result = key.result;
    if (!result || result.kind !== command.kind || result.salesOrderId !== salesOrderId || result.version !== event.version) purchasedInvalid();
    const oldRefs = previousSnapshot?.refs || [], changed = event.snapshot.refs.filter(ref => !oldRefs.some(old => old.reservationId === ref.reservationId && old.version === ref.version && old.contentHash === ref.contentHash));
    if (command.kind === 'SHIPMENT_POSTED') {
      const fresh = event.snapshot.shipmentRefs.filter(ref => !(previousSnapshot?.shipmentRefs || []).some(old => old.shipmentId === ref.shipmentId));
      const proof = await db.collection('purchasedShipmentProofs').findOne({ ...filter, shipmentId: result.shipmentId, salesOrderId }, options);
      if (fresh.length !== 1 || fresh[0].shipmentId !== result.shipmentId || !proof || hash(hashless(proof)) !== proof.contentHash || fresh[0].contentHash !== proof.contentHash || result.shipmentHash !== proof.shipmentHash || hash(proof.snapshot) !== proof.shipmentHash || hash(changed.map(ref => ref.reservationId).sort()) !== hash(proof.snapshot.sources.map(source => source.sourceId).sort())) purchasedInvalid();
    } else {
      const pointer = changed[0], history = await db.collection('catalogMaterialReservationRevisions').findOne({ ...filter, reservationId: result.reservationId, version: result.reservationVersion }, options);
      if (!['RESERVATION_CREATED', 'RESERVATION_RELEASED'].includes(command.kind) || changed.length !== 1 || pointer.reservationId !== result.reservationId || pointer.version !== result.reservationVersion || pointer.contentHash !== result.reservationHash || !history || hash(hashless(history)) !== history.contentHash || history.snapshot?.contentHash !== result.reservationHash || hash(hashless(history.snapshot)) !== result.reservationHash || history.snapshot.salesOrderId !== salesOrderId || history.snapshot.status !== (command.kind === 'RESERVATION_CREATED' ? 'RESERVED' : 'RELEASED')) purchasedInvalid();
    }
    previousSnapshot = event.snapshot;
    previous = event.contentHash;
  }
  if (events.at(-1)._id !== head.eventId || previous !== head.authorityHash || hash(semantic(head)) !== head.authorityHash) purchasedInvalid();
  return { order, orderProof, head, version: head.version, events };
}

export async function validateCustomerStockClaim(db, receipt, origin, opening, row, revisions, session) {
  const filter = scope(receipt), options = { session }, current = await purchasedHeadProof(db, filter, row.salesOrderId, session);
  const line = current.order.snapshot.lines[row.lineIndex], binding = line?.catalogBinding, ref = current.head?.refs.find(value => value.reservationId === row._id);
  if (row.schema !== customerClaimSchema || row.demandKind !== 'SALES_ORDER_LINE' || row.sourceKind !== 'CATALOG_RECEIPT' || Object.hasOwn(row, 'executionId') || Object.hasOwn(row, 'materialLineId') || !ref || ref.version !== row.version || ref.contentHash !== row.contentHash || !positive(row.version) || row.version > 401 || !line || binding?.itemSnapshot?.content.kind !== 'PURCHASED' || row.salesOrderVersion !== current.order.version || row.orderHash !== current.orderProof.orderHash || row.bindingHash !== hash(binding) || origin.source.itemVersion !== binding.itemVersion || origin.source.itemContentHash !== binding.contentHash || row.itemId !== binding.itemId || row.itemRevision !== binding.itemRevision || row.ownerLegalEntityId !== binding.ownerLegalEntityId || row.uom !== line.uom || !Array.isArray(row.unitIds) || !Array.isArray(row.serials) || !Array.isArray(row.shippedUnitIds) || !['RESERVED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'RELEASED'].includes(row.status) || !Array.isArray(revisions) || revisions.length !== row.version) purchasedInvalid();
  const immutable = value => Object.fromEntries(['schema', 'demandKind', 'sourceKind', 'salesOrderId', 'salesOrderVersion', 'lineIndex', 'orderHash', 'bindingHash', 'receiptId', 'originHash', 'openingBalanceHash', 'itemId', 'itemRevision', 'uom', 'ownerLegalEntityId', 'quantity', 'serials', 'unitIds', 'sourceSnapshot', 'recordedBy', 'recordedAt'].map(key => [key, value[key]]));
  let previous;
  for (const [index, history] of revisions.entries()) {
    const snapshot = history.snapshot;
    if (!snapshot || history.version !== index + 1 || hash(hashless(history)) !== history.contentHash || snapshot._id !== row._id || snapshot.receiptId !== receipt._id || snapshot.version !== history.version || hash(hashless(snapshot)) !== snapshot.contentHash || snapshot.previousHash !== (previous?.contentHash || null) || previous && hash(immutable(snapshot)) !== hash(immutable(previous))) purchasedInvalid();
    const q = units(snapshot.quantity), shipped = units(snapshot.shippedQuantity), released = units(snapshot.releasedQuantity), remaining = units(snapshot.remainingQuantity);
    if (q <= 0n || shipped + released + remaining !== q || snapshot.status === 'RESERVED' && (shipped !== 0n || released !== 0n || remaining !== q) || snapshot.status === 'PARTIALLY_SHIPPED' && (shipped <= 0n || remaining <= 0n || released !== 0n) || snapshot.status === 'SHIPPED' && (shipped !== q || remaining !== 0n || released !== 0n) || snapshot.status === 'RELEASED' && (released <= 0n || remaining !== 0n) || index === 0 && snapshot.status !== 'RESERVED') purchasedInvalid();
    if (previous && (!['RESERVED', 'PARTIALLY_SHIPPED'].includes(previous.status) || shipped < units(previous.shippedQuantity) || released < units(previous.releasedQuantity))) purchasedInvalid();
    const anchored = current.events.some(event => event.snapshot.refs.some(ref => ref.reservationId === row._id && ref.version === snapshot.version && ref.contentHash === snapshot.contentHash));
    if (!anchored) purchasedInvalid();
    previous = snapshot;
  }
  if (hash(previous) !== hash(row)) purchasedInvalid();
  const selected = row.unitIds.map(unitId => opening.units.find(unit => unit._id === unitId));
  if (new Set(row.unitIds).size !== row.unitIds.length || selected.some(unit => !unit || unit.status !== 'AVAILABLE') || (origin.source.trackingPolicy === 'LOT' ? row.unitIds.length !== 0 || row.serials.length !== 0 || row.shippedUnitIds.length !== 0 : !idsEqual(selected.map(unit => unit.serial), row.serials) || units(row.quantity) !== BigInt(selected.length) * 1000000n || new Set(row.shippedUnitIds).size !== row.shippedUnitIds.length || row.shippedUnitIds.some(unitId => !row.unitIds.includes(unitId)) || units(row.shippedQuantity) !== BigInt(row.shippedUnitIds.length) * 1000000n)) purchasedInvalid();
  const expectedSnapshot = { ...origin.source, locationSnapshot: opening.balance.locationSnapshot, lotNumber: receipt.lotNumber ?? null, heatNumber: receipt.heatNumber ?? null, units: selected.map(unit => ({ unitId: unit._id, registryId: unit.registryId, serial: unit.serial, contentHash: unit.contentHash })) };
  if (hash(row.sourceSnapshot) !== hash(expectedSnapshot)) purchasedInvalid();
  const movements = await db.collection('catalogCustomerShipments').find({ ...filter, reservationId: row._id }, options).limit(101).toArray();
  if (movements.length > 100) purchasedInvalid();
  let shipped = 0n; const shippedIds = [];
  for (const movement of movements) {
    if (hash(hashless(movement)) !== movement.contentHash || movement.receiptId !== receipt._id || movement.salesOrderId !== row.salesOrderId || movement.lineIndex !== row.lineIndex || movement.reservationId !== row._id || movement.originHash !== origin.contentHash || movement.openingBalanceHash !== opening.balance.contentHash || movement.bindingHash !== row.bindingHash || movement.uom !== row.uom || !Array.isArray(movement.unitIds) || !Array.isArray(movement.serials)) purchasedInvalid();
    const proof = await db.collection('purchasedShipmentProofs').findOne({ ...filter, shipmentId: movement.shipmentId }, options);
    if (!proof || hash(hashless(proof)) !== proof.contentHash || !proof.movementRefs?.some(ref => ref.movementId === movement._id && ref.contentHash === movement.contentHash) || !current.head.shipmentRefs.some(ref => ref.shipmentId === proof.shipmentId && ref.contentHash === proof.contentHash)) purchasedInvalid();
    const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: movement.shipmentId }, options);
    if (!shipment || hash(shipmentSemantic(shipment)) !== proof.shipmentHash || proof.snapshot?.salesOrderId !== row.salesOrderId || hash(proof.snapshot) !== proof.shipmentHash) purchasedInvalid();
    const part = shipment.sources.find(source => source.sourceId === row._id);
    if (!part || part.sourceType !== 'CATALOG_RESERVATION' || part.receiptId !== receipt._id || part.quantity !== movement.quantity || hash(part.unitIds) !== hash(movement.unitIds) || hash(part.serials || []) !== hash(movement.serials) || units(movement.quantity) <= 0n) purchasedInvalid();
    shipped += units(movement.quantity); shippedIds.push(...movement.unitIds);
  }
  if (shipped !== units(row.shippedQuantity) || !idsEqual(shippedIds, row.shippedUnitIds)) purchasedInvalid();
  const occupied = selected.filter(unit => row.shippedUnitIds.includes(unit._id) || row.status !== 'RELEASED').map(unit => ({ serial: unit.serial, status: row.shippedUnitIds.includes(unit._id) ? 'SHIPPED' : 'RESERVED', reservationId: row._id, salesOrderId: row.salesOrderId, demandKind: row.demandKind }));
  return { reserved: units(row.remainingQuantity), shipped, occupied, movementIds: movements.map(row => row._id) };
}
