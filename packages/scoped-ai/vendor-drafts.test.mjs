import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalVendorTransport, createVendorDrafts } from './vendor-drafts.mjs';

function fixture({ transport = createLocalVendorTransport() } = {}) {
  const grant = Object.fromEntries(['tenantId', 'plantId', 'legalEntityId', 'userId'].map(k => [k, randomUUID()]));
  const scope = {}, draftId = randomUUID(), vendorId = randomUUID(), orderId = randomUUID(), grantId = randomUUID();
  const source = { cohort: 'LEGACY', vendorId, orderId, documentRevision: 1, sourceHash: 'a'.repeat(64) };
  const recipient = { grantId, vendorId, userId: randomUUID(), revision: 1, expiresAt: '2027-01-01T00:00:00.000Z',
    channel: 'VENDOR_PORTAL', displayLabel: 'Existing portal user' };
  let state = {}, pending, active = false;
  const control = { denied: false, sourceDenied: false, recipientDenied: false, sourceRevision: 1, failAudit: false, sourceReads: 0,
    now: new Date('2026-10-31T00:00:00.000Z') };
  const session = { startTransaction() { active = true; pending = structuredClone(state); }, inTransaction: () => active,
    async commitTransaction() { state = pending; active = false; }, async abortTransaction() { active = false; }, async endSession() {} };
  const match = (row, f) => Object.entries(f).every(([k, v]) => row[k] === v);
  const runtime = { client: { startSession: () => session }, foundation: { async authorizeInTransaction(s, target, opts) {
    assert.equal(s, scope); assert.equal(opts.session, session); assert.ok(active);
    if (control.denied || target.plantId !== grant.plantId) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'SCOPE_DENIED', status: 403 });
    return grant;
  } }, db: { collection(name) { return {
    async createIndex() {},
    async findOne(f) { return structuredClone((pending[name] ?? []).find(row => match(row, f)) ?? null); },
    async insertOne(row) {
      if (name === 'audit' && control.failAudit) throw new Error('AUDIT_FAILED');
      pending[name] ??= [];
      if (pending[name].some(r => r._id === row._id)) throw Object.assign(new Error('DUPLICATE'), { code: 11000 });
      pending[name].push(structuredClone(row));
    },
    async insertMany(rows) { pending[name] ??= []; pending[name].push(...structuredClone(rows)); },
    async updateOne(f, update) {
      const row = (pending[name] ?? []).find(r => match(r, f));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, structuredClone(update.$set ?? {}));
      for (const [k, v] of Object.entries(update.$inc ?? {})) row[k] = (row[k] ?? 0) + v;
      return { matchedCount: 1 };
    },
  }; } }, authority: {
    async source({ grant: g, reference, session: s }) {
      assert.equal(s, session); assert.deepEqual(g, grant); control.sourceReads++;
      if (control.sourceDenied || reference.vendorId !== vendorId || reference.orderId !== orderId) throw Object.assign(new Error('SOURCE_DENIED'), { code: 'SOURCE_DENIED' });
      return { ...source, currentDocumentRevision: control.sourceRevision };
    },
    async recipient({ grantId: requested, session: s }) {
      assert.equal(s, session);
      if (control.recipientDenied || requested !== grantId) throw Object.assign(new Error('RECIPIENT_DENIED'), { code: 'RECIPIENT_DENIED' });
      return structuredClone(recipient);
    },
  }, transport, clock: () => control.now, timeoutMs: 5 };
  const api = createVendorDrafts(runtime);
  const createInput = { plantId: grant.plantId, draftId, key: 'create', expectedRevision: 0, text: 'Please confirm this approved order.', source };
  const base = revision => ({ plantId: grant.plantId, draftId, key: randomUUID(), expectedRevision: revision });
  const readInput = { plantId: grant.plantId, draftId };
  const approve = async () => {
    await api.create(scope, createInput);
    await api.preview(scope, { ...base(1), recipientGrantId: grantId });
    const row = await api.read(scope, readInput);
    await api.approve(scope, { ...base(2), previewId: row.preview.previewId, contentHash: row.contentHash, actionId: randomUUID() });
  };
  const intent = async () => {
    await approve(); const attemptId = randomUUID();
    await api.intent(scope, { ...base(3), attemptId, deliveryKey: randomUUID() });
    return { ...readInput, attemptId };
  };
  return { api, scope, source, recipient, grant, grantId, control, state: () => state, base, readInput, createInput, approve, intent };
}

