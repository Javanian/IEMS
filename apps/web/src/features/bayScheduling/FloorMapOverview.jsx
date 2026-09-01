
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MapPin, Warehouse } from 'lucide-react';
import {
  ALL_AREAS, BLASTING_AREA, LANE_A, LANE_B, areaRangeLabel,
  buildAreaReservations, formatDate, groupAreaOrders, plural,
} from './constants';

const MAX_STACK = 3;

function OrderCard({ order }) {
  const isNonJob = !order.order_no;
  return (
    <div className="group flex items-stretch gap-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow">
      <span
        aria-hidden="true"
        className={`w-1 shrink-0 rounded-l-lg ${isNonJob ? 'bg-amber-400' : 'bg-[#0077b6]'}`}
      />
      <div className="min-w-0 flex-1 px-1 py-1">
        <div className="truncate text-[11px] font-extrabold tabular-nums text-slate-800">
          {order.order_no || order.purpose || '—'}
        </div>
        <div className="truncate text-[10px] font-semibold text-slate-500">
          {order.project_name || ''}
        </div>
        <div className="truncate font-mono text-[9px] text-slate-400">
          {order.count > 1 ? `${order.count} bookings · ` : ''}
          {formatDate(order.start_date)}–{formatDate(order.end_date)}
        </div>
      </div>
    </div>
  );
}

