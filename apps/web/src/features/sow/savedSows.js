const API_BASE = import.meta.env.VITE_API_URL || '/api';

function readUserName() {
  try {
    const u = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    return (u && (u.name || u.username)) || '';
  } catch {
    return '';
  }
}

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-user-name': readUserName(),
      ...(options?.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

export const listSavedSows = (q) => request(`/sow/saved${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const getSavedSow = (id) => request(`/sow/saved/${id}`);
export const createSavedSow = (body) =>
  request('/sow/saved', { method: 'POST', body: JSON.stringify(body) });
export const updateSavedSow = (id, patch) =>
  request(`/sow/saved/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
export const deleteSavedSow = (id) =>
  fetch(`${API_BASE}/sow/saved/${id}`, {
    method: 'DELETE',
    headers: { 'x-user-name': readUserName() },
  });
