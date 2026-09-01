const db = global.pool || require('../db');
const { resolveTimezone } = require('../config/timezone');

const MAX_LIMIT = 500;
const PLAN_EXCEEDED_MESSAGE = 'Melebihi Standard SOW';
const SUPERVISOR_ROLES = new Set(['supervisor', 'administrator']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(`${fieldName} must be greater than 0`);
    error.status = 400;
    throw error;
  }
  return number;
}

function toInt(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function toBool(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function clampLimit(value) {
  return Math.min(MAX_LIMIT, Math.max(1, parseInt(value, 10) || 50));
}

function todayDate() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: resolveTimezone(),
  });
}

function normalizeDate(value, fieldName = 'date') {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${fieldName} must use YYYY-MM-DD`);
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizeTime(value, fieldName = 'time') {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const error = new Error(`${fieldName} must use HH:mm or HH:mm:ss`);
    error.status = 400;
    throw error;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) {
    const error = new Error(`${fieldName} is out of range`);
    error.status = 400;
    throw error;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const [hour, minute] = normalizeTime(value).split(':').map(Number);
  return hour * 60 + minute;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function buildDateTime(dateText, timeText) {
  return `${dateText} ${normalizeTime(timeText)}`;
}

function formatLocalDateTime(date) {
  return (
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-') +
    ' ' +
    [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join(':')
  );
}

function addHours(dateTimeText, hours) {
  const date = new Date(String(dateTimeText).replace(' ', 'T'));
  date.setMinutes(date.getMinutes() + Math.round(Number(hours || 0) * 60));
  return formatLocalDateTime(date);
}

function diffHours(startDateTime, endDateTime) {
  const start = new Date(String(startDateTime).replace(' ', 'T'));
  const end = new Date(String(endDateTime).replace(' ', 'T'));
  const hours = (end.getTime() - start.getTime()) / 3600000;
  return Math.round(hours * 100) / 100;
}

function shiftDurationHours(shift) {
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  if (shift.crosses_midnight || end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function buildShiftWindow(scheduleDate, shift) {
  const date = normalizeDate(scheduleDate, 'schedule_date');
  const start = buildDateTime(date, shift.start_time);
  const endDate =
    shift.crosses_midnight || timeToMinutes(shift.end_time) <= timeToMinutes(shift.start_time)
      ? addDays(date, 1)
      : date;
  const end = buildDateTime(endDate, shift.end_time);
  return { start, end, hours: shiftDurationHours(shift) };
}

function buildOvertimeWindow(overtimeDate, startTime, endTime) {
  const date = normalizeDate(overtimeDate, 'overtime_date');
  const start = buildDateTime(date, startTime);
  const endDate = timeToMinutes(endTime) <= timeToMinutes(startTime) ? addDays(date, 1) : date;
  const end = buildDateTime(endDate, endTime);
  const hours = diffHours(start, end);
  if (hours <= 0) {
    const error = new Error('overtime end must be after start');
    error.status = 400;
    throw error;
  }
  return { start, end, hours };
}

function getRequestUser(req) {
  const headers = req && req.headers ? req.headers : {};
  const bodyUser = (req && req.body ? req.body.currentUser || req.body.user : {}) || {};
  return {
    id: toInt(headers['x-user-id'], toInt(bodyUser.id, null)),
    name: normalizeText(
      headers['x-user-name'] ||
        bodyUser.name ||
        bodyUser.username ||
        (req && req.body ? req.body.requested_by_name : null) ||
        'web'
    ),
    role: normalizeText(
      headers['x-user-role'] ||
        bodyUser.roles ||
        bodyUser.role ||
        (req && req.body ? req.body.requesterRole : null)
    ),
  };
}

function roleTokens(role) {
  return normalizeText(role)
    .toLowerCase()
    .split(/[,\s/;|]+/)
    .filter(Boolean);
}

function hasSupervisorRole(req) {
  return roleTokens(getRequestUser(req).role).some((role) => SUPERVISOR_ROLES.has(role));
}

function sendError(res, err, fallback = 'Request failed') {
  console.error('sowSchedule error:', err);
  res.status(err.status || 500).json({ error: err.message || fallback });
}

async function fetchShift(client, shiftId) {
  const result = await client.query(
    `SELECT id, shift_code, shift_name, start_time::text, end_time::text,
            crosses_midnight, default_capacity_hours, effective_date, is_default
     FROM public.shift_definition
     WHERE id = $1 AND is_active = true`,
    [shiftId]
  );

  if (result.rowCount === 0) {
    const error = new Error('shift_id not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

function resolvedShiftSql(dateParam = '$1') {
  return `
    SELECT *
    FROM (
      SELECT
        sd.id,
        sd.shift_code,
        sd.shift_name,
        sd.effective_date,
        sd.is_default,
        sd.start_time,
        sd.end_time,
        sd.crosses_midnight,
        sd.default_capacity_hours,
        sd.is_active,
        ROW_NUMBER() OVER (
          PARTITION BY sd.shift_code
          ORDER BY
            CASE
              WHEN sd.is_default = false AND sd.effective_date = ${dateParam}::date THEN 0
              WHEN sd.is_default = true THEN 1
              ELSE 2
            END,
            sd.id
        ) AS rn
      FROM public.shift_definition sd
      WHERE sd.is_active = true
        AND (
          sd.is_default = true
          OR sd.effective_date = ${dateParam}::date
        )
    ) resolved_shift
    WHERE rn = 1
  `;
}

async function fetchSowActivity(client, payload, required = true) {
  const sowId = toInt(payload.sow_id, null);
  let result;

  if (sowId) {
    result = await client.query('SELECT * FROM public.sow WHERE idsow = $1 LIMIT 1', [sowId]);
  } else {
    const productionOrder = normalizeText(payload.production_order || payload.order_no);
    const operationNo = toInt(payload.operation_no, null);
    if (!productionOrder || operationNo == null) {
      if (!required) return null;
      const error = new Error('sow_id or production_order + operation_no is required');
      error.status = 400;
      throw error;
    }

    result = await client.query(
      `SELECT *
       FROM public.sow
       WHERE ltrim(order_no, '0') = ltrim($1, '0')
         AND operation_no = $2
       ORDER BY idsow DESC
       LIMIT 1`,
      [productionOrder, operationNo]
    );
  }

  if (result.rowCount === 0 && required) {
    const error = new Error('SOW activity not found');
    error.status = 404;
    throw error;
  }

  return result.rows[0] || null;
}

async function isSubcontMarked(client, orderNo, operationNo) {
  const order = normalizeText(orderNo);
  const operation = toInt(operationNo, null);
  if (!order || operation == null) return false;

  await client.query('savepoint subcont_probe');
  try {
    const result = await client.query(
      `SELECT 1
         FROM public.sow_subcont_mark scm
        WHERE ltrim(scm.order_no, '0') = ltrim($1, '0')
          AND scm.operation_no = $2
          AND scm.unmarked_at IS NULL
        LIMIT 1`,
      [order, operation]
    );
    await client.query('release savepoint subcont_probe');
    return result.rowCount > 0;
  } catch (err) {
    await client.query('rollback to savepoint subcont_probe');
    if (err && err.code === '42P01') {
      console.warn(
        'sow_subcont_mark belum ada — lewati guard subcont (jalankan migrasi 20260803b)'
      );
      return false;
    }
    throw err;
  }
}

function resolveActivityFields(sow, payload) {
  return {
    sow_id: toInt(payload.sow_id, sow?.idsow || null),
    production_order:
      normalizeText(payload.production_order || payload.order_no || sow?.order_no) || null,
    operation_no: toInt(payload.operation_no, sow?.operation_no ?? null),
    sequence: toInt(payload.sequence, null),
    ssbr_id: normalizeText(payload.ssbr_id || sow?.ssbr_id) || null,
    workcenter: normalizeText(payload.workcenter || sow?.workcenter || sow?.wct_group) || null,
    original_planhours: toNumber(sow?.planhours, 0),
  };
}

async function getUsedNormalHours(
  client,
  { machineCode, scheduleDate, shiftId, excludeScheduleId = null }
) {
  const params = [machineCode, scheduleDate, shiftId];
  let excludeSql = '';
  if (excludeScheduleId) {
    params.push(excludeScheduleId);
    excludeSql = `AND id <> $${params.length}`;
  }

  const result = await client.query(
    `WITH unbatched AS (
       SELECT COALESCE(SUM(planned_hours), 0)::numeric AS hours
       FROM public.sow_schedule
       WHERE machine_code = $1
         AND schedule_date = $2
         AND shift_id = $3
         AND schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         AND is_overtime = false
         AND batch_id IS NULL
         ${excludeSql}
     ),
     batches AS (
       SELECT COALESCE(SUM(batch_capacity_hours), 0)::numeric AS hours
       FROM public.sow_schedule_batch
       WHERE machine_code = $1
         AND schedule_date = $2
         AND shift_id = $3
         AND batch_status <> 'CANCELLED'
     )
     SELECT (unbatched.hours + batches.hours)::numeric AS used_hours
     FROM unbatched, batches`,
    params
  );

  return toNumber(result.rows[0]?.used_hours, 0);
}

async function fetchBatch(client, batchId, required = false) {
  const id = toInt(batchId, null);
  if (!id) {
    if (!required) return null;
    const error = new Error('valid batch_id is required');
    error.status = 400;
    throw error;
  }

  const result = await client.query(
    `SELECT *
     FROM public.sow_schedule_batch
     WHERE id = $1
       AND batch_status <> 'CANCELLED'
     LIMIT 1`,
    [id]
  );

  if (result.rowCount === 0 && required) {
    const error = new Error('batch not found');
    error.status = 404;
    throw error;
  }

  return result.rows[0] || null;
}

async function getBatchUsedHours(client, batchId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(planned_hours), 0)::numeric AS used_hours
     FROM public.sow_schedule
     WHERE batch_id = $1
       AND schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')`,
    [batchId]
  );
  return toNumber(result.rows[0]?.used_hours, 0);
}

