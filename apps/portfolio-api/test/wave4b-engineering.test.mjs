import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

test('bounded engineering real Mongo HTTP', async t => {
  const h = await startOwned(t), { db, ok } = h;
  const { so, receipt } = await orderWithStock(h, { orderQuantity: '4', receiptQuantity: '20', reserve: null });
  const command = body => ({ expectedVersion: 1, idempotencyKey: randomUUID(), ...body });
  const content = { operations: [{ code: 'MIX', instruction: 'Operator mixes' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '2.000', uom: 'KG' }] };
  const draft = command({ ...content, salesOrderId: so._id, salesOrderVersion: so.version, lineIndex: 0, uom: 'KG' });
  const names = ['engineeringPackages', 'engineeringRevisions', 'manufacturingWorkOrders', 'warehouseReceipts', 'manufacturingMovements', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  let head, release, path, orders;
  await t.test('draft pins actual SO and explicit BOM strings; latest release freezes content', async () => {
    head = await ok('/manufacturing/engineering', draft, 201);
    path = `/manufacturing/engineering/${head._id}`;
    assert.equal(head.currentRevision, 1); assert.equal(head.status, 'DRAFT');
    const r = await ok(`${path}/revisions/1`);
    assert.equal(r.materials[0].quantityPerUnit, '2.000');
    assert.equal((await ok('/manufacturing/engineering?limit=1')).length, 1);
    release = command({ revision: 1 });
    head = await ok(`${path}/release`, release);
    assert.equal(head.status, 'RELEASED'); assert.equal(head.version, 2);
    const rev = await ok(`${path}/revisions/1`);
    assert.deepEqual(rev.releaseSnapshot.materials, content.materials);
    orders = (await ok('/manufacturing/work-orders', command({ salesOrderId: so._id, lineIndex: 0, quantities: ['1', '1', '1', '1'], uom: 'KG' }), 201)).workOrders;
    const body = command({ engineeringId: head._id, engineeringVersion: 2, revision: 1 });
    const wo = await ok(`/manufacturing/work-orders/${orders[0]._id}/release-engineering`, body);
    assert.equal(wo.status, 'RELEASED'); assert.equal(wo.routing.materials[0].quantity, '2');
    assert.deepEqual(wo.engineeringSnapshot.releaseSnapshot, rev.releaseSnapshot);
    assert.equal((await db.collection('warehouseReceipts').findOne({ _id: receipt._id })).availableQuantity, '18');
  });
  const send = (p, b, cookie = h.alpha) => h.req(p, b, cookie);
  const woPath = i => `/manufacturing/work-orders/${orders[i]._id}/release-engineering`;
  const use = extra => command({ engineeringId: head._id, engineeringVersion: head.version, revision: head.currentRevision, ...extra });
  await t.test('scope role revocation malformed references versions and keys have no durable effects', async () => {
    const before = await snapshot();
    for (const patch of [{ expectedVersion: 99 }, { revision: 2 }, { engineeringVersion: 1 }]) assert.equal((await send(woPath(1), use(patch))).status, 409);
    assert.equal((await send(woPath(1), use({ engineeringId: randomUUID() }))).status, 404);
    assert.equal((await send(path, undefined, h.beta)).status, 404);
    assert.equal((await send('/manufacturing/engineering', { ...draft, idempotencyKey: randomUUID(), salesOrderId: randomUUID() })).status, 404);
    assert.equal((await send(woPath(1), use({ tenant_id: h.seeded[1].tenantId }))).status, 403);
    assert.equal((await send(woPath(1), use({ operations: content.operations }))).status, 400);
    for (const value of [1, '0', '1e0', '-1', '0.0000001']) assert.equal((await send(`${path}/revisions`, command({ expectedVersion: 2, ...content, materials: [{ ...content.materials[0], quantityPerUnit: value }] }))).status, 400);
    assert.equal((await send(`${path}/release`, { ...release, revision: 2 })).error.code, 'IDEMPOTENCY_CONFLICT');
    const restore = await h.setRoles(h.seeded[0], ['manufacturingRead']);
    try { assert.equal((await send(woPath(1), use())).status, 403); } finally { await restore(); }
    const foundation = h.runtime.foundation;
    let undo;
    h.runtime.foundation = { ...foundation, authorize: async (...args) => { const r = await foundation.authorize(...args); undo = await h.setRoles(h.seeded[0], ['manufacturingRead']); return r; } };
    try { assert.equal((await send(woPath(1), use())).status, 403); } finally { h.runtime.foundation = foundation; if (undo) await undo(); }
    assert.deepEqual(await snapshot(), before);
  });
  async function rollback(p, body, expected = 200) {
    for (const name of ['manufacturingAudit', 'manufacturingOutbox']) {
      const before = await snapshot();
      await db.command({ collMod: name, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try { assert.equal((await send(p, body)).status, 500); assert.deepEqual(await snapshot(), before); }
      finally { await db.command({ collMod: name, validator: {} }); }
    }
    const results = await Promise.all([1, 2, 3].map(() => send(p, body)));
    assert.deepEqual(results.map(r => r.status), [expected, expected, expected], JSON.stringify(results));
    assert.deepEqual(results[0].data, results[1].data); assert.deepEqual(results[1].data, results[2].data);
    return results[0].data;
  }
  await t.test('audit and outbox rollback draft revision release WO reservation and revoke; replay once', async () => {
    const extra = await rollback('/manufacturing/engineering', { ...draft, idempotencyKey: randomUUID() }, 201);
    assert.equal(extra.status, 'DRAFT');
    head = await rollback(`${path}/revisions`, command({ expectedVersion: 2, ...content }));
    assert.equal(head.currentRevision, 2);
    head = await rollback(`${path}/release`, command({ expectedVersion: 3, revision: 2 }));
    const wo = await rollback(woPath(1), use());
    assert.equal(wo.status, 'RELEASED');
    const frozen = await db.collection('manufacturingWorkOrders').findOne({ _id: orders[1]._id });
    const rev = await ok(`${path}/revisions/2`);
    head = await rollback(`${path}/revoke`, command({ expectedVersion: 4, revision: 2, reason: 'Synthetic supersession' }));
    assert.equal((await send(woPath(2), use())).error.code, 'STATE_CONFLICT');
    assert.deepEqual(await db.collection('manufacturingWorkOrders').findOne({ _id: orders[1]._id }), frozen);
    assert.deepEqual(await ok(`${path}/revisions/2`), rev);
    assert.equal((await ok(`${path}/release`, release)).version, 2);
  });
  await t.test('source mismatch stale package selection and explicit UOM denials preserve stock and WO', async () => {
    const other = await orderWithStock(h, { orderQuantity: '1', reserve: null });
    const otherWo = (await ok('/manufacturing/work-orders', command({ salesOrderId: other.so._id, lineIndex: 0, quantities: ['1'], uom: 'KG' }), 201)).workOrders[0];
    const before = await snapshot();
    assert.equal((await send('/manufacturing/engineering', { ...draft, idempotencyKey: randomUUID(), materials: [{ ...content.materials[0], uom: 'EA' }] })).error.code, 'UOM_CONFLICT');
    assert.equal((await send('/manufacturing/engineering', { ...draft, idempotencyKey: randomUUID(), materials: [null] })).status, 400);
    assert.equal((await send('/manufacturing/engineering', { ...draft, idempotencyKey: randomUUID(), salesOrderVersion: 99 })).error.code, 'VERSION_CONFLICT');
    assert.deepEqual(await snapshot(), before);
    const otherHead = await ok('/manufacturing/engineering', { ...draft, idempotencyKey: randomUUID() }, 201);
    const otherPath = `/manufacturing/engineering/${otherHead._id}`;
    await ok(`${otherPath}/release`, command({ revision: 1 }));
    const prior = await snapshot();
    assert.equal((await send(`/manufacturing/work-orders/${otherWo._id}/release-engineering`, command({ engineeringId: otherHead._id, engineeringVersion: 2, revision: 1 }))).error.code, 'SOURCE_CONFLICT');
    assert.equal((await send(woPath(2), command({ engineeringId: otherHead._id, engineeringVersion: 2, revision: 2 }))).error.code, 'REVISION_CONFLICT');
    assert.deepEqual(await snapshot(), prior);
    const revisionCommand = command({ expectedVersion: 2, ...content });
    const races = await Promise.all([1, 2].map(() => send(`${otherPath}/revisions`, { ...revisionCommand, idempotencyKey: randomUUID() })));
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
    assert.equal(await db.collection('engineeringRevisions').countDocuments({ engineeringId: otherHead._id }), 2);
  });
  await t.test('stale revision cannot release after replacement; same and distinct key races serialize', async () => {
    head = await ok(`${path}/revisions`, command({ expectedVersion: 5, ...content }));
    assert.equal((await send(`${path}/release`, command({ expectedVersion: 6, revision: 2 }))).error.code, 'REVISION_CONFLICT');
    head = await ok(`${path}/release`, command({ expectedVersion: 6, revision: 3 }));
    const races = await Promise.all([1, 2].map(() => send(woPath(2), use())));
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
    const useBody = use();
    const revokeBody = command({ expectedVersion: head.version, revision: 3, reason: 'Concurrent revocation' });
    const [wo, revoked] = await Promise.all([send(woPath(3), useBody), send(`${path}/revoke`, revokeBody)]);
    assert.equal(revoked.status, 200); assert.ok([200, 409].includes(wo.status));
    const stored = await db.collection('manufacturingWorkOrders').findOne({ _id: orders[3]._id });
    assert.equal(stored.status, wo.status === 200 ? 'RELEASED' : 'PLANNED');
    assert.equal(await db.collection('manufacturingMovements').countDocuments({ workOrderId: stored._id, kind: 'MATERIAL_RESERVED' }), wo.status === 200 ? 1 : 0);
    assert.equal((await send(woPath(3), use({ engineeringVersion: 8 }))).status, 409);
  });
});
