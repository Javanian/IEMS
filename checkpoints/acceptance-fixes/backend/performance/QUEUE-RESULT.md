# CS entry queue: IMPLEMENTED_QA_PENDING

Later verification: the original 96-cell candidate matrix is now complete and
its bounded performance criteria are met. See
[PERFORMANCE-ACCEPTANCE.md](PERFORMANCE-ACCEPTANCE.md). The implementation-time
evidence and pending-gate statements below are retained as the earlier checkpoint;
independent product QA remains pending.

The measured shared-tenant authority conflicts caused repeated transaction aborts and durability waits. The approved change admits one top-level operator transaction per tenant per service instance before creating its transaction session. **Performance improvement is not yet established.** The original full 96-cell acceptance benchmark has not run on this candidate.

Base: `4ab4d59f01c5621ecb7d37c1d9644adbc8f247c4`, normally adopted with rollback ref `codex/backend-performance-before-native-20261102` retained at `cab39faf03622dbe9b5a99e16bcd54d3b06f3999`. Authority: coordinator `lead/BACKEND-QUEUE-REVIEW.md`, task `task_086258cfe666`, dispatch `ctx_f6a458fdcf3e`. Current source/commit identities are recorded in the external final checkpoint. Local development only; remote/CI UNKNOWN, no publication or product acceptance.

## Behavior and limits

Only `packages/customer-service/index.mjs` changes runtime behavior. Preliminary current authorization supplies a trusted tenant queue key; it never substitutes for transaction authorization. The original transaction adapter and authoritative callback are byte-identical to the base. All six database authority fences, original actor/scope, admission, retries, session teardown, replay and UNKNOWN handling remain in place. Nested calls reuse the active transaction and bypass reacquisition. Other service instances, customer-principal paths and modules still rely on the original database fences.

Bounds: 64 pending entries per tenant, 1,024 pending per instance, 256 tenant states, and a 30,000 ms pending deadline. Deadline/overflow uses existing `STATUS_UNAVAILABLE`, HTTP 503. A monotonic absolute deadline is checked at dequeue as well as by the timer, so a delayed timer cannot let expired work start. Active transactions are not forcibly cancelled. Queue waiting stays inside the unchanged HTTP handler and measured service latency; harness admission backlog remains a separate metric.

The existing public API has no request AbortSignal contract. Immediate HTTP-disconnect cancellation is neither implemented nor claimed. A disconnected pending request can execute before its deadline. This is process-local contention control, not a distributed correctness boundary or a production capacity claim.

## Complete generated metadata impact

Both maintained generators ran unfiltered, with their complete preview reviewed before repository metadata mutation. Actual outputs exactly match the previews; both source verifiers pass. No generator, dependency, collection disposition, registered source, route, permission or unrelated pin changes.

The CS normalized digest in both registries changes from `de09d4217923a359f68291c8d9da8e26382aa20be9c2f2a9a461cdeed8362ef9` to `4c3276ae9e660e11e54ba33e6556f1dd5eb5f1c32fa91c0427cb74a2a9cf29b9`.

The domain source inventory adds exactly `deadline`, `delete`, `execute`, `indexOf`, `now`, `reject`, `resolve`, `running`, `shift`, `splice`, `timer`, `unref`; none are removed. Compared with the reviewed original proposal, `deadline` records the absolute pending deadline and `now` comes from monotonic clock access. The other ten tokens come from the reviewed queue methods and entry state.

All 19 collections directly sourcing CS remain `RETAIN_PRIVATE_OR_TECHNICAL`. **The shared nested-field allowlist also expands by `deadline`, `running`, `shift`, `splice`, `timer`, `unref`.** This is schema impact, not cosmetic hash churn. The actual archive snapshot regression verifies those nested fields are admitted and unrelated unknown/private fields still reject at both top-level and nested paths. Complete patches and `registry-review.json` are retained in the external `queue-candidate` directory.

## Correctness evidence

Tests ran on base HEAD plus the recorded owned candidate delta. Runtime and metadata bytes were identical throughout; test-only fixes are explicitly qualified below. Each real run retained source-before/source-after manifests and verified no mutation during execution.

| Selection | Actual result |
| --- | --- |
| Source-extracted scheduler using actual error class | 7 PASS, 0 FAIL, 0 SKIP; delayed-timer/dequeue ordering, no late effect, counters/state cleanup, live follower, active noncancellation, FIFO, independent tenants, bounds, error identity and 503 |
| Real Mongo/HTTP queue integration | 6 PASS including parent; explicit transaction session starts only at dequeue, independent tenant progresses, queued session revocation denies fresh/replay, nested rollback reuses session, second service instance encounters a native transaction conflict and preserves one effect/key/audit |
| Original deterministic authorization ordering | 9 PASS including parent and 8 subtests; 7 revoke/deactivation cases exercise fresh/replay, plus mutation-first ordering |
| Full metadata delta and actual archive schema guards | 2 PASS |
| Foundation authorization | 9 PASS |
| Foundation command integration | 6 PASS |
| Other selected affected regressions | Passing CS authorization-port, stock/shipment/payment, CS/outbox/revocation, transaction/UNKNOWN, and first 3 repair-financial cases retained in the 55-pass serial run |
| Last fractional-invoice case | 1 PASS after a later stable resource window; previous guard refusals retained |

