import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Gauge as GaugeIcon,
  HardHat,
  Lightbulb,
  Minus,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STATUS_TOKENS, badgeStyle, statusKey } from '../theme/ewsStatus';
import { cosmeticizeKpi } from '../theme/ewsCosmetic';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const DETAIL_TABLE_PAGE_SIZE = 6;

const detailMemCache = new Map();
const DETAIL_MEM_TTL_MS = 45 * 1000;

const KPI_CONFIG = {
  uptime: {
    label: 'Uptime',
    title: 'System Uptime Detail',
    target: 99,
    icon: Wifi,
    pic: 'IT (Wira)',
    errorType: 'Machine Offline',
    action: 'Check the HMI network path and repeated DOWN pings.',
    unit: 'machine',
  },
  accuracy: {
    label: 'Accuracy',
    title: 'Data Accuracy Detail',
    target: 98,
    icon: ClipboardCheck,
    pic: 'Foreman/Spv',
    errorType: 'Invalid Timesheet Data',
    action: 'Fix the error records, check master/order, then re-post to SAP.',
    unit: 'record',
  },
  adoption: {
    label: 'Adoption',
    title: 'Timesheet Adoption Detail',
    target: 95,
    icon: UserCheck,
    pic: 'Foreman/Spv',
    errorType: 'Missing Time',
    action: 'Confirm the operator and complete the missing timesheet entries.',
    unit: 'bucket',
  },
  oee: {
    label: 'OEE',
    title: 'Machine OEE Detail',
    target: 80,
    icon: GaugeIcon,
    pic: 'PPIC / Spv',
    errorType: 'Machine Loss',
    action: 'Review downtime, setup (M2), and counted machine time.',
    unit: 'machine',
  },
  ole: {
    label: 'OLE',
    title: 'Labour OLE Detail',
    target: 85,
    icon: HardHat,
    pic: 'Supervisor',
    errorType: 'Labour Efficiency Loss',
    action: 'Check workflow, material readiness, and operator coaching.',
    unit: 'operator',
  },

  uptime_tablet: {
    label: 'Uptime Tablet',
    title: 'Uptime Tablet Detail',
    target: 99,
    icon: Wifi,
    pic: 'IT (Wira)',
    errorType: 'Tablet Offline',
    action: 'Check operator tablet connectivity.',
    unit: 'device',
  },
  uptime_hmi: {
    label: 'Uptime HMI',
    title: 'Uptime HMI Detail',
    target: 99,
    icon: Wifi,
    pic: 'IT (Wira)',
    errorType: 'HMI Offline',
    action: 'Check the HMI network path and repeated DOWN pings.',
    unit: 'device',
  },
  accuracy_labour: {
    label: 'Accuracy Labour',
    title: 'Accuracy Labour Detail',
    target: 98,
    icon: ClipboardCheck,
    pic: 'Foreman/Spv',
    errorType: 'Invalid Timesheet Data',
    action: 'Fix the timesheet order/operation, check SOW/SAP.',
    unit: 'record',
  },
  accuracy_machine: {
    label: 'Accuracy Machine',
    title: 'Accuracy Machine Detail',
    target: 98,
    icon: ClipboardCheck,
    pic: 'Foreman/Spv',
    errorType: 'Missing Machine Transaction',
    action: 'Check mch_productiondata rows without mch_transaction.',
    unit: 'record',
  },
  adoption_labour: {
    label: 'Adoption Labour',
    title: 'Adoption Labour Detail',
    target: 95,
    icon: UserCheck,
    pic: 'Foreman/Spv',
    errorType: 'Missing Attendance',
    action: 'Flag leave/sick/permit; confirm a genuine absence.',
    unit: 'operator',
  },
  adoption_machine: {
    label: 'Adoption Machine',
    title: 'Adoption Machine Detail',
    target: 95,
    icon: UserCheck,
    pic: 'PPIC / Spv',
    errorType: 'Missing Time',
    action: 'Check unidentified/idle machine time against operator input.',
    unit: 'machine',
  },
};

const STATUS_HEX = {
  normal: STATUS_TOKENS.normal.solid,
  watch: STATUS_TOKENS.watch.solid,
  critical: STATUS_TOKENS.critical.solid,
  no_data: STATUS_TOKENS.no_data.solid,
};

const SEV_HEX = {
  Critical: STATUS_TOKENS.critical.solid,
  Watch: STATUS_TOKENS.watch.solid,
  Normal: STATUS_TOKENS.normal.solid,
  Closed: STATUS_TOKENS.normal.solid,
  'No Data': STATUS_TOKENS.no_data.solid,
};

const UPTIME_TARGET_PCT = KPI_CONFIG.uptime.target;
const UPTIME_WATCH_MARGIN_PCT = 2;

function uptimeStatusKey(pct) {
  const value = Number(pct);
  if (!Number.isFinite(value)) return 'no_data';
  if (value >= UPTIME_TARGET_PCT) return 'normal';
  if (value >= UPTIME_TARGET_PCT - UPTIME_WATCH_MARGIN_PCT) return 'watch';
  return 'critical';
}

function uptimeColor(pct) {
  return STATUS_HEX[uptimeStatusKey(pct)];
}

const waterfallColors = {
  baseline: '#2563eb',
  negative: '#dc2626',
  positive: '#16a34a',
  final: '#16a34a',
};

const machineMixColors = {
  VA: '#16a34a',
  NNVA: '#f59e0b',
  NVA: '#ef4444',
  NoJob: '#94a3b8',
};

function unprodRedShade(index, total) {
  const t = total > 1 ? index / (total - 1) : 0;
  const lightness = Math.round(46 + t * 34);
  return `hsl(0, 74%, ${lightness}%)`;
}

const errorTypeLabels = {
  Missing: 'Missing (empty field)',
  Invalid: 'Invalid (wrong value)',
  Inconsistent: 'Inconsistent (duration mismatch)',
  Outlier: 'Outlier (abnormal runtime)',
  Duplicate: 'Duplicate (repeated record)',
};

const gapTypeLabels = {
  missing_timesheet: 'Missing Timesheet',
  unidentified: 'Unidentified Operator',
  covered: 'Covered',
};

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'critical' || status === 'error') return 'critical';
  if (status === 'watch' || status === 'warning' || status === 'stale') return 'watch';
  if (status === 'normal' || status === 'fresh' || status === 'live') return 'normal';
  return 'no_data';
}

function sevFromStatus(status) {
  const s = normalizeStatus(status);
  if (s === 'critical') return 'Critical';
  if (s === 'watch') return 'Watch';
  if (s === 'no_data') return 'No Data';
  return 'Normal';
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(parsed);
}

function formatFixed2(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed.toFixed(2);
}

