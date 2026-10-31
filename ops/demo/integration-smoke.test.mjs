import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('integrated host initializes and mounts authenticated specialist APIs', async t => {
  const h = await startOwned(t);
  const paths = ['/platform/jobs', '/operations/dashboard', '/analytics/authority', '/workforce/capabilities',
    '/operations/voice/zones', '/ai/documents', '/ai/models', '/saas/status'];
  for (const path of paths) assert.equal((await h.req(path)).status, 401, path);
  for (const path of paths.slice(0, 3)) assert.equal((await h.req(path, undefined, h.alpha)).status, 200, path);
  const restore = await h.setRoles(h.seeded[0], ['workforceSelf', 'voiceOperator', 'aiDocumentAdmin', 'aiModelReader', 'saasReader']);
  try {
    for (const path of paths.slice(3, 7)) {
      const result = await h.req(path, undefined, h.alpha);
      assert.equal(result.status, 200, `${path}: ${JSON.stringify(result)}`);
    }
    const lifecycle = await h.req('/saas/status', undefined, h.alpha);
    assert.equal(lifecycle.status, 403, 'plant grant cannot administer a whole tenant');
    assert.equal((await h.req('/platform/jobs', undefined, h.alpha)).status, 403, 'removed role is reauthorized');
  } finally { await restore(); }
  const indexes = await h.db.collection('reportingSnapshotOutbox').indexes();
  assert.ok(indexes.length > 1, 'reporting indexes initialized before producers');
  assert.equal(h.runtime.rag.index, null, 'no embedding provider is fabricated');
  assert.equal((await h.req('/workforce/capabilities', undefined, h.beta)).status, 403);
});
