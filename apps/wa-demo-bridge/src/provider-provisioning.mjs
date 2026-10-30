import { createHash, randomUUID } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };
const shape = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Initial provisioning cannot activate a recipient or enable sending.
export function createProviderProvisioningCommands({ db, transaction, authorize, tenantId, accountId, now = () => Date.now() }) {
  if (!db?.collection || typeof transaction !== 'function' || typeof authorize !== 'function'
    || !uuid(tenantId) || !id(accountId) || typeof now !== 'function') fail('INVALID_PROVIDER_PROVISIONING_CONFIGURATION');
  const scope = Object.freeze({ tenantId, accountId });
  return Object.freeze({
    async provision(actor, input) {
      if (!shape(input, ['commandId', 'kind', 'resourceId', 'metadata']) || !uuid(input.commandId)) fail('INVALID_PROVIDER_PROVISIONING');
      const { commandId, kind, resourceId } = input;
      const data = input.metadata;
      let metadata;
      if (kind === 'policy' && resourceId === 'account' && shape(data, ['expiresAt', 'allowlist', 'prefix'])
        && Array.isArray(data.allowlist) && data.allowlist.length <= 100 && data.allowlist.every(id)
        && new Set(data.allowlist).size === data.allowlist.length
        && typeof data.prefix === 'string' && /^[A-Z][A-Z0-9 ]{0,31} $/.test(data.prefix)) {
        metadata = { expiresAt: data.expiresAt, allowlist: [...data.allowlist].sort(), prefix: data.prefix,
          enabled: false, paused: true, revision: 1 };
      } else if (kind === 'identity' && id(resourceId) && shape(data, ['expiresAt'])) {
        metadata = { expiresAt: data.expiresAt, recipient: resourceId, active: false, version: 1 };
      } else if (kind === 'binding' && id(resourceId) && shape(data, ['expiresAt', 'customerId']) && uuid(data.customerId)) {
        metadata = { expiresAt: data.expiresAt, customerId: data.customerId, recipient: resourceId, active: false, version: 1 };
      } else fail('INVALID_PROVIDER_PROVISIONING');
      if (!Number.isSafeInteger(metadata.expiresAt)) fail('INVALID_PROVIDER_PROVISIONING');
      const requestHash = createHash('sha256').update(JSON.stringify(['provision', kind, resourceId, metadata])).digest('hex');
      return transaction(async session => {
        if (!session?.inTransaction?.()) fail('PROVIDER_TRANSACTION_REQUIRED', 500);
        const grant = await authorize(actor, Object.freeze({ ...scope, action: 'provider.authority.provision' }), session);
        if (!grant || grant.tenantId !== tenantId || grant.accountId !== accountId || !uuid(grant.userId)) fail('PROVIDER_COMMAND_DENIED', 403);
        const key = { ...scope, commandId };
        const prior = await db.collection('provider_commands').findOne(key, { session });
        if (prior) {
          if (prior.requestHash !== requestHash || prior.userId !== grant.userId) fail('PROVIDER_COMMAND_CONFLICT', 409);
          return prior.result;
        }
        const at = now();
        if (!Number.isSafeInteger(at)) fail('INVALID_PROVIDER_COMMAND_TIME', 500);
        if (metadata.expiresAt <= at || metadata.expiresAt > at + 30 * 86400000) fail('INVALID_PROVIDER_PROVISIONING_EXPIRY');
        const authorityKey = { ...scope, kind, resourceId };
        if (await db.collection('provider_authority').findOne(authorityKey, { session })) fail('PROVIDER_AUTHORITY_EXISTS', 409);
        const result = { kind, resourceId, authorityRevision: 1 };
        await db.collection('provider_authority').insertOne({ ...authorityKey, ...metadata, authorityRevision: 1 }, { session });
        const event = { ...scope, commandId, kind, resourceId, authorityRevision: 1,
          userId: grant.userId, at, type: 'provider.authority.provisioned' };
        await db.collection('provider_audit').insertOne({ _id: randomUUID(), ...event }, { session });
        await db.collection('provider_outbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await db.collection('provider_commands').insertOne({ ...key, requestHash, userId: grant.userId, result, at }, { session });
        return result;
      });
    },
  });
}
