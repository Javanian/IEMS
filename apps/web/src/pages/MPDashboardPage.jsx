import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../utils/navigation';
import { BarChart2, Wifi, WifiOff } from 'lucide-react';
import useDashboardWebSocket from '../hooks/useDashboardWebSocket';
import MpsKpiCard from '../components/dashboard/MpsKpiCard';
import ChartErrorBoundary from '../components/dashboard/ChartErrorBoundary';
import OeeTrendChart from '../components/dashboard/OeeTrendChart';
import LossBreakdownChart from '../components/dashboard/LossBreakdownChart';
import ParetoLossChart from '../components/dashboard/ParetoLossChart';
import LeanStackedBar from '../components/dashboard/LeanStackedBar';

const EMPTY_DATA = {
  oee: 0,
  availability: 0,
  performance: 0,
  quality: 0,
  active_orders: 0,
  overdue_orders: 0,
  actual_hours: 0,
  plan_hours: 0,
  scores: {
    oee: 'critical',
    availability: 'critical',
    performance: 'critical',
    quality: 'critical',
  },
  trend: [],
  losses: { availability_loss: 0, performance_loss: 0, quality_loss: 0 },
  pareto: [],
  lean: { va_hours: 0, nva_nnva_hours: 0, total_hours: 0, va_pct: 0, nva_nnva_pct: 0 },
};

export default function MPDashboardPage() {
  const navigate = useNavigate();
  const { data, connected } = useDashboardWebSocket(30000);

  const d = data || EMPTY_DATA;
  const liveIndicator = connected;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50">
      {}
      <header className="flex-shrink-0 flex items-center justify-between px-4 md:px-6 py-2.5 bg-white border-b border-slate-200 shadow-sm">
        <button
          onClick={() => goBackOrFallback(navigate)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
        >
          ← Back
        </button>

        <div className="flex items-center gap-3">
          <BarChart2 className="w-5 h-5 text-[#0096c7]" />
          <h1 className="text-sm md:text-base font-extrabold text-slate-800">
            MPS Performance Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-2 min-w-[80px] justify-end">
          {liveIndicator ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
              <Wifi size={12} />
              LIVE
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-400">
              <WifiOff size={12} />
              <span className="hidden md:inline">OFFLINE</span>
            </span>
          )}
        </div>
      </header>

      {}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 bg-slate-50 space-y-4">
        {}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MpsKpiCard title="OEE" value={d.oee} unit="%" score={d.scores?.oee} loading={!data} />
          <MpsKpiCard
            title="Availability"
            value={d.availability}
            unit="%"
            score={d.scores?.availability}
            loading={!data}
          />
          <MpsKpiCard
            title="Performance"
            value={d.performance}
            unit="%"
            score={d.scores?.performance}
            loading={!data}
          />
          <MpsKpiCard
            title="Quality"
            value={d.quality}
            unit="%"
            score={d.scores?.quality}
            loading={!data}
          />
        </div>

        {}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-[#03045e] mb-4">
              OEE & Factor Trend
              <span className="text-xs font-normal text-slate-400 ml-2">(last 14 days)</span>
            </h3>
            <ChartErrorBoundary>
              <OeeTrendChart data={d.trend} loading={!data} />
            </ChartErrorBoundary>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-[#03045e] mb-4">
              Loss Breakdown by Factor
              <span className="text-xs font-normal text-slate-400 ml-2">(today, hours)</span>
            </h3>
            <ChartErrorBoundary>
              <LossBreakdownChart data={d.losses} loading={!data} />
            </ChartErrorBoundary>
          </div>
        </div>

        {}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-[#03045e] mb-4">
              Lean Time Distribution (VA vs NNVA/NVA)
              <span className="text-xs font-normal text-slate-400 ml-2">(last 14 days)</span>
            </h3>
            <ChartErrorBoundary>
              <LeanStackedBar data={d} loading={!data} />
            </ChartErrorBoundary>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-[#03045e] mb-4">
              Top Loss Activities (Pareto)
              <span className="text-xs font-normal text-slate-400 ml-2">(last 30 days)</span>
            </h3>
            <ChartErrorBoundary>
              <ParetoLossChart data={d.pareto} loading={!data} />
            </ChartErrorBoundary>
          </div>
        </div>

        {}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Live Data
              </div>
              <div className="text-sm font-bold text-slate-800">
                {connected ? 'Connected' : 'Disconnected'}
              </div>
              <div className="text-[10px] text-slate-400">WebSocket - 30s interval</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Active Orders
              </div>
              <div className="text-sm font-bold text-slate-800">{d.active_orders}</div>
              <div className="text-[10px] text-red-500">{d.overdue_orders} overdue</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Hours Today
              </div>
              <div className="text-sm font-bold text-slate-800">{d.actual_hours} hrs</div>
              <div className="text-[10px] text-slate-400">Plan: {d.plan_hours} hrs</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Quality Checks
              </div>
              <div className="text-sm font-bold text-slate-800">
                {d.quality_validated}/{d.quality_total}
              </div>
              <div className="text-[10px] text-slate-400">Validated / Total</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
