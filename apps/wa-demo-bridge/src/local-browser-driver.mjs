import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createProviderBrowserLifecycle } from './provider-browser.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const fail = code => { throw new Error(code); };

export function browserEndpoint(text) {
  const [port, path] = text.trim().split(/\r?\n/);
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535
    || !/^\/devtools\/browser\/[a-zA-Z0-9-]{1,100}$/.test(path)) fail('INVALID_LOCAL_BROWSER_ENDPOINT');
  return `ws://127.0.0.1:${Number(port)}${path}`;
}

// This driver has no URL, evaluate, inbound, ready or send port.
export function createLocalBrowserDriver({ executablePath, scratchRoot, timeoutMs = 10000,
  spawnProcess = spawn, Socket = WebSocket }) {
  if (!isAbsolute(executablePath ?? '') || !isAbsolute(scratchRoot ?? '')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) fail('INVALID_LOCAL_BROWSER_CONFIGURATION');
  let active;
  const remaining = deadline => Math.max(1, deadline - Date.now());
  async function within(promise, deadline) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('LOCAL_BROWSER_TIMEOUT')), remaining(deadline)); })]); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    status() {
      return Object.freeze({ mode: 'LOCAL_BLANK_BROWSER', externalSendEnabled: false,
        pid: active?.child?.pid ?? null, profileId: active?.profileId ?? null,
        startedAt: active?.startedAt ?? null, exited: active?.exited ?? false,
        tenantId: active?.ownership.tenantId ?? null, accountId: active?.ownership.accountId ?? null,
        ownerId: active?.ownership.ownerId ?? null, generation: active?.ownership.generation ?? null });
    },
    async launch(ownership) {
      if (active && !active.confirmedClosed) fail('LOCAL_BROWSER_BUSY');
      if (!ownership || ![ownership.tenantId, ownership.accountId, ownership.ownerId].every(validId)
        || !Number.isSafeInteger(ownership.generation) || ownership.generation < 1
        || ownership.externalSendEnabled !== false) fail('INVALID_LOCAL_BROWSER_OWNERSHIP');
      const current = { ownership: Object.freeze({ tenantId: ownership.tenantId, accountId: ownership.accountId,
        ownerId: ownership.ownerId, generation: ownership.generation }), profileId: randomUUID(), startedAt: new Date().toISOString(), exited: false, confirmedClosed: false };
      active = current;
      const deadline = Date.now() + timeoutMs;
      await mkdir(scratchRoot, { recursive: true });
      const root = await realpath(scratchRoot), executable = await realpath(executablePath);
      const profile = await mkdtemp(join(root, `iems-browser-${current.profileId}-`));
      const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
      current.child = spawnProcess(executable, [
        '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync',
        '--disable-extensions', '--disable-default-apps', '--disable-breakpad',
        '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
      ], { windowsHide: true, shell: false, stdio: 'ignore', env });
      let processError;
      const exited = new Promise(resolve => {
        current.child.once('exit', (code, signal) => { current.exited = true; resolve({ code, signal }); });
        current.child.once('error', () => { processError = true; resolve({ error: true }); });
      });
      await writeFile(join(profile, 'iems-ownership.json'), JSON.stringify({ ...current.ownership,
        pid: current.child.pid ?? null, profileId: current.profileId, startedAt: current.startedAt,
        mode: 'LOCAL_BLANK_BROWSER', externalSendEnabled: false }), { flag: 'wx' });
      let endpoint;
      while (Date.now() < deadline) {
        if (processError || current.exited) fail('LOCAL_BROWSER_EXITED_DURING_START');
        try { endpoint = browserEndpoint(await readFile(join(profile, 'DevToolsActivePort'), 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await delay(Math.min(25, remaining(deadline)));
      }
      if (!endpoint) fail('LOCAL_BROWSER_TIMEOUT');
      const socket = new Socket(endpoint);
      // Keep an error listener after open; browser crashes never become unhandled errors.
      socket.addEventListener('error', () => {});
      try {
      await within(new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('LOCAL_BROWSER_CONNECT_FAILED')), { once: true });
      }), deadline);
      const version = new Promise((resolve, reject) => {
        const response = event => {
          try {
            const data = JSON.parse(event.data);
            if (data.id !== 1) return;
            socket.removeEventListener('message', response);
            if (typeof data.result?.product !== 'string') reject(new Error('LOCAL_BROWSER_NOT_READY'));
            else resolve();
          } catch { reject(new Error('LOCAL_BROWSER_INVALID_RESPONSE')); }
        };
        socket.addEventListener('message', response);
        socket.addEventListener('close', () => reject(new Error('LOCAL_BROWSER_CLOSED')), { once: true });
      });
      socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
      await within(version, deadline);
      if (current.exited) fail('LOCAL_BROWSER_EXITED_DURING_START');
      } catch (error) { socket.close(); throw error; }
      return Object.freeze({ async close() {
        if (current.confirmedClosed) return Object.freeze({ closed: true });
        if (current.exited || socket.readyState !== 1) fail('LOCAL_BROWSER_CLOSE_REQUIRES_RECONCILIATION');
        socket.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
        const result = await within(exited, Date.now() + timeoutMs);
        socket.close();
        if (result.error || result.code !== 0 || result.signal) fail('LOCAL_BROWSER_CLOSE_UNCONFIRMED');
        current.confirmedClosed = true;
        return Object.freeze({ closed: true });
      } });
    },
  });
}

export function createLocalBrowserLifecycle({ registry, ownerId, tenantId, accountId, executablePath, scratchRoot, timeoutMs = 10000 }) {
  const driver = createLocalBrowserDriver({ executablePath, scratchRoot, timeoutMs });
  const lifecycle = createProviderBrowserLifecycle({ registry, ownerId, tenantId, accountId, driver, timeoutMs: Math.min(60000, timeoutMs + 1000) });
  return Object.freeze({ start: () => lifecycle.start(), stop: () => lifecycle.stop(),
    status: () => Object.freeze({ ...lifecycle.status(), browser: driver.status() }) });
}
