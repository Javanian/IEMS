
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'timesheet_transaction'
      AND column_name = 'production_order'
  ) THEN
    RAISE NOTICE 'SKIP: Column production_order already renamed — STEP 1 renames will be skipped';
  ELSE
    RAISE NOTICE 'OK: Column production_order exists — safe to rename';
  END IF;
END $$;

SELECT 'date_checkin' AS column_name, date_checkin AS bad_value, tsnumber
FROM timesheet_transaction
WHERE date_checkin IS NOT NULL
  AND TRIM(date_checkin) != ''
  AND date_checkin !~ '^\d{2}/\d{2}/\d{4}$'
  AND date_checkin !~ '^\d{4}-\d{2}-\d{2}$'
UNION ALL
SELECT 'date_checkout', date_checkout, tsnumber
FROM timesheet_transaction
WHERE date_checkout IS NOT NULL
  AND TRIM(date_checkout) != ''
  AND date_checkout !~ '^\d{2}/\d{2}/\d{4}$'
  AND date_checkout !~ '^\d{4}-\d{2}-\d{2}$';

SELECT 'hour_checkin' AS column_name, hour_checkin AS bad_value, tsnumber
FROM timesheet_transaction
WHERE hour_checkin IS NOT NULL
  AND TRIM(hour_checkin) != ''
  AND hour_checkin !~ '^\d{2}:\d{2}(:\d{2})?$'
UNION ALL
SELECT 'hour_checkout', hour_checkout, tsnumber
FROM timesheet_transaction
WHERE hour_checkout IS NOT NULL
  AND TRIM(hour_checkout) != ''
  AND hour_checkout !~ '^\d{2}:\d{2}(:\d{2})?$';

SELECT tsnumber, planhours AS bad_planhours
FROM timesheet_transaction
WHERE planhours IS NOT NULL
  AND TRIM(planhours) != ''
  AND planhours !~ '^-?[0-9]+(\.[0-9]+)?$';

SELECT
    t.tsnumber,
    t.production_order,
    t.seq,
    'No matching sow row' AS issue
FROM timesheet_transaction t
WHERE NOT EXISTS (
    SELECT 1 FROM sow s
    WHERE s.order_no = t.production_order
      AND s.operation_no = t.seq
)
  AND t.production_order IS NOT NULL
  AND t.seq IS NOT NULL;

SELECT order_no, operation_no, COUNT(*) AS cnt
FROM sow
WHERE order_no IS NOT NULL AND operation_no IS NOT NULL
GROUP BY order_no, operation_no
HAVING COUNT(*) > 1
LIMIT 10;

SELECT DISTINCT t.workcentercode, 'No matching workcenter.workcenternew' AS issue
FROM timesheet_transaction t
WHERE t.workcentercode IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM workcenter w WHERE w.workcenternew = t.workcentercode
  );

SELECT u.snssb, u.workcenter, 'No matching workcenter.workcenternew' AS issue
FROM usernfc u
WHERE u.workcenter IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM workcenter w WHERE w.workcenternew = u.workcenter
  );

ALTER TABLE timesheet_transaction
    RENAME COLUMN production_order TO order_no;

ALTER TABLE timesheet_transaction
    RENAME COLUMN seq TO operation_no;

ALTER TABLE timesheet_transaction
    RENAME COLUMN ssbr_ident TO ssbr_id;

ALTER TABLE timesheet_transaction
    RENAME COLUMN operation_text TO operationtext;

ALTER TABLE timesheet_transaction
    RENAME CONSTRAINT timesheet_po_seq_unique TO timesheet_order_opno_unique;

ALTER INDEX IF EXISTS idx_ts_production_order RENAME TO idx_ts_order_no;

ALTER TABLE timesheet_transaction
    ALTER COLUMN date_checkin TYPE date
    USING CASE
        WHEN TRIM(date_checkin) ~ '^\d{2}/\d{2}/\d{4}$'
            THEN to_date(TRIM(date_checkin), 'DD/MM/YYYY')
        WHEN TRIM(date_checkin) ~ '^\d{4}-\d{2}-\d{2}$'
            THEN TRIM(date_checkin)::date
        ELSE NULL
    END;

ALTER TABLE timesheet_transaction
    ALTER COLUMN date_checkout TYPE date
    USING CASE
        WHEN TRIM(date_checkout) ~ '^\d{2}/\d{2}/\d{4}$'
            THEN to_date(TRIM(date_checkout), 'DD/MM/YYYY')
        WHEN TRIM(date_checkout) ~ '^\d{4}-\d{2}-\d{2}$'
            THEN TRIM(date_checkout)::date
        ELSE NULL
    END;

ALTER TABLE timesheet_transaction
    ALTER COLUMN hour_checkin TYPE time(0)
    USING NULLIF(TRIM(hour_checkin), '')::time;

ALTER TABLE timesheet_transaction
    ALTER COLUMN hour_checkout TYPE time(0)
    USING NULLIF(TRIM(hour_checkout), '')::time;

ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS full_name;
ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS part_name;
ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS workcenterdescription;
ALTER TABLE timesheet_transaction DROP COLUMN IF EXISTS planhours;

ALTER TABLE sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);

ALTER TABLE timesheet_transaction
    ADD CONSTRAINT fk_ts_sow
    FOREIGN KEY (order_no, operation_no)
    REFERENCES sow (order_no, operation_no)
    ON UPDATE CASCADE
    ON DELETE RESTRICT;

ALTER TABLE timesheet_transaction
    ADD CONSTRAINT fk_ts_workcenter
    FOREIGN KEY (workcentercode)
    REFERENCES workcenter (workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE usernfc
    ADD CONSTRAINT fk_usernfc_workcenter
    FOREIGN KEY (workcenter)
    REFERENCES workcenter (workcenternew)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'timesheet_transaction'
  AND table_schema = 'public'
ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'timesheet_transaction'::regclass
ORDER BY contype, conname;

COMMIT;

