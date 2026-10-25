# Wave4k K1 UI and browser author handoff

This is the author's historical handoff. Final lead acceptance, including the post-correction104-check browser run and screenshot review, is recorded in LEAD-ACCEPTANCE.md and STATUS.md.

Baseline: `4b9eab0`, dedicated `manufacturing-lot-genealogy` worktree. Contract: `checkpoints/wave4k/CONTRACT.md`.

## Implemented UI

- Planning adds the explicit `genealogyRequired` select and sends the boolean only when opted in. Existing serialized/quantity command bodies remain unchanged when omitted or false. The UI explains the serialized prerequisite, 100-unit and 20-traced-source limits; the server enforces them.
- Work-order detail embeds `GenealogyWorkspace` under `#lot-genealogy`, headed `Per-unit lot genealogy`. Non-required records show UNRECORDED without invented backfill.
- Required records use the actual current-view envelope: versions/status, frozen pointer, consumed source identities and balances, stored allocations/losses, incomplete requirements and current later holds.
- A native output-unit selector and material quantity fields replace only that selected unit's allocation scope. Blank quantities clear its relevant sources. New quantities start blank; only previously recorded allocations are prefilled. Frozen source receipt IDs and UOMs come from the read view. There is no automatic equal allocation.
- A separate process-loss form replaces the complete loss set, with explicit source quantities and individual loss reasons. Blank fields clear corresponding losses. Nothing fills an unexplained remainder automatically.
- Finalization observes both the server's `canFinalize` and the distinct finalize permission. Later holds leave historical attribution available but visibly block finalization. The first shipment's FROZEN view removes every mutation form, including corrections to unshipped units.
- Read/record/finalize grants are checked separately and fail closed if effective permissions are unavailable. Disabled mutation buttons have an `aria-describedby` reason. Captured bodies retain exact input quantities, both versions and the command key after an uncertain response; retry reuses them unchanged.
- Separate paginated revision metadata/detail and current reverse receipt lookup render real read responses. Page text explains that UUID ordering does not imply chronology.
- Shipment detail displays only its server-derived genealogy revision/hash and a link to the owning WO. No renderer, financial, stock or API code was changed by this owner.

The reviewed hold-link issue was corrected: the action opens the mounted receipt page where the hold panel supports review/release. Active hold IDs remain visible as text. No nonexistent hold-detail route remains in this component.

## Stable native selectors

| Action | Form / fields |
| --- | --- |
| Plan opt-in | `genealogyRequired` select, `false` default / `true` |
| Per-unit attribution | `form[aria-label="Save unit lot attribution"]`, `outputUnitId`, `materialQuantity0..N`, `reason` |
| Process loss | `form[aria-label="Save process losses"]`, `lossQuantity0..N`, `lossReason0..N`, `reason` |
| Finalize | `form[aria-label="Finalize lot genealogy"]`, `reason` |
| Retry | `Retry same genealogy command` |
| Discard | `Discard genealogy command and refresh` |
| Reverse receipt read | `traceReceiptId` |

Quantity field indexes follow the actual `view.sources` order. The reason textarea is scoped to its form.

## Light verification performed

From `apps/web`:

```powershell
node --test test/portfolio-wave4k-genealogy.test.mjs test/portfolio-wave4j-lot-serial.test.mjs test/portfolio-manufacturing.test.mjs
```

**19 passed, 0 failed**: eight new genealogy tests plus eleven retained manufacturing/Wave4j tests. Coverage includes legacy opt-in omission, captured versions, exact decimal strings, source-owned IDs/UOMs, blank clearing without invented ratios, explicit losses and per-source reasons, finalize payload authority, separate grants, pagination encoding and conflict hints.

Babel parsed five changed JSX/browser entry files and their static embedded CDP expressions; the new browser module imported successfully without launching services. `checked()` and `ready()` also parse every actual dynamic expression before CDP evaluation. The existing locked `@babel/parser` package is used; no dependency or lockfile changes were made. `git diff --check` was clean at author handoff.

