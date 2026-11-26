# Database

PostgreSQL schema and migrations for IEMS. Every structural change goes through a migration file, never a manual edit on a production database, and every migration batch is followed by a fresh schema dump.

## Layout

```
database/
  migrate.js              migration runner (CLI)
  migrations/
    api/                  ACTIVE migrations, the only folder the runner reads
    deferred/             migrations held back on purpose
    legacy/               migrations from before the runner existed, kept as history
  schema/
    schema_prod.sql       structure-only dump of production
```

## Migration runner (`migrate.js`)

A small runner with one dependency (`pg`):

1. Reads `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` from `.env` at the repository root.
2. Creates the ledger table `public.schema_migrations` (`filename`, `applied_at`, `note`) if it is missing.
3. Scans `database/migrations/api/*.sql`, sorts by filename and picks the files the ledger does not list yet.
4. Applies each file in its own transaction. Success is written to the ledger; failure rolls back.
5. Stops at the first failing file. Files that already succeeded are not repeated.

```bash
node database/migrate.js --dry-run   # list pending migrations, touch nothing
node database/migrate.js             # apply every pending migration
```

Example output:

```
ledger: 81 applied | folder: 84 files | pending: 3
  pending: 20260813_sow_draft.sql
  pending: 20260813_sow_saved.sql
  pending: 20260819_sap_config_rules.sql
apply 20260813_sow_draft.sql ... OK
apply 20260813_sow_saved.sql ... OK
apply 20260819_sap_config_rules.sql ... OK
```

The ledger is the source of truth. A file it lists is never applied again, even if its contents change, so a migration that reached production is never edited: a fix is a new file. The runner targets one database per run. Each plant has its own database, so a migration has to be applied to every plant, in an agreed order. When a plant skips a migration on purpose, write the reason in the ledger's `note` column.

## Writing a migration

| Rule | Detail |
|---|---|
| File name | `YYYYMMDD_description.sql`. Two files on the same day get a letter suffix (`20260804b_...`) |
| `BEGIN` / `COMMIT` | Do not write them. The runner wraps the transaction |
| Idempotent | Prefer `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` and `ON CONFLICT` so a re-run is safe |
| `CREATE INDEX CONCURRENTLY` | Cannot run in a transaction. Put `-- migrate:no-transaction` on the first line |
| After a batch | Regenerate `schema/schema_prod.sql` from production |

```sql
-- database/migrations/api/20260820_add_something.sql
ALTER TABLE public.some_table
  ADD COLUMN IF NOT EXISTS new_column text NOT NULL DEFAULT '';
```

```sql
-- migrate:no-transaction
CREATE INDEX CONCURRENTLY idx_some_table_col
  ON public.some_table (col);
```

Comments inside migrations are kept to decisions the SQL itself cannot explain.

## Deferred migrations

`migrations/deferred/` holds migrations that are not approved yet. The runner does not scan it, so nothing there runs by accident. To activate one, move it to `migrations/api/` and run the runner with `--dry-run` first. See [deferred/README.md](migrations/deferred/README.md) for the current files.

## Legacy migrations

`migrations/legacy/` holds migrations that ran before this runner existed, including the first plant's early schema. The runner ignores the folder. Read it to understand the history; do not apply it to a new database.

## Schema dump

`schema/schema_prod.sql` is a structure-only dump of production. Restore it, then run `node database/migrate.js` to build a new database. Regenerate it after every migration batch that reaches production:

```bash
docker exec timesheet-db pg_dump -U <user> -d <db> --schema-only \
  > database/schema/schema_prod.sql
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `FAILED: <error>` and the runner stops | The migration failed and was rolled back. Fix the file and run again; files that succeeded are not repeated |
| A file does not appear in `--dry-run` | Check that it is in `migrations/api/`, ends in `.sql`, and is not already in the ledger (`SELECT * FROM schema_migrations`) |
| Only some migrations should run | The runner cannot select single files. Apply by hand with `psql` and record it in the ledger yourself, or move the other files out first |
| `CREATE INDEX CONCURRENTLY` fails | Add `-- migrate:no-transaction` on the first line |
| The ledger is gone | The runner recreates `schema_migrations`, but the `applied_at` history cannot be recovered from files. Keep regular database backups |
