import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { createMongoTenantDataPort, businessRegistry } from '../../../packages/tenant-lifecycle/domain-port.mjs';
import { boundedTransaction } from '../../../packages/tenant-foundation/commands.mjs';

const root = new URL('../../../', import.meta.url);
const source = 'apps/portfolio-api/src/operations.mjs';
test('generated registry delta stays within the exact Board exception', () => {
  for (const name of ['admission-registry', 'domain-registry']) {
    const path = `packages/tenant-lifecycle/${name}.json`;
    const before = JSON.parse(execFileSync('git', ['show', `eda87776:${path}`], { encoding: 'utf8' }));
    const after = JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    if (name === 'admission-registry') after.sources[source] = before.sources[source];
    else {
      assert.deepEqual(after.sources[source].fields.filter(f => !before.sources[source].fields.includes(f)), ['TransientTransactionError', 'hasErrorLabel']);
      assert.deepEqual(before.sources[source].fields.filter(f => !after.sources[source].fields.includes(f)), []);
      after.sources[source] = before.sources[source];
    }
    assert.deepEqual(after, before);
  }
  const before = JSON.parse(execFileSync('git', ['show', 'eda87776:packages/tenant-lifecycle/domain-registry.json'], { encoding: 'utf8' }));
  const allFields = registry => [...new Set(Object.values(registry.sources).flatMap(s => s.fields))].sort();
  assert.deepEqual(allFields(businessRegistry), allFields(before));
  const fields = (registry, spec) => new Set(spec.fields ?? spec.sources.flatMap(p => registry.sources[p].fields));
  const expanded = Object.entries(businessRegistry.collections).flatMap(([name, spec]) => {
    const old = fields(before, before.collections[name]), added = [...fields(businessRegistry, spec)].filter(f => !old.has(f));
    return added.length ? [{ name, disposition: spec.disposition, added }] : [];
  });
  assert.deepEqual(expanded.filter(s => s.disposition === 'BUSINESS').map(s => s.name), ['manufacturingWorkOrders', 'operationsAudit', 'operationsKeys', 'operationsSampleRevisions', 'operationsSamples', 'qualityResources']);
  assert.ok(expanded.every(s => s.added.join(',') === 'TransientTransactionError,hasErrorLabel'));
  console.log(JSON.stringify({ topLevelSchemaExpansion: expanded, nestedGlobalFieldsUnchanged: true }));
});

test('actual domain snapshot admits only the bounded added fields and retains schema/private guards', async t => {
  const h = await startOwned(t), alpha = h.seeded[0];
  const membership = await h.db.collection('memberships').findOne({ _id: alpha.membershipId });
  await h.db.collection('memberships').updateOne({ _id: alpha.membershipId }, { $set: { tenantWide: true, roles: [{ role: 'saasOperator', plantIds: [], tenantWide: true }] } });
  const scope = await h.scopeOf(h.alpha), port = createMongoTenantDataPort(h.runtime);
  const snapshot = () => boundedTransaction(h.client, session => port.snapshot({ scope, grant: { tenantId: alpha.tenantId, plantId: alpha.plantId }, session }));
  const collection = h.db.collection('operationsSamples');
  const row = { _id: randomUUID(), tenantId: alpha.tenantId, plantId: alpha.plantId, resourceId: randomUUID(), hasErrorLabel: true, TransientTransactionError: true, value: { hasErrorLabel: true, TransientTransactionError: true } };
  await collection.insertOne(row);
  try {
    assert.ok((await snapshot()).resources.some(r => r.collection === 'operationsSamples'));
    for (const [patch, code] of [
      [{ unknownTpr165Field: true }, 'TENANT_SCHEMA_UNKNOWN_FIELD'],
      [{ value: { unknownTpr165Field: true } }, 'TENANT_SCHEMA_UNKNOWN_FIELD'],
      [{ password: 'synthetic' }, 'TENANT_PRIVATE_FIELD'],
      [{ value: { token: 'synthetic' } }, 'TENANT_PRIVATE_FIELD']
    ]) {
      await collection.replaceOne({ _id: row._id }, { ...row, ...patch });
      await assert.rejects(snapshot(), { code });
    }
    await collection.replaceOne({ _id: row._id }, row);
    await snapshot();
  } finally {
    await collection.deleteOne({ _id: row._id });
    await h.db.collection('memberships').updateOne({ _id: alpha.membershipId }, { $set: { tenantWide: membership.tenantWide ?? false, roles: membership.roles } });
  }
  assert.equal((await h.req('/operations/dashboard', undefined, h.alpha)).status, 200);
  const session = await h.db.collection('sessions').findOne({ tenantId: alpha.tenantId, userId: alpha.userId, revoked: false });
  assert.ok(session);
  await h.runtime.foundation.revokeSession({ tenantId: alpha.tenantId, sessionId: session._id });
  assert.equal((await h.req('/operations/dashboard', undefined, h.alpha)).status, 401);
  console.log('Actual domain unknown/private top-level/nested rejections PASS; revoked dashboard session401 PASS');
});
