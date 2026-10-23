# Manufacturing E01 remaining gaps

Overall status: PARTIAL. Wave4h closes the bounded VAT UI/PDF integration gap, not full manufacturing parity. This list combines the earlier independent E01 parity probe with current Wave4g/Wave4h evidence; it is not a new execution of the full parity suite.

| Area | Disposition | Required proof before closure |
| --- | --- | --- |
| Canonical quote revisions and VAT totals | Bounded acceptance | Preserve immutable R1/R2, exact net/tax/gross and stale-revision rejection |
| Partial 6/4 invoice entitlement and settlement | Bounded acceptance | Current singular entitlement route and monetary conservation are covered; earlier plural-route MISSING result is historical, not a current conclusion |
| VAT UI and versioned PDF | Bounded acceptance | API/UI/issued-PDF consistency and historical replay verified for the tested documents |
| Inquiry entity and source lineage | OPEN | Persist inquiry lines/drawing revision and trace inquiry through quote, SO and fulfillment |
| Material lot/heat traceability | OPEN | Record lot/heat identity on receipt and preserve it through reservation, consumption and output linkage |
| Serialized manufacturing output | OPEN | Produce ten distinct output units across both WOs; enforce uniqueness and quantity/serial reconciliation |
| Component genealogy | OPEN | Trace material lots/serials to each finished unit; enforce installation uniqueness and cycle prevention |
| Delivery/POD | OPEN | Record controlled delivery confirmation, evidence and state changes for both partial shipments; replay and authorization tests required |
| Full fixture parity | OPEN | Rerun every original E01 step and resolve missing/mismatched identities, UOMs, routing, lineage and transitions without bypass continuations |

Do not count the earlier entitlement or VAT gaps twice: these have newer bounded evidence. Conversely, quantity-based work-order output and a SHIPPED status do not prove serialized output or physical delivery.

Suggested implementation order: inquiry/source lineage; lot and serial identity; output genealogy; POD; then an independent full E01 run. Keep each increment reviewable and preserve the existing financial regression tests.

Additional PDF coverage remains useful for long descriptions, multi-page layout and other currencies. Four canonical one-page PDFs were visually reviewed; broader visual acceptance is not claimed. RabbitMQ and production operations are separate gates and were not started for this wave.
