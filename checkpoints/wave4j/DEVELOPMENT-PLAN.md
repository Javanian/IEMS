# Development plan after Wave4j

Updated 2026-10-24. This plan accompanies the local Wave4j checkpoint on `feat/manufacturing-lot-serial`, based on `8324b02`. Wave4j is implemented and locally accepted; every Wave4k/l/m item below is planned, not implemented. BACKLOG.csv is the execution order and dependency list. No production, broker or external integration work is implied.

## Current evidence and source contracts

- Wave4j: 186 maintained API tests, 57 frontend tests, five independently authored HTTP probes and 94 complete browser checks passed. Build passed. LEAD-ACCEPTANCE.md records commands, failures, warnings and limitations. The previous source manifest and 11 external evidence files were hash-checked again before preparing this checkpoint; application source matched the accepted snapshot.
- `apps/portfolio-api/src/manufacturing.mjs`: release freezes receipt reservations; the first operation consumes all released material; the final operation creates output units; QC partitions identities. `materialTrace` is only WO-level context.
- `apps/portfolio-api/src/warehouse.mjs`: received serials have a shared unique registry, but quantity reservations do not allocate individual incoming serials. Registry membership does not prove an unencumbered component is available for installation.
- `apps/portfolio-api/src/fulfillment.mjs`: accepted output identities are atomically marked SHIPPED with their shipment. The immutable shipment record proves operator-recorded dispatch, not delivery.
- Canonical reference: `packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js` and its existing tests. It contains five BOM materials, exact lot/heat identities, ten outputs, WO6/4, two PODs and fixture financial totals. Current portfolio tests do not establish complete parity with this fixture. Static package contracts are design references, not proof that their entities are mounted runtime endpoints.

## Wave4k: explicit component genealogy

Split this wave so that lot attribution can be reviewed without silently inventing serialized inventory availability.

### K1: allocate consumed lots to output units

Proposed contract, to freeze in a dedicated Wave4k CONTRACT.md before implementation:

1. Opt in at planning with an explicit genealogy requirement; existing Wave4j WOs retain their accepted behavior. Do not retroactively block old shipping commands or alter issued snapshots. Existing incomplete records show UNRECORDED, never fabricated COMPLETE.
2. After final output exists and before shipment, an operator records per-output material allocations. Each allocation references a stable output-unit ID, released routing material/receipt, exact quantity and its exact UOM. The server derives tenant, plant, work order, source movement and lot/heat. Caller labels are not source authority.
3. Treat the operation as attribution of material already consumed. Do not decrement receipt stock, duplicate MATERIAL_CONSUMED, or reserve the same quantity again. Use a separate attribution ledger and balance document per WO/receipt, fenced in the same transaction as allocations.
4. Across every output, rejected unit and explicit process-loss/scrap disposition, attributed quantity must not exceed actual consumed quantity. Finalization requires exact reconciliation for each source AND each output's released material/BOM ratios. Global balance alone is insufficient: assigning every bearing to one unit must fail even if the WO total balances. Canonical E01 requires quantities 1/1/1/2/1 in the respective UN/SET UOMs for each output. Exceptions require an explicitly reviewed deviation disposition and cannot silently qualify as canonical parity. Unexplained remainder prevents COMPLETE. Zero-good output requires explicit loss attribution rather than invented component links. No automatic equal distribution or undocumented UOM conversion.
5. Use expected WO/genealogy versions, durable scoped idempotency and committing authorization guards before fresh effects and replay. Keep append-only revisions/corrections with actor, time and reason. Effective balances count only the current unsuperseded allocations; superseding a revision releases/reassigns its permitted budget atomically, never twice. Reassignment is limited to unshipped, unfrozen allocations. Opted-in shipments store immutable genealogy revision pointers; a later amendment to shipped evidence does not release its allocated budget or rewrite the shipment. Reopening shipped allocation budgets needs a separate controlled correction workflow, outside K1. Test correction-versus-finalize and correction-versus-ship races.
6. Proposed surface: scoped WO genealogy read, allocation mutation and finalize mutation under `/api/manufacturing/work-orders/:id/genealogy`; exact payloads and error codes remain a contract task. Reads include status and reconciliation, and reverse lot lookup is paginated and scoped. Separate read, record and finalize capabilities; no implicit permission expansion.

