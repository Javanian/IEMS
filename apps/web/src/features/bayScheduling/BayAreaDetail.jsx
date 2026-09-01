import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  Car,
  LayoutGrid,
  Tag,
  Truck,
  User,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react';
import {
  BOOKING_TYPES,
  RESERVATION_STATUS,
  ZONE_BY_KEY,
  bayCode as makeBayCode,
  splitBayCode,
  areaRangeLabel,
  zoneOrderFor,
  dedupeByGroup,
  formatDate,
  groupKeyOf,
  isActiveOn,
  isUnknownOrder,
  plural,
} from './constants';

const EMPTY_SCHEDULES = [];

function statusStyle(status) {
  const key = String(status || '').toUpperCase();
  return RESERVATION_STATUS[key] || RESERVATION_STATUS.RESERVED;
}

function bookingTypeOf(schedule) {
  return String(schedule?.booking_type || 'ORDER').toUpperCase();
}

function bookingTypeLabel(type) {
  const source = BOOKING_TYPES;
  if (Array.isArray(source)) {
    const found = source.find(
      (item) => String(item?.value ?? item?.id ?? item?.code).toUpperCase() === type
    );
    if (found?.label) return found.label;
    return type;
  }
  const entry = source?.[type];
  if (typeof entry === 'string') return entry;
  if (entry?.label) return entry.label;
  return type;
}

const NON_JOB_ICON = {
  PARKING: Car,
  STORAGE: Warehouse,
  MAINTENANCE: Wrench,
  OTHER: Tag,
};

function isNonJob(schedule) {
  return bookingTypeOf(schedule) !== 'ORDER';
}

function isSubcont(schedule) {
  return schedule?.is_subcont === true;
}

function actorName(schedule) {
  return schedule?.created_by_name || schedule?.created_by || null;
}

function bayCountOf(schedule) {
  return Array.isArray(schedule?.bay_codes) ? schedule.bay_codes.length : 0;
}

const ScheduleBadge = memo(function ScheduleBadge({ schedule, onOpenDetail }) {
  const style = statusStyle(schedule.status);
  const nonJob = isNonJob(schedule);
  const unknown = isUnknownOrder(schedule);
  const subcont = isSubcont(schedule);
  const type = bookingTypeOf(schedule);
  const typeLabel = bookingTypeLabel(type);
  const NonJobIcon = NON_JOB_ICON[type] || Tag;
  const bays = bayCountOf(schedule);

  const people = schedule.people_total ?? schedule.people_required;
  const hasPeople = people != null && people !== '';
  const range = `${formatDate(schedule.start_date)} – ${formatDate(schedule.end_date)}`;

  const handleClick = useCallback(
    (event) => {
      event.stopPropagation();
      onOpenDetail(schedule);
    },
    [onOpenDetail, schedule]
  );

  const title = nonJob ? typeLabel : schedule.order_no;
  const ariaLabel = nonJob
    ? `${typeLabel}${schedule.purpose ? ` — ${schedule.purpose}` : ''}, ${style.label}, ${range}`
    : `Order ${schedule.order_no}, ${style.label}, ${range}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
      className={`block w-full overflow-hidden rounded-lg border text-left shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${
        nonJob
          ? 'border-slate-300 bg-slate-50 hover:border-slate-400'
          : 'border-[#90e0ef] bg-white hover:border-[#0077b6]'
      }`}
    >
      <span className="flex">
        <span aria-hidden="true" className="w-1.5 shrink-0" style={{ background: style.bar }} />
        <span className="min-w-0 flex-1 px-2 py-1.5">
          {}
          <span className="flex items-center justify-between gap-1.5">
            {nonJob ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-700">
                <NonJobIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="truncate uppercase tracking-wide">{typeLabel}</span>
              </span>
            ) : (
              <span className="truncate font-mono text-xs font-extrabold tabular-nums text-slate-800">
                {schedule.order_no || '-'}
              </span>
            )}
            <span
              className={`shrink-0 rounded-full border px-1.5 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}
            >
              {style.label}
            </span>
          </span>

          {}
          {nonJob && schedule.purpose && (
            <span
              className="mt-0.5 block truncate text-xs font-semibold text-slate-600"
              title={String(schedule.purpose)}
            >
              {schedule.purpose}
            </span>
          )}

          {}
          {!nonJob && !unknown && (schedule.part_name || schedule.customer) && (
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {[schedule.part_name, schedule.customer].filter(Boolean).join(' · ')}
            </span>
          )}

          {}
          {unknown && (
            <span className="mt-1 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Unknown order
            </span>
          )}

          {actorName(schedule) && (
            <span
              className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500"
              title={actorName(schedule)}
            >
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">{actorName(schedule)}</span>
            </span>
          )}

          <span className="mt-0.5 flex items-center gap-1 truncate text-xs tabular-nums text-slate-500">
            <CalendarRange className="h-3 w-3 shrink-0" />
            {range}
          </span>

          {(hasPeople || bays > 1 || subcont) && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {hasPeople && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-[#caf0f8] px-1.5 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]"
                  title="Headcount"
                >
                  <Users className="h-3 w-3" />
                  {people}
                </span>
              )}
              {bays > 1 && (
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                  {bays} bays
                </span>
              )}
              {subcont && (
                <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-bold text-violet-700">
                  <Truck className="h-3 w-3" />
                  Subcont
                </span>
              )}
            </span>
          )}
        </span>
      </span>
    </button>
  );
});

