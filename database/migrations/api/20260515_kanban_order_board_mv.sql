CREATE INDEX IF NOT EXISTS idx_timesheet_transaction_order_active
  ON public.timesheet_transaction (order_no, longdate_checkout, longdate_checkin);

CREATE INDEX IF NOT EXISTS idx_timesheet_transaction_order_key_operation_checkin
  ON public.timesheet_transaction ((LTRIM(COALESCE(order_no, ''), '0')), operation_no, longdate_checkin DESC);

CREATE INDEX IF NOT EXISTS idx_timesheet_transaction_order_key_checkout
  ON public.timesheet_transaction ((LTRIM(COALESCE(order_no, ''), '0')), longdate_checkout DESC)
  WHERE longdate_checkout IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_timesheet_transaction_workcenter_active
  ON public.timesheet_transaction (workcentercode, longdate_checkout, longdate_checkin DESC);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_order_type_time
  ON public.buffer_transaction (order_no, type, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_order_key_operation_time
  ON public.buffer_transaction ((LTRIM(COALESCE(order_no, ''), '0')), operation_no, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_buffer_transaction_machine_type_time
  ON public.buffer_transaction (machine_id, type, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_sow_order_operation_progress
  ON public.sow (order_no, operation_no, progress);

CREATE INDEX IF NOT EXISTS idx_sow_order_key_operation_idsow
  ON public.sow ((LTRIM(COALESCE(order_no, ''), '0')), operation_no, idsow DESC);

CREATE INDEX IF NOT EXISTS idx_ph3_order_order_description
  ON public.ph3_order (order_no, order_description);

CREATE INDEX IF NOT EXISTS idx_ph3_order_order_key
  ON public.ph3_order ((LTRIM(COALESCE(order_no, ''), '0')));


CREATE INDEX IF NOT EXISTS idx_workcenter_machineid
  ON public.workcenter (machineid);

CREATE INDEX IF NOT EXISTS idx_workcenter_workcenternew
  ON public.workcenter (workcenternew);

CREATE INDEX IF NOT EXISTS idx_workcenter_workcenterot
  ON public.workcenter (workcenterot);

CREATE INDEX IF NOT EXISTS idx_workcenter_workcenterold
  ON public.workcenter (workcenterold);

ALTER TABLE public.workcenter
  ADD COLUMN IF NOT EXISTS location text;

DROP MATERIALIZED VIEW IF EXISTS public.mv_kanban_order_board;
DROP VIEW IF EXISTS public.v_kanban_order_resolved;
DROP VIEW IF EXISTS public.v_kanban_order_candidates;
DROP VIEW IF EXISTS public.v_kanban_next_sow_candidates;
DROP VIEW IF EXISTS public.v_kanban_queue_candidates;
DROP VIEW IF EXISTS public.v_kanban_running_candidates;
DROP VIEW IF EXISTS public.v_kanban_teco_orders;

CREATE VIEW public.v_kanban_teco_orders AS
SELECT DISTINCT LTRIM(COALESCE(po.order_no, ''), '0') AS order_key
FROM public.ph3_order po
WHERE COALESCE(po.order_no, '') <> ''
  AND COALESCE(po.order_description, '') ILIKE '%TECO%';

CREATE VIEW public.v_kanban_running_candidates AS
WITH active_timesheet AS (
  SELECT
    t.tsnumber,
    t.order_no,
    LTRIM(COALESCE(t.order_no, ''), '0') AS order_key,
    t.operation_no,
    t.operation_text,
    t.part_name,
    t.ssbr_id,
    t.workcentercode,
    t.longdate_checkin,
    t.longdate_checkout
  FROM public.timesheet_transaction t
  WHERE t.longdate_checkin IS NOT NULL
    AND t.longdate_checkout IS NULL
    AND COALESCE(t.order_no, '') <> ''
),
timesheet_with_machine AS (
  SELECT
    t.*,
    w.machineid,
    COALESCE(NULLIF(w.workcenternew, ''), NULLIF(w.machineid, ''), NULLIF(w.workcenterold, ''), NULLIF(w.workcenterot, '')) AS machine_code,
    w.workcenter_description,
    w.location,
    CASE COALESCE(w.location, '')
      WHEN 'Incoming / Pre-Process' THEN 1
      WHEN 'Cutting / Weld Repair' THEN 2
      WHEN 'Rough Machining' THEN 3
      WHEN 'Precision Machining' THEN 4
      WHEN 'Surface Treatment / Coating' THEN 5
      WHEN 'Inspection / Test' THEN 6
      WHEN 'Packing / Ready Dispatch' THEN 7
      WHEN 'Support' THEN 8
      ELSE 0
    END AS lane_rank
  FROM active_timesheet t
  LEFT JOIN LATERAL (
    SELECT w.*
    FROM public.workcenter w
    WHERE t.workcentercode = w.workcenternew
       OR t.workcentercode = w.workcenterold
       OR t.workcentercode = w.workcenterot
       OR t.workcentercode = w.machineid
    ORDER BY
      CASE
        WHEN t.workcentercode = w.workcenternew THEN 1
        WHEN t.workcentercode = w.machineid THEN 2
        WHEN t.workcentercode = w.workcenterold THEN 3
        WHEN t.workcentercode = w.workcenterot THEN 4
        ELSE 5
      END,
      w.position NULLS LAST,
      w.idrow
    LIMIT 1
  ) w ON true
)
SELECT
  t.order_key,
  t.order_no,
  'running'::text AS current_source,
  COALESCE(NULLIF(t.location, ''), 'Unassigned') AS current_location,
  t.lane_rank,
  t.machineid AS machine_id,
  t.machine_code,
  t.workcenter_description AS machine_description,
  t.operation_no,
  COALESCE(NULLIF(t.operation_text, ''), s.operation_text) AS operation_text,
  COALESCE(NULLIF(s.part_name, ''), NULLIF(t.part_name, '')) AS part_name,
  COALESCE(NULLIF(s.ssbr_id, ''), NULLIF(t.ssbr_id, '')) AS ssbr_id,
  'running'::text AS current_state,
  t.longdate_checkin AS state_entered_at,
  t.longdate_checkin AS last_movement_at,
  ROUND((EXTRACT(EPOCH FROM (NOW() - t.longdate_checkin)) / 60.0)::numeric, 2) AS state_age_minutes,
  ROUND((EXTRACT(EPOCH FROM (NOW() - t.longdate_checkin)) / 60.0)::numeric, 2) AS runtime_minutes,
  NULL::integer AS queue_priority,
  t.tsnumber AS evidence_tsnumber,
  NULL::bigint AS evidence_buffer_id,
  s.operation_no AS evidence_sow_operation_no,
  t.longdate_checkin AS event_ts
FROM timesheet_with_machine t
LEFT JOIN LATERAL (
  SELECT s.*
  FROM public.sow s
  WHERE LTRIM(COALESCE(s.order_no, ''), '0') = t.order_key
    AND (t.operation_no IS NULL OR s.operation_no = t.operation_no)
  ORDER BY s.idsow DESC
  LIMIT 1
) s ON true
WHERE t.order_key <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.v_kanban_teco_orders teco
    WHERE teco.order_key = t.order_key
  );

CREATE VIEW public.v_kanban_queue_candidates AS
WITH active_buffer AS (
  SELECT
    b.id,
    b.order_no,
    LTRIM(COALESCE(b.order_no, ''), '0') AS order_key,
    b.ssbr_id,
    b.operation_no,
    b.operation_text,
    b.machine_id,
    b.type,
    b.priority,
    b."timestamp"
  FROM public.buffer_transaction b
  WHERE b.type IN ('in', 'moving')
    AND COALESCE(b.order_no, '') <> ''
),
buffer_with_machine AS (
  SELECT
    b.*,
    w.machineid,
    COALESCE(NULLIF(w.workcenternew, ''), NULLIF(w.machineid, ''), NULLIF(w.workcenterold, ''), NULLIF(w.workcenterot, '')) AS machine_code,
    w.workcenter_description,
    w.location,
    CASE COALESCE(w.location, '')
      WHEN 'Incoming / Pre-Process' THEN 1
      WHEN 'Cutting / Weld Repair' THEN 2
      WHEN 'Rough Machining' THEN 3
      WHEN 'Precision Machining' THEN 4
      WHEN 'Surface Treatment / Coating' THEN 5
      WHEN 'Inspection / Test' THEN 6
      WHEN 'Packing / Ready Dispatch' THEN 7
      WHEN 'Support' THEN 8
      ELSE 0
    END AS lane_rank
  FROM active_buffer b
  LEFT JOIN public.workcenter w
    ON w.machineid = b.machine_id
)
SELECT
  b.order_key,
  b.order_no,
  'queue'::text AS current_source,
  COALESCE(NULLIF(b.location, ''), 'Unassigned') AS current_location,
  b.lane_rank,
  b.machineid AS machine_id,
  b.machine_code,
  b.workcenter_description AS machine_description,
  b.operation_no,
  COALESCE(NULLIF(b.operation_text, ''), s.operation_text) AS operation_text,
  COALESCE(NULLIF(s.part_name, ''), NULLIF(t.part_name, '')) AS part_name,
  COALESCE(NULLIF(b.ssbr_id, ''), NULLIF(s.ssbr_id, ''), NULLIF(t.ssbr_id, '')) AS ssbr_id,
  'queued'::text AS current_state,
  b."timestamp" AS state_entered_at,
  b."timestamp" AS last_movement_at,
  ROUND((EXTRACT(EPOCH FROM (NOW() - b."timestamp")) / 60.0)::numeric, 2) AS state_age_minutes,
  NULL::numeric AS runtime_minutes,
  COALESCE(b.priority, 0) AS queue_priority,
  t.tsnumber AS evidence_tsnumber,
  b.id AS evidence_buffer_id,
  s.operation_no AS evidence_sow_operation_no,
  b."timestamp" AS event_ts
FROM buffer_with_machine b
LEFT JOIN LATERAL (
  SELECT s.*
  FROM public.sow s
  WHERE LTRIM(COALESCE(s.order_no, ''), '0') = b.order_key
    AND (b.operation_no IS NULL OR s.operation_no = b.operation_no)
  ORDER BY s.idsow DESC
  LIMIT 1
) s ON true
LEFT JOIN LATERAL (
  SELECT t.*
  FROM public.timesheet_transaction t
  WHERE LTRIM(COALESCE(t.order_no, ''), '0') = b.order_key
    AND (b.operation_no IS NULL OR t.operation_no = b.operation_no)
  ORDER BY t.longdate_checkin DESC NULLS LAST, t.tsnumber DESC
  LIMIT 1
) t ON true
WHERE b.order_key <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.v_kanban_teco_orders teco
    WHERE teco.order_key = b.order_key
  );

CREATE VIEW public.v_kanban_next_sow_candidates AS
WITH latest_sow AS (
  SELECT *
  FROM (
    SELECT
      s.*,
      LTRIM(COALESCE(s.order_no, ''), '0') AS order_key,
      ROW_NUMBER() OVER (
        PARTITION BY LTRIM(COALESCE(s.order_no, ''), '0'), s.operation_no
        ORDER BY s.idsow DESC
      ) AS rn
    FROM public.sow s
    WHERE COALESCE(s.order_no, '') <> ''
      AND s.operation_no IS NOT NULL
  ) ranked
  WHERE rn = 1
),
open_sow AS (
  SELECT
    s.*,
    CASE
      WHEN LOWER(TRIM(COALESCE(s.status, ''))) IN ('finish', 'finished', 'complete', 'completed', 'done') THEN TRUE
      WHEN s.actual_finish IS NOT NULL THEN TRUE
      WHEN COALESCE(s.progress, 0) >= 100 THEN TRUE
      WHEN LOWER(TRIM(COALESCE(s.systemstatus, ''))) LIKE '%finish%' THEN TRUE
      ELSE FALSE
    END AS is_finished
  FROM latest_sow s
),
sow_candidates AS (
  SELECT
    s.*,
    w.machineid,
    COALESCE(NULLIF(w.workcenternew, ''), NULLIF(w.machineid, ''), NULLIF(w.workcenterold, ''), NULLIF(w.workcenterot, '')) AS machine_code,
    w.workcenter_description,
    w.location AS lane_location,
    CASE COALESCE(w.location, '')
      WHEN 'Incoming / Pre-Process' THEN 1
      WHEN 'Cutting / Weld Repair' THEN 2
      WHEN 'Rough Machining' THEN 3
      WHEN 'Precision Machining' THEN 4
      WHEN 'Surface Treatment / Coating' THEN 5
      WHEN 'Inspection / Test' THEN 6
      WHEN 'Packing / Ready Dispatch' THEN 7
      WHEN 'Support' THEN 8
      ELSE 0
    END AS lane_rank
  FROM open_sow s
  LEFT JOIN LATERAL (
    SELECT w.*
    FROM public.workcenter w
    WHERE s.workcenter = w.workcenternew
       OR s.workcenter = w.workcenterold
       OR s.workcenter = w.workcenterot
       OR s.workcenter = w.machineid
    ORDER BY
      CASE
        WHEN s.workcenter = w.workcenternew THEN 1
        WHEN s.workcenter = w.machineid THEN 2
        WHEN s.workcenter = w.workcenterold THEN 3
        WHEN s.workcenter = w.workcenterot THEN 4
        ELSE 5
      END,
      w.position NULLS LAST,
      w.idrow
    LIMIT 1
  ) w ON true
  WHERE NOT s.is_finished
    AND s.order_key <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM public.v_kanban_teco_orders teco
      WHERE teco.order_key = s.order_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.v_kanban_running_candidates rc
      WHERE rc.order_key = s.order_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.v_kanban_queue_candidates qc
      WHERE qc.order_key = s.order_key
    )
)
SELECT
  s.order_key,
  s.order_no,
  'sow'::text AS current_source,
  COALESCE(NULLIF(s.lane_location, ''), 'Unassigned') AS current_location,
  s.lane_rank,
  s.machineid AS machine_id,
  s.machine_code,
  s.workcenter_description AS machine_description,
  s.operation_no,
  s.operation_text,
  s.part_name,
  s.ssbr_id,
  'planned'::text AS current_state,
  history.last_known_movement_at AS state_entered_at,
  history.last_known_movement_at AS last_movement_at,
  CASE
    WHEN history.last_known_movement_at IS NULL THEN NULL::numeric
    ELSE ROUND((EXTRACT(EPOCH FROM (NOW() - history.last_known_movement_at)) / 60.0)::numeric, 2)
  END AS state_age_minutes,
  NULL::numeric AS runtime_minutes,
  NULL::integer AS queue_priority,
  history.evidence_tsnumber,
  history.evidence_buffer_id,
  s.operation_no AS evidence_sow_operation_no,
  COALESCE(history.last_known_movement_at, NOW() - INTERVAL '100 years') AS event_ts
