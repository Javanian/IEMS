import { createHash, randomUUID } from 'node:crypto';
import { createProviderRegistrationPolicy } from './provider-policy.mjs';

const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const revision = v => Number.isSafeInteger(v) && v > 0 && v < Number.MAX_SAFE_INTEGER;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };

export function createProviderReplyCommands({ db, transaction, authorize, verifyBindingSource, tenantId, accountId, now = () => Date.now() }) {
  if (!db?.collection || ![transaction, authorize, verifyBindingSource, now].every(v => typeof v === 'function')
    || !uuid(tenantId) || !id(accountId)) fail('INVALID_PROVIDER_REPLY_CONFIGURATION');
  const scope = { tenantId, accountId };
  return async (actor, input) => {
    const keys = ['commandId', 'replyId', 'recipient', 'customerId', 'contentHash', 'commandPrefix', 'policyRevision', 'identityVersion', 'bindingVersion', 'expiresAt'];
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== keys.length
      || !keys.every(k => Object.hasOwn(input, k)) || !uuid(input.commandId) || !uuid(input.replyId)
      || !id(input.recipient) || !uuid(input.customerId) || typeof input.contentHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(input.contentHash) || typeof input.commandPrefix !== 'string'
      || !/^[A-Z][A-Z0-9 ]{0,31} $/.test(input.commandPrefix)
      || !['policyRevision', 'identityVersion', 'bindingVersion'].every(k => revision(input[k]))
      || !Number.isSafeInteger(input.expiresAt)) fail('INVALID_PROVIDER_REPLY');
    const request = Object.fromEntries(keys.map(k => [k, input[k]]));
    const requestHash = createHash('sha256').update(JSON.stringify(['queueReply', request])).digest('hex');
    return transaction(async session => {
      if (!session?.inTransaction?.()) fail('PROVIDER_TRANSACTION_REQUIRED', 500);
      const grant = await authorize(actor, { ...scope, action: 'provider.reply.queue' }, session);
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
      const policy = await read('policy', 'account');
      const identity = await read('identity', request.recipient);
      const binding = await read('binding', request.recipient);
      const source = await verifyBindingSource({ bindingId: binding.sourceBindingId, version: binding.sourceBindingVersion,
        recipient: binding.recipient, customerId: binding.customerId }, session);
      if (!source || source.tenantId !== tenantId || source.accountId !== accountId || source.bindingId !== binding.sourceBindingId
        || source.version !== binding.sourceBindingVersion || source.recipient !== request.recipient || source.customerId !== request.customerId
        || !Number.isSafeInteger(source.expiresAt) || source.expiresAt < request.expiresAt) fail('PROVIDER_BINDING_SOURCE_DENIED', 403);
      // Validate the candidate against delivery policy without persisting approval or granting delivery authority.
      const candidate = { ...scope, ...request, mode: 'LIVE', state: 'APPROVED' };
      const validate = createProviderRegistrationPolicy({ ...scope, now: () => at, readAndFence: async () => ({ policy, identity, binding,
        reply: candidate, approval: { ...candidate, revoked: false, approvedBy: grant.userId } }) });
      await validate({ ...scope, replyId: request.replyId, deliveryId: request.commandId, ownerId: 'queue-validation', generation: 1 }, session);
      if (request.expiresAt > Math.min(policy.expiresAt, identity.expiresAt, binding.expiresAt, at + 30 * 86400000)) fail('INVALID_PROVIDER_REPLY_EXPIRY');
      const key = { ...scope, commandId: request.commandId };
      const prior = await db.collection('provider_commands').findOne(key, { session });
      if (prior) {
        if (prior.requestHash !== requestHash || prior.userId !== grant.userId) fail('PROVIDER_COMMAND_CONFLICT', 409);
        return prior.result;
      }
      const replyKey = { ...scope, kind: 'reply', resourceId: request.replyId };
      if (await db.collection('provider_authority').findOne(replyKey, { session })) fail('PROVIDER_REPLY_EXISTS', 409);
      const { commandId, ...metadata } = request;
      await db.collection('provider_authority').insertOne({ ...replyKey, ...metadata, authorityRevision: 1,
        mode: 'LIVE', state: 'QUEUED' }, { session });
      const result = { replyId: request.replyId, authorityRevision: 1, state: 'QUEUED' };
      const event = { ...scope, commandId, ...result, userId: grant.userId, at, type: 'provider.reply.queued' };
      await db.collection('provider_audit').insertOne({ _id: randomUUID(), ...event }, { session });
      await db.collection('provider_outbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
      await db.collection('provider_commands').insertOne({ ...key, requestHash, userId: grant.userId, result, at }, { session });
      return result;
    });
  };
}
