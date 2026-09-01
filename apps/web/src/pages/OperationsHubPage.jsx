import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BarChart2,
  CheckCircle2,
  ClipboardList,
  Factory,
  Loader2,
  LogOut,
  Settings,
  Square,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import sapLogo from '../assets/sap.svg';
import EwsControlTower from '../components/ews/EwsControlTower';
import { usePermissions, routeToFeature, getRole, authHeaders } from '../rbac';
import { sidebarItems, getHiddenHubMenus } from '../config/hubSidebarItems';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SAP_LINKS = {
  PH3: 'https://fiori.abm-investama.co.id/',
  QH3: 'https://fioriqa-rise.abm-investama.co.id:44380/fiori',
};
const SAP_ENV_STORAGE_KEY = 'operationsHubSapEnv';

const emptyHubData = {
  kpi: {
    total_orders: 0,
    active_orders: 0,
    teco_orders: 0,
    ongoing_orders: 0,
    not_started_orders: 0,
    latest_labor_hours: 0,
    latest_machine_hours: 0,
    avg_progress: 0,
    validation_pending: 0,
    validation_total: 0,
    machine_productive_pct: 0,
  },
  basis_dates: {
    machine_date: null,
    labor_date: null,
  },
  machine_trend: [],
  machine_status: [],
  progress_status: [],
  sap_posting: {},
  labor_by_workcenter: [],
  top_operators: [],
};

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number);
}

function toNum(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatDateLabel(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTodayClock(value) {
  return value.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function readSapEnv() {
  try {
    const savedEnv = localStorage.getItem(SAP_ENV_STORAGE_KEY);
    return savedEnv === 'QH3' ? 'QH3' : 'PH3';
  } catch {
    return 'PH3';
  }
}

function DashboardCard({ children, className = '', style }) {
  return (
    <section
      style={style}
      className={`rounded-lg border border-slate-300 bg-white shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0);
  const valueRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const to = Number(target) || 0;
    if (!Number.isFinite(to)) return;
    const from = valueRef.current;
    if (from === to) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = reduceMotion ? to : from + (to - from) * eased;
      valueRef.current = current;
      setDisplay(current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

function StatCard({
  title,
  value,
  suffix = '',
  helper,
  icon,
  tone,
  accent = '#0096c7',
  delta,
  deltaLabel = '',
  index = 0,
  progress = null,
  chips = [],
}) {
  const IconComponent = icon;
  const hasDelta = Number.isFinite(Number(delta));
  const up = Number(delta) > 0;
  const flat = Number(delta) === 0;
  const animated = useCountUp(value);
  const barPct = progress != null ? Math.min(100, Math.max(0, Number(progress))) : null;

  return (
    <DashboardCard
      className="hub-card group relative overflow-hidden p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-200/60"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {}
      <span
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}22)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <p className="text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-slate-950">
              {formatNumber(animated)}
              {suffix}
            </p>
            {}
            {chips.length > 0 && (
              <div className="flex flex-col items-start gap-1">
                {chips.map((chip) => (
                  <span
                    key={chip.label}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${chip.tone}`}
                  >
                    <span className="tabular-nums">{formatNumber(chip.value)}</span>
                    <span className="font-bold opacity-80">{chip.label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${tone} transition-transform duration-300 group-hover:scale-110`}
        >
          {React.createElement(IconComponent, { size: 18 })}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {hasDelta && (
          <span
            className={`inline-flex flex-shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${
              flat
                ? 'bg-slate-100 text-slate-500'
                : up
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-600'
            }`}
          >
            {flat ? '■' : up ? '▲' : '▼'} {up ? '+' : ''}
            {Number(delta).toFixed(1)}
            {deltaLabel}
          </span>
        )}
        <p className="min-w-0 truncate text-xs font-medium text-slate-500">{helper}</p>
      </div>
      {barPct != null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="hub-bar h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${barPct}%`,
              background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
            }}
          />
        </div>
      )}
    </DashboardCard>
  );
}

function InsightStrip({ items }) {
  if (!items.length) return null;
  const toneMap = {
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {items.map((item, index) => {
        const Ico = item.tone === 'emerald' ? CheckCircle2 : AlertCircle;
        return (
          <div
            key={item.text}
            style={{ animationDelay: `${index * 60}ms` }}
            className={`hub-card flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold ${toneMap[item.tone] || toneMap.emerald}`}
          >
            <Ico size={15} className="mt-0.5 flex-shrink-0" />
            <span className="leading-snug">{item.text}</span>
          </div>
        );
      })}
    </section>
  );
}

