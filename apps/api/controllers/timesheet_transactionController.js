const db = global.pool || require("../db");



const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');



const PLANT_SSB = process.env.PLANT_SSB;  
const TIMEZONE = process.env.TIMEZONE;  
console.log('⚙️ Timesheet Controller Config:');
console.log('   Plant:', PLANT_SSB);
console.log('   Timezone:', TIMEZONE);
const TIMESHEET_EXPORT_FIELDS = [
  'tsnumber',
  'activitytype',
  'operation_text',
  'confirmationnumber',
  'ssbr_ident',
  'date_checkin',
  'date_checkout',
  'full_name',
  'hour_checkin',
  'hour_checkout',
  'longdate_checkin',
  'longdate_checkout',
  'note',
  'operation_no',
  'order_no',
  'part_name',
  'planhours',
  'plant',
  'serialnumber',
  'state_flag',
  'std_foreman_hours',
  'validation_date',
  'workcentercode',
  'workcenterdescription',
  'duration',
  'modified_at'
];

const toTimesheetExportRow = (row) => (
  TIMESHEET_EXPORT_FIELDS.reduce((acc, field) => {
    acc[field] = field === 'ssbr_ident'
      ? (row.ssbr_ident ?? row.ssbr_id ?? null)
      : (row[field] ?? null);
    return acc;
  }, {})
);



/**
 * Get current date/time in the configured timezone
 */
const getCurrentDateTime = () => {
  return new Date();
};

/**
 * Format date as dd/mm/yyyy
 */
