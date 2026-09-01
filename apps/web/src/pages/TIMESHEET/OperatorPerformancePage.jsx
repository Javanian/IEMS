import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Layers3, Loader2, Search, UsersRound } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

const fmtNumber = (value, digits = 2) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(digits) : '0.00';
};

const fmtSeconds = (value) => {
  const total = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const fmtPlanHours = (value) => fmtSeconds(Number(value || 0) * 3600);

const fmtDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const buildQuery = ({ search, startDate, endDate, workcenter }) => {
  const params = new URLSearchParams();
  if (search?.trim()) params.set('search', search.trim());
  if (startDate) params.set('start', startDate);
  if (endDate) params.set('end', endDate);
  if (workcenter) params.set('workcenter', workcenter);
  return params.toString();
};

const MetricPill = ({ label, value, tone = 'sky' }) => {
  const tones = {
    sky: 'bg-[#eaf8fc] text-[#0077b6] border-[#90e0ef]',
    emerald: 'bg-[#eefaf4] text-[#047857] border-[#bbf7d0]',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div
      className={`flex h-[52px] min-w-[112px] flex-col items-center justify-center rounded-lg border px-2.5 py-1 text-center ${tones[tone] || tones.sky}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-extrabold">{value}</div>
    </div>
  );
};

export default function OperatorPerformancePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [startDate, setStartDate] = useState(searchParams.get('start') || '');
  const [endDate, setEndDate] = useState(searchParams.get('end') || '');
  const [workcenter, setWorkcenter] = useState(searchParams.get('workcenter') || '');
  const [workcenters, setWorkcenters] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [expandedOperations, setExpandedOperations] = useState(new Set());
  const [operationsByOrder, setOperationsByOrder] = useState({});
  const [transactionsByOperation, setTransactionsByOperation] = useState({});

  const queryString = useMemo(
    () => buildQuery({ search, startDate, endDate, workcenter }),
    [search, startDate, endDate, workcenter]
  );

  const workcenterQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.set('start', startDate);
    if (endDate) params.set('end', endDate);
    return params.toString();
  }, [startDate, endDate]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/timesheet/operator-performance/orders${queryString ? `?${queryString}` : ''}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal load operator performance');
      setOrders(json.data || []);
    } catch (err) {
      toast.error('Gagal load Operator Performance', { description: err.message });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (startDate) params.start = startDate;
    if (endDate) params.end = endDate;
    if (workcenter) params.workcenter = workcenter;
    setSearchParams(params, { replace: true });
    fetchOrders();
    setExpandedOrders(new Set());
    setExpandedOperations(new Set());
    setOperationsByOrder({});
    setTransactionsByOperation({});
  }, [fetchOrders, search, startDate, endDate, workcenter, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `${API_BASE}/timesheet/operator-performance/workcenters${workcenterQueryString ? `?${workcenterQueryString}` : ''}`
    )
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error || 'Gagal load workcenter');
        if (!cancelled) {
          const rows = json.data || [];
          setWorkcenters(rows);
          if (workcenter && !rows.some((row) => row.workcentercode === workcenter)) {
            setWorkcenter('');
          }
        }
      })
      .catch((err) => {
        if (!cancelled) toast.error('Gagal load workcenter', { description: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [workcenterQueryString]);

  const loadOperations = useCallback(
    async (orderNo) => {
      if (operationsByOrder[orderNo]?.data) return;
      setOperationsByOrder((prev) => ({
        ...prev,
        [orderNo]: { data: prev[orderNo]?.data || [], loading: true },
      }));
      try {
        const res = await fetch(
          `${API_BASE}/timesheet/operator-performance/orders/${encodeURIComponent(orderNo)}/operations${queryString ? `?${queryString}` : ''}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Gagal load operation');
        setOperationsByOrder((prev) => ({
          ...prev,
          [orderNo]: { data: json.data || [], loading: false },
        }));
      } catch (err) {
        toast.error('Gagal load operation', { description: err.message });
        setOperationsByOrder((prev) => ({ ...prev, [orderNo]: { data: [], loading: false } }));
      }
    },
    [operationsByOrder, queryString]
  );

  const loadTransactions = useCallback(
    async (orderNo, operationNo) => {
      const key = `${orderNo}::${operationNo}`;
      if (transactionsByOperation[key]?.data) return;
      setTransactionsByOperation((prev) => ({
        ...prev,
        [key]: { data: prev[key]?.data || [], loading: true },
      }));
      try {
        const res = await fetch(
          `${API_BASE}/timesheet/operator-performance/orders/${encodeURIComponent(orderNo)}/operations/${encodeURIComponent(operationNo)}/timesheets${queryString ? `?${queryString}` : ''}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Gagal load transaksi');
        setTransactionsByOperation((prev) => ({
          ...prev,
          [key]: { data: json.data || [], loading: false },
        }));
      } catch (err) {
        toast.error('Gagal load transaksi', { description: err.message });
        setTransactionsByOperation((prev) => ({ ...prev, [key]: { data: [], loading: false } }));
      }
    },
    [transactionsByOperation, queryString]
  );

  const toggleOrder = (orderNo) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderNo)) next.delete(orderNo);
      else {
        next.add(orderNo);
        loadOperations(orderNo);
      }
      return next;
    });
  };

  const toggleOperation = (orderNo, operationNo) => {
    const key = `${orderNo}::${operationNo}`;
    setExpandedOperations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        loadTransactions(orderNo, operationNo);
      }
      return next;
    });
  };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#f4fbfd]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#90e0ef] bg-white px-4 py-3 shadow-sm">
        <button
          onClick={() => navigate('/timesheet-validation')}
          className="inline-flex items-center gap-2 rounded-lg border border-[#90e0ef] bg-white px-3 py-2 text-sm font-bold text-[#0077b6] hover:bg-[#caf0f8]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0096c7]">
            By Component
          </p>
          <h1 className="text-lg font-extrabold text-[#03045e]">Operator Performance</h1>
        </div>
        <div className="w-[76px]" />
      </header>

      <section className="shrink-0 border-b border-[#ade8f4] bg-[#eaf8fc] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, SSBR, part name..."
              className="h-10 w-full rounded-lg border border-[#90e0ef] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-[#caf0f8]"
            />
          </div>
          <select
            value={workcenter}
            onChange={(e) => setWorkcenter(e.target.value)}
            className="h-10 min-w-[220px] rounded-lg border border-[#90e0ef] bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#0096c7]"
          >
            <option value="">All Workcenter</option>
            {workcenters.map((wc) => (
              <option key={wc.workcentercode} value={wc.workcentercode}>
                {wc.workcentercode}
                {wc.workcenterdescription ? ` - ${wc.workcenterdescription}` : ''}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-10 rounded-lg border border-[#90e0ef] px-3 text-sm outline-none focus:border-[#0096c7]"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-10 rounded-lg border border-[#90e0ef] px-3 text-sm outline-none focus:border-[#0096c7]"
          />
          <button
            onClick={() => {
              setSearch('');
              setStartDate('');
              setEndDate('');
              setWorkcenter('');
            }}
            className="h-10 rounded-lg border border-[#90e0ef] bg-white px-3 text-sm font-bold text-[#0077b6] hover:bg-[#caf0f8]"
          >
            Clear
          </button>
        </div>
      </section>

      <main className="flex-1 overflow-auto p-4">
        <div className="overflow-hidden rounded-xl border border-[#90e0ef] bg-white shadow-sm">
          <div className="grid grid-cols-[44px_1.05fr_0.9fr_1.35fr_76px_112px_112px_112px] items-center gap-2 border-b border-[#90e0ef] bg-[#0077b6] px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-white">
            <div />
            <div>Order No</div>
            <div>SSBR ID</div>
            <div>Part Name</div>
            <div className="text-center">Ops</div>
            <div className="text-center">Plan</div>
            <div className="text-center">Actual</div>
            <div className="text-center">Std Perf</div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm font-semibold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-sm font-semibold text-slate-400">
              Tidak ada data SOW
            </div>
          ) : (
            orders.map((order) => {
              const isOpen = expandedOrders.has(order.order_no);
              const opsState = operationsByOrder[order.order_no];
              return (
                <div key={order.order_no} className="border-b border-[#ade8f4] last:border-b-0">
                  <button
                    onClick={() => toggleOrder(order.order_no)}
                    className={`grid w-full grid-cols-[44px_1.05fr_0.9fr_1.35fr_76px_112px_112px_112px] items-center gap-2 border-l-4 px-3 py-3 text-left transition-colors ${isOpen ? 'border-l-[#0077b6] bg-white hover:bg-white' : 'border-l-transparent bg-white hover:bg-slate-50'}`}
                  >
                    <div className="flex justify-center">
                      <span
                        className={`rounded-full border p-1 ${isOpen ? 'border-[#0096c7] bg-[#0096c7] text-white' : 'border-[#90e0ef] bg-white text-[#0077b6]'}`}
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                      </span>
                    </div>
                    <div className="font-mono text-sm font-extrabold text-[#03045e]">
                      {order.order_no}
                    </div>
                    <div className="text-sm font-bold text-[#0077b6]">{order.ssbr_id || '-'}</div>
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {order.part_name || '-'}
                    </div>
                    <div className="text-center text-sm font-bold text-[#023e8a]">
                      {order.operation_count}
                    </div>
                    <div className="text-center font-mono text-sm font-bold text-slate-700">
                      {fmtPlanHours(order.planhours)}
                    </div>
                    <div className="text-center font-mono text-sm text-slate-800">
                      {fmtSeconds(order.elapsed_seconds)}
                    </div>
                    <div className="text-center font-mono text-sm font-extrabold text-emerald-700">
                      {fmtSeconds(order.std_performance)}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-l-4 border-l-[#90e0ef] border-t border-[#90e0ef] bg-white px-4 py-3">
                      {opsState?.loading ? (
                        <div className="flex items-center gap-2 py-4 text-sm font-semibold text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading operations...
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(opsState?.data || []).map((op) => {
                            const opKey = `${op.order_no}::${op.operation_no}`;
                            const opOpen = expandedOperations.has(opKey);
                            const trxState = transactionsByOperation[opKey];
                            return (
                              <div
                                key={opKey}
                                className="overflow-hidden rounded-lg border border-[#90e0ef] bg-white shadow-sm"
                              >
                                <button
                                  onClick={() => toggleOperation(op.order_no, op.operation_no)}
                                  className={`grid w-full grid-cols-[36px_80px_1fr_112px_112px_112px] items-center gap-2 border-l-4 px-3 py-2 text-left transition-colors ${opOpen ? 'border-l-[#0096c7] bg-white hover:bg-white' : 'border-l-transparent bg-white hover:bg-slate-50'}`}
                                >
                                  <ChevronRight
                                    className={`h-4 w-4 text-[#0077b6] transition-transform ${opOpen ? 'rotate-90' : ''}`}
                                  />
                                  <div className="rounded-md border border-[#90e0ef] bg-[#eaf8fc] px-2 py-1 text-center font-mono text-xs font-extrabold text-[#023e8a]">
                                    {op.operation_no}
                                  </div>
                                  <div>
                                    <div className="text-sm font-extrabold text-slate-800">
                                      {op.operation_text || '-'}
                                    </div>
                                    <div className="text-[11px] font-semibold text-[#0077b6]">
                                      {op.workcenter || '-'}{' '}
                                      {op.workcenterdescription
                                        ? `- ${op.workcenterdescription}`
                                        : ''}
                                    </div>
                                  </div>
                                  <MetricPill
                                    label="Plan"
                                    value={fmtPlanHours(op.planhours)}
                                    tone="slate"
                                  />
                                  <MetricPill
                                    label="Actual"
                                    value={fmtSeconds(op.elapsed_seconds)}
                                    tone="sky"
                                  />
                                  <MetricPill
                                    label="Std"
                                    value={fmtSeconds(op.std_performance)}
                                    tone="emerald"
                                  />
                                </button>

                                {opOpen && (
                                  <div className="border-l-4 border-l-[#ade8f4] border-t border-[#90e0ef] bg-white">
                                    <div className="grid grid-cols-[1.1fr_1fr_120px_120px_120px_120px] gap-2 bg-[#eaf8fc] px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-[#023e8a]">
                                      <div>Check In</div>
                                      <div>Full Name</div>
                                      <div>Serial</div>
                                      <div className="text-center">Remaining</div>
                                      <div className="text-center">Actual</div>
                                      <div className="text-center">Std Perf</div>
                                    </div>
                                    {trxState?.loading ? (
                                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading transactions...
                                      </div>
                                    ) : (trxState?.data || []).length === 0 ? (
                                      <div className="px-3 py-4 text-sm font-semibold text-slate-400">
                                        Belum ada transaksi timesheet
                                      </div>
                                    ) : (
                                      trxState.data.map((trx) => (
                                        <div
                                          key={trx.tsnumber}
                                          className="grid grid-cols-[1.1fr_1fr_120px_120px_120px_120px] gap-2 border-t border-[#d8f3f8] bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                        >
                                          <div className="font-mono text-slate-700">
                                            {fmtDateTime(trx.longdate_checkin)}
                                          </div>
                                          <div className="font-semibold text-slate-800">
                                            <UsersRound className="mr-1 inline h-3.5 w-3.5 text-[#0096c7]" />
                                            {trx.full_name || '-'}
                                          </div>
                                          <div className="font-mono text-xs text-slate-600">
                                            {trx.serialnumber || '-'}
                                          </div>
                                          <div className="text-center font-mono text-slate-700">
                                            {fmtSeconds(trx.remaining_seconds_before)}
                                          </div>
                                          <div className="text-center font-mono text-slate-700">
                                            {fmtSeconds(trx.elapsed_seconds)}
                                          </div>
                                          <div className="text-center font-mono font-bold text-emerald-700">
                                            {fmtSeconds(trx.std_performance)}
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
