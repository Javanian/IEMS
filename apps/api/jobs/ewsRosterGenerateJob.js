const { Pool, types } = require('pg');
require('../config/loadEnv');
const { resolveTimezone } = require('../config/timezone');

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const FORWARD_DAYS = Number.parseInt(process.env.EWS_ROSTER_FORWARD_DAYS || '14', 10);
const INTERVAL_MS = Number.parseInt(
  process.env.EWS_ROSTER_JOB_INTERVAL_MS || String(24 * 60 * 60 * 1000),
  10
);
const RUN_ONCE = process.env.EWS_ROSTER_JOB_RUN_ONCE === '1';
const TZ = resolveTimezone();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number.parseInt(process.env.EWS_ROSTER_JOB_DB_POOL_MAX || '2', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'mps2-ews-roster-job',
  options: `-c timezone=${TZ}`,
});

global.pool = pool;
const { generateRoster } = require('../services/rosterGenerator');

async function runOnce(reason = 'manual') {
  const started = Date.now();
  const bounds = await pool.query(
    `SELECT (now() AT TIME ZONE $1)::date AS from_date,
            ((now() AT TIME ZONE $1)::date + $2::int) AS to_date`,
    [TZ, FORWARD_DAYS]
  );
  const { from_date, to_date } = bounds.rows[0];
  const inserted = await generateRoster(from_date, to_date);
  console.log('[EWS roster job] generated', {
    reason,
    from_date,
    to_date,
    rows_inserted: inserted,
    duration_ms: Date.now() - started,
  });
}

async function main() {
  await runOnce('startup');
  if (RUN_ONCE) {
    await pool.end();
    return;
  }
  setInterval(
    () =>
      runOnce('interval').catch((err) =>
        console.error('[EWS roster job] run failed:', err.message)
      ),
    INTERVAL_MS
  );
  console.log('[EWS roster job] scheduled', {
    interval_ms: INTERVAL_MS,
    forward_days: FORWARD_DAYS,
  });
}

async function shutdown(signal) {
  console.log(`[EWS roster job] ${signal} received, shutting down`);
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (err) => {
  console.error('[EWS roster job] fatal error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
