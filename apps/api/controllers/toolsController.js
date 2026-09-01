const db = global.pool || require('../db');

const MAX_LIMIT = 200;

function text(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function limit(value) {
  return Math.min(Math.max(int(value, 50) || 50, 1), MAX_LIMIT);
}

function nowNo(prefix) {
  const date = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds(), 3),
  ].join('');
  return `${prefix}-${stamp}`;
}

function getClientPool() {
  if (!db.connect) {
    throw new Error('Database pool does not support transactions in this runtime');
  }
  return db;
}

function normalizeOfficeUserId(value) {
  const parsed = int(value);
  return parsed && parsed > 0 ? parsed : null;
}

function normalizeParty(payload = {}, prefix = '') {
  const fieldSnssb = nullableText(payload[`${prefix}field_snssb`] || payload[`${prefix}snssb`]);
  const officeUserId = normalizeOfficeUserId(
    payload[`${prefix}office_user_id`] || payload[`${prefix}user_id`]
  );
  return {
    fieldSnssb,
    officeUserId: fieldSnssb ? null : officeUserId,
  };
}

async function getFieldUser(snssb, client = db) {
  if (!snssb) return null;
  const result = await client.query(
    `
      SELECT snssb, nfcid, full_name, workcenter, machineid, machinename, roles
      FROM public.usernfc
      WHERE snssb = $1
      LIMIT 1
    `,
    [snssb]
  );
  return result.rows[0] || null;
}

