import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createSyntheticComplaint } from '../../../apps/web/src/features/portfolio/automation-demo.mjs';

const repo = process.cwd(), lab = process.argv[2], output = process.argv[3];
assert.ok(lab.replaceAll('\\', '/').startsWith('D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-157/6e70f0a8-d639-44c1-92db-0b23cdc10ab0/'));
await mkdir(output, { recursive: false });
const config = JSON.parse(await readFile(join(lab, 'config.json'), 'utf8'));
const status = JSON.parse(await readFile(join(lab, 'status.json'), 'utf8'));
assert.equal(status.repo.replaceAll('\\', '/'), repo.replaceAll('\\', '/'));
assert.equal(status.ready, true);
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();

const result = { sourceHead, class: 'NATIVE_N8N_1_121_3_REAL_HTTP_MONGO_SQLITE_LOCAL_SMTP_SYNTHETIC', startedAt: new Date().toISOString(), stages: {}, failures: [], workflowHashes: {} };
const save = () => writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
for (const name of ['wf-sla-escalation', 'wf-cs-weekly-digest', 'wf-approved-resolution', 'wf-automation-recovery', 'wf-automation-error']) {
  result.workflowHashes[name] = createHash('sha256').update(await readFile(join(repo, 'ops/automation-lab/workflows', name + '.json'))).digest('hex');
}
const base = `http://127.0.0.1:${config.ports.api}`, web = `http://127.0.0.1:${config.ports.web}`;
let cookie;
async function control(action) {
  assert.ok(['stop-n8n','start-n8n'].includes(action));
  const state=JSON.parse(await readFile(join(lab,'status.json'),'utf8'));
  assert.equal(state.marker,config.marker);
  const identity=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId=${state.supervisorPid}" | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,timeout:10000}));
  assert.ok(identity.CommandLine.includes(join(lab,'lab-adapted.mjs')));
  const id=randomUUID();
  await writeFile(join(lab,'control.tmp'),JSON.stringify({marker:config.marker,supervisorPid:state.supervisorPid,supervisorRunId:state.supervisorRunId,id,action}));
  await rename(join(lab,'control.tmp'),join(lab,'control.json'));
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,500));
    const latest=JSON.parse(await readFile(join(lab,'status.json'),'utf8'));
    if(latest.lastControl?.id===id){assert.equal(latest.lastControl.ok,true);return;}
  }
  throw Error('Owned engine control unconfirmed; inspect exact identity before retry');
}
async function request(path, { body, headers = {} } = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: web, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const envelope = await response.json();
  if (!response.ok) throw Error(`${path}: ${response.status} ${envelope.error?.code}`);
  return envelope;
}
const get = async path => (await request('/api' + path)).data;
const post = async (path, body = {}) => (await request('/api' + path, { body, headers: { 'Idempotency-Key': 'qa-native-' + randomUUID() } })).data;
async function run(workflow, body = {}) {
  const data = await post('/cs/automation/run/' + workflow, body);
  result.stages[workflow] = { runId: data._id ?? data.runId, executionId: data.executionId ?? data.n8nExecutionId, state: data.state };
  await save();
  return data;
}
try {
  const login = await fetch(base + '/api/session/login', { method: 'POST', headers: { origin: web, 'content-type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const identity = await get('/session/me');
  const baselineDeliveries = (await get('/cs/automation/deliveries')).length;
  const first = await createSyntheticComplaint(request);
  result.firstTicket = { ticketId: first.ticketId, ticketNumber: first.ticketNumber };
  await new Promise(resolve => setTimeout(resolve, 6500));
  await run('wf-sla-escalation', { ticketId: first.ticketId });
  let ticket = await get('/cs/tickets/' + first.ticketId);
  result.slaTicket = { stage: ticket.stage, version: ticket.version, escalationCount: ticket.escalationCount, eventKinds: ticket.history?.map(row => row.kind) };
  for (const stage of ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED']) {
    await post('/cs/tickets/' + first.ticketId + '/stage', { expectedVersion: ticket.version, toStage: stage,
      reason: 'QA native synthetic workflow handling', commandKey: randomUUID(), ...(stage === 'ASSIGNED' ? { assigneeId: identity.user.id } : {}) });
    ticket = await get('/cs/tickets/' + first.ticketId);
    assert.equal(ticket.stage, stage);
  }
  const draft = await post('/cs/automation/resolution-draft', { ticketId: first.ticketId, expectedTicketVersion: ticket.version,
    channel: 'EMAIL', recipient: 'qa-native@iems.local', proposedResolution: 'Synthetic QA resolution verified through the owned local workflow.' });
  await post('/cs/automation/resolution-drafts/' + draft._id + '/approve', { expectedVersion: draft.version, reason: 'QA synthetic recipient and source reviewed' });
  await run('wf-approved-resolution', { draftId: draft._id });
  await run('wf-cs-weekly-digest', { mode: 'DEMO', periodKey: 'demo:' + randomUUID() });
  await run('wf-automation-recovery');
  const deliveries = await get('/cs/automation/deliveries');
  result.deliveries = deliveries.map(row => ({ deliveryId: row.deliveryId, deliveryState: row.deliveryState, sinkMessageId: row.sinkMessageId, attempt: row.attempt }));
  assert.ok(result.deliveries.filter(row => row.deliveryState === 'ACCEPTED_LOCAL' && row.sinkMessageId).length >= baselineDeliveries + 2, 'Native resolution and digest require actual local receipts');
  const sink = await get('/cs/automation/sink-messages');
  result.sink = { count: Array.isArray(sink) ? sink.length : sink.items?.length ?? sink.messages?.length };
  await control('stop-n8n');
  const second = await createSyntheticComplaint(request);
  assert.ok((await get('/cs/tickets/' + second.ticketId)).ticketNumber);
  result.stages.coreDuringEngineOutage = { status: 'PASS', ticketId: second.ticketId };
  await control('start-n8n');
  await new Promise(resolve => setTimeout(resolve, 6500));
  await run('wf-sla-escalation', { ticketId: second.ticketId });
  await run('wf-automation-recovery');
  const after = await get('/cs/automation/deliveries');
  assert.equal(after.length, deliveries.length, 'Engine recovery duplicated resolution or digest delivery');
  result.stages.restartAndDeliveryConservation = 'PASS';
  const scheduled = await createSyntheticComplaint(request);
  const scheduledDeadline = Date.now() + 90000;
  let scheduledTicket;
  do {
    await new Promise(resolve => setTimeout(resolve, 2000));
    scheduledTicket = await get('/cs/tickets/' + scheduled.ticketId);
  } while (scheduledTicket.version === 1 && Date.now() < scheduledDeadline);
  assert.equal(scheduledTicket.stage, 'NEW');
  assert.ok(scheduledTicket.version > 1, 'Scheduled SLA must escalate without manual execution');
  result.stages.scheduledSla = { ticketId: scheduled.ticketId, version: scheduledTicket.version, stage: scheduledTicket.stage };
  const bad = await fetch(status.n8nBase + '/webhook/iems-approved-resolution', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-iems-webhook-token': config.webhookToken },
    body: JSON.stringify({ draftId: randomUUID() }), signal: AbortSignal.timeout(30000)
  });
  assert.ok(bad.status >= 400, 'Missing synthetic draft must fail in the native workflow');
  await new Promise(resolve => setTimeout(resolve, 3000));
  const sqlite = join(lab, 'n8n-user', '.n8n', 'database.sqlite');
  const executions = JSON.parse(execFileSync('python', ['-c',
    'import sqlite3,json,sys; from pathlib import Path; c=sqlite3.connect(Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True); print(json.dumps([dict(zip(["executionId","workflowId","status","mode"],r)) for r in c.execute("SELECT id,workflowId,status,mode FROM execution_entity ORDER BY id")])); c.close()', sqlite], { encoding: 'utf8', windowsHide: true }));
  await writeFile(join(output, 'executions.json'), JSON.stringify(executions, null, 2));
  assert.ok(executions.some(row => row.workflowId === 'wf-automation-recovery' && row.mode === 'trigger' && row.status === 'success'));
  assert.ok(executions.some(row => row.workflowId === 'wf-sla-escalation' && row.mode === 'trigger' && row.status === 'success'));
  assert.ok(executions.some(row => row.workflowId === 'wf-automation-error' && row.status === 'success'));
  result.stages.nativeScheduledRecoveryAndError = 'PASS';
  await save();

} catch(error) {result.failures.push(error.stack);} finally {result.finishedAt=new Date().toISOString(); await save(); console.log(JSON.stringify({stages:result.stages,failures:result.failures})); process.exitCode=result.failures.length?1:0;}
