import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  AlertCircle,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  GripVertical,
  LayoutGrid,
  Loader2,
  Plus,
  Save,
  Search,
  Send,
  User,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageContainer } from '../../../components';
import {
  approveOvertime,
  createBatch,
  createOvertime,
  createSchedule,
  deleteBatch,
  deleteSchedule,
  fetchBatches,
  fetchCapacity,
  fetchManpower,
  fetchOvertime,
  fetchSchedules,
  fetchSchedulingActivities,
  fetchSchedulingMachines,
  fetchShifts,
  rejectOvertime,
  rescheduleSchedule,
  assignManpower,
  deleteOvertime,
} from '../../../services/sowScheduleService';
import { goBackOrFallback } from '../../../utils/navigation';
import SchedulingTimeline from './SchedulingTimeline';

const ACTIVITY_PAGE_SIZE = 100;
const SCHEDULE_LIMIT = 500;
const MAX_ACT_LIMIT = 500;
const EMPTY_ARR = [];

function todayText() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}
function roleText(user) {
  return String(user?.roles || user?.role || '').toLowerCase();
}
function canApproveOvertime(user) {
  const r = roleText(user).split(/[,\s/;|]+/);
  return r.includes('supervisor') || r.includes('administrator');
}
function asNumber(v, f = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}
function formatHours(v) {
  return asNumber(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
function compactBatchCode(batch = {}) {
  const raw = String(batch.batch_code || '').trim();
  if (/^B-\d+/i.test(raw)) return raw;
  return batch.id ? `Batch #${batch.id}` : raw || 'Batch';
}
function batchOptionLabel(batch = {}) {
  const capacity = asNumber(batch.batch_capacity_hours);
  const ops = asNumber(batch.operation_count, 0);
  return `${compactBatchCode(batch)} - max ${formatHours(capacity)}h per op - ${ops} ops`;
}
function formatTime(v) {
  if (!v) return '-';
  const t = String(v);
  const m = t.match(/(\d{2}:\d{2})/);
  return m ? m[1] : t.slice(0, 5);
}
function activityIdentity(item = {}) {
  return {
    sow_id: item.idsow || item.sow_id || null,
    production_order: item.order_no || item.production_order || '',
    operation_no: item.operation_no || '',
    ssbr_id: item.ssbr_id || '',
    workcenter: item.workcenter || '',
  };
}
function capacityKey(mc, sid) {
  return `${mc || ''}::${sid || ''}`;
}
function groupByMachineShift(rows = []) {
  return rows.reduce((a, r) => {
    const k = capacityKey(r.machine_code, r.shift_id);
    if (!a[k]) a[k] = [];
    a[k].push(r);
    return a;
  }, {});
}
function groupOvertimeByMachine(rows = []) {
  return rows.reduce((a, r) => {
    const k = r.machine_code || '';
    if (!a[k]) a[k] = [];
    a[k].push(r);
    return a;
  }, {});
}
function buildDropId(t, mc, sid = '') {
  return [t, mc, sid].join('|');
}
function parseDropId(id) {
  const [t, mc, sid] = String(id || '').split('|');
  return { type: t, machineCode: mc, shiftId: sid };
}
function clockToMinutes(v) {
  const [h, m] = String(v || '00:00')
    .split(':')
    .map((p) => Number(p) || 0);
  return h * 60 + m;
}
function minutesToClock(m) {
  const n = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function addHoursToClock(v, h) {
  return minutesToClock(clockToMinutes(v) + asNumber(h) * 60);
}

function DragHandle({ listeners, attributes, disabled = false, title = 'Drag item' }) {
  return (
    <button
      type="button"
      {...(!disabled ? listeners : {})}
      {...(!disabled ? attributes : {})}
      disabled={disabled}
      style={{ touchAction: 'none' }}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
          : 'cursor-grab border-slate-200 bg-white text-slate-500 hover:border-[#0096c7] hover:text-[#0077b6] active:cursor-grabbing active:bg-slate-50'
      }`}
      title={title}
      aria-label={title}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

function SowActivityCard({ item, dragging = false, source = 'activity' }) {
  const identity = activityIdentity(item);
  const plan = asNumber(item.planhours ?? item.original_planhours ?? item.planned_hours, 0);
  const scheduled = asNumber(item.scheduled_hours, 0);
  const remaining = asNumber(item.remaining_hours ?? plan - scheduled, plan);
  const pct = plan > 0 ? Math.min(100, Math.max(0, (scheduled / plan) * 100)) : 0;
  const done = plan > 0 && remaining <= 0.001;
  const isUnplanned = source === 'unplanned' || item.schedule_status === 'UNPLANNED';
  const footnote = [identity.ssbr_id, identity.workcenter || item.machine_code]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={`rounded-xl border p-2.5 transition ${dragging ? 'w-72 border-[#0096c7] bg-white shadow-xl shadow-[#0096c7]/20' : isUnplanned ? 'border-rose-200 bg-rose-50' : done ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white hover:border-[#90e0ef] hover:bg-[#f2fbfe]'}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-xs font-extrabold text-[#0077b6]"
          title={`Operasi ${identity.operation_no || '-'}`}
        >
          {identity.operation_no || '-'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-extrabold text-slate-800">
            {identity.production_order || '-'}
          </p>
          <p className="truncate text-[11px] font-semibold text-slate-500">
            {item.operation_text || item.part_name || '-'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-sm font-extrabold leading-none ${done ? 'text-slate-400' : 'text-emerald-600'}`}
          >
            {formatHours(remaining)}h
          </p>
          <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
            {done ? 'selesai' : 'sisa'}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${done ? 'bg-emerald-400' : 'bg-[#0096c7]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-[9px] font-bold text-slate-400">
          {formatHours(scheduled)}/{formatHours(plan)}h
        </span>
      </div>
      {footnote && (
        <p className="mt-1.5 truncate text-[9px] font-semibold text-slate-400">{footnote}</p>
      )}
    </div>
  );
}

function DropScheduleCard({ schedule, onDelete }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `planned-${schedule.id}`,
    data: { item: schedule, source: 'planned' },
  });
  return (
    <div
      ref={setNodeRef}
      className={`group rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition hover:border-[#90e0ef] hover:shadow ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <DragHandle listeners={listeners} attributes={attributes} title="Drag schedule" />
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-slate-700">
          {schedule.operation_no || '-'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
          {schedule.production_order || schedule.ssbr_id || '-'}
        </span>
        <span className="shrink-0 text-[11px] font-extrabold text-[#0096c7]">
          {formatHours(schedule.planned_hours)}h
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(schedule.id);
          }}
          className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-red-100"
        >
          <X className="h-3 w-3 text-red-500" />
        </button>
      </div>
      <p className="mt-0.5 truncate pl-7 text-[10px] text-slate-400">
        {schedule.operation_text || schedule.part_name || ''}
      </p>
    </div>
  );
}

function BatchBox({ batch, schedules, onDelete, onDeleteBatch }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50 p-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-[11px] font-extrabold text-violet-800">
            {compactBatchCode(batch)}
          </p>
          <p className="text-[10px] font-bold text-violet-600">
            max {formatHours(batch.batch_capacity_hours)}h/op · {schedules.length} ops
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-violet-700">
            {expanded ? 'Hide' : `${schedules.length} ops`}
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBatch(batch.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-red-100 text-red-700 hover:bg-red-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {schedules.map((s) => (
            <DropScheduleCard key={s.id} schedule={s} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableActivity({ item, source = 'activity' }) {
  const id = source === 'unplanned' ? `unplanned-${item.id}` : `activity-${item.idsow}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { item, source },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-stretch gap-1.5 ${isDragging ? 'opacity-50' : ''}`}
    >
      <DragHandle listeners={listeners} attributes={attributes} title="Drag activity" />
      <div className="min-w-0 flex-1">
        <SowActivityCard item={item} source={source} />
      </div>
    </div>
  );
}

function DraggableManpower({ person }) {
  const id = `manpower-${person.snssb}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { item: person, source: 'manpower' },
  });
  const initials = String(person.full_name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase();

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: 'none' }}
      className={`flex cursor-grab items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2 shadow-sm transition hover:border-[#0096c7] active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
        style={{ background: 'linear-gradient(135deg,#0096c7,#0077b6)' }}
      >
        {initials || <User className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-extrabold text-slate-800">{person.full_name || '-'}</p>
        <p className="truncate text-[10px] font-semibold text-slate-400">
          {person.snssb || '-'}
          {person.employee_category ? ` · ${person.employee_category}` : ''}
        </p>
      </div>
    </div>
  );
}

const DropZone = React.memo(function DropZone({
  id,
  title,
  capacity,
  schedules,
  onDeleteSchedule,
  onDeleteBatch,
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [expanded, setExpanded] = useState(true);
  const used = asNumber(capacity?.used_normal_planned_hours);
  const total = asNumber(capacity?.total_capacity_hours, 8);
  const remaining = asNumber(capacity?.remaining_capacity_hours, Math.max(total - used, 0));
  const pct = Math.min(100, Math.max(0, (used / Math.max(total, 1)) * 100));
  const batches = schedules.reduce((acc, s) => {
    if (!s.batch_id) return acc;
    const k = String(s.batch_id);
    if (!acc[k])
      acc[k] = {
        batch: {
          id: s.batch_id,
          batch_code: s.batch_code,
          batch_capacity_hours: s.batch_capacity_hours,
        },
        schedules: [],
      };
    acc[k].schedules.push(s);
    return acc;
  }, {});
  const batchedIds = new Set(Object.values(batches).flatMap((g) => g.schedules.map((r) => r.id)));
  const items = [
    ...Object.values(batches).map((g) => ({ type: 'batch', ...g })),
    ...schedules
      .filter((s) => !batchedIds.has(s.id))
      .map((s) => ({ type: 'schedule', schedule: s })),
  ];
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-[#0096c7]';
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border p-2.5 transition ${isOver ? 'border-[#0096c7] bg-[#caf0f8] ring-2 ring-[#00b4d8]' : 'border-slate-200 bg-white'}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-slate-700">{title}</span>
            <span className="text-[10px] font-bold text-slate-400">
              {formatHours(used)}/{formatHours(total)}h
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-extrabold text-slate-600">
            {formatHours(remaining)}h
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {expanded && (
        <div className="mt-2 min-h-12 space-y-1.5">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-[11px] font-medium text-slate-400">
              Drop SOW here
            </div>
          ) : (
            items.map((item) =>
              item.type === 'batch' ? (
                <BatchBox
                  key={`batch-${item.batch.id}`}
                  batch={item.batch}
                  schedules={item.schedules}
                  onDelete={onDeleteSchedule}
                  onDeleteBatch={onDeleteBatch}
                />
              ) : (
                <DropScheduleCard
                  key={item.schedule.id}
                  schedule={item.schedule}
                  onDelete={onDeleteSchedule}
                />
              )
            )
          )}
        </div>
      )}
    </div>
  );
});

const OvertimeRow = React.memo(function OvertimeRow({ row, onDelete }) {
  const id = `assign-ot-${row.id}`;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { overtimeId: row.id, machine_code: row.machine_code },
  });
  const status = String(row.request_status || '').toUpperCase();
  const statusColor =
    status === 'APPROVED'
      ? 'border-emerald-300 bg-emerald-50'
      : status === 'REJECTED'
        ? 'border-red-300 bg-red-50'
        : 'border-amber-200 bg-white';
  const textColor =
    status === 'APPROVED' ? 'text-emerald-700' : status === 'REJECTED' ? 'text-red-500' : '';
  return (
    <div
      ref={setNodeRef}
      className={`group rounded-lg border px-2.5 py-2 transition ${isOver ? 'border-violet-400 bg-violet-100 ring-2 ring-violet-200' : statusColor}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`min-w-0 truncate font-mono text-[11px] font-extrabold ${textColor || 'text-slate-800'}`}
        >
          {row.production_order || '-'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
          >
            {status}
          </span>
          <span className="text-[10px] font-bold text-amber-700">
            {formatHours(row.overtime_hours)}h
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.id);
            }}
            className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-red-100"
          >
            <X className="h-3 w-3 text-red-500" />
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">
        {formatTime(row.overtime_start_datetime)}–{formatTime(row.overtime_end_datetime)}
      </p>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-slate-500">
        {row.operation_no && <span>Op {row.operation_no}</span>}
        {row.ssbr_id && <span>{row.ssbr_id}</span>}
      </div>
      {row.assigned_to_name ? (
        <p className="text-[10px] font-semibold text-violet-600">👤 {row.assigned_to_name}</p>
      ) : (
        <p className="text-[10px] text-slate-400 italic">Drop person here</p>
      )}
    </div>
  );
});

function OvertimeDropZone({ id, rows, onDeleteOvertime }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border p-2.5 transition ${isOver ? 'border-amber-400 bg-amber-100 ring-2 ring-amber-200' : 'border-amber-200 bg-amber-50'}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold uppercase text-amber-700">Overtime</span>
          <span className="text-[11px] font-bold text-amber-600">{rows.length} req</span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-amber-500 transition ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 min-h-12 space-y-1.5">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-200 bg-white px-3 py-3 text-center text-[11px] font-medium text-amber-500">
              Drop SOW here
            </div>
          ) : (
            rows.map((row) => <OvertimeRow key={row.id} row={row} onDelete={onDeleteOvertime} />)
          )}
        </div>
      )}
    </div>
  );
}

const MachineCard = React.memo(function MachineCard({
  machine,
  shifts,
  capacityBySlot,
  schedulesBySlot,
  overtimeRows,
  onDeleteSchedule,
  onDeleteBatch,
  onDeleteOvertime,
}) {
  const totals = shifts.reduce(
    (a, s) => {
      const cap = capacityBySlot[capacityKey(machine.machine_code, s.id)];
      const t = asNumber(cap?.total_capacity_hours, 8);
      const u = asNumber(cap?.used_normal_planned_hours);
      a.capacity += t;
      a.used += u;
      a.remaining += asNumber(cap?.remaining_capacity_hours, Math.max(t - u, 0));
      return a;
    },
    { capacity: 0, used: 0, remaining: 0 }
  );
  return (
    <article className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 truncate text-base font-extrabold text-slate-900">
              {machine.machine_code}
            </h2>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700">
              {formatHours(totals.remaining)}/{formatHours(totals.capacity)}h
            </span>
          </div>
          <p className="truncate text-xs font-semibold text-slate-500">
            {machine.machine_name || machine.workcenter || '-'}
          </p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[#0096c7]"
            style={{
              width: `${Math.min(100, Math.max(0, (totals.used / Math.max(totals.capacity, 1)) * 100))}%`,
            }}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {shifts.map((s) => (
          <DropZone
            key={s.id}
            id={buildDropId('shift', machine.machine_code, s.id)}
            title={s.shift_name}
            capacity={capacityBySlot[capacityKey(machine.machine_code, s.id)]}
            schedules={schedulesBySlot[capacityKey(machine.machine_code, s.id)] || EMPTY_ARR}
            onDeleteSchedule={onDeleteSchedule}
            onDeleteBatch={onDeleteBatch}
          />
        ))}
        <OvertimeDropZone
          id={buildDropId('overtime', machine.machine_code)}
          rows={overtimeRows}
          onDeleteOvertime={onDeleteOvertime}
        />
      </div>
    </article>
  );
});

function ScheduleModal({
  pending,
  capacity,
  batches = [],
  saving,
  onClose,
  onSubmit,
  onCreateBatch,
}) {
  const item = pending?.item;
  const remainingHours = asNumber(item?.remaining_hours, asNumber(item?.planhours, 1));
  const remainingCapacity = asNumber(capacity?.remaining_capacity_hours, 8);
  const defaultHours = Math.max(
    0.01,
    Math.min(remainingHours || 1, remainingCapacity || remainingHours || 1)
  );
  const [hours, setHours] = useState(String(defaultHours));
  const [scheduleDate, setScheduleDate] = useState(pending?.scheduleDate || todayText());
  const [mode, setMode] = useState('single');
  const [batchId, setBatchId] = useState('');
  const [batchCapacityHours, setBatchCapacityHours] = useState(String(defaultHours));
  const [note, setNote] = useState('');
  const selectedBatch = batches.find((b) => String(b.id) === String(batchId));
  const selectedBatchCapacity = asNumber(selectedBatch?.batch_capacity_hours);

  useEffect(() => {
    if (mode === 'batch' && !batchId && batches.length > 0) {
      setBatchId(String(batches[0].id));
      return;
    }
    if (mode === 'batch' && selectedBatch) {
      const nextHours = Math.max(
        0.01,
        Math.min(remainingHours || 1, selectedBatchCapacity || remainingHours || 1)
      );
      setHours(String(nextHours));
      return;
    }
    if (mode === 'single') setHours(String(defaultHours));
  }, [mode, batchId, batches, selectedBatch, selectedBatchCapacity, remainingHours, defaultHours]);

  if (!pending || !item) return null;
  const plannedHours = asNumber(hours);
  const exceedsCapacity = mode === 'single' && plannedHours > remainingCapacity;
  const exceedsBatch = mode === 'batch' && selectedBatch && plannedHours > selectedBatchCapacity;
  const identity = activityIdentity(item);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            hours: plannedHours,
            note,
            scheduleDate,
            batchId: mode === 'batch' ? batchId : '',
          });
        }}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase text-[#0077b6]">Schedule Activity</p>
            <h2 className="mt-1 text-lg font-extrabold text-slate-900">
              {identity.production_order || '-'}
            </h2>
            <p className="text-sm font-semibold text-slate-500">
              {pending.machineCode} / {pending.shift?.shift_name || '-'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase text-slate-500">Cap Left</p>
              <p className="mt-1 text-lg font-extrabold text-slate-900">
                {formatHours(remainingCapacity)}h
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase text-slate-500">Plan Hrs</p>
              <p className="mt-1 text-lg font-extrabold text-slate-900">
                {formatHours(item.planhours)}h
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase text-slate-500">Left</p>
              <p className="mt-1 text-lg font-extrabold text-slate-900">
                {formatHours(remainingHours)}h
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              {['single', 'batch'].map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setMode(o)}
                  className={`rounded-md px-3 py-1.5 text-xs font-extrabold uppercase ${mode === o ? 'bg-[#0096c7] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {o}
                </button>
              ))}
            </div>
            {mode === 'batch' && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                    Use Existing Batch
                  </span>
                  <select
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                    className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
                  >
                    <option value="">Select batch pocket</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {batchOptionLabel(b)}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedBatch && (
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-extrabold">
                    <span className="rounded bg-violet-100 px-2 py-1 text-center text-violet-700">
                      Max {formatHours(selectedBatchCapacity)}h / op
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-1 text-center text-slate-600">
                      {asNumber(selectedBatch.operation_count, 0)} ops inside
                    </span>
                  </div>
                )}
                <div className="rounded-lg border border-violet-200 bg-white p-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <label className="min-w-0">
                      <span className="mb-1.5 block text-[11px] font-extrabold uppercase text-slate-500">
                        New Batch Pocket Hours
                      </span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={batchCapacityHours}
                        onChange={(e) => setBatchCapacityHours(e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={async () => {
                        const c = await onCreateBatch({
                          batch_capacity_hours: asNumber(batchCapacityHours),
                          schedule_date: scheduleDate,
                        });
                        if (c?.id) setBatchId(String(c.id));
                      }}
                      disabled={saving || asNumber(batchCapacityHours) <= 0}
                      className="self-end h-10 rounded-lg bg-violet-600 px-3 text-xs font-extrabold text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      Create Batch
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
              Planned Hours
            </span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
              Schedule Date
            </span>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
              required
            />
          </label>
          {exceedsCapacity && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Exceeds capacity. Extra hours become unplanned.</span>
            </div>
          )}
          {exceedsBatch && (
            <div className="flex gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm font-bold text-violet-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Exceeds max hours per operation in this batch. Extra hours become unplanned.
              </span>
            </div>
          )}
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-24 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800"
              placeholder="Optional note"
            />
          </label>
        </div>
        <div className="shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || plannedHours <= 0 || (mode === 'batch' && !batchId)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-bold text-white hover:bg-[#0077b6] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function OvertimeModal({ pending, shifts, saving, onClose, onSubmit }) {
  const item = pending?.item;
  const [shiftId, setShiftId] = useState(String(shifts[0]?.id || ''));
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('19:00');
  const [hours, setHours] = useState('2');
  const [note, setNote] = useState('');
  if (!pending || !item) return null;
  const identity = activityIdentity(item);
  const isManpower = pending.source === 'manpower';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            shiftId,
            startTime,
            endTime,
            hours: asNumber(hours),
            note,
            assigned_to: isManpower ? item.snssb : '',
            assigned_to_name: isManpower ? item.full_name : '',
          });
        }}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase text-amber-700">Overtime Request</p>
            <h2 className="mt-1 text-lg font-extrabold text-slate-900">
              {isManpower ? item.full_name : identity.production_order || '-'}
            </h2>
            <p className="text-sm font-semibold text-slate-500">
              {pending.machineCode}
              {isManpower && ` · ${item.snssb || '-'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
              Related Shift
            </span>
            <select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
              required
            >
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shift_name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label>
              <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
                Start
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setEndTime(addHoursToClock(e.target.value, hours));
                }}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
                End
              </span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setHours(
                    String(
                      (clockToMinutes(e.target.value) -
                        clockToMinutes(startTime) +
                        (clockToMinutes(e.target.value) <= clockToMinutes(startTime) ? 1440 : 0)) /
                        60
                    )
                  );
                }}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">
                Hours
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setEndTime(addHoursToClock(startTime, e.target.value));
                }}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold uppercase text-slate-500">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-24 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800"
              placeholder="Reason for overtime"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !shiftId}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Request
          </button>
        </div>
      </form>
    </div>
  );
}

function OvertimeApprovalPanel({ rows, canApprove, saving, onApprove, onReject, onClose }) {
  const [expandedPending, setExpandedPending] = useState(true);
  const [expandedApproved, setExpandedApproved] = useState(false);
  const [expandedRejected, setExpandedRejected] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectingId, setRejectingId] = useState(null);
  const pending = rows.filter((r) => r.request_status === 'PENDING');
  const approved = rows.filter((r) => r.request_status === 'APPROVED');
  const rejected = rows.filter((r) => r.request_status === 'REJECTED');

  const SectionHeader = ({ label, count, expanded, onToggle, color }) => (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-extrabold uppercase ${color}`}
    >
      <span>
        {label} ({count})
      </span>
      <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase text-[#0077b6]">Overtime Approval</p>
            <h2 className="mt-1 text-base font-extrabold text-slate-900">Review Requests</h2>
          </div>
          <div className="flex items-center gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin text-[#0096c7]" />}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <SectionHeader
              label="Pending"
              count={pending.length}
              expanded={expandedPending}
              onToggle={() => setExpandedPending((v) => !v)}
              color="text-amber-700"
            />
            {expandedPending && (
              <div className="mt-2 space-y-2">
                {pending.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-400">
                    No pending overtime.
                  </p>
                ) : (
                  pending.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs font-extrabold text-slate-900">
                            {row.production_order || '-'}
                          </p>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
                            {row.operation_no && <span>Op {row.operation_no}</span>}
                            {row.ssbr_id && <span>{row.ssbr_id}</span>}
                          </div>
                          <p className="text-xs font-semibold text-slate-600">
                            {row.machine_code || '-'} / {formatTime(row.overtime_start_datetime)}-
                            {formatTime(row.overtime_end_datetime)} ·{' '}
                            {formatHours(row.overtime_hours)}h
                          </p>
                          <p className="text-[10px] text-slate-400">
                            By: {row.requested_by_name || '-'}{' '}
                            {row.assigned_to_name ? `· To: ${row.assigned_to_name}` : ''}
                          </p>
                          {row.note && (
                            <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">
                              {row.note}
                            </p>
                          )}
                        </div>
                        <StatusBadge value={row.request_status} />
                      </div>
                      {canApprove && (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => onApprove(row.id)}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve
                          </button>
                          {rejectingId === row.id ? (
                            <div className="flex flex-1 gap-1">
                              <input
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                                placeholder="Reason..."
                                className="flex-1 rounded-lg border border-slate-200 px-2 text-xs"
                              />
                              <button
                                onClick={() => {
                                  onReject(row.id, rejectNote);
                                  setRejectingId(null);
                                  setRejectNote('');
                                }}
                                className="rounded-lg bg-red-600 px-3 text-xs font-bold text-white"
                              >
                                OK
                              </button>
                              <button
                                onClick={() => setRejectingId(null)}
                                className="rounded-lg border px-2 text-xs"
                              >
                                X
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRejectingId(row.id)}
                              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 text-xs font-bold text-white hover:bg-red-500"
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div>
            <SectionHeader
              label="Approved"
              count={approved.length}
              expanded={expandedApproved}
              onToggle={() => setExpandedApproved((v) => !v)}
              color="text-emerald-700"
            />
            {expandedApproved && (
              <div className="mt-2 space-y-1.5">
                {approved.slice(0, 12).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-extrabold text-slate-900">
                        {row.production_order || '-'}
                      </p>
                      <div className="flex flex-wrap gap-x-2 text-[9px] text-slate-500">
                        {row.operation_no && <span>Op {row.operation_no}</span>}
                        {row.ssbr_id && <span>{row.ssbr_id}</span>}
                      </div>
                      <p className="text-[10px] text-emerald-700">
                        {row.machine_code || '-'} · {formatHours(row.overtime_hours)}h
                        {row.assigned_to_name ? ` · ${row.assigned_to_name}` : ''}
                      </p>
                    </div>
                    <StatusBadge value="APPROVED" />
                  </div>
                ))}
                {approved.length === 0 && (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-400">
                    No approved overtime.
                  </p>
                )}
              </div>
            )}
          </div>
          <div>
            <SectionHeader
              label="Rejected"
              count={rejected.length}
              expanded={expandedRejected}
              onToggle={() => setExpandedRejected((v) => !v)}
              color="text-red-700"
            />
            {expandedRejected && (
              <div className="mt-2 space-y-1.5">
                {rejected.slice(0, 8).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-extrabold text-slate-900">
                        {row.production_order || '-'}
                      </p>
                      <div className="flex flex-wrap gap-x-2 text-[9px] text-slate-500">
                        {row.operation_no && <span>Op {row.operation_no}</span>}
                        {row.ssbr_id && <span>{row.ssbr_id}</span>}
                      </div>
                      <p className="text-[10px] text-red-600">
                        {row.machine_code || '-'} · {formatHours(row.overtime_hours)}h
                        {row.rejection_note ? ` · ${row.rejection_note}` : ''}
                      </p>
                    </div>
                    <StatusBadge value="REJECTED" />
                  </div>
                ))}
                {rejected.length === 0 && (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-400">
                    No rejected overtime.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ value }) {
  const v = String(value || '').toUpperCase();
  const cls =
    v === 'APPROVED' || v === 'PLANNED'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : v === 'PENDING' || v === 'PARTIAL'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : v === 'UNPLANNED' || v === 'REJECTED'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-slate-200 bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}
    >
      {value || '-'}
    </span>
  );
}

function SummaryBar({ schedules, capacityRows, overtimeRows }) {
  const planned = schedules
    .filter((r) => r.schedule_status !== 'UNPLANNED' && r.schedule_status !== 'CANCELLED')
    .reduce((s, r) => s + asNumber(r.planned_hours), 0);
  const unplanned = schedules
    .filter((r) => r.schedule_status === 'UNPLANNED')
    .reduce((s, r) => s + asNumber(r.planned_hours), 0);
  const capLeft = capacityRows.reduce((s, r) => s + asNumber(r.remaining_capacity_hours), 0);
  const pendOT = overtimeRows
    .filter((r) => r.request_status === 'PENDING')
    .reduce((s, r) => s + asNumber(r.overtime_hours), 0);

  const items = [
    { l: 'Planned', v: planned, c: 'text-[#0077b6]' },
    { l: 'Unplanned', v: unplanned, c: unplanned > 0 ? 'text-rose-600' : 'text-slate-700' },
    { l: 'Cap Left', v: capLeft, c: 'text-emerald-600' },
    { l: 'OT', v: pendOT, c: pendOT > 0 ? 'text-amber-600' : 'text-slate-700' },
  ];
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      {items.map((s, i) => (
        <div
          key={s.l}
          className={`px-3 py-1 text-center ${i > 0 ? 'border-l border-slate-200' : ''}`}
        >
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
          <p className={`text-sm font-extrabold leading-tight ${s.c}`}>{formatHours(s.v)}h</p>
        </div>
      ))}
    </div>
  );
}

function SowSchedulingPage() {
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );
  const [authUser] = useState(readAuthUser);
  const [viewMode, setViewMode] = useState('board');
  const [date, setDate] = useState(todayText);
  const [search, setSearch] = useState('');
  const [machineSearch, setMachineSearch] = useState('');
  const [shifts, setShifts] = useState([]);
  const [machines, setMachines] = useState([]);
  const [activities, setActivities] = useState([]);
  const [activityPagination, setActivityPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [schedules, setSchedules] = useState([]);
  const [batches, setBatches] = useState([]);
  const [capacityRows, setCapacityRows] = useState([]);
  const [overtimeRows, setOvertimeRows] = useState([]);
  const [manpower, setManpower] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [saving, setSaving] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [boardError, setBoardError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [scheduleModal, setScheduleModal] = useState(null);
  const [overtimeModal, setOvertimeModal] = useState(null);
  const [showOvertimeApproval, setShowOvertimeApproval] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('activity');
  const [sowFilter, setSowFilter] = useState('all');
  const [manpowerSearch, setManpowerSearch] = useState('');
  const [expandedOrders, setExpandedOrders] = useState(new Set());

  const visibleShifts = useMemo(() => shifts, [shifts]);
  const capacityBySlot = useMemo(
    () =>
      capacityRows.reduce((a, r) => {
        a[capacityKey(r.machine_code, r.shift_id)] = r;
        return a;
      }, {}),
    [capacityRows]
  );
  const plannedSchedules = useMemo(
    () =>
      schedules.filter(
        (r) => r.schedule_status !== 'UNPLANNED' && r.schedule_status !== 'CANCELLED'
      ),
    [schedules]
  );
  const schedulesBySlot = useMemo(() => groupByMachineShift(plannedSchedules), [plannedSchedules]);
  const overtimeByMachine = useMemo(() => groupOvertimeByMachine(overtimeRows), [overtimeRows]);
  const supervisorCanApprove = canApproveOvertime(authUser);
  const pendingOvertimeCount = useMemo(
    () => overtimeRows.filter((r) => r.request_status === 'PENDING').length,
    [overtimeRows]
  );
  const filteredMachines = useMemo(() => {
    const n = machineSearch.trim().toLowerCase();
    if (!n) return machines;
    return machines.filter((m) =>
      [m.machine_code, m.machine_name, m.workcenter, m.groupname].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(n)
      )
    );
  }, [machineSearch, machines]);
  const filteredManpower = useMemo(() => {
    const n = manpowerSearch.trim().toLowerCase();
    if (!n) return manpower;
    return manpower.filter((p) =>
      [p.full_name, p.snssb, p.employee_category].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(n)
      )
    );
  }, [manpower, manpowerSearch]);

  const groupedActivities = useMemo(() => {
    const filtered =
      sowFilter === 'unscheduled'
        ? activities.filter((a) => asNumber(a.remaining_hours, asNumber(a.planhours, 0)) > 0)
        : activities;
    const groups = {};
    const order = [];
    filtered.forEach((a) => {
      const k = a.order_no || '--';
      if (!groups[k]) {
        groups[k] = [];
        order.push(k);
      }
      groups[k].push(a);
    });
    return order.map((k) => ({
      order_no: k,
      items: groups[k],
      total_plan: groups[k].reduce((s, i) => s + asNumber(i.planhours), 0),
      total_scheduled: groups[k].reduce((s, i) => s + asNumber(i.scheduled_hours, 0), 0),
      part_name: groups[k][0]?.part_name || '',
    }));
  }, [activities, sowFilter]);

  const loadReference = useCallback(async () => {
    const [sh, mc, mp] = await Promise.all([
      fetchShifts({ date }),
      fetchSchedulingMachines(),
      fetchManpower(),
    ]);
    setShifts(sh);
    setMachines(mc);
    setManpower(mp);
  }, [date]);
  const loadActivities = useCallback(
    async ({ page = 1, append = false } = {}) => {
      setLoadingActivities(true);
      try {
        const p = await fetchSchedulingActivities({
          search: debouncedSearch,
          page,
          limit: ACTIVITY_PAGE_SIZE,
        });
        setActivities((prev) => (append ? [...prev, ...(p.data || [])] : p.data || []));
        setActivityPagination(p.pagination || { page, totalPages: 1, total: 0 });
      } catch (err) {
        toast.error('Gagal load activity', { description: err.message || 'Failed to load' });
      } finally {
        setLoadingActivities(false);
      }
    },
    [debouncedSearch]
  );

  const reloadLoadedActivities = useCallback(async () => {
    const loaded = activities.length;
    const limit = Math.min(Math.max(loaded, ACTIVITY_PAGE_SIZE), MAX_ACT_LIMIT);
    setLoadingActivities(true);
    try {
      const p = await fetchSchedulingActivities({ search: debouncedSearch, page: 1, limit });
      const rows = p.data || [];
      const total = p.pagination?.total ?? rows.length;
      setActivities(rows);
      setActivityPagination({
        page: Math.max(1, Math.ceil(rows.length / ACTIVITY_PAGE_SIZE)),
        totalPages: Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE)),
        total,
      });
    } catch (err) {
      toast.error('Gagal refresh activity', { description: err.message || 'Failed' });
    } finally {
      setLoadingActivities(false);
    }
  }, [activities.length, debouncedSearch]);
  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    setBoardError(null);
    try {
      const [sc, cap, ot, b] = await Promise.all([
        fetchSchedules({ date, limit: SCHEDULE_LIMIT }),
        fetchCapacity({ date }),
        fetchOvertime({ date, limit: SCHEDULE_LIMIT }),
        fetchBatches({ date }),
      ]);
      const scRaw = sc.data || [];
      const otRaw = ot || [];
      setSchedules(scRaw.filter((r) => r.schedule_status !== 'CANCELLED'));
      setCapacityRows(cap || []);
      setOvertimeRows(otRaw.filter((r) => r.request_status !== 'CANCELLED'));
      setBatches(b || []);
      setTruncated(scRaw.length >= SCHEDULE_LIMIT || otRaw.length >= SCHEDULE_LIMIT);
    } catch (err) {
      setBoardError(err.message || 'Gagal memuat papan jadwal');
      toast.error('Gagal load schedule board', { description: err.message || 'Failed to load' });
    } finally {
      setLoadingBoard(false);
    }
  }, [date]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    loadReference().catch((e) =>
      toast.error('Gagal load reference', { description: e.message || 'Failed' })
    );
  }, [loadReference]);
  useEffect(() => {
    loadActivities({ page: 1, append: false });
  }, [loadActivities]);
  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const loadBoardRef = useRef(loadBoard);
  loadBoardRef.current = loadBoard;
  const reloadActRef = useRef(reloadLoadedActivities);
  reloadActRef.current = reloadLoadedActivities;
  const refreshBoard = useCallback(() => loadBoardRef.current?.(), []);
  const refreshBoardAndActivities = useCallback(
    () => Promise.all([loadBoardRef.current?.(), reloadActRef.current?.()]),
    []
  );

  const handleDragStart = ({ active }) => {
    setActiveDrag(active.data?.current || null);
  };
  const handleDragEnd = async ({ active, over }) => {
    const d = active.data?.current;
    setActiveDrag(null);
    if (!d?.item || !over?.id) return;

    if (
      d.source === 'manpower' &&
      String(over.id).startsWith('assign-ot-') &&
      over.data?.current?.overtimeId
    ) {
      setSaving(true);
      try {
        await assignManpower(over.data.current.overtimeId, d.item.snssb, d.item.full_name);
        toast.success('Manpower assigned');
        refreshBoard();
      } catch (err) {
        toast.error('Gagal assign manpower', { description: err.message || 'Failed to assign' });
      } finally {
        setSaving(false);
      }
      return;
    }
    const drop = parseDropId(over.id);
    if (drop.type === 'shift') {
      const shift = shifts.find((r) => String(r.id) === String(drop.shiftId));
      if (d.source === 'planned' && d.item.id) {
        const m = machines.find((r) => r.machine_code === drop.machineCode);
        const prev = schedules;
        setSchedules((list) =>
          list.map((r) =>
            r.id === d.item.id
              ? {
                  ...r,
                  machine_code: drop.machineCode,
                  shift_id: Number(drop.shiftId),
                  schedule_date: date,
                  batch_id: null,
                  workcenter: m?.workcenter || r.workcenter,
                }
              : r
          )
        );
        setSaving(true);
        try {
          await rescheduleSchedule(d.item.id, {
            machine_code: drop.machineCode,
            workcenter: m?.workcenter || d.item.workcenter || null,
            schedule_date: date,
            shift_id: drop.shiftId,
          });
          toast.success('Jadwal dipindahkan');
          refreshBoard();
        } catch (err) {
          setSchedules(prev);
          toast.error('Gagal memindahkan jadwal', { description: err.message || 'Failed' });
        } finally {
          setSaving(false);
        }
        return;
      }
      setScheduleModal({
        item: d.item,
        source: d.source || 'activity',
        machineCode: drop.machineCode,
        shiftId: drop.shiftId,
        shift,
        scheduleDate: date,
      });
    }
    if (drop.type === 'overtime') {
      if (d.source === 'manpower') return;
      setOvertimeModal({ item: d.item, machineCode: drop.machineCode, source: d.source });
    }
  };

  const submitSchedule = async ({ hours, note, scheduleDate, batchId }) => {
    if (!scheduleModal?.item || !scheduleModal.machineCode || !scheduleModal.shiftId) return;
    setSaving(true);
    try {
      const iden = activityIdentity(scheduleModal.item);
      const m = machines.find((r) => r.machine_code === scheduleModal.machineCode);
      await createSchedule({
        ...iden,
        schedule_date: scheduleDate || date,
        shift_id: scheduleModal.shiftId,
        machine_code: scheduleModal.machineCode,
        workcenter: m?.workcenter || iden.workcenter,
        planned_hours: hours,
        batch_id: batchId || null,
        remarks: note,
      });
      if (scheduleModal.source === 'unplanned' && scheduleModal.item.id)
        await deleteSchedule(scheduleModal.item.id);
      toast.success('Activity scheduled');
      setScheduleModal(null);
      refreshBoardAndActivities();
    } catch (err) {
      toast.error('Gagal schedule activity', { description: err.message || 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBatch = async ({ batch_capacity_hours, schedule_date }) => {
    if (!scheduleModal?.machineCode || !scheduleModal?.shiftId) return null;
    setSaving(true);
    try {
      const m = machines.find((r) => r.machine_code === scheduleModal.machineCode);
      const c = await createBatch({
        machine_code: scheduleModal.machineCode,
        workcenter: m?.workcenter || null,
        schedule_date: schedule_date || date,
        shift_id: scheduleModal.shiftId,
        batch_capacity_hours,
      });
      const br = await fetchBatches({
        date: schedule_date || date,
        machine_code: scheduleModal.machineCode,
        shift_id: scheduleModal.shiftId,
      });
      setBatches((p) => [
        ...p.filter(
          (r) =>
            !(
              r.machine_code === scheduleModal.machineCode &&
              String(r.schedule_date).slice(0, 10) === String(schedule_date || date) &&
              String(r.shift_id) === String(scheduleModal.shiftId)
            )
        ),
        ...br,
      ]);
      toast.success('Batch created');
      refreshBoard();
      return c;
    } catch (err) {
      toast.error('Gagal create batch', { description: err.message || 'Failed' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const submitOvertime = async ({
    shiftId,
    startTime,
    endTime,
    note,
    assigned_to,
    assigned_to_name,
  }) => {
    if (!overtimeModal?.item || !overtimeModal.machineCode || !shiftId) return;
    setSaving(true);
    try {
      const iden = activityIdentity(overtimeModal.item);
      const m = machines.find((r) => r.machine_code === overtimeModal.machineCode);
      await createOvertime({
        ...iden,
        overtime_date: date,
        shift_id: shiftId,
        machine_code: overtimeModal.machineCode,
        workcenter: m?.workcenter || iden.workcenter,
        start_time: startTime,
        end_time: endTime,
        note,
        assigned_to,
        assigned_to_name,
      });
      toast.success('Overtime requested');
      setOvertimeModal(null);
      refreshBoard();
    } catch (err) {
      toast.error('Gagal request overtime', { description: err.message || 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = useCallback(
    async (id) => {
      setSaving(true);
      try {
        await approveOvertime(id);
        toast.success('Overtime approved');
        refreshBoardAndActivities();
      } catch (err) {
        toast.error('Gagal approve overtime', { description: err.message || 'Failed' });
      } finally {
        setSaving(false);
      }
    },
    [refreshBoardAndActivities]
  );
  const handleReject = useCallback(
    async (id, rejectionNote = '') => {
      setSaving(true);
      try {
        await rejectOvertime(id, rejectionNote);
        toast.success('Overtime rejected');
        refreshBoard();
      } catch (err) {
        toast.error('Gagal reject overtime', { description: err.message || 'Failed' });
      } finally {
        setSaving(false);
      }
    },
    [refreshBoard]
  );
  const handleDeleteSchedule = useCallback(
    async (id) => {
      setSaving(true);
      try {
        await deleteSchedule(id);
        toast.success('Schedule deleted');
        refreshBoardAndActivities();
      } catch (err) {
        toast.error('Gagal delete schedule', { description: err.message || 'Failed' });
      } finally {
        setSaving(false);
      }
    },
    [refreshBoardAndActivities]
  );
  const handleDeleteBatch = useCallback(
    async (id) => {
      if (!confirm('Cancel this batch?')) return;
      setSaving(true);
      try {
        await deleteBatch(id);
        toast.success('Batch cancelled');
        refreshBoard();
      } catch (err) {
        toast.error('Gagal cancel batch', { description: err.message || 'Failed' });
      } finally {
        setSaving(false);
      }
    },
    [refreshBoard]
  );
  const handleDeleteOvertime = useCallback(
    async (id) => {
      if (!confirm('Delete this overtime?')) return;
      setSaving(true);
      try {
        await deleteOvertime(id);
        toast.success('Overtime deleted');
        refreshBoardAndActivities();
      } catch (err) {
        toast.error('Gagal delete overtime', { description: err.message || 'Failed' });
      } finally {
        setSaving(false);
      }
    },
    [refreshBoardAndActivities]
  );
  const loadMoreActivities = () => {
    if (loadingActivities || activityPagination.page >= activityPagination.totalPages) return;
    loadActivities({ page: activityPagination.page + 1, append: true });
  };

  return (
    <PageContainer className="h-screen gap-4 overflow-hidden bg-slate-50">
      <header className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => goBackOrFallback(navigate, '/operations-hub')}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="mr-1">
              <p className="text-[11px] font-bold uppercase leading-none text-[#0077b6]">
                {viewMode === 'timeline' ? 'Timeline Multi-Hari' : 'Daily Scheduling'}
              </p>
              <h1 className="text-lg font-extrabold leading-tight text-slate-900">
                SOW Machine Schedule
              </h1>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                onClick={() => setViewMode('board')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-extrabold transition ${viewMode === 'board' ? 'bg-[#0096c7] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Papan
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-extrabold transition ${viewMode === 'timeline' ? 'bg-[#0096c7] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                Timeline
              </button>
            </div>
          </div>
          {viewMode === 'board' && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SummaryBar
                schedules={schedules}
                capacityRows={capacityRows}
                overtimeRows={overtimeRows}
              />
              <div className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5">
                <CalendarRange className="h-4 w-4 text-slate-400" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
                />
              </div>
              <button
                onClick={() => setShowOvertimeApproval(true)}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#0096c7] px-3 text-sm font-bold text-white hover:bg-[#0077b6]"
              >
                <Clock className="h-4 w-4" />
                OT
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#0077b6]">
                  {pendingOvertimeCount}
                </span>
              </button>
            </div>
          )}
        </div>
      </header>
      {viewMode === 'timeline' ? (
        <main className="min-h-0 flex-1 overflow-hidden">
          {loadingBoard && machines.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#0096c7]" />
            </div>
          ) : (
            <SchedulingTimeline machines={machines} shifts={shifts} />
          )}
        </main>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            modifiers={[restrictToWindowEdges]}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveDrag(null)}
            onDragEnd={handleDragEnd}
          >
            <main className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              <section className="flex h-full min-h-0 w-full flex-row overflow-hidden">
                <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-slate-300 bg-slate-100">
                  {}
                  <div className="flex gap-1.5 p-3 pb-0">
                    <button
                      onClick={() => setSidebarTab('activity')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-extrabold transition ${sidebarTab === 'activity' ? 'bg-[#0096c7] text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      <ClipboardList className="h-4 w-4" />
                      Aktivitas
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${sidebarTab === 'activity' ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {activityPagination.total}
                      </span>
                    </button>
                    <button
                      onClick={() => setSidebarTab('manpower')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-extrabold transition ${sidebarTab === 'manpower' ? 'bg-[#0096c7] text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      <User className="h-4 w-4" />
                      Manpower
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${sidebarTab === 'manpower' ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {manpower.length}
                      </span>
                    </button>
                  </div>

                  {sidebarTab === 'activity' ? (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-3">
                        <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
                          <Search className="h-4 w-4 text-slate-400" />
                          <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                            placeholder="Cari order / SSBR / part..."
                          />
                        </div>
                        <button
                          onClick={() => setSowFilter(sowFilter === 'all' ? 'unscheduled' : 'all')}
                          title="Filter aktivitas"
                          className={`h-10 shrink-0 rounded-lg border px-2.5 text-[10px] font-extrabold uppercase transition ${sowFilter === 'unscheduled' ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                        >
                          {sowFilter === 'unscheduled' ? 'Belum' : 'Semua'}
                        </button>
                      </div>
                      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                        {groupedActivities.map((g) => {
                          const exp = expandedOrders.has(g.order_no);
                          return (
                            <div
                              key={g.order_no}
                              className={`mb-2 overflow-hidden rounded-xl border shadow-sm transition ${exp ? 'border-sky-200 bg-sky-50/70' : 'border-slate-200 bg-white'}`}
                            >
                              <button
                                onClick={() =>
                                  setExpandedOrders((p) => {
                                    const n = new Set(p);
                                    n.has(g.order_no) ? n.delete(g.order_no) : n.add(g.order_no);
                                    return n;
                                  })
                                }
                                className={`flex w-full items-center justify-between px-3 py-2 text-left transition ${exp ? 'bg-sky-100/80' : 'hover:bg-slate-50'}`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-mono text-[11px] font-extrabold text-slate-800">
                                    {g.order_no}
                                  </p>
                                  <p className="truncate text-[9px] font-semibold text-slate-500">
                                    {g.part_name || ''}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ${exp ? 'bg-white text-[#0077b6]' : 'bg-slate-100 text-slate-500'}`}
                                  >
                                    {formatHours(g.total_plan)}/{formatHours(g.total_scheduled)}h
                                  </span>
                                  <ChevronDown
                                    className={`h-3 w-3 text-slate-400 transition ${exp ? 'rotate-180' : ''}`}
                                  />
                                </div>
                              </button>
                              {exp && (
                                <div className="space-y-1.5 border-t border-sky-100 bg-white/75 p-2">
                                  {g.items.map((a) => (
                                    <DraggableActivity key={a.idsow} item={a} />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {groupedActivities.length === 0 && !loadingActivities && (
                          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">
                            Tidak ada aktivitas.
                          </div>
                        )}
                      </div>
                      <button
                        onClick={loadMoreActivities}
                        disabled={
                          loadingActivities ||
                          activityPagination.page >= activityPagination.totalPages
                        }
                        className="mx-3 mb-3 mt-1 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {activityPagination.page >= activityPagination.totalPages
                          ? `${activities.length} dari ${activityPagination.total}`
                          : `Muat lagi (${activities.length}/${activityPagination.total})`}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="px-3 pt-3">
                        <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
                          <Search className="h-4 w-4 text-slate-400" />
                          <input
                            value={manpowerSearch}
                            onChange={(e) => setManpowerSearch(e.target.value)}
                            className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                            placeholder="Cari nama / SN..."
                          />
                        </div>
                      </div>
                      <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-2">
                        {filteredManpower.map((p) => (
                          <DraggableManpower key={p.snssb} person={p} />
                        ))}
                        {filteredManpower.length === 0 && (
                          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">
                            Tidak ada manpower.
                          </div>
                        )}
                      </div>
                      <p className="mx-3 mb-3 shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-[10px] font-semibold text-slate-500">
                        Seret orang ke kotak Overtime pada kartu mesin untuk menugaskan.
                      </p>
                    </>
                  )}
                </aside>

                <section className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-extrabold text-slate-900">Kapasitas Mesin</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="w-72">
                        <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:border-[#0096c7] focus-within:ring-2 focus-within:ring-[#00b4d8]">
                          <Search className="h-4 w-4 text-slate-500" />
                          <input
                            value={machineSearch}
                            onChange={(e) => setMachineSearch(e.target.value)}
                            className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                            placeholder="Cari mesin..."
                          />
                        </div>
                      </label>
                      {loadingBoard && <Loader2 className="h-5 w-5 animate-spin text-[#0096c7]" />}
                    </div>
                  </div>
                  {truncated && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      Data terpotong pada batas {SCHEDULE_LIMIT} baris — sebagian jadwal/overtime
                      mungkin tidak tampil. Persempit tanggal atau filter.
                    </div>
                  )}
                  {boardError && (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                      <span className="inline-flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {boardError}
                      </span>
                      <button
                        onClick={() => loadBoard()}
                        className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        Coba lagi
                      </button>
                    </div>
                  )}
                  {loadingBoard && filteredMachines.length === 0 ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-44 animate-pulse rounded-lg border border-slate-200 bg-white"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {filteredMachines.map((m) => (
                        <MachineCard
                          key={m.machine_code}
                          machine={m}
                          shifts={visibleShifts}
                          capacityBySlot={capacityBySlot}
                          schedulesBySlot={schedulesBySlot}
                          overtimeRows={overtimeByMachine[m.machine_code] || EMPTY_ARR}
                          onDeleteSchedule={handleDeleteSchedule}
                          onDeleteBatch={handleDeleteBatch}
                          onDeleteOvertime={handleDeleteOvertime}
                        />
                      ))}
                      {filteredMachines.length === 0 && !loadingBoard && !boardError && (
                        <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-bold text-slate-500">
                          No machines found.
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </section>
            </main>
            <DragOverlay dropAnimation={null}>
              {activeDrag?.item &&
                (activeDrag.source === 'manpower' ? (
                  <DraggableManpower person={activeDrag.item} />
                ) : (
                  <SowActivityCard item={activeDrag.item} source={activeDrag.source} dragging />
                ))}
            </DragOverlay>
          </DndContext>
          {scheduleModal && (
            <ScheduleModal
              pending={scheduleModal}
              capacity={
                capacityBySlot[capacityKey(scheduleModal.machineCode, scheduleModal.shiftId)]
              }
              batches={batches.filter(
                (b) =>
                  b.machine_code === scheduleModal.machineCode &&
                  String(b.schedule_date).slice(0, 10) ===
                    String(scheduleModal.scheduleDate || date) &&
                  String(b.shift_id) === String(scheduleModal.shiftId)
              )}
              saving={saving}
              onClose={() => setScheduleModal(null)}
              onSubmit={submitSchedule}
              onCreateBatch={handleCreateBatch}
            />
          )}
          {overtimeModal && (
            <OvertimeModal
              pending={overtimeModal}
              shifts={visibleShifts}
              saving={saving}
              onClose={() => setOvertimeModal(null)}
              onSubmit={submitOvertime}
            />
          )}
          {showOvertimeApproval && (
            <OvertimeApprovalPanel
              rows={overtimeRows}
              canApprove={supervisorCanApprove}
              saving={saving}
              onApprove={handleApprove}
              onReject={handleReject}
              onClose={() => setShowOvertimeApproval(false)}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}

export default SowSchedulingPage;