FROM sow_candidates s
LEFT JOIN LATERAL (
  SELECT
    MAX(h.movement_at) AS last_known_movement_at,
    MAX(h.tsnumber) FILTER (WHERE h.src = 'timesheet') AS evidence_tsnumber,
    MAX(h.buffer_id) FILTER (WHERE h.src = 'buffer') AS evidence_buffer_id
  FROM (
    SELECT
      t.longdate_checkin AS movement_at,
      t.tsnumber,
      NULL::bigint AS buffer_id,
      'timesheet'::text AS src
    FROM public.timesheet_transaction t
    WHERE LTRIM(COALESCE(t.order_no, ''), '0') = s.order_key
      AND t.longdate_checkin IS NOT NULL
    UNION ALL
    SELECT
      t.longdate_checkout AS movement_at,
      t.tsnumber,
      NULL::bigint AS buffer_id,
      'timesheet'::text AS src
    FROM public.timesheet_transaction t
    WHERE LTRIM(COALESCE(t.order_no, ''), '0') = s.order_key
      AND t.longdate_checkout IS NOT NULL
    UNION ALL
    SELECT
      b."timestamp" AS movement_at,
      NULL::integer AS tsnumber,
      b.id AS buffer_id,
      'buffer'::text AS src
    FROM public.buffer_transaction b
    WHERE LTRIM(COALESCE(b.order_no, ''), '0') = s.order_key
  ) h
) history ON true;

