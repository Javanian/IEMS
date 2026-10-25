import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as netServer } from 'node:net';
import { resolve, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { MongoMemoryReplSet } from '../node_modules/mongodb-memory-server/index.js';
import { MongoClient } from '../node_modules/mongodb/lib/index.js';
import { createServer as viteServer } from '../../web/node_modules/vite/dist/node/index.js';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';
import { runE01Flow } from '../test/support/review-e01-flow.mjs';

if (!process.argv.includes('--synthetic-owned')) throw new Error('Run with --synthetic-owned. This creates a disposable synthetic database.');
const smoke = process.argv.includes('--smoke');
const root = resolve(import.meta.dirname, '../../..'), webRoot = join(root, 'apps/web');
const marker = randomUUID(), database = `portfolio_owned_review_demo_${marker.replaceAll('-', '')}`;
const password = randomUUID() + randomUUID();
let repl, client, runtime, api, vite, closing;
let clock = new Date('2026-03-31T00:00:00.000Z');

async function unusedPort() {
  const server = netServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

async function close() {
  if (closing) return closing;
  closing = (async () => {
    const errors = [];
    const attempt = async action => { try { await action(); } catch (error) { errors.push(error); } };
    await attempt(() => vite?.close());
    await attempt(async () => { if (api?.listening) await new Promise((done, reject) => api.close(error => error ? reject(error) : done())); });
    let cleanupAllowed = true;
    if (runtime) {
      try {
        assert.match(runtime.db.databaseName, /^portfolio_owned_review_demo_/);
        assert.ok(await runtime.db.collection('ownedRun').findOne({ _id: marker }), 'Owned marker changed; database cleanup refused');
        await runtime.db.dropDatabase();
      } catch (error) { cleanupAllowed = false; errors.push(error); }
    }
    await attempt(() => client?.close());
    await attempt(() => repl?.stop({ doCleanup: cleanupAllowed }));
    if (errors.length) throw new AggregateError(errors, 'Owned demo cleanup failed; unverified database files are preserved');
  })();
  return closing;
}

try {
  const webPort = await unusedPort(), origin = `http://127.0.0.1:${webPort}`;
  repl = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, instanceOpts: [{ launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(database);
  await db.collection('ownedRun').insertOne({ _id: marker });
  runtime = await initialize({ client, db, businessClock: () => new Date(clock), ownedRunMarker: marker });
  const seeded = await seedSynthetic(runtime, { password, e01Operators: true });
  api = createApp(runtime, { origins: [origin] }).listen(0, '127.0.0.1');
  await new Promise((done, reject) => { api.once('listening', done); api.once('error', reject); });
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  const login = async username => {
    const response = await fetch(`${apiOrigin}/api/session/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const alpha = await login('alpha.owner'), beta = await login('beta.owner');
  const req = async (path, body, cookie = alpha, headers = {}) => {
    const response = await fetch(`${apiOrigin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const ok = async (path, body, status = 200, cookie = alpha) => {
    const result = await req(path, body, cookie);
    assert.equal(result.status, status, `${path}: ${JSON.stringify(result)}`);
    return result.data;
  };
  const flow = await runE01Flow({ db, runtime, seeded, alpha, beta, login, req, ok }, { setClock: instant => { clock = new Date(instant); } });
  const settled = await Promise.all(flow.invoices.map(invoice => ok(`/fulfillment/invoices/${invoice._id}`)));
  assert.ok(settled.every(invoice => invoice.outstandingAmount === '0.00' && invoice.status === 'PAID'), 'E01 invoice settlement is incomplete');
  await ok('/commercial/inquiries', { idempotencyKey: randomUUID(), accountId: flow.account._id, lines: [{ itemCode: 'DEMO-REVIEW-001', description: 'Supplemental synthetic inquiry awaiting sales review', quantity: '1', uom: 'UN', drawingNumber: 'SYNTHETIC-DEMO', drawingRevision: 'A' }] }, 201);
  await ok('/commercial/quotes', { accountId: flow.account._id, expiresAt: '2026-07-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Supplemental synthetic quotation awaiting approval', quantity: '1', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] }, 201);
  let heldRequest = await ok('/procurement/requests', { vendorId: flow.po.vendorId, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Supplemental synthetic incoming material held for review', quantity: '1', uom: 'UN', unitPrice: '1.00', currency: 'USD' }] }, 201);
  heldRequest = await ok(`/procurement/requests/${heldRequest._id}/approve`, { expectedVersion: heldRequest.version });
  let heldOrder = await ok(`/procurement/requests/${heldRequest._id}/convert`, { expectedVersion: heldRequest.version, idempotencyKey: randomUUID() });
  heldOrder = await ok(`/procurement/orders/${heldOrder._id}/issue`, { expectedVersion: heldOrder.version });
  const heldReceipt = await ok('/warehouse/receipts', { purchaseOrderId: heldOrder._id, expectedVersion: heldOrder.version, vendorId: heldOrder.vendorId, lineIndex: 0, quantity: '1', uom: 'UN', lotNumber: 'SYNTHETIC-DEMO-HOLD', heatNumber: 'SYNTHETIC-DEMO-HEAT', idempotencyKey: randomUUID() }, 201);
  const held = await req(`/warehouse/receipts/${heldReceipt._id}/holds`, { expectedReceiptVersion: heldReceipt.version, reasonCode: 'DOCUMENT_MISMATCH', reasonNote: 'Supplemental synthetic state: operator must verify incoming documentation before releasing hold' }, alpha, { 'Idempotency-Key': randomUUID() });
  assert.equal(held.status, 201, JSON.stringify(held));
  assert.equal(held.data.hold.status, 'ACTIVE');
  vite = await viteServer({ root: webRoot, define: { 'import.meta.env.VITE_PORTFOLIO_API_BASE': JSON.stringify('/portfolio-api') }, server: { host: '127.0.0.1', port: webPort, strictPort: true, fs: { allow: [root, await realpath(join(webRoot, 'node_modules'))] }, proxy: { '/portfolio-api': { target: apiOrigin, changeOrigin: false, rewrite: url => url.replace(/^\/portfolio-api/, '') } } } });
  await vite.listen();
  const page = await fetch(`${origin}/portfolio`);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('/src/'));
  const proxy = await fetch(`${origin}/portfolio-api/api/session/me`, { headers: { origin, cookie: alpha } });
  assert.equal(proxy.status, 200);
  assert.equal((await proxy.json()).data.user.username, 'alpha.owner');
  console.log('Synthetic E01 ready: 10 serials, shipments 6/4, two POD confirmations, USD 135975.00 settled.');
  console.log('Supplemental action states: inquiry draft, quotation awaiting approval, and incoming receipt held for document review.');
  console.log(`Business replay time: ${clock.toISOString()}. Authentication and audit recording use real time.`);
  console.log('Engineering approval uses the receipt-backed Apr17 adapter; original Apr15 fixture is unchanged. Material issue dates map to release/reservation; actual consumption occurs at operation recording.');
  if (smoke) {
    await close();
    console.log('SMOKE PASS: real mounted API flow, exact settlement, owned web HTML and authenticated proxy, marker-checked cleanup. Native browser proof is a separate run.');
  } else {
    console.log(`Open ${origin}/portfolio/work-queue`);
    console.log(`Username: alpha.owner\nTemporary password: ${password}`);
    console.log(`Canonical order: ${origin}/portfolio/orders/${flow.so._id}`);
    console.log('Stop with Ctrl+C. The owned database is deleted on stop; restart to create a fresh demo.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); }); });
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
  try { await close(); } catch (cleanupError) { console.error(`Owned cleanup failed: ${cleanupError.message}`); }
}
