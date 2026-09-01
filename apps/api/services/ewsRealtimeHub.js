const SNAPSHOT_CHANNEL = 'ews_snapshot_ready';
const HEARTBEAT_MS = Number.parseInt(process.env.EWS_SSE_HEARTBEAT_MS || '25000', 10);
const DEBOUNCE_MS = Number.parseInt(process.env.EWS_REFRESH_DEBOUNCE_MS || '1500', 10);
const SNAPSHOT_POLL_MS = Number.parseInt(process.env.EWS_SSE_SNAPSHOT_POLL_MS || '15000', 10);
const MAX_CLIENTS = Number.parseInt(process.env.EWS_SSE_MAX_CLIENTS || '1500', 10);
const JOB_INTERVAL_MS = Number.parseInt(process.env.EWS_JOB_INTERVAL_MS || '60000', 10);
const FRESHNESS_THRESHOLD_MS = Number.parseInt(
  process.env.EWS_SNAPSHOT_STALE_MS || String(Math.max(JOB_INTERVAL_MS * 2, 1)),
  10
);

const KPI_FALLBACK = {
  uptime: { label: 'Uptime', target: 99, owner: 'IT', column: 'uptime_pct' },
  accuracy: { label: 'Accuracy', target: 97, owner: 'Foreman', column: 'accuracy_pct' },
  adoption: { label: 'Adoption', target: 95, owner: 'Spv', column: 'adoption_pct' },
  oee: { label: 'OEE', target: 80, owner: 'PPIC', column: 'oee_pct' },
  ole: { label: 'OLE', target: 85, owner: 'Spv', column: 'ole_pct' },
};

let poolRef = null;
let listenPoolRef = null;
let listenClient = null;
let listenerConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let snapshotPollTimer = null;
let nextClientId = 1;

const clients = new Map();
const cacheByKey = new Map();
const timersByKey = new Map();
const inFlightByKey = new Map();

function streamKeyFromQuery(query = {}) {
  return JSON.stringify({
    basis: query.basis || 'rolling',
    window: query.window || '',
  });
}

function compactKpi(kpi) {
  return {
    key: kpi.key,
    label: kpi.label,
    value: kpi.value,
    target: kpi.target,
    owner: kpi.owner,
    status: kpi.status,
    helper: kpi.helper,
    comparison: kpi.comparison || null,
  };
}

function calculateFreshness(calculatedAt) {
  if (!calculatedAt) {
    return {
      snapshot_age_seconds: null,
      freshness_status: 'NO_SNAPSHOT',
    };
  }

  const calculatedMs = new Date(calculatedAt).getTime();
  if (!Number.isFinite(calculatedMs)) {
    return {
      snapshot_age_seconds: null,
      freshness_status: 'NO_SNAPSHOT',
    };
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - calculatedMs) / 1000));
  return {
    snapshot_age_seconds: ageSeconds,
    freshness_status: ageSeconds * 1000 > FRESHNESS_THRESHOLD_MS ? 'STALE' : 'FRESH',
  };
}

function compactSummary(summary) {
  const calculatedAt = summary.meta?.calculated_at || new Date().toISOString();
  const version = Number.parseInt(summary.meta?.snapshot_id || summary.version || 0, 10) || 0;
  const freshness = calculateFreshness(calculatedAt);

  return {
    version,
    overall_status: summary.overall_status,
    overall_score: summary.overall_score,
    window_start: summary.window_start,
    window_end: summary.window_end,
    previous_window_start: summary.previous_window_start || null,
    previous_window_end: summary.previous_window_end || null,
    basis: summary.basis,
    grain: summary.grain,
    kpis: (summary.kpis || []).map(compactKpi),
    issues: (summary.issues || []).slice(0, 5).map((issue) => ({
      machine: issue.machine,
      kpi: issue.kpi,
      value: issue.value,
      severity: issue.severity,
      action: issue.action,
    })),
    correction_queue: summary.correction_queue || {
      open_actions: 0,
      critical_aging: 0,
      next_escalation_minutes: 15,
    },
    calculated_at: calculatedAt,
    snapshot_age_seconds: freshness.snapshot_age_seconds,
    freshness_status: freshness.freshness_status,
    freshness_threshold_seconds: Math.floor(FRESHNESS_THRESHOLD_MS / 1000),
    meta: {
      calculated_at: calculatedAt,
      source: summary.meta?.source || 'sse_broadcast',
      snapshot_id: version || null,
      version,
      snapshot_age_seconds: freshness.snapshot_age_seconds,
      freshness_status: freshness.freshness_status,
      freshness_threshold_seconds: Math.floor(FRESHNESS_THRESHOLD_MS / 1000),
      previous_overall_score: summary.meta?.previous_overall_score ?? null,
      previous_overall_status: summary.meta?.previous_overall_status ?? null,
    },
  };
}

