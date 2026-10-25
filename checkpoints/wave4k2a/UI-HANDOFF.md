# K2a web implementation handoff

Author handoff snapshot. Final lead acceptance (74 frontend tests, production build,110 connected browser checks and representative screenshot review) is recorded in LEAD-ACCEPTANCE.md and STATUS.md.
Worktree: `manufacturing-serial-custody`, baseline `2b66c85`. Only the web lane was changed by this owner; API and browser harness changes visible in the shared checkout belong to their respective owners.

## Implemented behavior

- Planning adds explicit `serialCustodyRequired`. False/omitted preserves the prior command; true sends the flag alongside the independently selected serialized/genealogy prerequisites. Positive integral material ratios are supported, with the contract's 100-identity source limit enforced by the server.
- Receipt detail embeds `SerialCustodyReceipt`: actual mode, receipt version, quantity counter, separate claimable identity count, adoption blockers, source holds, per-identity state and immutable paginated events. UNTRACKED reads never manufacture AVAILABLE units from registry entries. Permanent adoption is an explicit reasoned action, separately permissioned from read.
- Required WOs embed a native incoming claim panel while PLANNED. Users choose an adopted receipt, read its current authority, and explicitly select UUID-valued AVAILABLE identities. Claims capture the read WO/receipt versions. No serial selection is prefilled. The source picker is locked while a request or uncertain retained command exists, so switching sources cannot silently replace its captured request.
- Explicit abandon binds `claimId` in the body and captures that claim's version. It remains available for CLAIMED metadata while PLANNED, including during a later source hold. RESERVED/CONSUMED claims are read-only and have no release/reuse action.
- Both manual and engineering release use the current claims-view WO version and serialize every active CLAIMED source/claim pair. The client does not silently drop extra claims to fit selected material rows; the server validates the complete material/ratio/UOM set. Legacy bodies omit `serialClaims` entirely.
- Released routing displays its frozen incoming claim and serial identities. The current claims read and event list expose RESERVED/CONSUMED progression. Installation remains explicitly UNRECORDED.
- New read/adopt/claim/abandon grants are distinct and fail closed when effective permissions are missing. Disabled action buttons have specific `aria-describedby` reasons. Captured command bodies and keys are retained for exact retry; discard refreshes the authoritative WO/receipt.
- Every own `serialCustody` marker, including null or malformed values, disables quantity-only receipt reservation and count controls. Whole receipt transfer requires an actual valid custody read with all units AVAILABLE, the full unencumbered quantity and no source holds. Missing read permission, loading/error, invalid mode or unavailable units never enable transfer. Backend guards remain authoritative for concurrent changes and additional invariant checks.

## Stable selectors

| Control | Selector |
| --- | --- |
| Plan | `serialCustodyRequired` select: false default / true |
| Read receipt | `#receipt-serial-custody[data-receipt-version]` |
| Adopt | `form[aria-label="Adopt incoming serial custody"]`, `reason` |
| Read WO | `#work-order-serial-custody[data-work-order-version]` |
| Source choice | `#work-order-serial-custody select[name="receiptId"]` |
| Claim | `form[aria-label="Claim incoming serial identities"]`, native multiple `serialUnitIds`, `reason` |
| Abandon | `form[aria-label="Abandon planned serial claim"]`, `claimId`, `reason` |
| Retry | `Retry same custody command` |
| Discard | `Discard custody command and refresh` |

The source select sits immediately above the claim form. That form appears after its selected receipt's actual read completes and includes a hidden source ID bound to that read. Use the section/global source picker first, then the scoped claim form. Available serial options carry server UUID values and `data-status="AVAILABLE"`.

Existing manual release labels and `code0`, `instruction0`, `receiptId0`, `quantityPerUnit0` remain. The server rejects fractional, missing, extra or wrong-count bindings. Existing engineering package fields are unchanged; the new top-level mapping does not alter approved package content.

## Verification performed

From `apps/web`:

```powershell
node --test test/portfolio-wave4k2a-serial-custody.test.mjs test/portfolio-manufacturing.test.mjs test/portfolio-wave4c-engineering.test.mjs test/portfolio-warehouse.test.mjs
```

Result: **18 passed, 0 failed**. Nine new custody tests cover opt-in compatibility, adoption authority, captured UUID/version selection, body-bound abandon, both release paths and complete claim mapping, any-present-marker behavior, fail-closed transfer conditions, separate grants and event pagination. Nine prior manufacturing/engineering/warehouse tests also pass.

Babel parsed all five changed JSX workspace files: SerialCustody, Warehouse, Manufacturing, Engineering and WMS. `git diff --check` was clean at handoff. No database job, browser, production build or heavyweight test was run by this owner.

## Design and acceptance

Antislop during uses the previously verified global preference. Operational IEMS portfolio language is retained at ENERGY 1 / RHYTHM 1 / MOTION 1. Existing field/panel/list classes, action colors, focus treatment and responsive structure are reused. No CSS, palette, asset, icon or motion changes were introduced in this lane.

The lead owns full web/build and connected-browser acceptance, including the eleventh scenario switch. Read-only/source and helper verification do not prove native visual/keyboard behavior or transactional correctness. K2b installation, manufactured-child custody, unique parents/cycles, removal/reuse, POD, full E01, remote CI and production remain outside this handoff.
