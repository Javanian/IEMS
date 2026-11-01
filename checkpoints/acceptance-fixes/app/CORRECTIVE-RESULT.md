# TPR-166 corrective handoff after independent169–171

**IMPLEMENTED_QA_PENDING. Product remains UNACCEPTED.** The source/test correction is complete with minimum local checks. Native repair/company/purchased journeys, the actual reporting route and customer-return browser recheck remain for independent post-freeze QA. No full55 acceptance is claimed.

Authority: CTO comment `eb8c3663-c834-404f-a85d-c21d0623a92a`, plan revision `a38d093b-3c08-49b2-9778-6c54edb7897e`, and TPR-135 corrected-qa-assessment. TPR-169/170/171 findings were read directly; their failures remain unchanged. BUS-RETURN-DETAIL-001 and VIS-005 are one canonical product root. Original frozen/current base `9269ae5d504378ecf7bdaae0edf963b893afcc96` stays immutable. The app worktree was clean on that exact SHA; `git merge --ff-only` of the required base returned already up to date. No additional app prerequisite existed in the current graph. Platform retains heavy runtime ownership.

Workspace `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-app`, branch `program/iems-accept-fix-20261101-app`. No workspace AGENTS.md. Local only, no public operation; remote/CI UNKNOWN; effective model UNVERIFIED. Current tested source is `ad13c2c0d6993dd8654382b0d5f56cd38c77a8db`; later handoff-only commit changes only this issue's artifacts. Exact final tip is on the issue/checkpoint. All9 correction commits have the current Paperclip-Run-Id trailer. Prior handoff sections, their commits, source hashes and adverse runtime evidence remain preserved.

## COMMIT-LEDGER and source authority

