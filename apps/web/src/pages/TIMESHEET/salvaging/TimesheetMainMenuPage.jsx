import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Play,
  ClipboardList,
  Monitor,
  Settings,
  Clock,
  Wrench,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const TTS_API_BASE = import.meta.env.VITE_TTS_API_URL || '';

const AvatarCircle = ({ name, className = 'w-10 h-10 text-base' }) => {
  const initial = name && name !== '-' ? name.trim().charAt(0).toUpperCase() : '?';
  return (
    <div
      className={`${className} rounded-full flex-shrink-0 flex items-center justify-center
                  font-extrabold text-white select-none`}
      style={{ background: 'linear-gradient(135deg, #023e8a 0%, #0077b6 100%)' }}
    >
      {initial}
    </div>
  );
};

const InfoField = ({ label, value, mono = false }) => (
  <div
    className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
    style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
  >
    <span className="text-[11px] font-semibold text-slate-500 leading-none">{label}</span>
    <div
      className={`text-[11px] font-bold text-slate-800 leading-tight ${mono ? 'font-mono' : ''}`}
    >
      {value}
    </div>
  </div>
);

const ActivityChip = ({ activityText, activitySeq, partName, className = '' }) => {
  const hasData = activityText && activityText !== '-';
  return (
    <div
      className={`px-2.5 py-2 rounded-lg border overflow-hidden
                     ${
                       hasData
                         ? 'bg-emerald-50 border-emerald-200'
                         : 'bg-slate-50 border-slate-200 text-slate-400 italic text-[11px] font-semibold'
                     }
                     ${className}`}
    >
      {hasData ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex gap-1 text-[11px] leading-snug">
            <span className="font-semibold text-emerald-600 flex-shrink-0">Activity:</span>
            <span className="font-semibold text-emerald-700">{activityText}</span>
          </div>
          {partName && partName !== '-' && (
            <div className="flex gap-1 text-[11px] leading-snug">
              <span className="font-semibold text-emerald-600 flex-shrink-0">Part Name:</span>
              <span className="font-semibold text-emerald-700">{partName}</span>
            </div>
          )}
          {activitySeq && activitySeq !== '-' && (
            <div className="flex gap-1 text-[11px] leading-snug">
              <span className="font-semibold text-emerald-600 flex-shrink-0">Seq:</span>
              <span className="font-semibold text-emerald-700">{activitySeq}</span>
            </div>
          )}
        </div>
      ) : (
        <span>— No activity selected —</span>
      )}
    </div>
  );
};

const ActivityBox = ({ activityText, activitySeq, partName }) => {
  const hasData = activityText && activityText !== '-';
  return (
    <div
      className={`px-2.5 py-2 rounded-lg border
                     ${
                       hasData
                         ? 'bg-emerald-50 border-emerald-200'
                         : 'bg-slate-50 border-slate-200 text-slate-400 italic text-[11px] font-semibold'
                     }`}
    >
      {hasData ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex gap-1 text-[11px] leading-snug">
            <span className="font-semibold text-emerald-600 flex-shrink-0">Activity:</span>
            <span className="font-semibold text-emerald-700">{activityText}</span>
          </div>
          {partName && partName !== '-' && (
            <div className="flex gap-1 text-[11px] leading-snug">
              <span className="font-semibold text-emerald-600 flex-shrink-0">Part Name:</span>
              <span className="font-semibold text-emerald-700">{partName}</span>
            </div>
          )}
          {activitySeq && activitySeq !== '-' && (
            <div className="flex gap-1 text-[11px] leading-snug">
              <span className="font-semibold text-emerald-600 flex-shrink-0">Seq:</span>
              <span className="font-semibold text-emerald-700">{activitySeq}</span>
            </div>
          )}
        </div>
      ) : (
        '— No activity selected —'
      )}
    </div>
  );
};

