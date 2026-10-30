# Fulfillment and settlement handoff — TPR-143

Implementation checks are separate from independent acceptance (TPR-150/152).
All API mutations use the existing scope guard and Mongo transaction. UI language is English.

## PLAT-015 pick, pack, dispatch and returns

`POST /api/fulfillment/packing` accepts the existing generic shipment selection and records
PICKED intent without reserving or moving additional stock. `POST /packing/:id/pack` accepts
expectedVersion, packageReference and idempotencyKey. A PACKED selection can be dispatched
through `/shipments` with packingId/expectedPackingVersion. Exact source quantities and
serials must match, and availability/quality/stock checks run again in the shipment transaction.
The package CAS and resulting shipment commit together. Existing direct dispatch remains supported.
Packing reads support salesOrderId and bounded cursor pagination. Catalog purchasing retains
its existing separate canonical customer-reservation flow.

`GET|POST /api/deliveries/shipments/:id/returns` reads or receives confirmed-delivered goods.
A command binds expectedVersion, quantity, actual serials, reference, reason and idempotencyKey.
Quantity/serials cannot exceed the delivered, not-yet-returned cohort. Goods enter immutable
QUARANTINED_CUSTOMER_CUSTODY; no available inventory, invoice credit or negative shipment
is fabricated. Shipment and POD evidence remain unchanged. Returns require fulfillment.deliver.
Return receipt, key, audit and outbox share the source-fenced transaction.

New return indexes are initialized through existing initializeDelivery. No router/manifest delta.
New packing index is initialized through existing initializeFulfillment. These are Mongo
initialization declarations, not a production migration execution.

The UI uses existing IEMS tokens, panels, native labelled controls, retained mutation attempts,
and permission-aware forms. Pick/pack references and exact quantity/serial facts drive the
hierarchy. ENERGY 1 / RHYTHM 1 / MOTION 1; no assets or animation added. Build/source inspection
is not a browser, viewport or accessibility acceptance claim.

Focused synthetic smoke: `node --test --test-concurrency=1 packages/contracts/src/domains/logistics-billing/dispatch-flow.test.mjs`.
It verifies two partial shipments, no overdelivery, pack CAS, same-key replay, POD/return
conservation and the absence of automatic payment/stock restoration. Final race/security/browser
and full regression are deferred.

## PLAT-016 settlement authority

New invoice issues retain immutable `fulfillmentInvoicePostings` snapshots, exact currency-scale
amounts, optional UTC dueAt and a settlement projection verified against immutable receipts.
Existing purchased invoice/payment proof chains remain authoritative. There is no endpoint to
edit issued lines or erase a receipt. Legacy invoices remain explicitly LEGACY proof mode;
credit adjustments require the new immutable issue proof. Existing renderer snapshots are reused.

`POST /api/fulfillment/deposits` records accountId/amount/currency/reference/idempotencyKey.
The receipt is immutable and account-bound, with a CAS deposit balance projection. It is not
silently assigned to an order. `/payments` preserves its existing explicit invoice allocations
and accepts settlementKind CASH (default), DEPOSIT or CREDIT. DEPOSIT also requires depositId
and expectedDepositVersion; CREDIT requires creditReason plus both fulfillment.pay and
fulfillment.invoice. All effects, proof-chain snapshots, deposit application or credit note,
audit/outbox and key share one transaction. Credit reduces outstandingAmount and increases
creditedAmount, without increasing paidAmount or claiming cash. Payment/deposit allocation
and credit records remain immutable. A return never creates one automatically.

`GET /api/fulfillment/accounts/:id/ledger` returns exact per-currency aging, invoice details and
deposit balances. Missing due dates are UNDATED. The read is capped at 100 invoices/deposits;
if incomplete, aging is null rather than a partial total. No currency conversion is invented.
UI entry points are order fulfillment and invoice detail, with labelled native inputs, contained
semantic aging tables, explicit loading/error/empty states and retained mutation commands.

Procurement commitment reader returns UNSUPPORTED with explicit unknown R/C/I when complete
supplier-invoicing and distinct-commitment authority cannot be proven. It supplies observed
validated receipt evidence and source revision/hash; observed receipts are not a completeness
claim. Reductions/repricing remain disabled. Caller would need PO/receiving-tally/receipt/stock
and supplier-invoicing fences in its amendment transaction before enabling those operations.

Reporting uses the completed data helper and same-session transactional grants. Live shipment
snapshots cover generic and purchased shipments. Payment snapshots group actual explicit
allocations by invoice.salesOrderId using persisted reportingPaymentIdentities UUIDs, shared with
the source adapter. Amounts are exact grouped allocations and have no invented line allocation.
Payment source metadata distinguishes CASH/DEPOSIT/CREDIT and cashEffect; the payment dataset
represents receivable settlements, not an undifferentiated cash-receipt report. Invoice issuance
is immutable reference evidence only in the frozen v2 data contract (no invoice dataset).
Unallocated deposits, returns and packaging have no order snapshot mapping. They remain in
their authoritative datasets. No financial correction/delete endpoint is added; no tombstone
is fabricated for immutable posted evidence.

New financial and reporting identity indexes are initialized through existing fulfillment
initialization. No app/router/package change. Data source-adapter bootstrap currently handles
the older generic source cohorts; integration must adopt new typed source/settlement metadata
before claiming complete historical replay coverage. Full final QA remains NOT_RUN.

