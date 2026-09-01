export const API_BASE = import.meta.env.VITE_API_URL || '';

export const compressImage = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1920;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

export const fmtTs = (ts) => {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return ts || '—';
  }
};

export const authHeaders = () => {
  try {
    const u = JSON.parse(sessionStorage.getItem('authUser') || 'null');
    if (!u) return {};
    return {
      'x-user-id': u.id != null ? String(u.id) : '',
      'x-user-name': u.name || u.username || '',
    };
  } catch {
    return {};
  }
};

export const fmtHours = (h) => {
  const n = Number(h);
  return Number.isFinite(n) ? String(n) : '—';
};

export const fmtWeightPct = (w) => {
  const n = Number(w);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
};

export const computeRollup = (list) => {
  let weighted = 0;
  let total = 0;
  for (const s of list) {
    const h = Number(s.standard_hours) || 0;
    weighted += (Number(s.progress) || 0) * h;
    total += h;
  }
  return total > 0 ? Math.round(weighted / total) : null;
};

export const SUBTASK_STATUS = {
  NOT_STARTED: { label: 'Not Started', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  IN_PROGRESS: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  ON_HOLD: { label: 'On Hold', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  DONE: { label: 'Done', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};
