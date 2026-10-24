import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from '../../portfolio-api/node_modules/mongodb-memory-server/index.js';
import { MongoClient } from '../../portfolio-api/node_modules/mongodb/lib/index.js';
import { connectOwned } from '../../portfolio-api/src/config.mjs';
import { createApp } from '../../portfolio-api/src/app.mjs';
import { initializeCustomerService } from '../../portfolio-api/src/customer-service.mjs';
import { orderInquiry } from './portfolio-service-browser.mjs';
import { createServer } from 'vite';
import { procurementJourney } from './portfolio-procurement-browser.mjs';
import { warehouseJourney } from './portfolio-warehouse-browser.mjs';
import { wmsJourney } from './portfolio-wave4b-wms-browser.mjs';
import { engineeringJourney } from './portfolio-wave4c-engineering-browser.mjs';
import { laborJourney } from './portfolio-wave4d-labor-browser.mjs';
import { manufacturingJourney } from './portfolio-manufacturing-browser.mjs';
import { fulfillmentJourney } from './portfolio-fulfillment-browser.mjs';
import { serviceJourney } from './portfolio-service-browser.mjs';
import { paginationJourney } from './portfolio-pagination-browser.mjs';
import { repairJourney } from './portfolio-repair-browser.mjs';
import { documentJourney } from './portfolio-wave3e-documents-browser.mjs';
import { vatJourney } from './portfolio-wave4h-vat-browser.mjs';
import { inquiryJourney } from './portfolio-wave4i-inquiry-browser.mjs';
import { lotSerialJourney } from './portfolio-wave4j-lot-serial-browser.mjs';
import { genealogyJourney } from './portfolio-wave4k-genealogy-browser.mjs';
import { serialCustodyJourney } from './portfolio-wave4k2a-serial-custody-browser.mjs';
import { installationJourney } from './portfolio-wave4k2b1-installation-browser.mjs';
import { quoteEditorInquiryJourney } from './portfolio-wave4j-pr4-browser.mjs';
import { responseLoss } from './portfolio-wave3d-transport.mjs';
import { holdJourney } from './wave4f-holds-browser.mjs';
import { csOnboardingJourney } from './wave4f-cs-browser.mjs';
import { textEnlargementJourney } from './wave4f-text-browser.mjs';

// The owned Vite server needs a port free on both loopback stacks: another project may hold 127.0.0.1:4173,
// and Chrome may resolve localhost to either address. Probe, never kill.
const freeOn = (host, port) => new Promise(r => { const s = createNetServer(); s.once('error', () => r(false)); s.listen(port, host, () => s.close(() => r(true))); });
async function pickWebPort() { for (let p = 4173; p < 4273; p++) if (await freeOn('127.0.0.1', p) && await freeOn('::1', p)) return p; throw Error('No loopback port in 4173..4272 is free on both 127.0.0.1 and ::1'); }
const webPort = await pickWebPort(), web = `http://localhost:${webPort}`;
process.env.PORTFOLIO_WEB_ORIGIN = web;
console.log('Owned web origin', web);

