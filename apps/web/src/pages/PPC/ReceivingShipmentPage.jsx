import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { goBackOrFallback } from '../../utils/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Layers3,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const today = new Date().toISOString().slice(0, 10);

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

const emptyComponent = (level = 1) => ({
  part_level: level,
  component_id: '',
  part_number: '',
  part_description: '',
  model_code: '',
  part_type: level === 1 ? 'Group' : 'Single',
  part_category_id: '',
  production_order: '',
  actual_component: '',
});

const emptyShipping = {
  delivery_note_number: '',
  send_by_id: '',
  destination: '',
  consignment_notes: '',
  shipping_list: '',
  freight_cost_bill: '',
  delivery_date: '',
  return_to_stock_date: '',
  dn_received_by_customer: '',
  dn_received_by_ssb: '',
  dn_submit_date: '',
};

const emptyForm = {
  ssbr_ident: '',
  customer_id: '',
  customer_name: '',
  customer_site_name: '',
  received_date: today,
  tagging_time: '',
  received_by_id: '',
  reff_number: '',
  ex_unit: '',
  packing_list: '',
  da_ckb_received: '',
  packing_type_id: '',
  raw_sow_text: '',
  components: [emptyComponent(1)],
  shipping: { ...emptyShipping },
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function compactPayload(value) {
  if (Array.isArray(value)) return value.map(compactPayload);
  if (!value || typeof value !== 'object') return value === '' ? null : value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactPayload(entry)])
  );
}

function hasShippingValue(shipping) {
  return Object.values(shipping || {}).some(
    (value) => value !== '' && value !== null && value !== undefined
  );
}

