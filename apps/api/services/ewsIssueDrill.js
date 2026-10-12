'use strict';

const { resolveTimezone } = require('../config/timezone');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const TIMEZONE = resolveTimezone();
const EWS_DAY_START_HOUR = Number(process.env.EWS_DAY_START_HOUR || 7);

function ph3OrderTable() {
  const raw = String(process.env.TGT_TABLE || 'ph3_order').trim();
  return /^[a-z_][a-z0-9_]*$/i.test(raw) ? raw : 'ph3_order';
}

async function boundsForBusinessDate(exec, businessDate) {
  const r = await exec.query(
    `SELECT ($1::date)::timestamptz AS window_start,
            LEAST(now(), (($1::date) + 1)::timestamptz) AS window_end`,
    [businessDate]
  );
  return r.rows[0];
}

async function buildAccuracyLabourRecords(exec, issue, bounds, limit, offset) {
  const ph3 = ph3OrderTable();
  const { rows } = await exec.query(
    `
    WITH base AS (
      SELECT
        t.tsnumber,
        t.longdate_checkin,
        t.order_no,
        t.operation_no,
        t.workcentercode,
        t.operation_text,
        COALESCE(NULLIF(BTRIM(t.serialnumber), ''), 'UNKNOWN') AS operator_key,
        (NULLIF(BTRIM(COALESCE(t.activitytype, '')), '') IS NULL) AS is_productive,
        (NULLIF(BTRIM(t.order_no), '') IS NULL)        AS order_empty,
        (t.operation_no IS NULL)                       AS operation_null,
        (NULLIF(BTRIM(t.workcentercode), '') IS NULL)  AS wc_empty,
        (NULLIF(BTRIM(t.serialnumber), '') IS NULL)    AS sn_empty,
        EXISTS (
          SELECT 1 FROM public.${ph3} po
          WHERE LTRIM(COALESCE(po.order_no, ''), '0') = LTRIM(COALESCE(t.order_no, ''), '0')
            AND LTRIM(COALESCE(po.operation_no, ''), '0') = t.operation_no::text
        ) AS has_ph3
      FROM public.timesheet_transaction t
      WHERE t.longdate_checkin >= $1 AND t.longdate_checkin < $2
        AND COALESCE(t.state_flag, 0) <> 5
    )
    SELECT
      tsnumber,
      longdate_checkin::text AS checkin,
      order_no,
      operation_no,
      workcentercode,
      operation_text,
      CASE
        WHEN order_empty     THEN 'MISSING_ORDER'
        WHEN operation_null  THEN 'MISSING_OPERATION'
        WHEN wc_empty        THEN 'MISSING_WORKCENTER'
        WHEN sn_empty        THEN 'MISSING_SN'
        ELSE 'SOW_NO_MATCH'
      END AS error_code,
      CASE
        WHEN order_empty     THEN 'Nomor order kosong — tidak bisa diposting ke SAP'
        WHEN operation_null  THEN 'Nomor operasi kosong'
        WHEN wc_empty        THEN 'Workcenter kosong'
        WHEN sn_empty        THEN 'Identitas operator (SN) kosong'
        ELSE 'Order+operasi tidak ditemukan di master SAP — cek nomor order & operasi'
      END AS reason,
      COUNT(*) OVER ()::int AS total
    FROM base
    WHERE operator_key = $3
      AND is_productive
      AND (order_empty OR operation_null OR wc_empty OR sn_empty
           OR (NOT order_empty AND NOT operation_null AND NOT has_ph3))
    ORDER BY longdate_checkin
    LIMIT $4 OFFSET $5
    `,
    [bounds.window_start, bounds.window_end, issue.entity_id, limit, offset]
  );

  const total = rows.length ? rows[0].total : 0;
  for (const r of rows) delete r.total;
  return {
    columns: [
      { key: 'tsnumber', label: 'No. TS' },
      { key: 'checkin', label: 'Check-in' },
      { key: 'order_no', label: 'Order' },
      { key: 'operation_no', label: 'Operasi' },
      { key: 'workcentercode', label: 'Workcenter' },
      { key: 'operation_text', label: 'Deskripsi' },
      { key: 'reason', label: 'Kenapa gagal' },
    ],
    rows,
    total,
  };
}

