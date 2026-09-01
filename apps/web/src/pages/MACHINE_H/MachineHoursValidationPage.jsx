import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Filter,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const SUBMITTED_STORAGE_KEY = 'machine_hours_validation_submitted';
const FILTER_STORAGE_KEY = 'machineHoursValidationShowFilters';
const POST_SAP_STORAGE_KEY = 'machineHoursValidationPostSap';
const AUTO_REFRESH_MS = 30000;

const PALETTE = {
  deepTwilight: '#03045e',
  frenchBlue: '#023e8a',
  brightTealBlue: '#0077b6',
  blueGreen: '#0096c7',
  turquoiseSurf: '#00b4d8',
  skyAqua: '#48cae4',
  frostedBlue: '#90e0ef',
  frostedBlue2: '#ade8f4',
  lightCyan: '#caf0f8',
};

const Icon = {
  pending: <AlertCircle className="w-5 h-5" />,
  validated: <CheckCircle2 className="w-5 h-5" />,
  clock: <Clock className="w-5 h-5" />,
  file: <FileText className="w-5 h-5" />,
  download: <Download className="w-4 h-4" />,
  refresh: <RefreshCw className="w-4 h-4" />,
  filter: <Filter className="w-4 h-4" />,
  back: <ChevronLeft className="w-4 h-4" />,
  search: <Search className="w-4 h-4" />,
  x: <X className="w-3.5 h-3.5" strokeWidth={2.5} />,
};

const StatCard = ({ icon, label, primary, secondary, accentColor, bgColor, borderColor }) => (
  <div
    className="flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center border shadow-sm"
    style={{ background: bgColor, borderColor }}
  >
    <span style={{ color: accentColor }}>{icon}</span>
    <div
      className="text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: accentColor }}
    >
      {label}
    </div>
    <div className="text-base font-extrabold" style={{ color: accentColor }}>
      {primary}
    </div>
    {secondary && <div className="text-[10px] font-medium text-gray-500">{secondary}</div>}
  </div>
);

const StatusBadge = ({ isValidated, isSapPending }) => {
  if (isSapPending) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap inline-flex items-center gap-1">
        <span className="w-2.5 h-2.5 border border-t-transparent border-blue-600 rounded-full animate-spin flex-shrink-0" />
        SAP...
      </span>
    );
  }
  if (isValidated) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">
        Validated
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
      Pending
    </span>
  );
};