function formatFixedPercent(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${parsed.toFixed(2)}%`;
}

function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : '--';
}

function formatHours(value, fallback = '-') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${parsed.toFixed(1)}h`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function currentUserId() {
  try {
    const user = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    return String(user?.username || user?.name || user?.id || 'unknown');
  } catch {
    return 'unknown';
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function sendJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function pageCount(items, pageSize = DETAIL_TABLE_PAGE_SIZE) {
  return Math.max(1, Math.ceil((items?.length || 0) / pageSize));
}

function pageSlice(items, page, pageSize = DETAIL_TABLE_PAGE_SIZE) {
  const start = Math.max(0, page - 1) * pageSize;
  return (items || []).slice(start, start + pageSize);
}

function buildDiagnosis(kpiType, kpi, kpisByKey) {
  const status = normalizeStatus(kpi?.status);
  const low = status === 'critical' || status === 'watch';
  const v = (k) => {
    const x = Number(kpisByKey?.[k]?.value);
    return Number.isFinite(x) ? x : null;
  };
  const oee = v('oee');
  const ole = v('ole');
  const adoption = v('adoption');
  const points = [];
  let headline;

  const isLow = (val, target) => val !== null && target !== null && val < target;

  if (kpiType === 'uptime') {
    headline = low ? 'Machine connectivity degraded' : 'Machine connectivity healthy';
    if (low)
      points.push(
        'Ping/heartbeat fails repeatedly. When uptime drops, machine KPIs (OEE and Adoption) can mislead because telemetry lags.'
      );
    points.push(
      'False-alert guard: only 6 or more consecutive failed samples (about 1 minute) count as real downtime — a single ping blip is ignored.'
    );
  } else if (kpiType === 'accuracy') {
    headline = low ? 'Data quality is low — needs correction' : 'Data is accurate and trustworthy';
    if (low)
      points.push(
        'The data cannot be trusted until the errors are fixed. Correct the error records before judging production KPIs.'
      );
    if (kpi?.detail?.minimum_sample_met === false)
      points.push('Fewer than 50 records — the alert is indicative only (false-alert guard).');
    if (low && isLow(adoption, 95))
      points.push(
        'Accuracy and Adoption are both low, which points to an input/discipline problem rather than production performance (Insight #6).'
      );
  } else if (kpiType === 'adoption') {
    headline = low ? 'Input coverage is low (trust down)' : 'Operator input adoption is healthy';
    points.push(
      'Adoption is a TRUST indicator. Low coverage understates OEE and OLE because machine activity is not represented in the timesheet.'
    );
    if (low && isLow(ole, 85))
      points.push(
        'Adoption and OLE are both low, so this is most likely an input issue rather than real inefficiency (Insight #6).'
      );
  } else if (kpiType === 'adoption_labour') {
    headline = low ? 'Operator hour logging is below target' : 'Operator hour logging is healthy';
    const sd = kpi?.source_detail || {};
    const n = (x) => Number(x) || 0;
    const started = n(sd.started);
    const present = n(sd.present);
    const absent = n(sd.absent);
    const notStarted = n(sd.not_started);
    const excused = n(sd.excused);
    const recorded = n(sd.total_recorded_hours);
    const expected = n(sd.total_expected_hours);
    const shortfall = Math.max(expected - recorded, 0);
    const pctText = (v) => (v === null || v === undefined ? '—' : `${formatNumber(v)}%`);

    if (started > 0) {
      points.push(
        `${present} of ${started} operators whose shift has started have logged time — ${absent} have logged nothing at all.`
      );
    }
    if (expected > 0) {
      points.push(
        `${formatNumber(recorded)}h recorded out of the ${formatNumber(expected)}h expected by now — ${formatNumber(shortfall)}h short.`
      );
    }
    points.push(
      `Per shift: Day ${pctText(sd.day_adoption_pct)} · Night ${pctText(sd.night_adoption_pct)}. The charts below rank operators by the largest shortfall.`
    );
    if (notStarted > 0)
      points.push(
        `${notStarted} scheduled operators have not started their shift yet and are not counted.`
      );
    if (excused > 0)
      points.push(
        `${excused} operators on leave/sick/permit/off are excluded from the denominator.`
      );
    points.push(
      'Absent operators (scheduled but zero logged time) drag this KPI down far more than operators who are only slightly short.'
    );
  } else if (kpiType === 'oee') {
    headline = low ? 'Machine utilisation is below target' : 'Machine utilisation is healthy';
    if (low && ole !== null && ole >= 85)
      points.push(
        'OEE is low while OLE is high, so the problem is the MACHINE (downtime/setup). Operators are already effective (Insight #4).'
      );
    if (low && isLow(ole, 85))
      points.push(
        'OEE and OLE are both low. Check Uptime and Adoption first — this may be a data problem, not a machine one.'
      );
    points.push(
      'NoJob and Off are excluded from the denominator; micro-stops under an hour are flagged separately so they are not read as major downtime.'
    );
  } else if (kpiType === 'ole') {
    headline = low ? 'Labour effectiveness is below target' : 'Labour effectiveness is healthy';
    if (low && oee !== null && oee >= 80)
      points.push(
        'OLE is low while OEE is high, so the machines are fine but LABOUR is not effective. Check workflow and material readiness (Insight #4).'
      );
    if (low && isLow(adoption, 95))
      points.push(
        'OLE and Adoption are both low. Check whether this is an input issue before blaming the operator (Insight #6).'
      );
    points.push(
      'Idle time is labour recorded without a productive order — the main gap dragging OLE down.'
    );
  } else {
    headline = kpi?.helper || 'KPI detail';
  }

  return { tone: status, headline, points };
}

function makeRow(row) {
  return {
    scope: 'system',
    entityId: null,
    pic: null,
    action: null,
    errorType: null,
    sortValue: 0,
    isIssue: false,
    severity: 'Normal',
    ...row,
  };
}

function buildUptimeRows(kpi, config) {
  const byMachine = kpi?.source_detail?.by_machine || [];
  return byMachine
    .filter((m) => numeric(m.failed_count) > 0 || numeric(m.max_consecutive_fail) > 0)
    .map((m) => {
      const consecutive = numeric(m.max_consecutive_fail);
      const failed = numeric(m.failed_count);
      const real = consecutive >= 6;
      return makeRow({
        entityId: m.machineid || m.machinename,
        area: m.machinename || m.machineid || 'UNKNOWN',
        metric: `${formatNumber(m.uptime_pct)}%`,
        metricLabel: 'uptime',
        detail: `${formatNumber(failed)} gagal · ${consecutive} berturut · loss ${formatNumber(m.downtime_minutes)} min · ${m.ipaddress || '-'}`,
        severity: real ? 'Critical' : 'Watch',
        errorType: real ? 'Machine Offline' : 'Ping Blip',
        action: real
          ? 'Check device power/network, restart the HMI, notify IT.'
          : 'Monitor — has not reached the real-downtime threshold.',
        pic: config.pic,
        sortValue: consecutive * 1000 + failed,
        isIssue: real,
      });
    })
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildAccuracyRows(kpi, config, kpiStatus) {
  const detail = kpi?.detail || {};
  const byType = kpi?.source_detail?.by_error_type || [];
  const minMet = detail.minimum_sample_met !== false;
  const rows = byType
    .filter((t) => numeric(t.error_records) > 0)
    .map((t) =>
      makeRow({
        scope: 'error_type',
        entityId: t.error_type,
        area: errorTypeLabels[t.error_type] || t.error_type,
        metric: `${formatNumber(t.error_records)}`,
        metricLabel: 'record',
        detail: 'Error categories from the timesheet and SAP staging in this window.',
        severity: kpiStatus === 'critical' ? 'Critical' : 'Watch',
        errorType: t.error_type,
        action:
          t.error_type === 'Missing'
            ? 'Fill the empty fields (order/operation/planhours) and re-validate.'
            : t.error_type === 'Invalid'
              ? 'Fix the invalid values, check QR/order/master data.'
              : t.error_type === 'Duplicate'
                ? 'Remove or merge duplicate records with identical timestamps.'
                : config.action,
        pic: config.pic,
        sortValue: numeric(t.error_records),

        isIssue: (kpiStatus === 'critical' || kpiStatus === 'watch') && minMet,
      })
    )
    .sort((a, b) => b.sortValue - a.sortValue);
  return rows;
}

function buildAdoptionRows(kpi, config, kpiStatus) {
  const byMachine = kpi?.source_detail?.by_machine || [];
  return byMachine
    .filter((m) => numeric(m.missing_minutes) > 0)
    .slice(0, 12)
    .map((m) =>
      makeRow({
        scope: 'machine',
        entityId: m.machine_key,
        area: m.machine_key || 'UNKNOWN',
        metric: `${formatNumber(m.missing_minutes)} min`,
        metricLabel: 'gap',
        detail: `${formatNumber(m.gap_buckets)} bucket 5-menit tanpa timesheet cocok.`,
        severity: kpiStatus === 'critical' ? 'Critical' : 'Watch',
        errorType: config.errorType,
        action: 'Confirm who ran the machine and complete the timesheet entry.',
        pic: config.pic,
        sortValue: numeric(m.missing_minutes),
        isIssue: kpiStatus === 'critical' || kpiStatus === 'watch',
      })
    )
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildOeeRows(kpi, config) {
  const byMachine = kpi?.source_detail?.by_machine || [];
  return byMachine
    .filter((m) => normalizeStatus(m.status) !== 'normal' && numeric(m.total_hours) > 0)
    .map((m) =>
      makeRow({
        scope: 'machine',
        entityId: m.machineid,
        area: m.machinename || m.machineid || 'UNKNOWN',
        metric: `${formatNumber(m.oee_time_pct)}%`,
        metricLabel: 'oee',
        detail: `Loss ${formatHours(m.loss_hours)} of ${formatHours(m.total_hours)} · ${formatNumber(m.stop_count)} stop events`,
        severity: sevFromStatus(m.status),
        errorType: 'Machine Loss',
        action: 'Check machine breakdown/setup, material readiness, and technical support.',
        pic: config.pic,
        sortValue: numeric(m.loss_hours),
        isIssue: normalizeStatus(m.status) === 'critical' || normalizeStatus(m.status) === 'watch',
      })
    )
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildOleRows(kpi, config) {
  const byOperator = kpi?.source_detail?.by_operator || [];
  return byOperator
    .filter((o) => normalizeStatus(o.status) !== 'normal' && numeric(o.total_hours) > 0)
    .map((o) =>
      makeRow({
        scope: 'operator',
        entityId: o.operator_id,
        area: o.operator_name || o.operator_id || 'UNKNOWN',
        metric: `${formatNumber(o.ole_time_pct)}%`,
        metricLabel: 'ole',
        detail: `Non-productive ${formatHours(o.nva_hours)} of ${formatHours(o.total_hours)} recorded`,
        severity: sevFromStatus(o.status),
        errorType: 'Labour Efficiency Loss',
        action: 'Check workflow, material readiness, and coordination; coach if needed.',
        pic: config.pic,
        sortValue: numeric(o.nva_hours),
        isIssue: normalizeStatus(o.status) === 'critical' || normalizeStatus(o.status) === 'watch',
      })
    )
    .sort((a, b) => b.sortValue - a.sortValue);
}

function buildActionRows(kpi, config) {
  if (!kpi || !config) return [];
  const kpiStatus = normalizeStatus(kpi.status);
  const key = kpi.key;
  if (key === 'uptime') return buildUptimeRows(kpi, config);
  if (key === 'accuracy') return buildAccuracyRows(kpi, config, kpiStatus);
  if (key === 'adoption') return buildAdoptionRows(kpi, config, kpiStatus);
  if (key === 'oee') return buildOeeRows(kpi, config);
  if (key === 'ole') return buildOleRows(kpi, config);
  return [];
}

function buildOeeWaterfallChartData(sourceDetail = {}) {
  const rows = Array.isArray(sourceDetail.waterfall) ? sourceDetail.waterfall : [];
  return rows.map((row) => {
    const delta = numeric(row.delta_hours, 0);
    const end = numeric(row.end_hours, 0);
    const start =
      row.start_hours !== undefined
        ? numeric(row.start_hours, 0)
        : delta < 0
          ? end + Math.abs(delta)
          : 0;
    const displayName =
      row.step_type === 'final' || row.label === 'VA' ? 'Running' : row.label || 'Step';
    return {
      name: displayName,
      startValue: Math.max(0, start),
      endValue: Math.max(0, end),
      value: Math.abs(delta),
      displayValue: delta,
      stepType: row.step_type || 'segment',
      fill:
        row.step_type === 'total'
          ? waterfallColors.baseline
          : row.step_type === 'final'
            ? waterfallColors.final
            : delta < 0
              ? waterfallColors.negative
              : waterfallColors.positive,
    };
  });
}

function buildOeeDistributionChartData(sourceDetail = {}) {
  const rows = Array.isArray(sourceDetail.distribution_by_machine)
    ? sourceDetail.distribution_by_machine
    : [];
  const compRows = Array.isArray(sourceDetail.mix_composition_by_machine)
    ? sourceDetail.mix_composition_by_machine
    : [];
  const compByMachine = new Map();
  for (const c of compRows) {
    if (!compByMachine.has(c.machineid))
      compByMachine.set(c.machineid, { NNVA: [], NVA: [], Missing: [] });
    const group = compByMachine.get(c.machineid);
    if (group[c.bucket]) group[c.bucket].push(c);
  }
  return rows.slice(0, 12).map((row) => {
    const va = numeric(row.va_hours, 0);
    const nnva = numeric(row.nnva_hours, 0);
    const nva = numeric(row.nva_hours, 0);
    const total = Math.max(va + nnva + nva, 0);
    const pct = (value) => (total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0);
    const name = row.machinename || row.machineid || 'UNKNOWN';
    return {
      name: String(name).length > 18 ? `${String(name).slice(0, 18)}...` : String(name),
      totalHours: total,
      vaHours: va,
      nnvaHours: nnva,
      nvaHours: nva,
      VA: pct(va),
      NNVA: pct(nnva),
      NVA: pct(nva),
      comp: compByMachine.get(row.machineid) || null,
    };
  });
}

function StatusBadge({ status }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold"
      style={badgeStyle(status)}
    >
      {status}
    </span>
  );
}

function SeverityDot({ severity }) {
  const label = severity || 'No Data';
  const token = STATUS_TOKENS[statusKey(label)] || STATUS_TOKENS.no_data;
  return (
    <span
      className="inline-flex items-center justify-center"
      title={label}
      aria-label={`Severity ${label}`}
    >
      <span
        className="h-3.5 w-3.5 rounded-full border"
        style={{
          backgroundColor: token.solid,
          borderColor: token.border,
          boxShadow: `0 0 0 4px ${token.bg}`,
        }}
      />
    </span>
  );
}

function PageCard({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function CardHead({ icon: Icon, title, tag, right }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon size={16} className="flex-shrink-0 text-[#0077b6]" /> : null}
        <h2 className="truncate text-sm font-extrabold text-slate-900">{title}</h2>
        {tag ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            {tag}
          </span>
        ) : null}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs font-bold text-slate-500">
      {text}
    </div>
  );
}

function EmptyChart({ text }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs font-bold text-slate-500">
      {text}
    </div>
  );
}

const TILE_TONES = {
  info: { bg: '#caf0f8', border: '#90e0ef', text: '#0077b6' },
  good: { bg: '#f0fdf4', border: '#bbf7d0', text: '#047857' },
  warn: { bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  bad: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
  neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
};

function MetricTile({ label, value, sub, tone = 'neutral' }) {
  const t = TILE_TONES[tone] || TILE_TONES.neutral;
  return (
    <div
      className="rounded-xl border px-3 py-2.5 shadow-sm"
      style={{ background: t.bg, borderColor: t.border }}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.text }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-black leading-none" style={{ color: t.text }}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-[10px] font-semibold text-slate-500">{sub}</div> : null}
    </div>
  );
}

function RankedList({
  items = [],
  valueOf,
  labelOf,
  subOf,
  colorOf,
  valueFmt,
  emptyText = 'No data.',
  initialCount,
}) {
  const [page, setPage] = useState(0);
  if (!items.length) return <EmptyState text={emptyText} />;
  const max = Math.max(...items.map((i) => Math.abs(numeric(valueOf(i)))), 1);
  const paged = initialCount != null && items.length > initialCount;
  const pageSize = paged ? initialCount : items.length;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const shown = items.slice(start, start + pageSize);
  return (
    <>
      {}
      <ul className="space-y-2.5" style={paged ? { minHeight: pageSize * 46 } : undefined}>
        {shown.map((item, idx) => {
          const raw = numeric(valueOf(item));
          const width = Math.max(3, (Math.abs(raw) / max) * 100);
          const color = colorOf ? colorOf(item) : '#0096c7';
          return (
            <li key={start + idx}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-slate-700">{labelOf(item)}</span>
                <span className="flex-shrink-0 font-mono text-xs font-extrabold text-slate-800">
                  {valueFmt ? valueFmt(item) : formatNumber(raw)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${width}%`, background: color }}
                />
              </div>
              {subOf ? (
                <div className="mt-1 text-[10px] font-semibold text-slate-500">{subOf(item)}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {paged && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold text-slate-400">
            {start + 1}–{start + shown.length} / {items.length}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage(safePage - 1)}
              className="inline-flex min-h-[30px] items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
              className="inline-flex min-h-[30px] items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-[#0077b6] transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Gauge({ value, target, status }) {
  const v = Number.isFinite(Number(value)) ? Number(value) : null;
  const fill = v === null ? 0 : Math.max(0, Math.min(100, v));
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const dash = (fill / 100) * circumference;
  const color = STATUS_HEX[normalizeStatus(status)] || '#94a3b8';
  const targetAngle =
    target !== null && target !== undefined ? Math.max(0, Math.min(100, target)) : null;
  return (
    <div className="relative flex h-[140px] w-[140px] items-center justify-center">
      <svg width={140} height={140} viewBox="0 0 140 140" className="-rotate-90">
        <circle cx={70} cy={70} r={r} fill="none" stroke="#e2e8f0" strokeWidth={12} />
        <circle
          cx={70}
          cy={70}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
        {targetAngle !== null && (
          <circle
            cx={70 + r * Math.cos((targetAngle / 100) * 2 * Math.PI)}
            cy={70 + r * Math.sin((targetAngle / 100) * 2 * Math.PI)}
            r={4}
            fill="#0f172a"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-slate-900">
          {v === null ? '--' : `${v.toFixed(1)}`}
        </span>
        <span className="text-[10px] font-bold text-slate-400">
          {v === null ? 'no data' : '% of window'}
        </span>
      </div>
    </div>
  );
}

function DeltaChip({ comparison }) {
  const delta = comparison?.delta;
  if (delta === null || delta === undefined) return null;
  const up = delta > 0;
  const flat = delta === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const cls = flat
    ? 'border-slate-200 bg-slate-50 text-slate-500'
    : up
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${cls}`}
      title="vs periode sebelumnya (hari yang sama)"
    >
      <Icon size={12} />
      {up ? '+' : ''}
      {Number(delta).toFixed(1)} pt
    </span>
  );
}

function TablePager({ page, totalPages, totalRows, onPageChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
      <span className="text-[11px] font-bold text-slate-500">
        Page {page} / {totalPages} · {totalRows} rows
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function OeeWaterfallSvg({ data, width = 760, height = 320 }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const safeWidth = Math.max(Number(width) || 760, 320);
  const safeHeight = Math.max(Number(height) || 320, 260);
  const compact = safeWidth < 560;
  const margin = {
    top: 30,
    right: compact ? 10 : 18,
    bottom: compact ? 68 : 58,
    left: compact ? 42 : 56,
  };
  const chartWidth = safeWidth - margin.left - margin.right;
  const chartHeight = safeHeight - margin.top - margin.bottom;
  const maxValue = Math.max(
    1,
    ...data.flatMap((row) => [numeric(row.startValue, 0), numeric(row.endValue, 0)])
  );
  const roundedMax = Math.ceil(maxValue / 5) * 5 || maxValue;
  const stepWidth = chartWidth / Math.max(data.length, 1);
  const barWidth = Math.max(20, Math.min(compact ? 42 : 70, stepWidth * 0.54));
  const yFor = (value) => margin.top + chartHeight - (numeric(value, 0) / roundedMax) * chartHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => roundedMax * ratio);
  const active = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div className="relative h-full w-full">
      <svg width={safeWidth} height={safeHeight} role="img" aria-label="OEE waterfall chart">
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={safeWidth - margin.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
              />
              <text
                x={margin.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-semibold"
              >
                {formatFixed2(tick)}h
              </text>
            </g>
          );
        })}
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + chartHeight}
          stroke="#94a3b8"
        />
        <line
          x1={margin.left}
          x2={safeWidth - margin.right}
          y1={margin.top + chartHeight}
          y2={margin.top + chartHeight}
          stroke="#94a3b8"
        />
        {data.slice(0, -1).map((row, index) => {
          const x = margin.left + index * stepWidth + (stepWidth + barWidth) / 2;
          const nextX = margin.left + (index + 1) * stepWidth + (stepWidth - barWidth) / 2;
          const y = yFor(row.endValue);
          return (
            <line
              key={`connector-${row.name}-${index}`}
              x1={x}
              x2={nextX}
              y1={y}
              y2={y}
              stroke="#64748b"
              strokeDasharray="5 4"
              strokeWidth={1.4}
            />
          );
        })}
        {data.map((row, index) => {
          const x = margin.left + index * stepWidth + (stepWidth - barWidth) / 2;
          const topValue = Math.max(row.startValue, row.endValue);
          const bottomValue = Math.min(row.startValue, row.endValue);
          const y = yFor(topValue);
          const barHeight = Math.max(3, yFor(bottomValue) - y);
          const labelY = Math.max(14, y - 8);
          const deltaPrefix =
            row.displayValue < 0
              ? '-'
              : row.stepType === 'total' || row.stepType === 'final'
                ? ''
                : '+';
          const showValueLabel = !compact || index === 0 || index === data.length - 1;
          return (
            <g
              key={`${row.name}-${index}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              tabIndex={0}
            >
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={5}
                fill={row.fill}
                stroke={activeIndex === index ? '#0f172a' : 'transparent'}
                strokeWidth={activeIndex === index ? 2 : 0}
              />
              {showValueLabel && (
                <text
                  x={x + barWidth / 2}
                  y={labelY}
                  textAnchor="middle"
                  className="fill-slate-700 text-[10px] font-extrabold"
                >
                  {deltaPrefix}
                  {formatFixed2(Math.abs(row.displayValue))}h
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={margin.top + chartHeight + (compact ? 18 : 20)}
                textAnchor="middle"
                className="fill-slate-700 text-[10px] font-bold"
              >
                {compact && row.name === 'Total Time' ? 'Total' : row.name}
              </text>
              {!compact && (
                <text
                  x={x + barWidth / 2}
                  y={margin.top + chartHeight + 36}
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-semibold"
                >
                  {formatFixed2(row.endValue)}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="pointer-events-none absolute right-2 top-2 z-50 max-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
          <div className="font-extrabold text-slate-900">{active.name}</div>
          <div className="mt-1 font-semibold text-slate-600">
            Start: {formatFixed2(active.startValue)}h
          </div>
          <div className="font-semibold text-slate-600">
            Delta: {active.displayValue < 0 ? '-' : ''}
            {formatFixed2(Math.abs(active.displayValue))}h
          </div>
          <div className="font-semibold text-slate-600">End: {formatFixed2(active.endValue)}h</div>
        </div>
      )}
    </div>
  );
}

function OeeWaterfallChart({ data }) {
  const [chartSize, setChartSize] = useState({ width: 760, height: 330 });
  return (
    <ResponsiveContainer
      width="100%"
      height={330}
      onResize={(width, height) =>
        setChartSize({
          width: Math.max(Math.round(width || 760), 320),
          height: Math.max(Math.round(height || 330), 260),
        })
      }
    >
      <OeeWaterfallSvg data={data} width={chartSize.width} height={chartSize.height} />
    </ResponsiveContainer>
  );
}

function severityColorForStatusStr(s) {
  return SEV_HEX[sevFromStatus(s)] || STATUS_TOKENS.normal.solid;
}

function UptimeBreakdown({ kpi }) {
  const byMachine = (kpi?.source_detail?.by_machine || []).slice(0, 10);
  const offenders = byMachine.filter(
    (m) => numeric(m.failed_count) > 0 || numeric(m.max_consecutive_fail) > 0
  );
  const hourly = (kpi?.source_detail?.hourly || []).map((h) => ({
    hour: h.hour_label,
    failed: numeric(h.failed_count),
    pings: numeric(h.ping_count),
    uptime: numeric(h.uptime_pct),
  }));
  const uptimeMin = hourly.length ? Math.min(...hourly.map((h) => h.uptime)) : 100;
  const uptimeFloor = Math.max(0, Math.floor(uptimeMin * 2) / 2 - 0.5);
  return (
    <div className="space-y-4">
      <PageCard>
        <CardHead icon={Activity} title="Uptime per Hour — Latest Date" tag={`${hourly.length}h`} />
        <div className="p-4">
          {hourly.length ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={hourly} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={12}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10 }}
                    allowDecimals={false}
                    label={{
                      value: 'gagal',
                      angle: -90,
                      position: 'insideLeft',
                      fontSize: 10,
                      fill: '#94a3b8',
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[uptimeFloor, 100]}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    formatter={(value, name) =>
                      name === 'uptime'
                        ? [`${formatFixed2(value)}%`, 'Uptime']
                        : [`${formatNumber(value)} gagal`, 'Failed ping']
                    }
                    labelFormatter={(label) => `Hour ${label}`}
                  />
                  <Bar yAxisId="left" dataKey="failed" radius={[4, 4, 0, 0]} maxBarSize={26}>
                    {hourly.map((h) => (
                      <Cell key={h.hour} fill={uptimeColor(h.uptime)} />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="uptime"
                    stroke={uptimeColor(kpi?.value)}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </>
          ) : (
            <EmptyChart text="No hourly ping data for the latest date." />
          )}
        </div>
      </PageCard>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PageCard>
          <CardHead icon={Wifi} title="Uptime per Machine (lowest)" tag={`${byMachine.length}`} />
          <div className="p-4">
            <RankedList
              items={byMachine}
              valueOf={(m) => numeric(m.uptime_pct)}
              labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
              valueFmt={(m) => `${formatNumber(m.uptime_pct)}%`}
              colorOf={(m) => uptimeColor(m.uptime_pct)}
              subOf={(m) =>
                `${formatNumber(m.failed_count)} gagal · ${numeric(m.max_consecutive_fail)} berturut · loss ${formatNumber(m.downtime_minutes)} min`
              }
              emptyText="All machines online — no ping failures."
            />
          </div>
        </PageCard>
        <PageCard>
          <CardHead icon={AlertTriangle} title="Kegagalan Nyata (≥6 berturut)" />
          <div className="p-4">
            {offenders.length ? (
              <RankedList
                items={offenders}
                valueOf={(m) => numeric(m.max_consecutive_fail)}
                labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
                valueFmt={(m) => `${numeric(m.max_consecutive_fail)}x`}
                colorOf={(m) =>
                  numeric(m.max_consecutive_fail) >= 6 ? SEV_HEX.Critical : SEV_HEX.Watch
                }
                subOf={(m) =>
                  `${m.ipaddress || '-'} · latency ${formatNumber(m.avg_latency_ms)} ms · packet loss ${formatNumber(m.max_packet_loss_percent)}%`
                }
              />
            ) : (
              <EmptyState text="No machine has reached the real-downtime threshold (6+ consecutive failures)." />
            )}
          </div>
        </PageCard>
      </section>
    </div>
  );
}

function AccuracyBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const byType = sd.by_error_type || [];
  const byMachine = (sd.by_machine || []).slice(0, 8);
  const byOperator = (sd.by_operator || []).slice(0, 8);
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PageCard>
        <CardHead icon={ShieldCheck} title="Error per Kategori" />
        <div className="p-4">
          <RankedList
            items={byType}
            valueOf={(t) => numeric(t.error_records)}
            labelOf={(t) => errorTypeLabels[t.error_type] || t.error_type}
            valueFmt={(t) => formatNumber(t.error_records)}
            colorOf={() => SEV_HEX.Watch}
            emptyText="No classified errors in this window."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={GaugeIcon} title="Machine Hotspot" />
        <div className="p-4">
          <RankedList
            items={byMachine}
            valueOf={(m) => numeric(m.error_records)}
            labelOf={(m) => m.machine_id || 'UNKNOWN'}
            valueFmt={(m) => formatNumber(m.error_records)}
            colorOf={() => '#0096c7'}
            emptyText="No machine with errors."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={Users} title="Hotspot Operator" />
        <div className="p-4">
          <RankedList
            items={byOperator}
            valueOf={(o) => numeric(o.error_records)}
            labelOf={(o) => o.operator_name || o.operator_id || 'UNKNOWN'}
            valueFmt={(o) => formatNumber(o.error_records)}
            colorOf={() => '#0077b6'}
            emptyText="No operator with errors."
          />
        </div>
      </PageCard>
    </section>
  );
}

function AdoptionBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const byGap = (sd.by_gap_type || []).map((g) => ({
    name: gapTypeLabels[g.gap_type] || g.gap_type,
    value: numeric(g.missing_minutes),
    buckets: numeric(g.gap_buckets),
  }));
  const byMachine = (sd.by_machine || []).slice(0, 8);
  const byOperator = (sd.by_operator || []).slice(0, 8);
  const gapColors = ['#f59e0b', '#dc2626', '#0096c7'];
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PageCard>
        <CardHead icon={AlertTriangle} title="Gap Type" />
        <div className="p-4">
          {byGap.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={byGap}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                >
                  {byGap.map((entry, i) => (
                    <Cell key={entry.name} fill={gapColors[i % gapColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${formatNumber(value)} min`, name]} />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="No adoption gap in this window." />
          )}
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={GaugeIcon} title="Gap per Machine" />
        <div className="p-4">
          <RankedList
            items={byMachine}
            valueOf={(m) => numeric(m.missing_minutes)}
            labelOf={(m) => m.machine_key || 'UNKNOWN'}
            valueFmt={(m) => `${formatNumber(m.missing_minutes)} min`}
            colorOf={() => SEV_HEX.Watch}
            subOf={(m) => `${formatNumber(m.gap_buckets)} bucket`}
            emptyText="No gap per machine."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={Users} title="Gap per Operator" />
        <div className="p-4">
          <RankedList
            items={byOperator}
            valueOf={(o) => numeric(o.missing_minutes)}
            labelOf={(o) => o.operator_name || o.operator_key || 'UNKNOWN'}
            valueFmt={(o) => `${formatNumber(o.missing_minutes)} min`}
            colorOf={() => '#0077b6'}
            subOf={(o) => `${formatNumber(o.gap_buckets)} bucket`}
            emptyText="No gap per operator."
          />
        </div>
      </PageCard>
    </section>
  );
}

function OeeBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const waterfall = buildOeeWaterfallChartData(sd);
  const distribution = buildOeeDistributionChartData(sd);
  const byLoss = (sd.by_loss_type || []).map((l) => ({
    name: l.loss_type,
    bucket: l.loss_type,
    hours: numeric(l.hours),
    events: numeric(l.event_count),
  }));

  const lossStatus = Array.isArray(sd.by_loss_status) ? sd.by_loss_status : [];
  const byLossItems = lossStatus.length
    ? lossStatus.map((s) => ({
        name: s.status,
        bucket: s.bucket,
        hours: numeric(s.hours),
        events: numeric(s.event_count),
      }))
    : byLoss;
  const byMachine = (sd.by_machine || []).slice(0, 10);
  const byNoJob = sd.nojob_by_machine || [];
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PageCard>
          <CardHead icon={BarChart3} title="OEE Time Waterfall" />
          <div className="p-4">
            {waterfall.length ? (
              <OeeWaterfallChart data={waterfall} />
            ) : (
              <EmptyChart text="No waterfall data in this window." />
            )}
          </div>
        </PageCard>
        <PageCard>
          <CardHead icon={BarChart3} title="Machine Time Mix (100%)" />
          <div className="p-4">
            {distribution.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={distribution}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 84, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={formatFixedPercent}
                  />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={92} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload;
                      const compList = (items, extraLabel) =>
                        (items || []).slice(0, 6).map((c) => (
                          <div
                            key={`${c.bucket}-${c.status}`}
                            className="pl-3 text-[11px] font-medium text-slate-500"
                          >
                            · {c.status}
                            {extraLabel ? ` ${extraLabel}` : ''}: {formatFixed2(c.hours)}h
                          </div>
                        ));
                      const nvaExtra =
                        (row.comp?.NVA?.length || 0) + (row.comp?.Missing?.length || 0) - 6;
                      return (
                        <div className="z-50 max-w-[260px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                          <div className="font-extrabold text-slate-800">{label}</div>
                          <div className="mt-1 font-semibold text-slate-600">
                            VA: {formatFixedPercent(row.VA)} ({formatFixed2(row.vaHours)}h)
                          </div>
                          <div className="font-semibold text-slate-600">
                            NNVA: {formatFixedPercent(row.NNVA)} ({formatFixed2(row.nnvaHours)}h)
                          </div>
                          {compList(row.comp?.NNVA)}
                          <div className="font-semibold text-slate-600">
                            NVA: {formatFixedPercent(row.NVA)} ({formatFixed2(row.nvaHours)}h)
                          </div>
                          {compList(row.comp?.NVA)}
                          {compList(row.comp?.Missing, '(Missing)')}
                          {nvaExtra > 0 ? (
                            <div className="pl-3 text-[11px] font-medium text-slate-400">
                              · +{nvaExtra} status lain
                            </div>
                          ) : null}
                        </div>
                      );
                    }}
                    wrapperStyle={{ zIndex: 50 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                  <Bar dataKey="VA" stackId="mix" fill={machineMixColors.VA} />
                  <Bar dataKey="NNVA" stackId="mix" fill={machineMixColors.NNVA} />
                  <Bar
                    dataKey="NVA"
                    stackId="mix"
                    fill={machineMixColors.NVA}
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart text="No per-machine distribution in this window." />
            )}
          </div>
        </PageCard>
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PageCard>
          <CardHead icon={GaugeIcon} title="OEE per Machine (lowest)" />
          <div className="p-4">
            <RankedList
              items={byMachine}
              valueOf={(m) => numeric(m.oee_time_pct)}
              labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
              valueFmt={(m) =>
                m.oee_time_pct === null || m.oee_time_pct === undefined
                  ? 'n/a'
                  : `${formatNumber(m.oee_time_pct)}%`
              }
              colorOf={(m) => severityColorForStatusStr(m.status)}
              subOf={(m) =>
                m.oee_time_pct === null || m.oee_time_pct === undefined
                  ? `no counted time · ${formatHours(m.total_hours)} NoJob/PM/breakdown`
                  : `run ${formatHours(m.running_hours)} / ${formatHours(m.total_hours)} · loss ${formatHours(m.loss_hours)}`
              }
              emptyText="No machine data."
            />
          </div>
        </PageCard>
        <PageCard>
          <CardHead icon={AlertTriangle} title="Loss by Type" tag="per status" />
          <div className="p-4">
            <RankedList
              items={byLossItems}
              valueOf={(l) => l.hours}
              labelOf={(l) => l.name}
              valueFmt={(l) => formatHours(l.hours)}
              colorOf={(l) => machineMixColors[l.bucket] || '#ef4444'}
              subOf={(l) => `${l.bucket} · ${formatNumber(l.events)} event`}
              emptyText="No loss recorded."
            />
          </div>
        </PageCard>
      </section>
      <PageCard>
        <CardHead
          icon={Clock3}
          title="NoJob per Machine (highest)"
          tag={`${byNoJob.length} machines`}
        />
        <div className="p-4">
          <RankedList
            items={byNoJob}
            valueOf={(m) => numeric(m.nojob_hours)}
            labelOf={(m) => m.machinename || m.machineid || 'UNKNOWN'}
            valueFmt={(m) => formatHours(m.nojob_hours)}
            colorOf={() => machineMixColors.NoJob}
            subOf={(m) =>
              `${formatNumber(m.nojob_pct)}% of ${formatHours(m.total_hours)} machine time`
            }
            emptyText="No NoJob time in this window."
            initialCount={10}
          />
        </div>
      </PageCard>
    </div>
  );
}

function OleBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const byActivity = (sd.by_activity || [])
    .map((a) => ({
      name: a.activity_label || a.activity_bucket,
      code: a.activity_bucket,
      hours: numeric(a.hours),
      rec: numeric(a.record_count),
    }))
    .sort((a, b) => b.hours - a.hours);
  const chartActivity = byActivity
    .slice(0, 8)
    .map((a, i, arr) => ({ ...a, color: unprodRedShade(i, arr.length) }));
  const byOperator = (sd.by_operator || []).slice(0, 20);
  const byMachine = (sd.by_machine || []).slice(0, 20);
  return (
    <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
      <PageCard>
        <CardHead
          icon={Activity}
          title="Non-Productive Labour Distribution"
          tag={`${byActivity.length}`}
        />
        <div className="p-4">
          {chartActivity.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartActivity}
                layout="vertical"
                margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 10 }}
                  width={118}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                  formatter={(value, name, entry) => [
                    `${formatHours(value)} · ${formatNumber(entry?.payload?.rec)} record`,
                    'Durasi',
                  ]}
                  labelFormatter={(label, payload) =>
                    `${label}${payload?.[0]?.payload?.code ? ` (${payload[0].payload.code})` : ''}`
                  }
                />
                <Bar dataKey="hours" radius={[0, 6, 6, 0]} maxBarSize={26}>
                  {chartActivity.map((entry) => (
                    <Cell key={entry.code} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="No non-productive labour time in this window." />
          )}
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={Users} title="OLE per Operator (lowest)" tag={`${byOperator.length}`} />
        <div className="p-4">
          <RankedList
            items={byOperator}
            initialCount={6}
            valueOf={(o) => numeric(o.ole_time_pct)}
            labelOf={(o) => o.operator_name || o.operator_id || 'UNKNOWN'}
            valueFmt={(o) => `${formatNumber(o.ole_time_pct)}%`}
            colorOf={(o) => severityColorForStatusStr(o.status)}
            subOf={(o) =>
              `produktif ${formatHours(o.working_hours)} / ${formatHours(o.total_hours)}`
            }
            emptyText="No operator data."
          />
        </div>
      </PageCard>
      <PageCard>
        <CardHead icon={GaugeIcon} title="Non-Productive per Machine" tag={`${byMachine.length}`} />
        <div className="p-4">
          <RankedList
            items={byMachine}
            initialCount={6}
            valueOf={(m) => numeric(m.nva_hours)}
            labelOf={(m) => m.machine_name || m.machine_id || 'UNKNOWN'}
            valueFmt={(m) => formatHours(m.nva_hours)}
            colorOf={() => SEV_HEX.Watch}
            subOf={(m) => `of ${formatHours(m.total_hours)} total`}
            emptyText="No machine data."
          />
        </div>
      </PageCard>
    </section>
  );
}

