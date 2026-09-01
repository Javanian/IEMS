import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const LIMIT = 20;

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number);
}

function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function OrderProgressDashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [activityDetail, setActivityDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [tsHistory, setTsHistory] = useState(null);
  const [tsLoading, setTsLoading] = useState(false);

  const fetchOrders = useCallback(
    async (p = 1, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const status = filter === 'ongoing' ? 'ongoing' : 'all';
        const filterParam = filter === 'red' || filter === 'yellow' ? `&filter=${filter}` : '';
        const res = await fetch(
          `${API_BASE}/dashboard/order-progress?limit=${LIMIT}&page=${p}&status=${status}${filterParam}`
        );
        const json = await res.json();
        setOrders(json.data || []);
        setTotal(json.pagination?.total || 0);
      } catch {
        if (!silent) setOrders([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    setPage(1);
    (async () => {
      try {
        await fetch(`${API_BASE}/dashboard/refresh-order-matviews`, { method: 'POST' });
      } catch {}
      fetchOrders(1);
    })();
  }, [fetchOrders]);

  useEffect(() => {
    let active = true;
    const timer = setInterval(async () => {
      if (!active) return;
      try {
        await fetch(`${API_BASE}/dashboard/refresh-order-matviews`, { method: 'POST' });
      } catch {}
      if (active) fetchOrders(page, true);
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fetchOrders, page]);

  const fetchDetail = async (orderNo) => {
    if (expandedOrder === orderNo) {
      setExpandedOrder(null);
      return;
    }

    setExpandedOrder(orderNo);
    setDetailLoading(true);
    setTsHistory(null);
    try {
      const res = await fetch(
        `${API_BASE}/dashboard/order-activity-detail/${encodeURIComponent(orderNo)}`
      );
      const json = await res.json();
      setActivityDetail(json.data || []);
    } catch {
      setActivityDetail([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchTimesheetHistory = async (activity) => {
    const histKey = `${activity.order_no}-${activity.operation_no}`;
    if (tsHistory?.key === histKey) {
      setTsHistory(null);
      return;
    }

    setTsHistory({ key: histKey, data: [] });
    setTsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/dashboard/operation-timesheet-history?orderNo=${encodeURIComponent(activity.order_no)}&operationNo=${encodeURIComponent(activity.operation_no)}`
      );
      const json = await res.json();
      setTsHistory({ key: histKey, data: json.data || [] });
    } catch {
      setTsHistory({ key: histKey, data: [] });
    } finally {
      setTsLoading(false);
    }
  };

  const sortedOrders = [...orders].sort(
    (a, b) => (b.total_actual_hours || 0) - (a.total_actual_hours || 0)
  );
  const totalPlan = sortedOrders.reduce((sum, order) => sum + (order.total_planhours || 0), 0);
  const totalActual = sortedOrders.reduce((sum, order) => sum + (order.total_actual_hours || 0), 0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const goToPage = (nextPage) => {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setPage(safePage);
    fetchOrders(safePage);
  };

  return (
    <DashboardCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50 text-[#0077b6]">
            <BarChart2 size={18} />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Order Progress Dashboard</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Plan {formatNumber(totalPlan)}h / Actual {formatNumber(totalActual)}h
              {total > 0 && <span className="ml-2">· {total} orders</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {[
              ['all', 'All'],
              ['ongoing', 'Ongoing'],
              ['red', 'Red'],
              ['yellow', 'Yellow'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-extrabold uppercase transition ${
                  filter === key
                    ? 'bg-[#0096c7] text-white'
                    : key === 'red'
                      ? 'text-red-500 hover:bg-red-50'
                      : key === 'yellow'
                        ? 'text-amber-500 hover:bg-amber-50'
                        : key === 'ongoing'
                          ? 'text-emerald-500 hover:bg-emerald-50'
                          : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => fetchOrders(page)}
            disabled={loading}
            className="inline-flex min-h-[32px] items-center gap-2 rounded-md border border-slate-200 px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
          <span className="text-[10px] text-slate-400">auto 5s</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-3 py-3 font-bold" />
              <th className="px-2 py-3 font-bold">SSBR ID</th>
              <th className="px-2 py-3 font-bold">Order No</th>
              <th className="px-2 py-3 font-bold">Part / Customer</th>
              <th className="w-[180px] px-2 py-3 text-center font-bold">Plan vs Actual</th>
              <th className="w-[140px] px-2 py-3 text-center font-bold">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && sortedOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">
                  Loading...
                </td>
              </tr>
            ) : sortedOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-10 text-center text-sm font-semibold text-slate-400"
                >
                  No order progress data
                </td>
              </tr>
            ) : (
              sortedOrders.map((order) => {
                const actualPct = Math.min(200, order.actual_pct || 0);
                const progressPct = order.weighted_progress || 0;
                const isExpandedRow = expandedOrder === order.order_no;
                const barColor = order.is_exceeded
                  ? 'bg-red-500'
                  : actualPct >= 90
                    ? 'bg-amber-500'
                    : 'bg-[#0096c7]';

                return (
                  <React.Fragment key={order.order_no}>
                    <tr
                      className={`cursor-pointer hover:bg-slate-50 ${isExpandedRow ? 'bg-[#caf0f8]/30' : ''}`}
                      onClick={() => fetchDetail(order.order_no)}
                    >
                      <td className="px-3 py-2.5 text-center">
                        <ChevronRight
                          size={14}
                          className={`inline text-slate-400 transition ${isExpandedRow ? 'rotate-90' : ''}`}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="block max-w-[80px] truncate text-[10px] font-bold text-slate-500">
                          {order.ssbr_id || '-'}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {order.order_no}
                        </span>
                        <span className="ml-1.5 text-[10px] text-slate-400">
                          {order.operation_count} ops
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <p className="max-w-[200px] truncate text-xs font-semibold text-slate-800">
                          {order.part_name || '-'}
                        </p>
                        <p className="max-w-[200px] truncate text-[10px] text-slate-400">
                          {order.customer || '-'}
                        </p>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col gap-1">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                              style={{ width: `${Math.min(100, actualPct)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-center whitespace-nowrap">
                            <span
                              className={`w-12 text-center text-[11px] font-semibold ${order.is_exceeded ? 'text-red-600' : actualPct >= 90 ? 'text-amber-600' : 'text-[#0096c7]'}`}
                            >
                              {formatNumber(order.total_actual_hours)}
                            </span>
                            <span className="w-2 text-center text-[10px] text-slate-300">/</span>
                            <span className="w-12 text-center text-[11px] font-semibold text-slate-800">
                              {formatNumber(order.total_planhours)}
                            </span>
                            <span className="ml-0.5 w-3 text-[10px] text-slate-400">h</span>
                            <span className="relative ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center">
                              {order.is_exceeded ? (
                                <AlertCircle size={14} className="text-red-500" />
                              ) : actualPct >= 90 ? (
                                <AlertTriangle size={14} className="text-amber-500" />
                              ) : null}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                              style={{ width: `${Math.min(100, progressPct)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-[10px] font-bold text-slate-600">
                            {progressPct}%
                          </span>
                        </div>
                      </td>
                    </tr>

                    {isExpandedRow && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-4 py-2">
                          {detailLoading ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-5 w-5 animate-spin text-[#0096c7]" />
                            </div>
                          ) : activityDetail && activityDetail.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="px-2 py-1.5 text-left">Op.No</th>
                                    <th className="px-2 py-1.5 text-left">Operation Text</th>
                                    <th className="px-2 py-1.5 text-left">WC</th>
                                    <th className="px-2 py-1.5 text-right">Actual Hrs</th>
                                    <th className="px-2 py-1.5 text-right">Plan Hrs</th>
                                    <th className="px-2 py-1.5 text-right">Weight</th>
                                    <th className="px-2 py-1.5 text-right">Progress</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {activityDetail.map((activity) => {
                                    const tsHours = activity.actual_hours || 0;
                                    const planHours = activity.planhours || 0;
                                    const actualColor =
                                      tsHours > planHours
                                        ? 'text-red-600'
                                        : tsHours >= planHours * 0.9
                                          ? 'text-amber-600'
                                          : 'text-[#0096c7]';
                                    const historyKey = `${activity.order_no}-${activity.operation_no}`;
                                    const showHistory = tsHistory?.key === historyKey;

                                    return (
                                      <React.Fragment key={historyKey}>
                                        <tr
                                          className={`cursor-pointer hover:bg-sky-50 ${showHistory ? 'bg-sky-50' : ''}`}
                                          onClick={() => fetchTimesheetHistory(activity)}
                                        >
                                          <td className="px-2 py-1 font-mono font-bold">
                                            {activity.operation_no}
                                          </td>
                                          <td
                                            className="max-w-[300px] truncate px-2 py-1"
                                            title={activity.operation_text}
                                          >
                                            {activity.operation_text || '-'}
                                          </td>
                                          <td className="px-2 py-1">
                                            {activity.workcenter || '-'}
                                          </td>
                                          <td
                                            className={`px-2 py-1 text-right font-bold ${actualColor}`}
                                          >
                                            {formatNumber(tsHours)}
                                          </td>
                                          <td className="px-2 py-1 text-right font-semibold">
                                            {activity.planhours > 0
                                              ? formatNumber(activity.planhours)
                                              : '-'}
                                          </td>
                                          <td className="px-2 py-1 text-right">
                                            {activity.weight != null
                                              ? `${Math.round((activity.weight || 0) * 100)}%`
                                              : '-'}
                                          </td>
                                          <td className="px-2 py-1 text-right font-bold">
                                            {activity.progress != null
                                              ? `${(activity.progress || 0) * 100}%`
                                              : '-'}
                                          </td>
                                        </tr>

                                        {showHistory && (
                                          <tr>
                                            <td
                                              colSpan={7}
                                              className="border-t border-slate-100 bg-white px-4 py-2"
                                            >
                                              {tsLoading ? (
                                                <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#0096c7]" />
                                              ) : tsHistory.data.length > 0 ? (
                                                <table className="w-full text-[10px]">
                                                  <thead>
                                                    <tr className="uppercase text-slate-400">
                                                      <th className="px-2 py-1 text-left">Date</th>
                                                      <th className="px-2 py-1 text-left">
                                                        Serial No
                                                      </th>
                                                      <th className="px-2 py-1 text-left">
                                                        Operator
                                                      </th>
                                                      <th className="px-2 py-1 text-right">
                                                        Hours
                                                      </th>
                                                      <th className="px-2 py-1 text-right">
                                                        Entries
                                                      </th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-slate-100">
                                                    {tsHistory.data.map((row, index) => (
                                                      <tr
                                                        key={`${row.work_date}-${index}`}
                                                        className="text-slate-600"
                                                      >
                                                        <td className="px-2 py-1">
                                                          {row.work_date}
                                                        </td>
                                                        <td className="px-2 py-1 font-mono">
                                                          {row.serialnumber || '-'}
                                                        </td>
                                                        <td className="px-2 py-1 font-semibold">
                                                          {row.full_name || '-'}
                                                        </td>
                                                        <td className="px-2 py-1 text-right font-bold text-[#0096c7]">
                                                          {formatNumber(row.total_hours)}
                                                        </td>
                                                        <td className="px-2 py-1 text-right">
                                                          {row.entry_count}
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              ) : (
                                                <p className="py-2 text-center text-slate-400">
                                                  No timesheet records
                                                </p>
                                              )}
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="py-2 text-center text-xs text-slate-400">
                              No activity data
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-xs text-slate-400">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </DashboardCard>
  );
}

function OrderProgressDashboardPage() {
  const navigate = useNavigate();
  const isVerified = sessionStorage.getItem('isVerified') === 'true';

  useEffect(() => {
    if (!isVerified) {
      navigate('/welcome?login=admin', { replace: true });
    }
  }, [isVerified, navigate]);

  if (!isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">
        Mengarahkan ke login...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-3 md:px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-950">Order Progress</h1>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              Plan vs actual dengan weight-based progress
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/operations-hub')}
            className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50"
          >
            <ChevronLeft size={16} />
            Operations Hub
          </button>
        </div>
      </header>

      <main className="px-4 py-4 md:px-6">
        <OrderProgressDashboard />
      </main>
    </div>
  );
}

export default OrderProgressDashboardPage;
