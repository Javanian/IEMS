import { createElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Monitor,
  RefreshCw,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const readSessionJson = (key, fallback = {}) => {
  try {
    return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const StatPill = ({ label, value }) => (
  <div
    className="rounded-xl border px-3 py-2"
    style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
  >
    <p className="text-[10px] font-bold uppercase text-slate-500">{label}</p>
    <p className="mt-1 truncate text-xs font-extrabold text-slate-800">{value || '-'}</p>
  </div>
);

const ActionButton = ({ icon: Icon, label, helper, tone = 'primary', onClick }) => {
  const classes =
    tone === 'outline'
      ? 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
      : tone === 'success'
        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
        : 'bg-[#0096c7] text-white hover:bg-[#0077b6]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[96px] flex-col items-start justify-between rounded-xl px-4 py-3 text-left font-bold transition-all duration-150 active:scale-95 ${classes}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
        {createElement(Icon, { size: 22 })}
      </span>
      <span>
        <span className="block text-sm font-extrabold">{label}</span>
        <span
          className={`mt-1 block text-xs font-semibold ${tone === 'outline' ? 'text-slate-500' : 'text-white/80'}`}
        >
          {helper}
        </span>
      </span>
    </button>
  );
};

export default function ManufacturingTimesheetMainMenuPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState(() => {
    const dk = readSessionJson('datakaryawan');
    return dk.mode || 'single';
  });

  const userData = useMemo(() => {
    const employee = readSessionJson('datakaryawan');
    const activity = readSessionJson('selectedactivity');

    return {
      name: employee.full_name || '-',
      sn: employee.snssb || '-',
      workcenter: employee.workcenter || '-',
      machine: employee.machinename || '-',
      order: activity.order || activity.order_no || '-',
      operation: activity.operationtext || activity.operation_text || '-',
    };
  }, []);

  const handleModeChange = async (checked) => {
    const newMode = checked ? 'multiple' : 'single';
    const dk = readSessionJson('datakaryawan');

    if (!dk.snssb) {
      toast.error('Data karyawan tidak ditemukan');
      return;
    }

    setMode(newMode);
    try {
      const res = await fetch(`${API_BASE}/usernfc/mode/${dk.snssb}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      sessionStorage.setItem('datakaryawan', JSON.stringify({ ...dk, mode: newMode }));
      toast.success(`Mode diubah ke ${newMode}`);
    } catch (err) {
      setMode(dk.mode || 'single');
      toast.error('Gagal menyimpan mode ke server');
      console.error('Failed to persist mode:', err);
    }
  };

  const postdata = async () => {
    const activity = readSessionJson('selectedactivity');
    const employee = readSessionJson('datakaryawan');

    if (!activity?.ssbr_id && !activity?.order && !activity?.order_no) {
      toast.error('Belum ada job dipilih. Silakan pilih job dulu.');
      navigate('/select-job');
      return;
    }
    if (!employee?.snssb) {
      toast.error('Data karyawan tidak ditemukan');
      return;
    }

    try {
      if (mode === 'single') {
        const checkoutRes = await fetch(`${API_BASE}/timesheet/checkout`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ datakaryawan: { sn: employee.snssb } }),
        });
        const checkedOut = await checkoutRes.json().catch(() => ({}));
        console.log('Checkout sukses:', checkedOut);
      }

      const postRes = await fetch(`${API_BASE}/timesheet/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_no: activity.order_no || activity.order,
          ssbr_id: activity.ssbr_id,
          part_name: activity.part_name || activity.partname || '',
          serialnumber: employee.snssb,
          full_name: employee.full_name,
          operation_no: activity.operation_no,
          operation_text: activity.operationtext || activity.operation_text,
          workcentercode: employee.workcenter,
          workcenterdescription: employee.machinename,
          planhours: activity.planhours || null,

          ms_area_code: activity.manufacturing_area_code || null,
          ms_bay_codes:
            activity.manufacturing_bay_codes ||
            (activity.manufacturing_bay_code ? [activity.manufacturing_bay_code] : null),
          ms_task_id: activity.task_id || null,
          ms_project_id: activity.project_id || null,
          ms_bay_schedule_id: activity.schedule_id || null,
        }),
      });

      if (!postRes.ok) {
        const error = await postRes.json().catch(() => ({}));
        console.error('Gagal POST:', error);
        toast.error('Buat timesheet gagal', { description: error.error || 'Unknown error' });
        return;
      }

      const created = await postRes.json();
      console.log('Timesheet created:', created);
      toast.success('Timesheet berhasil dibuat!');
      if (mode === 'single') navigate('/login-timesheet');
    } catch (err) {
      console.error('Error postdata:', err);
      toast.error('Terjadi kesalahan', { description: err.message });
    }
  };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <button
          type="button"
          onClick={() => navigate('/login-timesheet')}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-extrabold text-slate-800 md:text-base">
            Manufacturing Timesheet
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold transition-colors duration-200
                              ${mode === 'single' ? 'text-[#0096c7]' : 'text-slate-400'}`}
            >
              Single
            </span>
            <label className="relative inline-block h-6 w-11 cursor-pointer">
              <input
                type="checkbox"
                checked={mode === 'multiple'}
                onChange={(e) => handleModeChange(e.target.checked)}
                className="sr-only"
              />
              <span
                className={`absolute inset-0 rounded-full transition-colors duration-300
                  ${mode === 'multiple' ? 'bg-[#0096c7]' : 'bg-slate-300'}
                  before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5
                  before:rounded-full before:bg-white before:shadow-md before:transition-transform before:duration-300
                  ${mode === 'multiple' ? 'before:translate-x-5' : 'before:translate-x-0'}`}
              />
            </label>
            <span
              className={`text-xs font-semibold transition-colors duration-200
                              ${mode === 'multiple' ? 'text-[#0096c7]' : 'text-slate-400'}`}
            >
              Multiple
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-3 md:px-6 md:py-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold text-slate-800">{userData.name}</p>
              <p className="mt-0.5 font-mono text-xs font-semibold text-slate-500">{userData.sn}</p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              Manufacturing
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatPill label="Work Center" value={userData.workcenter} />
            <StatPill label="Machine" value={userData.machine} />
            <StatPill label="Order" value={userData.order} />
            <StatPill label="Operation" value={userData.operation} />
          </div>
        </section>

        <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <ActionButton
            icon={CheckCircle2}
            label="Check In"
            helper="Mulai pekerjaan"
            onClick={postdata}
          />
          <ActionButton
            icon={ClipboardList}
            label="View Timesheet"
            helper="Lihat list timesheet"
            tone="outline"
            onClick={() => navigate('/view-timesheet')}
          />
          <ActionButton
            icon={BriefcaseBusiness}
            label="Select Work Order"
            helper="Pilih order"
            tone="outline"
            onClick={() => navigate('/select-job')}
          />
          <ActionButton
            icon={Monitor}
            label="Select Workcenter"
            helper="Pilih workcenter"
            tone="outline"
            onClick={() => navigate('/select-machine')}
          />
        </section>
      </main>
    </div>
  );
}
