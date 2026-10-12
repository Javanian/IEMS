import { memo, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

function ParetoLossChart({ data, loading }) {
  const chartData = useMemo(() => {
    if (!data || !data.length) return [];
    return data.slice(0, 7).map((d) => ({
      name: d.activity || 'Unknown',
      value: d.total_hours || 0,
      occurrences: d.occurrences || 0,
      pct: d.pct || 0,
    }));
  }, [data]);

  if (loading) {
    return <div className="h-56 bg-slate-50 animate-pulse rounded-lg" />;
  }

  if (!chartData.length) {
    return <p className="text-xs text-slate-400 text-center py-10">No unproductive data</p>;
  }

  const paretoColors = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#84cc16',
    '#22c55e',
    '#06b6d4',
    '#6366f1',
  ];

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 90, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit=" h" />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={85}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          formatter={(v, name, props) => [`${v} hrs (${props.payload.pct}%)`, 'Loss Hours']}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
          {chartData.map((entry, idx) => (
            <Cell key={idx} fill={paretoColors[idx % paretoColors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default memo(ParetoLossChart);
