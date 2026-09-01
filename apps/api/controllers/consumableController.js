const db = global.pool || require('../db');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const WAITING_LEADER_STATUS = 'waiting leader';
const WAITING_WAREHOUSE_STATUS = 'waiting warehouse';
const READY_STATUS = 'ready';
const CLOSE_STATUS = 'Close';
const REJECTED_STATUS = 'rejected';
const MAX_STOCK_RESULTS = 100;

const PLANT_SSB = process.env.PLANT_SSB || '';

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function businessError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.isBusiness = true;
  return err;
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text || '').join('');
    if ('result' in value)
      return value.result === null || value.result === undefined ? '' : String(value.result);
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value);
}

function normalizeMaterialCode(raw) {
  return String(raw ?? '')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, '')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function parseUploadQuantity(value) {
  const s = cellToString(value).trim();
  if (s === '') return { blank: true };
  const n = Number(s);
  if (!Number.isFinite(n)) return { invalid: true };
  if (n < 0) return { negative: true };
  return { value: n };
}

async function parseStockWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) return { error: 'File Excel kosong atau tanpa baris data' };

  const colMap = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    const key = cellToString(cell.value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (key && !(key in colMap)) colMap[key] = colNumber;
  });
  const col = {
    materialCode: colMap.materialcode || colMap.material,
    quantity: colMap.quantity || colMap.qty,
    codeMm: colMap.codemm,
    description: colMap.materialdescription || colMap.description || colMap.deskripsi,
    uom: colMap.uom || colMap.satuan,
  };
  if (!col.materialCode || !col.quantity) {
    return { error: "Header wajib tidak ditemukan: kolom 'material_code' dan 'quantity'" };
  }

  const rows = [];
  const cleaned = [];
  const seen = new Set();
  let skippedBlank = 0;

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rawMc = cellToString(row.getCell(col.materialCode).value);
    const materialCode = normalizeMaterialCode(rawMc);
    const q = parseUploadQuantity(row.getCell(col.quantity).value);

    if (!materialCode && q.blank) {
      skippedBlank += 1;
      continue;
    }
    if (!materialCode) return { error: `Baris ${r}: ada data tapi material_code kosong` };
    if (q.blank) return { error: `Baris ${r}: quantity kosong untuk ${materialCode}` };
    if (q.invalid) return { error: `Baris ${r}: quantity bukan angka untuk ${materialCode}` };
    if (q.negative) return { error: `Baris ${r}: quantity negatif untuk ${materialCode}` };
    if (seen.has(materialCode))
      return { error: `Baris ${r}: material_code duplikat dalam file: ${materialCode}` };
    seen.add(materialCode);
    if (rawMc !== materialCode) cleaned.push({ row: r, raw: rawMc, normalized: materialCode });

    rows.push({
      materialCode,
      quantity: q.value,
      codeMm: col.codeMm ? normalizeText(cellToString(row.getCell(col.codeMm).value)) : '',
      description: col.description
        ? normalizeText(cellToString(row.getCell(col.description).value))
        : '',
      uom: col.uom ? normalizeText(cellToString(row.getCell(col.uom).value)) : '',
    });
  }

  if (rows.length === 0) return { error: 'Tidak ada baris valid untuk di-upload' };
  return { rows, cleaned, skippedBlank };
}

exports.normalizeMaterialCode = normalizeMaterialCode;
exports.parseStockWorkbook = parseStockWorkbook;

