# TPR-165 backend implementation result

**IMPLEMENTED_QA_PENDING.** BUS-REG-001, BUS-ISO-002 and VIS-004 are implemented with bounded local verification. CTO integration review and independent QA, visual and security reviews remain pending. No full55-feature acceptance is claimed.

Workspace: `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-backend`; branch `program/iems-accept-fix-20261101-backend`. Original base `010ec3b4e826d05b7e1f191286da042fe5a2bd42`; clean continuation baseline `eda87776d02ec816b181f8fe21f77b61585a4ee7`. The original frozen QA candidate was not mutated. Local only; no push, merge, deployment or external delivery. Remote/CI UNKNOWN; effective model UNVERIFIED.

## COMMIT-LEDGER

| Finding | Commit | Exact implementation paths |
| --- | --- | --- |
| BUS-REG-001 | `24c390cf18d757bec8a2421584a1038f7687d8d1` | `ops/operations/voice.test.mjs`; `ops/operations/workforce.test.mjs` |
| BUS-ISO-002 | `27dc9e3ffe0da0854a4a170e1ff7acfb909f9830` | `apps/portfolio-api/test/wave4c-labor.test.mjs` |
| VIS-004 | `a057def5fce1f4e2d3fabdf0371c3ebeb0718c85` | `apps/portfolio-api/src/operations.mjs`; `packages/tenant-lifecycle/admission-registry.json`; `packages/tenant-lifecycle/domain-registry.json`; handoff tests `dashboard.test.mjs`, `dashboard-retry.test.mjs`, `registry-impact.test.mjs`, `source-pins.test.mjs` |

All remaining files belong to `checkpoints/acceptance-fixes/backend/`; `SHA256.json` enumerates the complete handoff file set and committed content hashes. The evidence-only handoff tip is identified by `git log`; it does not change runtime source.

## Implemented behavior and provenance

BUS-REG-001: original standalone actual-Mongo fixtures failed HTTP500 at `runtime.saasAdmission.effect`. The original QA report called the missing dependency `separateEffects`; the actual source access is recorded precisely. Both real constructors now match composed runtime dependencies and initialization order. Original behavioral assertions, synthetic voice store and FACE verifier are retained. This remains bounded software evidence, not real model/audio/biometric acceptance.

BUS-ISO-002: the original frozen labor test failed its obsolete prefix assertion on an actual marker-owned amended database. The corrected guard checks actual client identity, single loopback host, exact native/amended namespace shape, one marker and UUID identity. `startOwned` continues to create its own fresh replica/random database and verify the original marker before dropping it. The evidence hook only selects the actual amended database; no databaseName spoof, arbitrary URI permission or behavior-assertion removal is introduced. Original labor assertions all execute.

VIS-004: prior actual composed API/Mongo tests reproduced paired dashboard responses `[200,500]` and four-way responses `[200,500,500,500]` on both empty and populated data. Sanitized errors show MongoServerError112/TransientTransactionError in `authorizeInTransaction` authorization-fence writes. Three immediate transaction attempts exhausted while another ordinary read held the same fence. The fix gives dashboard snapshots at most five attempts with50/100/200/400ms backoff, only for correctly labeled transient errors. Actual authorization fences remain. `boundedTransaction` still handles commits and unknown outcomes; generic errors and unknown commits do not replay reads. No transaction helper/auth/guard code changed.

The strict current regression requires HTTP200 for every request, with no observation-only/expected500 mode:30 sequential plus36 overlapping requests across empty/populated fixtures, checking accurate order availability/count. Each phase repeats two-way and four-way overlap three times. All66 return200. Actual unauthenticated401, revoked-role403, unknown-source404 and a separately revoked-session401 remain denied. The exact historical visual capture's request overlap remains unproven; original visual findings are preserved rather than retrospectively relabeled.

## Exact Board registry exception and schema impact

Authority: Board comment `a5c4df6a-806f-42ee-8041-58d79a704761`, plan revision `e088715f-d4cc-422a-b87b-64818d4812db` on TPR-165. The two committed generators ran unfiltered:

- `node packages/tenant-lifecycle/build-registry.mjs`
- `node packages/tenant-lifecycle/build-admission-registry.mjs`

Repeated generation is byte-identical. The full registry delta is only the existing Operations normalized source digest in both registries, plus `TransientTransactionError` and `hasErrorLabel` in that domain source's fields. New digest: `5b633da99935e8931e7dbdc94d8387753f9ede8a16e589f7e6a503bafef48079`. No generators, registered sources, collections/dispositions, routes, permissions, receipt rules or unrelated entries changed. Actual admission/domain source verifiers pass. Both reject an Operations mismatch in an isolated copy, then pass after exact restoration; the worktree and dependency targets were not modified by that negative control.

