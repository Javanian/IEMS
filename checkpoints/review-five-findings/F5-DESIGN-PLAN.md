# F5-A: authorization contract and revocation proof

Status: design investigation planned; F5 remains BLOCKED. No production optimization, fence removal or new benchmark was performed for this plan. [Final findings acceptance](ACCEPTANCE-INDEX.md) keeps F1–F4 VERIFIED within their existing scope.

## What the baseline establishes

The frozen54a7 baseline's three retained attempts have74/96 complete cells, one partial and21 wholly UNTESTED C16 cells. Completed distinct-resource C8 combinations meet the predeclared warm HTTP p95 <=2000ms and >=4 successful commands/second target. CS different-plants C8 has only two complete repetitions plus a retained partial first repetition, so that combination is not a completed target proof.

Same-plant CS throughput falls from36.69/s atC4 to25.97/s atC8 and14.85/s atC16. Material contention is present despite the completed C8 target successes. With the artificial200-command backlog, C8 same-plant CS HTTP p95 is879.60ms, admission-queue p95 is7185.86ms and total including queue is7554.84ms. These are different measurements; the initial HTTP target is not an end-to-end queue SLA. [CONCURRENCY.md](CONCURRENCY.md) remains the historical protocol and complete disposition.

## First deliverable

Freeze one reviewed transactional-authorization contract and a complete authority-writer inventory for both paths:

| Path | Current authority mechanism | Required preservation |
| --- | --- | --- |
| Foundation authorizeInTransaction, packages/tenant-foundation/index.mjs165–185 | Authenticated session identity and current role/scope/active-state checks, then real authorizationFence writes to six authority documents | Session, membership, user, tenant, requested target plant and its legal-entity revocation ordering; session verification also checks the selected plant |
| Portfolio app.guard, apps/portfolio-api/src/app.mjs179–195 | Independent six-document crmFence writes and current role/scope/version checks | Existing401/403 distinctions, current grants and exact replay authorization |
| Authority writers | Session issue/switch/revoke; membership, role and scope edits; user/tenant/plant/entity activation; policy changes | Every entrypoint, including initialization/admin/direct-state fault seams, with explicit transaction ownership |

Document the linearization point for revoke-first and mutation-first overlap, expiry, session rotation, retry and retained-key replay. Preserve the foundation's requested-target and portfolio's selected-plant semantics explicitly. Include the existing role edit without membership-version increment; a candidate cannot assume that a version increment always occurs. Bind action, plant, legal entity, membership and policy generation rather than relying on middleware authentication alone.

A bounded per-principal/scope permit is one candidate to investigate, not an adopted design. Permit issue/renewal must conflict with authority invalidation and concurrent permit registration. If revocation fans out to live permits, define a hard live-permit bound and prove the whole invalidation fits one atomic transaction. Over-budget issue or activation must fail before use; chunked partial revocation cannot be acknowledged as complete. If direct active/role/scope changes cannot preserve the current fault/ordering contract, reject the candidate or escalate that authority-model decision explicitly. Do not weaken the oracle to fit the optimization.

The first work package produces the writer/ordering matrix, bounded transaction model and independent deterministic proof. Existing production guards and both fence protocols stay in place until that review passes. A repeat baseline benchmark is not this deliverable.

## Correctness gates before adoption

- A committed revoke before authoritative verification denies fresh mutation and retained-key replay, with zero business effects.
- Mutation-first overlap has an explicit permitted serialization; later replay after revocation is denied. Do not infer ordering merely from simultaneous HTTP.
- Cover issue/renewal/rotation versus revoke, duplicate or orphan permits, corrupt generations, expiry, concurrent revokers, callback retry and audit/outbox rollback.
- Preserve both foundation and portfolio role, action, scope and error contracts. Cached/read-only version checks alone are not a replacement for conflicting authority writes under Mongo snapshot isolation.
- Prove actual stock/unit/SO/billing CAS or unique constraints with barriers after relevant domain reads on separate sessions. These domain proofs remain separate from shared authorization serialization.

## Performance gates after correctness

Compare a pinned current-parent baseline and the candidate using the unchanged four conditions, C1/4/8/16, three repetitions,200 cold commands,40 separately labeled warmup and200 warm commands per cell. Preserve the historical54a7 results as historical evidence; later domain changes cannot be silently attributed to authorization optimization.

Retain raw samples, successes, expected conflicts, unexpected errors, callback retries, failed write conflicts, pool checkout observations, CPU/RAM and exact effect/key/audit reconciliation. Publish HTTP, admission queue and total response percentiles separately. Preserve the frozen resource guards, stopped admissions, partial cells and UNTESTED cells. The CS/CRUD workloads are not certification of every stock or MES operation.

Only reviewed correctness plus matched before/after evidence can close F5. General graph, company-stock dispatch, new providers and PostgreSQL migration are excluded from F5-A. Entitlement/dispatch continue afterward according to their concrete domain prerequisites, with the PR13 readiness finding resolved before a merge recommendation.