function normalizeStatusDescription(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getActivityTypeFromStatus(statusDescription) {
  const normalized = normalizeStatusDescription(statusDescription);
  if (!normalized) return '';

  if (normalized === 'productive') return 'M1';

  if (
    normalized === 'load' ||
    normalized === 'loading' ||
    normalized === 'setting' ||
    normalized === 'measure' ||
    normalized === 'meassure' ||
    normalized === 'unload' ||
    normalized === 'unloading' ||
    normalized === 'preventive'
  ) {
    return 'M2';
  }

  return '';
}

function normalizeActivityType(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (normalized === 'M1' || normalized === 'VA') return 'M1';
  if (normalized === 'M2' || normalized === 'NNVA') return 'M2';
  return '';
}

function getActivityBadge(activityType, statusDescription) {
  const effectiveType =
    normalizeActivityType(activityType) || getActivityTypeFromStatus(statusDescription);
  if (effectiveType === 'M2') {
    return {
      label: 'NNVA',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
    };
  }
  if (effectiveType === 'M1') {
    return {
      label: 'VA',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  return {
    label: 'NVA',
    className: 'bg-red-50 text-red-700 border-red-200',
  };
}

const ActivityBadge = ({ activityType, statusDescription }) => {
  const badge = getActivityBadge(activityType, statusDescription);
  const title = activityType
    ? `Activity type: ${activityType}`
    : `Status: ${statusDescription || '-'}`;

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide whitespace-nowrap ${badge.className}`}
    >
      {badge.label}
    </span>
  );
};

const ValidateBtn = ({ onClick, size = 'sm', title = 'Validate' }) => (
  <button
    onClick={onClick}
    title={title}
    className={`flex items-center justify-center rounded-full transition-all duration-150
      text-emerald-600 hover:bg-emerald-100 active:scale-95
      ${size === 'lg' ? 'w-9 h-9' : 'w-7 h-7'}`}
  >
    <CheckCircle2 className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} strokeWidth={2.5} />
  </button>
);

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatLocalDateInput(date);
}

function formatLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function apiUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value != null) query.set(key, value);
  });
  return `${API_BASE.replace(/\/$/, '')}${path}${query.toString() ? `?${query}` : ''}`;
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function fmtHours(value, digits = 1) {
  return Number(value || 0).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function secondsToHours(value) {
  return Number(value || 0) / 3600;
}

function formatDateShort(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatTime(value) {
  if (!value) return '-';
  const text = String(value).replace('T', ' ');
  const timeMatch = text.match(/\b(\d{2}:\d{2}(?::\d{2})?)/);
  if (!timeMatch) return text;
  return timeMatch[1].length === 5 ? `${timeMatch[1]}:00` : timeMatch[1];
}

function formatDurationHms(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds || 0)));
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}

function loadSubmittedKeys(storageKey = SUBMITTED_STORAGE_KEY) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSubmittedKeys(keys, storageKey = SUBMITTED_STORAGE_KEY) {
  localStorage.setItem(storageKey, JSON.stringify(Array.from(keys)));
}

const MachineRecordRow = React.memo(({ record, onValidateSingle, isSapPending, isSubmitted }) => {
  const durationSeconds = Number(record.duration_seconds || 0);
  const durationHms = formatDurationHms(durationSeconds);
  const rowBg = isSubmitted
    ? 'bg-emerald-50/50 hover:bg-emerald-100/60 opacity-75'
    : 'bg-white hover:bg-sky-50/60';

  return (
    <div className={`px-3 py-2.5 transition-colors duration-100 ${rowBg}`}>
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: '0.65fr 0.75fr 0.7fr 1.2fr 0.8fr 0.85fr 0.65fr 0.65fr 0.65fr 44px',
        }}
      >
        <div className="text-[11px] text-center">
          <div className="font-semibold" style={{ color: PALETTE.frenchBlue }}>
            {formatDateShort(record.work_date)}
          </div>
          <div className="text-[10px]" style={{ color: PALETTE.brightTealBlue }}>
            {record.machineid || '-'}
          </div>
        </div>

        <div className="text-[11px] text-left">
          <div className="font-medium text-gray-800 break-words leading-snug">
            {record.status_description || '-'}
          </div>
          <div className="text-[10px] text-gray-400">STAGE {record.statusid ?? '-'}</div>
        </div>

        <div className="text-[11px] text-center leading-tight">
          <div className="font-semibold text-gray-700 break-words">{record.full_name || '-'}</div>
          <div className="text-[10px] font-mono text-gray-400">{record.sn_employee || '-'}</div>
        </div>

        <div className="text-[11px] text-left">
          <div
            className="text-[10px] font-semibold leading-tight break-words"
            style={{ color: PALETTE.frenchBlue }}
          >
            {record.operation_short_text || '-'}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1 text-[9px] font-mono text-slate-500">
            <span>{record.order_no || '-'}</span>
            <span>/</span>
            <span>{record.operation_no || '-'}</span>
          </div>
        </div>

        <div className="text-[11px] text-center">
          <div className="font-mono text-[10px] leading-tight text-slate-600">
            {record.confirmation_no || record.jobid || '-'}
          </div>
        </div>

        <div className="text-[11px] text-center">
          <div className="flex items-center justify-center gap-1.5">
            <span className="font-medium text-gray-700">{formatDateShort(record.work_date)}</span>
            <div className="flex flex-col leading-tight" style={{ color: PALETTE.brightTealBlue }}>
              <span>{formatTime(record.startdatetime)}</span>
              <span>{formatTime(record.enddatetime)}</span>
            </div>
          </div>
        </div>

        <div className="text-[11px] text-center flex flex-col items-center leading-tight">
          <span className="font-mono text-[12px] font-bold" style={{ color: PALETTE.frenchBlue }}>
            {durationHms}
          </span>
          <span className="text-[9px] text-slate-400">
            {fmtHours(secondsToHours(durationSeconds), 4)} h
          </span>
        </div>

        <div className="text-[11px] text-center">
          <ActivityBadge
            activityType={record.activitytype}
            statusDescription={record.status_description}
          />
        </div>

        <div className="flex items-center justify-center">
          <StatusBadge isValidated={isSubmitted} isSapPending={isSapPending} />
        </div>

        <div className="flex items-center justify-center">
          {isSapPending ? (
            <div className="w-7 h-7 flex items-center justify-center">
              <span
                className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: PALETTE.turquoiseSurf, borderTopColor: 'transparent' }}
              />
            </div>
          ) : !isSubmitted ? (
            <ValidateBtn
              onClick={(e) => {
                e.stopPropagation();
                onValidateSingle(record);
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

const MachineGroup = React.memo(
  ({
    group,
    isExpanded,
    records,
    loadingRecords,
    submittedKeys,
    sapPendingKeys,
    onToggle,
    onValidateSingle,
    onValidateGroup,
  }) => {
    const loadedSubmitted = records.filter((record) => submittedKeys.has(record.record_key)).length;
    const recordCount = Number(group.record_count || 0);
    const pendingCount = Math.max(recordCount - loadedSubmitted, 0);
    const validatedCount = loadedSubmitted;
    const hasSapPending = records.some((record) => sapPendingKeys.has(record.record_key));
    const groupDurationSeconds = Number(group.duration_seconds || 0);

    return (
      <div
        className="rounded-xl overflow-hidden shadow-sm border transition-shadow duration-200 hover:shadow-md"
        style={{ borderColor: PALETTE.skyAqua }}
      >
        <div
          onClick={() => onToggle(group.machineno)}
          className="px-4 py-3 cursor-pointer select-none transition-colors duration-150 border-b"
          style={{
            background: `linear-gradient(135deg, ${PALETTE.frenchBlue} 0%, ${PALETTE.brightTealBlue} 100%)`,
            borderColor: PALETTE.blueGreen,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="text-white/80 transition-transform duration-200"
                style={{
                  display: 'inline-block',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                }}
              >
                <ChevronRight className="w-4 h-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-white">
                  {group.machine_description || group.machinename || '-'}
                </div>
                <div className="text-xs font-mono" style={{ color: PALETTE.frostedBlue2 }}>
                  {group.machineid || '-'} | Machine {group.machineno}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-[11px] leading-[17px] font-mono text-right">
                <div className="font-bold text-white/90">
                  Total: {recordCount} Act&nbsp;
                  <span className="text-white/70">[{formatDurationHms(groupDurationSeconds)}]</span>
                </div>
                <div className="font-bold text-amber-300">
                  Pending: {pendingCount} Act&nbsp;
                  <span className="text-amber-200">
                    [{formatDurationHms(groupDurationSeconds)}]
                  </span>
                </div>
                <div className="font-bold text-emerald-300">
                  Validated: {validatedCount} Act&nbsp;
                  <span className="text-emerald-200">[{formatDurationHms(0)}]</span>
                </div>
              </div>

              {(pendingCount > 0 || hasSapPending) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hasSapPending) onValidateGroup(group.machineno);
                  }}
                  disabled={hasSapPending}
                  title={
                    hasSapPending
                      ? 'Waiting for SAP confirmation...'
                      : 'Validate all pending in group'
                  }
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/35 active:scale-95 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {hasSapPending ? (
                    <span className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin" />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-5 h-5 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {isExpanded && (
          <div>
            <div
              className="px-3 py-2 border-b"
              style={{ background: PALETTE.lightCyan, borderColor: PALETTE.frostedBlue }}
            >
              <div
                className="grid gap-2 text-[10px] font-bold text-center uppercase tracking-wide"
                style={{
                  gridTemplateColumns:
                    '0.65fr 0.75fr 0.7fr 1.2fr 0.8fr 0.85fr 0.65fr 0.65fr 0.65fr 44px',
                  color: PALETTE.frenchBlue,
                }}
              >
                <div>Date</div>
                <div>Stage</div>
                <div>Employee</div>
                <div>Job</div>
                <div>Confirmation</div>
                <div>Time</div>
                <div>Duration</div>
                <div>Activity</div>
                <div>Status</div>
                <div>Act</div>
              </div>
            </div>

            <div className="divide-y" style={{ divideColor: PALETTE.frostedBlue2 }}>
              {loadingRecords ? (
                <div
                  className="py-6 text-center text-sm font-medium flex items-center justify-center gap-2"
                  style={{ color: PALETTE.brightTealBlue }}
                >
                  <span
                    className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin inline-block"
                    style={{ borderColor: PALETTE.turquoiseSurf, borderTopColor: 'transparent' }}
                  />
                  Loading records...
                </div>
              ) : records.length > 0 ? (
                records.map((record) => (
                  <MachineRecordRow
                    key={record.record_key}
                    record={record}
                    onValidateSingle={onValidateSingle}
                    isSapPending={sapPendingKeys.has(record.record_key)}
                    isSubmitted={submittedKeys.has(record.record_key)}
                  />
                ))
              ) : (
                <div className="py-6 text-center text-sm text-gray-400">No records found</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

const MachineHoursValidationPage = ({
  apiPrefix = '/machine-hours-validation',
  title = 'Overall Equipment Effectiveness',
  submittedStorageKey = SUBMITTED_STORAGE_KEY,
  filterStorageKey = FILTER_STORAGE_KEY,
  postSapStorageKey = POST_SAP_STORAGE_KEY,
  emptyMessage = 'Tidak ada data machine hours untuk divalidasi',
  detailLimit = 500,
} = {}) => {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({
    totalHours: '0.00',
    totalRecords: 0,
    totalMachines: 0,
    totalPending: 0,
    totalValidated: 0,
    totalEvents: 0,
    totalOpenEvents: 0,
  });
  const [filters, setFilters] = useState({
    start: todayMinus(7),
    end: formatLocalDateInput(),
    search: '',
    machineno: '',
    statusid: '',
    employee: '',
    confirmation_no: '',
  });
  const [showFilters, setShowFilters] = useState(
    () => localStorage.getItem(filterStorageKey) !== 'false'
  );
  const [postToSapEnabled, setPostToSapEnabled] = useState(
    () => localStorage.getItem(postSapStorageKey) !== 'false'
  );
  const [loading, setLoading] = useState(true);
  const [groupRecords, setGroupRecords] = useState({});
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [submittedKeys, setSubmittedKeys] = useState(() => loadSubmittedKeys(submittedStorageKey));
  const [sapPendingKeys, setSapPendingKeys] = useState(new Set());
  const [sapStatus, setSapStatus] = useState(null);
  const [error, setError] = useState('');

  const queryFilters = useMemo(() => ({ ...filters, limit: detailLimit }), [detailLimit, filters]);

  const loadValidationData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const response = await fetch(apiUrl(`${apiPrefix}/validation-stats`, queryFilters));
        const json = await response.json();
        if (!response.ok || json.success === false)
          throw new Error(json.error || 'Gagal load Overall Equipment Effectiveness');
        setStats(json.stats || {});
        setGroups(Array.isArray(json.groups) ? json.groups : []);
        if (!silent) setGroupRecords({});
      } catch (err) {
        setError(err.message);
        toast.error('Gagal load data machine hours', { description: err.message });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiPrefix, queryFilters]
  );

  useEffect(() => {
    loadValidationData();
  }, [loadValidationData]);

  useEffect(() => {
    const timer = window.setInterval(() => loadValidationData(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadValidationData]);

  const loadGroupRecords = useCallback(
    async (machineno, force = false) => {
      if (!force && groupRecords[machineno]?.records) return groupRecords[machineno].records;

      setGroupRecords((prev) => ({
        ...prev,
        [machineno]: { records: prev[machineno]?.records || [], loading: true },
      }));

      try {
        const response = await fetch(
          apiUrl(`${apiPrefix}/validation-group/${encodeURIComponent(machineno)}`, queryFilters)
        );
        const json = await response.json();
        if (!response.ok || json.success === false)
          throw new Error(json.error || 'Gagal load detail machine');
        const records = Array.isArray(json.data) ? json.data : [];
        setGroupRecords((prev) => ({ ...prev, [machineno]: { records, loading: false } }));
        return records;
      } catch (err) {
        setGroupRecords((prev) => ({
          ...prev,
          [machineno]: { records: prev[machineno]?.records || [], loading: false },
        }));
        toast.error('Gagal load detail machine', { description: err.message });
        return [];
      }
    },
    [apiPrefix, groupRecords, queryFilters]
  );

  const toggleGroup = useCallback(
    (machineno) => {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(machineno)) next.delete(machineno);
        else next.add(machineno);
        return next;
      });

      if (!groupRecords[machineno]?.records) loadGroupRecords(machineno);
    },
    [groupRecords, loadGroupRecords]
  );

  const expandAll = useCallback(() => {
    setExpandedGroups(new Set(groups.map((group) => group.machineno)));
    groups.forEach((group) => {
      if (!groupRecords[group.machineno]?.records) loadGroupRecords(group.machineno);
    });
  }, [groupRecords, groups, loadGroupRecords]);

  const collapseAll = useCallback(() => setExpandedGroups(new Set()), []);

  const markSubmitted = useCallback(
    (records) => {
      const keys = records.map((record) => record.record_key);
      setSubmittedKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.add(key));
        saveSubmittedKeys(next, submittedStorageKey);
        return next;
      });
      setSapPendingKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    },
    [submittedStorageKey]
  );

  const submitRecords = useCallback(
    async (records, label) => {
      const pendingRecords = records.filter((record) => !submittedKeys.has(record.record_key));
      if (pendingRecords.length === 0) return;

      const keys = pendingRecords.map((record) => record.record_key);
      setSapPendingKeys((prev) => new Set([...prev, ...keys]));
      setSapStatus({ posting: true, count: pendingRecords.length });

      await new Promise((resolve) => setTimeout(resolve, 250));

      if (postToSapEnabled) {
        const payloads = pendingRecords.map((record) => record.sap_payload);
        console.group(`Machine Hours SAP Payload - ${label}`);
        console.log(payloads);
        console.groupEnd();
      }

      markSubmitted(pendingRecords);
      setSapStatus({ posting: false, successCount: pendingRecords.length, failCount: 0 });
      toast.success(`${pendingRecords.length} payload siap dikirim ke SAP`);
    },
    [markSubmitted, postToSapEnabled, submittedKeys]
  );

  const handleValidateSingle = useCallback(
    (record) => {
      submitRecords([record], record.record_key);
    },
    [submitRecords]
  );

  const handleValidateGroup = useCallback(
    async (machineno) => {
      const records = await loadGroupRecords(machineno);
      submitRecords(records, `Machine ${machineno}`);
    },
    [loadGroupRecords, submitRecords]
  );

  const clearFilters = () => {
    setFilters({
      start: todayMinus(7),
      end: formatLocalDateInput(),
      search: '',
      machineno: '',
      statusid: '',
      employee: '',
      confirmation_no: '',
    });
  };

  const handleDownloadCsv = () => {
    const loadedRecords = Object.values(groupRecords).flatMap((entry) => entry.records || []);
    const rows = loadedRecords.length ? loadedRecords : groups;
    if (rows.length === 0) return;

    const fields = Object.keys(rows[0]).filter((field) => field !== 'sap_payload');
    const csv = [
      fields.join(';'),
      ...rows.map((row) =>
        fields.map((field) => `"${String(row[field] ?? '').replaceAll('"', '""')}"`).join(';')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const filePrefix =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || 'machine_hours';
    anchor.download = `${filePrefix}_${filters.start}_to_${filters.end}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const adjustedStats = useMemo(() => {
    const loadedKeys = Object.values(groupRecords)
      .flatMap((entry) => entry.records || [])
      .map((record) => record.record_key);
    const validated = loadedKeys.filter((key) => submittedKeys.has(key)).length;
    const totalRecords = Number(stats.totalRecords || 0);
    return {
      ...stats,
      totalValidated: validated,
      totalPending: Math.max(totalRecords - validated, 0),
    };
  }, [groupRecords, stats, submittedKeys]);

  const sapBannerStyle = sapStatus
    ? sapStatus.posting
      ? { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' }
      : { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' }
    : null;

  const btnBase =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';
  const btnOutline = `${btnBase} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300`;
  const btnPrimary = `${btnBase} text-white bg-[#0096c7] hover:bg-[#0077b6]`;
  const btnSolid = `${btnBase} text-white`;
  const inputCls =
    'bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all duration-150';

  return (
    <div className="h-dvh w-screen flex flex-col overflow-hidden bg-slate-50">
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm">
        <button onClick={() => navigate('/operations-hub')} className={btnOutline}>
          {Icon.back} Back
        </button>

        <h1 className="text-base sm:text-lg font-extrabold tracking-wide text-slate-800">
          {title}
        </h1>

        <div className="flex gap-2">
          <button
            onClick={() =>
              setShowFilters((prev) => {
                const next = !prev;
                localStorage.setItem(filterStorageKey, next.toString());
                return next;
              })
            }
            className={btnOutline}
            title={showFilters ? 'Hide filters' : 'Show filters'}
          >
            {Icon.filter} Filter
          </button>
          <button
            onClick={() => loadValidationData(true)}
            disabled={loading}
            className={btnPrimary}
          >
            <span className={loading ? 'animate-spin' : ''}>{Icon.refresh}</span>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="flex-shrink-0 px-4 py-3 space-y-2.5 bg-white border-b border-slate-200">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              {Icon.search}
            </span>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Search by machine, status, employee, job..."
              className={`w-full pl-9 pr-9 py-2 ${inputCls}`}
            />
            {filters.search && (
              <button
                onClick={() => setFilters((prev) => ({ ...prev, search: '' }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {Icon.x}
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="date"
              value={filters.start}
              onChange={(e) => setFilters((prev) => ({ ...prev, start: e.target.value }))}
              className={`px-2.5 py-1.5 ${inputCls}`}
            />
            <span className="text-slate-400 text-xs">to</span>
            <input
              type="date"
              value={filters.end}
              onChange={(e) => setFilters((prev) => ({ ...prev, end: e.target.value }))}
              className={`px-2.5 py-1.5 ${inputCls}`}
            />
            <input
              value={filters.machineno}
              onChange={(e) => setFilters((prev) => ({ ...prev, machineno: e.target.value }))}
              placeholder="Machine No"
              className={`w-32 px-2.5 py-1.5 ${inputCls}`}
            />
            <input
              value={filters.statusid}
              onChange={(e) => setFilters((prev) => ({ ...prev, statusid: e.target.value }))}
              placeholder="Status ID"
              className={`w-28 px-2.5 py-1.5 ${inputCls}`}
            />
            <input
              value={filters.employee}
              onChange={(e) => setFilters((prev) => ({ ...prev, employee: e.target.value }))}
              placeholder="Employee / SN"
              className={`w-36 px-2.5 py-1.5 ${inputCls}`}
            />
            <input
              value={filters.confirmation_no}
              onChange={(e) => setFilters((prev) => ({ ...prev, confirmation_no: e.target.value }))}
              placeholder="Confirmation / Order"
              className={`w-44 px-2.5 py-1.5 ${inputCls}`}
            />

            <div className="flex-1" />

            <button onClick={clearFilters} className={btnOutline}>
              Clear
            </button>
            <button
              onClick={() =>
                setPostToSapEnabled((prev) => {
                  const next = !prev;
                  localStorage.setItem(postSapStorageKey, next);
                  return next;
                })
              }
              title={
                postToSapEnabled
                  ? 'Post ke SAP aktif - klik untuk nonaktifkan'
                  : 'Post ke SAP nonaktif - klik untuk aktifkan'
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-150 active:scale-95
                ${
                  postToSapEnabled
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 border-slate-300 text-slate-500 hover:bg-slate-200'
                }`}
            >
              <span
                className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border transition-colors duration-200
                ${postToSapEnabled ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-300 border-slate-300'}`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200
                  ${postToSapEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                />
              </span>
              SAP
            </button>
            <button onClick={expandAll} className={btnOutline}>
              Expand All
            </button>
            <button onClick={collapseAll} className={btnOutline}>
              Collapse All
            </button>
            <button
              onClick={handleDownloadCsv}
              className={`${btnSolid} bg-emerald-600 hover:bg-emerald-500`}
            >
              {Icon.download}&nbsp;Download Excel
            </button>
          </div>
        </div>
      )}

      <div className="flex-shrink-0 px-4 py-2.5 bg-white border-b border-slate-200">
        <div className="grid grid-cols-5 gap-2">
          <StatCard
            icon={Icon.pending}
            label="Pending"
            primary={`${fmtNumber(adjustedStats.totalPending)} Act`}
            secondary={`${fmtHours(adjustedStats.totalHours, 1)} hrs`}
            accentColor="#d97706"
            bgColor="#fffbeb"
            borderColor="#fde68a"
          />
          <StatCard
            icon={Icon.validated}
            label="Validated"
            primary={`${fmtNumber(adjustedStats.totalValidated)} Act`}
            secondary="local status"
            accentColor="#059669"
            bgColor="#f0fdf4"
            borderColor="#bbf7d0"
          />
          <StatCard
            icon={Icon.clock}
            label="Total Hrs"
            primary={fmtHours(adjustedStats.totalHours, 2)}
            accentColor={PALETTE.brightTealBlue}
            bgColor={PALETTE.lightCyan}
            borderColor={PALETTE.frostedBlue}
          />
          <StatCard
            icon={Icon.file}
            label="Records"
            primary={fmtNumber(adjustedStats.totalRecords)}
            secondary={`${fmtNumber(adjustedStats.totalEvents)} events`}
            accentColor={PALETTE.frenchBlue}
            bgColor="#eef2ff"
            borderColor="#c7d2fe"
          />
          <StatCard
            icon={<Clock className="w-5 h-5" />}
            label="Machines"
            primary={fmtNumber(adjustedStats.totalMachines)}
            secondary={`${fmtNumber(adjustedStats.totalOpenEvents)} open`}
            accentColor={PALETTE.blueGreen}
            bgColor={PALETTE.frostedBlue2}
            borderColor={PALETTE.frostedBlue}
          />
        </div>
      </div>

      {sapStatus && sapBannerStyle && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-2 text-sm border-b"
          style={{
            background: sapBannerStyle.bg,
            borderColor: sapBannerStyle.border,
            color: sapBannerStyle.text,
          }}
        >
          <div className="flex items-center gap-2 font-medium">
            {sapStatus.posting ? (
              <>
                <span
                  className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: sapBannerStyle.text, borderTopColor: 'transparent' }}
                />
                Preparing SAP payload...
              </>
            ) : (
              `SAP payload: ${sapStatus.successCount} ready`
            )}
          </div>
          {!sapStatus.posting && (
            <button
              onClick={() => setSapStatus(null)}
              className="text-xs px-2 py-0.5 rounded hover:bg-black/10 transition-colors"
            >
              x
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 px-4 py-2 text-sm font-semibold border-b border-red-200 bg-red-50 text-red-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 bg-slate-50">
        {loading ? (
          <div className="flex flex-col items-center justify-center mt-16 gap-3">
            <div
              className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: PALETTE.turquoiseSurf, borderTopColor: 'transparent' }}
            />
            <span className="text-sm font-medium text-slate-500">Loading data...</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-16 gap-2 text-slate-400">
            <FileText className="w-12 h-12 opacity-30" />
            <p className="text-sm">{emptyMessage}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const groupCache = groupRecords[group.machineno];
              return (
                <MachineGroup
                  key={group.machineno}
                  group={group}
                  isExpanded={expandedGroups.has(group.machineno)}
                  records={groupCache?.records || []}
                  loadingRecords={groupCache?.loading || false}
                  submittedKeys={submittedKeys}
                  sapPendingKeys={sapPendingKeys}
                  onToggle={toggleGroup}
                  onValidateSingle={handleValidateSingle}
                  onValidateGroup={handleValidateGroup}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MachineHoursValidationPage;
