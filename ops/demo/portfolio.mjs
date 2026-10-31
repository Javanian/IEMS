import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { createApp, initialize, seedSynthetic } from '../../apps/portfolio-api/src/app.mjs';
import { runE01Flow } from '../../apps/portfolio-api/test/support/review-e01-flow.mjs';
import { runE02Flow } from '../../apps/portfolio-api/test/support/review-e02-flow.mjs';
import { createReportingRuntime } from './reporting-runtime.mjs';

const args = process.argv.slice(2), outputAt = args.indexOf('--output');
assert.ok(args.includes('--synthetic-owned') && outputAt >= 0 && isAbsolute(args[outputAt + 1] || ''),
  'Use --synthetic-owned --output <new absolute directory> [--smoke]');
assert.ok(args.every((arg, i) => i === outputAt + 1 || ['--synthetic-owned', '--output', '--smoke'].includes(arg)), 'Unknown argument');
const binary = process.env.MONGOMS_SYSTEM_BINARY;
assert.ok(binary && isAbsolute(binary) && (await stat(binary)).isFile(), 'An explicit cached Mongo 7.0.14 binary is required');
process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
const require = createRequire(new URL('../../apps/portfolio-api/package.json', import.meta.url));
const { MongoClient } = require('mongodb'), { MongoMemoryReplSet } = require('mongodb-memory-server');
const root = resolve(import.meta.dirname, '../..'), output = resolve(args[outputAt + 1]);
await mkdir(output); // A new directory prevents overwriting another run's evidence.
const marker = randomUUID(), databaseName = `portfolio_test_${randomUUID().replaceAll('-', '')}`;
const password = randomUUID() + randomUUID(), smoke = args.includes('--smoke');
let repl, client, db, api, vite, reporting, closing, clock = new Date('2026-03-31T00:00:00Z');
const manifest = { schema: 'IEMS_LINKED_DEMO_V1', evidenceClass: 'LOCAL_SYNTHETIC_HTTP', marker, databaseName,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  launcherSHA256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  status: 'RUNNING', independentQA: 'NOT_RUN', browser: 'NOT_RUN',
  stages: { E01: { status: 'NOT_RUN' }, E02: { status: 'NOT_RUN' }, reporting: { status: 'NOT_RUN' }, web: { status: 'NOT_RUN' } }, cleanup: 'PENDING' };
