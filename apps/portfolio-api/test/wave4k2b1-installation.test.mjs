import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

const key = () => randomUUID(), command = values => ({ expectedVersion: 1, idempotencyKey: key(), ...values });
const path = wo => `/manufacturing/work-orders/${wo._id}`, base = wo => `${path(wo)}/installations`;

async function fixture(h) {
  const ok = h.ok, prefix = key().slice(0, 8), account = await ok('/crm/accounts', { name: 'Supplemental installation customer' }, 201);
  const quote = await ok('/commercial/quotes', { accountId: account._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', expiresAt: '2027-01-01T00:00:00.000Z', lines: [{ description: 'Supplemental installation assembly', quantity: '4', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 }); await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await ok('/procurement/vendors', { name: 'Supplemental installation supplier' }, 201), lines = [1, 2].map((ratio, index) => ({ description: `Supplemental component ${index}`, quantity: String(4 * ratio), uom: index ? 'SET' : 'UN', unitPrice: '1.00', currency: 'USD' }));
  const pr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines }, 201); await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() }); await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipts = [];
  for (let index = 0; index < lines.length; index++) {
    const receipt = await ok('/warehouse/receipts', command({ expectedVersion: 2, purchaseOrderId: po._id, vendorId: vendor._id, lineIndex: index, quantity: lines[index].quantity, uom: lines[index].uom, serials: Array.from({ length: Number(lines[index].quantity) }, (_, n) => `${prefix}_IN_${index}_${n}`), lotNumber: `${prefix}_LOT_${index}`, heatNumber: `${prefix}_HEAT_${index}` }), 201);
    await ok(`/warehouse/receipts/${receipt._id}/release`, command({ reason: 'Supplemental inspection' })); await ok(`/warehouse/receipts/${receipt._id}/putaway`, command({ expectedVersion: 2, location: 'INSTALLATION-BIN' })); await ok(`/warehouse/receipts/${receipt._id}/serial-custody/adopt`, command({ expectedVersion: 3, reason: 'Supplemental unused identity adoption' })); receipts.push(receipt);
  }
  const wos = (await ok('/manufacturing/work-orders', command({ expectedVersion: so.version, salesOrderId: so._id, lineIndex: 0, quantities: ['2', '1', '1'], uom: 'UN', serialized: true, genealogyRequired: true, serialCustodyRequired: true, installationRequired: true }), 201)).workOrders;
  const parents = [];
  for (let wi = 0; wi < wos.length; wi++) {
    const wo = wos[wi];
    for (let index = 0; index < receipts.length; index++) {
      const source = await ok(`/warehouse/receipts/${receipts[index]._id}/serial-custody`), current = await ok(path(wo));
      await ok(`${path(wo)}/serial-claims`, command({ expectedVersion: current.version, expectedReceiptVersion: source.receiptVersion, receiptId: receipts[index]._id, serialUnitIds: source.units.filter(u => u.status === 'AVAILABLE').slice(0, Number(wo.quantity) * (index + 1)).map(u => u._id), reason: 'Supplemental installation source claim' }));
    }
    const claims = await ok(`${path(wo)}/serial-claims`);
    const release = await ok(`${path(wo)}/release`, command({ expectedVersion: claims.workOrderVersion, operations: [{ code: 'ASSEMBLE', instruction: 'Supplemental assembly record' }], materials: receipts.map((r, index) => ({ receiptId: r._id, quantityPerUnit: String(index + 1), uom: lines[index].uom })), serialClaims: claims.claims.map(c => ({ receiptId: c.receiptId, claimId: c._id })) }));
    const good = wi === 2 ? '0' : wo.quantity, serials = Array.from({ length: Number(good) }, (_, n) => `${prefix}_OUT_${wi}_${n}`);
    const recorded = await ok(`${path(wo)}/record`, command({ expectedVersion: release.version, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: good, scrapQuantity: wi === 2 ? '1' : '0', uom: 'UN', evidence: 'Supplemental assembly output', outputSerials: serials }));
    await ok(`${path(wo)}/qc`, command({ expectedVersion: recorded.version, acceptedQuantity: good, rejectedQuantity: '0', uom: 'UN', evidence: 'Supplemental QC acceptance', acceptedSerials: serials, rejectedSerials: [] }));
    parents.push(await ok(`${path(wo)}/output-units`));
    for (const parent of parents[wi]) {
      const k1 = await ok(`${path(wo)}/genealogy`);
      await ok(`${path(wo)}/genealogy/allocations`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, outputUnitId: parent._id, materials: receipts.map((r, index) => ({ receiptId: r._id, quantity: String(index + 1), uom: lines[index].uom })), reason: 'Supplemental per-output lot allocation', idempotencyKey: key() });
    }
    if (wi === 2) { const k1 = await ok(`${path(wo)}/genealogy`); await ok(`${path(wo)}/genealogy/losses`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, losses: receipts.map((r, index) => ({ receiptId: r._id, quantity: String(index + 1), uom: lines[index].uom, reason: 'Supplemental zero-good process loss' })), reason: 'Explicit zero-good lot disposition', idempotencyKey: key() }); }
    const k1 = await ok(`${path(wo)}/genealogy`); await ok(`${path(wo)}/genealogy/finalize`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, reason: 'Supplemental reconciled lot genealogy', idempotencyKey: key() });
  }
  return { so, receipts, wos, parents };
}

