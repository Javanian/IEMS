const db = global.pool || require('../db');
const pgPool = db.pool || db;
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');

const SOW_HISTORY_COLUMNS = `
  idsow,
  customer,
  order_no,
  ssbr_id,
  operation_no,
  operation_text,
  workcenterdescription AS operation_name,
  planhours,
  va_hours,
  nnva_hours,
  wct_group,
  workcenter,
  status,
  part_number,
  part_name,
  model,
  created_at,
  updated_at
`;

const EDITABLE_SOW_COLUMNS = [
  'order_no',
  'operation_no',
  'ssbr_id',
  'part_number',
  'part_name',
  'model',
  'customer',
  'location',
  'wct_group',
  'workcenter',
  'operation_text',
  'workcenterdescription',
  'planhours',
  'va_hours',
  'nnva_hours',
  'systemstatus',
  'confirmation',
  'status',
  'finish_date',
  'weight',
  'created_by',
  'type',
  'group',
  'category',
  'remark',
  'sync',
  'plan_start',
  'plan_finish',
  'actual_start',
  'actual_finish',
  'actual_progress',
  'actual_hours',
  'progress',
  'revision_no',
  'source_op_id',
];

let sowRuntimeColumnsReady = false;
let sowRuntimeColumnsPromise = null;
let sowRevisionHistoryReady = false;
let sowRevisionHistoryPromise = null;
let sowDraftReady = false;
let sowDraftPromise = null;
let sowSavedReady = false;
let sowSavedPromise = null;

async function ensureSowRuntimeColumns() {
  if (sowRuntimeColumnsReady) return;
  if (sowRuntimeColumnsPromise) return sowRuntimeColumnsPromise;
  sowRuntimeColumnsPromise = (async () => {
    await db.query(
      `ALTER TABLE public.sow ADD COLUMN IF NOT EXISTS revision_no INTEGER NOT NULL DEFAULT 0`
    );
    await db.query(`ALTER TABLE public.sow ADD COLUMN IF NOT EXISTS source_op_id BIGINT`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sow_source_op_id ON public.sow (source_op_id)`);

    await db.query(`ALTER TABLE public.sow ADD COLUMN IF NOT EXISTS va_hours NUMERIC`);
    await db.query(`ALTER TABLE public.sow ADD COLUMN IF NOT EXISTS nnva_hours NUMERIC`);
    sowRuntimeColumnsReady = true;
  })().finally(() => {
    sowRuntimeColumnsPromise = null;
  });
  return sowRuntimeColumnsPromise;
}

async function ensureSowRevisionHistoryTable() {
  if (sowRevisionHistoryReady) return;
  if (sowRevisionHistoryPromise) return sowRevisionHistoryPromise;
  sowRevisionHistoryPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sow_revision_history (
        id BIGSERIAL PRIMARY KEY,
        order_no TEXT NOT NULL,
        revision_no INTEGER NOT NULL,
        action TEXT NOT NULL DEFAULT 'edit',
        before_data JSONB,
        after_data JSONB,
        changed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (order_no, revision_no)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sow_revision_history_order_created
        ON sow_revision_history (order_no, created_at DESC)
    `);
    await ensureSowRuntimeColumns();
    sowRevisionHistoryReady = true;
  })().finally(() => {
    sowRevisionHistoryPromise = null;
  });
  return sowRevisionHistoryPromise;
}

async function ensureSowDraftTable() {
  if (sowDraftReady) return;
  if (sowDraftPromise) return sowDraftPromise;
  sowDraftPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sow_draft (
        id         BIGSERIAL PRIMARY KEY,
        user_key   TEXT NOT NULL,
        context    TEXT NOT NULL,
        ref_key    TEXT NOT NULL DEFAULT '',
        payload    JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_key, context, ref_key)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sow_draft_user_updated
        ON sow_draft (user_key, updated_at DESC)
    `);
    sowDraftReady = true;
  })().finally(() => {
    sowDraftPromise = null;
  });
  return sowDraftPromise;
}

async function ensureSowSavedTable() {
  if (sowSavedReady) return;
  if (sowSavedPromise) return sowSavedPromise;
  sowSavedPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sow_saved (
        id           BIGSERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        component_id INTEGER,
        payload      JSONB NOT NULL,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sow_saved_name ON sow_saved (lower(name))
    `);
    sowSavedReady = true;
  })().finally(() => {
    sowSavedPromise = null;
  });
  return sowSavedPromise;
}

function normalizeSowOperation(row, fallbackOrderNo) {
  const item = {};
  EDITABLE_SOW_COLUMNS.forEach((column) => {
    item[column] = row?.[column] ?? null;
  });
  item.order_no = item.order_no || fallbackOrderNo;
  item.operation_no =
    item.operation_no === '' || item.operation_no == null ? null : Number(item.operation_no);
  item.planhours = item.planhours === '' || item.planhours == null ? null : Number(item.planhours);
  item.va_hours = item.va_hours === '' || item.va_hours == null ? null : Number(item.va_hours);
  item.nnva_hours =
    item.nnva_hours === '' || item.nnva_hours == null ? null : Number(item.nnva_hours);

  if (item.va_hours != null || item.nnva_hours != null) {
    const va = Number.isFinite(item.va_hours) ? Math.max(0, item.va_hours) : 0;
    const nnva = Number.isFinite(item.nnva_hours) ? Math.max(0, item.nnva_hours) : 0;
    item.va_hours = va;
    item.nnva_hours = nnva;
    item.planhours = va + nnva;
  }
  item.weight = item.weight === '' || item.weight == null ? null : Number(item.weight);
  item.actual_progress =
    item.actual_progress === '' || item.actual_progress == null
      ? null
      : Number(item.actual_progress);
  item.actual_hours =
    item.actual_hours === '' || item.actual_hours == null ? null : Number(item.actual_hours);
  item.progress = item.progress === '' || item.progress == null ? null : Number(item.progress);
  item.revision_no =
    item.revision_no === '' || item.revision_no == null ? 0 : Number(item.revision_no);
  item.source_op_id =
    item.source_op_id === '' || item.source_op_id == null ? null : Number(item.source_op_id);
  return item;
}

function isBlankInfoValue(value) {
  const text = String(value ?? '').trim();
  return !text || text === '-';
}

function fillMissingOrderInfo(rows, info) {
  if (!Array.isArray(rows) || !info) return rows || [];
  return rows.map((row) => ({
    ...row,
    customer: isBlankInfoValue(row.customer) ? info.customer || row.customer : row.customer,
    ssbr_id: isBlankInfoValue(row.ssbr_id) ? info.ssbr_id || row.ssbr_id : row.ssbr_id,
    part_number: isBlankInfoValue(row.part_number)
      ? info.part_number || row.part_number
      : row.part_number,
    part_name: isBlankInfoValue(row.part_name) ? info.part_name || row.part_name : row.part_name,
    model: isBlankInfoValue(row.model) ? info.model || row.model : row.model,
  }));
}

function inferLegacyWctGroup(workcenter, operationText) {
  const code = String(workcenter || '')
    .trim()
    .toUpperCase();
  const text = String(operationText || '')
    .trim()
    .toLowerCase();
  if (code === 'M5051DIS') return 'DIS';
  if (code === 'M5051QC1') {
    if (text.includes('testing')) return 'QCT';
    if (text.includes('final inspect')) return 'QCF';
    return 'QCI';
  }
  return null;
}

async function resolveWctGroup(query, workcenter, existingGroup = null, operationText = '') {
  if (existingGroup) return existingGroup;
  const code = String(workcenter || '').trim();
  if (!code) return null;
  const result = await query(
    `SELECT DISTINCT groupname
     FROM public.workcenter
     WHERE groupname IS NOT NULL
       AND (
         machineid = $1
         OR workcenterot = $1
         OR workcenternew = $1
         OR workcenterold = $1
       )
     ORDER BY groupname`,
    [code]
  );
  if (result.rows.length === 1) return result.rows[0].groupname;
  return inferLegacyWctGroup(code, operationText);
}

const normalizeOrderNo = (value) => {
  const text = String(value ?? '').trim();
  return text ? text.replace(/-/g, '000') : '';
};

const SOW_IS_SUBCONT_EXPR = `
         EXISTS (
           SELECT 1 FROM public.sow_subcont_mark scm
           WHERE ltrim(scm.order_no, '0') = ltrim(s.order_no, '0')
             AND scm.operation_no = s.operation_no
             AND scm.unmarked_at IS NULL
         ) AS is_subcont`;

async function enrichSowRowsWithNnva(query, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  const sourceIds = [
    ...new Set(rows.map((row) => Number(row.source_op_id)).filter(Number.isFinite)),
  ];
  if (!sourceIds.length) {
    return rows.map((row) => ({
      ...row,
      operation_planhours:
        (row.va_hours == null ? null : Number(row.va_hours)) ??
        row.operation_planhours ??
        row.planhours ??
        0,
      nnva_planhours:
        (row.nnva_hours == null ? null : Number(row.nnva_hours)) ?? row.nnva_planhours ?? 0,
      display_planhours: row.display_planhours ?? row.planhours ?? 0,
      nnva_items: row.nnva_items || [],
    }));
  }

  const nnvaResult = await query(
    `SELECT ns.sow_standard_id,
            ns.nnva_base_id,
            ns.standard_hours,
            nb.name AS nnva_name
       FROM public.sow_nnva_standard ns
       JOIN public.sow_nnva_base nb ON nb.id = ns.nnva_base_id
      WHERE ns.sow_standard_id = ANY($1::bigint[])
      ORDER BY ns.sow_standard_id, nb.name`,
    [sourceIds]
  );

  const bySource = new Map();
  nnvaResult.rows.forEach((item) => {
    const key = Number(item.sow_standard_id);
    const list = bySource.get(key) || [];
    list.push(item);
    bySource.set(key, list);
  });

  return rows.map((row) => {
    const items = bySource.get(Number(row.source_op_id)) || [];

    const snapshotNnva = row.nnva_hours == null ? null : Number(row.nnva_hours);
    const snapshotVa = row.va_hours == null ? null : Number(row.va_hours);
    const fallbackNnva = items.reduce((sum, item) => sum + (Number(item.standard_hours) || 0), 0);
    const planHours = row.planhours ?? 0;
    const nnvaHours = snapshotNnva ?? row.nnva_planhours ?? fallbackNnva;
    const operationHours = snapshotVa ?? row.operation_planhours ?? planHours;
    return {
      ...row,
      operation_planhours: operationHours,
      nnva_planhours: nnvaHours,
      display_planhours: row.display_planhours ?? planHours,
      nnva_items: row.nnva_items || items,
    };
  });
}

async function annotateSubcontFromMarks(orderNo, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  const marks = await db.query(
    `SELECT operation_no
       FROM public.sow_subcont_mark
      WHERE ltrim(order_no, '0') = ltrim($1, '0')
        AND unmarked_at IS NULL`,
    [orderNo]
  );
  const marked = new Set(marks.rows.map((row) => Number(row.operation_no)));
  return rows.map((row) => ({ ...row, is_subcont: marked.has(Number(row.operation_no)) }));
}

const OPERATION_CARD_REVISION_ORIGINAL = 'Original';

