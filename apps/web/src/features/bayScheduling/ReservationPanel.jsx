import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarRange,
  Clock,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import {
  fetchBayOccupants,
  fetchBaySchedules,
  fetchOrderTasks,
  updateOperationPeople,
} from '../../services/msProjectService';
import { SearchInput, Skeleton } from '../../components';
import {
  NONJOB_BOOKING_TYPES,
  addDaysText,
  bookingTypeOf,
  formatDate,
  formatHours,
  statusStyle,
  todayText,
  bayCode as makeBayCode,
  splitBayCode,
} from './constants';
import useDialogA11y from './useDialogA11y';

function bookingTypeLabel(code) {
  return bookingTypeOf({ booking_type: code }).label;
}

function peopleKey(task) {
  const op = task.operation_no;
  return op != null && op !== '' ? `op:${op}` : `task:${task.task_id}`;
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : '';
}

function reservationLabel(row) {
  const bays = Array.isArray(row.bay_codes) && row.bay_codes.length ? row.bay_codes.join(', ') : '';
  const where = [row.area_name || row.area_code, bays].filter(Boolean).join(' · ');
  const when = `${formatDate(row.start_date)} – ${formatDate(row.end_date)}`;
  return [where, when].filter(Boolean).join(' · ');
}

function isValidPeople(value) {
  return value === '' || /^[1-9]\d*$/.test(value);
}

function normalizeOccupants(result) {
  if (Array.isArray(result)) {
    return { rows: result, truncated: false, total: result.length };
  }
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const total = Number(result?.total);
  return {
    rows,
    truncated: Boolean(result?.truncated),
    total: Number.isFinite(total) ? total : rows.length,
  };
}

const EMPTY_OCCUPANTS = { rows: [], truncated: false, total: 0 };
const EMPTY_TASK_RESERVATIONS = [];

const FIELD_CLASS =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all duration-150 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8] motion-reduce:transition-none';

