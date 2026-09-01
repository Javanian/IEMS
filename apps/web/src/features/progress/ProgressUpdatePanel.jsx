import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Camera, Loader2, History } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import { authHeaders, compressImage } from './helpers';
import { InfoRow, HistoryCard } from './primitives';

export const ProgressUpdatePanel = ({
  historyUrl,
  submitUrl,
  infoRows,
  buildPayload,
  successMsg,
  onSaved,
}) => {
  const [progress, setProgress] = useState('');
  const [issue, setIssue] = useState('');
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');
  const fileInputRef = useRef(null);

  const lastProgress = history.length > 0 ? history[0].progress : null;

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    setHistError('');
    try {
      const res = await fetch(historyUrl);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistError('Failed to load history.');
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, [historyUrl]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleProgressChange = (val) => {
    setProgress(val);
    setError('');
    const n = parseInt(val, 10);
    if (val === '') {
      setWarn('');
      return;
    }
    if (isNaN(n) || n < 1 || n > 100) {
      setWarn('Enter a number between 1 – 100');
    } else if (lastProgress !== null && n < lastProgress) {
      setWarn(`Cannot be less than last progress (${lastProgress}%)`);
    } else {
      setWarn('');
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setImageData(compressed);
    setImagePreview(compressed);
    e.target.value = '';
  };

  const handleSubmit = async () => {
    const prog = parseInt(progress, 10);
    if (!progress || isNaN(prog) || prog < 1 || prog > 100) {
      setError('Enter valid progress (1 – 100)');
      return;
    }
    if (warn) {
      setError(warn);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(buildPayload(prog, issue.trim() || null, imageData || null)),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j.error || 'Failed to save progress';
        setError(msg);
        toast.error(msg);
        return;
      }
      setProgress('');
      setIssue('');
      setImageData(null);
      setImagePreview(null);
      setWarn('');
      toast.success(successMsg || 'Progress saved');
      await loadHistory();
      onSaved?.();
    } catch (err) {
      const msg = 'Failed: ' + err.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = progress !== '' && !warn && !submitting;

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0">
      {}
      <div className="lg:w-[380px] flex-shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-200">
        <div className="p-5 space-y-4">
          {}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              Info
            </p>
            {infoRows.map((r, i) => (
              <InfoRow key={i} label={r.label} value={r.value} />
            ))}
            {lastProgress !== null && (
              <InfoRow
                label="Last Progress"
                value={
                  <span className="font-bold text-[#0077b6] text-sm tabular-nums">
                    {lastProgress}%
                  </span>
                }
              />
            )}
          </div>

          {}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Progress (1 – 100) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                min={1}
                max={100}
                value={progress}
                onChange={(e) => handleProgressChange(e.target.value)}
                placeholder={lastProgress !== null ? `Last: ${lastProgress}%` : '1 – 100'}
                className={`w-full px-3 py-2.5 pr-9 text-sm bg-white text-slate-800 tabular-nums border rounded-lg
                  focus:outline-none focus:ring-2 transition-all motion-reduce:transition-none
                  ${
                    warn
                      ? 'border-amber-400 focus:ring-amber-400'
                      : 'border-slate-200 focus:ring-[#00b4d8] focus:border-[#0096c7]'
                  }`}
              />
              {progress !== '' && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">
                  %
                </span>
              )}
            </div>
            {warn && <p className="mt-1.5 text-xs text-amber-600 font-medium">{warn}</p>}
          </div>

          {}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Issue / Notes <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              rows={3}
              placeholder="Describe the issue, constraint, or additional note..."
              className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg placeholder-slate-400
                        focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] resize-none transition-all motion-reduce:transition-none"
            />
          </div>

          {}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Photo <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
            {imagePreview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200">
                <img src={imagePreview} alt="Preview" className="w-full h-44 object-cover" />
                <button
                  onClick={() => {
                    setImageData(null);
                    setImagePreview(null);
                  }}
                  aria-label="Remove photo"
                  className="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-full
                            flex items-center justify-center hover:bg-black/80 transition-colors text-sm font-bold"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-24 border-2 border-dashed border-slate-300 rounded-xl
                          flex flex-col items-center justify-center gap-1.5
                          text-slate-400 hover:border-[#0096c7] hover:text-[#0077b6] hover:bg-slate-50
                          transition-all motion-reduce:transition-none"
              >
                <Camera size={26} strokeWidth={1.5} />
                <span className="text-xs font-medium">Take photo / choose image</span>
              </button>
            )}
          </div>

          {}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <span className="text-xs text-red-700 font-medium">{error}</span>
            </div>
          )}

          {}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full min-h-[44px] py-3 rounded-lg text-sm font-bold text-white transition-all active:scale-95
                       bg-[#0077b6] hover:bg-[#023e8a] disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                Saving...
              </span>
            ) : (
              'Save Progress'
            )}
          </button>
        </div>
      </div>

      {}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            Update History
          </span>
          {history.length > 0 && (
            <span className="text-[11px] bg-[#0077b6] text-white rounded-full px-2 py-0.5 font-bold tabular-nums">
              {history.length} notes
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {histLoading ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : histError ? (
            <div className="p-4">
              <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <span className="text-xs text-red-700 font-medium">{histError}</span>
                <button
                  onClick={loadHistory}
                  className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : history.length === 0 ? (
            <EmptyState icon={History} title="No updates yet" />
          ) : (
            <div className="p-4 space-y-3">
              {history.map((h, i) => (
                <HistoryCard key={h.id} item={h} isLatest={i === 0} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
