import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {nativeWorkflowRevisions,nativeWorkflowBindings,materializeNativeNodeDefaults} from './native-workflows.mjs';
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

test('native revisions freeze pinned n8n execution defaults before hashing, without hiding later drift',()=>{
  const workflows=nativeWorkflowRevisions({apiPort:32740,smtpPort:32741,webPort:32744});
  assert.deepEqual(materializeNativeNodeDefaults(structuredClone(workflows)),workflows,'Runtime defaults must be idempotent');
  const digest=workflows.find(w=>w.id==='wf-cs-weekly-digest');
  const webhook=digest.nodes.find(n=>n.type==='n8n-nodes-base.webhook');
  assert.equal(webhook.parameters.multipleMethods,false);
  assert.equal(webhook.parameters.responseData,'firstEntryJson');
  for(const node of digest.nodes.filter(n=>n.type==='n8n-nodes-base.code')){
    assert.equal(node.parameters.mode,'runOnceForAllItems');
    assert.equal(node.parameters.language,'javaScript');
  }
  const altered=structuredClone(digest);altered.nodes.find(n=>n.type==='n8n-nodes-base.webhook').parameters.responseData='allEntries';
  assert.notEqual(nativeN8nWorkflowHash(altered),nativeN8nWorkflowHash(digest));
  const unsupported=structuredClone(workflows);unsupported[0].nodes[0].typeVersion=999;
  assert.throws(()=>materializeNativeNodeDefaults(unsupported),/NATIVE_NODE_SCHEMA_UNSUPPORTED/);
});

test('materialized parameters remain identical under the actual pinned runtime node descriptions',()=>{
  const packageRoot=process.env.IEMS_N8N_PACKAGE_ROOT??'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n';
  const require=createRequire(join(packageRoot,'package.json')),{NodeHelpers}=require('n8n-workflow');
  const known=require('../n8n-nodes-base/dist/known/nodes.json'),types=new Map();
  for(const workflow of nativeWorkflowRevisions({apiPort:32740,smtpPort:32741,webPort:32744,n8nPackageRoot:packageRoot}))for(const node of workflow.nodes){
    const name=node.type.slice('n8n-nodes-base.'.length);
    if(!types.has(name)){
      const entry=known[name],Node=require('../n8n-nodes-base/'+entry.sourcePath)[entry.className];
      types.set(name,new Node());
    }
    const type=types.get(name),description=(type.getNodeType?.(node.typeVersion)??type).description;
    const actual=NodeHelpers.getNodeParameters(description.properties,node.parameters,true,false,node,description)??{};
    assert.deepEqual(actual,node.parameters,`${node.type}@${node.typeVersion} ${node.name}`);
  }
  assert.equal(types.size,8);
});
