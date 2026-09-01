import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowDownUp,
  Loader2,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  Wrench,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STATUS_OPTIONS = ['PENDING', 'FAILED', 'SKIPPED', 'POSTED', 'ALL'];
const SORT_OPTIONS = [
  { key: 'date_desc', label: 'Newest day' },
  { key: 'date_asc', label: 'Oldest day' },
  { key: 'hours_desc', label: 'Most hours' },
  { key: 'order_asc', label: 'Order no.' },
];

const STATUS_BADGE = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  POSTED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
  SKIPPED: 'border-slate-200 bg-slate-100 text-slate-600',
  POSTING: 'border-cyan-200 bg-cyan-50 text-[#0077b6]',
};

const fmtHours = (sec) => (Number(sec || 0) / 3600).toFixed(1);
const fmtDate = (v) => {
  if (!v) return '-';
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(v).slice(0, 10)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export default function CorrectionsPanel() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [status, setStatus] = useState('PENDING');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [posting, setPosting] = useState(false);

  const fetchRows = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ status });
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (search) params.set('search', search);
        const res = await fetch(`${API_BASE}/dashboard/sap-corrections?${params}`, { signal });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || 'Failed to load corrections');
        setRows(payload.data || []);
        setSelected(new Set());
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [status, from, to, search]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchRows(controller.signal);
    return () => controller.abort();
  }, [fetchRows]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    const cmp = {
      date_desc: (a, b) => String(b.work_date).localeCompare(String(a.work_date)),
      date_asc: (a, b) => String(a.work_date).localeCompare(String(b.work_date)),
      hours_desc: (a, b) => (b.total_seconds || 0) - (a.total_seconds || 0),
      order_asc: (a, b) => String(a.aufnr || '').localeCompare(String(b.aufnr || '')),
    }[sort];
    return cmp ? arr.sort(cmp) : arr;
  }, [rows, sort]);

  const selectablePending = useMemo(
    () => sorted.filter((r) => r.status === 'PENDING' || r.status === 'FAILED'),
    [sorted]
  );
  const allSelected =
    selectablePending.length > 0 && selectablePending.every((r) => selected.has(r.id));

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set() : new Set(selectablePending.map((r) => r.id))));

  const postSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/post-corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to queue');
      toast.success(`${ids.length} correction(s) queued`, {
        description: 'Processed in the background. Refresh to see status.',
      });
      setSelected(new Set());
    } catch (err) {
      toast.error('Failed to post corrections', { description: err.message });
    } finally {
      setPosting(false);
    }
  };

  const [staging, setStaging] = useState(false);
  const stageEdits = async () => {
    setStaging(true);
    try {
      const res = await fetch(`${API_BASE}/dashboard/sap-ops/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stage_catchup' }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to queue');
      toast.success('Staging queued', {
        description:
          'Building bundles from edited records. Refresh in a moment to see new corrections.',
      });
    } catch (err) {
      toast.error('Failed to stage', { description: err.message });
    } finally {
      setStaging(false);
    }
  };

  const totalHours = useMemo(
    () => sorted.reduce((s, r) => s + (r.total_seconds || 0), 0) / 3600,
    [sorted]
  );

  return (
    <div className="flex flex-col gap-4">
      {}
      <div className="rounded-xl border border-[#90e0ef] bg-[#f0fbfe] px-4 py-3">
        <div className="flex items-start gap-2">
          <Wrench size={16} className="mt-0.5 flex-shrink-0 text-[#0077b6]" />
          <p className="text-xs leading-relaxed text-slate-600">
            <span className="font-bold text-slate-800">Corrections</span> are hours completed{' '}
            <em>after</em> their day was already posted to SAP. They post as a{' '}
            <span className="font-semibold">separate confirmation</span> (SAP adds them to the order
            — no storno needed). The auto-poster skips them; review and post them here manually.
          </p>
        </div>
      </div>

      {}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === 'ALL' ? 'All statuses' : o.charAt(0) + o.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            From
          </label>
          <input
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            To
          </label>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <ArrowDownUp size={11} /> Sort
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <form
          className="flex min-w-[180px] flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order / employee / work center…"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
            />
          </label>
        </form>
        <button
          type="button"
          onClick={() => fetchRows()}
          disabled={loading}
          title="Refresh"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 active:scale-95 disabled:opacity-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={staging}
          onClick={stageEdits}
          title="Build correction bundles from edited records"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          {staging ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}{' '}
          Stage edited records
        </button>
        <button
          type="button"
          disabled={posting || selected.size === 0}
          onClick={postSelected}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-xs font-semibold text-white transition-all hover:bg-[#023e8a] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Post
          selected{selected.size ? ` (${selected.size})` : ''}
        </button>
        <p className="ml-auto text-[11px] text-slate-400 tabular-nums">
          {sorted.length} correction(s) · {totalHours.toFixed(1)} h
        </p>
      </div>

      {}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => fetchRows()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            >
              <RefreshCw size={16} /> Try again
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <Wrench className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">No corrections</p>
            <p className="text-xs text-slate-400">
              Late edits on already-posted days will show up here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead style={{ background: '#caf0f8' }}>
                <tr className="text-[11px] uppercase tracking-wide text-slate-700">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectablePending.length === 0}
                      aria-label="Select all"
                      className="h-4 w-4 rounded border-slate-300 text-[#0077b6] focus:ring-[#00b4d8]"
                    />
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Day</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Order / Op</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Employee</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Machine</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((r) => {
                  const selectable = r.status === 'PENDING' || r.status === 'FAILED';
                  return (
                    <tr key={r.id} className="align-middle transition-colors hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          disabled={!selectable}
                          onChange={() => toggle(r.id)}
                          aria-label={`Select ${r.id}`}
                          className="h-4 w-4 rounded border-slate-300 text-[#0077b6] focus:ring-[#00b4d8] disabled:opacity-40"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[r.status] || STATUS_BADGE.PENDING}`}
                        >
                          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                        </span>
                        {r.status === 'FAILED' && r.sap_error && (
                          <span className="ml-1 text-[11px] text-red-500" title={r.sap_error}>
                            · {String(r.sap_error).slice(0, 24)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs font-medium text-slate-600">
                        {fmtDate(r.work_date)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="font-mono text-xs font-bold text-slate-800">
                          {r.aufnr || '—'}
                        </span>
                        <span className="ml-1 font-mono text-xs text-slate-400">
                          / {r.vornr || '—'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600">
                        {r.pernr || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-500">
                        {r.arbpl || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-bold tabular-nums text-slate-700">
                        {fmtHours(r.total_seconds)}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
