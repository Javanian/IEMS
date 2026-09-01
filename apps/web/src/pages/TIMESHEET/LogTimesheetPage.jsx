import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';

const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const formatDate = (raw) => {
  if (!raw || raw.length !== 8) return raw || '-';
  const year = raw.slice(0, 4);
  const month = parseInt(raw.slice(4, 6), 10) - 1;
  const day = parseInt(raw.slice(6, 8), 10);
  return `${day} ${MONTHS_ID[month] ?? '?'} ${year}`;
};

const formatTime = (raw) => {
  if (!raw || raw.length < 6) return raw || '-';
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
};

const trimResponse = (raw) => {
  if (!raw) return '-';
  const idx = raw.indexOf(':');
  return idx !== -1 ? raw.slice(idx + 1).trim() : raw;
};

const isError = (raw) => typeof raw === 'string' && raw.startsWith('ERROR');

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="w-4 h-4 text-emerald-600"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="w-4 h-4 text-red-500"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const btnOutline =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ' +
  'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 ' +
  'transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';

const COLS = [
  { key: 'status', label: 'Status', w: 'w-12' },
  { key: 'ztimesheetid', label: 'TS ID', w: 'w-28' },
  { key: 'employee', label: 'Employee', w: 'w-36' },
  { key: 'order', label: 'Order', w: 'w-36' },
  { key: 'operation_no', label: 'Op', w: 'w-16' },
  { key: 'zconf_type', label: 'Type', w: 'w-16' },
  { key: 'work_center', label: 'Work Center', w: 'w-28' },
  { key: 'activity_type', label: 'Activity', w: 'w-24' },
  { key: 'start', label: 'Start', w: 'w-36' },
  { key: 'end', label: 'End', w: 'w-36' },
  { key: 'plant_code', label: 'Plant', w: 'w-16' },
  { key: 'sap_response', label: 'SAP Response', w: 'w-64' },
  { key: 'created_at', label: 'Posted At', w: 'w-36' },
];

const LogTimesheetPage = () => {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadPage = useCallback((p) => {
    setLoading(true);
    setError(null);
    fetch(`/api/timesheet/log-sap?page=${p}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
        setPage(data.page ?? p);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  const goTo = (p) => {
    if (p < 1 || p > totalPages || loading) return;
    loadPage(p);
  };

  return (
    <div className="h-dvh w-screen flex flex-col overflow-hidden bg-slate-50">
      {}
      <header
        className="flex-shrink-0 flex items-center justify-between
                         px-4 md:px-6 py-2.5
                         bg-white border-b border-slate-200 shadow-sm"
      >
        <button onClick={() => goBackOrFallback(navigate)} className={btnOutline}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="text-sm md:text-base font-extrabold text-slate-800">SAP Post Log</h1>
        <div className="text-xs text-slate-500">{total} records</div>
      </header>

      {}
      <div className="flex-1 overflow-hidden min-h-0 px-4 md:px-6 py-4 flex flex-col gap-3">
        {loading && (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
            <span className="w-5 h-5 border-2 border-t-transparent border-[#00b4d8] rounded-full animate-spin mr-2" />
            Loading…
          </div>
        )}

        {error && <div className="text-red-600 text-sm text-center py-10">{error}</div>}

        {!loading && !error && (
          <>
            {}
            <div className="flex-1 min-h-0 bg-white shadow-sm border border-slate-200 rounded-xl overflow-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="sticky top-0 z-10">
                  <tr style={{ background: '#caf0f8' }}>
                    {COLS.map((c) => (
                      <th
                        key={c.key}
                        className={`px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap ${c.w}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length} className="px-3 py-8 text-center text-slate-400">
                        No log entries found.
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      {}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center">
                          {isError(row.sap_response) ? <XIcon /> : <CheckIcon />}
                        </div>
                      </td>

                      {}
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {row.ztimesheetid || '-'}
                      </td>

                      {}
                      <td className="px-3 py-2">
                        <div className="font-mono text-slate-800">{row.pernr || '-'}</div>
                        {row.full_name && (
                          <div className="text-[10px] text-slate-500 truncate max-w-[8rem]">
                            {row.full_name}
                          </div>
                        )}
                      </td>

                      {}
                      <td className="px-3 py-2">
                        <div className="font-mono text-slate-800">{row.order_no || '-'}</div>
                        {(row.confirmation_number || row.zconf_type) && (
                          <div className="text-[10px] text-slate-500 font-mono">
                            {(row.confirmation_number || '') + (row.zconf_type || '')}
                          </div>
                        )}
                      </td>

                      {}
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {row.operation_no || '-'}
                      </td>

                      {}
                      <td className="px-3 py-2 text-slate-700">{row.zconf_type || '-'}</td>

                      {}
                      <td className="px-3 py-2 text-slate-700">{row.work_center || '-'}</td>

                      {}
                      <td className="px-3 py-2 text-slate-700">{row.activity_type || '-'}</td>

                      {}
                      <td className="px-3 py-2">
                        <div className="text-slate-800">{formatDate(row.start_date)}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {formatTime(row.start_time)}
                        </div>
                      </td>

                      {}
                      <td className="px-3 py-2">
                        <div className="text-slate-800">{formatDate(row.end_date)}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {formatTime(row.end_time)}
                        </div>
                      </td>

                      {}
                      <td className="px-3 py-2 text-slate-700">{row.plant_code || '-'}</td>

                      {}
                      <td className="px-3 py-2">
                        <span
                          className={
                            isError(row.sap_response) ? 'text-red-600' : 'text-emerald-700'
                          }
                        >
                          {trimResponse(row.sap_response)}
                        </span>
                      </td>

                      {}
                      <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                        {row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {}
            {totalPages > 1 && (
              <div className="flex-shrink-0 flex items-center justify-center gap-2 pb-2">
                <button onClick={() => goTo(1)} disabled={page === 1} className={btnOutline}>
                  «
                </button>
                <button onClick={() => goTo(page - 1)} disabled={page === 1} className={btnOutline}>
                  ‹ Prev
                </button>
                <span className="text-xs text-slate-600 px-2">
                  Page <span className="font-bold text-slate-800">{page}</span> of {totalPages}
                </span>
                <button
                  onClick={() => goTo(page + 1)}
                  disabled={page === totalPages}
                  className={btnOutline}
                >
                  Next ›
                </button>
                <button
                  onClick={() => goTo(totalPages)}
                  disabled={page === totalPages}
                  className={btnOutline}
                >
                  »
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LogTimesheetPage;
