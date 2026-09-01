
CREATE TABLE IF NOT EXISTS public.mch_productiondata_detail (
  proddataid int4 PRIMARY KEY,
  startdatetime timestamp NOT NULL,
  enddatetime timestamp NULL,
  work_date date NOT NULL,
  start_time text NULL,
  end_time text NULL,
  source_duration int4 NULL,
  duration_seconds bigint NOT NULL DEFAULT 0,
  duration_hours numeric(18, 4) NOT NULL DEFAULT 0,

  machineno int4 NOT NULL,
  sitemachineno text NULL,
  machinegroupid text NULL,
  machine_plantid text NULL,
  machinetypeid text NULL,
  machineid text NOT NULL DEFAULT '',
  machinename text NOT NULL DEFAULT '',

  statusid int2 NOT NULL,
  previoustatusid int2 NULL,
  status_description text NOT NULL DEFAULT 'Unknown',
  status_activitytype text NOT NULL DEFAULT '',
  previous_status_description text NULL,

  confirmation_number text NULL,
  order_no text NULL,
  operation_no text NULL,
  operation_short_text text NULL,
  operation_description text NULL,
  sequence_category text NULL,
  sequence_number text NULL,
  branch_operation_no text NULL,
  return_operation_no text NULL,
  cost_center text NULL,
  material_no text NULL,
  material_description text NULL,

  ssbr_id text NULL,
  full_name text NULL,
  sn_employee text NULL,
  workcentercode text NULL,
  tsnumber text NULL,
  checkin timestamptz NULL,
  timesheet_time_diff_seconds bigint NULL,

  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_proddataid
  ON public.mch_productiondata (proddataid);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_startdatetime
  ON public.mch_productiondata (startdatetime);

CREATE INDEX IF NOT EXISTS idx_ph3_order_confirmation_number_id_desc
  ON public.ph3_order (confirmation_number, id DESC);

CREATE INDEX IF NOT EXISTS idx_timesheet_transaction_order_operation_checkin
  ON public.timesheet_transaction (order_no, operation_no, longdate_checkin);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_detail_work_date
  ON public.mch_productiondata_detail (work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_detail_machine_date
  ON public.mch_productiondata_detail (machineno, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_detail_status
  ON public.mch_productiondata_detail (statusid);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_detail_order_operation
  ON public.mch_productiondata_detail (order_no, operation_no);

CREATE INDEX IF NOT EXISTS idx_mch_productiondata_detail_timesheet
  ON public.mch_productiondata_detail (tsnumber);

CREATE OR REPLACE FUNCTION public.upsert_mch_productiondata_detail(
  p_min_proddataid int4 DEFAULT NULL,
  p_from_startdatetime timestamp DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH source_rows AS (
    SELECT
      p.*,
      p.startdatetime::date AS work_date,
      p.startdatetime AS start_local,
      p.startdatetime AT TIME ZONE 'Asia/Makassar' AS start_tz,
      CASE
        WHEN p.enddatetime IS NULL THEN 0::bigint
        ELSE GREATEST(EXTRACT(EPOCH FROM (p.enddatetime - p.startdatetime)), 0)::bigint
      END AS duration_seconds_calc
    FROM public.mch_productiondata p
    WHERE (p_min_proddataid IS NULL OR p.proddataid > p_min_proddataid)
      AND (p_from_startdatetime IS NULL OR p.startdatetime >= p_from_startdatetime)
  ),
  detail_rows AS (
    SELECT
      p.proddataid,
      p.startdatetime,
      p.enddatetime,
      p.work_date,
      to_char(p.startdatetime, 'HH24:MI:SS') AS start_time,
      to_char(p.enddatetime, 'HH24:MI:SS') AS end_time,
      p.duration AS source_duration,
      p.duration_seconds_calc AS duration_seconds,
      ROUND((p.duration_seconds_calc::numeric / 3600.0), 4) AS duration_hours,

      p.machineno,
      m.sitemachineno::text AS sitemachineno,
      m.machinegroupid::text AS machinegroupid,
      m.plantid::text AS machine_plantid,
      m.machinetypeid::text AS machinetypeid,
      COALESCE(m.machineid, '') AS machineid,
      COALESCE(m.machinename, '') AS machinename,

      p.statusid,
      p.previoustatusid,
      COALESCE(st.description, 'Unknown') AS status_description,
      COALESCE(st.activitytype, '') AS status_activitytype,
      pst.description AS previous_status_description,

      ph3.confirmation_number::text AS confirmation_number,
      ph3.order_no::text AS order_no,
      ph3.operation_no::text AS operation_no,
      ph3.operation_short_text::text AS operation_short_text,
      ph3.operation_description::text AS operation_description,
      ph3.sequence_category::text AS sequence_category,
      ph3.sequence_number::text AS sequence_number,
      ph3.branch_operation_no::text AS branch_operation_no,
      ph3.return_operation_no::text AS return_operation_no,
      ph3.cost_center::text AS cost_center,
      ph3.material_no::text AS material_no,
      ph3.material_description::text AS material_description,

      ts.ssbr_id::text AS ssbr_id,
      ts.full_name::text AS full_name,
      ts.serialnumber::text AS sn_employee,
      ts.workcentercode::text AS workcentercode,
      ts.tsnumber::text AS tsnumber,
      ts.longdate_checkin AS checkin,
      ts.time_diff_seconds AS timesheet_time_diff_seconds,
      now() AS refreshed_at
    FROM source_rows p
    LEFT JOIN public.mch_machines m
      ON m.machineno = p.machineno
    LEFT JOIN public.mch_statustypes st
      ON st.statusid = p.statusid
    LEFT JOIN public.mch_statustypes pst
      ON pst.statusid = p.previoustatusid
    LEFT JOIN LATERAL (
      SELECT
        ph3.*,
        CASE
          WHEN ph3.operation_no ~ '^[0-9]+$' THEN ph3.operation_no::integer
          ELSE NULL
        END AS operation_no_int
      FROM public.ph3_order ph3
      WHERE ph3.confirmation_number = p.jobid
      ORDER BY ph3.id DESC
      LIMIT 1
    ) ph3 ON true
    LEFT JOIN LATERAL (
      SELECT
        t.*,
        ABS(EXTRACT(EPOCH FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar') - p.start_local)))::bigint AS time_diff_seconds
      FROM public.timesheet_transaction t
      WHERE t.order_no = ph3.order_no
        AND t.operation_no = ph3.operation_no_int
        AND t.longdate_checkin IS NOT NULL
        AND t.longdate_checkin >= (p.start_tz - interval '1 day')
        AND t.longdate_checkin < (p.start_tz + interval '1 day')
      ORDER BY
        ABS(EXTRACT(EPOCH FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar') - p.start_local))) ASC,
        t.tsnumber DESC
      LIMIT 1
    ) ts ON true
  ),
  upserted AS (
    INSERT INTO public.mch_productiondata_detail (
      proddataid, startdatetime, enddatetime, work_date, start_time, end_time,
      source_duration, duration_seconds, duration_hours,
      machineno, sitemachineno, machinegroupid, machine_plantid, machinetypeid, machineid, machinename,
      statusid, previoustatusid, status_description, status_activitytype, previous_status_description,
      confirmation_number, order_no, operation_no, operation_short_text, operation_description,
      sequence_category, sequence_number, branch_operation_no, return_operation_no, cost_center,
      material_no, material_description,
      ssbr_id, full_name, sn_employee, workcentercode, tsnumber, checkin,
      timesheet_time_diff_seconds, refreshed_at
    )
    SELECT
      proddataid, startdatetime, enddatetime, work_date, start_time, end_time,
      source_duration, duration_seconds, duration_hours,
      machineno, sitemachineno, machinegroupid, machine_plantid, machinetypeid, machineid, machinename,
      statusid, previoustatusid, status_description, status_activitytype, previous_status_description,
      confirmation_number, order_no, operation_no, operation_short_text, operation_description,
      sequence_category, sequence_number, branch_operation_no, return_operation_no, cost_center,
      material_no, material_description,
      ssbr_id, full_name, sn_employee, workcentercode, tsnumber, checkin,
      timesheet_time_diff_seconds, refreshed_at
    FROM detail_rows
    ON CONFLICT (proddataid) DO UPDATE SET
      startdatetime = EXCLUDED.startdatetime,
      enddatetime = EXCLUDED.enddatetime,
      work_date = EXCLUDED.work_date,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      source_duration = EXCLUDED.source_duration,
      duration_seconds = EXCLUDED.duration_seconds,
      duration_hours = EXCLUDED.duration_hours,
      machineno = EXCLUDED.machineno,
      sitemachineno = EXCLUDED.sitemachineno,
      machinegroupid = EXCLUDED.machinegroupid,
      machine_plantid = EXCLUDED.machine_plantid,
      machinetypeid = EXCLUDED.machinetypeid,
      machineid = EXCLUDED.machineid,
      machinename = EXCLUDED.machinename,
      statusid = EXCLUDED.statusid,
      previoustatusid = EXCLUDED.previoustatusid,
      status_description = EXCLUDED.status_description,
      status_activitytype = EXCLUDED.status_activitytype,
      previous_status_description = EXCLUDED.previous_status_description,
      confirmation_number = EXCLUDED.confirmation_number,
      order_no = EXCLUDED.order_no,
      operation_no = EXCLUDED.operation_no,
      operation_short_text = EXCLUDED.operation_short_text,
      operation_description = EXCLUDED.operation_description,
      sequence_category = EXCLUDED.sequence_category,
      sequence_number = EXCLUDED.sequence_number,
      branch_operation_no = EXCLUDED.branch_operation_no,
      return_operation_no = EXCLUDED.return_operation_no,
      cost_center = EXCLUDED.cost_center,
      material_no = EXCLUDED.material_no,
      material_description = EXCLUDED.material_description,
      ssbr_id = EXCLUDED.ssbr_id,
      full_name = EXCLUDED.full_name,
      sn_employee = EXCLUDED.sn_employee,
      workcentercode = EXCLUDED.workcentercode,
      tsnumber = EXCLUDED.tsnumber,
      checkin = EXCLUDED.checkin,
      timesheet_time_diff_seconds = EXCLUDED.timesheet_time_diff_seconds,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rows FROM upserted;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.load_mch_productiondata_detail_incremental()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_watermark int4;
BEGIN
  SELECT COALESCE(MAX(proddataid), 0)
  INTO v_watermark
  FROM public.mch_productiondata_detail;

  RETURN public.upsert_mch_productiondata_detail(v_watermark, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.reprocess_mch_productiondata_detail_recent(
  p_window interval DEFAULT interval '3 days'
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_from timestamp;
BEGIN
  v_from := now() - p_window;
  RETURN public.upsert_mch_productiondata_detail(NULL, v_from);
END;
$$;