Historical attribution uses valid-at-consumption evidence and remains recordable when a receipt is held later; suppressing traceability would obstruct recall. For opted-in WOs, unresolved later source holds block new finalization/shipment through an explicit output-disposition rule, without undoing historical consumption. Hold writers, finalization and shipment must share a committing conflict fence so a newly applied hold cannot race past a snapshot read. A recorded old shipment remains immutable; any subsequent quality incident is separately visible. Exact handling of receipt-quantity holds versus whole-lot/output quality holds is a required K1 contract decision, not an assumed equivalence.

K1 acceptance: native UI assigns all five canonical lots to each of ten real output units, reconciles WO6/4 quantities and per-unit ratios, and retains the attribution through reload, QC and shipment. Negative cases include foreign or invalid-at-consumption sources, duplicate/over-allocation, globally balanced but uneven per-unit attribution, wrong UOM, stale version, changed-key replay, unauthorized replay, concurrent allocation/correction, injected audit/outbox failure, incomplete finalization and zero-good output. A later hold must preserve historical trace recording while blocking the defined new actions, including hold-versus-finalization/shipment races. Historical financial/PDF and non-opted-in flows remain valid. K1 is lot genealogy only; it does not close serialized-component installation or cycle prevention.

### K2: serialized component custody and graph invariants

This stage requires K1 plus explicit serial-level inventory allocation. It must not infer physical custody from the existing serial uniqueness registry.

- Introduce a real claim for incoming component serials tied to the released source receipt/material and WO BEFORE consumption. Define claim → reserved → consumed → installed transitions and explicit abandoned-claim release. Do not derive a new available-stock claim from K1's already-consumed quantities. Existing consumed records need a separately reviewed evidence/adoption path or remain UNRECORDED; never allocate them as fresh free inventory. Every competing reservation, consumption, dispatch, count/adjustment, transfer and hold path for a participating receipt must respect the same claim/version fence. Quantity-only reservations must fail closed where they could consume a claimed serial's stock. Serial counts reconcile with exact source quantities.
- Distinguish received serialized components from manufactured output units. Installing another manufactured unit requires an explicit inventory/custody transition and a common fence with its shipment path; an ACCEPTED state alone is insufficient. SHIPPED, rejected, quarantined, customer-owned or already installed units cannot be silently reused.
- Installation edges use stable parent/child IDs and immutable source evidence. Enforce one active parent per child with a scoped unique constraint. Reject self-links, foreign scope, duplicate installation and ancestry cycles. Serialize graph changes with a shared graph revision/fence or equivalent proven conflict mechanism so simultaneous A→B and B→A cannot both commit. A truncated traversal must fail closed rather than assert no cycle.
- Record removal/replacement as controlled append-only events. Do not make a removed component available again until a separately defined inspection/custody transition permits it. Rework, disassembly, returns and repair require their own rules; no implicit return-to-stock behavior in this slice.

K2 acceptance includes two parents competing for one child, install versus shipment, claim versus stock adjustment/transfer/hold, reciprocal concurrent cycle attempts, rollback without orphan claims, fresh/replay revocation, scoped reverse tracing and exact custody/stock reconciliation. Canonical E01 incoming materials have lot/heat but no incoming component serial IDs. Keep K2 supplemental serialized-component fixtures separate and do not invent serials in the canonical fixture. Freeze limits and the lock strategy before implementation. Do not mark the Wave4k component-genealogy gap closed until both K1 and K2 acceptance pass.

## Wave4l: controlled delivery and POD

Dependency: a stable accepted shipment contract, including any required frozen genealogy revision. Use a separate versioned delivery aggregate so a later POD does not rewrite the historical SHIPPED response or issued PDF bytes.

Proposed states are SHIPPED, PARTIALLY_DELIVERED and DELIVERED at the delivery aggregate. A command references a real shipment, exact dispatched serials or supported quantity-only source, occurred-at time, recipient/evidence reference and operator reason. Bound time and text fields. Server receipt time remains distinct from a reported delivery time. An operator statement or supplied reference is not a verified provider message or validated binary attachment.

