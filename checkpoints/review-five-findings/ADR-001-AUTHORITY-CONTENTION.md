# ADR 001: retain authority fences pending bounded permit design and complete measurement

Date: 2026-10-25. Status: ACCEPTED LIMIT / PROPOSED FUTURE DESIGN. No optimization is implemented or accepted by this ADR. F5 remains BLOCKED for full acceptance.

## Evidence and decision

The frozen `54a7e6d` experiment measured actual foundation CS transactions and the portfolio guard independently. All measured distinct-resource concurrency8 combinations met the predeclared warm p95 <= 2 seconds and >= 4 successful commands/second target. The CS different-plants combination and other guarded cells remain untested: 34 of 96 requested workload/condition/concurrency/repetition cells could not run within the fixed RAM/CPU guards. No threshold was relaxed and no failed sample was removed.

Contention is material even where that pilot target passes. CS same-plant warm throughput declined from 36.69 successful commands/s at concurrency4 to 25.97 at8 and 14.85 at16. Concurrency16 pooled p95 was 3906.93 ms, with 7677 callback retries/write conflicts across 600 warm commands. Different-tenant concurrency8 had zero callback retries in both workloads; same-scope commands had substantial retries. This supports a common-authority contention diagnosis for these measured workloads. It does not quantify every domain's capacity or establish that an alternative is safe.

Retain the current six-document authoritative writes. Do not delete tenant/plant/entity fences, move revocation checks solely to middleware, or replace current authority with an old cache. The incomplete resource matrix and pending deterministic domain checks do not support accepting such a change. Run a matched baseline/candidate experiment on a host that meets the same guards, with all required samples and repetitions, before accepting an optimization. This is a concrete external resource gate; the existing successful pilot figures remain usable only within their stated scope.

## Prospective proof-preserving direction

Evaluate independently scoped session/membership authority permits. A business transaction would verify and perform a real write to its own current session/user/membership permit, plus its domain CAS/uniqueness fences. That permit must represent an authoritative current grant, not a cached allow response. Its scope, actions, membership version, tenant/plant/entity identities, revocation generation and expiry need an exact immutable/validated contract.

Official tenant, plant or legal-entity revocation must atomically invalidate every affected outstanding permit. Permit creation/refresh must perform a rare real write to the appropriate global authority fence in the same transaction as provisioning the permit, so a new permit cannot slip between a revoker's enumeration and commit. Mutators sharing no user/session should then avoid routine writes to the same global document, while still conflicting with the permit invalidation that makes their grant obsolete. Session/user/membership withdrawal must similarly invalidate all permits that could authorize it.

This is a design direction, not a claim that fan-out revocation or permit enumeration already exists. Define the maximum affected permits and transaction write/size/deadline budgets first. A revocation that exceeds those bounds must fail closed or enter an explicit blocked authority state under a separately proven protocol; it must not silently leave valid old permits. Expiry, renewal, session rotation, duplicate creation, interrupted revocation, retry, idempotency and orphan/corrupt permits must all have deterministic semantics. A multi-transaction fan-out is not atomic merely because each chunk uses a transaction.

All writers capable of changing authority must participate in the protocol. Existing direct active/role/scope fault injections represent an adversarial boundary: either a candidate preserves fail-closed behavior for them, or an explicitly accepted contract states which official writer is authoritative and how corruption is detected. Do not change that test contract implicitly to make a candidate pass. Tenant/plant/entity deactivation, membership role or scope edits and session/user revocation cannot retain an untracked escape path.

## Required verification before adoption

1. Freeze the exact authority schema, official writers, transaction bounds, permit-generation ownership and linearization points. Independently audit every mutation and replay path in both actual guard implementations.
2. Use deterministic test-only seams: commit each revoke/deactivation before authoritative verification and require denial; separately pause after authority writes and document mutation-first overlap. Include session revoke, role/scope edits, user/tenant/plant/entity deactivation and acknowledged replay.
3. Prove new-session/permit-creation versus bulk revocation, renewals, duplicate issuance, concurrent revokers, outbox failure and transaction retry. There must be no surviving old permit after a committed revoke-first ordering.
4. Re-run domain invariants: stock allocation/issue/consume, serial uniqueness, idempotency, partial receiving, putaway, financial entitlement and genealogy/installation. An after-domain-read barrier must actually reach both snapshots; authority serialization must not be mistaken for isolated domain-race proof.
5. Independently run identical before/after workloads, all four conditions, concurrency1/4/8/16, 200 cold and 200 warm commands with three repetitions per combination under this frozen protocol. Retain all failures, queue/retry/CPU/RAM observations and source manifests.

No production readiness, PostgreSQL, provider integration or full-platform scalability claim follows from this ADR. F1/F4 implementation and independent acceptance can continue while F5 remains explicitly BLOCKED.
