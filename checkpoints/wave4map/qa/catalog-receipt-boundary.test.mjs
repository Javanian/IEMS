import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { key, reason, legacyFixture, domainSnapshot, denyNoEffects, withReplacement, afterAuthorization } from './mapping-fixture.mjs';

test('independent typed receiving, immutable origin and every legacy stock boundary', async t => {
  const h = await startOwned(t), legacy = await legacyFixture(h), base = '/catalog-procurement';
  const common = version => ({ expectedVersion: version, reason, idempotencyKey: key() });
  const item = async (code, policy, cookie = h.alpha) => {
    const created = await h.ok('/inventory-master/items', { ...common(1), code, description: `Synthetic ${code}`, uom: 'UN', kind: 'PURCHASED', ...(policy && { schema: 'INVENTORY_ITEM_V2', trackingPolicy: policy }) }, 201, cookie);
    return h.ok(`/inventory-master/items/${created._id}/approve`, { ...common(created.version), revision: created.currentRevision }, 200, cookie);
  };
  const lotItem = await item('MAP-QA-LOT', 'LOT'), serialItem = await item('MAP-QA-SERIAL', 'SERIAL');
  const driftItem = await item('MAP-QA-DRIFT', 'LOT'), rollbackItem = await item('MAP-QA-ROLLBACK', 'SERIAL'), v1Item = await item('MAP-QA-V1');
  const foreignItem = await item('MAP-QA-FOREIGN', 'LOT', h.beta);
  const line = (source, quantity) => ({ itemId: source._id, itemVersion: source.version, itemRevision: source.currentRevision, quantity, unitPrice: '10.00', currency: 'IDR' });
  const requestBody = lines => ({ ...common(1), vendorId: legacy.vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines });
  const order = async lines => {
    const request = await h.ok(`${base}/requests`, requestBody(lines), 201);
    const approved = await h.ok(`${base}/requests/${request._id}/approve`, { ...common(request.version), revision: request.currentRevision });
    const converted = await h.ok(`${base}/requests/${request._id}/convert`, common(approved.version));
    return h.ok(`${base}/orders/${converted._id}/issue`, common(converted.version));
  };
  const po = await order([line(lotItem, '2.5'), line(serialItem, '3')]), driftPo = await order([line(driftItem, '1')]), rollbackPo = await order([line(rollbackItem, '1')]);
  const receiveBody = (source, selected, quantity, serials = [], suffix = key()) => ({ ...common(source.version), purchaseOrderId: source._id, vendorId: legacy.vendor._id, lineId: selected.lineId, quantity, serials, lotNumber: `MAP-QA-LOT-${suffix}`, heatNumber: `MAP-QA-HEAT-${suffix}` });
  const lotLine = po.content.lines.find(row => row.itemId === lotItem._id), serialLine = po.content.lines.find(row => row.itemId === serialItem._id);
  const forbidden = async () => {
    const names = new Set(['accounts', 'contacts', 'opportunities', 'inquiries', 'quotes', 'quoteRevisions', 'salesOrders', 'invoices', 'vendors', 'purchaseRequests', 'purchaseOrders', 'procurementConversions']);
    for (const { name } of await h.db.listCollections({}, { nameOnly: true }).toArray()) if (/^(commercial|procurement|manufacturing|fulfillment|genealogy|componentInstallation|serialCustody|internalProduction|internalEngineering)/.test(name)) names.add(name);
    return Object.fromEntries(await Promise.all([...names].sort().map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const baseline = await forbidden();
  // F4 fresh vendor authority writes this one technical fence; no vendor business field may change.
  const freshReceipts = new Map(), vendorScope = { tenantId: legacy.vendor.tenantId, plantId: legacy.vendor.plantId };
  const vendorAuthority = async () => {
    const vendor = await h.db.collection('vendors').findOne({ ...vendorScope, _id: legacy.vendor._id });
    assert.ok(vendor && Number.isSafeInteger(vendor.catalogUseFence) && vendor.catalogUseFence >= 0, 'Fresh-use fence must remain a nonnegative safe integer');
    return vendor;
  };
  const receivingKeys = () => h.db.collection('catalogKeys').find({ ...vendorScope, 'result.vendorId': legacy.vendor._id, 'result.catalogSource': { $exists: true } }).sort({ key: 1 }).toArray();
  const originalReceivingKeys = new Set((await receivingKeys()).map(row => row.key));
  const assertVendorAdvance = async (before, advances) => assert.deepEqual(await vendorAuthority(), { ...before, catalogUseFence: before.catalogUseFence + advances });
  const freshReceive = async body => {
    const before = await vendorAuthority();
    assert.equal(await h.db.collection('catalogKeys').countDocuments({ ...vendorScope, key: body.idempotencyKey }), 0, 'Fresh receiving helper must not count replay as a new commit');
    const receipt = await h.ok(`${base}/receipts`, body, 201);
    freshReceipts.set(body.idempotencyKey, receipt._id);
    await assertVendorAdvance(before, 1);
    return receipt;
  };
  let lotReceipt, serialReceipt, retainedBody, retainedReceipt;

  await t.test('actual fractional LOT and SERIAL partial receipts reconcile one source and RECEIVE per physical receipt', async () => {
    assert.equal(po.content.total, '55.00');
    retainedBody = receiveBody(po, lotLine, '1.25'); retainedReceipt = await freshReceive(retainedBody); lotReceipt = retainedReceipt;
    const second = await freshReceive(receiveBody(po, lotLine, '1.25'));
    serialReceipt = await freshReceive(receiveBody(po, serialLine, '2', ['MAP-QA-SERIAL-A', 'MAP-QA-SERIAL-B']));
    for (const receipt of [lotReceipt, second, serialReceipt]) {
      assert.equal(receipt.status, 'QUARANTINED'); assert.equal(receipt.availableQuantity, '0'); assert.equal(receipt.reservedQuantity, '0'); assert.equal(receipt.usable, false);
      assert.deepEqual(receipt.receiptOrigin, { cohort: 'CATALOG', legacyEligible: false });
      const origins = await h.db.collection('warehouseReceiptOrigins').find({ receiptId: receipt._id }).toArray(), receives = await h.db.collection('warehouseMovements').find({ receiptId: receipt._id, kind: 'RECEIVE' }).toArray();
      assert.equal(origins.length, 1); assert.equal(receives.length, 1); assert.equal(origins[0].receiveMovementId, receives[0]._id);
      assert.deepEqual(origins[0].source, receipt.catalogSource); assert.equal(receives[0].quantity, receipt.quantity);
      assert.equal(await h.db.collection('purchaseOrders').countDocuments({ _id: po._id }), 0);
    }
    assert.equal((await h.db.collection('warehouseSerials').find({ receiptId: serialReceipt._id }).toArray()).length, 2);
    const view = await h.ok(`${base}/orders/${po._id}`), lot = view.receiving.find(row => row.lineId === lotLine.lineId);
    assert.equal(lot.receivedQuantity, '2.5'); assert.equal(lot.remainingQuantity, '0'); assert.equal(lot.receiptCount, 2);
    assert.deepEqual(new Set(lot.receiptIds), new Set([lotReceipt._id, second._id]));
    await denyNoEffects(h, `${base}/receipts`, receiveBody(po, lotLine, '0.000001'), 'QUANTITY_EXCEEDED');
    const committed = await domainSnapshot(h); assert.deepEqual(await h.ok(`${base}/receipts`, retainedBody, 201), retainedReceipt); assert.deepEqual(await domainSnapshot(h), committed);
  });

  await t.test('incoming registry rows with manufactured work-order or unit markers invalidate reads and fresh receiving', async () => {
    const registry = await h.db.collection('warehouseSerials').findOne({ receiptId: serialReceipt._id });
    assert.ok(registry);
    for (const field of ['workOrderId', 'unitId']) {
      await withReplacement(h, 'warehouseSerials', registry, { ...registry, [field]: key() }, async () => {
        await denyNoEffects(h, `${base}/receipts/${serialReceipt._id}`, undefined, 'CATALOG_SOURCE_INVALID');
        await denyNoEffects(h, `${base}/orders/${po._id}`, undefined, 'CATALOG_SOURCE_INVALID');
        await denyNoEffects(h, `${base}/receipts`, receiveBody(po, serialLine, '1', [`MAP-QA-REGISTRY-${field}`]), 'CATALOG_SOURCE_INVALID');
      });
    }
  });

  await t.test('serial collision and competing final partial receipts cannot duplicate identity or line entitlement', async () => {
    const before = await domainSnapshot(h), duplicate = await h.req(`${base}/receipts`, receiveBody(po, serialLine, '1', ['MAP-QA-SERIAL-A']), h.alpha);
    assert.equal(duplicate.status, 409); assert.deepEqual(await domainSnapshot(h), before);
    const commands = ['MAP-QA-LAST-A', 'MAP-QA-LAST-B'].map(serial => receiveBody(po, serialLine, '1', [serial]));
    const vendorBeforeRace = await vendorAuthority();
    const responses = await Promise.all(commands.map(body => h.req(`${base}/receipts`, body, h.alpha)));
    assert.deepEqual(responses.map(row => row.status).sort(), [201, 409], JSON.stringify(responses));
    const committed = responses.map((response, index) => ({ response, body: commands[index] })).filter(row => row.response.status === 201);
    await assertVendorAdvance(vendorBeforeRace, committed.length);
    for (const { response, body } of committed) freshReceipts.set(body.idempotencyKey, response.data._id);
    const loser = commands[responses.findIndex(row => row.status !== 201)]; assert.equal(await h.db.collection('catalogKeys').countDocuments({ key: loser.idempotencyKey }), 0);
    const tally = await h.db.collection('catalogReceived').findOne({ purchaseOrderId: po._id, lineId: serialLine.lineId });
    assert.equal(tally.quantity, '3'); assert.equal(tally.receiptCount, 2);
    const origins = await h.db.collection('warehouseReceiptOrigins').find({ 'source.purchaseOrderId': po._id, 'source.purchaseOrderLineId': serialLine.lineId }).toArray();
    assert.equal(origins.length, 2); assert.equal(origins.reduce((sum, origin) => sum + BigInt(origin.physical.quantity), 0n), 3n);
  });

  await t.test('V1 policy, forged source metadata, foreign items and SERIAL overflow never create authority', async () => {
    for (const body of [requestBody([line(v1Item, '1')]), requestBody([line(serialItem, '101')]), requestBody([line(serialItem, '0.5')])]) {
      const before = await domainSnapshot(h), response = await h.req(`${base}/requests`, body, h.alpha);
      assert.ok([400, 409].includes(response.status), JSON.stringify(response)); assert.deepEqual(await domainSnapshot(h), before);
    }
    for (const extra of [{ ownerLegalEntityId: key() }, { schema: 'LEGACY' }, { lines: [{ ...line(lotItem, '1'), uom: 'SET' }] }]) {
      const before = await domainSnapshot(h), response = await h.req(`${base}/requests`, { ...requestBody([line(lotItem, '1')]), ...extra }, h.alpha);
      assert.equal(response.status, 400); assert.deepEqual(await domainSnapshot(h), before);
    }
    const before = await domainSnapshot(h), foreign = await h.req(`${base}/requests`, requestBody([line(foreignItem, '1')]), h.alpha);
    assert.ok([403, 404].includes(foreign.status), JSON.stringify(foreign)); assert.deepEqual(await domainSnapshot(h), before);
  });

  await t.test('actual hold apply and release preserve typed origin through version advances and acknowledged replay', async () => {
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: lotReceipt._id });
    const applied = await h.send(`/warehouse/receipts/${raw._id}/holds`, { headers: { 'Idempotency-Key': key() }, body: { expectedReceiptVersion: raw.version, reasonCode: 'QC_SUSPECT', reasonNote: reason } });
    assert.equal(applied.status, 201, JSON.stringify(applied)); const hold = applied.data.hold;
    try {
      const view = await h.ok(`${base}/receipts/${raw._id}`); assert.deepEqual(view.catalogSource, lotReceipt.catalogSource); assert.equal(view.usable, false); assert.ok(view.version > raw.version);
      const held = await domainSnapshot(h); assert.deepEqual(await h.ok(`${base}/receipts`, retainedBody, 201), retainedReceipt); assert.deepEqual(await domainSnapshot(h), held);
    } finally {
      const released = await h.send(`/warehouse/holds/${hold.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { expectedVersion: hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: reason } });
      assert.equal(released.status, 200, JSON.stringify(released));
    }
    const current = await h.ok(`${base}/receipts/${raw._id}`); assert.deepEqual(current.catalogSource, lotReceipt.catalogSource); assert.equal(current.availableQuantity, '0');
  });

  const forced = async (receipt, status, effect, counters = {}) => {
    const original = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const replacement = { ...original, status, availableQuantity: original.quantity, reservedQuantity: '0', manufacturingReservedQuantity: '0', manufacturingConsumedQuantity: '0', shippedQuantity: '0', location: 'MAP-QA-FORCED', ...counters };
    delete replacement.catalogSource;
    return withReplacement(h, 'warehouseReceipts', original, replacement, () => effect(replacement));
  };
  const materialsFor = receipt => [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'UN' }];

  await t.test('stripped typed markers cannot enter any legacy warehouse or custody-adoption writer', async () => {
    const commands = [
      ['release', 'QUARANTINED', () => ({ reason })], ['putaway', 'RELEASED', () => ({ location: 'MAP-QA-BYPASS' })],
      ['reserve', 'STORED', () => ({ salesOrderId: legacy.so._id, accountId: legacy.account._id, lineIndex: 0, quantity: '1', uom: 'UN' })],
      ['count', 'STORED', () => ({ countedQuantity: '1', uom: 'UN', reason })], ['transfer', 'STORED', () => ({ binId: legacy.bin._id, uom: 'UN', reason })],
    ];
    for (const [action, status, fields] of commands) await forced(lotReceipt, status, row => denyNoEffects(h, `/warehouse/receipts/${row._id}/${action}`, { expectedVersion: row.version, idempotencyKey: key(), ...fields() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    await forced(serialReceipt, 'STORED', row => denyNoEffects(h, `/warehouse/receipts/${row._id}/serial-custody/adopt`, { expectedVersion: row.version, reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
  });

  await t.test('stripped typed markers cannot enter manual or engineering material preparation and release', async () => {
    await forced(lotReceipt, 'STORED', async receipt => {
      const material = materialsFor(receipt);
      await denyNoEffects(h, `/manufacturing/work-orders/${legacy.workOrders[2]._id}/release`, { expectedVersion: 1, operations: legacy.operations, materials: material, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      await denyNoEffects(h, '/manufacturing/engineering', { ...legacy.engineeringBody, materials: material, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      await denyNoEffects(h, `/manufacturing/engineering/${legacy.draftEngineering._id}/revisions`, { expectedVersion: legacy.draftEngineering.version, operations: legacy.operations, materials: material, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      const pending = await h.db.collection('engineeringRevisions').findOne({ engineeringId: legacy.draftEngineering._id, revision: 1 });
      await withReplacement(h, 'engineeringRevisions', pending, { ...pending, materials: material }, () => denyNoEffects(h, `/manufacturing/engineering/${legacy.draftEngineering._id}/release`, { expectedVersion: legacy.draftEngineering.version, revision: 1, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
      const released = await h.db.collection('engineeringRevisions').findOne({ engineeringId: legacy.approvedEngineering._id, revision: 1 });
      await withReplacement(h, 'engineeringRevisions', released, { ...released, materials: material, releaseSnapshot: { ...released.releaseSnapshot, materials: material } }, () => denyNoEffects(h, `/manufacturing/work-orders/${legacy.workOrders[1]._id}/release-engineering`, { expectedVersion: 1, engineeringId: legacy.approvedEngineering._id, engineeringVersion: legacy.approvedEngineering.version, revision: 1, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    });
  });

  await t.test('defensive first-consume and reservation-dispatch guards reject previously substituted typed sources', async () => {
    await forced(lotReceipt, 'STORED', async receipt => {
      const wo = await h.db.collection('manufacturingWorkOrders').findOne({ _id: legacy.released._id });
      const material = { ...wo.routing.materials[0], receiptId: receipt._id, materialTrace: { receiptId: receipt._id, lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber } };
      await withReplacement(h, 'manufacturingWorkOrders', wo, { ...wo, routing: { ...wo.routing, materials: [material] } }, () => denyNoEffects(h, `/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: wo.version, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'UN', evidence: reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
      const reservation = await h.db.collection('warehouseReservations').findOne({ _id: legacy.reservation._id });
      await withReplacement(h, 'warehouseReservations', reservation, { ...reservation, receiptId: receipt._id, materialTrace: material.materialTrace }, () => denyNoEffects(h, '/fulfillment/shipments', { salesOrderId: legacy.so._id, expectedVersion: legacy.so.version, lineIndex: 0, uom: 'UN', reference: reason, sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '1' }], idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    }, { manufacturingReservedQuantity: '1', reservedQuantity: '1' });
  });

  await t.test('independent typed origin remains a deny authority when marker and origin contents are malformed', async () => {
    const origin = await h.db.collection('warehouseReceiptOrigins').findOne({ receiptId: lotReceipt._id });
    await withReplacement(h, 'warehouseReceiptOrigins', origin, { ...origin, contentHash: '0'.repeat(64) }, async () => {
      const before = await domainSnapshot(h), view = await h.req(`${base}/receipts/${lotReceipt._id}`, undefined, h.alpha);
      assert.equal(view.status, 409); assert.equal(view.error.code, 'CATALOG_SOURCE_INVALID'); assert.deepEqual(await domainSnapshot(h), before);
      await forced(lotReceipt, 'QUARANTINED', row => denyNoEffects(h, `/warehouse/receipts/${row._id}/release`, { expectedVersion: row.version, reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
    });
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: lotReceipt._id });
    await withReplacement(h, 'warehouseReceipts', raw, { ...raw, catalogSource: null }, () => denyNoEffects(h, `/warehouse/receipts/${raw._id}/release`, { expectedVersion: raw.version, reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'));
  });

  await t.test('removing an origin and reducing its tally cannot hide an actual physical receipt or RECEIVE', async () => {
    const origin = await h.db.collection('warehouseReceiptOrigins').findOne({ receiptId: lotReceipt._id }), tally = await h.db.collection('catalogReceived').findOne({ purchaseOrderId: po._id, lineId: lotLine.lineId });
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: lotReceipt._id }), stripped = { ...raw }; delete stripped.catalogSource;
    await h.db.collection('warehouseReceiptOrigins').deleteOne({ _id: origin._id });
    await h.db.collection('catalogReceived').updateOne({ _id: tally._id }, { $set: { quantity: '1.25', receiptCount: 1 } });
    try {
      await withReplacement(h, 'warehouseReceipts', raw, stripped, async () => {
        await denyNoEffects(h, `${base}/orders/${po._id}`, undefined, 'CATALOG_SOURCE_INVALID');
        await denyNoEffects(h, `${base}/receipts`, receiveBody(po, lotLine, '1.25'), 'CATALOG_SOURCE_INVALID');
        await denyNoEffects(h, `/warehouse/receipts/${raw._id}/release`, { expectedVersion: raw.version, reason, idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED');
      });
    } finally {
      await h.db.collection('warehouseReceiptOrigins').insertOne(origin);
      await h.db.collection('catalogReceived').replaceOne({ _id: tally._id }, tally);
    }
  });

  await t.test('typed quarantine cannot conceal nonzero availability, reservation, consumption or shipment counters', async () => {
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: lotReceipt._id });
    for (const field of ['availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity']) {
      await withReplacement(h, 'warehouseReceipts', raw, { ...raw, [field]: '1' }, async () => {
        await denyNoEffects(h, `${base}/receipts/${raw._id}`, undefined, 'CATALOG_SOURCE_INVALID');
        await denyNoEffects(h, `${base}/orders/${po._id}`, undefined, 'CATALOG_SOURCE_INVALID');
      });
    }
  });

  await t.test('legacy source proof remains valid across version advances but missing or duplicate RECEIVE fails closed', async () => {
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: legacy.receipt._id }), receive = await h.db.collection('warehouseMovements').findOne({ receiptId: raw._id, kind: 'RECEIVE' });
    assert.ok(raw.version > receive.version); assert.deepEqual((await h.ok(`/warehouse/receipts/${raw._id}`)).receiptOrigin, { cohort: 'LEGACY', legacyEligible: true });
    const body = () => ({ expectedVersion: raw.version, countedQuantity: raw.availableQuantity, uom: raw.uom, reason, idempotencyKey: key() });
    await h.db.collection('warehouseMovements').deleteOne({ _id: receive._id });
    try { await denyNoEffects(h, `/warehouse/receipts/${raw._id}/count`, body(), 'RECEIPT_ORIGIN_INVALID'); }
    finally { await h.db.collection('warehouseMovements').insertOne(receive); }
    const extra = { ...receive, _id: key() }; await h.db.collection('warehouseMovements').insertOne(extra);
    try { await denyNoEffects(h, `/warehouse/receipts/${raw._id}/count`, body(), 'RECEIPT_ORIGIN_INVALID'); }
    finally { await h.db.collection('warehouseMovements').deleteOne({ _id: extra._id }); }
    await withReplacement(h, 'warehouseMovements', receive, { ...receive, quantity: '9.999999' }, () => denyNoEffects(h, `/warehouse/receipts/${raw._id}/count`, body(), 'RECEIPT_ORIGIN_INVALID'));
    await withReplacement(h, 'warehouseMovements', receive, { ...receive, catalogSource: null }, () => denyNoEffects(h, `/warehouse/receipts/${raw._id}/count`, body(), 'CATALOG_RECEIPT_UNSUPPORTED'));
    const collision = { ...await h.db.collection('catalogPurchaseOrders').findOne({ _id: po._id }), _id: legacy.po._id, requestId: key() };
    await h.db.collection('catalogPurchaseOrders').insertOne(collision);
    try { await denyNoEffects(h, '/warehouse/receipts', { purchaseOrderId: legacy.po._id, vendorId: legacy.vendor._id, expectedVersion: 2, lineIndex: 0, quantity: '1', uom: 'UN', idempotencyKey: key() }, 'CATALOG_RECEIPT_UNSUPPORTED'); }
    finally { await h.db.collection('catalogPurchaseOrders').deleteOne({ _id: collision._id }); }
  });

  await t.test('current master drift after issue blocks new intake without rewriting earlier physical history', async () => {
    await h.ok(`/inventory-master/items/${driftItem._id}/revisions`, { ...common(driftItem.version), description: 'Synthetic changed source revision', uom: 'UN', kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' });
    await denyNoEffects(h, `${base}/receipts`, receiveBody(driftPo, driftPo.content.lines[0], '1'), 'CATALOG_DEPENDENCY_CHANGED');
    const source = await h.ok(`/inventory-master/items/${lotItem._id}`);
    await h.ok(`/inventory-master/items/${lotItem._id}/deactivate`, common(source.version));
    const current = await h.ok(`${base}/receipts/${lotReceipt._id}`); assert.deepEqual(current.catalogSource, lotReceipt.catalogSource); assert.equal(current.usable, false); assert.ok(current.blockers.length);
    const before = await domainSnapshot(h); assert.deepEqual(await h.ok(`${base}/receipts`, retainedBody, 201), retainedReceipt); assert.deepEqual(await domainSnapshot(h), before);
  });

  await t.test('outbox failure rolls back receiving, source fences, registry, entitlement and durable receipt', async () => {
    const body = receiveBody(rollbackPo, rollbackPo.content.lines[0], '1', ['MAP-QA-ROLLBACK-SERIAL']), before = await domainSnapshot(h);
    await h.db.command({ collMod: 'catalogOutbox', validator: { qaForbidden: { $exists: true } }, validationLevel: 'strict' });
    try { const response = await h.req(`${base}/receipts`, body, h.alpha); assert.equal(response.status, 500); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.command({ collMod: 'catalogOutbox', validator: {} }); }
    const receipt = await freshReceive(body); assert.equal(receipt.quantity, '1');
  });

  await t.test('committing authorization revocation denies an acknowledged receipt replay before key lookup', async () => {
    const membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await domainSnapshot(h);
    try {
      const refused = await afterAuthorization(h, 'catalog.receive', async () => { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } }); }, () => h.req(`${base}/receipts`, retainedBody, h.alpha));
      assert.equal(refused.status, 403); assert.deepEqual(await domainSnapshot(h), before);
    } finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
    assert.deepEqual(await h.ok(`${base}/receipts`, retainedBody, 201), retainedReceipt); assert.deepEqual(await domainSnapshot(h), before);
  });

  await t.test('typed quarantine receiving changes no customer, legacy production or downstream entitlement', async () => {
    const committed = (await receivingKeys()).filter(row => !originalReceivingKeys.has(row.key));
    assert.deepEqual(committed.map(row => [row.key, row.result._id]), [...freshReceipts].sort(([left], [right]) => left.localeCompare(right)), 'Fence advances must match distinct actually committed receiving keys, not requests, retries or failures');
    const expected = structuredClone(baseline), vendor = expected.vendors.find(row => row._id === legacy.vendor._id);
    assert.ok(Number.isSafeInteger(vendor.catalogUseFence) && vendor.catalogUseFence >= 0);
    vendor.catalogUseFence += committed.length;
    assert.equal((await vendorAuthority()).catalogUseFence, vendor.catalogUseFence);
    assert.deepEqual(await forbidden(), expected);
    const receipts = await h.db.collection('warehouseReceipts').find({ catalogSource: { $exists: true } }).toArray();
    assert.ok(receipts.length >= 4); assert.ok(receipts.every(row => row.status === 'QUARANTINED' && row.availableQuantity === '0' && row.reservedQuantity === '0'));
    for (const row of receipts) {
      assert.equal(await h.db.collection('warehouseMovements').countDocuments({ receiptId: row._id, kind: { $ne: 'RECEIVE' } }), 0);
      for (const field of ['manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity']) assert.equal(row[field] || '0', '0');
    }
  });
});
