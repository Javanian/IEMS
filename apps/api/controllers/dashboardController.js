const pool = global.pool || require("../db");
const sapPool = require("../dbStaging");
const { resolveTimezone } = require("../config/timezone");
const { classifySapError } = require("../utils/sapErrorClassifier");
const ExcelJS = require("exceljs");

// Timezone comes from the root .env (TIMEZONE). Never hardcode it here: the daily buckets
// below compare against CURRENT_DATE, which follows the Postgres session timezone, so a
// mismatched literal silently shifts rows into the wrong calendar day.
const TZ = resolveTimezone();


const meta = () => ({ generated_at: new Date().toISOString() });

// ── Plant scope ────────────────────────────────────────────────────────────
// Setiap server hanya menampilkan staging plant-nya sendiri (PLANT_SSB dari env;
// kosong di dev = tanpa filter). Dipakai di SEMUA query sap_* supaya operator
// Cikupa tidak melihat baris Balikpapan dan sebaliknya.
const PLANT_SSB = /^\d{4}$/.test(process.env.PLANT_SSB || "") ? process.env.PLANT_SSB : null;
const PW_SQL = PLANT_SSB ? ` AND werks = '${PLANT_SSB}'` : ""; // query tanpa alias
const plantScope = (alias = "st") => (PLANT_SSB ? ` AND ${alias}.werks = '${PLANT_SSB}'` : "");
let operationsHubCache = null;
const OPERATIONS_HUB_TTL_MS = 30 * 1000;

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function refreshOrderMatviews() {
  try {
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_plan_vs_actual");
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_activity_detail");
  } catch (err) {
    console.error("refreshOrderMatviews error:", err.message);
  }
}