function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function Field({ label, children, required = false }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-600">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function FormSection({ title, description, icon: Icon, accent = 'cyan', children, actions }) {
  const tone =
    {
      cyan: 'bg-cyan-50 text-[#0077b6] border-[#90e0ef]',
      emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    }[accent] || 'bg-cyan-50 text-[#0077b6] border-[#90e0ef]';

  return (
    <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${tone}`}
          >
            {Icon ? <Icon size={18} /> : null}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-extrabold text-slate-900">{title}</h3>
            {description && <p className="mt-0.5 truncate text-xs text-slate-500">{description}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatCard({ label, value, icon: Icon, tone }) {
  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          {React.createElement(Icon, { size: 20 })}
        </div>
      </div>
    </DashboardCard>
  );
}

function StatusBadge({ shipped }) {
  if (shipped) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
        <CheckCircle2 size={13} />
        Shipped
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
      <AlertCircle size={13} />
      Receiving
    </span>
  );
}

function ComponentPickerModal({ open, onClose, onSelect, initialItems = [] }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(initialItems.slice(0, 25));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (search.trim()) params.set('q', search.trim());
        const response = await fetch(
          `${API_BASE}/receiving-shipment/components?${params.toString()}`,
          {
            signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error('Failed to load components');
        const payload = await response.json();
        setRows(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setRows([]);
          toast.error(err.message || 'Gagal memuat component');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setRows(initialItems.slice(0, 25));
    }
  }, [initialItems, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 px-4"
      onClick={onClose}
    >
      <div
        className="flex h-[76vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">Pilih Master Component</h3>
            <p className="text-xs text-slate-500">Search by part number, part name, atau model.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <X size={17} />
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search part number, description, model..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
              <Loader2 size={18} className="mr-2 animate-spin text-[#0096c7]" />
              Loading components...
            </div>
          ) : rows.length ? (
            <div className="divide-y divide-slate-100 bg-white">
              {rows.map((item) => (
                <button
                  key={item.component_id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-800">
                      {item.part_name || '-'}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-[#0077b6]">
                      {item.part_number || 'No part number'}
                    </span>
                  </span>
                  <span className="self-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600">
                    {item.model || '-'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <PackageCheck size={34} className="text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-600">Component tidak ditemukan</p>
              <p className="mt-1 text-xs text-slate-400">
                Coba search part number, part name, atau model lain.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerPickerModal({ open, onClose, onSelect, onCreated }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    site_name: '',
    site_location: '',
    contact_person: '',
    phone: '',
    email: '',
  });

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (search.trim()) params.set('q', search.trim());
        const response = await fetch(
          `${API_BASE}/receiving-shipment/customers?${params.toString()}`,
          {
            signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error('Failed to load customers');
        const payload = await response.json();
        setRows(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setRows([]);
          toast.error(err.message || 'Gagal memuat customer');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setDraft({
        name: '',
        site_name: '',
        site_location: '',
        contact_person: '',
        phone: '',
        email: '',
      });
    }
  }, [open]);

  const createCustomer = async () => {
    if (!draft.name.trim()) {
      toast.error('Nama customer wajib diisi');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(`${API_BASE}/receiving-shipment/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          name: draft.name.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to create customer');
      onCreated(payload);
      onSelect(payload);
    } catch (err) {
      toast.error(err.message || 'Gagal menambah customer');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 px-4"
      onClick={onClose}
    >
      <div
        className="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">Pilih Customer</h3>
            <p className="text-xs text-slate-500">Search customer atau tambah daftar baru.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <X size={17} />
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search nama customer, site, PIC..."
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-[#00b4d8]/25"
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_360px]">
          <div className="min-h-0 overflow-auto bg-slate-50">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
                <Loader2 size={18} className="mr-2 animate-spin text-[#0096c7]" />
                Loading customers...
              </div>
            ) : rows.length ? (
              <div className="divide-y divide-slate-100 bg-white">
                {rows.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item)}
                    className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-800">
                        {item.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {item.site_name || item.site_location || 'General site'}
                      </span>
                    </span>
                    <span className="self-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {item.contact_person || '-'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <PackageCheck size={34} className="text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-600">Customer tidak ditemukan</p>
                <p className="mt-1 text-xs text-slate-400">
                  Tambahkan customer baru dari form sebelah.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-white p-4 md:border-l md:border-t-0">
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
              Tambah Customer
            </h4>
            <div className="mt-3 grid gap-3">
              {[
                ['name', 'Nama customer *'],
                ['site_name', 'Site name'],
                ['site_location', 'Site location'],
                ['contact_person', 'PIC'],
                ['phone', 'Phone'],
                ['email', 'Email'],
              ].map(([key, placeholder]) => (
                <input
                  key={key}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                  placeholder={placeholder}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-[#00b4d8]/25"
                />
              ))}
              <button
                type="button"
                onClick={createCustomer}
                disabled={creating}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 text-sm font-bold text-white transition hover:bg-[#0077b6] disabled:opacity-60"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add Customer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryPickerModal({ open, onClose, onSelect, onCreated, initialItems = [] }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(initialItems.slice(0, 30));
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (search.trim()) params.set('q', search.trim());
        const response = await fetch(
          `${API_BASE}/receiving-shipment/part-categories?${params.toString()}`,
          {
            signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error('Failed to load categories');
        const payload = await response.json();
        setRows(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setRows([]);
          toast.error(err.message || 'Gagal memuat category');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setNewName('');
      setRows(initialItems.slice(0, 30));
    }
  }, [initialItems, open]);

  const createCategory = async () => {
    if (!newName.trim()) {
      toast.error('Nama category wajib diisi');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(`${API_BASE}/receiving-shipment/part-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to create category');
      onCreated(payload);
      onSelect(payload);
    } catch (err) {
      toast.error(err.message || 'Gagal menambah category');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 px-4"
      onClick={onClose}
    >
      <div
        className="flex h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">Pilih Category</h3>
            <p className="text-xs text-slate-500">Search atau tambah category baru.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <X size={17} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-200 px-4 py-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search category..."
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-[#00b4d8]/25"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New category"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-[#00b4d8]/25 md:w-48"
            />
            <button
              type="button"
              onClick={createCategory}
              disabled={creating}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0096c7] text-white transition hover:bg-[#0077b6] disabled:opacity-60"
              title="Add category"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
              <Loader2 size={18} className="mr-2 animate-spin text-[#0096c7]" />
              Loading categories...
            </div>
          ) : rows.length ? (
            <div className="divide-y divide-slate-100 bg-white">
              {rows.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                >
                  <span className="text-sm font-bold text-slate-800">{item.name}</span>
                  <ChevronRight size={16} className="text-slate-400" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <PackageCheck size={34} className="text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-600">Category tidak ditemukan</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceivingShipmentPage() {
  const navigate = useNavigate();
  const [authUser] = useState(readAuthUser);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [lookups, setLookups] = useState({
    customers: [],
    users: [],
    part_categories: [],
    packing_types: [],
    components: [],
  });
  const [query, setQuery] = useState('');
  const [shippedFilter, setShippedFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState(emptyForm);
  const [componentPickerIndex, setComponentPickerIndex] = useState(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [categoryPickerIndex, setCategoryPickerIndex] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedIdRef = useRef(null);

  const stats = useMemo(() => {
    const shipped = records.filter((item) => item.shipping_id).length;
    const totalComponents = records.reduce(
      (sum, item) => sum + Number(item.component_count || 0),
      0
    );

    return {
      total: records.length,
      shipped,
      open: records.length - shipped,
      components: totalComponents,
    };
  }, [records]);

  const hasMoreRecords = records.length < pagination.total;

  const selectedComponentSummary = useMemo(() => {
    if (!selected?.components?.length) return { parent: 0, child: 0 };
    return selected.components.reduce(
      (summary, component) => ({
        parent: summary.parent + (Number(component.part_level) === 1 ? 1 : 0),
        child: summary.child + (Number(component.part_level) === 2 ? 1 : 0),
      }),
      { parent: 0, child: 0 }
    );
  }, [selected]);

  const selectedCustomer = useMemo(
    () =>
      lookups.customers.find((customer) => String(customer.id) === String(form.customer_id)) ||
      (form.customer_id
        ? { id: form.customer_id, name: form.customer_name, site_name: form.customer_site_name }
        : null),
    [form.customer_id, form.customer_name, form.customer_site_name, lookups.customers]
  );

  const getCategoryName = useCallback(
    (id) =>
      lookups.part_categories.find((category) => String(category.id) === String(id))?.name || '',
    [lookups.part_categories]
  );

  const inputClass =
    'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition placeholder-slate-400 hover:border-slate-400 focus:border-[#0096c7] focus:ring-2 focus:ring-[#00b4d8]/25 disabled:bg-slate-50 disabled:text-slate-400';
  const textAreaClass =
    'min-h-[96px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition placeholder-slate-400 hover:border-slate-400 focus:border-[#0096c7] focus:ring-2 focus:ring-[#00b4d8]/25';

  useEffect(() => {
    selectedIdRef.current = selected?.id || null;
  }, [selected?.id]);

  const loadLookups = async () => {
    const response = await fetch(`${API_BASE}/receiving-shipment/lookups`);
    if (!response.ok) throw new Error('Failed to load lookup data');
    const payload = await response.json();
    setLookups({
      customers: payload.customers || [],
      users: payload.users || [],
      part_categories: payload.part_categories || [],
      packing_types: payload.packing_types || [],
      components: payload.components || [],
    });
  };

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/receiving-shipment/${id}`);
      if (!response.ok) throw new Error('Failed to load receiving shipment detail');
      const payload = await response.json();
      setSelected(payload);
      setDetailOpen(true);
    } catch (err) {
      setError(err.message);
      toast.error(err.message || 'Gagal memuat detail receiving');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadRecords = useCallback(
    async ({ notify = false, page = 1, append = false } = {}) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        const params = new URLSearchParams({ limit: String(pagination.limit), page: String(page) });
        if (query.trim()) params.set('q', query.trim());
        if (shippedFilter) params.set('shipped', shippedFilter);

        const response = await fetch(`${API_BASE}/receiving-shipment?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to load receiving shipment data');

        const payload = await response.json();
        const nextRecords = payload.data || [];
        setRecords((current) => (append ? [...current, ...nextRecords] : nextRecords));
        setPagination(
          payload.pagination || { page, limit: pagination.limit, total: nextRecords.length }
        );
        if (notify) toast.success(`Receiving list refreshed (${nextRecords.length} record)`);

        const selectedId = selectedIdRef.current;
        if (
          !append &&
          (!nextRecords.length ||
            (selectedId && !nextRecords.some((item) => item.id === selectedId)))
        ) {
          setSelected(null);
          setDetailOpen(false);
        }
      } catch (err) {
        setError(err.message);
        toast.error(err.message || 'Gagal memuat data receiving');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [pagination.limit, query, shippedFilter]
  );

  useEffect(() => {
    loadLookups().catch((err) => {
      setError(err.message);
      toast.error(err.message || 'Gagal memuat lookup receiving');
    });
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadRecords({ page: 1 });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loadRecords]);

  const loadMoreRecords = () => {
    if (loading || loadingMore || !hasMoreRecords) return;
    loadRecords({ page: pagination.page + 1, append: true });
  };

  const setFormValue = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setShippingValue = (key, value) => {
    setForm((current) => ({
      ...current,
      shipping: { ...current.shipping, [key]: value },
    }));
  };

  const setComponentValue = (index, key, value) => {
    setForm((current) => {
      const components = current.components.map((component, componentIndex) => {
        if (componentIndex !== index) return component;

        const nextComponent = { ...component, [key]: value };
        if (key === 'component_id') {
          const master = lookups.components.find(
            (item) => String(item.component_id) === String(value)
          );
          if (master) {
            nextComponent.part_number = master.part_number || '';
            nextComponent.part_description = master.part_name || '';
            nextComponent.model_code = master.model || '';
          }
        }

        if (key === 'part_level') {
          nextComponent.part_type = Number(value) === 1 ? 'Group' : 'Single';
        }

        return nextComponent;
      });

      return { ...current, components };
    });
  };

  const clearComponentMaster = (index) => {
    setForm((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index
          ? {
              ...component,
              component_id: '',
              part_number: '',
              part_description: '',
              model_code: '',
            }
          : component
      ),
    }));
  };

  const applyComponentMaster = (index, master) => {
    setForm((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index
          ? {
              ...component,
              component_id: master.component_id || '',
              part_number: master.part_number || '',
              part_description: master.part_name || '',
              model_code: master.model || '',
            }
          : component
      ),
    }));
    setComponentPickerIndex(null);
    toast.success('Master component dipilih');
  };

  const applyCustomer = (customer) => {
    setLookups((current) => ({
      ...current,
      customers: current.customers.some((item) => String(item.id) === String(customer.id))
        ? current.customers
        : [...current.customers, customer].sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''))
          ),
    }));
    setForm((current) => ({
      ...current,
      customer_id: customer.id || '',
      customer_name: customer.name || '',
      customer_site_name: customer.site_name || '',
    }));
    setCustomerPickerOpen(false);
    toast.success('Customer dipilih');
  };

  const applyCategory = (index, category) => {
    setLookups((current) => ({
      ...current,
      part_categories: current.part_categories.some(
        (item) => String(item.id) === String(category.id)
      )
        ? current.part_categories
        : [...current.part_categories, category].sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''))
          ),
    }));
    setComponentValue(index, 'part_category_id', category.id || '');
    setCategoryPickerIndex(null);
    toast.success('Category dipilih');
  };

  const openCreate = () => {
    setMode('create');
    setForm({
      ...emptyForm,
      components: [emptyComponent(1)],
      shipping: { ...emptyShipping },
      received_by_id: authUser?.id || '',
    });
    setComponentPickerIndex(null);
    setCategoryPickerIndex(null);
    setCustomerPickerOpen(false);
    setDrawerOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;

    setMode('edit');
    setForm({
      ssbr_ident: selected.ssbr_ident || '',
      customer_id: selected.customer_id || '',
      customer_name: selected.customer_name || '',
      customer_site_name: selected.customer_site_name || '',
      received_date: selected.received_date || today,
      tagging_time: selected.tagging_time || '',
      received_by_id: selected.received_by_id || '',
      reff_number: selected.reff_number || '',
      ex_unit: selected.ex_unit || '',
      packing_list: selected.packing_list || '',
      da_ckb_received: selected.da_ckb_received || '',
      packing_type_id: selected.packing_type_id || '',
      raw_sow_text: selected.raw_sow_text || '',
      components: selected.components?.length
        ? selected.components.map((component) => ({
            part_level: component.part_level || 1,
            component_id: component.component_id || '',
            part_number: component.part_number || '',
            part_description: component.part_description || '',
            model_code: component.model_code || '',
            part_type: component.part_type || '',
            part_category_id: component.part_category_id || '',
            production_order: component.production_order || '',
            actual_component: component.actual_component || '',
          }))
        : [emptyComponent(1)],
      shipping: selected.shipping
        ? { ...emptyShipping, ...selected.shipping }
        : { ...emptyShipping },
    });
    setComponentPickerIndex(null);
    setCategoryPickerIndex(null);
    setCustomerPickerOpen(false);
    setDrawerOpen(true);
  };

  const addComponentRow = (level) => {
    setForm((current) => ({
      ...current,
      components: [...current.components, emptyComponent(level)],
    }));
  };

  const removeComponentRow = (index) => {
    setForm((current) => ({
      ...current,
      components: current.components.filter((_, componentIndex) => componentIndex !== index),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (!form.customer_id && !form.customer_name.trim()) {
        throw new Error('Pilih atau tambah customer terlebih dahulu');
      }

      const components = form.components
        .filter((component) => component.part_description.trim())
        .map((component) => compactPayload(component));

      const payload = compactPayload({
        ssbr_ident: form.ssbr_ident.trim(),
        customer_id: form.customer_id || null,
        customer: form.customer_id
          ? null
          : {
              name: form.customer_name.trim(),
              site_name: form.customer_site_name.trim() || null,
            },
        received_date: form.received_date,
        tagging_time: form.tagging_time || null,
        received_by_id: form.received_by_id || null,
        reff_number: form.reff_number,
        ex_unit: form.ex_unit,
        packing_list: form.packing_list,
        da_ckb_received: form.da_ckb_received,
        packing_type_id: form.packing_type_id || null,
        raw_sow_text: form.raw_sow_text,
        components,
        shipping: hasShippingValue(form.shipping) ? form.shipping : null,
      });

      const url =
        mode === 'edit'
          ? `${API_BASE}/receiving-shipment/${selected.id}`
          : `${API_BASE}/receiving-shipment`;
      const response = await fetch(url, {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save receiving shipment');
      }

      const saved = await response.json();
      setDrawerOpen(false);
      await loadRecords();
      await loadDetail(saved.id);
      toast.success(
        mode === 'edit' ? 'Receiving record berhasil diupdate' : 'Receiving record berhasil dibuat'
      );
    } catch (err) {
      setError(err.message);
      toast.error(err.message || 'Gagal menyimpan receiving record');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`Delete receiving shipment ${selected.ssbr_ident}?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/receiving-shipment/${selected.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete receiving shipment');
      setSelected(null);
      setDetailOpen(false);
      await loadRecords();
      toast.success('Receiving record berhasil dihapus');
    } catch (err) {
      setError(err.message);
      toast.error(err.message || 'Gagal menghapus receiving record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb] text-slate-800">
      <header className="z-20 flex-shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex min-h-[72px] items-center justify-between gap-4 px-5 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              title="Back to MPS Main"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0096c7]">
                Receiving & Shipping
              </p>
              <h1 className="truncate text-xl font-extrabold text-slate-950 lg:text-2xl">
                Shipping Receiving Control
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadRecords({ notify: true })}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0096c7] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0077b6]"
            >
              <Plus size={17} />
              New SSBR
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-5 lg:px-7">
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="rounded-lg p-1 hover:bg-red-100"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section className="grid flex-shrink-0 gap-3 lg:grid-cols-4">
          <StatCard
            label="Visible SSBR"
            value={stats.total}
            icon={ClipboardList}
            tone="bg-sky-50 text-sky-700"
          />
          <StatCard
            label="Shipped"
            value={stats.shipped}
            icon={Truck}
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            label="Open Receiving"
            value={stats.open}
            icon={PackageCheck}
            tone="bg-amber-50 text-amber-700"
          />
          <StatCard
            label="Components"
            value={stats.components}
            icon={Layers3}
            tone="bg-indigo-50 text-indigo-700"
          />
        </section>

        <section className="min-h-0 flex-1">
          <DashboardCard className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-slate-200 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-extrabold text-slate-950">Receiving Orders</h2>
                </div>
                <div className="flex min-w-0 flex-1 gap-2 lg:max-w-xl">
                  <div className="relative flex-1">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search SSBR, customer, DN, component..."
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
                    />
                  </div>
                  <select
                    value={shippedFilter}
                    onChange={(event) => setShippedFilter(event.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-cyan-100"
                  >
                    <option value="">All status</option>
                    <option value="false">Receiving</option>
                    <option value="true">Shipped</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-50/70">
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-sm">
                <thead
                  className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-slate-600 shadow-[0_1px_0_0_rgba(148,163,184,0.25)]"
                  style={{ background: '#caf0f8' }}
                >
                  <tr>
                    <th
                      className="sticky left-0 z-20 px-4 py-3 font-bold"
                      style={{ background: '#caf0f8' }}
                    >
                      SSBR-ID
                    </th>
                    <th className="px-4 py-3 font-bold">Customer</th>
                    <th className="px-4 py-3 font-bold">Received</th>
                    <th className="px-4 py-3 font-bold">Components</th>
                    <th className="px-4 py-3 font-bold">Shipment</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan="7"
                        className="px-4 py-12 text-center text-sm font-semibold text-slate-500"
                      >
                        <Loader2 size={22} className="mx-auto mb-2 animate-spin text-[#0096c7]" />
                        Loading receiving shipments...
                      </td>
                    </tr>
                  ) : records.length ? (
                    records.map((item) => {
                      const isSelected = selected?.id === item.id;
                      const isShipped = Boolean(item.shipping_id);
                      return (
                        <tr
                          key={item.id}
                          className={`group cursor-pointer transition ${
                            isSelected ? 'bg-cyan-50' : 'bg-white hover:bg-slate-50'
                          }`}
                          onClick={() => loadDetail(item.id)}
                        >
                          <td
                            className={`sticky left-0 z-[1] border-b border-slate-100 px-4 py-3 shadow-[1px_0_0_0_rgba(226,232,240,0.9)] ${isSelected ? 'bg-cyan-50' : 'bg-white group-hover:bg-slate-50'}`}
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`h-10 w-1 rounded-full ${isShipped ? 'bg-emerald-500' : 'bg-amber-500'}`}
                              />
                              <span className="min-w-0">
                                <span className="block font-mono text-xs font-extrabold text-slate-900">
                                  {item.ssbr_ident}
                                </span>
                                <span className="mt-1 block truncate text-[11px] text-slate-400">
                                  {item.reff_number || 'No reference'}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-3">
                            <div className="max-w-[220px] truncate font-bold text-slate-800">
                              {item.customer_name}
                            </div>
                            <div className="mt-1 max-w-[220px] truncate text-xs text-slate-500">
                              {item.customer_site_name || 'General site'}
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                            {formatDate(item.received_date)}
                          </td>
                          <td className="border-b border-slate-100 px-4 py-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                              <span className="text-xs font-extrabold text-slate-800">
                                {item.component_count || 0}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-500">
                                {item.parent_component_count || 0}P /{' '}
                                {item.child_component_count || 0}C
                              </span>
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-3">
                            <div className="max-w-[180px] truncate font-mono text-xs font-bold text-slate-700">
                              {item.delivery_note_number || '-'}
                            </div>
                            <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">
                              {item.destination || 'Not shipped'}
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-4 py-3">
                            <StatusBadge shipped={isShipped} />
                          </td>
                          <td className="border-b border-slate-100 px-4 py-3">
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#90e0ef] bg-white px-2.5 text-xs font-bold text-[#0077b6] transition hover:bg-[#caf0f8]"
                              onClick={(event) => {
                                event.stopPropagation();
                                loadDetail(item.id);
                              }}
                            >
                              Detail
                              <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan="7"
                        className="px-4 py-12 text-center text-sm font-semibold text-slate-500"
                      >
                        No receiving shipment records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {!loading && (
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500">
                    Showing {records.length} of {pagination.total} receiving records
                  </p>
                  <button
                    type="button"
                    onClick={loadMoreRecords}
                    disabled={!hasMoreRecords || loadingMore}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <Loader2 size={15} className="animate-spin text-[#0096c7]" />
                    ) : null}
                    {hasMoreRecords ? 'Load More' : 'All Loaded'}
                  </button>
                </div>
              )}
            </div>
          </DashboardCard>

          {detailOpen && selected && (
            <div className="fixed inset-0 z-30">
              <button
                type="button"
                className="absolute inset-0 bg-slate-950/25"
                onClick={() => setDetailOpen(false)}
                aria-label="Close detail panel"
              />
              <aside className="absolute right-0 top-0 flex h-full w-full max-w-[580px] flex-col bg-[#f6f8fb] shadow-2xl">
                <DashboardCard className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-y-0 border-r-0">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <h2 className="text-base font-extrabold text-slate-950">SSBR Detail</h2>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!selected || detailLoading}
                        onClick={openEdit}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={!selected || saving}
                        onClick={handleDelete}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailOpen(false)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {detailLoading ? (
                    <div className="flex flex-1 items-center justify-center text-sm font-semibold text-slate-500">
                      <Loader2 size={22} className="mr-2 animate-spin text-[#0096c7]" />
                      Loading detail...
                    </div>
                  ) : selected ? (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-xl font-extrabold text-slate-950">
                              {selected.ssbr_ident}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-600">
                              {selected.customer_name}{' '}
                              {selected.customer_site_name
                                ? `- ${selected.customer_site_name}`
                                : ''}
                            </p>
                          </div>
                          <StatusBadge shipped={Boolean(selected.shipping)} />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="font-bold uppercase tracking-wide text-slate-400">
                              Received
                            </p>
                            <p className="mt-1 font-bold text-slate-800">
                              {formatDate(selected.received_date)}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-wide text-slate-400">
                              Received By
                            </p>
                            <p className="mt-1 font-bold text-slate-800">
                              {selected.received_by_name || '-'}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-wide text-slate-400">
                              Ex Unit
                            </p>
                            <p className="mt-1 font-bold text-slate-800">
                              {selected.ex_unit || '-'}
                            </p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-wide text-slate-400">
                              Packing
                            </p>
                            <p className="mt-1 font-bold text-slate-800">
                              {selected.packing_type_name || selected.packing_list || '-'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-[11px] font-bold text-slate-500">Parent</p>
                          <p className="mt-1 text-xl font-extrabold text-slate-950">
                            {selectedComponentSummary.parent}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-[11px] font-bold text-slate-500">Child</p>
                          <p className="mt-1 text-xl font-extrabold text-slate-950">
                            {selectedComponentSummary.child}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-[11px] font-bold text-slate-500">DN</p>
                          <p className="mt-1 truncate text-sm font-extrabold text-slate-950">
                            {selected.shipping?.delivery_note_number || '-'}
                          </p>
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                          Shipment
                        </h3>
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="font-bold uppercase tracking-wide text-slate-400">
                                Destination
                              </p>
                              <p className="mt-1 font-bold text-slate-800">
                                {selected.shipping?.destination || '-'}
                              </p>
                            </div>
                            <div>
                              <p className="font-bold uppercase tracking-wide text-slate-400">
                                Delivery Date
                              </p>
                              <p className="mt-1 font-bold text-slate-800">
                                {formatDate(selected.shipping?.delivery_date)}
                              </p>
                            </div>
                            <div>
                              <p className="font-bold uppercase tracking-wide text-slate-400">
                                Consignment
                              </p>
                              <p className="mt-1 font-bold text-slate-800">
                                {selected.shipping?.consignment_notes || '-'}
                              </p>
                            </div>
                            <div>
                              <p className="font-bold uppercase tracking-wide text-slate-400">
                                Send By
                              </p>
                              <p className="mt-1 font-bold text-slate-800">
                                {selected.shipping?.send_by_name || '-'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                          Components
                        </h3>
                        <div className="max-h-[260px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                          {selected.components?.map((component) => (
                            <div
                              key={component.id}
                              className="grid grid-cols-[52px_1fr] gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                            >
                              <div
                                className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-extrabold ${
                                  Number(component.part_level) === 1
                                    ? 'bg-sky-50 text-sky-700'
                                    : 'bg-indigo-50 text-indigo-700'
                                }`}
                              >
                                L{component.part_level}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-extrabold text-slate-800">
                                  {component.part_description}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-slate-500">
                                  {component.part_number || component.master_part_number || '-'} |{' '}
                                  {component.model_code || component.master_model || '-'} |{' '}
                                  {component.production_order || 'No prod order'}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-[520px] flex-col items-center justify-center px-6 text-center">
                      <PackageCheck size={42} className="text-slate-300" />
                      <p className="mt-3 text-sm font-bold text-slate-600">
                        Select a receiving order
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Detail will appear here after you choose an SSBR-ID.
                      </p>
                    </div>
                  )}
                </DashboardCard>
              </aside>
            </div>
          )}
        </section>
      </main>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-slate-100">
          <section className="flex h-full w-full flex-col bg-slate-100">
            <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
              <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-slate-300 bg-white px-5 py-4 shadow-sm lg:px-7">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[#90e0ef] bg-[#caf0f8] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#0077b6]">
                      {mode === 'edit' ? 'Edit Record' : 'New Record'}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                      {form.components.length} component
                    </span>
                    {hasShippingValue(form.shipping) && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                        Shipment filled
                      </span>
                    )}
                  </div>
                  <h2 className="mt-2 truncate text-xl font-extrabold text-slate-950">
                    {mode === 'edit' ? form.ssbr_ident || 'Edit SSBR record' : 'Create SSBR record'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                  title="Close form"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100/70 px-5 py-5 lg:px-7">
                <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.72fr)]">
                    <FormSection
                      title="Receiving Main Information"
                      description=""
                      icon={ClipboardList}
                      accent="cyan"
                    >
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Field label="SSBR-ID" required>
                          <input
                            value={form.ssbr_ident}
                            onChange={(event) => setFormValue('ssbr_ident', event.target.value)}
                            className={inputClass}
                            required
                          />
                        </Field>
                        <Field label="Received Date" required>
                          <input
                            type="date"
                            value={form.received_date}
                            onChange={(event) => setFormValue('received_date', event.target.value)}
                            className={inputClass}
                            required
                          />
                        </Field>
                        <Field label="Customer">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setCustomerPickerOpen(true)}
                              className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/25"
                            >
                              <span className="min-w-0 truncate">
                                {selectedCustomer?.name || 'Pilih customer'}
                                {selectedCustomer?.site_name
                                  ? ` - ${selectedCustomer.site_name}`
                                  : ''}
                              </span>
                              <Search size={15} className="shrink-0 text-[#0077b6]" />
                            </button>
                            {form.customer_id && (
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    customer_id: '',
                                    customer_name: '',
                                    customer_site_name: '',
                                  }))
                                }
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                                title="Clear customer"
                              >
                                <X size={15} />
                              </button>
                            )}
                          </div>
                        </Field>
                        <Field label="Received By">
                          <select
                            value={form.received_by_id}
                            onChange={(event) => setFormValue('received_by_id', event.target.value)}
                            disabled={mode === 'create' && Boolean(authUser?.id)}
                            className={inputClass}
                          >
                            <option value="">-</option>
                            {authUser?.id &&
                              !lookups.users.some(
                                (user) => String(user.id) === String(authUser.id)
                              ) && (
                                <option value={authUser.id}>
                                  {authUser.name || authUser.username}
                                </option>
                              )}
                            {lookups.users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Reference Number">
                          <input
                            value={form.reff_number}
                            onChange={(event) => setFormValue('reff_number', event.target.value)}
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Ex Unit">
                          <input
                            value={form.ex_unit}
                            onChange={(event) => setFormValue('ex_unit', event.target.value)}
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Packing Type">
                          <select
                            value={form.packing_type_id}
                            onChange={(event) =>
                              setFormValue('packing_type_id', event.target.value)
                            }
                            className={inputClass}
                          >
                            <option value="">-</option>
                            {lookups.packing_types.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Packing List">
                          <input
                            value={form.packing_list}
                            onChange={(event) => setFormValue('packing_list', event.target.value)}
                            className={inputClass}
                          />
                        </Field>
                        <Field label="DA/CKB Received">
                          <input
                            value={form.da_ckb_received}
                            onChange={(event) =>
                              setFormValue('da_ckb_received', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Tagging Time">
                          <input
                            type="datetime-local"
                            value={form.tagging_time?.slice(0, 16) || ''}
                            onChange={(event) => setFormValue('tagging_time', event.target.value)}
                            className={inputClass}
                          />
                        </Field>
                        <div className="md:col-span-2 xl:col-span-3">
                          <Field label="Raw SOW Text">
                            <textarea
                              value={form.raw_sow_text}
                              onChange={(event) => setFormValue('raw_sow_text', event.target.value)}
                              className={textAreaClass}
                            />
                          </Field>
                        </div>
                      </div>
                    </FormSection>

                    <FormSection title="Shipment" description="" icon={Truck} accent="emerald">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Field label="Delivery Note">
                          <input
                            value={form.shipping.delivery_note_number || ''}
                            onChange={(event) =>
                              setShippingValue('delivery_note_number', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Delivery Date">
                          <input
                            type="date"
                            value={form.shipping.delivery_date || ''}
                            onChange={(event) =>
                              setShippingValue('delivery_date', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Send By">
                          <select
                            value={form.shipping.send_by_id || ''}
                            onChange={(event) => setShippingValue('send_by_id', event.target.value)}
                            className={inputClass}
                          >
                            <option value="">-</option>
                            {lookups.users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Destination">
                          <input
                            value={form.shipping.destination || ''}
                            onChange={(event) =>
                              setShippingValue('destination', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Consignment Notes">
                          <input
                            value={form.shipping.consignment_notes || ''}
                            onChange={(event) =>
                              setShippingValue('consignment_notes', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Shipping List">
                          <input
                            value={form.shipping.shipping_list || ''}
                            onChange={(event) =>
                              setShippingValue('shipping_list', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Freight Cost Bill">
                          <input
                            value={form.shipping.freight_cost_bill || ''}
                            onChange={(event) =>
                              setShippingValue('freight_cost_bill', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Return To Stock">
                          <input
                            type="date"
                            value={form.shipping.return_to_stock_date || ''}
                            onChange={(event) =>
                              setShippingValue('return_to_stock_date', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="DN Received Customer">
                          <input
                            type="date"
                            value={form.shipping.dn_received_by_customer || ''}
                            onChange={(event) =>
                              setShippingValue('dn_received_by_customer', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="DN Submit Date">
                          <input
                            type="date"
                            value={form.shipping.dn_submit_date || ''}
                            onChange={(event) =>
                              setShippingValue('dn_submit_date', event.target.value)
                            }
                            className={inputClass}
                          />
                        </Field>
                      </div>
                    </FormSection>
                  </div>

                  <FormSection
                    title="Component Breakdown"
                    description=""
                    icon={Layers3}
                    accent="indigo"
                    actions={
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => addComponentRow(1)}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Add Parent
                        </button>
                        <button
                          type="button"
                          onClick={() => addComponentRow(2)}
                          className="h-9 rounded-lg bg-[#0096c7] px-3 text-xs font-bold text-white hover:bg-[#0077b6]"
                        >
                          Add Child
                        </button>
                      </div>
                    }
                  >
                    <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
                          <thead
                            className="text-[11px] uppercase tracking-wide text-slate-600"
                            style={{ background: '#caf0f8' }}
                          >
                            <tr>
                              <th className="px-3 py-3">Level</th>
                              <th className="px-3 py-3">Part Number</th>
                              <th className="px-3 py-3">Part Name</th>
                              <th className="px-3 py-3">Model</th>
                              <th className="px-3 py-3">Type</th>
                              <th className="px-3 py-3">Category</th>
                              <th className="px-3 py-3">Prod Order</th>
                              <th className="px-3 py-3">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {form.components.map((component, index) => (
                              <tr
                                key={`${index}-${component.part_level}`}
                                className="group bg-white transition hover:bg-slate-50"
                              >
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <div className="flex min-w-[150px] items-center gap-2">
                                    <span
                                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                                        Number(component.part_level) === 1
                                          ? 'bg-cyan-50 text-[#0077b6]'
                                          : 'bg-indigo-50 text-indigo-700'
                                      }`}
                                    >
                                      L{component.part_level}
                                    </span>
                                    <select
                                      value={component.part_level}
                                      onChange={(event) =>
                                        setComponentValue(
                                          index,
                                          'part_level',
                                          Number(event.target.value)
                                        )
                                      }
                                      className={inputClass}
                                    >
                                      <option value={1}>Parent</option>
                                      <option value={2}>Child</option>
                                    </select>
                                  </div>
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <div className="flex min-w-[210px] items-center gap-2">
                                    <input
                                      value={component.part_number || ''}
                                      onChange={(event) =>
                                        setComponentValue(index, 'part_number', event.target.value)
                                      }
                                      className={`${inputClass} min-w-[140px]`}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setComponentPickerIndex(index)}
                                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#90e0ef] bg-white text-[#0077b6] transition hover:bg-[#caf0f8] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                                      title="Pilih master component"
                                    >
                                      <Search size={15} />
                                    </button>
                                    {(component.component_id ||
                                      component.part_number ||
                                      component.part_description ||
                                      component.model_code) && (
                                      <button
                                        type="button"
                                        onClick={() => clearComponentMaster(index)}
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                        title="Clear part data"
                                      >
                                        <X size={15} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <input
                                    value={component.part_description || ''}
                                    onChange={(event) =>
                                      setComponentValue(
                                        index,
                                        'part_description',
                                        event.target.value
                                      )
                                    }
                                    className={`${inputClass} min-w-[260px]`}
                                    required
                                  />
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <input
                                    value={component.model_code || ''}
                                    onChange={(event) =>
                                      setComponentValue(index, 'model_code', event.target.value)
                                    }
                                    className={`${inputClass} min-w-[90px]`}
                                  />
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <select
                                    value={component.part_type || ''}
                                    onChange={(event) =>
                                      setComponentValue(index, 'part_type', event.target.value)
                                    }
                                    className={`${inputClass} min-w-[130px]`}
                                  >
                                    <option value="">-</option>
                                    <option value="Group">Group</option>
                                    <option value="Single">Single</option>
                                  </select>
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <div className="flex min-w-[170px] items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setCategoryPickerIndex(index)}
                                      className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]/25"
                                    >
                                      <span className="truncate">
                                        {getCategoryName(component.part_category_id) || '-'}
                                      </span>
                                      <Search size={14} className="shrink-0 text-[#0077b6]" />
                                    </button>
                                    {component.part_category_id && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setComponentValue(index, 'part_category_id', '')
                                        }
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                        title="Clear category"
                                      >
                                        <X size={15} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <input
                                    value={component.production_order || ''}
                                    onChange={(event) =>
                                      setComponentValue(
                                        index,
                                        'production_order',
                                        event.target.value
                                      )
                                    }
                                    className={`${inputClass} min-w-[130px]`}
                                  />
                                </td>
                                <td className="border-t border-slate-100 px-3 py-3">
                                  <button
                                    type="button"
                                    onClick={() => removeComponentRow(index)}
                                    disabled={form.components.length === 1}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </FormSection>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-300 bg-white px-5 py-4 shadow-[0_-1px_8px_rgba(15,23,42,0.04)] lg:px-7">
                <p className="text-xs font-semibold text-slate-500"></p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0096c7] px-4 text-sm font-bold text-white hover:bg-[#0077b6] disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}

      <ComponentPickerModal
        open={componentPickerIndex !== null}
        initialItems={lookups.components}
        onClose={() => setComponentPickerIndex(null)}
        onSelect={(component) => {
          if (componentPickerIndex !== null) applyComponentMaster(componentPickerIndex, component);
        }}
      />

      <CustomerPickerModal
        open={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        onCreated={(customer) => {
          setLookups((current) => ({
            ...current,
            customers: current.customers.some((item) => String(item.id) === String(customer.id))
              ? current.customers
              : [...current.customers, customer].sort((a, b) =>
                  String(a.name || '').localeCompare(String(b.name || ''))
                ),
          }));
        }}
        onSelect={applyCustomer}
      />

      <CategoryPickerModal
        open={categoryPickerIndex !== null}
        initialItems={lookups.part_categories}
        onClose={() => setCategoryPickerIndex(null)}
        onCreated={(category) => {
          setLookups((current) => ({
            ...current,
            part_categories: current.part_categories.some(
              (item) => String(item.id) === String(category.id)
            )
              ? current.part_categories
              : [...current.part_categories, category].sort((a, b) =>
                  String(a.name || '').localeCompare(String(b.name || ''))
                ),
          }));
        }}
        onSelect={(category) => {
          if (categoryPickerIndex !== null) applyCategory(categoryPickerIndex, category);
        }}
      />
    </div>
  );
}

export default ReceivingShipmentPage;