test('K2b1 received-only installation conserves identities, source versions, K1 binding and frozen dispatch', async t => {
  const h = await startOwned(t), data = await fixture(h), [wo, removedWo, lossWo] = data.wos;
  const get = workOrder => h.ok(base(workOrder));
  const mutate = async (workOrder, action, values = {}) => { const v = await get(workOrder), body = { expectedVersion: v.workOrderVersion, expectedInstallationVersion: v.version, reason: 'Supplemental operator installation evidence', idempotencyKey: key(), ...values }; return { body, response: await h.req(`${base(workOrder)}/${action}`, body, h.alpha) }; };
  const selected = units => units.map(u => ({ serialUnitId: u._id, expectedUnitVersion: u.version }));
  const names = ['manufacturingWorkOrders', 'manufacturingOutputUnits', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox', 'serialCustodyUnits', 'serialCustodyClaims', 'warehouseReceipts', 'warehouseMovements', 'manufacturingMovements', 'componentInstallationHeads', 'componentInstallationLinks', 'componentInstallationRevisions', 'componentInstallationEvents', 'componentInstallationGraph'];
  const snapshot = () => Promise.all(names.map(n => h.db.collection(n).find().sort({ _id: 1 }).toArray()));
  const stock = async () => (await h.db.collection('warehouseReceipts').find({ _id: { $in: data.receipts.map(r => r._id) } }).sort({ _id: 1 }).toArray()).map(row => Object.fromEntries(['_id', 'quantity', 'availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].map(k => [k, row[k]])));
  const initialStock = await stock();
  let firstBody;
  await t.test('read shows eligible consumed identities; invalid parent/foreign/type/version/ratio inputs retain all state', async () => {
    const initial = await get(wo); assert.equal(initial.status, 'UNRECORDED'); assert.equal(initial.components.length, 6); assert.equal(initial.parents.length, 2); assert.ok(initial.components.every(c => c.status === 'CONSUMED' && c.disposition === null));
    const before = await snapshot(), one = initial.components.find(c => c.receiptId === data.receipts[0]._id);
    for (const values of [{ outputUnitId: data.parents[1][0]._id, components: selected([one]) }, { outputUnitId: initial.parents[0]._id, components: [{ serialUnitId: key(), expectedUnitVersion: 1 }] }, { outputUnitId: initial.parents[0]._id, components: [{ ...selected([one])[0], childType: 'OUTPUT' }] }, { outputUnitId: initial.parents[0]._id, components: [{ serialUnitId: one._id, expectedUnitVersion: one.version + 1 }] }, { outputUnitId: initial.parents[0]._id, components: selected(initial.components.filter(c => c.receiptId === data.receipts[0]._id)) }]) assert.ok([400, 404, 409].includes((await mutate(wo, 'record', values)).response.status));
    assert.equal((await h.req(base(wo), undefined, h.beta)).status, 404); assert.deepEqual(await snapshot(), before);
  });
  await t.test('rollback leaves no edge/pointer/graph effect; two parents cannot own the same child', async () => {
    const current = await get(wo), unit = current.components.find(c => c.receiptId === data.receipts[0]._id), before = await snapshot();
    await h.db.command({ collMod: 'manufacturingOutbox', validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await mutate(wo, 'record', { outputUnitId: current.parents[0]._id, components: selected([unit]) })).response.status, 500); assert.deepEqual(await snapshot(), before); } finally { await h.db.command({ collMod: 'manufacturingOutbox', validator: {} }); }
    const bodies = current.parents.map(parent => ({ expectedVersion: current.workOrderVersion, expectedInstallationVersion: current.version, outputUnitId: parent._id, components: selected([unit]), reason: 'Competing explicit parent records', idempotencyKey: key() }));
    const result = await Promise.all(bodies.map(body => h.req(`${base(wo)}/record`, body, h.alpha))); assert.deepEqual(result.map(r => r.status).sort(), [200, 409], JSON.stringify(result));
    const winner = result.findIndex(r => r.status === 200); firstBody = bodies[winner];
    assert.deepEqual((await h.req(`${base(wo)}/record`, firstBody, h.alpha)).data, result[winner].data);
    assert.equal((await h.req(`${base(wo)}/record`, { ...firstBody, reason: 'Changed evidence payload' }, h.alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await h.db.collection('componentInstallationLinks').countDocuments({ childId: unit._id }), 1);
  });
  await t.test('explicit per-parent ratios1/2 reconcile all children without stock or claim state change', async () => {
    let v = await get(wo);
    for (const parent of v.parents) {
      v = await get(wo); const picks = [];
      for (let index = 0; index < data.receipts.length; index++) { const existing = v.edges.filter(e => e.status === 'ACTIVE' && e.outputUnitId === parent._id && e.receiptId === data.receipts[index]._id).length; picks.push(...v.components.filter(c => c.disposition === null && c.receiptId === data.receipts[index]._id).slice(0, index + 1 - existing)); }
      if (picks.length) assert.equal((await mutate(wo, 'record', { outputUnitId: parent._id, components: selected(picks) })).response.status, 200);
    }
    v = await get(wo); assert.equal(v.canFinalize, true); assert.equal(v.edges.length, 6); assert.ok(v.balances.every(b => b.unassignedQuantity === '0'));
    assert.deepEqual(await stock(), initialStock); assert.ok((await h.db.collection('serialCustodyClaims').find().toArray()).every(c => c.status === 'CONSUMED'));
    assert.equal((await mutate(wo, 'finalize')).response.status, 200);
    const page = await h.req(`${base(wo)}/revisions?limit=2`, undefined, h.alpha); assert.equal(page.status, 200); assert.equal(page.data.length, 2); assert.ok(page.page.nextCursor); assert.ok(page.data.every(r => !Object.hasOwn(r, 'edges')));
  });
  await t.test('K1 correction invalidates old completion, explicit re-finalize preserves immutable snapshots', async () => {
    const old = await get(wo), oldRevision = await h.ok(`${base(wo)}/revisions/${old.currentRevision}`), parent = data.parents[0][0];
    let k1 = await h.ok(`${path(wo)}/genealogy`);
    await h.ok(`${path(wo)}/genealogy/allocations`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, outputUnitId: parent._id, materials: data.receipts.map((r, index) => ({ receiptId: r._id, quantity: String(index + 1), uom: index ? 'SET' : 'UN' })), reason: 'Controlled lot evidence reconfirmation', idempotencyKey: key() });
    assert.equal((await get(wo)).canFinalize, false);
    const blockedShip = { salesOrderId: data.so._id, expectedVersion: data.so.version, lineIndex: 0, uom: 'UN', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: '1', serials: [parent.serial] }], reference: 'Old installation cannot ship', idempotencyKey: key() };
    assert.equal((await h.req('/fulfillment/shipments', blockedShip, h.alpha)).status, 409);
    k1 = await h.ok(`${path(wo)}/genealogy`); await h.ok(`${path(wo)}/genealogy/finalize`, { expectedVersion: k1.workOrderVersion, expectedGenealogyVersion: k1.version, reason: 'Reconciled new lot evidence', idempotencyKey: key() });
    assert.equal((await get(wo)).canFinalize, true); assert.equal((await mutate(wo, 'finalize')).response.status, 200); assert.deepEqual(await h.ok(`${base(wo)}/revisions/${old.currentRevision}`), oldRevision);
  });
  await t.test('permanent removal retires a source identity and cannot qualify as normal process loss', async () => {
    let v = await get(removedWo); const parent = v.parents[0]; assert.equal((await mutate(removedWo, 'record', { outputUnitId: parent._id, components: selected(v.components) })).response.status, 200);
    v = await get(removedWo); const edge = v.edges[0], unit = v.components.find(c => c._id === edge.childId);
    assert.equal((await mutate(removedWo, 'remove', { edgeId: edge._id, expectedEdgeVersion: edge.version, expectedUnitVersion: unit.version })).response.status, 200);
    v = await get(removedWo); assert.ok(v.blockers.includes('REMOVED_COMPONENT_QUARANTINE')); assert.equal(v.components.find(c => c._id === unit._id).disposition, 'REMOVED_QUARANTINE');
    assert.equal((await mutate(removedWo, 'record', { outputUnitId: parent._id, components: selected([v.components.find(c => c._id === unit._id)]) })).response.error.code, 'INSTALLATION_CHILD_UNAVAILABLE');
    assert.equal((await mutate(removedWo, 'losses', { components: selected([v.components.find(c => c._id === unit._id)]) })).response.error.code, 'INSTALLATION_CHILD_UNAVAILABLE');
    assert.equal((await mutate(removedWo, 'finalize')).response.error.code, 'INSTALLATION_INCOMPLETE');
  });
  await t.test('zero-good inputs need explicit permanent serial losses without fabricated parents', async () => {
    let v = await get(lossWo); assert.equal(v.parents.length, 0); assert.equal(v.components.length, 3);
    assert.equal((await mutate(lossWo, 'losses', { components: selected(v.components) })).response.status, 200);
    v = await get(lossWo); assert.equal(v.canFinalize, true); assert.equal(v.losses.length, 3);
    assert.equal((await mutate(lossWo, 'losses', { components: selected([v.components[0]]) })).response.error.code, 'INSTALLATION_CHILD_UNAVAILABLE');
    assert.equal((await mutate(lossWo, 'finalize')).response.status, 200);
  });
  await t.test('scoped role revocation blocks fresh and replayed effects at the committing fence', async () => {
    const before = await snapshot(), member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), foundation = h.runtime.foundation;
    for (const body of [firstBody, { ...firstBody, idempotencyKey: key() }]) {
      h.runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'installationReader', plantIds: member.plantIds }] } }); return result; } };
      try { assert.equal((await h.req(`${base(wo)}/record`, body, h.alpha)).status, 403); } finally { h.runtime.foundation = foundation; await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('partial dispatch freezes installation and source holds rechecked before remaining dispatch', async () => {
    const ship = parent => ({ salesOrderId: data.so._id, expectedVersion: data.so.version, lineIndex: 0, uom: 'UN', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: '1', serials: [parent.serial] }], reference: 'Supplemental installed-unit dispatch', idempotencyKey: key() });
    const firstBody = ship(data.parents[0][0]), first = await h.ok('/fulfillment/shipments', firstBody, 201); assert.ok(first.sources[0].installation.contentHash); assert.equal((await get(wo)).status, 'FROZEN');
    const current = await get(wo), edge = current.edges[0], component = current.components.find(c => c._id === edge.childId);
    assert.equal((await mutate(wo, 'remove', { edgeId: edge._id, expectedEdgeVersion: edge.version, expectedUnitVersion: component.version })).response.error.code, 'INSTALLATION_FROZEN');
    const receipt = await h.db.collection('warehouseReceipts').findOne({ _id: data.receipts[0]._id }), hold = await h.send(`/warehouse/receipts/${receipt._id}/holds`, { body: { expectedReceiptVersion: receipt.version, reasonCode: 'QC_SUSPECT', reasonNote: 'Later component quality concern' }, headers: { 'Idempotency-Key': key() } }); assert.equal(hold.status, 201);
    const nextBody = ship(data.parents[0][1]); assert.equal((await h.req('/fulfillment/shipments', nextBody, h.alpha)).error.code, 'STOCK_ENCUMBERED'); assert.deepEqual((await h.req('/fulfillment/shipments', firstBody, h.alpha)).data, first);
    assert.equal((await h.send(`/warehouse/holds/${hold.data.hold.id}/release`, { body: { expectedVersion: hold.data.hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Inspected component release' }, headers: { 'Idempotency-Key': key() } })).status, 200);
    const second = await h.ok('/fulfillment/shipments', nextBody, 201); assert.deepEqual(second.sources[0].installation, first.sources[0].installation); assert.deepEqual(await stock(), initialStock);
  });
});
