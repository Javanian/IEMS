export const operationsRoot = '/api/operations';
export const workforceRoot = '/api/workforce';
export const voiceRoot = '/api/operations/voice';
export const showValue = (value, unit) => value === null || value === undefined ? 'No data' : `${value}${unit ? ` ${unit}` : ''}`;
export const showTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { timeZone: 'UTC' }) + ' UTC' : 'Not recorded';
