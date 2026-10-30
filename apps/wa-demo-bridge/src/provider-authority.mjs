import { createProviderRegistrationPolicy } from './provider-policy.mjs';

const fields = {
  policy: ['enabled', 'paused', 'revision', 'expiresAt', 'allowlist', 'prefix'],
  identity: ['recipient', 'active', 'version', 'expiresAt'],
  binding: ['recipient', 'active', 'version', 'customerId', 'expiresAt'],
  reply: ['replyId', 'recipient', 'customerId', 'mode', 'state', 'expiresAt', 'policyRevision', 'commandPrefix', 'contentHash', 'identityVersion', 'bindingVersion'],
  approval: ['replyId', 'recipient', 'customerId', 'revoked', 'state', 'approvedBy', 'contentHash', 'policyRevision', 'identityVersion', 'bindingVersion', 'expiresAt'],
};
const denied = () => { throw Object.assign(new Error('PROVIDER_AUTHORITY_FENCED'), { status: 403 }); };

// Call only after operator reauthorization, in the audit/result effect transaction.
export async function revokeProviderAuthority({ db, tenantId, accountId, kind, resourceId, expectedRevision }, session) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const id = /^[A-Za-z0-9_.:-]{1,160}$/;
  if (!db?.collection || !session || !uuid.test(tenantId ?? '') || !id.test(accountId ?? '')
    || !Object.hasOwn(fields, kind) || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 1 || expectedRevision >= Number.MAX_SAFE_INTEGER
    || (kind === 'policy' ? resourceId !== 'account'
      : ['reply', 'approval'].includes(kind) ? !uuid.test(resourceId ?? '') : !id.test(resourceId ?? ''))) denied();
  const disabled = {
    policy: { enabled: false, paused: true }, identity: { active: false },
    binding: { active: false }, reply: { state: 'REVOKED' },
    approval: { revoked: true, state: 'REVOKED' },
  };
  const result = await db.collection('provider_authority').updateOne(
    { tenantId, accountId, kind, resourceId, authorityRevision: expectedRevision },
    { $set: disabled[kind], $inc: { authorityRevision: 1 } }, { session },
  );
  if (result.matchedCount !== 1) denied();
  return { kind, resourceId, authorityRevision: expectedRevision + 1 };
}

export async function initializeProviderAuthority(db) {
  await db.collection('provider_authority').createIndex(
    { tenantId: 1, accountId: 1, kind: 1, resourceId: 1 }, { unique: true },
  );
}

// Authority writers must update these same rows; transaction conflicts fence revocation.
export function createDurableProviderPolicy({ db, tenantId, accountId, now }) {
  if (!db?.collection) throw new Error('INVALID_PROVIDER_AUTHORITY_CONFIGURATION');
  const collection = db.collection('provider_authority');
  return createProviderRegistrationPolicy({ tenantId, accountId, now,
    readAndFence: async (request, session) => {
      const scope = { tenantId, accountId };
      async function read(kind, resourceId) {
        const key = { ...scope, kind, resourceId };
        const projection = Object.fromEntries(['tenantId', 'accountId', 'authorityRevision', ...fields[kind]].map(field => [field, 1]));
        projection._id = 0;
        const row = await collection.findOne(key, { session, projection });
        if (!row || !Number.isSafeInteger(row.authorityRevision) || row.authorityRevision < 1) denied();
        const result = await collection.updateOne({ ...key, authorityRevision: row.authorityRevision },
          { $inc: { registrationFences: 1 } }, { session });
        if (result.matchedCount !== 1) denied();
        return Object.fromEntries(['tenantId', 'accountId', ...fields[kind]].map(field => [field, row[field]]));
      }
      const reply = await read('reply', request.replyId);
      if (typeof reply.recipient !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(reply.recipient)) denied();
      return {
        reply,
        policy: await read('policy', 'account'),
        identity: await read('identity', reply.recipient),
        binding: await read('binding', reply.recipient),
        approval: await read('approval', request.replyId),
      };
    },
  });
}
