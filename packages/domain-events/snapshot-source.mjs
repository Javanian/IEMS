import { randomUUID } from 'node:crypto';
import { canonicalJson, contentHash } from '../tenant-foundation/commands.mjs';
import { SNAPSHOT_TYPE, SNAPSHOT_TOPIC, uuid, validateSource, validateSnapshot } from './source-bindings.mjs';
import { validateEvent } from './index.mjs';

export async function initializeReportingSnapshots(db) {
  await db.collection('reportingSnapshotHeads').createIndex({ tenantId: 1, plantId: 1, resourceId: 1 }, { unique: true });
  await db.collection('reportingSnapshotSources').createIndex({ tenantId: 1, plantId: 1, sourceKey: 1 }, { unique: true });
  await db.collection('reportingSnapshotOutbox').createIndex({ tenantId: 1, plantId: 1, aggregateId: 1, aggregateVersion: 1 }, { unique: true });
  await db.collection('reportingSnapshotOutbox').createIndex({ reportingKafkaPublishedAt: 1, tenantId: 1, plantId: 1, aggregateId: 1, aggregateVersion: 1 });
}

export async function appendReportingSnapshot({ db, session, grant, source, eventKey, resourceType, resourceId, fullSnapshot, occurredAt, mappingVersion = 1 }) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  for (const k of ['tenantId', 'plantId', 'legalEntityId', 'userId']) if (!uuid.test(grant?.[k])) throw new Error('TRANSACTIONAL_GRANT_REQUIRED');
  if (mappingVersion !== 1 || typeof eventKey !== 'string' || !eventKey.length || eventKey.length > 512) throw new Error('INVALID_MAPPING_KEY');
  validateSource(source);
  if (typeof occurredAt !== 'string' || !occurredAt.endsWith('Z') || !Number.isFinite(Date.parse(occurredAt))) throw new Error('INVALID_OBSERVATION_TIME');
  const payload = validateSnapshot({ ...fullSnapshot, resourceType, resourceId, legalEntityId: grant.legalEntityId });
  if (payload.deleted && (typeof source.deleteReason !== 'string' || !source.deleteReason.trim() || source.deleteReason.length > 512)) throw new Error('EXPLICIT_SOURCE_TOMBSTONE_REASON_REQUIRED');
  if (typeof payload.baseline !== 'boolean' || (fullSnapshot.legalEntityId && fullSnapshot.legalEntityId !== grant.legalEntityId)) throw new Error('SNAPSHOT_SCOPE_OR_BASELINE_REQUIRED');
  const scope = { tenantId: grant.tenantId, plantId: grant.plantId };
  const sourceKey = contentHash({ collection: source.collection, id: source.id, version: source.version, target: eventKey, resourceType, mappingVersion });
  const semantic = { ...payload }; delete semantic.baseline; delete semantic.observedAt; delete semantic.source;
  const hash = contentHash({ sourceHash: source.hash, snapshot: semantic });
  const receipts = db.collection('reportingSnapshotSources'), outbox = db.collection('reportingSnapshotOutbox'), heads = db.collection('reportingSnapshotHeads');
  const prior = await receipts.findOne({ ...scope, sourceKey }, { session });
  if (prior) {
    if (prior.hash !== hash) throw new Error('SOURCE_CONTENT_CONFLICT_QUARANTINE');
    const original = await outbox.findOne({ _id: prior.eventId, ...scope }, { session });
    if (!original) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_MISSING');
    if (!prior.envelopeHash || prior.envelopeHash !== contentHash(original.envelope) || original.envelopeHash !== prior.envelopeHash) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_CORRUPT_OR_UNSEALED');
    return original.envelope;
  }
  const key = { ...scope, resourceId };
  const head = await heads.findOne(key, { session });
  if (head && (head.resourceType !== resourceType || head.legalEntityId !== grant.legalEntityId || head.mappingVersion !== mappingVersion)) throw new Error('RESOURCE_IDENTITY_OR_EPOCH_CONFLICT');
  if (head?.source?.collection === source.collection && head.source.id === source.id && typeof head.source.version === 'number' && typeof source.version === 'number' && source.version < head.source.version) throw new Error('SOURCE_VERSION_REGRESSION_QUARANTINE');
  const payloadHash = contentHash(semantic);
  if (head?.payloadHash === payloadHash) {
    const original = await outbox.findOne({ _id: head.eventId, ...scope }, { session });
    if (!original) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_MISSING');
    if (!original.envelopeHash || original.envelopeHash !== contentHash(original.envelope)) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_CORRUPT_OR_UNSEALED');
    const fenced = await heads.updateOne({ ...key, version: head.version, 'source.hash': head.source.hash, 'source.version': head.source.version }, { $set: { source } }, { session });
    if (fenced.matchedCount !== 1) throw new Error('REPORTING_SOURCE_CONTENTION');
    await receipts.insertOne({ _id: randomUUID(), ...scope, sourceKey, hash, envelopeHash: original.envelopeHash, eventId: head.eventId, source, mappingVersion }, { session });
    return original.envelope;
  }
  const version = (head?.version ?? 0) + 1;
  if (!Number.isSafeInteger(version)) throw new Error('SEQUENCE_EXHAUSTED');
  const envelope = { eventId: randomUUID(), schemaVersion: 2, ...scope, aggregateId: resourceId, aggregateVersion: version, type: SNAPSHOT_TYPE, occurredAt, payload: { ...payload, source: { ...source, mappingVersion } } };
  if (Buffer.byteLength(canonicalJson(envelope)) > 1024 * 1024) throw new Error('SNAPSHOT_TOO_LARGE');
  if (head) {
    const result = await heads.updateOne({ ...key, version: head.version }, { $set: { version, payloadHash, eventId: envelope.eventId, source } }, { session });
    if (result.modifiedCount !== 1) throw new Error('REPORTING_SEQUENCE_CONTENTION');
  } else await heads.insertOne({ ...key, resourceType, legalEntityId: grant.legalEntityId, mappingVersion, version, payloadHash, eventId: envelope.eventId, source }, { session });
  const envelopeHash = contentHash(envelope);
  await outbox.insertOne({ _id: envelope.eventId, ...scope, aggregateId: resourceId, aggregateVersion: version, envelope, envelopeHash, reportingKafkaPublishedAt: null }, { session });
  await receipts.insertOne({ _id: randomUUID(), ...scope, sourceKey, hash, envelopeHash, eventId: envelope.eventId, source, mappingVersion }, { session });
  return envelope;
}

