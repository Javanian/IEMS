import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Info,
  Loader2,
  Printer,
  Save,
  Search,
  Shuffle,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useCan } from '../../rbac';
import {
  ChecklistPanel,
  ComponentMasterPicker,
  EditPanel,
  applyOperationEdit,
  OperationCardPreview,
  TravelCardPreview,
  formatTravelCardIssuedAt,
  generateOperationCardBoxImage,
  getAuthUserDisplayName,
  makeEditEntry,
  makeOperationCardKey,
  normalizeProductionOrder,
  useWorkcenterData,
} from './SowCreatePage';
import { useSowDraft } from '../../features/sow/useSowDraft';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function toEditEntry(row, index) {
  const total = row.planhours ?? row.std_hours ?? '';

  const nnva = Number.parseFloat(row.nnva_hours);
  const va = Number.parseFloat(row.va_hours);
  const totalNum = Number.parseFloat(total);
  const nnvaHours = Number.isFinite(nnva) ? nnva : 0;
  const vaHours = Number.isFinite(va) ? va : Number.isFinite(totalNum) ? totalNum - nnvaHours : '';
  return {
    ...row,
    _key: `sow-${row.idsow || `${row.order_no}-${row.operation_no}-${index}`}`,
    _cardSourceId: row.idsow,
    _srcId: row.source_op_id || null,
    machineid: row.workcenter || row.machineid || '',
    std_hours: total,
    va_hours: vaHours,
    nnva_hours: nnvaHours,
    operation_no: row.operation_no || (index + 1) * 10,
  };
}

function toOrderNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isGeneralServiceOperation(op) {
  const text = String(op?.operation_text || '')
    .trim()
    .toLowerCase();
  const desiredNo = toOrderNumber(op?.operation_no ?? op?._standardOperationNo);
  return text.startsWith('general service') || (desiredNo != null && desiredNo >= 5000);
}

function allocateRevisionOperationNo(items, op) {
  const used = new Set(
    items.map((item) => toOrderNumber(item.operation_no)).filter((number) => number != null)
  );
  const desired = toOrderNumber(op.operation_no ?? op._standardOperationNo);
  if (desired != null && !used.has(desired)) return desired;

  const general = isGeneralServiceOperation(op);
  const numbers = [...used].filter((number) => (general ? number >= 5000 : number < 5000));
  return Math.max(general ? 5000 : 0, ...numbers) + (general ? 1 : 10);
}

function buildSelectedPart(first, component) {
  return {
    component_id: component?.component_id || null,
    part_number: component?.part_number || first.part_number || '',
    part_name: component?.part_name || first.part_name || '',
    model: component?.model || first.model || '',
    production_order: first.order_no || '',
    ssbr_ident: first.ssbr_id || '',
    customer_name: first.customer || '',
    customer_site_name: first.location || '',
    customer_site_location: first.location || '',
    part_type: first.type || '',
    parent_part_name: first.group || '',
  };
}

function findExactComponent(components, source) {
  const sourceComponentId = source.component_id == null ? '' : String(source.component_id);
  const sourcePartNumber = String(source.part_number || '');
  const sourcePartName = String(source.part_name || '');
  const sourceModel = String(source.model || '');

  return (
    components.find(
      (item) => sourceComponentId && String(item.component_id) === sourceComponentId
    ) ||
    components.find(
      (item) =>
        sourcePartNumber &&
        sourceModel &&
        String(item.part_number || '') === sourcePartNumber &&
        String(item.model || '') === sourceModel
    ) ||
    components.find(
      (item) =>
        sourcePartName &&
        sourceModel &&
        String(item.part_name || '') === sourcePartName &&
        String(item.model || '') === sourceModel
    ) ||
    null
  );
}

