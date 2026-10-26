import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stockHash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
export const stockHashless = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contentHash'));
export const stockSemantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['eventId', 'authorityHash', 'useFence'].includes(key)));
export const stockUnits = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) stockInvalid(); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
export const stockDecimal = value => { const text = value.toString().padStart(7, '0'); return `${text.slice(0, -6)}.${text.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
export const stockInvalid = () => { throw Object.assign(new Error('CATALOG_STOCK_SOURCE_INVALID'), { status: 409, code: 'CATALOG_STOCK_SOURCE_INVALID' }); };
