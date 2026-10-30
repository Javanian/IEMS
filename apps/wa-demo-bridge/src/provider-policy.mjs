const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = /^[A-Za-z0-9_.:-]{1,160}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const denied = () => { throw Object.assign(new Error('PROVIDER_POLICY_DENIED'), { status: 403 }); };

// The reader must write-fence every authority represented in its snapshot in this session.
export function createProviderRegistrationPolicy({ tenantId, accountId, readAndFence, now = () => Date.now() }) {
  if (!uuid.test(tenantId ?? '') || !id.test(accountId ?? '') || typeof readAndFence !== 'function'
    || typeof now !== 'function') throw new Error('INVALID_PROVIDER_POLICY_CONFIGURATION');
  return async (input, session) => {
    if (!session || input?.tenantId !== tenantId || input?.accountId !== accountId
      || !uuid.test(input?.replyId ?? '') || !uuid.test(input?.deliveryId ?? '')
      || !id.test(input?.ownerId ?? '') || !positive(input?.generation)) denied();
    const request = Object.freeze({ tenantId, accountId, replyId: input.replyId,
      deliveryId: input.deliveryId, ownerId: input.ownerId, generation: input.generation });
    const snapshot = await readAndFence(request, session);
    const at = now();
    if (!Number.isSafeInteger(at) || !snapshot) denied();
    const { policy, identity, binding, approval, reply } = snapshot;
    const scoped = row => row?.tenantId === tenantId && row?.accountId === accountId;
    if (![policy, identity, binding, approval, reply].every(scoped)) denied();
    if (policy.enabled !== true || policy.paused !== false || !positive(policy.revision)
      || !Number.isSafeInteger(policy.expiresAt) || policy.expiresAt <= at
      || !Array.isArray(policy.allowlist) || policy.allowlist.length > 100
      || !policy.allowlist.every(value => typeof value === 'string' && id.test(value))
      || typeof policy.prefix !== 'string' || !/^[A-Z][A-Z0-9 ]{0,31} $/.test(policy.prefix)) denied();
    if (!id.test(reply.recipient ?? '') || !policy.allowlist.includes(reply.recipient)
      || reply.replyId !== request.replyId || reply.mode !== 'LIVE' || reply.state !== 'APPROVED'
      || !Number.isSafeInteger(reply.expiresAt) || reply.expiresAt <= at
      || reply.policyRevision !== policy.revision || reply.commandPrefix !== policy.prefix
      || !/^[a-f0-9]{64}$/.test(reply.contentHash ?? '')) denied();
    if (identity.recipient !== reply.recipient || identity.active !== true || !positive(identity.version)
      || identity.version !== reply.identityVersion || identity.expiresAt <= at
      || !Number.isSafeInteger(identity.expiresAt)
      || binding.recipient !== reply.recipient || binding.active !== true || !positive(binding.version)
      || binding.version !== reply.bindingVersion || !uuid.test(binding.customerId ?? '')
      || binding.customerId !== reply.customerId || !Number.isSafeInteger(binding.expiresAt)
      || binding.expiresAt <= at) denied();
    if (approval.replyId !== reply.replyId || approval.revoked !== false || approval.state !== 'APPROVED'
      || !uuid.test(approval.approvedBy ?? '')
      || approval.contentHash !== reply.contentHash || approval.policyRevision !== policy.revision
      || approval.identityVersion !== identity.version || approval.bindingVersion !== binding.version
      || approval.recipient !== reply.recipient || approval.customerId !== binding.customerId
      || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= at) denied();
    return true;
  };
}