async function buildAccuracyMachineRecords(exec, issue, bounds, limit, offset) {
  const { rows } = await exec.query(
    `
    SELECT
      proddataid,
      startdatetime::text AS start_at,
      status_description,
      order_no,
      operation_no,
      COALESCE(NULLIF(BTRIM(full_name), ''), NULLIF(BTRIM(sn_employee), '')) AS operator,
      confirmation_number,
      'INCOMPLETE_RECORD' AS error_code,
      array_to_string(ARRAY_REMOVE(ARRAY[
        CASE WHEN NULLIF(BTRIM(order_no), '') IS NULL THEN 'order kosong' END,
        CASE WHEN NULLIF(BTRIM(operation_no), '') IS NULL THEN 'operasi kosong' END,
        CASE WHEN NULLIF(BTRIM(sn_employee), '') IS NULL THEN 'operator (SN) kosong' END,
        CASE WHEN NULLIF(BTRIM(confirmation_number), '') IS NULL THEN 'confirmation kosong' END
      ], NULL), ' · ') AS reason,
      COUNT(*) OVER ()::int AS total
    FROM public.mch_transaction
    WHERE startdatetime >= $1 AND startdatetime < $2
      AND machineno::text = $3
      AND NOT status_record
    ORDER BY startdatetime
    LIMIT $4 OFFSET $5
    `,
    [bounds.window_start, bounds.window_end, issue.entity_id, limit, offset]
  );

  const total = rows.length ? rows[0].total : 0;
  for (const r of rows) delete r.total;
  return {
    columns: [
      { key: 'proddataid', label: 'Prod Data ID' },
      { key: 'start_at', label: 'Mulai' },
      { key: 'status_description', label: 'Status' },
      { key: 'order_no', label: 'Order' },
      { key: 'operation_no', label: 'Operasi' },
      { key: 'operator', label: 'Operator' },
      { key: 'confirmation_number', label: 'Confirmation' },
      { key: 'reason', label: 'Yang kosong' },
    ],
    rows,
    total,
  };
}

