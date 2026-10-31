# PLAT-038 supported implementation and integration

Tenant-wide SaaS administration is separate from customer invoices and finance.
Subscription pricing/payment collection is not configured or simulated. Plans
represent included usage limits, not a financial invoice. Current UTC month is
the counter window; exact nonnegative integer strings are used for counts/bytes.
Plan changes preserve current usage. API meters are service/operator inputs,
not client-provided proof of business activity. No provider payment is attempted.

Register lifecycleRoles before creating foundation. saasReader/saasOperator must
be tenant-wide membership AND tenant-wide role grants; plant-only admins cannot
export/delete a whole tenant. saasUser grants saas.use only for its assigned plants.
Initialize createTenantLifecycleRuntime(runtime,{domainPort}) and its indexes;
installTenantLifecycle(app, lifecycle) after authentication, trusted scope and
existing origin/CSRF middleware. No package/manifest change is required.
Mount TenantLifecycleWorkspace at /portfolio/tenant-lifecycle under the shared
shell and gate navigation on saas.read. Shared app/router/roles are CTO TPR-149.

Every POST accepts key, expectedRevision, reason and the action-specific fields;
plantId comes only from authenticated selected scope. Status GET accepts no query.
Command output is data.subscription plus export archiveId/digest/sourceRevision.
Errors include REVISION_CONFLICT409, SAAS_QUOTA_EXCEEDED429,
TENANT_WIDE_SAAS_GRANT_REQUIRED403, TENANT_DATA_PORT_UNAVAILABLE503,
EXPORT_STALE409 and ARCHIVE_INTEGRITY_INVALID409. Do not retry ambiguous results
with a fresh key; exact saved commands are replayed with current authorization.

CTO must wire assertEntitled(scope,{plantId,session,metric,amount}) inside the
existing domain effect transaction AFTER domain authorization and idempotency
replay lookup. It consumes quota and writes usage audit/outbox in that session.
No session means fail closed. Admission remains UNWIRED until this integration;
subscription state alone does not disable existing app endpoints. Do not grant
saas.meter to ordinary users. Same-tenant revisions contend deliberately; Mongo
transactions bound retries. Per-tenant rows/unique index isolate quota state.
StorageBytes currently meters cumulative admitted bytes per UTC month, not current
disk occupancy. Actual storage accounting requires the authoritative storage port.

Domain port is mandatory for export/delete/restore. Each method receives the same
active Mongo session and transaction-authorized tenant grant. No file, network or
external effect is allowed. Port must read a complete fenced tenant-wide snapshot
across ALL owned modules, include sourceRevision, schema TENANT_EXPORT_V1,
coverage COMPLETE, tenantId and <=1000 resources with stable UUID id/tenantId.
The complete canonical JSON snapshot is bounded at2MB. Larger datasets remain
unsupported, never silently truncated. Port must refuse credentials/session tokens
and exclude audit/security material; sanitize export schema before returning it.

snapshot({grant,session}) returns that snapshot; remove({grant,session,snapshot})
must CAS the entire sourceRevision and remove the covered business resources in
the same transaction, returning {state:'REMOVED',sourceRevision}; restore must
reject collisions, restore all scoped resources atomically and return
{state:'RESTORED',digest:contentHash(snapshot)}. No write to foundation identities
or sessions: restore needs existing authorized tenant operator access. The owned
module stores restricted recovery evidence, audit/outbox and idempotency results.
Missing coverage or absent port stays unavailable. Real domain ports belong to
their owners/integration; no real user-data operation was performed here.

Delete requires SUSPENDED, the latest archive and unchanged source hash. It is
reversible archive deletion, NOT legal erasure. Restore requires matching digest
and returns SUSPENDED; explicit resume follows review. Retention/irreversible
erasure requires a separate authorized policy and is never automated here.
Download reauthorizes saas.export; archived data cannot be downloaded after delete.
Archive digest is integrity evidence, not encryption. Host must restrict Mongo
backup/access, enforce encrypted disk/transport and protect exported downloads.

UI uses inherited product tokens, pf-panel/pf-form/pf-table-wrap and labeled
controls to preserve the accepted workbench identity. ENERGY1/RHYTHM1/MOTION1:
subscription state is focal, panels group actual tasks, tables contain overflow,
typography/spacing/color/focus come from shared shell; no new assets or motion.
Source states/actions connected; keyboard-native controls, honest errors/empty/
loading and command recovery present. Rendered mobile/contrast/click-through and
real HTTP/Mongo/noisy-neighbor/recovery acceptance remain final QA TPR-150/152.
