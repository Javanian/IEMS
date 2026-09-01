import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Factory,
  FileText,
  GitCommitVertical,
  GripVertical,
  History,
  Loader2,
  MessageSquare,
  MoveRight,
  Save,
  Search,
  Send,
  Truck,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '../../components';
import {
  fetchBufferHistory,
  fetchBufferTransactions,
  fetchMachineTracking,
  fetchSowOperations,
  setBufferTransaction,
  updateBufferNote,
  updateBufferPriorities,
} from '../../services/machineTrackingService';
import { goBackOrFallback } from '../../utils/navigation';

const BUFFER_TYPES = [
  {
    type: 'in',
    title: 'Buffer In',
    tone: 'border-emerald-200 bg-emerald-50',
    item: 'bg-emerald-100 text-emerald-900',
  },
  {
    type: 'out',
    title: 'Buffer Out',
    tone: 'border-amber-200 bg-amber-50',
    item: 'bg-amber-100 text-amber-900',
  },
  {
    type: 'moving',
    title: 'Moving',
    tone: 'border-sky-200 bg-sky-50',
    item: 'bg-sky-100 text-sky-900',
  },
];
const SHIPMENT_MACHINE_ID = '__SHIPMENT__';
const SHIPMENT_TYPE = {
  type: 'shipment',
  title: 'Ready To Shipment',
  tone: 'border-violet-200 bg-violet-50',
  item: 'bg-violet-100 text-violet-900',
};
const BUFFER_TYPE_META = [...BUFFER_TYPES, SHIPMENT_TYPE];

const ORDER_STATUS_CLASS = {
  in: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  out: 'bg-amber-100 text-amber-800 border-amber-200',
  moving: 'bg-sky-100 text-sky-800 border-sky-200',
  shipment: 'bg-violet-100 text-violet-800 border-violet-200',
  none: 'bg-slate-100 text-slate-600 border-slate-200',
};

function includesText(value, query) {
  return String(value || '')
    .toLowerCase()
    .includes(query);
}

function formatHours(value) {
  return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('id-ID');
}

function normalizeBuffer(item) {
  return {
    ...item,
    priority: Number(item.priority || 0),
    component_name:
      item.component_name || item.component_label || item.part_name || item.order_no || '-',
  };
}

function uniqueLatestBuffers(rows) {
  const sorted = [...rows].map(normalizeBuffer).sort((a, b) => {
    const dateDiff =
      new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0);
    if (dateDiff !== 0) return dateDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });

  const map = new Map();
  sorted.forEach((item) => {
    const key = `${item.order_no || ''}`;
    if (!map.has(key)) map.set(key, item);
  });

  return Array.from(map.values());
}

function sortBoxItems(items) {
  return [...items].sort((a, b) => {
    const priorityDiff = Number(a.priority || 0) - Number(b.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0);
  });
}

function groupSowByOrder(rows) {
  const map = new Map();

  rows.forEach((operation) => {
    const key = operation.order_no;
    if (!map.has(key)) {
      map.set(key, {
        order_no: operation.order_no,
        ssbr_id: operation.ssbr_id,
        part_name: operation.part_name,
        model: operation.model,
        operations: [],
        total_planhours: 0,
      });
    }

    const group = map.get(key);
    group.operations.push(operation);
    group.total_planhours += Number(operation.planhours || 0);
    group.ssbr_id ||= operation.ssbr_id;
    group.part_name ||= operation.part_name;
    group.model ||= operation.model;
  });

  return Array.from(map.values());
}

