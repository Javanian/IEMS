import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../../utils/navigation';
import { BrowserMultiFormatReader } from '@zxing/library';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

const formatSeconds = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const total = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const isUnavailableRemaining = (value) => value === null || value === undefined || value === '';

const SelectJobPage = () => {
  const navigate = useNavigate();

  const [orderInput, setOrderInput] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [videoDevices, setVideoDevices] = useState([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0);

  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);

  useEffect(() => {
    const savedOrder = sessionStorage.getItem('lastSearchOrder');
    if (savedOrder) {
      setOrderInput(savedOrder);
      loaddatapgall(savedOrder);
    }
  }, []);

  const loaddatapgall = async (order) => {
    const orderValue = order ?? orderInput;
    if (!orderValue.trim()) {
      toast.warning('Masukkan nomor order terlebih dahulu');
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/sow/datajson?search=${encodeURIComponent(orderValue.trim())}`
      );

      if (response.status === 404) {
        setJobs([]);
        toast.info('Tidak ada data untuk order tersebut');
        return;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (data && data.length > 0) {
        setJobs(data);
        sessionStorage.setItem('lastSearchOrder', orderValue.trim());
      } else {
        setJobs([]);
        toast.info('Tidak ada data untuk order tersebut');
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
      setJobs([]);
      toast.error('Gagal load data', { description: error.message });
    }
  };

  const handleSelectJob = (job) => {
    if (isUnavailableRemaining(job.remaining_seconds_before)) {
      toast.error('JOB KEHABISAN JAM');
    }

    const rowData = {
      order: job.order_no,
      ssbr_id: job.ssbr_id,
      part_name: job.part_name,
      operationtext: job.operation_text,
      operation_no: job.operation_no,
      planhours: job.planhours,
      remaining_seconds_before: job.remaining_seconds_before,
      workcenter: job.workcenter,
    };

    setSelectedJob(rowData);
    sessionStorage.setItem('selectedactivity', JSON.stringify(rowData));

    toast.success(`Job dipilih: ${job.operation_text || job.order_no}`, { duration: 1500 });

    setTimeout(() => {
      navigate('/timesheet-mainmenu');
    }, 400);
  };

  const startScanWithDevice = async (devices, deviceIndex) => {
    if (!codeReaderRef.current) {
      codeReaderRef.current = new BrowserMultiFormatReader();
    } else {
      codeReaderRef.current.reset();
    }

    const deviceId = devices[deviceIndex].deviceId;

    await codeReaderRef.current.decodeFromVideoDevice(deviceId, videoRef.current, (result) => {
      if (result) {
        const scannedText = result.getText();
        setOrderInput(scannedText);
        codeReaderRef.current.reset();
        setShowScanner(false);
        loaddatapgall(scannedText);
      }
    });
  };

  const handleBarcodeScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const vDevices = devices.filter((d) => d.kind === 'videoinput');

      if (vDevices.length === 0) {
        toast.error('Tidak ada kamera ditemukan');
        return;
      }

      const frontIndex = vDevices.findIndex(
        (d) =>
          d.label.toLowerCase().includes('front') ||
          d.label.toLowerCase().includes('user') ||
          d.label.toLowerCase().includes('facing front')
      );
      const startIndex = frontIndex >= 0 ? frontIndex : 0;

      setVideoDevices(vDevices);
      setCurrentDeviceIndex(startIndex);
      setShowScanner(true);

      setTimeout(async () => {
        try {
          await startScanWithDevice(vDevices, startIndex);
        } catch (err) {
          console.error('Start scan error:', err);
        }
      }, 100);
    } catch (err) {
      console.error('Barcode scan error:', err);
      setShowScanner(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        toast.error('Akses kamera ditolak', {
          description: 'Silakan izinkan akses kamera di browser settings.',
        });
      } else if (err.name === 'NotFoundError') {
        toast.error('Kamera tidak ditemukan pada device ini.');
      } else if (err.name === 'NotReadableError') {
        toast.error('Kamera sedang digunakan oleh aplikasi lain.');
      } else {
        toast.error('Gagal akses kamera', { description: err.message });
      }
    }
  };

  const switchCamera = async () => {
    if (videoDevices.length <= 1) return;
    const nextIndex = (currentDeviceIndex + 1) % videoDevices.length;
    setCurrentDeviceIndex(nextIndex);
    try {
      await startScanWithDevice(videoDevices, nextIndex);
    } catch (err) {
      console.error('Switch camera error:', err);
    }
  };

  const closeScanner = () => {
    if (codeReaderRef.current) {
      try {
        codeReaderRef.current.reset();
      } catch (_) {}
    }
    setShowScanner(false);
    setVideoDevices([]);
    setCurrentDeviceIndex(0);
  };

  useEffect(() => {
    return () => {
      if (codeReaderRef.current) {
        try {
          codeReaderRef.current.reset();
        } catch (_) {}
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') loaddatapgall();
  };

  const btnOutline =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ' +
    'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 ' +
    'transition-all duration-150 active:scale-95 min-h-[44px]';

  const btnPrimary =
    'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold ' +
    'bg-[#0096c7] hover:bg-[#0077b6] text-white transition-all duration-150 active:scale-95 min-h-[44px]';

  const cellBase = 'px-2 py-2 text-[11px] align-middle';

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
        <h1 className="text-sm font-extrabold text-slate-800">Job Selection</h1>
        <button onClick={() => loaddatapgall()} className={btnOutline}>
          Refresh
        </button>
      </header>

      {}
      <div className="flex-shrink-0 flex gap-2 px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex-1 relative">
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
            value={orderInput}
            onChange={(e) => setOrderInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search Order..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 text-slate-800
                       placeholder-slate-400 rounded-lg text-sm focus:outline-none
                       focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]
                       transition-all duration-150 min-h-[44px]"
          />
        </div>
        <button onClick={() => loaddatapgall()} className={btnPrimary}>
          Search
        </button>
        <button
          onClick={handleBarcodeScan}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
                     bg-amber-500 hover:bg-amber-400 text-white transition-all duration-150
                     active:scale-95 min-h-[44px]"
        >
          Barcode
        </button>
      </div>

      {}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: '17%' }} />
            <col style={{ width: '35%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr
              style={{ background: '#caf0f8', borderBottomColor: '#90e0ef' }}
              className="border-b-2"
            >
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Order</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Activity</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Seq</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Hours</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Remaining</th>
              <th className={`${cellBase} text-center font-semibold text-slate-700`}>Workcenter</th>
            </tr>
          </thead>

          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
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
                    <span className="text-sm text-slate-400">
                      Tidak ada data. Silakan search order.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map((job, index) => {
                const isSelected =
                  selectedJob?.order === job.order_no &&
                  selectedJob?.operation_no === job.operation_no;
                const hasPlanHours = Number(job.planhours || 0) > 0;
                const isOutOfHours =
                  hasPlanHours && isUnavailableRemaining(job.remaining_seconds_before);
                const rowBg = isSelected
                  ? 'bg-[#caf0f8]'
                  : isOutOfHours
                    ? 'bg-red-100'
                    : index % 2 === 0
                      ? 'bg-white'
                      : 'bg-slate-50';

                return (
                  <tr
                    key={index}
                    onClick={() => handleSelectJob(job)}
                    style={isOutOfHours ? { backgroundColor: '#fee2e2' } : undefined}
                    className={`${rowBg} border-b cursor-pointer transition-colors duration-100
                                ${isOutOfHours ? 'border-l-4 border-l-red-500 border-b-red-200 hover:bg-red-100 active:bg-red-100' : 'border-slate-100 hover:bg-[#ade8f4] active:bg-[#90e0ef]'}`}
                  >
                    <td
                      className={`${cellBase} text-center ${isOutOfHours ? 'border-l-4 border-red-500' : ''}`}
                    >
                      <div className="font-semibold font-mono" style={{ color: '#0096c7' }}>
                        {job.order_no}
                      </div>
                      {job.ssbr_id && (
                        <div className="text-[10px] text-slate-500 leading-tight">
                          {job.ssbr_id}
                        </div>
                      )}
                    </td>
                    <td className={`${cellBase} text-left text-slate-800`}>
                      <div className="font-medium leading-snug">{job.operation_text}</div>
                      {job.part_name && (
                        <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                          {job.part_name}
                        </div>
                      )}
                    </td>
                    <td className={`${cellBase} text-center text-slate-700`}>{job.operation_no}</td>
                    <td className={`${cellBase} text-center text-slate-700`}>
                      {formatSeconds(Number(job.planhours || 0) * 3600)}
                    </td>
                    <td
                      className={`${cellBase} text-center font-mono ${isOutOfHours ? 'font-bold text-red-700' : 'text-slate-700'}`}
                    >
                      {formatSeconds(job.remaining_seconds_before)}
                    </td>
                    <td className={`${cellBase} text-center text-slate-800 font-medium`}>
                      {job.workcenter}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {}
      {showScanner && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
          onClick={closeScanner}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {}
            <div
              className="px-5 py-3 flex justify-between items-center"
              style={{ background: 'linear-gradient(135deg, #023e8a 0%, #0077b6 100%)' }}
            >
              <h3 className="text-sm font-bold text-white">Scan Barcode</h3>
              <button
                onClick={closeScanner}
                className="w-8 h-8 flex items-center justify-center rounded-full
                           bg-white/20 hover:bg-white/35 text-white text-xl
                           transition-colors duration-150"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              <div className="relative">
                <video ref={videoRef} autoPlay className="w-full h-64 bg-black rounded-lg" />
                {videoDevices.length > 1 && (
                  <button
                    onClick={switchCamera}
                    className="absolute bottom-2 right-2 w-10 h-10 flex items-center justify-center
                               bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                    title="Putar kamera"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 19H6.931A1.922 1.922 0 0 1 5 17.087V8h18v2" />
                      <path d="M18 8V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h5" />
                      <circle cx="18" cy="18" r="3" />
                      <path d="m22 22-1.5-1.5" />
                      <path d="M18 15v1.586a1 1 0 0 0 .293.707L20 19" />
                    </svg>
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500 text-center mt-2">
                Arahkan kamera ke barcode order
                {videoDevices.length > 1 && (
                  <span className="ml-1" style={{ color: '#0096c7' }}>
                    · Kamera {currentDeviceIndex + 1}/{videoDevices.length}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectJobPage;
