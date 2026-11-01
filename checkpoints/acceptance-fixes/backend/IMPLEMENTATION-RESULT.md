# TPR-165 backend handoff

Fixture deliverables: **IMPLEMENTED_QA_PENDING**. Whole issue: **BLOCKED** on CTO scope for the Operations source admission digest. VIS-004 remains reproducible and unfixed. No full-feature acceptance or independent review is claimed.

Workspace: `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-backend`, branch `program/iems-accept-fix-20261101-backend`. Base: `010ec3b4e826d05b7e1f191286da042fe5a2bd42`. Effective model UNVERIFIED. Local commits only; remote/CI UNKNOWN.

## COMMIT-LEDGER

| Finding | Commit | Changed source/test files | Result |
| --- | --- | --- | --- |
| BUS-REG-001 | `24c390cf18d757bec8a2421584a1038f7687d8d1` | `ops/operations/voice.test.mjs`, `ops/operations/workforce.test.mjs` | Real admission and separate-effects constructors supplied; all original assertions retained. |
| BUS-ISO-002 | `27dc9e3ffe0da0854a4a170e1ff7acfb909f9830` | `apps/portfolio-api/test/wave4c-labor.test.mjs` | Actual client/loopback/namespace/unique UUID marker checks; original labor behaviors retained. |
| VIS-004 | No implementation commit | `apps/portfolio-api/src/operations.mjs` unchanged | Proven concurrent authorization-fence conflicts; proposed patch only. |

The final evidence commit owns only `checkpoints/acceptance-fixes/backend/`, including this document, the two harnesses, proposed patch and evidence files. `git log` identifies that commit without a circular self-reference.

## Proven results

BUS-REG-001: original actual Mongo fixtures return HTTP500, `Cannot read properties of undefined (reading 'effect')`. The actual access is `runtime.saasAdmission.effect`, not the `separateEffects` label used in the original QA report. Both real dependencies now match the composed runtime's constructors and initialization order. Neither permission nor effect mocks were added. The synthetic voice store and FACE verifier remain the original bounded software fixtures; these tests do not establish real audio/model/biometric acceptance.

BUS-ISO-002: the original frozen labor test fails its old prefix assertion against a genuinely created `portfolio_owned_iems_qa_business_c8d238a7_<16hex>` database. The corrected test verifies its actual Mongo client identity, single loopback host, exact native or amended namespace shape, one marker and UUID marker identity. The existing `startOwned` helper still creates a fresh replica and random database itself, and verifies its original marker before dropping that database. No caller-supplied URI or databaseName override is introduced. The evidence hook changes only the actual database selection in that helper; it never spoofs `databaseName` or modifies behavior assertions. This is a current-run synthetic fixture proof, not blanket authorization for other databases. The original Board amendment remains in `D:/Project AI/GITHUB/IEMS-evidence/qa-parallel-20261031/QA-ISOLATION-AMENDMENT.json`.

VIS-004: actual `initialize`/`createApp`, strict source/admission verification, real Mongo replica, guarded synthetic seed, real cookie authentication, no injected database errors. In each empty/populated phase all 15 sequential dashboard requests return200 with correct order availability/count. Two overlapping requests return `[200,500]`; four return `[200,500,500,500]`. Sanitized server exception is `MongoServerError`, code112, `TransientTransactionError`, action `operations.read`, during `authorizeInTransaction`. That method writes authorization fences; three immediate bounded transaction retries exhaust while the other read holds the same fence. This reproduces an ordinary-request concurrency failure. It does not prove that the historical visual screenshot had exactly this request overlap; those original results remain unchanged.

The proposed `VIS-004-proposal.patch` adds up to five dashboard snapshot attempts with 50/100/200/400ms backoff only for labeled transient transaction errors, retaining the existing transaction helper's commit reconciliation and all authorization fences. `git apply --ignore-whitespace --check` and syntax checking of its scratch candidate pass. **It has not been applied or runtime-verified.** Applying it changes a pinned source digest in `packages/tenant-lifecycle/admission-registry.json`, which is outside assigned ownership. No pin or verification gate was bypassed. CTO scope request: own issue comment `2b9216d2-853b-4693-b4f2-f71c19062c74`.

## Checks and retained failures

All commands ran in the workspace above with cached MongoDB7.0.14, one test worker and owned loopback resources. Run scratch supplied TEMP/TMP; no installation, external delivery or production data operation occurred. Three ignored dependency junctions reuse existing business QA dependencies at `apps/portfolio-api/node_modules`, `packages/customer-service/node_modules` and `packages/document-rendering/node_modules`; their targets were not changed.

