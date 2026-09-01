import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  UserX,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const HEAT = ['#eef6fb', '#caf0f8', '#90e0ef', '#00b4d8', '#0077b6', '#023e8a'];

const SEG = { posted: '#059669', eligible: '#d97706', ineligible: '#94a3b8' };

function heatStyle(hours, max) {
  if (!hours || hours <= 0) return { background: '#f8fafc', color: '#cbd5e1' };
  const ratio = max > 0 ? hours / max : 0;
  const idx = Math.min(HEAT.length - 1, 1 + Math.floor(ratio * (HEAT.length - 1)));
  return { background: HEAT[idx], color: idx >= 3 ? '#ffffff' : '#0f172a' };
}

function fmtHours(h) {
  const n = Number(h || 0);
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1);
}

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' });
  return { wd, dm: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) };
}

function fmtTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function SegBar({ total, eligible, posted, height = 'h-2', showLegend = false }) {
  const t = Math.max(Number(total) || 0, 0.0001);
  const p = Math.max(Number(posted) || 0, 0);
  const e = Math.max((Number(eligible) || 0) - p, 0);
  const rest = Math.max(t - p - e, 0);
  const pct = (x) => `${(x / t) * 100}%`;
  return (
    <div>
      <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${height}`}>
        <div style={{ width: pct(p), background: SEG.posted }} title={`Posted ${fmtHours(p)} h`} />
        <div
          style={{ width: pct(e), background: SEG.eligible }}
          title={`Eligible, not posted ${fmtHours(e)} h`}
        />
        <div
          style={{ width: pct(rest), background: SEG.ineligible }}
          title={`Not eligible ${fmtHours(rest)} h`}
        />
      </div>
      {showLegend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <Legend color={SEG.posted} label="Posted" value={p} />
          <Legend color={SEG.eligible} label="Eligible, not posted" value={e} />
          <Legend color={SEG.ineligible} label="Not eligible for SAP" value={rest} />
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
      <span className="font-bold tabular-nums text-slate-800">{fmtHours(value)}h</span>
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, unit, tone, hint }) {
  const tones = {
    blue: 'text-[#0077b6]',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon size={13} className={tones[tone]} /> {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">
        {value}
        <span className="ml-1 text-xs font-semibold text-slate-400">{unit}</span>
      </div>
      {hint && <div className="text-[11px] font-medium text-slate-400">{hint}</div>}
    </div>
  );
}

function SearchPicker({
  endpoint,
  placeholder,
  emptyLabel,
  buildBody,
  keyOf,
  successLabel,
  renderItem,
  onDone,
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`${API_BASE}${endpoint}?search=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((j) => setResults(j.data || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, endpoint]);

  const assign = async (item) => {
    setSavingKey(keyOf(item));
    try {
      const res = await fetch(`${API_BASE}/dashboard/machine-hours-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(item)),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Failed to save');
      toast.success(successLabel(item));
      onDone();
    } catch (e) {
      toast.error('Failed to save', { description: e.message });
      setSavingKey(null);
    }
  };

  return (
    <>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        />
      </div>
      <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-100 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
          </div>
        ) : results.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">{emptyLabel}</div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {results.map((item) => {
              const key = keyOf(item);
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={savingKey !== null}
                    onClick={() => assign(item)}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[#f0fbfe] disabled:opacity-50
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8]"
                  >
                    <div className="min-w-0">{renderItem(item)}</div>
                    {savingKey === key ? (
                      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#0077b6]" />
                    ) : (
                      <Check className="h-4 w-4 flex-shrink-0 text-[#0077b6]" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function EditPanel({ record, onDone, onCancel }) {
  const [mode, setMode] = useState(!record.sn_employee ? 'operator' : 'job');

  return (
    <div className="mt-2 rounded-lg border border-[#90e0ef] bg-[#f0fbfe] p-2">
      <div className="mb-2 flex items-center gap-1">
        {[
          ['job', 'Job'],
          ['operator', 'Operator'],
        ].map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`min-h-[32px] rounded-md px-3 text-xs font-semibold transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
              ${mode === m ? 'bg-[#0077b6] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          <X size={15} />
        </button>
      </div>

      {mode === 'job' ? (
        <SearchPicker
          endpoint="/dashboard/ph3-jobs"
          placeholder="Search order / operation / description…"
          emptyLabel="No matching job"
          buildBody={(j) => ({
            proddataid: record.proddataid,
            order_no: j.order_no,
            operation_no: j.operation_no,
          })}
          keyOf={(j) => `${j.order_no}/${j.operation_no}`}
          successLabel={(j) => `Job ${j.order_no}/${j.operation_no} assigned`}
          renderItem={(j) => (
            <>
              <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800">
                <span>{j.order_no}</span>
                <span className="text-slate-400">/ {j.operation_no}</span>
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {j.operation_short_text || j.order_description || '—'}
              </div>
            </>
          )}
          onDone={onDone}
        />
      ) : (
        <SearchPicker
          endpoint="/dashboard/operators"
          placeholder="Search name / SNSSB…"
          emptyLabel="No matching operator"
          buildBody={(o) => ({ proddataid: record.proddataid, sn_employee: o.snssb })}
          keyOf={(o) => o.snssb}
          successLabel={(o) => `Operator ${o.full_name} assigned`}
          renderItem={(o) => (
            <>
              <div className="truncate text-xs font-bold text-slate-800">{o.full_name || '—'}</div>
              <div className="font-mono text-[11px] text-slate-500">{o.snssb}</div>
            </>
          )}
          onDone={onDone}
        />
      )}
    </div>
  );
}

const DRILL_PAGE = 40;
const BUCKETS = [
  ['all', 'All'],
  ['eligible', 'Eligible'],
  ['ineligible', 'Not eligible'],
  ['posted', 'Posted'],
];

function DrillPanel({ sel, cell, onClose, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [bucket, setBucket] = useState('all');
  const [visible, setVisible] = useState(DRILL_PAGE);

  const load = useCallback(
    (signal) => {
      if (!sel) return;
      setLoading(true);
      setError(null);
      setVisible(DRILL_PAGE);
      const params = new URLSearchParams({ operator: sel.operator_key, day: sel.day });
      if (bucket !== 'all') params.set('bucket', bucket);
      fetch(`${API_BASE}/dashboard/machine-hours-records?${params}`, { signal })
        .then((r) =>
          r.json().then((j) => {
            if (!r.ok) throw new Error(j.error || 'Failed to load records');
            return j;
          })
        )
        .then((j) => setRows(j.data || []))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => setLoading(false));
    },
    [sel, bucket]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const onSaved = () => {
    setEditing(null);
    load();
    onChanged?.();
  };

  if (!sel) return null;
  const { wd, dm } = dayLabel(sel.day);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record ${sel.operator_name} ${sel.day}`}
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">{sel.operator_name}</p>
            <p className="text-xs font-medium text-slate-500">
              {wd}, {dm}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <X size={18} />
          </button>
        </header>

        {cell && (
          <div className="flex-shrink-0 border-b border-slate-100 px-4 py-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Total {fmtHours(cell.total_h)} h · {cell.n_records} records
              </span>
            </div>
            <SegBar
              total={cell.total_h}
              eligible={cell.eligible_h}
              posted={cell.posted_h}
              height="h-2.5"
              showLegend
            />
          </div>
        )}

        {}
        <div className="flex flex-shrink-0 flex-wrap gap-1 border-b border-slate-100 px-4 py-2">
          {BUCKETS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setBucket(k)}
              className={`min-h-[30px] rounded-md px-2.5 text-[11px] font-semibold transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                ${bucket === k ? 'bg-[#0077b6] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
          {!loading && (
            <span className="ml-auto self-center text-[11px] text-slate-400 tabular-nums">
              {rows.length} record(s)
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-red-600">
              <AlertCircle className="h-6 w-6" /> {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">No records</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.slice(0, visible).map((r) => (
                <li key={r.proddataid} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {r.posted ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          <CheckCircle2 size={11} /> Posted
                        </span>
                      ) : r.eligible ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          Eligible
                        </span>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                          Not eligible
                        </span>
                      )}
                      <span className="truncate font-mono text-xs font-bold text-slate-800">
                        {r.order_no || '—'}
                      </span>
                      <span className="font-mono text-xs text-slate-400">
                        / {r.operation_no || '—'}
                      </span>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className="text-xs font-bold tabular-nums text-slate-700">
                        {fmtHours(r.duration_hours)}h
                      </span>
                      {!r.posted && (
                        <button
                          type="button"
                          onClick={() => setEditing(editing === r.proddataid ? null : r.proddataid)}
                          title="Fix job"
                          className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all active:scale-95
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                            ${editing === r.proddataid ? 'border-[#0077b6] bg-[#e8f7fb] text-[#0077b6]' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {r.operation_short_text && (
                    <div
                      className="mt-0.5 truncate text-[11px] text-slate-500"
                      title={r.operation_short_text}
                    >
                      {r.operation_short_text}
                    </div>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="font-mono font-medium text-slate-600">
                      {r.machineid || '—'}
                    </span>
                    {r.machinename && <span className="text-slate-400">{r.machinename}</span>}
                    {r.status_description && (
                      <span className="rounded border border-slate-200 bg-slate-50 px-1 py-px text-[10px] font-medium text-slate-500">
                        {r.status_description}
                      </span>
                    )}
                    <span className="tabular-nums">
                      {fmtTime(r.startdatetime)}–{fmtTime(r.enddatetime)}
                    </span>
                    {!r.eligible && r.ineligible_reason && (
                      <span className="font-medium text-red-500">· {r.ineligible_reason}</span>
                    )}
                  </div>
                  {editing === r.proddataid && (
                    <EditPanel record={r} onDone={onSaved} onCancel={() => setEditing(null)} />
                  )}
                </li>
              ))}
              {rows.length > visible && (
                <li className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + DRILL_PAGE)}
                    className="flex w-full min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                  >
                    <ChevronRight className="h-4 w-4 rotate-90" /> Load more (
                    {rows.length - visible} left)
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MachineHoursMatrix() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const weekAgo = useMemo(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null);

  const fetchMatrix = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ from, to });
        const res = await fetch(`${API_BASE}/dashboard/machine-hours-matrix?${params}`, { signal });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || 'Failed to load matrix');
        setMatrix(payload.data || null);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [from, to]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchMatrix(controller.signal);
    return () => controller.abort();
  }, [fetchMatrix]);

  const preset = (days) => {
    setFrom(new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10));
    setTo(today);
  };

  const maxCell = useMemo(() => {
    if (!matrix) return 0;
    let m = 0;
    for (const v of Object.values(matrix.cells)) if (v.total_h > m) m = v.total_h;
    return m;
  }, [matrix]);

  const t = matrix?.totals;
  const selCell = sel && matrix ? matrix.cells[`${sel.operator_key}|${sel.day}`] : null;

  return (
    <div className="flex flex-col gap-4">
      {}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            From
          </label>
          <input
            type="date"
            value={from}
            max={to}
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
        <div className="flex items-center gap-1.5">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => preset(d)}
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-50 active:scale-95
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            >
              {d}d
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => fetchMatrix()}
          disabled={loading}
          title="Refresh"
          className="ml-auto flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {}
      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            icon={Clock}
            label="Total hours"
            value={fmtHours(t.total_h)}
            unit="h"
            tone="blue"
            hint={`${t.n_records} records`}
          />
          <SummaryCard
            icon={CheckCircle2}
            label="Posted to SAP"
            value={fmtHours(t.posted_h)}
            unit="h"
            tone="emerald"
            hint={t.total_h > 0 ? `${Math.round((t.posted_h / t.total_h) * 100)}% of total` : ' '}
          />
          <SummaryCard
            icon={ChevronRight}
            label="Eligible, not posted"
            value={fmtHours(Math.max(t.eligible_h - t.posted_h, 0))}
            unit="h"
            tone="amber"
            hint="can be staged"
          />
          <SummaryCard
            icon={UserX}
            label="No operator"
            value={fmtHours(t.unattributed_h)}
            unit="h"
            tone="red"
            hint="won’t reach SAP"
          />
        </div>
      )}

      {}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Hours per operator per day</h2>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEG.posted }} /> posted
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEG.eligible }} />{' '}
              eligible
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEG.ineligible }} /> not
              eligible
            </span>
          </div>
        </div>

        {loading && !matrix ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => fetchMatrix()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            >
              <RefreshCw size={16} /> Coba lagi
            </button>
          </div>
        ) : !matrix || matrix.operators.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <Clock className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">No hours in this range</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-slate-200 bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Operator
                  </th>
                  {matrix.days.map((d) => {
                    const { wd, dm } = dayLabel(d);
                    return (
                      <th
                        key={d}
                        className="border-b border-slate-200 bg-white px-2 py-2 text-center"
                      >
                        <div className="text-[10px] font-semibold uppercase text-slate-400">
                          {wd}
                        </div>
                        <div className="text-[11px] font-bold text-slate-600">{dm}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrix.operators.map((op) => (
                  <tr key={op.operator_key} className="group">
                    <td className="sticky left-0 z-10 max-w-[180px] border-b border-slate-100 bg-white px-3 py-1.5 group-hover:bg-slate-50">
                      <div
                        className="truncate text-xs font-bold text-slate-800"
                        title={op.operator_name}
                      >
                        {op.operator_key === '__none__' ? (
                          <span className="inline-flex items-center gap-1 text-red-600">
                            <UserX size={12} />
                            {op.operator_name}
                          </span>
                        ) : (
                          op.operator_name
                        )}
                      </div>
                      <div className="text-[10px] font-medium tabular-nums text-slate-400">
                        {fmtHours(op.total_h)} jam total
                      </div>
                    </td>
                    {matrix.days.map((d) => {
                      const cell = matrix.cells[`${op.operator_key}|${d}`];
                      if (!cell) {
                        return (
                          <td
                            key={d}
                            className="border-b border-l border-slate-100 bg-slate-50/40"
                          />
                        );
                      }
                      const st = heatStyle(cell.total_h, maxCell);
                      const isSel = sel && sel.operator_key === op.operator_key && sel.day === d;
                      const postedRatio = cell.total_h > 0 ? cell.posted_h / cell.total_h : 0;
                      return (
                        <td key={d} className="border-b border-l border-slate-100 p-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setSel({
                                operator_key: op.operator_key,
                                operator_name: op.operator_name,
                                day: d,
                              })
                            }
                            style={st}
                            className={`relative flex h-9 w-full min-w-[46px] flex-col items-center justify-center rounded transition-all hover:brightness-95 active:scale-95
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#023e8a] ${isSel ? 'ring-2 ring-[#023e8a]' : ''}`}
                            title={`${op.operator_name} · ${d}\nTotal ${fmtHours(cell.total_h)}j · terkirim ${fmtHours(cell.posted_h)}j`}
                          >
                            <span className="text-xs font-bold tabular-nums leading-none">
                              {fmtHours(cell.total_h)}
                            </span>
                            <span className="absolute inset-x-1 bottom-0.5 h-[3px] overflow-hidden rounded-full bg-black/15">
                              <span
                                className="block h-full rounded-full"
                                style={{ width: `${postedRatio * 100}%`, background: SEG.posted }}
                              />
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          Number = total hours · green bar in a cell = share already posted to SAP · click a cell to
          see records
        </div>
      </div>

      <DrillPanel
        sel={sel}
        cell={selCell}
        onClose={() => setSel(null)}
        onChanged={() => fetchMatrix()}
      />
    </div>
  );
}
