# Tenant foundation

Session, membership and plant-scoped authorization primitives for MongoDB-backed services. This package supplies no HTTP endpoints and does not migrate existing application routes.

## Contract for Express integration

Import `createTenantFoundation`, `resolveScopeAliases`, `ScopeDenied` from `index.mjs`; declarations are `index.d.ts`. Supply a real connected MongoClient/Db and a server-owned role-to-action allowlist. Runtime has no driver dependency: it consumes the supplied client. Test drivers are pinned in this package; no sibling package is required.

Request path:

1. Extract a bearer token using one strict HTTP auth adapter (not implemented here). Call `authenticate(token)`.
2. Call `resolveScopeAliases({body, query, headers})`; both tenant and target plant are mandatory. Supported names are tenantId/tenant_id/x-tenant-id and plantId/plant_id/x-plant-id. Every supplied value must be a UUID string and equal its aliases; arrays, null and conflicts deny.
3. Pass the verified object directly to `authorize(scope, {tenantId, plantId, action})` or `scopedFilter`. Do not serialize/reconstruct the scope. Runtime WeakMap provenance rejects copies even if their fields match. Returned Grant is a description, not an input capability.
4. Apply the returned `$and` filter to authoritative resource reads, with a server-built predicate. IDs never replace scope. Resolve children through scoped parents; enforce resource/customer ACL separately. Never pass raw request Mongo operators/predicates.
5. Map ScopeDenied to uniform non-disclosing 403 (or a consistent integration-level 404 policy); infrastructure errors must not fall back to legacy auth/default tenant. Configure secure cookies/CSRF/rate limiting and trusted upstream identity separately.

`issueSession` is a privileged operation accepting an already authenticated identity, **not password authentication**. Do not expose it using a caller-supplied user ID. Provisioning, invalidation, revocation and listAudit are likewise trusted control-plane methods, not unauthenticated HTTP endpoints. `switchSession` uses a verified existing session, validates target membership/ancestry and rotates/revokes atomically. TTL must be 1..86400000 ms. Tokens are 256-bit random, stored only as SHA-256 digests, returned once and never logged.

Users are global. Creating a global user requires a tenant audit context; it does not confer membership. Memberships explicitly enumerate legal entities and plants, or set tenantWide=true. Each role separately enumerates plants or explicitly requests tenantWide. Unknown roles/actions deny. Selected-plant role permissions never authorize the target plant implicitly. Membership version uses bounded CAS; invalidation revokes all sessions with prior version, even previously verified scope objects. Session auth and every authorization reload session, membership, user, tenant and selected/target ancestry.

## Atomicity and audit policy

Each exposed state mutation commits with an append-only audit insert in a real snapshot/majority transaction. No update/delete audit method or raw database handle is exported. This is **API-surface immutability**, not protection against a database administrator. Production must use a dedicated DB role preventing audit update/delete and restrict direct collection access. User-create audit uses its explicit tenant context. Audit records contain IDs/kind/time, never tokens.

Authorization is a fresh read gate, not a transaction capability for arbitrary downstream writes. A future sensitive domain command MUST contend on membership/session guards and write command result + domain state + audit + outbox in its own transaction, rechecking current permission/approval at effect execution. This package does not eliminate revocation races between its authorize return and an unrelated domain write. No outbox, customer/resource ACL, child-parent resolver, domain mutation callback, Express middleware, password login or migration cutover is claimed here. Master hierarchy provisioning is trusted bootstrap; no hierarchy deletion/reassignment API is provided.

## Verification

From this directory run `npm ci --ignore-scripts --workspaces=false`, `npm test`, and `npm run check`.

Tests start a separate single-member MongoDB 7.0.14 replica. The harness downloads and caches the platform binary when needed; set `MONGOMS_SYSTEM_BINARY` to an installed matching executable for offline testing. Tests use only a generated tenant_foundation_owned_* database, drop that database and stop only their own replica. No shared PostgreSQL or sibling runtime database is used. A DB validator forces real audit-insert failure to prove rollback of revocation. Single-member replica testing is not HA evidence.

# Foundation contract v1 — PLAT-003

MongoDB is the operational authority. Legacy PostgreSQL remains untouched; projections and staging imports never become a second operational ledger. Domain owners retain their existing aggregates, collections and route handlers. The foundation executor is available as `runtime.commands`; existing handlers are not silently replaced.

Every resource belongs to a UUID tenant and plant; a plant belongs to one legal entity. Relationships must be resolved under that scope in the effect transaction. IDs supplied in requests never confer permission. Server registrations choose actions and collections; neither handler selection nor role grants come from request bodies.

Quantities, monetary values, rates and hours cross APIs as decimal strings with explicit UOM/currency. Revisions are safe nonnegative integers. Currency scale is explicit per business policy; no implicit conversion or rounding. Integer multipliers larger than Number.MAX_SAFE_INTEGER must use bigint internally. UTC timestamps serialize as ISO 8601. Stable resource identity survives migration; source keys remain lineage, not a new identity authority.

Commands bind tenant/plant/actor/action/key to a canonical input hash, aggregate ID and expected revision. The effect handler owns aggregate CAS and relationship/entitlement checks. It receives the active session and freshly authorized grant; all writes must use that session. External calls, emails, file publication and other irreversible effects are forbidden inside a retriable callback. Instead append outbox intents, then let the owning adapter reconcile delivery. No generic public command endpoint exists.

Authorization writes the existing session, membership, user, tenant, plant and legal entity authority fences before replay lookup on every callback attempt. Domain state, saved result, audit and versioned events share the transaction. Audit and event history are append-only through the service API. Event delivery can duplicate: consumers deduplicate event IDs and enforce schema versions. No TTL may remove authoritative replay results while clients can retry.

Retries are bounded to three transactions and three commits by default (maximum five). Unknown commit retries only commit. Exhausted ambiguity yields COMMIT_OUTCOME_UNKNOWN: reconcile the same key, never generate a fresh command. An absent result immediately after an uncertain commit is not proof of failure. Revoked callers cannot inspect replay results. Driver/network operations also need bounded timeouts at the connection boundary.

Files, jobs, exports and read models use authoritative scoped lookup before content delivery. `readResource` returns 404 for missing/cross-tenant/private records and rechecks IAM in a fenced snapshot transaction. Service owners must also validate resource-specific entitlements and redact sensitive fields. This primitive does not grant arbitrary HTTP access to collections. Existing specialized resource handlers remain authoritative until explicitly integrated by their owners.

Migration v1 imports only run-owned staging, verifies counts/hashes/relationships and exact ledger totals, and offers hash-guarded rollback. Promotion/cutover needs separate authority and data-owner signoff. Single-member local replicas demonstrate transaction semantics, not HA. Independent browser/security/concurrency/performance acceptance remains with final QA.