async function ensureSowDocumentNoTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.sow_documentno (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      documentno TEXT NOT NULL UNIQUE,
      "default" BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS documentno TEXT`);
  await db.query(
    `ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS "default" BOOLEAN NOT NULL DEFAULT false`
  );
  await db.query(
    `ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );
  await db.query(
    `ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS revision_no TEXT`);
  await db.query(`ALTER TABLE public.sow_documentno ADD COLUMN IF NOT EXISTS revision_date DATE`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sow_documentno_default
      ON public.sow_documentno ("default")
      WHERE "default" = true
  `);
}

exports.getSowDocumentNos = async (req, res) => {
  try {
    await ensureSowDocumentNoTable();
    const result = await db.query(
      `SELECT id, documentno, "default",
              revision_no,
              to_char(revision_date, 'YYYY-MM-DD') AS revision_date
       FROM public.sow_documentno
       ORDER BY "default" DESC, documentno ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('getSowDocumentNos error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.createSowDocumentNo = async (req, res) => {
  try {
    await ensureSowDocumentNoTable();
    const documentno = String(req.body?.documentno ?? '').trim();
    if (!documentno) {
      return res.status(400).json({ error: 'documentno is required' });
    }

    const revisionRaw = req.body?.revision_no;
    const revision_no =
      revisionRaw == null || String(revisionRaw).trim() === '' ? null : String(revisionRaw).trim();

    const dateRaw = req.body?.revision_date;
    const revision_date =
      dateRaw == null || String(dateRaw).trim() === '' ? null : String(dateRaw).trim();

    const makeDefault = req.body?.default === true || req.body?.default === 'true';

    if (makeDefault) {
      await db.query(`UPDATE public.sow_documentno SET "default" = false WHERE "default" = true`);
    }

    const result = await db.query(
      `INSERT INTO public.sow_documentno (documentno, "default", revision_no, revision_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (documentno) DO UPDATE SET
         "default"     = EXCLUDED."default",
         revision_no   = EXCLUDED.revision_no,
         revision_date = EXCLUDED.revision_date,
         updated_at    = NOW()
       RETURNING id, documentno, "default", revision_no,
                 to_char(revision_date, 'YYYY-MM-DD') AS revision_date`,
      [documentno, makeDefault, revision_no, revision_date]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error('createSowDocumentNo error:', err);
    res.status(500).json({ error: err.message });
  }
};

function safePathSegment(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return (text || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

async function ensureSowOperationCardTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.sow_operationcard (
      id BIGSERIAL PRIMARY KEY,
      sow_standard_id INTEGER,
      card_key TEXT,
      order_no TEXT,
      operation_no INTEGER,
      revision_no TEXT NOT NULL DEFAULT 'Original',
      image_path TEXT,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(
    `ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS sow_standard_id INTEGER`
  );
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS card_key TEXT`);
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS order_no TEXT`);
  await db.query(
    `ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS operation_no INTEGER`
  );
  await db.query(
    `ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS revision_no TEXT NOT NULL DEFAULT 'Original'`
  );
  await db.query(`ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS image_path TEXT`);
  await db.query(
    `ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`
  );
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sow_operationcard'
          AND column_name = 'images'
          AND data_type <> 'jsonb'
      ) THEN
        ALTER TABLE public.sow_operationcard
          ALTER COLUMN images TYPE JSONB
          USING CASE
            WHEN images IS NULL OR btrim(images::text) = '' THEN '[]'::jsonb
            WHEN left(btrim(images::text), 1) IN ('[', '{') THEN images::jsonb
            ELSE jsonb_build_array(jsonb_build_object('src', images::text))
          END;
      END IF;
    END $$;
  `);
  await db.query(
    `ALTER TABLE public.sow_operationcard ALTER COLUMN images SET DEFAULT '[]'::jsonb`
  );
  await db.query(`ALTER TABLE public.sow_operationcard ALTER COLUMN images SET NOT NULL`);
  await db.query(
    `ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );
  await db.query(
    `ALTER TABLE public.sow_operationcard ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );
  await db.query(`
    DO $$
    DECLARE
      constraint_row RECORD;
    BEGIN
      FOR constraint_row IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'sow_operationcard'
          AND c.contype = 'u'
          AND (
            SELECT array_agg(a.attname::text ORDER BY u.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
          ) = ARRAY['sow_standard_id']
      LOOP
        EXECUTE format('ALTER TABLE public.sow_operationcard DROP CONSTRAINT %I', constraint_row.conname);
      END LOOP;
    END $$;
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sow_operationcard_standard_revision
      ON public.sow_operationcard (sow_standard_id, revision_no)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_sow_operationcard_order_operation_revision
      ON public.sow_operationcard (order_no, operation_no, revision_no)
  `);
}

function saveOperationCardDataUrl(dataUrl, { orderNo, operationNo, revisionNo, prefix = 'image' }) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
  if (!match) return null;

  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const uploadsRoot = path.join(__dirname, '../uploads');
  const safeOrder = safePathSegment(orderNo, 'no-order');
  const safeOp = safePathSegment(operationNo, 'no-op');
  const safeRevision = safePathSegment(revisionNo || OPERATION_CARD_REVISION_ORIGINAL, 'Original');
  const dir = path.join(uploadsRoot, 'operation-card', safeOrder, safeOp, safeRevision);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${safePathSegment(prefix, 'image')}-${uuidv4()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(match[2], 'base64'));
  return `/uploads/operation-card/${safeOrder}/${safeOp}/${safeRevision}/${filename}`;
}

function normalizeStoredImagePath(src) {
  if (!src) return src;
  const text = String(src);
  if (text.startsWith('/uploads/')) return text;
  try {
    const parsed = new URL(text);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
  } catch (_) {}
  return text;
}

function collectUploadPaths(...values) {
  const paths = new Set();
  const visit = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      const normalized = normalizeStoredImagePath(value);
      if (normalized?.startsWith('/uploads/')) paths.add(normalized);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      visit(value.src);
      visit(value.image_path);
      visit(value.file_path);
    }
  };

  values.forEach(visit);
  return [...paths];
}

function deleteStoredUploadFiles(filePaths) {
  const uploadsRoot = path.resolve(__dirname, '../uploads');
  for (const filePath of filePaths) {
    if (!filePath?.startsWith('/uploads/')) continue;
    const relativePath = filePath.replace(/^\/uploads\//, '');
    const fullPath = path.resolve(uploadsRoot, relativePath);
    if (!fullPath.startsWith(uploadsRoot + path.sep)) continue;
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (err) {
      console.warn('deleteStoredUploadFiles warning:', err.message);
    }
  }
}

function normalizeOperationNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRevisionNo(value) {
  const text = String(value ?? '').trim();
  return text || OPERATION_CARD_REVISION_ORIGINAL;
}

async function persistOperationCardImages(images, context) {
  return Promise.all(
    images.map(async (img, index) => {
      const next = { ...img };
      if (typeof next.src === 'string' && next.src.startsWith('data:image/')) {
        next.src = saveOperationCardDataUrl(next.src, {
          ...context,
          prefix: next.id || `placed-${index + 1}`,
        });
      } else {
        next.src = normalizeStoredImagePath(next.src);
      }
      next.image_path = next.src || null;
      return next;
    })
  );
}

exports.getGrouped = async (req, res) => {
  try {
    const { search } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (order_no    ILIKE $1
                    OR ssbr_id     ILIKE $1
                    OR part_number ILIKE $1
                    OR part_name   ILIKE $1)`;
    }

    const countResult = await db.query(`SELECT COUNT(*) FROM vw_sow_orders${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await db.query(
      `SELECT * FROM vw_sow_orders${where} ORDER BY order_no ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowHistoryRows = async (req, res) => {
  try {
    await ensureSowRuntimeColumns();
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const direction =
      String(req.query.direction || req.query.sortDirection || 'desc').toLowerCase() === 'asc'
        ? 'ASC'
        : 'DESC';

    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE s.order_no ILIKE $1 OR s.ssbr_id ILIKE $1`;
    }

    const count = await db.query(`SELECT COUNT(*)::int AS total FROM sow s ${where}`, params);
    params.push(limit, offset);
    const result = await db.query(
      `SELECT
         ${SOW_HISTORY_COLUMNS.split('\n')
           .map((line) => line.trim())
           .filter(Boolean)
           .map((column) => `s.${column.replace(/,$/, '')}`)
           .join(',\n         ')},
         s.source_op_id,
         COALESCE(s.va_hours, s.planhours, 0) AS operation_planhours,
         COALESCE(s.nnva_hours, 0) AS nnva_planhours,
         COALESCE(s.planhours, 0) AS display_planhours,
       ${SOW_IS_SUBCONT_EXPR}
       FROM sow s
       ${where}
       ORDER BY s.updated_at ${direction} NULLS LAST, s.order_no ASC, s.operation_no ASC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: count.rows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((count.rows[0]?.total || 0) / limit)),
      },
    });
  } catch (err) {
    console.error('getSowHistoryRows error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.exportSowHistoryRows = async (req, res) => {
  try {
    await ensureSowRuntimeColumns();
    const start = String(req.query.start || req.query.from || '').trim();
    const end = String(req.query.end || req.query.to || '').trim();
    const ssbrId = String(req.query.ssbr_id || '').trim();
    const orderNo = String(req.query.order_no || '').trim();
    const direction =
      String(req.query.direction || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const hasIdentifier = Boolean(ssbrId || orderNo);
    const hasRange = Boolean(start || end);

    if (!hasIdentifier && !hasRange) {
      return res.status(400).json({ error: 'kirim rentang start/end, atau ssbr_id / order_no' });
    }
    if (hasRange && (!isDate(start) || !isDate(end))) {
      return res.status(400).json({ error: 'start dan end wajib format YYYY-MM-DD' });
    }

    const params = [];
    const conditions = [];
    if (hasRange) {
      params.push(start, end);
      conditions.push(`s.created_at >= $${params.length - 1}::date`);
      conditions.push(`s.created_at < ($${params.length}::date + interval '1 day')`);
    }
    if (ssbrId) {
      params.push(ssbrId);
      conditions.push(`lower(btrim(s.ssbr_id)) = lower(btrim($${params.length}))`);
    }
    if (orderNo) {
      params.push(orderNo);
      conditions.push(`ltrim(s.order_no, '0') = ltrim(btrim($${params.length}), '0')`);
    }

    const result = await db.query(
      `SELECT
         ${SOW_HISTORY_COLUMNS.split('\n')
           .map((line) => line.trim())
           .filter(Boolean)
           .map((column) => `s.${column.replace(/,$/, '')}`)
           .join(',\n         ')},
         s.source_op_id,
         COALESCE(s.va_hours, s.planhours, 0) AS operation_planhours,
         COALESCE(s.nnva_hours, 0) AS nnva_planhours,
         COALESCE(s.planhours, 0) AS display_planhours
       FROM sow s
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY s.updated_at ${direction} NULLS LAST, s.order_no ASC, s.operation_no ASC NULLS LAST`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MPS Timesheet';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('SOW History');
    sheet.columns = [
      { header: 'Customer', key: 'customer', width: 18 },
      { header: 'Order No', key: 'order_no', width: 18 },
      { header: 'SSBR ID', key: 'ssbr_id', width: 18 },
      { header: 'Operation Text', key: 'operation_text', width: 36 },
      { header: 'Operation No', key: 'operation_no', width: 14 },

      { header: 'Plan Hours (VA+NNVA)', key: 'planhours', width: 20 },
      { header: 'VA Hours', key: 'operation_planhours', width: 14 },
      { header: 'NNVA Hours', key: 'nnva_planhours', width: 14 },
      { header: 'WCT Group', key: 'wct_group', width: 16 },
      { header: 'Workcenter', key: 'workcenter', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Part Number', key: 'part_number', width: 20 },
      { header: 'Part Name', key: 'part_name', width: 28 },
      { header: 'Model', key: 'model', width: 18 },
      { header: 'Created At', key: 'created_at', width: 24 },
      { header: 'Updated At', key: 'updated_at', width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(result.rows);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const slug = (value) =>
      String(value)
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .slice(0, 40);
    const fileTag = orderNo
      ? `order_${slug(orderNo)}`
      : ssbrId
        ? `ssbr_${slug(ssbrId)}`
        : `${slug(start)}_to_${slug(end)}`;
    res.setHeader('Content-Disposition', `attachment; filename="sow_history_${fileTag}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('exportSowHistoryRows error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowOrderOptions = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE order_no ILIKE $1 OR ssbr_id ILIKE $1`;
    }

    const result = await db.query(
      `SELECT order_no,
              MAX(ssbr_id) AS ssbr_id,
              MAX(customer) AS customer,
              MAX(part_name) AS part_name,
              COUNT(*)::int AS operation_count
       FROM sow
       ${where}
       GROUP BY order_no
       ORDER BY MAX(idsow) DESC
       LIMIT 100`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getSowOrderOptions error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowOrderForRevision = async (req, res) => {
  try {
    await ensureSowRevisionHistoryTable();
    const { orderNo } = req.params;
    const rev = await db.query(
      `SELECT COALESCE(MAX(revision_no), 0)::int AS current_revision
       FROM sow_revision_history
       WHERE order_no = $1`,
      [orderNo]
    );
    const currentRevision = rev.rows[0]?.current_revision || 0;
    const requestedRevision = Number.parseInt(req.query.revision_no, 10);

    const light = req.query.light === '1' || req.query.light === 'true';
    let rows = null;
    let selectedRevision = currentRevision;

    if (Number.isFinite(requestedRevision) && requestedRevision > 0) {
      const history = await db.query(
        `SELECT after_data
         FROM sow_revision_history
         WHERE order_no = $1 AND revision_no = $2
         LIMIT 1`,
        [orderNo, requestedRevision]
      );
      if (!history.rows.length) {
        return res.status(404).json({ error: 'Revision tidak ditemukan' });
      }
      rows = Array.isArray(history.rows[0]?.after_data) ? history.rows[0].after_data : [];

      rows = await annotateSubcontFromMarks(orderNo, rows);
      selectedRevision = requestedRevision;
    } else if (light) {
      const result = await db.query(
        `SELECT s.*,
        ${SOW_IS_SUBCONT_EXPR}
         FROM sow s
         WHERE s.order_no = $1
         ORDER BY s.operation_no ASC NULLS LAST, s.idsow ASC`,
        [orderNo]
      );
      rows = result.rows;
    } else {
      const result = await db.query(
        `SELECT s.*,
                COALESCE(s.va_hours, s.planhours, 0) AS operation_planhours,
                COALESCE(s.nnva_hours, 0) AS nnva_planhours,
                COALESCE(s.planhours, 0) AS display_planhours,
        ${SOW_IS_SUBCONT_EXPR}
         FROM sow s
         WHERE s.order_no = $1
         ORDER BY s.operation_no ASC NULLS LAST, s.idsow ASC`,
        [orderNo]
      );
      rows = result.rows;
    }

    const infoResult = await db.query(
      `SELECT
         MAX(NULLIF(NULLIF(BTRIM(customer), ''), '-')) AS customer,
         MAX(NULLIF(NULLIF(BTRIM(ssbr_id), ''), '-')) AS ssbr_id,
         MAX(NULLIF(NULLIF(BTRIM(part_number), ''), '-')) AS part_number,
         MAX(NULLIF(NULLIF(BTRIM(part_name), ''), '-')) AS part_name,
         MAX(NULLIF(NULLIF(BTRIM(model), ''), '-')) AS model
       FROM sow
       WHERE order_no = $1`,
      [orderNo]
    );
    rows = fillMissingOrderInfo(rows, infoResult.rows[0] || null);

    const revisions = await db.query(
      `SELECT revision_no, changed_by, created_at
       FROM sow_revision_history
       WHERE order_no = $1
       ORDER BY revision_no DESC`,
      [orderNo]
    );
    if (!light) {
      rows = await enrichSowRowsWithNnva(db.query.bind(db), rows);
    }

    res.json({
      order_no: orderNo,
      current_revision: currentRevision,
      selected_revision: selectedRevision,
      revisions: revisions.rows,
      rows,
    });
  } catch (err) {
    console.error('getSowOrderForRevision error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT customer FROM sow WHERE customer IS NOT NULL AND customer != '' ORDER BY customer`
    );
    res.json({ data: result.rows.map((r) => r.customer) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getComponents = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT component_id, model, part_number, part_name FROM components ORDER BY model, part_number`
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOperationCard = async (req, res) => {
  try {
    await ensureSowOperationCardTable();
    const { standardId } = req.params;
    const revisionNo = normalizeRevisionNo(req.query.revision_no);
    const result = await db.query(
      `SELECT *
       FROM sow_operationcard
       WHERE sow_standard_id = $1 AND revision_no = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [standardId, revisionNo]
    );
    res.json({ data: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveOperationCard = async (req, res) => {
  try {
    await ensureSowOperationCardTable();
    const { standardId } = req.params;
    const { images, card_key, order_no, operation_no, revision_no, box_image_data, image_path } =
      req.body || {};
    if (!Array.isArray(images)) return res.status(400).json({ error: 'images array required' });

    const revisionNo = normalizeRevisionNo(revision_no);
    const operationNo = normalizeOperationNumber(operation_no);
    const normalizedImages = await persistOperationCardImages(images, {
      orderNo: order_no || standardId,
      operationNo,
      revisionNo,
    });
    const savedBoxPath =
      saveOperationCardDataUrl(box_image_data, {
        orderNo: order_no || standardId,
        operationNo,
        revisionNo,
        prefix: 'main-box',
      }) || normalizeStoredImagePath(image_path);

    const existing = await db.query(
      `SELECT image_path
       FROM sow_operationcard
       WHERE sow_standard_id = $1 AND revision_no = $2
       LIMIT 1`,
      [standardId, revisionNo]
    );

    const result = existing.rows.length
      ? await db.query(
          `UPDATE sow_operationcard
         SET card_key = $3,
             order_no = $4,
             operation_no = $5,
             revision_no = $6,
             image_path = COALESCE($7, image_path),
             images = $8::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE sow_standard_id = $1 AND revision_no = $2
         RETURNING *`,
          [
            standardId,
            revisionNo,
            card_key || null,
            order_no || null,
            operationNo,
            revisionNo,
            savedBoxPath || null,
            JSON.stringify(normalizedImages),
          ]
        )
      : await db.query(
          `INSERT INTO sow_operationcard (
           sow_standard_id,
           card_key,
           order_no,
           operation_no,
           revision_no,
           image_path,
           images
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
          [
            standardId,
            card_key || null,
            order_no || null,
            operationNo,
            revisionNo,
            savedBoxPath || null,
            JSON.stringify(normalizedImages),
          ]
        );
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('saveOperationCard error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.saveSowOrderInfo = async (req, res) => {
  const { orderNo } = req.params;
  const { customer, ssbr_id, part_number, part_name, model } = req.body || {};
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];

  if (!orderNo) return res.status(400).json({ error: 'orderNo wajib diisi' });

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE sow
       SET customer    = COALESCE($2, customer),
           ssbr_id     = COALESCE($3, ssbr_id),
           part_number = COALESCE($4, part_number),
           part_name   = COALESCE($5, part_name),
           model       = COALESCE($6, model)
       WHERE order_no = $1
       RETURNING *`,
      [orderNo, customer, ssbr_id, part_number, part_name, model]
    );

    let operationsUpdated = 0;
    for (const op of operations) {
      const idsow = op?.idsow;
      if (idsow == null || idsow === '') continue;
      const workcenter = op.workcenter ? String(op.workcenter).trim() : null;
      const wctGroup = await resolveWctGroup(
        client.query.bind(client),
        workcenter,
        op.wct_group ? String(op.wct_group).trim() : null,
        op.operation_text
      );
      const description =
        op.workcenterdescription != null ? String(op.workcenterdescription) : null;
      const opResult = await client.query(
        `UPDATE sow
         SET wct_group             = $2,
             workcenter            = $3,
             workcenterdescription = $4
         WHERE order_no = $1 AND idsow = $5`,
        [orderNo, wctGroup, workcenter, description, idsow]
      );
      operationsUpdated += opResult.rowCount;
    }

    await client.query('COMMIT');
    res.json({
      updated: result.rowCount,
      operations_updated: operationsUpdated,
      rows: result.rows,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('saveSowOrderInfo error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.saveSowOrderRevision = async (req, res) => {
  const { orderNo } = req.params;
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
  const changedBy = req.body?.changed_by || req.user?.username || 'web';
  let client;

  if (!orderNo) return res.status(400).json({ error: 'orderNo wajib diisi' });
  if (operations.length === 0)
    return res.status(400).json({ error: 'operations tidak boleh kosong' });

  try {
    await ensureSowRevisionHistoryTable();
    client = await pgPool.connect();
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT *
       FROM sow
       WHERE order_no = $1
       ORDER BY operation_no ASC NULLS LAST, idsow ASC`,
      [orderNo]
    );
    const revision = await client.query(
      `SELECT COALESCE(MAX(revision_no), 0)::int + 1 AS next_revision
       FROM sow_revision_history
       WHERE order_no = $1`,
      [orderNo]
    );
    const revisionNo = revision.rows[0]?.next_revision || 1;

    await client.query(`DELETE FROM sow WHERE order_no = $1`, [orderNo]);

    const inserted = [];
    for (const operation of operations) {
      const row = normalizeSowOperation(operation, orderNo);
      row.revision_no = revisionNo;
      row.wct_group = await resolveWctGroup(
        client.query.bind(client),
        row.workcenter,
        row.wct_group,
        row.operation_text
      );
      const values = EDITABLE_SOW_COLUMNS.map((column) => row[column]);
      const placeholders = EDITABLE_SOW_COLUMNS.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO sow (${EDITABLE_SOW_COLUMNS.map((column) => `"${column}"`).join(', ')})
         VALUES (${placeholders})
         RETURNING *`,
        values
      );
      inserted.push(result.rows[0]);
    }

    const history = await client.query(
      `INSERT INTO sow_revision_history
       (order_no, revision_no, action, before_data, after_data, changed_by)
       VALUES ($1, $2, 'edit', $3::jsonb, $4::jsonb, $5)
       RETURNING *`,
      [orderNo, revisionNo, JSON.stringify(before.rows), JSON.stringify(inserted), changedBy]
    );

    const enrichedInserted = await enrichSowRowsWithNnva(client.query.bind(client), inserted);

    await client.query('COMMIT');
    res.json({ revision: history.rows[0], rows: enrichedInserted });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('saveSowOrderRevision error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.getSowDraft = async (req, res) => {
  try {
    await ensureSowDraftTable();
    const userKey = String(req.headers['x-user-name'] || req.user?.username || 'web');
    const { context, refKey } = req.params;
    const result = await db.query(
      `SELECT payload, updated_at
       FROM sow_draft
       WHERE user_key = $1 AND context = $2 AND ref_key = $3`,
      [userKey, context, refKey || '']
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Draft tidak ditemukan' });
    res.json({ draft: result.rows[0].payload, updated_at: result.rows[0].updated_at });
  } catch (err) {
    console.error('getSowDraft error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.saveSowDraft = async (req, res) => {
  try {
    await ensureSowDraftTable();
    const userKey = String(req.headers['x-user-name'] || req.user?.username || 'web');
    const { context, refKey } = req.params;
    const payload = req.body?.payload ?? null;
    if (!context) return res.status(400).json({ error: 'context wajib diisi' });
    if (payload == null) return res.status(400).json({ error: 'payload wajib diisi' });
    await db.query(
      `INSERT INTO sow_draft (user_key, context, ref_key, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_key, context, ref_key)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [userKey, context, refKey || '', JSON.stringify(payload)]
    );
    res.json({ saved_at: new Date().toISOString() });
  } catch (err) {
    console.error('saveSowDraft error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSowDraft = async (req, res) => {
  try {
    await ensureSowDraftTable();
    const userKey = String(req.headers['x-user-name'] || req.user?.username || 'web');
    const { context, refKey } = req.params;
    await db.query(
      `DELETE FROM sow_draft
       WHERE user_key = $1 AND context = $2 AND ref_key = $3`,
      [userKey, context, refKey || '']
    );
    res.status(204).end();
  } catch (err) {
    console.error('deleteSowDraft error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.createSavedSow = async (req, res) => {
  try {
    await ensureSowSavedTable();
    const { name, component_id, payload } = req.body || {};
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'name wajib diisi' });
    }
    if (payload == null || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload wajib diisi' });
    }
    const createdBy = String(req.headers['x-user-name'] || req.user?.username || 'web');
    const result = await db.query(
      `INSERT INTO sow_saved (name, component_id, payload, created_by)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, name, created_at`,
      [String(name).trim(), component_id || null, JSON.stringify(payload), createdBy]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createSavedSow error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.listSavedSows = async (req, res) => {
  try {
    await ensureSowSavedTable();
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = 'WHERE lower(name) LIKE lower($1)';
    }
    const result = await db.query(
      `SELECT id, name, component_id, created_by, updated_at,
              jsonb_array_length(COALESCE(payload->'editOps', '[]'::jsonb)) AS operation_count,
              COALESCE((
                SELECT SUM(COALESCE(NULLIF(op->>'std_hours','')::numeric, 0))
                FROM jsonb_array_elements(payload->'editOps') op
              ), 0) AS total_hours
       FROM sow_saved ${where}
       ORDER BY updated_at DESC
       LIMIT 200`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('listSavedSows error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSavedSow = async (req, res) => {
  try {
    await ensureSowSavedTable();
    const { id } = req.params;
    const result = await db.query(
      `SELECT id, name, component_id, payload, created_by, updated_at
       FROM sow_saved WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Saved SOW tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('getSavedSow error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateSavedSow = async (req, res) => {
  try {
    await ensureSowSavedTable();
    const { id } = req.params;
    const { name, component_id, payload } = req.body || {};
    const sets = [];
    const params = [];
    if (name !== undefined) {
      params.push(String(name).trim());
      sets.push(`name = $${params.length}`);
    }
    if (component_id !== undefined) {
      params.push(component_id || null);
      sets.push(`component_id = $${params.length}`);
    }
    if (payload !== undefined) {
      params.push(JSON.stringify(payload));
      sets.push(`payload = $${params.length}::jsonb`);
    }
    if (!sets.length) return res.status(400).json({ error: 'tidak ada field yang diupdate' });
    params.push(id);
    const result = await db.query(
      `UPDATE sow_saved SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, name, updated_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Saved SOW tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateSavedSow error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSavedSow = async (req, res) => {
  try {
    await ensureSowSavedTable();
    const { id } = req.params;
    await db.query(`DELETE FROM sow_saved WHERE id = $1`, [id]);
    res.status(204).end();
  } catch (err) {
    console.error('deleteSavedSow error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowRevisionHistory = async (req, res) => {
  try {
    await ensureSowRevisionHistoryTable();
    const { orderNo } = req.params;
    const result = await db.query(
      `SELECT id, order_no, revision_no, action, changed_by, created_at,
              jsonb_array_length(COALESCE(before_data, '[]'::jsonb)) AS before_count,
              jsonb_array_length(COALESCE(after_data, '[]'::jsonb)) AS after_count
       FROM sow_revision_history
       WHERE order_no = $1
       ORDER BY revision_no DESC`,
      [orderNo]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getSowRevisionHistory error:', err);
    res.status(500).json({ error: err.message });
  }
};

function subcontActorOf(req) {
  const name = req.headers['x-user-name'];
  const id = req.headers['x-user-id'];
  const value = (name && String(name).trim()) || (id && String(id).trim()) || '';
  return value || null;
}

function parseSubcontOperationNo(value) {
  const text = String(value ?? '').trim();
  if (!text || !/^-?\d+$/.test(text)) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const SUBCONT_MARK_RETURNING = `id, order_no, operation_no, original_workcenter, note,
              marked_by, marked_at, unmarked_by, unmarked_at`;

exports.listSowSubcontMarks = async (req, res) => {
  try {
    const orderNo = String(req.query.order_no ?? '').trim();
    const params = [];
    let filter = '';
    if (orderNo) {
      params.push(orderNo);
      filter = ` AND ltrim(scm.order_no, '0') = ltrim($1, '0')`;
    }
    const result = await db.query(
      `SELECT scm.id, scm.order_no, scm.operation_no, scm.original_workcenter,
              scm.note, scm.marked_by, scm.marked_at
         FROM public.sow_subcont_mark scm
        WHERE scm.unmarked_at IS NULL${filter}
        ORDER BY ltrim(scm.order_no, '0') ASC, scm.operation_no ASC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('listSowSubcontMarks error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.createSowSubcontMark = async (req, res) => {
  try {
    const orderNo = String(req.body?.order_no ?? '').trim();
    const operationNo = parseSubcontOperationNo(req.body?.operation_no);
    const rawNote = req.body?.note == null ? '' : String(req.body.note).trim();
    const note = rawNote || null;

    if (!orderNo) return res.status(400).json({ error: 'order_no wajib diisi' });
    if (operationNo == null)
      return res.status(400).json({ error: 'operation_no wajib diisi (bilangan bulat)' });

    const operation = await db.query(
      `SELECT s.workcenter
         FROM public.sow s
        WHERE ltrim(s.order_no, '0') = ltrim($1, '0')
          AND s.operation_no = $2
        ORDER BY s.idsow DESC
        LIMIT 1`,
      [orderNo, operationNo]
    );
    if (!operation.rows.length) {
      return res.status(404).json({ error: 'Operasi tidak ditemukan di SOW' });
    }

    const result = await db.query(
      `INSERT INTO public.sow_subcont_mark
         (order_no, operation_no, original_workcenter, note, marked_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SUBCONT_MARK_RETURNING}`,
      [orderNo, operationNo, operation.rows[0].workcenter ?? null, note, subcontActorOf(req)]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Operasi ini sudah ditandai subcont' });
    }
    console.error('createSowSubcontMark error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSowSubcontMark = async (req, res) => {
  try {
    const orderNo = String(req.params.order_no ?? '').trim();
    const operationNo = parseSubcontOperationNo(req.params.operation_no);

    if (!orderNo) return res.status(400).json({ error: 'order_no wajib diisi' });
    if (operationNo == null)
      return res.status(400).json({ error: 'operation_no wajib diisi (bilangan bulat)' });

    const result = await db.query(
      `UPDATE public.sow_subcont_mark
          SET unmarked_at = NOW(),
              unmarked_by = $3
        WHERE ltrim(order_no, '0') = ltrim($1, '0')
          AND operation_no = $2
          AND unmarked_at IS NULL
       RETURNING ${SUBCONT_MARK_RETURNING}`,
      [orderNo, operationNo, subcontActorOf(req)]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Tanda subcont aktif tidak ditemukan' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('deleteSowSubcontMark error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getRowById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM sow WHERE idsow = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProgressHistory = async (req, res) => {
  try {
    const { idsow } = req.params;
    const result = await db.query(
      `SELECT id, operation_id, order_no, progress, issue_description,
              image_path, created_at, created_by
         FROM progress_update_history
        WHERE operation_id = $1
        ORDER BY created_at DESC`,
      [idsow]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addProgressUpdate = async (req, res) => {
  try {
    const { operation_id, order_no, progress, issue_description, image_data, created_by } =
      req.body;

    const prog = parseInt(progress, 10);
    if (isNaN(prog) || prog < 1 || prog > 100) {
      return res.status(400).json({ error: 'Progress harus antara 1–100' });
    }

    const lastResult = await db.query(
      `SELECT progress FROM progress_update_history
        WHERE operation_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [operation_id]
    );
    if (lastResult.rows.length > 0 && prog < lastResult.rows[0].progress) {
      return res.status(400).json({
        error: `Progress tidak boleh kurang dari progress terakhir (${lastResult.rows[0].progress}%)`,
      });
    }

    let image_path = null;
    if (image_data) {
      const opRow = await db.query('SELECT operation_no FROM sow WHERE idsow = $1', [operation_id]);
      const opNo = opRow.rows[0]?.operation_no || '00';
      const safeOrd = (order_no || 'unknown').replace(/[^\w\-]/g, '_');
      const safeOp = String(opNo).replace(/[^\w\-]/g, '_');

      const uploadsRoot = path.join(__dirname, '../uploads');
      const dir = path.join(uploadsRoot, 'progress', safeOrd, safeOp);
      fs.mkdirSync(dir, { recursive: true });

      const filename = `${Date.now()}.jpg`;
      const base64 = image_data.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));

      image_path = `/uploads/progress/${safeOrd}/${safeOp}/${filename}`;
    }

    const result = await db.query(
      `INSERT INTO progress_update_history
         (operation_id, order_no, progress, issue_description, image_path, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        operation_id,
        order_no || null,
        prog,
        issue_description || null,
        image_path,
        created_by || null,
      ]
    );

    await db.query('UPDATE sow SET progress = $1 WHERE idsow = $2', [prog, operation_id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function recomputeOperationProgress(client, idsow) {
  const agg = await client.query(
    `SELECT SUM(progress * standard_hours)::numeric AS weighted,
            SUM(standard_hours)::numeric           AS total_hours
       FROM sow_sub_operation
      WHERE operation_id = $1 AND is_active = true`,
    [idsow]
  );
  const totalHours = agg.rows[0]?.total_hours;

  if (totalHours === null || totalHours === undefined || Number(totalHours) === 0) {
    return;
  }
  const weighted = Number(agg.rows[0].weighted) || 0;
  const rolled = Math.round(weighted / Number(totalHours));

  await client.query(`UPDATE sow SET progress = $1, actual_progress = $2 WHERE idsow = $3`, [
    rolled,
    rolled,
    idsow,
  ]);
}

async function recomputeSubtaskWeights(client, idsow) {
  await client.query(
    `UPDATE sow_sub_operation s
        SET weight = round(s.standard_hours / t.total, 4)
       FROM (SELECT SUM(standard_hours)::numeric AS total
               FROM sow_sub_operation
              WHERE operation_id = $1 AND is_active = true) t
      WHERE s.operation_id = $1 AND s.is_active = true
        AND t.total > 0`,
    [idsow]
  );
}

async function assertSubtaskHoursCap(client, idsow, newHours, excludeId) {
  const opRow = await client.query('SELECT planhours FROM sow WHERE idsow = $1', [idsow]);
  const planhours = Number(opRow.rows[0]?.planhours) || 0;
  if (planhours <= 0) return;
  const excludeSql = excludeId ? 'AND id <> $2' : '';
  const params = excludeId ? [idsow, excludeId] : [idsow];
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(standard_hours), 0)::numeric AS used
       FROM sow_sub_operation
      WHERE operation_id = $1 AND is_active = true ${excludeSql}`,
    params
  );
  const used = Number(sumRes.rows[0].used);
  if (used + newHours > planhours) {
    const err = new Error(
      `Total jam sub-task (${(used + newHours).toFixed(2)}) melebihi jam standar operasi (${planhours.toFixed(2)}). Ubah dulu jam operasinya.`
    );
    err.statusCode = 400;
    throw err;
  }
}

exports.getSubtasks = async (req, res) => {
  try {
    const { idsow } = req.params;
    const result = await db.query(
      `SELECT id, operation_id, order_no, title, sort_order, weight, standard_hours, progress,
              status, is_active, msp_task_id,
              created_by, created_at, updated_by, updated_at
         FROM sow_sub_operation
        WHERE operation_id = $1 AND is_active = true
        ORDER BY sort_order ASC, id ASC`,
      [idsow]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createSubtask = async (req, res) => {
  let client;
  try {
    const { idsow } = req.params;
    const { title, standard_hours, sort_order } = req.body || {};
    const createdBy = req.body?.created_by || req.headers['x-user-id'] || null;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title wajib diisi' });
    }
    let hours = 1;
    if (standard_hours !== undefined && standard_hours !== null && standard_hours !== '') {
      hours = Number(standard_hours);
      if (isNaN(hours) || hours < 0) {
        return res.status(400).json({ error: 'standard_hours tidak boleh negatif' });
      }
    }
    let so = 0;
    if (sort_order !== undefined && sort_order !== null && sort_order !== '') {
      so = parseInt(sort_order, 10);
      if (isNaN(so)) {
        return res.status(400).json({ error: 'sort_order harus berupa angka' });
      }
    }

    client = await pgPool.connect();
    await client.query('BEGIN');

    const opRow = await client.query('SELECT order_no FROM sow WHERE idsow = $1', [idsow]);
    if (opRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Operasi (idsow) tidak ditemukan' });
    }
    const orderNo = opRow.rows[0].order_no;

    await assertSubtaskHoursCap(client, idsow, hours, null);

    const inserted = await client.query(
      `INSERT INTO sow_sub_operation
         (operation_id, order_no, title, sort_order, standard_hours, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [idsow, orderNo || null, String(title).trim(), so, hours, createdBy]
    );

    await recomputeSubtaskWeights(client, parseInt(idsow, 10));
    await recomputeOperationProgress(client, parseInt(idsow, 10));

    await client.query('COMMIT');
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.createSubtasksBatch = async (req, res) => {
  let client;
  try {
    const { idsow } = req.params;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const createdBy = req.body?.created_by || req.headers['x-user-id'] || null;

    if (items.length === 0) {
      return res.status(400).json({ error: 'items wajib diisi (array sub-task)' });
    }

    const clean = [];
    for (const it of items) {
      const title = String(it?.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'title wajib diisi' });
      }
      let hours = 1;
      if (
        it?.standard_hours !== undefined &&
        it.standard_hours !== null &&
        it.standard_hours !== ''
      ) {
        hours = Number(it.standard_hours);
        if (isNaN(hours) || hours < 0) {
          return res.status(400).json({ error: 'standard_hours tidak boleh negatif' });
        }
      }
      let so = 0;
      if (it?.sort_order !== undefined && it.sort_order !== null && it.sort_order !== '') {
        so = parseInt(it.sort_order, 10);
        if (isNaN(so)) {
          return res.status(400).json({ error: 'sort_order harus berupa angka' });
        }
      }
      clean.push({ title, hours, so });
    }

    client = await pgPool.connect();
    await client.query('BEGIN');

    const opRow = await client.query('SELECT order_no FROM sow WHERE idsow = $1', [idsow]);
    if (opRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Operasi (idsow) tidak ditemukan' });
    }
    const orderNo = opRow.rows[0].order_no;

    const existingRes = await client.query(
      `SELECT upper(regexp_replace(btrim(title), '\\s+', ' ', 'g')) AS norm
         FROM sow_sub_operation
        WHERE operation_id = $1 AND is_active = true`,
      [idsow]
    );
    const existingSet = new Set(existingRes.rows.map((r) => r.norm));
    const normTitle = (t) => String(t).trim().replace(/\s+/g, ' ').toUpperCase();

    const toCreate = [];
    const skipped = [];
    for (const it of clean) {
      if (existingSet.has(normTitle(it.title))) {
        skipped.push({ title: it.title, reason: 'sudah ada' });
      } else {
        toCreate.push(it);
      }
    }

    if (toCreate.length > 0) {
      const totalHours = toCreate.reduce((sum, it) => sum + it.hours, 0);
      await assertSubtaskHoursCap(client, idsow, totalHours, null);

      const created = [];
      for (const it of toCreate) {
        const inserted = await client.query(
          `INSERT INTO sow_sub_operation
             (operation_id, order_no, title, sort_order, standard_hours, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING *`,
          [idsow, orderNo || null, it.title, it.so, it.hours, createdBy]
        );
        created.push(inserted.rows[0]);
      }

      await recomputeSubtaskWeights(client, parseInt(idsow, 10));
      await recomputeOperationProgress(client, parseInt(idsow, 10));

      await client.query('COMMIT');
      return res
        .status(201)
        .json({ created, skipped, created_count: created.length, skipped_count: skipped.length });
    }

    await client.query('COMMIT');
    res.status(201).json({ created: [], skipped, created_count: 0, skipped_count: skipped.length });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.updateSubtask = async (req, res) => {
  let client;
  try {
    const { subId } = req.params;
    const { title, standard_hours, sort_order, status, is_active } = req.body || {};
    const updatedBy =
      req.body?.updated_by || req.body?.created_by || req.headers['x-user-id'] || null;

    const sets = [];
    const vals = [];
    let i = 1;
    let recompute = false;

    if (title !== undefined) {
      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: 'title tidak boleh kosong' });
      }
      sets.push(`title = $${i++}`);
      vals.push(String(title).trim());
    }
    if (standard_hours !== undefined) {
      const h = Number(standard_hours);
      if (isNaN(h) || h < 0) {
        return res.status(400).json({ error: 'standard_hours tidak boleh negatif' });
      }
      sets.push(`standard_hours = $${i++}`);
      vals.push(h);
      recompute = true;
    }
    if (sort_order !== undefined) {
      const so = parseInt(sort_order, 10);
      if (isNaN(so)) {
        return res.status(400).json({ error: 'sort_order harus berupa angka' });
      }
      sets.push(`sort_order = $${i++}`);
      vals.push(so);
    }
    if (status !== undefined) {
      const allowed = ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'DONE'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'status tidak valid' });
      }
      sets.push(`status = $${i++}`);
      vals.push(status);
    }
    if (is_active !== undefined) {
      const active =
        is_active === true || is_active === 'true' || is_active === 1 || is_active === '1';
      sets.push(`is_active = $${i++}`);
      vals.push(active);
      recompute = true;
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Tidak ada field untuk diupdate' });
    }

    sets.push(`updated_by = $${i++}`);
    vals.push(updatedBy);
    sets.push('updated_at = now()');

    client = await pgPool.connect();
    await client.query('BEGIN');

    vals.push(subId);
    const updated = await client.query(
      `UPDATE sow_sub_operation SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sub-task tidak ditemukan' });
    }

    if (recompute) {
      const row = updated.rows[0];
      await assertSubtaskHoursCap(
        client,
        row.operation_id,
        Number(row.standard_hours) || 0,
        row.id
      );
      await recomputeSubtaskWeights(client, row.operation_id);
      await recomputeOperationProgress(client, row.operation_id);
    }

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.addSubtaskProgress = async (req, res) => {
  let client;
  try {
    const { subId } = req.params;
    const { progress, issue_description, image_data } = req.body || {};
    const createdBy = req.body?.created_by || req.headers['x-user-id'] || null;

    const prog = parseInt(progress, 10);
    if (isNaN(prog) || prog < 1 || prog > 100) {
      return res.status(400).json({ error: 'Progress harus antara 1–100' });
    }

    client = await pgPool.connect();
    await client.query('BEGIN');

    const subRow = await client.query(
      `SELECT id, operation_id, order_no FROM sow_sub_operation WHERE id = $1`,
      [subId]
    );
    if (subRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sub-task tidak ditemukan' });
    }
    const operationId = subRow.rows[0].operation_id;
    const orderNo = subRow.rows[0].order_no;

    let image_path = null;
    if (image_data) {
      const opRow = await client.query('SELECT operation_no FROM sow WHERE idsow = $1', [
        operationId,
      ]);
      const opNo = opRow.rows[0]?.operation_no ?? '00';
      const safeOrd = (orderNo || 'unknown').replace(/[^\w\-]/g, '_');
      const safeOp = String(opNo).replace(/[^\w\-]/g, '_');
      const safeSub = String(subId).replace(/[^\w\-]/g, '_');

      const uploadsRoot = path.join(__dirname, '../uploads');
      const dir = path.join(uploadsRoot, 'progress', safeOrd, safeOp, safeSub);
      fs.mkdirSync(dir, { recursive: true });

      const filename = `${Date.now()}.jpg`;
      const base64 = image_data.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));

      image_path = `/uploads/progress/${safeOrd}/${safeOp}/${safeSub}/${filename}`;
    }

    const inserted = await client.query(
      `INSERT INTO sow_sub_operation_progress_history
         (sub_operation_id, operation_id, order_no, progress, issue_description, image_path, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [subId, operationId, orderNo || null, prog, issue_description || null, image_path, createdBy]
    );

    await client.query(
      `UPDATE sow_sub_operation
          SET progress = $1, updated_by = $2, updated_at = now()
        WHERE id = $3`,
      [prog, createdBy, subId]
    );

    await recomputeOperationProgress(client, operationId);

    await client.query('COMMIT');
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.getSubtaskProgressHistory = async (req, res) => {
  try {
    const { subId } = req.params;
    const result = await db.query(
      `SELECT id, sub_operation_id, operation_id, order_no, progress,
              issue_description, image_path, created_at, created_by
         FROM sow_sub_operation_progress_history
        WHERE sub_operation_id = $1
        ORDER BY created_at DESC`,
      [subId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.importSubtasks = async (req, res) => {
  let client;
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'File Excel wajib diunggah (field "file")' });
    }
    const actor = req.body?.actor || req.headers['x-user-id'] || null;
    const commit =
      req.body?.commit === true || req.body?.commit === 'true' || req.body?.commit === '1';

    const cellText = (cell) => {
      if (!cell) return '';
      let v = cell.value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') {
        if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join('');
        else if (v.result !== undefined) v = v.result;
        else if (v.text !== undefined) v = v.text;
        else if (v instanceof Date) v = v.toISOString();
        else v = String(v);
      }
      return String(v).trim();
    };

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('sub_task') || wb.worksheets[0];
    if (!ws) {
      return res.status(400).json({ error: 'Worksheet tidak ditemukan dalam file' });
    }

    const HEADER_KEYS = [
      'order_no',
      'operation_no',
      'title',
      'standard_hours',
      'sort_order',
      'status',
      'progress',
    ];
    const colMap = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = cellText(cell).toLowerCase().replace(/\s+/g, '_');
      if (HEADER_KEYS.includes(key) && colMap[key] === undefined) colMap[key] = colNumber;
    });
    const missing = ['order_no', 'operation_no', 'title'].filter((k) => colMap[k] === undefined);
    if (missing.length) {
      return res
        .status(400)
        .json({ error: `Header kolom wajib tidak ditemukan: ${missing.join(', ')}` });
    }

    const ALLOWED_STATUS = ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'DONE'];

    if (commit) {
      client = await pgPool.connect();
      await client.query('BEGIN');
    }
    const q = commit ? client : db;

    const preview = [];
    let created = 0,
      updated = 0,
      rejected = 0;
    const affectedOps = new Set();

    const reject = (index, order_no, operation_no, title, reason) => {
      preview.push({ index, order_no, operation_no, title, action: 'reject', reason });
      rejected++;
    };

    const lastRow = ws.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const get = (key) => (colMap[key] !== undefined ? cellText(row.getCell(colMap[key])) : '');

      const orderNoRaw = get('order_no');
      const opNoRaw = get('operation_no');
      const titleRaw = get('title');
      const hoursRaw = get('standard_hours');
      const sortRaw = get('sort_order');
      const statusRaw = get('status');
      const progRaw = get('progress');

      if (!orderNoRaw && !opNoRaw && !titleRaw) continue;

      const index = r;

      const opNo = parseInt(opNoRaw, 10);
      if (!orderNoRaw || isNaN(opNo)) {
        reject(index, orderNoRaw, opNoRaw, titleRaw, 'order_no / operation_no tidak valid');
        continue;
      }

      const opRes = await q.query(
        `SELECT idsow, order_no, planhours FROM sow
          WHERE ltrim(order_no, '0') = ltrim($1, '0') AND operation_no = $2::int
          LIMIT 1`,
        [orderNoRaw, opNo]
      );
      if (opRes.rows.length === 0) {
        reject(index, orderNoRaw, opNoRaw, titleRaw, 'Operasi tidak ditemukan');
        continue;
      }
      const op = opRes.rows[0];

      if (!titleRaw) {
        reject(index, orderNoRaw, opNoRaw, titleRaw, 'title wajib diisi');
        continue;
      }
      let hours = 1;
      const hoursProvided = hoursRaw !== '';
      if (hoursProvided) {
        hours = Number(hoursRaw);
        if (isNaN(hours) || hours < 0) {
          reject(index, orderNoRaw, opNoRaw, titleRaw, 'standard_hours tidak boleh negatif');
          continue;
        }
      }
      let so;
      if (sortRaw !== '') {
        so = parseInt(sortRaw, 10);
        if (isNaN(so)) {
          reject(index, orderNoRaw, opNoRaw, titleRaw, 'sort_order harus berupa angka');
          continue;
        }
      }
      let statusVal;
      if (statusRaw !== '') {
        statusVal = statusRaw.toUpperCase();
        if (!ALLOWED_STATUS.includes(statusVal)) {
          reject(index, orderNoRaw, opNoRaw, titleRaw, 'status tidak valid');
          continue;
        }
      }
      let progVal;
      if (progRaw !== '') {
        const p = Number(progRaw);
        if (isNaN(p) || p < 0 || p > 100) {
          reject(index, orderNoRaw, opNoRaw, titleRaw, 'progress harus antara 0–100');
          continue;
        }
        progVal = Math.round(p);
      }

      const subRes = await q.query(
        `SELECT id FROM sow_sub_operation
          WHERE operation_id = $1 AND lower(trim(title)) = lower(trim($2)) AND is_active = true
          LIMIT 1`,
        [op.idsow, titleRaw]
      );
      const existing = subRes.rows[0];

      if (existing) {
        if (commit) {
          const sets = [];
          const vals = [];
          let i = 1;
          if (hoursProvided) {
            sets.push(`standard_hours = $${i++}`);
            vals.push(hours);
          }
          if (so !== undefined) {
            sets.push(`sort_order = $${i++}`);
            vals.push(so);
          }
          if (statusVal !== undefined) {
            sets.push(`status = $${i++}`);
            vals.push(statusVal);
          }
          if (progVal !== undefined) {
            sets.push(`progress = $${i++}`);
            vals.push(progVal);
          }
          sets.push(`updated_by = $${i++}`);
          vals.push(actor);
          sets.push('updated_at = now()');
          vals.push(existing.id);
          if (hoursProvided) {
            await assertSubtaskHoursCap(client, op.idsow, hours, existing.id);
          }
          await client.query(
            `UPDATE sow_sub_operation SET ${sets.join(', ')} WHERE id = $${i}`,
            vals
          );
          affectedOps.add(op.idsow);
        }
        preview.push({
          index,
          order_no: orderNoRaw,
          operation_no: opNoRaw,
          title: titleRaw,
          action: 'update',
        });
        updated++;
      } else {
        if (commit) {
          await assertSubtaskHoursCap(client, op.idsow, hours, null);
          await client.query(
            `INSERT INTO sow_sub_operation
               (operation_id, order_no, title, sort_order, standard_hours, progress, status, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [
              op.idsow,
              op.order_no || null,
              titleRaw,
              so !== undefined ? so : 0,
              hours,
              progVal !== undefined ? progVal : 0,
              statusVal !== undefined ? statusVal : 'NOT_STARTED',
              actor,
            ]
          );
          affectedOps.add(op.idsow);
        }
        preview.push({
          index,
          order_no: orderNoRaw,
          operation_no: opNoRaw,
          title: titleRaw,
          action: 'create',
        });
        created++;
      }
    }

    if (commit) {
      for (const idsow of affectedOps) {
        await recomputeSubtaskWeights(client, idsow);
        await recomputeOperationProgress(client, idsow);
      }
      await client.query('COMMIT');
    }

    res.json({
      preview,
      summary: { created, updated, rejected, total: preview.length },
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.getAll = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sow');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const { order } = req.params;
    const result = await db.query(
      'SELECT * FROM sow WHERE "order_no" = $1 ORDER BY operation_no ASC',
      [order]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getByIdent = async (req, res) => {
  try {
    const { ssbr_id, group } = req.params;

    if (!ssbr_id || !group) {
      return res.status(400).json({
        error: 'ssbr_id dan group wajib diisi',
      });
    }

    const query = `
      SELECT * 
      FROM sow 
      WHERE "ssbr_id" = $1 
        AND "group" = $2 
      ORDER BY operation_no ASC
    `;

    const result = await db.query(query, [ssbr_id, group]);

    return res.json(result.rows);
  } catch (err) {
    console.error('getByIdent error:', err);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

exports.get2data = async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT
        s.*,
        latest.remaining_seconds_before
      FROM sow s
      LEFT JOIN LATERAL (
        SELECT v.remaining_seconds_before
        FROM public.vw_timesheet_std_performance v
        WHERE v.order_no = s.order_no
          AND v.operation_no = s.operation_no
        ORDER BY v.longdate_checkin DESC NULLS LAST, v.tsnumber DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (s.order_no ILIKE $1 OR s.ssbr_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY s.operation_no ASC';

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data not found' });
    }

    const columns = Object.keys(result.rows[0]);

    const csvHeader = columns.join(';') + '\n';

    const csvData = result.rows
      .map((row) =>
        columns
          .map((col) => {
            let value = row[col];
            if (value === null || value === undefined) value = '';
            value = String(value).replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(';')
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sow_${search || 'all'}.csv"`);

    res.send(csvHeader + csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDataJSON = async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT
        s.*,
        latest.remaining_seconds_before
      FROM sow s
      LEFT JOIN LATERAL (
        SELECT v.remaining_seconds_before
        FROM public.vw_timesheet_std_performance v
        WHERE v.order_no = s.order_no
          AND v.operation_no = s.operation_no
        ORDER BY v.longdate_checkin DESC NULLS LAST, v.tsnumber DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (s.order_no ILIKE $1 OR s.ssbr_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY s.operation_no ASC';

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data not found' });
    }

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getbymesinid = async (req, res) => {
  try {
    const { order } = req.params;
    const { workcenter } = req.query;

    const result = await db.query(
      'SELECT * FROM sow WHERE "order_no" = $1 AND workcenter = $2 ORDER BY operation_no ASC',
      [order, workcenter]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    console.log('='.repeat(50));
    console.log('[SOW CREATE] Request received:', new Date().toISOString());
    console.log('[SOW CREATE] Body:', JSON.stringify(req.body, null, 2));

    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operation_text,
      workcenterdescription,
      planhours,
      confirmation,
      status,
      finish_date,
      type,
      group_name,
      category,
      remark,
    } = req.body;

    console.log('[SOW CREATE] Inserting to database...');

    const result = await db.query(
      `INSERT INTO sow (
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        "group",
        category,
        remark
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        group_name,
        category,
        remark,
      ]
    );

    console.log('[SOW CREATE] Success! ID:', result.rows[0].idsow);
    console.log('='.repeat(50));

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SOW CREATE] ERROR:', err.message);
    console.error('[SOW CREATE] Stack:', err.stack);
    console.error('='.repeat(50));

    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await db.query('UPDATE sow SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.finish = async (req, res) => {
  let client = null;
  try {
    const { selectedactivity } = req.body;
    const { order_no, ssbr_id, operation_no, operation_text, machine_id } = selectedactivity || {};
    const status = 'FINISH';
    const longdate_checkout = new Date();
    const operationNo = Number.parseInt(operation_no, 10);

    if (!order_no || !Number.isFinite(operationNo)) {
      return res.status(400).json({ error: 'order_no and operation_no are required' });
    }

    if (!machine_id) {
      return res.status(400).json({ error: 'machine_id is required for buffer transaction' });
    }

    client = typeof db.connect === 'function' ? await db.connect() : null;
    const query = client ? client.query.bind(client) : db.query.bind(db);
    if (client) await query('BEGIN');

    const result = await query(
      `UPDATE sow
         SET status = $1,
             finish_date = $2
       WHERE order_no = $3 AND operation_no = $4
       RETURNING *`,
      [status, longdate_checkout, order_no, operationNo]
    );

    if (result.rowCount === 0) {
      const error = new Error('SOW activity not found');
      error.status = 404;
      throw error;
    }

    const bufferResult = await query(
      `INSERT INTO public.buffer_transaction (
         type,
         machine_id,
         order_no,
         ssbr_id,
         operation_no,
         operation_text
       )
       VALUES ('out', $1, $2, NULLIF($3, ''), $4, NULLIF($5, ''))
       RETURNING *`,
      [machine_id, order_no, ssbr_id || '', operationNo, operation_text || '']
    );

    if (client) await query('COMMIT');
    res.json({ ...result.rows[0], buffer_transaction: bufferResult.rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('DELETE FROM sow WHERE idsow = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: 'ID not found',
      });
    }

    res.status(200).json({
      message: 'Deleted successfully',
      id: id,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.createexcel = async (req, res) => {
  try {
    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operation_text,
      workcenterdescription,
      planhours,
      confirmation,
    } = req.body;

    const result = await db.query(
      `INSERT INTO sow (
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14
      )
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateexcel = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('========== updateexcel CALLED ==========');
    console.log('ID:', id);
    console.log('FULL BODY:', JSON.stringify(req.body, null, 2));

    const {
      order_no,
      operation_no,
      ssbr_id,
      part_number,
      part_name,
      model,
      customer,
      location,
      wct_group,
      workcenter,
      operation_text,
      workcenterdescription,
      planhours,
      confirmation,
      status,
      finish_date,
      type,
      group_name,
      category,
      remark,
    } = req.body;

    console.log('type:', type);
    console.log('group_name:', group_name);
    console.log('category:', category);
    console.log('remark:', remark);

    const result = await db.query(
      `UPDATE sow SET
        order_no = $1,
        operation_no = $2,
        ssbr_id = $3,
        part_number = $4,
        part_name = $5,
        model = $6,
        customer = $7,
        location = $8,
        wct_group = $9,
        workcenter = $10,
        operation_text = $11,
        workcenterdescription = $12,
        planhours = $13,
        confirmation = $14,
        status = $15,
        finish_date = $16,
        type = $17,
        "group" = $18,
        category = $19,
        remark = $20
      WHERE idsow = $21
      RETURNING *`,
      [
        order_no,
        operation_no,
        ssbr_id,
        part_number,
        part_name,
        model,
        customer,
        location,
        wct_group,
        workcenter,
        operation_text,
        workcenterdescription,
        planhours,
        confirmation,
        status,
        finish_date,
        type,
        group_name,
        category,
        remark,
        id,
      ]
    );

    console.log('QUERY RESULT:', JSON.stringify(result.rows[0], null, 2));
    console.log('========== updateexcel END ==========');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('ERROR in updateexcel:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.upsert = async (req, res) => {
  try {
    console.log('=== UPSERT START ===');
    console.log('Body received:', JSON.stringify(req.body, null, 2));

    const {
      ssbr_id,
      order_no,
      customer,
      location,
      part_name,
      model,
      part_number,
      created_by,
      type,
      group,
      category,
      operations,
    } = req.body;

    if (!order_no || !operations || operations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: ssbr_id, group, atau operations',
      });
    }

    console.log('Validation passed');

    const results = [];

    for (let idx = 0; idx < operations.length; idx++) {
      const op = operations[idx];
      console.log(`Processing operation ${idx + 1}/${operations.length}:`, op.operation_no);
      const workcenterCode = op.workcenter || op.machineid || null;
      const wctGroup = await resolveWctGroup(
        db.query.bind(db),
        workcenterCode,
        op.wct_group || null,
        op.operation_text
      );

      const checkQuery = `
        SELECT idsow FROM sow 
        WHERE order_no = $1  AND operation_no = $2
      `;

      console.log('Check query params:', [order_no, op.operation_no]);
      const existing = await db.query(checkQuery, [order_no, op.operation_no]);
      console.log('Existing rows found:', existing.rows.length);

      let result;

      if (existing.rows.length > 0) {
        console.log('UPDATE mode for operation:', op.operation_no);

        const updateQuery = `
  UPDATE sow SET 
    order_no = $1,
    part_number = $2,
    part_name = $3,
    model = $4,
    customer = $5,
    location = $6,
    wct_group = $7,
    workcenter = $8,
    operation_text = $9,
    planhours = $10,
    remark = $11,
    weight = $12,
    created_by = $13,
    "type" = $14,
    category = $15,
    ssbr_id = $16,
    "group" = $17
  WHERE order_no = $1 AND operation_no = $18
  RETURNING *, 'updated' as action
`;

        result = await db.query(updateQuery, [
          order_no,
          part_number,
          part_name,
          model,
          customer,
          location,
          wctGroup,
          workcenterCode,
          op.operation_text,
          op.planhours,
          op.remark,
          op.weight,
          created_by,
          type,
          category,
          ssbr_id,
          group,
          op.operation_no,
        ]);
        console.log('UPDATE success for:', op.operation_no);
      } else {
        console.log('INSERT mode for operation:', op.operation_no);

        const insertQuery = `
          INSERT INTO sow (
            ssbr_id, "group", operation_no, order_no, part_number,
            part_name, model, customer, location, wct_group,
            workcenter, operation_text, planhours, remark, weight,
            created_by, "type", category
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING *, 'created' as action
        `;

        result = await db.query(insertQuery, [
          ssbr_id,
          group,
          op.operation_no,
          order_no,
          part_number,
          part_name,
          model,
          customer,
          location,
          wctGroup,
          workcenterCode,
          op.operation_text,
          op.planhours,
          op.remark,
          op.weight,
          created_by,
          type,
          category,
        ]);
        console.log('INSERT success for:', op.operation_no);
      }

      results.push(result.rows[0]);
    }

    console.log('=== UPSERT SUCCESS ===');

    res.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (err) {
    console.error('❌ UPSERT ERROR:', err);
    console.error('Error message:', err.message);
    console.error('Error detail:', err.detail);

    res.status(500).json({
      success: false,
      error: err.message,
      detail: err.detail || null,
    });
  }
};

exports.createFromBuilder = async (req, res) => {
  const {
    order_no,
    production_order,
    ssbr_id,
    part_number,
    part_name,
    model,
    customer,
    location,
    created_by,
    type,
    group,
    category,
    remark,
    operations,
  } = req.body;

  const normalizedOrderNo = normalizeOrderNo(order_no || production_order);

  if (!normalizedOrderNo) {
    return res.status(400).json({
      success: false,
      error: 'Production order wajib diisi untuk membuat SOW',
    });
  }

  if (!Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Minimal 1 operasi wajib dipilih atau ditambahkan',
    });
  }

  let client = null;

  try {
    await ensureSowRuntimeColumns();
    client = typeof db.connect === 'function' ? await db.connect() : null;
    const query = client ? client.query.bind(client) : db.query.bind(db);

    if (client) await query('BEGIN');

    const results = [];

    for (const op of operations) {
      const operationNo = Number.parseInt(op.operation_no, 10);
      if (!Number.isFinite(operationNo)) {
        throw new Error('Operation number tidak valid');
      }

      let planhours =
        op.planhours !== undefined && op.planhours !== ''
          ? Number.parseFloat(op.planhours)
          : op.std_hours !== undefined && op.std_hours !== ''
            ? Number.parseFloat(op.std_hours)
            : null;

      const rawVa = Number.parseFloat(op.va_hours);
      const rawNnva = Number.parseFloat(op.nnva_hours);
      const hasBreakdown = Number.isFinite(rawVa) || Number.isFinite(rawNnva);
      const vaHours = hasBreakdown ? Math.max(0, Number.isFinite(rawVa) ? rawVa : 0) : null;
      const nnvaHours = hasBreakdown ? Math.max(0, Number.isFinite(rawNnva) ? rawNnva : 0) : null;
      if (hasBreakdown) planhours = vaHours + nnvaHours;
      const workcenterCode = op.workcenter || op.machineid || null;
      const wctGroup = await resolveWctGroup(
        query,
        workcenterCode,
        op.wct_group || null,
        op.operation_text
      );

      const result = await query(
        `
          INSERT INTO sow (
            order_no,
            operation_no,
            ssbr_id,
            part_number,
            part_name,
            model,
            customer,
            location,
            wct_group,
            workcenter,
            operation_text,
            workcenterdescription,
            planhours,
            status,
            created_by,
            "type",
            "group",
            category,
            remark,
            source_op_id,
            va_hours,
            nnva_hours
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22
          )
          ON CONFLICT (order_no, operation_no)
          DO UPDATE SET
            ssbr_id = EXCLUDED.ssbr_id,
            part_number = EXCLUDED.part_number,
            part_name = EXCLUDED.part_name,
            model = EXCLUDED.model,
            customer = EXCLUDED.customer,
            location = EXCLUDED.location,
            wct_group = EXCLUDED.wct_group,
            workcenter = EXCLUDED.workcenter,
            operation_text = EXCLUDED.operation_text,
            workcenterdescription = EXCLUDED.workcenterdescription,
            planhours = EXCLUDED.planhours,
            status = COALESCE(sow.status, EXCLUDED.status),
            created_by = COALESCE(EXCLUDED.created_by, sow.created_by),
            "type" = EXCLUDED."type",
            "group" = EXCLUDED."group",
            category = EXCLUDED.category,
            remark = EXCLUDED.remark,
            source_op_id = EXCLUDED.source_op_id,
            -- Jangan hapus rincian yang sudah ada bila klien lama mengirim tanpa va/nnva.
            va_hours = COALESCE(EXCLUDED.va_hours, sow.va_hours),
            nnva_hours = COALESCE(EXCLUDED.nnva_hours, sow.nnva_hours),
            sync = 'new'
          RETURNING *
        `,
        [
          normalizedOrderNo,
          operationNo,
          ssbr_id || null,
          part_number || null,
          part_name || null,
          model || null,
          customer || null,
          location || null,
          wctGroup,
          workcenterCode,
          op.operation_text || null,
          op.workcenterdescription || null,
          Number.isFinite(planhours) ? planhours : null,
          'OPEN',
          created_by || null,
          type || null,
          group || null,
          category || null,
          op.remark || remark || null,
          op.source_op_id || null,
          vaHours,
          nnvaHours,
        ]
      );

      results.push(result.rows[0]);
    }

    if (client) await query('COMMIT');

    res.json({
      success: true,
      order_no: normalizedOrderNo,
      count: results.length,
      data: results,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    res.status(500).json({
      success: false,
      error: err.message,
      detail: err.detail || null,
    });
  } finally {
    if (client) client.release();
  }
};

exports.getBySSBRAndGroup = async (req, res) => {
  try {
    const { ssbr_id, group } = req.params;

    console.log('=== GET DATA START ===');
    console.log('Search params:', { order_no, operation_no });

    const query = `
      SELECT 
        ssbr_id,
        order_no,
        customer,
        location,
        part_name,
        model,
        part_number,
        created_by,
        "type",
        "group",
        category,
        operation_no,
        operation_text,
        wct_group,
        workcenter,
        planhours,
        remark,
        weight
      FROM sow
      WHERE order_no = $1 AND operation_no = $2
      ORDER BY operation_no ASC
    `;

    const result = await db.query(query, [ssbr_id, group]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data tidak ditemukan',
      });
    }

    const firstRow = result.rows[0];
    const header = {
      ssbr_id: firstRow.ssbr_id,
      order_no: firstRow.order_no,
      customer: firstRow.customer,
      location: firstRow.location,
      part_name: firstRow.part_name,
      model: firstRow.model,
      part_number: firstRow.part_number,
      created_by: firstRow.created_by,
      type: firstRow.type,
      group: firstRow.group,
      category: firstRow.category,
    };

    const operations = result.rows.map((row) => ({
      operation_no: row.operation_no,
      operation_text: row.operation_text,
      wct_group: row.wct_group,
      workcenter: row.workcenter,
      planhours: row.planhours,
      remark: row.remark,
      weight: row.weight,
    }));

    console.log('Data found:', result.rows.length, 'operations');
    console.log('=== GET DATA SUCCESS ===');

    res.json({
      success: true,
      count: operations.length,
      header: header,
      operations: operations,
    });
  } catch (err) {
    console.error('❌ GET DATA ERROR:', err);
    console.error('Error message:', err.message);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.getcsv = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sow');

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No data found' });
    }

    const columns = Object.keys(result.rows[0]);

    const csvHeader = columns.join(',') + '\n';

    const csvData = result.rows
      .map((row) => {
        return columns
          .map((col) => {
            let value = row[col];

            if (value === null || value === undefined) {
              value = '';
            }

            if (
              typeof value === 'string' &&
              (value.includes(',') || value.includes('"') || value.includes('\n'))
            ) {
              value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
          })
          .join(',');
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sow_data.csv"');

    res.send(csvHeader + csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getcsvbyid = async (req, res) => {
  try {
    const { order_no } = req.params;

    const result = await db.query('SELECT * FROM sow WHERE order_no = $1', [order_no]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No data found' });
    }

    const columns = Object.keys(result.rows[0]);

    const csvHeader = columns.join(',') + '\n';

    const csvData = result.rows
      .map((row) => {
        return columns
          .map((col) => {
            let value = row[col];
            if (value === null || value === undefined) {
              value = '';
            }
            if (
              typeof value === 'string' &&
              (value.includes(',') || value.includes('"') || value.includes('\n'))
            ) {
              value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
          })
          .join(',');
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sow_${order_no}.csv"`);

    res.send(csvHeader + csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllParts = async (req, res) => {
  try {
    console.log('📋 getAllParts called');

    const result = await db.query(`
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        COALESCE(SUM(o.planhours), 0) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      GROUP BY p.part_id
      ORDER BY p.partnumber
    `);

    console.log(`✅ Found ${result.rows.length} parts`);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error('❌ Error in getAllParts:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.searchParts = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return exports.getAllParts(req, res);
    }

    const result = await db.query(
      `
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      WHERE 
        p.partnumber ILIKE $1 OR
        p.partname ILIKE $1 OR
        p.model ILIKE $1
      GROUP BY p.part_id
      ORDER BY p.partnumber
    `,
      [`%${query}%`]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPartById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT 
        p.*,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
      WHERE p.part_id = $1
      GROUP BY p.part_id
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createPart = async (req, res) => {
  try {
    const { partnumber, partname, model, drawing_path } = req.body;

    if (!partnumber || !partname || !model) {
      return res.status(400).json({
        error: 'partnumber, partname, and model are required',
      });
    }

    const result = await db.query(
      `
      INSERT INTO parts (partnumber, partname, model, drawing_path)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [partnumber, partname, model, drawing_path || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Part number already exists',
      });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.updatePart = async (req, res) => {
  try {
    const { id } = req.params;
    const { partnumber, partname, model, drawing_path } = req.body;

    if (!partnumber || !partname || !model) {
      return res.status(400).json({
        error: 'partnumber, partname, and model are required',
      });
    }

    const result = await db.query(
      `
      UPDATE parts
      SET partnumber = $1,
          partname = $2,
          model = $3,
          drawing_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE part_id = $5
      RETURNING *
    `,
      [partnumber, partname, model, drawing_path || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Part number already exists',
      });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.deletePart = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      DELETE FROM parts
      WHERE part_id = $1
      RETURNING *
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    res.json({
      message: 'Part deleted successfully',
      deleted: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOperationsByPartId = async (req, res) => {
  try {
    const { part_id } = req.params;

    const result = await db.query(
      `
      SELECT *
      FROM operations
      WHERE part_id = $1
      ORDER BY operation_no
    `,
      [part_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOperationById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT *
      FROM operations
      WHERE operation_id = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createOperation = async (req, res) => {
  try {
    const {
      part_id,
      operation_no,
      operation_text,
      wct_group,
      workcenter,
      planhours,
      drawing_path,
      remark,
    } = req.body;

    if (!part_id || !operation_no || !operation_text) {
      return res.status(400).json({
        error: 'part_id, operation_no, and operation_text are required',
      });
    }

    const result = await db.query(
      `
      INSERT INTO operations
      (part_id, operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
      [
        part_id,
        operation_no,
        operation_text,
        wct_group || null,
        workcenter || null,
        planhours || null,
        drawing_path || null,
        remark || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Operation number already exists for this part',
      });
    }

    if (err.code === '23503') {
      return res.status(404).json({
        error: 'Part not found',
      });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.updateOperation = async (req, res) => {
  try {
    const { id } = req.params;
    const { operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark } =
      req.body;

    if (!operation_no || !operation_text) {
      return res.status(400).json({
        error: 'operation_no and operation_text are required',
      });
    }

    const result = await db.query(
      `
      UPDATE operations
      SET operation_no = $1,
          operation_text = $2,
          wct_group = $3,
          workcenter = $4,
          planhours = $5,
          drawing_path = $6,
          remark = $7,
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = $8
      RETURNING *
    `,
      [
        operation_no,
        operation_text,
        wct_group || null,
        workcenter || null,
        planhours || null,
        drawing_path || null,
        remark || null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Operation number already exists for this part',
      });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.deleteOperation = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      DELETE FROM operations
      WHERE operation_id = $1
      RETURNING *
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    res.json({
      message: 'Operation deleted successfully',
      deleted: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createPartWithOperations = async (req, res) => {
  let client;

  try {
    const { part, operations } = req.body;

    if (!part || !part.partnumber || !part.partname || !part.model) {
      return res.status(400).json({
        error: 'Part information is required (partnumber, partname, model)',
      });
    }

    client = await pgPool.connect();
    await client.query('BEGIN');

    const partResult = await client.query(
      `
      INSERT INTO parts (partnumber, partname, model, drawing_path)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [part.partnumber, part.partname, part.model, part.drawing_path || null]
    );

    const newPart = partResult.rows[0];

    let newOperations = [];
    if (operations && operations.length > 0) {
      for (const op of operations) {
        const opResult = await client.query(
          `
          INSERT INTO operations
          (part_id, operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
          [
            newPart.part_id,
            op.operation_no,
            op.operation_text,
            op.wct_group || null,
            op.workcenter || null,
            op.planhours || null,
            op.drawing_path || null,
            op.remark || null,
          ]
        );
        newOperations.push(opResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      part: newPart,
      operations: newOperations,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});

    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Part number or operation number already exists',
      });
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.updatePartWithOperations = async (req, res) => {
  let client;

  try {
    const { id } = req.params;
    const { part, operations } = req.body;

    if (!part || !part.partnumber || !part.partname || !part.model) {
      return res.status(400).json({
        error: 'Part information is required (partnumber, partname, model)',
      });
    }

    client = await pgPool.connect();
    await client.query('BEGIN');

    const partResult = await client.query(
      `
      UPDATE parts
      SET partnumber = $1,
          partname = $2,
          model = $3,
          drawing_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE part_id = $5
      RETURNING *
    `,
      [part.partnumber, part.partname, part.model, part.drawing_path || null, id]
    );

    if (partResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Part not found' });
    }

    const updatedPart = partResult.rows[0];

    await client.query(`DELETE FROM operations WHERE part_id = $1`, [id]);

    let newOperations = [];
    if (operations && operations.length > 0) {
      for (const op of operations) {
        const opResult = await client.query(
          `
          INSERT INTO operations
          (part_id, operation_no, operation_text, wct_group, workcenter, planhours, drawing_path, remark)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
          [
            id,
            op.operation_no,
            op.operation_text,
            op.wct_group || null,
            op.workcenter || null,
            op.planhours || null,
            op.drawing_path || null,
            op.remark || null,
          ]
        );
        newOperations.push(opResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    res.json({
      part: updatedPart,
      operations: newOperations,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});

    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Part number or operation number already exists',
      });
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};

exports.getCompleteSOW = async (req, res) => {
  try {
    const { id } = req.params;

    const partResult = await db.query(
      `
      SELECT * FROM parts WHERE part_id = $1
    `,
      [id]
    );

    if (partResult.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }

    const opsResult = await db.query(
      `
      SELECT * FROM operations
      WHERE part_id = $1
      ORDER BY operation_no
    `,
      [id]
    );

    res.json({
      part: partResult.rows[0],
      operations: opsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStatistics = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT p.part_id) as total_parts,
        COUNT(DISTINCT p.model) as total_models,
        COUNT(o.operation_id) as total_operations,
        SUM(o.planhours) as total_hours,
        AVG(o.planhours) as avg_hours_per_operation
      FROM parts p
      LEFT JOIN operations o ON p.part_id = o.part_id
    `);

    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDrawingUsageReport = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.partnumber,
        p.partname,
        o.drawing_path,
        COUNT(*) as usage_count,
        STRING_AGG(o.operation_no::TEXT || ': ' || o.operation_text, ' | ' ORDER BY o.operation_no) as operations
      FROM operations o
      JOIN parts p ON o.part_id = p.part_id
      WHERE o.drawing_path IS NOT NULL
      GROUP BY p.partnumber, p.partname, o.drawing_path
      HAVING COUNT(*) > 1
      ORDER BY usage_count DESC, p.partnumber
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPlanhours = async (req, res) => {
  try {
    const { order_no, operation_no } = req.query;
    if (!order_no || !operation_no) {
      return res.status(400).json({ error: 'order_no and operation_no are required' });
    }
    const codenumber = order_no + operation_no;
    const result = await db.query('SELECT planhours FROM sow WHERE codenumber = $1 LIMIT 1', [
      codenumber,
    ]);
    if (result.rows.length === 0) {
      return res.json({ planhours: null });
    }
    res.json({ planhours: result.rows[0].planhours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPlanhoursMulti = async (req, res) => {
  try {
    const { codenumbers } = req.body;
    if (!Array.isArray(codenumbers) || codenumbers.length === 0) {
      return res.json({});
    }

    const unique = [...new Set(codenumbers)];
    const result = await db.query(
      'SELECT codenumber, planhours FROM sow WHERE codenumber = ANY($1::text[])',
      [unique]
    );
    const map = {};
    for (const row of result.rows) {
      map[row.codenumber] = row.planhours;
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowStandard = async (req, res) => {
  try {
    const { search } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (c.part_name   ILIKE $1
                    OR c.part_number ILIKE $1
                    OR c.model       ILIKE $1)`;
    }

    const countResult = await db.query(
      `SELECT COUNT(*)
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await db.query(
      `SELECT
         ss.id,
         ss.component_id,
         ss.operation_no,
         ss.operation_text,
         ss.machineid,
         ss.workcenter,
         ss.std_hours,
         ss.remark,
         ss.source_plant,
         c.part_name,
         c.part_number,
         c.model
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       ${where}
       ORDER BY c.part_name ASC, ss.operation_no ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowStandardGrouped = async (req, res) => {
  try {
    const { search } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (c.part_name   ILIKE $1
                    OR c.part_number ILIKE $1
                    OR c.model       ILIKE $1)`;
    }

    const countResult = await db.query(
      `SELECT COUNT(DISTINCT c.component_id)
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const componentResult = await db.query(
      `SELECT
         c.component_id,
         c.part_name,
         c.part_number,
         c.model,
         COUNT(ss.id)::int AS operation_count,
         COUNT(DISTINCT t.template_id)::int AS template_count,
         COALESCE(MAX(ss.source_plant), 0) AS source_plant
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       LEFT JOIN sow_templates t
         ON t.component_id = c.component_id
        AND COALESCE(t.is_active, true) = true
       ${where}
       GROUP BY c.component_id, c.part_name, c.part_number, c.model
       ORDER BY c.part_name ASC, c.part_number ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: componentResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateSowStandardComponent = async (req, res) => {
  try {
    const { component_id } = req.params;
    const { part_name, part_number, model } = req.body || {};
    const fields = [];
    const params = [];
    const push = (col, value) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        params.push(String(value).trim());
        fields.push(`${col} = $${params.length}`);
      }
    };
    push("part_name", part_name);
    push("part_number", part_number);
    push("model", model);
    if (fields.length === 0) {
      return res.status(400).json({ error: "part_name, part_number, atau model wajib diisi" });
    }
    params.push(component_id);
    const result = await db.query(
      `UPDATE components SET ${fields.join(", ")} WHERE component_id = $${params.length}
       RETURNING component_id, part_name, part_number, model`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Component not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Model + Part Number sudah dipakai komponen lain" });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.downloadSowStandard = async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let where = "";
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where = ` WHERE (c.part_name ILIKE $1 OR c.part_number ILIKE $1 OR c.model ILIKE $1)`;
    }

    const result = await db.query(
      `SELECT
         c.part_name, c.model, c.part_number,
         ss.operation_no, ss.operation_text, ss.machineid AS wct_group, ss.workcenter,
         ss.std_hours, ss.va_hours, ss.remark, ss.source_plant,
         COALESCE((
           SELECT string_agg(t.template_name, ', ' ORDER BY COALESCE(t.sort_order, 0), t.template_name)
           FROM sow_template_lines tl
           JOIN sow_templates t ON t.template_id = tl.template_id
           WHERE tl.standard_id = ss.id AND COALESCE(t.is_active, true) = true
         ), '') AS template_name,
         COALESCE(SUM(ns.standard_hours) FILTER (WHERE lower(nb.name) = 'loading'), 0)::float AS loading,
         COALESCE(SUM(ns.standard_hours) FILTER (WHERE lower(nb.name) = 'setting'), 0)::float AS setting,
         COALESCE(SUM(ns.standard_hours) FILTER (WHERE lower(nb.name) = 'measurement'), 0)::float AS measurement,
         COALESCE(SUM(ns.standard_hours) FILTER (WHERE lower(nb.name) = 'unloading'), 0)::float AS unloading
       FROM sow_standard ss
       JOIN components c ON c.component_id = ss.component_id
       LEFT JOIN sow_nnva_standard ns ON ns.sow_standard_id = ss.id
       LEFT JOIN sow_nnva_base nb ON nb.id = ns.nnva_base_id
       ${where}
       GROUP BY ss.id, c.component_id
       ORDER BY c.part_name ASC, c.part_number ASC, ss.operation_no ASC`,
      params
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Standard SOW");
    const headers = [
      "template_name", "operation_no", "operation_text", "part_name", "model",
      "part_number", "wct_group", "std_hours", "loading", "setting",
      "measurement", "unloading", "total_std", "remark", "source_plant",
    ];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: h === "operation_text" || h === "template_name" ? 32 : h === "remark" ? 24 : 14 }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAF0F8" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    for (const r of result.rows) {
      const loading = Number(r.loading) || 0;
      const setting = Number(r.setting) || 0;
      const measurement = Number(r.measurement) || 0;
      const unloading = Number(r.unloading) || 0;
      const nnvaTotal = loading + setting + measurement + unloading;
      const totalStd = Number(r.std_hours) || 0;
      const va = r.va_hours != null ? Number(r.va_hours) : Math.max(0, totalStd - nnvaTotal);
      const round2 = (v) => Math.round(v * 100) / 100;
      ws.addRow({
        template_name: r.template_name || "",
        operation_no: r.operation_no,
        operation_text: r.operation_text || "",
        part_name: r.part_name || "",
        model: r.model || "",
        part_number: r.part_number || "",
        wct_group: r.wct_group || "",
        std_hours: round2(va),
        loading: round2(loading),
        setting: round2(setting),
        measurement: round2(measurement),
        unloading: round2(unloading),
        total_std: round2(totalStd),
        remark: r.remark || "",
        source_plant: r.source_plant || "",
      });
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = search && search.trim() ? `standard_sow_${search.trim().replace(/[^\w.-]+/g, "_")}_${date}.xlsx` : `standard_sow_${date}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("sow-standard download error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getSowStandardByComponent = async (req, res) => {
  try {
    const { component_id } = req.params;
    const result = await db.query(
      `SELECT
         ss.id,
         ss.operation_no,
         ss.operation_text,
         ss.machineid,
         ss.workcenter,
         ss.std_hours,
         ss.va_hours,
         ss.remark,
         ss.source_plant,
         -- Total NNVA standar, dipakai klien untuk men-snapshot nnva_hours ke baris SOW saat
         -- operasi ini dipilih. Dikirim MENTAH (tanpa clamp); klien yang membatasi ke std_hours.
         COALESCE((
           SELECT SUM(COALESCE(ns.standard_hours, 0))
           FROM public.sow_nnva_standard ns
           WHERE ns.sow_standard_id = ss.id
         ), 0) AS nnva_hours,
         COALESCE(
           json_agg(
             json_build_object(
               'id', a.id,
               'filename', a.filename,
               'original_name', a.original_name,
               'file_path', a.file_path,
               'file_size', a.file_size,
               'uploaded_at', a.uploaded_at
             ) ORDER BY a.uploaded_at
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'
         ) AS attachments
       FROM sow_standard ss
       LEFT JOIN sow_standard_attachments a ON a.standard_id = ss.id
       WHERE ss.component_id = $1
       GROUP BY ss.id
       ORDER BY ss.operation_no ASC`,
      [component_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowTemplatesByComponent = async (req, res) => {
  try {
    const { component_id } = req.params;
    const result = await db.query(
      `SELECT
         t.template_id,
         t.component_id,
         t.template_key,
         t.template_name,
         COALESCE(t.sort_order, 0) AS sort_order,
         COALESCE(
           json_agg(
             json_build_object(
               'id', ss.id,
               'operation_no', ss.operation_no,
               'operation_text', ss.operation_text,
               'machineid', ss.machineid,
               'workcenter', ss.workcenter,
               'std_hours', ss.std_hours,
               'nnva_hours', COALESCE(nn.nnva_h, 0),
               'remark', ss.remark,
               'source_plant', ss.source_plant,
               'line_order', COALESCE(tl.line_order, ss.operation_no)
             )
             ORDER BY COALESCE(tl.line_order, ss.operation_no), ss.operation_no, ss.id
           ) FILTER (WHERE ss.id IS NOT NULL),
           '[]'
         ) AS operations,
         COUNT(ss.id)::int AS operation_count,
         COALESCE(SUM(COALESCE(ss.std_hours, 0)), 0)::numeric AS total_std_hours
       FROM public.sow_templates t
       LEFT JOIN public.sow_template_lines tl ON tl.template_id = t.template_id
       LEFT JOIN public.sow_standard ss ON ss.id = tl.standard_id
       -- 1:1 dengan ss, jadi tidak menggandakan baris di dalam GROUP BY t.template_id.
       LEFT JOIN (
         SELECT sow_standard_id, SUM(COALESCE(standard_hours, 0)) AS nnva_h
         FROM public.sow_nnva_standard
         GROUP BY sow_standard_id
       ) nn ON nn.sow_standard_id = ss.id
       WHERE t.component_id = $1
         AND COALESCE(t.is_active, true) = true
       GROUP BY t.template_id
       ORDER BY COALESCE(t.sort_order, 0), t.template_name, t.template_key`,
      [component_id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTemplate = async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { component_id, template_name, template_key, sort_order, operation_ids } = req.body;
    if (!component_id || !template_name || !template_key) {
      return res
        .status(400)
        .json({ error: 'component_id, template_name, template_key wajib diisi' });
    }
    if (!Array.isArray(operation_ids) || operation_ids.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 operation' });
    }

    await client.query('BEGIN');

    const tmpl = await client.query(
      `INSERT INTO public.sow_templates (component_id, template_name, template_key, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [component_id, template_name, template_key, sort_order || 0, req.body.created_by || null]
    );
    const template_id = tmpl.rows[0].template_id;

    for (let i = 0; i < operation_ids.length; i++) {
      await client.query(
        `INSERT INTO public.sow_template_lines (template_id, standard_id, line_order)
         VALUES ($1,$2,$3)`,
        [template_id, operation_ids[i], (i + 1) * 10]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(tmpl.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Template key sudah digunakan untuk component ini' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.updateTemplate = async (req, res) => {
  const client = await pgPool.connect();
  try {
    const { templateId } = req.params;
    const { template_name, template_key, sort_order, operation_ids } = req.body;

    await client.query('BEGIN');

    await client.query(
      `UPDATE public.sow_templates
       SET template_name = $1, template_key = $2, sort_order = $3, updated_at = now()
       WHERE template_id = $4`,
      [template_name, template_key, sort_order || 0, templateId]
    );

    await client.query('DELETE FROM public.sow_template_lines WHERE template_id = $1', [
      templateId,
    ]);

    if (Array.isArray(operation_ids) && operation_ids.length > 0) {
      for (let i = 0; i < operation_ids.length; i++) {
        await client.query(
          `INSERT INTO public.sow_template_lines (template_id, standard_id, line_order)
           VALUES ($1,$2,$3)`,
          [templateId, operation_ids[i], (i + 1) * 10]
        );
      }
    }

    await client.query('COMMIT');

    const result = await client.query(
      `SELECT t.*, COALESCE(json_agg(tl.standard_id ORDER BY tl.line_order) FILTER (WHERE tl.standard_id IS NOT NULL), '[]') AS operation_ids
       FROM public.sow_templates t
       LEFT JOIN public.sow_template_lines tl ON tl.template_id = t.template_id
       WHERE t.template_id = $1
       GROUP BY t.template_id`,
      [templateId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Template key sudah digunakan untuk component ini' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    await db.query(
      `UPDATE public.sow_templates SET is_active = false, updated_at = now() WHERE template_id = $1`,
      [templateId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowStandardById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT
         ss.*,
         c.part_name, c.part_number, c.model,
         COALESCE(
           json_agg(
             json_build_object(
               'id', a.id,
               'filename', a.filename,
               'original_name', a.original_name,
               'file_path', a.file_path,
               'file_size', a.file_size,
               'uploaded_at', a.uploaded_at
             ) ORDER BY a.uploaded_at
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'
         ) AS attachments
       FROM sow_standard ss
       JOIN components c ON ss.component_id = c.component_id
       LEFT JOIN sow_standard_attachments a ON a.standard_id = ss.id
       WHERE ss.id = $1
       GROUP BY ss.id, c.part_name, c.part_number, c.model`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createSowStandardOperation = async (req, res) => {
  try {
    const {
      component_id,
      operation_no,
      operation_text,
      machineid,
      workcenter,
      std_hours,
      va_hours,
      source_plant,
      remark,
    } = req.body;
    if (!component_id || !operation_no || !operation_text) {
      return res
        .status(400)
        .json({ error: 'component_id, operation_no, dan operation_text wajib diisi' });
    }

    const rawVa = Number.parseFloat(va_hours);
    const vaValue = Number.isFinite(rawVa) ? Math.max(0, rawVa) : null;
    const totalHours = vaValue != null ? vaValue : std_hours || null;
    const result = await db.query(
      `INSERT INTO sow_standard (component_id, operation_no, operation_text, machineid, workcenter, std_hours, source_plant, remark, va_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        component_id,
        operation_no,
        operation_text,
        machineid || null,
        workcenter || null,
        totalHours,
        source_plant || null,
        remark || null,
        vaValue,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function getNnvaTotalForStandard(query, standardId) {
  const result = await query(
    `SELECT COALESCE(SUM(COALESCE(standard_hours, 0)), 0)::float AS total
       FROM public.sow_nnva_standard WHERE sow_standard_id = $1`,
    [standardId]
  );
  return Number(result.rows[0]?.total) || 0;
}

exports.updateSowStandardOperation = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      operation_no,
      operation_text,
      machineid,
      workcenter,
      std_hours,
      va_hours,
      source_plant,
      remark,
    } = req.body;

    const rawVa = Number.parseFloat(va_hours);
    const hasVa = Number.isFinite(rawVa);
    const vaValue = hasVa ? Math.max(0, rawVa) : null;
    const totalHours = hasVa
      ? vaValue + (await getNnvaTotalForStandard(db.query.bind(db), id))
      : std_hours || null;

    const result = await db.query(
      `UPDATE sow_standard
       SET operation_no=$1, operation_text=$2, machineid=$3, workcenter=$4, std_hours=$5, source_plant=$6, remark=$7,
           va_hours = COALESCE($9, va_hours)
       WHERE id=$8
       RETURNING *`,
      [
        operation_no,
        operation_text,
        machineid || null,
        workcenter || null,
        totalHours,
        source_plant || null,
        remark || null,
        id,
        vaValue,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSowStandardOperation = async (req, res) => {
  const client = await pgPool.connect();
  let uploadPaths = [];
  try {
    const { id } = req.params;
    await ensureSowOperationCardTable();
    await client.query('BEGIN');

    const attachments = await client.query(
      'SELECT file_path FROM sow_standard_attachments WHERE standard_id = $1',
      [id]
    );
    const operationCards = await client.query(
      'SELECT image_path, images FROM public.sow_operationcard WHERE sow_standard_id = $1',
      [id]
    );
    uploadPaths = collectUploadPaths(
      attachments.rows,
      operationCards.rows.flatMap((row) => [row.image_path, row.images])
    );

    await client.query('DELETE FROM public.sow_template_lines WHERE standard_id = $1', [id]);
    const deletedCards = await client.query(
      'DELETE FROM public.sow_operationcard WHERE sow_standard_id = $1',
      [id]
    );
    const result = await client.query('DELETE FROM sow_standard WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    await client.query('COMMIT');
    deleteStoredUploadFiles(uploadPaths);
    res.json({ deleted: true, operation_cards_deleted: deletedCards.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteSowStandardComponent = async (req, res) => {
  const client = await pgPool.connect();
  let uploadPaths = [];
  try {
    const { component_id } = req.params;
    await ensureSowOperationCardTable();
    await client.query('BEGIN');

    const component = await client.query(
      `SELECT component_id, part_name, part_number, model
       FROM public.components
       WHERE component_id = $1
       FOR UPDATE`,
      [component_id]
    );
    if (component.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Component tidak ditemukan' });
    }

    const attachments = await client.query(
      `SELECT a.file_path
       FROM public.sow_standard_attachments a
       JOIN public.sow_standard ss ON ss.id = a.standard_id
       WHERE ss.component_id = $1`,
      [component_id]
    );
    const operationCards = await client.query(
      `SELECT oc.image_path, oc.images
       FROM public.sow_operationcard oc
       JOIN public.sow_standard ss ON ss.id = oc.sow_standard_id
       WHERE ss.component_id = $1`,
      [component_id]
    );
    uploadPaths = collectUploadPaths(
      attachments.rows,
      operationCards.rows.flatMap((row) => [row.image_path, row.images])
    );

    const deletedTemplateLines = await client.query(
      `DELETE FROM public.sow_template_lines tl
       WHERE tl.template_id IN (
         SELECT template_id FROM public.sow_templates WHERE component_id = $1
       )
          OR tl.standard_id IN (
         SELECT id FROM public.sow_standard WHERE component_id = $1
       )`,
      [component_id]
    );
    const deletedTemplates = await client.query(
      `DELETE FROM public.sow_templates WHERE component_id = $1`,
      [component_id]
    );
    const deletedOperationCards = await client.query(
      `DELETE FROM public.sow_operationcard
       WHERE sow_standard_id IN (
         SELECT id FROM public.sow_standard WHERE component_id = $1
       )`,
      [component_id]
    );
    const detachedReceiving = await client.query(
      `UPDATE public.receiving_components
       SET component_id = NULL
       WHERE component_id = $1`,
      [component_id]
    );
    const deletedStandards = await client.query(
      `DELETE FROM public.sow_standard WHERE component_id = $1`,
      [component_id]
    );
    const deletedComponent = await client.query(
      `DELETE FROM public.components WHERE component_id = $1 RETURNING component_id`,
      [component_id]
    );

    await client.query('COMMIT');
    deleteStoredUploadFiles(uploadPaths);

    res.json({
      deleted: true,
      component_id: deletedComponent.rows[0].component_id,
      counts: {
        sow_template_lines: deletedTemplateLines.rowCount,
        sow_templates: deletedTemplates.rowCount,
        sow_operationcard: deletedOperationCards.rowCount,
        receiving_components_detached: detachedReceiving.rowCount,
        sow_standard: deletedStandards.rowCount,
        components: deletedComponent.rowCount,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'Component masih dipakai oleh data lain sehingga tidak bisa dihapus otomatis.',
        detail: err.detail,
      });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.uploadAttachments = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Tidak ada file yang di-upload' });
    }

    const inserted = [];
    for (const file of req.files) {
      const result = await db.query(
        `INSERT INTO sow_standard_attachments (standard_id, filename, original_name, file_path, file_size)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, file.filename, file.originalname, `/uploads/sow-pdf/${file.filename}`, file.size]
      );
      inserted.push(result.rows[0]);
    }
    res.status(201).json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAttachments = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM sow_standard_attachments WHERE standard_id=$1 ORDER BY uploaded_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAttachment = async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const result = await db.query('DELETE FROM sow_standard_attachments WHERE id=$1 RETURNING *', [
      attachmentId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];
    const fullPath = path.join(__dirname, '..', row.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getNnvaBase = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sow_nnva_base ORDER BY id');
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createNnvaBase = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await db.query('INSERT INTO sow_nnva_base (name) VALUES ($1) RETURNING *', [
      String(name).trim(),
    ]);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Name already exists' });
    res.status(500).json({ error: err.message });
  }
};

exports.updateNnvaBase = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await db.query('UPDATE sow_nnva_base SET name = $1 WHERE id = $2 RETURNING *', [
      String(name).trim(),
      id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Name already exists' });
    res.status(500).json({ error: err.message });
  }
};

exports.deleteNnvaBase = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM sow_nnva_base WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === '23503')
      return res.status(409).json({ error: 'NNVA is in use by operations' });
    res.status(500).json({ error: err.message });
  }
};

exports.getNnvaByStandard = async (req, res) => {
  try {
    const { standardId } = req.params;
    const result = await db.query(
      `SELECT ns.id, ns.sow_standard_id, ns.nnva_base_id, ns.standard_hours,
              nb.name AS nnva_name
       FROM sow_nnva_standard ns
       JOIN sow_nnva_base nb ON nb.id = ns.nnva_base_id
       WHERE ns.sow_standard_id = $1
       ORDER BY nb.id`,
      [standardId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveNnvaToStandard = async (req, res) => {
  const client = await db.connect();
  try {
    const { standardId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }

    await client.query('BEGIN');

    await client.query('DELETE FROM sow_nnva_standard WHERE sow_standard_id = $1', [standardId]);

    const inserted = [];
    for (const item of items) {
      const hours = parseFloat(item.standard_hours) || 0;
      const result = await client.query(
        `INSERT INTO sow_nnva_standard (sow_standard_id, nnva_base_id, standard_hours)
         VALUES ($1, $2, $3) RETURNING *`,
        [standardId, item.nnva_base_id, hours]
      );
      inserted.push(result.rows[0]);
    }

    await client.query(
      `UPDATE sow_standard
          SET std_hours = va_hours + COALESCE((
                SELECT SUM(COALESCE(standard_hours, 0))
                  FROM sow_nnva_standard WHERE sow_standard_id = $1), 0)
        WHERE id = $1 AND va_hours IS NOT NULL`,
      [standardId]
    );

    await client.query('COMMIT');

    const result = await db.query(
      `SELECT ns.id, ns.sow_standard_id, ns.nnva_base_id, ns.standard_hours,
              nb.name AS nnva_name
       FROM sow_nnva_standard ns
       JOIN sow_nnva_base nb ON nb.id = ns.nnva_base_id
       WHERE ns.sow_standard_id = $1
       ORDER BY nb.id`,
      [standardId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getAll = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sow');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const SUBTASK_STD_HEADERS = [
  'part_number',
  'operation_text',
  'operation_no',
  'title',
  'standard_hours',
  'sort_order',
];

const NORM = (col) => `upper(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;
const normText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

function stdCellText(cell) {
  if (!cell) return '';
  let v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join('');
    else if (v.result !== undefined) v = v.result;
    else if (v.text !== undefined) v = v.text;
    else if (v instanceof Date) v = v.toISOString();
    else v = String(v);
  }
  return String(v).trim();
}

exports.getSubtaskStandards = async (req, res) => {
  try {
    const values = [];
    const where = ['is_active = true'];
    const partNumber = String(req.query.part_number || '').trim();
    const operationText = String(req.query.operation_text || '').trim();
    const q = String(req.query.q || '').trim();
    if (partNumber) {
      values.push(partNumber);
      where.push(`${NORM('part_number')} = ${NORM(`$${values.length}`)}`);
    }
    if (operationText) {
      values.push(operationText);
      where.push(`${NORM('operation_text')} = ${NORM(`$${values.length}`)}`);
    }
    if (q) {
      values.push(`%${q.toLowerCase()}%`);
      where.push(`(lower(operation_text) like $${values.length} or lower(title) like $${values.length}
                   or lower(part_number) like $${values.length})`);
    }
    const result = await db.query(
      `SELECT id, part_number, operation_text, operation_no, title, sort_order, standard_hours,
              created_by, created_at, updated_by, updated_at
         FROM public.sow_sub_operation_standard
        WHERE ${where.join(' AND ')}
        ORDER BY part_number, operation_no NULLS LAST, operation_text, sort_order, id`,
      values
    );
    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSubtaskStandardParts = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT std.part_number,
              count(*)::int                                   AS sub_tasks,
              count(DISTINCT ${NORM('std.operation_text')})::int AS operations,
              max(std.updated_at)                             AS updated_at,
              (SELECT min(s.part_name) FROM sow s
                WHERE ${NORM('s.part_number')} = ${NORM('std.part_number')}) AS part_name
         FROM public.sow_sub_operation_standard std
        WHERE std.is_active = true
        GROUP BY std.part_number
        ORDER BY std.part_number`
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteSubtaskStandard = async (req, res) => {
  try {
    const actor = req.headers['x-user-name'] || req.headers['x-user-id'] || null;
    const result = await db.query(
      `UPDATE public.sow_sub_operation_standard
          SET is_active = false, updated_by = $2, updated_at = now()
        WHERE id = $1 AND is_active = true
        RETURNING id`,
      [req.params.id, actor]
    );
    if (!result.rowCount)
      return res.status(404).json({ error: 'Standard sub-task tidak ditemukan' });
    res.json({ deleted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.importSubtaskStandards = async (req, res) => {
  let client;
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'File Excel wajib diunggah (field "file")' });
    }
    const actor = req.headers['x-user-name'] || req.headers['x-user-id'] || req.body?.actor || null;
    const commit =
      req.body?.commit === true || req.body?.commit === 'true' || req.body?.commit === '1';

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('sub_task_standard') || wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'Worksheet tidak ditemukan dalam file' });

    const colMap = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = stdCellText(cell).toLowerCase().replace(/\s+/g, '_');
      if (SUBTASK_STD_HEADERS.includes(key) && colMap[key] === undefined) colMap[key] = colNumber;
    });
    const missing = ['part_number', 'operation_text', 'title'].filter(
      (k) => colMap[k] === undefined
    );
    if (missing.length) {
      return res
        .status(400)
        .json({ error: `Header kolom wajib tidak ditemukan: ${missing.join(', ')}` });
    }

    if (commit) {
      client = await pgPool.connect();
      await client.query('BEGIN');
    }
    const q = commit ? client : db;

    const preview = [];
    let created = 0;
    let updated = 0;
    let rejected = 0;

    const seenInFile = new Set();

    for (let r = 2; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      const get = (key) => (colMap[key] !== undefined ? stdCellText(row.getCell(colMap[key])) : '');
      const partNumber = get('part_number');
      const operationText = get('operation_text');
      const title = get('title');
      const hoursRaw = get('standard_hours');
      const sortRaw = get('sort_order');
      const opNoRaw = get('operation_no');

      if (!partNumber && !operationText && !title) continue;

      const push = (action, reason) => {
        preview.push({
          row: r,
          part_number: partNumber,
          operation_text: operationText,
          title,
          action,
          reason,
        });
      };
      const rejectRow = (reason) => {
        push('reject', reason);
        rejected += 1;
      };

      if (!partNumber) {
        rejectRow('part_number wajib diisi');
        continue;
      }
      if (!operationText) {
        rejectRow('operation_text wajib diisi');
        continue;
      }
      if (!title) {
        rejectRow('title wajib diisi');
        continue;
      }

      let hours = 1;
      if (hoursRaw !== '') {
        hours = Number(hoursRaw);
        if (!Number.isFinite(hours) || hours < 0) {
          rejectRow('standard_hours tidak boleh negatif');
          continue;
        }
      }
      let sortOrder = r - 2;
      if (sortRaw !== '') {
        sortOrder = parseInt(sortRaw, 10);
        if (!Number.isFinite(sortOrder)) {
          rejectRow('sort_order harus berupa angka');
          continue;
        }
      }
      let operationNo = null;
      if (opNoRaw !== '') {
        operationNo = parseInt(opNoRaw, 10);
        if (!Number.isFinite(operationNo)) {
          rejectRow('operation_no harus berupa angka');
          continue;
        }
      }

      const dupKey = [partNumber, operationText, title].map(normText).join('|');
      if (seenInFile.has(dupKey)) {
        rejectRow('duplikat di dalam file ini');
        continue;
      }
      seenInFile.add(dupKey);

      const known = await q.query(
        `SELECT 1 FROM sow
           WHERE ${NORM('part_number')} = ${NORM('$1')}
             AND ${NORM('operation_text')} = ${NORM('$2')}
           LIMIT 1`,
        [partNumber, operationText]
      );
      const warn = known.rowCount ? null : 'operation_text belum pernah muncul untuk part ini';

      const existing = await q.query(
        `SELECT id FROM public.sow_sub_operation_standard
          WHERE is_active = true
            AND ${NORM('part_number')} = ${NORM('$1')}
            AND ${NORM('operation_text')} = ${NORM('$2')}
            AND ${NORM('title')} = ${NORM('$3')}
          LIMIT 1`,
        [partNumber, operationText, title]
      );

      if (existing.rowCount) {
        if (commit) {
          await q.query(
            `UPDATE public.sow_sub_operation_standard
                SET operation_no = $2, standard_hours = $3, sort_order = $4, updated_by = $5, updated_at = now()
              WHERE id = $1`,
            [existing.rows[0].id, operationNo, hours, sortOrder, actor]
          );
        }
        push('update', warn);
        updated += 1;
      } else {
        if (commit) {
          await q.query(
            `INSERT INTO public.sow_sub_operation_standard
               (part_number, operation_text, operation_no, title, standard_hours, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [partNumber, operationText, operationNo, title, hours, sortOrder, actor]
          );
        }
        push('create', warn);
        created += 1;
      }
    }

    if (commit) await client.query('COMMIT');
    res.json({
      commit,
      summary: { created, updated, rejected, total: created + updated + rejected },
      preview,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};
