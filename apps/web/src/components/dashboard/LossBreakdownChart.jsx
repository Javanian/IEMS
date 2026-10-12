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

function LossBreakdownChart({ data, loading }) {
  const chartData = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'Avail. Loss', value: data.availability_loss || 0, fill: '#f87171' },
      { name: 'Perf. Loss', value: data.performance_loss || 0, fill: '#fb923c' },
      { name: 'Quality Loss', value: data.quality_loss || 0, fill: '#a78bfa' },
    ].filter((d) => d.value > 0);
  }, [data]);

  if (loading) {
    return <div className="h-56 bg-slate-50 animate-pulse rounded-lg" />;
  }

  if (!chartData.length) {
    return <p className="text-xs text-slate-400 text-center py-10">No loss data</p>;
  }

  const totalLoss = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 60, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit=" h" />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={65}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          formatter={(v, name, props) => [
            `${v} hrs (${totalLoss > 0 ? Math.round((v / totalLoss) * 100) : 0}%)`,
            props.payload.name,
          ]}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
          {chartData.map((entry, idx) => (
            <Cell key={idx} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default memo(LossBreakdownChart);
