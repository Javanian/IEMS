# TPR-167 — IMPLEMENTED_QA_PENDING

BUS-ISO-003 implemented under accepted Board plan revision2. Source commit `708b5d488193658201d94349b50f0fe33f695091`. No implementation blocker remains. CTO reviews/integrates this local handoff; independent affected QA follows the corrected freeze. This is not product or55-feature acceptance.

## COMMIT-LEDGER

| Purpose | Commit | Provenance |
| --- | --- | --- |
| Predecessor integration | fde4f9ca9325f00e3326f04c47b60b92bc0f4125 | Exact clean app tip16eac30042d9aa1067e4351c565d6f582e704af5, including UI/backend |
| Preserved scope-stop evidence | d462bbe1322610ff253bcaebab0493084acfd3c7 | Original CLI rejection retained below; Board later accepted CLI ownership extension |
| BUS-ISO-003 fix | 708b5d488193658201d94349b50f0fe33f695091 | Shared narrow policy, real native lane lifecycle and original assertion preservation; approved plan revision2 |

## Scope and behavior

Product files: `ops/demo/reporting-runtime.mjs`, `ops/demo/reporting-cli.mjs`, `ops/demo/reporting-runtime.test.mjs`. All other new/updated files are under owned `checkpoints/acceptance-fixes/data/`: this handoff, `mongo-isolation.cjs`, `register-owned-lane.mjs`, `memory-note.json`, and exact receipts listed in `evidence/MANIFEST.sha256`.

Runtime and CLI share a single namespace predicate. Preserve `portfolio_test_<32 lowerhex>` and admit only `portfolio_owned_iems_qa_<business|visual|security>_<8 lowerhex>_<16 lowerhex>`, the uniquely identified general lane form in the original QA adaptation. Prefix-only, unknown lane, malformed and arbitrary/user/shared names fail. The historical short visual exception is not admitted as a general namespace.

The predicate is only a namespace check: runtime still checks UUID, actual `db.databaseName`, DB ownedRun marker and matching reporting-owner.json. Runtime now also explicitly rejects relative extraction roots; nonsymlink root/realpath checks remain. CLI retains URI loopback, credentials/path/query restrictions, absolute nonsymlink root, owner identity, token and config allowlist. Source authentication/authorization, singleton, replay, immutable extraction and cleanup remain unchanged. Raw Python helper unchanged. No spoofed DB identity or CLI/runtime export loader hooks.

The receipt harness derives from the original QA business adapter and only maps fixture setup to actual fresh native Mongo and an actual lane DB name. It records dynamic API ports and cleanup. The unowned helper file is byte-identical to HEAD (`evidence/harness-proof.json`); its assertions are mechanically compared before loading. All51 original runtime test assertion lines remain verbatim.

## Verification and reproduction

Cwd `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-data`; branch `program/iems-accept-fix-20261101-data`. Tested HEAD `d462bbe1322610ff253bcaebab0493084acfd3c7` plus owned uncommitted changes subsequently committed as708b5d4. Product source working-byte SHA256 in `evidence/source-hashes.json`; product files unchanged between both suites and source commit. Handoff-only later commits do not change tested source.

```powershell
$env:QA_SOURCE_ROOT=(Get-Location).Path
# Existing private, explicitly assigned run directory; create a fresh child for each run.
$env:QA_RUNTIME_ROOT='<private D: run directory>'
$env:MONGOMS_SYSTEM_BINARY='C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:TMP=$env:PAPERCLIP_RUN_SCRATCH_DIR
$env:TEMP=$env:PAPERCLIP_RUN_SCRATCH_DIR
node --import ./checkpoints/acceptance-fixes/data/register-owned-lane.mjs --test --test-concurrency=1 --test-reporter=tap ops/demo/reporting-runtime.test.mjs
```

Actual raw root `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-167/4536ffd1-f805-469c-a4cf-2714a592d932/runtime-d0c757fe`; receipt rerun in its `receipted/` child. Free D: space before launch784971669504 bytes; adapter rechecks >=1GiB before every fixture and preflights fixed loopback Mongo port32100. Only one native runtime at a time.