| Root / commit | Exact source/test scope | Current authoritative contract and correction |
| --- | --- | --- |
| REG-FE-02 `c89c43ecf78763a5f7d3192964990720a383e19c` | `apps/web/test/portfolio-purchased-fulfillment.test.mjs` | Separate fixture root: generic detail row was returned to ledger/returns endpoints. Real AccountSettlement requires invoices/deposits; ShipmentReturns requires returns. Fixture now supplies each actual shape, asserts subpanels render, and retains every original CRM permission loop. This is not the customer-asset sources.map product crash. |
| BUS-RETURN-DETAIL-001 / VIS-005 `0584153f717a1506de3cc3a8fa5ea701cab8bf8d` | `FulfillmentWorkspace.jsx`; purchased-fulfillment maintained test | `repair-return.mjs` produces `REPAIR_RETURN_SHIPMENT_V1`, `sourceKind=CUSTOMER_ASSET_RETURN`, real case/asset/serial and no sources/salesOrderId. Typed rendering uses those identities; generic stock source map is used only for stock shipments. Delivery confirmation remains. Inventory customer-return UI is omitted for property dispatch because delivery.mjs rejects that stock workflow for CUSTOMER_ASSET_RETURN. Accepted and unrepaired records render with sources absent. Ordinary work-order serial/genealogy links and invoice/payment/CRM checks remain. |
| REG-FE-01 `ed6062d6e673b1636b4d244102f9b53c49867e6b` | `portfolio-client.test.mjs` | Current client.mjs409 message requires history reconciliation before a new command, rather than an unconditional Refresh instruction. Test now requires that exact safety meaning and preserves retained-command scope/reconciliation messages. Existing real HTTP409, no bearer, expiry/denial and uncertain-write cases remain. Client/auth source was not edited. |
| REG-FE-03 / QA-NATIVE-PURCHASED-COPY-001 `2a05e2f885e9782657f15d0bb377a8dd7dfe55de` | purchased-fulfillment maintained/native tests | Current purchasedHint denies purchased use and directs to manufactured company dispatch; PurchasedFulfillmentUi explicitly gives that direction and excludes unsupported lines from LineSelect. Replace brittle capitalization/obsolete sentence with both denial and actionable direction, command rejection and absence of manufactured reserve option. Keep supported=false, UUID privacy, and all later reserve/ship/delivery/billing/recovery assertions. |
| REG-FE-04 `aee48d6099292966400d4fa8981e72f9509aea80` | `portfolio-repair.test.mjs` | Current API test-plan permits REWORK; test only permits TESTING; rework requires REWORK; QC requires TEST_PASSED and last result PASS. Retain original lifecycle case and explicitly assert no test/QC/start/execute after FAIL, rework offered, no QC before pass, test after rework and QC after pass. Also verify service orders precede Start repair. Production action list unchanged. |
| REG-FE-05 `c30f8aa5bdc2565e9ca0858316baae4c7d27dda3` | `portfolio-wave3e-documents.test.mjs` | PurchaseOrderAmendments now selects document kind by real cohort and issues each document revision only at ISSUED/CONFIRMED. A literal-kind regex was stale. Actual component render now checks no documents DRAFT/APPROVED, exact legacy/catalog kinds, source ID and revisions1/2 at issued boundaries. Original quote/invoice/shipment/document-panel/route cases remain. No procurement source edited. |
| BUS-REPORTING-UTC-001 `dfad68346c9fa8e7442b1ed327ad9d0d98609a32` | `AnalyticsWorkspace.jsx`, `operator.mjs`, client maintained test | UTC-labeled values are normalized to Z. Whole-minute offsets change the calendar/time while preserving the original fractional seconds beyond Date's millisecond precision. Observed `2026-11-01T14:13:19.303115+07:00` becomes `2026-11-01T07:13:19.303115Z`. Coverage/availability, published/read times and UTC history cells use it. Invalid/zone-less values do not masquerade as UTC. No backend/reporting/SQL edit. |
| QA-NATIVE-REPAIR-CONTRACT-001 `51be0645ec784edf39349c643f2653f10b9f0d1e` | `portfolio-repair-browser.mjs` | Native Create repair service orders precedes Start repair and rejected dispatch. Source repair.mjs records one version/audit/outbox/key per successful action: accepted version17→18, rejected6→7, aggregate23→25, with exactly two repair.orders events. Preserve deposit, failed test/rework, hold/QC, stale409/403, exact money/PDF and response-loss cases. Add explicit QC-before-pass409/no version change. Current native Dispatch customer asset supplies carrier/reference/packaging, then separate native Confirm customer receipt verifies delivered serial/custody. See detailed expectation inventory below. |
| QA-NATIVE-COMPANY-CONTRACT-001 `ad13c2c0d6993dd8654382b0d5f56cd38c77a8db` | `portfolio-company-stock-browser.mjs` | Actual V2 putaway sets MULTI_GENERATION_SOURCE; separately the existing API company-stock-use test explicitly models legacy LEAF_ONLY. Keep every original terminal assertion exact inside an independently labeled marker-owned historical fixture, restoring receipt/head/event proof in finally. Verify actual terminal409 and no durable effects. Restore current reusable output, verify V2 trace/ancestry and native next-generation plan/reserve/release by actual UUID. Pure duplicate-parent attribution and cycle guards are checked separately, with their proof boundary explicit. No source policy is broadly changed to accept all sources. |

Paths without a directory in this table are under `apps/web/src/features/portfolio/` for source and `apps/web/test/` for tests. Only3 source files and7 maintained/native test files changed; all other modifications are under `checkpoints/acceptance-fixes/app/`. `FILES.txt` is the full app-owned inventory; `evidence/corrective/assertion-semantic-inventory.json` gives the exact10-path current source/test delta and source SHA256 values. All read API/domain/registry/CSS/SQL/package files remain unmodified. E01 is byte-identical to base.

## Original/current semantic inventory

`corrective-contracts.mjs` checks all original maintained test names remain, forbids skip/only cases, verifies E01 unchanged and records every reconciled/added assertion expression. It does not automatically approve new expectations: source justification is above and the explicit native changes are below. Frozen/current source hashes of all read authorities are recorded in its output.