// GET /dashboard/order-progress — plan vs actual per order with weight-based progress
async function getOrderProgress(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const status = req.query.status || 'all';
    const filter = req.query.filter || '';

    const where = [];
    if (status === 'ongoing') {
      where.push(`m.order_no NOT IN (
        SELECT LTRIM(order_no, '0') FROM ph3_order WHERE order_description ILIKE '%TECO%'
      )`);
    }
    if (filter === 'red') {
      where.push("m.total_actual_hours >= m.total_planhours");
    } else if (filter === 'yellow') {
      where.push("m.total_actual_hours >= m.total_planhours * 0.9 AND m.total_actual_hours < m.total_planhours");
    }

    // Fase 6 (D4): mv_order_plan_vs_actual menjumlahkan SELURUH sow.planhours, termasuk operasi
    // yang ditandai subcont. Matview tidak bisa diberi predikat eksklusi tanpa DROP+CREATE, jadi
    // koreksinya dilakukan di sini: jam subcont per order dikurangkan dari total_planhours, dan
    // actual_pct / is_exceeded dihitung ulang dari nilai yang sudah dikoreksi. Tanpa ini, layar
    // Order Progress melaporkan beban internal yang berbeda dari endpoint lain untuk order yang sama.
    // Filter di CTE subcont SENGAJA menyalin filter matview (planhours NOT NULL + non-TECO/CLSD)
    // supaya tidak mengurangi jam yang memang tidak pernah ikut dijumlahkan.
    const MV_ADJUSTED = `
      WITH subcont AS (
        SELECT ltrim(s.order_no, '0') AS order_key,
               SUM(COALESCE(s.planhours, 0)) AS subcont_planhours
          FROM public.sow s
         WHERE s.planhours IS NOT NULL
           AND COALESCE(s.systemstatus, '') NOT IN ('TECO', 'CLSD')
           AND EXISTS (
                 SELECT 1 FROM public.sow_subcont_mark scm
                  WHERE ltrim(scm.order_no, '0') = ltrim(s.order_no, '0')
                    AND scm.operation_no = s.operation_no
                    AND scm.unmarked_at IS NULL)
         GROUP BY 1
      ),
      mv_adj AS (
        SELECT v.order_no, v.customer, v.part_name, v.model, v.ssbr_id,
               v.operation_count, v.weighted_progress, v.total_actual_hours,
               GREATEST(v.total_planhours - COALESCE(sc.subcont_planhours, 0), 0) AS total_planhours,
               COALESCE(sc.subcont_planhours, 0) AS total_planhours_subcont,
               ROUND((v.total_actual_hours / NULLIF(GREATEST(v.total_planhours - COALESCE(sc.subcont_planhours, 0), 0), 0)) * 100, 1) AS actual_pct,
               (v.total_actual_hours >= GREATEST(v.total_planhours - COALESCE(sc.subcont_planhours, 0), 0)) AS is_exceeded
          FROM mv_order_plan_vs_actual v
          LEFT JOIN subcont sc ON sc.order_key = ltrim(v.order_no, '0')
      )`;
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const baseQuery = `${MV_ADJUSTED} SELECT m.* FROM mv_adj m ${whereClause}`;
    const countQuery = `${MV_ADJUSTED} SELECT COUNT(*)::int AS total FROM mv_adj m ${whereClause}`;

    const [totalResult, rowsResult] = await Promise.all([
      pool.query(countQuery),
      pool.query(`${baseQuery} ORDER BY actual_pct DESC NULLS LAST, total_planhours DESC LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);

    res.json({
      data: rowsResult.rows.map(r => ({
        ...r,
        total_planhours: num(r.total_planhours),
        total_actual_hours: num(r.total_actual_hours),
        weighted_progress: num(r.weighted_progress),
        actual_pct: num(r.actual_pct, 0),
      })),
      pagination: { page, limit, total: totalResult.rows[0]?.total || 0 },
      meta: meta(),
    });
  } catch (err) {
    console.error("order-progress error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/order-activity-detail — per-activity breakdown for an order
async function getOrderActivityDetail(req, res) {
  try {
    const { orderNo } = req.params;
    if (!orderNo) return res.status(400).json({ error: "orderNo required" });

    const result = await pool.query(
      `SELECT * FROM mv_order_activity_detail WHERE order_no = $1 ORDER BY operation_no`,
      [orderNo]
    );

    res.json({
      data: result.rows.map(r => ({
        ...r,
        planhours: num(r.planhours),
        actual_hours: num(r.actual_hours),
        weight: num(r.weight),
        progress: num(r.progress),
      })),
      meta: meta(),
    });
  } catch (err) {
    console.error("order-activity-detail error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operation-timesheet-history — timesheet history per operation
async function getOperationTimesheetHistory(req, res) {
  try {
    const { orderNo, operationNo } = req.query;
    if (!orderNo || !operationNo) return res.status(400).json({ error: "orderNo and operationNo required" });

    const result = await pool.query(
      `SELECT
         serialnumber, full_name,
         DATE((longdate_checkin AT TIME ZONE '${TZ}'))::text AS work_date,
         ROUND(SUM(duration)::numeric, 2) AS total_hours,
         COUNT(*)::int AS entry_count
       FROM timesheet_transaction
       WHERE order_no = $1
         AND operation_no::integer = $2::integer
         AND state_flag != 5
         AND duration IS NOT NULL
       GROUP BY serialnumber, full_name, DATE((longdate_checkin AT TIME ZONE '${TZ}'))
       ORDER BY work_date ASC, serialnumber ASC`,
      [orderNo, operationNo]
    );

    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("operation-timesheet-history error:", err);
    res.status(500).json({ error: err.message });
  }
}

async function getOperationsHub(req, res) {
  let client;
  try {
    if (operationsHubCache && Date.now() - operationsHubCache.createdAt < OPERATIONS_HUB_TTL_MS) {
      res.set("X-Cache", "HIT");
      res.json(operationsHubCache.payload);
      return;
    }

    client = await pool.connect();
    const q = (text, params) => client.query(text, params);
    const [
      overview,
      machineTrend,
      machineStatus,
      progressStatus,
      sapPosting,
      laborByWorkcenter,
      topOperators,
    ] = await Promise.all([
      q(`
        WITH latest_machine_day AS (
          SELECT MAX(startdatetime::date) AS day
          FROM public.mch_productiondata
        ),
        machine_day AS (
          SELECT
            p.statusid,
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(p.enddatetime, p.startdatetime) - p.startdatetime)), 0) AS seconds
          FROM public.mch_productiondata p
          JOIN latest_machine_day d ON p.startdatetime::date = d.day
        ),
        latest_labor_day AS (
          SELECT MAX((longdate_checkin AT TIME ZONE '${TZ}')::date) AS day
          FROM public.timesheet_transaction
          WHERE state_flag != 5
        ),
        sow_avg AS (
          SELECT ROUND(AVG(progress) FILTER (WHERE progress IS NOT NULL), 1) AS avg_progress
          FROM public.sow
        ),
        ph3_kpi AS (
          SELECT
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (WHERE NOT has_teco)::int AS active_orders,
            COUNT(*) FILTER (WHERE has_teco)::int AS teco_orders
          FROM (
            SELECT TRIM(order_no) AS order_no,
                   bool_or(order_description = 'TECO') AS has_teco
            FROM public.ph3_order
            GROUP BY 1
          ) o
        ),
        -- Pembagian ACTIVE orders: "on going" = sudah punya record di timesheet
        -- ATAU mch_transaction; "not started" = belum punya transaction sama sekali.
        -- Pakai LEFT JOIN ke set order_no yang muncul di tiap tabel (hash join satu
        -- pass) — subquery EXISTS per-order terlalu lambat (query read timeout).
        order_activity_kpi AS (
          SELECT
            COUNT(*) FILTER (WHERE t.o IS NOT NULL OR m.o IS NOT NULL)::int AS ongoing_orders,
            COUNT(*) FILTER (WHERE t.o IS NULL AND m.o IS NULL)::int AS not_started_orders
          FROM (
            SELECT TRIM(order_no) AS order_no,
                   bool_or(order_description = 'TECO') AS has_teco
            FROM public.ph3_order
            GROUP BY 1
          ) o
          LEFT JOIN (
            SELECT DISTINCT TRIM(order_no) AS o
            FROM public.timesheet_transaction
            WHERE state_flag != 5
          ) t ON t.o = o.order_no
          LEFT JOIN (
            SELECT DISTINCT TRIM(order_no) AS o
            FROM public.mch_transaction
          ) m ON m.o = o.order_no
          WHERE NOT has_teco
        ),
        validation_kpi AS (
          SELECT
            COUNT(*) FILTER (
              WHERE validation_date IS NULL
                AND COALESCE(state_flag::text, '') NOT IN ('3', '5')
            )::int AS validation_pending,
            COUNT(*)::int AS validation_total
          FROM public.timesheet_transaction
          WHERE (longdate_checkin AT TIME ZONE '${TZ}')::date = CURRENT_DATE
        )
        SELECT
          COALESCE(p.total_orders, 0) AS total_orders,
          COALESCE(p.active_orders, 0) AS active_orders,
          COALESCE(p.teco_orders, 0) AS teco_orders,
          COALESCE(oa.ongoing_orders, 0) AS ongoing_orders,
          COALESCE(oa.not_started_orders, 0) AS not_started_orders,
          COALESCE(a.avg_progress, 0)::float AS avg_progress,
          COALESCE(v.validation_pending, 0) AS validation_pending,
          COALESCE(v.validation_total, 0) AS validation_total,
          COALESCE((
            SELECT ROUND(SUM(duration), 2)::float
            FROM public.timesheet_transaction t
            JOIN latest_labor_day d ON (t.longdate_checkin AT TIME ZONE '${TZ}')::date = d.day
            WHERE t.state_flag != 5
          ), 0) AS latest_labor_hours,
          COALESCE((
            SELECT ROUND(SUM(seconds) / 3600.0, 2)::float
            FROM machine_day
          ), 0) AS latest_machine_hours,
          COALESCE((
            SELECT ROUND(SUM(CASE WHEN statusid IN (1, 2) THEN seconds ELSE 0 END) / NULLIF(SUM(seconds), 0) * 100.0, 1)::float
            FROM machine_day
          ), 0) AS machine_productive_pct,
          (SELECT to_char(day, 'YYYY-MM-DD') FROM latest_machine_day) AS machine_date,
          (SELECT to_char(day, 'YYYY-MM-DD') FROM latest_labor_day) AS labor_date
        FROM ph3_kpi p
        CROSS JOIN sow_avg a
        CROSS JOIN validation_kpi v
        CROSS JOIN order_activity_kpi oa
      `),
      q(`
        WITH daily AS (
          SELECT
            startdatetime::date AS day,
            SUM(CASE WHEN statusid IN (1, 2) THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(enddatetime, startdatetime) - startdatetime)), 0) ELSE 0 END) / 3600.0 AS productive_hours,
            SUM(CASE WHEN statusid NOT IN (1, 2) THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(enddatetime, startdatetime) - startdatetime)), 0) ELSE 0 END) / 3600.0 AS support_loss_hours,
            SUM(GREATEST(EXTRACT(EPOCH FROM (COALESCE(enddatetime, startdatetime) - startdatetime)), 0)) / 3600.0 AS total_hours
          FROM public.mch_productiondata
          GROUP BY startdatetime::date
          ORDER BY startdatetime::date DESC
          LIMIT 7
        )
        SELECT
          to_char(day, 'DD Mon') AS label,
          to_char(day, 'YYYY-MM-DD') AS day,
          ROUND(productive_hours, 2)::float AS productive_hours,
          ROUND(support_loss_hours, 2)::float AS support_loss_hours,
          ROUND(total_hours, 2)::float AS total_hours,
          ROUND(productive_hours / NULLIF(total_hours, 0) * 100.0, 1)::float AS productive_pct
        FROM daily
        ORDER BY day
      `),
      q(`
        WITH latest_machine_day AS (
          SELECT MAX(startdatetime::date) AS day
          FROM public.mch_productiondata
        )
        SELECT
          COALESCE(st.description, 'Unknown') AS status,
          COUNT(*)::int AS event_count,
          ROUND(SUM(GREATEST(EXTRACT(EPOCH FROM (COALESCE(p.enddatetime, p.startdatetime) - p.startdatetime)), 0)) / 3600.0, 2)::float AS hours
        FROM public.mch_productiondata p
        JOIN latest_machine_day d ON p.startdatetime::date = d.day
        LEFT JOIN public.mch_statustypes st ON st.statusid = p.statusid
        GROUP BY COALESCE(st.description, 'Unknown')
        ORDER BY hours DESC, event_count DESC
        LIMIT 8
      `),
      q(`
        SELECT
          COALESCE(NULLIF(workcenter, ''), 'No Workcenter') AS label,
          ROUND(COALESCE(AVG(progress) FILTER (WHERE progress IS NOT NULL), 0), 1)::float AS value,
          COUNT(*)::int AS operation_count,
          ROUND(COALESCE(SUM(planhours), 0), 2)::float AS plan_hours
        FROM public.sow
        WHERE COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
          -- Phase 6 (D4): plan_hours here is internal workshop load per workcenter.
          -- Operations marked as subcontracted are done by a vendor, so their hours are
          -- dropped. DEPLOY NOTE: public.sow_subcont_mark only exists after migration
          -- database/migrations/api/20260803b_sow_subcont_mark.sql — migrate first, then
          -- deploy, otherwise this endpoint returns 500 (undefined_table).
          AND NOT EXISTS (
            SELECT 1 FROM public.sow_subcont_mark scm
            WHERE ltrim(scm.order_no, '0') = ltrim(sow.order_no, '0')
              AND scm.operation_no = sow.operation_no
              AND scm.unmarked_at IS NULL
          )
        GROUP BY COALESCE(NULLIF(workcenter, ''), 'No Workcenter')
        ORDER BY operation_count DESC
        LIMIT 6
      `),
      q(`
        SELECT
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE UPPER(COALESCE(status,'')) = 'PENDING'${PW_SQL})::int AS pending,
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE UPPER(COALESCE(status,'')) = 'FAILED'${PW_SQL})::int AS failed,
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE UPPER(COALESCE(status,'')) = 'POSTED' AND created_at >= now() - interval '7 days'${PW_SQL})::int AS posted_7d,
          (SELECT COUNT(*) FROM public.sap_timesheet_staging WHERE created_at >= now() - interval '7 days'${PW_SQL})::int AS staged_7d
      `),
      q(`
        WITH base AS (
          SELECT
            COALESCE(NULLIF(BTRIM(workcentercode), ''), '-') AS wc,
            workcenterdescription AS wd,
            duration::float AS d,
            activitytype,
            order_no
          FROM public.timesheet_transaction
          WHERE longdate_checkin >= now() - interval '24 hours'
            AND COALESCE(state_flag, 1) <> 5
            AND COALESCE(duration, 0) > 0
        )
        SELECT
          wc AS workcenter,
          MAX(wd) AS workcenter_name,
          ROUND(SUM(d)::numeric, 1)::float AS total_hours,
          ROUND(COALESCE(SUM(d) FILTER (
            WHERE activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          ), 0)::numeric, 1)::float AS productive_hours
        FROM base
        GROUP BY wc
        ORDER BY total_hours DESC
        LIMIT 8
      `),
      q(`
        WITH base AS (
          SELECT
            COALESCE(NULLIF(BTRIM(full_name), ''), NULLIF(BTRIM(serialnumber), ''), 'UNKNOWN') AS name,
            duration::float AS d,
            activitytype,
            order_no
          FROM public.timesheet_transaction
          WHERE longdate_checkin >= now() - interval '24 hours'
            AND COALESCE(state_flag, 1) <> 5
            AND COALESCE(duration, 0) > 0
        )
        SELECT
          name,
          ROUND(COALESCE(SUM(d) FILTER (
            WHERE activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
          ), 0)::numeric, 1)::float AS productive_hours,
          ROUND(SUM(d)::numeric, 1)::float AS total_hours
        FROM base
        GROUP BY name
        ORDER BY productive_hours DESC, total_hours DESC
        LIMIT 8
      `),
    ]);

    const overviewRow = overview.rows[0] || {};
    const payload = {
      data: {
        kpi: {
          total_orders: num(overviewRow.total_orders),
          active_orders: num(overviewRow.active_orders),
          teco_orders: num(overviewRow.teco_orders),
          ongoing_orders: num(overviewRow.ongoing_orders),
          not_started_orders: num(overviewRow.not_started_orders),
          latest_labor_hours: num(overviewRow.latest_labor_hours),
          latest_machine_hours: num(overviewRow.latest_machine_hours),
          avg_progress: num(overviewRow.avg_progress),
          validation_pending: num(overviewRow.validation_pending),
          validation_total: num(overviewRow.validation_total),
          machine_productive_pct: num(overviewRow.machine_productive_pct),
        },
        basis_dates: {
          machine_date: overviewRow.machine_date || null,
          labor_date: overviewRow.labor_date || null,
        },
        machine_trend: machineTrend.rows,
        machine_status: machineStatus.rows,
        progress_status: progressStatus.rows,
        sap_posting: sapPosting.rows[0] || {},
        labor_by_workcenter: laborByWorkcenter.rows,
        top_operators: topOperators.rows,
      },
      meta: meta(),
    };

    operationsHubCache = { createdAt: Date.now(), payload };
    res.set("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error("dashboard operations-hub error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
}

// GET /dashboard/sap-timesheet-staging-log
async function getSapTimesheetStagingLog(req, res) {
  try {
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 30));
    const cursor = Number.parseInt(req.query.cursor, 10);
    const status = String(req.query.status || "all").toUpperCase();
    const search = String(req.query.search || "").trim();

    const where = [];
    const params = [];

    if (Number.isFinite(cursor) && cursor > 0) {
      params.push(cursor);
      where.push(`id < $${params.length}`);
    }

    if (status !== "ALL") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (PLANT_SSB) where.push(`werks = '${PLANT_SSB}'`);

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(
        source_key ILIKE $${idx}
        OR source_ref_id ILIKE $${idx}
        OR ztimesheetid ILIKE $${idx}
        OR pernr ILIKE $${idx}
        OR aufnr ILIKE $${idx}
        OR vornr ILIKE $${idx}
        OR arbpl ILIKE $${idx}
        OR sap_response_text ILIKE $${idx}
        OR sap_error ILIKE $${idx}
        OR payload::text ILIKE $${idx}
        OR sap_response::text ILIKE $${idx}
        OR id IN (SELECT staging_id FROM public.sap_staging_source WHERE source_row_id ILIKE $${idx})
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit + 1);

    const result = await sapPool.query(
      `
      SELECT
        id,
        ztimesheetid,
        source_system,
        source_key,
        source_ref_id,
        werks,
        pernr,
        rueck,
        aufnr,
        vornr,
        arbpl,
        lstar,
        isdd,
        isdz,
        iedd,
        iedz,
        total_seconds,
        source_row_count,
        status,
        payload,
        sap_response,
        sap_response_text,
        sap_error,
        posted_at,
        created_at,
        updated_at
      FROM public.sap_timesheet_staging
      ${whereClause}
      ORDER BY id DESC
      LIMIT $${params.length}
      `,
      params
    );

    const rows = result.rows.slice(0, limit);
    const extraRow = result.rows[limit];

    // Terjemahkan pesan SAP jadi sebab yang bisa ditindak — di server, supaya label
    // konsisten dengan pengelompokan di endpoint ringkasan (satu classifier).
    const enriched = rows.map((row) => {
      const cause = classifySapError(row.sap_error || row.sap_response_text);
      return {
        ...row,
        cause_key: cause.key,
        cause_label: cause.label,
        cause_action: cause.action,
      };
    });

    res.json({
      data: enriched,
      pagination: {
        limit,
        next_cursor: extraRow ? rows[rows.length - 1]?.id || null : null,
        has_more: Boolean(extraRow),
      },
      meta: meta(),
    });
  } catch (err) {
    console.error("sap-timesheet-staging-log error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-timesheet-staging-summary
// Ringkasan antrian: hitungan per status + kegagalan dikelompokkan per SEBAB (bukan per
// baris) supaya "56 baris gagal karena work center yang sama" terbaca sekali pandang.
async function getSapTimesheetStagingSummary(req, res) {
  try {
    const [byStatus, dateRange, failing] = await Promise.all([
      sapPool.query(`
        SELECT status, COUNT(*)::int AS n
        FROM public.sap_timesheet_staging
        WHERE TRUE${PW_SQL}
        GROUP BY status
      `),
      sapPool.query(`
        SELECT
          MIN(bucket_start)::date AS oldest,
          MAX(bucket_start)::date AS newest,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND bucket_start::date = (now() AT TIME ZONE '${TZ}')::date)::int AS pending_today,
          COUNT(*) FILTER (WHERE status = 'POSTED'  AND posted_at::date   = (now() AT TIME ZONE '${TZ}')::date)::int AS posted_today
        FROM public.sap_timesheet_staging
        WHERE TRUE${PW_SQL}
      `),
      // Hanya FAILED + SKIPPED perlu triase. Ambil pesan mentah, klasifikasi di JS.
      sapPool.query(`
        SELECT id, status, sap_error, sap_response_text
        FROM public.sap_timesheet_staging
        WHERE status IN ('FAILED', 'SKIPPED')${PW_SQL}
        ORDER BY id DESC
      `),
    ]);

    const statusCounts = { PENDING: 0, POSTING: 0, POSTED: 0, FAILED: 0, SKIPPED: 0 };
    let total = 0;
    for (const r of byStatus.rows) {
      statusCounts[r.status] = r.n;
      total += r.n;
    }

    // Kelompokkan kegagalan per sebab.
    const groups = new Map();
    for (const r of failing.rows) {
      const cause = classifySapError(r.sap_error || r.sap_response_text);
      const g = groups.get(cause.key) || {
        cause_key: cause.key,
        label: cause.label,
        action: cause.action,
        count: 0,
        statuses: new Set(),
        sample_ids: [],
        sample_message: cause.message,
      };
      g.count += 1;
      g.statuses.add(r.status);
      if (g.sample_ids.length < 5) g.sample_ids.push(r.id);
      groups.set(cause.key, g);
    }
    const failures = [...groups.values()]
      .map((g) => ({ ...g, statuses: [...g.statuses] }))
      .sort((a, b) => b.count - a.count);

    res.json({
      data: {
        by_status: statusCounts,
        total,
        failing_total: failing.rows.length,
        oldest: dateRange.rows[0]?.oldest || null,
        newest: dateRange.rows[0]?.newest || null,
        pending_today: dateRange.rows[0]?.pending_today || 0,
        posted_today: dateRange.rows[0]?.posted_today || 0,
        failures,
      },
      meta: meta(),
    });
  } catch (err) {
    console.error("sap-timesheet-staging-summary error:", err);
    res.status(500).json({ error: err.message });
  }
}

// Kelayakan SAP = kolom status_record (satu sumber kebenaran; gerbang staging & kolom
// pakai logika productive/unproductive yang sama — migration 20260715_status_record_
// unproductive). Dashboard hanya menampilkan record non-0/3/4 (DISPLAY_EXCLUDE), jadi di
// antara yang tampil, status_record = TRUE berarti layak SAP.
const SAP_ELIGIBLE_SQL = "m.status_record";

const POSTED_EXISTS_SQL = `EXISTS (
  SELECT 1 FROM public.sap_staging_source s
  WHERE s.source_system = 'MCH_HOURS'
    AND s.source_row_id = m.proddataid::text
    AND s.posted_at IS NOT NULL
)`;

// Alasan sebuah baris TIDAK layak SAP — enumerable, untuk ditampilkan di drill.
// Label status diambil dari status_description (mch_statustypes) supaya tidak salah
// hardcode: 0=Off, 3=Downtime, 4=No Job.
// Alasan sebuah baris TIDAK layak (status_record = false). Hanya bermakna untuk record
// non-0/3/4 yang tampil di drill. Selaras dengan definisi status_record baru.
const INELIGIBLE_REASON_SQL = `CASE
  WHEN m.enddatetime IS NULL THEN 'Not finished (no end time)'
  WHEN NULLIF(btrim(m.sn_employee),'') IS NULL THEN 'No operator'
  WHEN m.status_activitytype IN ('M1','M2')
       AND (COALESCE(m.order_no,'') = '' OR COALESCE(m.operation_no,'') = '' OR COALESCE(m.confirmation_number,'') = '')
    THEN 'Order/operation not matched in SAP (no confirmation) — fix job'
  WHEN NULLIF(btrim(m.status_activitytype),'') IS NULL THEN 'No activity type'
  ELSE NULL
