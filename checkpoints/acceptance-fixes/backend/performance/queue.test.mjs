import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CustomerServiceError } from '../../../../packages/customer-service/index.mjs';
const source = readFileSync(new URL('../../../../packages/customer-service/index.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  const operatorQueues = new Map();');
const end = source.indexOf('  async function tx(fn)', start);
assert.ok(start > 0 && end > start);
const helper = source.slice(start, end);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const timers = [];
  let clock = 100;
  const set = (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; };
  const clear = timer => { timer.cleared = true; };
  const api = new Function('fail', 'CustomerServiceError', 'setTimeout', 'clearTimeout', 'performance', helper + '\nreturn { enqueueOperator, snapshot: () => ({tenants: operatorQueues.size, waiting: waitingOperators}) };')(
    code => { throw new CustomerServiceError(code); }, CustomerServiceError, set, clear, { now: () => clock });
  return { ...api, timers, advance: ms => { clock += ms; } };
}
test('FIFO same tenant and independent tenant progress', async () => {
  const f = fixture(), gate = deferred(), order = [];
  const first = f.enqueueOperator('a', async () => { order.push('first'); await gate.promise; return 1; });
  const second = f.enqueueOperator('a', async () => { order.push('second'); return 2; });
  assert.equal(await f.enqueueOperator('b', async () => { order.push('other'); return 3; }), 3);
  assert.deepEqual(order, ['first', 'other']); gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]); assert.deepEqual(order, ['first', 'other', 'second']);
  assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
test('unknown outcome rejects once and releases next slot without rerunning effect', async () => {
  const f = fixture(), gate = deferred(), unknown = Object.assign(new Error('unknown'), { code: 'COMMIT_OUTCOME_UNKNOWN' }); let calls = 0;
  const first = f.enqueueOperator('a', async () => { calls++; await gate.promise; throw unknown; });
  const rejected = assert.rejects(first, error => error === unknown);
  const second = f.enqueueOperator('a', async () => 2); gate.resolve();
  await rejected; assert.equal(await second, 2); assert.equal(calls, 1); assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
test('pending deadline removes job and never executes it', async () => {
  const f = fixture(), gate = deferred(); let called = false;
  const first = f.enqueueOperator('a', () => gate.promise);
  const waiting = f.enqueueOperator('a', async () => { called = true; });
  const rejected = assert.rejects(waiting, { code: 'STATUS_UNAVAILABLE', status: 503 });
  assert.equal(f.timers[1].ms, 30000); f.timers[1].fn(); await rejected; gate.resolve(); await first;
  assert.equal(called, false); assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
test('dequeue rejects an expired entry before its delayed timer callback and cleans counters once', async () => {
  const f = fixture(), gate = deferred(); let effects = 0;
  const active = f.enqueueOperator('a', () => gate.promise);
  const expired = f.enqueueOperator('a', async () => { effects++; });
  const rejected = assert.rejects(expired, { code: 'STATUS_UNAVAILABLE', status: 503 });
  f.advance(30000);
  gate.resolve(); await active; await rejected;
  assert.equal(effects, 0); assert.equal(f.timers[1].cleared, true);
  assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
  f.timers[1].fn();
  assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
  assert.equal(await f.enqueueOperator('a', async () => ++effects), 1);
  assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
test('expired entries do not block a still-live follower or cancel active work', async () => {
  const f = fixture(), gate = deferred(); const order = [];
  const active = f.enqueueOperator('a', async () => { await gate.promise; order.push('active'); });
  const expired = f.enqueueOperator('a', async () => order.push('expired'));
  const rejected = assert.rejects(expired, { code: 'STATUS_UNAVAILABLE' });
  f.advance(1);
  const live = f.enqueueOperator('a', async () => order.push('live'));
  f.advance(29999); f.timers[0].fn();
  assert.deepEqual(f.snapshot(), { tenants: 1, waiting: 2 });
  gate.resolve(); await Promise.all([active, rejected, live]);
  assert.deepEqual(order, ['active', 'live']);
  assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
test('at most64 pending per tenant and no abandoned state', async () => {
  const f = fixture(), gate = deferred(), all = [f.enqueueOperator('a', () => gate.promise)];
  for (let i = 0; i < 64; i++) all.push(f.enqueueOperator('a', async () => i));
  assert.throws(() => f.enqueueOperator('a', async () => -1), { code: 'STATUS_UNAVAILABLE', status: 503 });
  assert.equal(f.snapshot().waiting, 64); gate.resolve(); await Promise.all(all); assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
test('256 tenant states and1024 waiting jobs are bounded independently', async () => {
  const f = fixture(), gate = deferred(), all = [];
  for (let i = 0; i < 256; i++) all.push(f.enqueueOperator(String(i), () => gate.promise));
  assert.throws(() => f.enqueueOperator('overflow', async () => 0), { code: 'STATUS_UNAVAILABLE' });
  for (let i = 0; i < 1024; i++) all.push(f.enqueueOperator(String(i % 256), async () => i));
  assert.throws(() => f.enqueueOperator('0', async () => 0), { code: 'STATUS_UNAVAILABLE' });
  gate.resolve(); await Promise.all(all); assert.deepEqual(f.snapshot(), { tenants: 0, waiting: 0 });
});
