import { createHash, randomUUID } from 'node:crypto';
import { boundedTransaction, canonicalJson } from '../tenant-foundation/commands.mjs';
import { jobScope, JobError } from '../durable-jobs/index.mjs';

const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const bound = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export function scopedKey(namespace, scope, { purpose, resourceId, revision }) {
  jobScope(scope);
  if (!/^[a-z0-9-]{1,40}$/.test(namespace) || !/^[a-z0-9.-]{1,60}$/.test(purpose)
    || typeof resourceId !== 'string' || !resourceId.length || resourceId.length > 256 || !bound(revision, 0, Number.MAX_SAFE_INTEGER)) throw new JobError('INVALID_CACHE_KEY', 400);
  return `iems:${namespace}:v1:{${digest(jobScope(scope))}}:${purpose}:${digest({ resourceId, revision })}`;
}
export const releaseScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export function createCacheCoordination({ sendCommand, namespace, timeoutMs = 250, maxBytes = 65536 }) {
  if (typeof sendCommand !== 'function' || !bound(timeoutMs, 10, 2000) || !bound(maxBytes, 256, 1048576)) throw new TypeError('Bounded Redis transport required');
  async function optional(command) {
    let timer;
    try { return await Promise.race([sendCommand(command), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REDIS_TIMEOUT')), timeoutMs); })]); }
    catch { return null; }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    async read({ scope, resourceId, revision, authorize, load, ttlMs = 10000 }) {
      if (!bound(ttlMs, 1, 300000) || typeof authorize !== 'function' || typeof load !== 'function') throw new JobError('INVALID_CACHE_REQUEST', 400);
      // The caller checks the current Mongo revision and ACL even on a cache hit.
      const grant = await authorize();
      if (!grant || Object.keys(jobScope(scope)).some(k => grant[k] !== scope[k]) || grant.revision !== revision || typeof grant.userId !== 'string') throw new JobError('CACHE_AUTHORIZATION_DENIED', 403);
      const key = scopedKey(namespace, scope, { purpose: 'read', resourceId: `${grant.userId}:${resourceId}`, revision });
      const raw = await optional(['GET', key]);
      if (typeof raw === 'string' && Buffer.byteLength(raw) <= maxBytes) {
        try {
          const cached = JSON.parse(raw);
          if (cached.revision === revision && cached.expiresAt > Date.now() && cached.userId === grant.userId && cached.scopeHash === digest(jobScope(scope))) return { data: cached.data, cache: 'HIT' };
        } catch { /* Corrupt disposable data is a miss. */ }
      }
      const data = await load(grant);
      const value = canonicalJson({ data, revision, userId: grant.userId, scopeHash: digest(jobScope(scope)), expiresAt: Date.now() + ttlMs });
      if (Buffer.byteLength(value) <= maxBytes) await optional(['SET', key, value, 'PX', String(ttlMs)]);
      return { data, cache: 'MISS' };
    },
    async advisoryLease(scope, resourceId, ttlMs = 5000) {
      if (!bound(ttlMs, 1, 30000)) throw new JobError('INVALID_CACHE_TTL', 400);
      const key = scopedKey(namespace, scope, { purpose: 'advisory', resourceId, revision: 0 }), token = randomUUID();
      const acquired = await optional(['SET', key, token, 'NX', 'PX', String(ttlMs)]) === 'OK';
      return { acquired, authoritative: false, async release() { if (acquired) await optional(['EVAL', releaseScript, '1', key, token]); } };
    }
  });
}

// Security-sensitive limits persist in Mongo; a Redis flush/restart never resets them.
export function createDurableRateLimiter({ client, db, authorize, now = () => new Date() }) {
  if (typeof authorize !== 'function') throw new TypeError('Transactional authorization required');
  const buckets = db.collection('platformRateLimits');
  const limiter = {
    async initialize() { await buckets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); },
    async consume(scope, options) { return boundedTransaction(client,session=>limiter.consumeInTransaction(scope,options,{session})); },
    async consumeInTransaction(scope, { subjectId, policy, limit, windowMs }, {session}={}) {
      if(!session?.inTransaction() || session.client!==client || db.client!==client) throw new JobError('RATE_TRANSACTION_REQUIRED',500);
      jobScope(scope);
      if (typeof subjectId !== 'string' || !subjectId.length || subjectId.length > 256 || !/^[a-z0-9.-]{1,60}$/.test(policy) || !bound(limit, 1, 100000) || !bound(windowMs, 1000, 86400000)) throw new JobError('INVALID_RATE_POLICY', 400);
        const grant = await authorize(scope, { session });
        if (!grant || Object.keys(jobScope(scope)).some(k => grant[k] !== scope[k]) || grant.userId !== subjectId) throw new JobError('RATE_AUTHORIZATION_DENIED', 403);
        const at = now(), start = Math.floor(at.getTime() / windowMs) * windowMs;
        const id = digest({ ...jobScope(scope), subjectId, policy, windowMs, start });
        const row = await buckets.findOne({ _id: id }, { session });
        if (row && (row.limit !== limit || row.windowMs !== windowMs)) throw new JobError('RATE_POLICY_CONFLICT');
        if ((row?.used || 0) >= limit) return { allowed: false, remaining: 0, retryAt: new Date(start + windowMs).toISOString() };
        if (row) {
          const changed = await buckets.updateOne({ _id: id, used: row.used }, { $inc: { used: 1 } }, { session });
          if (changed.matchedCount !== 1) throw new JobError('RATE_FENCE_LOST');
        }
        else await buckets.insertOne({ _id: id, ...jobScope(scope), subjectId, policy, limit, windowMs, used: 1, expiresAt: new Date(start + windowMs * 2) }, { session });
        return { allowed: true, remaining: limit - (row?.used || 0) - 1, retryAt: new Date(start + windowMs).toISOString() };
    }
  };
  return limiter;
}
