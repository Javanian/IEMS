const ewsCalculator = require('../services/ewsCalculator');
const ewsRealtimeHub = require('../services/ewsRealtimeHub');
const ewsIssueGenerator = require('../services/ewsIssueGenerator');
const ewsIssueDrill = require('../services/ewsIssueDrill');
const { resolveTimezone } = require('../config/timezone');
const db = global.pool || require('../db');

const EWS_DAY_START_HOUR = Number(process.env.EWS_DAY_START_HOUR || 7);

const summaryCache = new Map();
const SUMMARY_TTL_MS = 60 * 1000;
const detailCache = new Map();
const DETAIL_TTL_MS = 60 * 1000;
function getPool() {
  return db.pool || db;
}

function clampLimit(value, fallback = 5) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 50);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceStatus(value, normalMin, criticalBelow) {
  if (value === null || value === undefined) return 'no_data';
  const parsed = num(value, null);
  if (parsed === null) return 'no_data';
  if (parsed < criticalBelow) return 'critical';
  if (parsed < normalMin) return 'watch';
  return 'normal';
}

async function getSummary(req, res) {
  try {
    const isManualDate = req.query.basis === 'date' && req.query.date;

    if (req.query.live !== '1' && !isManualDate) {
      const summary = await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);
      res.set('X-Data-Source', 'kpi-snapshot');
      res.json(summary);
      return;
    }

    const cacheKey = JSON.stringify({
      basis: req.query.basis || 'rolling',
      window: req.query.window || '',
      date: req.query.date || '',
    });
    const cached = summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < SUMMARY_TTL_MS) {
      res.set('X-Cache', 'HIT');
      res.json(cached.payload);
      return;
    }

    const summary = await ewsCalculator.calculateSystemSummary({
      basis: req.query.basis || 'rolling',
      window: req.query.window,
      date: req.query.date,
    });
    summaryCache.set(cacheKey, { createdAt: Date.now(), payload: summary });
    res.set('X-Cache', 'MISS');
    res.json(summary);
  } catch (err) {
    if (err.code === '42P01') {
      res
        .status(503)
        .json({ error: 'EWS snapshot table is not available. Run the EWS migration first.' });
      return;
    }
    console.error('ews summary error:', err);
    res.status(503).json({ error: err.message });
  }
}

const TREND_KPI_KEYS = [
  'uptime_tablet',
  'accuracy_labour',
  'adoption_labour',
  'ole',
  'uptime_hmi',
  'accuracy_machine',
  'adoption_machine',
  'oee',
];

const TREND_LEGACY_COLUMN = {
  uptime_hmi: 'uptime_pct',
  adoption_machine: 'adoption_pct',
  oee: 'oee_pct',
  ole: 'ole_pct',
};

