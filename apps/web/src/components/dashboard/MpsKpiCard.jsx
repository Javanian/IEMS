import React, { memo } from 'react';

const scoreColors = {
  good: { bg: '#ecfdf5', border: '#a7f3d0', text: '#059669', dot: '#10b981' },
  warning: { bg: '#fffbeb', border: '#fde68a', text: '#d97706', dot: '#f59e0b' },
  critical: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626', dot: '#ef4444' },
};

function MpsKpiCard({ title, value, unit, trend, score, loading }) {
  const colors = scoreColors[score] || scoreColors.good;

  return (
    <div
      className="rounded-xl border shadow-sm p-4 flex items-center gap-4 transition-opacity duration-150"
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
    >
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: colors.dot }} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate">
          {title}
        </p>
        {loading ? (
          <div className="h-7 w-20 bg-slate-200 animate-pulse rounded mt-1" />
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-extrabold leading-tight" style={{ color: colors.text }}>
              {value ?? '—'}
            </span>
            {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
          </div>
        )}
        {trend !== undefined && trend !== 0 && !loading && (
          <span
            className={`text-[10px] font-semibold ${
              trend > 0 ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {trend > 0 ? '▲' : '▼'} {Math.abs(trend)}% vs kemarin
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(MpsKpiCard);
