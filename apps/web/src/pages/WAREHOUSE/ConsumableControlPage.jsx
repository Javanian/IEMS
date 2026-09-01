import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { normalizeNfcId } from '../../utils/nfcId';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Package,
  RefreshCw,
  Save,
  ScanLine,
  Upload,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STATUS_TONES = {
  'waiting leader': 'border-amber-200 bg-amber-50 text-amber-700',
  'waiting warehouse': 'border-sky-200 bg-sky-50 text-sky-700',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  close: 'border-slate-200 bg-slate-100 text-slate-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
};

const NFC_ERROR_MESSAGES = {
  NotAllowedError: 'Izin NFC ditolak. Gunakan mode Eksternal atau izinkan NFC.',
  NotSupportedError: 'NFC tidak didukung di device ini. Gunakan mode Eksternal.',
  NotReadableError: 'NFC tidak bisa dibaca. Coba lagi atau gunakan scanner eksternal.',
  InvalidStateError: 'NFC reader tidak siap. Refresh halaman atau gunakan mode Eksternal.',
};

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function writeAuthHeaders(role, username) {
  return {
    'Content-Type': 'application/json',
    'x-user-role': role || '',
    'x-user-name': username || '',
  };
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(number);
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function nextApproveLabel(role) {
  if (role === 'foreman') return 'Approve to Warehouse';
  if (role === 'warehouse') return 'Mark Ready';
  return 'Approve';
}

function canApproveTicket(role, status) {
  const normalizedStatus = normalizeStatus(status);
  if (role === 'foreman') return normalizedStatus === 'waiting leader';
  if (role === 'warehouse') return normalizedStatus === 'waiting warehouse';
  return false;
}

function canPickupTicket(role, status) {
  return role === 'warehouse' && normalizeStatus(status) === 'ready';
}

function canManageItem(role, ticketStatus, itemStatus) {
  if (role !== 'foreman' && role !== 'warehouse') return false;
  if (['close', 'rejected'].includes(normalizeStatus(ticketStatus))) return false;
  return normalizeStatus(itemStatus || 'active') !== 'rejected';
}

function extractNfcId(event) {
  if (event.serialNumber?.trim()) return normalizeNfcId(event.serialNumber);
  for (const record of event.message?.records || []) {
    if (record.recordType === 'text') {
      try {
        return normalizeNfcId(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
      } catch {
        return '';
      }
    }
  }
  return '';
}

function TicketItems({ ticket, role, busyItemId, onAdjustItem, onRejectItem }) {
  const [editingId, setEditingId] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const items = ticket.items || [];

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">
        Tidak ada item pada ticket ini.
      </div>
    );
  }

  const startAdjust = (item) => {
    setRejectingId(null);
    setEditingId(item.id);
    setQuantity(String(item.quanitty || ''));
  };

  const startReject = (item) => {
    setEditingId(null);
    setRejectingId(item.id);
    setReason('');
  };

  const cancelAction = () => {
    setEditingId(null);
    setRejectingId(null);
    setQuantity('');
    setReason('');
  };

  const submitAdjust = async (item) => {
    const ok = await onAdjustItem(item, quantity);
    if (ok) cancelAction();
  };

  const submitReject = async (item) => {
    const ok = await onRejectItem(item, reason);
    if (ok) cancelAction();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-bold">Material</th>
              <th className="px-4 py-3 font-bold">Description</th>
              <th className="px-4 py-3 font-bold">Qty</th>
              <th className="px-4 py-3 font-bold">UOM</th>
              <th className="px-4 py-3 font-bold">GL Account</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 text-right font-bold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const rejected = normalizeStatus(item.status || 'active') === 'rejected';
              const canManage = canManageItem(role, ticket.status, item.status);
              const busy = busyItemId === item.id;

              return (
                <React.Fragment key={item.id}>
                  <tr className={rejected ? 'bg-rose-50/50 text-slate-400' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono text-xs font-bold">
                      {item.materialcode || '-'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {item.materialdescription || '-'}
                    </td>
                    <td className="px-4 py-3 font-extrabold text-slate-900">
                      {formatNumber(item.quanitty)}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-500">
                      {item.uom || '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-bold text-slate-700">
                      {item.gl_account || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-extrabold uppercase ${rejected ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
                      >
                        {item.status || 'active'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startAdjust(item)}
                          disabled={!canManage || busy}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Save size={14} />
                          Adjust
                        </button>
                        <button
                          type="button"
                          onClick={() => startReject(item)}
                          disabled={!canManage || busy}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-extrabold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <XCircle size={14} />
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>

                  {editingId === item.id && (
                    <tr className="bg-sky-50/60">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="text-xs font-extrabold uppercase text-slate-500">
                            Adjust quantity
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={quantity}
                            onChange={(event) => setQuantity(event.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-sky-100 sm:w-40"
                          />
                          <button
                            type="button"
                            onClick={() => submitAdjust(item)}
                            disabled={busy}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:opacity-60"
                          >
                            {busy && <Loader2 size={15} className="animate-spin" />}
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelAction}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {rejectingId === item.id && (
                    <tr className="bg-rose-50/60">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="text-xs font-extrabold uppercase text-slate-500">
                            Reject reason
                          </span>
                          <input
                            type="text"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Alasan reject"
                            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                          />
                          <button
                            type="button"
                            onClick={() => submitReject(item)}
                            disabled={busy}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-extrabold text-white disabled:opacity-60"
                          >
                            {busy && <Loader2 size={15} className="animate-spin" />}
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={cancelAction}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PickupPanel({ ticket, role, authUser, onClose, onSuccess }) {
  const [mode, setMode] = useState(
    () =>
      sessionStorage.getItem('warehouseScanMode') ||
      sessionStorage.getItem('scanMode') ||
      'internal'
  );
  const [scanInput, setScanInput] = useState('');
  const [status, setStatus] = useState('Siapkan kartu / scanner pengambil barang');
  const [nfcId, setNfcId] = useState('-');
  const [scannedUser, setScannedUser] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const processingRef = useRef(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopNfc = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.onreading = null;
      readerRef.current.onerror = null;
      readerRef.current.stop?.();
      readerRef.current = null;
    }
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }, []);

  const loadUserByNfc = useCallback(async (id) => {
    const response = await fetch(
      `${API_BASE}/usernfc/nfcid/${encodeURIComponent(normalizeNfcId(id))}`
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || payload?.message || 'User tidak ditemukan');
    return payload;
  }, []);

  const closeTicket = useCallback(
    async (id, user) => {
      if (processingRef.current || submitting) return;
      processingRef.current = true;
      setSubmitting(true);

      try {
        const imageData = captureFrame();
        if (!imageData) {
          throw new Error('Camera belum siap untuk capture foto');
        }
        const response = await fetch(`${API_BASE}/consumable/control/${ticket.id}/close`, {
          method: 'PATCH',
          headers: writeAuthHeaders(role, authUser?.username),
          body: JSON.stringify({
            username: authUser?.username || '',
            nfcid: id,
            image_data: imageData,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Gagal close ticket');

        setStatus(`${user.full_name || user.snssb || id} berhasil mengambil barang`);
        toast.success(`${ticket.cis_no} berhasil Close`);
        onSuccess(payload.ticket);
      } catch (err) {
        processingRef.current = false;
        toast.error('Gagal close ticket', { description: err.message });
        setStatus(err.message);
      } finally {
        setSubmitting(false);
      }
    },
    [authUser?.username, captureFrame, onSuccess, role, submitting, ticket.cis_no, ticket.id]
  );

  const processScan = useCallback(
    async (id) => {
      const cleanId = String(id || '').trim();
      if (!cleanId || processingRef.current) return;

      setNfcId(cleanId);
      setStatus('Scan terbaca, ambil data user...');

      try {
        const user = await loadUserByNfc(cleanId);
        setScannedUser(user);
        setStatus('User ditemukan, closing ticket...');
        await closeTicket(cleanId, user);
      } catch (err) {
        toast.error('Scan gagal', { description: err.message });
        setStatus(err.message);
      }
    },
    [closeTicket, loadUserByNfc]
  );

  const startNfc = useCallback(async () => {
    stopNfc();
    if (mode === 'external') return;
    if (!('NDEFReader' in window)) {
      setStatus('Web NFC tidak didukung. Gunakan mode Eksternal.');
      return;
    }

    try {
      const reader = new window.NDEFReader();
      readerRef.current = reader;
      await reader.scan();
      setStatus('Scanning NFC internal...');

      reader.onreading = (event) => {
        const id = extractNfcId(event);
        if (!id) {
          setStatus('NFC ID tidak terbaca');
          return;
        }
        processScan(id);
      };

      reader.onerror = () => setStatus('Error membaca NFC, tap ulang kartu');
    } catch (err) {
      setStatus(NFC_ERROR_MESSAGES[err.name] || `Gagal scan NFC: ${err.message}`);
    }
  }, [mode, processScan, stopNfc]);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        setCameraError(err.message || 'Camera tidak bisa dibuka');
      }
    };

    startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    sessionStorage.setItem('warehouseScanMode', mode);
    if (mode === 'external') {
      stopNfc();
      setStatus('Mode Eksternal. Scan ID lalu tekan Enter.');
      setTimeout(() => inputRef.current?.focus(), 0);
      return undefined;
    }

    startNfc();
    return stopNfc;
  }, [mode, startNfc, stopNfc]);

  useEffect(
    () => () => {
      stopNfc();
      stopCamera();
    },
    [stopCamera, stopNfc]
  );

  const handleExternalKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    const id = scanInput.trim();
    setScanInput('');
    setTimeout(() => inputRef.current?.focus(), 0);
    processScan(id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 backdrop-blur-sm sm:p-5">
      <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-extrabold text-slate-950">
              {ticket.cis_no}
            </p>
            <p className="truncate text-xs font-bold text-slate-500">Ambil barang | Status Ready</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="min-h-0 border-b border-slate-200 bg-slate-950 p-3 lg:border-b-0 lg:border-r">
            <div className="relative flex h-full min-h-[280px] items-center justify-center overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 px-5 text-center text-white">
                  <Camera className="mb-3 h-10 w-10 text-slate-500" />
                  <p className="text-sm font-bold">Camera tidak aktif</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{cameraError}</p>
                </div>
              )}
              <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-3 py-2 text-xs font-bold text-white">
                Foto otomatis diambil saat scan berhasil
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </section>

          <section className="flex min-h-0 flex-col p-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('internal')}
                disabled={submitting}
                className={`h-12 rounded-lg border text-sm font-extrabold ${mode === 'internal' ? 'border-[#0096c7] bg-sky-50 text-[#0077b6]' : 'border-slate-200 bg-white text-slate-600'}`}
              >
                Internal NFC
              </button>
              <button
                type="button"
                onClick={() => setMode('external')}
                disabled={submitting}
                className={`h-12 rounded-lg border text-sm font-extrabold ${mode === 'external' ? 'border-[#0096c7] bg-sky-50 text-[#0077b6]' : 'border-slate-200 bg-white text-slate-600'}`}
              >
                Eksternal
              </button>
            </div>

            {mode === 'external' && (
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={scanInput}
                onChange={(event) => setScanInput(event.target.value)}
                onKeyDown={handleExternalKeyDown}
                placeholder="SCAN ID"
                className="mt-3 h-12 rounded-lg border border-slate-200 px-4 text-center text-lg font-extrabold outline-none focus:border-[#0096c7] focus:ring-2 focus:ring-sky-100"
              />
            )}

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-[#0077b6] shadow-sm">
                  {submitting ? (
                    <Loader2 className="animate-spin" size={20} />
                  ) : (
                    <ScanLine size={20} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-slate-900">{status}</p>
                  <p className="truncate text-xs font-bold text-slate-500">ID: {nfcId}</p>
                </div>
              </div>
            </div>

            {scannedUser && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-3">
                  <UserCheck className="h-7 w-7 text-emerald-700" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-emerald-950">
                      {scannedUser.full_name || '-'}
                    </p>
                    <p className="truncate text-xs font-bold text-emerald-700">
                      {scannedUser.snssb || '-'} | {scannedUser.workcenter || '-'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-auto rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-extrabold uppercase text-slate-500">Ticket</p>
              <p className="mt-1 font-mono text-sm font-extrabold text-slate-900">
                {ticket.cis_no}
              </p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Request: {ticket.nama_karyawan || '-'} | {ticket.items?.length || 0} item
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StockUploadResultModal({ result, onClose }) {
  const ok = result.ok;
  const created = result.created || [];
  const cleaned = result.cleaned || [];
  const CREATED_CAP = 200;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header
          className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${ok ? 'border-emerald-100 bg-emerald-50' : 'border-rose-100 bg-rose-50'}`}
        >
          <div className="flex items-start gap-3">
            {ok ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-rose-600" />
            )}
            <div className="min-w-0">
              <h3
                className={`text-base font-extrabold ${ok ? 'text-emerald-900' : 'text-rose-900'}`}
              >
                {ok ? 'Stok berhasil di-upload' : 'Upload gagal'}
              </h3>
              <p
                className={`mt-0.5 text-xs font-semibold ${ok ? 'text-emerald-700' : 'text-rose-700'}`}
              >
                {ok ? result.message : 'Tidak ada perubahan disimpan — seluruh file ditolak.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!ok ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              {result.error}
              <p className="mt-2 text-xs font-normal text-rose-600">
                Perbaiki baris yang disebut lalu upload ulang.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Diterapkan</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-800">
                    {result.applied ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Baru</p>
                  <p className="mt-1 text-xl font-extrabold text-emerald-700">{created.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Baris kosong</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-800">
                    {result.skipped_blank ?? 0}
                  </p>
                </div>
              </div>
              <p className="text-xs font-semibold text-slate-500">
                Plant:{' '}
                <span className="font-mono font-extrabold text-slate-700">
                  {result.plant || '-'}
                </span>
              </p>

              {cleaned.length > 0 && (
                <section>
                  <h4 className="text-xs font-extrabold uppercase text-slate-500">
                    Dibersihkan ({cleaned.length})
                  </h4>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {cleaned.map((c) => (
                      <p key={c.row} className="font-mono text-xs text-slate-600">
                        baris {c.row}: <span className="text-rose-500 line-through">{c.raw}</span>
                        {' → '}
                        <span className="font-bold text-slate-800">{c.normalized}</span>
                      </p>
                    ))}
                  </div>
                </section>
              )}

              {created.length > 0 && (
                <section>
                  <h4 className="text-xs font-extrabold uppercase text-slate-500">
                    Material baru ({created.length}) — periksa typo
                  </h4>
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    <div className="flex flex-wrap gap-1">
                      {created.slice(0, CREATED_CAP).map((code) => (
                        <span
                          key={code}
                          className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                    {created.length > CREATED_CAP && (
                      <p className="mt-2 text-xs font-semibold text-slate-400">
                        …dan {created.length - CREATED_CAP} material lainnya
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-shrink-0 justify-end border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-lg bg-[#0077b6] px-6 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
          >
            Tutup
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function ConsumableControlPage() {
  const navigate = useNavigate();
  const [authUser] = useState(readAuthUser);
  const role = normalizeRole(authUser?.roles);
  const [tickets, setTickets] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState(null);
  const [busyItemId, setBusyItemId] = useState(null);
  const [pickupTicket, setPickupTicket] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [statusFilter, setStatusFilter] = useState(
    role === 'warehouse' ? 'waiting warehouse' : role === 'foreman' ? 'waiting leader' : 'all'
  );
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const stockFileRef = useRef(null);
  const canUploadStock = role === 'warehouse' || role === 'administrator';

  const stats = useMemo(() => {
    const waitingLeader = tickets.filter(
      (ticket) => normalizeStatus(ticket.status) === 'waiting leader'
    ).length;
    const waitingWarehouse = tickets.filter(
      (ticket) => normalizeStatus(ticket.status) === 'waiting warehouse'
    ).length;
    const ready = tickets.filter((ticket) => normalizeStatus(ticket.status) === 'ready').length;
    const closed = tickets.filter((ticket) => normalizeStatus(ticket.status) === 'close').length;
    return { waitingLeader, waitingWarehouse, ready, closed };
  }, [tickets]);

  const visibleTickets = useMemo(
    () =>
      statusFilter === 'all'
        ? tickets
        : tickets.filter((ticket) => normalizeStatus(ticket.status) === statusFilter),
    [tickets, statusFilter]
  );

  const updateTicketInState = useCallback((updatedTicket) => {
    if (!updatedTicket?.id) return;
    setTickets((current) =>
      current.map((row) => (row.id === updatedTicket.id ? { ...row, ...updatedTicket } : row))
    );
  }, []);

  const loadTickets = useCallback((opts = {}) => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');

    const qs = new URLSearchParams();
    qs.set('limit', String(opts.limit ?? 500));
    if (opts.offset) qs.set('offset', String(opts.offset));
    if (opts.status) qs.set('status', opts.status);

    fetch(`${API_BASE}/consumable/control?${qs.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Gagal memuat consumable control');
        return response.json();
      })
      .then((payload) => setTickets(Array.isArray(payload) ? payload : []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setTickets([]);
        setLoadError(err.message || 'Gagal memuat data');
      })
      .finally(() => setLoading(false));

    return controller;
  }, []);

  useEffect(() => {
    const controller = loadTickets();
    return () => controller.abort();
  }, [loadTickets]);

  const toggleExpand = (ticketId) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const handleApprove = async (ticket) => {
    if (!canApproveTicket(role, ticket.status) || approvingId) return;

    setApprovingId(ticket.id);
    try {
      const response = await fetch(`${API_BASE}/consumable/control/${ticket.id}/approve`, {
        method: 'PATCH',
        headers: writeAuthHeaders(role, authUser?.username),
        body: JSON.stringify({
          username: authUser?.username || '',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Gagal approve ticket');

      updateTicketInState({ ...ticket, ...payload.ticket });
      toast.success(`${ticket.cis_no} updated to ${payload.ticket.status}`);
    } catch (err) {
      toast.error('Gagal approve ticket', { description: err.message });
    } finally {
      setApprovingId(null);
    }
  };

  const handleAdjustItem = async (item, quantity) => {
    setBusyItemId(item.id);
    try {
      const response = await fetch(`${API_BASE}/consumable/control/items/${item.id}/quantity`, {
        method: 'PATCH',
        headers: writeAuthHeaders(role, authUser?.username),
        body: JSON.stringify({
          username: authUser?.username || '',
          quantity,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Gagal adjust item');

      updateTicketInState(payload.ticket);
      toast.success('Quantity item berhasil di-adjust');
      return true;
    } catch (err) {
      toast.error('Gagal adjust item', { description: err.message });
      return false;
    } finally {
      setBusyItemId(null);
    }
  };

  const handleRejectItem = async (item, reason) => {
    setBusyItemId(item.id);
    try {
      const response = await fetch(`${API_BASE}/consumable/control/items/${item.id}/reject`, {
        method: 'PATCH',
        headers: writeAuthHeaders(role, authUser?.username),
        body: JSON.stringify({
          username: authUser?.username || '',
          reason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Gagal reject item');

      updateTicketInState(payload.ticket);
      toast.success('Item berhasil di-reject');
      return true;
    } catch (err) {
      toast.error('Gagal reject item', { description: err.message });
      return false;
    } finally {
      setBusyItemId(null);
    }
  };

  const handlePickupSuccess = (updatedTicket) => {
    updateTicketInState(updatedTicket);
    setPickupTicket(null);
  };

  const handleStockFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(`${API_BASE}/consumable/stock/upload`, {
        method: 'POST',
        headers: { 'x-user-role': role, 'x-user-name': authUser?.username || '' },
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUploadResult({ ok: false, error: payload.error || `Upload gagal (${response.status})` });
      } else {
        setUploadResult({ ok: true, ...payload });
        toast.success(payload.message || 'Stok berhasil di-upload');
      }
    } catch (err) {
      setUploadResult({ ok: false, error: err.message || 'Upload gagal' });
    } finally {
      setUploading(false);
    }
  };

  const isKnownRole = role === 'foreman' || role === 'warehouse';

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold text-slate-950">Consumable Control</h1>
              <p className="truncate text-xs font-semibold text-slate-500">
                {authUser?.name || authUser?.username || '-'} | Role: {authUser?.roles || '-'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUploadStock && (
              <>
                <input
                  ref={stockFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleStockFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => stockFileRef.current?.click()}
                  disabled={uploading}
                  title="Upload stok consumable dari Excel (reset absolut)"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Upload size={17} />
                  )}
                  {uploading ? 'Mengupload…' : 'Upload Stok'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => loadTickets()}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4 md:px-6">
        {}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { key: 'all', label: 'All', value: tickets.length, tone: 'text-slate-700' },
            {
              key: 'waiting leader',
              label: 'Waiting Leader',
              value: stats.waitingLeader,
              tone: 'text-amber-700',
            },
            {
              key: 'waiting warehouse',
              label: 'Waiting Warehouse',
              value: stats.waitingWarehouse,
              tone: 'text-sky-700',
            },
            { key: 'ready', label: 'Ready', value: stats.ready, tone: 'text-emerald-700' },
            { key: 'close', label: 'Close', value: stats.closed, tone: 'text-slate-700' },
          ].map((tab) => {
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                aria-pressed={active}
                className={`min-h-[76px] rounded-xl border bg-white p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${
                  active
                    ? 'border-[#0077b6] ring-2 ring-[#0077b6]'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className="text-[11px] font-bold uppercase text-slate-500">{tab.label}</p>
                <p className={`mt-2 text-2xl font-extrabold ${tab.tone}`}>{tab.value}</p>
              </button>
            );
          })}
        </section>

        {!isKnownRole && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            Role Anda tidak memiliki approval consumable. Gunakan login foreman atau warehouse.
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">CIS Ticket</h2>
              <p className="text-xs font-semibold text-slate-500">
                {statusFilter === 'all'
                  ? `${tickets.length} ticket`
                  : `${visibleTickets.length} dari ${tickets.length} ticket`}
              </p>
            </div>
            <ClipboardCheck className="h-5 w-5 text-[#0077b6]" />
          </div>

          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center text-sm font-semibold text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Memuat ticket
            </div>
          ) : loadError ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
              <XCircle className="h-9 w-9 text-rose-400" />
              <p className="text-sm font-bold text-slate-700">Gagal memuat consumable ticket</p>
              <p className="max-w-md text-xs font-semibold text-slate-500">{loadError}</p>
              <button
                type="button"
                onClick={() => loadTickets()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8]"
              >
                <RefreshCw size={16} /> Coba lagi
              </button>
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center text-sm font-semibold text-slate-400">
              <Package className="mb-3 h-9 w-9 text-slate-300" />
              {statusFilter === 'all'
                ? 'Belum ada consumable ticket.'
                : `Tidak ada ticket berstatus "${statusFilter}".`}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleTickets.map((ticket) => {
                const expanded = expandedIds.has(ticket.id);
                const statusTone =
                  STATUS_TONES[normalizeStatus(ticket.status)] ||
                  'border-slate-200 bg-slate-50 text-slate-600';
                const canApprove = canApproveTicket(role, ticket.status);
                const canPickup = canPickupTicket(role, ticket.status);

                return (
                  <article key={ticket.id} className="bg-white">
                    <div className="grid grid-cols-[auto_1fr] gap-3 px-4 py-4 lg:grid-cols-[auto_1.1fr_0.9fr_0.8fr_auto] lg:items-center">
                      <button
                        type="button"
                        onClick={() => toggleExpand(ticket.id)}
                        className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 lg:mt-0"
                        aria-label={expanded ? 'Collapse item' : 'Expand item'}
                      >
                        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>

                      <div className="min-w-0">
                        <p className="font-mono text-sm font-extrabold text-slate-900">
                          {ticket.cis_no}
                        </p>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                          {formatDateTime(ticket.created)} | {ticket.items?.length || 0} item
                        </p>
                        {ticket.picked_by_name && (
                          <p className="mt-1 truncate text-xs font-bold text-emerald-700">
                            Diambil: {ticket.picked_by_name} |{' '}
                            {formatDateTime(ticket.picked_at || ticket.closedate)}
                          </p>
                        )}
                      </div>

                      <div className="col-start-2 min-w-0 lg:col-start-auto">
                        <p className="truncate text-sm font-extrabold text-slate-800">
                          {ticket.nama_karyawan || '-'}
                        </p>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                          {ticket.sn_karyawan || '-'} | {ticket.workcenter || '-'}
                        </p>
                      </div>

                      <div className="col-start-2 lg:col-start-auto">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${statusTone}`}
                        >
                          {ticket.status || '-'}
                        </span>
                      </div>

                      <div className="col-start-2 flex flex-wrap justify-start gap-2 lg:col-start-auto lg:justify-end">
                        {canPickup ? (
                          <button
                            type="button"
                            onClick={() => setPickupTicket(ticket)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-extrabold text-white hover:bg-emerald-700"
                          >
                            <UserCheck size={16} />
                            Ambil Barang
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleApprove(ticket)}
                            disabled={!canApprove || approvingId === ticket.id}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0077b6] px-4 text-sm font-extrabold text-white hover:bg-[#023e8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            {approvingId === ticket.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={16} />
                            )}
                            {nextApproveLabel(role)}
                          </button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
                        {ticket.comment && (
                          <div className="mb-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
                            {ticket.comment}
                          </div>
                        )}
                        <TicketItems
                          ticket={ticket}
                          role={role}
                          busyItemId={busyItemId}
                          onAdjustItem={handleAdjustItem}
                          onRejectItem={handleRejectItem}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {pickupTicket && (
        <PickupPanel
          ticket={pickupTicket}
          role={role}
          authUser={authUser}
          onClose={() => setPickupTicket(null)}
          onSuccess={handlePickupSuccess}
        />
      )}

      {uploadResult && (
        <StockUploadResultModal result={uploadResult} onClose={() => setUploadResult(null)} />
      )}
    </div>
  );
}
