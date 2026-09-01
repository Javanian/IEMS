import React, { useMemo, useState } from 'react';
import { CalendarRange, ChevronRight, MapPin } from 'lucide-react';
import { EmptyState } from '../../../components';
import { bayLabel } from '../../../config/manufacturingAreas';

const LABEL_W = 280;
const HEADER_H = 54;
const BAR_H = 18;
const ROW_PAD_Y = 5;
const DAY_W = 28;
const ROW_H = BAR_H + ROW_PAD_Y * 2;

const META_COLS = [
  { key: 'start', label: 'Start', width: 84 },
  { key: 'finish', label: 'Finish', width: 84 },
  { key: 'duration', label: 'Dur', width: 56 },
  { key: 'area', label: 'Area', width: 108 },
  { key: 'workcenter', label: 'Workcenter', width: 104 },
];
const META_TOTAL_W = META_COLS.reduce((acc, c) => acc + c.width, 0);
const FROZEN_W = LABEL_W + META_TOTAL_W;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PROJECT_BAR = {
  checkedOut: { bg: 'linear-gradient(135deg,#fbbf24,#fcd34d)', fg: '#78350f' },
  active: { bg: 'linear-gradient(135deg,#7dd3fc,#bae6fd)', fg: '#0c4a6e' },
  draft: { bg: 'linear-gradient(135deg,#cbd5e1,#e2e8f0)', fg: '#334155' },
};

function projectBarStyle(project) {
  if (project.checked_out_by) return PROJECT_BAR.checkedOut;
  if (String(project.status || '').toUpperCase() === 'ACTIVE') return PROJECT_BAR.active;
  return PROJECT_BAR.draft;
}

const TASK_BAR = { bg: 'linear-gradient(135deg,#6ee7b7,#a7f3d0)', fg: '#065f46' };

const BOOKING_BADGE = {
  RESERVED: 'border-[#bae6fd] bg-[#e0f2fe] text-[#0369a1]',
  CONFIRMED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DONE: 'border-slate-200 bg-slate-100 text-slate-600',
  CANCELLED: 'border-slate-200 bg-slate-100 text-slate-400 line-through',
};
function bookingBadgeClass(status) {
  return BOOKING_BADGE[String(status || '').toUpperCase()] || BOOKING_BADGE.RESERVED;
}

const RANGE_PRESETS = [
  { key: 'all', label: 'All dates', back: null, fwd: null },
  { key: '1m', label: '1 month', back: 15, fwd: 16 },
  { key: '3m', label: '3 months', back: 46, fwd: 47 },
  { key: '6m', label: '6 months', back: 92, fwd: 93 },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayNumOf(str) {
  if (typeof str !== 'string') return null;
  const t = str.slice(0, 10);
  if (!DATE_RE.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function partsOf(dayNum) {
  const dt = new Date(dayNum * 86400000);
  return { mon: dt.getUTCMonth(), dd: dt.getUTCDate(), wd: dt.getUTCDay() };
}
function todayDayNum() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000);
}
function spanDaysOf(startText, endText) {
  const s = dayNumOf(startText);
  const e = dayNumOf(endText);
  if (s === null || e === null) return null;
  return e - s + 1;
}
function projectDateSpan(tasks = []) {
  let min = null;
  let max = null;
  for (const t of tasks) {
    const s = dayNumOf(t.plan_start);
    const e = dayNumOf(t.plan_finish);
    if (s !== null && (min === null || s < min)) min = s;
    if (e !== null && (max === null || e > max)) max = e;
  }
  return { min, max };
}
function dayTextOf(dayNum) {
  return new Date(dayNum * 86400000).toISOString().slice(0, 10);
}
function formatDateShort(value) {
  if (!value) return '—';
  const t = String(value).slice(0, 10);
  if (!DATE_RE.test(t)) return '—';
  const [, m, d] = t.split('-').map(Number);
  return `${d} ${MONTH[m - 1]}`;
}
function formatDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes % 60 === 0) return `${minutes / 60}d`;
  return `${(minutes / 60).toFixed(1)}d`;
}

