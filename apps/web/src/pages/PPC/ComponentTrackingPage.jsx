import React, { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ArrowLeft,
  Clock3,
  Factory,
  Gauge,
  Package,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { goBackOrFallback } from '../../utils/navigation';
import { PageContainer, SearchRow } from '../../components';
import { useMachineTracking } from '../../hooks/useMachineTracking';

const skeletonItems = Array.from({ length: 6 }, (_, index) => index);

function formatElapsed(seconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseDbTimestamp(value) {
  if (!value) return null;

  const normalized = String(value)
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getElapsedSeconds(checkinTime, fallbackSeconds = 0) {
  const checkinDate = parseDbTimestamp(checkinTime);
  if (!checkinDate) return Number(fallbackSeconds || 0);

  return Math.floor((Date.now() - checkinDate.getTime()) / 1000);
}

function StatTile({ label, value, icon: Icon, tone = 'text-slate-700' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
      <div className={`mt-3 text-3xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function MachineSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-28 rounded bg-slate-200" />
          <div className="h-8 w-8 rounded-full bg-slate-200" />
        </div>
        <div className="h-8 w-36 rounded bg-slate-200" />
        <div className="h-4 w-44 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-14 rounded bg-slate-200" />
          <div className="h-14 rounded bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function ElapsedTime({ isRunning, checkinTime, fallbackSeconds }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    isRunning ? getElapsedSeconds(checkinTime, fallbackSeconds) : 0
  );

  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return undefined;
    }

    setElapsedSeconds(getElapsedSeconds(checkinTime, fallbackSeconds));
    const timer = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(checkinTime, fallbackSeconds));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [fallbackSeconds, checkinTime, isRunning]);

  return (
    <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
      {formatElapsed(elapsedSeconds)}
    </div>
  );
}

const MachineCard = memo(function MachineCard({ machine, index, onClick }) {
  const running = Boolean(machine.is_running);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.035, 0.28) }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => onClick(machine)}
      className={`cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition-all duration-300 hover:border-slate-300 hover:shadow-md ${
        running ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200 ring-0'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="max-w-[11rem] truncate text-sm font-semibold text-slate-700">
            {machine.workcenter_description || '-'}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500"></div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{machine.machineid}</div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
            running ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full transition-colors duration-300 ${running ? 'bg-emerald-500' : 'bg-slate-400'}`}
          />
          {running ? 'Running' : 'Idle'}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div
          className={`rounded-lg p-2 ${running ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
        >
          <Clock3 className="h-5 w-5" />
        </div>
        <div>
          <ElapsedTime
            isRunning={running}
            checkinTime={machine.longdate_checkin}
            fallbackSeconds={machine.elapsed_seconds}
          />
          <div className="text-xs text-slate-500"></div>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <UserRound className="h-4 w-4" />
          <span className="truncate">Operator: {machine.operator_name || '-'}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <Factory className="h-4 w-4" />
          <span className="truncate">Operation: {machine.operation_text || '-'}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div className="rounded-lg border border-slate-100 px-3 py-2">
          <div className="font-semibold text-slate-700">Order</div>
          <div className="mt-1 truncate">{machine.order_no || '-'}</div>
        </div>
        <div className="rounded-lg border border-slate-100 px-3 py-2">
          <div className="font-semibold text-slate-700">Part</div>
          <div className="mt-1 truncate">{machine.part_name || '-'}</div>
        </div>
      </div>
    </motion.div>
  );
});

function MachineSection({ title, subtitle, machines, emptyText, onCardClick }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-[#caf0f8] px-2 py-0.5 text-xs font-bold text-[#0077b6]">
          {machines.length} mesin
        </span>
      </div>

      {machines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          {emptyText}
        </div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        >
          <AnimatePresence initial={false}>
            {machines.map((machine, index) => (
              <MachineCard
                key={machine.machineid}
                machine={machine}
                index={index}
                onClick={onCardClick}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}

function MachineDetailModal({ machine, detail, loading, onClose }) {
  const buffers = detail?.buffers || [];
  const bufferIn = buffers.filter((item) => item.type === 'in');
  const bufferOut = buffers.filter((item) => item.type === 'out');
  const componentHours = detail?.componentHours || [];

  const renderBufferItems = (items, type) => {
    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          Belum ada buffer {type}.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                    item.type === 'in' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  Buffer {item.type}
                </span>
                <div className="mt-2 truncate font-semibold text-slate-900">
                  {item.component_name}
                </div>
                <div className="text-sm font-medium text-slate-600">
                  {item.type === 'in' ? 'Rencana Aktivitas' : 'Aktivitas Terakhir'} :{' '}
                  {item.operation_text || '-'} - {item.operation_no || '-'}
                </div>
                <div className="text-xs text-slate-500">
                  {item.ssbr_id || '-'} / {item.order_no || '-'}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-slate-500">
                {item.timestamp ? new Date(item.timestamp).toLocaleString('id-ID') : '-'}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {machine && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Machine Detail
                </div>
                <h3 className="font-mono text-2xl font-bold text-slate-900">{machine.machineid}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[calc(88vh-76px)] overflow-y-auto p-5">
              {loading ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <MachineSkeleton />
                  <MachineSkeleton />
                </div>
              ) : detail?.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                  {detail.error}
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-lg font-bold text-slate-900">Component Status</h4>
                      <Package className="h-5 w-5 text-slate-500" />
                    </div>
                    <div>
                      {buffers.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                          Belum ada transaksi buffer untuk mesin ini.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <div className="mb-2 text-sm font-bold text-slate-800"></div>
                            {renderBufferItems(bufferIn, 'in')}
                          </div>
                          <div className="border-t border-slate-200 pt-4">
                            <div className="mb-2 text-sm font-bold text-slate-800"></div>
                            {renderBufferItems(bufferOut, 'out')}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-bold text-slate-900">
                          Total Hours per Component
                        </h4>
                        <p className="text-xs text-slate-500"></p>
                      </div>
                      <Gauge className="h-5 w-5 text-slate-500" />
                    </div>
                    <div className="space-y-2">
                      {componentHours.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                          Belum ada histori jam komponen untuk mesin ini.
                        </div>
                      ) : (
                        componentHours.map((item, index) => (
                          <div
                            key={`${item.component_id || item.component_name}-${index}`}
                            className="rounded-lg border border-slate-200 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-900">
                                  {item.component_name}
                                </div>
                                <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                                  <div className="truncate text-sm font-bold text-slate-900">
                                    {item.ssbr_ids || '-'}
                                  </div>
                                  <div className="truncate">Order: {item.order_nos || '-'}</div>
                                  {item.transaction_count
                                    ? `${item.transaction_count} transaksi productive`
                                    : 'Belum ada transaksi productive'}
                                </div>
                              </div>
                              <div className="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-right">
                                <div className="font-mono text-lg font-bold text-emerald-700">
                                  {Number(item.total_hours || 0).toLocaleString('id-ID')} jam
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
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

const ComponentTrackingPage = () => {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const {
    machines,
    stats,
    selectedMachine,
    detail,
    loading,
    detailLoading,
    error,
    reload,
    openMachine,
    closeMachine,
  } = useMachineTracking();

  const filteredMachines = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return machines;

    return machines.filter(
      (machine) =>
        machine.machineid?.toLowerCase().includes(query) ||
        machine.operator_name?.toLowerCase().includes(query) ||
        machine.workcenter_description?.toLowerCase().includes(query) ||
        machine.order_no?.toLowerCase().includes(query) ||
        machine.part_name?.toLowerCase().includes(query)
    );
  }, [machines, searchValue]);

  const runningMachines = useMemo(
    () => filteredMachines.filter((machine) => machine.is_running),
    [filteredMachines]
  );

  const idleMachines = useMemo(
    () => filteredMachines.filter((machine) => !machine.is_running),
    [filteredMachines]
  );

  return (
    <PageContainer className="tablet-page gap-6 bg-slate-50">
      <header className="rounded-xl border-b border-slate-200 bg-white px-4 py-3 shadow-sm tablet-card">
        <div className="relative flex min-h-[42px] items-center justify-between gap-2">
          <div className="flex min-w-[7rem] items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 tablet-body"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          <div className="tablet-header-title absolute left-1/2 -translate-x-1/2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#0096c7]">
              <Activity className="h-4 w-4" />
              Real-Time
            </div>
            <h2 className="mt-1 text-2xl font-bold text-slate-800 tablet-heading">
              Component Tracking
            </h2>
          </div>
          <div className="flex items-center justify-end gap-2">
            {}
            <button
              type="button"
              onClick={() => navigate('/buffer-transaction')}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-[#0096c7] bg-white px-4 py-2 text-sm font-semibold text-[#0077b6] transition-colors hover:bg-[#caf0f8] active:bg-[#ade8f4] tablet-body"
            >
              <Package className="h-4 w-4" />
              Set Buffer
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total Mesin" value={stats.total} icon={Factory} />
        <StatTile label="Running" value={stats.running} icon={Activity} tone="text-emerald-700" />
        <StatTile label="Idle" value={stats.idle} icon={Clock3} tone="text-slate-600" />
        <StatTile
          label="Operator Aktif"
          value={stats.operators}
          icon={UserRound}
          tone="text-blue-700"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SearchRow
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Cari machine ID, operator, workcenter, order, atau part..."
          onSearch={() => {}}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {skeletonItems.map((item) => (
              <MachineSkeleton key={item} />
            ))}
          </div>
        ) : filteredMachines.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
            <Search className="h-8 w-8 text-slate-400" />
            <div className="mt-3 font-semibold text-slate-800">Mesin tidak ditemukan</div>
            <div className="text-sm text-slate-500">Coba ubah kata kunci pencarian.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <MachineSection
              title="On Going"
              subtitle=""
              machines={runningMachines}
              emptyText="Tidak ada aktivitas saat ini."
              onCardClick={openMachine}
            />
            <MachineSection
              title="Idle"
              subtitle=""
              machines={idleMachines}
              emptyText="Tidak ada mesin idle yang cocok dengan filter."
              onCardClick={openMachine}
            />
          </div>
        )}
      </div>

      <MachineDetailModal
        machine={selectedMachine}
        detail={detail}
        loading={detailLoading}
        onClose={closeMachine}
      />
    </PageContainer>
  );
};

export default ComponentTrackingPage;
