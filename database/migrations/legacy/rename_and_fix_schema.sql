
BEGIN;

ALTER TABLE timesheet_transaction RENAME COLUMN seq TO operation_no;

ALTER TABLE timesheet_transaction RENAME COLUMN production_order TO order_no;

ALTER TABLE timesheet_transaction RENAME COLUMN ssbr_ident TO ssbr_id;

ALTER TABLE timesheet_transaction
    RENAME CONSTRAINT timesheet_po_seq_unique TO timesheet_order_opno_unique;

ALTER INDEX IF EXISTS idx_ts_production_order RENAME TO idx_ts_order_no;

ALTER TABLE sow RENAME COLUMN operationtext TO operation_text;

ALTER TABLE operations RENAME COLUMN opr_no TO operation_no;

ALTER TABLE operations RENAME COLUMN operationtext TO operation_text;

ALTER TABLE operations
    RENAME CONSTRAINT operations_part_id_opr_no_key TO operations_part_id_operation_no_key;

ALTER TABLE processcontroldata
    ALTER COLUMN operation_no TYPE integer
    USING NULLIF(TRIM(operation_no), '')::integer;

ALTER TABLE sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);

CREATE INDEX IF NOT EXISTS idx_ts_operation_no
    ON timesheet_transaction (operation_no);

CREATE INDEX IF NOT EXISTS idx_pcd_operation_no
    ON processcontroldata (operation_no);

COMMIT;

