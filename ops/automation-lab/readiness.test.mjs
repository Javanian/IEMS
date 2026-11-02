import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./lab-runtime.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function startEngine('), end = source.indexOf('async function stopAll()');
assert.ok(start >= 0 && end > start, 'readiness fixture must extract the actual engine function');
const engine = source.slice(start, end);
function fixture(webhook) {
  let now = 0, healthy = false;
  const calls = [];
  const start = runInNewContext(engine + '\nstartEngine', {
    json: () => ({ version: '1.121.3' }), join: (...parts) => parts.join('/'), root: '/owned',
    launch: () => {}, n8nBin: '/owned/n8n', n8nEnv: {}, n8nBase: 'http://127.0.0.1:32743',
    ready: async () => {}, Date: { now: () => now }, AbortSignal,
    wait: async ms => { now += ms; }, status: value => { healthy = value.n8nRunning; },
    fetch: async url => {
      if (url.endsWith('/rest/settings')) return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ data: { userManagement: {} } }) };
      calls.push(url); return webhook(calls.length);
    },
  });
  return { start, calls, elapsed: () => now, healthy: () => healthy };
}
test('native readiness tolerates transient connection failure but still requires all four authenticated webhook denials', async () => {
  const f = fixture(n => { if (n === 1) throw new Error('ECONNRESET'); return { status: 403 }; });
  await f.start();
  assert.equal(f.calls.length, 5);
  assert.equal(new Set(f.calls).size, 4);
  assert.equal(f.elapsed(), 1000);
  assert.equal(f.healthy(), true);
});
for (const [name, response] of [['unregistered', () => ({ status: 404 })], ['unprotected', () => ({ status: 200 })], ['unreachable', () => { throw new Error('ECONNRESET'); }]]) {
  test(`${name} native webhook fails within the original60s bound`, async () => {
    const f = fixture(response);
    await assert.rejects(f.start(), /Webhook .* not ready/);
    assert.equal(f.elapsed(), 60000);
    assert.equal(f.calls.length, 60);
    assert.equal(f.healthy(), false);
  });
}
