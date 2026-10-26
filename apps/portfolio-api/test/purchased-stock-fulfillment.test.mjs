import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';
import { ownerPurchasedFixture, command, allSnapshot, denied, withAuth } from './support/purchased-owner-fixture.mjs';
import { stockHash } from '../src/catalog-stock-values.mjs';

test('purchased LOT/SERIAL stock fulfills real typed customer demand without production consumption', async t => {
  const h = await startOwned(t), f = await ownerPurchasedFixture(h), shipments = [];
  let serialFirst, lotFirst, serialIds, firstReserveBody, serialClaim;
  await t.test('standalone fulfillment/source reader sees a scoped mixed SO and exact opening QC identities without quote grants', async () => {
    const restore = await h.setRoles(h.seeded[0], ['purchasedFulfillmentReader']);
    try {
      const before = await allSnapshot(h), view = await f.read(); assert.equal(view.lines[0].supported, true); assert.equal(view.lines[2].supported, false); assert.deepEqual(view.lines[2].blockers, ['PURCHASED_LINE_UNSUPPORTED']); assert.equal((await h.req(`/commercial/orders/${f.so._id}`, undefined, h.alpha)).status, 403); assert.deepEqual(await allSnapshot(h), before);
    } finally { await restore(); }
    assert.equal((await h.req(f.path, undefined, h.beta)).status, 404);
    const stock = await f.stock(f.serialReceipt); serialIds = stock.units.filter(unit => unit.eligible).map(unit => unit._id); assert.equal(serialIds.length, 3); assert.equal(stock.units.find(unit => unit.serial === f.originalSerials[3]).status, 'REJECTED_QUARANTINE');
  });
  await t.test('malformed fractional duplicate rejected-unit and wrong-item claims fail atomically', async () => {
    const current = await f.read(), source = await f.stock(f.serialReceipt), payload = command({ expectedVersion: current.version, expectedSalesOrderVersion: f.so.version, lineIndex: 1, receiptId: f.serialReceipt._id, expectedReceiptVersion: source.receiptVersion, expectedStockVersion: source.version, quantity: '1', unitIds: [serialIds[0]] });
    await denied(h, `${f.path}/reservations`, { ...payload, quantity: '0.5' }, 'INVALID_UNITS', 400);
    await denied(h, `${f.path}/reservations`, { ...payload, quantity: '2', unitIds: [serialIds[0], serialIds[0]] }, 'INVALID_UNITS', 400);
    await denied(h, `${f.path}/reservations`, { ...payload, unitIds: [source.units.find(unit => unit.status === 'REJECTED_QUARANTINE')._id] }, 'INVALID_UNITS', 400);
    await denied(h, `${f.path}/reservations`, { ...payload, lineIndex: 2 }, 'PURCHASED_LINE_UNSUPPORTED');
    await denied(h, `${f.path}/reservations`, { ...payload, lineIndex: 0 }, 'PURCHASED_ITEM_CHANGED');
  });
  await t.test('one shared stock claim reserves actual serials and stable replay acknowledges the original command', async () => {
    const result = await f.reserve(1, f.serialReceipt, '3', serialIds); firstReserveBody = result.body; serialClaim = result.view.commandReceipt.reservationId;
    const source = await f.stock(f.serialReceipt); assert.equal(source.reservedQuantity, '3'); assert.equal(source.availableQuantity, '0'); assert.equal(source.consumedQuantity, '0'); assert.equal(source.onHandQuantity, '3'); assert.equal(source.units.filter(unit => unit.status === 'RESERVED').length, 3);
    const before = await allSnapshot(h), replay = await h.ok(`${f.path}/reservations`, firstReserveBody); assert.deepEqual(replay.commandReceipt, result.view.commandReceipt); assert.deepEqual(await allSnapshot(h), withAuth(before, h, 2));
    const claim = await h.db.collection('catalogMaterialReservations').findOne({ _id: serialClaim }); assert.equal(claim.demandKind, 'SALES_ORDER_LINE'); assert.equal(Object.hasOwn(claim, 'executionId'), false);
  });
  await t.test('partial serial dispatch then held remainder release never frees the actually shipped identity', async () => {
    const currentBefore = await f.read(), claimBefore = currentBefore.reservations.find(row => row._id === serialClaim), stockBefore = await f.stock(f.serialReceipt);
    const shipBody = command({ expectedVersion: currentBefore.version, expectedSalesOrderVersion: f.so.version, lineIndex: 1, reference: 'Owner actual rollback-retried dispatch', sources: [{ reservationId: serialClaim, expectedReservationVersion: claimBefore.version, expectedReceiptVersion: stockBefore.receiptVersion, expectedStockVersion: stockBefore.version, quantity: '1', unitIds: [serialIds[0]] }] });
    const before = await allSnapshot(h), originalCollection = h.db.collection.bind(h.db);
    h.db.collection = (name, ...args) => { const collection = originalCollection(name, ...args); if (name === 'purchasedFulfillmentOutbox') collection.insertOne = async () => { throw new Error('OWNER_ACTUAL_DISPATCH_OUTBOX_FAILURE'); }; return collection; };
    try { assert.equal((await h.req(`${f.path}/shipments`, shipBody, h.alpha)).status, 500); } finally { h.db.collection = originalCollection; }
    assert.deepEqual(await allSnapshot(h), before, 'dispatch outbox rollback includes shared stock, demand, identities and auth fences');
    serialFirst = await h.ok(`${f.path}/shipments`, shipBody, 201); shipments.push(serialFirst);
    let source = await f.stock(f.serialReceipt); assert.equal(source.shippedQuantity, '1'); assert.equal(source.onHandQuantity, '2'); assert.equal(source.reservedQuantity, '2'); assert.equal(source.units.find(unit => unit._id === serialIds[0]).status, 'SHIPPED');
    const response = await h.send(`/warehouse/receipts/${f.serialReceipt._id}/holds`, { body: { expectedReceiptVersion: source.receiptVersion, reasonCode: 'QC_SUSPECT', reasonNote: 'Owner live hold after partial dispatch' }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(response.status, 201); const hold = response.data.hold;
    const released = await f.release(serialClaim), row = released.view.reservations.find(row => row._id === serialClaim); assert.equal(row.status, 'RELEASED'); assert.equal(row.shippedQuantity, '1'); assert.equal(row.releasedQuantity, '2'); assert.deepEqual(row.shippedUnitIds, [serialIds[0]]);
    source = await f.stock(f.serialReceipt); assert.equal(source.availableQuantity, '2'); assert.equal(source.eligibleQuantity, '0'); assert.equal(source.units.find(unit => unit._id === serialIds[0]).status, 'SHIPPED');
    const current = await f.read(); await denied(h, `${f.path}/reservations`, command({ expectedVersion: current.version, expectedSalesOrderVersion: f.so.version, lineIndex: 1, receiptId: f.serialReceipt._id, expectedReceiptVersion: source.receiptVersion, expectedStockVersion: source.version, quantity: '1', unitIds: [serialIds[1]] }), 'STOCK_ENCUMBERED');
    const clear = await h.send(`/warehouse/holds/${hold.id}/release`, { body: { expectedVersion: hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Owner actual hold release' }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(clear.status, 200);
    const next = await f.reserve(1, f.serialReceipt, '2', serialIds.slice(1)), final = await f.ship(next.view.commandReceipt.reservationId, '2', serialIds.slice(1)); shipments.push(final.shipment);
    const finalSource = await f.stock(f.serialReceipt); assert.equal(finalSource.shippedQuantity, '3'); assert.equal(finalSource.availableQuantity, '0'); assert.equal(finalSource.consumedQuantity, '0'); assert.equal(finalSource.units.filter(unit => unit.status === 'SHIPPED').length, 3);
  });
  await t.test('LOT decimal partial dispatch releases only remainder and reclaims exact remaining demand', async () => {
    const first = await f.reserve(0, f.lotReceipt, '5.5'), claim = first.view.commandReceipt.reservationId;
    lotFirst = (await f.ship(claim, '1.25')).shipment; shipments.push(lotFirst);
    const released = await f.release(claim), old = released.view.reservations.find(row => row._id === claim); assert.equal(old.shippedQuantity, '1.25'); assert.equal(old.releasedQuantity, '4.25'); assert.equal(released.view.lines[0].remainingReserveQuantity, '4.25');
    const next = await f.reserve(0, f.lotReceipt, '4.25'), final = (await f.ship(next.view.commandReceipt.reservationId, '4.25')).shipment; shipments.push(final);
    const source = await f.stock(f.lotReceipt); assert.equal(source.shippedQuantity, '5.5'); assert.equal(source.onHandQuantity, '0'); assert.equal(source.availableQuantity, '0'); assert.equal(source.consumedQuantity, '0');
    const completed = await f.read(); assert.equal(completed.lines[0].canReserve, false); assert.equal(completed.lines[0].canShip, false); assert.equal(completed.lines[1].canReserve, false); assert.equal(completed.lines[1].canShip, false);
    const beforeRead = await allSnapshot(h), reconciliation = await h.ok(`/fulfillment/orders/${f.so._id}/reconciliation`); assert.equal(reconciliation.matches, true); assert.equal(reconciliation.shipmentCount, 4); assert.equal(reconciliation.movementCount, 4); assert.equal(reconciliation.lines[0].movementQuantity, '5.5'); assert.equal(reconciliation.lines[1].movementQuantity, '3'); assert.equal(reconciliation.lines[2].movementQuantity, '0'); assert.deepEqual(await allSnapshot(h), beforeRead);
    for (const receipt of [f.lotReceipt, f.serialReceipt]) { const physical = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id }); assert.equal(physical.availableQuantity, '0'); assert.equal(physical.reservedQuantity, '0'); assert.equal(await h.db.collection('warehouseMovements').countDocuments({ receiptId: receipt._id, kind: 'SHIP' }), 0); }
    assert.equal(await h.db.collection('internalExecutions').countDocuments(), 0); assert.equal(await h.db.collection('manufacturingWorkOrders').countDocuments(), 0); assert.equal(await h.db.collection('catalogMaterialConsumptions').countDocuments(), 0);
  });
  await t.test('unknown-result replay returns the same immutable acknowledgement with current advanced state', async () => {
    const current = await f.read(), before = await allSnapshot(h), replay = await h.ok(`${f.path}/reservations`, firstReserveBody); assert.equal(replay.commandReceipt.reservationId, serialClaim); assert.equal(replay.commandReceipt.version, 2); assert.equal(replay.version, current.version); assert.equal(replay.lines[1].shippedQuantity, '3'); assert.deepEqual(await allSnapshot(h), withAuth(before, h, 2));
    const restore = await h.setRoles(h.seeded[0], ['purchasedFulfillmentReader']); try { await denied(h, `${f.path}/reservations`, firstReserveBody, 'SCOPE_DENIED', 403); } finally { await restore(); }
  });
  await t.test('immutable acknowledgements and missing common source heads reject corruption atomically', async () => {
    const raw = await h.db.collection('purchasedFulfillmentKeys').findOne({ key: firstReserveBody.idempotencyKey }), altered = { ...raw, result: { ...raw.result, reservationHash: 'f'.repeat(64) } };
    await h.db.collection('purchasedFulfillmentKeys').replaceOne({ _id: raw._id }, altered);
    try { await denied(h, `${f.path}/reservations`, firstReserveBody, 'PURCHASED_FULFILLMENT_SOURCE_INVALID'); } finally { await h.db.collection('purchasedFulfillmentKeys').replaceOne({ _id: raw._id }, raw); }
    const head = await h.db.collection('catalogUseHeads').findOne({ _id: f.serialReceipt._id }); await h.db.collection('catalogUseHeads').deleteOne({ _id: head._id });
    try { await denied(h, `/catalog-stock/receipts/${head._id}`, undefined, 'CATALOG_STOCK_SOURCE_INVALID'); } finally { await h.db.collection('catalogUseHeads').insertOne(head); }
  });
  await t.test('actual purchased POD accepts real incoming identities and rejects corrupt retained source before replay', async () => {
    for (const shipment of shipments) {
      const view = await h.ok(`/deliveries/shipments/${shipment._id}`), serials = shipment.sources.flatMap(source => source.serials || []), payload = { expectedVersion: view.version, expectedShipmentVersion: shipment.version, quantity: shipment.quantity, ...(serials.length ? { serials } : {}), deliveredAt: new Date().toISOString(), receiverName: 'Owner receiver', receiverReference: 'Owner actual receiver record', evidenceReference: 'Owner synthetic delivery evidence', evidenceNotes: 'Operator recorded delivery, no carrier verification claim', idempotencyKey: randomUUID() };
      const delivered = await h.ok(`/deliveries/shipments/${shipment._id}/confirmations`, payload, 201); assert.equal(delivered.status, 'DELIVERED');
      if (shipment._id === serialFirst._id) {
        const stored = await h.db.collection('fulfillmentShipments').findOne({ _id: shipment._id }); await h.db.collection('fulfillmentShipments').updateOne({ _id: stored._id }, { $set: { quantity: '999' } });
        try { await denied(h, `/deliveries/shipments/${shipment._id}/confirmations`, payload, 'PURCHASED_FULFILLMENT_SOURCE_INVALID'); } finally { await h.db.collection('fulfillmentShipments').replaceOne({ _id: stored._id }, stored); }
      }
    }
  });
  let invoice, invoiceBody, payment, paymentBody;
  await t.test('withdrawn current item does not erase historical purchased shipment invoice and full payment chain', async () => {
    await h.ok(`/inventory-master/items/${f.lot._id}/revisions`, command({ expectedVersion: f.lot.version, ...f.lot.content, description: 'Owner actual later catalog successor' }));
    invoiceBody = { salesOrderId: f.so._id, expectedVersion: f.so.version, lines: shipments.map(shipment => ({ shipmentId: shipment._id, quantity: shipment.quantity })), idempotencyKey: randomUUID() };
    invoice = await h.ok('/fulfillment/invoices', invoiceBody, 201); assert.equal(invoice.schema, 'PURCHASED_INVOICE_V1'); assert.equal(invoice.total, '17.00');
    paymentBody = { accountId: f.account._id, amount: '5.00', currency: 'USD', reference: 'Owner first actual settlement', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '5.00' }], idempotencyKey: randomUUID() };
    payment = await h.ok('/fulfillment/payments', paymentBody, 201); assert.equal(payment.schema, 'PURCHASED_PAYMENT_V1');
    let current = await h.ok(`/fulfillment/invoices/${invoice._id}`); assert.equal(current.status, 'PARTIALLY_PAID'); assert.equal(current.outstandingAmount, '12.00');
    await h.ok('/fulfillment/payments', { accountId: f.account._id, amount: '12.00', currency: 'USD', reference: 'Owner final actual settlement', allocations: [{ invoiceId: invoice._id, expectedVersion: current.version, amount: '12.00' }], idempotencyKey: randomUUID() }, 201);
    current = await h.ok(`/fulfillment/invoices/${invoice._id}`); assert.equal(current.version, 3); assert.equal(current.status, 'PAID'); assert.equal(current.paidAmount, '17.00'); assert.equal(current.outstandingAmount, '0.00'); assert.equal(current.allocations.length, 2);
    const source = await h.ok(`/documents/sources/invoice/${invoice._id}?sourceVersion=1`); assert.equal(source.total, '17.00');
  });
  await t.test('financial replay and PDF preparation reject proof and retained-result corruption without effects', async () => {
    const stored = await h.db.collection('fulfillmentKeys').findOne({ key: invoiceBody.idempotencyKey });
    await h.db.collection('fulfillmentKeys').replaceOne({ _id: stored._id }, { ...stored, result: { ...stored.result, _id: randomUUID() } });
    try { await denied(h, '/fulfillment/invoices', invoiceBody, 'PURCHASED_FULFILLMENT_SOURCE_INVALID'); } finally { await h.db.collection('fulfillmentKeys').replaceOne({ _id: stored._id }, stored); }
    const current = await h.db.collection('fulfillmentInvoices').findOne({ _id: invoice._id }); await h.db.collection('fulfillmentInvoices').updateOne({ _id: current._id }, { $set: { outstandingAmount: '0.01' } });
    try { await denied(h, `/documents/sources/invoice/${invoice._id}?sourceVersion=1`, undefined, 'PURCHASED_FULFILLMENT_SOURCE_INVALID'); } finally { await h.db.collection('fulfillmentInvoices').replaceOne({ _id: current._id }, current); }
    const shipmentTally = await h.db.collection('fulfillmentTallies').findOne({ kind: 'SHIPMENT_INVOICED', subjectId: serialFirst._id }), lineTally = await h.db.collection('fulfillmentTallies').findOne({ kind: 'SO_LINE_INVOICED', subjectId: f.so._id, lineIndex: 1 });
    await h.db.collection('fulfillmentTallies').updateMany({ _id: { $in: [shipmentTally._id, lineTally._id] } }, { $set: { quantity: '0' } });
    try {
      await denied(h, '/fulfillment/invoices', { ...invoiceBody, lines: [{ shipmentId: serialFirst._id, quantity: serialFirst.quantity }], idempotencyKey: randomUUID() }, 'PURCHASED_FULFILLMENT_SOURCE_INVALID');
      for (const path of [f.path, `/fulfillment/orders/${f.so._id}/balances`, `/fulfillment/orders/${f.so._id}/entitlement`]) await denied(h, path, undefined, 'PURCHASED_FULFILLMENT_SOURCE_INVALID');
    } finally { for (const row of [shipmentTally, lineTally]) await h.db.collection('fulfillmentTallies').replaceOne({ _id: row._id }, row); }
    const before = await allSnapshot(h), replay = await h.ok('/fulfillment/payments', paymentBody, 201); assert.deepEqual(replay, payment); assert.deepEqual(await allSnapshot(h), withAuth(before, h, 1));
  });
});
