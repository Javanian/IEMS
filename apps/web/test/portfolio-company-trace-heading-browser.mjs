import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';
import { navigationContextChanged } from './browser-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const serials = [
  ['historical-push', 'QA_COMP_4D880C6B_TRACE_LEAF'],
  ['historical-pr', 'QA_COMP_279E2EB2_TRACE_LEAF'],
  ['long', `TRACE_${'W'.repeat(128)}`],
  ['short', 'TRACE-1'],
];
const cases = serials.flatMap(([name, serial]) => [false, true].flatMap(kiosk => [360, 768, 1440].map(width => ({ name: `${name}-${kiosk ? 'kiosk' : 'desktop'}-${width}`, serial, kiosk, width }))));
function resourceGuard(start = false) {
  const freeBytes = freemem(), minimumGiB = start ? 2 : 1.5;
  assert.ok(freeBytes >= minimumGiB * 1024 ** 3, `Trace heading resource guard: ${freeBytes} available bytes, ${minimumGiB}GiB required`);
  return { at: new Date().toISOString(), freeBytes, minimumGiB };
}
function fixture(serial) {
  return {
    schema: 'COMPANY_UNIT_TRACE_V1', companyReceiptId: 'heading-receipt', companyUnitId: 'heading-unit', serial,
    sourcePolicy: 'LEAF_ONLY', itemSnapshot: { code: 'HEADING_FIXTURE', content: { description: 'Synthetic trace heading regression' } },
    locationSnapshot: { code: 'HEADING_LOCATION' }, current: { stockVersion: 1, unitVersion: 1, status: 'STORED', eligible: false, blockers: ['LEAF_ONLY'] },
    producer: { executionId: 'heading-producer' }, completeness: { complete: true, oneGeneration: true },
    ancestry: { basis: 'EXACT_OUTPUT_ATTRIBUTION', purchasedSources: [], companySources: [] },
    holdPolicy: { basis: 'CONSERVATIVE_CONSUMED_BATCH', receiptIds: [] },
    uses: { reserved: [], issued: [], consumedUnattributed: [], outputs: [], losses: [], abandoned: [] },
  };
}
const html = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Trace heading regression: MOCKED HTTP API</title></head><body><div id="root"></div><script type="module" src="/__trace-heading.js"></script></body></html>';
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import {CompanyStockTrace} from '/src/features/portfolio/CompanyStockTraceUi.jsx';import {IdentityContext} from '/src/features/portfolio/PortfolioWorkspace.jsx';
import '@fontsource-variable/plus-jakarta-sans/wght.css';import '@fontsource/fira-code/latin-500.css';import '/src/index.css';
const h=React.createElement,f=await(await fetch('/__trace-heading-fixture')).json();
createRoot(document.getElementById('root')).render(h(MemoryRouter,null,h(IdentityContext.Provider,{value:{permissions:['company.stock.read']}},
h('div',{className:'portfolio-root','data-kiosk':f.kiosk},h('main',{className:'pf-main'},h('section',{className:'pf-panel'},
h(CompanyStockTrace,{source:{_id:f.data.companyReceiptId,units:[{companyUnitId:f.data.companyUnitId,serial:f.data.serial}]},locked:false})))))));
`;
const geometryExpression = `(()=>{
  const heading=document.querySelector('[data-trace-complete="true"] > h3'),box=heading?.getBoundingClientRect(),range=document.createRange();
  if(heading)range.selectNodeContents(heading);
  return {innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
    url:location.href,timeOrigin:performance.timeOrigin,kiosk:document.querySelector('.portfolio-root')?.dataset.kiosk,
    text:heading?.textContent,heading:box?.toJSON(),textRects:heading?[...range.getClientRects()].map(r=>r.toJSON()):[],
    font:heading?{family:getComputedStyle(heading).fontFamily,status:document.fonts.status}:null,
    controls:[...document.querySelectorAll('#company-unit-trace button,#company-unit-trace select')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height}))};
})()`;

export async function runTraceHeadingBrowserRegression({ evidenceDirectory, browserBinary, baselineRef = null } = {}) {
  const evidence = evidenceDirectory ? resolve(evidenceDirectory) : await mkdtemp(join(tmpdir(), 'iems-trace-heading-evidence-'));
  await mkdir(evidence, { recursive: true });
  let baselineSource;
  if (baselineRef) {
    assert.match(baselineRef, /^[a-f0-9]{40}$/, 'Use an explicit immutable baseline SHA');
    const original = spawnSync('git', ['show', `${baselineRef}:apps/web/src/features/portfolio/CompanyStockTraceUi.jsx`], { cwd: root, encoding: 'utf8' });
    assert.equal(original.status, 0, original.stderr); baselineSource = original.stdout;
  }
  const originalCwd = process.cwd(), initialGuard = resourceGuard(true), records = [], exceptions = [], pending = new Map();
  let active, vite, browser, ws, targetId, sessionId, sequence = 0, origin, profile, failure, version;
  const binary = browserBinary || process.env.TRACE_HEADING_BROWSER_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  async function cdp(method, params = {}, session = sessionId) {
    const id = ++sequence;
    const result = new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(id); reject(Error(`Trace heading CDP timeout: ${method}`)); }, 60000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); }, timeout }); });
    ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })); return result;
  }
  async function evaluate(expression) {
    resourceGuard(); const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
  }
  async function wait(expression) {
    for (let attempt = 0; attempt < 300; attempt++) {
      try { if (await evaluate(`Boolean(document.body && (${expression}))`)) return; } catch (error) { if (!navigationContextChanged(error)) throw error; }
      await pause(100);
    }
    throw Error(`Trace heading readiness timeout: ${expression}`);
  }
  async function capture(name) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(evidence, `trace-heading-${name}.png`), Buffer.from(shot.data, 'base64'));
  }
  const browserClosed = () => !browser?.pid || browser.exitCode !== null || browser.signalCode !== null;
  function waitForBrowserExit() {
    if (browserClosed()) return Promise.resolve();
    return new Promise(resolve => { const done = () => { clearTimeout(timer); browser.removeListener('exit', done); resolve(); }; const timer = setTimeout(done, 5000); browser.once('exit', done); if (browserClosed()) done(); });
  }
  try {
    process.chdir(root);
    const portProbe = createNetServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
    const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
    vite = await createServer({ root, configFile: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
      name: 'trace-heading-production-component', enforce: 'pre',
      resolveId(id) { if (id === '/__trace-heading.js') return '\0trace-heading.js'; },
      load(id) { if (id === '\0trace-heading.js') return entry; },
      transform(code, id) { if (baselineSource && id.replaceAll('\\', '/').split('?')[0].endsWith('/src/features/portfolio/CompanyStockTraceUi.jsx')) return { code: baselineSource, map: null }; },
      configureServer(server) { server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/__trace-heading-case/')) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        if (url.pathname === '/__trace-heading-fixture' || url.pathname === '/portfolio-api/api/company-stock/receipts/heading-receipt/units/heading-unit/trace') {
          res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(url.pathname === '/__trace-heading-fixture' ? { data: fixture(active.serial), kiosk: active.kiosk } : { data: fixture(active.serial) })); return;
        }
        next();
      }); },
    }] });
    await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    profile = await mkdtemp(join(tmpdir(), 'iems-trace-heading-profile-'));
    browser = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', launchError, endpoint; browser.stderr.on('data', bytes => { stderr += bytes; }); browser.once('error', error => { launchError = error; });
    const deadline = Date.now() + 60000;
    while (!endpoint && Date.now() < deadline) {
      if (launchError) throw launchError;
      assert.equal(browser.exitCode, null, 'Owned heading browser exited during startup');
      endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      if (!endpoint) { try { const [port, route] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); assert.match(port, /^\d+$/); assert.match(route, /^\/devtools\/browser\/[a-zA-Z0-9-]+$/); endpoint = `ws://127.0.0.1:${port}${route}`; } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; } }
      if (!endpoint) await pause(100);
    }
    assert.ok(endpoint, 'Owned heading browser endpoint unavailable');
    ws = new WebSocket(endpoint); await once(ws, 'open');
    ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); } } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text); });
    targetId = (await cdp('Target.createTarget', { url: 'about:blank' }, null)).targetId;
    sessionId = (await cdp('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
    await cdp('Runtime.enable'); await cdp('Page.enable'); version = await cdp('Browser.getVersion', {}, null);
    for (active of cases) {
      resourceGuard(true); const record = { ...active, startedAt: new Date().toISOString(), targetId, sessionId }; records.push(record);
      try {
        await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await cdp('Page.navigate', { url: `${origin}/__trace-heading-case/${active.name}` });
        await wait('!!document.querySelector("select[name=traceUnitId]")');
        await evaluate(`(()=>{const select=document.querySelector('select[name=traceUnitId]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'heading-unit');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await evaluate(`document.querySelector('form[aria-label="Trace an actual manufactured unit"]').requestSubmit()`);
        await wait('!!document.querySelector("[data-trace-complete=true]")'); await evaluate('document.fonts.ready');
        record.resize = { requestedAt: new Date().toISOString(), width: active.width, height: 1000, mobile: active.width < 600 };
        await cdp('Emulation.setDeviceMetricsOverride', { width: active.width, height: 1000, deviceScaleFactor: 1, mobile: active.width < 600 }); record.resize.acknowledgedAt = new Date().toISOString();
        await wait(`innerWidth===${active.width}`);
        await evaluate('(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()');
        record.geometry = await evaluate(geometryExpression);
        const geometry = record.geometry;
        assert.equal(geometry.innerWidth, active.width, 'Requested CSS viewport must remain exact');
        assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'Trace must not overflow the document');
        assert.equal(geometry.text, `Trace for serial ${active.serial}`, 'Complete serial must remain visible in the heading text');
        assert.equal(geometry.kiosk, String(active.kiosk)); assert.equal(geometry.font.status, 'loaded');
        assert.ok(geometry.textRects.length > 0);
        assert.deepEqual(geometry.textRects.filter(rect => rect.left < geometry.heading.left - 1 || rect.right > geometry.heading.right + 1), [], 'Painted serial text must stay inside its heading');
        assert.ok(geometry.controls.length > 0);
        assert.deepEqual(geometry.controls.filter(control => control.height < (active.kiosk ? 47.9 : 43.9)), [], 'Production desktop/kiosk targets must remain usable');
        record.state = 'PASS'; record.completedAt = new Date().toISOString();
        if (active.width === 360 && /^(historical-push|long)-/.test(active.name)) await capture(active.name);
      } catch (error) {
        record.state = 'FAIL'; record.error = String(error); record.geometry = await evaluate(geometryExpression).catch(() => null); await capture(`failure-${active.name}`).catch(() => {}); throw error;
      }
    }
    assert.deepEqual(exceptions, [], 'No unexpected production-component exception');
  } catch (error) { failure = error; }
  finally {
    const cleanupErrors = [];
    const cleanupFailure = error => { cleanupErrors.push(String(error)); failure ||= error; };
    if (ws?.readyState === 1) { try { await cdp('Browser.close', {}, null); } catch (error) { cleanupFailure(error); } ws.close(); }
    await waitForBrowserExit();
    if (!browserClosed()) { try { browser.kill(); await waitForBrowserExit(); } catch (error) { cleanupFailure(error); } }
    if (!browserClosed()) cleanupFailure(Error('Owned heading browser did not exit; main journey must not start'));
    try { if (vite) await vite.close(); } catch (error) { cleanupFailure(error); } finally { process.chdir(originalCwd); }
    if (vite?.httpServer?.listening) cleanupFailure(Error('Owned heading frontend server did not close'));
    let profileRemoved = !profile;
    if (profile && browserClosed()) {
      try { const owned = await realpath(profile); assert.ok(owned.startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')) && owned.includes('iems-trace-heading-profile-')); await rm(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); profileRemoved = true; }
      catch (error) { cleanupFailure(error); }
    }
    for (const request of pending.values()) clearTimeout(request.timeout);
    const summary = { mockedHttpApi: true, productionComponent: 'CompanyStockTrace', baselineRef, planned: cases.length, passed: records.filter(record => record.state === 'PASS').length, failed: records.filter(record => record.state === 'FAIL').length, notRun: cases.length - records.length, version, initialGuard, records, exceptions, error: failure ? String(failure) : null, cleanupErrors, resources: { browserPid: browser?.pid, browserExitCode: browser?.exitCode, browserSignalCode: browser?.signalCode, browserClosed: browserClosed(), origin, serverClosed: !vite?.httpServer?.listening, profileRemoved, applicationApiOrDatabaseStarted: false } };
    await writeFile(join(evidence, 'trace-heading-regression.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('TRACE_HEADING_REGRESSION ' + JSON.stringify({ passed: summary.passed, failed: summary.failed, notRun: summary.notRun, mockedHttpApi: true, baselineRef, evidence, resources: summary.resources }));
  }
  if (failure) throw failure;
  return { passed: records.length, evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runTraceHeadingBrowserRegression({ evidenceDirectory: process.env.TRACE_HEADING_EVIDENCE_DIR, baselineRef: process.env.TRACE_HEADING_BASELINE_REF || null });
}
