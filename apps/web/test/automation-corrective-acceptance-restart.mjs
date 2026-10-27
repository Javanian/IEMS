import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createSyntheticComplaint } from '../src/features/portfolio/automation-demo.mjs';

// Requires exclusive integrated-runtime ownership from the lead/B before execution.
const root = resolve(process.env.IEMS_AUTOMATION_LAB_ROOT || 'D:/IEMS-Automation-Lab/n8n-corrective-acceptance-20261027');
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const output = resolve(process.env.IEMS_AUTOMATION_QA_EVIDENCE || 'D:/Project AI/GITHUB/IEMS-evidence/n8n-corrective-acceptance-20261027/agent-c/restart');
await mkdir(output, { recursive: true });
const base = `http://127.0.0.1:${config.ports.api}`, origin = `http://127.0.0.1:${config.ports.web}`;
const engine = `http://127.0.0.1:${config.ports.n8n}`;
const checks = [], executions = [];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
async function cleanImport() {
  const userFolder = await mkdtemp(join(root, 'qa-clean-import-'));
  const pinned = JSON.parse(await readFile(join(root, 'runtime/node_modules/n8n/package.json'), 'utf8')).version;
  assert.equal(pinned, '1.121.3');
  const env = { ...process.env, N8N_USER_FOLDER: userFolder, N8N_ENCRYPTION_KEY: config.encryptionKey,
    N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_TEMPLATES_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false', N8N_LICENSE_AUTO_RENEW_ENABLED: 'false', N8N_LICENSE_ACTIVATION_KEY: '',
    N8N_COMMUNITY_PACKAGES_ENABLED: 'false', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true', N8N_RUNNERS_ENABLED: 'false',
    NODE_OPTIONS: '--max-old-space-size=1536' };
  const cli = (name, args) => new Promise((resolveCli, reject) => {
    const child = spawn(process.execPath, [join(root, 'runtime/node_modules/n8n/bin/n8n'), ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    child.once('error', reject);
    child.once('exit', async code => {
      try {
        for (const secret of [config.password, config.n8nPassword, config.serviceToken, config.sinkToken, config.webhookToken, config.encryptionKey].filter(Boolean)) log = log.replaceAll(secret, '[REDACTED]');
        await writeFile(join(output, `clean-import-${name}.log`), log);
        code === 0 ? resolveCli() : reject(new Error(`Pinned clean CLI import ${name} exited ${code}; inspect sanitized log`));
      } catch (error) { reject(error); }
    });
  });
  await cli('credentials', ['import:credentials', `--input=${join(root, 'n8n-credentials.private.json')}`]);
  const ids = ['wf-sla-escalation', 'wf-cs-weekly-digest', 'wf-approved-resolution', 'wf-automation-recovery', 'wf-automation-error'];
  const exports = [];
  for (const id of ids) {
    const file = resolve(import.meta.dirname, `../../../ops/automation-lab/workflows/${id}.json`);
    const bytes = await readFile(file); exports.push({ id, file, sha256: hash(bytes), workflow: JSON.parse(bytes) });
    await cli(id, ['import:workflow', `--input=${file}`]);
  }
  const db = new DatabaseSync(join(userFolder, '.n8n/database.sqlite'), { readOnly: true });
  try {
    const actual = db.prepare('SELECT id,nodes,connections FROM workflow_entity').all();
    assert.deepEqual(actual.map(row => row.id).sort(), [...ids].sort());
    for (const item of exports) {
      const row = actual.find(row => row.id === item.id);
      assert.equal(hash({ nodes: JSON.parse(row.nodes), connections: JSON.parse(row.connections) }), hash({ nodes: item.workflow.nodes, connections: item.workflow.connections }), `Clean imported executable specification mismatch ${item.id}`);
    }
  } finally { db.close(); }
  const result = { n8nVersion: pinned, userFolder, imports: exports.map(({ id, sha256 }) => ({ id, sha256 })), engineStarted: false };
  await writeFile(join(output, 'clean-import-results.json'), JSON.stringify(result, null, 2));
  check('N01 N15 independent clean pinned CLI import of exactly five sanitized executable workflows', result);
}
const engineExecution = (workflowId, status) => {
  const db = new DatabaseSync(join(root, 'n8n-user/.n8n/database.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT id,status FROM execution_entity WHERE workflowId=? AND status=? ORDER BY id DESC LIMIT 1').get(workflowId, status); }
  finally { db.close(); }
};
const check = (name, details = {}) => { checks.push({ name, ...details }); console.log(`PASS ${name}`); };
const login = await fetch(`${base}/api/session/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const request = async (path, { body, headers = {} } = {}) => {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(`${path} HTTP ${response.status} ${result.error?.code || ''}`), { status: response.status, code: result.error?.code });
  return result;
};
const get = async path => (await request(`/api${path}`)).data;
const post = async (path, body = {}, key = randomUUID()) => (await request(`/api${path}`, { body, headers: { 'idempotency-key': key } })).data;
const sinkReceipts = async () => {
  const response = await fetch(`http://127.0.0.1:${config.ports.inspector}/api/emails`, { headers: { authorization: `Bearer ${config.sinkToken}` } });
  assert.equal(response.status, 200);
  return (await response.json()).data.map(row => ({ id: row.id, deliveryId: row.headers['x-iems-delivery-id'], messageId: row.headers['message-id'] }));
};
const control = action => new Promise((resolveControl, reject) => {
  const script = resolve(import.meta.dirname, '../../../ops/automation-lab/control.ps1');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-LabRoot', root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  child.stdout.on('data', data => { diagnostic += data; }); child.stderr.on('data', data => { diagnostic += data; });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolveControl(diagnostic.trim()) : reject(new Error(`Owned ${action} failed (${code}): ${diagnostic}`)));
});
const run = async (workflowId, body = {}) => {
  const result = await post(`/cs/automation/run/${workflowId}`, body);
  assert.ok(result.executionId, `Actual engine reference missing ${workflowId}`);
  executions.push({ workflowId, executionId: result.executionId }); return result;
};
let stopped = false, failure;
try {
  const before = await sinkReceipts();
  assert.ok(before.length >= 2, 'Run browser demo first to establish accepted-delivery restart baseline');
  await control('stop-n8n'); stopped = true;
  let online = false; try { online = (await fetch(`${engine}/healthz`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
  assert.equal(online, false, 'Owned n8n must actually be stopped');
  check('N10 actual n8n stopped using owned supervisor control');
  await cleanImport();
  const pending = await createSyntheticComplaint(request);
  assert.equal((await get(`/cs/tickets/${pending.ticketId}`)).stage, 'NEW');
  const resolved = await createSyntheticComplaint(request);
  const identity = await get('/session/me');
  let source = await get(`/cs/tickets/${resolved.ticketId}`);
  for (const toStage of ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED']) {
    await post(`/cs/tickets/${source.ticketId}/stage`, { expectedVersion: source.version, toStage,
      ...(toStage === 'ASSIGNED' ? { assigneeId: identity.user.id } : {}), reason: 'Synthetic core CS stays usable during n8n outage', commandKey: randomUUID() });
    source = await get(`/cs/tickets/${source.ticketId}`);
  }
  const draft = await post('/cs/automation/resolution-draft', { ticketId: source.ticketId, expectedTicketVersion: source.version,
    channel: 'EMAIL', recipient: 'restart-qa@iems.local', proposedResolution: 'Synthetic pending approval survives actual engine stop and restart.' });
  const draftId = draft.draftId || draft._id;
  await post(`/cs/automation/resolution-drafts/${draftId}/approve`, { expectedVersion: draft.version });
  assert.equal((await get(`/cs/automation/resolution-drafts/${draftId}`)).status, 'APPROVED');
  assert.equal((await sinkReceipts()).length, before.length, 'Engine outage cannot produce a fictitious receipt');
  check('N10 core supported complaint creation, handling, resolution and approval usable while engine down', { pendingTicketId: pending.ticketId, resolvedTicketId: source.ticketId, draftId });
  let engineError;
  try { await run('wf-sla-escalation'); } catch (error) { engineError = error; }
  assert.equal(engineError?.status, 503);
  check('N10 engine outage action returns an actionable unconfirmed error', { code: engineError.code });
  await control('start-n8n'); stopped = false;
  await run('wf-sla-escalation');
  await run('wf-automation-recovery');
  const recovered = await get(`/cs/automation/resolution-drafts/${draftId}`);
  assert.equal(recovered.deliveryState, 'ACCEPTED_LOCAL', JSON.stringify(recovered));
  const current = await get(`/cs/tickets/${pending.ticketId}`);
  assert.equal(current.stage, 'NEW'); assert.ok(current.history.some(row => row.kind === 'SLA_ESCALATED'));
  const after = await sinkReceipts();
  for (const previous of before) assert.equal(after.filter(row => row.deliveryId === previous.deliveryId && row.messageId === previous.messageId).length, before.filter(row => row.deliveryId === previous.deliveryId && row.messageId === previous.messageId).length, `Accepted delivery repeated after restart: ${previous.deliveryId}`);
  assert.equal(after.filter(row => row.id === recovered.deliveryProof).length, 1);
  check('N10 actual engine restart recovers pending SLA and approved notification, preserving accepted receipts', { draftId, receiptId: recovered.deliveryProof, acceptedBefore: before.length, acceptedAfter: after.length });
  await run('wf-automation-recovery');
  const again = await sinkReceipts();
  assert.deepEqual(again, after, 'Repeated recovery must not reissue accepted mail');
  check('N03 N10 repeat actual-engine recovery adds no duplicate sink receipts');
  const previousErrorExecution = engineExecution('wf-automation-error', 'success');
  const rejected = await post('/cs/automation/resolution-draft', { ticketId: source.ticketId, expectedTicketVersion: source.version,
    channel: 'EMAIL', recipient: 'restart-qa@iems.local', proposedResolution: 'Synthetic rejected draft must fail in the actual n8n engine without transport.' });
  const rejectedId = rejected.draftId || rejected._id;
  await post(`/cs/automation/resolution-drafts/${rejectedId}/reject`, { expectedVersion: rejected.version });
  let rejectedError;
  try { await run('wf-approved-resolution', { draftId: rejectedId }); } catch (error) { rejectedError = error; }
  assert.equal(rejectedError?.status, 502, 'Rejected approval must fail the actual workflow, with no fabricated success');
  let recorded, errorExecution;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await get('/cs/automation/status');
    recorded = state.workflows.find(row => row.id === 'wf-approved-resolution')?.lastRun;
    errorExecution = engineExecution('wf-automation-error', 'success');
    if (recorded?.state === 'FAILED' && errorExecution && errorExecution.id !== previousErrorExecution?.id) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  assert.equal(recorded?.state, 'FAILED', 'IEMS must report the observed engine failure truthfully');
  assert.ok(errorExecution && errorExecution.id !== previousErrorExecution?.id, 'Actual n8n error workflow must complete its scoped sanitized failure-record API call');
  const failedPrimary = engineExecution('wf-approved-resolution', 'error');
  assert.ok(failedPrimary);
  executions.push({ workflowId: 'wf-approved-resolution', executionId: failedPrimary.id, expectedStatus: 'error', reason: 'REJECTED_DRAFT' });
  executions.push({ workflowId: 'wf-automation-error', executionId: errorExecution.id, expectedStatus: 'success' });
  assert.deepEqual(await sinkReceipts(), again);
  check('N06 rejected approval fails actual engine, invokes sanitized error workflow and creates no mail', { executionId: failedPrimary.id, errorWorkflowExecutionId: errorExecution.id });
} catch (error) {
  failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(`FAIL ${error.message}`);
} finally {
  if (stopped) { try { await control('start-n8n'); } catch (error) { failure = { ...failure, restoreError: error.message }; } }
  await writeFile(join(output, 'restart-results.json'), JSON.stringify({ observedAt: new Date().toISOString(), testedSha: process.env.IEMS_TESTED_SHA || 'UNKNOWN', dirtyTreeQualification: process.env.IEMS_TESTED_TREE || 'UNFROZEN', checks, executions, failure }, null, 2));
}