const root = resolve(import.meta.dirname, '..');
const evidence = process.env.PORTFOLIO_EVIDENCE_DIR ? resolve(process.env.PORTFOLIO_EVIDENCE_DIR) : resolve(process.env.TMPDIR || tmpdir(), `portfolio-evidence-${randomUUID()}`);
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'portfolio-chrome-'));
const marker = randomUUID(), database = `portfolio_owned_browser_${marker.replaceAll('-', '')}`;
const password = randomUUID() + randomUUID();
const delay = ms => new Promise(r => setTimeout(r, ms));
let mongo, runtime, independent, api, vite, chrome, ws, session;
const pending = new Map(), exceptions = [], consoleErrors = [], network = [], checks = [], layouts = [];
const requests = new Map(), networkFailures = [];
const listeners = new Set();
const loseResponse = responseLoss({ call, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } });
let sequence = 0;
async function call(method, params = {}, sessionId = session) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 60000); pending.set(id, { resolve: x => { clearTimeout(timeout); resolve(x); }, reject: e => { clearTimeout(timeout); reject(e); } }); });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return result;
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
}
async function wait(expression, label = expression) {
  for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(document.body && (${expression}))`)) return; await delay(100); }
  throw Error(`Timed out: ${label}. Page: ${await evaluate('document.body.innerText')}`);
}
async function click(text) {
  await wait(`[...document.querySelectorAll('button,a')].some(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled)`);
  assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`));
}
async function fill(name, value) {
  await evaluate(`(()=>{const x=document.querySelector('[name="${name}"]');const p=x.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:x.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(x,${JSON.stringify(value)});x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function screenshot(name) { await call('Page.bringToFront'); await delay(150); const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64')); }
function check(name) { checks.push(name); console.log('PASS', name); }
try {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, instanceOpts: [{ launchTimeout: 60000 }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const env = { ...process.env, PORTFOLIO_MONGO_URI: mongo.getUri(), PORTFOLIO_DB: database, PORTFOLIO_SEED_PASSWORD: password };
  runtime = await connectOwned(env);
  runtime.customerService = await initializeCustomerService(runtime, { previewDispatcher: true });
  await runtime.db.collection('ownedRun').insertOne({ _id: marker });
  const seeded = spawnSync(process.execPath, [resolve(root, '../portfolio-api/src/seed-cli.mjs'), '--synthetic-owned'], { env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  const seededIdentities = JSON.parse(seeded.stdout).identities.map(i => i.username);
  assert.deepEqual(seededIdentities, ['alpha.owner', 'beta.owner', 'alpha.inspector', 'alpha.quality', 'alpha.viewer']);
  check('explicit synthetic seed CLI, fresh owned DB, real MongoDB 7.0.14 replica set');
  independent = new MongoClient(mongo.getUri()); await independent.connect();
  const db = independent.db(database);
  api = createApp(runtime, { origins: [web] }).listen(4313, '127.0.0.1');
  await new Promise((r, j) => { api.once('listening', r); api.once('error', j); });
  vite = await createServer({ root, server: { host: 'localhost', port: webPort, strictPort: true, fs: { allow: [resolve(root, '../..'), await realpath(join(root, 'node_modules'))] } } }); await vite.listen();
  chrome = spawn(process.env.PORTFOLIO_CHROME_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', launchError, endpoint;
  chrome.stderr.on('data', d => stderr += d);
  chrome.once('error', error => { launchError = error; });
  const startupDeadline = Date.now() + 60000;
  while (!endpoint && Date.now() < startupDeadline) {
    if (launchError) throw launchError;
    endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (!endpoint) {
      // The protocol also exposes readiness in this exclusively owned profile.
      try {
        const [port, route] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(route)) endpoint = `ws://127.0.0.1:${port}${route}`;
      } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; }
    }
    if (chrome.exitCode !== null || chrome.signalCode !== null) throw Error(`Owned Chrome exited before readiness (${chrome.exitCode}/${chrome.signalCode}): ${stderr.slice(-4000)}`);
    if (!endpoint) await delay(100);
  }
  assert.ok(endpoint, `owned Chrome endpoint not ready within 60s: ${stderr.slice(-4000)}`);
  ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    for (const listener of listeners) listener(m);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' ') + ' after ' + (network.at(-1)?.url.replace(/^.*\/api\//, '') || 'start'));
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/portfolio-api/')) network.push({ url: m.params.response.url, status: m.params.response.status });
    if (m.method === 'Network.requestWillBeSent') requests.set(m.params.requestId, { url:m.params.request.url, method:m.params.request.method });
    if (m.method === 'Network.loadingFailed') { networkFailures.push({ ...requests.get(m.params.requestId), errorText:m.params.errorText, canceled:m.params.canceled || false }); requests.delete(m.params.requestId); }
    if (m.method === 'Network.loadingFinished') requests.delete(m.params.requestId);
  };
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
  session = (await call('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `${web}/portfolio/accounts` });
  await wait(`document.querySelector('[name=username]')`);
  assert.equal(await evaluate('location.pathname'), '/portfolio/login');
  await screenshot('01-login');
  await fill('username', 'alpha.owner'); await fill('password', password); await click('Sign in');
  await wait(`document.querySelector('h1')?.textContent==='Accounts'`);
  check('mounted deep-link login, genuine credentialed cookie session');
  assert.equal(await evaluate(`document.cookie.includes('portfolio_session')`), false);
  assert.deepEqual(await evaluate(`({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})`), { local: [], session: [] });
  check('HttpOnly cookie not exposed; no localStorage/sessionStorage bearer or auth data');
  await fill('name', 'Synthetic browser account'); await click('Create account');
  await wait(`document.querySelector('h1')?.textContent==='Synthetic browser account'`);
  const accountId = await evaluate(`location.pathname.split('/').at(-1)`);
  assert.ok(await db.collection('accounts').findOne({ _id: accountId, name: 'Synthetic browser account' }));
  await fill('name', 'Synthetic browser contact'); await fill('email', 'synthetic-browser@example.invalid'); await click('Create contact');
  await wait(`document.body.innerText.includes('synthetic-browser@example.invalid')`);
  assert.equal(await db.collection('contacts').countDocuments({ accountId, email: 'synthetic-browser@example.invalid' }), 1);
  check('account and contact created by UI, independently verified Mongo relationships');
  // Scope the second name field by its form, using the native setter like a real text edit.
  await evaluate(`(()=>{const x=[...document.querySelectorAll('form')].find(f=>f.textContent.includes('Create opportunity for this account')).querySelector('[name=name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(x,'Synthetic browser opportunity');x.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await fill('amount', '9999999999999999999999999999.99'); await click('Create opportunity');
  await wait(`document.querySelector('h1')?.textContent==='Synthetic browser opportunity'`);
  const opportunityId = await evaluate(`location.pathname.split('/').at(-1)`);
  let row = await db.collection('opportunities').findOne({ _id: opportunityId });
  assert.equal(row.accountId, accountId); assert.equal(row.amount, '9999999999999999999999999999.99'); assert.equal(row.stage, 'NEW');
  await fill('stage', 'QUALIFIED'); await fill('reason', 'Synthetic qualification recorded in Chrome'); await click('Save stage');
  await wait(`document.body.innerText.includes('Stage: QUALIFIED')`);
  row = await db.collection('opportunities').findOne({ _id: opportunityId }); assert.equal(row.version, 2); assert.equal(row.history.length, 2);
  assert.equal(await db.collection('crmAudit').countDocuments({ subjectId: opportunityId }), 2);
  check('exact large money opportunity and stage/history/audit committed through actual API');
  const reloadOrigin = await evaluate('performance.timeOrigin'); await call('Page.reload'); await wait(`performance.timeOrigin!==${reloadOrigin} && document.body.innerText.includes('Stage: QUALIFIED')`);
  assert.ok(await evaluate(`document.body.innerText.includes('Synthetic qualification recorded in Chrome')`));
  await screenshot('02-opportunity-desktop');
  check('reload restores persisted opportunity/history via mounted deep link');
  // A second real API writer commits while the browser retains version 2.
  const cookie = (await call('Network.getCookies', { urls: [web] })).cookies.find(c => c.name === 'portfolio_session');
  assert.ok(cookie.httpOnly); assert.equal(cookie.sameSite, 'Lax');
  const headers = { origin: web, 'content-type': 'application/json', cookie: `portfolio_session=${cookie.value}` };
  const concurrent = await fetch(`http://127.0.0.1:4313/api/crm/opportunities/${opportunityId}/stage`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: 2, stage: 'QUOTING', reason: 'Synthetic independent API writer' }) }); assert.equal(concurrent.status, 200);
  await fill('stage', 'WON'); await fill('reason', 'Synthetic stale browser attempt'); await click('Save stage');
  await wait(`document.body.innerText.includes('Refresh the record')`);
  assert.equal(await db.collection('opportunities').findOne({ _id: opportunityId }).then(r => r.history.length), 3);
  await screenshot('03-conflict'); await click('Refresh and retry'); await wait(`document.body.innerText.includes('Stage: QUOTING')`);
  await fill('stage', 'WON'); await fill('reason', 'Synthetic reviewed current-version retry'); await click('Save stage');
  await wait(`document.body.innerText.includes('Stage: WON')`);
  row = await db.collection('opportunities').findOne({ _id: opportunityId }); assert.equal(row.version, 4); assert.equal(row.history.length, 4);
  check('real concurrent writer 409, no duplicate history, explicit refresh/current-version retry, terminal closure');
  await click('Quotes'); await wait(`document.querySelector('h1')?.textContent==='Quotes'`);
  await click('Create quote'); await wait(`document.querySelector('[name=accountId]')`);
  await call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  for (const width of [360,768,1280]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await screenshot(`09-quote-form-${width}`);
  }
  await fill('accountId', accountId); await fill('expiresAt', '2027-12-31T00:00:00.000Z');
  await fill('description0', ' Exact browser item '); await fill('quantity0', '1.250'); await fill('uom0', 'EA'); await fill('unitPrice0', '9999999999999999999999999999.99');
  await click('Save quote'); await wait(`document.body.innerText.includes('Status: DRAFT')`);
  const quoteId = await evaluate(`location.pathname.split('/').at(-1)`);
  let quote = await db.collection('quotes').findOne({_id:quoteId});
  assert.equal(quote.revisions[0].lines[0].quantity, '1.250');
  assert.equal(quote.revisions[0].lines[0].unitPrice, '9999999999999999999999999999.99');
  await click('Approve revision'); await wait(`document.body.innerText.includes('Status: APPROVED')`);
  await fill('expiresAt', '2027-12-31T00:00:00.000Z'); await fill('description0', ' Revised exact browser item '); await fill('quantity0', '2.500'); await fill('uom0', 'EA'); await fill('unitPrice0', '100.01');
  await click('Save revision'); await wait(`document.body.innerText.includes('Revision: 2')`);
  const competing = await fetch(`http://127.0.0.1:4313/api/commercial/quotes/${quoteId}/approve`, {method:'POST',headers,body:JSON.stringify({expectedVersion:3,revision:2})}); assert.equal(competing.status,200);
  await click('Approve revision'); await wait(`document.body.innerText.includes('Refresh the record')`);
  await screenshot('09-quote-conflict'); await click('Refresh and retry'); await wait(`document.body.innerText.includes('Status: APPROVED')`);
  await click('Record acceptance'); await wait(`document.body.innerText.includes('Status: ACCEPTED')`);
  await click('Convert to sales order'); await wait(`document.body.innerText.includes('Sales order snapshot')`);
  await wait(`document.querySelector('[data-order-id]')`);
  const orderId = await evaluate(`document.querySelector('[data-order-id]').dataset.orderId`);
  const order = await db.collection('salesOrders').findOne({_id:orderId});
  quote = await db.collection('quotes').findOne({_id:quoteId});
  assert.equal(quote.status,'CONVERTED'); assert.equal(quote.orderId,orderId); assert.equal(order.quoteRevision,2);
  assert.deepEqual(order.snapshot,quote.approvals.at(-1).snapshot);
  assert.equal(order.snapshot.lines[0].quantity,'2.500'); assert.equal(order.snapshot.total,'250.03');
  assert.equal(await db.collection('salesOrders').countDocuments({quoteId}),1);
  assert.equal(await db.collection('quoteConversions').countDocuments({quoteId}),1);
  const conversion = await db.collection('quoteConversions').findOne({quoteId});
  const auditCount = await db.collection('commercialAudit').countDocuments({});
  const replay = await fetch(`http://127.0.0.1:4313/api/commercial/quotes/${quoteId}/convert`, {method:'POST',headers,body:JSON.stringify({expectedVersion:5,revision:2,idempotencyKey:conversion.key})});
  assert.equal(replay.status,200); assert.equal((await replay.json()).data._id,orderId);
  assert.equal(await db.collection('commercialAudit').countDocuments({}),auditCount);
  assert.deepEqual(quote.revisions[0].lines[0], {description:' Exact browser item ',quantity:'1.250',uom:'EA',unitPrice:'9999999999999999999999999999.99',currency:'USD'});
  assert.equal(await db.collection('commercialOutbox').countDocuments({}),1);
  await screenshot('10-sales-order-snapshot');
  await click('Open sales order'); await wait(`document.querySelector('h1')?.textContent==='Sales order'`);
  await wait(`document.body.innerText.includes('250.03')`); await screenshot('11-sales-order-detail');
  await click('Open source quote'); await wait(`document.body.innerText.includes('Status: CONVERTED')`);
  const commercialCredential = await db.collection('credentials').findOne({username:'alpha.owner'});
  const commercialMembership = await db.collection('memberships').findOne({userId:commercialCredential._id});
  await db.collection('memberships').updateOne({_id:commercialMembership._id},{$set:{roles:[]}});
  await click('Refresh record'); await wait(`document.body.innerText.includes('Access denied')`); await screenshot('12-quote-forbidden');
  await db.collection('memberships').updateOne({_id:commercialMembership._id},{$set:{roles:commercialMembership.roles}});
  await click('Refresh and retry'); await wait(`document.body.innerText.includes('Status: CONVERTED')`);
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await click('Refresh record'); await wait(`document.body.innerText.includes('Retry to load')`); await screenshot('13-quote-offline');
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await click('Refresh and retry'); await wait(`document.body.innerText.includes('Status: CONVERTED')`);
  check('real quote exact strings, immutable revision, real 409, approval/acceptance/conversion, independent Mongo SO snapshot/outbox and detail; commercial forbidden/offline recovery');
  await procurementJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers });
  await warehouseJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers });
  if (process.env.PORTFOLIO_SKIP_CS !== '1') await orderInquiry({db,runtime,headers,expected:'ACCEPTED'});
  await manufacturingJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers });
  if (process.env.PORTFOLIO_SKIP_CS !== '1') await orderInquiry({db,runtime,headers,expected:'READY_TO_SHIP'});
  await fulfillmentJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, network });
  if (process.env.PORTFOLIO_SKIP_CS !== '1') await serviceJourney({ db, runtime, call, wait, click, fill, evaluate, screenshot, check, headers });
  if (process.env.PORTFOLIO_PAGINATION === '1') await paginationJourney({ db, runtime, call, wait, click, fill, evaluate, screenshot, check, headers });
  if (process.env.PORTFOLIO_REPAIR === '1') await repairJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse, downloadPath: evidence });
  if (process.env.PORTFOLIO_DOCUMENTS === '1') await documentJourney({ db, call, wait, click, evaluate, screenshot, check, headers, loseResponse, downloadPath: evidence });
  if (process.env.PORTFOLIO_WMS === '1') await wmsJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_ENGINEERING === '1') await engineeringJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_LABOR === '1') await laborJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  // Wave 4f named scenarios (always run; contract wave4f-v1 section 3).
  const wave4f = { db, runtime, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse, password, web, listeners, exceptions };
  await holdJourney(wave4f);
  await csOnboardingJourney(wave4f);
  await textEnlargementJourney(wave4f);
  if (process.env.PORTFOLIO_VAT === '1') await vatJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, downloadPath: evidence });
  if (process.env.PORTFOLIO_INQUIRY === '1') await inquiryJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse, downloadPath: evidence });
  if (process.env.PORTFOLIO_LOT_SERIAL === '1') await lotSerialJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_LOT_SERIAL === '1') await quoteEditorInquiryJourney({ db, call, wait, fill, evaluate, check, headers });
  if (process.env.PORTFOLIO_GENEALOGY === '1') await genealogyJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_SERIAL_CUSTODY === '1') await serialCustodyJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_INSTALLATION === '1') await installationJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  await click('Opportunities'); await click('Synthetic browser opportunity'); await wait(`document.body.innerText.includes('Stage: WON')`);
  for (const width of [1440, 1280, 1100, 1024, 900, 768, 430, 375, 360]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 }); await wait(`innerWidth===${width}`);
    const measured = await evaluate(`(()=>{const root=document.querySelector('.portfolio-root');const controls=[...root.querySelectorAll('a,button,input,select,textarea')].filter(x=>x.getBoundingClientRect().height&&getComputedStyle(x).position!=='absolute');const small=controls.filter(x=>x.getBoundingClientRect().height<43.9).map(x=>x.textContent.trim());return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,small,columns:getComputedStyle(document.querySelector('.pf-columns')).gridTemplateColumns.split(' ').length,controls:controls.length}})()`);
    layouts.push(measured); assert.equal(measured.overflow, false); assert.deepEqual(measured.small, []); assert.ok(measured.controls > 5);
    if ([1440, 768, 375].includes(width)) await screenshot(`04-history-${width}`);
  }
  check('nine viewport real DOM measurements: zero horizontal overflow, zero controls below 44px');
  await click('Open related account'); await wait(`document.querySelector('h1')?.textContent==='Synthetic browser account'`);
  await screenshot('05-account-mobile');
  await evaluate(`document.querySelector('[name=name]').focus()`); await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.name'), 'email');
  const focus = await evaluate(`({style:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth})`); assert.equal(focus.style, 'solid');
  await fill('name', 'Synthetic keyboard contact'); await fill('email', 'synthetic-keyboard@example.invalid');
  await evaluate(`document.querySelector('[name=email]').focus()`); await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.textContent'), 'Create contact');
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`document.body.innerText.includes('synthetic-keyboard@example.invalid')`);
  assert.equal(await db.collection('contacts').countDocuments({ accountId }), 2);
  check('mobile keyboard Tab order, visible focus, Enter creates contact in Mongo');
  await click('Opportunities'); await wait(`document.querySelector('h1')?.textContent==='Opportunities'`); await click('Synthetic browser opportunity'); await wait(`document.body.innerText.includes('Stage: WON')`);
  const credential = await db.collection('credentials').findOne({ username: 'alpha.owner' });
  const membership = await db.collection('memberships').findOne({ userId: credential._id });
  await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } });
  await click('Refresh record'); await wait(`document.body.innerText.includes('Access denied')`);
  await screenshot('06-forbidden');
  await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } });
  await click('Refresh and retry'); await wait(`document.body.innerText.includes('Stage: WON')`);
  check('actual DB authorization denial renders forbidden; explicit retry restores record after permission recovery');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await click('Refresh record'); await wait(`document.body.innerText.includes('Retry to load')`);
  await screenshot('07-offline');
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await click('Refresh and retry'); await wait(`document.body.innerText.includes('Stage: WON')`);
  check('genuine browser offline failure and retry, no fetch replacement');
  await click('Sign out'); await wait(`document.querySelector('[name=username]')`);
  assert.equal(await db.collection('sessions').countDocuments({ revoked: true }), 1);
  const revoked = await fetch('http://127.0.0.1:4313/api/session/me', { headers }); assert.equal(revoked.status, 401);
  await call('Page.navigate', { url: `${web}/portfolio/opportunities/${opportunityId}` }); await wait(`document.querySelector('[name=username]')`);
  check('sign out revokes DB session; old cookie rejected; authenticated deep link protected');
  await fill('username', 'alpha.owner'); await fill('password', password); await click('Sign in');
  await wait(`document.body.innerText.includes('Stage: WON')`);
  await click('Quotes'); await click(quoteId); await wait(`document.body.innerText.includes('Status: CONVERTED')`);
  await db.collection('sessions').updateMany({ revoked: false }, { $set: { expiresAt: new Date(0) } });
  await click('Refresh record'); await wait(`document.body.innerText.includes('Your session expired')`);
  await screenshot('08-expired'); await click('Sign in again'); await wait(`document.querySelector('[name=username]')`);
  check('real expired Mongo session renders clear expiry and sign-in recovery');
  assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, []);
  assert.ok(network.some(n => n.status === 409)); assert.ok(network.some(n => n.status === 201)); assert.ok(network.some(n => n.status === 403));
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify({ realBrowser: true, api: 'actual portfolio-api createApp, unmodified', mongoVersion: '7.0.14', fixtureFetch: false, checks, layouts, exceptions, consoleErrors, network, databaseAssertions: { accountId, opportunityId, amount: row.amount, version: row.version, history: row.history.length }, cleanup: 'marker-verified disposable DB and owned processes only' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, exceptions: exceptions.length, consoleErrors: consoleErrors.length, evidence }));
} catch (error) {
  await writeFile(join(evidence, 'failure-diagnostics.json'), JSON.stringify({ error:String(error), checks, exceptions, consoleErrors, network, networkFailures }, null, 2));
  if (ws?.readyState === 1 && session) await screenshot('failure').catch(() => {});
  console.log(JSON.stringify({ exceptions, consoleErrors, network }));
  throw error;
} finally {
  if (ws?.readyState === 1) { try { await call('Browser.close', {}, null); } catch {} ws.close(); }
  if (chrome?.exitCode === null) chrome.kill();
  if (vite) await vite.close();
  if (api) await new Promise(r => api.close(r));
  if (independent) await independent.close();
  if (runtime) { assert.ok(await runtime.db.collection('ownedRun').findOne({ _id: marker })); await runtime.db.dropDatabase(); await runtime.client.close(); }
  if (mongo) await mongo.stop();
  await delay(500); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