CREATE VIEW public.v_kanban_order_candidates AS
SELECT * FROM public.v_kanban_running_candidates
UNION ALL
SELECT * FROM public.v_kanban_queue_candidates
UNION ALL
SELECT * FROM public.v_kanban_next_sow_candidates;

CREATE VIEW public.v_kanban_order_resolved AS
WITH ranked AS (
  SELECT
    c.*,
    CASE c.current_source
      WHEN 'running' THEN 1
      WHEN 'queue' THEN 2
      ELSE 3
    END AS source_precedence,
    ROW_NUMBER() OVER (
      PARTITION BY c.order_key
      ORDER BY
        CASE c.current_source
          WHEN 'running' THEN 1
          WHEN 'queue' THEN 2
          ELSE 3
        END,
        c.lane_rank DESC,
        c.event_ts DESC NULLS LAST,
        c.queue_priority DESC NULLS LAST,
        c.operation_no DESC NULLS LAST,
        c.order_no DESC
    ) AS winner_rank
  FROM public.v_kanban_order_candidates c
),
parallel_stats AS (
  SELECT
    order_key,
    current_source,
    GREATEST(COUNT(*) - 1, 0)::integer AS parallel_count,
    STRING_AGG(DISTINCT current_location, ', ' ORDER BY current_location) AS parallel_locations
  FROM public.v_kanban_order_candidates
  GROUP BY order_key, current_source
),
source_flags AS (
  SELECT
    order_key,
    COUNT(*) FILTER (WHERE current_source = 'running') > 1 AS has_running_parallel,
    COUNT(*) FILTER (WHERE current_source = 'queue') > 1 AS has_queue_parallel
  FROM public.v_kanban_order_candidates
  GROUP BY order_key
)
SELECT
  r.order_key,
  r.order_no AS order_no_display,
  r.current_source,
  r.current_location,
  r.lane_rank,
  r.machine_id,
  r.machine_code,
  r.machine_description,
  r.operation_no,
  r.operation_text,
  r.part_name,
  r.ssbr_id,
  r.current_state,
  r.state_entered_at,
  r.last_movement_at,
  r.state_age_minutes,
  CASE
    WHEN r.state_age_minutes IS NULL THEN 'unknown'
    WHEN r.current_source = 'running' AND r.state_age_minutes < 240 THEN 'green'
    WHEN r.current_source = 'running' AND r.state_age_minutes < 480 THEN 'amber'
    WHEN r.current_source = 'running' THEN 'red'
    WHEN r.current_source = 'queue' AND r.state_age_minutes < 480 THEN 'green'
    WHEN r.current_source = 'queue' AND r.state_age_minutes < 1440 THEN 'amber'
    WHEN r.current_source = 'queue' THEN 'red'
    WHEN r.state_age_minutes < 1440 THEN 'green'
    WHEN r.state_age_minutes < 4320 THEN 'amber'
    ELSE 'red'
  END AS aging_band,
  r.runtime_minutes,
  COALESCE(ps.parallel_count, 0) AS parallel_count,
  COALESCE(ps.parallel_locations, r.current_location) AS parallel_locations,
  COALESCE(sf.has_running_parallel, FALSE) AS has_running_parallel,
  COALESCE(sf.has_queue_parallel, FALSE) AS has_queue_parallel,
  r.queue_priority,
  r.evidence_tsnumber,
  r.evidence_buffer_id,
  r.evidence_sow_operation_no