END`;

// Off (0), Downtime (3), No Job (4): bukan jam kerja nyata. Dikeluarkan TOTAL dari
// heatmap & drill — tidak dihitung sebagai jam, tidak muncul di daftar record.
const DISPLAY_EXCLUDE_SQL = "m.statusid NOT IN (0, 3, 4)";

function clampDateRange(fromRaw, toRaw, defaultDays = 7, maxDays = 62) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  let to = isDate(toRaw) ? new Date(`${toRaw}T00:00:00Z`) : new Date();
  let from = isDate(fromRaw) ? new Date(`${fromRaw}T00:00:00Z`) : null;
  const day = 86400000;
  if (!from) from = new Date(to.getTime() - (defaultDays - 1) * day);
  if (from > to) [from, to] = [to, from];
  // batasi rentang supaya tidak men-scan berbulan-bulan sekaligus
  if ((to - from) / day > maxDays) from = new Date(to.getTime() - maxDays * day);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

// GET /dashboard/machine-hours-matrix?from=&to=
// Matriks jam per operator per hari + overlay SAP (total / layak / terkirim).
async function getMachineHoursMatrix(req, res) {
  try {
    const { from, to } = clampDateRange(req.query.from, req.query.to);

    const result = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(btrim(m.sn_employee),''), '__none__') AS operator_key,
        COALESCE(NULLIF(btrim(m.full_name),''), '(operator kosong)') AS operator_name,
        (m.startdatetime AT TIME ZONE '${TZ}')::date AS day,
        ROUND(SUM(COALESCE(m.duration_hours,0))::numeric, 2) AS total_h,
        ROUND(SUM(COALESCE(m.duration_hours,0)) FILTER (WHERE ${SAP_ELIGIBLE_SQL})::numeric, 2) AS eligible_h,
        ROUND(SUM(COALESCE(m.duration_hours,0)) FILTER (WHERE ${POSTED_EXISTS_SQL})::numeric, 2) AS posted_h,
        COUNT(*)::int AS n_records
      FROM public.mch_transaction m
      WHERE m.startdatetime >= ($1::date)
        AND m.startdatetime <  (($2::date) + 1)
        AND ${DISPLAY_EXCLUDE_SQL}
      GROUP BY operator_key, operator_name, day
      HAVING SUM(COALESCE(m.duration_hours,0)) > 0
      `,
      [from, to]
    );

    // Bentuk ke: daftar hari, daftar operator (urut jam desc), sel per (operator,hari).
    const days = [];
    const dayCursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (dayCursor <= end) {
      days.push(dayCursor.toISOString().slice(0, 10));
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    }

    const opMap = new Map();
    const cells = {};
    for (const r of result.rows) {
      const dayStr = typeof r.day === "string" ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
      const op = opMap.get(r.operator_key) || {
        operator_key: r.operator_key, operator_name: r.operator_name,
        total_h: 0, eligible_h: 0, posted_h: 0, n_records: 0,
      };
      op.total_h += Number(r.total_h);
      op.eligible_h += Number(r.eligible_h || 0);
      op.posted_h += Number(r.posted_h || 0);
      op.n_records += r.n_records;
      opMap.set(r.operator_key, op);

      cells[`${r.operator_key}|${dayStr}`] = {
        total_h: Number(r.total_h),
        eligible_h: Number(r.eligible_h || 0),
        posted_h: Number(r.posted_h || 0),
        n_records: r.n_records,
      };
    }

    const operators = [...opMap.values()].sort((a, b) => b.total_h - a.total_h);
    const totals = operators.reduce(
      (acc, o) => {
        acc.total_h += o.total_h; acc.eligible_h += o.eligible_h;
        acc.posted_h += o.posted_h; acc.n_records += o.n_records;
        if (o.operator_key === "__none__") acc.unattributed_h += o.total_h;
        return acc;
      },
      { total_h: 0, eligible_h: 0, posted_h: 0, n_records: 0, unattributed_h: 0 }
    );
    for (const k of ["total_h", "eligible_h", "posted_h", "unattributed_h"]) totals[k] = Math.round(totals[k] * 10) / 10;

    res.json({ data: { from, to, days, operators, cells, totals }, meta: meta() });
  } catch (err) {
    console.error("machine-hours-matrix error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/machine-hours-records?operator=&day=&bucket=
// Drill: record mch_transaction untuk satu (operator, hari). bucket opsional:
// eligible | posted | ineligible.
async function getMachineHoursRecords(req, res) {
  try {
    const operator = String(req.query.operator || "").trim();
    const day = String(req.query.day || "").trim();
    const bucket = String(req.query.bucket || "all").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: "Parameter 'day' harus YYYY-MM-DD" });
    }

    const params = [day];
    const where = [
      `(m.startdatetime AT TIME ZONE '${TZ}')::date = $1::date`,
      DISPLAY_EXCLUDE_SQL, // Off + No Job dikeluarkan dari drill
    ];
    if (operator === "__none__") {
      where.push(`NULLIF(btrim(m.sn_employee),'') IS NULL`);
    } else if (operator) {
      params.push(operator);
      where.push(`m.sn_employee = $${params.length}`);
    }
    if (bucket === "eligible") where.push(`${SAP_ELIGIBLE_SQL} AND NOT ${POSTED_EXISTS_SQL}`);
    else if (bucket === "posted") where.push(POSTED_EXISTS_SQL);
    else if (bucket === "ineligible") where.push(`NOT ${SAP_ELIGIBLE_SQL}`);

    const result = await pool.query(
      `
      SELECT
        m.proddataid,
        m.order_no, m.operation_no, m.confirmation_number, m.operation_short_text,
        m.machineid, m.machinename, m.workcentercode,
        m.startdatetime, m.enddatetime,
        ROUND(COALESCE(m.duration_hours,0)::numeric, 2) AS duration_hours,
        m.statusid, m.status_description, m.status_activitytype,
        m.full_name, m.sn_employee,
        ${SAP_ELIGIBLE_SQL} AS eligible,
        ${POSTED_EXISTS_SQL} AS posted,
        ${INELIGIBLE_REASON_SQL} AS ineligible_reason
      FROM public.mch_transaction m
      WHERE ${where.join(" AND ")}
      ORDER BY m.startdatetime
      LIMIT 500
      `,
      params
    );

    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("machine-hours-records error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/ph3-jobs?search=&limit=
// Picker job dari ph3_order untuk koreksi manual (edit job). Satu baris per
// (order_no, operation_no), ambil yang terbaru (id DESC) — konsisten dengan ETL.
async function getPh3Jobs(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    // Naikkan limit: satu order bisa punya banyak operasi. Limit lama (30/50) + urutan
    // TEKS memotong operasi ber-nomor besar (mis. op '70' kalah dari '1600' secara teks).
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const params = [];
    let filter = "COALESCE(order_no,'') <> '' AND COALESCE(operation_no,'') <> ''";
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      filter += ` AND (order_no ILIKE $${i} OR operation_short_text ILIKE $${i} OR order_description ILIKE $${i} OR confirmation_number ILIKE $${i})`;
    }
    params.push(limit);

    // DISTINCT ON dedup (operasi terbaru per order+op), lalu urutkan operation_no ASCENDING
    // secara NUMERIK (bukan teks) — 10 < 70 < 150 < 1600, bukan 10 < 150 < 1600 < 70.
    const result = await pool.query(
      `
      SELECT order_no, operation_no, confirmation_number,
        operation_short_text, order_description, work_center, cost_center
      FROM (
        SELECT DISTINCT ON (order_no, operation_no)
          order_no, operation_no, confirmation_number,
          operation_short_text, order_description, work_center, cost_center
        FROM public.ph3_order
        WHERE ${filter}
        ORDER BY order_no, operation_no, id DESC
      ) x
      ORDER BY order_no,
        (CASE WHEN operation_no ~ '^[0-9]+$' THEN operation_no::bigint ELSE 9999999999 END),
        operation_no
      LIMIT $${params.length}
      `,
      params
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("ph3-jobs error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operators?search=
// Picker operator dari usernfc untuk koreksi manual (assign operator).
async function getOperators(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const params = [];
    let filter = "NULLIF(btrim(snssb),'') IS NOT NULL";
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      filter += ` AND (full_name ILIKE $${i} OR snssb ILIKE $${i})`;
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT DISTINCT snssb, full_name FROM public.usernfc
        WHERE ${filter}
        ORDER BY full_name
        LIMIT $${params.length}`,
      params
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("operators error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /dashboard/machine-hours-override
// Koreksi manual satu record mch_transaction: assign job (dari ph3_order) dan/atau
// operator (snssb). Diterapkan LANGSUNG ke mch_transaction + dicatat di
// mch_transaction_override supaya bertahan re-derivasi ETL (lihat migration).
async function saveMachineHoursOverride(req, res) {
  const client = await pool.connect();
  try {
    const proddataid = parseInt(req.body?.proddataid, 10);
    const orderNo = req.body?.order_no ? String(req.body.order_no).trim() : null;
    const operationNo = req.body?.operation_no ? String(req.body.operation_no).trim() : null;
    const snEmployee = req.body?.sn_employee ? String(req.body.sn_employee).trim() : null;
    const note = req.body?.note ? String(req.body.note).trim() : null;
    const by = req.header("x-user-id") || null;

    if (!Number.isFinite(proddataid)) {
      return res.status(400).json({ error: "proddataid is required" });
    }
    if (orderNo && !operationNo) {
      return res.status(400).json({ error: "operation_no is required when order_no is set" });
    }
    if (!orderNo && !snEmployee) {
      return res.status(400).json({ error: "Nothing to change (set a job or operator)" });
    }

    // Tolak kalau sudah terkirim ke SAP — koreksi butuh storno, bukan edit senyap.
    const posted = await client.query(
      `SELECT 1 FROM public.sap_staging_source
        WHERE source_system='MCH_HOURS' AND source_row_id=$1::text AND posted_at IS NOT NULL LIMIT 1`,
      [proddataid]
    );
    if (posted.rows.length > 0) {
      return res.status(409).json({ error: "Record already sent to SAP. A correction needs a storno in SAP first." });
    }

    await client.query("BEGIN");

    if (orderNo) {
      // Ambil field job dari ph3_order (terbaru) + SOW untuk workcenter/ssbr.
      const upd = await client.query(
        `
        WITH j AS (
          SELECT * FROM public.ph3_order
          WHERE order_no = $2 AND operation_no = $3
          ORDER BY id DESC LIMIT 1
        ),
        s AS (
          SELECT ssbr_id, workcenter FROM public.sow
          WHERE COALESCE(NULLIF(ltrim(trim(coalesce(order_no,'')),'0'),''),'0') = COALESCE(NULLIF(ltrim(trim($2),'0'),''),'0')
            AND COALESCE(NULLIF(ltrim(trim(operation_no::text),'0'),''),'0') = COALESCE(NULLIF(ltrim(trim($3),'0'),''),'0')
          LIMIT 1
        )
        UPDATE public.mch_transaction m SET
          order_no = j.order_no,
          operation_no = j.operation_no,
          confirmation_number = j.confirmation_number,
          operation_short_text = j.operation_short_text,
          operation_description = j.operation_description,
          sequence_category = j.sequence_category,
          sequence_number = j.sequence_number,
          branch_operation_no = j.branch_operation_no,
          return_operation_no = j.return_operation_no,
          cost_center = j.cost_center,
          material_no = j.material_no,
          material_description = j.material_description,
          ssbr_id = COALESCE((SELECT ssbr_id FROM s), m.ssbr_id),
          workcentercode = COALESCE((SELECT workcenter FROM s), m.workcentercode),
          refreshed_at = now()
        FROM j
        WHERE m.proddataid = $1
        RETURNING m.proddataid
        `,
        [proddataid, orderNo, operationNo]
      );
      if (upd.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: `Job ${orderNo}/${operationNo} not found in ph3_order, or record not found` });
      }
    }

    if (snEmployee) {
      await client.query(
        `
        UPDATE public.mch_transaction m SET
          sn_employee = $2,
          full_name = COALESCE((SELECT full_name FROM public.usernfc WHERE snssb = $2 LIMIT 1), m.full_name),
          refreshed_at = now()
        WHERE m.proddataid = $1
        `,
        [proddataid, snEmployee]
      );
    }

    // Catat override (bertahan re-derivasi). Merge dengan yang ada.
    await client.query(
      `
      INSERT INTO public.mch_transaction_override (proddataid, order_no, operation_no, sn_employee, note, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (proddataid) DO UPDATE SET
        order_no = COALESCE(EXCLUDED.order_no, mch_transaction_override.order_no),
        operation_no = COALESCE(EXCLUDED.operation_no, mch_transaction_override.operation_no),
        sn_employee = COALESCE(EXCLUDED.sn_employee, mch_transaction_override.sn_employee),
        note = COALESCE(EXCLUDED.note, mch_transaction_override.note),
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      `,
      [proddataid, orderNo, operationNo, snEmployee, note, by]
    );

    await client.query("COMMIT");

    // Kembalikan record terbaru + status kelayakan.
    const fresh = await pool.query(
      `
      SELECT m.proddataid, m.order_no, m.operation_no, m.confirmation_number,
        m.machineid, m.full_name, m.sn_employee,
        ROUND(COALESCE(m.duration_hours,0)::numeric,2) AS duration_hours,
        ${SAP_ELIGIBLE_SQL} AS eligible,
        ${INELIGIBLE_REASON_SQL} AS ineligible_reason
      FROM public.mch_transaction m WHERE m.proddataid = $1
      `,
      [proddataid]
    );
    res.json({ data: fresh.rows[0] || null, meta: meta() });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    console.error("machine-hours-override error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// POST /dashboard/sap-ops/enqueue
// Titipkan permintaan operasi (stage_catchup / retry_failed) ke antrian sap_ops_request.
// API TIDAK menjalankan Python — worker (ops_worker.py) yang mengeksekusi. Lihat migration
// 20260715_sap_ops_request untuk alasannya.
async function enqueueSapOps(req, res) {
  const ALLOWED = new Set(["stage_catchup", "retry_failed", "rebuild_pending", "post_corrections", "post_bundles", "post_date", "post_operator", "recalc_date"]);
  try {
    const action = String(req.body?.action || "").trim();
    if (!ALLOWED.has(action)) {
      return res.status(400).json({ error: `Unknown action: ${action || "(empty)"}` });
    }
    const requestedBy = req.header("x-user-id") || null;
    const params = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};

    // Validasi param wajib per aksi.
    if (action === "rebuild_pending") {
      const fromDate = String(params.from_date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
        return res.status(400).json({ error: "from_date (YYYY-MM-DD) is required for rebuild_pending" });
      }
    }
    if (action === "post_bundles" || action === "post_corrections") {
      const ids = Array.isArray(params.ids) ? params.ids.filter((v) => String(v).trim()) : [];
      if (!ids.length) {
        return res.status(400).json({ error: "ids (array) is required for " + action });
      }
    }
    if (action === "post_date" || action === "recalc_date") {
      const date = String(params.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date (YYYY-MM-DD) is required for " + action });
      }
    }
    if (action === "post_operator") {
      const pernr = String(params.pernr || "").trim();
      if (!pernr) {
        return res.status(400).json({ error: "pernr is required for post_operator" });
      }
    }

    // Self-heal: buang QUEUED basi (>15 mnt tak diproses = worker tak konsumsi antrian)
    // supaya tombol tak 409 selamanya kalau ops_worker mati/salah DB. RUNNING tidak
    // disentuh di sini (hindari double-run); ops_worker sendiri mereset RUNNING yatim.
    await sapPool.query(
      `DELETE FROM public.sap_ops_request
       WHERE action = $1 AND status = 'QUEUED' AND requested_at < now() - interval '15 minutes'`,
      [action]
    );

    // Unique index parsial menolak kalau sudah ada QUEUED/RUNNING untuk aksi yang sama.
    let result;
    try {
      result = await sapPool.query(
        `INSERT INTO public.sap_ops_request (action, params, requested_by, plant)
         VALUES ($1, $2, $3, $4)
         RETURNING id, action, status, requested_at`,
        [action, params, requestedBy, process.env.PLANT_SSB || null]
      );
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "A similar request is still running (or the ops-worker is not consuming the queue). Wait, or check the sap-ops-worker service." });
      }
      throw err;
    }

    res.status(202).json({ data: result.rows[0], meta: meta() });
  } catch (err) {
    console.error("enqueueSapOps error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-corrections — daftar bundel koreksi (is_correction=true) untuk UI.
// Koreksi = jam yang datang setelah harinya ter-post; di-post MANUAL oleh admin.
async function getSapCorrections(req, res) {
  try {
    const status = String(req.query.status || "PENDING").toUpperCase();
    const search = String(req.query.search || "").trim();
    const where = ["is_correction = true"];
    const params = [];
    if (status !== "ALL") { params.push(status); where.push(`status = $${params.length}`); }
    if (PLANT_SSB) where.push(`werks = '${PLANT_SSB}'`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "")) { params.push(req.query.from); where.push(`bucket_start::date >= $${params.length}`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "")) { params.push(req.query.to); where.push(`bucket_start::date <= $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(aufnr ILIKE $${params.length} OR pernr ILIKE $${params.length} OR arbpl ILIKE $${params.length})`);
    }
    const result = await sapPool.query(
      `SELECT id, ztimesheetid, status, bucket_start::date AS work_date, is_productive,
        aufnr, vornr, pernr, arbpl, lstar, zconf_type, total_seconds, source_row_count,
        sap_error, created_at, updated_at
       FROM public.sap_timesheet_staging
       WHERE ${where.join(" AND ")}
       ORDER BY bucket_start DESC, id DESC
       LIMIT 500`,
      params
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("sap-corrections error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /dashboard/sap-ops/post-corrections — antre kirim manual bundel koreksi (by id).
// Worker menjalankan post_sap_staging.py --ids <ids> (claim_selected_rows tak memfilter
// is_correction). SAP aditif -> menambah jam ke order.
async function postCorrections(req, res) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ error: "No correction bundles selected" });
    const requestedBy = req.header("x-user-id") || null;
    // Self-heal QUEUED basi (lihat enqueueSapOps).
    await sapPool.query(
      `DELETE FROM public.sap_ops_request
       WHERE action = 'post_corrections' AND status = 'QUEUED' AND requested_at < now() - interval '15 minutes'`
    );
    let result;
    try {
      result = await sapPool.query(
        `INSERT INTO public.sap_ops_request (action, params, requested_by, plant)
         VALUES ('post_corrections', $1::jsonb, $2, $3)
         RETURNING id, action, status, requested_at`,
        [JSON.stringify({ ids }), requestedBy, process.env.PLANT_SSB || null]
      );
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "A correction-post request is still running (or the ops-worker is not consuming the queue). Wait, or check the sap-ops-worker service." });
      throw err;
    }
    res.status(202).json({ data: result.rows[0], meta: meta() });
  } catch (err) {
    console.error("postCorrections error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-ops/requests — status permintaan terbaru (untuk UI polling)
async function getSapOpsRequests(req, res) {
  try {
    const result = await sapPool.query(
      `SELECT id, action, status, requested_by, requested_at, started_at, finished_at, result, error
       FROM public.sap_ops_request
       ORDER BY id DESC
       LIMIT 20`
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error("getSapOpsRequests error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/kpi
async function getKpi(req, res) {
  try {
    const [activeOrders, overdueOrders, todayHours, avgProgress] =
      await Promise.all([
        pool.query(`
          SELECT COUNT(DISTINCT order_no)::int AS count
          FROM sow
          WHERE systemstatus NOT IN ('TECO', 'CLSD')
        `),
        pool.query(`
          SELECT COUNT(DISTINCT order_no)::int AS count
          FROM sow
          WHERE plan_finish < CURRENT_DATE
            AND progress < 100
            AND systemstatus NOT IN ('TECO', 'CLSD')
        `),
        pool.query(`
          SELECT COALESCE(SUM(duration), 0)::numeric(10,2) AS total_hours
          FROM timesheet_transaction
          WHERE DATE(longdate_checkin AT TIME ZONE '${TZ}') = CURRENT_DATE
            AND state_flag != 5
        `),
        pool.query(`
          SELECT ROUND(AVG(avg_progress), 1) AS avg_progress
          FROM vw_sow_orders
          WHERE systemstatus NOT IN ('TECO', 'CLSD')
            AND avg_progress IS NOT NULL
        `),
      ]);

    res.json({
      data: {
        active_orders: activeOrders.rows[0].count,
        overdue_orders: overdueOrders.rows[0].count,
        today_hours: parseFloat(todayHours.rows[0].total_hours),
        avg_progress: parseFloat(avgProgress.rows[0].avg_progress) || 0,
      },
      meta: meta(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/order-status
async function getOrderStatus(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(status, 'Unknown') AS status,
        COUNT(DISTINCT order_no)::int AS count
      FROM sow
      GROUP BY status
      ORDER BY count DESC
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/workload
async function getWorkload(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        workcenter,
        ROUND(SUM(planhours), 2)::float    AS total_planhours,
        ROUND(SUM(actual_hours), 2)::float  AS total_actual_hours,
        COUNT(DISTINCT order_no)::int       AS order_count
      FROM sow
      WHERE systemstatus NOT IN ('TECO', 'CLSD')
        AND workcenter IS NOT NULL
        -- Phase 6 (D4): total_planhours per workcenter is internal workload. Subcontracted
        -- operations are executed by a vendor and must not inflate it.
        -- DEPLOY NOTE: needs migration 20260803b_sow_subcont_mark.sql first — before that
        -- this endpoint returns 500 (undefined_table).
        AND NOT EXISTS (
          SELECT 1 FROM public.sow_subcont_mark scm
          WHERE ltrim(scm.order_no, '0') = ltrim(sow.order_no, '0')
            AND scm.operation_no = sow.operation_no
            AND scm.unmarked_at IS NULL
        )
      GROUP BY workcenter
      ORDER BY total_planhours DESC
      LIMIT 20
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/daily-hours?workcenter=all&days=30
async function getDailyHours(req, res) {
  try {
    const workcenter = req.query.workcenter || "all";
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    const result = await pool.query(
      `
      SELECT
        DATE(longdate_checkin AT TIME ZONE '${TZ}')::text AS day,
        ROUND(SUM(duration), 2)::float AS total_hours
      FROM timesheet_transaction
      WHERE longdate_checkin >= NOW() - ($2 || ' days')::interval
        AND state_flag != 5
        AND ($1 = 'all' OR workcentercode = $1)
      GROUP BY 1
      ORDER BY 1
    `,
      [workcenter, days]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operator-efficiency?from=&to=&workcenter=all
async function getOperatorEfficiency(req, res) {
  try {
    const workcenter = req.query.workcenter || "all";
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(now.getDate() - 30);

    const from = req.query.from
      ? new Date(req.query.from)
      : defaultFrom;
    const to = req.query.to ? new Date(req.query.to) : now;

    const result = await pool.query(
      `
      SELECT
        full_name,
        ROUND(SUM(duration), 2)::float   AS total_duration,
        ROUND(SUM(planhours), 2)::float  AS total_planhours,
        CASE
          WHEN SUM(planhours) > 0
          THEN ROUND(SUM(duration) / SUM(planhours) * 100, 1)::float
          ELSE NULL
        END AS efficiency_pct
      FROM timesheet_transaction
      WHERE longdate_checkin BETWEEN $1 AND $2
        AND state_flag != 5
        AND activitytype IS NULL
        AND ($3 = 'all' OR workcentercode = $3)
      GROUP BY full_name
      HAVING SUM(planhours) > 0
      ORDER BY efficiency_pct DESC NULLS LAST
      LIMIT 10
    `,
      [from.toISOString(), to.toISOString(), workcenter]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/ontime-monthly
async function getOntimeMonthly(req, res) {
  try {
    const result = await pool.query(`
      WITH order_summary AS (
        SELECT DISTINCT ON (order_no)
          order_no,
          plan_finish,
          actual_finish,
          progress
        FROM sow
        WHERE plan_finish IS NOT NULL
        ORDER BY order_no, operation_no
      )
      SELECT
        TO_CHAR(DATE_TRUNC('month', plan_finish), 'YYYY-MM') AS month,
        COUNT(CASE WHEN actual_finish <= plan_finish OR progress = 100 THEN 1 END)::int AS on_time,
        COUNT(CASE WHEN plan_finish < CURRENT_DATE AND progress < 100 AND
                       (actual_finish IS NULL OR actual_finish > plan_finish) THEN 1 END)::int AS overdue,
        COUNT(CASE WHEN plan_finish >= CURRENT_DATE AND progress < 100 THEN 1 END)::int AS in_progress
      FROM order_summary
      GROUP BY DATE_TRUNC('month', plan_finish)
      ORDER BY DATE_TRUNC('month', plan_finish)
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/progress-distribution
async function getProgressDistribution(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        CASE
          WHEN progress = 0             THEN '0'
          WHEN progress BETWEEN 1  AND 20  THEN '1-20'
          WHEN progress BETWEEN 21 AND 40  THEN '21-40'
          WHEN progress BETWEEN 41 AND 60  THEN '41-60'
          WHEN progress BETWEEN 61 AND 80  THEN '61-80'
          WHEN progress BETWEEN 81 AND 99  THEN '81-99'
          WHEN progress = 100           THEN '100'
          ELSE 'N/A'
        END AS bucket,
        COUNT(*)::int AS count,
        MIN(COALESCE(progress, -1)) AS sort_order
      FROM sow
      GROUP BY bucket
      ORDER BY sort_order NULLS LAST
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/validation-rate?workcenter=all
async function getValidationRate(req, res) {
  try {
    const workcenter = req.query.workcenter || "all";

    const result = await pool.query(
      `
      SELECT
        workcenter,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN validation_status IS NOT NULL AND validation_status != '' THEN 1 END)::int AS validated,
        ROUND(
          COUNT(CASE WHEN validation_status IS NOT NULL AND validation_status != '' THEN 1 END)::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
        )::float AS pass_rate
      FROM processcontroldata
      WHERE workcenter IS NOT NULL
        AND ($1 = 'all' OR workcenter = $1)
      GROUP BY workcenter
      ORDER BY pass_rate DESC NULLS LAST
    `,
      [workcenter]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/operator-heatmap?days=30
async function getOperatorHeatmap(req, res) {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));

    const result = await pool.query(
      `
      SELECT
        full_name,
        EXTRACT(hour FROM longdate_checkin AT TIME ZONE '${TZ}')::int AS hour,
        COUNT(*)::int AS activity_count
      FROM timesheet_transaction
      WHERE longdate_checkin >= NOW() - ($1 || ' days')::interval
        AND state_flag != 5
      GROUP BY full_name, hour
      ORDER BY full_name, hour
    `,
      [days]
    );
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/workcenter-list
async function getWorkcenterList(req, res) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT workcenterot AS workcenter, workcenter_description
      FROM workcenter
      WHERE workcenterot IS NOT NULL
      ORDER BY workcenterot
    `);
    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Kelayakan SAP — SALINAN dari jobs/sap_staging/stage_sap_timesheet.fetch_machine_hour_rows.
// WAJIB sinkron dengan stager: rekonsiliasi hanya bermakna kalau memakai definisi "eligible"
// yang IDENTIK dengan yang benar-benar di-stage. Alias tabel = m.
const MCH_SAP_ELIGIBLE = `
  COALESCE(m.end_effective, m.enddatetime) > m.startdatetime
  AND (
    ( ( m.status_activitytype IN ('M1','M2')
        OR (m.statusid = 2 AND m.previoustatusid = 1
            AND COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime))) <= 300) )
      AND m.confirmation_number IS NOT NULL AND m.confirmation_number <> ''
      AND m.order_no IS NOT NULL AND m.order_no <> ''
      AND m.operation_no IS NOT NULL AND m.operation_no <> '' )
    OR
    ( NULLIF(BTRIM(m.status_activitytype), '') IS NOT NULL AND m.status_activitytype NOT IN ('M1','M2')
      AND NOT (m.statusid = 2 AND m.previoustatusid = 1
               AND COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime))) <= 300) )
  )
  AND NULLIF(BTRIM(m.sn_employee), '') IS NOT NULL
  AND m.statusid NOT IN (0, 3, 4)
  AND (m.statusid <> 5 OR COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime))) <= 60)
