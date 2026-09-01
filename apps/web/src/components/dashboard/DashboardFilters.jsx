import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';

export default function DashboardFilters({ filters, onChange }) {
  const [workcenters, setWorkcenters] = useState([]);

  useEffect(() => {
    fetch('/api/dashboard/workcenter-list')
      .then((r) => r.json())
      .then((json) => setWorkcenters(json.data || []))
      .catch(() => {});
  }, []);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-slate-500">
        <Filter size={16} />
        <span className="text-sm font-medium">Filters</span>
      </div>

      <div className="flex flex-wrap gap-3 flex-1">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">From</label>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] text-[#03045e]"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">To</label>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] text-[#03045e]"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">Workcenter</label>
          <select
            value={filters.workcenter}
            onChange={(e) => onChange({ ...filters, workcenter: e.target.value })}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] text-[#03045e] bg-white"
          >
            <option value="all">All</option>
            {workcenters.map((w) => (
              <option key={w.workcenter} value={w.workcenter}>
                {w.workcenter}
                {w.workcenter_description ? ` — ${w.workcenter_description}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
