import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Database,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  X,
} from 'lucide-react';
import ConfirmationModal from '../components/ui/ConfirmationModal';
import MachineHoursMatrix from '../components/sap/MachineHoursMatrix';
import CorrectionsPanel from '../components/sap/CorrectionsPanel';
import ReconciliationPanel from '../components/sap/ReconciliationPanel';

const API_BASE = import.meta.env.VITE_API_URL || '';


function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function toJsonText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

const STATUS_META = {
  POSTED:  { label: 'Posted', icon: CheckCircle2, badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  PENDING: { label: 'Pending', icon: CircleDashed, badge: 'border-amber-200 bg-amber-50 text-amber-700',   dot: 'bg-amber-500' },
  POSTING: { label: 'Posting', icon: Loader2,      badge: 'border-cyan-200 bg-cyan-50 text-[#0077b6]',      dot: 'bg-[#00b4d8]' },
  FAILED:  { label: 'Failed',    icon: AlertCircle,   badge: 'border-red-200 bg-red-50 text-red-700',          dot: 'bg-red-500' },
  SKIPPED: { label: 'Skipped', icon: CircleDashed,  badge: 'border-slate-200 bg-slate-100 text-slate-600',   dot: 'bg-slate-400' },
};
const statusMeta = (s) => STATUS_META[String(s || 'PENDING').toUpperCase()] || STATUS_META.PENDING;

const STATUS_OPTIONS = ['all', 'PENDING', 'POSTING', 'POSTED', 'FAILED', 'SKIPPED'];


function StatCard({ label, value, sub, tone, active, onClick }) {
  const tones = {
    posted:  'bg-emerald-50 border-emerald-200 text-emerald-700',
    pending: 'bg-amber-50 border-amber-200 text-amber-700',
    failed:  'bg-red-50 border-red-200 text-red-700',
    neutral: 'bg-white border-slate-200 text-slate-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-left shadow-sm transition-all active:scale-95
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
        ${tones[tone] || tones.neutral} ${active ? 'ring-2 ring-[#00b4d8]' : ''}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
      {sub != null && <div className="text-[11px] font-medium opacity-70">{sub}</div>}
    </button>
  );
}


function FailureTriage({ failures, onFilterStatus }) {
  const [open, setOpen] = useState(true);
  if (!failures?.length) return null;
  const total = failures.reduce((s, f) => s + f.count, 0);

  return (
    <section className="rounded-xl border border-red-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] rounded-xl"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500" />
          <span className="text-sm font-bold text-slate-800">Needs action — {total} bundles</span>
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {failures.map((f) => (
            <li key={f.cause_key} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">{f.label}</p>
                  {f.action && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{f.action}</p>}
                </div>
                <span className="flex-shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-extrabold tabular-nums text-red-700">
                  {f.count}
                </span>
              </div>
              {f.sample_ids?.length > 0 && (
                <button
                  type="button"
                  onClick={() => onFilterStatus(f.statuses?.[0] || 'FAILED')}
                  className="mt-2 text-[11px] font-semibold text-[#0077b6] underline-offset-2 hover:underline
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] rounded"
                >
                  View records ({f.statuses?.join(' / ') || 'FAILED'})
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


function DetailDrawer({ row, onClose }) {
  useEffect(() => {
    if (!row) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = 'unset'; };
  }, [row, onClose]);

  if (!row) return null;
  const meta = statusMeta(row.status);
  const payload = toJsonText(row.payload);
  const response = toJsonText(row.sap_response || row.sap_response_text);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bundle detail ${row.ztimesheetid || row.id}`}
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="font-mono text-xs font-bold text-slate-500">#{row.ztimesheetid || row.id}</p>
            <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${meta.badge}`}>
              {meta.label}
            </span>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {row.cause_label && row.cause_label !== '-' && (
            <div className={`rounded-lg border p-3 ${row.status === 'FAILED' || row.status === 'SKIPPED' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
              <p className="text-xs font-bold text-slate-800">{row.cause_label}</p>
              {row.cause_action && <p className="mt-1 text-xs leading-relaxed text-slate-600">{row.cause_action}</p>}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            {[
              ['Source', row.source_system],
              ['Order', row.aufnr],
              ['Operation', row.vornr],
              ['Employee', row.pernr],
              ['Work center', row.arbpl],
              ['Duration (s)', row.total_seconds],
              ['Created', formatDateTime(row.created_at)],
              ['Posted', formatDateTime(row.posted_at)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
                <dd className="mt-0.5 truncate font-mono font-semibold tabular-nums text-slate-700" title={String(v ?? '')}>{v || '-'}</dd>
              </div>
            ))}
          </dl>

          {response && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">SAP Response</p>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">{response}</pre>
            </div>
          )}
          {payload && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Payload</p>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">{payload}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function SkeletonRows({ n = 6 }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}


function SapLogPage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState('staging');
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [acting, setActing] = useState(false);
  const [postDate, setPostDate] = useState('');
  const [postPernr, setPostPernr] = useState('');

  const fetchSummary = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-timesheet-staging-summary`, { signal });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) setSummary(payload.data || null);
    } catch (err) {
      if (err.name !== 'AbortError') console.error('summary error', err);
    }
  }, []);

  const fetchRows = useCallback(async ({ cursor = null, append = false, signal } = {}) => {
    const params = new URLSearchParams({ limit: '30', status });
    if (search) params.set('search', search);
    if (cursor) params.set('cursor', String(cursor));
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-timesheet-staging-log?${params.toString()}`, { signal });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to load SAP log');
      const next = payload.data || [];
      setRows((cur) => (append ? [...cur, ...next] : next));
      setNextCursor(payload.pagination?.next_cursor || null);
      setHasMore(Boolean(payload.pagination?.has_more));
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, status]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRows({ append: false, signal: controller.signal });
    return () => controller.abort();
  }, [fetchRows]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(controller.signal);
    return () => controller.abort();
  }, [fetchSummary]);

  const refreshAll = useCallback(() => {
    fetchRows({ append: false });
    fetchSummary();
  }, [fetchRows, fetchSummary]);

  const handleSearchSubmit = (e) => { e.preventDefault(); setSearch(searchInput.trim()); };


  const enqueue = useCallback(async (action, label, params = {}) => {
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to send request');
      toast.success('Request queued', {
        description: `${label} — running in the background. Refresh to see changes.`,
      });
      refreshAll();
    } catch (err) {
      toast.error('Request could not be queued', { description: `${label}: ${err.message}` });
    } finally {
      setActing(false);
    }
  }, [refreshAll]);

  const failedCount = summary?.by_status?.FAILED || 0;
  const bc = summary?.by_status || {};

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-800">
      {}
      <header className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button" onClick={() => navigate('/operations-hub')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <ArrowLeft size={16} /> Back
          </button>

          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f7fb] text-[#0077b6]"><Database size={16} /></span>
            <h1 className="text-sm font-extrabold text-slate-800 md:text-base">SAP POSTING LOG</h1>
          </div>

          {tab === 'staging' ? (
            <button
              type="button" onClick={refreshAll} disabled={loading}
              title="Refresh" aria-label="Refresh"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          ) : <span className="min-h-[44px] min-w-[44px]" />}
        </div>

        {}
        <div className="mt-2 flex gap-1" role="tablist" aria-label="Tampilan">
          {[
            { key: 'staging', label: 'SAP Posting' },
            { key: 'reconcile', label: 'Rekonsiliasi' },
            { key: 'hours', label: 'Operator Hours' },
            { key: 'corrections', label: 'Corrections' },
          ].map((tb) => (
            <button
              key={tb.key} role="tab" aria-selected={tab === tb.key}
              type="button" onClick={() => setTab(tb.key)}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition-all active:scale-95
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                ${tab === tb.key ? 'bg-[#0077b6] text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {tab === 'reconcile' ? (
          <ReconciliationPanel />
        ) : tab === 'hours' ? (
          <div className="mx-auto max-w-6xl"><MachineHoursMatrix /></div>
        ) : tab === 'corrections' ? (
          <div className="mx-auto max-w-6xl"><CorrectionsPanel /></div>
        ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-4">

          {}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Posted" value={(bc.POSTED || 0).toLocaleString('en-US')} sub={summary ? `+${summary.posted_today || 0} today` : ' '} tone="posted"
              active={status === 'POSTED'} onClick={() => setStatus('POSTED')} />
            <StatCard label="Pending" value={(bc.PENDING || 0).toLocaleString('en-US')} sub={summary ? `${summary.pending_today || 0} today` : ' '} tone="pending"
              active={status === 'PENDING'} onClick={() => setStatus('PENDING')} />
            <StatCard label="Failed" value={(bc.FAILED || 0).toLocaleString('en-US')} sub={bc.SKIPPED ? `${bc.SKIPPED} skipped` : ' '} tone="failed"
              active={status === 'FAILED'} onClick={() => setStatus('FAILED')} />
            <StatCard label="Queue total" value={(summary?.total || 0).toLocaleString('en-US')}
              sub={summary?.oldest ? `since ${formatDateTime(summary.oldest).slice(0, 6)}` : ' '} tone="neutral"
              active={status === 'all'} onClick={() => setStatus('all')} />
          </div>

          {}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Post manual</span>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <input type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-[#0096c7] focus:outline-none" />
              <button
                type="button" disabled={acting || !postDate}
                onClick={() => enqueue('post_date', 'Post by date', { date: postDate })}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#0077b6] px-3 text-xs font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={13} /> Post date
              </button>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <input
                value={postPernr} onChange={(e) => setPostPernr(e.target.value)}
                placeholder="PERNR / operator…"
                className="h-9 w-36 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0096c7] focus:outline-none"
              />
              <button
                type="button" disabled={acting || !postPernr.trim()}
                onClick={() => enqueue('post_operator', 'Post by operator', { pernr: postPernr.trim() })}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#0077b6] px-3 text-xs font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={13} /> Post operator
              </button>
            </label>
            <button
              type="button" disabled={acting || failedCount === 0}
              onClick={() => setConfirmRetry(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw size={14} /> Retry failed{failedCount ? ` (${failedCount})` : ''}
            </button>
            <p className="ml-auto text-[11px] text-slate-400">
              {failedCount === 0 ? 'Nothing failed — PENDING posted automatically' : 'PENDING posted automatically'}
            </p>
          </div>

          {}
          <FailureTriage failures={summary?.failures} onFilterStatus={(s) => setStatus(s)} />

          {}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            {}
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2 border-b border-slate-100 p-3 md:flex-row md:items-center">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search order, employee, proddataid, SAP message…"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 transition-all
                    focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                />
              </label>
              <select
                value={status} onChange={(e) => setStatus(e.target.value)}
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-all
                  focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              >
                {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o === 'all' ? 'All statuses' : statusMeta(o).label}</option>)}
              </select>
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
              >
                <Search size={16} /> Search
              </button>
            </form>

            {}
            {loading && rows.length === 0 ? (
              <SkeletonRows />
            ) : error ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <AlertCircle className="h-8 w-8 text-red-400" />
                <p className="text-sm font-semibold text-red-600">{error}</p>
                <button
                  type="button" onClick={() => fetchRows({ append: false })}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                >
                  <RefreshCw size={16} /> Try again
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Database className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold text-slate-500">No data for this filter</p>
              </div>
            ) : (
              <>
                {}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead style={{ background: '#caf0f8' }}>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-700">
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">ID</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">Order / Op</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">Employee</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">Details</th>
                        <th className="whitespace-nowrap px-3 py-2 font-semibold">Created</th>
                        <th className="whitespace-nowrap px-2 py-2 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row) => {
                        const meta = statusMeta(row.status);
                        const isFail = row.status === 'FAILED' || row.status === 'SKIPPED';
                        return (
                          <tr
                            key={row.id} onClick={() => setDetailRow(row)}
                            className="cursor-pointer align-middle transition-colors hover:bg-slate-50"
                          >
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.badge}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-bold tabular-nums text-slate-600">#{row.ztimesheetid || row.id}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span className="font-mono text-xs font-bold text-slate-800">{row.aufnr || '-'}</span>
                              <span className="ml-1 font-mono text-xs text-slate-400">/ {row.vornr || '-'}</span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600">{row.pernr || '-'}</td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs font-medium ${isFail ? 'text-red-600' : 'text-slate-500'}`}>
                                {row.cause_label && row.cause_label !== '-' ? row.cause_label : (isFail ? 'Failed' : '—')}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-500">{formatDateTime(row.created_at)}</td>
                            <td className="whitespace-nowrap px-2 py-2.5">
                              {(row.status === 'PENDING' || row.status === 'FAILED') && (
                                <button
                                  type="button"
                                  disabled={acting}
                                  onClick={(e) => { e.stopPropagation(); enqueue('post_bundles', `Post bundle #${row.ztimesheetid || row.id}`, { ids: [row.id] }); }}
                                  title="Post bundle ini sekarang"
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#0077b6] bg-white px-2 text-[11px] font-semibold text-[#0077b6] transition-all hover:bg-[#e0f4fc] active:scale-95 disabled:opacity-40"
                                >
                                  <Send size={11} /> Post
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {}
                <ul className="divide-y divide-slate-100 md:hidden">
                  {rows.map((row) => {
                    const meta = statusMeta(row.status);
                    const isFail = row.status === 'FAILED' || row.status === 'SKIPPED';
                    return (
                      <li key={row.id}>
                        <button
                          type="button" onClick={() => setDetailRow(row)}
                          className="flex min-h-[52px] w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                            </span>
                            <span className="font-mono text-[11px] font-bold tabular-nums text-slate-400">#{row.ztimesheetid || row.id}</span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-xs text-slate-700">
                            <span className="font-bold">{row.aufnr || '-'}</span>
                            <span className="text-slate-400">/ {row.vornr || '-'}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-500">{row.pernr || '-'}</span>
                          </div>
                          {row.cause_label && row.cause_label !== '-' && (
                            <p className={`text-xs font-medium ${isFail ? 'text-red-600' : 'text-slate-500'}`}>{row.cause_label}</p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {}
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <p className="text-xs font-medium text-slate-400 tabular-nums">{rows.length} records</p>
              {hasMore && (
                <button
                  type="button" onClick={() => fetchRows({ cursor: nextCursor, append: true })} disabled={loadingMore}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />} Load more
                </button>
              )}
            </div>
          </section>
        </div>
        )}
      </main>

      <DetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />

      <ConfirmationModal
        isOpen={confirmRetry}
        title={`Retry ${failedCount} failed bundles to SAP?`}
        message="This sends work hours to SAP payroll. The anti-double-post guard prevents duplicates, but make sure the cause is fixed (e.g. SAP master data) so it does not fail again."
        confirmLabel="Yes, retry"
        cancelLabel="Cancel"
        onCancel={() => setConfirmRetry(false)}
        onConfirm={() => { setConfirmRetry(false); enqueue('retry_failed', 'Retry failed'); }}
      />
    </div>
  );
}

export default SapLogPage;
