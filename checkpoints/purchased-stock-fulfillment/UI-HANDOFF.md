# Purchased stock fulfillment UI handoff

Implementation handoff, 2026-10-26. Source freeze4 follows frontend attempt8 and the bounded native-failure corrections recorded below. No browser, build or Mongo run was performed by Agent B; lead-owned focused runs have failed and are preserved. Final native acceptance remains pending and must not be inferred from pure checks.

## Design read

The operator is a planner or storekeeper fulfilling a catalog sales order from purchased stock. Existing Portfolio direction is retained: ENERGY1 / RHYTHM1 / MOTION1, the same canvas, ink, blue actions, typography, panels, controls and Audit disclosures. No assets, library, palette or global CSS changes were introduced. Quantities are shown as authoritative exact strings; there is no new client stock calculation policy.

The new list is `/portfolio/fulfillment/purchased-orders`. Detail is `/portfolio/fulfillment/orders/:id?catalog=1`. The latter branches to a separate component before any legacy commercial resource hook. Both new reads require actual `fulfillment.read` and `catalog.stock.read`; quote/master grants are not inferred. The existing legacy detail remains a separate component with its original source model.

## Scope and controls

- Purchased line cards show ordered, active reserved remainder, shipped, released, invoiced and remaining quantities. Unsupported manufactured lines stay readable and cannot be selected for the new actions.
- Stock selection uses the scoped, cursor-based catalog stock API and a separately checked receipt detail. Captured receipt and shared stock versions remain distinct from current evidence; replacing a stale capture requires an explicit choice. Actual eligible stock-unit UUIDs are option values, with the actual serial labels visible. Registry or raw receipt serial lists do not imply availability.
- New reservation, whole unshipped-remainder release and partial shipment commands retain the exact body and key. Sibling forms, source pickers, current-record refresh and history navigation lock while a command is retained. Retry does not rebuild the command. Explicit discard reads current evidence. Retention is within the mounted view; no cross-navigation/offline-storage persistence claim is made.
- Actual purchased shipments open the existing delivery view. Typed source links point to the purchased order or permitted catalog QC route, never a fabricated legacy reservation. Existing invoice/payment payloads remain unchanged. POD and payment retention now locks parent record refresh and document controls.
- Only purchased shipment/invoice details receive the new document permission checks. Actual issue requires `document.issue` plus `fulfillment.read`; download requires `document.read` plus `fulfillment.read`. There is no `document.prepare` action in the current provider. Other DocumentIssue callers keep default behavior.
- Final additive reserve/release history-cap blockers are shown with existing human blocker presentation. Actual readiness flags still control actions. Both source canAllocate and canReserve already honor the100-claim limit; no new client eligibility rule was added.
- After actual360px screenshots exposed clipped SERIAL suffixes, both reservation and shipment multiselects gained matching local option numbers and a nearby wrap-readable full-label list. Selected/not-selected states update onChange. Option UUID values and all command bodies are unchanged. This is a mapping aid, not a new identity or availability policy.
- Shared production-stock and QC summaries show customer shipped quantity only when supplied by the server. Physical legacy warehouse counters remain separate. Catalog identity alone is still not dispatch authority: this adapter additionally requires actual stock proof, current eligibility and grants.

Stable form labels: `Reserve purchased stock`, `Dispatch purchased shipment`, `Issue purchased shipment invoice`; existing `Confirm delivery` and `Allocate payment` are reused. Reservation release labels begin `Release unshipped remainder`. Source fields are `lineIndex`, `receiptId`, `quantity`, `unitIds`; dispatch rows use `reservationId0`, `quantity0`, `unitIds0` through the bounded row count. No manufactured/customer graph or legacy adoption control was added.

## Verification at this handoff

From `apps/web`:

```powershell
npm run test:portfolio
node --check test/portfolio-browser.mjs
node --check test/portfolio-purchased-fulfillment-browser.mjs
```

Frontend attempt1: 209/210, with one meaningful structural test rejecting CustomerName inside a paragraph. The wrapper was corrected to a div. Attempt2: 210/210. Attempts3/4: 211/211 after document permission and cap-blocker presentation. Attempts5/6: 212/212 with the decoded-browser-expression parser regression. Attempts7/8: 213/213 after the duplicate-human-hint regression; latest attempt8 has0 failures/skips,5.826 seconds. Strict UTF-8 decoding and Babel JSX parsing passed for eight affected components; main/new helper Node syntax also passes. External `frontend-agent-b-attempt{1..8}.log` files are preserved, alongside `native-expression-regression-before-fix.log`, which reproduces the actual line60/column95 selector fault before correction.

