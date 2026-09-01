
ALTER TABLE public.usernfc ADD COLUMN IF NOT EXISTS employee_category VARCHAR;
ALTER TABLE public.usernfc ADD COLUMN IF NOT EXISTS mode VARCHAR DEFAULT 'single';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS roles VARCHAR;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_sow_scheduling_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_nnva_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_set_sync_modified()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sync = 'modified';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.shift_definition (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shift_code             TEXT NOT NULL,
    shift_name             TEXT NOT NULL,
    effective_date         DATE,
    is_default             BOOLEAN NOT NULL DEFAULT true,
    start_time             TIME NOT NULL,
    end_time               TIME NOT NULL,
    crosses_midnight       BOOLEAN NOT NULL DEFAULT false,
    default_capacity_hours NUMERIC(10,2) NOT NULL DEFAULT 8,
    is_active              BOOLEAN NOT NULL DEFAULT true,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_shift_definition_updated_at ON shift_definition;
CREATE TRIGGER trg_shift_definition_updated_at
    BEFORE UPDATE ON shift_definition FOR EACH ROW EXECUTE FUNCTION set_sow_scheduling_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_definition_default_code
    ON shift_definition (lower(shift_code))
    WHERE is_default = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_definition_effective_date_code
    ON shift_definition (lower(shift_code), effective_date)
    WHERE is_default = false AND effective_date IS NOT NULL;

INSERT INTO shift_definition (shift_code, shift_name, is_default, start_time, end_time, default_capacity_hours)
SELECT 'SHIFT1', 'Shift 1', true, '07:00', '16:00', 8
WHERE NOT EXISTS (SELECT 1 FROM shift_definition WHERE shift_code = 'SHIFT1' AND is_default = true);
INSERT INTO shift_definition (shift_code, shift_name, is_default, start_time, end_time, default_capacity_hours)
SELECT 'SHIFT2', 'Shift 2', true, '16:00', '23:00', 7
WHERE NOT EXISTS (SELECT 1 FROM shift_definition WHERE shift_code = 'SHIFT2' AND is_default = true);

CREATE TABLE IF NOT EXISTS public.sow_machine_capacity (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    machine_code         TEXT NOT NULL,
    machine_name         TEXT,
    workcenter           TEXT,
    schedule_date        DATE NOT NULL,
    shift_id             BIGINT NOT NULL REFERENCES shift_definition(id) ON DELETE RESTRICT,
    capacity_type        TEXT NOT NULL DEFAULT 'STANDARD' CHECK (capacity_type IN ('STANDARD','MANPOWER_BASED','BATCH_BASED','CUSTOM')),
    base_capacity_hours  NUMERIC(10,2) NOT NULL DEFAULT 0,
    manpower_count       NUMERIC(10,2) NOT NULL DEFAULT 1,
    capacity_multiplier  NUMERIC(10,2) NOT NULL DEFAULT 1,
    total_capacity_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
    remarks              TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(machine_code, schedule_date, shift_id)
);
CREATE INDEX IF NOT EXISTS idx_sow_machine_capacity_lookup ON sow_machine_capacity(schedule_date, shift_id, machine_code) WHERE is_active = true;
DROP TRIGGER IF EXISTS trg_sow_machine_capacity_updated_at ON sow_machine_capacity;
CREATE TRIGGER trg_sow_machine_capacity_updated_at
    BEFORE UPDATE ON sow_machine_capacity FOR EACH ROW EXECUTE FUNCTION set_sow_scheduling_updated_at();

CREATE TABLE IF NOT EXISTS public.sow_schedule_batch (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_code           TEXT NOT NULL UNIQUE,
    machine_code         TEXT NOT NULL,
    workcenter           TEXT,
    schedule_date        DATE NOT NULL,
    shift_id             BIGINT REFERENCES shift_definition(id) ON DELETE SET NULL,
    batch_start_datetime TIMESTAMPTZ,
    batch_end_datetime   TIMESTAMPTZ,
    batch_capacity_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
    batch_status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (batch_status IN ('OPEN','PLANNED','RUNNING','COMPLETED','CANCELLED')),
    remarks              TEXT,
    created_by_user_id   INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sow_schedule_batch_updated_at ON sow_schedule_batch;
CREATE TRIGGER trg_sow_schedule_batch_updated_at
    BEFORE UPDATE ON sow_schedule_batch FOR EACH ROW EXECUTE FUNCTION set_sow_scheduling_updated_at();

CREATE TABLE IF NOT EXISTS public.sow_overtime_request (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sow_id                  INTEGER REFERENCES sow(idsow) ON DELETE SET NULL,
    production_order        TEXT,
    operation_no            INTEGER,
    sequence                INTEGER,
    ssbr_id                 TEXT,
    workcenter              TEXT,
    machine_code            TEXT NOT NULL,
    overtime_date           DATE NOT NULL,
    shift_id                BIGINT REFERENCES shift_definition(id) ON DELETE SET NULL,
    overtime_start_datetime TIMESTAMPTZ NOT NULL,
    overtime_end_datetime   TIMESTAMPTZ NOT NULL CHECK (overtime_end_datetime > overtime_start_datetime),
    overtime_hours          NUMERIC(10,2) NOT NULL CHECK (overtime_hours > 0),
    note                    TEXT,
    request_status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (request_status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    requested_by_user_id    INTEGER,
    requested_by_name       TEXT,
    approved_by_user_id     INTEGER,
    approved_by_name        TEXT,
    approved_at             TIMESTAMPTZ,
    rejected_by_user_id     INTEGER,
    rejected_by_name        TEXT,
    rejected_at             TIMESTAMPTZ,
    rejection_note          TEXT,
    warning_flag            BOOLEAN NOT NULL DEFAULT false,
    warning_message         TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_to             TEXT,
    assigned_by             TEXT,
    assigned_to_name        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sow_overtime_sow ON sow_overtime_request(sow_id, production_order, operation_no);
CREATE INDEX IF NOT EXISTS idx_sow_overtime_status ON sow_overtime_request(request_status, overtime_date, shift_id, machine_code);
DROP TRIGGER IF EXISTS trg_sow_overtime_request_updated_at ON sow_overtime_request;
CREATE TRIGGER trg_sow_overtime_request_updated_at
    BEFORE UPDATE ON sow_overtime_request FOR EACH ROW EXECUTE FUNCTION set_sow_scheduling_updated_at();

CREATE TABLE IF NOT EXISTS public.sow_schedule (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sow_id                 INTEGER REFERENCES sow(idsow) ON DELETE SET NULL,
    production_order       TEXT,
    operation_no           INTEGER,
    sequence               INTEGER,
    ssbr_id                TEXT,
    workcenter             TEXT,
    machine_code           TEXT,
    schedule_date          DATE NOT NULL,
    shift_id               BIGINT REFERENCES shift_definition(id) ON DELETE SET NULL,
    planned_start_datetime TIMESTAMPTZ,
    planned_end_datetime   TIMESTAMPTZ CHECK (planned_start_datetime IS NULL OR planned_end_datetime IS NULL OR planned_end_datetime > planned_start_datetime),
    planned_hours          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
    planned_queue_no       INTEGER,
    priority_no            INTEGER,
    schedule_status        TEXT NOT NULL DEFAULT 'PLANNED' CHECK (schedule_status IN ('PLANNED','UNPLANNED','PARTIAL','COMPLETED','CANCELLED')),
    schedule_source_type   TEXT NOT NULL DEFAULT 'SOW' CHECK (schedule_source_type IN ('SOW','MANUAL')),
    batch_id               BIGINT REFERENCES sow_schedule_batch(id) ON DELETE SET NULL,
    is_overtime            BOOLEAN NOT NULL DEFAULT false,
    overtime_request_id    BIGINT REFERENCES sow_overtime_request(id) ON DELETE SET NULL,
    warning_flag           BOOLEAN NOT NULL DEFAULT false,
    warning_message        TEXT,
    remarks                TEXT,
    created_by_user_id     INTEGER,
    created_by_name        TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sow_schedule_machine_shift ON sow_schedule(machine_code, schedule_date, shift_id, schedule_status);
CREATE INDEX IF NOT EXISTS idx_sow_schedule_sow ON sow_schedule(sow_id, production_order, operation_no);
CREATE INDEX IF NOT EXISTS idx_sow_schedule_window ON sow_schedule(planned_start_datetime, planned_end_datetime);
DROP TRIGGER IF EXISTS trg_sow_schedule_updated_at ON sow_schedule;
CREATE TRIGGER trg_sow_schedule_updated_at
    BEFORE UPDATE ON sow_schedule FOR EACH ROW EXECUTE FUNCTION set_sow_scheduling_updated_at();

CREATE TABLE IF NOT EXISTS public.sow_operationcard (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sow_standard_id INTEGER NOT NULL,
    card_key        VARCHAR(255),
    images          JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ref_id          INTEGER,
    ref_type        VARCHAR(20) DEFAULT 'standard',
    order_no        TEXT,
    operation_no    INTEGER,
    revision_no     TEXT NOT NULL DEFAULT 'Original',
    image_path      TEXT
);
CREATE INDEX IF NOT EXISTS idx_opcard_std_id ON sow_operationcard(sow_standard_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sow_operationcard_standard_revision ON sow_operationcard(sow_standard_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_sow_operationcard_order_operation_revision ON sow_operationcard(order_no, operation_no, revision_no);
DROP TRIGGER IF EXISTS trg_opcard_updated_at ON sow_operationcard;
CREATE TRIGGER trg_opcard_updated_at
    BEFORE UPDATE ON sow_operationcard FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.tts_notifications (
    id                 SERIAL PRIMARY KEY,
    order_no           TEXT NOT NULL UNIQUE,
    ssbr_id            TEXT,
    part_name          TEXT,
    total_planhours    NUMERIC(12,2) DEFAULT 0,
    total_actual_hours NUMERIC(12,2) DEFAULT 0,
    remaining_hours    NUMERIC(12,2) DEFAULT 0,
    status             TEXT DEFAULT 'pending',
    created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tts_notif_status ON tts_notifications(status);
CREATE INDEX IF NOT EXISTS idx_tts_notif_created ON tts_notifications(created_at DESC);
DROP TRIGGER IF EXISTS trg_tts_notif_updated ON tts_notifications;
CREATE TRIGGER trg_tts_notif_updated
    BEFORE UPDATE ON tts_notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS before_update_set_sync ON sow;
CREATE TRIGGER before_update_set_sync
    BEFORE UPDATE ON sow FOR EACH ROW EXECUTE FUNCTION trg_set_sync_modified();

DROP TRIGGER IF EXISTS update_operations_updated_at ON operations;
CREATE TRIGGER update_operations_updated_at
    BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_parts_updated_at ON parts;
CREATE TRIGGER update_parts_updated_at
    BEFORE UPDATE ON parts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_nnva_base_updated_at ON sow_nnva_base;
CREATE TRIGGER trg_nnva_base_updated_at
    BEFORE UPDATE ON sow_nnva_base FOR EACH ROW EXECUTE FUNCTION update_nnva_updated_at();

DROP TRIGGER IF EXISTS trg_nnva_standard_updated_at ON sow_nnva_standard;
CREATE TRIGGER trg_nnva_standard_updated_at
    BEFORE UPDATE ON sow_nnva_standard FOR EACH ROW EXECUTE FUNCTION update_nnva_updated_at();

DROP VIEW IF EXISTS vw_sow_orders;
CREATE VIEW vw_sow_orders AS
SELECT order_no,
       MIN(ssbr_id) AS ssbr_id,
       MIN(part_number) AS part_number,
       MIN(part_name) AS part_name,
       MIN(model) AS model,
       MIN(customer) AS customer,
       MIN(location) AS location,
       MIN(systemstatus) AS systemstatus,
       SUM(planhours) AS total_planhours,
       COUNT(*) AS operation_count,
       ROUND(AVG(progress) FILTER (WHERE progress IS NOT NULL), 1) AS avg_progress
FROM sow
GROUP BY order_no;

DROP MATERIALIZED VIEW IF EXISTS "order";
CREATE MATERIALIZED VIEW "order" AS
SELECT order_no,
       MIN(ssbr_id) AS ssbr_id,
       MIN(part_number) AS part_number,
       MIN(part_name) AS part_name,
       MIN(model) AS model,
       MIN(customer) AS customer,
       MIN(location) AS location,
       MIN(status) AS status,
       MIN("group") AS "group",
       MIN(systemstatus) AS systemstatus,
       SUM(planhours) AS planhours
FROM sow
GROUP BY order_no
WITH NO DATA;

CREATE OR REPLACE FUNCTION generate_remaining_hours_notifications()
RETURNS TABLE(notification_order_no TEXT, action TEXT) AS $$
BEGIN
    INSERT INTO tts_notifications
        (order_no, ssbr_id, part_name, total_planhours, total_actual_hours, remaining_hours, status)
    SELECT order_no, ssbr_id, part_name, total_planhours, total_actual_hours, remaining_hours, 'pending'
    FROM mv_order_remaining_hours
    WHERE is_exceeded = TRUE
    ON CONFLICT (order_no) DO UPDATE SET
        total_planhours = EXCLUDED.total_planhours,
        total_actual_hours = EXCLUDED.total_actual_hours,
        remaining_hours = EXCLUDED.remaining_hours,
        updated_at = CURRENT_TIMESTAMP;
    RETURN QUERY SELECT n.order_no, 'upserted'::TEXT
        FROM tts_notifications n WHERE n.updated_at > CURRENT_TIMESTAMP - INTERVAL '1 second';
END;
$$ LANGUAGE plpgsql;

