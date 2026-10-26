import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
  startOwned, allSnapshot, denied, guardedReplay, restoreRow, command,
  makePurchasedFixture, makeSalesOrder, makeProductionConsumer, productionReserveBody, makeAdditionalLot,
  orderPath, stockPath, reservationBody, releaseBody, shipmentBody, receiptHold, releaseHold, immutableOpening, assertImmutableOpening,
} from './support.mjs';
import { existingSourceCAS, absentSourceCAS } from './source-cas.mjs';

const canonical = value => value instanceof Date ? value : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const hashless = ({ contentHash, ...row }) => ({ ...row, contentHash: hash(row) });
const claimFor = (view, receipt) => {
  const acknowledgement = view.commandReceipt;
  assert.equal(acknowledgement?.kind, 'RESERVATION_CREATED');
  const claim = view.reservations.find(row => row._id === acknowledgement.reservationId);
  assert.ok(claim, 'The immutable acknowledgement must identify the actual newly created reservation');
  assert.equal(claim.receiptId, receipt._id);
  assert.equal(claim.version, acknowledgement.reservationVersion);
  assert.equal(claim.contentHash, acknowledgement.reservationHash);
  return claim;
};
const invoiceBody = (order, shipment, quantity) => ({ salesOrderId: order._id, expectedVersion: order.version, lines: [{ shipmentId: shipment._id, quantity }], idempotencyKey: randomUUID() });