Require a dedicated delivery capability, committing auth/replay guards, scoped expected-version checks, durable keys, audit and outbox in one transaction. Never accept an undispatched/foreign/repeated unit or quantities beyond shipment entitlement. Corrections supersede an earlier record with reason and preserve its evidence. Delivery-versus-correction races must preserve one reconciled current view. Keep the existing shipped-quantity billing rule unless an explicit business policy changes it; a POD change cannot rebill an invoice.

Acceptance covers both canonical 6/4 shipments, partial delivery then completion, reload, restricted role and revoked replay, duplicate and changed payloads, concurrent delivery, future/invalid timestamps, no orphan effects after rollback, prior PDF byte preservation and unchanged invoice/payment balances. Actual proof upload, signature verification, carrier integration and customer messaging are separate capabilities.

## Wave4m: independent full E01 acceptance

Begin only after K1, K2 and Wave4l have passed their bounded gates. Freeze the canonical fixture hash and expected results before writing the adapter. Preserve the original fixture and assertions.

The acceptance adapter maps canonical identities to real persisted UUIDs with an explicit ledger. Execute real inquiry → quote R1/R2 → acceptance/SO → engineering/BOM/routing → receipt/release/issue → WO6/4 operations → ten output units → genealogy/QC → shipment6/4 → PODs → invoices/payments. Match original item identities, UN/SET UOMs, five material ratios/lots, drawing/routing revisions, acceptor/customer-PO linkage and legal-entity/plant boundaries. Explicitly map all original workcenters/skills, four execution sessions with employee/badge/hours evidence, QC certificates/inspectors/signoffs, billing-entitlement caps and resulting fulfillment status to supported runtime behavior or a named gap. Do not infer labor/machine hours from elapsed wall time or substitute a final financial balance for missing execution/QC evidence. Report missing mounted features as gaps; no bypass continuation that creates a later entity directly to manufacture a pass.

Historical fixture dates require a deterministic trusted test clock or an explicitly documented time adapter, confined to the owned test environment. Do not edit fixture dates, backdate Git commits or silently relax expiry validation. First inspect whether the existing runtime exposes a suitable clock; add one only with a reviewed boundary if needed.

Required financial values remain R1 net/tax/gross 128000.00/14080.00/142080.00; R2 122500.00/13475.00/135975.00; invoices 81585.00 and 54390.00; settlement 135975.00 and zero outstanding. These remain fixture policy values, not statutory-tax certification.

Independent review owns the parity matrix and expected fixture assertions. Product owners supply implementation evidence separately. Restart/replay, stale/concurrent commands, revocation and cross-scope denials must preserve domain ledgers. An independent connected browser must exercise the same relationships; UI-only success or fixture-only validation does not close parity. E02/E02-REJ, live integration and production readiness remain separate acceptance tracks.

## Ownership, execution and release sequence

| Lane | Files and responsibility | Dependency |
| --- | --- | --- |
| Lead | Freeze contract/decisions, integration, checkpoints, source manifest and final acceptance | Start from this checkpoint |
| API owner | Genealogy storage/commands/auth and owner HTTP tests | K1 contract frozen; K2 claim/lock contract frozen separately |
| UI owner | Existing manufacturing/trace forms and client helpers, loading/error/retry states, unit tests | Confirm actual API handoff first |
| Independent QA/reviewer | Fixture parity mapping, adversarial probes, source review; no owner assertion weakening | Author early; execute after owner handoff |

API and UI code can proceed in parallel after their wire contract is frozen. Heavy database/browser jobs run sequentially with explicit ownership. Each slice keeps a distinct source manifest, preserved failure evidence, cleanly scoped commit and statement of unaccepted gaps. No blanket completion metric is inferred from passing a subset of tests.

Checkpoint order: commit accepted Wave4j and this planning; start a dedicated genealogy branch from that commit; finish K1 then K2; freeze/deliver POD; run full E01 acceptance last. PR4 still precedes this branch and has two local corrective changes here. Before publication, decide their delivery into PR4 or a reviewed successor without losing either fix. Remote merge remains gated on the actual published head and current CI; a local checkpoint commit is not merge or production acceptance.
