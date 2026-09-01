import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Loader2,
  RefreshCw, Search, Settings, Trash2, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const STATUS_OPTIONS = ['SCHEDULED', 'LEAVE', 'SICK', 'PERMIT', 'OFF'];
const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EXCUSED = ['LEAVE', 'SICK', 'PERMIT', 'OFF'];

const EXCUSED_STYLE = {
  LEAVE: 'bg-sky-200',
  SICK: 'bg-purple-200',
  PERMIT: 'bg-indigo-200',
  OFF: 'bg-slate-300',
};

function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function daysOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1, i + 1);
    const off = d.getTimezoneOffset() * 60000;
    const iso = new Date(d.getTime() - off).toISOString().slice(0, 10);
    return { date: iso, day: i + 1, dow: d.getDay() };
  });
}

function cellKey(sn, date) {
  return `${sn}|${date}`;
}

function CellColor({ row, recorded, required }) {
  if (!row) return { bg: 'bg-slate-100', note: 'No schedule' };
  if (EXCUSED.includes(row.status)) return { bg: EXCUSED_STYLE[row.status], note: row.status };
  if (row.attendance === 'PRESENT') {
    const ratio = required > 0 ? recorded / required : 1;
    if (ratio >= 1) return { bg: 'bg-emerald-400/80', note: `Present ${recorded.toFixed(1)}/${required.toFixed(0)}h` };
    if (ratio >= 0.5) return { bg: 'bg-lime-300/90', note: `Partial ${recorded.toFixed(1)}/${required.toFixed(0)}h` };
    return { bg: 'bg-red-300/80', note: `Low ${recorded.toFixed(1)}/${required.toFixed(0)}h` };
  }
  if (row.attendance === 'ABSENT') return { bg: 'bg-red-200', note: 'Absent' };
  if (row.attendance === 'IN_PROGRESS') return { bg: 'bg-amber-100', note: 'In progress' };
  return { bg: 'bg-slate-200', note: row.status };
}

function StatTile({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
    good: { bg: '#f0fdf4', border: '#bbf7d0', text: '#047857' },
    bad: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
    info: { bg: '#caf0f8', border: '#90e0ef', text: '#0077b6' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div className="rounded-xl border px-3 py-2.5 text-center shadow-sm" style={{ background: t.bg, borderColor: t.border }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: t.text }}>{label}</div>
      <div className="mt-1 text-lg font-black leading-none" style={{ color: t.text }}>{value}</div>
    </div>
  );
}

