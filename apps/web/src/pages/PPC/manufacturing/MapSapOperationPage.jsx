import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  FolderSearch,
  GripVertical,
  ListTree,
  Loader2,
  PackageOpen,
  Replace,
  RotateCw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, SearchInput, Skeleton } from '../../../components';
import {
  fetchMsProjects,
  fetchMsProjectTasks,
  fetchSowOrderOperations,
  fetchSowOrders,
  mapSowOperationToTask,
} from '../../../services/msProjectService';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '-';
  return `${hours.toLocaleString('en-GB', { maximumFractionDigits: 2 })}h`;
}

function operationSortValue(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareOperationRows(a, b) {
  const operationDiff = operationSortValue(a.operation_no) - operationSortValue(b.operation_no);
  if (operationDiff !== 0) return operationDiff;
  const operationTextDiff = String(a.operation_no || '').localeCompare(
    String(b.operation_no || ''),
    undefined,
    { numeric: true }
  );
  if (operationTextDiff !== 0) return operationTextDiff;
  return String(a.outline_number || '').localeCompare(String(b.outline_number || ''), undefined, {
    numeric: true,
  });
}

function sortByOperationNo(rows = []) {
  return [...rows].sort(compareOperationRows);
}

function compareOutlineNumber(a, b) {
  return String(a.outline_number || '').localeCompare(String(b.outline_number || ''), undefined, {
    numeric: true,
  });
}

function buildTaskTree(tasks = []) {
  const byParent = new Map();
  const byId = new Map();
  tasks.forEach((task) => {
    byId.set(task.task_id, task);
    const key = task.parent_task_id || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(task);
  });

  byParent.forEach((items) => items.sort(compareOutlineNumber));
  const roots = (byParent.get('__root__') || [])
    .concat(tasks.filter((task) => task.parent_task_id && !byId.has(task.parent_task_id)))
    .filter((task, index, rows) => rows.findIndex((row) => row.task_id === task.task_id) === index)
    .sort(compareOutlineNumber);

  return { roots, byParent };
}

const TREE_COLS = 'grid-cols-[minmax(0,1fr)_52px_104px_88px_88px]';

const DASH = '—';

function projectStatusClass(project) {
  if (project.checked_out_by) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (String(project.status || '').toUpperCase() === 'ACTIVE')
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

function PanelError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-red-400" strokeWidth={1.5} />
      <p className="max-w-xs text-xs text-red-600">{message || 'Failed to load data.'}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
      >
        <RotateCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

function StatusBadge({ project }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${projectStatusClass(project)}`}
    >
      {project.checked_out_by ? 'Checked Out' : project.status || 'Draft'}
    </span>
  );
}

function ProjectCard({ project, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(project)}
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-800">
            {project.project_name || '-'}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {project.description || 'No description'}
          </p>
        </div>
        <StatusBadge project={project} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold tabular-nums">Rev {project.revision_no || 0}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{formatDate(project.updated_at)}</span>
      </div>
    </button>
  );
}

function TaskTreeNode({
  task,
  childrenByParent,
  expandedIds,
  onToggle,
  onDropOperation,
  depth = 0,
}) {
  const children = childrenByParent.get(task.task_id) || [];
  const expanded = expandedIds.has(task.task_id);
  const hasChildren = children.length > 0;
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    onDropOperation(task, hasChildren, event);
  };

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`group grid ${TREE_COLS} items-center gap-2 border-b border-slate-100 px-2 transition-colors ${
          dragOver ? 'bg-[#caf0f8] ring-2 ring-inset ring-[#00b4d8]' : 'bg-white hover:bg-slate-50'
        }`}
      >
        {}
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 18 }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(task.task_id)}
              aria-label={expanded ? 'Collapse branch' : 'Expand branch'}
              aria-expanded={expanded}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00b4d8]"
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''} motion-reduce:transition-none`}
              />
            </button>
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            </span>
          )}

          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-slate-600">
            {task.outline_number || '-'}
          </span>
          <span
            className="truncate py-2 text-xs font-extrabold text-slate-800"
            title={task.task_name || undefined}
          >
            {task.task_name || '-'}
          </span>
        </div>

        <span className="truncate font-mono text-xs font-bold tabular-nums text-[#0077b6]">
          {task.operation_no || DASH}
        </span>
        {}
        <span
          className="truncate text-xs font-semibold text-slate-600"
          title={task.workcenter || undefined}
        >
          {task.workcenter || DASH}
        </span>
        <span className="truncate text-xs tabular-nums text-slate-500">
          {task.plan_start ? formatDate(task.plan_start) : DASH}
        </span>
        <span className="truncate text-xs tabular-nums text-slate-500">
          {task.plan_finish ? formatDate(task.plan_finish) : DASH}
        </span>
      </div>
      {expanded &&
        children.map((child) => (
          <TaskTreeNode
            key={child.task_id}
            task={child}
            childrenByParent={childrenByParent}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onDropOperation={onDropOperation}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function SowOrderCard({ order, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(order)}
      className={`group flex w-full items-start gap-2 rounded-xl border bg-white p-3 text-left shadow-sm transition-all hover:border-[#90e0ef] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected ? 'border-[#0077b6] ring-2 ring-[#90e0ef]' : 'border-slate-200'
      }`}
    >
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm font-extrabold tabular-nums text-slate-800">
            {order.order_no}
          </span>
          <span className="shrink-0 rounded-full border border-[#90e0ef] bg-[#caf0f8] px-2 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
            {order.operation_count || 0} ops
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">
          {order.part_name || order.ssbr_id || '-'}
        </span>
        <span className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold tabular-nums">{formatHours(order.total_planhours)}</span>
          <span className="text-slate-300">·</span>
          <span className="truncate">{order.workcenter || 'No workcenter'}</span>
        </span>
      </span>
    </button>
  );
}

function OperationCard({ operation, mappedTask, onDragStart, disabled }) {
  const mapped = Boolean(mappedTask);
  return (
    <div
      draggable={!disabled}
      onDragStart={disabled ? undefined : (event) => onDragStart(event, operation)}
      className={`cursor-grab rounded-lg border bg-white px-3 py-2 shadow-sm transition-colors active:cursor-grabbing ${
        mapped
          ? 'border-emerald-200 bg-emerald-50/50'
          : 'border-slate-200 hover:border-[#90e0ef] hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
          <span className="font-mono text-xs font-extrabold tabular-nums text-[#0077b6]">
            Op {operation.operation_no}
          </span>
        </span>
        <span className="text-xs font-semibold tabular-nums text-slate-500">
          {formatHours(operation.planhours)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-700">
        {operation.operation_text || '-'}
      </p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-slate-500">
          {operation.workcenter || operation.wct_group || '-'}
        </p>
        {mapped && (
          <span
            title={mappedTask.task_name || undefined}
            className="shrink-0 rounded-full border border-emerald-200 bg-emerald-100 px-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700"
          >
            {mappedTask.outline_number || 'Mapped'}
          </span>
        )}
      </div>
    </div>
  );
}

function OperationList({ operations, mappedByOperation, onDragStart, disabled }) {
  return (
    <div className="space-y-1.5">
      {sortByOperationNo(operations).map((operation) => (
        <OperationCard
          key={operation.idsow}
          operation={operation}
          mappedTask={mappedByOperation.get(String(operation.operation_no))}
          onDragStart={onDragStart}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SelectedProjectBox({ project, onClear }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[#90e0ef] bg-[#caf0f8] p-3">
      <div className="min-w-0">
        <h4 className="truncate text-sm font-extrabold text-slate-800">
          {project.project_name || '-'}
        </h4>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-600">
          {project.description || 'No description'}
        </p>
        <p className="mt-1 text-xs font-semibold tabular-nums text-[#0077b6]">
          Rev {project.revision_no || 0}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[#90e0ef] bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
        aria-label="Change project"
      >
        <X className="h-3.5 w-3.5" />
        Change
      </button>
    </div>
  );
}

function mappingErrorText(error) {
  const code = error?.code;
  const details = Array.isArray(error?.details) ? error.details : [];
  const text = String(error?.message || '');

  if (code === 'ORDER_MAPPED_ELSEWHERE') {
    const names = details.map((row) => row.project_name || row.project_id).filter(Boolean);
    return {
      title: 'Order already mapped elsewhere',
      description: names.length
        ? `Already in ${names.join(', ')}. One order maps to one project.`
        : 'One order maps to one project.',
    };
  }
  if (code === 'TARGET_TASK_OCCUPIED') {
    const held = details[0] || {};
    return {
      title: 'Task already used',
      description: held.operation_no
        ? `That node holds order ${held.order_no} op ${held.operation_no}.`
        : 'That node already holds another operation.',
    };
  }
  if (code === 'TAKEOVER_WOULD_ORPHAN_RESERVATION') {
    return {
      title: 'Takeover cancelled',
      description: 'Some bay reservations point to operations missing from this project.',
    };
  }
  return { title: 'Mapping failed', description: text || 'Unknown error' };
}

function ReplaceDialog({ prompt, busy, onCancel, onConfirm }) {
  useEffect(() => {
    if (!prompt) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [prompt, onCancel]);

  if (!prompt) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-slate-800">{prompt.title}</h3>
            <p className="mt-1 text-xs text-slate-600">{prompt.description}</p>
            <p className="mt-2 text-xs font-semibold text-slate-700">
              Replace with op {prompt.dragged.operation_no} of {prompt.dragged.order_no}?
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-bold text-white transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Replace className="h-4 w-4" />
            )}
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MapSapOperationPage() {
  const [projects, setProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectError, setProjectError] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState(() => new Set());
  const [sowOrders, setSowOrders] = useState([]);
  const [sowSearch, setSowSearch] = useState('');
  const [sowError, setSowError] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [operations, setOperations] = useState([]);
  const [sowLoading, setSowLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [mapping, setMapping] = useState(false);

  const [sourceView, setSourceView] = useState('orders');

  const [replacePrompt, setReplacePrompt] = useState(null);

  const taskTree = useMemo(() => buildTaskTree(projectTasks), [projectTasks]);

  const loadProjects = useCallback(async () => {
    setProjectLoading(true);
    setProjectError(null);
    try {
      setProjects(await fetchMsProjects({ q: projectSearch, limit: 80 }));
    } catch (error) {
      setProjectError(error.message);
    } finally {
      setProjectLoading(false);
    }
  }, [projectSearch]);

  useEffect(() => {
    if (selectedProject) return undefined;
    const timer = setTimeout(loadProjects, 250);
    return () => clearTimeout(timer);
  }, [loadProjects, selectedProject]);

  const loadSowOrders = useCallback(async () => {
    setSowLoading(true);
    setSowError(null);
    try {
      setSowOrders(await fetchSowOrders({ q: sowSearch, limit: 80 }));
    } catch (error) {
      setSowError(error.message);
    } finally {
      setSowLoading(false);
    }
  }, [sowSearch]);

  useEffect(() => {
    const timer = setTimeout(loadSowOrders, 250);
    return () => clearTimeout(timer);
  }, [loadSowOrders]);

  const loadProjectTasks = useCallback(async (project) => {
    setSelectedProject(project);
    setExpandedTaskIds(new Set());
    setTaskLoading(true);
    setTaskError(null);
    try {
      setProjectTasks(await fetchMsProjectTasks(project.project_id));
    } catch (error) {
      setTaskError(error.message);
    } finally {
      setTaskLoading(false);
    }
  }, []);

  const clearProject = useCallback(() => {
    setSelectedProject(null);
    setProjectTasks([]);
    setTaskError(null);
    setExpandedTaskIds(new Set());
  }, []);

  const loadOperations = useCallback(async (order) => {
    setSelectedOrder(order);
    setSourceView('operations');
    setOperationLoading(true);
    setOperationError(null);
    try {
      setOperations(await fetchSowOrderOperations(order.order_no));
    } catch (error) {
      setOperationError(error.message);
    } finally {
      setOperationLoading(false);
    }
  }, []);

  const handleOperationDragStart = useCallback(
    (event, operation) => {
      if (!selectedOrder) return;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          order_no: selectedOrder.order_no,
          operation_no: String(operation.operation_no),
        })
      );
      event.dataTransfer.setData('text/plain', `Op ${operation.operation_no}`);
    },
    [selectedOrder]
  );

  const mapOneOperation = useCallback(
    async (dragged, task, asChild, takeover) => {
      setMapping(true);
      try {
        const result = await mapSowOperationToTask(selectedProject.project_id, {
          order_no: dragged.order_no,
          operation_no: dragged.operation_no,
          ...(asChild ? { target_parent_task_id: task.task_id } : { target_task_id: task.task_id }),
          ...(takeover ? { takeover: true } : {}),
        });
        toast.success(`Op ${dragged.operation_no} mapped`, {
          description:
            [result.task?.outline_number, result.task?.task_name].filter(Boolean).join(' · ') ||
            undefined,
        });
        setProjectTasks(await fetchMsProjectTasks(selectedProject.project_id));
        if (asChild) setExpandedTaskIds((prev) => new Set([...prev, task.task_id]));
      } catch (error) {
        const { title, description } = mappingErrorText(error);
        const canReplace =
          !takeover &&
          (error.code === 'ORDER_MAPPED_ELSEWHERE' || error.code === 'TARGET_TASK_OCCUPIED');
        if (canReplace) {
          setReplacePrompt({ dragged, task, asChild, title, description });
        } else {
          toast.error(title, { description });
        }
      } finally {
        setMapping(false);
      }
    },
    [selectedProject]
  );

  const handleDropOperation = useCallback(
    (task, hasChildren, event) => {
      const raw = event.dataTransfer?.getData('application/json');
      if (!raw) return;
      let dragged = null;
      try {
        dragged = JSON.parse(raw);
      } catch {
        return;
      }
      if (!dragged?.order_no || dragged.operation_no == null) return;
      if (!selectedProject) {
        toast.error('Choose a target project first');
        return;
      }
      mapOneOperation(dragged, task, hasChildren, false);
    },
    [selectedProject, mapOneOperation]
  );

  const handleReplaceCancel = useCallback(() => setReplacePrompt(null), []);

  const handleReplaceConfirm = useCallback(() => {
    if (!replacePrompt) return;
    const { dragged, task, asChild } = replacePrompt;
    setReplacePrompt(null);
    mapOneOperation(dragged, task, asChild, true);
  }, [replacePrompt, mapOneOperation]);

  const toggleTaskExpand = useCallback((taskId) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const mappedByOperation = useMemo(() => {
    const map = new Map();
    if (!selectedOrder) return map;
    const key = String(selectedOrder.order_no).replace(/^0+/, '');
    projectTasks.forEach((task) => {
      if (!task.operation_no || !task.order_no) return;
      if (String(task.order_no).replace(/^0+/, '') !== key) return;
      map.set(String(task.operation_no), task);
    });
    return map;
  }, [projectTasks, selectedOrder]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        {}
        <section className="flex min-h-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          {}
          {sourceView === 'orders' ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">
                    Source
                  </p>
                  <h3 className="text-sm font-extrabold text-slate-800">SOW orders</h3>
                </div>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500">
                  {sowOrders.length}
                </span>
              </div>

              <div className="border-b border-slate-200 p-3">
                <SearchInput
                  value={sowSearch}
                  onChange={setSowSearch}
                  placeholder="Search order or part"
                />
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
                {sowLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-[74px] w-full rounded-xl" />
                  ))
                ) : sowError ? (
                  <PanelError message={sowError} onRetry={loadSowOrders} />
                ) : sowOrders.length === 0 ? (
                  <EmptyState
                    icon={PackageOpen}
                    title="No orders"
                    description="No SOW order matches this search."
                  />
                ) : (
                  sowOrders.map((order) => (
                    <SowOrderCard
                      key={order.order_no}
                      order={order}
                      selected={order.order_no === selectedOrder?.order_no}
                      onClick={loadOperations}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setSourceView('orders')}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
                  Back
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-extrabold tabular-nums text-slate-800">
                    {selectedOrder?.order_no || '-'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {selectedOrder?.part_name || selectedOrder?.ssbr_id || '-'}
                  </p>
                </div>
                {operationLoading || mapping ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#00b4d8]" />
                ) : (
                  <span
                    title="Operations already mapped in this project"
                    className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500"
                  >
                    {mappedByOperation.size}/{operations.length}
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-auto bg-slate-50 p-3">
                {operationLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-[76px] w-full rounded-lg" />
                  ))
                ) : operationError ? (
                  <PanelError
                    message={operationError}
                    onRetry={() => loadOperations(selectedOrder)}
                  />
                ) : operations.length === 0 ? (
                  <EmptyState icon={ListTree} title="No operations" />
                ) : (
                  <OperationList
                    operations={operations}
                    mappedByOperation={mappedByOperation}
                    onDragStart={handleOperationDragStart}
                    disabled={mapping}
                  />
                )}
              </div>

              <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
                Drag one operation onto a node. Leaf node = assign, parent node = add as child.
              </p>
            </>
          )}
        </section>

        {}
        <section className="relative flex min-h-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0">
          <div className="border-b border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#0077b6]">
                  Target
                </p>
                <h3 className="text-sm font-extrabold text-slate-800">Project Tasks</h3>
              </div>
              {taskLoading && <Loader2 className="h-4 w-4 animate-spin text-[#00b4d8]" />}
            </div>

            {selectedProject ? (
              <SelectedProjectBox project={selectedProject} onClear={clearProject} />
            ) : (
              <SearchInput
                value={projectSearch}
                onChange={setProjectSearch}
                placeholder="Search project"
              />
            )}
          </div>

          {selectedProject ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {}
              <div className="flex min-h-0 flex-col overflow-hidden border-b border-slate-200 xl:border-b-0 xl:border-r">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#caf0f8] px-3 py-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
                    Project tree
                  </span>
                  <span className="truncate text-xs text-slate-500">
                    Drop an operation on a row
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {}
                  {!taskLoading && !taskError && taskTree.roots.length > 0 && (
                    <div
                      className={`sticky top-0 z-10 grid ${TREE_COLS} items-center gap-2 border-b border-slate-200 bg-white px-2 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500`}
                    >
                      <span>Task</span>
                      <span>Op</span>
                      <span>Workcenter</span>
                      <span>Start</span>
                      <span>Finish</span>
                    </div>
                  )}
                  {taskLoading ? (
                    <div className="space-y-1.5 p-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  ) : taskError ? (
                    <PanelError
                      message={taskError}
                      onRetry={() => loadProjectTasks(selectedProject)}
                    />
                  ) : taskTree.roots.length === 0 ? (
                    <EmptyState icon={ListTree} title="No tasks" />
                  ) : (
                    taskTree.roots.map((task) => (
                      <TaskTreeNode
                        onDropOperation={handleDropOperation}
                        key={task.task_id}
                        task={task}
                        childrenByParent={taskTree.byParent}
                        expandedIds={expandedTaskIds}
                        onToggle={toggleTaskExpand}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
              {projectLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
                ))
              ) : projectError ? (
                <PanelError message={projectError} onRetry={loadProjects} />
              ) : projects.length === 0 ? (
                <EmptyState
                  icon={FolderSearch}
                  title="No projects"
                  description="No MS Project matches this search."
                />
              ) : (
                projects.map((project) => (
                  <ProjectCard
                    key={project.project_id}
                    project={project}
                    selected={false}
                    onClick={loadProjectTasks}
                  />
                ))
              )}
            </div>
          )}
        </section>
      </div>

      <ReplaceDialog
        prompt={replacePrompt}
        busy={mapping}
        onCancel={handleReplaceCancel}
        onConfirm={handleReplaceConfirm}
      />
    </main>
  );
}
