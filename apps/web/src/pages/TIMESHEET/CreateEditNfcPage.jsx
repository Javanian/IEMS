import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import { Smartphone, Shuffle, User, Factory, Save, CreditCard } from 'lucide-react';
import PasswordPrompt from '../../components/auth/PasswordPrompt';
import { normalizeNfcId } from '../../utils/nfcId';

const API_BASE = import.meta.env.VITE_API_URL || '';

const inputCls = `w-full px-3 py-2 bg-white border border-slate-200 text-slate-800 placeholder-slate-400
  rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all`;

const CreateEditNfcPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const editNfcId = searchParams.get('edit');
  const mode = editNfcId ? 'edit' : 'create';

  const [nfcid, setNfcid] = useState('');
  const [originalNfcId, setOriginalNfcId] = useState('');
  const [formData, setFormData] = useState({
    full_name: '',
    snssb: '',
    machineid: '',
    machinename: '',
    workcenter: '',
    roles: '',
  });
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
  const [isSaving, setIsSaving] = useState(false);

  const [allWorkcenters, setAllWorkcenters] = useState([]);
  const [wcSearch, setWcSearch] = useState('');
  const [showWcDropdown, setShowWcDropdown] = useState(false);
  const wcDropdownRef = React.useRef(null);

  useEffect(() => {
    if (mode === 'edit' && editNfcId) {
      loadUserData(decodeURIComponent(editNfcId));
    }
    loadWorkcenters();
  }, [mode, editNfcId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wcDropdownRef.current && !wcDropdownRef.current.contains(event.target)) {
        setShowWcDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadWorkcenters = async () => {
    try {
      const res = await fetch(`${API_BASE}/workcenter`);
      const data = await res.json();
      setAllWorkcenters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading workcenters:', err);
    }
  };

  const workcenterOptions = React.useMemo(() => {
    const options = [];
    for (const wc of allWorkcenters) {
      if (wc.workcenternew)
        options.push({
          code: wc.workcenternew,
          description: wc.workcenter_description || '',
          machineid: wc.machineid || '',
          type: 'Normal',
        });
      if (wc.workcenterot)
        options.push({
          code: wc.workcenterot,
          description: wc.workcenter_description || '',
          machineid: wc.machineid || '',
          type: 'OT',
        });
    }
    return options;
  }, [allWorkcenters]);

  const filteredWcOptions = React.useMemo(() => {
    if (!wcSearch.trim()) return workcenterOptions;
    const q = wcSearch.toLowerCase();
    return workcenterOptions.filter(
      (wc) => wc.code.toLowerCase().includes(q) || wc.description.toLowerCase().includes(q)
    );
  }, [wcSearch, workcenterOptions]);

  const selectWorkcenter = (wc) => {
    setFormData((prev) => ({
      ...prev,
      machineid: wc.machineid,
      machinename: wc.description,
      workcenter: wc.code,
    }));
    setWcSearch(`${wc.description} — ${wc.code}`);
    setShowWcDropdown(false);
  };

  const loadUserData = async (nfcIdToLoad) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/usernfc/nfcid/${encodeURIComponent(nfcIdToLoad)}`);
      if (!response.ok) throw new Error('User not found');
      const data = await response.json();

      if (!data) {
        showStatus('error', 'User tidak ditemukan');
        setTimeout(() => navigate('/nfc-users'), 2000);
        return;
      }

      setNfcid(data.nfcid);
      setOriginalNfcId(data.nfcid);
      setFormData({
        full_name: data.full_name || '',
        snssb: data.snssb || '',
        machineid: data.machineid || '',
        machinename: data.machinename || '',
        workcenter: data.workcenter || '',
        roles: data.roles || '',
      });
    } catch (err) {
      console.error('Error loading user data:', err);
      showStatus('error', 'Gagal memuat data user');
    } finally {
      setLoading(false);
    }
  };

  const generateNfcId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'NFC';
    for (let i = 0; i < 9; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    setNfcid(id);
  };

  const extractNfcId = (event) => {
    if (event.serialNumber?.trim()) return normalizeNfcId(event.serialNumber);
    for (const record of event.message?.records || []) {
      if (record.recordType === 'text') {
        try {
          return normalizeNfcId(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
        } catch (err) {
          console.error('Error decoding NFC record:', err);
        }
      }
    }
    return '';
  };

  const handleNfcScan = async () => {
    if (!('NDEFReader' in window)) {
      showStatus('error', 'Browser tidak mendukung Web NFC. Gunakan Chrome di Android.');
      return;
    }
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      showStatus('success', 'Scanning... Tempelkan kartu NFC');
      reader.onreading = (event) => {
        const scannedId = extractNfcId(event);
        if (!scannedId) {
          showStatus('error', 'Gagal membaca NFC ID dari kartu');
          return;
        }
        setNfcid(scannedId);
        showStatus('success', `NFC ID berhasil dibaca: ${scannedId}`);
      };
      reader.onerror = () => showStatus('error', 'Error saat membaca NFC');
    } catch (err) {
      const msgs = {
        NotAllowedError: 'Izin NFC ditolak. Mohon izinkan akses NFC.',
        NotSupportedError: 'NFC tidak didukung di perangkat ini.',
        NotReadableError: 'NFC tidak dapat dibaca. Periksa hardware NFC.',
        InvalidStateError: 'NFC dalam state invalid. Coba lagi.',
      };
      showStatus('error', msgs[err.name] || `Gagal scan NFC: ${err.message}`);
    }
  };

  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage({ type: '', text: '' }), 5000);
  };

  const handleInputChange = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const validateForm = () => {
    if (!nfcid.trim()) {
      showStatus('error', 'NFC ID tidak boleh kosong');
      return false;
    }
    if (!formData.full_name.trim()) {
      showStatus('error', 'Full Name tidak boleh kosong');
      return false;
    }
    if (!formData.snssb.trim()) {
      showStatus('error', 'SNSSB tidak boleh kosong');
      return false;
    }
    return true;
  };

  const checkNfcExists = async (id) => {
    try {
      const r = await fetch(`${API_BASE}/usernfc/nfcid/${encodeURIComponent(id)}`);
      return r.ok;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const payload = {
        nfcid: normalizeNfcId(nfcid),
        full_name: formData.full_name.trim(),
        snssb: formData.snssb.trim(),
        machineid: formData.machineid.trim(),
        machinename: formData.machinename.trim(),
        workcenter: formData.workcenter.trim(),
        roles: formData.roles.trim(),
      };

      if (mode === 'create') {
        const exists = await checkNfcExists(nfcid.trim());
        const url = exists
          ? `${API_BASE}/usernfc/nfcedit/${encodeURIComponent(nfcid.trim())}`
          : `${API_BASE}/usernfc`;
        const method = exists ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to save');
        showStatus(
          'success',
          exists ? 'User sudah ada, data berhasil diupdate' : 'User berhasil dibuat'
        );
      } else {
        const res = await fetch(
          `${API_BASE}/usernfc/nfcedit/${encodeURIComponent(originalNfcId)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || `Server error ${res.status}`);
        }
        showStatus('success', 'User berhasil diupdate');
      }

      setTimeout(() => navigate('/nfc-users'), 1000);
    } catch (err) {
      console.error('Error saving user:', err);
      showStatus('error', `Gagal menyimpan: ${err.message}`);
      setIsSaving(false);
    }
  };

  return (
    <PasswordPrompt password="12345">
      <div className="min-h-screen w-screen bg-slate-50 flex flex-col overflow-auto">
        {}
        <header className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-6 py-2.5 bg-white border-b border-slate-200 shadow-sm">
          <button
            onClick={() => goBackOrFallback(navigate)}
            className="min-h-[44px] flex items-center bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          >
            ← Back
          </button>
          <h1 className="text-sm md:text-base font-extrabold text-slate-800">
            {mode === 'edit' ? 'Edit NFC User' : 'Create NFC User'}
          </h1>
          <div className="w-20" />
        </header>

        {}
        {statusMessage.text && (
          <div
            className={`px-4 py-2.5 text-xs font-semibold text-center ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-b border-emerald-200'
                : 'bg-red-50 text-red-700 border-b border-red-200'
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        {}
        <main className="flex-1 px-4 md:px-6 py-4 max-w-2xl mx-auto w-full">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="animate-spin w-10 h-10 border-4 border-[#00b4d8] border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm text-slate-500">Loading...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {}
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <CreditCard size={14} className="text-[#0096c7]" /> NFC Card ID
                </h2>

                {}
                <div
                  className="rounded-xl p-4 mb-3 text-center border"
                  style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
                >
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wide mb-1"
                    style={{ color: '#0077b6' }}
                  >
                    NFC ID
                  </div>
                  <div
                    className="text-xl font-mono font-extrabold tracking-wider"
                    style={{ color: '#03045e' }}
                  >
                    {nfcid || '— NO ID —'}
                  </div>
                </div>

                {}
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    NFC ID <span className="text-red-500">*</span>
                    {mode === 'edit' && nfcid !== originalNfcId && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-bold">
                        Berubah dari: {originalNfcId}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={nfcid}
                    onChange={(e) => setNfcid(e.target.value.toUpperCase())}
                    className={inputCls}
                    placeholder="Ketik manual, scan NFC, atau generate"
                  />
                </div>

                {}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleNfcScan}
                    className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#0096c7] hover:bg-[#0077b6] text-white rounded-lg transition-all active:scale-95"
                  >
                    <Smartphone size={14} /> Scan NFC
                  </button>
                  <button
                    type="button"
                    onClick={generateNfcId}
                    className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-all active:scale-95"
                  >
                    <Shuffle size={14} /> Generate Test ID
                  </button>
                </div>
              </section>

              {}
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <User size={14} className="text-[#0096c7]" /> User Information
                </h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => handleInputChange('full_name', e.target.value)}
                      className={inputCls}
                      placeholder="e.g., Budi Santoso"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      SNSSB (Serial Number) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.snssb}
                      onChange={(e) => handleInputChange('snssb', e.target.value)}
                      className={inputCls}
                      placeholder="e.g., EMP001"
                    />
                  </div>
                </div>
              </section>

              {}
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Factory size={14} className="text-[#0096c7]" /> Machine Assignment{' '}
                  <span className="text-slate-400 font-normal normal-case">(opsional)</span>
                </h2>
                <div className="space-y-3">
                  {}
                  <div ref={wcDropdownRef}>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Pilih Workcenter
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={
                          wcSearch ||
                          (formData.workcenter
                            ? `${formData.machinename} — ${formData.workcenter}`
                            : '')
                        }
                        onChange={(e) => {
                          setWcSearch(e.target.value);
                          setShowWcDropdown(true);
                        }}
                        onFocus={() => setShowWcDropdown(true)}
                        placeholder="Search workcenter..."
                        className={inputCls}
                      />
                      {showWcDropdown && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-md max-h-56 overflow-y-auto">
                          {filteredWcOptions.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-slate-500 text-center">
                              Tidak ditemukan
                            </div>
                          ) : (
                            filteredWcOptions.map((wc, idx) => (
                              <div
                                key={idx}
                                onClick={() => selectWorkcenter(wc)}
                                className="px-3 py-2.5 text-xs hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0 flex items-center justify-between"
                              >
                                <div>
                                  <div className="font-semibold text-slate-800">
                                    {wc.description}
                                  </div>
                                  <div className="text-slate-500 font-mono">{wc.code}</div>
                                </div>
                                <span
                                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                    wc.type === 'OT'
                                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                                      : 'bg-[#caf0f8] text-[#0077b6] border-[#90e0ef]'
                                  }`}
                                >
                                  {wc.type}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Machine ID', value: formData.machineid },
                      { label: 'Description', value: formData.machinename },
                      { label: 'Workcenter Code', value: formData.workcenter },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                          {label}
                        </label>
                        <input
                          type="text"
                          value={value}
                          disabled
                          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 text-slate-600 rounded-lg cursor-not-allowed opacity-75"
                        />
                      </div>
                    ))}
                  </div>

                  {}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                    <select
                      value={formData.roles}
                      onChange={(e) => handleInputChange('roles', e.target.value)}
                      className={inputCls}
                    >
                      <option value="">-- Select Role --</option>
                      <option value="USER">User</option>
                      <option value="FOREMAN">Foreman</option>
                      <option value="ADMINISTRATOR">Administrator</option>
                      <option value="SUPERUSER">SuperUser</option>
                    </select>
                  </div>
                </div>
              </section>

              {}
              <div className="flex justify-end pb-4">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[44px] flex items-center gap-1.5 px-6 py-2.5 text-sm font-semibold bg-[#0096c7] hover:bg-[#0077b6] text-white rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{' '}
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <Save size={15} /> {mode === 'edit' ? 'Update User' : 'Save User'}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </main>
      </div>
    </PasswordPrompt>
  );
};

export default CreateEditNfcPage;
