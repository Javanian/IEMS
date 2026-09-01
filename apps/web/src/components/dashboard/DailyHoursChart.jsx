import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function ChartSkeleton() {
  return <div className="h-56 bg-slate-50 animate-pulse rounded-lg" />;
}

export default function DailyHoursChart({ workcenter = 'all', days = 30 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ workcenter, days });
    fetch(`/api/dashboard/daily-hours?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const rows = (json.data || []).map((d) => ({
          ...d,
          label: d.day ? d.day.slice(5) : '',
        }));
        setData(rows);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workcenter, days]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-[#03045e] mb-4">
        Daily Working Hours Trend
        <span className="text-xs font-normal text-slate-400 ml-2">(last {days} days)</span>
      </h3>
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <p className="text-xs text-red-500 text-center py-10">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-10">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit=" h" />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(v) => [`${v} hrs`, 'Total Hours']}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Line
              type="monotone"
              dataKey="total_hours"
              stroke="#0096c7"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