- First full suite: exit0,12 PASS,0 FAIL,0 SKIP,174601.9543ms (`evidence/first-reporting-lane.tap`).
- Receipt-complete rerun: exit0,12 PASS,0 FAIL,0 SKIP,152341.7007ms (`evidence/reporting-lane.tap`). Repeat was required because the first run did not record dynamic API ports.
- Original extraction/delivery/replay/singleton, resource/scope/revoked-session rejection, raw interrupted-write/replay and CLI successful reconciliation/extraction/cleanup all reached. Relay graph/order/gap/authorization assertions passed.
- New controls: all three allowed lane shapes and legacy namespace positive; malformed/arbitrary namespace, missing DB marker, mismatched owner file, relative/symlink root, foreign/nonloopback/credential/path/query URI, malformed token and extra config rejection.
- Separate legacy CLI validation with matching owner file:1 assertion PASS, no connection opened. No separate legacy heavy lifecycle rerun.
- Five syntax checks (three product/test files and two harness files), git diff --check, owned product path check and credential-pattern scan PASS. No actual credential/cookie/token values in committed evidence.
- Two earlier import setup attempts failed0 PASS/1 FAIL each (missing mongodb, then pdfkit); no runtime started. Preserved in setup-and-results.json. Reused ignored local dependency junctions to predecessor app installs for portfolio-api, document-rendering and customer-service; no installation or target changes.

## Resources and limits

`evidence/resource-events.ndjson` records both final actual database names, UUID markers, Mongo PIDs19020/8452, killer PIDs15448/6088, test PID2256, API ports62283/62326 and native data paths. Each fixture's original teardown verifies its DB marker before dropping only that DB, closes its API/client and stops native Mongo. Both fixture cleanup receipts completed. The initial run's Mongo PIDs15416/20500 and test PID9448 are retained separately.

Final independent audit `evidence/cleanup-audit.json`: all10 recorded runtime/test/killer PIDs absent; Mongo starts4/stops4; ports32100,62283,62326 successfully rebound and closed. Native directories remain stopped under private evidence root; no source evidence deleted. No browser/profile started. Reporting owner/lock cleanup assertions passed. No user PostgreSQL/other task target touched; no SQL, production connection, send, cloud spend, push, public merge or deploy.

Prior dbt/SQL PASS retained without rerun because untouched. Full regression, successful real Parquet integration and independent QA/security/visual acceptance are not claimed. Remote/CI UNKNOWN; effective model UNVERIFIED. Local committed delivery only.

Checkpoint: `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-167/4536ffd1-f805-469c-a4cf-2714a592d932/LATEST.md`.
Next owner/action: CTO review/integration, then freeze a corrected candidate for independent affected QA. Frozen original010ec3b4 remains unchanged.

---

# Historical evidence — superseded scope blocker, preserved verbatim
# TPR-167 scope blocker and predecessor handoff

**BLOCKED_SCOPE_DECISION; implementation NOT_STARTED.** No acceptance or IMPLEMENTED_QA_PENDING claim. CTO action: add `ops/demo/reporting-cli.mjs` to this issue's owned paths for a narrow namespace/proof contract change, or explicitly revise the requirement that the unchanged original CLI lifecycle assertions execute on the amended namespace. Retain ownership, loopback, source, token, file, no-spoof and no-bypass gates.

## COMMIT-LEDGER

| Purpose | Commit | Provenance |
| --- | --- | --- |
| Clean predecessor integration | fde4f9ca9325f00e3326f04c47b60b92bc0f4125 | Merge exact clean app tip 16eac30042d9aa1067e4351c565d6f582e704af5; includes UI/backend; tree identical to predecessor |

Workspace `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-data`; branch `program/iems-accept-fix-20261101-data`; original frozen base `010ec3b4e826d05b7e1f191286da042fe5a2bd42` remains immutable. This issue changes no product source. Exact owned new file: `checkpoints/acceptance-fixes/data/IMPLEMENTATION-RESULT.md`; merge inherits predecessor files without rewriting them. Local only, no push/deploy. Remote/CI UNKNOWN; effective model UNVERIFIED.

