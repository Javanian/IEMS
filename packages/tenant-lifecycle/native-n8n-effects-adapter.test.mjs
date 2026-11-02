import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { MongoMemoryReplSet } from '../../apps/portfolio-api/node_modules/mongodb-memory-server/index.js';
import { MongoClient } from '../../apps/portfolio-api/node_modules/mongodb/lib/index.js';
import { CommandError, contentHash } from '../tenant-foundation/commands.mjs';
import { createSeparateEffects, effectTransaction, effectHash } from './effects.mjs';
import { createNativeN8nProvider, verifiedNativeN8nObservation } from './native-n8n-provider.mjs';
import { createNativeN8nEffectsAdapter } from './native-n8n-effects-adapter.mjs';

process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
test('owned Mongo native contract fixture: BEGIN, fencing, restart and stop without manufactured native proof', { timeout: 120000 }, async t => {
  const parent = resolve(process.env.IEMS_NATIVE_TEST_ROOT ?? tmpdir());
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'native-contract-')), marker = randomUUID(), instanceId = randomUUID();
  const repl = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
    replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect(), db = client.db(`portfolio_test_native_${randomUUID().replaceAll('-', '')}`);
  await db.collection('ownedRun').insertOne({ _id: marker });
  const resource = repl.servers.map(server => ({ pid: server.instanceInfo.instance.mongodProcess.pid,
    port: server.instanceInfo.port, dataDirectory: server.instanceInfo.dbPath,
    command: server.instanceInfo.instance.mongodProcess.spawnargs, observedAt: new Date().toISOString() }));
  console.log(JSON.stringify({ fixture: 'SYNTHETIC_NO_NATIVE_IO', marker, database: db.databaseName, resource }));
  const descriptor = { schema: 'IEMS_NATIVE_N8N_OWNER_V1', marker, instanceId, databaseName: db.databaseName, n8nVersion: '1.121.3', evidenceClass: 'SYNTHETIC' };
  await writeFile(join(root, 'native-owner.json'), JSON.stringify(descriptor));
  t.after(async () => {
    assert.ok(await db.collection('ownedRun').findOne({ _id: marker }));
    await db.dropDatabase(); await client.close(); await repl.stop();
    assert.ok(root.startsWith(parent + sep)); assert.deepEqual(JSON.parse(await readFile(join(root, 'native-owner.json'), 'utf8')), descriptor);
    await rm(root, { recursive: true });
    console.log(JSON.stringify({ fixture: 'SYNTHETIC_NO_NATIVE_IO', marker, database: db.databaseName, cleanup: 'marker-checked drop, client close, normal replica stop, owned root removed' }));
  });
  const payload = { selection: randomUUID() }, workflowHash = contentHash({ fixture: true });
  const config = { client, db, root, ownedRunMarker: marker, instanceId, evidenceClass: 'SYNTHETIC',
    n8nPackageRoot: process.env.IEMS_N8N_PACKAGE_ROOT ?? 'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n',
    webhookToken: randomUUID(), workflows: [{ workflowId: 'fixture-workflow', workflowHash, inputNode: 'IEMS_NATIVE_INPUT', resultNode: 'IEMS_NATIVE_RESULT', webhookUrl: 'http://127.0.0.1:32743/webhook/fixture-never-called' }] };
  const provider = await createNativeN8nProvider(config), adapter = createNativeN8nEffectsAdapter({ client, db, provider });
  const scope = { tenantId: randomUUID(), plantId: randomUUID(), legalEntityId: randomUUID(), userId: randomUUID(), membershipId: randomUUID() };
  await db.collection('tenants').insertOne({ _id: scope.tenantId, active: true });
  const input = { workflowId: 'fixture-workflow', workflowHash, sourceHash: contentHash('source'), approvalHash: contentHash('approval'),
    recipientHash: contentHash([]), contentHash: contentHash('no email'), payloadHash: contentHash(payload), deliveryId: null, messageId: null };
  let calls = 0, authorized = true, published = 0, duringWork = null;
  const origin = { authorize: async () => { if (!authorized) throw new CommandError('SYNTHETIC_REVOKED', 403); return scope; } };
  function component(selectedAdapter) {
    const effects = createSeparateEffects({ client, db, foundation: {} }); effects.registerAdapter(selectedAdapter);
    effects.registerKind('automation.native-engine', { adapterId: selectedAdapter.id, prepare: async () => input,
      invoke: async ({ attempt }) => { calls++; assert.ok(await db.collection('saasEffectAttempts').findOne({ _id: attempt._id, 'provider.state': 'BEGUN' })); await duringWork?.(); return payload; },
      publish: async () => { published++; return { state: 'PUBLISHED' }; } });
    return effects;
  }
  const effects = component(adapter); await effects.initialize();
  async function accept(key = randomUUID()) {
    return effectTransaction(client, async session => {
      const owner = { namespace: 'automation_audit_logs', identity: { tenantId: scope.tenantId, idempotencyKey: key }, hashField: 'payloadHash', payloadHash: contentHash(payload) };
      const command = await effects.accept({ session, grant: scope, actor: { type: 'USER', userId: scope.userId, membershipId: scope.membershipId }, owner,
        kind: 'automation.native-engine', plan: { native: { providerId: provider.id, instanceId, workflowId: input.workflowId, workflowHash } }, accepted: { state: 'ACCEPTED' }, origin });
      await db.collection('automation_audit_logs').updateOne(owner.identity, { $setOnInsert: { ...owner.identity, payloadHash: owner.payloadHash } }, { session, upsert: true });
      return command._id;
    });
  }
  await t.test('factory composition rejects forged adapters, wrong owner, wrong database and remote endpoint', async () => {
    assert.throws(() => effects.registerAdapter({ ...adapter }), { code: 'EFFECT_ADAPTER_UNPROVEN' });
    assert.throws(() => createNativeN8nEffectsAdapter({ client, db, provider: { ...provider } }), { code: 'NATIVE_ADAPTER_CONFIGURATION' });
    await assert.rejects(createNativeN8nProvider({ ...config, ownedRunMarker: randomUUID() }), { code: 'NATIVE_OWNERSHIP_REQUIRED' });
    await assert.rejects(createNativeN8nProvider({ ...config, evidenceClass: 'NATIVE_RUNTIME' }), { code: 'NATIVE_OWNERSHIP_CHANGED' });
    await assert.rejects(createNativeN8nProvider({ ...config, db: client.db('foreign') }), { code: 'NATIVE_OWNERSHIP_REQUIRED' });
    await assert.rejects(createNativeN8nProvider({ ...config, workflows: [{ ...config.workflows[0], webhookUrl: 'https://example.com/webhook/x' }] }), { code: 'NATIVE_LOOPBACK_REQUIRED' });
  });
  let unknown;
  await t.test('duplicate root and racing claims produce one BEGIN and never trust handler result', async () => {
    const key = randomUUID(), commandId = await accept(key); assert.equal(await accept(key), commandId);
    const claims = await Promise.all([effects.claim(commandId), effects.claim(commandId)]), before = calls;
    const results = await Promise.allSettled(claims.map(claim => effects.invoke(claim.capability)));
    assert.ok(results.every(result => result.status === 'rejected')); assert.equal(calls, before + 1);
    assert.equal(await db.collection('saasEffectCommands').countDocuments({ _id: commandId }), 1);
    assert.equal(await db.collection('saasEffectEvents').countDocuments({ commandId, kind: 'NATIVE_PROVIDER_BEGUN' }), 1);
    unknown = await db.collection('saasEffectAttempts').findOne({ commandId });
    assert.equal(unknown.state, 'UNKNOWN'); assert.equal(unknown.provider.state, 'UNKNOWN');
    assert.equal(unknown.provider.dispatched, true);
    await assert.rejects(provider.execute(unknown, payload, { authorize: async () => {} }), { code: 'NATIVE_DISPATCH_ALREADY_CLAIMED' });
    assert.equal(await provider.observe(unknown), null); assert.equal(published, 0);
    assert.throws(() => verifiedNativeN8nObservation({ state: 'TERMINAL' }, unknown, provider), { code: 'NATIVE_OBSERVATION_UNPROVEN' });
    await assert.rejects(effectTransaction(client, session => adapter.reconcile(unknown, { state: 'TERMINAL' }, { session })), { code: 'NATIVE_OBSERVATION_UNPROVEN' });
    const replay = await effects.claim(commandId); assert.equal(replay.claimed, false);
    await assert.rejects(effects.settle(replay.capability), { code: 'EFFECT_OUTCOME_UNKNOWN' }); assert.equal(calls, before + 1);
  });
  await t.test('wrong attempt, key, input hash, scope, workflow, instance and fence reject observations', async () => {
    for (const [key, value] of [['tenantId', randomUUID()], ['plantId', randomUUID()], ['legalEntityId', randomUUID()], ['providerKey', contentHash('foreign')],
      ['inputHash', contentHash('foreign')], ['instanceEpoch', randomUUID()], ['fence', 99], ['_id', randomUUID()]]) {
      await assert.rejects(adapter.observe({ ...unknown, [key]: value }));
    }
    const wrong = { ...unknown, input: { ...unknown.input, workflowId: 'wrong' } }; wrong.inputHash = effectHash(wrong.input);
    await assert.rejects(adapter.observe(wrong), { code: 'NATIVE_WORKFLOW_CHANGED' });
  });
  await t.test('restart sees original unknown attempt and cannot invoke it or authorize drain', async () => {
    const restartedProvider = await createNativeN8nProvider(config), restartedAdapter = createNativeN8nEffectsAdapter({ client, db, provider: restartedProvider });
    assert.notEqual(restartedAdapter.instanceEpoch, adapter.instanceEpoch);
    assert.deepEqual(await restartedAdapter.observe(unknown), { state: 'UNKNOWN' });
    await assert.rejects(restartedAdapter.invoke(unknown, async () => payload, { authorize: async () => {} }), { code: 'NATIVE_INVOKE_CAPABILITY_REQUIRED' });
    assert.equal(await restartedProvider.observe(unknown), null);
    const restarted = component(restartedAdapter); restarted.bind(unknown.commandId, origin);
    const claim = await restarted.claim(unknown.commandId); assert.equal(claim.claimed, false);
    await assert.rejects(restarted.settle(claim.capability), { code: 'EFFECT_OUTCOME_UNKNOWN' });
  });
  await t.test('revocation before BEGIN blocks work and publication without inventing a receipt', async () => {
    const id = await accept(), claim = await effects.claim(id), before = calls; authorized = false;
    await assert.rejects(effects.invoke(claim.capability), { code: 'SYNTHETIC_REVOKED' }); authorized = true;
    assert.equal((await db.collection('saasEffectAttempts').findOne({ commandId: id })).provider, undefined);
    assert.equal(calls, before); assert.equal(published, 0);
  });
  await t.test('source or authority revoked after BEGIN blocks dispatch and retains ambiguous original attempt', async () => {
    const id = await accept(), claim = await effects.claim(id);
    duringWork = async () => { authorized = false; };
    await assert.rejects(effects.invoke(claim.capability), { code: 'SYNTHETIC_REVOKED' });
    duringWork = null; authorized = true;
    const row = await db.collection('saasEffectAttempts').findOne({ commandId: id });
    assert.equal(row.provider.state, 'UNKNOWN'); assert.equal(row.provider.dispatched, undefined);
    assert.equal(row.providerKey, claim.attempt.providerKey); assert.equal(published, 0);
    await assert.rejects(effects.settle(claim.capability), { code: 'EFFECT_OUTCOME_UNKNOWN' });
  });
  await t.test('stop gate is required; original before-BEGIN fence cancels, begun ambiguity remains PENDING', async () => {
    const id = await accept(), claim = await effects.claim(id);
    const delayedId = await accept(), delayed = await effects.claim(delayedId);
    let release; duringWork = () => new Promise(done => { release = done; });
    const invoking = effects.invoke(delayed.capability).catch(error => error);
    for (let n = 0; n < 100 && !release; n++) await new Promise(done => setTimeout(done, 5));
    assert.equal(typeof release, 'function');
    await assert.rejects(adapter.stopAndDrain({ tenantId: scope.tenantId, stopEpoch: 1 }), { code: 'NATIVE_STOP_GATE_REQUIRED' });
    await effectTransaction(client, session => effects.closeInSession({ tenantId: scope.tenantId, session }));
    const drained = await effects.stopAndDrain(scope.tenantId); assert.equal(drained.state, 'PENDING');
    release(); duringWork = null; assert.ok((await invoking).code);
    const delayedRow = await db.collection('saasEffectAttempts').findOne({ commandId: delayedId });
    assert.equal(delayedRow.provider.state, 'UNKNOWN'); assert.equal(delayedRow.provider.dispatched, undefined);
    const cancelled = await db.collection('saasEffectAttempts').findOne({ commandId: id });
    assert.equal(cancelled.state, 'NOT_PERFORMED'); assert.equal(cancelled.fence, claim.attempt.fence); assert.equal(cancelled.provider, undefined);
    assert.equal((await db.collection('saasEffectAttempts').findOne({ _id: unknown._id })).provider.state, 'UNKNOWN');
    assert.equal(await adapter.verifyBarrier({ tenantId: scope.tenantId, stopEpoch: 1 }), false);
    await assert.rejects(effects.invoke(claim.capability));
    await assert.rejects(effectTransaction(client, session => effects.openInSession({ tenantId: scope.tenantId, session })), { code: 'EFFECT_QUIESCENCE_PENDING' });
  });
  await t.test('empty closed tenant obtains exact barrier; high-water/epoch drift invalidates it', async () => {
    const tenantId = randomUUID(); await db.collection('tenants').insertOne({ _id: tenantId, active: true, saasEffectDispatchOpen: false, saasEffectEpoch: 3 });
    assert.equal((await adapter.stopAndDrain({ tenantId, stopEpoch: 3 })).state, 'QUIESCENT');
    assert.equal(await adapter.verifyBarrier({ tenantId, stopEpoch: 3 }), true);
    assert.equal(await adapter.verifyBarrier({ tenantId, stopEpoch: 4 }), false);
    await db.collection('tenants').updateOne({ _id: tenantId }, { $inc: { saasEffectHighWater: 1 } });
    assert.equal(await adapter.verifyBarrier({ tenantId, stopEpoch: 3 }), false);
  });
  const rows = await db.collection('saasEffectEvents').find({}).toArray();
  assert.ok(!JSON.stringify(rows).includes(config.webhookToken)); assert.equal(published, 0);
});
