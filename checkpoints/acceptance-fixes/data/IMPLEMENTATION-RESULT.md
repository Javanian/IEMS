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
