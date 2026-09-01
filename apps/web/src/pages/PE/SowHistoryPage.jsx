import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
  ChevronDown,
  Loader2,
  ArrowRight,
  Download,
  ArrowDownUp,
  Printer,
  ExternalLink,
  Undo2,
  Info,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useCan, authHeaders } from '../../rbac';
import { useSowDraft } from '../../features/sow/useSowDraft';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const normalizeProductionOrder = (value) =>
  String(value ?? '')
    .trim()
    .replace(/-/g, '000');

const emptyOperation = (orderNo = '', info) => ({
  order_no: orderNo,
  operation_no: '',
  operation_text: '',
  workcenterdescription: '',
  planhours: '',
  wct_group: '',
  workcenter: '',
  status: '',
  customer: info.customer || '',
  ssbr_id: info.ssbr_id || '',
  part_number: info.part_number || '',
  part_name: info.part_name || '',
  model: info.model || '',
});

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function fmt(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function firstFilled(rows, key) {
  const row = (rows || []).find((item) => String(item?.[key] ?? '').trim());
  return row ? String(row[key]).trim() : '';
}

function getOrderDetailInfo(rows) {
  return {
    customer: firstFilled(rows, 'customer'),
    ssbr_id: firstFilled(rows, 'ssbr_id'),
    part_number: firstFilled(rows, 'part_number'),
    part_name: firstFilled(rows, 'part_name'),
    model: firstFilled(rows, 'model'),
  };
}

const authRequest = (path, options) =>
  request(path, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers || {}) },
  });

const subcontKey = (operationNo) => {
  const n = Number(operationNo);
  return Number.isFinite(n) && String(operationNo ?? '').trim() !== '' ? String(n) : '';
};

function buildSubcontMap(markRows, operationRows) {
  const map = {};
  (markRows || []).forEach((m) => {
    const key = subcontKey(m?.operation_no);
    if (key) map[key] = m;
  });
  (operationRows || []).forEach((r) => {
    const key = subcontKey(r?.operation_no);
    if (key && r?.is_subcont && !map[key]) map[key] = { operation_no: Number(key) };
  });
  return map;
}

