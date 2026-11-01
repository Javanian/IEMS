import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { startOwned, orderWithStock } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { createReportingRuntime, reportingDatabaseName, validateReportingTarget } from './reporting-runtime.mjs';
import { validatePrivateConfig, runReportingCli } from './reporting-cli.mjs';
import { relayReportingSnapshots } from '../../packages/domain-events/snapshot-source.mjs';
import { contentHash } from '../../packages/tenant-foundation/commands.mjs';

async function extractionRoot(h, marker) {
  assert.ok(process.env.PAPERCLIP_RUN_SCRATCH_DIR, 'Explicit run scratch required');
  const root = join(process.env.PAPERCLIP_RUN_SCRATCH_DIR, `reporting-${randomUUID()}`);
  await mkdir(root);
  await writeFile(join(root, 'reporting-owner.json'), JSON.stringify({ schema: 'IEMS_REPORTING_SYNTHETIC_V1', marker, databaseName: h.db.databaseName }));
  return root;
}

test('reporting namespace policy retains legacy names and only uniquely identified QA lanes', () => {
  assert.equal(reportingDatabaseName(`portfolio_test_${'a'.repeat(32)}`), true);
  for (const lane of ['business', 'visual', 'security']) assert.equal(reportingDatabaseName(`portfolio_owned_iems_qa_${lane}_01234567_${'a'.repeat(16)}`), true);
  for (const name of ['iems', 'portfolio_owned_shared', 'portfolio_owned_iems_qa_business_', 'portfolio_owned_iems_qa_visual_54a8d657', `portfolio_owned_iems_qa_other_01234567_${'a'.repeat(16)}`, `portfolio_test_${'a'.repeat(31)}`, undefined]) assert.equal(reportingDatabaseName(name), false);
});

