# PLAT-038 bounded receipt profile and tenant data port

Status: IMPLEMENTED_QA_PENDING for REGISTERED_MONGO_BUSINESS_GRAPH_V1 and
RECEIPTED_COMMANDS_V1. This replaces the earlier UNWIRED integration guidance.
It does not implement a full-endpoint admission profile or certify cloud/live use.

## Assembly and enrollment

The host creates SaaS admission after foundation and before command consumers.
Foundation receives the optional typed callback explicitly. Portal constructors,
including the delegated source-authorizing executor, and every scoped-AI executor
forward the same port. Customer service receives its explicit unsupported port.
API initialization verifies pinned source coverage; createApp verifies the actual
395 registered routes against admission-registry.json before enabling enrollment.
Unknown source/route/profile or missing enrolled foundation callback fails closed.

Register lifecycleRoles before foundation. Tenant-wide saasOperator membership
AND role grants administer subscriptions/export/archive/restore. saasUser grants
saas.use for the selected plant. No new role assignment or credential provisioning
is automated. Existing tenant-wide admin receipts and source authorization remain
usable during suspension and recovery; login/logout retain their original policy.

POST /api/saas/subscribe requires key, expectedRevision, reason, plan and explicit
admissionProfile: RECEIPTED_COMMANDS_V1. Plant comes from authenticated scope.
The UI explains supported/unavailable operations before enrollment. A tenant without
a subscription preserves existing behavior. A tenant with an unknown old profile
fails business admission; its authorized operator can explicitly update the profile.
No silent backfill of receipts, hashes or enrollment occurs.

The bounded profile rejects enrollment when vector/embedding, vendor transport or
voice-store adapters are configured, or when automation engine, document intent
or vendor delivery history exists. That evidence cannot establish quiescence of
an earlier external operation. No history is deleted or silently treated as stopped.
A future adapter/quiescence contract is required to enable those configurations.

## Receipt and metering contract

admission-registry.json is the committed route/transaction/constructor registry.
Seven receipt collections are supported: foundationCommandResults, manufacturingKeys,
warehouseKeys, fulfillmentKeys, qualityKeys, maintenanceKeys and operationsKeys.
Each retains its original filter, key and payload digest. Foundation identity is
exactly tenant/plant/user/action/key, with the existing aggregate-bound inputHash.
Other supported wrappers retain tenant/plant/key; operations retains its original
actor-derived key. No actor/aggregate dimension or receipt hash is invented.

The callback follows current domain authorization, lookup and hash comparison.
Replay retains existing source validators and reauthorizes current SaaS use with
zero charge. New commands reserve one apiCalls unit in the effect session before
the business effect; receipt/effect/usage/audit/outbox commit or abort together.
The host guard authorizes/fences only. Repeated same-receipt helpers in the same
transaction inherit admission; a new transaction number resets that context.
An audit marker cannot substitute for a missing domain receipt on a later command.
Concurrent enrollment, suspension and quota contend through tenant/subscription
writes. Existing bounded domain transaction retry/unknown-commit behavior remains.
An exhausted transient retry may require reconciliation using the exact same key.

CRM/commercial/procurement/documents, repair-case operations, internal production,
purchased fulfillment, delivery, stock holds, workforce, customer service,
automation, public job ingress and AI indexing rebuild/cleanup or vendor dispatch/
reconciliation are explicitly UNSUPPORTED for enrolled tenants. They retain legacy
behavior for unenrolled tenants. Some advisory POST operations are read-only and
unmetered. GET automation SLA scheduling is a mutation and is also unsupported.
The registry identifies each actual route, including inherited helpers and system
read/source fences. Internal job retries/private reporting are not new billable
user commands. Full endpoint receipt coverage remains NOT_YET_IMPLEMENTED and
requires a further owner/receipt allocation through existing TPR-153.

Usage is command-count quota, not SaaS payment collection or tenant finance.
storageBytes is a cumulative explicitly admitted byte metric per UTC month, not
measured disk occupancy. The older standalone assertEntitled helper is not the
host profile's effect hook and must not be wired as a second admission authority.

## Tenant data port

