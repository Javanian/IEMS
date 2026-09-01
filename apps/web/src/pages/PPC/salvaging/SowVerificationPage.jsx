import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Cpu,
  Layers,
  Loader2,
  Package,
  RotateCw,
  Search,
  SkipForward,
  Undo2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageContainer } from '../../../components';
import ConfirmationModal from '../../../components/ui/ConfirmationModal';
import {
  fetchOrderProgress,
  fetchOrderOperations,
  markOperationStatus,
  clearOperationStatus,
} from '../../../services/sowScheduleService';
import { STATUS_TOKENS } from '../../../theme/ewsStatus';
import { goBackOrFallback } from '../../../utils/navigation';

const COLOR_KEY = { red: 'critical', amber: 'watch', green: 'normal' };
function tokenFor(color) {
  return STATUS_TOKENS[COLOR_KEY[color]] || STATUS_TOKENS.no_data;
}

const NYANGKUT_REASONS = [
  'Menunggu Material',
  'Menunggu Tooling',
  'Mesin Rusak',
  'Menunggu Instruksi',
  'Antrean Mesin',
  'Menunggu Part Lain',
];

const OP_WORD = { sudah: 'Selesai', nyangkut: 'Tertahan', dilewati: 'Dilewati', belum: 'Belum' };
const FLAG_LABEL = { nyangkut: 'tertahan', dilewati: 'dilewati' };

const CARD_CAP = 50;

function todayISO() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function opList(ops, max = 3) {
  const a = asArray(ops);
  if (a.length === 0) return '';
  if (a.length <= max) return a.join(', ');
  return `${a.slice(0, max).join(', ')}, +${a.length - max}`;
}

function opToken(op) {
  const eff = op.effective_status;
  if (eff === 'sudah') return STATUS_TOKENS.normal;
  if (eff === 'nyangkut' || eff === 'dilewati') return STATUS_TOKENS.critical;
  if (eff === 'belum' && op.is_behind_frontier) return STATUS_TOKENS.watch;
  return STATUS_TOKENS.no_data;
}

function classifyOps(ops) {
  const action = [],
    upcoming = [],
    done = [];
  for (const op of ops) {
    const eff = op.effective_status;
    if (eff === 'sudah') done.push(op);
    else if (op.is_frontier || op.is_behind_frontier || eff === 'nyangkut' || eff === 'dilewati')
      action.push(op);
    else upcoming.push(op);
  }
  return { action, upcoming, done };
}

function StatusBadge({ color, word }) {
  const t = tokenFor(color);
  return (
    <span
      className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide"
      style={{ backgroundColor: t.bg, color: t.text, borderColor: t.border }}
    >
      {word}
    </span>
  );
}

function ProblemChip({ tokenKey, label }) {
  const t = STATUS_TOKENS[tokenKey] || STATUS_TOKENS.no_data;
  return (
    <span
      className="inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-bold"
      style={{ backgroundColor: t.bg, color: t.text, borderColor: t.border }}
    >
      {label}
    </span>
  );
}

