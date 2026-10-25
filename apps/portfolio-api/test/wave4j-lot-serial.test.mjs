import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

test('Wave4j traced materials and ten serialized units remain conserved through 6/4 shipments', async t => {
  const h = await startOwned(t), key = () => randomUUID();
  const command = values => ({ expectedVersion: 1, idempotencyKey: key(), ...values });
  const post = (path, body, cookie = h.alpha) => h.req(path, body, cookie);
  const collections = ['warehouseReceipts', 'warehouseReservations', 'warehouseMovements', 'warehouseReceived', 'warehouseSerials', 'warehouseKeys', 'warehouseAudit', 'warehouseOutbox', 'manufacturingWorkOrders', 'manufacturingAllocated', 'manufacturingOutputUnits', 'manufacturingMovements', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox', 'fulfillmentShipments', 'fulfillmentTallies', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox'];
  const snapshot = () => Promise.all(collections.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  const ok = h.ok;
  const account = await ok('/crm/accounts', { name: 'Synthetic traced manufacturing customer' }, 201);
  async function salesOrder(quantity, taxPolicy = 'NO_TAX') {
    const quote = await ok('/commercial/quotes', { accountId: account._id, taxPolicy, roundingPolicy: 'LINE_HALF_UP', expiresAt: '2027-01-01T00:00:00.000Z', lines: [{ description: 'Synthetic serial output', quantity, uom: 'EA', unitPrice: '12250.00', currency: 'USD' }] }, 201);
    await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
    await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
    return ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  }
  const so = await salesOrder('10', 'FIXTURE_VAT_11_V1');
  const vendor = await ok('/procurement/vendors', { name: 'Synthetic heat supplier' }, 201);
  const pr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic steel material', quantity: '30', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receive = command({ expectedVersion: 2, purchaseOrderId: po._id, vendorId: vendor._id, lineIndex: 0, quantity: '30', uom: 'KG', lotNumber: 'LOT-2026/10', heatNumber: 'HEAT.7' });
  await t.test('trace is an optional bounded pair and caller-owned snapshots are refused without side effects', async () => {
    const before = await snapshot();
    for (const patch of [{ heatNumber: undefined }, { lotNumber: '' }, { lotNumber: 'invalid space' }, { heatNumber: 7 }, { materialTrace: { lotNumber: 'override' } }]) assert.equal((await post('/warehouse/receipts', { ...receive, ...patch })).status, 400);
    assert.deepEqual(await snapshot(), before);
  });
  const receipt = await ok('/warehouse/receipts', receive, 201);
  const trace = { receiptId: receipt._id, lotNumber: receive.lotNumber, heatNumber: receive.heatNumber };
  await ok(`/warehouse/receipts/${receipt._id}/release`, command({ reason: 'Synthetic inspection record' }));
  await ok(`/warehouse/receipts/${receipt._id}/putaway`, command({ expectedVersion: 2, location: 'TRACE-BIN' }));
  const plan = command({ salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, quantities: ['6', '4'], uom: 'EA', serialized: true });
  await t.test('serialized planning rejects fractions, oversized lists and nonboolean opt-in', async () => {
    const before = await snapshot();
    for (const patch of [{ serialized: 'true' }, { quantities: ['0.5'] }, { quantities: ['1001'] }]) assert.equal((await post('/manufacturing/work-orders', { ...plan, ...patch, idempotencyKey: key() })).status, 400);
    assert.deepEqual(await snapshot(), before);
  });
  const planned = await ok('/manufacturing/work-orders', plan, 201), wos = planned.workOrders;
  const path = wo => `/manufacturing/work-orders/${wo._id}`;
  const routing = { operations: [{ code: 'CUT', instruction: 'Synthetic cut entry' }, { code: 'FINISH', instruction: 'Synthetic finish entry' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '2', uom: 'KG' }] };
  const record = (wo, operationIndex, outputSerials) => command({ expectedVersion: operationIndex + 2, operationIndex, inputQuantity: wo.quantity, goodQuantity: wo.quantity, scrapQuantity: '0', uom: 'EA', evidence: 'Synthetic operator entry, no machine telemetry', ...(outputSerials === undefined ? {} : { outputSerials }) });
  const serialGroups = [Array.from({ length: 6 }, (_, i) => `W4J_OUT_${i + 1}`), Array.from({ length: 4 }, (_, i) => `W4J_OUT_${i + 7}`)];
  for (const wo of wos) await ok(`${path(wo)}/release`, command(routing));
  await t.test('receipt trace freezes into routing and material reservation and consumption events', async () => {
    for (const wo of wos) {
      const stored = await ok(path(wo));
      assert.equal(stored.serialized, true); assert.deepEqual(stored.routing.materials[0].materialTrace, trace);
      await ok(`${path(wo)}/record`, record(wo, 0));
      const moves = await h.db.collection('manufacturingMovements').find({ workOrderId: wo._id, kind: { $in: ['MATERIAL_RESERVED', 'MATERIAL_CONSUMED'] } }).toArray();
      assert.deepEqual(moves.map(m => m.materialTrace), [trace, trace]);
    }
    const stored = await ok(`/warehouse/receipts/${receipt._id}`);
    assert.equal(stored.availableQuantity, '10'); assert.equal(stored.manufacturingConsumedQuantity, '20'); assert.equal(stored.manufacturingReservedQuantity, '0');
    assert.equal((await ok(`/warehouse/receipts/${receipt._id}/reconciliation`)).matches, true);
  });
  await t.test('final operation requires exact unique unit identities and rollback retains no orphan registry claims', async () => {
    const before = await snapshot();
    for (const patch of [{ outputSerials: undefined }, { outputSerials: ['ONLY_ONE'] }, { outputSerials: Array(6).fill('DUPLICATE') }, { outputSerials: [null] }]) assert.ok([400, 409].includes((await post(`${path(wos[0])}/record`, { ...record(wos[0], 1), ...patch })).status));
    assert.deepEqual(await snapshot(), before);
    await h.db.command({ collMod: 'manufacturingOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post(`${path(wos[0])}/record`, record(wos[0], 1, serialGroups[0]))).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: 'manufacturingOutbox', validator: {} }); }
    const body = record(wos[0], 1, serialGroups[0]);
    const responses = await Promise.all([1, 2].map(() => post(`${path(wos[0])}/record`, body)));
    assert.deepEqual(responses.map(r => r.status), [200, 200]); assert.deepEqual(responses[0].data, responses[1].data);
    assert.deepEqual(responses[0].data.output.serials, serialGroups[0]); assert.deepEqual(responses[0].data.output.materialTrace, [trace]);
    assert.equal((await post(`${path(wos[0])}/record`, { ...body, outputSerials: [...serialGroups[0]].reverse() })).error.code, 'IDEMPOTENCY_CONFLICT');
    const after = await snapshot();
    assert.equal((await post(`${path(wos[1])}/record`, record(wos[1], 1, [serialGroups[0][0], ...serialGroups[1].slice(1)]))).error.code, 'SERIAL_CONFLICT');
    assert.deepEqual(await snapshot(), after);
    await ok(`${path(wos[1])}/record`, record(wos[1], 1, serialGroups[1]));
    const units = await h.db.collection('manufacturingOutputUnits').find().toArray();
    assert.equal(units.length, 10); assert.equal(new Set(units.map(u => u.serial)).size, 10); assert.ok(units.every(u => u.status === 'QUARANTINED'));
    assert.equal(await h.db.collection('warehouseSerials').countDocuments({ sourceType: 'MANUFACTURING_OUTPUT' }), 10);
  });
  const qcBody = (wo, acceptedSerials, rejectedSerials = []) => command({ expectedVersion: 4, acceptedQuantity: String(acceptedSerials.length), rejectedQuantity: String(rejectedSerials.length), uom: 'EA', evidence: 'Synthetic inspector record', acceptedSerials, rejectedSerials });
  await t.test('QC requires a complete disjoint identity partition and scoped reads conceal other tenants', async () => {
    const before = await snapshot();
    for (const patch of [{ acceptedSerials: undefined }, { acceptedSerials: ['UNKNOWN', ...serialGroups[0].slice(1)] }, { acceptedSerials: serialGroups[0].slice(1), rejectedSerials: [serialGroups[0][1]], acceptedQuantity: '5', rejectedQuantity: '1' }]) assert.ok([400, 409].includes((await post(`${path(wos[0])}/qc`, { ...qcBody(wos[0], serialGroups[0]), ...patch })).status));
    assert.equal((await post(`${path(wos[0])}/output-units`, undefined, h.beta)).status, 404);
    assert.deepEqual(await snapshot(), before);
    for (let i = 0; i < wos.length; i++) {
      const qc = await ok(`${path(wos[i])}/qc`, qcBody(wos[i], serialGroups[i]));
      assert.deepEqual(qc.qc.acceptedSerials, serialGroups[i]);
      const units = await ok(`${path(wos[i])}/output-units`);
      assert.equal(units.length, serialGroups[i].length); assert.ok(units.every(u => u.status === 'ACCEPTED' && u.workOrderId === wos[i]._id));
    }
  });
  const shipBody = (wo, serials) => ({ salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'EA', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: wo.quantity, ...(serials === undefined ? {} : { serials }) }], reference: 'Synthetic dispatch record', idempotencyKey: key() });
  let shipments;
  await t.test('shipment selections are exact, transactional and unavailable after dispatch; legacy monetary 6/4 entitlement remains', async () => {
    const before = await snapshot();
    for (const body of [shipBody(wos[0]), shipBody(wos[0], serialGroups[1]), shipBody(wos[0], [...serialGroups[0].slice(1), serialGroups[1][0]])]) assert.ok([400, 409].includes((await post('/fulfillment/shipments', body)).status));
    assert.deepEqual(await snapshot(), before);
    await h.db.createCollection('fulfillmentOutbox');
    await h.db.command({ collMod: 'fulfillmentOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post('/fulfillment/shipments', shipBody(wos[0], serialGroups[0]))).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: 'fulfillmentOutbox', validator: {} }); }
    const firstBody = shipBody(wos[0], serialGroups[0]);
    const first = await ok('/fulfillment/shipments', firstBody, 201);
    assert.deepEqual((await post('/fulfillment/shipments', firstBody)).data, first);
    assert.equal((await post('/fulfillment/shipments', shipBody(wos[0], serialGroups[0]))).error.code, 'SERIAL_STATE_CONFLICT');
    const second = await ok('/fulfillment/shipments', shipBody(wos[1], serialGroups[1]), 201); shipments = [first, second];
    for (let i = 0; i < shipments.length; i++) { assert.deepEqual(shipments[i].sources[0].serials, serialGroups[i]); assert.deepEqual(shipments[i].sources[0].materialTrace, [trace]); }
    assert.equal(await h.db.collection('manufacturingOutputUnits').countDocuments({ status: 'SHIPPED' }), 10);
    assert.equal((await ok(`/fulfillment/orders/${so._id}/reconciliation`)).matches, true);
    const invoices = [];
    for (const shipment of shipments) invoices.push(await ok('/fulfillment/invoices', { salesOrderId: so._id, expectedVersion: so.version, lines: [{ shipmentId: shipment._id, quantity: shipment.quantity }], idempotencyKey: key() }, 201));
    assert.deepEqual(invoices.map(i => i.total), ['81585.00', '54390.00']);
    await ok('/fulfillment/payments', { accountId: account._id, amount: '135975.00', currency: 'USD', reference: 'Synthetic settlement', allocations: invoices.map(i => ({ invoiceId: i._id, expectedVersion: i.version, amount: i.total })), idempotencyKey: key() }, 201);
    assert.ok((await h.db.collection('fulfillmentInvoices').find({ salesOrderId: so._id }).toArray()).every(i => i.outstandingAmount === '0.00'));
  });
  await t.test('revoked fresh and same-key output commands cannot bypass transaction authorization', async () => {
    const before = await snapshot(), restore = await h.setRoles(h.seeded[0], ['manufacturingRead']);
    try {
      assert.equal((await post('/manufacturing/work-orders', plan)).status, 403);
      assert.equal((await post('/manufacturing/work-orders', { ...plan, idempotencyKey: key() })).status, 403);
      assert.equal((await ok(`${path(wos[0])}/output-units`)).length, 6);
    } finally { await restore(); }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('zero output, rejected units and racing serial claims stay fail-closed across work orders', async () => {
    const next = await salesOrder('4');
    const extra = (await ok('/manufacturing/work-orders', command({ salesOrderId: next._id, expectedVersion: next.version, lineIndex: 0, quantities: ['1', '1', '1', '1'], uom: 'EA', serialized: true }), 201)).workOrders;
    for (const wo of extra) await ok(`${path(wo)}/release`, command(routing));
    await ok(`${path(extra[0])}/record`, { ...record(extra[0], 0), goodQuantity: '0', scrapQuantity: '1' });
    const empty = await ok(`${path(extra[0])}/record`, { ...record(extra[0], 1, []), inputQuantity: '0', goodQuantity: '0' });
    assert.deepEqual(empty.output.serials, []);
    await ok(`${path(extra[0])}/qc`, qcBody(extra[0], []));
    assert.deepEqual(await ok(`${path(extra[0])}/output-units`), []);
    for (const wo of extra.slice(1)) await ok(`${path(wo)}/record`, record(wo, 0));
    await ok(`${path(extra[1])}/record`, record(extra[1], 1, ['W4J_REJECT']));
    await ok(`${path(extra[1])}/qc`, qcBody(extra[1], [], ['W4J_REJECT']));
    const rejectedShip = { ...shipBody(extra[1], ['W4J_REJECT']), salesOrderId: next._id, expectedVersion: next.version };
    const before = await snapshot();
    assert.equal((await post('/fulfillment/shipments', rejectedShip)).error.code, 'SERIAL_SOURCE_CONFLICT');
    assert.deepEqual(await snapshot(), before);
    const races = await Promise.all(extra.slice(2).map(wo => post(`${path(wo)}/record`, record(wo, 1, ['W4J_RACE']))));
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409], JSON.stringify(races));
    const losing = extra[races[0].status === 409 ? 2 : 3];
    assert.equal(await h.db.collection('manufacturingOutputUnits').countDocuments({ serial: 'W4J_RACE' }), 1);
    const incomingPr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic incoming serialized part', quantity: '2', uom: 'EA', unitPrice: '1.00', currency: 'USD' }] }, 201);
    await ok(`/procurement/requests/${incomingPr._id}/approve`, { expectedVersion: 1 });
    const incomingPo = await ok(`/procurement/requests/${incomingPr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
    await ok(`/procurement/orders/${incomingPo._id}/issue`, { expectedVersion: 1 });
    const incomingBody = command({ expectedVersion: 2, purchaseOrderId: incomingPo._id, vendorId: vendor._id, lineIndex: 0, quantity: '1', uom: 'EA', serials: ['W4J_INCOMING'] });
    await ok('/warehouse/receipts', incomingBody, 201);
    const beforeCollision = await snapshot();
    assert.equal((await post(`${path(losing)}/record`, record(losing, 1, ['W4J_INCOMING']))).error.code, 'SERIAL_CONFLICT');
    assert.equal((await post('/warehouse/receipts', { ...incomingBody, serials: ['W4J_OUT_1'], idempotencyKey: key() })).error.code, 'SERIAL_CONFLICT');
    assert.deepEqual(await snapshot(), beforeCollision);
    await ok(`${path(losing)}/record`, record(losing, 1, ['W4J_RACE_RECOVERED']));
    assert.equal((await ok(`/warehouse/receipts/${receipt._id}/reconciliation`)).matches, true);
  });
});
