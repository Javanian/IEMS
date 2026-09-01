'use strict';
const { resolveTimezone } = require('../config/timezone');
const ewsTtsNotifier = require('./ewsTtsNotifier');

const EWS_DAY_START_HOUR = Number(process.env.EWS_DAY_START_HOUR || 7);

const ACC_MACHINE_MIN_MISSING = Number(process.env.EWS_ACC_MACHINE_MIN_MISSING || 5);

const ACC_MACHINE_CRITICAL_PCT = Number(process.env.EWS_ACC_MACHINE_CRITICAL_PCT || 50);

const ACC_LABOUR_MIN_BAD = Number(process.env.EWS_ACC_LABOUR_MIN_BAD || 3);

const ACC_LABOUR_CRITICAL_PCT = Number(process.env.EWS_ACC_LABOUR_CRITICAL_PCT || 30);

function ph3OrderTable() {
  const raw = String(process.env.TGT_TABLE || 'ph3_order').trim();
  return /^[a-z_][a-z0-9_]*$/i.test(raw) ? raw : 'ph3_order';
}

const TIMEZONE = resolveTimezone();

const ADOPTION_MACHINE_MIN_GAP_MIN = Number(process.env.EWS_ADOPTION_MACHINE_MIN_GAP_MIN || 15);

const ADOPTION_MACHINE_CRITICAL_COVER_PCT = Number(
  process.env.EWS_ADOPTION_MACHINE_CRITICAL_COVER_PCT || 50
);

const ADOPTION_LABOUR_MIN_GAP_H = Number(process.env.EWS_ADOPTION_LABOUR_MIN_GAP_H || 1);

const ADOPTION_LABOUR_CRITICAL_PCT = Number(process.env.EWS_ADOPTION_LABOUR_CRITICAL_PCT || 50);

const EXCUSED_STATUSES = new Set(['LEAVE', 'SICK', 'PERMIT', 'OFF']);

const OEE_MACHINE_MIN_HOURS = Number(process.env.EWS_OEE_MACHINE_MIN_HOURS || 2);
const OEE_MACHINE_CRITICAL_PCT = Number(process.env.EWS_OEE_MACHINE_CRITICAL_PCT || 65);

const OLE_OPERATOR_MIN_HOURS = Number(process.env.EWS_OLE_OPERATOR_MIN_HOURS || 2);
const OLE_OPERATOR_CRITICAL_PCT = Number(process.env.EWS_OLE_OPERATOR_CRITICAL_PCT || 70);

const UPTIME_HMI_DOWN_STREAK = Number(process.env.EWS_UPTIME_HMI_DOWN_STREAK || 3);

async function readSnapshotDetail(exec, bounds, kpiKey) {
  const snap = await exec.query(
    `
    SELECT detail_json
    FROM ews.kpi_snapshot
    WHERE scope_type = 'system' AND scope_key = 'ALL'
      AND (window_start AT TIME ZONE $2)::date = $1::date
    ORDER BY calculated_at DESC
    LIMIT 1
    `,
    [bounds.business_date, TIMEZONE]
  );
  const detailJson = snap.rows[0]?.detail_json;
  const kpis = Array.isArray(detailJson?.kpis) ? detailJson.kpis : [];
  return kpis.find((k) => k && k.key === kpiKey)?.detail || null;
}

async function getBizBounds(exec) {
  const r = await exec.query(
    `
    WITH biz AS (
      SELECT date_trunc('day', now() - make_interval(hours => $1::int)) AS day_start
    )
    SELECT day_start AS window_start,
           LEAST(now(), day_start + interval '1 day') AS window_end,
           -- text, not date: keeps the issue_key stable ('2026-07-09') regardless of whether the
           -- caller's pg driver parses OID 1082 to a string or a JS Date (which would stringify
           -- with a full timezone-tagged toString and break dedup between callers).
           day_start::date::text AS business_date
    FROM biz
    `,
    [EWS_DAY_START_HOUR]
  );
  return r.rows[0];
}

