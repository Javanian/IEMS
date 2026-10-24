import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

test('manufacturing owned Mongo HTTP operator-recorded vertical slice', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`), marker = randomUUID();
  await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db }), password = randomUUID(), seeded = await seedSynthetic(runtime, { password });
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  async function req(path, body, cookie) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const alpha = (await req('/session/login', { username: 'alpha.owner', password })).cookie, beta = (await req('/session/login', { username: 'beta.owner', password })).cookie;
  const post = (path, body, cookie = alpha) => req(path, body, cookie);
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic manufactured item', quantity: '1.25', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] };
  const account = (await post('/crm/accounts', { name: 'Synthetic manufacturing customer' })).data;
  const quote = (await post('/commercial/quotes', { ...content, accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' })).data;
  await post(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await post(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = (await post(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: randomUUID() })).data;
  const vendor = (await post('/procurement/vendors', { name: 'Synthetic manufacturing vendor' })).data;
  const pr = (await post('/procurement/requests', { ...content, lines: [{ ...content.lines[0], quantity: '5' }], vendorId: vendor._id })).data;
  await post(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = (await post(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() })).data;
  await post(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = (await post('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '5', uom: 'KG', idempotencyKey: randomUUID() })).data;
  await post(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic inspection', idempotencyKey: randomUUID() });
  await post(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'SYNTHETIC-BIN', idempotencyKey: randomUUID() });
  const split = { salesOrderId: so._id, expectedVersion: so.version, lineIndex: 0, uom: 'KG', quantities: ['0.75', '0.5'], idempotencyKey: randomUUID() };
  const routing = { operations: [{ code: 'MIX', instruction: 'Operator records mixing' }, { code: 'PACK', instruction: 'Operator records packaging' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '2', uom: 'KG' }] };
  let workOrders;
  await t.test('actual SO splits release routing record conserved output then QC without physical execution claims', async () => {
    const result = await post('/manufacturing/work-orders', split);
    assert.equal(result.status, 201, JSON.stringify(result)); workOrders = result.data.workOrders;
    assert.deepEqual(workOrders.map(w => w.quantity), ['0.75', '0.5']);
    const wo = workOrders[0], path = `/manufacturing/work-orders/${wo._id}`;
    let r = await post(`${path}/release`, { expectedVersion: 1, ...routing, idempotencyKey: randomUUID() });
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.status, 'RELEASED');
    r = await post(`${path}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '0.75', goodQuantity: '0.7', scrapQuantity: '0.05', uom: 'KG', evidence: 'Synthetic operator entry MIX-1; not machine telemetry', idempotencyKey: randomUUID() });
    assert.equal(r.status, 200, JSON.stringify(r));
    r = await post(`${path}/record`, { expectedVersion: 3, operationIndex: 1, inputQuantity: '0.7', goodQuantity: '0.65', scrapQuantity: '0.05', uom: 'KG', evidence: 'Synthetic operator entry PACK-1', idempotencyKey: randomUUID() });
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.status, 'QUARANTINED'); assert.equal(r.data.output.quantity, '0.65'); assert.equal(r.data.totalScrapQuantity, '0.1');
    r = await post(`${path}/qc`, { expectedVersion: 4, acceptedQuantity: '0.6', rejectedQuantity: '0.05', uom: 'KG', evidence: 'Synthetic inspector sample record', idempotencyKey: randomUUID() });
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.status, 'QC_COMPLETED'); assert.equal(r.data.qc.recordedBy, seeded[0].userId);
    const stored = await db.collection('manufacturingWorkOrders').findOne({ _id: wo._id });
    assert.equal(stored.executionMode, 'OPERATOR_RECORDED'); assert.equal(stored.records[0].recordedBy, seeded[0].userId);
    assert.equal((await db.collection('warehouseReceipts').findOne({ _id: receipt._id })).availableQuantity, '3.5');
    assert.equal(await db.collection('manufacturingMovements').countDocuments({ kind: 'MATERIAL_CONSUMED' }), 1);
    assert.equal((await db.collection('salesOrders').findOne({ _id: so._id })).version, so.version);
  });
  const names = ['manufacturingWorkOrders', 'manufacturingAllocated', 'manufacturingMovements', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox', 'warehouseReceipts'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  const command = values => ({ expectedVersion: 1, idempotencyKey: randomUUID(), ...values });
  const secondPath = `/manufacturing/work-orders/${workOrders[1]._id}`;
  const record = command({ expectedVersion: 2, operationIndex: 0, inputQuantity: '0.5', goodQuantity: '0', scrapQuantity: '0.5', uom: 'KG', evidence: 'Synthetic all-scrap operator record' });
  await t.test('scope permissions stale versions invalid quantities and premature transitions leave all effects unchanged', async () => {
    const before = await snapshot();
    assert.equal((await post(secondPath, undefined, beta)).status, 404);
    assert.equal((await post('/manufacturing/work-orders', { ...split, tenant_id: seeded[1].tenantId })).status, 403);
    assert.equal((await post(`${secondPath}/record`, record)).status, 409);
    assert.equal((await post(`${secondPath}/qc`, command({ acceptedQuantity: '0', rejectedQuantity: '0', uom: 'KG', evidence: 'Premature' }))).status, 409);
    for (const quantity of [1, '-1', '1e0', '0', '0.0000001']) assert.equal((await post('/manufacturing/work-orders', { ...split, quantities: [quantity], idempotencyKey: randomUUID() })).status, 400);
    for (const patch of [{ uom: 'EA' }, { expectedVersion: 99 }]) assert.equal((await post('/manufacturing/work-orders', { ...split, ...patch, idempotencyKey: randomUUID() })).status, 409);
    assert.equal((await post('/manufacturing/work-orders', { ...split, salesOrderId: randomUUID(), idempotencyKey: randomUUID() })).status, 404);
    assert.equal((await post('/manufacturing/work-orders', { ...split, quantities: ['0.75'] })).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(await snapshot(), before);
    const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const setRole = role => db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role, plantIds: member.plantIds, tenantWide: false }] } });
    try {
      for (const role of ['manufacturingRead', 'manufacturingPlan', 'manufacturingRelease', 'manufacturingRecord', 'manufacturingQc']) {
        await setRole(role); assert.equal((await post('/manufacturing/work-orders')).status, 200);
        for (const action of ['plan', 'release', 'record', 'qc']) if (role.toLowerCase() !== `manufacturing${action}`) assert.equal((await post(action === 'plan' ? '/manufacturing/work-orders' : `${secondPath}/${action}`, command())).status, 403);
      }
    } finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    const foundation = runtime.foundation;
    runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await setRole('manufacturingRead'); return result; } };
    try { assert.equal((await post(`${secondPath}/release`, command(routing))).status, 403); }
    finally { runtime.foundation = foundation; await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    assert.deepEqual(await snapshot(), before);
  });
  async function rollback(path, body, success) {
    for (const collection of ['manufacturingAudit', 'manufacturingOutbox']) {
      const before = await snapshot();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try { const r = await post(path, body); assert.equal(r.status, 500, JSON.stringify(r)); assert.deepEqual(await snapshot(), before); }
      finally { await db.command({ collMod: collection, validator: {} }); }
    }
    const results = await Promise.all([1, 2, 3].map(() => post(path, body)));
    assert.deepEqual(results.map(r => r.status), [success, success, success], JSON.stringify(results));
    assert.deepEqual(results[0].data, results[1].data);
    return results[0].data;
  }
  await t.test('malformed nested routing rejects with no server error or durable effects', async () => {
    const before = await snapshot();
    for (const patch of [{ operations: [null] }, { materials: [null] }, { operations: [7] }]) {
      assert.equal((await post(`${secondPath}/release`, command({ ...routing, ...patch }))).status, 400);
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('release reserves once and audit/outbox failure rolls stock routing and idempotency back', async () => {
    for (const patch of [{ materials: [{ ...routing.materials[0], uom: 'EA' }] }, { materials: [{ ...routing.materials[0], quantityPerUnit: '100' }] }]) assert.equal((await post(`${secondPath}/release`, command({ ...routing, ...patch }))).status, 409);
    assert.equal((await post(`${secondPath}/release`, command({ ...routing, materials: [{ ...routing.materials[0], quantityPerUnit: '0.000001' }] }))).status, 400);
    const row = await rollback(`${secondPath}/release`, command(routing), 200);
    assert.equal(row.status, 'RELEASED');
    assert.equal((await db.collection('warehouseReceipts').findOne({ _id: receipt._id })).availableQuantity, '2.5');
    assert.equal((await post(`${secondPath}/record`, { ...record, operationIndex: 1 })).status, 409);
    assert.equal((await post(`${secondPath}/record`, { ...record, goodQuantity: '0.1' })).status, 409);
    assert.equal((await post(`${secondPath}/record`, { ...record, uom: 'EA' })).status, 409);
    assert.equal((await post(`${secondPath}/record`, { ...record, evidence: '' })).status, 400);
  });
  await t.test('operator records all scrap with exact zero downstream output; transaction replay cannot consume material twice', async () => {
    await rollback(`${secondPath}/record`, record, 200);
    const final = await rollback(`${secondPath}/record`, command({ expectedVersion: 3, operationIndex: 1, inputQuantity: '0', goodQuantity: '0', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic downstream zero-output record' }), 200);
    assert.equal(final.output.quantity, '0'); assert.equal(final.totalScrapQuantity, '0.5');
    assert.equal((await db.collection('warehouseReceipts').findOne({ _id: receipt._id })).manufacturingConsumedQuantity, '2.5');
    assert.equal((await post(`${secondPath}/qc`, command({ expectedVersion: 4, acceptedQuantity: '0.000001', rejectedQuantity: '0', uom: 'KG', evidence: 'Invalid excess' }))).status, 409);
    const qc = await rollback(`${secondPath}/qc`, command({ expectedVersion: 4, acceptedQuantity: '0', rejectedQuantity: '0', uom: 'KG', evidence: 'Synthetic inspector confirms zero output' }), 200);
    assert.equal(qc.status, 'QC_COMPLETED');
  });
  await t.test('distinct-key concurrent SO splits cannot exceed remaining capacity and preserve commercial shape', async () => {
    const q = (await post('/commercial/quotes', { ...content, lines: [{ ...content.lines[0], quantity: '1' }], accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' })).data;
    await post(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
    await post(`/commercial/quotes/${q._id}/accept`, { expectedVersion: 2, revision: 1 });
    const next = (await post(`/commercial/quotes/${q._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: randomUUID() })).data;
    const original = await db.collection('salesOrders').findOne({ _id: next._id });
    const b = { ...split, salesOrderId: next._id, quantities: ['0.75'], idempotencyKey: randomUUID() };
    const results = await Promise.all([1, 2, 3].map(() => post('/manufacturing/work-orders', { ...b, idempotencyKey: randomUUID() })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409, 409], JSON.stringify(results));
    const remaining = await rollback('/manufacturing/work-orders', { ...b, quantities: ['0.25'], idempotencyKey: randomUUID() }, 201);
    assert.equal(remaining.workOrders[0].quantity, '0.25');
    assert.equal((await post('/manufacturing/work-orders', { ...b, quantities: ['0.000001'], idempotencyKey: randomUUID() })).status, 409);
    assert.deepEqual(await db.collection('salesOrders').findOne({ _id: next._id }), original);
    assert.equal((await db.collection('manufacturingAllocated').findOne({ salesOrderId: next._id })).quantity, '1');
    const a = results.find(r => r.status === 201).data.workOrders[0], z = remaining.workOrders[0];
    const releases = await Promise.all([a, z].map(w => post(`/manufacturing/work-orders/${w._id}/release`, command({ ...routing, materials: [{ ...routing.materials[0], quantityPerUnit: w._id === a._id ? '4' : '12' }] }))));
    assert.deepEqual(releases.map(r => r.status).sort(), [409, 409]);
    const races = await Promise.all([1, 2].map(() => post(`/manufacturing/work-orders/${a._id}/release`, command(routing))));
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
    const records = await Promise.all([1, 2].map(() => post(`/manufacturing/work-orders/${a._id}/record`, command({ expectedVersion: 2, operationIndex: 0, inputQuantity: '0.75', goodQuantity: '0.75', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic concurrent operator entry' }))));
    assert.deepEqual(records.map(r => r.status).sort(), [200, 409]);
    const stock = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    assert.equal(stock.availableQuantity, '1'); assert.equal(stock.manufacturingConsumedQuantity, '4'); assert.equal(stock.manufacturingReservedQuantity, '0');
  });
});
