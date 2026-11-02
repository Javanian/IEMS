import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contentHash } from '../tenant-foundation/commands.mjs';
import { effectHash } from './effect-primitives.mjs';
import { nativeN8nBinding, nativeN8nWorkflowHash, inspectNativeN8nHistory, verifiedNativeN8nObservation, isNativeN8nProvider } from './native-n8n-provider.mjs';

function fixture(delivery = false) {
  const workflowData = { id: 'owned-workflow', nodes: [{ name: 'SyntheticFixture', typeVersion: 4.2, position: [1.5, 2] }], connections: {}, name: 'Synthetic parser fixture', settings: {} };
  const payload = { selectedId: randomUUID() }, body = 'Synthetic fixture only', subject = 'Fixture', recipients = ['fixture@iems.local'];
  const input = { workflowId: workflowData.id, workflowHash: nativeN8nWorkflowHash(workflowData), sourceHash: contentHash('source'),
    approvalHash: contentHash('approval'), payloadHash: contentHash(payload), recipientHash: contentHash(recipients),
    contentHash: contentHash({ subject, body }), deliveryId: delivery ? randomUUID() : null, messageId: delivery ? `<${randomUUID()}@iems.local>` : null };
  const attempt = { _id: randomUUID(), tenantId: randomUUID(), plantId: randomUUID(), legalEntityId: randomUUID(), commandId: randomUUID(),
    instanceEpoch: randomUUID(), adapterId: 'native.n8n', phase: delivery ? input.deliveryId : 'EFFECT', ordinal: 1, fence: 1, epoch: 0, input, inputHash: effectHash(input) };
  attempt.providerKey = contentHash({ tenantId: attempt.tenantId, commandId: attempt.commandId, phase: attempt.phase, ordinal: attempt.ordinal });
  const provider = { providerId: 'native.n8n', instanceId: randomUUID() }, binding = nativeN8nBinding(attempt, provider);
  const workflow = { workflowId: workflowData.id, workflowHash: input.workflowHash, inputNode: 'IEMS_NATIVE_INPUT', resultNode: 'IEMS_NATIVE_RESULT' };
  const run = json => [{ executionStatus: 'success', data: { main: [[{ json }]] } }];
  const executions = [{ id: '41', workflowId: workflowData.id, finished: 1, status: 'success', mode: 'webhook', retryOf: null, retrySuccessId: null,
    deletedAt: null, stoppedAt: '2026-11-02T00:00:00.000Z', workflowData, data: { resultData: { lastNodeExecuted: workflow.resultNode,
      runData: { [workflow.inputNode]: run({ body: { iemsNative: binding, payload } }), [workflow.resultNode]: run({ iemsNativeResult: {
        schema: 'IEMS_NATIVE_N8N_RESULT_V1', bindingHash: contentHash(binding), state: 'COMPLETED', resultHash: contentHash('result'), smtpReceiptId: null } }) } } } }];
  const mail = delivery ? [{ id: randomUUID(), receivedAt: '2026-11-02T00:00:00.000Z', envelopeFrom: 'sender@iems.local', envelopeTo: recipients,
    subject, body, raw: `Subject: ${subject}\r\n\r\n${body}`, receiptStatus: 'Accepted by local mail sink',
    headers: { 'x-iems-native-correlation': binding.correlationId, 'x-iems-native-binding': contentHash(binding), 'message-id': binding.messageId } }] : [];
  if (delivery) executions[0].data.resultData.runData.IEMS_NATIVE_RESULT[0].data.main[0][0].json.iemsNativeResult.smtpReceiptId = mail[0].id;
  return { attempt, provider, binding, workflow, executions, mail };
}

test('synthetic native history fixtures validate structure but never obtain runtime observation authority', () => {
  for (const delivery of [false, true]) {
    const value = fixture(delivery), result = inspectNativeN8nHistory(value);
    assert.equal(result.state, 'TERMINAL');
    assert.equal(result.deliveryState, delivery ? 'ACCEPTED_LOCAL' : null);
    assert.equal(isNativeN8nProvider(value.provider), false);
    assert.throws(() => verifiedNativeN8nObservation(result, value.attempt, value.provider), { code: 'NATIVE_OBSERVATION_UNPROVEN' });
    assert.throws(() => verifiedNativeN8nObservation({}, value.attempt, value.provider), { code: 'NATIVE_OBSERVATION_UNPROVEN' });
    assert.ok(!JSON.stringify(result).includes('Synthetic fixture only'));
  }
});

