const { Pool, types } = require('pg');
require('./config/loadEnv');
const { resolveTimezone } = require('./config/timezone');

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT;
const usesPgbouncer =
  String(dbHost || '')
    .toLowerCase()
    .includes('pgbouncer') || String(dbPort || '') === '6432';
const statementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '45000', 10);
const idleInTransactionTimeoutMs = parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '30000', 10);
const startupOptions = [`-c timezone=${resolveTimezone()}`];

if (!usesPgbouncer) {
  startupOptions.push(
    `-c statement_timeout=${statementTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMs}`
  );
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: dbHost,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: dbPort,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '45000', 10),
  ...(usesPgbouncer
    ? {}
    : {
        statement_timeout: statementTimeoutMs,
        idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
      }),
  application_name: process.env.DB_APPLICATION_NAME || 'mps2-api',
  options: startupOptions.join(' '),
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
