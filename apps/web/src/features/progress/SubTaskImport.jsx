import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Ban,
  Download,
} from 'lucide-react';
import Skeleton from '../../components/ui/Skeleton';
import { API_BASE, authHeaders } from './helpers';
import { ModalShell } from './primitives';

const IMPORT_URL = `${API_BASE}/sow/subtasks/import`;
const TEMPLATE_URL = '/templates/sub_task_upload_template.xlsx';

export function SubTaskTemplateLink({ className = '' }) {
  return (
    <a
      href={TEMPLATE_URL}
      download
      title="Download template Excel"
      className={`inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700
                  hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold min-h-[40px]
                  transition-all duration-150 active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                  motion-reduce:transition-none motion-reduce:transform-none ${className}`}
    >
      <Download size={15} />
      <span>Template</span>
    </a>
  );
}

async function postImport(file, commit) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('commit', commit ? 'true' : 'false');
  const res = await fetch(IMPORT_URL, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Failed to process file');
  return json;
}

const SummaryTile = ({ label, value, tone }) => {
  const tones = {
    slate: 'bg-slate-50 border-slate-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    blue: 'bg-blue-50 border-blue-200',
    red: 'bg-red-50 border-red-200',
  };
  const text = {
    slate: { label: 'text-slate-500', value: 'text-slate-700' },
    emerald: { label: 'text-emerald-600', value: 'text-emerald-700' },
    blue: { label: 'text-blue-600', value: 'text-blue-700' },
    red: { label: 'text-red-600', value: 'text-red-700' },
  };
  return (
    <div className={`rounded-xl border px-2 py-3 text-center shadow-sm ${tones[tone]}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${text[tone].label}`}>
        {label}
      </div>
      <div className={`text-base font-extrabold tabular-nums ${text[tone].value}`}>{value}</div>
    </div>
  );
};

export function SubTaskImportButton({ onImported, className = '' }) {
  const inputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const runDryRun = useCallback(async (f) => {
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const json = await postImport(f, false);
      setPreview(json);
    } catch (err) {
      setError(err.message || 'Failed to analyze file');
    } finally {
      setLoading(false);
    }
  }, []);

  const openPicker = () => inputRef.current?.click();

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setOpen(true);
    runDryRun(f);
  };

  const closeModal = () => {
    if (committing) return;
    setOpen(false);
    setFile(null);
    setPreview(null);
    setError('');
  };

  const handleCommit = async () => {
    if (!file || committing) return;
    setCommitting(true);
    try {
      const json = await postImport(file, true);
      const { created = 0, updated = 0, rejected = 0 } = json.summary || {};
      toast.success(
        `Import complete — ${created} created, ${updated} updated, ${rejected} rejected`
      );
      setOpen(false);
      setFile(null);
      setPreview(null);
      onImported?.(json);
    } catch (err) {
      toast.error('Import failed: ' + (err.message || 'unknown error'));
    } finally {
      setCommitting(false);
    }
  };

  const summary = preview?.summary || {};
  const rejects = (preview?.preview || []).filter((r) => r.action === 'reject');
  const actionable = (summary.created || 0) + (summary.updated || 0);
  const canCommit = !!preview && !loading && !committing && actionable > 0;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={handleFile}
        className="hidden"
      />

      <button
        type="button"
        onClick={openPicker}
        title="Import sub-task dari template Excel"
        className={`inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700
                    hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold min-h-[40px]
                    transition-all duration-150 active:scale-95
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                    motion-reduce:transition-none motion-reduce:transform-none ${className}`}
      >
        <Upload size={15} />
        <span>Upload Excel</span>
      </button>

      {open && (
        <ModalShell
          title="Import Sub-tasks from Excel"
          subtitle={file?.name}
          onClose={closeModal}
          size="lg"
        >
          {}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
            {loading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Loader2
                    size={16}
                    className="animate-spin motion-reduce:animate-none text-[#0077b6]"
                  />
                  Analyzing file…
                </div>
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-12 rounded-xl" />
                <Skeleton className="h-12 rounded-xl" />
              </div>
            ) : error ? (
              <div className="flex flex-col gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-red-700 font-semibold">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => file && runDryRun(file)}
                  className="self-start text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : preview ? (
              <>
                {}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryTile label="Total" value={summary.total ?? 0} tone="slate" />
                  <SummaryTile label="Created" value={summary.created ?? 0} tone="emerald" />
                  <SummaryTile label="Updated" value={summary.updated ?? 0} tone="blue" />
                  <SummaryTile label="Rejected" value={summary.rejected ?? 0} tone="red" />
                </div>

                {}
                {actionable === 0 ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <Ban size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
                    <p className="text-xs text-amber-800 leading-relaxed">
                      No rows can be processed. Fix rejected rows and re-upload.
                    </p>
                  </div>
                ) : rejects.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-emerald-600" />
                    <p className="text-xs text-emerald-800 leading-relaxed">
                      All rows valid. Click <span className="font-semibold">Apply</span> to commit.
                    </p>
                  </div>
                ) : null}

                {}
                {rejects.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      Rejected Rows
                      <span className="ml-1.5 tabular-nums text-red-600">({rejects.length})</span>
                    </h3>
                    <div className="space-y-2">
                      {rejects.map((r, i) => (
                        <div
                          key={`${r.index}-${i}`}
                          className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                        >
                          <span
                            className="flex-shrink-0 inline-flex items-center justify-center px-1.5 h-5 rounded
                                           bg-red-100 text-red-700 text-[11px] font-bold tabular-nums"
                          >
                            Row {r.index}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-800 truncate">
                              <span className="tabular-nums">{r.order_no || '—'}</span>
                              <span className="text-slate-400"> · Op </span>
                              <span className="tabular-nums">{r.operation_no || '—'}</span>
                              {r.title ? (
                                <span className="text-slate-500"> · {r.title}</span>
                              ) : null}
                            </p>
                            <p className="text-xs text-red-600 leading-snug">
                              {r.reason || 'Rejected'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {}
          <div className="flex-shrink-0 border-t border-slate-200 px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <FileSpreadsheet size={14} className="flex-shrink-0 text-slate-400" />
              <span className="font-semibold text-slate-600">sub_task_upload_template.xlsx</span>
            </span>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={committing}
                className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700
                           hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none motion-reduce:transform-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={!canCommit}
                className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-white bg-[#0077b6] hover:bg-[#023e8a]
                           transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none motion-reduce:transform-none"
              >
                {committing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                    Applying…
                  </span>
                ) : (
                  <>
                    Apply
                    {actionable > 0 ? <span className="tabular-nums"> ({actionable})</span> : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
