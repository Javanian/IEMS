import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Cpu, Download, Factory, Info, Layers, Loader2, RefreshCw, Send, Trash2, X, XCircle,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';


function getScrollParent(node) {
  let el = node?.parentElement;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null; 
}


const STATUS = {
  POSTED:  { label: 'Posted',  color: '#059669', text: '#047857', bg: '#ecfdf5', border: '#a7f3d0', Icon: CheckCircle2 },
  PENDING: { label: 'Pending', color: '#f59e0b', text: '#b45309', bg: '#fffbeb', border: '#fde68a', Icon: Clock },
  POSTING: { label: 'Posting', color: '#0ea5e9', text: '#0369a1', bg: '#eff6ff', border: '#bfdbfe', Icon: Loader2 },
  FAILED:  { label: 'Failed',  color: '#ef4444', text: '#b91c1c', bg: '#fef2f2', border: '#fecaca', Icon: XCircle },
  SKIPPED: { label: 'Skipped', color: '#94a3b8', text: '#475569', bg: '#f8fafc', border: '#e2e8f0', Icon: XCircle },
};
const stat = (s) => STATUS[s] || STATUS.SKIPPED;


function StatusDot({ status }) {
  const s = stat(status);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold" style={{ color: s.text }}>
      <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}


function fmtDur(hours) {
  const totalMin = Math.round(Number(hours || 0) * 60);
  if (totalMin <= 0) return '0';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { wd: '', dm: iso, full: iso };
  return {
    wd: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    dm: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    full: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  };
}
// Confirmation target: order+op (productive) or non-order activity.
function targetText(b) {
  if (b.is_productive) return `Order ${b.aufnr || '—'} · Op ${b.vornr || '—'}`;
  return `Activity ${b.lstar || '—'}`;
}

// Kolom tabel Records: label jelas tanpa singkatan.
const RECORD_COLS = [
  { en: 'Date' },
  { en: 'Source' },
  { en: 'Staging ID' },
  { icon: Layers, title: 'Bundle' },
  { en: 'Employee ID' },
  { en: 'Employee Name' },
  { en: 'Order' },
  { en: 'Operation' },
  { en: 'Operation Name' },
  { en: 'Machine' },
  { en: 'Act Type' },
  { en: 'Activity' },
  { en: 'Start Time', right: true },
  { en: 'End Time', right: true },
  { en: 'Adjusted End Time', right: true, tone: 'text-[#0077b6]' },
  { en: 'Original Time', right: true },
  { en: 'Overlap Reduction', right: true },
  { en: 'Time Reduction', right: true, tone: 'text-amber-700' },
  { en: 'Break Time', right: true, tone: 'text-amber-700' },
  { en: 'Recognized Time', right: true, tone: 'text-emerald-700' },
  { en: 'Stuck Time' },
  { en: 'Action' },
];

const hm = (dt) => (dt ? dt.slice(11, 19) : '');
const DOT = { POSTED: 'bg-emerald-500', PENDING: 'bg-amber-400', FAILED: 'bg-red-500', SKIPPED: 'bg-slate-400', POSTING: 'bg-sky-500' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return String(iso);
  return `${Number(d)} ${MON[Number(m) - 1]} ${y.slice(2)}`;
};

