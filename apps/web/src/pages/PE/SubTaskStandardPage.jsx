import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, SearchInput, Skeleton } from '../../components';
import { useCan, authHeaders } from '../../rbac';

const API_BASE = import.meta.env.VITE_API_URL || '';
const TEMPLATE_URL = '/templates/sub_task_standard_template.xlsx';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
  return payload;
}

const ACTION_STYLE = {
  create: { label: 'New', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  update: { label: 'Update', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  reject: { label: 'Rejected', cls: 'bg-red-100 text-red-700 border-red-200' },
};

function SummaryChip({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {label}
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

export default function SubTaskStandardPage() {
  const canWrite = useCan('sow_management', 'write');
  const fileRef = useRef(null);

  const [parts, setParts] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedPart, setSelectedPart] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadParts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await request('/sow/subtask-standards/parts');
      setParts(payload.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRows = useCallback(async (partNumber) => {
    setSelectedPart(partNumber);
    setLoading(true);
    setError(null);
    try {
      const payload = await request(
        `/sow/subtask-standards?part_number=${encodeURIComponent(partNumber)}`
      );
      setRows(payload.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadParts();
  }, [loadParts]);

  const upload = useCallback(
    async (commit) => {
      if (!file) return;
      setBusy(true);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('commit', commit ? 'true' : 'false');
        const payload = await request('/sow/subtask-standards/import', {
          method: 'POST',
          body: form,
        });
        setPreview(payload);
        if (commit) {
          const { created, updated, rejected } = payload.summary;
          toast.success('Standard saved', {
            description: `${created} new · ${updated} updated · ${rejected} rejected`,
          });
          setFile(null);
          setPreview(null);
          if (fileRef.current) fileRef.current.value = '';
          await loadParts();
          if (selectedPart) await loadRows(selectedPart);
        }
      } catch (err) {
        toast.error(commit ? 'Save failed' : 'Preview failed', { description: err.message });
      } finally {
        setBusy(false);
      }
    },
    [file, loadParts, loadRows, selectedPart]
  );

  const removeRow = useCallback(
    async (row) => {
      setBusy(true);
      try {
        await request(`/sow/subtask-standards/${row.id}`, { method: 'DELETE' });
        toast.success('Sub-task removed', { description: row.title });
        await loadRows(selectedPart);
        await loadParts();
      } catch (err) {
        toast.error('Remove failed', { description: err.message });
      } finally {
        setBusy(false);
      }
    },
    [loadParts, loadRows, selectedPart]
  );

  const visibleParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter((p) => `${p.part_number} ${p.part_name || ''}`.toLowerCase().includes(q));
  }, [parts, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const key = row.operation_text;
      if (!map.has(key))
        map.set(key, { operation_text: key, operation_no: row.operation_no, items: [] });
      map.get(key).items.push(row);
    });
    return [...map.values()];
  }, [rows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
      {}
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-slate-800">Sub-task standard</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Defined per part number and operation. Matched to orders by operation text.
            </p>
          </div>
          <a
            href={TEMPLATE_URL}
            download
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            <Download className="h-4 w-4" />
            Template
          </a>
        </div>

        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setPreview(null);
              }}
              className="max-w-xs text-xs text-slate-600 file:mr-2 file:min-h-[36px] file:rounded-lg file:border file:border-slate-200 file:bg-slate-50 file:px-3 file:text-xs file:font-semibold file:text-slate-700"
            />
            <button
              type="button"
              onClick={() => upload(false)}
              disabled={!file || busy}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Preview
            </button>
            {preview && preview.summary.total - preview.summary.rejected > 0 && (
              <button
                type="button"
                onClick={() => upload(true)}
                disabled={busy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-xs font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                <CheckCircle2 className="h-4 w-4" />
                Save {preview.summary.total - preview.summary.rejected} rows
              </button>
            )}
          </div>
        )}

        {preview && (
          <div className="mt-3 rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Preview
              </span>
              <SummaryChip label="New" value={preview.summary.created} tone="emerald" />
              <SummaryChip label="Update" value={preview.summary.updated} tone="sky" />
              {preview.summary.rejected > 0 && (
                <SummaryChip label="Rejected" value={preview.summary.rejected} tone="red" />
              )}
              <span className="ml-auto text-xs text-slate-500">
                Nothing is saved until you press Save.
              </span>
            </div>
            <div className="max-h-64 overflow-auto">
              {preview.preview.map((row) => {
                const style = ACTION_STYLE[row.action] || ACTION_STYLE.reject;
                return (
                  <div
                    key={`${row.row}-${row.title}`}
                    className="grid grid-cols-[52px_110px_minmax(0,1fr)_minmax(0,1fr)_74px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0"
                  >
                    <span className="tabular-nums text-slate-400">#{row.row}</span>
                    <span className="truncate font-mono font-bold tabular-nums text-slate-700">
                      {row.part_number || '—'}
                    </span>
                    <span className="truncate text-slate-600" title={row.operation_text}>
                      {row.operation_text || '—'}
                    </span>
                    <span className="truncate font-semibold text-slate-800" title={row.title}>
                      {row.title || '—'}
                    </span>
                    <span
                      className={`justify-self-end rounded-full border px-2 text-[11px] font-bold uppercase ${style.cls}`}
                    >
                      {style.label}
                    </span>
                    {row.reason && (
                      <span className="col-span-5 flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {row.reason}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {}
      <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <h3 className="text-sm font-extrabold text-slate-800">Parts</h3>
            <button
              type="button"
              onClick={loadParts}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="border-b border-slate-200 p-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search part" />
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-auto bg-slate-50 p-2">
            {loading && parts.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))
            ) : visibleParts.length === 0 ? (
              <EmptyState
                icon={FileSpreadsheet}
                title="No standard yet"
                description="Upload the template to start."
              />
            ) : (
              visibleParts.map((part) => (
                <button
                  key={part.part_number}
                  type="button"
                  onClick={() => loadRows(part.part_number)}
                  className={`w-full rounded-lg border bg-white p-2.5 text-left transition hover:border-[#90e0ef] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
                    selectedPart === part.part_number
                      ? 'border-[#0077b6] ring-2 ring-[#90e0ef]'
                      : 'border-slate-200'
                  }`}
                >
                  <span className="block truncate font-mono text-xs font-extrabold tabular-nums text-slate-800">
                    {part.part_number}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {part.part_name || '—'}
                  </span>
                  <span className="mt-1 flex gap-1.5 text-xs text-slate-500 tabular-nums">
                    <span className="rounded bg-slate-100 px-1.5">{part.operations} ops</span>
                    <span className="rounded bg-slate-100 px-1.5">{part.sub_tasks} sub-tasks</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-3 py-2">
            <h3 className="text-sm font-extrabold text-slate-800">
              {selectedPart ? `Operations · ${selectedPart}` : 'Operations'}
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <AlertTriangle className="h-8 w-8 text-red-400" strokeWidth={1.5} />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            ) : !selectedPart ? (
              <EmptyState icon={FileSpreadsheet} title="Select a part" />
            ) : grouped.length === 0 ? (
              <EmptyState icon={FileSpreadsheet} title="No sub-task" />
            ) : (
              grouped.map((group) => (
                <div
                  key={group.operation_text}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#caf0f8] px-3 py-1.5">
                    {group.operation_no != null && (
                      <span className="shrink-0 rounded bg-white px-1.5 font-mono text-xs font-bold tabular-nums text-[#0077b6]">
                        {group.operation_no}
                      </span>
                    )}
                    <span className="truncate text-xs font-extrabold text-slate-700">
                      {group.operation_text}
                    </span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
                    >
                      <span className="w-8 shrink-0 tabular-nums text-slate-400">
                        {row.sort_order}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">
                        {row.title}
                      </span>
                      <span
                        className="shrink-0 rounded bg-slate-100 px-1.5 tabular-nums text-slate-600"
                        title="Standard Hours"
                      >
                        {Number(row.standard_hours)} jam
                      </span>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => removeRow(row)}
                          disabled={busy}
                          aria-label={`Remove ${row.title}`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40 motion-reduce:transition-none"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
