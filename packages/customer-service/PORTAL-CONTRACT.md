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

`provision(opaqueScope, { plantId, grantId, userId, partyId, kind, actions,
expiresAt, commandKey })` creates revision 1 using `portal.access.manage`.
It requires a canonical UTC ISO expiry in the future, at most 30 days away.
Vendor actions require read and optionally respond; customer grants only allow
customer read. The recipient must already have an active foundation user and
tenant membership covering the plant and its legal entity (or tenant-wide
membership). Both recipient records are fenced in the effect transaction;
foundation fences the administrator, tenant, plant and legal entity. The scoped
source account/vendor must exist. This command grants neither foundation roles
nor membership; the recipient still needs the corresponding portal role to read.

Initialize also declares a unique tenant/plant/user/party/kind index for active
grants. Expired active grants must be explicitly revoked before replacement;
there is no TTL deletion of grant history. Duplicate grants return
`409 PORTAL_GRANT_EXISTS`. Receipt, audit and ID-only provision event are atomic.
Replay reauthorizes the administrator and returns the original ID-only receipt;
it never recreates or reactivates a revoked grant. Every later portal read must
resolve current recipient, source party and grant authority independently.
HTTP integration remains unfinished.
No collection initialization or data migration has been executed. Callers must
not insert grants from untrusted request fields or expose the low-level adapter.

Portal endpoints, customer order
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

`portal-provisioning.test.mjs` checks recipient scope denial, permission/expiry
validation, recipient fences, atomic rollback, duplicate grants, command replay
and declared indexes with the real command executor and a transactional DB double.
Actual Mongo index enforcement and concurrent invalidation remain NOT_RUN.

## Immutable vendor responses

`createVendorResponseService(runtime).respond(opaqueScope, { plantId, vendorId,
orderId, responseId, cohort, documentRevision, sourceHash, decision, promises,
commandKey })` records an immutable response at revision 1. `decision` is ACCEPT
or DECLINE; declined responses cannot contain promises. Promises contain unique
approved `lineId` values and canonical UTC `promisedAt` timestamps (maximum 500).
They are vendor statements, not stock reservations or financial commitments.
Corrections use a new response ID and command key; history is never overwritten.

The foundation authorization hook resolves the current vendor grant and approved
source on every attempt before receipt lookup, including replay. Cross-party or
unissued orders return PORTAL_ORDER_NOT_FOUND; hash/line mismatch returns
PORTAL_SOURCE_MISMATCH. New responses require the approved revision to be current
in the transaction snapshot (PORTAL_DOCUMENT_SUPERSEDED otherwise). Replay can
return an existing historical receipt while the same approved source remains
accessible. No commercial PO, financial snapshot or approved revision is mutated.
Response, receipt, audit and ID-only outbox event share the foundation transaction.
Duplicate response IDs conflict; ambiguous commit results reconcile with the same
command key. Initialize foundation indexes before mounting mutations. No service
initialization is executed on import. This service still needs HTTP/UI integration.

`portal-response.test.mjs` checks atomic persistence/rollback, unchanged PO,
permission and party/source reauthorization on replay, input/hash/line validation,
immutable response IDs and idempotency conflicts with the real executor and a
transactional DB double. Actual Mongo isolation, HTTP/browser and independent QA
remain NOT_RUN.

## Vendor read and HTTP integration milestone

`createVendorPortalReader(runtime)` exposes `order(scope,input)` and `history(scope,input)`. Both authorize the opaque foundation scope and active party grant, fence revocation, and verify the approved source in the same snapshot/majority transaction. Session always closes. History filters tenant/plant/vendor/order/cohort and optional approved document revision. Limit defaults to 25 (max100); `after` is the last response UUID in ascending UUID order (stable ID pagination, not chronological order). Fetches limit+1; returns explicit public fields and nextCursor. No raw body, internal note, author or tenant metadata projection. Missing source is 404; denied grant is 403. Malformed/injected identity fields fail before session creation.

`installPortals(app,runtime)` is an integration delta for TPR-149, not mounted by this branch. Install after authenticated scope middleware and JSON parsing, before shared error handling; register portalRoles in foundation role configuration. Routes:

- GET `/api/portals/vendors/:vendorId/orders/:orderId` with required cohort and optional documentRevision.
- GET same path + `/responses` with optional limit/after/documentRevision.
- POST same path + `/responses` with responseId/cohort/documentRevision/sourceHash/decision/promises/commandKey.
- POST `/api/portals/grants` with grantId/userId/partyId/kind/actions/expiresAt/commandKey.
- POST `/api/portals/grants/:grantId/revoke` with expectedRevision/commandKey.

All plant IDs derive from authenticated selectedPlantId. Unknown query/body fields, including tenant/plant/actor overrides, are rejected. Existing service checks own domain errors/command receipts. Initializers remain explicit: createPortalAccessService(runtime).initialize() and createVendorResponseService(runtime).initialize(); never initialize DB from a request. Customer portal routes/screens remain incomplete. No shared app.mjs edits or external sends.

## Customer source/status milestone

`createCustomerPortalReader(runtime).order(scope,{plantId,customerId,orderNumber})`
accepts SO-/RP- numbers and authenticates `portal.customer.read` plus the current
customer account grant in the same snapshot/majority transaction as all source
reads. GET `/api/portals/customers/:customerId/orders/:orderNumber` derives plant
from authenticated scope and rejects all query fields. Denied grant returns 403;
another customer's or missing source returns the same 404. No raw commercial
snapshot, internal repair history, notes, costs or contact fields are returned.

`PORTAL_CUSTOMER_ORDER_V1` carries source order ID/revision, public stage, actual
read `asOf`, and coverage. Manufacture stage uses scoped manufacturing facts and
fulfillment shipment quantities per source line/UOM, with decimal arithmetic.
Shipment rows expose only ID, line index, decimal quantity, UOM and recorded
shipped time. They do not assert carrier delivery. Repair stages map only known
source statuses. Missing promised dates remain `{}`; no estimates are invented.
Malformed quantities, UOM mismatch, unknown states or missing source revision
fail closed. Related collections are bounded to 501 records; more than 500 means
INCOMPLETE coverage, a null publicStage, and at most 500 shipment facts. No total
across UOM is emitted. `asOf` is read time, not a domain update timestamp;
sourceRevision belongs only to the order and is not a composite change token.
Source data is never rewritten. No second authoritative status ledger is stored.

`portal-customer.test.mjs` uses transactional DB doubles to inspect same-session
ACL/source predicates, denied short circuit, public projections, quantity/UOM
boundaries, malformed/corrupt source errors, bounded coverage and HTTP scope.
Actual Mongo isolation, running HTTP/browser and independent QA remain NOT_RUN.
Integration mount still belongs to TPR-149; portal screens remain incomplete.