const save = () => writeFile(join(output, 'demo-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

async function close() {
  if (closing) return closing;
  closing = (async () => {
    const errors = [], attempt = async work => { try { await work(); } catch (error) { errors.push(error); } };
    await attempt(() => vite?.close());
    await attempt(async () => { if (api?.listening) await new Promise((done, reject) => api.close(error => error ? reject(error) : done())); });
    await attempt(() => reporting?.close());
    let cleanupAllowed = errors.length === 0;
    if (db) await attempt(async () => {
      assert.equal(db.databaseName, databaseName);
      assert.ok(await db.collection('ownedRun').findOne({ _id: marker }), 'Owned marker changed; preserve database');
      if (cleanupAllowed) await db.dropDatabase();
    });
    cleanupAllowed &&= errors.length === 0;
    await attempt(() => client?.close());
    await attempt(() => repl?.stop({ doCleanup: cleanupAllowed }));
    manifest.cleanup = errors.length ? 'FAILED_PRESERVED' : 'PASS_MARKER_VERIFIED';
    await save();
    if (errors.length) throw new AggregateError(errors, 'Owned demo cleanup failed; inspect retained evidence');
  })();
  return closing;
}

async function unusedPort() {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise((done, reject) => probe.close(error => error ? reject(error) : done()));
  return port;
}

try {
  await writeFile(join(output, 'reporting-owner.json'), JSON.stringify({ schema: 'IEMS_REPORTING_SYNTHETIC_V1', marker, databaseName }), { flag: 'wx' });
  await save();
  for (const [name, expected] of Object.entries({ e01ManufacturingTenUnits: '88ccf40a5808d7682d16fc83527156f58237c7ab5a404914348337ca6d5a31b6', e02RepairCustomerAsset: '6baee7beb75983827bd40f0064618af35b41e96ea6eba4ef3cb68dfdaba49d48' })) {
    const hash = createHash('sha256').update(await readFile(join(root, `packages/domain-test-fixtures/src/scenarios/${name}.js`))).digest('hex');
    assert.equal(hash, expected, 'Original canonical fixture changed');
    manifest.stages[name] = { fixtureSHA256: hash };
  }
  const webPort = await unusedPort(), origin = `http://127.0.0.1:${webPort}`;
  repl = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: binary },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  client = await new MongoClient(repl.getUri()).connect(); db = client.db(databaseName);
  await db.collection('ownedRun').insertOne({ _id: marker });
  const runtime = await initialize({ client, db, businessClock: () => new Date(clock), ownedRunMarker: marker });
  const seeded = await seedSynthetic(runtime, { password, e01Operators: true });
  api = createApp(runtime, { origins: [origin] }).listen(0, '127.0.0.1');
  await new Promise((done, reject) => { api.once('listening', done); api.once('error', reject); });
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  const login = async username => {
    const result = await fetch(`${apiOrigin}/api/session/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
  };
  const alpha = await login('alpha.owner'), beta = await login('beta.owner');
  const req = async (path, body, cookie = alpha) => {
    const result = await fetch(`${apiOrigin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, ...await result.json() };
  };
  const ok = async (path, body, status = 200, cookie = alpha) => {
    const result = await req(path, body, cookie);
    assert.equal(result.status, status, `${path}: ${JSON.stringify(result)}`); return result.data;
  };
  const scopeOf = cookie => runtime.foundation.authenticate(cookie.slice('portfolio_session='.length));
  const h = { db, client, runtime, seeded, alpha, beta, login, req, ok, scopeOf };
  const setClock = instant => { clock = new Date(instant); };
  manifest.stages.E01.status = 'RUNNING'; await save();
  const e01 = await runE01Flow(h, { setClock });
  const invoices = await Promise.all(e01.invoices.map(invoice => ok(`/fulfillment/invoices/${invoice._id}`)));
  assert.ok(invoices.every(invoice => invoice.outstandingAmount === '0.00' && invoice.status === 'PAID'));
  manifest.stages.E01 = { status: 'PASS', manifest: e01.manifest, orderId: e01.so._id, invoiceIds: invoices.map(row => row._id), outstandingAmounts: invoices.map(row => row.outstandingAmount) };
  await save();
  manifest.stages.E02.status = 'RUNNING'; await save();
  const e02 = await runE02Flow(h, { setClock });
  assert.equal(e02.manifest.status, 'COMPLETE'); assert.equal(e02.rejection.manifest.status, 'COMPLETE');
  assert.equal(e02.invoice.remaining, '0.00'); assert.equal(e02.rejection.invoice.remaining, '0.00');
  manifest.stages.E02 = { status: 'PASS', manifest: e02.manifest, rejection: e02.rejection.manifest };
  await save();
  reporting = await createReportingRuntime({ ...runtime, root: output, marker,
    getScope: () => scopeOf(alpha),
    authorizeResource: ({ grant, resource, session }) => {
      assert.ok(session.inTransaction()); assert.equal(resource.tenantId, grant.tenantId); assert.equal(resource.plantId, grant.plantId);
      for (const owner of [resource.legalEntityId, resource.ownerLegalEntityId]) if (owner) assert.equal(owner, grant.legalEntityId);
    } });
  manifest.stages.reporting = { status: 'RUNNING', transport: reporting.status }; await save();
  const reconciliation = await reporting.reconcile();
  const extraction = await reporting.extract(reconciliation.manifest.runId);
  manifest.stages.reporting = { status: 'PASS', transport: reporting.status, extraction, sourceCoverage: reconciliation.manifest };
  await reporting.close();
  manifest.stages.web.status = 'RUNNING'; await save();
  const { createServer: createVite } = await import('../../apps/web/node_modules/vite/dist/node/index.js');
  const webRoot = join(root, 'apps/web');
  vite = await createVite({ root: webRoot, define: { 'import.meta.env.VITE_PORTFOLIO_API_BASE': JSON.stringify('/portfolio-api') }, server: {
    host: '127.0.0.1', port: webPort, strictPort: true, fs: { allow: [root, await realpath(join(webRoot, 'node_modules'))] },
    proxy: { '/portfolio-api': { target: apiOrigin, changeOrigin: false, rewrite: path => path.replace(/^\/portfolio-api/, '') } } } });
  await vite.listen();
  assert.equal((await fetch(`${origin}/portfolio`)).status, 200);
  const proxy = await fetch(`${origin}/portfolio-api/api/session/me`, { headers: { origin, cookie: alpha } });
  assert.equal(proxy.status, 200); assert.equal((await proxy.json()).data.user.username, 'alpha.owner');
  manifest.stages.web = { status: 'PASS_HTML_AND_AUTHENTICATED_PROXY', browser: 'NOT_RUN' };
  manifest.links = { order: `${origin}/portfolio/orders/${e01.so._id}`, repair: `${origin}/portfolio/repair/cases/${e02.case._id}`, rejectedRepair: `${origin}/portfolio/repair/cases/${e02.rejection.case._id}` };
  manifest.status = 'PASS_BOUNDED_DEMO'; await save();
  if (smoke) { await close(); console.log(JSON.stringify({ status: manifest.status, output, cleanup: manifest.cleanup })); }
  else {
    console.log(JSON.stringify(manifest.links, null, 2));
    console.log(`Synthetic login: alpha.owner\nTemporary password: ${password}\nStop with Ctrl+C; restart with a NEW output directory to reset only this owned demo.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); }); });
  }
} catch (error) {
  for (const stage of Object.values(manifest.stages)) if (stage.status === 'RUNNING') stage.status = 'FAIL';
  manifest.status = 'FAIL'; manifest.failure = { name: error.name, message: error.message }; await save();
  console.error(error.stack || error.message); process.exitCode = 1;
  try { await close(); } catch (cleanupError) { console.error(cleanupError.message); }
}
