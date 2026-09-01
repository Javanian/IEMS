import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Loader2,
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Eye,
  X,
  FileText,
  Save,
  AlertCircle,
  Paperclip,
  Image as ImageIcon,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '../../rbac';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const GROUP_LIMIT = 20;
const fileUrl = (filePath) => {
  if (!filePath) return '#';
  if (filePath.startsWith('/uploads/')) return filePath;
  return `${API_BASE}${filePath}`;
};

const fmtHours = (v) => (v != null ? parseFloat(v).toFixed(2) : '—');
const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const isImage = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name || '');
const isExcel = (name) => /\.(xlsx?)$/i.test(name || '');
const isPdf = (name) => /\.pdf$/i.test(name || '');

const INPUT_CLS = `w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
  placeholder-slate-400 rounded-lg text-sm focus:outline-none
  focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all`;

const SELECT_CLS = `w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
  rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8]
  focus:border-[#0096c7] transition-all appearance-none cursor-pointer`;

const EMPTY_OP = {
  operation_no: '',
  operation_text: '',
  machineid: '',
  workcenter: '',
  std_hours: '',
  va_hours: '',
  source_plant: '',
  remark: '',
};

function useWorkcenterData() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/workcenter`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const groupnames = [...new Set(rows.map((r) => r.groupname).filter(Boolean))].sort();

  const workcentersByGroup = useCallback(
    (groupname) =>
      rows
        .filter((r) => r.groupname === groupname && r.workcenternew)
        .sort((a, b) => (a.workcenternew > b.workcenternew ? 1 : -1)),
    [rows]
  );

  return { rows, loading, groupnames, workcentersByGroup };
}

function OperationFormModal({ mode, initial, componentId, onClose, onSaved }) {
  const [form, setForm] = useState(mode === 'edit' ? { ...EMPTY_OP, ...initial } : { ...EMPTY_OP });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);

  const [nnvaTotal, setNnvaTotal] = useState(0);
  const vaSeededRef = useRef(false);

  const handleNnvaTotal = useCallback((total) => {
    setNnvaTotal(total);

    if (vaSeededRef.current) return;
    vaSeededRef.current = true;
    setForm((p) => {
      if (p.va_hours !== '' && p.va_hours != null) return p;
      const std = Number.parseFloat(p.std_hours);
      return { ...p, va_hours: Number.isFinite(std) ? Math.max(0, std - total) : '' };
    });
  }, []);

  const vaNumber = Number.parseFloat(form.va_hours) || 0;
  const totalHours = vaNumber + nnvaTotal;

  const { groupnames, workcentersByGroup, loading: wcLoading } = useWorkcenterData();
  const [wcOptions, setWcOptions] = useState([]);

  useEffect(() => {
    if (!wcLoading && form.machineid) {
      const opts = workcentersByGroup(form.machineid);
      setWcOptions(opts);

      if (opts.length > 0 && !opts.find((o) => o.workcenternew === form.workcenter)) {
        setForm((p) => ({ ...p, workcenter: opts[0].workcenternew }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wcLoading]);

  const handleGroupChange = (e) => {
    const groupname = e.target.value;
    const opts = workcentersByGroup(groupname);
    setWcOptions(opts);
    setForm((p) => ({
      ...p,
      machineid: groupname,
      workcenter: opts.length > 0 ? opts[0].workcenternew : '',
    }));
  };

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const [attachments, setAttachments] = useState(initial?.attachments || []);
  const [loadingAttach, setLoadingAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const fileRef = useRef(null);

  const hasPreview = mode === 'edit' && attachments.length > 0;
  const currentFile = attachments[previewIdx] ?? null;

  useEffect(() => {
    if (mode !== 'edit' || !initial?.id) return;
    if (Array.isArray(initial.attachments) && initial.attachments.length > 0) {
      setAttachments(initial.attachments);
      return;
    }
    setLoadingAttach(true);
    fetch(`${API_BASE}/sow/standard/operation/${initial.id}/attachments`)
      .then((r) => r.json())
      .then((data) => setAttachments(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingAttach(false));
  }, [mode, initial]);

  useEffect(() => {
    if (previewIdx >= attachments.length && attachments.length > 0) {
      setPreviewIdx(attachments.length - 1);
    }
  }, [attachments.length, previewIdx]);

  const handleSave = async () => {
    if (!form.operation_no || !form.operation_text) {
      setFormErr('Operation No. dan Operation Text wajib diisi.');
      return;
    }
    setSaving(true);
    setFormErr(null);
    try {
      const url =
        mode === 'edit'
          ? `${API_BASE}/sow/standard/operation/${initial.id}`
          : `${API_BASE}/sow/standard/operation`;
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const body = mode === 'edit' ? { ...form } : { ...form, component_id: componentId };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server ${res.status}`);
      }
      const saved = await res.json();
      onSaved(saved, attachments);
      onClose();
    } catch (e) {
      setFormErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const ALLOWED_TYPES = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (files.some((f) => !ALLOWED_TYPES.includes(f.type))) {
      toast.error('Format tidak didukung. Upload PDF, gambar (JPG/PNG), atau Excel (.xlsx/.xls)');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/sow/standard/operation/${initial.id}/attachments`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload gagal: ${res.status}`);
      const added = await res.json();
      setAttachments((prev) => {
        const next = [...prev, ...added];
        setPreviewIdx(next.length - 1);
        return next;
      });
      toast.success(`${files.length} file berhasil di-upload`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteAttachment = async (id) => {
    setDeleting(id);
    try {
      const res = await fetch(`${API_BASE}/sow/standard/attachment/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Gagal hapus');
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      toast.success('File dihapus');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const SelectWrapper = ({ children }) => (
    <div className="relative">
      {children}
      <ChevronDown
        size={13}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center
                    bg-black/30 backdrop-blur-sm p-0 md:p-4"
    >
      {}
      <div
        className={`flex flex-col md:flex-row w-full gap-3
                    ${hasPreview ? 'md:w-[95vw] md:max-w-[1400px] md:h-[90vh]' : 'md:max-w-lg'}`}
      >
        {}
        <div
          className={`bg-white shadow-xl flex flex-col overflow-hidden
                      rounded-t-2xl md:rounded-2xl
                      ${hasPreview ? 'md:flex-[2] md:min-w-0 h-full' : 'w-full max-h-[90vh]'}`}
        >
          {}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-800">
              {mode === 'edit' ? 'Edit Operation' : 'New Operation'}
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          {}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {}
            {formErr && (
              <div
                className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200
                              rounded-lg px-3 py-2 text-xs text-red-700"
              >
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                {formErr}
              </div>
            )}

            {}
            <div className="flex flex-col gap-4">
              {}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Op No. *
                  </label>
                  <input
                    value={form.operation_no}
                    onChange={set('operation_no')}
                    type="number"
                    min="1"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    VA Hours
                    <span className="ml-1 font-normal text-slate-400">(jam operasi asli)</span>
                  </label>
                  <input
                    value={form.va_hours ?? ''}
                    onChange={set('va_hours')}
                    type="number"
                    min="0"
                    step="0.01"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {}
              <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">
                  VA{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {fmtHours(vaNumber)}
                  </span>
                  <span className="mx-1.5 text-slate-300">+</span>
                  NNVA{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {fmtHours(nnvaTotal)}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Std Hours (total)
                  </div>
                  <div className="font-mono text-sm font-bold tabular-nums text-slate-800">
                    {fmtHours(totalHours)}
                  </div>
                </div>
              </div>

              {}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Operation Text *
                </label>
                <textarea
                  value={form.operation_text}
                  onChange={set('operation_text')}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>

              {}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Group Name
                  </label>
                  <SelectWrapper>
                    <select
                      value={form.machineid}
                      onChange={handleGroupChange}
                      disabled={wcLoading}
                      className={SELECT_CLS}
                    >
                      <option value="">— Pilih Group —</option>
                      {groupnames.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </SelectWrapper>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Workcenter
                  </label>
                  <SelectWrapper>
                    <select
                      value={form.workcenter}
                      onChange={set('workcenter')}
                      disabled={wcLoading || wcOptions.length === 0}
                      className={`${SELECT_CLS} ${wcOptions.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <option value="">— Pilih Workcenter —</option>
                      {wcOptions.map((wc) => (
                        <option key={wc.idrow} value={wc.workcenternew}>
                          {wc.workcenternew}
                          {wc.workcenter_description ? ` — ${wc.workcenter_description}` : ''}
                        </option>
                      ))}
                    </select>
                  </SelectWrapper>
                  {wcLoading && (
                    <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> Memuat data…
                    </p>
                  )}
                  {!wcLoading && !form.machineid && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Pilih Group Name terlebih dahulu
                    </p>
                  )}
                </div>
              </div>

              {}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Remark</label>
                <textarea
                  value={form.remark || ''}
                  onChange={set('remark')}
                  rows={2}
                  placeholder="Catatan khusus operation"
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </div>

            {}
            {mode === 'edit' && (
              <NnvaPanel standardId={initial.id} onTotalChange={handleNnvaTotal} />
            )}

            {}
            {mode === 'edit' && (
              <div className="mt-6">
                {}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <Paperclip size={10} />
                    Attachments
                    {attachments.length > 0 && (
                      <span
                        className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold
                                       bg-[#caf0f8] text-[#0077b6] border border-[#90e0ef]"
                      >
                        {attachments.length}
                      </span>
                    )}
                  </span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                {}
                <button
                  type="button"
                  onClick={() => !uploading && fileRef.current?.click()}
                  disabled={uploading}
                  className={`w-full border-2 border-dashed rounded-xl px-4 py-3 text-center
                             transition-all mb-3 cursor-pointer
                             ${
                               uploading
                                 ? 'border-[#00b4d8] bg-[#caf0f8]/20 cursor-wait'
                                 : 'border-slate-200 hover:border-[#00b4d8] hover:bg-[#caf0f8]/20'
                             }`}
                >
                  {uploading ? (
                    <Loader2 size={16} className="mx-auto text-[#0096c7] animate-spin mb-1" />
                  ) : (
                    <Upload size={16} className="mx-auto text-slate-300 mb-1" />
                  )}
                  <p className="text-[11px] text-slate-400">
                    {uploading
                      ? 'Mengupload…'
                      : 'Klik untuk upload PDF, gambar (JPG/PNG), atau Excel (max 20 MB)'}
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/jpg,.xlsx,.xls"
                    multiple
                    className="hidden"
                    onChange={handleUpload}
                    disabled={uploading}
                  />
                </button>

                {}
                {loadingAttach ? (
                  <div className="py-4 flex justify-center">
                    <Loader2 size={16} className="animate-spin text-[#0096c7]" />
                  </div>
                ) : attachments.length === 0 ? (
                  <p className="text-center text-[11px] text-slate-400 py-2">
                    Belum ada attachment.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {attachments.map((a, idx) => {
                      const isActive = previewIdx === idx;
                      return (
                        <div
                          key={a.id}
                          onClick={() => setPreviewIdx(idx)}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer
                                     transition-all border
                                     ${
                                       isActive
                                         ? 'bg-[#caf0f8] border-[#90e0ef]'
                                         : 'bg-slate-50 border-transparent hover:border-slate-200 hover:bg-white'
                                     }`}
                        >
                          {isImage(a.original_name) ? (
                            <ImageIcon
                              size={13}
                              className={`flex-shrink-0 ${isActive ? 'text-[#0096c7]' : 'text-emerald-500'}`}
                            />
                          ) : isExcel(a.original_name) ? (
                            <FileSpreadsheet
                              size={13}
                              className={`flex-shrink-0 ${isActive ? 'text-[#0096c7]' : 'text-green-600'}`}
                            />
                          ) : (
                            <FileText
                              size={13}
                              className={`flex-shrink-0 ${isActive ? 'text-[#0096c7]' : 'text-red-400'}`}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-[11px] font-semibold text-slate-700 truncate"
                              title={a.original_name}
                            >
                              {a.original_name}
                            </p>
                            <p className="text-[10px] text-slate-400">{fmtSize(a.file_size)}</p>
                          </div>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <a
                              href={fileUrl(a.file_path)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="w-7 h-7 flex items-center justify-center rounded
                                         text-slate-400 hover:text-[#0096c7] transition-colors"
                              title="Buka di tab baru"
                            >
                              <Eye size={12} />
                            </a>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAttachment(a.id);
                              }}
                              disabled={deleting === a.id}
                              className="w-7 h-7 flex items-center justify-center rounded
                                         text-slate-400 hover:text-red-500 transition-colors
                                         disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Hapus"
                            >
                              {deleting === a.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {}
            {mode === 'create' && (
              <p className="mt-5 text-[11px] text-slate-400 text-center italic">
                Simpan operasi terlebih dahulu untuk menambahkan attachment.
              </p>
            )}
          </div>

          {}
          <div className="flex-shrink-0 flex gap-2 justify-end px-5 py-4 border-t border-slate-100">
            <button
              onClick={onClose}
              className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50
                         px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
            >
              Batal
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                         px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Simpan
            </button>
          </div>
        </div>

        {}
        {hasPreview && currentFile && (
          <div
            className="bg-white shadow-xl flex flex-col overflow-hidden
                       rounded-b-2xl md:rounded-2xl
                       h-[50vh] md:h-full md:flex-[3] md:min-w-0"
          >
            {}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              {isImage(currentFile.original_name) ? (
                <ImageIcon size={14} className="text-emerald-500 flex-shrink-0" />
              ) : isExcel(currentFile.original_name) ? (
                <FileSpreadsheet size={14} className="text-green-600 flex-shrink-0" />
              ) : (
                <FileText size={14} className="text-red-400 flex-shrink-0" />
              )}
              <span
                className="flex-1 text-xs font-semibold text-slate-700 truncate min-w-0"
                title={currentFile.original_name}
              >
                {currentFile.original_name}
              </span>

              {}
              {attachments.length > 1 && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setPreviewIdx((p) => Math.max(0, p - 1))}
                    disabled={previewIdx === 0}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-white
                               border border-slate-200 text-slate-600 hover:bg-slate-50
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
                    title="Sebelumnya"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="text-[11px] text-slate-500 font-semibold tabular-nums px-0.5">
                    {previewIdx + 1} / {attachments.length}
                  </span>
                  <button
                    onClick={() => setPreviewIdx((p) => Math.min(attachments.length - 1, p + 1))}
                    disabled={previewIdx === attachments.length - 1}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-white
                               border border-slate-200 text-slate-600 hover:bg-slate-50
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
                    title="Berikutnya"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              )}

              {}
              <a
                href={fileUrl(currentFile.file_path)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-white
                           border border-slate-200 text-slate-500 hover:text-[#0096c7]
                           hover:bg-[#caf0f8] hover:border-[#90e0ef] transition-all"
                title="Buka di tab baru"
              >
                <Eye size={13} />
              </a>
            </div>

            {}
            {isPdf(currentFile.original_name) && (
              <iframe
                key={currentFile.file_path}
                src={`${fileUrl(currentFile.file_path)}#toolbar=1&view=FitH`}
                title={currentFile.original_name}
                className="flex-1 w-full border-0 block"
              />
            )}
            {isImage(currentFile.original_name) && (
              <div className="flex-1 flex items-center justify-center bg-slate-50 p-4 overflow-auto">
                <img
                  key={currentFile.file_path}
                  src={fileUrl(currentFile.file_path)}
                  alt={currentFile.original_name}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                />
              </div>
            )}
            {isExcel(currentFile.original_name) && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-50 p-8">
                <FileSpreadsheet size={52} className="text-green-500" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700 mb-1">
                    {currentFile.original_name}
                  </p>
                  <p className="text-xs text-slate-400 mb-5">{fmtSize(currentFile.file_size)}</p>
                  <a
                    href={fileUrl(currentFile.file_path)}
                    download={currentFile.original_name}
                    className="inline-flex items-center gap-2 bg-[#0096c7] hover:bg-[#0077b6] text-white
                               px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
                  >
                    <Download size={14} />
                    Download File
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NnvaPanel({ standardId, onTotalChange }) {
  const [nnvaBase, setNnvaBase] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading || typeof onTotalChange !== 'function') return;
    const total = Object.values(selected).reduce(
      (sum, item) => sum + (Number.parseFloat(item?.standard_hours) || 0),
      0
    );
    onTotalChange(total);
  }, [loading, selected, onTotalChange]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/sow/nnva/base`).then((r) => r.json()),
      fetch(`${API_BASE}/sow/nnva/standard/${standardId}`).then((r) => r.json()),
    ])
      .then(([baseJson, assignedJson]) => {
        setNnvaBase(baseJson.data || []);
        const sel = {};
        (assignedJson.data || []).forEach((a) => {
          sel[a.nnva_base_id] = { checked: true, standard_hours: a.standard_hours || 0 };
        });
        setSelected(sel);
      })
      .catch(() => toast.error('Gagal load NNVA'))
      .finally(() => setLoading(false));
  }, [standardId]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = { checked: true, standard_hours: 0 };
      }
      return next;
    });
  };

  const setHours = (id, v) => {
    setSelected((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], standard_hours: parseFloat(v) || 0 } };
    });
  };

  const handleSaveNnva = async () => {
    const items = Object.entries(selected).map(([nnva_base_id, data]) => ({
      nnva_base_id: parseInt(nnva_base_id),
      standard_hours: data.standard_hours,
    }));
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/sow/nnva/standard/${standardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error('Gagal simpan NNVA');
      toast.success('NNVA disimpan');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">NNVA</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>
      {loading ? (
        <div className="py-3 flex justify-center">
          <Loader2 size={14} className="animate-spin text-[#0096c7]" />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {nnvaBase.map((nnva) => {
              const sel = selected[nnva.id];
              return (
                <label
                  key={nnva.id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-all
                    ${sel ? 'bg-[#caf0f8] border-[#90e0ef]' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                >
                  <input
                    type="checkbox"
                    checked={!!sel}
                    onChange={() => toggle(nnva.id)}
                    className="w-3.5 h-3.5 rounded accent-[#0096c7] flex-shrink-0"
                  />
                  <span className="flex-1 text-xs font-medium text-slate-700">{nnva.name}</span>
                  {sel && (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={sel.standard_hours}
                      onChange={(e) => setHours(nnva.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 px-1.5 py-1 text-xs text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
                    />
                  )}
                </label>
              );
            })}
          </div>
          <button
            onClick={handleSaveNnva}
            disabled={saving}
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-white px-3 py-1.5 rounded-lg
                       bg-[#0096c7] hover:bg-[#0077b6] transition-all active:scale-95 disabled:opacity-50"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            Simpan NNVA
          </button>
        </>
      )}
    </div>
  );
}

function NnvaModal({ standardId, operationText, onClose }) {
  const [nnvaBase, setNnvaBase] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/sow/nnva/base`).then((r) => r.json()),
      fetch(`${API_BASE}/sow/nnva/standard/${standardId}`).then((r) => r.json()),
    ])
      .then(([baseJson, assignedJson]) => {
        const baseList = baseJson.data || [];
        setNnvaBase(baseList);
        const sel = {};
        (assignedJson.data || []).forEach((a) => {
          sel[a.nnva_base_id] = {
            checked: true,
            standard_hours: a.standard_hours || 0,
            id: a.id,
          };
        });
        setSelected(sel);
      })
      .catch(() => toast.error('Gagal load data NNVA'))
      .finally(() => setLoading(false));
  }, [standardId]);

  const toggle = (nnvaBaseId) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[nnvaBaseId]) {
        delete next[nnvaBaseId];
      } else {
        next[nnvaBaseId] = { checked: true, standard_hours: 0 };
      }
      return next;
    });
  };

  const setHours = (nnvaBaseId, value) => {
    setSelected((prev) => {
      if (!prev[nnvaBaseId]) return prev;
      return {
        ...prev,
        [nnvaBaseId]: { ...prev[nnvaBaseId], standard_hours: parseFloat(value) || 0 },
      };
    });
  };

  const handleSave = async () => {
    const items = Object.entries(selected).map(([nnva_base_id, data]) => ({
      nnva_base_id: parseInt(nnva_base_id),
      standard_hours: data.standard_hours,
    }));
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/sow/nnva/standard/${standardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error('Gagal simpan NNVA');
      toast.success('NNVA disimpan');
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">NNVA Activities</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{operationText}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
          >
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 size={20} className="animate-spin text-[#0096c7]" />
          </div>
        ) : (
          <div className="space-y-2">
            {nnvaBase.map((nnva) => {
              const sel = selected[nnva.id];
              return (
                <label
                  key={nnva.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all
                    ${sel ? 'bg-[#caf0f8] border-[#90e0ef]' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                >
                  <input
                    type="checkbox"
                    checked={!!sel}
                    onChange={() => toggle(nnva.id)}
                    className="w-4 h-4 rounded accent-[#0096c7] flex-shrink-0"
                  />
                  <span className="flex-1 text-sm font-medium text-slate-700">{nnva.name}</span>
                  {sel && (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={sel.standard_hours}
                      onChange={(e) => setHours(nnva.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-20 px-2 py-1 text-xs text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                    />
                  )}
                </label>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all active:scale-95"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#0096c7] hover:bg-[#0077b6] text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateEditorModal({
  mode,
  componentId,
  template,
  operations,
  nextKey,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => ({
    template_name: template?.template_name || '',
  }));
  const [checked, setChecked] = useState(() => {
    const initial = new Set();
    if (mode === 'edit' && Array.isArray(template?.operations)) {
      template.operations.forEach((op) => {
        if (op.id != null) initial.add(String(op.id));
      });
    }
    return initial;
  });
  const hasExistingOps =
    mode === 'edit' && Array.isArray(template?.operations) && template.operations.length > 0;
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);

  const toggleOp = (id) => {
    const key = String(id);
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.template_name.trim()) {
      setFormErr('Template Name wajib diisi');
      return;
    }
    if (checked.size === 0) {
      setFormErr('Pilih minimal 1 operation');
      return;
    }

    setSaving(true);
    setFormErr(null);
    try {
      const isEdit = mode === 'edit';
      const url = isEdit
        ? `${API_BASE}/sow/templates/${template.template_id}`
        : `${API_BASE}/sow/templates`;
      const method = isEdit ? 'PUT' : 'POST';
      const tplKey = isEdit ? template.template_key : String(nextKey || 1);
      const body = {
        component_id: componentId,
        template_name: form.template_name.trim(),
        template_key: tplKey,
        sort_order: parseInt(tplKey) * 10,
        operation_ids: Array.from(checked),
      };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server ${res.status}`);
      }
      toast.success(isEdit ? 'Package diperbarui' : 'Package dibuat');
      onSaved();
      onClose();
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm p-0 md:p-4">
      <div className="bg-white w-full md:max-w-xl rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">
            {mode === 'edit' ? 'Edit Package' : 'Create Package'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {formErr && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              {formErr}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Template Name *
              </label>
              <input
                value={form.template_name}
                onChange={set('template_name')}
                className={INPUT_CLS}
                placeholder="e.g. Package A"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-600">
                  Operations ({checked.size} dipilih)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (checked.size === operations.length) setChecked(new Set());
                    else setChecked(new Set(operations.map((o) => String(o.id))));
                  }}
                  className="text-[10px] font-semibold text-[#0096c7] hover:text-[#0077b6]"
                >
                  {checked.size === operations.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {operations.map((op) => {
                  const idKey = String(op.id);
                  const isChecked = checked.has(idKey);
                  const wasExisting =
                    hasExistingOps && template.operations.some((to) => String(to.id) === idKey);
                  return (
                    <label
                      key={op.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isChecked ? 'bg-[#caf0f8]/40' : 'hover:bg-slate-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOp(op.id)}
                        className="w-3.5 h-3.5 rounded accent-[#0096c7] flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-[#0077b6] flex-shrink-0">
                            {String(op.operation_no).padStart(4, '0')}
                          </span>
                          <span className="text-xs text-slate-700 truncate">
                            {op.operation_text}
                          </span>
                          {wasExisting && (
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700 border border-emerald-200">
                              in package
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {op.machineid || '—'} · {fmtHours(op.std_hours)} hrs
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 flex gap-2 justify-end px-5 py-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationRow({
  op,
  onEdit,
  onDelete,
  deleting,
  nnvaExpanded,
  onToggleNnva,
  canWrite = true,
}) {
  const nnva = op._nnva || [];
  const hasNnva = nnva.length > 0;

  return (
    <>
      <tr
        className={`transition-colors ${canWrite ? 'hover:bg-slate-50 cursor-pointer' : ''} ${nnvaExpanded ? 'bg-[#caf0f8]/30' : ''}`}
        onClick={() => canWrite && onEdit(op)}
      >
        <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">
          {op.operation_no}
        </td>
        <td className="px-3 py-2 text-xs text-slate-800">
          <span>{op.operation_text}</span>
          {op.remark && <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{op.remark}</p>}
          {hasNnva && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleNnva(op.id);
              }}
              className={`ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border transition-all
                ${
                  nnvaExpanded
                    ? 'bg-purple-100 text-purple-700 border-purple-300'
                    : 'bg-purple-50 text-purple-500 border-purple-200 hover:bg-purple-100'
                }`}
            >
              NNVA {nnva.length}
              {nnvaExpanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
            </button>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell whitespace-nowrap">
          {op.machineid || '—'}
        </td>
        <td className="px-3 py-2 text-xs text-right font-mono text-slate-700 whitespace-nowrap">
          {fmtHours(op.std_hours)}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {op.attachments?.length > 0 && (
              <span
                className="flex items-center gap-1 text-[10px] font-semibold text-[#0077b6]
                               bg-[#caf0f8] border border-[#90e0ef] px-1.5 py-0.5 rounded-full"
              >
                <Paperclip size={9} />
                {op.attachments.length}
              </span>
            )}
            {canWrite && (
              <>
                <button
                  onClick={() => onEdit(op)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-white
                             border border-slate-200 text-slate-500 hover:bg-slate-50
                             hover:border-slate-300 transition-all"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => onDelete(op.id)}
                  disabled={deleting === op.id}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-white
                             border border-slate-200 text-red-400 hover:bg-red-50
                             hover:border-red-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Hapus"
                >
                  {deleting === op.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {}
      {nnvaExpanded && hasNnva && (
        <tr>
          <td colSpan={5} className="px-3 py-2 bg-purple-50/40 border-t border-purple-100">
            <div className="flex flex-wrap gap-2">
              {nnva.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-purple-200 rounded-lg text-xs"
                >
                  <span className="font-semibold text-purple-700">{n.nnva_name}</span>
                  <span className="text-purple-400">|</span>
                  <span className="font-mono text-slate-600">{fmtHours(n.standard_hours)} h</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ConfirmDeletePanel({
  open,
  title,
  message,
  details,
  confirmLabel = 'Hapus',
  loading,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm px-0 md:px-4">
      <div className="w-full md:max-w-md bg-white shadow-xl rounded-t-2xl md:rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Trash2 size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{message}</p>
            {details && (
              <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {details}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-[44px] bg-white border border-slate-200 text-slate-700 hover:bg-slate-50
                       px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="min-h-[44px] inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white
                       px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentEditModal({ group, onClose, onSaved }) {
  const [form, setForm] = useState({
    part_name: group.part_name || '',
    part_number: group.part_number || '',
    model: group.model || '',
  });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.part_name.trim() || !form.part_number.trim()) {
      setFormErr('Part Name dan Part Number wajib diisi.');
      return;
    }
    setSaving(true);
    setFormErr(null);
    try {
      const res = await fetch(`${API_BASE}/sow/standard/component/${group.component_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server ${res.status}`);
      }
      const json = await res.json();
      toast.success('Komponen diperbarui');
      onSaved(json.data);
      onClose();
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm p-0 md:p-4">
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Edit Komponen</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {formErr && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              {formErr}
            </div>
          )}
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Part Name *
              </label>
              <input value={form.part_name} onChange={set('part_name')} className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Part Number *
              </label>
              <input value={form.part_number} onChange={set('part_number')} className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Model</label>
              <input value={form.model} onChange={set('model')} className={INPUT_CLS} />
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 flex gap-2 justify-end px-5 py-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentGroup({ group, onDeleted, onUpdated }) {
  const canWrite = useCan('sow_management', 'write');
  const [open, setOpen] = useState(false);
  const [operations, setOperations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [modal, setModal] = useState(null);
  const [nnvaModal, setNnvaModal] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingComponent, setDeletingComponent] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(null);
  const [templateModal, setTemplateModal] = useState(null);
  const [editModal, setEditModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [nnvaExpanded, setNnvaExpanded] = useState(new Set());
  const fetched = useRef(false);

  const loadOperations = useCallback(async () => {
    setLoadingOps(true);
    try {
      const [res, templateRes] = await Promise.all([
        fetch(`${API_BASE}/sow/standard/component/${group.component_id}`),
        fetch(`${API_BASE}/sow/standard/component/${group.component_id}/templates`),
      ]);
      const json = await res.json();
      const templateJson = await templateRes.json().catch(() => ({}));
      const ops = Array.isArray(json) ? json : [];
      setTemplates(Array.isArray(templateJson.data) ? templateJson.data : []);

      if (ops.length) {
        const nnvaResults = await Promise.all(
          ops.map((op) =>
            fetch(`${API_BASE}/sow/nnva/standard/${op.id}`)
              .then((r) => r.json())
              .then((j) => ({ id: op.id, data: j.data || [] }))
              .catch(() => ({ id: op.id, data: [] }))
          )
        );
        const nnvaMap = {};
        nnvaResults.forEach((r) => {
          nnvaMap[r.id] = r.data;
        });
        ops.forEach((op) => {
          op._nnva = nnvaMap[op.id] || [];
        });
      }
      setOperations(ops);
    } catch {
      setOperations([]);
      setTemplates([]);
    } finally {
      setLoadingOps(false);
    }
  }, [group.component_id]);

  const handleToggle = () => {
    setOpen((v) => {
      if (!v && !fetched.current) {
        fetched.current = true;
        loadOperations();
      }
      return !v;
    });
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await fetch(`${API_BASE}/sow/standard/operation/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Gagal hapus');
      setOperations((prev) => prev.filter((o) => o.id !== id));
      toast.success('Operasi dihapus');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleSaved = (saved, freshAttachments) => {
    setOperations((prev) => {
      const idx = prev.findIndex((o) => o.id === saved.id);
      const merged = { ...saved, attachments: freshAttachments ?? [] };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], ...merged };
        return next;
      }
      return [...prev, merged].sort((a, b) => a.operation_no - b.operation_no);
    });
    toast.success('Operasi disimpan');
  };

  const handleDeleteTemplate = async (templateId) => {
    setDeletingTemplate(templateId);
    try {
      const res = await fetch(`${API_BASE}/sow/templates/${templateId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Gagal hapus');
      setTemplates((prev) => prev.filter((t) => t.template_id !== templateId));
      toast.success('Package dihapus');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingTemplate(null);
    }
  };

  const handleDeleteComponent = async () => {
    setDeletingComponent(true);
    try {
      const res = await fetch(`${API_BASE}/sow/standard/component/${group.component_id}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal hapus komponen');
      toast.success('Komponen dan relasi SOW standard dihapus');
      setConfirm(null);
      onDeleted?.(group.component_id, json.counts);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingComponent(false);
    }
  };

  const handleTemplateSaved = () => {
    fetch(`${API_BASE}/sow/standard/component/${group.component_id}/templates`)
      .then((r) => r.json())
      .then((json) => setTemplates(Array.isArray(json.data) ? json.data : []))
      .catch(() => {});
  };

  return (
    <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden mb-3">
      {}
      <div className="flex items-stretch min-h-[56px] transition-colors hover:bg-slate-50">
        <button
          type="button"
          className="flex flex-1 items-center justify-between px-4 py-3 text-left active:bg-slate-100"
          onClick={handleToggle}
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-sm font-bold text-slate-800 truncate">{group.part_name}</span>
              <span className="font-mono text-xs text-[#0096c7]">{group.part_number}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
              <span className="text-xs text-slate-500">{group.model}</span>
              {group.source_plant > 0 && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                                 bg-[#caf0f8] text-[#0077b6] border border-[#90e0ef]"
                >
                  Plant {group.source_plant}
                </span>
              )}
              <span className="text-[10px] text-slate-400">{group.operation_count} op.</span>
              {group.template_count > 0 && (
                <span className="text-[10px] text-slate-400">{group.template_count} package</span>
              )}
            </div>
          </div>
          <div className="flex-shrink-0 ml-3 text-slate-400">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {canWrite && (
          <div className="flex items-center gap-1 pr-3">
            <button
              type="button"
              onClick={() => setEditModal(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg
                        bg-white border border-slate-200 text-slate-500 hover:bg-slate-50
                        hover:text-[#0096c7] transition-all active:scale-95"
              title="Edit komponen"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={() =>
                setConfirm({
                  type: 'component',
                  title: 'Hapus komponen?',
                  message: `${group.part_name || 'Komponen'} akan dihapus dari components beserta SOW standard, package, template lines, NNVA, attachment, dan operation card yang terkait.`,
                  details: `Component ID ${group.component_id} | ${group.operation_count || 0} operation | ${group.template_count || 0} package`,
                })
              }
              disabled={deletingComponent}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg
                        bg-white border border-red-200 text-red-500 hover:bg-red-50
                        transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Hapus komponen"
            >
              {deletingComponent ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
            </button>
          </div>
        )}
      </div>

      {}
      {open && (
        <div className="border-t border-slate-100">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">
              Operations
            </span>
            {canWrite && (
              <button
                onClick={() => setModal({ mode: 'create' })}
                className="flex items-center gap-1 text-xs font-semibold text-white px-2.5 py-1.5
                           rounded-lg bg-[#0096c7] hover:bg-[#0077b6] transition-all active:scale-95"
              >
                <Plus size={12} />
                Tambah
              </button>
            )}
          </div>

          {loadingOps ? (
            <div className="py-6 flex justify-center">
              <Loader2 size={18} className="animate-spin text-[#0096c7]" />
            </div>
          ) : operations.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-5">Belum ada operasi.</p>
          ) : (
            <>
              {templates.length > 0 && (
                <div className="border-b border-slate-100 bg-white px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Packages
                    </span>
                    {canWrite && (
                      <button
                        onClick={() => setTemplateModal({ mode: 'create' })}
                        className="flex items-center gap-1 text-[10px] font-semibold text-[#0096c7] hover:text-[#0077b6] transition-colors"
                      >
                        <Plus size={11} />
                        Package
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((template) => (
                      <div
                        key={template.template_id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs font-bold text-slate-800">
                            {template.template_name}
                          </span>
                          <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                            {template.operation_count} ops
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-mono">Key {template.template_key}</span>
                          <span>{fmtHours(template.total_std_hours)} h</span>
                        </div>
                        {canWrite && (
                          <div className="mt-1.5 flex items-center gap-1 border-t border-slate-200 pt-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTemplateModal({ mode: 'edit', template });
                              }}
                              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-[#0096c7] py-1 rounded transition-colors hover:bg-white"
                            >
                              <Pencil size={10} /> Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirm({
                                  type: 'template',
                                  id: template.template_id,
                                  title: 'Hapus package?',
                                  message: `Package ${template.template_name} akan dihapus dari daftar aktif.`,
                                  details: `${template.operation_count} operation tetap aman di SOW standard.`,
                                });
                              }}
                              disabled={deletingTemplate === template.template_id}
                              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-red-500 py-1 rounded transition-colors hover:bg-white disabled:opacity-40"
                            >
                              {deletingTemplate === template.template_id ? (
                                <Loader2 size={10} className="animate-spin" />
                              ) : (
                                <Trash2 size={10} />
                              )}
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {canWrite && templates.length === 0 && operations.length > 0 && (
                <div className="border-b border-slate-100 bg-white px-4 py-3 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400">
                    Belum ada package. Kelompokkan operasi ke dalam package.
                  </span>
                  <button
                    onClick={() => setTemplateModal({ mode: 'create' })}
                    className="flex items-center gap-1 text-xs font-semibold text-white px-2.5 py-1.5 rounded-lg bg-[#0096c7] hover:bg-[#0077b6] transition-all active:scale-95"
                  >
                    <Plus size={12} />
                    Create Package
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#caf0f8' }}>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 whitespace-nowrap">
                        Op No.
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">
                        Operation
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 whitespace-nowrap hidden md:table-cell">
                        Group
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700 whitespace-nowrap">
                        Std Hrs
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {operations.map((op) => (
                      <OperationRow
                        key={op.id}
                        op={op}
                        canWrite={canWrite}
                        onEdit={(o) => setModal({ mode: 'edit', op: o })}
                        onDelete={(id) => {
                          const target = operations.find((item) => item.id === id);
                          setConfirm({
                            type: 'operation',
                            id,
                            title: 'Hapus operasi?',
                            message: `Operation ${target?.operation_no || id} akan dihapus dari SOW standard.`,
                            details:
                              'Template lines, NNVA, attachment, dan operation card untuk operation ini ikut dibersihkan.',
                          });
                        }}
                        deleting={deleting}
                        nnvaExpanded={nnvaExpanded.has(op.id)}
                        onToggleNnva={(id) =>
                          setNnvaExpanded((prev) => {
                            const next = new Set(prev);
                            next.has(id) ? next.delete(id) : next.add(id);
                            return next;
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {}
      {modal && (
        <OperationFormModal
          mode={modal.mode}
          initial={modal.op}
          componentId={group.component_id}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {}
      {nnvaModal && (
        <NnvaModal
          standardId={nnvaModal.id}
          operationText={`${nnvaModal.operation_no} — ${nnvaModal.operation_text}`}
          onClose={() => setNnvaModal(null)}
        />
      )}

      {}
      {templateModal && (
        <TemplateEditorModal
          mode={templateModal.mode}
          componentId={group.component_id}
          template={templateModal.template}
          operations={operations}
          nextKey={templates.length + 1}
          onClose={() => setTemplateModal(null)}
          onSaved={handleTemplateSaved}
        />
      )}

      {editModal && (
        <ComponentEditModal
          group={group}
          onClose={() => setEditModal(false)}
          onSaved={(updated) => onUpdated?.(group.component_id, updated)}
        />
      )}

      <ConfirmDeletePanel
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        details={confirm?.details}
        confirmLabel={confirm?.type === 'component' ? 'Hapus Komponen' : 'Hapus'}
        loading={
          (confirm?.type === 'component' && deletingComponent) ||
          (confirm?.type === 'operation' && deleting === confirm?.id) ||
          (confirm?.type === 'template' && deletingTemplate === confirm?.id)
        }
        onCancel={() => {
          if (!deletingComponent && !deleting && !deletingTemplate) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm?.type === 'component') handleDeleteComponent();
          if (confirm?.type === 'operation') handleDelete(confirm.id).then(() => setConfirm(null));
          if (confirm?.type === 'template')
            handleDeleteTemplate(confirm.id).then(() => setConfirm(null));
        }}
      />
    </div>
  );
}

const SowStandardListPage = () => {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const debounceRef = useRef(null);

  const fetchGroups = useCallback(async (searchTerm, pageNum) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: pageNum, limit: GROUP_LIMIT });
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      const res = await fetch(`${API_BASE}/sow/standard/grouped?${params}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const json = await res.json();
      setGroups(json.data || []);
      setTotal(json.total || 0);
      setTotalPages(json.totalPages || 0);
    } catch (err) {
      setError(err.message);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups(search, page);
  }, [fetchGroups, search, page]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setSearch(val);
    }, 400);
  };

  const handlePage = (p) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
  };

  const handleGroupDeleted = (componentId) => {
    setGroups((prev) => prev.filter((g) => g.component_id !== componentId));
    setTotal((prev) => Math.max(0, prev - 1));
    setTotalPages(() => {
      const nextTotal = Math.max(0, total - 1);
      return Math.max(0, Math.ceil(nextTotal / GROUP_LIMIT));
    });
    if (groups.length <= 1 && page > 1) setPage((prev) => Math.max(1, prev - 1));
  };

  const handleGroupUpdated = (componentId, updated) => {
    setGroups((prev) =>
      prev.map((g) => (g.component_id === componentId ? { ...g, ...updated } : g))
    );
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/sow/standard/download${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      const slug = search.trim() ? `_${search.trim().replace(/[^\w.-]+/g, '_')}` : '';
      a.download = `standard_sow${slug}_${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Download gagal', { description: err.message });
    } finally {
      setDownloading(false);
    }
  };

  const pageRange = () => {
    const left = Math.max(1, page - 2);
    const right = Math.min(totalPages, page + 2);
    const r = [];
    for (let i = left; i <= right; i++) r.push(i);
    return r;
  };

  return (
    <div className="flex flex-col h-full">
      {}
      <div className="flex-shrink-0 px-4 md:px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="Cari part name, part number, model..."
              className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 text-slate-800
                         placeholder-slate-400 rounded-lg text-sm focus:outline-none
                         focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
            />
          </div>
          <div className="text-xs text-slate-500">
            {loading ? (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </span>
            ) : (
              <span>{total.toLocaleString()} komponen</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700
                       hover:bg-slate-50 rounded-lg text-sm font-semibold transition-all active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download Excel
          </button>
        </div>
      </div>

      {}
      {error && (
        <div
          className="mx-4 md:mx-6 mt-3 flex items-start gap-2 px-4 py-2.5 bg-red-50
                        border border-red-200 rounded-lg text-sm text-red-700"
        >
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3">
        {loading && groups.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 size={24} className="animate-spin text-[#0096c7]" />
          </div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">Tidak ada data ditemukan.</div>
        ) : (
          groups.map((g) => (
            <ComponentGroup
              key={g.component_id}
              group={g}
              onDeleted={handleGroupDeleted}
              onUpdated={handleGroupUpdated}
            />
          ))
        )}

        {}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
            <span className="text-[11px] text-slate-500">
              Halaman {page} / {totalPages} ({total} komponen)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePage(page - 1)}
                disabled={page <= 1}
                className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200
                           text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-40
                           disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <ChevronLeft size={14} />
              </button>
              {pageRange().map((p) => (
                <button
                  key={p}
                  onClick={() => handlePage(p)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-xs font-semibold
                             transition-all active:scale-95"
                  style={
                    p === page
                      ? { background: '#0096c7', color: '#fff', border: 'none' }
                      : { background: '#fff', border: '1px solid #e2e8f0', color: '#475569' }
                  }
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => handlePage(page + 1)}
                disabled={page >= totalPages}
                className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200
                           text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-40
                           disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SowStandardListPage;