function normalizeSnapshotGrain(query = {}) {
  if (query.basis === 'today') return 'today';
  return query.window || '15m';
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusFromValue(value) {
  if (value === null || value === undefined) return 'no_data';
  return 'normal';
}

function buildFallbackKpis(row) {
  return Object.entries(KPI_FALLBACK).map(([key, def]) => ({
    key,
    label: def.label,
    target: def.target,
    owner: def.owner,
    value: numeric(row[def.column]),
    status: statusFromValue(row[def.column]),
    helper: 'Loaded from EWS snapshot',
    comparison: null,
  }));
}

async function getLatestSnapshotForQuery(query = {}, options = {}) {
  const pool = poolRef || global.pool;
  if (!pool) throw new Error('Database pool is not ready');

  const grain = normalizeSnapshotGrain(query);
  const result = await pool.query(
    `
    SELECT
      id,
      window_start,
      window_end,
      grain,
      scope_type,
      scope_key,
      uptime_pct::float,
      accuracy_pct::float,
      adoption_pct::float,
      oee_pct::float,
      ole_pct::float,
      overall_score::float,
      overall_status,
      detail_json,
      calculated_at
    FROM ews.kpi_snapshot
    WHERE grain = $1
      AND scope_type = 'system'
      AND scope_key = 'ALL'
    ORDER BY window_end DESC, calculated_at DESC
    LIMIT 1
    `,
    [grain]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `No EWS snapshot available for grain ${grain}. Start the EWS snapshot job first.`
    );
  }

  const detail = row.detail_json || {};
  const freshness = calculateFreshness(row.calculated_at);
  return {
    version: Number.parseInt(row.id, 10) || 0,
    overall_status: row.overall_status,
    overall_score: numeric(row.overall_score),
    window_start: row.window_start,
    window_end: row.window_end,
    previous_window_start: detail.previous_window_start || null,
    previous_window_end: detail.previous_window_end || null,
    basis: row.grain === 'today' ? 'today' : 'rolling',
    grain: row.grain,
    kpis:
      Array.isArray(detail.kpis) && detail.kpis.length
        ? detail.kpis.map((kpi) => (options.includeKpiDetail ? kpi : compactKpi(kpi)))
        : buildFallbackKpis(row),
    issues: Array.isArray(detail.issues) ? detail.issues.slice(0, 5) : [],
    correction_queue: detail.correction_queue || {
      open_actions: 0,
      critical_aging: 0,
      next_escalation_minutes: 15,
    },
    calculated_at: row.calculated_at,
    snapshot_age_seconds: freshness.snapshot_age_seconds,
    freshness_status: freshness.freshness_status,
    freshness_threshold_seconds: Math.floor(FRESHNESS_THRESHOLD_MS / 1000),
    meta: {
      calculated_at: row.calculated_at,
      source: 'kpi_snapshot',
      snapshot_id: row.id,
      version: Number.parseInt(row.id, 10) || 0,
      snapshot_age_seconds: freshness.snapshot_age_seconds,
      freshness_status: freshness.freshness_status,
      freshness_threshold_seconds: Math.floor(FRESHNESS_THRESHOLD_MS / 1000),
      previous_overall_score: detail.meta?.previous_overall_score ?? null,
      previous_overall_status: detail.meta?.previous_overall_status ?? null,
    },
  };
}

function snapshotEnvelope(summary, reason = 'snapshot', source = null) {
  return {
    version: summary.version,
    basis: summary.basis,
    grain: summary.grain,
    window_end: summary.window_end,
    calculated_at: summary.calculated_at,
    snapshot_age_seconds: summary.snapshot_age_seconds,
    freshness_status: summary.freshness_status,
    reason,
    source,
    data: summary,
  };
}

