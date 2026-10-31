# PLAT-038 local receipts and atomic document publication (v8)

A commit55ec65d adds exactly three actor-scoped namespaces and13 local commands.
commandKey is optional before enrollment and required afterwards. Preserve one
key with the same original body on retry. Typed quote/existing owner receipts
retain their original identities. Older unkeyed forms cannot mutate enrolled
tenants; shared UI/client command-key support remains an explicit local gap.

B prepares unchanged PDF bytes without durable business writes, then rechecks
source/authority in the caller transaction. Existing six-field documentIssues
identity/contentHash governs admission. Artifact, renderer receipt, direct READY
intent, document audit/outbox and usage/audit/outbox commit together. Public
intent ID and renderer ID remain distinct. Valid replay validates artifact/source
and current authority, returns the original publication and charges zero across
actors. Caller session must be active and belong to the same client/database.
Standalone issue/read remain compatible for unenrolled callers; omitted admission
rejects enrolled tenants and contends on enrollment. PREPARED/partial/corrupt/
orphan history fails closed without migration, deletion or resealing. Healthy
READY history can enroll after bounded1000-record integrity verification.

A combined52/52 Mongo PASS; B initial8/8 PASS. Fault checks cover all eight write
boundaries and source changes after render. Initial B3 fixture failures were
absent collMod collection, username location and revoked HTTP401; corrected
fixtures only, original failure log retained. Public renderer types PASS in
renderer package cwd; root-cwd ambient Node-type resolution failed and is retained.
Occasional owned Mongo teardown ECONNRESET on exit0 remains recorded. Final
combined result and exact SHA are in Paperclip implementation-result/evidence.

V6 LOCAL-GAPS proposals A/B are superseded by approved v8. Remaining local
coverage: private customer-service/automation receipt/principal/worker contracts,
public jobs ingress and command-aware shared UI callers. Existing private receipts
are not mislabeled nonreceipted/external. External vector/vendor delivery and
history quiescence remain unsupported. Full endpoint/PLAT-038 completeness and
independent QA are not claimed; fullQA/cloud/live NOT_RUN.

V9 next: adopt142 committed78e0ce89, preserve its domain/source/UI hunks, change
only named receipt replay hooks, regenerate reviewed actual schemas/routes/pins,
and hand usable SHA to142. Full E02 accepted/rejected runner belongs to142;
final integration149 and independent150/152 remain downstream.

Final v8 focused60/60 PASS exit0, no skipped/cancelled; log v8-B-final-focused.log. API syntax and renderer public/additive type fixtures PASS. Full independent QA NOT_RUN.
