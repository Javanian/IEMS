import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { key, reason, legacyFixture, domainSnapshot, withReplacement, afterAuthorization } from '../../wave4map/qa/mapping-fixture.mjs';

test('independent catalog inspection and accepted-only putaway authority', async t => {
  const h = await startOwned(t), legacy = await legacyFixture(h), catalog = '/catalog-procurement';
  const common = version => ({ expectedVersion: version, reason, idempotencyKey: key() });
  const item = async (code, policy) => {
    const draft = await h.ok('/inventory-master/items', { ...common(1), code, description: `Synthetic ${code}`, uom: 'UN', kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: policy }, 201);
    return h.ok(`/inventory-master/items/${draft._id}/approve`, { ...common(draft.version), revision: draft.currentRevision });
  };
  const location = async (code, cookie = h.alpha) => {
    const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, code, idempotencyKey: key() }, 201, cookie);
    const draft = await h.ok('/inventory-master/locations', { ...common(1), code, binId: bin._id }, 201, cookie);
    return h.ok(`/inventory-master/locations/${draft._id}/qualify`, common(draft.version), 200, cookie);
  };
  const lotItem = await item('QC-QA-LOT', 'LOT'), serialItem = await item('QC-QA-SERIAL', 'SERIAL'), driftItem = await item('QC-QA-DRIFT', 'LOT');
  const destination = await location('QC-QA-DESTINATION'), withdrawn = await location('QC-QA-WITHDRAWN'), foreign = await location('QC-QA-FOREIGN', h.beta);
  const lines = [[lotItem, '7.5'], [serialItem, '5'], [driftItem, '1']].map(([source, quantity]) => ({ itemId: source._id, itemVersion: source.version, itemRevision: source.currentRevision, quantity, unitPrice: '1.00', currency: 'USD' }));
  let request = await h.ok(`${catalog}/requests`, { ...common(1), vendorId: legacy.vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines }, 201);
  request = await h.ok(`${catalog}/requests/${request._id}/approve`, { ...common(request.version), revision: request.currentRevision });
  let po = await h.ok(`${catalog}/requests/${request._id}/convert`, common(request.version)); po = await h.ok(`${catalog}/orders/${po._id}/issue`, common(po.version));
  const receive = (source, quantity, serials = []) => h.ok(`${catalog}/receipts`, { ...common(po.version), purchaseOrderId: po._id, vendorId: legacy.vendor._id, lineId: po.content.lines.find(line => line.itemId === source._id).lineId, quantity, serials, lotNumber: `QC-QA-${key()}`, heatNumber: 'QC-QA-HEAT' }, 201);
  const lot = await receive(lotItem, '2.5'), rejected = await receive(lotItem, '1'), race = await receive(lotItem, '2'), held = await receive(lotItem, '1'), changedLocation = await receive(lotItem, '1');
  const serial = await receive(serialItem, '3', ['QC-QA-SERIAL-A', 'QC-QA-SERIAL-B', 'QC-QA-SERIAL-C']), rollback = await receive(serialItem, '2', ['QC-QA-ROLLBACK-A', 'QC-QA-ROLLBACK-B']), drift = await receive(driftItem, '1');
  const receipts = [lot, rejected, race, held, changedLocation, serial, rollback, drift], path = row => `/catalog-disposition/receipts/${row._id}`;
  const view = row => h.ok(path(row)), command = current => ({ ...common(current.version), expectedReceiptVersion: current.receiptVersion });
  const inspection = (current, acceptedQuantity, rejectedQuantity, extra = {}) => ({ ...command(current), acceptedQuantity, rejectedQuantity, evidence: reason, ...extra });
  const inspect = async (row, acceptedQuantity, rejectedQuantity, extra) => h.ok(`${path(row)}/inspections`, inspection(await view(row), acceptedQuantity, rejectedQuantity, extra));
  const approval = current => ({ ...command(current), revision: current.currentRevision });
  const approve = async row => h.ok(`${path(row)}/approve`, approval(await view(row)));
  const putaway = (current, target = destination) => ({ ...command(current), locationId: target._id, expectedLocationVersion: target.version });
  const refuse = async (route, body, expectedCode) => {
    const before = await domainSnapshot(h), response = await h.req(route, body, h.alpha);
    assert.equal(response.status, 409, `${route}: ${JSON.stringify(response)}`);
    if (expectedCode) assert.equal(response.error.code, expectedCode); assert.deepEqual(await domainSnapshot(h), before); return response;
  };
  const hold = async row => {
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: row._id });
    const response = await h.send(`/warehouse/receipts/${row._id}/holds`, { headers: { 'Idempotency-Key': key() }, body: { expectedReceiptVersion: raw.version, reasonCode: 'QC_SUSPECT', reasonNote: reason } });
    assert.equal(response.status, 201, JSON.stringify(response)); return response.data.hold;
  };
  const clear = async active => { const response = await h.send(`/warehouse/holds/${active.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { expectedVersion: active.version, reasonCode: 'INSPECTION_PASSED', reasonNote: reason } }); assert.equal(response.status, 200); };
  const sourceRows = async () => ({ origins: await h.db.collection('warehouseReceiptOrigins').find({ receiptId: { $in: receipts.map(row => row._id) } }).sort({ _id: 1 }).toArray(), receives: await h.db.collection('warehouseMovements').find({ receiptId: { $in: receipts.map(row => row._id) }, kind: 'RECEIVE' }).sort({ _id: 1 }).toArray(), registry: await h.db.collection('warehouseSerials').find({ receiptId: { $in: receipts.map(row => row._id) } }).sort({ _id: 1 }).toArray() });
  const immutableSources = await sourceRows();
  const negative = async () => {
    const names = new Set(['accounts', 'salesOrders', 'quotes', 'quoteRevisions', 'purchaseOrders', 'purchaseRequests']);
    for (const { name } of await h.db.listCollections({}, { nameOnly: true }).toArray()) if (/^(manufacturing|fulfillment|genealogy|componentInstallation|serialCustody|internalProduction|internalEngineering)/.test(name)) names.add(name);
    return Object.fromEntries(await Promise.all([...names].sort().map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const initialNegative = await negative();

  await t.test('inspection is exact immutable evidence and source partition cannot be invented', async () => {
    const initial = await view(lot); assert.equal(initial.version, 1); assert.equal(initial.status, 'UNRECORDED');
    const before = await domainSnapshot(h), invalid = await h.req(`${path(lot)}/inspections`, inspection(initial, '1', '1'), h.alpha);
    assert.equal(invalid.status, 400); assert.equal(invalid.error.code, 'INVALID_INSPECTION'); assert.deepEqual(await domainSnapshot(h), before);
    const lotDraft = await inspect(lot, '1.25', '1.25'); assert.equal(lotDraft.version, 2); assert.equal(lotDraft.currentRevision, 1);
    const serialInitial = await view(serial);
    for (const extra of [ { acceptedSerials: ['QC-QA-SERIAL-A', 'QC-QA-SERIAL-B'], rejectedSerials: ['QC-QA-SERIAL-B'] }, { acceptedSerials: ['QC-QA-SERIAL-A', 'QC-QA-INVENTED'], rejectedSerials: ['QC-QA-SERIAL-C'] } ]) {
      const unchanged = await domainSnapshot(h), response = await h.req(`${path(serial)}/inspections`, inspection(serialInitial, '2', '1', extra), h.alpha);
      assert.equal(response.status, 400); assert.equal(response.error.code, 'INVALID_INSPECTION'); assert.deepEqual(await domainSnapshot(h), unchanged);
    }
    await inspect(serial, '2', '1', { acceptedSerials: ['QC-QA-SERIAL-A', 'QC-QA-SERIAL-B'], rejectedSerials: ['QC-QA-SERIAL-C'] });
  });

  const forced = async (row, status, effect, counters = {}) => {
    const original = await h.db.collection('warehouseReceipts').findOne({ _id: row._id }), replacement = { ...original, status, availableQuantity: original.quantity, reservedQuantity: '0', manufacturingReservedQuantity: '0', manufacturingConsumedQuantity: '0', shippedQuantity: '0', location: 'QC-QA-FORCED', ...counters };
    delete replacement.catalogSource; delete replacement.catalogDisposition;
    return withReplacement(h, 'warehouseReceipts', original, replacement, () => effect(replacement));
  };
  async function legacyWriters() {
    for (const [action, status, fields] of [ ['release', 'QUARANTINED', { reason }], ['putaway', 'RELEASED', { location: 'QC-QA-BYPASS' }], ['reserve', 'STORED', { salesOrderId: legacy.so._id, accountId: legacy.account._id, lineIndex: 0, quantity: '1', uom: 'UN' }], ['count', 'STORED', { countedQuantity: '1', uom: 'UN', reason }], ['transfer', 'STORED', { binId: legacy.bin._id, uom: 'UN', reason }] ]) await forced(lot, status, row => refuse(`/warehouse/receipts/${row._id}/${action}`, { expectedVersion: row.version, idempotencyKey: key(), ...fields }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    await forced(serial, 'STORED', row => refuse(`/warehouse/receipts/${row._id}/serial-custody/adopt`, { expectedVersion: row.version, reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    await forced(lot, 'STORED', async row => {
      const materials = [{ receiptId: row._id, quantityPerUnit: '1', uom: 'UN' }];
      await refuse(`/manufacturing/work-orders/${legacy.workOrders[2]._id}/release`, { expectedVersion: 1, operations: legacy.operations, materials, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      await refuse('/manufacturing/engineering', { ...legacy.engineeringBody, materials, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      await refuse(`/manufacturing/engineering/${legacy.draftEngineering._id}/revisions`, { expectedVersion: legacy.draftEngineering.version, operations: legacy.operations, materials, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      const pending = await h.db.collection('engineeringRevisions').findOne({ engineeringId: legacy.draftEngineering._id, revision: 1 });
      await withReplacement(h, 'engineeringRevisions', pending, { ...pending, materials }, () => refuse(`/manufacturing/engineering/${legacy.draftEngineering._id}/release`, { expectedVersion: legacy.draftEngineering.version, revision: 1, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
      const approved = await h.db.collection('engineeringRevisions').findOne({ engineeringId: legacy.approvedEngineering._id, revision: 1 });
      await withReplacement(h, 'engineeringRevisions', approved, { ...approved, materials, releaseSnapshot: { ...approved.releaseSnapshot, materials } }, () => refuse(`/manufacturing/work-orders/${legacy.workOrders[1]._id}/release-engineering`, { expectedVersion: 1, engineeringId: legacy.approvedEngineering._id, engineeringVersion: legacy.approvedEngineering.version, revision: 1, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
      const wo = await h.db.collection('manufacturingWorkOrders').findOne({ _id: legacy.released._id }), material = { ...wo.routing.materials[0], receiptId: row._id, materialTrace: { receiptId: row._id, lotNumber: row.lotNumber, heatNumber: row.heatNumber } };
      await withReplacement(h, 'manufacturingWorkOrders', wo, { ...wo, routing: { ...wo.routing, materials: [material] } }, () => refuse(`/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: wo.version, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'UN', evidence: reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
      const reservation = await h.db.collection('warehouseReservations').findOne({ _id: legacy.reservation._id });
      await withReplacement(h, 'warehouseReservations', reservation, { ...reservation, receiptId: row._id, materialTrace: material.materialTrace }, () => refuse('/fulfillment/shipments', { salesOrderId: legacy.so._id, expectedVersion: legacy.so.version, lineIndex: 0, uom: 'UN', reference: reason, sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '1' }], idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    }, { manufacturingReservedQuantity: '1', reservedQuantity: '1' });
  }
  await t.test('every legacy writer denies typed stock before approval even with both local markers stripped', legacyWriters);

  await t.test('missing inspection head plus stripped marker cannot reset existing evidence to unrecorded', async () => {
    const head = await h.db.collection('catalogDispositionHeads').findOne({ _id: lot._id }), raw = await h.db.collection('warehouseReceipts').findOne({ _id: lot._id }), stripped = { ...raw }; delete stripped.catalogDisposition;
    await h.db.collection('catalogDispositionHeads').deleteOne({ _id: head._id });
    try { await withReplacement(h, 'warehouseReceipts', raw, stripped, async () => { await refuse(path(lot), undefined, 'CATALOG_DISPOSITION_SOURCE_INVALID'); await refuse(`${path(lot)}/inspections`, { ...common(1), expectedReceiptVersion: raw.version, acceptedQuantity: '1.25', rejectedQuantity: '1.25', evidence: reason }, 'CATALOG_DISPOSITION_SOURCE_INVALID'); }); }
    finally { await h.db.collection('catalogDispositionHeads').insertOne(head); }
  });

  await t.test('a malformed head with alternate id cannot hide as a pristine unrecorded receipt', async () => {
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: drift._id });
    const malformed = { _id: key(), tenantId: raw.tenantId, plantId: raw.plantId, receiptId: raw._id };
    await h.db.collection('catalogDispositionHeads').insertOne(malformed);
    try {
      await refuse(path(drift), undefined, 'CATALOG_DISPOSITION_SOURCE_INVALID');
      await refuse(`${path(drift)}/inspections`, { ...common(1), expectedReceiptVersion: raw.version, acceptedQuantity: '1', rejectedQuantity: '0', evidence: reason }, 'CATALOG_DISPOSITION_SOURCE_INVALID');
    } finally { await h.db.collection('catalogDispositionHeads').deleteOne({ _id: malformed._id }); }
  });

  await t.test('approval binds immutable partitions; all rejected remains terminal without putaway or PO reversal', async () => {
    const lotInspection = await h.ok(`${path(lot)}/inspections/1`), serialInspection = await h.ok(`${path(serial)}/inspections/1`);
    await approve(lot); const approved = await approve(serial);
    assert.equal(approved.stock.acceptedQuantity, '2'); assert.equal(approved.stock.rejectedQuantity, '1'); assert.equal(approved.stock.availableQuantity, '0');
    assert.equal(approved.units.filter(unit => unit.status === 'ACCEPTED_QUARANTINE').length, 2); assert.equal(approved.units.filter(unit => unit.status === 'REJECTED_QUARANTINE').length, 1);
    assert.deepEqual(await h.ok(`${path(lot)}/inspections/1`), lotInspection); assert.deepEqual(await h.ok(`${path(serial)}/inspections/1`), serialInspection);
    await refuse(`${path(lot)}/inspections`, inspection(await view(lot), '2.5', '0'), 'CATALOG_DISPOSITION_STATE_CONFLICT');
    const entitlement = (await h.ok(`${catalog}/orders/${po._id}`)).receiving;
    await inspect(rejected, '0', '1'); const allRejected = await approve(rejected); assert.equal(allRejected.stock.acceptedQuantity, '0'); assert.equal(allRejected.canPutaway, false);
    await refuse(`${path(rejected)}/putaway`, putaway(allRejected), 'CATALOG_DISPOSITION_STATE_CONFLICT');
    assert.equal(await h.db.collection('catalogStockMovements').countDocuments({ receiptId: rejected._id }), 0);
    assert.deepEqual((await h.ok(`${catalog}/orders/${po._id}`)).receiving, entitlement);
  });

  let replayBody, replayResult;
  await t.test('accepted-only putaway partitions exact typed stock and a concurrent winner creates one movement', async () => {
    replayBody = putaway(await view(lot)); replayResult = await h.ok(`${path(lot)}/putaway`, replayBody);
    const storedSerial = await h.ok(`${path(serial)}/putaway`, putaway(await view(serial)));
    assert.equal(replayResult.status, 'STORED'); assert.equal(replayResult.stock.availableQuantity, '1.25'); assert.equal(storedSerial.stock.availableQuantity, '2');
    assert.equal(storedSerial.units.filter(unit => unit.status === 'AVAILABLE' && unit.eligible).length, 2); assert.equal(storedSerial.units.filter(unit => unit.status === 'REJECTED_QUARANTINE').length, 1);
    assert.equal(storedSerial.canAllocate, false); assert.equal(storedSerial.canExecute, false);
    await inspect(race, '1.5', '0.5'); await approve(race); const current = await view(race), bodies = [putaway(current), putaway(current)];
    const results = await Promise.all(bodies.map(body => h.req(`${path(race)}/putaway`, body, h.alpha))); assert.deepEqual(results.map(row => row.status).sort(), [200, 409], JSON.stringify(results));
    assert.equal(await h.db.collection('catalogStockMovements').countDocuments({ receiptId: race._id }), 1);
    assert.equal(await h.db.collection('catalogDispositionKeys').countDocuments({ key: bodies[results.findIndex(row => row.status !== 200)].idempotencyKey }), 0);
    assert.equal((await view(race)).stock.storedQuantity, '1.5');
    const committed = await domainSnapshot(h); assert.deepEqual(await h.ok(`${path(lot)}/putaway`, replayBody), replayResult); assert.deepEqual(await domainSnapshot(h), committed);
    const balance = await h.db.collection('catalogStockBalances').findOne({ receiptId: lot._id }), active = await hold(lot);
    try { const blocked = await view(lot); assert.equal(blocked.stock.physicalAvailableQuantity, '1.25'); assert.equal(blocked.stock.eligibleQuantity, '0'); assert.ok(blocked.blockers.includes('SOURCE_HELD')); assert.deepEqual(await h.db.collection('catalogStockBalances').findOne({ receiptId: lot._id }), balance); }
    finally { await clear(active); }
    assert.equal((await view(lot)).stock.eligibleQuantity, '1.25');
    const reconciliation = await h.ok(`/warehouse/receipts/${lot._id}/reconciliation`); assert.equal(reconciliation.matches, true); assert.equal(reconciliation.cached.availableQuantity, '0'); assert.equal(reconciliation.catalog.stockIsSeparate, true);
  });
  await t.test('all legacy writers still deny stored typed stock after both local markers are stripped', legacyWriters);

  await t.test('stored evidence and balances cannot be hidden by deleting head and marker or tampering projection', async () => {
    const head = await h.db.collection('catalogDispositionHeads').findOne({ _id: lot._id }), raw = await h.db.collection('warehouseReceipts').findOne({ _id: lot._id }), stripped = { ...raw, status: 'QUARANTINED' }; delete stripped.catalogDisposition;
    await h.db.collection('catalogDispositionHeads').deleteOne({ _id: head._id });
    try { await withReplacement(h, 'warehouseReceipts', raw, stripped, () => refuse(path(lot), undefined, 'CATALOG_DISPOSITION_SOURCE_INVALID')); }
    finally { await h.db.collection('catalogDispositionHeads').insertOne(head); }
    const balance = await h.db.collection('catalogStockBalances').findOne({ receiptId: lot._id });
    await withReplacement(h, 'catalogStockBalances', balance, { ...balance, availableQuantity: '2.5' }, () => refuse(path(lot), undefined, 'CATALOG_DISPOSITION_SOURCE_INVALID'));
  });

  await t.test('holds and malformed cache block fresh approval while historical recording and origin remain valid', async () => {
    const active = await hold(held);
    try { const recorded = await inspect(held, '1', '0'); assert.equal(recorded.canRecord, true); assert.equal(recorded.canApprove, false); await refuse(`${path(held)}/approve`, approval(recorded), 'STOCK_ENCUMBERED'); }
    finally { await clear(active); }
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: held._id });
    await withReplacement(h, 'warehouseReceipts', raw, { ...raw, hold: { active: false } }, async () => { const blocked = await view(held); assert.ok(blocked.sourceHolds.reasonCodes.includes('INVALID_HOLD_CACHE')); await refuse(`${path(held)}/approve`, approval(blocked), 'STOCK_ENCUMBERED'); });
    await approve(held); let heldAfterAuthorization, committed;
    const body = putaway(await view(held));
    const response = await afterAuthorization(h, 'catalog.putaway', async () => { heldAfterAuthorization = await hold(held); committed = await domainSnapshot(h); }, () => h.req(`${path(held)}/putaway`, body, h.alpha));
    try { assert.equal(response.status, 409); assert.ok(['STOCK_ENCUMBERED', 'VERSION_CONFLICT'].includes(response.error.code)); assert.deepEqual(await domainSnapshot(h), committed); }
    finally { if (heldAfterAuthorization) await clear(heldAfterAuthorization); }
  });

  await t.test('master and location withdrawals block fresh use without rewriting stored physical availability', async () => {
    await inspect(drift, '1', '0');
    await h.ok(`/inventory-master/items/${driftItem._id}/revisions`, { ...common(driftItem.version), description: 'Synthetic changed source approval', uom: 'UN', kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' });
    await refuse(`${path(drift)}/approve`, approval(await view(drift)), 'CATALOG_DEPENDENCY_CHANGED');
    await inspect(changedLocation, '1', '0'); await approve(changedLocation);
    const current = await view(changedLocation), foreignBody = putaway(current, foreign), before = await domainSnapshot(h), foreignResponse = await h.req(`${path(changedLocation)}/putaway`, foreignBody, h.alpha);
    assert.ok([403, 404].includes(foreignResponse.status)); assert.deepEqual(await domainSnapshot(h), before);
    let committed;
    const blocked = await afterAuthorization(h, 'catalog.putaway', async () => { await h.ok(`/inventory-master/locations/${withdrawn._id}/deactivate`, common(withdrawn.version)); committed = await domainSnapshot(h); }, () => h.req(`${path(changedLocation)}/putaway`, putaway(current, withdrawn), h.alpha));
    assert.equal(blocked.status, 409); assert.deepEqual(await domainSnapshot(h), committed);
    const balance = await h.db.collection('catalogStockBalances').findOne({ receiptId: lot._id });
    await h.ok(`/inventory-master/locations/${destination._id}/deactivate`, common(destination.version));
    const stored = await view(lot); assert.equal(stored.stock.physicalAvailableQuantity, '1.25'); assert.equal(stored.stock.eligibleQuantity, '0'); assert.ok(stored.blockers.includes('LOCATION_CHANGED'));
    assert.deepEqual(await h.db.collection('catalogStockBalances').findOne({ receiptId: lot._id }), balance);
  });

  await t.test('SERIAL approval outbox failure rolls back receipt/head, balance, all unit states and durable key', async () => {
    const pending = await inspect(rollback, '1', '1', { acceptedSerials: ['QC-QA-ROLLBACK-A'], rejectedSerials: ['QC-QA-ROLLBACK-B'] }), body = approval(pending), before = await domainSnapshot(h);
    await h.db.command({ collMod: 'catalogDispositionOutbox', validator: { qaForbidden: { $exists: true } }, validationLevel: 'strict' });
    try { const response = await h.req(`${path(rollback)}/approve`, body, h.alpha); assert.equal(response.status, 500); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.command({ collMod: 'catalogDispositionOutbox', validator: {} }); }
    const approved = await h.ok(`${path(rollback)}/approve`, body); assert.equal(approved.stock.acceptedQuantity, '1'); assert.equal(approved.units.length, 2);
  });

  await t.test('revocation is checked before acknowledged putaway replay even after location drift', async () => {
    const membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await domainSnapshot(h);
    try { const response = await afterAuthorization(h, 'catalog.putaway', async () => { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } }); }, () => h.req(`${path(lot)}/putaway`, replayBody, h.alpha)); assert.equal(response.status, 403); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
    assert.deepEqual(await h.ok(`${path(lot)}/putaway`, replayBody), replayResult); assert.deepEqual(await domainSnapshot(h), before);
  });

  await t.test('QC-only reader receives scoped physical evidence without financial or legacy grants', async () => {
    const membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await domainSnapshot(h);
    await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [{ role: 'catalogQCReader', plantIds: membership.plantIds }] } });
    try {
      const scoped = await view(serial); assert.equal(scoped.receipt._id, serial._id); assert.equal(scoped.receipt.quantity, '3'); assert.equal(scoped.receipt.uom, 'UN'); assert.equal(scoped.canAllocate, false);
      const keys = value => value && typeof value === 'object' ? Object.entries(value).flatMap(([name, nested]) => [name, ...keys(nested)]) : [];
      assert.equal(keys(scoped).some(name => ['unitPrice', 'currency', 'lineTotal', 'taxPolicy', 'total'].includes(name)), false);
      for (const route of [`${catalog}/orders/${po._id}`, `/inventory-master/items/${serialItem._id}`, `/warehouse/receipts/${serial._id}`]) assert.equal((await h.req(route, undefined, h.alpha)).status, 403, route);
      assert.equal((await h.req(`${path(lot)}/putaway`, replayBody, h.alpha)).status, 403); assert.deepEqual(await domainSnapshot(h), before);
    } finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
  });

  await t.test('QC stock never changes original receive identity, global registry or customer/execution entitlement', async () => {
    assert.deepEqual(await sourceRows(), immutableSources); assert.deepEqual(await negative(), initialNegative);
    for (const row of receipts) { const raw = await h.db.collection('warehouseReceipts').findOne({ _id: row._id }); assert.equal(raw.availableQuantity, '0'); assert.equal(raw.reservedQuantity, '0'); for (const field of ['shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity']) assert.equal(raw[field] || '0', '0'); }
  });
});
