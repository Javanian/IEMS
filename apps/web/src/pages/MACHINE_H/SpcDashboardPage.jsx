import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, ArrowLeft, RefreshCw } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const RULES = {
  1: 'Beyond 3σ',
  2: '9 in a row on one side',
  3: '6 in a row trending',
};

const WINDOWS = [7, 30, 90];

const fmt = (value, digits = 3) =>
  value == null || !Number.isFinite(Number(value)) ? '–' : Number(value).toFixed(digits);

const formatTime = (iso) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function StatCard({ label, value, sub, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-white border-slate-200 text-slate-700',
    good: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    warn: 'bg-amber-50 border-amber-200 text-amber-700',
    bad: 'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <div className={`rounded-xl border px-3 py-3 shadow-sm ${tones[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{value}</div>
      {sub != null && <div className="text-[11px] font-medium opacity-70">{sub}</div>}
    </div>
  );
}

function capabilityTone(cpk) {
  if (cpk == null) return 'neutral';
  if (cpk >= 1.33) return 'good';
  if (cpk >= 1.0) return 'warn';
  return 'bad';
}

// Dot renderer: out-of-control points are red and larger.
function SignalDot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  const bad = payload?.outOfControl;
  return (
    <circle cx={cx} cy={cy} r={bad ? 4.5 : 2.5} fill={bad ? '#dc2626' : '#1D4ED8'} stroke="#fff" strokeWidth={bad ? 1.5 : 0} />
  );
}

function ChartTooltip({ active, payload, uom }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-slate-800">
        #{p.index} · {formatTime(p.createddate)}
      </div>
      <div className="tabular-nums">
        Value {fmt(p.value)} {uom}
        {p.movingRange != null && <span className="text-slate-500"> · MR {fmt(p.movingRange)}</span>}
      </div>
      <div className="text-slate-500">
        {p.machineid || 'no machine'} · order {p.production_order || '–'}
      </div>
      {p.rules?.length > 0 && (
        <div className="mt-1 font-semibold text-red-600">{p.rules.map((r) => RULES[r]).join(', ')}</div>
      )}
    </div>
  );
}

