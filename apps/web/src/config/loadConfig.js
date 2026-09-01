const API_BASE = import.meta.env.VITE_API_URL || '/api';
const LS_KEY = 'plant_config';

let current = null;

export function getConfig() {
  return current;
}

export async function loadConfig() {
  try {
    const res = await fetch(`${API_BASE}/config`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    current = data;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {}
    return current;
  } catch {
    const cachedRaw = (() => {
      try {
        return localStorage.getItem(LS_KEY);
      } catch {
        return null;
      }
    })();
    if (cachedRaw) {
      try {
        current = JSON.parse(cachedRaw);
        console.warn('[loadConfig] pakai cache localStorage (offline/backend tak tersedia)');
        return current;
      } catch {}
    }
    throw new Error('Konfigurasi plant tak tersedia — cek koneksi ke server');
  }
}
