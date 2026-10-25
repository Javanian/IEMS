# Verification

Status: local integration passed. Source closure is recorded below; exact-head remote CI requires publication of this checkpoint. No acceptance is borrowed from the parent checkpoint.

Six actual `npm ci --no-audit --no-fund` installations completed successfully for tenant-foundation, customer-service, document-rendering, portfolio-api, wa-demo-bridge and web. None of their node_modules directories is a junction. Complete logs and hashes are retained outside Git in the new run evidence root.

| Gate | Observed local result | Boundary |
| --- | --- | --- |
| Owner trace | PASS7/7, 41.148s, exit0 | One pure UTF-8 guard entry and mounted HTTP parent/five children; all-collection no-write assertions |
| Independent trace | PASS9/9, 135.830s, exit0 | Actual 32-execution acceptance/33 refusal, scoped history/corruption/QC proof; 45 source hashes unchanged; cleanup0mongod |
| Frontend1 | PASS179/179, 4.849s, exit0 | Seven new trace behavior tests; focused trace/mode12 also passed |
| Frontend2 | PASS182/182, 4.343s, exit0 | Three initial fresh-read observer regressions; this preceded the lifecycle-cancellation repair |
| Final frontend4 | PASS185/185, 4.260s, exit0 | Six observer regressions; focused trace/mode/observer18 also passed. Intermediate184 passed before independent review exposed an older-response fallback gap, which final4 closes |
| Harness follow-up frontend | PASS189/189, 5.087s, exit0 | Four additional quotation recovery regressions; final runner/helper syntax passed; production/API source unchanged |
| Transport follow-up frontend | PASS193/193, 4.618s, exit0 | Four actual lightweight HTTP/diagnostic tests, focused4/4; syntax passed. Matching explicit IPv4 origin/listener and bounded failure telemetry; production/API source unchanged |
| API syntax | PASS, exit0 | All maintained API source/test/script entry files |
| Maintained API | PASS285/285, 658.126s, exit0, no skips |44 maintained files/62 top-level entries; actual regression, cleanup0mongod.32 nonfatal Mongo reset diagnostic blocks are retained in the full raw log |
| Production web build1 | PASS, 21.531s command, exit0 |194 PWA entries; existing chunk/Browserslist warnings. Precedes the later label/spacing refinements |
| Focused native trace1 | FAIL, 97.156s command, exit1 | Helper read old matching consumer-version evidence before refresh loading, then dereferenced absent trace at the hold assertion; application exceptions0/console errors0. Full failure evidence retained |
| Final production build2 | PASS, 19.547s command, exit0 |194 PWA entries; final label/spacing refinements; unchanged existing warnings |
| Focused native2 | FAIL, 76.766s command, exit1 | The first fresh trace GET emitted canceled=true/ERR_ABORTED and the observer refused immediately; no trace screenshots or application exceptions/console errors. Initiator and successful replacement were not established by this attempt |
| Final focused native3 | PASS10 named checks, 121.344s command, exit0 | Browser exceptions0/console errors0;20 exact completed-response/DOM matches,9 retained canceled candidates,9 real phases,19 layouts/pixels reviewed by lead and B; desktop44px/kiosk48px, no overflow/contrast failure, cleanup0mongod. DiagnosticOnly=true/fullAcceptance=false |
| Full normal browser1 | PASS156 named checks, 471.750s command, exit0 | All20 flags enabled, all3 diagnostic modes0, customer service not skipped; current worktree UI explicitly selected; exceptions0/console errors0; cleanup0mongod |
| Full normal browser2 | PASS156 named checks, 519.891s command, exit0 | Same normal20 configuration; exact offline/online quotation request and root DOM proof; strict synchronous trace readiness,20 response matches/9 phases/19 layouts.171 source hashes unchanged; exceptions0/console errors0; cleanup0mongod. One nonfatal Mongo reset diagnostic block retained |
| Final full normal browser3 | PASS156 named checks, 487.109s command, exit0 | All20 journeys on explicit127.0.0.1 origin/listener; actualIPv4 address4173 recorded, no server error event, labeled normal close;173 source hashes unchanged.20 exact trace reads/19 layouts, no measured overflow/contrast failure; exceptions0/console errors0; cleanup0mongod. One nonfatal Mongo reset diagnostic block retained |
| Source closure/preservation | Required before commit | Final source/import audit and14 protected worktrees plus3 master sources are attested in external publication evidence |
| Initial remote CI on ca854ad | PR Portfolio attempt1 FAIL after6 browser checks | Trace API and frontend steps passed. Legacy quotation offline recovery timed out; no application exceptions/console errors. Full log and13 uploaded diagnostic files retained; artifact ZIP digest verified |
| Remote3226 push attempt1 | FAIL after130 browser checks | Blank page at legacy QC navigation; local eager font CSS ERR_CONNECTION_REFUSED; exceptions0/console errors0; quotation recovery passed.170 artifact files/log retained, ZIP digest verified |
| Remote3226 push attempt2 | FAIL after42 browser checks | Blank page at different legacy engineering navigation; local index.css ERR_CONNECTION_REFUSED; exceptions0/console errors0; quotation recovery passed.72 artifact files/log retained, ZIP digest verified. No further unchanged push rerun |
| Remote3226 PR attempt1 | FAIL before browser | Document-renderer Mongo startup exceeded10000ms;17/18 renderer tests passed; full log retained. Underlying slow-start cause unknown; one failed-job rerun kept source/assertions/timeouts unchanged |
| Remote3226 PR attempt2 | PASS, previous source | Full log verifies renderer18, frontend189, independent trace9, normal20 browser156/0exceptions/0console errors, module recovery4 and maintained API285, with390 hashes/687 imports.12 nonfatal Mongo reset diagnostic blocks retained. Overall3226 has11 successful checks and1 failed push; this does not attest the new transport source |
| Transport follow-up publication | Local gates PASS; new-head remote PENDING | Final frontend193/native156 accepted locally; new source requires ordinary push and exact-head CI. Final identity/run links belong in PR14 and external attestation |