There are **88 distinct completed TAP entries across the required selections**, including parent entries, with the stronger seven scheduler checks replacing their earlier seven results in that accounting. The 25 standalone CS cases are counted only from the later run with complete ownership instrumentation. Repeated passes are not added again. These are scoped producer checks, not independent QA or product acceptance.

The actual late-bound CS dependency is verified by observed hooks in the composed runtime and the existing `cs-transaction-port` case. The new two-instance fixture holds the first transaction after its authority writes and observes an actual transient conflict in the other instance before releasing it; it does not manufacture a driver error.

## Failures retained

1. Initial queue integration counted driver implicit sessions and observed 31 rather than one explicit transaction session. Its 13 PASS / 2 FAIL run includes the passing original nine ordering entries. The fixture now excludes only the installed driver's `explicit:false` sessions; production source was unchanged. Corrected queue integration passes.
2. The old external runner's filename allowlist rejected `commands.integration.test.mjs` before allocating a runtime. A copied external runner permits the literal optional `.integration` suffix. The original runner and failure receipt remain.
3. The 55 PASS / 4 FAIL serial run had two setup refusals at CPU 100% / 99.76% and two foundation import failures. The installed API cache versions match foundation declarations exactly: MongoDB driver 6.20.0, memory server 10.2.3. An external resolver maps only those two bare imports for the two exact foundation fixture URLs; no installation, shared dependency edit or production source replacement occurred.
4. The following 14 PASS / 9 FAIL run passed queue, schema and command checks; one foundation before-hook CPU refusal at 99.49% accounts for nine unexecuted cases. A later standalone foundation run passed all nine after fresh original preflight checks.
5. A standalone fractional-invoice invocation was refused before child spawn: CPU samples 100%, 99.7415%, 100% at 2026-11-02 08:54:02–04 UTC, with approximately 7.61 GB free RAM and 741 GB free disk. A later 15-second capacity observation passed every original threshold (maximum CPU 7.7354%, minimum free RAM 7,630,180,352 bytes), followed by the original three-sample and per-replica preflights. The single missing case then passed; the failure was not overwritten. No guard was weakened or unrelated process stopped.
6. Final ledger reconciliation found that the first standalone CS tests loaded their separate dependency cache, so API-only class instrumentation did not enforce or record their reserved-port/PID/drop contract. Those 25 behavioral passes were withdrawn as owned verification. The external runner now wraps both actual cache instances, preserving declared driver versions 6.20.0 for API/foundation and 6.21.0 for CS, with memory server 10.2.3 in each. A dedicated rerun passed all 25 with exactly two fully instrumented replicas and marker-verified drops/stops. Earlier raw evidence remains explicitly insufficient for the ownership contract; no retrospective PID receipt was invented. Read-only inspection after discovery found no remaining mongod process.

Full raw logs, source manifests, commands, UUID markers, PID/OS creation/command identities and cleanup hashes are external under `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/orca-iems-20261102/backend-performance/`. `queue-verification.json` records exact receipts. Fifteen fully instrumented fixture databases were marker-verified and dropped across six actual run groups; all fifteen replicas stopped normally. Independent receipts found no recorded live identities and all 20 reserved ports free. The two earlier CS runtimes with incomplete instrumentation remain separately qualified above. The refused invocation started no runtime. The Python memory watchdog was observed running with its existing 1.5 GiB / 60 s settings and left unchanged.

## Next gate

Coordinator reviews the exact clean local candidate and complete metadata delta. After exact clean-source review is granted, run the original full 96-cell benchmark through the prepared fixture-only acceptance runner, preserving all payloads, repetitions, samples, targets and resource guards. The runner changes only owned namespace/marker, reserved ports and private data placement; it adds no profiling instrumentation or cell filtering. Intermittent CPU admission refusals remain a host constraint to measure for each cell, not a reason to weaken a guard.

Historical independent acceptance remains 17 complete / 1 partial / 78 untested, with the three C8 p95 failures retained. The predecessor diagnostic remains 21 complete / 75 NOT_RUN. Candidate acceptance is 0 / 96 run. Bounded predecessor native integration does not close parent135/157, ErrorTrigger, scheduled-child, WA15/17, PREPARED or independent QA.
