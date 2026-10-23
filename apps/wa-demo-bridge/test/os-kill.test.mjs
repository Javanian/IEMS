import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createCustomerService, SIMULATED_CHANNEL_ACCOUNT } from '../../../packages/customer-service/index.mjs';
import { createTenantFoundation } from '../../../packages/tenant-foundation/index.mjs';

const worker = fileURLToPath(new URL('./support/crash-worker.mjs', import.meta.url));
const run = randomUUID().replaceAll('-', '');
const name = `iems_wa_bridge_owned_kill_${run}`, marker = randomUUID();
const tenantId = randomUUID(), legalEntityId = randomUUID(), plantId = randomUUID();
let replica, client, db, cs, foundation, scope;
const children = new Set();
const evidence = [];

function identity(pid) {
  if (process.platform !== 'win32') return String(pid);
  const query = `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,CommandLine,@{Name='Created';Expression={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress`;
  const info = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8' }));
  assert.equal(info.ProcessId, pid); assert.ok(Number.isFinite(Date.parse(info.Created)));
  assert.ok(info.CommandLine.includes(worker));
  return info.Created;
}
async function invoke(input, kill = false) {
  const env = { ...process.env, OWNED_CRASH_CONFIG: JSON.stringify({ uri: replica.getUri(), name, marker, tenantId, ...input }) };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(worker, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.add(child);
  let stderr = ''; child.stderr.on('data', d => stderr += d);
  const exited = once(child, 'exit');
  const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 30000);
  try {
    const message = await Promise.race([once(child, 'message').then(([m]) => m), exited.then(([code, signal]) => { throw new Error(`Worker premature exit ${code}/${signal}: ${stderr}`); })]);
    assert.equal(message.pid, child.pid);
    if (kill) {
      assert.equal(message.barrier, input.boundary);
      const created = identity(child.pid); assert.equal(identity(child.pid), created);
      assert.equal(child.kill('SIGKILL'), true);
      const [code, signal] = await exited;
      assert.ok(code !== 0 || signal === 'SIGKILL');
      evidence.push({ boundary: input.boundary, eventId: input.eventId, pid: child.pid, created, code, signal });
      return;
    }
    assert.ok(Object.hasOwn(message, 'result'));
    assert.deepEqual(await exited, [0, null], stderr);
    return message.result;
  } finally { clearTimeout(timer); children.delete(child); }
}

