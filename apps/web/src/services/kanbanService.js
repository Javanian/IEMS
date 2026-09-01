const API_BASE = import.meta.env.VITE_API_URL || '';

function apiUrl(path) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchKanbanBoard({ limit = 1000 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  const payload = await request(`/kanban/board?${params.toString()}`);
  return payload.data || [];
}

export async function fetchKanbanSummary() {
  return request('/kanban/summary');
}

export async function fetchLatestBuffers() {
  const payload = await request('/component-tracking/buffers');
  return payload.data || [];
}

export async function fetchWorkcenters() {
  const payload = await request('/workcenter');
  return Array.isArray(payload) ? payload : [];
}

export async function fetchKanbanCardDetail({ orderNo, operationNo, bufferId } = {}) {
  const params = new URLSearchParams();
  if (orderNo) params.set('orderNo', orderNo);
  if (operationNo !== null && operationNo !== undefined && operationNo !== '') {
    params.set('operationNo', String(operationNo));
  }
  if (bufferId) params.set('bufferId', String(bufferId));

  return request(`/kanban/cards/detail?${params.toString()}`);
}

export async function refreshKanbanBoard() {
  const payload = await request('/kanban/refresh', { method: 'POST' });
  return payload.data || null;
}

export default {
  fetchKanbanBoard,
  fetchKanbanSummary,
  fetchLatestBuffers,
  fetchWorkcenters,
  fetchKanbanCardDetail,
  refreshKanbanBoard,
};
