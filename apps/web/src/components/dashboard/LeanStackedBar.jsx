import { memo, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

function LeanStackedBar({ data, loading }) {
  const chartData = useMemo(() => {
    if (!data || !data.daily || !data.daily.length) return [];
    return data.daily.slice(-14).map((d) => ({
      label: d.label || d.day?.slice(5) || '',
      VA: d.va || 0,
      'NNVA / NVA': d.nva_nnva || 0,
    }));
  }, [data]);

  if (loading) {
    return <div className="h-56 bg-slate-50 animate-pulse rounded-lg" />;
  }

  if (!chartData.length) {
    return <p className="text-xs text-slate-400 text-center py-10">No lean data</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit=" h" />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="VA" stackId="a" fill="#0096c7" radius={[4, 4, 0, 0]} />
        <Bar dataKey="NNVA / NVA" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default memo(LeanStackedBar);
