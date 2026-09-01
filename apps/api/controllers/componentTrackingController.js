const db = global.pool || require('../db');
const SHIPMENT_MACHINE_ID = '__SHIPMENT__';

const tableExistsCache = new Map();

async function tableExists(tableName) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);

  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );

  const exists = Boolean(result.rows[0]?.exists);
  tableExistsCache.set(tableName, exists);
  return exists;
}

function machineCodeCondition(alias = 't') {
  return `(
    ${alias}.workcentercode = w.workcenternew
    OR ${alias}.workcentercode = w.workcenterot
    OR ${alias}.workcentercode = w.workcenterold
    OR ${alias}.workcentercode = w.machineid
  )`;
}

function machineIdCondition(userAlias = 'u') {
  return `${userAlias}.machineid = w.machineid`;
}

const bufferSelect = `
  SELECT
    id,
    machine_id,
    type,
    component_id,
    COALESCE(NULLIF(component_label, ''), component_id::text, '-') AS component_name,
    order_no,
    ssbr_id,
    operation_no,
    operation_text,
    "timestamp",
    reference_no,
    note,
    COALESCE(priority, 0) AS priority,
    created_at,
    updated_at
  FROM (
    SELECT
      b.*,
      ROW_NUMBER() OVER (
        PARTITION BY b.order_no
        ORDER BY b.created_at DESC, b.id DESC
      ) AS rn
    FROM buffer_transaction b
    WHERE ($1::text IS NULL OR b.machine_id = $1)
  ) latest
  WHERE rn = 1
  ORDER BY created_at DESC, id DESC
`;

const bufferHistorySelect = `
  SELECT
    id,
    machine_id,
    type,
    component_id,
    COALESCE(NULLIF(component_label, ''), component_id::text, '-') AS component_name,
    order_no,
    ssbr_id,
    operation_no,
    operation_text,
    "timestamp",
    reference_no,
    note,
    COALESCE(priority, 0) AS priority,
    created_at,
    updated_at
  FROM buffer_transaction b
  WHERE ($1::text IS NULL OR b.machine_id = $1)
  ORDER BY created_at DESC, id DESC
`;