function ActionSummaryPanel({ rows, config }) {
  const top = rows.slice(0, 3);
  const criticalCount = rows.filter((r) => r.severity === 'Critical').length;
  const watchCount = rows.filter((r) => r.severity === 'Watch').length;
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Wrench size={16} className="text-[#0077b6]" />
        <h3 className="text-sm font-black text-slate-900">Action Summary</h3>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
          {rows.length} item
        </span>
        {criticalCount > 0 && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-extrabold text-red-700">
            {criticalCount} critical
          </span>
        )}
        {watchCount > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
            {watchCount} watch
          </span>
        )}
      </div>
      {top.length ? (
        <ul className="mt-3 flex-1 space-y-2.5">
          {top.map((r, i) => (
            <li key={`${r.scope}_${r.entityId}_${i}`} className="flex items-start gap-2">
              <span className="mt-0.5">
                <SeverityDot severity={r.severity} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-slate-800">{r.area}</span>
                  <span className="flex-shrink-0 font-mono text-[11px] font-extrabold text-slate-700">
                    {r.metric}
                  </span>
                </div>
                <p className="truncate text-[11px] leading-snug text-slate-500">{r.action}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 flex flex-1 items-center rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs font-bold text-emerald-600">
          ✓ No urgent action for this KPI.
        </div>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] font-semibold text-slate-500">
        <span>Primary owner</span>
        <span className="font-extrabold text-[#0077b6]">{config.pic}</span>
      </div>
    </div>
  );
}

function MetricTiles({ kpiType, kpi }) {
  const d = kpi?.detail || {};
  let tiles = [];
  if (kpiType === 'uptime') {
    tiles = [
      {
        label: 'Ping Success',
        value: `${formatNumber(d.success_count)}/${formatNumber(d.ping_count)}`,
        tone: 'good',
      },
      {
        label: 'Failed Ping',
        value: formatNumber(d.failed_count),
        tone: numeric(d.failed_count) > 0 ? 'bad' : 'good',
      },
      {
        label: 'DOWN Samples',
        value: formatNumber(d.down_samples),
        tone: numeric(d.down_samples) > 0 ? 'warn' : 'good',
      },
      {
        label: 'Max Packet Loss',
        value: `${formatNumber(d.max_packet_loss_percent)}%`,
        sub: `latency ${formatNumber(d.avg_latency_ms)} ms`,
        tone: 'neutral',
      },
    ];
  } else if (kpiType === 'accuracy') {
    tiles = [
      {
        label: 'SAP-Ready',
        value: `${formatNumber(d.ready_records)}/${formatNumber(d.total_records)}`,
        tone: 'good',
      },
      {
        label: 'Error Records',
        value: formatNumber(d.error_records),
        tone: numeric(d.error_records) > 0 ? 'bad' : 'good',
      },
      { label: 'TS Not Staged', value: formatNumber(d.timesheet_not_staged_records), tone: 'warn' },
      {
        label: 'Min Sample (≥50)',
        value: d.minimum_sample_met === false ? 'No' : 'Yes',
        sub: `${formatNumber(d.total_records)} records`,
        tone: d.minimum_sample_met === false ? 'warn' : 'good',
      },
    ];
  } else if (kpiType === 'adoption') {
    tiles = [
      {
        label: 'Covered',
        value: `${formatNumber(d.covered_bucket_count)}/${formatNumber(d.expected_bucket_count)}`,
        tone: 'good',
      },
      {
        label: 'Missing Buckets',
        value: formatNumber(d.missing_bucket_count),
        sub: `${formatNumber(d.missing_minutes)} min`,
        tone: numeric(d.missing_bucket_count) > 0 ? 'bad' : 'good',
      },
      {
        label: 'Unidentified',
        value: formatNumber(d.unidentified_bucket_count),
        tone: numeric(d.unidentified_bucket_count) > 0 ? 'warn' : 'good',
      },
      {
        label: 'Machine / Operator',
        value: `${formatNumber(d.machine_count)} / ${formatNumber(d.operator_count)}`,
        tone: 'info',
      },
    ];
  } else if (kpiType === 'oee') {
    tiles = [
      {
        label: 'Productive',
        value: formatHours(d.running_hours),
        sub: `of ${formatHours(d.denominator_hours)} counted`,
        tone: 'good',
      },
      { label: 'Downtime', value: formatHours(d.downtime_hours), tone: 'bad' },
      { label: 'NNVA', value: formatHours(d.setup_hours), tone: 'warn' },
      {
        label: 'NoJob / Missing',
        value: `${formatHours(d.nojob_hours)} / ${formatHours(d.missing_hours)}`,
        tone: 'neutral',
      },
    ];
  } else if (kpiType === 'adoption_machine') {
    const unidMin = numeric(d.unidentified_duration_seconds) / 60;
    const idleMin = numeric(d.long_status_2_duration_seconds) / 60;
    tiles = [
      { label: 'Machines', value: formatNumber(d.machine_count), tone: 'info' },
      {
        label: 'Total Gap',
        value: `${formatNumber(d.gap_pct)}%`,
        tone: numeric(d.gap_pct) > 0 ? 'bad' : 'good',
      },
      {
        label: 'Unidentified',
        value: `${formatNumber(unidMin)} m`,
        sub: `${formatNumber(d.unidentified_pct)}%`,
        tone: unidMin > 0 ? 'warn' : 'good',
      },
      {
        label: 'IDLE (M2 >5m)',
        value: `${formatNumber(idleMin)} m`,
        sub: `${formatNumber(d.long_status_2_pct)}% · ${formatNumber(d.long_status_2_count)} events`,
        tone: idleMin > 0 ? 'warn' : 'good',
      },
    ];
  } else if (kpiType === 'ole') {
    const gap = Math.max(0, numeric(d.available_recorded_hours) - numeric(d.working_hours));
    tiles = [
      {
        label: 'Productive',
        value: formatHours(d.working_hours),
        sub: `of ${formatHours(d.available_recorded_hours)} recorded`,
        tone: 'good',
      },
      { label: 'Non-Productive', value: formatHours(gap), tone: gap > 0 ? 'bad' : 'good' },
      { label: 'Operator', value: formatNumber(d.operator_count), tone: 'info' },
      { label: 'Recorded', value: formatHours(d.available_recorded_hours), tone: 'neutral' },
    ];
  }
  if (!tiles.length) return null;
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <MetricTile key={t.label} {...t} />
      ))}
    </section>
  );
}

