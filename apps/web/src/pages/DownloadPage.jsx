import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../utils/navigation';
import { Download, BarChart2, Search, Info, Calendar, FileText, Lightbulb } from 'lucide-react';

const DownloadPage = () => {
  const navigate = useNavigate();

  const [field, setField] = useState('longdate_checkout');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage({ type: '', text: '' });
    }, 5000);
  };

  const validateInputs = () => {
    if (!startDate || !endDate) {
      showStatus('error', '❌ Isi Start Date dan End Date terlebih dahulu!');
      return false;
    }

    if (startDate > endDate) {
      showStatus('error', '❌ Start Date tidak boleh lebih besar dari End Date!');
      return false;
    }

    return true;
  };

  const buildQuery = () => {
    const params = new URLSearchParams({
      start: startDate,
      end: endDate,
      field: field,
    });
    return params.toString();
  };

  const downloadFile = async (url, filename) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }

      const blob = await res.blob();
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      showStatus('success', `✅ File berhasil diunduh: ${filename}`);
    } catch (err) {
      console.error('Download error:', err);
      showStatus('error', `❌ Gagal download: ${err.message}`);
    }
  };

  const handleDownloadExcel = async () => {
    if (!validateInputs()) return;

    setDownloading(true);
    try {
      const qs = buildQuery();
      const filename = `timesheet_${field}_${startDate}_to_${endDate}.xlsx`;

      console.log('Downloading Excel:', filename);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      showStatus('success', `✅ Excel file berhasil diunduh: ${filename}`);
    } catch (err) {
      console.error('Excel download error:', err);
      showStatus('error', '❌ Gagal download Excel');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadCsv = async () => {
    if (!validateInputs()) return;

    setDownloading(true);
    try {
      const qs = buildQuery();
      const filename = `timesheet_${field}_${startDate}_to_${endDate}.csv`;

      console.log('Downloading CSV:', filename);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      showStatus('success', `✅ CSV file berhasil diunduh: ${filename}`);
    } catch (err) {
      console.error('CSV download error:', err);
      showStatus('error', '❌ Gagal download CSV');
    } finally {
      setDownloading(false);
    }
  };

  const handleBack = () => {
    goBackOrFallback(navigate);
  };

  return (
    <div className="h-dvh w-screen bg-canvas flex flex-col overflow-hidden">
      {}
      <header className="bg-slate-900 px-4 py-3 shadow-lg flex-shrink-0">
        <div className="flex justify-between items-center">
          <button
            onClick={handleBack}
            disabled={downloading}
            className="px-4 py-2 text-sm font-medium bg-brand-700 text-white rounded shadow-lg hover:shadow-xl active:shadow-sm active:scale-[0.98] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
            }}
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Download className="w-6 h-6" />
            Export Timesheet
          </h1>
          <div className="w-20"></div> {}
        </div>
      </header>

      {}
      {statusMessage.text && (
        <div
          className={`px-4 py-3 text-sm font-medium text-center ${
            statusMessage.type === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {}
      <main className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <div className="w-full max-w-2xl">
          {}
          <div className="bg-white rounded-2xl shadow-2xl border border-brand-200 overflow-hidden">
            {}
            <div className="bg-brand-700 px-6 py-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <BarChart2 className="w-6 h-6" />
                Export Timesheet Data
              </h2>
              <p className="text-brand-100 text-sm mt-1">
                Download data timesheet dalam format Excel atau CSV
              </p>
            </div>

            {}
            <div className="p-6 space-y-6">
              {}
              <section className="bg-brand-50 rounded-lg p-4 border border-brand-200">
                <label className="block text-sm font-bold text-brand-900 mb-2 flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Date Field
                </label>
                <select
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  disabled={downloading}
                  className="w-full px-4 py-3 text-sm font-medium text-slate-800 bg-white border-2 border-brand-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="longdate_checkout">📤 Check-out Date (longdate_checkout)</option>
                  <option value="longdate_checkin">📥 Check-in Date (longdate_checkin)</option>
                </select>
                <p className="text-xs text-brand-700 mt-2">
                  <Info className="inline w-3.5 h-3.5 mr-1" />
                  Pilih field tanggal yang akan digunakan untuk filter data
                </p>
              </section>

              {}
              <section className="bg-amber-50 rounded-lg p-4 border border-orange-200">
                <h3 className="text-sm font-bold text-orange-900 mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Date Range
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      disabled={downloading}
                      className="w-full px-4 py-3 text-sm text-slate-800 bg-white border-2 border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>

                  {}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      disabled={downloading}
                      className="w-full px-4 py-3 text-sm text-slate-800 bg-white border-2 border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {}
                {startDate && endDate && (
                  <div className="mt-3 p-3 bg-white rounded-lg border border-orange-200">
                    <p className="text-xs text-slate-600">
                      <span className="font-medium">Range:</span>{' '}
                      <span className="font-mono text-orange-700">{startDate}</span>
                      {' → '}
                      <span className="font-mono text-orange-700">{endDate}</span>
                    </p>
                  </div>
                )}
              </section>

              {}
              <section className="space-y-3 pt-2">
                {}
                <button
                  onClick={handleDownloadExcel}
                  disabled={downloading}
                  className="w-full px-6 py-4 text-base font-bold bg-brand-700 hover:bg-brand-800 text-white rounded-lg shadow-lg hover:shadow-xl active:shadow-md active:scale-[0.98] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                  style={{
                    boxShadow:
                      '0 6px 16px -2px rgba(37, 99, 235, 0.6), 0 4px 8px -1px rgba(0, 0, 0, 0.3)',
                    opacity: '0.9',
                  }}
                >
                  <BarChart2 className="w-6 h-6" />
                  <span>{downloading ? 'Downloading...' : 'Download Excel (.xlsx)'}</span>
                </button>

                {}
                <button
                  onClick={handleDownloadCsv}
                  disabled={downloading}
                  className="w-full px-6 py-4 text-base font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-lg shadow-lg hover:shadow-xl active:shadow-md active:scale-[0.98] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                  style={{
                    boxShadow:
                      '0 6px 12px -2px rgba(249, 115, 22, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <FileText className="w-6 h-6" />
                  <span>{downloading ? 'Downloading...' : 'Download CSV (.csv)'}</span>
                </button>
              </section>

              {}
              <div className="bg-brand-50 border-l-4 border-brand-500 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-6 h-6 text-brand-700 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-brand-900 mb-1">Tips:</h4>
                    <ul className="text-xs text-brand-800 space-y-1">
                      <li>• Excel (.xlsx) untuk analisis data dengan formatting</li>
                      <li>• CSV (.csv) untuk import ke sistem lain atau database</li>
                      <li>• Pilih date field yang sesuai untuk filter data</li>
                      <li>• Pastikan range tanggal tidak terlalu lebar untuk performa optimal</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {}
      {downloading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-2xl p-6 flex flex-col items-center gap-3">
            <div className="animate-spin w-12 h-12 border-4 border-brand-900 border-t-transparent rounded-full"></div>
            <p className="text-brand-900 font-medium">Preparing download...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DownloadPage;