const TRACK_GRID_BG = `repeating-linear-gradient(to right, transparent 0 ${DAY_W - 1}px, #eef2f7 ${DAY_W - 1}px ${DAY_W}px)`;
const WEEKEND_BG = 'rgba(100,116,139,0.07)';

function TrackBackdrop({ originNum, numDays, todayNum }) {
  const weekendIdx = [];
  for (let i = 0; i < numDays; i += 1) {
    const { wd } = partsOf(originNum + i);
    if (wd === 0 || wd === 6) weekendIdx.push(i);
  }
  const todayIdx = todayNum - originNum;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{ width: numDays * DAY_W, backgroundImage: TRACK_GRID_BG }}
    >
      {weekendIdx.map((i) => (
        <div
          key={i}
          className="absolute inset-y-0"
          style={{ left: i * DAY_W, width: DAY_W, background: WEEKEND_BG }}
        />
      ))}
      {todayIdx >= 0 && todayIdx < numDays && (
        <div
          className="absolute inset-y-0 z-[1] w-[2px] bg-rose-400/80"
          style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          title="Today"
        />
      )}
    </div>
  );
}

function ScheduleBar({ startText, endText, originNum, style, label }) {
  const s = dayNumOf(startText);
  const e = dayNumOf(endText);
  if (s === null || e === null) return null;
  const startIdx = Math.max(0, s - originNum);
  const endIdx = Math.max(startIdx, e - originNum);
  const left = startIdx * DAY_W + 2;
  const width = (endIdx - startIdx + 1) * DAY_W - 4;
  if (width <= 0) return null;
  return (
    <div
      title={label ? `${label}\n${startText} → ${endText}` : `${startText} → ${endText}`}
      className="absolute flex items-center overflow-hidden rounded-md shadow-sm ring-1 ring-black/5"
      style={{ left, width, top: ROW_PAD_Y, height: BAR_H, background: style.bg, color: style.fg }}
    />
  );
}

function MetaCell({ col, left, children, className = '' }) {
  return (
    <div
      className={`sticky flex shrink-0 items-center overflow-hidden border-r border-slate-100 bg-white px-2 text-[11px] ${className}`}
      style={{ left, width: col.width, minHeight: ROW_H, zIndex: 15 }}
    >
      <span className="truncate">{children}</span>
    </div>
  );
}

function TaskAreaBooking({ booking, onOpenArea }) {
  const zones =
    (Array.isArray(booking?.bay_codes) ? booking.bay_codes : []).map(bayLabel).join(', ') ||
    booking?.area_code ||
    '';
  const span = spanDaysOf(booking?.start_date, booking?.end_date);
  return (
    <button
      type="button"
      onClick={() => onOpenArea(booking.area_code, booking.start_date)}
      title={`${booking.area_name || booking.area_code}: ${booking.start_date} → ${booking.end_date} — open area map`}
      className={`inline-flex min-h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-[10px] font-bold transition hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9] ${bookingBadgeClass(booking.status)}`}
    >
      <MapPin size={10} className="shrink-0" />
      <span className="font-mono tabular-nums">{booking.area_code}</span>
      {zones && <span className="truncate tabular-nums">{zones}</span>}
      <span className="tabular-nums">{span ?? '?'}d</span>
    </button>
  );
}

