# UI implementation handoff

## Design read

This increment serves commercial operators choosing an actual approved item before preparing quotation terms. It retains the existing PF operations workspace: left-aligned content, stacked panels, responsive `pf-fields`, and separated `pf-actions`. The existing palette is canvas `#F4F6FA`, surface `#FFFFFF`, ink `#0F172A`, muted body `#475569`, and action `#1D4ED8`. These are existing tokens, not new local colors. Plus Jakarta Sans remains the operator typeface; Fira Code remains for existing technical evidence. Dials are ENERGY 1, RHYTHM 1, MOTION 1. No new assets or animation are needed.

The distinct task hierarchy is item kind, approved catalog item and captured revision, followed by quantity and price. A selected revision and its latest eligibility are separate facts. Search and pagination must preserve the selected binding; current-source refresh must never silently rebind it. Explicit catalog quotations are a separate creation flow. Existing unbound and inquiry-sourced quotations retain their existing contracts.

## Implementation

The existing quotation list links to `quotes/new?catalog=1`. This explicit choice uses `CATALOG_QUOTE_V1`; normal quote creation and inquiry-derived forms retain their earlier payloads. Every typed line uses an actual approved option from `/api/commercial/catalog-items`, an explicit manufactured/purchased kind, and its captured version/revision. UOM comes from that option; commercial description remains operator wording. Search has real cursor navigation and hydration, with obsolete responses suppressed by the existing latest-request loader. Search does not silently replace a selected revision.

Typed create, revision, approval, acceptance and conversion retain the complete captured body and key. An unresolved command disables its inputs, sibling forms, document buttons and the parent Refresh action. An explicit retry sends that body; discard reads current evidence. Permission denial disables mutation controls without granting master access. Historical binding is visible with `quote.read`; current master links require `master.read`.

The typed SO omits the legacy fulfillment launcher and warehouse exception panel. The legacy work-order planning page links typed orders to their commercial record and hides its plan form on a typed deep link. `CATALOG_ORDER_UNSUPPORTED` explains the later item-aware fulfillment workflow instead of proposing a refresh that cannot enable it. Backend guards remain authoritative.

Owned production files are `CommercialWorkspace.jsx`, `QuoteCatalogUi.jsx`, `quote-catalog.mjs`, the bounded manufacturing plan presentation, and the single operator failure mapping. Existing `commercial.mjs` was read but unchanged. No global CSS, asset, root router or portfolio route file changed.

## Native helper contract

Flag: `PORTFOLIO_QUOTE_CATALOG=1`, export `quoteCatalogJourney` in `apps/web/test/portfolio-quote-catalog-browser.mjs`. It is supplemental to normal prior coverage; existing diagnostic entries retain their diagnostic classification. Root owns final all-21 execution.

Focused diagnosis uses `PORTFOLIO_QUOTE_CATALOG_DIAGNOSTIC_ONLY=1`. It is mutually exclusive with the prior three diagnostic entries, runs only this new journey, retains five-user foundation seeding, and writes `quote-catalog-debug-results.json` with `fullAcceptance:false` and prior coverage absent. Normal acceptance requires all four diagnostic flags set to zero. The focused result must not be reported as normal all-21 coverage.

Form labels: `Save catalog quote`, `Save catalog quotation revision`, `Approve catalog quotation`, `Record catalog quotation acceptance`, `Create catalog sales order`. Picker controls are `itemKind0`, `catalogSearch0`, `catalogItem0`, repeated by line index. Financial fields retain `description0`, `quantity0`, `unitPrice0`, `currency0`. Retry is `Retry same quotation command`; discard is `Discard quotation command and refresh`.

Readiness attributes: `#catalog-quote` has `data-quote-version` and `data-quote-revision`; each immutable revision has `data-catalog-quote-revision`; bindings expose their identity through `data-catalog-binding` without printing UUIDs in primary content. `#catalog-sales-order` has `data-order-id`.

The authored helper shares independent QA's actual HTTP prerequisite factory, explicitly disclosed as shared setup. It creates no target quote through HTTP. Target create/revise/approve/accept/convert, retry/discard, pagination, source refresh, links and kiosk actions use trusted native mouse/keyboard submission. Form values use native DOM setters and input/change events. Actual HTTP prerequisite creation and direct DB fault injection for role revocation are not described as native operator actions or third independent coverage.

Frozen entitlement shows the actual item code, description, kind, revision and UOM. UUIDs, authority fences and hashes belong in permission-scoped Audit details. A binding does not imply available inventory, engineering release or dispatch permission. Typed sales orders show that fulfillment remains pending the later stock-allocation contract.

## Verification status

Initial implementation verification passed 201/201 before the separately authorized quote-only diagnostic mode. Final lane verification passed 202/202, zero failed/skipped, in 5.474 seconds; the external log is `$PORTFOLIO_EVIDENCE_DIR/frontend-attempt2.log`. Three edited JSX files parse, runner/helper syntax checks pass, and 53 final authored browser-expression templates parse. Seven focused catalog helper tests cover explicit authority, exact strings, legacy retrofit refusal, stale selection, retained commands and meaningful recovery; two run-plan tests preserve honest supplemental and isolated diagnostic coverage. Existing commercial tests remain unchanged.

At the initial handoff, browser and build execution were pending. After the final pure run, only authored native interaction coverage was extended: adding/removing a temporary third line preserves both existing lines; root refresh awaits its actual read; the master-definition link reaches its mounted destination. Final helper syntax and expression-template checks passed after those additions. Production sources did not change after the final pure run.

## Observed focused proof

The lead's first focused native run passed 8 grouped checks in 41.375 seconds with zero application exceptions and console errors. This includes three startup/authentication checks, one disclosed HTTP-prerequisite group and four native behavior groups. Its result explicitly records `diagnosticOnly:true`, `fullAcceptance:false`, and prior normal coverage absent. Evidence: `$PORTFOLIO_EVIDENCE_DIR/quote-native-attempt1.log` and `quote-native-attempt1/quote-catalog-debug-results.json`; detailed measurements are in `quote-catalog-native-manifest.json` in the same directory. This is not an all-21 normal regression result.

Build attempt 1 passed in 21.110 seconds with 194 PWA entries. The lead also reported the renderer gate passing 18 tests. These remain distinct from the focused browser proof and the pending normal run.

Agent B independently viewed all twelve feature PNGs: `quote-catalog-{captured-source-form,approved-identity,sales-order,sales-order-kiosk}-{360,768,1440}.png`. No blocking visual defect was found in these frames. All twelve measurements report zero page overflow and zero sampled text-contrast failures; actual minimum control heights are 44px on desktop mode and 48px in kiosk mode. Audit UUIDs, company IDs and full hashes wrap inside their disclosures. The native select truncates its long option description at 360px; the complete selected code, captured revision, tracking policy and UOM remain printed below. Screens are deliberately scrolled to the source or binding, so they do not establish a full-page header review.

Actual interaction coverage includes search, next/first page, empty and offline recovery, selected-source refresh, explicit current-revision selection, add/remove, real source-refusal discard, root refresh, master navigation, approval Tab/Enter, acceptance, conversion, both exact retries, Audit disclosures, SO navigation and kiosk toggle. Form values and select choices use DOM native setters with input/change events; command submissions, links, disclosures and buttons use trusted CDP mouse/keyboard events. This is not a claim that every select was operated through its operating-system popup.

All ten owned source hashes still match `ui-source-freeze-initial.json` after this review. Only handoff/review/report prose changed. The lead's normal all-21 run and any exact-head remote acceptance remain pending.
