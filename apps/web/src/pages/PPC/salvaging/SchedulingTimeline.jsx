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
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Moon,
  RotateCcw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchSchedules,
  fetchOvertime,
  fetchCapacity,
  rescheduleSchedule,
  reorderSchedule,
} from '../../../services/sowScheduleService';

const LABEL_W = 268;
const HEADER_H = 44;
const MACHINE_H = 34;
const ROW_H = 30;
const BAR_H = 20;
const MIN_BAR_PX = 8;
const DEFAULT_PX_PER_MIN = 1.0;

const STATUS_LABEL = {
  PLANNED: 'Planned',
  PARTIAL: 'Partial (sebagian over)',
  UNPLANNED: 'Unplanned',
};
const OT_STYLE = { bg: '#f59e0b', text: '#ffffff' };

const ORDER_COLORS = [
  '#0077b6',
  '#2a9d8f',
  '#4059ad',
  '#3d8361',
  '#5c7a99',
  '#0e7490',
  '#5661b3',
  '#3a7ca5',
];
function hashStr(s) {
  let h = 0;
  const t = String(s);
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h;
}
function colorForOrder(order) {
  return ORDER_COLORS[hashStr(order) % ORDER_COLORS.length];
}
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const SHIFT_TINTS = [
  'rgba(0,150,199,0.07)',
  'rgba(124,58,237,0.07)',
  'rgba(5,150,105,0.07)',
  'rgba(217,119,6,0.07)',
];

