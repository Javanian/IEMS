import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
