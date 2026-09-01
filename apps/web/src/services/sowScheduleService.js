const API_BASE = import.meta.env.VITE_API_URL || '';

function apiUrl(path) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function authHeaders() {
  const user = readAuthUser();
  if (!user) return {};
  return {
    'x-user-id': user.id ? String(user.id) : '',
    'x-user-name': user.name || user.username || '',
    'x-user-role': user.roles || user.role || '',
  };
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function fetchShifts(params = {}) {
  const payload = await request(`/sow-schedule/shifts${queryString(params)}`);
  return payload.data || [];
}

export async function fetchOrderProgress(params = {}) {
  return request(`/sow-schedule/order-progress${queryString(params)}`);
}

export async function fetchOrderOperations(params = {}) {
  return request(`/sow-schedule/order-operations${queryString(params)}`);
}

export async function markOperationStatus(payload) {
  return request('/sow-schedule/operation-status', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function clearOperationStatus(id) {
  return request(`/sow-schedule/operation-status/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchShiftRules(params = {}) {
  const payload = await request(`/sow-schedule/shift-rules${queryString(params)}`);
  return payload.data || [];
}

export async function createShiftRule(payload) {
  const response = await request('/sow-schedule/shift-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateShiftRule(id, payload) {
  const response = await request(`/sow-schedule/shift-rules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteShiftRule(id) {
  return request(`/sow-schedule/shift-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchSchedulingMachines() {
  const payload = await request('/sow-schedule/machines');
  return payload.data || [];
}

export async function fetchSchedulingActivities(params = {}) {
  return request(`/sow-schedule/sow-activities${queryString(params)}`);
}

export async function fetchSchedules(params = {}) {
  return request(`/sow-schedule${queryString(params)}`);
}

export async function fetchManpower() {
  const payload = await request('/sow-schedule/manpower');
  return payload.data || [];
}

export async function fetchBatches(params = {}) {
  const payload = await request(`/sow-schedule/batches${queryString(params)}`);
  return payload.data || [];
}

export async function createBatch(payload) {
  const response = await request('/sow-schedule/batches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteBatch(id) {
  return request(`/sow-schedule/batches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createSchedule(payload) {
  const response = await request('/sow-schedule', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response;
}

export async function updateSchedule(id, payload) {
  const response = await request(`/sow-schedule/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteSchedule(id) {
  return request(`/sow-schedule/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function rescheduleSchedule(id, payload) {
  const response = await request(`/sow-schedule/${encodeURIComponent(id)}/reschedule`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function reorderSchedule(id, direction) {
  return request(`/sow-schedule/${encodeURIComponent(id)}/reorder`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

export async function fetchCapacity(params = {}) {
  const payload = await request(`/sow-schedule/capacity${queryString(params)}`);
  return payload.data || [];
}

export async function saveCapacity(payload) {
  const response = await request('/sow-schedule/capacity', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function fetchOvertime(params = {}) {
  const payload = await request(`/sow-schedule/overtime${queryString(params)}`);
  return payload.data || [];
}

export async function createOvertime(payload) {
  const response = await request('/sow-schedule/overtime', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteOvertime(id) {
  return request(`/sow-schedule/overtime/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function approveOvertime(id) {
  const response = await request(`/sow-schedule/overtime/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ currentUser: readAuthUser() }),
  });
  return response.data;
}

export async function rejectOvertime(id, rejectionNote = '') {
  return request(`/sow-schedule/overtime/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejection_note: rejectionNote }),
  });
}

export async function assignManpower(overtimeId, snssb, fullName) {
  return request(`/sow-schedule/overtime/${encodeURIComponent(overtimeId)}/assign`, {
    method: 'POST',
    body: JSON.stringify({ assigned_to: snssb, assigned_to_name: fullName }),
  });
}

export async function fetchCapacityReport(params = {}) {
  return request(`/sow-schedule/report/capacity${queryString(params)}`);
}

export async function fetchPlanVsActualReport(params = {}) {
  return request(`/sow-schedule/report/plan-vs-actual${queryString(params)}`);
}

export async function fetchQueueReport(params = {}) {
  return request(`/sow-schedule/report/planned-queue-vs-actual-queue${queryString(params)}`);
}

export async function fetchOvertimeSummary(params = {}) {
  return request(`/sow-schedule/report/overtime-summary${queryString(params)}`);
}

export default {
  fetchShifts,
  fetchShiftRules,
  createShiftRule,
  updateShiftRule,
  deleteShiftRule,
  fetchSchedulingMachines,
  fetchSchedulingActivities,
  fetchSchedules,
  fetchBatches,
  createBatch,
  deleteBatch,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  rescheduleSchedule,
  reorderSchedule,
  fetchCapacity,
  saveCapacity,
  fetchOvertime,
  createOvertime,
  deleteOvertime,
  approveOvertime,
  rejectOvertime,
  fetchCapacityReport,
  fetchPlanVsActualReport,
  fetchQueueReport,
  fetchOvertimeSummary,
};
