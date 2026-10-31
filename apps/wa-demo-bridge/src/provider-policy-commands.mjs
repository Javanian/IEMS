import { createHash, randomUUID } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };
const shape = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function createProviderPolicyCommands({ db, transaction, authorize, tenantId, accountId, now = () => Date.now() }) {
  if (!db?.collection || typeof transaction !== 'function' || typeof authorize !== 'function'
    || !uuid(tenantId) || !id(accountId) || typeof now !== 'function') fail('INVALID_PROVIDER_POLICY_CONFIGURATION');
  const scope = Object.freeze({ tenantId, accountId });
  return Object.freeze({
    async configurePolicy(actor, input) {
      if (!shape(input, ['commandId', 'expectedRevision', 'policy']) || !uuid(input.commandId)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
        || input.expectedRevision >= Number.MAX_SAFE_INTEGER) fail('INVALID_PROVIDER_POLICY_UPDATE');
      const p = input.policy;
      if (!shape(p, ['enabled', 'paused', 'expiresAt', 'allowlist', 'prefix'])
        || typeof p.enabled !== 'boolean' || typeof p.paused !== 'boolean' || !Number.isSafeInteger(p.expiresAt)
        || !Array.isArray(p.allowlist) || p.allowlist.length > 100 || !p.allowlist.every(id)
        || new Set(p.allowlist).size !== p.allowlist.length
        || typeof p.prefix !== 'string' || !/^[A-Z][A-Z0-9 ]{0,31} $/.test(p.prefix)) fail('INVALID_PROVIDER_POLICY_UPDATE');
      const policy = { enabled: p.enabled, paused: p.paused, expiresAt: p.expiresAt,
        allowlist: [...p.allowlist].sort(), prefix: p.prefix };
      const { commandId, expectedRevision } = input;
      const requestHash = createHash('sha256').update(JSON.stringify(['configurePolicy', expectedRevision, policy])).digest('hex');
      return transaction(async session => {
        if (!session?.inTransaction?.()) fail('PROVIDER_TRANSACTION_REQUIRED', 500);
        const grant = await authorize(actor, Object.freeze({ ...scope, action: 'provider.authority.configure' }), session);
        if (!grant || grant.tenantId !== tenantId || grant.accountId !== accountId || !uuid(grant.userId)) fail('PROVIDER_COMMAND_DENIED', 403);
        const key = { ...scope, commandId };
        const prior = await db.collection('provider_commands').findOne(key, { session });
        if (prior) {
          if (prior.requestHash !== requestHash || prior.userId !== grant.userId) fail('PROVIDER_COMMAND_CONFLICT', 409);
          return prior.result;
        }
        const at = now();
        if (!Number.isSafeInteger(at)) fail('INVALID_PROVIDER_COMMAND_TIME', 500);
        if (policy.expiresAt <= at || policy.expiresAt > at + 30 * 86400000) fail('INVALID_PROVIDER_POLICY_EXPIRY');
        const rowKey = { ...scope, kind: 'policy', resourceId: 'account', authorityRevision: expectedRevision };
        const row = await db.collection('provider_authority').findOne(rowKey, { session });
        if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1
          || row.revision >= Number.MAX_SAFE_INTEGER) fail('PROVIDER_AUTHORITY_FENCED', 409);
        const updated = await db.collection('provider_authority').updateOne(rowKey,
          { $set: policy, $inc: { authorityRevision: 1, revision: 1 } }, { session });
        if (updated.matchedCount !== 1) fail('PROVIDER_AUTHORITY_FENCED', 409);
        const result = { kind: 'policy', resourceId: 'account', authorityRevision: expectedRevision + 1, policyRevision: row.revision + 1 };
        const event = { ...scope, commandId, ...result, userId: grant.userId, at, type: 'provider.policy.configured' };
        await db.collection('provider_audit').insertOne({ _id: randomUUID(), ...event }, { session });
        await db.collection('provider_outbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await db.collection('provider_commands').insertOne({ ...key, requestHash, userId: grant.userId, result, at }, { session });
        return result;
      });
    },
  });
}