const TimesheetMainMenuPage = () => {
  const navigate = useNavigate();

  const [mode, setMode] = useState(() => {
    const dk = JSON.parse(sessionStorage.getItem('datakaryawan') || '{}');
    return dk.mode || 'single';
  });
  const [userData, setUserData] = useState({
    name: '-',
    sn: '-',
    workcenterCode: '-',
    machineName: '-',
    order: '-',
    ident: '-',
    partName: '-',
    activityText: '-',
    activitySeq: '-',
  });

  useEffect(() => {
    const selectedactivity = JSON.parse(sessionStorage.getItem('selectedactivity'));
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

    const newData = {
      name: '-',
      sn: '-',
      workcenterCode: '-',
      machineName: '-',
      order: '-',
      ident: '-',
      partName: '-',
      activityText: '-',
      activitySeq: '-',
    };

    if (datakaryawan) {
      newData.name = datakaryawan.full_name || '-';
      newData.sn = datakaryawan.snssb || '-';
      newData.workcenterCode = datakaryawan.workcenter || '-';
      newData.machineName = datakaryawan.machinename || '-';
    }

    if (selectedactivity) {
      newData.order = selectedactivity.order || '-';
      newData.ident = selectedactivity.ssbr_id || '-';
      newData.partName = selectedactivity.part_name || selectedactivity.partname || '-';
      newData.activityText = selectedactivity.operationtext || '-';
      newData.activitySeq = selectedactivity.operation_no || '-';
    }

    setUserData(newData);
  }, []);

  const handleModeChange = async (checked) => {
    const newMode = checked ? 'multiple' : 'single';
    const dk = JSON.parse(sessionStorage.getItem('datakaryawan') || '{}');

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

  const goHome = () => navigate('/login-timesheet');
  const gotojob = () => navigate('/select-job');
  const gotomesin = () => navigate('/select-machine');
  const gotoparameter = () => navigate('/process-control');
  const gotots = () => navigate('/view-timesheet');
  const handleRefresh = () => window.location.reload();
  const handleRework = () => toast.info('Rework feature - Coming Soon');
  const handleConsumable = () => toast.info('Consumable feature - Coming Soon');

  const postdata = async () => {
    try {
      const selectedactivity = JSON.parse(sessionStorage.getItem('selectedactivity'));
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      if (!selectedactivity || !datakaryawan) {
        toast.error('Data tidak lengkap. Silakan pilih activity dan karyawan.');
        return;
      }

      if (mode === 'single') {
        const checkoutRes = await fetch(`${API_BASE}/timesheet/checkout`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ datakaryawan: { sn: datakaryawan.snssb } }),
        });
        const checkedOut = await checkoutRes.json();
        console.log('Checkout sukses:', checkedOut);
      }

      const postRes = await fetch(`${API_BASE}/timesheet/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_no: selectedactivity.order,
          ssbr_id: selectedactivity.ssbr_id,
          part_name: selectedactivity.part_name || selectedactivity.partname || '',
          serialnumber: datakaryawan.snssb,
          full_name: datakaryawan.full_name,
          operation_no: selectedactivity.operation_no,
          operation_text: selectedactivity.operationtext,
          workcentercode: datakaryawan.workcenter,
          workcenterdescription: datakaryawan.machinename,
          planhours: selectedactivity.planhours || null,
        }),
      });

      if (!postRes.ok) {
        const error = await postRes.json();
        console.error('Gagal POST:', error);
        toast.error('Buat timesheet gagal', { description: error.error || 'Unknown error' });
        return;
      }

      const created = await postRes.json();
      console.log('Timesheet created:', created);
      toast.success('TIMESHEET berhasil dibuat!');
      if (mode === 'single') navigate('/login-timesheet');
    } catch (err) {
      console.error('Error postdata:', err);
      toast.error('Terjadi kesalahan', { description: err.message });
    }
  };

  const finish = async () => {
    const selectedactivity = JSON.parse(sessionStorage.getItem('selectedactivity'));
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan') || '{}');
    if (!selectedactivity) {
      toast.error('Tidak ada activity yang dipilih');
      return;
    }

    try {
      const postRes = await fetch(`${API_BASE}/sow/finish/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedactivity: {
            order_no: selectedactivity.order || selectedactivity.order_no,
            ssbr_id: selectedactivity.ssbr_id,
            operation_no: selectedactivity.operation_no,
            operation_text: selectedactivity.operationtext || selectedactivity.operation_text,
            machine_id: datakaryawan.machineid,
          },
        }),
      });

      if (!postRes.ok) {
        const error = await postRes.json();
        throw new Error(error.error || 'Gagal update status');
      }

      const updated = await postRes.json();
      console.log('Update sukses:', updated);
      toast.success('Update FINISH berhasil!');

      const ssbrId = selectedactivity.ssbr_id;
      if (ssbrId) {
        try {
          const ttsRes = await fetch(`${TTS_API_BASE}/tts/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssbr_id: ssbrId }),
          });

          if (!ttsRes.ok) {
            const error = await ttsRes.json().catch(() => ({}));
            throw new Error(error.detail || error.error || 'Gagal generate audio announcement');
          }

          const ttsData = await ttsRes.json();
          console.log('TTS announcement generated:', ttsData);
          toast.success('Audio announcement berhasil dibuat');
        } catch (ttsErr) {
          console.error('Error generate TTS announcement:', ttsErr);
          toast.warning('Finish berhasil, tapi audio announcement gagal dibuat', {
            description: ttsErr.message,
          });
        }
      }

      sessionStorage.removeItem('selectedactivity');
      setUserData((prev) => ({
        ...prev,
        order: '-',
        ident: '-',
        partName: '-',
        activityText: '-',
        activitySeq: '-',
      }));
    } catch (err) {
      console.error('Error finish:', err);
      toast.error(err.message);
    }
  };

  const btnBase =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 min-h-[44px]';
  const btnOutline = `${btnBase} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300`;

  const actionBtn = `flex flex-col items-center justify-center gap-1 sm:gap-2
    bg-[#0096c7] hover:bg-[#0077b6] text-white font-bold rounded-2xl text-sm
    transition-all duration-150 hover:scale-105 active:scale-95 min-h-0`;

  const reworkCls = `flex items-center justify-center gap-1.5 text-sm font-bold text-white
    bg-amber-500 hover:bg-amber-400 rounded-xl transition-all duration-150
    active:scale-95 hover:scale-105`;
  const finishCls = `flex items-center justify-center gap-1.5 text-sm font-bold text-white
    bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all duration-150
    active:scale-95 hover:scale-105`;

  const MENU_ITEMS = [
    { icon: Play, label: 'Start', onClick: postdata },
    { icon: ClipboardList, label: 'Select Job', onClick: gotojob },
    { icon: Monitor, label: 'Select Machine', onClick: gotomesin },
    { icon: Settings, label: 'Process Control', onClick: gotoparameter },
    { icon: Clock, label: 'View Timesheet', onClick: gotots },
    { icon: Wrench, label: 'Consumable', onClick: handleConsumable },
  ];

  return (
    <div className="h-dvh w-screen bg-slate-50 flex flex-col overflow-hidden">
      {}
      <header
        className="flex-shrink-0 flex items-center justify-between
                         px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm"
      >
        <button onClick={goHome} className={btnOutline}>
          Back
        </button>

        {}
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold transition-colors duration-200
                            ${mode === 'single' ? 'text-[#0096c7]' : 'text-slate-400'}`}
          >
            Single
          </span>
          <label className="relative inline-block w-11 h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={mode === 'multiple'}
              onChange={(e) => handleModeChange(e.target.checked)}
              className="sr-only"
            />
            <span
              className={`
                absolute inset-0 rounded-full transition-colors duration-300
                ${mode === 'multiple' ? 'bg-[#0096c7]' : 'bg-slate-300'}
                before:content-[''] before:absolute before:h-5 before:w-5
                before:left-0.5 before:top-0.5 before:bg-white before:rounded-full before:shadow-md
                before:transition-transform before:duration-300
                ${mode === 'multiple' ? 'before:translate-x-5' : 'before:translate-x-0'}
              `}
            />
          </label>
          <span
            className={`text-xs font-semibold transition-colors duration-200
                            ${mode === 'multiple' ? 'text-[#0096c7]' : 'text-slate-400'}`}
          >
            Multiple
          </span>
        </div>

        <button onClick={handleRefresh} className={btnOutline}>
          Refresh
        </button>
      </header>

      {}
      <div
        className="md:hidden flex-1 min-h-0 grid"
        style={{ gridTemplateRows: '2fr 3fr', gap: '12px', padding: '12px' }}
      >
        {}
        <section
          className="bg-white rounded-xl shadow-sm border border-slate-200
                            p-3 flex flex-col gap-2 min-h-0 overflow-hidden"
        >
          {}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <AvatarCircle name={userData.name} className="w-9 h-9 text-sm" />

            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold text-slate-800 truncate leading-tight">
                {userData.name}
              </div>
              <div className="text-[11px] font-mono text-slate-500 leading-tight">
                {userData.sn}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 flex-shrink-0">
              {}
              <div className="flex flex-col justify-start gap-1.5">
                <div
                  className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
                  style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                >
                  <span className="text-[11px] font-semibold text-slate-500 leading-none">
                    Order
                  </span>
                  <div
                    className="text-[11px] font-bold font-mono leading-tight"
                    style={{ color: '#0096c7' }}
                  >
                    {userData.order}
                  </div>
                </div>
                <div
                  className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
                  style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                >
                  <span className="text-[11px] font-semibold text-slate-500 leading-none">
                    Ident
                  </span>
                  <div className="text-[11px] font-bold text-slate-800 leading-tight">
                    {userData.ident}
                  </div>
                </div>
              </div>
              {}
              <div className="flex flex-col gap-2">
                <div
                  className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
                  style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                >
                  <span className="text-[11px] font-semibold text-slate-500 leading-none">
                    Work Center
                  </span>
                  <div className="text-[11px] font-bold text-slate-800 leading-tight">
                    {userData.workcenterCode}
                  </div>
                </div>
                <div
                  className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
                  style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                >
                  <span className="text-[11px] font-semibold text-slate-500 leading-none">
                    Machine
                  </span>
                  <div className="text-[11px] font-bold text-slate-800 leading-tight">
                    {userData.machineName}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {}
          <ActivityChip
            activityText={userData.activityText}
            activitySeq={userData.activitySeq}
            partName={userData.partName}
            className="flex-1 min-h-0"
          />

          {}
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleRework} className={`${reworkCls} flex-1 min-h-[44px]`}>
              <AlertTriangle className="w-4 h-4" />
              <span>Rework</span>
            </button>
            <button onClick={finish} className={`${finishCls} flex-1 min-h-[44px]`}>
              <CheckCircle className="w-4 h-4" />
              <span>Finish</span>
            </button>
          </div>
        </section>

        {}
        <section className="grid grid-cols-2 grid-rows-3 gap-3 min-h-0">
          {MENU_ITEMS.map(({ icon: Icon, label, onClick }) => (
            <button key={label} onClick={onClick} className={actionBtn}>
              {React.createElement(Icon, { className: 'w-8 h-8 sm:w-10 sm:h-10' })}
              <span>{label}</span>
            </button>
          ))}
        </section>
      </div>

      {}
      <div className="hidden md:flex flex-1 overflow-hidden gap-3 p-3">
        {}
        <section
          className="flex-1
                            bg-white rounded-xl shadow-sm border border-slate-200
                            flex flex-col"
        >
          {}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
            {}
            <div className="flex items-center gap-3 flex-shrink-0">
              <AvatarCircle name={userData.name} className="w-12 h-12 text-xl" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 leading-tight truncate">
                  {userData.name}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">{userData.sn}</div>
              </div>
            </div>

            <div className="h-px bg-slate-100 flex-shrink-0" />

            {}
            <div className="flex flex-col flex-1 gap-3">
              {}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-3">
                  <div
                    className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
                    style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                  >
                    <span className="text-[11px] font-semibold text-slate-500 leading-none">
                      Order
                    </span>
                    <div
                      className="text-[11px] font-bold font-mono leading-tight"
                      style={{ color: '#0096c7' }}
                    >
                      {userData.order}
                    </div>
                  </div>
                  <div
                    className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border"
                    style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                  >
                    <span className="text-[11px] font-semibold text-slate-500 leading-none">
                      Ident
                    </span>
                    <div className="text-[11px] font-bold text-slate-800 leading-tight">
                      {userData.ident}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <InfoField label="Work Center" value={userData.workcenterCode} mono />
                  <InfoField label="Machine" value={userData.machineName} />
                </div>
              </div>

              {}
              <div className="flex flex-col gap-1 mt-auto">
                <span className="text-[11px] font-semibold text-slate-500">Activity</span>
                <ActivityBox
                  activityText={userData.activityText}
                  activitySeq={userData.activitySeq}
                  partName={userData.partName}
                />
              </div>
            </div>
          </div>

          {}
          <div className="flex-shrink-0 flex gap-2 p-4 pt-3 border-t border-slate-200">
            <button onClick={handleRework} className={`${reworkCls} flex-1 min-h-[52px]`}>
              <AlertTriangle className="w-4 h-4" />
              <span>Rework</span>
            </button>
            <button onClick={finish} className={`${finishCls} flex-1 min-h-[52px]`}>
              <CheckCircle className="w-4 h-4" />
              <span>Finish</span>
            </button>
          </div>
        </section>

        {}
        <section
          className="flex-1 grid grid-cols-2 gap-3 overflow-hidden"
          style={{ gridTemplateRows: 'repeat(3, 1fr)' }}
        >
          {MENU_ITEMS.map(({ icon: Icon, label, onClick }) => (
            <button key={label} onClick={onClick} className={actionBtn}>
              {React.createElement(Icon, { className: 'w-8 h-8 xl:w-10 xl:h-10' })}
              <span>{label}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
};

export default TimesheetMainMenuPage;