function OpRow({ op, busy, onDilewati, onNyangkut, onClear }) {
  const t = opToken(op);
  const eff = op.effective_status;
  const isDone = eff === 'sudah';
  const marked = op.manual_status_id != null;
  const hours =
    op.actual_hours != null && Number(op.actual_hours) > 0
      ? `${Number(op.actual_hours).toFixed(1)} jam`
      : null;

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-3"
      style={{ borderLeftWidth: 4, borderLeftColor: t.solid }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-extrabold text-slate-900">
              Operasi {op.operation_no}
            </span>
            {op.is_frontier && (
              <span className="rounded-full bg-[#e0f2fe] px-2 py-0.5 text-[10px] font-bold text-[#0077b6]">
                ◀ Posisi Saat Ini
              </span>
            )}
            {op.is_ghost && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                Belum Ada Aktivitas
              </span>
            )}
          </div>
          {op.operation_text && (
            <p className="mt-0.5 truncate text-xs text-slate-600">{op.operation_text}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold text-slate-500">
            <span>{op.machine_code || '-'}</span>
            {hours && <span>· {hours}</span>}
            {op.machine_deviation && <span className="text-amber-600">· Mesin Berbeda</span>}
            {op.sequence_deviation && <span className="text-amber-600">· Urutan Berbeda</span>}
          </p>
          {op.blocked_reason && (
            <p className="mt-1 text-[11px] font-semibold text-red-600">⛔ {op.blocked_reason}</p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-extrabold uppercase"
          style={{ backgroundColor: t.bg, color: t.text, borderColor: t.border }}
        >
          {OP_WORD[eff] || eff}
        </span>
      </div>

      {!isDone && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {marked ? (
            <button
              disabled={busy}
              onClick={onClear}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Batalkan Penandaan
            </button>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={onDilewati}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-700 hover:bg-amber-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <SkipForward className="h-4 w-4" />
                Tandai Dilewati
              </button>
              <button
                disabled={busy}
                onClick={onNyangkut}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Ban className="h-4 w-4" />
                Tandai Tertahan
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LadderSection({ title, ops, order, busyOp, onDilewati, onNyangkut, onClear }) {
  if (!ops.length) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {title} · {ops.length}
      </h4>
      <div className="flex flex-col gap-2">
        {ops.map((op) => (
          <OpRow
            key={op.operation_no}
            op={op}
            busy={busyOp === `${order}:${op.operation_no}`}
            onDilewati={() => onDilewati(order, op)}
            onNyangkut={() => onNyangkut(order, op)}
            onClear={() => onClear(order, op)}
          />
        ))}
      </div>
    </div>
  );
}

function OrderProgressCard({
  order,
  expanded,
  onToggle,
  ladder,
  busyOp,
  onReloadLadder,
  onDilewati,
  onNyangkut,
  onClear,
}) {
  const po = order.production_order;
  const color = order.status_color || 'green';
  const t = tokenFor(color);
  const total = asNum(order.total_ops);
  const done = asNum(order.done_ops);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const isDone = total > 0 && done >= total;
  const noFrontier = order.frontier_op == null;

  const partNames = asArray(order.part_names);
  const ssbrIds = asArray(order.ssbr_ids);
  const debtCount = asNum(order.debt_count);
  const blockedCount = asNum(order.blocked_count);
  const debtOps = asArray(order.debt_ops);
  const blockedOps = asArray(order.blocked_ops);

  const behindBelum = asArray(order.behind_frontier_ops).filter(
    (op) => !debtOps.includes(op) && !blockedOps.includes(op)
  );
  const debtOnly = !isDone && noFrontier;

  const word = isDone ? 'Selesai' : color === 'green' ? 'Sesuai Jalur' : 'Menyimpang';

  let whereText;
  if (isDone) {
    whereText = `Selesai — ${done}/${total} operasi`;
  } else if (debtOnly) {
    whereText = `Tidak ada operasi aktif — tunggakan: Operasi ${debtOps.length ? opList(debtOps) : (order.frontier_op ?? '-')}`;
  } else if (color === 'green') {
    whereText = `Sesuai jalur — Operasi ${order.frontier_op} · ${order.frontier_machine || '-'}`;
  } else {
    whereText = `Posisi: Operasi ${order.frontier_op} · ${order.frontier_machine || '-'} · ${OP_WORD[order.frontier_status] || order.frontier_status || '-'}`;
  }

  const hasProblems = debtCount > 0 || blockedCount > 0 || behindBelum.length > 0;
  const groups = ladder && ladder.operations ? classifyOps(ladder.operations) : null;

  return (
    <article
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      style={{ borderLeftWidth: 4, borderLeftColor: t.solid }}
    >
      <button
        type="button"
        onClick={() => onToggle(po)}
        className="block w-full p-4 text-left hover:bg-slate-50/60 active:bg-slate-50"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-sm font-extrabold text-slate-900">
            {po}
          </span>
          <StatusBadge color={color} word={word} />
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>

        {}
        {(partNames.length > 0 || ssbrIds.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {partNames.length > 0 && (
              <span className="min-w-0 max-w-full truncate text-xs font-semibold text-slate-600">
                {partNames[0]}
                {partNames.length > 1 ? ` +${partNames.length - 1}` : ''}
              </span>
            )}
            {ssbrIds.slice(0, 2).map((s) => (
              <span
                key={s}
                className="shrink-0 rounded-md border border-[#bae6fd] bg-[#e0f2fe] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#0369a1]"
              >
                {s}
              </span>
            ))}
            {ssbrIds.length > 2 && (
              <span className="shrink-0 text-[10px] font-bold text-slate-400">
                +{ssbrIds.length - 2}
              </span>
            )}
          </div>
        )}

        <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          {isDone && <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: t.solid }} />}
          <span className="truncate">{whereText}</span>
        </p>

        {hasProblems && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {debtCount > 0 && (
              <ProblemChip
                tokenKey="critical"
                label={`Tunggakan ${debtCount}${debtOps.length ? ` (Op ${opList(debtOps)})` : ''}`}
              />
            )}
            {blockedCount > 0 && (
              <ProblemChip
                tokenKey="critical"
                label={`Tertahan ${blockedCount}${blockedOps.length ? ` (Op ${opList(blockedOps)})` : ''}`}
              />
            )}
            {behindBelum.length > 0 && (
              <ProblemChip
                tokenKey="watch"
                label={`Tertinggal ${behindBelum.length} (Op ${opList(behindBelum)})`}
              />
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: t.solid }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-bold text-slate-500">
            {done}/{total} operasi
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 p-3">
          {!ladder || ladder.loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm font-semibold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat operasi…
            </div>
          ) : ladder.error ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-xs font-bold text-red-700">{ladder.error}</p>
              <button
                onClick={() => onReloadLadder(po)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-xs font-bold text-red-700 hover:bg-red-100 active:scale-95"
              >
                <RotateCw className="h-4 w-4" />
                Muat Ulang
              </button>
            </div>
          ) : !groups ||
            groups.action.length + groups.upcoming.length + groups.done.length === 0 ? (
            <p className="py-4 text-center text-xs font-semibold text-slate-500">
              Tidak ada operasi pada rute produksi.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <LadderSection
                title="Perlu Tindakan"
                ops={groups.action}
                order={po}
                busyOp={busyOp}
                onDilewati={onDilewati}
                onNyangkut={onNyangkut}
                onClear={onClear}
              />
              <LadderSection
                title="Belum Dikerjakan"
                ops={groups.upcoming}
                order={po}
                busyOp={busyOp}
                onDilewati={onDilewati}
                onNyangkut={onNyangkut}
                onClear={onClear}
              />
              <LadderSection
                title="Selesai"
                ops={groups.done}
                order={po}
                busyOp={busyOp}
                onDilewati={onDilewati}
                onNyangkut={onNyangkut}
                onClear={onClear}
              />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function CardSkeleton() {
  return <div className="h-[104px] animate-pulse rounded-xl border border-slate-200 bg-white" />;
}

function matchesSearch(order, { qOrder, qMachine, qPart }) {
  const inc = (v, q) =>
    String(v ?? '')
      .toLowerCase()
      .includes(q);
  if (qOrder) {
    const q = qOrder.trim().toLowerCase();
    if (q && !(inc(order.production_order, q) || asArray(order.ssbr_ids).some((s) => inc(s, q))))
      return false;
  }
  if (qMachine) {
    const q = qMachine.trim().toLowerCase();
    if (q && !inc(order.frontier_machine, q)) return false;
  }
  if (qPart) {
    const q = qPart.trim().toLowerCase();
    if (q && !asArray(order.part_names).some((p) => inc(p, q))) return false;
  }
  return true;
}

function FilterInput({ icon, value, onChange, placeholder }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {icon}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
          aria-label="Hapus"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function buildGroups(list, groupBy) {
  if (groupBy === 'machine') {
    const map = new Map();
    for (const o of list) {
      const k = o.frontier_machine || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    }
    return [...map.keys()]
      .sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b)))
      .map((k) => ({
        key: `machine:${k}`,
        title: k === '—' ? 'Tanpa Mesin' : `Mesin ${k}`,
        tone: 'no_data',
        items: map.get(k),
      }));
  }

  const isDone = (o) => asNum(o.total_ops) > 0 && asNum(o.done_ops) >= asNum(o.total_ops);
  const deviating = list.filter((o) => o.status_color === 'red' || o.status_color === 'amber');
  const onTrack = list.filter((o) => o.status_color === 'green' && !isDone(o));
  const done = list.filter((o) => o.status_color === 'green' && isDone(o));
  const groups = [];

  if (deviating.length)
    groups.push({
      key: 'status:menyimpang',
      title: 'Menyimpang',
      tone: 'critical',
      items: deviating,
      uncapped: true,
    });
  if (onTrack.length)
    groups.push({ key: 'status:dijalur', title: 'Di jalur', tone: 'normal', items: onTrack });
  if (done.length)
    groups.push({ key: 'status:selesai', title: 'Selesai', tone: 'normal', items: done });
  return groups;
}

function GroupSection({ group, collapsed, onToggle, renderCard }) {
  const t = STATUS_TOKENS[group.tone] || STATUS_TOKENS.no_data;
  return (
    <section>
      <button
        type="button"
        onClick={() => onToggle(group.key)}
        className="sticky top-0 z-10 flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm active:scale-[0.99]"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-extrabold text-slate-800">{group.title}</span>
          <span
            className="rounded-full border px-2 py-0.5 text-[11px] font-bold"
            style={{ backgroundColor: t.bg, color: t.text, borderColor: t.border }}
          >
            {group.items.length}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed &&
        (() => {
          const cap = group.uncapped ? Infinity : CARD_CAP;
          const shown = group.items.slice(0, cap);
          const hidden = group.items.length - shown.length;
          return (
            <div className="mt-2 flex flex-col gap-2.5">
              {shown.map(renderCard)}
              {hidden > 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5 text-center text-xs font-semibold text-slate-500">
                  dan {hidden} order lainnya — gunakan pencarian untuk mempersempit.
                </div>
              )}
            </div>
          );
        })()}
    </section>
  );
}

function NyangkutSheet({ target, busy, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  if (!target) return null;
  const op = target.op;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] md:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl md:mx-4 md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Tandai Tertahan — Operasi {op.operation_no}
            </h3>
            <p className="text-xs text-slate-500">
              Pilih atau tuliskan alasan operasi ini tertahan.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600"
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {NYANGKUT_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                reason === r
                  ? 'border-[#0096c7] bg-[#e0f2fe] text-[#0077b6]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Alasan tertahan…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-95"
          >
            Batal
          </button>
          <button
            disabled={!reason.trim() || busy}
            onClick={() => onSubmit(reason.trim())}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Tandai Tertahan
          </button>
        </div>
      </div>
    </div>
  );
}

function SowVerificationPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayISO);
  const [scopeAll, setScopeAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ date: null, fallback: false });

  const [qOrder, setQOrder] = useState('');
  const [qMachine, setQMachine] = useState('');
  const [qPart, setQPart] = useState('');
  const [groupBy, setGroupBy] = useState('status');

  const [collapseOverride, setCollapseOverride] = useState({});

  const [expanded, setExpanded] = useState(null);
  const [ladders, setLadders] = useState({});
  const [busyOp, setBusyOp] = useState(null);
  const [confirmDilewati, setConfirmDilewati] = useState(null);
  const [nyangkut, setNyangkut] = useState(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchOrderProgress(scopeAll ? { scope: 'all' } : { date });
        setOrders(asArray(res.data));
        setMeta({ date: res.date, fallback: !!res.fallback, scope: res.scope });
      } catch (err) {
        setError(err.message || 'Gagal memuat data verifikasi');
      } finally {
        setLoading(false);
      }
    },
    [date, scopeAll]
  );

  const loadLadder = useCallback(async (po, silent = false) => {
    setLadders((prev) => ({
      ...prev,
      [po]: { ...(prev[po] || {}), loading: !silent, error: null },
    }));
    try {
      const res = await fetchOrderOperations({ production_order: po });
      setLadders((prev) => ({
        ...prev,
        [po]: { loading: false, error: null, operations: asArray(res.operations) },
      }));
    } catch (err) {
      setLadders((prev) => ({
        ...prev,
        [po]: { loading: false, error: err.message || 'Gagal memuat operasi', operations: [] },
      }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (expanded && !ladders[expanded]) loadLadder(expanded);
  }, [expanded, ladders, loadLadder]);

  const toggle = useCallback((po) => {
    setExpanded((prev) => (prev === po ? null : po));
  }, []);

  const defaultCollapsed = (key) => key !== 'status:menyimpang';
  const isCollapsed = (key) =>
    key in collapseOverride ? collapseOverride[key] : defaultCollapsed(key);
  const toggleCollapse = useCallback((key) => {
    setCollapseOverride((prev) => {
      const cur = key in prev ? prev[key] : key !== 'status:menyimpang';
      return { ...prev, [key]: !cur };
    });
  }, []);

  const setAllGroups = useCallback((keys, collapsedVal) => {
    setCollapseOverride(() => {
      const next = {};
      keys.forEach((k) => {
        next[k] = collapsedVal;
      });
      return next;
    });
  }, []);

  const doMark = useCallback(
    async ({ order, op, manual_flag, blocked_reason }) => {
      const key = `${order}:${op.operation_no}`;
      setBusyOp(key);
      try {
        await markOperationStatus({
          production_order: order,
          operation_no: op.operation_no,
          machine_code: op.machine_code,
          status_date: op.status_date,
          manual_flag,
          blocked_reason: blocked_reason || undefined,
        });
        toast.success(
          `Operasi ${op.operation_no} ditandai ${FLAG_LABEL[manual_flag] || manual_flag}`
        );
        await Promise.all([loadLadder(order, true), load(true)]);
        return true;
      } catch (err) {
        toast.error(err.message || 'Gagal menandai operasi');
        return false;
      } finally {
        setBusyOp(null);
      }
    },
    [load, loadLadder]
  );

  const doClear = useCallback(
    async (order, op) => {
      const key = `${order}:${op.operation_no}`;
      setBusyOp(key);
      try {
        await clearOperationStatus(op.manual_status_id);
        toast.success(`Penandaan Operasi ${op.operation_no} dibatalkan`);
        await Promise.all([loadLadder(order, true), load(true)]);
      } catch (err) {
        toast.error(err.message || 'Gagal membatalkan penandaan');
      } finally {
        setBusyOp(null);
      }
    },
    [load, loadLadder]
  );

  const onDilewati = useCallback((order, op) => setConfirmDilewati({ order, op }), []);
  const onNyangkut = useCallback((order, op) => setNyangkut({ order, op }), []);

  const submitDilewati = useCallback(async () => {
    if (!confirmDilewati) return;
    await doMark({ ...confirmDilewati, manual_flag: 'dilewati' });
    setConfirmDilewati(null);
  }, [confirmDilewati, doMark]);

  const submitNyangkut = useCallback(
    async (reason) => {
      if (!nyangkut) return;
      const ok = await doMark({ ...nyangkut, manual_flag: 'nyangkut', blocked_reason: reason });
      if (ok) setNyangkut(null);
    },
    [nyangkut, doMark]
  );

  const nyangkutBusy = nyangkut
    ? busyOp === `${nyangkut.order}:${nyangkut.op.operation_no}`
    : false;

  const hasQuery = !!(qOrder || qMachine || qPart);
  const clearSearch = () => {
    setQOrder('');
    setQMachine('');
    setQPart('');
  };
  const filtered = orders.filter((o) => matchesSearch(o, { qOrder, qMachine, qPart }));
  const groups = buildGroups(filtered, groupBy);

  const renderCard = (o) => (
    <OrderProgressCard
      key={o.production_order}
      order={o}
      expanded={expanded === o.production_order}
      onToggle={toggle}
      ladder={ladders[o.production_order]}
      busyOp={busyOp}
      onReloadLadder={loadLadder}
      onDilewati={onDilewati}
      onNyangkut={onNyangkut}
      onClear={doClear}
    />
  );

  const tabCls = (id) =>
    `inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-xs font-bold transition-colors ${
      groupBy === id ? 'bg-[#0096c7] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <PageContainer className="h-screen gap-3 overflow-hidden bg-slate-50">
      {}
      <header className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => goBackOrFallback(navigate, '/operations-hub')}
              className="inline-flex h-11 min-w-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </button>
            <div>
              <p className="text-xs font-bold uppercase text-[#0077b6]">Verifikasi Harian</p>
              <h1 className="text-lg font-extrabold text-slate-900">Posisi Order Produksi</h1>
            </div>
          </div>
          <label className="min-w-[9rem] flex-1 sm:flex-none">
            <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
              Tanggal {scopeAll && <span className="text-slate-400">(Diabaikan)</span>}
            </span>
            <input
              type="date"
              value={date}
              disabled={scopeAll}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
            />
          </label>
        </div>
      </header>

      {}
      <div className="shrink-0 flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <FilterInput
            icon={<Search className="h-4 w-4" />}
            value={qOrder}
            onChange={setQOrder}
            placeholder="Cari No. Order atau SSBR…"
          />
          <FilterInput
            icon={<Cpu className="h-4 w-4" />}
            value={qMachine}
            onChange={setQMachine}
            placeholder="Cari Mesin…"
          />
          <FilterInput
            icon={<Package className="h-4 w-4" />}
            value={qPart}
            onChange={setQPart}
            placeholder="Cari Part…"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button type="button" onClick={() => setGroupBy('status')} className={tabCls('status')}>
              <Layers className="h-4 w-4" />
              Status
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('machine')}
              className={tabCls('machine')}
            >
              <Cpu className="h-4 w-4" />
              Mesin
            </button>
          </div>
          <button
            type="button"
            onClick={() => setScopeAll((v) => !v)}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors active:scale-95 ${
              scopeAll
                ? 'border-[#0096c7] bg-[#e0f2fe] text-[#0077b6]'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Tampilkan Semua
          </button>

          {}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() =>
                setAllGroups(
                  groups.map((g) => g.key),
                  false
                )
              }
              className="inline-flex min-h-[40px] items-center gap-1 rounded-md px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
              title="Buka semua grup"
            >
              <ChevronsUpDown className="h-4 w-4" />
              Buka
            </button>
            <button
              type="button"
              onClick={() =>
                setAllGroups(
                  groups.map((g) => g.key),
                  true
                )
              }
              className="inline-flex min-h-[40px] items-center gap-1 rounded-md px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
              title="Tutup semua grup"
            >
              <ChevronsDownUp className="h-4 w-4" />
              Tutup
            </button>
          </div>

          <span className="ml-auto text-xs font-bold text-slate-500">
            {filtered.length}
            {hasQuery || filtered.length !== orders.length ? ` / ${orders.length}` : ''} Order
          </span>
        </div>
      </div>

      {}
      {scopeAll ? (
        <div className="shrink-0 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
          <AlertCircle className="h-4 w-4 shrink-0 text-[#0077b6]" />
          Menampilkan seluruh order aktif (belum TECO). Tanggal diabaikan.
        </div>
      ) : meta.fallback && meta.date ? (
        <div
          className="shrink-0 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"
          style={{
            backgroundColor: STATUS_TOKENS.watch.bg,
            color: STATUS_TOKENS.watch.text,
            borderColor: STATUS_TOKENS.watch.border,
          }}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          Menampilkan tanggal {meta.date} — tanggal terakhir yang memiliki data.
        </div>
      ) : null}

      {}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="text-sm font-bold text-red-700">{error}</p>
            <button
              onClick={() => load()}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-100 active:scale-95"
            >
              <RotateCw className="h-4 w-4" />
              Muat Ulang
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-bold text-slate-600">
              {scopeAll ? 'Tidak ada order aktif.' : 'Tidak ada order aktif pada tanggal ini.'}
            </p>
            <p className="text-xs text-slate-500">
              {scopeAll ? '' : 'Silakan pilih tanggal lain atau tekan "Tampilkan Semua".'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-bold text-slate-600">
              Tidak ada order yang cocok dengan pencarian.
            </p>
            <button
              onClick={clearSearch}
              className="text-xs font-bold text-[#0096c7] hover:underline"
            >
              Hapus Pencarian
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-4">
            {groups.map((g) => (
              <GroupSection
                key={g.key}
                group={g}
                collapsed={isCollapsed(g.key)}
                onToggle={toggleCollapse}
                renderCard={renderCard}
              />
            ))}
          </div>
        )}
      </div>

      {}
      <ConfirmationModal
        isOpen={!!confirmDilewati}
        title={
          confirmDilewati
            ? `Tandai Operasi ${confirmDilewati.op.operation_no} sebagai dilewati?`
            : ''
        }
        message="Operasi ini akan ditandai dilewati dan dicatat sebagai tunggakan hingga diselesaikan. Penandaan dapat dibatalkan kembali."
        confirmLabel="Ya, Tandai Dilewati"
        cancelLabel="Batal"
        onConfirm={submitDilewati}
        onCancel={() => setConfirmDilewati(null)}
      />

      {}
      <NyangkutSheet
        key={nyangkut ? `${nyangkut.order}:${nyangkut.op.operation_no}` : 'none'}
        target={nyangkut}
        busy={nyangkutBusy}
        onSubmit={submitNyangkut}
        onClose={() => setNyangkut(null)}
      />
    </PageContainer>
  );
}

export default SowVerificationPage;
