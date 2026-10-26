# ADR 0001: reject private permit-only authorization under the current writer contract

Status: REJECTED for adoption. The isolated experiment is complete; both production fence protocols remain unchanged. F5 overall remains BLOCKED.

## Context and candidate

The inventory starts at23d2023; the same authorization implementation is present at P2 checkpoint69ff7c7 used for this experiment. The current six actual authority writes establish ordering with revocation and direct membership faults. A private permit CAS could preserve that contract only if every relevant withdrawal conflicted with the permit or invalidated it atomically. Existing official session/membership methods and explicit direct-state fault seams have no such universal protocol.

The isolated candidate uses actual foundation seed, issuance and authentication, with dedicated permit/effect collections and constructor-owned barriers. Registration keeps six real source writes. Routine candidate commands read live sources but write only the private permit. Head CAS precedes the unique event insertion inside the same transaction; this fixes the event-first contention seam without fixing the missing dependency conflict.

## Observed decision

The lead owner gate passes11/11. The final independent gate passes30/30, comprising29 child cases, with candidate REJECTED and portfolioSessionErrorMismatch=true. Both preserve229 monitored runtime-source hashes and clean up to zero owned mongod processes. The first independent attempt remains retained: a lowercase generated master code failed HTTP validation before the guards; the QA fixture was corrected without a candidate or production change. See the lead evidence index for logs, JSON, source maps and exact attempt association.

The independent same-plant controls observe:

- Actual foundation old authority reads, then committed roles=[] without version increment, then actual membership112; callback retry2 observes withdrawal and denies403.
- Actual portfolio valid201 control, then tested actor's acknowledged session write, committed role withdrawal, actual membership112, retried session write and final403 without forbidden item/key/outbox effects.
- Candidate authority reads, then the same committed role withdrawal, then COMMITTED isolated effect/key/audit/outbox. The next replay403 does not undo the stale-authorized commit.

This counterexample rejects the candidate under the preserved direct-state contract. The test passing means that rejection was reproduced, not that authorization passed. Its foundation-style403 session errors also differ from actual portfolio pre-entry401; authenticated-guard state403 remains a separate phase and no oracle was normalized.

The trusted prototype membership-withdrawal control does serialize against the head-first private permit writer: actor-first commit precedes completed withdrawal and later replay403; withdrawal-first causes conflict/retry denial. This proves ONLY that control. Existing revokeSession, switchSession, invalidateMembership, tenant/user/plant/entity withdrawals and direct role/scope faults are not rewired or certified.

Actual foundation cross-target evidence separately observes an actor COMMITTED after selectedP1-only deactivation while the six writes cover requestedP2/entity. That is the narrower existing foundation behavior and a contract decision for successors, not a portfolio HTTP bypass or new candidate coverage. The candidate remains same-selected-target only.

## Bounds and consequences

The tenant-wide budget counts ALL retained permits, including inactive/expired rows: default8, configurable1..32. It is narrower than a production per-principal protocol and has no garbage collection policy. Small actual budgets1 and2 were exercised; full8/32/128-event capacity is not certified. Only the trusted prototype membership control has atomic permit fan-out invalidation. No production source is optimized or relaxed, and no stock/financial integration or throughput/latency improvement is claimed.

## Next investigation, not adoption

Preserve all six real authorization writes. Test whether expensive immutable-evidence validation can be shortened or staged before their critical section, with exact authoritative version/hash rebinding and final in-transaction CAS. A deterministic authority or dependency change between prevalidation and commit must reject or force valid revalidation with full rollback and no forbidden effect. Replay and domain-CAS overlap need their own proofs; an HTTP race alone is insufficient.

Only a separately accepted correctness proposal should proceed to a matched current-parent benchmark with unchanged initial targets and separate HTTP, admission queue and total response latency. Do not rerun54a7 merely to add measurements. This ADR does not invent a safe permit protocol or authorize production fence replacement; F5 remains BLOCKED.
