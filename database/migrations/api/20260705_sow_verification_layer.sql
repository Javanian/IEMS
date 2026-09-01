
BEGIN;

DROP VIEW  IF EXISTS public.vw_sow_operation_actual;
DROP TABLE IF EXISTS public.sow_verification_log;
DROP TABLE IF EXISTS public.sow_operation_status;

CREATE TABLE IF NOT EXISTS public.sow_operation_status (
  id                       bigserial PRIMARY KEY,
  production_order         text    NOT NULL,
  operation_no             integer NOT NULL,

  machine_code             text    NOT NULL,
  manual_flag              text    NOT NULL
    CHECK (manual_flag IN ('dilewati', 'nyangkut')),
  blocked_reason           text,
  blocked_by_machine_code  text,
  blocked_by_order         text,
  override_note            text,
  status_date              date    NOT NULL DEFAULT CURRENT_DATE,
  updated_by               integer,
  updated_by_name          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sow_operation_status_blocked_reason_chk
    CHECK (manual_flag <> 'nyangkut' OR blocked_reason IS NOT NULL),

  CONSTRAINT sow_operation_status_uq
    UNIQUE (production_order, operation_no, machine_code, status_date)
);

CREATE INDEX IF NOT EXISTS idx_sow_operation_status_order
  ON public.sow_operation_status (production_order);
CREATE INDEX IF NOT EXISTS idx_sow_operation_status_flag
  ON public.sow_operation_status (manual_flag);
CREATE INDEX IF NOT EXISTS idx_sow_operation_status_date
  ON public.sow_operation_status (status_date);

CREATE TABLE IF NOT EXISTS public.sow_verification_log (
  id                bigserial PRIMARY KEY,
  verification_date date    NOT NULL DEFAULT CURRENT_DATE,
  production_order  text    NOT NULL,
  operation_no      integer NOT NULL,
  machine_code      text    NOT NULL,
  status_before     text
    CHECK (status_before IS NULL OR status_before IN ('belum','sudah','dilewati','nyangkut')),
  status_after      text
    CHECK (status_after IS NULL OR status_after IN ('belum','sudah','dilewati','nyangkut')),
  deviation_flags   jsonb   NOT NULL DEFAULT '[]'::jsonb,
  verified_by       integer,
  verified_by_name  text,
  verified_at       timestamptz NOT NULL DEFAULT now(),
  note              text
);

CREATE INDEX IF NOT EXISTS idx_sow_verification_log_date
  ON public.sow_verification_log (verification_date);
CREATE INDEX IF NOT EXISTS idx_sow_verification_log_order
  ON public.sow_verification_log (production_order);

CREATE OR REPLACE VIEW public.vw_sow_operation_actual AS
WITH hours AS (

  SELECT
    h.schedule_date,
    h.machine_code,
    h.production_order,
    h.operation_no,
    SUM(h.normal_planned_hours)::numeric(10,2)    AS normal_planned_hours,
    SUM(h.unplanned_hours)::numeric(10,2)         AS unplanned_hours,
    SUM(h.overtime_pending_hours)::numeric(10,2)  AS overtime_pending_hours,
    SUM(h.overtime_approved_hours)::numeric(10,2) AS overtime_approved_hours,
    SUM(h.actual_hours)::numeric(10,2)            AS actual_hours
  FROM public.vw_sow_plan_vs_actual_hours h
  GROUP BY h.schedule_date, h.machine_code, h.production_order, h.operation_no
),
queue AS (

  SELECT DISTINCT ON (qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no)
    qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no,
    qq.planned_queue_no, qq.actual_queue_no, qq.queue_variance, qq.comparison_status
  FROM public.vw_sow_planned_queue_vs_actual_queue qq
  ORDER BY qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no,
           CASE qq.comparison_status
             WHEN 'MACHINE_CHANGED'        THEN 0
             WHEN 'LATE'                   THEN 1
             WHEN 'EARLY'                  THEN 2
             WHEN 'ON_PLAN'                THEN 3
             WHEN 'UNPLANNED_ACTUAL'       THEN 4
             WHEN 'PLANNED_NOT_YET_ACTUAL' THEN 5
             ELSE 6
           END,
           abs(COALESCE(qq.queue_variance, 0)) DESC,
           qq.actual_queue_datetime ASC NULLS LAST,
           qq.actual_queue_no ASC NULLS LAST,
           qq.planned_queue_no ASC NULLS LAST
)
SELECT
  h.schedule_date,
  h.machine_code,
  wc.workcenter_description AS machine_name,
  h.production_order,
  h.operation_no,
  h.normal_planned_hours,
  h.unplanned_hours,
  h.overtime_pending_hours,
  h.overtime_approved_hours,
  h.actual_hours,
  (h.actual_hours - h.normal_planned_hours - h.overtime_approved_hours)::numeric(10,2) AS variance_hours,
  CASE
    WHEN h.normal_planned_hours = 0 AND h.actual_hours > 0 THEN 'UNPLANNED_ACTUAL'
    WHEN h.unplanned_hours > 0                             THEN 'PARTIAL'
    WHEN h.normal_planned_hours > 0                        THEN 'PLANNED'
    ELSE 'NO_PLAN'
  END AS planned_status,
  CASE
    WHEN h.overtime_pending_hours > 0  THEN 'PENDING'
    WHEN h.overtime_approved_hours > 0 THEN 'APPROVED'
    ELSE 'NONE'
  END AS overtime_status,
  q.planned_queue_no,
  q.actual_queue_no,
  q.queue_variance,
  q.comparison_status,

  CASE WHEN COALESCE(h.actual_hours, 0) > 0 THEN 'sudah' ELSE 'belum' END AS view_status,

  s.id                       AS manual_status_id,
  s.manual_flag,
  s.blocked_reason,
  s.blocked_by_machine_code,
  s.blocked_by_order,

  CASE
    WHEN s.manual_flag = 'nyangkut'            THEN 'nyangkut'
    WHEN s.manual_flag = 'dilewati'            THEN 'dilewati'
    WHEN COALESCE(h.actual_hours, 0) > 0       THEN 'sudah'
    ELSE 'belum'
  END AS effective_status,
  (s.id IS NOT NULL)         AS is_overridden,
  s.override_note            AS overridden_note,
  s.updated_by               AS overridden_by,
  s.updated_by_name          AS overridden_by_name,
  s.updated_at               AS overridden_at,

  COALESCE(q.comparison_status = 'MACHINE_CHANGED', false)           AS machine_deviation,
  COALESCE(q.queue_variance IS NOT NULL AND q.queue_variance <> 0, false) AS sequence_deviation
FROM hours h
LEFT JOIN LATERAL (
  SELECT w.workcenter_description
  FROM public.workcenter w
  WHERE w.machineid = h.machine_code
  LIMIT 1
) wc ON true
LEFT JOIN queue q
  ON q.schedule_date     = h.schedule_date
 AND q.machine_code      = h.machine_code
 AND q.production_order  = h.production_order
 AND q.operation_no      = h.operation_no
LEFT JOIN public.sow_operation_status s
  ON s.production_order = h.production_order
 AND s.operation_no     = h.operation_no
 AND s.machine_code     = h.machine_code
 AND s.status_date       = h.schedule_date;

COMMIT;

