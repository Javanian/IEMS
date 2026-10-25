import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('independent K1 historical attribution, holds and first-shipment correction ordering', async t => {
  const h = await startOwned(t), key = () => randomUUID();
  const account = await h.ok('/crm/accounts', { name: 'Synthetic independent K1 customer' }, 201);
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic K1 output', quantity: '2', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] };
  const quote = await h.ok('/commercial/quotes', { ...content, accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await h.ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await h.ok('/procurement/vendors', { name: 'Synthetic independent K1 vendor' }, 201);
  const pr = await h.ok('/procurement/requests', { ...content, vendorId: vendor._id }, 201);
  await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await h.ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '2', uom: 'UN', lotNumber: 'K1-QA-LOT', heatNumber: 'K1-QA-HEAT', idempotencyKey: key() }, 201);
  await h.ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic K1 QA release', idempotencyKey: key() });
  await h.ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'K1-QA-BIN', idempotencyKey: key() });
  const planned = await h.ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, quantities: ['2'], uom: 'UN', serialized: true, genealogyRequired: true, idempotencyKey: key() }, 201);
  const wo = planned.workOrders[0], serials = [`K1-QA-${key()}`, `K1-QA-${key()}`];
  await h.ok(`/manufacturing/work-orders/${wo._id}/release`, { expectedVersion: 1, operations: [{ code: 'K1-QA-OP', instruction: 'Synthetic K1 operation' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'UN' }], idempotencyKey: key() });
  await h.ok(`/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '2', goodQuantity: '2', scrapQuantity: '0', uom: 'UN', evidence: 'Synthetic K1 output evidence', outputSerials: serials, idempotencyKey: key() });
  await h.ok(`/manufacturing/work-orders/${wo._id}/qc`, { expectedVersion: 3, acceptedQuantity: '2', rejectedQuantity: '0', uom: 'UN', evidence: 'Synthetic K1 QC evidence', acceptedSerials: serials, rejectedSerials: [], idempotencyKey: key() });
  const units = await h.db.collection('manufacturingOutputUnits').find({ workOrderId: wo._id }).sort({ serial: 1 }).toArray();
  assert.equal(units.length, 2);
  const base = `/manufacturing/work-orders/${wo._id}/genealogy`;
  const view = () => h.ok(base);
  const versioned = current => ({ expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, reason: 'Synthetic independent K1 reason', idempotencyKey: key() });
  const allocation = (current, unit, quantity = '1') => ({ ...versioned(current), outputUnitId: unit._id, materials: [{ receiptId: receipt._id, quantity, uom: 'UN' }] });
  const finalize = current => h.ok(`${base}/finalize`, versioned(current));
  const shipment = (serial, idempotencyKey = key()) => ({ salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', reference: 'K1-QA-SHIP', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: '1', serials: [serial] }], idempotencyKey });
  const domainSnapshot = async () => {
    const auth = new Set(['sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'ownedRun']);
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !auth.has(name)).sort();
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const stockSnapshot = async () => {
    const row = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const fields = ['quantity', 'availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity'];
    return { counters: Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])), consumed: await h.db.collection('manufacturingMovements').find({ receiptId: receipt._id, kind: 'MATERIAL_CONSUMED' }).sort({ _id: 1 }).toArray() };
  };
  const originalStock = await stockSnapshot();
  assert.equal(originalStock.consumed.length, 1);
  const assertStock = async () => assert.deepEqual(await stockSnapshot(), originalStock);
  const applyHold = async () => {
    const row = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const response = await h.send(`/warehouse/receipts/${receipt._id}/holds`, { headers: { 'Idempotency-Key': key() }, body: { reasonCode: 'QC_SUSPECT', reasonNote: 'Synthetic independent K1 hold', expectedReceiptVersion: row.version } });
    assert.equal(response.status, 201, JSON.stringify(response)); return response.data.hold;
  };
  const releaseHold = async hold => {
    const response = await h.send(`/warehouse/holds/${hold.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic independent K1 release', expectedVersion: hold.version } });
    assert.equal(response.status, 200, JSON.stringify(response));
  };
  // An actual nested same-plant HTTP command must run before the outer guard:
  // its tenant/plant fence would otherwise wait for the outer transaction.
  const afterAuthorization = async (action, intervention, command) => {
    const original = h.runtime.foundation; let reached = 0;
    h.runtime.foundation = { ...original, authorize: async (...args) => {
      const result = await original.authorize(...args);
      if (args[1]?.action === action && reached === 0) { reached++; await intervention(); }
      return result;
    } };
    try { const result = await command(); assert.equal(reached, 1); return result; }
    finally { h.runtime.foundation = original; }
  };

  await t.test('malformed inactive hold cache permits truthful attribution but blocks fresh finalization', async () => {
    const before = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    await h.db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, { $set: { hold: { active: false } } });
    try {
      for (const unit of units) await h.ok(`${base}/allocations`, allocation(await view(), unit));
      const current = await view();
      const blocked = current.sourceHolds.find(source => source.receiptId === receipt._id);
      assert.ok(blocked); assert.equal(blocked.legacy, true); assert.ok(blocked.reasonCodes.includes('INVALID_HOLD_CACHE'));
      assert.equal(current.canFinalize, false);
      const snapshot = await domainSnapshot();
      const response = await h.req(`${base}/finalize`, versioned(current), h.alpha);
      assert.equal(response.status, 409); assert.equal(response.error.code, 'STOCK_ENCUMBERED');
      assert.deepEqual(await domainSnapshot(), snapshot);
      await assertStock();
    } finally {
      await h.db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, Object.hasOwn(before, 'hold') ? { $set: { hold: before.hold } } : { $unset: { hold: '' } });
    }
  });

  await t.test('hold committed after middleware authorization blocks fresh finalize without genealogy effects', async () => {
    const body = versioned(await view()); let hold, afterHold;
    const response = await afterAuthorization('genealogy.finalize', async () => { hold = await applyHold(); afterHold = await domainSnapshot(); }, () => h.req(`${base}/finalize`, body, h.alpha));
    try {
      assert.equal(response.status, 409); assert.equal(response.error.code, 'STOCK_ENCUMBERED');
      assert.deepEqual(await domainSnapshot(), afterHold);
      const current = await view();
      assert.equal(current.canFinalize, false); assert.ok(current.sourceHolds.some(source => source.holdIds.includes(hold.id)));
      // Attribution remains allowed after a valid later source hold, with no stock consumption.
      await h.ok(`${base}/allocations`, allocation(current, units[0]));
      await assertStock();
    } finally { if (hold) await releaseHold(hold); }
    const complete = await finalize(await view()); assert.equal(complete.status, 'COMPLETE');
  });

  await t.test('a correction committed before the first shipment invalidates completion atomically', async () => {
    const correction = allocation(await view(), units[0], '0.5'); let afterCorrection;
    const response = await afterAuthorization('fulfillment.ship', async () => { const changed = await h.ok(`${base}/allocations`, correction); assert.equal(changed.status, 'DRAFT'); afterCorrection = await domainSnapshot(); }, () => h.req('/fulfillment/shipments', shipment(units[0].serial), h.alpha));
    assert.equal(response.status, 409, JSON.stringify(response));
    assert.deepEqual(await domainSnapshot(), afterCorrection);
    assert.equal((await h.db.collection('manufacturingOutputUnits').findOne({ _id: units[0]._id })).status, 'ACCEPTED');
    await assertStock();
    await h.ok(`${base}/allocations`, allocation(await view(), units[0]));
    await finalize(await view());
  });

  await t.test('a hold committed after finalization blocks the first shipment before any freeze effect', async () => {
    let hold, afterHold;
    const response = await afterAuthorization('fulfillment.ship', async () => { hold = await applyHold(); afterHold = await domainSnapshot(); }, () => h.req('/fulfillment/shipments', shipment(units[0].serial), h.alpha));
    try {
      assert.equal(response.status, 409); assert.equal(response.error.code, 'STOCK_ENCUMBERED');
      assert.deepEqual(await domainSnapshot(), afterHold);
      const current = await view(); assert.equal(current.status, 'COMPLETE'); assert.equal(current.frozen, null);
      assert.equal((await h.db.collection('manufacturingOutputUnits').findOne({ _id: units[0]._id })).status, 'ACCEPTED');
      await assertStock();
    } finally { if (hold) await releaseHold(hold); }
  });

  let firstBody, firstShipment, frozenPointer, immutable;
  await t.test('first shipment committed before a correction freezes the whole WO without orphan correction', async () => {
    const current = await view(), correction = allocation(current, units[1], '0.5'); let afterShipment;
    firstBody = shipment(units[0].serial);
    const response = await afterAuthorization('genealogy.record', async () => { firstShipment = await h.ok('/fulfillment/shipments', firstBody, 201); afterShipment = await domainSnapshot(); }, () => h.req(`${base}/allocations`, correction, h.alpha));
    assert.equal(response.status, 409, JSON.stringify(response));
    assert.ok(['GENEALOGY_FROZEN', 'VERSION_CONFLICT', 'GENEALOGY_VERSION_CONFLICT'].includes(response.error.code));
    assert.deepEqual(await domainSnapshot(), afterShipment);
    const frozen = await view(); assert.equal(frozen.status, 'FROZEN');
    frozenPointer = firstShipment.sources[0].genealogy;
    assert.deepEqual(frozenPointer, { workOrderId: wo._id, revision: frozen.frozen.revision, contentHash: frozen.frozen.contentHash });
    assert.equal(frozen.frozen.firstShipmentId, firstShipment._id);
    assert.deepEqual((await h.db.collection('manufacturingOutputUnits').findOne({ _id: units[0]._id })).genealogy, frozenPointer);
    const movement = await h.db.collection('warehouseMovements').findOne({ shipmentId: firstShipment._id });
    assert.deepEqual(movement.genealogy, frozenPointer);
    immutable = await h.ok(`${base}/revisions/${frozenPointer.revision}`);
    await assertStock();
  });

  await t.test('frozen later shipment rechecks source holds while exact replay retains original pointer', async () => {
    let hold, afterHold;
    const response = await afterAuthorization('fulfillment.ship', async () => { hold = await applyHold(); afterHold = await domainSnapshot(); }, () => h.req('/fulfillment/shipments', shipment(units[1].serial), h.alpha));
    try {
      assert.equal(response.status, 409); assert.equal(response.error.code, 'STOCK_ENCUMBERED');
      assert.deepEqual(await domainSnapshot(), afterHold);
      assert.deepEqual(await h.ok('/fulfillment/shipments', firstBody, 201), firstShipment);
      assert.deepEqual(await domainSnapshot(), afterHold);
      assert.deepEqual(await h.ok(`${base}/revisions/${frozenPointer.revision}`), immutable);
      assert.ok((await view()).sourceHolds.some(source => source.holdIds.includes(hold.id)));
      await assertStock();
    } finally { if (hold) await releaseHold(hold); }
    const second = await h.ok('/fulfillment/shipments', shipment(units[1].serial), 201);
    assert.deepEqual(second.sources[0].genealogy, frozenPointer);
    assert.deepEqual((await h.db.collection('manufacturingOutputUnits').findOne({ _id: units[1]._id })).genealogy, frozenPointer);
    assert.deepEqual(await h.ok(`${base}/revisions/${frozenPointer.revision}`), immutable);
    await assertStock();
  });
});
