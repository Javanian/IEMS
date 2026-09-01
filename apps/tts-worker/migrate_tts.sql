
BEGIN;

CREATE TABLE IF NOT EXISTS tts_notifications (
    id                  SERIAL PRIMARY KEY,
    order_no            TEXT NOT NULL,
    ssbr_id             TEXT,
    part_name           TEXT,
    total_planhours     NUMERIC(12,2) DEFAULT 0,
    total_actual_hours  NUMERIC(12,2) DEFAULT 0,
    remaining_hours     NUMERIC(12,2) DEFAULT 0,
    status              TEXT DEFAULT 'pending',
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_no)
);

CREATE INDEX IF NOT EXISTS idx_tts_notif_status ON tts_notifications(status);
CREATE INDEX IF NOT EXISTS idx_tts_notif_created ON tts_notifications(created_at DESC);

DROP TRIGGER IF EXISTS trg_tts_notif_updated ON tts_notifications;
CREATE TRIGGER trg_tts_notif_updated
    BEFORE UPDATE ON tts_notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP MATERIALIZED VIEW IF EXISTS mv_order_remaining_hours;
CREATE MATERIALIZED VIEW mv_order_remaining_hours AS
WITH valid_orders AS (

    SELECT DISTINCT order_no FROM sow
    EXCEPT
    SELECT LTRIM(order_no, '0') FROM ph3_order WHERE order_description ILIKE '%TECO%'
),
plan_hours AS (
    SELECT
        order_no,
        MIN(ssbr_id)   AS ssbr_id,
        MIN(part_name) AS part_name,
        COALESCE(SUM(planhours), 0) AS total_planhours
    FROM sow
    WHERE planhours IS NOT NULL
    GROUP BY order_no
),
actual_hours AS (
    SELECT
        order_no,
        COALESCE(SUM(duration), 0) AS total_actual_hours
    FROM timesheet_transaction
    WHERE state_flag != 5
      AND duration IS NOT NULL
    GROUP BY order_no
)
SELECT
    v.order_no,
    p.ssbr_id,
    p.part_name,
    p.total_planhours,
    a.total_actual_hours,
    p.total_planhours - a.total_actual_hours AS remaining_hours,
    (p.total_planhours - a.total_actual_hours) <= 0 AS is_exceeded
FROM valid_orders v
LEFT JOIN plan_hours p   ON p.order_no = v.order_no
LEFT JOIN actual_hours a ON a.order_no = v.order_no
WHERE p.total_planhours > 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_roh_order_no
    ON mv_order_remaining_hours (order_no);

CREATE OR REPLACE FUNCTION generate_remaining_hours_notifications()
RETURNS TABLE(notification_order_no TEXT, action TEXT) AS $$
BEGIN
    INSERT INTO tts_notifications
        (order_no, ssbr_id, part_name, total_planhours, total_actual_hours, remaining_hours, status)
    SELECT
        order_no, ssbr_id, part_name, total_planhours, total_actual_hours, remaining_hours, 'pending'
    FROM mv_order_remaining_hours
    WHERE is_exceeded = TRUE
    ON CONFLICT (order_no) DO UPDATE SET
        total_planhours    = EXCLUDED.total_planhours,
        total_actual_hours = EXCLUDED.total_actual_hours,
        remaining_hours    = EXCLUDED.remaining_hours,
        updated_at         = CURRENT_TIMESTAMP;

    RETURN QUERY
        SELECT n.order_no, 'upserted'::TEXT
        FROM tts_notifications n
        WHERE n.updated_at > CURRENT_TIMESTAMP - INTERVAL '1 second';
END;
$$ LANGUAGE plpgsql;

COMMIT;

