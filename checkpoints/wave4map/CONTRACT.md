# MAP01–04 typed procurement and quarantine receiving

Status: **FROZEN IMPLEMENTATION CONTRACT**, 2026-10-25. Scope: real typed procurement through actual quarantined receipt. No usable stock, internal execution, legacy adoption, customer entitlement, manufactured components or supplier verification claim.

## Master policy

Existing item create and `/items/:id/revisions` additionally accept PAIRED `schema: "INVENTORY_ITEM_V2"` and `trackingPolicy: "LOT" | "SERIAL"`. They become immutable content in a NEW revision. Both absent preserves exact V1 content. Partial/null/unknown policy/schema fails400 INVALID_MASTER. Existing approve binds current revision unchanged. No old revision gains a default. Typed procurement requires current APPROVED PURCHASED V2 revision, exact public itemVersion/itemRevision, current owner. Older approved snapshots remain readable but cannot authorize fresh actions after revision/deactivation. Internal planning behavior remains unchanged.

## Capabilities and scope

Namespace `/api/catalog-procurement`. Dedicated `catalog.read`, `catalog.write`, `catalog.approve`, `catalog.convert`, `catalog.issue`, `catalog.receive`. Roles catalogReader/Writer/Approver/Converter/Issuer/Receiver grant read plus their action; owner gets all. Existing procurement/warehouse roles gain no catalog grants. Vendor selection also needs existing procurement.read; item selection master.read. Server derives owner from active selected plant/legal entity inside committing guarded transaction. No owner/customer/UOM/policy overrides.

Every POST requires `expectedVersion` positive safe integer, `reason` trimmed3..500, `idempotencyKey` regex `[A-Za-z0-9_-]{8,100}`. Create expects1. Guard authorization precedes durable key replay. Exact replay returns stored original response without fresh effects; changed payload409 IDEMPOTENCY_CONFLICT. Fresh actions validate current exact item dependencies. Snapshot transactions, real item and PO use-fence writes, exact entitlement CAS, key/audit/outbox rollback together. Request/PO public version describes semantic changes; receipts increment PO useFence, not PO public version.

## Request and order wire

GET `/requests`, `/orders`, `/receipts`: `{data:[full views],page:{limit,nextCursor}}`; limit default25/max100, UUID cursor ascending. GET `/:id` gives `{data:view}`. Requests/orders support `/:id/events`, `/:id/revisions`, `/:id/revisions/:revision`; revision list omits content. Receipt events at `/receipts/:id/events`. No mutable receipt command.

POST `/requests` and `/requests/:id/revisions` body adds:

```json
{"vendorId":"UUID","taxPolicy":"NO_TAX","roundingPolicy":"LINE_HALF_UP","lines":[{"itemId":"UUID","itemVersion":2,"itemRevision":1,"quantity":"2.5","unitPrice":"10.00","currency":"IDR"}]}
```

One to20 lines, no repeated item UUID; max100 revisions. Stable server lineId per request+item survives removal/re-add. Quantity positive decimal string, max18 integer digits/6 fractional. SERIAL integral value and total line quantity<=100; LOT permits decimals. Exact BigInt LINE_HALF_UP per line; currencies USD/EUR/GBP/IDR scale2, JPY0, KWD3, one currency, price exact scale/max28 integer digits. Same accepted money semantics as legacy; no Number quantity arithmetic.

Head fields `_id,tenantId,plantId,ownerLegalEntityId,schema:"CATALOG_PURCHASE_V1",version,status,currentRevision,contentHash,content,approval,orderId,authorityHash`. Content `{vendorId,lines,currency,total,taxPolicy,roundingPolicy}`. Each server line `{lineId,itemId,itemVersion,itemRevision,itemContentHash,itemCode,description,uom,kind:"PURCHASED",itemSchema:"INVENTORY_ITEM_V2",trackingPolicy,ownerLegalEntityId,quantity,unitPrice,currency,lineTotal}`. Head authority is separate immutable event snapshot/hash; revisions immutable complete content/hash including actor/reason/time. Malformed current authority fails409 CATALOG_SOURCE_INVALID (master corruption MASTER_SOURCE_INVALID).

POST `/requests/:id/approve` adds `revision` equal current revision; DRAFT->APPROVED, immutable revision unchanged. POST `/requests/:id/convert` has common fields only; APPROVED->CONVERTED, creates exactly one real catalog PO with DRAFT status, copied approved content, requestId/requestRevision/requestContentHash. Only pre-CONVERTED requests may revise, resetting approval and status DRAFT. PO content revision1 immutable; POST `/orders/:id/issue` common only, DRAFT->ISSUED with server actor/time. No vendor confirmation, amendment or cancellation in this cohort.

Views add `blockers` string array, `canApprove`/`canConvert` for requests, `canIssue` for orders. Order view adds per-line `receiving:[{lineId,receivedQuantity,remainingQuantity,receiptCount,receiptIds}]`, computed from exact authoritative immutable origins/tally. Historical master changes add ITEM_CHANGED/ITEM_NOT_APPROVED; vendor absence/owner mismatch source invalid. Fresh command with live dependency blockers409 CATALOG_DEPENDENCY_CHANGED. Existing immutable content is never relabeled.

## Actual receiving

POST `/receipts`:

```json
{"expectedVersion":2,"reason":"Actual receiving evidence","idempotencyKey":"unique-key","purchaseOrderId":"UUID","vendorId":"UUID","lineId":"UUID","quantity":"1.25","lotNumber":"ACTUAL-LOT","heatNumber":"ACTUAL-HEAT","serials":[]}
```

