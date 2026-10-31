import { createHash, randomUUID } from 'node:crypto';

const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const revision = v => Number.isSafeInteger(v) && v >= 1 && v < Number.MAX_SAFE_INTEGER;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };

export function createProviderActivation({ db, transaction, authorize, verifyBindingSource, tenantId, accountId, now = () => Date.now() }) {
  if (!db?.collection || ![transaction, authorize, verifyBindingSource, now].every(v => typeof v === 'function')
    || !uuid(tenantId) || !id(accountId)) fail('INVALID_PROVIDER_ACTIVATION_CONFIGURATION');
  const scope = { tenantId, accountId };
  return async (actor, input) => {
    const keys = ['commandId', 'recipient', 'customerId', 'sourceBindingId', 'sourceBindingVersion', 'identityRevision', 'bindingRevision', 'expiresAt'];
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== keys.length
      || !keys.every(k => Object.hasOwn(input, k)) || !uuid(input.commandId) || !id(input.recipient)
      || !uuid(input.customerId) || !uuid(input.sourceBindingId) || !revision(input.sourceBindingVersion)
      || !revision(input.identityRevision) || !revision(input.bindingRevision) || !Number.isSafeInteger(input.expiresAt)) fail('INVALID_PROVIDER_ACTIVATION');
    const request = Object.fromEntries(keys.map(k => [k, input[k]]));
    const requestHash = createHash('sha256').update(JSON.stringify(['activateIdentityBinding', request])).digest('hex');
    return transaction(async session => {
      if (!session?.inTransaction?.()) fail('PROVIDER_TRANSACTION_REQUIRED', 500);
      const grant = await authorize(actor, { ...scope, action: 'provider.authority.configure' }, session);
      if (!grant || grant.tenantId !== tenantId || grant.accountId !== accountId || !uuid(grant.userId)) fail('PROVIDER_COMMAND_DENIED', 403);
      const source = await verifyBindingSource({ bindingId: request.sourceBindingId, version: request.sourceBindingVersion,
        recipient: request.recipient, customerId: request.customerId }, session);
      if (!source || source.tenantId !== tenantId || source.accountId !== accountId || source.bindingId !== request.sourceBindingId
        || source.version !== request.sourceBindingVersion || source.recipient !== request.recipient || source.customerId !== request.customerId
        || !Number.isSafeInteger(source.expiresAt) || source.expiresAt < request.expiresAt) fail('PROVIDER_BINDING_SOURCE_DENIED', 403);
      const key = { ...scope, commandId: request.commandId };
      const prior = await db.collection('provider_commands').findOne(key, { session });
      if (prior) {
        if (prior.requestHash !== requestHash || prior.userId !== grant.userId) fail('PROVIDER_COMMAND_CONFLICT', 409);
        return prior.result;
      }
      const at = now();
      if (!Number.isSafeInteger(at)) fail('INVALID_PROVIDER_COMMAND_TIME', 500);
      if (request.expiresAt <= at || request.expiresAt > at + 30 * 86400000) fail('INVALID_PROVIDER_ACTIVATION_EXPIRY');
      const result = { recipient: request.recipient };
      for (const kind of ['identity', 'binding']) {
        const rowKey = { ...scope, kind, resourceId: request.recipient, authorityRevision: request[`${kind}Revision`] };
        const row = await db.collection('provider_authority').findOne(rowKey, { session });
        if (!row || !revision(row.version)) fail('PROVIDER_AUTHORITY_FENCED', 409);
        const values = { recipient: request.recipient, active: true, expiresAt: request.expiresAt };
        if (kind === 'binding') Object.assign(values, { customerId: request.customerId,
          sourceBindingId: request.sourceBindingId, sourceBindingVersion: request.sourceBindingVersion });
        const changed = await db.collection('provider_authority').updateOne(rowKey,
          { $set: values, $inc: { authorityRevision: 1, version: 1 } }, { session });
        if (changed.matchedCount !== 1) fail('PROVIDER_AUTHORITY_FENCED', 409);
        result[`${kind}Revision`] = request[`${kind}Revision`] + 1;
        result[`${kind}Version`] = row.version + 1;
      }
      const event = { ...scope, commandId: request.commandId, ...result, userId: grant.userId, at, type: 'provider.identity_binding.activated' };
      await db.collection('provider_audit').insertOne({ _id: randomUUID(), ...event }, { session });
      await db.collection('provider_outbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
      await db.collection('provider_commands').insertOne({ ...key, requestHash, userId: grant.userId, result, at }, { session });
      return result;
    });
  };
}