function BulkPanel({ selectedKeys, rowsByKey, onClose, onApply, onDeleteDay, onClear }) {
  const [status, setStatus] = useState('');
  const [half, setHalf] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const single = selectedKeys.length === 1 ? rowsByKey[selectedKeys[0]] : null;

  const doApply = async () => {
    if (!status && half === '') return;
    const keys = selectedKeys;
    const serialnumbers = [...new Set(keys.map((k) => k.split('|')[0]))];
    const businessDates = [...new Set(keys.map((k) => k.split('|')[1]))];
    setBusy(true);
    try {
      await onApply({ serialnumbers, business_dates: businessDates, status: status || undefined, half_day: half === '' ? undefined : half === 'half' });
      setStatus('');
      setHalf('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col border-l border-slate-300 bg-white md:w-80">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-extrabold text-slate-900">
          {single ? 'Operator detail' : `${selectedKeys.length} selected`}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={onClear} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 px-1.5 py-1" title="Clear selection">Clear</button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X size={15} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {single ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-extrabold text-slate-800">{single.operator_name || single.serialnumber}</div>
              <div className="font-mono text-[11px] text-slate-400">{single.serialnumber} · {single.business_date}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${single.scheduled_shift === 'DAY' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                {single.scheduled_shift}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{single.attendance}</span>
              {single.half_day && <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">½ half day</span>}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Hours <b className="tabular-nums">{Number(single.recorded_hours || 0).toFixed(1)}</b> / <b className="tabular-nums">{Number(single.scheduled_standard_hours || 0).toFixed(0)}h</b> required
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Status</label>
              <select
                value={single.status}
                onChange={(e) => onApply({ serialnumbers: [single.serialnumber], business_dates: [single.business_date], status: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Half day</label>
              <button
                type="button"
                onClick={() => onApply({ serialnumbers: [single.serialnumber], business_dates: [single.business_date], half_day: !single.half_day })}
                className={`relative inline-flex h-6 w-10 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/30 ${single.half_day ? 'border-amber-500 bg-amber-400' : 'border-slate-400 bg-slate-200'}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${single.half_day ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <p className="mt-1 text-[10px] text-slate-400">Required hours are halved.</p>
            </div>
            {single.business_date >= todayLocalISO() && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    onDeleteDay(single.business_date);
                  }}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-extrabold transition active:scale-95 ${confirmDelete ? 'border-red-600 bg-red-600 text-white' : 'border-red-200 bg-white text-red-600 hover:bg-red-50'}`}
                >
                  <Trash2 size={13} />
                  {confirmDelete ? 'Confirm delete this day?' : 'Delete this day'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-[#90e0ef] bg-[#caf0f8]/60 px-3 py-2 text-xs text-slate-700">
              Apply status or half-day to all {selectedKeys.length} selected cells.
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Apply status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]">
                <option value="">No change</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Half day</label>
              <select value={half} onChange={(e) => setHalf(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]">
                <option value="">No change</option>
                <option value="half">Set half day</option>
                <option value="full">Set full day</option>
              </select>
            </div>
            <button
              type="button"
              onClick={doApply}
              disabled={busy || (!status && half === '')}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0077b6] px-3 py-2 text-xs font-extrabold text-white hover:bg-[#023e8a] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Apply to {selectedKeys.length} cells
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HeatmapCell({ row, selected, inRect, onStart, onExtend, ri, ci, name, date }) {
  const recorded = Number(row?.recorded_hours || 0);
  const required = Number(row?.scheduled_standard_hours || 0);
  const { bg } = CellColor({ row, recorded, required });
  const strip = row ? (row.scheduled_shift === 'DAY' ? 'border-t-2 border-amber-400' : 'border-t-2 border-indigo-400') : '';
  return (
    <button
      type="button"
      onMouseDown={(e) => onStart(e, ri, ci)}
      onMouseEnter={() => onExtend(ri, ci)}
      title={row
        ? `${name} · ${date} · ${row.scheduled_shift} · ${row.attendance}${row.half_day ? ' · half day' : ''}`
        : `${name} · ${date} · no schedule`}
      className={`relative block h-7 w-7 rounded-md border transition-colors duration-150 ${bg} ${strip} ${
        selected || inRect ? 'ring-2 ring-[#0077b6]' : 'border-transparent'
      } ${row ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {row?.half_day && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 text-[7px] font-black text-white">½</span>
      )}
    </button>
  );
}

const MemoHeatmapCell = React.memo(HeatmapCell);

function EwsRosterPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(monthOf(todayLocalISO()));
  const [scope, setScope] = useState(() => {
    const u = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    return String(u?.roles || '').toLowerCase().includes('foreman') ? 'team' : 'all';
  });
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [dragSel, setDragSel] = useState(null);
  const dragging = useRef(false);

  const days = useMemo(() => daysOfMonth(month), [month]);

  const load = useCallback(async (m, sc) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ews/roster/month?month=${encodeURIComponent(m)}&scope=${sc}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const payload = await res.json();
      setRows(Array.isArray(payload?.data) ? payload.data : []);
    } catch (err) {
      setError(err.message || 'Failed to load roster');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(month, scope); }, [month, scope, load]);

  const operators = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.serialnumber)) map.set(r.serialnumber, r.operator_name || r.serialnumber);
    }
    const q = search.trim().toLowerCase();
    const list = [...map.entries()];
    return q ? list.filter(([, name]) => name.toLowerCase().includes(q)) : list;
  }, [rows, search]);

  const rowsByKey = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(cellKey(r.serialnumber, r.business_date), r);
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    const c = { scheduled: 0, present: 0, absent: 0, excused: 0, in_progress: 0, half_day: 0 };
    for (const r of rows) {
      if (r.half_day) c.half_day += 1;
      if (EXCUSED.includes(r.status)) c.excused += 1;
      else {
        c.scheduled += 1;
        if (r.attendance === 'PRESENT') c.present += 1;
        else if (r.attendance === 'ABSENT') c.absent += 1;
        else if (r.attendance === 'IN_PROGRESS') c.in_progress += 1;
      }
    }
    return c;
  }, [rows]);

  const changeMonth = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const startDrag = useCallback((e, ri, ci) => {
    e.preventDefault();
    dragging.current = true;
    setDragSel({ r1: ri, c1: ci, r2: ri, c2: ci });
  }, []);
  const extendDrag = useCallback((ri, ci) => {
    if (dragging.current) setDragSel((s) => (s ? { ...s, r2: ri, c2: ci } : s));
  }, []);
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const s = dragSel;
    setDragSel(null);
    if (!s) return;
    const rMin = Math.min(s.r1, s.r2);
    const rMax = Math.max(s.r1, s.r2);
    const cMin = Math.min(s.c1, s.c2);
    const cMax = Math.max(s.c1, s.c2);
    const next = new Set();
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const op = operators[r];
        const d = days[c];
        if (op && d) next.add(cellKey(op[0], d.date));
      }
    }
    if (next.size === 1) {
      const k = [...next][0];
      if (selected.has(k)) {
        next.clear();
        setPanelOpen(false);
      } else {
        setPanelOpen(true);
      }
    } else if (next.size > 1) {
      setPanelOpen(true);
    }
    setSelected(next);
  };

  useEffect(() => {
    const up = (e) => {
      if (dragging.current) {
        e.preventDefault();
        endDrag(e);
      }
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragSel, selected, operators, days]);

  const applyBulk = useCallback(async (payload) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const j = await res.json();
      toast.success(`${j.data.rows_updated} row${j.data.rows_updated === 1 ? '' : 's'} updated`);
      setSelected(new Set());
      setPanelOpen(false);
      await load(month, scope);
    } catch (err) {
      toast.error(err.message || 'Failed to update roster');
    }
  }, [month, scope, load]);

  const deleteDay = useCallback(async (businessDate) => {
    try {
      const res = await fetch(`${API_BASE}/ews/roster`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_date: businessDate, updated_by: 'ews-roster-ui' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
      const j = await res.json();
      toast.success(`${j.data.rows_deleted} rows deleted`);
      setSelected(new Set());
      setPanelOpen(false);
      await load(month, scope);
    } catch (err) {
      toast.error(err.message || 'Failed to delete day');
    }
  }, [month, scope, load]);

  const selectedKeys = useMemo(() => [...selected], [selected]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-300 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              aria-label="Back"
            >
              <ArrowLeft size={17} />
            </button>
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6] shadow-sm">
              <Users size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#0077b6]">EWS Roster</p>
              <h1 className="truncate text-base font-extrabold text-slate-900 md:text-lg">Attendance Heatmap</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <button type="button" onClick={() => changeMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label="Previous month">
                <ChevronLeft size={15} />
              </button>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="w-36 bg-transparent px-1 text-sm font-bold text-slate-800 focus:outline-none"
              />
              <button type="button" onClick={() => changeMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label="Next month">
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {[
                { key: 'team', label: 'My team' },
                { key: 'all', label: 'All operators' },
              ].map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setScope(o.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition ${scope === o.key ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => load(month, scope)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate('/ews/foreman-team')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-[#90e0ef] hover:text-[#0077b6]"
            >
              <Users size={14} />
              Foreman Team
            </button>
            <button
              type="button"
              onClick={() => navigate('/ews/roster/config')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-[#90e0ef] hover:text-[#0077b6]"
            >
              <Settings size={14} />
              Config
            </button>
          </div>
        </div>
      </header>

      <main className="flex gap-4 px-4 py-4 md:px-6">
        <div className="min-w-0 flex-1 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
          )}

          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Scheduled days" value={counts.scheduled} tone="info" />
            <StatTile label="Present" value={counts.present} tone="good" />
            <StatTile label="Absent" value={counts.absent} tone={counts.absent > 0 ? 'bad' : 'good'} />
            <StatTile label="In Progress" value={counts.in_progress} tone="neutral" />
            <StatTile label="Excused" value={counts.excused} tone="neutral" />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  {new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                  {operators.length} operators
                </span>
                {counts.half_day > 0 && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                    {counts.half_day} half days
                  </span>
                )}
              </div>
              <label className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search operator…"
                  className="h-8 w-52 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                />
              </label>
            </div>

            <div className="overflow-auto" style={{ maxHeight: '62vh' }}>
              {isLoading && operators.length === 0 ? (
                <div className="p-3" aria-hidden="true">
                  <div className="flex gap-1.5 pb-3">
                    <div className="h-4 w-44 rounded bg-slate-100 animate-pulse" />
                    {days.map((d) => (
                      <div key={d.date} className="h-4 flex-1 rounded bg-slate-100 animate-pulse" />
                    ))}
                  </div>
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-0.5">
                      <div className="h-5 w-44 rounded bg-slate-100 animate-pulse" />
                      {days.map((d) => (
                        <div key={d.date} className="h-7 w-7 flex-none rounded-md bg-slate-100 animate-pulse" />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
              <table key={`${month}|${scope}`} className="border-separate border-spacing-0 text-left text-sm" style={{ animation: 'hm-fade 0.35s ease-out' }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 w-44 min-w-44 border-b border-r border-[#90e0ef] bg-[#caf0f8] px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600">Operator</th>
                    {days.map((d) => (
                      <th key={d.date} className={`sticky top-0 z-10 border-b border-[#90e0ef] px-0.5 py-1 text-center ${d.dow === 0 || d.dow === 6 ? 'bg-amber-50' : 'bg-[#caf0f8]'}`}>
                        <div className="text-[9px] font-black uppercase text-slate-400">{DOW_LETTERS[d.dow]}</div>
                        <div className={`text-[11px] font-black tabular-nums ${d.dow === 0 || d.dow === 6 ? 'text-amber-700' : 'text-slate-700'}`}>{d.day}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!isLoading && operators.length === 0 && (
                    <tr><td colSpan={days.length + 1} className="px-3 py-8 text-center text-xs font-bold text-slate-500">
                      {search ? 'No operator matches the search.' : 'No roster for this month (maybe not generated yet).'}
                    </td></tr>
                  )}
                  {operators.map(([sn, name], ri) => (
                    <tr key={sn} className="group">
                      <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-2 py-1">
                        <div className="truncate text-xs font-bold text-slate-800 group-hover:text-[#0077b6]">{name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{sn}</div>
                      </td>
                      {days.map((d, ci) => {
                        const key = cellKey(sn, d.date);
                        const row = rowsByKey.get(key);
                        const isSel = selected.has(key);
                        const inRect = dragSel
                          && ri >= Math.min(dragSel.r1, dragSel.r2) && ri <= Math.max(dragSel.r1, dragSel.r2)
                          && ci >= Math.min(dragSel.c1, dragSel.c2) && ci <= Math.max(dragSel.c1, dragSel.c2);
                        return (
                          <td key={d.date} className="p-0.5">
                            <MemoHeatmapCell
                              row={row}
                              selected={isSel}
                              inRect={inRect}
                              onStart={startDrag}
                              onExtend={extendDrag}
                              ri={ri}
                              ci={ci}
                              name={name}
                              date={d.date}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2.5 text-[10px] font-semibold text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-400/80" /> ≥100%</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-lime-300/90" /> 50–99%</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-300/80" /> &lt;50%</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-200" /> Absent</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-100" /> In progress</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-sky-200" /> Leave</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-purple-200" /> Sick</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-indigo-200" /> Permit</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-300" /> Off</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-100" /> No schedule</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-t-sm border-t-2 border-amber-400 bg-white" /> DAY</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-t-sm border-t-2 border-indigo-400 bg-white" /> NIGHT</span>
              <span className="flex items-center gap-1"><span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 text-[7px] font-black text-white">½</span> half day</span>
            </div>
          </section>
        </div>

        {panelOpen && selectedKeys.length > 0 && (
          <BulkPanel
            selectedKeys={selectedKeys}
            rowsByKey={rowsByKey}
            onClose={() => { setPanelOpen(false); setSelected(new Set()); }}
            onClear={() => { setSelected(new Set()); setPanelOpen(false); }}
            onApply={applyBulk}
            onDeleteDay={deleteDay}
          />
        )}
      </main>
    </div>
  );
}

export default EwsRosterPage;
