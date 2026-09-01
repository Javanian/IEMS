const { Pool, types } = require('pg');
require('../config/loadEnv');
const { resolveTimezone } = require('../config/timezone');

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const INTERVAL_MS = Number.parseInt(process.env.EWS_ADOPTION_JOB_INTERVAL_MS || '600000', 10);
const RUN_ONCE = process.env.EWS_ADOPTION_JOB_RUN_ONCE === '1';
const DEBOUNCE_MS = Number.parseInt(process.env.EWS_ADOPTION_JOB_DEBOUNCE_MS || '5000', 10);
const PROGRESS_LOG_MS = Number.parseInt(
  process.env.EWS_ADOPTION_JOB_PROGRESS_LOG_MS || '15000',
  10
);
const QUERY_TIMEOUT_MS = Number.parseInt(
  process.env.EWS_ADOPTION_JOB_QUERY_TIMEOUT_MS || '300000',
  10
);
const STATEMENT_TIMEOUT_MS = Number.parseInt(
  process.env.EWS_ADOPTION_JOB_STATEMENT_TIMEOUT_MS || '300000',
  10
);
const ADVISORY_LOCK_KEY = Number.parseInt(
  process.env.EWS_ADOPTION_JOB_ADVISORY_LOCK_KEY || '27112027',
  10
);
const requestedPoolMax = Number.parseInt(process.env.EWS_ADOPTION_JOB_DB_POOL_MAX || '3', 10);
const POOL_MAX = Math.max(3, Number.isFinite(requestedPoolMax) ? requestedPoolMax : 3);
const ADOPTION_SOURCE =
  String(process.env.EWS_ADOPTION_SOURCE || 'machine').toLowerCase() === 'all' ? 'all' : 'machine';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: POOL_MAX,
  idleTimeoutMillis: Number.parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  query_timeout: QUERY_TIMEOUT_MS,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  application_name: process.env.EWS_ADOPTION_JOB_APPLICATION_NAME || 'mps2-ews-adoption-bucket-job',
  options: [
    `-c timezone=${resolveTimezone()}`,
    `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  ].join(' '),
});

let debounceTimer = null;
let intervalTimer = null;
let running = false;
let runAgain = false;

function scheduleRun(reason = 'interval') {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    runAdoption(reason).catch((err) => {
      console.error('[EWS adoption job] run failed:', err);
    });
  }, DEBOUNCE_MS);
}

async function getTodayBounds(client) {
  const tz = resolveTimezone();
  const dayStartHour = Number(process.env.EWS_DAY_START_HOUR || 7);
  const result = await client.query(
    `
    WITH biz AS (
      SELECT date_trunc('day', (now() AT TIME ZONE $1) - make_interval(hours => $2::int)) AT TIME ZONE $1 AS day_start
    )
    SELECT
      day_start AS window_start,
      LEAST(now(), day_start + interval '1 day') AS window_end
    FROM biz
  `,
    [tz, dayStartHour]
  );
  return result.rows[0];
}

async function hasColumn(client, schema, table, column) {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
    ) AS exists
    `,
    [schema, table, column]
  );
  return Boolean(result.rows[0]?.exists);
}

async function ensureAdoptionSourceColumn(client) {
  if (await hasColumn(client, 'ews', 'adoption_summary_snapshot', 'adoption_source')) return;
  await client.query(`
    ALTER TABLE ews.adoption_summary_snapshot
      ADD COLUMN IF NOT EXISTS adoption_source text NOT NULL DEFAULT 'all'
  `);
  await client.query(`
    ALTER TABLE ews.adoption_summary_snapshot
      DROP CONSTRAINT IF EXISTS adoption_summary_snapshot_window_start_window_end_grain_key
  `);
  await client.query(`
    ALTER TABLE ews.adoption_summary_snapshot
      ADD CONSTRAINT adoption_summary_snapshot_window_grain_source_key
      UNIQUE (window_start, window_end, grain, adoption_source)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ews_adoption_summary_source_latest
      ON ews.adoption_summary_snapshot (grain, adoption_source, window_end DESC, calculated_at DESC)
  `);
}

