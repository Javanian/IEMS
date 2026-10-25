# Catalog procurement continuation

Baseline: accepted internal planning `bd6d7f2b7ec6404a5b6c4fa31db55c1154bfcec3`. MAP01–04 binds approved explicit item tracking revisions through catalog purchase request, immutable revision, approval, PO conversion, issue and actual quarantined receipt. Existing legacy receipt writers now require positive legacy origin proof. The independent typed origin survives removal of a receipt marker.

The next boundary is MAP05: approved typed incoming QC and authorized physical putaway into a currently qualified company location. Freeze disposition authority, live item/location dependency policy, exact quantity/identity stock ledgers, hold ordering, quarantine rejection/return and concurrency with every stock writer before implementation. QUARANTINED currently provides no usable stock; a generic legacy QC release is not this adapter.

Then bind approved internal demand to a new immutable INTERNAL_STOCK execution origin. Material reservations must use exact typed receipt item/revision/UOM and released engineering requirements. Support mixed LOT and SERIAL input policies explicitly; the existing all-serial customer WO adapter cannot stand in for that contract. Preserve historical customer-order snapshots and do not fabricate a sales order to execute company production.

Internal execution still needs issue once, operation evidence, process losses, serialized output, QC partition, complete input genealogy and explicit company-stock receipt. Missing valuation remains UNVALUED. Manufactured-source graphs, descendant freezing, controlled spare/rework replacement, POD and full canonical E01 remain later gates. Supplemental tests must not alter canonical dates, invent incoming serials or relabel legacy receipts into inventory item identity.

Source pickers currently read a bounded first100 items/vendors; cursor selection beyond that page is a named UI continuation. Existing request/order/history lists have cursor navigation. Publication, merge, deployment and live provider integration remain separate from this local checkpoint.