export default function SowRevisionEditPage() {
  const { orderNo = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const decodedOrderNo = decodeURIComponent(orderNo);
  const requestedRevision = Number(searchParams.get('revision_no') || 0);
  const canWrite = useCan('sow_management', 'write');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeStep, setActiveStep] = useState('edit');
  const [selectedPart, setSelectedPart] = useState(null);
  const [cardInfo, setCardInfo] = useState({
    customer: '',
    productionOrder: '',
    location: '',
    ident: '',
    documentNo: '',
  });
  const [documentNos, setDocumentNos] = useState([]);
  const [editOps, setEditOps] = useState([]);
  const [checkedOps, setCheckedOps] = useState(new Set());
  const [checkedTemplates, setCheckedTemplates] = useState(new Set());
  const checkedTemplateOpsRef = useRef(new Map());
  const [currentRevision, setCurrentRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);
  const [revisionOptions, setRevisionOptions] = useState([]);
  const [operationCardKeys, setOperationCardKeys] = useState([]);
  const [activeOperationKey, setActiveOperationKey] = useState(null);
  const [operationCardImages, setOperationCardImages] = useState({});
  const [operationCardPaths, setOperationCardPaths] = useState({});
  const [operationCardsLoadedForRevision, setOperationCardsLoadedForRevision] = useState(null);
  const [operationCardsLoading, setOperationCardsLoading] = useState(false);
  const [dirtyCardKeys, setDirtyCardKeys] = useState(new Set());
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showPartPicker, setShowPartPicker] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printRef = useRef(null);
  const issuedByName = getAuthUserDisplayName();
  const issuedAt = useMemo(() => formatTravelCardIssuedAt(), []);
  const wcData = useWorkcenterData();

  const { draftAvailable, lastSavedAt, restoreDraft, discardDraft } = useSowDraft({
    context: 'revision',
    refKey: decodedOrderNo,
    state: {
      selectedPart,
      cardInfo,
      editOps,
      activeStep,
      selectedRevision,
      currentRevision,
      operationCardKeys,
      operationCardImages,
      operationCardPaths,
      dirtyCardKeys: [...dirtyCardKeys],
    },
    enabled: !loading && !saving && editOps.length > 0,
    onRestore: (payload) => {
      if (!payload) return;
      setSelectedPart(payload.selectedPart ?? null);
      setCardInfo((prev) => ({ ...prev, ...(payload.cardInfo || {}) }));
      setEditOps(Array.isArray(payload.editOps) ? payload.editOps : []);
      setActiveStep(payload.activeStep || 'edit');
      if (payload.selectedRevision != null) setSelectedRevision(payload.selectedRevision);
      if (payload.currentRevision != null) setCurrentRevision(payload.currentRevision);
      setOperationCardKeys(
        Array.isArray(payload.operationCardKeys) ? payload.operationCardKeys : []
      );
      setOperationCardImages(payload.operationCardImages || {});
      setOperationCardPaths(payload.operationCardPaths || {});
      setDirtyCardKeys(new Set(Array.isArray(payload.dirtyCardKeys) ? payload.dirtyCardKeys : []));
      setCheckedOps(new Set((payload.editOps || []).map((op) => op._srcId).filter(Boolean)));
      setCheckedTemplates(new Set());
      checkedTemplateOpsRef.current.clear();
    },
  });

  const opCardRevision = selectedRevision > 0 ? String(selectedRevision) : 'Original';
  const operationCardsLoadKey = useMemo(
    () =>
      `${opCardRevision}|${editOps.map((op) => op._cardSourceId || makeOperationCardKey(op)).join(',')}`,
    [editOps, opCardRevision]
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/sow/documentnos`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const rows = Array.isArray(json.data) ? json.data : [];
        setDocumentNos(rows);
        const defaultDoc = rows.find((row) => row.default)?.documentno || rows[0]?.documentno || '';
        if (defaultDoc)
          setCardInfo((prev) => ({ ...prev, documentNo: prev.documentNo || defaultDoc }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOrder = useCallback(
    async (revisionNo = requestedRevision) => {
      if (!decodedOrderNo) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (revisionNo) params.set('revision_no', String(revisionNo));
        const payload = await request(
          `/sow/history-order/${encodeURIComponent(decodedOrderNo)}${params.toString() ? `?${params.toString()}` : ''}`
        );
        const rows = payload.rows || [];
        if (!rows.length) throw new Error('Data SOW tidak ditemukan');

        const first = rows[0];
        const componentsPayload = await request('/sow/components');
        const component = findExactComponent(componentsPayload.data || [], first);
        const part = buildSelectedPart(first, component);
        const ops = rows.map(toEditEntry);
        const keys = ops.map(makeOperationCardKey);

        setSelectedPart(part);
        setCardInfo((prev) => ({
          customer: first.customer || '',
          productionOrder: normalizeProductionOrder(first.order_no || decodedOrderNo),
          location: first.location || '',
          ident: first.ssbr_id || '',
          documentNo: first.document_no || first.documentno || prev.documentNo || '',
        }));
        setEditOps(ops);
        setOperationCardKeys(keys);
        setActiveOperationKey(keys[0] || null);
        setCurrentRevision(payload.current_revision || 0);
        setSelectedRevision(payload.selected_revision || payload.current_revision || 0);
        setRevisionOptions(payload.revisions || []);
        setCheckedTemplates(new Set());
        checkedTemplateOpsRef.current.clear();
        setDirtyCardKeys(new Set());
        setOperationCardImages({});
        setOperationCardPaths({});
        setOperationCardsLoadedForRevision(null);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    },
    [decodedOrderNo, requestedRevision]
  );

  useEffect(() => {
    loadOrder(requestedRevision);
  }, [loadOrder, requestedRevision]);

  const handleRevisionSelect = (revisionNo) => {
    const next = new URLSearchParams(searchParams);
    if (revisionNo) next.set('revision_no', String(revisionNo));
    else next.delete('revision_no');
    setSearchParams(next);
  };

  const handleImagesChange = useCallback((updater) => {
    setOperationCardImages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const changed = [];
      const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
      keys.forEach((key) => {
        if (JSON.stringify(prev?.[key] || []) !== JSON.stringify(next?.[key] || []))
          changed.push(key);
      });
      if (changed.length) {
        setDirtyCardKeys((current) => {
          const copy = new Set(current);
          changed.forEach((key) => copy.add(key));
          return copy;
        });
      }
      return next;
    });
  }, []);

  const handleToggle = useCallback((op) => {
    setCheckedOps((prev) => {
      const next = new Set(prev);
      if (next.has(op.id)) next.delete(op.id);
      else next.add(op.id);
      return next;
    });
    setEditOps((prev) => {
      const already = prev.some((item) => item._srcId === op.id);
      if (already) return prev.filter((item) => item._srcId !== op.id);
      const entry = makeEditEntry(op, allocateRevisionOperationNo(prev, op));
      return [...prev, entry];
    });
  }, []);

  const handleToggleAll = useCallback((ops, checked) => {
    setCheckedOps((prev) => {
      const next = new Set(prev);
      ops.forEach((op) => (checked ? next.add(op.id) : next.delete(op.id)));
      return next;
    });
    setEditOps((prev) => {
      const existingIds = new Set(prev.map((item) => item._srcId).filter(Boolean));
      if (!checked) return prev.filter((item) => !ops.some((op) => op.id === item._srcId));
      return ops
        .filter((op) => !existingIds.has(op.id))
        .reduce(
          (items, op) => [...items, makeEditEntry(op, allocateRevisionOperationNo(items, op))],
          prev
        );
    });
  }, []);

  const handleToggleTemplate = useCallback((ops, selectAll, templateId) => {
    const templateOps = Array.isArray(ops) ? ops : [];
    if (templateOps.length === 0) return;

    setCheckedTemplates((prev) => {
      const next = new Set(prev);
      if (selectAll) next.add(templateId);
      else next.delete(templateId);
      return next;
    });

    if (selectAll) {
      checkedTemplateOpsRef.current.set(templateId, new Set(templateOps.map((op) => op.id)));
    } else {
      checkedTemplateOpsRef.current.delete(templateId);
    }

    const remainingTemplateOpIds = new Set();
    checkedTemplateOpsRef.current.forEach((opSet) =>
      opSet.forEach((id) => remainingTemplateOpIds.add(id))
    );

    setCheckedOps((prev) => {
      const next = new Set(prev);
      if (selectAll) {
        templateOps.forEach((op) => next.add(op.id));
      } else {
        templateOps.forEach((op) => {
          if (!remainingTemplateOpIds.has(op.id)) next.delete(op.id);
        });
      }
      return next;
    });

    setEditOps((prev) => {
      if (selectAll) {
        const existingIds = new Set(prev.map((item) => item._srcId).filter(Boolean));
        return templateOps
          .filter((op) => !existingIds.has(op.id))
          .reduce(
            (items, op) => [...items, makeEditEntry(op, allocateRevisionOperationNo(items, op))],
            prev
          );
      }
      return prev.filter(
        (item) =>
          item._srcId == null ||
          !templateOps.some((op) => op.id === item._srcId) ||
          remainingTemplateOpIds.has(item._srcId)
      );
    });
  }, []);

  const handleEdit = useCallback((key, field, value) => {
    setEditOps((prev) =>
      prev.map((op) => (op._key === key ? applyOperationEdit(op, field, value) : op))
    );
  }, []);

  const handleDelete = useCallback((key, sourceId) => {
    setEditOps((prev) => prev.filter((op) => op._key !== key));
    if (sourceId)
      setCheckedOps((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
  }, []);

  const handleReorder = useCallback((dragKey, targetKey) => {
    setEditOps((prev) => {
      const from = prev.findIndex((op) => op._key === dragKey);
      const to = prev.findIndex((op) => op._key === targetKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleAddOp = useCallback((opData) => {
    setEditOps((prev) => {
      const appended = [
        ...prev,
        {
          _key: `new-${Date.now()}`,
          _isNew: true,
          _srcId: null,
          operation_text: opData.operation_text,
          machineid: opData.machineid,
          std_hours: opData.std_hours,
          va_hours: opData.va_hours ?? opData.std_hours,
          nnva_hours: opData.nnva_hours ?? 0,
          operation_no: allocateRevisionOperationNo(prev, opData),
        },
      ];
      return appended;
    });
  }, []);

  const handlePartChange = useCallback((component) => {
    setSelectedPart((prev) => ({
      ...(prev || {}),
      component_id: component.component_id,
      part_number: component.part_number,
      part_name: component.part_name,
      model: component.model,
    }));
    setCheckedOps(new Set());
    setCheckedTemplates(new Set());
    checkedTemplateOpsRef.current.clear();
    setShowPartPicker(false);
    toast.success('Part diganti. Operation list kiri sudah mengikuti part baru.');
  }, []);

  const handlePrint = useCallback(() => {
    const iframe = printRef.current;
    if (!iframe || printing) return;
    setPrinting(true);
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setPrinting(false);
    }
  }, [printing]);

  const loadOperationCards = useCallback(async () => {
    const revisionKey = opCardRevision;
    if (operationCardsLoadedForRevision === operationCardsLoadKey) return;

    setOperationCardsLoading(true);
    try {
      const nextImages = {};
      const nextPaths = {};
      await Promise.all(
        editOps.map(async (op) => {
          if (!op._cardSourceId) return;
          const key = makeOperationCardKey(op);
          let card = null;
          for (const revision of [revisionKey, 'Original']) {
            try {
              const result = await request(
                `/sow/operationcard/${op._cardSourceId}?revision_no=${encodeURIComponent(revision)}`
              );
              if (result.data) {
                card = result.data;
                break;
              }
            } catch {
              card = null;
            }
          }
          if (card?.images) nextImages[key] = card.images;
          if (card?.image_path) nextPaths[key] = card.image_path;
        })
      );
      setOperationCardImages(nextImages);
      setOperationCardPaths(nextPaths);
      setDirtyCardKeys(new Set());
      setOperationCardsLoadedForRevision(operationCardsLoadKey);
    } catch (err) {
      toast.error(err.message || 'Gagal memuat operation card');
    } finally {
      setOperationCardsLoading(false);
    }
  }, [editOps, opCardRevision, operationCardsLoadKey, operationCardsLoadedForRevision]);

  const handleGoToOperationCard = useCallback(async () => {
    await loadOperationCards();
    setActiveStep('operation-card');
  }, [loadOperationCards]);

  const createRevision = async () => {
    if (!decodedOrderNo || editOps.length === 0) {
      toast.error('Operation tidak boleh kosong');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        operations: editOps.map((op) => ({
          ...op,
          order_no: decodedOrderNo,
          ssbr_id: cardInfo.ident,
          part_number: selectedPart?.part_number,
          part_name: selectedPart?.part_name,
          model: selectedPart?.model,
          customer: cardInfo.customer,
          location: cardInfo.location,
          workcenter: op.machineid,
          workcenterdescription: op.workcenterdescription || null,

          planhours: op.std_hours !== '' ? parseFloat(op.std_hours) : null,
          va_hours: op.va_hours !== '' && op.va_hours != null ? parseFloat(op.va_hours) : null,
          nnva_hours: op.nnva_hours != null ? parseFloat(op.nnva_hours) : 0,
          source_op_id: op.source_op_id || op._srcId || null,
        })),
      };
      const result = await request(`/sow/history-order/${encodeURIComponent(decodedOrderNo)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const revisionNo = result.revision?.revision_no || currentRevision + 1;
      const rowsByOperationNo = new Map(
        (result.rows || []).map((row) => [String(row.operation_no), row])
      );
      let savedCards = 0;

      for (const op of editOps) {
        const key = makeOperationCardKey(op);
        const images = operationCardImages[key] || [];
        const createdRow = rowsByOperationNo.get(String(op.operation_no));
        if (!createdRow?.idsow || !images.length) continue;
        const isDirty = dirtyCardKeys.has(key);
        const boxImageData = isDirty ? await generateOperationCardBoxImage(images) : null;
        await request(`/sow/operationcard/${createdRow.idsow}`, {
          method: 'POST',
          body: JSON.stringify({
            images,
            card_key: key,
            order_no: decodedOrderNo,
            operation_no: op.operation_no,
            revision_no: String(revisionNo),
            image_path: isDirty ? null : operationCardPaths[key] || null,
            box_image_data: boxImageData,
          }),
        });
        savedCards += 1;
      }

      toast.success(
        `Revision ${revisionNo} dibuat${savedCards ? `, ${savedCards} operation card tersimpan` : ''}`
      );
      discardDraft();
      navigate(
        `/sow-edit/revision/${encodeURIComponent(decodedOrderNo)}?revision_no=${revisionNo}`,
        { replace: true }
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedRevisionLabel = selectedRevision > 0 ? `Revision ${selectedRevision}` : 'Latest';

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-[#0096c7]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <button
              onClick={() => navigate('/sow-management/history')}
              className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-[#0096c7]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to SOW List
            </button>
            <h2 className="truncate text-sm font-bold text-slate-800">Create SOW Revision</h2>
            <p className="text-[11px] text-slate-400">
              {decodedOrderNo} / base {selectedRevisionLabel} / latest rev{' '}
              {currentRevision || 'Original'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedRevision || 0}
              onChange={(e) => handleRevisionSelect(Number(e.target.value))}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none"
            >
              <option value={0}>Latest</option>
              {revisionOptions.map((rev) => (
                <option key={rev.revision_no} value={rev.revision_no}>
                  Revision {rev.revision_no}
                </option>
              ))}
            </select>
            {activeStep !== 'edit' && (
              <button
                onClick={handlePrint}
                disabled={
                  printing || (activeStep === 'operation-card' && operationCardKeys.length === 0)
                }
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"
              >
                {printing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}{' '}
                Print
              </button>
            )}
            {canWrite && (
              <button
                onClick={createRevision}
                disabled={saving}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 text-xs font-bold text-white disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <BookmarkPlus className="h-3.5 w-3.5" />
                )}{' '}
                Create Revision
              </button>
            )}
          </div>
        </div>
      </div>

      {}
      {draftAvailable && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
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

      {activeStep === 'preview' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TravelCardPreview
            selectedPart={selectedPart}
            editOps={editOps}
            cardInfo={cardInfo}
            printRef={printRef}
            revisionLabel={selectedRevision > 0 ? String(selectedRevision) : '—'}
            issuedByName={issuedByName}
            issuedAt={issuedAt}
          />
        </div>
      ) : activeStep === 'operation-card' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <OperationCardPreview
            selectedPart={selectedPart}
            editOps={editOps}
            cardInfo={cardInfo}
            printRef={printRef}
            selectedKeys={operationCardKeys}
            onSelectedKeysChange={setOperationCardKeys}
            activeOperationKey={activeOperationKey}
            onActiveOperationChange={setActiveOperationKey}
            imagesByKey={operationCardImages}
            onImagesByKeyChange={handleImagesChange}
            revisionNo={opCardRevision}
            allowDirectSave={false}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                    <Search className="h-3.5 w-3.5" /> Operation dari Part Number
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPartPicker(true)}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Shuffle className="h-3 w-3" /> Ganti Part
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {selectedPart?.part_number || '-'} / {selectedPart?.part_name || '-'}
                </p>
              </div>
              <div className="min-h-0 flex-1">
                <ChecklistPanel
                  componentId={selectedPart?.component_id}
                  selectedPart={selectedPart}
                  checked={checkedOps}
                  checkedTemplates={checkedTemplates}
                  onToggle={handleToggle}
                  onToggleAll={handleToggleAll}
                  onToggleTemplate={handleToggleTemplate}
                  onResolveComponent={handlePartChange}
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <div>
                  <p className="text-xs font-bold text-slate-700">{editOps.length} operation</p>
                  <p className="text-[11px] text-slate-400">
                    {cardInfo.customer || '-'} / {cardInfo.ident || '-'}
                  </p>
                </div>
                <button
                  onClick={() => setShowInfoPanel(true)}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"
                >
                  <Info className="h-3.5 w-3.5" /> Info
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <EditPanel
                  editOps={editOps}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onReorder={handleReorder}
                  onAdd={handleAddOp}
                  wcData={wcData}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
        <button
          onClick={() => setActiveStep(activeStep === 'operation-card' ? 'preview' : 'edit')}
          disabled={activeStep === 'edit'}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex items-center gap-2">
          {activeStep === 'edit' && (
            <button
              onClick={() => setActiveStep('preview')}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 text-xs font-bold text-white"
            >
              Preview Travel Card <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {activeStep === 'preview' && (
            <button
              onClick={handleGoToOperationCard}
              disabled={operationCardsLoading}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {operationCardsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" />
              )}
              Next Operation Card
            </button>
          )}
        </div>
      </div>

      {showPartPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowPartPicker(false)}
        >
          <div
            className="h-[78vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Ganti Part</h3>
                <p className="text-[11px] text-slate-400">
                  Pilih master component untuk mengganti part revision ini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPartPicker(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="h-[calc(78vh-61px)] min-h-0">
              <ComponentMasterPicker selectedPart={selectedPart} onSelect={handlePartChange} />
            </div>
          </div>
        </div>
      )}

      {showInfoPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowInfoPanel(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-bold text-slate-800">Informasi SOW</h3>
            <div className="space-y-3 text-xs">
              <select
                value={cardInfo.documentNo || ''}
                onChange={(e) => setCardInfo((p) => ({ ...p, documentNo: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none"
              >
                <option value="">Document No. —</option>
                {documentNos.map((item) => (
                  <option key={item.id || item.documentno} value={item.documentno}>
                    {item.documentno}
                    {item.default ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              <input
                value={cardInfo.customer}
                onChange={(e) => setCardInfo((p) => ({ ...p, customer: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none"
                placeholder="Customer"
              />
              <input
                value={cardInfo.ident}
                onChange={(e) => setCardInfo((p) => ({ ...p, ident: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none"
                placeholder="SSBR ID"
              />
              <input
                value={cardInfo.location}
                onChange={(e) => setCardInfo((p) => ({ ...p, location: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none"
                placeholder="Location"
              />
              <button
                onClick={() => setShowInfoPanel(false)}
                className="inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#0096c7] text-xs font-bold text-white"
              >
                <Save className="h-3.5 w-3.5" /> Save Info
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