export default function SpcDashboardPage() {
  const navigate = useNavigate();
  const [parameters, setParameters] = useState([]);
  const [parameterId, setParameterId] = useState('');
  const [days, setDays] = useState(30);
  const [machine, setMachine] = useState('');
  const [spec, setSpec] = useState({ lsl: '', usl: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/process-control/spc/parameters?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => {
        if (cancelled) return;
        setParameters(body.parameters || []);
        setParameterId((current) => {
          if (current) return current;
          const first = (body.parameters || []).find((p) => p.readings > 1);
          return first ? String(first.id_parameter) : '';
        });
      })
      .catch((err) => !cancelled && setError(`Could not load parameters: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const load = useCallback(async () => {
    if (!parameterId) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ parameter: parameterId, days: String(days) });
      if (machine) qs.set('machine', machine);
      if (spec.lsl !== '') qs.set('lsl', spec.lsl);
      if (spec.usl !== '') qs.set('usl', spec.usl);
      const res = await fetch(`${API_BASE}/process-control/spc?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [parameterId, days, machine, spec]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = data?.stats;
  const uom = data?.parameter?.uom || '';
  const signals = useMemo(() => (data?.points || []).filter((p) => p.outOfControl).reverse(), [data]);

  const grouped = useMemo(() => {
    const byProcess = new Map();
    for (const p of parameters) {
      if (!byProcess.has(p.process_name)) byProcess.set(p.process_name, []);
      byProcess.get(p.process_name).push(p);
    }
    return [...byProcess.entries()];
  }, [parameters]);

  const yDomain = useMemo(() => {
    if (!stats) return ['auto', 'auto'];
    const candidates = [stats.min, stats.max, stats.ucl, stats.lcl];
    if (stats.capability?.lsl != null) candidates.push(stats.capability.lsl);
    if (stats.capability?.usl != null) candidates.push(stats.capability.usl);
    const lo = Math.min(...candidates);
    const hi = Math.max(...candidates);
    const pad = (hi - lo || 1) * 0.08;
    return [Number((lo - pad).toFixed(3)), Number((hi + pad).toFixed(3))];
  }, [stats]);

  // Keep the MR control limit inside the axis even when every range is below it.
  const mrDomain = useMemo(() => {
    if (!stats) return [0, 'auto'];
    const top = Math.max(stats.mrUcl || 0, ...(data?.points || []).map((p) => p.movingRange || 0));
    return [0, Number(((top || 1) * 1.1).toFixed(4))];
  }, [stats, data]);

  const inputClass =
    'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-brand-600 focus:outline-none';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-800">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Activity size={16} />
            </span>
            <h1 className="text-sm font-extrabold text-slate-800 md:text-base">PROCESS CONTROL · SPC</h1>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading || !parameterId}
            title="Refresh"
            aria-label="Refresh"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-500">
              Parameter
              <select value={parameterId} onChange={(e) => { setParameterId(e.target.value); setMachine(''); }} className={inputClass}>
                <option value="">Select a numeric parameter…</option>
                {grouped.map(([process, items]) => (
                  <optgroup key={process} label={process}>
                    {items.map((p) => (
                      <option key={p.id_parameter} value={p.id_parameter}>
                        {p.parameter_name}
                        {p.uom ? ` (${p.uom})` : ''} · {p.readings} readings
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              Machine
              <select value={machine} onChange={(e) => setMachine(e.target.value)} className={inputClass}>
                <option value="">All machines</option>
                {(data?.machines || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              Window
              <div className="flex gap-1">
                {WINDOWS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays(d)}
                    className={`h-9 rounded-lg px-3 text-xs font-semibold transition-all active:scale-95 ${
                      days === d ? 'bg-brand-700 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              LSL
              <input type="number" step="any" value={spec.lsl} onChange={(e) => setSpec((s) => ({ ...s, lsl: e.target.value }))} placeholder="optional" className={`${inputClass} w-24`} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              USL
              <input type="number" step="any" value={spec.usl} onChange={(e) => setSpec((s) => ({ ...s, usl: e.target.value }))} placeholder="optional" className={`${inputClass} w-24`} />
            </label>
          </div>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}

          {!parameterId && !error && (
            <p className="py-10 text-center text-xs text-slate-400">No numeric process-control parameter has readings in this window.</p>
          )}

          {data && data.n < 2 && (
            <p className="py-10 text-center text-xs text-slate-400">At least two readings are needed for a control chart.</p>
          )}

          {stats && data.n >= 2 && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <StatCard label="Readings" value={data.n} sub={`last ${data.filters.days} days`} />
                <StatCard label="Mean" value={fmt(stats.mean)} sub={uom || ' '} />
                <StatCard label="Control limits" value={`±${fmt(3 * stats.sigma, 2)}`} sub={`${fmt(stats.lcl)} to ${fmt(stats.ucl)}`} />
                <StatCard
                  label="Signals"
                  value={data.signals.total}
                  sub={`R1 ${data.signals.byRule[1]} · R2 ${data.signals.byRule[2]} · R3 ${data.signals.byRule[3]}`}
                  tone={data.signals.total ? 'bad' : 'good'}
                />
                <StatCard
                  label="Cpk"
                  value={fmt(stats.capability?.cpk, 2)}
                  sub={stats.capability ? `Cp ${fmt(stats.capability.cp, 2)}` : 'enter LSL / USL'}
                  tone={capabilityTone(stats.capability?.cpk)}
                />
              </div>

              <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Individuals · {data.parameter.parameter_name}
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={data.points} margin={{ top: 8, right: 56, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="index" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis domain={yDomain} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<ChartTooltip uom={uom} />} />
                    <ReferenceLine y={stats.ucl} stroke="#dc2626" strokeDasharray="5 3" label={{ value: 'UCL', position: 'right', fontSize: 10, fill: '#dc2626' }} />
                    <ReferenceLine y={stats.mean} stroke="#059669" label={{ value: 'CL', position: 'right', fontSize: 10, fill: '#059669' }} />
                    <ReferenceLine y={stats.lcl} stroke="#dc2626" strokeDasharray="5 3" label={{ value: 'LCL', position: 'right', fontSize: 10, fill: '#dc2626' }} />
                    {stats.capability?.usl != null && (
                      <ReferenceLine y={stats.capability.usl} stroke="#7c3aed" strokeDasharray="2 2" label={{ value: 'USL', position: 'right', fontSize: 10, fill: '#7c3aed' }} />
                    )}
                    {stats.capability?.lsl != null && (
                      <ReferenceLine y={stats.capability.lsl} stroke="#7c3aed" strokeDasharray="2 2" label={{ value: 'LSL', position: 'right', fontSize: 10, fill: '#7c3aed' }} />
                    )}
                    <Line type="linear" dataKey="value" stroke="#2563EB" strokeWidth={1.5} dot={<SignalDot />} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Moving range</h2>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={data.points} margin={{ top: 8, right: 56, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="index" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis domain={mrDomain} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<ChartTooltip uom={uom} />} />
                    <ReferenceLine y={stats.mrUcl} stroke="#dc2626" strokeDasharray="5 3" label={{ value: 'UCL', position: 'right', fontSize: 10, fill: '#dc2626' }} />
                    <ReferenceLine y={stats.mrBar} stroke="#059669" label={{ value: 'MR̄', position: 'right', fontSize: 10, fill: '#059669' }} />
                    <Line type="linear" dataKey="movingRange" stroke="#64748b" strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Out-of-control points ({signals.length})
                </h2>
                {signals.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">The process is in statistical control for this window.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2 text-right">Value</th>
                          <th className="px-3 py-2">Machine</th>
                          <th className="px-3 py-2">Order / op</th>
                          <th className="px-3 py-2">Operator</th>
                          <th className="px-3 py-2">Rule</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.map((p) => (
                          <tr key={`${p.id_processcontroldata}-${p.index}`} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 tabular-nums text-slate-500">{p.index}</td>
                            <td className="px-3 py-1.5">{formatTime(p.createddate)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(p.value)}</td>
                            <td className="px-3 py-1.5">{p.machineid || '–'}</td>
                            <td className="px-3 py-1.5">
                              {p.production_order || '–'}
                              {p.operation_no != null ? ` / ${p.operation_no}` : ''}
                            </td>
                            <td className="px-3 py-1.5">{p.full_name || '–'}</td>
                            <td className="px-3 py-1.5 font-semibold text-red-600">{p.rules.map((r) => RULES[r]).join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="text-[11px] text-slate-400">
                I-MR chart: limits are the mean ± 3σ̂, with σ̂ = MR̄ / 1.128 from the average moving range. Signals follow Nelson rules 1 to 3.
                Cpk ≥ 1.33 is shown green, 1.00 to 1.33 amber, below 1.00 red.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