| File | Reconciled original assertion expressions | Added expressions | Meaning retained/strengthened |
| --- | ---: | ---: | --- |
| client maintained |1|5|History reconciliation replaces stale Refresh substring; expiry/denial/uncertainty and retained attempt safety remain; new UTC case |
| purchased maintained |1|14|Case-sensitive manufactured substring becomes denial plus direction plus command rejection; account permission matrix remains; typed returns and ordinary stock lineage render |
| repair maintained |1|8|test-plan may configure controlled requirements during REWORK; it cannot test, execute or QC before rework/pass; service-order prerequisite enforced |
| documents maintained |2|2|Two source-regex checks become nested behavioral loops covering both cohorts and all draft/issued statuses/revisions; all original cases remain |
| repair native |13|28|Only source-proven version/custody/tax metadata/title/event-count changes; original money, role/recovery, rework and PDF obligations retained; add native receipt and premature-QC denial |
| company native |0|27|All original assertion calls remain exact, including LEAF_ONLY/no-reuse/no-dispatch; independent current reusable case added |
| purchased native |1|3|Obsolete copy check replaced by line-scoped denial/direction and no reserve option; remaining journey unchanged |

The13 repaired native expectations are explicit in the machine-readable inventory:

- Accepted/rejected version5→6 after their new required order command; accepted stale/forbidden version15→16; accepted final17→18. Every corresponding native command/readiness version after order creation shifts by exactly one, not by a tolerance or hidden retry.
- Focused return button title `Return custody` becomes the actual current `Dispatch customer asset`, with the same keyboard/focus/visible-button obligations and required handling fields supplied through UI.
- Repair case custody is correctly `DISPATCHED_TO_CUSTOMER` / `DISPATCHED_UNREPAIRED_TO_CUSTOMER` after dispatch. Original returned-to-customer meaning is separately asserted on actual delivery receipt view after the visible Confirm customer receipt action; dispatch is not relabeled as receipt.
- Diagnostic line retains every original description/quantity/UOM/unitPrice/currency field and adds the actual diagnosticRepairSnapshot zero-tax net/tax/gross fields. Existing exact diagnostic and final invoice/payment/PDF values are unchanged.
- Audit/outbox/key count23→25 is exactly the two successful native order commands; an added assertion requires two `kind=repair.orders` events. Delivery confirmations use their own domain and do not increase repair case version. All original duplicate-effect checks remain.

Company terminal fixture boundary: public V2 issuance currently creates reusable output, so terminal behavior is tested as an explicitly historical, marker-owned fixture, using the same receipt/hash/head/event arrangement as the unchanged API test. It asserts an actual UUID ownedRun marker and owned namespace before altering fixture proof, never user/production data. Its three opening records restore in finally before positive native reuse. Terminal denial snapshots ensure no reservation/key/stock/head effect. Unique-parent and cycle checks call the actual production pure guards on copied persisted attribution/traversal evidence; they are not represented as native adversarial browser actions. The four unchanged manufactured-graph contract tests additionally cover shared upstream reuse, back-edge rejection, graph bounds, ancestry, unique parent/loss conservation and terminal/operator denial.

## Actual local checks and preserved failures

All commands ran from the assigned repository root on the named source plus owned uncommitted check/evidence scripts. The final handoff-only commit does not alter source/test bytes.

| Command/check | Actual result | Evidence under `evidence/corrective/` |
| --- | --- | --- |
| Baseline four reported maintained files | exit1;20cases,15PASS/5FAIL/0skip; reproduces REG-FE01..05 | `baseline.tap` |
| Each corrected root's maintained check | PASS; original adversarial cases retained | `reg-fe-01.tap`, `reg-fe-02.tap`, `return-detail.tap`, `purchased-contract.tap`, `reg-fe-04.tap`, `reg-fe-05.tap`, `utc.tap` |
| First new PO observer fixture | FAIL: omitted CommandAttemptState export; corrected fixture, not product | `reg-fe-05-initial.tap` |
| Four affected maintained files after correction | exit0;21PASS/0FAIL/0skip (original20 + UTC case) | `maintained-current.tap` |
| Final focused7 files, recorded resource lifecycle | exit0;52PASS/0FAIL/0skip | `final-recorded.tap`, `unit-resources.ndjson` |
| Earlier focused6-file selection | exit0;45PASS/0FAIL/0skip; overlaps final selection, not additional unique acceptance | `final-focused.tap` |
| Affected JSX compile |2PASS, esbuild transform; no generated output files | `compile.json` |
| Syntax | operator, repair/company/purchased native runners: node --check exit0 | final command record in `validation.json` |
| Exact ownership/assertion inventory | PASS; all original case names, company assertions, E01; explicit reconciled expressions | `assertion-semantic-inventory.json` |
| Continuation source/test diff/secrets | source/test git diff --check from frozen base PASS; exact allowlist and added-line/manual inspection PASS | `validation.json` |

