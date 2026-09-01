import React from 'react';

const stages = [
  {
    id: 'machining',
    title: 'Machining',
    machine: 'CNC CELL',
    tone: 'violet',
    active: [
      {
        id: 'RUN-001',
        component: 'Hydraulic Pump Shaft',
        serial: 'SN-A10291',
        workOrder: 'WO-2026-0012',
        machine: 'CNC-01',
        operator: 'Fajar',
        progress: 72,
        runtime: '01:22:14',
        priority: 'AOG',
        temperature: '48°C',
      },
    ],
    bufferIn: [
      {
        id: 'BIN-001',
        component: 'Pump Housing',
        serial: 'SN-L77649',
        eta: '12 min',
        queue: 1,
        priority: 'Normal',
      },
      {
        id: 'BIN-002',
        component: 'Bearing Sleeve',
        serial: 'SN-P11291',
        eta: '24 min',
        queue: 2,
        priority: 'Urgent',
      },
    ],
    bufferOut: [
      {
        id: 'BOUT-001',
        component: 'Valve Seat',
        serial: 'SN-V90211',
        waiting: '00:41',
        destination: 'Inspection',
      },
    ],
  },
  {
    id: 'inspection',
    title: 'Inspection',
    machine: 'QC AREA',
    tone: 'red',
    bottleneck: true,
    active: [
      {
        id: 'RUN-002',
        component: 'Main Pump',
        serial: 'SN-K90217',
        workOrder: 'WO-2026-0102',
        machine: 'QC-01',
        operator: 'Raka',
        progress: 35,
        runtime: '02:51:33',
        priority: 'Overdue',
        temperature: '--',
      },
    ],
    bufferIn: [
      {
        id: 'BIN-003',
        component: 'Seal Kit',
        serial: 'SN-J44310',
        eta: '5 min',
        queue: 1,
        priority: 'Urgent',
      },
      {
        id: 'BIN-004',
        component: 'Bearing Housing',
        serial: 'SN-L31822',
        eta: '17 min',
        queue: 2,
        priority: 'Normal',
      },
      {
        id: 'BIN-005',
        component: 'Rotor Core',
        serial: 'SN-R11881',
        eta: '31 min',
        queue: 3,
        priority: 'Hold',
      },
    ],
    bufferOut: [
      {
        id: 'BOUT-002',
        component: 'Hydraulic Block',
        serial: 'SN-H77129',
        waiting: '01:14',
        destination: 'Assembly',
      },
      {
        id: 'BOUT-003',
        component: 'Servo Ring',
        serial: 'SN-S11822',
        waiting: '00:52',
        destination: 'Machining',
      },
    ],
  },
  {
    id: 'assembly',
    title: 'Assembly',
    machine: 'ASSEMBLY LINE',
    tone: 'emerald',
    active: [
      {
        id: 'RUN-003',
        component: 'Control Unit',
        serial: 'SN-Q10466',
        workOrder: 'WO-2026-0120',
        machine: 'ASSY-02',
        operator: 'Team A',
        progress: 56,
        runtime: '00:48:12',
        priority: 'Normal',
        temperature: '--',
      },
    ],
    bufferIn: [
      {
        id: 'BIN-006',
        component: 'Pressure Valve',
        serial: 'SN-P77210',
        eta: '8 min',
        queue: 1,
        priority: 'Normal',
      },
    ],
    bufferOut: [
      {
        id: 'BOUT-004',
        component: 'Servo Motor',
        serial: 'SN-M33102',
        waiting: '00:22',
        destination: 'Testing',
      },
    ],
  },
];

function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

function toneMap(tone) {
  const styles = {
    violet: {
      glow: 'shadow-violet-950/40',
      border: 'border-violet-400/30',
      bg: 'bg-violet-500/[0.08]',
      accent: 'bg-violet-300',
      soft: 'bg-violet-400/10',
      text: 'text-violet-100',
    },
    red: {
      glow: 'shadow-red-950/50',
      border: 'border-red-400/30',
      bg: 'bg-red-500/[0.08]',
      accent: 'bg-red-300',
      soft: 'bg-red-400/10',
      text: 'text-red-100',
    },
    emerald: {
      glow: 'shadow-emerald-950/40',
      border: 'border-emerald-400/30',
      bg: 'bg-emerald-500/[0.08]',
      accent: 'bg-emerald-300',
      soft: 'bg-emerald-400/10',
      text: 'text-emerald-100',
    },
  };

  return styles[tone];
}

function priorityClass(priority) {
  if (['AOG', 'Overdue', 'Urgent'].includes(priority)) {
    return 'border-red-400/40 bg-red-500/15 text-red-100';
  }

  if (['Hold'].includes(priority)) {
    return 'border-amber-400/40 bg-amber-500/15 text-amber-100';
  }

  return 'border-slate-600 bg-slate-900 text-slate-200';
}