async function getCapacityForSlot(client, { machineCode, scheduleDate, shiftId }) {
  const result = await client.query(
    `SELECT
       sd.id AS shift_id,
       sd.default_capacity_hours,
       cap.capacity_type,
       cap.base_capacity_hours,
       cap.manpower_count,
       cap.capacity_multiplier,
       cap.total_capacity_hours,
       wc.workcenter_description AS machine_name,
       wc.workcenternew AS default_workcenter
     FROM public.shift_definition sd
     LEFT JOIN public.sow_machine_capacity cap
       ON cap.shift_id = sd.id
      AND cap.machine_code = $1
      AND cap.schedule_date = $2
      AND cap.is_active = true
     LEFT JOIN public.workcenter wc
       ON wc.machineid = $1
     WHERE sd.id = $3`,
    [machineCode, scheduleDate, shiftId]
  );

  if (result.rowCount === 0) {
    const error = new Error('shift_id not found');
    error.status = 404;
    throw error;
  }

  const row = result.rows[0];
  return {
    ...row,
    total_capacity_hours: toNumber(
      row.total_capacity_hours,
      toNumber(row.default_capacity_hours, 0)
    ),
  };
}

async function getNextQueueNo(client, { machineCode, scheduleDate, shiftId }) {
  const result = await client.query(
    `SELECT COALESCE(MAX(planned_queue_no), 0)::int + 1 AS next_queue
     FROM public.sow_schedule
     WHERE machine_code = $1
       AND schedule_date = $2
       AND shift_id = $3
       AND schedule_status <> 'CANCELLED'`,
    [machineCode, scheduleDate, shiftId]
  );
  return result.rows[0]?.next_queue || 1;
}

async function resolvedShiftsForDate(client, date) {
  const r = await client.query(
    `SELECT id, shift_code, shift_name, start_time::text AS start_time, end_time::text AS end_time,
            crosses_midnight, default_capacity_hours
     FROM (${resolvedShiftSql('$1')}) sd
     ORDER BY start_time`,
    [date]
  );
  return r.rows;
}

async function slotCapacityHours(client, machineCode, date, shift) {
  const cap = await getCapacityForSlot(client, {
    machineCode,
    scheduleDate: date,
    shiftId: shift.id,
  });
  return toNumber(
    cap.total_capacity_hours,
    toNumber(shift.default_capacity_hours, shiftDurationHours(shift))
  );
}

async function getTotalPlannedForActivity(client, fields) {
  const params = [fields.sow_id, fields.production_order, fields.operation_no];
  const result = await client.query(
    `WITH normal AS (
       SELECT COALESCE(SUM(planned_hours), 0) AS hours
       FROM public.sow_schedule
       WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         AND is_overtime = false
         AND (
           ($1::int IS NOT NULL AND sow_id = $1)
           OR ($2::text IS NOT NULL AND production_order = $2 AND operation_no = $3)
         )
     ),
     overtime AS (
       SELECT COALESCE(SUM(overtime_hours), 0) AS hours
       FROM public.sow_overtime_request
       WHERE request_status IN ('PENDING', 'APPROVED')
         AND (
           ($1::int IS NOT NULL AND sow_id = $1)
           OR ($2::text IS NOT NULL AND production_order = $2 AND operation_no = $3)
         )
     )
     SELECT (normal.hours + overtime.hours)::numeric AS total_hours
     FROM normal, overtime`,
    params
  );
  return toNumber(result.rows[0]?.total_hours, 0);
}

function warningForPlanhours(totalHours, originalPlanhours) {
  if (Number(originalPlanhours) > 0 && Number(totalHours) > Number(originalPlanhours)) {
    return { warning_flag: true, warning_message: PLAN_EXCEEDED_MESSAGE };
  }
  return { warning_flag: false, warning_message: null };
}

function calculateCapacityTotal(payload, shiftDefaultHours) {
  const capacityType = normalizeText(payload.capacity_type || 'STANDARD').toUpperCase();
  const baseCapacity = toNumber(
    payload.base_capacity_hours,
    toNumber(payload.total_capacity_hours, shiftDefaultHours)
  );
  const manpowerCount = Math.max(0, toNumber(payload.manpower_count, 1));
  const multiplier = Math.max(0, toNumber(payload.capacity_multiplier, 1));
  const explicitTotal = toNumber(payload.total_capacity_hours, NaN);

  if (capacityType === 'MANPOWER_BASED') return baseCapacity * manpowerCount;
  if (capacityType === 'BATCH_BASED') return baseCapacity * multiplier;
  if (capacityType === 'CUSTOM' && Number.isFinite(explicitTotal)) return explicitTotal;
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal;
  return baseCapacity;
}

function buildReportFilters(query, startParamIndex = 1) {
  const filters = [];
  const params = [];
  let index = startParamIndex;

  if (query.date_from) {
    params.push(normalizeDate(query.date_from, 'date_from'));
    filters.push(`schedule_date >= $${index++}`);
  }
  if (query.date_to) {
    params.push(normalizeDate(query.date_to, 'date_to'));
    filters.push(`schedule_date <= $${index++}`);
  }
  if (query.date) {
    params.push(normalizeDate(query.date, 'date'));
    filters.push(`schedule_date = $${index++}`);
  }
  if (query.machine_code) {
    params.push(normalizeText(query.machine_code));
    filters.push(`machine_code = $${index++}`);
  }
  if (query.shift_id) {
    params.push(toInt(query.shift_id));
    filters.push(`shift_id = $${index++}`);
  }
  if (query.production_order) {
    params.push(normalizeText(query.production_order));
    filters.push(`production_order = $${index++}`);
  }

  return { filters, params, nextIndex: index };
}