function buildTicketNo(ticketId, now = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const datePart = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`;
  return `cis-${datePart}-${ticketId}`;
}

function buildPendingTicketNo() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `cis-pending-${Date.now()}-${randomPart}`;
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase();
}

function actorRole(req) {
  return normalizeRole(req.headers['x-user-role']);
}

function actorName(req) {
  return normalizeText(req.headers['x-user-name']) || null;
}

function nextStatusForRole(role) {
  if (role === 'foreman') return WAITING_WAREHOUSE_STATUS;
  if (role === 'warehouse') return READY_STATUS;
  return null;
}

function canManageItems(role) {
  return role === 'foreman' || role === 'warehouse';
}

function saveConsumableImage(imageData, cisNo) {
  if (!imageData) return null;

  const raw = String(imageData);

  if (raw.startsWith('/uploads/') || raw.startsWith('http://') || raw.startsWith('https://'))
    return raw;

  const match = String(imageData).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  const extension = match?.[1]?.toLowerCase().replace('jpeg', 'jpg') || 'jpg';
  const base64 = match?.[2] || String(imageData).replace(/^data:image\/\w+;base64,/, '');
  const safeCis = normalizeText(cisNo).replace(/[^\w-]/g, '_') || 'unknown';
  const uploadsRoot = path.join(__dirname, '../uploads');
  const dir = path.join(uploadsRoot, 'consumable', safeCis);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}.${extension}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));
  return `/uploads/consumable/${safeCis}/${filename}`;
}

const ITEMS_AGG_SQL = `COALESCE(
          json_agg(
            json_build_object(
              'id', i.id,
              'materialcode', i.materialcode,
              'materialdescription', i.materialdescription,
              'quanitty', i.quanitty,
              'uom', i.uom,
              'created', i.created,
              'cost_center', i.cost_center,
              'gl_account', i.gl_account,
              'code_mm', i.code_mm,
              'status', i.status,
              'rejected_by', i.rejected_by,
              'rejected_reason', i.rejected_reason,
              'rejected_at', i.rejected_at,
              'adjusted_by', i.adjusted_by,
              'adjusted_at', i.adjusted_at
            )
            ORDER BY i.id
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS items`;

async function getTicketWithItems(ticketId, client = db) {
  const result = await client.query(
    `
      SELECT
        t.id,
        t.cis_no,
        t.sn_karyawan,
        t.nama_karyawan,
        t.workcenter,
        t.machineid,
        t.comment,
        t.status,
        t.person_image,
        t.image_person,
        t.closedate,
        t.created,
        t.picked_by_sn,
        t.picked_by_name,
        t.picked_by_workcenter,
        t.picked_by_machineid,
        t.picked_by_nfcid,
        t.picked_by_role,
        t.picked_at,
        ${ITEMS_AGG_SQL}
      FROM consumable_ticket t
      LEFT JOIN consumable_item i ON i.cis_no = t.cis_no
      WHERE t.id = $1
      GROUP BY t.id
    `,
    [ticketId]
  );

  return result.rows[0] || null;
}

exports.getHistory = async (req, res) => {
  const sn = normalizeText(req.query.sn || req.params.sn);

  if (!sn) {
    return res.status(400).json({ error: 'sn_karyawan wajib diisi' });
  }

  try {
    const result = await db.query(
      `
        SELECT
          t.id,
          t.cis_no,
          t.sn_karyawan,
          t.nama_karyawan,
          t.workcenter,
          t.machineid,
          t.comment,
          t.status,
          t.person_image,
          t.image_person,
          t.closedate,
          t.created,
          t.picked_by_sn,
          t.picked_by_name,
          t.picked_by_workcenter,
          t.picked_by_machineid,
          t.picked_by_nfcid,
          t.picked_by_role,
          t.picked_at,
          ${ITEMS_AGG_SQL}
        FROM consumable_ticket t
        LEFT JOIN consumable_item i ON i.cis_no = t.cis_no
        WHERE t.sn_karyawan = $1
        GROUP BY t.id
        ORDER BY t.created DESC, t.id DESC
      `,
      [sn]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchStock = async (req, res) => {
  const search = normalizeText(req.query.search);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_STOCK_RESULTS);
  const values = [limit];
  let where = '';

  if (search) {
    values.unshift(`%${search.toLowerCase()}%`);
    where = `
      WHERE LOWER(COALESCE(material_code, '')) LIKE $1
         OR LOWER(COALESCE(code_mm, '')) LIKE $1
         OR LOWER(COALESCE(material_description, '')) LIKE $1
         OR LOWER(COALESCE(type, '')) LIKE $1
    `;
  }

  try {
    const result = await db.query(
      `
        SELECT
          id,
          material_code,
          code_mm,
          material_description,
          mrp_type,
          plant,
          quantity,
          type,
          uom
        FROM consumable_stock
        ${where}
        ORDER BY material_description ASC NULLS LAST, material_code ASC NULLS LAST
        LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getControlTickets = async (req, res) => {
  const status = normalizeText(req.query.status).toLowerCase();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE LOWER(COALESCE(t.status, '')) = $${params.length}`;
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  try {
    const result = await db.query(
      `
        SELECT
          t.id,
          t.cis_no,
          t.sn_karyawan,
          t.nama_karyawan,
          t.workcenter,
          t.machineid,
          t.comment,
          t.status,
          t.closedate,
          t.created,
          t.picked_by_sn,
          t.picked_by_name,
          t.picked_by_workcenter,
          t.picked_by_machineid,
          t.picked_by_nfcid,
          t.picked_by_role,
          t.picked_at,
          ${ITEMS_AGG_SQL}
        FROM consumable_ticket t
        LEFT JOIN consumable_item i ON i.cis_no = t.cis_no
        ${where}
        GROUP BY t.id
        ORDER BY t.created DESC, t.id DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveTicket = async (req, res) => {
  const ticketId = Number(req.params.id);
  const role = actorRole(req);
  const nextStatus = nextStatusForRole(role);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: 'ID ticket tidak valid' });
  }

  if (!nextStatus) {
    return res.status(403).json({ error: 'Role tidak diizinkan approve consumable' });
  }

  const expectedStatus = role === 'foreman' ? WAITING_LEADER_STATUS : WAITING_WAREHOUSE_STATUS;

  try {
    const result = await db.query(
      `
        UPDATE consumable_ticket
        SET
          status = $1,
          closedate = CASE WHEN $1 = $4 THEN CURRENT_TIMESTAMP ELSE closedate END
        WHERE id = $2
          AND LOWER(COALESCE(status, '')) = $3
        RETURNING *
      `,
      [nextStatus, ticketId, expectedStatus, READY_STATUS]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: `Ticket hanya bisa di-approve role ${role} saat status ${expectedStatus}`,
      });
    }

    res.json({
      message: 'Consumable ticket berhasil di-approve',
      ticket: result.rows[0],
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.closeTicket = async (req, res) => {
  const ticketId = Number(req.params.id);
  const role = actorRole(req);
  const nfcid = normalizeText(req.body?.nfcid);
  const imageData = req.body?.image_data;

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: 'ID ticket tidak valid' });
  }

  if (role !== 'warehouse') {
    return res.status(403).json({ error: 'Hanya warehouse yang boleh close ticket ready' });
  }

  if (!nfcid) {
    return res.status(400).json({ error: 'Scan ID pengambil wajib diisi' });
  }

  if (!imageData) {
    return res.status(400).json({ error: 'Foto pengambil wajib di-capture' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query('SELECT * FROM usernfc WHERE nfcid = $1 LIMIT 1', [
      nfcid,
    ]);

    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User pengambil tidak ditemukan' });
    }

    const user = userResult.rows[0];
    const ticketResult = await client.query(
      `
        SELECT *
        FROM consumable_ticket
        WHERE id = $1
          AND LOWER(COALESCE(status, '')) = $2
        FOR UPDATE
      `,
      [ticketId, READY_STATUS]
    );

    if (ticketResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ticket hanya bisa diambil saat status ready' });
    }

    const activeItems = await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM consumable_item
        WHERE cis_no = $1
          AND LOWER(COALESCE(status, 'active')) <> $2
      `,
      [ticketResult.rows[0].cis_no, REJECTED_STATUS]
    );

    if (activeItems.rows[0].count <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ticket tidak memiliki item aktif untuk diambil' });
    }

    const cisNo = ticketResult.rows[0].cis_no;
    const taken = await client.query(
      `
        SELECT materialcode, SUM(quanitty)::numeric AS qty
        FROM consumable_item
        WHERE cis_no = $1
          AND LOWER(COALESCE(status, 'active')) <> $2
        GROUP BY materialcode
        ORDER BY materialcode
      `,
      [cisNo, REJECTED_STATUS]
    );

    for (const row of taken.rows) {
      const materialCode = normalizeText(row.materialcode);
      const qty = normalizeNumber(row.qty);
      if (!materialCode || qty <= 0) continue;

      const stock = await client.query(
        'SELECT quantity FROM consumable_stock WHERE material_code = $1 FOR UPDATE',
        [materialCode]
      );
      if (stock.rowCount === 0) {
        throw businessError(409, `Belum ada data stok untuk material ${materialCode}`);
      }
      const available = normalizeNumber(stock.rows[0].quantity);
      if (qty > available) {
        throw businessError(
          409,
          `Stok ${materialCode} tidak cukup (tersedia ${available}, diambil ${qty})`
        );
      }
      await client.query(
        'UPDATE consumable_stock SET quantity = quantity - $1 WHERE material_code = $2',
        [qty, materialCode]
      );
    }

    const imagePath = saveConsumableImage(imageData, ticketResult.rows[0].cis_no);

    await client.query(
      `
        UPDATE consumable_ticket
        SET
          status = $1,
          closedate = CURRENT_TIMESTAMP,
          picked_at = CURRENT_TIMESTAMP,
          picked_by_sn = $2,
          picked_by_name = $3,
          picked_by_workcenter = $4,
          picked_by_machineid = $5,
          picked_by_nfcid = $6,
          picked_by_role = $7,
          image_person = COALESCE($8, image_person)
        WHERE id = $9
      `,
      [
        CLOSE_STATUS,
        normalizeText(user.snssb) || null,
        normalizeText(user.full_name) || null,
        normalizeText(user.workcenter) || null,
        normalizeText(user.machineid) || null,
        nfcid,
        normalizeText(user.roles) || null,
        imagePath,
        ticketId,
      ]
    );

    const updatedTicket = await getTicketWithItems(ticketId, client);
    await client.query('COMMIT');

    res.json({
      message: 'Consumable ticket berhasil di-close',
      ticket: updatedTicket,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.adjustItemQuantity = async (req, res) => {
  const itemId = Number(req.params.itemId);
  const role = actorRole(req);
  const quantity = normalizeNumber(req.body?.quantity);
  const updatedBy = actorName(req);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'ID item tidak valid' });
  }

  if (!canManageItems(role)) {
    return res.status(403).json({ error: 'Role tidak diizinkan adjust item' });
  }

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity harus lebih dari 0' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const itemResult = await client.query(
      `
        SELECT i.*, t.id AS ticket_id, t.status AS ticket_status
        FROM consumable_item i
        JOIN consumable_ticket t ON t.cis_no = i.cis_no
        WHERE i.id = $1
        FOR UPDATE
      `,
      [itemId]
    );

    if (itemResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item tidak ditemukan' });
    }

    const item = itemResult.rows[0];
    const ticketStatus = normalizeRole(item.ticket_status);
    if ([CLOSE_STATUS.toLowerCase(), REJECTED_STATUS].includes(ticketStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ticket sudah final dan tidak bisa di-adjust' });
    }

    if (normalizeRole(item.status || 'active') === REJECTED_STATUS) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Item rejected tidak bisa di-adjust' });
    }

    const stockResult = await client.query(
      `
        SELECT quantity
        FROM consumable_stock
        WHERE material_code = $1
        FOR UPDATE
      `,
      [item.materialcode]
    );

    const availableStock = normalizeNumber(stockResult.rows[0]?.quantity);
    if (quantity > availableStock) {
      throw businessError(409, `Quantity melebihi stock tersedia (${availableStock})`);
    }

    await client.query(
      `
        UPDATE consumable_item
        SET
          quanitty = $1,
          adjusted_by = $2,
          adjusted_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [quantity, updatedBy, itemId]
    );

    const updatedTicket = await getTicketWithItems(item.ticket_id, client);
    await client.query('COMMIT');

    res.json({
      message: 'Quantity item berhasil di-adjust',
      ticket: updatedTicket,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.rejectItem = async (req, res) => {
  const itemId = Number(req.params.itemId);
  const role = actorRole(req);
  const reason = normalizeText(req.body?.reason);
  const rejectedBy = actorName(req);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'ID item tidak valid' });
  }

  if (!canManageItems(role)) {
    return res.status(403).json({ error: 'Role tidak diizinkan reject item' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const itemResult = await client.query(
      `
        SELECT i.*, t.id AS ticket_id, t.status AS ticket_status
        FROM consumable_item i
        JOIN consumable_ticket t ON t.cis_no = i.cis_no
        WHERE i.id = $1
        FOR UPDATE
      `,
      [itemId]
    );

    if (itemResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item tidak ditemukan' });
    }

    const item = itemResult.rows[0];
    const ticketStatus = normalizeRole(item.ticket_status);
    if ([CLOSE_STATUS.toLowerCase(), REJECTED_STATUS].includes(ticketStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ticket sudah final dan tidak bisa di-reject' });
    }

    await client.query(
      `
        UPDATE consumable_item
        SET
          status = $1,
          rejected_by = $2,
          rejected_reason = $3,
          rejected_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `,
      [REJECTED_STATUS, rejectedBy, reason || null, itemId]
    );

    const activeItems = await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM consumable_item
        WHERE cis_no = $1
          AND LOWER(COALESCE(status, 'active')) <> $2
      `,
      [item.cis_no, REJECTED_STATUS]
    );

    if (activeItems.rows[0].count <= 0) {
      await client.query(
        `
          UPDATE consumable_ticket
          SET status = $1, closedate = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
        [REJECTED_STATUS, item.ticket_id]
      );
    }

    const updatedTicket = await getTicketWithItems(item.ticket_id, client);
    await client.query('COMMIT');

    res.json({
      message: 'Item berhasil di-reject',
      ticket: updatedTicket,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.createRequest = async (req, res) => {
  const client = await db.connect();

  try {
    const { sn_karyawan, nama_karyawan, workcenter, machineid, comment, person_image, items } =
      req.body || {};

    const normalizedSn = normalizeText(sn_karyawan);
    const normalizedName = normalizeText(nama_karyawan);
    const normalizedItems = Array.isArray(items) ? items : [];

    if (!normalizedSn || !normalizedName) {
      return res.status(400).json({ error: 'Data karyawan tidak lengkap' });
    }

    if (normalizedItems.length === 0) {
      return res.status(400).json({ error: 'Minimal 1 item consumable wajib dipilih' });
    }

    await client.query('BEGIN');

    const requestedTotals = new Map();

    for (const item of normalizedItems) {
      const materialCode = normalizeText(item.materialcode || item.material_code);
      const quantity = normalizeNumber(item.quanitty || item.quantity);

      requestedTotals.set(materialCode, (requestedTotals.get(materialCode) || 0) + quantity);
    }

    const pendingCisNo = buildPendingTicketNo();
    const ticketResult = await client.query(
      `
        INSERT INTO consumable_ticket
          (cis_no, sn_karyawan, nama_karyawan, workcenter, machineid, comment, status, person_image)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        pendingCisNo,
        normalizedSn,
        normalizedName,
        normalizeText(workcenter) || null,
        normalizeText(machineid) || null,
        normalizeText(comment) || null,
        WAITING_LEADER_STATUS,
        null,
      ]
    );
    const ticketId = ticketResult.rows[0].id;
    const cisNo = buildTicketNo(ticketId);

    const personImagePath = saveConsumableImage(person_image, cisNo);

    await client.query(
      'UPDATE consumable_ticket SET cis_no = $1, person_image = $2 WHERE id = $3',
      [cisNo, personImagePath, ticketId]
    );

    for (const item of normalizedItems) {
      const materialCode = normalizeText(item.materialcode || item.material_code);
      const materialDescription = normalizeText(
        item.materialdescription || item.material_description
      );
      const quantity = normalizeNumber(item.quanitty || item.quantity);
      const uom = normalizeText(item.uom);
      const glAccount = normalizeText(item.gl_account);
      const codeMm = normalizeText(item.code_mm);
      const costCenter = normalizeText(item.cost_center || workcenter);

      if (!materialCode || !materialDescription || !quantity || quantity <= 0 || !glAccount) {
        throw businessError(400, 'Item consumable tidak lengkap');
      }

      const stockResult = await client.query(
        `
          SELECT quantity
          FROM consumable_stock
          WHERE material_code = $1
          FOR UPDATE
        `,
        [materialCode]
      );

      const availableStock = normalizeNumber(stockResult.rows[0]?.quantity);
      if ((requestedTotals.get(materialCode) || 0) > availableStock) {
        throw businessError(
          409,
          `Request ${materialCode} melebihi stock tersedia (${availableStock})`
        );
      }

      await client.query(
        `
          INSERT INTO consumable_item
            (materialcode, materialdescription, quanitty, uom, cost_center, cis_no, gl_account, code_mm)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          materialCode,
          materialDescription,
          quantity,
          uom || null,
          costCenter || null,
          cisNo,
          glAccount,
          codeMm || null,
        ]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Consumable request berhasil dibuat',
      id: ticketId,
      cis_no: cisNo,
      status: WAITING_LEADER_STATUS,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.uploadStock = async (req, res) => {
  const role = actorRole(req);
  if (role !== 'warehouse' && role !== 'administrator') {
    return res.status(403).json({ error: 'Hanya warehouse/administrator yang boleh upload stock' });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: "File Excel wajib di-upload (field 'file')" });
  }

  let parsed;
  try {
    parsed = await parseStockWorkbook(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `File Excel tidak bisa dibaca: ${err.message}` });
  }
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { rows, cleaned, skippedBlank } = parsed;
  const codes = rows.map((row) => row.materialCode);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'SELECT 1 FROM consumable_stock WHERE material_code = ANY($1::text[]) ORDER BY material_code FOR UPDATE',
      [codes]
    );

    const created = [];
    for (const row of rows) {
      const up = await client.query(
        `
          INSERT INTO consumable_stock
            (material_code, code_mm, material_description, uom, quantity, plant)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (material_code) DO UPDATE SET
            code_mm              = EXCLUDED.code_mm,
            material_description = EXCLUDED.material_description,
            uom                  = EXCLUDED.uom,
            quantity             = EXCLUDED.quantity,
            plant                = EXCLUDED.plant
          RETURNING (xmax = 0) AS was_created
        `,
        [
          row.materialCode,
          row.codeMm || null,
          row.description || null,
          row.uom || null,
          row.quantity,
          PLANT_SSB || null,
        ]
      );
      if (up.rows[0].was_created) created.push(row.materialCode);
    }

    await client.query('COMMIT');

    return res.json({
      ok: true,
      applied: rows.length,
      skipped_blank: skippedBlank,
      created,
      cleaned,
      plant: PLANT_SSB || null,
      message:
        `Stock di-reset absolut: ${rows.length} baris diterapkan` +
        (created.length ? `, ${created.length} material baru dibuat` : '') +
        (cleaned.length ? `, ${cleaned.length} baris material_code dibersihkan` : '') +
        (skippedBlank ? `, ${skippedBlank} baris kosong dilewati` : '') +
        '.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
};
