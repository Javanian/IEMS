import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const evidence = resolve(process.env.PLANNING_EVIDENCE_DIR || join(root, 'test-results/order-planning'));
const binary = process.env.PLANNING_BROWSER_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const baselineControl = process.env.PLANNING_BASELINE_CONTROL === '1';
let baselineSource;
if (baselineControl) {
  const original = spawnSync('git', ['show', 'HEAD:apps/web/src/features/portfolio/ManufacturingWorkspace.jsx'], { cwd: root, encoding: 'utf8' });
  assert.equal(original.status, 0, original.stderr);
  const needle = "useResource('/api/manufacturing/work-orders?limit=100', true)";
  assert.equal(original.stdout.split(needle).length, 2, 'Baseline control must remove exactly the complete-page read');
  baselineSource = original.stdout.replace(needle, "useResource('/api/manufacturing/work-orders?limit=100')");
}
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'iems-planning-mock-profile-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], requests = [], exceptions = [], captures = [], pendingCdp = new Map(), network = [];
let vite, browser, ws, session, sequence = 0, active, failure, origin;
const fixtureOrder = id => ({ _id: id, status: 'OPEN', version: 3, quoteRevision: 1, snapshot: { lines: [{ description: `Synthetic ${id}`, quantity: '500.000', uom: 'EA' }] } });
const wo = (id, salesOrderId = 'order-a', quantity = '7.125', lineIndex = 0) => ({ _id: id, salesOrderId, quantity, lineIndex, uom: 'EA', status: 'PLANNED' });
const unrelated = (prefix, count = 100) => Array.from({ length: count }, (_, i) => wo(`${prefix}-${i}`, 'order-other'));
const page = (data, nextCursor = null) => ({ data, page: { nextCursor } });
const html = '<!doctype html><html><head><meta charset="UTF-8"><title>Planning component · mocked API</title></head><body><div id="root"></div><script type="module" src="/__planning-harness.js"></script></body></html>';
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { PlanWorkOrders } from '/src/features/portfolio/ManufacturingWorkspace.jsx';
import { IdentityContext } from '/src/features/portfolio/PortfolioWorkspace.jsx';
import '/src/index.css';
const h=React.createElement;
const nativeFetch=window.fetch.bind(window);
window.__fetchSignals=[];window.__parsedResponses=[];
window.fetch=async(url,options={})=>{
  window.__fetchSignals.push({url:String(url),hasSignal:!!options.signal});
  if(new URLSearchParams(location.search).has('ignoreAbort')){
    const {signal,...remaining}=options;
    options=remaining;
  }
  const response=await nativeFetch(url,options);
  const parse=response.json.bind(response);
  response.json=async()=>{const value=await parse();window.__parsedResponses.push(String(url));return value;};
  return response;
};
function Probe(){const route=useLocation();return h('output',{'data-route':true},route.pathname);}
createRoot(document.getElementById('root')).render(h(MemoryRouter,{initialEntries:[location.pathname]},
 h(IdentityContext.Provider,{value:{permissions:['manufacturing.read']}},
  h('aside',null,'Browser harness · MOCKED API · actual production PlanWorkOrders'),
  h('nav',null,h(Link,{to:'/portfolio/manufacturing/plan/order-a',id:'order-a'},'Mock order A'),' ',h(Link,{to:'/portfolio/manufacturing/plan/order-b',id:'order-b'},'Mock order B')),
  h(Probe),h('main',{className:'portfolio-root'},h(Routes,null,h(Route,{path:'/portfolio/manufacturing/plan/:id',element:h(PlanWorkOrders)}))))));
