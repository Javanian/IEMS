import React, { useMemo } from 'react';
import { CalendarRange, Car, HelpCircle, Tag, Users, Warehouse, Wrench } from 'lucide-react';
import { EmptyState } from '../../../components';
import { AREA_OPTIONS, bayCodesOf, bayLabel } from '../../../config/manufacturingAreas';
import {
  bookingTypeOf,
  dedupeByGroup,
  isUnknownOrder,
  plural,
} from '../../../features/bayScheduling/constants';

const LABEL_W = 168;
const DAY_W = 96;
const HEADER_H = 52;
const BAR_H = 24;
const BAR_GAP = 4;
const ROW_PAD_Y = 6;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_STYLE = {
  RESERVED: {
    bg: 'linear-gradient(135deg,#023e8a,#0077b6)',
    fg: '#ffffff',
    chipBg: 'rgba(255,255,255,0.22)',
    label: 'Reserved',
  },
  CONFIRMED: {
    bg: 'linear-gradient(135deg,#047857,#059669)',
    fg: '#ffffff',
    chipBg: 'rgba(255,255,255,0.22)',
    label: 'Confirmed',
  },
  DONE: {
    bg: 'linear-gradient(135deg,#64748b,#94a3b8)',
    fg: '#ffffff',
    chipBg: 'rgba(255,255,255,0.22)',
    label: 'Done',
  },
  CANCELLED: {
    bg: '#e2e8f0',
    fg: '#475569',
    chipBg: 'rgba(71,85,105,0.14)',
    label: 'Cancelled',
    strike: true,
    border: '#cbd5e1',
  },
};
const DEFAULT_STATUS = STATUS_STYLE.RESERVED;
function statusStyle(s) {
  return STATUS_STYLE[String(s || '').toUpperCase()] || DEFAULT_STATUS;
}

const NONJOB_ICON = { PARKING: Car, STORAGE: Warehouse, MAINTENANCE: Wrench, OTHER: Tag };

function barLabel(entry) {
  const type = bookingTypeOf(entry);
  if (type.isJob) return entry.order_no || '—';
  return entry.purpose || type.label;
}

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
  return { y: dt.getUTCFullYear(), mon: dt.getUTCMonth(), dd: dt.getUTCDate(), wd: dt.getUTCDay() };
}

function todayDayNum() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000);
}

const KNOWN_BAYS = new Set(AREA_OPTIONS.flatMap((area) => bayCodesOf(area.areaCode)));

