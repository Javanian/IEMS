# PLAT-045 disposable Redis coordination

Inject a node-redis compatible `sendCommand(string[])` into createCacheCoordination.
Keys include namespace, schema, UUID tenant/plant/legal entity hash, purpose, resource
identity and authoritative revision. Reads additionally include the authorized user ID.
Payloads have a TTL, size bound and expiry envelope. Timeouts/errors/malformed data are
cache misses. No bearer tokens or authorization results are cached.

Before every read (including a hit), `authorize()` must verify current Mongo ACL and return
`{tenantId,plantId,legalEntityId,userId,revision}` from current authority. `load(grant)` must
read that same revision or reject/retry explicitly. Do not use this cache for balances,
stock decisions, secrets or mutable permission-sensitive data requiring transactional reads.
Mongo job effects always use the durable-jobs attempt fence independently of Redis.

Advisory leases use bounded SET NX PX and compare-token Lua release; acquisition is never
permission to execute a job. An outage can leave a late SET until its TTL but cannot change
durable state. No FLUSHDB, KEYS or global deletion is provided.

Security-sensitive fixed-window rate limits use createDurableRateLimiter, which requires
transactional authorization. Mongo bucket writes serialize concurrent consumption; Redis
restart does not reset usage. Policy/limit/window come from trusted server configuration.
TTL deletes only expired rate buckets after two windows, never jobs, ledgers or user data.
Transaction contention/duplicate-key aborts are fail closed; callers may return 503 and
retry, never treat an unavailable limiter as permission. Use the same named policy and
window for all nodes. Independent live Redis loss/concurrency proof is final QA pending.
