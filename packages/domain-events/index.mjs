import { boundedTransaction, canonicalJson, contentHash } from '../tenant-foundation/commands.mjs';
import { SNAPSHOT_TYPE, SNAPSHOT_TOPIC, validateSnapshot, validateSource } from './source-bindings.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateEvent(e) {
  for (const key of ['eventId', 'tenantId', 'plantId', 'aggregateId']) if (!uuid.test(e?.[key])) throw new Error(`INVALID_${key}`);
  if (![1, 2].includes(e.schemaVersion) || !Number.isSafeInteger(e.aggregateVersion) || e.aggregateVersion < 1 || !/^[a-zA-Z][\w.-]{0,127}$/.test(e.type)) throw new Error('UNSUPPORTED_EVENT');
  if (typeof e.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(e.occurredAt) || !Number.isFinite(Date.parse(e.occurredAt))) throw new Error('INVALID_EVENT_TIME');
  if (!e.payload || Object.getPrototypeOf(e.payload) !== Object.prototype) throw new Error('INVALID_PAYLOAD');
  if (e.schemaVersion === 2) {
    if (e.type !== SNAPSHOT_TYPE || e.payload.resourceId !== e.aggregateId || e.payload.source?.mappingVersion !== 1 || typeof e.payload.baseline !== 'boolean') throw new Error('INVALID_SNAPSHOT_V2');
    validateSnapshot(e.payload); validateSource(e.payload.source);
  }
  if (Buffer.byteLength(canonicalJson(e)) > 1024 * 1024) throw new Error('EVENT_TOO_LARGE');
  return e;
}

export function fromOutbox(row) {
  return validateEvent({ eventId: row._id, schemaVersion: row.schemaVersion, tenantId: row.tenantId, plantId: row.plantId, aggregateId: row.aggregateId, aggregateVersion: row.aggregateRevision, type: row.type, occurredAt: new Date(row.occurredAt).toISOString(), payload: row.data });
}

// Publication is deliberately at least once: a lost marker repeats the same event ID.
export async function relayBatch({ db, producer, eventTypes, topic = 'iems.domain.v1', limit = 100 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_LIMIT');
  if (!Array.isArray(eventTypes) || !eventTypes.length || eventTypes.length > 100 || !eventTypes.every(t => typeof t === 'string' && /^[a-zA-Z][\w.-]{0,127}$/.test(t))) throw new Error('EXPLICIT_EVENT_ROUTING_REQUIRED');
  const rows = await db.collection('outbox').find({ type: { $in: eventTypes }, kafkaPublishedAt: null }).sort({ tenantId: 1, plantId: 1, aggregateId: 1, aggregateRevision: 1, _id: 1 }).limit(limit).toArray();
  for (const row of rows) {
    const event = fromOutbox(row);
    await producer.send({ topic, acks: -1, messages: [{ key: `${event.tenantId}:${event.plantId}:${event.aggregateId}`, value: canonicalJson(event), headers: { schemaVersion: '1', eventId: event.eventId } }] });
    await db.collection('outbox').updateOne({ _id: row._id, kafkaPublishedAt: null }, { $set: { kafkaPublishedAt: new Date() } });
  }
  return rows.length;
}

export function createProjectionConsumer({ client, db, name, apply, authorize }) {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(name) || typeof authorize !== 'function') throw new Error('INVALID_CONSUMER');
  const receipts = db.collection('analyticsReceipts');
  return {
    async initialize() {
      await receipts.createIndex({ consumer: 1, tenantId: 1, plantId: 1, eventId: 1 }, { unique: true });
      await db.collection('analyticsHeads').createIndex({ consumer: 1, tenantId: 1, plantId: 1, aggregateId: 1 }, { unique: true });
    },
    async consume(input) {
      const e = validateEvent(input), digest = contentHash(e);
      if (e.schemaVersion !== 2 || e.type !== SNAPSHOT_TYPE) throw new Error('SNAPSHOT_STREAM_REQUIRED');
      return boundedTransaction(client, async session => {
        await authorize(e, session);
        const filter = { consumer: name, tenantId: e.tenantId, plantId: e.plantId, eventId: e.eventId };
        const old = await receipts.findOne(filter, { session });
        if (old) { if (old.hash !== digest) throw new Error('EVENT_ID_CONFLICT'); return 'duplicate'; }
        const key = { consumer: name, tenantId: e.tenantId, plantId: e.plantId, aggregateId: e.aggregateId };
        const heads = db.collection('analyticsHeads'), head = await heads.findOne(key, { session });
        if (head && (head.resourceType !== e.payload.resourceType || head.legalEntityId !== e.payload.legalEntityId)) throw new Error('PROJECTION_IDENTITY_CONFLICT');
        if (e.aggregateVersion !== (head?.version ?? 0) + 1) throw new Error('VERSION_GAP_OR_CONFLICT');
        await apply(e, { session });
        if (head) {
          const result = await heads.updateOne({ ...key, version: head.version }, { $set: { version: e.aggregateVersion } }, { session });
          if (result.modifiedCount !== 1) throw new Error('PROJECTION_CONTENTION');
        } else await heads.insertOne({ ...key, version: e.aggregateVersion, resourceType: e.payload.resourceType, legalEntityId: e.payload.legalEntityId }, { session });
        await receipts.insertOne({ ...filter, hash: digest, consumedAt: new Date() }, { session });
        return 'applied';
      });
    }
  };
}

export async function consumeKafka({ consumer, projection, topic = SNAPSHOT_TOPIC }) {
  if (topic !== SNAPSHOT_TOPIC) throw new Error('SNAPSHOT_TOPIC_REQUIRED');
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message }) => {
    await projection.consume(JSON.parse(message.value.toString('utf8')));
    await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
  } });
}
