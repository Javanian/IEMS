# Wave4j API and UI handoff

Worktree: `D:/Project AI/GITHUB/IEMS-worktrees/manufacturing-lot-serial`, branch `feat/manufacturing-lot-serial`, baseline `8324b02`. PR4 remains open; prerequisite fixes in this branch are listed in PR4-CORRECTIVE.md.

## Wire contract

All endpoints retain the existing authenticated tenant/plant scope, `{data}` response envelope and durable idempotency behavior. Receipts and planned work orders return 201; record/QC commands return 200; shipments return 201. Versions and keys retain their existing requirements.

| Endpoint | Added input | Added persisted response |
| --- | --- | --- |
| POST `/api/warehouse/receipts` | optional paired `lotNumber`, `heatNumber` | the same immutable identifiers |
| POST `/api/manufacturing/work-orders` | optional boolean `serialized` | `workOrders[].serialized: true` only when opted in |
| POST `/api/manufacturing/work-orders/:id/record` | final serialized operation requires `outputSerials: string[]` | `output.serials`, `output.materialTrace` |
| POST `/api/manufacturing/work-orders/:id/qc` | serialized `acceptedSerials`, `rejectedSerials` | same arrays in `qc` |
| GET `/api/manufacturing/work-orders/:id/output-units` | none | `{data: unit[]}` with current serial status and shipment identity |
| POST `/api/fulfillment/shipments` | serialized WORK_ORDER `sources[].serials` | selected source serials and server-derived material trace |

Output-unit statuses are QUARANTINED, ACCEPTED, REJECTED and SHIPPED. Warehouse receipt serials and manufactured output serials share one tenant/plant uniqueness registry. Identifiers follow the existing serial rule `^[A-Za-z0-9_-]{1,100}$`; arrays are bounded to 1000. Lot/heat follows the separate rule in CONTRACT.md.

Routing `materials[].materialTrace`, receipt reservations and stock movements carry `{receiptId, lotNumber, heatNumber}`. Output and WORK_ORDER shipment source contexts carry arrays of these objects. RESERVATION shipment context is a single receipt trace object. Trace is server-derived; input overrides fail field validation. Nonserialized traced output also retains material context. These references establish the WO's source receipts, not component installation per output unit.

400 codes include INVALID_MATERIAL_TRACE, INVALID_SERIALIZED and INVALID_SERIALS. 409 codes include SERIAL_CONFLICT, SERIAL_QUANTITY_CONFLICT, SERIAL_SOURCE_CONFLICT and SERIAL_STATE_CONFLICT, alongside existing version, state, hold and conservation errors. Same-key replays reauthorize before returning the stored response.

## Connected verification

The existing connected browser harness gains `PORTFOLIO_LOT_SERIAL=1`, additive to its eight earlier switches. It exercises traced receipt/putaway, native 6/4 planning, release/record/QC, ten distinct output identities, selected serial shipments, independent Mongo assertions, reconciliation and four viewport widths. It also exercises the corrected quoteEditor known-account form using a real restricted membership. The workflow uses the Wave4j source manifest and enables the new switch.

Owner API attempt 2 passed 9/9; attempt 1 exposed a fault-injection fixture collection setup problem and remains preserved. UI owner targeted tests passed 16/16. Lead maintained API passed 186/186, frontend 57/57, independently authored HTTP probes 5/5, and web production build passed. Final connected browser passed 94 checks with zero exceptions and zero console errors. Commands, failure dispositions, source audit and practical limits are recorded in LEAD-ACCEPTANCE.md.

Use cached MongoDB 7.0.14 with marked disposable owned databases only. Heavy execution is sequential. Evidence is external at `D:/Project AI/GITHUB/IEMS-evidence/wave4j-20261024/`. Dependency junctions reuse the CRM worktree's installed modules; package files and lockfiles are unchanged.