const formatDate = (date) => {
  return date.toLocaleDateString('id-ID', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/**
 * Format time as HH:MM
 * Note: locale id-ID returns "." separator, so we always normalize to ":"
 */
const formatTime = (date) => {
  const time = date.toLocaleTimeString('id-ID', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return time.replace('.', ':');
};

/**
 * Validation schema for export queries
 */
const schemas = {
  export: {
    field: { type: 'string', optional: true, default: 'longdate_checkout' },
    start: { type: 'string', optional: true },
    end: { type: 'string', optional: true }
  }
};

/**
 * Simple input validator
 */
const validateInput = (schema, data) => {
  const validated = {};
  for (const key in schema) {
    const rule = schema[key];
    if (data[key] !== undefined) {
      validated[key] = data[key];
    } else if (rule.default !== undefined) {
      validated[key] = rule.default;
    } else if (!rule.optional) {
      throw new Error(`Validation failed: ${key} is required`);
    }
  }
  return validated;
};

const normalizeText = (value) => (value ?? "").toString().trim();

const clampInteger = (value, fallback, min, max) => {
  if (String(value || "").trim().toLowerCase() === "all") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const inferActivityType = ({ id_unprod, activitytype, operation_text, order_no, operation_no }) => {
  const explicit = normalizeText(id_unprod || activitytype);
  if (explicit) return explicit;

  
  
  
  if (order_no || operation_no) return null;

  const match = normalizeText(operation_text).match(/^(\d{4})\b|^(\d{4})(?=[A-Za-z])/);
  return match ? (match[1] || match[2]) : null;
};





const MEAL_BREAK_ACTIVITY = '0000';
const MEAL_BREAK_MAX_MINUTES = 90;



async function closeStaleMealBreaks(serialnumber) {
  try {
    const result = await db.query(
      `UPDATE timesheet_transaction
       SET longdate_checkout = longdate_checkin + interval '90 minutes',
           date_checkout    = to_char(longdate_checkin + interval '90 minutes', 'DD/MM/YYYY'),
           hour_checkout    = to_char(longdate_checkin + interval '90 minutes', 'HH24:MI'),
           duration         = 1.5
       WHERE activitytype = '0000'
         AND date_checkout IS NULL
         AND longdate_checkin + interval '90 minutes' <= NOW()
         ${serialnumber ? 'AND serialnumber = $1' : ''}
       RETURNING tsnumber`,
      serialnumber ? [serialnumber] : []
    );
    if (result.rows.length > 0) {
      console.log(`[meal-break] auto checkout ${result.rows.length} record${serialnumber ? ` (${serialnumber})` : ''}`);
    }
    return result.rows;
  } catch (err) {
    console.error('closeStaleMealBreaks error:', err);
    return [];
  }
}

// Penutup otomatis berkala: meal break yang terlupakan (>90 menit) tetap ditutup
// walau operator tidak pernah scan lagi. Interval 5 menit; unref supaya tidak
// menahan proses server saat shutdown.
setInterval(() => { closeStaleMealBreaks(null).catch(() => {}); }, 5 * 60 * 1000).unref?.();

const isUnproductiveRow = (row) => Boolean(inferActivityType(row));

/**
 * Fase 6 (D4c) — apakah (order_no, operation_no) sedang bertanda subcont?
 * Kunci order dinormalisasi dengan ltrim(...,'0'), sama seperti seluruh kodebase
 * (getSowOrderOperations, listBaySchedules).
 *
 * CATATAN DEPLOY: public.sow_subcont_mark baru ada setelah migrasi
 * database/migrations/api/20260803b_sow_subcont_mark.sql dijalankan. Selama tabelnya belum
 * ada, error 42P01 (undefined_table) diperlakukan sebagai "tidak ada tanda" supaya check-in
 * operator NFC tidak ikut mati — tanpa tabel memang mustahil ada tanda aktif, jadi ini bukan
 * kompromi keamanan. Error lain tetap dilempar.
 */
const isSubcontMarked = async (orderNo, operationNo) => {
  const order = normalizeText(orderNo);
  const operation = Number.parseInt(operationNo, 10);
  if (!order || !Number.isFinite(operation)) return false;
  try {
    const result = await db.query(
      `SELECT 1
         FROM public.sow_subcont_mark scm
        WHERE ltrim(scm.order_no, '0') = ltrim($1, '0')
          AND scm.operation_no = $2
          AND scm.unmarked_at IS NULL
        LIMIT 1`,
      [order, operation]
    );
    return result.rowCount > 0;
  } catch (err) {
    if (err && err.code === '42P01') {
      console.warn('⚠️ sow_subcont_mark belum ada — guard subcont dilewati (jalankan migrasi 20260803b)');
      return false;
    }
    throw err;
  }
};

// ============ QUERY HANDLERS ============

/**
 * GET all timesheet records with pagination
 * Query params: page (default: 1), limit (default: 50, max: 1000)
 * Example: /api/timesheet?page=2&limit=100
 */
exports.getAll = async (req, res) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    // Validation
    if (page < 1) {
      return res.status(400).json({ error: 'Page must be >= 1' });
    }
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'Limit must be between 1 and 1000' });
    }

    const offset = (page - 1) * limit;

    // Get total count for pagination metadata
    const countResult = await db.query(
      `SELECT COUNT(*) FROM timesheet_transaction`
    );
    const totalRecords = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated data
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       ORDER BY tsnumber DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (err) {
    console.error('getAll error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Search timesheet records by field and value/range
 */
exports.search = async (req, res) => {
  try {
    const { field, value, start, end } = req.query;
    const allowedFields = ["serialnumber", "full_name", "longdate_checkin"];
    const limit = clampInteger(req.query.limit, 500, 1, 2000);
    
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: "Invalid field. Allowed: " + allowedFields.join(', ') });
    }

    let query;
    let params;

    if (start && end) {
      if (field === 'longdate_checkin') {
        query = `SELECT * FROM timesheet_transaction
                 WHERE longdate_checkin >= $1::date
                   AND longdate_checkin <  ($2::date + interval '1 day')
                 ORDER BY longdate_checkin ASC`;
      } else {
        query = `SELECT * FROM timesheet_transaction
                 WHERE DATE(${field}) BETWEEN $1 AND $2
                 ORDER BY longdate_checkin ASC`;
      }
      params = [start, end];
    } else if (value) {
      if (field === 'longdate_checkin') {
        query = `SELECT * FROM timesheet_transaction
                 WHERE longdate_checkin >= $1::date
                   AND longdate_checkin <  ($1::date + interval '1 day')
                 ORDER BY longdate_checkin ASC`;
      } else {
        query = `SELECT * FROM timesheet_transaction
                 WHERE DATE(${field}) = $1
                 ORDER BY longdate_checkin ASC`;
      }
      params = [value];
    } else {
      return res.status(400).json({ error: "Missing value or range (start/end)" });
    }

    if (limit != null) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('search error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET timesheet records by serial number
 */
exports.getbysn = async (req, res) => {
  try {
    const { snkaryawan } = req.params;
    const limit = clampInteger(req.query.limit, 200, 1, 2000);
    const params = [snkaryawan];
    const limitClause = limit == null ? "" : ` LIMIT $${params.length + 1}`;
    if (limit != null) params.push(limit);

    // Lazy auto checkout: meal break yang sudah lewat 90 menit ditutup saat
    // record dibaca, jadi daftar tidak menampilkan istirahat menggantung.
    await closeStaleMealBreaks(snkaryawan);

    const result = await db.query(
      `SELECT t.*,
              COALESCE(NULLIF(t.part_name, ''), s.part_name) AS part_name
       FROM timesheet_transaction t
       LEFT JOIN sow s
         ON s.order_no      = t.order_no
        AND s.operation_no  = t.operation_no
       WHERE t.serialnumber = $1
       ORDER BY t.longdate_checkin DESC
       ${limitClause}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getbysn error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET timesheet record by employee name
 */
exports.getbyname = async (req, res) => {
  try {
    const { nama } = req.params;
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       WHERE full_name = $1`,
      [nama]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('getbyname error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET timesheet record by ID
 */
exports.getbyid = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM timesheet_transaction 
       WHERE tsnumber = $1`,
      [id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('getbyid error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============ CREATE/UPDATE OPERATIONS ============

/**
 * CREATE new timesheet entry (check-in)
 * Semua timestamp & format dihitung 100% di PostgreSQL pakai NOW() supaya konsisten
 */
exports.create = async (req, res) => {
  try {
    const {
      order_no,
      ssbr_id,
      part_name,
      serialnumber,
      full_name,
      operation_no,
      operation_text,
      workcentercode,
      workcenterdescription,
      planhours,
      id_unprod,
      activitytype,
      // Manufacturing bay-reservation link (nullable; salvaging callers omit these -> null)
      ms_area_code,
      ms_bay_codes,
      ms_task_id,
      ms_project_id,
      ms_bay_schedule_id
    } = req.body;

    // Validate required fields
    if (!serialnumber || !full_name) {
      return res.status(400).json({ error: 'serialnumber and full_name are required' });
    }

    // Fase 6 (D4c): operasi yang ditandai dikerjakan subcont tidak boleh di-timesheet internal.
    // Route POST /timesheet sengaja ada di ALLOWLIST RBAC (terbuka untuk operator NFC), jadi
    // blokirnya harus logika di controller, bukan izin. Baris non-produktif (unprod) tidak punya
    // order_no/operation_no sehingga tidak pernah kena guard ini.
    if (await isSubcontMarked(order_no, operation_no)) {
      return res.status(409).json({
        error: 'Operasi ini dikerjakan subcont — tidak bisa di-timesheet internal',
      });
    }

    const PLANT_SSB = process.env.PLANT_SSB;
    const normalizedActivityType = inferActivityType({
      id_unprod,
      activitytype,
      operation_text,
      order_no,
      operation_no
    });

    // Meal break berakhir saat pekerjaan produktif dimulai: tutup activitytype
    // '0000' yang masih terbuka untuk orang ini (mode multiple, di mana checkout
    // umum tidak berjalan). Mode single sudah menutup semuanya lewat checkout.
    if (!normalizedActivityType && serialnumber) {
      await db.query(
        `UPDATE timesheet_transaction
         SET longdate_checkout = NOW(),
             date_checkout    = to_char(NOW(), 'DD/MM/YYYY'),
             hour_checkout    = to_char(NOW(), 'HH24:MI'),
             duration         = ROUND(EXTRACT(EPOCH FROM (NOW() - longdate_checkin)) / 3600.0, 2)
         WHERE serialnumber = $1
           AND activitytype = '0000'
           AND date_checkout IS NULL`,
        [serialnumber]
      );
    }

    const result = await db.query(
      `INSERT INTO timesheet_transaction
        (order_no, ssbr_id, part_name, serialnumber, full_name, operation_no, operation_text,
         workcentercode, workcenterdescription, planhours, longdate_checkin,
         date_checkin, hour_checkin, plant, activitytype,
         ms_area_code, ms_bay_codes, ms_task_id, ms_project_id, ms_bay_schedule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(),
         to_char(NOW(), 'DD/MM/YYYY'),
         to_char(NOW(), 'HH24:MI'),
         $11, $12,
         $13, $14::text[], $15, $16, $17)
       RETURNING *`,
      [
        order_no,
        ssbr_id,
        part_name,
        serialnumber,
        full_name,
        operation_no,
        operation_text,
        workcentercode,
        workcenterdescription,
        planhours,
        PLANT_SSB,
        normalizedActivityType,
        ms_area_code ?? null,
        ms_bay_codes ?? null,
        ms_task_id ?? null,
        ms_project_id ?? null,
        ms_bay_schedule_id ?? null
      ]
    );

    // Best-effort: mark the source bay reservation CONFIRMED once an operator checks in
    // under it. Non-fatal — a failed flip must never fail the check-in.
    if (ms_bay_schedule_id) {
      try {
        await db.query(
          `UPDATE ms_project_bay_schedule
             SET status = 'CONFIRMED',
                 updated_at = now()
           WHERE schedule_id = $1
             AND status = 'RESERVED'`,
          [ms_bay_schedule_id]
        );
      } catch (flipErr) {
        console.error('bay schedule RESERVED->CONFIRMED flip failed (non-fatal):', flipErr.message);
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('create error:', err);
    res.status(500).json({ error: 'Error inserting data: ' + err.message });
  }
};
 
/**
 * UPDATE timesheet - checkout by serial number
 */
exports.checkout = async (req, res) => {
  console.log("API CHECKOUT KE-TRIGGER");
  console.log("req.body:", req.body);
  try {
    const { datakaryawan } = req.body;

    if (!datakaryawan?.sn) {
      return res.status(400).json({ error: 'datakaryawan.sn is required' });
    }

    const serialnumber = datakaryawan.sn;

    // Meal break >90 menit ditutup dulu (auto checkout), agar hasil checkout
    // umum tidak menyisakan record istirahat yang menggantung.
    const closedMeal = await closeStaleMealBreaks(serialnumber);

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET longdate_checkout = NOW(),
           date_checkout = to_char(NOW(), 'DD/MM/YYYY'),
           hour_checkout = to_char(NOW(), 'HH24:MI'),
           duration = ROUND(
             EXTRACT(EPOCH FROM (NOW() - longdate_checkin)) / 3600.0, 2
           )
       WHERE serialnumber = $1
         AND date_checkout IS NULL
       RETURNING *`,
      [serialnumber]
    );

    if (result.rows.length === 0) {
      if (closedMeal.length > 0) {
        return res.json({ auto_closed_meal_break: closedMeal.length });
      }
      return res.status(404).json({ error: "Data tidak ditemukan atau sudah checkout" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('checkout error:', err);
    res.status(500).json({ error: 'Error updating data: ' + err.message });
  }
};

/**
 * UPDATE timesheet - checkout unprod entries only (activitytype IS NOT NULL)
 * Digunakan saat mode=multiple agar productive activity tidak ikut ter-checkout
 */
exports.checkoutUnprod = async (req, res) => {
  try {
    const { datakaryawan } = req.body;

    if (!datakaryawan?.sn) {
      return res.status(400).json({ error: 'datakaryawan.sn is required' });
    }

    const serialnumber = datakaryawan.sn;
    const workcentercode = normalizeText(datakaryawan.workcentercode || datakaryawan.workcenter);
    const params = [serialnumber];

    // Auto checkout meal break yang sudah lewat 90 menit sebelum menutup unprod.
    await closeStaleMealBreaks(serialnumber);
    let workcenterFilter = '';

    if (workcentercode) {
      params.push(workcentercode);
      workcenterFilter = `
         AND COALESCE(NULLIF(TRIM(workcentercode), ''), '') = $${params.length}`;
    }

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET longdate_checkout = NOW(),
           date_checkout = to_char(NOW(), 'DD/MM/YYYY'),
           hour_checkout = to_char(NOW(), 'HH24:MI'),
           duration = ROUND(
             EXTRACT(EPOCH FROM (NOW() - longdate_checkin)) / 3600.0, 2
           )
       WHERE serialnumber = $1
         AND date_checkout IS NULL
         ${workcenterFilter}
         AND (
           NULLIF(TRIM(activitytype), '') IS NOT NULL
           OR (
             order_no IS NULL
             AND operation_no IS NULL
             AND operation_text ~ '^\\s*\\d{4}'
           )
         )
       RETURNING *`,
      params
    );

    // Tidak ada unprod terbuka bukan error — kembalikan array kosong
    res.json(result.rows);
  } catch (err) {
    console.error('checkoutUnprod error:', err);
    res.status(500).json({ error: 'Error updating data: ' + err.message });
  }
};

/**
 * UPDATE timesheet - checkout by tsnumber (ID)
 */
exports.checkoutid = async (req, res) => {
  try {
    const { tsnumber } = req.body;

    if (!tsnumber) {
      return res.status(400).json({ error: 'tsnumber is required' });
    }

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET longdate_checkout = NOW(),
           date_checkout = to_char(NOW(), 'DD/MM/YYYY'),
           hour_checkout = to_char(NOW(), 'HH24:MI'),
           duration = ROUND(
             EXTRACT(EPOCH FROM (NOW() - longdate_checkin)) / 3600.0, 2
           )
       WHERE tsnumber = $1
         AND date_checkout IS NULL
       RETURNING *`,
      [tsnumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Data tidak ditemukan atau sudah checkout' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('checkoutid error:', err);
    res.status(500).json({ error: 'Error updating data: ' + err.message });
  }
};

/**
 * BULK validation of timesheet records
 */
exports.bulkValidation = async (req, res) => {
  try {
    const { tsnumbers } = req.body;

    if (!Array.isArray(tsnumbers) || tsnumbers.length === 0) {
      return res.status(400).json({ 
        error: 'tsnumbers must be a non-empty array' 
      });
    }

    const validation_date = getCurrentDateTime();
    const state_flag = "2";

    const result = await db.query(
      `UPDATE timesheet_transaction
       SET validation_date = $1,
           state_flag = $2
       WHERE tsnumber = ANY($3)
         AND date_checkout IS NOT NULL
         AND validation_date IS NULL
       RETURNING *`,
      [validation_date, state_flag, tsnumbers]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No records updated. Records may already be validated or not checked out.' 
      });
    }

    res.json({
      updated_count: result.rows.length,
      updated_rows: result.rows
    });
  } catch (err) {
    console.error('bulkValidation error:', err);
    res.status(500).json({ error: 'Error updating bulk validation: ' + err.message });
  }
};

/**
 * UPDATE timesheet record (admin function)
 */
exports.updateTimesheetadmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      serialnumber,
      full_name,
      order_no,
      ssbr_id,
      operation_text,
      operation_no,
      workcentercode,
      workcenterdescription,
      longdate_checkin,
      longdate_checkout
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'ID parameter is required' });
    }

    if (!serialnumber?.trim()) {
      return res.status(400).json({ error: 'Serial number is required' });
    }

    const query = `
      UPDATE timesheet_transaction SET
        serialnumber = $1,
        full_name = $2,
        order_no = $3,
        ssbr_id = $4,
        operation_text = $5,
        operation_no = $6,
        workcentercode = $7,
        workcenterdescription = $8,
        longdate_checkin = $9::timestamptz,
        date_checkin = CASE
          WHEN $9 IS NOT NULL
          THEN to_char($9::timestamptz, 'DD/MM/YYYY')
          ELSE NULL
        END,
        hour_checkin = CASE
          WHEN $9 IS NOT NULL
          THEN to_char($9::timestamptz, 'HH24:MI')
          ELSE NULL
        END,
        longdate_checkout = $10::timestamptz,
        date_checkout = CASE
          WHEN $10 IS NOT NULL
          THEN to_char($10::timestamptz, 'DD/MM/YYYY')
          ELSE NULL
        END,
        hour_checkout = CASE
          WHEN $10 IS NOT NULL
          THEN to_char($10::timestamptz, 'HH24:MI')
          ELSE NULL
        END,
        duration = CASE
          WHEN $10 IS NOT NULL AND $9 IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM ($10::timestamptz - $9::timestamptz)) / 3600.0, 2)
          ELSE NULL
        END,
        state_flag = CASE
          WHEN $10 IS NOT NULL AND $9 IS NOT NULL
           AND ROUND(EXTRACT(EPOCH FROM ($10::timestamptz - $9::timestamptz)) / 3600.0, 2) = 0
          THEN '5'
          ELSE state_flag
        END,
        validation_date = CASE
          WHEN $10 IS NOT NULL AND $9 IS NOT NULL
           AND ROUND(EXTRACT(EPOCH FROM ($10::timestamptz - $9::timestamptz)) / 3600.0, 2) = 0
          THEN NULL
          ELSE validation_date
        END
      WHERE tsnumber = $11
      RETURNING *;
    `;

    const s = (v) => (v ?? "").toString().trim() || null;

    const values = [
      s(serialnumber),
      s(full_name),
      s(order_no),
      s(ssbr_id),
      s(operation_text),
      s(operation_no),
      s(workcentercode),
      s(workcenterdescription),
      longdate_checkin || null,
      longdate_checkout || null,
      id
    ];


    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Timesheet record not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateTimesheetadmin error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============ DELETE OPERATION ============

/**
 * DELETE timesheet record by ID
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `DELETE FROM timesheet_transaction WHERE tsnumber = $1 RETURNING tsnumber`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    res.json({ message: 'Deleted successfully', tsnumber: result.rows[0].tsnumber });
  } catch (err) {
    console.error('remove error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============ EXPORT FUNCTIONS ============

/**
 * Generate export in CSV or XLSX format
 */
const generateExport = async (req, res, format = 'csv') => {
  try {
    const validated = validateInput(schemas.export, req.query);
    const { field = 'longdate_checkout', start, end } = validated;

    if (!start || !end) {
      return res.status(400).json({
        error: 'Export wajib memakai rentang tanggal start dan end supaya server tidak menarik seluruh timesheet.'
      });
    }

    const params = [];
    let where = '';

    if (field === 'longdate_checkin' || field === 'longdate_checkout') {
      where = `WHERE ${field} >= $1::date AND ${field} < ($2::date + interval '1 day')`;
    } else {
      where = `WHERE DATE(${field}) BETWEEN $1 AND $2`;
    }
    params.push(start, end);

    const result = await db.query(
      `SELECT * FROM timesheet_transaction ${where} ORDER BY tsnumber DESC`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No data found for the specified criteria' });
    }

    const filename = start && end
      ? `timesheet_${field}_${start}_to_${end}.${format}`
      : `timesheet_transaction.${format}`;

    const exportRows = result.rows.map(toTimesheetExportRow);
    const fields = TIMESHEET_EXPORT_FIELDS;

    if (format === 'csv') {
      const parser = new Parser({ fields, delimiter: ';' });
      const csv = parser.parse(exportRows);

      res.header('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(filename);
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Timesheet');

      // Add header row
      ws.addRow(fields);

      // Add data rows
      exportRows.forEach(row => {
        ws.addRow(fields.map(f => row[f]));
      });

      // Auto-size columns
      fields.forEach((field, index) => {
        const col = ws.getColumn(index + 1);
        let maxLength = field.length;
        
        col.eachCell({ includeEmpty: true }, cell => {
          const cellValue = cell.value ? String(cell.value) : '';
          if (cellValue.length > maxLength) {
            maxLength = cellValue.length;
          }
        });
        
        col.width = Math.min(Math.max(maxLength + 2, 10), 60);
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      await wb.xlsx.write(res);
      return res.end();
    }
  } catch (err) {
    console.error(`${format.toUpperCase()} export error:`, err);
    const statusCode = err.message.includes('Validation') ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * Export timesheet data as CSV
 */
exports.getcsv = (req, res) => generateExport(req, res, 'csv');

/**
 * Export timesheet data as XLSX
 */
exports.getxlsx = (req, res) => generateExport(req, res, 'xlsx');

/* UPDATE FLEXIBLE*/
exports.partialUpdate = async (req, res) => {
  const { tsnumber } = req.params;
  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ message: "No data to update" });
  }

  const allowedFields = [
    "note",
    "hour_checkin",
    "hour_checkout",
    "date_checkin",
    "date_checkout",
    "state_flag",
    "std_foreman_hours",
    "planhours",
    "workcentercode",
    "workcenterdescription"
  ];

  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      setClauses.push(`${field} = $${idx++}`);
      values.push(payload[field]);
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ message: "No valid fields to update" });
  }

  values.push(tsnumber);

  try {
    const result = await db.query(
      `
      UPDATE timesheet_transaction
      SET ${setClauses.join(", ")}
      WHERE tsnumber = $${idx}
      RETURNING *
      `,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Timesheet not found" });
    }

    res.json({
      message: "Timesheet updated",
      data: result.rows[0]
    });
  } catch (err) {
    console.error("partialUpdate error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ============================================
// OPTIMIZED VALIDATION ENDPOINT
// Server-side: stats, grouped employee list, paginated records per group
// ============================================

/**
 * GET /timesheet/validation-stats
 * Returns stats + grouped employee summary (no individual records)
 * Query params: start, end, search (optional)
 */
exports.validationStats = async (req, res) => {
  try {
    let { start, end, search, status } = req.query;

    // Default: last 30 days
    if (!start || !end) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      start = thirtyDaysAgo.toISOString().split('T')[0];
      end = now.toISOString().split('T')[0];
    }

    // Build WHERE clause — range predicate (SARGable, uses idx_ts_longdate_checkin)
    let whereClauses = ['longdate_checkin >= $1::date AND longdate_checkin < ($2::date + interval \'1 day\')'];
    let params = [start, end];
    let paramIdx = 3;

    if (search && search.trim()) {
      const searchLike = `%${search.trim().toLowerCase()}%`;
      whereClauses.push(`(
        LOWER(serialnumber) LIKE $${paramIdx}
        OR LOWER(full_name) LIKE $${paramIdx}
        OR LOWER(workcentercode) LIKE $${paramIdx}
        OR LOWER(workcenterdescription) LIKE $${paramIdx}
        OR LOWER(order_no) LIKE $${paramIdx}
      )`);
      params.push(searchLike);
      paramIdx++;
    }

    const baseWhereClauses = [...whereClauses];
    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'pending') {
      whereClauses.push(`validation_date IS NULL AND COALESCE(state_flag::text, '') NOT IN ('3', '5')`);
    } else if (normalizedStatus === 'reject') {
      whereClauses.push(`state_flag::text = '3'`);
    } else if (normalizedStatus === 'validated') {
      whereClauses.push(`validation_date IS NOT NULL AND COALESCE(state_flag::text, '') <> '5'`);
    }

    const baseWhereSQL = baseWhereClauses.join(' AND ');
    const whereSQL = whereClauses.join(' AND ');

    const statsQuery = `
      SELECT
        COUNT(*)                                                               AS total_records,
        COALESCE(SUM(duration), 0)                                             AS total_hours,
        COUNT(DISTINCT serialnumber)                                           AS total_employees,
        COUNT(*) FILTER (WHERE validation_date IS NULL AND COALESCE(state_flag::text, '') NOT IN ('3', '5')) AS total_pending,
        COUNT(*) FILTER (WHERE state_flag::text = '3')                         AS total_reject,
        COUNT(*) FILTER (WHERE validation_date IS NOT NULL AND COALESCE(state_flag::text, '') <> '5') AS total_validated,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NULL AND COALESCE(state_flag::text, '') NOT IN ('3', '5')), 0) AS pending_hours,
        COALESCE(SUM(duration) FILTER (WHERE state_flag::text = '3'), 0)       AS reject_hours,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NOT NULL AND COALESCE(state_flag::text, '') <> '5'), 0) AS validated_hours
      FROM timesheet_transaction
      WHERE ${baseWhereSQL}
    `;

    const groupsQuery = `
      SELECT
        serialnumber,
        MAX(full_name)                                                          AS full_name,
        COUNT(*)                                                                AS record_count,
        COALESCE(SUM(duration), 0)                                             AS total_hours,
        COUNT(*) FILTER (WHERE validation_date IS NULL AND COALESCE(state_flag::text, '') NOT IN ('3', '5')) AS pending_count,
        COUNT(*) FILTER (WHERE state_flag::text = '3')                         AS reject_count,
        COUNT(*) FILTER (WHERE validation_date IS NOT NULL AND COALESCE(state_flag::text, '') <> '5') AS validated_count,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NULL AND COALESCE(state_flag::text, '') NOT IN ('3', '5')), 0) AS pending_hours,
        COALESCE(SUM(duration) FILTER (WHERE state_flag::text = '3'), 0)       AS reject_hours,
        COALESCE(SUM(duration) FILTER (WHERE validation_date IS NOT NULL AND COALESCE(state_flag::text, '') <> '5'), 0) AS validated_hours
      FROM timesheet_transaction
      WHERE ${whereSQL}
      GROUP BY serialnumber
      ORDER BY MAX(full_name) ASC
    `;
    const [statsResult, groupsResult] = await Promise.all([
      db.query(statsQuery, params.slice(0, paramIdx - 1)),
      db.query(groupsQuery, params)
    ]);
    const rows = groupsResult.rows;
    const first = statsResult.rows[0];

    res.json({
      stats: first ? {
        totalRecords:   parseInt(first.total_records),
        totalHours:     parseFloat(first.total_hours).toFixed(2),
        totalEmployees: parseInt(first.total_employees),
        totalPending:   parseInt(first.total_pending),
        totalReject:    parseInt(first.total_reject),
        totalValidated: parseInt(first.total_validated),
        pendingHours:   parseFloat(first.pending_hours).toFixed(2),
        rejectHours:    parseFloat(first.reject_hours).toFixed(2),
        validatedHours: parseFloat(first.validated_hours).toFixed(2)
      } : {
        totalRecords: 0, totalHours: '0.00', totalEmployees: 0,
        totalPending: 0, totalReject: 0, totalValidated: 0,
        pendingHours: '0.00', rejectHours: '0.00', validatedHours: '0.00'
      },
      groups: rows
    });
  } catch (err) {
    console.error('validationStats error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /timesheet/validation-group/:serialnumber
 * Returns records for one employee within date range
 * Query params: start, end
 */
exports.validationGroupRecords = async (req, res) => {
  try {
    const { serialnumber } = req.params;
    let { start, end, search, status } = req.query;

    if (!start || !end) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      start = thirtyDaysAgo.toISOString().split('T')[0];
      end = now.toISOString().split('T')[0];
    }

    // Build WHERE conditions dengan optional search
    let whereConditions = [
      't.serialnumber = $1',
      't.longdate_checkin >= $2::date AND t.longdate_checkin < ($3::date + interval \'1 day\')'
    ];
    let params = [serialnumber, start, end];
    let paramIdx = 4;

    // TAMBAH: Filter berdasarkan search term
    if (search && search.trim()) {
      const searchLike = `%${search.trim().toLowerCase()}%`;
      whereConditions.push(`(
        LOWER(t.order_no) LIKE $${paramIdx}
        OR LOWER(t.ssbr_id) LIKE $${paramIdx}
        OR LOWER(t.operation_text) LIKE $${paramIdx}
        OR LOWER(t.workcentercode) LIKE $${paramIdx}
        OR LOWER(t.workcenterdescription) LIKE $${paramIdx}
        OR LOWER(t.note) LIKE $${paramIdx}
        OR LOWER(t.part_name) LIKE $${paramIdx}
        OR LOWER(t.full_name) LIKE $${paramIdx}        -- TAMBAHKAN FULL_NAME
      )`);
      params.push(searchLike);
      paramIdx++;
    }

    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'pending') {
      whereConditions.push(`t.validation_date IS NULL AND COALESCE(t.state_flag::text, '') NOT IN ('3', '5')`);
    } else if (normalizedStatus === 'reject') {
      whereConditions.push(`t.state_flag::text = '3'`);
    } else if (normalizedStatus === 'validated') {
      whereConditions.push(`t.validation_date IS NOT NULL AND COALESCE(t.state_flag::text, '') <> '5'`);
    }

    const whereSQL = whereConditions.join(' AND ');

    const query = `
      SELECT
        t.tsnumber, t.serialnumber, t.full_name, t.order_no,
        t.ssbr_id, t.operation_text, t.operation_no, t.workcentercode,
        t.workcenterdescription, t.date_checkin, t.hour_checkin,
        t.date_checkout, t.hour_checkout, t.duration, t.note,
        t.planhours, t.std_foreman_hours, t.state_flag,
        t.validation_date, t.activitytype, t.part_name,
        s.planhours AS sow_planhours
      FROM timesheet_transaction t
      LEFT JOIN sow s ON s.codenumber = (t.order_no || t.operation_no::text)
      WHERE ${whereSQL}
      ORDER BY t.longdate_checkin ASC
    `;
    
    const result = await db.query(query, params);

    // Merge sow_planhours into planhours if planhours is empty
    const records = result.rows.map(r => {
      if (r.sow_planhours != null && (r.planhours == null || r.planhours === '')) {
        r.planhours = r.sow_planhours;
      }
      delete r.sow_planhours;
      return r;
    });

    res.json(records);
  } catch (err) {
    console.error('validationGroupRecords error:', err);
    res.status(500).json({ error: err.message });
  }
};

const buildOperatorPerformanceFilter = (alias, params, { start, end, workcenter } = {}) => {
  const clauses = [];
  if (start) {
    params.push(start);
    clauses.push(`${alias}.longdate_checkin >= $${params.length}::date`);
  }
  if (end) {
    params.push(end);
    clauses.push(`${alias}.longdate_checkin < ($${params.length}::date + interval '1 day')`);
  }
  if (workcenter && String(workcenter).trim()) {
    params.push(String(workcenter).trim());
    clauses.push(`${alias}.workcentercode = $${params.length}`);
  }
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
};

/**
 * GET /timesheet/operator-performance/workcenters
 */
exports.operatorPerformanceWorkcenters = async (req, res) => {
  try {
    const { start, end } = req.query;
    const params = [];
    const filter = buildOperatorPerformanceFilter('v', params, { start, end });
    const result = await db.query(
      `SELECT
         v.workcentercode,
         MAX(v.workcenterdescription) AS workcenterdescription
       FROM public.vw_timesheet_std_performance v
       WHERE v.workcentercode IS NOT NULL
         AND BTRIM(v.workcentercode) <> ''
         ${filter}
       GROUP BY v.workcentercode
       ORDER BY v.workcentercode ASC`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('operatorPerformanceWorkcenters error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /timesheet/operator-performance/orders
 * Grouped SOW table for Operator Performance.
 *
 * Fase 6 (D4) — SENGAJA TIDAK memakai predikat eksklusi subcont, walau rencana
 * (docs/MFG_PLAN_AREA_PLAN.md §4 Fase 6) menyebut baris ini. Alasannya:
 *  1. Baris di sini datang dari `metrics` (INNER JOIN ke vw_timesheet_std_performance), jadi
 *     hanya operasi yang BENAR-BENAR punya timesheet yang muncul. Operasi bertanda subcont
 *     diblokir dari check-in (D4c), jadi ke depan ia tidak akan pernah masuk ke sini.
 *  2. Ini laporan retrospektif rencana-vs-aktual, bukan beban internal outstanding. Kalau
 *     sebuah operasi ditandai subcont SETELAH operator terlanjur kerja, membuang barisnya
 *     juga akan menghapus elapsed_seconds/std_performance-nya — menyembunyikan jam kerja
 *     yang nyata. Membuang planhours-nya saja pun merusak rasio (plan dan aktual jadi beda
 *     cakupan operasi).
 */
exports.operatorPerformanceOrders = async (req, res) => {
  try {
    const { search, start, end, workcenter } = req.query;
    const params = [];
    const where = [];
    const metricFilter = buildOperatorPerformanceFilter('v', params, { start, end, workcenter });

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where.push(`(
        LOWER(s.order_no) LIKE $${params.length}
        OR LOWER(COALESCE(s.ssbr_id, '')) LIKE $${params.length}
        OR LOWER(COALESCE(s.part_name, '')) LIKE $${params.length}
      )`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const query = `
      WITH metrics AS (
        SELECT
          v.order_no,
          v.operation_no,
          SUM(v.elapsed_seconds) AS elapsed_seconds,
          SUM(v.std_performance) AS std_performance
        FROM public.vw_timesheet_std_performance v
        WHERE 1=1 ${metricFilter}
        GROUP BY v.order_no, v.operation_no
      )
      SELECT
        s.order_no,
        (ARRAY_AGG(s.ssbr_id ORDER BY s.operation_no))[1] AS ssbr_id,
        (ARRAY_AGG(s.part_name ORDER BY s.operation_no))[1] AS part_name,
        COUNT(*)::int AS operation_count,
        COALESCE(SUM(s.planhours), 0) AS planhours,
        COALESCE(SUM(m.elapsed_seconds), 0) AS elapsed_seconds,
        COALESCE(SUM(m.std_performance), 0) AS std_performance
      FROM metrics m
      JOIN public.sow s
        ON s.order_no = m.order_no
       AND s.operation_no = m.operation_no
      ${whereSQL}
      GROUP BY s.order_no
      ORDER BY s.order_no DESC
      LIMIT 300
    `;

    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('operatorPerformanceOrders error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /timesheet/operator-performance/orders/:orderNo/operations
 */
exports.operatorPerformanceOperations = async (req, res) => {
  try {
    const { orderNo } = req.params;
    const { start, end, workcenter } = req.query;
    const metricParams = [orderNo];
    const metricFilter = buildOperatorPerformanceFilter('v', metricParams, { start, end, workcenter });

    const query = `
      WITH metrics AS (
        SELECT
          v.order_no,
          v.operation_no,
          COUNT(*)::int AS transaction_count,
          SUM(v.elapsed_seconds) AS elapsed_seconds,
          SUM(v.std_performance) AS std_performance
        FROM public.vw_timesheet_std_performance v
        WHERE v.order_no = $1 ${metricFilter}
        GROUP BY v.order_no, v.operation_no
      )
      SELECT
        s.idsow,
        s.order_no,
        s.operation_no,
        s.ssbr_id,
        s.part_name,
        s.operation_text,
        s.workcenter,
        s.workcenterdescription,
        COALESCE(s.planhours, 0) AS planhours,
        COALESCE(m.transaction_count, 0) AS transaction_count,
        COALESCE(m.elapsed_seconds, 0) AS elapsed_seconds,
        COALESCE(m.std_performance, 0) AS std_performance
      FROM metrics m
      JOIN public.sow s
        ON s.order_no = m.order_no
       AND s.operation_no = m.operation_no
      ORDER BY s.operation_no ASC
    `;

    const result = await db.query(query, metricParams);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('operatorPerformanceOperations error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /timesheet/operator-performance/orders/:orderNo/operations/:operationNo/timesheets
 */
exports.operatorPerformanceTransactions = async (req, res) => {
  try {
    const { orderNo, operationNo } = req.params;
    const { start, end, workcenter } = req.query;
    const params = [orderNo, operationNo];
    const filter = buildOperatorPerformanceFilter('v', params, { start, end, workcenter });

    const query = `
      SELECT
        v.tsnumber,
        v.longdate_checkin,
        v.full_name,
        v.serialnumber,
        v.remaining_seconds_before,
        v.elapsed_seconds,
        v.std_performance
      FROM public.vw_timesheet_std_performance v
      WHERE v.order_no = $1
        AND v.operation_no = $2::int
        ${filter}
      ORDER BY v.longdate_checkin ASC NULLS LAST, v.tsnumber ASC
    `;

    const result = await db.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('operatorPerformanceTransactions error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /timesheet/post-to-sap
 * Build SAP payloads for given tsnumbers and POST each one sequentially to SAP.
 * Requires body: { tsnumbers: string[] }
 * Returns per-item results so caller can show success/failure per record.
 */
const formatZTIMESHEETID = (tsnumber) => {
  const prefix = String(process.env.ID_TIMESHEET || '');
  const numStr = String(tsnumber || '');
  const zeros  = '0'.repeat(Math.max(0, 10 - prefix.length - numStr.length));
  return prefix + zeros + numStr;
};

exports.postToSap = async (req, res) => {
  const SAP_URL      = process.env.SAP_INBOUND_URL;
  const SAP_USER     = process.env.SAP_INBOUND_USERNAME;
  const SAP_PASSWORD = process.env.SAP_INBOUND_PASSWORD;
  const ID_TIMESHEET = process.env.ID_TIMESHEET;
  const TIMEZONE     = process.env.TIMEZONE;
  const TGT_TABLE    = process.env.TGT_TABLE;

  if (!SAP_URL || !SAP_USER || !SAP_PASSWORD) {
    return res.status(500).json({ error: 'SAP credentials not configured in .env' });
  }
  if (!ID_TIMESHEET || !TIMEZONE || !TGT_TABLE) {
    return res.status(500).json({ error: 'ID_TIMESHEET, TIMEZONE, or TGT_TABLE not configured in .env' });
  }

  const { tsnumbers } = req.body;
  if (!Array.isArray(tsnumbers) || tsnumbers.length === 0) {
    return res.status(400).json({ error: 'tsnumbers must be a non-empty array' });
  }

  // Fetch full timesheet data + production_operations lookup in one query
  const query = `
    SELECT
      t.tsnumber,
      t.serialnumber,
      t.order_no,
      t.operation_no,
      t.workcentercode,
      t.activitytype,
      t.operation_text,
      t.plant,
      TO_CHAR(t.longdate_checkin  AT TIME ZONE $2, 'YYYYMMDD') AS isdd,
      TO_CHAR(t.longdate_checkin  AT TIME ZONE $2, 'HH24MISS') AS isdz,
      TO_CHAR(t.longdate_checkout AT TIME ZONE $2, 'YYYYMMDD') AS iedd,
      TO_CHAR(t.longdate_checkout AT TIME ZONE $2, 'HH24MISS') AS iedz,
      po.confirmation_number       AS confirmation_number,
      po.sequence_category  AS sequence_category,
      po.sequence_number    AS sequence_number,
      po.branch_operation_no   AS branch_operation_no,
      po.return_operation_no   AS return_operation_no
    FROM timesheet_transaction t
    LEFT JOIN ${TGT_TABLE} po
      ON LTRIM(po.order_no,     '0') = t.order_no
     AND LTRIM(po.operation_no, '0') = t.operation_no::text
    WHERE t.tsnumber = ANY($1::int[])
  `;

  let rows;
  try {
    const result = await db.query(query, [tsnumbers.map(Number), TIMEZONE]);
    rows = result.rows;
  } catch (err) {
    console.error('postToSap DB error:', err);
    return res.status(500).json({ error: 'DB query failed: ' + err.message });
  }

  // Build Basic Auth header (server-side — credentials never exposed to browser)
  const basicAuth = 'Basic ' + Buffer.from(`${SAP_USER}:${SAP_PASSWORD}`).toString('base64');

  const results = [];

  for (const row of rows) {
    const activityType = inferActivityType(row);
    const isUnprod = Boolean(activityType);
    const payload = {
      ZTIMESHEETID: formatZTIMESHEETID(row.tsnumber),
      PERNR:        String(row.serialnumber || '').padStart(8, '0'),
      RUECK:        isUnprod ? '' : String(row.confirmation_number || ''),
      AUFNR:        isUnprod ? '' : String(row.order_no || '').padStart(12, '0'),
      VORNR:        isUnprod ? '' : String(row.operation_no || '').padStart(4, '0'),
      FLGAT:        isUnprod ? '' : String(row.sequence_category || ''),
      PLNFL:        isUnprod ? '' : String(row.sequence_number || ''),
      VORNR_B:      isUnprod ? '' : String(row.branch_operation_no || ''),
      VORNR_R:      isUnprod ? '' : String(row.return_operation_no || ''),
      //ZCONF_TYPE:   String('M1'),
      ZCONF_TYPE:   isUnprod                                          ? ''
                  : String(row.workcentercode || '').endsWith('OT')   ? 'OV'
                  : String(row.order_no || '').startsWith('32')       ? 'RW'
                  : 'RG',
      ARBPL:        String(row.workcentercode || ''),
      LSTAR:        String(activityType || ''),
      ISDD:         String(row.isdd || ''),
      ISDZ:         String(row.isdz || ''),
      IEDD:         String(row.iedd || ''),
      IEDZ:         String(row.iedz || ''),
      WERKS:        String(row.plant || ''),
      AUERU:        '',
      ZBARCODEID:   '',
    };

    console.log(`[SAP] Sending tsnumber=${row.tsnumber}`, JSON.stringify(payload, null, 2));

    try {
      const sapRes = await fetch(SAP_URL, {
        method:  'POST',
        headers: {
          'Authorization': basicAuth,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify(payload)
      });

      const text = await sapRes.text();
      console.log(`[SAP] tsnumber=${row.tsnumber} → HTTP ${sapRes.status}: ${text}`);

      // Parse SAP response to extract STATUS and MESSAGE
      let sapMessage = '';
      let sapStatus  = '';
      try {
        const parsed = JSON.parse(text);
        const res    = parsed['n0:ABM_CPP_223_MT_Timesheet_Res'] || {};
        sapMessage   = res.MESSAGE || '';
        sapStatus    = res.STATUS  || '';
      } catch (_) {
        sapMessage = text;
      }

      const isConfirmed = sapStatus === 'S';

      if (isConfirmed) {
        // SAP accepted — validation flag=2 stays as-is
        console.log(`[SAP] tsnumber=${row.tsnumber} → SUCCESS (STATUS=S): ${sapMessage}`);
        results.push({
          tsnumber:   row.tsnumber,
          status:     sapRes.status,
          ok:         true,
          sapMessage,
          response:   text
        });
      } else {
        // SAP rejected — revert to flag='3' (SAP Reject), clear validation_date
        console.warn(`[SAP] tsnumber=${row.tsnumber} → REJECTED: ${sapMessage}`);
        await db.query(
          `UPDATE timesheet_transaction
             SET state_flag = '3', validation_date = NULL
           WHERE tsnumber = $1`,
          [row.tsnumber]
        );
        results.push({
          tsnumber:   row.tsnumber,
          status:     sapRes.status,
          ok:         false,
          sapMessage,
          response:   text
        });
      }
    } catch (err) {
      console.error(`[SAP] tsnumber=${row.tsnumber} → ERROR: ${err.message}`);
      // Network/parse error — also revert to SAP Reject
      await db.query(
        `UPDATE timesheet_transaction
           SET state_flag = '3', validation_date = NULL
         WHERE tsnumber = $1`,
        [row.tsnumber]
      ).catch(() => {});
      results.push({
        tsnumber:   row.tsnumber,
        status:     0,
        ok:         false,
        sapMessage: err.message,
        response:   err.message
      });
    }

    // Log every SAP attempt to log_timesheet_sap (fire-and-forget, never interrupts flow)
    const lastResult  = results[results.length - 1];
    const _raw        = lastResult?.response ?? lastResult?.sapMessage ?? '';
    let sapResponse;
    try {
      const _parsed = JSON.parse(_raw);
      const _res    = _parsed['n0:ABM_CPP_223_MT_Timesheet_Res'] || {};
      const _status = _res.STATUS === 'S' ? 'SUCCESS' : 'ERROR';
      sapResponse   = `${_status} : ${_res.MESSAGE || _raw}`;
    } catch (_) {
      sapResponse = _raw;
    }
    try {
      await db.query(`
        INSERT INTO log_timesheet_sap (
          ztimesheetid, pernr, confirmation_number, order_no, operation_no,
          sequence_category, sequence_number, branch_operation_no, return_operation_no,
          zconf_type, work_center, activity_type,
          start_date, start_time, end_date, end_time, plant_code, final_completed_indicator, zbarcodeid,
          sap_response
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20
        )
      `, [
        payload.ZTIMESHEETID, payload.PERNR, payload.RUECK, payload.AUFNR,
        payload.VORNR, payload.FLGAT, payload.PLNFL, payload.VORNR_B,
        payload.VORNR_R, payload.ZCONF_TYPE, payload.ARBPL, payload.LSTAR,
        payload.ISDD, payload.ISDZ, payload.IEDD, payload.IEDZ,
        payload.WERKS, payload.AUERU, payload.ZBARCODEID,
        sapResponse
      ]);
    } catch (logErr) {
      console.error(`[SAP] log insert failed for tsnumber=${row.tsnumber}:`, logErr.message);
    }

    // Small delay between calls (mirrors testantri.js pattern)
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const successCount = results.filter(r => r.ok).length;
  const failCount    = results.length - successCount;

  res.json({ successCount, failCount, results });
};

/**
 * GET /timesheet/log-sap
 * Returns SAP post log with employee name joined from timesheet_transaction.
 */
exports.getLogSap = async (req, res) => {
  const PAGE_SIZE = 100;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  try {
    const [dataResult, countResult] = await Promise.all([
      db.query(`
        SELECT
          l.id,
          l.ztimesheetid,
          l.pernr,
          (SELECT full_name FROM timesheet_transaction
            WHERE serialnumber = l.pernr LIMIT 1) AS full_name,
          l.order_no,
          l.confirmation_number,
          l.operation_no,
          l.zconf_type,
          l.work_center,
          l.activity_type,
          l.start_date,
          l.start_time,
          l.end_date,
          l.end_time,
          l.plant_code,
          l.sap_response,
          l.created_at
        FROM log_timesheet_sap l
        ORDER BY l.id DESC
        LIMIT $1 OFFSET $2
      `, [PAGE_SIZE, offset]),
      db.query('SELECT COUNT(*) FROM log_timesheet_sap'),
    ]);
    res.json({
      rows:      dataResult.rows,
      total:     parseInt(countResult.rows[0].count),
      page,
      pageSize:  PAGE_SIZE,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / PAGE_SIZE),
    });
  } catch (err) {
    console.error('getLogSap error:', err);
    res.status(500).json({ error: 'Terjadi error saat ambil data log SAP' });
  }
};
