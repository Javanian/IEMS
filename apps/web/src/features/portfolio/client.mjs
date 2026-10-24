const defaultBase = import.meta.env?.VITE_PORTFOLIO_API_BASE || '/portfolio-api';
export async function portfolioRequest(path, { body, base = defaultBase, signal, headers: extra = {} } = {}) {
  let response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
      headers: { ...(body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) { if (cause.name === 'AbortError') throw cause; throw Object.assign(new Error('Connection unavailable'), { status: 0 }); }
  let envelope;
  try { envelope = await response.json(); } catch { throw Object.assign(new Error('Invalid API response'), { status: response.status }); }
  if (!response.ok) { const e = envelope?.error && typeof envelope.error === 'object' ? envelope.error : envelope || {}; throw Object.assign(new Error(e.message || 'Request failed'), { status: response.status, code: e.code, ...(e.currentVersion === undefined ? {} : { currentVersion: e.currentVersion }) }); }
  return envelope;
}
export function errorMessage(error, mutation = false) {
  if (error.status === 401) return 'Your session expired or is unavailable. Sign in again.';
  if (error.status === 403) return 'Access denied. You do not have permission for this action or origin.';
  if (error.status === 409) return 'This record changed or its stage is closed. Refresh the record, review its history, then retry with the current version.';
  if (error.status === 404) return 'Record not found in your current plant. Return to the list or refresh.';
  if (mutation && (!error.status || error.status >= 500)) return 'The result could not be confirmed. Refresh and check the records before submitting again to avoid a duplicate.';
  return `${error.message || 'Connection unavailable'}. ${mutation ? 'Review the form and submit again.' : 'Retry to load the latest records.'}`;
}
export function displayMoney(amount) {
  const [integer, fraction] = amount.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
}
export function validMoney(amount, currency) {
  const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
  const scale = scales[currency];
  return scale !== undefined && typeof amount === 'string' && new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(amount);
}
