# Portal source adapter: PLAT-017 milestone

`apps/portfolio-api/src/portals.mjs` exports
`readVendorPurchaseOrder(db, { tenantId, plantId, vendorId, cohort, orderId, documentRevision? }, session)`.
It requires an active caller transaction. It does **not** authenticate a user or
grant access. Before invoking it, resolve an active authenticated user's portal
grant to the vendor within the same transaction; never trust a vendor ID from the
request as authorization. No HTTP route is installed by this module yet.

LEGACY uses `purchaseOrders.vendorId`; CATALOG uses
`catalogPurchaseOrders.content.vendorId`. Each lookup includes tenant, plant,
vendor and order UUID. A missing party, another party's order or an unissued order
returns null. There is no cohort fallback. Catalog reads use the commercial
authority validator; both cohorts use the commercial approved revision reader.
Missing/corrupt revision evidence fails closed. Explicit historical revision and
current document revision are separate. A promise or response must never rewrite
the approved snapshot or its hash.

The projection whitelists commercial document facts: stable line IDs, descriptions,
item code, quantity, UOM, price/amount, currency, policies and totals where actually
present. It preserves decimal strings and adds neither fabricated amounts nor
zero defaults. Internal notes, costs, account/contact data and full authority
snapshots are omitted. The source hash identifies the original approved snapshot,
not a hash of the public projection. Status is the current order status, even on a
historical document read. No shipment or delivery promise is inferred.

## Remaining implementation

`authorizePortalParty(runtime, opaqueScope, { plantId, partyId, kind, action }, session)`
is the protected grant resolver. It calls foundation `authorizeInTransaction` and
uses its returned tenant/user identity, never a request user ID. It requires a
matching active `portal_party_grants` document with tenant, plant, user, party,
kind, explicit action and a future BSON Date `expiresAt`. It increments
`authorizationFence` in the caller transaction, then verifies the scoped source
vendor/account exists. A missing grant/party yields `403 PORTAL_ACCESS_DENIED`.
Revocation must update the same grant document, so it conflicts with concurrent
access. Reads requiring this fence must commit their transaction before returning.
Do not reuse a returned grant as an authorization cache or replay authorization.

`readVendorPurchaseOrderForPrincipal(runtime, opaqueScope, input, session)` uses
this resolver before the approved source reader and replaces request tenant
identity with the foundation identity. It performs no source lookup after denied
authorization. `portalRoles` exports scoped permission definitions for integration;
no owner-wide party grant is implied by an operator/admin role.

`createPortalAccessService(runtime)` exposes `initialize()` and
`revoke(opaqueScope, { plantId, grantId, expectedRevision, commandKey })`.
Initialization uses the foundation command-result/outbox indexes; integration
must call it before accepting mutations. No initialization is executed on import.
Revoke requires `portal.access.manage` in the foundation transaction on every
attempt, including replay. It matches the authenticated tenant/plant, active grant
and exact positive `revision`, disables the same document used by the reader fence,
and records revoked actor/time. A conflict yields `409 PORTAL_GRANT_REVISION_CONFLICT`.
Provisioned grants must start at revision 1. No legacy revision is guessed.
Foundation atomically saves the result, audit and ID-only `portal.grant.revoked`
event. Command-key reuse with different input conflicts. Unknown commit outcomes
must reconcile using the same key; no new command should be sent blindly.

This is not a grant provisioning API. Trusted provisioning, expiry policy,
unique grant indexes and HTTP integration remain unfinished.
No collection initialization or data migration has been executed. Callers must
not insert grants from untrusted request fields or expose the low-level adapter.

Authenticated party ACL provisioning, portal endpoints, customer order
views, durable vendor response/promise history, replay reauthorization and screens
remain required. Shared mount and navigation belong to the integration owner.
This adapter is a usable source contract, not an implemented portal or independent
acceptance. External sends remain disabled.

## Minimum evidence

`node --test packages/customer-service/portal-source.test.mjs` exercises pure
adapter boundaries with an in-memory database double and the real commercial
legacy revision reader. It does not establish Mongo isolation, authenticated API
authorization, catalog authority fixture acceptance or browser behavior. Those
remain for final independent QA after implementation and integration.

`node --test packages/customer-service/portal-access.test.mjs` additionally checks
opaque authentication propagation, exact grant predicates, permission escalation,
missing source parties, denied-access short circuiting and request identity
replacement. It inspects the Mongo filter and write fence using a DB double;
it does not prove server-side expiry matching or concurrent revocation isolation.

`node --test packages/customer-service/portal-revocation.test.mjs` uses the real
foundation command executor with a transactional DB double to check atomic failure,
replay reauthorization, scope/revision denial and idempotency conflicts. Mongo
write-conflict behavior, durable restart recovery and HTTP mounting remain NOT_RUN.
