const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const denied = () => { throw Object.assign(new Error('PROVIDER_BINDING_SOURCE_DENIED'), { status: 403 }); };

// verifiedMethods comes from trusted composition, never from a request or a binding row.
export function createProviderBindingSource({ db, partyDirectory, tenantId, plantId, accountId, verifiedMethods, now = () => Date.now() }) {
  if (!db?.collection || typeof partyDirectory?.verifyCustomerContact !== 'function'
    || !uuid(tenantId) || !uuid(plantId) || !id(accountId) || typeof now !== 'function'
    || !Array.isArray(verifiedMethods) || !verifiedMethods.length
    || !verifiedMethods.every(value => id(value) && !['ADMIN_FIXTURE', 'OPERATOR_ONBOARDING'].includes(value))) {
    throw new Error('INVALID_PROVIDER_BINDING_SOURCE_CONFIGURATION');
  }
  const methods = new Set(verifiedMethods);
  return async (request, session) => {
    if (!session?.inTransaction?.() || !request || Object.getPrototypeOf(request) !== Object.prototype
      || Object.keys(request).length !== 4 || !['bindingId', 'version', 'recipient', 'customerId'].every(k => Object.hasOwn(request, k))
      || !uuid(request.bindingId) || !uuid(request.customerId) || !id(request.recipient)
      || !Number.isSafeInteger(request.version) || request.version < 1) denied();
    const key = { _id: request.bindingId, tenantId, plantId, channelAccountId: accountId,
      providerContactId: request.recipient, customerId: request.customerId, version: request.version, status: 'ACTIVE' };
    const projection = Object.fromEntries(['_id', 'accountId', 'contactId', 'channel', 'synthetic', 'verifiedMethod', 'verifiedAt', 'expiresAt'].map(k => [k, 1]));
    const row = await db.collection('cs_contact_bindings').findOne(key, { session, projection });
    const at = now();
    if (!Number.isSafeInteger(at) || !row || row.synthetic !== false || !methods.has(row.verifiedMethod)
      || typeof row.channel !== 'string' || ['SIMULATED', 'FIXTURE'].includes(row.channel)
      || row.accountId !== request.customerId || !uuid(row.contactId)
      || !(row.verifiedAt instanceof Date) || !Number.isFinite(row.verifiedAt.getTime()) || row.verifiedAt.getTime() > at
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt.getTime() <= at) denied();
    const party = await partyDirectory.verifyCustomerContact({ tenantId, plantId, accountId: row.accountId, contactId: row.contactId }, { session });
    if (!party) denied();
    const fenced = await db.collection('cs_contact_bindings').updateOne(key, { $inc: { commandFence: 1 } }, { session });
    if (fenced.matchedCount !== 1) denied();
    return Object.freeze({ tenantId, plantId, accountId, bindingId: request.bindingId,
      version: request.version, recipient: request.recipient, customerId: request.customerId, expiresAt: row.expiresAt.getTime() });
  };
}
