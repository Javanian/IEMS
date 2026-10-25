# Agent B — company stock UI and connected journey

Baseline: `f4cf6fd`. Production UI, pure tests and browser-helper source are frozen for lead verification. This report records the focused diagnostic result; it does not declare full nineteen-journey acceptance. No commit, push, Mongo/browser execution or build was performed by this lane during this reporting task.

## Owned implementation

- `apps/web/src/features/portfolio/CompanyStockUi.jsx`: independently permitted company-stock detail, current source picker, actual unit selection, stock/producer evidence, hold/release and history.
- `apps/web/src/features/portfolio/company-stock.mjs`: typed reservation/attribution builders, strict current-detail identity and version checks, explicit unit validation and operator recovery text.
- `InternalProductionWorkspace.jsx` and `internal-planning.mjs`: unchecked `INTERNAL_PLAN_V2` planning opt-in; no schema field for the existing V1 path.
- `InternalExecutionWorkspace.jsx`: separate catalog/company reservation sources, same-job consumed identities for attribution/loss, additional company permissions and retained-command locks.
- `PortfolioWorkspace.jsx`: bounded company-stock detail route, independently gated by `company.stock.read`.
- `apps/web/test/portfolio-company-stock.test.mjs`: ten pure behavior tests.
- `apps/web/test/portfolio-company-stock-browser.mjs`: `companyStockJourney`, using the unchanged C-owned actual-HTTP prerequisite helper.

The lane did not change backend authorities, dependencies/locks, root router, shared runner, existing browser journeys or global CSS. Existing PF panels, English copy, native controls, scoped Audit disclosures, desktop 44px and kiosk 48px rules remain. The planning checkbox has an explicit 48px target. Company receipt/unit versions and UUIDs bind commands; visible serials and friendly references identify records. No identity is selected automatically.

The scope is one generation of component use. A V1 purchased-input producer supplies actual accepted company units to a V2 mixed-source job. Its descendant output remains physical terminal stock with zero reuse/dispatch entitlement. General installation graphs, recursive reuse, replacement, valuation/accounting, customer dispatch and F5 are outside this implementation.

## Source verification

From `apps/web`:

```text
node --test test/portfolio-company-stock.test.mjs
npm run test:portfolio
node --check test/portfolio-company-stock-browser.mjs
```

The dedicated tests passed **10/10**. Pre-correction broad frontend run passed **172/172**, with zero failures, skips or cancellations, in **3.956 seconds**; evidence `$PORTFOLIO_EVIDENCE_DIR/frontend-attempt3.log`. Four changed/new JSX modules parsed with `@babel/parser`. The new browser helper passed Node syntax checking; ten literal evaluation expressions and twenty-two interpolated expression skeletons parsed. The helper also parses each actual dynamic expression before evaluation.

Lead-controlled production build attempt 1 passed in **37.42 seconds**, generating PWA 194 entries. The final UI write preceded that build, including the producer QC evidence copy. This is a lead-run build result, separate from this lane's pure/syntax checks.

## Focused actual connected result

External evidence: `$PORTFOLIO_EVIDENCE_DIR/browser-company-focused-attempt1/`. Independently read `company-stock-debug-results.json`, `company-stock-native-manifest.json` and `exit.json`: **7 diagnostic checks**, **0 browser exceptions**, **0 console errors**, **exit 0**, and **0 mongod after cleanup**. The results explicitly state `diagnosticOnly:true`, `fullAcceptance:false`, prior 137-journey coverage `ABSENT`, and no prior optional journeys run. Full nineteen-journey verification remains a separate lead gate.

Prerequisite purchased LOT/SERIAL receipts, masters/location, incoming QC and a V1 producer were created through actual mounted HTTP APIs. That producer recorded actual work, accepted two/rejected one output units, and put away real company stock. These prerequisite actions are HTTP setup, not a native click-through claim. No database writes fabricate happy-path receipts, reservations, consumption or output.

All new mutation submissions use trusted CDP mouse press/release or native Tab/Enter including the carriage-return character. Text/select values use native React setters with input/change events. **Multiselect choices use DOM `option.selected` plus a change event**; this is not proof of native pointer selection, barcode scanning or a physical device.

The focused journey proves:

