# Commercial source and revision handoff

Implementation contract for TPR-140. Independent integrated acceptance remains TPR-150/152.

## Approved purchase order revisions

`purchase-orders.mjs` exports:

- `initializePurchaseOrderRevisions(db)` installs unique scoped cohort/order/revision and command-key indexes. Both procurement initializers call it.
- `purchaseOrderLineIds(row)` returns captured UUIDs or deterministic UUIDv8 identities for historical legacy lines.
- `readApprovedOrderRevision(db, filter, cohort, order, revision, session)` reads and verifies the full approved document hash chain. `filter` is `{tenantId, plantId}`; `cohort` is `LEGACY` or `CATALOG`. Original issued orders without archived records resolve as revision 1. Never reinterpret an unversioned historical receipt as the current revision.
- `applyOrderAmendment(...)` requires the caller's active transaction and injected fresh source validation/build callbacks. Domain installers own authorization, CAS persistence, audit, outbox and idempotent result persistence.

The catalog module exports `readCatalogOrderRevision(db, filter, orderId, revision, session)`, which also verifies catalog/PR authority, and `readCatalogRequestApproval(db, filter, requestId, revision, session)` for approved PR snapshots. Document source kinds remain distinct across legacy and catalog collections. A vendor promise increments operational version without changing document revision. Prior issued PDFs retain their original intent keys and bytes.

Initial catalog receipts from newly issued orders use `CATALOG_RECEIPT_ORIGIN_V2` / `CATALOG_RECEIPT_V2`, pinning approved revision hash and stable line identity. Existing V1 origins and hashes remain unchanged and resolve revision 1. Receiving totals cover all revisions of a stable line. Source validation reads the pinned historical snapshot, not the current commitment.

## Material shortages and claims

`apps/portfolio-api/src/material-shortages.mjs` exports `initializeMaterialShortages(db)`, `installMaterialShortages(app, runtime, helpers)`, `refreshShortage(db, filter, input, actorId, session)` and `claimShortage(db, filter, input, actorId, session)`. Exported mutation helpers require an active caller transaction. The HTTP installer reauthorizes each command and replay. Internal approved demand is validated by the existing `requireInternalExecutionDemand` authority helper, imported locally as `requireApprovedInternalDemand`.

Refresh returns `{snapshots, blockers}` for purchased engineering material lines. `expectedShortageRevision=0` is first creation; subsequent refreshes require the current evidence revision. Claims fence the source head's separate operational version, preserving the immutable source revision/hash; fresh uncovered quantity includes all active prior claims. Claim evidence records the exact observation used. Stock is read through catalog authority and use ledgers only, never by adding legacy receipt balances. COMPANY_OUTPUT materials are excluded.

`POST /api/procurement/requests/from-shortage` returns `{sourceCohort:'CATALOG', requestId, requestRevision, lineId, claimId, sourceId, sourceRevision, sourceHash, materialLineId, quantity}`. It invokes `createCatalogRequestFromShortage` in the same transaction. Typed PR quantity/identity cannot be edited independently of the claim; RFQ selection may update prices, subject to normal approval. Full release is available only before PR conversion and cancels its ability to approve/convert. Converted commitments cannot release their claim implicitly.

## Explicit downstream adoption

- TPR-141: adopt shortage API/helper for manufacturing MRP; add the customer-order demand adapter. It is NOT_YET_WIRED here. Adopt the historical revision reader in legacy `receipt-origin.mjs` / warehouse intake and pin the approved revision for new legacy receipts. Commercial does not edit those owned modules. Legacy amendments currently reject orders with any receipt/tally evidence until that commitment reader is validated.
- TPR-143: provide the validated financial R/C/I commitment adapter. Until then reductions, retirement and repricing fail closed with `FINANCIAL_COMMITMENT_READER_REQUIRED`; only unchanged-price quantity increases and appended lines can issue. Existing catalog receipts/use histories are validated and fenced. This preserves existing commitments instead of assuming missing financial data means zero. No invoice/deposit/credit/payment ledger was added or changed.
- TPR-149: integrate the bounded CRM edits sequentially while preserving UI shell. Initialize the data-owned reporting snapshot indexes before enabling reporting producers and start one reporting relay. Commercial appends the order snapshot inside its authorized conversion transaction, with the same source key/hash fields as data bootstrap. Payment/shipment/other emitters remain with their owners.

No live send, production migration, public publication or final acceptance is implied.
