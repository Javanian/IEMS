import { createProviderRevocationCommands } from './provider-commands.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const denied = () => { throw Object.assign(new Error('PROVIDER_OPERATOR_DENIED'), { status: 403 }); };

export const providerOperatorRoles = Object.freeze({
  providerAuthorityAdmin: Object.freeze(['provider.authority.revoke', 'provider.authority.provision']),
});

export function createScopedProviderRevocationCommands({ db, transaction, foundation, tenantId, plantId, accountId, now }) {
  const authorize = createProviderOperatorAuthorization({ foundation, tenantId, plantId, accountId });
  return createProviderRevocationCommands({ db, transaction, authorize, tenantId, accountId, now });
}

// The composition root owns this immutable account-to-plant mapping; never derive it from a request.
export function createProviderOperatorAuthorization({ foundation, tenantId, plantId, accountId }) {
  if (typeof foundation?.authorizeInTransaction !== 'function' || !uuid(tenantId) || !uuid(plantId)
    || !identifier(accountId)) throw new Error('INVALID_PROVIDER_OPERATOR_CONFIGURATION');
  return async (actor, request, session) => {
    if (!session?.inTransaction?.() || !request || Object.getPrototypeOf(request) !== Object.prototype
      || Object.keys(request).some(key => !['tenantId', 'accountId', 'action'].includes(key))
      || request.tenantId !== tenantId || request.accountId !== accountId
      || !providerOperatorRoles.providerAuthorityAdmin.includes(request.action)) denied();
    const grant = await foundation.authorizeInTransaction(actor,
      { tenantId, plantId, action: request.action }, { session });
    if (!grant || grant.tenantId !== tenantId || grant.plantId !== plantId || !uuid(grant.userId)) denied();
    return Object.freeze({ tenantId, accountId, userId: grant.userId });
  };
}