window.__observations=[];
new MutationObserver(()=>{
 const panel=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='Work orders for this sales order');
 window.__observations.push({route:document.querySelector('[data-route]')?.textContent,rows:[...(panel?.querySelectorAll('li>a')||[])].map(a=>a.getAttribute('href'))});
}).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
`;

async function cdp(method, params = {}, sessionId = session) {
  const id = ++sequence;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingCdp.delete(id); reject(Error(`CDP timeout ${method}`)); }, 20000);
    pendingCdp.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return response;
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (exceptions.length) throw Error(exceptions.at(-1).exceptionDetails.exception?.description || 'Uncaught browser exception');
    try { if (await predicate()) return; } catch (error) { if (!/context.*destroyed|Cannot find context/i.test(error.message)) throw error; }
    await delay(30);
  }
  throw Error(`Timed out: ${description}`);
}
const dom = () => evaluate(`(()=>{const s=[...document.querySelectorAll('section')].find(x=>x.querySelector('h2')?.textContent==='Work orders for this sales order');return {route:document.querySelector('[data-route]')?.textContent,body:document.body.innerText,panel:s?.innerText,loading:!!s?.querySelector('[role=status]'),error:s?.querySelector('[role=alert]')?.innerText,rows:[...(s?.querySelectorAll('li')||[])].map(x=>({href:x.querySelector('a')?.getAttribute('href'),text:x.innerText}))}})()`);
async function shot(name) {
  const metrics = await cdp('Page.getLayoutMetrics');
  const clip = { x: 0, y: 0, width: 1280, height: Math.min(Math.ceil(metrics.cssContentSize.height), 3500), scale: 1 };
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  await writeFile(join(evidence, `${name}.png`), Buffer.from(result.data, 'base64'));
  captures.push({ file: `${name}.png`, capturedAt: new Date().toISOString(), mockedApi: true });
}
async function startCase(name, handler, query = '') {
  active = { name, handler, held: null, closed: false, requests: [] };
  const navigation = await cdp('Page.navigate', { url: `${origin}/portfolio/manufacturing/plan/order-a${query}` });
  assert.ok(!navigation.errorText, JSON.stringify(navigation));
  await waitFor(async () => (await dom()).route?.endsWith('/order-a'), `${name} component mounted`);
}
async function readyRows(ids) {
  await waitFor(async () => { const s = await dom(); return s.panel && !s.loading && !s.error && s.rows.length === ids.length; }, `render ${ids.join(', ')}`);
  const state = await dom();
  assert.deepEqual(state.rows.map(row => row.href), ids.map(id => `/portfolio/manufacturing/work-orders/${id}`));
  return state;
}
function pass(name, detail) { checks.push({ name, state: 'PASS', detail, at: new Date().toISOString() }); console.log('PASS', name); }
function send(res, value, status = 200) { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }

try {
  const probe = createNetServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  vite = await createServer({ root, configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'planning-component-mocked-api',
    enforce: 'pre',
    resolveId(id) { if (id === '/__planning-harness.js') return '\0planning-harness.js'; },
    load(id) { if (id === '\0planning-harness.js') return entry; },
    transform(code, id) {
      if (baselineControl && id.replaceAll('\\', '/').split('?')[0].endsWith('/src/features/portfolio/ManufacturingWorkspace.jsx')) return { code: baselineSource, map: null };
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/portfolio/manufacturing/plan/')) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        if (!url.pathname.startsWith('/portfolio-api/api/')) { next(); return; }
        const fixture = active;
        const record = { case: fixture?.name, url: url.pathname + url.search, at: new Date().toISOString() };
        requests.push(record); fixture?.requests.push(record);
        try {
          if (!fixture) throw Error('No active fixture');
          if (fixture.name === 'stale-order-response' && url.pathname.endsWith('/commercial/orders/order-a')) {
            fixture.held = () => send(res, { data: fixtureOrder('order-a') });
            return;
          }
          if (/\/commercial\/orders\/order-[ab]$/.test(url.pathname)) { send(res, { data: fixtureOrder(url.pathname.split('/').at(-1)) }); return; }
          if (url.pathname === '/portfolio-api/api/manufacturing/work-orders') { await fixture.handler(url.searchParams.get('cursor'), res, fixture); return; }
          throw Error(`Unexpected mocked API path ${url.pathname}`);
        } catch (error) { send(res, { error: { code: 'MOCK_FIXTURE_ERROR', message: error.message } }, 500); }
      });
    }
  }] });
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; browser.stderr.on('data', data => { stderr += data; });
  let endpoint;
  await waitFor(async () => {
    endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (!endpoint) { try { const [port, route] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); endpoint = `ws://127.0.0.1:${port}${route}`; } catch {} }
    return !!endpoint;
  }, 'owned browser debugging endpoint');
  ws = new WebSocket(endpoint); await once(ws, 'open');
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pendingCdp.get(message.id); if (!p) return; pendingCdp.delete(message.id); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
    if (['Network.requestWillBeSent', 'Network.loadingFailed', 'Network.responseReceived'].includes(message.method)) network.push({ method: message.method, params: message.params });
  });
  const target = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await writeFile(join(evidence, 'resources-start.json'), JSON.stringify({ at: new Date().toISOString(), origin, leadPid: process.pid, browserPid: browser.pid, binary, profile, version: await cdp('Browser.getVersion', {}, null), mockedApi: true }, null, 2));

  await startCase('second-page', (cursor, res) => send(res, cursor ? page([wo('target-second', 'order-a', '42.500', 1)]) : page(unrelated('first'), 'opaque +/?=second')));
  const second = await readyRows(['target-second']);
  assert.match(second.rows[0].text, /Line 2 · 42\.500 EA/);
  assert.equal(active.requests.filter(r => r.url.includes('/work-orders')).length, 2);
  await shot('01-second-page'); pass('100 unrelated first-page rows, target on second page renders', second);

  await startCase('three-pages', (cursor, res) => send(res, !cursor ? page([wo('target-one'), ...unrelated('a', 99)], 'middle') : cursor === 'middle' ? page([{ ...wo('target-two', 'order-a', '5.250', 1), status: 'RELEASED' }, ...unrelated('b', 99)], 'last') : page([{ ...wo('target-three', 'order-a', '20.000', 2), status: 'IN_PROGRESS' }, ...unrelated('c', 9)])));
  const multiple = await readyRows(['target-one', 'target-two', 'target-three']);
  assert.match(multiple.rows[0].text, /PLANNED · Line 1 · 7\.125 EA/);
  assert.match(multiple.rows[1].text, /RELEASED · Line 2 · 5\.250 EA/); assert.match(multiple.rows[2].text, /IN_PROGRESS · Line 3 · 20\.000 EA/);
  assert.equal(active.requests.filter(r => r.url.includes('/work-orders')).length, 3);
  await shot('02-three-pages'); pass('all targets across three pages, unrelated rows excluded in actual DOM', multiple);

  await startCase('empty', (cursor, res) => send(res, cursor ? page(unrelated('last', 30)) : page(unrelated('none'), 'empty-last')));
  await waitFor(async () => (await dom()).panel?.includes('None planned yet.'), 'complete traversal empty');
  const empty = await dom(); assert.equal(empty.rows.length, 0); assert.equal(empty.error, undefined); assert.equal(active.requests.length, 3);
  await shot('03-empty'); pass('complete two-page traversal produces true empty state', empty);

  for (const mode of ['later-500', 'later-network', 'repeated-cursor']) {
    await startCase(mode, (cursor, res, fixture) => {
      if (!cursor) { send(res, page([wo('partial-target')], 'held-next')); return; }
      if (mode === 'later-network' && fixture.failNetwork) { res.destroy(); return; }
      fixture.held = () => {
        if (mode === 'later-network') { fixture.failNetwork = true; res.destroy(); }
        else if (mode === 'later-500') send(res, { error: { code: 'MOCK_NEXT_PAGE_FAILED', message: 'Synthetic next page unavailable' } }, 500);
        else send(res, page([wo('also-partial')], 'held-next'));
      };
    });
    await waitFor(() => !!active.held, `${mode} next page held`);
    const held = await dom(); assert.equal(held.loading, true); assert.equal(held.rows.length, 0); assert.ok(!held.panel.includes('None planned yet.'));
    active.held();
    await waitFor(async () => !!(await dom()).error, `${mode} visible error`);
    const errored = await dom(); assert.equal(errored.rows.length, 0); assert.ok(!errored.panel.includes('None planned yet.')); assert.match(errored.error, /Refresh and retry/);
    await shot(`04-${mode}`); pass(`${mode}: loading then error, no partial or false-empty DOM`, errored);
  }

  for (const outcome of ['success', 'error']) {
    await startCase(`stale-list-${outcome}`, (cursor, res, fixture) => {
      fixture.calls = (fixture.calls || 0) + 1;
      if (fixture.calls === 1) { send(res, page([wo('old-order-a')], 'delayed-a')); return; }
      if (cursor === 'delayed-a') { res.on('close', () => { fixture.closed = true; }); fixture.held = () => send(res, outcome === 'success' ? page([wo('late-order-a')]) : { error: { message: 'Late A failure' } }, outcome === 'success' ? 200 : 500); return; }
      send(res, page([wo('new-order-b', 'order-b')]));
    });
    await waitFor(() => !!active.held, 'old list page pending');
    assert.equal((await dom()).rows.length, 0);
    await evaluate("document.getElementById('order-b').click()");
    const b = await readyRows(['new-order-b']); assert.ok(b.route.endsWith('/order-b'));
    await waitFor(() => active.closed, 'actual fetch aborted on old component unmount');
    active.held();
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const after = await readyRows(['new-order-b']);
    const observations = await evaluate('window.__observations');
    assert.ok(observations.filter(o => o.route?.endsWith('/order-b')).every(o => o.rows.every(h => !/old-order-a|late-order-a/.test(h))));
    await shot(`05-stale-list-${outcome}`); pass(`pending old-list ${outcome}: navigation cancels fetch and preserves order B`, { after, oldRequestClosed: active.closed, observations });
  }

  await startCase('stale-order-response', (cursor, res) => send(res, page([wo('current-order-b', 'order-b')])), '?ignoreAbort=1');
  await waitFor(() => !!active.held, 'old source order request pending');
  await evaluate("document.getElementById('order-b').click()"); await readyRows(['current-order-b']);
  active.held();
  await waitFor(async () => (await evaluate('window.__fetchSignals')).some(r => r.url.endsWith('/commercial/orders/order-a') && r.hasSignal), 'production client supplied AbortSignal');
  await waitFor(async () => (await evaluate('window.__parsedResponses')).some(url => url.endsWith('/commercial/orders/order-a')), 'late source response body actually consumed');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const adversarial = await readyRows(['current-order-b']); assert.ok(adversarial.body.includes('Synthetic order-b')); assert.ok(!adversarial.body.includes('Synthetic order-a'));
  await shot('06-late-source-ignores-abort'); pass('late source response with mock fetch ignoring abort does not overwrite current order', { state: adversarial, mockedAdapterIgnoresAbort: true });
  assert.deepEqual(exceptions, []);
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  try { await writeFile(join(evidence, 'failure-diagnostics.json'), JSON.stringify({ state: await evaluate('({url:location.href,readyState:document.readyState,html:document.documentElement.outerHTML})'), network }, null, 2)); } catch {}
  try { await shot('failure'); } catch {}
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close', {}, null); } catch {} ws.close(); }
  if (browser && browser.exitCode === null) {
    await Promise.race([once(browser, 'exit'), delay(5000)]);
    if (browser.exitCode === null) { browser.kill(); await Promise.race([once(browser, 'exit'), delay(5000)]); }
  }
  if (vite) await vite.close();
  const browserExited = !browser || browser.exitCode !== null || browser.signalCode !== null;
  assert.ok(browserExited, 'Owned mock browser must exit before next runtime');
  const ownedProfile = await realpath(profile), tempRoot = await realpath(tmpdir());
  assert.ok(ownedProfile.startsWith(tempRoot) && ownedProfile.includes('iems-planning-mock-profile-'));
  await rm(ownedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ at: new Date().toISOString(), source: 'Actual production PlanWorkOrders, PlannedForOrder, useResource, Resource, portfolioRequest, collectPages; harness router/identity only', baselineControl, mockedApi: true, realBackend: false, origin, checks, requests, captures, exceptions, failure: failure || null, cleanup: { browserExited, serverClosed: !vite || !vite.httpServer?.listening, profileRemoved: true } }, null, 2));
}
