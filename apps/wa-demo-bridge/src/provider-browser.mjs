import { createProviderLifecycle } from './provider-lifecycle.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const fail = code => { throw new Error(code); };

// Timeout does not cancel a browser operation: ownership must remain reserved.
async function bounded(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('BROWSER_TIMEOUT')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function createProviderBrowserAdapter({ driver, tenantId, accountId, timeoutMs = 30000 }) {
  if (typeof driver?.launch !== 'function' || !id(tenantId) || !id(accountId)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('INVALID_BROWSER_CONFIGURATION');
  let state = 'IDLE';
  let pinned;
  let browser;
  const matches = value => value && value.tenantId === tenantId && value.accountId === accountId
    && id(value.ownerId) && Number.isSafeInteger(value.generation) && value.generation > 0;
  return Object.freeze({
    status() {
      return Object.freeze({ state, tenantId, accountId, ownerId: pinned?.ownerId ?? null,
        generation: pinned?.generation ?? null, externalSendEnabled: false });
    },
    async open(ownership) {
      if (state !== 'IDLE' && state !== 'CLOSED') fail('BROWSER_BUSY');
      if (!matches(ownership)) fail('BROWSER_SCOPE_MISMATCH');
      pinned = Object.freeze({ tenantId, accountId, ownerId: ownership.ownerId, generation: ownership.generation });
      state = 'OPENING';
      try {
        browser = await bounded(() => driver.launch(Object.freeze({ ...pinned, externalSendEnabled: false })), timeoutMs);
        if (typeof browser?.close !== 'function') fail('INVALID_BROWSER_HANDLE');
        state = 'OPEN';
      } catch { state = 'UNKNOWN'; fail('BROWSER_OPEN_REQUIRES_RECONCILIATION'); }
    },
    async close(ownership) {
      if (state !== 'OPEN') fail('BROWSER_NOT_OPEN');
      if (!matches(ownership) || ownership.ownerId !== pinned.ownerId || ownership.generation !== pinned.generation) fail('BROWSER_SCOPE_MISMATCH');
      state = 'CLOSING';
      try {
        const result = await bounded(() => browser.close(), timeoutMs);
        if (result?.closed !== true) fail('BROWSER_CLOSE_UNCONFIRMED');
        browser = undefined;
        state = 'CLOSED';
        return Object.freeze({ closed: true });
      } catch { state = 'UNKNOWN'; fail('BROWSER_CLOSE_REQUIRES_RECONCILIATION'); }
    },
  });
}

export function createProviderBrowserLifecycle({ registry, ownerId, driver, tenantId, accountId, timeoutMs }) {
  return createProviderLifecycle({ registry, ownerId,
    adapter: createProviderBrowserAdapter({ driver, tenantId, accountId, timeoutMs }) });
}
