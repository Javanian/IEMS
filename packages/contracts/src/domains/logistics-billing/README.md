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
