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
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.details = payload.details;
    throw error;
  }

  return response.json();
}

export async function fetchMachineTracking() {
  const payload = await request('/component-tracking/machines');
  return payload.data || [];
}

export async function fetchMachineDetail(machineId) {
  return request(`/component-tracking/machines/${encodeURIComponent(machineId)}`);
}

export async function fetchSowOperations(
  search = '',
  { page = 1, limit = 20, withMeta = false } = {}
) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  const query = params.toString();
  const payload = await request(`/component-tracking/sow-operations${query ? `?${query}` : ''}`);
  return withMeta ? payload : payload.data || [];
}

export async function fetchBufferTransactions(machineId = '', { history = false } = {}) {
  const params = new URLSearchParams();
  if (machineId) params.set('machineId', machineId);
  if (history) params.set('history', 'true');
  const query = params.toString();
  const payload = await request(`/component-tracking/buffers${query ? `?${query}` : ''}`);
  return payload.data || [];
}

export async function setBufferTransaction(payload) {
  const response = await request('/component-tracking/buffers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateBufferPriorities(updates) {
  const response = await request('/component-tracking/buffers/priorities', {
    method: 'PATCH',
    body: JSON.stringify({ updates }),
  });
  return response.data || [];
}

export async function updateBufferNote(id, note) {
  const response = await request(`/component-tracking/buffers/${encodeURIComponent(id)}/note`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  return response.data;
}

export async function fetchBufferHistory(orderNo, operationNo) {
  const params = new URLSearchParams({ orderNo: orderNo || '' });
  if (operationNo) params.set('operationNo', String(operationNo));
  const payload = await request(`/component-tracking/buffer-history?${params.toString()}`);
  return payload.data || [];
}

export default {
  fetchMachineTracking,
  fetchMachineDetail,
  fetchSowOperations,
  fetchBufferTransactions,
  setBufferTransaction,
  updateBufferPriorities,
  updateBufferNote,
  fetchBufferHistory,
};