expectedVersion is current typed PO version, not a new receipt version. Real ISSUED PO/current vendor/exact line/master required. Current revision change/deactivation blocks fresh intake, including quarantine; no auto-rebind. LOT requires actual paired lotNumber/heatNumber matching existing `[A-Za-z0-9][A-Za-z0-9._/-]{0,99}`, serials absent/empty only. SERIAL requires distinct actual serial IDs `[A-Za-z0-9_-]{1,100}`, integral quantity equal count<=100; trace pair optional, partial/null invalid. Max100 receipts per PO line, exact remaining quantity. No manufactured IDs or undocumented conversions.

Writes actual `warehouseReceipts` row: legacy compatible physical base fields purchaseOrderId(typed PO UUID),vendorId,lineIndex,quantity,uom,serials,optional lot/heat,status QUARANTINED,availableQuantity/reservedQuantity "0", plus catalogSource. Creates exactly one real warehouseMovements RECEIVE fromnull/toQUARANTINE and shared warehouseSerials identity entries. No fake legacy PO, no planning effects, no available stock or receipt release. Audit/outbox/key in catalog collections; RECEIVE is actual warehouse ledger evidence. Shared serial namespace rejects collisions including manufactured outputs.

`catalogSource` exact fields `{schema:"CATALOG_RECEIPT_V1",purchaseOrderId,purchaseOrderRevision:1,purchaseOrderLineId,purchaseOrderLineHash,itemId,itemRevision,itemContentHash,itemVersion,ownerLegalEntityId,uom,trackingPolicy}`.

Immutable `warehouseReceiptOrigins` record: `_id` UUID, scope,receiptId,originType:"CATALOG_PURCHASE",schema:"CATALOG_RECEIPT_ORIGIN_V1",source:catalogSource,physical:{purchaseOrderId,vendorId,lineIndex,quantity,uom,serials,optional lotNumber/heatNumber},receiveMovementId,recordedBy,recordedAt,contentHash. Hash covers all fields except contentHash. Unique(scope,receiptId), index(scope,source.purchaseOrderId,source.purchaseOrderLineId). Atomically written with receipt/serials/movement/tally/key/outbox. Binds independent typed identity even if receipt catalogSource is stripped. `catalogReceived` unique(scope,purchaseOrderId,lineId): quantity exact decimal,receiptCount,version; every read/use reconciles<=100 immutable origins, exact receipt/movement/source/registry and received sum.

Export `validateCatalogReceiptOrigin(db,receipt,origin,session)` from catalog-procurement.mjs. Returns validated origin; rejects missing/malformed/mismatched stored typed authority409 CATALOG_SOURCE_INVALID. Requires exact catalogSource presence/equality, immutable origin/hash, exact current typed PO content and revision/approval/issue lineage, physical row/source/RECEIVE unique evidence and serial registry. It validates historical master reference proof without requiring current master eligibility; later master change affects fresh receiving, not identity history. Current quarantine stock fields must remain zero; holds may increase receipt.version and remain valid. Hold authority stays existing stock-holds provider.

Receipt view physical fields plus `receiptOrigin:{cohort:"CATALOG",legacyEligible:false}`, `usable:false`, `blockers:["TYPED_QUARANTINE_ONLY",...current master blockers]`. UI never offers legacy stock operations; authorized hold apply/release remains available. Receiving/QC evidence is OPERATOR_RECORDED, not supplier/provider verification.

## Legacy resolver integration (lead lane)

Lead owns receipt-origin.mjs `classifyReceiptOrigin(db,row,session)` -> `{cohort:"CATALOG"|"LEGACY"|"INVALID",legacyEligible:boolean}` and `requireLegacyReceipt(db,row,session)`. ANY receipt catalogSource property or ANY origin ledger row with receiptId denies legacy, including malformed/null/hash-invalid rows. Typed ledger wins if marker stripped. Legacy requires positive real legacy PO/vendor/line/UOM and unique matching RECEIVE proof; absent/mismatch/ambiguous proof fails409 RECEIPT_ORIGIN_INVALID. Typed origin denial409 CATALOG_RECEIPT_UNSUPPORTED. Raw missing marker/index is never sufficient proof. Guard warehouse release/putaway/reserve/count/transfer, custody adoption, manual/engineering material release, first consume, reservation shipment, and downstream defensive routes. Warehouse read exposes receiptOrigin; no existing legacy field changes otherwise.

No legacy adoption, typed QC/location release, usable stock/internal execution, graph/replacement policy. Existing canonical E01 unchanged; LOT evidence is not runtime adoption. Negative tests include every legacy writer, stripped marker/source proof, current-master drift, receive race/partial entitlement, duplicate serial, rollback and revoked replay, unchanged customer/output effects.

## Collections and exports

catalogPurchaseRequests, catalogPurchaseOrders, catalogRequestRevisions, catalogOrderRevisions, catalogRequestLineIds, catalogEvents, catalogReceived, catalogKeys, catalogAudit, catalogOutbox, warehouseReceiptOrigins; existing inventory master and actual warehouse receipts/movements/serials reused. New module exports initializeCatalogProcurement/installCatalogProcurement/catalogActions/catalogRoles/validateCatalogReceiptOrigin. Master exports requireCatalogInventoryItem for shared validated exact source-use. No heavy execution until lead grants token.
