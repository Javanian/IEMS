import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function readCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem('datakaryawan') || 'null');
  } catch {
    return null;
  }
}

function apiUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value != null) query.set(key, value);
  });
  return `${API_BASE.replace(/\/$/, '')}${path}${query.toString() ? `?${query}` : ''}`;
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed ${response.status}`);
  return payload;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function defaultReturnAt() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  return toLocalDateTimeInput(date);
}

function toolTitle(tool) {
  return tool.tool_name || tool.tool_type || tool.classification || 'Unnamed tool';
}

function toolCode(tool) {
  return tool.asset_tag || tool.tool_code || `TOOL-${tool.tool_id}`;
}

function statusClass(status) {
  if (status === 'available') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'borrowed' || status === 'reserved' || status === 'handover_pending')
    return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'broken' || status === 'lost' || status === 'retired')
    return 'border-red-200 bg-red-50 text-red-700';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

function cartStorageKey(snssb) {
  return `tools-request-cart:${snssb || 'unknown'}`;
}

function loadCart(snssb) {
  try {
    const value = JSON.parse(localStorage.getItem(cartStorageKey(snssb)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function TabButton({ active, icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-extrabold transition ${
        active
          ? 'bg-[#0077b6] text-white'
          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon size={16} />
      {children}
    </button>
  );
}

function ToolsRequestPanel({ user }) {
  const [requestTab, setRequestTab] = useState('pick');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [tools, setTools] = useState([]);
  const [cart, setCart] = useState(() => loadCart(user.snssb));
  const [purpose, setPurpose] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState(defaultReturnAt);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const cartQtyByTool = useMemo(() => {
    const map = new Map();
    for (const item of cart)
      map.set(item.tool_id, (map.get(item.tool_id) || 0) + Number(item.quantity || 0));
    return map;
  }, [cart]);

  useEffect(() => {
    localStorage.setItem(cartStorageKey(user.snssb), JSON.stringify(cart));
  }, [cart, user.snssb]);

  useEffect(() => {
    request('/tools/categories')
      .then((payload) => setCategories(Array.isArray(payload) ? payload : []))
      .catch((err) => toast.error('Gagal load kategori tools', { description: err.message }));
  }, []);

  const loadTools = useCallback(() => {
    setLoading(true);
    return fetch(
      apiUrl('/tools', {
        search,
        category,
        status: 'available',
        limit: 120,
      })
    )
      .then((response) => {
        if (!response.ok) throw new Error('Gagal load tools');
        return response.json();
      })
      .then((payload) => setTools(Array.isArray(payload?.data) ? payload.data : []))
      .catch((err) => {
        setTools([]);
        toast.error('Gagal load tools', { description: err.message });
      })
      .finally(() => setLoading(false));
  }, [category, search]);

  useEffect(() => {
    const timer = window.setTimeout(loadTools, 250);
    return () => window.clearTimeout(timer);
  }, [loadTools]);

  useEffect(() => {
    if (requestTab !== 'pick') return undefined;
    const interval = window.setInterval(loadTools, 15000);
    const handleFocus = () => loadTools();
    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadTools, requestTab]);

  const addTool = (tool) => {
    const already = cartQtyByTool.get(tool.tool_id) || 0;
    const available = Number(tool.quantity_available || 0);
    const maxAdd = Math.max(available - already, 0);
    if (maxAdd <= 0) {
      toast.error('Stock tool tidak cukup.');
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.tool_id === tool.tool_id);
      if (existing) {
        return current.map((item) =>
          item.tool_id === tool.tool_id
            ? { ...item, quantity: Number(item.quantity || 0) + 1 }
            : item
        );
      }
      return current.concat({
        tool_id: tool.tool_id,
        asset_tag: tool.asset_tag,
        tool_code: tool.tool_code,
        tool_name: toolTitle(tool),
        category_name: tool.category_name,
        condition_name: tool.condition_name,
        is_serialized: tool.is_serialized,
        quantity_available: Number(tool.quantity_available || 0),
        unit: tool.unit || 'pcs',
        quantity: 1,
      });
    });
  };

  const removeItem = (toolId) => {
    setCart((current) => current.filter((item) => item.tool_id !== toolId));
  };

  const submitRequest = async () => {
    if (cart.length === 0 || submitting) return;
    if (!expectedReturnAt) {
      toast.error('Estimasi pengembalian wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const reservedFrom = new Date().toISOString();
      const reservedUntil = new Date(expectedReturnAt).toISOString();
      for (const item of cart) {
        await request('/tools/reservations', {
          method: 'POST',
          body: JSON.stringify({
            tool_id: item.tool_id,
            requester_field_snssb: user.snssb,
            quantity: item.quantity,
            reserved_from: reservedFrom,
            reserved_until: reservedUntil,
            purpose,
            notes: `Timesheet tools request by ${user.full_name || user.snssb}`,
          }),
        });
      }
      toast.success(`${cart.length} tools request berhasil dikirim ke admin tools.`);
      setCart([]);
      setPurpose('');
      loadTools();
    } catch (err) {
      toast.error('Gagal submit tools request', { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-shrink-0 flex-col gap-2 border-b border-slate-200 p-2.5 md:flex-row md:items-center md:justify-between md:p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRequestTab('pick')}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-extrabold transition ${
              requestTab === 'pick'
                ? 'bg-[#0077b6] text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Wrench size={16} />
            Pilih Tools
          </button>
          <button
            type="button"
            onClick={() => setRequestTab('cart')}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-extrabold transition ${
              requestTab === 'cart'
                ? 'bg-[#0077b6] text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ShoppingCart size={16} />
            Card Request
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                requestTab === 'cart' ? 'bg-white/20 text-white' : 'bg-cyan-50 text-[#0077b6]'
              }`}
            >
              {cart.length}
            </span>
          </button>
        </div>

        {requestTab === 'pick' && (
          <div className="grid gap-2 md:w-[520px] md:grid-cols-[minmax(0,1fr)_190px]">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 md:h-10"
                placeholder="Search nama, kode, ukuran, range"
              />
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 md:h-10"
            >
              <option value="">All category</option>
              {categories.map((item) => (
                <option key={item.category_id} value={item.category_code}>
                  {item.category_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {requestTab === 'pick' ? (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs md:text-sm">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[21%]" />
              <col className="w-[15%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2 font-bold md:px-3">Tool</th>
                <th className="px-2 py-2 font-bold md:px-3">Kode</th>
                <th className="px-2 py-2 font-bold md:px-3">Stok</th>
                <th className="px-2 py-2 font-bold md:px-3">Kondisi</th>
                <th className="px-2 py-2 text-right font-bold md:px-3">Act</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm font-bold text-slate-400"
                  >
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading tools
                  </td>
                </tr>
              ) : tools.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm font-bold text-slate-400"
                  >
                    Tools tersedia tidak ditemukan.
                  </td>
                </tr>
              ) : (
                tools.map((tool) => (
                  <tr key={tool.tool_id} className="align-top hover:bg-slate-50">
                    <td className="px-2 py-2 md:px-3">
                      <p className="line-clamp-2 break-words font-extrabold leading-snug text-slate-900">
                        {toolTitle(tool)}
                      </p>
                      <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">
                        {tool.category_name || '-'} |{' '}
                        {tool.size_label || tool.measurement_range || '-'}
                      </p>
                    </td>
                    <td className="truncate px-2 py-2 font-mono text-[11px] font-bold text-slate-600 md:px-3 md:text-xs">
                      {toolCode(tool)}
                    </td>
                    <td className="px-2 py-2 text-[11px] font-extrabold leading-tight text-slate-700 md:px-3 md:text-xs">
                      {formatNumber(tool.quantity_available)} / {formatNumber(tool.quantity_total)}
                      <span className="hidden sm:inline"> {tool.unit || 'pcs'}</span>
                    </td>
                    <td className="px-2 py-2 md:px-3">
                      <span className="inline-flex max-w-full truncate rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700 md:text-[11px]">
                        {tool.condition_name || '-'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right md:px-3">
                      <button
                        type="button"
                        onClick={() => addTool(tool)}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#0096c7] px-2 text-[11px] font-extrabold text-white hover:bg-[#0077b6] md:h-9 md:px-3 md:text-xs"
                      >
                        <ShoppingCart size={15} />
                        <span className="hidden sm:inline">Add</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-3 p-2.5 md:p-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-1">
          <div className="min-h-0 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 text-center text-sm font-semibold text-slate-400">
                <Wrench className="mb-3 h-9 w-9 text-slate-300" />
                Pilih tools dari list lalu klik Add.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {cart.map((item) => (
                  <div
                    key={item.tool_id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start gap-2">
                          <p className="line-clamp-2 min-w-0 flex-1 text-base font-black leading-snug text-slate-900 md:text-lg">
                            {item.tool_name}
                          </p>
                          <span className="inline-flex flex-shrink-0 items-baseline gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-sm font-black text-[#0077b6]">
                            <span>{formatNumber(item.quantity)}</span>
                            <span className="text-[10px] font-extrabold uppercase text-[#0077b6]/70">
                              {item.unit || 'pcs'}
                            </span>
                          </span>
                        </div>
                        <p className="mt-1.5 font-mono text-sm font-bold text-slate-500">
                          {item.asset_tag || item.tool_code || '-'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.tool_id)}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50"
                        aria-label="Remove item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 md:p-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                Estimasi kembali
              </span>
              <input
                type="datetime-local"
                value={expectedReturnAt}
                onChange={(event) => setExpectedReturnAt(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 md:h-10"
              />
            </label>
            <textarea
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              rows={1}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 md:min-h-[58px]"
              placeholder="Purpose / keterangan"
            />
            <button
              type="button"
              onClick={submitRequest}
              disabled={cart.length === 0 || submitting}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0096c7] text-sm font-extrabold text-white hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50 md:h-11"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit Request
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function HandoverRequestPanel({ user, onChanged }) {
  const [transactions, setTransactions] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState('');
  const [targetSnssb, setTargetSnssb] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(
    () =>
      transactions.find((item) => String(item.transaction_id) === String(selectedTransactionId)),
    [selectedTransactionId, transactions]
  );

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(
        apiUrl('/tools/transactions', {
          field_snssb: user.snssb,
          limit: 100,
        })
      ).then((response) => (response.ok ? response.json() : [])),
      fetch(apiUrl('/usernfc')).then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([transactionPayload, userPayload]) => {
        const ownTransactions = (
          Array.isArray(transactionPayload) ? transactionPayload : []
        ).filter(
          (item) =>
            item.borrower_field_snssb === user.snssb &&
            ['borrowed', 'overdue'].includes(item.status)
        );
        setTransactions(ownTransactions);
        setUsers(
          (Array.isArray(userPayload) ? userPayload : []).filter(
            (item) => item.snssb && item.snssb !== user.snssb
          )
        );
      })
      .catch((err) => toast.error('Gagal load data handover', { description: err.message }))
      .finally(() => setLoading(false));
  }, [user.snssb]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const submitHandover = async () => {
    if (!selected || !targetSnssb || submitting) {
      toast.error('Pilih tool dan user tujuan handover.');
      return;
    }
    const qty = Number(quantity || 0);
    if (qty <= 0 || qty > Number(selected.quantity || 0)) {
      toast.error('Quantity handover tidak valid.');
      return;
    }

    setSubmitting(true);
    try {
      await request('/tools/handovers', {
        method: 'POST',
        body: JSON.stringify({
          tool_id: selected.tool_id,
          transaction_id: selected.transaction_id,
          from_field_snssb: user.snssb,
          to_field_snssb: targetSnssb,
          processed_by_field_snssb: user.snssb,
          quantity: qty,
          notes,
        }),
      });
      toast.success('Handover request terkirim ke user target.');
      setSelectedTransactionId('');
      setTargetSnssb('');
      setQuantity('1');
      setNotes('');
      loadData();
      onChanged();
    } catch (err) {
      toast.error('Gagal kirim handover', { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(230px,0.55fr)] gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-1">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2.5 md:px-4 md:py-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-950">Tools yang sedang dipinjam</h2>
            <p className="text-xs font-semibold text-slate-500">
              {transactions.length} transaksi aktif
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs md:text-sm">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[24%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2 font-bold md:px-3">Tool</th>
                <th className="px-2 py-2 font-bold md:px-3">Transaction</th>
                <th className="px-2 py-2 font-bold md:px-3">Qty</th>
                <th className="px-2 py-2 font-bold md:px-3">Return</th>
                <th className="px-2 py-2 font-bold md:px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                  >
                    Loading
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                  >
                    Belum ada tools pinjaman aktif.
                  </td>
                </tr>
              ) : (
                transactions.map((item) => (
                  <tr
                    key={item.transaction_id}
                    onClick={() => {
                      setSelectedTransactionId(String(item.transaction_id));
                      setQuantity(String(Math.min(Number(item.quantity || 1), 1)));
                    }}
                    className={`cursor-pointer align-top hover:bg-slate-50 ${String(item.transaction_id) === String(selectedTransactionId) ? 'bg-cyan-50' : ''}`}
                  >
                    <td className="px-2 py-2 md:px-3">
                      <p className="line-clamp-2 break-words font-extrabold leading-snug text-slate-900">
                        {item.tool_name || '-'}
                      </p>
                      <p className="mt-1 truncate font-mono text-[11px] font-bold text-slate-500">
                        {item.asset_tag || item.tool_code || '-'}
                      </p>
                    </td>
                    <td className="truncate px-2 py-2 font-mono text-[11px] font-bold text-slate-600 md:px-3">
                      {item.transaction_no}
                    </td>
                    <td className="px-2 py-2 text-[11px] font-extrabold text-slate-700 md:px-3">
                      {formatNumber(item.quantity)}
                    </td>
                    <td className="px-2 py-2 text-[11px] font-semibold text-slate-500 md:px-3">
                      {formatDateTime(item.expected_return_at)}
                    </td>
                    <td className="px-2 py-2 md:px-3">
                      <span
                        className={`inline-flex max-w-full truncate rounded-full border px-2 py-1 text-[10px] font-extrabold ${statusClass(item.status)}`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:p-4">
        <h2 className="text-sm font-extrabold text-slate-950">Create Handover</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">Tool</span>
            <select
              value={selectedTransactionId}
              onChange={(event) => setSelectedTransactionId(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
            >
              <option value="">Pilih tool</option>
              {transactions.map((item) => (
                <option key={item.transaction_id} value={item.transaction_id}>
                  {item.tool_name} - {item.transaction_no}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
              Target user
            </span>
            <select
              value={targetSnssb}
              onChange={(event) => setTargetSnssb(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
            >
              <option value="">Pilih user penerima</option>
              {users.map((item) => (
                <option key={item.snssb} value={item.snssb}>
                  {item.full_name || item.snssb} - {item.snssb}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">Qty</span>
            <input
              type="number"
              min="1"
              max={selected?.quantity || 1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
            />
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
            placeholder="Notes optional"
          />
          <button
            type="button"
            onClick={submitHandover}
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0096c7] text-sm font-extrabold text-white hover:bg-[#0077b6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send Handover
          </button>
        </div>
      </aside>
    </section>
  );
}

function IncomingHandoverPanel({ user, incoming, loading, onRefresh }) {
  const [busyId, setBusyId] = useState(null);

  const process = async (handover, action) => {
    setBusyId(handover.handover_id);
    try {
      await request(`/tools/handovers/${handover.handover_id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({
          actor_field_snssb: user.snssb,
          notes: `${action} by ${user.full_name || user.snssb}`,
        }),
      });
      toast.success(action === 'accept' ? 'Handover diterima.' : 'Handover ditolak.');
      onRefresh();
    } catch (err) {
      toast.error('Gagal proses handover', { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2.5 md:px-4 md:py-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-950">Incoming Handover</h2>
          <p className="text-xs font-semibold text-slate-500">
            Handover yang menunggu accept/reject dari Anda
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          aria-label="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-left text-xs md:text-sm">
          <colgroup>
            <col className="w-[29%]" />
            <col className="w-[19%]" />
            <col className="w-[8%]" />
            <col className="w-[15%]" />
            <col className="w-[17%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2 font-bold md:px-3">Tool</th>
              <th className="px-2 py-2 font-bold md:px-3">From</th>
              <th className="px-2 py-2 font-bold md:px-3">Qty</th>
              <th className="px-2 py-2 font-bold md:px-3">Req</th>
              <th className="px-2 py-2 font-bold md:px-3">Notes</th>
              <th className="px-2 py-2 text-right font-bold md:px-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                  Loading
                </td>
              </tr>
            ) : incoming.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                  Tidak ada incoming handover.
                </td>
              </tr>
            ) : (
              incoming.map((item) => (
                <tr key={item.handover_id} className="align-top hover:bg-slate-50">
                  <td className="px-2 py-2 md:px-3">
                    <p className="line-clamp-2 break-words font-extrabold leading-snug text-slate-900">
                      {item.tool_name || '-'}
                    </p>
                    <p className="mt-1 truncate font-mono text-[11px] font-bold text-slate-500">
                      {item.asset_tag || item.tool_code || '-'}
                    </p>
                  </td>
                  <td className="truncate px-2 py-2 text-[11px] font-semibold text-slate-600 md:px-3 md:text-xs">
                    {item.from_field_name ||
                      item.from_snapshot_name ||
                      item.from_field_snssb ||
                      '-'}
                  </td>
                  <td className="px-2 py-2 text-[11px] font-extrabold text-slate-700 md:px-3">
                    {formatNumber(item.quantity)}
                  </td>
                  <td className="px-2 py-2 text-[11px] font-semibold text-slate-500 md:px-3">
                    {formatDateTime(item.requested_at)}
                  </td>
                  <td className="truncate px-2 py-2 text-[11px] text-slate-500 md:px-3">
                    {item.notes || '-'}
                  </td>
                  <td className="px-2 py-2 text-right md:px-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => process(item, 'accept')}
                        disabled={busyId === item.handover_id}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-[11px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check size={15} />
                        <span className="hidden sm:inline">Accept</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => process(item, 'reject')}
                        disabled={busyId === item.handover_id}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-[11px] font-extrabold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <X size={15} />
                        <span className="hidden sm:inline">Reject</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ToolsRequestPage() {
  const navigate = useNavigate();
  const [user] = useState(readCurrentUser);
  const [activeTab, setActiveTab] = useState('request');
  const [incoming, setIncoming] = useState([]);
  const [loadingIncoming, setLoadingIncoming] = useState(false);

  const loadIncoming = useCallback(() => {
    if (!user?.snssb) return;
    setLoadingIncoming(true);
    fetch(
      apiUrl('/tools/handovers', {
        to_field_snssb: user.snssb,
        status: 'pending',
        limit: 100,
      })
    )
      .then((response) => {
        if (!response.ok) throw new Error('Gagal load incoming handover');
        return response.json();
      })
      .then((payload) => setIncoming(Array.isArray(payload) ? payload : []))
      .catch((err) => {
        setIncoming([]);
        toast.error('Gagal load incoming handover', { description: err.message });
      })
      .finally(() => setLoadingIncoming(false));
  }, [user]);

  useEffect(() => {
    if (!user?.snssb) {
      toast.error('Data karyawan tidak ditemukan. Silakan login ulang.');
      navigate('/login-timesheet', { replace: true });
      return;
    }
    loadIncoming();
  }, [loadIncoming, navigate, user]);

  if (!user?.snssb) return null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f6f8fb] text-slate-800">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/tools-consumable-request')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold text-slate-950 md:text-xl">
                Tools Request
              </h1>
              <p className="truncate text-[11px] font-semibold text-slate-500 md:text-xs">
                {user.full_name || '-'} | {user.snssb || '-'} | {user.workcenter || '-'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap">
            <TabButton
              active={activeTab === 'request'}
              icon={ShoppingCart}
              onClick={() => setActiveTab('request')}
            >
              Request
            </TabButton>
            <TabButton
              active={activeTab === 'handover'}
              icon={Send}
              onClick={() => setActiveTab('handover')}
            >
              Handover
            </TabButton>
            <TabButton
              active={activeTab === 'incoming'}
              icon={UserCheck}
              onClick={() => setActiveTab('incoming')}
            >
              Incoming {incoming.length}
            </TabButton>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 py-3 md:px-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'request' && <ToolsRequestPanel user={user} />}
          {activeTab === 'handover' && (
            <HandoverRequestPanel user={user} onChanged={loadIncoming} />
          )}
          {activeTab === 'incoming' && (
            <IncomingHandoverPanel
              user={user}
              incoming={incoming}
              loading={loadingIncoming}
              onRefresh={loadIncoming}
            />
          )}
        </div>
      </main>
    </div>
  );
}
