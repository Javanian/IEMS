const { WebSocket } = require('ws');
const pool = global.pool;
const { resolveTimezone } = require('../config/timezone');

const TZ = resolveTimezone();

function paramsFromUrl(url) {
  const searchParams = new URL(url, 'http://localhost').searchParams;
  return Object.fromEntries(searchParams.entries());
}

function parseInterval(value) {
  const interval = parseInt(value, 10);
  if (!Number.isFinite(interval)) return 30000;
  return Math.min(120000, Math.max(15000, interval));
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function oeeScore(value) {
  if (value >= 85) return 'good';
  if (value >= 60) return 'warning';
  return 'critical';
}

async function fetchDashboardSnapshot() {
  const [oeeSummary, oeeTrend, lossBreakdown, paretoLoss, leanDist] = await Promise.all([
    pool.query(`
      WITH labor_today AS (
        SELECT
          COALESCE(SUM(duration), 0) AS actual_hours,
          COALESCE(SUM(planhours), 0) AS plan_hours
        FROM timesheet_transaction
        WHERE DATE((longdate_checkin AT TIME ZONE '${TZ}')) = CURRENT_DATE
          AND state_flag != 5 AND activitytype IS NULL
      ),
      quality_today AS (
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE validation_status IS NOT NULL AND validation_status != '')::int AS validated
        FROM processcontroldata
        WHERE (createddate AT TIME ZONE '${TZ}')::date = CURRENT_DATE
      ),
      orders_active AS (
        SELECT COUNT(DISTINCT order_no)::int AS active_orders,
          COUNT(DISTINCT order_no) FILTER (WHERE plan_finish < CURRENT_DATE AND COALESCE(progress,0)<100 AND COALESCE(systemstatus,'') NOT IN ('TECO','CLSD'))::int AS overdue_orders,
          ROUND(COALESCE(SUM(actual_hours),0),2) AS total_actual_hours,
          ROUND(COALESCE(SUM(planhours),0),2) AS total_plan_hours
        FROM sow WHERE COALESCE(systemstatus,'') NOT IN ('TECO','CLSD')
          -- Phase 6 (D4): total_plan_hours = internal workshop load feeding the OEE performance
          -- ratio. Operations marked as subcontracted are vendor work, so they leave this bucket.
          -- Mirrors mpsDashboardController.getOeeSummary / getSnapshot — keep the three in sync.
          -- DEPLOY NOTE: public.sow_subcont_mark only exists after migration
          -- database/migrations/api/20260803b_sow_subcont_mark.sql. Before that this snapshot
          -- query throws (undefined_table) and the socket pushes an error frame instead of data.
          AND NOT EXISTS (
            SELECT 1 FROM public.sow_subcont_mark scm
            WHERE ltrim(scm.order_no, '0') = ltrim(sow.order_no, '0')
              AND scm.operation_no = sow.operation_no
              AND scm.unmarked_at IS NULL
          )
      )
      SELECT l.actual_hours, l.plan_hours,
        ROUND(l.actual_hours / NULLIF(l.plan_hours,0) * 100, 1) AS availability_pct,
        o.total_actual_hours, o.total_plan_hours,
        ROUND(o.total_actual_hours / NULLIF(o.total_plan_hours,0) * 100, 1) AS performance_pct,
        q.total AS quality_total, q.validated AS quality_validated,
        ROUND(q.validated::numeric / NULLIF(q.total,0) * 100, 1) AS quality_pct,
        o.active_orders, o.overdue_orders
      FROM labor_today l CROSS JOIN orders_active o CROSS JOIN quality_today q
    `),
    pool.query(`
      SELECT DATE((longdate_checkin AT TIME ZONE '${TZ}'))::text AS day,
        ROUND(COALESCE(SUM(duration),0),2)::float AS actual_hours,
        ROUND(COALESCE(SUM(planhours),0),2)::float AS plan_hours,
        ROUND(COALESCE(SUM(duration),0) / NULLIF(COALESCE(SUM(planhours),0),0) * 100, 1)::float AS availability_pct
      FROM timesheet_transaction
      WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '14 days'
        AND state_flag != 5 AND activitytype IS NULL
      GROUP BY DATE((longdate_checkin AT TIME ZONE '${TZ}'))
      ORDER BY 1
    `),
    pool.query(`
      WITH td AS (
        SELECT COALESCE(SUM(duration),0) AS actual_hours,
          COALESCE(SUM(planhours),0) AS plan_hours
        FROM timesheet_transaction
        WHERE DATE((longdate_checkin AT TIME ZONE '${TZ}')) = CURRENT_DATE
          AND state_flag != 5 AND activitytype IS NULL
      )
      SELECT
        ROUND(t.plan_hours - t.actual_hours, 2)::float AS availability_loss,
        ROUND(t.actual_hours * 0.15, 2)::float AS performance_loss,
        ROUND(t.actual_hours * 0.05, 2)::float AS quality_loss
      FROM td t
    `),
    pool.query(`
      SELECT COALESCE(NULLIF(activitytype,''),'Unknown') AS activity,
        ROUND(COALESCE(SUM(duration),0),2)::float AS total_hours,
        COUNT(*)::int AS occurrences
      FROM timesheet_transaction
      WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '30 days'
        AND state_flag != 5 AND activitytype IS NOT NULL
      GROUP BY activitytype
      HAVING COALESCE(SUM(duration),0) > 0
      ORDER BY total_hours DESC LIMIT 10
    `),
    pool.query(`
      SELECT COALESCE(SUM(duration) FILTER (WHERE activitytype IS NULL),0)::float AS va_hours,
        COALESCE(SUM(duration) FILTER (WHERE activitytype IS NOT NULL),0)::float AS nva_nnva_hours,
        COALESCE(SUM(duration),0)::float AS total_hours
      FROM timesheet_transaction
      WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '7 days' AND state_flag != 5
    `),
  ]);

  const sumRow = oeeSummary.rows[0] || {};
  const a = num(sumRow.availability_pct);
  const p = num(sumRow.performance_pct);
  const q = num(sumRow.quality_pct);
  const oeeVal = a && p && q ? Math.round((a * p * q) / 10000) : 0;

  const trendRows = oeeTrend.rows.map((r) => {
    const av = num(r.availability_pct);
    return {
      day: r.day,
      label: r.day ? r.day.slice(5) : '',
      oee: av && 85 && 95 ? Math.round((av * 85 * 95) / 10000) : av,
      availability: av,
      performance: 85,
      quality: 95,
      actual_hours: num(r.actual_hours),
      plan_hours: num(r.plan_hours),
    };
  });

  const lossRow = lossBreakdown.rows[0] || {};
  const leanRow = leanDist.rows[0] || {};

  return {
    oee: oeeVal,
    availability: a,
    performance: p,
    quality: q,
    active_orders: num(sumRow.active_orders),
    overdue_orders: num(sumRow.overdue_orders),
    actual_hours: num(sumRow.actual_hours),
    plan_hours: num(sumRow.plan_hours),
    quality_total: num(sumRow.quality_total),
    quality_validated: num(sumRow.quality_validated),
    scores: {
      oee: oeeScore(oeeVal),
      availability: oeeScore(a),
      performance: oeeScore(p),
      quality: oeeScore(q),
    },
    trend: trendRows,
    losses: {
      availability_loss: num(lossRow.availability_loss),
      performance_loss: num(lossRow.performance_loss),
      quality_loss: num(lossRow.quality_loss),
      planned_time: num(sumRow.plan_hours),
      operating_time: num(sumRow.actual_hours),
    },
    pareto: paretoLoss.rows,
    lean: {
      va_hours: num(leanRow.va_hours),
      nva_nnva_hours: num(leanRow.nva_nnva_hours),
      total_hours: num(leanRow.total_hours),
      va_pct: (num(leanRow.va_hours) / Math.max(1, num(leanRow.total_hours))) * 100,
      nva_nnva_pct: (num(leanRow.nva_nnva_hours) / Math.max(1, num(leanRow.total_hours))) * 100,
    },
  };
}

function initMPSDashboardSocket(wss) {
  wss.on('connection', (socket, request) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname !== '/dashboard/ws') return;

    let filters = paramsFromUrl(request.url);
    let timer;

    const sendSnapshot = async () => {
      if (socket.readyState !== WebSocket.OPEN) return;

      try {
        const data = await fetchDashboardSnapshot();
        socket.send(
          JSON.stringify({
            type: 'snapshot',
            data,
            meta: { generated_at: new Date().toISOString() },
          })
        );
      } catch (err) {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: err.message,
            generated_at: new Date().toISOString(),
          })
        );
      }
    };

    const startPolling = () => {
      clearInterval(timer);
      timer = setInterval(sendSnapshot, parseInterval(filters.interval));
    };

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'setFilters') {
          filters = { ...filters, ...(message.filters || {}) };
          startPolling();
          sendSnapshot();
        }
        if (message.type === 'refresh') {
          sendSnapshot();
        }
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid WebSocket message' }));
      }
    });

    socket.on('close', () => clearInterval(timer));
    socket.on('error', () => clearInterval(timer));

    sendSnapshot();
    startPolling();
  });
}

module.exports = initMPSDashboardSocket;