- Native V2 planning, engineering approval, job creation and explicit company-unit reservation. A committed response loss retains the exact body/key/source versions, locks source pickers and sibling commands, and retries once without duplicate domain effects.
- Actual company hold blocks release; authorized abandonment of an unissued reservation still works under the hold. Hold release permits explicit reservation again. A direct purchased LOT quantity joins the company units in the mixed job.
- Actual release/issue and successive operation records consume selected company identities once. Good 1/scrap 1 reconcile through explicit typed output attribution and process loss, exhaustive QC, and whole accepted putaway into one terminal output.
- Independent producer conservation checks preserve immutable opening evidence and actual raw physical counters; only the explicitly allowed monotonic technical use fence may advance. Actual consumed ancestry excludes abandoned raw reservations. Customer financial records are unchanged.
- A company-stock-only Holder opens the standalone deep link and performs an authorized hold without internal-execution read. Membership revocation then denies the retained exact-key retry and direct acknowledged replay without domain effects. Reader hard reload preserves evidence and a disabled-action explanation. The role fault injection is a controlled database membership change, restored in `finally`; it is distinct from happy-path setup.

## Independent visual review

Read the actual PNGs in the focused directory at **360, 768 and 1440px** for all four sets: `company-stock-manufactured-unit-selection-*`, `company-stock-typed-output-attribution-*`, `company-stock-terminal-output-*` and `company-stock-terminal-output-kiosk-*`.

The captured form labels, quantities, serial options, stock counters, terminal restriction and ancestry links remain readable. Fields reflow at 360px; no clipping or page overflow was observed in the viewed frames. The helper's geometry checks provide the separate 44px/48px and overflow measurements; screenshots alone do not establish focus order or all off-screen content.

Two concrete presentation findings were sent to lead without changing frozen source:

1. Producer-job and company-stock sibling links touch without a gap at 768/1440px, for example `company-stock-manufactured-unit-selection-768.png` and `company-stock-terminal-output-kiosk-1440.png`. At 360px they wrap separately. Recommended bounded correction: existing `pf-actions` wrapper around those links, without global CSS or behavior changes.
2. Purchased-source attribution says `Eligible 0 KG` after consumption. That is current source eligibility, while the form attributes this job's already-consumed stock. Recommended clarification: show actual consumed quantity for this job from matching consumed reservations, as the company-source legend already does. No invented stock availability or authority change is needed.

No functional blocker was observed in these screenshots. These captures precede the bounded corrections recorded below. This review does not cover unrecorded screen-reader output, physical kiosk hardware or production deployment.

## Freeze

Only this report was written during the initial post-focus review. Lead subsequently reported local full nineteen-journey attempt 1 **153 checks, zero exceptions/console errors, exit 0, zero mongod**. That result is before the two presentation corrections below; it is not final-source acceptance.

## Authorized post-run presentation correction

After the full run completed, lead authorized only two changes. `CompanyStockUi.jsx` now places the independently permitted producer/company receipt links in the existing `pf-actions` wrapper. `InternalExecutionWorkspace.jsx` keeps the purchased receipt reference and actual lot/heat in the attribution/loss legend, but labels it **Consumed source for this job** with its unit of measure. The eligible-stock picker remains unchanged. No arithmetic, quantity policy, payload, handler, permission, API or browser assertion changed.

Latest broad frontend result: **172/172 passed**, zero failures/skips/cancellations, **5.784 seconds**, `$PORTFOLIO_EVIDENCE_DIR/frontend-attempt4.log`. All four owned/touched JSX modules parsed again and the unchanged native helper passed `node --check`. Source was frozen immediately after these bounded changes. No build, Mongo or browser job was started by this lane.

## Final focused verification after presentation correction

Lead-controlled build attempt 2 passed in **31.06 seconds**, with **194 PWA entries**. Lead also reported the maintained API suite **278/278 passed**. These are separate from the frontend pure suite.

Independently read the final focused evidence in `$PORTFOLIO_EVIDENCE_DIR/browser-company-focused-attempt2/`: **7 diagnostic checks, zero exceptions, zero console errors, exit 0, zero mongod after cleanup**. The result still explicitly states `diagnosticOnly:true`, `fullAcceptance:false`, and prior 137-journey coverage `ABSENT`. The prerequisite HTTP setup, DOM-change multiselect and trusted native mutation-submission boundaries described above remain unchanged.

Independently viewed **all twelve final PNGs**, covering the same four sets at360/768/1440. Both presentation findings are closed in those captures: producer/company receipt links have visible spacing at768/1440, including `company-stock-manufactured-unit-selection-768.png` and `company-stock-terminal-output-kiosk-1440.png`; purchased attribution/loss shows **Consumed source for this job** with receipt/lot/heat/UOM in `company-stock-typed-output-attribution-1440.png`, and wraps readably at360/768. The terminal and kiosk frames retain readable physical-versus-eligible quantities and restriction text. No new clipping or blocking visual issue was observed in the captured frames. This remains screenshot review rather than physical kiosk or screen-reader proof.

Production and browser-helper source remain frozen. Only this report and UI handoff were updated for the final evidence. The local normal **153-check run predates the markup correction**; final focused verification and build do not substitute for the separate **exact-head remote normal nineteen-journey regression**, which remains pending at this report freeze.