const UPSERT_SQL = `
INSERT INTO ews.issue_log
  (issue_key, category, business_date, scope_type, entity_id, entity_name,
   severity, title, description, metric_value, detail, status, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'open', now())
ON CONFLICT (issue_key) DO UPDATE SET
  entity_name  = EXCLUDED.entity_name,
  severity     = EXCLUDED.severity,
  title        = EXCLUDED.title,
  description  = EXCLUDED.description,
  metric_value = EXCLUDED.metric_value,
  detail       = EXCLUDED.detail,
  updated_at   = now()
WHERE ews.issue_log.status = 'open'
RETURNING *, (xmax = 0) AS was_inserted
`;

async function upsertIssue(exec, values) {
  const result = await exec.query(UPSERT_SQL, values);
  const row = result.rows && result.rows[0];
  if (row && row.was_inserted) {
    try {
      await ewsTtsNotifier.enqueueIssueTts(exec, {
        issue_key: row.issue_key,
        kpi_type: row.category,

        severity: String(row.severity || '').toLowerCase() === 'critical' ? 'Critical' : 'Watch',
        issue_description: row.description,
        pic: null,
      });
    } catch (ttsErr) {
      console.error('EWS TTS enqueue error:', ttsErr.message);
    }
  }
  return row;
}

async function autoResolveStale(exec, bounds) {
  const result = await exec.query(
    `
    UPDATE ews.issue_log
    SET status          = 'resolved',
        resolved_at     = COALESCE(resolved_at, now()),
        updated_at      = now(),
        -- resolution_note is NOT NULL for resolved rows (CHECK issue_log_resolution_note_required).
        -- The system must state its reason too, or this UPDATE violates the constraint.
        resolution_note = COALESCE(NULLIF(BTRIM(resolution_note), ''),
                                   'Auto-resolved: business day rolled over.'),
        resolved_by     = COALESCE(NULLIF(BTRIM(resolved_by), ''), 'system'),
        detail          = COALESCE(detail, '{}'::jsonb)
                          || jsonb_build_object('auto_resolved', true,
                                                'auto_resolved_reason', 'business day rolled over')
    WHERE status = 'open'
      AND business_date < $1::date
    `,
    [bounds.business_date]
  );
  return result.rowCount || 0;
}

async function generateAccuracyMachine(exec, bounds) {
  const { rows } = await exec.query(
    `
    SELECT
      machineno,
      MAX(machineid)   AS machineid,
      MAX(machinename) AS machinename,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE NOT status_record)::int AS bad
    FROM public.mch_transaction
    WHERE startdatetime >= $1 AND startdatetime < $2
    GROUP BY machineno
    HAVING COUNT(*) FILTER (WHERE NOT status_record) >= $3
    ORDER BY bad DESC
    `,
    [bounds.window_start, bounds.window_end, ACC_MACHINE_MIN_MISSING]
  );

  const bizDate = bounds.business_date;
  let count = 0;
  for (const r of rows) {
    const total = Number(r.total) || 0;
    const bad = Number(r.bad) || 0;
    const badPct = total ? Math.round((bad * 1000) / total) / 10 : 0;
    const severity = badPct >= ACC_MACHINE_CRITICAL_PCT ? 'critical' : 'warning';
    const name = r.machinename || r.machineid || `Machine ${r.machineno}`;
    await upsertIssue(exec, [
      `accuracy_machine:${bizDate}:machine:${r.machineno}`,
      'accuracy_machine',
      bizDate,
      'machine',
      String(r.machineno),
      name,
      severity,
      `Data mesin tidak lengkap: ${name}`,
      `${bad} dari ${total} record belum lengkap (order/operasi/operator/confirmation) — ${badPct}%. Lengkapi input & pastikan jobid benar.`,
      badPct,
      JSON.stringify({
        machineno: r.machineno,
        machineid: r.machineid,
        total,
        bad,
        bad_pct: badPct,
      }),
    ]);
    count += 1;
  }
  return count;
}