function TaskMetaCells({ task, booking, onOpenArea }) {
  let left = LABEL_W;
  return META_COLS.map((col) => {
    const cellLeft = left;
    left += col.width;
    let content = '—';
    let cls = 'font-mono tabular-nums text-slate-600';
    if (col.key === 'start') content = formatDateShort(task?.plan_start);
    else if (col.key === 'finish') content = formatDateShort(task?.plan_finish);
    else if (col.key === 'duration') content = formatDurationMinutes(task?.duration_minutes);
    else if (col.key === 'area') {
      content = booking ? <TaskAreaBooking booking={booking} onOpenArea={onOpenArea} /> : '—';
      cls = booking ? '' : 'font-mono tabular-nums text-slate-400';
    } else if (col.key === 'workcenter') {
      content = task?.workcenter || '—';
      cls = 'text-slate-600';
    }
    return (
      <MetaCell key={col.key} col={col} left={cellLeft} className={cls}>
        {content}
      </MetaCell>
    );
  });
}

function ProjectMetaCells({ min, max }) {
  let left = LABEL_W;
  return META_COLS.map((col) => {
    const cellLeft = left;
    left += col.width;
    let content = '—';
    let cls = 'font-mono tabular-nums text-slate-600';
    if (col.key === 'start') content = min !== null ? formatDateShort(dayTextOf(min)) : '—';
    else if (col.key === 'finish') content = max !== null ? formatDateShort(dayTextOf(max)) : '—';
    else if (col.key === 'duration') {
      const span = min !== null && max !== null ? max - min + 1 : null;
      content = span !== null ? `${span}d` : '—';
      cls = 'font-mono tabular-nums font-extrabold text-slate-800';
    } else if (col.key === 'area' || col.key === 'workcenter')
      cls = 'font-mono tabular-nums text-slate-400';
    return (
      <MetaCell key={col.key} col={col} left={cellLeft} className={cls}>
        {content}
      </MetaCell>
    );
  });
}

function TaskNode({
  task,
  childrenMap,
  expandedIds,
  onToggle,
  originNum,
  numDays,
  todayNum,
  taskBookingByTaskId,
  onOpenArea,
  projectStyle,
}) {
  const children = childrenMap.get(task.task_id) || [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(task.task_id);
  const indent = Math.max(0, Number(task.outline_level || 1) - 1) * 16;
  const booking = taskBookingByTaskId.get(task.task_id) || null;
  const trackWidth = numDays * DAY_W;
  return (
    <div>
      <div className="flex bg-white hover:bg-slate-50">
        <div
          className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-slate-100 bg-white pl-2 pr-2"
          style={{ width: LABEL_W, minHeight: ROW_H }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(task.task_id)}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              aria-expanded={isExpanded}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0ea5e9]"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''} motion-reduce:transition-none`}
              />
            </button>
          ) : (
            <span className="ml-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
          )}
          <span style={{ paddingLeft: indent }} className="flex min-w-0 items-center gap-1.5">
            <span
              className={`truncate text-[11px] ${task.is_summary ? 'font-bold text-slate-800' : 'font-medium text-slate-600'}`}
            >
              {task.task_name || '-'}
            </span>
          </span>
        </div>
        <TaskMetaCells task={task} booking={booking} onOpenArea={onOpenArea} />
        <div
          className="relative shrink-0 overflow-hidden"
          style={{ width: trackWidth, height: ROW_H }}
        >
          <TrackBackdrop originNum={originNum} numDays={numDays} todayNum={todayNum} />
          <ScheduleBar
            startText={task.plan_start}
            endText={task.plan_finish}
            originNum={originNum}
            style={task.is_summary ? projectStyle : TASK_BAR}
            label={
              task.is_summary
                ? task.task_name || ''
                : `${task.operation_no || ''} ${task.task_name || ''}`
            }
          />
        </div>
      </div>
      {isExpanded &&
        hasChildren &&
        children.map((child) => (
          <TaskNode
            key={child.task_id}
            task={child}
            childrenMap={childrenMap}
            expandedIds={expandedIds}
            onToggle={onToggle}
            originNum={originNum}
            numDays={numDays}
            todayNum={todayNum}
            taskBookingByTaskId={taskBookingByTaskId}
            onOpenArea={onOpenArea}
            projectStyle={projectStyle}
          />
        ))}
    </div>
  );
}

