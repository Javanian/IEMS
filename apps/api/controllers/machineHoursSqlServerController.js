const sql = require('mssql');
let pgPool = null;
try {
  pgPool = global.pool;
} catch (_) {
  pgPool = null;
}

function _stripZero(v) {
  const s = String(v || '').replace(/^0+/, '');
  return s || '0';
}

async function _bulkLookupOperationText(jobids) {
  if (!pgPool || !jobids.length) return {};
  const stripped = [...new Set(jobids.filter(Boolean).map((j) => _stripZero(j)))];
  if (!stripped.length) return {};
  try {
    const result = await pgPool.query(
      `SELECT confirmation_number, operation_short_text
       FROM ph3_order
       WHERE LTRIM(confirmation_number, '0') = ANY($1)`,
      [stripped]
    );
    const map = {};
    result.rows.forEach((r) => {
      const k = _stripZero(r.confirmation_number);
      if (!map[k]) map[k] = r.operation_short_text || '';
    });
    return map;
  } catch (err) {
    console.error('bulkLookupOperationText PG error:', err.message);
    return {};
  }
}

if (!process.env.SQLSERVER_PASSWORD) {
  console.error(
    '[machineHoursSqlServer] SQLSERVER_PASSWORD is not set — SQL Server queries will fail. ' +
      'Set SQLSERVER_USER/SQLSERVER_PASSWORD in the root .env (compose already forwards them).'
  );
}
const sqlServerConfig = {
  server: process.env.SQLSERVER_HOST || '10.169.13.13',
  port: parseInt(process.env.SQLSERVER_PORT || '57970', 10),
  database: process.env.SQLSERVER_DATABASE || 'SSB_OEE',
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 10000,
  requestTimeout: 120000,
};

function getSafeConnectionInfo() {
  return {
    server: sqlServerConfig.server,
    port: sqlServerConfig.port,
    database: sqlServerConfig.database,
    user: sqlServerConfig.user ? 'configured' : 'missing',
  };
}

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlServerConfig).connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

