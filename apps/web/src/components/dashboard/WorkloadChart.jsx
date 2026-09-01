import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

function ChartSkeleton() {
  return (
    <div className="space-y-2 px-4 py-6">
      {[80, 65, 90, 50, 70].map((w, i) => (
        <div
          key={i}
          className="h-6 bg-slate-100 animate-pulse rounded"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

export default function WorkloadChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard/workload')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setData(json.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const chartHeight = Math.max(280, (data.length || 5) * 44);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">
        Workload per Workcenter
        <span className="text-xs font-normal text-slate-400 ml-2">(active orders)</span>
      </h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 20, left: 60, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Hours', position: 'insideBottomRight', offset: 0, fontSize: 10 }}
            />
            <YAxis
              type="category"
              dataKey="workcenter"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={58}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(value, name) => [
                `${value} hrs`,
                name === 'total_planhours' ? 'Plan Hours' : 'Actual Hours',
              ]}
            />
            <Legend
              formatter={(value) => (
                <span style={{ fontSize: 11 }}>
                  {value === 'total_planhours' ? 'Plan Hours' : 'Actual Hours'}
                </span>
              )}
            />
            <Bar
              dataKey="total_planhours"
              fill="#caf0f8"
              radius={[0, 3, 3, 0]}
              name="total_planhours"
            />
            <Bar
              dataKey="total_actual_hours"
              fill="#0096c7"
              radius={[0, 3, 3, 0]}
              name="total_actual_hours"
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
