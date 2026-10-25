# Wave4j material identity and serialized manufacturing output

Baseline: `8324b0294677f2f9273f144eddc51b4b026a07ab` (PR4, still open at resume). Branch: `feat/manufacturing-lot-serial`. Original dirty main checkout and CRM TAP evidence are preserved. This bounded continuation does not merge PR4 or activate brokers or external integrations.

## Receipt and material identity

`POST /api/warehouse/receipts` optionally accepts `lotNumber` and `heatNumber` together. Both are nonempty identifiers matching `^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$`. Omitting both preserves the legacy contract; partial, malformed, or unknown fields are rejected. Receipt identity is immutable. Separate receipts may legitimately share a lot/heat.

For traced receipts the server derives `materialTrace: { receiptId, lotNumber, heatNumber }` in routing materials, reservation and stock movements. Reservation and consumption must retain this snapshot. Serialized final output stores a `materialTrace` array copied from released materials. This is work-order material context, not per-unit component genealogy or installation evidence.

## Output identities

Work-order planning optionally accepts `serialized: true`; false or omitted uses the legacy quantity workflow. Serialized split quantities must be integral, positive and no greater than 1000 units per work order. Exact decimal arithmetic, existing UOM rules, stock holds and engineering release guards remain authoritative.

The final `/record` command for a serialized work order requires `outputSerials`. The array has one unique validated identifier per good output unit; zero good output requires an empty array. Earlier operations and nonserialized work orders reject serial inputs. The response stores `output.serials`, initially quarantined, together with the material context. The existing tenant/plant `warehouseSerials` namespace prevents collisions between received and manufactured units, including concurrent writes. Durable output-unit records retain the work order, sales order, line and status.

Serialized `/qc` requires `acceptedSerials` and `rejectedSerials` forming an exact, disjoint partition of output identities. Their counts must match the exact accepted/rejected quantities. Unit statuses change atomically to ACCEPTED or REJECTED. No omitted, foreign, duplicate or silently discarded identity is allowed.

`GET /api/manufacturing/work-orders/:id/output-units` uses the existing scoped manufacturing read permission and returns `{ data: units }`, at most the 1000 planned units. This exposes current unit status without changing frozen work-order responses when a later shipment occurs.

## Fulfillment

Each serialized WORK_ORDER shipment source requires `serials` matching its exact shipped quantity. Only ACCEPTED units from that work order can ship; updates to SHIPPED and `shipmentId`, source tallies, stock movement, audit, outbox and idempotency receipt commit together. Reuse, foreign work-order identities, rejected/quarantined units and caller-supplied trace overrides are rejected. Shipment sources and stock movements retain selected serials and server-derived material context. Nonserialized and reservation shipping retain their existing quantity contract.

## Transaction and compatibility requirements

Existing scoped authorization and commit-time revocation fences run before fresh writes and durable replay. Existing expected-version checks and durable idempotency behavior remain. Invalid or failed commands must leave no orphan serial registry entries, units, stock movements, receipts or audit/outbox effects. Same-key replay returns the stored result; changed payload/key reuse conflicts.

No monetary calculation, VAT fixture policy, historical issued PDF bytes or renderer schema changes. Known prerequisite PR4 review corrections are documented separately. Full E01 remains PARTIAL until component genealogy, POD and independent full fixture acceptance are complete.

## Verification and ownership

API owner: warehouse/manufacturing/fulfillment plus dedicated HTTP regression tests. UI owner: existing warehouse/manufacturing/fulfillment forms and command helpers plus unit tests. Corrective owner: semantic provenance validation and known-account inquiry entry. Lead: integration, connected browser, final checks and evidence.

Heavy execution is sequential: API tests, then browser, then any justified independent probe. Use only marked disposable Mongo replica sets and exclusively owned processes. Evidence stays outside the repository. No live database migration, broker, cloud, SAP or WhatsApp action is part of this contract.
