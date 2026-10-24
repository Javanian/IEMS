# K2b1 web implementation handoff

Author handoff, 2026-10-24. Worktree `manufacturing-serial-installation`, baseline `f2d6f4a`. This is the web lane handoff; lead API, production build and connected browser acceptance remain separate evidence.

## Implemented behavior

- Planning sends `installationRequired` only after an explicit opt-in. Its serialized, genealogy and incoming custody prerequisites are explained alongside the native select; the server validates them. Existing cohorts retain their previous command shape.
- Required work orders embed a separate received component installation section. Its actual read shows WO/head/graph versions, current K1 binding, consumed source balances, missing parent/source requirements, source holds, immutable revisions/events, and component dispositions. Inventory remains CONSUMED; installation disposition does not imply inventory availability.
- Operators explicitly select a real output parent and unassigned consumed incoming UUIDs. Record and process-loss commands are add-only, carry each selected component's current version, and never infer quantities or distribute identities. Process loss has no output parent.
- Removal selects an active edge and captures both edge and component versions. Its warning explains permanent REMOVED_QUARANTINE, incomplete parent/finalization/shipment, and the absence of replacement, reuse or restock authority.
- Separate read, record, finalize and remove capabilities fail closed. Disabled actions explain permission/domain blockers. Retained uncertain commands lock the entire form, including parent/identity pickers, and retry the captured body and key exactly. Discard refreshes authoritative evidence. Success refreshes the installation view and parent WO.
- Finalization uses current WO/head versions and the server's reconciliation result. FROZEN evidence removes editing forms and shows the frozen revision/hash and first shipment. Shipment detail links its installation pointer back to the WO section and displays the content hash.
- Existing custody copy now scopes its evidence to incoming custody and directs required cohorts to their separate installation view. Legacy cohorts retain explicit UNRECORDED wording; received identities are never treated as manufactured children.

## Stable controls

| Control | Selector or field |
| --- | --- |
| Plan opt-in | `select[name="installationRequired"]`, false by default |
| Current read | `#component-installation[data-work-order-version][data-installation-version][data-graph-version]` |
| Section heading | `Received component installation` |
| Record | `form[aria-label="Record received component installation"]`: `outputUnitId`, native multiple `serialUnitIds`, `reason` |
| Process loss | `form[aria-label="Record received component process loss"]`: native multiple `lossSerialUnitIds`, `reason` |
| Remove | `form[aria-label="Remove installed received component"]`: `edgeId`, `reason` |
| Finalize | `form[aria-label="Finalize received component installation"]`: `reason` |
| Retained retry | `Retry same installation command` |
| Discard | `Discard installation command and refresh` |
| Immutable revision | `Inspect installation revision N` |

Identity option values are server UUIDs. No identity is preselected. Every mutation form's accessible name also matches its primary button text. Finalization reason is immediately before its button in keyboard order. Successful reads expose numeric version attributes; browser readiness should use the expected value rather than section existence alone.

## Verification performed

From `apps/web`:

```text
node --test test/portfolio-wave4k2b1-installation.test.mjs test/portfolio-wave4k2a-serial-custody.test.mjs test/portfolio-wave4k-genealogy.test.mjs test/portfolio-manufacturing.test.mjs
```

Result: 31 passed, 0 failed (9 installation tests plus 22 prior helper tests). Coverage includes legacy opt-in omission, captured identity and edge versions, absent implicit identity selection, loss parent omission, permanent removal body, finalization authority, separate permissions, pagination and recovery hints. Babel parsing passed for InstallationWorkspace, ManufacturingWorkspace, SerialCustodyWorkspace and FulfillmentWorkspace. `git diff --check` passed.

No heavy API/DB/browser/build execution was performed by this lane. The lead-authored browser journey was reviewed read-only against these controls: the zero-good plan correctly reads `workOrders[0]`, UUID selectors match the forms, and command helpers take `expectedUnitVersion` from the current consumed component read. Connected behavior, keyboard execution and responsive screenshots require lead runtime acceptance.

No CSS, palette, typography, asset or motion changes were introduced. Source evidence tables reuse the accepted genealogy overflow region and table styles. Web source is frozen at this handoff for lead verification; any later fix must be recorded with its own validation.

## Bounded scope

Only same-WO received consumed identities are supported. Manufactured child custody, general ancestry/cycle acceptance, replacement, rework and return-to-stock remain outside K2b1. These helper tests and source review do not establish production readiness or complete canonical E01 coverage.
