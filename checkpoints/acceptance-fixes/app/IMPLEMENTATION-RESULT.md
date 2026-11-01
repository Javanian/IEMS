# TPR-166 implementation result

**IMPLEMENTED_QA_PENDING.** VIS-001, VIS-002 and BUS-UI-001 are implemented with bounded verification. This is not full 55-feature acceptance or release approval. CTO integration review, independent QA, Designer visual recheck and Security recovery-fence review remain pending.

Workspace: `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-app`; branch `program/iems-accept-fix-20261101-app`. Frozen original base `010ec3b4e826d05b7e1f191286da042fe5a2bd42` remains unchanged. Runtime source tested: `ca6fe4d29c01c3bf3af104e5844ae28ad4501677`; subsequent changes are owned evidence/harness/documentation only. Local commits only; remote/CI UNKNOWN; effective model UNVERIFIED.

## COMMIT-LEDGER

| Scope | Commit | Provenance / paths |
| --- | --- | --- |
| UI predecessor integration | `965807ab178e8c186f9e76a1d213e4e98f3410c8` | Merge clean TPR-164 tip `33afd39d75c825aeb46f519997eff5cf8545d0c2`; existing UI handoff retained |
| Backend predecessor integration | `f04c30c358271b02b5a9c0071f45e46ab8cf0a64` | Merge clean TPR-165 tip `cab39faf03622dbe9b5a99e16bcd54d3b06f3999`; backend cleanup/registry evidence retained |
| VIS-001 | `9d79bfd606ef2f0836e86fa2da640d2b83674cb4` | `apps/web/src/features/portfolio/FulfillmentWorkspace.jsx` |
| VIS-002 | `8aa16950487dfa1b1898e44b981ff2d4082489d0` | `apps/web/src/features/portfolio/operator.mjs`; `PortfolioWorkspace.jsx`; own auth mapping test/TAP |
| BUS-UI-001 | `ca6fe4d29c01c3bf3af104e5844ae28ad4501677` | `apps/web/src/features/portfolio/PortfolioWorkspace.jsx` |

The later handoff commit contains only `checkpoints/acceptance-fixes/app/`. Its full tip is recorded on the issue and external checkpoint to avoid a self-referential SHA. `FILES.txt` is the exact assigned-change file list; `SHA256.json` hashes retained committed Git content except itself (working-tree CRLF conversion does not change those recorded hashes).

## Behavior

Customer-asset returns use their actual `sourceKind`, serial (asset ID fallback), and case ID. Both accepted and unrepaired return rows link to the persisted repair case and do not invent a sales-order `lineIndex`. Actual ordinary E01 shipments retain `6 UN / 4 UN · Line 1`.

HTTP401 `INVALID_CREDENTIALS` gives generic username/password correction guidance in the existing form and omits the redundant sign-in-again link. The backend uses the same diagnostic for unknown identity and incorrect password; actual browser alerts were identical for both. Inputs remain available for correction. Other401 responses retain expiry guidance and the sign-in-again action. Actual revoked-session reads denied access and recovered by signing in again. No authentication/backend policy changed.

Generic MutationForm has `aria-label={title}`, matching its visible heading and existing CommandForm convention. The original `form[aria-label="Save commercial revision"]` selector reaches the real commercial R2 form and saves/approves the negotiated revision. Existing pending, error, duplicate-submit and mounted-state behavior remains intact.

## Verification and limits

| Check | Actual result | Evidence under `evidence/` |
| --- | --- | --- |
| Focused original operator checks plus new auth mapping | exit0;22PASS/0FAIL/0skip | `focused.tap`; `auth-mapping.tap` preserves the earlier2-case check |
| Affected JSX and operator syntax | both JSX esbuild transforms PASS; `node --check` operator exit0 | `compile.json` |
| Actual admission/domain source verifiers | both PASS; inherited registries untouched by this issue | `source-pins.json` |
| Original E01 and CommercialWorkspace integrity | both byte-identical to frozen base; all original assertion calls retained in adapted main/E01 | `assertion-retention.json` |
| Unadapted E01 after R2 fix | FAIL at later dispatch selector; R2, immutableR1, exact conversion retry, engineering, planning, labor, output, QC and genealogy reached | `browser-attempt7.log`, `browser-attempt7/failure-diagnostics.json` |
| Explicit native dispatch continuation plus E02/auth | exit0;7 recorded checks;0 browser exceptions/console errors; diagnostic only | `browser-continuation.log`, `browser-continuation/review-debug-results.json` |
| Final E01 continuation | full original assertions complete: WO6+4, four actual fixture labor actors/windows,10 exact serial outputs, five-source per-unit genealogy, shipments/POD6+4, invoices/VAT, exact135975 settlement and response-loss conservation | `browser-continuation/canonical-e01-native-manifest.json` and screenshots |
| Actual E02 return rows | original mounted helper completes accepted/rejected chains; actual serial/case links; no fabricated line; keyboard opens actual repair;1440/390 no overflow | `browser-continuation/e02-manifest.json`, `return-browser.json` |
| Invalid/stale login and keyboard | actual401s, identical invalid-account/password alerts, retained inputs, native Enter submission, revoked-session expiry link and re-login;390 no overflow | `browser-continuation/auth-browser.json` and screenshots |
| Cleanup | all recorded owned identities stopped; marker-verified DB drops; profiles/data paths absent;5 port bind/close proofs | `cleanup-audit.json` and per-attempt cleanup receipts |

