import { open, readFile, realpath, lstat, unlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { canonicalJson, boundedTransaction } from '../../packages/tenant-foundation/commands.mjs';
import { initializeReportingSnapshots, relayReportingSnapshots } from '../../packages/domain-events/snapshot-source.mjs';
import { createProjectionConsumer, validateEvent } from '../../packages/domain-events/index.mjs';
import { SNAPSHOT_TOPIC, uuid } from '../../packages/domain-events/source-bindings.mjs';
import { createReportingSource } from '../../apps/portfolio-api/src/reporting-source.mjs';

const json = value => JSON.parse(JSON.stringify(value));
export async function validateReportingTarget({ db, root, marker }) {
  if (!uuid.test(marker) || !/^portfolio_test_[a-f0-9]{32}$/.test(db.databaseName)) throw new Error('EXPLICIT_SYNTHETIC_DATABASE_REQUIRED');
  const target = await realpath(root);
  if ((await lstat(root)).isSymbolicLink() || !(await db.collection('ownedRun').findOne({ _id: marker }))) throw new Error('OWNED_SYNTHETIC_TARGET_REQUIRED');
  const file = JSON.parse(await readFile(join(target, 'reporting-owner.json'), 'utf8'));
  if (file.schema !== 'IEMS_REPORTING_SYNTHETIC_V1' || file.marker !== marker || file.databaseName !== db.databaseName) throw new Error('EXTRACTION_OWNERSHIP_MISMATCH');
  return target;
}

async function immutableFile(root, name, value) {
  const path = join(root, name), bytes = canonicalJson(json(value)) + '\n';
  const temp = join(root, `${randomUUID()}.reporting-partial`), file = await open(temp, 'wx', 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temp, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if ((await lstat(path)).isSymbolicLink() || await readFile(path, 'utf8') !== bytes) throw new Error('IMMUTABLE_EXTRACTION_CONFLICT');
    }
  } finally { await unlink(temp); }
}

