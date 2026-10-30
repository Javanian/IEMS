import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderLifecycle } from '../src/provider-lifecycle.mjs';

function fixture(overrides = {}) {
  const calls = [];
  const ownership = { tenantId: 'synthetic', accountId: 'test', ownerId: 'owner:1', generation: 1 };
  const lifecycle = createProviderLifecycle({ ownerId: ownership.ownerId,
    registry: {
      acquire: async () => { calls.push('acquire'); return ownership; },
      release: async input => { calls.push('release'); assert.equal(input.adapterClosed, true); },
      ...overrides.registry,
    },
    adapter: {
      open: async input => { calls.push('open'); assert.deepEqual(input, ownership); assert.ok(Object.isFrozen(input)); },
      close: async () => { calls.push('close'); return { closed: true }; },
      ...overrides.adapter,
    },
  });
  return { lifecycle, calls };
}

test('explicit start and confirmed stop reserve before open and release after close', async () => {
  const { lifecycle, calls } = fixture();
  assert.equal((await lifecycle.start()).state, 'OPEN');
  assert.equal(lifecycle.status().externalSendEnabled, false);
  assert.equal(lifecycle.send, undefined);
  await assert.rejects(lifecycle.start(), /BUSY/);
  assert.equal((await lifecycle.stop()).state, 'CLOSED');
  assert.deepEqual(calls, ['acquire', 'open', 'close', 'release']);
});

test('overlapping start and stop cannot duplicate adapter operations', async () => {
  let finish;
  const f = fixture({ adapter: { open: () => new Promise(resolve => { finish = resolve; }) } });
  const pending = f.lifecycle.start();
  await Promise.resolve();
  await assert.rejects(f.lifecycle.start(), /BUSY/);
  await assert.rejects(f.lifecycle.stop(), /NOT_OPEN/);
  finish();
  await pending;
  assert.equal(f.calls.filter(x => x === 'acquire').length, 1);
});

for (const stage of ['acquire', 'open', 'close', 'release', 'unconfirmed']) {
  test(`uncertain ${stage} requires reconciliation without automatic retries or release`, async () => {
    const failure = async () => { throw new Error('private adapter detail'); };
    const f = fixture({
      registry: stage === 'acquire' ? { acquire: failure } : stage === 'release' ? { release: failure } : {},
      adapter: stage === 'open' ? { open: failure } : stage === 'close' ? { close: failure }
        : stage === 'unconfirmed' ? { close: async () => ({ closed: false }) } : {},
    });
    if (stage === 'acquire' || stage === 'open') await assert.rejects(f.lifecycle.start(), /START_REQUIRES_RECONCILIATION/);
    else { await f.lifecycle.start(); await assert.rejects(f.lifecycle.stop(), /STOP_REQUIRES_RECONCILIATION/); }
    assert.equal(f.lifecycle.status().state, 'UNKNOWN');
    await assert.rejects(f.lifecycle.start(), /BUSY/);
    await assert.rejects(f.lifecycle.stop(), /NOT_OPEN/);
    if (stage !== 'release') assert.ok(!f.calls.includes('release'));
  });
}
