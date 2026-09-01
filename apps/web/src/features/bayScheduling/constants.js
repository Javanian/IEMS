
import { areaDef, bayCodesOf as bayCodesOfRaw } from '../../config/manufacturingAreas';

export const bayCodesOf = bayCodesOfRaw;

export { areaRangeLabel } from '../../config/manufacturingAreas';

export function buildAreaReservations(schedulesByBay, area) {
  const seen = new Map();
  for (const code of bayCodesOf(area.areaCode)) {
    for (const row of schedulesByBay?.get(code) || []) {
      if (row.status === 'CANCELLED') continue;
      if (!seen.has(row.schedule_id)) seen.set(row.schedule_id, row);
    }
  }
  return [...seen.values()].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
}

export function groupAreaOrders(reservations) {
  const map = new Map();
  for (const r of reservations || []) {
    const key = String(r.order_no || r.purpose || r.schedule_id || '');
    if (!key) continue;
    const ex = map.get(key);
    if (ex) {
      ex.count += 1;
      if (String(r.start_date) < ex.start_date) ex.start_date = String(r.start_date);
      if (String(r.end_date) > ex.end_date) ex.end_date = String(r.end_date);
    } else {
      map.set(key, {
        key,
        order_no: r.order_no || null,
        purpose: r.purpose || null,
        project_name: r.project_name || r.part_name || null,
        count: 1,
        start_date: String(r.start_date),
        end_date: String(r.end_date),
      });
    }
  }
  return [...map.values()].sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export {
  BAY_ZONES, ZONE_BY_KEY, bayCode, bayLabel, splitBayCode, zoneOrderFor, isZonedArea,
} from '../../config/manufacturingAreas';

const areaItem = (code, label) => ({ type: 'area', ...areaDef(code), label });

export const WAREHOUSE_BAYS = ['B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1'];

export const LANE_A = [
  areaItem('AREA-01', 'top'),
  areaItem('AREA-02', 'top'),
  { type: 'road', code: 'A31', label: 'top' },
  areaItem('AREA-03', 'top'),
  areaItem('AREA-04', 'top'),
  areaItem('AREA-05', 'top'),
  areaItem('AREA-06', 'top'),
  areaItem('AREA-07', 'top'),
  { type: 'road', code: 'A10', label: 'top' },
  areaItem('AREA-08', 'top'),
  areaItem('AREA-09', 'top'),
  areaItem('AREA-10', 'top'),
];

export const LANE_B = [
  areaItem('AREA-11', 'bottom'),
  areaItem('AREA-12', 'bottom'),
  { type: 'road', code: 'B31', label: 'bottom' },
  areaItem('AREA-13', 'bottom'),
  areaItem('AREA-14', 'bottom'),
  areaItem('AREA-15', 'bottom'),
  { type: 'road', code: 'B18', label: 'bottom' },
  areaItem('AREA-16', 'bottom'),
  areaItem('AREA-17', 'bottom'),
  { type: 'road', code: 'B9', label: 'bottom' },
  { type: 'warehouse', bays: WAREHOUSE_BAYS },
];

export const BLASTING_AREA = { type: 'area', ...areaDef('AREA-18'), label: 'top' };

export const ALL_AREAS = [...LANE_A, ...LANE_B, BLASTING_AREA].filter((item) => item.type === 'area');

export const AREA_BY_CODE = ALL_AREAS.reduce((acc, area) => {
  acc[area.areaCode] = area;
  return acc;
}, {});

export const RESERVATION_STATUS = {
  RESERVED: { label: 'Reserved', bar: '#f59e0b', pill: 'bg-amber-100 text-amber-700 border-amber-200' },
  CONFIRMED: { label: 'Confirmed', bar: '#10b981', pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  DONE: { label: 'Done', bar: '#94a3b8', pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  CANCELLED: { label: 'Cancelled', bar: '#ef4444', pill: 'bg-red-100 text-red-700 border-red-200' },
};

export function statusStyle(status) {
  return RESERVATION_STATUS[String(status || '').toUpperCase()] || RESERVATION_STATUS.RESERVED;
}

export const BOOKING_TYPES = {
  ORDER: {
    code: 'ORDER',
    label: 'Job order',
    isJob: true,
    requiresPurpose: false,
    pill: 'bg-[#caf0f8] text-[#0077b6] border-[#90e0ef]',
  },
  PARKING: {
    code: 'PARKING',
    label: 'Parking',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  STORAGE: {
    code: 'STORAGE',
    label: 'Storage',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  MAINTENANCE: {
    code: 'MAINTENANCE',
    label: 'Maintenance',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  OTHER: {
    code: 'OTHER',
    label: 'Other',
    isJob: false,
    requiresPurpose: true,
    pill: 'bg-slate-100 text-slate-700 border-slate-300',
  },
};

export const NONJOB_BOOKING_TYPES = Object.values(BOOKING_TYPES).filter((type) => !type.isJob);

export function bookingTypeOf(schedule) {
  const code = String(schedule?.booking_type || 'ORDER').toUpperCase();
  return BOOKING_TYPES[code] || BOOKING_TYPES.OTHER;
}

export function isNonJob(schedule) {
  return !bookingTypeOf(schedule).isJob;
}

const pad2 = (value) => String(value).padStart(2, '0');

export function dateKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

function parseDateText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey(value));
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function addDaysText(dateText, days) {
  const base = parseDateText(dateText);
  if (!base) return dateKey(dateText);
  const shifted = new Date(Date.UTC(base.y, base.m - 1, base.d) + Number(days || 0) * 86400000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function weekEndText(dateText) {
  const text = dateKey(dateText) || todayText();
  const base = parseDateText(text);
  if (!base) return text;
  const weekday = new Date(Date.UTC(base.y, base.m - 1, base.d)).getUTCDay();
  return addDaysText(text, (7 - weekday) % 7);
}

export function plural(count, singular, pluralForm) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : pluralForm || `${singular}s`}`;
}

export function formatDate(value) {
  if (!value) return '-';
  const text = dateKey(value);
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function formatHours(value) {
  if (value == null || value === '') return '-';
  const hours = Number(value);
  if (!Number.isFinite(hours)) return '-';
  return `${hours.toLocaleString('en-GB', { maximumFractionDigits: 2 })}h`;
}

export function isActiveOn(schedule, dateText) {
  if (!schedule) return false;
  const cursor = dateKey(dateText);
  if (!cursor) return true;
  const start = dateKey(schedule.start_date);
  const end = dateKey(schedule.end_date);
  if (!start && !end) return true;
  const from = start || end;
  const to = end || start;
  return from <= cursor && cursor <= to;
}

export function groupKeyOf(schedule) {
  if (!schedule) return '';
  if (schedule.schedule_group_id) return `grp:${schedule.schedule_group_id}`;
  const bays = Array.isArray(schedule.bay_codes)
    ? [...schedule.bay_codes].sort().join('|')
    : String(schedule.bay_codes || '');
  return ['legacy', schedule.order_no ?? '', dateKey(schedule.start_date), dateKey(schedule.end_date), bays].join('__');
}

const RESERVATION_FIELDS = [
  'schedule_group_id', 'booking_type', 'purpose', 'order_no', 'project_id', 'project_name',
  'area_code', 'area_name', 'bay_codes', 'start_date', 'end_date', 'status', 'notes',
  'created_by', 'created_by_name', 'updated_by', 'updated_by_name',
  'created_at', 'updated_at', 'part_name', 'customer',
  'order_known', 'is_subcont',
];

function peopleKeyOf(task) {
  const op = task.operation_no;
  return op != null && op !== '' ? `op:${op}` : `task:${task.task_id}`;
}

export function dedupeByGroup(schedules) {
  const byKey = new Map();

  (schedules || []).forEach((row) => {
    if (!row) return;
    const key = groupKeyOf(row);
    let entry = byKey.get(key);

    if (!entry) {
      entry = {
        group_key: key,
        schedule_group_id: row.schedule_group_id || null,
        schedule_ids: [],
        tasks: [],
        task_count: 0,
        people_total: null,
      };
      RESERVATION_FIELDS.forEach((field) => { entry[field] = row[field] ?? null; });
      byKey.set(key, entry);
    } else {
      RESERVATION_FIELDS.forEach((field) => {
        if (entry[field] == null && row[field] != null) entry[field] = row[field];
      });
    }

    if (row.schedule_id) entry.schedule_ids.push(row.schedule_id);
    if (row.task_id) {
      entry.tasks.push({
        schedule_id: row.schedule_id,
        task_id: row.task_id,
        project_id: row.project_id,
        operation_no: row.operation_no,
        task_name: row.task_name,
        workcenter: row.workcenter,
        planhours: row.planhours,
        people_required: row.people_required,
      });
    }
  });

  return [...byKey.values()].map((entry) => {
    const seen = new Set();
    let people = null;
    entry.tasks.forEach((task) => {
      const key = peopleKeyOf(task);
      if (seen.has(key)) return;
      seen.add(key);
      const value = Number(task.people_required);
      if (!Number.isFinite(value)) return;
      people = (people ?? 0) + value;
    });
    entry.task_count = entry.tasks.length;
    entry.people_total = people;
    return entry;
  });
}

export function buildSchedulesByBay(schedules, cursorDate) {
  const grouped = new Map();

  (schedules || []).forEach((row) => {
    if (!row) return;
    if (!isActiveOn(row, cursorDate)) return;
    const bays = Array.isArray(row.bay_codes) ? row.bay_codes : [];
    bays.forEach((bayCode) => {
      if (!bayCode) return;
      const list = grouped.get(bayCode);
      if (list) list.push(row);
      else grouped.set(bayCode, [row]);
    });
  });

  return grouped;
}

export function orderKeyOf(value) {
  const text = String(value ?? '').trim();
  return text.replace(/^0+/, '');
}

function hasText(value) {
  return value != null && String(value).trim() !== '';
}

export function isUnknownOrder(schedule, knownOrderKeys) {
  if (!schedule || isNonJob(schedule)) return false;
  if (typeof schedule.order_known === 'boolean') return !schedule.order_known;
  if (knownOrderKeys && typeof knownOrderKeys.has === 'function') {
    const key = orderKeyOf(schedule.order_no);
    if (!key) return false;
    return !knownOrderKeys.has(key);
  }
  if (!schedule.order_no) return false;
  return !hasText(schedule.part_name) && !hasText(schedule.customer);
}

const AREA_DOTS = ['#90e0ef', '#48cae4', '#00b4d8'];

export function areaDot(code) {
  const text = String(code || '');
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum += text.charCodeAt(i);
  return AREA_DOTS[sum % AREA_DOTS.length];
}