export async function relayReportingSnapshots({ db, producer, scope, authorize, limit = 100 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_LIMIT');
  if (!['tenantId', 'plantId', 'legalEntityId'].every(k => uuid.test(scope?.[k])) || typeof authorize !== 'function') throw new Error('EXPLICIT_REPORTING_SCOPE_AUTHORIZATION_REQUIRED');
  const collection = db.collection('reportingSnapshotOutbox');
  const filter = { tenantId: scope.tenantId, plantId: scope.plantId, 'envelope.payload.legalEntityId': scope.legalEntityId };
  const rows = await collection.find({ ...filter, reportingKafkaPublishedAt: null }).sort({ aggregateId: 1, aggregateVersion: 1 }).limit(limit).toArray();
  let sent = 0;
  const active = new Set();
  function checked(row) {
    const e = validateEvent(row?.envelope);
    if (e.type !== SNAPSHOT_TYPE || e.schemaVersion !== 2 || row._id !== e.eventId || row.aggregateId !== e.aggregateId || row.aggregateVersion !== e.aggregateVersion || row.tenantId !== scope.tenantId || row.plantId !== scope.plantId || e.tenantId !== scope.tenantId || e.plantId !== scope.plantId || e.payload.legalEntityId !== scope.legalEntityId) throw new Error('REPORTING_TRANSPORT_ALLOWLIST');
    if (row.envelopeHash !== contentHash(e)) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_CORRUPT_OR_UNSEALED');
    return e;
  }
  async function publish(row) {
    const e = checked(row);
    if (active.has(e.eventId)) throw new Error('REPORTING_DEPENDENCY_CYCLE');
    if (active.size >= 1000) throw new Error('REPORTING_REPLAY_BOUND_EXCEEDED');
    active.add(e.eventId);
    if (e.aggregateVersion > 1) {
      const prior = await collection.findOne({ ...filter, aggregateId: e.aggregateId, aggregateVersion: e.aggregateVersion - 1 });
      if (!prior) throw new Error('REPORTING_SEQUENCE_GAP');
      checked(prior);
      if (!prior.reportingKafkaPublishedAt && !await publish(prior)) return false;
    }
    if (e.payload.resourceType !== 'order') {
      const parent = await collection.findOne({ ...filter, aggregateId: e.payload.orderId, 'envelope.payload.resourceType': 'order' }, { sort: { aggregateVersion: -1 } });
      if (!parent || parent.envelope.payload.deleted) throw new Error('REPORTING_PARENT_UNAVAILABLE');
      checked(parent);
      if (!parent.reportingKafkaPublishedAt && !await publish(parent)) return false;
    }
    active.delete(e.eventId);
    // Another row in this batch may already have published this dependency.
    const current = await collection.findOne({ _id: row._id, ...filter });
    if (!current || contentHash(checked(current)) !== contentHash(e)) throw new Error('IMMUTABLE_REPORTING_EVIDENCE_CHANGED');
    if (current.reportingKafkaPublishedAt) return true;
    if (sent >= limit) return false;
    if (await authorize(e) === false) throw new Error('REPORTING_DELIVERY_DENIED');
    await producer.send({ topic: SNAPSHOT_TOPIC, acks: -1, messages: [{ key: `${e.tenantId}:${e.plantId}:${e.aggregateId}`, value: canonicalJson(e), headers: { schemaVersion: '2', eventId: e.eventId } }] });
    await collection.updateOne({ _id: row._id, ...filter, reportingKafkaPublishedAt: null }, { $set: { reportingKafkaPublishedAt: new Date() } });
    sent++;
    return true;
  }
  for (const row of rows) if (!await publish(row)) break;
  return sent;
}