function parseIntParam(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseOptionalLimit(value, fallback, min, max) {
  if (
    String(value || '')
      .trim()
      .toLowerCase() === 'all'
  )
    return null;
  return parseIntParam(value, fallback, min, max);
}

function parseDateParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function applyFilters(request, filters = {}) {
  const where = [
    'p.startdatetime IS NOT NULL',
    '(p.enddatetime IS NULL OR DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1)',
    'p.statusid <> 2',
  ];

  let hasDateFilter = false;

  const from = parseDateParam(filters.from || filters.start);
  if (from) {
    request.input('from', sql.Date, from);
    where.push('CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE) >= @from');
    hasDateFilter = true;
  }

  const to = parseDateParam(filters.to || filters.end);
  if (to) {
    request.input('to', sql.Date, to);
    where.push('CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE) <= @to');
    hasDateFilter = true;
  }

  if (!hasDateFilter) {
    request.input(
      'defaultFrom',
      sql.Date,
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    );
    where.push('CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE) >= @defaultFrom');
  }

  const statusId = filters.statusid ? parseInt(filters.statusid, 10) : null;
  if (Number.isInteger(statusId)) {
    request.input('statusid', sql.Int, statusId);
    where.push('p.statusid = @statusid');
  }

  const machineNo = filters.machineno ? parseInt(filters.machineno, 10) : null;
  if (Number.isInteger(machineNo)) {
    request.input('machineno', sql.Int, machineNo);
    where.push('p.machineno = @machineno');
  }

  if (filters.operatorid) {
    request.input('operatorid', sql.VarChar(64), String(filters.operatorid));
    where.push('p.operatorid = @operatorid');
  }

  if (filters.jobid) {
    request.input('jobid', sql.VarChar(64), String(filters.jobid));
    where.push('p.jobid = @jobid');
  }

  if (filters.search && String(filters.search).trim()) {
    request.input('search', sql.VarChar(128), `%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(m.machineid, '')) LIKE @search
      OR LOWER(COALESCE(m.machinename, '')) LIKE @search
      OR LOWER(COALESCE(m.description, '')) LIKE @search
      OR LOWER(COALESCE(st.description, '')) LIKE @search
      OR LOWER(COALESCE(p.operatorid, '')) LIKE @search
      OR LOWER(COALESCE(p.jobid, '')) LIKE @search
    )`);
  }

  return where.join(' AND ');
}

function normalizeRow(row) {
  return {
    ...row,
    work_date:
      row.work_date instanceof Date ? row.work_date.toISOString().slice(0, 10) : row.work_date,
    first_startdatetime:
      row.first_startdatetime instanceof Date
        ? row.first_startdatetime.toISOString()
        : row.first_startdatetime,
    last_enddatetime:
      row.last_enddatetime instanceof Date
        ? row.last_enddatetime.toISOString()
        : row.last_enddatetime,
    duration_hours: row.duration_hours == null ? 0 : Number(row.duration_hours),
    duration_seconds: row.duration_seconds == null ? 0 : Number(row.duration_seconds),
    event_count: row.event_count == null ? 0 : Number(row.event_count),
    open_event_count: row.open_event_count == null ? 0 : Number(row.open_event_count),
  };
}

function normalizeStatusDescription(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getActivityTypeFromStatus(statusDescription) {
  const normalized = normalizeStatusDescription(statusDescription);
  if (!normalized) return '';

  if (normalized === 'productive') return 'M1';

  if (
    normalized === 'load' ||
    normalized === 'loading' ||
    normalized === 'setting' ||
    normalized === 'measure' ||
    normalized === 'meassure' ||
    normalized === 'unload' ||
    normalized === 'unloading' ||
    normalized === 'preventive'
  ) {
    return 'M2';
  }

  return '';
}

function normalizeActivityType(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (normalized === 'M1' || normalized === 'VA') return 'M1';
  if (normalized === 'M2' || normalized === 'NNVA') return 'M2';
  return '';
}

function normalizeValidationRow(row) {
  return {
    ...normalizeRow(row),
    record_key: String(row.record_key || ''),
    min_proddataid: row.min_proddataid == null ? '' : row.min_proddataid,
    activitytype:
      normalizeActivityType(row.activitytype) || getActivityTypeFromStatus(row.status_description),
    order_no: row.order_no || '',
    operation_no: row.operation_no || '',
    sequence_category: row.sequence_category || '',
    sequence_number: row.sequence_number || '',
    ph3_sequence_number: row.ph3_sequence_number || '',
    branch_operation_no: row.branch_operation_no || '',
    return_operation_no: row.return_operation_no || '',
    work_center: row.work_center || '',
  };
}

function buildSapPayload(row) {
  const startDateTime = row.first_startdatetime;
  const endDateTime = row.last_enddatetime || row.first_startdatetime;
  const datePart = (value) =>
    String(value || '')
      .slice(0, 10)
      .replaceAll('-', '');
  const timePart = (value) =>
    String(value || '')
      .slice(11, 19)
      .replaceAll(':', '');

  return {
    ZTIMESHEETID: String(row.min_proddataid || ''),
    PERNR: String(row.operatorid || ''),
    RUECK: String(row.jobid || ''),
    AUFNR: String(row.order_no || row.jobid || ''),
    VORNR: String(row.operation_no || ''),
    FLGAT: row.sequence_category || '',
    PLNFL: row.ph3_sequence_number || '',
    VORNR_B: row.branch_operation_no || '',
    VORNR_R: row.return_operation_no || '',
    ZCONF_TYPE: row.activitytype || '',
    ARBPL: row.machineid || row.work_center || '',
    LSTAR: '',
    ISDD: datePart(startDateTime),
    ISDZ: timePart(startDateTime),
    IEDD: datePart(endDateTime),
    IEDZ: timePart(endDateTime),
    WERKS: '',
    AUERU: '',
    ZBARCODEID: row.status_description || '',
  };
}

function withSapPayload(rows) {
  return rows.map((row) => ({
    ...row,
    sap_payload: buildSapPayload(row),
  }));
}

async function fetchMachineHoursRows(filters = {}) {
  const limit = parseIntParam(filters.limit, 200, 1, 1000);
  const pool = await getPool();
  const request = pool.request();
  request.input('limit', sql.Int, limit);

  const where = applyFilters(request, filters);
  const result = await request.query(`
    SELECT TOP (@limit)
      CAST(p.startdatetime AS DATE) AS work_date,
      p.statusid,
      st.description AS status_description,
      p.machineno,
      m.machineid,
      m.machinename,
      COALESCE(NULLIF(m.description, ''), m.machinename) AS machine_description,
      m.plantid,
      p.operatorid,
      p.jobid,
      COUNT(*) AS event_count,
      SUM(CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END) AS open_event_count,
      DATEADD(HOUR, -8, MIN(p.startdatetime)) AS first_startdatetime,
      DATEADD(HOUR, -8, MAX(p.enddatetime)) AS last_enddatetime,
      SUM(
        CASE
          WHEN p.enddatetime IS NULL THEN 0
          ELSE DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
        END
      ) AS duration_seconds,
      ROUND(
        CAST(
          SUM(
            CASE
              WHEN p.enddatetime IS NULL THEN 0
              ELSE DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
            END
          ) AS NUMERIC(18, 4)
        ) / 3600.0,
        4
      ) AS duration_hours
    FROM dbo.ProductionData p
    LEFT JOIN dbo.Machines m ON m.machineno = p.machineno
    LEFT JOIN dbo.StatusTypes st ON st.statusid = p.statusid
    WHERE ${where}
    GROUP BY
      CAST(p.startdatetime AS DATE),
      p.statusid,
      st.description,
      p.machineno,
      m.machineid,
      m.machinename,
      COALESCE(NULLIF(m.description, ''), m.machinename),
      m.plantid,
      p.operatorid,
      p.jobid
    ORDER BY MIN(p.startdatetime) DESC, p.machineno ASC, p.operatorid ASC, p.jobid ASC
  `);

  const rows = result.recordset.map(normalizeRow);
  const jobids = [...new Set(rows.map((r) => r.jobid).filter(Boolean))];
  if (jobids.length) {
    const opMap = await _bulkLookupOperationText(jobids);
    rows.forEach((r) => {
      const k = _stripZero(r.jobid);
      r.operation_short_text = opMap[k] || '';
    });
  }
  return rows;
}

async function fetchValidationGroups(filters = {}) {
  const pool = await getPool();
  const request = pool.request();
  const where = applyFilters(request, filters);
  const groupLimit = parseIntParam(filters.groupLimit, 10000, 1000, 50000);
  request.input('groupLimit', sql.Int, groupLimit);

  const result = await request.query(`
    WITH filtered AS (
      SELECT TOP (@groupLimit)
        p.proddataid AS min_proddataid,
        CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE) AS work_date,
        p.machineno,
        m.machineid,
        m.machinename,
        COALESCE(NULLIF(m.description, ''), m.machinename, CONCAT('Machine ', p.machineno)) AS machine_description,
        m.plantid,
        p.statusid,
        COALESCE(st.description, 'Unknown') AS status_description,
        '' AS activitytype,
        p.operatorid,
        p.jobid,
        CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END AS open_event_count,
        DATEADD(HOUR, -8, p.startdatetime) AS first_startdatetime,
        DATEADD(HOUR, -8, p.enddatetime) AS last_enddatetime,
        CASE
          WHEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1
            THEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
          ELSE 0
        END AS duration_seconds
      FROM dbo.ProductionData p
      LEFT JOIN dbo.Machines m ON m.machineno = p.machineno
      LEFT JOIN dbo.StatusTypes st ON st.statusid = p.statusid
      WHERE ${where}
      ORDER BY p.startdatetime DESC, p.machineno ASC
    ),
    grouped AS (
      SELECT
        machineno,
        MAX(machineid) AS machineid,
        MAX(machinename) AS machinename,
        MAX(machine_description) AS machine_description,
        MAX(plantid) AS plantid,
        COUNT(*) AS record_count,
        COUNT(*) AS event_count,
        SUM(open_event_count) AS open_event_count,
        SUM(duration_seconds) AS duration_seconds,
        ROUND(CAST(SUM(duration_seconds) AS NUMERIC(18, 4)) / 3600.0, 4) AS duration_hours,
        MAX(first_startdatetime) AS latest_startdatetime
      FROM filtered
      GROUP BY machineno
    )
    SELECT
      *,
      SUM(record_count) OVER () AS g_total_records,
      COUNT(*) OVER () AS g_total_machines,
      SUM(event_count) OVER () AS g_total_events,
      SUM(open_event_count) OVER () AS g_total_open_events,
      ROUND(CAST(SUM(duration_seconds) OVER () AS NUMERIC(18, 4)) / 3600.0, 4) AS g_total_hours
    FROM grouped
    ORDER BY latest_startdatetime DESC, machineno ASC
  `);

  return result.recordset;
}

async function fetchValidationGroupRecords(machineno, filters = {}) {
  const limit = parseOptionalLimit(filters.limit, 500, 1, 1000);
  const pool = await getPool();
  const request = pool.request();
  if (limit != null) request.input('limit', sql.Int, limit);

  const where = applyFilters(request, { ...filters, machineno });
  const selectClause = limit == null ? 'SELECT' : 'SELECT TOP (@limit)';

  const result = await request.query(`
    ${selectClause}
      CONCAT(
        CAST(p.proddataid AS varchar(32)), '|',
        CAST(p.machineno AS varchar(32)), '|',
        CONVERT(varchar(19), p.startdatetime, 120)
      ) AS record_key,
      p.proddataid AS min_proddataid,
      CONVERT(varchar(10), CAST(DATEADD(HOUR, -8, p.startdatetime) AS DATE), 23) AS work_date,
      p.machineno,
      COALESCE(m.machineid, '') AS machineid,
      COALESCE(m.machinename, '') AS machinename,
      COALESCE(NULLIF(m.description, ''), m.machinename, CONCAT('Machine ', p.machineno)) AS machine_description,
      m.plantid,
      p.statusid,
      COALESCE(st.description, 'Unknown') AS status_description,
      '' AS activitytype,
      p.operatorid,
      p.jobid,
      '' AS order_no,
      '' AS operation_no,
      '' AS sequence_category,
      '' AS sequence_number,
      '' AS ph3_sequence_number,
      '' AS branch_operation_no,
      '' AS return_operation_no,
      COALESCE(m.machineid, '') AS work_center,
      1 AS event_count,
      CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END AS open_event_count,
      CONVERT(varchar(19), DATEADD(HOUR, -8, p.startdatetime), 126) AS first_startdatetime,
      CONVERT(varchar(19), DATEADD(HOUR, -8, p.enddatetime), 126) AS last_enddatetime,
      CASE
        WHEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1
          THEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
        ELSE 0
      END AS duration_seconds,
      ROUND(
        CAST(
          CASE
            WHEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime) > 1
              THEN DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
            ELSE 0
          END AS NUMERIC(18, 4)
        ) / 3600.0,
        4
      ) AS duration_hours
    FROM dbo.ProductionData p
    LEFT JOIN dbo.Machines m ON m.machineno = p.machineno
    LEFT JOIN dbo.StatusTypes st ON st.statusid = p.statusid
    WHERE ${where}
    ORDER BY p.startdatetime DESC, p.statusid ASC, p.operatorid ASC, p.jobid ASC
  `);

  const rows = result.recordset.map(normalizeValidationRow);
  const jobids = [...new Set(rows.map((r) => r.jobid).filter(Boolean))];
  if (jobids.length) {
    const opMap = await _bulkLookupOperationText(jobids);
    rows.forEach((r) => {
      const k = _stripZero(r.jobid);
      r.operation_short_text = opMap[k] || '';
    });
  }
  return rows;
}

async function getMachineHours(req, res) {
  try {
    const rows = await fetchMachineHoursRows(req.query);
    res.json({
      success: true,
      data: rows,
      meta: {
        count: rows.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('SQL Server machine hours error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      source: 'sqlserver',
      connection: getSafeConnectionInfo(),
    });
  }
}

async function validationStats(req, res) {
  try {
    const rows = await fetchValidationGroups(req.query);
    const first = rows[0];

    res.json({
      success: true,
      meta: {
        start: req.query.start || req.query.from || '',
        end: req.query.end || req.query.to || '',
        source: 'sqlserver',
        generated_at: new Date().toISOString(),
      },
      stats: first
        ? {
            totalRecords: Number(first.g_total_records || 0),
            totalMachines: Number(first.g_total_machines || 0),
            totalEvents: Number(first.g_total_events || 0),
            totalOpenEvents: Number(first.g_total_open_events || 0),
            totalHours: Number(first.g_total_hours || 0).toFixed(2),
            totalPending: Number(first.g_total_records || 0),
            totalValidated: 0,
          }
        : {
            totalRecords: 0,
            totalMachines: 0,
            totalEvents: 0,
            totalOpenEvents: 0,
            totalHours: '0.00',
            totalPending: 0,
            totalValidated: 0,
          },
      groups: rows.map(
        ({
          g_total_records,
          g_total_machines,
          g_total_events,
          g_total_open_events,
          g_total_hours,
          ...row
        }) => row
      ),
    });
  } catch (err) {
    console.error('SQL Server machine hours validationStats error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      source: 'sqlserver',
      connection: getSafeConnectionInfo(),
    });
  }
}

async function validationGroupRecords(req, res) {
  try {
    const rows = await fetchValidationGroupRecords(req.params.machineno, req.query);
    res.json({
      success: true,
      meta: {
        start: req.query.start || req.query.from || '',
        end: req.query.end || req.query.to || '',
        source: 'sqlserver',
        generated_at: new Date().toISOString(),
      },
      data: withSapPayload(rows),
    });
  } catch (err) {
    console.error('SQL Server machine hours validationGroupRecords error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      source: 'sqlserver',
      connection: getSafeConnectionInfo(),
    });
  }
}

async function getHealth(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT TOP 1 startdatetime FROM dbo.ProductionData');
    res.json({
      success: true,
      connected: true,
      sample_count: result.recordset.length,
      connection: getSafeConnectionInfo(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      connected: false,
      error: err.message,
      connection: getSafeConnectionInfo(),
    });
  }
}

module.exports = {
  fetchMachineHoursRows,
  getHealth,
  getMachineHours,
  validationGroupRecords,
  validationStats,
};
