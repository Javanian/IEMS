import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { domainSnapshot, afterAuthorization, withReplacement } from '../../wave4map/qa/mapping-fixture.mjs';

const key = () => randomUUID(), reason = 'Independent supplemental mixed stock execution evidence';
const command = version => ({ expectedVersion: version, reason, idempotencyKey: key() });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const rehash = row => ({ ...row, contentHash: hash(Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'contentHash'))) });

test('independent supplemental typed stock, mixed consumption and company output authority', async t => {
  const h = await startOwned(t), stockRoot = '/catalog-stock/receipts', execRoot = '/internal-execution/orders';
  const beforeCustomer = await Promise.all(['accounts', 'salesOrders', 'manufacturingWorkOrders', 'manufacturingMovements', 'warehouseReservations', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments'].map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray()));
  async function item(code, kind, trackingPolicy, uom) { let row = await h.ok('/inventory-master/items', { ...command(1), code, description: `Synthetic independent ${code}`, schema: 'INVENTORY_ITEM_V2', kind, trackingPolicy, uom }, 201); return h.ok(`/inventory-master/items/${row._id}/approve`, { ...command(row.version), revision: row.currentRevision }); }
  const lotItem = await item('QA-EXEC-LOT', 'PURCHASED', 'LOT', 'KG'), serialItem = await item('QA-EXEC-SERIAL', 'PURCHASED', 'SERIAL', 'UN'), outputItem = await item('QA-EXEC-OUTPUT', 'MANUFACTURED', 'SERIAL', 'UN');
  const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, code: 'QA-EXEC-BIN', idempotencyKey: key() }, 201);
  let location = await h.ok('/inventory-master/locations', { ...command(1), code: 'QA-EXEC-LOCATION', binId: bin._id }, 201); location = await h.ok(`/inventory-master/locations/${location._id}/qualify`, command(location.version));
  const vendor = await h.ok('/procurement/vendors', { name: 'Synthetic independent mixed input supplier' }, 201);
  let request = await h.ok('/catalog-procurement/requests', { ...command(1), vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ itemId: lotItem._id, itemVersion: lotItem.version, itemRevision: lotItem.currentRevision, quantity: '1.5', unitPrice: '1.00', currency: 'USD' }, { itemId: serialItem._id, itemVersion: serialItem.version, itemRevision: serialItem.currentRevision, quantity: '6', unitPrice: '1.00', currency: 'USD' }] }, 201);
  request = await h.ok(`/catalog-procurement/requests/${request._id}/approve`, { ...command(request.version), revision: request.currentRevision });
  let po = await h.ok(`/catalog-procurement/requests/${request._id}/convert`, command(request.version)); po = await h.ok(`/catalog-procurement/orders/${po._id}/issue`, command(po.version));
  const incoming = Array.from({ length: 6 }, (_, i) => `QA_EXEC_INPUT_${i}`), receipts = [];
  async function receive(line, quantity, serials, suffix) {
    const body = { ...command(po.version), purchaseOrderId: po._id, vendorId: vendor._id, lineId: po.content.lines[line].lineId, quantity, lotNumber: `QA_EXEC_LOT_${suffix}`, heatNumber: `QA_EXEC_HEAT_${suffix}`, ...(serials ? { serials } : {}) };
    const receipt = await h.ok('/catalog-procurement/receipts', body, 201), path = `/catalog-disposition/receipts/${receipt._id}`;
    let disposition = await h.ok(path);
    disposition = await h.ok(`${path}/inspections`, { ...command(disposition.version), expectedReceiptVersion: disposition.receiptVersion, acceptedQuantity: quantity, rejectedQuantity: '0', evidence: 'Synthetic actual received material inspection', ...(serials ? { acceptedSerials: serials, rejectedSerials: [] } : {}) });
    disposition = await h.ok(`${path}/approve`, { ...command(disposition.version), expectedReceiptVersion: disposition.receiptVersion, revision: disposition.currentRevision });
    await h.ok(`${path}/putaway`, { ...command(disposition.version), expectedReceiptVersion: disposition.receiptVersion, locationId: location._id, expectedLocationVersion: location.version }); receipts.push(receipt); return receipt;
  }
  const lotA = await receive(0, '1', null, 'A'), lotB = await receive(0, '0.5', null, 'B'), serial = await receive(1, '6', incoming, 'SERIAL');
  const physicalProof = async () => Promise.all(['warehouseReceiptOrigins', 'warehouseMovements', 'warehouseSerials', 'catalogInspections', 'catalogStockBalances', 'catalogStockUnits', 'catalogStockMovements'].map(name => h.db.collection(name).find({ ...(name === 'warehouseSerials' ? { receiptId: { $in: receipts.map(row => row._id) } } : {}) }).sort({ _id: 1 }).toArray()));
  const openingProof = await physicalProof();
  async function execution() {
    let plan = await h.ok('/internal-production/orders', { ...command(1), itemId: outputItem._id, itemRevision: outputItem.currentRevision, expectedItemVersion: outputItem.version, locationId: location._id, expectedLocationVersion: location.version, quantity: '3' }, 201);
    plan = await h.ok(`/internal-production/orders/${plan._id}/engineering/revisions`, { ...command(plan.version), operations: [{ code: 'MIX', instruction: 'Synthetic actual first operation' }, { code: 'FINISH', instruction: 'Synthetic actual final operation' }], materials: [{ itemId: lotItem._id, itemRevision: lotItem.currentRevision, expectedItemVersion: lotItem.version, quantityPerUnit: '0.5', uom: 'KG' }, { itemId: serialItem._id, itemRevision: serialItem.currentRevision, expectedItemVersion: serialItem.version, quantityPerUnit: '2', uom: 'UN' }] });
    plan = await h.ok(`/internal-production/orders/${plan._id}/engineering/approve`, { ...command(plan.version), revision: plan.engineering.currentRevision });
    return h.ok(execRoot, { ...command(1), internalOrderId: plan._id, expectedOrderVersion: plan.version, engineeringRevision: plan.engineering.currentRevision }, 201);
  }
  let main = await execution(), competitor = await execution(), acknowledgedPutaway;
  const current = executionRow => h.ok(`${execRoot}/${executionRow._id}`), stock = receipt => h.ok(`${stockRoot}/${receipt._id}`);
  const reserveBody = async (executionRow, receipt, quantity, serials) => { const source = await stock(receipt), itemId = receipt.catalogSource.itemId; return { ...command(executionRow.version), materialLineId: executionRow.materials.find(row => row.itemId === itemId).lineId, receiptId: receipt._id, expectedReceiptVersion: source.receiptVersion, expectedStockVersion: source.version, quantity, ...(serials ? { serials } : {}) }; };
  async function deny(route, body, expectedCode, status = 409) { const before = await domainSnapshot(h), response = await h.req(route, body, h.alpha); assert.equal(response.status, status, JSON.stringify(response)); if (expectedCode) assert.equal(response.error.code, expectedCode); assert.deepEqual(await domainSnapshot(h), before); }

  await t.test('stock projections expose actual eligible typed supply without customer or legacy stock authority', async () => {
    const source = await stock(serial); assert.equal(source.onHandQuantity, '6'); assert.equal(source.availableQuantity, '6'); assert.equal(source.consumedQuantity, '0'); assert.equal(source.canAllocate, true);
    assert.deepEqual(source.units.filter(row => row.eligible).map(row => row.serial).sort(), incoming);
    const list = await h.req(`${stockRoot}?itemId=${serialItem._id}&itemRevision=1&limit=25`, undefined, h.alpha); assert.equal(list.status, 200); assert.deepEqual(list.data.map(row => row.receiptId), [serial._id]);
    await deny(`/warehouse/receipts/${serial._id}/release`, { expectedVersion: source.receiptVersion, reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
  });

  await t.test('a competing committed claim invalidates captured source versions and abandonment restores exactly available stock', async () => {
    const body = await reserveBody(main, serial, '6', incoming); let afterCompetitor;
    const response = await afterAuthorization(h, 'internal.execution.reserve', async () => { competitor = await h.ok(`${execRoot}/${competitor._id}/reservations`, await reserveBody(competitor, serial, '6', incoming)); afterCompetitor = await domainSnapshot(h); }, () => h.req(`${execRoot}/${main._id}/reservations`, body, h.alpha));
    assert.equal(response.status, 409); assert.equal(response.error.code, 'VERSION_CONFLICT'); assert.deepEqual(await domainSnapshot(h), afterCompetitor);
    let source = await stock(serial); assert.equal(source.reservedQuantity, '6'); assert.equal(source.onHandQuantity, '6'); assert.equal(source.availableQuantity, '0');
    competitor = await h.ok(`${execRoot}/${competitor._id}/reservations/${competitor.reservations[0]._id}/release`, { ...command(competitor.version), expectedReceiptVersion: source.receiptVersion, expectedStockVersion: source.version }); source = await stock(serial); assert.equal(source.availableQuantity, '6'); assert.equal(source.reservedQuantity, '0');
    main = await h.ok(`${execRoot}/${main._id}/reservations`, await reserveBody(main, serial, '6', incoming));
    for (const [receipt, quantity] of [[lotA, '1'], [lotB, '0.5']]) main = await h.ok(`${execRoot}/${main._id}/reservations`, await reserveBody(main, receipt, quantity));
    assert.equal(main.canRelease, true);
  });

  await t.test('real source hold prevents release and current read retains reserved physical identity', async () => {
    const source = await stock(serial), hold = await h.send(`/warehouse/receipts/${serial._id}/holds`, { body: { expectedReceiptVersion: source.receiptVersion, reasonCode: 'QC_SUSPECT', reasonNote: reason }, headers: { 'Idempotency-Key': key() } }); assert.equal(hold.status, 201, JSON.stringify(hold));
    try { await deny(`${execRoot}/${main._id}/release`, command(main.version), 'STOCK_ENCUMBERED'); const blocked = await stock(serial); assert.equal(blocked.reservedQuantity, '6'); assert.equal(blocked.onHandQuantity, '6'); assert.equal(blocked.eligibleQuantity, '0'); }
    finally { const released = await h.send(`/warehouse/holds/${hold.data.hold.id}/release`, { body: { expectedVersion: hold.data.hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: reason }, headers: { 'Idempotency-Key': key() } }); assert.equal(released.status, 200, JSON.stringify(released)); }
    main = await h.ok(`${execRoot}/${main._id}/release`, command(main.version)); main = await h.ok(`${execRoot}/${main._id}/issue`, command(main.version));
    const issued = await stock(serial); assert.equal(issued.issuedQuantity, '6'); assert.equal(issued.reservedQuantity, '0'); assert.equal(issued.consumedQuantity, '0'); assert.equal(issued.onHandQuantity, '6');
  });

  await t.test('first-consume outbox failure rolls back every source, ledger and key; acknowledged retry consumes once', async () => {
    const body = { ...command(main.version), operationIndex: 0, inputQuantity: '3', goodQuantity: '3', scrapQuantity: '0', laborMinutes: '10.5', machineMinutes: '2.25', evidence: 'Synthetic actual first operation evidence' }, before = await domainSnapshot(h);
    await h.db.command({ collMod: 'internalExecutionOutbox', validator: { $jsonSchema: { required: ['QA_REQUIRED_FAILURE'] } }, validationLevel: 'strict', validationAction: 'error' });
    try { const response = await h.req(`${execRoot}/${main._id}/records`, body, h.alpha); assert.equal(response.status, 500); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.command({ collMod: 'internalExecutionOutbox', validator: {} }); }
    main = await h.ok(`${execRoot}/${main._id}/records`, body); const consumed = await domainSnapshot(h); assert.deepEqual(await h.ok(`${execRoot}/${main._id}/records`, body), main); assert.deepEqual(await domainSnapshot(h), consumed);
    assert.equal(await h.db.collection('catalogMaterialConsumptions').countDocuments({ executionId: main._id }), 3);
    for (const receipt of receipts) { const source = await stock(receipt); assert.equal(source.onHandQuantity, '0'); assert.equal(source.availableQuantity, '0'); assert.equal(source.issuedQuantity, '0'); assert.equal(source.consumedQuantity, receipt.quantity); }
  });

  await t.test('global serial collisions leave no partial output and final operation never consumes raw inputs twice', async () => {
    const common = { ...command(main.version), operationIndex: 1, inputQuantity: '3', goodQuantity: '2', scrapQuantity: '1', laborMinutes: '1.25', machineMinutes: '0.5', evidence: 'Synthetic actual final operation with one lost parent' };
    await deny(`${execRoot}/${main._id}/records`, { ...common, outputSerials: ['QA_EXEC_ROLLBACK_OUTPUT', incoming[0]] }, 'SERIAL_CONFLICT');
    assert.equal(await h.db.collection('warehouseSerials').countDocuments({ serial: 'QA_EXEC_ROLLBACK_OUTPUT' }), 0);
    main = await h.ok(`${execRoot}/${main._id}/records`, { ...common, idempotencyKey: key(), outputSerials: ['QA_EXEC_OUTPUT_A', 'QA_EXEC_OUTPUT_B'] });
    assert.equal(main.status, 'QUARANTINED'); assert.equal(main.outputUnits.length, 2); assert.equal(await h.db.collection('catalogMaterialConsumptions').countDocuments({ executionId: main._id }), 3);
  });

  await t.test('per-output aggregate ratios reject overfill and globally balanced uneven provenance before quality approval', async () => {
    const first = main.outputUnits[0], second = main.outputUnits[1], a = (receipt, quantity, serials) => ({ receiptId: receipt._id, quantity, ...(serials ? { serials } : {}) });
    await deny(`${execRoot}/${main._id}/allocations`, { ...command(main.version), outputUnitId: first._id, sources: [a(lotA, '0.5'), a(lotB, '0.5'), a(serial, '2', incoming.slice(0,2))] }, 'INVALID_ATTRIBUTION', 400);
    main = await h.ok(`${execRoot}/${main._id}/allocations`, { ...command(main.version), outputUnitId: first._id, sources: [a(lotA, '0.25'), a(lotB, '0.25'), a(serial, '2', incoming.slice(0,2))] });
    main = await h.ok(`${execRoot}/${main._id}/allocations`, { ...command(main.version), outputUnitId: second._id, sources: [a(lotA, '0.25'), a(serial, '2', incoming.slice(2,4))] });
    main = await h.ok(`${execRoot}/${main._id}/losses`, { ...command(main.version), sources: [a(lotA, '0.5'), a(lotB, '0.25'), a(serial, '2', incoming.slice(4,6))] });
    await deny(`${execRoot}/${main._id}/qc`, { ...command(main.version), acceptedSerials: main.outputUnits.map(row => row.serial), rejectedSerials: [], evidence: 'Synthetic attempted globally balanced incomplete parent provenance' }, 'PROVENANCE_INCOMPLETE');
    main = await h.ok(`${execRoot}/${main._id}/losses`, { ...command(main.version), sources: [a(lotA, '0.25'), a(lotB, '0.25'), a(serial, '2', incoming.slice(4,6))] });
    main = await h.ok(`${execRoot}/${main._id}/allocations`, { ...command(main.version), outputUnitId: second._id, sources: [a(lotA, '0.5'), a(serial, '2', incoming.slice(2,4))] });
    const before = await domainSnapshot(h); assert.equal(await h.db.collection('internalCompanyStockReceipts').countDocuments(), 0); assert.deepEqual(await domainSnapshot(h), before);
  });

  await t.test('immutable historical attribution is allowed while held, but fresh output QC requires clear source authority', async () => {
    const source = await stock(lotA), hold = await h.send(`/warehouse/receipts/${lotA._id}/holds`, { body: { expectedReceiptVersion: source.receiptVersion, reasonCode: 'QC_SUSPECT', reasonNote: reason }, headers: { 'Idempotency-Key': key() } }); assert.equal(hold.status, 201, JSON.stringify(hold));
    try { main = await h.ok(`${execRoot}/${main._id}/losses`, { ...command(main.version), sources: main.losses }); await deny(`${execRoot}/${main._id}/qc`, { ...command(main.version), acceptedSerials: main.outputUnits.map(row => row.serial), rejectedSerials: [], evidence: reason }, 'STOCK_ENCUMBERED'); }
    finally { const released = await h.send(`/warehouse/holds/${hold.data.hold.id}/release`, { body: { expectedVersion: hold.data.hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: reason }, headers: { 'Idempotency-Key': key() } }); assert.equal(released.status, 200, JSON.stringify(released)); }
    main = await h.ok(`${execRoot}/${main._id}/qc`, { ...command(main.version), acceptedSerials: main.outputUnits.map(row => row.serial), rejectedSerials: [], evidence: reason });
    acknowledgedPutaway = { ...command(main.version), locationId: location._id, expectedLocationVersion: location.version }; main = await h.ok(`${execRoot}/${main._id}/putaway`, acknowledgedPutaway);
    assert.equal(main.status, 'STORED'); assert.equal(main.companyStock.quantity, '2'); assert.equal(main.companyStock.valuation, 'UNVALUED'); assert.equal(main.companyStock.units.length, 2);
    assert.equal(await h.db.collection('warehouseReceipts').countDocuments(), 3); assert.equal(await h.db.collection('internalCompanyStockReceipts').countDocuments(), 1);
  });

  await t.test('company output identity cannot be replaced with self-rehashed foreign, duplicate or wrong master evidence', async () => {
    const company = await h.db.collection('internalCompanyStockUnits').find({ executionId: main._id }).sort({ _id: 1 }).toArray();
    for (const change of [{ outputUnitId: randomUUID() }, { serial: company[1].serial }, { itemId: lotItem._id }, { itemRevision: 999 }, { uom: 'KG' }]) {
      await withReplacement(h, 'internalCompanyStockUnits', company[0], rehash({ ...company[0], ...change }), async () => { const before = await domainSnapshot(h), response = await h.req(`${execRoot}/${main._id}`, undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'INTERNAL_EXECUTION_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before); });
    }
  });

  await t.test('stock rejects corrupt referenced execution event and surviving immutable evidence after all local use heads are removed', async () => {
    const head = await h.db.collection('internalExecutions').findOne({ _id: main._id }), event = await h.db.collection('internalExecutionEvents').findOne({ _id: head.eventId });
    for (const change of [{ contentHash: '0'.repeat(64) }, { version: event.version + 1 }]) await withReplacement(h, 'internalExecutionEvents', event, { ...event, ...change }, async () => { const before = await domainSnapshot(h), response = await h.req(`${stockRoot}/${lotB._id}`, undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'CATALOG_STOCK_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before); });
    const removed = [];
    try {
      for (const name of ['catalogUseHeads', 'catalogUseEvents', 'catalogMaterialReservations', 'catalogMaterialReservationRevisions', 'catalogMaterialIssues', 'catalogMaterialConsumptions']) { const filter = name === 'catalogUseHeads' ? { _id: lotB._id } : { receiptId: lotB._id }, rows = await h.db.collection(name).find(filter).toArray(); removed.push([name, rows]); await h.db.collection(name).deleteMany(filter); }
      await h.db.collection('internalExecutions').deleteOne({ _id: head._id }); const before = await domainSnapshot(h), response = await h.req(`${stockRoot}/${lotB._id}`, undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'CATALOG_STOCK_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before);
    } finally { await h.db.collection('internalExecutions').replaceOne({ _id: head._id }, head, { upsert: true }); for (const [name, rows] of removed) if (rows.length) await h.db.collection(name).insertMany(rows); }
  });

  await t.test('committing role revocation precedes acknowledged company putaway replay and all immutable opening ledgers stay exact', async () => {
    const member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await domainSnapshot(h);
    try { const response = await afterAuthorization(h, 'internal.execution.putaway', () => h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [] } }), () => h.req(`${execRoot}/${main._id}/putaway`, acknowledgedPutaway, h.alpha)); assert.equal(response.status, 403); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    assert.equal((await h.ok(`${execRoot}/${main._id}/putaway`, acknowledgedPutaway)).status, 'STORED'); assert.deepEqual(await domainSnapshot(h), before);
    assert.deepEqual(await physicalProof(), openingProof);
    const afterCustomer = await Promise.all(['accounts', 'salesOrders', 'manufacturingWorkOrders', 'manufacturingMovements', 'warehouseReservations', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments'].map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray())); assert.deepEqual(afterCustomer, beforeCustomer);
    for (const receipt of receipts) { const raw = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id }); assert.equal(raw.availableQuantity, '0'); assert.equal(raw.reservedQuantity, '0'); }
  });
});