test('immutable preview and human approval pin source, content, recipient; atomic audit and history', async () => {
  const f = fixture(); await f.approve();
  const row = await f.api.read(f.scope, f.readInput);
  assert.equal(row.state, 'APPROVED'); assert.equal(row.approval.actorId, f.grant.userId);
  assert.deepEqual(row.approval.recipient, f.recipient); assert.equal(row.liveDeliveryEnabled, false);
  const state = f.state(); assert.equal(state.aiVendorDraftRevisions.length, 3);
  assert.equal(new Set(state.aiVendorDraftRevisions.map(r => r._id)).size, 3);
  assert.deepEqual(state.aiVendorDraftRevisions.map(r => r.state), ['DRAFT', 'PREVIEWED', 'APPROVED']);
  assert.equal(state.audit.length, 3); assert.equal(state.outbox.length, 3); assert.equal(state.aiVendorApprovals.length, 1);
});
test('replay reauthorizes and input changes conflict; audit failure rolls back all effects', async () => {
  const f = fixture(); await f.api.create(f.scope, f.createInput);
  assert.equal((await f.api.create(f.scope, f.createInput)).replayed, true);
  await assert.rejects(f.api.create(f.scope, { ...f.createInput, text: 'Changed' }), { code: 'IDEMPOTENCY_CONFLICT' });
  f.control.denied = true; await assert.rejects(f.api.create(f.scope, f.createInput), { code: 'SCOPE_DENIED' });
  f.control.denied = false; f.control.sourceDenied = true;
  await assert.rejects(f.api.create(f.scope, f.createInput), { code: 'SOURCE_DENIED' });
  const other = fixture(); other.control.failAudit = true;
  await assert.rejects(other.api.create(other.scope, other.createInput), /AUDIT_FAILED/);
  assert.deepEqual(other.state(), {});
});
test('missing recipient allows preview but prevents approval', async () => {
  const f = fixture(); await f.api.create(f.scope, f.createInput);
  await f.api.preview(f.scope, { ...f.base(1), recipientGrantId: null });
  const row = await f.api.read(f.scope, f.readInput);
  await assert.rejects(f.api.approve(f.scope, { ...f.base(2), previewId: row.preview.previewId,
    contentHash: row.contentHash, actionId: randomUUID() }), { code: 'AI_VENDOR_APPROVAL_INVALID' });
});
for (const changed of ['source', 'recipient']) test(`${changed} changes invalidate approval`, async () => {
  const f = fixture(); await f.api.create(f.scope, f.createInput);
  await f.api.preview(f.scope, { ...f.base(1), recipientGrantId: f.grantId });
  const row = await f.api.read(f.scope, f.readInput);
  if (changed === 'source') f.control.sourceRevision = 2; else f.recipient.revision++;
  await assert.rejects(f.api.approve(f.scope, { ...f.base(2), previewId: row.preview.previewId,
    contentHash: row.contentHash, actionId: randomUUID() }), { code: changed === 'source' ? 'AI_VENDOR_SOURCE_CHANGED' : 'AI_VENDOR_RECIPIENT_CHANGED' });
  assert.equal(f.state().aiVendorApprovals, undefined);
});
test('default has no delivery; local intent does not claim confirmed until matching receipt', async () => {
  const f = fixture({ transport: null }); await f.approve();
  await assert.rejects(f.api.intent(f.scope, { ...f.base(3), attemptId: randomUUID(), deliveryKey: 'local' }), { code: 'AI_LIVE_DELIVERY_DISABLED' });
  const local = fixture(); const input = await local.intent();
  assert.equal((await local.api.read(local.scope, local.readInput)).attempt.state, 'PENDING');
  assert.equal((await local.api.dispatch(local.scope, input)).state, 'CONFIRMED');
  assert.equal((await local.api.read(local.scope, local.readInput)).attempt.mode, 'LOCAL_SIMULATED');
  await assert.rejects(local.api.dispatch(local.scope, input), { code: 'AI_VENDOR_RECONCILE_REQUIRED' });
  assert.equal((await local.api.reconcile(local.scope, input)).state, 'CONFIRMED');
});
test('timeout after possible handoff becomes UNKNOWN, reconcile same attempt never sends twice', async () => {
  let sends = 0;
  const local = createLocalVendorTransport();
  const f = fixture({ transport: { ...local, async send() { sends++; return new Promise(() => {}); } } });
  const input = await f.intent();
  assert.equal((await f.api.dispatch(f.scope, input)).state, 'UNKNOWN');
  await assert.rejects(f.api.dispatch(f.scope, input), { code: 'AI_VENDOR_RECONCILE_REQUIRED' });
  assert.equal((await f.api.reconcile(f.scope, input)).state, 'CONFIRMED'); assert.equal(sends, 1);
});
test('mismatched receipt never confirms, accepted remains distinct, revoked pending never dispatches', async () => {
  const local = createLocalVendorTransport({ outcome: 'ACCEPTED' });
  const f = fixture({ transport: local }); const input = await f.intent();
  assert.equal((await f.api.dispatch(f.scope, input)).state, 'ACCEPTED');
  const corrupt = fixture({ transport: { ...local, async send({ attempt }) { return { ...await local.send({ attempt }), contentHash: 'b'.repeat(64) }; } } });
  const cInput = await corrupt.intent(); assert.equal((await corrupt.api.dispatch(corrupt.scope, cInput)).state, 'UNKNOWN');
  const revoked = fixture(); const rInput = await revoked.intent();
  await revoked.api.revoke(revoked.scope, { ...revoked.base(4), actionId: randomUUID() });
  await assert.rejects(revoked.api.dispatch(revoked.scope, rInput), { code: 'AI_VENDOR_RECONCILE_REQUIRED' });
});
test('malformed request and tenant/actor injection fail before source access; CAS protects revisions', async () => {
  const f = fixture();
  await assert.rejects(f.api.create(f.scope, { ...f.createInput, tenantId: randomUUID() }), { code: 'AI_INVALID_VENDOR_DRAFT' });
  assert.equal(f.control.sourceReads, 0);
  await f.api.create(f.scope, f.createInput);
  await assert.rejects(f.api.preview(f.scope, { ...f.base(0), recipientGrantId: f.grantId }), { code: 'REVISION_CONFLICT' });
});
