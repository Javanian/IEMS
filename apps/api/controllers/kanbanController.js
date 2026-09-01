const db = global.pool || require('../db');

async function materializedViewExists() {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_matviews
       WHERE schemaname = 'public'
         AND matviewname = 'mv_kanban_order_board'
     ) AS exists`
  );
  return Boolean(result.rows[0]?.exists);
}

function buildBoardWhereClause(query = {}) {
  const conditions = [];
  const params = [];

  const location = String(query.location || '').trim();
  const aging = String(query.aging || '')
    .trim()
    .toLowerCase();
  const source = String(query.source || '')
    .trim()
    .toLowerCase();
  const state = String(query.state || '')
    .trim()
    .toLowerCase();
  const search = String(query.search || query.q || '')
    .trim()
    .toLowerCase();

  if (location) {
    params.push(location);
    conditions.push(`current_location = $${params.length}`);
  }

  if (aging) {
    const values = aging
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (values.length > 0) {
      params.push(values);
      conditions.push(`LOWER(COALESCE(aging_band, '')) = ANY($${params.length}::text[])`);
    }
  }

  if (source) {
    const values = source
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (values.length > 0) {
      params.push(values);
      conditions.push(`LOWER(COALESCE(current_source, '')) = ANY($${params.length}::text[])`);
    }
  }

  if (state) {
    const values = state
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (values.length > 0) {
      params.push(values);
      conditions.push(`LOWER(COALESCE(current_state, '')) = ANY($${params.length}::text[])`);
    }
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(
      LOWER(COALESCE(order_no_display, '')) LIKE $${idx}
      OR LOWER(COALESCE(order_key, '')) LIKE $${idx}
      OR LOWER(COALESCE(part_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(ssbr_id, '')) LIKE $${idx}
      OR LOWER(COALESCE(operation_text, '')) LIKE $${idx}
      OR LOWER(COALESCE(machine_code, '')) LIKE $${idx}
      OR LOWER(COALESCE(machine_description, '')) LIKE $${idx}
    )`);
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