Required local gates:

```powershell
node --test --test-concurrency=1 apps/portfolio-api/test/company-stock-trace.test.mjs
node --test --test-concurrency=1 checkpoints/company-stock-trace/qa/company-stock-trace.test.mjs
npm --prefix apps/portfolio-api run check
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
npm --prefix apps/web run test:portfolio:browser
npm --prefix apps/portfolio-api test
python checkpoints/review-five-findings/audit-publication.py
```

The native integration gate enables all twenty optional journeys in `.github/workflows/portfolio-vat.yml`, including COMPANY_STOCK_TRACE, and disables all three diagnostic-only modes. A focused company/trace diagnostic is useful during development but does not replace that full gate. Owner and independent fixtures are separately maintained; the native trace helper may reuse the independent fixture.

Raw failed attempts are retained with their actual disposition. A green local run, commit, push and exact-head remote CI are separate outcomes. Historical F5 capacity contention and the broader PostgreSQL/platform migration remain outside this increment.

## Initial remote browser failure

PR Portfolio run40195949138 failed on ca854ad at the legacy quotation offline-recovery wait, before the trace screen journey. Both offline and final screenshots show the outer quotation resource error. Two quotation GETs report ERR_INTERNET_DISCONNECTED, but the historical collector did not retain request IDs, timestamps or emulation boundaries; their exact ordering and a unique cause remain unknown.

Source review exposed an ambiguous readiness condition: the old wait accepts generic failure copy and the global retry locator can also match the nested customer lookup. The bounded follow-up binds the offline failure and online retry to actual quotation requests and the outer resource state. It must keep the existing conversion, quantity, snapshot, audit, outbox and exact-key assertions. It does not add business retries, change production request behavior or establish the cause of the historical failure.

Review also found that an async two-frame predicate passed through the existing Boolean-based wait is truthy before its Promise resolves. The initial trace helper had that pattern; its following synchronous selected-unit/consumer checks, exact response-versus-audit equality and serial assertions still executed. Screenshot measurement used a separately awaited frame barrier. The follow-up separately awaits the frame barrier and then waits on the synchronous full-result/no-loading/no-alert predicate. The quotation candidate received the same correction during review before native execution. No prior failure or proof boundary is relabelled by this repair.

## Repeated bootstrap refusal and transport control

Two unchanged3226 push attempts failed before the trace UI journey on different existing routes. Both retained blank documents, no application exceptions/console errors, and one refused local eager CSS import. They do not establish an inventory, QC or engineering authority defect. Old artifacts lack listener/address/request timing, so the historical transport/bootstrap cause remains unknown.

A separately preserved owned Node HTTP/DNS probe established a source-level risk: localhost bound only IPv6 on this host, forced IPv4 requests were refused, and explicit127.0.0.1 bind plus URL returned200. This proves address-family ambiguity is possible; it does not identify which address historical Chrome used. The follow-up controls the main runner's origin/listener explicitly, asserts the actual listening address/port, and adds bounded server/bootstrap request diagnostics with unauthenticated timeout-bounded failure probes. No assertion, business rule, origin allowlist strictness, request retry or production configuration is relaxed. The separate intentional-module runner retains its existing fixture origin and remains a distinct gate.

Final local browser3 records attach-before-listen, an actual IPv4 loopback listener and normal owned close, with no server error event. Its retained600 bootstrap resource records identify127.0.0.1;20421 earlier resource records were evicted under the explicit cap. This is bounded diagnostic evidence, not a complete address/timing history. No failure-only probe was needed on that successful run. The historical refusal cause remains unknown despite this successful controlled run.
