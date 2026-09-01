import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock3,
  Factory,
  Inbox,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  TimerReset,
  Truck,
  X,
} from 'lucide-react';
import { PageContainer } from '../../components';
import TtsAutoAnnouncementPlayer from '../../components/TtsAutoAnnouncementPlayer';
import {
  fetchKanbanBoard,
  fetchKanbanCardDetail,
  fetchKanbanSummary,
  fetchLatestBuffers,
  fetchWorkcenters,
  refreshKanbanBoard,
} from '../../services/kanbanService';

const REFRESH_MS = 30000;
const HIGHLIGHT_MS = 1800;
const MotionArticle = motion.article;
const MotionDiv = motion.div;
const MotionMain = motion.main;
const MotionSection = motion.section;

const LANE_ORDER = [
  'Incoming / Pre-Process',
  'Cutting / Weld Repair',
  'Rough Machining',
  'Precision Machining',
  'Surface Treatment / Coating',
  'Inspection / Test',
  'Packing / Ready Dispatch',
  'Support',
  'Unassigned',
  'Ready To Shipment',
];

const STATUS_META = {
  running: {
    title: 'On Going',
    icon: Activity,
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    border: 'border-emerald-200',
  },
  bufferIn: {
    title: 'Buffer In',
    icon: Inbox,
    dot: 'bg-[#0096c7]',
    badge: 'bg-[#caf0f8] text-[#0077b6] border-[#90e0ef]',
    border: 'border-sky-200',
  },
  bufferOut: {
    title: 'Buffer Out',
    icon: PackageCheck,
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    border: 'border-amber-200',
  },
  readyShipment: {
    title: 'Ready Shipment',
    icon: Truck,
    dot: 'bg-violet-500',
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
    border: 'border-violet-200',
  },
};

