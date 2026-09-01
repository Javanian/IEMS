import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageContainer } from '../../components';
import { goBackOrFallback } from '../../utils/navigation';
import {
  createShiftRule,
  deleteShiftRule,
  fetchShiftRules,
  fetchShifts,
  updateShiftRule,
} from '../../services/sowScheduleService';

const SHIFT_CODE_OPTIONS = ['SHIFT-1', 'SHIFT-2', 'SHIFT-3'];

function todayText() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function emptyForm(date = todayText()) {
  return {
    id: null,
    shift_code: '',
    shift_name: '',
    effective_date: date,
    is_default: false,
    start_time: '07:00',
    end_time: '16:00',
    crosses_midnight: false,
    default_capacity_hours: 8,
    is_active: true,
  };
}

function normalizeTime(value) {
  return String(value || '').slice(0, 5);
}

function ShiftRuleCard({ rule, selected, onEdit, onCopyOverride, onDelete }) {
  return (
    <div
      className={`rounded-lg border p-3 shadow-sm transition ${selected ? 'border-[#0096c7] bg-cyan-50' : rule.is_default ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onEdit(rule)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-sm font-extrabold text-slate-900">
              {rule.shift_code}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${rule.is_default ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
            >
              {rule.is_default ? 'DEFAULT' : rule.effective_date}
            </span>
            {!rule.is_active && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold text-slate-500">
                INACTIVE
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-slate-600">{rule.shift_name}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
            <span>
              {normalizeTime(rule.start_time)} - {normalizeTime(rule.end_time)}
            </span>
            <span>
              {Number(rule.default_capacity_hours || 0).toLocaleString('id-ID', {
                maximumFractionDigits: 2,
              })}
              h capacity
            </span>
            {rule.crosses_midnight && <span>crosses midnight</span>}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {rule.is_default && (
            <button
              type="button"
              onClick={() => onCopyOverride(rule)}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-[#0077b6] shadow-sm hover:bg-cyan-100"
              title="Create date override"
            >
              <Copy size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(rule)}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-red-600 shadow-sm hover:bg-red-50"
            title="Deactivate"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShiftDefinitionPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayText());
  const [rules, setRules] = useState([]);
  const [effectiveShifts, setEffectiveShifts] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedId = form.id;
  const defaultRules = useMemo(() => rules.filter((r) => r.is_default), [rules]);
  const overrideRules = useMemo(() => rules.filter((r) => !r.is_default), [rules]);
  const filteredRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = [...defaultRules, ...overrideRules];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.shift_code, row.shift_name, row.effective_date].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(needle)
      )
    );
  }, [defaultRules, overrideRules, search]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ruleRows, effectiveRows] = await Promise.all([
        fetchShiftRules({ includeInactive: true, date }),
        fetchShifts({ date }),
      ]);
      setRules(ruleRows);
      setEffectiveShifts(effectiveRows);
    } catch (err) {
      toast.error('Gagal load shift definition', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [date]);

  const editRule = (rule) => {
    setForm({
      id: rule.id,
      shift_code: rule.shift_code || '',
      shift_name: rule.shift_name || '',
      effective_date: rule.effective_date || date,
      is_default: Boolean(rule.is_default),
      start_time: normalizeTime(rule.start_time),
      end_time: normalizeTime(rule.end_time),
      crosses_midnight: Boolean(rule.crosses_midnight),
      default_capacity_hours: Number(rule.default_capacity_hours || 0),
      is_active: rule.is_active !== false,
    });
  };

  const copyOverride = (rule) => {
    setForm({
      id: null,
      shift_code: rule.shift_code || '',
      shift_name: rule.shift_name || '',
      effective_date: date,
      is_default: false,
      start_time: normalizeTime(rule.start_time),
      end_time: normalizeTime(rule.end_time),
      crosses_midnight: Boolean(rule.crosses_midnight),
      default_capacity_hours: Number(rule.default_capacity_hours || 0),
      is_active: true,
    });
  };

  const saveRule = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        effective_date: form.is_default ? null : form.effective_date,
        default_capacity_hours: Number(form.default_capacity_hours),
      };
      if (form.id) {
        await updateShiftRule(form.id, payload);
        toast.success('Shift rule updated');
      } else {
        await createShiftRule(payload);
        toast.success('Shift rule created');
      }
      setForm(emptyForm(date));
      await loadData();
    } catch (err) {
      toast.error('Gagal simpan shift rule', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const deactivateRule = async (rule) => {
    if (
      !window.confirm(
        `Deactivate ${rule.shift_code}${rule.effective_date ? ` (${rule.effective_date})` : ''}?`
      )
    )
      return;
    setSaving(true);
    try {
      await deleteShiftRule(rule.id);
      toast.success('Shift rule deactivated');
      await loadData();
    } catch (err) {
      toast.error('Gagal deactivate shift rule', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer className="min-h-screen gap-4 bg-slate-50">
      <header className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => goBackOrFallback(navigate, '/operations-hub')}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div>
              <p className="text-xs font-bold uppercase text-[#0077b6]">Scheduling Master</p>
              <h1 className="text-xl font-extrabold text-slate-900">Shift Capacity Rules</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="w-44">
              <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                Preview Date
              </span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
              />
            </label>
            <button
              type="button"
              onClick={loadData}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Effective Shift on {date}</h2>
                <p className="text-xs font-semibold text-slate-500">
                  This is what SOW Scheduling uses for capacity.
                </p>
              </div>
              {loading && <Loader2 className="h-5 w-5 animate-spin text-[#0096c7]" />}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {effectiveShifts.map((shift) => (
                <div
                  key={shift.id}
                  className={`rounded-lg border p-3 ${shift.is_default ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-sm font-extrabold text-slate-900">
                      {shift.shift_code}
                    </p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
                      {shift.is_default ? 'DEFAULT' : 'OVERRIDE'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-600">{shift.shift_name}</p>
                  <p className="mt-2 text-lg font-extrabold text-slate-900">
                    {Number(shift.default_capacity_hours || 0).toLocaleString('id-ID', {
                      maximumFractionDigits: 2,
                    })}
                    h
                  </p>
                  <p className="text-[11px] font-bold text-slate-500">
                    {normalizeTime(shift.start_time)} - {normalizeTime(shift.end_time)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Rules</h2>
                <p className="text-xs font-semibold text-slate-500">
                  Default rows apply every day. Date rows override that date only.
                </p>
              </div>
              <div className="flex h-10 min-w-[240px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
                <Search size={16} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  placeholder="Search shift..."
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filteredRules.map((rule) => (
                <ShiftRuleCard
                  key={rule.id}
                  rule={rule}
                  selected={Number(selectedId) === Number(rule.id)}
                  onEdit={editRule}
                  onCopyOverride={copyOverride}
                  onDelete={deactivateRule}
                />
              ))}
              {filteredRules.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-500">
                  No shift rules.
                </div>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={saveRule} className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  {form.id ? 'Edit Rule' : 'Create Rule'}
                </h2>
                <p className="text-xs font-semibold text-slate-500">
                  Use override for one-day capacity changes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm(emptyForm(date))}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
              >
                <Plus size={15} />
                New
              </button>
            </div>
          </div>

          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    id: prev.is_default ? prev.id : null,
                    is_default: true,
                    effective_date: '',
                  }))
                }
                className={`rounded-lg border px-3 py-2 text-xs font-extrabold ${form.is_default ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Default Rule
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    id: prev.is_default ? null : prev.id,
                    is_default: false,
                    effective_date: prev.effective_date || date,
                  }))
                }
                className={`rounded-lg border px-3 py-2 text-xs font-extrabold ${!form.is_default ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Date Override
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                  Shift Code
                </span>
                <select
                  value={form.shift_code}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, shift_code: event.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
                  required
                >
                  <option value="">Select shift</option>
                  {SHIFT_CODE_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                  Capacity Hours
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.default_capacity_hours}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, default_capacity_hours: event.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
                  required
                />
              </label>
            </div>

            <label>
              <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                Shift Name
              </span>
              <input
                value={form.shift_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, shift_name: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
                required
              />
            </label>

            {!form.is_default && (
              <label>
                <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                  Override Date
                </span>
                <input
                  type="date"
                  value={form.effective_date || date}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, effective_date: event.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
                  required
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                  Start
                </span>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, start_time: event.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
                  required
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                  End
                </span>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, end_time: event.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
                  required
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.crosses_midnight}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, crosses_midnight: event.target.checked }))
                  }
                />
                Crosses midnight
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                  }
                />
                Active
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Shift Rule
            </button>

            <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#0077b6]" />
                <p className="text-xs font-semibold leading-relaxed text-slate-600">
                  Untuk tanggal tertentu, klik icon copy pada default shift. Ubah capacity atau jam,
                  lalu save sebagai Date Override.
                </p>
              </div>
            </div>
          </div>
        </form>
      </section>
    </PageContainer>
  );
}
