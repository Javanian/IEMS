# K2b2a web implementation handoff

Author snapshot, 2026-10-25. Worktree `manufacturing-internal-planning`, baseline `cfb1b98`. This handoff records the web lane and lightweight checks. Lead API/build/browser acceptance remains separate.

## Scope and integration

`InventoryMasterWorkspace.jsx` mounts item and company-location lists/details under `/portfolio/inventory-master/items` and `/portfolio/inventory-master/locations`, including `/:id`. `InternalProductionWorkspace.jsx` mounts list, `/new` and `/:id` under `/portfolio/manufacturing/internal-production`. `PortfolioWorkspace.jsx` owns these route imports/mounts. Manufacturing's existing local navigation links to internal production, inventory items and company locations; customer SO planning and engineering retain their existing meaning.

The new pages reuse existing pf panels, fields, focus states, native controls and wrapping. No CSS, palette, typography, assets or motion were changed. Design direction remains the accepted calm operational workspace, ENERGY 1 / RHYTHM 1 / MOTION 1.

## Behavior

- Items support native creation, complete content revisions, exact-current revision approval and terminal deactivation. Immutable code is never sent with a later content revision. Current DRAFT content cannot use an older approval. Source choices require current APPROVED evidence with matching revision/hash and no live blockers.
- Company locations select actual UUID-valued warehouse bin references, start DRAFT, require separate qualification and support terminal deactivation. Owner is never an editable field. Raw-bin selection additionally requires the existing `warehouse.read` capability; the UI explains that prerequisite instead of expanding new master grants. Qualification is planning authority, without an available-stock figure.
- Internal plans explicitly choose a current approved MANUFACTURED item revision, qualified location and integral quantity 1..100. Helpers capture item/location versions and item revision from those reads. Purpose, schema and owner remain server-derived; no SO, account, origin override or stock payload is sent.
- Order detail shows frozen item/location snapshots, current engineering demand/hash/approval, live blocker codes and planning readiness. Execution remains explicitly NOT_IMPLEMENTED/canExecute false. There are no execution, QC, stock receipt, reserve/issue or manufactured-installation controls.
- Internal engineering revisions require complete explicit routing and item requirement rows. Helpers derive item revision/version/UOM from current approved reads; quantities remain exact strings. Server-derived stable line IDs, ITEM_REQUIREMENT source kind, exact required quantities and source hashes are shown after save. Approval/revocation capture the current order version and engineering revision; approval leaves the order PLANNED. Cancellation is terminal and has no stock reversal fields.
- Paginated immutable item/engineering revision details and authority events retain content hashes, reasons, actors/timestamps and snapshots. Old history is distinguished from current eligible authority. Current master changes can block an old order without rewriting its snapshots.
- `PlanningControls.jsx` applies separate effective capabilities. Missing permissions fail closed; 403 also disables retained retry. A captured uncertain body/key locks all form fields, source selectors, row-count controls and sibling mutation forms. Refresh/history pickers are disabled while that detail has a retained command. Retry sends the same captured object; discard clears it and refreshes authoritative evidence. No missing source is replaced with a caller-supplied version or fabricated default.

## Stable native controls

| Form accessible name | Fields |
| --- | --- |
| Create inventory item | `code`, `description`, `uom`, `kind`, `reason` |
| Save inventory item revision | `description`, `uom`, `kind`, `reason` |
| Approve inventory item revision | `reason` |
| Deactivate inventory item | `reason` |
| Create company location | `code`, `binId`, `reason` |
| Qualify company location | `reason` |
| Deactivate company location | `reason` |
| Plan internal production | `itemId`, `locationId`, `quantity`, `reason` |
| Save internal engineering revision | `code0`, `instruction0`, `materialItemId0`, `quantityPerUnit0`, `reason`; additional rows use consecutive indices |
| Approve internal engineering demand | `reason` |
| Revoke internal engineering demand | `reason` |
| Cancel internal production | `reason` |

All form names match their primary button labels. Reason is the last input before the primary button in keyboard order. Source pickers are native selects with server UUID option values and no preselected source. Item/code constraints use canonical uppercase code syntax, maximum 40; UOM uses uppercase letters/numbers/underscore, maximum 16. Inputs do not silently normalize lowercase.

Readiness roots are `#inventory-item[data-item-version]`, `#company-location[data-location-version]` and `#internal-production[data-order-version][data-engineering-revision]`. The internal-production root contains its full detail, mutation forms and history, so layout checks can cover editable controls. Retained controls are `Retry same planning command` and `Discard planning command and refresh`. Successful creation navigates to its detail. Later mutation/discard refreshes the actual resource.

## Verification

From `apps/web`:

```text
node --test test/portfolio-wave4k2b2a-internal-planning.test.mjs test/portfolio-wave4k2b1-installation.test.mjs test/portfolio-manufacturing.test.mjs
```

Result: **27 passed, 0 failed** (13 new planning helper checks, 9 installation and 5 manufacturing). Tests cover current-only approvals, incomplete/blocked source reads, exact captured source/head/revision versions, omitted ownership/SO/execution/stock authority, terminal lifecycle payloads, source-derived engineering UOM, separate capabilities, encoded pagination and recovery hints.

Babel parsing passed for PlanningControls, InventoryMasterWorkspace, InternalProductionWorkspace, PortfolioWorkspace and ManufacturingWorkspace. All four new native input patterns compile with the browser's Unicode `v` mode. `git diff --check` passed.

Read-only review of the lead's new connected browser module found consistent selectors, detail navigation, live version readiness, R1/R2 material revision flow and native approval structure. Runtime keyboard, uncertain acknowledgement, hard reload, responsive layout, master races, negative stock/customer snapshots and full previous browser regression remain lead acceptance work. No heavy API/DB/browser/build job was run by this lane.

## Source freeze and limits

Web source is frozen at this handoff for lead full frontend/build/browser verification. This is implemented planning UI with lightweight evidence, not a completed runtime design delivery gate. No claim is made for production readiness, available internal stock, valuation, execution, manufactured-child custody or full canonical E01 acceptance. Later fixes require their own recorded validation.
