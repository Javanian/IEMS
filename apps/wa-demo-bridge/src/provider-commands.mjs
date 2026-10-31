import { createHash, randomUUID } from 'node:crypto';
import { revokeProviderAuthority } from './provider-authority.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };

export async function initializeProviderCommands(db) {
  await db.collection('provider_commands').createIndex({ tenantId: 1, accountId: 1, commandId: 1 }, { unique: true });
}

// authorize must write-fence current account/operator authority in the supplied session.
// transaction must commit all writes atomically; unknown commits are reconciled with the same commandId.
export function createProviderRevocationCommands({ db, transaction, authorize, tenantId, accountId, now = () => new Date() }) {
  if (!db?.collection || typeof transaction !== 'function' || typeof authorize !== 'function'
    || !uuid(tenantId) || !identifier(accountId) || typeof now !== 'function') fail('INVALID_PROVIDER_COMMAND_CONFIGURATION');
  const scope = Object.freeze({ tenantId, accountId });
  return Object.freeze({
    async revoke(actor, input) {
      if (!input || Object.keys(input).some(key => !['commandId', 'kind', 'resourceId', 'expectedRevision'].includes(key))
        || !uuid(input.commandId) || !['policy', 'identity', 'binding', 'reply', 'approval'].includes(input.kind)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= Number.MAX_SAFE_INTEGER
        || (input.kind === 'policy' ? input.resourceId !== 'account'
          : ['reply', 'approval'].includes(input.kind) ? !uuid(input.resourceId) : !identifier(input.resourceId))) fail('INVALID_PROVIDER_COMMAND');
      const { commandId, kind, resourceId, expectedRevision } = input;
      const requestHash = createHash('sha256').update(JSON.stringify([kind, resourceId, expectedRevision])).digest('hex');
      return transaction(async session => {
        if (!session) fail('PROVIDER_TRANSACTION_REQUIRED', 500);
        const grant = await authorize(actor, Object.freeze({ ...scope, action: 'provider.authority.revoke' }), session);
        if (!grant || grant.tenantId !== tenantId || grant.accountId !== accountId || !uuid(grant.userId)) fail('PROVIDER_COMMAND_DENIED', 403);
        const key = { ...scope, commandId };
        const prior = await db.collection('provider_commands').findOne(key, { session });
        if (prior) {
          if (prior.requestHash !== requestHash || prior.userId !== grant.userId) fail('PROVIDER_COMMAND_CONFLICT', 409);
          return prior.result;
        }
        const result = await revokeProviderAuthority({ db, ...scope, kind, resourceId, expectedRevision }, session);
        const at = now();
        if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail('INVALID_PROVIDER_COMMAND_TIME', 500);
        const event = { ...scope, commandId, kind, resourceId, authorityRevision: result.authorityRevision,
          userId: grant.userId, at, type: 'provider.authority.revoked' };
        await db.collection('provider_audit').insertOne({ _id: randomUUID(), ...event }, { session });
        await db.collection('provider_outbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await db.collection('provider_commands').insertOne({ ...key, requestHash, userId: grant.userId, result, at }, { session });
        return result;
      });
    },
  });
}
