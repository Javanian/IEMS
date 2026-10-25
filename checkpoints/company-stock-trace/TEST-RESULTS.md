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
| API syntax | PASS, exit0 | All maintained API source/test/script entry files |
| Maintained API | PASS285/285, 658.126s, exit0, no skips |44 maintained files/62 top-level entries; actual regression, cleanup0mongod.32 nonfatal Mongo reset diagnostic blocks are retained in the full raw log |
| Production web build1 | PASS, 21.531s command, exit0 |194 PWA entries; existing chunk/Browserslist warnings. Precedes the later label/spacing refinements |
| Focused native trace1 | FAIL, 97.156s command, exit1 | Helper read old matching consumer-version evidence before refresh loading, then dereferenced absent trace at the hold assertion; application exceptions0/console errors0. Full failure evidence retained |
| Final production build2 | PASS, 19.547s command, exit0 |194 PWA entries; final label/spacing refinements; unchanged existing warnings |
| Focused native2 | FAIL, 76.766s command, exit1 | The first fresh trace GET emitted canceled=true/ERR_ABORTED and the observer refused immediately; no trace screenshots or application exceptions/console errors. Initiator and successful replacement were not established by this attempt |
| Final focused native3 | PASS10 named checks, 121.344s command, exit0 | Browser exceptions0/console errors0;20 exact completed-response/DOM matches,9 retained canceled candidates,9 real phases,19 layouts/pixels reviewed by lead and B; desktop44px/kiosk48px, no overflow/contrast failure, cleanup0mongod. DiagnosticOnly=true/fullAcceptance=false |
| Full normal browser | PASS156 named checks, 471.750s command, exit0 | All20 flags enabled, all3 diagnostic modes0, customer service not skipped; current worktree UI explicitly selected; exceptions0/console errors0; cleanup0mongod |
| Source closure/preservation | Required before commit | Final source/import audit and14 protected worktrees plus3 master sources are attested in external publication evidence |
| Exact-head remote CI | PENDING PUBLICATION | Requires new commit and push |

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