// Satu baris tabel Records — di-memo supaya re-render panel (polling ops, loading, dll)
// tidak menggambar ulang semua baris. content-visibility membuat baris di luar layar
// tidak di-paint browser (kunci performa saat pageSize besar).
const RecordRow = React.memo(function RecordRow({ r, excludeBusy, onExclude }) {
  const hitBreak = Number(r.breakcut) > 0;
  const hitCap = Number(r.capcut) > 0;
  return (
    <tr
      className={`align-top transition-colors hover:bg-slate-50 ${hitBreak ? 'bg-amber-50/60' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 42px' }}
    >
      <td className="whitespace-nowrap px-2.5 py-1.5 text-[10px] font-medium text-slate-500">{shortDate(r.date)}</td>
      <td className="whitespace-nowrap px-2 py-1.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${r.source === 'TIMESHEET' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>{r.source === 'TIMESHEET' ? 'TS' : 'MCH'}</span>
      </td>
      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] text-slate-500">{r.staging_id}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-center">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[r.bundle_status] || 'bg-slate-300'}`} title={r.bundle_status} />
      </td>
      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-slate-700">{r.pernr}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 font-semibold text-slate-800">{r.name || '—'}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-slate-700">{r.order_no || ''}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{r.operation_no || ''}</td>
      <td className="max-w-[180px] truncate px-2.5 py-1.5 text-slate-500" title={r.operation_text}>{r.operation_text}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-700">{r.machine}</td>
      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-600">{r.activity}</td>
      <td className="max-w-[160px] truncate px-2.5 py-1.5 text-slate-500" title={r.status_desc}>{r.status_desc}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-center font-mono text-slate-700">{hm(r.start)}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-center font-mono text-slate-500">{hm(r.end_orig)}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-center font-mono font-semibold text-[#0077b6]">{hm(r.end_capped)}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-center tabular-nums text-slate-600">{r.raw}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-center tabular-nums text-slate-600">{r.clamped}</td>
      <td className={`whitespace-nowrap px-2.5 py-1.5 text-center font-bold tabular-nums ${hitCap ? 'text-amber-600' : 'text-slate-300'}`}>{r.capcut}</td>
      <td className={`whitespace-nowrap px-2.5 py-1.5 text-center font-bold tabular-nums ${hitBreak ? 'text-orange-600' : 'text-slate-300'}`}>
        {hitBreak ? `${r.breakcut} ⏸` : r.breakcut}
      </td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-center font-bold tabular-nums text-emerald-700">{r.recognized}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-center">{r.stuck ? <span className="text-amber-500" title="Dropped machine signal">⚠</span> : ''}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-center">
        {!r.can_exclude ? (
          <span className="text-slate-300" title="Exclude hanya untuk record machine hours">—</span>
        ) : r.excluded ? (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700" title="Record ini di-exclude (tidak dikirim)">Excluded</span>
        ) : (
          <button
            type="button"
            disabled={excludeBusy}
            onClick={(e) => { e.stopPropagation(); onExclude(r); }}
            title="Tandai record ini TIDAK dipakai (bundle akan di-recalculate)"
            className="rounded-lg border border-red-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-red-600 transition-all hover:bg-red-50 active:scale-95 disabled:opacity-40"
          >
            Exclude
          </button>
        )}
      </td>
    </tr>
  );
});

function StatusBadge({ status, size = 'sm' }) {
  const s = stat(status);
  const I = s.Icon;
  const spin = status === 'POSTING';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ color: s.text, background: s.bg, borderColor: s.border }}
    >
      <I size={size === 'sm' ? 12 : 14} className={spin ? 'animate-spin' : ''} /> {s.label}
    </span>
  );
}

// ── Summary card (one step of the flow) ──────────────────────────────────────
function StepCard({ icon, label, hours, tone, children }) {
  const Icon = icon;
  const tones = {
    blue:   { color: '#0077b6', bg: '#f0f9ff', border: '#bae6fd' },
    green:  { color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    amber:  { color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  };
  const t = tones[tone] || tones.blue;
  return (
    <div className="flex-1 rounded-xl border px-4 py-3 shadow-sm" style={{ borderColor: t.border, background: t.bg }}>
      <div className="flex items-center gap-1.5">
        <Icon size={15} style={{ color: t.color }} />
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: t.color }}>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">{fmtDur(hours)}</div>
      {children && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{children}</div>}
    </div>
  );
}

