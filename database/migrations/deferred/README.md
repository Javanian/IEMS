# Deferred migrations

`database/migrate.js` scans only `migrations/api/`, so nothing in this folder runs with `node database/migrate.js`. Files sit here on purpose until they are approved. To activate one, move it back to `../api/` and run the runner.

## `20260722_mch_transaction_no_overlap*.sql`: no-overlap constraint for machine intervals

This is the second layer of machine-interval normalization. The first layer (the `end_effective` column, the ETL recompute, and consumers reading `COALESCE(end_effective, enddatetime)`) has to be stable before this constraint goes on.

There are two files, in order. `no_overlap.sql` is the first version and is NOT deferrable: do not apply it on its own, because it makes the ETL fail at random. `no_overlap_deferrable.sql` is the fix: it drops the constraint and adds it again as `DEFERRABLE`. When the time comes, apply both in order, or replace them with a single deferrable file.