FROM ranked r
LEFT JOIN parallel_stats ps
  ON ps.order_key = r.order_key
 AND ps.current_source = r.current_source
LEFT JOIN source_flags sf
  ON sf.order_key = r.order_key
WHERE r.winner_rank = 1;

CREATE MATERIALIZED VIEW public.mv_kanban_order_board AS
SELECT
  r.order_key,
  r.order_no_display,
  r.current_source,
  r.current_location,
  r.lane_rank,
  r.machine_id,
  r.machine_code,
  r.machine_description,
  r.operation_no,
  r.operation_text,
  r.part_name,
  r.ssbr_id,
  r.current_state,
  r.state_entered_at,
  r.last_movement_at,
  r.state_age_minutes,
  r.aging_band,
  r.runtime_minutes,
  r.parallel_count,
  r.parallel_locations,
  r.has_running_parallel,
  r.has_queue_parallel,
  r.queue_priority,
  r.evidence_tsnumber,
  r.evidence_buffer_id,
  r.evidence_sow_operation_no,
  NOW() AS refreshed_at
FROM public.v_kanban_order_resolved r
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_kanban_order_board_order_key
  ON public.mv_kanban_order_board (order_key);

CREATE INDEX IF NOT EXISTS idx_mv_kanban_order_board_location
  ON public.mv_kanban_order_board (current_location);

CREATE INDEX IF NOT EXISTS idx_mv_kanban_order_board_aging
  ON public.mv_kanban_order_board (aging_band);

CREATE INDEX IF NOT EXISTS idx_mv_kanban_order_board_source
  ON public.mv_kanban_order_board (current_source);

CREATE INDEX IF NOT EXISTS idx_mv_kanban_order_board_state_entered_at
  ON public.mv_kanban_order_board (state_entered_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_mv_kanban_order_board()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  is_populated boolean;
BEGIN
  SELECT COALESCE(m.ispopulated, FALSE)
  INTO is_populated
  FROM pg_matviews m
  WHERE m.schemaname = 'public'
    AND m.matviewname = 'mv_kanban_order_board';

  IF NOT COALESCE(is_populated, FALSE) THEN
    REFRESH MATERIALIZED VIEW public.mv_kanban_order_board;
  ELSE
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_kanban_order_board;
  END IF;
END;
$$;

SELECT public.refresh_mv_kanban_order_board();
