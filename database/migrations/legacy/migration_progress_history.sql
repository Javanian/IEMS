
CREATE TABLE IF NOT EXISTS progress_update_history (
    id                SERIAL PRIMARY KEY,
    operation_id      INTEGER      NOT NULL,
    order_no          VARCHAR(100),
    progress          INTEGER      NOT NULL CHECK (progress >= 1 AND progress <= 100),
    issue_description TEXT,
    image_path        VARCHAR(500),
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    created_by        VARCHAR(100)
);

DO $$
BEGIN

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'progress_update_history'
           AND column_name = 'image_data'
    ) THEN
        ALTER TABLE progress_update_history
            RENAME COLUMN image_data TO image_path;
        ALTER TABLE progress_update_history
            ALTER COLUMN image_path TYPE VARCHAR(500);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'progress_update_history'
           AND column_name = 'image_path'
    ) THEN
        ALTER TABLE progress_update_history
            ADD COLUMN image_path VARCHAR(500);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_puh_operation_id ON progress_update_history(operation_id);
CREATE INDEX IF NOT EXISTS idx_puh_created_at   ON progress_update_history(created_at DESC);

ALTER TABLE sow ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT NULL;

CREATE OR REPLACE VIEW public.vw_sow_orders AS
SELECT
    s.order_no,
    (ARRAY_AGG(s.idsow               ORDER BY s.operation_no))[1] AS idsow,
    (ARRAY_AGG(s.ssbr_id             ORDER BY s.operation_no))[1] AS ssbr_id,
    (ARRAY_AGG(s.part_number         ORDER BY s.operation_no))[1] AS part_number,
    (ARRAY_AGG(s.part_name           ORDER BY s.operation_no))[1] AS part_name,
    (ARRAY_AGG(s.model               ORDER BY s.operation_no))[1] AS model,
    (ARRAY_AGG(s.customer            ORDER BY s.operation_no))[1] AS customer,
    (ARRAY_AGG(s.location            ORDER BY s.operation_no))[1] AS location,
    (ARRAY_AGG(s.type                ORDER BY s.operation_no))[1] AS type,
    (ARRAY_AGG(s."group"             ORDER BY s.operation_no))[1] AS "group",
    (ARRAY_AGG(s.category            ORDER BY s.operation_no))[1] AS category,
    (ARRAY_AGG(s.status              ORDER BY s.operation_no))[1] AS status,
    (ARRAY_AGG(s.systemstatus        ORDER BY s.operation_no))[1] AS systemstatus,
    (ARRAY_AGG(s.confirmation        ORDER BY s.operation_no))[1] AS confirmation,
    (ARRAY_AGG(s.created_by          ORDER BY s.operation_no))[1] AS created_by,
    COUNT(*)                                                        AS operation_count,
    COALESCE(SUM(s.planhours), 0)                                  AS total_planhours,
    ROUND(
        AVG(
            CASE
                WHEN s.planhours IS NOT NULL
                 AND s.planhours::NUMERIC != 0
                 AND (s.workcenter IS NULL OR s.workcenter NOT ILIKE '%OT%')
                THEN s.progress
            END
        )::NUMERIC,
    1)                                                              AS avg_progress
FROM public.sow s
GROUP BY s.order_no;