async function getOfficeUser(userId, client = db) {
  if (!userId) return null;
  const result = await client.query(
    `
      SELECT id, username, name, role, roles
      FROM public.users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function resolveParty({ fieldSnssb, officeUserId }, client = db) {
  if (fieldSnssb) {
    const user = await getFieldUser(fieldSnssb, client);
    return {
      fieldSnssb,
      officeUserId: null,
      snapshotName: user?.full_name || null,
      snapshotWorkcenter: user?.workcenter || null,
      snapshotRole: user?.roles || null,
    };
  }

  if (officeUserId) {
    const user = await getOfficeUser(officeUserId, client);
    return {
      fieldSnssb: null,
      officeUserId,
      snapshotName: user?.name || user?.username || null,
      snapshotWorkcenter: null,
      snapshotRole: user?.roles || user?.role || null,
    };
  }

  return null;
}

function sendError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message });
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

async function insertLog(
  client,
  {
    toolId,
    reservationId = null,
    transactionId = null,
    handoverId = null,
    eventType,
    conditionId = null,
    availabilityStatus = null,
    fromFieldSnssb = null,
    fromOfficeUserId = null,
    toFieldSnssb = null,
    toOfficeUserId = null,
    createdByFieldSnssb = null,
    createdByOfficeUserId = null,
    actorSnapshotName = null,
    quantityDelta = null,
    notes = null,
  }
) {
  await client.query(
    `
      INSERT INTO tools_management.tool_status_logs (
        tool_id,
        reservation_id,
        transaction_id,
        handover_id,
        event_type,
        condition_id,
        availability_status,
        from_field_snssb,
        from_office_user_id,
        to_field_snssb,
        to_office_user_id,
        created_by_field_snssb,
        created_by_office_user_id,
        actor_snapshot_name,
        quantity_delta,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `,
    [
      toolId,
      reservationId,
      transactionId,
      handoverId,
      eventType,
      conditionId,
      availabilityStatus,
      fromFieldSnssb,
      fromOfficeUserId,
      toFieldSnssb,
      toOfficeUserId,
      createdByFieldSnssb,
      createdByOfficeUserId,
      actorSnapshotName,
      quantityDelta,
      notes,
    ]
  );
}

exports.listTools = async (req, res) => {
  const values = [];
  const where = [];

  const search = text(req.query.search);
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(t.asset_tag, '')) LIKE $${values.length}
      OR LOWER(COALESCE(t.tool_code, '')) LIKE $${values.length}
      OR LOWER(COALESCE(t.tool_name, '')) LIKE $${values.length}
      OR LOWER(COALESCE(t.tool_type, '')) LIKE $${values.length}
      OR LOWER(COALESCE(t.classification, '')) LIKE $${values.length}
      OR LOWER(COALESCE(t.size_label, '')) LIKE $${values.length}
      OR LOWER(COALESCE(t.measurement_range, '')) LIKE $${values.length}
    )`);
  }

  const category = text(req.query.category || req.query.category_code).toUpperCase();
  if (category) {
    values.push(category);
    where.push(`c.category_code = $${values.length}`);
  }

  const status = text(req.query.status || req.query.availability_status);
  if (status) {
    values.push(status);
    where.push(`t.availability_status = $${values.length}`);
  }

  const condition = text(req.query.condition || req.query.condition_code).toUpperCase();
  if (condition) {
    values.push(condition);
    where.push(`tc.condition_code = $${values.length}`);
  }

  if (req.query.is_serialized != null) {
    values.push(String(req.query.is_serialized) === 'true');
    where.push(`t.is_serialized = $${values.length}`);
  }

  const take = limit(req.query.limit);
  const skip = Math.max(int(req.query.offset, 0) || 0, 0);
  values.push(take, skip);

  try {
    const result = await db.query(
      `
        SELECT
          t.*,
          c.category_code,
          c.category_name,
          tc.condition_code,
          tc.condition_name,
          fn.full_name AS responsible_field_name,
          fn.nfcid AS responsible_field_nfcid,
          fn.workcenter AS responsible_field_workcenter,
          ou.username AS responsible_office_username,
          ou.name AS responsible_office_name,
          COUNT(*) OVER ()::int AS total_count
        FROM tools_management.tools t
        JOIN tools_management.tool_categories c ON c.category_id = t.category_id
        LEFT JOIN tools_management.tool_conditions tc ON tc.condition_id = t.condition_id
        LEFT JOIN public.usernfc fn ON fn.snssb = t.responsible_field_snssb
        LEFT JOIN public.users ou ON ou.id = t.responsible_office_user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.category_code ASC, t.tool_name ASC, t.asset_tag ASC
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );

    res.json({
      data: result.rows.map(({ total_count, ...row }) => row),
      meta: {
        total: result.rows[0]?.total_count || 0,
        limit: take,
        offset: skip,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
};

exports.getToolById = async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT *
        FROM tools_management.v_tools_with_responsible_user
        WHERE tool_id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Tool tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err);
  }
};

exports.updateTool = async (req, res) => {
  const allowedStatuses = new Set([
    'available',
    'reserved',
    'borrowed',
    'handover_pending',
    'maintenance',
    'calibration',
    'broken',
    'lost',
    'retired',
  ]);

  const client = await getClientPool().connect();

  try {
    const toolId = int(req.params.id);
    if (!toolId) throw badRequest('tool id tidak valid');

    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM tools_management.tools WHERE tool_id = $1 FOR UPDATE',
      [toolId]
    );
    if (existing.rowCount === 0) throw notFound('Tool tidak ditemukan');

    const current = existing.rows[0];
    const nextQuantityTotal =
      req.body.quantity_total == null
        ? number(current.quantity_total)
        : number(req.body.quantity_total, number(current.quantity_total));
    const nextQuantityAvailable =
      req.body.quantity_available == null
        ? number(current.quantity_available)
        : number(req.body.quantity_available, number(current.quantity_available));
    const nextStatus = nullableText(req.body.availability_status) || current.availability_status;

    if (!allowedStatuses.has(nextStatus)) throw badRequest('availability_status tidak valid');
    if (
      nextQuantityTotal < 0 ||
      nextQuantityAvailable < 0 ||
      nextQuantityAvailable > nextQuantityTotal
    ) {
      throw badRequest('quantity tidak valid');
    }

    const updated = await client.query(
      `
        UPDATE tools_management.tools
        SET
          tool_name = COALESCE($1, tool_name),
          tool_type = COALESCE($2, tool_type),
          classification = COALESCE($3, classification),
          measurement_range = COALESCE($4, measurement_range),
          size_label = COALESCE($5, size_label),
          specification = COALESCE($6, specification),
          notes = COALESCE($7, notes),
          quantity_total = $8,
          quantity_available = $9,
          unit = COALESCE($10, unit),
          condition_id = COALESCE($11, condition_id),
          availability_status = $12
        WHERE tool_id = $13
        RETURNING *
      `,
      [
        nullableText(req.body.tool_name),
        nullableText(req.body.tool_type),
        nullableText(req.body.classification),
        nullableText(req.body.measurement_range),
        nullableText(req.body.size_label),
        nullableText(req.body.specification),
        nullableText(req.body.notes),
        nextQuantityTotal,
        nextQuantityAvailable,
        nullableText(req.body.unit),
        int(req.body.condition_id),
        nextStatus,
        toolId,
      ]
    );

    await insertLog(client, {
      toolId,
      eventType: 'condition_changed',
      conditionId: int(req.body.condition_id) || current.condition_id,
      availabilityStatus: nextStatus,
      createdByOfficeUserId: normalizeOfficeUserId(req.body.actor_office_user_id),
      createdByFieldSnssb: nullableText(req.body.actor_field_snssb),
      quantityDelta: nextQuantityAvailable - number(current.quantity_available),
      notes: nullableText(req.body.log_notes || 'Admin tool update'),
    });

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.getCategories = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM tools_management.tool_categories ORDER BY category_name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
};

exports.getConditions = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM tools_management.tool_conditions ORDER BY sort_order ASC, condition_name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
};

exports.listTransactions = async (req, res) => {
  const values = [];
  const where = [];

  if (req.query.status) {
    values.push(text(req.query.status));
    where.push(`status = $${values.length}`);
  }
  if (req.query.field_snssb) {
    values.push(text(req.query.field_snssb));
    where.push(`borrower_field_snssb = $${values.length}`);
  }
  if (req.query.tool_id) {
    values.push(int(req.query.tool_id));
    where.push(`tool_id = $${values.length}`);
  }

  values.push(limit(req.query.limit));

  try {
    const result = await db.query(
      `
        SELECT *
        FROM tools_management.v_transactions_with_users
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY borrowed_at DESC, transaction_id DESC
        LIMIT $${values.length}
      `,
      values
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
};

exports.listHandovers = async (req, res) => {
  const values = [];
  const where = [];

  if (req.query.status) {
    values.push(text(req.query.status));
    where.push(`status = $${values.length}`);
  }
  if (req.query.from_field_snssb) {
    values.push(text(req.query.from_field_snssb));
    where.push(`from_field_snssb = $${values.length}`);
  }
  if (req.query.to_field_snssb) {
    values.push(text(req.query.to_field_snssb));
    where.push(`to_field_snssb = $${values.length}`);
  }
  if (req.query.tool_id) {
    values.push(int(req.query.tool_id));
    where.push(`tool_id = $${values.length}`);
  }

  values.push(limit(req.query.limit));

  try {
    const result = await db.query(
      `
        SELECT *
        FROM tools_management.v_handover_logs_with_users
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY requested_at DESC, handover_id DESC
        LIMIT $${values.length}
      `,
      values
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
};

exports.getToolLogs = async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT *
        FROM tools_management.tool_status_logs
        WHERE tool_id = $1
        ORDER BY event_at DESC, status_log_id DESC
        LIMIT $2
      `,
      [req.params.id, limit(req.query.limit)]
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
};

exports.createReservation = async (req, res) => {
  const client = await getClientPool().connect();

  try {
    const toolId = int(req.body.tool_id);
    const quantity = number(req.body.quantity, 1);
    const reservedFrom = nullableText(req.body.reserved_from);
    const reservedUntil = nullableText(req.body.reserved_until);
    const requester = await resolveParty(normalizeParty(req.body, 'requester_'), client);

    if (!toolId) throw badRequest('tool_id wajib diisi');
    if (!requester)
      throw badRequest('requester_field_snssb atau requester_office_user_id wajib diisi');
    if (quantity <= 0) throw badRequest('quantity harus lebih dari 0');
    if (!reservedFrom || !reservedUntil)
      throw badRequest('reserved_from dan reserved_until wajib diisi');

    await client.query('BEGIN');

    const toolResult = await client.query(
      'SELECT * FROM tools_management.tools WHERE tool_id = $1 FOR UPDATE',
      [toolId]
    );
    if (toolResult.rowCount === 0) throw notFound('Tool tidak ditemukan');

    const overlap = await client.query(
      `
        SELECT COALESCE(SUM(quantity), 0)::numeric AS reserved_qty
        FROM tools_management.reservations
        WHERE tool_id = $1
          AND status IN ('pending', 'approved')
          AND tstzrange(reserved_from, reserved_until, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      `,
      [toolId, reservedFrom, reservedUntil]
    );
    const reservedQty = number(overlap.rows[0]?.reserved_qty, 0);
    const tool = toolResult.rows[0];
    if (reservedQty + quantity > number(tool.quantity_total)) {
      throw badRequest(
        `Quantity reservasi melebihi total tool tersedia. Reserved aktif: ${reservedQty}`
      );
    }

    const insert = await client.query(
      `
        INSERT INTO tools_management.reservations (
          reservation_no,
          tool_id,
          requester_field_snssb,
          requester_office_user_id,
          requester_snapshot_name,
          requester_snapshot_workcenter,
          requester_snapshot_role,
          quantity,
          reserved_from,
          reserved_until,
          purpose,
          notes,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13)
        RETURNING *
      `,
      [
        nowNo('TRSV'),
        toolId,
        requester.fieldSnssb,
        requester.officeUserId,
        requester.snapshotName,
        requester.snapshotWorkcenter,
        requester.snapshotRole,
        quantity,
        reservedFrom,
        reservedUntil,
        nullableText(req.body.purpose),
        nullableText(req.body.notes),
        req.body.auto_approve ? 'approved' : 'pending',
      ]
    );

    await insertLog(client, {
      toolId,
      reservationId: insert.rows[0].reservation_id,
      eventType: req.body.auto_approve ? 'reservation_approved' : 'reserved',
      availabilityStatus: tool.availability_status,
      toFieldSnssb: requester.fieldSnssb,
      toOfficeUserId: requester.officeUserId,
      createdByFieldSnssb: requester.fieldSnssb,
      createdByOfficeUserId: requester.officeUserId,
      actorSnapshotName: requester.snapshotName,
      quantityDelta: quantity,
      notes: nullableText(req.body.notes),
    });

    await client.query('COMMIT');
    res.status(201).json(insert.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.listReservations = async (req, res) => {
  const values = [];
  const where = [];

  if (req.query.status) {
    values.push(text(req.query.status));
    where.push(`status = $${values.length}`);
  }
  if (req.query.field_snssb) {
    values.push(text(req.query.field_snssb));
    where.push(`requester_field_snssb = $${values.length}`);
  }
  if (req.query.tool_id) {
    values.push(int(req.query.tool_id));
    where.push(`tool_id = $${values.length}`);
  }

  values.push(limit(req.query.limit));

  try {
    const result = await db.query(
      `
        SELECT *
        FROM tools_management.v_reservations_with_users
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY requested_at DESC, reservation_id DESC
        LIMIT $${values.length}
      `,
      values
    );
    res.json(result.rows);
  } catch (err) {
    sendError(res, err);
  }
};

exports.updateReservationStatus = async (req, res) => {
  const action = req.params.action;
  const statusByAction = {
    approve: 'approved',
    reject: 'rejected',
    cancel: 'cancelled',
  };
  const eventByAction = {
    approve: 'reservation_approved',
    reject: 'reservation_rejected',
    cancel: 'reservation_cancelled',
  };

  if (!statusByAction[action]) return res.status(404).json({ error: 'Action tidak dikenal' });

  const client = await getClientPool().connect();
  try {
    await client.query('BEGIN');
    const actor = await resolveParty(normalizeParty(req.body, 'actor_'), client);
    const currentResult = await client.query(
      `
        SELECT
          r.*,
          t.quantity_available AS tool_quantity_available,
          t.quantity_total AS tool_quantity_total
        FROM tools_management.reservations r
        JOIN tools_management.tools t ON t.tool_id = r.tool_id
        WHERE r.reservation_id = $1::bigint
          AND r.status IN ('pending', 'approved')
        FOR UPDATE OF r, t
      `,
      [req.params.id]
    );

    if (currentResult.rowCount === 0)
      throw notFound('Reservasi tidak ditemukan atau status sudah final');
    const currentReservation = currentResult.rows[0];
    let quantityDelta = 0;
    let toolAvailabilityStatus = null;

    if (action === 'approve' && currentReservation.status === 'pending') {
      const requestedQty = number(currentReservation.quantity);
      const availableQty = number(currentReservation.tool_quantity_available);
      if (availableQty < requestedQty) {
        throw badRequest(
          `Quantity tersedia tidak cukup. Tersedia: ${currentReservation.tool_quantity_available}`
        );
      }

      const nextAvailable = availableQty - requestedQty;
      const nextStatus = nextAvailable <= 0 ? 'reserved' : 'available';
      await client.query(
        `
          UPDATE tools_management.tools
          SET
            quantity_available = $1,
            availability_status = $2
          WHERE tool_id = $3
        `,
        [nextAvailable, nextStatus, currentReservation.tool_id]
      );
      quantityDelta = -requestedQty;
      toolAvailabilityStatus = nextStatus;
    }

    if ((action === 'reject' || action === 'cancel') && currentReservation.status === 'approved') {
      const requestedQty = number(currentReservation.quantity);
      const nextAvailable = Math.min(
        number(currentReservation.tool_quantity_total),
        number(currentReservation.tool_quantity_available) + requestedQty
      );
      const nextStatus = nextAvailable > 0 ? 'available' : 'reserved';
      await client.query(
        `
          UPDATE tools_management.tools
          SET
            quantity_available = $1,
            availability_status = $2
          WHERE tool_id = $3
        `,
        [nextAvailable, nextStatus, currentReservation.tool_id]
      );
      quantityDelta = requestedQty;
      toolAvailabilityStatus = nextStatus;
    }

    const reservation = await client.query(
      `
        UPDATE tools_management.reservations
        SET
          status = $1::varchar,
          approved_by_office_user_id = CASE
            WHEN $1::varchar = 'approved' THEN COALESCE($2::int, approved_by_office_user_id)
            ELSE approved_by_office_user_id
          END,
          approved_at = CASE WHEN $1::varchar = 'approved' THEN now() ELSE approved_at END,
          notes = COALESCE($3::text, notes)
        WHERE reservation_id = $4::bigint
        RETURNING *
      `,
      [
        statusByAction[action],
        actor?.officeUserId || null,
        nullableText(req.body.notes),
        req.params.id,
      ]
    );

    await insertLog(client, {
      toolId: reservation.rows[0].tool_id,
      reservationId: reservation.rows[0].reservation_id,
      eventType: eventByAction[action],
      createdByFieldSnssb: actor?.fieldSnssb || null,
      createdByOfficeUserId: actor?.officeUserId || null,
      actorSnapshotName: actor?.snapshotName || null,
      availabilityStatus: toolAvailabilityStatus,
      quantityDelta: quantityDelta || null,
      notes: nullableText(req.body.notes),
    });

    await client.query('COMMIT');
    res.json(reservation.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.borrowTool = async (req, res) => {
  const client = await getClientPool().connect();

  try {
    const toolId = int(req.body.tool_id);
    const reservationId = int(req.body.reservation_id);
    const quantity = number(req.body.quantity, 1);
    const borrower = await resolveParty(normalizeParty(req.body, 'borrower_'), client);

    if (!toolId) throw badRequest('tool_id wajib diisi');
    if (!borrower)
      throw badRequest('borrower_field_snssb atau borrower_office_user_id wajib diisi');
    if (quantity <= 0) throw badRequest('quantity harus lebih dari 0');

    await client.query('BEGIN');

    const toolResult = await client.query(
      'SELECT * FROM tools_management.tools WHERE tool_id = $1 FOR UPDATE',
      [toolId]
    );
    if (toolResult.rowCount === 0) throw notFound('Tool tidak ditemukan');

    const tool = toolResult.rows[0];
    if (number(tool.quantity_available) < quantity) {
      throw badRequest(`Quantity tersedia tidak cukup. Tersedia: ${tool.quantity_available}`);
    }

    const transaction = await client.query(
      `
        INSERT INTO tools_management.transactions (
          transaction_no,
          reservation_id,
          tool_id,
          borrower_field_snssb,
          borrower_office_user_id,
          borrower_snapshot_name,
          borrower_snapshot_workcenter,
          borrower_snapshot_role,
          issued_by_office_user_id,
          issued_by_field_snssb,
          quantity,
          expected_return_at,
          checkout_condition_id,
          purpose,
          checkout_notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13, $14, $15)
        RETURNING *
      `,
      [
        nowNo('TBRW'),
        reservationId,
        toolId,
        borrower.fieldSnssb,
        borrower.officeUserId,
        borrower.snapshotName,
        borrower.snapshotWorkcenter,
        borrower.snapshotRole,
        normalizeOfficeUserId(req.body.issued_by_office_user_id),
        nullableText(req.body.issued_by_field_snssb),
        quantity,
        nullableText(req.body.expected_return_at),
        int(req.body.checkout_condition_id) || tool.condition_id,
        nullableText(req.body.purpose),
        nullableText(req.body.notes || req.body.checkout_notes),
      ]
    );

    const newAvailable = number(tool.quantity_available) - quantity;
    const newStatus = newAvailable <= 0 ? 'borrowed' : 'available';
    await client.query(
      `
        UPDATE tools_management.tools
        SET
          quantity_available = $1,
          availability_status = $2,
          responsible_field_snssb = $3,
          responsible_office_user_id = $4,
          responsible_snapshot_name = $5
        WHERE tool_id = $6
      `,
      [
        newAvailable,
        newStatus,
        borrower.fieldSnssb,
        borrower.officeUserId,
        borrower.snapshotName,
        toolId,
      ]
    );

    if (reservationId) {
      await client.query(
        `
          UPDATE tools_management.reservations
          SET status = 'fulfilled', fulfilled_transaction_id = $1
          WHERE reservation_id = $2
        `,
        [transaction.rows[0].transaction_id, reservationId]
      );
    }

    await insertLog(client, {
      toolId,
      reservationId,
      transactionId: transaction.rows[0].transaction_id,
      eventType: 'borrowed',
      conditionId: int(req.body.checkout_condition_id) || tool.condition_id,
      availabilityStatus: newStatus,
      toFieldSnssb: borrower.fieldSnssb,
      toOfficeUserId: borrower.officeUserId,
      createdByFieldSnssb: nullableText(req.body.issued_by_field_snssb),
      createdByOfficeUserId: normalizeOfficeUserId(req.body.issued_by_office_user_id),
      actorSnapshotName: borrower.snapshotName,
      quantityDelta: -quantity,
      notes: nullableText(req.body.notes || req.body.checkout_notes),
    });

    await client.query('COMMIT');
    res.status(201).json(transaction.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.returnTool = async (req, res) => {
  const client = await getClientPool().connect();

  try {
    await client.query('BEGIN');
    const transactionResult = await client.query(
      `
        SELECT tr.*, t.quantity_available, t.quantity_total, t.condition_id
        FROM tools_management.transactions tr
        JOIN tools_management.tools t ON t.tool_id = tr.tool_id
        WHERE tr.transaction_id = $1
          AND tr.status IN ('borrowed', 'overdue')
        FOR UPDATE
      `,
      [req.params.id]
    );

    if (transactionResult.rowCount === 0) throw notFound('Transaksi pinjam aktif tidak ditemukan');
    const transaction = transactionResult.rows[0];
    const returnConditionId = int(req.body.return_condition_id) || transaction.condition_id;
    const newAvailable = Math.min(
      number(transaction.quantity_total),
      number(transaction.quantity_available) + number(transaction.quantity)
    );
    const newStatus = newAvailable > 0 ? 'available' : 'borrowed';

    const updated = await client.query(
      `
        UPDATE tools_management.transactions
        SET
          returned_at = now(),
          returned_to_office_user_id = $1,
          returned_to_field_snssb = $2,
          return_condition_id = $3,
          return_notes = $4,
          status = 'returned'
        WHERE transaction_id = $5
        RETURNING *
      `,
      [
        normalizeOfficeUserId(req.body.returned_to_office_user_id),
        nullableText(req.body.returned_to_field_snssb),
        returnConditionId,
        nullableText(req.body.notes || req.body.return_notes),
        req.params.id,
      ]
    );

    await client.query(
      `
        UPDATE tools_management.tools
        SET
          quantity_available = $1,
          availability_status = $2,
          condition_id = $3,
          responsible_field_snssb = NULL,
          responsible_office_user_id = NULL,
          responsible_snapshot_name = NULL
        WHERE tool_id = $4
      `,
      [newAvailable, newStatus, returnConditionId, transaction.tool_id]
    );

    await insertLog(client, {
      toolId: transaction.tool_id,
      transactionId: transaction.transaction_id,
      eventType: 'returned',
      conditionId: returnConditionId,
      availabilityStatus: newStatus,
      fromFieldSnssb: transaction.borrower_field_snssb,
      fromOfficeUserId: transaction.borrower_office_user_id,
      createdByFieldSnssb: nullableText(req.body.returned_to_field_snssb),
      createdByOfficeUserId: normalizeOfficeUserId(req.body.returned_to_office_user_id),
      quantityDelta: number(transaction.quantity),
      notes: nullableText(req.body.notes || req.body.return_notes),
    });

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.createHandover = async (req, res) => {
  const client = await getClientPool().connect();

  try {
    const toolId = int(req.body.tool_id);
    const quantity = number(req.body.quantity, 1);
    const fromParty = await resolveParty(normalizeParty(req.body, 'from_'), client);
    const toParty = await resolveParty(normalizeParty(req.body, 'to_'), client);

    if (!toolId) throw badRequest('tool_id wajib diisi');
    if (!fromParty || !toParty) throw badRequest('from_* dan to_* user wajib diisi');
    if (quantity <= 0) throw badRequest('quantity harus lebih dari 0');

    await client.query('BEGIN');
    const toolResult = await client.query(
      'SELECT * FROM tools_management.tools WHERE tool_id = $1 FOR UPDATE',
      [toolId]
    );
    if (toolResult.rowCount === 0) throw notFound('Tool tidak ditemukan');
    const tool = toolResult.rows[0];

    const fromMatchesResponsible = fromParty.fieldSnssb
      ? tool.responsible_field_snssb === fromParty.fieldSnssb
      : number(tool.responsible_office_user_id) === number(fromParty.officeUserId);
    if (!fromMatchesResponsible) {
      throw badRequest('Tool tidak bisa di-handover karena bukan tanggung jawab user ini');
    }

    const transactionResult = await client.query(
      `
        SELECT *
        FROM tools_management.transactions
        WHERE tool_id = $1
          AND status IN ('borrowed', 'overdue')
          AND ($2::bigint IS NULL OR transaction_id = $2::bigint)
          AND (
            ($3::text IS NOT NULL AND borrower_field_snssb = $3::text)
            OR ($4::int IS NOT NULL AND borrower_office_user_id = $4::int)
          )
        ORDER BY borrowed_at DESC, transaction_id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [toolId, int(req.body.transaction_id), fromParty.fieldSnssb, fromParty.officeUserId]
    );
    if (transactionResult.rowCount === 0) {
      throw badRequest(
        'Tool tidak bisa di-handover karena tidak ada transaksi pinjam aktif milik user ini'
      );
    }
    const transaction = transactionResult.rows[0];
    if (number(transaction.quantity) < quantity) {
      throw badRequest(
        `Quantity handover melebihi quantity pinjam aktif. Aktif: ${transaction.quantity}`
      );
    }

    const pendingHandover = await client.query(
      `
        SELECT 1
        FROM tools_management.handover_logs
        WHERE tool_id = $1
          AND transaction_id = $2
          AND status IN ('pending', 'handed_over')
        LIMIT 1
      `,
      [toolId, transaction.transaction_id]
    );
    if (pendingHandover.rowCount > 0) {
      throw badRequest('Tool ini masih memiliki handover pending');
    }

    const handover = await client.query(
      `
        INSERT INTO tools_management.handover_logs (
          handover_no,
          transaction_id,
          tool_id,
          from_field_snssb,
          from_office_user_id,
          from_snapshot_name,
          from_snapshot_workcenter,
          to_field_snssb,
          to_office_user_id,
          to_snapshot_name,
          to_snapshot_workcenter,
          processed_by_office_user_id,
          processed_by_field_snssb,
          condition_id,
          quantity,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `,
      [
        nowNo('THOV'),
        transaction.transaction_id,
        toolId,
        fromParty.fieldSnssb,
        fromParty.officeUserId,
        fromParty.snapshotName,
        fromParty.snapshotWorkcenter,
        toParty.fieldSnssb,
        toParty.officeUserId,
        toParty.snapshotName,
        toParty.snapshotWorkcenter,
        normalizeOfficeUserId(req.body.processed_by_office_user_id),
        nullableText(req.body.processed_by_field_snssb),
        int(req.body.condition_id) || tool.condition_id,
        quantity,
        nullableText(req.body.notes),
      ]
    );

    await client.query(
      "UPDATE tools_management.tools SET availability_status = 'handover_pending' WHERE tool_id = $1",
      [toolId]
    );

    await insertLog(client, {
      toolId,
      handoverId: handover.rows[0].handover_id,
      transactionId: transaction.transaction_id,
      eventType: 'handover_requested',
      availabilityStatus: 'handover_pending',
      fromFieldSnssb: fromParty.fieldSnssb,
      fromOfficeUserId: fromParty.officeUserId,
      toFieldSnssb: toParty.fieldSnssb,
      toOfficeUserId: toParty.officeUserId,
      createdByFieldSnssb: nullableText(req.body.processed_by_field_snssb),
      createdByOfficeUserId: normalizeOfficeUserId(req.body.processed_by_office_user_id),
      actorSnapshotName: fromParty.snapshotName,
      quantityDelta: quantity,
      notes: nullableText(req.body.notes),
    });

    await client.query('COMMIT');
    res.status(201).json(handover.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.rejectHandover = async (req, res) => {
  const client = await getClientPool().connect();

  try {
    await client.query('BEGIN');
    const handoverResult = await client.query(
      `
        UPDATE tools_management.handover_logs
        SET
          status = 'rejected',
          received_at = now(),
          notes = COALESCE($2, notes)
        WHERE handover_id = $1
          AND status IN ('pending', 'handed_over')
          AND ($3::text IS NULL OR to_field_snssb = $3::text)
        RETURNING *
      `,
      [req.params.id, nullableText(req.body.notes), nullableText(req.body.actor_field_snssb)]
    );

    if (handoverResult.rowCount === 0) throw notFound('Handover aktif tidak ditemukan');
    const handover = handoverResult.rows[0];

    await client.query(
      `
        UPDATE tools_management.tools
        SET availability_status = 'borrowed'
        WHERE tool_id = $1
      `,
      [handover.tool_id]
    );

    await insertLog(client, {
      toolId: handover.tool_id,
      handoverId: handover.handover_id,
      transactionId: handover.transaction_id,
      eventType: 'handover_rejected',
      conditionId: handover.condition_id,
      availabilityStatus: 'borrowed',
      fromFieldSnssb: handover.from_field_snssb,
      fromOfficeUserId: handover.from_office_user_id,
      toFieldSnssb: handover.to_field_snssb,
      toOfficeUserId: handover.to_office_user_id,
      quantityDelta: handover.quantity,
      notes: nullableText(req.body.notes),
    });

    await client.query('COMMIT');
    res.json(handover);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};

exports.acceptHandover = async (req, res) => {
  const client = await getClientPool().connect();

  try {
    await client.query('BEGIN');
    const handoverResult = await client.query(
      `
        UPDATE tools_management.handover_logs
        SET
          status = 'accepted',
          handed_over_at = COALESCE(handed_over_at, now()),
          received_at = now(),
          notes = COALESCE($2, notes)
        WHERE handover_id = $1
          AND status IN ('pending', 'handed_over')
          AND ($3::text IS NULL OR to_field_snssb = $3::text)
        RETURNING *
      `,
      [req.params.id, nullableText(req.body.notes), nullableText(req.body.actor_field_snssb)]
    );

    if (handoverResult.rowCount === 0) throw notFound('Handover aktif tidak ditemukan');
    const handover = handoverResult.rows[0];
    const newStatus = 'borrowed';

    await client.query(
      `
        UPDATE tools_management.tools
        SET
          availability_status = $1,
          responsible_field_snssb = $2,
          responsible_office_user_id = $3,
          responsible_snapshot_name = $4
        WHERE tool_id = $5
      `,
      [
        newStatus,
        handover.to_field_snssb,
        handover.to_office_user_id,
        handover.to_snapshot_name,
        handover.tool_id,
      ]
    );

    if (handover.transaction_id) {
      await client.query(
        `
          UPDATE tools_management.transactions
          SET
            borrower_field_snssb = $1,
            borrower_office_user_id = $2,
            borrower_snapshot_name = $3,
            borrower_snapshot_workcenter = $4
          WHERE transaction_id = $5
        `,
        [
          handover.to_field_snssb,
          handover.to_office_user_id,
          handover.to_snapshot_name,
          handover.to_snapshot_workcenter,
          handover.transaction_id,
        ]
      );
    }

    await insertLog(client, {
      toolId: handover.tool_id,
      handoverId: handover.handover_id,
      transactionId: handover.transaction_id,
      eventType: 'handover_accepted',
      conditionId: handover.condition_id,
      availabilityStatus: newStatus,
      fromFieldSnssb: handover.from_field_snssb,
      fromOfficeUserId: handover.from_office_user_id,
      toFieldSnssb: handover.to_field_snssb,
      toOfficeUserId: handover.to_office_user_id,
      quantityDelta: handover.quantity,
      notes: nullableText(req.body.notes),
    });

    await client.query('COMMIT');
    res.json(handover);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendError(res, err);
  } finally {
    client.release();
  }
};