`;

// Kontribusi CLAMP satu baris ke satu hari-bundel: [start, end_effective] ∩ [bucket, bucket+1hr].
// Dipakai untuk menaksir berapa jam bundel PENDING akan mengecil saat di-re-stage.
const CLAMPED_SEG_SECONDS = `
  GREATEST(EXTRACT(EPOCH FROM (
    LEAST(COALESCE(m.end_effective, m.enddatetime), src.bucket_start + interval '1 day')
    - GREATEST(m.startdatetime, src.bucket_start)
  ))::bigint, 0)
`;

// Cap max record duration PER JENIS AKTIVITAS (plant_config.sap_rules) — normalisasi
// + ekspansi config lama memakai helper yang sama dengan configRulesController, supaya
// rekonsiliasi tidak pernah beda arah dengan staging.
const {
  normalizeMaxRecordMinutes,
  legacyCategoryMinutes,
  expandLegacyIntoTypeMaps,
  loadActivityCatalog,
} = require("./configRulesController");

async function loadMaxRecordConfig() {
  try {
    const r = await pool.query("SELECT sap_rules FROM public.plant_config WHERE id = 1 LIMIT 1");
    const raw = r.rows[0]?.sap_rules || {};
    const maps = normalizeMaxRecordMinutes(raw.max_record_minutes);
    const legacy = legacyCategoryMinutes(raw.max_record_minutes);
    if (!legacy) return { ...maps, fallback: null };
    const catalog = await loadActivityCatalog().catch(() => null);
    const expanded = catalog ? expandLegacyIntoTypeMaps(maps, legacy, catalog) : maps;
    return { ...expanded, fallback: legacy };
  } catch (err) {
    console.error("loadMaxRecordConfig error:", err.message);
    return { mch: {}, timesheet: {}, fallback: { va: 90, nnva: 90, nva: 90 } };
  }
}

// Map cap di-inline sebagai literal jsonb: key hanya digit, nilai integer/null hasil
// normalizer, jadi tidak ada risiko injeksi (escape kutip tetap dilakukan).
const jsonbLiteral = (obj) => `'${JSON.stringify(obj || {}).replace(/'/g, "''")}'::jsonb`;
const intOrNull = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? String(n) : "NULL";
};

