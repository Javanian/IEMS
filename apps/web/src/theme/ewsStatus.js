export const STATUS_TOKENS = {
  normal: { bg: '#ECFDF5', text: '#047857', solid: '#059669', border: '#A7F3D0' },
  watch: { bg: '#FEF3C7', text: '#B45309', solid: '#F59E0B', border: '#FDE68A' },
  critical: { bg: '#FCEBEB', text: '#A32D2D', solid: '#E24B4A', border: '#F4C9C9' },
  no_data: { bg: '#F1F5F9', text: '#64748B', solid: '#94A3B8', border: '#E2E8F0' },
};

export const BRAND = {
  blue: '#378ADD',
  blueStrong: '#185FA5',
};

export function statusKey(value) {
  const s = String(value || '').toLowerCase();
  if (s === 'critical' || s === 'error') return 'critical';
  if (s === 'watch' || s === 'warning' || s === 'stale') return 'watch';
  if (s === 'normal' || s === 'fresh' || s === 'live' || s === 'closed') return 'normal';
  return 'no_data';
}

export function statusToken(value) {
  return STATUS_TOKENS[statusKey(value)] || STATUS_TOKENS.no_data;
}

export function badgeStyle(value) {
  const t = statusToken(value);
  return { backgroundColor: t.bg, color: t.text, borderColor: t.border };
}

export function dotStyle(value) {
  const t = statusToken(value);
  return { backgroundColor: t.text };
}

export function solidColor(value) {
  return statusToken(value).solid;
}