This field expansion is not cosmetic or hash-only. Effective top-level field allowlists add both names for six BUSINESS collections: `manufacturingWorkOrders`, `operationsAudit`, `operationsKeys`, `operationsSampleRevisions`, `operationsSamples`, `qualityResources`. Inventory unions also add them for four retained collections: `operationsTelemetryOutbox`, `voiceJobRevisions`, `voiceJobs`, `voiceZones`; their dispositions remain retained/private/technical. The global nested-field union is unchanged because other pinned sources already supplied both names.

The real domain snapshot test confirms the two bounded added names are admitted in an owned Operations sample, while unrelated unknown fields and private fields still fail closed at both top-level and nested paths. This intentionally tests the actual validation port, not a rewritten validator. An initial newly authored fixture omitted selected-plant grant context and failed SCOPE_DENIED before those assertions. The corrected test supplies its real synthetic grant context; no guard changed. Both results are preserved. No tenant removal/restore, migration or production operation was executed.

## Verification

Runtime source tested matches `a057def5fce1f4e2d3fabdf0371c3ebeb0718c85`. The strict selection began from the reviewed dirty continuation tree, then was committed; only indentation in its dashboard harness changed after execution. Production code/metadata bytes and assertions are identical. The corrected domain test ran across that commit with identical code. Later handoff-only changes do not alter runtime source.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Strict dashboard + original labor/voice/workforce + retry contracts | exit0;12PASS/0FAIL/0skip:9 original fixture cases,2 retry contracts,1 strict dashboard case | `evidence/vis004/vis004-strict.tap` |
| Actual Operations pin mismatch/restoration | exit0;1PASS/0FAIL/0skip | `evidence/vis004/source-pins.tap` |
| Exact generated delta and actual domain/private guards + revoked dashboard session | exit0;2PASS/0FAIL/0skip | `evidence/vis004/registry-impact-corrected.tap` |
| Initial new domain fixture context omission | exit1;1PASS/1FAIL; preserved SCOPE_DENIED before validation checks | `evidence/vis004/registry-impact-initial.tap` |
| Generator determinism, full delta and schema impact | PASS; unfiltered committed generators; exact Board exception | `evidence/vis004/registry-review.json`, `registry-delta.tap` |
| Retry contract | max5 attempts; waits50/100/200/400; generic error once; ambiguous commit read once/commit3 with COMMIT_OUTCOME_UNKNOWN | `dashboard-retry.test.mjs`, `retry-contract.tap` |
| Syntax / whitespace | affected JS syntax checks and `git diff --check` exit0 | `evidence/vis004/validation.json` |
| Original assertion retention / initial failures | preserved original evidence, including setup failures and pre-fix500/namespace failures | `evidence/assertion-retention.json`, prior `evidence/*.tap` |

Reproduce with cached MongoDB7.0.14, run-owned TEMP/TMP (D: preferred for data), actual `PAPERCLIP_RUN_ID`, and `TPR165_AMENDED_LABOR=1`:

```powershell
node --import ./checkpoints/acceptance-fixes/backend/owned-runtime.mjs --test --test-concurrency=1 apps/portfolio-api/test/wave4c-labor.test.mjs ops/operations/voice.test.mjs ops/operations/workforce.test.mjs checkpoints/acceptance-fixes/backend/dashboard-retry.test.mjs checkpoints/acceptance-fixes/backend/dashboard.test.mjs checkpoints/acceptance-fixes/backend/registry-impact.test.mjs checkpoints/acceptance-fixes/backend/source-pins.test.mjs
```

`TPR165_ORIGINAL_LABOR` must be unset for corrected tests. The current dashboard test is unconditionally strict. Retry-contract tests use simulated sessions with the actual transaction helper; all named API/domain regressions use real owned Mongo. Three existing ignored dependency junctions remain inert setup, targeting preexisting business QA dependency trees without mutation. No install, frontend change or full workspace regression/build was required; affected paths are JavaScript, so no TypeScript path changed.

## Cleanup and handoff

All owned databases were marker-verified and dropped, HTTP servers closed, Mongo clients closed and replica processes stopped. `evidence/vis004/cleanup.json` records every PID/port/data path and drop/stop receipt, including the initial failed domain fixture. `cleanup-initial.json`, when present, preserves any earlier post-close socket observation before the final recheck. No browser/profile, provider message or unrelated process was started/stopped. Old run evidence remains separately retained; earlier blocked-state documents/validation receipts are historical.

Next owner: CTO/TPR-168 reviews the exact derivative registry delta and integrates this tip into a corrected candidate. Sole heavy runtime ownership may transfer only after these cleanup receipts; the existing166 ->167 ->168 prerequisites remain. Independent QA, Designer visual and Security recovery-fence reviews still follow the corrected freeze. No product/security clearance or full55 acceptance is issued here.

Checkpoint: `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-165/3f28ceb5-2fcb-4ee8-b4a4-ebd6bdb5716a/LATEST.md`.
The shared MemPalace save was unavailable because another writer holds its lock. No retry or stop was attempted; the verified note remains in `vis004-memory-note.json` and this issue handoff.
