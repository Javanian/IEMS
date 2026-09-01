import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, ClipboardList, Loader2, Lock, MapPin, RefreshCw, Search, Settings2, Unlock, X } from 'lucide-react';
import { toast } from 'sonner';
import { goBackOrFallback } from '../../../utils/navigation';
import { normalizeNfcId } from '../../../utils/nfcId';
import { AREA_OPTIONS, BLASTING_AREA_CODE, areaRangeLabel } from '../../../config/manufacturingAreas';

const API_BASE = import.meta.env.VITE_API_URL || '';
const AREA_STORAGE_KEY = 'mps.manufacturing.timesheet.deviceArea';
const FOREMAN_ROLE = 'FOREMAN';

function readStoredValue(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function readStoredDeviceArea() {
  const stored = readStoredValue(AREA_STORAGE_KEY);
  if (stored === 'BLASTING') {
    writeStoredValue(AREA_STORAGE_KEY, BLASTING_AREA_CODE);
    return BLASTING_AREA_CODE;
  }
  return stored;
}

function readSessionJson(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function readSessionWorkcenter() {
  try {
    const directWorkcenter = sessionStorage.getItem('workcenter');
    if (directWorkcenter) return directWorkcenter.trim();
  } catch {
  }

  const employee = readSessionJson('datakaryawan');
  return String(employee?.workcenter || employee?.workcentercode || '').trim();
}

function sameWorkcenter(left, right) {
  return String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
}

function writeStoredValue(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
  }
}

function apiUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const queryText = query.toString();
  return `${API_BASE.replace(/\/$/, '')}${path}${queryText ? `?${queryText}` : ''}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function formatHoursFromMinutes(value) {
  const minutes = Math.max(0, Number(value || 0));
  if (!minutes) return '-';
  const hours = minutes / 60;
  return `${hours.toLocaleString('id-ID', { maximumFractionDigits: 2 })} jam`;
}

function isOrderLevelJob(job) {
  return job?.is_order_level === true;
}

export default function ManufacturingSelectJobPage() {
  const navigate = useNavigate();
  const [deviceAreaCode, setDeviceAreaCode] = useState(() => readStoredDeviceArea());
  const [sessionWorkcenter, setSessionWorkcenter] = useState(() => readSessionWorkcenter());
  const [searchText, setSearchText] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deviceModal, setDeviceModal] = useState(null);
  const [pendingChange, setPendingChange] = useState(null);
  const [nfcInput, setNfcInput] = useState('');
  const [nfcError, setNfcError] = useState('');
  const [nfcVerifying, setNfcVerifying] = useState(false);
  const [areaDraft, setAreaDraft] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [verifyMode, setVerifyMode] = useState(() => sessionStorage.getItem('scanMode') || 'internal');
  const nfcReaderRef = useRef(null);
  const verifyNfcForemanRef = useRef(null);
  const proceedAfterVerifyRef = useRef(null);
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [expandedUnits, setExpandedUnits] = useState(new Set());

  const selectedArea = useMemo(
    () => AREA_OPTIONS.find((area) => area.areaCode === deviceAreaCode) || null,
    [deviceAreaCode]
  );

  const weekBounds = useMemo(() => {
    const now = new Date();
    const dayOffset = (now.getDay() + 6) % 7;
    const monday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset));
    const toISO = (d) => d.toISOString().slice(0, 10);
    return {
      start: toISO(new Date(monday.getTime() - 11 * 7 * 86400000)),
      end: toISO(new Date(monday.getTime() + 6 * 86400000)),
    };
  }, []);

  const loadJobs = useCallback(async (searchOverride) => {
    if (!deviceAreaCode) {
      toast.warning('Pilih area device terlebih dahulu');
      return;
    }
    const currentWorkcenter = readSessionWorkcenter();
    setSessionWorkcenter(currentWorkcenter);
    if (!currentWorkcenter) {
      setJobs([]);
      toast.warning('Workcenter operator tidak ditemukan di session');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/ms-project/bay-schedule-tasks', {
        area_code: deviceAreaCode,
        workcenter: currentWorkcenter,
        start_date: weekBounds.start,
        end_date: weekBounds.end,
        q: searchOverride ?? searchText,
      }));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

      const rows = (payload.data || []).filter(
        (job) => isOrderLevelJob(job) || sameWorkcenter(job.workcenter, currentWorkcenter)
      );
      setJobs(rows);
      setExpandedProjects(new Set());
      setExpandedUnits(new Set());
      if (!rows.length) {
      }
    } catch (error) {
      console.error('Failed to load manufacturing jobs:', error);
      setJobs([]);
      toast.error('Gagal load task manufacturing', { description: error.message });
    } finally {
      setLoading(false);
    }
  }, [deviceAreaCode, searchText, weekBounds]);

  useEffect(() => {
    if (deviceAreaCode) {
      loadJobs('');
    }
  }, [deviceAreaCode]);

  const applyAreaChange = (nextArea) => {
    setDeviceAreaCode(nextArea);
    setJobs([]);
    writeStoredValue(AREA_STORAGE_KEY, nextArea);
    if (nextArea) toast.success(`Area device disimpan: ${nextArea}`);
  };

  const applyResetDeviceArea = () => {
    setDeviceAreaCode('');
    setJobs([]);
    writeStoredValue(AREA_STORAGE_KEY, '');
    toast.info('Setting area device dihapus');
  };

  const verifyNfcForeman = async (rawNfcId) => {
    const nfcid = normalizeNfcId(rawNfcId);
    if (!nfcid) {
      setNfcError('NFC ID tidak valid');
      return false;
    }
    setNfcVerifying(true);
    try {
      const res = await fetch(`${API_BASE}/usernfc/nfcid/${encodeURIComponent(nfcid)}`);
      if (res.status === 409) {
        const dup = await res.json().catch(() => null);
        setNfcError(dup?.message || 'Kartu ini terdaftar atas lebih dari satu orang. Hubungi admin.');
        return false;
      }
      if (!res.ok) {
        setNfcError('NFC tidak dikenal');
        return false;
      }
      const row = await res.json().catch(() => null);
      if (!row) {
        setNfcError('NFC tidak dikenal');
        return false;
      }
      if (row.inactive_from) {
        setNfcError('Kartu nonaktif');
        return false;
      }
      if (!String(row.roles || '').toUpperCase().includes(FOREMAN_ROLE)) {
        setNfcError('Akses ditolak — hanya foreman yang bisa mengubah device area');
        return false;
      }
      return true;
    } catch (err) {
      console.error('Gagal verifikasi NFC:', err);
      setNfcError('Gagal verifikasi NFC, coba lagi');
      return false;
    } finally {
      setNfcVerifying(false);
    }
  };

  const extractNfcId = (event) => {
    if (event.serialNumber?.trim()) return normalizeNfcId(event.serialNumber);
    for (const record of event.message?.records || []) {
      if (record.recordType === 'text') {
        try {
          return normalizeNfcId(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
        } catch (e) {
          console.error('Error decoding NFC record:', e);
        }
      }
    }
    return '';
  };

  const stopNfcVerifier = useCallback(() => {
    const reader = nfcReaderRef.current;
    if (reader) {
      reader.onreading = null;
      reader.onerror = null;
      reader.stop?.();
      nfcReaderRef.current = null;
    }
  }, []);

  const startNfcVerifier = useCallback(() => {
    stopNfcVerifier();
    if (verifyMode !== 'internal' || deviceModal !== 'nfc') return;
    if (!('NDEFReader' in window)) {
      setNfcError('Browser tidak mendukung Web NFC — gunakan mode Eksternal.');
      return;
    }
    try {
      const reader = new window.NDEFReader();
      let lastReadTime = 0;
      reader.onreading = (event) => {
        const now = Date.now();
        if (now - lastReadTime < 1500) return;
        lastReadTime = now;
        const id = extractNfcId(event);
        if (!id) {
          setNfcError('NFC ID tidak terbaca');
          return;
        }
        setNfcInput(id);
        setNfcError('');
        verifyNfcForemanRef.current?.(id).then((ok) => { if (ok) proceedAfterVerifyRef.current?.(); });
      };
      reader.onerror = () => setNfcError('Error membaca NFC — tap kartu lagi');
      reader.scan().catch(() => setNfcError('Akses NFC ditolak atau gagal memulai scan'));
      nfcReaderRef.current = reader;
    } catch (err) {
      console.error('NFC Scan Error:', err);
      setNfcError('Gagal mengaktifkan scan NFC');
    }
  }, [verifyMode, deviceModal, stopNfcVerifier]);

  useEffect(() => {
    if (deviceModal === 'nfc' && verifyMode === 'internal') {
      startNfcVerifier();
    } else {
      stopNfcVerifier();
    }
    return stopNfcVerifier;
  }, [deviceModal, verifyMode, startNfcVerifier, stopNfcVerifier]);

  const toggleVerifyMode = (checked) => {
    const newMode = checked ? 'external' : 'internal';
    setVerifyMode(newMode);
    sessionStorage.setItem('scanMode', newMode);
    setNfcInput('');
    setNfcError('');
  };

  const guardDeviceChange = (apply) => {
    setPendingChange({ apply });
    setNfcInput('');
    setNfcError('');
    setDeviceModal('nfc');
  };

  const openGear = () => {
    setPendingChange(null);
    setNfcInput('');
    setNfcError('');
    setDeviceModal('nfc');
  };

  const resetDeviceArea = () => {
    guardDeviceChange(applyResetDeviceArea);
  };

  const proceedAfterVerify = () => {
    const change = pendingChange;
    if (change?.apply) {
      setPendingChange(null);
      setDeviceModal(null);
      change.apply();
      return;
    }
    setAreaDraft(deviceAreaCode || '');
    setDeviceModal('area');
  };

  const submitNfc = async (event) => {
    event.preventDefault();
    const ok = await verifyNfcForeman(nfcInput);
    if (!ok) return;
    proceedAfterVerifyRef.current?.();
  };

  verifyNfcForemanRef.current = verifyNfcForeman;
  proceedAfterVerifyRef.current = proceedAfterVerify;

  const saveArea = () => {
    applyAreaChange(areaDraft);
    setDeviceModal(null);
  };

  const closeDeviceModal = () => {
    setDeviceModal(null);
    setPendingChange(null);
    setNfcInput('');
    setNfcError('');
  };

  const groupedJobs = useMemo(() => {
    const projectMap = new Map();
    for (const job of jobs) {
      const project = job.project_name || 'Tanpa Project';
      const unit = job.unit_name || 'No Unit';
      if (!projectMap.has(project)) projectMap.set(project, new Map());
      const unitMap = projectMap.get(project);
      if (!unitMap.has(unit)) unitMap.set(unit, []);
      unitMap.get(unit).push(job);
    }
    return [...projectMap.entries()].map(([project, unitMap]) => ({
      project,
      units: [...unitMap.entries()].map(([unit, rows]) => ({ unit, rows })),
    }));
  }, [jobs]);

  const toggleProject = (project) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  const toggleUnit = (unitKey) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitKey)) next.delete(unitKey);
      else next.add(unitKey);
      return next;
    });
  };

  const handleSelectJob = (job) => {
    const plannedMinutes = Number(job.planned_work_minutes || job.duration_minutes || 0);
    const rowData = {
      order: job.task_order_no || job.order_no,
      order_no: job.task_order_no || job.order_no,
      ssbr_id: job.ssbr_id,
      part_name: job.task_name,
      operationtext: job.task_name,
      operation_text: job.task_name,
      operation_no: job.operation_no,
      planhours: plannedMinutes ? plannedMinutes / 60 : 0,
      remaining_seconds_before: null,
      workcenter: job.workcenter,
      manufacturing_area_code: job.area_code,
      manufacturing_area_name: job.area_name,
      manufacturing_bay_code: job.bay_codes?.[0] || '',
      manufacturing_bay_codes: job.bay_codes,
      schedule_id: job.schedule_id,
      task_id: job.task_id,
      project_id: job.project_id,
    };

    setSelectedJob(rowData);
    sessionStorage.setItem('selectedactivity', JSON.stringify(rowData));
    setTimeout(() => navigate('/timesheet-mainmenu'), 350);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Enter') loadJobs();
  };

  const btnOutline = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95';
  const btnPrimary = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#0077b6] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';
  const inputClass = 'min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]';
  const cellBase = 'px-3 py-2 text-[11px] align-middle';

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <button type="button" onClick={() => goBackOrFallback(navigate)} className={btnOutline}>
          Back
        </button>
        <h1 className="text-sm font-extrabold text-slate-800">Manufacturing Job Selection</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openGear} className={btnOutline} title="Ubah device area (foreman)">
            <Settings2 size={14} />
          </button>
          <button type="button" onClick={() => loadJobs()} disabled={loading} className={btnOutline}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </header>

      <section className="flex-shrink-0 border-b border-slate-200 bg-white">
        {}
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2 text-left"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <Search size={13} className="text-[#0096c7]" />
            Filter
          </span>
          {filterOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </button>

        {filterOpen && (
          <div className="px-4 pb-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                <input
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Order, task, operation, SSBR, workcenter..."
                  className={inputClass}
                />
              </label>

              <button type="button" onClick={() => loadJobs()} disabled={loading} className={`${btnPrimary} mt-5 md:mt-[18px]`}>
                <Search size={14} />
                {loading ? 'Loading' : 'Search'}
              </button>

              <button type="button" onClick={resetDeviceArea} disabled={!deviceAreaCode} className={`${btnOutline} mt-5 md:mt-[18px] disabled:cursor-not-allowed disabled:opacity-40`}>
                <X size={14} />
                Reset
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                Area tersimpan: {selectedArea ? `${selectedArea.areaCode} - ${areaRangeLabel(selectedArea)}` : 'Belum diset'}
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                Workcenter session: {sessionWorkcenter || 'Tidak ada'}
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="border-b-2" style={{ background: '#caf0f8', borderBottomColor: '#90e0ef' }}>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Order</th>
              <th className={`${cellBase} text-left font-semibold text-slate-700`}>Task</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Operation</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Actual (h)</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Hours</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Schedule</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Workcenter</th>
            </tr>
          </thead>

          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-[#0077b6]">
                      <ClipboardList size={22} />
                    </span>
                    <span className="text-sm font-semibold text-slate-500">
                      {deviceAreaCode
                        ? 'Tidak ada task schedule untuk area ini (minggu ini ke belakang).'
                        : 'Set area device terlebih dahulu.'}
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              groupedJobs.map(({ project, units }) => {
                const projectExpanded = expandedProjects.has(project);
                const projectTotal = units.reduce((total, u) => total + u.rows.length, 0);
                return (
                  <React.Fragment key={project}>
                    {}
                    <tr
                      onClick={() => toggleProject(project)}
                      className="cursor-pointer border-b border-slate-200 hover:bg-[#d4eef7]"
                      style={{ background: '#caf0f8' }}
                    >
                      <td colSpan={7} className="px-3 py-1.5 text-[11px] font-extrabold">
                        <span className="inline-flex items-center gap-1.5">
                          {projectExpanded
                            ? <ChevronDown size={13} className="text-[#0077b6]" />
                            : <ChevronRight size={13} className="text-[#0077b6]" />}
                          <span className="text-slate-800">{project}</span>
                          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500">
                            {projectTotal}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {projectExpanded && units.map(({ unit, rows }) => {
                      const unitKey = `${project}|${unit}`;
                      const unitExpanded = expandedUnits.has(unitKey);
                      return (
                        <React.Fragment key={unitKey}>
                          {}
                          <tr
                            onClick={() => toggleUnit(unitKey)}
                            className="cursor-pointer border-b border-slate-200 hover:bg-[#e8f6fb]"
                            style={{ background: '#e0f2fe' }}
                          >
                            <td colSpan={7} className="px-6 py-1 text-[11px] font-extrabold">
                              <span className="inline-flex items-center gap-1.5">
                                {unitExpanded
                                  ? <ChevronDown size={12} className="text-[#0077b6]" />
                                  : <ChevronRight size={12} className="text-[#0077b6]" />}
                                <span className="text-[#0077b6]">{unit}</span>
                                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500">
                                  {rows.length}
                                </span>
                              </span>
                            </td>
                          </tr>
                          {unitExpanded && rows.map((job, index) => {
                      const isOrderLevel = isOrderLevelJob(job);
                      const isSelected = selectedJob?.schedule_id === job.schedule_id
                        && selectedJob?.task_id === job.task_id;
                      const plannedMinutes = Number(job.planned_work_minutes || job.duration_minutes || 0);
                      const actualHours = Number(job.actual_hours || 0);
                      const overPlan = actualHours > plannedMinutes / 60;

                      return (
                        <tr
                          key={`${job.schedule_id}-${job.task_id || index}`}
                          onClick={() => handleSelectJob(job)}
                          className={`${overPlan ? 'bg-red-100' : isSelected ? 'bg-[#caf0f8]' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50'} cursor-pointer border-b border-slate-100 transition-colors duration-100 hover:bg-[#ade8f4] active:bg-[#90e0ef]`}
                        >
                          <td className={`${cellBase} text-center`}>
                            <div className="font-mono font-extrabold tabular-nums text-[#0096c7]">{job.task_order_no || job.order_no}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{(job.bay_codes || []).join(', ')}</div>
                          </td>
                          <td className={`${cellBase} text-left`}>
                            {isOrderLevel ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                                  <AlertTriangle size={11} />
                                  Order-level
                                </span>
                                <div className="mt-1 text-xs font-semibold leading-snug text-amber-700">
                                  Reservasi tingkat order — task belum ditentukan
                                </div>
                              </>
                            ) : (
                              <div className="font-semibold leading-snug text-slate-800">{job.task_name || '-'}</div>
                            )}
                          </td>
                          <td className={`${cellBase} text-center font-mono text-slate-700`}>{job.operation_no || '-'}</td>
                          <td className={`${cellBase} text-center tabular-nums ${overPlan ? 'font-extrabold text-red-700' : 'text-slate-700'}`}>
                            {actualHours > 0 ? `${actualHours.toFixed(1)}h` : '-'}
                          </td>
                          <td className={`${cellBase} text-center tabular-nums text-slate-700`}>{formatHoursFromMinutes(plannedMinutes)}</td>
                          <td className={`${cellBase} text-center text-slate-700`}>
                            {formatDate(job.start_date)} - {formatDate(job.end_date)}
                          </td>
                          <td className={`${cellBase} text-center font-semibold text-slate-800`}>{job.workcenter || '-'}</td>
                        </tr>
                      );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {deviceModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-0 md:items-center md:px-4">
          {deviceModal === 'nfc' ? (
            <form
              onSubmit={submitNfc}
              className="w-full rounded-t-2xl bg-white p-6 shadow-xl md:max-w-sm md:rounded-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
                    <Lock size={18} />
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-800">Verifikasi Foreman</h2>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {verifyMode === 'internal'
                        ? 'Dekatkan kartu foreman ke NFC reader'
                        : 'Scan atau ketik NFC ID foreman'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDeviceModal}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  aria-label="Tutup"
                >
                  <X size={16} />
                </button>
              </div>

              {}
              <label className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <span className="text-xs font-bold text-slate-700">
                  {verifyMode === 'internal' ? 'Internal — scan NFC' : 'Eksternal — scanner / manual'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={verifyMode === 'external'}
                  onClick={() => toggleVerifyMode(verifyMode !== 'external')}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${verifyMode === 'external' ? 'bg-[#0096c7]' : 'bg-slate-300'}`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      verifyMode === 'external' ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </label>

              <input
                type="text"
                value={nfcInput}
                onChange={(event) => { setNfcInput(event.target.value); setNfcError(''); }}
                placeholder="NFC ID"
                autoFocus
                className={`mt-3 w-full ${inputClass}`}
              />

              {nfcError && (
                <p className="mt-2 text-xs font-semibold text-red-600">{nfcError}</p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeviceModal}
                  className={btnOutline}
                >
                  Batal
                </button>
                <button type="submit" disabled={nfcVerifying} className={`${btnPrimary} disabled:opacity-50`}>
                  {nfcVerifying ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
                  Verifikasi
                </button>
              </div>
            </form>
          ) : (
            <div className="w-full rounded-t-2xl bg-white p-6 shadow-xl md:max-w-sm md:rounded-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#caf0f8] text-[#0077b6]">
                    <Settings2 size={18} />
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-800">Ubah Device Area</h2>
                    <p className="text-[11px] font-semibold text-slate-500">Verifikasi foreman berhasil</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDeviceModal}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                  aria-label="Tutup"
                >
                  <X size={16} />
                </button>
              </div>

              <label className="mt-5 grid gap-1 text-xs font-bold text-slate-700">
                <span>Device Area</span>
                <select value={areaDraft} onChange={(event) => setAreaDraft(event.target.value)} className={inputClass}>
                  <option value="">Pilih area</option>
                  {AREA_OPTIONS.map((area) => (
                    <option key={area.areaCode} value={area.areaCode}>
                      {area.areaCode} - {areaRangeLabel(area)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { applyResetDeviceArea(); setDeviceModal(null); }}
                  className="text-xs font-bold text-red-600 hover:text-red-700"
                >
                  Hapus Setting
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={closeDeviceModal} className={btnOutline}>
                    Batal
                  </button>
                  <button type="button" onClick={saveArea} className={btnPrimary}>
                    <Settings2 size={14} /> Simpan
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
