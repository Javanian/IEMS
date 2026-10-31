import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { contentHash } from '../tenant-foundation/commands.mjs';
import { effectHash } from './effects.mjs';
import { admissionProfile } from './admission.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';

test('v15 mounted controlled indexing original publication and asynchronous provider phases', { timeout: 180000 }, async t => {
  const cleanup = []; let lost = false, hold = null, started = 0;
  const h = await startOwned({ after: fn => cleanup.push(fn) }, { integrations: { effects: { mode: 'LOCAL_SIMULATED', ai: { fault: async (boundary, proof) => {
    if (boundary === 'afterProviderBegin') { started++; if (hold) await hold.promise; }
    if (boundary === 'afterProviderReceipt' && lost) { lost = false; throw Error('Owned native index ACK lost'); }
  } } } } });
  t.after(async () => { try { await h.runtime.localAiProvider.dispose(); } finally { for (const fn of cleanup) await fn(); } });
  const { db } = h, a = h.seeded[0], provider = h.runtime.localAiProvider, native = h.client.db(provider.evidence().providerDatabase);
  await db.collection('memberships').updateOne({ _id: a.membershipId }, { $set: { tenantWide: true, roles: ['owner', 'aiDocumentAdmin', 'saasUser'].map(role => ({ role, plantIds: [a.plantId], tenantWide: false })).concat({ role: 'saasOperator', plantIds: [], tenantWide: true }) } });
  const resourceId = randomUUID();
  await h.ok(`/ai/documents/${resourceId}/publish`, { key: randomUUID(), expectedRevision: 0, title: 'Owned managed index', text: 'Owned async source evidence', allowedUserIds: [a.userId] });
  await h.ok('/saas/subscribe', { key: randomUUID(), expectedRevision: 0, reason: 'Owned controlled indexing', plan: 'pilot', admissionProfile });
  const accept = async (expectedRevision, key = randomUUID(), operation = 'rebuild') => {
    const result = await h.send(`/ai/documents/${resourceId}/${operation === 'cleanup' ? 'index/cleanup' : 'rebuild'}`, { body: { key, expectedRevision } });
    assert.equal(result.status, 202, JSON.stringify(result)); return result.data;
  };
  const phase = (commandId, name, action = 'continue') => h.send(`/saas/effects/${commandId}/${action}`, { body: { phase: name } });
  const usage = async () => (await db.collection('saasSubscriptions').findOne({ tenantId: a.tenantId })).usage.apiCalls;
  const snapshot = async () => { const result = {}; for (const { name } of (await db.listCollections({}, { nameOnly: true }).toArray()).sort((x, y) => x.name.localeCompare(y.name))) result[name] = effectHash(await db.collection(name).find({}).sort({ _id: 1 }).toArray()); return result; };
  await t.test('acceptance freezes exact source/point IDs, meters once and provider dependencies fail closed', async () => {
    const key = randomUUID(), accepted = await accept(0, key), command = await db.collection('saasEffectCommands').findOne({ _id: accepted.commandId });
    assert.equal(await usage(), '1'); assert.deepEqual(await accept(0, key), accepted); assert.equal(await usage(), '1'); assert.equal(started, 0);
    assert.equal((await h.send(`/ai/documents/${resourceId}/rebuild`, { body: { key, expectedRevision: 1 } })).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await db.collection('foundationCommandResults').countDocuments({ tenantId: a.tenantId, action: 'ai.index', key }), 0);
    assert.equal((await phase(accepted.commandId, 'UPSERT')).error.code, 'AI_PHASE_DEPENDENCY_PENDING'); assert.equal(started, 0);
    assert.equal((await phase(accepted.commandId, 'EMBED')).status, 200);
    const before = await h.ok('/ai/retrieve', { query: 'Owned source evidence' }); assert.equal(before.state, 'NO_AUTHORIZED_EVIDENCE');
    const results = await Promise.all([phase(accepted.commandId, 'UPSERT'), phase(accepted.commandId, 'UPSERT')]); assert.ok(results.some(result => result.status === 200));
    const index = await db.collection('aiIndexes').findOne({ resourceId }); assert.deepEqual(index.points, command.plan.pointIds); assert.equal(index.generation, command.plan.generation);
    const final = await db.collection('foundationCommandResults').findOne({ tenantId: a.tenantId, action: 'ai.index', key });
    assert.equal(final.inputHash, contentHash({ action: 'ai.index', aggregateId: resourceId, expectedRevision: 0, input: { sourceHash: command.plan.sourceHash, model: provider.model } }));
    assert.deepEqual(final.response.data, { resourceId, revision: 1, sourceRevision: 1, model: provider.model }); assert.equal(final.response.replayed, false);
    assert.equal((await h.ok('/ai/retrieve', { query: 'Owned source evidence' })).state, 'DOCUMENT_EVIDENCE');
    assert.deepEqual(await accept(0, key), accepted); assert.equal(await usage(), '1');
    assert.equal(await native.collection('providerReceipts').countDocuments({ operation: 'UPSERT', 'binding.commandId': accepted.commandId }), 1);
    const original = effectHash(final.response); assert.equal((await phase(accepted.commandId, 'UPSERT')).status, 200); assert.equal(effectHash((await db.collection('foundationCommandResults').findOne({ _id: final._id })).response), original);
    const all = await snapshot(); assert.equal((await h.send(`/saas/effects/${accepted.commandId}`)).status, 200); assert.equal((await h.send(`/ai/documents/${resourceId}/index`)).data.state, 'CURRENT'); assert.deepEqual(await snapshot(), all);
    assert.equal((await h.send(`/saas/effects/${accepted.commandId}`, { cookie: h.beta })).status, 404);
  });
  await t.test('lost native ACK observes the same embedding and original immutable acceptance', async () => {
    const accepted = await accept(1), before = started; lost = true;
    assert.equal((await phase(accepted.commandId, 'EMBED')).status, 500); assert.equal(started, before + 1);
    assert.equal((await phase(accepted.commandId, 'EMBED', 'observe')).status, 200); assert.equal(started, before + 1);
    assert.equal((await phase(accepted.commandId, 'UPSERT')).status, 200); assert.equal(await usage(), '2');
    const row = await db.collection('aiIndexes').findOne({ resourceId }); assert.equal(row.revision, 2); assert.equal(row.retiredPoints.length, 1);
  });
  await t.test('cleanup freezes exact retired IDs and proves deletion before original pointer receipt', async () => {
    const before = await db.collection('aiIndexes').findOne({ resourceId }), accepted = await accept(2, randomUUID(), 'cleanup'), command = await db.collection('saasEffectCommands').findOne({ _id: accepted.commandId });
    assert.deepEqual(command.plan.retiredPointIds, before.retiredPoints); assert.equal((await phase(accepted.commandId, 'DELETE')).status, 200);
    const current = await db.collection('aiIndexes').findOne({ resourceId }); assert.deepEqual(current.points, before.points); assert.equal(current.generation, before.generation); assert.deepEqual(current.retiredPoints, []);
    assert.equal(await native.collection('providerPoints').countDocuments({ _id: { $in: before.retiredPoints } }), 0); assert.equal(await native.collection('providerPoints').countDocuments({ _id: { $in: before.points } }), before.points.length);
    const receipt = await db.collection('foundationCommandResults').findOne({ commandControlId: accepted.commandId }); assert.deepEqual(receipt.response.data, { resourceId, removed: 1, remaining: 0 }); assert.equal(await usage(), '3');
  });
  await t.test('lost upsert ACK leaves an inert orphan; current source change blocks publication and exact proof permits cleanup', async () => {
    const accepted = await accept(3); assert.equal((await phase(accepted.commandId, 'EMBED')).status, 200);
    const claim = await h.runtime.separateEffects.claim(accepted.commandId, 'UPSERT'); lost = true;
    await assert.rejects(h.runtime.separateEffects.invoke(claim.capability));
    const orphan = await db.collection('saasEffectCommands').findOne({ _id: accepted.commandId });
    assert.equal(await native.collection('providerPoints').countDocuments({ _id: { $in: orphan.plan.pointIds } }), orphan.plan.pointIds.length);
    const active = await db.collection('aiIndexes').findOne({ resourceId }); assert.ok(orphan.plan.pointIds.every(id => !active.points.includes(id)));
    await h.ok(`/ai/documents/${resourceId}/publish`, { key: randomUUID(), expectedRevision: 1, title: 'Owned source advanced', text: 'Different owned source revision', allowedUserIds: [a.userId] });
    assert.equal((await h.runtime.separateEffects.settle(claim.capability)).state, 'PUBLICATION_DENIED');
    assert.equal((await h.ok('/ai/retrieve', { query: 'Owned source evidence' })).state, 'NO_AUTHORIZED_EVIDENCE');
    const cleanup = await accept(3, randomUUID(), 'cleanup'), frozen = await db.collection('saasEffectCommands').findOne({ _id: cleanup.commandId });
    assert.deepEqual(frozen.plan.retiredPointIds, orphan.plan.pointIds); assert.equal(frozen.plan.orphanBindings[0].commandId, orphan._id);
    assert.equal((await phase(cleanup.commandId, 'DELETE')).status, 200); assert.equal(await native.collection('providerPoints').countDocuments({ _id: { $in: orphan.plan.pointIds } }), 0);
    assert.deepEqual((await db.collection('aiIndexes').findOne({ resourceId })).points, active.points);
  });
  await t.test('quota denial aborts the accepted root without any native phase', async () => {
    const sub = await db.collection('saasSubscriptions').findOne({ tenantId: a.tenantId }), count = await db.collection('saasEffectCommands').countDocuments({ tenantId: a.tenantId }), before = started;
    await db.collection('saasSubscriptions').updateOne({ _id: sub._id }, { $set: { 'usage.apiCalls': '10000' } });
    try { assert.equal((await h.send(`/ai/documents/${resourceId}/rebuild`, { body: { key: randomUUID(), expectedRevision: 4 } })).error.code, 'SAAS_QUOTA_EXCEEDED'); }
    finally { await db.collection('saasSubscriptions').replaceOne({ _id: sub._id }, sub); }
    assert.equal(await db.collection('saasEffectCommands').countDocuments({ tenantId: a.tenantId }), count); assert.equal(started, before);
  });
  await t.test('source ACL revocation between claim and invoke performs no provider effect', async () => {
    const accepted = await accept(4), claim = await h.runtime.separateEffects.claim(accepted.commandId, 'EMBED'), source = await db.collection('aiDocuments').findOne({ _id: resourceId }), before = started;
    await db.collection('aiDocuments').updateOne({ _id: resourceId }, { $set: { allowedUserIds: [] } });
    try { await assert.rejects(h.runtime.separateEffects.invoke(claim.capability), { code: 'AI_DOCUMENT_NOT_FOUND' }); assert.equal(started, before); }
    finally { await db.collection('aiDocuments').replaceOne({ _id: resourceId }, source); }
  });
  await t.test('native work drain waits begun work and suspension denies late publication', async () => {
    const accepted = await accept(4); let release; hold = { promise: new Promise(resolve => release = resolve) };
    const before = started, pending = phase(accepted.commandId, 'EMBED');
    for (let n = 0; n < 200 && started === before; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(started, before + 1); const sub = await db.collection('saasSubscriptions').findOne({ tenantId: a.tenantId });
    await h.ok('/saas/suspend', { key: randomUUID(), expectedRevision: sub.revision, reason: 'Owned native stop race' });
    let stopped = false; const drain = h.send('/saas/quiesce', { body: {} }).then(result => { stopped = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(stopped, false); release(); hold = null;
    assert.equal((await pending).data.state, 'PUBLICATION_DENIED'); assert.equal((await drain).data.state, 'QUIESCENT');
    assert.equal((await db.collection('aiIndexes').findOne({ resourceId })).revision, 4); assert.equal((await phase(accepted.commandId, 'UPSERT')).status, 403);
  });
});