exports.getBoard = async (req, res) => {
  try {
    if (!(await materializedViewExists())) {
      return res.status(503).json({ error: 'mv_kanban_order_board is not available' });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { whereSql, params } = buildBoardWhereClause(req.query);

    params.push(limit);
    const result = await db.query(
      `WITH limited_board AS (
         SELECT *
         FROM public.mv_kanban_order_board
         ${whereSql}
         ORDER BY lane_rank ASC, state_entered_at DESC NULLS LAST, order_no_display ASC
         LIMIT $${params.length}
       )
       SELECT
         b.*,
         CASE
           WHEN b.current_source = 'running'
           THEN ROUND(COALESCE(s.sow_actual_hours, t.ts_actual_hours, 0)::numeric, 2)
           ELSE NULL::numeric
         END AS actual_hours,
         CASE
           WHEN b.current_source = 'running'
           THEN ROUND(COALESCE(s.sow_planhours, t.ts_planhours, 0)::numeric, 2)
           ELSE NULL::numeric
         END AS planhours
       FROM limited_board b
       LEFT JOIN LATERAL (
         SELECT
           MAX(s.actual_hours)::numeric AS sow_actual_hours,
           MAX(s.planhours)::numeric AS sow_planhours
         FROM public.sow s
         WHERE b.current_source = 'running'
           AND LTRIM(COALESCE(s.order_no, ''), '0') = b.order_key
           AND (b.operation_no IS NULL OR s.operation_no = b.operation_no)
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT
           MAX(t.planhours)::numeric AS ts_planhours,
           SUM(
             COALESCE(
               t.duration,
               CASE
                 WHEN t.longdate_checkin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (COALESCE(t.longdate_checkout, NOW()) - t.longdate_checkin)) / 3600.0
                 ELSE 0
               END
             )
           )::numeric AS ts_actual_hours
         FROM public.timesheet_transaction t
         WHERE b.current_source = 'running'
           AND LTRIM(COALESCE(t.order_no, ''), '0') = b.order_key
           AND (b.operation_no IS NULL OR t.operation_no = b.operation_no)
       ) t ON true
       ORDER BY b.lane_rank ASC, b.state_entered_at DESC NULLS LAST, b.order_no_display ASC`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    if (!(await materializedViewExists())) {
      return res.status(503).json({ error: 'mv_kanban_order_board is not available' });
    }

    const result = await db.query(`
      WITH base AS (
        SELECT *
        FROM public.mv_kanban_order_board
      ),
      totals AS (
        SELECT
          COUNT(*)::int AS total_cards,
          COUNT(*) FILTER (WHERE current_source = 'running')::int AS running_count,
          COUNT(*) FILTER (WHERE current_source = 'queue')::int AS queue_count,
          COUNT(*) FILTER (WHERE current_source = 'sow')::int AS sow_count,
          COUNT(*) FILTER (WHERE aging_band = 'red')::int AS red_count,
          COUNT(*) FILTER (WHERE aging_band = 'amber')::int AS amber_count,
          COUNT(*) FILTER (WHERE aging_band = 'green')::int AS green_count,
          MAX(refreshed_at) AS refreshed_at
        FROM base
      ),
      by_location AS (
        SELECT
          current_location,
          COUNT(*)::int AS card_count,
          COUNT(*) FILTER (WHERE current_source = 'running')::int AS running_count,
          COUNT(*) FILTER (WHERE current_source = 'queue')::int AS queue_count,
          COUNT(*) FILTER (WHERE current_source = 'sow')::int AS sow_count,
          COUNT(*) FILTER (WHERE aging_band = 'red')::int AS red_count
        FROM base
        GROUP BY current_location
      ),
      by_source AS (
        SELECT
          current_source,
          COUNT(*)::int AS card_count
        FROM base
        GROUP BY current_source
      )
      SELECT
        (SELECT row_to_json(t) FROM totals t) AS totals,
        COALESCE((SELECT json_agg(l ORDER BY l.current_location) FROM by_location l), '[]'::json) AS by_location,
        COALESCE((SELECT json_agg(s ORDER BY s.current_source) FROM by_source s), '[]'::json) AS by_source
    `);

    res.json(result.rows[0] || { totals: null, by_location: [], by_source: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLane = async (req, res) => {
  try {
    if (!(await materializedViewExists())) {
      return res.status(503).json({ error: 'mv_kanban_order_board is not available' });
    }

    const location = String(req.params.location || '').trim();
    if (!location) {
      return res.status(400).json({ error: 'location is required' });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { whereSql, params } = buildBoardWhereClause({
      ...req.query,
      location,
    });

    params.push(limit);
    const result = await db.query(
      `SELECT *
       FROM public.mv_kanban_order_board
       ${whereSql}
       ORDER BY state_entered_at DESC NULLS LAST, order_no_display ASC
       LIMIT $${params.length}`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCardDetail = async (req, res) => {
  try {
    const orderNo = String(req.query.orderNo || '').trim();
    const operationNoRaw = String(req.query.operationNo || '').trim();
    const bufferIdRaw = String(req.query.bufferId || '').trim();
    const operationNo = operationNoRaw === '' ? null : Number(operationNoRaw);
    const bufferId = bufferIdRaw === '' ? null : Number(bufferIdRaw);

    if (!orderNo && !Number.isFinite(bufferId)) {
      return res.status(400).json({ error: 'orderNo or bufferId is required' });
    }

    if (operationNoRaw !== '' && !Number.isFinite(operationNo)) {
      return res.status(400).json({ error: 'operationNo must be a number' });
    }

    const result = await db.query(
      `WITH input AS (
         SELECT
           NULLIF($1::text, '') AS order_no,
           $2::integer AS operation_no,
           $3::bigint AS buffer_id
       ),
       buffer_seed AS (
         SELECT b.*
         FROM public.buffer_transaction b
         JOIN input i ON i.buffer_id = b.id
       ),
       resolved AS (
         SELECT
           LTRIM(COALESCE(i.order_no, bs.order_no, ''), '0') AS order_key,
           COALESCE(i.order_no, bs.order_no) AS order_no,
           COALESCE(i.operation_no, bs.operation_no) AS operation_no,
           bs.id AS buffer_id
         FROM input i
         LEFT JOIN buffer_seed bs ON true
       ),
       sow_match AS (
         SELECT s.*
         FROM resolved r
         LEFT JOIN LATERAL (
           SELECT s.*
           FROM public.sow s
           WHERE LTRIM(COALESCE(s.order_no, ''), '0') = r.order_key
             AND (r.operation_no IS NULL OR s.operation_no = r.operation_no)
           ORDER BY
             CASE WHEN r.operation_no IS NOT NULL AND s.operation_no = r.operation_no THEN 0 ELSE 1 END,
             s.idsow DESC
           LIMIT 1
         ) s ON true
       ),
       timesheet_latest AS (
         SELECT t.*, w.machineid, w.workcenter_description
         FROM resolved r
         LEFT JOIN LATERAL (
           SELECT t.*
           FROM public.timesheet_transaction t
           WHERE LTRIM(COALESCE(t.order_no, ''), '0') = r.order_key
             AND (r.operation_no IS NULL OR t.operation_no = r.operation_no)
           ORDER BY COALESCE(t.longdate_checkout, t.longdate_checkin) DESC NULLS LAST, t.tsnumber DESC
           LIMIT 1
         ) t ON true
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
       ),
       buffer_latest AS (
         SELECT b.*, w.workcenter_description
         FROM resolved r
         LEFT JOIN LATERAL (
           SELECT b.*
           FROM public.buffer_transaction b
           WHERE LTRIM(COALESCE(b.order_no, ''), '0') = r.order_key
             AND (r.operation_no IS NULL OR b.operation_no = r.operation_no)
           ORDER BY b."timestamp" DESC NULLS LAST, b.id DESC
           LIMIT 1
         ) b ON true
         LEFT JOIN public.workcenter w ON w.machineid = b.machine_id
       ),
       hours AS (
         SELECT
           COALESCE(MAX(s.planhours), MAX(t.planhours), 0)::numeric AS planhours,
           COALESCE(
             MAX(s.actual_hours),
             SUM(
               COALESCE(
                 t.duration,
                 CASE
                   WHEN t.longdate_checkin IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (COALESCE(t.longdate_checkout, NOW()) - t.longdate_checkin)) / 3600.0
                   ELSE 0
                 END
               )
             ),
             0
           )::numeric AS actual_hours
         FROM resolved r
         LEFT JOIN public.sow s
           ON LTRIM(COALESCE(s.order_no, ''), '0') = r.order_key
          AND (r.operation_no IS NULL OR s.operation_no = r.operation_no)
         LEFT JOIN public.timesheet_transaction t
           ON LTRIM(COALESCE(t.order_no, ''), '0') = r.order_key
          AND (r.operation_no IS NULL OR t.operation_no = r.operation_no)
       ),
       detail AS (
         SELECT
           r.order_key,
           COALESCE(r.order_no, s.order_no, t.order_no, b.order_no) AS order_no,
           COALESCE(r.operation_no, s.operation_no, t.operation_no, b.operation_no) AS operation_no,
           COALESCE(NULLIF(s.operation_text, ''), NULLIF(t.operation_text, ''), NULLIF(b.operation_text, ''), '-') AS operation_text,
           COALESCE(NULLIF(b.machine_id, ''), NULLIF(t.machineid, ''), NULLIF(s.workcenter, ''), '-') AS machine_id,
           COALESCE(NULLIF(b.workcenter_description, ''), NULLIF(t.workcenter_description, ''), NULLIF(s.workcenterdescription, ''), '-') AS machine_description,
           COALESCE(NULLIF(s.part_name, ''), NULLIF(t.part_name, ''), NULLIF(b.component_label, ''), '-') AS part_name,
           COALESCE(NULLIF(s.ssbr_id, ''), NULLIF(t.ssbr_id, ''), NULLIF(b.ssbr_id, ''), '-') AS ssbr_id,
           ROUND(COALESCE(h.actual_hours, 0)::numeric, 2) AS actual_hours,
           ROUND(COALESCE(h.planhours, 0)::numeric, 2) AS planhours
         FROM resolved r
         LEFT JOIN sow_match s ON true
         LEFT JOIN timesheet_latest t ON true
         LEFT JOIN buffer_latest b ON true
         LEFT JOIN hours h ON true
       ),
       movements AS (
         SELECT *
         FROM (
           SELECT
             'timesheet'::text AS source,
             'checkin'::text AS movement_type,
             t.longdate_checkin AS movement_at,
             t.order_no,
             t.operation_no,
             t.operation_text,
             COALESCE(w.machineid, t.workcentercode) AS machine_id,
             COALESCE(w.workcenter_description, t.workcenterdescription) AS machine_description,
             t.full_name AS actor,
             t.note,
             t.duration,
             t.tsnumber::text AS evidence_id
           FROM resolved r
           JOIN public.timesheet_transaction t
             ON LTRIM(COALESCE(t.order_no, ''), '0') = r.order_key
            AND (r.operation_no IS NULL OR t.operation_no = r.operation_no)
           LEFT JOIN LATERAL (
             SELECT w.*
             FROM public.workcenter w
             WHERE t.workcentercode = w.workcenternew
                OR t.workcentercode = w.workcenterold
                OR t.workcentercode = w.workcenterot
                OR t.workcentercode = w.machineid
             ORDER BY w.position NULLS LAST, w.idrow
             LIMIT 1
           ) w ON true
           WHERE t.longdate_checkin IS NOT NULL
           UNION ALL
           SELECT
             'timesheet'::text,
             'checkout'::text,
             t.longdate_checkout,
             t.order_no,
             t.operation_no,
             t.operation_text,
             COALESCE(w.machineid, t.workcentercode),
             COALESCE(w.workcenter_description, t.workcenterdescription),
             t.full_name,
             t.note,
             t.duration,
             t.tsnumber::text
           FROM resolved r
           JOIN public.timesheet_transaction t
             ON LTRIM(COALESCE(t.order_no, ''), '0') = r.order_key
            AND (r.operation_no IS NULL OR t.operation_no = r.operation_no)
           LEFT JOIN LATERAL (
             SELECT w.*
             FROM public.workcenter w
             WHERE t.workcentercode = w.workcenternew
                OR t.workcentercode = w.workcenterold
                OR t.workcentercode = w.workcenterot
                OR t.workcentercode = w.machineid
             ORDER BY w.position NULLS LAST, w.idrow
             LIMIT 1
           ) w ON true
           WHERE t.longdate_checkout IS NOT NULL
           UNION ALL
           SELECT
             'buffer'::text,
             b.type::text,
             b."timestamp",
             b.order_no,
             b.operation_no,
             b.operation_text,
             b.machine_id,
             w.workcenter_description,
             NULL::text,
             b.note,
             NULL::numeric,
             b.id::text
           FROM resolved r
           JOIN public.buffer_transaction b
             ON LTRIM(COALESCE(b.order_no, ''), '0') = r.order_key
            AND (r.operation_no IS NULL OR b.operation_no = r.operation_no)
           LEFT JOIN public.workcenter w ON w.machineid = b.machine_id
         ) chain
         WHERE movement_at IS NOT NULL
       )
       SELECT
         (SELECT row_to_json(detail) FROM detail) AS detail,
         COALESCE((
           SELECT json_agg(m ORDER BY m.movement_at ASC, m.source ASC)
           FROM (
             SELECT *
             FROM movements
             ORDER BY movement_at ASC, source ASC
             LIMIT 120
           ) m
         ), '[]'::json) AS movements`,
      [
        orderNo || null,
        Number.isFinite(operationNo) ? operationNo : null,
        Number.isFinite(bufferId) ? bufferId : null,
      ]
    );

    res.json(result.rows[0] || { detail: null, movements: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.refreshBoard = async (_req, res) => {
  try {
    await db.query(`SELECT public.refresh_mv_kanban_order_board()`);
    const result = await db.query(
      `SELECT MAX(refreshed_at) AS refreshed_at, COUNT(*)::int AS total_cards
       FROM public.mv_kanban_order_board`
    );
    res.json({ data: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
