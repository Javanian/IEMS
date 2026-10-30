# Analytics scheduling

Airflow 3.1 worker imports jobs/analytics via PYTHONPATH. Mount private operator-selected input/publication roots, analytics/dbt, private profiles and dbt-duckdb. Environment: IEMS_ANALYTICS_INPUT_ROOT, IEMS_ANALYTICS_PUBLISH_ROOT, IEMS_DBT_PROJECT, IEMS_DBT_PROFILES. Each UTC interval-end filename YYYYmmddTHHMMSSZ.json holds a complete ordered raw manifest chain relative to input root. Never select files from request payloads. Backfill uses explicit data intervals with operator-reviewed selections; manual logical_date alone does not define a data interval.

max_active_runs=1 serializes publication. Retries reuse interval identity; changed input for an already trusted interval fails instead of rewriting history. Each attempt records source hashes, interval, status and dbt diagnostics. Timeout/nonzero/test failure never creates a trusted dataset. Readers verify database+publication hash and ignore failed/candidate directories. Corrupt/partial trusted JSON fails closed; retain evidence and use a new versioned run ID after operator reconciliation, never delete and auto-retry.

Do not run a second local writer on an Airflow-owned publication root. No automatic source evidence deletion. Local DuckDB remains single writer. Final QA must exercise scheduler retries, interrupted dbt and backfill publication; syntax is not scheduler acceptance.
