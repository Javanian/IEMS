export const currencyScales = Object.freeze({ USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 });
export function minorUnits(value, currency, { zero = false } = {}) {
  const scale = currencyScales[currency];
  if (scale === undefined || typeof value !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(value)) throw new TypeError('INVALID_MONEY');
  const result = BigInt(value.replace('.', ''));
  if (!zero && result === 0n) throw new TypeError('INVALID_MONEY');
  return result;
}
export function formatMinor(value, currency) {
  const scale = currencyScales[currency];
  if (scale === undefined || value < 0n) throw new TypeError('INVALID_MONEY');
  const digits = value.toString().padStart(scale + 1, '0');
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}
export function agingBucket(dueAt, at) {
  if (!dueAt) return 'UNDATED';
  const due = new Date(dueAt).getTime(), now = new Date(at).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(now)) throw new TypeError('INVALID_DATE');
  if (due >= now) return 'CURRENT';
  const days = Math.ceil((now - due) / 86400000);
  return days <= 30 ? 'DAYS_1_30' : days <= 60 ? 'DAYS_31_60' : days <= 90 ? 'DAYS_61_90' : 'DAYS_91_PLUS';
}
