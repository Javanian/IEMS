const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const { WebSocketServer } = require('ws');
const { envPath, loaded: envLoaded } = require('./config/loadEnv');
const { startKanbanRefreshJob } = require('./jobs/kanbanRefreshJob');
const ewsRealtimeHub = require('./services/ewsRealtimeHub');
const { resolveTimezone } = require('./config/timezone');

if (!envLoaded) {
  console.warn('⚠️  No .env file found, using environment variables');
} else {
  console.log('✅ .env loaded from:', envPath);
}

process.env.TZ = resolveTimezone();

console.log('================================');
console.log('Server Configuration');
console.log('================================');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Timezone:', process.env.TIMEZONE);
console.log('Plant ID:', process.env.PLANT_SSB);
console.log('Port:', process.env.PORT || 3001);
console.log('================================');

const { Pool, types } = require('pg');

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

console.log('===== DEBUG ENV DB =====');
console.log({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  ewsHost: process.env.EWS_DB_HOST || process.env.DB_HOST,
  ewsPort: process.env.EWS_DB_PORT || process.env.DB_PORT,
  user: process.env.DB_USER,
  db: process.env.DB_NAME,
  nodeEnv: process.env.NODE_ENV,
});
console.log('========================');

function createPgPool({
  host,
  port,
  max,
  applicationName,
  queryTimeoutMs,
  statementTimeoutMs,
  idleInTransactionTimeoutMs,
}) {
  const usesPgbouncer =
    String(host || '')
      .toLowerCase()
      .includes('pgbouncer') || String(port || '') === '6432';
  const startupOptions = [`-c timezone=${resolveTimezone()}`];

  if (!usesPgbouncer) {
    startupOptions.push(
      `-c statement_timeout=${statementTimeoutMs}`,
      `-c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMs}`
    );
  }

  return new Pool({
    host,
    port: parseInt(port, 10) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
    query_timeout: queryTimeoutMs,
    ...(usesPgbouncer
      ? {}
      : {
        statement_timeout: statementTimeoutMs,
        idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
      }),
    application_name: applicationName,
    options: startupOptions.join(' '),
  });
}

const pool = createPgPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  applicationName: process.env.DB_APPLICATION_NAME || 'mps2-api',
  queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '45000', 10),
  statementTimeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '45000', 10),
  idleInTransactionTimeoutMs: parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '30000', 10),
});

const ewsListenerPool = createPgPool({
  host: process.env.EWS_DB_HOST || process.env.DB_HOST,
  port: process.env.EWS_DB_PORT || process.env.DB_PORT,
  max: parseInt(process.env.EWS_LISTENER_DB_POOL_MAX || '1', 10),
  applicationName: process.env.EWS_LISTENER_DB_APPLICATION_NAME || 'mps2-api-ews-listener',
  queryTimeoutMs: parseInt(process.env.EWS_LISTENER_QUERY_TIMEOUT_MS || '0', 10),
  statementTimeoutMs: parseInt(process.env.EWS_LISTENER_STATEMENT_TIMEOUT_MS || '0', 10),
  idleInTransactionTimeoutMs: parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '30000', 10),
});

global.pool = pool;

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(compression());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN,

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role', 'x-user-id', 'x-user-name'],
    credentials: false,
  })
);

if (process.env.NODE_ENV !== 'production') {
  app.use(
    express.static(path.join(__dirname, '../UI'), {
      extensions: ['html'],
    })
  );
  console.log('📁 Serving static files from:', path.join(__dirname, '../UI'));
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    environment: process.env.NODE_ENV || 'development',
    timezone: process.env.TIMEZONE,
    timestamp: new Date().toLocaleString('id-ID', { timeZone: process.env.TIMEZONE }),
    port: process.env.PORT || 3001,
    plant: process.env.PLANT_SSB,
  });
});

if (process.env.DRAWINGS_PATH) {
  app.use('/drawings', express.static(process.env.DRAWINGS_PATH));
  console.log('📐 Drawings path:', process.env.DRAWINGS_PATH);
}

const rbacGuard = require('./rbac/rbacGuard');
app.use(rbacGuard);
console.log(
  `🔒 RBAC guard: ${rbacGuard.ENFORCE ? 'ENFORCING' : 'log-only (set RBAC_ENFORCE=1 to enforce)'}`
);

app.use('/sow', require('./routes/sow'));
app.use('/sow-schedule', require('./routes/sowSchedule'));
app.use('/usernfc', require('./routes/usernfc'));
app.use('/workcenter', require('./routes/workcenter'));
app.use('/timesheet', require('./routes/timesheet_transaction'));
app.use('/production-operations', require('./routes/production_operations'));
app.use('/process-control', require('./routes/processControlRoutes'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/receiving-shipment', require('./routes/receivingShipment'));
app.use('/component-tracking', require('./routes/componentTracking'));
app.use('/kanban', require('./routes/kanban'));
app.use('/machine-hours-sqlserver', require('./routes/machineHoursSqlServer'));
app.use('/machine-hours-validation', require('./routes/machineHoursValidation'));
app.use('/consumable', require('./routes/consumable'));
app.use('/tools', require('./routes/tools'));
app.use('/auth', require('./routes/auth'));
app.use('/ms-project', require('./routes/msProject'));
app.use('/ews', require('./routes/ews'));
app.use('/config', require('./routes/config'));
app.use('/device-heartbeat', require('./routes/deviceHeartbeat'));

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
require('./websocket/machineHoursSqlServerSocket')(wss);
if (process.env.ENABLE_MPS_DASHBOARD_WS === '1') {
  require('./websocket/mpsDashboardSocket')(wss);
}

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
let kanbanRefreshJob = null;
async function startServer() {
  let connected = false;

  while (!connected) {
    try {
      const client = await pool.connect();
      console.log('✅ Database connected successfully');
      client.release();
      connected = true;

      await require('./config/plantConfig').loadPlantConfig(global.pool);
    } catch (err) {
      console.error('❌ Database not ready, retrying in 3s...', {
        code: err.code,
        message: err.message,
      });
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(
      `📅 Local time: ${new Date().toLocaleString('id-ID', { timeZone: process.env.TIMEZONE })}`
    );
    console.log(`🌐 Access: http://${HOST}:${PORT}`);
    console.log('================================');
    kanbanRefreshJob = startKanbanRefreshJob({ pool });
    ewsRealtimeHub.start({ pool, listenPool: ewsListenerPool });
  });
}

startServer();
