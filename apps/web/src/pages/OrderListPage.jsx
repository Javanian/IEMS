import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { goBackOrFallback } from '../utils/navigation';
import Skeleton from '../components/ui/Skeleton';
import {
  ModalShell,
  ProgressUpdatePanel,
  ProgressBar,
  SubOperationPanel,
  computeRollup,
} from '../features/progress';

const API_BASE = import.meta.env.VITE_API_URL || '';
const PAGE_SIZE_OPTIONS = [25, 50, 100];

const highlight = (text, term) => {
  if (!term || !text) return text ?? '-';
  const str = String(text);
  const idx = str.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return str;
  return (
    <span>
      {str.slice(0, idx)}
      <mark className="bg-amber-200 text-amber-900 font-semibold px-0.5 rounded-sm">
        {str.slice(idx, idx + term.length)}
      </mark>
      {str.slice(idx + term.length)}
    </span>
  );
};

const StatusBadge = ({ value }) => {
  if (!value) return <span className="text-gray-300 text-[10px]">—</span>;
  const lower = value.toLowerCase();
  const cls =
    lower.includes('finish') || lower.includes('complete') || lower.includes('done')
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      : lower.includes('progress') || lower.includes('open')
        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
        : lower.includes('hold') || lower.includes('wait')
          ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
          : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold leading-4 ${cls}`}
    >
      {value}
    </span>
  );
};

const Chevron = ({ open }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    className={`w-3.5 h-3.5 text-blue-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
    />
  </svg>
);

const ProgressModal = ({ op, onClose }) => {
  const infoRows = [
    { label: 'Order No', value: op.order_no },
    { label: 'Op No', value: op.operation_no },
    { label: 'Deskripsi', value: op.operationtext },
    {
      label: 'Workcenter',
      value: [op.workcenter, op.workcenterdescription].filter(Boolean).join(' – '),
    },
    {
      label: 'Plan Hrs',
      value: op.planhours != null ? `${Number(op.planhours).toFixed(2)} hrs` : null,
    },
    { label: 'Status', value: <StatusBadge value={op.status} /> },
  ];
  return (
    <ModalShell
      title="Update Operation Progress"
      subtitle={`${op.order_no} · Op ${op.operation_no}${op.workcenter ? ` / ${op.workcenter}` : ''}`}
      onClose={onClose}
      size="lg"
    >
      <ProgressUpdatePanel
        historyUrl={`${API_BASE}/sow/progress-history/${op.idsow}`}
        submitUrl={`${API_BASE}/sow/progress-history`}
        infoRows={infoRows}
        successMsg="Operation progress saved"
        buildPayload={(prog, issueVal, img) => ({
          operation_id: op.idsow,
          order_no: op.order_no,
          progress: prog,
          issue_description: issueVal,
          image_data: img,
        })}
      />
    </ModalShell>
  );
};