async function upsertBuckets(client, bounds) {
  const result = await client.query(
    `
    WITH bounds AS (
      SELECT $1::timestamptz AS window_start, $2::timestamptz AS window_end
    ),
    machine_source AS (
      SELECT
        date_trunc('minute', mt.startdatetime)
          - (EXTRACT(minute FROM mt.startdatetime)::int % 5) * interval '1 minute' AS bucket_start,
        COALESCE(NULLIF(BTRIM(mt.machineid), ''), NULLIF(BTRIM(mt.workcentercode), ''), 'UNKNOWN') AS machine_key,
        COALESCE(NULLIF(BTRIM(mt.sn_employee), ''), '') AS operator_key,
        MAX(NULLIF(BTRIM(mt.full_name), '')) AS operator_name,
        BOOL_OR(mt.statusid = 5 OR LOWER(COALESCE(mt.status_description, '')) = 'unidentified') AS has_unidentified,
        COUNT(*)::int AS machine_event_count
      FROM public.mch_transaction mt
      CROSS JOIN bounds b
      WHERE mt.startdatetime >= b.window_start
        AND mt.startdatetime < b.window_end
        AND COALESCE(mt.duration_hours, 0) > 0
        AND COALESCE(mt.statusid, 0) <> 4
        AND LOWER(COALESCE(mt.status_description, '')) NOT IN ('no job', 'off')
      GROUP BY 1, 2, 3
    ),
    classified AS (
      SELECT
        ms.bucket_start,
        ms.bucket_start + interval '5 minutes' AS bucket_end,
        ms.machine_key,
        ms.operator_key,
        ms.operator_name,
        ms.has_unidentified,
        EXISTS (
          SELECT 1
          FROM public.timesheet_transaction t
          WHERE t.longdate_checkin < ms.bucket_start + interval '5 minutes'
            AND COALESCE(t.longdate_checkout, t.longdate_checkin) > ms.bucket_start
            AND COALESCE(t.state_flag, 1) <> 5
            AND COALESCE(t.duration, 0) > 0
            AND (
              (ms.operator_key <> '' AND NULLIF(BTRIM(t.serialnumber), '') = ms.operator_key)
              OR (NULLIF(BTRIM(t.workcentercode), '') = ms.machine_key)
            )
        ) AS has_timesheet_match,
        ms.machine_event_count
      FROM machine_source ms
    ),
    upserted AS (
      INSERT INTO ews.adoption_bucket_snapshot (
        bucket_start,
        bucket_end,
        machine_key,
        operator_key,
        operator_name,
        has_unidentified,
        has_timesheet_match,
        machine_event_count,
        gap_type,
        calculated_at
      )
      SELECT
        bucket_start,
        bucket_end,
        machine_key,
        operator_key,
        operator_name,
        has_unidentified,
        has_timesheet_match,
        machine_event_count,
        CASE
          WHEN has_unidentified THEN 'unidentified'
          WHEN NOT has_timesheet_match THEN 'missing_timesheet'
          ELSE NULL
        END AS gap_type,
        now()
      FROM classified
      ON CONFLICT (bucket_start, machine_key, operator_key)
      DO UPDATE SET
        bucket_end = EXCLUDED.bucket_end,
        operator_name = EXCLUDED.operator_name,
        has_unidentified = EXCLUDED.has_unidentified,
        has_timesheet_match = EXCLUDED.has_timesheet_match,
        machine_event_count = EXCLUDED.machine_event_count,
        gap_type = EXCLUDED.gap_type,
        calculated_at = now()
      RETURNING 1
    )
    SELECT COUNT(*)::int AS upserted_count FROM upserted
    `,
    [bounds.window_start, bounds.window_end]
  );
  return result.rows[0]?.upserted_count || 0;
}

