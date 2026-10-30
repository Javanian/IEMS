const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_.:-]{1,160}$/;
const validId = value => typeof value === 'string' && identifier.test(value);
const fail = code => { throw Object.assign(new Error(code), { status: 409 }); };
const generationValid = value => Number.isSafeInteger(value) && value > 0;

export async function initializeProviderSessions(db) {
  await db.collection('provider_sessions').createIndex({ tenantId: 1, accountId: 1 }, { unique: true });
  await db.collection('provider_deliveries').createIndex({ tenantId: 1, accountId: 1, replyId: 1 }, {
    unique: true, partialFilterExpression: { replyId: { $type: 'string' } },
  });
}

// No lease expiry: release is allowed only after the owning adapter has closed.
export function createProviderSessionRegistry({ db, transaction, tenantId, accountId, authorizeRegistration }) {
  if (!db?.collection || typeof transaction !== 'function' || !uuid.test(tenantId ?? '')
    || !validId(accountId) || typeof authorizeRegistration !== 'function') throw new Error('INVALID_SESSION_CONFIGURATION');
  const scope = Object.freeze({ tenantId, accountId });
  const sessions = db.collection('provider_sessions');
  const deliveries = db.collection('provider_deliveries');

  async function fence(session, ownerId, generation) {
    const row = await sessions.findOne(scope, { session });
    if (!row || row.ownerId !== ownerId || row.generation !== generation || row.state !== 'OWNED') fail('PROVIDER_SESSION_FENCED');
    return row;
  }

  return Object.freeze({
    async acquire(ownerId) {
      if (!validId(ownerId)) fail('INVALID_SESSION_OWNER');
      return transaction(async session => {
        const row = await sessions.findOne(scope, { session });
        // Replaying an acquire cannot authorize opening a second browser.
        if (row?.state === 'OWNED') fail('PROVIDER_SESSION_BUSY');
        if (row && (row.state !== 'CLOSED' || !generationValid(row.generation) || row.generation === Number.MAX_SAFE_INTEGER)) fail('INVALID_SESSION_GENERATION');
        const generation = (row?.generation ?? 0) + 1;
        if (!row) await sessions.insertOne({ ...scope, ownerId, generation, state: 'OWNED', registrations: 0 }, { session });
        else {
          const result = await sessions.updateOne({ ...scope, generation: row.generation, state: 'CLOSED' }, {
            $set: { ownerId, generation, state: 'OWNED', registrations: 0 },
          }, { session });
          if (result.matchedCount !== 1) fail('PROVIDER_SESSION_FENCED');
        }
        return { ...scope, ownerId, generation };
      });
    },
    async release({ ownerId, generation, adapterClosed }) {
      if (!validId(ownerId) || !generationValid(generation) || adapterClosed !== true) fail('PROVIDER_ADAPTER_NOT_CLOSED');
      return transaction(async session => {
        await fence(session, ownerId, generation);
        const result = await sessions.updateOne({ ...scope, ownerId, generation, state: 'OWNED' }, {
          $set: { state: 'CLOSED' },
        }, { session });
        if (result.matchedCount !== 1) fail('PROVIDER_SESSION_FENCED');
        return { generation, state: 'CLOSED' };
      });
    },
    async register({ ownerId, generation, deliveryId, replyId }) {
      if (!validId(ownerId) || !generationValid(generation) || typeof deliveryId !== 'string' || !uuid.test(deliveryId)
        || typeof replyId !== 'string' || !uuid.test(replyId)) fail('INVALID_DELIVERY_REGISTRATION');
      return transaction(async session => {
        await fence(session, ownerId, generation);
        if (await authorizeRegistration(Object.freeze({ ...scope, ownerId, generation, deliveryId, replyId }), session) !== true) fail('PROVIDER_REGISTRATION_DENIED');
        const prior = await deliveries.findOne({ ...scope, deliveryId }, { session });
        if (prior) {
          if (prior.replyId !== replyId || prior.ownerId !== ownerId || prior.generation !== generation) fail('PROVIDER_REGISTRATION_CONFLICT');
          return { deliveryId, state: prior.state, duplicate: true };
        }
        if (await deliveries.findOne({ ...scope, replyId }, { session })) fail('PROVIDER_REPLY_ALREADY_REGISTERED');
        // This write conflicts with release, so registration cannot straddle ownership changes.
        const result = await sessions.updateOne({ ...scope, ownerId, generation, state: 'OWNED' }, {
          $inc: { registrations: 1 },
        }, { session });
        if (result.matchedCount !== 1) fail('PROVIDER_SESSION_FENCED');
        await deliveries.insertOne({ ...scope, ownerId, generation, deliveryId, replyId, state: 'SENDING', revision: 1 }, { session });
        return { deliveryId, state: 'SENDING', duplicate: false };
      });
    },
  });
}