The host now supplies createMongoTenantDataPort(runtime). Its snapshot/remove/
restore receive scope, current grant and the same active Mongo session. The
registry enumerates259 actual collections and101 source-schema pins; business
rows use a bounded BSON structural portability contract tied to their source.
This is not independent domain-schema/conservation acceptance. Counts, stable
collection/source-ID identities, BSON dates/decimals and child/history rows are
preserved. Source revision, schema, topology, size and collision checks fail closed.
Default bounds:1000 resources and2,000,000 JSON bytes; no truncation or chunked
partial COMPLETE result. Mongo catalog commands run outside the transaction;
business reads/writes and foundation authority fences use the supplied session.
Catalog is checked again, but this is not an administrative DDL-lock guarantee.

COMPLETE means the explicitly registered Mongo business graph only. Foundation
identity/grants, credentials/sessions, private message/biometric/security material,
transport, audit/outbox and recovery evidence are retained and listed in each
snapshot. It is not certified erasure or an external-system backup. Unknown
collections, private/missing schema fields, stale sources and oversize graphs
reject the operation. Structural source vocabulary is not a substitute for final
independent domain validation.

Delete requires SUSPENDED, the latest digest and unchanged complete source graph.
Restore rejects collisions, restores all covered resources atomically, checks full
hash parity and returns SUSPENDED. Existing active operator access remains intact.
No actual user-data archive/delete/restore is authorized by this implementation.

## Integration, startup and rollback

CTO149 integrates the feature tip with ancestry55766c6 once; do not cherry-pick
its already-ancestor data commits again. Existing API/UI mounts and roles from
3b22b167 remain. This change owns only the granted v5 boundary hunks, one owned
UI form and the tenant-lifecycle/ops paths; no root manifest/lockfile changes.
No extra package or machine installation is required. Source pins normalize UTF-8
CRLF to LF so checkout line endings do not invalidate the contract.

When an integration changes pinned source or mounts, review its coverage first,
then run node packages/tenant-lifecycle/build-registry.mjs followed by
node packages/tenant-lifecycle/build-admission-registry.mjs. The latter consumes
admission-routes.json captured from the actual host, not a guessed endpoint list.
A changed route inventory needs a reviewed actual-host recapture/classification.
Never remove the source/route checks to make a changed build start.

Start only with the existing project launcher and an explicitly owned database;
initialize/runtime source checks then createApp route checks must succeed. Check
existing session login and authorized /api/saas/status; no subscription is assumed.
Shutdown belongs to the launcher's owner: close HTTP, drain owned services and
close its Mongo client, without stopping unrelated processes. This feature adds
no background service. For source rollback, CTO may revert the feature on its
isolated candidate after preserving evidence. Do not activate an older unenforced
build against enrolled subscriptions or mutate user subscription state to bypass
checks. Unknown enrollment remains denied until a reviewed recovery decision.

## Evidence and remaining verification

Node24.19.0 in the assigned worktree. Focused marker-owned Mongo admission test:
9 PASS/0 FAIL/0 SKIP, including real warehouse HTTP effects, callback replay/abort/
transient rollback, current revocation/suspension, quota contention, legacy
compatibility, unsupported CRM/service/job effects and enrollment fencing.
Actual nested AI publisher uses real Mongo with an explicitly synthetic source
adapter, proving callback forwarding and current source-denial replay behavior.
Other constructor-forwarding assertions are SOURCE checks, not executed vertical QA.

Domain-port focused test:4 PASS/0 FAIL/0 SKIP, real Mongo graph export/archive/
restore hash parity, tenant-wide scope, stale source, unknown/private/missing
schema, oversize and collisions. Combined admission+port run:13/13 PASS. The
later admission9/9 includes additional unsupported service/job/config assertions.
All API src/test/scripts syntax and owned JSX esbuild parsing PASS. Exact logs,
SHA256, usable feature SHA and changed paths are in the issue/checkpoint ledger.

The earlier combined quota assertion failure remains recorded: Mongo112 exhausted
the original bounded retry budget; usage did not overspend. The test now verifies
same-key reconciliation without changing production retry semantics. Some owned
fixture teardowns printed ECONNRESET even on exit0; logs preserve those warnings.
Final admission9/9 had no such warning. No owned process remains after cleanup.

Full independent browser/security/conservation/concurrency/noisy-neighbor/UI QA
is NOT_RUN, owned by TPR-150/152 after CTO149's immutable integration. UI uses
existing shared tokens/forms/details, English text and error/loading/recovery
states; no new palette, typography or motion. Visual/mobile/contrast/click-through
acceptance is deferred by the Board's final-QA policy, not claimed PASS.
Cloud/provider/live environment, spend, production migration, public push/merge
and deployment remain unperformed and separately gated.