async function upsertSummary(client, bounds) {
  const result = await client.query(
    `
    WITH base AS (
      SELECT *
      FROM ews.adoption_bucket_snapshot
      WHERE bucket_start >= $1
        AND bucket_start < $2
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS expected_bucket_count,
        COUNT(*) FILTER (WHERE has_timesheet_match AND NOT has_unidentified)::int AS covered_bucket_count,
        COUNT(*) FILTER (WHERE NOT has_timesheet_match AND NOT has_unidentified)::int AS missing_bucket_count,
        COUNT(*) FILTER (WHERE has_unidentified)::int AS unidentified_bucket_count,
        COUNT(DISTINCT machine_key)::int AS machine_count,
        COUNT(DISTINCT NULLIF(operator_key, '')) FILTER (WHERE NULLIF(operator_key, '') IS NOT NULL)::int AS operator_count
      FROM base
    ),
    sample_gaps AS (
      SELECT COALESCE(jsonb_agg(row_to_json(gap_row)), '[]'::jsonb) AS gaps
      FROM (
        SELECT
          to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_start,
          to_char(bucket_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_end,
          machine_key,
          NULLIF(operator_key, '') AS operator_key,
          operator_name,
          gap_type,
          machine_event_count
        FROM base
        WHERE gap_type IS NOT NULL
        ORDER BY bucket_start DESC, machine_key, operator_key NULLS LAST
        LIMIT 12
      ) gap_row
    ),
    payload AS (
      SELECT
        s.*,
        CASE
          WHEN s.expected_bucket_count > 0
            THEN ROUND((s.covered_bucket_count::numeric / s.expected_bucket_count::numeric) * 100, 4)
          ELSE NULL
        END AS adoption_pct,
        jsonb_build_object(
          'bucket_minutes', 5,
          'missing_time_buckets', sg.gaps,
          'source', 'ews.adoption_bucket_snapshot'
        ) AS detail_json
      FROM summary s CROSS JOIN sample_gaps sg
    )
    INSERT INTO ews.adoption_summary_snapshot (
      window_start,
      window_end,
      grain,
      adoption_source,
      expected_bucket_count,
      covered_bucket_count,
      missing_bucket_count,
      unidentified_bucket_count,
      machine_count,
      operator_count,
      adoption_pct,
      detail_json,
      calculated_at
    )
    SELECT
      $1,
      $2,
      'today',
      'all',
      expected_bucket_count,
      covered_bucket_count,
      missing_bucket_count,
      unidentified_bucket_count,
      machine_count,
      operator_count,
      adoption_pct,
      detail_json,
      now()
    FROM payload
    ON CONFLICT (window_start, window_end, grain, adoption_source)
    DO UPDATE SET
      expected_bucket_count = EXCLUDED.expected_bucket_count,
      covered_bucket_count = EXCLUDED.covered_bucket_count,
      missing_bucket_count = EXCLUDED.missing_bucket_count,
      unidentified_bucket_count = EXCLUDED.unidentified_bucket_count,
      machine_count = EXCLUDED.machine_count,
      operator_count = EXCLUDED.operator_count,
      adoption_pct = EXCLUDED.adoption_pct,
      detail_json = EXCLUDED.detail_json,
      calculated_at = now()
    RETURNING *
    `,
    [bounds.window_start, bounds.window_end]
  );
  return result.rows[0];
}