function sseWrite(res, event, data) {
  const id = Number.parseInt(data?.version, 10) || Date.now();
  res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(key, event, data) {
  for (const client of clients.values()) {
    if (client.key !== key) continue;
    sseWrite(client.res, event, data);
  }
}

function activeKeys() {
  return Array.from(new Set(Array.from(clients.values()).map((client) => client.key)));
}

function scheduleRefresh(key, reason = 'change', source = null) {
  if (!clients.size) return;
  if (!activeKeys().includes(key)) return;
  clearTimeout(timersByKey.get(key));
  timersByKey.set(
    key,
    setTimeout(() => {
      timersByKey.delete(key);
      refreshKey(key, reason, source).catch((err) => {
        console.error('EWS SSE refresh error:', err);
      });
    }, DEBOUNCE_MS)
  );
}

async function refreshKey(key, reason = 'change', source = null) {
  if (inFlightByKey.has(key)) return inFlightByKey.get(key);

  const task = (async () => {
    try {
      const next = compactSummary(await getLatestSnapshotForQuery(optionsFromKey(key)));
      cacheByKey.set(key, { payload: next, createdAt: Date.now() });
      broadcast(key, 'snapshot', snapshotEnvelope(next, reason, source));
      return next;
    } catch (err) {
      broadcast(key, 'stream-error', {
        version: Date.now(),
        error: err.message,
        reason,
        generated_at: new Date().toISOString(),
      });
      throw err;
    } finally {
      inFlightByKey.delete(key);
    }
  })();

  inFlightByKey.set(key, task);
  return task;
}

function subscribe(req, res) {
  if (clients.size >= MAX_CLIENTS) {
    res.status(503).json({ error: 'Too many EWS SSE clients' });
    return;
  }

  const key = streamKeyFromQuery(req.query);
  const clientId = nextClientId++;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  clients.set(clientId, { id: clientId, key, res, connectedAt: Date.now() });
  res.write(`: connected client=${clientId} at=${new Date().toISOString()}\n\n`);

  const cached = cacheByKey.get(key)?.payload;
  if (cached) {
    sseWrite(res, 'snapshot', snapshotEnvelope(cached, 'cache'));
  }
  scheduleRefresh(key, cached ? 'connect_refresh' : 'initial');

  req.on('close', () => {
    clients.delete(clientId);
  });
}

function optionsFromKey(key) {
  return JSON.parse(key);
}

function matchesSnapshotSource(key, source) {
  if (!source?.grain) return true;
  return normalizeSnapshotGrain(optionsFromKey(key)) === source.grain;
}

function signalChange(reason = 'snapshot_ready', source = null) {
  for (const key of activeKeys()) {
    if (!matchesSnapshotSource(key, source)) continue;
    scheduleRefresh(key, reason, source);
  }
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    const generatedAt = new Date().toISOString();
    for (const client of clients.values()) {
      client.res.write(`: heartbeat ${generatedAt} clients=${clients.size}\n\n`);
    }
  }, HEARTBEAT_MS);
}

function startSnapshotPoll() {
  clearInterval(snapshotPollTimer);
  if (SNAPSHOT_POLL_MS <= 0) return;

  snapshotPollTimer = setInterval(() => {
    for (const key of activeKeys()) {
      scheduleRefresh(key, 'snapshot_poll');
    }
  }, SNAPSHOT_POLL_MS);
}

async function connectListener() {
  const listenerPool = listenPoolRef || poolRef;
  if (!listenerPool || listenClient) return;

  try {
    listenClient = await listenerPool.connect();
    listenClient.on('notification', (message) => {
      let payload = null;
      try {
        payload = message.payload ? JSON.parse(message.payload) : null;
      } catch (_err) {
        payload = { raw: message.payload };
      }
      signalChange('database_notify', payload);
    });
    listenClient.on('error', (err) => {
      console.error('EWS LISTEN client error:', err.message);
      listenerConnected = false;
      releaseListener();
      scheduleReconnect();
    });
    await listenClient.query(`LISTEN ${SNAPSHOT_CHANNEL}`);
    listenerConnected = true;
    console.log(`EWS realtime listener connected on ${SNAPSHOT_CHANNEL}`);
  } catch (err) {
    console.error('EWS LISTEN connect error:', err.message);
    listenerConnected = false;
    releaseListener();
    scheduleReconnect();
  }
}

function releaseListener() {
  if (!listenClient) return;
  const client = listenClient;
  listenClient = null;
  listenerConnected = false;
  client.removeAllListeners('notification');
  client.removeAllListeners('error');
  try {
    client.release(true);
  } catch (_err) {}
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectListener, 5000);
}

function start({ pool, listenPool }) {
  poolRef = pool;
  listenPoolRef = listenPool || pool;
  startHeartbeat();
  startSnapshotPoll();
  connectListener();
}

async function getHealth(query = {}) {
  try {
    const snapshot = compactSummary(await getLatestSnapshotForQuery(query));
    return {
      snapshot_available: true,
      last_snapshot_at: snapshot.calculated_at,
      snapshot_age_seconds: snapshot.snapshot_age_seconds,
      freshness_status: snapshot.freshness_status,
      latest_version: snapshot.version,
      sse_clients: clients.size,
      listener_connected: listenerConnected,
      job_expected_interval_ms: JOB_INTERVAL_MS,
    };
  } catch (err) {
    return {
      snapshot_available: false,
      last_snapshot_at: null,
      snapshot_age_seconds: null,
      freshness_status: 'NO_SNAPSHOT',
      latest_version: null,
      sse_clients: clients.size,
      listener_connected: listenerConnected,
      job_expected_interval_ms: JOB_INTERVAL_MS,
      error: err.message,
    };
  }
}

module.exports = {
  start,
  subscribe,
  signalChange,
  streamKeyFromQuery,
  getLatestSnapshotForQuery,
  getHealth,
};
