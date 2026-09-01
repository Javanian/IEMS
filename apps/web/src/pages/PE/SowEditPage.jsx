import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ReadField = ({ label, value }) => (
  <div>
    <label className="block text-xs font-semibold text-blue-900 mb-1">{label}</label>
    <input
      type="text"
      value={value ?? ''}
      disabled
      className="w-full px-3 py-2 text-sm border border-blue-100 rounded bg-gray-50 text-gray-600 cursor-not-allowed"
    />
  </div>
);

const EditField = ({ label, value, onChange, placeholder, required, type = 'text' }) => (
  <div>
    <label className="block text-xs font-semibold text-blue-900 mb-1">
      {label}
      {required && <span className="text-orange-500 ml-1">*</span>}
    </label>
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition-all"
    />
  </div>
);

const SowEditPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadRow();
  }, [id]);

  useEffect(() => {
    const handler = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  const loadRow = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sow/getrow/${id}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setForm(data);
      setOriginal(data);
    } catch (err) {
      console.error('loadRow error:', err);
      alert('Data SOW tidak ditemukan');
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!form.operationtext?.trim()) {
      alert('Operation Text wajib diisi');
      return;
    }
    if (!window.confirm('Simpan perubahan SOW ini?')) return;

    setSaving(true);
    try {
      const body = {
        operationtext: form.operationtext,
        workcenter: form.workcenter,
        workcenterdescription: form.workcenterdescription,
        wct_group: form.wct_group,
        planhours:
          form.planhours !== '' && form.planhours != null ? parseFloat(form.planhours) : null,
        weight: form.weight !== '' && form.weight != null ? parseFloat(form.weight) : null,
        status: form.status,
        systemstatus: form.systemstatus,
        confirmation: form.confirmation,
        ssbr_id: form.ssbr_id,
        part_number: form.part_number,
        part_name: form.part_name,
        model: form.model,
        customer: form.customer,
        location: form.location,
        type: form.type,
        group: form.group,
        category: form.category,
        remark: form.remark,
      };

      const res = await fetch(`${API_BASE}/sow/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Gagal save');
      setHasChanges(false);
      navigate(-1);
    } catch (err) {
      console.error('handleSave error:', err);
      alert('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasChanges && !window.confirm('Ada perubahan yang belum disimpan. Yakin ingin kembali?'))
      return;
    navigate(-1);
  };

  if (loading) {
    return (
      <div className="h-screen h-dvh w-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-blue-900 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="h-screen h-dvh w-screen bg-white flex flex-col">
      {}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={handleCancel}
          className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Cancel
        </button>
        <div className="text-center">
          <h2 className="text-sm font-bold text-white">Edit SOW Operation</h2>
          <p className="text-[10px] text-blue-300">
            {form.order_no} · Op {form.operation_no}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${
            saving || !hasChanges
              ? 'bg-gray-400 text-white cursor-not-allowed'
              : 'bg-orange-500 text-white hover:bg-orange-600 active:translate-y-0.5'
          }`}
          style={!saving && hasChanges ? { boxShadow: '0 3px 0 #c2410c' } : {}}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </header>

      {}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-white">
        <div className="max-w-2xl mx-auto space-y-4">
          {}
          {hasChanges && (
            <div className="bg-orange-50 border border-orange-300 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="text-orange-500 font-bold">!</span>
              <span className="text-xs text-orange-800 font-semibold">
                Ada perubahan yang belum disimpan
              </span>
            </div>
          )}

          {}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <h3 className="text-xs font-bold text-blue-900 mb-3 uppercase tracking-wide">
              Identitas
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <ReadField label="ID SOW" value={form.idsow} />
              <ReadField label="Order No" value={form.order_no} />
              <ReadField label="Operation No" value={form.operation_no} />
              <ReadField label="Code Number" value={form.codenumber} />
            </div>
          </div>

          {}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <h3 className="text-xs font-bold text-blue-900 mb-3 uppercase tracking-wide">
              Part Info
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <EditField
                label="SSBR ID"
                value={form.ssbr_id}
                onChange={(v) => set('ssbr_id', v)}
                placeholder="SSBR ID"
              />
              <EditField
                label="Part Number"
                value={form.part_number}
                onChange={(v) => set('part_number', v)}
                placeholder="Part Number"
              />
              <div className="col-span-2">
                <EditField
                  label="Part Name"
                  value={form.part_name}
                  onChange={(v) => set('part_name', v)}
                  placeholder="Part Name"
                />
              </div>
              <EditField
                label="Model"
                value={form.model}
                onChange={(v) => set('model', v)}
                placeholder="Model"
              />
              <EditField
                label="Customer"
                value={form.customer}
                onChange={(v) => set('customer', v)}
                placeholder="Customer"
              />
              <EditField
                label="Location"
                value={form.location}
                onChange={(v) => set('location', v)}
                placeholder="Location"
              />
            </div>
          </div>

          {}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <h3 className="text-xs font-bold text-blue-900 mb-3 uppercase tracking-wide">
              Detail Operasi
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-blue-900 mb-1">
                  Operation Text <span className="text-orange-500">*</span>
                </label>
                <textarea
                  value={form.operationtext ?? ''}
                  onChange={(e) => set('operationtext', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none transition-all"
                  placeholder="Deskripsi operasi..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <EditField
                  label="Workcenter"
                  value={form.workcenter}
                  onChange={(v) => set('workcenter', v)}
                  placeholder="Kode workcenter"
                />
                <EditField
                  label="Workcenter Description"
                  value={form.workcenterdescription}
                  onChange={(v) => set('workcenterdescription', v)}
                  placeholder="Deskripsi"
                />
                <EditField
                  label="WCT Group"
                  value={form.wct_group}
                  onChange={(v) => set('wct_group', v)}
                  placeholder="WCT Group"
                />
                <EditField
                  label="Plan Hours"
                  value={form.planhours ?? ''}
                  onChange={(v) => set('planhours', v)}
                  placeholder="0.00"
                  type="number"
                />
                <EditField
                  label="Weight"
                  value={form.weight ?? ''}
                  onChange={(v) => set('weight', v)}
                  placeholder="0.00"
                  type="number"
                />
              </div>
            </div>
          </div>

          {}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <h3 className="text-xs font-bold text-blue-900 mb-3 uppercase tracking-wide">
              Klasifikasi
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <EditField
                label="Status"
                value={form.status}
                onChange={(v) => set('status', v)}
                placeholder="Status"
              />
              <EditField
                label="System Status"
                value={form.systemstatus}
                onChange={(v) => set('systemstatus', v)}
                placeholder="System Status"
              />
              <EditField
                label="Confirmation"
                value={form.confirmation}
                onChange={(v) => set('confirmation', v)}
                placeholder="Confirmation"
              />
              <EditField
                label="Type"
                value={form.type}
                onChange={(v) => set('type', v)}
                placeholder="Type"
              />
              <EditField
                label="Group"
                value={form.group}
                onChange={(v) => set('group', v)}
                placeholder="Group"
              />
              <EditField
                label="Category"
                value={form.category}
                onChange={(v) => set('category', v)}
                placeholder="Category"
              />
            </div>
          </div>

          {}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <h3 className="text-xs font-bold text-blue-900 mb-3 uppercase tracking-wide">Remark</h3>
            <textarea
              value={form.remark ?? ''}
              onChange={(e) => set('remark', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm text-gray-800 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-y transition-all"
              placeholder="Catatan tambahan..."
            />
          </div>

          {}
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
};

export default SowEditPage;
