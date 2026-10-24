import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

const key = () => randomUUID(), command = values => ({ expectedVersion: 1, reason: 'Supplemental internal planning evidence', idempotencyKey: key(), ...values });
const items = '/inventory-master/items', locations = '/inventory-master/locations', orders = '/internal-production/orders';

test('K2b2a real item/location authority and internal approved demand have no execution or customer/stock effects', async t => {
  const h = await startOwned(t), ok = h.ok, post = (path, body, cookie = h.alpha) => h.req(path, body, cookie);
  await orderWithStock(h, { orderQuantity: '2', receiptQuantity: '4', reserve: null });
  const bin = await ok('/warehouse/bins', { expectedVersion: 1, code: 'REAL-COMPANY-BIN', idempotencyKey: key() }, 201);
  const legacyNames = ['accounts', 'quotes', 'salesOrders', 'vendors', 'purchaseRequests', 'purchaseOrders', 'manufacturingWorkOrders', 'manufacturingAllocated', 'manufacturingOutputUnits', 'manufacturingMovements', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox', 'warehouseReceipts', 'warehouseReservations', 'warehouseMovements', 'warehouseSerials', 'warehouseKeys', 'warehouseAudit', 'warehouseOutbox', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentTallies', 'fulfillmentKeys', 'serialCustodyUnits', 'serialCustodyClaims', 'componentInstallationLinks'];
  const negative = () => Promise.all(legacyNames.map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray())), beforeLegacy = await negative();
  const ownNames = ['inventoryItems', 'inventoryItemRevisions', 'companyLocations', 'internalProductionOrders', 'internalEngineeringRevisions', 'internalEngineeringLineIds', 'internalPlanningEvents', 'internalPlanningAudit', 'internalPlanningOutbox', 'internalPlanningKeys', 'warehouseBins'];
  const snapshot = () => Promise.all(ownNames.map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray()));
  let output, materialA, materialB, location, plan, originalCreate;
  const createItem = async (code, kind, uom = 'UN') => {
    const created = await ok(items, command({ code, description: `Supplemental ${code}`, kind, uom }), 201), immutable = await ok(`${items}/${created._id}/revisions/1`);
    const approved = await ok(`${items}/${created._id}/approve`, command({ expectedVersion: created.version, revision: 1 })); assert.deepEqual(await ok(`${items}/${created._id}/revisions/1`), immutable); return approved;
  };
  await t.test('canonical master codes and derived owners require real approvals and bin qualification', async () => {
    const before = await snapshot();
    assert.equal((await post(items, command({ code: 'lowercase', description: 'Bad code', kind: 'MANUFACTURED', uom: 'UN' }))).status, 400);
    assert.equal((await post(items, command({ code: 'FORGED_OWNER', description: 'Bad owner', kind: 'MANUFACTURED', uom: 'UN', ownerLegalEntityId: key() }))).status, 400);
    assert.deepEqual(await snapshot(), before);
    output = await createItem('INTERNAL_ASSEMBLY', 'MANUFACTURED'); materialA = await createItem('INTERNAL_MATERIAL_A', 'PURCHASED'); materialB = await createItem('INTERNAL_MATERIAL_B', 'PURCHASED', 'SET');
    const draft = await ok(locations, command({ code: 'QUALIFIED_COMPANY', binId: bin._id }), 201); assert.equal(draft.status, 'DRAFT'); assert.equal(draft.binSnapshot._id, bin._id);
    location = await ok(`${locations}/${draft._id}/qualify`, command({ expectedVersion: draft.version })); assert.equal(location.status, 'QUALIFIED');
    const plant = await h.db.collection('plants').findOne({ _id: h.seeded[0].plantId }); assert.equal(output.ownerLegalEntityId, plant.legalEntityId); assert.equal(location.ownerLegalEntityId, plant.legalEntityId);
    assert.ok((await h.db.collection('warehouseBins').findOne({ _id: bin._id })).internalPlanningUseFence >= 2);
  });
  const createBody = () => command({ itemId: output._id, itemRevision: output.currentRevision, expectedItemVersion: output.version, locationId: location._id, expectedLocationVersion: location.version, quantity: '3' });
  await t.test('planning only uses exact approved manufactured output and qualified owned location, with rollback and replay', async () => {
    const before = await snapshot();
    for (const patch of [{ quantity: '0' }, { quantity: '1.5' }, { quantity: '101' }, { accountId: key() }]) assert.equal((await post(orders, { ...createBody(), ...patch })).status, 400);
    assert.equal((await post(orders, { ...createBody(), itemId: materialA._id, itemRevision: materialA.currentRevision, expectedItemVersion: materialA.version })).error.code, 'MASTER_NOT_APPROVED');
    assert.deepEqual(await snapshot(), before);
    await h.db.command({ collMod: 'internalPlanningOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post(orders, createBody())).status, 500); assert.deepEqual(await snapshot(), before); } finally { await h.db.command({ collMod: 'internalPlanningOutbox', validator: {} }); }
    originalCreate = createBody(); plan = await ok(orders, originalCreate, 201);
    assert.equal(plan.status, 'PLANNED'); assert.equal(plan.purpose, 'INTERNAL_STOCK'); assert.equal(plan.schema, 'INTERNAL_PLAN_V1'); assert.equal(plan.execution, 'NOT_IMPLEMENTED'); assert.equal(plan.canExecute, false); assert.equal(plan.planningReady, false);
    assert.deepEqual((await post(orders, originalCreate)).data, plan);
    assert.equal((await post(orders, { ...originalCreate, quantity: '4' })).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await post(`${orders}/${plan._id}/record`, command())).status, 404);
  });
  const engineeringBody = (version, includeA = true) => command({ expectedVersion: version, operations: [{ code: 'ASSEMBLE', instruction: 'Plan assembly, no machine execution' }], materials: [...(includeA ? [{ itemId: materialA._id, itemRevision: materialA.currentRevision, expectedItemVersion: materialA.version, quantityPerUnit: '1.25', uom: 'UN' }] : []), { itemId: materialB._id, itemRevision: materialB.currentRevision, expectedItemVersion: materialB.version, quantityPerUnit: '2', uom: 'SET' }] });
  await t.test('immutable engineering revisions preserve stable material identities across removal/re-add and approve demand only', async () => {
    const before = await snapshot();
    assert.equal((await post(`${orders}/${plan._id}/engineering/revisions`, { ...engineeringBody(plan.version), materials: [{ itemId: output._id, itemRevision: output.currentRevision, expectedItemVersion: output.version, quantityPerUnit: '1', uom: 'UN' }] })).status, 400); assert.deepEqual(await snapshot(), before);
    let current = await ok(`${orders}/${plan._id}/engineering/revisions`, engineeringBody(plan.version)); const first = await ok(`${orders}/${plan._id}/engineering/revisions/1`), lineA = current.engineering.content.materials.find(m => m.itemId === materialA._id).lineId;
    assert.deepEqual(current.engineering.content.materials.map(m => m.requiredQuantity), ['3.75', '6']); assert.equal(current.engineering.status, 'DRAFT');
    current = await ok(`${orders}/${plan._id}/engineering/revisions`, engineeringBody(current.version, false));
    current = await ok(`${orders}/${plan._id}/engineering/revisions`, engineeringBody(current.version)); assert.equal(current.engineering.content.materials.find(m => m.itemId === materialA._id).lineId, lineA);
    const contentBeforeApproval = await ok(`${orders}/${plan._id}/engineering/revisions/3`);
    plan = await ok(`${orders}/${plan._id}/engineering/approve`, command({ expectedVersion: current.version, revision: 3 })); assert.equal(plan.engineering.status, 'APPROVED_DEMAND'); assert.equal(plan.status, 'PLANNED'); assert.equal(plan.planningReady, true); assert.equal(plan.canExecute, false);
    assert.deepEqual(await ok(`${orders}/${plan._id}/engineering/revisions/1`), first); assert.deepEqual(await ok(`${orders}/${plan._id}/engineering/revisions/3`), contentBeforeApproval);
  });
  await t.test('head and immutable revision corruption fail closed without fabricating approval authority', async () => {
    const raw = await h.db.collection('inventoryItems').findOne({ _id: output._id }); await h.db.collection('inventoryItems').updateOne({ _id: raw._id }, { $set: { status: 'INACTIVE' } });
    try { assert.equal((await post(`${items}/${output._id}`)).error.code, 'MASTER_SOURCE_INVALID'); assert.equal((await post(orders, createBody())).error.code, 'MASTER_SOURCE_INVALID'); } finally { await h.db.collection('inventoryItems').replaceOne({ _id: raw._id }, raw); }
    const revision = await h.db.collection('internalEngineeringRevisions').findOne({ subjectId: plan._id, revision: 3 }); await h.db.collection('internalEngineeringRevisions').updateOne({ _id: revision._id }, { $set: { 'content.materials.0.quantityPerUnit': '99' } });
    try { assert.equal((await post(`${orders}/${plan._id}`)).error.code, 'MASTER_SOURCE_INVALID'); } finally { await h.db.collection('internalEngineeringRevisions').replaceOne({ _id: revision._id }, revision); }
    const before = await snapshot(); assert.equal((await post(`${orders}/${plan._id}/cancel`, command({ expectedVersion: 1 }))).error.code, 'VERSION_CONFLICT'); assert.deepEqual(await snapshot(), before);
  });
  await t.test('scoped reads and committing authorization recheck fresh and durable replay; roles do not grant execution', async () => {
    assert.equal((await post(`${orders}/${plan._id}`, undefined, h.beta)).status, 404); assert.equal((await post(`${items}/${output._id}`, undefined, h.beta)).status, 404);
    const before = await snapshot(), member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), foundation = h.runtime.foundation;
    for (const body of [originalCreate, { ...originalCreate, idempotencyKey: key() }]) {
      h.runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'internalReader', plantIds: member.plantIds }] } }); return result; } };
      try { assert.equal((await post(orders, body)).status, 403); } finally { h.runtime.foundation = foundation; await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    }
    assert.deepEqual(await snapshot(), before);
    const restore = await h.setRoles(h.seeded[0], ['internalEngineer']); try { assert.equal((await post(`${orders}/${plan._id}/engineering/approve`, command({ expectedVersion: plan.version, revision: 3 }))).status, 403); } finally { await restore(); }
    const page = await post(`${orders}/${plan._id}/events?limit=2`); assert.equal(page.data.length, 2); assert.ok(page.page.nextCursor);
    const revisionPage = await post(`${orders}/${plan._id}/engineering/revisions?limit=2`); assert.equal(revisionPage.data.length, 2); assert.ok(revisionPage.page.nextCursor); assert.ok(revisionPage.data.every(r => !Object.hasOwn(r, 'content')));
  });
  await t.test('master changes expose blockers, metadata revoke/cancel still work, and history/replay stays immutable', async () => {
    const oldRevision = await ok(`${items}/${materialA._id}/revisions/1`);
    const changed = await ok(`${items}/${materialA._id}/revisions`, command({ expectedVersion: materialA.version, description: 'New unapproved material draft', uom: 'UN', kind: 'PURCHASED' })); assert.equal(changed.status, 'DRAFT');
    let current = await ok(`${orders}/${plan._id}`); assert.equal(current.planningReady, false); assert.ok(current.blockers.includes('MATERIAL_CHANGED')); assert.deepEqual(await ok(`${items}/${materialA._id}/revisions/1`), oldRevision);
    assert.deepEqual((await post(orders, originalCreate)).data.itemSnapshot, plan.itemSnapshot);
    current = await ok(`${orders}/${plan._id}/engineering/revoke`, command({ expectedVersion: current.version, revision: current.engineering.currentRevision })); assert.equal(current.engineering.status, 'REVOKED');
    const deactivated = await ok(`${locations}/${location._id}/deactivate`, command({ expectedVersion: location.version })); assert.equal(deactivated.status, 'INACTIVE');
    assert.equal((await post(`${locations}/${location._id}/qualify`, command({ expectedVersion: deactivated.version }))).error.code, 'STATE_CONFLICT');
    current = await ok(`${orders}/${plan._id}/cancel`, command({ expectedVersion: current.version })); assert.equal(current.status, 'CANCELLED'); assert.equal(current.canExecute, false); assert.ok(current.blockers.includes('LOCATION_NOT_QUALIFIED'));
    assert.deepEqual(await negative(), beforeLegacy);
  });
});
