import React, { useCallback, useEffect, useId, useRef } from 'react';
import {
  Ban,
  Building2,
  CalendarRange,
  Clock,
  HelpCircle,
  ListChecks,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Tag,
  User,
  Users,
  X,
} from 'lucide-react';
import { bookingTypeOf, formatDate, formatHours, isUnknownOrder, statusStyle } from './constants';
import useDialogA11y from './useDialogA11y';

function isText(value) {
  return value != null && String(value).trim() !== '';
}

function DetailRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#caf0f8] text-[#0077b6]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="text-sm font-semibold text-slate-800">{children}</div>
      </div>
    </div>
  );
}

export default function ReservationDetailModal({ detail, onClose, onCancel, onEdit, busy }) {
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const stableClose = useCallback(() => {
    onCloseRef.current?.();
  }, []);
  const dialogRef = useDialogA11y(stableClose);

  if (!detail) return null;

  const style = statusStyle(detail.status);
  const bays = Array.isArray(detail.bay_codes) ? detail.bay_codes : [];
  const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];

  const bookingType = bookingTypeOf(detail);
  const isOrderBooking = bookingType.isJob;

  const unknownOrder = isUnknownOrder(detail);

  const heading = isOrderBooking
    ? isText(detail.order_no)
      ? detail.order_no
      : '(no order)'
    : isText(detail.purpose)
      ? detail.purpose
      : bookingType.label;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 backdrop-blur-sm md:items-center md:px-4"
      onClick={stableClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl focus:outline-none md:max-w-lg md:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0077b6]">
                {isOrderBooking ? 'Reservation' : 'Non-job booking'}
              </p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.pill}`}
              >
                {style.label}
              </span>
              {!isOrderBooking && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${bookingType.pill}`}
                >
                  {bookingType.label}
                </span>
              )}
              {unknownOrder && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                  <HelpCircle className="h-3 w-3" /> Unknown order
                </span>
              )}
            </div>
            <h3
              id={titleId}
              className={`truncate text-base font-extrabold text-slate-800 ${isOrderBooking ? 'font-mono tabular-nums' : ''}`}
            >
              {heading}
            </h3>
            {(isText(detail.part_name) || isText(detail.customer)) && (
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                {[detail.part_name, detail.customer].filter(isText).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={stableClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailRow icon={<MapPin className="h-3.5 w-3.5" />} label="Area / Bay">
            <span className="block">{detail.area_name || '-'}</span>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {bays.join(', ') || '-'}
            </span>
          </DetailRow>
          <DetailRow icon={<CalendarRange className="h-3.5 w-3.5" />} label="Start / End">
            <span className="tabular-nums">
              {formatDate(detail.start_date)} – {formatDate(detail.end_date)}
            </span>
          </DetailRow>
          {!isOrderBooking && (
            <DetailRow icon={<Tag className="h-3.5 w-3.5" />} label="Type / Purpose">
              <span className="block">{bookingType.label}</span>
              <span className="block truncate text-xs font-semibold text-slate-500">
                {isText(detail.purpose) ? detail.purpose : '-'}
              </span>
            </DetailRow>
          )}
          {isText(detail.part_name) && (
            <DetailRow icon={<Package className="h-3.5 w-3.5" />} label="Part">
              <span className="block truncate">{detail.part_name}</span>
            </DetailRow>
          )}
          {isText(detail.customer) && (
            <DetailRow icon={<Building2 className="h-3.5 w-3.5" />} label="Customer">
              <span className="block truncate">{detail.customer}</span>
            </DetailRow>
          )}
          {isText(detail.created_by_name || detail.created_by) && (
            <DetailRow icon={<User className="h-3.5 w-3.5" />} label="Created by">
              <span className="block truncate">{detail.created_by_name || detail.created_by}</span>
            </DetailRow>
          )}
        </div>

        {unknownOrder && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700">
              Order <span className="font-mono tabular-nums">{detail.order_no || '-'}</span> not
              found in SAP/SOW data — the bay is still in use.
            </p>
          </div>
        )}

        {isText(detail.notes) && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{detail.notes}</p>
          </div>
        )}

        {isOrderBooking && tasks.length > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <ListChecks className="h-4 w-4 text-[#0077b6]" />
              <span className="text-xs font-bold text-slate-700">Reserved tasks</span>
              <span className="rounded-full bg-[#caf0f8] px-2 py-0.5 text-xs font-bold tabular-nums text-[#0077b6]">
                {tasks.length}
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white">
              {tasks.map((task, index) => {
                const hasPeople = task.people_required != null && task.people_required !== '';
                const hasPlan =
                  task.planhours != null &&
                  task.planhours !== '' &&
                  Number.isFinite(Number(task.planhours));
                return (
                  <div
                    key={task.schedule_id || `${task.task_id}-${index}`}
                    className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
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
                            {formatHours(task.planhours)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800">
                        {task.task_name || '-'}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums ${
                        hasPeople ? 'bg-[#caf0f8] text-[#0077b6]' : 'bg-slate-100 text-slate-400'
                      }`}
                      title="Headcount"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {hasPeople ? task.people_required : '-'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => onCancel(detail)}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            Cancel reservation
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onEdit(detail)}
              disabled={busy || !detail.schedule_group_id}
              title={!detail.schedule_group_id ? 'Legacy reservation cannot be edited' : undefined}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#023e8a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button
              type="button"
              onClick={stableClose}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
