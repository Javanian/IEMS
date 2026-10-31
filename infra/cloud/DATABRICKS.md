# PLAT-039 optional portability evaluation: PLANNED

No budget, workspace, authorized job or real data parity evidence is supplied.
Databricks is optional and remains PLANNED. evaluationManifest pins tenant/plant,
source manifest hash and explicit catalog/schema/table identifiers. It never
submits a job, creates compute, connects a workspace or claims cloud acceptance.
evaluateExport compares bounded exported envelopes with the same exact hash/scope
rules used by the AWS adapter. Even MATCH is only LOCAL_SYNTHETIC; no job/cost is
inferred from caller-provided metadata.

To evaluate later: approve a budget and existing workspace/compute policy; obtain
an authorized immutable source dataset; adapt the data owner's Spark/Iceberg job
to the approved catalog and tenant-scoped storage; record actual job/run/runtime,
input/output hashes, denied cross-tenant access, row conservation, decimal/UOM/
currency parity and measured cost. Compare with the existing local/cloud path.
Record failures and cleanup/rollback owner. Real evaluation needs explicit spend
authorization; this manifest or a local test is not that authorization.
