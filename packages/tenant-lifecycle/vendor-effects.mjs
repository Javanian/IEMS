import { randomUUID } from 'node:crypto';
import { canonicalJson, contentHash, CommandError } from '../tenant-foundation/commands.mjs';
import { controlledVendorProvider } from './local-ai-provider.mjs';
import { effectHash, effectTransaction } from './effects.mjs';
const fail = (code, status = 409) => { throw new CommandError(code, status); };
export function createManagedVendorBoundary({ client, db, foundation, saasAdmission, separateEffects: effects, authority,
  transport, clock, timeoutMs, find, checkSource, checkRecipient, settleBody }) {
  const provider = controlledVendorProvider(transport);
  if (!provider || !effects?.hasAdapter('local.vendor')) fail('AI_VENDOR_ADAPTER_UNPROVEN', 503);
  const controls = db.collection('saasEffectCommands'), attempts = db.collection('aiVendorDeliveryAttempts'), drafts = db.collection('aiVendorDrafts');
  const results = db.collection('foundationCommandResults'), tx = work => effectTransaction(client, work);
  const filter = (grant, id) => ({ _id: id, tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId });
  const authorize = (scope, plantId, action, session) => foundation.authorizeInTransaction(scope, { tenantId: scope?.tenantId, plantId, action }, { session });
  async function approver(grant, row, session, fence = true) {
    const approved = await db.collection('aiVendorApprovals').findOne({ ...filter(grant, row.approval?.actionId), draftId: row._id, kind: 'APPROVED' }, { session });
    if (!approved || contentHash(approved.approval) !== contentHash(row.approval)) fail('AI_VENDOR_APPROVAL_INVALID');
    const user = await db.collection('users').findOne({ _id: row.approval.actorId, active: true }, { session }), member = await db.collection('memberships').findOne({ tenantId: grant.tenantId, userId: row.approval.actorId, active: true }, { session });
    if (!user || !member || !Array.isArray(member.roles) || !member.roles.some(role => role.role === 'vendorDraftApprover' && (role.tenantWide || role.plantIds?.includes(grant.plantId))) ||
        !member.tenantWide && (!member.plantIds?.includes(grant.plantId) || !member.legalEntityIds?.includes(grant.legalEntityId))) fail('AI_VENDOR_APPROVER_REVOKED', 403);
    if (fence) for (const [name, predicate] of [['users', { _id: user._id, active: true }], ['memberships', { _id: member._id, active: true, version: member.version }]]) {
      if ((await db.collection(name).updateOne(predicate, { $inc: { authorizationFence: 1 } }, { session })).matchedCount !== 1) fail('AI_VENDOR_APPROVER_REVOKED', 403);
    }
  }
  async function binding(scope, grant, command, session, observation = false) {
    const row = await find(grant, command.plan.draftId, session), attempt = await attempts.findOne({ ...filter(grant, command.plan.businessAttemptId), draftId: row._id }, { session });
    if (!attempt || row.attemptId !== attempt._id || attempt.providerId !== provider.id || attempt.controlCommandId !== command._id ||
        attempt.deliveryKey !== command.plan.deliveryKey || row.contentHash !== command.plan.contentHash || attempt.contentHash !== command.plan.contentHash ||
        contentHash(attempt.source) !== command.plan.sourceReferenceHash || contentHash(row.source) !== command.plan.sourceReferenceHash ||
        contentHash(attempt.approval) !== command.plan.approvalHash || contentHash(row.approval) !== command.plan.approvalHash ||
        contentHash(attempt.recipient) !== command.plan.recipientHash || contentHash(row.recipient) !== command.plan.recipientHash) fail('AI_VENDOR_ATTEMPT_BINDING_CHANGED');
    await checkSource(scope, grant, row.source, session, !observation);
    if (!observation) {
      if (row.revoked) fail('AI_VENDOR_APPROVAL_REVOKED', 403);
      await checkRecipient(grant, row, session); await approver(grant, row, session);
    }
    return { row, attempt };
  }
  const origin = scope => ({ context: { scope }, authorize: async ({ command, session, observation }) => {
    const grant = await authorize(scope, command.plantId, observation ? 'ai.vendor.reconcile' : 'ai.vendor.deliver', session);
    await binding(scope, grant, command, session, observation);
    if (!observation) await saasAdmission?.authorize(scope, { plantId: command.plantId, session });
    return grant;
  } });
  async function readOnly(scope, input, suppliedSession) {
    const target = { tenantId: scope?.tenantId, plantId: input.plantId, action: 'ai.vendor.read' }, grant = await foundation.authorize(scope, target);
    const sourceGrant = await foundation.authorize(scope, { ...target, action: 'ai.vendor.source.read' });
    if (effectHash(grant) !== effectHash(sourceGrant)) fail('SCOPE_DENIED', 403);
    const read = async session => {
      const row = await find(grant, input.draftId, session), reference = Object.fromEntries(Object.entries(row.source).filter(([key]) => key !== 'sourceHash'));
      const source = await authority.source({ grant, reference, session });
      if (contentHash({ cohort: source.cohort, vendorId: source.vendorId, orderId: source.orderId, documentRevision: source.documentRevision, sourceHash: source.sourceHash }) !== contentHash(row.source)) fail('AI_VENDOR_SOURCE_CHANGED');
      if (row.recipient) {
        if (typeof authority.readRecipient !== 'function') fail('AI_VENDOR_OBSERVATION_PORT_REQUIRED', 503);
        if (contentHash(await authority.readRecipient({ grant: sourceGrant, vendorId: row.source.vendorId, grantId: row.recipient.grantId, session })) !== contentHash(row.recipient)) fail('AI_VENDOR_RECIPIENT_CHANGED');
      }
      const attempt = row.attemptId ? await attempts.findOne({ ...filter(grant, row.attemptId), draftId: row._id }, { session }) : null;
      return { schema: 'VENDOR_DRAFT_V1', draftId: row._id, revision: row.revision, state: row.state, text: row.text, contentHash: row.contentHash,
        source: row.source, recipient: row.recipient ?? null, preview: row.preview ?? null, approval: row.approval ?? null,
        attempt: attempt ? { attemptId: attempt._id, state: attempt.state, mode: attempt.mode, providerId: attempt.providerId,
          receipt: attempt.receipt ?? null, ...(attempt.controlCommandId ? { effect: { commandId: attempt.controlCommandId, phase: 'VENDOR' } } : {}) } : null,
        liveDeliveryEnabled: false, mode: 'LOCAL_SIMULATED' };
    };
    const result = suppliedSession ? await read(suppliedSession) : await tx(read);
    if (effectHash(await foundation.authorize(scope, target)) !== effectHash(grant) || effectHash(await foundation.authorize(scope, { ...target, action: 'ai.vendor.source.read' })) !== effectHash(sourceGrant)) fail('SCOPE_DENIED', 403);
    return result;
  }
  effects.registerKind('ai.vendor.delivery', {
    adapterId: 'local.vendor', providerId: provider.id, phases: () => ['VENDOR'], statusAction: 'ai.vendor.read',
    rebind: async ({ scope }) => origin(scope),
    readStatus: async ({ scope, grant, command, session }) => { const row = await readOnly(scope, { plantId: grant.plantId, draftId: command.plan.draftId }, session); if (row.attempt?.effect?.commandId !== command._id) fail('AI_VENDOR_ATTEMPT_BINDING_CHANGED'); },
    observe: ({ attempt, session }) => provider.observe(attempt, { session }),
    stopProvider: input => provider.stopAndDrain(input), verifyProviderBarrier: input => provider.verifyBarrier(input),
    prepare: async ({ command, attempt, session, context }) => {
      const grant = await authorize(context.scope, command.plantId, 'ai.vendor.deliver', session), { row, attempt: business } = await binding(context.scope, grant, command, session);
      if (row.state !== 'PENDING' || business.state !== 'PENDING') fail('AI_VENDOR_RECONCILE_REQUIRED');
      const write = await attempts.updateOne({ ...filter(grant, business._id), state: 'PENDING', controlCommandId: command._id }, { $set: {
        state: 'DISPATCHING', owner: attempt._id, phaseAttemptId: attempt._id, phaseFence: attempt.fence, leaseUntil: new Date(clock().getTime() + timeoutMs + 1000).toISOString() } }, { session });
      if (write.matchedCount !== 1 || (await drafts.updateOne({ ...filter(grant, row._id), revision: row.revision, state: 'PENDING' }, { $set: { state: 'DISPATCHING' } }, { session })).matchedCount !== 1) fail('AI_VENDOR_RECONCILE_REQUIRED');
      await db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: 'ai.vendor.dispatch.claimed', subjectId: row._id, attemptId: business._id, owner: attempt._id, occurredAt: clock() }, { session });
      return { providerId: provider.id, businessAttemptId: business._id, contentHash: business.contentHash, approvalHash: command.plan.approvalHash, recipientHash: command.plan.recipientHash };
    },
    beforeInvoke: async ({ command, attempt, session }) => {
      const row = await attempts.findOne({ ...filter(command, command.plan.businessAttemptId), controlCommandId: command._id, owner: attempt._id, phaseFence: attempt.fence, state: 'DISPATCHING' }, { session });
      if (!row || Date.parse(row.leaseUntil) <= clock().getTime()) fail('AI_VENDOR_RECONCILE_REQUIRED');
    },
    invoke: ({ attempt }) => transport.send({ phaseAttempt: attempt }),
    publish: async ({ command, attempt, session, observation, capability, context }) => {
      const proof = await effects.worker(capability, { session, publish: true });
      if (proof.command._id !== command._id || proof.command.kind !== 'ai.vendor.delivery') fail('AI_VENDOR_CAPABILITY_REQUIRED', 403);
      const grant = await authorize(context.scope, command.plantId, 'ai.vendor.reconcile', session), { attempt: business } = await binding(context.scope, grant, command, session);
      const receipt = observation.result, matched = receipt && receipt.source && receipt.recipient && receipt.operation === 'VENDOR' && receipt.mode === 'LOCAL_SIMULATED' && receipt.providerId === business.providerId &&
        receipt.attemptId === business._id && receipt.deliveryKey === business.deliveryKey && receipt.contentHash === business.contentHash && receipt.approvalId === business.approval.actionId &&
        contentHash(receipt.source) === contentHash(business.source) && contentHash(receipt.recipient) === contentHash(business.recipient) && typeof receipt.receiptId === 'string' && receipt.receiptId.length > 0;
      if (!matched || !['CONFIRMED', 'ACCEPTED', 'NOT_PERFORMED'].includes(receipt.state)) fail('AI_VENDOR_PROVIDER_PROOF_REQUIRED');
      return settleBody(context.scope, { plantId: command.plantId, draftId: command.plan.draftId, attemptId: business._id }, business, receipt, attempt._id, { session, grant }, true, receipt.state);
    },
  });
  async function commandFor(scope, input) {
    return tx(async session => {
      const grant = await authorize(scope, input.plantId, 'ai.vendor.reconcile', session), row = await find(grant, input.draftId, session), business = await attempts.findOne({ ...filter(grant, input.attemptId), draftId: row._id }, { session });
      if (!business?.controlCommandId || row.attemptId !== business._id) fail('HISTORICAL_EFFECT_BINDING_REQUIRED');
      const command = await controls.findOne({ _id: business.controlCommandId, tenantId: grant.tenantId, kind: 'ai.vendor.delivery' }, { session });
      if (!command || command.plan.businessAttemptId !== business._id || command.actor.userId !== grant.userId || command.actor.membershipId !== grant.membershipId) fail('AI_VENDOR_CAPABILITY_REQUIRED', 403);
      return command;
    });
  }
  return Object.freeze({ read: readOnly,
    async intent(scope, input, domainEffect) {
      if (typeof input.key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.key) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER) fail('INVALID_COMMAND', 400);
      const action = 'ai.vendor.deliver', digest = contentHash({ action, aggregateId: input.draftId, expectedRevision: input.expectedRevision, input });
      return tx(async session => {
        const grant = await authorize(scope, input.plantId, action, session), identity = { tenantId: grant.tenantId, plantId: grant.plantId, userId: grant.userId, action, key: input.key };
        const previous = await results.findOne(identity, { session });
        if (previous && previous.inputHash !== digest) fail('IDEMPOTENCY_CONFLICT');
        if (previous) {
          const control = await effects.managed('foundationCommandResults', identity, { session });
          if (!control || control.owner.payloadHash !== digest || effectHash(previous.response) !== control.owner.resultHash) fail('HISTORICAL_EFFECT_BINDING_REQUIRED');
          await binding(scope, grant, control, session); await saasAdmission?.effect({ scope, grant, session, namespace: 'foundationCommandResults', key: input.key, action, aggregateId: input.draftId, payloadHash: digest, replayed: true });
          effects.bind(control._id, origin(scope)); return { ...previous.response, replayed: true, effect: { commandId: control._id, phase: 'VENDOR' } };
        }
        await saasAdmission?.effect({ scope, grant, session, namespace: 'foundationCommandResults', key: input.key, action, aggregateId: input.draftId, payloadHash: digest, replayed: false });
        const output = await domainEffect({ session, grant, aggregateId: input.draftId, expectedRevision: input.expectedRevision, input });
        if (output.revision !== input.expectedRevision + 1 || !Array.isArray(output.events) || output.events.length > 100) fail('INVALID_COMMAND_RESULT', 500);
        canonicalJson(output.data);
        const row = await find(grant, input.draftId, session), business = await attempts.findOne({ ...filter(grant, input.attemptId), draftId: input.draftId }, { session });
        if (!business || business.providerId !== provider.id) fail('AI_VENDOR_ADAPTER_UNPROVEN'); await approver(grant, row, session);
        const occurredAt = new Date(), receiptId = randomUUID(), response = { data: output.data, revision: output.revision, commandId: receiptId, replayed: false }, controlId = randomUUID();
        await attempts.updateOne({ ...filter(grant, business._id), state: 'PENDING' }, { $set: { controlCommandId: controlId } }, { session });
        const control = await effects.accept({ session, id: controlId, grant, actor: { type: 'USER', userId: grant.userId, membershipId: grant.membershipId },
          owner: { namespace: 'foundationCommandResults', identity, hashField: 'inputHash', payloadHash: digest, resultPath: 'response', resultHash: effectHash(response) }, kind: 'ai.vendor.delivery',
          plan: { providerId: provider.id, draftId: row._id, businessAttemptId: business._id, attemptIds: [business._id], deliveryKey: business.deliveryKey, contentHash: business.contentHash,
            approvalHash: contentHash(business.approval), sourceReferenceHash: contentHash(business.source), recipientHash: contentHash(business.recipient) }, accepted: output.data, origin: origin(scope) });
        await results.insertOne({ _id: receiptId, ...identity, inputHash: digest, response, occurredAt }, { session });
        await db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: action, subjectId: input.draftId, revision: output.revision, commandId: receiptId, occurredAt }, { session });
        if (output.events.length) await db.collection('outbox').insertMany(output.events.map(event => {
          canonicalJson(event.data); if (!event.type || !Number.isSafeInteger(event.version) || event.version < 1) fail('INVALID_EVENT', 500);
          return { _id: randomUUID(), tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, aggregateId: input.draftId, aggregateRevision: output.revision, type: event.type,
            schemaVersion: event.version, data: event.data, occurredAt, commandId: receiptId, publishedAt: null };
        }), { session });
        return { ...response, effect: { commandId: control._id, phase: 'VENDOR' } };
      });
    },
    async dispatch(scope, input) { const command = await commandFor(scope, input); await effects.rebind(scope, command._id); return effects.run(command._id, 'VENDOR'); },
    async reconcile(scope, input) { const command = await commandFor(scope, input); await effects.rebind(scope, command._id); return effects.observe(command._id, 'VENDOR'); },
  });
}