async function upsertMachineSummary(client, bounds) {
  const result = await client.query(
    `
    WITH base AS (
      SELECT
        COALESCE(NULLIF(BTRIM(pd.machineno::text), ''), 'UNKNOWN') AS machine_key,
        pd.statusid,
        GREATEST(EXTRACT(EPOCH FROM (pd.enddatetime - pd.startdatetime)), 0)::numeric AS duration_seconds,
        (
          pd.statusid = 5
          OR (
            pd.statusid = 2
            AND GREATEST(EXTRACT(EPOCH FROM (pd.enddatetime - pd.startdatetime)), 0) > 300
          )
        ) AS is_adoption_gap
      FROM public.mch_productiondata pd
      WHERE pd.startdatetime >= $1
        AND pd.startdatetime < $2
        AND pd.enddatetime IS NOT NULL
        AND pd.enddatetime > pd.startdatetime
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS expected_bucket_count,
        COUNT(*) FILTER (WHERE NOT is_adoption_gap)::int AS covered_bucket_count,
        0::int AS missing_bucket_count,
        COUNT(*) FILTER (WHERE statusid = 5)::int AS unidentified_bucket_count,
        COUNT(*) FILTER (WHERE statusid = 2 AND duration_seconds > 300)::int AS long_status_2_count,
        COUNT(DISTINCT machine_key)::int AS machine_count,
        0::int AS operator_count,
        COALESCE(SUM(duration_seconds), 0)::numeric AS total_duration_seconds,
        COALESCE(SUM(duration_seconds) FILTER (WHERE statusid = 5), 0)::numeric AS unidentified_duration_seconds,
        COALESCE(SUM(duration_seconds) FILTER (WHERE statusid = 2 AND duration_seconds > 300), 0)::numeric AS long_status_2_duration_seconds,
        COALESCE(SUM(duration_seconds) FILTER (WHERE is_adoption_gap), 0)::numeric AS gap_duration_seconds
      FROM base
    ),
    by_machine AS (
      -- Per-machine gap breakdown, consumed by the adoption_machine issue generator so it
      -- never recomputes anything. Only machines WITH a gap are kept. Same duration rule
      -- as the summary above (statusid 5, or statusid 2 idle > 5 min).
      SELECT COALESCE(
        jsonb_agg(m ORDER BY (m->>'gap_minutes')::numeric DESC),
        '[]'::jsonb
      ) AS machines
      FROM (
        SELECT jsonb_build_object(
          'machine_key', b.machine_key,
          'machine_name', MAX(mm.machinename),
          'run_minutes', ROUND(SUM(b.duration_seconds) / 60.0, 1),
          'gap_minutes', ROUND(SUM(b.duration_seconds) FILTER (WHERE b.is_adoption_gap) / 60.0, 1),
          'unidentified_minutes', ROUND(SUM(b.duration_seconds) FILTER (WHERE b.statusid = 5) / 60.0, 1),
          'cover_pct', CASE
            WHEN SUM(b.duration_seconds) > 0
              THEN ROUND((SUM(b.duration_seconds) - SUM(b.duration_seconds) FILTER (WHERE b.is_adoption_gap))
                         / SUM(b.duration_seconds) * 100, 1)
            ELSE NULL
          END
        ) AS m
        FROM base b
        LEFT JOIN public.mch_machines mm ON mm.machineno::text = b.machine_key
        GROUP BY b.machine_key
        HAVING SUM(b.duration_seconds) FILTER (WHERE b.is_adoption_gap) > 0
      ) x
    ),
    payload AS (
      SELECT
        s.*,
        CASE
          WHEN s.total_duration_seconds > 0
            THEN ROUND(((s.total_duration_seconds - s.gap_duration_seconds) / s.total_duration_seconds) * 100, 4)
          ELSE NULL
        END AS adoption_pct,
        CASE
          WHEN s.total_duration_seconds > 0
            THEN ROUND((s.gap_duration_seconds / s.total_duration_seconds) * 100, 4)
          ELSE NULL
        END AS gap_pct,
        jsonb_build_object(
          'source', 'public.mch_productiondata',
          'per_machine', bm.machines,
          'adoption_source', 'machine',
          'duration_rule', 'duration_seconds = enddatetime - startdatetime',
          'denominator', 'SUM(duration_seconds) for rows in window with enddatetime > startdatetime',
          'gap_numerator', 'SUM(duration_seconds) where statusid = 5 or statusid = 2 duration > 5 minutes',
          'kpi_numerator', 'total_duration_seconds - gap_duration_seconds',
          'total_duration_seconds', s.total_duration_seconds,
          'unidentified_duration_seconds', s.unidentified_duration_seconds,
          'long_status_2_duration_seconds', s.long_status_2_duration_seconds,
          'gap_duration_seconds', s.gap_duration_seconds,
          'long_status_2_count', s.long_status_2_count,
          'unidentified_pct',
            CASE
              WHEN s.total_duration_seconds > 0
                THEN ROUND((s.unidentified_duration_seconds / s.total_duration_seconds) * 100, 4)
              ELSE NULL
            END,
          'long_status_2_pct',
            CASE
              WHEN s.total_duration_seconds > 0
                THEN ROUND((s.long_status_2_duration_seconds / s.total_duration_seconds) * 100, 4)
              ELSE NULL
            END,
          'gap_pct',
            CASE
              WHEN s.total_duration_seconds > 0
                THEN ROUND((s.gap_duration_seconds / s.total_duration_seconds) * 100, 4)
              ELSE NULL
            END,
          'helper',
            CONCAT(
              ROUND(s.gap_duration_seconds / 3600.0, 2),
              'h adoption gap / ',
              ROUND(s.total_duration_seconds / 3600.0, 2),
              'h machine duration'
            )
        ) AS detail_json
      FROM summary s CROSS JOIN by_machine bm
    )
    INSERT INTO ews.adoption_summary_snapshot (
      window_start,
      window_end,
      grain,
      adoption_source,
      expected_bucket_count,
      covered_bucket_count,
      missing_bucket_count,
      unidentified_bucket_count,
      machine_count,
      operator_count,
      adoption_pct,
      detail_json,
      calculated_at
    )
    SELECT
      $1,
      $2,
      'today',
      'machine',
      expected_bucket_count,
      covered_bucket_count,
      missing_bucket_count,
      unidentified_bucket_count,
      machine_count,
      operator_count,
      adoption_pct,
      detail_json,
      now()
    FROM payload
    ON CONFLICT (window_start, window_end, grain, adoption_source)
    DO UPDATE SET
      expected_bucket_count = EXCLUDED.expected_bucket_count,
      covered_bucket_count = EXCLUDED.covered_bucket_count,
      missing_bucket_count = EXCLUDED.missing_bucket_count,
      unidentified_bucket_count = EXCLUDED.unidentified_bucket_count,
      machine_count = EXCLUDED.machine_count,
      operator_count = EXCLUDED.operator_count,
      adoption_pct = EXCLUDED.adoption_pct,
      detail_json = EXCLUDED.detail_json,
      calculated_at = now()
    RETURNING *
    `,
    [bounds.window_start, bounds.window_end]
  );
  return result.rows[0];
}