function ProjectRow({
  project,
  tasks,
  expandedIds,
  onToggle,
  onOpenArea,
  originNum,
  numDays,
  todayNum,
  taskBookingByTaskId,
}) {
  const { min, max } = projectDateSpan(tasks);
  const span = min !== null && max !== null ? spanDaysOf(dayTextOf(min), dayTextOf(max)) : null;
  const style = projectBarStyle(project);
  const trackWidth = numDays * DAY_W;
  const isProjectExpanded = expandedIds.has(project.project_id);

  const childrenMap = useMemo(() => {
    const map = new Map();
    const present = new Set(tasks.map((t) => t.task_id));
    for (const t of tasks) {
      const parent = t.parent_task_id && present.has(t.parent_task_id) ? t.parent_task_id : null;
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent).push(t);
    }
    return map;
  }, [tasks]);

  const roots = childrenMap.get(null) || [];
  return (
    <div>
      {}
      <div className="flex border-b border-slate-100 bg-white hover:bg-slate-50">
        <div
          className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-white pl-1.5 pr-2"
          style={{ width: LABEL_W, minHeight: ROW_H }}
        >
          <button
            type="button"
            onClick={() => onToggle(project.project_id)}
            aria-label={isProjectExpanded ? 'Collapse project' : 'Expand project'}
            aria-expanded={isProjectExpanded}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0ea5e9]"
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${isProjectExpanded ? 'rotate-90' : ''} motion-reduce:transition-none`}
            />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-extrabold text-slate-800">
              {project.project_name || '-'}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold tabular-nums text-slate-500">
                Rev {project.revision_no || 0}
              </span>
              {span !== null && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums text-slate-500">
                  <CalendarRange size={10} /> {span}d
                </span>
              )}
            </div>
          </div>
        </div>
        {}
        <ProjectMetaCells min={min} max={max} />
        <div
          className="relative shrink-0 overflow-hidden"
          style={{ width: trackWidth, height: ROW_H }}
        >
          <TrackBackdrop originNum={originNum} numDays={numDays} todayNum={todayNum} />
          <ScheduleBar
            startText={min !== null ? dayTextOf(min) : null}
            endText={max !== null ? dayTextOf(max) : null}
            originNum={originNum}
            style={style}
            label={project.project_name || ''}
          />
        </div>
      </div>

      {}
      {isProjectExpanded &&
        roots.map((root) => (
          <TaskNode
            key={root.task_id}
            task={root}
            childrenMap={childrenMap}
            expandedIds={expandedIds}
            onToggle={onToggle}
            originNum={originNum}
            numDays={numDays}
            todayNum={todayNum}
            taskBookingByTaskId={taskBookingByTaskId}
            onOpenArea={onOpenArea}
            projectStyle={style}
          />
        ))}
    </div>
  );
}

export default function ProjectScheduleGantt({
  projects,
  tasksByProject,
  bookingsByProject,
  expandedIds,
  onToggle,
  onOpenArea,
  loading,
  error,
  onRetry,
}) {
  const [rangeKey, setRangeKey] = useState('all');

  const window = useMemo(() => {
    let min = null;
    let max = null;
    projects.forEach((p) => {
      const { min: m, max: x } = projectDateSpan(tasksByProject.get(p.project_id) || []);
      if (m !== null && (min === null || m < min)) min = m;
      if (x !== null && (max === null || x > max)) max = x;
    });
    if (min === null || max === null) {
      const today = todayDayNum();
      return { originNum: today - 3, numDays: 7 };
    }
    const preset = RANGE_PRESETS.find((r) => r.key === rangeKey) || RANGE_PRESETS[0];
    if (preset.back !== null && preset.fwd !== null) {
      const today = todayDayNum();
      const lo = Math.max(min, today - preset.back);
      const hi = Math.min(max, today + preset.fwd);
      if (lo <= hi) return { originNum: lo, numDays: hi - lo + 1 };
    }
    return { originNum: min, numDays: max - min + 1 };
  }, [projects, tasksByProject, rangeKey]);

  const taskBookingByTaskId = useMemo(() => {
    const map = new Map();
    bookingsByProject.forEach((bookings) => {
      for (const b of bookings) {
        if (!b.task_id || !b.area_code) continue;
        if (map.has(b.task_id)) continue;
        map.set(b.task_id, b);
      }
    });
    return map;
  }, [bookingsByProject]);

  const { originNum, numDays } = window;
  const todayNum = todayDayNum();

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#0369a1]">
            Portfolio Schedule
          </p>
          <h2 className="truncate text-sm font-extrabold text-slate-800">
            {projects.length} project{projects.length === 1 ? '' : 's'} · {numDays} days
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Range
          </span>
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {RANGE_PRESETS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9] ${
                  rangeKey === r.key
                    ? 'bg-[#e0f2fe] text-[#0369a1]'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center py-16 text-sm text-slate-400">
            Loading schedule…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <p className="text-xs font-semibold text-red-600">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9]"
            >
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState icon={CalendarRange} title="No projects yet" />
        ) : (
          <div className="inline-block min-w-full align-top">
            {}
            <div
              className="sticky top-0 z-30 flex border-b border-slate-200 bg-white"
              style={{ height: HEADER_H }}
            >
              <div
                className="sticky left-0 z-40 flex shrink-0 items-end border-r border-slate-200 bg-white px-3 pb-1"
                style={{ width: LABEL_W }}
              >
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Project / Task
                </span>
              </div>
              {META_COLS.map((col, index) => {
                const left =
                  LABEL_W + META_COLS.slice(0, index).reduce((acc, c) => acc + c.width, 0);
                return (
                  <div
                    key={col.key}
                    className="sticky flex shrink-0 items-end border-r border-slate-100 bg-white px-2 pb-1"
                    style={{ left, width: col.width, zIndex: 35 }}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      {col.label}
                    </span>
                  </div>
                );
              })}
              <div className="relative flex shrink-0" style={{ width: numDays * DAY_W }}>
                {Array.from({ length: numDays }, (_, i) => {
                  const dn = originNum + i;
                  const { mon, dd, wd } = partsOf(dn);
                  const isToday = dn === todayNum;
                  const monthStart = dd === 1 || i === 0;
                  const isWeekend = wd === 0 || wd === 6;
                  return (
                    <div
                      key={i}
                      className="flex shrink-0 flex-col items-center justify-center border-r border-slate-100"
                      style={{ width: DAY_W, background: isWeekend ? WEEKEND_BG : undefined }}
                    >
                      <span className="text-[9px] font-bold text-slate-400">
                        {monthStart ? MONTH[mon] : ''}
                      </span>
                      <span
                        className={`text-[10px] font-extrabold tabular-nums ${isToday ? 'text-rose-500' : isWeekend ? 'text-slate-400' : 'text-slate-600'}`}
                      >
                        {dd}
                      </span>
                      <span className="text-[8px] font-semibold uppercase text-slate-300">
                        {WEEKDAY[wd]}
                      </span>
                    </div>
                  );
                })}
                {}
                {todayNum >= originNum && todayNum < originNum + numDays && (
                  <div
                    className="absolute inset-y-0 z-[2] w-[2px] bg-rose-400/80"
                    style={{ left: (todayNum - originNum) * DAY_W + DAY_W / 2 }}
                  />
                )}
              </div>
            </div>

            {}
            {projects.map((project) => (
              <ProjectRow
                key={project.project_id}
                project={project}
                tasks={tasksByProject.get(project.project_id) || []}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onOpenArea={onOpenArea}
                originNum={originNum}
                numDays={numDays}
                todayNum={todayNum}
                taskBookingByTaskId={taskBookingByTaskId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