function barTitle(entry, style) {
  const type = bookingTypeOf(entry);
  const lines = [
    type.isJob
      ? entry.order_no || '(no order)'
      : `${type.label}${entry.purpose ? ` — ${entry.purpose}` : ''}`,
    isUnknownOrder(entry) ? 'Unknown order' : null,
    entry.part_name ? `Part: ${entry.part_name}` : null,
    entry.customer ? `Customer: ${entry.customer}` : null,
    entry.task_count > 0 ? `${entry.task_count} task${entry.task_count === 1 ? '' : 's'}` : null,
    `${entry.start_date || '?'} → ${entry.end_date || '?'}`,
    entry.people_total != null ? `Headcount: ${entry.people_total}` : null,
    `Status: ${style.label}`,
    entry.area_name ? `Area: ${entry.area_name}` : null,
    entry.created_by_name || entry.created_by
      ? `By: ${entry.created_by_name || entry.created_by}`
      : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function BayRow({ bay, segs, lanes, numDays, todayNum, originNum, onSelect }) {
  const rowH = ROW_PAD_Y * 2 + Math.max(1, lanes) * BAR_H + Math.max(0, lanes - 1) * BAR_GAP;
  return (
    <div className="flex border-b border-slate-100">
      {}
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-white pl-4 pr-2"
        style={{ width: LABEL_W, height: rowH }}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        {}
        <span
          title={bayLabel(bay)}
          className="truncate font-mono text-xs font-bold tabular-nums text-slate-700"
        >
          {bayLabel(bay)}
        </span>
        {segs.length > 0 && (
          <span
            className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-bold tabular-nums text-slate-500"
            title={`${segs.length} reservation${segs.length === 1 ? '' : 's'}`}
          >
            {segs.length}
          </span>
        )}
      </div>

      {}
      <div className="relative shrink-0" style={{ width: numDays * DAY_W, height: rowH }}>
        {}
        <div className="absolute inset-0 flex" aria-hidden="true">
          {Array.from({ length: numDays }, (_, i) => {
            const dn = originNum + i;
            const { wd } = partsOf(dn);
            const weekend = wd === 0 || wd === 6;
            const isToday = dn === todayNum;
            return (
              <div
                key={i}
                className="h-full shrink-0"
                style={{
                  width: DAY_W,
                  borderRight: '1px solid #e2e8f0',
                  borderLeft: isToday ? '2px solid #ade8f4' : undefined,
                  background: isToday
                    ? 'rgba(173,232,244,0.18)'
                    : weekend
                      ? 'rgba(148,163,184,0.06)'
                      : undefined,
                }}
              />
            );
          })}
        </div>

        {}
        {segs.map((seg) => {
          const entry = seg.entry;
          const style = statusStyle(entry.status);
          const type = bookingTypeOf(entry);
          const NonJobIcon = type.isJob ? null : NONJOB_ICON[type.code] || Tag;
          const unknown = isUnknownOrder(entry);
          const span = seg.endIdx - seg.startIdx + 1;
          const left = seg.startIdx * DAY_W + 2;
          const width = span * DAY_W - 4;
          const top = ROW_PAD_Y + seg.lane * (BAR_H + BAR_GAP);
          const showChip = span >= 2;
          const people = entry.people_total != null ? String(entry.people_total) : null;
          const chipText = people || (entry.task_count > 1 ? `${entry.task_count} task` : null);
          const label = barLabel(entry);
          return (
            <button
              key={`${entry.group_key}-${bay}-${seg.startIdx}`}
              type="button"
              onClick={() => onSelect && onSelect(entry)}
              title={barTitle(entry, style)}
              aria-label={`${label}${unknown ? ' (unknown order)' : ''} in ${bay}, ${entry.start_date} to ${entry.end_date}, ${style.label}`}
              className="group absolute flex items-center gap-1 overflow-hidden rounded-md px-2 text-left shadow-sm ring-1 ring-black/10 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] focus-visible:ring-offset-1 focus-visible:ring-offset-white motion-reduce:transition-none motion-reduce:hover:brightness-100"
              style={{
                left,
                width,
                top,
                height: BAR_H,
                background: style.bg,
                color: style.fg,
                border: style.border ? `1px solid ${style.border}` : undefined,
              }}
            >
              {NonJobIcon && (
                <NonJobIcon className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              )}
              {unknown && (
                <HelpCircle className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              )}
              <span
                className={`truncate text-xs font-bold ${type.isJob ? 'font-mono tabular-nums' : ''} ${style.strike ? 'line-through' : ''}`}
              >
                {label}
              </span>
              {showChip && chipText && (
                <span
                  className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px] font-bold tabular-nums"
                  style={{ background: style.chipBg }}
                >
                  {people && <Users className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
                  {chipText}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LegendItem({ swatch, strike, text }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-500">
      <span
        className="inline-block h-3 w-4 rounded-sm ring-1 ring-black/5"
        style={{ background: swatch }}
        aria-hidden="true"
      />
      <span className={`text-xs font-semibold ${strike ? 'text-slate-400 line-through' : ''}`}>
        {text}
      </span>
    </span>
  );
}

export default function BayReservationTimeline({
  schedules,
  rangeStart,
  rangeEnd,
  onSelectSchedule,
}) {
  const originNum = dayNumOf(rangeStart);
  const endNum = dayNumOf(rangeEnd);
  const rangeValid = originNum != null && endNum != null && endNum >= originNum;
  const numDays = rangeValid ? endNum - originNum + 1 : 0;
  const todayNum = todayDayNum();

  const { byBay, visibleCount, extraBays } = useMemo(() => {
    const map = new Map();
    const seen = new Set();
    if (!rangeValid || !Array.isArray(schedules))
      return { byBay: map, visibleCount: 0, extraBays: [] };

    dedupeByGroup(schedules).forEach((entry) => {
      const start = dayNumOf(entry.start_date);
      const end = dayNumOf(entry.end_date);
      const rawStart = start != null ? start : end;
      const rawEnd = end != null ? end : start;
      if (rawStart == null || rawEnd == null) return;
      const lo = Math.min(rawStart, rawEnd);
      const hi = Math.max(rawStart, rawEnd);
      if (hi < originNum || lo > endNum) return;
      const startIdx = Math.max(0, lo - originNum);
      const endIdx = Math.min(numDays - 1, hi - originNum);
      const bays = Array.isArray(entry.bay_codes) ? entry.bay_codes : [];
      let placed = false;
      bays.forEach((bay) => {
        if (!bay) return;
        placed = true;
        if (!map.has(bay)) map.set(bay, []);
        map.get(bay).push({ entry, startIdx, endIdx, lane: 0 });
      });
      if (placed) seen.add(entry.group_key);
    });

    map.forEach((segs) => {
      segs.sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);
      const laneEnd = [];
      segs.forEach((seg) => {
        let lane = laneEnd.findIndex((last) => last < seg.startIdx);
        if (lane === -1) {
          lane = laneEnd.length;
          laneEnd.push(seg.endIdx);
        } else laneEnd[lane] = seg.endIdx;
        seg.lane = lane;
      });
    });

    const extras = [...map.keys()].filter((bay) => !KNOWN_BAYS.has(bay)).sort();

    return { byBay: map, visibleCount: seen.size, extraBays: extras };
  }, [schedules, rangeValid, originNum, endNum, numDays]);

  if (!rangeValid) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <EmptyState
          icon={CalendarRange}
          title="Invalid date range"
          description="End date must be on or after start date."
        />
      </div>
    );
  }
  if (visibleCount === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <EmptyState
          icon={CalendarRange}
          title="No reservations"
          description={`${rangeStart} → ${rangeEnd}`}
        />
      </div>
    );
  }

  const boardW = LABEL_W + numDays * DAY_W;
  const laneCountOf = (segs) => (segs.length ? Math.max(...segs.map((x) => x.lane)) + 1 : 1);

  const renderGroup = (key, name, bays) => (
    <div key={key}>
      <div
        className="flex border-b border-[#90e0ef]"
        style={{ width: boardW, background: '#caf0f8' }}
      >
        <div
          className="sticky left-0 z-20 flex shrink-0 items-center gap-2 px-4 py-1.5"
          style={{ width: LABEL_W, background: '#caf0f8' }}
        >
          <span className="truncate text-xs font-extrabold uppercase tracking-wide text-[#0077b6]">
            {name}
          </span>
          <span className="ml-auto shrink-0 rounded-full bg-white/70 px-1.5 text-[11px] font-bold tabular-nums text-[#023e8a]">
            {bays.reduce((n, bay) => n + (byBay.get(bay)?.length || 0), 0)}
          </span>
        </div>
      </div>
      {bays.map((bay) => {
        const segs = byBay.get(bay) || [];
        return (
          <BayRow
            key={`${key}-${bay}`}
            bay={bay}
            segs={segs}
            lanes={laneCountOf(segs)}
            numDays={numDays}
            todayNum={todayNum}
            originNum={originNum}
            onSelect={onSelectSchedule}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-slate-700">
          <CalendarRange className="h-4 w-4 text-[#0077b6]" strokeWidth={2} aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Bay reservations
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-slate-600">
            {rangeStart} → {rangeEnd}
          </span>
          <span className="text-xs font-semibold tabular-nums text-slate-400">
            · {numDays} days · {plural(visibleCount, 'reservation')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <LegendItem swatch={STATUS_STYLE.RESERVED.bg} text="Reserved" />
          <LegendItem swatch={STATUS_STYLE.CONFIRMED.bg} text="Confirmed" />
          <LegendItem swatch={STATUS_STYLE.DONE.bg} text="Done" />
          <LegendItem swatch={STATUS_STYLE.CANCELLED.bg} strike text="Cancelled" />
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Car className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" /> Non-job booking
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <HelpCircle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" /> Unknown
            order
          </span>
        </div>
      </div>

      {}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="relative" style={{ width: boardW, minWidth: '100%' }}>
          {}
          <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-40 flex shrink-0 items-center border-b border-r border-slate-200 bg-slate-50 px-4 text-[11px] font-extrabold uppercase tracking-wide text-slate-500"
              style={{ width: LABEL_W }}
            >
              Area · Bay
            </div>
            <div className="flex shrink-0 bg-slate-50" style={{ width: numDays * DAY_W }}>
              {Array.from({ length: numDays }, (_, i) => {
                const dn = originNum + i;
                const { mon, dd, wd } = partsOf(dn);
                const weekend = wd === 0 || wd === 6;
                const isToday = dn === todayNum;
                return (
                  <div
                    key={i}
                    className="flex shrink-0 flex-col items-center justify-center border-b border-slate-200"
                    style={{
                      width: DAY_W,
                      borderRight: '1px solid #e2e8f0',
                      borderLeft: isToday ? '2px solid #ade8f4' : undefined,
                      background: isToday
                        ? 'rgba(173,232,244,0.35)'
                        : weekend
                          ? 'rgba(148,163,184,0.08)'
                          : undefined,
                    }}
                  >
                    <span
                      className={`text-[11px] font-bold uppercase ${weekend ? 'text-[#0077b6]' : 'text-slate-400'}`}
                    >
                      {WEEKDAY[wd]}
                    </span>
                    <span className="text-xs font-extrabold tabular-nums text-slate-700">
                      {String(dd).padStart(2, '0')}
                    </span>
                    {(dd === 1 || i === 0) && (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {MONTH[mon]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {}
          {AREA_OPTIONS.map((area) =>
            renderGroup(area.areaCode, area.areaName, bayCodesOf(area.areaCode))
          )}
          {extraBays.length > 0 && renderGroup('__extra', 'Unmapped bays', extraBays)}
        </div>
      </div>
    </div>
  );
}