## Evidence and conflict

Read original final verdict/matrix and business, visual, security results; final FINDINGS.json entry BUS-ISO-003; Board QA-ISOLATION-AMENDMENT.json. Original business failure remains FAIL: `startup-reverification.tap:196` reports EXPLICIT_SYNTHETIC_DATABASE_REQUIRED, runtime validator line13. Original relay dependency graph did pass separately; do not conflate that with lifecycle completion. dbt/SQL prior PASS retained, not rerun.

The two assigned runtime files cannot finish the stated launcher acceptance:

- `ops/demo/reporting-runtime.mjs:13` checks only `portfolio_test_<32hex>`.
- `ops/demo/reporting-cli.mjs:14` independently checks the same exact namespace. `runReportingCli` calls it at line44 before any connection.
- Original `reporting-runtime.test.mjs:123-125` derives `config.databaseName` from the actual owned DB and calls `runReportingCli(config)`. It requires successful reconciliation and cleanup. A real amended DB therefore still fails here after any runtime-only fix.

Changing an assertion to expect rejection, spoofing databaseName, rewriting the CLI export via a loader, or using an old namespace instead of proving the amended lane would conceal the contract conflict. None was done. CLI is outside the explicit owned paths. No need to request auth/helper/domain/SQL/admission changes. Any broader Python/raw path impact must be assessed if the CTO extends scope; no raw behavior acceptance is claimed here.

Original evidence root: `D:/Project AI/GITHUB/IEMS-evidence/qa-parallel-20261031/business/resume-6e57bece/`; final findings `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-152/11bf28d0-19fb-46f2-9855-52241620f39a/final-packet/FINDINGS.json`; amendment `D:/Project AI/GITHUB/IEMS-evidence/qa-parallel-20261031/QA-ISOLATION-AMENDMENT.json`. Earlier failed results preserved.

## Minimal verification

Tested tree fde4f9ca9325f00e3326f04c47b60b92bc0f4125, cwd as above. `node --check` for reporting-runtime.mjs, reporting-runtime.test.mjs and reporting-cli.mjs: each exit0. `git diff 16eac30042d9aa1067e4351c565d6f582e704af5 HEAD --stat`: empty. No heavy regression launched. Full lifecycle/new guard controls NOT_RUN pending scope decision.

Actual exported CLI reproduction, exit0; one assertion PASS, no DB opened:

```powershell
node --input-type=module -e 'import {validatePrivateConfig} from "./ops/demo/reporting-cli.mjs"; import assert from "node:assert/strict"; const config={databaseName:"portfolio_owned_iems_qa_business_24afb268_0123456789abcdef",marker:"24afb268-e20d-432a-88ad-746a6a34f695",token:"a".repeat(43),uri:"mongodb://127.0.0.1:32170/?replicaSet=owned",root:process.env.PAPERCLIP_RUN_SCRATCH_DIR}; await assert.rejects(validatePrivateConfig(config),/EXPLICIT_PRIVATE_SYNTHETIC_CONFIG_REQUIRED/); console.log("PASS: actual exported CLI rejects documented lane before filesystem access or Mongo connection; 1 assertion, no DB opened");'
```

The URI is an unconnected synthetic input. This proves the blocking first guard, not a positive isolation test. No filesystem owner file is needed because rejection precedes filesystem access. No bypass exports or package installations.

Resources started: NONE. PID/port/DB/profile ownership and stop receipts: N/A, no runtime created. Predecessor actual cleanup is retained in app evidence/cleanup-audit.json and final predecessor checkpoint. Two initial merge attempts failed before mutation due injected empty Git identity; successful merge uses explicit task-local author/committer identity and required Paperclip trailer, with no global config change.

Next owner/action: CTO updates this existing issue's exact file scope or acceptance contract. Data then implements the coherent guard, preserves every original assertion, runs native owned positive/negative cases and records PID/port/DB cleanup; CTO integration and independent QA remain required. No delegated issues or retry chains created.
