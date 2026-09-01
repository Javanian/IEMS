import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Ban, Loader2, Layers } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import ConfirmationModal from '../../components/ui/ConfirmationModal';
import { API_BASE, authHeaders, fmtHours, fmtWeightPct, fmtTs } from './helpers';
import { ModalShell, ProgressBar, StatusPill } from './primitives';
import { ProgressUpdatePanel } from './ProgressUpdatePanel';

export const SubTaskProgressModal = ({ sub, operationNo, onClose, onSaved }) => {
  const infoRows = [
    { label: 'Order No', value: sub.order_no },
    { label: 'Op No', value: operationNo },
    { label: 'Sub-task', value: sub.title },
    { label: 'Hours', value: `${fmtHours(sub.standard_hours)} hrs` },
    { label: 'Weight', value: fmtWeightPct(sub.weight) },
    { label: 'Status', value: <StatusPill status={sub.status} /> },
  ];
  return (
    <ModalShell title="Sub-task Progress" subtitle={sub.title} onClose={onClose} size="lg">
      <ProgressUpdatePanel
        historyUrl={`${API_BASE}/sow/subtasks/${sub.id}/progress-history`}
        submitUrl={`${API_BASE}/sow/subtasks/${sub.id}/progress`}
        infoRows={infoRows}
        successMsg="Sub-task progress saved"
        onSaved={onSaved}
        buildPayload={(prog, issueVal, img) => ({
          progress: prog,
          issue_description: issueVal,
          image_data: img,
        })}
      />
    </ModalShell>
  );
};