const ADOPTION_GAP_COLORS = { unidentified: '#023e8a', idle: '#00b4d8' };
const SURFACE_GAP_PX = 2;

function GapSegment(props) {
  const { x, y, width, height, fill, payload, segment } = props;
  if (!(width > 0)) return null;
  const idleVisible = numeric(payload?.idle) > 0;
  const isLast = segment === 'idle' ? true : !idleVisible;
  const w = segment === 'unidentified' && idleVisible ? Math.max(width - SURFACE_GAP_PX, 0) : width;
  if (!(w > 0)) return null;
  const r = Math.min(4, height / 2, w);
  const d = isLast
    ? `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + w - r},${y + height} H${x} Z`
    : `M${x},${y} H${x + w} V${y + height} H${x} Z`;
  return (
    <g>
      <path d={d} fill={fill} />
      {isLast ? (
        <text
          x={x + w + 8}
          y={y + height / 2}
          dominantBaseline="central"
          fontSize={11}
          fontWeight={700}
          fill="#334155"
        >
          {`${formatNumber(payload?.gap)}m`}
        </text>
      ) : null}
    </g>
  );
}

function AdoptionMachineBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const data = (sd.by_machine || []).map((m) => ({
    machine: m.machine_name || `Machine ${m.machine}`,
    unidentified: numeric(m.unidentified_minutes),
    idle: numeric(m.idle_minutes),
    gap: numeric(m.gap_minutes),
    total: numeric(m.total_minutes),
    adoption: m.adoption_pct == null ? null : numeric(m.adoption_pct),
  }));
  const machineCount = numeric(sd.machine_count);

  const height = Math.max(200, data.length * 40 + 64);

  return (
    <PageCard>
      <CardHead
        icon={BarChart3}
        title="Adoption Gap per Machine"
        tag={
          machineCount ? `${data.length} of ${machineCount} machines` : `${data.length} machines`
        }
      />
      <div className="p-4">
        {data.length ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 64, left: 4, bottom: 4 }}
              barCategoryGap="35%"
            >
              <CartesianGrid horizontal={false} stroke="#e2e8f0" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickFormatter={(v) => `${v}m`}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="machine"
                width={112}
                tick={{ fontSize: 11, fill: '#334155' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.10)' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload || {};
                  const share = row.total > 0 ? (row.gap / row.total) * 100 : null;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      <div className="font-extrabold text-slate-800">{label}</div>
                      <div className="mt-1.5 space-y-1">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <span
                            className="h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ background: ADOPTION_GAP_COLORS.unidentified }}
                          />
                          <span className="font-semibold">Unidentified</span>
                          <span className="ml-auto font-mono font-bold text-slate-800">
                            {formatNumber(row.unidentified)}m
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <span
                            className="h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ background: ADOPTION_GAP_COLORS.idle }}
                          />
                          <span className="font-semibold">IDLE</span>
                          <span className="ml-auto font-mono font-bold text-slate-800">
                            {formatNumber(row.idle)}m
                          </span>
                        </div>
                      </div>
                      <div className="mt-1.5 border-t border-slate-100 pt-1.5 font-semibold text-slate-500">
                        Gap {formatNumber(row.gap)}m of {formatNumber(row.total)}m
                        {share !== null ? ` · ${formatNumber(share)}%` : ''}
                        {row.adoption !== null ? ` · adoption ${formatNumber(row.adoption)}%` : ''}
                      </div>
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 8 }}
                iconType="circle"
                iconSize={8}
              />
              <Bar
                dataKey="unidentified"
                stackId="gap"
                name="Unidentified"
                fill={ADOPTION_GAP_COLORS.unidentified}
                barSize={18}
                shape={<GapSegment segment="unidentified" />}
              />
              <Bar
                dataKey="idle"
                stackId="gap"
                name="IDLE"
                fill={ADOPTION_GAP_COLORS.idle}
                barSize={18}
                shape={<GapSegment segment="idle" />}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart text="No machine adoption gap (unidentified / IDLE) in this window." />
        )}
      </div>
    </PageCard>
  );
}

