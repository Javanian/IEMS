import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { freemem, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../../apps/web/node_modules/vite/dist/node/index.js';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { documentNavigationCall, navigationContextChanged } from '../../../apps/web/test/browser-readiness.mjs';
import { domainSnapshot } from '../../wave4map/qa/mapping-fixture.mjs';
import { classifyModuleFaultErrors } from './module-fetch-fault-errors.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const originalCwd = process.cwd();
const evidence = process.env.IEMS_QA_EVIDENCE;
assert.ok(evidence, 'Set IEMS_QA_EVIDENCE to a fresh external attempt directory');
const output = resolve(evidence);
assert.ok(isAbsolute(relative(repo, output)) || relative(repo, output).startsWith('..'), 'Evidence must remain external');
assert.ok(freemem() >= 2 * 1024 ** 3, 'At least2GiB available RAM is required before starting');
await mkdir(output, { recursive: false });
const hooks = [], events = [], requests = [], failures = [], exceptions = [], consoleErrors = [], checks = [];
const result = { intentionalFaultProbe: true, full149Acceptance: false, startedAt: new Date().toISOString(), freeRamBeforeBytes: freemem() };
const pause = ms => new Promise(r => setTimeout(r, ms));
const profile = await mkdtemp(join(tmpdir(), 'iems-module-fault-'));
let h, vite, chrome, ws, session, sequence = 0, armed = false, aborted = 0, phase = 'setup', fatal;
const pending = new Map();
const record = name => { checks.push(name); console.log('PASS', name); };
function send(method, params = {}, sessionId = session) {
  const id = ++sequence;
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolveCall(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const call = documentNavigationCall(send);
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 300; i++) {
    try { if (await evaluate(`Boolean(document.body && (${expression}))`)) return; }
    catch (error) { if (!navigationContextChanged(error)) throw error; }
    await pause(100);
  }
  throw Error(`Readiness timeout: ${expression}`);
}
async function nativeClick(selector) {
  const point = await evaluate(`(async()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function screenshot(name) {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, name), Buffer.from(shot.data, 'base64'));
}
try {
  h = await startOwned({ after: hook => hooks.push(hook) });
  const apiOrigin = new URL((await h.raw('/session/me')).url).origin;
  const web = 'http://localhost:4173', webRoot = join(repo, 'apps/web');
  process.chdir(webRoot);
  vite = await createServer({ root: webRoot, define: { 'import.meta.env.VITE_PORTFOLIO_API_BASE': JSON.stringify('/portfolio-api') }, server: { host: 'localhost', port: 4173, strictPort: true, fs: { allow: [repo, await realpath(join(webRoot, 'node_modules'))] }, proxy: { '/portfolio-api': { target: apiOrigin, changeOrigin: false, rewrite: url => url.replace(/^\/portfolio-api/, '') } } } });
  await vite.listen();
  chrome = spawn(process.env.PORTFOLIO_CHROME_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', launchError, endpoint;
  chrome.stderr.on('data', bytes => { stderr += bytes; });
  chrome.once('error', error => { launchError = error; });
  const deadline = Date.now() + 60000;
  while (!endpoint && Date.now() < deadline) {
    if (launchError) throw launchError;
    endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (!endpoint) {
      try {
        const [port, route] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && /^\/devtools\/browser\/[\w-]+$/.test(route)) endpoint = `ws://127.0.0.1:${port}${route}`;
      } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; }
    }
    if (chrome.exitCode !== null || chrome.signalCode !== null) throw Error(`Owned Chrome exited before readiness: ${stderr}`);
    if (!endpoint) await pause(100);
  }
  assert.ok(endpoint, 'Owned Chrome ready within60s');
  ws = new WebSocket(endpoint);
  await new Promise((resolveOpen, reject) => { ws.onopen = resolveOpen; ws.onerror = reject; });
  ws.onmessage = message => {
    const event = JSON.parse(message.data), waiting = pending.get(event.id);
    if (waiting) { pending.delete(event.id); event.error ? waiting.reject(event.error) : waiting.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') exceptions.push({ phase, ...event.params });
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') consoleErrors.push({ phase, ...event.params });
    if (event.method === 'Network.requestWillBeSent') requests.push({ phase, id: event.params.requestId, url: event.params.request.url, method: event.params.request.method });
    if (event.method === 'Network.loadingFailed') failures.push({ phase, ...event.params });
    if (phase === 'native-reload-recovery' && ['Page.frameStartedLoading', 'Page.frameNavigated'].includes(event.method)) events.push({ phase, kind: event.method, params: event.params });
    if (event.method === 'Fetch.requestPaused') {
      const url = new URL(event.params.request.url), target = url.pathname === '/src/pages/PORTFOLIO/PortfolioPage.jsx';
      if (armed && target) {
        armed = false; aborted++;
        events.push({ phase, kind: 'actual-module-aborted', url: url.href, requestId: event.params.requestId, networkId: event.params.networkId });
        send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }).catch(error => { fatal ||= error; });
      } else send('Fetch.continueRequest', { requestId: event.params.requestId }).catch(error => { fatal ||= error; });
    }
  };
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
  session = (await call('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Network.setCookie', { name: 'portfolio_session', value: h.alpha.slice('portfolio_session='.length), url: web, path: '/', httpOnly: true, sameSite: 'Strict' });
  await call('Page.navigate', { url: `${web}/portfolio/accounts` });
  await wait(`document.querySelector('h1')?.textContent==='Accounts'`);
  const name = `Synthetic module recovery ${randomUUID()}`;
  await evaluate(`(()=>{const node=document.querySelector('[name=name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(name)});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await nativeClick('form button[type=submit],form button.pf-primary');
  await wait(`document.querySelector('h1')?.textContent===${JSON.stringify(name)}`);
  const account = await h.db.collection('accounts').findOne({ name });
  assert.ok(account); assert.equal(await h.db.collection('accounts').countDocuments({ name }), 1);
  const destination = `${web}/portfolio/accounts/${account._id}`, baseline = await domainSnapshot(h);
  const businessPosts = () => requests.filter(row => row.method === 'POST' && row.url.includes('/portfolio-api/api/') && !row.url.includes('/session/'));
  assert.equal(businessPosts().length, 1); assert.ok(businessPosts()[0].url.endsWith('/crm/accounts'));
  record('actual mounted HTTP session and one native account creation establish real business evidence');

  phase = 'intentional-module-fault'; armed = true;
  await call('Fetch.enable', { patterns: [{ urlPattern: '*src/pages/PORTFOLIO/PortfolioPage.jsx*', requestStage: 'Request' }] });
  await call('Page.navigate', { url: destination });
  await wait(`document.querySelector('[data-portfolio-route-error]')`);
  assert.equal(aborted, 1); assert.equal(armed, false); assert.equal(await evaluate('location.href'), destination);
  const errorView = await evaluate(`(()=>{const root=document.querySelector('[data-portfolio-route-error]');return {heading:root.querySelector('h1')?.textContent,text:root.innerText,html:root.outerHTML,technicalOpen:root.querySelector('details')?.open,buttons:[...root.querySelectorAll('button')].map(node=>node.textContent)}})()`);
  assert.equal(errorView.heading, 'Workspace could not load');
  assert.ok(errorView.text.includes('Check your connection, then reload this page.'));
  assert.deepEqual(errorView.buttons, ['Reload workspace']); assert.equal(errorView.technicalOpen, false);
  assert.doesNotMatch(errorView.text, /https?:\/\/|\/src\/|PortfolioPage\.jsx|TypeError|\bat\s+\w|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  assert.doesNotMatch(errorView.html, /PortfolioPage\.jsx|TypeError|http:\/\/localhost|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  assert.deepEqual(await domainSnapshot(h), baseline); assert.equal(businessPosts().length, 1);
  result.errorView = errorView; result.recoveryLayouts = [];
  for (const width of [360, 768, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await wait(`innerWidth===${width}`);
    const layout = await evaluate(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,controls:[...document.querySelectorAll('[data-portfolio-route-error] button,[data-portfolio-route-error] summary')].map(node=>{const r=node.getBoundingClientRect();return {label:node.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}})}})()`);
    assert.equal(layout.overflow, false);
    assert.deepEqual(layout.controls.map(row => row.label), ['Reload workspace', 'Technical details']);
    for (const control of layout.controls) { assert.ok(control.height >= 48, `${width}px ${control.label} height${control.height}`); assert.ok(control.width > 0 && control.x >= -1 && control.right <= width + 1); }
    result.recoveryLayouts.push(layout);
    await screenshot(`module-fetch-friendly-error-${width}.png`);
  }
  record('one actual lazy-module request abort reaches eager friendly recovery without primary raw URL, stack or identity and without business effects');
  record('actual reload button and technical summary are at least48px at360/768/1440 with no horizontal overflow');

  await call('Fetch.disable');
  phase = 'native-reload-recovery';
  const priorOrigin = await evaluate('performance.timeOrigin');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.textContent'), 'Reload workspace');
  result.nativeReloadDiagnostics = { priorTimeOrigin: priorOrigin, expectedUrl: destination, focusedButton: 'Reload workspace', keySequence: ['keyDown Enter', 'char CR', 'keyUp Enter'] };
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  try { await wait(`performance.timeOrigin!==${priorOrigin} && document.querySelector('h1')?.textContent===${JSON.stringify(name)}`); }
  finally { result.nativeReloadDiagnostics.after = await evaluate(`({timeOrigin:performance.timeOrigin,url:location.href,heading:document.querySelector('h1')?.textContent,focused:document.activeElement?.textContent})`).catch(error => ({ diagnosticError: String(error) })); }
  assert.equal(await evaluate('location.href'), destination); assert.equal(await evaluate(`!!document.querySelector('[data-portfolio-route-error]')`), false);
  assert.equal(aborted, 1); assert.equal(businessPosts().length, 1); assert.deepEqual(await domainSnapshot(h), baseline);
  assert.equal(await h.db.collection('accounts').countDocuments({ name }), 1);
  await screenshot('module-fetch-native-recovered-record.png');
  record('native Tab and Enter reload the same account URL after transport restoration, without duplicate creation or business retransmission');
  result.errorAttribution = classifyModuleFaultErrors({ events, failures, consoleErrors, exceptions });
  assert.ok(result.errorAttribution.recoveryConsoleCount >= 1, 'actual recovery console message carries the exact aborted-module import failure');
  assert.deepEqual(result.errorAttribution.unrelatedConsole, [], 'unrelated console errors fail even during the intentional-fault phase');
  assert.deepEqual(result.errorAttribution.unrelatedExceptions, [], 'unrelated exceptions fail even during the intentional-fault phase');
  if (fatal) throw fatal;
  result.status = 'PASS'; result.accountId = account._id; result.businessPostCount = businessPosts().length;
} catch (error) {
  fatal = error; result.status = 'FAIL'; result.error = { message: error.message, stack: error.stack };
  if (ws?.readyState === WebSocket.OPEN) await screenshot('failure.png').catch(() => {});
} finally {
  try {
    if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close', {}, null).catch(() => {}); ws.close(); }
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      await Promise.race([new Promise(resolveExit => chrome.once('exit', resolveExit)), pause(5000)]);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await new Promise(resolveExit => chrome.once('exit', resolveExit)); }
    }
    if (vite) await vite.close();
    for (const hook of hooks.reverse()) await hook();
    assert.ok(resolve(profile).startsWith(resolve(tmpdir()) + sep) && profile.includes('iems-module-fault-'), 'Only the freshly owned temp profile may be removed');
    await rm(profile, { recursive: true, force: true });
    result.cleanup = 'owned Chrome/profile/Vite and marker-verified database/replica only';
  } catch (error) { fatal ||= error; result.status = 'FAIL'; result.cleanupError = String(error.stack || error); }
  result.finishedAt = new Date().toISOString();
  process.chdir(originalCwd);
  await writeFile(join(output, 'module-fetch-recovery-results.json'), JSON.stringify({ ...result, checks, aborted, events, requests, failures, exceptions, consoleErrors }, null, 2));
  console.log(JSON.stringify({ status: result.status, checks: checks.length, aborted, errorAttribution: result.errorAttribution, cleanup: result.cleanup, error: result.error, cleanupError: result.cleanupError }));
}
process.exitCode = fatal ? 1 : 0;
