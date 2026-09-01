import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  HardHat,
  RadioTower,
  TrendingUp,
  UserCheck,
  Wifi,
} from 'lucide-react';
import { badgeStyle, dotStyle, solidColor } from '../../theme/ewsStatus';
import { cosmeticizeKpi, cosmeticTrendFor } from '../../theme/ewsCosmetic';
import { isManufacturing } from '../../config/appVariant';

const kpis = [
  {
    key: 'uptime_tablet',
    label: 'Uptime Tablet',
    target: 99,
    owner: 'IT',
    icon: Wifi,
    tone: 'emerald',
    group: 'labour',
  },
  {
    key: 'accuracy_labour',
    label: 'Accuracy Labour',
    target: 98,
    owner: 'Foreman',
    icon: ClipboardCheck,
    tone: 'cyan',
    group: 'labour',
  },
  {
    key: 'adoption_labour',
    label: 'Adoption Labour',
    target: 95,
    owner: 'Spv',
    icon: UserCheck,
    tone: 'sky',
    group: 'labour',
  },
  {
    key: 'ole',
    label: 'OLE',
    target: 85,
    owner: 'Spv',
    icon: HardHat,
    tone: 'indigo',
    group: 'labour',
  },

  {
    key: 'uptime_hmi',
    label: 'Uptime HMI',
    target: 99,
    owner: 'IT',
    icon: Wifi,
    tone: 'emerald',
    group: 'machine',
  },
  {
    key: 'accuracy_machine',
    label: 'Accuracy Machine',
    target: 98,
    owner: 'Foreman',
    icon: ClipboardCheck,
    tone: 'cyan',
    group: 'machine',
  },
  {
    key: 'adoption_machine',
    label: 'Adoption Machine',
    target: 95,
    owner: 'PPIC',
    icon: UserCheck,
    tone: 'sky',
    group: 'machine',
  },
  {
    key: 'oee',
    label: 'OEE',
    target: 80,
    owner: 'PPIC',
    icon: Gauge,
    tone: 'amber',
    group: 'machine',
  },
];

const cardStatusClass = {
  normal: 'border-slate-300 bg-white',
  watch: 'border-amber-300 bg-amber-50/30',
  critical: 'border-red-400 bg-red-50/40 ews-critical-card',
  no_data: 'border-slate-300 bg-white',
};

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'critical' || status === 'error') return 'critical';
  if (status === 'watch' || status === 'stale' || status === 'warning') return 'watch';
  if (status === 'normal' || status === 'fresh' || status === 'live') return 'normal';
  return 'no_data';
}

function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '--';
}

function ageMsFrom(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? Date.now() - t : 0;
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'baru';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  if (hours < 24) return `${hours}j ${totalMin % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}h ${hours % 24}j`;
}

function ageToneKey(ms) {
  const hours = ms / 3.6e6;
  if (hours >= 3) return 'critical';
  if (hours >= 1) return 'watch';
  return 'normal';
}

