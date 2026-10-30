import { randomUUID } from 'node:crypto';
import { boundedTransaction, canonicalJson, contentHash } from '../tenant-foundation/commands.mjs';

export class JobError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function jobScope(value) {
  if (!value || !['tenantId', 'plantId', 'legalEntityId'].every(k => uuid(value[k]))) throw new JobError('INVALID_JOB_SCOPE', 400);
  return Object.fromEntries(['tenantId', 'plantId', 'legalEntityId'].map(k => [k, value[k]]));
}
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export function validateJob(input) {
  jobScope(input);
  if (!uuid(input._id) || !uuid(input.requestedBy) || !uuid(input.authorizationSessionId)
    || !/^[a-z][a-z0-9.-]{1,79}$/.test(input.kind) || !integer(input.maxAttempts, 1, 10)
    || Buffer.byteLength(canonicalJson(input.input)) > 65536) throw new JobError('INVALID_JOB', 400);
  return input;
}

export function createDurableJobs({ client, db, authorizeJob, handlers = {}, leaseMs = 30000, now = () => new Date() }) {
  if (typeof authorizeJob !== 'function' || !integer(leaseMs, 1000, 300000)) throw new TypeError('Job authorization and bounded lease required');
  const jobs = db.collection('jobs');
  const tx = effect => boundedTransaction(client, effect);
  const filter = job => ({ _id: job._id, ...jobScope(job) });
  const audit = (job, kind, session) => db.collection('audit').insertOne({ _id: randomUUID(), ...jobScope(job), subjectId: job._id, kind, attempt: job.attempt, occurredAt: now() }, { session });
  return Object.freeze({
    async initialize() {
      await jobs.createIndex({ tenantId: 1, plantId: 1, status: 1, availableAt: 1 });
      await jobs.createIndex({ engine: 1, status: 1, nextDispatchAt: 1, leaseUntil: 1 });
    },
    async enqueue(input, { session }) {
      if (!session?.inTransaction()) throw new JobError('JOB_TRANSACTION_REQUIRED', 500);
      validateJob(input);
      if (!Object.hasOwn(handlers, input.kind)) throw new JobError('JOB_KIND_UNAVAILABLE', 422);
      const at = now();
      const job = { ...input, ...jobScope(input), engine: 'durable-v1', status: 'QUEUED', attempt: 0, revision: 1, availableAt: at, nextDispatchAt: at, createdAt: at, updatedAt: at, active: true, inputHash: contentHash(input.input) };
      await jobs.insertOne(job, { session });
      await audit(job, 'job.queued', session);
      await db.collection('outbox').insertOne({ _id: randomUUID(), ...jobScope(job), aggregateId: job._id, aggregateRevision: 1, type: 'platform.job.requested', schemaVersion: 1, data: { jobId: job._id }, occurredAt: at, publishedAt: null }, { session });
      return job;
    },
    async due(limit = 25) {
      if (!integer(limit, 1, 100)) throw new RangeError('Batch must be 1..100');
      const at = now();
      return jobs.find({ engine: 'durable-v1', active: true, $or: [
        { status: 'QUEUED', availableAt: { $lte: at }, nextDispatchAt: { $lte: at } },
        { status: 'RUNNING', leaseUntil: { $lte: at }, nextDispatchAt: { $lte: at } },
        { status: 'DEAD', dlqConfirmedAt: null }
      ] }).sort({ nextDispatchAt: 1, _id: 1 }).limit(limit).toArray();
    },
    async dispatched(job, dead = false) {
      const at = now();
      await tx(async session => {
        const changed = await jobs.updateOne({ ...filter(job), revision: job.revision, status: job.status }, { $set: dead ? { dlqConfirmedAt: at } : { nextDispatchAt: new Date(at.getTime() + leaseMs) } }, { session });
        if (changed.matchedCount && !dead) await db.collection('outbox').updateMany({ ...jobScope(job), type: 'platform.job.requested', 'data.jobId': job._id, publishedAt: null }, { $set: { publishedAt: at } }, { session });
      });
    },
    async claim(envelope) {
      if (envelope?.schemaVersion !== 1 || !uuid(envelope.jobId)) throw new JobError('INVALID_JOB_ENVELOPE', 400);
      const scope = jobScope(envelope), at = now();
      return tx(async session => {
        const job = await jobs.findOne({ _id: envelope.jobId, ...scope, engine: 'durable-v1', active: true }, { session });
        if (!job) throw new JobError('JOB_NOT_FOUND', 404);
        if (['SUCCEEDED', 'DEAD', 'CANCELLED'].includes(job.status)) return { disposition: job.status, job };
        if (job.availableAt > at || (job.status === 'RUNNING' && job.leaseUntil > at)) return { disposition: 'BUSY', job };
        if (job.attempt >= job.maxAttempts) {
          const dead = { ...job, status: 'DEAD', revision: job.revision + 1, updatedAt: at, dlqConfirmedAt: null, errorCode: 'ATTEMPTS_EXHAUSTED' };
          await jobs.replaceOne({ ...filter(job), revision: job.revision }, dead, { session });
          await audit(dead, 'job.dead', session);
          return { disposition: 'DEAD', job: dead };
        }
        const claimed = { ...job, status: 'RUNNING', attempt: job.attempt + 1, revision: job.revision + 1, attemptToken: randomUUID(), leaseUntil: new Date(at.getTime() + leaseMs), nextDispatchAt: new Date(at.getTime() + leaseMs), updatedAt: at };
        const changed = await jobs.replaceOne({ ...filter(job), revision: job.revision }, claimed, { session });
        if (!changed.matchedCount) throw new JobError('JOB_FENCE_LOST');
        await audit(claimed, 'job.claimed', session);
        return { disposition: 'CLAIMED', job: claimed };
      });
    },
    async complete(job) {
      return tx(async session => {
        // This write conflicts with a concurrent lease takeover before any handler writes commit.
        const current = await jobs.findOneAndUpdate({ ...filter(job), status: 'RUNNING', revision: job.revision, attemptToken: job.attemptToken, leaseUntil: { $gt: now() } }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
        if (!current) throw new JobError('JOB_FENCE_LOST');
        const grant = await authorizeJob(current, { session });
        if (!grant || ['tenantId', 'plantId', 'legalEntityId', 'userId'].some(k => grant[k] !== (k === 'userId' ? current.requestedBy : current[k]))) throw new JobError('JOB_AUTHORIZATION_DENIED', 403);
        if (contentHash(current.input) !== current.inputHash) throw new JobError('JOB_INPUT_CORRUPT', 500);
        const handler = handlers[current.kind];
        if (typeof handler !== 'function') throw new JobError('JOB_KIND_UNAVAILABLE', 422);
        const result = await handler({ job: current, grant, session, db });
        if (Buffer.byteLength(canonicalJson(result)) > 65536) throw new JobError('JOB_RESULT_TOO_LARGE', 422);
        const at = now();
        const changed = await jobs.updateOne({ ...filter(current), revision: current.revision, attemptToken: current.attemptToken, leaseUntil: { $gt: at } }, { $set: { status: 'SUCCEEDED', result, completedAt: at, updatedAt: at }, $unset: { attemptToken: '', leaseUntil: '' } }, { session });
        if (!changed.matchedCount) throw new JobError('JOB_FENCE_LOST');
        await audit(current, 'job.succeeded', session);
        await db.collection('outbox').insertOne({ _id: randomUUID(), ...jobScope(current), aggregateId: current._id, aggregateRevision: current.revision, type: 'platform.job.succeeded', schemaVersion: 1, data: { jobId: current._id }, occurredAt: at, publishedAt: null }, { session });
        return result;
      });
    },
    async failed(job, error) {
      if (error.code === 'COMMIT_OUTCOME_UNKNOWN') throw error;
      return tx(async session => {
        const at = now(), terminal = job.attempt >= job.maxAttempts || error.status === 403 || error.status === 422;
        const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) ? error.code : 'JOB_HANDLER_FAILED';
        const updated = await jobs.findOneAndUpdate({ ...filter(job), status: 'RUNNING', revision: job.revision, attemptToken: job.attemptToken, leaseUntil: { $gt: at } }, { $set: { status: terminal ? 'DEAD' : 'QUEUED', errorCode: code, updatedAt: at, availableAt: new Date(at.getTime() + Math.min(60000, 1000 * 2 ** job.attempt)), nextDispatchAt: at, dlqConfirmedAt: null }, $inc: { revision: 1 }, $unset: { attemptToken: '', leaseUntil: '' } }, { session, returnDocument: 'after' });
        if (!updated) throw new JobError('JOB_FENCE_LOST');
        await audit(updated, terminal ? 'job.dead' : 'job.retry', session);
        return updated;
      });
    }
  });
}
