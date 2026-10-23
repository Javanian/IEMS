import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire("file:///D:/Project%20AI/GITHUB/IEMS/apps/portfolio-api/test/fulfillment.test.mjs");
const { MongoClient } = require('mongodb');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
import { createApp, initialize, seedSynthetic } from "file:///D:/Project%20AI/GITHUB/IEMS/apps/portfolio-api/src/app.mjs";

test('wave4 bounded WMS owned Mongo HTTP', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: fileURLToPath(new URL("file:///D:/Project%20AI/GITHUB/IEMS/packages/mongodb-spike/.runtime/binary/mongod-x64-win32-7.0.14.exe")), version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
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
  const ok = async (path, body, status = 200) => { const r = await post(path, body); assert.equal(r.status, status, `${path} ${JSON.stringify(r)}`); return r.data; };
  const key = () => randomUUID();
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic shipped item', quantity: '1.5', uom: 'KG', unitPrice: '0.05', currency: 'USD' }] };
  const account = await ok('/crm/accounts', { name: 'Synthetic fulfillment customer' }, 201);
  const other = await ok('/crm/accounts', { name: 'Synthetic other customer' }, 201);
  const quote = await ok('/commercial/quotes', { ...content, accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' }, 201);
  await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  assert.equal(so.snapshot.total, '0.08');
  const vendor = await ok('/procurement/vendors', { name: 'Synthetic vendor' }, 201);
  const pr = await ok('/procurement/requests', { ...content, lines: [{ ...content.lines[0], quantity: '5' }], vendorId: vendor._id }, 201);
  await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '5', uom: 'KG', idempotencyKey: key() }, 201);
  await ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic inspection', idempotencyKey: key() });
  await ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'SYNTHETIC-BIN', idempotencyKey: key() });
  const bin = await ok('/warehouse/bins', { expectedVersion: 1, idempotencyKey: key(), code: 'W4-BIN' }, 201);
  assert.equal(bin.code, 'W4-BIN');
  const path = `/warehouse/receipts/${receipt._id}`;
  const transfer = { expectedVersion: 3, idempotencyKey: key(), binId: bin._id, uom: 'KG', reason: 'Operator relocation' };
  const moved = await ok(`${path}/transfer`, transfer);
  assert.deepEqual([moved.location, moved.binId, moved.version, moved.availableQuantity], ['W4-BIN', bin._id, 4, '5']);
  assert.deepEqual((await post(`${path}/transfer`, transfer)).data, moved);
  assert.equal((await post(`${path}/transfer`, { ...transfer, reason: 'Changed' })).status, 409);
  assert.equal((await post(`${path}/transfer`, { ...transfer, idempotencyKey: key() }, beta)).status, 404);
  const count = { expectedVersion: 4, idempotencyKey: key(), countedQuantity: '4.250000', uom: 'KG', reason: 'Measured count' };
  const counted = await ok(`${path}/count`, count);
  assert.deepEqual([counted.availableQuantity, counted.quantity, counted.version], ['4.25', '5', 5]);
  assert.deepEqual((await post(`${path}/count`, count)).data, counted);
  const reconciliation = await post(`${path}/reconciliation`);
  assert.equal(reconciliation.data.matches, true);
  assert.equal(reconciliation.data.replayed.availableQuantity, '4.25');
  assert.deepEqual(reconciliation.data.location, { replayed: 'W4-BIN', cached: 'W4-BIN', matches: true });
  const names = ['warehouseBins', 'warehouseReceipts', 'warehouseMovements', 'warehouseKeys', 'warehouseAudit', 'warehouseOutbox'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  const command = extra => ({ ...count, expectedVersion: 5, idempotencyKey: key(), ...extra });
  await t.test('input, customer owner, exact UOM, plant and tenant fences leave no effects', async () => {
    const before = await snapshot();
    for (const countedQuantity of [0, '-1', '1e0', '00', '0.0000001', '6']) assert.equal((await post(`${path}/count`, command({ countedQuantity }))).status, countedQuantity === '6' ? 409 : 400);
    for (const extra of [{ accountId: account._id }, { ownerAccountId: account._id }, { ownerId: randomUUID() }]) assert.equal((await post(`${path}/count`, command(extra))).status, 400);
    assert.equal((await post(`${path}/count`, command({ uom: 'EA' }))).error.code, 'UOM_CONFLICT');
    assert.equal((await post(`${path}/count`, command({ expectedVersion: 4 }))).error.code, 'VERSION_CONFLICT');
    assert.equal((await post(`${path}/count`, command(), beta)).status, 404);
    assert.equal((await post(`${path}/count`, command({ tenant_id: seeded[1].tenantId }))).status, 403);
    assert.equal((await post(`${path}/count`, command({ plantId: randomUUID() }))).status, 403);
    assert.equal((await post(`${path}/transfer`, { ...transfer, expectedVersion: 5, idempotencyKey: key(), binId: randomUUID() })).status, 404);
    assert.equal((await post('/warehouse/bins', { expectedVersion: 1, idempotencyKey: key(), code: bin.code })).status, 409);
    assert.equal((await post(`/warehouse/bins/${bin._id}`, undefined, beta)).status, 404);
    assert.equal((await post('/warehouse/bins')).data.length, 1);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('count distinct-key contention, zero count and original committed replay', async () => {
    const results = await Promise.all(['0', '1.000001'].map(countedQuantity => post(`${path}/count`, command({ countedQuantity }))));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await post(`${path}/reconciliation`)).data.matches, true);
    assert.deepEqual((await post(`${path}/count`, count)).data, counted);
    assert.equal(await db.collection('warehouseMovements').countDocuments({ kind: 'COUNT' }), 2);
  });
  await t.test('real movement, audit and outbox failures roll back transfer/count and replay once', async () => {
    const bin2 = await ok('/warehouse/bins', { expectedVersion: 1, idempotencyKey: key(), code: 'W4-DEST' }, 201);
    for (const operation of ['transfer', 'count']) {
      const row = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
      const body = { expectedVersion: row.version, idempotencyKey: key(), uom: 'KG', reason: 'Rollback evidence', ...(operation === 'transfer' ? { binId: bin2._id } : { countedQuantity: '0' }) };
      for (const collection of ['warehouseMovements', 'warehouseAudit', 'warehouseOutbox']) {
        const before = await snapshot();
        await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
        try { assert.equal((await post(`${path}/${operation}`, body)).status, 500); assert.deepEqual(await snapshot(), before); }
        finally { await db.command({ collMod: collection, validator: {} }); }
      }
      const results = await Promise.all([1, 2, 3].map(() => post(`${path}/${operation}`, body)));
      assert.deepEqual(results.map(r => r.status), [200, 200, 200]);
      assert.deepEqual(results[0].data, results[1].data); assert.deepEqual(results[1].data, results[2].data);
      assert.equal((await post(`${path}/reconciliation`)).data.matches, true);
    }
  });
  await t.test('distinct transfer keys serialize receipt version and immutable bin creation replays', async () => {
    const body = { expectedVersion: 1, idempotencyKey: key(), code: 'RACE-BIN' };
    const bins = await Promise.all([1, 2, 3].map(() => post('/warehouse/bins', body)));
    assert.deepEqual(bins.map(r => r.status), [201, 201, 201]);
    assert.deepEqual(bins[0].data, bins[2].data);
    const row = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    const results = await Promise.all([bin._id, bins[0].data._id].map(binId => post(`${path}/transfer`, { expectedVersion: row.version, idempotencyKey: key(), binId, uom: 'KG', reason: 'Version race' })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const source = (await db.collection('warehouseReceipts').findOne({ _id: receipt._id }));
    const otherPlantBin = { ...bins[0].data, _id: randomUUID(), plantId: randomUUID() };
    await db.collection('warehouseBins').insertOne(otherPlantBin);
    const before = await snapshot();
    assert.equal((await post(`${path}/transfer`, { expectedVersion: source.version, idempotencyKey: key(), binId: otherPlantBin._id, uom: 'KG', reason: 'Foreign bin' })).status, 404);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await post(`${path}/reconciliation`)).data.matches, true);
  });
  await t.test('quarantined, serial and encumbered stock cannot be moved or counted', async () => {
    const original = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    for (const patch of [{ status: 'QUARANTINED' }, { held: true }, { hold: { active: true } }, { heldQuantity: '0.000001' }, ...['reservedQuantity', 'shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].map(k => ({ [k]: '0.000001' }))]) {
      await db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, { $set: patch });
      const before = await snapshot();
      for (const operation of ['transfer', 'count']) {
        const body = { expectedVersion: original.version, idempotencyKey: key(), uom: 'KG', reason: 'Protected', ...(operation === 'transfer' ? { binId: bin._id } : { countedQuantity: '1' }) };
        assert.equal((await post(`${path}/${operation}`, body)).status, 409);
      }
      assert.deepEqual(await snapshot(), before);
      await db.collection('warehouseReceipts').replaceOne({ _id: receipt._id }, original);
    }
    await db.collection('warehouseReceipts').updateOne({ _id: receipt._id }, { $set: { serials: ['SERIAL'] } });
    assert.equal((await post(`${path}/count`, command({ expectedVersion: original.version }))).error.code, 'SERIAL_COUNT_CONFLICT');
    await db.collection('warehouseReceipts').replaceOne({ _id: receipt._id }, original);
  });
  await t.test('new actions enforce grants and live transaction revocation even on replay', async () => {
    const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const setRole = role => db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role, plantIds: member.plantIds, tenantWide: false }] } });
    const bodies = { bin: { expectedVersion: 1, idempotencyKey: key(), code: 'ROLE' }, transfer, count };
    const urls = { bin: '/warehouse/bins', transfer: `${path}/transfer`, count: `${path}/count` };
    const before = await snapshot();
    try {
      for (const role of ['warehouseRead', 'warehouseBin', 'warehouseTransfer', 'warehouseCount']) {
        await setRole(role);
        for (const action of ['bin', 'transfer', 'count']) if (role !== `warehouse${action[0].toUpperCase()}${action.slice(1)}`) assert.equal((await post(urls[action], bodies[action])).status, 403);
        assert.equal((await post('/warehouse/bins')).status, 200);
      }
    } finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    const foundation = runtime.foundation;
    runtime.foundation = { ...foundation, authorize: async (...args) => { const result = await foundation.authorize(...args); await setRole('warehouseRead'); return result; } };
    try { assert.equal((await post(`${path}/count`, count)).status, 403); }
    finally { runtime.foundation = foundation; await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('count and transfer ledger remains reconcilable through actual manufacturing reserve and consumption', async () => {
    const row = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    await ok(`${path}/count`, { expectedVersion: row.version, idempotencyKey: key(), countedQuantity: '5', uom: 'KG', reason: 'Recount before production' });
    const plan = await ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1'], idempotencyKey: key() }, 201);
    const wo = plan.workOrders[0], woPath = `/manufacturing/work-orders/${wo._id}`;
    await ok(`${woPath}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Record operation' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '2', uom: 'KG' }], idempotencyKey: key() });
    let stock = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    assert.equal((await post(`${path}/count`, { ...count, expectedVersion: stock.version, idempotencyKey: key() })).error.code, 'STOCK_ENCUMBERED');
    let rec = (await post(`${path}/reconciliation`)).data;
    assert.equal(rec.matches, true); assert.equal(rec.replayed.manufacturingReservedQuantity, '2');
    await ok(`${woPath}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: 'Recorded manufacturing', idempotencyKey: key() });
    rec = (await post(`${path}/reconciliation`)).data;
    assert.equal(rec.matches, true); assert.equal(rec.replayed.manufacturingConsumedQuantity, '2');
    assert.equal(rec.replayed.availableQuantity, '3');
    stock = await db.collection('warehouseReceipts').findOne({ _id: receipt._id });
    assert.equal((await post(`${path}/transfer`, { ...transfer, expectedVersion: stock.version, idempotencyKey: key() })).error.code, 'STOCK_ENCUMBERED');
    const stored = await db.collection('warehouseMovements').findOne({ receiptId: receipt._id, kind: 'COUNT', quantity: '4.250000' });
    assert.equal(stored.uom, 'KG'); assert.equal(stored.beforeQuantity, '5');
  });
});