test('independent purchased customer fulfillment shares real catalog custody and preserves frozen evidence', async t => {
  const h = await startOwned(t), f = await makePurchasedFixture(h, { includeManufactured: true });
  const path = orderPath(f.salesOrder), opening = await immutableOpening(h, [f.lotReceipt, f.serialReceipt]);
  const read = () => h.ok(path), source = receipt => h.ok(stockPath(receipt));
  const units = (await source(f.serialReceipt)).units.filter(row => row.eligible);
  assert.equal(units.length, f.acceptedSerials.length);
  let lotClaim, serialClaim, serialReserveBody, serialReserveReceipt, lotReserveBody, serialShipment, serialShipBody;
  let podBody, podResult, invoice, invoiceCommand, payment, paymentCommand, serialHoldRelease;

  await t.test('scoped read is write free and fulfillment-only reader needs no commercial or master grant', async () => {
    const before = await allSnapshot(h), view = await read();
    assert.equal(view.schema, 'PURCHASED_FULFILLMENT_V1');
    assert.equal(view.salesOrder._id, f.salesOrder._id);
    assert.deepEqual(view.lines.map(line => line.supported), [true, true, false]);
    await h.ok(`/purchased-fulfillment/orders?limit=1`);
    await h.ok(`${path}/events?limit=1`);
    assert.deepEqual(await allSnapshot(h), before);
    await denied(h, path, undefined, { status: 404, cookie: h.beta });
    await denied(h, `${path}?tenant_id=${(await h.scopeOf(h.beta)).tenantId}`, undefined, { status: 403 });
    const restore = await h.setRoles(await h.scopeOf(h.alpha), ['purchasedFulfillmentReader']);
    try {
      const snapshot = await allSnapshot(h); assert.equal((await read()).salesOrder._id, f.salesOrder._id);
      assert.deepEqual(await allSnapshot(h), snapshot);
      await denied(h, `${path}/reservations`, await reservationBody(h, f.salesOrder, f.lotReceipt, 0, '0.1'), { status: 403 });
      assert.equal((await h.req(`/commercial/quotes/${f.quote._id}`, undefined, h.alpha)).status, 403);
    } finally { await restore(); }
  });

  await t.test('units, decimal precision, typed line identity and caller-owned fields fail without any durable delta', async () => {
    const body = await reservationBody(h, f.salesOrder, f.lotReceipt, 0, '0.1');
    for (const quantity of ['0', '-1', '1e-1', '0.0000001', 0.1]) await denied(h, `${path}/reservations`, { ...body, quantity, idempotencyKey: randomUUID() }, { status: 400, code: 'INVALID_QUANTITY' });
    await denied(h, `${path}/reservations`, { ...body, unitIds: null }, { status: 400, code: 'INVALID_UNITS' });
    await denied(h, `${path}/reservations`, { ...body, sourceKind: 'CATALOG_RECEIPT' }, { status: 400, code: 'UNKNOWN_FIELD' });
    await denied(h, `${path}/reservations`, { ...body, lineIndex: 2 }, { status: 409, code: 'PURCHASED_LINE_UNSUPPORTED' });
    await denied(h, `${path}/reservations`, { ...body, lineIndex: 1 }, { status: 409, code: 'PURCHASED_ITEM_CHANGED' });
    const serial = await reservationBody(h, f.salesOrder, f.serialReceipt, 1, '1', [units[0]._id]);
    for (const selection of [[], [units[0]._id, units[0]._id], [randomUUID()]]) await denied(h, `${path}/reservations`, { ...serial, unitIds: selection, idempotencyKey: randomUUID() }, { status: 400, code: 'INVALID_UNITS' });
    await denied(h, `${path}/reservations`, { ...serial, quantity: '0.5' }, { status: 400, code: 'INVALID_UNITS' });
    const rejected = (await source(f.serialReceipt)).units.find(row => row.serial === f.rejectedSerials[0]); assert.ok(rejected); assert.equal(rejected.eligible, false);
    await denied(h, `${path}/reservations`, { ...serial, unitIds: [rejected._id] }, { status: 400, code: 'INVALID_UNITS' });
  });

  await t.test('LOT millionths and real SERIAL IDs reserve the shared source without touching immutable opening evidence', async () => {
    lotReserveBody = await reservationBody(h, f.salesOrder, f.lotReceipt, 0, '1.250001');
    let view = await h.ok(`${path}/reservations`, lotReserveBody); lotClaim = claimFor(view, f.lotReceipt);
    assert.equal(lotClaim.quantity, '1.250001'); assert.equal(lotClaim.remainingQuantity, '1.250001');
    serialReserveBody = await reservationBody(h, f.salesOrder, f.serialReceipt, 1, '3', units.slice(0, 3).map(row => row._id));
    view = await h.ok(`${path}/reservations`, serialReserveBody); serialClaim = claimFor(view, f.serialReceipt);
    serialReserveReceipt = view.commandReceipt;
    assert.equal(serialReserveReceipt.reservationId, serialClaim._id);
    assert.equal(serialReserveReceipt.reservationVersion, serialClaim.version);
    assert.equal(serialReserveReceipt.reservationHash, serialClaim.contentHash);
    assert.deepEqual([...serialClaim.unitIds].sort(), units.slice(0, 3).map(row => row._id).sort());
    assert.equal((await source(f.lotReceipt)).reservedQuantity, '1.250001');
    assert.equal((await source(f.serialReceipt)).reservedQuantity, '3');
    assert.equal(await h.db.collection('catalogMaterialIssues').countDocuments({ reservationId: serialClaim._id }), 0);
    assert.equal(await h.db.collection('catalogMaterialConsumptions').countDocuments({ reservationId: serialClaim._id }), 0);
    assert.equal(await h.db.collection('warehouseReservations').countDocuments({ salesOrderId: f.salesOrder._id }), 0);
    assertImmutableOpening(await immutableOpening(h, [f.lotReceipt, f.serialReceipt]), opening);
    const replay = await guardedReplay(h, () => h.ok(`${path}/reservations`, serialReserveBody), 2);
    assert.deepEqual(replay.commandReceipt, serialReserveReceipt);
    assert.equal(replay.reservations.find(row => row._id === serialClaim._id).quantity, '3');
    await denied(h, `${path}/reservations`, { ...serialReserveBody, quantity: '2' }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  await t.test('partial SERIAL dispatch survives held remainder release and shipped identities can never be freed', async () => {
    serialShipBody = await shipmentBody(h, f.salesOrder, 1, [{ reservationId: serialClaim._id, quantity: '1', unitIds: [units[0]._id] }]);
    serialShipment = await h.ok(`${path}/shipments`, serialShipBody, 201);
    assert.equal(serialShipment.schema, 'PURCHASED_SHIPMENT_V1');
    assert.deepEqual(serialShipment.sources[0].serials, [units[0].serial]);
    assert.equal(serialShipment.sources[0].sourceType, 'CATALOG_RESERVATION');
    assert.equal(await h.db.collection('warehouseMovements').countDocuments({ receiptId: f.serialReceipt._id, kind: { $ne: 'RECEIVE' } }), 0);
    let view = await read(); serialClaim = view.reservations.find(row => row._id === serialClaim._id);
    assert.deepEqual([serialClaim.status, serialClaim.shippedQuantity, serialClaim.remainingQuantity], ['PARTIALLY_SHIPPED', '1', '2']);
    const hold = await receiptHold(h, f.serialReceipt);
    try {
      await denied(h, `${path}/shipments`, await shipmentBody(h, f.salesOrder, 1, [{ reservationId: serialClaim._id, quantity: '1', unitIds: [units[1]._id] }]), { status: 409, code: 'STOCK_ENCUMBERED' });
      view = await h.ok(`${path}/reservations/${serialClaim._id}/release`, await releaseBody(h, f.salesOrder, serialClaim));
      serialClaim = view.reservations.find(row => row._id === serialClaim._id);
      assert.deepEqual([serialClaim.status, serialClaim.quantity, serialClaim.remainingQuantity, serialClaim.shippedQuantity, serialClaim.releasedQuantity], ['RELEASED', '3', '0', '1', '2']);
      assert.deepEqual(serialClaim.shippedUnitIds, [units[0]._id]);
      const stock = await source(f.serialReceipt); assert.equal(stock.onHandQuantity, '4'); assert.equal(stock.shippedQuantity, '1'); assert.equal(stock.reservedQuantity, '0'); assert.equal(stock.eligibleQuantity, '0');
      assert.equal(stock.units.find(row => row._id === units[0]._id).status, 'SHIPPED');
    } finally { serialHoldRelease = await releaseHold(h, hold); }
    await denied(h, `${path}/reservations`, await reservationBody(h, f.salesOrder, f.serialReceipt, 1, '1', [units[0]._id]), { status: 400, code: 'INVALID_UNITS' });
    const reserveReplay = await guardedReplay(h, () => h.ok(`${path}/reservations`, serialReserveBody), 2);
    assert.deepEqual(reserveReplay.commandReceipt, serialReserveReceipt);
    assert.equal(reserveReplay.reservations.find(row => row._id === serialClaim._id).status, 'RELEASED');
    assert.equal(reserveReplay.version, (await read()).version);
    const replay = await guardedReplay(h, () => h.ok(`${path}/shipments`, serialShipBody, 201), 2); assert.equal(replay._id, serialShipment._id);
    const currentPhysical = await h.db.collection('warehouseReceipts').findOne({ _id: f.serialReceipt._id });
    assert.deepEqual(currentPhysical.hold, { active: false, activeHoldIds: [], version: 2 }); assert.ok(currentPhysical.updatedAt instanceof Date);
    assert.equal(currentPhysical.updatedAt.getTime(), Date.parse(serialHoldRelease.releasedAt));
    assertImmutableOpening(await immutableOpening(h, [f.lotReceipt, f.serialReceipt]), opening, { holdReceiptIds: [f.serialReceipt._id] });
  });

  await t.test('partial LOT shipments conserve exact quantity and invoice marginal rounding never exceeds the SO', async () => {
    const shipments = [];
    for (const quantity of ['0.250001', '1']) shipments.push(await h.ok(`${path}/shipments`, await shipmentBody(h, f.salesOrder, 0, [{ reservationId: lotClaim._id, quantity }]), 201));
    let view = await h.ok(`${path}/reservations`, await reservationBody(h, f.salesOrder, f.lotReceipt, 0, '1.25'));
    const finalClaim = claimFor(view, f.lotReceipt);
    shipments.push(await h.ok(`${path}/shipments`, await shipmentBody(h, f.salesOrder, 0, [{ reservationId: finalClaim._id, quantity: '1.25' }]), 201));
    await denied(h, `${path}/reservations`, await reservationBody(h, f.salesOrder, f.lotReceipt, 0, '0.000001'), { status: 409, code: 'QUANTITY_EXCEEDED' });
    const invoices = [];
    for (let index = 0; index < shipments.length; index++) invoices.push(await h.ok('/fulfillment/invoices', invoiceBody(f.salesOrder, shipments[index], ['0.250001', '1', '1.25'][index]), 201));
    assert.deepEqual(invoices.map(row => row.total), ['0.01', '0.05', '0.07']);
    assert.equal(invoices.reduce((sum, row) => sum + BigInt(row.total.replace('.', '')), 0n), 13n);
    await denied(h, '/fulfillment/invoices', invoiceBody(f.salesOrder, shipments[0], '0.000001'), { status: 409, code: 'QUANTITY_EXCEEDED' });
    view = await read(); assert.equal(view.lines[0].shippedQuantity, '2.500001'); assert.equal(view.lines[0].invoicedQuantity, '2.500001');
    assert.equal(view.lines[0].canReserve, false); assert.equal(view.lines[0].canShip, false);
    assert.equal((await source(f.lotReceipt)).onHandQuantity, '5');
  });

  await t.test('historical SERIAL POD, invoice and settlement remain valid after real master withdrawal and current hold', async () => {
    const successor = await h.ok(`/inventory-master/items/${f.serialItem._id}/revisions`, command({ expectedVersion: f.serialItem.version, ...f.serialItem.content, description: 'Independent real withdrawal after customer dispatch' }));
    assert.equal(successor.status, 'DRAFT');
    const hold = await receiptHold(h, f.serialReceipt);
    try {
      const snapshot = await allSnapshot(h), delivery = await h.ok(`/deliveries/shipments/${serialShipment._id}`); assert.equal(delivery.remainingQuantity, '1');
      assert.deepEqual(await allSnapshot(h), snapshot);
      await denied(h, `${path}/reservations`, await reservationBody(h, f.salesOrder, f.serialReceipt, 1, '1', [units[1]._id]), { status: 409 });
      podBody = { expectedVersion: delivery.version, expectedShipmentVersion: delivery.shipmentVersion, quantity: '1', serials: [units[0].serial], deliveredAt: new Date().toISOString(), receiverName: 'Independent actual receiver', receiverReference: 'QA-PURCHASED-RECEIVER', evidenceReference: 'QA-PURCHASED-POD', evidenceNotes: 'Independent operator-recorded shipment evidence', idempotencyKey: randomUUID() };
      podResult = await h.ok(`/deliveries/shipments/${serialShipment._id}/confirmations`, podBody, 201);
      assert.equal(podResult.status, 'DELIVERED');
      invoiceCommand = invoiceBody(f.salesOrder, serialShipment, '1'); invoice = await h.ok('/fulfillment/invoices', invoiceCommand, 201); assert.equal(invoice.total, '0.05');
      paymentCommand = { accountId: f.account._id, amount: '0.05', currency: 'USD', reference: 'QA actual synthetic bank evidence', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '0.05' }], idempotencyKey: randomUUID() };
      payment = await h.ok('/fulfillment/payments', paymentCommand, 201);
      const paid = await h.db.collection('fulfillmentInvoices').findOne({ _id: invoice._id }); assert.deepEqual([paid.status, paid.paidAmount, paid.outstandingAmount], ['PAID', '0.05', '0.00']);
      assert.equal((await guardedReplay(h, () => h.ok(`/deliveries/shipments/${serialShipment._id}/confirmations`, podBody, 201), 1)).status, 'DELIVERED');
      assert.equal((await guardedReplay(h, () => h.ok('/fulfillment/invoices', invoiceCommand, 201), 1))._id, invoice._id);
      assert.equal((await guardedReplay(h, () => h.ok('/fulfillment/payments', paymentCommand, 201), 1))._id, payment._id);
      for (const [kind, sourceId] of [['shipment', serialShipment._id], ['invoice', invoice._id]]) {
        await h.ok(`/documents/sources/${kind}/${sourceId}?sourceVersion=1`);
        const document = await h.ok('/documents/issues', { kind, sourceId, sourceVersion: 1 });
        const pdf = await h.raw(`/documents/issues/${document._id}/pdf`); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
        assert.ok((await pdf.arrayBuffer()).byteLength > 100);
      }
      const beforeReconciliation = await allSnapshot(h), reconciliation = await h.ok(`/fulfillment/orders/${f.salesOrder._id}/reconciliation`);
      assert.equal(reconciliation.matches, true); assert.equal(reconciliation.shipmentCount, 4); assert.equal(reconciliation.movementCount, 4);
      assert.deepEqual(reconciliation.lines.map(line => [line.lineIndex, line.talliedQuantity, line.shipmentQuantity, line.movementQuantity, line.matches]), [[0, '2.500001', '2.500001', '2.500001', true], [1, '1', '1', '1', true], [2, '0', '0', '0', true]]);
      assert.equal(reconciliation.sources.length, 3);
      assert.ok(reconciliation.sources.every(row => row.sourceType === 'CATALOG_RESERVATION' && row.matches && row.talliedQuantity === row.movementQuantity));
      const actualMovements = await h.db.collection('catalogCustomerShipments').find({ salesOrderId: f.salesOrder._id }).toArray(); assert.equal(actualMovements.length, 4);
      for (const row of reconciliation.sources) {
        const amounts = actualMovements.filter(movement => movement.reservationId === row.sourceId).map(movement => movement.quantity);
        assert.deepEqual(amounts.sort(), row.sourceId === serialClaim._id ? ['1'] : row.sourceId === lotClaim._id ? ['0.250001', '1'] : ['1.25']);
      }
      assert.equal(await h.db.collection('warehouseMovements').countDocuments({ salesOrderId: f.salesOrder._id, kind: 'SHIP' }), 0);
      assert.deepEqual(await allSnapshot(h), beforeReconciliation, 'Typed reconciliation uses the actual customer ledger and writes no domain or authority fields');
    } finally { serialHoldRelease = await releaseHold(h, hold); }
  });

  await t.test('outbox failure rolls back shared stock, consumer evidence, key and every authority fence', async () => {
    const { salesOrder } = await makeSalesOrder(h, f.account, [{ item: f.lotItem, quantity: '1' }]), target = orderPath(salesOrder);
    const body = await reservationBody(h, salesOrder, f.lotReceipt, 0, '0.5'), before = await allSnapshot(h), original = h.runtime.db.collection;
    h.runtime.db.collection = function (name, ...args) { const collection = original.call(this, name, ...args); if (name === 'purchasedFulfillmentOutbox') collection.insertOne = async () => { throw new Error('Independent purchased fulfillment outbox rollback'); }; return collection; };
    try { const result = await h.req(`${target}/reservations`, body, h.alpha); assert.equal(result.status, 500); }
    finally { h.runtime.db.collection = original; }
    assert.deepEqual(await allSnapshot(h), before);
    const view = await h.ok(`${target}/reservations`, body); assert.equal(view.reservations.length, 1);
  });

  await t.test('dedicated action revocation precedes retained keys even with missing or relabeled customer head', async () => {
    const scope = await h.scopeOf(h.alpha), head = await h.db.collection('purchasedFulfillmentHeads').findOne({ _id: f.salesOrder._id }); assert.ok(head);
    const restore = await h.setRoles(scope, ['purchasedFulfillmentReader']);
    try {
      for (const replacement of [null, { ...head, schema: 'UNKNOWN_CUSTOMER_HEAD' }]) {
        if (replacement) await h.db.collection('purchasedFulfillmentHeads').replaceOne({ _id: head._id }, replacement); else await h.db.collection('purchasedFulfillmentHeads').deleteOne({ _id: head._id });
        try {
          await denied(h, `${path}/reservations`, serialReserveBody, { status: 403 });
          await denied(h, `${path}/shipments`, serialShipBody, { status: 403 });
        } finally { await h.db.collection('purchasedFulfillmentHeads').replaceOne({ _id: head._id }, head, { upsert: true }); }
      }
      await denied(h, `/deliveries/shipments/${serialShipment._id}/confirmations`, podBody, { status: 403 });
      await denied(h, '/fulfillment/invoices', invoiceCommand, { status: 403 });
      await denied(h, '/fulfillment/payments', paymentCommand, { status: 403 });
    } finally { await restore(); }
  });

  await t.test('self-rehashed custody corruption and stripped shared head cannot become fresh stock or replay success', async () => {
    const row = await h.db.collection('catalogMaterialReservations').findOne({ _id: serialClaim._id }); assert.ok(row);
    const forged = hashless({ ...row, sourceSnapshot: { ...row.sourceSnapshot, itemId: randomUUID() } });
    await restoreRow(h, 'catalogMaterialReservations', row, forged, async () => {
      await denied(h, path, undefined, { status: 409 });
      await denied(h, stockPath(f.serialReceipt), undefined, { status: 409 });
      await denied(h, `${path}/shipments`, serialShipBody, { status: 409 });
      await denied(h, `/deliveries/shipments/${serialShipment._id}/confirmations`, podBody, { status: 409 });
      await denied(h, '/fulfillment/invoices', invoiceCommand, { status: 409 });
      await denied(h, '/fulfillment/payments', paymentCommand, { status: 409 });
    });
    const head = await h.db.collection('catalogUseHeads').findOne({ _id: f.serialReceipt._id }); assert.ok(head);
    await h.db.collection('catalogUseHeads').deleteOne({ _id: head._id });
    try {
      await denied(h, stockPath(f.serialReceipt), undefined, { status: 409, code: 'CATALOG_STOCK_SOURCE_INVALID' });
      await denied(h, `${path}/shipments`, serialShipBody, { status: 409 });
    } finally { await h.db.collection('catalogUseHeads').insertOne(head); }
    const key = await h.db.collection('purchasedFulfillmentKeys').findOne({ key: serialReserveBody.idempotencyKey }); assert.ok(key);
    const forgedResult = { ...key.result, reservationId: randomUUID() };
    await restoreRow(h, 'purchasedFulfillmentKeys', key, { ...key, result: forgedResult, resultHash: hash(forgedResult) }, () => denied(h, `${path}/reservations`, serialReserveBody, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' }));
    const consumerHead = await h.db.collection('purchasedFulfillmentHeads').findOne({ _id: f.salesOrder._id }); assert.ok(consumerHead);
    await h.db.collection('purchasedFulfillmentHeads').deleteOne({ _id: consumerHead._id });
    try { await denied(h, path, undefined, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' }); await denied(h, `${path}/reservations`, serialReserveBody, { status: 409 }); }
    finally { await h.db.collection('purchasedFulfillmentHeads').insertOne(consumerHead); }
    const physicalShipment = await h.db.collection('fulfillmentShipments').findOne({ _id: serialShipment._id }); assert.ok(physicalShipment);
    const { schema, ...strippedShipment } = physicalShipment;
    await restoreRow(h, 'fulfillmentShipments', physicalShipment, strippedShipment, async () => {
      await denied(h, `/deliveries/shipments/${serialShipment._id}/confirmations`, podBody, { status: 409 });
      await denied(h, '/fulfillment/invoices', invoiceCommand, { status: 409 });
      await denied(h, `/documents/sources/shipment/${serialShipment._id}?sourceVersion=1`, undefined, { status: 409 });
    });
    const paidInvoice = await h.db.collection('fulfillmentInvoices').findOne({ _id: invoice._id }); assert.ok(paidInvoice);
    await restoreRow(h, 'fulfillmentInvoices', paidInvoice, { ...paidInvoice, status: 'ISSUED', paidAmount: '0.00', outstandingAmount: paidInvoice.total, allocations: [] }, async () => {
      await denied(h, '/fulfillment/invoices', invoiceCommand, { status: 409 });
      await denied(h, '/fulfillment/payments', paymentCommand, { status: 409 });
      await denied(h, `/documents/sources/invoice/${invoice._id}?sourceVersion=1`, undefined, { status: 409 });
    });
    for (const [payload, route] of [[invoiceCommand, '/fulfillment/invoices'], [paymentCommand, '/fulfillment/payments']]) {
      const durableKey = await h.db.collection('fulfillmentKeys').findOne({ key: payload.idempotencyKey }); assert.ok(durableKey);
      for (const result of [null, { ...durableKey.result, _id: randomUUID() }]) await restoreRow(h, 'fulfillmentKeys', durableKey, { ...durableKey, result, resultHash: hash(result) }, () => denied(h, route, payload, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' }));
    }
    const invoiceProof = await h.db.collection('purchasedInvoiceProofs').findOne({ invoiceId: invoice._id }); assert.ok(invoiceProof);
    const { schema: invoiceSchema, ...strippedInvoice } = paidInvoice;
    await h.db.collection('purchasedInvoiceProofs').deleteOne({ _id: invoiceProof._id });
    try {
      await restoreRow(h, 'fulfillmentInvoices', paidInvoice, strippedInvoice, async () => {
        await denied(h, `/documents/sources/invoice/${invoice._id}?sourceVersion=1`, undefined, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' });
        await denied(h, '/fulfillment/invoices', invoiceCommand, { status: 409 });
        await denied(h, '/fulfillment/payments', paymentCommand, { status: 409 });
      });
    } finally { await h.db.collection('purchasedInvoiceProofs').insertOne(invoiceProof); }
    const billingTallies = await h.db.collection('fulfillmentTallies').find({ $or: [{ kind: 'SHIPMENT_INVOICED', subjectId: serialShipment._id, lineIndex: 0 }, { kind: 'SO_LINE_INVOICED', subjectId: f.salesOrder._id, lineIndex: 1 }] }).toArray();
    assert.equal(billingTallies.length, 2); assert.ok(billingTallies.every(row => row.quantity === '1'));
    for (const kinds of [['SHIPMENT_INVOICED'], ['SO_LINE_INVOICED'], ['SHIPMENT_INVOICED', 'SO_LINE_INVOICED']]) {
      const beforeFault = await allSnapshot(h), selected = billingTallies.filter(row => kinds.includes(row.kind));
      try {
        for (const row of selected) await h.db.collection('fulfillmentTallies').updateOne({ _id: row._id }, { $set: { quantity: '0' } });
        await denied(h, '/fulfillment/invoices', invoiceBody(f.salesOrder, serialShipment, '1'), { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' });
        await denied(h, '/fulfillment/invoices', invoiceCommand, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' });
        await denied(h, path, undefined, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' });
        await denied(h, `/fulfillment/orders/${f.salesOrder._id}/balances`, undefined, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' });
        await denied(h, `/fulfillment/orders/${f.salesOrder._id}/entitlement`, undefined, { status: 409, code: 'PURCHASED_FULFILLMENT_SOURCE_INVALID' });
      } finally { for (const row of selected) await h.db.collection('fulfillmentTallies').replaceOne({ _id: row._id }, row); }
      assert.deepEqual(await allSnapshot(h), beforeFault, 'Restored summary faults must not leave a duplicate invoice, key, money effect or authority fence');
    }
    const currentPhysical = await h.db.collection('warehouseReceipts').findOne({ _id: f.serialReceipt._id });
    assert.deepEqual(currentPhysical.hold, { active: false, activeHoldIds: [], version: 4 }); assert.ok(currentPhysical.updatedAt instanceof Date);
    assert.equal(currentPhysical.updatedAt.getTime(), Date.parse(serialHoldRelease.releasedAt));
    assertImmutableOpening(await immutableOpening(h, [f.lotReceipt, f.serialReceipt]), opening, { holdReceiptIds: [f.serialReceipt._id] });
  });

  await t.test('authorized production and customer requests competing for one actual SERIAL have one durable winner', async () => {
    const fixture = await makePurchasedFixture(h, { serialCount: 3, rejectedSerialCount: 1, serialDemand: '1' });
    const stock = await source(fixture.serialReceipt), unit = stock.units.find(row => row.eligible), execution = await makeProductionConsumer(h, fixture);
    const production = await productionReserveBody(h, execution, fixture.serialReceipt, fixture.serialItem, '1', [unit.serial]);
    const customer = await reservationBody(h, fixture.salesOrder, fixture.serialReceipt, 1, '1', [unit._id]);
    const results = await Promise.all([h.req(`/internal-execution/orders/${execution._id}/reservations`, production, h.alpha), h.req(`${orderPath(fixture.salesOrder)}/reservations`, customer, h.alpha)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const rows = await h.db.collection('catalogMaterialReservations').find({ receiptId: fixture.serialReceipt._id }).toArray();
    assert.equal(rows.length, 1); assert.equal(rows[0].quantity, '1'); assert.deepEqual(rows[0].serials, [unit.serial]);
    const current = await source(fixture.serialReceipt); assert.equal(current.reservedQuantity, '1'); assert.equal(current.availableQuantity, '1');
    const loserKey = results[0].status === 409 ? production.idempotencyKey : customer.idempotencyKey;
    assert.equal(await h.db.collection('internalExecutionKeys').countDocuments({ key: loserKey }), 0);
    assert.equal(await h.db.collection('purchasedFulfillmentKeys').countDocuments({ key: loserKey }), 0);
  });

  await t.test('independent receipts share one SO demand cap instead of authorizing their own full line allowance', async () => {
    const second = await makeAdditionalLot(h, f), { salesOrder } = await makeSalesOrder(h, f.account, [{ item: f.lotItem, quantity: '0.6' }]), target = orderPath(salesOrder);
    await h.ok(`${target}/reservations`, await reservationBody(h, salesOrder, f.lotReceipt, 0, '0.4'));
    await denied(h, `${target}/reservations`, await reservationBody(h, salesOrder, second, 0, '0.4'), { status: 409, code: 'QUANTITY_EXCEEDED' });
    const bodies = await Promise.all([f.lotReceipt, second].map(receipt => reservationBody(h, salesOrder, receipt, 0, '0.2')));
    const results = await Promise.all(bodies.map(body => h.req(`${target}/reservations`, body, h.alpha)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const view = await h.ok(target); assert.equal(view.lines[0].reservedQuantity, '0.6'); assert.equal(view.lines[0].remainingReserveQuantity, '0');
    const rows = await h.db.collection('catalogMaterialReservations').find({ salesOrderId: salesOrder._id }).toArray(); assert.equal(rows.length, 2);
  });

  await t.test('distinct authentic production/customer releases hit the same source CAS with both transactions uncommitted', async () => {
    const fixture = await makePurchasedFixture(h, { serialCount: 4, rejectedSerialCount: 1, serialDemand: '1' });
    const stock = await source(fixture.serialReceipt), selected = stock.units.filter(row => row.eligible), execution = await makeProductionConsumer(h, fixture);
    await h.ok(`/internal-execution/orders/${execution._id}/reservations`, await productionReserveBody(h, execution, fixture.serialReceipt, fixture.serialItem, '1', [selected[0].serial]));
    await h.ok(`${orderPath(fixture.salesOrder)}/reservations`, await reservationBody(h, fixture.salesOrder, fixture.serialReceipt, 1, '1', [selected[1]._id]));
    const rows = await h.db.collection('catalogMaterialReservations').find({ receiptId: fixture.serialReceipt._id }).toArray(); assert.equal(rows.length, 2);
    const proof = await existingSourceCAS(h, fixture.serialReceipt._id, rows.find(row => row.executionId === execution._id), rows.find(row => row.salesOrderId === fixture.salesOrder._id));
    console.log(JSON.stringify({ independentDomainCAS: proof }));
  });

  await t.test('a virgin receipt cannot gain two distinct custody authorities in overlapping actual writer transactions', async () => {
    const fixture = await makePurchasedFixture(h, { serialCount: 3, rejectedSerialCount: 1, serialDemand: '1' }), unit = (await source(fixture.serialReceipt)).units.find(row => row.eligible);
    const { salesOrder } = await makeSalesOrder(h, fixture.account, [{ item: fixture.serialItem, quantity: '1' }]);
    const proof = await absentSourceCAS(h, fixture.serialReceipt._id, fixture.salesOrder, salesOrder, unit._id);
    console.log(JSON.stringify({ independentDomainCAS: proof }));
  });

  await t.test('source location and raw bin withdrawal block fresh use while unshipped customer release remains recoverable', async () => {
    const { salesOrder } = await makeSalesOrder(h, f.account, [{ item: f.lotItem, quantity: '1' }]), target = orderPath(salesOrder);
    let view = await h.ok(`${target}/reservations`, await reservationBody(h, salesOrder, f.lotReceipt, 0, '0.2')), claim = claimFor(view, f.lotReceipt);
    const bin = await h.db.collection('warehouseBins').findOne({ _id: f.bin._id }); assert.ok(bin);
    await restoreRow(h, 'warehouseBins', bin, { ...bin, active: false }, async () => {
      assert.ok((await source(f.lotReceipt)).blockers.includes('LOCATION_CHANGED'));
      await denied(h, `${target}/shipments`, await shipmentBody(h, salesOrder, 0, [{ reservationId: claim._id, quantity: '0.1' }]), { status: 409, code: 'CATALOG_DEPENDENCY_CHANGED' });
      view = await h.ok(`${target}/reservations/${claim._id}/release`, await releaseBody(h, salesOrder, claim));
      assert.equal(view.reservations.find(row => row._id === claim._id).releasedQuantity, '0.2');
    });
    view = await h.ok(`${target}/reservations`, await reservationBody(h, salesOrder, f.lotReceipt, 0, '0.2')); claim = claimFor(view, f.lotReceipt);
    const inactive = await h.ok(`/inventory-master/locations/${f.location._id}/deactivate`, command({ expectedVersion: f.location.version })); assert.equal(inactive.status, 'INACTIVE');
    const snapshot = await allSnapshot(h); assert.ok((await source(f.lotReceipt)).blockers.includes('LOCATION_CHANGED')); assert.deepEqual(await allSnapshot(h), snapshot);
    await denied(h, `${target}/shipments`, await shipmentBody(h, salesOrder, 0, [{ reservationId: claim._id, quantity: '0.1' }]), { status: 409, code: 'CATALOG_DEPENDENCY_CHANGED' });
    await denied(h, `${target}/reservations`, await reservationBody(h, salesOrder, f.lotReceipt, 0, '0.1'), { status: 409, code: 'CATALOG_DEPENDENCY_CHANGED' });
    view = await h.ok(`${target}/reservations/${claim._id}/release`, await releaseBody(h, salesOrder, claim));
    assert.equal(view.reservations.find(row => row._id === claim._id).status, 'RELEASED');
  });
});