const TaskRow = memo(function TaskRow({
  task,
  checked,
  onToggle,
  peopleValue,
  peopleInvalid,
  onPeopleChange,
  reservations,
}) {
  const uid = useId();
  const planhours = task.planhours;
  const hasPlan = planhours != null && planhours !== '' && Number.isFinite(Number(planhours));
  const planStart = dateOnly(task.plan_start);
  const planFinish = dateOnly(task.plan_finish);
  const hasSchedule = Boolean(planStart || planFinish);
  const hasReservation = reservations.length > 0;

  return (
    <div className="flex items-start gap-2.5 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
      {}
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(task.task_id)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#0077b6] focus:ring-2 focus:ring-[#00b4d8]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tabular-nums text-slate-600">
              Op {task.operation_no || '-'}
            </span>
            {task.workcenter && (
              <span className="rounded bg-[#caf0f8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#0077b6]">
                {task.workcenter}
              </span>
            )}
            {hasPlan && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tabular-nums text-slate-600">
                <Clock className="h-3 w-3" />
                {formatHours(planhours)}
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-sm font-semibold text-slate-800">
            {task.task_name || '-'}
          </span>
          <span
            className={`mt-0.5 flex items-center gap-1 text-xs tabular-nums ${hasSchedule ? 'text-slate-500' : 'text-amber-600'}`}
          >
            <CalendarRange className="h-3 w-3 shrink-0" />
            {hasSchedule ? `${formatDate(planStart)} – ${formatDate(planFinish)}` : 'No plan dates'}
          </span>
          <span
            className={`mt-0.5 flex items-start gap-1 text-xs tabular-nums ${hasReservation ? 'text-emerald-700' : 'text-slate-400'}`}
          >
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            {hasReservation ? (
              <span className="min-w-0">
                {reservations.slice(0, 2).map((row) => (
                  <span key={row.schedule_group_id || row.schedule_id} className="block truncate">
                    {reservationLabel(row)}
                  </span>
                ))}
                {reservations.length > 2 && (
                  <span className="block truncate text-slate-500">
                    +{reservations.length - 2} more reservation
                    {reservations.length - 2 > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            ) : (
              <span>No area reservation</span>
            )}
          </span>
        </span>
      </label>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <label
          htmlFor={uid}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        >
          <Users className="h-3 w-3" /> Headcount
        </label>
        <input
          id={uid}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={peopleValue}
          onChange={(event) => onPeopleChange(task, event.target.value)}
          placeholder="-"
          aria-invalid={peopleInvalid || undefined}
          className={`w-16 rounded-lg border bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] ${
            peopleInvalid
              ? 'border-red-400 ring-2 ring-red-200'
              : 'border-slate-200 focus:border-[#0096c7]'
          }`}
        />
      </div>
    </div>
  );
});

const OccupantRow = memo(function OccupantRow({ occupant }) {
  const style = statusStyle(occupant.status);
  const type = bookingTypeOf(occupant);
  const isOrder = type.isJob;
  const title = isOrder ? occupant.order_no || 'Unknown order' : occupant.purpose || type.label;
  const bays = Array.isArray(occupant.bay_codes) ? occupant.bay_codes : [];

  return (
    <li className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`truncate text-xs font-bold text-slate-800 ${isOrder ? 'font-mono tabular-nums' : ''}`}
          >
            {title}
          </span>
          {!isOrder && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${type.pill}`}
            >
              {type.label}
            </span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}
          >
            {style.label}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-xs tabular-nums text-slate-500">
          <CalendarRange className="h-3 w-3 shrink-0" />
          {formatDate(occupant.start_date)} – {formatDate(occupant.end_date)}
          {occupant.created_by_name || occupant.created_by ? (
            <span className="truncate"> · {occupant.created_by_name || occupant.created_by}</span>
          ) : null}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
        {bays.join(', ') || '-'}
      </span>
    </li>
  );
});

export default function ReservationPanel({
  open,
  mode,
  area,
  bayCode,
  order,
  saving,
  onClose,
  onSubmit,
  edit,
}) {
  if (!open || !area) return null;

  return (
    <ReservationPanelBody
      key={`${mode}|${area.areaCode}|${order?.order_no || ''}|${edit?.schedule_group_id || 'new'}`}
      mode={mode}
      area={area}
      bayCode={bayCode}
      order={order}
      saving={saving}
      onClose={onClose}
      onSubmit={onSubmit}
      edit={edit}
    />
  );
}

function ReservationPanelBody({ mode, area, bayCode, order, saving, onClose, onSubmit, edit }) {
  const isOrderMode = mode !== 'NONJOB';
  const isEdit = Boolean(edit);

  const shouldLoadTasks = isOrderMode && Boolean(order?.order_no);

  const editTasks = useMemo(
    () => (isEdit && Array.isArray(edit?.tasks) ? edit.tasks : []),
    [isEdit, edit]
  );

  const initialBay = isEdit && edit?.bay_codes?.length ? edit.bay_codes[0] : bayCode;

  const [bayCount, setBayCount] = useState(
    isEdit && edit?.bay_codes?.length ? edit.bay_codes.length : 1
  );

  const [manualStart, setManualStart] = useState(() => (isEdit && edit?.start_date) || todayText());
  const [manualEnd, setManualEnd] = useState(
    () => (isEdit && edit?.end_date) || addDaysText(todayText(), 7)
  );
  const [datesDirty, setDatesDirty] = useState(isEdit);
  const [notes, setNotes] = useState(() => (isEdit && edit?.notes) || '');

  const [bookingType, setBookingType] = useState(() => {
    if (isEdit && edit?.booking_type) return String(edit.booking_type).toUpperCase();
    return NONJOB_BOOKING_TYPES[0]?.code || 'PARKING';
  });
  const [purpose, setPurpose] = useState(() => (isEdit && edit?.purpose) || '');

  const [orderTasks, setOrderTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(shouldLoadTasks);
  const [tasksError, setTasksError] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState(() =>
    isEdit ? editTasks.map((task) => task.task_id).filter(Boolean) : []
  );
  const [taskSearch, setTaskSearch] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const [peopleEdits, setPeopleEdits] = useState(() => {
    if (!isEdit) return {};
    const seed = {};
    editTasks.forEach((task) => {
      const key = peopleKey(task);
      if (key in seed) return;
      seed[key] =
        task.people_required == null || task.people_required === ''
          ? ''
          : String(task.people_required);
    });
    return seed;
  });
  const [writingBack, setWritingBack] = useState(false);

  const peopleBaselineRef = useRef(
    isEdit
      ? (() => {
          const seed = {};
          editTasks.forEach((task) => {
            const key = peopleKey(task);
            if (key in seed) return;
            seed[key] =
              task.people_required == null || task.people_required === ''
                ? ''
                : String(task.people_required);
          });
          return seed;
        })()
      : {}
  );

  const [occupants, setOccupants] = useState(EMPTY_OCCUPANTS);
  const [loadingOccupants, setLoadingOccupants] = useState(true);
  const [occupantsError, setOccupantsError] = useState('');
  const [occupantsToken, setOccupantsToken] = useState(0);

  const [taskReservations, setTaskReservations] = useState({});

  const [submitError, setSubmitError] = useState('');

  const titleId = useId();
  const purposeId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const stableClose = useCallback(() => {
    onCloseRef.current?.();
  }, []);
  const dialogRef = useDialogA11y(stableClose);

  const zoneBays = useMemo(() => {
    if (!area?.zoned) return area?.bays || [];
    const { zoneKey } = splitBayCode(initialBay);
    return (area.bays || []).map((base) => makeBayCode(base, zoneKey || 'CENTER'));
  }, [area, initialBay]);
  const bayIndex = Math.max(0, zoneBays.indexOf(initialBay));
  const maxBayCount = Math.max(1, zoneBays.length - bayIndex);

  const effectiveBayCount = Math.min(Math.max(1, Number(bayCount) || 1), maxBayCount);
  const selectedBays = useMemo(
    () => zoneBays.slice(bayIndex, bayIndex + effectiveBayCount),
    [zoneBays, bayIndex, effectiveBayCount]
  );
  const bayCodesKey = selectedBays.join(',');

  useEffect(() => {
    if (!shouldLoadTasks) return undefined;

    let active = true;
    fetchOrderTasks(order.order_no)
      .then((rows) => {
        if (!active) return;
        const list = Array.isArray(rows) ? rows : [];
        setOrderTasks(list);

        const seed = {};
        list.forEach((task) => {
          const key = peopleKey(task);
          if (key in seed) return;
          seed[key] =
            task.people_required == null || task.people_required === ''
              ? ''
              : String(task.people_required);
        });
        setPeopleEdits(seed);
        peopleBaselineRef.current = seed;
      })
      .catch((error) => {
        if (!active) return;
        setTasksError(error.message || 'Failed to load tasks');
        setOrderTasks([]);
      })
      .finally(() => {
        if (active) setLoadingTasks(false);
      });

    return () => {
      active = false;
    };
  }, [shouldLoadTasks, order?.order_no, reloadToken]);

  useEffect(() => {
    if (!shouldLoadTasks) return undefined;
    let active = true;
    fetchBaySchedules({ order_no: order.order_no, limit: 5000 })
      .then((rows) => {
        if (!active) return;
        const map = {};
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          if (!row.task_id) return;
          (map[row.task_id] || (map[row.task_id] = [])).push(row);
        });
        setTaskReservations(map);
      })
      .catch(() => {
        if (active) setTaskReservations({});
      });
    return () => {
      active = false;
    };
  }, [shouldLoadTasks, order?.order_no]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);

  const displayTasks = useMemo(
    () => (orderTasks.length > 0 ? orderTasks : editTasks),
    [orderTasks, editTasks]
  );
  const selectedTasks = useMemo(
    () => displayTasks.filter((task) => selectedTaskIdSet.has(task.task_id)),
    [displayTasks, selectedTaskIdSet]
  );

  const taskQuery = taskSearch.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    if (!taskQuery) return displayTasks;
    return displayTasks.filter(
      (task) =>
        String(task.operation_no ?? '')
          .toLowerCase()
          .includes(taskQuery) ||
        String(task.task_name ?? '')
          .toLowerCase()
          .includes(taskQuery) ||
        String(task.workcenter ?? '')
          .toLowerCase()
          .includes(taskQuery)
    );
  }, [displayTasks, taskQuery]);

  const planRange = useMemo(() => {
    let start = null;
    let finish = null;
    selectedTasks.forEach((task) => {
      const s = dateOnly(task.plan_start);
      const f = dateOnly(task.plan_finish);
      if (s && (!start || s < start)) start = s;
      if (f && (!finish || f > finish)) finish = f;
    });
    return { start, finish };
  }, [selectedTasks]);

  const hasPlanRange = Boolean(planRange.start || planRange.finish);

  const prefillStart = isOrderMode && hasPlanRange ? planRange.start || planRange.finish : '';
  const prefillEnd = isOrderMode && hasPlanRange ? planRange.finish || planRange.start : '';
  const prefillActive = !datesDirty && Boolean(prefillStart) && Boolean(prefillEnd);
  const startDate = prefillActive ? prefillStart : manualStart;
  const endDate = prefillActive ? prefillEnd : manualEnd;

  const rangeInvalid = Boolean(startDate && endDate && endDate < startDate);
  const datesMissing = !startDate || !endDate;
  const canQueryOccupants = Boolean(bayCodesKey) && !datesMissing && !rangeInvalid;

  useEffect(() => {
    if (!canQueryOccupants) return undefined;

    let active = true;
    const timer = setTimeout(() => {
      setLoadingOccupants(true);
      setOccupantsError('');
      fetchBayOccupants({
        bay_codes: bayCodesKey.split(','),
        start_date: startDate,
        end_date: endDate,

        ...(isEdit && edit?.schedule_group_id ? { exclude_group_id: edit.schedule_group_id } : {}),
      })
        .then((result) => {
          if (!active) return;
          setOccupants(normalizeOccupants(result));
        })
        .catch((error) => {
          if (!active) return;
          setOccupants(EMPTY_OCCUPANTS);
          setOccupantsError(error.message || 'Failed to load bay reservations.');
        })
        .finally(() => {
          if (active) setLoadingOccupants(false);
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    canQueryOccupants,
    bayCodesKey,
    startDate,
    endDate,
    occupantsToken,
    isEdit,
    edit?.schedule_group_id,
  ]);

  const allFilteredChecked =
    filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIdSet.has(task.task_id));

  const toggleTask = useCallback((taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }, []);

  const toggleAll = useCallback(() => {
    if (filteredTasks.length === 0) return;
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (filteredTasks.every((task) => next.has(task.task_id))) {
        filteredTasks.forEach((task) => next.delete(task.task_id));
      } else {
        filteredTasks.forEach((task) => next.add(task.task_id));
      }
      return [...next];
    });
  }, [filteredTasks]);

  const handlePeopleChange = useCallback((task, raw) => {
    const digits = String(raw).replace(/[^0-9]/g, '');
    setPeopleEdits((prev) => ({ ...prev, [peopleKey(task)]: digits }));
  }, []);

  const handleStartDate = useCallback(
    (event) => {
      const value = event.target.value;
      setManualEnd((prev) => (datesDirty ? prev : endDate));
      setManualStart(value);
      setDatesDirty(true);
    },
    [datesDirty, endDate]
  );

  const handleEndDate = useCallback(
    (event) => {
      const value = event.target.value;
      setManualStart((prev) => (datesDirty ? prev : startDate));
      setManualEnd(value);
      setDatesDirty(true);
    },
    [datesDirty, startDate]
  );

  const resetDatesToPlan = useCallback(() => setDatesDirty(false), []);

  const retryTasks = useCallback(() => {
    setTasksError('');
    setLoadingTasks(true);
    setReloadToken((token) => token + 1);
  }, []);

  const retryOccupants = useCallback(() => setOccupantsToken((token) => token + 1), []);

  const peopleInvalid = selectedTasks.some(
    (task) => !isValidPeople(peopleEdits[peopleKey(task)] ?? '')
  );
  const purposeMissing = !isOrderMode && !purpose.trim();
  const tasksMissing = isOrderMode && selectedTasks.length === 0;
  const noPlanSchedule = isOrderMode && selectedTasks.length > 0 && !hasPlanRange;

  const canSubmit =
    !saving &&
    !writingBack &&
    !rangeInvalid &&
    !datesMissing &&
    !peopleInvalid &&
    !purposeMissing &&
    !tasksMissing;

  const handleSubmit = async () => {
    setSubmitError('');
    if (!canSubmit) return;

    if (isOrderMode) {
      const baseline = peopleBaselineRef.current || {};
      const changed = [];
      const seen = new Set();
      selectedTasks.forEach((task) => {
        const op = task.operation_no;
        if (op == null || op === '') return;
        const key = peopleKey(task);
        if (seen.has(key)) return;
        seen.add(key);
        const current = peopleEdits[key] ?? '';
        if (current === (baseline[key] ?? '')) return;
        changed.push({
          operation_no: op,
          people_required: current === '' ? null : Number.parseInt(current, 10),
        });
      });

      if (changed.length > 0) {
        setWritingBack(true);
        try {
          await updateOperationPeople(order.order_no, changed);

          peopleBaselineRef.current = {
            ...baseline,
            ...Object.fromEntries(
              changed.map((row) => [
                `op:${row.operation_no}`,
                row.people_required == null ? '' : String(row.people_required),
              ])
            ),
          };
        } catch (error) {
          setSubmitError(
            `Headcount not saved: ${error?.message || 'request rejected by server'}. ` +
              'Reservation was not created — retry or restore the previous values.'
          );
          setWritingBack(false);
          return;
        }
        setWritingBack(false);
      }
    }

    const base = {
      area_code: area.areaCode,
      area_name: area.areaName,
      bay_codes: selectedBays,
      start_date: startDate,
      end_date: endDate,
    };
    if (isEdit) {
      base.schedule_group_id = edit.schedule_group_id;
      base.notes = notes.trim();
    } else if (notes.trim()) {
      base.notes = notes.trim();
    }

    if (isOrderMode) {
      onSubmit({
        ...base,
        booking_type: 'ORDER',
        order_no: order.order_no,
        tasks: selectedTasks.map((task) => ({
          task_id: task.task_id,
          project_id: task.project_id,
        })),
      });
      return;
    }

    onSubmit({
      ...base,
      booking_type: bookingType,
      purpose: purpose.trim(),
    });
  };

  const busy = saving || writingBack;
  const headline = isOrderMode ? order?.order_no || '-' : bookingTypeLabel(bookingType);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden bg-white focus:outline-none"
      >
        {}
        <header className="shrink-0 border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-3 px-4 py-3.5 md:px-6">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">
                {isEdit ? 'Edit reservation' : isOrderMode ? 'Bay reservation' : 'Non-job booking'}
              </p>
              <h3
                id={titleId}
                className={`truncate text-base font-extrabold text-slate-800 ${isOrderMode ? 'font-mono tabular-nums' : ''}`}
              >
                {headline}
              </h3>
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-semibold text-slate-500">
                <MapPin className="h-3 w-3 shrink-0" />
                {area.areaName} · from <span className="font-mono tabular-nums">{bayCode}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={stableClose}
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
            {}
            {!isOrderMode && (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Booking type
                  <select
                    value={bookingType}
                    onChange={(event) => setBookingType(event.target.value)}
                    disabled={isEdit}
                    className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {NONJOB_BOOKING_TYPES.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-1">
                  <label htmlFor={purposeId} className="text-xs font-bold text-slate-700">
                    Purpose <span className="text-red-600">*</span>
                  </label>
                  <input
                    id={purposeId}
                    type="text"
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                    placeholder="e.g. unit parked waiting for vendor"
                    aria-invalid={purposeMissing || undefined}
                    className={`${FIELD_CLASS} ${purposeMissing ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                  />
                  {purposeMissing && (
                    <p className="text-xs font-semibold text-red-600">Purpose is required.</p>
                  )}
                </div>
              </div>
            )}

            {}
            {isOrderMode && (
              <div className="grid gap-1.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <ListChecks className="h-4 w-4 text-[#0077b6]" />
                    Select tasks
                    {selectedTasks.length > 0 && (
                      <span className="rounded-full bg-[#caf0f8] px-2 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
                        {selectedTasks.length} selected
                      </span>
                    )}
                  </span>
                  {displayTasks.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="rounded text-xs font-bold text-[#0077b6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                    >
                      {allFilteredChecked ? 'Clear' : 'Select all'}
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white">
                  {loadingTasks ? (
                    <div className="space-y-2 p-3">
                      {[0, 1, 2].map((row) => (
                        <Skeleton key={row} className="h-9 rounded-lg" />
                      ))}
                    </div>
                  ) : tasksError && !isEdit ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                      <AlertTriangle className="h-7 w-7 text-red-400" strokeWidth={1.5} />
                      <p className="text-xs font-semibold text-red-600">{tasksError}</p>
                      <button
                        type="button"
                        onClick={retryTasks}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Retry
                      </button>
                    </div>
                  ) : displayTasks.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                      {isEdit ? (
                        <p className="text-xs font-semibold text-slate-500">
                          This reservation has no reserved tasks — edit dates, bay, or notes only.
                        </p>
                      ) : (
                        <>
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                            <ListChecks className="h-5 w-5" />
                          </span>
                          <p className="text-xs font-semibold text-slate-500">
                            Order is not mapped to MS Project.
                          </p>
                          <Link
                            to="/sow-scheduling/map"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0077b6] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                          >
                            Map SAP operations <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <SearchInput
                        value={taskSearch}
                        onChange={setTaskSearch}
                        placeholder="Search op / task / workcenter..."
                        className="mb-1.5"
                      />
                      {taskQuery && (
                        <p className="mb-1 px-1 text-[11px] font-semibold tabular-nums text-slate-500">
                          {filteredTasks.length} of {displayTasks.length} tasks
                        </p>
                      )}
                      {filteredTasks.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                          <p className="text-xs font-semibold text-slate-500">
                            No tasks match “{taskSearch.trim()}”.
                          </p>
                        </div>
                      ) : (
                        <div className="max-h-[42vh] overflow-y-auto">
                          {filteredTasks.map((task) => {
                            const value = peopleEdits[peopleKey(task)] ?? '';
                            return (
                              <TaskRow
                                key={task.task_id}
                                task={task}
                                checked={selectedTaskIdSet.has(task.task_id)}
                                onToggle={toggleTask}
                                peopleValue={value}
                                peopleInvalid={!isValidPeople(value)}
                                onPeopleChange={handlePeopleChange}
                                reservations={
                                  taskReservations[task.task_id] || EMPTY_TASK_RESERVATIONS
                                }
                              />
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {!loadingTasks && !tasksError && displayTasks.length > 0 && tasksMissing && (
                  <p className="text-xs font-semibold text-amber-600">Select at least one task.</p>
                )}
                {peopleInvalid && (
                  <p className="text-xs font-semibold text-red-600">
                    Headcount must be a positive whole number, or left empty.
                  </p>
                )}
              </div>
            )}

            {}
            {noPlanSchedule && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="flex items-start gap-1.5 text-xs font-bold text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Job not scheduled in MS Project
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  Selected tasks have no <span className="font-semibold">plan start/finish</span>,
                  so the dates below are not prefilled.
                </p>
                <Link
                  to="/sow-scheduling/map"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                >
                  Map SAP operations <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Number of bays
                  <select
                    value={effectiveBayCount}
                    onChange={(event) => setBayCount(Number(event.target.value))}
                    className={`${FIELD_CLASS} tabular-nums`}
                  >
                    {Array.from({ length: maxBayCount }, (_, index) => index + 1).map((count) => (
                      <option key={count} value={count}>
                        {count === 1 ? '1 bay' : `${count} bays`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Selected bays
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-800">
                    {selectedBays.join(', ') || '-'}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <CalendarRange className="h-4 w-4 text-[#0077b6]" /> Dates
                  </span>
                  {isOrderMode && prefillStart && prefillEnd && datesDirty && (
                    <button
                      type="button"
                      onClick={resetDatesToPlan}
                      className="inline-flex items-center gap-1 rounded text-xs font-bold text-[#0077b6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Use MS Project dates
                    </button>
                  )}
                </div>
                {prefillActive && (
                  <p className="flex items-start gap-1.5 text-xs text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0077b6]" />
                    Prefilled from the MS Project schedule.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-bold text-slate-700">
                    Start
                    <input
                      type="date"
                      value={startDate}
                      onChange={handleStartDate}
                      aria-invalid={rangeInvalid || undefined}
                      className={`${FIELD_CLASS} tabular-nums ${rangeInvalid ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-slate-700">
                    End
                    <input
                      type="date"
                      value={endDate}
                      onChange={handleEndDate}
                      aria-invalid={rangeInvalid || undefined}
                      className={`${FIELD_CLASS} tabular-nums ${rangeInvalid ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                    />
                  </label>
                </div>
                {rangeInvalid && (
                  <p className="text-xs font-semibold text-red-600">
                    End date cannot be earlier than start date.
                  </p>
                )}
                {datesMissing && (
                  <p className="text-xs font-semibold text-red-600">
                    Start and end date are required.
                  </p>
                )}
              </div>
            </div>

            {}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#0077b6]" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700">Currently using this bay</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Bay can be shared — this does not block saving.
                    </p>
                  </div>
                </div>

                {!canQueryOccupants ? (
                  <p className="px-4 py-4 text-xs text-slate-500">Set valid dates to see this.</p>
                ) : loadingOccupants ? (
                  <div className="space-y-2 p-3">
                    {[0, 1].map((row) => (
                      <Skeleton key={row} className="h-10 rounded-lg" />
                    ))}
                  </div>
                ) : occupantsError ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
                    <p className="text-xs font-semibold text-red-600">{occupantsError}</p>
                    <button
                      type="button"
                      onClick={retryOccupants}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </button>
                  </div>
                ) : occupants.rows.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-slate-500">
                    No other reservations in this range.
                  </p>
                ) : (
                  <>
                    <ul className="max-h-48 overflow-y-auto">
                      {occupants.rows.map((occupant, index) => (
                        <OccupantRow
                          key={
                            occupant.schedule_id ||
                            `${occupant.schedule_group_id || 'row'}-${index}`
                          }
                          occupant={occupant}
                        />
                      ))}
                    </ul>
                    <p className="border-t border-slate-100 px-4 py-2 text-xs font-semibold tabular-nums text-slate-500">
                      {occupants.truncated
                        ? `Showing ${occupants.rows.length} of ${occupants.total} reservations`
                        : `${occupants.total} ${occupants.total === 1 ? 'reservation' : 'reservations'}`}
                    </p>
                  </>
                )}
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Notes (optional)
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    className={FIELD_CLASS}
                  />
                </label>
              </div>
            </div>

            {}
            {submitError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-xs font-semibold text-red-600">{submitError}</p>
              </div>
            )}
          </div>
        </div>

        {}
        <footer className="shrink-0 border-t border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-2 px-4 py-3 md:px-6">
            <button
              type="button"
              onClick={stableClose}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {writingBack ? 'Saving headcount...' : isEdit ? 'Save changes' : 'Save reservation'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
