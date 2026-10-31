import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEffectTracker, createCommandAttempt, serviceCommandContract } from '../../apps/web/src/features/portfolio/client.mjs';
const identity = { user: { id: 'actor' }, scope: { tenantId: 'tenant', plantId: 'plant' } };
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
test('v15 UI tracks public accepted intents across reload, source refresh and scope switch without resending unknown work', async () => {
  const store = storage(), id = randomUUID(), calls = []; let current = identity, state = 'ACCEPTED', phaseState = null;
  const requester = async (path, options) => {
    calls.push({ path, options });
    if (options) { if (path.endsWith('/continue')) { phaseState = 'UNKNOWN'; throw Error('Owned lost phase ACK'); } phaseState = 'SETTLED'; state = 'COMPLETED'; return { data: {} }; }
    return { data: { commandId: id, state, acceptedResult: { state: 'ACCEPTED' }, phases: phaseState ? [{ phase: 'EMBED', state: phaseState }] : [] } };
  };
  const tracker = createEffectTracker('owned-phase', { storage: store, requester, getIdentity: () => current });
  tracker.remember(id, ['EMBED'], 'Document index'); assert.equal(calls.length, 0); assert.ok(!JSON.stringify([...store.values.values()]).includes('acceptedResult'));
  await tracker.inspect(id); await assert.rejects(tracker.continue(id, 'EMBED')); await tracker.inspect(id);
  const before = calls.length; await assert.rejects(tracker.continue(id, 'EMBED')); assert.equal(calls.length, before);
  const remounted = createEffectTracker('owned-phase', { storage: store, requester, getIdentity: () => current }); assert.equal(remounted.snapshot().items[0].status, undefined); assert.equal(calls.length, before);
  current = { ...identity, scope: { ...identity.scope, plantId: 'other' } }; assert.equal(tracker.snapshot().items[0].status, undefined); assert.equal(tracker.snapshot().items[0].scopeChanged, true); await assert.rejects(remounted.inspect(id), { code: 'COMMAND_SCOPE_CHANGED' }); assert.equal(calls.length, before);
  current = identity; await remounted.inspect(id); await remounted.observe(id, 'EMBED'); assert.equal(state, 'COMPLETED'); assert.equal(calls.filter(call => call.path.endsWith('/continue')).length, 1); remounted.dismiss(id); assert.equal(remounted.snapshot().items.length, 0);
});
test('v15 only original parent evidence permits the retained child continuation path', async () => {
  const store = storage(), parent = randomUUID(), child = randomUUID(), phase = randomUUID(), calls = [];
  const tracker = createEffectTracker('owned-child', { storage: store, getIdentity: () => identity, requester: async (path, options) => { calls.push({ path, options }); return { data: { commandId: path.includes(child) ? child : parent, state: 'COMPLETED', phases: path.includes(child) ? [{ phase, state: 'UNKNOWN' }] : [{ phase: 'EFFECT', phaseResult: { items: [{ commandId: child, deliveryId: phase, state: 'NEEDS_REVIEW' }] } }] } }; } });
  tracker.remember(parent, ['EFFECT'], 'Recovery'); assert.throws(() => tracker.rememberChild(parent, child, phase, 'Child'));
  await tracker.inspect(parent); tracker.rememberChild(parent, child, phase, 'Child'); await tracker.inspect(child); await tracker.reconcileChild(child, phase);
  assert.equal(calls.filter(call => call.options).length, 1); assert.equal(calls.find(call => call.options).path, `/api/saas/effects/${parent}/children/${child}/continue`); assert.deepEqual(calls.find(call => call.options).options.body, { phase });
  assert.ok(JSON.parse([...store.values.values()][0]).find(row => row.commandId === child).parentId === parent);
});
test('v15 engine and recovery retain the original caller key and recover only the matching accepted receipt', async () => {
  assert.equal(serviceCommandContract('/api/cs/automation/run/external', {}), null);
  for (const [path, action, idField] of [['/api/cs/automation/run/wf-sla-escalation', 'AUTOMATION_ENGINE_RUN', 'runId'], ['/api/cs/automation/reconcile', 'AUTOMATION_RECOVERY', 'recoveryId']]) {
    const store = storage(), attempt = createCommandAttempt('owned-' + action, { storage: store, profile: 'CS_AUTOMATION_V14', keyFactory: () => 'retained-original-key' }), requests = [], body = { ...(idField === 'runId' ? { mode: 'DEMO' } : {}) }, commandId = randomUUID();
    await assert.rejects(attempt.send(identity, path, body, { requester: async (p, options) => { requests.push(options); throw Error('Owned accepted response lost'); } })); body.changed = true;
    const remounted = createCommandAttempt('owned-' + action, { storage: store, profile: 'CS_AUTOMATION_V14' });
    const receipt = { action, idempotencyKey: 'retained-original-key', tenantId: 'tenant', plantId: 'plant', result: { [idField]: commandId, state: 'ACCEPTED' } }, status = { commandId, acceptedResult: { state: 'ACCEPTED' } };
    assert.throws(() => remounted.reconcileAccepted(identity, { receipt: { ...receipt, idempotencyKey: 'other' }, status })); remounted.reconcileAccepted(identity, { receipt, status }); assert.equal(remounted.snapshot().pending, false);
    await attempt.retry(identity, { requester: async (p, options) => { requests.push(options); return { data: receipt.result }; } }); assert.deepEqual(requests[0], requests[1]); assert.equal(requests[0].headers['Idempotency-Key'], 'retained-original-key'); assert.ok(!Object.hasOwn(requests[0].body, 'changed'));
  }
});
