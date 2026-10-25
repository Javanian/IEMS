# Company unit trace UI handoff

Base `9ad677a`. Frontend and browser sources are frozen for lead runtime verification. The initial handoff below preceded connected execution. The final section records the retained failed focused attempt, its helper correction, three authorized presentation fixes and renewed pure/syntax evidence. Final connected acceptance remains pending.

## Design Read

Extend the existing English PF manufacturing/storekeeper workflow. Keep ENERGY 1, RHYTHM 2 and MOTION 1, established palette/type/panels, scoped Audit disclosures, native controls and reduced-motion behavior. No new asset, library or global CSS is introduced. Existing desktop44px and kiosk48px controls remain required at360/768/1440. This is an evidence-reading workflow, not an interactive graph editor or automatic recall operation.

The receipt detail now offers explicit selection of an actual company-unit UUID using its serial as the label. Nothing is loaded or selected by inference. A loaded trace binds the receipt and unit together; switching units removes the previous result. Loading, offline, denied and malformed/incomplete states never display a retained result as current. Refresh is explicit. Trace selectors and refresh share the receipt's retained-command lock.

Exact selected-output purchased allocations and manufactured-component ancestry are separate from the conservative consumed producer-batch hold set. Current restriction reasons remain visible in plain English. Downstream reserved, issued, consumed-unattributed, affected output, process-loss and abandoned history categories stay distinct. Output QC/storage status does not create dispatch or recall eligibility. V2 remains terminal; K2B2-05/06 graph mutation and arbitrary-depth reuse remain outside this increment.

`company.stock.read` gates trace entry even when an internal-execution Reader can otherwise inspect a V1 company receipt. Standalone company Reader needs no execution/catalog grant. Job links require `internal.execution.read`; purchased receipt links require `catalog.qc.read`. Friendly references remain visible when a link is not permitted. IDs, hashes and optimistic versions remain in company-stock Audit details. The existing batch-union heading now says **Consumed producer-batch purchased receipts (hold scope)** rather than implying exact selected-unit ancestry.

## Source ownership and controls

- `apps/web/src/features/portfolio/CompanyStockTraceUi.jsx`: explicit reader, exact ancestry/current restriction/downstream sections, permissions and read states.
- `company-stock-trace.mjs`: encoded bound path, complete render-shape/identity checks, use categories and fail-closed source/limit recovery copy.
- `CompanyStockUi.jsx`: trace embedding, existing receipt-link permission guard and honest batch-scope heading.
- `apps/web/test/portfolio-company-stock-trace.test.mjs`: seven pure behavior tests.
- `portfolio-company-stock-trace-browser.mjs`: `companyStockTraceJourney` using C's unchanged staged actual-HTTP fixture.
- `portfolio-review-mode.mjs` and its tests: explicit twentieth flag `PORTFOLIO_COMPANY_STOCK_TRACE=1`; default historical flags stay unchanged.
- `portfolio-browser.mjs`: bounded trace import/call and subscriber plumbing; failure stdout now retains `networkFailures` in addition to the existing artifact, without hiding errors or retrying business actions.
- `apps/web/test/company-trace-readiness.mjs` and `portfolio-company-trace-readiness.test.mjs`: exact-request completion/body observation and three fresh-read regressions.

Stable controls: form **Trace an actual manufactured unit**, select `traceUnitId`, button **Load manufactured unit trace**, button **Refresh manufactured unit trace**. Root `#company-unit-trace`; verified result `[data-trace-unit-id][data-trace-complete="true"][data-trace-stock-version]`; use sections `[data-trace-use-group="reserved|issued|consumedUnattributed|outputs|losses|abandoned"]`. Exact-source and downstream scroll headings are `#company-trace-exact-purchased` and `#company-trace-downstream`. Full scoped Audit JSON carries `data-company-unit-trace` for exact evidence readiness; primary user copy does not expose it.

## Completed verification

From `apps/web`:

```text
node --test test/portfolio-company-stock-trace.test.mjs test/portfolio-review-mode.test.mjs
npm run test:portfolio
node --check test/portfolio-company-stock-trace-browser.mjs
node --check test/portfolio-browser.mjs
node --check src/features/portfolio/company-stock-trace.mjs
```

