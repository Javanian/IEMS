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
  return <div className="h-56 bg-slate-50 animate-pulse rounded-lg" />;
}

export default function OnTimeChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard/ontime-monthly')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setData(json.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">
        On-Time vs Overdue Orders per Month
      </h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(v, name) => [
                v,
                name === 'on_time' ? 'On Time' : name === 'overdue' ? 'Overdue' : 'In Progress',
              ]}
            />
            <Legend
              formatter={(v) => (
                <span style={{ fontSize: 11 }}>
                  {v === 'on_time' ? 'On Time' : v === 'overdue' ? 'Overdue' : 'In Progress'}
                </span>
              )}
            />
            <Bar
              dataKey="on_time"
              stackId="a"
              fill="#0096c7"
              name="on_time"
              radius={[0, 0, 0, 0]}
            />
            <Bar dataKey="in_progress" stackId="a" fill="#caf0f8" name="in_progress" />
            <Bar
              dataKey="overdue"
              stackId="a"
              fill="#f87171"
              name="overdue"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