// Menit cap untuk satu record mch_transaction (alias m). NULL = No Limit.
// CASE-nya IDENTIK dengan stage_sap_timesheet.py source_rows.
const MCH_CAP_MINUTES = (cfg) => {
  const L = jsonbLiteral(cfg.mch);
  const fb = cfg.fallback || {};
  return `(CASE
      WHEN jsonb_typeof(${L} -> m.statusid::text) = 'null' THEN NULL
      WHEN (${L} ->> m.statusid::text) ~ '^[0-9]+$' THEN (${L} ->> m.statusid::text)::int
      WHEN m.status_activitytype = 'M1' THEN ${intOrNull(fb.va)}
      WHEN m.status_activitytype = 'M2'
        OR (m.statusid = 2 AND m.previoustatusid = 1
            AND COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime))) <= 300)
        THEN ${intOrNull(fb.nnva)}
      ELSE ${intOrNull(fb.nva)}
    END)`;
};

// Detik yang DIPOTONG dari satu record mch_transaction karena melebihi cap jenisnya.
// Cap NULL (No Limit) -> GREATEST(NULL, 0) = 0 detik dipotong.
const CAP_CUT_SECONDS = (cfg) => `
  GREATEST(
    EXTRACT(EPOCH FROM (COALESCE(m.end_effective, m.enddatetime) - m.startdatetime))
    - (${MCH_CAP_MINUTES(cfg)} * 60),
    0
  )`;

// Akhir record SETELAH cap (start + N menit sesuai jenis) — nilai yang benar-benar
// dipakai staging. Cap NULL -> LEAST mengabaikan NULL -> akhir asli (tidak dipotong).
const END_CAPPED_EXPR = (cfg) => `
  LEAST(
    COALESCE(m.end_effective, m.enddatetime),
    m.startdatetime + (${MCH_CAP_MINUTES(cfg)} || ' minutes')::interval
  )`;

// ---- TIMESHEET (alias t = timesheet_transaction) -----------------------------
// Cap per activitytype ("" = productive). IDENTIK dengan stage_timesheet_transaction.py.
const TS_CAP_MINUTES = (cfg) => {
  const L = jsonbLiteral(cfg.timesheet);
  const fb = cfg.fallback || {};
  return `(CASE
      WHEN jsonb_typeof(${L} -> BTRIM(COALESCE(t.activitytype, ''))) = 'null' THEN NULL
      WHEN (${L} ->> BTRIM(COALESCE(t.activitytype, ''))) ~ '^[0-9]+$'
        THEN (${L} ->> BTRIM(COALESCE(t.activitytype, '')))::int
      WHEN BTRIM(COALESCE(t.activitytype, '')) = '' THEN ${intOrNull(fb.va)}
      ELSE ${intOrNull(fb.nva)}
    END)`;
};

const TS_RAW_SECONDS = `EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin))::bigint`;

// Potongan break hours untuk record timesheet — HANYA non-produktif (activitytype
// terisi), per hari (record bisa lintas tengah malam). Sama dengan CTE break di
// stage_timesheet_transaction.py.
const TS_BREAK_CUT_SECONDS = `
  COALESCE((
    SELECT SUM(EXTRACT(EPOCH FROM (
      LEAST(seg.seg_end, g.day_bucket + (bw->>'end')::time)
        - GREATEST(seg.seg_start, g.day_bucket + (bw->>'start')::time)
    ))::bigint)
    FROM generate_series(
      date_trunc('day', t.longdate_checkin AT TIME ZONE '${TZ}'),
      date_trunc('day', t.longdate_checkout AT TIME ZONE '${TZ}'),
      interval '1 day'
    ) AS g(day_bucket)
    CROSS JOIN LATERAL (
      SELECT GREATEST(t.longdate_checkin AT TIME ZONE '${TZ}', g.day_bucket) AS seg_start,
             LEAST(t.longdate_checkout AT TIME ZONE '${TZ}', g.day_bucket + interval '1 day') AS seg_end
    ) seg
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE((SELECT sap_rules->'break_windows' FROM public.plant_config WHERE id = 1), '[]'::jsonb)
    ) bw
    CROSS JOIN LATERAL jsonb_array_elements_text(bw->'days') d(day)
    WHERE d.day::int = EXTRACT(DOW FROM g.day_bucket)::int
      AND BTRIM(COALESCE(t.activitytype, '')) <> ''
      AND seg.seg_start < g.day_bucket + (bw->>'end')::time
      AND seg.seg_end > g.day_bucket + (bw->>'start')::time
  ), 0)::bigint`;

// Detik dipotong cap untuk timesheet (setelah potongan break, seperti staging).
const TS_CAP_CUT_SECONDS = (cfg) => `
  GREATEST(
    GREATEST(${TS_RAW_SECONDS} - (${TS_BREAK_CUT_SECONDS}), 0)
    - (${TS_CAP_MINUTES(cfg)}::bigint * 60),
    0
  )`;

// Records rekonsiliasi dalam SATU bentuk kolom untuk dua sumber:
//   MCH_HOURS = 1 baris per segmen mch_transaction (bundel bisa banyak segmen)
//   TIMESHEET = 1 baris staging = 1 tsnumber (tidak ada provenance/bundling)
// Dipakai endpoint records (paginated) DAN sheet Records di export (kolom Source).
// $1 = from date, $2 = to date, $3 = pola search (kalau search=true).
function buildRecordsSql(cfg, { source = "all", search = false } = {}) {
  const cutSec = CAP_CUT_SECONDS(cfg);
  const endCapped = END_CAPPED_EXPR(cfg);
  const tsCut = TS_CAP_CUT_SECONDS(cfg);
  const mchSearch = search
    ? "AND (m.sn_employee ILIKE $3 OR u.full_name ILIKE $3 OR m.machinename ILIKE $3 OR m.order_no ILIKE $3)"
    : "";
  const tsSearch = search
    ? "AND (t.serialnumber ILIKE $3 OR u.full_name ILIKE $3 OR t.workcentercode ILIKE $3 OR COALESCE(t.order_no,'') ILIKE $3)"
    : "";

  const mchSql = `
    SELECT
      'MCH_HOURS'::text AS source,
      st.bucket_start::date AS sort_day,
      to_char(st.bucket_start AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS date,
      st.id AS staging_id, st.status AS bundle_status, st.is_productive AS bundle_productive,
      m.proddataid::text AS source_row_id,
      m.sn_employee AS pernr, COALESCE(u.full_name, '') AS name,
      COALESCE(m.machinename, '') AS machine,
      COALESCE(m.status_activitytype, '') AS activity,
      COALESCE(m.status_description, '') AS status_desc,
      to_char(m.startdatetime, 'YYYY-MM-DD HH24:MI:SS') AS start,
      to_char(m.enddatetime, 'YYYY-MM-DD HH24:MI:SS') AS end_orig,
      to_char(${endCapped}, 'YYYY-MM-DD HH24:MI:SS') AS end_capped,
      COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime)))::bigint AS raw,
      (${CLAMPED_SEG_SECONDS})::bigint AS clamped,
      (${cutSec})::bigint AS capcut,
      (${BREAK_CUT_SECONDS}) AS breakcut,
      (${CLAMPED_SEG_SECONDS} - ${cutSec} - ${BREAK_CUT_SECONDS})::bigint AS recognized,
      COALESCE(m.order_no, '') AS order_no, COALESCE(m.operation_no, '') AS operation_no,
      COALESCE(NULLIF(m.operation_short_text, ''), m.operation_description) AS operation_text,
      COALESCE(m.confirmation_number, '') AS confirmation,
      COALESCE(m.is_stuck, false) AS stuck,
      (ex2.source_row_id IS NOT NULL) AS excluded,
      true AS can_exclude
    FROM public.sap_staging_source src
    JOIN public.sap_timesheet_staging st ON st.id = src.staging_id
    JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
    LEFT JOIN public.usernfc u ON u.snssb = m.sn_employee
    LEFT JOIN public.sap_staging_exclusion ex2
      ON ex2.source_system = 'MCH_HOURS' AND ex2.source_row_id = m.proddataid::text
    WHERE src.source_system = 'MCH_HOURS'
      AND st.bucket_start::date BETWEEN $1::date AND $2::date${plantScope("st")} ${mchSearch}`;

  // TIMESHEET: bucket_start NULL by design -> tanggal dari source_min_start (= checkin
  // yang sudah dikonversi ke TZ aplikasi saat staging). end_capped = jam sintetis yang
  // benar-benar dikirim ke SAP (checkin + total_seconds).
  const tsSql = `
    SELECT
      'TIMESHEET'::text AS source,
      st.source_min_start::date AS sort_day,
      to_char(st.source_min_start, 'YYYY-MM-DD') AS date,
      st.id AS staging_id, st.status AS bundle_status, st.is_productive AS bundle_productive,
      t.tsnumber::text AS source_row_id,
      COALESCE(NULLIF(st.pernr_origin, ''), st.pernr) AS pernr, COALESCE(u.full_name, '') AS name,
      COALESCE(t.workcentercode, '') AS machine,
      BTRIM(COALESCE(t.activitytype, '')) AS activity,
      COALESCE(NULLIF(r.description, ''),
               CASE WHEN BTRIM(COALESCE(t.activitytype, '')) = '' THEN 'Productive (order work)' ELSE '' END) AS status_desc,
      to_char(t.longdate_checkin AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS') AS start,
      to_char(t.longdate_checkout AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS') AS end_orig,
      to_char((t.longdate_checkin AT TIME ZONE '${TZ}') + (st.total_seconds || ' seconds')::interval,
              'YYYY-MM-DD HH24:MI:SS') AS end_capped,
      ${TS_RAW_SECONDS} AS raw,
      ${TS_RAW_SECONDS} AS clamped,
      (${tsCut})::bigint AS capcut,
      (${TS_BREAK_CUT_SECONDS}) AS breakcut,
      st.total_seconds::bigint AS recognized,
      COALESCE(t.order_no, '') AS order_no, COALESCE(t.operation_no::text, '') AS operation_no,
      NULL::text AS operation_text,
      COALESCE(st.rueck, '') AS confirmation,
      false AS stuck,
      false AS excluded,
      false AS can_exclude
    FROM public.sap_timesheet_staging st
    JOIN public.timesheet_transaction t ON t.tsnumber::text = split_part(st.source_key, ':', 2)
    LEFT JOIN public.usernfc u ON u.snssb = COALESCE(NULLIF(st.pernr_origin, ''), st.pernr)
    LEFT JOIN ews.activity_type_ref r ON r.activitytype = BTRIM(COALESCE(t.activitytype, ''))
    WHERE st.source_system = 'TIMESHEET'
      AND st.source_min_start::date BETWEEN $1::date AND $2::date${plantScope("st")} ${tsSearch}`;

  if (source === "mch") return mchSql;
  if (source === "timesheet") return tsSql;
  return `${mchSql}\n    UNION ALL\n${tsSql}`;
}