const OperationsPanel = React.memo(({ orderNo, onSelectOp }) => {
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subState, setSubState] = useState({});
  const [expandedOps, setExpandedOps] = useState(new Set());

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setSubState({});
    setExpandedOps(new Set());
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/sow/${encodeURIComponent(orderNo)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setOps(arr);
        arr.forEach((o) => loadSubtasks(o.idsow));
      } catch {
        if (!cancelled) setError('Failed to load operations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderNo, loadSubtasks]);

  const toggleOp = useCallback((idsow) => {
    setExpandedOps((prev) => {
      const next = new Set(prev);
      next.has(idsow) ? next.delete(idsow) : next.add(idsow);
      return next;
    });
  }, []);

  if (loading)
    return (
      <div className="flex items-center gap-2.5 px-6 py-4 bg-slate-50">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-slate-500 font-medium">Loading operations...</span>
      </div>
    );

  if (error)
    return <div className="px-6 py-3 bg-red-50 text-xs text-red-600 font-medium">{error}</div>;

  if (!ops.length)
    return (
      <div className="px-6 py-4 bg-slate-50 text-xs text-slate-400 italic">
        Tidak ada operations untuk order ini.
      </div>
    );

  return (
    <div className="bg-slate-50 border-t border-blue-100">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-200">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          Operations
        </span>
        <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded bg-blue-600 text-white text-[9px] font-bold">
          {ops.length}
        </span>
      </div>

      <div className="px-4 pb-3 pt-1.5">
        <div className="rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gradient-to-r from-blue-700 to-blue-600 text-white">
                <th className="px-3 py-2 text-left w-14 font-semibold tracking-wide">Op No</th>
                <th className="px-3 py-2 text-left font-semibold tracking-wide">
                  Operation Description
                </th>
                <th className="px-3 py-2 text-left w-40 font-semibold tracking-wide">Workcenter</th>
                <th className="px-3 py-2 text-right w-20 font-semibold tracking-wide">Plan Hrs</th>
                <th className="px-3 py-2 text-left w-44 font-semibold tracking-wide">Progress</th>
                <th className="px-3 py-2 text-center w-28 font-semibold tracking-wide">Status</th>
                <th className="px-3 py-2 text-center w-44 font-semibold tracking-wide">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((op, i) => {
                const subs = subState[op.idsow];
                const subLoading = !subs || subs.loading;
                const list = subs?.list || [];
                const hasSubs = list.length > 0;
                const opExpanded = expandedOps.has(op.idsow);
                const displayProg = hasSubs ? computeRollup(list) : (op.progress ?? null);
                return (
                  <React.Fragment key={op.idsow}>
                    <tr
                      className={`border-b border-slate-100 last:border-0
                        ${opExpanded ? 'bg-blue-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}
                    >
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-blue-100 text-blue-800 font-bold text-[10px]">
                          {op.operation_no}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 leading-snug">
                        {op.operationtext || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-blue-800 block">
                          {op.workcenter || '—'}
                        </span>
                        {op.workcenterdescription && (
                          <span className="text-[10px] text-slate-400 block leading-tight">
                            {op.workcenterdescription}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-semibold text-slate-700 tabular-nums">
                          {op.planhours != null ? Number(op.planhours).toFixed(2) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {subLoading ? (
                          <Skeleton className="h-2.5 w-full" />
                        ) : (
                          <div>
                            <ProgressBar value={displayProg} />
                            {hasSubs && (
                              <span className="inline-block mt-1 text-[11px] font-semibold text-[#0077b6] tabular-nums">
                                {list.length} sub-task
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge value={op.status} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => toggleOp(op.idsow)}
                            aria-expanded={opExpanded}
                            className="inline-flex items-center gap-1 min-h-[40px] px-2.5 rounded-lg border border-slate-200 bg-white
                                       text-slate-700 hover:bg-slate-50 hover:border-slate-300 text-xs font-semibold transition-all active:scale-95
                                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                          >
                            <Chevron open={opExpanded} />
                            Sub-task
                            {hasSubs && (
                              <span className="ml-0.5 tabular-nums text-[#0077b6]">
                                ({list.length})
                              </span>
                            )}
                          </button>
                          {subLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400 motion-reduce:animate-none" />
                          ) : !hasSubs ? (
                            <button
                              onClick={() => onSelectOp(op)}
                              className="min-h-[40px] px-3 rounded-lg text-xs font-bold text-white bg-[#0077b6] hover:bg-[#023e8a]
                                         transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                            >
                              Update
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>

                    {opExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <SubOperationPanel
                            idsow={op.idsow}
                            operationNo={op.operation_no}
                            partNumber={op.part_number}
                            operationText={op.operation_text}
                            state={subs}
                            onRefresh={() => loadSubtasks(op.idsow)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
OperationsPanel.displayName = 'OperationsPanel';

const Pagination = ({ page, totalPages, total, limit, onPageChange, onLimitChange, loading }) => {
  const [jumpInput, setJumpInput] = useState('');

  const navBtn = (disabled) =>
    `w-8 h-8 flex items-center justify-center rounded-md text-sm font-medium border transition-all ${
      disabled
        ? 'text-slate-300 border-slate-200 bg-slate-50 cursor-not-allowed'
        : 'text-blue-700 border-blue-200 bg-white hover:bg-blue-50 hover:border-blue-400 active:bg-blue-100 cursor-pointer shadow-sm'
    }`;

  const pages = [];
  const delta = 2;
  const left = Math.max(2, page - delta);
  const right = Math.min(totalPages - 1, page + delta);
  pages.push(1);
  if (left > 2) pages.push('...');
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < totalPages - 1) pages.push('...');
  if (totalPages > 1) pages.push(totalPages);

  const handleJump = (e) => {
    e.preventDefault();
    const n = parseInt(jumpInput, 10);
    if (n >= 1 && n <= totalPages) {
      onPageChange(n);
      setJumpInput('');
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white border-t border-slate-200 flex-shrink-0">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-500">
          {total === 0 ? (
            'No data'
          ) : (
            <>
              <span className="font-semibold text-slate-800">
                {((page - 1) * limit + 1).toLocaleString()}
              </span>
              <span className="mx-0.5 text-slate-400">–</span>
              <span className="font-semibold text-slate-800">
                {Math.min(page * limit, total).toLocaleString()}
              </span>
              <span className="text-slate-400 mx-1">dari</span>
              <span className="font-semibold text-blue-700">{total.toLocaleString()}</span>
              <span className="text-slate-400 ml-1">orders</span>
            </>
          )}
        </span>
        <div className="h-4 w-px bg-slate-200" />
        <label className="text-slate-400">Tampilkan</label>
        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          disabled={loading}
          className="border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 text-xs
                     focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400
                     disabled:opacity-50 shadow-sm"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-slate-400">/ hal</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          className={navBtn(page === 1 || loading)}
          disabled={page === 1 || loading}
          onClick={() => onPageChange(1)}
          title="Halaman pertama"
        >
          «
        </button>
        <button
          className={navBtn(page === 1 || loading)}
          disabled={page === 1 || loading}
          onClick={() => onPageChange(page - 1)}
          title="Sebelumnya"
        >
          ‹
        </button>

        <div className="flex items-center gap-0.5 mx-1">
          {pages.map((p, i) =>
            p === '...' ? (
              <span key={`e${i}`} className="w-6 text-center text-slate-400 text-xs select-none">
                …
              </span>
            ) : (
              <button
                key={p}
                disabled={loading}
                onClick={() => onPageChange(p)}
                className={`w-8 h-8 rounded-md text-xs font-semibold border transition-all
                    ${
                      p === page
                        ? 'bg-blue-700 text-white border-blue-700 shadow-md'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-blue-50 hover:border-blue-300 shadow-sm'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          className={navBtn(page === totalPages || loading)}
          disabled={page === totalPages || loading}
          onClick={() => onPageChange(page + 1)}
          title="Berikutnya"
        >
          ›
        </button>
        <button
          className={navBtn(page === totalPages || loading)}
          disabled={page === totalPages || loading}
          onClick={() => onPageChange(totalPages)}
          title="Halaman terakhir"
        >
          »
        </button>

        {totalPages > 5 && (
          <>
            <div className="h-5 w-px bg-slate-200 mx-1.5" />
            <form onSubmit={handleJump} className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Hal.</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                className="w-14 h-8 px-2 border border-slate-200 rounded-md text-xs text-center
                           focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 shadow-sm"
                placeholder={`1–${totalPages}`}
              />
              <button
                type="submit"
                className="h-8 px-3 bg-blue-700 text-white rounded-md text-xs font-semibold
                           hover:bg-blue-800 active:bg-blue-900 transition-colors shadow-sm"
              >
                Go
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

const OrderListPage = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [modalOp, setModalOp] = useState(null);

  const abortRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setActiveSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchPage(activeSearch, page, limit);
  }, [activeSearch, page, limit]);

  const fetchPage = async (term, p, lim) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: p, limit: lim });
      if (term.trim()) params.set('search', term.trim());
      const res = await fetch(`${API_BASE}/sow/grouped?${params}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error('Server error');
      const json = await res.json();
      setOrders(json.data ?? []);
      setTotal(json.total ?? 0);
      setTotalPages(json.totalPages ?? 1);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError('Failed to load data. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = useCallback((orderNo) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(orderNo) ? next.delete(orderNo) : next.add(orderNo);
      return next;
    });
  }, []);

  const handleSelectOp = useCallback((op) => setModalOp(op), []);
  const handleLimitChange = (v) => {
    setLimit(v);
    setPage(1);
    setExpandedRows(new Set());
  };
  const handlePageChange = (v) => {
    setPage(v);
    setExpandedRows(new Set());
  };

  return (
    <div className="h-dvh w-screen bg-slate-100 flex flex-col overflow-hidden">
      {}
      <header className="flex items-center justify-between bg-blue-900 px-4 py-2.5 shadow-lg flex-shrink-0 border-b border-blue-800">
        <button
          onClick={() => goBackOrFallback(navigate)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 text-white
                     rounded-lg transition-all hover:bg-blue-600 active:translate-y-px"
          style={{ boxShadow: '0 4px 0 rgba(0,0,0,0.25), 0 6px 12px rgba(0,0,0,0.2)' }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
            />
          </svg>
          Back
        </button>

        <div className="text-center">
          <h1 className="text-sm font-bold text-white tracking-wide">Order List</h1>
          <p className="text-[10px] text-blue-300 font-medium mt-px">
            {loading ? 'Loading...' : `${total.toLocaleString()} orders`}
          </p>
        </div>

        <button
          onClick={() => fetchPage(activeSearch, page, limit)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-700 text-white
                     rounded-lg transition-all hover:bg-blue-600 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ boxShadow: '0 4px 0 rgba(0,0,0,0.25), 0 6px 12px rgba(0,0,0,0.2)' }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
            />
          </svg>
          Refresh
        </button>
      </header>

      {}
      <main className="flex-1 flex flex-col gap-2.5 p-3 overflow-hidden">
        {}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order no, SSBR ID, part number, part name..."
                className="w-full pl-10 pr-9 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg
                           placeholder-slate-400 text-slate-800
                           focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 focus:bg-white
                           transition-all"
              />
              {loading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
              {!loading && search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center
                             rounded-full bg-slate-200 text-slate-500 hover:bg-slate-300 transition-colors text-xs font-bold"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {['Order No', 'SSBR ID', 'Part Number', 'Part Name'].map((f) => (
                <span
                  key={f}
                  className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100 font-medium"
                >
                  {f}
                </span>
              ))}
            </div>
            {activeSearch && !loading && (
              <span className="text-[11px] text-slate-500">
                <strong className="text-blue-700">{total.toLocaleString()}</strong> hasil untuk{' '}
                <em className="text-slate-600">"{activeSearch}"</em>
              </span>
            )}
            {activeSearch && loading && (
              <span className="text-[11px] text-slate-400 italic">Mencari...</span>
            )}
          </div>
        </section>

        {}
        <section className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
          {error && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200 flex-shrink-0">
              <div className="flex items-center gap-2 text-xs text-red-700 font-medium">
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4 text-red-500 flex-shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  />
                </svg>
                {error}
              </div>
              <button
                onClick={() => fetchPage(activeSearch, page, limit)}
                className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
              >
                Coba lagi
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto min-h-0 relative">
            {loading && orders.length > 0 && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-4 border-blue-700 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-blue-700 font-medium">Loading...</span>
                </div>
              </div>
            )}

            {loading && orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 border-4 border-blue-700 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-500 font-medium">Loading orders data...</p>
              </div>
            ) : !loading && orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                <svg
                  className="w-16 h-16 text-slate-200"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-sm font-semibold text-slate-500">
                  {activeSearch ? 'No results' : 'No data'}
                </p>
                {activeSearch && (
                  <p className="text-xs text-slate-400">
                    Pencarian "{activeSearch}" tidak ditemukan —{' '}
                    <button
                      onClick={() => setSearch('')}
                      className="text-blue-500 hover:text-blue-700 underline underline-offset-2 font-medium"
                    >
                      hapus filter
                    </button>
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-r from-blue-900 to-blue-800 text-white">
                    <th className="w-10 px-3 py-3" />
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[130px]">
                      Order No
                    </th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[100px]">
                      SSBR ID
                    </th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[110px]">
                      Part Number
                    </th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[170px]">
                      Part Name
                    </th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide min-w-[100px]">
                      Model
                    </th>
                    <th className="px-3 py-3 text-center font-semibold tracking-wide w-14">Ops</th>
                    <th className="px-3 py-3 text-right font-semibold tracking-wide w-24">
                      Plan Hrs
                    </th>
                    <th className="px-3 py-3 text-left font-semibold tracking-wide w-36">
                      Progress
                    </th>
                    <th className="px-3 py-3 text-center font-semibold tracking-wide min-w-[96px]">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, i) => {
                    const isExpanded = expandedRows.has(order.order_no);
                    return (
                      <React.Fragment key={order.order_no}>
                        <tr
                          onClick={() => toggleExpand(order.order_no)}
                          className={`border-b cursor-pointer select-none transition-colors duration-100
                            ${
                              isExpanded
                                ? 'bg-blue-50 border-blue-200 border-l-4 border-l-orange-400'
                                : i % 2 === 0
                                  ? 'bg-white border-slate-100 hover:bg-slate-50'
                                  : 'bg-slate-50/60 border-slate-100 hover:bg-slate-100/70'
                            }`}
                        >
                          <td className="px-3 py-3 text-center w-10">
                            <Chevron open={isExpanded} />
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-bold text-blue-900">
                              {highlight(order.order_no, activeSearch)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-600 font-medium">
                            {highlight(order.ssbr_id, activeSearch)}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {highlight(order.part_number, activeSearch)}
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            {highlight(order.part_name, activeSearch)}
                          </td>
                          <td className="px-3 py-3 text-slate-500">{order.model || '—'}</td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full
                                            bg-blue-600 text-white text-[10px] font-bold shadow-sm"
                            >
                              {order.operation_count}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-700 tabular-nums">
                            {Number(order.total_planhours).toFixed(1)}
                          </td>
                          <td className="px-3 py-3">
                            <ProgressBar value={order.avg_progress} />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge value={order.status} />
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr>
                            <td colSpan={10} className="p-0">
                              <OperationsPanel
                                orderNo={order.order_no}
                                onSelectOp={handleSelectOp}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {(total > 0 || loading) && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              loading={loading}
              onPageChange={handlePageChange}
              onLimitChange={handleLimitChange}
            />
          )}
        </section>
      </main>

      {}
      {modalOp && <ProgressModal op={modalOp} onClose={() => setModalOp(null)} />}
    </div>
  );
};

export default OrderListPage;
