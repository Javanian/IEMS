const { Pool, types } = require('pg');
require('../config/loadEnv');
const { resolveTimezone } = require('../config/timezone');

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const SOURCE_CHANNEL = 'ews_source_changed';
const DEFAULT_TARGETS = 'today';
const DEBOUNCE_MS = Number.parseInt(process.env.EWS_JOB_DEBOUNCE_MS || '2500', 10);
const INTERVAL_MS = Number.parseInt(process.env.EWS_JOB_INTERVAL_MS || '60000', 10);
const RUN_ONCE = process.env.EWS_JOB_RUN_ONCE === '1';
const ADVISORY_LOCK_KEY = Number.parseInt(process.env.EWS_JOB_ADVISORY_LOCK_KEY || '27112026', 10);
const PROGRESS_LOG_MS = Number.parseInt(process.env.EWS_JOB_PROGRESS_LOG_MS || '15000', 10);
const QUERY_TIMEOUT_MS = Number.parseInt(
  process.env.EWS_JOB_QUERY_TIMEOUT_MS || process.env.DB_QUERY_TIMEOUT_MS || '120000',
  10
);
const STATEMENT_TIMEOUT_MS = Number.parseInt(
  process.env.EWS_JOB_STATEMENT_TIMEOUT_MS || process.env.DB_STATEMENT_TIMEOUT_MS || '120000',
  10
);
const requestedPoolMax = Number.parseInt(process.env.EWS_JOB_DB_POOL_MAX || '4', 10);
const POOL_MAX = Math.max(4, Number.isFinite(requestedPoolMax) ? requestedPoolMax : 4);

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
  application_name: process.env.EWS_JOB_APPLICATION_NAME || 'mps2-ews-snapshot-job',
  options: [
    `-c timezone=${resolveTimezone()}`,
    `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  ].join(' '),
});

global.pool = pool;

const ewsCalculator = require('../services/ewsCalculator');
const ewsIssueGenerator = require('../services/ewsIssueGenerator');

let listenClient = null;
let debounceTimer = null;
let intervalTimer = null;
let running = false;
let runAgain = false;

function parseTargets() {
  return (process.env.EWS_SNAPSHOT_TARGETS || DEFAULT_TARGETS)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);
}

function targetToOptions(target) {
  if (target === 'today') return { basis: 'today' };
  return { basis: 'rolling', window: target };
}

function scheduleRun(reason = 'source_change', source = null) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    runSnapshots(reason, source).catch((err) => {
      console.error('[EWS job] snapshot run failed:', err);
    });
  }, DEBOUNCE_MS);
}

async function runSnapshots(reason = 'manual', source = null) {
  if (running) {
    runAgain = true;
    return;
  }

  running = true;
  let lockClient = null;
  let lockAcquired = false;
  let skipped = false;
  let succeeded = false;
  const startedAt = Date.now();
  const targets = parseTargets();
  let progressTimer = null;

  try {
    console.log('[EWS job] run started', {
      reason,
      targets,
      pool_max: POOL_MAX,
      query_timeout_ms: QUERY_TIMEOUT_MS,
      statement_timeout_ms: STATEMENT_TIMEOUT_MS,
    });

    progressTimer = setInterval(() => {
      console.log('[EWS job] still running', {
        reason,
        targets,
        elapsed_ms: Date.now() - startedAt,
      });
    }, PROGRESS_LOG_MS);

    lockClient = await pool.connect();
    const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [
      ADVISORY_LOCK_KEY,
    ]);
    lockAcquired = Boolean(lockResult.rows[0]?.locked);

    if (!lockAcquired) {
      skipped = true;
      console.log('[EWS job] snapshot run skipped, another job holds advisory lock', {
        lock_key: ADVISORY_LOCK_KEY,
        reason,
        source,
      });
      return;
    }

    for (const target of targets) {
      const targetStartedAt = Date.now();
      console.log('[EWS job] target started', { target, reason });
      const summary = await ewsCalculator.calculateSystemSummary(targetToOptions(target));
      console.log('[EWS job] snapshot updated', {
        target,
        status: summary.overall_status,
        window_end: summary.window_end,
        reason,
        source,
        duration_ms: Date.now() - targetStartedAt,
      });
    }

    try {
      const genClient = await pool.connect();
      try {
        await genClient.query('BEGIN');
        const gen = await ewsIssueGenerator.generateAll(genClient);
        await genClient.query('COMMIT');
        console.log('[EWS job] issue log generated', gen);
      } catch (genErr) {
        await genClient.query('ROLLBACK').catch(() => {});
        throw genErr;
      } finally {
        genClient.release();
      }
    } catch (genErr) {
      console.error('[EWS job] issue log generation failed:', genErr.message);
    }

    succeeded = true;
  } finally {
    clearInterval(progressTimer);
    if (lockClient) {
      if (lockAcquired) {
        await lockClient
          .query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
          .catch((err) => {
            console.error('[EWS job] failed to release advisory lock:', err.message);
          });
      }
      lockClient.release();
    }
    running = false;
    console.log('[EWS job] run finished', {
      targets,
      succeeded,
      skipped,
      duration_ms: Date.now() - startedAt,
    });
    if (runAgain) {
      runAgain = false;
      scheduleRun('queued_change');
    }
  }
}

async function connectListener() {
  listenClient = await pool.connect();
  listenClient.on('notification', (message) => {
    let payload = null;
    try {
      payload = message.payload ? JSON.parse(message.payload) : null;
    } catch (_err) {
      payload = { raw: message.payload };
    }
    scheduleRun('database_notify', payload);
  });
  listenClient.on('error', (err) => {
    console.error('[EWS job] LISTEN connection error:', err.message);
    reconnectListener();
  });
  await listenClient.query(`LISTEN ${SOURCE_CHANNEL}`);
  console.log(`[EWS job] listening on ${SOURCE_CHANNEL}`);
}

function reconnectListener() {
  if (listenClient) {
    const client = listenClient;
    listenClient = null;
    client.removeAllListeners();
    try {
      client.release(true);
    } catch (_err) {}
  }
  setTimeout(() => {
    connectListener().catch((err) => {
      console.error('[EWS job] reconnect failed:', err.message);
      reconnectListener();
    });
  }, 5000);
}

async function main() {
  if (requestedPoolMax < 4) {
    console.warn(
      '[EWS job] EWS_JOB_DB_POOL_MAX is too low for LISTEN + advisory lock + calculation; using',
      POOL_MAX
    );
  }
  const client = await pool.connect();
  client.release();
  await connectListener();
  if (RUN_ONCE) {
    await runSnapshots('run_once');
    if (listenClient) listenClient.release(true);
    await pool.end();
    return;
  }
  scheduleRun('startup');
  if (INTERVAL_MS > 0) {
    intervalTimer = setInterval(() => scheduleRun('interval'), INTERVAL_MS);
    console.log('[EWS job] interval safety refresh enabled', { interval_ms: INTERVAL_MS });
  }
}

async function shutdown(signal) {
  console.log(`[EWS job] ${signal} received, shutting down`);
  clearTimeout(debounceTimer);
  clearInterval(intervalTimer);
  if (listenClient) listenClient.release(true);
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (err) => {
  console.error('[EWS job] fatal error:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
