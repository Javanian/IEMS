import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {nativeWorkflowRevisions,nativeWorkflowBindings} from './native-workflows.mjs';
import {nativeN8nWorkflowHash} from '../../packages/tenant-lifecycle/native-n8n-provider.mjs';

test('all exported API nodes retain scoped credentials, trusted Origin and JSON headers', async () => {
  const ids = ['wf-sla-escalation', 'wf-cs-weekly-digest', 'wf-approved-resolution', 'wf-automation-recovery', 'wf-automation-error'];
  let requests = 0;
  for (const id of ids) {
    const workflow = JSON.parse(await readFile(new URL(`./workflows/${id}.json`, import.meta.url), 'utf8'));
    for (const node of workflow.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest')) {
      requests++;
      assert.equal(node.parameters.authentication, 'genericCredentialType');
      assert.equal(node.parameters.genericAuthType, 'httpHeaderAuth');
      assert.equal(node.credentials.httpHeaderAuth.id, 'iems-service-api');
      const headers = Object.fromEntries(node.parameters.headerParameters.parameters.map(h => [h.name, h.value]));
      assert.equal(headers.Origin, 'http://127.0.0.1:5187');
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers.Cookie, undefined, 'secrets belong only in the private credential store');
      assert.equal(headers.Authorization, undefined);
      assert.equal(node.parameters.options.timeout, 15000);
    }
  }
  assert.equal(requests, 7);
});

test('native webhook revisions freeze fractional node versions and separate mutable schedules',()=>{
  const workflows=nativeWorkflowRevisions({apiPort:32740,smtpPort:32741,webPort:32744}),bindings=nativeWorkflowBindings(workflows,32746);
  assert.equal(bindings.length,4);
  for(const binding of bindings){
    const workflow=workflows.find(w=>w.id===binding.workflowId);
    assert.equal(binding.workflowHash,nativeN8nWorkflowHash(workflow));
    assert.ok(!workflow.nodes.some(n=>n.type.endsWith('.scheduleTrigger')));
    assert.ok(workflow.nodes.some(n=>n.typeVersion%1!==0));
    assert.ok(workflow.nodes.find(n=>n.name==='Native SMTP DATA').parameters.jsCode.includes('smtpPort:32741'));
    assert.deepEqual(workflow.connections['Native SMTP DATA'].main[0].map(n=>n.node),['IEMS_NATIVE_RESULT']);
    assert.equal(workflow.connections.IEMS_NATIVE_RESULT,undefined);
    assert.ok(!workflow.nodes.some(n=>n.retryOnFail));
    assert.equal(new URL(binding.webhookUrl).port,'32746');
  }
  const schedules=workflows.filter(w=>w.id.endsWith('-schedule'));assert.equal(schedules.length,3);
  for(const workflow of schedules){assert.ok(!workflow.nodes.some(n=>n.type.endsWith('.webhook')));assert.ok(workflow.nodes.some(n=>n.type.endsWith('.scheduleTrigger')));}
  assert.throws(()=>nativeWorkflowRevisions({apiPort:4319,smtpPort:2527,webPort:5187}),/NATIVE_OWNED_PORT_REQUIRED/);
});