export const SubTaskFormModal = ({ mode, idsow, sub, onClose, onSaved }) => {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(sub?.title ?? '');
  const [hours, setHours] = useState(
    sub?.standard_hours != null ? String(Number(sub.standard_hours)) : ''
  );
  const [sortOrder, setSortOrder] = useState(sub?.sort_order != null ? String(sub.sort_order) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const titleValid = title.trim().length > 0;
  const hoursValid = hours === '' || (Number.isFinite(Number(hours)) && Number(hours) >= 0);
  const sortValid = sortOrder === '' || Number.isInteger(Number(sortOrder));
  const canSave = titleValid && hoursValid && sortValid && !saving;

  const handleSave = async () => {
    if (!titleValid) {
      setError('Title is required');
      return;
    }
    if (!hoursValid) {
      setError('Hours cannot be negative');
      return;
    }
    if (!sortValid) {
      setError('Order must be a whole number');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const url = isEdit
        ? `${API_BASE}/sow/subtasks/${sub.id}`
        : `${API_BASE}/sow/operations/${idsow}/subtasks`;
      const method = isEdit ? 'PUT' : 'POST';
      const body = { title: title.trim() };
      if (hours !== '') body.standard_hours = Number(hours);
      if (sortOrder !== '') body.sort_order = parseInt(sortOrder, 10);

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j.error || 'Failed to save sub-task';
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(isEdit ? 'Sub-task updated' : 'Sub-task added');
      onSaved();
    } catch (err) {
      const msg = 'Failed: ' + err.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm bg-white text-slate-800 border border-slate-200 rounded-lg placeholder-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all motion-reduce:transition-none';

  return (
    <ModalShell title={isEdit ? 'Edit Sub-task' : 'Add Sub-task'} onClose={onClose} size="sm">
      <div className="overflow-y-auto p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError('');
            }}
            placeholder="e.g. Left bracket fabrication"
            autoFocus
            className={`${inputCls} ${!titleValid && error ? 'border-red-400 ring-2 ring-red-200' : ''}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Std Hours <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
                setError('');
              }}
              placeholder="1"
              className={`${inputCls} tabular-nums`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Order <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="number"
              step="1"
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value);
                setError('');
              }}
              placeholder="0"
              className={`${inputCls} tabular-nums`}
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <span className="text-xs text-red-700 font-medium">{error}</span>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700
                       hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-white bg-[#0077b6] hover:bg-[#023e8a]
                       transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                Saving...
              </span>
            ) : isEdit ? (
              'Save'
            ) : (
              'Add'
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export const SubTaskFromStandardModal = ({
  idsow,
  partNumber,
  operationText,
  existingTitles = [],
  onClose,
  onSaved,
}) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [err2, setErr2] = useState('');

  const norm = (t) =>
    String(t || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  const existingSet = useMemo(() => new Set(existingTitles.map(norm)), [existingTitles]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const p = new URLSearchParams();
        if (partNumber) p.set('part_number', partNumber);
        if (operationText) p.set('operation_text', operationText);
        const res = await fetch(`${API_BASE}/sow/subtask-standards?${p.toString()}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!alive) return;

        const data = Array.isArray(json.data)
          ? json.data.filter((r) => !existingSet.has(norm(r.title)))
          : [];
        setRows(data);
        setSelected(new Set());
      } catch {
        if (alive) setError('Failed to load standards.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [idsow, partNumber, operationText, existingSet]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selRows = rows.filter((r) => selected.has(r.id));
  const selHours = selRows.reduce((s, r) => s + (Number(r.standard_hours) || 0), 0);

  const handleAdd = async () => {
    if (saving || selRows.length === 0) return;
    setSaving(true);
    setErr2('');
    try {
      const items = selRows.map((r) => ({
        title: r.title,
        standard_hours: r.standard_hours != null ? Number(r.standard_hours) : 1,
        sort_order: r.sort_order != null ? Number(r.sort_order) : 0,
      }));
      const res = await fetch(`${API_BASE}/sow/operations/${idsow}/subtasks/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ items }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m = j.error || 'Failed to add sub-tasks from standard';
        setErr2(m);
        toast.error(m);
        return;
      }
      const added = j.created_count ?? selRows.length;
      const skipped = j.skipped_count ?? 0;
      toast.success(`Added from standard (${added})${skipped ? ` — ${skipped} skipped` : ''}`);
      onSaved?.();
    } catch (err) {
      const m = 'Failed: ' + err.message;
      setErr2(m);
      toast.error(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Add from Standard"
      subtitle={
        partNumber
          ? `${partNumber}${operationText ? ` · ${operationText}` : ''}`
          : 'Sub-task master per part'
      }
      onClose={onClose}
      size="md"
    >
      <div className="overflow-y-auto p-5 space-y-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
            <span className="text-xs text-red-700 font-medium">{error}</span>
            <button
              onClick={onClose}
              className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
            >
              Close
            </button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Layers} title="No standards" />
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {rows.length} matching standards — select to add
            </p>
            {rows.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  className="h-4 w-4 rounded border-slate-300 accent-[#0077b6]"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-800 truncate">
                    {r.title}
                  </span>
                  <span className="block text-[11px] text-slate-400 tabular-nums">
                    order {r.sort_order ?? 0}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-sky-50 border border-sky-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#0077b6]">
                  {Number(r.standard_hours) || 0} hrs
                </span>
              </label>
            ))}
          </div>
        )}

        {err2 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <span className="text-xs text-red-700 font-medium">{err2}</span>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-slate-200 px-5 py-3 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 tabular-nums">
          {selected.size > 0 ? (
            <>
              <span className="font-bold text-slate-700">{selected.size}</span> selected ·{' '}
              <span className="font-bold text-slate-700">{selHours}</span> hrs
            </>
          ) : (
            'Select standards to add'
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700
                       hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={saving || selected.size === 0}
            className="px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-white bg-[#0077b6] hover:bg-[#023e8a]
                       transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                Adding...
              </span>
            ) : (
              `Add (${selected.size})`
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export const SubTaskRow = ({ sub, onUpdate, onEdit, onDeactivate }) => (
  <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 truncate">{sub.title}</span>
        <StatusPill status={sub.status} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span className="tabular-nums">{fmtHours(sub.standard_hours)} hrs</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">Weight {fmtWeightPct(sub.weight)}</span>
        <span className="text-slate-300">·</span>
        <span>Updated {fmtTs(sub.updated_at)}</span>
        {sub.updated_by && (
          <>
            <span className="text-slate-300">·</span>
            <span className="italic">{sub.updated_by}</span>
          </>
        )}
      </div>
    </div>

    <div className="w-full md:w-40 flex-shrink-0">
      <ProgressBar value={sub.progress} />
    </div>

    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={onUpdate}
        className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-white bg-[#0077b6] hover:bg-[#023e8a]
                   transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      >
        Update
      </button>
      <button
        onClick={onEdit}
        aria-label="Edit sub-task"
        title="Edit sub-task"
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600
                   hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
      >
        <Pencil size={15} />
      </button>
      <button
        onClick={onDeactivate}
        aria-label="Deactivate sub-task"
        title="Deactivate sub-task"
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500
                  hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-all active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
      >
        <Ban size={15} />
      </button>
    </div>
  </div>
);

export const SubOperationPanel = ({
  idsow,
  operationNo,
  partNumber,
  operationText,
  state,
  onRefresh,
}) => {
  const { list = [], loading, error } = state || {};
  const [formModal, setFormModal] = useState(null);
  const [stdModal, setStdModal] = useState(false);
  const [progressSub, setProgressSub] = useState(null);
  const [deactivateSub, setDeactivateSub] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const handleDeactivate = async () => {
    if (!deactivateSub || deactivating) return;
    setDeactivating(true);
    try {
      const res = await fetch(`${API_BASE}/sow/subtasks/${deactivateSub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ is_active: false }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Failed to deactivate sub-task');
        return;
      }
      toast.success('Sub-task deactivated');
      setDeactivateSub(null);
      onRefresh();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setDeactivating(false);
    }
  };

  const addButton = (
    <button
      onClick={() => setFormModal({ mode: 'add' })}
      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-xs font-semibold text-white
                bg-[#0077b6] hover:bg-[#023e8a] transition-all active:scale-95
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
    >
      <Plus size={15} />
      Add Sub-task
    </button>
  );

  const stdButton = (
    <button
      onClick={() => setStdModal(true)}
      disabled={!partNumber || !operationText}
      title={
        partNumber && operationText
          ? 'Add sub-tasks from the standard master (per part & operation)'
          : 'Operation without part/operation_text — standards cannot match'
      }
      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-xs font-semibold
                bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300
                transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
    >
      <Layers size={15} />
      From Standard
    </button>
  );

  return (
    <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            Sub-tasks
          </span>
          {list.length > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded bg-[#0077b6] text-white text-[11px] font-bold tabular-nums">
              {list.length}
            </span>
          )}
        </div>
        {!loading && !error && (
          <div className="flex items-center gap-2">
            {stdButton}
            {list.length > 0 && addButton}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
          <span className="text-xs text-red-700 font-medium">{error}</span>
          <button
            onClick={onRefresh}
            className="text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2"
          >
            Coba lagi
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Layers} title="No sub-tasks yet" action={addButton} />
      ) : (
        <div className="space-y-2">
          {list.map((sub) => (
            <SubTaskRow
              key={sub.id}
              sub={sub}
              onUpdate={() => setProgressSub(sub)}
              onEdit={() => setFormModal({ mode: 'edit', sub })}
              onDeactivate={() => setDeactivateSub(sub)}
            />
          ))}
        </div>
      )}

      {formModal && (
        <SubTaskFormModal
          mode={formModal.mode}
          idsow={idsow}
          sub={formModal.sub}
          onClose={() => setFormModal(null)}
          onSaved={() => {
            setFormModal(null);
            onRefresh();
          }}
        />
      )}

      {stdModal && (
        <SubTaskFromStandardModal
          idsow={idsow}
          partNumber={partNumber}
          operationText={operationText}
          existingTitles={list.map((s) => s.title)}
          onClose={() => setStdModal(false)}
          onSaved={() => {
            setStdModal(false);
            onRefresh();
          }}
        />
      )}

      {progressSub && (
        <SubTaskProgressModal
          sub={progressSub}
          operationNo={operationNo}
          onClose={() => setProgressSub(null)}
          onSaved={onRefresh}
        />
      )}

      <ConfirmationModal
        isOpen={!!deactivateSub}
        title="Deactivate sub-task?"
        message={
          deactivateSub
            ? `"${deactivateSub.title}" will be hidden and operation progress recalculated from remaining sub-tasks.`
            : ''
        }
        confirmLabel={deactivating ? 'Processing...' : 'Deactivate'}
        cancelLabel="Cancel"
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateSub(null)}
      />
    </div>
  );
};
