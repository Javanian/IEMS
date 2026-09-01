import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import {
  Flame,
  Zap,
  Settings,
  Wrench,
  Gem,
  FlaskConical,
  Sparkles,
  Brush,
  Wind,
  FileEdit,
  ClipboardList,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ProcessControlPage = () => {
  const navigate = useNavigate();

  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [timesheets, setTimesheets] = useState([]);
  const [selectedTimesheet, setSelectedTimesheet] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [formData, setFormData] = useState({});
  const [otherMode, setOtherMode] = useState({});
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    loadCategories();
    loadTimesheets();
  }, []);

  const loadCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/process-control/categories`);
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
  };

  const loadTimesheets = async () => {
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      const serialnumber = datakaryawan?.snssb;
      if (!serialnumber) return;
      const res = await fetch(`${API_BASE}/timesheet/getsn/${serialnumber}?limit=100`);
      const data = await res.json();
      const sorted = data.sort(
        (a, b) => new Date(b.longdate_checkin) - new Date(a.longdate_checkin)
      );
      setTimesheets(sorted);
    } catch (err) {
      console.error('Error loading timesheets:', err);
    }
  };

  const loadParameters = async (categoryId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/process-control/parameters?process=${categoryId}`);
      const data = await res.json();

      for (const param of data) {
        if (param.ischoice) {
          const chRes = await fetch(
            `${API_BASE}/process-control/choices?parameter=${param.id_parameter}`
          );
          param.choices = await chRes.json();
        }
      }
      setParameters(data);
      setStep(3);
    } catch (err) {
      console.error('Error loading parameters:', err);
      alert('Gagal load parameters');
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySelect = (categoryId) => {
    setSelectedCategory(categoryId);
    setStep(2);
  };

  const handleTimesheetSelect = (timesheet) => {
    setSelectedTimesheet(timesheet);
    loadParameters(selectedCategory);
  };

  const handleInputChange = (parameterId, value) => {
    setFormData((prev) => ({ ...prev, [parameterId]: value }));
  };

  const handleSubmit = async () => {
    const emptyRequired = parameters.filter((p) => {
      if (p.parameter_name.toLowerCase().includes('note')) return false;
      return !formData[p.id_parameter];
    });
    if (emptyRequired.length > 0) {
      alert(`Mohon isi parameter: ${emptyRequired.map((p) => p.parameter_name).join(', ')}`);
      return;
    }
    if (!selectedTimesheet) {
      alert('Pilih timesheet terlebih dahulu');
      return;
    }

    setLoading(true);
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      const controlRes = await fetch(`${API_BASE}/process-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          production_order: selectedTimesheet.production_order,
          ssbr_id: selectedTimesheet.ssbr_ident,
          operation_text: selectedTimesheet.operation_text,
          full_name: datakaryawan.full_name,
          snssb: datakaryawan.snssb,
          operation_no: selectedTimesheet.seq,
          workcenter: selectedTimesheet.workcentercode,
          tsnumber: selectedTimesheet.tsnumber,
        }),
      });
      const controlData = await controlRes.json();
      const newId = controlData.id_processcontroldata;

      const categoryName = categories.find(
        (c) => String(c.id_process) === String(selectedCategory)
      )?.process_name;
      for (const param of parameters) {
        const value = formData[param.id_parameter] || '';
        await fetch(`${API_BASE}/process-control/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category_name: categoryName,
            parameter_name: param.parameter_name,
            value,
            uom: param.uom || '',
            isnumber: param.isnumber,
            ischoice: param.ischoice,
            id_parameter: param.id_parameter,
            id_processcontroldata: newId,
          }),
        });
      }
      alert('Data process control berhasil disimpan!');
      navigate('/timesheet-mainmenu');
    } catch (err) {
      console.error('Error saving process control:', err);
      alert('Gagal menyimpan data');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSelectedCategory('');
    setSelectedTimesheet(null);
    setParameters([]);
    setFormData({});
    setOtherMode({});
    setStep(1);
  };

  const goBack = () => {
    goBackOrFallback(navigate);
  };

  const renderParamInput = (param) => {
    const val = formData[param.id_parameter] || '';
    const isNote = param.parameter_name.toLowerCase().includes('note');

    if (param.ischoice) {
      const isOther = otherMode[param.id_parameter];
      return (
        <div className="space-y-1">
          <select
            value={isOther ? 'Other' : val}
            onChange={(e) => {
              if (e.target.value === 'Other') {
                setOtherMode((prev) => ({ ...prev, [param.id_parameter]: true }));
                handleInputChange(param.id_parameter, '');
              } else {
                setOtherMode((prev) => ({ ...prev, [param.id_parameter]: false }));
                handleInputChange(param.id_parameter, e.target.value);
              }
            }}
            className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">-- Pilih --</option>
            {param.choices?.map((c, i) => (
              <option key={i} value={c.choice_name}>
                {c.choice_name}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
          {isOther && (
            <input
              type="text"
              value={val}
              onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-white border border-orange-400 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
              placeholder="Other..."
              autoFocus
            />
          )}
        </div>
      );
    }

    if (param.isnumber) {
      return (
        <input
          type="number"
          value={val}
          onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          step="any"
          placeholder="0"
        />
      );
    }

    if (isNote) {
      return (
        <textarea
          value={val}
          onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
          placeholder="Catatan..."
        />
      );
    }

    return (
      <input
        type="text"
        value={val}
        onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        placeholder="-"
      />
    );
  };

  const categoryIconMap = {
    1: Flame,
    2: Zap,
    3: Settings,
    4: Wrench,
    5: Gem,
    6: FlaskConical,
    7: Sparkles,
    8: Brush,
    9: Wind,
  };
  const getCategoryIcon = (id) => {
    const Icon = categoryIconMap[id] || ClipboardList;
    return <Icon className="w-5 h-5" />;
  };

  const selectedCategoryName =
    categories.find((c) => String(c.id_process) === String(selectedCategory))?.process_name || '';

  return (
    <div className="h-dvh w-screen bg-gray-50 flex flex-col overflow-hidden">
      {}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2 shadow-md flex-shrink-0">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Back
        </button>
        <h2 className="text-sm sm:text-base font-bold text-white">Process Control</h2>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Reset
        </button>
      </header>

      {}
      <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex-shrink-0">
        <div className="flex items-center justify-center gap-1.5">
          {[
            { n: 1, label: 'Category' },
            { n: 2, label: 'Timesheet' },
            { n: 3, label: 'Parameters' },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              {i > 0 && <span className="text-blue-400 text-xs">›</span>}
              <button
                onClick={() => {
                  if (s.n < step) setStep(s.n);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  step === s.n
                    ? 'bg-blue-600 text-white shadow-sm'
                    : step > s.n
                      ? 'bg-blue-200 text-blue-800 hover:bg-blue-300 cursor-pointer'
                      : 'bg-white text-gray-400 border border-gray-200'
                }`}
                disabled={s.n > step}
              >
                <span className="font-bold">{s.n}</span>
                <span>{s.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {}
      <main className="flex-1 overflow-y-auto px-3 py-3">
        <div className="max-w-6xl mx-auto">
          {}
          {step === 1 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-blue-900">Pilih Kategori Proses</h3>
                <button
                  onClick={() => navigate('/edit-parameter')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 transition-colors shadow-sm"
                >
                  <FileEdit className="w-4 h-4" />
                  <span>Edit Parameter</span>
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id_process}
                    onClick={() => handleCategorySelect(cat.id_process)}
                    className="p-3 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-all text-left group"
                  >
                    <div className="mb-1">{getCategoryIcon(cat.id_process)}</div>
                    <div className="text-xs font-bold text-blue-900 group-hover:text-blue-700 leading-tight">
                      {cat.process_name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {}
          {step === 2 && (
            <div>
              <h3 className="text-sm font-bold text-blue-900 mb-3">Pilih Timesheet Aktif</h3>
              {timesheets.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                  Tidak ada timesheet aktif
                </div>
              ) : (
                <div className="space-y-2">
                  {timesheets.map((ts, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleTimesheetSelect(ts)}
                      className="p-3 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-blue-900">
                          {ts.production_order}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                          {ts.workcenterdescription || ts.workcentercode}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-600">
                        <div>
                          <span className="text-gray-400">SSBR:</span> {ts.ssbr_ident}
                        </div>
                        <div>
                          <span className="text-gray-400">Seq:</span> {ts.seq}
                        </div>
                        <div>
                          <span className="text-gray-400">By:</span> {ts.full_name}
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        <span className="text-gray-400">Check-in:</span> {ts.date_checkin}{' '}
                        {ts.hour_checkin}
                      </div>
                      <div className="text-[11px] text-gray-700 mt-0.5 truncate">
                        <span className="text-gray-400">Op:</span> {ts.operation_text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {}
          {step === 3 && (
            <div>
              {}
              <div className="flex items-center gap-2 mb-3 p-2 bg-blue-600 text-white rounded-lg text-xs">
                <span>{getCategoryIcon(selectedCategory)}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">{selectedCategoryName}</div>
                  <div className="text-blue-200 text-[10px] truncate">
                    {selectedTimesheet?.production_order} — {selectedTimesheet?.operation_text}
                  </div>
                </div>
                <span className="text-[10px] bg-blue-500 px-2 py-0.5 rounded">
                  {parameters.length} params
                </span>
              </div>

              {}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {parameters.map((param) => {
                  const isNote = param.parameter_name.toLowerCase().includes('note');
                  return (
                    <div
                      key={param.id_parameter}
                      className={`bg-white border border-gray-200 rounded-lg p-2 ${
                        isNote ? 'sm:col-span-2 lg:col-span-3' : ''
                      }`}
                    >
                      <label className="flex items-baseline gap-1 mb-1">
                        <span className="text-[11px] font-semibold text-gray-800 leading-tight">
                          {param.parameter_name}
                        </span>
                        {param.uom && (
                          <span className="text-[10px] text-blue-500 whitespace-nowrap">
                            ({param.uom})
                          </span>
                        )}
                      </label>
                      {renderParamInput(param)}
                    </div>
                  );
                })}
              </div>

              {}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className={`w-full mt-4 py-2.5 text-sm font-bold text-white rounded-lg transition-colors ${
                  loading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700'
                }`}
              >
                {loading ? 'Menyimpan...' : 'Submit Process Control'}
              </button>
            </div>
          )}

          {}
          {loading && step !== 3 && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProcessControlPage;