// A crash leaves both owner records for explicit, verified operator recovery.
export async function createReportingRuntime({ db, client, foundation, getScope, authorizeResource, root, marker, mode = 'LOCAL_FILE', rawSink }) {
  if (mode !== 'LOCAL_FILE') throw new Error('KAFKA_SQL_RUNTIME_UNAVAILABLE');
  if (typeof getScope !== 'function' || typeof authorizeResource !== 'function' || !foundation || !client || !db) throw new Error('PRIVATE_AUTHENTICATED_CONFIGURATION_REQUIRED');
  if (rawSink && (rawSink.kind !== 'PARQUET' || typeof rawSink.commit !== 'function' || typeof rawSink.close !== 'function')) throw new Error('EXPLICIT_PRIVATE_RAW_SINK_REQUIRED');
  root = await validateReportingTarget({ db, root, marker });
  const ownerId = randomUUID(), owners = db.collection('reportingRuntimeOwners');
  const owner = { _id: 'snapshot-v2', ownerId, marker, root, hostname: hostname(), pid: process.pid, startedAt: new Date().toISOString() };
  let lock, acquired = false, running = null, closed = false, closing = false, closePromise;
  const lockPath = join(root, 'reporting-runtime.lock');
  try {
    await owners.insertOne(owner); acquired = true;
    lock = await open(lockPath, 'wx', 0o600);
    await lock.writeFile(canonicalJson(owner)); await lock.sync();
    const source = createReportingSource({ db, client, foundation, authorizeResource });
    await initializeReportingSnapshots(db); await source.initialize();
    const current = async () => {
      if (closed || !await owners.findOne({ _id: owner._id, ownerId })) throw new Error('REPORTING_OWNER_LOST_OR_CLOSED');
      const scope = await getScope();
      const grant = await foundation.authorize(scope, { tenantId: scope.tenantId, plantId: scope.selectedPlantId, action: 'fulfillment.read' });
      await foundation.authorize(scope, { tenantId: grant.tenantId, plantId: grant.plantId, action: 'quote.read' });
      return { scope, grant };
    };
    const projection = createProjectionConsumer({ client, db, name: 'reporting.local.v2',
      authorize: async (event, session) => source.authorizeSnapshot({ scope: (await current()).scope, event, session }),
      apply: async (event, { session }) => {
        const p = event.payload, filter = { tenantId: event.tenantId, plantId: event.plantId, legalEntityId: p.legalEntityId };
        if (p.resourceType !== 'order') {
          const parent = await db.collection('reportingLocalResources').findOne({ ...filter, resourceId: p.orderId, 'payload.resourceType': 'order', 'payload.deleted': false }, { session });
          if (!parent) throw new Error('PROJECTION_PARENT_UNAVAILABLE');
        }
        await db.collection('reportingLocalResources').updateOne({ ...filter, resourceId: event.aggregateId }, { $set: { version: event.aggregateVersion, payload: p } }, { session, upsert: true });
      }
    });
    await projection.initialize();
    await db.collection('reportingLocalResources').createIndex({ tenantId: 1, plantId: 1, resourceId: 1 }, { unique: true });
    async function deliver(event) {
      validateEvent(event);
      const { scope } = await current();
      await source.authorizeSnapshot({ scope, event });
      // Raw/file effects finish outside the projection transaction; failure leaves the source marker unset.
      await immutableFile(root, `${event.eventId}.snapshot.json`, event);
      if (rawSink) await rawSink.commit(event);
      await projection.consume(event);
    }
    const producer = { async send({ topic, messages }) {
      if (topic !== SNAPSHOT_TOPIC || messages.length !== 1) throw new Error('REPORTING_TRANSPORT_ALLOWLIST');
      await deliver(JSON.parse(messages[0].value));
    } };
    async function exclusive(work) {
      if (closed || closing || running) throw new Error('REPORTING_RUNTIME_CLOSED_OR_BUSY');
      running = Promise.resolve().then(work);
      try { return await running; } finally { running = null; }
    }
    async function extract(runId, limit) {
      const { scope } = await current();
      const bundle = await source.extractCoverage({ scope, runId, limit });
      for (const event of bundle.events) await deliver(event);
      // Coverage is processed only after every referenced snapshot/raw effect commits.
      await source.extractCoverage({ scope: (await current()).scope, runId, limit });
      const exportValue = { schema: 'IEMS_REPORTING_EXTRACTION_V1', evidenceClass: 'LOCAL_FILE_SYNTHETIC', ...bundle };
      await immutableFile(root, `${runId}.coverage.json`, exportValue);
      await boundedTransaction(client, async session => {
        const active = await current();
        const grant = await foundation.authorizeInTransaction(active.scope, { tenantId: active.grant.tenantId, plantId: active.grant.plantId, action: 'fulfillment.read' }, { session });
        const key = { _id: runId, tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId };
        const old = await db.collection('reportingLocalCoverage').findOne(key, { session });
        if (old && old.hash !== bundle.manifest.hash) throw new Error('COVERAGE_IDENTITY_CONFLICT');
        await db.collection('reportingLocalCoverage').updateOne(key, { $setOnInsert: { hash: bundle.manifest.hash, manifest: bundle.manifest, coverage: 'INCOMPLETE', trustedZero: false } }, { session, upsert: true });
      });
      return { runId, hash: bundle.manifest.hash, snapshots: bundle.events.length, coverage: 'INCOMPLETE', trustedZero: false };
    }
    return Object.freeze({ ownerId, mode, status: { evidenceClass: 'LOCAL_FILE_SYNTHETIC', kafka: 'NOT_RUN', sql: 'NOT_RUN', raw: rawSink ? 'PARQUET' : 'UNAVAILABLE_FILE_MIRROR_ONLY' },
      reconcile: ({ limit = 1000 } = {}) => exclusive(async () => source.reconcileScope({ scope: (await current()).scope, limit })),
      relay: (limit = 100) => exclusive(async () => {
        const { grant } = await current();
        return relayReportingSnapshots({ db, producer, scope: grant, limit, authorize: async event => source.authorizeSnapshot({ scope: (await current()).scope, event }) });
      }),
      extract: (runId, limit = 1000) => exclusive(() => extract(runId, limit)),
      replay: event => exclusive(() => deliver(event)),
      close() {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = (async () => {
          if (running) { try { await running; } catch { /* Operation failure is returned to its caller. */ } }
          closed = true;
          await rawSink?.close();
          await lock.close();
          if (JSON.parse(await readFile(lockPath, 'utf8')).ownerId !== ownerId) throw new Error('REPORTING_LOCK_OWNER_CHANGED');
          await unlink(lockPath);
          await owners.deleteOne({ _id: owner._id, ownerId });
        })();
        return closePromise;
      }
    });
  } catch (error) {
    if (lock) await rawSink?.close();
    if (lock) { await lock.close(); await unlink(lockPath); }
    if (acquired) await owners.deleteOne({ _id: owner._id, ownerId });
    throw error;
  }
}