const ACC_MACHINE_REASONS = {
  no_operator: { label: 'Operator not identified', color: '#dc2626' },
  no_job: { label: 'Job not linked', color: '#f59e0b' },
  no_confirmation: { label: 'SAP confirmation missing', color: '#0096c7' },
  other: { label: 'Other', color: '#94a3b8' },
};

function AccuracyMachineBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const totals = sd.totals || {};
  const byMachine = (sd.by_machine || []).slice(0, 10);
  const reasons = (sd.by_reason || []).map((r) => ({
    key: r.reason,
    name: ACC_MACHINE_REASONS[r.reason]?.label || r.reason,
    color: ACC_MACHINE_REASONS[r.reason]?.color || '#94a3b8',
    value: numeric(r.count),
  }));
  const incomplete = numeric(totals.incomplete_records);

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <PageCard>
        <CardHead
          icon={GaugeIcon}
          title="Incomplete Records per Machine"
          right={
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700">
              {formatNumber(incomplete)} REC
            </span>
          }
        />
        <div className="p-4">
          <RankedList
            items={byMachine}
            valueOf={(m) => numeric(m.incomplete)}
            labelOf={(m) => m.machinename || m.machine_key || 'UNKNOWN'}
            valueFmt={(m) => `${formatNumber(m.incomplete)} rec`}
            colorOf={(m) => severityColorForStatusStr(m.status)}
            subOf={(m) =>
              `accuracy ${formatNumber(m.accuracy_pct)}% of ${formatNumber(m.total)} records`
            }
            emptyText="All machine records complete in this window."
            initialCount={10}
          />
        </div>
      </PageCard>

      <PageCard>
        <CardHead icon={AlertTriangle} title="Incompleteness Cause" />
        <div className="p-4">
          {reasons.length ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={reasons}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {reasons.map((r) => (
                      <Cell key={r.key} fill={r.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${formatNumber(value)} record`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-3 space-y-1.5">
                {reasons.map((r) => (
                  <li key={r.key} className="flex items-start gap-2 text-[11px] leading-snug">
                    <span
                      className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="text-slate-600">
                      <span className="font-bold text-slate-800">{formatNumber(r.value)}</span>
                      {incomplete > 0
                        ? ` (${formatNumber((r.value / incomplete) * 100)}%)`
                        : ''} — {r.name}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState text="No incomplete records in this window." />
          )}
        </div>
      </PageCard>
    </section>
  );
}

const ADOPTION_BAR = { timesheet: '#0096c7', hmi: '#ade8f4' };

function adoptionTargetHours(o) {
  const expected = o.expected_hours == null ? null : numeric(o.expected_hours);
  return expected !== null && expected > 0 ? expected : numeric(o.standard_hours);
}

function ShiftProgressColumn({ icon: Icon, title, operators }) {
  return (
    <PageCard>
      <CardHead
        icon={Icon}
        title={title}
        right={
          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700">
            {operators.length} OPS
          </span>
        }
      />
      <div className="max-h-[440px] space-y-3 overflow-y-auto p-4">
        {operators.length === 0 ? (
          <EmptyState text="No operator on this shift." />
        ) : (
          operators.map((o) => {
            const recorded = numeric(o.recorded_hours);
            const target = adoptionTargetHours(o);
            const inProgress = o.completed === false;

            const tsHours = o.timesheet_hours == null ? recorded : numeric(o.timesheet_hours);
            const extra = o.machine_extra_hours == null ? 0 : numeric(o.machine_extra_hours);
            const rawTs = target > 0 ? (tsHours / target) * 100 : 0;
            const rawExtra = target > 0 ? (extra / target) * 100 : 0;
            const rawTotal = rawTs + rawExtra;

            const overflow = rawTotal > 100;
            const tsPct = overflow ? (rawTs / rawTotal) * 100 : rawTs;
            const extraPct = overflow ? (rawExtra / rawTotal) * 100 : rawExtra;

            return (
              <div key={o.operator_key || o.operator_name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-slate-800">
                      {o.operator_name || o.operator_key || 'UNKNOWN'}
                    </span>
                    {inProgress ? (
                      <span className="flex-shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        live
                      </span>
                    ) : null}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                    <span className="font-bold text-slate-700">{formatNumber(recorded)}</span>
                    <span className="mx-0.5 text-slate-300">/</span>
                    {formatNumber(target)}h
                  </span>
                </div>
                <div
                  className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100"
                  title={
                    o.machine_hours == null
                      ? `Timesheet ${formatNumber(tsHours)}h · no attributable HMI record`
                      : `Timesheet ${formatNumber(tsHours)}h + HMI outside timesheet ${formatNumber(extra)}h (HMI total ${formatNumber(o.machine_hours)}h)`
                  }
                >
                  <div
                    className="h-full transition-all"
                    style={{ width: `${tsPct}%`, background: ADOPTION_BAR.timesheet }}
                  />
                  {extraPct > 0 ? (
                    <div
                      className="h-full transition-all"
                      style={{ width: `${extraPct}%`, background: ADOPTION_BAR.hmi }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </PageCard>
  );
}

function AdoptionLabourBreakdown({ kpi }) {
  const sd = kpi?.source_detail || {};
  const all = Array.isArray(sd.by_operator) ? sd.by_operator : [];
  const excused = new Set(['LEAVE', 'SICK', 'PERMIT', 'OFF']);
  const isDay = (o) =>
    o.shift === 1 || String(o.shift).toUpperCase() === 'DAY' || String(o.shift) === '1';

  const gapOf = (o) => Math.max(adoptionTargetHours(o) - numeric(o.recorded_hours), 0);
  const prep = (list) =>
    list
      .filter((o) => !excused.has(String(o.status || '').toUpperCase()))
      .sort((a, b) => gapOf(b) - gapOf(a));
  const day = prep(all.filter(isDay));
  const night = prep(all.filter((o) => !isDay(o)));
  const ma = sd.machine_attribution || {};
  const coverage = ma.coverage_pct;
  const withMachine = numeric(ma.operators_with_machine);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ShiftProgressColumn icon={Sun} title="Shift 1 · Day" operators={day} />
        <ShiftProgressColumn icon={Moon} title="Shift 2 · Night" operators={night} />
      </section>

      <PageCard>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <span className="h-2 w-6 rounded-full" style={{ background: ADOPTION_BAR.timesheet }} />
            Timesheet
          </span>
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <span className="h-2 w-6 rounded-full" style={{ background: ADOPTION_BAR.hmi }} />
            HMI
          </span>
          {coverage !== null && coverage !== undefined ? (
            <span
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700"
              title={`${formatNumber(withMachine)} operators have attributable HMI hours. ${formatNumber(ma.unattributed_hours)}h of HMI time carries no sn_employee, so a missing HMI segment means no HMI record — not zero machine work.`}
            >
              HMI COVERAGE {formatNumber(coverage)}%
            </span>
          ) : null}
        </div>
      </PageCard>
    </div>
  );
}

function KpiBreakdown({ kpiType, kpi }) {
  if (!kpi?.source_detail) {
    return (
      <PageCard className="p-6 text-center text-sm font-bold text-slate-500">
        Source detail is not available for this window.
      </PageCard>
    );
  }
  if (kpiType === 'uptime') return <UptimeBreakdown kpi={kpi} />;
  if (kpiType === 'accuracy') return <AccuracyBreakdown kpi={kpi} />;
  if (kpiType === 'accuracy_machine') return <AccuracyMachineBreakdown kpi={kpi} />;
  if (kpiType === 'adoption') return <AdoptionBreakdown kpi={kpi} />;
  if (kpiType === 'adoption_labour') return <AdoptionLabourBreakdown kpi={kpi} />;
  if (kpiType === 'adoption_machine') return <AdoptionMachineBreakdown kpi={kpi} />;
  if (kpiType === 'oee') return <OeeBreakdown kpi={kpi} />;
  if (kpiType === 'ole') return <OleBreakdown kpi={kpi} />;
  return null;
}

function KpiStrip({ kpis, activeKey, onSelect }) {
  if (!kpis?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {kpis.map((k) => {
        const active = k.key === activeKey;
        const color = STATUS_HEX[normalizeStatus(k.status)] || '#94a3b8';
        return (
          <button
            key={k.key}
            type="button"
            onClick={() => onSelect(k.key)}
            className={`flex min-w-[92px] flex-1 flex-col items-start rounded-xl border px-3 py-2 text-left transition-all active:scale-95 ${active ? 'border-[#0096c7] bg-[#caf0f8]/50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {k.label}
              </span>
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            </div>
            <span className="mt-1 text-base font-black text-slate-900">
              {formatPercent(k.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Sk({ className = '' }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="min-w-[92px] flex-1 rounded-xl border border-slate-200 bg-white p-3"
          >
            <Sk className="h-2.5 w-12" />
            <Sk className="mt-2 h-5 w-14" />
          </div>
        ))}
      </div>

      <PageCard className="p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto,1fr] xl:grid-cols-[auto,1.35fr,1fr]">
          <div className="flex flex-col items-center gap-3">
            <Sk className="h-[140px] w-[140px] rounded-full" />
            <Sk className="h-4 w-20" />
          </div>
          <div className="space-y-2.5 rounded-xl bg-slate-50 p-4">
            <Sk className="h-4 w-44" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-5/6" />
            <Sk className="h-3 w-4/6" />
          </div>
          <div className="space-y-2.5 rounded-xl border border-slate-200 p-4">
            <Sk className="h-4 w-28" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-full" />
            <Sk className="h-3 w-2/3" />
          </div>
        </div>
      </PageCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <Sk className="h-2.5 w-16" />
            <Sk className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <PageCard key={i} className="overflow-hidden">
            <div className="border-b border-slate-100 p-3">
              <Sk className="h-4 w-40" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((__, j) => (
                <div key={j}>
                  <div className="mb-1 flex justify-between">
                    <Sk className="h-3 w-24" />
                    <Sk className="h-3 w-10" />
                  </div>
                  <Sk className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </PageCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <PageCard key={i} className="overflow-hidden">
            <div className="border-b border-slate-100 p-3">
              <Sk className="h-4 w-44" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((__, j) => (
                <Sk key={j} className="h-8 w-full" />
              ))}
            </div>
          </PageCard>
        ))}
      </div>
    </div>
  );
}

const RESOLUTION_NOTE_MIN = 5;

function AutoIssueLogCard({ rows, loading, onResolve, showHistory, onToggleHistory }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(1);
  }, [showHistory]);

  const openDialog = useCallback((issue) => {
    setPending(issue);
    setNote('');
    setError('');
  }, []);

  const closeDialog = useCallback(() => {
    if (submitting) return;
    setPending(null);
    setNote('');
    setError('');
  }, [submitting]);

  const submit = useCallback(async () => {
    const text = note.trim();
    if (text.length < RESOLUTION_NOTE_MIN) {
      setError(
        `Please describe the corrective action (at least ${RESOLUTION_NOTE_MIN} characters).`
      );
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onResolve(pending.id, text);
      setPending(null);
      setNote('');
    } catch (err) {
      setError(err.message || 'Failed to resolve the issue.');
    } finally {
      setSubmitting(false);
    }
  }, [note, onResolve, pending]);

  const openCount = rows.filter((r) => r.status === 'open').length;
  const totalPages = pageCount(rows);
  const paged = pageSlice(rows, page);

  return (
    <PageCard className="overflow-hidden">
      <CardHead
        icon={AlertTriangle}
        title="Issue Log & Action"
        tag={showHistory ? 'history' : 'today'}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleHistory}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            >
              {showHistory ? 'Today' : 'History'}
            </button>
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700">
              {loading && rows.length === 0 ? '…' : `${openCount} OPEN`}
            </span>
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
            <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-center">Sev</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-center">Detail</th>
              <th className="px-3 py-2 text-center">Resolve</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className={`px-3 py-6 text-center text-xs font-bold ${loading ? 'text-slate-400' : 'text-emerald-600'}`}
                >
                  {loading
                    ? 'Loading issue log…'
                    : showHistory
                      ? '✓ No issues recorded for this KPI.'
                      : '✓ No issues today for this KPI.'}
                </td>
              </tr>
            )}
            {paged.map((row) => {
              const resolved = row.status === 'resolved';
              return (
                <tr
                  key={row.id}
                  className={`align-top transition hover:bg-[#caf0f8]/25 ${resolved ? 'opacity-55' : ''}`}
                >
                  <td className="px-3 py-2">
                    <div className="font-bold text-slate-800">
                      {row.entity_name || row.entity_id || '—'}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase text-slate-400">
                      {row.scope_type} · {row.business_date}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-[380px] text-[12px] leading-snug text-slate-700">
                      {row.description || row.title}
                    </div>
                    {resolved && row.resolution_note ? (
                      <div className="mt-1 max-w-[380px] border-l-2 border-slate-200 pl-2 text-[11px] leading-snug text-slate-500">
                        <span className="font-bold text-slate-600">
                          {row.resolved_by || 'system'}:
                        </span>{' '}
                        {row.resolution_note}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-black text-slate-800">
                    {row.metric_value == null ? '—' : `${formatNumber(row.metric_value)}%`}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <SeverityDot severity={row.severity} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={resolved ? 'Closed' : 'Open'} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {}
                    <button
                      type="button"
                      onClick={() => navigate(`/ews/issue/${encodeURIComponent(row.issue_key)}`)}
                      className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-[#caf0f8]/60 hover:text-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                      title="Lihat record penyebab"
                      aria-label="Lihat record penyebab"
                    >
                      <Search size={16} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      disabled={resolved || submitting}
                      onClick={() => openDialog(row)}
                      className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-40"
                      title="Resolve issue"
                      aria-label="Resolve issue"
                    >
                      <CheckCircle2 size={17} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TablePager
        page={page}
        totalPages={totalPages}
        totalRows={rows.length}
        onPageChange={setPage}
      />

      {pending ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 backdrop-blur-sm md:items-center md:px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Resolve issue"
          onClick={closeDialog}
        >
          <div
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl md:max-w-lg md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-800">Resolve issue</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {pending.entity_name || pending.entity_id}
            </p>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-snug text-slate-600">
              {pending.description || pending.title}
            </p>

            <label
              htmlFor="ews-resolution-note"
              className="mt-4 block text-xs font-bold text-slate-700"
            >
              Justification / corrective action <span className="text-red-600">*</span>
            </label>
            <textarea
              id="ews-resolution-note"
              rows={4}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder="What was done, or why this is acceptable?"
              className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${error ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 focus:border-[#0096c7]'}`}
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-red-600">{error}</span>
              <span className="font-mono text-[11px] text-slate-400">
                {note.trim().length}/1000
              </span>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={submitting}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || note.trim().length < RESOLUTION_NOTE_MIN}
                className="rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageCard>
  );
}

function EwsDetailPage() {
  const navigate = useNavigate();
  const { type } = useParams();
  const [searchParams] = useSearchParams();
  const kpiType = String(type || '').toLowerCase();
  const config = KPI_CONFIG[kpiType];
  const [kpi, setKpi] = useState(null);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionPage, setActionPage] = useState(1);
  const [autoIssues, setAutoIssues] = useState([]);
  const [autoIssuesLoading, setAutoIssuesLoading] = useState(true);
  const [showIssueHistory, setShowIssueHistory] = useState(false);

  const manualDate = searchParams.get('date') || '';
  const usesManualDate =
    searchParams.get('basis') === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(manualDate);

  const ewsQuery = usesManualDate
    ? `basis=date&date=${encodeURIComponent(manualDate)}&live=1`
    : 'basis=today';
  const ewsSummaryQuery = usesManualDate ? ewsQuery : 'basis=today';

  const loadAutoIssues = useCallback(async () => {
    setAutoIssuesLoading(true);
    try {
      const dateFilter = showIssueHistory ? '' : '&business_date=today';
      const payload = await fetchJson(
        `${API_BASE}/ews/issue-log?category=${encodeURIComponent(kpiType)}&status=all${dateFilter}`
      );
      setAutoIssues(Array.isArray(payload?.data) ? payload.data : []);
    } catch {
      setAutoIssues([]);
    } finally {
      setAutoIssuesLoading(false);
    }
  }, [kpiType, showIssueHistory]);

  useEffect(() => {
    loadAutoIssues();
  }, [loadAutoIssues]);

  const resolveAutoIssue = useCallback(async (id, note) => {
    const payload = await sendJson(`${API_BASE}/ews/issue-log/${id}/resolve`, 'PUT', {
      resolution_note: note,
      resolved_by: currentUserId(),
    });
    const saved = payload?.data;
    setAutoIssues((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...(saved || {}), status: 'resolved' } : r))
    );
  }, []);

  const loadData = useCallback(async () => {
    if (!config) return;
    setError('');

    const cacheKey = `${kpiType}|${ewsQuery}`;
    const cachedEntry = detailMemCache.get(cacheKey);
    const cacheFresh = cachedEntry && Date.now() - cachedEntry.at < DETAIL_MEM_TTL_MS;
    if (cachedEntry) {
      setKpi(cachedEntry.kpi);
      setMeta(cachedEntry.meta);
      setSummary(cachedEntry.summary);
      setIsLoading(false);
    }
    if (cacheFresh) {
      return;
    }
    if (!cachedEntry) setIsLoading(true);

    try {
      const detailPromise = fetchJson(`${API_BASE}/ews/kpi/${kpiType}/detail?${ewsQuery}`).catch(
        (err) => {
          if (usesManualDate) throw err;
          return fetchJson(`${API_BASE}/ews/kpi/${kpiType}/detail?basis=today`);
        }
      );
      const [detailResult, summaryResult] = await Promise.allSettled([
        detailPromise,
        fetchJson(`${API_BASE}/ews/summary?${ewsSummaryQuery}`),
      ]);

      const detailPayload = detailResult.status === 'fulfilled' ? detailResult.value : null;
      const summaryPayload = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
      const fallbackKpi = summaryPayload?.kpis?.find((item) => item.key === kpiType);

      if (!detailPayload?.data && !fallbackKpi) {
        throw new Error(detailResult.reason?.message || 'EWS detail data is not available.');
      }

      const nextKpi = cosmeticizeKpi({ key: kpiType, ...fallbackKpi, ...detailPayload?.data });
      const nextMeta = { ...(summaryPayload || {}), ...(detailPayload?.meta || {}) };

      setKpi(nextKpi);
      setMeta(nextMeta);
      setSummary(summaryPayload);
      setIsLoading(false);
      detailMemCache.set(cacheKey, {
        at: Date.now(),
        kpi: nextKpi,
        meta: nextMeta,
        summary: summaryPayload,
      });
    } catch (err) {
      if (!cachedEntry) {
        setError(err.message || 'Failed to load EWS detail.');
        setIsLoading(false);
      }
    }
  }, [config, ewsQuery, ewsSummaryQuery, kpiType, usesManualDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const kpisByKey = useMemo(() => {
    const list = summary?.kpis || [];
    return Object.fromEntries(list.map((k) => [k.key, k]));
  }, [summary]);

  const actionRows = useMemo(
    () => buildActionRows(kpi, config || KPI_CONFIG.accuracy),
    [config, kpi]
  );

  const openAutoIssues = useMemo(() => autoIssues.filter((i) => i.status === 'open'), [autoIssues]);
  const criticalOpenIssues = useMemo(
    () => openAutoIssues.filter((i) => String(i.severity).toLowerCase() === 'critical').length,
    [openAutoIssues]
  );

  const actionTotalPages = useMemo(() => pageCount(actionRows), [actionRows]);
  const pagedActionRows = useMemo(
    () => pageSlice(actionRows, actionPage),
    [actionPage, actionRows]
  );

  useEffect(() => {
    setActionPage(1);
  }, [kpiType, kpi?.value, meta?.window_end]);
  useEffect(() => {
    if (actionPage > actionTotalPages) setActionPage(actionTotalPages);
  }, [actionPage, actionTotalPages]);

  const diagnosis = useMemo(
    () => buildDiagnosis(kpiType, kpi, kpisByKey),
    [kpiType, kpi, kpisByKey]
  );

  const kpiStatus = normalizeStatus(kpi?.status);
  const Icon = config?.icon || AlertTriangle;

  const handleRefresh = useCallback(() => {
    detailMemCache.delete(`${kpiType}|${ewsQuery}`);
    loadData();
    loadAutoIssues();
  }, [kpiType, ewsQuery, loadData, loadAutoIssues]);

  if (!config) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <PageCard className="mx-auto max-w-xl p-6 text-center">
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" />
          <h1 className="mt-3 text-base font-extrabold text-slate-900">Unknown EWS category</h1>
          <button
            type="button"
            onClick={() => navigate('/operations-hub')}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            Back to Operations Hub
          </button>
        </PageCard>
      </div>
    );
  }

  const diagnosisTone = diagnosis.tone;
  const diagnosisAccent = STATUS_HEX[diagnosisTone] || STATUS_TOKENS.normal.solid;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
              aria-label="Back to Operations Hub"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
              <Icon size={21} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0077b6]">
                EWS Detail
              </p>
              <h1 className="truncate text-base font-black text-slate-900 md:text-lg">
                {config.title}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={kpiStatus === 'no_data' ? 'No Data' : kpiStatus.toUpperCase()} />
            <DeltaChip comparison={kpi?.comparison} />
            <span className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700">
              <BarChart3 size={14} className="text-[#0077b6]" />
              {formatPercent(kpi?.value)}
            </span>
            <span className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500">
              <Clock3 size={14} />
              {formatDateTime(meta?.window_end || summary?.window_end)}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 md:px-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <DetailSkeleton />
        ) : (
          <>
            {}
            <KpiStrip
              kpis={summary?.kpis}
              activeKey={kpiType}
              onSelect={(key) =>
                navigate(
                  `/ews/${key}/detail${usesManualDate ? `?basis=date&date=${manualDate}` : ''}`
                )
              }
            />

            {}
            <PageCard className="overflow-hidden">
              <div className="grid grid-cols-1 items-stretch gap-4 p-4 md:grid-cols-[auto,1fr] xl:grid-cols-[auto,1.35fr,1fr]">
                <div className="flex flex-row items-center gap-4 md:flex-col md:justify-center">
                  <Gauge value={kpi?.value} target={config.target} status={kpiStatus} />
                  <div className="text-center">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      Target
                    </div>
                    <div className="text-lg font-black" style={{ color: diagnosisAccent }}>
                      {config.target}%
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">
                      Owner: {config.pic}
                    </div>
                  </div>
                </div>
                <div
                  className="rounded-xl border-l-4 bg-slate-50 p-4"
                  style={{ borderColor: diagnosisAccent }}
                >
                  <div className="flex items-center gap-2">
                    <Lightbulb size={16} style={{ color: diagnosisAccent }} />
                    <h2 className="text-sm font-black text-slate-900">{diagnosis.headline}</h2>
                  </div>
                  {kpi?.helper && kpi.helper !== diagnosis.headline ? (
                    <p className="mt-1 text-xs font-semibold text-slate-600">{kpi.helper}</p>
                  ) : null}
                  <ul className="mt-3 space-y-1.5">
                    {diagnosis.points.map((point, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          style={{ background: diagnosisAccent }}
                        />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:col-span-2 xl:col-span-1">
                  <ActionSummaryPanel rows={actionRows} config={config} />
                </div>
              </div>
            </PageCard>

            {}
            <MetricTiles kpiType={kpiType} kpi={kpi} />

            {}
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricTile
                label="Open Issues"
                value={openAutoIssues.length}
                sub="needs action"
                tone={openAutoIssues.length > 0 ? 'warn' : 'good'}
              />
              <MetricTile
                label="Critical"
                value={criticalOpenIssues}
                sub="open critical issues"
                tone={criticalOpenIssues > 0 ? 'bad' : 'good'}
              />
              <MetricTile
                label="Data to Fix"
                value={actionRows.length}
                sub={`entities (${config.unit})`}
                tone={actionRows.length > 0 ? 'info' : 'good'}
              />
              <MetricTile
                label="Status"
                value={kpiStatus === 'no_data' ? 'NO DATA' : kpiStatus.toUpperCase()}
                sub={`vs target ${config.target}%`}
                tone={kpiStatus === 'critical' ? 'bad' : kpiStatus === 'watch' ? 'warn' : 'good'}
              />
            </section>

            {}
            <KpiBreakdown kpiType={kpiType} kpi={kpi} />

            {}
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <AutoIssueLogCard
                rows={autoIssues}
                loading={autoIssuesLoading}
                onResolve={resolveAutoIssue}
                showHistory={showIssueHistory}
                onToggleHistory={() => setShowIssueHistory((v) => !v)}
              />

              <PageCard className="overflow-hidden">
                <CardHead
                  icon={Wrench}
                  title="Data to Fix"
                  right={
                    <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-black text-slate-700">
                      {actionRows.length} ITEM
                    </span>
                  }
                />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                      <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                        <th className="px-3 py-2">Area</th>
                        <th className="px-3 py-2">Condition</th>
                        <th className="px-3 py-2 text-right">Metric</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {actionRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-6 text-center text-xs font-bold text-emerald-600"
                          >
                            ✓ No problematic data in this window.
                          </td>
                        </tr>
                      )}
                      {pagedActionRows.map((row, idx) => (
                        <tr
                          key={`${row.scope}_${row.entityId}_${idx}`}
                          className="align-top transition hover:bg-[#caf0f8]/25"
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <SeverityDot severity={row.severity} />
                              <span className="font-bold text-slate-800">{row.area}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[11px] leading-snug text-slate-600">
                              {row.detail}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="font-black text-slate-800">{row.metric}</div>
                            <div className="font-mono text-[10px] uppercase text-slate-400">
                              {row.metricLabel}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[11px] leading-snug text-slate-700">
                              {row.action}
                            </div>
                            <div className="mt-1 font-mono text-[10px] font-semibold text-[#0077b6]">
                              {row.pic}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager
                  page={actionPage}
                  totalPages={actionTotalPages}
                  totalRows={actionRows.length}
                  onPageChange={setActionPage}
                />
              </PageCard>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default EwsDetailPage;