async function generateAccuracyLabour(exec, bounds) {
  const ph3 = ph3OrderTable();
  const { rows } = await exec.query(
    `
    WITH base AS (
      SELECT
        NULLIF(BTRIM(t.serialnumber), '') AS operator_key,
        NULLIF(BTRIM(t.full_name), '')    AS operator_name,
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
    ),
    flags AS (
      SELECT
        operator_key, operator_name, is_productive,
        (is_productive AND (
           order_empty OR operation_null OR wc_empty OR sn_empty
           OR (NOT order_empty AND NOT operation_null AND NOT has_ph3)
        )) AS is_bad
      FROM base
    )
    SELECT
      COALESCE(operator_key, 'UNKNOWN') AS operator_key,
      MAX(operator_name) AS operator_name,
      COUNT(*) FILTER (WHERE is_productive)::int AS total,
      COUNT(*) FILTER (WHERE is_bad)::int        AS bad
    FROM flags
    GROUP BY COALESCE(operator_key, 'UNKNOWN')
    HAVING COUNT(*) FILTER (WHERE is_bad) >= $3
    ORDER BY bad DESC
    `,
    [bounds.window_start, bounds.window_end, ACC_LABOUR_MIN_BAD]
  );

  const bizDate = bounds.business_date;
  let count = 0;
  for (const r of rows) {
    const total = Number(r.total) || 0;
    const bad = Number(r.bad) || 0;
    const badPct = total ? Math.round((bad * 1000) / total) / 10 : 0;
    const severity = badPct >= ACC_LABOUR_CRITICAL_PCT ? 'critical' : 'warning';
    const name = r.operator_name || r.operator_key || 'Operator';
    await upsertIssue(exec, [
      `accuracy_labour:${bizDate}:operator:${r.operator_key}`,
      'accuracy_labour',
      bizDate,
      'operator',
      String(r.operator_key),
      name,
      severity,
      `Input timesheet tidak valid: ${name}`,
      `${bad} dari ${total} record produktif tidak valid (order/operasi tidak cocok master SAP, atau workcenter/operator kosong) — ${badPct}%. Perbaiki input & pastikan order/operasi benar.`,
      badPct,
      JSON.stringify({ operator_key: r.operator_key, total, bad, bad_pct: badPct }),
    ]);
    count += 1;
  }
  return count;
}

async function generateAdoptionMachine(exec, bounds) {
  const snap = await exec.query(
    `
    SELECT detail_json
    FROM ews.kpi_snapshot
    WHERE scope_type = 'system' AND scope_key = 'ALL'
      AND (window_start AT TIME ZONE $2)::date = $1::date
    ORDER BY calculated_at DESC
    LIMIT 1
    `,
    [bounds.business_date, TIMEZONE]
  );
  const detailJson = snap.rows[0]?.detail_json;
  const kpis = Array.isArray(detailJson?.kpis) ? detailJson.kpis : [];
  const adoption = kpis.find((k) => k && k.key === 'adoption_machine');
  const machines = adoption?.detail?.per_machine;
  if (!Array.isArray(machines) || machines.length === 0) return 0;

  const bizDate = bounds.business_date;
  let count = 0;
  for (const m of machines) {
    const gapMin = Number(m.gap_minutes) || 0;
    if (gapMin < ADOPTION_MACHINE_MIN_GAP_MIN) continue;
    const key = String(m.machine_key || 'UNKNOWN');
    const name = m.machine_name || key;
    const coverPct = m.cover_pct == null ? null : Number(m.cover_pct);
    const unidentMin =
      m.unidentified_minutes != null
        ? Number(m.unidentified_minutes)
        : (Number(m.unidentified_buckets) || 0) * 5;
    const gapH = Math.round((gapMin / 60) * 10) / 10;
    const severity =
      coverPct !== null && coverPct <= ADOPTION_MACHINE_CRITICAL_COVER_PCT ? 'critical' : 'warning';
    const unidentNote =
      unidentMin >= 1 ? ` (termasuk ${Math.round(unidentMin)} menit operator unidentified)` : '';
    await upsertIssue(exec, [
      `adoption_machine:${bizDate}:machine:${key}`,
      'adoption_machine',
      bizDate,
      'machine',
      key,
      name,
      severity,
      `Gap adopsi mesin: ${name}`,
      `${gapH} jam mesin beroperasi tanpa operator teridentifikasi / idle panjang${unidentNote} — adoption ${coverPct == null ? '?' : coverPct}%. Pastikan operator login timesheet saat mesin berjalan.`,
      coverPct,
      JSON.stringify({
        machine_key: key,
        gap_minutes: gapMin,
        unidentified_minutes: unidentMin,
        cover_pct: coverPct,
      }),
    ]);
    count += 1;
  }
  return count;
}

