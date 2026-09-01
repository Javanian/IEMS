import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STATUS_OPTIONS = [
  'available',
  'reserved',
  'borrowed',
  'handover_pending',
  'maintenance',
  'calibration',
  'broken',
  'lost',
  'retired',
];

const emptyToolForm = {
  quantity_total: '',
  quantity_available: '',
  condition_id: '',
  availability_status: '',
  notes: '',
};

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

function statusClass(status) {
  if (status === 'available') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'borrowed' || status === 'reserved' || status === 'handover_pending')
    return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'broken' || status === 'lost' || status === 'retired')
    return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-sky-50 text-sky-700 border-sky-200';
}

function conditionClass(code) {
  if (code === 'GOOD') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (code === 'ON_CALIBRATION') return 'bg-sky-50 text-sky-700 border-sky-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function inputClass(extra = '') {
  return `h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#00b4d8] focus:ring-2 focus:ring-cyan-100 ${extra}`;
}

function ActionButton({ children, onClick, disabled, tone = 'primary', title, type = 'button' }) {
  const tones = {
    primary: 'bg-[#0077b6] text-white hover:bg-[#023e8a]',
    neutral: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
    warning: 'bg-amber-500 text-white hover:bg-amber-600',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-xs font-extrabold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function Metric({ label, value, icon, tone }) {
  const Icon = icon;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
        </div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-md ${tone}`}>
          <Icon size={17} />
        </span>
      </div>
    </div>
  );
}

function Message({ message, onClose }) {
  if (!message) return null;
  const isError = message.type === 'error';
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-bold ${
        isError
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      <span className="inline-flex items-center gap-2">
        {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
        {message.text}
      </span>
      <button type="button" onClick={onClose} className="rounded p-1 hover:bg-black/5">
        <X size={15} />
      </button>
    </div>
  );
}

function TabButton({ active, icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-black transition ${
        active
          ? 'bg-[#0077b6] text-white shadow-sm'
          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon size={16} />
      {children}
    </button>
  );
}

export default function ToolsManagementPage() {
  const navigate = useNavigate();
  const authUser = useMemo(readAuthUser, []);
  const [activeTab, setActiveTab] = useState('admin');
  const [tools, setTools] = useState([]);
  const [categories, setCategories] = useState([]);
  const [conditions, setConditions] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [filters, setFilters] = useState({ search: '', category: '', status: '', condition: '' });
  const [toolForm, setToolForm] = useState(emptyToolForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState(null);

  const loadLookups = useCallback(async () => {
    const [categoryPayload, conditionPayload] = await Promise.all([
      request('/tools/categories'),
      request('/tools/conditions'),
    ]);
    setCategories(Array.isArray(categoryPayload) ? categoryPayload : []);
    setConditions(Array.isArray(conditionPayload) ? conditionPayload : []);
  }, []);

  const loadTools = useCallback(async () => {
    const params = new URLSearchParams();
    Object.entries({ ...filters, limit: 100 }).forEach(([key, value]) => {
      if (value !== '' && value != null) params.set(key, value);
    });
    const payload = await request(`/tools?${params.toString()}`);
    setTools(Array.isArray(payload.data) ? payload.data : []);
  }, [filters]);

  const loadWorkflow = useCallback(async () => {
    const reservationPayload = await request('/tools/reservations?limit=100');
    setReservations(Array.isArray(reservationPayload) ? reservationPayload : []);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([loadLookups(), loadTools(), loadWorkflow()]);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [loadLookups, loadTools, loadWorkflow]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const metrics = useMemo(() => {
    const total = tools.length;
    const available = tools.filter((tool) => tool.availability_status === 'available').length;
    const borrowed = tools.filter((tool) => tool.availability_status === 'borrowed').length;
    const attention = tools.filter((tool) =>
      ['broken', 'lost', 'retired', 'calibration', 'maintenance'].includes(tool.availability_status)
    ).length;
    return { total, available, borrowed, attention };
  }, [tools]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    setToolForm({
      quantity_total: String(Number(tool.quantity_total || 0)),
      quantity_available: String(Number(tool.quantity_available || 0)),
      condition_id: tool.condition_id ? String(tool.condition_id) : '',
      availability_status: tool.availability_status || '',
      notes: tool.notes || '',
    });
  };

  const saveTool = async (event) => {
    event.preventDefault();
    if (!selectedTool) return;
    setSaving('tool');
    setMessage(null);
    try {
      const payload = await request(`/tools/${selectedTool.tool_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...toolForm,
          actor_office_user_id: authUser?.id || null,
          log_notes: 'Updated from admin tools page',
        }),
      });
      setSelectedTool(payload);
      setMessage({ type: 'success', text: 'Tool berhasil di-update' });
      await Promise.all([loadTools(), loadWorkflow()]);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving('');
    }
  };

  const updateReservation = async (reservation, action) => {
    setSaving(`${action}-${reservation.reservation_id}`);
    setMessage(null);
    try {
      await request(`/tools/reservations/${reservation.reservation_id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({
          actor_office_user_id: authUser?.id || null,
        }),
      });
      setMessage({ type: 'success', text: `Reservasi ${action} berhasil` });
      await loadWorkflow();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-50 text-slate-800">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-lg font-black text-slate-950">Tools Management</h1>
              <p className="text-xs font-semibold text-slate-500">
                Admin inventory update and reservation approval
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TabButton
              active={activeTab === 'admin'}
              icon={ShieldCheck}
              onClick={() => setActiveTab('admin')}
            >
              Admin Update
            </TabButton>
            <TabButton
              active={activeTab === 'reservation'}
              icon={Clock}
              onClick={() => setActiveTab('reservation')}
            >
              List Reservation
            </TabButton>
            <div className="relative min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.search}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, search: event.target.value }))
                }
                placeholder="Search asset, code, name..."
                className={inputClass('w-full pl-9')}
              />
            </div>
            <select
              value={filters.category}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, category: event.target.value }))
              }
              className={inputClass('w-40')}
            >
              <option value="">All category</option>
              {categories.map((category) => (
                <option key={category.category_id} value={category.category_code}>
                  {category.category_name}
                </option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              className={inputClass('w-40')}
            >
              <option value="">All status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <ActionButton onClick={refreshAll} tone="neutral" disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh
            </ActionButton>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Loaded Tools"
              value={formatNumber(metrics.total)}
              icon={PackageCheck}
              tone="bg-sky-50 text-sky-700"
            />
            <Metric
              label="Available"
              value={formatNumber(metrics.available)}
              icon={CheckCircle2}
              tone="bg-emerald-50 text-emerald-700"
            />
            <Metric
              label="Borrowed"
              value={formatNumber(metrics.borrowed)}
              icon={Clock}
              tone="bg-amber-50 text-amber-700"
            />
            <Metric
              label="Attention"
              value={formatNumber(metrics.attention)}
              icon={AlertCircle}
              tone="bg-red-50 text-red-700"
            />
          </div>

          <Message message={message} onClose={() => setMessage(null)} />

          {activeTab === 'admin' ? (
            <div
              className={`grid min-h-0 flex-1 gap-4 ${selectedTool ? 'xl:grid-cols-[minmax(0,1fr)_430px]' : 'xl:grid-cols-1'}`}
            >
              <section className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={17} className="text-[#0077b6]" />
                    <h2 className="text-sm font-black text-slate-900">Inventory</h2>
                  </div>
                  <span className="text-xs font-bold text-slate-500">{tools.length} rows</span>
                </div>

                <div className="h-full overflow-auto pb-14">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-black">Asset</th>
                        <th className="px-3 py-3 font-black">Tool</th>
                        <th className="px-3 py-3 font-black">Category</th>
                        <th className="px-3 py-3 font-black">Spec</th>
                        <th className="px-3 py-3 font-black">Qty</th>
                        <th className="px-3 py-3 font-black">Condition</th>
                        <th className="px-4 py-3 font-black">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-16 text-center text-sm font-bold text-slate-400"
                          >
                            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-[#0096c7]" />
                            Loading tools...
                          </td>
                        </tr>
                      ) : tools.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-16 text-center text-sm font-bold text-slate-400"
                          >
                            No tools found
                          </td>
                        </tr>
                      ) : (
                        tools.map((tool) => {
                          const active = selectedTool?.tool_id === tool.tool_id;
                          return (
                            <tr
                              key={tool.tool_id}
                              onClick={() => selectTool(tool)}
                              className={`cursor-pointer transition hover:bg-cyan-50/60 ${active ? 'bg-cyan-50' : 'bg-white'}`}
                            >
                              <td className="px-4 py-3">
                                <p className="font-mono text-xs font-black text-slate-800">
                                  {tool.asset_tag}
                                </p>
                                <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                                  {tool.tool_code || 'no source code'}
                                </p>
                              </td>
                              <td className="px-3 py-3">
                                <p className="font-bold text-slate-900">{tool.tool_name}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                  {tool.tool_type || tool.classification || '-'}
                                </p>
                              </td>
                              <td className="px-3 py-3 text-xs font-extrabold text-slate-600">
                                {tool.category_name}
                              </td>
                              <td className="px-3 py-3 text-xs font-semibold text-slate-500">
                                {tool.measurement_range || tool.size_label || tool.unit || '-'}
                              </td>
                              <td className="px-3 py-3">
                                <p className="text-xs font-black text-slate-800">
                                  {formatNumber(tool.quantity_available)} /{' '}
                                  {formatNumber(tool.quantity_total)}
                                </p>
                                <p className="text-[11px] text-slate-400">{tool.unit}</p>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${conditionClass(tool.condition_code)}`}
                                >
                                  {tool.condition_name || '-'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${statusClass(tool.availability_status)}`}
                                >
                                  {tool.availability_status}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedTool && (
                <aside className="min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="divide-y divide-slate-200">
                    <section className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs font-black text-[#0077b6]">
                            {selectedTool.asset_tag}
                          </p>
                          <h2 className="mt-1 text-base font-black text-slate-950">
                            {selectedTool.tool_name}
                          </h2>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {selectedTool.category_name} |{' '}
                            {selectedTool.tool_code || 'no source code'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedTool(null)}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                          title="Close edit panel"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <span
                        className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${statusClass(selectedTool.availability_status)}`}
                      >
                        {selectedTool.availability_status}
                      </span>
                    </section>

                    <form onSubmit={saveTool} className="space-y-3 p-4">
                      <h3 className="flex items-center gap-2 text-sm font-black text-slate-900">
                        <ShieldCheck size={16} className="text-[#0077b6]" />
                        Admin Update
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-black uppercase text-slate-500">
                            Qty Total
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={toolForm.quantity_total}
                            onChange={(event) =>
                              setToolForm((prev) => ({
                                ...prev,
                                quantity_total: event.target.value,
                              }))
                            }
                            className={inputClass('w-full')}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-black uppercase text-slate-500">
                            Qty Available
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={toolForm.quantity_available}
                            onChange={(event) =>
                              setToolForm((prev) => ({
                                ...prev,
                                quantity_available: event.target.value,
                              }))
                            }
                            className={inputClass('w-full')}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-black uppercase text-slate-500">
                            Condition
                          </span>
                          <select
                            value={toolForm.condition_id}
                            onChange={(event) =>
                              setToolForm((prev) => ({ ...prev, condition_id: event.target.value }))
                            }
                            className={inputClass('w-full')}
                          >
                            <option value="">Keep</option>
                            {conditions.map((condition) => (
                              <option key={condition.condition_id} value={condition.condition_id}>
                                {condition.condition_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-black uppercase text-slate-500">
                            Status
                          </span>
                          <select
                            value={toolForm.availability_status}
                            onChange={(event) =>
                              setToolForm((prev) => ({
                                ...prev,
                                availability_status: event.target.value,
                              }))
                            }
                            className={inputClass('w-full')}
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-black uppercase text-slate-500">
                          Notes
                        </span>
                        <textarea
                          rows={2}
                          value={toolForm.notes}
                          onChange={(event) =>
                            setToolForm((prev) => ({ ...prev, notes: event.target.value }))
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#00b4d8] focus:ring-2 focus:ring-cyan-100"
                        />
                      </label>
                      <ActionButton type="submit" disabled={saving === 'tool'}>
                        {saving === 'tool' ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={15} />
                        )}
                        Save Tool
                      </ActionButton>
                    </form>
                  </div>
                </aside>
              )}
            </div>
          ) : (
            <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Clock size={17} className="text-[#0077b6]" />
                  <h2 className="text-sm font-black text-slate-900">List Reservation</h2>
                </div>
                <span className="text-xs font-bold text-slate-500">{reservations.length} rows</span>
              </div>
              <div className="h-full overflow-auto pb-14">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-black">Reservation</th>
                      <th className="px-3 py-3 font-black">Tool</th>
                      <th className="px-3 py-3 font-black">Requester</th>
                      <th className="px-3 py-3 font-black">Qty</th>
                      <th className="px-3 py-3 font-black">Schedule</th>
                      <th className="px-3 py-3 font-black">Status</th>
                      <th className="px-4 py-3 text-right font-black">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-16 text-center text-sm font-bold text-slate-400"
                        >
                          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-[#0096c7]" />
                          Loading reservations...
                        </td>
                      </tr>
                    ) : reservations.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-16 text-center text-sm font-bold text-slate-400"
                        >
                          No reservation data
                        </td>
                      </tr>
                    ) : (
                      reservations.map((reservation) => (
                        <tr key={reservation.reservation_id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-black text-slate-800">
                              {reservation.reservation_no}
                            </p>
                            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                              {formatDateTime(reservation.requested_at)}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-bold text-slate-900">{reservation.tool_name}</p>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                              {reservation.asset_tag || reservation.tool_code || '-'}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-xs font-black text-slate-700">
                              {reservation.requester_field_name ||
                                reservation.requester_snapshot_name ||
                                reservation.requester_field_snssb ||
                                '-'}
                            </p>
                            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                              {reservation.requester_field_snssb ||
                                reservation.requester_snapshot_workcenter ||
                                '-'}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-xs font-black text-slate-700">
                            {formatNumber(reservation.quantity)}
                          </td>
                          <td className="px-3 py-3 text-xs font-semibold text-slate-500">
                            {formatDateTime(reservation.reserved_from)} -{' '}
                            {formatDateTime(reservation.reserved_until)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${statusClass(reservation.status === 'approved' ? 'available' : 'reserved')}`}
                            >
                              {reservation.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {reservation.status === 'pending' ? (
                              <div className="flex justify-end gap-2">
                                <ActionButton
                                  onClick={() => updateReservation(reservation, 'approve')}
                                  tone="success"
                                  disabled={saving === `approve-${reservation.reservation_id}`}
                                >
                                  {saving === `approve-${reservation.reservation_id}` ? (
                                    <Loader2 size={15} className="animate-spin" />
                                  ) : null}
                                  Approve
                                </ActionButton>
                                <ActionButton
                                  onClick={() => updateReservation(reservation, 'reject')}
                                  tone="danger"
                                  disabled={saving === `reject-${reservation.reservation_id}`}
                                >
                                  {saving === `reject-${reservation.reservation_id}` ? (
                                    <Loader2 size={15} className="animate-spin" />
                                  ) : null}
                                  Reject
                                </ActionButton>
                              </div>
                            ) : (
                              <p className="text-right text-xs font-bold text-slate-400">
                                No action
                              </p>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