async function queryReportView(req, res, viewName, orderBy) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit);
    const offset = (page - 1) * limit;
    const { filters, params, nextIndex } = buildReportFilters(req.query);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.${viewName} ${where}`,
      params
    );

    const dataParams = [...params, limit, offset];
    const dataResult = await db.query(
      `SELECT *
       FROM public.${viewName}
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      dataParams
    );

    res.json({
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
}

exports.getShifts = async (req, res) => {
  const date = req.query.date ? normalizeDate(req.query.date, 'date') : todayDate();
  try {
    const result = await db.query(
      `SELECT id, shift_code, shift_name, effective_date,
              is_default, start_time::text, end_time::text,
              crosses_midnight, default_capacity_hours, is_active
       FROM (${resolvedShiftSql('$1')}) sd
       WHERE ($2::boolean IS false OR is_active = true)
       ORDER BY start_time, id`,
      [date, String(req.query.includeInactive || '').toLowerCase() !== 'true']
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getShiftRules = async (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
  const date = req.query.date ? normalizeDate(req.query.date, 'date') : null;
  const params = [];
  const filters = [];

  if (!includeInactive) filters.push('is_active = true');
  if (date) {
    params.push(date);
    filters.push(`(effective_date = $${params.length} OR is_default = true)`);
  }

  try {
    const result = await db.query(
      `SELECT id, shift_code, shift_name, effective_date, is_default,
              start_time::text, end_time::text, crosses_midnight,
              default_capacity_hours, is_active, created_at, updated_at
       FROM public.shift_definition
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY is_default DESC, COALESCE(effective_date, DATE '1900-01-01') DESC, start_time, shift_code`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.createShiftRule = async (req, res) => {
  const payload = req.body || {};
  const shiftCode = normalizeText(payload.shift_code).toUpperCase();
  const shiftName = normalizeText(payload.shift_name);
  const isDefault = toBool(payload.is_default, true);
  const ruleDate = isDefault
    ? null
    : normalizeDate(payload.effective_date || payload.date, 'effective_date');

  if (!shiftCode || !shiftName)
    return res.status(400).json({ error: 'shift_code and shift_name are required' });

  try {
    const result = await db.query(
      `INSERT INTO public.shift_definition (
         shift_code, shift_name, effective_date, is_default, start_time, end_time,
         crosses_midnight, default_capacity_hours, is_active
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, shift_code, shift_name, effective_date, is_default,
                 start_time::text, end_time::text, crosses_midnight,
                 default_capacity_hours, is_active`,
      [
        shiftCode,
        shiftName,
        ruleDate,
        isDefault,
        normalizeTime(payload.start_time, 'start_time'),
        normalizeTime(payload.end_time, 'end_time'),
        toBool(payload.crosses_midnight, false),
        toPositiveNumber(
          payload.default_capacity_hours ?? payload.capacity_hours,
          'default_capacity_hours'
        ),
        toBool(payload.is_active, true),
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.updateShiftRule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid shift id required' });

  const payload = req.body || {};
  const isDefault = toBool(payload.is_default, true);
  const ruleDate = isDefault
    ? null
    : normalizeDate(payload.effective_date || payload.date, 'effective_date');

  try {
    const current = await db.query(`SELECT is_default FROM public.shift_definition WHERE id = $1`, [
      id,
    ]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'shift rule not found' });
    if (Boolean(current.rows[0].is_default) !== isDefault) {
      const error = new Error(
        'cannot change rule type; create a new date override from the base shift instead'
      );
      error.status = 400;
      throw error;
    }

    const result = await db.query(
      `UPDATE public.shift_definition
       SET shift_code = $1,
           shift_name = $2,
           effective_date = $3,
           is_default = $4,
           start_time = $5,
           end_time = $6,
           crosses_midnight = $7,
           default_capacity_hours = $8,
           is_active = $9
       WHERE id = $10
       RETURNING id, shift_code, shift_name, effective_date, is_default,
                 start_time::text, end_time::text, crosses_midnight,
                 default_capacity_hours, is_active`,
      [
        normalizeText(payload.shift_code).toUpperCase(),
        normalizeText(payload.shift_name),
        ruleDate,
        isDefault,
        normalizeTime(payload.start_time, 'start_time'),
        normalizeTime(payload.end_time, 'end_time'),
        toBool(payload.crosses_midnight, false),
        toPositiveNumber(
          payload.default_capacity_hours ?? payload.capacity_hours,
          'default_capacity_hours'
        ),
        toBool(payload.is_active, true),
        id,
      ]
    );

    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.deleteShiftRule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid shift id required' });

  try {
    const result = await db.query(
      `UPDATE public.shift_definition
       SET is_active = false
       WHERE id = $1
       RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'shift rule not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getMachines = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         machineid AS machine_code,
         workcenter_description AS machine_name,
         workcenternew AS workcenter,
         workcenterot,
         workcenterold,
         groupname,
         categoryhours,
         position
       FROM public.workcenter
       WHERE machineid IS NOT NULL AND trim(machineid) <> ''
       ORDER BY position NULLS LAST, machineid ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getSowActivities = async (req, res) => {
  const search = normalizeText(req.query.search);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = clampLimit(req.query.limit);
  const offset = (page - 1) * limit;
  const params = [];
  const workcenterJoin = `
    LEFT JOIN LATERAL (
      SELECT w.machineid, w.workcenter_description
      FROM public.workcenter w
      WHERE w.machineid = s.workcenter
         OR w.workcenternew = s.workcenter
         OR w.workcenterold = s.workcenter
         OR w.workcenterot = s.workcenter
         OR w.workcenternew = s.wct_group
      ORDER BY w.position NULLS LAST, w.machineid
      LIMIT 1
    ) wc ON true
  `;

  let where = `
    WHERE s.order_no IS NOT NULL
      AND trim(s.order_no) <> ''
      AND s.operation_no IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.sow_subcont_mark scm
        WHERE ltrim(scm.order_no, '0') = ltrim(s.order_no, '0')
          AND scm.operation_no = s.operation_no
          AND scm.unmarked_at IS NULL
      )
  `;

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += `
      AND (
        lower(coalesce(s.order_no, '')) LIKE $${params.length}
        OR lower(coalesce(s.ssbr_id, '')) LIKE $${params.length}
        OR lower(coalesce(s.part_name, '')) LIKE $${params.length}
        OR lower(coalesce(s.operation_text, '')) LIKE $${params.length}
        OR lower(coalesce(s.workcenter, '')) LIKE $${params.length}
        OR lower(coalesce(s.operation_no::text, '')) LIKE $${params.length}
        OR lower(coalesce(wc.machineid, '')) LIKE $${params.length}
        OR lower(coalesce(wc.workcenter_description, '')) LIKE $${params.length}
      )
    `;
  }

  try {
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.sow s ${workcenterJoin} ${where}`,
      params
    );
    const queryParams = [...params, limit, offset];
    const result = await db.query(
      `WITH schedule_totals AS (
         SELECT
           sow_id,
           production_order,
           operation_no,
           SUM(planned_hours) FILTER (WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED') AND is_overtime = false) AS scheduled_hours,
           SUM(planned_hours) FILTER (WHERE schedule_status = 'UNPLANNED') AS unplanned_hours
         FROM public.sow_schedule
         WHERE schedule_status <> 'CANCELLED'
         GROUP BY sow_id, production_order, operation_no
       ),
       overtime_totals AS (
         SELECT
           sow_id,
           production_order,
           operation_no,
           SUM(overtime_hours) FILTER (WHERE request_status = 'PENDING') AS pending_overtime_hours,
           SUM(overtime_hours) FILTER (WHERE request_status = 'APPROVED') AS approved_overtime_hours
         FROM public.sow_overtime_request
         WHERE request_status <> 'CANCELLED'
         GROUP BY sow_id, production_order, operation_no
       )
       SELECT
         s.idsow,
         s.order_no,
         s.operation_no,
         s.ssbr_id,
         s.part_name,
         s.part_number,
         s.model,
         s.operation_text,
         s.wct_group,
         s.workcenter,
         wc.machineid AS machine_code,
         wc.workcenter_description AS machine_name,
         s.status,
         COALESCE(s.planhours, 0)::numeric AS planhours,
         COALESCE(st.scheduled_hours, st_key.scheduled_hours, 0)::numeric(10,2) AS scheduled_hours,
         COALESCE(st.unplanned_hours, st_key.unplanned_hours, 0)::numeric(10,2) AS unplanned_hours,
         COALESCE(ot.pending_overtime_hours, ot_key.pending_overtime_hours, 0)::numeric(10,2) AS pending_overtime_hours,
         COALESCE(ot.approved_overtime_hours, ot_key.approved_overtime_hours, 0)::numeric(10,2) AS approved_overtime_hours,
         GREATEST(
           COALESCE(s.planhours, 0)
           - COALESCE(st.scheduled_hours, st_key.scheduled_hours, 0)
           - COALESCE(ot.approved_overtime_hours, ot_key.approved_overtime_hours, 0),
           0
         )::numeric(10,2) AS remaining_hours
       FROM public.sow s
       LEFT JOIN schedule_totals st ON st.sow_id = s.idsow
       LEFT JOIN schedule_totals st_key
         ON st_key.production_order = s.order_no
        AND st_key.operation_no = s.operation_no
        AND st_key.sow_id IS NULL
       LEFT JOIN overtime_totals ot ON ot.sow_id = s.idsow
       LEFT JOIN overtime_totals ot_key
         ON ot_key.production_order = s.order_no
        AND ot_key.operation_no = s.operation_no
        AND ot_key.sow_id IS NULL
       ${workcenterJoin}
       ${where}
       ORDER BY s.idsow DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getBatches = async (req, res) => {
  const scheduleDate = req.query.date ? normalizeDate(req.query.date, 'date') : null;
  const machineCode = normalizeText(req.query.machine_code);
  const shiftId = toInt(req.query.shift_id, null);
  const params = [];
  const filters = ["b.batch_status <> 'CANCELLED'"];

  if (scheduleDate) {
    params.push(scheduleDate);
    filters.push(`b.schedule_date = $${params.length}`);
  }
  if (machineCode) {
    params.push(machineCode);
    filters.push(`b.machine_code = $${params.length}`);
  }
  if (shiftId) {
    params.push(shiftId);
    filters.push(`b.shift_id = $${params.length}`);
  }

  try {
    const result = await db.query(
      `SELECT
         b.*,
         sd.shift_name,
         COALESCE(SUM(sc.planned_hours) FILTER (
           WHERE sc.schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         ), 0)::numeric(10,2) AS used_inside_hours,
         b.batch_capacity_hours::numeric(10,2) AS max_operation_hours,
         COUNT(sc.id) FILTER (WHERE sc.schedule_status <> 'CANCELLED')::int AS operation_count
       FROM public.sow_schedule_batch b
       LEFT JOIN public.shift_definition sd ON sd.id = b.shift_id
       LEFT JOIN public.sow_schedule sc ON sc.batch_id = b.id
       WHERE ${filters.join(' AND ')}
       GROUP BY b.id, sd.shift_name
       ORDER BY b.created_at DESC, b.id DESC`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.createBatch = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const scheduleDate = normalizeDate(payload.schedule_date || payload.date, 'schedule_date');
  const shiftId = toInt(payload.shift_id, null);
  const batchCapacityHours = toPositiveNumber(
    payload.batch_capacity_hours ?? payload.capacity_hours,
    'batch_capacity_hours'
  );

  if (!machineCode || !shiftId) {
    return res.status(400).json({
      error: 'machine_code, schedule_date, shift_id, and batch_capacity_hours are required',
    });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await fetchShift(client, shiftId);
    const usedHours = await getUsedNormalHours(client, { machineCode, scheduleDate, shiftId });
    const capacity = await getCapacityForSlot(client, { machineCode, scheduleDate, shiftId });
    const availableHours = Math.max(toNumber(capacity.total_capacity_hours, 0) - usedHours, 0);

    if (batchCapacityHours > availableHours) {
      const error = new Error('batch capacity exceeds remaining machine capacity');
      error.status = 409;
      throw error;
    }

    const machine = await client.query(
      `SELECT workcenternew
       FROM public.workcenter
       WHERE machineid = $1
       LIMIT 1`,
      [machineCode]
    );
    const user = getRequestUser(req);
    const seqResult = await client.query(
      `SELECT COUNT(*)::int + 1 AS next_no
       FROM public.sow_schedule_batch
       WHERE machine_code = $1
         AND schedule_date = $2
         AND shift_id = $3`,
      [machineCode, scheduleDate, shiftId]
    );
    const dateCode = scheduleDate.replace(/-/g, '').slice(2);
    const sequenceCode = String(seqResult.rows[0]?.next_no || 1).padStart(2, '0');
    const uniqueSuffix = Math.random().toString(36).slice(2, 4).toUpperCase();
    const batchCode =
      normalizeText(payload.batch_code) ||
      `B-${dateCode}-${machineCode}-S${shiftId}-${sequenceCode}${uniqueSuffix}`;

    const result = await client.query(
      `INSERT INTO public.sow_schedule_batch (
         batch_code, machine_code, workcenter, schedule_date, shift_id,
         batch_capacity_hours, batch_status, remarks, created_by_user_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8)
       RETURNING *`,
      [
        batchCode,
        machineCode,
        normalizeText(payload.workcenter || machine.rows[0]?.workcenternew) || null,
        scheduleDate,
        shiftId,
        batchCapacityHours,
        normalizeText(payload.remarks) || null,
        user.id,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.deleteBatch = async (req, res) => {
  const batchId = toInt(req.params.id, null);
  if (!batchId) return res.status(400).json({ error: 'valid batch id required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const batch = await fetchBatch(client, batchId, true);

    await client.query(`UPDATE public.sow_schedule SET batch_id = NULL WHERE batch_id = $1`, [
      batchId,
    ]);

    await client.query(
      `UPDATE public.sow_schedule_batch SET batch_status = 'CANCELLED' WHERE id = $1`,
      [batchId]
    );
    await client.query('COMMIT');
    res.json({ data: { id: batchId, deleted: true } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.getManpower = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT snssb, full_name, employee_category
       FROM usernfc
       WHERE full_name IS NOT NULL AND full_name <> ''
       ORDER BY full_name`
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getSchedules = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = clampLimit(req.query.limit);
  const offset = (page - 1) * limit;
  const params = [];
  const filters = ['1=1'];

  if (req.query.date) {
    params.push(normalizeDate(req.query.date, 'date'));
    filters.push(`sc.schedule_date = $${params.length}`);
  }
  if (req.query.date_from) {
    params.push(normalizeDate(req.query.date_from, 'date_from'));
    filters.push(`sc.schedule_date >= $${params.length}`);
  }
  if (req.query.date_to) {
    params.push(normalizeDate(req.query.date_to, 'date_to'));
    filters.push(`sc.schedule_date <= $${params.length}`);
  }
  if (req.query.machine_code) {
    params.push(normalizeText(req.query.machine_code));
    filters.push(`sc.machine_code = $${params.length}`);
  }
  if (req.query.shift_id) {
    params.push(toInt(req.query.shift_id));
    filters.push(`sc.shift_id = $${params.length}`);
  }
  if (req.query.status) {
    params.push(normalizeText(req.query.status).toUpperCase());
    filters.push(`sc.schedule_status = $${params.length}`);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  try {
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.sow_schedule sc ${where}`,
      params
    );
    const dataParams = [...params, limit, offset];
    const result = await db.query(
      `SELECT
         sc.*,
         sd.shift_code,
         sd.shift_name,
         s.part_name,
         s.part_number,
         s.model,
         s.operation_text,
         s.planhours AS original_planhours,
         b.batch_code,
         b.batch_capacity_hours,
         b.batch_status
       FROM public.sow_schedule sc
       LEFT JOIN public.shift_definition sd ON sd.id = sc.shift_id
       LEFT JOIN public.sow s ON s.idsow = sc.sow_id
       LEFT JOIN public.sow_schedule_batch b ON b.id = sc.batch_id
       ${where}
       ORDER BY sc.schedule_date, sd.start_time, sc.machine_code, sc.planned_queue_no NULLS LAST, sc.id
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getPlannedSchedules = (req, res) => {
  req.query.status = req.query.status || 'PLANNED';
  return exports.getSchedules(req, res);
};

exports.getUnplannedSchedules = (req, res) => {
  req.query.status = 'UNPLANNED';
  return exports.getSchedules(req, res);
};

exports.getCapacity = async (req, res) => {
  const scheduleDate = normalizeDate(req.query.date || todayDate(), 'date');
  const params = [scheduleDate];
  const machineFilter = normalizeText(req.query.machine_code);
  const shiftFilter = toInt(req.query.shift_id, null);

  let machineWhere = '';
  if (machineFilter) {
    params.push(machineFilter);
    machineWhere = `AND w.machineid = $${params.length}`;
  }

  let shiftWhere = 'true';
  if (shiftFilter) {
    params.push(shiftFilter);
    shiftWhere += ` AND sd.id = $${params.length}`;
  }

  try {
    const result = await db.query(
      `WITH machines AS (
         SELECT
           w.machineid AS machine_code,
           w.workcenter_description AS machine_name,
           w.workcenternew AS workcenter,
           w.groupname,
           w.categoryhours,
           w.position
         FROM public.workcenter w
         WHERE w.machineid IS NOT NULL AND trim(w.machineid) <> ''
           ${machineWhere}
       ),
       sched AS (
         SELECT machine_code, shift_id,
           COALESCE(SUM(planned_hours) FILTER (
             WHERE schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
               AND is_overtime = false AND batch_id IS NULL), 0)::numeric AS unbatched_hours,
           COALESCE(SUM(planned_hours) FILTER (WHERE schedule_status = 'UNPLANNED'), 0)::numeric AS unplanned_hours
         FROM public.sow_schedule
         WHERE schedule_date = $1
         GROUP BY machine_code, shift_id
       ),
       bat AS (
         SELECT machine_code, shift_id, COALESCE(SUM(batch_capacity_hours), 0)::numeric AS batch_hours
         FROM public.sow_schedule_batch
         WHERE schedule_date = $1 AND batch_status <> 'CANCELLED'
         GROUP BY machine_code, shift_id
       ),
       ot AS (
         SELECT machine_code, shift_id,
           COALESCE(SUM(overtime_hours) FILTER (WHERE request_status = 'PENDING'), 0)::numeric AS pending_hours,
           COALESCE(SUM(overtime_hours) FILTER (WHERE request_status = 'APPROVED'), 0)::numeric AS approved_hours
         FROM public.sow_overtime_request
         WHERE overtime_date = $1 AND request_status <> 'CANCELLED'
         GROUP BY machine_code, shift_id
       )
       SELECT
         $1::date AS schedule_date,
         sd.id AS shift_id,
         sd.shift_code,
         sd.shift_name,
         m.machine_code,
         m.machine_name,
         COALESCE(cap.workcenter, m.workcenter) AS workcenter,
         COALESCE(cap.capacity_type, 'STANDARD') AS capacity_type,
         COALESCE(cap.base_capacity_hours, sd.default_capacity_hours)::numeric(10,2) AS base_capacity_hours,
         COALESCE(cap.manpower_count, 1)::numeric(10,2) AS manpower_count,
         COALESCE(cap.capacity_multiplier, 1)::numeric(10,2) AS capacity_multiplier,
         COALESCE(NULLIF(cap.total_capacity_hours, 0), sd.default_capacity_hours, 0)::numeric(10,2) AS total_capacity_hours,
         (COALESCE(sched.unbatched_hours, 0) + COALESCE(bat.batch_hours, 0))::numeric(10,2) AS used_normal_planned_hours,
         GREATEST(
           COALESCE(NULLIF(cap.total_capacity_hours, 0), sd.default_capacity_hours, 0)
           - (COALESCE(sched.unbatched_hours, 0) + COALESCE(bat.batch_hours, 0)),
           0
         )::numeric(10,2) AS remaining_capacity_hours,
         COALESCE(sched.unplanned_hours, 0)::numeric(10,2) AS unplanned_hours,
         COALESCE(ot.pending_hours, 0)::numeric(10,2) AS pending_overtime_hours,
         COALESCE(ot.approved_hours, 0)::numeric(10,2) AS approved_overtime_hours,
         cap.remarks,
         m.groupname,
         m.categoryhours
       FROM machines m
       CROSS JOIN (${resolvedShiftSql('$1')}) sd
       LEFT JOIN public.sow_machine_capacity cap
         ON cap.machine_code = m.machine_code
        AND cap.schedule_date = $1
        AND cap.shift_id = sd.id
        AND cap.is_active = true
       LEFT JOIN sched ON sched.machine_code = m.machine_code AND sched.shift_id = sd.id
       LEFT JOIN bat ON bat.machine_code = m.machine_code AND bat.shift_id = sd.id
       LEFT JOIN ot ON ot.machine_code = m.machine_code AND ot.shift_id = sd.id
       WHERE ${shiftWhere}
       ORDER BY m.position NULLS LAST, m.machine_code, sd.start_time`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.upsertCapacity = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const scheduleDate = normalizeDate(payload.schedule_date || payload.date, 'schedule_date');
  const shiftId = toInt(payload.shift_id, null);

  if (!machineCode || !shiftId) {
    return res
      .status(400)
      .json({ error: 'machine_code, schedule_date, and shift_id are required' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const shift = await fetchShift(client, shiftId);
    const totalCapacity = calculateCapacityTotal(
      payload,
      toNumber(shift.default_capacity_hours, 8)
    );
    const capacityType = normalizeText(payload.capacity_type || 'STANDARD').toUpperCase();

    const machine = await client.query(
      `SELECT workcenter_description, workcenternew
       FROM public.workcenter
       WHERE machineid = $1
       LIMIT 1`,
      [machineCode]
    );

    const result = await client.query(
      `INSERT INTO public.sow_machine_capacity (
         machine_code,
         machine_name,
         workcenter,
         schedule_date,
         shift_id,
         capacity_type,
         base_capacity_hours,
         manpower_count,
         capacity_multiplier,
         total_capacity_hours,
         remarks,
         is_active
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       ON CONFLICT (machine_code, schedule_date, shift_id)
       DO UPDATE SET
         machine_name = EXCLUDED.machine_name,
         workcenter = EXCLUDED.workcenter,
         capacity_type = EXCLUDED.capacity_type,
         base_capacity_hours = EXCLUDED.base_capacity_hours,
         manpower_count = EXCLUDED.manpower_count,
         capacity_multiplier = EXCLUDED.capacity_multiplier,
         total_capacity_hours = EXCLUDED.total_capacity_hours,
         remarks = EXCLUDED.remarks,
         is_active = true
       RETURNING *`,
      [
        machineCode,
        normalizeText(payload.machine_name || machine.rows[0]?.workcenter_description) || null,
        normalizeText(payload.workcenter || machine.rows[0]?.workcenternew) || null,
        scheduleDate,
        shiftId,
        capacityType,
        toNumber(
          payload.base_capacity_hours,
          toNumber(payload.total_capacity_hours, shift.default_capacity_hours)
        ),
        toNumber(payload.manpower_count, 1),
        toNumber(payload.capacity_multiplier, 1),
        totalCapacity,
        normalizeText(payload.remarks) || null,
      ]
    );

    await client.query('COMMIT');
    res.json({ data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.createSchedule = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const scheduleDate = normalizeDate(payload.schedule_date || payload.date, 'schedule_date');
  const shiftId = toInt(payload.shift_id, null);
  const requestedHours = toPositiveNumber(payload.planned_hours ?? payload.hours, 'planned_hours');

  if (!machineCode || !shiftId) {
    return res
      .status(400)
      .json({ error: 'machine_code, schedule_date, shift_id, and planned_hours are required' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const shift = await fetchShift(client, shiftId);
    const sow = await fetchSowActivity(
      client,
      payload,
      normalizeText(payload.schedule_source_type || 'SOW').toUpperCase() !== 'MANUAL'
    );
    const fields = resolveActivityFields(sow, payload);
    if (!fields.production_order || fields.operation_no == null) {
      const error = new Error('production_order and operation_no are required');
      error.status = 400;
      throw error;
    }

    if (await isSubcontMarked(client, fields.production_order, fields.operation_no)) {
      const error = new Error(
        'Operation is marked subcontracted — cannot be scheduled on internal machine capacity'
      );
      error.status = 409;
      throw error;
    }

    const capacity = await getCapacityForSlot(client, { machineCode, scheduleDate, shiftId });
    const batch = await fetchBatch(client, payload.batch_id, false);
    if (batch) {
      if (
        batch.machine_code !== machineCode ||
        String(batch.schedule_date).slice(0, 10) !== scheduleDate ||
        Number(batch.shift_id) !== Number(shiftId)
      ) {
        const error = new Error('batch must match machine, schedule_date, and shift_id');
        error.status = 400;
        throw error;
      }

      if (fields.production_order) {
        await client.query(
          `DELETE FROM public.sow_schedule
           WHERE batch_id = $1
             AND production_order = $2
             AND schedule_status IN ('PLANNED', 'PARTIAL')`,
          [batch.id, fields.production_order]
        );
      }
    }
    const usedHours = await getUsedNormalHours(client, { machineCode, scheduleDate, shiftId });
    const availableHours = Math.max(toNumber(capacity.total_capacity_hours, 0) - usedHours, 0);
    const batchMaxOperationHours = batch ? toNumber(batch.batch_capacity_hours, 0) : null;
    const plannedHours = batch
      ? Math.min(requestedHours, batchMaxOperationHours)
      : Math.min(requestedHours, availableHours);
    const unplannedHours = Math.max(requestedHours - plannedHours, 0);
    const inserted = [];
    const user = getRequestUser(req);
    const queueNo = toInt(
      payload.planned_queue_no,
      await getNextQueueNo(client, { machineCode, scheduleDate, shiftId })
    );
    const totalAfter = await getTotalPlannedForActivity(client, fields);
    const warning = warningForPlanhours(
      totalAfter + plannedHours + unplannedHours,
      fields.original_planhours
    );

    if (plannedHours > 0) {
      const shiftWindow = buildShiftWindow(scheduleDate, shift);
      const offset = Math.min(
        batch ? Math.max(usedHours - toNumber(batch.batch_capacity_hours, 0), 0) : usedHours,
        shiftWindow.hours
      );
      const plannedStart = addHours(shiftWindow.start, offset);
      const plannedEnd = addHours(plannedStart, plannedHours);
      const status = unplannedHours > 0 ? 'PARTIAL' : 'PLANNED';

      const result = await client.query(
        `INSERT INTO public.sow_schedule (
           sow_id, production_order, operation_no, sequence, ssbr_id, workcenter,
           machine_code, schedule_date, shift_id, planned_start_datetime, planned_end_datetime,
           planned_hours, planned_queue_no, priority_no, schedule_status, schedule_source_type,
           batch_id, warning_flag, warning_message, remarks, created_by_user_id, created_by_name
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [
          fields.sow_id,
          fields.production_order,
          fields.operation_no,
          fields.sequence,
          fields.ssbr_id,
          normalizeText(payload.workcenter || fields.workcenter || capacity.default_workcenter) ||
            null,
          machineCode,
          scheduleDate,
          shiftId,
          plannedStart,
          plannedEnd,
          plannedHours,
          queueNo,
          toInt(payload.priority_no, queueNo),
          status,
          normalizeText(payload.schedule_source_type || 'SOW').toUpperCase() === 'MANUAL'
            ? 'MANUAL'
            : 'SOW',
          batch?.id || null,
          warning.warning_flag,
          warning.warning_message,
          normalizeText(payload.remarks) || null,
          user.id,
          user.name,
        ]
      );
      inserted.push(result.rows[0]);
    }

    if (unplannedHours > 0) {
      const result = await client.query(
        `INSERT INTO public.sow_schedule (
           sow_id, production_order, operation_no, sequence, ssbr_id, workcenter,
           machine_code, schedule_date, shift_id, planned_hours, planned_queue_no,
           priority_no, schedule_status, schedule_source_type, warning_flag,
           warning_message, remarks, created_by_user_id, created_by_name
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'UNPLANNED',$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          fields.sow_id,
          fields.production_order,
          fields.operation_no,
          fields.sequence,
          fields.ssbr_id,
          normalizeText(payload.workcenter || fields.workcenter || capacity.default_workcenter) ||
            null,
          machineCode,
          scheduleDate,
          shiftId,
          unplannedHours,
          queueNo + inserted.length,
          toInt(payload.priority_no, queueNo) + inserted.length,
          normalizeText(payload.schedule_source_type || 'SOW').toUpperCase() === 'MANUAL'
            ? 'MANUAL'
            : 'SOW',
          warning.warning_flag,
          warning.warning_message || 'Over.',
          normalizeText(payload.remarks) || null,
          user.id,
          user.name,
        ]
      );
      inserted.push(result.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      data: inserted,
      capacity: {
        total_capacity_hours: capacity.total_capacity_hours,
        used_normal_planned_hours: usedHours,
        available_before_save: availableHours,
        batch_max_operation_hours: batchMaxOperationHours,
      },
      warning,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.reorderSchedule = async (req, res) => {
  const id = toInt(req.params.id, null);
  const direction = String((req.body || {}).direction || '').toLowerCase();
  if (!id) return res.status(400).json({ error: 'valid schedule id is required' });
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: "direction must be 'up' or 'down'" });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT * FROM public.sow_schedule WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'schedule not found' });
    }
    const row = cur.rows[0];
    if (row.is_overtime) {
      const error = new Error('overtime schedules cannot be reordered');
      error.status = 400;
      throw error;
    }
    const machineCode = row.machine_code;
    const scheduleDate = normalizeDate(row.schedule_date, 'schedule_date');
    const shiftId = row.shift_id;

    const slot = await client.query(
      `SELECT * FROM public.sow_schedule
       WHERE machine_code = $1 AND schedule_date = $2 AND shift_id = $3
         AND schedule_status IN ('PLANNED', 'PARTIAL', 'COMPLETED')
         AND COALESCE(is_overtime, false) = false
       ORDER BY planned_queue_no NULLS LAST, id
       FOR UPDATE`,
      [machineCode, scheduleDate, shiftId]
    );
    const rows = slot.rows;
    const idx = rows.findIndex((r) => Number(r.id) === Number(id));
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= rows.length) {
      await client.query('ROLLBACK');
      return res.json({ data: rows, changed: false });
    }
    [rows[idx], rows[target]] = [rows[target], rows[idx]];

    const shifts = await resolvedShiftsForDate(client, scheduleDate);
    let si = Math.max(
      0,
      shifts.findIndex((s) => Number(s.id) === Number(shiftId))
    );
    let curShift = shifts[si] || (await fetchShift(client, shiftId));
    let window = buildShiftWindow(scheduleDate, curShift);
    let cap = await slotCapacityHours(client, machineCode, scheduleDate, curShift);
    let used = 0;
    let queue = 0;
    const updated = [];
    for (const r of rows) {
      const hrs = toNumber(r.planned_hours, 0);

      while (used > 0 && used + hrs > cap + 1e-6 && si < shifts.length - 1) {
        si += 1;
        curShift = shifts[si];
        window = buildShiftWindow(scheduleDate, curShift);
        cap = await slotCapacityHours(client, machineCode, scheduleDate, curShift);
        used = await getUsedNormalHours(client, {
          machineCode,
          scheduleDate,
          shiftId: curShift.id,
        });
        queue =
          (await getNextQueueNo(client, { machineCode, scheduleDate, shiftId: curShift.id })) - 1;
      }
      const start = addHours(window.start, used);
      const end = addHours(start, hrs);
      queue += 1;
      const u = await client.query(
        `UPDATE public.sow_schedule
         SET shift_id = $1, planned_queue_no = $2, priority_no = $2, planned_start_datetime = $3, planned_end_datetime = $4
         WHERE id = $5 RETURNING *`,
        [curShift.id, queue, start, end, r.id]
      );
      updated.push(u.rows[0]);
      used += hrs;
    }

    await client.query('COMMIT');
    res.json({ data: updated, changed: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.updateSchedule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid schedule id is required' });

  const allowed = [
    'machine_code',
    'workcenter',
    'schedule_date',
    'shift_id',
    'planned_start_datetime',
    'planned_end_datetime',
    'planned_hours',
    'planned_queue_no',
    'priority_no',
    'schedule_status',
    'batch_id',
    'remarks',
  ];

  const sets = [];
  const params = [];
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      params.push(req.body[field] === '' ? null : req.body[field]);
      sets.push(`${field} = $${params.length}`);
    }
  });

  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });

  params.push(id);
  try {
    const result = await db.query(
      `UPDATE public.sow_schedule
       SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'schedule not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.rescheduleSchedule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid schedule id is required' });
  const payload = req.body || {};

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM public.sow_schedule WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'schedule not found' });
    }
    const row = existing.rows[0];
    if (String(row.schedule_status).toUpperCase() === 'CANCELLED') {
      const error = new Error('cannot reschedule a cancelled schedule');
      error.status = 400;
      throw error;
    }
    if (row.is_overtime) {
      const error = new Error('overtime schedules cannot be rescheduled on the timeline');
      error.status = 400;
      throw error;
    }

    const machineCode = normalizeText(payload.machine_code) || row.machine_code;
    const scheduleDate = normalizeDate(payload.schedule_date || row.schedule_date, 'schedule_date');
    let shiftId = toInt(payload.shift_id, row.shift_id);
    const plannedHours = toNumber(row.planned_hours, 0);
    let shift = await fetchShift(client, shiftId);

    let batchId = null;
    if (Object.prototype.hasOwnProperty.call(payload, 'batch_id') && payload.batch_id) {
      const batch = await fetchBatch(client, payload.batch_id, false);
      if (batch) {
        if (
          batch.machine_code !== machineCode ||
          String(batch.schedule_date).slice(0, 10) !== scheduleDate ||
          Number(batch.shift_id) !== Number(shiftId)
        ) {
          const error = new Error('batch must match machine, schedule_date, and shift_id');
          error.status = 400;
          throw error;
        }
        batchId = batch.id;
      }
    }

    let shiftWindow = buildShiftWindow(scheduleDate, shift);
    let usedHours = await getUsedNormalHours(client, {
      machineCode,
      scheduleDate,
      shiftId,
      excludeScheduleId: id,
    });
    if (!batchId) {
      const shifts = await resolvedShiftsForDate(client, scheduleDate);
      let si = shifts.findIndex((s) => Number(s.id) === Number(shiftId));
      let cap = await slotCapacityHours(client, machineCode, scheduleDate, shift);
      while (
        usedHours > 0 &&
        usedHours + plannedHours > cap + 1e-6 &&
        si >= 0 &&
        si < shifts.length - 1
      ) {
        si += 1;
        shift = shifts[si];
        shiftId = shift.id;
        shiftWindow = buildShiftWindow(scheduleDate, shift);
        cap = await slotCapacityHours(client, machineCode, scheduleDate, shift);
        usedHours = await getUsedNormalHours(client, {
          machineCode,
          scheduleDate,
          shiftId,
          excludeScheduleId: id,
        });
      }
    }
    const offset = Math.max(usedHours, 0);
    const plannedStart = addHours(shiftWindow.start, offset);
    const plannedEnd = addHours(plannedStart, plannedHours);
    const queueNo = batchId
      ? row.planned_queue_no
      : await getNextQueueNo(client, { machineCode, scheduleDate, shiftId });

    const wc = await client.query(
      `SELECT workcenternew FROM public.workcenter WHERE machineid = $1 LIMIT 1`,
      [machineCode]
    );
    const workcenter =
      normalizeText(payload.workcenter) || wc.rows[0]?.workcenternew || row.workcenter || null;

    const updated = await client.query(
      `UPDATE public.sow_schedule
       SET machine_code = $1, workcenter = $2, schedule_date = $3, shift_id = $4,
           planned_start_datetime = $5, planned_end_datetime = $6,
           planned_queue_no = $7, priority_no = $7, batch_id = $8
       WHERE id = $9
       RETURNING *`,
      [
        machineCode,
        workcenter,
        scheduleDate,
        shiftId,
        plannedStart,
        plannedEnd,
        queueNo,
        batchId,
        id,
      ]
    );

    await client.query('COMMIT');
    res.json({ data: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.deleteSchedule = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid schedule id is required' });

  try {
    const result = await db.query('DELETE FROM public.sow_schedule WHERE id = $1 RETURNING id', [
      id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'schedule not found' });
    res.json({ deleted: true });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getOvertime = async (req, res) => {
  req.query.date_from = req.query.date_from || req.query.from;
  req.query.date_to = req.query.date_to || req.query.to;
  return queryReportView(
    req,
    res,
    'vw_sow_overtime_summary',
    'overtime_date DESC, created_at DESC, id DESC'
  );
};

exports.createOvertime = async (req, res) => {
  const payload = req.body || {};
  const machineCode = normalizeText(payload.machine_code);
  const overtimeDate = normalizeDate(payload.overtime_date || payload.date, 'overtime_date');
  const shiftId = toInt(payload.shift_id, null);
  const startTime = normalizeTime(payload.start_time || payload.overtime_start_time, 'start_time');
  const endTime = normalizeTime(payload.end_time || payload.overtime_end_time, 'end_time');

  if (!machineCode || !shiftId) {
    return res.status(400).json({
      error: 'machine_code, overtime_date, shift_id, start_time, and end_time are required',
    });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await fetchShift(client, shiftId);
    const sow = await fetchSowActivity(client, payload, true);
    const fields = resolveActivityFields(sow, payload);
    const window = buildOvertimeWindow(overtimeDate, startTime, endTime);
    const totalAfter = await getTotalPlannedForActivity(client, fields);
    const warning = warningForPlanhours(totalAfter + window.hours, fields.original_planhours);
    const user = getRequestUser(req);

    const result = await client.query(
      `INSERT INTO public.sow_overtime_request (
         sow_id, production_order, operation_no, sequence, ssbr_id, workcenter, machine_code,
         overtime_date, shift_id, overtime_start_datetime, overtime_end_datetime, overtime_hours,
         note, request_status, requested_by_user_id, requested_by_name, warning_flag, warning_message
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING',$14,$15,$16,$17)
       RETURNING *`,
      [
        fields.sow_id,
        fields.production_order,
        fields.operation_no,
        fields.sequence,
        fields.ssbr_id,
        normalizeText(payload.workcenter || fields.workcenter) || null,
        machineCode,
        overtimeDate,
        shiftId,
        window.start,
        window.end,
        window.hours,
        normalizeText(payload.note || payload.reason) || null,
        user.id,
        user.name,
        warning.warning_flag,
        warning.warning_message,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ data: result.rows[0], warning });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.updateOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid overtime id is required' });

  const allowed = ['note', 'request_status', 'machine_code', 'workcenter'];
  const sets = [];
  const params = [];
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      params.push(req.body[field] === '' ? null : req.body[field]);
      sets.push(`${field} = $${params.length}`);
    }
  });
  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });

  params.push(id);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET ${sets.join(', ')}
       WHERE id = $${params.length}
         AND request_status = 'PENDING'
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'pending overtime not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.approveOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid overtime id is required' });
  if (!hasSupervisorRole(req))
    return res.status(403).json({ error: 'Only supervisor users can approve overtime' });

  const user = getRequestUser(req);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET request_status = 'APPROVED',
           approved_by_user_id = $2,
           approved_by_name = $3,
           approved_at = now(),
           rejected_by_user_id = NULL,
           rejected_by_name = NULL,
           rejected_at = NULL,
           rejection_note = NULL
       WHERE id = $1
         AND request_status = 'PENDING'
       RETURNING *`,
      [id, user.id, user.name]
    );
    if (result.rowCount === 0)
      return res.status(409).json({ error: 'overtime is not pending or not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.rejectOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid overtime id is required' });
  if (!hasSupervisorRole(req))
    return res.status(403).json({ error: 'Only supervisor users can reject overtime' });

  const user = getRequestUser(req);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET request_status = 'REJECTED',
           rejected_by_user_id = $2,
           rejected_by_name = $3,
           rejected_at = now(),
           rejection_note = $4
       WHERE id = $1
         AND request_status = 'PENDING'
       RETURNING *`,
      [id, user.id, user.name, normalizeText(req.body?.rejection_note || req.body?.note) || null]
    );
    if (result.rowCount === 0)
      return res.status(409).json({ error: 'overtime is not pending or not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.assignManpower = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid overtime id is required' });
  const { assigned_to, assigned_to_name } = req.body || {};
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to is required' });

  const user = getRequestUser(req);
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET assigned_to = $2,
           assigned_to_name = $3,
           assigned_by = $4
       WHERE id = $1
       RETURNING *`,
      [id, assigned_to, assigned_to_name || null, user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'overtime not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    sendError(res, err);
  }
};

exports.deleteOvertime = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid overtime id is required' });
  try {
    const result = await db.query(
      `UPDATE public.sow_overtime_request
       SET request_status = 'CANCELLED'
       WHERE id = $1
         AND request_status IN ('PENDING', 'APPROVED')
       RETURNING *`,
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ error: 'overtime not found or already processed' });
    res.json({ data: { id, deleted: true } });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getCapacityReport = (req, res) =>
  queryReportView(
    req,
    res,
    'vw_sow_schedule_capacity',
    'schedule_date DESC, shift_id, machine_code'
  );

exports.getPlanVsActualReport = (req, res) =>
  queryReportView(
    req,
    res,
    'vw_sow_plan_vs_actual_hours',
    'schedule_date DESC, shift_id NULLS LAST, machine_code, production_order, operation_no'
  );

exports.getPlannedQueueVsActualQueueReport = (req, res) =>
  queryReportView(
    req,
    res,
    'vw_sow_planned_queue_vs_actual_queue',
    'schedule_date DESC, shift_id NULLS LAST, machine_code, planned_queue_no NULLS LAST, actual_queue_datetime NULLS LAST'
  );

exports.getOvertimeSummaryReport = (req, res) =>
  queryReportView(
    req,
    res,
    'vw_sow_overtime_summary',
    'overtime_date DESC, shift_id NULLS LAST, machine_code, created_at DESC'
  );

const MANUAL_FLAGS = new Set(['dilewati', 'nyangkut']);

function deviationFlagsFor(effectiveStatus, row = {}) {
  const flags = [];
  if (effectiveStatus === 'dilewati') flags.push('skipped');
  if (effectiveStatus === 'nyangkut') flags.push('blocked');
  if (row.comparison_status === 'MACHINE_CHANGED') flags.push('machine');
  if (
    row.queue_variance !== null &&
    row.queue_variance !== undefined &&
    Number(row.queue_variance) !== 0
  ) {
    flags.push('sequence');
  }
  return flags;
}

async function fetchEffectiveRow(
  client,
  { productionOrder, operationNo, machineCode, statusDate }
) {
  const result = await client.query(
    `SELECT effective_status, comparison_status, queue_variance
     FROM public.vw_sow_operation_actual
     WHERE production_order = $1 AND operation_no = $2 AND machine_code = $3 AND schedule_date = $4
     LIMIT 1`,
    [productionOrder, operationNo, machineCode, statusDate]
  );
  return result.rows[0] || null;
}

function resolveVerifier(req) {
  const user = getRequestUser(req);
  if (user.id === null || user.id === undefined) {
    const error = new Error('verifier identity is required (missing x-user-id header)');
    error.status = 400;
    throw error;
  }
  return user;
}

exports.getOperationStatus = async (req, res) => {
  const scheduleDate = req.query.date ? normalizeDate(req.query.date, 'date') : todayDate();
  const productionOrder = normalizeText(req.query.production_order);
  const machineCode = normalizeText(req.query.machine_code);
  const params = [scheduleDate];
  const filters = ['schedule_date = $1'];
  if (productionOrder) {
    params.push(productionOrder);
    filters.push(`production_order = $${params.length}`);
  }
  if (machineCode) {
    params.push(machineCode);
    filters.push(`machine_code = $${params.length}`);
  }
  try {
    const result = await db.query(
      `SELECT *
       FROM public.vw_sow_operation_actual
       WHERE ${filters.join(' AND ')}
       ORDER BY machine_code, production_order, operation_no`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.upsertOperationStatus = async (req, res) => {
  const payload = req.body || {};
  const productionOrder = normalizeText(payload.production_order);
  const operationNo = toInt(payload.operation_no, null);

  const machineCode = normalizeText(payload.machine_code || payload.machineid);
  const manualFlag = normalizeText(payload.manual_flag).toLowerCase();
  const statusDate = payload.status_date
    ? normalizeDate(payload.status_date, 'status_date')
    : todayDate();
  const blockedReason = normalizeText(payload.blocked_reason) || null;
  const blockedByMachine =
    normalizeText(payload.blocked_by_machine_code || payload.blocked_by_machine_id) || null;
  const blockedByOrder = normalizeText(payload.blocked_by_order) || null;
  const overrideNote = normalizeText(payload.override_note) || null;
  const note = normalizeText(payload.note) || null;

  if (!productionOrder || operationNo === null || !machineCode) {
    return res
      .status(400)
      .json({ error: 'production_order, operation_no and machine_code are required' });
  }
  if (!MANUAL_FLAGS.has(manualFlag)) {
    return res.status(400).json({ error: "manual_flag must be 'dilewati' or 'nyangkut'" });
  }
  if (manualFlag === 'nyangkut' && !blockedReason) {
    return res
      .status(400)
      .json({ error: "blocked_reason is required when manual_flag is 'nyangkut'" });
  }

  let user;
  try {
    user = resolveVerifier(req);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const beforeRow = await fetchEffectiveRow(client, {
      productionOrder,
      operationNo,
      machineCode,
      statusDate,
    });
    let before;
    if (beforeRow) {
      before = beforeRow.effective_status || null;
    } else {
      const inRouting = await client.query(
        `SELECT 1 FROM public.sow WHERE ltrim(order_no,'0') = ltrim($1,'0') AND operation_no = $2 LIMIT 1`,
        [productionOrder, operationNo]
      );
      if (inRouting.rowCount === 0) {
        const error = new Error(
          'operation is not in the order routing (sow) — cannot mark an unknown operation'
        );
        error.status = 400;
        throw error;
      }
      before = 'belum';
    }

    const upsert = await client.query(
      `INSERT INTO public.sow_operation_status (
         production_order, operation_no, machine_code, manual_flag, blocked_reason,
         blocked_by_machine_code, blocked_by_order, override_note,
         status_date, updated_by, updated_by_name, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (production_order, operation_no, machine_code, status_date)
       DO UPDATE SET
         manual_flag = EXCLUDED.manual_flag,
         blocked_reason = EXCLUDED.blocked_reason,
         blocked_by_machine_code = EXCLUDED.blocked_by_machine_code,
         blocked_by_order = EXCLUDED.blocked_by_order,
         override_note = EXCLUDED.override_note,
         updated_by = EXCLUDED.updated_by,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at = now()
       RETURNING *`,
      [
        productionOrder,
        operationNo,
        machineCode,
        manualFlag,
        blockedReason,
        blockedByMachine,
        blockedByOrder,
        overrideNote,
        statusDate,
        user.id,
        user.name,
      ]
    );

    const afterRow = await fetchEffectiveRow(client, {
      productionOrder,
      operationNo,
      machineCode,
      statusDate,
    });
    const after = afterRow?.effective_status || manualFlag;
    const flags = deviationFlagsFor(after, afterRow || {});

    await client.query(
      `INSERT INTO public.sow_verification_log (
         verification_date, production_order, operation_no, machine_code,
         status_before, status_after, deviation_flags,
         verified_by, verified_by_name, note
       )
       VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [
        productionOrder,
        operationNo,
        machineCode,
        before,
        after,
        JSON.stringify(flags),
        user.id,
        user.name,
        note,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ data: upsert.rows[0], effective_status: after, deviation_flags: flags });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.clearOperationStatus = async (req, res) => {
  const id = toInt(req.params.id, null);
  if (!id) return res.status(400).json({ error: 'valid operation status id required' });

  let user;
  try {
    user = resolveVerifier(req);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM public.sow_operation_status WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (existing.rowCount === 0) {
      const error = new Error('operation status not found');
      error.status = 404;
      throw error;
    }
    const row = existing.rows[0];
    const key = {
      productionOrder: row.production_order,
      operationNo: row.operation_no,
      machineCode: row.machine_code,
      statusDate: row.status_date,
    };
    const beforeRow = await fetchEffectiveRow(client, key);
    const before = beforeRow?.effective_status || null;

    await client.query(`DELETE FROM public.sow_operation_status WHERE id = $1`, [id]);

    const afterRow = await fetchEffectiveRow(client, key);
    const after = afterRow?.effective_status || null;

    await client.query(
      `INSERT INTO public.sow_verification_log (
         verification_date, production_order, operation_no, machine_code,
         status_before, status_after, deviation_flags,
         verified_by, verified_by_name, note
       )
       VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,'[]'::jsonb,$6,$7,$8)`,
      [
        row.production_order,
        row.operation_no,
        row.machine_code,
        before,
        after,
        user.id,
        user.name,
        'cleared manual status',
      ]
    );

    await client.query('COMMIT');
    res.json({ data: { id }, effective_status: after });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.getVerificationLog = async (req, res) => {
  const productionOrder = normalizeText(req.query.production_order);
  const verificationDate = req.query.date ? normalizeDate(req.query.date, 'date') : null;
  const limit = clampLimit(req.query.limit);
  const params = [];
  const filters = [];
  if (verificationDate) {
    params.push(verificationDate);
    filters.push(`verification_date = $${params.length}`);
  }
  if (productionOrder) {
    params.push(productionOrder);
    filters.push(`production_order = $${params.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit);
  try {
    const result = await db.query(
      `SELECT *
       FROM public.sow_verification_log
       ${where}
       ORDER BY verified_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getOrderProgress = async (req, res) => {
  const requested = req.query.date ? normalizeDate(req.query.date, 'date') : todayDate();
  const scope = normalizeText(req.query.scope).toLowerCase();
  try {
    if (scope === 'all') {
      const all = await db.query(
        `SELECT p.*
         FROM public.v_sow_order_progress p
         WHERE p.done_ops < p.total_ops
         ORDER BY CASE p.status_color WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END,
                  p.production_order`
      );
      return res.json({
        date: null,
        requested_date: requested,
        fallback: false,
        scope: 'all',
        data: all.rows,
      });
    }
    const activeCheck = await db.query(
      `SELECT EXISTS(SELECT 1 FROM public.vw_sow_operation_actual WHERE schedule_date = $1) AS has_data`,
      [requested]
    );
    let effectiveDate = requested;
    let fallback = false;
    if (!activeCheck.rows[0]?.has_data) {
      const latest = await db.query(
        `SELECT max(schedule_date)::text AS d FROM public.vw_sow_operation_actual`
      );
      if (latest.rows[0]?.d) {
        effectiveDate = latest.rows[0].d;
        fallback = effectiveDate !== requested;
      }
    }
    const result = await db.query(
      `SELECT p.*
       FROM public.v_sow_order_progress p
       WHERE p.production_order IN (
         SELECT DISTINCT production_order
         FROM public.vw_sow_operation_actual
         WHERE schedule_date = $1
       )
       ORDER BY CASE p.status_color WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END,
                p.production_order`,
      [effectiveDate]
    );
    res.json({
      date: effectiveDate,
      requested_date: requested,
      fallback,
      scope: 'date',
      data: result.rows,
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getOrderOperations = async (req, res) => {
  const productionOrder = normalizeText(req.query.production_order);
  if (!productionOrder) {
    return res.status(400).json({ error: 'production_order is required' });
  }
  try {
    const summaryRes = await db.query(
      `SELECT * FROM public.v_sow_order_progress WHERE production_order = $1`,
      [productionOrder]
    );
    const summary = summaryRes.rows[0] || null;
    const opsRes = await db.query(
      `WITH wc_map AS (
         SELECT DISTINCT ON (code) code, machineid FROM (
           SELECT machineid::text AS code, machineid FROM public.workcenter
           UNION ALL SELECT workcenternew, machineid FROM public.workcenter WHERE COALESCE(workcenternew,'')<>''
           UNION ALL SELECT workcenterold, machineid FROM public.workcenter WHERE COALESCE(workcenterold,'')<>''
           UNION ALL SELECT workcenterot,  machineid FROM public.workcenter WHERE COALESCE(workcenterot,'')<>''
         ) x ORDER BY code, machineid
       ),
       base_op AS (
         SELECT operation_no,
           (array_agg(machine_code ORDER BY schedule_date DESC))[1] AS machine_code,
           max(schedule_date) AS status_date,
           bool_or(machine_deviation)  AS machine_deviation,
           bool_or(sequence_deviation) AS sequence_deviation,
           sum(actual_hours)::numeric(10,2) AS actual_hours
         FROM public.vw_sow_operation_actual
         WHERE ltrim(production_order,'0') = ltrim($1,'0')
         GROUP BY operation_no
       ),
       ov AS (
         SELECT operation_no, id AS manual_status_id, manual_flag, blocked_reason
         FROM public.sow_operation_status WHERE production_order = $1
       )
       SELECT s.operation_no,
         COALESCE(b.machine_code, wm.machineid::text) AS machine_code,
         COALESCE(b.status_date, CURRENT_DATE)        AS status_date,
         s.operation_text, s.part_name,
         CASE WHEN s.status='FINISH' THEN 'sudah' ELSE 'belum' END AS view_status,
         CASE WHEN s.status='FINISH'       THEN 'sudah'
              WHEN o.manual_flag='nyangkut' THEN 'nyangkut'
              WHEN o.manual_flag='dilewati' THEN 'dilewati'
              ELSE 'belum' END AS effective_status,
         b.actual_hours,
         COALESCE(b.machine_deviation,false)  AS machine_deviation,
         COALESCE(b.sequence_deviation,false) AS sequence_deviation,
         (b.operation_no IS NULL) AS is_ghost,
         o.manual_status_id, o.manual_flag, o.blocked_reason,
         (s.operation_no = $2::int) AS is_frontier,
         ( (CASE WHEN s.status='FINISH' THEN 'sudah'
                 WHEN o.manual_flag='nyangkut' THEN 'nyangkut'
                 WHEN o.manual_flag='dilewati' THEN 'dilewati'
                 ELSE 'belum' END) <> 'sudah'
           AND $3::int IS NOT NULL AND s.operation_no < $3::int ) AS is_behind_frontier
       FROM public.sow s
       LEFT JOIN base_op b ON b.operation_no = s.operation_no
       LEFT JOIN ov o      ON o.operation_no = s.operation_no
       LEFT JOIN wc_map wm ON wm.code = s.workcenter
       WHERE ltrim(s.order_no,'0') = ltrim($1,'0')
         AND NOT EXISTS (SELECT 1 FROM public.ph3_order p WHERE p.order_no = s.order_no AND p.order_description = 'TECO')
       ORDER BY s.operation_no`,
      [productionOrder, summary?.frontier_op ?? null, summary?.highest_done_op ?? null]
    );
    res.json({ production_order: productionOrder, summary, operations: opsRes.rows });
  } catch (err) {
    sendError(res, err);
  }
};
