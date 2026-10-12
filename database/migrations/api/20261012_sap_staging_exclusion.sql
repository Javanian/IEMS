-- sap_staging_exclusion: source records an admin excluded from SAP posting.
-- Used by post_sap_staging.py (claim filter), the staging jobs and the SAP log API.
-- The table already exists in running databases; this file makes a fresh database
-- complete. Columns follow the queries in apps/api/controllers/dashboardController.js.

CREATE TABLE IF NOT EXISTS public.sap_staging_exclusion (
    source_system text        NOT NULL,
    source_row_id text        NOT NULL,
    excluded_by   text,
    note          text,
    excluded_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, source_row_id)
);
