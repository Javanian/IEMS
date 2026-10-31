import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalBrowserDriver, createLocalBrowserLifecycle, browserEndpoint } from '../src/local-browser-driver.mjs';

const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? process.env.PAPERCLIP_SCRATCH_DIR;
const ownership = { tenantId: 'synthetic-tenant', accountId: 'synthetic-account', ownerId: 'local-smoke', generation: 1, externalSendEnabled: false };

test('browser endpoint accepts only generated local browser paths', () => {
  assert.equal(browserEndpoint('12345\n/devtools/browser/abc-123\n'), 'ws://127.0.0.1:12345/devtools/browser/abc-123');
  for (const text of ['0\n/devtools/browser/a', '65536\n/devtools/browser/a', '80\n//external/a', '80\n/devtools/browser/a?query']) assert.throws(() => browserEndpoint(text));
});
test('local browser configuration refuses relative paths and send enablement', async () => {
  assert.throws(() => createLocalBrowserDriver({ executablePath: 'chrome.exe', scratchRoot }), /INVALID_LOCAL_BROWSER_CONFIGURATION/);
  const driver = createLocalBrowserDriver({ executablePath: process.execPath, scratchRoot });
  await assert.rejects(driver.launch({ ...ownership, externalSendEnabled: true }), /INVALID_LOCAL_BROWSER_OWNERSHIP/);
  assert.equal(driver.status().pid, null);
});
test('concrete driver pins a unique profile, strips environment and confirms process exit before close', async () => {
  let child, args, options;
  function spawnProcess(executable, argv, opts) {
    child = new EventEmitter(); child.pid = 1234; args = argv; options = opts;
    const profile = argv.find(a => a.startsWith('--user-data-dir=')).split('=').slice(1).join('=');
    void writeFile(join(profile, 'DevToolsActivePort'), '12345\n/devtools/browser/test');
    return child;
  }
  class Socket extends EventTarget {
    readyState = 1;
    constructor(url) { super(); assert.match(url, /^ws:\/\/127\.0\.0\.1:/); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.method === 'Browser.getVersion') queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: 1, result: { product: 'test' } }) })));
      else { assert.equal(message.method, 'Browser.close'); queueMicrotask(() => child.emit('exit', 0, null)); }
    }
    close() { this.readyState = 3; }
  }
  const driver = createLocalBrowserDriver({ executablePath: process.execPath, scratchRoot: await mkdtemp(join(scratchRoot, 'driver-contract-')), spawnProcess, Socket });
  const handle = await driver.launch(ownership);
  assert.equal(driver.status().exited, false); assert.ok(args.includes('about:blank'));
  assert.ok(args.includes('--disable-extensions')); assert.equal(options.windowsHide, true);
  assert.equal(options.env.PAPERCLIP_API_KEY, undefined); assert.equal(options.shell, false);
  await assert.rejects(driver.launch(ownership), /LOCAL_BROWSER_BUSY/);
  assert.deepEqual(await handle.close(), { closed: true }); assert.equal(driver.status().exited, true);
});
test('real local Chromium lifecycle opens blank and closes before reservation release', { skip: !process.env.IEMS_LOCAL_BROWSER_EXE }, async () => {
  let released = false;
  const lifecycle = createLocalBrowserLifecycle({ ...ownership, executablePath: process.env.IEMS_LOCAL_BROWSER_EXE,
    scratchRoot: await mkdtemp(join(scratchRoot, 'chromium-smoke-')), timeoutMs: 10000,
    registry: { acquire: async ownerId => ({ ...ownership, ownerId }), release: async value => { assert.equal(value.adapterClosed, true); assert.equal(lifecycle.status().browser.exited, true); released = true; } } });
  assert.equal((await lifecycle.start()).state, 'OPEN');
  assert.ok(lifecycle.status().browser.pid > 0); assert.equal(lifecycle.status().browser.externalSendEnabled, false);
  assert.equal((await lifecycle.stop()).state, 'CLOSED'); assert.equal(released, true);
});
