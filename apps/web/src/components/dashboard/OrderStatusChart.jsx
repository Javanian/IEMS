import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = [
  '#0096c7',
  '#023e8a',
  '#00b4d8',
  '#48cae4',
  '#90e0ef',
  '#caf0f8',
  '#03045e',
  '#ade8f4',
  '#0077b6',
  '#023e8a',
];

function ChartSkeleton() {
  return (
    <div className="flex items-center justify-center h-56">
      <div className="w-40 h-40 rounded-full bg-slate-100 animate-pulse" />
    </div>
  );
}

export default function OrderStatusChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard/order-status')
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
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">Order Status Distribution</h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              dataKey="count"
              nameKey="status"
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell key={entry.status} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [value, name]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span style={{ fontSize: 11 }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
