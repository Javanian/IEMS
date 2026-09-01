import { useEffect, useState } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function interpolateColor(value, max) {
  if (!max || value === 0) return '#f1f5f9';
  const ratio = value / max;
  if (ratio < 0.33) return '#caf0f8';
  if (ratio < 0.66) return '#0096c7';
  return '#03045e';
}

function ChartSkeleton() {
  return (
    <div className="space-y-2 py-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-6 bg-slate-100 animate-pulse rounded" />
      ))}
    </div>
  );
}

export default function OperatorHeatmap({ days = 30 }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days });
    fetch(`/api/dashboard/operator-heatmap?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setRawData(json.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const operators = [...new Set(rawData.map((d) => d.full_name))].slice(0, 15);
  const matrix = {};
  let maxVal = 0;
  for (const row of rawData) {
    if (!matrix[row.full_name]) matrix[row.full_name] = {};
    matrix[row.full_name][row.hour] = row.activity_count;
    if (row.activity_count > maxVal) maxVal = row.activity_count;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">
        Operator Activity Heatmap
        <span className="text-xs font-normal text-slate-400 ml-2">(last {days} days)</span>
      </h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : operators.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left text-slate-400 font-normal py-1 pr-2 min-w-[100px]">
                  Operator
                </th>
                {HOURS.map((h) => (
                  <th key={h} className="text-center text-slate-400 font-normal w-7 py-1">
                    {h.toString().padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => (
                <tr key={op}>
                  <td className="text-slate-600 py-0.5 pr-2 truncate max-w-[120px]" title={op}>
                    {op}
                  </td>
                  {HOURS.map((h) => {
                    const count = matrix[op]?.[h] || 0;
                    return (
                      <td key={h} className="p-0.5">
                        <div
                          className="w-6 h-5 rounded-sm mx-auto"
                          style={{ backgroundColor: interpolateColor(count, maxVal) }}
                          title={count ? `${count} activity` : ''}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
            <span>Low</span>
            {['#f1f5f9', '#caf0f8', '#0096c7', '#03045e'].map((c) => (
              <div key={c} className="w-4 h-4 rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span>High</span>
          </div>
        </div>
      )}
    </div>
  );
}
