import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('independent received-only installation authority, retirement and shipment freezing', async t => {
  const h = await startOwned(t), key = () => randomUUID();
  const account = await h.ok('/crm/accounts', { name: 'Synthetic independent installation customer' }, 201);
  const financial = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic installation parent', quantity: '4', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] };
  const quote = await h.ok('/commercial/quotes', { ...financial, accountId: account._id, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await h.ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await h.ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await h.ok('/procurement/vendors', { name: 'Synthetic independent received component vendor' }, 201);
  const pr = await h.ok('/procurement/requests', { ...financial, vendorId: vendor._id, lines: [{ ...financial.lines[0], quantity: '8' }] }, 201);
  await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await h.ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '8', uom: 'UN', lotNumber: 'INSTALL-QA-LOT', heatNumber: 'INSTALL-QA-HEAT', serials: Array.from({ length: 8 }, () => `INSTALL-QA-${key()}`), idempotencyKey: key() }, 201);
  await h.ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic incoming inspection', idempotencyKey: key() });
  await h.ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'INSTALL-QA-BIN', idempotencyKey: key() });
  const custodyPath = `/warehouse/receipts/${receipt._id}/serial-custody`;
  const adopted = await h.ok(`${custodyPath}/adopt`, { expectedVersion: 3, reason: 'Synthetic explicit incoming custody adoption', idempotencyKey: key() });
  const planned = await h.ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, quantities: ['2', '2'], uom: 'UN', serialized: true, genealogyRequired: true, serialCustodyRequired: true, installationRequired: true, idempotencyKey: key() }, 201);
  const [main, retired] = planned.workOrders;
  const installation = wo => `/manufacturing/work-orders/${wo._id}/installations`;
  const genealogy = wo => `/manufacturing/work-orders/${wo._id}/genealogy`;
  const view = wo => h.ok(installation(wo));
  const common = current => ({ expectedVersion: current.workOrderVersion, expectedInstallationVersion: current.version, reason: 'Synthetic independently observed component evidence', idempotencyKey: key() });
  const recordBody = (current, parent, children) => ({ ...common(current), outputUnitId: parent._id, components: children.map(child => ({ serialUnitId: child._id, expectedUnitVersion: child.version })) });
  const record = async (wo, parent, childIds) => { const current = await view(wo); return h.ok(`${installation(wo)}/record`, recordBody(current, parent, childIds.map(id => current.components.find(child => child._id === id)))); };
  const snapshot = async () => {
    const excluded = new Set(['sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials', 'ownedRun']);
    const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).filter(name => !excluded.has(name)).sort();
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  };
  const stock = async () => {
    const row = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    return { counters: Object.fromEntries(['quantity', 'availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity'].filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])), consumed: await h.db.collection('manufacturingMovements').find({ receiptId: receipt._id, kind: 'MATERIAL_CONSUMED' }).sort({ _id: 1 }).toArray() };
  };
  const afterAuthorization = async (action, intervention, command) => {
    const original = h.runtime.foundation; let reached = 0;
    h.runtime.foundation = { ...original, authorize: async (...args) => { const result = await original.authorize(...args); if (args[1]?.action === action && reached === 0) { reached++; await intervention(); } return result; } };
    try { const result = await command(); assert.equal(reached, 1); return result; }
    finally { h.runtime.foundation = original; }
  };
  const hold = async () => {
    const source = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const result = await h.send(`/warehouse/receipts/${receipt._id}/holds`, { headers: { 'Idempotency-Key': key() }, body: { expectedReceiptVersion: source.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Synthetic later component source hold' } });
    assert.equal(result.status, 201, JSON.stringify(result)); return result.data.hold;
  };
  const clearHold = async active => {
    const result = await h.send(`/warehouse/holds/${active.id}/release`, { headers: { 'Idempotency-Key': key() }, body: { expectedVersion: active.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic source review completed' } });
    assert.equal(result.status, 200, JSON.stringify(result));
  };
  for (const [index, wo] of planned.workOrders.entries()) {
    const source = await h.ok(custodyPath), claimsPath = `/manufacturing/work-orders/${wo._id}/serial-claims`;
    const claimed = await h.ok(claimsPath, { expectedVersion: 1, expectedReceiptVersion: source.receiptVersion, receiptId: receipt._id, serialUnitIds: adopted.units.slice(index * 4, index * 4 + 4).map(unit => unit._id), reason: 'Synthetic explicit received source selection', idempotencyKey: key() });
    const released = await h.ok(`/manufacturing/work-orders/${wo._id}/release`, { expectedVersion: claimed.workOrderVersion, operations: [{ code: 'INSTALL-QA-OP', instruction: 'Synthetic received component assembly' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '2', uom: 'UN' }], serialClaims: [{ receiptId: receipt._id, claimId: claimed.claims[0]._id }], idempotencyKey: key() });
    const serials = [`INSTALL-QA-PARENT-${index}-A`, `INSTALL-QA-PARENT-${index}-B`];
    const output = await h.ok(`/manufacturing/work-orders/${wo._id}/record`, { expectedVersion: released.version, operationIndex: 0, inputQuantity: '2', goodQuantity: '2', scrapQuantity: '0', uom: 'UN', evidence: 'Synthetic received components consumed into assembly context', outputSerials: serials, idempotencyKey: key() });
    await h.ok(`/manufacturing/work-orders/${wo._id}/qc`, { expectedVersion: output.version, acceptedQuantity: '2', rejectedQuantity: '0', acceptedSerials: serials, rejectedSerials: [], uom: 'UN', evidence: 'Synthetic accepted parent outputs', idempotencyKey: key() });
    let current = await h.ok(genealogy(wo));
    for (const unit of current.units) {
      current = await h.ok(`${genealogy(wo)}/allocations`, { expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, outputUnitId: unit._id, materials: [{ receiptId: receipt._id, quantity: '2', uom: 'UN' }], reason: 'Synthetic exact ratio2 lot attribution', idempotencyKey: key() });
    }
    await h.ok(`${genealogy(wo)}/finalize`, { expectedVersion: current.workOrderVersion, expectedGenealogyVersion: current.version, reason: 'Synthetic source quantities reconciled', idempotencyKey: key() });
  }
  const originalStock = await stock(); assert.equal(originalStock.consumed.length, 2);
  const assertStock = async () => assert.deepEqual(await stock(), originalStock);
  const rejectCorruptHead = async (collection, patch, current) => {
    const rows = h.db.collection(collection), original = await rows.findOne({ workOrderId: main._id });
    assert.ok(original, collection);
    const pristine = await snapshot(), body = common(current);
    await rows.updateOne({ _id: original._id }, { $set: patch });
    try {
      const corrupted = await snapshot();
      for (const [path, command] of [[installation(main), undefined], [`${installation(main)}/finalize`, body]]) {
        const response = await h.req(path, command, h.alpha);
        assert.equal(response.status, 409, `${collection} ${JSON.stringify(patch)} ${JSON.stringify(response)}`);
        assert.equal(response.error.code, 'INSTALLATION_SOURCE_INVALID');
        assert.deepEqual(await snapshot(), corrupted);
      }
    } finally { await rows.replaceOne({ _id: original._id }, original); }
    assert.deepEqual(await snapshot(), pristine);
  };
  let mainView = await view(main), mainParents = mainView.parents, mainChildren = mainView.components;
  assert.equal(mainParents.length, 2); assert.equal(mainChildren.length, 4);
  let failedBody;

  await t.test('manufactured-origin source contamination fails closed without graph or projection effects', async () => {
    const body = recordBody(mainView, mainParents[0], [mainChildren[0]]);
    const source = await h.db.collection('serialCustodyUnits').findOne({ _id: mainChildren[0]._id });
    const registry = await h.db.collection('warehouseSerials').findOne({ _id: source.registryId });
    await h.db.collection('warehouseSerials').updateOne({ _id: registry._id }, { $set: { sourceType: 'MANUFACTURING_OUTPUT', workOrderId: main._id } });
    try {
      const before = await snapshot(), result = await h.req(`${installation(main)}/record`, body, h.alpha);
      assert.equal(result.status, 409, JSON.stringify(result)); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.collection('warehouseSerials').replaceOne({ _id: registry._id }, registry); }
  });

  await t.test('outbox failure rolls back source versions, real graph fence, revision, edge and command receipt', async () => {
    failedBody = recordBody(await view(main), mainParents[0], [mainChildren[0]]);
    const before = await snapshot();
    await h.db.command({ collMod: 'manufacturingOutbox', validator: { qaForbidden: { $exists: true } }, validationLevel: 'strict' });
    try { const result = await h.req(`${installation(main)}/record`, failedBody, h.alpha); assert.equal(result.status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await h.db.command({ collMod: 'manufacturingOutbox', validator: {} }); }
    await assertStock();
  });

  let winningBody, winningResponse, winningParent, otherParent;
  await t.test('two parents competing for one received identity commit exactly one immutable assignment', async () => {
    const current = await view(main), bodies = [failedBody, recordBody(current, mainParents[1], [current.components.find(child => child._id === mainChildren[0]._id)])];
    const before = await snapshot();
    const results = await Promise.all(bodies.map(body => h.req(`${installation(main)}/record`, body, h.alpha)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409], JSON.stringify(results));
    const winner = results.findIndex(result => result.status === 200);
    winningBody = bodies[winner]; winningResponse = results[winner].data; winningParent = mainParents[winner]; otherParent = mainParents[1 - winner];
    const currentView = await view(main); assert.equal(currentView.edges.length, 1);
    assert.equal(currentView.edges[0].childId, mainChildren[0]._id); assert.equal(currentView.edges[0].outputUnitId, winningParent._id);
    assert.equal(currentView.currentRevision, 1); assert.equal(currentView.version, 1);
    for (const name of ['componentInstallationLinks', 'componentInstallationRevisions', 'componentInstallationEvents', 'manufacturingAudit', 'manufacturingOutbox', 'manufacturingKeys']) {
      const after = await h.db.collection(name).countDocuments(); assert.equal(after - (before[name]?.length || 0), 1, name);
    }
    assert.equal(await h.db.collection('manufacturingKeys').countDocuments({ key: bodies[1 - winner].idempotencyKey }), 0);
    const committed = await snapshot(); assert.deepEqual(await h.ok(`${installation(main)}/record`, winningBody), winningResponse); assert.deepEqual(await snapshot(), committed);
    await assertStock();
  });

  await t.test('per-parent overratio is rejected; historical assignment under later hold remains truthful', async () => {
    const current = await view(main), unassigned = current.components.filter(child => child.disposition === null);
    const before = await snapshot(), result = await h.req(`${installation(main)}/record`, recordBody(current, winningParent, unassigned.slice(0, 2)), h.alpha);
    assert.equal(result.status, 409); assert.equal(result.error.code, 'INSTALLATION_QUANTITY_CONFLICT'); assert.deepEqual(await snapshot(), before);
    await record(main, winningParent, [unassigned[0]._id]);
    const active = await hold();
    try {
      const next = await view(main); await record(main, otherParent, next.components.filter(child => child.disposition === null).map(child => child._id));
      const ready = await view(main); assert.equal(ready.incompleteParents.length, 0); assert.equal(ready.canFinalize, false); assert.ok(ready.sourceHolds.length);
      const held = await snapshot(), refused = await h.req(`${installation(main)}/finalize`, common(ready), h.alpha);
      assert.equal(refused.status, 409); assert.equal(refused.error.code, 'STOCK_ENCUMBERED'); assert.deepEqual(await snapshot(), held);
    } finally { await clearHold(active); }
    await assertStock();
  });

  await t.test('head status, versions and freeze metadata must agree with immutable authority', async () => {
    const current = await view(main);
    assert.equal(current.status, 'DRAFT'); assert.equal(current.k1.status, 'COMPLETE');
    for (const patch of [{ status: 'DRAFT' }, { version: 0 }, { status: 'FROZEN', frozen: null }]) {
      await rejectCorruptHead('genealogyHeads', patch, current);
    }
    for (const patch of [{ status: 'COMPLETE' }, { status: 'FROZEN', frozen: null }, { version: 0 }]) {
      await rejectCorruptHead('componentInstallationHeads', patch, current);
    }
    await assertStock();
  });

  await t.test('removal permanently quarantines the received identity without reuse, process loss or restock', async () => {
    const current = await view(retired), parent = current.parents[0], child = current.components[0];
    await record(retired, parent, [child._id]);
    const assigned = await view(retired), edge = assigned.edges[0], source = assigned.components.find(row => row._id === child._id);
    await h.ok(`${installation(retired)}/remove`, { ...common(assigned), edgeId: edge._id, expectedEdgeVersion: edge.version, expectedUnitVersion: source.version });
    const removed = await view(retired); assert.equal(removed.components.find(row => row._id === child._id).disposition, 'REMOVED_QUARANTINE'); assert.equal(removed.canFinalize, false);
    const unit = await h.db.collection('serialCustodyUnits').findOne({ _id: child._id }); assert.equal(unit.status, 'CONSUMED');
    const before = await snapshot();
    for (const destination of removed.parents) {
      const result = await h.req(`${installation(retired)}/record`, recordBody(removed, destination, [removed.components.find(row => row._id === child._id)]), h.alpha);
      assert.equal(result.status, 409); assert.equal(result.error.code, 'INSTALLATION_CHILD_UNAVAILABLE'); assert.deepEqual(await snapshot(), before);
    }
    const loss = await h.req(`${installation(retired)}/losses`, { ...common(removed), components: [{ serialUnitId: child._id, expectedUnitVersion: removed.components.find(row => row._id === child._id).version }] }, h.alpha);
    assert.equal(loss.status, 409); assert.deepEqual(await snapshot(), before);
    const finalized = await h.req(`${installation(retired)}/finalize`, common(removed), h.alpha); assert.equal(finalized.status, 409); assert.deepEqual(await snapshot(), before);
    await assertStock();
  });

  let complete, originalRevision;
  await t.test('K1 correction invalidates installation readiness and requires an explicit new binding', async () => {
    complete = await h.ok(`${installation(main)}/finalize`, common(await view(main))); assert.equal(complete.status, 'COMPLETE');
    originalRevision = await h.ok(`${installation(main)}/revisions/${complete.currentRevision}`);
    let k1 = await h.ok(genealogy(main));
    k1 = await h.ok(`${genealogy(main)}/allocations`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, outputUnitId: mainParents[0]._id, materials: [{ receiptId: receipt._id, quantity: '2', uom: 'UN' }], reason: 'Synthetic explicit refreshed lot evidence', idempotencyKey: key() });
    const unready = await view(main); assert.equal(unready.canFinalize, false); assert.ok(unready.blockers.length);
    assert.equal(unready.k1.status, 'DRAFT');
    await rejectCorruptHead('genealogyHeads', { status: 'COMPLETE' }, unready);
    const before = await snapshot(), denied = await h.req('/fulfillment/shipments', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', reference: 'INSTALL-QA-UNREADY', sources: [{ sourceType: 'WORK_ORDER', sourceId: main._id, quantity: '1', serials: [mainParents[0].serial] }], idempotencyKey: key() }, h.alpha);
    assert.equal(denied.status, 409); assert.deepEqual(await snapshot(), before);
    await h.ok(`${genealogy(main)}/finalize`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, reason: 'Synthetic updated K1 evidence reconciled', idempotencyKey: key() });
    const ready = await view(main); assert.equal(ready.canFinalize, true);
    const rebound = await h.ok(`${installation(main)}/finalize`, common(ready)); assert.equal(rebound.status, 'COMPLETE'); assert.ok(rebound.currentRevision > complete.currentRevision);
    assert.deepEqual(await h.ok(`${installation(main)}/revisions/${complete.currentRevision}`), originalRevision);
    complete = rebound; await assertStock();
  });

  const shippingBody = serial => ({ salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', reference: `INSTALL-QA-${key()}`, sources: [{ sourceType: 'WORK_ORDER', sourceId: main._id, quantity: '1', serials: [serial] }], idempotencyKey: key() });
  let firstBody, firstShipment, pointer, immutable;
  await t.test('first shipment freezes both revisions with coordinated WO fencing; later held shipment cannot mutate them', async () => {
    firstBody = shippingBody(mainParents[0].serial); firstShipment = await h.ok('/fulfillment/shipments', firstBody, 201);
    const frozen = await view(main); assert.equal(frozen.status, 'FROZEN'); assert.equal(frozen.frozen.firstShipmentId, firstShipment._id);
    pointer = firstShipment.sources[0].installation;
    assert.deepEqual(pointer, { workOrderId: main._id, revision: frozen.frozen.revision, contentHash: frozen.frozen.contentHash });
    assert.deepEqual((await h.db.collection('manufacturingOutputUnits').findOne({ _id: mainParents[0]._id })).installation, pointer);
    assert.deepEqual((await h.db.collection('warehouseMovements').findOne({ shipmentId: firstShipment._id })).installation, pointer);
    immutable = await h.ok(`${installation(main)}/revisions/${pointer.revision}`);
    const currentChild = frozen.components[0], before = await snapshot();
    const correction = await h.req(`${installation(main)}/record`, recordBody(frozen, mainParents[1], [currentChild]), h.alpha);
    assert.equal(correction.status, 409); assert.equal(correction.error.code, 'INSTALLATION_FROZEN'); assert.deepEqual(await snapshot(), before);
    let active, held;
    const denied = await afterAuthorization('fulfillment.ship', async () => { active = await hold(); held = await snapshot(); }, () => h.req('/fulfillment/shipments', shippingBody(mainParents[1].serial), h.alpha));
    try {
      assert.equal(denied.status, 409); assert.equal(denied.error.code, 'STOCK_ENCUMBERED'); assert.deepEqual(await snapshot(), held);
      assert.deepEqual(await h.ok('/fulfillment/shipments', firstBody, 201), firstShipment); assert.deepEqual(await snapshot(), held);
      assert.deepEqual(await h.ok(`${installation(main)}/record`, winningBody), winningResponse); assert.deepEqual(await snapshot(), held);
      assert.deepEqual(await h.ok(`${installation(main)}/revisions/${pointer.revision}`), immutable);
    } finally { if (active) await clearHold(active); }
    const second = await h.ok('/fulfillment/shipments', shippingBody(mainParents[1].serial), 201); assert.deepEqual(second.sources[0].installation, pointer);
    assert.deepEqual(await h.ok(`${installation(main)}/revisions/${pointer.revision}`), immutable); await assertStock();
  });

  await t.test('committing membership guard denies an acknowledged installation replay before key lookup', async () => {
    const membership = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await snapshot();
    try {
      const result = await afterAuthorization('installation.record', async () => { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } }); }, () => h.req(`${installation(main)}/record`, winningBody, h.alpha));
      assert.equal(result.status, 403); assert.deepEqual(await snapshot(), before);
    } finally { await h.db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } }); }
    assert.deepEqual(await h.ok(`${installation(main)}/record`, winningBody), winningResponse); assert.deepEqual(await snapshot(), before);
  });
});
