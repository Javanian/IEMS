import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fixtureModule from '../../../packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js';
import { startOwned } from './support/owned-mongo.mjs';

const { e01ManufacturingFixture: fixture } = fixtureModule;
const key = () => randomUUID();
const command = values => ({ expectedVersion: 1, idempotencyKey: key(), ...values });
const canonicalMaterials = fixture.procurement.goods_receipt.lines.map((line, index) => ({ code: line.item_code, lotNumber: line.lot_number, heatNumber: line.heat_number, ratio: fixture.engineering_package.bom.components[index].qty_per_parent, uom: line.uom }));

async function flow(h, { quantities = ['6', '4'], materials = canonicalMaterials, goodQuantities = quantities, prefix = key().slice(0, 8) } = {}) {
  const ok = h.ok, total = quantities.reduce((n, q) => n + Number(q), 0);
  const account = await ok('/crm/accounts', { name: `Synthetic genealogy ${prefix}` }, 201);
  const quote = await ok('/commercial/quotes', { accountId: account._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', expiresAt: '2027-01-01T00:00:00.000Z', lines: [{ description: fixture.item_code, quantity: String(total), uom: 'UN', unitPrice: '12250.00', currency: 'USD' }] }, 201);
  await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await ok('/procurement/vendors', { name: `Synthetic source ${prefix}` }, 201);
  const lines = materials.map(m => ({ description: m.code, quantity: String(total * Number(m.ratio)), uom: m.uom, unitPrice: '1.00', currency: 'USD' }));
  const pr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines }, 201);
  await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipts = [];
  for (let index = 0; index < materials.length; index++) {
    const material = materials[index];
    const receipt = await ok('/warehouse/receipts', command({ expectedVersion: 2, purchaseOrderId: po._id, vendorId: vendor._id, lineIndex: index, quantity: lines[index].quantity, uom: material.uom, lotNumber: material.lotNumber, heatNumber: material.heatNumber }), 201);
    await ok(`/warehouse/receipts/${receipt._id}/release`, command({ reason: 'Synthetic inspection' }));
    await ok(`/warehouse/receipts/${receipt._id}/putaway`, command({ expectedVersion: 2, location: 'GENEALOGY-BIN' }));
    receipts.push(receipt);
  }
  const workOrders = (await ok('/manufacturing/work-orders', command({ expectedVersion: so.version, salesOrderId: so._id, lineIndex: 0, quantities, uom: 'UN', serialized: true, genealogyRequired: true }), 201)).workOrders;
  const units = [];
  for (let index = 0; index < workOrders.length; index++) {
    const wo = workOrders[index], path = `/manufacturing/work-orders/${wo._id}`, good = goodQuantities[index], serials = Array.from({ length: Number(good) }, (_, n) => `${prefix}_${index}_${n}`);
    await ok(`${path}/release`, command({ operations: [{ code: 'ASSEMBLE', instruction: 'Synthetic assembly record' }], materials: receipts.map((r, i) => ({ receiptId: r._id, quantityPerUnit: materials[i].ratio, uom: materials[i].uom })) }));
    await ok(`${path}/record`, command({ expectedVersion: 2, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: good, scrapQuantity: String(Number(wo.quantity) - Number(good)), uom: 'UN', evidence: 'Synthetic assembly evidence', outputSerials: serials }));
    await ok(`${path}/qc`, command({ expectedVersion: 3, acceptedQuantity: good, rejectedQuantity: '0', uom: 'UN', evidence: 'Synthetic QC entry', acceptedSerials: serials, rejectedSerials: [] }));
    units.push(await ok(`${path}/output-units`));
  }
  return { so, account, receipts, materials, workOrders, units };
}

