import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { trainTemporalBaseline } from '../../jobs/ai/train.mjs';
import { bytesHash, createManifestFeatureSource } from './feature-manifest.mjs';
import { createLocalBaselinePort } from './local-model.mjs';
import { createPinnedModelScorer } from './temporal.mjs';

const time = day => `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const row = (day, target) => ({ observationId: `row-${day}`, predictionAt: time(day), knowledgeAsOf: time(day),
  labelOccurredAt: time(day + 1), labelAvailableAt: time(day + 1), target, features: { count: day },
  provenance: [{ featureKey: 'count', sourceId: `event-${day}`, sourceVersion: 1, occurredAt: time(day), availableAt: time(day) }] });
const dataset = () => ({ schema: 'AI_SUPERVISED_PIT_V1', featureKeys: ['count'], sourceManifestHash: 'a'.repeat(64),
  targetName: 'observedDuration', targetUnit: 'DAYS', rows: [row(1, 2), row(3, 4), row(12, 10), row(22, 20)] });
const split = { trainEnd: time(10), validationEnd: time(20) };
test('temporal baseline uses train targets only, purges unavailable labels and preserves split lineage', async () => {
  const data = dataset(); const late = row(5, 10000); late.labelAvailableAt = time(15); data.rows.push(late);
  const model = trainTemporalBaseline(data, split); assert.equal(model.mean, 3);
  assert.deepEqual(model.counts, { train: 2, validation: 1, test: 1 });
  assert.equal(model.metrics.validationMAE, 7); assert.equal(model.metrics.testMAE, 17);
  const bytes = Buffer.from(JSON.stringify(model)), artifactDigest = bytesHash(bytes);
  const port = createLocalBaselinePort({ bytes, artifactDigest, name: 'duration', version: 1, runId: 'local-synthetic-run' });
  const scorer = createPinnedModelScorer({ modelPort: port });
  const output = await scorer.predict({ name: 'duration', version: 1, artifactDigest, featureKeys: ['count'] }, [{ entityId: 'test-row', features: { count: 99 } }]);
  assert.equal(output.predictions[0].value, 3);
  await assert.rejects(port.getVersion({ name: 'duration', version: 2 }), { code: 'AI_MODEL_VERSION_UNAVAILABLE' });
});
test('feature and label leakage, duplicate observations and empty partitions are rejected', () => {
  for (const change of [d => { d.rows[0].provenance[0].availableAt = time(2); }, d => { d.rows[0].labelOccurredAt = time(1); },
    d => { d.rows.push(structuredClone(d.rows[0])); }, d => { d.rows[0].target = NaN; }]) {
    const d = dataset(); change(d); assert.throws(() => trainTemporalBaseline(d, split), /TEMPORAL_LEAKAGE_OR_INVALID_ROW/);
  }
  assert.throws(() => trainTemporalBaseline({ ...dataset(), rows: [row(1, 2)] }, split), /EMPTY_TEMPORAL_PARTITION/);
});
test('manifest source filters both cutoffs, highest version, full actor scope and checksum', async () => {
  const grant = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId'].map(k => [k, randomUUID()]));
  const manifest = { ...grant, schema: 'AI_FEATURE_HISTORY_V1', manifestId: randomUUID(), coverage: 'COMPLETE', observedAt: time(30), featureSetId: 'counts-v1', featureKeys: ['count'],
    rows: [{ entityId: 'order-a', sourceId: 'event1', sourceVersion: 1, occurredAt: time(1), availableAt: time(2), features: { count: 2 } },
      { entityId: 'order-a', sourceId: 'event2', sourceVersion: 2, occurredAt: time(3), availableAt: time(15), features: { count: 5 } }] };
  const bytes = Buffer.from(JSON.stringify(manifest)), expectedHash = bytesHash(bytes);
  const source = createManifestFeatureSource({ bytes, expectedHash });
  const input = { grant, businessAsOf: time(10), knowledgeAsOf: time(10), featureSetId: 'counts-v1', featureKeys: ['count'], limit: 10 };
  assert.equal((await source.readPointInTime(input)).rows[0].features.count, 2);
  assert.equal((await source.readPointInTime({ ...input, knowledgeAsOf: time(20) })).rows[0].features.count, 5);
  await assert.rejects(source.readPointInTime({ ...input, grant: { ...grant, legalEntityId: randomUUID() } }), { code: 'SCOPE_DENIED' });
  assert.throws(() => createManifestFeatureSource({ bytes, expectedHash: 'b'.repeat(64) }), { code: 'AI_FEATURE_MANIFEST_INVALID' });
});
