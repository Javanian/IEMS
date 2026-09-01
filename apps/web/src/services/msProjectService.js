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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || payload.error || `Request failed: ${response.status}`
    );
    error.code = payload.code || null;
    error.status = response.status;
    error.details = Array.isArray(payload.details) ? payload.details : [];
    throw error;
  }

  return payload;
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function fetchMsProjects(params = {}) {
  const payload = await request(`/ms-project/projects${queryString(params)}`);
  return payload.data || [];
}

export async function fetchMsProjectTasks(projectId, params = {}) {
  const payload = await request(
    `/ms-project/projects/${encodeURIComponent(projectId)}/tasks${queryString(params)}`
  );
  return payload.data || [];
}

export async function updateMsProject(projectId, payload) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateMsProjectTask(projectId, taskId, payload) {
  const response = await request(
    `/ms-project/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PUT', body: JSON.stringify(payload) }
  );
  return response.data;
}

export async function deleteMsProject(projectId, options = {}) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ force: !!options.force }),
  });
  return response.data;
}

export async function fetchSowOrdersPage(params = {}, options = {}) {
  const payload = await request(`/ms-project/sow-orders${queryString(params)}`, options);
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const summary = payload.summary || {};
  const asNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    rows,

    total: asNumber(summary.total, rows.length),
    limit: asNumber(summary.limit, rows.length),
    offset: asNumber(summary.offset, 0),
  };
}

export async function fetchSowOrders(params = {}, options = {}) {
  const page = await fetchSowOrdersPage(params, options);
  return page.rows;
}

export async function fetchSowOrderOperations(orderNo) {
  const payload = await request(`/ms-project/sow-orders/${encodeURIComponent(orderNo)}/operations`);
  return payload.data || [];
}

export async function fetchOrderTasks(orderNo) {
  const payload = await request(`/ms-project/sow-orders/${encodeURIComponent(orderNo)}/tasks`);
  return payload.data || [];
}

export async function mapSowOperationToTask(projectId, payload) {
  const response = await request(
    `/ms-project/projects/${encodeURIComponent(projectId)}/tasks/map-operation`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateOperationPeople(orderNo, updates) {
  const response = await request(
    `/ms-project/sow-orders/${encodeURIComponent(orderNo)}/operations/people`,
    {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    }
  );
  return response.data;
}

export async function fetchBaySchedules(params = {}, options = {}) {
  const payload = await request(`/ms-project/bay-schedules${queryString(params)}`, options);
  return payload.data || [];
}

export async function fetchBayOccupants(params = {}) {
  const { bay_codes: bayCodes, ...rest } = params;
  const query = {
    ...rest,
    bay_codes: Array.isArray(bayCodes) ? bayCodes.join(',') : bayCodes,
  };
  const payload = await request(`/ms-project/bay-schedules/occupants${queryString(query)}`);
  const data = payload.data;

  if (Array.isArray(data)) return { rows: data, truncated: false, total: data.length };
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const total = Number(data?.total);
  return {
    rows,
    truncated: Boolean(data?.truncated),
    total: Number.isFinite(total) ? total : rows.length,
  };
}

export async function createBaySchedule(payload) {
  const response = await request('/ms-project/bay-schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    ...(response.data || {}),
    warnings: Array.isArray(response.warnings) ? response.warnings : [],
  };
}

export async function cancelBaySchedule(scheduleId) {
  const response = await request(`/ms-project/bay-schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
  });
  return response.data;
}

export async function updateBayScheduleGroup(groupId, payload) {
  const response = await request(`/ms-project/bay-schedules/group/${encodeURIComponent(groupId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return {
    ...(response.data || {}),
    warnings: Array.isArray(response.warnings) ? response.warnings : [],
  };
}

export async function cancelBayScheduleGroup(groupId) {
  const response = await request(`/ms-project/bay-schedules/group/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
  return response.data;
}

export async function forceCheckinProject(projectId, payload = {}) {
  const response = await request(
    `/ms-project/projects/${encodeURIComponent(projectId)}/force-checkin`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export function msProjectFileUrl(projectId) {
  return apiUrl(`/ms-project/projects/${encodeURIComponent(projectId)}/file`);
}

export async function fetchMsProjectRevisions(projectId, params = {}) {
  const payload = await request(
    `/ms-project/projects/${encodeURIComponent(projectId)}/revisions${queryString(params)}`
  );
  return payload.data || [];
}

export async function updateMsProjectStatus(projectId, status, actor) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, actor }),
  });
  return response.data;
}

export default {
  cancelBaySchedule,
  cancelBayScheduleGroup,
  createBaySchedule,
  fetchBayOccupants,
  fetchBaySchedules,
  fetchMsProjectRevisions,
  fetchMsProjects,
  fetchMsProjectTasks,
  fetchOrderTasks,
  fetchSowOrders,
  fetchSowOrdersPage,
  fetchSowOrderOperations,
  forceCheckinProject,
  mapSowOperationToTask,
  msProjectFileUrl,
  updateBayScheduleGroup,
  updateMsProjectStatus,
  updateOperationPeople,
};