async function buildAdoptionLabourRecords(exec, issue, _bounds, limit, offset) {
  const { rows } = await exec.query(
    `
    WITH params AS (
      SELECT $1::date AS target_bd
    ),
    ts_rows AS (
      SELECT
        t.tsnumber,
        (t.longdate_checkin  AT TIME ZONE $2) AS a,
        (COALESCE(t.longdate_checkout, now()) AT TIME ZONE $2) AS b,
        (t.longdate_checkout IS NULL) AS is_open,
        t.order_no, t.operation_no, t.operation_text, t.activitytype,
        (CASE
           WHEN t.longdate_checkout IS NULL
             THEN LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - t.longdate_checkin)) / 3600.0, 0), 12)
           ELSE COALESCE(t.duration, 0)
         END)::numeric AS dur
      FROM public.timesheet_transaction t, params p
      WHERE t.longdate_checkin >= (p.target_bd::timestamp AT TIME ZONE $2)
        AND t.longdate_checkin <  ((p.target_bd + 2)::timestamp AT TIME ZONE $2)
        AND COALESCE(t.state_flag, 0) <> 5
        AND (COALESCE(t.duration, 0) > 0 OR t.longdate_checkout IS NULL)
        AND NULLIF(BTRIM(t.serialnumber), '') = $3
    ),
    ts_biz AS (
      SELECT r.* FROM ts_rows r, params p
      WHERE (CASE WHEN r.a::time < TIME '07:00' THEN (r.a::date - 1) ELSE r.a::date END) = p.target_bd
    ),
    -- interval merge utk overlap kredit mesin (persis ts_ord/ts_grp/ts_merged kalkulator)
    ts_ord AS (
      SELECT a, b, MAX(b) OVER (ORDER BY a ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
      FROM ts_biz WHERE b > a
    ),
    ts_grp AS (
      SELECT *, SUM(CASE WHEN prev_max IS NULL OR a > prev_max THEN 1 ELSE 0 END)
                  OVER (ORDER BY a ROWS UNBOUNDED PRECEDING) AS grp
      FROM ts_ord
    ),
    ts_merged AS (SELECT MIN(a) AS a, MAX(b) AS b FROM ts_grp GROUP BY grp),
    mch AS (
      SELECT
        ROW_NUMBER() OVER () AS rid,
        m.proddataid, m.machinename, m.status_description, m.order_no, m.operation_no,
        (m.startdatetime) AS a, (m.enddatetime) AS b
      FROM public.mch_transaction m, params p
      -- pre-filter sargable (superset dari CASE di bawah — CASE hanya bisa = target_bd
      -- bila startdatetime di [bd 00:00, bd+2 00:00)) supaya index startdatetime terpakai
      WHERE m.startdatetime >= p.target_bd::timestamp
        AND m.startdatetime <  (p.target_bd + 2)::timestamp
        AND (CASE WHEN m.startdatetime::time < make_time($6::int, 0, 0)
                  THEN (m.startdatetime::date - 1) ELSE m.startdatetime::date END) = p.target_bd
        AND m.enddatetime > m.startdatetime
        AND COALESCE(m.statusid, 0) NOT IN (0, 4, 5)
        AND LOWER(BTRIM(COALESCE(m.status_description, ''))) NOT IN ('no job', 'off')
        AND NULLIF(BTRIM(m.sn_employee), '') = $3
    ),
    mch_credit AS (
      SELECT
        n.rid, n.proddataid, n.machinename, n.status_description, n.order_no, n.operation_no,
        n.a, n.b,
        GREATEST(
          EXTRACT(EPOCH FROM (n.b - n.a))
          - COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(n.b, t.b) - GREATEST(n.a, t.a))))
                       FILTER (WHERE t.a IS NOT NULL), 0),
          0
        ) / 3600.0 AS credit_hours
      FROM mch n
      LEFT JOIN ts_merged t ON t.a < n.b AND t.b > n.a
      GROUP BY n.rid, n.proddataid, n.machinename, n.status_description,
               n.order_no, n.operation_no, n.a, n.b
    ),
    unioned AS (
      SELECT
        'TIMESHEET'::text AS sumber,
        r.tsnumber::text  AS ref,
        r.a AS t_start,
        to_char(r.a, 'DD Mon HH24:MI') AS mulai,
        CASE WHEN r.is_open THEN '— (berjalan)' ELSE to_char(r.b, 'DD Mon HH24:MI') END AS selesai,
        ROUND(r.dur, 2)::float8 AS jam,
        r.order_no,
        COALESCE(NULLIF(BTRIM(r.activitytype), ''), r.operation_text) AS keterangan
      FROM ts_biz r
      UNION ALL
      SELECT
        'MESIN'::text,
        m.proddataid::text,
        m.a,
        to_char(m.a, 'DD Mon HH24:MI'),
        to_char(m.b, 'DD Mon HH24:MI'),
        ROUND(m.credit_hours::numeric, 2)::float8,
        m.order_no,
        COALESCE(m.machinename, '') || ' · ' || COALESCE(m.status_description, '')
      FROM mch_credit m
    )
    SELECT sumber, ref, mulai, selesai, jam, order_no, keterangan,
           COUNT(*) OVER ()::int AS total
    FROM unioned
    ORDER BY t_start
    LIMIT $4 OFFSET $5
    `,
    [issue.business_date, TIMEZONE, issue.entity_id, limit, offset, EWS_DAY_START_HOUR]
  );

  const total = rows.length ? rows[0].total : 0;
  for (const r of rows) delete r.total;
  const d = issue.detail || {};
  return {
    columns: [
      { key: 'sumber', label: 'Sumber' },
      { key: 'ref', label: 'Ref' },
      { key: 'mulai', label: 'Mulai' },
      { key: 'selesai', label: 'Selesai' },
      { key: 'jam', label: 'Jam' },
      { key: 'order_no', label: 'Order' },
      { key: 'keterangan', label: 'Keterangan' },
    ],
    rows,
    total,
    note:
      total === 0
        ? 'Operator tidak mencatat satu baris timesheet pun dan tidak ada jam mesin teratribusi pada tanggal ini — gap = seluruh target shift.'
        : `Tercatat ${d.recorded_hours ?? '?'} jam dari target ${d.target_hours ?? d.standard_hours ?? '?'} jam (gap ${d.gap_hours ?? '?'} jam). Tercatat = jam TIMESHEET + jam MESIN di luar interval timesheet — jumlah kolom "Jam" ≈ tercatat.`,
  };
}

