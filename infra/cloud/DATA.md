# PLAT-036 MSK/S3/Glue/Redshift offline profile

data.tf adds IAM-authenticated MSK Serverless, tenant-topic/group ACLs, private
security-group ingress from one application group, a tenant Glue JSON catalog and
private encrypted Redshift Serverless namespace/workgroup with bounded capacity,
SSL and query duration. Namespace and bucket destruction are guarded. All AWS
service endpoints remain loopback. Supplied subnet/SG/VPC IDs are synthetic,
not evidence of an environment or valid AZ placement. No cloud is provisioned.

data-layout.mjs is the offline compatibility adapter: it maps a scoped canonical
payload to an immutable tenant/plant/event/hash S3 key, MSK IAM/TLS topic/group,
Glue envelope and warehouse namespace. Decimal strings remain intact inside
payload_json. It does not convert raw generic events into reporting snapshots.
The data owner still validates v2 source receipts/coverage through existing
packages/domain-events and Kafka/lake jobs. A bounded <=1000-row parity function
compares stable scoped IDs and payload hashes; no cloud lineage/cost is invented.

Integration delta: configure producer and consumer for the exact per-tenant topic
instead of the local shared v2 topic; precreate topics with a separately approved
admin identity. Runtime cannot create topics, alter cluster or administer IAM.
Write the exact S3 envelope from dataLayout, not the raw payload. Catalog schema
and object serializer must stay paired. Do not point existing raw JSON jobs at
this envelope without adopting payload_json explicitly. Redshift ingestion/RLS/
grants/parity remain data-owner provisioning and final environment validation;
the runtime role has no Redshift admin/Data API grant. No SQL is applied here.

Actual endpoints, three private AZs, private routing/DNS/egress, service-linked
roles, Atlas private access, IAM SDK signer, application reader/writer grants,
retention approval, cost estimate/budget and rollback test are EXTERNAL_DEPENDENCY.
Bounded capacity is not a cost guarantee. No S3 auto-expiry or destructive
retention is enabled. Measure actual MSK bytes, S3 requests/storage, Glue usage,
Redshift RPU time and data parity after a separately authorized deployment.

Pinned official resource references inspected:
- [MSK Serverless](https://github.com/hashicorp/terraform-provider-aws/blob/v6.33.0/website/docs/r/msk_serverless_cluster.html.markdown)
- [Redshift namespace](https://github.com/hashicorp/terraform-provider-aws/blob/v6.33.0/website/docs/r/redshiftserverless_namespace.html.markdown)
- [Redshift workgroup](https://github.com/hashicorp/terraform-provider-aws/blob/v6.33.0/website/docs/r/redshiftserverless_workgroup.html.markdown)
