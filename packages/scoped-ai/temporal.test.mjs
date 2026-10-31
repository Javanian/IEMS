import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPinnedModelScorer, createPointInTimeFeatureReader } from './temporal.mjs';

const plantId = randomUUID(), now = new Date('2026-10-31T00:00:00.000Z');
const request = { plantId, businessAsOf: '2026-10-30T00:00:00.000Z', knowledgeAsOf: '2026-10-30T12:00:00.000Z', featureSetId: 'orders-v1' };
const rows = [{ entityId: 'order-b', features: { ageDays: 2, open: true }, provenance: [
  { featureKey: 'ageDays', sourceId: 'event-b', sourceVersion: 1, occurredAt: '2026-10-29T00:00:00.000Z', availableAt: '2026-10-29T01:00:00.000Z' },
  { featureKey: 'open', sourceId: 'event-b', sourceVersion: 1, occurredAt: '2026-10-29T00:00:00.000Z', availableAt: '2026-10-29T01:00:00.000Z' }] },
{ entityId: 'order-a', features: { ageDays: 4, open: false }, provenance: [
  { featureKey: 'ageDays', sourceId: 'event-a', sourceVersion: 3, occurredAt: '2026-10-28T00:00:00.000Z', availableAt: '2026-10-28T01:00:00.000Z' },
  { featureKey: 'open', sourceId: 'event-a', sourceVersion: 3, occurredAt: '2026-10-28T00:00:00.000Z', availableAt: '2026-10-28T01:00:00.000Z' }] }];
function featureReader({ result, read = null, authorize = null } = {}) {
  const calls = { auth: 0, reads: [] };
  const reader = createPointInTimeFeatureReader({ featureKeys: ['ageDays', 'open'], clock: () => now, timeoutMs: 20,
    foundation: { async authorize(scope, target) { calls.auth++; if (authorize) await authorize(); return { tenantId: scope.tenantId, plantId: target.plantId }; } },
    source: { async readPointInTime(input) { calls.reads.push(input); return read ? read() : result; } } });
  return { reader, calls, scope: { tenantId: randomUUID(), userId: randomUUID() } };
}
const data = overrides => ({ schema: 'ANALYTICS_PIT_V1', coverage: 'COMPLETE', businessAsOf: request.businessAsOf,
  knowledgeAsOf: request.knowledgeAsOf, sourceManifestId: randomUUID(), sourceManifestHash: 'a'.repeat(64), rows, ...overrides });

test('reads only authorized point-in-time rows, preserves lineage and sorts entity IDs', async () => {
  const f = featureReader({ result: data() });
  const output = await f.reader.read(f.scope, request);
  assert.equal(output.state, 'READY');
  assert.deepEqual(output.rows.map(row => row.entityId), ['order-a', 'order-b']);
  assert.equal(output.rows[0].provenance[0].sourceVersion, 3);
  assert.equal(f.calls.reads[0].grant.plantId, plantId);
  assert.equal(f.calls.reads[0].limit, 1000);
  assert.equal(f.calls.auth, 2);
});

test('rejects future cutoffs and unknown request fields before calling the source', async () => {
  const f = featureReader({ result: data() });
  await assert.rejects(f.reader.read(f.scope, { ...request, debug: true }), { code: 'AI_INVALID_PIT_REQUEST' });
  await assert.rejects(f.reader.read(f.scope, { ...request, businessAsOf: '2026-10-31T01:00:00.000Z' }), { code: 'AI_INVALID_PIT_REQUEST' });
  assert.equal(f.calls.reads.length, 0);
});

test('incomplete coverage and timeout abstain without exposing partial rows', async () => {
  const incomplete = featureReader({ result: data({ coverage: 'INCOMPLETE' }) });
  const first = await incomplete.reader.read(incomplete.scope, request);
  assert.equal(first.state, 'ABSTAIN');
  assert.deepEqual(first.rows, []);
  const timeout = featureReader({ read: () => new Promise(() => {}) });
  const second = await timeout.reader.read(timeout.scope, request);
  assert.equal(second.reason, 'SOURCE_UNAVAILABLE');
  assert.deepEqual(second.rows, []);
});

test('rejects values that violate either business or knowledge cutoff', async () => {
  const futureBusiness = structuredClone(rows);
  futureBusiness[0].provenance[0].occurredAt = '2026-10-30T00:00:00.001Z';
  const f = featureReader({ result: data({ rows: futureBusiness }) });
  await assert.rejects(f.reader.read(f.scope, request), { code: 'AI_TEMPORAL_LEAKAGE' });
  const futureKnowledge = structuredClone(rows);
  futureKnowledge[0].provenance[0].availableAt = '2026-10-30T12:00:00.001Z';
  const g = featureReader({ result: data({ rows: futureKnowledge }) });
  await assert.rejects(g.reader.read(g.scope, request), { code: 'AI_TEMPORAL_LEAKAGE' });
});

test('rechecks analytics authorization after source returns', async () => {
  let auth = 0;
  const f = featureReader({ result: data(), authorize: () => { if (++auth > 1) throw Object.assign(new Error('denied'), { status: 403 }); } });
  await assert.rejects(f.reader.read(f.scope, request), { status: 403 });
});

test('scores only an explicit immutable model version and verifies artifact/signature receipts', async () => {
  const modelRef = { name: 'delivery-risk', version: 7, artifactDigest: 'b'.repeat(64), featureKeys: ['ageDays', 'open'] };
  const calls = [];
  const scorer = createPinnedModelScorer({ modelPort: {
    async getVersion(input) { calls.push(['version', input]); return { ...modelRef, status: 'READY' }; },
    async predict(input) { calls.push(['predict', input]); return { name: modelRef.name, version: modelRef.version, artifactDigest: modelRef.artifactDigest, values: [0.25] }; },
  } });
  const output = await scorer.predict(modelRef, [{ entityId: 'order-a', features: { ageDays: 4, open: false } }]);
  assert.equal(output.predictions[0].value, 0.25);
  assert.equal(calls[1][1].version, 7);
  assert.equal(calls[0][1].version, 7);
});

test('rejects mutable aliases, unready versions, digest mismatches and malformed predictions', async () => {
  const modelRef = { name: 'delivery-risk', version: 7, artifactDigest: 'b'.repeat(64), featureKeys: ['ageDays'] };
  const row = [{ entityId: 'order-a', features: { ageDays: 4 } }];
  const alias = createPinnedModelScorer({ modelPort: { getVersion: async () => ({}), predict: async () => ({}) } });
  await assert.rejects(alias.predict({ ...modelRef, version: 'champion' }, row), { code: 'AI_INVALID_MODEL_REQUEST' });
  const badMetadata = createPinnedModelScorer({ modelPort: { getVersion: async () => ({ name: modelRef.name, version: 7, status: 'STAGING', artifactDigest: modelRef.artifactDigest, featureKeys: modelRef.featureKeys }), predict: async () => ({}) } });
  await assert.rejects(badMetadata.predict(modelRef, row), { code: 'AI_MODEL_VERSION_UNAVAILABLE' });
  const badPrediction = createPinnedModelScorer({ modelPort: { getVersion: async () => ({ ...modelRef, status: 'READY' }), predict: async () => ({ name: modelRef.name, version: 7, artifactDigest: 'c'.repeat(64), values: [Infinity] }) } });
  await assert.rejects(badPrediction.predict(modelRef, row), { code: 'AI_MODEL_OUTPUT_INVALID' });
});
