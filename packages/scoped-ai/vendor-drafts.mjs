import {createManagedVendorBoundary} from '../tenant-lifecycle/vendor-effects.mjs';
import {controlledVendorProvider} from '../tenant-lifecycle/local-ai-provider.mjs';
import { randomUUID } from 'node:crypto';
import { boundedTransaction, contentHash, createCommandExecutor } from '../tenant-foundation/commands.mjs';
import { boundedCall, fail, scopeTarget, uuid } from './indexing.mjs';

export const vendorDraftRoles = {
  vendorDraftAuthor: ['ai.vendor.read', 'ai.vendor.create', 'ai.vendor.preview', 'ai.vendor.source.read'],
  vendorDraftApprover: ['ai.vendor.read', 'ai.vendor.approve', 'ai.vendor.revoke', 'ai.vendor.source.read'],
  vendorDraftDelivery: ['ai.vendor.read', 'ai.vendor.deliver', 'ai.vendor.reconcile', 'ai.vendor.source.read'],
};
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = n => Number.isSafeInteger(n) && n > 0;
const strict = (input, fields) => {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(k => !fields.includes(k)) ||
      !uuid(input.plantId) || !uuid(input.draftId)) fail('AI_INVALID_VENDOR_DRAFT');
};
const referenceOf = source => ({ cohort: source.cohort, vendorId: source.vendorId, orderId: source.orderId,
  documentRevision: source.documentRevision, sourceHash: source.sourceHash });
const sourceInput = reference => Object.fromEntries(Object.entries(reference).filter(([k]) => k !== 'sourceHash'));
const same = (a, b) => contentHash(a) === contentHash(b);