// Versi PAGINATED (endpoint records): kolom berat (break/cap cut, correlated subquery)
// dihitung HANYA untuk baris halaman yang tampil. Alur: base (pemilihan staging ringan)
// -> count -> page (LIMIT/OFFSET) -> recs (join ulang + kolom berat, terbatas halaman).
// $1/$2 = range, $3 = search (kalau search), LIMIT/OFFSET di CTE page.
function buildRecordsPageSql(cfg, { source = "all", search = false } = {}) {
  const cutSec = CAP_CUT_SECONDS(cfg);
  const endCapped = END_CAPPED_EXPR(cfg);
  const tsCut = TS_CAP_CUT_SECONDS(cfg);
  const mchSearch = search
    ? "AND (m.sn_employee ILIKE $3 OR u.full_name ILIKE $3 OR m.machinename ILIKE $3 OR m.order_no ILIKE $3)"
    : "";
  const tsSearch = search
    ? "AND (t.serialnumber ILIKE $3 OR u.full_name ILIKE $3 OR t.workcentercode ILIKE $3 OR COALESCE(t.order_no,'') ILIKE $3)"
    : "";

  const mchBase = `
    SELECT 'MCH_HOURS'::text AS source,
           st.bucket_start::date AS sort_day,
           st.id AS staging_id,
           src.source_row_id AS row_id,
           m.startdatetime AS start
    FROM public.sap_staging_source src
    JOIN public.sap_timesheet_staging st ON st.id = src.staging_id
    JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
    LEFT JOIN public.usernfc u ON u.snssb = m.sn_employee
    WHERE src.source_system = 'MCH_HOURS'
      AND st.bucket_start::date BETWEEN $1::date AND $2::date${plantScope("st")} ${mchSearch}`;

  const tsBase = `
    SELECT 'TIMESHEET'::text AS source,
           st.source_min_start::date AS sort_day,
           st.id AS staging_id,
           t.tsnumber::text AS row_id,
           t.longdate_checkin AT TIME ZONE '${TZ}' AS start
    FROM public.sap_timesheet_staging st
    JOIN public.timesheet_transaction t ON t.tsnumber::text = split_part(st.source_key, ':', 2)
    LEFT JOIN public.usernfc u ON u.snssb = COALESCE(NULLIF(st.pernr_origin, ''), st.pernr)
    WHERE st.source_system = 'TIMESHEET'
      AND st.source_min_start::date BETWEEN $1::date AND $2::date${plantScope("st")} ${tsSearch}`;

  let baseSql = source === "mch" ? mchBase : source === "timesheet" ? tsBase : `${mchBase}\n    UNION ALL\n${tsBase}`;

  const mchHeavy = `
    SELECT
      p.source, p.sort_day,
      to_char(p.sort_day, 'YYYY-MM-DD') AS date,
      p.staging_id, st.status AS bundle_status, st.is_productive AS bundle_productive,
      m.proddataid::text AS source_row_id,
      m.sn_employee AS pernr, COALESCE(u.full_name, '') AS name,
      COALESCE(m.machinename, '') AS machine,
      COALESCE(m.status_activitytype, '') AS activity,
      COALESCE(m.status_description, '') AS status_desc,
      to_char(m.startdatetime, 'YYYY-MM-DD HH24:MI:SS') AS start,
      to_char(m.enddatetime, 'YYYY-MM-DD HH24:MI:SS') AS end_orig,
      to_char(${endCapped}, 'YYYY-MM-DD HH24:MI:SS') AS end_capped,
      COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime)))::bigint AS raw,
      (${CLAMPED_SEG_SECONDS})::bigint AS clamped,
      (${cutSec})::bigint AS capcut,
      (${BREAK_CUT_SECONDS}) AS breakcut,
      (${CLAMPED_SEG_SECONDS} - ${cutSec} - ${BREAK_CUT_SECONDS})::bigint AS recognized,
      COALESCE(m.order_no, '') AS order_no, COALESCE(m.operation_no, '') AS operation_no,
      COALESCE(NULLIF(m.operation_short_text, ''), m.operation_description) AS operation_text,
      COALESCE(m.confirmation_number, '') AS confirmation,
      COALESCE(m.is_stuck, false) AS stuck,
      (ex2.source_row_id IS NOT NULL) AS excluded,
      true AS can_exclude
    FROM page p
    JOIN public.sap_staging_source src
      ON src.staging_id = p.staging_id AND src.source_row_id = p.row_id AND p.source = 'MCH_HOURS'
    JOIN public.sap_timesheet_staging st ON st.id = src.staging_id
    JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
    LEFT JOIN public.usernfc u ON u.snssb = m.sn_employee
    LEFT JOIN public.sap_staging_exclusion ex2
      ON ex2.source_system = 'MCH_HOURS' AND ex2.source_row_id = m.proddataid::text`;

  const tsHeavy = `
    SELECT
      p.source, p.sort_day,
      to_char(p.sort_day, 'YYYY-MM-DD') AS date,
      p.staging_id, st.status AS bundle_status, st.is_productive AS bundle_productive,
      t.tsnumber::text AS source_row_id,
      COALESCE(NULLIF(st.pernr_origin, ''), st.pernr) AS pernr, COALESCE(u.full_name, '') AS name,
      COALESCE(t.workcentercode, '') AS machine,
      BTRIM(COALESCE(t.activitytype, '')) AS activity,
      COALESCE(NULLIF(r.description, ''),
               CASE WHEN BTRIM(COALESCE(t.activitytype, '')) = '' THEN 'Productive (order work)' ELSE '' END) AS status_desc,
      to_char(t.longdate_checkin AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS') AS start,
      to_char(t.longdate_checkout AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS') AS end_orig,
      to_char((t.longdate_checkin AT TIME ZONE '${TZ}') + (st.total_seconds || ' seconds')::interval,
              'YYYY-MM-DD HH24:MI:SS') AS end_capped,
      ${TS_RAW_SECONDS} AS raw,
      ${TS_RAW_SECONDS} AS clamped,
      (${tsCut})::bigint AS capcut,
      (${TS_BREAK_CUT_SECONDS}) AS breakcut,
      st.total_seconds::bigint AS recognized,
      COALESCE(t.order_no, '') AS order_no, COALESCE(t.operation_no::text, '') AS operation_no,
      NULL::text AS operation_text,
      COALESCE(st.rueck, '') AS confirmation,
      false AS stuck,
      false AS excluded,
      false AS can_exclude
    FROM page p
    JOIN public.sap_timesheet_staging st ON st.id = p.staging_id AND p.source = 'TIMESHEET'
    JOIN public.timesheet_transaction t ON t.tsnumber::text = split_part(st.source_key, ':', 2)
    LEFT JOIN public.usernfc u ON u.snssb = COALESCE(NULLIF(st.pernr_origin, ''), st.pernr)
    LEFT JOIN ews.activity_type_ref r ON r.activitytype = BTRIM(COALESCE(t.activitytype, ''))`;

  let heavySql = source === "mch" ? mchHeavy : source === "timesheet" ? tsHeavy : `${mchHeavy}\n    UNION ALL\n${tsHeavy}`;

  return `
    WITH base AS (
      ${baseSql}
    ),
    cnt AS (
      SELECT count(*)::int AS total FROM base
    ),
    page AS MATERIALIZED (
      SELECT source, staging_id, row_id, sort_day, start FROM base
      ORDER BY sort_day DESC, staging_id DESC, start
      LIMIT $${search ? 4 : 3} OFFSET $${search ? 5 : 4}
    ),
    recs AS (
      ${heavySql}
    )
    SELECT r.*, (SELECT total FROM cnt) AS total_count
    FROM recs r
    ORDER BY r.sort_day DESC, r.staging_id DESC, r.start`;
}

// Detik yang DIBUANG karena overlap break hours (rules break_windows) — hanya untuk
// segmen NON-PRODUKTIF (M1/M2 dikecualikan, identik dengan stage_sap_timesheet.py).
const BREAK_CUT_SECONDS = `
  COALESCE((
    SELECT SUM(EXTRACT(EPOCH FROM (
      LEAST(COALESCE(m.end_effective, m.enddatetime), date_trunc('day', m.startdatetime) + (bw->>'end')::time)
      - GREATEST(m.startdatetime, date_trunc('day', m.startdatetime) + (bw->>'start')::time)
    ))::bigint)
    FROM jsonb_array_elements((SELECT sap_rules->'break_windows' FROM public.plant_config WHERE id = 1)) bw
    CROSS JOIN LATERAL jsonb_array_elements_text(bw->'days') d(day)
    WHERE d.day::int = EXTRACT(DOW FROM m.startdatetime)::int
      AND m.status_activitytype NOT IN ('M1', 'M2')
      AND m.startdatetime < date_trunc('day', m.startdatetime) + (bw->>'end')::time
      AND COALESCE(m.end_effective, m.enddatetime) > date_trunc('day', m.startdatetime) + (bw->>'start')::time
  ), 0)::bigint
`;