Final recorded selection:

```powershell
$env:TPR166_UNIT_RESOURCE_LOG='<assigned evidence>/unit-resources.ndjson'
node --import ./checkpoints/acceptance-fixes/app/unit-resources.mjs --test --test-concurrency=1 apps/web/test/portfolio-client.test.mjs apps/web/test/portfolio-purchased-fulfillment.test.mjs apps/web/test/portfolio-repair.test.mjs apps/web/test/portfolio-wave3e-documents.test.mjs apps/web/test/portfolio-review-operator.test.mjs apps/web/test/portfolio-quote-catalog.test.mjs packages/contracts/src/domains/planning-execution/manufactured-graph.test.mjs
```

The resource preload only observes the short-lived HTTP fixture's actual listen/close lifecycle; it does not rewrite loader expectations, requests, responses or tested semantics. Native runners were syntax/source-reviewed only. No full240 frontend sweep, fullGUI, broad backend regression or native pipeline/engine work is claimed here.

The first evidence-commit attempt stopped at a whitespace check: eight whitespace-only lines occur inside the retained original baseline TAP failure diagnostics. They are preserved verbatim. Source/test whitespace checks pass; whole-artifact diff-check warnings for these raw failure bytes are not relabeled as a clean check. Earlier inherited raw-log warnings remain historical.

## Resources and cleanup

No Mongo, browser, Vite, database, profile, native engine or reserved32700–32719 listener was started. Platform's heavy-resource ownership was respected. No dependency install, dependency/cache mutation, host-service change, real provider send, user DB or public operation occurred.

The existing client maintained test necessarily creates a transient real loopback HTTP JSON server on an ephemeral port. Final instrumented receipt records PID24904, actual OS creation/command, port55171, and normal HTTP close. A subsequent OS check found neither that identity nor a listener. `cleanup.json` records this. The first immediate cleanup audit threw before recording its incomplete result; the subsequent read-only audit confirmed closure without stopping any process. Five earlier lightweight executions have exact command/exit evidence and the test's finally-close code, but lacked captured PID/port/OS creation; no historical receipts were invented. These are unit-fixture receipt limits, not a claim that no sockets were ever created.

No resource remains owned by this continuation. Prior run cleanup records remain named historical evidence only. The current checkpoint has immutable history under the existing issue UUID/agent path.

The shared MemPalace save was refused because another writer holds its lock. No retry or stop was attempted. The verified note remains in `corrective-memory-note.json` and the refusal in `evidence/corrective/memory-save.json`; this does not block the inspectable Git/Paperclip handoff.

## Remaining matrix and next owner

| Scope | Current disposition | Next owner/action |
| --- | --- | --- |
| Typed return detail / VIS-005 same root | implemented; rendered contract checks PASS | CTO freeze; QA/Designer open accepted and unrepaired detail on actual backend and relevant viewports |
| REG-FE01..05 | all original maintained cases retained and affected checks PASS | independent QA reruns maintained aggregate after freeze |
| UTC presentation | helper/compile PASS; source fraction/instant preserved | independent QA checks actual relational/reporting route and UTC history/read fields |
| Native repair/service orders/dispatch/receipt | source/contract reconciliation implemented; syntax PASS; native NOT_RUN | independent QA executes all original money/role/recovery/PDF cases and added service/POD/QC gates |
| Native company terminal/reusable/trace/guards | source reconciliation + pure guards PASS; native NOT_RUN | independent QA reviews explicit historical fixture restoration and executes native reuse/trace/denial and original readiness/permission cases |
| Native purchased | denial/action direction and all remaining steps retained; syntax PASS; native NOT_RUN | independent QA executes reserve/partial ship/returns/billing/privacy/recovery paths |
| Full55, WA/history, security, performance/native engines | no acceptance issued by this task | existing CTO graph and independent review gates remain authoritative |

No app implementation blocker remains. CTO integrates the clean committed app tip into the corrected stack; after all required predecessors and cleanup, freezes the next immutable candidate and assigns independent QA/Designer/Security. Do not reopen or modify the closed reviewer reports to clear old failures.