test('private reporting runtime: authorized source/extraction, local delivery, replay, singleton and cleanup', async t => {
  const h = await startOwned(t), order = await orderWithStock(h, { orderQuantity: '1', reserve: '1' });
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: order.so._id, expectedVersion: order.so.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: order.reservation._id, quantity: '1' }], reference: 'Runtime synthetic', idempotencyKey: randomUUID() }, 201);
  const invoice = await h.ok('/fulfillment/invoices', { salesOrderId: order.so._id, expectedVersion: order.so.version, lines: [{ shipmentId: shipment._id, quantity: '1' }], idempotencyKey: randomUUID() }, 201);
  await h.ok('/fulfillment/payments', { accountId: order.account._id, amount: '0.01', currency: 'USD', reference: 'Runtime synthetic', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: '0.01' }], idempotencyKey: randomUUID() }, 201);
  const marker = (await h.db.collection('ownedRun').findOne({}))._id, root = await extractionRoot(h, marker);
  await t.test('actual target requires namespace, DB marker and matching nonsymlink absolute root', async () => {
    assert.equal(await validateReportingTarget({ db: h.db, root, marker }), root);
    await assert.rejects(validateReportingTarget({ db: h.db, root: '.', marker }), /EXPLICIT_EXTRACTION_ROOT_REQUIRED/);
    await assert.rejects(validateReportingTarget({ db: h.db, root, marker: randomUUID() }), /OWNED_SYNTHETIC_TARGET_REQUIRED/);
    const ownerPath = join(root, 'reporting-owner.json'), owner = await readFile(ownerPath, 'utf8');
    await writeFile(ownerPath, JSON.stringify({ ...JSON.parse(owner), databaseName: 'portfolio_owned_shared' }));
    try { await assert.rejects(validateReportingTarget({ db: h.db, root, marker }), /EXTRACTION_OWNERSHIP_MISMATCH/); }
    finally { await writeFile(ownerPath, owner); }
    for (const databaseName of ['iems', 'portfolio_owned_shared', 'portfolio_owned_iems_qa_business_01234567']) {
      await assert.rejects(validateReportingTarget({ db: h.client.db(databaseName), root, marker }), /EXPLICIT_SYNTHETIC_DATABASE_REQUIRED/);
    }
    const alias = `${root}-link`;
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try { await assert.rejects(validateReportingTarget({ db: h.db, root: alias, marker }), /OWNED_SYNTHETIC_TARGET_REQUIRED/); }
    finally { await unlink(alias); }
  });
  let scope = await h.scopeOf(h.alpha), denied = false;
  const options = { ...h.runtime, root, marker, getScope: async () => scope, authorizeResource: async ({ grant, resource, session }) => {
    assert.ok(session.inTransaction()); assert.equal(resource.tenantId, grant.tenantId); assert.equal(resource.plantId, grant.plantId);
    return !denied;
  } };
  let runtime = await createReportingRuntime(options);
  try {
    await t.test('singleton rejects same and alternate roots without releasing active owner', async () => {
      await assert.rejects(createReportingRuntime(options), error => error.code === 11000);
      const other = await extractionRoot(h, marker);
      await assert.rejects(createReportingRuntime({ ...options, root: other }), error => error.code === 11000);
      assert.equal((await h.db.collection('reportingRuntimeOwners').findOne({})).ownerId, runtime.ownerId);
    });
    const page = await runtime.reconcile();
    assert.equal(page.manifest.coverage, 'INCOMPLETE'); assert.equal(page.manifest.trustedZero, false);
    const rows = await h.db.collection('reportingSnapshotOutbox').find({}).toArray();
    assert.equal(rows.length, 3);
    await t.test('relay commits file and Mongo effects, preserves domain markers, replays lost marker', async () => {
      await h.db.collection('reportingSnapshotOutbox').updateMany({}, { $set: { kafkaPublishedAt: 'DOMAIN_UNCHANGED', publishedAt: 'RABBIT_UNCHANGED' } });
      assert.equal(await runtime.relay(), 3);
      assert.equal(await runtime.relay(), 0);
      assert.equal(await h.db.collection('analyticsReceipts').countDocuments({ consumer: 'reporting.local.v2' }), 3);
      assert.equal(await h.db.collection('reportingLocalResources').countDocuments({}), 3);
      for (const row of rows) assert.deepEqual(JSON.parse(await readFile(join(root, `${row._id}.snapshot.json`), 'utf8')), row.envelope);
      await h.db.collection('reportingSnapshotOutbox').updateOne({ _id: rows[0]._id }, { $set: { reportingKafkaPublishedAt: null } });
      assert.equal(await runtime.relay(), 1);
      assert.equal(await h.db.collection('analyticsReceipts').countDocuments({ consumer: 'reporting.local.v2' }), 3);
      for (const row of await h.db.collection('reportingSnapshotOutbox').find({}).toArray()) {
        assert.equal(row.kafkaPublishedAt, 'DOMAIN_UNCHANGED'); assert.equal(row.publishedAt, 'RABBIT_UNCHANGED');
      }
    });
    await t.test('coverage exports immutable snapshots before incomplete coverage receipt and detects tampering', async () => {
      const result = await runtime.extract(page.manifest.runId);
      assert.equal(result.snapshots, 3); assert.equal(result.trustedZero, false);
      await runtime.extract(page.manifest.runId);
      const bundle = JSON.parse(await readFile(join(root, `${page.manifest.runId}.coverage.json`), 'utf8'));
      assert.equal(bundle.events[0].payload.resourceType, 'order'); assert.deepEqual(bundle.manifest, page.manifest);
      assert.equal((await h.db.collection('reportingLocalCoverage').findOne({ _id: page.manifest.runId })).trustedZero, false);
      await h.db.collection('reportingSourceCoverage').updateOne({ runId: page.manifest.runId }, { $set: { hash: '0'.repeat(64) } });
      await assert.rejects(runtime.extract(page.manifest.runId), /COVERAGE_HASH_OR_BOUND_CONFLICT/);
      await h.db.collection('reportingSourceCoverage').updateOne({ runId: page.manifest.runId }, { $set: { hash: page.manifest.hash } });
    });
    await t.test('duplicate replay reauthorizes resources and scope, gaps/corruption never acknowledge', async () => {
      denied = true; await assert.rejects(runtime.replay(rows[0].envelope), /SOURCE_RESOURCE_DENIED/); denied = false;
      const original = scope; scope = await h.scopeOf(h.beta);
      await assert.rejects(runtime.replay(rows[0].envelope), /SOURCE_SCOPE_DENIED/); scope = original;
      const restore = await h.setRoles(h.seeded[0], ['quoteReader']);
      try { await assert.rejects(runtime.replay(rows[0].envelope), /Scope denied/); } finally { await restore(); }
      await h.db.collection('salesOrders').updateOne({ _id: order.so._id }, { $set: { revoked: true } });
      await assert.rejects(runtime.replay(rows[0].envelope), /SOURCE_RESOURCE_REVOKED/);
      await h.db.collection('salesOrders').updateOne({ _id: order.so._id }, { $unset: { revoked: '' } });
      await assert.rejects(runtime.replay({ ...rows[0].envelope, aggregateVersion: 9 }), /IMMUTABLE_REPORTING_EVIDENCE_MISSING/);
      const changed = { ...rows[0].envelope, occurredAt: '2026-10-29T00:00:00.000Z' };
      await h.db.collection('reportingSnapshotOutbox').updateOne({ _id: rows[0]._id }, { $set: { envelope: changed } });
      try { await assert.rejects(runtime.replay(changed), /IMMUTABLE_REPORTING_EVIDENCE_CORRUPT_OR_UNSEALED/); }
      finally { await h.db.collection('reportingSnapshotOutbox').updateOne({ _id: rows[0]._id }, { $set: { envelope: rows[0].envelope } }); }
      assert.equal(await h.db.collection('analyticsReceipts').countDocuments({ consumer: 'reporting.local.v2' }), 3);
    });
    await t.test('current revoked session fails even for already consumed event', async () => {
      const saved = await h.db.collection('sessions').findOne({ userId: scope.userId, revoked: false });
      await h.db.collection('sessions').updateOne({ _id: saved._id }, { $set: { revoked: true } });
      try { await assert.rejects(runtime.replay(rows[0].envelope), /Scope denied/); }
      finally { await h.db.collection('sessions').updateOne({ _id: saved._id }, { $set: { revoked: false } }); }
    });
  } finally { await Promise.all([runtime.close(), runtime.close()]); }
  assert.equal(await h.db.collection('reportingRuntimeOwners').countDocuments({}), 0);
  assert.ok(!(await readdir(root)).includes('reporting-runtime.lock'));
  await assert.rejects(runtime.relay(), /CLOSED_OR_BUSY/);
  runtime = await createReportingRuntime(options);
  await runtime.close();
  await t.test('raw failure leaves publication pending, closes owned sink and permits exact replay', async () => {
    const row = await h.db.collection('reportingSnapshotOutbox').findOne({});
    await h.db.collection('reportingSnapshotOutbox').updateOne({ _id: row._id }, { $set: { reportingKafkaPublishedAt: null } });
    let sinkClosed = false;
    runtime = await createReportingRuntime({ ...options, rawSink: { kind: 'PARQUET', commit: async () => { throw new Error('INJECTED_RAW_FAILURE'); }, close: async () => { sinkClosed = true; } } });
    try {
      await assert.rejects(runtime.relay(), /INJECTED_RAW_FAILURE/);
      assert.equal((await h.db.collection('reportingSnapshotOutbox').findOne({ _id: row._id })).reportingKafkaPublishedAt, null);
    } finally { await runtime.close(); }
    assert.equal(sinkClosed, true);
    runtime = await createReportingRuntime(options);
    try { assert.equal(await runtime.relay(), 1); } finally { await runtime.close(); }
    assert.equal(await h.db.collection('analyticsReceipts').countDocuments({ consumer: 'reporting.local.v2' }), 3);
  });
  await t.test('concurrent runtime calls reject and close waits for the active delivery', async () => {
    let unblock, started;
    const gate = new Promise(resolve => { unblock = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    runtime = await createReportingRuntime({ ...options, getScope: async () => { started(); await gate; return scope; } });
    const active = runtime.relay(); await entered;
    await assert.rejects(runtime.reconcile(), /CLOSED_OR_BUSY/);
    const closing = runtime.close();
    await assert.rejects(runtime.relay(), /CLOSED_OR_BUSY/);
    unblock(); await active; await closing;
    assert.equal(await h.db.collection('reportingRuntimeOwners').countDocuments({}), 0);
  });
  await t.test('CLI uses explicit private token and loopback marker, closes its owner/client', async () => {
    const config = { uri: h.client.options.hosts[0].toString(), databaseName: h.db.databaseName, root, marker, token: h.alpha.slice('portfolio_session='.length) };
    config.uri = `mongodb://${config.uri}/?replicaSet=${h.client.options.replicaSet}`;
    const report = await runReportingCli(config, { command: 'reconcile' });
    assert.equal(report.coverage, 'INCOMPLETE'); assert.equal(report.status.kafka, 'NOT_RUN');
    assert.equal(await h.db.collection('reportingRuntimeOwners').countDocuments({}), 0);
    await assert.rejects(validatePrivateConfig({ ...config, uri: 'mongodb://example.com:27017/' }), /SYNTHETIC_LOOPBACK_SOURCE_ONLY/);
    await assert.rejects(validatePrivateConfig({ ...config, databaseName: 'iems' }), /EXPLICIT_PRIVATE_SYNTHETIC_CONFIG_REQUIRED/);
    await assert.rejects(validatePrivateConfig({ ...config, marker: randomUUID() }), /EXTRACTION_OWNERSHIP_MISMATCH/);
    for (const uri of ['mongodb://localhost:27017/', 'mongodb://127.0.0.1:27017/foreign', 'mongodb://user:pass@127.0.0.1:27017/', 'mongodb://127.0.0.1:27017/?authSource=admin']) await assert.rejects(validatePrivateConfig({ ...config, uri }), /SYNTHETIC_LOOPBACK_SOURCE_ONLY/);
    await assert.rejects(validatePrivateConfig({ ...config, token: 'invalid' }), /EXPLICIT_PRIVATE_SYNTHETIC_CONFIG_REQUIRED/);
    await assert.rejects(validatePrivateConfig({ ...config, extra: true }), /EXPLICIT_PRIVATE_SYNTHETIC_CONFIG_REQUIRED/);
    await assert.rejects(validatePrivateConfig({ ...config, root: '.' }), /EXPLICIT_EXTRACTION_ROOT_REQUIRED/);
  });
});

