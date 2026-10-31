import { boundedCall, fail } from './indexing.mjs';

const origin = value => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('AI_MLFLOW_CONFIGURATION', 500);
  return url;
};
// Serving URLs are operator-pinned per immutable model, never obtained from registry source URLs.
export function createMlflowPort({ registryUrl, bindings, registryToken, fetchImpl = fetch }) {
  const registry = origin(registryUrl);
  const validToken = token => token === undefined || typeof token === 'string' && !!token && !/[\r\n]/.test(token);
  if (!Array.isArray(bindings) || !bindings.length || bindings.length > 50 || !validToken(registryToken) ||
      bindings.some(b => !validToken(b.servingToken))) fail('AI_MLFLOW_CONFIGURATION', 500);
  const configured = bindings.map(b => ({ ...b, serving: origin(b.servingUrl) }));
  if (configured.some(b => typeof b.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(b.name) ||
      !Number.isSafeInteger(b.version) || b.version < 1 || !/^[a-f0-9]{64}$/.test(b.artifactDigest) || !Array.isArray(b.featureKeys) || !b.featureKeys.length) ||
      new Set(configured.map(b => `${b.name}:${b.version}`)).size !== configured.length) fail('AI_MLFLOW_CONFIGURATION', 500);
  const binding = (name, version) => {
    const value = configured.find(b => b.name === name && b.version === version);
    if (!value) fail('AI_MODEL_VERSION_UNAVAILABLE', 503);
    return value;
  };
  const request = (url, body, signal, token) => boundedCall(async timeout => {
    let response;
    try { response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { fail('AI_PROVIDER_UNAVAILABLE', 503); }
    if (!response.ok || !response.body) fail('AI_PROVIDER_UNAVAILABLE', 503);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) fail('AI_MODEL_OUTPUT_INVALID', 502); chunks.push(Buffer.from(chunk)); }
    try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers }; }
    catch { fail('AI_MODEL_OUTPUT_INVALID', 502); }
  }, 5000);
  return Object.freeze({
    async getVersion({ name, version, signal }) {
      const b = binding(name, version), url = new URL('api/2.0/mlflow/model-versions/get', registry);
      url.searchParams.set('name', name); url.searchParams.set('version', String(version));
      const { value } = await request(url, null, signal, registryToken), m = value.model_version;
      const tags = Object.fromEntries((m?.tags ?? []).map(t => [t.key, t.value]));
      if (m?.name !== name || String(m.version) !== String(version) || m.status !== 'READY' ||
          tags['iems.artifact.sha256'] !== b.artifactDigest || tags['iems.feature.keys'] !== JSON.stringify(b.featureKeys) ||
          !/^[a-f0-9]{64}$/.test(tags['iems.source.manifest.sha256']) || typeof m.run_id !== 'string' || !m.run_id) fail('AI_MODEL_VERSION_UNAVAILABLE', 503);
      return { name, version, status: 'READY', artifactDigest: b.artifactDigest, featureKeys: [...b.featureKeys],
        runId: m.run_id, sourceManifestHash: tags['iems.source.manifest.sha256'] };
    },
    async predict({ name, version, artifactDigest, featureRows, signal }) {
      const b = binding(name, version);
      if (b.artifactDigest !== artifactDigest) fail('AI_MODEL_VERSION_UNAVAILABLE', 503);
      const { value, headers } = await request(new URL('invocations', b.serving),
        { dataframe_split: { columns: b.featureKeys, data: featureRows.map(row => b.featureKeys.map(k => row[k])) } }, signal, b.servingToken);
      // Plain /invocations lacks model identity. Require the operator's pinned serving gateway to attest it.
      if (headers.get('x-iems-model-name') !== name || headers.get('x-iems-model-version') !== String(version) ||
          headers.get('x-iems-artifact-sha256') !== artifactDigest) fail('AI_MODEL_OUTPUT_INVALID', 502);
      return { name, version, artifactDigest, values: value.predictions };
    },
  });
}
