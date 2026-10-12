
BEGIN;

CREATE OR REPLACE VIEW public.vw_sow_operation_actual AS
WITH contrib AS (

  SELECT sc.schedule_date, sc.shift_id, sc.machine_code::text AS machine_code,
         COALESCE(NULLIF(sc.workcenter, ''::text), sc.machine_code) AS workcenter,
         sc.production_order, sc.operation_no,
         sum(sc.planned_hours) FILTER (WHERE sc.schedule_status = ANY (ARRAY['PLANNED','PARTIAL','COMPLETED']) AND sc.is_overtime = false) AS normal_planned_hours,
         sum(sc.planned_hours) FILTER (WHERE sc.schedule_status = 'UNPLANNED') AS unplanned_hours,
         NULL::numeric AS overtime_pending_hours, NULL::numeric AS overtime_approved_hours, NULL::numeric AS actual_hours
  FROM public.sow_schedule sc
  WHERE sc.schedule_status <> 'CANCELLED'
  GROUP BY sc.schedule_date, sc.shift_id, sc.machine_code, COALESCE(NULLIF(sc.workcenter,''), sc.machine_code), sc.production_order, sc.operation_no
  UNION ALL

  SELECT o.overtime_date, o.shift_id, o.machine_code::text,
         COALESCE(NULLIF(o.workcenter,''), o.machine_code),
         o.production_order, o.operation_no,
         NULL::numeric, NULL::numeric,
         sum(o.overtime_hours) FILTER (WHERE o.request_status='PENDING'),
         sum(o.overtime_hours) FILTER (WHERE o.request_status='APPROVED'),
         NULL::numeric
  FROM public.sow_overtime_request o
  WHERE o.request_status <> 'CANCELLED'
  GROUP BY o.overtime_date, o.shift_id, o.machine_code, COALESCE(NULLIF(o.workcenter,''), o.machine_code), o.production_order, o.operation_no
  UNION ALL

  SELECT sb.schedule_date, sb.shift_id, sb.machine_code::text,
         COALESCE(NULLIF(sb.workcenter,''), sb.machine_code),
         sb.production_order, sb.operation_no,
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
         sum(COALESCE(tt.duration, EXTRACT(epoch FROM COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)/3600::numeric))
  FROM public.sow_schedule sb
  JOIN public.timesheet_transaction tt
    ON ltrim(COALESCE(tt.order_no,''),'0') = ltrim(COALESCE(sb.production_order,''),'0')
   AND tt.operation_no = sb.operation_no
   AND tt.longdate_checkin >= sb.planned_start_datetime AND tt.longdate_checkin < sb.planned_end_datetime
  WHERE sb.schedule_status <> 'CANCELLED' AND sb.planned_start_datetime IS NOT NULL AND sb.planned_end_datetime IS NOT NULL
    AND tt.longdate_checkin IS NOT NULL AND tt.activitytype IS NULL
  GROUP BY sb.schedule_date, sb.shift_id, sb.machine_code, COALESCE(NULLIF(sb.workcenter,''), sb.machine_code), sb.production_order, sb.operation_no
  UNION ALL

  SELECT tt.longdate_checkin::date, NULL::bigint,
         COALESCE(wc.machineid, tt.workcentercode::varchar)::text,
         COALESCE(tt.workcentercode, wc.machineid::text),
         tt.order_no, tt.operation_no,
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
         sum(COALESCE(tt.duration, EXTRACT(epoch FROM COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)/3600::numeric))
  FROM public.timesheet_transaction tt
  LEFT JOIN LATERAL (
    SELECT w.machineid FROM public.workcenter w
    WHERE tt.workcentercode = w.workcenternew::text OR tt.workcentercode = w.workcenterold::text
       OR tt.workcentercode = w.workcenterot::text OR tt.workcentercode = w.machineid::text
    ORDER BY w.position, w.machineid LIMIT 1
  ) wc ON true
  WHERE tt.longdate_checkin IS NOT NULL AND tt.activitytype IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.sow_schedule sb
      WHERE sb.schedule_status <> 'CANCELLED'
        AND ltrim(COALESCE(tt.order_no,''),'0') = ltrim(COALESCE(sb.production_order,''),'0')
        AND tt.operation_no = sb.operation_no
        AND tt.longdate_checkin >= sb.planned_start_datetime AND tt.longdate_checkin < sb.planned_end_datetime)
  GROUP BY tt.longdate_checkin::date, COALESCE(wc.machineid, tt.workcentercode::varchar), COALESCE(tt.workcentercode, wc.machineid::text), tt.order_no, tt.operation_no
),
pvh AS (
  SELECT schedule_date, shift_id, machine_code, workcenter, production_order, operation_no,
    COALESCE(sum(normal_planned_hours),0)::numeric(10,2)    AS normal_planned_hours,
    COALESCE(sum(unplanned_hours),0)::numeric(10,2)         AS unplanned_hours,
    COALESCE(sum(overtime_pending_hours),0)::numeric(10,2)  AS overtime_pending_hours,
    COALESCE(sum(overtime_approved_hours),0)::numeric(10,2) AS overtime_approved_hours,
    COALESCE(sum(actual_hours),0)::numeric(10,2)            AS actual_hours
  FROM contrib
  GROUP BY schedule_date, shift_id, machine_code, workcenter, production_order, operation_no
),
hours AS (
  SELECT schedule_date, machine_code, production_order, operation_no,
    sum(normal_planned_hours)::numeric(10,2)    AS normal_planned_hours,
    sum(unplanned_hours)::numeric(10,2)         AS unplanned_hours,
    sum(overtime_pending_hours)::numeric(10,2)  AS overtime_pending_hours,
    sum(overtime_approved_hours)::numeric(10,2) AS overtime_approved_hours,
    sum(actual_hours)::numeric(10,2)            AS actual_hours
  FROM pvh
  GROUP BY schedule_date, machine_code, production_order, operation_no
),
queue AS (
  SELECT DISTINCT ON (qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no)
    qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no,
    qq.planned_queue_no, qq.actual_queue_no, qq.queue_variance, qq.comparison_status
  FROM public.vw_sow_planned_queue_vs_actual_queue qq
  ORDER BY qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no,
    CASE qq.comparison_status WHEN 'MACHINE_CHANGED' THEN 0 WHEN 'LATE' THEN 1 WHEN 'EARLY' THEN 2
      WHEN 'ON_PLAN' THEN 3 WHEN 'UNPLANNED_ACTUAL' THEN 4 WHEN 'PLANNED_NOT_YET_ACTUAL' THEN 5 ELSE 6 END,
    abs(COALESCE(qq.queue_variance,0)) DESC, qq.actual_queue_datetime, qq.actual_queue_no, qq.planned_queue_no
)
SELECT h.schedule_date, h.machine_code, wc.workcenter_description AS machine_name,
  h.production_order, h.operation_no,
  h.normal_planned_hours, h.unplanned_hours, h.overtime_pending_hours, h.overtime_approved_hours, h.actual_hours,
  (h.actual_hours - h.normal_planned_hours - h.overtime_approved_hours)::numeric(10,2) AS variance_hours,
  CASE WHEN h.normal_planned_hours = 0 AND h.actual_hours > 0 THEN 'UNPLANNED_ACTUAL'
       WHEN h.unplanned_hours > 0 THEN 'PARTIAL' WHEN h.normal_planned_hours > 0 THEN 'PLANNED' ELSE 'NO_PLAN' END AS planned_status,
  CASE WHEN h.overtime_pending_hours > 0 THEN 'PENDING' WHEN h.overtime_approved_hours > 0 THEN 'APPROVED' ELSE 'NONE' END AS overtime_status,
  q.planned_queue_no, q.actual_queue_no, q.queue_variance, q.comparison_status,
  CASE WHEN COALESCE(h.actual_hours,0) > 0 THEN 'sudah' ELSE 'belum' END AS view_status,
  s.id AS manual_status_id, s.manual_flag, s.blocked_reason, s.blocked_by_machine_code, s.blocked_by_order,
  CASE WHEN s.manual_flag='nyangkut' THEN 'nyangkut' WHEN s.manual_flag='dilewati' THEN 'dilewati'
       WHEN COALESCE(h.actual_hours,0) > 0 THEN 'sudah' ELSE 'belum' END AS effective_status,
  s.id IS NOT NULL AS is_overridden, s.override_note AS overridden_note, s.updated_by AS overridden_by,
  s.updated_by_name AS overridden_by_name, s.updated_at AS overridden_at,
  COALESCE(q.comparison_status = 'MACHINE_CHANGED', false) AS machine_deviation,
  COALESCE(q.queue_variance IS NOT NULL AND q.queue_variance <> 0, false) AS sequence_deviation
FROM hours h
LEFT JOIN LATERAL (SELECT w.workcenter_description FROM public.workcenter w WHERE w.machineid::text = h.machine_code LIMIT 1) wc ON true
LEFT JOIN queue q ON q.schedule_date=h.schedule_date AND q.machine_code=h.machine_code AND q.production_order=h.production_order AND q.operation_no=h.operation_no
LEFT JOIN public.sow_operation_status s ON s.production_order=h.production_order AND s.operation_no=h.operation_no AND s.machine_code=h.machine_code AND s.status_date=h.schedule_date;

COMMIT;

