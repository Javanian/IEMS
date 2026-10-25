# K2a lead acceptance

Bounded K2a local acceptance completed. Baseline `2b66c853a3ef4420b7fb899b4af75af230873f7b`, branch `feat/manufacturing-serial-custody`. Received identity custody only; complete K2b installation/graph is not accepted by this slice.

| Gate | Current evidence |
| --- | --- |
| Owner HTTP | Final owner-serial-custody.tap:9/9 pass, exit0, no skips |
| Maintained API | 33 files,205/205 pass, exit0, no skips |
| Frontend | Lead frontend-tests.log:74/74 pass, exit0, no skips |
| Independently authored HTTP | Lead execution:11/11 pass, exit0, no skips |
| Production web build | Pass including PWA; existing Browserslist/chunk-size warnings retained |
| Complete Chrome browser, eleven switches | Final attempt2:110 checks,0 exceptions,0 console errors, exit0 |
| Source/import audit and evidence hashes | Final243 files/268 relative imports, diff check0, zero errors; raw hashes retained externally |

## Findings, repairs and boundaries

Owner attempt1 failed before the business journey because its synthetic quote expiry omitted canonical millisecond formatting. Existing INVALID_EXPIRY correctly rejected it. The fixture now uses canonical .000Z. No product validation was relaxed. Attempt2 and the final owner log passed9/9; failed evidence is retained.

Independent source review reproduced a trailing duplicate in a persisted claim.serials array that could pass a unique-count-only test. Validation now requires equal array lengths, unique strings and exact unit/serial order; owner and independent regressions retain the tamper case. Claims GET now reads WO/version and active claims in one snapshot. Consumption verifies the exact released ratio alongside reservation quantity/UOM/trace/identity evidence; current claim versions must be safe positive integers.

The independent HTTP probe is separately authored and lead-executed after the owner handoff. Its deterministic interventions commit after middleware authorization and before the target transaction guard, not inside an internal two-snapshot barrier. Its README identifies all excluded authorization collections and untested cases. Common receipt/WO/unit write fences require source review in addition to bounded ordering probes.

The connected browser is lead-authored and uses actual native adoption, planning, UUID selection, abandon/reclaim, both release paths, first-operation/QC and read/permission/retry controls. Earlier commercial/receipt preparation, engineering-package preparation and specific negative/pagination checks use real authenticated HTTP; persisted identities/counters/events are checked directly in Mongo. It uses supplemental three-output WO2/1 sources, one UN per output and two SET per output. It does not alter or establish full canonical E01, output installation or graph parity.

Preserve complete Mongo teardown diagnostics, including any ECONNRESET despite passing exits. Build warnings, browser failures and visual corrections are recorded here as executed. Do not infer a flake-free lifecycle, production service or live provider/broker proof.

Browser attempt1 stopped in the legacy manufacturing navigation before K2a: a work-order resource displayed Connection unavailable while the harness waited for Open source sales order. No Chrome exceptions or console errors were recorded. The exact transport cause was not established. The harness now retains loadingFailed diagnostics and a failure screenshot/JSON for subsequent failures; the same assertions and real transport remain unchanged. The failed run is preserved rather than counted as a pass. Attempt2 subsequently passed the same legacy navigation and all110 checks; this does not identify the original cause or prove a flake-free transport lifecycle.

## Commands and retained evidence

On this host set MONGOMS_SYSTEM_BINARY to cached Mongo7.0.14 and TMPDIR to the external evidence directory. Use marked disposable owned databases only; heavy jobs run sequentially.

```powershell
# From apps/portfolio-api:
node --test --test-concurrency=1 --test-reporter=tap test/wave4k2a-serial-custody.test.mjs
node scripts/test-maintained.mjs
# From repository root:
npm --prefix apps/web run test:portfolio
node --test --test-concurrency=1 --test-reporter=tap checkpoints/wave4k2a/qa/custody-ordering.test.mjs
npm --prefix apps/web run build
python checkpoints/wave4k2a/build-manifest.py
python checkpoints/wave4h/audit-publication.py checkpoints/wave4k2a/SOURCE-MANIFEST.json
```

The complete browser uses PORTFOLIO_PAGINATION, REPAIR, DOCUMENTS, WMS, ENGINEERING, LABOR, VAT, INQUIRY, LOT_SERIAL, GENEALOGY and SERIAL_CUSTODY all set to1 (each uses the PORTFOLIO_ prefix). Run `node test/portfolio-browser.mjs` from apps/web with an external PORTFOLIO_EVIDENCE_DIR. No skip-CS flag or inherited NODE_TEST_CONTEXT.

Raw evidence: `D:/Project AI/GITHUB/IEMS-evidence/wave4k2a-20261024/`. Normalized source hashes are separate from raw evidence SHA256. No TAP, screenshot, PDF or service log belongs in the checkpoint commit. Prior accepted worktrees and dirty main are preserved. Publication and remote merge remain separate decisions.

Final visual review inspected representative claimed, consumed and receipt authority screenshots at desktop/mobile sizes. Twelve new snapshots cover the three sections at four widths, with real DOM overflow and44px-control assertions. Claim/adoption controls were exercised natively; the section screenshots are not a full-page capture of every control. API source/tests and UI product source stayed unchanged after the accepted test/build runs; only browser diagnostics and checkpoint documentation changed afterward. No owned API listener or marked run process is retained at checkpoint.