function DragHandle({ listeners, attributes, disabled, title = 'Drag item' }) {
  return (
    <button
      type="button"
      {...(!disabled ? listeners : {})}
      {...(!disabled ? attributes : {})}
      disabled={disabled}
      style={{ touchAction: 'none' }}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition ${
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

function OperationCard({ operation, selected, dragging = false, dragHandle = null }) {
  const finished = Boolean(operation.is_finished);

  return (
    <div
      className={`w-full min-w-0 overflow-hidden rounded-lg border p-3 shadow-sm transition ${
        selected ? 'border-[#0096c7] bg-[#caf0f8]' : 'border-slate-200 bg-white'
      } ${dragging ? 'w-80 cursor-grabbing border-[#0096c7] shadow-xl shadow-[#0096c7]/20' : ''} ${
        finished ? 'opacity-50' : ''
      }`}
      title={finished ? 'Finished' : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        {dragHandle}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="line-clamp-2 break-words text-sm font-bold text-slate-900 tablet-body">
            {operation.operation_text || '-'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Op {operation.operation_no || '-'} / {operation.wct_group || '-'}
          </div>
          <div className="mt-1 truncate text-xs text-slate-500">
            {operation.ssbr_id || '-'} / {operation.order_no || '-'}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {finished && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">
              Finished
            </span>
          )}
          <div className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
            {formatHours(operation.planhours)}h
          </div>
        </div>
      </div>
    </div>
  );
}

function DraggableOperation({ operation, selected }) {
  const disabled = Boolean(operation.is_finished);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `operation-${operation.order_no}-${operation.operation_no}`,
    data: { source: 'sow', operation },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      aria-disabled={disabled}
      className={`${disabled ? 'cursor-not-allowed' : ''} ${isDragging ? 'opacity-50' : ''}`}
    >
      <OperationCard
        operation={operation}
        selected={selected}
        dragHandle={
          <DragHandle listeners={listeners} attributes={attributes} disabled={disabled} />
        }
      />
    </div>
  );
}

function OrderCard({ order, latest, dragging = false, dragHandle = null, onSelect }) {
  const statusType = latest?.type || 'none';
  const openCount = order.operations.filter((operation) => !operation.is_finished).length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.();
        }
      }}
      className={`w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm outline-none transition hover:border-[#0096c7] hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#0096c7] tablet-card ${
        dragging ? 'w-80 cursor-grabbing border-[#0096c7] shadow-xl shadow-[#0096c7]/20' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 tablet-gap">
        {dragHandle}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-lg font-bold text-slate-900 tablet-subheading">
            {order.order_no}
          </div>
          <div className="mt-1 line-clamp-1 break-all text-sm text-slate-600 tablet-body">
            {order.ssbr_id || '-'} / {order.part_name || '-'}
          </div>
          <div className="line-clamp-1 break-all text-sm text-slate-500 tablet-body">
            Model: {order.model || '-'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${ORDER_STATUS_CLASS[statusType] || ORDER_STATUS_CLASS.none}`}
            >
              {latest
                ? `${statusType} / ${latest.machine_id === SHIPMENT_MACHINE_ID ? 'Shipment' : latest.machine_id || '-'}`
                : 'Belum diproses'}
            </span>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${openCount === 0 ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}
            >
              {openCount === 0 ? 'All Finish' : `${openCount} Open`}
            </span>
          </div>
        </div>
        <div className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-right">
          <div className="text-xs font-bold text-slate-500">Plan</div>
          <div className="font-mono text-sm font-bold text-slate-900">
            {formatHours(order.total_planhours)}h
          </div>
        </div>
      </div>
    </div>
  );
}

function DraggableOrder({ order, latest, onSelect }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `order-${order.order_no}`,
    data: { source: 'order', order },
  });

  return (
    <div ref={setNodeRef} className={isDragging ? 'opacity-50' : ''}>
      <OrderCard
        order={order}
        latest={latest}
        onSelect={onSelect}
        dragHandle={
          <DragHandle
            listeners={listeners}
            attributes={attributes}
            disabled={false}
            title="Drag order to shipment"
          />
        }
      />
    </div>
  );
}

