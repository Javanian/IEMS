import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectBenchmarkCells } from './benchmark-selection.mjs';

const source = process.env.IEMS_BENCH_SOURCE, evidence = process.env.IEMS_BENCH_EVIDENCE;
assert.ok(source && evidence, 'Explicit IEMS_BENCH_SOURCE and external IEMS_BENCH_EVIDENCE are required');
const expected = process.env.IEMS_BENCH_EXPECTED_SHA || '54a7e6db5fb1cfc48252477ca872d700c8c650ee';
const sourceRoot = path.resolve(source), evidenceRoot = path.resolve(evidence);
assert.ok(evidenceRoot !== sourceRoot && !evidenceRoot.startsWith(sourceRoot + path.sep), 'Evidence must be outside source');
const priorSummaryPath = process.env.IEMS_BENCH_RESUME_SUMMARY, requestedJson = process.env.IEMS_BENCH_CELL_IDS;
assert.equal(priorSummaryPath === undefined, requestedJson === undefined, 'Resume summary and explicit cell IDs must be paired');
let priorRaw;
if (priorSummaryPath !== undefined) {
  assert.notEqual(path.dirname(path.resolve(priorSummaryPath)), evidenceRoot, 'Resume evidence must use a separate directory');
  priorRaw = await readFile(priorSummaryPath, 'utf8');
  const existing = await readdir(evidenceRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  assert.ok(existing.every(name => /^(benchmark-attempt[0-9]+\.jsonl|benchmark-attempt[0-9]+\.exit\.json)$/.test(name)), 'Resume evidence directory already contains result artifacts');
}
await mkdir(evidenceRoot, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), expected);
assert.equal(git('status', '--porcelain'), '', 'Baseline must be clean and frozen');
const digest = input => createHash('sha256').update(input).digest('hex');
async function manifest() {
  const names = execFileSync('git', ['-C', sourceRoot, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const rows = [];
  for (const name of names) rows.push({ path: name, sha256: digest(await readFile(path.join(sourceRoot, name))) });
  return { commit: expected, files: rows, digest: digest(JSON.stringify(rows)) };
}
const before = await manifest();
await writeFile(path.join(evidenceRoot, 'source-before.json'), JSON.stringify(before, null, 2));
const selection = { ...selectBenchmarkCells({ requestedJson, ...(priorRaw === undefined ? {} : { prior: JSON.parse(priorRaw) }), expected, sourceDigest: before.digest }), ...(priorRaw === undefined ? {} : { priorSummaryHash: digest(priorRaw) }) };
const selectedCellIds = new Set(selection.selectedCellIds);
await writeFile(path.join(evidenceRoot, 'selection.json'), JSON.stringify(selection, null, 2));
const requireSource = createRequire(path.join(sourceRoot, 'apps/portfolio-api/package.json'));
const { MongoClient } = requireSource('mongodb');
const { MongoMemoryReplSet } = requireSource('mongodb-memory-server');
const { initialize, createApp } = await import(pathToFileURL(path.join(sourceRoot, 'apps/portfolio-api/src/app.mjs')));
const scopeStore = new AsyncLocalStorage(), GiB = 1024 ** 3, origin = 'http://localhost:4173';
const clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
const distribution = values => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: values.length ? Math.max(...values) : null });
const cpuSnapshot = () => os.cpus().map(cpu => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((a, b) => a + b, 0) }));
const busy = (a, b) => { const total = b.reduce((sum, cpu, i) => sum + cpu.total - a[i].total, 0), idle = b.reduce((sum, cpu, i) => sum + cpu.idle - a[i].idle, 0); return total ? 100 * (1 - idle / total) : 0; };
const stableId = label => { const h = digest(`iems-f5-v1:${label}`); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const environment = { recordedAt: new Date().toISOString(), source: sourceRoot, expected, sourceManifest: before.digest, node: process.version, platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalCpuCount: os.cpus().length, totalRamBytes: os.totalmem(), initialFreeRamBytes: os.freemem(), database: { version: '7.0.14', replicaMembers: 1, storageEngine: 'wiredTiger', cacheGiB: .25, oplogMiB: 128 }, target: { concurrency: 8, warmP95Ms: 2000, distinctSuccessCommandsPerSecond: 4, unexpectedErrors: 0 }, protocol: 'CONCURRENCY.md v1', commandSamplesPerPhase: 200, warmup: 40, repetitions: 3, selection };
await writeFile(path.join(evidenceRoot, 'environment.json'), JSON.stringify(environment, null, 2));
let repl, currentDb, currentMarker, client, server, activePhase, interrupted = false;
const results = [], guards = [], instrumentationErrors = [], sampleLookup = new Map();
const instrumentClient = value => {
  const start = value.startSession.bind(value);
  value.startSession = (...args) => {
    const session = start(...args), transaction = session.withTransaction.bind(session);
    session.withTransaction = (callback, options) => {
      const sample = scopeStore.getStore(); if (sample) sample.transactionCalls++;
      return transaction(async (...callbackArgs) => { if (sample) sample.callbackAttempts++; return callback(...callbackArgs); }, options);
    };
    return session;
  };
  value.on('commandFailed', event => {
    if (!activePhase) return;
    activePhase.failedCommands++;
    if (event.failure?.code === 112 || event.failure?.codeName === 'WriteConflict') activePhase.writeConflicts++;
    const sample = scopeStore.getStore(); if (sample && event.failure?.code === 112) sample.writeConflicts++;
  });
  value.on('commandStarted', event => { if (activePhase && event.commandName === 'abortTransaction') activePhase.abortCommands++; });
  value.on('connectionCheckedOut', event => { if (activePhase && Number.isFinite(event.durationMS)) activePhase.poolCheckoutMs.push(event.durationMS); });
};
async function resourceGuard(concurrency) {
  const start = cpuSnapshot(); await sleep(1000);
  const observation = { at: new Date().toISOString(), concurrency, freeRamBytes: os.freemem(), hostCpuPercent: busy(start, cpuSnapshot()), minimumFreeRamBytes: (concurrency === 16 ? 3 : 2) * GiB, maximumHostCpuPercent: 80 };
  observation.allowed = observation.freeRamBytes >= observation.minimumFreeRamBytes && observation.hostCpuPercent < observation.maximumHostCpuPercent;
  guards.push(observation); return observation;
}
async function http(actor, route, body, sample) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie: actor.cookie, 'content-type': 'application/json', ...(sample ? { 'x-benchmark-sample': sample.id } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  return { status: response.status, body: await response.json() };
}
async function okay(actor, route, body) { const result = await http(actor, route, body); assert.ok(result.status >= 200 && result.status < 300, `${route}: ${JSON.stringify(result)}`); return result.body.data; }
async function actorsFor(runtime, condition, concurrency, label) {
  const f = runtime.foundation, actors = [], seenTenants = new Set(), seenPlants = new Set();
  for (let i = 0; i < concurrency; i++) {
    const tenantId = stableId(`${label}:tenant:${condition === 'different-tenants' ? i : 0}`), split = ['different-plants', 'different-tenants'].includes(condition), legalEntityId = stableId(`${label}:entity:${split ? i : 0}`), plantId = stableId(`${label}:plant:${split ? i : 0}`), userId = stableId(`${label}:user:${i}`);
    if (!seenTenants.has(tenantId)) { await f.provisionTenant({ id: tenantId }); seenTenants.add(tenantId); }
    if (!seenPlants.has(plantId)) { await f.provisionLegalEntity({ id: legalEntityId, tenantId }); await f.provisionPlant({ id: plantId, tenantId, legalEntityId }); seenPlants.add(plantId); }
    await f.provisionUser({ id: userId, tenantId });
    await f.provisionMembership({ id: stableId(`${label}:membership:${i}`), tenantId, userId, legalEntityIds: [legalEntityId], plantIds: [plantId], roles: [{ role: 'owner', plantIds: [plantId] }, { role: 'csFixtureAdmin', plantIds: [plantId] }] });
    const issued = await f.issueSession({ userId, tenantId, selectedPlantId: plantId, ttlMs: 86400000 }), scope = await f.authenticate(issued.token);
    actors.push({ tenantId, legalEntityId, plantId, userId, scope, cookie: `portfolio_session=${issued.token}` });
  }
  return actors;
}
async function ticketFor(runtime, actor, label) {
  const cs = runtime.customerService, customerId = stableId(`${label}:customer`), bindingId = stableId(`${label}:binding`), contact = `SYNTHETIC-BENCH-${label}`;
  await cs.provisionFixtureCustomer(actor.scope, { plantId: actor.plantId, customerId, label: 'Synthetic benchmark customer' });
  await cs.bindContact(actor.scope, { plantId: actor.plantId, bindingId, customerId, channelAccountId: 'SIMULATED', providerContactId: contact });
  const principal = await cs.resolveCustomerPrincipal({ tenantId: actor.tenantId, channelAccountId: 'SIMULATED', providerContactId: contact });
  let draft = await cs.startComplaintDraft(principal, { requestKey: stableId(`${label}:draft`) });
  for (const action of [{ type: 'GENERAL_INQUIRY' }, { type: 'SELECT_CATEGORY', category: 'OTHER' }, { type: 'DESCRIBE', text: 'Synthetic benchmark bounded general enquiry' }]) draft = await cs.updateComplaintDraft(principal, { draftId: draft.draftId, expectedVersion: draft.version, action });
  return (await cs.confirmComplaint(principal, { draftId: draft.draftId, expectedVersion: draft.version, inboundKey: stableId(`${label}:confirm`) })).ticketId;
}
const itemBody = { description: 'Synthetic benchmark purchased material', uom: 'KG', kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' };
async function mastersFor(actors, condition, label) {
  const masters = [];
  for (let i = 0; i < (condition === 'same-resource' ? 1 : actors.length); i++) masters.push((await okay(actors[i], '/inventory-master/items', { expectedVersion: 1, reason: 'Synthetic benchmark phase resource', idempotencyKey: stableId(`${label}:resource-key:${i}`), code: `B${digest(`${label}:${i}`).slice(0,20).toUpperCase()}`, ...itemBody }))._id);
  return actors.map((actor, i) => masters[condition === 'same-resource' ? 0 : i]);
}
async function logicalCommand(workload, actor, resource, index, label, sample) {
  if (workload === 'foundation-cs') {
    if (index % 2 === 0) return http(actor, `/cs/tickets/${resource}/internal-notes`, { text: 'Synthetic benchmark operator note', commandKey: stableId(`${label}:key:${index}`) }, sample);
    const current = await http(actor, `/cs/tickets/${resource}`, undefined, sample);
    if (current.status !== 200) return current;
    return http(actor, `/cs/tickets/${resource}/public-update`, { expectedVersion: current.body.data.version, text: 'Synthetic benchmark operator public update', commandKey: stableId(`${label}:key:${index}`) }, sample);
  }
  if (index % 5 < 3) return http(actor, '/inventory-master/items', { expectedVersion: 1, reason: 'Synthetic benchmark create', idempotencyKey: stableId(`${label}:key:${index}`), code: `B${digest(`${label}:new:${index}`).slice(0,20).toUpperCase()}`, ...itemBody }, sample);
  const current = await http(actor, `/inventory-master/items/${resource}`, undefined, sample);
  if (current.status !== 200) return current;
  return http(actor, `/inventory-master/items/${resource}/revisions`, { expectedVersion: current.body.data.version, reason: 'Synthetic benchmark revision', idempotencyKey: stableId(`${label}:key:${index}`), ...itemBody }, sample);
}
async function mongoMemory() { try { const info = await client.db('admin').command({ serverStatus: 1 }); return { residentMiB: info.mem?.resident, virtualMiB: info.mem?.virtual, transactions: info.transactions, wiredTigerCacheBytes: info.wiredTiger?.cache?.['bytes currently in the cache'] }; } catch (error) { instrumentationErrors.push(String(error)); return null; } }
async function batch(workload, condition, concurrency, repetition, phase, actors, resources, count) {
  const label = `${workload}:${condition}:${concurrency}:${repetition}:${phase}`, samples = [], ram = [], rss = [], mongoBefore = await mongoMemory(), started = clock(), nodeCpu = process.cpuUsage(), cpuStart = cpuSnapshot();
  let next = 0, stopped = false;
  const phaseMetrics = { writeConflicts: 0, failedCommands: 0, abortCommands: 0, poolCheckoutMs: [] }; activePhase = phaseMetrics;
  const sampler = setInterval(() => { ram.push(os.freemem()); rss.push(process.memoryUsage().rss); if (os.freemem() < 1.5 * GiB) stopped = true; }, 250);
  try {
    await Promise.all(actors.map(async (actor, worker) => {
      while (next < count && !stopped) {
        const index = next++, dispatched = clock(), sample = { id: `${label}:${index}`, index, worker, command: workload === 'foundation-cs' ? index % 2 === 0 ? 'internal-note' : 'public-update' : index % 5 < 3 ? 'item-create' : 'item-revision', queuedMs: dispatched - started, transactionCalls: 0, callbackAttempts: 0, writeConflicts: 0 };
        sampleLookup.set(sample.id, sample);
        try {
          const result = await logicalCommand(workload, actor, resources[worker], index, label, sample);
          sample.status = result.status; sample.code = result.body.error?.code || null;
          sample.success = result.status >= 200 && result.status < 300;
          sample.expectedConflict = condition === 'same-resource' && !sample.success && result.status === 409 && sample.code === 'VERSION_CONFLICT';
          if (!sample.success && !sample.expectedConflict) sample.errorBody = result.body;
        } catch (error) { sample.status = 0; sample.code = error.code || error.name; sample.error = String(error); sample.success = false; sample.expectedConflict = false; }
        sample.latencyMs = clock() - dispatched; sample.totalMs = clock() - started; sample.callbackRetries = Math.max(0, sample.callbackAttempts - sample.transactionCalls); samples.push(sample);
      }
    }));
  } finally { clearInterval(sampler); activePhase = null; }
  const elapsedMs = clock() - started, cpu = process.cpuUsage(nodeCpu), mongoAfter = await mongoMemory(), success = samples.filter(row => row.success), conflicts = samples.filter(row => row.expectedConflict), errors = samples.filter(row => !row.success && !row.expectedConflict), codes = {};
  for (const row of samples) codes[`${row.status}:${row.code || 'OK'}`] = (codes[`${row.status}:${row.code || 'OK'}`] || 0) + 1;
  const result = { workload, condition, concurrency, repetition, phase, requested: count, completed: samples.length, success: success.length, expectedConflicts: conflicts.length, unexpectedErrors: errors.length, stopped, elapsedMs, completedPerSecond: samples.length / elapsedMs * 1000, successPerSecond: success.length / elapsedMs * 1000, latencyMs: distribution(samples.map(row => row.latencyMs)), queueMs: distribution(samples.map(row => row.queuedMs)), totalResponseMs: distribution(samples.map(row => row.totalMs)), perCommand: Object.fromEntries([...new Set(samples.map(row => row.command))].map(command => [command, { count: samples.filter(row => row.command === command).length, latencyMs: distribution(samples.filter(row => row.command === command).map(row => row.latencyMs)) }])), codes, transactionCalls: samples.reduce((sum, row) => sum + row.transactionCalls, 0), callbackAttempts: samples.reduce((sum, row) => sum + row.callbackAttempts, 0), callbackRetries: samples.reduce((sum, row) => sum + row.callbackRetries, 0), ...phaseMetrics, poolCheckoutMs: distribution(phaseMetrics.poolCheckoutMs), resource: { hostCpuPercent: busy(cpuStart, cpuSnapshot()), nodeCpuMicroseconds: cpu, nodeCpuPercentOneCore: (cpu.user + cpu.system) / elapsedMs / 10, nodeRssMaxBytes: Math.max(process.memoryUsage().rss, ...rss), freeRamMinimumBytes: Math.min(os.freemem(), ...ram), mongoBefore, mongoAfter }, samples };
  await writeFile(path.join(evidenceRoot, `${workload}-${condition}-c${concurrency}-r${repetition}-${phase}.json`), JSON.stringify(result, null, 2));
  const { samples: omitted, ...summary } = result; results.push(summary); output({ kind: 'batch', ...summary });
  if (stopped) interrupted = true;
  return { result, samples };
}
async function checkEffects(db, workload, counts, resources) {
  if (workload === 'foundation-cs') {
    assert.equal(await db.collection('cs_internal_notes').countDocuments(), counts.notes);
    assert.equal(await db.collection('cs_ticket_events').countDocuments({ kind: 'PUBLIC_UPDATE' }), counts.updates);
    assert.equal(await db.collection('cs_idempotency').countDocuments({ scope: 'ticket.internal_note' }), counts.notes);
    assert.equal(await db.collection('cs_idempotency').countDocuments({ scope: 'ticket.public_update' }), counts.updates);
    assert.equal(await db.collection('cs_audit').countDocuments({ action: 'ticket.internal_note' }), counts.notes);
    assert.equal(await db.collection('cs_audit').countDocuments({ action: 'ticket.public_update' }), counts.updates);
    for (const resource of new Set(resources)) {
      const ticket = await db.collection('cs_tickets').findOne({ _id: resource });
      assert.equal(ticket.version, 1 + await db.collection('cs_ticket_events').countDocuments({ ticketId: resource, kind: 'PUBLIC_UPDATE' }));
    }
  } else {
    assert.equal(await db.collection('internalPlanningKeys').countDocuments(), counts.creates + counts.revisions + counts.resources);
    assert.equal(await db.collection('internalPlanningAudit').countDocuments(), counts.creates + counts.revisions + counts.resources);
    assert.equal(await db.collection('internalPlanningOutbox').countDocuments(), counts.creates + counts.revisions + counts.resources);
    assert.equal(await db.collection('inventoryItems').countDocuments(), counts.creates + counts.resources);
    assert.equal(await db.collection('inventoryItemRevisions').countDocuments(), counts.creates + counts.revisions + counts.resources);
  }
}
async function cleanupCell() {
  if (server) { await new Promise(resolve => server.close(resolve)); server = null; }
  if (currentDb) { assert.ok(await currentDb.collection('ownedRun').findOne({ _id: currentMarker }), 'Owned marker missing: refusing teardown'); await currentDb.dropDatabase(); currentDb = null; }
}
let fatal;
try {
  const startup = clock();
  repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  environment.replicaStartupMs = clock() - startup;
  client = new MongoClient(repl.getUri(), { monitorCommands: true, maxPoolSize: 32, waitQueueTimeoutMS: 120000 }); await client.connect(); instrumentClient(client);
  await writeFile(path.join(evidenceRoot, 'environment.json'), JSON.stringify(environment, null, 2));
  for (const workload of ['foundation-cs', 'portfolio-guard']) for (const condition of ['same-plant', 'different-plants', 'different-tenants', 'same-resource']) for (const concurrency of [1,4,8,16]) for (let repetition = 1; repetition <= 3; repetition++) {
    if (!selectedCellIds.has(`${workload}:${condition}:${concurrency}:${repetition}`)) continue;
    const guard = await resourceGuard(concurrency), label = `${workload}:${condition}:${concurrency}:${repetition}`;
    if (!guard.allowed || interrupted) { const row = { workload, condition, concurrency, repetition, state: 'UNTESTED', reason: interrupted ? 'Runtime RAM floor reached' : 'Pre-cell resource guard', guard }; results.push(row); output(row); continue; }
    const setupStart = clock(); currentDb = client.db(`portfolio_test_f5_${randomUUID().replaceAll('-', '')}`); currentMarker = randomUUID(); await currentDb.collection('ownedRun').insertOne({ _id: currentMarker, workload, condition, concurrency, repetition });
    const runtime = await initialize({ client, db: currentDb, customerService: { allowSyntheticOrders: true } }), actors = await actorsFor(runtime, condition, concurrency, label), app = createApp(runtime, { origins: [origin] });
    server = createServer((req, res) => scopeStore.run(sampleLookup.get(req.headers['x-benchmark-sample']), () => app(req, res))); server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    let resources;
    if (workload === 'foundation-cs') { const tickets = []; for (let i = 0; i < (condition === 'same-resource' ? 1 : actors.length); i++) tickets.push(await ticketFor(runtime, actors[i], `${label}:${i}`)); resources = actors.map((actor,i) => tickets[condition === 'same-resource' ? 0 : i]); }
    else resources = await mastersFor(actors, condition, `${label}:cold`);
    const setupMs = clock() - setupStart, counts = { notes: 0, updates: 0, creates: 0, revisions: 0, resources: workload === 'portfolio-guard' ? new Set(resources).size : 0 };
    for (const phase of ['cold', 'warmup', 'warm']) {
      if (phase === 'warmup' && workload === 'portfolio-guard') { resources = await mastersFor(actors, condition, `${label}:warm`); counts.resources += new Set(resources).size; }
      const { result, samples } = await batch(workload, condition, concurrency, repetition, phase, actors, resources, phase === 'warmup' ? 40 : 200);
      result.setupMs = setupMs;
      for (const sample of samples.filter(row => row.success)) counts[sample.command === 'internal-note' ? 'notes' : sample.command === 'public-update' ? 'updates' : sample.command === 'item-create' ? 'creates' : 'revisions']++;
      if (result.unexpectedErrors) output({ kind: 'unexpected-errors', label, phase, errors: samples.filter(row => !row.success && !row.expectedConflict) });
      if (interrupted) break;
    }
    await checkEffects(currentDb, workload, counts, resources);
    await appendFile(path.join(evidenceRoot, 'effect-checks.jsonl'), JSON.stringify({ label, setupMs, counts, passed: true }) + '\n');
    await cleanupCell();
    sampleLookup.clear();
  }
} catch (error) { fatal = { name: error.name, code: error.code, message: error.message, stack: error.stack }; output({ kind: 'FATAL', error: fatal }); }
finally {
  try { await cleanupCell(); } catch (error) { fatal ||= { message: `Cleanup refused/failed: ${error.stack}` }; }
  if (client) await client.close();
  if (repl) await repl.stop();
  const after = await manifest(); await writeFile(path.join(evidenceRoot, 'source-after.json'), JSON.stringify(after, null, 2));
  if (before.digest !== after.digest || git('status', '--porcelain') !== '') fatal ||= { message: 'Baseline source changed during experiment' };
  const summary = { completedAt: new Date().toISOString(), commit: expected, sourceDigest: before.digest, sourceUnchanged: before.digest === after.digest, environment, selection, guards, instrumentationErrors, results, fatal: fatal || null };
  await writeFile(path.join(evidenceRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  output({ kind: 'FINISHED', sourceUnchanged: summary.sourceUnchanged, batches: results.filter(row => row.phase).length, measuredCommands: results.filter(row => ['cold','warm'].includes(row.phase)).reduce((sum,row) => sum + row.completed, 0), untested: results.filter(row => row.state === 'UNTESTED').length, fatal: fatal || null });
}
process.exitCode = fatal ? 1 : 0;
