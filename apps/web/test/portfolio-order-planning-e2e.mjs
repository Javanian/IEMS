import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir, freemem, totalmem } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';
import { MongoMemoryReplSet } from '../../portfolio-api/node_modules/mongodb-memory-server/index.js';
import { MongoClient } from '../../portfolio-api/node_modules/mongodb/lib/index.js';
import { connectOwned } from '../../portfolio-api/src/config.mjs';
import { createApp, seedSynthetic } from '../../portfolio-api/src/app.mjs';
import { navigationContextChanged } from './browser-readiness.mjs';
import { orderPlanningFixture } from './order-planning-fixture.mjs';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const evidence = resolve(process.env.PLANNING_E2E_EVIDENCE_DIR || join(tmpdir(), `iems-planning-e2e-${randomUUID()}`));
await mkdir(evidence, { recursive: true });
const marker = randomUUID(), database = `portfolio_owned_planning_${marker.replaceAll('-', '')}`;
const password = randomUUID() + randomUUID();
const binary = process.env.PLANNING_BROWSER_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], proxyRecords = [], injections = [], captures = [], exceptions = [], networkFailures = [], measurements = [], cleanup = {}, pending = new Map();
const cookies = new Map();
const heldResponses = new Set();
let mongo, runtime, independent, api, vite, chrome, ws, session, profile, origin, apiOrigin, fixture, failure, active = 'setup', injection = null, negativeControl = false, sequence = 0;
const sourcePath = join(root, 'src/features/portfolio/ManufacturingWorkspace.jsx');
const sourceHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
const report = (name, value) => writeFile(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
function guard(start = false) { assert.ok(freemem() >= (start ? 2 : 1.5) * 1024 ** 3, `Planning E2E requires ${start ? 2 : 1.5} GiB available RAM`); }
function measure(phase) { const value = { phase, at: new Date().toISOString(), availableBytes: freemem(), totalBytes: totalmem(), node: process.memoryUsage(), elapsedMs: performance.now() }; measurements.push(value); return value; }
async function freePort() { const probe = createNetServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r)); return port; }
async function cdp(method, params = {}, sessionId = session) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return result;
}
async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function until(test, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (exceptions.length) throw Error(`Application exception: ${JSON.stringify(exceptions.at(-1))}`);
    try { if (await test()) return; } catch (error) { if (!navigationContextChanged(error)) throw error; }
    await pause(50);
  }
  throw Error(`Timed out ${label}`);
}
const panelExpression = `([...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='Work orders for this sales order'))`;
async function state() { return evaluate(`(()=>{const p=${panelExpression};return {route:location.pathname,kiosk:document.querySelector('.portfolio-root')?.dataset.kiosk,panel:p?.innerText,loading:!!p?.querySelector('[role=status]'),error:p?.querySelector('[role=alert]')?.innerText,rows:[...(p?.querySelectorAll('li')||[])].map(x=>({id:x.querySelector('a')?.getAttribute('href').split('/').at(-1),text:x.innerText})),notice:[...document.querySelectorAll('section[role=status]')].map(s=>s.innerText),body:document.body.innerText}})()`); }
async function waitPanel() { await until(async () => { const s = await state(); return s.panel && !s.loading && !s.error; }, 'settled actual planning panel'); return state(); }
async function completedTraversal(records) {
  const reads = await evaluate("window.__planningEvidence.fetches.filter(x=>x.path.startsWith('/portfolio-api/api/manufacturing/work-orders?')&&x.status===200&&x.parsed&&!x.abortSignaled)");
  return reads.map(read => {
    const actual = records.find(x => x.proxyId === read.proxyId && x.clientId === read.clientId && x.deliveredStatus === 200);
    assert.ok(actual, 'Every consumed page must match its unique real API response');
    assert.equal(`/portfolio-api${actual.path}`, read.path); return actual;
  });
}
async function oracle(order) { return independent.db(database).collection('manufacturingWorkOrders').find({ tenantId: order.tenantId, plantId: order.plantId, salesOrderId: order._id }).sort({ _id: 1 }).toArray(); }
async function assertRows(order) {
  const actual = await waitPanel(), expected = await oracle(order);
  assert.equal(actual.route, `/portfolio/manufacturing/plan/${order._id}`, 'Oracle must match the current actual route');
  assert.deepEqual(actual.rows.map(x => x.id), expected.map(x => x._id), `OP exact WO identities for ${order.orderNumber}`);
  assert.equal(new Set(actual.rows.map(x => x.id)).size, expected.length);
  expected.forEach((wo, index) => assert.ok(actual.rows[index].text.includes(`${wo.status} · Line ${wo.lineIndex + 1} · ${wo.quantity} ${wo.uom}`), actual.rows[index].text));
  return { actual, expected };
}
async function click(selector) {
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `control ${selector}`);
  const point = await evaluate(`(()=>{const x=document.querySelector(${JSON.stringify(selector)});x.scrollIntoView({block:'center'});const b=x.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,disabled:x.disabled}})()`);
  assert.ok(!point.disabled);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
}
async function fill(name, value) { await evaluate(`(()=>{const x=document.querySelector('[name=${name}]');x.focus();x.select();})()`); await cdp('Input.insertText', { text: value }); }
async function key(key, code, number) { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: number }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: number }); }
async function shot(name) { await cdp('Page.bringToFront'); const data = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(evidence, `${name}.png`), Buffer.from(data.data, 'base64')); captures.push({ file: `${name}.png`, case: active, at: new Date().toISOString(), actualApp: true }); }
function pass(id, detail) { checks.push({ id, state: 'PASS', at: new Date().toISOString(), detail }); console.log('PASS', id); }
async function documentNavigation(url) {
  const previous = await evaluate('window.__planningDocumentId');
  const navigation = await cdp(url ? 'Page.navigate' : 'Page.reload', url ? { url } : {});
  assert.ok(!navigation.errorText, JSON.stringify(navigation));
  await until(() => evaluate(`!!window.__planningDocumentId&&window.__planningDocumentId!==${JSON.stringify(previous) || 'undefined'}`), 'new actual document instrumentation');
}
async function navigate(order, query = '') { await documentNavigation(`${origin}/portfolio/manufacturing/plan/${order._id}${query}`); }
async function selectOrder(order) {
  await click('a[href="/portfolio/manufacturing/plan"]');
  await until(() => evaluate(`document.querySelector('h1')?.textContent==='Select sales order to plan'`), 'real SO selection route');
  await click(`a[href="/portfolio/manufacturing/plan/${order._id}"]`);
  await until(() => evaluate(`location.pathname.endsWith(${JSON.stringify(order._id)})`), 'selected SO route');
}
async function login(username) {
  await cdp('Network.clearBrowserCookies');
  await documentNavigation(`${origin}/portfolio/manufacturing/plan`);
  await until(() => evaluate(`location.pathname==='/portfolio/login'&&!!document.querySelector('[name=username]')`), 'actual app login');
  await fill('username', username); await fill('password', password); await click('form button');
  await until(() => evaluate(`location.pathname==='/portfolio/manufacturing/plan'&&document.querySelector('h1')?.textContent==='Select sales order to plan'`), 'genuine cookie session');
}
async function http(username, path, body, expected) {
  const response = await fetch(`${apiOrigin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookies.has(username) ? { cookie: cookies.get(username) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (path === '/api/session/login') cookies.set(username, response.headers.get('set-cookie').split(';')[0]);
  const value = await response.json();
  if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify({ path, value }));
  else assert.ok(response.ok, JSON.stringify({ path, status: response.status, value }));
  return { status: response.status, value };
}
async function forward(req, res, next) {
  const url = new URL(req.url, origin);
  if (!url.pathname.startsWith('/portfolio-api/')) return next();
  const path = url.pathname.replace('/portfolio-api', '') + url.search;
  const record = { proxyId: `response-${proxyRecords.length + 1}`, clientId: req.headers['x-planning-test-fetch'], signalAbortedAtDispatch: req.headers['x-planning-test-aborted'] === 'true', case: active, path, method: req.method, at: new Date().toISOString(), startedMs: performance.now() };
  proxyRecords.push(record);
  res.on('close', () => { if (!res.writableEnded) record.browserClosedBeforeResponse = true; });
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await fetch(apiOrigin + path, { method: req.method, headers: { ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}), ...(req.headers.origin ? { origin: req.headers.origin } : {}), ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const body = Buffer.from(await response.arrayBuffer());
    record.apiStatus = response.status; record.bytes = body.length;
    if (url.pathname === '/portfolio-api/api/manufacturing/work-orders' && req.method === 'POST' && response.ok) record.savedIds = JSON.parse(body).data.workOrders.map(x => x._id).sort();
    if (url.pathname === '/portfolio-api/api/manufacturing/work-orders' && req.method === 'GET') {
      const value = JSON.parse(body); record.cursor = url.searchParams.get('cursor'); record.ids = value.data?.map(x => x._id); record.nextCursor = value.page?.nextCursor;
      const rule = injection;
      if (rule && !rule.used && !record.signalAbortedAtDispatch && (rule.cursor === 'last' ? record.nextCursor === null : !!record.cursor)) {
        rule.used = true; record.injection = rule.kind; rule.record = record; rule.apiBody = body;
        injections.push({ case: active, kind: rule.kind, path, realApiStatus: response.status, source: 'Real API response boundary only; fixture and authorization remain actual.' });
        if (rule.kind === 'error') { res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-planning-evidence-response': record.proxyId }); res.end(JSON.stringify({ error: { code: 'PLANNING_TEST_PAGE_FAILURE', message: 'Injected later-page503 after genuine API response' } })); record.deliveredStatus = 503; return; }
        await new Promise(resolve => { rule.release = () => { heldResponses.delete(rule.release); resolve(); }; heldResponses.add(rule.release); });
        record.releasedAt = new Date().toISOString();
        if (rule.kind === 'hold-error' && !res.destroyed) { res.writeHead(503, { 'content-type': 'application/json', 'x-planning-evidence-response': record.proxyId }); res.end(JSON.stringify({ error: { code: 'PLANNING_TEST_LATE_FAILURE' } })); record.deliveredStatus = 503; return; }
      }
    }
    if (res.destroyed) { record.notDeliveredAfterCancellation = true; return; }
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store', 'x-planning-evidence-response': record.proxyId, ...(response.headers.getSetCookie().length ? { 'set-cookie': response.headers.getSetCookie() } : {}) });
    res.end(body); record.deliveredStatus = response.status; record.elapsedMs = performance.now() - record.startedMs;
  } catch (error) { record.error = String(error); if (!res.destroyed) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'PLANNING_PROXY_FAILURE' } })); } }
}

const instrumentation = `(()=>{
window.__planningDocumentId=crypto.randomUUID();
window.__planningEvidence={fetches:[],observations:[]};let sequence=0;
const original=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
 const path=new URL(String(input),location.href).pathname+new URL(String(input),location.href).search;
 const record={clientId:window.__planningDocumentId+':'+(++sequence),path,signal:!!options.signal,abortSignaled:!!options.signal?.aborted,signalAbortedAtStart:!!options.signal?.aborted,ignoreAbort:window.__planningIgnoreAbort===true};window.__planningEvidence.fetches.push(record);
 options.signal?.addEventListener('abort',()=>record.abortSignaled=true,{once:true});
 if(path.startsWith('/portfolio-api/api/manufacturing/work-orders?'))options={...options,headers:{...options.headers,'x-planning-test-fetch':record.clientId,'x-planning-test-aborted':String(record.signalAbortedAtStart)}};
 if(record.ignoreAbort){const {signal,...rest}=options;options=rest;}
 try{const response=await original(input,options);record.status=response.status;record.proxyId=response.headers.get('x-planning-evidence-response');const parse=response.json.bind(response);response.json=async()=>{const result=await parse();record.parsed=true;return result;};return response;}
 catch(error){record.errorName=error.name;throw error;}
};
new MutationObserver(()=>{const panel=${panelExpression};const list=window.__planningEvidence.observations;if(list.length<2000)list.push({route:location.pathname,rows:[...(panel?.querySelectorAll('li a')||[])].map(x=>x.getAttribute('href').split('/').at(-1)),loading:!!panel?.querySelector('[role=status]'),notice:[...document.querySelectorAll('section[role=status]')].map(x=>x.innerText)});}).observe(document,{childList:true,subtree:true,characterData:true});
})();`;

try {
  guard(true); measure('before-runtime');
  const webPort = await freePort(); origin = `http://127.0.0.1:${webPort}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, instanceOpts: [{ launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  runtime = await connectOwned({ ...process.env, PORTFOLIO_MONGO_URI: mongo.getUri(), PORTFOLIO_DB: database });
  await runtime.db.collection('ownedRun').insertOne({ _id: marker });
  const identities = await seedSynthetic(runtime, { password });
  independent = await new MongoClient(mongo.getUri()).connect();
  api = createApp(runtime, { origins: [origin] }).listen(0, '127.0.0.1'); await once(api, 'listening'); apiOrigin = `http://127.0.0.1:${api.address().port}`;
  for (const username of ['alpha.owner', 'beta.owner', 'alpha.viewer']) await http(username, '/api/session/login', { username, password });
  fixture = await orderPlanningFixture({ db: independent.db(database), identities, request: async (username, path, body) => (await http(username, path, body)).value.data });
  const pages = []; let cursor = null;
  do { const { value } = await http('alpha.owner', `/api/manufacturing/work-orders?limit=100${cursor ? `&cursor=${cursor}` : ''}`); pages.push({ cursor, ids: value.data.map(x => x._id), nextCursor: value.page.nextCursor }); cursor = value.page.nextCursor; } while (cursor);
  const later = await oracle(fixture.orders.later), spread = await oracle(fixture.orders.spread);
  assert.equal(pages[0].ids.length, 100); assert.ok(pages[0].ids.every(id => ![...later, ...spread].some(x => x._id === id)));
  assert.equal(pages.length, 3); assert.ok(pages[1].ids.includes(later[0]._id)); assert.ok(pages[1].ids.includes(spread[0]._id)); assert.ok(pages[2].ids.includes(spread[1]._id) && pages[2].ids.includes(spread[2]._id));
  await report('fixture-oracle.json', { ...fixture, pages, later, spread, setupIsOperatorAction: false });
  vite = await createServer({ root, define: { 'import.meta.env.VITE_PORTFOLIO_API_BASE': JSON.stringify('/portfolio-api') }, server: { host: '127.0.0.1', port: webPort, strictPort: true }, plugins: [{
    name: 'planning-real-api-fault-boundary', enforce: 'pre', configureServer(server) { server.middlewares.use(forward); },
    transform(code, id) {
      if (!negativeControl || id.replaceAll('\\', '/').split('?')[0] !== sourcePath.replaceAll('\\', '/')) return;
      const needle = "useResource('/api/manufacturing/work-orders?limit=100', true)";
      assert.equal(code.split(needle).length, 2, 'Negative control must mutate precisely the accepted PlannedForOrder call');
      return { code: code.replace(needle, "useResource('/api/manufacturing/work-orders?limit=100')"), map: null };
    },
  }] });
  await vite.listen();
  profile = await mkdtemp(join(tmpdir(), 'iems-planning-e2e-profile-'));
  chrome = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', launchError, endpoint; chrome.stderr.on('data', bytes => { stderr += bytes; }); chrome.once('error', error => { launchError = error; });
  await until(async () => { if (launchError) throw launchError; assert.equal(chrome.exitCode, null, stderr.slice(-2000)); endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]; if (!endpoint) { try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); endpoint = `ws://127.0.0.1:${port}${path}`; } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; } } return !!endpoint; }, 'owned browser endpoint');
  ws = new WebSocket(endpoint); await once(ws, 'open');
  const wire = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); if (p) { pending.delete(message.id); message.error ? p.reject(Object.assign(Error(message.error.message), { code: message.error.code })) : p.resolve(message.result); } }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') wire.set(message.params.requestId, { url: message.params.request.url, method: message.params.request.method });
    if (message.method === 'Network.loadingFailed') networkFailures.push({ case: active, ...wire.get(message.params.requestId), requestId: message.params.requestId, ...message.params });
  });
  const target = await cdp('Target.createTarget', { url: 'about:blank' }, null); session = (await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Performance.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await report('resources-start.json', { marker, database, profile, ownerPid: process.pid, ownerStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), browserPid: chrome.pid, browserStartedAt: new Date().toISOString(), origin, apiOrigin, binary, version: await cdp('Browser.getVersion', {}, null), sourceHash, fixtureCount: fixture.fixtureCount });

  active = 'OP-01'; await login('alpha.owner');
  const me = await http('alpha.owner', '/api/session/me'); assert.ok(me.value.data.permissions.includes('manufacturing.plan'));
  await click(`a[href="/portfolio/manufacturing/plan/${fixture.orders.operator._id}"]`); await assertRows(fixture.orders.operator);
  await fill('quantities', '0.750\n1.250');
  await evaluate("document.querySelector('[name=installationRequired]').focus()"); await key('Tab', 'Tab', 9);
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Plan work orders');
  assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
  await cdp('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(() => evaluate("document.body.innerText.includes('Planned 2 work orders')"), 'native keyboard command saved');
  const created = await oracle(fixture.orders.operator);
  assert.deepEqual(created.map(x => x.quantity).sort(), ['0.75', '1.25']);
  const actor = identities.find(x => x.username === 'alpha.owner');
  assert.ok(created.every(x => x.createdBy === actor.userId && x.tenantId === actor.tenantId && x.plantId === actor.plantId && x.accountId === fixture.orders.operator.accountId && x.salesOrderVersion === fixture.orders.operator.version && x.lineIndex === 0 && x.status === 'PLANNED' && x.uom === 'EA'));
  const db = independent.db(database);
  assert.equal((await db.collection('manufacturingAllocated').findOne({ salesOrderId: fixture.orders.operator._id })).quantity, '2');
  assert.equal(await db.collection('manufacturingAudit').countDocuments({ kind: 'workOrders.planned' }), 1);
  assert.equal(await db.collection('manufacturingOutbox').countDocuments({ kind: 'workOrders.planned', state: 'PENDING' }), 1);
  assert.equal(await db.collection('manufacturingKeys').countDocuments({}), 1);
  await assertRows(fixture.orders.operator); await evaluate("document.querySelector('section[role=status]').scrollIntoView({block:'start'})"); await shot('01-created-desktop');
  const committedResponse = proxyRecords.find(x => x.case === 'OP-01' && x.method === 'POST' && x.savedIds);
  assert.equal(committedResponse.apiStatus, 201); assert.deepEqual(committedResponse.savedIds, created.map(x => x._id));
  const beforeReload = proxyRecords.length;
  await documentNavigation(); await assertRows(fixture.orders.operator);
  assert.ok(proxyRecords.slice(beforeReload).filter(x => x.ids).length >= 3, 'Reload must produce a fresh full HTTP traversal');
  await selectOrder(fixture.orders.later); const switched = await assertRows(fixture.orders.later); assert.deepEqual(switched.actual.notice, []);
  pass('OP-01', { created, allocation: '2', reloadPersisted: true, nativeKeyboard: true, genuineSession: true, previousCreationNoticeAbsentOnOtherOrder: true });

  active = 'OP-02'; const start = proxyRecords.length, started = performance.now();
  await navigate(fixture.orders.later); const actualLater = await assertRows(fixture.orders.later);
  const laterRequests = proxyRecords.slice(start).filter(x => x.ids), laterPages = await completedTraversal(laterRequests);
  assert.deepEqual(laterPages.map(x => x.cursor), pages.map(x => x.cursor));
  assert.equal(laterPages[0].ids.length, 100); assert.ok(!laterPages[0].ids.includes(later[0]._id));
  await shot('02-later-page-desktop');
  pass('OP-02', { rows: actualLater.actual.rows, pages: laterPages, actualListRequests: laterRequests.length, completedPageReads: laterPages.length, durationMs: performance.now() - started, realApi: true });

  active = 'OP-03'; const multiStart = performance.now(), multiIndex = proxyRecords.length; measure('before-spread');
  await navigate(fixture.orders.spread); const all = await assertRows(fixture.orders.spread); measure('after-spread');
  const multiRequests = proxyRecords.slice(multiIndex).filter(x => x.ids), multiPages = await completedTraversal(multiRequests);
  assert.equal(multiPages.length, 3); assert.equal(multiPages.reduce((n, x) => n + x.ids.length, 0), 223);
  await shot('03-spread-desktop');
  pass('OP-03', { expectedIds: all.expected.map(x => x._id), rows: all.actual.rows, requestCount: multiRequests.length, completedPageReads: multiPages.length, completedRecords: 223, observedApiRecordsIncludingCanceled: multiRequests.reduce((n,x)=>n+x.ids.length,0), durationMs: performance.now() - multiStart, pages: multiPages, browserMetrics: await cdp('Performance.getMetrics') });

  active = 'OP-04'; injection = { kind: 'hold', cursor: 'last' };
  await navigate(fixture.orders.empty); await until(() => !!injection.release, 'actual final page held');
  const pendingEmpty = await state(); assert.ok(pendingEmpty.loading); assert.equal(pendingEmpty.rows.length, 0); assert.ok(!pendingEmpty.panel.includes('None planned yet.'));
  await shot('04-empty-pending-desktop'); injection.release(); await assertRows(fixture.orders.empty);
  assert.ok((await state()).panel.includes('None planned yet.')); await shot('04-empty-complete-desktop');
  injection = null; pass('OP-04', { finalPageHeldLoading: pendingEmpty, emptyOnlyAfterTraversal: true });

  active = 'OP-05'; const failureStart = proxyRecords.length; injection = { kind: 'error', cursor: 'last' };
  await navigate(fixture.orders.spread); await until(async () => !!(await state()).error, 'injected real later-page503 visible');
  const beforeFailedPage = await completedTraversal(proxyRecords.slice(failureStart).filter(x => x.ids));
  assert.ok(beforeFailedPage.some(x => x.ids.includes(spread[0]._id)), 'A matching target must already have been received before the final-page failure');
  assert.equal(injection.record.cursor, pages[1].nextCursor);
  const errored = await state(); assert.equal(errored.rows.length, 0); assert.ok(!errored.panel.includes('None planned yet.')); assert.ok(errored.error.includes('Refresh and retry'));
  await shot('05-later-page-error-desktop'); const failedCursor = injection.record.cursor; injection = null;
  await click('section .pf-error button'); await assertRows(fixture.orders.spread);
  pass('OP-05', { injectedResponseBoundary: true, upstreamStatus: 200, deliveredStatus: 503, previouslyReceivedTarget: spread[0]._id, consumedPagesBeforeFailure: beforeFailedPage, failedCursor, partialTargetRowsHidden: true, error: errored.error, freshRetryComplete: true });

  for (const mode of ['cancellation', 'stale-response', 'stale-error']) {
    const ignoreAbort = mode !== 'cancellation';
    active = `OP-06-${mode}`; injection = { kind: 'hold' };
    await navigate(fixture.orders.spread); await until(() => !!injection.release, 'old real page response held');
    const rule = injection;
    // First scenario retains the native AbortSignal. Second scenario explicitly removes it only from future test requests.
    if (ignoreAbort) {
      rule.release(); await assertRows(fixture.orders.spread); injection = { kind: mode === 'stale-error' ? 'hold-error' : 'hold' };
      await evaluate('window.__planningIgnoreAbort=true');
      await selectOrder(fixture.orders.spread); await until(() => !!injection.release, 'noncooperative actual response held');
    }
    const held = injection; injection = null;
    await selectOrder(fixture.orders.later); await assertRows(fixture.orders.later);
    if (!ignoreAbort) await until(() => held.record.browserClosedBeforeResponse === true, 'actual aborted old browser request');
    held.release();
    if (ignoreAbort) await until(() => evaluate(`window.__planningEvidence.fetches.some(x=>x.proxyId===${JSON.stringify(held.record.proxyId)}&&x.clientId===${JSON.stringify(held.record.clientId)}&&x.ignoreAbort&&x.abortSignaled&&!x.signalAbortedAtStart&&x.parsed&&x.status===${mode === 'stale-error' ? 503 : 200})`), 'exact current-generation request aborted by navigation and late body actually parsed');
    const unchanged = await assertRows(fixture.orders.later);
    const observed = await evaluate('window.__planningEvidence');
    const lateRoute = observed.observations.filter(x => x.route.endsWith(fixture.orders.later._id));
    assert.ok(lateRoute.length); assert.ok(lateRoute.every(x => x.rows.every(id => later.some(wo => wo._id === id))));
    assert.deepEqual(unchanged.actual.notice, []);
    await report(`${active}.json`, { ignoreAbortAdapter: ignoreAbort, heldRecord: held.record, unchanged: unchanged.actual, observed });
    pass(active, { ignoreAbortAdapter: ignoreAbort, actualRequestCanceled: !!held.record.browserClosedBeforeResponse, lateBodyParsed: ignoreAbort, noOldRowsInNewRouteObservations: true });
  }
  pass('OP-06', { nativeAbortAndNoncooperativeLateRealResponse: true, productionPathKeyRemount: true });

  active = 'OP-07';
  const alpha = identities.find(x => x.username === 'alpha.owner'), beta = identities.find(x => x.username === 'beta.owner');
  const beforeDenied = await db.collection('manufacturingWorkOrders').countDocuments({});
  const betaList = await http('beta.owner', '/api/manufacturing/work-orders?limit=100');
  assert.deepEqual(betaList.value.data.map(x => x.salesOrderId), [fixture.orders.beta._id]);
  await http('beta.owner', `/api/manufacturing/work-orders/${later[0]._id}`, undefined, 404);
  await http('beta.owner', `/api/commercial/orders/${fixture.orders.later._id}`, undefined, 404);
  await http('alpha.owner', `/api/manufacturing/work-orders?plantId=${beta.plantId}`, undefined, 403);
  await http('alpha.owner', `/api/manufacturing/work-orders?limit=100&cursor=${pages[0].nextCursor}&plantId=${beta.plantId}`, undefined, 403);
  const scopedCursor = await http('beta.owner', `/api/manufacturing/work-orders?limit=100&cursor=${pages[0].nextCursor}`);
  assert.ok(scopedCursor.value.data.every(x => x.tenantId === beta.tenantId && x.plantId === beta.plantId));
  await http('alpha.owner', '/api/manufacturing/work-orders', { plantId: beta.plantId, salesOrderId: fixture.orders.operator._id, expectedVersion: fixture.orders.operator.version, lineIndex: 0, quantities: ['1'], uom: 'EA', idempotencyKey: randomUUID() }, 403);
  await http('beta.owner', '/api/manufacturing/work-orders', { salesOrderId: fixture.orders.later._id, expectedVersion: fixture.orders.later.version, lineIndex: 0, quantities: ['1'], uom: 'EA', idempotencyKey: randomUUID() }, 404);
  await http('alpha.viewer', '/api/manufacturing/work-orders', { salesOrderId: fixture.orders.operator._id, expectedVersion: fixture.orders.operator.version, lineIndex: 0, quantities: ['1'], uom: 'EA', idempotencyKey: randomUUID() }, 403);
  assert.equal(await db.collection('manufacturingWorkOrders').countDocuments({}), beforeDenied);
  await login('beta.owner'); await navigate(fixture.orders.later);
  await until(() => evaluate("!!document.querySelector('main [role=alert]')"), 'forbidden actual UI deep link');
  const denied = await state(); assert.equal(denied.rows.length, 0); assert.ok(!denied.body.includes(fixture.orders.later.orderNumber)); assert.ok(!denied.body.includes('7.125'));
  await shot('07-forbidden-desktop'); await login('alpha.owner');
  pass('OP-07', { tenantScope: [alpha.tenantId, beta.tenantId], selectedPlantDenial: 403, otherTenantReadAndWrite: 404, readOnlyWrite: 403, noDbEffects: true, forbiddenUiNoLeak: true });

  active = 'OP-08'; const layouts = [];
  for (const [name, width, mobile, kiosk] of [['desktop', 1280, false, false], ['mobile', 375, true, false], ['kiosk', 768, true, true]]) {
    guard(); await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await navigate(fixture.orders.spread, kiosk ? '?kiosk=1' : ''); await assertRows(fixture.orders.spread);
    const layout = await evaluate(`(()=>{const p=${panelExpression},f=document.querySelector('form[aria-label="Plan work orders"]');return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,kiosk:document.querySelector('.portfolio-root').dataset.kiosk,panelWidth:p.getBoundingClientRect().width,smallControls:[...f.querySelectorAll('button,input,select,textarea')].filter(x=>x.getBoundingClientRect().height<43.9).map(x=>x.name||x.textContent),rowBounds:[...p.querySelectorAll('li')].map(x=>({width:x.getBoundingClientRect().width,scrollWidth:x.scrollWidth,clientWidth:x.clientWidth,fontSize:parseFloat(getComputedStyle(x).fontSize)}))}})()`);
    assert.ok(layout.scrollWidth <= width + 1); assert.deepEqual(layout.smallControls, []); assert.equal(layout.kiosk, String(kiosk));
    assert.ok(layout.rowBounds.every(x => x.scrollWidth <= x.clientWidth + 1 && x.fontSize >= 14));
    await evaluate(`(${panelExpression}).scrollIntoView({block:'start'})`); await shot(`08-${name}-results`);
    injection = { kind: 'error' }; await documentNavigation(); await until(async () => !!(await state()).error, `${name} error readable`);
    await evaluate(`(${panelExpression}).scrollIntoView({block:'start'})`); await shot(`08-${name}-error`);
    injection = null; await click('section .pf-error button'); await assertRows(fixture.orders.spread);
    injection = { kind: 'hold', cursor: 'last' }; await navigate(fixture.orders.empty, kiosk ? '?kiosk=1' : ''); await until(() => !!injection.release, `${name} loading`);
    assert.ok((await state()).loading); await evaluate(`(${panelExpression}).scrollIntoView({block:'start'})`); await shot(`08-${name}-loading`);
    injection.release(); injection = null; await assertRows(fixture.orders.empty); await shot(`08-${name}-empty`);
    await navigate(fixture.orders.operator, kiosk ? '?kiosk=1' : ''); await assertRows(fixture.orders.operator);
    await fill('quantities', '0.125'); await evaluate("document.querySelector('[name=installationRequired]').focus()"); await key('Tab', 'Tab', 9);
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Plan work orders');
    assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
    layout.keyboardSubmitFocus = true; layouts.push({ name, ...layout });
  }
  pass('OP-08', { layouts, keyboardEnterWrite: 'OP-01', physicalKiosk: 'NOT_TESTED; emulated viewport only' });

  active = 'negative-control'; negativeControl = true; vite.moduleGraph.invalidateAll();
  await navigate(fixture.orders.later); await waitPanel();
  const negative = { mutation: 'Only served PlannedForOrder allPages=true removed; disk/ref unchanged.', setupComplete: true, assertions: [] };
  for (const [id, order] of [['OP-02', fixture.orders.later], ['OP-03', fixture.orders.spread]]) {
    await navigate(order); await waitPanel(); let caught;
    try { await assertRows(order); } catch (error) { caught = error; }
    assert.ok(caught instanceof assert.AssertionError, `${id} negative control must fail exact identity assertion, not setup`);
    assert.match(caught.message, /OP exact WO identities/);
    const observed = await state(); assert.equal(observed.rows.length, 0); assert.ok(observed.panel.includes('None planned yet.'));
    negative.assertions.push({ id, expectedFailure: caught.message, observed, expectedIds: (await oracle(order)).map(x => x._id) });
  }
  await shot('09-negative-first-page-only'); await report('negative-control.json', negative);
  pass('negative-control', { actualApi: true, bothAssertions: negative.assertions.map(x => x.id), firstPageOnlyDetected: true });
  assert.equal(createHash('sha256').update(await readFile(sourcePath)).digest('hex'), sourceHash);
  assert.deepEqual(exceptions, []);
  const unexpected = networkFailures.filter(x => !x.canceled && !['net::ERR_ABORTED'].includes(x.errorText));
  assert.deepEqual(unexpected, []);
  const failedProxy = proxyRecords.filter(x => x.error); assert.deepEqual(failedProxy, []);
  assert.deepEqual(proxyRecords.filter(x => x.apiStatus >= 500), [], 'Unexpected actual backend failures must fail acceptance; injected statuses are recorded separately');
  const finalDb = await oracle(fixture.orders.operator); assert.deepEqual(finalDb, created);
  await report('database-oracle-final.json', { operator: finalDb, allWoCount: await db.collection('manufacturingWorkOrders').countDocuments({}), allocated: await db.collection('manufacturingAllocated').find({}).toArray(), unchangedOperatorAfterDeniedAndOtherJourneys: true });
} catch (error) {
  failure = { case: active, message: error.message, stack: error.stack }; console.error(error.stack); process.exitCode = 1;
  if (ws?.readyState === WebSocket.OPEN && session) { try { await shot('failure'); await report('failure-dom.json', await state()); } catch {} }
} finally {
  for (const release of heldResponses) release();
  const attempt = async (name, effect) => { try { await effect(); cleanup[name] = true; } catch (error) { cleanup[name] = String(error); process.exitCode = 1; } };
  await attempt('browserExited', async () => {
    if (ws?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close', {}, null); } catch {} ws.close(); }
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      await Promise.race([once(chrome, 'exit'), pause(5000)]);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await Promise.race([once(chrome, 'exit'), pause(5000)]); }
      assert.ok(chrome.exitCode !== null || chrome.signalCode !== null, 'Owned browser failed to exit');
    }
  });
  await attempt('viteClosed', async () => { if (vite) await vite.close(); assert.ok(!vite?.httpServer?.listening); });
  await attempt('apiClosed', async () => { if (api) await new Promise((resolve, reject) => api.close(error => error ? reject(error) : resolve())); });
  await attempt('independentClosed', async () => { await independent?.close(); });
  await attempt('ownedDatabaseDropped', async () => { if (runtime) { assert.ok(await runtime.db.collection('ownedRun').findOne({ _id: marker }), 'Refuse cleanup without exact marker'); await runtime.db.dropDatabase(); } });
  await attempt('runtimeClosed', async () => { await runtime?.client.close(); });
  await attempt('mongoStopped', async () => { await mongo?.stop(); });
  await attempt('profileRemoved', async () => { if (profile) { const actual = await realpath(profile), parent = await realpath(tmpdir()); assert.ok(actual.startsWith(parent + sep) && actual.includes('iems-planning-e2e-profile-')); await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } });
  measure('after-cleanup');
  await report('results.json', { at: new Date().toISOString(), realBackend: true, mockedApi: false, api: 'Actual createApp/current foundation auth and schema initialization', ui: 'Actual index/App/createBrowserRouter/PortfolioWorkspace keyed routes and production components', sourceHash,
    injectedCases: injections, fixtureSetup: fixture?.setup, sourceMutationOnlyDuringNegativeControl: negativeControl, checks, pass: checks.length, fail: failure ? 1 : 0, failure: failure || null, captures, proxyRecords, networkFailures, exceptions, measurements, cleanup,
    limitations: ['Synthetic direct-DB preread WO setup, explicitly not operator writes', 'Delayed/error response boundary fault injection; noncooperative-fetch adapter is labeled', 'Sequential cursor reads have no concurrent-write snapshot guarantee', 'Dataset-scale observations only; no large-plant/physical kiosk/deployed backend claim'], resourceIdentity: { ownerPid: process.pid, browserPid: chrome?.pid, profile, database, origin, apiOrigin } });
  console.log(`ORDER_PLANNING_E2E ${failure || Object.values(cleanup).some(x => x !== true) ? 'FAIL' : 'PASS'} checks=${checks.length} evidence=${evidence}`);
}
