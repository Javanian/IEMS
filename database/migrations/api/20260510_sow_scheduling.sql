BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_definition (
  id bigserial PRIMARY KEY,
  shift_code text NOT NULL UNIQUE,
  shift_name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  default_capacity_hours numeric(10,2) NOT NULL DEFAULT 8,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.shift_definition (
  shift_code,
  shift_name,
  start_time,
  end_time,
  crosses_midnight,
  default_capacity_hours
)
VALUES
  ('SHIFT-1', 'Shift 1', '08:00'::time, '17:00'::time, false, 8),
  ('SHIFT-2', 'Shift 2', '20:00'::time, '04:00'::time, true, 8)
ON CONFLICT (shift_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sow_schedule_batch (
  id bigserial PRIMARY KEY,
  batch_code text NOT NULL UNIQUE,
  machine_code text NOT NULL,
  workcenter text,
  schedule_date date NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE SET NULL,
  batch_start_datetime timestamptz,
  batch_end_datetime timestamptz,
  batch_capacity_hours numeric(10,2) NOT NULL DEFAULT 0,
  batch_status text NOT NULL DEFAULT 'OPEN'
    CHECK (batch_status IN ('OPEN', 'PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  remarks text,
  created_by_user_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sow_machine_capacity (
  id bigserial PRIMARY KEY,
  machine_code text NOT NULL,
  machine_name text,
  workcenter text,
  schedule_date date NOT NULL,
  shift_id bigint NOT NULL REFERENCES public.shift_definition(id) ON DELETE RESTRICT,
  capacity_type text NOT NULL DEFAULT 'STANDARD'
    CHECK (capacity_type IN ('STANDARD', 'MANPOWER_BASED', 'BATCH_BASED', 'CUSTOM')),
  base_capacity_hours numeric(10,2) NOT NULL DEFAULT 0,
  manpower_count numeric(10,2) NOT NULL DEFAULT 1,
  capacity_multiplier numeric(10,2) NOT NULL DEFAULT 1,
  total_capacity_hours numeric(10,2) NOT NULL DEFAULT 0,
  remarks text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_code, schedule_date, shift_id)
);

CREATE TABLE IF NOT EXISTS public.sow_overtime_request (
  id bigserial PRIMARY KEY,
  sow_id integer REFERENCES public.sow(idsow) ON DELETE SET NULL,
  production_order text,
  operation_no integer,
  sequence integer,
  ssbr_id text,
  workcenter text,
  machine_code text NOT NULL,
  overtime_date date NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE SET NULL,
  overtime_start_datetime timestamptz NOT NULL,
  overtime_end_datetime timestamptz NOT NULL,
  overtime_hours numeric(10,2) NOT NULL,
  note text,
  request_status text NOT NULL DEFAULT 'PENDING'
    CHECK (request_status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by_user_id integer,
  requested_by_name text,
  approved_by_user_id integer,
  approved_by_name text,
  approved_at timestamptz,
  rejected_by_user_id integer,
  rejected_by_name text,
  rejected_at timestamptz,
  rejection_note text,
  warning_flag boolean NOT NULL DEFAULT false,
  warning_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (overtime_end_datetime > overtime_start_datetime),
  CHECK (overtime_hours > 0)
);

CREATE TABLE IF NOT EXISTS public.sow_schedule (
  id bigserial PRIMARY KEY,
  sow_id integer REFERENCES public.sow(idsow) ON DELETE SET NULL,
  production_order text,
  operation_no integer,
  sequence integer,
  ssbr_id text,
  workcenter text,
  machine_code text,
  schedule_date date NOT NULL,
  shift_id bigint REFERENCES public.shift_definition(id) ON DELETE SET NULL,
  planned_start_datetime timestamptz,
  planned_end_datetime timestamptz,
  planned_hours numeric(10,2) NOT NULL DEFAULT 0,
  planned_queue_no integer,
  priority_no integer,
  schedule_status text NOT NULL DEFAULT 'PLANNED'
    CHECK (schedule_status IN ('PLANNED', 'UNPLANNED', 'PARTIAL', 'COMPLETED', 'CANCELLED')),
  schedule_source_type text NOT NULL DEFAULT 'SOW'
    CHECK (schedule_source_type IN ('SOW', 'MANUAL')),
  batch_id bigint REFERENCES public.sow_schedule_batch(id) ON DELETE SET NULL,
  is_overtime boolean NOT NULL DEFAULT false,
  overtime_request_id bigint REFERENCES public.sow_overtime_request(id) ON DELETE SET NULL,
  warning_flag boolean NOT NULL DEFAULT false,
  warning_message text,
  remarks text,
  created_by_user_id integer,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_hours >= 0),
  CHECK (
    planned_start_datetime IS NULL
    OR planned_end_datetime IS NULL
    OR planned_end_datetime > planned_start_datetime
  )
);

CREATE INDEX IF NOT EXISTS idx_sow_schedule_machine_shift
  ON public.sow_schedule (machine_code, schedule_date, shift_id, schedule_status);

CREATE INDEX IF NOT EXISTS idx_sow_schedule_sow
  ON public.sow_schedule (sow_id, production_order, operation_no);

CREATE INDEX IF NOT EXISTS idx_sow_schedule_window
  ON public.sow_schedule (planned_start_datetime, planned_end_datetime);

CREATE INDEX IF NOT EXISTS idx_sow_overtime_status
  ON public.sow_overtime_request (request_status, overtime_date, shift_id, machine_code);

CREATE INDEX IF NOT EXISTS idx_sow_overtime_sow
  ON public.sow_overtime_request (sow_id, production_order, operation_no);

CREATE INDEX IF NOT EXISTS idx_sow_machine_capacity_lookup
  ON public.sow_machine_capacity (schedule_date, shift_id, machine_code)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.set_sow_scheduling_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_definition_updated_at ON public.shift_definition;
CREATE TRIGGER trg_shift_definition_updated_at
BEFORE UPDATE ON public.shift_definition
FOR EACH ROW EXECUTE FUNCTION public.set_sow_scheduling_updated_at();

DROP TRIGGER IF EXISTS trg_sow_schedule_batch_updated_at ON public.sow_schedule_batch;
CREATE TRIGGER trg_sow_schedule_batch_updated_at
BEFORE UPDATE ON public.sow_schedule_batch
FOR EACH ROW EXECUTE FUNCTION public.set_sow_scheduling_updated_at();

DROP TRIGGER IF EXISTS trg_sow_machine_capacity_updated_at ON public.sow_machine_capacity;
CREATE TRIGGER trg_sow_machine_capacity_updated_at
BEFORE UPDATE ON public.sow_machine_capacity
FOR EACH ROW EXECUTE FUNCTION public.set_sow_scheduling_updated_at();

DROP TRIGGER IF EXISTS trg_sow_overtime_request_updated_at ON public.sow_overtime_request;
CREATE TRIGGER trg_sow_overtime_request_updated_at
BEFORE UPDATE ON public.sow_overtime_request
FOR EACH ROW EXECUTE FUNCTION public.set_sow_scheduling_updated_at();

DROP TRIGGER IF EXISTS trg_sow_schedule_updated_at ON public.sow_schedule;
CREATE TRIGGER trg_sow_schedule_updated_at
BEFORE UPDATE ON public.sow_schedule
FOR EACH ROW EXECUTE FUNCTION public.set_sow_scheduling_updated_at();

CREATE OR REPLACE VIEW public.vw_sow_schedule_capacity AS
WITH schedule_usage AS (
  SELECT
    schedule_date,
    shift_id,
    machine_code,
    COALESCE(NULLIF(workcenter, ''), machine_code) AS workcenter,
    SUM(planned_hours) FILTER (
      WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
        AND is_overtime = false
    ) AS used_normal_planned_hours,
    SUM(planned_hours) FILTER (WHERE schedule_status = 'UNPLANNED') AS unplanned_hours
  FROM public.sow_schedule
  WHERE schedule_status <> 'CANCELLED'
  GROUP BY schedule_date, shift_id, machine_code, COALESCE(NULLIF(workcenter, ''), machine_code)
),
overtime_usage AS (
  SELECT
    overtime_date AS schedule_date,
    shift_id,
    machine_code,
    COALESCE(NULLIF(workcenter, ''), machine_code) AS workcenter,
    SUM(overtime_hours) FILTER (WHERE request_status = 'PENDING') AS pending_overtime_hours,
    SUM(overtime_hours) FILTER (WHERE request_status = 'APPROVED') AS approved_overtime_hours
  FROM public.sow_overtime_request
  WHERE request_status <> 'CANCELLED'
  GROUP BY overtime_date, shift_id, machine_code, COALESCE(NULLIF(workcenter, ''), machine_code)
),
report_keys AS (
  SELECT schedule_date, shift_id, machine_code, COALESCE(NULLIF(workcenter, ''), machine_code) AS workcenter
  FROM public.sow_machine_capacity
  WHERE is_active = true
  UNION
  SELECT schedule_date, shift_id, machine_code, workcenter
  FROM schedule_usage
  UNION
  SELECT schedule_date, shift_id, machine_code, workcenter
  FROM overtime_usage
)
SELECT
  k.schedule_date,
  k.shift_id,
  sd.shift_code,
  sd.shift_name,
  k.machine_code,
  k.workcenter,
  COALESCE(cap.capacity_type, 'STANDARD') AS capacity_type,
  COALESCE(NULLIF(cap.total_capacity_hours, 0), sd.default_capacity_hours, 0)::numeric(10,2) AS total_capacity_hours,
  COALESCE(su.used_normal_planned_hours, 0)::numeric(10,2) AS used_normal_planned_hours,
  GREATEST(
    COALESCE(NULLIF(cap.total_capacity_hours, 0), sd.default_capacity_hours, 0)
    - COALESCE(su.used_normal_planned_hours, 0),
    0
  )::numeric(10,2) AS remaining_capacity_hours,
  COALESCE(su.unplanned_hours, 0)::numeric(10,2) AS unplanned_hours,
  COALESCE(ou.pending_overtime_hours, 0)::numeric(10,2) AS pending_overtime_hours,
  COALESCE(ou.approved_overtime_hours, 0)::numeric(10,2) AS approved_overtime_hours
FROM report_keys k
JOIN public.shift_definition sd ON sd.id = k.shift_id
LEFT JOIN public.sow_machine_capacity cap
  ON cap.schedule_date = k.schedule_date
 AND cap.shift_id = k.shift_id
 AND cap.machine_code = k.machine_code
 AND cap.is_active = true
LEFT JOIN schedule_usage su
  ON su.schedule_date = k.schedule_date
 AND su.shift_id = k.shift_id
 AND su.machine_code = k.machine_code
 AND su.workcenter = k.workcenter
LEFT JOIN overtime_usage ou
  ON ou.schedule_date = k.schedule_date
 AND ou.shift_id = k.shift_id
 AND ou.machine_code = k.machine_code
 AND ou.workcenter = k.workcenter;

CREATE OR REPLACE VIEW public.vw_sow_plan_vs_actual_hours AS
WITH schedule_base AS (
  SELECT
    sc.*,
    wc.workcenternew,
    wc.workcenterold,
    wc.workcenterot
  FROM public.sow_schedule sc
  LEFT JOIN public.workcenter wc ON wc.machineid = sc.machine_code
  WHERE sc.schedule_status <> 'CANCELLED'
),
normal_plan AS (
  SELECT
    schedule_date,
    shift_id,
    machine_code,
    COALESCE(NULLIF(workcenter, ''), machine_code) AS workcenter,
    production_order,
    operation_no,
    SUM(planned_hours) FILTER (WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED') AND is_overtime = false) AS normal_planned_hours,
    SUM(planned_hours) FILTER (WHERE schedule_status = 'UNPLANNED') AS unplanned_hours
  FROM schedule_base
  GROUP BY schedule_date, shift_id, machine_code, COALESCE(NULLIF(workcenter, ''), machine_code), production_order, operation_no
),
overtime_plan AS (
  SELECT
    overtime_date AS schedule_date,
    shift_id,
    machine_code,
    COALESCE(NULLIF(workcenter, ''), machine_code) AS workcenter,
    production_order,
    operation_no,
    SUM(overtime_hours) FILTER (WHERE request_status = 'PENDING') AS overtime_pending_hours,
    SUM(overtime_hours) FILTER (WHERE request_status = 'APPROVED') AS overtime_approved_hours,
    MAX(approved_by_name) FILTER (WHERE request_status = 'APPROVED') AS approved_by,
    MAX(approved_at) FILTER (WHERE request_status = 'APPROVED') AS approved_at
  FROM public.sow_overtime_request
  WHERE request_status <> 'CANCELLED'
  GROUP BY overtime_date, shift_id, machine_code, COALESCE(NULLIF(workcenter, ''), machine_code), production_order, operation_no
),
actual_matched AS (
  SELECT
    sb.schedule_date,
    sb.shift_id,
    sb.machine_code,
    COALESCE(NULLIF(sb.workcenter, ''), sb.machine_code) AS workcenter,
    sb.production_order,
    sb.operation_no,
    SUM(
      COALESCE(
        tt.duration,
        EXTRACT(EPOCH FROM (COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)) / 3600
      )
    ) AS actual_hours
  FROM schedule_base sb
  JOIN public.timesheet_transaction tt
    ON ltrim(COALESCE(tt.order_no, ''), '0') = ltrim(COALESCE(sb.production_order, ''), '0')
   AND tt.operation_no = sb.operation_no
   AND tt.longdate_checkin >= sb.planned_start_datetime
   AND tt.longdate_checkin < sb.planned_end_datetime
  WHERE sb.planned_start_datetime IS NOT NULL
    AND sb.planned_end_datetime IS NOT NULL
    AND tt.longdate_checkin IS NOT NULL
    AND tt.activitytype IS NULL
  GROUP BY sb.schedule_date, sb.shift_id, sb.machine_code, COALESCE(NULLIF(sb.workcenter, ''), sb.machine_code), sb.production_order, sb.operation_no
),
actual_unplanned AS (
  SELECT
    tt.longdate_checkin::date AS schedule_date,
    NULL::bigint AS shift_id,
    COALESCE(wc.machineid, tt.workcentercode) AS machine_code,
    COALESCE(tt.workcentercode, wc.machineid) AS workcenter,
    tt.order_no AS production_order,
    tt.operation_no,
    SUM(
      COALESCE(
        tt.duration,
        EXTRACT(EPOCH FROM (COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)) / 3600
      )
    ) AS actual_hours
  FROM public.timesheet_transaction tt
  LEFT JOIN LATERAL (
    SELECT w.machineid
    FROM public.workcenter w
    WHERE tt.workcentercode IN (w.workcenternew, w.workcenterold, w.workcenterot, w.machineid)
    ORDER BY w.position NULLS LAST, w.machineid
    LIMIT 1
  ) wc ON true
  WHERE tt.longdate_checkin IS NOT NULL
    AND tt.activitytype IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM schedule_base sb
      WHERE ltrim(COALESCE(tt.order_no, ''), '0') = ltrim(COALESCE(sb.production_order, ''), '0')
        AND tt.operation_no = sb.operation_no
        AND tt.longdate_checkin >= sb.planned_start_datetime
        AND tt.longdate_checkin < sb.planned_end_datetime
    )
  GROUP BY tt.longdate_checkin::date, COALESCE(wc.machineid, tt.workcentercode), COALESCE(tt.workcentercode, wc.machineid), tt.order_no, tt.operation_no
),
report_keys AS (
  SELECT schedule_date, shift_id, machine_code, workcenter, production_order, operation_no FROM normal_plan
  UNION
  SELECT schedule_date, shift_id, machine_code, workcenter, production_order, operation_no FROM overtime_plan
  UNION
  SELECT schedule_date, shift_id, machine_code, workcenter, production_order, operation_no FROM actual_matched
  UNION
  SELECT schedule_date, shift_id, machine_code, workcenter, production_order, operation_no FROM actual_unplanned
)
SELECT
  k.schedule_date,
  k.shift_id,
  sd.shift_code,
  sd.shift_name,
  k.machine_code,
  k.workcenter,
  k.production_order,
  k.operation_no,
  COALESCE(np.normal_planned_hours, 0)::numeric(10,2) AS normal_planned_hours,
  COALESCE(np.unplanned_hours, 0)::numeric(10,2) AS unplanned_hours,
  COALESCE(op.overtime_pending_hours, 0)::numeric(10,2) AS overtime_pending_hours,
  COALESCE(op.overtime_approved_hours, 0)::numeric(10,2) AS overtime_approved_hours,
  (COALESCE(np.normal_planned_hours, 0) + COALESCE(op.overtime_approved_hours, 0))::numeric(10,2) AS total_approved_planned_hours,
  (COALESCE(am.actual_hours, 0) + COALESCE(au.actual_hours, 0))::numeric(10,2) AS actual_hours,
  (
    COALESCE(am.actual_hours, 0)
    + COALESCE(au.actual_hours, 0)
    - COALESCE(np.normal_planned_hours, 0)
    - COALESCE(op.overtime_approved_hours, 0)
  )::numeric(10,2) AS variance_hours,
  CASE
    WHEN COALESCE(np.normal_planned_hours, 0) = 0 AND COALESCE(au.actual_hours, 0) > 0 THEN 'UNPLANNED_ACTUAL'
    WHEN COALESCE(np.unplanned_hours, 0) > 0 THEN 'PARTIAL'
    WHEN COALESCE(np.normal_planned_hours, 0) > 0 THEN 'PLANNED'
    ELSE 'NO_PLAN'
  END AS planned_status,
  CASE
    WHEN COALESCE(op.overtime_pending_hours, 0) > 0 THEN 'PENDING'
    WHEN COALESCE(op.overtime_approved_hours, 0) > 0 THEN 'APPROVED'
    ELSE 'NONE'
  END AS overtime_status,
  op.approved_by,
  op.approved_at
FROM report_keys k
LEFT JOIN public.shift_definition sd ON sd.id = k.shift_id
LEFT JOIN normal_plan np
  ON np.schedule_date = k.schedule_date
 AND np.shift_id IS NOT DISTINCT FROM k.shift_id
 AND np.machine_code IS NOT DISTINCT FROM k.machine_code
 AND np.workcenter IS NOT DISTINCT FROM k.workcenter
 AND np.production_order IS NOT DISTINCT FROM k.production_order
 AND np.operation_no IS NOT DISTINCT FROM k.operation_no
LEFT JOIN overtime_plan op
  ON op.schedule_date = k.schedule_date
 AND op.shift_id IS NOT DISTINCT FROM k.shift_id
 AND op.machine_code IS NOT DISTINCT FROM k.machine_code
 AND op.workcenter IS NOT DISTINCT FROM k.workcenter
 AND op.production_order IS NOT DISTINCT FROM k.production_order
 AND op.operation_no IS NOT DISTINCT FROM k.operation_no
LEFT JOIN actual_matched am
  ON am.schedule_date = k.schedule_date
 AND am.shift_id IS NOT DISTINCT FROM k.shift_id
 AND am.machine_code IS NOT DISTINCT FROM k.machine_code
 AND am.workcenter IS NOT DISTINCT FROM k.workcenter
 AND am.production_order IS NOT DISTINCT FROM k.production_order
 AND am.operation_no IS NOT DISTINCT FROM k.operation_no
LEFT JOIN actual_unplanned au
  ON au.schedule_date = k.schedule_date
 AND au.shift_id IS NOT DISTINCT FROM k.shift_id
 AND au.machine_code IS NOT DISTINCT FROM k.machine_code
 AND au.workcenter IS NOT DISTINCT FROM k.workcenter
 AND au.production_order IS NOT DISTINCT FROM k.production_order
 AND au.operation_no IS NOT DISTINCT FROM k.operation_no;

CREATE OR REPLACE VIEW public.vw_sow_planned_queue_vs_actual_queue AS
WITH planned AS (
  SELECT
    sc.*,
    sd.shift_code,
    sd.shift_name,
    ROW_NUMBER() OVER (
      PARTITION BY sc.machine_code, sc.schedule_date, sc.shift_id
      ORDER BY sc.planned_queue_no NULLS LAST, sc.planned_start_datetime NULLS LAST, sc.id
    ) AS planned_rank
  FROM public.sow_schedule sc
  LEFT JOIN public.shift_definition sd ON sd.id = sc.shift_id
  WHERE sc.schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
    AND sc.is_overtime = false
),
actual AS (
  SELECT
    bt.*,
    ROW_NUMBER() OVER (
      PARTITION BY bt.machine_id, bt."timestamp"::date
      ORDER BY bt.priority NULLS LAST, bt."timestamp", bt.id
    ) AS actual_queue_no
  FROM public.buffer_transaction bt
),
planned_rows AS (
  SELECT
    p.schedule_date,
    p.shift_id,
    p.shift_code,
    p.shift_name,
    p.machine_code,
    p.workcenter,
    p.production_order,
    p.operation_no,
    COALESCE(p.planned_queue_no, p.planned_rank)::integer AS planned_queue_no,
    p.planned_start_datetime,
    p.planned_end_datetime,
    a.actual_queue_no::integer AS actual_queue_no,
    a."timestamp" AS actual_queue_datetime,
    CASE
      WHEN a.actual_queue_no IS NULL THEN NULL
      ELSE (a.actual_queue_no - COALESCE(p.planned_queue_no, p.planned_rank))::integer
    END AS queue_variance,
    CASE
      WHEN a.id IS NULL THEN 'PLANNED_NOT_YET_ACTUAL'
      WHEN a.machine_id IS DISTINCT FROM p.machine_code THEN 'MACHINE_CHANGED'
      WHEN a.actual_queue_no = COALESCE(p.planned_queue_no, p.planned_rank) THEN 'ON_PLAN'
      WHEN a.actual_queue_no < COALESCE(p.planned_queue_no, p.planned_rank) THEN 'EARLY'
      WHEN a.actual_queue_no > COALESCE(p.planned_queue_no, p.planned_rank) THEN 'LATE'
      ELSE 'ON_PLAN'
    END AS comparison_status
  FROM planned p
  LEFT JOIN LATERAL (
    SELECT a.*
    FROM actual a
    WHERE ltrim(COALESCE(a.order_no, ''), '0') = ltrim(COALESCE(p.production_order, ''), '0')
      AND a.operation_no = p.operation_no
      AND a."timestamp" >= p.planned_start_datetime
      AND a."timestamp" < p.planned_end_datetime
    ORDER BY
      CASE WHEN a.machine_id = p.machine_code THEN 0 ELSE 1 END,
      a."timestamp",
      a.id
    LIMIT 1
  ) a ON true
),
unplanned_actual AS (
  SELECT
    a."timestamp"::date AS schedule_date,
    NULL::bigint AS shift_id,
    NULL::text AS shift_code,
    NULL::text AS shift_name,
    a.machine_id AS machine_code,
    NULL::text AS workcenter,
    a.order_no AS production_order,
    a.operation_no,
    NULL::integer AS planned_queue_no,
    NULL::timestamptz AS planned_start_datetime,
    NULL::timestamptz AS planned_end_datetime,
    a.actual_queue_no::integer AS actual_queue_no,
    a."timestamp" AS actual_queue_datetime,
    NULL::integer AS queue_variance,
    'UNPLANNED_ACTUAL'::text AS comparison_status
  FROM actual a
  WHERE NOT EXISTS (
    SELECT 1
    FROM planned p
    WHERE ltrim(COALESCE(a.order_no, ''), '0') = ltrim(COALESCE(p.production_order, ''), '0')
      AND a.operation_no = p.operation_no
      AND a."timestamp" >= p.planned_start_datetime
      AND a."timestamp" < p.planned_end_datetime
  )
)
SELECT * FROM planned_rows
UNION ALL
SELECT * FROM unplanned_actual;

CREATE OR REPLACE VIEW public.vw_sow_overtime_summary AS
SELECT
  ot.id,
  ot.overtime_date,
  ot.shift_id,
  sd.shift_code,
  sd.shift_name,
  ot.machine_code,
  ot.workcenter,
  ot.production_order,
  ot.operation_no,
  ot.overtime_start_datetime,
  ot.overtime_end_datetime,
  ot.overtime_hours,
  ot.request_status,
  ot.requested_by_name AS requested_by,
  ot.approved_by_name AS approved_by,
  ot.approved_at,
  ot.rejected_by_name AS rejected_by,
  ot.rejected_at,
  ot.warning_flag,
  ot.warning_message,
  ot.note,
  ot.created_at,
  ot.updated_at,
  ot.overtime_date AS schedule_date
FROM public.sow_overtime_request ot
LEFT JOIN public.shift_definition sd ON sd.id = ot.shift_id;

COMMIT;
