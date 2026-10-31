import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { bytesHash } from '../../packages/scoped-ai/feature-manifest.mjs';

const stamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
export function trainTemporalBaseline(dataset, { trainEnd, validationEnd }) {
  if (!stamp(trainEnd) || !stamp(validationEnd) || trainEnd >= validationEnd || dataset?.schema !== 'AI_SUPERVISED_PIT_V1' ||
      !/^[a-f0-9]{64}$/.test(dataset.sourceManifestHash) || typeof dataset.targetName !== 'string' || !dataset.targetName ||
      typeof dataset.targetUnit !== 'string' || !dataset.targetUnit || !Array.isArray(dataset.featureKeys) || !dataset.featureKeys.length ||
      !Array.isArray(dataset.rows) || !dataset.rows.length || dataset.rows.length > 100000) throw new Error('INVALID_TRAINING_DATASET');
  const partitions = { train: [], validation: [], test: [] }, identities = new Set();
  for (const row of dataset.rows) {
    if (typeof row.observationId !== 'string' || !row.observationId || identities.has(row.observationId) ||
        !stamp(row.predictionAt) || !stamp(row.knowledgeAsOf) || !stamp(row.labelOccurredAt) || !stamp(row.labelAvailableAt) ||
        row.knowledgeAsOf > row.predictionAt || row.labelOccurredAt <= row.predictionAt || row.labelAvailableAt < row.labelOccurredAt ||
        typeof row.target !== 'number' || !Number.isFinite(row.target) || !row.features ||
        Object.keys(row.features).length !== dataset.featureKeys.length || dataset.featureKeys.some(k => !Object.hasOwn(row.features, k) ||
          !(typeof row.features[k] === 'number' && Number.isFinite(row.features[k]) || typeof row.features[k] === 'boolean' || row.features[k] === null)) ||
        !Array.isArray(row.provenance) || row.provenance.length !== dataset.featureKeys.length ||
        new Set(row.provenance.map(p => p.featureKey)).size !== dataset.featureKeys.length || row.provenance.some(p =>
          !dataset.featureKeys.includes(p.featureKey) || typeof p.sourceId !== 'string' || !p.sourceId ||
          !Number.isSafeInteger(p.sourceVersion) || p.sourceVersion < 1 || !stamp(p.occurredAt) || !stamp(p.availableAt) ||
          p.occurredAt > row.predictionAt || p.availableAt > row.knowledgeAsOf)) throw new Error('TEMPORAL_LEAKAGE_OR_INVALID_ROW');
    identities.add(row.observationId);
    if (row.predictionAt <= trainEnd && row.labelAvailableAt <= trainEnd) partitions.train.push(row);
    else if (row.predictionAt > trainEnd && row.predictionAt <= validationEnd && row.labelAvailableAt <= validationEnd) partitions.validation.push(row);
    else if (row.predictionAt > validationEnd) partitions.test.push(row);
    // Labels unavailable at the partition boundary are purged, never moved into another partition.
  }
  if (!partitions.train.length || !partitions.validation.length || !partitions.test.length) throw new Error('EMPTY_TEMPORAL_PARTITION');
  const mean = partitions.train.reduce((sum, row) => sum + row.target / partitions.train.length, 0);
  if (!Number.isFinite(mean)) throw new Error('INVALID_BASELINE');
  const mae = rows => rows.reduce((sum, row) => sum + Math.abs(row.target - mean) / rows.length, 0);
  return { schema: 'AI_MEAN_BASELINE_V1', algorithm: 'TRAIN_ONLY_MEAN', mean, featureKeys: dataset.featureKeys,
    targetName: dataset.targetName, targetUnit: dataset.targetUnit, sourceManifestHash: dataset.sourceManifestHash,
    trainEnd, validationEnd, counts: Object.fromEntries(Object.entries(partitions).map(([k, rows]) => [k, rows.length])),
    metrics: { validationMAE: mae(partitions.validation), testMAE: mae(partitions.test) },
    observationIds: Object.fromEntries(Object.entries(partitions).map(([k, rows]) => [k, rows.map(r => r.observationId).sort()])) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, trainEnd, validationEnd] = process.argv.slice(2);
  const bytes = await readFile(input);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('TRAINING_INPUT_TOO_LARGE');
  const model = { ...trainTemporalBaseline(JSON.parse(bytes.toString('utf8')), { trainEnd, validationEnd }), trainingDatasetHash: bytesHash(bytes) };
  const artifact = Buffer.from(JSON.stringify(model));
  await writeFile(output, artifact, { flag: 'wx' });
  console.log(JSON.stringify({ artifactDigest: bytesHash(artifact), algorithm: model.algorithm, counts: model.counts, metrics: model.metrics }));
}
