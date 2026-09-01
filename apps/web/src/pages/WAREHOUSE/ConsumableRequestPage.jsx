import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ClipboardList,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const GL_ACCOUNTS = [
  { Kode: '6001003000', Deskripsi: 'COS-Material Consumed', Kategori: 'consumable' },
  {
    Kode: '6001007000',
    Deskripsi: 'COS-Semi Finished Goods Used',
    Kategori: 'komponen semi finished',
  },
  { Kode: '6001001000', Deskripsi: 'COS-Material Used', Kategori: 'raw material' },
  {
    Kode: '6039002000',
    Deskripsi: 'COS Health Safety Environment',
    Kategori: 'apd dan peralatan safety lainnya',
  },
  { Kode: '6023001000', Deskripsi: 'COS Tools Equip & Sparepart', Kategori: 'tools' },
  {
    Kode: '6010002000',
    Deskripsi: 'COS-RM Bldg Maintenance',
    Kategori: 'GA & Maintenance building',
  },
];

const STATUS_TONES = {
  'waiting leader': 'border-amber-200 bg-amber-50 text-amber-700',
  'waiting warehouse': 'border-sky-200 bg-sky-50 text-sky-700',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  close: 'border-slate-200 bg-slate-100 text-slate-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
};

function statusTone(status) {
  return (
    STATUS_TONES[
      String(status || '')
        .trim()
        .toLowerCase()
    ] || 'border-slate-200 bg-slate-50 text-slate-600'
  );
}

function readCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem('datakaryawan') || 'null');
  } catch {
    return null;
  }
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(number);
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stockKey(item) {
  if (item?.id) return String(item.id);
  return `${item.material_code || ''}::${item.code_mm || ''}`;
}

