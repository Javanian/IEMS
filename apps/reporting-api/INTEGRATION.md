# Reporting integration contract

Implementation candidate only; independent acceptance after program integration. No migration has been applied. All eight IDs need final replay/parity/recovery/security/runtime QA. Reporting is never a second business ledger.

CTO registration delta: merge data branch with prerequisite ancestry intact. Add analyticsRoles/actions to the server role policy before foundation creation. Install `installAnalytics(app,runtime,{reportingBaseUrl})` after existing authenticated middleware and before 404/error handling. Mount AnalyticsWorkspace at `/portfolio/analytics`, gate navigation with analytics.read. Shared routing, root manifests, lockfiles and compose remain CTO-owned. Frontend uses production shared workspace components/tokens; English; ENERGY1/RHYTHM1/MOTION1; no new visual assets.

Run Python service with `PYTHONPATH=jobs/analytics:apps/reporting-api uvicorn server:create --factory --host 127.0.0.1 --port <owned-port>` (Windows path separator `;`). Explicit environment only: IEMS_AUTHORITY_URL fixed gateway `/api/analytics/authority`; IEMS_REPORTING_DSN dedicated projection DB; IEMS_ANALYTICS_PUBLISH_ROOT immutable publications. Never load application .env or reuse source DB credentials. HTTPS/mTLS private routing for non-loopback delivery is an environment gate. The gateway forwards the actual session cookie; Python rechecks authority with the gateway, accepts no caller-provided grant headers, and never authenticates from UUID query parameters. Gateway reauthorizes after downstream read and audits exports in a fresh effect transaction. No domain mutation endpoint exists.

Apply database/migrations/reporting/001_projection.sql only after separate target/migration authorization. Use non-superuser NOBYPASSRLS roles. Reader receives USAGE schema, SELECT heads/receipts/orders/order_quantities/payments/fulfillments/source_coverage and INSERT export_audit plus sequence usage. Grant permissions explicitly; migration revokes PUBLIC and creates no login/secret. Do not grant source schema access. Transaction-local tenant/plant context drives forced RLS; source authorization and gateway session grants are still mandatory.

Provision the projection writer with these exact table privileges (replace the role name with the separately approved reporting writer):

```sql
GRANT USAGE ON SCHEMA reporting TO reporting_writer;
GRANT SELECT, INSERT ON reporting.receipts, reporting.source_coverage,
 reporting.order_quantities TO reporting_writer;
GRANT SELECT, INSERT, UPDATE ON reporting.heads, reporting.orders,
 reporting.payments, reporting.fulfillments TO reporting_writer;
GRANT DELETE ON reporting.order_quantities TO reporting_writer;
```

The single DELETE grant is required by full-snapshot quantity replacement, including removing a UOM omitted by a later snapshot. `Projection.apply` deletes only the authorized tenant/plant/order's component quantities, then inserts the new quantities in the same advisory-locked transaction as the head, order and immutable receipt. A failed constraint or conservation check rolls the replacement back. Orders, payments and fulfillments use tombstones; receipts and coverage are append-only for this writer. No DELETE on those tables, TRUNCATE, schema ownership, CREATE, BYPASSRLS or source-ledger permission is required. Fresh reader roles receive no DELETE. Existing role privilege changes remain a separately approved provisioning action; this contract does not execute them.

Source consumer: construct Projection(connect,authorize_source). `connect` must connect only to the isolated reporting DB. `authorize_source(event,cursor)` must validate a current active service grant for the event tenant/plant in the effect transaction and return that verified scope. Then call `apply({event,receivedAt,availableAt})`; ack Kafka only after commit. HTTP server uses a deny-all source callback so it cannot ingest through user-facing routes. Version gaps/FK parent races require replay after prerequisite events; immutable type mapping and source snapshot payload contract are in analytics/READ-CONTRACT.md. No inferred mapping from unrelated legacy events is enabled. Domain owners must provide full authorized snapshot events for their verticals before source-to-report deployment.

PostgreSQL reads use scoped indexed joins and decimal strings. `Projection.orders(grant,explain=True)` returns EXPLAIN JSON without ANALYZE; final QA must capture actual isolated-target plans and ledger parity, not assume index usage. Inspect domain deletions/currency changes against FK children before accepting projection snapshots. Reporting migrations are scripts, not permission to migrate user DBs. No DB process or Docker service is left running by implementation.

Final QA runbook: validate isolated DB owner/host/name before DDL; apply migration in disposable reporting target; verify rollback of bad event/FK/provenance, duplicate/restart/unknown-commit replay and revocation. Compare source snapshot monetary/quantity totals by tenant/plant/currency/UOM against raw/dbt/PostgreSQL. Run dbt full refresh then incremental and compare normalized rows; failed contracts/freshness must leave no trusted publication. Airflow retries/backfill, real Kafka/Flink checkpoints and Spark/Iceberg snapshots/compaction need their actual runtimes. Test UI against API/database and export denial/CSV neutralization; no mock metric acceptance. Cloud MSK/S3/Redshift and Databricks need separately authorized credentials/budget/environment and are not delivered as live acceptance here.
