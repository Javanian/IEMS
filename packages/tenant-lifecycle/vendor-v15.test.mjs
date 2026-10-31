import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { readVendorPurchaseOrder } from '../../apps/portfolio-api/src/portals.mjs';
import { contentHash } from '../tenant-foundation/commands.mjs';
import { effectHash, effectTransaction } from './effects.mjs';
import { admissionProfile } from './admission.mjs';
import { createControlledLocalAiProvider } from './local-ai-provider.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';

test('v15 mounted vendor original intent authority and controlled local receipt phases', { timeout: 180000 }, async t => {
  const cleanup = []; let lost = false, hold = null, invoked = 0, abortIntent = false;
  const h = await startOwned({ after: fn => cleanup.push(fn) }, { integrations: { effects: { mode: 'LOCAL_SIMULATED', controlFault: async (boundary, proof) => { if (boundary === 'beforeAcceptanceReturn' && proof.command.kind === 'ai.vendor.delivery' && abortIntent) throw Error('Owned vendor root abort'); }, vendor: { fault: async (boundary, proof) => {
    if (boundary === 'afterProviderBegin' && proof.operation === 'VENDOR') { invoked++; if (hold) await hold.promise; }
    if (boundary === 'afterProviderReceipt' && lost) { lost = false; throw Error('Owned vendor native ACK loss'); }
  } } } } });
  t.after(async () => { try { await h.runtime.localVendorProvider.dispose(); } finally { for (const fn of cleanup) await fn(); } });
  const { db } = h, a = h.seeded[0], provider = h.runtime.localVendorProvider, native = h.client.db(provider.evidence().providerDatabase);
  await db.collection('memberships').updateOne({ _id: a.membershipId }, { $set: { tenantWide: true, roles: ['owner', 'vendorDraftAuthor', 'vendorDraftApprover', 'vendorDraftDelivery', 'portalAccessAdmin', 'saasUser'].map(role => ({ role, plantIds: [a.plantId], tenantWide: false })).concat({ role: 'saasOperator', plantIds: [], tenantWide: true }) } });
  const vendor = await h.ok('/procurement/vendors', { name: 'Owned native delivery vendor' }, 201), pr = await h.ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Owned vendor source', quantity: '1.50', uom: 'EA', unitPrice: '12.00', currency: 'USD' }] }, 201);
  await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 }); const po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() }); await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const grantId = randomUUID(); await h.ok('/portals/grants', { grantId, userId: a.userId, partyId: vendor._id, kind: 'VENDOR', actions: ['portal.vendor.read'], expiresAt: new Date(Date.now() + 3600000).toISOString(), commandKey: randomUUID() });
  const raw = await effectTransaction(h.client, session => readVendorPurchaseOrder(db, { tenantId: a.tenantId, plantId: a.plantId, cohort: 'LEGACY', vendorId: vendor._id, orderId: po._id }, session));
  const source = { cohort: 'LEGACY', vendorId: vendor._id, orderId: po._id, documentRevision: raw.documentRevision, sourceHash: raw.sourceHash }, privateText = 'Owned private vendor proposal ' + randomUUID();
  await h.ok('/saas/subscribe', { key: randomUUID(), expectedRevision: 0, reason: 'Owned native vendor proof', plan: 'pilot', admissionProfile });
  const call = (id, action, body = {}, cookie = h.alpha) => h.send(`/ai/vendor-drafts/${id}/${action}`, { body, cookie });
  const usage = async () => (await db.collection('saasSubscriptions').findOne({ tenantId: a.tenantId })).usage.apiCalls;
  async function approved() {
    const id = randomUUID(); assert.equal((await call(id, 'create', { key: randomUUID(), expectedRevision: 0, text: privateText, source })).status, 200);
    assert.equal((await call(id, 'preview', { key: randomUUID(), expectedRevision: 1, recipientGrantId: grantId })).status, 200);
    const row = await h.ok(`/ai/vendor-drafts/${id}`);
    assert.equal((await call(id, 'approve', { key: randomUUID(), expectedRevision: 2, previewId: row.preview.previewId, contentHash: row.contentHash, actionId: randomUUID() })).status, 200);
    return id;
  }
  async function accept() {
    const id = await approved(), body = { key: randomUUID(), expectedRevision: 3, attemptId: randomUUID(), deliveryKey: randomUUID() }, before = await usage(), result = await call(id, 'intent', body);
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.data.state, 'PENDING'); assert.equal(BigInt(await usage()), BigInt(before) + 1n);
    return { id, body, response: result.data, commandId: result.data.effect.commandId, usage: await usage() };
  }
  const snapshot = async () => { const result = {}; for (const { name } of (await db.listCollections({}, { nameOnly: true }).toArray()).sort((x, y) => x.name.localeCompare(y.name))) result[name] = effectHash(await db.collection(name).find({}).sort({ _id: 1 }).toArray()); return result; };
  await t.test('original intent result/hash atomic, immutable replay, duplicate claim and zero worker usage', async () => {
    const root = await accept(), receipt = await db.collection('foundationCommandResults').findOne({ tenantId: a.tenantId, action: 'ai.vendor.deliver', key: root.body.key });
    assert.equal(invoked, 0); assert.equal(receipt.inputHash, contentHash({ action: 'ai.vendor.deliver', aggregateId: root.id, expectedRevision: 3, input: { ...root.body, plantId: a.plantId, draftId: root.id } }));
    assert.deepEqual(receipt.response, Object.fromEntries(Object.entries(root.response).filter(([key]) => key !== 'effect')));
    const replay = await call(root.id, 'intent', root.body); assert.equal(replay.data.replayed, true); assert.deepEqual(replay.data.data, root.response.data); assert.equal(await usage(), root.usage);
    assert.equal((await call(root.id, 'intent', { ...root.body, deliveryKey: randomUUID() })).error.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(await usage(), root.usage);
    const results = await Promise.all([call(root.id, 'dispatch', { attemptId: root.body.attemptId }), call(root.id, 'dispatch', { attemptId: root.body.attemptId })]); assert.ok(results.some(result => result.status === 200), JSON.stringify(results)); assert.equal(invoked, 1); assert.equal(await usage(), root.usage);
    const result = results.find(item => item.status === 200).data; assert.equal(result.state, 'CONFIRMED'); assert.equal(result.recallConfirmed, false);
    const terminal = await call(root.id, 'reconcile', { attemptId: root.body.attemptId }); assert.deepEqual(terminal.data, result); assert.equal(invoked, 1); assert.equal(await usage(), root.usage);
    assert.deepEqual((await call(root.id, 'intent', root.body)).data.data, root.response.data);
    const all = await snapshot(); assert.equal((await h.send(`/saas/effects/${root.commandId}`)).status, 200); assert.equal((await h.send(`/ai/vendor-drafts/${root.id}`)).data.state, 'CONFIRMED'); assert.deepEqual(await snapshot(), all);
    assert.equal((await call(root.id, 'reconcile', { attemptId: root.body.attemptId }, h.beta)).status, 403);
    for (const name of ['saasEffectCommands', 'saasEffectAttempts', 'saasEffectEvents', 'saasEffectBarriers']) assert.ok(!JSON.stringify(await db.collection(name).find({ tenantId: a.tenantId }).toArray()).includes(privateText));
  });
  await t.test('quota and injected root abort leave draft, receipt, attempt and usage atomic', async () => {
    const id = await approved(), body = { key: randomUUID(), expectedRevision: 3, attemptId: randomUUID(), deliveryKey: randomUUID() }, sub = await db.collection('saasSubscriptions').findOne({ tenantId: a.tenantId }), before = invoked;
    await db.collection('saasSubscriptions').updateOne({ _id: sub._id }, { $set: { 'usage.apiCalls': '10000' } });
    try { assert.equal((await call(id, 'intent', body)).error.code, 'SAAS_QUOTA_EXCEEDED'); } finally { await db.collection('saasSubscriptions').replaceOne({ _id: sub._id }, sub); }
    abortIntent = true; try { assert.equal((await call(id, 'intent', body)).status, 500); } finally { abortIntent = false; }
    assert.equal(await attemptsCount(), 0); assert.equal(await db.collection('foundationCommandResults').countDocuments({ tenantId: a.tenantId, action: 'ai.vendor.deliver', key: body.key }), 0);
    assert.equal((await db.collection('aiVendorDrafts').findOne({ _id: id })).state, 'APPROVED'); assert.equal(await usage(), sub.usage.apiCalls); assert.equal(invoked, before);
    async function attemptsCount() { return db.collection('aiVendorDeliveryAttempts').countDocuments({ _id: body.attemptId }); }
  });
  await t.test('lost native ACK observes exact same provider receipt, never sends a second attempt', async () => {
    const root = await accept(), before = invoked; lost = true; assert.equal((await call(root.id, 'dispatch', { attemptId: root.body.attemptId })).status, 500); assert.equal(invoked, before + 1);
    assert.equal((await call(root.id, 'reconcile', { attemptId: root.body.attemptId })).data.state, 'CONFIRMED'); assert.equal(invoked, before + 1); assert.equal(await usage(), root.usage);
    assert.equal(await native.collection('providerReceipts').countDocuments({ operation: 'VENDOR', 'binding.commandId': root.commandId }), 1);
  });
  await t.test('recipient and approver revocation prevent any provider begin', async () => {
    const root = await accept(), before = invoked, party = await db.collection('portal_party_grants').findOne({ _id: grantId });
    await db.collection('portal_party_grants').updateOne({ _id: grantId }, { $set: { active: false } });
    try { assert.equal((await call(root.id, 'dispatch', { attemptId: root.body.attemptId })).status, 403); assert.equal(invoked, before); }
    finally { await db.collection('portal_party_grants').replaceOne({ _id: grantId }, party); }
    const member = await db.collection('memberships').findOne({ _id: a.membershipId }); await db.collection('memberships').updateOne({ _id: a.membershipId }, { $pull: { roles: { role: 'vendorDraftApprover' } } });
    try { assert.equal((await call(root.id, 'dispatch', { attemptId: root.body.attemptId })).error.code, 'AI_VENDOR_APPROVER_REVOKED'); assert.equal(invoked, before); }
    finally { await db.collection('memberships').replaceOne({ _id: member._id }, member); }
  });
  await t.test('revocation after begun work retains real observed result without publication or recall claim', async () => {
    const root = await accept(); let release; hold = { promise: new Promise(resolve => release = resolve) }; const before = invoked, pending = call(root.id, 'dispatch', { attemptId: root.body.attemptId });
    for (let n = 0; n < 200 && invoked === before; n++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(invoked, before + 1);
    const row = await h.ok(`/ai/vendor-drafts/${root.id}`); assert.equal((await call(root.id, 'revoke', { key: randomUUID(), expectedRevision: row.revision, actionId: randomUUID() })).status, 200);
    release(); hold = null; assert.equal((await pending).data.state, 'PUBLICATION_DENIED');
    const attempt = await db.collection('saasEffectAttempts').findOne({ commandId: root.commandId }); assert.equal(attempt.observedOutcome.state, 'CONFIRMED'); assert.equal(attempt.state, 'OBSERVED');
    const business = await h.ok(`/ai/vendor-drafts/${root.id}`); assert.equal(business.state, 'DISPATCHING'); assert.equal(await usage(), (BigInt(root.usage) + 1n).toString());
  });
  await t.test('suspend waits actual local native work and verified complete barriers gate recovery', async () => {
    const root = await accept(); let release; hold = { promise: new Promise(resolve => release = resolve) }; const before = invoked, pending = call(root.id, 'dispatch', { attemptId: root.body.attemptId });
    for (let n = 0; n < 200 && invoked === before; n++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(invoked, before + 1);
    const sub = await db.collection('saasSubscriptions').findOne({ tenantId: a.tenantId }); await h.ok('/saas/suspend', { key: randomUUID(), expectedRevision: sub.revision, reason: 'Owned vendor stop proof' });
    const exportKey = randomUUID(); assert.equal((await h.send('/saas/export', { body: { key: exportKey, expectedRevision: sub.revision + 1, reason: 'Owned vendor archive boundary' } })).error.code, 'EFFECT_QUIESCENCE_PENDING');
    let stopped = false; const drain = h.send('/saas/quiesce', { body: {} }).then(result => { stopped = true; return result; }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(stopped, false); release(); hold = null;
    assert.equal((await pending).data.state, 'PUBLICATION_DENIED'); assert.equal((await drain).data.state, 'QUIESCENT'); assert.equal((await h.send('/saas/status')).data.quiescence.state, 'QUIESCENT');
    assert.equal((await call(root.id, 'dispatch', { attemptId: root.body.attemptId })).status, 403);
    const exported = await h.ok('/saas/export', { key: exportKey, expectedRevision: sub.revision + 1, reason: 'Owned vendor archive boundary' });
    const archive = await h.ok('/saas/download', { archiveId: exported.data.archiveId }); assert.equal(archive.snapshot.coverage, 'COMPLETE'); assert.ok(!JSON.stringify(archive).includes(privateText));
    const evidence = provider.evidence(), fresh = await createControlledLocalAiProvider({ client: h.client, applicationDb: db, providerDb: native, marker: evidence.markerId, model: provider.model, dimensions: provider.dimensions });
    assert.equal(await fresh.verifyBarrier({ tenantId: a.tenantId, stopEpoch: 1 }), false); assert.equal((await fresh.stopAndDrain({ tenantId: a.tenantId, stopEpoch: 1 })).state, 'QUIESCENT'); assert.equal(await fresh.verifyBarrier({ tenantId: a.tenantId, stopEpoch: 1 }), true);
  });
});
