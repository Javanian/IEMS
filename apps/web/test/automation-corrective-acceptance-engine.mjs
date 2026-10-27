import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// Read-only n8n metadata plus scoped IEMS API evidence. Private credentials stay in memory.
const root = resolve(process.env.IEMS_AUTOMATION_LAB_ROOT || 'D:/IEMS-Automation-Lab/n8n-corrective-acceptance-20261027');
const output = resolve(process.env.IEMS_AUTOMATION_QA_EVIDENCE || 'D:/Project AI/GITHUB/IEMS-evidence/n8n-corrective-acceptance-20261027/agent-c/engine');
await mkdir(output, { recursive: true });
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const base = `http://127.0.0.1:${config.ports.api}`;
const origin = `http://127.0.0.1:${config.ports.web}`;
const runtimePackage = JSON.parse(await readFile(join(root, 'runtime/node_modules/n8n/package.json'), 'utf8'));
const login = await fetch(`${base}/api/session/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
assert.equal(login.status, 200, 'Owned synthetic sign-in must succeed');
const cookie = login.headers.get('set-cookie').split(';')[0];
const get = async path => {
  const response = await fetch(`${base}/api${path}`, { headers: { origin, cookie } });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return (await response.json()).data;
};
const database = process.env.IEMS_N8N_DATABASE || join(root, 'n8n-user/.n8n/database.sqlite');
await stat(database);
const sqlite = new DatabaseSync(database, { readOnly: true });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const spec = workflow => ({ nodes: workflow.nodes.map(n => Object.fromEntries(['id', 'name', 'type', 'typeVersion', 'parameters', 'credentials', 'webhookId'].filter(k => n[k] !== undefined).map(k => [k, n[k]]))).sort((a, b) => a.id.localeCompare(b.id)), connections: workflow.connections });
const checks = [], workflows = [];
try {
  assert.equal(runtimePackage.version, '1.121.3');
  checks.push('Pinned actual n8n runtime version 1.121.3');
  const observed = sqlite.prepare('SELECT id,name,active,nodes,connections FROM workflow_entity').all();
  const columns = sqlite.prepare('PRAGMA table_info(execution_entity)').all().map(c => c.name);
  const selected = ['id', 'workflowId', 'mode', 'status', 'startedAt', 'stoppedAt', 'finished', 'retryOf'].filter(c => columns.includes(c));
  const executions = sqlite.prepare(`SELECT ${selected.map(c => `"${c}"`).join(',')} FROM execution_entity ORDER BY id`).all();
  for (const id of ['wf-sla-escalation', 'wf-cs-weekly-digest', 'wf-approved-resolution', 'wf-automation-recovery', 'wf-automation-error']) {
    const exportedBytes = await readFile(new URL(`../../../ops/automation-lab/workflows/${id}.json`, import.meta.url));
    const exported = JSON.parse(exportedBytes);
    const imported = observed.find(w => w.id === id); assert.ok(imported, `Missing clean import ${id}`);
    const actualSpec = spec({ nodes: JSON.parse(imported.nodes), connections: JSON.parse(imported.connections) });
    const sourceSpec = spec(exported);
    assert.equal(digest(actualSpec), digest(sourceSpec), `Imported executable spec differs from sanitized export ${id}`);
    const runs = executions.filter(e => e.workflowId === id);
    if (['wf-sla-escalation', 'wf-cs-weekly-digest', 'wf-approved-resolution'].includes(id)) {
      assert.ok(runs.some(r => r.status === 'success'), `No successful actual-engine execution ${id}`);
      checks.push(`N01 imported executable spec and actual-engine success ${id}`);
    }
    workflows.push({ id, name: imported.name, active: Boolean(imported.active), exportSha256: digest(exportedBytes), executableSpecSha256: digest(actualSpec), executions: runs });
  }
  const [status, audits, deliveries, receipts] = await Promise.all([get('/cs/automation/status'), get('/cs/automation/audit-logs'), get('/cs/automation/deliveries'), get('/cs/automation/sink-messages')]);
  for (const action of ['TICKET_ESCALATE', 'DIGEST_DELIVERY_RESULT', 'RESOLUTION_DELIVERY_RESULT']) {
    const found = audits.find(row => row.action === action && row.executionId && executions.some(e => String(e.id) === String(row.executionId) && e.status === 'success'));
    assert.ok(found, `No actual successful engine execution bound to domain action ${action}`);
    checks.push(`N01 domain action ${action} bound to observed engine execution`);
  }
  assert.ok(receipts.length >= 2, 'Expected verified digest and resolution local receipts');
  checks.push('N08 scoped API returned verifiable local receipts');
  const report = { observedAt: new Date().toISOString(), testedSha: process.env.IEMS_TESTED_SHA || 'UNKNOWN', dirtyTreeQualification: process.env.IEMS_TESTED_TREE || 'UNFROZEN', n8nVersion: runtimePackage.version, workflows, checks, status, audits, deliveries, receipts };
  await writeFile(join(output, 'engine-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: checks.length, n8nVersion: runtimePackage.version, workflows: workflows.map(w => ({ id: w.id, active: w.active, executionIds: w.executions.filter(e => e.status === 'success').map(e => e.id) })), receipts: receipts.length }));
} finally { sqlite.close(); }
