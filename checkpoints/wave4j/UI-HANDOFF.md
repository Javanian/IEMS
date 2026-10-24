# Wave4j UI implementation handoff

Scope: existing warehouse, manufacturing and fulfillment workspaces, their pure command builders, shared `MaterialTrace.jsx`, and dedicated command tests. No CSS, financial arithmetic, renderer, lockfile or runtime changes were made by this owner.

## Implemented behavior

- Receipt creation adds optional `lotNumber` and `heatNumber`, preserving exact identifier strings. Empty pairs omit both fields. Receipt detail and linked movement/reservation detail render stored material identity.
- Planning adds `serialized`, a select with `false` default and `true` opt-in. Legacy command bodies omit this field. The form explains the integral quantity and 1000-unit limit.
- The final serialized operation alone shows `outputSerials`; command builders omit it for earlier operations and quantity-only work orders. Empty arrays support zero good output.
- Serialized QC shows registered identities and accepts `acceptedSerials` and `rejectedSerials`. It displays the stored classification after saving.
- Work-order detail renders frozen released-material context and output context, and fetches current output-unit statuses from the scoped `/api/manufacturing/work-orders/:id/output-units` endpoint. Shipment links use persisted `shipmentId`.
- Shipment source selection loads ACCEPTED units from the selected serialized work order. The native multiple select is named `serials`; `FormData.getAll` captures every selected identity. Already shipped, rejected and quarantined units are excluded from that selection. Server commit-time checks remain authoritative.
- Shipment detail renders selected identities and server-derived material context. Context is explicitly described as work-order linkage, without claiming individual-unit installation genealogy.
- Shipment commands retain the exact body and selected serial array after an uncertain response. Form inputs and new submission are disabled until the identical request is retried or the command is discarded and records refreshed. Legacy invoice/payment forms share this existing command component.

## Stable browser selectors

| Operation | Selector or value |
| --- | --- |
| Receive | `lotNumber`, `heatNumber` text inputs |
| Plan | `serialized` select, value `true` |
| Final operation | `outputSerials` textarea |
| QC | `acceptedSerials`, `rejectedSerials` textareas |
| Ship | `sourceId` select followed by `serials` native multiple select |
| Release form | `form[aria-label="Release work order"]` |
| Record form | `form[aria-label="Record operation"]` |
| QC form | `form[aria-label="Record QC"]` |
| Shipment form | `form[aria-label="Record shipment"]` |

The parent-owned `portfolio-wave4j-lot-serial-browser.mjs` was inspected against these names and labels. Its selected-option dispatch matches the native multiple select. No selector mismatch was found; this source review does not prove runtime browser success.

## Verification performed

From `apps/web`:

```powershell
node --test test/portfolio-wave4j-lot-serial.test.mjs test/portfolio-warehouse.test.mjs test/portfolio-manufacturing.test.mjs test/portfolio-fulfillment.test.mjs
```

Result: **16 passed, 0 failed**. Six dedicated Wave4j tests cover exact lot/heat strings and absent metadata, opt-in/legacy planning, final-operation-only serial registration and zero good output, captured QC classification, immutable shipment retry selection and legacy/reservation omission, and actual serial conflict hints. Ten pre-existing warehouse/manufacturing/fulfillment helper tests also pass.

From the worktree root:

```powershell
git diff --check
```

Result: no whitespace errors at the time of review. This is a shared worktree; other owners continue their changes.

## Design and remaining acceptance

Antislop mode: `during`, inherited from the parent's verified global preference. Read: core, UI and human skills. Design read retained: operational IEMS portfolio editor for plant staff, existing portfolio visual language, ENERGY 1 / RHYTHM 1 / MOTION 1.

The existing form/list/panel structure serves receipt identity, QC classification and explicit shipment selection. Existing `pf-*` classes preserve typography, action color, focus treatment, spacing and control boundaries. No new palette, assets, decorative icons or motion were introduced. Native controls have visible labels; output-unit loading, errors and empty results use the existing resource states and explicit next steps.

Source review and targeted helper tests are complete. Full web tests, production build, connected browser interactions, screenshot inspection, responsive/zoom/keyboard checks and the rendered antislop delivery gate remain lead-owned. This handoff does not claim rendered UI acceptance, full E01, per-unit genealogy, POD, remote CI or production acceptance.

## Follow-up engineering browser diagnostic

The lead's second complete browser attempt timed out on the existing engineering reduced-viewport assertion after fonts were made readable in the worktree harness. This UI owner received the exclusive heavy-test token for two focused runs. No product CSS or component change was justified by the measured geometry.

The first diagnostic run, `attempt3focused`, completed **52 checks, 0 exceptions, 0 console errors**, exit 0. At 375x350, fonts were loaded and the reason input was 44px tall; after the original focus/scroll operation its rectangle was top 152.5px, bottom 196.5px. Because additional awaited diagnostic calls could change timing, this run alone was not treated as proof of the original failure's exact cause.

The engineering browser module now waits for `document.fonts.ready` and two animation frames after applying the 375x350 viewport, then focuses and scrolls once. The original full-visibility predicate, Tab target, visible outline, Enter action, 200-percent text and persisted-reload assertions remain. Atomic geometry is logged; on timeout a detailed viewport/focus snapshot and screenshot are captured before the original error is rethrown. No fixed sleep or relaxed assertion was added.

Final focused command, from `apps/web`, with other optional scenario flags unset:

```powershell
$env:PORTFOLIO_ENGINEERING='1'
$env:PORTFOLIO_EVIDENCE_DIR='D:/Project AI/GITHUB/IEMS-evidence/wave4j-20261024/attempt4focusedfinal'
node test/portfolio-browser.mjs
```

Final result: **52 checks, 0 exceptions, 0 console errors**, exit 0, including the baseline and always-run Wave4f scenarios. Final atomic geometry: fonts `loaded`, viewport 375x350, active input `reason`, rectangle top 152.5px/bottom 196.5px/height 44px. Full original keyboard and visibility assertions passed.

Evidence: `D:/Project AI/GITHUB/IEMS-evidence/wave4j-20261024/attempt4focusedfinal.log` and the sibling `attempt4focusedfinal/browser-results.json`. The harness's owned browser, web/API servers and marker-verified disposable Mongo database were cleaned up before returning the heavy-test token. The lead's complete all-flags rerun remains separate acceptance evidence.

Conclusion: the failed run did not record enough geometry to identify its precise event ordering. Current evidence supports making font/viewport layout readiness explicit in the test; it does not establish a persistent product clipping defect. The final focused pass proves the retained assertions against the revised harness, not the final all-flags result.