async function buildAdoptionMachineRecords(exec, issue, bounds, limit, offset) {
  const { rows } = await exec.query(
    `
    SELECT
      pd.proddataid,
      to_char(pd.startdatetime, 'DD Mon HH24:MI') AS mulai,
      to_char(pd.enddatetime,  'DD Mon HH24:MI') AS selesai,
      ROUND((GREATEST(EXTRACT(EPOCH FROM (pd.enddatetime - pd.startdatetime)), 0) / 60.0)::numeric, 1)::float8 AS menit,
      pd.statusid,
      CASE
        WHEN pd.statusid = 5 THEN 'UNIDENTIFIED'
        ELSE 'IDLE_LONG'
      END AS error_code,
      CASE
        WHEN pd.statusid = 5 THEN 'Mesin jalan tanpa operator teridentifikasi — minta operator tap login di HMI'
        ELSE 'Idle panjang (>5 menit) tanpa aktivitas tercatat — cek kenapa mesin menganggur'
      END AS reason,
      COUNT(*) OVER ()::int AS total
    FROM public.mch_productiondata pd
    WHERE pd.startdatetime >= $1
      AND pd.startdatetime < $2
      AND pd.enddatetime IS NOT NULL
      AND pd.enddatetime > pd.startdatetime
      AND COALESCE(NULLIF(BTRIM(pd.machineno::text), ''), 'UNKNOWN') = $3
      AND (
        pd.statusid = 5
        OR (pd.statusid = 2
            AND GREATEST(EXTRACT(EPOCH FROM (pd.enddatetime - pd.startdatetime)), 0) > 300)
      )
    ORDER BY pd.startdatetime
    LIMIT $4 OFFSET $5
    `,
    [bounds.window_start, bounds.window_end, issue.entity_id, limit, offset]
  );

  const total = rows.length ? rows[0].total : 0;
  for (const r of rows) delete r.total;
  const d = issue.detail || {};
  return {
    columns: [
      { key: 'proddataid', label: 'Prod Data ID' },
      { key: 'mulai', label: 'Mulai' },
      { key: 'selesai', label: 'Selesai' },
      { key: 'menit', label: 'Menit' },
      { key: 'statusid', label: 'Status ID' },
      { key: 'reason', label: 'Kenapa dihitung gap' },
    ],
    rows,
    total,
    note: `Gap issue: ${d.gap_minutes ?? '?'} menit (${d.unidentified_minutes ?? 0} menit unidentified) — jumlah kolom "Menit" ≈ gap_minutes.`,
  };
}

async function buildOeeRecords(exec, issue, bounds, limit, offset) {
  const { rows } = await exec.query(
    `
    SELECT
      m.proddataid,
      to_char(m.startdatetime, 'DD Mon HH24:MI') AS mulai,
      to_char(m.enddatetime,  'DD Mon HH24:MI') AS selesai,
      ROUND(m.duration_hours::numeric, 2)::float8 AS jam,
      m.status_description AS status,
      COALESCE(NULLIF(BTRIM(m.status_activitytype), ''), '—') AS tipe,
      COALESCE(NULLIF(BTRIM(m.full_name), ''), NULLIF(BTRIM(m.sn_employee), ''), '—') AS operator,
      COUNT(*) OVER ()::int AS total
    FROM public.mch_transaction m
    WHERE m.startdatetime >= $1
      AND m.startdatetime < $2
      AND COALESCE(m.duration_hours, 0) > 0
      AND COALESCE(NULLIF(BTRIM(m.machineid), ''), NULLIF(BTRIM(m.workcentercode), ''), 'UNKNOWN') = $3
      -- denominator (persis calculateOee)…
      AND LOWER(BTRIM(COALESCE(m.status_description, ''))) NOT IN
        ('no job', 'off', 'preventive', 'breakdown', 'coffee break / lunch', 'daily pm')
      -- …tapi BUKAN running
      AND NOT (
        COALESCE(m.status_activitytype, '') IN ('M1', 'M2')
        OR LOWER(BTRIM(COALESCE(m.status_description, ''))) = 'productive'
      )
    ORDER BY m.duration_hours DESC, m.startdatetime
    LIMIT $4 OFFSET $5
    `,
    [bounds.window_start, bounds.window_end, issue.entity_id, limit, offset]
  );

  const total = rows.length ? rows[0].total : 0;
  for (const r of rows) delete r.total;
  const d = issue.detail || {};
  return {
    columns: [
      { key: 'proddataid', label: 'Prod Data ID' },
      { key: 'mulai', label: 'Mulai' },
      { key: 'selesai', label: 'Selesai' },
      { key: 'jam', label: 'Jam' },
      { key: 'status', label: 'Status' },
      { key: 'tipe', label: 'Tipe' },
      { key: 'operator', label: 'Operator' },
    ],
    rows,
    total,
    note: `Loss issue: ${d.loss_hours ?? '?'} jam (OEE ${d.oee_pct ?? issue.metric_value ?? '?'}%) — baris di bawah = waktu mesin non-produktif yang masuk hitungan (jumlah "Jam" ≈ loss_hours). Diurut dari yang terbesar.`,
  };
}