// Data rekonsiliasi (dipakai endpoint JSON dan export Excel — satu sumber kebenaran).
async function loadSapReconciliationData(fromDate, toDate) {
  const { rows: rr } = await pool.query(
    `SELECT COALESCE($1::date, (now() AT TIME ZONE '${TZ}')::date - 29) AS from_d,
            COALESCE($2::date, (now() AT TIME ZONE '${TZ}')::date)      AS to_d`,
    [fromDate, toDate],
  );
  const fromD = rr[0].from_d;
  const toD = rr[0].to_d;
  const capCfg = await loadMaxRecordConfig();
  const cutSec = CAP_CUT_SECONDS(capCfg);

  const [mchByDate, stgByDate, actions] = await Promise.all([
    // mch_transaction eligible per hari kerja: jam mentah, clamp, potongan max record,
    // overlap (nyangkut).
    pool.query(
      `SELECT m.startdatetime::date AS d,
         round(sum(EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime)))/3600.0, 2) AS raw_hrs,
         round(sum(EXTRACT(EPOCH FROM (COALESCE(m.end_effective, m.enddatetime) - m.startdatetime)))/3600.0, 2) AS clamped_hrs,
         round(sum(${cutSec})/3600.0, 2) AS cap_cut_hrs,
         round(sum(m.overlap_seconds)/3600.0, 2) AS overlap_hrs,
         count(*)::int AS rows_eligible,
         count(*) FILTER (WHERE m.is_stuck)::int AS rows_stuck
       FROM public.mch_transaction m
       WHERE m.startdatetime::date BETWEEN $1 AND $2 AND ${MCH_SAP_ELIGIBLE}
       GROUP BY 1 ORDER BY 1`,
      [fromD, toD],
    ),
    // staging bundel per hari-bundel + status + jenis (produktif=ke order, unproduktif=cost-center).
    // Pemisahan is_productive PENTING: CSV konfirmasi-order SAP hanya memuat yang PRODUKTIF,
    // jadi tanpa split, "POSTED" total (prod+unprod) tak akan pernah cocok dengan CSV.
    sapPool.query(
      `SELECT st.bucket_start::date AS d, st.status, st.is_productive,
         round(sum(st.total_seconds)/3600.0, 2) AS hrs, count(*)::int AS n
       FROM public.sap_timesheet_staging st
       WHERE st.source_system = 'MCH_HOURS' AND st.bucket_start::date BETWEEN $1 AND $2${plantScope("st")}
       GROUP BY 1, 2, 3`,
      [fromD, toD],
    ),
    // Perlu diperbaiki: bundel PENDING yang disuapi baris nyangkut (mengecil saat re-stage),
    // plus FAILED & SKIPPED.
    pool.query(
      `WITH pend AS (
         SELECT src.staging_id,
           sum(src.seconds) AS raw_sec,
           sum(${CLAMPED_SEG_SECONDS}) AS clamp_sec
         FROM public.sap_staging_source src
         JOIN public.sap_timesheet_staging st
           ON st.id = src.staging_id AND st.status = 'PENDING' AND st.source_system = 'MCH_HOURS'
         JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
         WHERE st.bucket_start::date BETWEEN $1 AND $2${plantScope("st")}
         GROUP BY src.staging_id
         HAVING sum(src.seconds) > sum(${CLAMPED_SEG_SECONDS})
       )
       SELECT
         (SELECT count(*) FROM pend)::int AS stuck_pending_bundles,
         round(COALESCE((SELECT sum(raw_sec - clamp_sec) FROM pend), 0)/3600.0, 2) AS stuck_pending_reduction_hrs,
         (SELECT count(*) FROM public.sap_timesheet_staging
            WHERE source_system='MCH_HOURS' AND status='FAILED' AND bucket_start::date BETWEEN $1 AND $2${PW_SQL})::int AS failed_bundles,
         (SELECT count(*) FROM public.sap_timesheet_staging
            WHERE source_system='MCH_HOURS' AND status='SKIPPED' AND bucket_start::date BETWEEN $1 AND $2${PW_SQL})::int AS skipped_bundles`,
      [fromD, toD],
    ),
  ]);

  // Gabung per tanggal.
  const byDate = new Map();
  const row = (d) => {
    const key = String(d);
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key, mch_clamped_hrs: 0, mch_raw_hrs: 0, cap_cut_hrs: 0, overlap_hrs: 0,
        rows_eligible: 0, rows_stuck: 0,
        staged_hrs: 0, posted_hrs: 0, pending_hrs: 0, failed_hrs: 0, skipped_hrs: 0,
        posted_n: 0, pending_n: 0, failed_n: 0, skipped_n: 0,
        // POSTED dipecah: ke ORDER (produktif, muncul di CSV konfirmasi SAP) vs
        // COST-CENTER (unproduktif/LSTAR, TIDAK di CSV order).
        posted_order_hrs: 0, posted_cc_hrs: 0,
      });
    }
    return byDate.get(key);
  };
  for (const r of mchByDate.rows) {
    const e = row(r.d);
    e.mch_clamped_hrs = num(r.clamped_hrs);
    e.mch_raw_hrs = num(r.raw_hrs);
    e.cap_cut_hrs = num(r.cap_cut_hrs);
    e.overlap_hrs = num(r.overlap_hrs);
    e.rows_eligible = num(r.rows_eligible);
    e.rows_stuck = num(r.rows_stuck);
  }
  const STG_KEY = { POSTED: ["posted_hrs", "posted_n"], PENDING: ["pending_hrs", "pending_n"], FAILED: ["failed_hrs", "failed_n"], SKIPPED: ["skipped_hrs", "skipped_n"] };
  for (const r of stgByDate.rows) {
    const e = row(r.d);
    e.staged_hrs += num(r.hrs);
    const k = STG_KEY[r.status];
    if (k) { e[k[0]] += num(r.hrs); e[k[1]] += num(r.n); }
    if (r.status === "POSTED") {
      if (r.is_productive) e.posted_order_hrs += num(r.hrs);
      else e.posted_cc_hrs += num(r.hrs);
    }
    // POSTING (langka, transient) dijumlahkan ke staged tapi tak dikolomkan sendiri.
  }
  const by_date = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)); // terbaru dulu

  // Funnel total (agregat rentang).
  const sum = (f) => by_date.reduce((s, r) => s + f(r), 0);
  const r2 = (n) => Math.round(n * 100) / 100;
  const funnel = {
    mch_raw_hrs: r2(sum((r) => r.mch_raw_hrs)),
    mch_clamped_hrs: r2(sum((r) => r.mch_clamped_hrs)),
    cap_cut_hrs: r2(sum((r) => r.cap_cut_hrs)),
    overlap_hrs: r2(sum((r) => r.overlap_hrs)),
    staged_hrs: r2(sum((r) => r.staged_hrs)),
    posted_hrs: r2(sum((r) => r.posted_hrs)),
    posted_order_hrs: r2(sum((r) => r.posted_order_hrs)),  // = CSV konfirmasi-order SAP
    posted_cc_hrs: r2(sum((r) => r.posted_cc_hrs)),        // cost-center, tak di CSV
    pending_hrs: r2(sum((r) => r.pending_hrs)),
    failed_hrs: r2(sum((r) => r.failed_hrs)),
    skipped_hrs: r2(sum((r) => r.skipped_hrs)),
    rows_eligible: sum((r) => r.rows_eligible),
    rows_stuck: sum((r) => r.rows_stuck),
    posted_n: sum((r) => r.posted_n),
    pending_n: sum((r) => r.pending_n),
    failed_n: sum((r) => r.failed_n),
    skipped_n: sum((r) => r.skipped_n),
  };

  return {
    range: { from: String(fromD), to: String(toD) },
    funnel,
    by_date,
    action_items: actions.rows[0] || {},
  };
}