function AnimatedPercent({ value }) {
  const numericValue = Number(value);
  const [displayValue, setDisplayValue] = useState(
    Number.isFinite(numericValue) ? numericValue : null
  );

  useEffect(() => {
    if (!Number.isFinite(numericValue)) {
      setDisplayValue(null);
      return undefined;
    }

    const from = Number.isFinite(Number(displayValue)) ? Number(displayValue) : numericValue;
    const diff = numericValue - from;
    if (Math.abs(diff) < 0.05) {
      setDisplayValue(numericValue);
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 700;
    let frameId = 0;

    function step(now) {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayValue(from + diff * eased);
      if (t < 1) frameId = requestAnimationFrame(step);
    }

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [numericValue]);

  return <>{formatPercent(displayValue)}</>;
}

function TrendIndicator({ comparison }) {
  const direction = comparison?.direction || 'flat';
  const delta = Number(comparison?.delta);
  const previousValue = Number(comparison?.previous_value);
  const isUp = direction === 'up';
  const isDown = direction === 'down';
  const colorClass = isUp ? 'text-emerald-700' : isDown ? 'text-red-600' : 'text-slate-400';
  const triangleClass = isUp
    ? 'border-x-[5px] border-b-[8px] border-x-transparent border-b-emerald-600'
    : isDown
      ? 'border-x-[5px] border-t-[8px] border-x-transparent border-t-red-600'
      : 'h-1.5 w-2.5 rounded-full bg-slate-300';

  return (
    <div
      className={`mt-1 flex min-h-[18px] items-center gap-1.5 text-[10px] font-extrabold ${colorClass}`}
    >
      <span className={triangleClass} />
      <span className="truncate">
        Prev {Number.isFinite(previousValue) ? `${previousValue.toFixed(1)}%` : '--'}
        {Number.isFinite(delta) ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})` : ''}
      </span>
    </div>
  );
}

function MiniSnapshotTrend({ data, status }) {
  const points = (Array.isArray(data) ? data : [])
    .map((item) => Number(item.value))
    .filter((value) => Number.isFinite(value));

  const lineColor = solidColor(status);

  if (points.length < 2) {
    return (
      <div
        className="mt-3 flex h-10 items-center rounded-lg border border-slate-100 bg-slate-50 px-2"
        aria-label="7 day snapshot trend unavailable"
      >
        <div className="h-px w-full bg-slate-200" />
      </div>
    );
  }

  const width = 180;
  const height = 40;
  const paddingX = 6;
  const paddingY = 7;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (width - paddingX * 2) / Math.max(points.length - 1, 1);
  const path = points
    .map((value, index) => {
      const x = paddingX + index * step;
      const y = paddingY + (1 - (value - min) / span) * (height - paddingY * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div
      className="mt-3 h-10 overflow-hidden rounded-lg border border-slate-100 bg-slate-50/80 px-1.5 py-1"
      aria-label="7 day snapshot trend"
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-hidden="true"
      >
        <line x1="6" x2="174" y1="32" y2="32" stroke="#e2e8f0" strokeWidth="1" />
        <polyline
          points={path}
          fill="none"
          stroke={lineColor}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function KpiTile({ item, index = 0, onOpenDetail }) {
  const Icon = item.icon;
  const numericValue = Number(item.value);
  const hasValue = Number.isFinite(numericValue);
  const width = `${hasValue ? Math.min(Math.max(numericValue, 0), 100) : 0}%`;
  const statusLabel = item.status === 'no_data' ? 'NO DATA' : item.status?.toUpperCase();
  const status = normalizeStatus(item.status);
  const isCritical = status === 'critical';

  return (
    <div
      style={{ animationDelay: `${index * 70}ms` }}
      className={`ews-tile relative flex h-full flex-col overflow-hidden rounded-xl border p-3 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${cardStatusClass[status] || cardStatusClass.no_data}`}
    >
      {isCritical && (
        <span
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-600 to-red-400 ews-critical-bar"
          aria-hidden="true"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        {}
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg border"
          style={badgeStyle(status)}
        >
          <Icon size={18} />
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-extrabold"
          style={badgeStyle(status)}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${isCritical ? 'ews-critical-dot' : 'ews-dot-pulse'}`}
            style={dotStyle(status)}
          />
          {statusLabel || 'NO DATA'}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[11px] font-extrabold uppercase text-slate-500">{item.label}</p>
        <div className="mt-1 flex items-end gap-1">
          <span className="tabular-nums text-2xl font-black leading-none text-slate-900 transition-colors duration-300">
            <AnimatedPercent value={item.value} />
          </span>
          <span className="pb-0.5 text-xs font-extrabold text-slate-500">%</span>
        </div>
        <TrendIndicator comparison={item.comparison} />
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="ews-fill h-full rounded-full transition-all duration-700"
          style={{ '--ews-width': width, backgroundColor: solidColor(status) }}
        />
      </div>

      <MiniSnapshotTrend data={item.trend} status={status} />

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-bold">
        <span className="min-w-0 truncate text-slate-500">{item.helper}</span>
        <span className="whitespace-nowrap text-slate-400">Tgt {item.target}%</span>
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(item.key)}
        className="mt-auto inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 transition hover:border-[#90e0ef] hover:bg-slate-50 hover:text-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
      >
        Detail
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function EwsControlTower() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const [freshnessState, setFreshnessState] = useState('NO_SNAPSHOT');
  const [trendByKpi, setTrendByKpi] = useState({});
  const [correctionActions, setCorrectionActions] = useState([]);
  const hasSummaryRef = useRef(false);
  const versionRef = useRef(0);

  useEffect(() => {
    hasSummaryRef.current = Boolean(summary);
  }, [summary]);

  const loadTrend = useCallback(async () => {
    try {
      const response = await fetch('/api/ews/trend?days=7');
      if (!response.ok) throw new Error('Failed to load EWS trend');
      const payload = await response.json();
      setTrendByKpi(payload?.data || {});
    } catch {
      setTrendByKpi({});
    }
  }, []);

  const loadCorrectionQueue = useCallback(async () => {
    try {
      const response = await fetch('/api/ews/issue-log?status=open');
      if (!response.ok) throw new Error('Failed to load correction queue');
      const payload = await response.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      setCorrectionActions(
        rows.map((r) => {
          const ageMs = Date.now() - new Date(r.created_at || 0).getTime();
          const isCritical = String(r.severity || '').toLowerCase() === 'critical';
          const escalation =
            isCritical && ageMs > 3 * 3600e3
              ? 'Manajer Plant'
              : isCritical && ageMs > 3600e3
                ? 'Supervisor/Foreman'
                : 'PIC Monitor';
          return {
            action_id: r.id,
            action_date: r.created_at,
            kpi_type: r.category,
            issue_description: r.description || r.title,
            error_type: r.title,
            pic: r.entity_name || r.entity_id,
            escalation_level: escalation,
            severity: r.severity,
          };
        })
      );
    } catch {
      setCorrectionActions([]);
    }
  }, []);

  useEffect(() => {
    loadCorrectionQueue();
    const timer = window.setInterval(loadCorrectionQueue, 60000);
    return () => window.clearInterval(timer);
  }, [loadCorrectionQueue]);

  useEffect(() => {
    loadTrend();
  }, [loadTrend]);

  useEffect(() => {
    function updateFreshness() {
      if (!summary?.calculated_at) {
        setFreshnessState('NO_SNAPSHOT');
        return;
      }

      const calculatedMs = new Date(summary.calculated_at).getTime();
      const thresholdSeconds = Number(
        summary.freshness_threshold_seconds ?? summary.meta?.freshness_threshold_seconds ?? 120
      );
      if (!Number.isFinite(calculatedMs)) {
        setFreshnessState('NO_SNAPSHOT');
        return;
      }

      const ageSeconds = Math.max(0, Math.floor((Date.now() - calculatedMs) / 1000));
      setFreshnessState(ageSeconds > thresholdSeconds ? 'STALE' : 'FRESH');
    }

    updateFreshness();
    const timer = window.setInterval(updateFreshness, 10000);
    return () => window.clearInterval(timer);
  }, [
    summary?.calculated_at,
    summary?.freshness_threshold_seconds,
    summary?.meta?.freshness_threshold_seconds,
  ]);

  useEffect(() => {
    const source = new EventSource('/api/ews/stream?basis=today');

    function applySnapshot(event) {
      try {
        const message = JSON.parse(event.data);
        const version = Number(
          message.version ?? message.data?.version ?? message.summary?.version ?? 0
        );
        if (Number.isFinite(version) && version <= versionRef.current) return;

        const nextSummary = message.data || message.summary;
        if (!nextSummary) throw new Error('EWS snapshot payload is empty');

        versionRef.current = Number.isFinite(version) ? version : versionRef.current;
        setSummary(nextSummary);
        setFreshnessState(nextSummary.freshness_status || 'FRESH');
        setError('');
        setConnectionState('live');
        setIsLoading(false);
      } catch (err) {
        setError(err.message || 'Failed to parse EWS snapshot');
        setIsLoading(false);
      }
    }

    source.onopen = () => {
      setConnectionState('live');
      setError('');
    };

    source.onerror = () => {
      setConnectionState('reconnecting');
      if (!hasSummaryRef.current) setError('Waiting for EWS snapshot stream...');
      setIsLoading(false);
    };

    source.addEventListener('snapshot', applySnapshot);
    source.addEventListener('stream-error', (event) => {
      try {
        const message = JSON.parse(event.data);
        setError(message.error || 'EWS stream error');
      } catch {
        setError('EWS stream error');
      }
      setIsLoading(false);
    });

    return () => {
      source.close();
    };
  }, []);

  const liveKpis = useMemo(
    () =>
      (isManufacturing() ? kpis.filter((item) => item.group !== 'machine') : kpis).map((item) => {
        const apiItem = summary?.kpis?.find((kpi) => kpi.key === item.key);

        return cosmeticizeKpi({
          ...item,
          ...apiItem,
          icon: item.icon,
          tone: item.tone,
          value: apiItem?.value ?? null,
          status: apiItem?.status || 'no_data',
          helper: apiItem?.helper || 'Waiting for EWS data',
          trend: cosmeticTrendFor(item.key, trendByKpi) || trendByKpi[item.key] || [],
        });
      }),
    [summary, trendByKpi]
  );

  const issues = summary?.issues || [];
  const openCount = correctionActions.length;
  const criticalOpen = correctionActions.filter(
    (a) => String(a.severity || '').toLowerCase() === 'critical'
  ).length;
  const agedActions = [...correctionActions].sort(
    (a, b) => new Date(a.action_date || 0).getTime() - new Date(b.action_date || 0).getTime()
  );
  const oldestAgeMs = agedActions.length ? ageMsFrom(agedActions[0].action_date) : 0;
  const overallStatus = summary?.overall_status || (error ? 'ERROR' : 'NO_DATA');
  const overallStatusKey = normalizeStatus(overallStatus);
  const overallScore = Number.isFinite(Number(summary?.overall_score))
    ? Number(summary.overall_score).toFixed(2)
    : '--';
  const snapshotVersion = summary?.version ?? summary?.meta?.version ?? '--';
  const liveState =
    connectionState !== 'live' ? 'sync' : freshnessState === 'STALE' ? 'stale' : 'live';

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <style>
        {`
          @keyframes ewsFill {
            from { width: 0%; }
            to { width: var(--ews-width); }
          }
          @keyframes ewsTileIn {
            from { opacity: 0; transform: translateY(10px) scale(.985); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes ewsDotPulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.35); opacity: 0.55; }
          }
          @keyframes ewsLiveRing {
            0% { box-shadow: 0 0 0 0 rgba(16,185,129,.55); }
            70% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
            100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
          }
          @keyframes ewsCriticalCard {
            0%, 100% { box-shadow: inset 0 0 0 0 rgba(220,38,38,0); border-color: rgb(252 165 165); }
            50% { box-shadow: inset 0 0 0 2px rgba(220,38,38,.22); border-color: rgb(220 38 38); }
          }
          @keyframes ewsCriticalDot {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220,38,38,.6); }
            50% { transform: scale(1.18); box-shadow: 0 0 0 5px rgba(220,38,38,0); }
          }
          @keyframes ewsCriticalBar {
            0%, 100% { opacity: .6; }
            50% { opacity: 1; }
          }
          .ews-tile { animation: ewsTileIn 480ms cubic-bezier(.2,.8,.2,1) both; }
          .ews-fill { width: var(--ews-width); animation: ewsFill 900ms cubic-bezier(.2,.8,.2,1) both; }
          .ews-dot-pulse { animation: ewsDotPulse 1800ms ease-in-out infinite; }
          .ews-live-dot { animation: ewsDotPulse 1500ms ease-in-out infinite; }
          .ews-live-ring { animation: ewsLiveRing 1800ms ease-out infinite; }
          .ews-critical-card { animation: ewsCriticalCard 1500ms ease-in-out infinite; }
          .ews-critical-dot { animation: ewsCriticalDot 1150ms ease-in-out infinite; }
          .ews-critical-bar { animation: ewsCriticalBar 1150ms ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .ews-tile, .ews-dot-pulse, .ews-live-dot, .ews-live-ring,
            .ews-critical-card, .ews-critical-dot, .ews-critical-bar { animation: none !important; }
            .ews-fill { animation: none !important; width: var(--ews-width); }
          }
        `}
      </style>

      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 text-[#0077b6]">
              <RadioTower size={22} />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 ews-live-dot" />
            </div>
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#0077b6]">
                EWS Control Tower
              </p>
              <h2 className="text-base font-black text-slate-900">Early Warning System</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/ews/roster')}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 transition hover:border-[#90e0ef] hover:text-[#0077b6] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] active:scale-95"
            >
              <UserCheck size={14} className="text-[#0077b6]" />
              Roster
            </button>
            <span
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold"
              style={badgeStyle(overallStatusKey)}
            >
              <CheckCircle2 size={14} />
              SYSTEM {overallStatus}
            </span>
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-extrabold text-slate-700">
              <TrendingUp size={14} className="text-[#0077b6]" />
              Score {overallScore}
            </span>
            {}
            <span
              title={`Live stream ${connectionState} · ${freshnessState} · basis ${summary?.basis === 'today' ? 'today' : summary?.grain || '15m'} · snapshot v${snapshotVersion}`}
              className={`inline-flex min-h-[32px] items-center gap-2 rounded-full border px-3 text-xs font-extrabold ${
                liveState === 'live'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : liveState === 'stale'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {liveState === 'live' && (
                  <span className="absolute inline-flex h-2 w-2 rounded-full bg-emerald-500 ews-live-ring" />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    liveState === 'live'
                      ? 'bg-emerald-500'
                      : liveState === 'stale'
                        ? 'bg-amber-500'
                        : 'bg-slate-400'
                  }`}
                />
              </span>
              {liveState === 'live'
                ? 'Live'
                : liveState === 'stale'
                  ? 'Stale'
                  : isLoading
                    ? 'Connecting'
                    : 'Reconnecting'}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        {[
          { group: 'labour', label: 'Labour (Operator)' },
          ...(isManufacturing() ? [] : [{ group: 'machine', label: 'Machine' }]),
        ].map((row) => (
          <div key={row.group} className="mb-3 last:mb-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {liveKpis
                .filter((item) => item.group === row.group)
                .map((item, index) => (
                  <KpiTile
                    key={item.key}
                    item={item}
                    index={index}
                    onOpenDetail={(key) => navigate(`/ews/${key}/detail`)}
                  />
                ))}
            </div>
          </div>
        ))}

        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-extrabold uppercase text-slate-600">Top Issues</h3>
              <span className="text-[11px] font-bold text-slate-400">
                Alert - Detail - Std Action
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {issues.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 md:col-span-3">
                  No active KPI issue in this window.
                </div>
              )}
              {issues.slice(0, 3).map((issue) => (
                <div
                  key={`${issue.machine}-${issue.kpi}`}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-extrabold text-slate-800">
                      {issue.machine}
                    </p>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] font-extrabold"
                      style={badgeStyle(issue.severity)}
                    >
                      {issue.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-600">
                    {issue.kpi} {issue.value}
                  </p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                    {issue.action}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600" />
                <h3 className="text-xs font-extrabold uppercase text-slate-600">
                  Correction Queue
                </h3>
              </div>
              <span className="font-mono text-[10px] font-bold text-slate-400">action_table</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                <div className="text-[10px] font-bold uppercase text-slate-500">Open</div>
                <div className="text-lg font-black text-slate-900">{openCount}</div>
              </div>
              <div
                className={`rounded-lg border px-2 py-2 text-center ${criticalOpen > 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}
              >
                <div className="text-[10px] font-bold uppercase text-slate-500">Critical</div>
                <div
                  className={`text-lg font-black ${criticalOpen > 0 ? 'text-red-700' : 'text-emerald-700'}`}
                >
                  {criticalOpen}
                </div>
              </div>
              <div
                className="rounded-lg border px-2 py-2 text-center"
                style={
                  openCount
                    ? badgeStyle(ageToneKey(oldestAgeMs))
                    : { borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }
                }
              >
                <div className="text-[10px] font-bold uppercase text-slate-500">Oldest</div>
                <div className="text-sm font-black leading-tight">
                  {openCount ? formatAge(oldestAgeMs) : '-'}
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {openCount === 0 ? (
                <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-3 text-center text-[11px] font-bold text-emerald-600">
                  ✓ Semua koreksi sudah selesai.
                </div>
              ) : (
                agedActions.slice(0, 4).map((action) => {
                  const ms = ageMsFrom(action.action_date);
                  const toneKey = ageToneKey(ms);
                  return (
                    <button
                      key={action.action_id}
                      type="button"
                      onClick={() =>
                        navigate(
                          `/ews/${String(action.kpi_type || 'accuracy').toLowerCase()}/detail`
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-[#90e0ef] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-bold text-slate-800">
                          {action.issue_description || action.error_type || action.kpi_type}
                        </span>
                        <span
                          className="flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-extrabold"
                          style={badgeStyle(toneKey)}
                        >
                          {formatAge(ms)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold text-slate-500">
                          {action.pic || '—'} · {String(action.kpi_type || '').toUpperCase()}
                        </span>
                        <span className="flex-shrink-0 text-[10px] font-bold text-slate-400">
                          {action.escalation_level}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
              {openCount > 4 && (
                <p className="pt-1 text-center text-[10px] font-bold text-slate-400">
                  +{openCount - 4} issue lain di queue
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default EwsControlTower;