| Check | Actual result | Evidence |
| --- | --- | --- |
| First original fixture invocation | exit1, 0/2; missing local dependencies before execution | `evidence/original-fixtures.tap` |
| Original voice/workforce after dependency setup | exit1, 1 PASS/2 FAIL; real missing admission dependency | `evidence/original-fixtures-with-deps.tap` |
| Fixed original voice/workforce | exit0, 3 PASS/0 FAIL/0 skipped | `evidence/fixed-fixtures.tap` |
| Corrected labor, native namespace | exit0, 6 PASS/0 FAIL/0 skipped | `evidence/labor-default.tap` |
| Frozen original labor, actual amended namespace | exit1, old prefix assertion; later behaviors not run | `evidence/labor-amended-original.tap` |
| Fixed labor + original voice/workforce, amended fixture | exit0, 9 PASS/0 FAIL/0 skipped | `evidence/fixed-owned-selection.tap` |
| First dashboard probe setup | exit1, missing document-rendering dependency before execution | `evidence/dashboard-initial.tap` |
| Initial dashboard observation | exit0 observational probe; sequential200 and concurrent500 retained | `evidence/dashboard-original.tap` |
| Final committed-source selection | exit0, 10 reported PASS/0 FAIL/0 skipped: 9 fixture cases plus 1 observational dashboard probe; **not a dashboard acceptance PASS** | `evidence/final-observation.tap` |
| Final negative checks | actual unauthenticated401, unknown-source404, revoked-role403 | `evidence/final-observation.tap` |
| Original behavior assertion retention | PASS for all three changed tests; only obsolete labor namespace assertion replaced | `evidence/assertion-retention.json` |
| Syntax checks | exit0 for all changed test/harness modules, unchanged operations and proposed scratch candidate | command receipts below |
| Whitespace and patch applicability | `git diff --check`, `git apply --ignore-whitespace --check .../VIS-004-proposal.patch`: exit0 | source unchanged |

Final runtime-tested source SHA: `27dc9e3ffe0da0854a4a170e1ff7acfb909f9830`, with then-untracked handoff harnesses exactly as committed in the evidence commit. The later handoff changes do not alter the three implementation files or production source. Expected teardown socket-reset diagnostics remain in raw logs; they did not fail assertions. Two initial commit attempts failed because injected author identity was empty; setting this shell's explicit agent identity allowed the two separate commits without repository/global config changes.

Reproduce the amended fixtures in PowerShell:

```powershell
$env:MONGOMS_SYSTEM_BINARY = 'C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:TPR165_AMENDED_LABOR = '1'
node --import ./checkpoints/acceptance-fixes/backend/owned-runtime.mjs --test --test-concurrency=1 apps/portfolio-api/test/wave4c-labor.test.mjs ops/operations/voice.test.mjs ops/operations/workforce.test.mjs
```

Use a real run ID in `PAPERCLIP_RUN_ID` and run-owned TEMP/TMP. For the original namespace failure also set `TPR165_ORIGINAL_LABOR=1`; unset it before checking the corrected test. The hook loads the exact base labor source with `git show`. It never changes production source/admission checks. To observe VIS-004, run `dashboard.test.mjs` with the same hook. After a scoped source fix, set `TPR165_EXPECT_DASHBOARD_FIXED=1` to require all concurrent statuses200 instead of merely recording them.

Syntax: `node --check` for each changed `.mjs` file and `apps/portfolio-api/src/operations.mjs`. No TypeScript files changed; no full build/regression was run.

## Cleanup and next action

`evidence/cleanup.json` and raw final receipts record actual marker DB drops, API close events, Mongo PID/start/stop/port/data paths and post-stop checks. Final Mongo PIDs14920/22632/15608/8556 are dead; ports58374/58391/58409/58421 have no listener and all four data paths are absent. API ports58379/58397/58414/58426 have no listener. No task-scratch Mongo process remains. No browser/profile was started. Prior instrumented run PIDs14516/7200/10704 also have explicit stop receipts. All runtime resources are handed off stopped; dependency junctions are inert local setup only.

**CTO next action:** explicitly extend TPR-165 ownership to the operations source digest in `packages/tenant-lifecycle/admission-registry.json`, then wake this issue. Backend can apply/review the prepared bounded fix, update only that digest, rerun the original fixtures plus strict empty/populated concurrent dashboard regression, and commit VIS-004 separately. Until then, do not integrate this branch as a corrected full candidate. CTO integration, independent QA, Designer visual review and Security recovery-fence review remain pending.

Checkpoint: `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-165/3f28ceb5-2fcb-4ee8-b4a4-ebd6bdb5716a/LATEST.md`.

Evidence text is normalized to LF for committed hash reproducibility. The proposed patch applicability check uses `--ignore-whitespace` against this CRLF worktree. The earlier cleanup listener observation is preserved separately in `cleanup-initial.json`; a subsequent check confirms it has drained. No runtime process was killed or port reused to obtain that result.