// GET /dashboard/sap-reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD
// Rekonsiliasi rantai jam mesin: mch_transaction (sumber, mentah vs clamp) -> staging
// (bundel yang dikirim) -> status SAP (POSTED/PENDING/FAILED/SKIPPED). Menjelaskan KENAPA
// angka berbeda di tiap tahap + menandai apa yang perlu diperbaiki.
async function getSapReconciliation(req, res) {
  try {
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : null;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : null;
    const data = await loadSapReconciliationData(fromDate, toDate);
    res.json({ data, meta: meta() });
  } catch (err) {
    console.error("sap-reconciliation error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-reconciliation-export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Export rekonsiliasi (summary + per tanggal) ke Excel .xlsx untuk rentang terpilih.
async function exportSapReconciliation(req, res) {
  try {
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : null;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : null;
    const data = await loadSapReconciliationData(fromDate, toDate);
    const { funnel: f, by_date } = data;
    const capCfg = await loadMaxRecordConfig();
    const cutSec = CAP_CUT_SECONDS(capCfg);
    const endCappedExpr = END_CAPPED_EXPR(capCfg);

    const wb = new ExcelJS.Workbook();
    const fmt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);

    const sum = wb.addWorksheet("Summary");
    sum.columns = [
      { header: "Metric", key: "label", width: 32 },
      { header: "Hours", key: "hrs", width: 12 },
    ];
    [
      ["Machine hours (raw)", fmt(f.mch_raw_hrs)],
      ["Machine hours (after clamp)", fmt(f.mch_clamped_hrs)],
      ["Cut (max record duration)", fmt(f.cap_cut_hrs)],
      ["Posted to SAP", fmt(f.posted_hrs)],
      ["Posted (order)", fmt(f.posted_order_hrs)],
      ["Posted (cost center)", fmt(f.posted_cc_hrs)],
      ["Pending", fmt(f.pending_hrs)],
      ["Failed", fmt(f.failed_hrs)],
      ["Skipped", fmt(f.skipped_hrs)],
    ].forEach(([label, hrs]) => sum.addRow({ label, hrs }));
    sum.getRow(1).font = { bold: true };
    sum.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAF0F8" } };
    sum.getColumn(2).numFmt = "0.00";

    const by = wb.addWorksheet("By Date");
    by.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Raw hrs", key: "raw", width: 10 },
      { header: "Clamped hrs", key: "clamped", width: 12 },
      { header: "Cut (max record)", key: "cut", width: 16 },
      { header: "Posted", key: "posted", width: 10 },
      { header: "Not posted", key: "notposted", width: 12 },
      { header: "Rows", key: "rows", width: 8 },
      { header: "Stuck", key: "stuck", width: 8 },
    ];
    for (const r of by_date) {
      by.addRow({
        date: r.date,
        raw: fmt(r.mch_raw_hrs),
        clamped: fmt(r.mch_clamped_hrs),
        cut: fmt(r.cap_cut_hrs),
        posted: fmt(r.posted_hrs),
        notposted: fmt(r.pending_hrs + r.failed_hrs),
        rows: r.rows_eligible,
        stuck: r.rows_stuck,
      });
    }
    by.getRow(1).font = { bold: true };
    by.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAF0F8" } };
    by.views = [{ state: "frozen", ySplit: 1 }];

    // --- Sheet 3: Bundles (per konfirmasi staging, rentang penuh) ---
    const bd = wb.addWorksheet("Bundles");
    bd.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Staging ID", key: "staging_id", width: 10 },
      { header: "Source", key: "src_sys", width: 12 },
      { header: "PERNR", key: "pernr", width: 10 },
      { header: "Name", key: "name", width: 22 },
      { header: "Status", key: "status", width: 10 },
      { header: "Prod", key: "prod", width: 6 },
      { header: "Sent hrs", key: "sent", width: 10 },
      { header: "Source hrs", key: "src_hrs", width: 11 },
      { header: "Cut (max rec)", key: "cut", width: 13 },
      { header: "Records", key: "nrows", width: 8 },
      { header: "Stuck", key: "stuck", width: 7 },
      { header: "Order", key: "aufnr", width: 14 },
      { header: "LSTAR", key: "lstar", width: 8 },
      { header: "Operation", key: "operation", width: 24 },
      { header: "Machine", key: "machine", width: 14 },
      { header: "Posted at", key: "posted", width: 17 },
    ];
    const { rows: bundleRows } = await pool.query(
      `SELECT
         to_char(st.bucket_start AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS date,
         st.id AS staging_id, st.source_system AS source, st.pernr,
         COALESCE(u.full_name, '') AS name, st.status, st.is_productive AS prod,
         round(st.total_seconds/3600.0, 2)::float AS sent,
         (SELECT round(sum(${CLAMPED_SEG_SECONDS})/3600.0, 2)::float
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS source_hrs,
         (SELECT round(sum(${cutSec})/3600.0, 2)::float
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS cut,
         (SELECT count(*) FROM public.sap_staging_source src WHERE src.staging_id = st.id)::int AS nrows,
         (SELECT bool_or(m.is_stuck)
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS stuck,
         st.aufnr, st.lstar,
         (SELECT COALESCE(NULLIF(max(m.operation_short_text), ''), NULLIF(max(m.operation_description), ''))
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS operation,
         (SELECT max(m.machinename)
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS machine,
         to_char(st.posted_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS posted
       FROM public.sap_timesheet_staging st
       LEFT JOIN public.usernfc u
         ON u.snssb = COALESCE(NULLIF(st.pernr_origin, ''), st.pernr)
       WHERE st.bucket_start::date BETWEEN $1::date AND $2::date${plantScope("st")}
       ORDER BY st.bucket_start, st.id`,
      [data.range.from, data.range.to],
    );
    for (const r of bundleRows) {
      bd.addRow({
        date: r.date,
        staging_id: r.staging_id,
        src_sys: r.source,
        pernr: r.pernr,
        name: r.name,
        status: r.status,
        prod: r.prod ? "Y" : "",
        sent: fmt(r.sent),
        src_hrs: r.source_hrs == null ? "-" : fmt(r.source_hrs),
        cut: r.cut == null ? "-" : fmt(r.cut),
        nrows: r.nrows,
        stuck: r.stuck ? "Y" : "",
        aufnr: r.aufnr,
        lstar: r.lstar,
        operation: r.operation,
        machine: r.machine,
        posted: r.posted,
      });
    }
    bd.getRow(1).font = { bold: true };
    bd.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAF0F8" } };
    bd.views = [{ state: "frozen", ySplit: 1 }];

    // --- Sheet 4: Records (per segmen MCH + per tsnumber TIMESHEET, kolom Source) ---
    const rc = wb.addWorksheet("Records");
    rc.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Source", key: "source", width: 11 },
      { header: "Staging ID", key: "staging_id", width: 10 },
      { header: "PERNR", key: "pernr", width: 10 },
      { header: "Name", key: "name", width: 22 },
      { header: "Machine", key: "machine", width: 14 },
      { header: "Activity", key: "activity", width: 8 },
      { header: "Status desc", key: "status_desc", width: 22 },
      { header: "Start", key: "start", width: 20 },
      { header: "End (original)", key: "end_orig", width: 20 },
      { header: "End (capped)", key: "end_capped", width: 20 },
      { header: "Raw secs", key: "raw", width: 10 },
      { header: "Clamped secs", key: "clamped", width: 12 },
      { header: "Cap cut secs", key: "capcut", width: 13 },
      { header: "Break cut secs", key: "breakcut", width: 14 },
      { header: "Duration recognized", key: "recognized", width: 17 },
      { header: "Order", key: "order_no", width: 14 },
      { header: "Operation", key: "operation_no", width: 10 },
      { header: "Op text", key: "operation_text", width: 26 },
      { header: "Confirmation", key: "confirmation", width: 13 },
      { header: "Stuck", key: "stuck", width: 7 },
    ];
    const { rows: recRows } = await pool.query(
      `SELECT *
       FROM (${buildRecordsSql(capCfg, { source: "all" })}) x
       ORDER BY x.sort_day, x.staging_id, x.start`,
      [data.range.from, data.range.to],
    );
    for (const r of recRows) {
      rc.addRow({
        date: r.date,
        source: r.source,
        staging_id: r.staging_id,
        pernr: r.pernr,
        name: r.name,
        machine: r.machine,
        activity: r.activity,
        status_desc: r.status_desc,
        start: r.start,
        end_orig: r.end_orig,
        end_capped: r.end_capped,
        raw: r.raw,
        clamped: r.clamped,
        capcut: r.capcut,
        breakcut: Math.max(Number(r.breakcut) || 0, 0),
        recognized: Math.max(Number(r.recognized) || 0, 0),
        order_no: r.order_no,
        operation_no: r.operation_no,
        operation_text: r.operation_text,
        confirmation: r.confirmation,
        stuck: r.stuck ? "Y" : "",
      });
    }
    rc.getRow(1).font = { bold: true };
    rc.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAF0F8" } };
    rc.views = [{ state: "frozen", ySplit: 1 }];

    const filename = `sap_reconciliation_${data.range.from}_to_${data.range.to}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("sap-reconciliation-export error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-reconciliation-day?date=YYYY-MM-DD
// Drill level-2: daftar "konfirmasi" (bundel staging) untuk satu hari kerja, tiap baris
// membawa jam SUMBER (dari mesin, clamp saat ini) vs jam DIKIRIM (staged) + status.
async function getSapReconciliationDay(req, res) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")) {
      return res.status(400).json({ error: "date (YYYY-MM-DD) wajib" });
    }
    const day = req.query.date;
    const capCfg = await loadMaxRecordConfig();
    const cutSec = CAP_CUT_SECONDS(capCfg);
    const { rows } = await pool.query(
      `SELECT
         st.id, st.pernr, st.aufnr, st.vornr, st.lstar, st.zbarcodeid, st.is_productive,
         st.is_correction, st.status,
         round(st.total_seconds/3600.0, 2)::float AS sent_hrs,
         to_char(st.posted_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS posted_at,
         u.full_name,
         (SELECT count(*) FROM public.sap_staging_source s WHERE s.staging_id = st.id)::int AS n_rows,
         (SELECT round(sum(${CLAMPED_SEG_SECONDS})/3600.0, 2)::float
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS source_hrs,
         (SELECT round(sum(${cutSec})/3600.0, 2)::float
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS cap_cut_hrs,
         (SELECT bool_or(m.is_stuck)
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS has_stuck,
         (SELECT COALESCE(NULLIF(max(m.operation_short_text), ''), NULLIF(max(m.operation_description), ''))
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS operation_text,
         (SELECT max(m.machineid)
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS machineid,
         (SELECT max(m.machinename)
          FROM public.sap_staging_source src
          JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
          WHERE src.staging_id = st.id) AS machinename
       FROM public.sap_timesheet_staging st
       LEFT JOIN public.usernfc u
         ON u.snssb = COALESCE(NULLIF(st.pernr_origin, ''), st.pernr)
       WHERE st.source_system = 'MCH_HOURS' AND st.bucket_start::date = $1::date${plantScope("st")}
       ORDER BY (st.status='POSTED') DESC, st.is_productive DESC, st.total_seconds DESC`,
      [day],
    );
    res.json({ data: { date: day, bundles: rows }, meta: meta() });
  } catch (err) {
    console.error("sap-reconciliation-day error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-reconciliation-records?from&to&page&pageSize&q
// Tabel RECORDS (per segmen sumber MCH) dengan pagination server-side + search —
// sumber tampilan visual utama panel rekonsiliasi (sama dengan sheet Records export).
async function getSapReconciliationRecords(req, res) {
  try {
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : null;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : null;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 100, 10), 500);
    const q = String(req.query.q || "").trim();

    const capCfg = await loadMaxRecordConfig();
    const sourceParam = String(req.query.source || "all").toLowerCase();
    const source = ["mch", "timesheet", "all"].includes(sourceParam) ? sourceParam : "all";

    const params = [fromDate, toDate];
    if (q) params.push(`%${q}%`);
    // Kolom berat (break/cap cut) dihitung HANYA untuk baris halaman — base pemilihan
    // staging tetap ringan sehingga range besar tidak memperlambat halaman.
    const sql = buildRecordsPageSql(capCfg, { source, search: Boolean(q) });
    const { rows } = await pool.query(sql, [...params, pageSize, (page - 1) * pageSize]);
    const total = rows[0]?.total_count || 0;
    for (const r of rows) delete r.total_count;
    res.json({ data: { records: rows, total, page, pageSize, source }, meta: meta() });
  } catch (err) {
    console.error("sap-reconciliation-records error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /dashboard/sap-staging-exclusion
// Tandai record MCH excluded (soft delete) + antri recalc otomatis hari itu.
async function excludeSapRecord(req, res) {
  try {
    const sourceRowId = String(req.body?.source_row_id || "").trim();
    if (!sourceRowId) return res.status(400).json({ error: "source_row_id wajib" });
    const note = String(req.body?.note || "").trim() || null;
    const excludedBy = req.header("x-user-id") || null;

    const { rows } = await sapPool.query(
      `SELECT to_char(st.bucket_start, 'YYYY-MM-DD') AS d FROM public.sap_staging_source ss
       JOIN public.sap_timesheet_staging st ON st.id = ss.staging_id
       WHERE ss.source_system = 'MCH_HOURS' AND ss.source_row_id = $1${plantScope("st")}
       ORDER BY st.bucket_start DESC LIMIT 1`,
      [sourceRowId],
    );
    const date = rows[0]?.d || null;

    await pool.query(
      `INSERT INTO public.sap_staging_exclusion (source_system, source_row_id, excluded_by, note)
       VALUES ('MCH_HOURS', $1, $2, $3)
       ON CONFLICT (source_system, source_row_id) DO UPDATE SET note = EXCLUDED.note`,
      [sourceRowId, excludedBy, note],
    );

    let recalc = null;
    if (date) {
      try {
        const r = await sapPool.query(
          `INSERT INTO public.sap_ops_request (action, params, requested_by, plant)
           VALUES ('recalc_date', $1::jsonb, $2, $3) RETURNING id, status`,
          [JSON.stringify({ date }), excludedBy, process.env.PLANT_SSB || null],
        );
        recalc = r.rows[0];
      } catch (err) {
        if (err.code !== "23505") throw err;
      }
    }
    res.json({ data: { excluded: true, source_row_id: sourceRowId, date, recalc }, meta: meta() });
  } catch (err) {
    console.error("excludeSapRecord error:", err);
    res.status(500).json({ error: err.message });
  }
}

// DELETE /dashboard/sap-staging-exclusion?source_row_id=...
async function unexcludeSapRecord(req, res) {
  try {
    const sourceRowId = String(req.query.source_row_id || "").trim();
    if (!sourceRowId) return res.status(400).json({ error: "source_row_id wajib" });

    const { rows } = await pool.query(
      `SELECT to_char(startdatetime, 'YYYY-MM-DD') AS d FROM public.mch_transaction WHERE proddataid = $1::int LIMIT 1`,
      [sourceRowId],
    );
    const date = rows[0]?.d || null;

    await pool.query(
      `DELETE FROM public.sap_staging_exclusion WHERE source_system = 'MCH_HOURS' AND source_row_id = $1`,
      [sourceRowId],
    );

    let recalc = null;
    if (date) {
      try {
        const r = await sapPool.query(
          `INSERT INTO public.sap_ops_request (action, params, requested_by, plant)
           VALUES ('recalc_date', $1::jsonb, $2, $3) RETURNING id, status`,
          [JSON.stringify({ date }), req.header("x-user-id") || null, process.env.PLANT_SSB || null],
        );
        recalc = r.rows[0];
      } catch (err) {
        if (err.code !== "23505") throw err;
      }
    }
    res.json({ data: { excluded: false, source_row_id: sourceRowId, date, recalc }, meta: meta() });
  } catch (err) {
    console.error("unexcludeSapRecord error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-staging-exclusion — daftar record excluded + detail sumber
// Filter opsional: from, to (tanggal record MCH), q (cari pernr/nama/mesin/aktivitas/id/note).
async function listSapExclusions(req, res) {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const q = String(req.query.q || "").trim();
    const conds = ["ex.source_system = 'MCH_HOURS'"];
    const params = [];
    if (from && to) {
      params.push(from, to);
      conds.push(`m.startdatetime::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }
    if (q) {
      params.push(`%${q}%`);
      conds.push(`(m.sn_employee ILIKE $${params.length} OR COALESCE(u.full_name, '') ILIKE $${params.length}
        OR m.machinename ILIKE $${params.length} OR COALESCE(m.status_activitytype, '') ILIKE $${params.length}
        OR ex.source_row_id ILIKE $${params.length} OR COALESCE(ex.note, '') ILIKE $${params.length})`);
    }
    const { rows } = await pool.query(
      `SELECT ex.source_row_id, ex.excluded_by, ex.excluded_at, ex.note,
              m.sn_employee AS pernr, COALESCE(u.full_name, '') AS name,
              m.machinename, m.status_activitytype AS activity,
              to_char(m.startdatetime, 'YYYY-MM-DD') AS record_date,
              m.startdatetime, COALESCE(m.end_effective, m.enddatetime) AS end_dt,
              COALESCE(m.duration_seconds, EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime)))::bigint AS raw_seconds
       FROM public.sap_staging_exclusion ex
       JOIN public.mch_transaction m ON m.proddataid = ex.source_row_id::int
       LEFT JOIN public.usernfc u ON u.snssb = m.sn_employee
       WHERE ${conds.join(" AND ")}
       ORDER BY ex.excluded_at DESC`,
      params,
    );
    res.json({ data: { exclusions: rows }, meta: meta() });
  } catch (err) {
    console.error("listSapExclusions error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /dashboard/sap-reconciliation-record?staging_id=123
// Drill level-3: rekaman mch_transaction mentah pembentuk satu konfirmasi + respons SAP.
async function getSapReconciliationRecord(req, res) {
  try {
    const stagingId = parseInt(req.query.staging_id, 10);
    if (!Number.isInteger(stagingId)) {
      return res.status(400).json({ error: "staging_id wajib" });
    }
    const capCfg = await loadMaxRecordConfig();
    const cutSec = CAP_CUT_SECONDS(capCfg);
    const [head, rows] = await Promise.all([
      sapPool.query(
        `SELECT id, status, aufnr, vornr, lstar, pernr, zbarcodeid, is_productive,
           round(total_seconds/3600.0,2)::float AS sent_hrs,
           to_char(bucket_start,'YYYY-MM-DD') AS day,
           COALESCE(sap_response_text, sap_error, '') AS sap_response
         FROM public.sap_timesheet_staging WHERE id = $1${PW_SQL}`,
        [stagingId],
      ),
      pool.query(
        `SELECT m.proddataid, m.machineid, m.status_description,
           to_char(m.startdatetime, 'HH24:MI:SS') AS mulai,
           to_char(COALESCE(m.end_effective, m.enddatetime), 'HH24:MI:SS') AS selesai,
           round(src.seconds/3600.0, 2)::float AS contributed_hrs,
           round(EXTRACT(EPOCH FROM (m.enddatetime - m.startdatetime))/3600.0, 2)::float AS raw_hrs,
           round(EXTRACT(EPOCH FROM (COALESCE(m.end_effective, m.enddatetime) - m.startdatetime))/3600.0, 2)::float AS clamp_hrs,
           round(${cutSec}/3600.0, 2)::float AS cap_cut_hrs,
           COALESCE(m.is_stuck, false) AS is_stuck
         FROM public.sap_staging_source src
         JOIN public.mch_transaction m ON m.proddataid = src.source_row_id::int
         WHERE src.staging_id = $1
         ORDER BY m.startdatetime`,
        [stagingId],
      ),
    ]);
    res.json({ data: { bundle: head.rows[0] || null, records: rows.rows }, meta: meta() });
  } catch (err) {
    console.error("sap-reconciliation-record error:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  loadMaxRecordConfig,
  buildRecordsSql,
  buildRecordsPageSql,
  getKpi,
  getSapReconciliation,
  exportSapReconciliation,
  getSapReconciliationDay,
  getSapReconciliationRecords,
  getSapReconciliationRecord,
  excludeSapRecord,
  unexcludeSapRecord,
  listSapExclusions,
  getOrderStatus,
  getWorkload,
  getDailyHours,
  getOperatorEfficiency,
  getOntimeMonthly,
  getProgressDistribution,
  getValidationRate,
  getOperatorHeatmap,
  getWorkcenterList,
  getOperationsHub,
  getSapTimesheetStagingLog,
  getSapTimesheetStagingSummary,
  enqueueSapOps,
  getSapOpsRequests,
  getSapCorrections,
  postCorrections,
  getMachineHoursMatrix,
  getMachineHoursRecords,
  getPh3Jobs,
  getOperators,
  saveMachineHoursOverride,
  getOrderProgress,
  getOrderActivityDetail,
  getOperationTimesheetHistory,
  refreshOrderMatviews,
};
