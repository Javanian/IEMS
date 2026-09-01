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

const CustomLabel = ({ x, y, width, value }) => {
  if (!value) return null;
  return (
    <text x={x + width + 4} y={y + 10} fill="#64748b" fontSize={10} textAnchor="start">
      {value}%
    </text>
  );
};

export default function OperatorEfficiencyChart({ from, to, workcenter = 'all' }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      from: from || '',
      to: to || '',
      workcenter,
    });
    fetch(`/api/dashboard/operator-efficiency?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setData(json.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, workcenter]);

  const chartHeight = Math.max(240, (data.length || 5) * 40);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">
        Operator Efficiency
        <span className="text-xs font-normal text-slate-400 ml-2">(top 10, productive only)</span>
      </h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No data for selected period</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 50, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis
              type="number"
              domain={[0, 'dataMax + 20']}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <YAxis
              type="category"
              dataKey="full_name"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={100}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(v, name) => {
                if (name === 'efficiency_pct') return [`${v}%`, 'Efficiency'];
                return [v, name];
              }}
            />
            <ReferenceLine x={100} stroke="#e2e8f0" strokeDasharray="4 2" />
            <Bar dataKey="efficiency_pct" radius={[0, 3, 3, 0]} label={<CustomLabel />}>
              {data.map((entry) => (
                <Cell
                  key={entry.full_name}
                  fill={
                    entry.efficiency_pct >= 100
                      ? '#0096c7'
                      : entry.efficiency_pct >= 70
                        ? '#00b4d8'
                        : '#90e0ef'
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
