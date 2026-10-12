
CREATE OR REPLACE VIEW public.vw_timesheet_std_performance AS
WITH productive AS (
  SELECT
    t.*,
    s.planhours AS sow_planhours,
    (COALESCE(s.planhours, 0) * 3600)::numeric AS sow_plan_seconds,
    GREATEST(
      EXTRACT(EPOCH FROM (COALESCE(t.longdate_checkout, t.longdate_checkin) - t.longdate_checkin)),
      0
    )::numeric AS elapsed_seconds
  FROM public.timesheet_transaction t
  LEFT JOIN public.sow s
    ON s.order_no = t.order_no
   AND s.operation_no = t.operation_no
  WHERE t.order_no IS NOT NULL
),
running AS (
  SELECT
    p.*,
    COALESCE(
      SUM(p.elapsed_seconds) OVER (
        PARTITION BY p.order_no, p.operation_no
        ORDER BY p.longdate_checkin ASC NULLS LAST, p.tsnumber ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    )::numeric AS used_seconds_before
  FROM productive p
)
SELECT
  r.*,
  GREATEST(r.sow_plan_seconds - r.used_seconds_before, 0)::numeric AS remaining_seconds_before,
  LEAST(r.elapsed_seconds, GREATEST(r.sow_plan_seconds - r.used_seconds_before, 0))::numeric AS std_performance,
  ROUND(
    (LEAST(r.elapsed_seconds, GREATEST(r.sow_plan_seconds - r.used_seconds_before, 0)) / 3600)::numeric,
    6
  ) AS std_performance_hours
FROM running r;

