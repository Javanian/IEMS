import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ConfirmationModal from '../../components/ui/ConfirmationModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

const TimesheetEditPage = () => {
  const navigate = useNavigate();
  const { tsnumber } = useParams();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get('returnUrl') || '/timesheet-validation';

  const [formData, setFormData] = useState({
    tsnumber: '',
    serialnumber: '',
    full_name: '',
    production_order: '',
    ssbr_ident: '',
    operation_text: '',
    seq: '',
    workcenterdescription: '',
    workcentercode: '',
    date_checkin: '',
    hour_checkin: '',
    date_checkout: '',
    hour_checkout: '',
    duration: '',
    note: '',
    planhours: '',
    std_foreman_hours: '',
    state_flag: '',
    validation_date: '',
  });

  const [checkinDatePicker, setCheckinDatePicker] = useState('');
  const [checkinTimePicker, setCheckinTimePicker] = useState('');
  const [checkoutDatePicker, setCheckoutDatePicker] = useState('');
  const [checkoutTimePicker, setCheckoutTimePicker] = useState('');

  const [workcenters, setWorkcenters] = useState([]);
  const [workcenterSearch, setWorkcenterSearch] = useState('');
  const [showWorkcenterDropdown, setShowWorkcenterDropdown] = useState(false);
  const [filteredWorkcenters, setFilteredWorkcenters] = useState([]);
  const workcenterDropdownRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalData, setOriginalData] = useState(null);

  const [confirmModal, setConfirmModal] = useState(null);
  const closeConfirmModal = () => setConfirmModal(null);

  useEffect(() => {
    loadTimesheetData();
    loadWorkcenters();
  }, [tsnumber]);

  useEffect(() => {
    calculateDuration();
  }, [
    formData.date_checkin,
    formData.hour_checkin,
    formData.date_checkout,
    formData.hour_checkout,
  ]);

  const workcenterOptions = React.useMemo(() => {
    const options = [];
    for (const wc of workcenters) {
      if (wc.workcenternew) {
        options.push({
          code: wc.workcenternew,
          description: wc.workcenter_description || '',
          machineid: wc.machineid || '',
          type: 'Normal',
        });
      }
      if (wc.workcenterot) {
        options.push({
          code: wc.workcenterot,
          description: wc.workcenter_description || '',
          machineid: wc.machineid || '',
          type: 'OT',
        });
      }
    }
    return options;
  }, [workcenters]);

  useEffect(() => {
    if (workcenterSearch.trim() === '') {
      setFilteredWorkcenters(workcenterOptions);
    } else {
      const query = workcenterSearch.toLowerCase();
      const filtered = workcenterOptions.filter(
        (wc) =>
          wc.code.toLowerCase().includes(query) || wc.description.toLowerCase().includes(query)
      );
      setFilteredWorkcenters(filtered);
    }
  }, [workcenterSearch, workcenterOptions]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (workcenterDropdownRef.current && !workcenterDropdownRef.current.contains(event.target)) {
        setShowWorkcenterDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const loadTimesheetData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/timesheet/getid/${tsnumber}`);
      if (!res.ok) throw new Error('Gagal load timesheet data');
      const record = await res.json();

      if (!record) {
        alert('Timesheet tidak ditemukan');
        navigate(returnUrl);
        return;
      }

      let sowPlanhours = record.planhours || null;
      if (record.production_order && record.seq) {
        try {
          const sowRes = await fetch(
            `${API_BASE}/sow/planhours?production_order=${encodeURIComponent(record.production_order)}&seq=${encodeURIComponent(record.seq)}`
          );
          if (sowRes.ok) {
            const sowData = await sowRes.json();
            if (sowData.planhours != null) {
              sowPlanhours = sowData.planhours;
            }
          }
        } catch (err) {
          console.error('Error fetching planhours from SOW:', err);
        }
      }

      setFormData({
        tsnumber: record.tsnumber || '',
        serialnumber: record.serialnumber || '',
        full_name: record.full_name || '',
        production_order: record.order_no || '',
        ssbr_ident: record.ssbr_id || '',
        operation_text: record.operation_text || '',
        seq: record.operation_no || '',
        workcenterdescription: record.workcenterdescription || '',
        workcentercode: record.workcentercode || '',
        date_checkin: record.date_checkin || '',
        hour_checkin: record.hour_checkin || '',
        date_checkout: record.date_checkout || '',
        hour_checkout: record.hour_checkout || '',
        duration: record.duration != null ? String(record.duration) : '',
        note: record.note || '',
        planhours: sowPlanhours != null ? String(sowPlanhours) : '',
        std_foreman_hours: record.std_foreman_hours != null ? String(record.std_foreman_hours) : '',
        state_flag: record.state_flag || '',
        validation_date: record.validation_date || '',
      });
      setOriginalData({ ...record, planhours: sowPlanhours });

      setCheckinDatePicker(ddmmyyyyToYyyymmdd(record.date_checkin));
      setCheckinTimePicker(normalizeTime(record.hour_checkin));
      setCheckoutDatePicker(ddmmyyyyToYyyymmdd(record.date_checkout));
      setCheckoutTimePicker(normalizeTime(record.hour_checkout));
    } catch (err) {
      console.error('Error loading timesheet:', err);
      alert('Gagal load data timesheet');
      navigate(returnUrl);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkcenters = async () => {
    try {
      const res = await fetch(`${API_BASE}/workcenter`);
      if (!res.ok) throw new Error('Gagal load workcenter');
      const data = await res.json();
      setWorkcenters(Array.isArray(data) ? data : []);
      setFilteredWorkcenters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading workcenters:', err);
      setWorkcenters([]);
      setFilteredWorkcenters([]);
    }
  };

  const ddmmyyyyToYyyymmdd = (ddmmyyyy) => {
    if (!ddmmyyyy) return '';
    const [day, month, year] = ddmmyyyy.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const yyyymmddToDdmmyyyy = (yyyymmdd) => {
    if (!yyyymmdd) return '';
    const [year, month, day] = yyyymmdd.split('-');
    return `${day}/${month}/${year}`;
  };

  const normalizeTime = (time) => {
    if (!time) return '';
    return time.replace('.', ':');
  };

  const calculateDuration = () => {
    const { date_checkin, hour_checkin, date_checkout, hour_checkout } = formData;

    if (!date_checkin || !hour_checkin || !date_checkout || !hour_checkout) {
      return;
    }

    try {
      const [dayIn, monthIn, yearIn] = date_checkin.split('/');
      const [hourIn, minIn] = hour_checkin.replace('.', ':').split(':');
      const checkinDate = new Date(yearIn, monthIn - 1, dayIn, hourIn, minIn);

      const [dayOut, monthOut, yearOut] = date_checkout.split('/');
      const [hourOut, minOut] = hour_checkout.replace('.', ':').split(':');
      const checkoutDate = new Date(yearOut, monthOut - 1, dayOut, hourOut, minOut);

      const diffMs = checkoutDate - checkinDate;
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours >= 0) {
        setFormData((prev) => ({
          ...prev,
          duration: diffHours.toFixed(2),
        }));
      }
    } catch (err) {
      console.error('Error calculating duration:', err);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    setHasChanges(true);
  };

  const handleDatePickerChange = (field, value) => {
    const ddmmyyyy = yyyymmddToDdmmyyyy(value);

    if (field === 'checkin') {
      setCheckinDatePicker(value);
      setFormData((prev) => ({
        ...prev,
        date_checkin: ddmmyyyy,
      }));
    } else if (field === 'checkout') {
      setCheckoutDatePicker(value);
      setFormData((prev) => ({
        ...prev,
        date_checkout: ddmmyyyy,
      }));
    }
    setHasChanges(true);
  };

  const handleTimePickerChange = (field, value) => {
    if (field === 'checkin') {
      setCheckinTimePicker(value);
      setFormData((prev) => ({
        ...prev,
        hour_checkin: value,
      }));
    } else if (field === 'checkout') {
      setCheckoutTimePicker(value);
      setFormData((prev) => ({
        ...prev,
        hour_checkout: value,
      }));
    }
    setHasChanges(true);
  };

  const selectWorkcenter = (wc) => {
    setFormData((prev) => ({
      ...prev,
      workcentercode: wc.code,
      workcenterdescription: wc.description,
    }));
    setWorkcenterSearch(`${wc.description} — ${wc.code}`);
    setShowWorkcenterDropdown(false);
    setHasChanges(true);
  };

  const buildLongdate = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const [day, month, year] = dateStr.split('/');
    const [hour, min] = timeStr.replace('.', ':').split(':');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}:00`;
  };

  const executeSave = async () => {
    setSaving(true);
    try {
      const longdate_checkin = buildLongdate(formData.date_checkin, formData.hour_checkin);
      const longdate_checkout = buildLongdate(formData.date_checkout, formData.hour_checkout);

      const body = {
        serialnumber: formData.serialnumber,
        full_name: formData.full_name,
        order_no: formData.production_order,
        ssbr_id: formData.ssbr_ident,
        operation_text: formData.operation_text,
        operation_no: formData.seq,
        workcentercode: formData.workcentercode,
        workcenterdescription: formData.workcenterdescription,
        longdate_checkin,
        longdate_checkout,
      };

      const res = await fetch(`${API_BASE}/timesheet/updateadmin/${tsnumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Gagal save timesheet');

      const patchBody = {};

      if (formData.note !== (originalData?.note || '')) {
        patchBody.note = formData.note;
      }

      const newStdForeman =
        formData.std_foreman_hours !== '' ? parseFloat(formData.std_foreman_hours) : null;
      const origStdForeman =
        originalData?.std_foreman_hours != null ? parseFloat(originalData.std_foreman_hours) : null;
      if (newStdForeman !== origStdForeman) {
        patchBody.std_foreman_hours = newStdForeman;
      }

      if (
        formData.planhours !== '' &&
        formData.planhours !==
          (originalData?.planhours != null ? String(originalData.planhours) : '')
      ) {
        patchBody.planhours = formData.planhours;
      } else if (formData.planhours !== '' && !originalData?.planhours) {
        patchBody.planhours = formData.planhours;
      }

      if (Object.keys(patchBody).length > 0) {
        const patchRes = await fetch(`${API_BASE}/timesheet/${tsnumber}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
        if (!patchRes.ok) console.error('Partial update failed');
      }

      setHasChanges(false);
      navigate(returnUrl);
    } catch (err) {
      console.error('Error saving timesheet:', err);
      alert('Gagal menyimpan timesheet: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!formData.date_checkin || !formData.hour_checkin) {
      alert('Check-in date dan time wajib diisi');
      return;
    }
    if (!formData.date_checkout || !formData.hour_checkout) {
      alert('Check-out date dan time wajib diisi');
      return;
    }
    if (!formData.workcentercode) {
      alert('Workcenter wajib dipilih');
      return;
    }

    const duration = parseFloat(formData.duration || 0);
    if (duration === 0) {
      setConfirmModal({
        title: 'Tandai sebagai Deleted?',
        message:
          'Duration = 0 karena Check-in dan Check-out sama. Timesheet ini akan ditandai sebagai Deleted (state_flag = 5).',
        confirmLabel: 'Ya, Tandai Deleted',
        cancelLabel: 'Tidak, Batalkan',
        onConfirm: executeSave,
      });
      return;
    }

    const confirmSave = window.confirm('Simpan perubahan timesheet ini?');
    if (!confirmSave) return;
    await executeSave();
  };

  const handleCancel = () => {
    if (hasChanges) {
      setConfirmModal({
        title: 'Perubahan Belum Disimpan',
        message: 'Ada perubahan yang belum disimpan. Yakin ingin kembali?',
        confirmLabel: 'Ya, Buang Perubahan',
        cancelLabel: 'Tidak, Tetap Edit',
        onConfirm: () => navigate(returnUrl),
      });
      return;
    }
    navigate(returnUrl);
  };

  const inputCls =
    'w-full px-3 py-2 text-sm bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all duration-150';
  const inputDisabledCls =
    'w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 text-slate-500 rounded-lg cursor-not-allowed';
  const labelCls = 'block text-xs font-semibold text-slate-700 mb-1';

  const isDeleted = formData.state_flag === '5';
  const isSapReject = formData.state_flag === '3';
  const isValidated = !!formData.validation_date && !isDeleted && !isSapReject;

  if (loading) {
    return (
      <div className="h-dvh w-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#00b4d8', borderTopColor: 'transparent' }}
          />
          <span className="text-sm font-medium text-slate-500">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-screen bg-slate-50 flex flex-col overflow-hidden">
      <ConfirmationModal
        isOpen={!!confirmModal}
        onConfirm={() => {
          confirmModal?.onConfirm();
          closeConfirmModal();
        }}
        onCancel={closeConfirmModal}
        title={confirmModal?.title}
        message={confirmModal?.message}
        confirmLabel={confirmModal?.confirmLabel}
        cancelLabel={confirmModal?.cancelLabel}
      />

      {}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm">
        <button
          onClick={handleCancel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95"
        >
          Cancel
        </button>
        <h2 className="text-base font-extrabold text-slate-800">Edit Timesheet</h2>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges || isValidated}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#0096c7] hover:bg-[#0077b6] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {}
      <div className="flex-1 overflow-hidden flex flex-col px-4 py-2 gap-2 bg-slate-50">
        {}
        {(isDeleted || isSapReject || isValidated || hasChanges) && (
          <div className="flex-shrink-0 flex flex-col gap-1">
            {isDeleted && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
                <span className="text-slate-500 font-bold text-sm leading-none">×</span>
                <span className="text-xs font-semibold text-slate-600">Deleted</span>
                <span className="text-xs text-slate-400">
                  — Timesheet ditandai sebagai Deleted (duration = 0)
                </span>
              </div>
            )}
            {isSapReject && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200">
                <span className="text-red-500 font-bold text-sm leading-none">!</span>
                <span className="text-xs font-semibold text-red-700">SAP Reject</span>
                <span className="text-xs text-red-500">
                  — Record ini ditolak SAP, edit dan kirim ulang
                </span>
              </div>
            )}
            {isValidated && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <span className="text-emerald-500 font-bold text-sm leading-none">✓</span>
                <span className="text-xs font-semibold text-emerald-700">Validated</span>
                <span className="text-xs text-emerald-500">— {formData.validation_date}</span>
              </div>
            )}
            {hasChanges && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                <span className="text-amber-500 font-bold text-sm leading-none">!</span>
                <span className="text-xs font-semibold text-amber-700">
                  Ada perubahan yang belum disimpan
                </span>
              </div>
            )}
          </div>
        )}

        {}
        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-3">
          {}
          <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-3 flex flex-col overflow-hidden">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex-shrink-0">
              General Information
            </h3>
            <div className="flex flex-col gap-2">
              <div>
                <label className={labelCls}>TS Number</label>
                <input
                  type="text"
                  value={formData.tsnumber}
                  disabled
                  className={inputDisabledCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Serial Number</label>
                  <input
                    type="text"
                    value={formData.serialnumber}
                    disabled
                    className={inputDisabledCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Employee Name</label>
                  <input
                    type="text"
                    value={formData.full_name}
                    disabled
                    className={inputDisabledCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Production Order</label>
                  <input
                    type="text"
                    value={formData.production_order}
                    disabled
                    className={inputDisabledCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Ident (SSBR)</label>
                  <input
                    type="text"
                    value={formData.ssbr_ident}
                    disabled
                    className={inputDisabledCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Operation</label>
                <textarea
                  value={formData.operation_text}
                  disabled
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 text-slate-500 rounded-lg cursor-not-allowed resize-none"
                />
              </div>

              {}
              <div ref={workcenterDropdownRef}>
                <label className={labelCls}>
                  Workcenter <span className="text-[#0096c7]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={workcenterSearch || formData.workcenterdescription}
                    onChange={(e) => {
                      if (!isValidated) {
                        setWorkcenterSearch(e.target.value);
                        setShowWorkcenterDropdown(true);
                      }
                    }}
                    onFocus={() => {
                      if (!isValidated) setShowWorkcenterDropdown(true);
                    }}
                    placeholder="Search workcenter…"
                    disabled={isValidated}
                    className={isValidated ? inputDisabledCls : inputCls}
                  />
                  {showWorkcenterDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-md max-h-48 overflow-y-auto">
                      {filteredWorkcenters.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-400">No workcenter found</div>
                      ) : (
                        filteredWorkcenters.map((wc, idx) => (
                          <div
                            key={idx}
                            onClick={() => selectWorkcenter(wc)}
                            className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800">{wc.description}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                  wc.type === 'OT'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-[#caf0f8] text-[#0077b6]'
                                }`}
                              >
                                {wc.type}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">{wc.code}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {formData.workcentercode && (
                  <div className="text-xs text-[#0096c7] mt-1">
                    Selected: {formData.workcenterdescription} — {formData.workcentercode}
                  </div>
                )}
              </div>
            </div>
          </div>

          {}
          <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-3 flex flex-col overflow-hidden">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex-shrink-0">
              Time Tracking
            </h3>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>
                    Check-in Date <span className="text-[#0096c7]">*</span>
                  </label>
                  <input
                    type="date"
                    value={checkinDatePicker}
                    onChange={(e) => handleDatePickerChange('checkin', e.target.value)}
                    disabled={isValidated}
                    className={isValidated ? inputDisabledCls : inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Check-in Time <span className="text-[#0096c7]">*</span>
                  </label>
                  <input
                    type="time"
                    value={checkinTimePicker}
                    onChange={(e) => handleTimePickerChange('checkin', e.target.value)}
                    disabled={isValidated}
                    className={isValidated ? inputDisabledCls : inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>
                    Check-out Date <span className="text-[#0096c7]">*</span>
                  </label>
                  <input
                    type="date"
                    value={checkoutDatePicker}
                    onChange={(e) => handleDatePickerChange('checkout', e.target.value)}
                    disabled={isValidated}
                    className={isValidated ? inputDisabledCls : inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Check-out Time <span className="text-[#0096c7]">*</span>
                  </label>
                  <input
                    type="time"
                    value={checkoutTimePicker}
                    onChange={(e) => handleTimePickerChange('checkout', e.target.value)}
                    disabled={isValidated}
                    className={isValidated ? inputDisabledCls : inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Duration (hours)</label>
                  <input
                    type="text"
                    value={formData.duration}
                    disabled
                    className={`w-full px-3 py-2 text-sm border rounded-lg cursor-not-allowed font-bold ${
                      parseFloat(formData.duration || 0) === 0
                        ? 'border-red-300 bg-red-50 text-red-600'
                        : 'border-slate-200 bg-slate-50 text-[#023e8a]'
                    }`}
                  />
                  {parseFloat(formData.duration || 0) === 0 && formData.date_checkout && (
                    <div className="text-[10px] text-red-500 mt-0.5 font-medium">
                      Duration = 0 → akan jadi Deleted
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>
                    Plan Hours <span className="text-[10px] font-normal text-slate-400">(SOW)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.planhours}
                    disabled
                    className={inputDisabledCls + ' font-bold'}
                  />
                </div>
                <div>
                  <label className={labelCls}>Std Foreman Hrs</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={formData.std_foreman_hours}
                    onChange={(e) => handleInputChange('std_foreman_hours', e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        !/[0-9.]/.test(e.key) &&
                        ![
                          'Backspace',
                          'Delete',
                          'Tab',
                          'ArrowLeft',
                          'ArrowRight',
                          'Home',
                          'End',
                        ].includes(e.key)
                      )
                        e.preventDefault();
                      if (e.key === '.' && e.target.value.includes('.')) e.preventDefault();
                    }}
                    disabled={isValidated}
                    placeholder="0.00"
                    className={isValidated ? inputDisabledCls : inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Note</label>
                <textarea
                  value={formData.note || ''}
                  onChange={(e) => handleInputChange('note', e.target.value)}
                  placeholder="Add note…"
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimesheetEditPage;
