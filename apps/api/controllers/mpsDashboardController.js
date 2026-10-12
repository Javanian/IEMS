const pool = global.pool || require('../db');
const { resolveTimezone } = require('../config/timezone');

const TZ = resolveTimezone();

const meta = () => ({ generated_at: new Date().toISOString() });

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function oeeScore(value) {
  if (value >= 85) return 'good';
  if (value >= 60) return 'warning';
  return 'critical';
}

async function getOeeSummary(req, res) {
  try {
    const result = await pool.query(`
      WITH labor_today AS (
        SELECT
          COALESCE(SUM(duration), 0) AS actual_hours,
          COALESCE(SUM(planhours), 0) AS plan_hours
        FROM timesheet_transaction
        WHERE DATE((longdate_checkin AT TIME ZONE '${TZ}')) = CURRENT_DATE
          AND state_flag != 5
          AND activitytype IS NULL
      ),
      quality_today AS (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE validation_status IS NOT NULL AND validation_status != '')::int AS validated
        FROM processcontroldata
        WHERE (createddate AT TIME ZONE '${TZ}')::date = CURRENT_DATE
      ),
      orders_active AS (
        SELECT
          COUNT(DISTINCT order_no)::int AS active_orders,
          COUNT(DISTINCT order_no) FILTER (
            WHERE plan_finish < CURRENT_DATE
              AND COALESCE(progress, 0) < 100
              AND COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
          )::int AS overdue_orders,
          ROUND(COALESCE(SUM(actual_hours), 0), 2) AS total_actual_hours,
          ROUND(COALESCE(SUM(planhours), 0), 2) AS total_plan_hours
        FROM sow
        WHERE COALESCE(systemstatus, '') NOT IN ('TECO', 'CLSD')
          -- Phase 6 (D4): total_plan_hours drives the OEE performance ratio, i.e. internal
          -- workshop load. Operations marked as subcontracted are executed by a vendor, so
          -- both their plan and actual hours leave this bucket.
          -- DEPLOY NOTE: public.sow_subcont_mark only exists after migration
          -- database/migrations/api/20260803b_sow_subcont_mark.sql — migrate first, then deploy.
          AND NOT EXISTS (
            SELECT 1 FROM public.sow_subcont_mark scm
            WHERE ltrim(scm.order_no, '0') = ltrim(sow.order_no, '0')
              AND scm.operation_no = sow.operation_no
              AND scm.unmarked_at IS NULL
          )
      ),
      prev_day AS (
        SELECT
          COALESCE(SUM(duration), 0) AS actual_hours,
          COALESCE(SUM(planhours), 0) AS plan_hours
        FROM timesheet_transaction
        WHERE DATE((longdate_checkin AT TIME ZONE '${TZ}')) = CURRENT_DATE - 1
          AND state_flag != 5
          AND activitytype IS NULL
      )
      SELECT
        l.actual_hours,
        l.plan_hours,
        ROUND(l.actual_hours / NULLIF(l.plan_hours, 0) * 100, 1) AS availability_pct,
        o.total_actual_hours AS order_actual_hours,
        o.total_plan_hours AS order_plan_hours,
        ROUND(o.total_actual_hours / NULLIF(o.total_plan_hours, 0) * 100, 1) AS performance_pct,
        q.total AS quality_total,
        q.validated AS quality_validated,
        ROUND(
          q.validated::numeric / NULLIF(q.total, 0) * 100, 1
        ) AS quality_pct,
        o.active_orders,
        o.overdue_orders,
        p.actual_hours AS prev_actual_hours,
        p.plan_hours AS prev_plan_hours,
        ROUND(p.actual_hours / NULLIF(p.plan_hours, 0) * 100, 1) AS prev_availability_pct
      FROM labor_today l
      CROSS JOIN orders_active o
      CROSS JOIN quality_today q
      CROSS JOIN prev_day p
    `);

    const row = result.rows[0] || {};
    const availability = num(row.availability_pct);
    const performance = num(row.performance_pct);
    const quality = num(row.quality_pct);
    const oee =
      availability && performance && quality
        ? Math.round((availability * performance * quality) / 10000)
        : 0;
    const prevAvailability = num(row.prev_availability_pct);

    res.json({
      data: {
        oee,
        availability,
        performance,
        quality,
        active_orders: num(row.active_orders),
        overdue_orders: num(row.overdue_orders),
        actual_hours: num(row.actual_hours),
        plan_hours: num(row.plan_hours),
        quality_total: num(row.quality_total),
        quality_validated: num(row.quality_validated),
        trend: {
          availability: prevAvailability ? Math.round(availability - prevAvailability) : 0,
        },
        scores: {
          oee: oeeScore(oee),
          availability: oeeScore(availability),
          performance: oeeScore(performance),
          quality: oeeScore(quality),
        },
      },
      meta: meta(),
    });
  } catch (err) {
    console.error('mps-oee-summary error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getOeeTrend(req, res) {
  try {
    const workcenter = req.query.workcenter || 'all';
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    const result = await pool.query(
      `
      SELECT
        DATE((longdate_checkin AT TIME ZONE '${TZ}'))::text AS day,
        COALESCE(SUM(duration), 0)::float AS actual_hours,
        COALESCE(SUM(planhours), 0)::float AS plan_hours,
        ROUND(
          COALESCE(SUM(duration), 0) / NULLIF(COALESCE(SUM(planhours), 0), 0) * 100, 1
        )::float AS availability_pct,
        COUNT(*)::int AS activity_count,
        COUNT(DISTINCT full_name)::int AS operator_count
      FROM timesheet_transaction
      WHERE longdate_checkin >= CURRENT_DATE - ($2 || ' days')::interval
        AND state_flag != 5
        AND activitytype IS NULL
        AND ($1 = 'all' OR workcentercode = $1)
      GROUP BY DATE((longdate_checkin AT TIME ZONE '${TZ}'))
      ORDER BY 1
    `,
      [workcenter, days]
    );

    const qualityTrend = await pool.query(
      `
      SELECT
        (createddate AT TIME ZONE '${TZ}')::date::text AS day,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE validation_status IS NOT NULL AND validation_status != '')::int AS validated,
        ROUND(
          COUNT(*) FILTER (WHERE validation_status IS NOT NULL AND validation_status != '')::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
        )::float AS quality_pct
      FROM processcontroldata
      WHERE createddate >= CURRENT_DATE - ($2 || ' days')::interval
        AND ($1 = 'all' OR workcenter = $1)
      GROUP BY (createddate AT TIME ZONE '${TZ}')::date
      ORDER BY 1
    `,
      [workcenter, days]
    );

    const qualityMap = {};
    qualityTrend.rows.forEach((r) => {
      qualityMap[r.day] = num(r.quality_pct);
    });

    const merged = result.rows.map((r) => {
      const avail = num(r.availability_pct);
      const perf = 85;
      const qual = qualityMap[r.day] || 100;
      const oee = avail && perf && qual ? Math.round((avail * perf * qual) / 10000) : 0;
      return {
        day: r.day,
        label: r.day ? r.day.slice(5) : '',
        oee,
        availability: avail,
        performance: perf,
        quality: qual,
        actual_hours: num(r.actual_hours),
        plan_hours: num(r.plan_hours),
        activity_count: num(r.activity_count),
        operator_count: num(r.operator_count),
      };
    });

    res.json({ data: merged, meta: meta() });
  } catch (err) {
    console.error('mps-oee-trend error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getLossBreakdown(req, res) {
  try {
    const workcenter = req.query.workcenter || 'all';

    const result = await pool.query(
      `
      WITH today_data AS (
        SELECT
          COALESCE(SUM(duration), 0) AS actual_hours,
          COALESCE(SUM(planhours), 0) AS plan_hours
        FROM timesheet_transaction
        WHERE DATE((longdate_checkin AT TIME ZONE '${TZ}')) = CURRENT_DATE
          AND state_flag != 5
          AND activitytype IS NULL
          AND ($1 = 'all' OR workcentercode = $1)
      ),
      unproductive AS (
        SELECT
          COALESCE(SUM(duration), 0) AS nva_hours
        FROM timesheet_transaction
        WHERE DATE((longdate_checkin AT TIME ZONE '${TZ}')) = CURRENT_DATE
          AND state_flag != 5
          AND activitytype IS NOT NULL
          AND ($1 = 'all' OR workcentercode = $1)
      ),
      quality AS (
        SELECT
          COUNT(*) FILTER (WHERE validation_status IS NULL OR validation_status = '')::int AS pending,
          COUNT(*)::int AS total
        FROM processcontroldata
        WHERE (createddate AT TIME ZONE '${TZ}')::date = CURRENT_DATE
          AND ($1 = 'all' OR workcenter = $1)
      )
      SELECT
        t.plan_hours AS planned_time,
        t.actual_hours AS operating_time,
        ROUND(t.plan_hours - t.actual_hours, 2)::float AS availability_loss,
        ROUND(t.actual_hours * 0.15, 2)::float AS performance_loss,
        ROUND(
          CASE WHEN q.total > 0
            THEN t.actual_hours * (q.pending::numeric / q.total)
            ELSE 0
          END, 2
        )::float AS quality_loss,
        ROUND(u.nva_hours, 2)::float AS unproductive_hours,
        q.pending AS quality_pending,
        q.total AS quality_total
      FROM today_data t
      CROSS JOIN unproductive u
      CROSS JOIN quality q
    `,
      [workcenter]
    );

    const row = result.rows[0] || {};
    const planned = num(row.planned_time);
    const operating = num(row.operating_time);
    const availLoss = num(row.availability_loss);
    const perfLoss = num(row.performance_loss);
    const qualLoss = num(row.quality_loss);
    const productive = operating - perfLoss - qualLoss;

    res.json({
      data: {
        planned_time: planned,
        operating_time: operating,
        productive_time: Math.max(0, productive),
        losses: [
          { name: 'Availability Loss', value: Math.max(0, availLoss), fill: '#f87171' },
          { name: 'Performance Loss', value: Math.max(0, perfLoss), fill: '#fb923c' },
          { name: 'Quality Loss', value: Math.max(0, qualLoss), fill: '#a78bfa' },
        ],
        waterfall: [
          { name: 'Planned Time', value: planned, fill: '#94a3b8' },
          { name: 'Operating Time', value: operating, fill: '#60a5fa' },
          { name: 'Productive Time', value: Math.max(0, productive), fill: '#34d399' },
        ],
        unproductive_hours: num(row.unproductive_hours),
        quality_pending: num(row.quality_pending),
        quality_total: num(row.quality_total),
      },
      meta: meta(),
    });
  } catch (err) {
    console.error('mps-loss-breakdown error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getParetoLoss(req, res) {
  try {
    const workcenter = req.query.workcenter || 'all';

    const result = await pool.query(
      `
      WITH unproductive_activities AS (
        SELECT
          COALESCE(NULLIF(activitytype, ''), 'Unknown') AS activity,
          ROUND(COALESCE(SUM(duration), 0), 2)::float AS total_hours,
          COUNT(*)::int AS occurrences
        FROM timesheet_transaction
        WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '30 days'
          AND state_flag != 5
          AND activitytype IS NOT NULL
          AND ($1 = 'all' OR workcentercode = $1)
        GROUP BY activitytype
      ),
      ranked AS (
        SELECT
          activity,
          total_hours,
          occurrences,
          ROUND(total_hours / NULLIF(SUM(total_hours) OVER (), 0) * 100, 1)::float AS pct,
          SUM(total_hours) OVER (ORDER BY total_hours DESC)::float AS cumulative,
          ROUND(
            SUM(total_hours) OVER (ORDER BY total_hours DESC)
            / NULLIF(SUM(total_hours) OVER (), 0) * 100, 1
          )::float AS cumulative_pct
        FROM unproductive_activities
      )
      SELECT * FROM ranked
      WHERE total_hours > 0
      ORDER BY total_hours DESC
      LIMIT 10
    `,
      [workcenter]
    );

    res.json({ data: result.rows, meta: meta() });
  } catch (err) {
    console.error('mps-pareto-loss error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getLeanDistribution(req, res) {
  try {
    const workcenter = req.query.workcenter || 'all';

    const daily = await pool.query(
      `
      SELECT
        DATE((longdate_checkin AT TIME ZONE '${TZ}'))::text AS day,
        COALESCE(SUM(duration) FILTER (WHERE activitytype IS NULL), 0)::float AS va_hours,
        COALESCE(SUM(duration) FILTER (WHERE activitytype IS NOT NULL), 0)::float AS nva_nnva_hours,
        COALESCE(SUM(duration), 0)::float AS total_hours
      FROM timesheet_transaction
      WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '14 days'
        AND state_flag != 5
        AND ($1 = 'all' OR workcentercode = $1)
      GROUP BY DATE((longdate_checkin AT TIME ZONE '${TZ}'))
      ORDER BY 1
    `,
      [workcenter]
    );

    const summary = await pool.query(
      `
      SELECT
        COALESCE(SUM(duration) FILTER (WHERE activitytype IS NULL), 0)::float AS va_hours,
        COALESCE(SUM(duration) FILTER (WHERE activitytype IS NOT NULL), 0)::float AS nva_nnva_hours,
        COALESCE(SUM(duration), 0)::float AS total_hours,
        ROUND(
          COALESCE(SUM(duration) FILTER (WHERE activitytype IS NULL), 0)
          / NULLIF(COALESCE(SUM(duration), 0), 0) * 100, 1
        )::float AS va_pct,
        ROUND(
          COALESCE(SUM(duration) FILTER (WHERE activitytype IS NOT NULL), 0)
          / NULLIF(COALESCE(SUM(duration), 0), 0) * 100, 1
        )::float AS nva_nnva_pct
      FROM timesheet_transaction
      WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '30 days'
        AND state_flag != 5
        AND ($1 = 'all' OR workcentercode = $1)
    `,
      [workcenter]
    );

    const dailyRows = daily.rows.map((r) => ({
      day: r.day,
      label: r.day ? r.day.slice(5) : '',
      va: num(r.va_hours),
      nva_nnva: num(r.nva_nnva_hours),
      total: num(r.total_hours),
    }));

    const sumRow = summary.rows[0] || {};

    res.json({
      data: {
        daily: dailyRows,
        summary: {
          va_hours: num(sumRow.va_hours),
          nva_nnva_hours: num(sumRow.nva_nnva_hours),
          total_hours: num(sumRow.total_hours),
          va_pct: num(sumRow.va_pct),
          nva_nnva_pct: num(sumRow.nva_nnva_pct),
        },
      },
      meta: meta(),
    });
  } catch (err) {
    console.error('mps-lean-distribution error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getSnapshot(req, res) {
  try {
    const [oeeSummary, oeeTrend, lossBreakdown, paretoLoss, leanDist] = await Promise.all([
      (async () => {
        const r = await pool.query(`
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
                -- Phase 6 (D4): same internal-load bucket as getOeeSummary above; subcontracted
                -- operations are vendor work. Needs migration 20260803b_sow_subcont_mark.sql.
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
          `);
        return r.rows[0] || {};
      })(),
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
          WHERE longdate_checkin >= CURRENT_DATE - INTERVAL '7 days'
            AND state_flag != 5
        `),
    ]);

    const sumRow = oeeSummary;
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

    res.json({
      data: {
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
      },
      meta: meta(),
    });
  } catch (err) {
    console.error('mps-snapshot error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getOeeSummary,
  getOeeTrend,
  getLossBreakdown,
  getParetoLoss,
  getLeanDistribution,
  getSnapshot,
};