async function getTrend(req, res) {
  try {
    const days = clampLimit(req.query.days, 7);
    const timezone = resolveTimezone();
    const pool = getPool();
    const result = await pool.query(
      `
      WITH latest_daily AS (
        SELECT DISTINCT ON ((window_end AT TIME ZONE $2)::date)
          id,
          (window_end AT TIME ZONE $2)::date AS business_date,
          window_end,
          uptime_pct,
          accuracy_pct,
          adoption_pct,
          oee_pct,
          ole_pct,
          detail_json -> 'kpis' AS kpis
        FROM ews.kpi_snapshot
        WHERE scope_type = 'system'
          AND scope_key = 'ALL'
          AND window_end >= (now() - ($1::int * interval '1 day'))
        ORDER BY (window_end AT TIME ZONE $2)::date DESC, window_end DESC, id DESC
      )
      , limited AS (
        SELECT *
        FROM latest_daily
        ORDER BY business_date DESC
        LIMIT $1
      )
      SELECT *
      FROM limited
      ORDER BY business_date ASC
      `,
      [days, timezone]
    );

    const trend = {};

    for (const key of [...TREND_KPI_KEYS, 'uptime', 'accuracy', 'adoption']) trend[key] = [];

    for (const row of result.rows) {
      const point = {
        snapshot_id: row.id,
        date: row.business_date,
        window_end: row.window_end,
      };

      const byKey = {};
      if (Array.isArray(row.kpis)) {
        for (const kpi of row.kpis) {
          if (kpi && typeof kpi.key === 'string') {
            byKey[kpi.key] =
              kpi.value === null || kpi.value === undefined ? null : num(kpi.value, null);
          }
        }
      }

      for (const key of TREND_KPI_KEYS) {
        let value = byKey[key] ?? null;
        if (value === null) {
          const column = TREND_LEGACY_COLUMN[key];
          const legacy = column ? row[column] : null;
          if (legacy !== null && legacy !== undefined) value = num(legacy, null);
        }
        trend[key].push({ ...point, value });
      }

      trend.uptime.push({
        ...point,
        value: row.uptime_pct === null ? null : num(row.uptime_pct, null),
      });
      trend.accuracy.push({
        ...point,
        value: row.accuracy_pct === null ? null : num(row.accuracy_pct, null),
      });
      trend.adoption.push({
        ...point,
        value: row.adoption_pct === null ? null : num(row.adoption_pct, null),
      });
    }

    res.json({
      data: trend,
      meta: {
        days,
        timezone,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err.code === '42P01') {
      res
        .status(503)
        .json({ error: 'EWS snapshot table is not available. Run the EWS migration first.' });
      return;
    }
    console.error('ews trend error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function buildUptimeSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        id,
        checked_at,
        machineid,
        machinename,
        ipaddress,
        COALESCE(ping_count, 0) AS ping_count,
        COALESCE(success_count, 0) AS success_count,
        COALESCE(failed_count, 0) AS failed_count,
        avg_latency_ms::float AS avg_latency_ms,
        packet_loss_percent::float AS packet_loss_percent,
        status,
        (COALESCE(failed_count, 0) > 0 OR UPPER(COALESCE(status, '')) = 'DOWN') AS is_failure
      FROM public.mch_machine_ping_log
      WHERE checked_at >= $1::timestamptz
        AND checked_at < $2::timestamptz
    ),
    streaks AS (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY machineid ORDER BY checked_at)
          - ROW_NUMBER() OVER (PARTITION BY machineid, is_failure ORDER BY checked_at) AS streak_group
      FROM base
    ),
    failure_streaks AS (
      SELECT machineid, COUNT(*)::int AS failure_count
      FROM streaks
      WHERE is_failure
      GROUP BY machineid, streak_group
    ),
    per_machine AS (
      SELECT
        b.machineid,
        MAX(b.machinename) AS machinename,
        MAX(b.ipaddress) AS ipaddress,
        COUNT(*)::int AS sample_count,
        SUM(b.ping_count)::int AS ping_count,
        SUM(b.success_count)::int AS success_count,
        SUM(b.failed_count)::int AS failed_count,
        COUNT(*) FILTER (WHERE b.is_failure)::int AS failed_samples,
        ROUND(((SUM(b.success_count)::numeric / NULLIF(SUM(b.ping_count), 0)) * 100)::numeric, 2)::float AS uptime_pct,
        ROUND(((SUM(b.failed_count)::numeric * 10.0) / 60.0)::numeric, 2)::float AS downtime_minutes,
        ROUND(AVG(b.avg_latency_ms)::numeric, 2)::float AS avg_latency_ms,
        ROUND(MAX(b.packet_loss_percent)::numeric, 2)::float AS max_packet_loss_percent,
        COALESCE(MAX(fs.failure_count), 0)::int AS max_consecutive_fail
      FROM base b
      LEFT JOIN failure_streaks fs ON fs.machineid = b.machineid
      GROUP BY b.machineid
    )
    SELECT
      COALESCE(jsonb_agg(to_jsonb(per_machine) ORDER BY uptime_pct ASC NULLS LAST, failed_count DESC), '[]'::jsonb) AS by_machine,
      (
        SELECT COALESCE(jsonb_agg(to_jsonb(bad_rows) ORDER BY checked_at DESC), '[]'::jsonb)
        FROM (
          SELECT
            'public.mch_machine_ping_log' AS source_table,
            id::text AS source_id,
            checked_at,
            machineid,
            machinename,
            ipaddress,
            status,
            ping_count,
            success_count,
            failed_count,
            packet_loss_percent,
            avg_latency_ms,
            CASE
              WHEN is_failure THEN 'Ping/heartbeat failure'
              ELSE 'Monitor'
            END AS issue_description
          FROM base
          WHERE is_failure
          ORDER BY checked_at DESC
          LIMIT 50
        ) bad_rows
      ) AS sample_rows,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.hour_ts), '[]'::jsonb)
        FROM (
          SELECT
            to_char(date_trunc('hour', checked_at AT TIME ZONE $3), 'HH24:00') AS hour_label,
            MIN(checked_at) AS hour_ts,
            SUM(ping_count)::int AS ping_count,
            SUM(success_count)::int AS success_count,
            SUM(failed_count)::int AS failed_count,
            ROUND(((SUM(success_count)::numeric / NULLIF(SUM(ping_count), 0)) * 100)::numeric, 2)::float AS uptime_pct
          FROM base
          GROUP BY 1
        ) h
      ) AS hourly
    FROM per_machine
    `,
    [windowStart, windowEnd, resolveTimezone()]
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ['public.mch_machine_ping_log'],
    false_alert_rule: 'Real problem when max_consecutive_fail >= 6 samples',
    by_machine: row.by_machine || [],
    hourly: row.hourly || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildAccuracySourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        t.*,
        EXISTS (
          SELECT 1
          FROM public.sow s
          WHERE LTRIM(COALESCE(s.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND s.operation_no::text = t.operation_no::text
        ) AS has_sow_match,
        ABS(
          COALESCE(t.duration, 0)
          - COALESCE(EXTRACT(EPOCH FROM (t.longdate_checkout - t.longdate_checkin)) / 3600.0, COALESCE(t.duration, 0))
        ) AS duration_delta_hours,
        COUNT(*) OVER (
          PARTITION BY t.serialnumber, t.order_no, t.operation_no, t.longdate_checkin
        ) AS duplicate_count
      FROM public.timesheet_transaction t
      WHERE t.longdate_checkin >= $1::timestamptz
        AND t.longdate_checkin < $2::timestamptz
        AND COALESCE(t.state_flag, 1) <> 5
    ),
    flags AS (
      SELECT
        *,
        (activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL) AS missing_order,
        (activitytype IS NULL AND operation_no IS NULL) AS missing_operation,
        (longdate_checkin IS NULL) AS missing_checkin,
        (activitytype IS NULL AND planhours IS NULL) AS missing_planhours,
        (duration IS NULL OR duration < 0) AS invalid_duration,
        (activitytype IS NULL AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL AND operation_no IS NOT NULL AND NOT has_sow_match) AS sow_no_match,
        (longdate_checkout IS NOT NULL AND duration_delta_hours > 0.10) AS duration_mismatch,
        (COALESCE(duration, 0) > 10 OR (longdate_checkout IS NULL AND longdate_checkin < now() - interval '90 minutes')) AS outlier_duration,
        (duplicate_count > 1) AS duplicate_record
      FROM base
    ),
    ts_errors AS (
      SELECT
        'public.timesheet_transaction' AS source_table,
        tsnumber::text AS source_id,
        longdate_checkin AS event_time,
        NULLIF(BTRIM(workcentercode), '') AS machine_id,
        NULLIF(BTRIM(serialnumber), '') AS operator_id,
        full_name AS operator_name,
        order_no,
        operation_no::text AS operation_no,
        err.error_type,
        err.error_code,
        err.issue_description,
        jsonb_build_object(
          'duration', duration,
          'planhours', planhours,
          'confirmationnumber', confirmationnumber,
          'state_flag', state_flag
        ) AS raw_context
      FROM flags
      CROSS JOIN LATERAL (
        VALUES
          ('Missing', 'missing_order', 'Order number is empty'),
          ('Missing', 'missing_operation', 'Operation number is empty'),
          ('Missing', 'missing_checkin', 'Check-in timestamp is empty'),
          ('Missing', 'missing_planhours', 'Plan hours is empty'),
          ('Invalid', 'invalid_duration', 'Duration is null or negative'),
          ('Invalid', 'sow_no_match', 'Order and operation do not match SOW'),
          ('Inconsistent', 'duration_mismatch', 'Duration does not match check-in/check-out time'),
          ('Outlier', 'outlier_duration', 'Runtime is abnormal or checkout is stale'),
          ('Duplicate', 'duplicate_record', 'Potential duplicate timesheet row')
      ) AS err(error_type, error_code, issue_description)
      WHERE CASE err.error_code
        WHEN 'missing_order' THEN missing_order
        WHEN 'missing_operation' THEN missing_operation
        WHEN 'missing_checkin' THEN missing_checkin
        WHEN 'missing_planhours' THEN missing_planhours
        WHEN 'invalid_duration' THEN invalid_duration
        WHEN 'sow_no_match' THEN sow_no_match
        WHEN 'duration_mismatch' THEN duration_mismatch
        WHEN 'outlier_duration' THEN outlier_duration
        WHEN 'duplicate_record' THEN duplicate_record
        ELSE false
      END
    ),
    sap_errors AS (
      SELECT
        'public.sap_timesheet_staging' AS source_table,
        id::text AS source_id,
        created_at AS event_time,
        NULLIF(BTRIM(arbpl), '') AS machine_id,
        NULLIF(BTRIM(pernr), '') AS operator_id,
        NULL::text AS operator_name,
        aufnr AS order_no,
        vornr AS operation_no,
        CASE WHEN UPPER(status) = 'PENDING' THEN 'Missing' ELSE 'Invalid' END AS error_type,
        LOWER(status) AS error_code,
        COALESCE(sap_error, sap_response_text, 'SAP staging row needs attention') AS issue_description,
        jsonb_build_object(
          'status', status,
          'ztimesheetid', ztimesheetid,
          'source_key', source_key,
          'sap_response', sap_response
        ) AS raw_context
      FROM public.sap_timesheet_staging
      WHERE created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
        AND UPPER(COALESCE(status, '')) IN ('FAILED', 'PENDING')
    ),
    errors AS (
      SELECT * FROM ts_errors
      UNION ALL
      SELECT * FROM sap_errors
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY error_records DESC), '[]'::jsonb)
       FROM (
         SELECT error_type, COUNT(*)::int AS error_records
         FROM errors
         GROUP BY error_type
       ) x) AS by_error_type,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY error_records DESC), '[]'::jsonb)
       FROM (
         SELECT COALESCE(machine_id, 'UNKNOWN') AS machine_id, COUNT(*)::int AS error_records
         FROM errors
         GROUP BY COALESCE(machine_id, 'UNKNOWN')
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY error_records DESC), '[]'::jsonb)
       FROM (
         SELECT COALESCE(operator_id, 'UNKNOWN') AS operator_id, MAX(operator_name) AS operator_name, COUNT(*)::int AS error_records
         FROM errors
         GROUP BY COALESCE(operator_id, 'UNKNOWN')
         LIMIT 20
       ) x) AS by_operator,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY event_time DESC), '[]'::jsonb)
       FROM (
         SELECT *
         FROM errors
         ORDER BY event_time DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd]
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ['public.timesheet_transaction', 'public.sap_timesheet_staging', 'public.sow'],
    classification: ['Missing', 'Invalid', 'Inconsistent', 'Outlier', 'Duplicate'],
    by_error_type: row.by_error_type || [],
    by_machine: row.by_machine || [],
    by_operator: row.by_operator || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildAdoptionSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH gaps AS (
      SELECT
        bucket_start,
        bucket_end,
        machine_key,
        operator_key,
        operator_name,
        has_unidentified,
        has_timesheet_match,
        machine_event_count,
        COALESCE(gap_type, CASE
          WHEN has_unidentified THEN 'unidentified'
          WHEN NOT has_timesheet_match THEN 'missing_timesheet'
          ELSE 'covered'
        END) AS gap_type
      FROM ews.adoption_bucket_snapshot
      WHERE bucket_start >= $1::timestamptz
        AND bucket_start < $2::timestamptz
    ),
    problem_gaps AS (
      SELECT *
      FROM gaps
      WHERE has_unidentified OR NOT has_timesheet_match OR gap_type <> 'covered'
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY missing_minutes DESC), '[]'::jsonb)
       FROM (
         SELECT machine_key, COUNT(*)::int AS gap_buckets, COUNT(*)::int * 5 AS missing_minutes
         FROM problem_gaps
         GROUP BY machine_key
         ORDER BY missing_minutes DESC
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY missing_minutes DESC), '[]'::jsonb)
       FROM (
         SELECT COALESCE(operator_key, 'UNKNOWN') AS operator_key, MAX(operator_name) AS operator_name, COUNT(*)::int AS gap_buckets, COUNT(*)::int * 5 AS missing_minutes
         FROM problem_gaps
         GROUP BY COALESCE(operator_key, 'UNKNOWN')
         ORDER BY missing_minutes DESC
         LIMIT 20
       ) x) AS by_operator,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY gap_buckets DESC), '[]'::jsonb)
       FROM (
         SELECT gap_type, COUNT(*)::int AS gap_buckets, COUNT(*)::int * 5 AS missing_minutes
         FROM problem_gaps
         GROUP BY gap_type
       ) x) AS by_gap_type,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY bucket_start DESC), '[]'::jsonb)
       FROM (
         SELECT
           'ews.adoption_bucket_snapshot' AS source_table,
           CONCAT(machine_key, ':', bucket_start) AS source_id,
           bucket_start,
           bucket_end,
           machine_key,
           operator_key,
           operator_name,
           gap_type,
           machine_event_count,
           has_timesheet_match,
           has_unidentified,
           CASE
             WHEN has_unidentified THEN 'Machine event has unidentified operator'
             WHEN NOT has_timesheet_match THEN 'Machine activity has no matching timesheet bucket'
             ELSE 'Adoption gap'
           END AS issue_description
         FROM problem_gaps
         ORDER BY bucket_start DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd]
  );

  const row = result.rows[0] || {};
  return {
    source_tables: [
      'ews.adoption_bucket_snapshot',
      'public.mch_transaction',
      'public.timesheet_transaction',
    ],
    bucket_minutes: 5,
    by_machine: row.by_machine || [],
    by_operator: row.by_operator || [],
    by_gap_type: row.by_gap_type || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildOeeSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        proddataid,
        startdatetime,
        enddatetime,
        machineid,
        machinename,
        statusid,
        status_description,
        status_activitytype,
        duration_hours::float AS duration_hours,
        order_no,
        operation_no,
        sn_employee,
        full_name,
        LOWER(BTRIM(COALESCE(status_description, ''))) AS normalized_status,
        CASE
          WHEN statusid = 4 OR LOWER(BTRIM(COALESCE(status_description, ''))) IN ('no job', 'off') THEN 'NoJob'
          WHEN statusid = 5 THEN 'Missing'
          WHEN COALESCE(status_activitytype, '') = 'M2'
            THEN 'NNVA'
          WHEN COALESCE(status_activitytype, '') = 'M1'
            OR LOWER(BTRIM(COALESCE(status_description, ''))) = 'productive'
            THEN 'VA'
          ELSE 'NVA'
        END AS activity_bucket,
        CASE
          WHEN LOWER(BTRIM(COALESCE(status_description, ''))) NOT IN (
            'no job',
            'off',
            'preventive',
            'breakdown',
            'coffee break / lunch',
            'daily pm'
          )
          THEN TRUE
          ELSE FALSE
        END AS denominator_eligible
      FROM public.mch_transaction
      WHERE startdatetime >= $1::timestamp
        AND startdatetime < $2::timestamp
        AND COALESCE(duration_hours, 0) > 0
    ),
    totals AS (
      SELECT
        COALESCE(SUM(duration_hours), 0)::float AS total_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'VA'), 0)::float AS va_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NNVA'), 0)::float AS nnva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NVA'), 0)::float AS nva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'Missing'), 0)::float AS missing_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NoJob'), 0)::float AS nojob_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE denominator_eligible), 0)::float AS denominator_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('VA', 'NNVA')), 0)::float AS running_hours
      FROM base
    ),
    waterfall AS (
      -- NoJob is deliberately EXCLUDED: it is the absence of work, not an actionable loss, and it
      -- dwarfs the real losses. It gets its own ranking (nojob_by_machine). Starting the walk at
      -- (total - nojob) keeps the arithmetic exact, because
      --   total = va + nnva + nva + missing + nojob  =>  (total - nojob) - missing - nnva - nva = va
      SELECT *
      FROM totals t
      CROSS JOIN LATERAL (
        VALUES
          (1, 'Total (ex NoJob)', 'total', 0::float, t.total_hours - t.nojob_hours, t.total_hours - t.nojob_hours),
          (2, 'Missing', 'loss', t.total_hours - t.nojob_hours, t.total_hours - t.nojob_hours - t.missing_hours, -t.missing_hours),
          (3, 'NNVA', 'segment', t.total_hours - t.nojob_hours - t.missing_hours, t.total_hours - t.nojob_hours - t.missing_hours - t.nnva_hours, -t.nnva_hours),
          (4, 'NVA', 'loss', t.total_hours - t.nojob_hours - t.missing_hours - t.nnva_hours, t.total_hours - t.nojob_hours - t.missing_hours - t.nnva_hours - t.nva_hours, -t.nva_hours),
          (5, 'VA', 'final', 0::float, t.va_hours, t.va_hours)
      ) AS w(sort_order, label, step_type, start_hours, end_hours, delta_hours)
    ),
    per_machine AS (
      SELECT
        machineid,
        MAX(machinename) AS machinename,
        SUM(duration_hours) AS total_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'VA'), 0)::float AS va_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NNVA'), 0)::float AS nnva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('NVA', 'Missing')), 0)::float AS nva_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'NoJob'), 0)::float AS nojob_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE denominator_eligible), 0)::float AS denominator_hours,
        COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('VA', 'NNVA')), 0)::float AS running_hours,
        ROUND(((COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket IN ('VA', 'NNVA')), 0)::numeric / NULLIF(COALESCE(SUM(duration_hours) FILTER (WHERE denominator_eligible), 0), 0)) * 100)::numeric, 2)::float AS oee_time_pct,
        COUNT(*) FILTER (WHERE activity_bucket <> 'VA')::int AS stop_count
      FROM base
      GROUP BY machineid
    )
    SELECT
      (SELECT row_to_json(t) FROM totals t) AS totals,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY sort_order), '[]'::jsonb)
       FROM (
         SELECT
           sort_order,
           label,
           step_type,
           start_hours,
           delta_hours,
           end_hours,
           ABS(delta_hours)::float AS hours
         FROM waterfall
       ) x) AS waterfall,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.oee_time_pct ASC NULLS LAST, x.loss_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           *,
           GREATEST(0, total_hours - running_hours)::float AS loss_hours,
           CASE
             -- A machine whose whole window is NoJob/Off/PM/Breakdown has denominator_hours = 0,
             -- so oee_time_pct is NULL. NULL is NOT "normal": without this branch every comparison
             -- below yields NULL, execution falls through to ELSE, and the machine renders GREEN
             -- despite having produced nothing.
             WHEN oee_time_pct IS NULL THEN 'no_data'
             WHEN oee_time_pct < 65 THEN 'critical'
             WHEN oee_time_pct < 80 THEN 'watch'
             ELSE 'normal'
           END AS status
         FROM per_machine
         -- ORDER BY must sit INSIDE the LIMIT. Without it the 20 kept rows are arbitrary and the
         -- "lowest OEE" card can silently omit the actual worst machines.
         ORDER BY oee_time_pct ASC NULLS LAST, GREATEST(0, total_hours - running_hours) DESC
         LIMIT 20
       ) x) AS by_machine,
      -- Time mix excludes NoJob (see waterfall): the 100% bar is over ACTUAL machine time.
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.working_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           machineid,
           machinename,
           (va_hours + nnva_hours + nva_hours)::float AS working_hours,
           va_hours,
           nnva_hours,
           nva_hours
         FROM per_machine
         WHERE (va_hours + nnva_hours + nva_hours) > 0
         ORDER BY (va_hours + nnva_hours + nva_hours) DESC
         LIMIT 20
       ) x) AS distribution_by_machine,
      -- NoJob gets its own ranking so it never distorts the loss analysis.
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.nojob_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           machineid,
           machinename,
           nojob_hours,
           total_hours,
           CASE WHEN total_hours > 0
             THEN ROUND(((nojob_hours / total_hours) * 100)::numeric, 1)::float
             ELSE NULL
           END AS nojob_pct
         FROM per_machine
         WHERE nojob_hours > 0
         ORDER BY nojob_hours DESC
         LIMIT 20
       ) x) AS nojob_by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           activity_bucket AS loss_type,
           SUM(duration_hours)::float AS hours,
           COUNT(*)::int AS event_count
         FROM base
         WHERE activity_bucket NOT IN ('VA', 'NoJob')
         GROUP BY activity_bucket
       ) x) AS by_loss_type,
      -- Komposisi status per bucket (sistem): NNVA = Setting/Measure/Load/Unload dst,
      -- NVA = Downtime/Idle/Coffee Break dst — supaya bar & kartu loss bisa dirinci.
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           activity_bucket AS bucket,
           COALESCE(NULLIF(BTRIM(status_description), ''), '(tanpa status)') AS status,
           SUM(duration_hours)::float AS hours,
           COUNT(*)::int AS event_count
         FROM base
         WHERE activity_bucket NOT IN ('VA', 'NoJob')
         GROUP BY activity_bucket, 2
       ) x) AS by_loss_status,
      -- Komposisi yang sama per MESIN — dipakai tooltip "Machine Time Mix".
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           machineid,
           activity_bucket AS bucket,
           COALESCE(NULLIF(BTRIM(status_description), ''), '(tanpa status)') AS status,
           SUM(duration_hours)::float AS hours
         FROM base
         WHERE activity_bucket NOT IN ('VA', 'NoJob')
         GROUP BY machineid, activity_bucket, 3
       ) x) AS mix_composition_by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY startdatetime DESC), '[]'::jsonb)
       FROM (
         SELECT
           'public.mch_transaction' AS source_table,
           proddataid::text AS source_id,
           startdatetime,
           enddatetime,
           machineid,
           machinename,
           statusid,
           status_description,
           status_activitytype,
           activity_bucket AS loss_type,
           duration_hours,
           order_no,
           operation_no,
           sn_employee,
           full_name,
           CASE
             WHEN activity_bucket = 'Missing' THEN 'Missing machine/operator mapping'
             WHEN activity_bucket = 'NoJob' THEN 'NoJob time'
             WHEN activity_bucket = 'NNVA' THEN 'NNVA setup time'
             WHEN duration_hours >= 5 THEN 'Major loss >5h'
             WHEN duration_hours < 1 THEN 'Micro loss <1h'
             ELSE 'Medium loss'
           END AS loss_size,
           CASE
             WHEN activity_bucket = 'Missing' THEN 'StatusID 5 is classified as Missing in OEE detail'
             WHEN activity_bucket = 'NoJob' THEN 'StatusID 4 is classified as NoJob and excluded from OEE denominator'
             WHEN activity_bucket = 'NNVA' THEN 'M2 setup is counted in EWS OEE running hours but shown as NNVA detail'
             ELSE 'Machine time is not VA/NNVA running time'
           END AS issue_description
         FROM base
         WHERE activity_bucket <> 'VA'
         ORDER BY startdatetime DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd]
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ['public.mch_transaction'],
    totals: row.totals || {},
    waterfall: row.waterfall || [],
    by_machine: row.by_machine || [],
    distribution_by_machine: row.distribution_by_machine || [],
    nojob_by_machine: row.nojob_by_machine || [],
    by_loss_type: row.by_loss_type || [],
    by_loss_status: row.by_loss_status || [],
    mix_composition_by_machine: row.mix_composition_by_machine || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildOleSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        tsnumber,
        longdate_checkin,
        longdate_checkout,
        serialnumber,
        full_name,
        workcentercode,
        workcenterdescription,
        duration::float AS duration_hours,
        activitytype,
        order_no,
        operation_no,
        CASE
          WHEN activitytype IS NULL
            AND NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NOT NULL
            AND COALESCE(duration, 0) > 0
          THEN 'Processing'
          WHEN LOWER(COALESCE(activitytype, '')) LIKE '%wait%' THEN 'Waiting'
          WHEN NULLIF(BTRIM(COALESCE(order_no, '')), '') IS NULL THEN 'Idle'
          ELSE COALESCE(NULLIF(activitytype, ''), 'NVA')
        END AS activity_bucket
      FROM public.timesheet_transaction
      WHERE longdate_checkin >= $1::timestamptz
        AND longdate_checkin < $2::timestamptz
        AND COALESCE(state_flag, 1) <> 5
        AND COALESCE(duration, 0) > 0
    ),
    per_operator AS (
      SELECT
        COALESCE(serialnumber, 'UNKNOWN') AS operator_id,
        MAX(full_name) AS operator_name,
        SUM(duration_hours) AS total_hours,
        SUM(duration_hours) FILTER (WHERE activity_bucket = 'Processing') AS working_hours,
        SUM(duration_hours) FILTER (WHERE activity_bucket <> 'Processing') AS nva_hours,
        ROUND(((SUM(duration_hours) FILTER (WHERE activity_bucket = 'Processing')::numeric / NULLIF(SUM(duration_hours), 0)) * 100)::numeric, 2)::float AS ole_time_pct
      FROM base
      GROUP BY COALESCE(serialnumber, 'UNKNOWN')
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY ole_time_pct ASC NULLS LAST, nva_hours DESC), '[]'::jsonb)
       FROM (
         SELECT *, CASE
           WHEN ole_time_pct < 70 THEN 'critical'
           WHEN ole_time_pct < 85 THEN 'watch'
           ELSE 'normal'
         END AS status
         FROM per_operator
         LIMIT 20
       ) x) AS by_operator,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY nva_hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           COALESCE(workcentercode, 'UNKNOWN') AS machine_id,
           MAX(workcenterdescription) AS machine_name,
           COALESCE(SUM(duration_hours), 0)::float AS total_hours,
           COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket = 'Processing'), 0)::float AS working_hours,
           COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket <> 'Processing'), 0)::float AS nva_hours
         FROM base
         GROUP BY COALESCE(workcentercode, 'UNKNOWN')
         HAVING COALESCE(SUM(duration_hours) FILTER (WHERE activity_bucket <> 'Processing'), 0) > 0
         ORDER BY nva_hours DESC
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY hours DESC), '[]'::jsonb)
       FROM (
         SELECT
           b.activitytype AS activity_bucket,
           COALESCE(r.description, 'Aktivitas ' || b.activitytype) AS activity_label,
           SUM(b.duration_hours)::float AS hours,
           COUNT(*)::int AS record_count
         FROM (
           SELECT NULLIF(BTRIM(activitytype), '') AS activitytype, duration_hours
           FROM base
           WHERE NULLIF(BTRIM(activitytype), '') IS NOT NULL
         ) b
         LEFT JOIN ews.activity_type_ref r ON r.activitytype = b.activitytype
         GROUP BY b.activitytype, COALESCE(r.description, 'Aktivitas ' || b.activitytype)
       ) x) AS by_activity,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY longdate_checkin DESC), '[]'::jsonb)
       FROM (
         SELECT
           'public.timesheet_transaction' AS source_table,
           tsnumber::text AS source_id,
           longdate_checkin,
           longdate_checkout,
           serialnumber AS operator_id,
           full_name AS operator_name,
           workcentercode AS machine_id,
           workcenterdescription AS machine_name,
           activity_bucket,
           activitytype,
           duration_hours,
           order_no,
           operation_no,
           CASE
             WHEN activity_bucket = 'Idle' THEN 'Recorded labor has no production order'
             WHEN activity_bucket = 'Waiting' THEN 'Waiting/NVA labor time'
             ELSE 'Non productive labor time'
           END AS issue_description
         FROM base
         WHERE activity_bucket <> 'Processing'
         ORDER BY longdate_checkin DESC
         LIMIT 80
       ) x) AS sample_rows
    `,
    [windowStart, windowEnd]
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ['public.timesheet_transaction'],
    by_operator: row.by_operator || [],
    by_machine: row.by_machine || [],
    by_activity: row.by_activity || [],
    sample_rows: row.sample_rows || [],
  };
}

