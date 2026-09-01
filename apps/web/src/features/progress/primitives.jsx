import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { API_BASE, fmtTs, SUBTASK_STATUS } from './helpers';

export const StatusPill = ({ status }) => {
  const m = SUBTASK_STATUS[status] || SUBTASK_STATUS.NOT_STARTED;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${m.cls}`}>
      {m.label}
    </span>
  );
};

export const InfoRow = ({ label, value }) => (
  <div className="flex items-start gap-2">
    <span className="text-[10px] font-semibold text-slate-500 w-24 flex-shrink-0 pt-0.5 uppercase tracking-wide">
      {label}
    </span>
    <span className="text-xs text-slate-800 flex-1 leading-snug">{value || '—'}</span>
  </div>
);

export const ProgressBar = ({ value, className = '' }) => {
  const pct = value == null ? null : Math.min(100, Math.max(0, Number(value)));
  if (pct == null) return <span className="text-slate-300 text-[10px]">—</span>;
  const color =
    pct >= 100
      ? 'bg-emerald-500'
      : pct >= 70
        ? 'bg-blue-500'
        : pct >= 40
          ? 'bg-amber-500'
          : 'bg-slate-400';
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={`text-[11px] font-bold tabular-nums w-8 text-right flex-shrink-0
        ${pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-blue-600' : pct >= 40 ? 'text-amber-600' : 'text-slate-500'}`}
      >
        {pct}%
      </span>
    </div>
  );
};

export const HistoryCard = ({ item, isLatest }) => {
  const [imgOpen, setImgOpen] = useState(false);
  const imgUrl = item.image_path
    ? `${API_BASE}${item.image_path.startsWith('/') ? '' : '/'}${item.image_path}`
    : null;

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 ${isLatest ? 'border-blue-200 bg-blue-50/60' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isLatest && (
            <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
              Latest
            </span>
          )}
          <span
            className={`text-xl font-black tabular-nums ${
              item.progress >= 100
                ? 'text-emerald-600'
                : item.progress >= 70
                  ? 'text-blue-600'
                  : item.progress >= 40
                    ? 'text-amber-600'
                    : 'text-slate-600'
            }`}
          >
            {item.progress}%
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {imgUrl && (
            <button
              onClick={() => setImgOpen(true)}
              title="View photo"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-700 transition-colors text-[10px] font-semibold"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Photo
            </button>
          )}
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-medium leading-tight">
              {fmtTs(item.created_at)}
            </p>
            {item.created_by && (
              <p className="text-[9px] text-slate-400 italic">{item.created_by}</p>
            )}
          </div>
        </div>
      </div>

      <ProgressBar value={item.progress} />

      {item.issue_description && (
        <p className="text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-2">
          {item.issue_description}
        </p>
      )}

      {}
      {imgOpen && imgUrl && (
        <div
          className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setImgOpen(false)}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={imgUrl}
              alt="Documentation"
              className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            />
            <button
              onClick={() => setImgOpen(false)}
              className="absolute top-2 right-2 w-9 h-9 bg-black/60 text-white rounded-full
                         flex items-center justify-center hover:bg-black/80 transition-colors text-lg font-bold"
            >
              ×
            </button>
            <p className="text-center text-white/60 text-xs mt-3">
              {fmtTs(item.created_at)}
              {item.created_by ? ` · ${item.created_by}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export const ModalShell = ({ title, subtitle, onClose, size = 'lg', children }) => {
  const boxRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    boxRef.current?.focus();
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const width = size === 'sm' ? 'md:max-w-md' : 'md:max-w-4xl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-0 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white w-full ${width} rounded-t-2xl md:rounded-2xl shadow-xl max-h-[92vh] flex flex-col overflow-hidden focus:outline-none`}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 truncate">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-400
                      hover:text-slate-600 hover:bg-slate-100 transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
};
