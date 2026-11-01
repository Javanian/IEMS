import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned, orderWithStock } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

test('composed Operations ordinary empty and populated loads', async t => {
  const h = await startOwned(t);
  const original = h.runtime.foundation.authorizeInTransaction;
  h.runtime.foundation = { ...h.runtime.foundation, authorizeInTransaction: async (...args) => {
    try { return await original(...args); }
    catch (e) {
      if (e.status !== 403) console.log(JSON.stringify({ action: args[1].action, serverException: { name: e.name, code: e.code, message: e.message, labels: [...(e.errorLabelSet || [])], stack: e.stack?.split('\n').slice(0, 12) } }));
      throw e;
    }
  } };
  const marker = await h.db.collection('ownedRun').findOne();
  console.log(JSON.stringify({ database: h.db.databaseName, hosts: h.client.options.hosts.map(String), marker: marker._id }));
  for (const populated of [false, true]) {
    if (populated) await orderWithStock(h);
    const statuses = [];
    for (let round = 0; round < 15; round++) {
      const result = await h.req('/operations/dashboard', undefined, h.alpha);
      statuses.push(result.status);
      assert.equal(result.status, 200);
      assert.equal(result.data.metrics.orders.status, populated ? 'AVAILABLE' : 'NO_DATA');
      assert.equal(result.data.metrics.orders.total, populated ? 1 : 0);
    }
    console.log(JSON.stringify({ populated, sequential: statuses }));
    for (const overlap of [2, 4]) {
      for (let round = 0; round < 3; round++) {
        const concurrent = await Promise.all(Array.from({ length: overlap }, () => h.req('/operations/dashboard', undefined, h.alpha)));
        console.log(JSON.stringify({ populated, overlap, round, concurrent: concurrent.map(r => r.status) }));
        assert.deepEqual(concurrent.map(r => r.status), Array(overlap).fill(200));
        for (const result of concurrent) {
          assert.equal(result.data.metrics.orders.status, populated ? 'AVAILABLE' : 'NO_DATA');
          assert.equal(result.data.metrics.orders.total, populated ? 1 : 0);
        }
      }
    }
  }
  assert.equal((await h.req('/operations/dashboard')).status, 401);
  assert.equal((await h.req('/operations/drilldown/invalid', undefined, h.alpha)).status, 404);
  const restore = await h.setRoles(h.seeded[0], ['warehouseRead']);
  try { assert.equal((await h.req('/operations/dashboard', undefined, h.alpha)).status, 403); }
  finally { await restore(); }
  console.log('NEGATIVES: unauthenticated401, unknown-source404, revoked-role403');
});
