# Manufacturing implementation contract

TPR-141, PLAT-011/012. Implementation handoff is incremental; independent QA remains TPR-150/152 after integration.

## Historical warehouse intake

`receipt-origin.mjs` exports `legacyReceiptPurchaseSource(db, order, lineIndex, documentRevision, session)`.
It reads the commercial owner's approved revision chain and returns `{line, purchaseSource}`.
New warehouse receipts and their RECEIVE movement pin `LEGACY_PURCHASE_RECEIPT_V2`, order ID, document revision,
stable line ID, line hash and approved revision hash. Unmarked historical receipts use revision 1.
Neither receipt nor movement hashes are rewritten. Typed catalog receipts remain a separate cohort.
Receiving writes the existing PO fence and gross received tally in the same transaction.

## Manufactured stock across generations

New `INTERNAL_EXECUTION_V2` putaway receipts have `sourcePolicy=MULTI_GENERATION_SOURCE`.
Existing V1 roots retain `ONE_HOP_SOURCE`; historical V2 `LEAF_ONLY` output stays terminal without migration.
No stock balance or movement ledger is duplicated. Existing company reservations, use events, issues,
consumptions and immutable output attribution remain authoritative.

`validateInternalExecution` recursively verifies producer events, approved engineering, immutable receipts,
serialized units, stock use and per-generation material conservation. A path cannot revisit an execution.
The traversal admits a shared upstream producer and caches validated nodes within one read, with at most
32 distinct executions and depth 32. Limit and cycle errors fail closed before any partial trace is returned.
Reservations require current source/use/unit revisions, owner/item/UOM match and transactional fences.
Each manufactured unit remains occupied by one reservation; complete attribution assigns it to one output
or explicit process loss, never both. New reservations reject a producer whose ancestry contains the consumer.

`companyStockContext` recursively checks current company holds, source demand, item and qualified location;
mutating callers fence every consumed ancestor in their transaction. Raw receipt ancestry is the union of
all consumed generations, not just direct raw inputs. Existing broad producer-batch hold policy is preserved.
`companySourceSnapshot` includes the complete raw ancestry only for the new reusable cohort, keeping old
snapshot hashes stable.

`COMPANY_UNIT_TRACE_V2` retains exact recursively attributed `companySources[]`, each with its own
`purchasedSources[]` and `companySources[]`. Existing trace paths and V1 output remain supported.
Trace reads preserve execution/receipt/output/reservation and 512 KiB response limits. Reverse uses remain
direct downstream candidates; following their resulting stock opens the next generation. No automatic recall,
dispatch entitlement or financial valuation is implied.

UI uses the existing IEMS navy/white/blue tokens and bundled typography. ENERGY 1 / RHYTHM 1 / MOTION 1.
Native disclosure shows component ancestry on demand so deep graphs do not force every level open at once.
Existing state, focus and permission-aware links are retained. No shared shell, routing, manifest or schema delta.

## Approved customer and internal shortage demand

CTO contract v3 transfers only the demand-kind dispatch/identity/revalidation hunks of `material-shortages.mjs`
to manufacturing after commercial handoff. Procurement lifecycle, stock arithmetic, claim CAS and release remain
the commercial implementation. The optional refresh `demandKind` defaults to `INTERNAL_PRODUCTION`;
`SALES_ORDER_WORK_ORDER` identifies a WO UUID. Unknown kinds never fall back to another authority.

Engineering drafts/revisions accept optional `purchasedMaterials` with explicit approved item ID/version/revision,
exact quantity per output UOM and material UOM. Item snapshots and stable line IDs are server-derived. Typed-only
demand can be drafted before receiving stock. Release validates current item authority and freezes these requirements.
Legacy receipt-only revisions keep their prior shape; existing purchased requirements are retained when an older
revision client omits the optional field. Editing purchased demand creates another draft and requires release again.

`POST /api/manufacturing/work-orders/:id/material-demand` binds exact released engineering ID/version/revision to
a PLANNED WO with expected WO version and idempotency key. It does not release or reserve stock.
`requireApprovedSalesOrderWorkOrderDemand(db, filter, workOrderId, expectedVersion, engineeringRevision,
ownerLegalEntityId, session, fence=false)` requires an active transaction, validates WO/SO line identity, active
owner, released engineering and approved purchased items, and returns WO-scaled `MATERIAL_SHORTAGE_V1` input.
WO, SO, engineering and item fences conflict with concurrent changes. Missing purchased authority fails closed.

Refresh and claims use the stored verified demand kind. Customer replay checks current source authority before
returning its original result; no new claim/revision is written. Internal output hashes and old request-key hashing
retain their original semantics. MRP UI calls the existing refresh and requests/from-shortage endpoints from both
internal plans and bound customer WOs, showing observed quantities separately from current retained claims.
Prices/currency and supplier are explicit operator inputs. Claim approval/conversion/release stay in procurement.

The purchased requirement binding is planning authority. It does not add typed receipt consumption to the existing
legacy customer WO execution path. That path continues to require actual supported receipt routing and custody;
typed-only demand cannot bypass its stock release checks. Internal execution already uses typed stock reservations.

## Reporting coverage

The inherited data registry accepts order/payment/fulfillment resources and source collections only.
Manufacturing, warehouse and genealogy audit deltas are not reporting snapshots. No registry-approved emitter exists
inside this owned vertical: manufacturing adapters are `NOT_YET_WIRED`. Existing commercial SO snapshot adoption
comes from prerequisite c7b8c4e. Extending reporting schemas/bindings remains data/CTO ownership; no fabricated
order/payment/fulfillment event is emitted from manufacturing.

## Remaining assignment work

General manufactured installation graph mutation/freeze integration and F5 contention safeguards remain open.
Do not mark PLAT-011/012 fully implemented from this partial handoff. The shortage producer is owned by
commercial; proposed customer demand dispatch is recorded on TPR-153 for the CTO allocation decision.

Checks: `node --test packages/contracts/src/domains/planning-execution/*.test.mjs`, API syntax and web build.
Pure tests cover historical receipt preservation/tampering, DAG sharing/cycle/limit behavior, serialized
unique-parent/loss conservation and operator selection. They do not prove real DB races, rollback or full QA.
