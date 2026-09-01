import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';

const API_BASE = import.meta.env.VITE_API_URL || '';

const EditParameterPage = () => {
  const navigate = useNavigate();

  const [filterMode, setFilterMode] = useState('SN');
  const [processData, setProcessData] = useState([]);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [parameterItems, setParameterItems] = useState([]);
  const [editedValues, setEditedValues] = useState({});
  const [otherMode, setOtherMode] = useState({});
  const [otherText, setOtherText] = useState({});
  const [isForeman, setIsForeman] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
    if (datakaryawan && datakaryawan.roles === 'FOREMAN') {
      setIsForeman(true);
    }
  }, []);

  useEffect(() => {
    loadProcessControlData('SN');
  }, []);

  const loadProcessControlData = async (mode) => {
    setLoading(true);
    setFilterMode(mode);
    setSelectedProcess(null);
    setParameterItems([]);
    setEditedValues({});
    setOtherMode({});
    setOtherText({});
    setHasChanges(false);

    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      let endpoint;
      if (mode === 'SN') {
        endpoint = `${API_BASE}/process-control/by-sn/${datakaryawan?.snssb}`;
      } else {
        endpoint = `${API_BASE}/process-control/by-wct/${datakaryawan?.workcenter}`;
      }
      const response = await fetch(endpoint);
      const data = await response.json();
      setProcessData(data);
    } catch (err) {
      console.error('Error loading data:', err);
      alert('Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  const loadParameterItems = async (processControlId) => {
    setLoadingItems(true);
    try {
      const response = await fetch(`${API_BASE}/process-control/items/${processControlId}`);
      const items = await response.json();

      const initialValues = {};
      const initialOtherMode = {};
      const initialOtherText = {};

      for (const item of items) {
        initialValues[item.id_processcontroldata_item] = item.value || '';

        if (item.ischoice) {
          const chRes = await fetch(
            `${API_BASE}/process-control/choices?parameter=${item.id_parameter}`
          );
          const choices = await chRes.json();
          item.choices = choices;

          const isInChoices = choices.some((c) => c.choice_name === item.value);
          if (item.value && !isInChoices) {
            initialOtherMode[item.id_processcontroldata_item] = true;
            initialOtherText[item.id_processcontroldata_item] = item.value;
            initialValues[item.id_processcontroldata_item] = 'Other';
          } else {
            initialOtherMode[item.id_processcontroldata_item] = false;
            initialOtherText[item.id_processcontroldata_item] = '';
          }
        }
      }

      setParameterItems(items);
      setEditedValues(initialValues);
      setOtherMode(initialOtherMode);
      setOtherText(initialOtherText);
      setHasChanges(false);
    } catch (err) {
      console.error('Error loading parameter items:', err);
      alert('Gagal memuat parameter items');
    } finally {
      setLoadingItems(false);
    }
  };

  const handleSelectRow = (process) => {
    if (hasChanges) {
      if (!window.confirm('Ada perubahan yang belum disimpan. Lanjutkan?')) {
        return;
      }
    }
    setSelectedProcess(process);
    setHasChanges(false);
    loadParameterItems(process.id_processcontroldata);
  };

  const handleSelectChange = (itemId, value) => {
    if (value === 'Other') {
      setOtherMode((prev) => ({ ...prev, [itemId]: true }));
      setEditedValues((prev) => ({ ...prev, [itemId]: 'Other' }));
    } else {
      setOtherMode((prev) => ({ ...prev, [itemId]: false }));
      setOtherText((prev) => ({ ...prev, [itemId]: '' }));
      setEditedValues((prev) => ({ ...prev, [itemId]: value }));
    }
    setHasChanges(true);
  };

  const handleOtherTextChange = (itemId, value) => {
    setOtherText((prev) => ({ ...prev, [itemId]: value }));
    setHasChanges(true);
  };

  const handleInputChange = (itemId, value) => {
    setEditedValues((prev) => ({ ...prev, [itemId]: value }));
    setHasChanges(true);
  };

  const getFinalValue = (itemId) => {
    if (otherMode[itemId]) {
      return otherText[itemId] || '';
    }
    return editedValues[itemId] || '';
  };

  const handleSave = async () => {
    if (!selectedProcess) {
      alert('Pilih data process control terlebih dahulu');
      return;
    }

    try {
      for (const item of parameterItems) {
        const finalValue = getFinalValue(item.id_processcontroldata_item);

        if (finalValue !== (item.value || '')) {
          await fetch(`${API_BASE}/process-control/items/${item.id_processcontroldata_item}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              value: finalValue,
              status: item.status || '',
              note: item.note || '',
            }),
          });
        }
      }

      alert('Items updated');
      setHasChanges(false);

      loadParameterItems(selectedProcess.id_processcontroldata);
    } catch (err) {
      console.error('Error saving:', err);
      alert('Gagal menyimpan data');
    }
  };

  const handleValidation = async (status) => {
    if (!selectedProcess) {
      alert('Pilih data process control dulu');
      return;
    }

    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      const response = await fetch(
        `${API_BASE}/process-control/validate/${selectedProcess.id_processcontroldata}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            validation_by: datakaryawan?.full_name || '',
            validation_status: status,
          }),
        }
      );

      if (!response.ok) throw new Error('Gagal validasi');

      setProcessData((prev) =>
        prev.map((p) =>
          p.id_processcontroldata === selectedProcess.id_processcontroldata
            ? { ...p, validation_status: status, validation_by: datakaryawan?.full_name }
            : p
        )
      );
      setSelectedProcess((prev) => ({
        ...prev,
        validation_status: status,
        validation_by: datakaryawan?.full_name,
      }));

      alert(`Process control ${status}`);
    } catch (err) {
      console.error('Error validating:', err);
      alert('Gagal validasi data');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ACCEPTED':
      case 'Accept':
        return 'bg-green-100 text-green-800';
      case 'REJECTED':
      case 'Reject':
        return 'bg-red-100 text-red-800';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const renderItemInput = (item) => {
    const itemId = item.id_processcontroldata_item;
    const isOther = otherMode[itemId];

    if (item.ischoice) {
      return (
        <div className="space-y-1">
          <select
            value={isOther ? 'Other' : editedValues[itemId] || ''}
            onChange={(e) => handleSelectChange(itemId, e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">-- Pilih --</option>
            {item.choices?.map((c, i) => (
              <option key={i} value={c.choice_name}>
                {c.choice_name}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
          {isOther && (
            <input
              type="text"
              value={otherText[itemId] || ''}
              onChange={(e) => handleOtherTextChange(itemId, e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-white border border-orange-400 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Other..."
            />
          )}
        </div>
      );
    }

    if (item.isnumber) {
      return (
        <input
          type="number"
          value={editedValues[itemId] ?? ''}
          onChange={(e) => handleInputChange(itemId, e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          step="any"
          placeholder="0"
        />
      );
    }

    return (
      <input
        type="text"
        value={editedValues[itemId] ?? ''}
        onChange={(e) => handleInputChange(itemId, e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder="-"
      />
    );
  };

  return (
    <div className="h-dvh w-screen bg-white flex flex-col overflow-hidden">
      {}
      <header className="flex justify-between items-center bg-blue-900 px-4 py-3 shadow-md flex-shrink-0">
        <button
          onClick={() => goBackOrFallback(navigate)}
          className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-white">Edit Parameter</h1>
        <div className="w-20"></div>
      </header>

      {}
      <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 overflow-hidden">
        {}
        <section className="flex-1 bg-blue-50 rounded-lg shadow-md border border-blue-200 p-3 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 mb-3">
            <h2 className="text-base font-bold text-blue-900 mb-2">Process Control Data</h2>
            <div className="flex gap-2">
              <button
                onClick={() => loadProcessControlData('SN')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded transition-colors ${
                  filterMode === 'SN'
                    ? 'bg-blue-700 text-white'
                    : 'bg-white text-blue-900 border border-blue-300 hover:bg-blue-100'
                }`}
              >
                BySN
              </button>
              <button
                onClick={() => loadProcessControlData('WCT')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded transition-colors ${
                  filterMode === 'WCT'
                    ? 'bg-blue-700 text-white'
                    : 'bg-white text-blue-900 border border-blue-300 hover:bg-blue-100'
                }`}
              >
                ByWCT
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : processData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 text-sm">Tidak ada data</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-blue-700 text-white">
                  <tr>
                    <th className="px-2 py-2 text-left">ID</th>
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-left">Production Order</th>
                    <th className="px-2 py-2 text-left">Ident</th>
                    <th className="px-2 py-2 text-left">Workcenter</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Validator</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {processData.map((p) => (
                    <tr
                      key={p.id_processcontroldata}
                      onClick={() => handleSelectRow(p)}
                      className={`border-b border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors ${
                        selectedProcess?.id_processcontroldata === p.id_processcontroldata
                          ? 'bg-blue-200'
                          : ''
                      }`}
                    >
                      <td className="px-2 py-2">{p.id_processcontroldata}</td>
                      <td className="px-2 py-2">{p.full_name}</td>
                      <td className="px-2 py-2">{p.production_order}</td>
                      <td className="px-2 py-2">{p.ssbr_id}</td>
                      <td className="px-2 py-2">{p.workcenter}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusColor(p.validation_status)}`}
                        >
                          {p.validation_status || ''}
                        </span>
                      </td>
                      <td className="px-2 py-2">{p.validation_by || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {}
        <section
          className="flex-1 bg-blue-50 rounded-lg shadow-md border border-blue-200 p-3 flex flex-col overflow-hidden"
          style={{ minWidth: '50%' }}
        >
          {}
          {isForeman && selectedProcess && (
            <div className="flex gap-2 mb-3 flex-shrink-0">
              <button
                onClick={() => handleValidation('Accept')}
                className="flex-1 px-4 py-2 text-sm font-bold bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() => handleValidation('Reject')}
                className="flex-1 px-4 py-2 text-sm font-bold bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Reject
              </button>
            </div>
          )}

          {!selectedProcess ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-500 text-sm text-center">
                Pilih data dari tabel untuk melihat dan mengedit parameter
              </p>
            </div>
          ) : loadingItems ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {}
              <div className="flex-1 overflow-auto space-y-2.5">
                {parameterItems.length === 0 ? (
                  <p className="text-gray-500 text-center py-4 text-sm">
                    Tidak ada parameter items
                  </p>
                ) : (
                  parameterItems.map((item) => (
                    <div
                      key={item.id_processcontroldata_item}
                      className="bg-white border border-gray-200 rounded-lg p-2.5"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-gray-800">
                          {item.parameter_name}
                        </span>
                        {item.uom && (
                          <span className="text-[10px] text-blue-500 font-medium">
                            ({item.uom})
                          </span>
                        )}
                      </div>
                      {renderItemInput(item)}
                    </div>
                  ))
                )}
              </div>

              {}
              <div className="pt-3 mt-3 border-t border-blue-200 flex-shrink-0">
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={`w-full px-4 py-3 text-sm font-bold rounded transition-all ${
                    hasChanges
                      ? 'bg-gradient-to-b from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 shadow-md'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  Update Items
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default EditParameterPage;
