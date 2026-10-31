import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createQdrantAdapter } from './qdrant.mjs';

const config = { baseUrl: 'http://127.0.0.1:6333', collection: 'iems_test', dimensions: 2 };
test('point cleanup uses explicit IDs on the configured collection and requires completed acknowledgement', async () => {
  const ids = [randomUUID()]; let completed = false;
  const adapter = createQdrantAdapter({ ...config, async fetchImpl(url, options) {
    assert.equal(url.href, 'http://127.0.0.1:6333/collections/iems_test/points/delete?wait=true&ordering=strong');
    assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { points: ids });
    return Response.json({ status: 'ok', result: { status: completed ? 'completed' : 'acknowledged' } });
  } });
  await assert.rejects(adapter.deletePoints(ids), { code: 'AI_QDRANT_WRITE_UNCONFIRMED' });
  completed = true; await adapter.deletePoints(ids);
  await assert.rejects(adapter.deletePoints(['not-a-uuid']), { code: 'AI_QDRANT_POINTS_INVALID' });
});
test('Qdrant query pins tenant, plant, model and endpoint, and refuses redirects', async () => {
  const tenantId = randomUUID(), plantId = randomUUID();
  const adapter = createQdrantAdapter({ ...config, apiKey: 'fixture-only', fetchImpl: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:6333/collections/iems_test/points/query');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.filter.must, Object.entries({ tenantId, plantId, model: 'fixture-v1' }).map(([key, value]) => ({ key, match: { value } })));
    assert.equal(body.with_vector, false); assert.equal(body.limit, 5);
    return new Response(JSON.stringify({ status: 'ok', result: { points: [] } }));
  } });
  assert.deepEqual(await adapter.search([1, 0], { tenantId, plantId, model: 'fixture-v1', limit: 5 }), []);
});
test('Qdrant configuration refuses remote plaintext, path overrides and embedded credentials', () => {
  for (const baseUrl of ['http://example.com', 'https://user:password@example.com', 'https://example.com/other', 'https://example.com/?x=1']) {
    assert.throws(() => createQdrantAdapter({ ...config, baseUrl }), { code: 'AI_QDRANT_CONFIGURATION' });
  }
});
test('upsert waits for completed receipt and rejects text-bearing payload', async () => {
  let calls = 0;
  const adapter = createQdrantAdapter({ ...config, fetchImpl: async (url, options) => {
    calls++; assert.equal(url.search, '?wait=true&ordering=strong'); assert.equal(options.method, 'PUT');
    return new Response(JSON.stringify({ status: 'ok', result: { status: 'acknowledged' } }));
  } });
  const point = { id: randomUUID(), vector: [1, 0], payload: { tenantId: randomUUID(), plantId: randomUUID(), resourceId: randomUUID(),
    generation: randomUUID(), model: 'fixture-v1', sourceRevision: 1, aclRevision: 1, sourceHash: 'a'.repeat(64), chunkIndex: 0 } };
  await assert.rejects(adapter.upsert([point]), { code: 'AI_QDRANT_WRITE_UNCONFIRMED' });
  await assert.rejects(adapter.upsert([{ ...point, payload: { ...point.payload, text: 'private text' } }]), { code: 'AI_QDRANT_POINTS_INVALID' });
  assert.equal(calls, 1);
});
test('Qdrant rejects malformed, oversized and failed responses without retry', async () => {
  for (const body of ['not json', 'x'.repeat(1024 * 1024 + 1), JSON.stringify({ status: 'error' })]) {
    let calls = 0;
    const adapter = createQdrantAdapter({ ...config, fetchImpl: async () => { calls++; return new Response(body); } });
    await assert.rejects(adapter.search([1, 0], { tenantId: randomUUID(), plantId: randomUUID(), model: 'fixture-v1', limit: 5 }));
    assert.equal(calls, 1);
  }
});
