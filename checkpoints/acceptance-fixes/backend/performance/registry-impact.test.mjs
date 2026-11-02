import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startOwned } from '../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { createMongoTenantDataPort, businessRegistry, verifySourceSchemas } from '../../../../packages/tenant-lifecycle/domain-port.mjs';
import { verifyAdmissionSources } from '../../../../packages/tenant-lifecycle/admission-registry.mjs';
import { boundedTransaction } from '../../../../packages/tenant-foundation/commands.mjs';

test('complete maintained metadata delta is confined to CS digest and the twelve derived fields', async () => {
  const source = 'packages/customer-service/index.mjs';
  for (const name of ['domain-registry', 'admission-registry']) {
    const path = `packages/tenant-lifecycle/${name}.json`;
    const before = JSON.parse(execFileSync('git', ['show', `4ab4d59f01c5621ecb7d37c1d9644adbc8f247c4:${path}`], { encoding: 'utf8' }));
    const after = JSON.parse(readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8'));
    if (name === 'domain-registry') {
      assert.deepEqual(after.sources[source].fields.filter(field => !before.sources[source].fields.includes(field)), ['deadline', 'delete', 'execute', 'indexOf', 'now', 'reject', 'resolve', 'running', 'shift', 'splice', 'timer', 'unref']);
      assert.deepEqual(before.sources[source].fields.filter(field => !after.sources[source].fields.includes(field)), []);
      const oldFields = new Set(Object.values(before.sources).flatMap(row => row.fields));
      const newFields = new Set(Object.values(after.sources).flatMap(row => row.fields));
      assert.deepEqual([...newFields].filter(field => !oldFields.has(field)), ['deadline', 'running', 'shift', 'splice', 'timer', 'unref']);
      const affected = Object.values(after.collections).filter(row => row.sources.includes(source));
      assert.equal(affected.length, 19);
      assert.ok(affected.every(row => row.disposition === 'RETAIN_PRIVATE_OR_TECHNICAL'));
    }
    after.sources[source] = before.sources[source];
    assert.deepEqual(after, before);
  }
  await verifySourceSchemas(); await verifyAdmissionSources();
});

test('actual archive validation preserves unknown/private guards with the generated nested-field expansion', async t => {
  const h = await startOwned(t), alpha = h.seeded[0];
  await h.db.collection('memberships').updateOne({ _id: alpha.membershipId }, { $set: { tenantWide: true, roles: [{ role: 'saasOperator', plantIds: [], tenantWide: true }] } });
  const scope = await h.scopeOf(h.alpha), port = createMongoTenantDataPort(h.runtime);
  const snapshot = () => boundedTransaction(h.client, session => port.snapshot({ scope, grant: { tenantId: alpha.tenantId, plantId: alpha.plantId }, session }));
  const nested = Object.fromEntries(['deadline', 'running', 'shift', 'splice', 'timer', 'unref'].map(field => [field, true]));
  const row = { _id: randomUUID(), tenantId: alpha.tenantId, plantId: alpha.plantId, resourceId: randomUUID(), value: nested };
  const collection = h.db.collection('operationsSamples');
  await collection.insertOne(row);
  assert.equal(businessRegistry.collections.operationsSamples.disposition, 'BUSINESS');
  assert.ok((await snapshot()).resources.some(resource => resource.collection === 'operationsSamples'));
  for (const [patch, code] of [
    [{ unknownQueueField: true }, 'TENANT_SCHEMA_UNKNOWN_FIELD'],
    [{ value: { unknownQueueField: true } }, 'TENANT_SCHEMA_UNKNOWN_FIELD'],
    [{ password: 'synthetic' }, 'TENANT_PRIVATE_FIELD'],
    [{ value: { token: 'synthetic' } }, 'TENANT_PRIVATE_FIELD']
  ]) {
    await collection.replaceOne({ _id: row._id }, { ...row, ...patch });
    await assert.rejects(snapshot(), { code });
  }
  await collection.replaceOne({ _id: row._id }, row);
  await snapshot();
});