async function generateAdoptionLabour(exec, bounds) {
  const snap = await exec.query(
    `
    SELECT detail_json
    FROM ews.kpi_snapshot
    WHERE scope_type = 'system' AND scope_key = 'ALL'
      AND (window_start AT TIME ZONE $2)::date = $1::date
    ORDER BY calculated_at DESC
    LIMIT 1
    `,
    [bounds.business_date, TIMEZONE]
  );
  const detailJson = snap.rows[0]?.detail_json;
  const kpis = Array.isArray(detailJson?.kpis) ? detailJson.kpis : [];
  const adoption = kpis.find((k) => k && k.key === 'adoption_labour');
  const breakdown = adoption?.detail?.breakdown;
  if (!Array.isArray(breakdown) || breakdown.length === 0) return 0;

  const bizDate = bounds.business_date;
  let count = 0;
  for (const b of breakdown) {
    if (!b) continue;
    const status = String(b.status || '').toUpperCase();
    if (EXCUSED_STATUSES.has(status)) continue;

    const recorded = Number(b.recorded_hours) || 0;
    const standard = Number(b.standard_hours) || 0;

    const hasExpected = b.expected_hours != null;
    const expected = hasExpected ? Number(b.expected_hours) : null;
    if (hasExpected && !(expected > 0)) continue;

    if (!hasExpected && b.completed !== true) continue;

    const target = hasExpected ? expected : standard;
    if (!(target > 0)) continue;

    const gap = Math.round(Math.max(target - recorded, 0) * 100) / 100;
    if (gap < ADOPTION_LABOUR_MIN_GAP_H) continue;

    const key = String(b.operator_key || 'UNKNOWN');
    const name = b.operator_name || key;
    const pct = Math.round((recorded / target) * 1000) / 10;
    const severity = pct <= ADOPTION_LABOUR_CRITICAL_PCT ? 'critical' : 'warning';
    const shiftCode = String(b.shift ?? '');
    const shiftLabel =
      shiftCode === '1' || shiftCode.toUpperCase() === 'DAY' ? 'shift 1' : 'shift 2';
    const finished = b.completed === true;
    const targetLabel = finished ? 'shift standard' : 'expected so far';

    await upsertIssue(exec, [
      `adoption_labour:${bizDate}:operator:${key}:s${shiftCode}`,
      'adoption_labour',
      bizDate,
      'operator',
      key,
      name,
      severity,
      `Jam kerja kurang: ${name}`,
      `${recorded} jam tercatat dari ${target} jam (${targetLabel}, ${shiftLabel}) — kurang ${gap} jam (${pct}%). Pastikan operator input timesheet selama shift.`,
      pct,
      JSON.stringify({
        operator_key: key,
        shift: b.shift,
        recorded_hours: recorded,
        expected_hours: expected,
        standard_hours: standard,
        target_hours: target,
        gap_hours: gap,
        shift_completed: finished,
      }),
    ]);
    count += 1;
  }
  return count;
}

async function generateOee(exec, bounds) {
  const detail = await readSnapshotDetail(exec, bounds, 'oee');
  const machines = detail?.per_machine;
  if (!Array.isArray(machines) || machines.length === 0) return 0;

  const bizDate = bounds.business_date;
  let count = 0;
  for (const m of machines) {
    const oee = m.oee_pct == null ? null : Number(m.oee_pct);
    const denom = Number(m.denominator_hours) || 0;
    if (oee === null || denom < OEE_MACHINE_MIN_HOURS || oee >= OEE_MACHINE_CRITICAL_PCT) continue;
    const key = String(m.machine_key || 'UNKNOWN');
    const running = Number(m.running_hours) || 0;
    const loss = Number(m.loss_hours) || 0;
    const downtime = Number(m.downtime_hours) || 0;
    const severity = 'critical';

    const downtimeNote = downtime >= 0.5 ? ` Terutama Downtime ${downtime} jam.` : '';
    await upsertIssue(exec, [
      `oee:${bizDate}:machine:${key}`,
      'oee',
      bizDate,
      'machine',
      key,
      key,
      severity,
      `OEE rendah: ${key}`,
      `OEE ${oee}% — running ${running} jam dari ${denom} jam terhitung, loss ${loss} jam.${downtimeNote} Cek downtime/idle/setup mesin.`,
      oee,
      JSON.stringify({
        machine_key: key,
        oee_pct: oee,
        running_hours: running,
        denominator_hours: denom,
        loss_hours: loss,
        downtime_hours: downtime,
      }),
    ]);
    count += 1;
  }
  return count;
}