The unchanged E01 helper assumes the direct shipment form, while the current UI defaults to the pick form. Its original downstream timeout is preserved as FAIL, not relabeled. A separate continuation explicitly selects the existing **Record direct dispatch** option after order-fulfillment navigation, then executes every original selector/assertion. `dispatch-continuation.json` records those native selections; original/adapted sources and hashes are retained. CTO/QA must decide how to incorporate this missing interaction into the maintained runner before final acceptance. No production dispatch default or test file was changed to hide the stop.

Synthetic E01 uses its existing actual five-source procurement setup and guarded business clock; E02 setup uses the original mounted authenticated API helper. These establish local software behavior, not physical execution, independently verified inspection, external delivery, production data, statutory tax, or real provider acceptance. Full regression and independent acceptance are NOT_RUN here.

Earlier harness failures remain in `browser-attempt1..6.log` and `browser-e02.log`: missing preexisting dependency junctions before runtime; unrelated mocked trace-heading font readiness/serving restriction; incorrect repository-root Tailwind cwd; own keyboard-event/redirect assumptions; and an escaped selector in the supplemental row probe after the E02 helper completed. Corrected harness code is in this directory. Attempt3's original unconditional cleanup booleans incorrectly claimed DB/client/Mongo cleanup although those resources had never started; `cleanup-audit.json` explicitly corrects that receipt. Earlier frozen QA failures are unchanged.

Source-path whitespace checks pass. Whole-stack `git diff --check` reports seven trailing-whitespace lines in retained raw failure logs (six inherited backend TAP lines, one app failure page line); those historical evidence bytes were preserved.

## Reproduction

Use Node24, cached MongoDB7.0.14, Chrome, the existing dependency trees and a fresh Paperclip run-owned scratch directory. Five ignored dependency junctions reuse the preexisting business-QA web, portfolio-api, wa-demo-bridge, document-rendering and customer-service dependency directories. No install, package-source or manifest change occurred. The first unrelated trace preflight refreshed generated `.vite` cache in the reused web dependency tree (observed modified04:03UTC); that shared cache was not removed or restored. All subsequent actual application runs used the run-owned scratch cache. Run from `apps/web`, with `PAPERCLIP_RUN_ID` and `PAPERCLIP_RUN_SCRATCH_DIR` set by the runtime:

```powershell
$env:PORTFOLIO_REVIEW_DEBUG_ONLY='1'
$env:TPR166_DIRECT_DISPATCH='1'
$env:PORTFOLIO_EVIDENCE_DIR='<fresh owned evidence directory>'
$env:MONGOMS_SYSTEM_BINARY='C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
$env:TMPDIR=Join-Path $env:PAPERCLIP_RUN_SCRATCH_DIR 'browser-continuation'
New-Item -ItemType Directory -Force $env:TMPDIR | Out-Null
$env:TMP=$env:TMPDIR
$env:TEMP=$env:TMPDIR
node --import ../../checkpoints/acceptance-fixes/app/browser-register.mjs test/portfolio-browser.mjs
```

Unset `TPR166_E02_ONLY` and `TPR166_E01_ONLY` for the combined continuation. Omitting `TPR166_DIRECT_DISPATCH` reproduces the retained default-pick stop. The hook selects only E01 plus the added auth/E02 checks, omits unrelated trace-heading/internal/operator journeys, assigns loopback ports32400-32403, uses a fresh marker-owned namespace, adds the actual API proxy and run-owned Vite cache, and records cleanup. It does not mock product HTTP responses. Assertions are mechanically checked with `node checkpoints/acceptance-fixes/app/verify-evidence.mjs` from the repository root.

## Resources, quality and handoff

All owned runtimes stopped before handoff. Per-attempt Mongo PIDs/ports/data paths and browser profiles/PIDs are retained. The final Mongo/browser, API32401, Vite32400 and Chrome debug32403 closed normally; final database was marker-verified before dropping. Independent OS/port audit found no surviving owned runtime. No user database, provider send, public push/merge/deploy, or cloud resource was used.

Raw evidence, including nonportable duplicate adapted modules and browser netlogs, is preserved intact outside the repository at `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/f81b2d17-85f8-45f4-9d77-ce91815ef0e1/0dd7dd43-116b-4c6f-b9d3-c36c850acd48/raw-evidence/`. Portable logs, failures, manifests, original/adapted main/E01 sources, screenshots and receipts are committed here. No browser profile, raw database, cookie or token is committed.

Assigned-change quality gate PASS: existing styling/tokens retained; no invented claims/assets or dead controls; real repair links and named forms verified; invalid/stale/error/success states and keyboard interactions exercised;1440/390 render checks and original E01360/768/1440 checks passed in the bounded continuation; affected source compiles. Existing product-wide design/accessibility is not recertified. Mobile login screenshot and return screenshot were inspected; row text/links are separately captured in `return-browser.json` because the mobile rows are below the initial fold.

Checkpoint: `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/f81b2d17-85f8-45f4-9d77-ce91815ef0e1/0dd7dd43-116b-4c6f-b9d3-c36c850acd48/LATEST.md`.

Next owner/action: CTO reviews this committed stack and the retained runner stop, then freezes the corrected candidate for independent QA, Designer and Security review. No implementation blocker remains; all acceptance conclusions beyond the bounded checks remain pending.
