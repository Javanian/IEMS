import { boundedCall, fail, scopeTarget, uuid } from './indexing.mjs';

const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const ownObject = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const finiteFeature = value => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);

export function createPointInTimeFeatureReader({ foundation, source, featureKeys, clock = () => new Date(), timeoutMs = 5000, maxRows = 1000 }) {
  if (!foundation?.authorize || !source?.readPointInTime || !Array.isArray(featureKeys) || !featureKeys.length || featureKeys.length > 64 ||
      featureKeys.some(key => typeof key !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key)) || new Set(featureKeys).size !== featureKeys.length ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 5000) {
    fail('AI_ADAPTER_CONFIGURATION', 500);
  }
  const authorize = (scope, plantId) => foundation.authorize(scope, scopeTarget(scope, plantId, 'analytics.read'));
  return Object.freeze({
    async read(scope, input) {
      if (!ownObject(input) || Object.keys(input).some(key => !['plantId', 'businessAsOf', 'knowledgeAsOf', 'featureSetId'].includes(key)) ||
          !uuid(input.plantId) || !timestamp(input.businessAsOf) || !timestamp(input.knowledgeAsOf) ||
          typeof input.featureSetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(input.featureSetId) ||
          Date.parse(input.businessAsOf) > clock().getTime() || Date.parse(input.knowledgeAsOf) > clock().getTime()) fail('AI_INVALID_PIT_REQUEST');
      const grant = await authorize(scope, input.plantId);
      let result;
      try {
        result = await boundedCall(signal => source.readPointInTime({ scope, grant, plantId: input.plantId,
          businessAsOf: input.businessAsOf, knowledgeAsOf: input.knowledgeAsOf,
          featureSetId: input.featureSetId, featureKeys: [...featureKeys], limit: maxRows, signal }), timeoutMs);
      } catch (error) {
        if (!['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'ANALYTICS_SOURCE_UNAVAILABLE'].includes(error.code)) throw error;
        await authorize(scope, input.plantId);
        return { schema: 'SCOPED_PIT_FEATURES_V1', state: 'ABSTAIN', reason: 'SOURCE_UNAVAILABLE', rows: [],
          businessAsOf: input.businessAsOf, knowledgeAsOf: input.knowledgeAsOf, historyStored: false };
      }
      await authorize(scope, input.plantId);
      if (!result || result.schema !== 'ANALYTICS_PIT_V1' || result.businessAsOf !== input.businessAsOf ||
          result.knowledgeAsOf !== input.knowledgeAsOf || !Array.isArray(result.rows) || result.rows.length > maxRows ||
          !['COMPLETE', 'INCOMPLETE'].includes(result.coverage) || typeof result.sourceManifestId !== 'string' || !result.sourceManifestId ||
          typeof result.sourceManifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourceManifestHash)) fail('AI_SOURCE_INVALID', 502);
      if (result.coverage !== 'COMPLETE') return { schema: 'SCOPED_PIT_FEATURES_V1', state: 'ABSTAIN', reason: 'INCOMPLETE_COVERAGE', rows: [],
        businessAsOf: input.businessAsOf, knowledgeAsOf: input.knowledgeAsOf, historyStored: false };
      const seen = new Set();
      const rows = result.rows.map(row => {
        if (!ownObject(row) || Object.keys(row).some(key => !['entityId', 'features', 'provenance'].includes(key)) ||
            typeof row.entityId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.entityId) || seen.has(row.entityId) ||
            !ownObject(row.features) || Object.keys(row.features).length !== featureKeys.length ||
            featureKeys.some(key => !Object.hasOwn(row.features, key) || !finiteFeature(row.features[key])) ||
            !Array.isArray(row.provenance) || row.provenance.length !== featureKeys.length) fail('AI_SOURCE_INVALID', 502);
        seen.add(row.entityId);
        const provenanceKeys = new Set();
        for (const item of row.provenance) {
          if (!ownObject(item) || Object.keys(item).some(key => !['featureKey', 'sourceId', 'sourceVersion', 'occurredAt', 'availableAt'].includes(key)) ||
              !featureKeys.includes(item.featureKey) || provenanceKeys.has(item.featureKey) || typeof item.sourceId !== 'string' || !item.sourceId ||
              !Number.isSafeInteger(item.sourceVersion) || item.sourceVersion < 1 || !timestamp(item.occurredAt) || !timestamp(item.availableAt) ||
              Date.parse(item.occurredAt) > Date.parse(input.businessAsOf) || Date.parse(item.availableAt) > Date.parse(input.knowledgeAsOf)) fail('AI_TEMPORAL_LEAKAGE', 409);
          provenanceKeys.add(item.featureKey);
        }
        return { entityId: row.entityId, features: Object.fromEntries(featureKeys.map(key => [key, row.features[key]])),
          provenance: [...row.provenance].sort((a, b) => a.featureKey.localeCompare(b.featureKey)) };
      }).sort((a, b) => a.entityId.localeCompare(b.entityId));
      return { schema: 'SCOPED_PIT_FEATURES_V1', state: rows.length ? 'READY' : 'ABSTAIN',
        reason: rows.length ? null : 'NO_OBSERVATIONS', businessAsOf: input.businessAsOf,
        knowledgeAsOf: input.knowledgeAsOf, featureSetId: input.featureSetId, featureKeys: [...featureKeys], rows,
        sourceManifestId: result.sourceManifestId, sourceManifestHash: result.sourceManifestHash, coverage: result.coverage, historyStored: false };
    },
  });
}