function Sidebar({ onNavigate }) {
  const { canRead } = usePermissions();

  const [hiddenMenus, setHiddenMenus] = useState(() => getHiddenHubMenus());
  useEffect(() => {
    const sync = () => setHiddenMenus(getHiddenHubMenus());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const items = sidebarItems.filter((item) => {
    const feature = routeToFeature(item.path);
    return (!feature || canRead(feature)) && !hiddenMenus.includes(item.path);
  });

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const key = item.group || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [items]);
  return (
    <aside className="border-b border-slate-300 bg-white lg:sticky lg:top-0 lg:h-dvh lg:w-[clamp(180px,16vw,244px)] lg:flex-shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-slate-200 px-4 py-3 lg:px-3 lg:py-2">
          <button
            type="button"
            onClick={() => onNavigate('/operations-hub')}
            className="flex w-full items-center gap-3 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-[#00b4d8] lg:gap-2"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#0096c7] text-white shadow-sm lg:h-8 lg:w-8">
              <Factory size={18} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-slate-900 lg:text-xs">MPS</p>
              <p className="truncate text-xs font-medium text-slate-500 lg:text-[10px]">
                Operations
              </p>
            </div>
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3 lg:min-h-0 lg:space-y-0.5 lg:overflow-y-auto lg:px-2 lg:py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [@media(max-height:720px)]:py-1">
          {groups.map(([group, groupItems], groupIndex) => (
            <div key={group} className={groupIndex === 0 ? '' : 'border-t border-slate-200'}>
              <p className="px-2 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-widest text-slate-400 lg:px-2 lg:pt-2">
                {group}
              </p>
              {groupItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className="flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] lg:min-h-[34px] lg:gap-2 lg:px-2 lg:py-1 lg:text-xs [@media(max-height:720px)]:min-h-[30px] [@media(max-height:720px)]:py-0.5"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-[#0077b6] lg:h-7 lg:w-7 [@media(max-height:720px)]:h-6 [@media(max-height:720px)]:w-6">
                    <item.icon className="h-[18px] w-[18px] lg:h-4 lg:w-4" />
                  </span>
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

function ChangePasswordPanel({ user, onClose }) {
  const [form, setForm] = useState({
    oldPassword: '',
    newPassword: '',
    retypeNewPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const canConfirm = Boolean(
    user?.username &&
      form.oldPassword &&
      form.newPassword &&
      form.retypeNewPassword &&
      form.newPassword === form.retypeNewPassword &&
      form.newPassword.length >= 5
  );

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canConfirm || loading) return;

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          oldPassword: form.oldPassword,
          newPassword: form.newPassword,
          retypeNewPassword: form.retypeNewPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to change password');
      }

      setForm({ oldPassword: '', newPassword: '', retypeNewPassword: '' });
      setMessage({ type: 'success', text: 'Password changed successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close change password panel"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f7fb] text-[#0077b6]">
              <Settings size={22} />
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-slate-950">Change Password</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Confirm your old password before saving a new one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Username</p>
            <p className="mt-1 truncate text-sm font-extrabold text-slate-900">
              {user?.username || '-'}
            </p>
          </div>

          {!user?.username && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Log in through the welcome page to change the password.
            </div>
          )}

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Old Password
            </span>
            <input
              type="password"
              value={form.oldPassword}
              onChange={(event) => updateField('oldPassword', event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
              autoComplete="current-password"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
              New Password
            </span>
            <input
              type="password"
              value={form.newPassword}
              onChange={(event) => updateField('newPassword', event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
              autoComplete="new-password"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Retype New Password
            </span>
            <input
              type="password"
              value={form.retypeNewPassword}
              onChange={(event) => updateField('retypeNewPassword', event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#00b4d8] focus:ring-4 focus:ring-cyan-100"
              autoComplete="new-password"
            />
          </label>

          {form.retypeNewPassword && form.newPassword !== form.retypeNewPassword && (
            <p className="text-xs font-bold text-red-600">Retype new password does not match.</p>
          )}

          {message && (
            <div
              className={`flex gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
                message.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!canConfirm || loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0077b6] px-4 text-sm font-extrabold text-white transition hover:bg-[#023e8a] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Confirm
          </button>
        </form>
      </aside>
    </div>
  );
}

const UTIL_COLORS = ['#0096c7', '#48cae4', '#f59e0b', '#94a3b8', '#e24b4a', '#7c3aed'];

function InfoTile({ label, value, sub, tone = 'neutral' }) {
  const map = {
    good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bad: 'bg-red-50 text-red-700 border-red-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    neutral: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${map[tone] || map.neutral}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-black leading-none">{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] font-semibold opacity-70">{sub}</div> : null}
    </div>
  );
}

function BarList({
  items,
  valueOf,
  labelOf,
  subOf,
  valueFmt,
  color = '#0096c7',
  empty = 'No data',
}) {
  if (!items?.length) {
    return <p className="py-8 text-center text-sm font-semibold text-slate-400">{empty}</p>;
  }
  const max = Math.max(...items.map((i) => toNum(valueOf(i))), 1);
  return (
    <ul className="space-y-3">
      {items.map((item, idx) => {
        const raw = toNum(valueOf(item));
        const w = Math.max(3, (raw / max) * 100);
        const fill = typeof color === 'function' ? color(item) : color;
        return (
          <li key={idx}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold text-slate-700">{labelOf(item)}</span>
              <span className="flex-shrink-0 text-xs font-extrabold text-slate-800">
                {valueFmt ? valueFmt(item) : formatNumber(raw)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${w}%`, background: fill }} />
            </div>
            {subOf ? (
              <div className="mt-0.5 text-[10px] font-semibold text-slate-500">{subOf(item)}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MachineActivityChart({ data }) {
  const rows = Array.isArray(data) ? data : [];
  const pctSeries = rows
    .map((r) => toNum(r.productive_pct))
    .filter((v) => Number.isFinite(v) && v > 0);
  const avgPct = pctSeries.length ? pctSeries.reduce((a, b) => a + b, 0) / pctSeries.length : null;
  const todayPct = rows.length ? toNum(rows[rows.length - 1].productive_pct) : null;
  const delta = avgPct != null && todayPct != null ? todayPct - avgPct : null;

  return (
    <DashboardCard className="hub-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">Machine Activity</h2>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
            Productive vs support/loss · last 7 days
            {todayPct != null && (
              <>
                {' · today '}
                <span className="font-bold text-slate-700">{todayPct.toFixed(0)}%</span>
                {delta != null && (
                  <span className={delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                    {' '}
                    ({delta >= 0 ? '+' : ''}
                    {delta.toFixed(1)} pt)
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
          7 days
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm font-semibold text-slate-400">
          No machine activity data
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} margin={{ top: 12, right: 6, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="hubProd" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0096c7" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#0096c7" stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id="hubSup" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${v}h`}
              width={42}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
              width={40}
            />
            <Tooltip
              formatter={(value, name) =>
                name === 'productive_pct'
                  ? [`${formatNumber(value)}%`, 'Productive %']
                  : [
                      `${formatNumber(value)}h`,
                      name === 'productive_hours' ? 'Productive' : 'Support/loss',
                    ]
              }
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="productive_hours"
              stackId="1"
              stroke="#0096c7"
              strokeWidth={2}
              fill="url(#hubProd)"
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="support_loss_hours"
              stackId="1"
              stroke="#94a3b8"
              strokeWidth={1.5}
              fill="url(#hubSup)"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="productive_pct"
              stroke="#059669"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#0096c7]" />
          Productive
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          Support / loss
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
          Productive %
        </span>
      </div>
    </DashboardCard>
  );
}

function MachineUtilization({ statuses, productivePct }) {
  const rows = (Array.isArray(statuses) ? statuses : [])
    .filter((s) => toNum(s.hours) > 0)
    .slice(0, 6)
    .map((s, i) => ({
      name: s.status,
      hours: toNum(s.hours),
      fill: UTIL_COLORS[i % UTIL_COLORS.length],
    }));

  return (
    <DashboardCard className="hub-card flex h-full flex-col p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Machine Utilization</h2>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">
        Jam per status · hari operasi terakhir
      </p>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm font-semibold text-slate-400">No status data</p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <div className="relative h-[136px] w-[136px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="hours"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={64}
                  paddingAngle={2}
                >
                  {rows.map((r) => (
                    <Cell key={r.name} fill={r.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${formatNumber(v)}h`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black text-slate-900">
                {formatNumber(productivePct)}%
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                productive
              </span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {rows.map((r) => (
              <li key={r.name} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: r.fill }}
                  />
                  <span className="truncate text-xs font-semibold text-slate-600">{r.name}</span>
                </span>
                <span className="flex-shrink-0 text-xs font-bold text-slate-800">
                  {formatNumber(r.hours)}h
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}

function LaborByWorkcenter({ items }) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((r) => toNum(r.total_hours) > 0)
    .slice(0, 8);
  const max = Math.max(...rows.map((r) => toNum(r.total_hours)), 1);

  return (
    <DashboardCard className="hub-card p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Labor by Workcenter</h2>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">Actual hours · last 24h</p>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm font-semibold text-slate-400">No labor data</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r, idx) => {
            const total = toNum(r.total_hours);
            const prod = toNum(r.productive_hours);
            const w = Math.max(3, (total / max) * 100);
            const prodPct = total > 0 ? (prod / total) * 100 : 0;
            return (
              <li key={idx}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-slate-700">
                    {r.workcenter_name || r.workcenter}
                  </span>
                  <span className="flex-shrink-0 text-xs font-extrabold text-slate-800">
                    {formatNumber(total)}h
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="flex h-full" style={{ width: `${w}%` }}>
                    <div
                      className="h-full"
                      style={{ width: `${prodPct}%`, background: '#059669' }}
                    />
                    <div
                      className="h-full"
                      style={{ width: `${100 - prodPct}%`, background: '#0096c7' }}
                    />
                  </div>
                </div>
                <div className="mt-0.5 text-[10px] font-semibold text-slate-500">
                  produktif {formatNumber(prod)}h ({formatNumber(prodPct)}%)
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex gap-4 text-[11px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
          Produktif
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#0096c7]" />
          Support / idle
        </span>
      </div>
    </DashboardCard>
  );
}

function TopOperators({ items }) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((r) => toNum(r.total_hours) > 0)
    .slice(0, 8);
  return (
    <DashboardCard className="hub-card p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Top Operators</h2>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">Productive hours · last 24h</p>
      <div className="mt-4">
        <BarList
          items={rows}
          valueOf={(r) => toNum(r.productive_hours)}
          labelOf={(r) => r.name}
          valueFmt={(r) => `${formatNumber(r.productive_hours)}h`}
          subOf={(r) => `of ${formatNumber(r.total_hours)}h recorded`}
          color="#059669"
          empty="No operator data"
        />
      </div>
    </DashboardCard>
  );
}

function WorkcenterWorkload({ items }) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((r) => toNum(r.plan_hours) > 0)
    .slice(0, 8);
  return (
    <DashboardCard className="hub-card p-5">
      <h2 className="text-sm font-extrabold text-slate-900">Workcenter Workload</h2>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">
        Plan hours & operasi terbuka · SOW aktif
      </p>
      <div className="mt-4">
        <BarList
          items={rows}
          valueOf={(r) => toNum(r.plan_hours)}
          labelOf={(r) => r.label}
          valueFmt={(r) => `${formatNumber(r.plan_hours)}h`}
          subOf={(r) =>
            `${formatNumber(r.operation_count)} operasi · ${formatNumber(r.value)}% avg progress`
          }
          color="#0077b6"
          empty="No workload data"
        />
      </div>
    </DashboardCard>
  );
}

function SapPostingHealth({ data }) {
  const d = data || {};
  const staged = toNum(d.staged_7d);
  const posted = toNum(d.posted_7d);
  const failed = toNum(d.failed);
  const pending = toNum(d.pending);
  const postedRate = staged > 0 ? (posted / staged) * 100 : 0;

  return (
    <DashboardCard className="hub-card flex h-full flex-col p-5">
      <div className="flex items-center gap-2">
        <img src={sapLogo} alt="" className="h-4 w-auto" aria-hidden="true" />
        <h2 className="text-sm font-extrabold text-slate-900">SAP Posting Health</h2>
      </div>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">
        Outbound timesheet → SAP · last 7 days
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <InfoTile label="Posted 7d" value={formatNumber(posted)} tone="good" />
        <InfoTile label="Failed" value={formatNumber(failed)} tone={failed > 0 ? 'bad' : 'good'} />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-slate-500">
          <span>Posted rate (7d)</span>
          <span>{formatNumber(postedRate)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${Math.min(100, postedRate)}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] font-semibold text-slate-400">
          {formatNumber(posted)} of {formatNumber(staged)} staged
        </div>
      </div>

      <div className="mt-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
          Pending backlog
        </div>
        <div className="text-2xl font-black leading-none text-amber-700">
          {formatNumber(pending)}
        </div>
        <div className="mt-0.5 text-[10px] font-semibold text-amber-600/80">
          waiting to be posted to SAP
        </div>
      </div>
    </DashboardCard>
  );
}

function OperationsHubPage() {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState(
    () => sessionStorage.getItem('isVerified') === 'true'
  );
  const [hubData, setHubData] = useState(emptyHubData);
  const [authUser, setAuthUser] = useState(readAuthUser);
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [sapEnv, setSapEnv] = useState(readSapEnv);
  const [kpiStatus, setKpiStatus] = useState(() =>
    sessionStorage.getItem('isVerified') === 'true' ? 'loading' : 'idle'
  );
  const isAdmin = useMemo(() => getRole() === 'administrator', []);
  const [announcements, setAnnouncements] = useState([]);
  const [announcing, setAnnouncing] = useState(false);
  const ttsAudioRef = useRef(null);
  const ttsStopRef = useRef(false);

  useEffect(() => {
    if (!isVerified) {
      navigate('/welcome?login=admin', { replace: true });
    }
  }, [isVerified, navigate]);

  useEffect(() => {
    if (!isVerified) return undefined;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isVerified]);

  useEffect(() => {
    try {
      localStorage.setItem(SAP_ENV_STORAGE_KEY, sapEnv);
    } catch {}
  }, [sapEnv]);

  useEffect(() => {
    if (!isVerified) return;

    const controller = new AbortController();

    fetch(`${API_BASE}/dashboard/operations-hub`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load dashboard');
        return response.json();
      })
      .then((payload) => {
        setHubData({ ...emptyHubData, ...(payload?.data || {}) });
        setKpiStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setHubData(emptyHubData);
        setKpiStatus('error');
      });

    return () => controller.abort();
  }, [isVerified]);

  useEffect(() => {
    if (!isVerified || !isAdmin) return undefined;
    let alive = true;
    const load = () => {
      fetch(`${API_BASE}/ews/tts/playlist`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((j) => {
          if (alive) setAnnouncements(Array.isArray(j.data) ? j.data : []);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isVerified, isAdmin]);

  useEffect(
    () => () => {
      ttsStopRef.current = true;
      const a = ttsAudioRef.current;
      if (a) {
        try {
          a.pause();
        } catch {}
      }
    },
    []
  );

  const kpi = hubData.kpi;

  const machineAvgPct = useMemo(() => {
    const series = (hubData.machine_trend || [])
      .map((item) => toNum(item.productive_pct))
      .filter((value) => Number.isFinite(value) && value > 0);
    return series.length ? series.reduce((a, b) => a + b, 0) / series.length : null;
  }, [hubData.machine_trend]);

  const productiveDelta =
    machineAvgPct != null ? toNum(kpi.machine_productive_pct) - machineAvgPct : null;
  const totalOrders = toNum(kpi.total_orders);
  const activePct = totalOrders > 0 ? (toNum(kpi.active_orders) / totalOrders) * 100 : 0;
  const tecoPct = totalOrders > 0 ? (toNum(kpi.teco_orders) / totalOrders) * 100 : 0;

  const summaryCards = useMemo(
    () => [
      {
        title: 'Active Orders',
        value: toNum(kpi.active_orders),
        helper: `of ${formatNumber(kpi.total_orders)} total orders`,
        icon: Factory,
        tone: 'bg-sky-50 text-sky-700',
        accent: '#0096c7',
        progress: activePct,

        chips: [
          {
            label: 'on going',
            value: toNum(kpi.ongoing_orders),
            tone: 'bg-emerald-50 text-emerald-700',
          },
          {
            label: 'not started',
            value: toNum(kpi.not_started_orders),
            tone: 'bg-slate-100 text-slate-500',
          },
        ],
      },
      {
        title: 'TECO Orders',
        value: toNum(kpi.teco_orders),
        helper: `of ${formatNumber(kpi.total_orders)} total orders`,
        icon: CheckCircle2,
        tone: 'bg-emerald-50 text-emerald-700',
        accent: '#059669',
        progress: tecoPct,
      },
      {
        title: 'Machine Productive',
        value: toNum(kpi.machine_productive_pct),
        suffix: '%',
        helper:
          machineAvgPct != null
            ? `7d avg ${machineAvgPct.toFixed(1)}%`
            : hubData.basis_dates.machine_date
              ? formatDateLabel(hubData.basis_dates.machine_date)
              : 'No date',
        icon: BarChart2,
        tone: 'bg-indigo-50 text-indigo-700',
        accent: '#4f46e5',
        delta: productiveDelta,
        deltaLabel: 'pt',
      },
      {
        title: 'Validation Pending',
        value: toNum(kpi.validation_pending),
        helper: `of ${formatNumber(kpi.validation_total)} records today`,
        icon: ClipboardList,
        tone:
          toNum(kpi.validation_pending) > 0
            ? 'bg-amber-50 text-amber-700'
            : 'bg-emerald-50 text-emerald-700',
        accent: toNum(kpi.validation_pending) > 0 ? '#d97706' : '#059669',
        progress:
          toNum(kpi.validation_total) > 0
            ? (toNum(kpi.validation_pending) / toNum(kpi.validation_total)) * 100
            : 0,
      },
    ],
    [hubData.basis_dates.machine_date, kpi, machineAvgPct, productiveDelta, activePct, tecoPct]
  );

  const insights = useMemo(() => {
    const list = [];
    if (productiveDelta != null && productiveDelta <= -2) {
      list.push({
        tone: 'amber',
        text: `Machine productive ${formatNumber(kpi.machine_productive_pct)}% below the 7-day average (${machineAvgPct.toFixed(1)}%).`,
      });
    }
    if (toNum(kpi.validation_pending) > 0) {
      list.push({
        tone: 'amber',
        text: `${formatNumber(kpi.validation_pending)} records today awaiting foreman/supervisor validation.`,
      });
    }
    return list.slice(0, 3);
  }, [kpi, machineAvgPct, productiveDelta]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('isVerified');
    sessionStorage.removeItem('authUser');
    setAuthUser(null);
    setShowPasswordPanel(false);
    setIsVerified(false);
    setKpiStatus('idle');
  }, []);

  const handleViewOrderProgress = useCallback(() => {
    navigate('/order-progress-dashboard');
  }, [navigate]);

  const handleOpenSap = useCallback(() => {
    window.open(SAP_LINKS[sapEnv], '_blank', 'noopener,noreferrer');
  }, [sapEnv]);

  const handleToggleSapEnv = useCallback(() => {
    setSapEnv((current) => (current === 'PH3' ? 'QH3' : 'PH3'));
  }, []);

  const handleToggleAnnouncements = useCallback(() => {
    const audio = ttsAudioRef.current;
    if (!audio) return;
    if (announcing) {
      ttsStopRef.current = true;
      try {
        audio.pause();
      } catch {}
      setAnnouncing(false);
      return;
    }
    const list = announcements.filter((x) => x && x.path_mp3);
    if (list.length === 0) {
      toast('No audio announcement for today');
      return;
    }
    ttsStopRef.current = false;
    setAnnouncing(true);
    toast(`Playing ${list.length} EWS announcement(s)`);
    const playAt = (idx) => {
      if (ttsStopRef.current || idx >= list.length) {
        setAnnouncing(false);
        return;
      }
      audio.src = list[idx].path_mp3;
      audio.onended = () => playAt(idx + 1);
      audio.onerror = () => playAt(idx + 1);
      audio.play().catch(() => {
        setAnnouncing(false);
        toast.error('Browser memblokir audio — klik tombol sekali lagi');
      });
    };
    playAt(0);
  }, [announcing, announcements]);

  const statusLabel =
    kpiStatus === 'ready' ? 'Live' : kpiStatus === 'error' ? 'Offline' : 'Loading';

  if (!isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">
        Mengarahkan ke login...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800 lg:flex">
      <Sidebar onNavigate={navigate} />

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-slate-300 bg-white/90 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-3 md:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-xl font-extrabold text-slate-950">Operations Hub</h1>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                {formatTodayClock(currentTime)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenSap}
                className="flex h-[34px] w-[52px] items-center justify-center rounded-md border border-slate-200 bg-white transition hover:bg-slate-50"
                title={`Open SAP ${sapEnv}`}
                aria-label={`Open SAP ${sapEnv}`}
              >
                <img src={sapLogo} alt="" className="h-4 w-auto" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleToggleSapEnv}
                role="switch"
                aria-checked={sapEnv === 'QH3'}
                aria-label={`Switch SAP environment, current ${sapEnv}`}
                title={`Current SAP ${sapEnv}. Click to switch to ${sapEnv === 'PH3' ? 'QH3' : 'PH3'}`}
                className={`relative flex h-[34px] w-[84px] items-center rounded-full border px-3 text-[11px] font-extrabold transition ${
                  sapEnv === 'PH3'
                    ? 'border-cyan-200 bg-cyan-50 text-[#0077b6]'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-2 top-1/2 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
                    sapEnv === 'PH3'
                      ? '-translate-y-1/2 translate-x-0'
                      : '-translate-y-1/2 translate-x-[50px]'
                  }`}
                />
                <span className="relative z-10 w-full text-center">{sapEnv}</span>
              </button>
              <span
                className={`rounded-md border px-2.5 py-2 text-xs font-bold ${
                  kpiStatus === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                {statusLabel}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleToggleAnnouncements}
                  className={`flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold text-white transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
                    announcing ? 'bg-red-600 hover:bg-red-500' : 'bg-[#0077b6] hover:bg-[#023e8a]'
                  }`}
                  title={
                    announcing
                      ? 'Stop announcements'
                      : 'Play EWS announcements (audio issue log for today)'
                  }
                >
                  {announcing ? <Square size={15} /> : <Volume2 size={15} />}
                  {announcing ? 'Stop' : 'Announce'}
                  {!announcing && announcements.length > 0 && (
                    <span className="rounded-full bg-white/25 px-1.5 text-[10px] tabular-nums">
                      {announcements.length}
                    </span>
                  )}
                </button>
              )}
              <span className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f7fb] text-[#0077b6]">
                  <Users size={14} />
                </span>
                {authUser?.username || 'admin'}
              </span>
              <button
                type="button"
                onClick={() => setShowPasswordPanel(true)}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#90e0ef] hover:bg-cyan-50 hover:text-[#0077b6]"
                title="Change password"
                aria-label="Change password"
              >
                <Settings size={16} />
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-extrabold text-red-600 shadow-sm transition hover:bg-red-50"
                title="Log out"
              >
                <LogOut size={15} /> Log Out
              </button>
            </div>
          </div>
        </header>

        {showPasswordPanel && (
          <ChangePasswordPanel user={authUser} onClose={() => setShowPasswordPanel(false)} />
        )}

        <style>
          {`
            @keyframes hubIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            .hub-card { animation: hubIn 460ms cubic-bezier(.2,.8,.2,1) both; }
            .hub-bar { transition: height .6s cubic-bezier(.2,.8,.2,1); }
            @media (prefers-reduced-motion: reduce) {
              .hub-card { animation: none !important; }
              .hub-bar { transition: none !important; }
            }
          `}
        </style>

        <div className="space-y-4 px-4 py-4 md:px-6">
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {summaryCards.map((card, index) => (
              <StatCard key={card.title} index={index} {...card} />
            ))}
          </section>

          <InsightStrip items={insights} />

          <EwsControlTower />

          <DashboardCard className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Order Progress</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Avg progress {formatNumber(kpi.avg_progress)}% · {formatNumber(kpi.active_orders)}{' '}
                active · {formatNumber(kpi.teco_orders)} teco
              </p>
            </div>
            <button
              type="button"
              onClick={handleViewOrderProgress}
              className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 text-xs font-extrabold text-white transition hover:bg-[#0077b6]"
            >
              <BarChart2 size={16} />
              Open Progress
            </button>
          </DashboardCard>

          {}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <MachineActivityChart data={hubData.machine_trend} />
            </div>
            <div className="xl:col-span-4">
              <MachineUtilization
                statuses={hubData.machine_status}
                productivePct={kpi.machine_productive_pct}
              />
            </div>
          </section>

          {}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <LaborByWorkcenter items={hubData.labor_by_workcenter} />
            <TopOperators items={hubData.top_operators} />
          </section>

          {}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <WorkcenterWorkload items={hubData.progress_status} />
            </div>
            <div className="xl:col-span-4">
              <SapPostingHealth data={hubData.sap_posting} />
            </div>
          </section>
        </div>

        {}
        <audio ref={ttsAudioRef} preload="none" />
      </main>
    </div>
  );
}

export default OperationsHubPage;
