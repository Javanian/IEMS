import { randomUUID, createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { CommandError, contentHash } from '../tenant-foundation/commands.mjs';
import { effectHash, effectTransaction } from './effect-primitives.mjs';

const providers = new WeakSet(), observations = new WeakMap();
const fail = (code, status = 409) => { throw new CommandError(code, status); };
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const exact = (value, fields) => value && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const inputFields = ['workflowId', 'workflowHash', 'sourceHash', 'approvalHash', 'payloadHash', 'recipientHash', 'contentHash', 'deliveryId', 'messageId'];
export const isNativeN8nProvider = value => providers.has(value);

function nativeHash(value) {
  const ancestors = new Set(); let nodes = 0;
  function canonical(item, depth = 0) {
    if (++nodes > 1000000 || depth > 64) fail('NATIVE_HISTORY_TOO_COMPLEX');
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || ancestors.has(item)) fail('NATIVE_HISTORY_INVALID_JSON');
    ancestors.add(item);
    const result = Array.isArray(item) ? `[${item.map(child => canonical(child, depth + 1)).join(',')}]` :
      `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key], depth + 1)}`).join(',')}}`;
    ancestors.delete(item); return result;
  }
  return hash(canonical(value));
}

export function nativeN8nWorkflowHash(workflow) {
  if (!workflow || !id(workflow.id) || typeof workflow.name !== 'string' || !Array.isArray(workflow.nodes) ||
      !workflow.connections || !workflow.settings || Object.keys(workflow.pinData ?? {}).length || Object.keys(workflow.staticData ?? {}).length)
    fail('NATIVE_WORKFLOW_SNAPSHOT_INVALID');
  // n8n stores both the initial five-field projection and the final full workflow; timestamps are not revision identity.
  return nativeHash({ id: workflow.id, name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings });
}

export function nativeN8nBinding(attempt, { providerId, instanceId }) {
  if (!attempt || !inputFields.every(k => Object.hasOwn(attempt.input ?? {}, k)) || !exact(attempt.input, inputFields) ||
      !['tenantId', 'plantId', 'legalEntityId', 'commandId', '_id', 'instanceEpoch'].every(k => uuid(attempt[k])) ||
      !id(attempt.phase) || !id(attempt.adapterId) || !id(providerId) || !uuid(instanceId) ||
      !Number.isSafeInteger(attempt.ordinal) || attempt.ordinal < 1 || !Number.isSafeInteger(attempt.fence) || attempt.fence < 1 ||
      !Number.isSafeInteger(attempt.epoch) || attempt.epoch < 0 || !id(attempt.input.workflowId) ||
      !['workflowHash', 'sourceHash', 'approvalHash', 'payloadHash', 'recipientHash', 'contentHash'].every(k => digest(attempt.input[k])) ||
      !(attempt.input.deliveryId === null || id(attempt.input.deliveryId)) ||
      !(attempt.input.messageId === null || /^<[A-Za-z0-9_.:-]+@iems\.local>$/.test(attempt.input.messageId)) ||
      ((attempt.input.deliveryId === null) !== (attempt.input.messageId === null)) ||
      attempt.inputHash !== effectHash(attempt.input) ||
      attempt.providerKey !== contentHash({ tenantId: attempt.tenantId, commandId: attempt.commandId, phase: attempt.phase, ordinal: attempt.ordinal })) fail('NATIVE_BINDING_INVALID');
  return freeze({ schema: 'IEMS_NATIVE_N8N_BINDING_V1', providerId, instanceId,
    tenantId: attempt.tenantId, plantId: attempt.plantId, legalEntityId: attempt.legalEntityId,
    commandId: attempt.commandId, attemptId: attempt._id, phase: attempt.phase, ordinal: attempt.ordinal,
    fence: attempt.fence, epoch: attempt.epoch, adapterId: attempt.adapterId, instanceEpoch: attempt.instanceEpoch,
    providerKey: attempt.providerKey, inputHash: attempt.inputHash, correlationId: attempt.providerKey, ...clone(attempt.input) });
}

// Diagnostic validation is deliberately unbranded; fixtures and HTTP callers cannot turn it into runtime evidence.
export function inspectNativeN8nHistory({ binding, workflow, executions, mail = [] }) {
  const unknown = reason => ({ state: 'UNKNOWN', reason });
  if (!binding || !workflow || !Array.isArray(executions) || !Array.isArray(mail)) return unknown('INVALID_HISTORY');
  const correlated = executions.filter(row => {
    const runs = row.data?.resultData?.runData?.[workflow.inputNode];
    return Array.isArray(runs) && runs.some(run => run.data?.main?.some(branch => branch?.some(item =>
      item.json?.body?.iemsNative?.correlationId === binding.correlationId)));
  });
  if (correlated.length !== 1) return unknown(correlated.length ? 'DUPLICATE_CORRELATION' : 'MISSING_HISTORY');
  const row = correlated[0], runs = row.data?.resultData?.runData;
  let workflowHash;
  try { workflowHash = nativeN8nWorkflowHash(row.workflowData); } catch { return unknown('INVALID_WORKFLOW_SNAPSHOT'); }
  const one = name => { const list = runs?.[name]; return list?.length === 1 && list[0].executionStatus === 'success' &&
    list[0].data?.main?.length === 1 && list[0].data.main[0]?.length === 1 ? list[0].data.main[0][0].json : null; };
  const request = one(workflow.inputNode)?.body, result = one(workflow.resultNode)?.iemsNativeResult;
  if (row.workflowId !== binding.workflowId || workflow.workflowId !== binding.workflowId || workflow.workflowHash !== binding.workflowHash ||
      workflowHash !== binding.workflowHash || row.workflowData?.id !== binding.workflowId ||
      contentHash(request?.iemsNative ?? null) !== contentHash(binding) || contentHash(request?.payload ?? null) !== binding.payloadHash)
    return unknown('BINDING_MISMATCH');
  if (!id(String(row.id)) || row.status !== 'success' || !row.finished || !row.stoppedAt || row.deletedAt || row.retryOf || row.retrySuccessId ||
      row.mode !== 'webhook' || row.data?.resultData?.error || row.data?.resultData?.lastNodeExecuted !== workflow.resultNode ||
      !exact(result, ['schema', 'bindingHash', 'state', 'resultHash', 'smtpReceiptId']) || result.schema !== 'IEMS_NATIVE_N8N_RESULT_V1' ||
      result.bindingHash !== contentHash(binding) || result.state !== 'COMPLETED' || !digest(result.resultHash) ||
      (binding.deliveryId === null ? result.smtpReceiptId !== null : !uuid(result.smtpReceiptId))) return unknown('NO_EXACT_TERMINAL_RESULT');
  let smtp = null;
  if (binding.deliveryId !== null) {
    const receipts = mail.filter(receipt => receipt.headers?.['x-iems-native-correlation'] === binding.correlationId);
    if (receipts.length !== 1) return unknown(receipts.length ? 'DUPLICATE_SMTP_RECEIPT' : 'MISSING_SMTP_RECEIPT');
    const receipt = receipts[0];
    if (!uuid(receipt.id) || receipt.id !== result.smtpReceiptId || !receipt.receivedAt || receipt.receiptStatus !== 'Accepted by local mail sink' ||
        receipt.headers?.['x-iems-native-binding'] !== contentHash(binding) || receipt.headers?.['message-id'] !== binding.messageId ||
        !Array.isArray(receipt.envelopeTo) || receipt.envelopeTo.length !== 1 || !/^[^<>\s@]+@iems\.local$/i.test(receipt.envelopeTo[0]) ||
        !/^[^<>\s@]+@iems\.local$/i.test(receipt.envelopeFrom ?? '') ||
        contentHash(receipt.envelopeTo) !== binding.recipientHash ||
        contentHash({ subject: receipt.subject, body: receipt.body }) !== binding.contentHash ||
        typeof receipt.raw !== 'string' || !receipt.raw.includes('\r\n\r\n')) return unknown('SMTP_BINDING_MISMATCH');
    smtp = { receiptId: receipt.id, receiptHash: contentHash(receipt), rawHash: hash(receipt.raw) };
  }
  return freeze({ state: 'TERMINAL', executionId: String(row.id), workflowId: row.workflowId,
    workflowHash: binding.workflowHash, executionHash: nativeHash(row), resultHash: result.resultHash,
    deliveryState: smtp ? 'ACCEPTED_LOCAL' : null, smtp });
}

export function verifiedNativeN8nObservation(value, attempt, provider) {
  const stored = observations.get(value);
  if (!stored || stored.provider !== provider || !providers.has(provider) ||
      contentHash(stored.binding) !== contentHash(nativeN8nBinding(attempt, provider))) fail('NATIVE_OBSERVATION_UNPROVEN');
  return stored.proof;
}

export async function createNativeN8nProvider({ client, db, ownedRunMarker, root, instanceId,
  id: providerId = 'native.n8n', n8nPackageRoot, workflows, webhookToken, evidenceClass = 'NATIVE_RUNTIME' }) {
  if (!uuid(ownedRunMarker) || !uuid(instanceId) || !id(providerId) || !/^portfolio_(owned|test)_/.test(db?.databaseName ?? '') ||
      db.client !== client || !await db.collection('ownedRun').findOne({ _id: ownedRunMarker })) fail('NATIVE_OWNERSHIP_REQUIRED', 503);
  if (!['NATIVE_RUNTIME', 'SYNTHETIC'].includes(evidenceClass)) fail('NATIVE_EVIDENCE_CLASS_INVALID', 503);
  if (!Array.isArray(workflows) || !workflows.length || !workflows.every(w => exact(w, ['workflowId', 'workflowHash', 'inputNode', 'resultNode', 'webhookUrl']) &&
      ['workflowId', 'inputNode', 'resultNode'].every(k => id(w[k])) && digest(w.workflowHash))) fail('NATIVE_WORKFLOW_CONFIGURATION', 503);
  const selected = new Map();
  for (const entry of workflows) {
    const url = new URL(entry.webhookUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith('/webhook/') || selected.has(entry.workflowId)) fail('NATIVE_LOOPBACK_REQUIRED', 503);
    selected.set(entry.workflowId, freeze(clone(entry)));
  }
  if (typeof webhookToken !== 'string' || webhookToken.length < 32) fail('NATIVE_WEBHOOK_TOKEN_REQUIRED', 503);
  const ownedRoot = await realpath(root), packageRoot = await realpath(n8nPackageRoot);
  const packageInfo = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  if (packageInfo.name !== 'n8n' || packageInfo.version !== '1.121.3') fail('NATIVE_VERSION_UNSUPPORTED', 503);
  const require = createRequire(resolve(packageRoot, 'package.json')), parse = require('flatted').parse;
  async function inside(relative) {
    const path = await realpath(resolve(ownedRoot, relative));
    if (!path.startsWith(ownedRoot + sep)) fail('NATIVE_ROOT_ESCAPE', 503);
    return path;
  }
  const descriptorPath = await inside('native-owner.json');
  const descriptor = { schema: 'IEMS_NATIVE_N8N_OWNER_V1', marker: ownedRunMarker, instanceId,
    databaseName: db.databaseName, n8nVersion: '1.121.3', evidenceClass };
  async function owner() {
    if (contentHash(JSON.parse(await readFile(descriptorPath, 'utf8'))) !== contentHash(descriptor) ||
        !await db.collection('ownedRun').findOne({ _id: ownedRunMarker })) fail('NATIVE_OWNERSHIP_CHANGED', 503);
  }
  await owner();
  const attempts = db.collection('saasEffectAttempts');
  const processEpoch = randomUUID();
  const provider = { id: providerId, providerId, instanceId, processEpoch, evidenceClass, mode: 'NATIVE_LOCAL_N8N',
    owns(otherClient, otherDb) { return client === otherClient && db === otherDb; },
    binding(attempt) {
      const binding = nativeN8nBinding(attempt, provider), workflow = selected.get(binding.workflowId);
      if (!workflow || workflow.workflowHash !== binding.workflowHash) fail('NATIVE_WORKFLOW_CHANGED');
      return binding;
    },
    async execute(attempt, payload, { authorize } = {}) {
      await owner();
      const binding = provider.binding(attempt);
      if (attempt.instanceEpoch !== processEpoch || typeof authorize !== 'function') fail('NATIVE_EXECUTION_CAPABILITY_REQUIRED');
      if (contentHash(payload) !== binding.payloadHash) fail('NATIVE_PAYLOAD_CHANGED');
      // The second durable claim fences even duplicate handler calls after BEGIN; neither restart nor ACK loss can reclaim it.
      await effectTransaction(client, async session => {
        await authorize(session);
        const tenant = await db.collection('tenants').findOneAndUpdate({ _id: attempt.tenantId, active: true,
          saasEffectDispatchOpen: { $ne: false }, ...(attempt.epoch === 0 ? { $or: [{ saasEffectEpoch: 0 }, { saasEffectEpoch: { $exists: false } }] } : { saasEffectEpoch: attempt.epoch }) },
        { $inc: { saasEffectFence: 1 } }, { session, returnDocument: 'after' });
        if (!tenant) fail('NATIVE_DISPATCH_STOPPED');
        const claimed = await attempts.updateOne({ _id: attempt._id, tenantId: attempt.tenantId, commandId: attempt.commandId,
          fence: attempt.fence, instanceEpoch: attempt.instanceEpoch, providerKey: attempt.providerKey, inputHash: attempt.inputHash,
          state: 'INVOKING', 'provider.state': 'BEGUN', 'provider.bindingHash': contentHash(binding), 'provider.dispatched': { $exists: false } },
        { $set: { 'provider.dispatched': true } }, { session });
        if (claimed.matchedCount !== 1) fail('NATIVE_DISPATCH_ALREADY_CLAIMED');
      });
      if (evidenceClass !== 'NATIVE_RUNTIME') fail('SYNTHETIC_NATIVE_IO_FORBIDDEN', 503);
      const response = await fetch(selected.get(binding.workflowId).webhookUrl, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-iems-webhook-token': webhookToken },
        body: JSON.stringify({ iemsNative: binding, payload }), signal: AbortSignal.timeout(30000) });
      await response.body?.cancel();
      if (!response.ok) fail('NATIVE_ACK_UNKNOWN');
      return { state: 'ACKNOWLEDGED', correlationId: binding.correlationId };
    },
    async observe(attempt) {
      await owner();
      if (evidenceClass !== 'NATIVE_RUNTIME') return null;
      const binding = provider.binding(attempt), row = await attempts.findOne({ _id: attempt._id, tenantId: attempt.tenantId,
        commandId: attempt.commandId, fence: attempt.fence, providerKey: attempt.providerKey, inputHash: attempt.inputHash,
        instanceEpoch: attempt.instanceEpoch, 'provider.bindingHash': contentHash(binding) });
      if (!row?.provider || !row.provider.dispatched) return null;
      let sqlite;
      try {
        const path = await inside('n8n-user/.n8n/database.sqlite');
        sqlite = new DatabaseSync(path, { readOnly: true });
        sqlite.exec('PRAGMA query_only = ON; BEGIN');
        const size = sqlite.prepare('SELECT COUNT(*) AS rows, COALESCE(SUM(COALESCE(length(CAST(d.data AS BLOB)),0)+COALESCE(length(CAST(d.workflowData AS BLOB)),0)),0) AS bytes FROM execution_entity e LEFT JOIN execution_data d ON d.executionId=e.id').get();
        if (size.rows > 10000 || size.bytes > 16 * 1024 * 1024) return null;
        const records = sqlite.prepare('SELECT e.id,e.workflowId,e.status,e.finished,e.mode,e.retryOf,e.retrySuccessId,e.stoppedAt,e.deletedAt,d.data,d.workflowData FROM execution_entity e LEFT JOIN execution_data d ON d.executionId=e.id ORDER BY e.id LIMIT 10001').all();
        if (records.length > 10000) return null;
        const executions = records.map(entry => ({ ...entry, data: parse(entry.data), workflowData: JSON.parse(entry.workflowData) }));
        let mail = [];
        if (binding.deliveryId !== null) {
          const mailPath = await inside('smtp/receipts.ndjson');
          if ((await stat(mailPath)).size > 16 * 1024 * 1024) return null;
          mail = (await readFile(mailPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
        }
        const result = inspectNativeN8nHistory({ binding, workflow: selected.get(binding.workflowId), executions, mail });
        if (result.state !== 'TERMINAL') return null;
        const proof = freeze({ mode: 'NATIVE_LOCAL_N8N', providerId, instanceId, bindingHash: contentHash(binding),
          receiptId: `n8n:${instanceId}:${result.executionId}`, result });
        const observation = Object.freeze({});
        observations.set(observation, { provider, binding, proof });
        return observation;
      } catch { return null; }
      finally { sqlite?.close(); }
    },
  };
  const frozen = Object.freeze(provider); providers.add(frozen); return frozen;
}