## Connected browser journey and lead follow-up

New module: `apps/web/test/portfolio-wave4k-genealogy-browser.mjs`. Additive harness switch: `PORTFOLIO_GENEALOGY=1`, after the previous nine optional switches. Existing owned Mongo/API/Vite/Chrome lifecycle and cleanup are preserved.

Authored proof covers native 6/4 planning and ten explicit per-output assignments using the canonical fixture's five actual lot/heat and ratio/UOM definitions. Commercial/source receipt/release/consumption/QC setup uses real authenticated APIs. It does not claim the complete E01 sequence or its monetary/date/routing parity.

The first native attribution withholds a real committed response, checks Mongo before releasing the failure, and compares the full business effects including attribution ledger after the identical UI retry. A later actual source hold is visible on the consumed WO, its corrected review link opens the real receipt hold panel, native historical attribution remains possible, and actual release restores native finalization. The journey inspects retained revisions and paginated effective reverse lookup, checks manufacturingRead versus genealogyReader grants and revoked replay, and restores the exact original owner membership in `finally` before continuing.

Native dispatches are deliberately 1/5/4: the first partial dispatch freezes the whole six-unit WO, rejects a correction to a still-ACCEPTED remaining unit, and subsequent dispatch preserves the same immutable revision/hash. Shipment/unit/SHIP movement pointers are independently checked. Original source stock counters and MATERIAL_CONSUMED records must stay unchanged.

A separate supplemental zero-good case enters positive native process-loss quantities, explicitly clears and reassigns them, finalizes the reconciled loss budget, preserves old loss revisions and creates no fabricated units or additional consumption.

Editable COMPLETE forms and the final FROZEN section are both measured at 1440/768/375/360. Each target is scrolled into view after fonts/layout readiness before screenshots. Page overflow and controls below 44px are asserted without relaxed thresholds. The initial handoff contained authored assertions only. The lead subsequently ran the complete ten-switch browser journey: `browser-attempt2/browser-results.json` and the sibling log under `D:/Project AI/GITHUB/IEMS-evidence/wave4k-20261024` record 104 checks, zero exceptions and zero console errors. This UI owner read those results during the follow-up review.

Visual review of that run found a material usability issue despite its successful overflow assertions: the mobile reconciliation table compressed source identifiers into a narrow first column. The lead corrected the source table to a contained horizontal scroll region, with a 60rem minimum table width, 40-percent source column, visible horizontal-scroll instruction, keyboard-focusable labelled region and scoped focus indicator. The browser now checks actual contained overflow, source-cell width at least 288px, visible focused outline and real ArrowRight horizontal scrolling before the narrow frozen-state screenshots. The original page-overflow and 44px control checks remain.

This UI owner performed a read-only source sanity review of that correction. The minimum width preserves readable source identity; the existing max-width/overflow container keeps the page bounded; focus and an explicit region label make the scroll area available by keyboard. No contradictory selector or containment logic was found. The post-correction complete browser rerun and screenshot acceptance remain lead-owned and must be reported separately from attempt2.

## Design and acceptance limits

Antislop `during` inherits the parent's verified global preference. Retained design read: operational IEMS portfolio forms for plant staff, existing portfolio language, ENERGY 1 / RHYTHM 1 / MOTION 1. Existing fields, panels, lists, table overflow containment, focus treatment, action colors and spacing are reused. Stored allocation details collapse to keep the bounded maximum of 2000 allocation rows from hiding the editing task. This owner initially added no CSS; the lead's later scoped table-width/source-column/focus correction described above is part of the final candidate. No new palette, icons, assets or motion were added.

Full frontend suite, production build, maintained API checks, connected browser execution, screenshot review and final rendered delivery gate remain lead-owned. No K2 installation/custody/cycle, POD, full E01, remote CI or production acceptance is claimed.
