import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createTenantFoundation, createCommandExecutor } from './index.mjs';
import { planMigration, initializeMigration, stageMigration, verifyMigration, rollbackMigration } from '../../database/migrations/platform-foundation/v1.mjs';
import { explainFoundation } from '../../apps/portfolio-api/src/foundation-explain.mjs';
let replica, client, db, foundation, commands, scope, sessionId;
const ids = Object.fromEntries(['tenant', 'plant', 'entity', 'user', 'member', 'aggregate'].map(key => [key, randomUUID()]));
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await MongoClient.connect(replica.getUri());
  db = client.db(`tenant_foundation_owned_${randomUUID().replaceAll('-', '')}`);
  foundation = createTenantFoundation({ client, db, roleActions: { writer: ['stock.write', 'resource.read'] } });
  await foundation.initialize();
  await foundation.provisionTenant({ id: ids.tenant });
  await foundation.provisionUser({ id: ids.user, tenantId: ids.tenant });
  await foundation.provisionLegalEntity({ id: ids.entity, tenantId: ids.tenant });
  await foundation.provisionPlant({ id: ids.plant, tenantId: ids.tenant, legalEntityId: ids.entity });
  await foundation.provisionMembership({ id: ids.member, tenantId: ids.tenant, userId: ids.user, plantIds: [ids.plant], legalEntityIds: [ids.entity], roles: [{ role: 'writer', plantIds: [ids.plant] }] });
  const issued = await foundation.issueSession({ userId: ids.user, tenantId: ids.tenant, selectedPlantId: ids.plant, ttlMs: 60000 });
  sessionId = issued.sessionId;
  scope = await foundation.authenticate(issued.token);
  commands = createCommandExecutor({ client, db, foundation });
  await commands.initialize();
});
after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); if (replica) await replica.stop(); });
const command = key => ({ tenantId: ids.tenant, plantId: ids.plant, action: 'stock.write', aggregateId: ids.aggregate, key, expectedRevision: 0, input: { amount: '0.01', currency: 'USD' } });
const effect = async ({ session, grant, aggregateId }) => {
  await db.collection('fixtureStock').insertOne({ _id: aggregateId, tenantId: grant.tenantId, amount: '0.01', revision: 1 }, { session });
  return { data: { id: aggregateId, amount: '0.01' }, revision: 1, events: [{ type: 'stock.created', version: 1, data: { amount: '0.01' } }] };
};
test('domain result audit and event commit together; replay never reruns effect', async () => {
  const first = await commands.execute(scope, command('one'), effect);
  const replay = await commands.execute(scope, command('one'), () => { throw Error('must not run'); });
  assert.equal(replay.commandId, first.commandId);
  assert.equal(replay.replayed, true);
  assert.equal(await db.collection('outbox').countDocuments({ commandId: first.commandId }), 1);
  assert.equal(await db.collection('audit').countDocuments({ commandId: first.commandId }), 1);
  await assert.rejects(commands.execute(scope, { ...command('one'), input: { amount: '0.02' } }, effect), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('event failure rolls back domain and result', async () => {
  const aggregateId = randomUUID();
  await assert.rejects(commands.execute(scope, { ...command('bad'), aggregateId }, async context => {
    const output = await effect(context); output.events[0].version = 0; return output;
  }), { code: 'INVALID_EVENT' });
  assert.equal(await db.collection('fixtureStock').countDocuments({ _id: aggregateId }), 0);
  assert.equal(await db.collection('foundationCommandResults').countDocuments({ key: 'bad' }), 0);
});
test('files jobs exports and read models reject cross-tenant IDs and revoked replay', async () => {
  for (const collection of ['files', 'jobs', 'exports', 'readModels']) {
    const resourceId = randomUUID();
    await db.collection(collection).insertOne({ _id: resourceId, tenantId: randomUUID(), plantId: ids.plant });
    await assert.rejects(commands.readResource(scope, { tenantId: ids.tenant, plantId: ids.plant, action: 'resource.read', collection, resourceId }), { code: 'RESOURCE_NOT_FOUND' });
    const target = { tenantId: ids.tenant, plantId: ids.plant, action: 'resource.read', collection, resourceId };
    await db.collection(collection).updateOne({ _id: resourceId }, { $set: { tenantId: ids.tenant, allowedUserIds: [ids.user] } });
    assert.equal((await commands.readResource(scope, target))._id, resourceId);
    for (const acl of [null, [], [randomUUID()]]) {
      await db.collection(collection).updateOne({ _id: resourceId }, { $set: { allowedUserIds: acl } });
      await assert.rejects(commands.readResource(scope, target), { code: 'RESOURCE_NOT_FOUND' });
    }
  }
  await foundation.revokeSession({ tenantId: ids.tenant, sessionId });
  await assert.rejects(commands.execute(scope, command('one'), effect), { code: 'SCOPE_DENIED' });
});

test('staged migration verifies parity and rollback removes only its own run', async () => {
  await initializeMigration(db);
  const input = { version: 1, tenantId: ids.tenant, runId: randomUUID(), records: [{ domain: 'fixture', sourceId: '1', data: { amount: '0.01' }, ledger: [{ unit: 'USD', amount: '0.01' }] }] };
  const plan = planMigration(input);
  input.expected = { hash: plan.hash, counts: plan.counts, ledgerTotals: plan.ledgerTotals };
  await stageMigration(client, db, input);
  assert.equal((await stageMigration(client, db, input)).replayed, true);
  assert.equal((await verifyMigration(db, input)).rows, 1);
  const other = { ...input, runId: randomUUID() };
  await stageMigration(client, db, other);
  await db.collection('foundationMigrationRows').updateOne({ runId: input.runId }, { $set: { 'data.amount': '0.02' } });
  await assert.rejects(rollbackMigration(client, db, input), { code: 'MIGRATION_PARITY_FAILED' });
  assert.equal(await db.collection('foundationMigrationRows').countDocuments({ runId: input.runId }), 1);
  await db.collection('foundationMigrationRows').updateOne({ runId: input.runId }, { $set: { 'data.amount': '0.01' } });
  await rollbackMigration(client, db, input);
  assert.equal((await rollbackMigration(client, db, input)).replayed, true);
  assert.equal(await db.collection('foundationMigrationRows').countDocuments({ runId: input.runId }), 0);
  assert.equal((await verifyMigration(db, other)).rows, 1);
});

test('query lab returns real bounded execution statistics for each scoped index shape', async () => {
  const report = await explainFoundation(db, { tenantId: ids.tenant, plantId: ids.plant, userId: ids.user });
  assert.equal(report.results.length, 5);
  for (const result of report.results) {
    assert.ok(Number.isSafeInteger(result.documentsExamined));
    assert.ok(Number.isSafeInteger(result.keysExamined));
    assert.ok(result.winningPlan);
  }
  console.log(JSON.stringify({ foundationExplain: report }));
});

test('application bootstrap exposes the foundation executor without replacing domain handlers', async () => {
  const { initialize } = await import('../../apps/portfolio-api/src/app.mjs');
  const runtime = await initialize({ client, db });
  assert.equal(typeof runtime.commands.execute, 'function');
  assert.equal(typeof runtime.foundation.authorizeInTransaction, 'function');
});
