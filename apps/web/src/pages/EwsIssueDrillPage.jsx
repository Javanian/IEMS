import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw, Search } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const PAGE_SIZE = 100;

const SEVERITY_BADGE = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  warning: 'bg-amber-100 text-amber-700 border border-amber-200',
};

export default function EwsIssueDrillPage() {
  const { issueKey } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchRecords = useCallback(
    async (offset = 0) => {
      const res = await fetch(
        `${API_BASE}/ews/issue/${encodeURIComponent(issueKey)}/records?limit=${PAGE_SIZE}&offset=${offset}`
      );
      if (res.status === 404) throw new Error('Issue tidak ditemukan — mungkin sudah dibersihkan.');
      if (!res.ok) throw new Error(`Gagal memuat data (HTTP ${res.status})`);
      return res.json();
    },
    [issueKey]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchRecords(0)
      .then((d) => {
        if (alive) {
          setData(d);
          setRows(d.rows || []);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchRecords]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const d = await fetchRecords(rows.length);
      setRows((prev) => [...prev, ...(d.rows || [])]);
      setData((prev) => ({ ...prev, truncated: d.truncated, total: d.total }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchRecords, rows.length]);

  const issue = data?.issue_summary;
  const columns = data?.columns || [];

  return (
    <div className="min-h-screen bg-slate-50">
      {}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-white px-4 py-2.5 shadow-sm border-b border-slate-200 md:px-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        >
          <ArrowLeft size={14} /> Kembali
        </button>
        <h1 className="flex items-center gap-2 text-sm font-extrabold text-slate-800 md:text-base">
          <Search size={16} className="text-[#0096c7]" /> Record Penyebab Issue
        </h1>
        <span className="w-[90px]" />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 md:px-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-10 text-sm font-semibold text-slate-500 shadow-sm">
            <RefreshCw size={15} className="animate-spin" /> Memuat…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-600 shadow-sm">
            {error}
          </div>
        ) : (
          <>
            {}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEVERITY_BADGE[issue.severity] || 'bg-slate-100 text-slate-600 border border-slate-200'}`}
                >
                  {String(issue.severity || '').toUpperCase()}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${issue.status === 'resolved' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}
                >
                  {issue.status === 'resolved' ? 'CLOSED' : 'OPEN'}
                </span>
                <span className="font-mono text-[10px] uppercase text-slate-400">
                  {issue.category} · {issue.business_date} · {issue.entity_name || issue.entity_id}
                </span>
              </div>
              <h2 className="mt-2 text-sm font-bold text-slate-800">{issue.title}</h2>
              <p className="mt-1 text-xs leading-snug text-slate-600">{issue.description}</p>
            </div>

            {}
            {data.implemented !== false && data.note ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-snug text-amber-700 shadow-sm">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {data.note}
              </div>
            ) : null}

            {}
            {data.implemented === false ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-xs font-semibold text-slate-500 shadow-sm">
                <AlertTriangle size={15} className="text-amber-500" /> {data.note}
              </div>
            ) : rows.length === 0 ? (
              data.note ? null : (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-center text-xs font-bold text-emerald-600 shadow-sm">
                  ✓ Tidak ada record bermasalah pada window issue ini.
                </div>
              )
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                  <span className="text-xs font-bold text-slate-700">
                    {rows.length} dari {data.total} record
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">READ-ONLY</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-[#90e0ef]" style={{ background: '#caf0f8' }}>
                      <tr className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                        {columns.map((c) => (
                          <th key={c.key} className="whitespace-nowrap px-3 py-2">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r, i) => (
                        <tr
                          key={`${r.tsnumber || i}-${i}`}
                          className="transition hover:bg-[#caf0f8]/25"
                        >
                          {columns.map((c) => (
                            <td
                              key={c.key}
                              className={`px-3 py-2 text-xs ${c.key === 'reason' ? 'text-red-600 font-semibold' : c.key === 'tsnumber' ? 'font-mono text-slate-600' : 'text-slate-700'}`}
                            >
                              {r[c.key] == null || r[c.key] === '' ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                String(r[c.key])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.truncated ? (
                  <div className="border-t border-slate-200 p-3 text-center">
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="rounded-lg bg-[#0096c7] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-[#0077b6] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                    >
                      {loadingMore ? 'Memuat…' : `Muat ${PAGE_SIZE} berikutnya`}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
