# PLAT-035 cloud release boundary

Offline definitions extend the platform owner's ECS/local foundation. main.tf
defines a tenant role, prefix-restricted object access, encrypted/versioned private
S3 and a TLS-only policy. The Atlas submodule grants IAM-role access only to one
tenant database and one named cluster. It does not create a paid Atlas cluster.
No broad admin/any-database role or password is configured. Per-tenant databases
are an example isolation profile; application document-scope checks remain required.

Run `node infra/cloud/validate.mjs` for bounded source-contract checks.
Run `node infra/cloud/terraform-offline.mjs` with run-owned scratch and an installed
PLATFORM_TF_PROVIDER_MIRROR containing exact AWS6.33.0/Atlas1.40.0 to run fmt,
mirror-only init, validate and mocked-provider tests. Terraform1.11+ required.
Exit2 means NOT_RUN, exit1 failure, exit0 pass. No download, apply, state backend,
credential probe or cloud operation exists in the launcher. Fixtures use loopback
AWS endpoints and mocked Atlas; ordinary plan/apply is not an authorized command.
The offline workflow is syntax/synthetic CI only; no OIDC token grant or secrets.

release-contract.json defines the release/rollback gates. Actual CD remains
EXTERNAL_DEPENDENCY until approved spend, account/region, private network/TLS,
Atlas private endpoints, real secrets, reviewed plan digest, cost estimate,
immutable integrated app, final independent QA and rollback operator exist.
No auto-apply workflow or cloud connection is installed. Budget is null; no price
is invented. Supply an approved budget AND environment before requesting a live
release. State must be encrypted/access-controlled, never uploaded as CI output.

Rollback rehearsal: retain previous app digest/config and source database. Restore
to a separately owned environment, verify health/isolation/conservation/offsets,
then review before admission. Never destroy buckets, clusters or source data to
roll back. Monitor billing, backlog, errors, latency and restore evidence in the
actual environment; none is measured by static validation.

Documentation verified for implementation, not actual provider execution:
- [AWS IAM role6.33.0](https://github.com/hashicorp/terraform-provider-aws/blob/v6.33.0/website/docs/r/iam_role.html.markdown)
- [Atlas scoped IAM database user1.40.0](https://github.com/mongodb/terraform-provider-mongodbatlas/blob/v1.40.0/docs/resources/database_user.md)
- [S3 encryption6.33.0](https://github.com/hashicorp/terraform-provider-aws/blob/v6.33.0/website/docs/r/s3_bucket_server_side_encryption_configuration.html.markdown)