const AreaBlock = React.memo(function AreaBlock({
  area, cursorDate, selected, onSelect, reservations = [],
}) {
  const [expanded, setExpanded] = useState(false);
  const orders = useMemo(() => groupAreaOrders(reservations), [reservations]);
  const shown = expanded ? orders : orders.slice(0, MAX_STACK);
  const hiddenCount = orders.length - shown.length;
  const handleClick = useCallback(() => onSelect(area.areaCode), [onSelect, area.areaCode]);
  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(area.areaCode);
    }
  }, [onSelect, area.areaCode]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-pressed={selected}
      title={`${area.areaName}: ${plural(orders.length, 'order')} reserved on ${formatDate(cursorDate)}`}
      className={`flex w-60 shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
        selected
          ? 'border-[#0077b6] ring-2 ring-[#90e0ef] shadow-md'
          : 'border-slate-300 hover:border-[#90e0ef] hover:shadow-md'
      }`}
    >
      <span
        className={`block bg-gradient-to-r px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white ${
          selected ? 'from-[#0077b6] to-[#00b4d8]' : 'from-[#023e8a] to-[#0096c7]'
        }`}
      >
        {areaRangeLabel(area)}
      </span>

      <div className="flex flex-col gap-1 p-1.5">
        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-1.5 py-2 text-center text-[10px] font-semibold text-slate-400">
            No reservations
          </div>
        ) : (
          <>
            {shown.map((order) => (
              <OrderCard key={order.key} order={order} />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[#90e0ef] bg-[#f0faff] py-1 text-[10px] font-bold text-[#0077b6] transition hover:border-[#0096c7] hover:bg-[#e6f6fd]"
              >
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {expanded ? 'Show less' : `+${hiddenCount} more`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

const WarehouseBlock = React.memo(function WarehouseBlock() {
  return (
    <div className="flex w-60 shrink-0 flex-col justify-end gap-1 rounded-lg border border-transparent p-1">
      <div className="flex h-7 min-w-0 items-center justify-center gap-1 rounded border border-slate-200 bg-slate-100 px-1">
        <Warehouse className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-500">
          Warehouse B1–B8
        </span>
      </div>
    </div>
  );
});

function AisleGap() {
  return (
    <div className="flex w-8 shrink-0 items-stretch justify-center self-stretch" aria-hidden="true">
      <div className="my-1 w-px bg-slate-200" />
    </div>
  );
}

const Lane = React.memo(function Lane({ items, areaReservations, cursorDate, selectedAreaCode, onSelectArea, hiddenAreas }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 overflow-x-auto pb-1">
      {items.map((item) => {
        if (item.type === 'warehouse') return <WarehouseBlock key="warehouse" />;
        if (item.type !== 'area') return <AisleGap key={`aisle-${item.code}`} />;
        if (hiddenAreas.has(item.areaCode)) return null;
        return (
          <AreaBlock
            key={item.areaCode}
            area={item}
            cursorDate={cursorDate}
            selected={selectedAreaCode === item.areaCode}
            onSelect={onSelectArea}
            reservations={areaReservations.get(item.areaCode) || []}
          />
        );
      })}
    </div>
  );
});

export default function FloorMapOverview({
  schedulesByBay, cursorDate, selectedAreaCode, onSelectArea, orderFilter = '', onClearFilter,
}) {
  const selectRef = useRef(onSelectArea);
  useEffect(() => {
    selectRef.current = onSelectArea;
  });
  const handleSelectArea = useCallback((areaCode) => {
    if (typeof selectRef.current === 'function') selectRef.current(areaCode);
  }, []);

  const areaReservations = useMemo(() => {
    const map = new Map();
    for (const area of ALL_AREAS) {
      map.set(area.areaCode, buildAreaReservations(schedulesByBay, area));
    }
    return map;
  }, [schedulesByBay]);

  const hiddenAreas = useMemo(() => {
    const hidden = new Set();
    const q = String(orderFilter || '').trim();
    if (!q) return hidden;
    const qNorm = q.replace(/^0+(?=\d)/, '');
    for (const area of ALL_AREAS) {
      const has = (areaReservations.get(area.areaCode) || []).some((r) => {
        const on = String(r.order_no || '').replace(/^0+(?=\d)/, '');
        return on.includes(qNorm) || String(r.project_name || '').toLowerCase().includes(q.toLowerCase());
      });
      if (!has) hidden.add(area.areaCode);
    }
    return hidden;
  }, [orderFilter, areaReservations]);

  const allHidden = hiddenAreas.size === ALL_AREAS.length && orderFilter.trim() !== '';

  return (
    <section
      aria-label="Floor map"
      className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg,#023e8a,#0077b6)' }}
          >
            <MapPin className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">Cikupa Layout</p>
            <h3 className="truncate text-sm font-extrabold text-slate-800">Area summary</h3>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#90e0ef] bg-[#caf0f8] px-2 py-1 text-xs font-bold tabular-nums text-[#023e8a]">
          As of {formatDate(cursorDate)}
        </span>
      </div>

      {orderFilter.trim() ? (
        <p className="text-xs font-semibold text-[#0077b6]">
          Filtered by "{orderFilter.trim()}" — {ALL_AREAS.length - hiddenAreas.size} area shown
          <button
            type="button"
            onClick={() => typeof onClearFilter === 'function' && onClearFilter()}
            className="ml-2 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:border-red-300 hover:text-red-600"
          >
            Clear filter
          </button>
        </p>
      ) : null}

      {allHidden ? (
        <div className="flex flex-1 items-center justify-center py-12 text-center">
          <p className="text-sm font-semibold text-slate-400">
            No reservations for "{orderFilter.trim()}" in this period.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          <div className="flex min-w-0 items-start gap-1.5">
            {!hiddenAreas.has(BLASTING_AREA.areaCode) && (
              <div className="w-60 shrink-0">
                <AreaBlock
                  area={BLASTING_AREA}
                  cursorDate={cursorDate}
                  selected={selectedAreaCode === BLASTING_AREA.areaCode}
                  onSelect={handleSelectArea}
                  reservations={areaReservations.get(BLASTING_AREA.areaCode) || []}
                />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Lane
                items={LANE_A}
                areaReservations={areaReservations}
                cursorDate={cursorDate}
                selectedAreaCode={selectedAreaCode}
                onSelectArea={handleSelectArea}
                hiddenAreas={hiddenAreas}
              />
              <div className="flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300">Aisle</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <Lane
                items={LANE_B}
                areaReservations={areaReservations}
                cursorDate={cursorDate}
                selectedAreaCode={selectedAreaCode}
                onSelectArea={handleSelectArea}
                hiddenAreas={hiddenAreas}
              />
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
