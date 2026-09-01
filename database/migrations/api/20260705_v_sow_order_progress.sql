
BEGIN;

CREATE OR REPLACE VIEW public.v_sow_order_progress AS
WITH teco AS (
  SELECT DISTINCT order_no FROM public.ph3_order WHERE order_description = 'TECO'
),
wc_map AS (
  SELECT DISTINCT ON (code) code, machineid FROM (
    SELECT machineid::text AS code, machineid FROM public.workcenter
    UNION ALL SELECT workcenternew, machineid FROM public.workcenter WHERE COALESCE(workcenternew,'')<>''
    UNION ALL SELECT workcenterold, machineid FROM public.workcenter WHERE COALESCE(workcenterold,'')<>''
    UNION ALL SELECT workcenterot,  machineid FROM public.workcenter WHERE COALESCE(workcenterot,'')<>''
  ) x ORDER BY code, machineid
),
ov AS (
  SELECT production_order, operation_no,
    bool_or(manual_flag='nyangkut') AS any_nyangkut,
    bool_or(manual_flag='dilewati') AS any_dilewati
  FROM public.sow_operation_status GROUP BY production_order, operation_no
),
op2 AS (
  SELECT s.order_no AS production_order, s.operation_no, s.ssbr_id, s.part_name,
    CASE WHEN s.status='FINISH' THEN 'sudah'
         WHEN ov.any_nyangkut   THEN 'nyangkut'
         WHEN ov.any_dilewati   THEN 'dilewati'
         ELSE 'belum' END AS eff_status,
    wm.machineid::text AS a_machine,
    max(s.operation_no) FILTER (WHERE s.status='FINISH') OVER (PARTITION BY s.order_no) AS highest_done_op
  FROM public.sow s
  LEFT JOIN teco t   ON t.order_no = s.order_no
  LEFT JOIN ov       ON ov.production_order = s.order_no AND ov.operation_no = s.operation_no
  LEFT JOIN wc_map wm ON wm.code = s.workcenter
  WHERE t.order_no IS NULL
    AND s.order_no IS NOT NULL
),
agg AS (
  SELECT production_order,
    max(highest_done_op) AS highest_done_op,
    count(*) AS total_ops,
    count(*) FILTER (WHERE eff_status='sudah') AS done_ops,
    min(operation_no) FILTER (WHERE eff_status IN ('belum','nyangkut')) AS frontier_op,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status='dilewati') AS debt_ops_raw,
    count(*) FILTER (WHERE eff_status='dilewati') AS debt_count,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status='nyangkut') AS blocked_ops_raw,
    count(*) FILTER (WHERE eff_status='nyangkut') AS blocked_count,
    array_agg(operation_no ORDER BY operation_no) FILTER (WHERE eff_status IN ('belum','nyangkut','dilewati') AND highest_done_op IS NOT NULL AND operation_no < highest_done_op) AS behind_raw,
    count(*) FILTER (WHERE eff_status IN ('dilewati','nyangkut')) AS n_manual_dev,
    count(*) FILTER (WHERE eff_status='belum' AND highest_done_op IS NOT NULL AND operation_no < highest_done_op) AS n_behind_belum,

    array_agg(DISTINCT ssbr_id) FILTER (WHERE COALESCE(ssbr_id,'')<>'') AS ssbr_ids,

    array_agg(DISTINCT part_name) FILTER (WHERE COALESCE(part_name,'')<>'') AS part_names
  FROM op2 GROUP BY production_order
)
SELECT a.production_order, a.total_ops, a.done_ops, a.total_ops - a.done_ops AS undone_ops,
  a.highest_done_op, a.frontier_op, fo.eff_status AS frontier_status, fo.a_machine AS frontier_machine,
  COALESCE(a.debt_ops_raw,'{}')    AS debt_ops, a.debt_count,
  COALESCE(a.blocked_ops_raw,'{}') AS blocked_ops, a.blocked_count,
  COALESCE(a.behind_raw,'{}')      AS behind_frontier_ops,
  (a.n_manual_dev > 0 OR a.n_behind_belum > 0) AS is_deviating,
  CASE WHEN a.n_manual_dev > 0 THEN 'red' WHEN a.n_behind_belum > 0 THEN 'amber' ELSE 'green' END AS status_color,
  NULL::date AS last_activity_date,

  COALESCE(a.ssbr_ids,'{}') AS ssbr_ids,
  COALESCE(a.part_names,'{}') AS part_names
FROM agg a
LEFT JOIN op2 fo ON fo.production_order = a.production_order AND fo.operation_no = a.frontier_op;

COMMIT;

