import { contentHash } from '../tenant-foundation/commands.mjs';

export const SNAPSHOT_TOPIC = 'iems.reporting.snapshots.v2';
export const SNAPSHOT_TYPE = 'reporting.snapshot.v2';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function decimal(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,25})(\.\d{1,12})?$/.test(value)) throw new Error('EXACT_DECIMAL_REQUIRED');
  return value;
}
export function addDecimals(values) {
  const sum = values.reduce((n, v) => { const [a, b = ''] = decimal(v).split('.'); return n + BigInt(a + b.padEnd(12, '0')); }, 0n);
  const raw = sum.toString().padStart(13, '0');
  return decimal(`${raw.slice(0, -12)}.${raw.slice(-12)}`);
}
export function validateSnapshot(p) {
  if (!p || !['order', 'payment', 'fulfillment'].includes(p.resourceType) || !uuid.test(p.resourceId) || !uuid.test(p.legalEntityId) || typeof p.deleted !== 'boolean') throw new Error('INVALID_SNAPSHOT');
  if (p.resourceType !== 'fulfillment') { decimal(p.amount); if (!/^[A-Z]{3}$/.test(p.currency)) throw new Error('CURRENCY_REQUIRED'); }
  const quantities = p.resourceType === 'order' ? p.quantities : p.resourceType === 'fulfillment' ? [p] : [];
  if (!Array.isArray(quantities) || (p.resourceType === 'order' && (!quantities.length || quantities.length > 100))) throw new Error('QUANTITIES_REQUIRED');
  const seen = new Set();
  for (const q of quantities) { decimal(q.quantity); if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(q.uom) || seen.has(q.uom)) throw new Error('INVALID_UOM'); seen.add(q.uom); }
  if (p.resourceType !== 'order' && !uuid.test(p.orderId)) throw new Error('ORDER_ID_REQUIRED');
  return p;
}
export function validateSource(source) {
  if (!source || !['salesOrders', 'fulfillmentKeys', 'fulfillmentPayments', 'fulfillmentShipments'].includes(source.collection) || !uuid.test(source.id) || !['string', 'number'].includes(typeof source.version) || !String(source.version).length || !/^[a-f0-9]{64}$/.test(source.hash) || !Array.isArray(source.eventIds) || !source.eventIds.every(id => uuid.test(id))) throw new Error('INVALID_SOURCE_EVIDENCE');
  if (source.sourceOccurredAt !== null && (typeof source.sourceOccurredAt !== 'string' || !source.sourceOccurredAt.endsWith('Z') || !Number.isFinite(Date.parse(source.sourceOccurredAt)))) throw new Error('INVALID_SOURCE_TIME');
  if ((typeof source.version === 'number' && (!Number.isSafeInteger(source.version) || source.version < 0)) || String(source.version).length > 128 || source.eventIds.length > 100) throw new Error('INVALID_SOURCE_VERSION_OR_EVENT_BOUND');
  return source;
}
export function sourceHash(value) { return contentHash(value); }
