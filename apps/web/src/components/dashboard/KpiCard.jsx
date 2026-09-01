export default function KpiCard({ title, value, unit, icon: Icon, color, loading }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: color + '20' }}
      >
        <Icon size={22} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">{title}</p>
        {loading ? (
          <div className="h-7 w-20 bg-slate-100 animate-pulse rounded mt-1" />
        ) : (
          <p className="text-2xl font-bold text-[#03045e] leading-tight">
            {value}
            {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