const BayDetailCell = memo(function BayDetailCell({
  area,
  bayCode,
  schedules,
  cursorDate,
  selected,
  onSelectBay,
  onOpenDetail,
  onDropOrder,
}) {
  const [dragOver, setDragOver] = useState(false);

  const reservations = useMemo(
    () => dedupeByGroup(schedules.filter((schedule) => isActiveOn(schedule, cursorDate))),
    [schedules, cursorDate]
  );

  const occupied = reservations.length > 0;

  const selectBay = useCallback(() => onSelectBay(bayCode), [onSelectBay, bayCode]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectBay();
    },
    [selectBay]
  );

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragOver(false);
      onDropOrder(event, area, bayCode);
    },
    [onDropOrder, area, bayCode]
  );

  let stateClass;
  let stateStyle;
  if (dragOver) {
    stateClass = 'border-[#0077b6] ring-2 ring-[#00b4d8]';
    stateStyle = { background: '#caf0f8' };
  } else if (selected) {
    stateClass = 'border-[#0077b6] ring-2 ring-[#90e0ef]';
    stateStyle = { background: '#ffffff' };
  } else if (occupied) {
    stateClass = 'border-[#0077b6]';
    stateStyle = { background: 'linear-gradient(180deg,#f5fcfe 0%,#e6f6fb 100%)' };
  } else {
    stateClass = 'border-dashed border-slate-200 bg-white hover:border-[#90e0ef] hover:bg-slate-50';
    stateStyle = undefined;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={
        occupied
          ? `Bay ${bayCode}, ${plural(reservations.length, 'reservation')}`
          : `Bay ${bayCode}, free`
      }
      onClick={selectBay}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex min-h-[220px] cursor-pointer flex-col rounded-xl border-2 p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none ${stateClass}`}
      style={stateStyle}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-extrabold uppercase tabular-nums text-slate-700">
          {splitBayCode(bayCode).base}
        </span>
        <span
          className={`rounded-full px-1.5 text-[11px] font-bold uppercase tracking-wide tabular-nums ${
            occupied ? 'bg-[#caf0f8] text-[#0077b6]' : 'bg-slate-100 text-slate-400'
          }`}
        >
          {reservations.length === 1
            ? '1 reservation'
            : `${plural(reservations.length, 'reservation')}`}
        </span>
      </div>

      {occupied ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {reservations.map((schedule) => (
            <ScheduleBadge
              key={groupKeyOf(schedule)}
              schedule={schedule}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      ) : (
        <div className="pointer-events-none flex flex-1 select-none flex-col items-center justify-center gap-1 text-center">
          <span className="text-xs font-semibold text-slate-400">Free</span>
          <span className="text-xs text-slate-400">Drop an order here</span>
        </div>
      )}
    </div>
  );
});

export default function BayAreaDetail({
  area,
  schedulesByBay,
  cursorDate,
  selectedBay,
  onSelectBay,
  onOpenDetail,
  onDropOrder,
  onBack,
}) {
  const zoneRows = useMemo(() => {
    const bases = Array.isArray(area?.bays) ? area.bays : [];
    if (!area?.zoned) return [{ zoneKey: null, label: null, codes: bases }];
    return zoneOrderFor(area.label).map((zoneKey) => ({
      zoneKey,
      label: ZONE_BY_KEY[zoneKey].label,
      codes: bases.map((base) => makeBayCode(base, zoneKey)),
    }));
  }, [area]);

  const bays = useMemo(() => zoneRows.flatMap((row) => row.codes), [zoneRows]);

  const summary = useMemo(() => {
    const groups = new Set();
    let activities = 0;
    bays.forEach((bayCode) => {
      const rows = schedulesByBay?.get(bayCode) || EMPTY_SCHEDULES;
      rows.forEach((schedule) => {
        if (!isActiveOn(schedule, cursorDate)) return;
        activities += 1;
        groups.add(groupKeyOf(schedule));
      });
    });
    return { reservations: groups.size, activities };
  }, [bays, schedulesByBay, cursorDate]);

  if (!area) return null;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">
              {area.areaCode}
            </p>
            <h3 className="truncate text-sm font-extrabold text-slate-800">{areaRangeLabel(area)}</h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs font-semibold tabular-nums text-slate-600">
            <LayoutGrid className="h-3.5 w-3.5 text-slate-400" />
            {plural(bays.length, 'bay')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#caf0f8] px-2 py-1 text-xs font-bold tabular-nums text-[#0077b6]">
            {plural(summary.reservations, 'reservation')} ·{' '}
            {plural(summary.activities, 'activity', 'activities')}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold tabular-nums text-slate-600"
            title="Showing reservations active on this date"
          >
            <CalendarRange className="h-3.5 w-3.5 text-[#0077b6]" />
            As of {formatDate(cursorDate)}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {zoneRows.map((row, index) => (
          <section key={row.zoneKey || 'single'}>
            {row.label && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  {row.label}
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {row.codes.map((code) => (
                <BayDetailCell
                  key={code}
                  area={area}
                  bayCode={code}
                  schedules={schedulesByBay?.get(code) || EMPTY_SCHEDULES}
                  cursorDate={cursorDate}
                  selected={selectedBay === code}
                  onSelectBay={onSelectBay}
                  onOpenDetail={onOpenDetail}
                  onDropOrder={onDropOrder}
                />
              ))}
            </div>
            {}
            {index < zoneRows.length - 1 && (
              <div className="my-4 flex items-center gap-2" aria-hidden="true">
                <span className="h-0.5 flex-1 rounded bg-slate-300" />
                <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
                  Road
                </span>
                <span className="h-0.5 flex-1 rounded bg-slate-300" />
              </div>
            )}
          </section>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Drag an order onto any bay — bays can be shared. Click a badge for details.
      </p>
    </section>
  );
}
