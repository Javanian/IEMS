import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createModelWorkflow } from './models.mjs';
import { createMlflowPort } from './mlflow.mjs';

function fixture() {
  const grant = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId', 'userId'].map(k => [k, randomUUID()]));
  let state = {}, pending, denied = false, changed = null;
  const session = { inTransaction: () => true, startTransaction() { pending = structuredClone(state); }, async commitTransaction() { state = pending; }, async abortTransaction() {}, async endSession() {} };
  const match = (row, f) => Object.entries(f).every(([k, v]) => row[k] === v);
  const runtime = { client: { startSession: () => session }, db: { collection(name) { return {
    async findOne(f) { return structuredClone((pending[name] ?? []).find(row => match(row, f)) ?? null); },
    async createIndex() {}, async insertOne(row) { pending[name] ??= []; pending[name].push(structuredClone(row)); },
    async insertMany(rows) { pending[name] ??= []; pending[name].push(...structuredClone(rows)); },
    async updateOne(f, u) { const row = (pending[name] ?? []).find(r => match(r, f)); if (!row) return { matchedCount: 0 };
      Object.assign(row, structuredClone(u.$set ?? {})); for (const [k, v] of Object.entries(u.$inc ?? {})) row[k] = (row[k] ?? 0) + v; return { matchedCount: 1 }; },
  }; } }, foundation: { async authorize() { if (denied) throw Object.assign(new Error('DENIED'), { code: 'DENIED' }); return grant; },
    async authorizeInTransaction(s, target) { if (denied || target.plantId !== grant.plantId) throw Object.assign(new Error('DENIED'), { code: 'DENIED' }); return grant; } },
    featureKeys: ['count'], features: { async read() { return { state: 'READY', rows: [{ entityId: 'one', features: { count: 1 } }], sourceManifestId: 'manifest', sourceManifestHash: 'a'.repeat(64) }; } },
    modelPort: { async getVersion({ name, version }) { return { name, version, status: 'READY', artifactDigest: String(version).repeat(64),
      featureKeys: ['count'], runId: `run-${version}`, sourceManifestHash: 'b'.repeat(64) }; },
    async predict({ name, version, artifactDigest }) { if (changed) changed(state); return { name, version, artifactDigest, values: [4] }; } } };
  const scope = {}, service = createModelWorkflow(runtime), base = { plantId: grant.plantId };
  const selection = (version, revision = 0) => ({ ...base, key: randomUUID(), expectedRevision: revision, reason: 'Operator-approved local test', rollback: false,
    model: { name: 'counts', version, artifactDigest: String(version).repeat(64), featureKeys: ['count'] } });
  return { service, runtime, scope, base, selection, state: () => state, deny() { denied = true; }, change(fn) { changed = fn; } };
}
test('model selection and rollback retain immutable lineage with CAS, receipt, audit and history', async () => {
  const f = fixture(), first = f.selection(1);
  await f.service.select(f.scope, first); assert.equal((await f.service.select(f.scope, first)).replayed, true);
  await f.service.select(f.scope, f.selection(2, 1));
  await f.service.select(f.scope, { ...f.selection(1, 2), rollback: true });
  const row = await f.service.status(f.scope, f.base); assert.equal(row.model.version, 1); assert.equal(row.revision, 3);
  assert.equal(f.state().aiModelSelectionHistory.length, 3); assert.equal(f.state().audit.length, 3);
  await assert.rejects(f.service.select(f.scope, { ...f.selection(3, 3), rollback: true }), { code: 'AI_ROLLBACK_VERSION_INVALID' });
  f.deny(); await assert.rejects(f.service.select(f.scope, first), { code: 'DENIED' });
});
test('predictions carry source and model lineage and recheck selection after model await', async () => {
  const f = fixture(); await f.service.select(f.scope, f.selection(1));
  const input = { ...f.base, businessAsOf: '2026-01-01T00:00:00.000Z', knowledgeAsOf: '2026-01-02T00:00:00.000Z', featureSetId: 'counts' };
  const result = await f.service.predict(f.scope, input); assert.equal(result.predictions[0].value, 4); assert.equal(result.modelLineage.runId, 'run-1');
  f.change(state => { state.aiModelSelections[0].revision++; });
  await assert.rejects(f.service.predict(f.scope, input), { code: 'AI_MODEL_SELECTION_CHANGED' });
  const unavailable = createModelWorkflow({ ...f.runtime, modelPort: null, features: null });
  assert.equal((await unavailable.predict(f.scope, input)).state, 'ABSTAIN');
});
test('MLflow fixed registry/model endpoint, separate credentials and receipt identity gates', async () => {
  const requests = [], digest = 'a'.repeat(64), binding = { name: 'counts', version: 1, artifactDigest: digest, featureKeys: ['count'],
    servingUrl: 'https://serving.example/', servingToken: 'test-serving-token' };
  let badReceipt = false;
  const port = createMlflowPort({ registryUrl: 'https://registry.example/', registryToken: 'test-registry-token', bindings: [binding],
    async fetchImpl(url, options) {
      requests.push({ url: String(url), options });
      if (url.hostname === 'registry.example') return Response.json({ model_version: { name: 'counts', version: '1', status: 'READY', run_id: 'run', tags: [
        { key: 'iems.artifact.sha256', value: digest }, { key: 'iems.feature.keys', value: '["count"]' }, { key: 'iems.source.manifest.sha256', value: 'b'.repeat(64) }] } });
      return Response.json({ predictions: [3] }, { headers: badReceipt ? {} : { 'x-iems-model-name': 'counts', 'x-iems-model-version': '1', 'x-iems-artifact-sha256': digest } });
    } });
  assert.equal((await port.getVersion({ name: 'counts', version: 1 })).runId, 'run');
  assert.deepEqual((await port.predict({ name: 'counts', version: 1, artifactDigest: digest, featureRows: [{ count: 2 }] })).values, [3]);
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-registry-token'); assert.equal(requests[1].options.headers.authorization, 'Bearer test-serving-token');
  assert.equal(requests[1].options.redirect, 'error'); assert.equal(JSON.parse(requests[1].options.body).dataframe_split.columns[0], 'count');
  badReceipt = true; await assert.rejects(port.predict({ name: 'counts', version: 1, artifactDigest: digest, featureRows: [{ count: 2 }] }), { code: 'AI_MODEL_OUTPUT_INVALID' });
  await assert.rejects(port.getVersion({ name: 'counts', version: 2 }), { code: 'AI_MODEL_VERSION_UNAVAILABLE' });
});