test('native binding rejects altered original key, input hash and unsafe private fields', () => {
  for (const key of ['providerKey', 'inputHash', 'tenantId', 'fence', 'epoch', 'ordinal']) {
    const f = fixture(); f.attempt[key] = key === 'fence' || key === 'ordinal' ? 0 : key === 'epoch' ? -1 : 'forged';
    assert.throws(() => nativeN8nBinding(f.attempt, f.provider), { code: 'NATIVE_BINDING_INVALID' });
  }
  const f = fixture(); f.attempt.input.body = 'private'; f.attempt.inputHash = effectHash(f.attempt.input);
  assert.throws(() => nativeN8nBinding(f.attempt, f.provider), { code: 'NATIVE_BINDING_INVALID' });
});

test('workflow revision projection accepts n8n final metadata but rejects changed nodes and pinned data', () => {
  const f = fixture(), original = f.executions[0].workflowData;
  assert.equal(nativeN8nWorkflowHash({ ...original, createdAt: 'native timestamp', updatedAt: 'native timestamp', active: true, pinData: {}, staticData: null }), f.binding.workflowHash);
  f.executions[0].workflowData = { ...original, nodes: [{ name: 'other' }] };
  assert.equal(inspectNativeN8nHistory(f).state, 'UNKNOWN');
  assert.throws(() => nativeN8nWorkflowHash({ ...original, pinData: { injected: true } }), { code: 'NATIVE_WORKFLOW_SNAPSHOT_INVALID' });
  assert.throws(() => nativeN8nWorkflowHash({ ...original, staticData: { state: 'mutable' } }), { code: 'NATIVE_WORKFLOW_SNAPSHOT_INVALID' });
  assert.notEqual(nativeN8nWorkflowHash({ ...original, nodes: [{ ...original.nodes[0], typeVersion: 4.3 }] }), f.binding.workflowHash);
});

test('wrong original scope, instance, workflow, fence, attempt and hashes cannot validate history', () => {
  for (const key of ['tenantId', 'plantId', 'legalEntityId', 'commandId', 'attemptId', 'instanceId', 'providerId', 'instanceEpoch',
    'workflowId', 'workflowHash', 'fence', 'epoch', 'providerKey', 'inputHash', 'sourceHash', 'approvalHash', 'recipientHash', 'contentHash']) {
    const f = fixture(true); f.binding = { ...f.binding, [key]: 'foreign' };
    assert.equal(inspectNativeN8nHistory(f).state, 'UNKNOWN', key);
  }
});

test('missing, duplicated, failed, retried, pruned and incomplete history stays unknown', () => {
  const mutations = [f => f.executions = [], f => f.executions.push(structuredClone(f.executions[0])),
    f => f.executions[0].status = 'error', f => f.executions[0].finished = 0, f => f.executions[0].stoppedAt = null,
    f => f.executions[0].retryOf = '40', f => f.executions[0].retrySuccessId = '42', f => f.executions[0].deletedAt = 'now',
    f => f.executions[0].mode = 'manual', f => f.executions[0].data.resultData.error = {},
    f => delete f.executions[0].data.resultData.runData.IEMS_NATIVE_RESULT,
    f => f.executions[0].data.resultData.runData.IEMS_NATIVE_RESULT.push({}),
    f => f.executions[0].workflowData = {}, f => f.executions[0].workflowId = 'other',
    f => f.executions[0].data.resultData.lastNodeExecuted = 'other',
    f => f.executions[0].data.resultData.runData.IEMS_NATIVE_INPUT[0].data.main[0][0].json.body.payload = {}];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal(inspectNativeN8nHistory(f).state, 'UNKNOWN'); }
});

test('execution success cannot replace exact SMTP receipt, recipient, content or message identity', () => {
  const mutations = [f => f.mail = [], f => f.mail.push(structuredClone(f.mail[0])),
    f => f.mail[0].headers['x-iems-native-binding'] = 'wrong', f => f.mail[0].headers['message-id'] = '<other@iems.local>',
    f => f.mail[0].envelopeTo = ['customer@example.com'], f => f.mail[0].envelopeTo.push('other@iems.local'),
    f => f.mail[0].body = 'changed', f => f.mail[0].subject = 'changed', f => f.mail[0].receiptStatus = 'sent',
    f => f.mail[0].id = 'forged', f => f.mail[0].id = randomUUID(), f => f.mail[0].raw = ''];
  for (const mutate of mutations) { const f = fixture(true); mutate(f); assert.equal(inspectNativeN8nHistory(f).state, 'UNKNOWN'); }
});
