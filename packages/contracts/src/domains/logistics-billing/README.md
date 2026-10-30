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