async function buildOleRecords(exec, issue, bounds, limit, offset) {
  const { rows } = await exec.query(
    `
    SELECT
      t.tsnumber,
      to_char(t.longdate_checkin AT TIME ZONE $6, 'DD Mon HH24:MI') AS checkin,
      ROUND(t.duration::numeric, 2)::float8 AS jam,
      COALESCE(NULLIF(BTRIM(t.activitytype), ''), '—') AS aktivitas,
      t.order_no,
      t.operation_text,
      CASE
        WHEN NULLIF(BTRIM(t.activitytype), '') IS NOT NULL THEN 'Aktivitas non-produktif (' || BTRIM(t.activitytype) || ')'
        ELSE 'Produktif tapi nomor order kosong — tidak dihitung working'
      END AS reason,
      COUNT(*) OVER ()::int AS total
    FROM public.timesheet_transaction t
    WHERE t.longdate_checkin >= $1
      AND t.longdate_checkin < $2
      AND COALESCE(t.state_flag, 1) <> 5
      AND NULLIF(BTRIM(t.serialnumber), '') = $3
      AND COALESCE(t.duration, 0) > 0
      -- BUKAN working (persis calculateOle: working = activitytype NULL & order terisi)
      AND NOT (
        t.activitytype IS NULL
        AND NULLIF(BTRIM(COALESCE(t.order_no, '')), '') IS NOT NULL
      )
    ORDER BY t.duration DESC, t.longdate_checkin
    LIMIT $4 OFFSET $5
    `,
    [bounds.window_start, bounds.window_end, issue.entity_id, limit, offset, TIMEZONE]
  );

  const total = rows.length ? rows[0].total : 0;
  for (const r of rows) delete r.total;
  const d = issue.detail || {};
  return {
    columns: [
      { key: 'tsnumber', label: 'No. TS' },
      { key: 'checkin', label: 'Check-in' },
      { key: 'jam', label: 'Jam' },
      { key: 'aktivitas', label: 'Aktivitas' },
      { key: 'order_no', label: 'Order' },
      { key: 'operation_text', label: 'Deskripsi' },
      { key: 'reason', label: 'Kenapa non-produktif' },
    ],
    rows,
    total,
    note: `NVA issue: ${d.nva_hours ?? '?'} jam (OLE ${d.ole_pct ?? issue.metric_value ?? '?'}%) — baris di bawah = waktu tercatat yang tidak dihitung working (jumlah "Jam" ≈ nva_hours). Diurut dari yang terbesar.`,
  };
}

const BUILDERS = {
  accuracy_labour: buildAccuracyLabourRecords,
  accuracy_machine: buildAccuracyMachineRecords,
  adoption_labour: buildAdoptionLabourRecords,
  adoption_machine: buildAdoptionMachineRecords,
  oee: buildOeeRecords,
  ole: buildOleRecords,
};

async function getIssueRecords(exec, issueKey, { limit, offset } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const found = await exec.query(
    `SELECT issue_key, category, business_date::text AS business_date, scope_type,
            entity_id, entity_name, severity, title, description, metric_value,
            detail, status, created_at, resolved_at
     FROM ews.issue_log WHERE issue_key = $1`,
    [issueKey]
  );
  if (!found.rows.length) return { notFound: true };
  const issue = found.rows[0];

  const summary = {
    issue_key: issue.issue_key,
    category: issue.category,
    business_date: issue.business_date,
    entity_id: issue.entity_id,
    entity_name: issue.entity_name,
    severity: issue.severity,
    status: issue.status,
    title: issue.title,
    description: issue.description,
    metric_value: issue.metric_value,
    detail: issue.detail,
  };

  const builder = BUILDERS[issue.category];
  if (!builder) {
    return {
      issue_summary: summary,
      implemented: false,
      note: `Drill-through untuk kategori '${issue.category}' belum tersedia.`,
      columns: [],
      rows: [],
      total: 0,
      truncated: false,
    };
  }

  const bounds = await boundsForBusinessDate(exec, issue.business_date);
  const { columns, rows, total, note } = await builder(exec, issue, bounds, lim, off);
  return {
    issue_summary: summary,
    implemented: true,
    window_start: bounds.window_start,
    window_end: bounds.window_end,
    columns,
    rows,
    total,
    truncated: off + rows.length < total,
    ...(note ? { note } : {}),
  };
}

module.exports = { getIssueRecords, boundsForBusinessDate, BUILDERS };
