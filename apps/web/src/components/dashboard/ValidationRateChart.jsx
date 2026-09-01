import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

function ChartSkeleton() {
  return <div className="h-56 bg-slate-50 animate-pulse rounded-lg" />;
}

export default function ValidationRateChart({ workcenter = 'all' }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ workcenter });
    fetch(`/api/dashboard/validation-rate?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setData(json.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workcenter]);

  const chartHeight = Math.max(240, (data.length || 5) * 44);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">
        Process Control Validation Rate
        <span className="text-xs font-normal text-slate-400 ml-2">(pass rate per workcenter)</span>
      </h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No process control data</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 40, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <YAxis
              type="category"
              dataKey="workcenter"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={70}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(v, name) => {
                if (name === 'pass_rate') return [`${v}%`, 'Pass Rate'];
                return [v, name];
              }}
            />
            <ReferenceLine x={80} stroke="#fbbf24" strokeDasharray="4 2" />
            <Bar dataKey="pass_rate" radius={[0, 3, 3, 0]}>
              {data.map((entry) => (
                <Cell
                  key={entry.workcenter}
                  fill={
                    entry.pass_rate >= 80
                      ? '#0096c7'
                      : entry.pass_rate >= 50
                        ? '#00b4d8'
                        : '#f87171'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