Focused smoke: `node --test --test-concurrency=1 packages/contracts/src/domains/logistics-billing/settlement-flow.test.mjs`.
Checks exact high-precision money/aging, deposit replay and allocation, separate credit/cash
facts, posted-content tamper rejection, actual purchased proof-chain compatibility and live
reporting receipts. It does not establish full regression or concurrency acceptance.

## Manufactured dispatch and descendant evidence (amendment v4)

`GET /api/fulfillment/manufactured/orders/:id` reads actual catalog manufactured lines and
matching company stock, with current unit/source versions and bounded source completeness.
`POST /api/fulfillment/manufactured-shipments` accepts salesOrderId/expectedVersion, lineIndex,
uom, reference, packageReference, idempotencyKey and sources (companyReceiptId,
expectedStockVersion, units[{companyUnitId,expectedUnitVersion}]). Quantity is the exact unique
serial count, not a caller-supplied fractional stock amount. Maximum 20 sources / 100 units.
Requires fulfillment.ship plus company.stock.read/reserve/issue; replay reauthorizes each.

FULFILLMENT_SHIPMENT canonical claims reference immutable manufacturedShipmentAuthorizations
and a hash-linked manufacturedShipmentEvents/head chain with reciprocal reservation refs.
The binding contains actual shipment/order identity, stable lineId or explicit historical
lineIndex + SO snapshot hash, authorizedShipmentVersion=1 and authorizationHash. It never
fabricates an execution. Canonical RESERVED→ISSUED→CONSUMED transitions, stock revisions,
movement proofs, shipment, audit/outbox, reporting snapshot and key commit atomically.
No externally persisted half-dispatch is exposed, so this command needs no separate release
operation. Existing internal/repair RESERVED release behavior remains unchanged and tested.

Root graph is frozen under an actual SHIPMENT reference while the selected unit is AVAILABLE.
Actual reachable ancestor graph/quality/source authority is validated and fenced in the same
transaction. shipmentDescendantFreezes retains root and ancestor evidence hashes as a closure
for the shipped descendant. Ancestors already consumed into that output remain unavailable
for another shipment; no inventory is recreated. Stored producer/QC/attribution history stays
immutable. Closure traversals fail closed on cycle/unique-parent and existing 32-execution/depth, 2000-output-unit and 512-KiB evidence bounds. Historical
snapshots remain valid after later holds; current holds block new stock effects.

Only the v4 allocated hunks change company-stock/state/trace and genealogy: shipment binding,
validator/movement/effective-unit dispatch, typed shipment trace and repair-aware graph delegate.
Existing graph hashes and internal/repair rules are retained. Traces expose uses.shipments,
actual SHIPPED disposition and canonical CONSUMED state, never fabricated manufactured outputs.
Catalog financial proof collections are reused for CATALOG_INVOICE_V2/CATALOG_PAYMENT_V2;
mixed purchased/manufactured orders reconcile through their actual respective stock authorities.

Actual handling equipment can be recorded with optional handling {equipmentId,
expectedEquipmentVersion,expectedMaintenanceVersion,from,until,requiredMinutes}. Its UTC minute
window must contain the current business time. Current calibration, quality holds and
maintenance capacity are validated/fenced by the shared owner exports inside generic,
purchased and manufactured shipment transactions. Operator quality holds are checked too.
The UI selects real configured equipment and actual serials; no equipment or timing is inferred.

New initialization is called inside existing initializeFulfillment, and routes are installed
inside existing installFulfillment. No app.mjs/shared router/manifest delta. Bounded canDispatch
also requires capacity for all three canonical stock events. Generic, purchased and manufactured
shipment/POD/return/invoice UI all link actual source records.

Focused command: `node --test --test-concurrency=1 packages/contracts/src/domains/logistics-billing/manufactured-flow.test.mjs packages/contracts/src/domains/engineering-repair/spare-flow.test.mjs packages/contracts/src/domains/planning-execution/manufactured-graph.test.mjs`.
It covers two-generation closure, two partials, source holds, current actor permission on replay,
immutable binding/unknown authority rejection, typed trace, invoice/payment/POD, real maintenance
capacity, outbox rollback and retained repair/internal graph behavior. Final race/full browser
acceptance remains deferred. Intermediate fixture field error and corrected runs are retained.

Reporting adoption: generic/manufactured shipment uses immutable fulfillmentKeys result;
purchased shipment uses its immutable fulfillmentShipments + purchased authority event. All
source event IDs reference real persisted audit/authority records. Live emitter coverage is
complete for these dispatch commands and explicitly allocated settlements. Data-owner historical
bootstrap still requires its typed-shipment and settlement-metadata cohort extension at integration;
do not claim whole-history/source coverage from this emitter handoff.

## Truthful completion

`GET /api/fulfillment/orders/:id/closure` derives OPEN_OBLIGATIONS, FULFILLED_EVIDENCED or
INCOMPLETE from exact shipped/invoiced quantities, the existing validated POD chain, immutable
invoice settlement and quarantined returns. No close flag or order status is fabricated. A
settled invoice alone does not close an unshipped order; a later return makes current completion
open again. Missing legacy posting proof requires review. Bounded incomplete histories never
show a complete balance. Both order fulfillment screens expose the reasons and current basis.

The shared delivery-state reader is extracted without changing its chain checks. Historical
generic POD hashes that included documentFence are recognized against bounded actual document
counters, while new PODs exclude mutable document/return fences. Full source contents still have
to match; a stored head hash is never trusted as a substitute for source evidence.
