import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

test('bounded operator labor real HTTP owned Mongo', async t => {
  const h = await startOwned(t), { db, ok } = h;
  assert.match(db.databaseName, /^portfolio_test_/);
  console.log(JSON.stringify({ ownedDatabase: db.databaseName, marker: await db.collection('ownedRun').findOne(), cleanup: 'fixture verifies marker then drops DB and stops owned replica' }));
  const { so, receipt } = await orderWithStock(h, { orderQuantity: '4', receiptQuantity: '10', reserve: null });
  const cmd = b => ({ expectedVersion: 1, idempotencyKey: randomUUID(), ...b });
  const orders = (await ok('/manufacturing/work-orders', cmd({ salesOrderId: so._id, lineIndex: 0, quantities: ['1', '1', '1', '1'], uom: 'KG' }), 201)).workOrders;
  const path = i => `/manufacturing/work-orders/${orders[i]._id}`;
  const released = [];
  for (let i = 0; i < 3; i++) released.push(await ok(`${path(i)}/release`, cmd({ operations: [{ code: 'MIX', instruction: 'Mix' }, { code: 'PACK', instruction: 'Pack' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }] })));
  const operatorId = (await h.scopeOf(h.alpha)).userId;
  await new Promise(r => setTimeout(r, 40));
  const start = Date.now() - 20;
  const interval = (a = 0, b = 5) => ({ startedAt: new Date(start + a).toISOString(), endedAt: new Date(start + b).toISOString(), durationMs: b - a });
  const body = cmd({ expectedVersion: 2, operationIndex: 0, operatorId, ...interval(), evidence: 'Synthetic operator work claim' });
  let entry;
  await t.test('persist scoped immutable operation labor and original receipt replay', async () => {
    entry = await ok(`${path(0)}/labor`, body, 201);
    assert.equal(entry.workOrderId, orders[0]._id);
    assert.equal(entry.operatorId, operatorId); assert.equal(entry.recordedBy, operatorId);
    assert.equal(entry.code, 'MIX'); assert.equal(entry.durationMs, 5);
    assert.equal(entry.executionMode, 'OPERATOR_RECORDED'); assert.equal(entry.version, 3);
    assert.deepEqual(await ok(`${path(0)}/labor`, body, 201), entry);
    assert.deepEqual(await ok(`${path(0)}/labor?limit=1`), [entry]);
    assert.equal((await ok(path(0))).version, 3);
    assert.equal(await db.collection('manufacturingLabor').countDocuments(), 1);
  });
  const names = ['manufacturingLabor', 'manufacturingWorkOrders', 'manufacturingMovements', 'warehouseReceipts', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  await t.test('malformed identity scope version state sequence and overlap denials leave no effects', async () => {
    const before = await snapshot();
    for (const patch of [{ durationMs: '5' }, { durationMs: 0 }, { durationMs: 1.5 }, { durationMs: 86400001 }, { durationMs: 4 }, { startedAt: '2026-02-30T00:00:00.000Z' }, { operationIndex: -1 }, { operationIndex: 50 }, { evidence: '' }, { payroll: true }]) {
      assert.equal((await h.req(`${path(1)}/labor`, { ...body, idempotencyKey: randomUUID(), ...patch }, h.alpha)).status, 400, JSON.stringify(patch));
    }
    for (const [i, patch, status] of [[1, { operatorId: randomUUID() }, 403], [1, { expectedVersion: 1 }, 409], [1, { operationIndex: 1 }, 409], [1, {}, 409], [0, { expectedVersion: 3 }, 409], [3, { expectedVersion: 1 }, 409], [1, { tenant_id: h.seeded[1].tenantId }, 403], [1, { ...interval(-10000, -9995) }, 409], [1, { ...interval(100000, 100005) }, 409]]) {
      assert.equal((await h.req(`${path(i)}/labor`, { ...body, idempotencyKey: randomUUID(), ...patch }, h.alpha)).status, status);
    }
    assert.equal((await h.req(`${path(0)}/labor`, { ...body, evidence: 'changed' }, h.alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await h.req(`${path(0)}/labor`, undefined, h.beta)).status, 404);
    assert.equal((await h.req(`${path(0)}/labor`, body)).status, 401);
    const restore = await h.setRoles(h.seeded[0], ['manufacturingRead']);
    try { assert.equal((await h.req(`${path(0)}/labor`, body, h.alpha)).status, 403); } finally { await restore(); }
    const foundation = h.runtime.foundation; let undo;
    h.runtime.foundation = { ...foundation, authorize: async (...args) => { const r = await foundation.authorize(...args); undo = await h.setRoles(h.seeded[0], ['manufacturingRead']); return r; } };
    try { assert.equal((await h.req(`${path(0)}/labor`, body, h.alpha)).status, 403); } finally { h.runtime.foundation = foundation; if (undo) await undo(); }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('real ledger audit outbox validators rollback all effects; concurrent replay once', async () => {
    const next = { ...body, idempotencyKey: randomUUID(), ...interval(5, 10) };
    for (const name of ['manufacturingLabor', 'manufacturingAudit', 'manufacturingOutbox']) {
      const before = await snapshot();
      await db.command({ collMod: name, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try { assert.equal((await h.req(`${path(1)}/labor`, next, h.alpha)).status, 500); assert.deepEqual(await snapshot(), before); }
      finally { await db.command({ collMod: name, validator: {} }); }
    }
    const results = await Promise.all([1, 2, 3].map(() => h.req(`${path(1)}/labor`, next, h.alpha)));
    assert.deepEqual(results.map(r => r.status), [201, 201, 201]);
    assert.deepEqual(results[0].data, results[1].data); assert.deepEqual(results[1].data, results[2].data);
    assert.equal(await db.collection('manufacturingLabor').countDocuments(), 2);
  });
  await t.test('distinct-key cross-WO overlaps serialize; ordered adjacent second operation retains first receipt', async () => {
    const fourth = await ok(`${path(3)}/release`, cmd({ operations: [{ code: 'MIX', instruction: 'Mix' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }] }));
    await new Promise(r => setTimeout(r, 30));
    const a = Date.now() - 20;
    const span = { startedAt: new Date(a).toISOString(), endedAt: new Date(a + 5).toISOString(), durationMs: 5 };
    const results = await Promise.all([2, 3].map(i => h.req(`${path(i)}/labor`, { ...body, ...span, expectedVersion: i === 3 ? fourth.version : 2, idempotencyKey: randomUUID() }, h.alpha)));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const wo = await ok(`${path(0)}/record`, cmd({ expectedVersion: 3, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic output' }));
    const last = await ok(`${path(0)}/labor`, { ...body, expectedVersion: wo.version, operationIndex: 1, idempotencyKey: randomUUID(), ...interval(10, 15) }, 201);
    assert.equal(last.code, 'PACK');
    assert.deepEqual(await ok(`${path(0)}/labor`, body, 201), entry);
    const page = await h.req(`${path(0)}/labor?limit=1`, undefined, h.alpha);
    assert.ok(page.page.nextCursor);
    assert.equal((await ok(`${path(0)}/labor?limit=1&cursor=${page.page.nextCursor}`)).length, 1);
    assert.equal((await h.req(`${path(0)}/labor?limit=101`, undefined, h.alpha)).status, 400);
    assert.equal(await db.collection('manufacturingAudit').countDocuments({ kind: 'workOrder.labor' }), 4);
    assert.equal(await db.collection('manufacturingOutbox').countDocuments({ kind: 'workOrder.labor', state: 'PENDING' }), 4);
  });
  await t.test('same-WO distinct keys race once; terminal writes and revoked-session replay denied', async () => {
    const wo = await ok(`${path(1)}/record`, cmd({ expectedVersion: 3, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic output' }));
    await new Promise(r => setTimeout(r, 30));
    const a = Date.now() - 20;
    const next = { ...body, operationIndex: 1, expectedVersion: wo.version, startedAt: new Date(a).toISOString(), endedAt: new Date(a + 5).toISOString(), durationMs: 5 };
    const results = await Promise.all([1, 2].map(() => h.req(`${path(1)}/labor`, { ...next, idempotencyKey: randomUUID() }, h.alpha)));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const done = await ok(`${path(1)}/record`, cmd({ expectedVersion: 5, operationIndex: 1, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic final output' }));
    const before = await snapshot();
    assert.equal((await h.req(`${path(1)}/labor`, { ...next, expectedVersion: done.version, idempotencyKey: randomUUID() }, h.alpha)).error.code, 'STATE_CONFLICT');
    await ok('/session/logout', {});
    assert.equal((await h.req(`${path(0)}/labor`, body, h.alpha)).status, 401);
    assert.deepEqual(await snapshot(), before);
  });
});
