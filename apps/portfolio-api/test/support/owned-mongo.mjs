import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../../src/app.mjs';

const ORIGIN = 'http://localhost:4173';

// Owned throwaway replica + randomized portfolio_test_ database guarded by a run marker.
export async function startOwned(t, initOptions = {}) {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`), marker = randomUUID();
  await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db, ...initOptions, ...(initOptions.businessClock ? { ownedRunMarker: marker } : {}) }), password = randomUUID(), seeded = await seedSynthetic(runtime, { password, ...initOptions.seedOptions });
  server = createApp(runtime, { origins: [ORIGIN] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = () => `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, body, cookie) {
    const r = await fetch(`${base()}${path}`, { method: body ? 'POST' : 'GET', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...await r.json() };
  }
  const login = async username => (await fetch(`${base()}/session/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })).headers.get('set-cookie').split(';')[0];
  const alpha = await login('alpha.owner'), beta = await login('beta.owner');
  const ok = async (path, body, status = 200, cookie = alpha) => { const r = await req(path, body, cookie); assert.equal(r.status, status, `${path} ${JSON.stringify(r)}`); return r.data; };
  const setRoles = async (member, roles) => {
    const row = await db.collection('memberships').findOne({ _id: member.membershipId });
    await db.collection('memberships').updateOne({ _id: row._id }, { $set: { roles: roles.map(role => ({ role, plantIds: row.plantIds, tenantWide: false })) } });
    return () => db.collection('memberships').updateOne({ _id: row._id }, { $set: { roles: row.roles } });
  };
  const scopeOf = cookie => runtime.foundation.authenticate(cookie.slice('portfolio_session='.length));
  // Wave 4f additive helpers: explicit headers (Idempotency-Key) and sign-in for the seeded role users.
  async function send(path, { body, cookie = alpha, headers = {} } = {}) {
    const r = await fetch(`${base()}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, ...await r.json() };
  }
  return { db, client, runtime, seeded, req, ok, alpha, beta, setRoles, scopeOf, login, send, raw: (path, cookie = alpha) => fetch(`${base()}${path}`, { headers: { origin: ORIGIN, cookie } }) };
}

// Real CRM order -> stored PO receipt -> putaway -> reservation; manufacturing is left to the caller.
export async function orderWithStock(h, { orderQuantity = '1.5', receiptQuantity = '5', reserve = '0.7', cookie = h.alpha } = {}) {
  const ok = (path, body, status = 200) => h.ok(path, body, status, cookie);
  const key = () => randomUUID();
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic shipped item', quantity: orderQuantity, uom: 'KG', unitPrice: '0.05', currency: 'USD' }] };
  const account = await ok('/crm/accounts', { name: 'Synthetic ledger customer' }, 201);
  const quote = await ok('/commercial/quotes', { ...content, accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' }, 201);
  await ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await ok(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await ok(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  const vendor = await ok('/procurement/vendors', { name: 'Synthetic vendor' }, 201);
  const pr = await ok('/procurement/requests', { ...content, lines: [{ ...content.lines[0], quantity: receiptQuantity }], vendorId: vendor._id }, 201);
  await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: receiptQuantity, uom: 'KG', idempotencyKey: key() }, 201);
  await ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic inspection', idempotencyKey: key() });
  await ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'SYNTHETIC-BIN', idempotencyKey: key() });
  let reservation = null;
  if (reserve) {
    await ok(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: 3, salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: reserve, uom: 'KG', idempotencyKey: key() });
    reservation = await h.db.collection('warehouseReservations').findOne({ salesOrderId: so._id });
  }
  return { account, so, receipt, reservation, key };
}
