import React from 'react';
import { ArrowLeft } from 'lucide-react';

export default function PageHeader({ title, eyebrow, onBack, backLabel = 'Back', right }) {
  return (
    <header
      className="flex-shrink-0 grid grid-cols-[auto_1fr_auto] items-center gap-3
                 sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200/80 px-4 md:px-6 py-3"
    >
      {}
      <div className="flex items-center justify-start">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 bg-white border border-slate-200
                       text-slate-700 hover:bg-slate-50 hover:border-slate-300
                       px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm
                       transition-all duration-150 active:scale-95
                       focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none
                       motion-reduce:transition-none motion-reduce:transform-none"
          >
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </button>
        )}
      </div>

      {}
      <div className="min-w-0 text-center">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-600 truncate">
            {eyebrow}
          </div>
        )}
        <h1 className="text-sm md:text-base font-bold tracking-tight text-slate-900 truncate">{title}</h1>
      </div>

      {}
      <div className="flex items-center justify-end gap-2">{right}</div>
    </header>
  );
}
