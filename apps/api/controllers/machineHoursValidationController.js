const db = global.pool || require('../db');

const PLANT_SSB = process.env.PLANT_SSB || '';

const DEFAULT_DAYS = 7;
const MAX_LIMIT = 1000;

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - DEFAULT_DAYS);
  return { start: dateOnly(start), end: dateOnly(end) };
}

function normalizeRange(query) {
  const defaults = defaultRange();
  return {
    start: query.start || query.from || defaults.start,
    end: query.end || query.to || defaults.end,
  };
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function padLeft(value, length) {
  const text = String(value ?? '').trim();
  return text ? text.padStart(length, '0') : '';
}

function formatSapDate(value) {
  return String(value || '')
    .slice(0, 10)
    .replaceAll('-', '');
}

function formatSapTime(value) {
  return String(value || '')
    .slice(11, 19)
    .replaceAll(':', '');
}

function getConfType(row) {
  const activityType = String(row.activitytype || '')
    .trim()
    .toUpperCase();
  return activityType === 'M1' || activityType === 'M2' ? activityType : '';
}

function getLstar(row) {
  const activityType = String(row.activitytype || '').trim();
  const normalized = activityType.toUpperCase();
  return normalized === 'M1' || normalized === 'M2' ? '' : activityType;
}

function buildSapPayload(row) {
  const zconfType = getConfType(row);
  const startDateTime = row.first_startdatetime;
  const endDateTime = row.last_enddatetime || row.first_startdatetime;
  const confirmationNo = row.confirmation_no || row.jobid || '';
  const orderNo = row.order_no || confirmationNo;

  return {
    ZTIMESHEETID: `${PLANT_SSB}${row.min_proddataid || ''}`,
    PERNR: String(row.sn_employee || ''),
    RUECK: zconfType === 'M1' || zconfType === 'M2' ? padLeft(confirmationNo, 10) : '',
    AUFNR: padLeft(orderNo, 12),
    VORNR: padLeft(row.operation_no, 4),
    FLGAT: row.sequence_category || '',
    PLNFL: row.ph3_sequence_number || '',
    VORNR_B: row.branch_operation_no || '',
    VORNR_R: row.return_operation_no || '',
    ZCONF_TYPE: zconfType,
    ARBPL: row.machineid || row.work_center || '',
    LSTAR: getLstar(row),
    ISDD: formatSapDate(startDateTime),
    ISDZ: formatSapTime(startDateTime),
    IEDD: formatSapDate(endDateTime),
    IEDZ: formatSapTime(endDateTime),
    WERKS: PLANT_SSB,
    AUERU: '',
    ZBARCODEID: zconfType === 'M2' ? row.status_description || '' : '',
  };
}

function withSapPayload(rows) {
  return rows.map((row) => ({
    ...row,
    sap_payload: buildSapPayload(row),
  }));
}

function buildFilters(query, offset = 1) {
  const { start, end } = normalizeRange(query);
  const params = [start, end];
  let paramIdx = offset + 2;
  const clauses = [
    `v.startdatetime >= $${offset}::date`,
    `v.startdatetime < ($${offset + 1}::date + interval '1 day')`,
    'v.startdatetime IS NOT NULL',
  ];

  if (query.search && query.search.trim()) {
    const searchLike = `%${query.search.trim().toLowerCase()}%`;
    clauses.push(`(
      LOWER(COALESCE(v.machineid, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.machinename, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.status_description, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.full_name, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.sn_employee, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.confirmation_number, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.order_no, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.operation_no::text, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.operation_short_text, '')) LIKE $${paramIdx}
    )`);
    params.push(searchLike);
    paramIdx += 1;
  }

  if (query.machineno) {
    clauses.push(`v.machineno = $${paramIdx}::int`);
    params.push(query.machineno);
    paramIdx += 1;
  }

  if (query.statusid) {
    clauses.push(`v.statusid = $${paramIdx}::int`);
    params.push(query.statusid);
    paramIdx += 1;
  }

  const employeeFilter = query.employee || query.operatorid;
  if (employeeFilter && employeeFilter.trim()) {
    clauses.push(`(
      LOWER(COALESCE(v.full_name, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(v.sn_employee, '')) LIKE $${paramIdx}
    )`);
    params.push(`%${employeeFilter.trim().toLowerCase()}%`);
    paramIdx += 1;
  }

  const confirmationFilter = query.confirmation_no || query.jobid;
  if (confirmationFilter && confirmationFilter.trim()) {
    clauses.push(`(
      v.confirmation_number = $${paramIdx}
      OR v.order_no = $${paramIdx}
    )`);
    params.push(confirmationFilter.trim());
  }

  return {
    start,
    end,
    params,
    whereSQL: clauses.join(' AND '),
  };
}

const groupedSelect = `
  SELECT
    concat_ws('|',
      v.machineno::text,
      v.statusid::text,
      COALESCE(v.sn_employee, ''),
      COALESCE(v.confirmation_number, ''),
      COALESCE(v.order_no, ''),
      COALESCE(v.operation_no::text, ''),
      to_char(v.startdatetime::date, 'YYYY-MM-DD')
    ) AS record_key,
    MIN(v.proddataid) AS min_proddataid,
    to_char(v.startdatetime::date, 'YYYY-MM-DD') AS work_date,
    v.machineno,
    COALESCE(v.machineid, '') AS machineid,
    COALESCE(v.machinename, '') AS machinename,
    COALESCE(NULLIF(v.machinename, ''), v.machineid, 'Machine ' || v.machineno::text) AS machine_description,
    v.machine_plantid AS plantid,
    v.statusid,
    COALESCE(v.status_description, 'Unknown') AS status_description,
    COALESCE(v.status_activitytype, '') AS activitytype,
    COALESCE(v.full_name, '') AS full_name,
    COALESCE(v.sn_employee, '') AS sn_employee,
    COALESCE(v.confirmation_number, '') AS confirmation_no,
    COALESCE(v.confirmation_number, '') AS jobid,
    COALESCE(v.order_no, '') AS order_no,
    COALESCE(v.operation_no::text, '') AS operation_no,
    COALESCE(v.operation_short_text, '') AS operation_short_text,
    COALESCE(v.sequence_category, '') AS sequence_category,
    COALESCE(v.sequence_number, '') AS sequence_number,
    COALESCE(v.sequence_number, '') AS ph3_sequence_number,
    COALESCE(v.branch_operation_no, '') AS branch_operation_no,
    COALESCE(v.return_operation_no, '') AS return_operation_no,
    COALESCE(v.workcentercode, '') AS work_center,
    COUNT(*)::int AS event_count,
    SUM(CASE WHEN v.enddatetime IS NULL THEN 1 ELSE 0 END)::int AS open_event_count,
    to_char(MIN(v.startdatetime), 'YYYY-MM-DD"T"HH24:MI:SS') AS first_startdatetime,
    to_char(MAX(v.enddatetime), 'YYYY-MM-DD"T"HH24:MI:SS') AS last_enddatetime,
    to_char(MIN(v.startdatetime), 'YYYY-MM-DD"T"HH24:MI:SS') AS startdatetime,
    to_char(MAX(v.enddatetime), 'YYYY-MM-DD"T"HH24:MI:SS') AS enddatetime,
    COALESCE(SUM(v.duration_seconds), 0)::bigint AS duration_seconds,
    ROUND(COALESCE(SUM(v.duration_hours), 0), 4) AS duration_hours
  FROM public.mch_transaction v
`;

const groupedBy = `
  GROUP BY
    v.startdatetime::date,
    v.machineno,
    v.machineid,
    v.machinename,
    COALESCE(NULLIF(v.machinename, ''), v.machineid, 'Machine ' || v.machineno::text),
    v.machine_plantid,
    v.statusid,
    v.status_description,
    v.status_activitytype,
    v.full_name,
    v.sn_employee,
    v.confirmation_number,
    v.order_no,
    v.operation_no,
    v.operation_short_text,
    v.sequence_category,
    v.sequence_number,
    v.branch_operation_no,
    v.return_operation_no,
    v.workcentercode
`;

const detailSelect = `
  SELECT
    concat_ws('|', v.proddataid::text) AS record_key,
    v.proddataid AS min_proddataid,
    to_char(v.startdatetime::date, 'YYYY-MM-DD') AS work_date,
    v.machineno,
    COALESCE(v.machineid, '') AS machineid,
    COALESCE(v.machinename, '') AS machinename,
    COALESCE(NULLIF(v.machinename, ''), v.machineid, 'Machine ' || v.machineno::text) AS machine_description,
    v.machine_plantid AS plantid,
    v.statusid,
    COALESCE(v.status_description, 'Unknown') AS status_description,
    COALESCE(v.status_activitytype, '') AS activitytype,
    COALESCE(v.full_name, '') AS full_name,
    COALESCE(v.sn_employee, '') AS sn_employee,
    COALESCE(v.confirmation_number, '') AS confirmation_no,
    COALESCE(v.confirmation_number, '') AS jobid,
    COALESCE(v.order_no, '') AS order_no,
    COALESCE(v.operation_no::text, '') AS operation_no,
    COALESCE(v.operation_short_text, '') AS operation_short_text,
    COALESCE(v.sequence_category, '') AS sequence_category,
    COALESCE(v.sequence_number, '') AS sequence_number,
    COALESCE(v.sequence_number, '') AS ph3_sequence_number,
    COALESCE(v.branch_operation_no, '') AS branch_operation_no,
    COALESCE(v.return_operation_no, '') AS return_operation_no,
    COALESCE(v.workcentercode, '') AS work_center,
    1::int AS event_count,
    CASE WHEN v.enddatetime IS NULL THEN 1 ELSE 0 END::int AS open_event_count,
    to_char(v.startdatetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS first_startdatetime,
    to_char(v.enddatetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_enddatetime,
    to_char(v.startdatetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS startdatetime,
    to_char(v.enddatetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS enddatetime,
    COALESCE(v.duration_seconds, 0)::bigint AS duration_seconds,
    ROUND(COALESCE(v.duration_hours, 0), 4) AS duration_hours
  FROM public.mch_transaction v
`;

exports.validationStats = async (req, res) => {
  try {
    const filters = buildFilters(req.query);

    const query = `
      WITH grouped AS (
        ${groupedSelect}
        WHERE ${filters.whereSQL}
        ${groupedBy}
      )
      SELECT
        machineno,
        MAX(machineid) AS machineid,
        MAX(machinename) AS machinename,
        MAX(machine_description) AS machine_description,
        MAX(plantid) AS plantid,
        COUNT(*)::int AS record_count,
        COALESCE(SUM(event_count), 0)::int AS event_count,
        COALESCE(SUM(open_event_count), 0)::int AS open_event_count,
        COALESCE(SUM(duration_seconds), 0)::bigint AS duration_seconds,
        ROUND(COALESCE(SUM(duration_hours), 0), 4) AS duration_hours,
        to_char(MAX(first_startdatetime::timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') AS latest_startdatetime,
        SUM(COUNT(*)) OVER ()::int AS g_total_records,
        COUNT(*) OVER ()::int AS g_total_machines,
        COALESCE(SUM(SUM(event_count)) OVER (), 0)::int AS g_total_events,
        COALESCE(SUM(SUM(open_event_count)) OVER (), 0)::int AS g_total_open_events,
        ROUND(COALESCE(SUM(SUM(duration_hours)) OVER (), 0), 4) AS g_total_hours
      FROM grouped
      GROUP BY machineno
      ORDER BY MAX(first_startdatetime::timestamp) DESC, machineno ASC
    `;

    const result = await db.query(query, filters.params);
    const first = result.rows[0];

    res.json({
      success: true,
      meta: {
        start: filters.start,
        end: filters.end,
        plant: PLANT_SSB,
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
      groups: result.rows.map(
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
    console.error('machineHoursValidation validationStats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.validationGroupRecords = async (req, res) => {
  try {
    const { machineno } = req.params;
    const filters = buildFilters({ ...req.query, machineno });
    const limit = clampLimit(req.query.limit);
    const params = [...filters.params, limit];

    const query = `
      ${detailSelect}
      WHERE ${filters.whereSQL}
      ORDER BY v.startdatetime DESC, v.statusid ASC, v.full_name ASC, v.confirmation_number ASC, v.proddataid DESC
      LIMIT $${params.length}
    `;

    const result = await db.query(query, params);

    res.json({
      success: true,
      meta: {
        start: filters.start,
        end: filters.end,
        plant: PLANT_SSB,
        generated_at: new Date().toISOString(),
      },
      data: withSapPayload(result.rows),
    });
  } catch (err) {
    console.error('machineHoursValidation validationGroupRecords error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
