import { boundedCall, fail, uuid, modelId, validateVector, positive } from './indexing.mjs';

export function createQdrantAdapter({ baseUrl, collection, dimensions, apiKey, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(collection) || !positive(dimensions) || dimensions > 4096 ||
      (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)))) fail('AI_QDRANT_CONFIGURATION', 500);
  const request = (method, path, body, signal) => boundedCall(async timeoutSignal => {
    const response = await fetchImpl(new URL(`collections/${collection}/${path}`, base), {
      method, headers: { 'content-type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) },
      body: JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    if (!response.ok || !response.body) fail('AI_QDRANT_UNAVAILABLE', 503);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) { await response.body.cancel?.().catch(() => {}); fail('AI_QDRANT_RESPONSE_LIMIT', 502); }
      chunks.push(Buffer.from(chunk));
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail('AI_QDRANT_RESPONSE_INVALID', 502); }
    if (value.status !== 'ok') fail('AI_QDRANT_UNAVAILABLE', 503);
    return value.result;
  });
  return Object.freeze({
    async deletePoints(points, { signal } = {}) {
      if (!Array.isArray(points) || !points.length || points.length > 100 || !points.every(uuid) || new Set(points).size !== points.length) fail('AI_QDRANT_POINTS_INVALID');
      const result = await request('POST', 'points/delete?wait=true&ordering=strong', { points }, signal);
      if (result?.status !== 'completed') fail('AI_QDRANT_WRITE_UNCONFIRMED', 503);
    },
    async upsert(points, { signal } = {}) {
      if (!Array.isArray(points) || !points.length || points.length > 100) fail('AI_QDRANT_POINTS_INVALID');
      for (const point of points) {
        if (!uuid(point.id) || !point.payload || Object.keys(point.payload).some(k => ![
          'tenantId', 'plantId', 'resourceId', 'sourceRevision', 'aclRevision', 'sourceHash', 'model', 'generation', 'chunkIndex',
        ].includes(k)) || !['tenantId', 'plantId', 'resourceId', 'generation'].every(k => uuid(point.payload[k])) ||
          !modelId(point.payload.model) || !positive(point.payload.sourceRevision) || !positive(point.payload.aclRevision) ||
          !/^[a-f0-9]{64}$/.test(point.payload.sourceHash) || !Number.isSafeInteger(point.payload.chunkIndex) ||
          point.payload.chunkIndex < 0 || point.payload.chunkIndex >= 100) fail('AI_QDRANT_POINTS_INVALID');
        validateVector(point.vector, dimensions);
      }
      const result = await request('PUT', 'points?wait=true&ordering=strong', { points }, signal);
      if (result?.status !== 'completed') fail('AI_QDRANT_WRITE_UNCONFIRMED', 503);
    },
    async search(vector, { tenantId, plantId, model, limit, signal }) {
      validateVector(vector, dimensions);
      if (!uuid(tenantId) || !uuid(plantId) || !modelId(model) || !positive(limit) || limit > 40) fail('AI_QDRANT_QUERY_INVALID');
      const result = await request('POST', 'points/query', { query: vector,
        filter: { must: Object.entries({ tenantId, plantId, model }).map(([key, value]) => ({ key, match: { value } })) },
        limit, with_payload: true, with_vector: false }, signal);
      if (!Array.isArray(result?.points) || result.points.length > limit) fail('AI_QDRANT_RESPONSE_INVALID', 502);
      return result.points;
    },
  });
}