test('relay dependency graph overrides reversed UUIDs, preserves sequence and rejects missing dependencies', async t => {
  const h = await startOwned(t), grant = { tenantId: randomUUID(), plantId: randomUUID(), legalEntityId: randomUUID() };
  const orderId = 'ffffffff-ffff-4fff-8fff-ffffffffffff', childId = '00000000-0000-4000-8000-000000000001';
  function event(resourceId, resourceType, version = 1) {
    const envelope = { eventId: randomUUID(), schemaVersion: 2, tenantId: grant.tenantId, plantId: grant.plantId, aggregateId: resourceId, aggregateVersion: version, type: 'reporting.snapshot.v2', occurredAt: '2026-10-30T00:00:00.000Z', payload: { resourceId, resourceType, legalEntityId: grant.legalEntityId, deleted: false, baseline: false,
      ...(resourceType === 'order' ? { amount: '1.00', currency: 'USD', quantities: [{ quantity: '1', uom: 'KG' }] } : { orderId, quantity: '1', uom: 'KG' }),
      source: { collection: 'salesOrders', id: resourceId, version, hash: 'a'.repeat(64), eventIds: [], sourceOccurredAt: null, mappingVersion: 1 } } };
    return { _id: envelope.eventId, tenantId: grant.tenantId, plantId: grant.plantId, aggregateId: resourceId, aggregateVersion: version, envelope, envelopeHash: contentHash(envelope), reportingKafkaPublishedAt: null };
  }
  const db = { collection: name => h.db.collection(`relay_${name}`) }, collection = db.collection('reportingSnapshotOutbox');
  const parent = event(orderId, 'order'), child = event(childId, 'fulfillment'), child2 = event(childId, 'fulfillment', 2);
  await collection.insertMany([child2, child, parent]);
  const sent = [], authorized = [], producer = { send: async value => sent.push(JSON.parse(value.messages[0].value)) };
  const relay = options => relayReportingSnapshots({ db, producer, scope: grant, authorize: async e => authorized.push(e.eventId), ...options });
  assert.equal(await relay({ limit: 1 }), 1); assert.equal(sent[0].eventId, parent._id);
  assert.equal(await relay({}), 2); assert.deepEqual(sent.map(e => e.eventId), [parent._id, child._id, child2._id]); assert.deepEqual(authorized, sent.map(e => e.eventId));
  await collection.updateOne({ _id: child._id }, { $set: { reportingKafkaPublishedAt: null } });
  assert.equal(await relay({}), 1); assert.equal(contentHash(sent.at(-1)), contentHash(child.envelope));
  const gap = event(randomUUID(), 'order', 2); await collection.insertOne(gap);
  await assert.rejects(relay({}), /REPORTING_SEQUENCE_GAP/); assert.equal((await collection.findOne({ _id: gap._id })).reportingKafkaPublishedAt, null);
  const namespace = { collection: name => h.db.collection(`missing_${name}`) }, orphan = event(randomUUID(), 'fulfillment');
  await namespace.collection('reportingSnapshotOutbox').insertOne(orphan);
  await assert.rejects(relayReportingSnapshots({ db: namespace, producer, scope: grant, authorize: async () => true }), /REPORTING_PARENT_UNAVAILABLE/);
  const isolated = { collection: name => h.db.collection(`denied_${name}`) }, blocked = event(randomUUID(), 'order');
  await isolated.collection('reportingSnapshotOutbox').insertOne(blocked);
  await assert.rejects(relayReportingSnapshots({ db: isolated, producer, scope: grant, authorize: async () => false }), /REPORTING_DELIVERY_DENIED/);
  assert.equal((await isolated.collection('reportingSnapshotOutbox').findOne({ _id: blocked._id })).reportingKafkaPublishedAt, null);
  await assert.rejects(relayReportingSnapshots({ db, producer }), /EXPLICIT_REPORTING_SCOPE_AUTHORIZATION_REQUIRED/);
});