async function generateOle(exec, bounds) {
  const detail = await readSnapshotDetail(exec, bounds, 'ole');
  const operators = detail?.per_operator;
  if (!Array.isArray(operators) || operators.length === 0) return 0;

  const bizDate = bounds.business_date;
  let count = 0;
  for (const o of operators) {
    const ole = o.ole_pct == null ? null : Number(o.ole_pct);
    const avail = Number(o.available_hours) || 0;
    if (ole === null || avail < OLE_OPERATOR_MIN_HOURS || ole >= OLE_OPERATOR_CRITICAL_PCT)
      continue;
    const key = String(o.operator_key || 'UNKNOWN');
    const name = o.operator_name || key;
    const working = Number(o.working_hours) || 0;
    const nva = Number(o.nva_hours) || 0;
    const severity = 'critical';
    await upsertIssue(exec, [
      `ole:${bizDate}:operator:${key}`,
      'ole',
      bizDate,
      'operator',
      key,
      name,
      severity,
      `OLE rendah: ${name}`,
      `OLE ${ole}% — produktif ${working} jam dari ${avail} jam tercatat, non-produktif ${nva} jam. Kurangi waktu non-produktif / pastikan input order benar.`,
      ole,
      JSON.stringify({
        operator_key: key,
        ole_pct: ole,
        working_hours: working,
        available_hours: avail,
        nva_hours: nva,
      }),
    ]);
    count += 1;
  }
  return count;
}

async function generateUptimeHmi(exec, bounds) {
  const detail = await readSnapshotDetail(exec, bounds, 'uptime_hmi');
  const devices = detail?.devices;
  if (!Array.isArray(devices) || devices.length === 0) return 0;

  const bizDate = bounds.business_date;
  let count = 0;
  for (const d of devices) {
    const streak = Number(d.down_streak) || 0;
    if (d.is_up || streak < UPTIME_HMI_DOWN_STREAK) continue;
    const key = String(d.ip || d.machineid || 'UNKNOWN');
    const name = `HMI ${key}`;
    const machineIds = Array.isArray(d.machineids) ? d.machineids : [];
    const machineCount = Number(d.machine_count) || machineIds.length;
    const listed = machineIds.slice(0, 5).join(', ');
    const machineNote = machineIds.length > 5 ? `${listed}, dll` : listed;
    await upsertIssue(exec, [
      `uptime_hmi:${bizDate}:device:${key}`,
      'uptime_hmi',
      bizDate,
      'device',
      key,
      name,
      'critical',
      `HMI offline: ${name}`,
      `Tidak menjawab ping ${streak} siklus beruntun — ${machineCount} mesin kehilangan HMI${machineNote ? ` (${machineNote})` : ''}. Cek power dan jalur jaringan HMI.`,
      0,
      JSON.stringify({
        ip: key,
        machineids: machineIds,
        machine_count: machineCount,
        down_streak: streak,
      }),
    ]);
    count += 1;
  }
  return count;
}

async function generateAll(exec) {
  const bounds = await getBizBounds(exec);
  const autoResolved = await autoResolveStale(exec, bounds);
  const counts = {
    accuracy_machine: await generateAccuracyMachine(exec, bounds),
    accuracy_labour: await generateAccuracyLabour(exec, bounds),
    adoption_machine: await generateAdoptionMachine(exec, bounds),
    adoption_labour: await generateAdoptionLabour(exec, bounds),
    oee: await generateOee(exec, bounds),
    ole: await generateOle(exec, bounds),
    uptime_hmi: await generateUptimeHmi(exec, bounds),
  };
  return { business_date: bounds.business_date, auto_resolved: autoResolved, counts };
}

module.exports = {
  generateAll,
  autoResolveStale,
  generateAccuracyMachine,
  generateAccuracyLabour,
  generateAdoptionMachine,
  generateAdoptionLabour,
  generateOee,
  generateOle,
  generateUptimeHmi,
  getBizBounds,
};
