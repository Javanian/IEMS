# Native reporting remediation

QA-002: DuckDB 1.4.1 cannot plan the prior correlated LEFT JOIN inside NOT EXISTS. The coverage model now expands expected heads in a CTE, matches them against latest scoped heads, and groups missing matches before joining back to coverage. Cardinality and version/checksum matching remain required, including empty snapshots. No maintained assertion was replaced or relaxed.

Use a new isolated Python environment with `pip install -r jobs/analytics/requirements-native.txt`. From repository root, with its Scripts directory on PATH:

```text
python jobs/analytics/test_coverage.py
python jobs/analytics/probe.py <new-absolute-evidence-root> --project analytics/dbt
python jobs/analytics/native_gates.py <completed-probe-root> <new-gate-evidence-root>
```

The focused test executes the actual model SQL on native DuckDB: matching heads, missing identity, wrong version/hash, missing/extra heads, another tenant, superseded version, latest coverage selection and empty scope. The unchanged probe builds dbt initially/incrementally/from scratch, compares complete normalized marts, checks partial payment and mixed UOM fulfillment, and rejects corrupt raw evidence. The added native gate probe proves valid publication and independently fails coverage and monetary balance contracts; both failed builds must leave no trusted manifest. These adversarial failures are expected test results, not skipped dbt resources. Full integrated acceptance remains independent QA's responsibility.

QA-008 reproducer is `apps/reporting-api/native-postgres.py`; the exact minimal writer contract and rationale are in `apps/reporting-api/INTEGRATION.md`. The harness requires psycopg from that service's pinned requirements, the completed dbt evidence, the installed PostgreSQL bin path, and a NEW child of PAPERCLIP_RUN_SCRATCH_DIR. It accepts no external DSN. It verifies its run marker before connection and actual server data directory before DDL, starts a private random loopback port, and stops only that owned cluster in finally. Retain its logs/result outside transient run scratch before handoff. No production migration authorization follows from these commands.