async function buildAdoptionMachineSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        pd.machineno AS machine_no,
        pd.statusid,
        GREATEST(EXTRACT(EPOCH FROM (pd.enddatetime - pd.startdatetime)), 0)::numeric AS dur
      FROM public.mch_productiondata pd
      WHERE pd.startdatetime >= $1::timestamptz
        AND pd.startdatetime < $2::timestamptz
        AND pd.enddatetime IS NOT NULL
        AND pd.enddatetime > pd.startdatetime
    ),
    per_machine AS (
      SELECT
        b.machine_no::text AS machine,
        COALESCE(NULLIF(BTRIM(mm.machinename), ''), NULLIF(BTRIM(mm.description), ''),
                 'Machine ' || COALESCE(b.machine_no::text, '?')) AS machine_name,
        ROUND(COALESCE(SUM(dur) FILTER (WHERE statusid = 5), 0) / 60.0, 2)::float AS unidentified_minutes,
        ROUND(COALESCE(SUM(dur) FILTER (WHERE statusid = 2 AND dur > 300), 0) / 60.0, 2)::float AS idle_minutes,
        ROUND((COALESCE(SUM(dur) FILTER (WHERE statusid = 5), 0)
               + COALESCE(SUM(dur) FILTER (WHERE statusid = 2 AND dur > 300), 0)) / 60.0, 2)::float AS gap_minutes,
        ROUND(COALESCE(SUM(dur), 0) / 60.0, 2)::float AS total_minutes,
        CASE WHEN COALESCE(SUM(dur), 0) > 0
          THEN ROUND(((COALESCE(SUM(dur), 0)
                       - (COALESCE(SUM(dur) FILTER (WHERE statusid = 5), 0)
                          + COALESCE(SUM(dur) FILTER (WHERE statusid = 2 AND dur > 300), 0)))
                      / COALESCE(SUM(dur), 0)) * 100, 2)::float
          ELSE NULL END AS adoption_pct
      FROM base b
      LEFT JOIN public.mch_machines mm ON mm.machineno = b.machine_no
      GROUP BY b.machine_no, mm.machinename, mm.description
    )
    SELECT
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY gap_minutes DESC, unidentified_minutes DESC), '[]'::jsonb)
       FROM (SELECT * FROM per_machine WHERE gap_minutes > 0 ORDER BY gap_minutes DESC LIMIT 30) x) AS by_machine,
      (SELECT COUNT(*)::int FROM per_machine) AS machine_count,
      (SELECT COUNT(*)::int FROM per_machine WHERE gap_minutes > 0) AS machine_with_gap,
      (SELECT ROUND(COALESCE(SUM(unidentified_minutes), 0)::numeric, 2)::float FROM per_machine) AS total_unidentified_minutes,
      (SELECT ROUND(COALESCE(SUM(idle_minutes), 0)::numeric, 2)::float FROM per_machine) AS total_idle_minutes
    `,
    [windowStart, windowEnd]
  );
  const row = result.rows[0] || {};
  return {
    source_tables: ['public.mch_productiondata'],
    by_machine: row.by_machine || [],
    machine_count: num(row.machine_count),
    machine_with_gap: num(row.machine_with_gap),
    total_unidentified_minutes: num(row.total_unidentified_minutes),
    total_idle_minutes: num(row.total_idle_minutes),
    definitions: {
      unidentified: 'statusid = 5 (mesin jalan tanpa job/operator teridentifikasi)',
      idle: 'statusid = 2 dengan durasi > 5 menit (M2 panjang)',
    },
  };
}

async function buildAccuracyMachineSourceDetail(windowStart, windowEnd) {
  const result = await db.query(
    `
    WITH base AS (
      SELECT
        COALESCE(NULLIF(BTRIM(machineid), ''), NULLIF(BTRIM(workcentercode), ''), 'UNKNOWN') AS machine_key,
        machinename,
        status_record,
        statusid,
        status_description,
        (NULLIF(BTRIM(order_no), '') IS NULL)            AS miss_order,
        (NULLIF(BTRIM(operation_no), '') IS NULL)        AS miss_operation,
        (NULLIF(BTRIM(sn_employee), '') IS NULL)         AS miss_operator,
        (NULLIF(BTRIM(confirmation_number), '') IS NULL) AS miss_confirmation
      FROM public.mch_transaction
      WHERE startdatetime >= $1::timestamp
        AND startdatetime < $2::timestamp
    ),
    classified AS (
      SELECT
        *,
        CASE
          WHEN status_record THEN NULL
          WHEN miss_order OR miss_operation THEN 'no_job'
          WHEN miss_operator THEN 'no_operator'
          WHEN miss_confirmation THEN 'no_confirmation'
          ELSE 'other'
        END AS reason
      FROM base
    ),
    totals AS (
      SELECT
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (WHERE status_record)::int AS ready_records,
        COUNT(*) FILTER (WHERE NOT status_record)::int AS incomplete_records,
        COUNT(*) FILTER (WHERE statusid IN (0, 3, 4))::int AS exempt_records,
        CASE WHEN COUNT(*) > 0
          THEN ROUND((100.0 * COUNT(*) FILTER (WHERE status_record) / COUNT(*))::numeric, 2)::float
          ELSE NULL
        END AS accuracy_pct
      FROM classified
    )
    SELECT
      (SELECT row_to_json(t) FROM totals t) AS totals,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.incomplete DESC, x.accuracy_pct ASC NULLS LAST), '[]'::jsonb)
       FROM (
         SELECT
           machine_key,
           MAX(machinename) AS machinename,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE NOT status_record)::int AS incomplete,
           ROUND((100.0 * COUNT(*) FILTER (WHERE status_record) / COUNT(*))::numeric, 1)::float AS accuracy_pct,
           CASE
             -- Bands mirror the accuracy_machine KPI (normal >= 98, critical < 95). Guard the NULL
             -- case explicitly: a NULL comparison yields NULL, falls through to ELSE, and would
             -- paint a machine green that has no records at all.
             WHEN COUNT(*) = 0 THEN 'no_data'
             WHEN (100.0 * COUNT(*) FILTER (WHERE status_record) / COUNT(*)) < 95 THEN 'critical'
             WHEN (100.0 * COUNT(*) FILTER (WHERE status_record) / COUNT(*)) < 98 THEN 'watch'
             ELSE 'normal'
           END AS status
         FROM classified
         GROUP BY machine_key
         HAVING COUNT(*) FILTER (WHERE NOT status_record) > 0
         ORDER BY COUNT(*) FILTER (WHERE NOT status_record) DESC
         LIMIT 20
       ) x) AS by_machine,
      (SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.count DESC), '[]'::jsonb)
       FROM (
         SELECT reason, COUNT(*)::int AS count
         FROM classified
         WHERE reason IS NOT NULL
         GROUP BY reason
       ) x) AS by_reason
    `,
    [windowStart, windowEnd]
  );

  const row = result.rows[0] || {};
  return {
    source_tables: ['public.mch_transaction'],
    basis:
      'status_record = TRUE when statusid IN (0,3,4) OR order_no + operation_no + sn_employee + confirmation_number are all present',
    totals: row.totals || {},
    by_machine: row.by_machine || [],
    by_reason: row.by_reason || [],
  };
}

async function buildKpiSourceDetail(type, summary) {
  const windowStart = summary.window_start;
  const windowEnd = summary.window_end;
  if (!windowStart || !windowEnd) return null;

  if (type === 'uptime') return buildUptimeSourceDetail(windowStart, windowEnd);
  if (type === 'accuracy_machine') return buildAccuracyMachineSourceDetail(windowStart, windowEnd);
  if (type === 'uptime_hmi') {
    const k = (summary.kpis || []).find((x) => x.key === 'uptime_hmi');
    const d = k?.detail || {};
    return {
      source_tables: ['public.mch_machine_ping_log'],
      basis:
        "each HMI device's LATEST ping row scored 100 (reachable) / 0 (unreachable), averaged across devices",
      reference_time: d.reference_time || null,
      last_check: d.last_check || null,
      device_count: num(d.device_count),
      devices_up: num(d.devices_up),
      devices_down: num(d.devices_down),
      machines_total: num(d.machines_total),
      machines_down: num(d.machines_down),
      fresh_window_minutes: num(d.fresh_window_minutes),
      by_device: Array.isArray(d.devices) ? d.devices : [],
    };
  }
  if (type === 'accuracy') return buildAccuracySourceDetail(windowStart, windowEnd);
  if (type === 'adoption') return buildAdoptionSourceDetail(windowStart, windowEnd);
  if (type === 'adoption_labour') {
    const k = (summary.kpis || []).find((x) => x.key === 'adoption_labour');
    const d = k?.detail || {};

    return {
      source_tables: ['ews.shift_roster', 'public.timesheet_transaction', 'public.mch_transaction'],
      basis: d.basis || 'roster_progressive',
      recorded_rule: d.recorded_rule || null,
      by_operator: Array.isArray(d.breakdown) ? d.breakdown : [],
      machine_attribution: d.machine_attribution || null,
      started: num(d.started),
      present: num(d.present),
      absent: num(d.absent),
      not_started: num(d.not_started),
      excused: num(d.excused),
      day_adoption_pct: d.day_adoption_pct ?? null,
      night_adoption_pct: d.night_adoption_pct ?? null,
      total_recorded_hours: num(d.total_recorded_hours),
      total_expected_hours: num(d.total_expected_hours),
      total_standard_hours: num(d.total_standard_hours),
    };
  }
  if (type === 'adoption_machine') return buildAdoptionMachineSourceDetail(windowStart, windowEnd);
  if (type === 'oee') return buildOeeSourceDetail(windowStart, windowEnd);
  if (type === 'ole') return buildOleSourceDetail(windowStart, windowEnd);
  return null;
}

async function getKpiDetail(req, res) {
  try {
    const type = String(req.params.type || '').toLowerCase();
    const summary =
      req.query.live === '1'
        ? await ewsCalculator.calculateSystemSummary({
            basis: req.query.basis || 'rolling',
            window: req.query.window,
          })
        : await ewsRealtimeHub.getLatestSnapshotForQuery(req.query);
    const kpi = summary.kpis.find((item) => item.key === type);
    if (!kpi) return res.status(404).json({ error: 'Unknown KPI type' });
    res.json({
      data: kpi,
      meta: {
        window_start: summary.window_start,
        window_end: summary.window_end,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('ews kpi detail error:', err);
    res.status(500).json({ error: err.message });
  }
}

function stream(req, res) {
  ewsRealtimeHub.subscribe(req, res);
}

async function getHealth(req, res) {
  try {
    const health = await ewsRealtimeHub.getHealth(req.query);
    res.status(health.snapshot_available ? 200 : 503).json(health);
  } catch (err) {
    console.error('ews health error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getKpiDetailWithSource(req, res) {
  try {
    const type = String(req.params.type || '').toLowerCase();

    const cacheKey = JSON.stringify({
      type,
      basis: req.query.basis || 'rolling',
      window: req.query.window || '',
      date: req.query.date || '',
      live: req.query.live || '',
    });
    const cached = detailCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < DETAIL_TTL_MS) {
      res.set('X-Cache', 'HIT');
      res.json(cached.payload);
      return;
    }

    const isManualDate = req.query.basis === 'date' && req.query.date;

    const summary =
      req.query.live === '1' || isManualDate
        ? await ewsCalculator.calculateSystemSummary({
            basis: req.query.basis || 'rolling',
            window: req.query.window,
            date: req.query.date,
          })
        : await ewsRealtimeHub.getLatestSnapshotForQuery(req.query, { includeKpiDetail: true });

    const kpi = summary.kpis.find((item) => item.key === type);
    if (!kpi) return res.status(404).json({ error: 'Unknown KPI type' });

    const sourceDetail = await buildKpiSourceDetail(type, summary);
    const payload = {
      data: {
        ...kpi,
        source_detail: sourceDetail,
      },
      meta: {
        window_start: summary.window_start,
        window_end: summary.window_end,
        generated_at: new Date().toISOString(),
      },
    };
    detailCache.set(cacheKey, { createdAt: Date.now(), payload });
    res.set('X-Cache', 'MISS');
    res.json(payload);
  } catch (err) {
    console.error('ews kpi detail error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getTtsNotifications(req, res) {
  try {
    const includePlayed = req.query.include_played === '1';
    const limit = clampLimit(req.query.limit, 20);
    const result = await db.query(
      `
      SELECT id, issue_key, kpi_type, severity, title, message, path_mp3,
             generation_status, played, created_at, generated_at
      FROM ews.tts_notification
      WHERE generation_status = 'ready'
        AND path_mp3 IS NOT NULL
        ${includePlayed ? '' : 'AND played = false'}
      ORDER BY generated_at DESC
      LIMIT $1
      `,
      [limit]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('ews tts list error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function markTtsNotificationPlayed(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    await db.query(
      `UPDATE ews.tts_notification SET played = true, updated_at = now() WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('ews tts mark played error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getTtsPlaylist(req, res) {
  try {
    const limit = clampLimit(req.query.limit, 100);
    const result = await db.query(
      `
      SELECT id, issue_key, kpi_type, severity, title, message, path_mp3,
             generation_status, played, created_at, generated_at
      FROM ews.tts_notification
      WHERE generation_status = 'ready'
        AND path_mp3 IS NOT NULL
        AND lower(severity) = 'critical'
        AND created_at >= date_trunc('day', now() - make_interval(hours => $1::int))
      ORDER BY generated_at ASC
      LIMIT $2
      `,
      [EWS_DAY_START_HOUR, limit]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('ews tts playlist error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getIssueLog(req, res) {
  const category = String(req.query.category || '').toLowerCase();
  const status = String(req.query.status || 'open').toLowerCase();
  const businessDate = String(req.query.business_date || '').trim();
  try {
    const params = [];
    const filters = ['1=1'];
    if (category) {
      params.push(category);
      filters.push(`category = $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(status);
      filters.push(`status = $${params.length}`);
    }
    if (businessDate === 'today' || businessDate === 'current') {
      params.push(EWS_DAY_START_HOUR);
      filters.push(
        `business_date = date_trunc('day', now() - make_interval(hours => $${params.length}::int))::date`
      );
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      params.push(businessDate);
      filters.push(`business_date = $${params.length}::date`);
    }
    const result = await db.query(
      `
      SELECT id, issue_key, category, business_date, scope_type, entity_id, entity_name,
             severity, title, description, metric_value, detail, status,
             created_at, updated_at, resolved_at, resolved_by, resolution_note
      FROM ews.issue_log
      WHERE ${filters.join(' AND ')}
      ORDER BY (status = 'open') DESC, (severity = 'critical') DESC, business_date DESC, created_at DESC
      LIMIT 300
      `,
      params
    );
    res.json({ data: result.rows, meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    if (err.code === '42P01') {
      res.json({ data: [], meta: { warning: 'ews.issue_log not created' } });
      return;
    }
    console.error('ews issue-log error:', err);
    res.status(500).json({ error: err.message });
  }
}

const RESOLUTION_NOTE_MIN = 5;
const RESOLUTION_NOTE_MAX = 1000;

async function resolveIssueLog(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid issue id' });
    return;
  }

  const note = String(req.body?.resolution_note ?? req.body?.note ?? '').trim();
  if (note.length < RESOLUTION_NOTE_MIN) {
    res.status(400).json({
      error: `A justification / corrective action of at least ${RESOLUTION_NOTE_MIN} characters is required.`,
    });
    return;
  }
  if (note.length > RESOLUTION_NOTE_MAX) {
    res
      .status(400)
      .json({ error: `Justification is too long (max ${RESOLUTION_NOTE_MAX} characters).` });
    return;
  }
  const resolvedBy =
    String(req.body?.resolved_by ?? req.headers['x-user-id'] ?? 'unknown')
      .trim()
      .slice(0, 120) || 'unknown';

  try {
    const result = await db.query(
      `
      UPDATE ews.issue_log
      SET status          = 'resolved',
          resolution_note = $2,
          resolved_by     = $3,
          resolved_at     = now(),
          updated_at      = now()
      WHERE id = $1
        AND status = 'open'
      RETURNING *
      `,
      [id, note, resolvedBy]
    );
    if (!result.rows.length) {
      const existing = await db.query('SELECT status FROM ews.issue_log WHERE id = $1', [id]);
      if (!existing.rows.length) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      res.status(409).json({ error: 'Issue is already resolved' });
      return;
    }
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('ews issue-log resolve error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getIssueRecords(req, res) {
  try {
    const result = await ewsIssueDrill.getIssueRecords(getPool(), req.params.issueKey, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.notFound) return res.status(404).json({ error: 'issue tidak ditemukan' });
    res.json(result);
  } catch (err) {
    console.error('ews issue drill error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function generateIssueLog(_req, res) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await ewsIssueGenerator.generateAll(client);
    await client.query('COMMIT');
    res.json({ data: result, meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ews issue-log generate error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  getSummary,
  getTrend,
  getIssueLog,
  resolveIssueLog,
  generateIssueLog,
  getIssueRecords,
  getKpiDetail: getKpiDetailWithSource,
  stream,
  getHealth,
  getTtsNotifications,
  markTtsNotificationPlayed,
  getTtsPlaylist,
};