function HistoryTable({ tickets }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-extrabold text-slate-900">Historical Request</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-bold">CIS No</th>
              <th className="px-4 py-3 font-bold">Created</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Workcenter</th>
              <th className="px-4 py-3 font-bold">Items</th>
              <th className="px-4 py-3 font-bold">Comment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tickets.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm font-semibold text-slate-400"
                >
                  Belum ada consumable request.
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <tr key={ticket.cis_no} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-slate-700">
                    {ticket.cis_no}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                    {formatDateTime(ticket.created)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${statusTone(ticket.status)}`}
                    >
                      {ticket.status || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                    {ticket.workcenter || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {(ticket.items || []).map((item) => (
                        <p key={item.id} className="text-xs text-slate-600">
                          <span className="font-bold text-slate-800">
                            {formatNumber(item.quanitty)} {item.uom || ''}
                          </span>{' '}
                          {item.materialdescription}
                        </p>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{ticket.comment || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockList({ stock, loading, error, onRetry, selected, onSelect }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Memuat stock
        </div>
      ) : error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertCircle className="h-8 w-8 text-rose-400" />
          <p className="text-sm font-bold text-slate-700">Gagal memuat stock</p>
          <p className="max-w-xs text-xs font-semibold text-slate-500">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <RefreshCw size={16} /> Coba lagi
          </button>
        </div>
      ) : stock.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-slate-400">
          Stock consumable tidak ditemukan.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {stock.map((item) => {
            const isSelected = stockKey(selected || {}) === stockKey(item);
            return (
              <button
                key={stockKey(item)}
                type="button"
                onClick={() => onSelect(item)}
                className={`w-full px-3 py-2.5 text-left transition md:px-4 md:py-3 hover:bg-slate-50 ${
                  isSelected ? 'bg-cyan-50' : 'bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-xs font-extrabold leading-snug text-slate-900 md:text-sm">
                      {item.material_description || '-'}
                    </p>
                    <p className="mt-1 font-mono text-xs font-bold text-slate-500">
                      {item.material_code || '-'} {item.code_mm ? `| ${item.code_mm}` : ''}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      {item.plant || '-'} | {item.type || '-'} | {item.mrp_type || '-'}
                    </p>
                  </div>
                  <span className="flex-shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">
                    {formatNumber(item.quantity)} {item.uom || ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GlAccountPanel({ selectedGl, onSelect, onClose }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase text-slate-500">GL Account</p>
          <h4 className="mt-1 truncate text-lg font-extrabold text-slate-950">
            Pilih Cost Posting
          </h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="Close GL account panel"
        >
          <X size={19} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid gap-2">
          {GL_ACCOUNTS.map((account) => {
            const isSelected = selectedGl?.Kode === account.Kode;
            return (
              <button
                key={account.Kode}
                type="button"
                onClick={() => onSelect(account)}
                className={`flex min-h-[76px] items-start justify-between gap-3 rounded-lg border px-4 py-3 text-left transition ${
                  isSelected
                    ? 'border-[#0096c7] bg-cyan-50 text-slate-950'
                    : 'border-slate-200 bg-white text-slate-800 hover:border-cyan-200 hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-extrabold text-slate-900">{account.Kode}</p>
                  <p className="mt-1 text-sm font-bold leading-snug text-slate-700">
                    {account.Deskripsi}
                  </p>
                  <p className="mt-1 text-[11px] font-extrabold uppercase text-slate-400">
                    {account.Kategori}
                  </p>
                </div>
                <span
                  className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    isSelected ? 'bg-[#0077b6] text-white' : 'bg-slate-100 text-slate-300'
                  }`}
                >
                  <Check size={16} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ItemDetailPanel({ item, requestedQty, onClose, onAdd }) {
  const [quantity, setQuantity] = useState('');
  const [selectedGl, setSelectedGl] = useState(null);
  const [showGlOptions, setShowGlOptions] = useState(false);
  const stockQuantity = Number(item?.quantity || 0);
  const remaining = Math.max(stockQuantity - requestedQty, 0);
  const numericQuantity = Number(quantity);
  const canAdd = item && numericQuantity > 0 && numericQuantity <= remaining && selectedGl;

  if (!item) return null;

  const handleAdd = () => {
    if (!canAdd) {
      toast.error('Quantity wajib diisi dan tidak boleh melebihi stock.');
      return;
    }
    onAdd({
      stockItem: item,
      quantity: numericQuantity,
      glAccount: selectedGl,
    });
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/35 p-3 md:p-4">
      <div className="relative flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl md:max-h-[88vh]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 md:px-5 md:py-4">
          <div>
            <p className="text-xs font-extrabold uppercase text-slate-500">Detail Consumable</p>
            <h3 className="mt-1 line-clamp-2 text-base font-extrabold leading-snug text-slate-950 md:text-lg">
              {item.material_description}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close detail"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 md:space-y-4 md:px-5 md:py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 md:py-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Material Code</p>
              <p className="mt-1 break-words font-mono text-xs font-extrabold text-slate-800">
                {item.material_code || '-'}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 md:py-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Code MM</p>
              <p className="mt-1 break-words font-mono text-xs font-extrabold text-slate-800">
                {item.code_mm || '-'}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 md:py-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Stock</p>
              <p className="mt-1 text-sm font-extrabold text-slate-800">
                {formatNumber(item.quantity)} {item.uom || ''}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 md:py-3">
              <p className="text-[11px] font-bold uppercase text-slate-400">Available</p>
              <p className="mt-1 text-sm font-extrabold text-slate-800">
                {formatNumber(remaining)} {item.uom || ''}
              </p>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
              Quantity Request
            </span>
            <input
              type="number"
              min="0"
              max={remaining}
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-800 outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
              placeholder={`Max ${formatNumber(remaining)} ${item.uom || ''}`}
            />
            {numericQuantity > remaining && (
              <p className="mt-2 text-xs font-bold text-red-600">
                Quantity request melebihi stock tersedia.
              </p>
            )}
          </label>

          <div className="relative">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
              GL Account
            </span>
            <button
              type="button"
              onClick={() => setShowGlOptions(true)}
              className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {selectedGl ? `${selectedGl.Kode} - ${selectedGl.Deskripsi}` : 'Pilih GL account'}
                </span>
                {selectedGl && (
                  <span className="mt-0.5 block truncate text-xs font-semibold text-slate-400">
                    {selectedGl.Kategori}
                  </span>
                )}
              </span>
              <ChevronDown size={17} className="flex-shrink-0 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 md:px-5 md:py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} />
            Add
          </button>
        </div>

        {showGlOptions && (
          <GlAccountPanel
            selectedGl={selectedGl}
            onClose={() => setShowGlOptions(false)}
            onSelect={(account) => {
              setSelectedGl(account);
              setShowGlOptions(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function RequestPanel({ user, onClose, onSubmitted }) {
  const [search, setSearch] = useState('');
  const [stock, setStock] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [cart, setCart] = useState([]);
  const [comment, setComment] = useState('');
  const [loadingStock, setLoadingStock] = useState(false);
  const [stockError, setStockError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requestedByStock = useMemo(() => {
    const totals = new Map();
    for (const item of cart) {
      totals.set(item.stockKey, (totals.get(item.stockKey) || 0) + Number(item.quantity || 0));
    }
    return totals;
  }, [cart]);

  const loadStock = useCallback((term) => {
    const controller = new AbortController();
    setLoadingStock(true);
    setStockError('');

    fetch(`${API_BASE}/consumable/stock?search=${encodeURIComponent(term)}&limit=80`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Gagal memuat stock consumable');
        return response.json();
      })
      .then((payload) => setStock(Array.isArray(payload) ? payload : []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setStock([]);
        setStockError(err.message || 'Gagal memuat stock');
      })
      .finally(() => setLoadingStock(false));

    return controller;
  }, []);

  useEffect(() => {
    const controller = loadStock(search);
    return () => controller.abort();
  }, [loadStock, search]);

  const handleAddToCart = ({ stockItem, quantity, glAccount }) => {
    const key = stockKey(stockItem);
    const cartKey = `${key}::${glAccount.Kode}`;

    setCart((current) => {
      const next = current.map((item) =>
        item.cartKey === cartKey
          ? { ...item, quantity: Number(item.quantity || 0) + quantity }
          : item
      );

      if (!current.some((item) => item.cartKey === cartKey)) {
        next.push({
          cartKey,
          stockKey: key,
          materialcode: stockItem.material_code,
          materialdescription: stockItem.material_description,
          stock_id: stockItem.id,
          quantity,
          uom: stockItem.uom,
          cost_center: user.workcenter || '',
          gl_account: glAccount.Kode,
          gl_description: glAccount.Deskripsi,
          code_mm: stockItem.code_mm,
          stockQuantity: Number(stockItem.quantity || 0),
        });
      }

      return next;
    });

    setSelectedStock(null);
  };

  const removeCartItem = (cartKey) => {
    setCart((current) => current.filter((item) => item.cartKey !== cartKey));
  };

  const handleSubmit = async () => {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/consumable/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sn_karyawan: user.snssb,
          nama_karyawan: user.full_name,
          workcenter: user.workcenter || '',
          machineid: user.machineid || user.machinename || '',
          comment,
          person_image: user.person_image || null,
          items: cart.map((item) => ({
            materialcode: item.materialcode,
            materialdescription: item.materialdescription,
            stock_id: item.stock_id,
            quanitty: item.quantity,
            uom: item.uom,
            cost_center: item.cost_center,
            gl_account: item.gl_account,
            code_mm: item.code_mm,
          })),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Gagal submit request');

      toast.success(`Request ${payload.cis_no} berhasil dibuat`);
      onSubmitted();
    } catch (err) {
      toast.error('Gagal submit consumable request', { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex h-dvh w-screen flex-col overflow-hidden bg-slate-100 text-slate-800">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 md:px-4 md:py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-extrabold text-slate-950 md:text-lg">
            New Consumable Request
          </h2>
          <p className="truncate text-xs font-semibold text-slate-500">
            {user.full_name || '-'} | {user.snssb || '-'} | {user.workcenter || '-'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="Close request panel"
        >
          <X size={20} />
        </button>
      </header>

      <main className="relative grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 [grid-template-rows:minmax(0,1.15fr)_minmax(250px,0.85fr)] sm:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] sm:[grid-template-rows:minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-3 md:p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100 md:h-11"
                placeholder="Search material code, code MM, description, type"
              />
            </label>
          </div>
          <StockList
            stock={stock}
            loading={loadingStock}
            error={stockError}
            onRetry={() => loadStock(search)}
            selected={selectedStock}
            onSelect={setSelectedStock}
          />
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5 md:px-4 md:py-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Request Preview</h3>
              <p className="text-xs font-semibold text-slate-500">{cart.length} item</p>
            </div>
            <ShoppingCart className="h-5 w-5 text-[#0077b6]" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-sm font-semibold text-slate-400">
                <Package className="mb-3 h-9 w-9 text-slate-300" />
                Pilih consumable dari list kiri lalu klik Add.
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((item) => (
                  <div
                    key={item.cartKey}
                    className="rounded-lg border border-slate-200 p-2.5 md:p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-xs font-extrabold leading-snug text-slate-900 md:text-sm">
                          {item.materialdescription}
                        </p>
                        <p className="mt-1 font-mono text-xs font-bold text-slate-500">
                          {item.materialcode} {item.code_mm ? `| ${item.code_mm}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCartItem(item.cartKey)}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50"
                        aria-label="Remove item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-slate-50 px-2.5 py-2">
                        <p className="font-bold uppercase text-slate-400">Qty</p>
                        <p className="mt-0.5 font-extrabold text-slate-800">
                          {formatNumber(item.quantity)} {item.uom || ''}
                        </p>
                      </div>
                      <div className="rounded-md bg-slate-50 px-2.5 py-2">
                        <p className="font-bold uppercase text-slate-400">GL</p>
                        <p className="mt-0.5 font-extrabold text-slate-800">{item.gl_account}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 space-y-2 border-t border-slate-200 p-3 md:space-y-3 md:p-4">
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
              placeholder="Comment optional"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={cart.length === 0 || submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0077b6] text-sm font-extrabold text-white hover:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Request
            </button>
          </div>
        </section>

        {selectedStock && (
          <ItemDetailPanel
            item={selectedStock}
            requestedQty={requestedByStock.get(stockKey(selectedStock)) || 0}
            onClose={() => setSelectedStock(null)}
            onAdd={handleAddToCart}
          />
        )}
      </main>
    </div>
  );
}

export default function ConsumableRequestPage() {
  const navigate = useNavigate();
  const [user] = useState(readCurrentUser);
  const [tickets, setTickets] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [showRequestPanel, setShowRequestPanel] = useState(false);
  const currentSn = user?.snssb || '';

  const loadHistory = useCallback(() => {
    if (!currentSn) return undefined;
    const controller = new AbortController();
    setLoadingHistory(true);
    setHistoryError('');

    fetch(`${API_BASE}/consumable/history?sn=${encodeURIComponent(currentSn)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Gagal memuat riwayat request');
        return response.json();
      })
      .then((payload) => setTickets(Array.isArray(payload) ? payload : []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setTickets([]);
        setHistoryError(err.message || 'Gagal memuat riwayat');
      })
      .finally(() => setLoadingHistory(false));

    return controller;
  }, [currentSn]);

  useEffect(() => {
    if (!currentSn) {
      toast.error('Data karyawan tidak ditemukan. Silakan login ulang.');
      navigate('/login-timesheet', { replace: true });
      return undefined;
    }

    let controller;
    const timer = window.setTimeout(() => {
      controller = loadHistory();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [currentSn, loadHistory, navigate]);

  const handleSubmitted = () => {
    setShowRequestPanel(false);
    loadHistory();
  };

  if (!user?.snssb) return null;

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/login-timesheet')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold text-slate-950">Consumable Request</h1>
              <p className="truncate text-xs font-semibold text-slate-500">
                {user.full_name || '-'} | {user.snssb || '-'} | {user.workcenter || '-'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowRequestPanel(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a]"
          >
            <Plus size={18} />
            New Request
          </button>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 md:px-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">Employee</p>
            <p className="mt-2 truncate text-lg font-extrabold text-slate-950">
              {user.full_name || '-'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">SN Karyawan</p>
            <p className="mt-2 truncate font-mono text-lg font-extrabold text-slate-950">
              {user.snssb || '-'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">Total Request</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-extrabold text-slate-950">
              <ClipboardList className="h-5 w-5 text-[#0077b6]" />
              {loadingHistory ? 'Loading' : tickets.length}
            </p>
          </div>
        </section>

        {historyError ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <AlertCircle className="h-8 w-8 text-rose-400" />
            <p className="text-sm font-bold text-slate-700">Gagal memuat riwayat request</p>
            <p className="max-w-md text-xs font-semibold text-slate-500">{historyError}</p>
            <button
              type="button"
              onClick={() => loadHistory()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
            >
              <RefreshCw size={16} /> Coba lagi
            </button>
          </div>
        ) : (
          <HistoryTable tickets={tickets} />
        )}
      </main>

      {showRequestPanel && (
        <RequestPanel
          user={user}
          onClose={() => setShowRequestPanel(false)}
          onSubmitted={handleSubmitted}
        />
      )}
    </div>
  );
}