export function createVendorDrafts({ client, db, foundation, saasAdmission, authority, transport = null, separateEffects, clock = () => new Date(), timeoutMs = 3000 }) {
  if (!authority?.source || !authority?.recipient || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 ||
      transport !== null && (transport.mode !== 'LOCAL_SIMULATED' || !transport.send || !transport.reconcile || !transport.id)) fail('AI_ADAPTER_CONFIGURATION', 500);
  const drafts = db.collection('aiVendorDrafts'), revisions = db.collection('aiVendorDraftRevisions'), approvals = db.collection('aiVendorApprovals');
  const attempts = db.collection('aiVendorDeliveryAttempts');
  const filter = (grant, draftId) => ({ tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, _id: draftId });
  const authorize = (scope, plantId, action, session) => foundation.authorizeInTransaction(scope, scopeTarget(scope, plantId, action), { session });
  const find = async (grant, draftId, session) => {
    const row = await drafts.findOne(filter(grant, draftId), { session });
    if (!row) fail('AI_VENDOR_DRAFT_NOT_FOUND', 404);
    if (row.contentHash !== contentHash({ text: row.text, source: row.source })) fail('AI_VENDOR_DRAFT_CORRUPT', 409);
    return row;
  };
  const checkSource = async (scope, grant, reference, session, current = true) => {
    await authorize(scope, grant.plantId, 'ai.vendor.source.read', session);
    const source = await authority.source({ grant, reference: sourceInput(reference), session });
    if (!source || !same(referenceOf(source), reference) || current && source.currentDocumentRevision !== reference.documentRevision) fail('AI_VENDOR_SOURCE_CHANGED', 409);
    return source;
  };
  const checkRecipient = async (grant, row, session) => {
    const recipient = await authority.recipient({ grant, vendorId: row.source.vendorId, grantId: row.recipient.grantId, session });
    if (!same(recipient, row.recipient)) fail('AI_VENDOR_RECIPIENT_CHANGED', 409);
    return recipient;
  };
  const command = async (scope, input, action, effect) => {
    const commands = createCommandExecutor({ client, db, admission: saasAdmission?.effect, foundation: {
      async authorizeInTransaction(s, target, { session }) {
        const grant = await foundation.authorizeInTransaction(s, target, { session });
        // Replay always checks present source access, even though it never repeats effects.
        const row = await drafts.findOne(filter(grant, input.draftId), { session });
        if (row) await checkSource(s, grant, row.source, session, false);
        return grant;
      },
    } });
    const domainEffect=async context=>{
      const row = action === 'create' ? null : await find(context.grant, input.draftId, context.session);
      if (row && row.revision !== input.expectedRevision || !row && input.expectedRevision !== 0) fail('REVISION_CONFLICT', 409);
      const next = await effect({ ...context, row });
      const revision = input.expectedRevision + 1;
      if (row) {
        const write = await drafts.updateOne({ ...filter(context.grant, input.draftId), revision: input.expectedRevision },
          { $set: { ...next, revision, updatedAt: clock().toISOString() } }, { session: context.session });
        if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
      } else await drafts.insertOne({ ...filter(context.grant, input.draftId), ...next, revision,
        createdBy: context.grant.userId, updatedAt: clock().toISOString() }, { session: context.session });
      const saved = { ...row, ...next, revision };
      await revisions.insertOne({ ...filter(context.grant, input.draftId), ...saved,
        _id: randomUUID(), draftId: input.draftId, actorId: context.grant.userId,
        occurredAt: clock().toISOString(), action }, { session: context.session });
      return { revision, data: { draftId: input.draftId, revision, state: next.state, attemptId: next.attemptId ?? row?.attemptId ?? null },
        events: [{ type: `ai.vendor.${action}`, version: 1, data: { draftId: input.draftId, revision } }] };
    };
    if(action==='deliver'&&managed)return managed.intent(scope,input,domainEffect);
    return commands.execute(scope, { ...scopeTarget(scope, input.plantId, `ai.vendor.${action}`), key: input.key,
      aggregateId: input.draftId, expectedRevision: input.expectedRevision, input }, async context => {
      return domainEffect(context);
    });
  };
  const settleBody=async(scope,input,attempt,receipt,owner,{session,grant},matched,state)=>{
      const row = await find(grant, input.draftId, session);
      const predicate = { ...filter(grant, input.attemptId), draftId: input.draftId, owner };
      const current = await attempts.findOne(predicate, { session });
      if (!current) fail('AI_VENDOR_RECONCILE_REQUIRED', 409);
      if (['CONFIRMED', 'NOT_PERFORMED'].includes(current.state)) return { state: current.state, attemptId: input.attemptId, mode: 'LOCAL_SIMULATED' };
      const write = await attempts.updateOne({ ...predicate, state: current.state },
        { $set: { state, receipt: matched ? receipt : null, settledAt: clock().toISOString() } }, { session });
      if (write.matchedCount !== 1) fail('AI_VENDOR_RECONCILE_REQUIRED', 409);
      const saved = await drafts.updateOne({ ...filter(grant, input.draftId), attemptId: input.attemptId, revision: row.revision },
        { $set: { state }, $inc: { revision: 1 } }, { session });
      if (saved.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
      await revisions.insertOne({ ...row, _id: randomUUID(), draftId: input.draftId, revision: row.revision + 1,
        state, action: 'delivery.result', actorId: grant.userId, occurredAt: clock().toISOString() }, { session });
      await db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: 'ai.vendor.delivery.result', subjectId: input.draftId,
        attemptId: input.attemptId, state, mode: 'LOCAL_SIMULATED', occurredAt: clock() }, { session });
      await db.collection('outbox').insertOne({ _id: randomUUID(), tenantId: grant.tenantId, plantId: grant.plantId,
        type: 'ai.vendor.delivery.result', schemaVersion: 1, data: { draftId: input.draftId, attemptId: input.attemptId, state },
        occurredAt: clock(), publishedAt: null }, { session });
      return { state, attemptId: input.attemptId, mode: 'LOCAL_SIMULATED', recallConfirmed: false };
  };
  const managed=controlledVendorProvider(transport)?createManagedVendorBoundary({client,db,foundation,saasAdmission,separateEffects,authority,transport,clock,timeoutMs,find,checkSource,checkRecipient,settleBody}):null;
  const base = ['plantId', 'draftId', 'expectedRevision', 'key'];
  return Object.freeze({
    async initialize() {
      await createCommandExecutor({ client, db, admission: saasAdmission?.effect, foundation }).initialize();
      await revisions.createIndex({ tenantId: 1, plantId: 1, draftId: 1, revision: 1 }, { unique: true });
      await approvals.createIndex({ tenantId: 1, plantId: 1, draftId: 1, actionId: 1 }, { unique: true });
      await attempts.createIndex({ tenantId: 1, plantId: 1, draftId: 1, deliveryKey: 1 }, { unique: true });
    },
    async read(scope, input) {
      strict(input, ['plantId', 'draftId']);
      if(managed)return managed.read(scope,input);
      return boundedTransaction(client, async session => {
        const grant = await authorize(scope, input.plantId, 'ai.vendor.read', session);
        const row = await find(grant, input.draftId, session);
        await checkSource(scope, grant, row.source, session, false);
        const write = await drafts.updateOne({ ...filter(grant, input.draftId), revision: row.revision }, { $inc: { readFence: 1 } }, { session });
        if (write.matchedCount !== 1) fail('REVISION_CONFLICT', 409);
        const attempt = row.attemptId ? await attempts.findOne({ ...filter(grant, row.attemptId), draftId: input.draftId }, { session }) : null;
        return { schema: 'VENDOR_DRAFT_V1', draftId: row._id, revision: row.revision, state: row.state, text: row.text,
          contentHash: row.contentHash, source: row.source, recipient: row.recipient ?? null, preview: row.preview ?? null,
          approval: row.approval ?? null, attempt: attempt ? { attemptId: attempt._id, state: attempt.state,
            mode: attempt.mode, providerId: attempt.providerId, receipt: attempt.receipt ?? null, ...(attempt.controlCommandId?{effect:{commandId:attempt.controlCommandId,phase:'VENDOR'}}:{}) } : null,
          liveDeliveryEnabled: false, mode: transport ? 'LOCAL_SIMULATED' : 'DISABLED' };
      });
    },
    async create(scope, input) {
      strict(input, [...base, 'text', 'source']);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 5000 || input.text.includes('\0') ||
          !input.source || Object.keys(input.source).some(k => !['cohort', 'vendorId', 'orderId', 'documentRevision', 'sourceHash'].includes(k)) ||
          !['LEGACY', 'CATALOG'].includes(input.source.cohort) || ![input.source.vendorId, input.source.orderId].every(uuid) ||
          !positive(input.source.documentRevision) || !digest(input.source.sourceHash)) fail('AI_INVALID_VENDOR_DRAFT');
      return command(scope, input, 'create', async ({ session, grant }) => {
        await checkSource(scope, grant, input.source, session, false);
        if (await drafts.findOne(filter(grant, input.draftId), { session })) fail('AI_VENDOR_DRAFT_EXISTS', 409);
        return { state: 'DRAFT', text: input.text, source: structuredClone(input.source),
          contentHash: contentHash({ text: input.text, source: input.source }) };
      });
    },
    async preview(scope, input) {
      strict(input, [...base, 'recipientGrantId']);
      if (input.recipientGrantId !== null && !uuid(input.recipientGrantId)) fail('AI_INVALID_VENDOR_DRAFT');
      return command(scope, input, 'preview', async ({ row, session, grant }) => {
        if (!['DRAFT', 'PREVIEWED'].includes(row.state)) fail('AI_VENDOR_STATE_CONFLICT', 409);
        const source = await checkSource(scope, grant, row.source, session, false);
        const recipient = input.recipientGrantId ? await authority.recipient({ grant, vendorId: row.source.vendorId, grantId: input.recipientGrantId, session }) : null;
        const preview = { previewId: randomUUID(), contentHash: row.contentHash, source: row.source, recipient,
          historical: source.currentDocumentRevision !== row.source.documentRevision, createdAt: clock().toISOString(), actorId: grant.userId };
        return { state: 'PREVIEWED', recipient, preview, approval: null };
      });
    },
    async approve(scope, input) {
      strict(input, [...base, 'previewId', 'contentHash', 'actionId']);
      if (![input.previewId, input.actionId].every(uuid) || !digest(input.contentHash)) fail('AI_INVALID_VENDOR_DRAFT');
      return command(scope, input, 'approve', async ({ row, session, grant }) => {
        if (row.state !== 'PREVIEWED' || row.preview.previewId !== input.previewId || row.contentHash !== input.contentHash ||
            row.preview.historical || !row.recipient) fail('AI_VENDOR_APPROVAL_INVALID', 409);
        await checkSource(scope, grant, row.source, session);
        await checkRecipient(grant, row, session);
        const approval = { actionId: input.actionId, previewId: input.previewId, contentHash: row.contentHash,
          source: row.source, recipient: row.recipient, actorId: grant.userId, approvedAt: clock().toISOString() };
        await approvals.insertOne({ ...filter(grant, input.actionId), draftId: input.draftId, actionId: input.actionId,
          kind: 'APPROVED', approval }, { session });
        return { state: 'APPROVED', approval };
      });
    },
    async revoke(scope, input) {
      strict(input, [...base, 'actionId']);
      if (!uuid(input.actionId)) fail('AI_INVALID_VENDOR_DRAFT');
      return command(scope, input, 'revoke', async ({ row, session, grant }) => {
        if (row.state === 'REVOKED') fail('AI_VENDOR_STATE_CONFLICT', 409);
        const afterHandoff = ['DISPATCHING', 'UNKNOWN', 'ACCEPTED', 'CONFIRMED'].includes(row.state);
        await approvals.insertOne({ ...filter(grant, input.actionId), draftId: input.draftId, actionId: input.actionId,
          kind: 'REVOKED', actorId: grant.userId, occurredAt: clock().toISOString(), afterHandoff }, { session });
        return { state: afterHandoff ? row.state : 'REVOKED', revoked: true, recallConfirmed: false };
      });
    },
    async intent(scope, input) {
      strict(input, [...base, 'attemptId', 'deliveryKey']);
      if (!uuid(input.attemptId) || typeof input.deliveryKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.deliveryKey)) fail('AI_INVALID_VENDOR_DRAFT');
      if (!transport) fail('AI_LIVE_DELIVERY_DISABLED', 409);
      return command(scope, input, 'deliver', async ({ row, session, grant }) => {
        if (row.state !== 'APPROVED' || row.revoked || row.attemptId) fail('AI_VENDOR_STATE_CONFLICT', 409);
        await checkSource(scope, grant, row.source, session); await checkRecipient(grant, row, session);
        const attempt = { ...filter(grant, input.attemptId), draftId: input.draftId, state: 'PENDING',
          deliveryKey: input.deliveryKey, providerId: transport.id, mode: 'LOCAL_SIMULATED', approval: row.approval,
          contentHash: row.contentHash, source: row.source, recipient: row.recipient, text: row.text, createdAt: clock().toISOString() };
        await attempts.insertOne(attempt, { session });
        return { state: 'PENDING', attemptId: input.attemptId };
      });
    },
    async dispatch(scope, input) {
      strict(input, ['plantId', 'draftId', 'attemptId']);
      if (!uuid(input.attemptId) || !transport) fail('AI_LIVE_DELIVERY_DISABLED', 409);
      if(managed)return managed.dispatch(scope,input);
      const owner = randomUUID();
      const claimed = await boundedTransaction(client, async session => {
        const grant = await authorize(scope, input.plantId, 'ai.vendor.deliver', session);
        await saasAdmission?.unsupported(scope,{plantId:input.plantId,session});
        const row = await find(grant, input.draftId, session);
        if (row.state !== 'PENDING' || row.revoked || row.attemptId !== input.attemptId) fail('AI_VENDOR_RECONCILE_REQUIRED', 409);
        await checkSource(scope, grant, row.source, session); await checkRecipient(grant, row, session);
        const predicate = { ...filter(grant, input.attemptId), draftId: input.draftId, state: 'PENDING' };
        const attempt = await attempts.findOne(predicate, { session });
        if (!attempt || !same(attempt.approval, row.approval)) fail('AI_VENDOR_APPROVAL_INVALID', 409);
        const write = await attempts.updateOne(predicate, { $set: { state: 'DISPATCHING', owner,
          leaseUntil: new Date(clock().getTime() + timeoutMs + 1000).toISOString() } }, { session });
        if (write.matchedCount !== 1) fail('AI_VENDOR_RECONCILE_REQUIRED', 409);
        await drafts.updateOne({ ...filter(grant, input.draftId), revision: row.revision }, { $set: { state: 'DISPATCHING' } }, { session });
        await db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: 'ai.vendor.dispatch.claimed',
          subjectId: input.draftId, attemptId: input.attemptId, owner, occurredAt: clock() }, { session });
        return { grant, attempt: { ...attempt, owner } };
      });
      // Only the successfully committed claimant may call the adapter. Ambiguous commit returns above without a call.
      let receipt;
      try { receipt = await boundedCall(signal => transport.send({ attempt: claimed.attempt, signal }), timeoutMs); }
      catch { receipt = null; }
      return settle(scope, input, claimed.attempt, receipt, owner);
    },
    async reconcile(scope, input) {
      strict(input, ['plantId', 'draftId', 'attemptId']);
      if (!uuid(input.attemptId) || !transport) fail('AI_LIVE_DELIVERY_DISABLED', 409);
      if(managed)return managed.reconcile(scope,input);
      const attempt = await boundedTransaction(client, async session => {
        const grant = await authorize(scope, input.plantId, 'ai.vendor.reconcile', session);
        await saasAdmission?.unsupported(scope,{plantId:input.plantId,session});
        const row = await find(grant, input.draftId, session);
        if (row.attemptId !== input.attemptId) fail('AI_VENDOR_RECONCILE_REQUIRED', 409);
        await checkSource(scope, grant, row.source, session, false);
        const item = await attempts.findOne({ ...filter(grant, input.attemptId), draftId: input.draftId }, { session });
        if (!item || !['DISPATCHING', 'UNKNOWN', 'ACCEPTED', 'CONFIRMED', 'NOT_PERFORMED'].includes(item.state)) fail('AI_VENDOR_RECONCILE_REQUIRED', 409);
        if (item.state === 'DISPATCHING' && Date.parse(item.leaseUntil) > clock().getTime()) fail('AI_VENDOR_ATTEMPT_BUSY', 409);
        return item;
      });
      if (['CONFIRMED', 'NOT_PERFORMED'].includes(attempt.state)) return { state: attempt.state, attemptId: attempt._id, mode: 'LOCAL_SIMULATED' };
      let receipt;
      try { receipt = await boundedCall(signal => transport.reconcile({ attempt, signal }), timeoutMs); }
      catch { receipt = null; }
      return settle(scope, input, attempt, receipt, attempt.owner);
    },
  });

  async function settle(scope, input, attempt, receipt, owner) {
    const matched = receipt && receipt.source && receipt.recipient && receipt.mode === 'LOCAL_SIMULATED' && receipt.providerId === attempt.providerId &&
      receipt.attemptId === attempt._id && receipt.deliveryKey === attempt.deliveryKey && receipt.contentHash === attempt.contentHash &&
      receipt.approvalId === attempt.approval.actionId && same(receipt.source, attempt.source) && same(receipt.recipient, attempt.recipient) &&
      typeof receipt.receiptId === 'string' && receipt.receiptId.length > 0;
    const state = matched && ['CONFIRMED', 'ACCEPTED', 'NOT_PERFORMED'].includes(receipt.state) ? receipt.state : 'UNKNOWN';
    return boundedTransaction(client, async session => {
      const grant = await authorize(scope, input.plantId, 'ai.vendor.reconcile', session);
      await saasAdmission?.unsupported(scope,{plantId:input.plantId,session});
      return settleBody(scope,input,attempt,receipt,owner,{session,grant},matched,state);
    });
  }
}

export function createLocalVendorTransport({ id = 'local-vendor-fixture', outcome = 'CONFIRMED' } = {}) {
  if (!['CONFIRMED', 'ACCEPTED', 'UNKNOWN', 'NOT_PERFORMED'].includes(outcome)) fail('AI_ADAPTER_CONFIGURATION', 500);
  const receipt = attempt => ({ mode: 'LOCAL_SIMULATED', providerId: id, receiptId: `local:${attempt._id}`, state: outcome,
    attemptId: attempt._id, deliveryKey: attempt.deliveryKey, contentHash: attempt.contentHash,
    approvalId: attempt.approval.actionId, source: attempt.source, recipient: attempt.recipient });
  return Object.freeze({ id, mode: 'LOCAL_SIMULATED', async send({ attempt }) { return receipt(attempt); },
    async reconcile({ attempt }) { return receipt(attempt); } });
}
