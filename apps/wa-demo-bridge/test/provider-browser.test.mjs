import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderBrowserAdapter, createProviderBrowserLifecycle } from '../src/provider-browser.mjs';

const ownership = Object.freeze({ tenantId: 'synthetic', accountId: 'test', ownerId: 'owner:1', generation: 1 });
const config = { tenantId: ownership.tenantId, accountId: ownership.accountId, timeoutMs: 20 };

test('late launch leaves immutable reconciliation evidence and cannot launch again', async () => {
  let complete;
  let launches = 0;
  let closes = 0;
  const adapter = createProviderBrowserAdapter({ ...config, driver: { launch: () => {
    launches++;
    return new Promise(resolve => { complete = resolve; });
  } } });
  const initial = adapter.status();
  assert.equal(initial.state, 'IDLE');
  assert.equal(initial.ownerId, null);
  await assert.rejects(adapter.open(ownership), /RECONCILIATION/);
  const evidence = adapter.status();
  assert.deepEqual(evidence, { ...ownership, state: 'UNKNOWN', externalSendEnabled: false });
  assert.ok(Object.isFrozen(evidence));
  assert.throws(() => { evidence.generation = 99; }, TypeError);
  complete({ close: async () => { closes++; return { closed: true }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(adapter.status(), evidence);
  await assert.rejects(adapter.open({ ...ownership, generation: 2 }), /BUSY/);
  await assert.rejects(adapter.close(ownership), /NOT_OPEN/);
  assert.equal(launches, 1);
  assert.equal(closes, 0);
  assert.equal(initial.state, 'IDLE');
});

test('launch receives only fenced metadata; explicit close precedes release', async () => {
  const calls = [];
  const lifecycle = createProviderBrowserLifecycle({ ...config, ownerId: ownership.ownerId,
    registry: { acquire: async () => { calls.push('acquire'); return ownership; },
      release: async () => { calls.push('release'); } },
    driver: { launch: async input => {
      calls.push('launch');
      assert.deepEqual(input, { ...ownership, externalSendEnabled: false });
      assert.ok(Object.isFrozen(input));
      return { close: async () => { calls.push('close'); return { closed: true }; } };
    } },
  });
  await lifecycle.start();
  assert.equal(lifecycle.send, undefined);
  await lifecycle.stop();
  assert.deepEqual(calls, ['acquire', 'launch', 'close', 'release']);
});

test('wrong scope/generation cannot launch or close the owned browser', async () => {
  let launches = 0;
  const adapter = createProviderBrowserAdapter({ ...config, driver: { launch: async () => {
    launches++; return { close: async () => ({ closed: true }) };
  } } });
  await assert.rejects(adapter.open({ ...ownership, accountId: 'other' }), /SCOPE/);
  await adapter.open(ownership);
  await assert.rejects(adapter.open(ownership), /BUSY/);
  await assert.rejects(adapter.close({ ...ownership, generation: 2 }), /SCOPE/);
  await adapter.close(ownership);
  assert.equal(launches, 1);
});

for (const stage of ['launch', 'close', 'unconfirmed', 'invalid']) {
  test(`uncertain ${stage} preserves reservation without retry`, async () => {
    let released = 0;
    let launched = 0;
    const lifecycle = createProviderBrowserLifecycle({ ...config, ownerId: ownership.ownerId,
      registry: { acquire: async () => ownership, release: async () => { released++; } },
      driver: { launch: async () => {
        launched++;
        if (stage === 'launch') return new Promise(() => {});
        if (stage === 'invalid') return {};
        return { close: async () => stage === 'close' ? new Promise(() => {}) : { closed: false } };
      } },
    });
    if (stage === 'launch' || stage === 'invalid') await assert.rejects(lifecycle.start(), /RECONCILIATION/);
    else { await lifecycle.start(); await assert.rejects(lifecycle.stop(), /RECONCILIATION/); }
    assert.equal(lifecycle.status().state, 'UNKNOWN');
    await assert.rejects(lifecycle.start(), /BUSY/);
    assert.equal(released, 0);
    assert.equal(launched, 1);
  });
}