function BufferContent({ item }) {
  const config = BUFFER_TYPE_META.find((entry) => entry.type === item.type) || BUFFER_TYPES[0];

  return (
    <div className={`w-full min-w-0 overflow-hidden rounded-lg px-3 py-2 ${config.item}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="line-clamp-2 break-words text-sm font-bold tablet-body">
            {item.component_name || '-'}
          </div>
          <div className="mt-0.5 line-clamp-2 break-all text-xs">
            {item.operation_text || '-'} - {item.operation_no || '-'}
          </div>
          <div className="mt-0.5 line-clamp-1 break-all text-xs opacity-80">
            {item.ssbr_id || '-'} / {item.order_no || '-'}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-slate-800">
          P{Number(item.priority || 0)}
        </span>
      </div>
    </div>
  );
}

function SortableBufferItem({ item, onNoteClick, onArriveClick }) {
  const disabled = item.type === 'moving';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `buffer-${item.id}`,
    data: { source: 'buffer', bufferItem: item, type: item.type },
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group min-w-0 overflow-hidden rounded-lg outline-none transition ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex min-w-0 items-stretch gap-2">
        <DragHandle
          listeners={listeners}
          attributes={attributes}
          disabled={disabled}
          title="Drag buffer item"
        />
        <div className="min-w-0 flex-1 text-left">
          <BufferContent item={item} />
        </div>
        {item.type === 'moving' && (
          <button
            type="button"
            onClick={() => onArriveClick(item)}
            className="inline-flex w-10 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-700 transition hover:bg-sky-50"
            title="Arrive"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onNoteClick(item)}
          className="inline-flex w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
          title="Note"
        >
          <FileText className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DropZone({ type, title, items, disabled, onNoteClick, onArriveClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone-${type}`, data: { type }, disabled });
  const config = BUFFER_TYPES.find((entry) => entry.type === type) || BUFFER_TYPES[0];
  const sortedItems = sortBoxItems(items);

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-48 min-w-0 flex-col overflow-hidden rounded-xl border p-3 transition duration-200 ${config.tone} ${
        isOver
          ? 'scale-[1.02] border-[#0096c7] shadow-lg shadow-[#0096c7]/20 ring-2 ring-[#0096c7]'
          : ''
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-slate-700">
          {sortedItems.length}
        </span>
      </div>
      <SortableContext
        items={sortedItems.map((item) => `buffer-${item.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="min-w-0 space-y-2 overflow-hidden">
          {sortedItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-3 text-sm text-slate-500">
              Drop operation ke sini.
            </div>
          ) : (
            sortedItems.map((item) => (
              <SortableBufferItem
                key={item.id}
                item={item}
                onNoteClick={onNoteClick}
                onArriveClick={onArriveClick}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function ShipmentDropZone({ items, disabled, onNoteClick }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'zone-shipment',
    data: { type: 'shipment' },
    disabled,
  });
  const sortedItems = sortBoxItems(items);

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-44 min-w-0 flex-col overflow-hidden rounded-xl border p-3 transition duration-200 ${SHIPMENT_TYPE.tone} ${
        isOver
          ? 'scale-[1.01] border-violet-500 shadow-lg shadow-violet-500/20 ring-2 ring-violet-400'
          : ''
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-violet-700" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Ready To Shipment</h3>
            <p className="text-xs font-semibold text-violet-700">
              Drop order yang semua operation sudah finish.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-slate-700">
          {sortedItems.length}
        </span>
      </div>
      <div className="min-w-0 space-y-2 overflow-hidden">
        {sortedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-violet-300 bg-white/70 p-3 text-sm text-violet-700">
            Drag order_no ke sini untuk status siap kirim.
          </div>
        ) : (
          sortedItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNoteClick(item)}
              className="block w-full min-w-0 rounded-lg text-left transition hover:brightness-95"
            >
              <BufferContent item={item} />
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function MachineBufferPreview({ machine, buffers, onClick, onNoteClick }) {
  const byType = {
    in: sortBoxItems(buffers.filter((item) => item.type === 'in')),
    out: sortBoxItems(buffers.filter((item) => item.type === 'out')),
    moving: sortBoxItems(buffers.filter((item) => item.type === 'moving')),
  };

  return (
    <button
      type="button"
      onClick={() => onClick(machine)}
      className="w-full min-w-0 self-start overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-[#0096c7] hover:shadow-md tablet-machine-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate font-mono text-lg font-bold text-slate-900">
            {machine.machineid}
          </div>
          <div className="line-clamp-1 break-all text-xs text-slate-500">
            {machine.workcenter_description || '-'}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${machine.is_running ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
        >
          {machine.is_running ? 'Running' : 'Idle'}
        </span>
      </div>
      <div className="mt-2 line-clamp-1 break-all text-sm text-slate-600">
        Operator: {machine.operator_name || '-'}
      </div>
      <div className="mt-3 grid gap-1 tablet-machine-buffer-preview">
        {BUFFER_TYPES.map((entry) => (
          <div
            key={entry.type}
            className="min-w-0 overflow-hidden rounded-lg bg-slate-50 p-2 tablet-queue-section"
          >
            <div className="text-xs font-bold text-slate-700">{entry.title}</div>
            <div className="mt-1 min-w-0 space-y-1 overflow-hidden">
              {byType[entry.type].map((item) => (
                <div
                  key={`${entry.type}-${item.id}`}
                  className="min-w-0"
                  onClick={(event) => {
                    event.stopPropagation();
                    onNoteClick(item);
                  }}
                >
                  <BufferContent item={item} />
                </div>
              ))}
              {byType[entry.type].length === 0 && (
                <div className="text-xs text-slate-400">Kosong</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}

function MachinePickerModal({
  pending,
  mode,
  machines,
  selectedMachineId,
  onSelectMachine,
  saving,
  onClose,
  onConfirm,
}) {
  const [machineFilter, setMachineFilter] = useState('');
  if (!pending) return null;

  const operation = pending.operation || pending.bufferItem || {};
  const filteredMachines = machines.filter((machine) => {
    const query = machineFilter.trim().toLowerCase();
    if (!query) return true;
    return (
      includesText(machine.machineid, query) ||
      includesText(machine.operator_name, query) ||
      includesText(machine.workcenter_description, query)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#0096c7]">
              <Send className="h-4 w-4" />
              {mode === 'arrive' ? 'Arrive to Machine' : 'Move to Machine'}
            </div>
            <h3 className="mt-1 text-xl font-bold text-slate-900 tablet-heading">
              {operation.operation_text || '-'}
            </h3>
            <p className="text-sm text-slate-500 tablet-body">
              {operation.order_no || '-'} / Op {operation.operation_no || '-'} /{' '}
              {operation.ssbr_id || '-'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 p-4 tablet-card">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={machineFilter}
              onChange={(event) => setMachineFilter(event.target.value)}
              className="w-full bg-transparent text-sm outline-none tablet-body"
              placeholder="Cari machine ID, operator, atau deskripsi..."
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 tablet-card">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 tablet-machine-picker-grid">
            {filteredMachines.map((machine) => (
              <button
                key={machine.machineid}
                type="button"
                onClick={() => onSelectMachine(machine.machineid)}
                className={`rounded-lg border p-3 text-left transition hover:border-[#0096c7] ${
                  selectedMachineId === machine.machineid
                    ? 'border-[#0096c7] bg-[#caf0f8]'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="font-mono text-lg font-bold text-slate-900 tablet-mono">
                  {machine.machineid}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {machine.workcenter_description || '-'}
                </div>
                <div className="mt-1 truncate text-xs text-slate-600">
                  Operator: {machine.operator_name || '-'}
                </div>
              </button>
            ))}
            {filteredMachines.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Mesin tidak ditemukan.
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white p-4 tablet-card">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!selectedMachineId || saving}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0077b6] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {mode === 'arrive' ? 'Confirm Arrive' : 'Confirm Moving'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteModal({
  item,
  noteDraft,
  setNoteDraft,
  saving,
  historyRows,
  loadingHistory,
  showHistory,
  onClose,
  onSave,
  onHistory,
}) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#0096c7]">
              <MessageSquare className="h-4 w-4" />
              Buffer Note
            </div>
            <h3 className="mt-1 text-xl font-bold text-slate-900">{item.component_name || '-'}</h3>
            <p className="text-sm text-slate-500">
              {item.order_no || '-'} / Op {item.operation_no || '-'} / {item.machine_id || '-'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid max-h-[78vh] overflow-y-auto p-5 md:grid-cols-[1fr_1fr]">
          <section className="pr-0 md:pr-4">
            <label className="text-sm font-bold text-slate-800">Note</label>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              className="mt-2 min-h-44 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none transition focus:border-[#0096c7] focus:ring-2 focus:ring-[#caf0f8]"
              placeholder="Tulis catatan buffer..."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0077b6] disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
              <button
                type="button"
                onClick={onHistory}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <History className="h-4 w-4" />
                History
              </button>
            </div>
          </section>

          <section className="mt-5 border-t border-slate-200 pt-5 md:mt-0 md:border-l md:border-t-0 md:pl-4 md:pt-0">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">Movement Chain</h4>
              {loadingHistory && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            </div>
            {!showHistory ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                Klik History untuk melihat riwayat movement dan note operation ini.
              </div>
            ) : historyRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                Belum ada history.
              </div>
            ) : (
              <div className="relative space-y-4">
                {historyRows.map((row, index) => (
                  <div key={row.id} className="relative flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0096c7] text-white">
                        <GitCommitVertical className="h-4 w-4" />
                      </span>
                      {index < historyRows.length - 1 && (
                        <span className="h-full min-h-10 w-px bg-slate-200" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-700">
                          {row.type}
                        </span>
                        <span className="text-xs text-slate-500">{formatDate(row.created_at)}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {row.machine_id || '-'}
                      </div>
                      <div className="text-xs text-slate-500">
                        Priority: {Number(row.priority || 0)}
                      </div>
                      {row.note && (
                        <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-700">
                          {row.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function BufferTransactionPage() {
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );
  const [sowRows, setSowRows] = useState([]);
  const [machines, setMachines] = useState([]);
  const [bufferHistory, setBufferHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sowSearch, setSowSearch] = useState('');
  const [sowPage, setSowPage] = useState(1);
  const [sowPagination, setSowPagination] = useState({
    page: 1,
    limit: 16,
    total: 0,
    totalPages: 1,
  });
  const [sowLoading, setSowLoading] = useState(true);
  const [machineSearch, setMachineSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOperation, setSelectedOperation] = useState(null);
  const [focusedMachine, setFocusedMachine] = useState(null);
  const [activeDrag, setActiveDrag] = useState(null);
  const [noteItem, setNoteItem] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingOperation, setPendingOperation] = useState(null);
  const [machinePickerMode, setMachinePickerMode] = useState('moving');
  const [selectedArriveMachine, setSelectedArriveMachine] = useState('');
  const [showShipmentZone, setShowShipmentZone] = useState(false);

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [machineData, bufferData] = await Promise.all([
        fetchMachineTracking(),
        fetchBufferTransactions('', { history: true }),
      ]);
      setMachines(machineData);
      setBufferHistory(bufferData.map(normalizeBuffer));
    } catch (err) {
      setError(err.message || 'Gagal mengambil data buffer.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setSowPage(1);
    setSelectedOrder(null);
    setSelectedOperation(null);
  }, [sowSearch]);

  useEffect(() => {
    let alive = true;

    async function loadSow() {
      setSowLoading(true);
      setError('');
      try {
        const payload = await fetchSowOperations(sowSearch, {
          page: sowPage,
          limit: 8,
          withMeta: true,
        });
        if (!alive) return;
        setSowRows(payload.data || []);
        setSowPagination(
          payload.pagination || { page: sowPage, limit: 8, total: 0, totalPages: 1 }
        );
      } catch (err) {
        if (alive) setError(err.message || 'Gagal mengambil data SOW.');
      } finally {
        if (alive) setSowLoading(false);
      }
    }

    loadSow();
    return () => {
      alive = false;
    };
  }, [sowPage, sowSearch]);

  const latestBuffers = useMemo(() => uniqueLatestBuffers(bufferHistory), [bufferHistory]);

  const orderLatestStatus = useMemo(() => {
    const map = new Map();
    [...latestBuffers]
      .sort(
        (a, b) =>
          new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0)
      )
      .forEach((item) => {
        if (item.order_no && !map.has(item.order_no)) map.set(item.order_no, item);
      });
    return map;
  }, [latestBuffers]);

  const groupedOrders = useMemo(() => {
    const query = sowSearch.trim().toLowerCase();
    const filtered = query
      ? sowRows.filter(
          (row) =>
            includesText(row.order_no, query) ||
            includesText(row.ssbr_id, query) ||
            includesText(row.part_name, query) ||
            includesText(row.model, query) ||
            includesText(row.operation_text, query) ||
            includesText(row.operation_no, query)
        )
      : sowRows;

    return groupSowByOrder(filtered);
  }, [sowRows, sowSearch]);

  const selectedOrderData = useMemo(
    () => groupedOrders.find((order) => order.order_no === selectedOrder) || null,
    [groupedOrders, selectedOrder]
  );

  const visibleMachines = useMemo(() => {
    const query = machineSearch.trim().toLowerCase();
    const base = focusedMachine
      ? machines.filter((machine) => machine.machineid === focusedMachine.machineid)
      : machines;
    if (!query) return base;

    return base.filter(
      (machine) =>
        includesText(machine.machineid, query) || includesText(machine.operator_name, query)
    );
  }, [focusedMachine, machineSearch, machines]);

  const buffersByMachine = useMemo(() => {
    const map = new Map();
    latestBuffers.forEach((item) => {
      const key = item.machine_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }, [latestBuffers]);

  const focusedBuffers = useMemo(
    () => (focusedMachine ? buffersByMachine.get(focusedMachine.machineid) || [] : []),
    [buffersByMachine, focusedMachine]
  );
  const shipmentBuffers = useMemo(
    () => sortBoxItems(latestBuffers.filter((item) => item.type === 'shipment')),
    [latestBuffers]
  );

  const getTargetType = (over) => {
    if (!over) return null;
    if (over.data?.current?.type) return over.data.current.type;
    const overItem = latestBuffers.find((item) => `buffer-${item.id}` === over.id);
    return overItem?.type || null;
  };

  const refreshBufferHistory = useCallback(async () => {
    const rows = await fetchBufferTransactions('', { history: true });
    setBufferHistory(rows.map(normalizeBuffer));
  }, []);

  const markSowOperationFinished = useCallback((operation) => {
    if (
      !operation?.order_no ||
      operation.operation_no === null ||
      operation.operation_no === undefined
    )
      return;
    setSowRows((prev) =>
      prev.map((row) =>
        row.order_no === operation.order_no &&
        String(row.operation_no) === String(operation.operation_no)
          ? {
              ...row,
              is_finished: true,
              status: 'FINISH',
              finish_date: new Date().toISOString().slice(0, 10),
            }
          : row
      )
    );
    setSelectedOperation((prev) =>
      prev?.order_no === operation.order_no &&
      String(prev.operation_no) === String(operation.operation_no)
        ? {
            ...prev,
            is_finished: true,
            status: 'FINISH',
            finish_date: new Date().toISOString().slice(0, 10),
          }
        : prev
    );
  }, []);

  const sourceToOperation = (source) =>
    source?.source === 'buffer'
      ? {
          part_name: source.bufferItem.component_name,
          order_no: source.bufferItem.order_no,
          ssbr_id: source.bufferItem.ssbr_id,
          operation_no: source.bufferItem.operation_no,
          operation_text: source.bufferItem.operation_text,
          note: source.bufferItem.note,
        }
      : source?.operation;

  const openMachinePicker = (source, mode = 'moving') => {
    const operation = sourceToOperation(source);
    if (!operation) return;
    setPendingOperation({ ...source, operation });
    setMachinePickerMode(mode);
    setSelectedArriveMachine('');
  };

  const createMovement = async (source, type, machineId = focusedMachine?.machineid) => {
    const operation =
      source?.source === 'buffer'
        ? {
            part_name: source.bufferItem.component_name,
            order_no: source.bufferItem.order_no,
            ssbr_id: source.bufferItem.ssbr_id,
            operation_no: source.bufferItem.operation_no,
            operation_text: source.bufferItem.operation_text,
            note: source.bufferItem.note,
          }
        : source?.operation;

    if (!operation || !machineId || !type) return;

    const targetItems = latestBuffers.filter(
      (item) => item.machine_id === machineId && item.type === type
    );
    const nextPriority =
      targetItems.length === 0
        ? 0
        : Math.max(...targetItems.map((item) => Number(item.priority || 0))) + 1;

    setSaving(true);
    setError('');
    try {
      const saved = await setBufferTransaction({
        machine_id: machineId,
        type,
        component_label: operation.part_name || operation.part_number || operation.order_no,
        order_no: operation.order_no,
        ssbr_id: operation.ssbr_id,
        operation_no: operation.operation_no,
        operation_text: operation.operation_text,
        priority: nextPriority,
        note: operation.note || 'Set from Buffer Transaction page',
      });

      const normalizedSaved = normalizeBuffer(saved);
      setBufferHistory((prev) => [normalizedSaved, ...prev]);
      await refreshBufferHistory();
      if (type === 'out') markSowOperationFinished(operation);
      return normalizedSaved;
    } catch (err) {
      setError(err.message || 'Gagal menyimpan buffer.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const createShipment = async (order) => {
    if (!order?.order_no) return null;
    const nextPriority =
      shipmentBuffers.length === 0
        ? 0
        : Math.max(...shipmentBuffers.map((item) => Number(item.priority || 0))) + 1;

    setSaving(true);
    setError('');
    try {
      const saved = await setBufferTransaction({
        machine_id: SHIPMENT_MACHINE_ID,
        type: 'shipment',
        component_label: order.part_name || order.order_no,
        order_no: order.order_no,
        ssbr_id: order.ssbr_id,
        operation_no: null,
        operation_text: 'Ready To Shipment',
        priority: nextPriority,
        note: 'Ready to shipment',
      });

      const normalizedSaved = normalizeBuffer(saved);
      setBufferHistory((prev) => [normalizedSaved, ...prev]);
      await refreshBufferHistory();
      return normalizedSaved;
    } catch (err) {
      const unfinished = err.details?.unfinished_operations || [];
      const examples = unfinished
        .slice(0, 3)
        .map((item) => `OP ${item.operation_no} ${item.operation_text || ''}`.trim())
        .join(', ');
      setError(
        err.status === 409 && unfinished.length > 0
          ? `Belum bisa Ready To Shipment: ${unfinished.length} operation belum finish${examples ? ` (${examples})` : ''}.`
          : err.message || 'Gagal menyimpan Ready To Shipment.'
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  const confirmArrive = async () => {
    if (!pendingOperation || !selectedArriveMachine) return;
    const nextType = machinePickerMode === 'arrive' ? 'in' : 'moving';
    const saved = await createMovement(pendingOperation, nextType, selectedArriveMachine);
    const targetMachine = machines.find((machine) => machine.machineid === selectedArriveMachine);
    if (saved && targetMachine && machinePickerMode === 'arrive') setFocusedMachine(targetMachine);
    setPendingOperation(null);
    setSelectedArriveMachine('');
    setMachinePickerMode('moving');
  };

  const reorderWithinBox = async (activeItem, overItem) => {
    if (!activeItem || !overItem || activeItem.type !== overItem.type) return;

    const items = sortBoxItems(focusedBuffers.filter((item) => item.type === activeItem.type));
    const oldIndex = items.findIndex((item) => item.id === activeItem.id);
    const newIndex = items.findIndex((item) => item.id === overItem.id);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

    const reordered = arrayMove(items, oldIndex, newIndex).map((item, index) => ({
      ...item,
      priority: index,
    }));

    const updates = reordered.map((item) => ({ id: item.id, priority: item.priority }));
    setSaving(true);
    setError('');
    try {
      await updateBufferPriorities(updates);
      setBufferHistory((prev) =>
        prev.map((item) => {
          const next = reordered.find((row) => row.id === item.id);
          return next ? { ...item, priority: next.priority } : item;
        })
      );
    } catch (err) {
      setError(err.message || 'Gagal mengubah prioritas.');
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = ({ active }) => {
    setActiveDrag(active.data?.current || null);
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
  };

  const handleDragEnd = async ({ active, over }) => {
    const source = active.data?.current;

    setActiveDrag(null);
    if (!source || !over) return;

    const targetType = getTargetType(over);

    if (source.source === 'order') {
      if (targetType === 'shipment') await createShipment(source.order);
      return;
    }

    if (targetType === 'shipment') return;

    if (!focusedMachine) return;

    if (source.source === 'buffer') {
      const overBuffer = latestBuffers.find((item) => `buffer-${item.id}` === over.id);
      if (overBuffer && overBuffer.type === source.bufferItem.type) {
        await reorderWithinBox(source.bufferItem, overBuffer);
        return;
      }

      if (!targetType) return;
      if (targetType === 'moving') {
        openMachinePicker(source, 'moving');
        return;
      }

      if (targetType !== source.bufferItem.type) {
        await createMovement(source, targetType);
      }
      return;
    }

    if (!targetType) return;
    if (targetType === 'moving') {
      openMachinePicker(source, 'moving');
      return;
    }

    await createMovement(source, targetType);
  };

  const openNote = (item) => {
    setNoteItem(item);
    setNoteDraft(item.note || '');
    setHistoryRows([]);
    setShowHistory(false);
  };

  const saveNote = async () => {
    if (!noteItem) return;
    setSaving(true);
    setError('');
    try {
      const saved = normalizeBuffer(await updateBufferNote(noteItem.id, noteDraft));
      setBufferHistory((prev) =>
        prev.map((item) => (item.id === saved.id ? { ...item, ...saved } : item))
      );
      setNoteItem((prev) => (prev ? { ...prev, ...saved } : prev));
      if (showHistory) {
        const rows = await fetchBufferHistory(saved.order_no);
        setHistoryRows(rows.map(normalizeBuffer));
      }
    } catch (err) {
      setError(err.message || 'Gagal menyimpan note.');
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async () => {
    if (!noteItem) return;
    setShowHistory(true);
    setLoadingHistory(true);
    try {
      const rows = await fetchBufferHistory(noteItem.order_no);
      setHistoryRows(rows.map(normalizeBuffer));
    } catch (err) {
      setError(err.message || 'Gagal mengambil history.');
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <PageContainer className="tablet-page gap-4 overflow-x-hidden bg-slate-50">
      <header className="rounded-xl border-b border-slate-200 bg-white px-4 py-3 shadow-sm tablet-card">
        <div className="relative flex min-h-[42px] items-center justify-between gap-2">
          <div className="flex min-w-[7rem] items-center gap-2">
            <button
              type="button"
              onClick={() => goBackOrFallback(navigate, '/component-tracking')}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 tablet-body"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          <div className="tablet-header-title absolute left-1/2 -translate-x-1/2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#0096c7]">
              <Boxes className="h-4 w-4" />
              Buffer setup
            </div>
            <h2 className="mt-1 text-2xl font-bold text-slate-800 tablet-heading">
              Buffer Transaction
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {saving && (
              <span className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-semibold text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </span>
            )}
            <button
              type="button"
              onClick={() => navigate('/component-tracking')}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0077b6] active:bg-[#023e8a] tablet-body"
            >
              <Factory className="h-4 w-4" />
              Monitoring
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <main className="tablet-buffer-grid grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)] tablet-gap">
          <section className="tablet-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm tablet-card">
            <div className="mb-3 flex shrink-0 items-center justify-between gap-1">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Daftar SOW</h3>
                <p className="text-sm text-slate-500">
                  {selectedOrderData
                    ? 'Drag operation ke buffer mesin.'
                    : 'Pilih order untuk melihat operation.'}
                </p>
              </div>
              {selectedOrderData && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrder(null);
                    setSelectedOperation(null);
                  }}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Back
                </button>
              )}
            </div>
            <label className="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={sowSearch}
                onChange={(event) => setSowSearch(event.target.value)}
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Cari order, SSBR, part, model, operation..."
              />
            </label>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              {sowLoading ? (
                <div className="flex items-center justify-center p-8 text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading SOW
                </div>
              ) : selectedOrderData ? (
                <div className="space-y-1">
                  <DraggableOrder
                    order={selectedOrderData}
                    latest={orderLatestStatus.get(selectedOrderData.order_no)}
                    onSelect={() => {}}
                  />
                  {selectedOrderData.operations.map((operation) => (
                    <div
                      key={`${operation.order_no}-${operation.operation_no}`}
                      onClick={() => {
                        if (!operation.is_finished) setSelectedOperation(operation);
                      }}
                      onKeyDown={(event) => {
                        if (!operation.is_finished && (event.key === 'Enter' || event.key === ' '))
                          setSelectedOperation(operation);
                      }}
                      role="button"
                      tabIndex={0}
                      className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[#0096c7]"
                    >
                      <DraggableOperation
                        operation={operation}
                        selected={
                          selectedOperation?.order_no === operation.order_no &&
                          selectedOperation?.operation_no === operation.operation_no
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sow-order-list flex flex-col gap-1">
                  {groupedOrders.map((order) => {
                    const latest = orderLatestStatus.get(order.order_no);
                    const firstOpenOperation =
                      order.operations.find((operation) => !operation.is_finished) ||
                      order.operations[0] ||
                      null;

                    return (
                      <DraggableOrder
                        key={order.order_no}
                        order={order}
                        latest={latest}
                        onSelect={() => {
                          setSelectedOrder(order.order_no);
                          setSelectedOperation(
                            firstOpenOperation?.is_finished ? null : firstOpenOperation
                          );
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
            {!selectedOrderData && (
              <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 pt-3 tablet-body">
                <button
                  type="button"
                  onClick={() => setSowPage((page) => Math.max(1, page - 1))}
                  disabled={sowPagination.page <= 1 || sowLoading}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs font-semibold text-slate-600">
                  Page {sowPagination.page} / {sowPagination.totalPages} ({sowPagination.total}{' '}
                  order)
                </span>
                <button
                  type="button"
                  onClick={() => setSowPage((page) => Math.min(sowPagination.totalPages, page + 1))}
                  disabled={sowPagination.page >= sowPagination.totalPages || sowLoading}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </section>

          <section className="tablet-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm tablet-card">
            <div className="mb-3 flex shrink-0 flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Daftar Mesin</h3>
                <p className="text-sm text-slate-500">
                  {showShipmentZone
                    ? 'Ready To Shipment zone aktif.'
                    : focusedMachine
                      ? `${focusedMachine.machineid} sedang dipilih.`
                      : 'Klik mesin untuk fokus sebelum drop.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowShipmentZone((value) => !value)}
                  className={`inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
                    showShipmentZone
                      ? 'border-violet-200 bg-violet-100 text-violet-700 hover:bg-violet-50'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Truck className="h-4 w-4" />
                  {showShipmentZone ? 'Hide Shipment' : 'Show Shipment'}
                </button>
                {focusedMachine && (
                  <button
                    type="button"
                    onClick={() => setFocusedMachine(null)}
                    className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <MoveRight className="h-4 w-4" />
                    Pilih Mesin Lain
                  </button>
                )}
              </div>
            </div>

            {showShipmentZone && (
              <div className="mb-3 shrink-0">
                <ShipmentDropZone
                  items={shipmentBuffers}
                  disabled={saving}
                  onNoteClick={openNote}
                />
              </div>
            )}

            {!focusedMachine && (
              <label className="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={machineSearch}
                  onChange={(event) => setMachineSearch(event.target.value)}
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder="Cari machine ID atau operator..."
                />
              </label>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              {loading ? (
                <div className="flex items-center justify-center p-8 text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading mesin
                </div>
              ) : focusedMachine ? (
                <div className="sow-order-list flex flex-col gap-1">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-1">
                      <div>
                        <div className="font-mono text-2xl font-bold text-slate-900">
                          {focusedMachine.machineid}
                        </div>
                        <div className="text-sm text-slate-600">
                          Operator: {focusedMachine.operator_name || '-'}
                        </div>
                      </div>
                      <CheckCircle2 className="h-6 w-6 text-[#0096c7]" />
                    </div>
                  </div>
                  {BUFFER_TYPES.map((entry) => (
                    <DropZone
                      key={entry.type}
                      type={entry.type}
                      title={entry.title}
                      items={focusedBuffers.filter((item) => item.type === entry.type)}
                      disabled={!focusedMachine}
                      onNoteClick={openNote}
                      onArriveClick={(item) =>
                        createMovement(
                          { source: 'buffer', bufferItem: item },
                          'in',
                          item.machine_id
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 items-start gap-1 lg:grid-cols-2 tablet-machine-grid">
                  {visibleMachines.map((machine) => (
                    <MachineBufferPreview
                      key={machine.machineid}
                      machine={machine}
                      buffers={buffersByMachine.get(machine.machineid) || []}
                      onClick={setFocusedMachine}
                      onNoteClick={openNote}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.source === 'order' && (
            <OrderCard
              order={activeDrag.order}
              latest={orderLatestStatus.get(activeDrag.order.order_no)}
              dragging
            />
          )}
          {activeDrag?.source === 'sow' && (
            <OperationCard operation={activeDrag.operation} selected dragging />
          )}
          {activeDrag?.source === 'buffer' && (
            <div className="w-80 shadow-xl">
              <BufferContent item={activeDrag.bufferItem} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <NoteModal
        item={noteItem}
        noteDraft={noteDraft}
        setNoteDraft={setNoteDraft}
        saving={saving}
        historyRows={historyRows}
        loadingHistory={loadingHistory}
        showHistory={showHistory}
        onClose={() => setNoteItem(null)}
        onSave={saveNote}
        onHistory={loadHistory}
      />
      <MachinePickerModal
        pending={pendingOperation}
        mode={machinePickerMode}
        machines={machines}
        selectedMachineId={selectedArriveMachine}
        onSelectMachine={setSelectedArriveMachine}
        saving={saving}
        onClose={() => {
          setPendingOperation(null);
          setSelectedArriveMachine('');
          setMachinePickerMode('moving');
        }}
        onConfirm={confirmArrive}
      />
    </PageContainer>
  );
}