At the initial handoff, focused pure checks passed **12/12**, zero failures/skips/cancellations,156.7ms. Full frontend passed **179/179**, zero failures/skips/cancellations,4.849 seconds. Initial external logs are `company-stock-trace-20261025/frontend-focused-attempt1.log` and `frontend-attempt1.log`. Both touched/new JSX modules parsed with `@babel/parser`; helper/runner Node syntax passed. Every dynamic browser expression is parsed before its evaluation. These are pure/syntax results, not browser acceptance.

## Connected proof plan and Delivery Gate

Lead-owned focused entry from `apps/web` uses:

```text
PORTFOLIO_REVIEW_DEBUG_ONLY=0
PORTFOLIO_TEXT_DIAGNOSTIC_ONLY=0
PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY=1
PORTFOLIO_COMPANY_STOCK_TRACE=1
npm run test:portfolio:browser
```

On PowerShell these are environment assignments before the actual script command. The existing company-only diagnostic runs the company-use prerequisite journey and explicitly selected trace journey; its results remain diagnosticOnly, fullAcceptance false and prior137 coverage absent. Final normal verification requires all diagnostic flags0 and all twenty optional flags enabled. No mock fetch, fabricated response body or manual success marker is used.

C's `traceFixture` creates actual HTTP business states. Those producer/consumer mutations are setup, not native mutation coverage for this read-only increment. Actual native mouse clicks and Tab/Enter including the carriage-return event perform trace selection/refresh. Select values use the React native setter and change events. Native checks are authored for each staged use state, exact received-serial subset versus batch hold set, output versus process-loss identity, accepted/rejected/storage evidence, controlled actual loading response pause, offline recovery, historical read under actual company hold, Reader-only hard reload and revoked read403. Before/after trace actions compare all durable collections, including authentication/fence records. Role faults change only the owned membership and restore it in finally; setup has no happy-path DB mutation.

The authored screenshots scroll actual upstream, downstream, affected-output, process-loss and terminal-exact sections into view. Desktop/kiosk captures cover360/768/1440; explicit output/loss captures include360/1440. Computed rendered-text contrast uses unrounded ratios (4.5 normal,3 large), and visible control geometry keeps44/48px thresholds. These checks and screenshots remain pending actual runtime execution. Lead must inspect final pixels and record Delivery Gate results; layout code or pure tests do not establish visual acceptance, screen-reader usability, hardware, production performance or deployment readiness.

Source frozen after the checks above. No build, Mongo, Vite or browser job was started by this lane. Lead controls build, focused connected runtime and final normal twenty-journey regression. F5 and current PostgreSQL/production migration limitations remain unchanged.

## Retained focused failure and renewed freeze

Lead's focused native attempt1 failed after97.156 seconds at the direct-hold read assertion, with zero browser exceptions/console errors and zero mongod after cleanup. The original refresh readiness accepted an old matching unit/consumer version before the reload effect cleared the prior Audit node. The subsequent read saw null. This was a helper freshness defect; no product or backend failure was established by that result. Raw evidence and the partially captured frames remain in `$PORTFOLIO_EVIDENCE_DIR/focused-native-attempt1/` and its external log. They are not final screenshot acceptance.

All successful native trace selections/refreshes now subscribe before the action to the exact GET URL/method, capture that requestId, wait for its `Network.loadingFinished`, and read its actual200 body with `Network.getResponseBody`. Two animation frames then allow rendering to settle; the complete, nonloading, nonerror DOM Audit must equal that captured data. Existing unit/consumer version checks remain, and held-source refresh explicitly checks the new stock version. This also covers same-state/offline recovery, controlled response-pause continuation and hard-reload selection. No arbitrary sleep, request repeat, fixture response or relaxed business assertion was added. Per-read requestIDs/versions and exact-response matches are retained in the native manifest. Observer cleanup is bounded; CDP replies without event params are ignored. Three pure regressions cover unrelated/old responses, actual matching body completion, failed/denied reads and bounded absence of a new request.

