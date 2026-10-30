import { createProviderBindingSource } from './provider-binding-source.mjs';
import { createDurableProviderPolicy, initializeProviderAuthority } from './provider-authority.mjs';
import { initializeProviderCommands } from './provider-commands.mjs';
import { createProviderSessionRegistry, initializeProviderSessions } from './provider-session.mjs';
import { createProviderReconciler, initializeProviderReconciliation } from './provider-reconciliation.mjs';
import { createProviderCallbackHandler } from './provider-http.mjs';
import { createScopedProviderOperatorHandler } from './provider-operator-http.mjs';
import { createLocalBrowserLifecycle } from './local-browser-driver.mjs';

export function createLocalProviderRuntime({ db, transaction, foundation, tenantId, plantId, accountId,
  partyDirectory, verifiedMethods, authenticate, callbackSecret, browser, externalSendEnabled = false, now = () => Date.now() }) {
  if (externalSendEnabled !== false || typeof transaction !== 'function' || typeof authenticate !== 'function'
    || !browser || typeof browser !== 'object') throw new Error('INVALID_LOCAL_PROVIDER_RUNTIME');
  const verifyBindingSource = createProviderBindingSource({ db, partyDirectory, tenantId, plantId, accountId, verifiedMethods, now });
  const authorizeRegistration = createDurableProviderPolicy({ db, tenantId, accountId, verifyBindingSource, now });
  const registry = createProviderSessionRegistry({ db, transaction, tenantId, accountId, authorizeRegistration });
  const lifecycle = createLocalBrowserLifecycle({ registry, tenantId, accountId, ownerId: browser.ownerId,
    executablePath: browser.executablePath, scratchRoot: browser.scratchRoot, timeoutMs: browser.timeoutMs });
  const operator = createScopedProviderOperatorHandler({ db, transaction, foundation, tenantId, plantId, accountId,
    verifyBindingSource, authenticate, now });
  const callback = createProviderCallbackHandler(createProviderReconciler({ db, transaction, tenantId, accountId, secret: callbackSecret, now }));
  let initialized = false;
  const ready = () => { if (!initialized) throw new Error('LOCAL_PROVIDER_NOT_INITIALIZED'); };
  const guard = handler => async (req, res) => {
    if (!initialized) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'LOCAL_PROVIDER_NOT_INITIALIZED' }));
      return;
    }
    return handler(req, res);
  };
  return Object.freeze({
    async initialize() {
      await initializeProviderAuthority(db);
      await initializeProviderCommands(db);
      await initializeProviderSessions(db);
      await initializeProviderReconciliation(db);
      initialized = true;
    },
    operatorHandler: guard(operator), callbackHandler: guard(callback),
    start() { ready(); return lifecycle.start(); },
    stop() { ready(); return lifecycle.stop(); },
    status: () => Object.freeze({ initialized, mode: 'LOCAL_BLANK_BROWSER', tenantId, plantId, accountId,
      externalSendEnabled: false, lifecycle: lifecycle.status() }),
  });
}
