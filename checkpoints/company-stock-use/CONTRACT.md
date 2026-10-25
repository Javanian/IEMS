# One-generation company stock use

Status: structural and wire contract frozen before parallel edits. Base f4cf6fd. No new authorization cache or fence removal.

## Authoritative source and demand

The new plan and execution cohort explicitly opt into V2 and typed material source kinds. V1 requests and immutable evidence are not silently upgraded. Purchased materials keep the catalog origin path. Manufactured materials use actual stored company output UUIDs, exact approved item revision/UOM/owner, source receipt and producer identity, QC evidence and qualified location/bin.

Only validated STORED V1 executions with purchased-only inputs may supply a manufactured component. Validate immutable producer/demand/output/registry/QC/putaway evidence, not a caller's source label or an unanchored availability flag. V2 descendants cannot supply another job or any legacy/customer dispatch path. Terminal status derives from immutable V2 demand, typed source and actual consumption proof; deleting or self-rehashing a presentation marker cannot upgrade it.

## Conservation and mutation

Opening company receipts, company units and output rows remain historical evidence. A separate versioned use projection plus immutable events records reservations, issues and consumption. Maintain physical on-hand, reserved, issued, consumed, available and live eligible quantities separately. A reservation does not consume material; unissued abandonment releases its claim; issue preserves physical on-hand; consumption posts once. Do not consume the producer's embodied catalog inputs again.

Every mutation uses current authorization inside the transaction before idempotency replay. Fresh material-use/progress commands write the source/demand dependencies they require. New commands use optimistic versions, atomic use/event/audit/outbox/key changes and bounded uniqueness/CAS; whole-receipt hold commands serialize through the company use head. A stale version, scope/owner mismatch, source withdrawal, orphan proof or malformed quantity fails without partial effects. An authorized exact historical replay may return its stored result under a later hold; a revoked actor cannot replay it. Unissued abandonment intentionally permits held stock to be released. Retry after uncertain submit retains the exact request/key and locks sibling source controls.

## Holds and provenance

A dedicated permission-controlled whole-company-receipt quality hold/release contract is included. It does not erase history, change physical counts or free a claim. Unissued abandonment remains possible under hold; new reserve/issue/consume and dependent execution progress require fresh eligibility. Consumed purchased ancestry and direct source-company holds block the dependent V2 job. The embodied raw hold set conservatively includes all actually CONSUMED purchased receipts of the source producer batch. It is not narrowed to only raw receipts attributed to the selected output unit. Exact selected unit/output/provenance pointers remain recorded separately. Held abandoned raw receipts do not poison actual consumed ancestry; abandoned evidence still cannot be deleted or relabeled to gain authority.

Actual company issues/consumptions and per-output allocations/losses retain exact source company receipt, producer, output UUID and serial, item revision, ownership, location and immutable origin hashes. Mixed purchased/company inputs reconcile each source independently with exact decimals. Resulting accepted V2 output can enter company storage as UNVALUED terminal stock; rejected output remains quarantine. No second embodied raw movement, child reuse, sales dispatch, installation/removal/replacement or general graph acceptance is implied.

## Acceptance fixture and limits

Independent supplemental fixture: a purchased-input V1 producer yields accepted2/rejected1. A V2 consumer requests2 with manufactured ratio1 and direct LOT ratio1.25, records good1/scrap1, attributes one actual company identity plus LOT1.25 to the good output and one company identity plus LOT1.25 to process loss. QC and putaway create one terminal accepted descendant. Producer raw counters/consumptions and immutable opening/output/company rows stay unchanged.

Prove competing claims, actual source CAS interleaving separately from HTTP authorization serialization, replay/revocation, outbox rollback, current master/location and direct/consumed-ancestor hold orderings, self-rehashed/orphan authority refusal, and terminal reuse/dispatch rejection. Native UI must demonstrate actual selection and mutations, uncertain-submit recovery, source navigation and360/768/1440 layouts with desktop44px/kiosk48px controls. Intentional faults and nonfatal teardown diagnostics stay in raw external evidence.

## Frozen API wire

Plan creation accepts optional `schema: INTERNAL_PLAN_V2`; omission retains V1. V2 engineering derives each material's `sourceKind`: `CATALOG_RECEIPT` for PURCHASED, `COMPANY_OUTPUT` for approved MANUFACTURED SERIAL. Execution creation derives `INTERNAL_EXECUTION_V2` from the frozen demand; a caller cannot independently relabel an execution.

Existing execution lifecycle routes remain. V2 reservation bodies use the common `expectedVersion`, `reason`, `idempotencyKey`, `materialLineId`, `quantity` and `sourceKind`. Catalog sources keep their old receipt/version/serial fields. A company source uses `companyReceiptId`, `expectedStockVersion`, and `units: [{companyUnitId, expectedUnitVersion}]`; quantity is the integral exact count, at most100. `receiptId` and caller-provided serial strings are invalid for that branch. Unissued company abandonment uses the existing reservation release route with `expectedStockVersion`; catalog abandonment is unchanged.

V2 attribution and loss `sources` are a strict union: catalog sourceKind/receiptId/quantity/serials where relevant, or company sourceKind/companyReceiptId/quantity/companyUnitIds. Actual issue, consumption and source snapshot identities are bound by the server.

`GET /api/company-stock/receipts` has optional itemId plus bounded limit/cursor and deterministic data/page; `/:id` returns data and `/:id/events` returns bounded history. The detail retains opening receipt identity plus current version, producerExecutionId, sourcePolicy (`ONE_HOP_SOURCE` or `LEAF_ONLY`), opening/onHand/reserved/issued/consumed/available/eligible/blocked quantities, current units with their versions/status/eligibility, blockers, hold and canReserve. `canAllocate` and `canDispatch` remain false for generic legacy/customer use. Terminal stock has physical on-hand and blocked quantity while available/eligible are0.

`POST /api/company-stock/receipts/:id/holds` uses common version/reason/key and reasonCode `QUALITY_SUSPECT` or `TRACE_REVIEW`. `POST /:id/holds/release` additionally binds expectedHoldId. Actions are company.stock.read/reserve/issue/hold/release. Company reserve/abandon additionally requires company.stock.reserve; dependent release/issue/record/qc/putaway additionally requires company.stock.issue inside transaction before key replay. The current V1 business actions remain required.

Collections: companyStockUseHeads/Units/Events, companyMaterialReservations/ReservationRevisions/Issues/Consumptions, companyStockKeys/Audit/Outbox. Execution sourceReceiptIds remains direct raw audit identity; consumedReceiptIds is direct raw consumption. companySourceReceiptIds records company-source history; consumedAncestryReceiptIds is the direct consumed raw set plus the conservative actually consumed source-producer-batch raw union described above. Abandoned source history is not physical ancestry.

The native detail route is `/portfolio/company-stock/receipts/:id`, authorized by company.stock.read independently of internal.execution.read. Producer execution links require their own read grant. This checkpoint adds the source detail and existing planning/execution entry paths; it does not introduce a global company-stock dashboard.

Successful fresh commands may advance explicit dependency/authorization fences. This is not raw consumption. Failed or rolled-back commands must leave even hidden fences unchanged; owner/independent snapshots must not exempt business effects.