Lead's inspection of actual attempt1 frames authorized three presentation corrections in `CompanyStockTraceUi.jsx`: released reservation history now says **Abandoned**, rather than borrowing the work-order label Ready to start; the trace panel uses existing `pf-form` grid spacing between load/refresh content; options show the actual serial alone, with current state left to the verified trace below. This avoids a stale receipt-option Available label contradicting current Consumed evidence. No API, business state, payload or authority changed. Native assertions retain exact serial binding and explicitly check the abandoned context label.

Renewed focused pure checks passed **15/15**, zero failures/skips/cancellations,153.6ms. Full frontend passed **182/182**, zero failures/skips/cancellations,4.343 seconds. Logs: `$PORTFOLIO_EVIDENCE_DIR/frontend-focused-attempt2.log` and `frontend-attempt2.log`, where the current external root is `next-development-20261025`. Both JSX modules parsed again; native helper, request observer and runner Node syntax passed. Production UI/helper and browser sources are frozen after those checks. This lane ran no heavy job. Lead build2, focused native attempt2 and final normal twenty-journey regression are separate pending gates.

### Second retained native failure: canceled mount read

Lead focused native attempt2 failed after76.766 seconds on the first selected trace GET, before trace screenshots, with zero JS exceptions/console errors and cleanup0mongod. Its matching request was canceled with `net::ERR_ABORTED` and `canceled:true`. The actual portfolio root uses StrictMode and the resource effect aborts its request on cleanup. Those facts support an effect-lifecycle explanation; the raw artifact does not establish the exact cancellation initiator or show a replacement completing before teardown. No backend or production UI fix follows from this evidence.

The helper now tracks every fresh matching GET requestId rather than assuming the first is the final mounted read. Only the exact true-canceled `net::ERR_ABORTED` case can remain pending a real replacement. All known matching candidates must settle, and an actual completed200 body must still match the settled DOM and retained version assertions. A replacement may start before the old abort event. Abort without replacement still times out;403/409 and other network failures fail immediately and cannot be hidden by a later cancellation or success. The observer dispatches no request or retry. Aborted/completed attempt records are retained in the native manifest.

The five observer regressions cover replacement ordering, bounded abort without replacement, false-cancel/other transport errors, denial followed by abort/replacement, unrelated requests, params-less CDP replies and actual body completion. Renewed focused pure checks passed17/17 in179.0ms; full frontend passed184/184 in4.351 seconds, zero failures/skips/cancellations. External logs: `$PORTFOLIO_EVIDENCE_DIR/frontend-focused-attempt3.log` and `frontend-attempt3.log`. Observer/native helper syntax passed. Production UI remains identical to build2; only test observer/helper/regression source changed. Source and docs are frozen. Focused native attempt3 and final normal twenty-journey verification remain lead-controlled pending gates.

The final independent observer review additionally caught an earlier-completed/newer-aborted fallback. Completion now requires the **newest started** matching request to complete successfully; an earlier body cannot substitute for the canceled latest read. A sixth observer regression proves bounded refusal without a replacement and acceptance only after a real newest200 response. Known403/409 remain immediate failures even if followed by cancellation or another successful candidate. Aborted attempts remain in the manifest; no native action is repeated.

Delivery Gate click-through coverage was extended using actual native input: open and close one Audit disclosure, follow an exact purchased receipt to its mounted inspection view and actual lot, follow an affected output's production-job link to the actual job version, and follow the resulting stock link to the mounted terminal receipt before the existing upstream assertions. These are authored checks, not runtime PASS claims. Repeated row prototypes are not clicked merely to inflate coverage. Production source remains unchanged from build2.

Final helper-source freeze: focused18/18 passed in211.5ms and full frontend185/185 passed in4.260 seconds, zero failures/skips/cancellations. External logs are `frontend-focused-attempt4.log` and `frontend-attempt4.log`; Node syntax passed. No subsequent source change was planned. Connected focused3 and final normal twenty-journey acceptance remain pending; only documentation may be reconciled while lead runs them.