function parseDbTimestamp(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesSince(value, nowMs = Date.now()) {
  const date = parseDbTimestamp(value);
  if (!date) return null;
  return Math.max(0, (nowMs - date.getTime()) / 60000);
}

function secondsSince(value, nowMs = Date.now()) {
  const date = parseDbTimestamp(value);
  if (!date) return null;
  return Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ageText(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  return formatDurationClock(Math.floor(Number(minutes) * 60));
}

function formatDurationClock(seconds) {
  if (seconds === null || seconds === undefined) return '--:--:--:--';
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [
    String(days).padStart(2, '0'),
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(secs).padStart(2, '0'),
  ].join(':');
}

function formatHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function progressPercent(actual, plan) {
  const actualNumber = asNumber(actual, 0);
  const planNumber = asNumber(plan, 0);
  if (planNumber <= 0) return 0;
  return Math.max(0, Math.round((actualNumber / planNumber) * 100));
}

function formatDateTime(value) {
  const date = parseDbTimestamp(value);
  if (!date) return '-';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ageBand(status, minutes) {
  if (minutes === null || minutes === undefined) return 'unknown';
  const running = status === 'running';
  if (running && minutes < 240) return 'green';
  if (running && minutes < 480) return 'amber';
  if (!running && minutes < 480) return 'green';
  if (!running && minutes < 1440) return 'amber';
  return 'red';
}

function ageClasses(band) {
  if (band === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (band === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (band === 'red') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function cardSignature(card) {
  return [
    card.id,
    card.status,
    card.location,
    card.order_no,
    card.operation_no,
    card.machine_id,
    card.actual_hours,
    card.planhours,
    card.event_at,
    card.priority,
  ].join('|');
}

function laneRank(location) {
  const idx = LANE_ORDER.indexOf(location);
  return idx === -1 ? 999 : idx;
}

function statusRank(status) {
  return ['running', 'bufferIn', 'bufferOut', 'readyShipment'].indexOf(status);
}

function buildMachineLocationMap(workcenters) {
  return new Map(
    workcenters
      .filter((row) => row.machineid)
      .map((row) => [row.machineid, row.location || 'Unassigned'])
  );
}

function normalizeBoardCards(rows, nowMs) {
  return rows
    .filter((row) => row.current_source === 'running')
    .map((row) => {
      const minutes =
        row.state_age_minutes === null || row.state_age_minutes === undefined
          ? minutesSince(row.state_entered_at, nowMs)
          : asNumber(row.state_age_minutes, null);

      return {
        id: `running-${row.order_key}`,
        status: 'running',
        location: row.current_location || 'Unassigned',
        order_no: row.order_no_display || row.order_key || '-',
        operation_no: row.operation_no,
        operation_text: row.operation_text || '-',
        part_name: row.part_name || '-',
        ssbr_id: row.ssbr_id || '-',
        machine_id: row.machine_id || row.machine_code || '-',
        machine_code: row.machine_code || row.machine_id || '-',
        machine_description: row.machine_description || '-',
        actual_hours: row.actual_hours,
        planhours: row.planhours,
        event_at: row.state_entered_at,
        buffer_id: null,
        age_minutes: minutes,
        aging_band: row.aging_band || ageBand('running', minutes),
        priority: row.queue_priority,
        parallel_count: asNumber(row.parallel_count),
      };
    });
}

function normalizeBufferCards(buffers, machineLocationMap, nowMs) {
  return buffers
    .filter(
      (row) =>
        row.type === 'in' || row.type === 'moving' || row.type === 'out' || row.type === 'shipment'
    )
    .map((row) => {
      const status =
        row.type === 'shipment' ? 'readyShipment' : row.type === 'out' ? 'bufferOut' : 'bufferIn';
      const minutes = minutesSince(row.timestamp, nowMs);

      return {
        id: `${status}-${row.id}`,
        status,
        location:
          row.type === 'shipment'
            ? 'Ready To Shipment'
            : machineLocationMap.get(row.machine_id) || 'Unassigned',
        order_no: row.order_no || '-',
        operation_no: row.operation_no,
        operation_text: row.operation_text || '-',
        part_name: row.component_name || row.component_label || '-',
        ssbr_id: row.ssbr_id || '-',
        machine_id: row.machine_id || '-',
        machine_code: row.machine_id || '-',
        machine_description: row.machine_id || '-',
        actual_hours: null,
        planhours: null,
        event_at: row.timestamp,
        buffer_id: row.id,
        age_minutes: minutes,
        aging_band: ageBand(status, minutes),
        priority: asNumber(row.priority),
        parallel_count: 0,
      };
    });
}

function mergeStableCards(prevCards, nextCards) {
  const prevById = new Map(prevCards.map((card) => [card.id, card]));
  const changedIds = new Set();

  const merged = nextCards.map((card) => {
    const prev = prevById.get(card.id);
    if (!prev) {
      changedIds.add(card.id);
      return card;
    }

    if (cardSignature(prev) !== cardSignature(card)) {
      changedIds.add(card.id);
      return card;
    }

    return { ...prev, age_minutes: card.age_minutes, aging_band: card.aging_band };
  });

  return { cards: merged, changedIds };
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const statusSort = statusRank(a.status) - statusRank(b.status);
    if (statusSort !== 0) return statusSort;
    const ageSort = asNumber(b.age_minutes, -1) - asNumber(a.age_minutes, -1);
    if (ageSort !== 0) return ageSort;
    return String(a.order_no).localeCompare(String(b.order_no));
  });
}

function buildLaneGroups(cards) {
  const groups = new Map();
  cards.forEach((card) => {
    const key = card.location || 'Unassigned';
    if (!groups.has(key)) {
      groups.set(key, {
        location: key,
        cards: [],
        running: [],
        bufferIn: [],
        bufferOut: [],
        readyShipment: [],
      });
    }
    const group = groups.get(key);
    group.cards.push(card);
    group[card.status].push(card);
  });

  LANE_ORDER.forEach((location) => {
    if (!groups.has(location) && location !== 'Unassigned') {
      groups.set(location, {
        location,
        cards: [],
        running: [],
        bufferIn: [],
        bufferOut: [],
        readyShipment: [],
      });
    }
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cards: sortCards(group.cards),
      running: sortCards(group.running),
      bufferIn: sortCards(group.bufferIn),
      bufferOut: sortCards(group.bufferOut),
      readyShipment: sortCards(group.readyShipment),
      oldestAge: group.cards.reduce((max, card) => Math.max(max, asNumber(card.age_minutes, 0)), 0),
    }))
    .sort((a, b) => laneRank(a.location) - laneRank(b.location));
}

function useKanbanLevelOne() {
  const [cards, setCards] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [changedIds, setChangedIds] = useState(new Set());
  const [nowMs, setNowMs] = useState(Date.now());
  const timeoutRef = useRef(null);

  const load = useCallback(async ({ silent = false, forceRefresh = false } = {}) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError('');

    try {
      if (forceRefresh) await refreshKanbanBoard();

      const [boardRows, summaryPayload, buffers, workcenters] = await Promise.all([
        fetchKanbanBoard({ limit: 1000 }),
        fetchKanbanSummary(),
        fetchLatestBuffers(),
        fetchWorkcenters(),
      ]);

      const nextNow = Date.now();
      const machineLocationMap = buildMachineLocationMap(workcenters);
      const nextCards = [
        ...normalizeBoardCards(boardRows, nextNow),
        ...normalizeBufferCards(buffers, machineLocationMap, nextNow),
      ];

      let nextChangedIds = new Set();
      setCards((prevCards) => {
        const merged = mergeStableCards(prevCards, nextCards);
        nextChangedIds = merged.changedIds;
        return merged.cards;
      });
      if (nextChangedIds.size > 0) {
        setChangedIds(nextChangedIds);
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => setChangedIds(new Set()), HIGHLIGHT_MS);
      }
      setSummary(summaryPayload);
      setNowMs(nextNow);
      setLastUpdated(new Date(nextNow));
    } catch (err) {
      setError(err.message || 'Gagal memuat kanban board');
    } finally {
      setRefreshing(false);
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => window.clearTimeout(timeoutRef.current);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => load({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const liveCards = useMemo(
    () =>
      cards.map((card) => {
        const minutes = card.event_at ? minutesSince(card.event_at, nowMs) : card.age_minutes;
        return {
          ...card,
          age_minutes: minutes,
          aging_band: ageBand(card.status, minutes),
        };
      }),
    [cards, nowMs]
  );

  return {
    cards: liveCards,
    summary,
    loading,
    refreshing,
    error,
    lastUpdated,
    changedIds,
    reload: load,
  };
}

function StatTile({ label, value, icon: Icon, tone = 'text-slate-800', subtext = '' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase text-slate-500">{label}</span>
        {React.createElement(Icon, { className: `h-4 w-4 ${tone}` })}
      </div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums ${tone}`}>{value}</div>
      {subtext && <div className="truncate text-[10px] font-medium text-slate-500">{subtext}</div>}
    </div>
  );
}

function StatusCount({ status, value }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div
      className={`inline-flex min-w-0 items-center gap-1 rounded-full border bg-white px-1.5 py-1 ${meta.border}`}
    >
      {React.createElement(Icon, { className: 'h-3.5 w-3.5 text-slate-500' })}
      <span className="min-w-0 truncate text-[10px] font-extrabold text-slate-500">
        {meta.title}
      </span>
      <span className="font-mono text-xs font-extrabold text-slate-900">{value}</span>
    </div>
  );
}

function ProgressRing({ actual, plan }) {
  const percent = progressPercent(actual, plan);
  const cappedPercent = Math.min(percent, 100);
  const percentLabel = percent > 999 ? '999%+' : `${percent}%`;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (cappedPercent / 100) * circumference;
  const ringTone =
    percent > 100 ? 'text-red-600' : percent >= 90 ? 'text-amber-500' : 'text-[#0077b6]';

  return (
    <div
      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-50"
      title={`${formatHours(actual)}h / ${formatHours(plan)}h`}
    >
      <svg viewBox="0 0 40 40" className="h-12 w-12 -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-slate-200"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`transition-all duration-700 ease-out ${ringTone}`}
        />
      </svg>
      <span className="absolute text-[8px] font-extrabold tabular-nums text-slate-800">
        {percentLabel}
      </span>
    </div>
  );
}

const KanbanCard = memo(function KanbanCard({ card, changed, onClick }) {
  const meta = STATUS_META[card.status];
  const ageSeconds = card.event_at
    ? secondsSince(card.event_at)
    : Math.floor(asNumber(card.age_minutes, 0) * 60);
  const isRunning = card.status === 'running';

  return (
    <MotionArticle
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        backgroundColor: changed ? '#ecfeff' : '#ffffff',
        borderColor: changed ? '#48cae4' : undefined,
      }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      onClick={() => onClick(card)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(card);
        }
      }}
      className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition hover:border-[#90e0ef] hover:bg-slate-50"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
            <span className="min-w-0 truncate font-mono text-xs font-extrabold text-slate-900">
              {card.order_no}
            </span>
          </div>
          {isRunning && (
            <>
              <div
                className="mt-1 min-w-0 truncate text-[11px] font-bold text-slate-700"
                title={card.operation_text}
              >
                {card.operation_text}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                <span className="max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-slate-600">
                  OP {card.operation_no || '-'}
                </span>
                <span className="max-w-full truncate rounded-md bg-[#e8f7fb] px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-[#0077b6]">
                  {card.machine_code || card.machine_id || '-'}
                </span>
              </div>
            </>
          )}
          <div className="mt-1 min-w-0 truncate text-[10px] font-semibold text-slate-500">
            {card.ssbr_id}
          </div>
        </div>
        {isRunning && <ProgressRing actual={card.actual_hours} plan={card.planhours} />}
      </div>
      <span
        className={`mx-auto mt-1.5 flex w-[86px] max-w-full items-center justify-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums ${ageClasses(card.aging_band)}`}
      >
        <Clock3 className="h-3 w-3 shrink-0" />
        {formatDurationClock(ageSeconds)}
      </span>
    </MotionArticle>
  );
});

function StatusColumn({ status, cards, changedIds, onCardClick, limit = 5, className = '' }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const [expanded, setExpanded] = useState(false);
  const visibleCards = expanded ? cards : cards.slice(0, limit);

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2 ${className}`}
    >
      <div className="mb-2 flex min-w-0 shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-extrabold text-slate-700">
          {React.createElement(Icon, { className: 'h-4 w-4 shrink-0 text-slate-500' })}
          <span className="min-w-0 truncate">{meta.title}</span>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-slate-500">
          {cards.length}
        </span>
      </div>
      <MotionDiv layout className="min-h-0 space-y-1.5">
        <AnimatePresence initial={false}>
          {visibleCards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              changed={changedIds.has(card.id)}
              onClick={onCardClick}
            />
          ))}
        </AnimatePresence>
      </MotionDiv>
      {cards.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-[11px] font-extrabold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
        >
          {expanded ? 'Collapse' : `Show all ${cards.length}`}
        </button>
      )}
    </div>
  );
}

function LanePanel({ lane, changedIds, onCardClick }) {
  const isShipmentLane = lane.location === 'Ready To Shipment';

  return (
    <MotionSection
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`${isShipmentLane ? 'w-[320px] md:w-[340px]' : 'w-[360px] md:w-[390px]'} flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm`}
    >
      <div className="mb-3">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-extrabold text-slate-900">{lane.location}</h3>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
                <TimerReset className="h-3 w-3" />
                Oldest {ageText(lane.oldestAge)}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[#caf0f8] px-2 py-0.5 text-[10px] font-extrabold text-[#0077b6]">
              {lane.cards.length} WIP
            </span>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap gap-1 overflow-hidden">
          {isShipmentLane ? (
            <StatusCount status="readyShipment" value={lane.readyShipment.length} />
          ) : (
            <>
              <StatusCount status="running" value={lane.running.length} />
              <StatusCount status="bufferIn" value={lane.bufferIn.length} />
              <StatusCount status="bufferOut" value={lane.bufferOut.length} />
            </>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 overflow-hidden">
        {isShipmentLane ? (
          <StatusColumn
            status="readyShipment"
            cards={lane.readyShipment}
            changedIds={changedIds}
            onCardClick={onCardClick}
            limit={12}
            className="border-violet-100 bg-violet-50"
          />
        ) : (
          <>
            <StatusColumn
              status="running"
              cards={lane.running}
              changedIds={changedIds}
              onCardClick={onCardClick}
              limit={4}
              className="border-emerald-100"
            />
            <div className="grid min-w-0 grid-cols-2 gap-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5">
              <StatusColumn
                status="bufferIn"
                cards={lane.bufferIn}
                changedIds={changedIds}
                onCardClick={onCardClick}
                limit={5}
                className="border-sky-100"
              />
              <StatusColumn
                status="bufferOut"
                cards={lane.bufferOut}
                changedIds={changedIds}
                onCardClick={onCardClick}
                limit={5}
                className="border-amber-100"
              />
            </div>
          </>
        )}
      </div>
    </MotionSection>
  );
}

function LoadingShell() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="w-[390px] shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
        >
          <div className="animate-pulse space-y-4">
            <div className="h-5 w-48 rounded bg-slate-200" />
            <div className="h-44 rounded-lg bg-slate-100" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-56 rounded-lg bg-slate-100" />
              <div className="h-56 rounded-lg bg-slate-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MovementChain({ movements = [] }) {
  if (movements.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
        No movement history found.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {movements.map((movement, index) => (
        <div
          key={`${movement.source}-${movement.movement_type}-${movement.evidence_id}-${index}`}
          className="grid grid-cols-[20px_1fr] gap-3"
        >
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 h-3 w-3 rounded-full ${movement.source === 'buffer' ? 'bg-[#0096c7]' : 'bg-emerald-500'}`}
            />
            {index < movements.length - 1 && <span className="h-full w-px bg-slate-200" />}
          </div>
          <div className="pb-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-600">
                      {movement.source}
                    </span>
                    <span className="rounded-full bg-[#caf0f8] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#0077b6]">
                      {movement.movement_type}
                    </span>
                  </div>
                  <div className="mt-2 truncate text-sm font-bold text-slate-900">
                    {movement.operation_text || '-'}
                  </div>
                  <div className="mt-1 truncate text-xs font-semibold text-slate-500">
                    {movement.machine_id || '-'} / {movement.machine_description || '-'}
                  </div>
                  {movement.actor && (
                    <div className="mt-1 truncate text-xs text-slate-500">{movement.actor}</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[11px] font-extrabold text-slate-700">
                    {formatDateTime(movement.movement_at)}
                  </div>
                  {movement.duration !== null && movement.duration !== undefined && (
                    <div className="mt-1 text-[10px] font-bold text-slate-400">
                      {formatHours(movement.duration)}h
                    </div>
                  )}
                </div>
              </div>
              {movement.note && (
                <div className="mt-2 line-clamp-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-500">
                  {movement.note}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function KanbanCardDetailModal({ card, payload, loading, error, onClose }) {
  const detail = payload?.detail || null;
  const movements = payload?.movements || [];

  return (
    <AnimatePresence>
      {card && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wide text-[#0096c7]">
                  Kanban Detail
                </div>
                <h2 className="truncate font-mono text-xl font-extrabold text-slate-900">
                  {card.order_no}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {loading ? (
                <div className="space-y-4">
                  <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  {error}
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                  <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-bold uppercase text-slate-500">Operation</div>
                    <div className="mt-2 text-lg font-extrabold text-slate-900">
                      {detail?.operation_text || card.operation_text || '-'}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          Machine
                        </div>
                        <div className="mt-1 truncate font-mono text-sm font-extrabold text-slate-900">
                          {detail?.machine_id || card.machine_id || '-'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          Operation No
                        </div>
                        <div className="mt-1 font-mono text-sm font-extrabold text-slate-900">
                          {detail?.operation_no || card.operation_no || '-'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <div className="text-[10px] font-bold uppercase text-emerald-700">
                          Actual Hours
                        </div>
                        <div className="mt-1 font-mono text-lg font-extrabold text-emerald-700">
                          {formatHours(detail?.actual_hours)}h
                        </div>
                      </div>
                      <div className="rounded-lg border border-sky-200 bg-[#caf0f8] p-3">
                        <div className="text-[10px] font-bold uppercase text-[#0077b6]">
                          Plan Hours
                        </div>
                        <div className="mt-1 font-mono text-lg font-extrabold text-[#0077b6]">
                          {formatHours(detail?.planhours)}h
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        SSBR / Part
                      </div>
                      <div className="mt-1 truncate text-sm font-bold text-slate-900">
                        {detail?.ssbr_id || card.ssbr_id || '-'}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">
                        {detail?.part_name || card.part_name || '-'}
                      </div>
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">Movement Chain</h3>
                        <p className="text-xs font-semibold text-slate-500">
                          Timesheet + buffer transaction history
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-600">
                        {movements.length}
                      </span>
                    </div>
                    <MovementChain movements={movements} />
                  </section>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const KanbanLevelOnePage = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [detailPayload, setDetailPayload] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const { cards, summary, loading, refreshing, error, lastUpdated, changedIds, reload } =
    useKanbanLevelOne();

  const filteredCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter(
      (card) =>
        card.order_no?.toLowerCase().includes(query) ||
        card.ssbr_id?.toLowerCase().includes(query) ||
        card.part_name?.toLowerCase().includes(query) ||
        card.operation_text?.toLowerCase().includes(query) ||
        card.machine_id?.toLowerCase().includes(query) ||
        card.location?.toLowerCase().includes(query)
    );
  }, [cards, search]);

  const lanes = useMemo(() => buildLaneGroups(filteredCards), [filteredCards]);
  const totals = useMemo(
    () => ({
      running: filteredCards.filter((card) => card.status === 'running').length,
      bufferIn: filteredCards.filter((card) => card.status === 'bufferIn').length,
      bufferOut: filteredCards.filter((card) => card.status === 'bufferOut').length,
      readyShipment: filteredCards.filter((card) => card.status === 'readyShipment').length,
      red: filteredCards.filter((card) => card.aging_band === 'red').length,
    }),
    [filteredCards]
  );

  const openCardDetail = useCallback(async (card) => {
    setSelectedCard(card);
    setDetailPayload(null);
    setDetailError('');
    setDetailLoading(true);

    try {
      const payload = await fetchKanbanCardDetail({
        orderNo: card.order_no,
        operationNo: card.operation_no,
        bufferId: card.buffer_id,
      });
      setDetailPayload(payload);
    } catch (err) {
      setDetailError(err.message || 'Gagal memuat detail kanban.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeCardDetail = useCallback(() => {
    setSelectedCard(null);
    setDetailPayload(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  return (
    <PageContainer className="h-dvh min-h-dvh gap-3 overflow-hidden bg-slate-50 p-3 md:p-4">
      <TtsAutoAnnouncementPlayer pollIntervalMs={15000} />

      <header className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 active:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div>
              {}
              <h1 className="mt-1 text-xl font-extrabold text-slate-900">Kanban Order Board</h1>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, SSBR, machine..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-9 text-sm font-medium text-slate-800 placeholder-slate-400 transition focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] sm:w-72"
              />
            </div>
            <button
              type="button"
              onClick={() => reload({ silent: true, forceRefresh: true })}
              disabled={refreshing}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] px-4 text-sm font-bold text-white transition hover:bg-[#0077b6] active:bg-[#023e8a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-6">
        <StatTile
          label="Total Card"
          value={filteredCards.length}
          icon={Factory}
          subtext={`${summary?.totals?.total_cards || cards.length} source cards`}
        />
        <StatTile label="On Going" value={totals.running} icon={Activity} tone="text-emerald-700" />
        <StatTile label="Buffer In" value={totals.bufferIn} icon={Inbox} tone="text-[#0077b6]" />
        <StatTile
          label="Buffer Out"
          value={totals.bufferOut}
          icon={PackageCheck}
          tone="text-amber-700"
        />
        <StatTile
          label="Ready Ship"
          value={totals.readyShipment}
          icon={Truck}
          tone="text-violet-700"
        />
        <StatTile
          label="Red Aging"
          value={totals.red}
          icon={Clock3}
          tone="text-red-700"
          subtext={
            lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : ''
          }
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingShell />
      ) : (
        <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <MotionMain layout className="flex min-h-full items-start gap-3 pb-2">
            <AnimatePresence initial={false}>
              {lanes.map((lane) => (
                <LanePanel
                  key={lane.location}
                  lane={lane}
                  changedIds={changedIds}
                  onCardClick={openCardDetail}
                />
              ))}
            </AnimatePresence>
          </MotionMain>
          {filteredCards.length === 0 && (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
              <CheckCircle2 className="h-8 w-8 text-slate-400" />
              <div className="mt-3 font-bold text-slate-800">No card found</div>
            </div>
          )}
        </section>
      )}

      <KanbanCardDetailModal
        card={selectedCard}
        payload={detailPayload}
        loading={detailLoading}
        error={detailError}
        onClose={closeCardDetail}
      />
    </PageContainer>
  );
};

export default KanbanLevelOnePage;
