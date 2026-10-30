import { createHash, randomUUID } from 'node:crypto';
import { createProviderRegistrationPolicy } from './provider-policy.mjs';

const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const revision = v => Number.isSafeInteger(v) && v > 0 && v < Number.MAX_SAFE_INTEGER;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };

export function createProviderApprovalCommands({ db, transaction, authorize, verifyBindingSource, tenantId, accountId, now = () => Date.now() }) {
  if (!db?.collection || ![transaction, authorize, verifyBindingSource, now].every(v => typeof v === 'function')
    || !uuid(tenantId) || !id(accountId)) fail('INVALID_PROVIDER_APPROVAL_CONFIGURATION');
  const scope = { tenantId, accountId };
  return async (actor, input) => {
    const keys = ['commandId', 'replyId', 'recipient', 'customerId', 'contentHash', 'commandPrefix', 'policyRevision', 'identityVersion', 'bindingVersion', 'expiresAt', 'expectedReplyRevision'];
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== keys.length
      || !keys.every(k => Object.hasOwn(input, k)) || !uuid(input.commandId) || !uuid(input.replyId)
      || !id(input.recipient) || !uuid(input.customerId) || typeof input.contentHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(input.contentHash) || typeof input.commandPrefix !== 'string'
      || !/^[A-Z][A-Z0-9 ]{0,31} $/.test(input.commandPrefix)
      || !['policyRevision', 'identityVersion', 'bindingVersion', 'expectedReplyRevision'].every(k => revision(input[k]))
      || !Number.isSafeInteger(input.expiresAt)) fail('INVALID_PROVIDER_APPROVAL');
    const request = Object.fromEntries(keys.map(k => [k, input[k]]));
    const requestHash = createHash('sha256').update(JSON.stringify(['approveReply', request])).digest('hex');
    return transaction(async session => {
      if (!session?.inTransaction?.()) fail('PROVIDER_TRANSACTION_REQUIRED', 500);
      const grant = await authorize(actor, { ...scope, action: 'provider.reply.approve' }, session);
      if (!grant || grant.tenantId !== tenantId || grant.accountId !== accountId || !uuid(grant.userId)) fail('PROVIDER_COMMAND_DENIED', 403);
      const at = now();
      if (!Number.isSafeInteger(at)) fail('INVALID_PROVIDER_COMMAND_TIME', 500);
      async function read(kind, resourceId) {
        const key = { ...scope, kind, resourceId };
        const row = await db.collection('provider_authority').findOne(key, { session });
        if (!row || !revision(row.authorityRevision)) fail('PROVIDER_AUTHORITY_FENCED', 403);
        const changed = await db.collection('provider_authority').updateOne({ ...key, authorityRevision: row.authorityRevision },
          { $inc: { registrationFences: 1 } }, { session });
        if (changed.matchedCount !== 1) fail('PROVIDER_AUTHORITY_FENCED', 403);
        return row;
      }
      const reply = await read('reply', request.replyId);
      const metadataKeys = keys.filter(k => !['commandId', 'expectedReplyRevision'].includes(k));
      if (reply.mode !== 'LIVE' || !metadataKeys.every(k => reply[k] === request[k])) fail('PROVIDER_REPLY_METADATA_CONFLICT', 409);
      const policy = await read('policy', 'account');
      const identity = await read('identity', request.recipient);
      const binding = await read('binding', request.recipient);
      const source = await verifyBindingSource({ bindingId: binding.sourceBindingId, version: binding.sourceBindingVersion,
        recipient: binding.recipient, customerId: binding.customerId }, session);
      if (!source || source.tenantId !== tenantId || source.accountId !== accountId || source.bindingId !== binding.sourceBindingId
        || source.version !== binding.sourceBindingVersion || source.recipient !== request.recipient || source.customerId !== request.customerId
        || !Number.isSafeInteger(source.expiresAt) || source.expiresAt < request.expiresAt) fail('PROVIDER_BINDING_SOURCE_DENIED', 403);
      // Approval validates the exact queued metadata against current authority before receipt lookup.
      const candidate = { ...scope, ...request, mode: 'LIVE', state: 'APPROVED' };
      const validate = createProviderRegistrationPolicy({ ...scope, now: () => at, readAndFence: async () => ({ policy, identity, binding,
        reply: candidate, approval: { ...candidate, revoked: false, approvedBy: grant.userId } }) });
      await validate({ ...scope, replyId: request.replyId, deliveryId: request.commandId, ownerId: 'approval-validation', generation: 1 }, session);
      if (request.expiresAt > Math.min(policy.expiresAt, identity.expiresAt, binding.expiresAt, at + 30 * 86400000)) fail('INVALID_PROVIDER_APPROVAL_EXPIRY');
      const key = { ...scope, commandId: request.commandId };
      const prior = await db.collection('provider_commands').findOne(key, { session });
      if (prior) {
        if (prior.requestHash !== requestHash || prior.userId !== grant.userId) fail('PROVIDER_COMMAND_CONFLICT', 409);
        if (reply.state !== 'APPROVED') fail('PROVIDER_APPROVAL_REVOKED', 403);
        const approval = await read('approval', request.replyId);
        if (approval.revoked !== false || approval.state !== 'APPROVED' || approval.approvedBy !== grant.userId
          || !metadataKeys.filter(k => k !== 'commandPrefix').every(k => approval[k] === request[k])) fail('PROVIDER_APPROVAL_REVOKED', 403);
        return prior.result;
      }
      const replyKey = { ...scope, kind: 'reply', resourceId: request.replyId };
      if (reply.state !== 'QUEUED' || reply.authorityRevision !== request.expectedReplyRevision) fail('PROVIDER_REPLY_REVISION_CONFLICT', 409);
      const approvalKey = { ...scope, kind: 'approval', resourceId: request.replyId };
      if (await db.collection('provider_authority').findOne(approvalKey, { session })) fail('PROVIDER_APPROVAL_EXISTS', 409);
      const updated = await db.collection('provider_authority').updateOne({ ...replyKey, state: 'QUEUED', authorityRevision: request.expectedReplyRevision },
        { $set: { state: 'APPROVED' }, $inc: { authorityRevision: 1 } }, { session });
      if (updated.matchedCount !== 1) fail('PROVIDER_REPLY_REVISION_CONFLICT', 409);
      const { commandId, expectedReplyRevision, ...metadata } = request;
      await db.collection('provider_authority').insertOne({ ...approvalKey, ...metadata, authorityRevision: 1,
        revoked: false, approvedBy: grant.userId, state: 'APPROVED' }, { session });
      const result = { replyId: request.replyId, authorityRevision: expectedReplyRevision + 1, state: 'APPROVED' };
      const event = { ...scope, commandId, ...result, userId: grant.userId, at, type: 'provider.reply.approved' };
      await db.collection('provider_audit').insertOne({ _id: randomUUID(), ...event }, { session });
      await db.collection('provider_outbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
      await db.collection('provider_commands').insertOne({ ...key, requestHash, userId: grant.userId, result, at }, { session });
      return result;
    });
  };
}