async function runAdoption(reason = 'manual') {
  if (running) {
    runAgain = true;
    return;
  }

  running = true;
  let client = null;
  let progressTimer = null;
  let lockAcquired = false;
  const startedAt = Date.now();

  try {
    console.log('[EWS adoption job] run started', {
      reason,
      adoption_source: ADOPTION_SOURCE,
      interval_ms: INTERVAL_MS,
      pool_max: POOL_MAX,
      query_timeout_ms: QUERY_TIMEOUT_MS,
      statement_timeout_ms: STATEMENT_TIMEOUT_MS,
    });

    progressTimer = setInterval(() => {
      console.log('[EWS adoption job] still running', {
        reason,
        elapsed_ms: Date.now() - startedAt,
      });
    }, PROGRESS_LOG_MS);

    client = await pool.connect();
    const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
      ADVISORY_LOCK_KEY,
    ]);
    lockAcquired = Boolean(lockResult.rows[0]?.locked);

    if (!lockAcquired) {
      console.log('[EWS adoption job] skipped, another job holds advisory lock', {
        lock_key: ADVISORY_LOCK_KEY,
        reason,
      });
      return;
    }

    const bounds = await getTodayBounds(client);
    await ensureAdoptionSourceColumn(client);
    const upsertedCount = ADOPTION_SOURCE === 'all' ? await upsertBuckets(client, bounds) : 0;
    const summary =
      ADOPTION_SOURCE === 'all'
        ? await upsertSummary(client, bounds)
        : await upsertMachineSummary(client, bounds);

    console.log('[EWS adoption job] summary updated', {
      reason,
      adoption_source: ADOPTION_SOURCE,
      upserted_count: upsertedCount,
      adoption_pct: summary?.adoption_pct,
      expected_bucket_count: summary?.expected_bucket_count,
      covered_bucket_count: summary?.covered_bucket_count,
      window_end: summary?.window_end,
      duration_ms: Date.now() - startedAt,
    });
  } finally {
    clearInterval(progressTimer);
    if (client) {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
          console.error('[EWS adoption job] failed to release advisory lock:', err.message);
        });
      }
      client.release();
    }
    running = false;
    console.log('[EWS adoption job] run finished', {
      reason,
      duration_ms: Date.now() - startedAt,
    });
    if (runAgain) {
      runAgain = false;
      scheduleRun('queued_change');
    }
  }
}

async function main() {
  if (requestedPoolMax < 3) {
    console.warn('[EWS adoption job] EWS_ADOPTION_JOB_DB_POOL_MAX is too low; using', POOL_MAX);
  }
  const client = await pool.connect();
  client.release();
  if (RUN_ONCE) {
    await runAdoption('run_once');
    await pool.end();
    return;
  }
  scheduleRun('startup');
  if (INTERVAL_MS > 0) {
    intervalTimer = setInterval(() => scheduleRun('interval'), INTERVAL_MS);
    console.log('[EWS adoption job] interval enabled', { interval_ms: INTERVAL_MS });
  }
}

async function shutdown(signal) {
  console.log(`[EWS adoption job] ${signal} received, shutting down`);
  clearTimeout(debounceTimer);
  clearInterval(intervalTimer);
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (err) => {
  console.error('[EWS adoption job] fatal error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
