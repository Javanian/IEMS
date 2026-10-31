# V6 remaining local receipt contracts (proposal, not implementation authority)

Base inspected576a947; v6 local receipt extension is in progress on TPR-148.
Original raw receipt hashes/identities remain unchanged. Full coverage is false.

## A. Nonreceipted synchronous local writes

| Actual routes | Current transaction/owner | Missing stable command contract |
| --- | --- | --- |
| POST /api/crm/accounts; /accounts/:id/contacts; /opportunities; /opportunities/:id/stage | app.mjs installCrm.transaction, existing CRM guard+audit/outbox | No caller key/result receipt. Proposed new crmCommandResults below. |
| POST /api/commercial/quotes without CATALOG_QUOTE_V1; /quotes/:id/revisions, /approve, /accept on legacy cohort | commercial.mjs tx; generic legacy handlers | Unkeyed legacy body; typed quoteCatalogKeys and legacy quoteConversions already preserved/admitted. Proposed legacyQuoteCommandResults only for currently nonreceipted paths. |
| POST /api/procurement/vendors; /requests; /requests/:id/approve; /orders/:id/issue; /orders/:id/vendor-confirmation | procurement.mjs tx | No authoritative result receipt for these operations. Existing RFQ/promise/convert/amendment namespaces are admitted separately. Proposed procurementCommandResults only for the missing operations. |

Bounded proposal A (CTO decision/allocation required): an optional commandKey on
legacy APIs, required for enrolled tenants; existing unenrolled bodies continue
their normal behavior. No generated aggregate UUID or request ID is the command
identity. Each new domain-owned collection has unique exact filter
{tenantId,plantId,userId,action,key:commandKey}. SHA256 uses existing foundation
contentHash({action,resourceId:existingRouteIdOrNull,input:validatedBodyWithoutKey}).
A create has stable resourceId:null in this digest; its generated result ID is
created inside the business transaction and returned in the original response.
Stored row: {_id,filter...,inputHash,result,schemaVersion:1,occurredAt}. On replay,
current domain/source/scope authorization and digest comparison precede zero-charge
admission and the original result. New effect, receipt, usage, audit/outbox share
one session. Do not alter old hash algorithms, convert receipts, finance or source
state policies; no historical backfill. Needed paths: app.mjs CRM transaction and
body shape only; commercial.mjs/procurement.mjs relevant generic tx/handler shapes;
own lifecycle registry/tests. These are proposals for new receipt authority, not
a claim that v6 already allocated schema creation. Final exact action enums and
validated body contract must be registered before enrollment can cover them.

## B. Document issue is locally receipted, but commits independently

POST /api/documents/issues in documents.mjs creates PREPARED documentIntents in
one tx, calls runtime.documents.issue independently, then publishes READY/audit/
outbox in another tx. packages/document-rendering/src/index.mjs createIssuer.issue
renders PDF before starting its own session/transaction and inserts documentArtifacts
plus documentIssues. Its existing unique authority is the exact filter
{tenantId,legalEntityId,plantId,kind,sourceId,sourceVersion}; existing comparison is
record.contentHash===snapshot.contentHash plus template/snapshot/PDF validation.
This is NOT a missing source-version identity and must not get a parallel random
request-ID receipt. Current v6 cannot charge it atomically in the caller session.

Bounded proposal B (CTO path/port allocation required): extend only
packages/document-rendering/src/index.mjs and matching index.d.ts with an explicit
prepare(scope,snapshot) pure render port and issueInTransaction({scope,snapshot,
prepared,session,admission}) using the supplied session. Preserve original receipt
filter, contentHash/template/pdfHash and existing validated replay logic. Extend
own admission descriptor only for namespace documentIssues with an exact structured
identity equal to that existing filter (no user/action/key dimension invented).
Host documents.mjs rechecks current scoped source snapshot/hash in the effect
transaction; compares the original owner receipt, invokes admission, inserts the
artifact/receipt and publishes READY documentIntents+audit/outbox in that SAME
transaction. Pre-rendering performs no durable business writes. Original independent
issue remains compatible for standalone unenrolled callers. Existing unknown
PREPARED history keeps enrollment denied until explicitly reconciled; no silent
reseal, deletion or migration. No renderer layout/template/payment change.

## C. Other unsupported operations must stay visible

The actual route registry separately retains private customer-service/automation,
public durable-job ingress and external vector/vendor-delivery operations.
Some private modules already have receipts (cs_idempotency, automation_audit_logs,
foundation job command), so they must not be mislabeled nonreceipted or external
merely because this profile does not admit them. Their private principal, operator,
transport/worker lifecycle and independently committed effect contracts need an
explicit further coverage decision. Advisory read-only POSTs remain unmetered.
GET automation SLA scheduling is a mutation and remains unsupported.

This proposal requests one CTO decision on existing TPR-153; it creates no new
issue, receipt, user role or production authority. TPR-148 finishes/verifies and
commits already-allocated existing local wrappers independently. TPR-149 integrates
sequentially; independent150/152 remain at the end. No full PLAT-038 completion.