test.before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  client = await new MongoClient(replica.getUri()).connect(); db = client.db(name);
  await client.db('admin').command({ setParameter: 1, transactionLifetimeLimitSeconds: 3 });
  await db.collection('ownedRun').insertOne({ _id: marker });
  foundation = createTenantFoundation({ client, db, roleActions: { admin: ['cs.fixture.admin', 'cs.delivery.review'] } });
  await foundation.initialize();
  await foundation.provisionTenant({ id: tenantId });
  await foundation.provisionLegalEntity({ id: legalEntityId, tenantId });
  await foundation.provisionPlant({ id: plantId, tenantId, legalEntityId });
  const userId = randomUUID(); await foundation.provisionUser({ id: userId, tenantId });
  await foundation.provisionMembership({ id: randomUUID(), tenantId, userId, legalEntityIds: [legalEntityId], plantIds: [plantId], roles: [{ role: 'admin', plantIds: [plantId] }] });
  scope = await foundation.authenticate((await foundation.issueSession({ userId, tenantId, selectedPlantId: plantId, ttlMs: 3600000 })).token);
  cs = createCustomerService({ client, db, foundation, allowSyntheticOrders: true, previewDispatcher: true }); await cs.initialize();
});
test.after(async () => {
  for (const child of children) { child.kill('SIGKILL'); await once(child, 'exit'); }
  if (db) { assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); }
  await client?.close(); await replica?.stop();
  console.log(`OS-KILL-EVIDENCE ${JSON.stringify({ run, name, barriers: evidence, cleanup: 'owned database dropped; owned replica stopped; children exited' })}`);
});
async function fixture(contact) {
  const customerId = randomUUID(), bindingId = randomUUID();
  await cs.provisionFixtureCustomer(scope, { plantId, customerId, label: 'Synthetic kill fixture' });
  await cs.bindContact(scope, { plantId, customerId, bindingId, channelAccountId: SIMULATED_CHANNEL_ACCOUNT, providerContactId: contact });
  return bindingId;
}
for (const boundary of ['domain', 'pointer', 'result', 'afterCommit']) {
  test(`R13-04 OS SIGKILL at ${boundary}, fresh process/client replay preserves receipt and exact steps`, async () => {
    const contact = `contact-${boundary}`, bindingId = await fixture(contact);
    let receipt;
    const steps = ['IEMS COMPLAINT', 'IEMS COMPLAINT GENERAL', 'IEMS COMPLAINT CATEGORY QUALITY', 'IEMS COMPLAINT DESCRIBE OS kill complaint.', 'IEMS COMPLAINT CONFIRM'];
    for (const [i, text] of steps.entries()) {
      const input = { contact, eventId: `${run}-${boundary}-${i}`, text };
      await invoke({ ...input, boundary }, true);
      const storedBeforeRestart = await db.collection('cs_idempotency').findOne({ tenantId, scope: 'inbound.command', owner: bindingId, key: input.eventId });
      const first = await invoke(input);
      assert.equal(first.error, undefined);
      assert.deepEqual(await invoke(input), first);
      if (i < 4) assert.equal(first.draft.stage, ['ORDER_SELECTION', 'CATEGORY', 'DESCRIPTION', 'PREVIEW'][i]);
      else receipt = first.receipt;
      if (boundary === 'afterCommit') {
        assert.ok(storedBeforeRestart, 'original committed result exists before restart');
        assert.deepEqual(JSON.parse(JSON.stringify(storedBeforeRestart.result)), first, 'fresh process returns the exact original committed result');
      }
      assert.equal(await db.collection('cs_inbound').countDocuments({ tenantId, bindingId, inboundKey: input.eventId }), 1);
    }
    const tickets = await db.collection('cs_tickets').find({ tenantId, bindingId }).toArray();
    assert.equal(tickets.length, 1); assert.equal(tickets[0]._id, receipt.ticketId); assert.equal(tickets[0].ticketNumber, receipt.ticketNumber);
    const draft = await db.collection('cs_complaint_drafts').findOne({ _id: tickets[0].draftId }); assert.equal(draft.version, 5);
    assert.equal(await db.collection('cs_outbox').countDocuments({ actionKey: `ticket-ack:${receipt.ticketId}` }), 1);
    assert.equal(await db.collection('cs_outbox').countDocuments({ tenantId, bindingId }), 5);
    assert.equal((await db.collection('cs_conversations').findOne({ tenantId, bindingId })).activeDraftId, null);
    await db.collection('cs_outbox').updateMany({ tenantId, bindingId }, { $set: { state: 'CANCELLED' } });
  });
}
test('OS SIGKILL after preview insertion leaves UNKNOWN/manual recovery and blocks blind resend', async () => {
  const contact = 'contact-preview', bindingId = await fixture(contact);
  const first = await invoke({ contact, eventId: `${run}-preview`, text: 'IEMS MENU' });
  const deliveryId = first.reply.deliveryId;
  await invoke({ dispatch: true, boundary: 'previewInserted' }, true);
  assert.equal((await db.collection('cs_previews').findOne({ deliveryId })).state, 'PREVIEWED');
  assert.equal((await db.collection('cs_outbox').findOne({ _id: deliveryId })).state, 'SENDING');
  await invoke({ contact, eventId: `${run}-next`, text: 'IEMS MENU' });
  for (let i = 0; i < 3; i++) assert.equal(await invoke({ dispatch: true, offset: 120000 }), null);
  const rows = await db.collection('cs_outbox').find({ tenantId, bindingId }).sort({ seq: 1 }).toArray();
  assert.deepEqual(rows.map(r => [r.state, r.attempt]), [['UNKNOWN', 1], ['QUEUED', 0]]);
  assert.equal(await db.collection('cs_previews').countDocuments({ deliveryId }), 1);
  assert.equal(await db.collection('cs_outbox').countDocuments({ state: 'SENT' }), 0);
  const reviewed = await cs.resolveUnknownDelivery(scope, { plantId, deliveryId, resolution: 'ABANDON', evidence: 'Owned synthetic OS-kill test: local preview exists; no provider invoked.', commandKey: `${run}-review` });
  assert.equal(reviewed.state, 'CANCELLED');
  assert.ok(await invoke({ dispatch: true, offset: 120000 }));
  assert.equal(await db.collection('cs_previews').countDocuments({ deliveryId }), 1);
});
