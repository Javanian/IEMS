import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  PackageSearch,
  Layers,
  ChevronRight,
  AlertCircle,
  ClipboardList,
} from 'lucide-react';
import { goBackOrFallback } from '../utils/navigation';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SearchInput from '../components/forms/SearchInput';
import {
  API_BASE,
  ProgressBar,
  SubOperationPanel,
  SubTaskImportButton,
  SubTaskTemplateLink,
  computeRollup,
} from '../features/progress';

const ORDER_PICKER_LIMIT = 50;

export default function ProgressUpdatePage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const ordersAbort = useRef(null);

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [ops, setOps] = useState([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState('');
  const [subState, setSubState] = useState({});
  const [expandedOps, setExpandedOps] = useState(new Set());
  const opsReqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setActiveSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadOrders = useCallback(async (term) => {
    if (ordersAbort.current) ordersAbort.current.abort();
    ordersAbort.current = new AbortController();
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const params = new URLSearchParams({ page: 1, limit: ORDER_PICKER_LIMIT });
      if (term.trim()) params.set('search', term.trim());
      const res = await fetch(`${API_BASE}/sow/grouped?${params}`, {
        signal: ordersAbort.current.signal,
      });
      if (!res.ok) throw new Error('Server error');
      const json = await res.json();
      setOrders(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setOrders([]);
      setTotal(0);
      setOrdersError('Failed to load order list. Try again.');
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders(activeSearch);
  }, [activeSearch, loadOrders]);

  const loadSubtasks = useCallback(async (idsow) => {
    setSubState((prev) => ({
      ...prev,
      [idsow]: { ...(prev[idsow] || {}), loading: true, error: '' },
    }));
    try {
      const res = await fetch(`${API_BASE}/sow/operations/${idsow}/subtasks`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!mountedRef.current) return;
      setSubState((prev) => ({
        ...prev,
        [idsow]: { list: Array.isArray(data) ? data : [], loading: false, error: '' },
      }));
    } catch {
      if (!mountedRef.current) return;
      setSubState((prev) => ({
        ...prev,
        [idsow]: {
          list: prev[idsow]?.list || [],
          loading: false,
          error: 'Failed to load sub-tasks',
        },
      }));
    }
  }, []);

  const loadOps = useCallback(
    async (orderNo) => {
      const reqId = ++opsReqRef.current;
      setOpsLoading(true);
      setOpsError('');
      setOps([]);
      setSubState({});
      setExpandedOps(new Set());
      try {
        const res = await fetch(`${API_BASE}/sow/${encodeURIComponent(orderNo)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (opsReqRef.current !== reqId) return;
        const arr = Array.isArray(data) ? data : [];
        setOps(arr);
        arr.forEach((o) => loadSubtasks(o.idsow));
      } catch {
        if (opsReqRef.current !== reqId) return;
        setOps([]);
        setOpsError('Failed to load operations for this order.');
      } finally {
        if (opsReqRef.current === reqId) setOpsLoading(false);
      }
    },
    [loadSubtasks]
  );

  useEffect(() => {
    if (selectedOrder) loadOps(selectedOrder.order_no);
  }, [selectedOrder, loadOps]);

  const toggleOp = useCallback((idsow) => {
    setExpandedOps((prev) => {
      const next = new Set(prev);
      next.has(idsow) ? next.delete(idsow) : next.add(idsow);
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    loadOrders(activeSearch);
    if (selectedOrder) loadOps(selectedOrder.order_no);
  }, [loadOrders, activeSearch, selectedOrder, loadOps]);

  const busy = ordersLoading || opsLoading;

  const renderOrderCard = (order) => {
    const active = selectedOrder?.order_no === order.order_no;
    return (
      <button
        key={order.order_no}
        type="button"
        onClick={() => setSelectedOrder(order)}
        aria-pressed={active}
        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all duration-150 active:scale-[0.99]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none
                    ${
                      active
                        ? 'border-[#0077b6] bg-sky-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-sm text-slate-800 truncate tabular-nums">
            {order.order_no}
          </span>
          <span
            className="flex-shrink-0 inline-flex items-center justify-center min-w-[2.25rem] px-1.5 h-5 rounded-full
                           bg-[#0077b6] text-white text-[11px] font-bold tabular-nums"
          >
            {order.operation_count} ops
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-700 truncate">{order.part_name || '—'}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          {order.part_number && <span className="truncate">{order.part_number}</span>}
          {order.model && (
            <>
              <span className="text-slate-300">·</span>
              <span className="truncate">{order.model}</span>
            </>
          )}
        </div>
        <div className="mt-2">
          <ProgressBar value={order.avg_progress} />
        </div>
      </button>
    );
  };

  const renderOperationCard = (op) => {
    const subs = subState[op.idsow];
    const subLoading = !subs || subs.loading;
    const list = subs?.list || [];
    const hasSubs = list.length > 0;
    const expanded = expandedOps.has(op.idsow);
    const displayProg = hasSubs ? computeRollup(list) : (op.progress ?? null);
    const opText = op.operation_text || op.operationtext || '—';

    return (
      <div
        key={op.idsow}
        className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
      >
        <button
          type="button"
          onClick={() => toggleOp(op.idsow)}
          aria-expanded={expanded}
          className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors
                     hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8]
                     motion-reduce:transition-none"
        >
          <span
            className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg
                           bg-sky-50 text-[#0077b6] font-bold text-xs tabular-nums border border-sky-100"
          >
            {op.operation_no}
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">
              {opText}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
              {op.workcenter && <span className="truncate">{op.workcenter}</span>}
              {op.planhours != null && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="tabular-nums">{Number(op.planhours).toFixed(2)} plan hrs</span>
                </>
              )}
              <span className="text-slate-300">·</span>
              {subLoading ? (
                <span className="text-slate-400">loading sub-tasks…</span>
              ) : hasSubs ? (
                <span className="font-semibold text-[#0077b6] tabular-nums">
                  {list.length} sub-tasks
                </span>
              ) : (
                <span className="text-slate-400">no sub-tasks</span>
              )}
            </div>
          </div>

          <div className="hidden sm:block w-40 flex-shrink-0">
            {subLoading ? (
              <Skeleton className="h-2.5 w-full" />
            ) : (
              <ProgressBar value={displayProg} />
            )}
          </div>

          <ChevronRight
            size={18}
            className={`flex-shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
          />
        </button>

        {}
        <div className="sm:hidden px-4 pb-3">
          {subLoading ? <Skeleton className="h-2.5 w-full" /> : <ProgressBar value={displayProg} />}
        </div>

        {expanded && (
          <SubOperationPanel
            idsow={op.idsow}
            operationNo={op.operation_no}
            partNumber={op.part_number}
            operationText={op.operation_text}
            state={subs}
            onRefresh={() => loadSubtasks(op.idsow)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="h-dvh flex flex-col bg-slate-50 overflow-hidden">
      <PageHeader
        title="Update Progress"
        eyebrow="Foreman · Physical Progress"
        onBack={() => goBackOrFallback(navigate)}
        right={
          <>
            <SubTaskTemplateLink />
            <SubTaskImportButton onImported={handleRefresh} />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={busy}
              className="inline-flex items-center gap-1.5 bg-[#0077b6] hover:bg-[#023e8a] text-white
                         px-3 py-1.5 rounded-lg text-xs font-semibold min-h-[40px]
                         transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]
                         motion-reduce:transition-none motion-reduce:transform-none"
            >
              <RefreshCw
                size={15}
                className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
              />
              <span>Refresh</span>
            </button>
          </>
        }
      />

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {}
        <aside
          className="flex-shrink-0 flex flex-col min-h-0 bg-white border-b md:border-b-0 md:border-r border-slate-200
                          md:w-80 lg:w-96 max-h-[42vh] md:max-h-none"
        >
          <div className="flex-shrink-0 px-4 py-3 border-b border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Select Order
              </h2>
              {!ordersLoading && !ordersError && (
                <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                  {total.toLocaleString('id-ID')} orders
                </span>
              )}
            </div>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search order, part, SSBR..."
            />
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {ordersLoading ? (
              <>
                <Skeleton className="h-[74px] rounded-xl" />
                <Skeleton className="h-[74px] rounded-xl" />
                <Skeleton className="h-[74px] rounded-xl" />
                <Skeleton className="h-[74px] rounded-xl" />
              </>
            ) : ordersError ? (
              <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs text-red-700 font-medium">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  {ordersError}
                </span>
                <button
                  onClick={() => loadOrders(activeSearch)}
                  className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : orders.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                title={activeSearch ? 'Order not found' : 'No orders yet'}
              />
            ) : (
              orders.map(renderOrderCard)
            )}
          </div>
        </aside>

        {}
        <main className="flex-1 overflow-y-auto min-h-0 px-4 md:px-6 py-4">
          {!selectedOrder ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState icon={ClipboardList} title="Select an order to start" />
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              {}
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">
                        Order
                      </span>
                      <span className="text-base font-extrabold text-slate-800 tabular-nums truncate">
                        {selectedOrder.order_no}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700 truncate">
                      {selectedOrder.part_name || '—'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {[selectedOrder.part_number, selectedOrder.model, selectedOrder.ssbr_id]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="w-full sm:w-56 flex-shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                      Order Progress
                    </p>
                    <ProgressBar value={selectedOrder.avg_progress} />
                  </div>
                </div>
              </section>

              {}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2.5">
                  Operations &amp; Progress
                </h3>

                {opsLoading ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                  </div>
                ) : opsError ? (
                  <div className="flex items-center justify-between rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                    <span className="flex items-center gap-2 text-xs text-red-700 font-medium">
                      <AlertCircle size={16} className="flex-shrink-0" />
                      {opsError}
                    </span>
                    <button
                      onClick={() => loadOps(selectedOrder.order_no)}
                      className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                ) : ops.length === 0 ? (
                  <EmptyState icon={Layers} title="No operations" />
                ) : (
                  <div className="space-y-2.5">{ops.map(renderOperationCard)}</div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
