import { createHash, randomUUID } from 'node:crypto';
import { createDurableJobs, JobError } from '../../../packages/durable-jobs/index.mjs';
import { createJobAuthorization } from '../../../packages/durable-jobs/authorization.mjs';
import { boundedTransaction } from '../../../packages/tenant-foundation/commands.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { createCacheCoordination, createDurableRateLimiter } from '../../../packages/cache-coordination/index.mjs';

export const platformActions = ['platform.read', 'platform.job.request'];
export const platformRoles = { platformReader: ['platform.read'], platformOperator: platformActions };
export async function initializePlatformRuntime(runtime, { roleActions, handlers = {}, actionForKind = () => 'platform.job.request', redis, ...options }) {
  const authorizeJob = createJobAuthorization({ db: runtime.db, roleActions, actionForKind });
  const jobs = createDurableJobs({ ...runtime, ...options, authorizeJob, handlers });
  await jobs.initialize();
  const rateLimiter = createDurableRateLimiter({ ...runtime, authorize: async (scope, { session }) => {
    const grant=await runtime.foundation.authorizeInTransaction(scope.authScope, { ...scope, action: 'platform.job.request' }, { session });
    await runtime.saasAdmission.unsupported(scope.authScope,{plantId:grant.plantId,session});
    return grant;
  } });
  await rateLimiter.initialize();
  return { jobs, handlers, actionForKind, rateLimiter, coordination: redis ? createCacheCoordination(redis) : null };
}
const publicJob = j => ({ id: j._id, kind: j.kind, status: j.status, attempt: j.attempt, maxAttempts: j.maxAttempts, revision: j.revision, createdAt: j.createdAt, updatedAt: j.updatedAt, errorCode: j.errorCode || null, nextState: j.status === 'DEAD' ? 'Review failure before requesting a new job.' : j.status === 'QUEUED' ? 'Waiting for worker.' : j.status === 'RUNNING' ? 'Worker owns an attempt.' : 'No further action.' });
export function installPlatform(app, runtime) {
  const target = req => {
    const requested = { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId };
    const aliases = resolveScopeAliases({ body: { ...requested, ...req.body }, query: req.query, headers: Object.fromEntries(['x-tenant-id', 'x-plant-id'].filter(k => req.headers[k] !== undefined).map(k => [k, req.headers[k]])) });
    if (aliases.tenantId !== requested.tenantId || aliases.plantId !== requested.plantId) throw new JobError('SCOPE_DENIED', 403);
    return aliases;
  };
  const read = (req, effect) => boundedTransaction(runtime.client, async session => {
    const grant = await runtime.foundation.authorizeInTransaction(req.scope, { ...target(req), action: 'platform.read' }, { session });
    return effect(session, grant);
  });
  app.get('/api/platform/jobs', async (req, res) => {
    const page = req.query.after;
    if (page !== undefined && !/^[0-9a-f-]{36}$/i.test(page)) throw new JobError('INVALID_CURSOR', 400);
    const result = await read(req, async (session, grant) => {
      const rows = await runtime.db.collection('jobs').find({ tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, requestedBy: grant.userId, active: true, engine: 'durable-v1', ...(page ? { _id: { $gt: page } } : {}) }, { session }).sort({ _id: 1 }).limit(51).toArray();
      return { data: rows.slice(0, 50).map(publicJob), nextCursor: rows.length > 50 ? rows[49]._id : null, observedAt: new Date().toISOString() };
    });
    res.set('Cache-Control', 'no-store').json(result);
  });
  app.post('/api/platform/jobs', async (req, res) => {
    const scope = target(req), input = req.body;
    if (!input || Object.keys(input).some(k => !['tenantId', 'plantId', 'kind', 'input', 'key'].includes(k)) || !Object.hasOwn(runtime.platform.handlers, input.kind)) throw new JobError('INVALID_JOB_REQUEST', 400);
    const grant = await runtime.foundation.authorize(req.scope, { ...scope, action: 'platform.job.request' });
    const rate = await runtime.platform.rateLimiter.consume({ ...grant, authScope: req.scope }, { subjectId: grant.userId, policy: 'platform.job.request', limit: 20, windowMs: 60000 });
    if (!rate.allowed) { res.set('Retry-After', String(Math.max(1, Math.ceil((Date.parse(rate.retryAt) - Date.now()) / 1000)))); throw new JobError('JOB_RATE_LIMITED', 429); }
    const jobId = randomUUID();
    const requiredAction = runtime.platform.actionForKind(input.kind);
    const result = await runtime.commands.execute(req.scope, { ...scope, action: requiredAction, key: input.key, aggregateId: `job:${input.key}`, expectedRevision: 0, input: { kind: input.kind, input: input.input } }, async ({ session, grant }) => {
      await runtime.foundation.authorizeInTransaction(req.scope, { ...scope, action: 'platform.job.request' }, { session });
      await runtime.foundation.authorizeInTransaction(req.scope, { ...scope, action: runtime.platform.actionForKind(input.kind) }, { session });
      const s = await runtime.db.collection('sessions').findOne({ tokenHash: createHash('sha256').update(req.token).digest('hex'), revoked: false }, { session });
      if (!s) throw new JobError('UNAUTHENTICATED', 401);
      const job = await runtime.platform.jobs.enqueue({ _id: jobId, ...grant, requestedBy: grant.userId, authorizationSessionId: s._id, kind: input.kind, input: input.input, maxAttempts: 5 }, { session });
      return { data: publicJob(job), revision: 1, events: [] };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  });
}
