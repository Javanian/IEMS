# Purchased fulfillment operator guide

This guide describes the bounded purchased-catalog workflow. Local runtime acceptance is recorded separately in TEST-RESULTS.md.

Open Fulfillment, then Purchased order fulfillment. The reader role needs fulfillment.read and catalog.stock.read; quotation and inventory-master read grants are not prerequisites. purchasedFulfillmentReserver adds catalog.stock.reserve. purchasedFulfillmentShipper adds catalog.stock.ship and fulfillment.ship. Existing POD, invoice, payment and document actions remain separate permissions.

1. Open a catalog-bound sales order. Choose a PURCHASED LOT or SERIAL line. A manufactured line in the same order remains unsupported by this adapter.
2. Select accepted stock from an actual catalog receipt with approved QC, qualified putaway, matching item revision/UOM/owner/plant and no active hold. Use the source pager even when a filtered page is empty but has a next cursor. Captured receipt and stock versions are retained; refreshing an option does not silently replace the captured source.
3. Enter the exact LOT quantity, or select actual SERIAL identities from the native multiple selector. The server derives serial labels from stored unit UUIDs. Individual native option-row touch sizing and physical kiosk hardware require separate pilot validation.
4. Record the reservation with a reason. Reservation reduces available stock and leaves physical on-hand unchanged. Production and customer reservations compete against the same receipt authority.
5. Dispatch all or part of the selected reservation. A SERIAL dispatch selects the actual unshipped reserved units; a LOT dispatch uses an exact quantity. The recorded dispatch is operator evidence, not a carrier integration. Physical on-hand decreases exactly once.
6. Release the remaining unshipped part if it is no longer needed. This is allowed after partial shipment or a later source hold/withdrawal. Released stock never includes already shipped units.
7. Open the actual shipment to record POD evidence or prepare an invoice from its shipped quantity. Later item/location withdrawal does not erase valid dispatch history. Existing exact billing and payment caps apply. A typed payment may allocate only to proven purchased invoices of one typed sales order; mixing legacy invoices or multiple typed orders is rejected.
8. Inspect order history, receipt provenance and Audit details when tracing a record. PDFs use the existing document contract and are not a separate catalog identity certificate.

If a submission result is uncertain, use the retained command's retry. It sends the same body, versions and key; do not submit a new command to guess whether the first one committed. Refresh, sibling actions and document controls are locked while an uncertain command is retained. Discarding the local command does not undo a recorded server effect. Reload the actual stored state before choosing another action.

A stale version or new source hold requires an explicit review of current source state. Historical reads and authorized exact replay remain available when their frozen proof is valid; revoked roles and corrupted evidence are refused. Readiness flags describe server state, while the UI also checks actual grants.

Source, order, invoice and payment histories are bounded as documented in CONTRACT.md. This checkpoint does not certify maximum-size or production throughput. F5 authorization contention remains blocked. Manufactured dispatch, general genealogy, sales amendments, UOM conversion and cross-plant fulfillment remain later work.
