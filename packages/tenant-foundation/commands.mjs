import { createHash, randomUUID } from 'node:crypto';

export class CommandError extends Error {
  constructor(code, status, message = code) { super(message); this.code = code; this.status = status; }
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new CommandError('INVALID_COMMAND_VALUE', 400);
}
export const contentHash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const labelled = (error, label) => error?.hasErrorLabel?.(label) === true || error?.errorLabels?.includes(label) === true;

export async function boundedTransaction(client, effect, { attempts = 3, commitAttempts = 3 } = {}) {
  if (![attempts, commitAttempts].every(n => Number.isInteger(n) && n >= 1 && n <= 5)) throw new RangeError('Retry bounds must be 1..5');
  const session = client.startSession();
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 5000 }, readPreference: 'primary', maxCommitTimeMS: 5000 });
      try {
        const result = await effect(session);
        let ambiguous = false;
        for (let commit = 1; commit <= commitAttempts; commit++) {
          try { await session.commitTransaction(); return result; }
          catch (error) {
            if (!labelled(error, 'UnknownTransactionCommitResult')) {
              if (ambiguous) throw new CommandError('COMMIT_OUTCOME_UNKNOWN', 503);
              throw error;
            }
            ambiguous = true;
            if (commit === commitAttempts) throw new CommandError('COMMIT_OUTCOME_UNKNOWN', 503, 'Reconcile using the same command key; do not submit a new command');
          }
        }
      } catch (error) {
        // An ambiguous commit never re-executes domain effects in this invocation.
        if (error.code === 'COMMIT_OUTCOME_UNKNOWN') throw error;
        if (session.inTransaction()) await session.abortTransaction().catch(() => {});
        if (!labelled(error, 'TransientTransactionError') || attempt === attempts) throw error;
      }
    }
  } finally { await session.endSession(); }
}

export function createCommandExecutor({ client, db, foundation, admission }) {
  if (admission !== undefined && typeof admission !== 'function') throw new TypeError('admission must be a function');
  const results = db.collection('foundationCommandResults');
  return Object.freeze({
    async initialize() {
      await results.createIndex({ tenantId: 1, plantId: 1, userId: 1, action: 1, key: 1 }, { unique: true });
      await db.collection('outbox').createIndex({ tenantId: 1, publishedAt: 1, occurredAt: 1 });
    },
    async execute(scope, command, effect) {
      const { tenantId, plantId, action, key, aggregateId, expectedRevision, input } = command;
      if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key) || typeof action !== 'string' || !action.length || typeof aggregateId !== 'string' || !aggregateId.length || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
        throw new CommandError('INVALID_COMMAND', 400);
      }
      const digest = contentHash({ action, aggregateId, expectedRevision, input });
      return boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId, plantId, action }, { session });
        const filter = { tenantId: grant.tenantId, plantId: grant.plantId, userId: grant.userId, action, key };
        const previous = await results.findOne(filter, { session });
        if (previous && previous.inputHash !== digest) throw new CommandError('IDEMPOTENCY_CONFLICT', 409);
        if (!admission && await db.collection('saasSubscriptions').findOne({ tenantId: grant.tenantId }, { session })) throw new CommandError('SAAS_ADMISSION_PORT_REQUIRED', 503);
        if (previous) {
          if (previous.inputHash !== digest) throw new CommandError('IDEMPOTENCY_CONFLICT', 409);
          await admission?.({ scope, grant, session, namespace: 'foundationCommandResults', key, action, aggregateId, payloadHash: digest, replayed: true });
          return { ...previous.response, replayed: true };
        }
        await admission?.({ scope, grant, session, namespace: 'foundationCommandResults', key, action, aggregateId, payloadHash: digest, replayed: false });
        // The registered handler performs revision/CAS checks and only database writes using this session.
        const output = await effect({ session, grant, aggregateId, expectedRevision, input });
        if (!output || output.revision !== expectedRevision + 1 || !Array.isArray(output.events) || output.events.length > 100) throw new CommandError('INVALID_COMMAND_RESULT', 500);
        canonicalJson(output.data);
        const occurredAt = new Date(), commandId = randomUUID();
        const events = output.events.map(event => {
          if (typeof event.type !== 'string' || !event.type.length || !Number.isSafeInteger(event.version) || event.version < 1) throw new CommandError('INVALID_EVENT', 500);
          canonicalJson(event.data);
          return { _id: randomUUID(), tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, aggregateId, aggregateRevision: output.revision, type: event.type, schemaVersion: event.version, data: event.data, occurredAt, commandId, publishedAt: null };
        });
        const response = { data: output.data, revision: output.revision, commandId, replayed: false };
        await results.insertOne({ _id: commandId, ...filter, inputHash: digest, response, occurredAt }, { session });
        await db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: action, subjectId: aggregateId, revision: output.revision, commandId, occurredAt }, { session });
        if (events.length) await db.collection('outbox').insertMany(events, { session });
        return response;
      });
    },
    async readResource(scope, { tenantId, plantId, action, collection, resourceId }) {
      if (!['files', 'jobs', 'exports', 'readModels'].includes(collection) || typeof resourceId !== 'string' || !resourceId.length) throw new CommandError('INVALID_RESOURCE', 400);
      return boundedTransaction(client, async session => {
        const grant = await foundation.authorizeInTransaction(scope, { tenantId, plantId, action }, { session });
        const resource = await db.collection(collection).findOne({ _id: resourceId, tenantId: grant.tenantId, plantId: grant.plantId }, { session });
        if (!resource || resource.revoked === true || resource.active === false || (resource.legalEntityId !== undefined && resource.legalEntityId !== grant.legalEntityId) || (Object.hasOwn(resource, 'allowedUserIds') && (!Array.isArray(resource.allowedUserIds) || !resource.allowedUserIds.includes(grant.userId)))) throw new CommandError('RESOURCE_NOT_FOUND', 404);
        return resource;
      });
    }
  });
}