export function createPinnedModelScorer({ modelPort, timeoutMs = 5000 }) {
  if (!modelPort?.getVersion || !modelPort?.predict || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) fail('AI_ADAPTER_CONFIGURATION', 500);
  return Object.freeze({
    async predict(modelRef, featureRows) {
      if (!ownObject(modelRef) || Object.keys(modelRef).some(key => !['name', 'version', 'artifactDigest', 'featureKeys'].includes(key)) ||
          typeof modelRef.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(modelRef.name) ||
          !Number.isSafeInteger(modelRef.version) || modelRef.version < 1 || typeof modelRef.artifactDigest !== 'string' ||
          !/^[a-f0-9]{64}$/.test(modelRef.artifactDigest) || !Array.isArray(modelRef.featureKeys) || !modelRef.featureKeys.length ||
          modelRef.featureKeys.some(key => typeof key !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key)) ||
          new Set(modelRef.featureKeys).size !== modelRef.featureKeys.length || !Array.isArray(featureRows) ||
          featureRows.length < 1 || featureRows.length > 1000 || featureRows.some(row => !ownObject(row) ||
            typeof row.entityId !== 'string' || !ownObject(row.features) || Object.keys(row.features).length !== modelRef.featureKeys.length ||
            modelRef.featureKeys.some(key => !Object.hasOwn(row.features, key) || !finiteFeature(row.features[key])))) fail('AI_INVALID_MODEL_REQUEST');
      const metadata = await boundedCall(signal => modelPort.getVersion({ name: modelRef.name, version: modelRef.version, signal }), timeoutMs);
      if (!metadata || metadata.name !== modelRef.name || metadata.version !== modelRef.version || metadata.status !== 'READY' ||
          metadata.artifactDigest !== modelRef.artifactDigest || !Array.isArray(metadata.featureKeys) ||
          metadata.featureKeys.length !== modelRef.featureKeys.length || metadata.featureKeys.some((key, i) => key !== modelRef.featureKeys[i])) fail('AI_MODEL_VERSION_UNAVAILABLE', 503);
      const predictions = await boundedCall(signal => modelPort.predict({ name: modelRef.name, version: modelRef.version,
        artifactDigest: modelRef.artifactDigest, featureRows: featureRows.map(row => row.features), signal }), timeoutMs);
      if (!predictions || predictions.name !== modelRef.name || predictions.version !== modelRef.version ||
          predictions.artifactDigest !== modelRef.artifactDigest || !Array.isArray(predictions.values) ||
          predictions.values.length !== featureRows.length || predictions.values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        fail('AI_MODEL_OUTPUT_INVALID', 502);
      }
      return { schema: 'SCOPED_MODEL_PREDICTIONS_V1', state: 'PREDICTED', model: { name: modelRef.name,
        version: modelRef.version, artifactDigest: modelRef.artifactDigest }, predictions: featureRows.map((row, i) => ({ entityId: row.entityId, value: predictions.values[i] })) };
    },
  });
}