Lead-owned build-attempt1 exited0 in116.344 seconds with194 PWA entries and326 selected source files unchanged during that build. Build2 exited0 in42.047 seconds. Build3 also passed with327 selected web files unchanged and194 PWA entries. These precede the final human-hint dedupe; final build4 and focused native attempt3 are separate pending lead gates. These build reports are lead evidence, not B execution.

## Preserved runtime failures and corrections

Lead focused native attempt1 exited1 after65.484 seconds,6 checks (3 common startup plus3 supplemental),0 app exceptions and25 React console warnings. It produced12 feature screenshots before a decoded selector string failed Babel parseExpression at line60/column95. The embedded quote escaping was replaced with JSON serialization of the actual PAY selector. A pure AST walk now parses decoded static ready/checked expression literals before runtime; normal module syntax alone did not catch this embedded-language defect.

All25 warnings were read:23 duplicate unsupported-line hint keys and2 duplicate item-changed hint keys, with no other warning family. Overlapping line/reserve codes reached the local human-hint map twice. It now deduplicates actual output texts before assigning React keys, while retaining distinct reasons and raw diagnostics. No console-warning suppression was added.

Focused attempt2 also ran from its retained pre-dedupe source and exited1;813 selected hashes were unchanged and cleanup recorded0 mongod. Its PAY text predicate dereferenced a temporarily unmounted form during the normal resource reload after an accepted partial-payment retry. Helper-only readiness now waits synchronously for optional root/control presence and the exact expected text. The actual invoice outstanding0.06, final paid0.10/outstanding0.00, retained bodies, UUIDs, stock conservation and selected-business snapshot assertions remain strict. Similar transient-root waits were audited. Neither failed focused run is full or billing end-to-end acceptance.

The existing catalog-quote native assertion already excludes the exact legacy `Manage fulfillment` action. New purchased navigation has its own label and `catalog=1` route. Its existing manufactured-future explanation and legacy manufacturing prohibition remain. No prior journey assertion was removed.

## Native driver and proof boundary

`portfolio-purchased-fulfillment-browser.mjs` exports `purchasedFulfillmentJourney`. It imports the independent QA's disclosed actual-HTTP prerequisite fixture, then submits target reservation, release, shipment, POD, invoice and payment commands through trusted CDP mouse or complete Tab/Enter events. Form filling uses native DOM setters with input/change; UUID multiselect selection uses option selection plus change. This is not a claim of native procurement/QC setup or a third independent fixture.

The authored journey covers mixed-order unsupported lines, rejected and production-reserved serial exclusion, exact LOT partial dispatch, actual SERIAL UUID dispatch with its own committed response loss and accepted retained replay, held unshipped release, historical delivery/billing after withdrawal, reader-only detail/PDF/POD permission explanations, revoked replay, current stock conservation and immutable opening evidence. These describe the authored assertions; final completion remains pending. Selected business-collection snapshots do not claim all-database byte equality; independent QA owns broader snapshots. Explicitly commanded hold-cache and timestamp changes are verified against actual hold authority and excluded only for that held receipt from physical-opening comparison. The captured original request is preserved in a successful manifest; a second raw retry request is not independently captured by this helper.

Normal supplemental flag: `PORTFOLIO_PURCHASED_FULFILLMENT=1`. Fifth exclusive diagnostic: `PORTFOLIO_PURCHASED_FULFILLMENT_DIAGNOSTIC_ONLY=1`, result `purchased-fulfillment-debug-results.json`, `diagnosticOnly:true`, `fullAcceptance:false`, prior journey coverage absent. Full acceptance separately requires normal all22 flags with all five diagnostic flags0. No authored screenshot, assertion or static review is a runtime PASS.

## Remaining delivery gate

Lead owns build and actual focused/full native runs. Agent B must inspect all21 planned 360/768/1440 desktop and kiosk frames, including the additional actual SERIAL selection form, and record any concrete defects before claiming visual acceptance. Measurements retain unrounded contrast thresholds for painted text in the scrolled viewport, 44px desktop/48px kiosk HTML control boxes, visible focus, actual native keyboard submission, no viewport overflow and open Audit wrapping. Native multiselect measurements cover its outer control box, not individual option rows; physical touch hardware and kiosk installation are unverified. Manufactured dispatch, returns, cross-plant, general graph mutation, carrier verification, physical PDF catalog certification, capacity certification and F5 remain excluded.
