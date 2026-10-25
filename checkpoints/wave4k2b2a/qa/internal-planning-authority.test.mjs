import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('independent internal planning authority without execution or stock entitlement', async t => {
  const h = await startOwned(t), key = () => randomUUID();
  const items = '/inventory-master/items', locations = '/inventory-master/locations', orders = '/internal-production/orders';
  const common = version => ({ expectedVersion: version, reason: 'Synthetic independent planning authority evidence', idempotencyKey: key() });
  const authCollections = new Set(['sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'ownedRun']);
  const snapshot = async () => {
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !authCollections.has(name)).sort();
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const immutable = async (path, revision) => h.ok(`${path}/revisions/${revision}`);
  const createItem = async (code, kind = 'PURCHASED', uom = 'SET', cookie = h.alpha) => {
    const draft = await h.ok(items, { ...common(1), code, description: `Synthetic ${code}`, uom, kind }, 201, cookie);
    return h.ok(`${items}/${draft._id}/approve`, { ...common(draft.version), revision: draft.currentRevision }, 200, cookie);
  };
  const createLocation = async (code, cookie = h.alpha) => {
    const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, idempotencyKey: key(), code: `BIN-${code}` }, 201, cookie);
    const draft = await h.ok(locations, { ...common(1), code, binId: bin._id }, 201, cookie);
    return h.ok(`${locations}/${draft._id}/qualify`, common(draft.version), 200, cookie);
  };
  const output = await createItem('QA-INTERNAL-OUTPUT', 'MANUFACTURED', 'UN');
  const inputA = await createItem('QA-INTERNAL-INPUT-A'), inputB = await createItem('QA-INTERNAL-INPUT-B', 'PURCHASED', 'KG');
  const approvalInput = await createItem('QA-INTERNAL-APPROVAL-RACE'), changingOutput = await createItem('QA-INTERNAL-REVISION', 'MANUFACTURED', 'UN');
  const location = await createLocation('QA-INTERNAL-LOCATION'), orderingLocation = await createLocation('QA-INTERNAL-ORDERING');
  const foreignOutput = await createItem('QA-INTERNAL-FOREIGN', 'MANUFACTURED', 'UN', h.beta), foreignLocation = await createLocation('QA-INTERNAL-FOREIGN', h.beta);
  const plant = await h.db.collection('plants').findOne({ _id: h.seeded[0].plantId });
  const createBody = (item = output, destination = location) => ({ ...common(1), itemId: item._id, itemRevision: item.currentRevision, expectedItemVersion: item.version, locationId: destination._id, expectedLocationVersion: destination.version, quantity: '3' });
  const plan = async (item = output, destination = location) => h.ok(orders, createBody(item, destination), 201);
  const material = (item, ratio = '2.125') => ({ itemId: item._id, itemRevision: item.currentRevision, expectedItemVersion: item.version, quantityPerUnit: ratio, uom: item.content.uom });
  const engineeringBody = (order, requirements = [material(inputA)]) => ({ ...common(order.version), operations: [{ code: 'QA-PLAN', instruction: 'Synthetic planning only; no execution authority' }], materials: requirements });
  const draft = async (order, requirements) => h.ok(`${orders}/${order._id}/engineering/revisions`, engineeringBody(order, requirements));
  const approve = async order => h.ok(`${orders}/${order._id}/engineering/approve`, { ...common(order.version), revision: order.engineering.currentRevision });
  const afterAuthorization = async (action, intervention, command) => {
    const original = h.runtime.foundation; let reached = 0;
    h.runtime.foundation = { ...original, authorize: async (...args) => {
      const result = await original.authorize(...args);
      if (args[1]?.action === action && reached === 0) { reached++; await intervention(); }
      return result;
    } };
    try { const result = await command(); assert.equal(reached, 1, action); return result; }
    finally { h.runtime.foundation = original; }
  };
  const findHead = async id => {
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !authCollections.has(name));
    const matches = [];
    for (const name of names) {
      const row = await h.db.collection(name).findOne({ _id: id });
      if (row && Object.hasOwn(row, 'ownerLegalEntityId') && Object.hasOwn(row, 'authorityHash')) matches.push({ name, row });
    }
    assert.equal(matches.length, 1, `one current authority head for ${id}`); return matches[0];
  };
  const corruptHead = async (id, patch, commands) => {
    const { name, row } = await findHead(id), pristine = await snapshot();
    await h.db.collection(name).updateOne({ _id: id }, { $set: patch });
    try {
      const corrupted = await snapshot();
      for (const [path, body] of commands) {
        const response = await h.req(path, body, h.alpha);
        assert.equal(response.status, 409, `${name}: ${JSON.stringify(response)}`);
        assert.equal(response.error.code, 'MASTER_SOURCE_INVALID');
        assert.deepEqual(await snapshot(), corrupted);
      }
    } finally { await h.db.collection(name).replaceOne({ _id: id }, row); }
    assert.deepEqual(await snapshot(), pristine);
  };
  const forbiddenNames = new Set([
    'accounts', 'contacts', 'opportunities', 'inquiries', 'inquiryRevisions', 'quotes', 'quoteRevisions', 'salesOrders', 'invoices',
    'procurementVendors', 'procurementRequests', 'procurementOrders', 'warehouseReceipts', 'warehouseSerials', 'warehouseReservations',
    'warehouseMovements', 'warehouseReceived', 'warehouseAllocated', 'warehouseKeys', 'warehouseAudit', 'warehouseOutbox',
    'manufacturingWorkOrders', 'manufacturingOutputUnits', 'manufacturingMovements', 'manufacturingAllocated', 'manufacturingLabor',
    'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox', 'engineeringPackages', 'engineeringRevisions',
    'serialCustodyUnits', 'serialCustodyClaims', 'serialCustodyEvents', 'stockHolds', 'stockHoldEvents',
    'genealogyHeads', 'genealogyAllocations', 'genealogyRevisions', 'genealogyEvents',
    'componentInstallationHeads', 'componentInstallationLinks', 'componentInstallationRevisions', 'componentInstallationEvents', 'componentInstallationGraph',
    'fulfillmentShipments', 'fulfillmentTallies', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox', 'inventoryStock', 'inventoryUnits',
  ]);
  const negativeBudget = async () => {
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name);
    for (const name of names) if (/^(commercial|procurement|manufacturing|fulfillment|genealogy|serialCustody|componentInstallation|stockHold)/.test(name) || (name.startsWith('warehouse') && name !== 'warehouseBins')) forbiddenNames.add(name);
    return Object.fromEntries(await Promise.all([...forbiddenNames].sort().map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const initialNegativeBudget = await negativeBudget();
  const retainedBody = createBody(), retainedOrder = await h.ok(orders, retainedBody, 201);

  await t.test('real approved masters produce immutable planning demand while execution stays unavailable', async () => {
    assert.equal(output.ownerLegalEntityId, plant.legalEntityId); assert.equal(location.ownerLegalEntityId, plant.legalEntityId);
    assert.equal(retainedOrder.status, 'PLANNED'); assert.equal(retainedOrder.purpose, 'INTERNAL_STOCK'); assert.equal(retainedOrder.schema, 'INTERNAL_PLAN_V1');
    assert.equal(retainedOrder.canExecute, false); assert.equal(retainedOrder.execution, 'NOT_IMPLEMENTED');
    const rawBefore = await h.db.collection('warehouseBins').findOne({ _id: location.binId });
    const pending = await draft(retainedOrder), revisionPath = `${orders}/${pending._id}/engineering`;
    const before = await immutable(revisionPath, pending.engineering.currentRevision), approved = await approve(pending);
    assert.equal(approved.engineering.status, 'APPROVED_DEMAND'); assert.equal(approved.status, 'PLANNED'); assert.equal(approved.planningReady, true);
    assert.equal(approved.canExecute, false); assert.equal(approved.execution, 'NOT_IMPLEMENTED');
    assert.equal(approved.engineering.content.materials[0].requiredQuantity, '6.375');
    assert.equal(approved.engineering.content.materials[0].sourceKind, 'ITEM_REQUIREMENT');
    const rawAfter = await h.db.collection('warehouseBins').findOne({ _id: location.binId });
    assert.ok(rawAfter.internalPlanningUseFence > rawBefore.internalPlanningUseFence);
    const { internalPlanningUseFence: ignoredBefore, ...rawIdentityBefore } = rawBefore;
    const { internalPlanningUseFence: ignoredAfter, ...rawIdentityAfter } = rawAfter;
    assert.deepEqual(rawIdentityAfter, rawIdentityBefore);
    assert.deepEqual(await immutable(revisionPath, pending.engineering.currentRevision), before);
    assert.equal((await h.req(`/manufacturing/work-orders/${approved._id}`, undefined, h.alpha)).status, 404);
  });

  await t.test('caller ownership, stock and customer fields cannot manufacture authority or cross scope', async () => {
    for (const extra of [{ ownerLegalEntityId: key() }, { salesOrderId: key() }, { accountId: key() }, { purpose: 'CUSTOMER_ORDER' }, { schema: 'LEGACY' }, { status: 'STOCK_AVAILABLE' }, { availableQuantity: '3' }]) {
      const before = await snapshot(), response = await h.req(orders, { ...createBody(), ...extra }, h.alpha);
      assert.equal(response.status, 400, JSON.stringify(response)); assert.deepEqual(await snapshot(), before);
    }
    for (const body of [createBody(foreignOutput), createBody(output, foreignLocation), { ...createBody(), plantId: h.seeded[1].plantId }]) {
      const before = await snapshot(), response = await h.req(orders, body, h.alpha);
      assert.ok([403, 404].includes(response.status), JSON.stringify(response)); assert.deepEqual(await snapshot(), before);
    }
    const before = await snapshot();
    assert.ok([403, 404].includes((await h.req(`${items}/${foreignOutput._id}`, undefined, h.alpha)).status));
    assert.ok([403, 404].includes((await h.req(`${locations}/${foreignLocation._id}`, undefined, h.alpha)).status));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('competing canonical item codes create one head and one durable command only', async () => {
    const before = await snapshot(), bodies = [common(1), common(1)].map(base => ({ ...base, code: 'QA-INTERNAL-UNIQUE', description: 'Synthetic concurrent unique authority', uom: 'UN', kind: 'PURCHASED' }));
    const responses = await Promise.all(bodies.map(body => h.req(items, body, h.alpha)));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409], JSON.stringify(responses));
    const winner = responses.findIndex(response => response.status === 201), rejected = bodies[1 - winner];
    assert.equal(await h.db.collection('internalPlanningKeys').countDocuments({ key: rejected.idempotencyKey }), 0);
    assert.equal(await h.db.collection('internalPlanningKeys').countDocuments() - (before.internalPlanningKeys?.length || 0), 1);
    const committed = await snapshot(); assert.deepEqual(await h.ok(items, bodies[winner], 201), responses[winner].data); assert.deepEqual(await snapshot(), committed);
    const lowercase = await h.req(items, { ...common(1), code: 'qa-internal-unique', description: 'Synthetic invalid lowercase', uom: 'UN', kind: 'PURCHASED' }, h.alpha);
    assert.equal(lowercase.status, 400); assert.deepEqual(await snapshot(), committed);
  });

  await t.test('material line identities and older hashes survive removal and readdition across revisions', async () => {
    let current = await draft(await plan(), [material(inputA)]);
    const first = await immutable(`${orders}/${current._id}/engineering`, current.engineering.currentRevision), lineId = current.engineering.content.materials[0].lineId;
    current = await approve(current);
    current = await draft(current, [material(inputB, '0.25')]); assert.equal(current.engineering.status, 'DRAFT');
    current = await draft(current, [material(inputA), material(inputB, '0.25')]);
    assert.equal(current.engineering.content.materials.find(row => row.itemId === inputA._id).lineId, lineId);
    assert.equal(current.engineering.content.materials.find(row => row.itemId === inputB._id).requiredQuantity, '0.75');
    assert.deepEqual(await immutable(`${orders}/${current._id}/engineering`, 1), first);
    const before = await snapshot(), changed = { ...engineeringBody(current), contentHash: key() };
    assert.equal((await h.req(`${orders}/${current._id}/engineering/revisions`, changed, h.alpha)).status, 400); assert.deepEqual(await snapshot(), before);
  });

  await t.test('only the current approved output revision can support fresh plans while old snapshots remain readable', async () => {
    const old = await plan(changingOutput), prior = await immutable(`${items}/${changingOutput._id}`, changingOutput.currentRevision);
    const next = await h.ok(`${items}/${changingOutput._id}/revisions`, { ...common(changingOutput.version), description: 'Synthetic newer output drawing', uom: 'UN', kind: 'MANUFACTURED' });
    const historical = await h.ok(`${orders}/${old._id}`); assert.deepEqual(historical.itemSnapshot, old.itemSnapshot); assert.equal(historical.planningReady, false); assert.ok(historical.blockers.length);
    let before = await snapshot(); assert.equal((await h.req(orders, createBody(changingOutput), h.alpha)).status, 409); assert.deepEqual(await snapshot(), before);
    const approved = await h.ok(`${items}/${next._id}/approve`, { ...common(next.version), revision: next.currentRevision });
    before = await snapshot(); assert.equal((await h.req(orders, { ...createBody(approved), itemRevision: changingOutput.currentRevision }, h.alpha)).status, 409); assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await immutable(`${items}/${changingOutput._id}`, changingOutput.currentRevision), prior);
    const fresh = await plan(approved); assert.equal(fresh.itemSnapshot.currentRevision, approved.currentRevision);
  });

  await t.test('location and material deactivation after middleware authorization block fresh transaction use', async () => {
    let committed;
    const blockedPlan = await afterAuthorization('internal.plan', async () => {
      await h.ok(`${locations}/${orderingLocation._id}/deactivate`, common(orderingLocation.version)); committed = await snapshot();
    }, () => h.req(orders, createBody(output, orderingLocation), h.alpha));
    assert.equal(blockedPlan.status, 409); assert.deepEqual(await snapshot(), committed);
    const pending = await draft(await plan(), [material(approvalInput)]), approvalBody = { ...common(pending.version), revision: pending.engineering.currentRevision };
    const blockedApproval = await afterAuthorization('internal.engineering.approve', async () => {
      await h.ok(`${items}/${approvalInput._id}/deactivate`, common(approvalInput.version)); committed = await snapshot();
    }, () => h.req(`${orders}/${pending._id}/engineering/approve`, approvalBody, h.alpha));
    assert.equal(blockedApproval.status, 409); assert.deepEqual(await snapshot(), committed);
    const current = await h.ok(`${orders}/${pending._id}`); assert.equal(current.engineering.status, 'DRAFT'); assert.equal(current.planningReady, false); assert.ok(current.blockers.length);
  });

  await t.test('corrupt current head status or immutable reference cannot establish planning authority', async () => {
    const commands = [[`${items}/${output._id}`, undefined], [orders, createBody()]];
    await corruptHead(output._id, { status: 'DRAFT' }, commands);
    await corruptHead(output._id, { contentHash: '0'.repeat(64) }, commands);
    await corruptHead(location._id, { status: 'DRAFT' }, [[`${locations}/${location._id}`, undefined], [orders, createBody()]]);
    const pending = await draft(await plan()), body = { ...common(pending.version), revision: pending.engineering.currentRevision };
    await corruptHead(pending._id, { 'engineering.status': 'APPROVED_DEMAND' }, [[`${orders}/${pending._id}`, undefined], [`${orders}/${pending._id}/engineering/approve`, body]]);
  });

  await t.test('qualified locations retain one real bin identity and reject raw-bin drift before fresh use', async () => {
    const beforeDuplicate = await snapshot();
    const duplicate = await h.req(locations, { ...common(1), code: 'QA-INTERNAL-DUPLICATE-BIN', binId: location.binId }, h.alpha);
    assert.equal(duplicate.status, 409); assert.deepEqual(await snapshot(), beforeDuplicate);
    const raw = await h.db.collection('warehouseBins').findOne({ _id: location.binId }), pristine = await snapshot();
    let changed;
    try {
      const response = await afterAuthorization('internal.plan', async () => {
        await h.db.collection('warehouseBins').updateOne({ _id: raw._id }, { $inc: { version: 1 } }); changed = await snapshot();
      }, () => h.req(orders, createBody(), h.alpha));
      assert.equal(response.status, 409); assert.deepEqual(await snapshot(), changed);
      const live = await h.ok(`${locations}/${location._id}`); assert.ok(live.blockers.includes('LOCATION_CHANGED'));
      assert.deepEqual(live.binSnapshot, location.binSnapshot); assert.deepEqual(await snapshot(), changed);
    } finally { await h.db.collection('warehouseBins').replaceOne({ _id: raw._id }, raw); }
    assert.deepEqual(await snapshot(), pristine);
  });

  await t.test('outbox failure atomically rolls back approval, source fences, authority history and key', async () => {
    const pending = await draft(await plan()), body = { ...common(pending.version), revision: pending.engineering.currentRevision }, before = await snapshot();
    await h.db.command({ collMod: 'internalPlanningOutbox', validator: { qaForbidden: { $exists: true } }, validationLevel: 'strict' });
    try {
      const response = await h.req(`${orders}/${pending._id}/engineering/approve`, body, h.alpha);
      assert.equal(response.status, 500); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.command({ collMod: 'internalPlanningOutbox', validator: {} }); }
    const result = await h.ok(`${orders}/${pending._id}/engineering/approve`, body); assert.equal(result.engineering.status, 'APPROVED_DEMAND');
  });

  await t.test('committing permission revocation precedes acknowledged replay and preserves receipt', async () => {
    const membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await snapshot();
    try {
      const refused = await afterAuthorization('internal.plan', async () => {
        await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } });
      }, () => h.req(orders, retainedBody, h.alpha));
      assert.equal(refused.status, 403); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
    assert.deepEqual(await h.ok(orders, retainedBody, 201), retainedOrder); assert.deepEqual(await snapshot(), before);
  });

  await t.test('planning and approved demand leave all customer, execution, serial and stock ledgers unchanged', async () => {
    assert.deepEqual(await negativeBudget(), initialNegativeBudget);
    const current = await h.ok(`${orders}/${retainedOrder._id}`); assert.equal(current.status, 'PLANNED'); assert.equal(current.execution, 'NOT_IMPLEMENTED'); assert.equal(current.canExecute, false);
  });
});
