import { bytesHash } from './feature-manifest.mjs';
import { fail } from './indexing.mjs';

export function createLocalBaselinePort({ bytes, artifactDigest, name, version, runId }) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024 || bytesHash(bytes) !== artifactDigest ||
      !/^[a-f0-9]{64}$/.test(artifactDigest) || !Number.isSafeInteger(version) || version < 1 || typeof runId !== 'string' || !runId) fail('AI_MODEL_ARTIFACT_INVALID', 409);
  let artifact;
  try { artifact = JSON.parse(bytes.toString('utf8')); } catch { fail('AI_MODEL_ARTIFACT_INVALID', 409); }
  if (artifact.schema !== 'AI_MEAN_BASELINE_V1' || artifact.algorithm !== 'TRAIN_ONLY_MEAN' || typeof artifact.mean !== 'number' ||
      !Number.isFinite(artifact.mean) || !Array.isArray(artifact.featureKeys) || !artifact.featureKeys.length ||
      !/^[a-f0-9]{64}$/.test(artifact.sourceManifestHash)) fail('AI_MODEL_ARTIFACT_INVALID', 409);
  const check = request => { if (request.name !== name || request.version !== version) fail('AI_MODEL_VERSION_UNAVAILABLE', 503); };
  return Object.freeze({
    async getVersion(request) { check(request); return { name, version, artifactDigest, featureKeys: [...artifact.featureKeys],
      status: 'READY', runId, sourceManifestHash: artifact.sourceManifestHash }; },
    async predict(request) {
      check(request); if (request.artifactDigest !== artifactDigest) fail('AI_MODEL_VERSION_UNAVAILABLE', 503);
      return { name, version, artifactDigest, values: request.featureRows.map(() => artifact.mean) };
    },
  });
}