test('K1 ten real outputs, canonical five lot ratios, immutable corrections, holds and frozen dispatch', async t => {
  const h = await startOwned(t), data = await flow(h), base = wo => `/manufacturing/work-orders/${wo._id}/genealogy`;
  const get = wo => h.ok(base(wo));
  const mutation = async (wo, action, values = {}) => {
    const current = await get(wo), body = { expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, reason: 'Synthetic source attribution', idempotencyKey: key(), ...values };
    return { body, response: await h.req(`${base(wo)}/${action}`, body, h.alpha) };
  };
  const materialsFor = () => data.receipts.map((r, i) => ({ receiptId: r._id, quantity: data.materials[i].ratio, uom: data.materials[i].uom }));
  const collections = ['manufacturingWorkOrders', 'manufacturingOutputUnits', 'manufacturingAudit', 'manufacturingOutbox', 'manufacturingKeys', 'genealogyHeads', 'genealogyRevisions', 'genealogyAllocations', 'genealogyBalances', 'genealogyAttributionLedger', 'warehouseReceipts', 'warehouseMovements', 'manufacturingMovements', 'fulfillmentShipments', 'fulfillmentTallies', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox'];
  const snapshot = () => Promise.all(collections.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  const stock = async () => (await h.db.collection('warehouseReceipts').find({ _id: { $in: data.receipts.map(r => r._id) } }).sort({ _id: 1 }).toArray()).map(r => Object.fromEntries(['_id', 'availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity'].map(k => [k, r[k]])));
  const originalStock = await stock(), consumedCount = await h.db.collection('manufacturingMovements').countDocuments({ kind: 'MATERIAL_CONSUMED' });
  const wo = data.workOrders[0], unit = data.units[0][0];
  await t.test('honest empty view and strict per-unit source/quantity/scope guards', async () => {
    const initial = await get(wo);
    assert.equal(initial.version, 0); assert.equal(initial.status, 'UNRECORDED'); assert.equal(initial.sources.length, 5); assert.equal(initial.incompleteUnits.length, 30);
    const before = await snapshot();
    const cases = [
      { outputUnitId: unit._id, materials: [{ ...materialsFor()[0], quantity: '2' }] },
      { outputUnitId: unit._id, materials: [{ ...materialsFor()[0], quantity: '0.0000001' }] },
      { outputUnitId: unit._id, materials: [{ ...materialsFor()[0], uom: 'KG' }] },
      { outputUnitId: unit._id, materials: [{ ...materialsFor()[0], receiptId: randomUUID() }] },
      { outputUnitId: data.units[1][0]._id, materials: materialsFor() },
      { outputUnitId: unit._id, materials: [materialsFor()[0], materialsFor()[0]] },
      { outputUnitId: unit._id, materials: materialsFor(), materialTrace: { lotNumber: 'FAKE' } },
    ];
    for (const values of cases) { const { response } = await mutation(wo, 'allocations', values); assert.ok([400, 404, 409].includes(response.status), JSON.stringify(response)); }
    assert.equal((await h.req(base(wo), undefined, h.beta)).status, 404);
    assert.deepEqual(await snapshot(), before);
    const movement = await h.db.collection('manufacturingMovements').findOne({ workOrderId: wo._id, receiptId: data.receipts[0]._id, kind: 'MATERIAL_CONSUMED' });
    await h.db.collection('manufacturingMovements').updateOne({ _id: movement._id }, { $set: { materialTrace: {} } });
    try {
      assert.equal((await h.req(base(wo), undefined, h.alpha)).error.code, 'GENEALOGY_SOURCE_INVALID');
      assert.equal((await h.req(`${base(wo)}/allocations`, { expectedVersion: initial.workOrderVersion, expectedGenealogyVersion: 0, outputUnitId: unit._id, materials: materialsFor(), reason: 'Reject changed consumption source', idempotencyKey: key() }, h.alpha)).error.code, 'GENEALOGY_SOURCE_INVALID');
    }
    finally { await h.db.collection('manufacturingMovements').updateOne({ _id: movement._id }, { $set: { materialTrace: movement.materialTrace } }); }
    assert.deepEqual(await snapshot(), before);
  });
  let firstBody, firstResult;
  await t.test('attribution is transactional, replayed exactly and version-fenced', async () => {
    const before = await snapshot();
    await h.db.command({ collMod: 'manufacturingOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await mutation(wo, 'allocations', { outputUnitId: unit._id, materials: materialsFor() })).response.status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: 'manufacturingOutbox', validator: {} }); }
    const recorded = await mutation(wo, 'allocations', { outputUnitId: unit._id, materials: materialsFor() });
    assert.equal(recorded.response.status, 200, JSON.stringify(recorded.response)); firstBody = recorded.body; firstResult = recorded.response.data;
    assert.equal(firstResult.version, 1); assert.equal(firstResult.workOrderVersion, 5); assert.equal(firstResult.allocations.length, 5);
    assert.deepEqual((await h.req(`${base(wo)}/allocations`, firstBody, h.alpha)).data, firstResult);
    assert.equal((await h.req(`${base(wo)}/allocations`, { ...firstBody, reason: 'Changed reason' }, h.alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await h.req(`${base(wo)}/allocations`, { ...firstBody, idempotencyKey: key() }, h.alpha)).error.code, 'VERSION_CONFLICT');
    const current = await get(wo);
    assert.equal((await h.req(`${base(wo)}/allocations`, { ...firstBody, expectedVersion: current.workOrderVersion, idempotencyKey: key() }, h.alpha)).error.code, 'GENEALOGY_VERSION_CONFLICT');
    assert.equal((await mutation(wo, 'finalize')).response.error.code, 'GENEALOGY_INCOMPLETE');
  });
  await t.test('correction replaces effective budget and immutable revisions preserve earlier evidence', async () => {
    const original = await h.ok(`${base(wo)}/revisions/1`);
    assert.equal((await mutation(wo, 'allocations', { outputUnitId: unit._id, materials: [] })).response.status, 200);
    assert.equal((await get(wo)).allocations.length, 0);
    assert.equal((await mutation(wo, 'allocations', { outputUnitId: unit._id, materials: materialsFor() })).response.status, 200);
    assert.deepEqual(await h.ok(`${base(wo)}/revisions/1`), original);
    const current = await get(wo), body = { expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, reason: 'Concurrent operator correction', outputUnitId: data.units[0][1]._id, materials: materialsFor() };
    const races = await Promise.all([1, 2].map(() => h.req(`${base(wo)}/allocations`, { ...body, idempotencyKey: key() }, h.alpha)));
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
    const rows = await h.db.collection('genealogyAllocations').find({ workOrderId: wo._id, outputUnitId: unit._id }).toArray();
    assert.equal(rows.length, 5);
  });
  await t.test('every canonical unit receives exactly five explicit sources and reverse lookup paginates effective rows', async () => {
    for (let i = 0; i < data.workOrders.length; i++) for (const output of data.units[i]) {
      const result = await mutation(data.workOrders[i], 'allocations', { outputUnitId: output._id, materials: materialsFor() }); assert.equal(result.response.status, 200, JSON.stringify(result.response));
    }
    for (const workOrder of data.workOrders) { const current = await get(workOrder); assert.equal(current.canFinalize, true); assert.equal(current.incompleteUnits.length, 0); assert.ok(current.balances.every(b => b.remainingQuantity === '0')); }
    let cursor, rows = [];
    do { const page = await h.req(`/manufacturing/genealogy/receipts/${data.receipts[0]._id}?limit=3${cursor ? `&cursor=${cursor}` : ''}`, undefined, h.alpha); assert.equal(page.status, 200); rows.push(...page.data); cursor = page.page.nextCursor; } while (cursor);
    assert.equal(rows.length, 10); assert.equal(new Set(rows.map(r => r._id)).size, 10); assert.ok(rows.every(r => r.materialTrace.lotNumber === canonicalMaterials[0].lotNumber));
    assert.equal((await h.req(`/manufacturing/genealogy/receipts/${data.receipts[0]._id}`, undefined, h.beta)).status, 404);
    const revisionPage = await h.req(`${base(wo)}/revisions?limit=2`, undefined, h.alpha); assert.equal(revisionPage.data.length, 2); assert.ok(revisionPage.page.nextCursor);
    assert.ok(revisionPage.data.every(r => !Object.hasOwn(r, 'allocations')));
  });
  await t.test('correction versus finalization uses a single current version and never loses an accepted correction', async () => {
    const second = data.workOrders[1], current = await get(second), shared = { expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, reason: 'Concurrent correction and finalize', idempotencyKey: key() };
    const results = await Promise.all([
      h.req(`${base(second)}/finalize`, shared, h.alpha),
      h.req(`${base(second)}/allocations`, { ...shared, idempotencyKey: key(), outputUnitId: data.units[1][0]._id, materials: materialsFor() }, h.alpha),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409], JSON.stringify(results));
    const after = await get(second);
    assert.equal(after.currentRevision, current.currentRevision + 1);
    assert.equal(after.allocations.length, 20);
    if (after.status === 'COMPLETE') assert.equal((await mutation(second, 'allocations', { outputUnitId: data.units[1][0]._id, materials: materialsFor() })).response.status, 200);
  });
  const applyHold = async receipt => {
    const stored = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const result = await h.send(`/warehouse/receipts/${receipt._id}/holds`, { body: { expectedReceiptVersion: stored.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Synthetic late quality concern' }, headers: { 'Idempotency-Key': key() } });
    assert.equal(result.status, 201, JSON.stringify(result)); return result.data.hold;
  };
  const releaseHold = async hold => { const result = await h.send(`/warehouse/holds/${hold.id}/release`, { body: { expectedVersion: hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic approved release' }, headers: { 'Idempotency-Key': key() } }); assert.equal(result.status, 200, JSON.stringify(result)); };
  await t.test('late holds preserve attribution but block fresh finalization, malformed caches fail closed', async () => {
    const hold = await applyHold(data.receipts[0]);
    const current = await get(wo); assert.equal(current.sourceHolds[0].receiptId, data.receipts[0]._id); assert.equal(current.canFinalize, false);
    assert.equal((await mutation(wo, 'allocations', { outputUnitId: unit._id, materials: materialsFor() })).response.status, 200);
    assert.equal((await mutation(wo, 'finalize')).response.error.code, 'STOCK_ENCUMBERED');
    await releaseHold(hold);
    const saved = await h.db.collection('warehouseReceipts').findOne({ _id: data.receipts[0]._id });
    await h.db.collection('warehouseReceipts').updateOne({ _id: saved._id }, { $set: { hold: { active: false } } });
    try {
      assert.deepEqual((await get(wo)).sourceHolds[0].reasonCodes, ['INVALID_HOLD_CACHE']);
      assert.equal((await get(wo)).sourceHolds[0].legacy, true);
      assert.equal((await mutation(wo, 'allocations', { outputUnitId: unit._id, materials: materialsFor() })).response.status, 200);
      assert.equal((await mutation(wo, 'finalize')).response.error.code, 'STOCK_ENCUMBERED');
    } finally { await h.db.collection('warehouseReceipts').updateOne({ _id: saved._id }, { $set: { hold: saved.hold } }); }
    const finalized = await mutation(wo, 'finalize'); assert.equal(finalized.response.status, 200, JSON.stringify(finalized.response));
    const later = await applyHold(data.receipts[0]);
    assert.deepEqual((await h.req(`${base(wo)}/finalize`, finalized.body, h.alpha)).data, finalized.response.data);
    await releaseHold(later);
  });
  await t.test('role separation and revoked fresh/replay attempts preserve all business state', async () => {
    const restore = await h.setRoles(h.seeded[0], ['manufacturingRead']);
    try { assert.equal((await h.req(base(wo), undefined, h.alpha)).status, 403); } finally { await restore(); }
    const readerRestore = await h.setRoles(h.seeded[0], ['genealogyReader']);
    const before = await snapshot();
    try {
      assert.equal((await get(wo)).required, true);
      assert.equal((await h.req(`${base(wo)}/allocations`, firstBody, h.alpha)).status, 403);
      assert.equal((await h.req(`${base(wo)}/allocations`, { ...firstBody, idempotencyKey: key() }, h.alpha)).status, 403);
    } finally { await readerRestore(); }
    assert.deepEqual(await snapshot(), before);
    const second = data.workOrders[1], finalizeRestore = await h.setRoles(h.seeded[0], ['genealogyRecorder']);
    try { assert.equal((await mutation(second, 'finalize')).response.status, 403); } finally { await finalizeRestore(); }
    const foundation = h.runtime.foundation, member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId });
    for (const body of [firstBody, { ...firstBody, idempotencyKey: key() }]) {
      h.runtime.foundation = { ...foundation, authorize: async (...args) => { const allowed = await foundation.authorize(...args); await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'genealogyReader', plantIds: member.plantIds }] } }); return allowed; } };
      try { assert.equal((await h.req(`${base(wo)}/allocations`, body, h.alpha)).status, 403); }
      finally { h.runtime.foundation = foundation; await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('first partial shipment freezes the whole WO and later source holds block its remaining units', async () => {
    const finalizeSecond = await mutation(data.workOrders[1], 'finalize'); assert.equal(finalizeSecond.response.status, 200, JSON.stringify(finalizeSecond.response));
    const ship = (workOrder, selected) => ({ salesOrderId: data.so._id, expectedVersion: data.so.version, lineIndex: 0, uom: 'UN', reference: 'Synthetic genealogy dispatch', sources: [{ sourceType: 'WORK_ORDER', sourceId: workOrder._id, quantity: String(selected.length), serials: selected.map(u => u.serial) }], idempotencyKey: key() });
    const initialRevision = (await get(wo)).currentRevision, firstBody = ship(wo, data.units[0].slice(0, 2)), first = await h.ok('/fulfillment/shipments', firstBody, 201);
    const pointer = first.sources[0].genealogy; assert.equal(pointer.revision, initialRevision); assert.equal(pointer.workOrderId, wo._id);
    assert.equal((await get(wo)).status, 'FROZEN');
    const rejected = await mutation(wo, 'allocations', { outputUnitId: data.units[0][5]._id, materials: [] }); assert.equal(rejected.response.error.code, 'GENEALOGY_FROZEN');
    const hold = await applyHold(data.receipts[0]), secondBody = ship(wo, data.units[0].slice(2));
    assert.equal((await h.req('/fulfillment/shipments', secondBody, h.alpha)).error.code, 'STOCK_ENCUMBERED');
    assert.deepEqual((await h.req('/fulfillment/shipments', firstBody, h.alpha)).data, first);
    await releaseHold(hold);
    const rest = await h.ok('/fulfillment/shipments', secondBody, 201); assert.deepEqual(rest.sources[0].genealogy, pointer);
    const last = await h.ok('/fulfillment/shipments', ship(data.workOrders[1], data.units[1]), 201); assert.equal(last.quantity, '4');
    const persisted = await h.db.collection('manufacturingOutputUnits').find({ workOrderId: wo._id }).toArray();
    assert.ok(persisted.every(u => u.status === 'SHIPPED' && u.genealogy.contentHash === pointer.contentHash));
    assert.deepEqual(await stock(), originalStock); assert.equal(await h.db.collection('manufacturingMovements').countDocuments({ kind: 'MATERIAL_CONSUMED' }), consumedCount);
  });
});

test('K1 explicit process losses reconcile scrap and zero-good without synthetic output units', async t => {
  const h = await startOwned(t), data = await flow(h, { quantities: ['2', '1'], goodQuantities: ['1', '0'], materials: [canonicalMaterials[3]] });
  for (let index = 0; index < data.workOrders.length; index++) {
    const wo = data.workOrders[index], base = `/manufacturing/work-orders/${wo._id}/genealogy`, get = () => h.ok(base);
    const mutate = async (action, payload) => { const current = await get(); return h.req(`${base}/${action}`, { expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, reason: 'Explicit process scrap disposition', idempotencyKey: key(), ...payload }, h.alpha); };
    if (index === 0) {
      assert.equal((await mutate('allocations', { outputUnitId: data.units[index][0]._id, materials: [{ receiptId: data.receipts[0]._id, quantity: '2', uom: 'UN' }] })).status, 200);
      assert.equal((await mutate('finalize', {})).error.code, 'GENEALOGY_INCOMPLETE');
    }
    assert.equal((await mutate('losses', { losses: [{ receiptId: data.receipts[0]._id, quantity: '99', uom: 'UN', reason: 'Excess impossible scrap' }] })).error.code, 'GENEALOGY_QUANTITY_CONFLICT');
    const recorded = await mutate('losses', { losses: [{ receiptId: data.receipts[0]._id, quantity: '2', uom: 'UN', reason: 'Synthetic operation scrap' }] }); assert.equal(recorded.status, 200, JSON.stringify(recorded));
    const finalized = await mutate('finalize', {}); assert.equal(finalized.status, 200, JSON.stringify(finalized)); assert.equal(finalized.data.status, 'COMPLETE'); assert.equal(finalized.data.balances[0].remainingQuantity, '0');
    assert.equal(finalized.data.units.length, index === 0 ? 1 : 0);
  }
});
