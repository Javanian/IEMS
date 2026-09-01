import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../utils/navigation';
import { BarChart2, Package, AlertTriangle, Clock, TrendingUp } from 'lucide-react';
import { PageContainer, AppHeader, Button } from '../components';
import KpiCard from '../components/dashboard/KpiCard';
import DashboardFilters from '../components/dashboard/DashboardFilters';
import ChartErrorBoundary from '../components/dashboard/ChartErrorBoundary';
import OrderStatusChart from '../components/dashboard/OrderStatusChart';
import WorkloadChart from '../components/dashboard/WorkloadChart';
import DailyHoursChart from '../components/dashboard/DailyHoursChart';
import OperatorEfficiencyChart from '../components/dashboard/OperatorEfficiencyChart';
import OnTimeChart from '../components/dashboard/OnTimeChart';
import ProgressHistogramChart from '../components/dashboard/ProgressHistogramChart';
import ValidationRateChart from '../components/dashboard/ValidationRateChart';
import OperatorHeatmap from '../components/dashboard/OperatorHeatmap';

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

function defaultFilters() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: toDateStr(from), to: toDateStr(to), workcenter: 'all' };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(defaultFilters);
  const [kpi, setKpi] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  useEffect(() => {
    setKpiLoading(true);
    fetch('/api/dashboard/kpi')
      .then((r) => r.json())
      .then((json) => setKpi(json.data))
      .catch(() => setKpi(null))
      .finally(() => setKpiLoading(false));
  }, []);

  return (
    <PageContainer>
      <AppHeader
        title={
          <>
            <BarChart2 className="inline w-5 h-5 mr-1.5" />
            Dashboard
          </>
        }
        rightContent={
          <Button variant="secondary" size="small" onClick={() => goBackOrFallback(navigate)}>
            ← Back
          </Button>
        }
      />

      {}
      <DashboardFilters filters={filters} onChange={setFilters} />

      {}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Active Orders"
          value={kpi ? kpi.active_orders.toLocaleString() : '—'}
          icon={Package}
          color="#0096c7"
          loading={kpiLoading}
        />
        <KpiCard
          title="Overdue Orders"
          value={kpi ? kpi.overdue_orders.toLocaleString() : '—'}
          icon={AlertTriangle}
          color="#f87171"
          loading={kpiLoading}
        />
        <KpiCard
          title="Hours Today"
          value={kpi ? kpi.today_hours.toLocaleString() : '—'}
          unit="hrs"
          icon={Clock}
          color="#023e8a"
          loading={kpiLoading}
        />
        <KpiCard
          title="Avg Progress"
          value={kpi ? kpi.avg_progress.toLocaleString() : '—'}
          unit="%"
          icon={TrendingUp}
          color="#0077b6"
          loading={kpiLoading}
        />
      </div>

      {}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {}
        <ChartErrorBoundary>
          <OrderStatusChart />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <ProgressHistogramChart />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <WorkloadChart />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <OnTimeChart />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <DailyHoursChart workcenter={filters.workcenter} days={30} />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <OperatorEfficiencyChart
            from={filters.from}
            to={filters.to}
            workcenter={filters.workcenter}
          />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <ValidationRateChart workcenter={filters.workcenter} />
        </ChartErrorBoundary>

        {}
        <ChartErrorBoundary>
          <OperatorHeatmap days={30} />
        </ChartErrorBoundary>
      </div>
    </PageContainer>
  );
}