// Segmented filter: All / Posted / Not posted.
function FilterToggle({ value, onChange }) {
  const opts = [['all', 'All'], ['posted', 'Posted'], ['belum', 'Not posted']];
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {opts.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={`min-h-[30px] rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${value === k ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Queue job status (stage_catchup) — small chip.
function OpsStatus({ ops }) {
  const map = {
    QUEUED:  { label: 'Queued',  color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    RUNNING: { label: 'Running', color: '#0077b6', bg: '#eff6ff', border: '#bfdbfe' },
    DONE:    { label: 'Done',    color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    ERROR:   { label: 'Failed',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  };
  const s = map[ops.status] || map.QUEUED;
  const spin = ops.status === 'QUEUED' || ops.status === 'RUNNING';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold"
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
      title={ops.error || ops.result || ''}
    >
      {spin && <Loader2 size={11} className="animate-spin" />} Staging: {s.label}
    </span>
  );
}

// Group a day's confirmations per operator — so each person's activities stay together
// instead of scattering among other people's rows.
function groupByOperator(bundles) {
  const m = new Map();
  for (const b of bundles || []) {
    const key = b.pernr || b.full_name || '—';
    if (!m.has(key)) {
      m.set(key, { key, pernr: b.pernr, full_name: b.full_name, items: [], source_hrs: 0, posted_hrs: 0, belum_hrs: 0 });
    }
    const g = m.get(key);
    g.items.push(b);
    g.source_hrs += Number(b.source_hrs || 0);
    if (b.status === 'POSTED') g.posted_hrs += Number(b.sent_hrs || 0);
    else g.belum_hrs += Number(b.source_hrs || 0);
  }
  const groups = [...m.values()];
  for (const g of groups) {
    // Within one operator: same order+op adjacent (productive/VA first, then Setting/etc);
    // non-order rows (pure non-productive) last.
    g.items.sort((a, b) => {
      const ax = a.aufnr || '', bx = b.aufnr || '';
      if (ax && !bx) return -1;
      if (!ax && bx) return 1;
      const c1 = ax.localeCompare(bx); if (c1) return c1;
      const c2 = (a.vornr || '').localeCompare(b.vornr || ''); if (c2) return c2;
      return a.is_productive === b.is_productive ? 0 : (a.is_productive ? -1 : 1);
    });
  }
  return groups.sort((a, b) => b.source_hrs - a.source_hrs);
}

function ReconciliationPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);

  // Drill: selected date (level-2) & selected confirmation (level-3).
  const [day, setDay] = useState(null);       // { date }
  const [dayData, setDayData] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [rec, setRec] = useState(null);        // { staging_id, meta }
  const [recData, setRecData] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [openOps, setOpenOps] = useState(() => new Set()); // expanded operator groups (default: all collapsed)
  const [dayFilter, setDayFilter] = useState('all');       // all | posted | belum
  const [ops, setOps] = useState(null);                    // latest stage_catchup job status
  const [opsBusy, setOpsBusy] = useState(false);
  const [view, setView] = useState('records');             // records | overview
  const [recs, setRecs] = useState(null);                  // { records, total, page, pageSize }
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState(null);
  const [recsPageSize, setRecsPageSize] = useState(25);
  const [recsQ, setRecsQ] = useState('');
  const [recsSource, setRecsSource] = useState('all'); // all | mch | timesheet
  const [exclusions, setExclusions] = useState([]);
  const [exQ, setExQ] = useState('');
  const [confirmExclude, setConfirmExclude] = useState(null);
  const [excludeNote, setExcludeNote] = useState('');
  const [excludeBusy, setExcludeBusy] = useState(false);
  const [postDayBusy, setPostDayBusy] = useState(false);
  const opsTimer = useRef(null);
  const panelRef = useRef(null);          // root panel (to find scroll parent)
  const scrollParentRef = useRef(null);   // container scrolled while drilling
  const savedScroll = useRef(0);          // scroll position before entering detail

  const load = useCallback(async (signal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation?${params.toString()}`, { signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to load data');
      setData(payload.data || null);
      if (!from && payload.data?.range) { setFrom(payload.data.range.from); setTo(payload.data.range.to); }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export rekonsiliasi rentang terpilih ke Excel (.xlsx dari backend).
  const handleExport = useCallback(async () => {
    if (!from || !to) { toast.warning('Pick From and To dates first.'); return; }
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation-export?from=${from}&to=${to}`);
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `sap_reconciliation_${from}_to_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Export failed', { description: err.message });
    } finally {
      setExporting(false);
    }
  }, [from, to]);

  // Staging job status: poll while one is running, stop when finished.
  const pollOps = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/requests`);
      const payload = await res.json().catch(() => ({}));
      const latest = (payload.data || []).find((r) => r.action === 'stage_catchup') || null;
      setOps(latest);
      if (latest && (latest.status === 'QUEUED' || latest.status === 'RUNNING')) {
        opsTimer.current = setTimeout(pollOps, 4000);
      }
    } catch { /* ignore — user can resend / check manually */ }
  }, []);

  useEffect(() => {
    pollOps();
    return () => { if (opsTimer.current) clearTimeout(opsTimer.current); };
  }, [pollOps]);

  // Queue eligible-but-unstaged records (Python worker does the staging; correction mode for
  // already-closed days). Node only enqueues the request — it never runs bundling.
  const loadRecords = useCallback(async (page = 1) => {
    setRecsLoading(true);
    setRecsError(null);
    try {
      const params = new URLSearchParams({ from, to, page: String(page), pageSize: String(recsPageSize) });
      if (recsQ.trim()) params.set('q', recsQ.trim());
      if (recsSource !== 'all') params.set('source', recsSource);
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation-records?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal ambil records');
      setRecs(json.data);
    } catch (e) {
      setRecsError(e.message);
    } finally {
      setRecsLoading(false);
    }
  }, [from, to, recsPageSize, recsQ, recsSource]);

  useEffect(() => {
    if (view === 'records' && from && to) loadRecords(1);
  }, [view, from, to, loadRecords]);

  const loadExclusions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (exQ.trim()) params.set('q', exQ.trim());
      const res = await fetch(`${API_BASE}/dashboard/sap-staging-exclusion?${params.toString()}`);
      const json = await res.json();
      if (res.ok) setExclusions(json.data?.exclusions || []);
    } catch (err) {
      console.error('loadExclusions error', err);
    }
  }, [from, to, exQ]);

  // Reload exclusions saat rentang tanggal / search berubah (search di-debounce).
  useEffect(() => {
    const t = setTimeout(loadExclusions, exQ ? 350 : 0);
    return () => clearTimeout(t);
  }, [loadExclusions, exQ]);

  const enqueueOps = useCallback(async (action, params, label) => {
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal antre');
      toast.success('Request diantre', { description: `${label} — berjalan di background.` });
      return json.data;
    } catch (err) {
      toast.error('Gagal antre', { description: `${label}: ${err.message}` });
      return null;
    }
  }, []);

  const doExclude = useCallback(async () => {
    if (!confirmExclude) return;
    setExcludeBusy(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-staging-exclusion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_row_id: confirmExclude.source_row_id, note: excludeNote.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal exclude');
      toast.success('Record di-exclude', {
        description: json.data?.recalc ? `Bundle akan di-recalculate (antrian #${json.data.recalc.id})` : 'Record ditandai tidak dipakai.',
      });
      setConfirmExclude(null);
      setExcludeNote('');
      loadExclusions();
      loadRecords(1);
    } catch (err) {
      toast.error('Gagal exclude', { description: err.message });
    } finally {
      setExcludeBusy(false);
    }
  }, [confirmExclude, excludeNote, loadExclusions, loadRecords]);

  const doUnexclude = useCallback(async (sourceRowId) => {
    setExcludeBusy(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-staging-exclusion?source_row_id=${encodeURIComponent(sourceRowId)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal un-exclude');
      toast.success('Record dikembalikan', { description: 'Bundle akan di-recalculate.' });
      loadExclusions();
      loadRecords(1);
    } catch (err) {
      toast.error('Gagal un-exclude', { description: err.message });
    } finally {
      setExcludeBusy(false);
    }
  }, [loadExclusions, loadRecords]);

  const postAllDay = useCallback(async (date) => {
    setPostDayBusy(true);
    await enqueueOps('post_date', { date }, `Post semua pending ${date}`);
    setPostDayBusy(false);
  }, [enqueueOps]);

  const stageCatchup = useCallback(async () => {
    setOpsBusy(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stage_catchup' }),
      });
      if (res.status !== 409 && !res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || 'Failed to send request');
      }
      // 202 (queued) or 409 (already running) → start/continue polling.
      if (opsTimer.current) clearTimeout(opsTimer.current);
      pollOps();
    } catch (err) {
      setOps({ action: 'stage_catchup', status: 'ERROR', error: err.message });
    } finally {
      setOpsBusy(false);
    }
  }, [pollOps]);

  // Level-2: confirmations for one date.
  const openDay = useCallback(async (date) => {
    savedScroll.current = 0; // new date → start at top
    setDay({ date }); setRec(null); setRecData(null); setDayData(null); setOpenOps(new Set()); setDayFilter('all'); setDayLoading(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation-day?date=${date}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to load confirmations');
      setDayData(payload.data || null);
    } catch (err) { setDayData({ error: err.message, bundles: [] }); }
    finally { setDayLoading(false); }
  }, []);

  // Level-3: machine records behind one confirmation.
  const openRecord = useCallback(async (bundle) => {
    // Remember current scroll so we can restore it on "Back".
    const sp = getScrollParent(panelRef.current);
    scrollParentRef.current = sp;
    savedScroll.current = sp ? sp.scrollTop : (typeof window !== 'undefined' ? window.scrollY : 0);
    setRec({ staging_id: bundle.id, meta: bundle }); setRecData(null); setRecLoading(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-reconciliation-record?staging_id=${bundle.id}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to load records');
      setRecData(payload.data || null);
    } catch (err) { setRecData({ error: err.message, records: [] }); }
    finally { setRecLoading(false); }
  }, []);

  // Expand/collapse an operator group (accordion).
  const toggleOp = useCallback((key) => {
    setOpenOps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Stable: dipakai RecordRow (memo) supaya re-render panel tidak mengganti prop.
  const onExclude = useCallback((r) => {
    setConfirmExclude(r);
    setExcludeNote('');
  }, []);

  // When returning from detail (rec→null) to the day list, restore the last scroll position.
  useLayoutEffect(() => {
    if (!rec && day) {
      const sp = scrollParentRef.current;
      if (sp) sp.scrollTop = savedScroll.current;
      else if (typeof window !== 'undefined') window.scrollTo(0, savedScroll.current);
    }
  }, [rec, day]);

  // Selected date's confirmations: filter (Posted / Not posted) then group per operator.
  const dayFiltered = (dayData?.bundles || []).filter((b) =>
    dayFilter === 'all' ? true : dayFilter === 'posted' ? b.status === 'POSTED' : b.status !== 'POSTED');
  const dayGroups = groupByOperator(dayFiltered);

  const f = data?.funnel;
  const act = data?.action_items || {};
  const failed = Number(act.failed_bundles) || 0;
  const stuckPending = Number(act.stuck_pending_bundles) || 0;

  const renderRecords = () => (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Records · MCH &amp; Timesheet</h3>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={recsSource}
            onChange={(e) => { setRecsSource(e.target.value); }}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-[#0096c7] focus:outline-none"
          >
            <option value="all">All sources</option>
            <option value="mch">Machine hours</option>
            <option value="timesheet">Timesheet</option>
          </select>
          <input
            value={recsQ}
            onChange={(e) => setRecsQ(e.target.value)}
            placeholder="Search pernr / name / machine / order…"
            className="w-52 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
          <select
            value={recsPageSize}
            onChange={(e) => setRecsPageSize(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-[#0096c7] focus:outline-none"
          >
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n}/pg</option>)}
          </select>
        </div>
      </div>
      {recsLoading && !recs ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : recsError ? (
        <div className="p-4 text-sm text-red-600">{recsError}</div>
      ) : recs ? (
        <>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 1480 }}>
              <thead>
                <tr style={{ background: '#caf0f8' }} className="text-left text-[10px] uppercase tracking-wide text-slate-600">
                  {RECORD_COLS.map((c) => {
                    const I = c.icon;
                    return (
                      <th
                        key={c.en || c.title}
                        className={`px-2 py-2.5 text-center align-middle font-semibold leading-tight ${c.tone || ''}`}
                      >
                        {I ? <I size={13} className="mx-auto" aria-label={c.title} /> : c.en}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recs.records.map((r) => (
                  <RecordRow key={`${r.source}-${r.staging_id}-${r.start}`} r={r} excludeBusy={excludeBusy} onExclude={onExclude} />
                ))}
                {recs.records.length === 0 && (
                  <tr><td colSpan={22} className="px-3 py-8 text-center text-sm text-slate-400">No records in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2">
            <span className="text-[11px] font-semibold text-slate-500">
              Showing {recs.records.length.toLocaleString('id-ID')} of {recs.total.toLocaleString('id-ID')} records
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" disabled={recs.page <= 1 || recsLoading} onClick={() => loadRecords(recs.page - 1)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-40">‹ Prev</button>
              <span className="text-[11px] font-semibold text-slate-600">page {recs.page} / {Math.max(1, Math.ceil(recs.total / recs.pageSize))}</span>
              <button type="button" disabled={recs.page >= Math.ceil(recs.total / recs.pageSize) || recsLoading} onClick={() => loadRecords(recs.page + 1)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-40">Next ›</button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );

  // Tab terpisah: daftar record yang di-exclude (tidak ikut dibundle/dikirim).
  // Rentang tanggal (from/to) + search dikirim ke backend sehingga ikut terfilter.
  const renderExcluded = () => (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Excluded records</h3>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{exclusions.length}</span>
        <input
          value={exQ}
          onChange={(e) => setExQ(e.target.value)}
          placeholder="Search pernr / name / machine / activity…"
          className="ml-auto w-56 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        />
      </div>
      {exclusions.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">No excluded records{exQ ? ' matching the search' : ''}.</p>
      ) : (
        <ul className="max-h-[62vh] divide-y divide-slate-100 overflow-y-auto">
          {exclusions.map((ex) => (
            <li key={ex.source_row_id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 text-[11px]">
                <span className="font-mono font-bold text-slate-700">{ex.pernr}</span>{' '}
                <span className="font-semibold text-slate-600">{ex.name}</span>
                <span className="text-slate-400"> · {ex.machinename} · {ex.activity} · {ex.source_row_id}</span>
                {ex.record_date && <span className="text-slate-400"> · {shortDate(ex.record_date)}</span>}
                {ex.note && <span className="italic text-slate-500"> — {ex.note}</span>}
              </span>
              <span className="text-[10px] text-slate-400">excluded {ex.excluded_at ? String(ex.excluded_at).slice(0, 16) : ''}</span>
              <button
                type="button"
                disabled={excludeBusy}
                onClick={() => doUnexclude(ex.source_row_id)}
                title="Kembalikan record ini (bundle di-recalculate)"
                className="inline-flex h-6 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 disabled:opacity-40"
              >
                <Trash2 size={10} /> Un-exclude
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  // Breadcrumb hanya tampil saat drill (day/rec) — di level summary tidak ada agar rapat.
  const crumb = !day && !rec ? null : (
    <nav className="flex flex-wrap items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => { setDay(null); setRec(null); }}
        title="Back to summary"
        className="flex h-6 items-center gap-1 rounded-lg px-2 font-bold text-[#0077b6] transition hover:bg-slate-100"
      >
        <ArrowLeft size={13} /> All dates
      </button>
      {day && (
        <>
          <ChevronRight size={13} className="text-slate-300" />
          <button
            type="button"
            onClick={() => { setRec(null); }}
            className={`rounded px-1.5 py-0.5 font-semibold ${rec ? 'text-[#0077b6] hover:bg-slate-100' : 'text-slate-800'}`}
          >{dayLabel(day.date).dm}</button>
        </>
      )}
      {rec && (
        <>
          <ChevronRight size={13} className="text-slate-300" />
          <span className="px-1.5 py-0.5 font-semibold text-slate-800">{rec.meta.full_name || rec.meta.pernr}</span>
        </>
      )}
    </nav>
  );

  return (
    <div ref={panelRef} className="mx-auto flex w-full max-w-full flex-col gap-3">
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertCircle size={16} /> {error}</span>
          <button type="button" onClick={() => load()} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Retry</button>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200/70" />)}</div>
      ) : !f ? null : (
        <>
          {crumb}

          {/* ══ LEVEL 1: Summary + date list ══ */}
          {!day && (
            <>
              {/* Tab bar + date range filter — satu baris agar hemat tempat */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 p-1.5">
                <div className="inline-flex rounded-lg bg-slate-200/60 p-0.5">
                  {[
                    { code: 'records', label: 'Records' },
                    { code: 'overview', label: 'Overview' },
                    { code: 'excluded', label: 'Excluded' },
                  ].map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => setView(t.code)}
                      className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all active:scale-95 ${view === t.code ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:bg-white/60'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => { e.preventDefault(); setDay(null); setRec(null); load(); }}
                  className="ml-auto flex flex-wrap items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting || !from || !to}
                    title="Export reconciliation to Excel"
                    className="flex h-[30px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                  >
                    {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export
                  </button>
                  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500">From
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                      className="h-[30px] rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
                  </label>
                  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500">To
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                      className="h-[30px] rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]" />
                  </label>
                  <button type="submit" disabled={loading}
                    className="flex h-[30px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-2.5 text-[11px] font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]">
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Apply
                  </button>
                </form>
              </div>

              {view === 'records' && renderRecords()}
              {view === 'excluded' && renderExcluded()}
            </>
          )}

          {!day && view === 'overview' && (
            <>
              {/* 3-step flow */}
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <StepCard icon={Factory} label="Machine hours" hours={f.mch_clamped_hrs} tone="blue">
                  {f.cap_cut_hrs > 0.01 && <>cut {fmtDur(f.cap_cut_hrs)} by max record rule</>}
                </StepCard>
                <ArrowRight size={18} className="mx-auto hidden flex-shrink-0 text-slate-300 sm:block" />
                <StepCard icon={CheckCircle2} label="Posted to SAP" hours={f.posted_hrs} tone="green">
                  order {fmtDur(f.posted_order_hrs)} · activity {fmtDur(f.posted_cc_hrs)}
                </StepCard>
                <ArrowRight size={18} className="mx-auto hidden flex-shrink-0 text-slate-300 sm:block" />
                <StepCard icon={Clock} label="Not in SAP" hours={f.pending_hrs + f.failed_hrs} tone="amber">
                  pending {fmtDur(f.pending_hrs)}{failed > 0 ? ` · failed ${fmtDur(f.failed_hrs)}` : ''}
                </StepCard>
              </div>

              {/* Warnings (only when relevant) */}
              {(failed > 0 || stuckPending > 0) && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="text-xs leading-relaxed text-slate-700">
                    {failed > 0 && <div><b>{failed} failed</b> — fix the cause and resend from the Corrections tab.</div>}
                    {stuckPending > 0 && (
                      <div><b>{stuckPending} pending</b> with inflated hours (machine signal dropped); drops ~{fmtDur(act.stuck_pending_reduction_hrs)} when sent. Not in SAP → safe.</div>
                    )}
                  </div>
                </div>
              )}

              {/* Action: stage records that were missed (eligible but not yet bundled) */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-700">Records missed staging?</div>
                  <div className="text-[11px] leading-relaxed text-slate-500">
                    Queue eligible-but-unstaged records. Closed days become corrections (post them from the Corrections tab).
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {ops && <OpsStatus ops={ops} />}
                  <button
                    type="button"
                    onClick={stageCatchup}
                    disabled={opsBusy || ops?.status === 'QUEUED' || ops?.status === 'RUNNING'}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 text-xs font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                  >
                    {opsBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Stage catch-up
                  </button>
                </div>
              </div>

              {/* Date list — drill entry point */}
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">By date · click a row</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#caf0f8' }} className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                        <th className="px-4 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 text-right font-semibold">Machine hrs</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700">Cut (max record)</th>
                        <th className="px-3 py-2 text-right font-semibold text-emerald-700">Posted</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700">Not posted</th>
                        <th className="px-2 py-2 font-semibold" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data.by_date || []).map((r) => {
                        const belum = r.pending_hrs + r.failed_hrs;
                        const d = dayLabel(r.date);
                        return (
                          <tr
                            key={r.date}
                            role="button"
                            tabIndex={0}
                            onClick={() => openDay(r.date)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(r.date); } }}
                            className="cursor-pointer transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className="text-[11px] text-slate-400">{d.wd}</span>{' '}
                              <span className="font-semibold text-slate-800">{d.dm}</span>
                              {r.rows_stuck > 0 && (
                                <span title="Some records had a dropped machine signal" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtDur(r.mch_clamped_hrs)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.cap_cut_hrs > 0.05 ? '#d97706' : '#cbd5e1' }}>
                              {r.cap_cut_hrs > 0.05 ? fmtDur(r.cap_cut_hrs) : '·'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{r.posted_hrs > 0 ? fmtDur(r.posted_hrs) : '·'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: belum > 0.05 ? '#d97706' : '#cbd5e1' }}>{belum > 0.05 ? fmtDur(belum) : '·'}</td>
                            <td className="px-2 py-2.5 text-right"><ChevronRight size={16} className="ml-auto text-slate-300" /></td>
                          </tr>
                        );
                      })}
                      {(data.by_date || []).length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">No data in this range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* ══ LEVEL 2: Confirmations within one date ══ */}
          {day && !rec && (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <button type="button" onClick={() => setDay(null)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <ArrowLeft size={13} /> Back
                </button>
                <h3 className="text-sm font-bold text-slate-800">{dayLabel(day.date).full}</h3>
                <button
                  type="button"
                  disabled={postDayBusy}
                  onClick={() => postAllDay(day.date)}
                  title="Post semua bundel PENDING pada tanggal ini"
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#0077b6] px-2.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:opacity-50"
                >
                  {postDayBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Post pending
                </button>
                <div className="ml-1"><FilterToggle value={dayFilter} onChange={setDayFilter} /></div>
              </div>

              {dayLoading ? (
                <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
              ) : dayData?.error ? (
                <div className="p-4 text-sm text-red-600">{dayData.error}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] text-sm">
                    <thead>
                      <tr style={{ background: '#caf0f8' }} className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-2 font-semibold">Order</th>
                        <th className="px-3 py-2 font-semibold">Op</th>
                        <th className="px-3 py-2 font-semibold">Operation text</th>
                        <th className="px-3 py-2 font-semibold">Activity</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Machine</th>
                        <th className="px-3 py-2 text-right font-semibold">Machine hrs</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700">Cut</th>
                        <th className="px-3 py-2 text-right font-semibold">Sent</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-2 py-2 font-semibold" />
                      </tr>
                    </thead>
                    {dayGroups.map((g) => {
                      const isOpen = openOps.has(g.key);
                      return (
                        <tbody key={g.key} className="divide-y divide-slate-100">
                          {/* Group header: operator + day totals (click to expand/collapse) */}
                          <tr
                            role="button"
                            tabIndex={0}
                            aria-expanded={isOpen}
                            onClick={() => toggleOp(g.key)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOp(g.key); } }}
                            className="cursor-pointer border-t-2 border-slate-200 bg-slate-50/70 transition-colors hover:bg-slate-100/70 focus:bg-slate-100/70 focus:outline-none"
                          >
                            <td colSpan={6} className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {isOpen
                                  ? <ChevronDown size={15} className="flex-shrink-0 text-slate-400" />
                                  : <ChevronRight size={15} className="flex-shrink-0 text-slate-400" />}
                                <div className="min-w-0">
                                  <div className="truncate font-bold text-slate-800">{g.full_name || g.pernr || '—'}</div>
                                  <div className="font-mono text-[11px] text-slate-400">{g.pernr}</div>
                                </div>
                              </div>
                            </td>
                            <td colSpan={5} className="px-3 py-2.5 text-right text-[11px]">
                              <span className="text-slate-400">machine </span>
                              <span className="font-bold tabular-nums text-slate-700">{fmtDur(g.source_hrs)}</span>
                              <span className="ml-3 text-slate-400">posted </span>
                              <span className="font-bold tabular-nums text-emerald-700">{g.posted_hrs > 0 ? fmtDur(g.posted_hrs) : '·'}</span>
                              <span className="ml-2 text-slate-400">· {g.items.length} acts</span>
                            </td>
                          </tr>
                          {/* This operator's activities (shown when the group is expanded) */}
                          {isOpen && g.items.map((b) => {
                            const src = Number(b.source_hrs || 0);
                            const sent = Number(b.sent_hrs || 0);
                            const diff = sent - src;
                            return (
                              <tr
                                key={b.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => openRecord(b)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecord(b); } }}
                                className="cursor-pointer align-top transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                              >
                                <td className="whitespace-nowrap px-3 py-2.5 pl-6 font-mono text-xs text-slate-700">{b.aufnr || '—'}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-700">{b.vornr || '—'}</td>
                                <td className="px-3 py-2.5">
                                  <span className="block max-w-[220px] truncate text-slate-700" title={b.operation_text || ''}>{b.operation_text || '—'}</span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">
                                  {b.zbarcodeid || b.lstar || '—'}
                                  {b.is_correction && (
                                    <span title="Correction — re-done after the day/order was already posted, so it posts as a separate confirmation" className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">corr</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold" style={{ color: b.is_productive ? '#1d4ed8' : '#64748b' }}>
                                  {b.is_productive ? 'Productive' : 'Non-productive'}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5">
                                  <span className="font-mono text-xs text-slate-700">{b.machineid || '—'}</span>
                                  {b.machinename && <span className="ml-1.5 text-xs text-slate-500">{b.machinename}</span>}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-700">
                                  {fmtDur(src)}
                                  {b.has_stuck && <span title="Machine signal dropped for a while" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: Number(b.cap_cut_hrs || 0) > 0.02 ? '#d97706' : '#cbd5e1' }}>
                                  {Number(b.cap_cut_hrs || 0) > 0.02 ? fmtDur(b.cap_cut_hrs) : '·'}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums">
                                  <span className={diff > 0.1 ? 'font-bold text-amber-700' : 'text-slate-700'}>{fmtDur(sent)}</span>
                                  {diff > 0.1 && (
                                    <div className="text-[10px] font-semibold text-amber-600">
                                      {b.status === 'POSTED' ? `+${fmtDur(diff)} in SAP` : `→ ${fmtDur(src)}`}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2.5"><StatusDot status={b.status} /></td>
                                <td className="px-2 py-2.5 text-right"><ChevronRight size={16} className="ml-auto text-slate-300" /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      );
                    })}
                    {dayGroups.length === 0 && (
                      <tbody>
                        <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-400">No confirmations{dayFilter !== 'all' ? ' for this filter' : ''} on this date.</td></tr>
                      </tbody>
                    )}
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ══ LEVEL 3: Machine records behind one confirmation ══ */}
          {rec && (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <button type="button" onClick={() => setRec(null)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <ArrowLeft size={13} /> Back
                </button>
                <h3 className="text-sm font-bold text-slate-800">{rec.meta.full_name || rec.meta.pernr}</h3>
                <StatusBadge status={rec.meta.status} />
                {rec.meta.is_correction && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">correction</span>}
              </div>

              {/* Confirmation head summary */}
              <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 text-xs sm:grid-cols-4">
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Target</div><div className="font-semibold text-slate-800">{targetText(rec.meta)}</div></div>
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Activity</div><div className="font-semibold text-slate-800">{rec.meta.zbarcodeid || '—'}</div></div>
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Machine hrs (actual)</div><div className="font-bold tabular-nums text-slate-800">{fmtDur(rec.meta.source_hrs)}</div></div>
                <div className="bg-white px-4 py-2.5"><div className="text-[11px] text-slate-400">Sent to SAP</div><div className="font-bold tabular-nums text-slate-800">{fmtDur(rec.meta.sent_hrs)}</div></div>
              </div>

              {recLoading ? (
                <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
              ) : recData?.error ? (
                <div className="p-4 text-sm text-red-600">{recData.error}</div>
              ) : (
                <>
                  {/* SAP response */}
                  {recData?.bundle?.sap_response && (
                    <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                      <Info size={14} className="mt-0.5 flex-shrink-0 text-[#0077b6]" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">SAP response</div>
                        <div className="break-words font-mono text-xs text-slate-700">{recData.bundle.sap_response}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 px-4 pt-3 pb-1">
                    <Cpu size={14} className="text-[#0077b6]" />
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">Machine records in this confirmation</h4>
                    <span className="text-[11px] text-slate-400">({(recData?.records || []).length})</span>
                  </div>
                  <div className="overflow-x-auto px-2 pb-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2 font-semibold">Machine</th>
                          <th className="px-2 py-2 font-semibold">Record ID</th>
                          <th className="px-2 py-2 font-semibold">Machine status</th>
                          <th className="px-2 py-2 font-semibold">Start</th>
                          <th className="px-2 py-2 font-semibold">End</th>
                          <th className="px-2 py-2 text-right font-semibold">Used</th>
                          <th className="px-2 py-2 font-semibold" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(recData?.records || []).map((m) => {
                          const trimmed = Number(m.raw_hrs) - Number(m.clamp_hrs) > 0.02;
                          return (
                            <tr key={m.proddataid} className="hover:bg-slate-50">
                              <td className="px-2 py-2 font-mono text-xs text-slate-700">{m.machineid}</td>
                              <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{m.proddataid}</td>
                              <td className="px-2 py-2 text-xs text-slate-600">{m.status_description || '—'}</td>
                              <td className="px-2 py-2 tabular-nums text-slate-600">{m.mulai}</td>
                              <td className="px-2 py-2 tabular-nums text-slate-600">{m.selesai}</td>
                              <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-800">{fmtDur(m.contributed_hrs)}</td>
                              <td className="px-2 py-2">
                                {m.is_stuck ? (
                                  <span title="Machine signal dropped — raw hours trimmed to a sane duration" className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                    <AlertTriangle size={10} /> signal lost
                                  </span>
                                ) : trimmed ? (
                                  <span className="text-[10px] text-slate-400">trimmed</span>
                                ) : null}
                                {Number(m.cap_cut_hrs || 0) > 0.02 && (
                                  <span
                                    title="Trimmed by the max record duration rule"
                                    className={`inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ${m.is_stuck || trimmed ? 'ml-1' : ''}`}
                                  >
                                    cap cut {fmtDur(m.cap_cut_hrs)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {(recData?.records || []).length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">No machine records.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}

      {/* Modal konfirmasi exclude record */}
      {confirmExclude && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">Exclude record ini?</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Record <b className="font-mono">{confirmExclude.source_row_id}</b> ({confirmExclude.pernr} {confirmExclude.name} · {confirmExclude.machine} · {hm(confirmExclude.start)}) tidak akan ikut dibundle/dikirim ke SAP. Bundle-nya otomatis di-recalculate.
                </p>
              </div>
              <button type="button" onClick={() => setConfirmExclude(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <input
              value={excludeNote}
              onChange={(e) => setExcludeNote(e.target.value)}
              placeholder="Alasan (opsional)…"
              className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmExclude(null)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={excludeBusy}
                onClick={doExclude}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
              >
                {excludeBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Exclude & recalculate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReconciliationPanel;
