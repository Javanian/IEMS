import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { submitLocalMail } from '../../apps/portfolio-api/src/automation-transport.mjs';

const credential = { httpHeaderAuth: { id: 'iems-service-api', name: 'IEMS scoped automation service' } };
const api = 'http://127.0.0.1:4319/api/cs/automation';
const node = (name, type, version, parameters, x, y = 240, extra = {}) => ({ id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'), name, type: `n8n-nodes-base.${type}`, typeVersion: version, position: [x, y], parameters, ...extra });
const webhook = (path, x = 160) => node('Operator trigger', 'webhook', 2, { httpMethod: 'POST', path, authentication: 'headerAuth', responseMode: 'lastNode', options: {} }, x, 100, { webhookId: path, credentials: { httpHeaderAuth: { id: 'iems-webhook-auth', name: 'IEMS private webhook' } } });
const schedule = (name, interval) => node(name, 'scheduleTrigger', 1.2, { rule: { interval: [interval] } }, 160, 380);
const http = (name, path, method, body, key, x) => node(name, 'httpRequest', 4.2, {
  method, url: path.startsWith('=') ? path : api + path, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
  sendHeaders: true, headerParameters: { parameters: [{ name: 'Origin', value: 'http://127.0.0.1:5187' }, { name: 'Content-Type', value: 'application/json' }, { name: 'X-IEMS-Execution-Id', value: '={{ $execution.id }}' }, ...(key ? [{ name: 'Idempotency-Key', value: key }] : [])] },
  ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: body } : {}), options: { timeout: 15000 }
}, x, 240, { credentials: credential });
const split = (field, x) => node('One item per record', 'splitOut', 1, { fieldToSplitOut: field, options: {} }, x);
const result = x => node('Execution reference', 'set', 3.4, { mode: 'raw', jsonOutput: '={{ { n8nExecutionId: $execution.id, result: $json.data || $json } }}', options: {} }, x);
const make = (id, name, nodes, edges, error = true) => ({ id, name, active: false, nodes, connections: Object.fromEntries(edges.map(([from, to]) => [from, { main: [[{ node: to, type: 'main', index: 0 }]] }])), settings: { executionOrder: 'v1', timezone: 'Asia/Bangkok', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', ...(error ? { errorWorkflow: 'wf-automation-error' } : {}) }, pinData: {}, tags: [] });
const sla = make('wf-sla-escalation', 'IEMS - Unassigned ticket SLA escalation', [
  webhook('iems-sla-escalation'), schedule('SLA schedule', { field: 'minutes', minutesInterval: 1 }),
  http('Read due tickets', '/sla-breaches?limit=100', 'GET', null, null, 420),
  node('Due tickets exist', 'if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'has-due-tickets', leftValue: '={{ $json.data.items.length > 0 }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }, 560), split('data.items', 720),
  http('Escalate eligible ticket', '/escalate', 'POST', '={{ { ticketId: $json.ticketId, expectedVersion: $json.expectedVersion, reason: "Unassigned ticket exceeded its configured SLA" } }}', '={{ $json.occurrenceKey }}', 900), result(1140)
], [['Operator trigger', 'Read due tickets'], ['SLA schedule', 'Read due tickets'], ['Read due tickets', 'Due tickets exist'], ['One item per record', 'Escalate eligible ticket'], ['Escalate eligible ticket', 'Execution reference']]);
sla.connections['Due tickets exist'] = { main: [[{ node: 'One item per record', type: 'main', index: 0 }], [{ node: 'Execution reference', type: 'main', index: 0 }]] };
const digest = make('wf-cs-weekly-digest', 'IEMS - Weekly customer service digest', [
  webhook('iems-cs-weekly-digest'), schedule('Weekly Monday 08:00 Bangkok', { field: 'weeks', triggerAtDay: [1], triggerAtHour: 8, triggerAtMinute: 0 }),
  http('Create and dispatch authoritative digest', '/digest/dispatch', 'POST', '={{ { mode: $json.body ? "DEMO" : "WEEKLY", ...($json.body?.periodKey ? { periodKey: $json.body.periodKey } : {}) } }}', '={{ "digest:" + ($json.body ? "DEMO:" + ($json.body.periodKey || "missing-period-key") : "WEEKLY:" + $now.toUTC().startOf("week").toFormat("yyyy-MM-dd")) }}', 460), result(740)
], [['Operator trigger', 'Create and dispatch authoritative digest'], ['Weekly Monday 08:00 Bangkok', 'Create and dispatch authoritative digest'], ['Create and dispatch authoritative digest', 'Execution reference']]);
const resolution = make('wf-approved-resolution', 'IEMS - Approved resolution notification', [
  webhook('iems-approved-resolution'),
  http('Read approved draft', '={{ "'+api+'/resolution-drafts/" + $json.body.draftId }}', 'GET', null, null, 420),
  http('Dispatch approved immutable content', '={{ "'+api+'/resolution-drafts/" + $json.data._id + "/dispatch" }}', 'POST', '={}', '={{ "resolution:" + $json.data._id }}', 700), result(980)
], [['Operator trigger', 'Read approved draft'], ['Read approved draft', 'Dispatch approved immutable content'], ['Dispatch approved immutable content', 'Execution reference']]);
const recovery = make('wf-automation-recovery', 'IEMS - Durable delivery reconciliation', [
  webhook('iems-automation-recovery'), schedule('Recovery schedule', { field: 'minutes', minutesInterval: 1 }),
  http('Reconcile durable tasks', '/reconcile', 'POST', '={}', '={{ "recovery:" + $now.toUTC().startOf("minute").toFormat("yyyyMMddHHmm") }}', 460), result(740)
], [['Operator trigger', 'Reconcile durable tasks'], ['Recovery schedule', 'Reconcile durable tasks'], ['Reconcile durable tasks', 'Execution reference']]);
const errors = make('wf-automation-error', 'IEMS - Record sanitized engine failure', [
  node('Engine failure', 'errorTrigger', 1, {}, 160),
  http('Record failure reference', '/engine-error', 'POST', '={{ { executionId: String($json.execution?.id || "unknown"), workflowId: String($json.workflow?.id || "unknown"), message: "n8n execution failed; inspect the local execution reference" } }}', null, 460)
], [['Engine failure', 'Record failure reference']], false);
for (const workflow of [sla, digest, resolution, recovery, errors]) {
  if (workflow !== errors) addNativeBoundary(workflow);
  const hash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
  workflow.versionId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  writeFileSync(fileURLToPath(new URL(`./workflows/${workflow.id}.json`, import.meta.url)), JSON.stringify(workflow, null, 2) + '\n');
}

// The imported revision pins the SMTP endpoint; webhook payloads cannot select a transport.
function addNativeBoundary(workflow) {
  const input = node('IEMS_NATIVE_INPUT', 'code', 2, { jsCode: 'return $input.all();' }, 280);
  const branch = node('Native mail delivery', 'if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'native-mail', leftValue: '={{ !!$json.body?.iemsNative?.deliveryId }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }, 340);
  const normalize = node('Original operation input', 'code', 2, { jsCode: 'const request=$json;return [{json:request.body?.iemsNative?{...request,body:request.body.payload}:request}];' }, 380);
  const hashing = `const crypto=require('crypto');const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');`;
  const send = node('Native SMTP DATA', 'code', 2, { jsCode: `${hashing}
const net=require('net');
${submitLocalMail.toString()}
const {iemsNative:binding,payload}= $json.body;
if(hash(payload)!==binding.payloadHash||payload._id!==binding.deliveryId||payload.messageId!==binding.messageId||payload.tenantId!==binding.tenantId||payload.plantId!==binding.plantId)throw new Error('NATIVE_PAYLOAD_MISMATCH');
const receipt=await submitLocalMail(payload,{smtpPort:2527,timeoutMs:5000,native:{correlationId:binding.correlationId,bindingHash:hash(binding)}});
return [{json:{state:'ACCEPTED_LOCAL',smtpReceiptId:receipt.receiptId,messageId:payload.messageId}}];` }, 900, 100);
  const terminal = node('IEMS_NATIVE_RESULT', 'code', 2, { jsCode: `${hashing}
let binding;try{binding=$('IEMS_NATIVE_INPUT').first().json.body?.iemsNative;}catch{return $input.all();}
if(!binding)return $input.all();
const result=$json;
return [{json:{iemsNativeResult:{schema:'IEMS_NATIVE_N8N_RESULT_V1',bindingHash:hash(binding),state:'COMPLETED',resultHash:hash(result),smtpReceiptId:binding.deliveryId?result.smtpReceiptId:null}}}];` }, 1340);
  const first = workflow.connections['Operator trigger'].main[0][0].node;
  const edge = to => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
  workflow.nodes.push(input, branch, normalize, send, terminal);
  workflow.connections['Operator trigger'] = edge(input.name);
  workflow.connections[input.name] = edge(branch.name);
  workflow.connections[branch.name] = { main: [[{ node: send.name, type: 'main', index: 0 }], [{ node: normalize.name, type: 'main', index: 0 }]] };
  workflow.connections[normalize.name] = edge(first);
  workflow.connections[send.name] = edge(terminal.name);
  workflow.connections['Execution reference'] = edge(terminal.name);
}
