import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { installRag } from '../../apps/portfolio-api/src/rag.mjs';

function fixture() {
  const routes = new Map(), calls = [];
  const tenantId = randomUUID(), plantId = randomUUID(), resourceId = randomUUID();
  const req = { scope: { tenantId, selectedPlantId: plantId }, query: {}, headers: {},
    params: { id: resourceId }, body: { key: 'revoke-index', expectedRevision: 4 } };
  const res = { set(key, value) { assert.equal(key, 'Cache-Control'); assert.equal(value, 'no-store'); return this; },
    json(value) { this.body = value; return this; } };
  const index = Object.fromEntries(['status', 'revoke'].map(method => [method, async (...args) => {
    calls.push({ method, args }); return { revision: 5 };
  }]));
  const rag = { index };
  installRag(Object.fromEntries(['get', 'post', 'put'].map(method => [method, (path, handler) => routes.set(`${method} ${path}`, handler)])), rag);
  return { req, res, rag, calls, routes, plantId, resourceId };
}

test('index status and revoke pass only selected scope and explicit command fields', async () => {
  const f = fixture();
  await f.routes.get('get /api/ai/documents/:id/index')(f.req, f.res);
  assert.deepEqual(f.calls[0], { method: 'status', args: [f.req.scope, { plantId: f.plantId, resourceId: f.resourceId }] });
  await f.routes.get('post /api/ai/documents/:id/index/revoke')(f.req, f.res);
  assert.deepEqual(f.res.body, { data: { revision: 5 } });
  assert.equal(f.calls[1].args[1].expectedRevision, 4);
});

test('index routes reject scope substitution and invalid resource before calling index', async () => {
  const f = fixture();
  const handler = f.routes.get('get /api/ai/documents/:id/index');
  f.req.query.plantId = randomUUID();
  await assert.rejects(handler(f.req, f.res), { status: 403 });
  f.req.query = {}; f.req.params.id = 'invalid';
  await assert.rejects(handler(f.req, f.res), { code: 'AI_INVALID_RESOURCE' });
  assert.equal(f.calls.length, 0);
});

test('index revoke rejects unknown fields and missing provider stays unavailable', async () => {
  const f = fixture();
  f.req.body.force = true;
  await assert.rejects(f.routes.get('post /api/ai/documents/:id/index/revoke')(f.req, f.res), { code: 'AI_UNKNOWN_FIELD' });
  f.rag.index = null;
  await assert.rejects(f.routes.get('get /api/ai/documents/:id/index')(f.req, f.res), { code: 'AI_PROVIDER_UNAVAILABLE', status: 503 });
  assert.equal(f.calls.length, 0);
});