function ymd(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}
function dayNumberOf(dateStr) {
  const { y, m, d } = ymd(dateStr);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function addDaysStr(dateStr, n) {
  const { y, m, d } = ymd(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function todayText() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
function timeToMin(t) {
  const m = String(t || '0:0').match(/(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : 0;
}
function parseDateTime(v) {
  if (!v) return null;
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    dayNum: Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000),
    minOfDay: +m[4] * 60 + +m[5],
  };
}
function asNumber(v, f = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}
function formatHours(v) {
  return asNumber(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
function minToClock(min) {
  const n = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function shiftSpanMin(shift) {
  const s = timeToMin(shift.start_time);
  let e = timeToMin(shift.end_time);
  if (shift.crosses_midnight || e <= s) e += 1440;
  return e - s;
}
const WEEKDAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
function weekdayOf(dateStr) {
  const { y, m, d } = ymd(dateStr);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function slotKey(machine, date, shiftId) {
  return `${machine}|${String(date).slice(0, 10)}|${shiftId}`;
}

function GanttBar({ bar, pxPerMin, onOpen }) {
  const draggable = bar.draggable;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bar-${bar.uid}`,
    data: { bar },
    disabled: !draggable,
  });
  const isOt = bar.kind === 'overtime';
  const fill = isOt ? OT_STYLE.bg : bar.color;
  const width = Math.max(MIN_BAR_PX, bar.durMin * pxPerMin);
  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(bar)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(bar);
      }}
      title={`#${bar.queue ?? '-'} · Op ${bar.operation_no ?? '-'} · ${bar.order_no}\n${bar.startClock}–${bar.endClock} · ${formatHours(bar.hours)}h${isOt ? ' (OT)' : ''}`}
      className={`absolute flex items-center gap-1 overflow-hidden rounded-md pr-1 text-white shadow-sm ring-1 ring-black/10 transition ${isDragging ? 'opacity-40' : 'hover:brightness-110'}`}
      style={{
        left: bar.leftPx,
        width,
        top: (ROW_H - BAR_H) / 2,
        height: BAR_H,
        background: isOt
          ? 'repeating-linear-gradient(45deg,#f59e0b,#f59e0b 5px,#d97706 5px,#d97706 10px)'
          : fill,
        cursor: draggable ? 'grab' : 'pointer',
        touchAction: 'none',
      }}
    >
      {bar.queue != null && (
        <span className="flex h-full shrink-0 items-center bg-black/20 px-1 text-[9px] font-extrabold leading-none">
          {bar.queue}
        </span>
      )}
      {bar.batch_id && <Layers className="h-2.5 w-2.5 shrink-0 opacity-95" />}
      {width > 54 && (
        <span className="truncate text-[9px] font-bold tabular-nums">
          {bar.startClock}
          {width > 112 ? `–${bar.endClock}` : ''}
        </span>
      )}
      {bar.status === 'PARTIAL' && (
        <span
          className="absolute inset-y-0 right-0 w-1.5"
          style={{
            background:
              'repeating-linear-gradient(45deg,#fde047,#fde047 3px,#f59e0b 3px,#f59e0b 6px)',
          }}
        />
      )}
      {bar.crossesMidnight && <Moon className="ml-auto h-2.5 w-2.5 shrink-0 opacity-95" />}
    </div>
  );
}

function ShiftCell({ id, leftPx, width, tinted, tint }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="absolute top-0 bottom-0 border-r border-slate-200 transition-colors"
      style={{
        left: leftPx,
        width,
        background: isOver ? 'rgba(0,150,199,0.2)' : tinted ? 'rgba(239,68,68,0.12)' : tint,
        boxShadow: `inset 3px 0 0 ${isOver ? 'rgba(0,119,182,0.5)' : 'rgba(148,163,184,0.35)'}`,
      }}
    />
  );
}

function SchedulingTimeline({ machines = [], shifts = [] }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 5 } })
  );
  const [rangeStart, setRangeStart] = useState(todayText);
  const [rangeDays, setRangeDays] = useState(3);
  const [pxPerMin, setPxPerMin] = useState(DEFAULT_PX_PER_MIN);
  const [machineSearch, setMachineSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [schedules, setSchedules] = useState([]);
  const [overtime, setOvertime] = useState([]);
  const [capMap, setCapMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [detail, setDetail] = useState(null);
  const scrollRef = useRef(null);

  const rangeEnd = useMemo(() => addDaysStr(rangeStart, rangeDays - 1), [rangeStart, rangeDays]);
  const originDay = useMemo(() => dayNumberOf(rangeStart), [rangeStart]);
  const totalMin = rangeDays * 1440;
  const boardWidth = totalMin * pxPerMin;

  const activeShifts = useMemo(
    () =>
      shifts
        .filter((s) => s.is_active !== false)
        .slice()
        .sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time)),
    [shifts]
  );
  const shiftById = useMemo(() => new Map(shifts.map((s) => [String(s.id), s])), [shifts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = Array.from({ length: rangeDays }, (_, i) => addDaysStr(rangeStart, i));
      const [sc, ot, ...caps] = await Promise.all([
        fetchSchedules({ date_from: rangeStart, date_to: rangeEnd, limit: 1000 }),
        fetchOvertime({ date_from: rangeStart, date_to: rangeEnd, limit: 1000 }),
        ...days.map((d) => fetchCapacity({ date: d })),
      ]);
      setSchedules(
        (sc.data || []).filter(
          (r) => r.schedule_status !== 'CANCELLED' && r.schedule_status !== 'UNPLANNED'
        )
      );
      setOvertime(
        (ot || []).filter(
          (r) => r.request_status !== 'CANCELLED' && r.request_status !== 'REJECTED'
        )
      );
      const cm = {};
      caps.flat().forEach((r) => {
        cm[slotKey(r.machine_code, r.schedule_date, r.shift_id)] = asNumber(
          r.total_capacity_hours,
          asNumber(r.base_capacity_hours, 8)
        );
      });
      setCapMap(cm);
    } catch (err) {
      setError(err.message || 'Gagal memuat timeline');
      toast.error('Gagal memuat timeline', { description: err.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  const startAbs = useCallback(
    (r) => {
      const p = parseDateTime(r.planned_start_datetime);
      const schedDay = dayNumberOf(r.schedule_date);
      if (p && p.dayNum === schedDay) return (p.dayNum - originDay) * 1440 + p.minOfDay;
      const shift = shiftById.get(String(r.shift_id));
      if (!shift) return null;
      return (schedDay - originDay) * 1440 + timeToMin(shift.start_time);
    },
    [originDay, shiftById]
  );

  const { groups, slotUsed } = useMemo(() => {
    const nameMatch = machineSearch.trim().toLowerCase();
    const machineList = machines.filter(
      (m) =>
        m.machine_code &&
        (!nameMatch ||
          [m.machine_code, m.machine_name, m.workcenter, m.groupname].some((v) =>
            String(v || '')
              .toLowerCase()
              .includes(nameMatch)
          ))
    );

    const schedByMachine = {};
    const otByMachine = {};
    schedules.forEach((r) => {
      (schedByMachine[r.machine_code] ||= []).push(r);
    });
    overtime.forEach((r) => {
      (otByMachine[r.machine_code] ||= []).push(r);
    });

    const used = {};
    const seenBatch = new Set();
    schedules.forEach((r) => {
      const k = slotKey(r.machine_code, r.schedule_date, r.shift_id);
      if (r.batch_id) {
        const bk = `${k}|${r.batch_id}`;
        if (!seenBatch.has(bk)) {
          seenBatch.add(bk);
          used[k] = (used[k] || 0) + asNumber(r.batch_capacity_hours);
        }
      } else {
        used[k] = (used[k] || 0) + asNumber(r.planned_hours);
      }
    });

    const barOfSchedule = (r) => {
      const s = startAbs(r);
      if (s == null || s < 0 || s > totalMin) return null;
      const durMin = asNumber(r.planned_hours) * 60;
      const orderNo = r.production_order || '—';
      return {
        uid: `s${r.id}`,
        id: r.id,
        kind: 'schedule',
        order_no: orderNo,
        color: colorForOrder(orderNo),
        operation_no: r.operation_no,
        operation_text: r.operation_text,
        part_name: r.part_name,
        ssbr_id: r.ssbr_id,
        status: r.schedule_status,
        hours: asNumber(r.planned_hours),
        queue: r.planned_queue_no != null ? Number(r.planned_queue_no) : null,
        leftPx: s * pxPerMin,
        durMin,
        startAbs: s,
        endAbs: s + durMin,
        startClock: minToClock(s),
        endClock: minToClock(s + durMin),
        crossesMidnight: Math.floor(s / 1440) !== Math.floor((s + durMin - 1) / 1440),
        machine: r.machine_code,
        date: String(r.schedule_date).slice(0, 10),
        shiftId: String(r.shift_id),
        shift_name: shiftById.get(String(r.shift_id))?.shift_name,
        batch_id: r.batch_id,
        batch_code: r.batch_code,
        remarks: r.remarks,
        draggable: !r.is_overtime,
      };
    };

    const built = machineList.map((m) => {
      const orderMap = {};
      (schedByMachine[m.machine_code] || []).forEach((r) => {
        const bar = barOfSchedule(r);
        if (!bar) return;
        const ok = bar.order_no;
        orderMap[ok] ||= { order_no: ok, part_name: r.part_name, ssbr_id: r.ssbr_id, ops: {} };
        const opk = String(r.operation_no);
        orderMap[ok].ops[opk] ||= {
          key: opk,
          operation_no: r.operation_no,
          operation_text: r.operation_text,
          ssbr_id: r.ssbr_id,
          part_name: r.part_name,
          bars: [],
        };
        orderMap[ok].ops[opk].bars.push(bar);
      });
      (otByMachine[m.machine_code] || []).forEach((o) => {
        const p = parseDateTime(o.overtime_start_datetime);
        if (!p) return;
        const s = (p.dayNum - originDay) * 1440 + p.minOfDay;
        if (s < 0 || s > totalMin) return;
        const durMin = asNumber(o.overtime_hours) * 60;
        const bar = {
          uid: `o${o.id}`,
          id: o.id,
          kind: 'overtime',
          order_no: o.production_order || '—',
          operation_no: o.operation_no,
          hours: asNumber(o.overtime_hours),
          leftPx: s * pxPerMin,
          durMin,
          startAbs: s,
          endAbs: s + durMin,
          status: String(o.request_status || '').toUpperCase(),
          startClock: minToClock(s),
          endClock: minToClock(s + durMin),
          ssbr_id: o.ssbr_id,
          note: o.note,
          machine: o.machine_code,
          draggable: false,
          crossesMidnight: Math.floor(s / 1440) !== Math.floor((s + durMin - 1) / 1440),
        };
        const ok = bar.order_no;
        orderMap[ok] ||= { order_no: ok, ops: {} };
        const opk = String(o.operation_no ?? 'OT');
        orderMap[ok].ops[opk] ||= {
          key: opk,
          operation_no: o.operation_no,
          operation_text: 'Overtime',
          bars: [],
        };
        orderMap[ok].ops[opk].bars.push(bar);
      });

      const orders = Object.values(orderMap)
        .map((o) => {
          const ops = Object.values(o.ops).sort(
            (a, b) => asNumber(a.operation_no) - asNumber(b.operation_no)
          );
          const allBars = ops.flatMap((op) => op.bars);
          const extent = allBars.length
            ? {
                start: Math.min(...allBars.map((b) => b.startAbs)),
                end: Math.max(...allBars.map((b) => b.endAbs)),
              }
            : null;
          const hours = allBars
            .filter((b) => b.kind === 'schedule')
            .reduce((s, b) => s + b.hours, 0);
          return { ...o, ops, extent, hours, color: colorForOrder(o.order_no) };
        })
        .sort((a, b) => String(a.order_no).localeCompare(String(b.order_no)));

      const opCount = orders.reduce((s, o) => s + o.ops.length, 0);
      const totalHours = orders.reduce((s, o) => s + o.hours, 0);
      return { machine: m, orders, opCount, orderCount: orders.length, totalHours };
    });

    const filtered = showAll ? built : built.filter((g) => g.orderCount > 0);
    return { groups: filtered, slotUsed: used };
  }, [
    machines,
    machineSearch,
    schedules,
    overtime,
    showAll,
    startAbs,
    shiftById,
    originDay,
    pxPerMin,
    totalMin,
  ]);

  const overCapSlots = useMemo(() => {
    const set = new Set();
    Object.entries(slotUsed).forEach(([key, u]) => {
      const cap = capMap[key];
      if (cap != null && u > cap + 1e-6) set.add(key);
    });
    return set;
  }, [slotUsed, capMap]);

  const insights = useMemo(() => {
    const plannedH = schedules.reduce((s, r) => s + asNumber(r.planned_hours), 0);
    const pendOtH = overtime
      .filter((r) => String(r.request_status).toUpperCase() === 'PENDING')
      .reduce((s, r) => s + asNumber(r.overtime_hours), 0);
    let crossMidnight = 0;
    groups.forEach((g) =>
      g.orders.forEach((o) =>
        o.ops.forEach((op) =>
          op.bars.forEach((b) => {
            if (b.crossesMidnight) crossMidnight += 1;
          })
        )
      )
    );
    return {
      plannedH,
      pendOtH,
      overCap: overCapSlots.size,
      machines: groups.length,
      crossMidnight,
    };
  }, [schedules, overtime, groups, overCapSlots]);

  const handleDragStart = ({ active }) => setActiveDrag(active.data?.current?.bar || null);
  const handleDragEnd = async ({ active, over }) => {
    const bar = active.data?.current?.bar;
    setActiveDrag(null);
    if (!bar || !over?.id) return;
    const [type, machine, date, shiftId] = String(over.id).split('|');
    if (type !== 'cell') return;
    if (machine === bar.machine && date === bar.date && String(shiftId) === String(bar.shiftId))
      return;
    const prev = schedules;
    setSchedules((list) =>
      list.map((r) =>
        r.id === bar.id
          ? {
              ...r,
              machine_code: machine,
              schedule_date: date,
              shift_id: Number(shiftId),
              batch_id: null,
              planned_start_datetime: null,
            }
          : r
      )
    );
    setSaving(true);
    try {
      await rescheduleSchedule(bar.id, {
        machine_code: machine,
        schedule_date: date,
        shift_id: Number(shiftId),
      });
      toast.success('Jadwal dipindahkan', {
        description: `${bar.order_no} → ${machine} · ${date}`,
      });
      await load();
    } catch (err) {
      setSchedules(prev);
      toast.error('Gagal memindahkan jadwal', { description: err.message || 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleReorder = useCallback(
    async (bar, direction) => {
      if (!bar?.id) return;
      setSaving(true);
      try {
        const res = await reorderSchedule(bar.id, direction);
        if (res?.changed === false) {
          toast.info(direction === 'up' ? 'Sudah paling awal' : 'Sudah paling akhir');
          return;
        }
        toast.success(direction === 'up' ? 'Prioritas dinaikkan' : 'Prioritas diturunkan');
        const updated = (res?.data || []).find((r) => Number(r.id) === Number(bar.id));
        if (updated)
          setDetail((d) =>
            d && d.id === bar.id ? { ...d, queue: Number(updated.planned_queue_no) } : d
          );
        await load();
      } catch (err) {
        toast.error('Gagal mengubah prioritas', { description: err.message || 'Failed' });
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  const shiftedRange = (delta) => setRangeStart((prev) => addDaysStr(prev, delta * rangeDays));
  const toggleCollapse = (code) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });

  const nowAbs = useMemo(() => {
    const now = new Date();
    const todayNum = dayNumberOf(todayText());
    if (todayNum < originDay || todayNum >= originDay + rangeDays) return null;
    return (todayNum - originDay) * 1440 + now.getHours() * 60 + now.getMinutes();
  }, [originDay, rangeDays]);
  const weekendDays = useMemo(
    () =>
      Array.from({ length: rangeDays }, (_, i) => {
        const dStr = addDaysStr(rangeStart, i);
        const wd = weekdayOf(dStr);
        return wd === 'Sab' || wd === 'Min' ? i : -1;
      }).filter((i) => i >= 0),
    [rangeStart, rangeDays]
  );

  const hourPx = 60 * pxPerMin;
  const gridBg = `repeating-linear-gradient(to right, transparent 0, transparent ${hourPx - 1}px, rgba(148,163,184,0.16) ${hourPx - 1}px, rgba(148,163,184,0.16) ${hourPx}px)`;

  const renderCells = (machineCode) =>
    Array.from({ length: rangeDays }, (_, di) => {
      const dStr = addDaysStr(rangeStart, di);
      return activeShifts.map((s, si) => {
        const left = (di * 1440 + timeToMin(s.start_time)) * pxPerMin;
        const width = shiftSpanMin(s) * pxPerMin;
        const key = slotKey(machineCode, dStr, s.id);
        return (
          <ShiftCell
            key={`${dStr}-${s.id}`}
            id={`cell|${machineCode}|${dStr}|${s.id}`}
            leftPx={left}
            width={width}
            tinted={overCapSlots.has(key)}
            tint={SHIFT_TINTS[si % SHIFT_TINTS.length]}
          />
        );
      });
    });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftedRange(-1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => shiftedRange(1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <input
          type="date"
          value={rangeStart}
          onChange={(e) => setRangeStart(e.target.value || todayText())}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
        />
        <button
          onClick={() => setRangeStart(todayText())}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Hari ini
        </button>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {[3, 7, 14].map((d) => (
            <button
              key={d}
              onClick={() => setRangeDays(d)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-extrabold ${rangeDays === d ? 'bg-[#0096c7] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {d}h
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => setPxPerMin((v) => Math.max(0.3, +(v - 0.2).toFixed(2)))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-50"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPxPerMin((v) => Math.min(3, +(v + 0.2).toFixed(2)))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-50"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => setShowAll((v) => !v)}
          title="Tampilkan mesin tanpa jadwal"
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition ${showAll ? 'border-[#0096c7] bg-[#e8f7fc] text-[#0077b6]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          {showAll ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}Semua
          mesin
        </button>
        <label className="ml-auto flex h-9 min-w-[150px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={machineSearch}
            onChange={(e) => setMachineSearch(e.target.value)}
            placeholder="Cari mesin..."
            className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
          />
        </label>
        {(loading || saving) && <Loader2 className="h-5 w-5 animate-spin text-[#0096c7]" />}
      </div>

      {}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Chip label="Total plan" value={`${formatHours(insights.plannedH)}h`} />
        <Chip
          label="OT pending"
          value={`${formatHours(insights.pendOtH)}h`}
          tone={insights.pendOtH > 0 ? 'amber' : 'slate'}
        />
        <Chip
          label="Slot over-kapasitas"
          value={insights.overCap}
          tone={insights.overCap > 0 ? 'red' : 'slate'}
        />
        <Chip label="Mesin bermuatan" value={insights.machines} />
        <Chip
          label="Lintas tengah malam"
          value={insights.crossMidnight}
          tone={insights.crossMidnight > 0 ? 'amber' : 'slate'}
        />
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <span className="inline-flex items-center gap-1 text-slate-500">
          <span className="inline-flex">
            <span
              className="inline-block h-3 w-3 rounded-l-sm"
              style={{ background: ORDER_COLORS[0] }}
            />
            <span className="inline-block h-3 w-3" style={{ background: ORDER_COLORS[1] }} />
            <span
              className="inline-block h-3 w-3 rounded-r-sm"
              style={{ background: ORDER_COLORS[3] }}
            />
          </span>{' '}
          Warna = per order
        </span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{
              background:
                'repeating-linear-gradient(45deg,#f59e0b,#f59e0b 3px,#d97706 3px,#d97706 6px)',
            }}
          />{' '}
          Overtime
        </span>
        <Legend
          swatch="repeating-linear-gradient(45deg,#fde047,#fde047 3px,#f59e0b 3px,#f59e0b 6px)"
          text="Partial"
        />
        <span className="inline-flex items-center gap-1 text-slate-500">
          <Layers className="h-3 w-3" /> Batch
        </span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: 'rgba(239,68,68,0.2)' }}
          />{' '}
          Over-cap
        </span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <span className="inline-block h-3 w-0.5 bg-red-500" /> Sekarang
        </span>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </span>
          <button
            onClick={load}
            className="rounded-lg border border-red-300 bg-white px-3 py-1 text-red-700 hover:bg-red-100"
          >
            Coba lagi
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        modifiers={[restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveDrag(null)}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 bg-white shadow-sm"
        >
          <div className="relative" style={{ width: LABEL_W + boardWidth, minWidth: '100%' }}>
            {}
            <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
              <div
                className="sticky left-0 z-40 flex shrink-0 items-center border-b border-r border-slate-200 bg-slate-50 px-3 text-xs font-extrabold uppercase text-slate-500"
                style={{ width: LABEL_W }}
              >
                Mesin · Order · Operasi
              </div>
              <div className="relative bg-slate-50" style={{ width: boardWidth }}>
                {Array.from({ length: rangeDays }, (_, i) => {
                  const dStr = addDaysStr(rangeStart, i);
                  return (
                    <div
                      key={dStr}
                      className="absolute top-0 bottom-0 border-r border-slate-200"
                      style={{ left: i * 1440 * pxPerMin, width: 1440 * pxPerMin }}
                    >
                      <div className="flex items-center gap-1.5 px-2 pt-1 text-[11px] font-extrabold text-slate-700">
                        {weekdayOf(dStr)}{' '}
                        <span className="font-mono text-slate-500">{dStr.slice(5)}</span>
                      </div>
                      <div className="relative text-[9px] font-semibold text-slate-400">
                        {[6, 12, 18].map((h) => (
                          <span key={h} className="absolute" style={{ left: h * 60 * pxPerMin }}>
                            {String(h).padStart(2, '0')}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {}
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.machine.machine_code);
              const bodyH = isCollapsed
                ? 0
                : g.orders.reduce((s, o) => s + ROW_H + o.ops.length * ROW_H, 0);
              const groupH = MACHINE_H + bodyH;
              return (
                <div key={g.machine.machine_code} className="flex border-b-2 border-slate-300">
                  {}
                  <div
                    className="sticky left-0 z-20 shrink-0 border-r-2 border-slate-300 bg-white"
                    style={{ width: LABEL_W }}
                  >
                    <button
                      onClick={() => toggleCollapse(g.machine.machine_code)}
                      className="flex w-full items-center gap-1.5 border-b border-slate-200 px-2 text-left text-white hover:brightness-95"
                      style={{
                        height: MACHINE_H,
                        background: 'linear-gradient(135deg,#023e8a,#0077b6)',
                      }}
                    >
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-white/80 transition ${isCollapsed ? '-rotate-90' : ''}`}
                      />
                      <span className="truncate text-sm font-extrabold">
                        {g.machine.machine_code}
                      </span>
                      <span className="ml-auto shrink-0 rounded-full bg-white/20 px-1.5 text-[10px] font-extrabold">
                        {g.orderCount} order · {formatHours(g.totalHours)}h
                      </span>
                    </button>
                    {!isCollapsed &&
                      g.orders.map((o) => (
                        <div key={o.order_no} style={{ borderLeft: `4px solid ${o.color}` }}>
                          <div
                            className="flex items-center gap-1 border-b border-slate-200 pl-2 pr-2"
                            style={{ height: ROW_H, background: hexA(o.color, 0.1) }}
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: o.color }}
                            />
                            <span className="truncate font-mono text-[11px] font-extrabold text-slate-800">
                              {o.order_no}
                            </span>
                            {o.part_name && (
                              <span className="truncate text-[10px] font-semibold text-slate-500">
                                · {o.part_name}
                              </span>
                            )}
                            {o.ssbr_id && (
                              <span className="ml-auto shrink-0 truncate text-[9px] font-bold text-slate-500">
                                {o.ssbr_id}
                              </span>
                            )}
                          </div>
                          {o.ops.map((op) => {
                            const primary = op.bars[0];
                            const canReorder =
                              primary && primary.kind === 'schedule' && primary.draggable;
                            return (
                              <div
                                key={op.key}
                                className="group/op flex items-center gap-1.5 border-b border-slate-100 pl-3 pr-1"
                                style={{ height: ROW_H }}
                              >
                                <span
                                  className="flex h-4 min-w-[22px] shrink-0 items-center justify-center rounded px-1 text-[9px] font-extrabold text-white"
                                  style={{
                                    background: op.operation_no != null ? o.color : '#f59e0b',
                                  }}
                                >
                                  {op.operation_no ?? 'OT'}
                                </span>
                                <span className="truncate text-[10px] font-semibold text-slate-700">
                                  {op.operation_text || '-'}
                                </span>
                                {primary && (
                                  <span
                                    className={`ml-auto shrink-0 font-mono text-[9px] font-bold tabular-nums text-slate-400 ${canReorder ? 'group-hover/op:hidden' : ''}`}
                                  >
                                    {primary.startClock}
                                  </span>
                                )}
                                {canReorder && (
                                  <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover/op:flex">
                                    <button
                                      onClick={() => handleReorder(primary, 'up')}
                                      title="Jadikan lebih dulu"
                                      className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-[#0096c7] hover:text-white"
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleReorder(primary, 'down')}
                                      title="Jadikan lebih akhir"
                                      className="flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-[#0096c7] hover:text-white"
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </button>
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>

                  {}
                  <div
                    className="relative"
                    style={{ width: boardWidth, height: groupH, background: gridBg }}
                  >
                    {}
                    {weekendDays.map((di) => (
                      <div
                        key={`we${di}`}
                        className="absolute top-0 bottom-0 z-0"
                        style={{
                          left: di * 1440 * pxPerMin,
                          width: 1440 * pxPerMin,
                          background: 'rgba(251,191,36,0.06)',
                        }}
                      />
                    ))}
                    {}
                    <div className="absolute inset-0 z-0">
                      {renderCells(g.machine.machine_code)}
                    </div>
                    {}
                    {Array.from({ length: rangeDays + 1 }, (_, i) => (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 z-0 border-l-2 border-slate-300"
                        style={{ left: i * 1440 * pxPerMin }}
                      />
                    ))}
                    {}
                    {nowAbs != null && (
                      <div
                        className="absolute top-0 bottom-0 z-20 w-0.5 bg-red-500"
                        style={{ left: nowAbs * pxPerMin }}
                      />
                    )}
                    {}
                    <div className="relative z-10">
                      <div style={{ height: MACHINE_H }} />
                      {!isCollapsed &&
                        g.orders.map((o) => (
                          <div key={o.order_no}>
                            <div
                              className="relative border-b border-slate-200"
                              style={{ height: ROW_H, background: hexA(o.color, 0.04) }}
                            >
                              {o.extent && (
                                <div
                                  className="absolute rounded-full"
                                  title={`${o.order_no} · ${formatHours(o.hours)}h`}
                                  style={{
                                    left: o.extent.start * pxPerMin,
                                    width: Math.max(4, (o.extent.end - o.extent.start) * pxPerMin),
                                    top: (ROW_H - 5) / 2,
                                    height: 5,
                                    background: hexA(o.color, 0.55),
                                  }}
                                />
                              )}
                            </div>
                            {o.ops.map((op) => (
                              <div
                                key={op.key}
                                className="relative border-b border-slate-100"
                                style={{ height: ROW_H }}
                              >
                                {op.bars.map((bar) => (
                                  <GanttBar
                                    key={bar.uid}
                                    bar={bar}
                                    pxPerMin={pxPerMin}
                                    onOpen={setDetail}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {groups.length === 0 && (
              <div className="p-10 text-center text-sm font-semibold text-slate-400">
                {loading
                  ? 'Memuat…'
                  : showAll
                    ? 'Tidak ada mesin.'
                    : 'Tidak ada jadwal pada rentang ini. Aktifkan "Semua mesin" untuk melihat mesin kosong.'}
              </div>
            )}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDrag && (
            <div
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold text-white shadow-xl"
              style={{ background: activeDrag.color || '#0077b6' }}
            >
              Op {activeDrag.operation_no} · {activeDrag.order_no} · {formatHours(activeDrag.hours)}
              h
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {detail && (
        <DetailPanel
          detail={detail}
          saving={saving}
          onClose={() => setDetail(null)}
          onReorder={handleReorder}
        />
      )}
    </div>
  );
}

function Chip({ label, value, tone = 'slate' }) {
  const map = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-bold ${map[tone]}`}
    >
      <span className="uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-sm font-extrabold">{value}</span>
    </span>
  );
}

function Legend({ swatch, text }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: swatch }} />
      {text}
    </span>
  );
}

function DetailPanel({ detail, saving, onClose, onReorder }) {
  const isOt = detail.kind === 'overtime';
  const headBg = isOt ? '#d97706' : detail.color || '#0077b6';
  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl">
      <div
        className="flex items-start justify-between px-4 py-3 text-white"
        style={{ background: headBg }}
      >
        <div>
          <p className="text-[11px] font-bold uppercase opacity-90">
            {isOt ? 'Overtime' : 'Jadwal Operasi'}
          </p>
          <h3 className="mt-0.5 font-mono text-lg font-extrabold">{detail.order_no || '-'}</h3>
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 text-white hover:bg-white/30"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!isOt && detail.draggable && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-[11px] font-bold uppercase text-slate-500">
            Prioritas dalam shift{' '}
            {detail.queue != null && (
              <span className="text-slate-700">· urutan #{detail.queue}</span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={() => onReorder(detail, 'up')}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] px-3 py-2 text-xs font-bold text-white hover:bg-[#0077b6] disabled:opacity-50"
            >
              <ArrowUpNarrowWide className="h-4 w-4" />
              Lebih dulu
            </button>
            <button
              disabled={saving}
              onClick={() => onReorder(detail, 'down')}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <ArrowDownWideNarrow className="h-4 w-4" />
              Lebih akhir
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <Row k="Operasi" v={detail.operation_no ?? '-'} />
        {detail.operation_text && <Row k="Deskripsi" v={detail.operation_text} />}
        {detail.ssbr_id && <Row k="SSBR" v={detail.ssbr_id} />}
        {detail.part_name && <Row k="Part" v={detail.part_name} />}
        {detail.startAbs != null && (
          <Row
            k="Waktu"
            v={`${minToClock(detail.startAbs)} – ${minToClock(detail.startAbs + detail.durMin)}`}
          />
        )}
        <Row k="Durasi" v={`${formatHours(detail.hours)} jam`} />
        {detail.machine && <Row k="Mesin" v={detail.machine} />}
        {detail.shift_name && <Row k="Shift" v={detail.shift_name} />}
        {detail.date && <Row k="Tanggal" v={String(detail.date).slice(0, 10)} />}
        {detail.queue != null && <Row k="Urutan prioritas" v={`#${detail.queue}`} />}
        <Row
          k="Status"
          v={STATUS_LABEL[detail.status] || detail.status || (isOt ? 'Overtime' : '-')}
        />
        {detail.batch_id && <Row k="Batch" v={detail.batch_code || `#${detail.batch_id}`} />}
        {detail.crossesMidnight && <Row k="Lintas tengah malam" v="Ya — satu blok kontinu" />}
        {detail.remarks && <Row k="Catatan" v={detail.remarks} />}
        {detail.note && <Row k="Catatan OT" v={detail.note} />}
        {!isOt && detail.draggable && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
            Seret bar ke pita hari/shift mesin lain untuk menjadwal ulang. Rencana tidak menimpa
            aktual.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
      <span className="shrink-0 text-[11px] font-bold uppercase text-slate-400">{k}</span>
      <span className="text-right font-semibold text-slate-800">{v}</span>
    </div>
  );
}

export default SchedulingTimeline;
