import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { startOwned } from './support/owned-mongo.mjs';
import { initialize, createApp } from '../src/app.mjs';
import { contentHash } from '../../../packages/tenant-foundation/commands.mjs';
import { isNativeN8nProvider } from '../../../packages/tenant-lifecycle/native-n8n-provider.mjs';

process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
test('native composition is explicit and owned; existing simulation identity is unchanged', { timeout: 120000 }, async t => {
  const h = await startOwned(t), marker = (await h.db.collection('ownedRun').findOne({}))._id, instanceId = randomUUID();
  const parent = resolve(process.env.IEMS_NATIVE_TEST_ROOT ?? tmpdir()); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'native-composition-'));
  const descriptor = { schema: 'IEMS_NATIVE_N8N_OWNER_V1', marker, instanceId, databaseName: h.db.databaseName, n8nVersion: '1.121.3', evidenceClass: 'SYNTHETIC' };
  await writeFile(join(root, 'native-owner.json'), JSON.stringify(descriptor));
  t.after(async () => { assert.ok(root.startsWith(parent + sep)); assert.deepEqual(JSON.parse(await readFile(join(root, 'native-owner.json'), 'utf8')), descriptor); await rm(root, { recursive: true }); });
  const options = { client: h.client, db: h.db, ownedRunMarker: marker };
  const local = await initialize({ ...options, integrations: { effects: { mode: 'LOCAL_SIMULATED' } } });
  for (const id of ['local.engine', 'local.cs', 'local.ai-index', 'local.vendor']) assert.equal(local.separateEffects.hasAdapter(id), true);
  assert.equal(local.separateEffects.hasAdapter('native.n8n'), false);
  const localServer=createApp(local,{origins:['http://localhost:4173']}).listen(0,'127.0.0.1');await new Promise(r=>localServer.once('listening',r));
  try{
    const response=await fetch(`http://127.0.0.1:${localServer.address().port}/api/cs/automation/service-credentials`,{method:'POST',headers:{origin:'http://localhost:4173','content-type':'application/json',cookie:h.alpha,'Idempotency-Key':randomUUID()},body:JSON.stringify({label:'Unchanged simulated service',ttlMinutes:30})});assert.equal(response.status,201);
    const issued=(await response.json()).data;assert.deepEqual(issued.grants,['cs.automation.read','cs.automation.execute']);assert.equal((await h.db.collection('memberships').findOne({_id:issued.membershipId})).roles[0].role,'automationService');
  }finally{await new Promise(r=>localServer.close(r));}
  const nativeN8n = { root, instanceId, evidenceClass: 'SYNTHETIC', webhookToken: randomUUID(),
    n8nPackageRoot: process.env.IEMS_N8N_PACKAGE_ROOT ?? 'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n',
    workflows: [{ workflowId: 'fixture', workflowHash: contentHash('fixture'), inputNode: 'IEMS_NATIVE_INPUT', resultNode: 'IEMS_NATIVE_RESULT', webhookUrl: 'http://127.0.0.1:32743/webhook/not-called' }] };
  const native = await initialize({ ...options, integrations: { effects: { mode: 'NATIVE_LOCAL_N8N', nativeN8n } } });
  createApp(native,{origins:['http://localhost:4173']});
  assert.ok(isNativeN8nProvider(native.nativeN8nProvider)); assert.equal(native.nativeN8nProvider.evidenceClass, 'SYNTHETIC');
  assert.equal(native.separateEffects.hasAdapter('native.n8n'), true); assert.equal(native.separateEffects.hasAdapter('local.engine'), false);
  assert.equal(native.separateEffects.hasAdapter('local.automation-recovery'), true);
  assert.equal(native.separateEffects.hasAdapter('local.cs'), false);
  assert.equal(native.separateEffects.supports('automation.native-engine'), true);
  assert.equal(native.separateEffects.supports('automation.native-delivery'), true);
  assert.equal(native.separateEffects.supports('automation.recovery'), true);
  assert.equal(native.separateEffects.supports('automation.engine'), false);
  assert.equal(native.separateEffects.supports('automation.local-delivery'), false);
  await assert.rejects(initialize({ ...options, integrations: { effects: { mode: 'NATIVE_UNVERIFIED' } } }), { code: 'EFFECT_LOCAL_OWNED_DATABASE_REQUIRED' });
  await assert.rejects(initialize({ ...options, ownedRunMarker: randomUUID(), integrations: { effects: { mode: 'NATIVE_LOCAL_N8N', nativeN8n } } }), { code: 'NATIVE_OWNERSHIP_REQUIRED' });
});