exports.getMachines = async (req, res) => {
  try {
    const result = await db.query(`
      WITH active_transaction AS (
        SELECT DISTINCT ON (u.machineid)
          u.machineid,
          t.tsnumber,
          t.full_name,
          t.serialnumber,
          t.order_no,
          t.part_name,
          t.operation_text,
          t.longdate_checkin,
          EXTRACT(EPOCH FROM (NOW() - t.longdate_checkin))::bigint AS elapsed_seconds
        FROM timesheet_transaction t
        JOIN usernfc u
          ON u.snssb = t.serialnumber
         AND u.machineid IS NOT NULL
         AND TRIM(u.machineid) <> ''
        WHERE t.longdate_checkout IS NULL
          AND t.longdate_checkin IS NOT NULL
        ORDER BY u.machineid, t.longdate_checkin DESC NULLS LAST
      )
      SELECT
        w.idrow,
        w.machineid,
        w.workcenternew,
        w.workcenterot,
        w.workcenterold,
        w.workcenter_description,
        w.groupname,
        w.condition,
        COALESCE(a.full_name, '') AS operator_name,
        a.serialnumber,
        a.order_no,
        a.part_name,
        a.operation_text,
        a.longdate_checkin,
        COALESCE(a.elapsed_seconds, 0) AS elapsed_seconds,
        (a.tsnumber IS NOT NULL) AS is_running
      FROM workcenter w
      LEFT JOIN active_transaction a ON a.machineid = w.machineid
      WHERE w.machineid IS NOT NULL AND TRIM(w.machineid) <> ''
      ORDER BY w.position NULLS LAST, w.machineid ASC
    `);

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMachineDetail = async (req, res) => {
  const { machineId } = req.params;

  try {
    const machineResult = await db.query(
      `SELECT *
       FROM workcenter
       WHERE machineid = $1
       LIMIT 1`,
      [machineId]
    );

    if (machineResult.rowCount === 0) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    const machine = machineResult.rows[0];
    let buffers = [];
    let componentHours = [];

    if (await tableExists('buffer_transaction')) {
      const bufferResult = await db.query(
        `${bufferSelect}
         LIMIT 50`,
        [machineId]
      );
      buffers = bufferResult.rows;
    }

    const computedResult = await db.query(
      `WITH machine AS (
         SELECT *
         FROM workcenter
         WHERE machineid = $1
         LIMIT 1
       ),
       productive_timesheet AS (
         SELECT
           t.tsnumber,
           t.order_no,
           COALESCE(t.ssbr_id, s.ssbr_id) AS ssbr_id,
           t.operation_no,
           t.part_name AS timesheet_part_name,
           t.operation_text,
           t.longdate_checkin,
           t.longdate_checkout,
           t.duration,
           s.part_number,
           s.model,
           s.part_name AS sow_part_name,
         c.component_id,
         c.part_name AS component_part_name
         FROM timesheet_transaction t
         CROSS JOIN machine w
         LEFT JOIN sow s
           ON s.order_no = t.order_no
          AND s.operation_no = t.operation_no
         LEFT JOIN components c
           ON c.part_number = s.part_number
          AND (c.model = s.model OR s.model IS NULL OR c.model IS NULL)
         WHERE ${machineCodeCondition('t')}
           AND t.longdate_checkin IS NOT NULL
         AND t.activitytype IS NULL
          AND EXISTS (
            SELECT 1
            FROM usernfc u
            WHERE u.snssb = t.serialnumber
              AND ${machineIdCondition('u')}
          )
          AND NOT EXISTS (
             SELECT 1
             FROM ph3_order po
             WHERE LTRIM(po.order_no, '0') = LTRIM(t.order_no, '0')
               AND UPPER(TRIM(COALESCE(po.order_description, ''))) = 'TECO'
           )
       )
       SELECT
         component_id,
         order_no,
         COALESCE(component_part_name, sow_part_name, timesheet_part_name, order_no, operation_text, 'Unknown component') AS component_name,
         STRING_AGG(DISTINCT ssbr_id, ', ' ORDER BY ssbr_id) FILTER (WHERE ssbr_id IS NOT NULL AND TRIM(ssbr_id) <> '') AS ssbr_ids,
         order_no AS order_nos,
         MAX(part_number) AS part_number,
         MAX(model) AS model,
         COUNT(*)::int AS transaction_count,
         ROUND(
           SUM(
             COALESCE(
               duration,
               EXTRACT(EPOCH FROM (COALESCE(longdate_checkout, NOW()) - longdate_checkin)) / 3600
             )
           )::numeric,
           2
         ) AS total_hours,
         MAX(longdate_checkin) AS last_checkin
       FROM productive_timesheet
       GROUP BY
         component_id,
         order_no,
         COALESCE(component_part_name, sow_part_name, timesheet_part_name, order_no, operation_text, 'Unknown component')
       ORDER BY total_hours DESC NULLS LAST, component_name ASC
       LIMIT 25`,
      [machineId]
    );
    componentHours = computedResult.rows;

    res.json({ machine, buffers, componentHours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowOperations = async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 5), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;
  const params = [];
  let where = `
    WHERE s.order_no IS NOT NULL
      AND TRIM(s.order_no) <> ''
      AND s.operation_no IS NOT NULL
  `;

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += `
      AND (
        LOWER(COALESCE(s.order_no, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.ssbr_id, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.part_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.model, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.operation_text, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.operation_no::text, '')) LIKE $${params.length}
      )
    `;
  }

  params.push(limit);
  params.push(offset);

  try {
    const result = await db.query(
      `WITH matching_orders AS (
         SELECT
           s.order_no,
           MAX(s.idsow) AS last_idsow
         FROM sow s
         ${where}
         GROUP BY s.order_no
       ),
       paged_orders AS (
         SELECT order_no
         FROM matching_orders
         ORDER BY last_idsow DESC, order_no DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}
       ),
       filtered AS (
         SELECT
           s.idsow,
           s.order_no,
           s.ssbr_id,
           s.part_name,
           s.part_number,
           s.model,
           s.operation_no,
           s.operation_text,
           s.wct_group,
           s.workcenter,
           s.status,
           CASE
             WHEN LOWER(TRIM(COALESCE(s.status, ''))) IN ('finish', 'finished', 'complete', 'completed', 'done')
               OR s.actual_finish IS NOT NULL
               OR LOWER(TRIM(COALESCE(s.systemstatus, ''))) LIKE '%finish%'
             THEN TRUE
             ELSE FALSE
           END AS is_finished,
           COALESCE(s.planhours, 0)::numeric AS planhours,
           ROW_NUMBER() OVER (
             PARTITION BY s.order_no, s.operation_no
             ORDER BY s.idsow DESC
           ) AS rn
         FROM sow s
         JOIN paged_orders po ON po.order_no = s.order_no
         WHERE s.operation_no IS NOT NULL
       )
       SELECT *
       FROM filtered
       WHERE rn = 1
       ORDER BY order_no DESC, operation_no ASC`,
      params
    );

    const countResult = await db.query(
      `SELECT COUNT(DISTINCT s.order_no)::int AS total
       FROM sow s
       ${where}`,
      params.slice(0, -2)
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
    res.status(500).json({ error: err.message });
  }
};

exports.getBuffers = async (req, res) => {
  const machineId = req.query.machineId ? String(req.query.machineId) : null;
  const includeHistory = String(req.query.history || '').toLowerCase() === 'true';

  try {
    if (!(await tableExists('buffer_transaction'))) {
      return res.json({ data: [] });
    }

    const result = await db.query(includeHistory ? bufferHistorySelect : bufferSelect, [machineId]);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setBuffer = async (req, res) => {
  const {
    machine_id,
    machineId,
    type,
    component_id,
    component_label,
    order_no,
    ssbr_id,
    operation_no,
    operation_text,
    priority,
    note,
  } = req.body || {};

  const resolvedType = String(type || '')
    .trim()
    .toLowerCase();
  const resolvedMachineId = String(
    machine_id || machineId || (resolvedType === 'shipment' ? SHIPMENT_MACHINE_ID : '')
  ).trim();
  const resolvedOrderNo = String(order_no || '').trim();
  const resolvedOperationNo =
    operation_no === null || operation_no === undefined || operation_no === ''
      ? null
      : Number(operation_no);

  if (!resolvedMachineId) {
    return res.status(400).json({ error: 'machine_id is required' });
  }

  if (!['in', 'out', 'moving', 'shipment'].includes(resolvedType)) {
    return res.status(400).json({ error: 'type must be in, out, moving, or shipment' });
  }

  if (!resolvedOrderNo || (resolvedType !== 'shipment' && !Number.isFinite(resolvedOperationNo))) {
    return res.status(400).json({ error: 'order_no and operation_no are required' });
  }

  let client = null;
  try {
    client = typeof db.connect === 'function' ? await db.connect() : null;
    const query = client ? client.query.bind(client) : db.query.bind(db);
    if (client) await query('BEGIN');

    if (resolvedType === 'out') {
      const finishResult = await query(
        `UPDATE public.sow
         SET status = 'FINISH',
             finish_date = CURRENT_DATE,
             updated_at = NOW()
         WHERE order_no = $1
           AND operation_no = $2
         RETURNING idsow`,
        [resolvedOrderNo, resolvedOperationNo]
      );

      if (finishResult.rowCount === 0) {
        const error = new Error('SOW activity not found for buffer out');
        error.status = 404;
        throw error;
      }
    }

    if (resolvedType === 'shipment') {
      const readinessResult = await query(
        `WITH latest_sow AS (
           SELECT *
           FROM (
             SELECT
               s.*,
               ROW_NUMBER() OVER (
                 PARTITION BY s.operation_no
                 ORDER BY s.idsow DESC
               ) AS rn
             FROM public.sow s
             WHERE s.order_no = $1
               AND s.operation_no IS NOT NULL
           ) ranked
           WHERE rn = 1
         ),
         evaluated AS (
           SELECT
             idsow,
             operation_no,
             COALESCE(NULLIF(operation_text, ''), '-') AS operation_text,
             CASE
               WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('finish', 'finished', 'complete', 'completed', 'done') THEN TRUE
               WHEN actual_finish IS NOT NULL THEN TRUE
               WHEN COALESCE(progress, 0) >= 100 THEN TRUE
               WHEN LOWER(TRIM(COALESCE(systemstatus, ''))) LIKE '%finish%' THEN TRUE
               ELSE FALSE
             END AS is_finished
           FROM latest_sow
         )
         SELECT
           COUNT(*)::int AS total_operations,
           COUNT(*) FILTER (WHERE is_finished)::int AS finished_operations,
           COALESCE(
             json_agg(
               json_build_object(
                 'idsow', idsow,
                 'operation_no', operation_no,
                 'operation_text', operation_text
               )
               ORDER BY operation_no
             ) FILTER (WHERE NOT is_finished),
             '[]'::json
           ) AS unfinished_operations
         FROM evaluated`,
        [resolvedOrderNo]
      );

      const readiness = readinessResult.rows[0] || {};
      const totalOperations = Number(readiness.total_operations || 0);
      const unfinishedOperations = Array.isArray(readiness.unfinished_operations)
        ? readiness.unfinished_operations
        : [];

      if (totalOperations === 0) {
        const error = new Error('SOW order not found for shipment');
        error.status = 404;
        throw error;
      }

      if (unfinishedOperations.length > 0) {
        const error = new Error(`${unfinishedOperations.length} operation belum finish`);
        error.status = 409;
        error.details = {
          total_operations: totalOperations,
          finished_operations: Number(readiness.finished_operations || 0),
          unfinished_operations: unfinishedOperations,
        };
        throw error;
      }
    }

    const result = await query(
      `INSERT INTO buffer_transaction (
         machine_id,
         type,
         component_id,
         component_label,
         order_no,
         ssbr_id,
         operation_no,
         operation_text,
         "timestamp",
         reference_no,
         note,
         priority,
         created_at
       )
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), $7, NULLIF($8, ''), NOW(), $9, NULLIF($10, ''), $11, NOW())
       RETURNING *`,
      [
        resolvedMachineId,
        resolvedType,
        component_id || null,
        component_label || '',
        resolvedOrderNo,
        ssbr_id || '',
        Number.isFinite(resolvedOperationNo) ? resolvedOperationNo : null,
        operation_text || '',
        `BUFFER-${resolvedMachineId}-${resolvedOrderNo}-${resolvedOperationNo || 'ORDER'}-${Date.now()}`,
        note ||
          (resolvedType === 'shipment' ? 'Ready to shipment' : 'Set from Buffer Transaction page'),
        Number.isFinite(Number(priority)) ? Number(priority) : 0,
      ]
    );

    if (client) await query('COMMIT');
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  } finally {
    if (client) client.release();
  }
};

exports.updateBufferPriorities = async (req, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];

  if (updates.length === 0) {
    return res.status(400).json({ error: 'updates is required' });
  }

  const ids = [];
  const priorities = [];

  updates.forEach((item) => {
    const id = Number(item.id);
    const priority = Number(item.priority);
    if (Number.isFinite(id) && Number.isFinite(priority)) {
      ids.push(id);
      priorities.push(priority);
    }
  });

  if (ids.length === 0) {
    return res.status(400).json({ error: 'valid priority updates are required' });
  }

  try {
    const result = await db.query(
      `WITH incoming AS (
         SELECT *
         FROM UNNEST($1::bigint[], $2::int[]) AS t(id, priority)
       )
       UPDATE buffer_transaction b
       SET priority = incoming.priority,
           updated_at = NOW()
       FROM incoming
       WHERE b.id = incoming.id
       RETURNING b.*`,
      [ids, priorities]
    );

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateBufferNote = async (req, res) => {
  const id = Number(req.params.id);
  const note = req.body?.note ?? '';

  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'valid buffer id is required' });
  }

  try {
    const result = await db.query(
      `UPDATE buffer_transaction
       SET note = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, note]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'buffer transaction not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBufferHistory = async (req, res) => {
  const orderNo = String(req.query.orderNo || '').trim();
  const operationNoRaw = String(req.query.operationNo || '').trim();
  const operationNo = Number(operationNoRaw);
  const hasOperationNo = operationNoRaw !== '' && Number.isFinite(operationNo);

  if (!orderNo) {
    return res.status(400).json({ error: 'orderNo is required' });
  }

  try {
    const params = [orderNo];
    const operationFilter = hasOperationNo ? 'AND operation_no = $2' : '';
    if (hasOperationNo) params.push(operationNo);

    const result = await db.query(
      `SELECT
         id,
         machine_id,
         type,
         component_id,
         COALESCE(NULLIF(component_label, ''), component_id::text, '-') AS component_name,
         order_no,
         ssbr_id,
         operation_no,
         operation_text,
         "timestamp",
         reference_no,
         note,
         COALESCE(priority, 0) AS priority,
         created_at,
         updated_at
       FROM buffer_transaction
       WHERE order_no = $1
         ${operationFilter}
       ORDER BY created_at DESC, id DESC`,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
