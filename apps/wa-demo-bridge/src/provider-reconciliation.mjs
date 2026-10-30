import { createProviderCallbackVerifier } from './provider-callback.mjs';

const fail = code => { throw Object.assign(new Error(code), { status: 409 }); };

export async function initializeProviderReconciliation(db) {
  await db.collection('provider_callback_events').createIndex({ tenantId: 1, accountId: 1, eventId: 1 }, { unique: true });
  await db.collection('provider_deliveries').createIndex({ tenantId: 1, accountId: 1, deliveryId: 1 }, { unique: true });
  await db.collection('provider_deliveries').createIndex({ tenantId: 1, accountId: 1, providerMessageId: 1 }, {
    unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } },
  });
}

export function createProviderReconciler({ db, transaction, tenantId, accountId, secret, now }) {
  if (!db?.collection || typeof transaction !== 'function') throw new Error('INVALID_RECONCILIATION_CONFIGURATION');
  const verify = createProviderCallbackVerifier({ tenantId, accountId, secret, now });
  const scope = { tenantId, accountId };
  const events = db.collection('provider_callback_events');
  const deliveries = db.collection('provider_deliveries');
  return async function reconcile(envelope) {
    const event = verify(envelope);
    return transaction(async session => {
      // Fence every callback, including duplicates, against the registered delivery.
      const filter = { ...scope, deliveryId: event.deliveryId };
      const delivery = await deliveries.findOne(filter, { session });
      if (!delivery || !['SENDING', 'UNKNOWN', 'ACCEPTED', 'DELIVERED', 'FAILED'].includes(delivery.state)) fail('UNREGISTERED_PROVIDER_DELIVERY');
      if (delivery.providerMessageId && delivery.providerMessageId !== event.providerMessageId) fail('PROVIDER_MESSAGE_CONFLICT');
      const prior = await events.findOne({ ...scope, eventId: event.eventId }, { session });
      if (prior) {
        if (['deliveryId', 'providerMessageId', 'status'].some(key => prior[key] !== event[key])) fail('PROVIDER_EVENT_CONFLICT');
        return { deliveryId: event.deliveryId, state: delivery.state, duplicate: true };
      }
      let state = event.status;
      if (['DELIVERED', 'FAILED'].includes(delivery.state)) {
        if (event.status !== 'ACCEPTED' && event.status !== delivery.state) fail('PROVIDER_TERMINAL_CONFLICT');
        state = delivery.state;
      }
      if (!Number.isSafeInteger(delivery.revision) || delivery.revision < 1) fail('INVALID_DELIVERY_REVISION');
      const updated = await deliveries.updateOne({ ...filter, revision: delivery.revision }, {
        $set: { state, providerMessageId: event.providerMessageId }, $inc: { revision: 1 },
      }, { session });
      if (updated.matchedCount !== 1) fail('PROVIDER_DELIVERY_CONFLICT');
      await events.insertOne(event, { session });
      return { deliveryId: event.deliveryId, state, duplicate: false };
    });
  };
}
