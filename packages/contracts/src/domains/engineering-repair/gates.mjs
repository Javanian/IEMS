import { createHash } from 'node:crypto';

export const resourceTypes = ['REPAIR_CASE', 'WORK_ORDER', 'COMPANY_UNIT', 'RECEIPT', 'EQUIPMENT', 'OPERATOR'];
export const gateId = (type, resourceId) => createHash('sha256').update(`${type}:${resourceId}`).digest('hex');
export const domainError = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
export function utcMinute(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) domainError(400, 'INVALID_UTC_MINUTE');
  return Date.parse(value);
}
export function capacityFor(windows, from, to) {
  const start = utcMinute(from), end = utcMinute(to);
  if (start >= end || end - start > 366 * 86400000) domainError(400, 'INVALID_CAPACITY_INTERVAL');
  const spans = windows.filter(w => w.status !== 'CANCELLED').map(w => [Math.max(start, Date.parse(w.from)), Math.min(end, w.status === 'ACTIVE' ? end : Date.parse(w.actualUntil || w.until))]).filter(([a, b]) => a < b).sort((a, b) => a[0] - b[0]);
  let unavailable = 0, left = null, right = null;
  for (const [a, b] of spans) {
    if (left === null) { left = a; right = b; }
    else if (a <= right) right = Math.max(right, b);
    else { unavailable += right - left; left = a; right = b; }
  }
  if (left !== null) unavailable += right - left;
  const minutes = ms => String(ms / 60000);
  return { from, until: to, uom: 'MIN', totalMinutes: minutes(end - start), unavailableMinutes: minutes(unavailable), availableMinutes: minutes(end - start - unavailable) };
}
