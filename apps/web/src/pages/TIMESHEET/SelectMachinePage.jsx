import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import { toast } from 'sonner';
import { normalizeNfcId } from '../../utils/nfcId';

const API_BASE = import.meta.env.VITE_API_URL || '';

const SelectMachinePage = () => {
  const navigate = useNavigate();

  const [wcMode, setWcMode] = useState(() => sessionStorage.getItem('wcMode') || 'reguler');
  const [searchInput, setSearchInput] = useState('');
  const [machines, setMachines] = useState([]);
  const [filteredMachines, setFilteredMachines] = useState([]);

  useEffect(() => {
    loadMachines();
  }, []);

  useEffect(() => {
    if (!searchInput.trim()) {
      setFilteredMachines(machines);
      return;
    }
    const kw = searchInput.toLowerCase();
    setFilteredMachines(
      machines.filter(
        (m) =>
          m.workcenter_description?.toLowerCase().includes(kw) ||
          m.machineid?.toLowerCase().includes(kw) ||
          m.groupname?.toLowerCase().includes(kw)
      )
    );
  }, [searchInput, machines]);

  const loadMachines = async () => {
    try {
      const res = await fetch(`${API_BASE}/workcenter/`);
      if (!res.ok) throw new Error('Gagal load mesin');
      const data = await res.json();
      setMachines(data?.length ? data : []);
      setFilteredMachines(data?.length ? data : []);
    } catch (err) {
      console.error('Error loading machines:', err);
      toast.error('Gagal load data mesin', { description: err.message });
      setMachines([]);
      setFilteredMachines([]);
    }
  };

  const handleModeToggle = (checked) => {
    const newMode = checked ? 'overtime' : 'reguler';
    setWcMode(newMode);
    sessionStorage.setItem('wcMode', newMode);
  };

  const handleSelectMachine = async (machine) => {
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      if (!datakaryawan) {
        toast.error('Data karyawan tidak ditemukan. Silakan login kembali.');
        navigate('/login-timesheet');
        return;
      }

      if (isOT && !machine.workcenterot) {
        toast.warning('Workcenter Overtime tidak tersedia untuk mesin ini.');
        return;
      }

      const selectedWorkcenter = isOT ? machine.workcenterot : machine.workcenternew;

      const response = await fetch(`${API_BASE}/usernfc/update/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialnumber: datakaryawan.snssb,
          machineid: machine.machineid,
          machinename: machine.workcenter_description,
          workcenter: selectedWorkcenter,
        }),
      });
      if (!response.ok) throw new Error('Gagal update mesin');

      const res = await fetch(
        `${API_BASE}/usernfc/nfcid/${encodeURIComponent(normalizeNfcId(datakaryawan.nfcid))}`
      );
      if (res.ok) sessionStorage.setItem('datakaryawan', JSON.stringify(await res.json()));

      navigate('/timesheet-mainmenu');
    } catch (err) {
      console.error('Error selecting machine:', err);
      toast.error('Update mesin gagal', { description: err.message });
    }
  };

  const isOT = wcMode === 'overtime';

  const btnOutline =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ' +
    'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 ' +
    'transition-all duration-150 active:scale-95 min-h-[44px]';

  return (
    <div className="h-dvh w-screen bg-slate-50 flex flex-col overflow-hidden">
      {}
      <header
        className="flex-shrink-0 flex items-center justify-between
                         px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm"
      >
        <button onClick={() => goBackOrFallback(navigate)} className={btnOutline}>
          Back
        </button>
        <h1 className="text-sm font-extrabold text-slate-800">Select Machine</h1>
        <button onClick={loadMachines} className={btnOutline}>
          Refresh
        </button>
      </header>

      {}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 space-y-2">
        {}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search machine, ID, or group..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 text-slate-800
                       placeholder-slate-400 rounded-lg text-sm focus:outline-none
                       focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]
                       transition-all duration-150 min-h-[44px]"
          />
        </div>

        {}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">
            {filteredMachines.length} mesin ditemukan
          </span>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold transition-colors ${isOT ? 'text-slate-400' : 'text-slate-700'}`}
            >
              Reguler
            </span>
            <label className="relative inline-block w-11 h-6 cursor-pointer">
              <input
                type="checkbox"
                checked={isOT}
                onChange={(e) => handleModeToggle(e.target.checked)}
                className="sr-only"
              />
              <span
                className={`
                absolute inset-0 rounded-full transition-colors duration-300
                ${isOT ? 'bg-amber-500' : 'bg-[#0096c7]'}
                before:content-[''] before:absolute before:h-5 before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full
                before:transition-transform before:duration-300 before:shadow-sm
                ${isOT ? 'before:translate-x-5' : 'before:translate-x-0'}
              `}
              />
            </label>
            <span
              className={`text-xs font-bold transition-colors ${isOT ? 'text-amber-500' : 'text-slate-400'}`}
            >
              Overtime
            </span>
          </div>
        </div>
      </div>

      {}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredMachines.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 mt-12">
            <svg
              className="w-10 h-10 text-slate-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span className="text-sm text-slate-400">Tidak ada mesin ditemukan</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredMachines.map((machine, index) => {
              const workcenterText = isOT ? machine.workcenterot : machine.workcenternew;
              return (
                <div
                  key={index}
                  onClick={() => handleSelectMachine(machine)}
                  className={`relative rounded-lg overflow-hidden cursor-pointer bg-white shadow-sm
                             transition-all duration-150 hover:shadow-md hover:-translate-y-0.5
                             active:translate-y-0 active:scale-[0.99]
                             ${
                               isOT
                                 ? 'border border-amber-200 hover:border-amber-400'
                                 : 'border border-slate-200 hover:border-[#0096c7]'
                             }`}
                >
                  {}
                  <div
                    className="px-3 py-2 flex items-center justify-between"
                    style={
                      isOT
                        ? { background: '#fef3c7', borderBottom: '1px solid #fde68a' }
                        : { background: '#caf0f8', borderBottom: '1px solid #90e0ef' }
                    }
                  >
                    <span className="text-sm font-bold text-slate-800 truncate pr-2">
                      {machine.workcenter_description}
                    </span>
                    {isOT && (
                      <span className="flex-shrink-0 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                        OT
                      </span>
                    )}
                  </div>

                  {}
                  <div className="px-3 py-2.5 space-y-1.5">
                    <div className="flex text-[11px]">
                      <span className="w-[70px] flex-shrink-0 font-medium text-slate-500">ID</span>
                      <span className="font-semibold text-slate-800">: {machine.machineid}</span>
                    </div>
                    <div className="flex text-[11px]">
                      <span className="w-[70px] flex-shrink-0 font-medium text-slate-500">
                        Group
                      </span>
                      <span className="font-semibold text-slate-800">: {machine.groupname}</span>
                    </div>
                    <div className="flex text-[11px]">
                      <span className="w-[70px] flex-shrink-0 font-medium text-slate-500">
                        WC Code
                      </span>
                      <span className="font-bold" style={{ color: isOT ? '#d97706' : '#0096c7' }}>
                        : {workcenterText || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SelectMachinePage;