function fmtStamp(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function subcontTooltip(mark) {
  if (!mark) return '';
  const parts = ['Operasi ditandai subcont — jamnya tidak dihitung sebagai beban internal.'];
  if (mark.marked_by) parts.push(`Ditandai oleh: ${mark.marked_by}`);
  if (mark.marked_at) parts.push(`Waktu: ${fmtStamp(mark.marked_at)}`);
  if (mark.original_workcenter) parts.push(`Workcenter asli: ${mark.original_workcenter}`);
  if (mark.note) parts.push(`Catatan: ${mark.note}`);
  return parts.join('\n');
}

const INPUT_CLS = `w-full rounded border border-slate-200 px-2 py-1 outline-none focus:border-[#0096c7] text-xs`;
const SELECT_CLS = `w-full rounded border border-slate-200 px-2 py-1 outline-none focus:border-[#0096c7] appearance-none cursor-pointer bg-white text-xs truncate pr-6`;
const todayDate = () => new Date().toISOString().slice(0, 10);

const SelectWrapper = ({ children }) => (
  <div className="relative">
    {children}
    <ChevronDown
      size={10}
      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
    />
  </div>
);

export default function SowHistoryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const [search, setSearch] = useState(initialSearch);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [sortDirection, setSortDirection] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportRange, setExportRange] = useState({ start: todayDate(), end: todayDate() });
  const [exportMode, setExportMode] = useState('range');
  const [exportIdent, setExportIdent] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const canWrite = useCan('sow_management', 'write');

  const canSubcont = useCan('sow_subcont', 'write');
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState('');
  const [editRows, setEditRows] = useState([]);
  const [currentRevision, setCurrentRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);
  const [revisionOptions, setRevisionOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [subcontMarks, setSubcontMarks] = useState({});
  const [subcontError, setSubcontError] = useState('');
  const [subcontBusy, setSubcontBusy] = useState('');
  const [subcontDialog, setSubcontDialog] = useState(null);
  const showOpCard = false;
  const setShowOpCard = () => {};
  const opCardLoading = false;
  const opCardHtml = '';
  const opCardPrintRef = { current: null };
  const detailRequestRef = useRef(0);

  const [detailInfo, setDetailInfo] = useState({
    customer: '',
    ssbr_id: '',
    part_number: '',
    part_name: '',
    model: '',
  });

  const { draftAvailable, lastSavedAt, restoreDraft, discardDraft } = useSowDraft({
    context: 'history-edit',
    refKey: selectedOrder,
    state: { detailInfo, editRows, selectedRevision, currentRevision },
    enabled: showEditor && !detailLoading && !saving && !savingInfo && editRows.length > 0,
    onRestore: (payload) => {
      if (!payload) return;
      setDetailInfo((prev) => ({ ...prev, ...(payload.detailInfo || {}) }));
      setEditRows(Array.isArray(payload.editRows) ? payload.editRows : []);
      if (payload.selectedRevision != null) setSelectedRevision(payload.selectedRevision);
      if (payload.currentRevision != null) setCurrentRevision(payload.currentRevision);
    },
  });

  const [wcData, setWcData] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/workcenter`)
      .then((r) => r.json())
      .then((d) => setWcData(Array.isArray(d) ? d : d?.data || []))
      .catch(() => {});
  }, []);

  const groupnames = useMemo(() => {
    const n = [...new Set(wcData.map((r) => r.groupname).filter(Boolean))];
    n.sort();
    return n;
  }, [wcData]);
  const workcentersByGroup = useCallback(
    (g) =>
      wcData
        .filter((r) => r.groupname === g && r.workcenternew)
        .sort((a, b) => (a.workcenternew > b.workcenternew ? 1 : -1)),
    [wcData]
  );

  const [customers, setCustomers] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/sow/customers`)
      .then((r) => r.json())
      .then((d) => setCustomers(d.data || []))
      .catch(() => {});
  }, []);
  const customerOptions = useMemo(() => {
    const values = new Set(customers.map((c) => String(c || '').trim()).filter(Boolean));
    if (detailInfo.customer) values.add(detailInfo.customer);
    return [...values].sort();
  }, [customers, detailInfo.customer]);

  const [components, setComponents] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/sow/components`)
      .then((r) => r.json())
      .then((d) => setComponents(d.data || []))
      .catch(() => {});
  }, []);
  const models = useMemo(() => {
    const values = new Set(components.map((c) => String(c.model || '').trim()).filter(Boolean));
    if (detailInfo.model) values.add(detailInfo.model);
    return [...values].sort();
  }, [components, detailInfo.model]);
  const partsByModel = useCallback(
    (m, currentPart = '') => {
      const rows = components
        .filter((c) => (!m || c.model === m) && c.part_number)
        .sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)));
      if (currentPart && !rows.some((c) => c.part_number === currentPart)) {
        rows.unshift({
          component_id: `current-${currentPart}`,
          model: m,
          part_number: currentPart,
          part_name: detailInfo.part_name,
        });
      }
      return rows;
    },
    [components, detailInfo.part_name]
  );
  const partInfoByNumber = useCallback(
    (pn) => components.find((c) => c.part_number === pn),
    [components]
  );

  const loadRows = useCallback(
    async (page = pagination.page, direction = sortDirection) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pagination.limit),
          sort: 'updated_at',
          direction,
        });
        if (search.trim()) params.set('search', search.trim());
        const payload = await request(`/sow/history-rows?${params.toString()}`);
        setRows(payload.data || []);
        setPagination(payload.pagination || { page, limit: 50, total: 0, totalPages: 1 });
      } catch (err) {
        toast.error(err.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [pagination.limit, pagination.page, search, sortDirection]
  );

  const fetchSubcontMarks = useCallback(async (orderNo) => {
    try {
      const payload = await authRequest(
        `/sow/subcont-marks?order_no=${encodeURIComponent(orderNo)}`
      );
      return { ok: true, rows: Array.isArray(payload?.data) ? payload.data : [] };
    } catch (err) {
      return { ok: false, rows: [], error: err?.message || 'Gagal memuat tanda subcont' };
    }
  }, []);

  const loadOrderDetail = useCallback(
    async (orderNo, revisionNo = null) => {
      if (!orderNo) return;
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setShowEditor(true);
      setDetailLoading(true);
      setSelectedOrder(orderNo);
      setSelectedRevision(revisionNo || 0);
      setEditRows([]);
      setRevisionOptions([]);
      setSubcontMarks({});
      setSubcontError('');
      setDetailInfo({ customer: '', ssbr_id: '', part_number: '', part_name: '', model: '' });
      try {
        const params = new URLSearchParams();
        if (revisionNo) params.set('revision_no', String(revisionNo));

        params.set('light', '1');
        const [data, marks] = await Promise.all([
          request(`/sow/history-order/${encodeURIComponent(orderNo)}?${params.toString()}`),
          fetchSubcontMarks(orderNo),
        ]);
        if (detailRequestRef.current !== requestId) return;
        setSelectedOrder(orderNo);
        const opRows = (data.rows || []).map((r) => ({
          ...r,
          operation_name: r.workcenterdescription || '',
        }));
        setEditRows(opRows);
        setSubcontMarks(buildSubcontMap(marks.rows, opRows));
        setSubcontError(marks.ok ? '' : marks.error);
        setCurrentRevision(data.current_revision || 0);
        setSelectedRevision(data.selected_revision || data.current_revision || 0);
        setRevisionOptions(data.revisions || []);
        setDetailInfo(getOrderDetailInfo(data.rows || []));
      } catch (err) {
        if (detailRequestRef.current !== requestId) return;
        toast.error(err.message);
        setEditRows([]);
      } finally {
        if (detailRequestRef.current === requestId) setDetailLoading(false);
      }
    },
    [fetchSubcontMarks]
  );

  const closeEditor = useCallback(() => {
    detailRequestRef.current += 1;
    setShowEditor(false);
    setDetailLoading(false);
    setSubcontDialog(null);
  }, []);

  const reloadSubcontMarks = useCallback(
    async (orderNo) => {
      if (!orderNo) return null;
      const requestId = detailRequestRef.current;
      const marks = await fetchSubcontMarks(orderNo);
      if (detailRequestRef.current !== requestId) return marks;
      if (marks.ok) {
        setSubcontMarks(buildSubcontMap(marks.rows, []));
        setSubcontError('');
      } else {
        setSubcontError(marks.error);
      }
      return marks;
    },
    [fetchSubcontMarks]
  );

  const runSubcontAction = async (operationNo, action, note = '') => {
    const key = subcontKey(operationNo);
    const orderNo = selectedOrder;
    if (!key || !orderNo) return;
    const requestId = detailRequestRef.current;
    setSubcontBusy(key);
    try {
      if (action === 'mark') {
        const body = { order_no: orderNo, operation_no: Number(key) };
        if (note.trim()) body.note = note.trim();
        await authRequest('/sow/subcont-marks', { method: 'POST', body: JSON.stringify(body) });
      } else {
        await authRequest(
          `/sow/subcont-marks/${encodeURIComponent(orderNo)}/${encodeURIComponent(key)}`,
          { method: 'DELETE' }
        );
      }
      setSubcontDialog(null);
      const marks = await reloadSubcontMarks(orderNo);
      if (!marks?.ok && detailRequestRef.current === requestId) {
        setSubcontMarks((prev) => {
          const next = { ...prev };
          if (action === 'mark')
            next[key] = {
              operation_no: Number(key),
              note: note.trim(),
              marked_at: new Date().toISOString(),
            };
          else delete next[key];
          return next;
        });
      }
      toast.success(
        action === 'mark'
          ? `Operasi ${key} ditandai subcont`
          : `Tanda subcont operasi ${key} dibatalkan`
      );
    } catch (err) {
      toast.error(
        err.message ||
          (action === 'mark' ? 'Gagal menandai subcont' : 'Gagal membatalkan tanda subcont')
      );
    } finally {
      setSubcontBusy('');
    }
  };

  useEffect(() => {
    loadRows(1);
  }, []);

  const updateEditRow = (index, key, value) => {
    setEditRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const updated = { ...row, [key]: value };
        if (key === 'workcenter') {
          const wc = workcentersByGroup(row.wct_group).find((w) => w.workcenternew === value);
          updated.workcenterdescription = wc?.workcenter_description || '';
        }
        if (key === 'wct_group') {
          const opts = workcentersByGroup(value);
          updated.workcenter = opts.length ? opts[0].workcenternew : '';
          updated.workcenterdescription = opts.length ? opts[0].workcenter_description || '' : '';
        }
        return updated;
      })
    );
  };

  const addOperation = () =>
    setEditRows((prev) => [...prev, emptyOperation(selectedOrder, detailInfo)]);
  const removeOperation = (index) => setEditRows((prev) => prev.filter((_, i) => i !== index));

  const isLatestRevision =
    !selectedRevision || Number(selectedRevision) === Number(currentRevision);
  const subcontCount = useMemo(
    () => editRows.filter((r) => subcontMarks[subcontKey(r.operation_no)]).length,
    [editRows, subcontMarks]
  );

  useEffect(() => {
    if (!subcontDialog) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !subcontBusy) setSubcontDialog(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [subcontDialog, subcontBusy]);

  const saveDetailInfo = async () => {
    if (!selectedOrder) {
      toast.error('Pilih order_no dulu');
      return;
    }
    setSavingInfo(true);
    try {
      const payload = { ...detailInfo };

      if (isLatestRevision) {
        payload.operations = editRows
          .filter((r) => r.idsow != null)
          .map((r) => ({
            idsow: r.idsow,
            wct_group: r.wct_group || null,
            workcenter: r.workcenter || null,
            workcenterdescription: r.workcenterdescription || r.operation_name || null,
            operation_text: r.operation_text || '',
          }));
      }
      await request(`/sow/history-order/${encodeURIComponent(selectedOrder)}/info`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setEditRows((prev) =>
        prev.map((r) => ({
          ...r,
          customer: detailInfo.customer,
          ssbr_id: detailInfo.ssbr_id,
          part_number: detailInfo.part_number,
          part_name: detailInfo.part_name,
          model: detailInfo.model,
        }))
      );
      toast.success(isLatestRevision ? 'Perubahan tersimpan' : 'Detail info tersimpan');
      loadRows(1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingInfo(false);
    }
  };

  const saveRevision = async () => {
    if (!selectedOrder) {
      toast.error('Pilih order_no dulu');
      return;
    }
    setSaving(true);
    try {
      const result = await request(`/sow/history-order/${encodeURIComponent(selectedOrder)}`, {
        method: 'PUT',
        body: JSON.stringify({
          operations: editRows.map((r) => ({
            ...r,
            order_no: selectedOrder,
            workcenterdescription: r.workcenterdescription || r.operation_name || null,
          })),
        }),
      });
      setCurrentRevision(result.revision?.revision_no || currentRevision + 1);
      setEditRows(result.rows || []);
      toast.success(`Revision ${result.revision?.revision_no || currentRevision + 1} saved`);
      loadRows(1);
      discardDraft();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleSortDirection = () => {
    const next = sortDirection === 'desc' ? 'asc' : 'desc';
    setSortDirection(next);
    loadRows(1, next);
  };

  const exportExcel = async () => {
    const ident = exportIdent.trim();
    if (exportMode === 'range') {
      if (!exportRange.start || !exportRange.end) {
        toast.error('Pilih rentang tanggal created_at');
        return;
      }
      if (exportRange.start > exportRange.end) {
        toast.error('Tanggal mulai tidak boleh lebih besar dari tanggal akhir');
        return;
      }
    } else if (!ident) {
      toast.error(exportMode === 'ssbr' ? 'Isi SSBR ID' : 'Isi Order No');
      return;
    }

    setExporting(true);
    try {
      const params = new URLSearchParams({ direction: sortDirection });
      if (exportMode === 'range') {
        params.set('start', exportRange.start);
        params.set('end', exportRange.end);
      } else if (exportMode === 'ssbr') {
        params.set('ssbr_id', ident);
      } else {
        params.set('order_no', ident);
      }
      const res = await fetch(`${API_BASE}/sow/history-export?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (value) =>
        String(value)
          .replace(/[^A-Za-z0-9._-]/g, '_')
          .slice(0, 40);
      a.download =
        exportMode === 'order'
          ? `sow_history_order_${slug(ident)}.xlsx`
          : exportMode === 'ssbr'
            ? `sow_history_ssbr_${slug(ident)}.xlsx`
            : `sow_history_${exportRange.start}_to_${exportRange.end}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowExportPanel(false);
      toast.success('Export Excel berhasil');
    } catch (err) {
      toast.error(err.message || 'Export gagal');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">SOW History</h2>
            <p className="text-xs text-slate-500">
              {loading
                ? 'Memuat…'
                : `${pagination.total} baris${search.trim() ? ` · filter "${search.trim()}"` : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-[#0096c7] focus-within:ring-2 focus-within:ring-[#00b4d8] lg:flex-none">
              <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadRows(1);
                }}
                className="w-full bg-transparent text-sm outline-none lg:w-56"
                placeholder="Cari order_no / ssbr_id"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch('');
                    loadRows(1);
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSortDirection}
                title={`Urutkan updated ${sortDirection === 'desc' ? 'terbaru' : 'terlama'}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ArrowDownUp className="h-4 w-4" />{' '}
                <span className="hidden sm:inline">Updated {sortDirection.toUpperCase()}</span>
              </button>
              <button
                onClick={() => setShowExportPanel(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-4 w-4" /> <span className="hidden sm:inline">Excel</span>
              </button>
              <button
                onClick={() => loadRows(pagination.page)}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{' '}
                <span className="hidden sm:inline">Refresh</span>
              </button>
              {canWrite && (
                <button
                  onClick={() => setShowEditor(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#0077b6] px-4 text-sm font-semibold text-white hover:bg-[#023e8a]"
                >
                  Edit SOW
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-full overflow-auto">
          <table className="min-w-[1200px] w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                {[
                  'Customer',
                  'Order No',
                  'SSBR ID',
                  'Operation Text',
                  'Operation No',
                  'Plan Hours',
                  'WCT Group',
                  'Workcenter',
                  'Status',
                  'Part Number',
                  'Part Name',
                  'Model',
                ].map((h) => (
                  <th key={h} className="border-b border-slate-200 px-3 py-2 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-slate-500">
                    Data tidak ditemukan
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={`${row.order_no}-${row.operation_no}-${i}`}
                    onClick={() => loadOrderDetail(row.order_no)}
                    className="odd:bg-white even:bg-slate-50 hover:bg-[#caf0f8] cursor-pointer transition-colors"
                  >
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.customer)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">
                      {fmt(row.order_no)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.ssbr_id)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.operation_text)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">
                      {fmt(row.operation_no)}
                    </td>
                    <td
                      className="border-b border-slate-100 px-3 py-2 font-semibold tabular-nums text-slate-800"
                      title={`Operation: ${fmt(row.operation_planhours ?? row.planhours)} | NNVA: ${fmt(row.nnva_planhours)}`}
                    >
                      {fmt(row.planhours)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.wct_group)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.workcenter)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.status)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.part_number)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.part_name)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {fmt(row.model)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <button
          disabled={pagination.page <= 1 || loading}
          onClick={() => loadRows(Math.max(1, pagination.page - 1))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
        >
          Prev
        </button>
        <span>
          Page {pagination.page} / {pagination.totalPages} ({pagination.total} row)
        </span>
        <button
          disabled={pagination.page >= pagination.totalPages || loading}
          onClick={() => loadRows(Math.min(pagination.totalPages, pagination.page + 1))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {showExportPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-800">Export SOW History</h3>
                <p className="text-xs text-slate-500">
                  Filter berdasarkan tanggal, SSBR ID, atau Order No
                </p>
              </div>
              <button
                onClick={() => setShowExportPanel(false)}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4">
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {[
                  { key: 'range', label: 'Tanggal' },
                  { key: 'ssbr', label: 'SSBR ID' },
                  { key: 'order', label: 'Order No' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setExportMode(tab.key)}
                    className={`min-h-[36px] rounded-md px-2 text-xs font-semibold transition-colors ${exportMode === tab.key ? 'bg-white text-[#0077b6] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {exportMode === 'range' ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      Tanggal Mulai
                    </span>
                    <input
                      type="date"
                      value={exportRange.start}
                      onChange={(e) => setExportRange((p) => ({ ...p, start: e.target.value }))}
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      Tanggal Akhir
                    </span>
                    <input
                      type="date"
                      value={exportRange.end}
                      onChange={(e) => setExportRange((p) => ({ ...p, end: e.target.value }))}
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                    />
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    {exportMode === 'ssbr' ? 'SSBR ID' : 'Order No'}
                  </span>
                  <input
                    type="text"
                    value={exportIdent}
                    onChange={(e) => setExportIdent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !exporting) exportExcel();
                    }}
                    placeholder={
                      exportMode === 'ssbr' ? 'contoh: SSBR-12345' : 'contoh: 1000129441'
                    }
                    className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]"
                  />
                  <span className="mt-1 block text-[11px] text-slate-400">
                    {exportMode === 'ssbr'
                      ? 'Cocok persis, tidak peduli huruf besar/kecil.'
                      : 'Nol di depan diabaikan — 1000129441 sama dengan 0001000129441.'}
                  </span>
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowExportPanel(false)}
                disabled={exporting}
                className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={exportExcel}
                disabled={exporting}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-semibold text-white hover:bg-[#023e8a] disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}{' '}
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditor && (
        <div
          className="fixed inset-0 z-50 flex bg-slate-950/40 backdrop-blur-sm"
          onMouseDown={closeEditor}
        >
          <div
            className="ml-auto flex h-full w-full max-w-7xl flex-col bg-white shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900">Edit SOW Revision</h3>
                  <p className="truncate text-sm text-slate-500">
                    {selectedOrder ? (
                      <span className="font-mono font-semibold text-slate-700">
                        {selectedOrder}
                      </span>
                    ) : (
                      'Pilih order_no untuk mulai edit'
                    )}
                  </p>
                </div>
                {selectedOrder && !detailLoading && (
                  <span
                    className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${isLatestRevision ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                  >
                    {isLatestRevision
                      ? `Rev ${currentRevision} · Latest`
                      : `Rev ${selectedRevision} · History`}
                  </span>
                )}
              </div>
              <button
                onClick={closeEditor}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {draftAvailable && (
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2">
                <p className="text-xs font-semibold text-amber-800">
                  Draft tersimpan
                  {lastSavedAt
                    ? ` ${lastSavedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}{' '}
                  — lanjutkan dari sini?
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreDraft}
                    className="rounded-lg bg-[#0096c7] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0077b6]"
                  >
                    Lanjutkan
                  </button>
                  <button
                    type="button"
                    onClick={discardDraft}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Buang
                  </button>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 flex flex-col">
              <section className="flex min-w-0 min-h-0 flex-1 flex-col">
                {detailLoading && (
                  <div className="flex min-h-[180px] items-center justify-center gap-3 border-b border-slate-200 text-sm font-semibold text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin text-[#0096c7]" />
                    Loading {selectedOrder}...
                  </div>
                )}
                {!detailLoading && selectedOrder && (
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        Detail Info
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          Customer
                        </label>
                        <SelectWrapper>
                          <select
                            value={detailInfo.customer}
                            onChange={(e) =>
                              setDetailInfo((p) => ({ ...p, customer: e.target.value }))
                            }
                            className={SELECT_CLS}
                          >
                            <option value="">— Pilih Customer —</option>
                            {customerOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </SelectWrapper>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          SSBR ID
                        </label>
                        <input
                          value={detailInfo.ssbr_id}
                          onChange={(e) =>
                            setDetailInfo((p) => ({ ...p, ssbr_id: e.target.value }))
                          }
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          Model
                        </label>
                        <SelectWrapper>
                          <select
                            value={detailInfo.model}
                            onChange={(e) => {
                              const m = e.target.value;
                              setDetailInfo((p) => ({
                                ...p,
                                model: m,
                                part_number: '',
                                part_name: '',
                              }));
                            }}
                            className={SELECT_CLS}
                          >
                            <option value="">— Pilih Model —</option>
                            {models.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </SelectWrapper>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          Part Number
                        </label>
                        <SelectWrapper>
                          <select
                            value={detailInfo.part_number}
                            onChange={(e) => {
                              const pn = e.target.value;
                              const info = partInfoByNumber(pn);
                              setDetailInfo((p) => ({
                                ...p,
                                part_number: pn,
                                part_name: info?.part_name || p.part_name || '',
                              }));
                            }}
                            className={SELECT_CLS}
                          >
                            <option value="">— Pilih Part —</option>
                            {partsByModel(detailInfo.model, detailInfo.part_number).map((c) => (
                              <option key={c.component_id} value={c.part_number}>
                                {c.part_number}
                              </option>
                            ))}
                          </select>
                        </SelectWrapper>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          Part Name
                        </label>
                        <input
                          value={detailInfo.part_name}
                          readOnly
                          className={`${INPUT_CLS} bg-slate-100 text-slate-500`}
                          placeholder="Auto-filled"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">
                      <span className="tabular-nums">{editRows.length}</span> operation
                    </span>
                    {subcontCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                        <ExternalLink className="h-3 w-3" />{' '}
                        <span className="tabular-nums">{subcontCount}</span> subcont
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <SelectWrapper>
                      <select
                        value={selectedRevision || 0}
                        onChange={(e) => loadOrderDetail(selectedOrder, Number(e.target.value))}
                        disabled={detailLoading || !selectedOrder}
                        className={`${SELECT_CLS} min-h-[38px] w-36`}
                      >
                        <option value={0}>Latest</option>
                        {revisionOptions.map((rev) => (
                          <option key={rev.revision_no} value={rev.revision_no}>
                            Revision {rev.revision_no}
                          </option>
                        ))}
                      </select>
                    </SelectWrapper>
                    {canWrite && (
                      <button
                        onClick={() =>
                          navigate(
                            `/sow-edit/revision/${encodeURIComponent(selectedOrder)}${selectedRevision ? `?revision_no=${selectedRevision}` : ''}`
                          )
                        }
                        disabled={!selectedOrder || detailLoading}
                        className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#0077b6] px-3 text-sm font-semibold text-white hover:bg-[#023e8a] disabled:opacity-40"
                      >
                        <ArrowRight className="h-4 w-4" /> Create Revision
                      </button>
                    )}
                  </div>
                </div>
                {selectedOrder && !detailLoading && (
                  <div
                    className="flex-shrink-0 border-b border-slate-200 px-4 py-2"
                    style={{ background: '#caf0f8' }}
                  >
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#0077b6]" />
                      <p className="text-xs leading-relaxed text-slate-700">
                        <span className="font-bold">Subcont</span> = operasi dikerjakan pihak luar.
                        Jam operasi bertanda{' '}
                        <span className="font-semibold">dikeluarkan dari beban kerja internal</span>
                        , tetapi jadwal start/finish tetap ada dan kolom{' '}
                        <span className="font-semibold">Workcenter tidak diubah</span>. Tanda
                        langsung tersimpan (tidak ikut tombol Simpan Perubahan) dan bisa dibatalkan
                        lagi.
                        {!isLatestRevision && ' Penanda hanya bisa diubah dari revisi terbaru.'}
                      </p>
                    </div>
                    {subcontError && (
                      <div className="mt-1.5 flex items-center gap-2 pl-6">
                        <p className="text-xs text-red-600">
                          Status subcont gagal dimuat: {subcontError}
                        </p>
                        <button
                          onClick={() => reloadSubcontMarks(selectedOrder)}
                          className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Coba lagi
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-[1250px] w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="border-b border-slate-200 px-2 py-2 w-[70px]">Op No</th>
                        <th className="border-b border-slate-200 px-2 py-2">Operation Text</th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[130px]">WCT Group</th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[130px]">
                          Workcenter
                        </th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[70px]">Plan Hrs</th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[170px]">WC Desc</th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[80px]">Status</th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[150px]">Subcont</th>
                        <th className="border-b border-slate-200 px-2 py-2 w-[46px]">Act</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editRows.map((row, index) => {
                        const wcOpts = workcentersByGroup(row.wct_group);
                        const opKey = subcontKey(row.operation_no);
                        const mark = opKey ? subcontMarks[opKey] : null;
                        const rowSubcontBusy = !!opKey && subcontBusy === opKey;
                        const subcontDisabled =
                          !opKey ||
                          !isLatestRevision ||
                          detailLoading ||
                          savingInfo ||
                          !!subcontBusy;
                        const subcontTitle = !opKey
                          ? 'Operasi belum punya nomor operasi'
                          : !isLatestRevision
                            ? 'Penanda subcont hanya bisa diubah dari revisi terbaru'
                            : mark
                              ? 'Batalkan tanda subcont (jam kembali dihitung sebagai beban internal)'
                              : 'Tandai operasi ini dikerjakan pihak luar (subcont)';
                        return (
                          <tr
                            key={`${row.idsow || 'new'}-${index}`}
                            className={mark ? 'bg-amber-50/60' : undefined}
                          >
                            <td className="border-b border-slate-100 px-2 py-1">
                              <span className="inline-flex min-h-[30px] w-[64px] items-center justify-center rounded border border-slate-200 bg-slate-50 px-2 font-mono text-xs font-bold tabular-nums text-slate-700">
                                {fmt(row.operation_no)}
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <input
                                type="text"
                                value={row.operation_text ?? ''}
                                onChange={(e) =>
                                  updateEditRow(index, 'operation_text', e.target.value)
                                }
                                className={`${INPUT_CLS} min-w-[300px]`}
                              />
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <SelectWrapper>
                                <select
                                  value={row.wct_group || ''}
                                  onChange={(e) =>
                                    updateEditRow(index, 'wct_group', e.target.value)
                                  }
                                  className={`${SELECT_CLS} w-[120px]`}
                                >
                                  <option value="">—</option>
                                  {groupnames.map((g) => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                </select>
                              </SelectWrapper>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <SelectWrapper>
                                <select
                                  value={row.workcenter || ''}
                                  onChange={(e) =>
                                    updateEditRow(index, 'workcenter', e.target.value)
                                  }
                                  disabled={wcOpts.length === 0}
                                  className={`${SELECT_CLS} w-[120px] ${wcOpts.length === 0 ? 'opacity-40' : ''}`}
                                >
                                  <option value="">—</option>
                                  {wcOpts.map((wc) => (
                                    <option key={wc.workcenternew} value={wc.workcenternew}>
                                      {wc.workcenternew}
                                    </option>
                                  ))}
                                </select>
                              </SelectWrapper>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={row.planhours ?? ''}
                                readOnly
                                disabled
                                title="Plan hours dikelola lewat revisi"
                                className={`${INPUT_CLS} w-[62px] text-right tabular-nums bg-slate-100 text-slate-500 cursor-not-allowed`}
                              />
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <input
                                type="text"
                                value={row.workcenterdescription ?? ''}
                                readOnly
                                className={`${INPUT_CLS} w-[160px] bg-slate-50 text-slate-500`}
                                title={row.workcenterdescription || ''}
                              />
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <input
                                type="text"
                                value={row.status ?? ''}
                                readOnly
                                className={`${INPUT_CLS} w-[70px] bg-slate-50 text-slate-500 text-center`}
                              />
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <div className="flex items-center gap-1.5">
                                {mark && (
                                  <span
                                    title={subcontTooltip(mark)}
                                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"
                                  >
                                    <ExternalLink className="h-3 w-3" /> Subcont
                                  </span>
                                )}
                                {canSubcont && (
                                  <button
                                    onClick={() =>
                                      mark
                                        ? runSubcontAction(row.operation_no, 'unmark')
                                        : setSubcontDialog({
                                            operationNo: opKey,
                                            operationText: row.operation_text || '',
                                            note: '',
                                          })
                                    }
                                    disabled={subcontDisabled}
                                    title={subcontTitle}
                                    className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] ${mark ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50'}`}
                                  >
                                    {rowSubcontBusy ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : mark ? (
                                      <Undo2 className="h-3.5 w-3.5" />
                                    ) : (
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    )}
                                    {mark ? 'Batal' : 'Tandai'}
                                  </button>
                                )}
                                {!mark && !canSubcont && (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </div>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1">
                              <button
                                onClick={() => removeOperation(index)}
                                className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            {canWrite && selectedOrder && !detailLoading && (
              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
                <p className="text-xs text-slate-500">
                  {isLatestRevision
                    ? 'Menyimpan detail info + WCT group & workcenter (tanpa membuat revisi baru).'
                    : 'Melihat revisi lama — hanya detail info yang tersimpan. Gunakan Create Revision untuk mengubah operasi.'}
                </p>
                <button
                  onClick={saveDetailInfo}
                  disabled={savingInfo}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#0077b6] px-5 text-sm font-semibold text-white hover:bg-[#023e8a] disabled:opacity-50"
                >
                  {savingInfo ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" /> Simpan Perubahan
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {subcontDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-0 backdrop-blur-sm md:items-center md:px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subcont-dialog-title"
        >
          <div className="w-full rounded-t-2xl border border-slate-200 bg-white p-6 shadow-xl md:max-w-md md:rounded-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="subcont-dialog-title" className="text-base font-bold text-slate-800">
                  Tandai Operasi Subcont
                </h3>
                <p className="truncate text-xs text-slate-500">
                  Order{' '}
                  <span className="font-mono font-semibold text-slate-700">{selectedOrder}</span> ·
                  Operasi{' '}
                  <span className="font-semibold tabular-nums text-slate-700">
                    {subcontDialog.operationNo}
                  </span>
                  {subcontDialog.operationText ? ` · ${subcontDialog.operationText}` : ''}
                </p>
              </div>
              <button
                onClick={() => setSubcontDialog(null)}
                disabled={!!subcontBusy}
                className="min-h-[44px] min-w-[44px] flex-shrink-0 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              Jam operasi ini akan dikeluarkan dari agregasi beban kerja internal. Jadwal
              start/finish dan kolom Workcenter <span className="font-semibold">tidak berubah</span>
              . Tanda dicatat beserta pengguna dan waktunya, dan bisa dibatalkan kapan saja.
            </p>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Catatan (opsional)
              </span>
              <input
                type="text"
                autoFocus
                maxLength={200}
                value={subcontDialog.note}
                onChange={(e) => setSubcontDialog((p) => ({ ...p, note: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !subcontBusy)
                    runSubcontAction(subcontDialog.operationNo, 'mark', subcontDialog.note);
                }}
                placeholder="mis. dikerjakan vendor machining"
                className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-all duration-150 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setSubcontDialog(null)}
                disabled={!!subcontBusy}
                className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-150 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={() =>
                  runSubcontAction(subcontDialog.operationNo, 'mark', subcontDialog.note)
                }
                disabled={!!subcontBusy}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0077b6] px-4 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#023e8a] disabled:opacity-50"
              >
                {subcontBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                {subcontBusy ? 'Menandai…' : 'Tandai Subcont'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOpCard && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/40 backdrop-blur-sm">
          <div className="ml-auto flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 flex-shrink-0">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Operation Card Preview</h3>
                <p className="text-sm text-slate-500">
                  {selectedOrder} — {editRows.length} operasi
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (opCardPrintRef.current) {
                      opCardPrintRef.current.contentWindow?.focus();
                      opCardPrintRef.current.contentWindow?.print();
                    }
                  }}
                  className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#0077b6] px-3 text-sm font-semibold text-white hover:bg-[#023e8a]"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                <button
                  onClick={() => setShowOpCard(false)}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-5" style={{ background: '#e8e6e0' }}>
              {opCardLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-[#0096c7]" />
                </div>
              ) : (
                <iframe
                  ref={opCardPrintRef}
                  srcDoc={opCardHtml}
                  title="Operation Card"
                  scrolling="no"
                  style={{ width: '100%', border: 'none', background: 'transparent' }}
                  onLoad={(e) => {
                    const body = e.target.contentDocument?.body;
                    if (body) e.target.style.height = body.scrollHeight + 40 + 'px';
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
