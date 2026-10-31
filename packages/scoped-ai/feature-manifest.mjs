import { createHash } from 'node:crypto';
import { fail, uuid } from './indexing.mjs';

export const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
export function parseFeatureManifest(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedHash) || bytesHash(bytes) !== expectedHash) fail('AI_FEATURE_MANIFEST_INVALID', 409);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail('AI_FEATURE_MANIFEST_INVALID', 409); }
  if (manifest.schema !== 'AI_FEATURE_HISTORY_V1' || !uuid(manifest.manifestId) ||
      !['tenantId', 'plantId', 'legalEntityId'].every(k => uuid(manifest[k])) || manifest.coverage !== 'COMPLETE' ||
      !stamp(manifest.observedAt) || typeof manifest.featureSetId !== 'string' || !manifest.featureSetId ||
      !Array.isArray(manifest.featureKeys) || !manifest.featureKeys.length || manifest.featureKeys.length > 64 ||
      manifest.featureKeys.some(k => typeof k !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(k)) ||
      new Set(manifest.featureKeys).size !== manifest.featureKeys.length || !Array.isArray(manifest.rows) || manifest.rows.length > 10000) fail('AI_FEATURE_MANIFEST_INVALID', 409);
  const seen = new Set();
  for (const row of manifest.rows) {
    if (!row || typeof row.entityId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.entityId) ||
        !Number.isSafeInteger(row.sourceVersion) || row.sourceVersion < 1 || typeof row.sourceId !== 'string' || !row.sourceId ||
        !stamp(row.occurredAt) || !stamp(row.availableAt) || row.availableAt > manifest.observedAt ||
        !row.features || Object.keys(row.features).length !== manifest.featureKeys.length ||
        manifest.featureKeys.some(k => !Object.hasOwn(row.features, k) || !(row.features[k] === null || typeof row.features[k] === 'boolean' ||
          typeof row.features[k] === 'number' && Number.isFinite(row.features[k]))) || seen.has(`${row.entityId}:${row.sourceVersion}`)) fail('AI_FEATURE_MANIFEST_INVALID', 409);
    seen.add(`${row.entityId}:${row.sourceVersion}`);
  }
  return structuredClone(manifest);
}

export function createManifestFeatureSource({ bytes, expectedHash }) {
  const manifest = parseFeatureManifest(bytes, expectedHash);
  return Object.freeze({ async readPointInTime({ grant, businessAsOf, knowledgeAsOf, featureSetId, featureKeys, limit }) {
    if (['tenantId', 'plantId', 'legalEntityId'].some(k => grant?.[k] !== manifest[k])) fail('SCOPE_DENIED', 403);
    if (!stamp(businessAsOf) || !stamp(knowledgeAsOf) || manifest.featureSetId !== featureSetId ||
        JSON.stringify(featureKeys) !== JSON.stringify(manifest.featureKeys) || !Number.isSafeInteger(limit) || limit < 1) fail('AI_INVALID_PIT_REQUEST');
    const selected = new Map();
    for (const row of manifest.rows) if (row.occurredAt <= businessAsOf && row.availableAt <= knowledgeAsOf &&
        (selected.get(row.entityId)?.sourceVersion ?? 0) < row.sourceVersion) selected.set(row.entityId, row);
    const rows = [...selected.values()].sort((a, b) => a.entityId.localeCompare(b.entityId)).slice(0, limit).map(row => ({
      entityId: row.entityId, features: structuredClone(row.features), provenance: featureKeys.map(featureKey => ({ featureKey,
        sourceId: row.sourceId, sourceVersion: row.sourceVersion, occurredAt: row.occurredAt, availableAt: row.availableAt })),
    }));
    return { schema: 'ANALYTICS_PIT_V1', businessAsOf, knowledgeAsOf, coverage: selected.size > limit ? 'INCOMPLETE' : 'COMPLETE',
      sourceManifestId: manifest.manifestId, sourceManifestHash: expectedHash, rows };
  } });
}
