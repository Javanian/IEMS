import assert from 'node:assert/strict';
import test from 'node:test';
import { installCustomerService } from '../src/customer-service.mjs';
import { customerServiceDisposition, SIMULATED_CHANNEL_ACCOUNT } from '../../../packages/customer-service/index.mjs';

function harness({ ids = [], queued = [], managed = false, state = 'PREVIEWED', denied = false, onInbound } = {}) {
  const routes = new Map(), claims = [], results = [], effects = [], queries = [];
  const runtime = {
    foundation: { authorize: async () => { if (denied) throw Object.assign(Error('denied'), { code: 'DENIED' }); } },
    customerService: {
      simulateInbound: async scope => { await onInbound?.(scope); return { result: { deliveryIds: ids }, [customerServiceDisposition]: { enrolled: false } }; },
      getOutboundMessages: async () => [],
    },
    customerServicePreview: {
      claimNextDelivery: async input => {
        assert.notEqual(input.deliveryIds, null, 'Unscoped package contract requires undefined');
        claims.push(structuredClone(input));
        const id = queued.find(id => input.deliveryIds === undefined || input.deliveryIds.includes(id));
        return id ? { deliveryId: id, fence: 'original-fence' } : null;
      },
      recordDeliveryResult: async input => { results.push(input); queued = queued.filter(id => id !== input.deliveryId); },
    },
    separateEffects: { supports: () => managed, run: async (command, id) => { effects.push([command, id]); if (state === 'PREVIEWED') queued = queued.filter(value => value !== id); return { state }; } },
    db: { collection: name => ({ find: filter => {
      queries.push({ name, filter: structuredClone(filter) });
      return { sort: () => ({ limit: () => ({ next: async () => {
        const id = queued.find(id => !filter._id || filter._id.$in.includes(id));
        return id ? { _id: id, controlCommandId: `command-${id}` } : null;
      } }) }) };
    } }) },
  };
  installCustomerService({ use() {}, get() {}, post: (path, fn) => routes.set(path, fn) }, runtime, {
    fail: (status, code) => { throw Object.assign(Error(code), { status, code }); }, id: x => x, fields() {},
  });
  const invoke = async (unscoped = false, tenantId = 'tenant') => {
    let value;
    await routes.get(`/api/cs/simulator/${unscoped ? 'dispatch' : 'inbound'}`)({ body: {}, filter: { plantId: 'plant' }, scope: { tenantId } }, { json: body => { value = body.data; } });
    return value.previewedDeliveryIds;
  };
  return { invoke, claims, results, effects, queries };
}

test('scoped preview drain completes unique and duplicate IDs without mutating caller or claiming unrelated work', async () => {
  for (const managed of [false, true]) {
    const ids = Object.freeze(['a', 'a', 'b']), h = harness({ ids, queued: ['a', 'b', 'foreign'], managed });
    assert.deepEqual(await h.invoke(), ['a', 'b']);
    assert.deepEqual(ids, ['a', 'a', 'b']);
    assert.equal(h.claims.length + h.effects.length, 2);
    assert.ok(h.results.every(row => row.fence === 'original-fence' && row.outcome === 'PREVIEWED'));
    assert.ok(h.claims.every(row => row.tenantId === 'tenant' && row.channelAccountId === SIMULATED_CHANNEL_ACCOUNT));
    assert.ok(h.queries.every(row => row.name === 'cs_outbox' && row.filter.tenantId === 'tenant' && row.filter.channelAccountId === SIMULATED_CHANNEL_ACCOUNT && row.filter.state === 'QUEUED'));
  }
});

test('inbound turns serialize one tenant, allow another tenant and release after failure', async () => {
  let release, count = 0;
  const blocked = new Promise(resolve => { release = resolve; }), started = [];
  const h = harness({ onInbound: async scope => {
    started.push(scope.tenantId);
    if (scope.tenantId === 'tenant' && count++ === 0) { await blocked; throw Object.assign(Error('denied'), { code: 'DENIED' }); }
  } });
  const first = assert.rejects(h.invoke(), { code: 'DENIED' });
  const second = h.invoke();
  await h.invoke(false, 'other-tenant');
  assert.deepEqual(started, ['tenant', 'other-tenant']);
  release(); await first; await second;
  await h.invoke(); assert.equal(count, 3);
});

test('coordination is bounded at25 and saturation still executes the ordinary service contract', async () => {
  let release, calls = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ onInbound: async () => { if (++calls === 1) await blocked; } });
  const pending = Array.from({ length: 25 }, () => h.invoke());
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  await h.invoke(); assert.equal(calls, 2);
  release(); await Promise.all(pending); assert.equal(calls, 26);
});

test('empty scope performs no work and unavailable scoped work stops after one empty claim', async () => {
  const empty = harness({ ids: [], queued: ['foreign'], managed: true });
  assert.deepEqual(await empty.invoke(), []); assert.equal(empty.queries.length, 0); assert.equal(empty.claims.length, 0);
  const absent = harness({ ids: ['missing'], queued: ['foreign'] });
  assert.deepEqual(await absent.invoke(), []); assert.equal(absent.claims.length, 1); assert.equal(absent.results.length, 0);
});

test('both dispatch paths remain bounded at25, unscoped drain reaches empty, managed incomplete result stops', async () => {
  for (const managed of [false, true]) for (const unscoped of [false, true]) {
    const ids = Array.from({ length: 30 }, (_, i) => String(i)), h = harness({ ids, queued: [...ids], managed });
    assert.equal((await h.invoke(unscoped)).length, 25);
    assert.equal(h.claims.length + h.effects.length, 25);
  }
  const h = harness({ queued: ['a'] }); assert.deepEqual(await h.invoke(true), ['a']); assert.equal(h.claims.length, 2);
  const stopped = harness({ ids: ['a'], queued: ['a'], managed: true, state: 'PENDING' });
  assert.deepEqual(await stopped.invoke(), []); assert.equal(stopped.effects.length, 1); assert.equal(stopped.claims.length, 0);
  const denied = harness({ queued: ['a'], denied: true });
  await assert.rejects(denied.invoke(true), { code: 'DENIED' }); assert.equal(denied.claims.length, 0);
});
