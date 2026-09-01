
DROP MATERIALIZED VIEW IF EXISTS public.mv_mch_productiondata_detail;

CREATE INDEX IF NOT EXISTS idx_ph3_order_confirmation_number
  ON public.ph3_order (confirmation_number);

CREATE INDEX IF NOT EXISTS idx_timesheet_transaction_order_operation_checkin
  ON public.timesheet_transaction (order_no, operation_no, longdate_checkin);

CREATE MATERIALIZED VIEW public.mv_mch_productiondata_detail AS
SELECT
  p.proddataid,
  p.startdatetime,
  p.enddatetime,
  p.startdatetime::date AS work_date,
  to_char(p.startdatetime, 'HH24:MI:SS') AS start_time,
  to_char(p.enddatetime, 'HH24:MI:SS') AS end_time,
  p.duration AS source_duration,
  CASE
    WHEN p.enddatetime IS NULL THEN 0
    ELSE GREATEST(EXTRACT(EPOCH FROM (p.enddatetime - p.startdatetime)), 0)::bigint
  END AS duration_seconds,
  ROUND(
    (CASE
      WHEN p.enddatetime IS NULL THEN 0
      ELSE GREATEST(EXTRACT(EPOCH FROM (p.enddatetime - p.startdatetime)), 0) / 3600.0
    END)::numeric,
    4
  ) AS duration_hours,

  p.machineno,
  m.sitemachineno,
  m.machinegroupid,
  m.plantid AS machine_plantid,
  m.machinetypeid,
  COALESCE(m.machineid, '') AS machineid,
  COALESCE(m.machinename, '') AS machinename,

  p.statusid,
  p.previoustatusid,
  COALESCE(st.description, 'Unknown') AS status_description,
  COALESCE(st.activitytype, '') AS status_activitytype,
  pst.description AS previous_status_description,

  ph3.confirmation_number AS confirmation_number,
  ph3.order_no AS order_no,
  ph3.operation_no AS operation_no,
  ph3.operation_short_text AS operation_short_text,
  ph3.operation_description AS operation_description,
  ph3.sequence_category AS sequence_category,
  ph3.sequence_number AS sequence_number,
  ph3.branch_operation_no AS branch_operation_no,
  ph3.return_operation_no AS return_operation_no,
  ph3.cost_center AS cost_center,
  ph3.material_no AS material_no,
  ph3.material_description AS material_description,

  ts.ssbr_id AS ssbr_id,
  ts.full_name AS full_name,
  ts.serialnumber AS sn_employee,
  ts.workcentercode AS workcentercode,
  ts.tsnumber AS tsnumber,
  ts.longdate_checkin AS checkin,

  now() AS refreshed_at
FROM public.mch_productiondata p
LEFT JOIN public.mch_machines m
  ON m.machineno = p.machineno
LEFT JOIN public.mch_statustypes st
  ON st.statusid = p.statusid
LEFT JOIN public.mch_statustypes pst
  ON pst.statusid = p.previoustatusid
LEFT JOIN LATERAL (
  SELECT ph3.*
  FROM public.ph3_order ph3
  WHERE ph3.confirmation_number::text = COALESCE(p.jobid, '')::text
  ORDER BY ph3.id DESC
  LIMIT 1
) ph3 ON true
LEFT JOIN LATERAL (
  SELECT
    t.*,
    ABS(EXTRACT(EPOCH FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar') - p.startdatetime)))::bigint AS time_diff_seconds
  FROM public.timesheet_transaction t
  WHERE t.order_no = ph3.order_no
    AND t.operation_no = CASE
      WHEN ph3.operation_no ~ '^[0-9]+$' THEN ph3.operation_no::integer
      ELSE NULL
    END
    AND t.longdate_checkin IS NOT NULL
    AND t.longdate_checkin >= ((p.startdatetime - interval '1 day') AT TIME ZONE 'Asia/Makassar')
    AND t.longdate_checkin < ((p.startdatetime + interval '1 day') AT TIME ZONE 'Asia/Makassar')
  ORDER BY
    ABS(EXTRACT(EPOCH FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar') - p.startdatetime))) ASC,
    t.tsnumber DESC
  LIMIT 1
) ts ON true
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_mch_productiondata_detail_proddataid
  ON public.mv_mch_productiondata_detail (proddataid);

CREATE INDEX IF NOT EXISTS idx_mv_mch_productiondata_detail_work_date
  ON public.mv_mch_productiondata_detail (work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mv_mch_productiondata_detail_machine_date
  ON public.mv_mch_productiondata_detail (machineno, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mv_mch_productiondata_detail_status
  ON public.mv_mch_productiondata_detail (statusid);

CREATE INDEX IF NOT EXISTS idx_mv_mch_productiondata_detail_order_operation
  ON public.mv_mch_productiondata_detail (order_no, operation_no);

CREATE INDEX IF NOT EXISTS idx_mv_mch_productiondata_detail_timesheet
  ON public.mv_mch_productiondata_detail (tsnumber);

REFRESH MATERIALIZED VIEW public.mv_mch_productiondata_detail;