function validateFlowBoard() {
  const errors = [];

  if (!stages.every((stage) => stage.active.length > 0)) {
    errors.push('Each stage requires active process card.');
  }

  if (!stages.every((stage) => Array.isArray(stage.bufferIn) && Array.isArray(stage.bufferOut))) {
    errors.push('Each stage requires buffer in/out arrays.');
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

export const advancedFlowBoardTests = {
  validateFlowBoard,
};

function ProgressRing({ progress }) {
  return (
    <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/20 bg-slate-950">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="42"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx="50"
          cy="50"
          r="42"
          stroke="rgb(103 232 249)"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={264}
          strokeDashoffset={264 - (264 * progress) / 100}
        />
      </svg>
      <span className="relative text-sm font-semibold text-cyan-100">{progress}%</span>
    </div>
  );
}

function ActiveCard({ item }) {
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-cyan-300/20 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 p-4 shadow-2xl shadow-cyan-950/20">
      <div className="absolute inset-x-0 top-0 h-1 bg-cyan-300" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-lg shadow-emerald-300 animate-pulse" />
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Machine Running</p>
          </div>

          <h3 className="mt-3 text-lg font-semibold text-white">{item.component}</h3>
          <p className="mt-1 text-sm text-slate-400">{item.serial}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span
              className={cn(
                'rounded-full border px-2 py-1 text-[10px] font-medium',
                priorityClass(item.priority)
              )}
            >
              {item.priority}
            </span>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">
              {item.machine}
            </span>
          </div>
        </div>

        <ProgressRing progress={item.progress} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Operator</p>
          <p className="mt-1 text-sm font-medium text-slate-100">{item.operator}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Runtime</p>
          <p className="mt-1 text-sm font-medium text-cyan-100">{item.runtime}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Temperature</p>
          <p className="mt-1 text-sm font-medium text-slate-100">{item.temperature}</p>
        </div>
      </div>
    </div>
  );
}

function QueueCard({ item, type }) {
  const isIn = type === 'in';

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-3 transition hover:border-cyan-300/40 hover:bg-slate-950">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{item.component}</p>
          <p className="mt-1 text-[11px] text-slate-500">{item.serial}</p>
        </div>

        {item.priority && (
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px]',
              priorityClass(item.priority)
            )}
          >
            {item.priority}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px]">
        {isIn ? (
          <>
            <span className="text-slate-500">Queue #{item.queue}</span>
            <span className="font-medium text-cyan-100">ETA {item.eta}</span>
          </>
        ) : (
          <>
            <span className="text-slate-500">Waiting Move</span>
            <span className="font-medium text-amber-100">{item.waiting}</span>
          </>
        )}
      </div>

      {!isIn && (
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Destination</span>
          <span className="font-medium text-emerald-100">{item.destination}</span>
        </div>
      )}
    </div>
  );
}

function Stage({ stage }) {
  const tone = toneMap(stage.tone);

  return (
    <section
      className={cn(
        'flex w-[430px] shrink-0 flex-col rounded-[32px] border p-4 shadow-2xl',
        tone.border,
        tone.bg,
        tone.glow
      )}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={cn('h-3 w-3 rounded-full', tone.accent)} />
            <h2 className="text-xl font-semibold text-white">{stage.title}</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">{stage.machine}</p>
        </div>

        {stage.bottleneck && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100">
            BOTTLENECK
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
            <h3 className="text-sm font-semibold tracking-wide text-emerald-100">
              ON GOING PROCESS
            </h3>
          </div>
          <span className="text-xs text-slate-500">Machine Active</span>
        </div>

        <div className="space-y-3">
          {stage.active.map((item) => (
            <ActiveCard key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-[24px] border border-cyan-300/10 bg-slate-950/40 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-cyan-100">BUFFER IN</p>
              <p className="mt-1 text-[11px] text-slate-500">Waiting machine slot</p>
            </div>
            <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100">
              {stage.bufferIn.length}
            </span>
          </div>

          <div className="space-y-2">
            {stage.bufferIn.map((item) => (
              <QueueCard key={item.id} item={item} type="in" />
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-amber-300/10 bg-slate-950/40 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-amber-100">BUFFER OUT</p>
              <p className="mt-1 text-[11px] text-slate-500">Waiting transfer</p>
            </div>
            <span className="rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-100">
              {stage.bufferOut.length}
            </span>
          </div>

          <div className="space-y-2">
            {stage.bufferOut.map((item) => (
              <QueueCard key={item.id} item={item} type="out" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function AdvancedSalvageKanbanFlowBoard() {
  const validation = validateFlowBoard();

  return (
    <div className="min-h-screen overflow-hidden bg-[#050b16] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-20 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />
      </div>

      <main className="relative flex h-screen flex-col p-5">
        <header className="mb-5 flex items-center justify-between rounded-[30px] border border-slate-800 bg-slate-950/70 px-6 py-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                ⬡
              </div>

              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">
                  Salvage Flowboard
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Real-time process tracking with machine runtime, queue visibility, and transfer
                  buffers
                </p>
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-3 xl:flex">
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-200/70">Running</p>
              <p className="mt-1 text-lg font-semibold text-emerald-100">
                {stages.reduce((sum, s) => sum + s.active.length, 0)} Machines
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.25em] text-cyan-200/70">Buffer In</p>
              <p className="mt-1 text-lg font-semibold text-cyan-100">
                {stages.reduce((sum, s) => sum + s.bufferIn.length, 0)} Queue
              </p>
            </div>

            <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.25em] text-amber-200/70">
                Buffer Out
              </p>
              <p className="mt-1 text-lg font-semibold text-amber-100">
                {stages.reduce((sum, s) => sum + s.bufferOut.length, 0)} Waiting Move
              </p>
            </div>
          </div>
        </header>

        {!validation.passed && (
          <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {validation.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}

        <section className="flex-1 overflow-hidden rounded-[36px] border border-slate-800 bg-slate-950/40 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex h-full gap-5 overflow-x-auto pb-3">
            {stages.map((stage) => (
              <Stage key={stage.id} stage={stage} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
