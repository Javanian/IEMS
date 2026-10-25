import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

const command = values => ({ expectedVersion: 1, reason: 'Actual internal plan to execution lookup contract', idempotencyKey: randomUUID(), ...values });

test('internal execution plan lookup is scoped, exact, validated and bounded without changing planning authority', async t => {
  const h = await startOwned(t), root = '/internal-execution/orders';
  const item = async (code, kind, trackingPolicy) => {
    const draft = await h.ok('/inventory-master/items', command({ code, description: `Lookup ${code}`, kind, uom: 'UN', schema: 'INVENTORY_ITEM_V2', trackingPolicy }), 201);
    return h.ok(`/inventory-master/items/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: 1 }));
  };
  const material = await item('LOOKUP_INPUT', 'PURCHASED', 'LOT'), output = await item('LOOKUP_OUTPUT', 'MANUFACTURED', 'SERIAL');
  const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, code: 'LOOKUP-BIN', idempotencyKey: randomUUID() }, 201), locationDraft = await h.ok('/inventory-master/locations', command({ code: 'LOOKUP_LOCATION', binId: bin._id }), 201), location = await h.ok(`/inventory-master/locations/${locationDraft._id}/qualify`, command({ expectedVersion: locationDraft.version }));
  const plan = async () => {
    const draft = await h.ok('/internal-production/orders', command({ itemId: output._id, itemRevision: output.currentRevision, expectedItemVersion: output.version, locationId: location._id, expectedLocationVersion: location.version, quantity: '1' }), 201);
    const engineering = await h.ok(`/internal-production/orders/${draft._id}/engineering/revisions`, command({ expectedVersion: draft.version, operations: [{ code: 'ASSEMBLE', instruction: 'Actual approved assembly demand' }], materials: [{ itemId: material._id, itemRevision: material.currentRevision, expectedItemVersion: material.version, quantityPerUnit: '1', uom: 'UN' }] }));
    return h.ok(`/internal-production/orders/${draft._id}/engineering/approve`, command({ expectedVersion: engineering.version, revision: 1 }));
  };
  const bound = await plan(), unbound = await plan(), execution = await h.ok(root, command({ internalOrderId: bound._id, expectedOrderVersion: bound.version, engineeringRevision: 1 }), 201);
  const names = ['internalExecutions', 'internalExecutionEvents', 'internalExecutionKeys', 'internalExecutionAudit', 'internalExecutionOutbox', 'internalProductionOrders', 'internalProductionEvents', 'internalPlanningKeys', 'catalogUseHeads', 'warehouseReceipts'];
  const snapshot = () => Promise.all(names.map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray())), before = await snapshot();
  const lookup = (internalOrderId, suffix = '', cookie = h.alpha) => h.req(`${root}?internalOrderId=${internalOrderId}${suffix}`, undefined, cookie);

  await t.test('existing plan resolves the complete authoritative execution view and ordinary list stays unchanged', async () => {
    const result = await lookup(bound._id, '&limit=1');
    assert.equal(result.status, 200); assert.equal(result.data.length, 1); assert.equal(result.data[0]._id, execution._id); assert.equal(result.data[0].internalOrderId, bound._id);
    assert.deepEqual(result.data[0], await h.ok(`${root}/${execution._id}`)); assert.deepEqual(result.page, { limit: 1, nextCursor: null });
    assert.deepEqual((await h.req(root, undefined, h.alpha)).data.map(row => row._id), [execution._id]);
    assert.deepEqual((await lookup(bound._id, `&cursor=${execution._id}`)).data, []);
    const historicalPlan = await h.ok(`/internal-production/orders/${bound._id}`); assert.equal(historicalPlan.canExecute, false); assert.equal(historicalPlan.execution, 'NOT_IMPLEMENTED');
  });
  await t.test('actual plan without execution, absent UUID and foreign UUID all return the same empty bounded envelope', async () => {
    for (const [internalOrderId, cookie] of [[unbound._id, h.alpha], [randomUUID(), h.alpha], [bound._id, h.beta]]) {
      const result = await lookup(internalOrderId, '', cookie); assert.equal(result.status, 200); assert.deepEqual(result.data, []); assert.deepEqual(result.page, { limit: 25, nextCursor: null });
    }
  });
  await t.test('malformed and multivalued IDs are rejected, and permission denial precedes identifier validation', async () => {
    for (const value of ['', 'not-a-uuid', 'null', `${bound._id}&internalOrderId=${unbound._id}`]) {
      const result = await lookup(value); assert.equal(result.status, 400); assert.equal(result.error.code, 'INVALID_ID');
    }
    const restore = await h.setRoles(h.seeded[0], ['catalogReader']);
    try { for (const value of [bound._id, 'not-a-uuid']) assert.equal((await lookup(value)).status, 403); } finally { await restore(); }
    const restoreReader = await h.setRoles(h.seeded[0], ['internalExecutionReader']);
    try { assert.equal((await lookup(bound._id)).data[0]._id, execution._id); } finally { await restoreReader(); }
  });
  await t.test('exact scope-plan unique index bounds positive and absent lookups and GET has no effects', async () => {
    const scope = await h.scopeOf(h.alpha), filter = { tenantId: scope.tenantId, plantId: scope.selectedPlantId };
    for (const [internalOrderId, expected] of [[bound._id, 1], [randomUUID(), 0]]) {
      const explained = await h.db.collection('internalExecutions').find({ ...filter, internalOrderId }).hint({ tenantId: 1, plantId: 1, internalOrderId: 1 }).sort({ _id: 1 }).limit(2).explain('executionStats');
      assert.equal(explained.executionStats.nReturned, expected); assert.ok(explained.executionStats.totalKeysExamined <= 1); assert.ok(explained.executionStats.totalDocsExamined <= 1);
    }
    assert.deepEqual(await snapshot(), before);
  });
});
