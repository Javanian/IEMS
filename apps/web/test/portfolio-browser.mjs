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
import { bindBusinessClock } from '../../portfolio-api/src/business-clock.mjs';
import { runE01Flow } from '../../portfolio-api/test/support/review-e01-flow.mjs';
import { navigationContextChanged,waitForTechnicalDetails,documentNavigationCall } from './browser-readiness.mjs';
import { runTraceHeadingBrowserRegression } from './portfolio-company-trace-heading-browser.mjs';
import { reviewRunPlan } from './portfolio-review-mode.mjs';
import { reviewOperatorJourney } from './portfolio-review-operator-browser.mjs';
import { reviewInternalExecutionJourney } from './portfolio-review-internal-execution-browser.mjs';
import { companyStockJourney } from './portfolio-company-stock-browser.mjs';
import { companyStockTraceJourney } from './portfolio-company-stock-trace-browser.mjs';
import { quoteCatalogJourney } from './portfolio-quote-catalog-browser.mjs';
import { purchasedFulfillmentJourney } from './portfolio-purchased-fulfillment-browser.mjs';
import { canonicalE01Journey } from './portfolio-review-e01-browser.mjs';
import { createApp,seedSynthetic } from '../../portfolio-api/src/app.mjs';
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
import { internalPlanningJourney } from './portfolio-wave4k2b2a-internal-planning-browser.mjs';
import { catalogJourney } from './portfolio-wave4map-catalog-browser.mjs';
import { catalogDispositionJourney } from './portfolio-wave4qc-catalog-disposition-browser.mjs';
import { quoteEditorInquiryJourney } from './portfolio-wave4j-pr4-browser.mjs';
import { responseLoss } from './portfolio-wave3d-transport.mjs';
import { observeTraceRead } from './company-trace-readiness.mjs';
import { observeOfflineQuoteRead,quoteRecoveryDOMState,isOfflineQuoteRoot,isRecoveredQuoteRoot,requireOwnedOnlineNetwork } from './quote-offline-readiness.mjs';
import { assertOwnedWebAddress,webTransportTelemetry } from './web-transport-telemetry.mjs';
import { holdJourney } from './wave4f-holds-browser.mjs';
import { csOnboardingJourney } from './wave4f-cs-browser.mjs';
import { textEnlargementJourney } from './wave4f-text-browser.mjs';

const freeOn = (host, port) => new Promise(r => { const s = createNetServer(); s.once('error', () => r(false)); s.listen(port, host, () => s.close(() => r(true))); });
async function pickWebPort() { for (let p = 4173; p < 4273; p++) if (await freeOn('127.0.0.1', p)) return p; throw Error('No IPv4 loopback port in 4173..4272 is free'); }
const reviewMode=reviewRunPlan(process.env);
const webPort = await pickWebPort(), web = `http://127.0.0.1:${webPort}`;
const transportTelemetry=webTransportTelemetry(web);
process.env.PORTFOLIO_WEB_ORIGIN = web;
console.log('Owned web origin', web);

const root = resolve(import.meta.dirname, '..'),uiRoot=process.env.PORTFOLIO_UI_ROOT ? resolve(process.env.PORTFOLIO_UI_ROOT) : root;
let seedIdentities=[];
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
let quoteRecoveryEvidence;
const loseResponse = responseLoss({ call, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } });
let sequence = 0;
async function sendCdp(method, params = {}, sessionId = session, timeoutMs = 60000) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, timeoutMs); pending.set(id, { resolve: x => { clearTimeout(timeout); resolve(x); }, reject: e => { clearTimeout(timeout); reject(e); } }); });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return result;
}
const sendWithNavigation=documentNavigationCall(sendCdp);
async function call(method,params={},sessionId=session) {
  const tracked=['Page.navigate','Page.reload','Network.emulateNetworkConditions'].includes(method);
  if(tracked)transportTelemetry.command('before',method,params);
  try {const result=await sendWithNavigation(method,params,sessionId);if(tracked)transportTelemetry.command('ack',method,params,result);return result;}
  catch(error){if(tracked)transportTelemetry.command('error',method,params,{errorText:String(error)});throw error;}
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
}
async function wait(expression, label = expression) {
  for (let i = 0; i < 300; i++) { try { if (await evaluate(`Boolean(document.body && (${expression}))`)) return; } catch(error) { if(!navigationContextChanged(error))throw error; } await delay(100); }
  throw Error(`Timed out: ${label}. Page: ${await evaluate('document.body.innerText')}`);
}
async function click(text) {
  const match=`(x.textContent.trim()===${JSON.stringify(text)}${/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text) ? `||(x.tagName==='A'&&new URL(x.href).pathname.split('/').at(-1)===${JSON.stringify(text)})` : ''})`;
  await wait(`[...document.querySelectorAll('button,a')].some(x=>${match}&&!x.disabled)`);
  assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>${match}&&!x.disabled);if(!b)return false;b.click();return true})()`));
}
async function fill(name, value) {
  await evaluate(`(()=>{const x=document.querySelector('[name="${name}"]');const p=x.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:x.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(x,${JSON.stringify(value)});x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function screenshot(name) { await call('Page.bringToFront'); await delay(150); const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64')); }
function check(name) { checks.push(name); console.log('PASS', name); }
async function runReviewJourneys({db,headers}) {
  const reviewKit={db,call,wait,click,fill,evaluate,screenshot,check,headers,loseResponse,password,web,seedIdentities,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},writeEvidence:(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2))};
  if(reviewMode.e01){
    const priorClock=runtime.businessClock,priorMode=runtime.businessClockMode;let instant=new Date('2026-03-10T08:15:00.000Z');
    await bindBusinessClock(runtime,()=>new Date(instant),marker);
    try { const canonical=await canonicalE01Journey({...reviewKit,setBusinessTime:value=>{const next=new Date(value);assert.ok(Number.isFinite(next.getTime())&&next>=instant,'Canonical business clock must be valid and monotonic');instant=next;}});reviewKit.canonicalShipmentIds=canonical.shipments.map(row=>row._id); }
    finally { if(priorClock===undefined)delete runtime.businessClock;else runtime.businessClock=priorClock;if(priorMode===undefined)delete runtime.businessClockMode;else runtime.businessClockMode=priorMode; }
  }
  if(reviewMode.internalExecution){const internal=await reviewInternalExecutionJourney(reviewKit);reviewKit.internalPlanId=internal.planId;}
  if(reviewMode.companyStock)await companyStockJourney(reviewKit);
  if(reviewMode.companyTrace)await companyStockTraceJourney(reviewKit);
  if(reviewMode.quoteCatalog)await quoteCatalogJourney(reviewKit);
  if(reviewMode.purchasedFulfillment)await purchasedFulfillmentJourney(reviewKit);
  if(reviewMode.operator)await reviewOperatorJourney(reviewKit);
}
async function runTextProbe({db,headers}) {
  const priorClock=runtime.businessClock,priorMode=runtime.businessClockMode;let instant=new Date('2026-03-10T08:15:00.000Z');
  await bindBusinessClock(runtime,()=>new Date(instant),marker);
  const login=async username=>{
    const response=await fetch('http://127.0.0.1:4313/api/session/login',{method:'POST',headers:{origin:web,'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
  };
  const req=async(path,body,cookie=headers.cookie,extraHeaders={})=>{
    const response=await fetch(`http://127.0.0.1:4313/api${path}`,{method:body===undefined?'GET':'POST',headers:{...headers,cookie,...extraHeaders},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json()};
  };
  const ok=async(path,body,status=200,cookie=headers.cookie)=>{const result=await req(path,body,cookie);assert.equal(result.status,status,`${path}: ${JSON.stringify(result)}`);return result.data;};
  try {
    const flow=await runE01Flow({db,runtime,seeded:seedIdentities,alpha:headers.cookie,login,req,ok},{setClock:value=>{instant=new Date(value);}});
    const contact=await ok(`/crm/accounts/${flow.account._id}/contacts`,{name:'Synthetic text probe contact',email:'synthetic-text-probe@example.invalid'},201);
    const bindingResult=await req('/cs/bindings',{accountId:flow.account._id,contactId:contact._id,channel:'SIMULATED',address:'+62000555101'},headers.cookie,{'Idempotency-Key':randomUUID()});
    assert.equal(bindingResult.status,201,JSON.stringify(bindingResult));const bindingId=bindingResult.data.binding.bindingId;
    let inbound;
    for(const text of ['IEMS COMPLAINT',`IEMS COMPLAINT ORDER ${flow.so.orderNumber}`,'IEMS COMPLAINT CATEGORY DELIVERY_DELAY','IEMS COMPLAINT DESCRIBE Synthetic customer asks about remaining shipment','IEMS COMPLAINT CONFIRM']){
      inbound=await ok('/cs/simulator/inbound',{bindingId,inboundKey:randomUUID(),text});assert.equal(inbound.error,undefined,JSON.stringify(inbound));
    }
    assert.ok(inbound.ticket?.ticketId,'actual simulator created the diagnostic ticket');const ticketPath=`/cs/tickets/${inbound.ticket.ticketId}`;
    await ok(`${ticketPath}/internal-notes`,{text:'Synthetic staff-only warehouse review',commandKey:randomUUID()},201);
    let ticket=await ok(ticketPath);
    await ok(`${ticketPath}/public-update`,{expectedVersion:ticket.version,text:'Synthetic customer-visible shipment review',commandKey:randomUUID()});
    for(const toStage of ['ASSIGNED','IN_PROGRESS','RESOLVED']){
      ticket=await ok(ticketPath);await ok(`${ticketPath}/stage`,{expectedVersion:ticket.version,toStage,reason:toStage==='RESOLVED'?'Synthetic shipment schedule confirmed':'Synthetic agent review',...(toStage==='ASSIGNED'?{assigneeId:seedIdentities.find(row=>row.username==='alpha.owner').userId}:{}),commandKey:randomUUID()});
    }
    console.log('TEXT DIAGNOSTIC: actual invoice and resolved ticket seeded only through mounted HTTP APIs; setup is not a native E01 clickthrough.');
    await textEnlargementJourney({db,call,wait,evaluate,screenshot,check,web,writeEvidence:(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2))});
  }finally{if(priorClock===undefined)delete runtime.businessClock;else runtime.businessClock=priorClock;if(priorMode===undefined)delete runtime.businessClockMode;else runtime.businessClockMode=priorMode;}
}
try {
  await runTraceHeadingBrowserRegression({ evidenceDirectory: evidence, browserBinary: process.env.PORTFOLIO_CHROME_BINARY });
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, instanceOpts: [{ launchTimeout: 60000, args: ["--wiredTigerCacheSizeGB","0.25","--oplogSize","128"] }], replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const env = { ...process.env, PORTFOLIO_MONGO_URI: mongo.getUri(), PORTFOLIO_DB: database, PORTFOLIO_SEED_PASSWORD: password };
  runtime = await connectOwned(env);
  runtime.customerService = await initializeCustomerService(runtime, { previewDispatcher: true });
  await runtime.db.collection('ownedRun').insertOne({ _id: marker });
  const e01Enabled=reviewMode.seedOperators;
  const seeded = e01Enabled ? null : spawnSync(process.execPath, [resolve(root, '../portfolio-api/src/seed-cli.mjs'), '--synthetic-owned'], { env, encoding: 'utf8' });
  if(seeded)assert.equal(seeded.status, 0, seeded.stderr);
  seedIdentities=e01Enabled ? await seedSynthetic(runtime,{password,e01Operators:true}) : JSON.parse(seeded.stdout).identities;
  const seededIdentities = seedIdentities.map(i => i.username);
  assert.deepEqual(seededIdentities, ['alpha.owner', 'beta.owner', 'alpha.inspector', 'alpha.quality', 'alpha.viewer',...(e01Enabled ? ['alpha.operator.cnc','alpha.operator.assembly'] : [])]);
  check(e01Enabled ? 'explicit synthetic foundation seed with two actual fixture operators, fresh owned DB, real MongoDB 7.0.14 replica set' : 'explicit synthetic seed CLI, fresh owned DB, real MongoDB 7.0.14 replica set');
  independent = new MongoClient(mongo.getUri()); await independent.connect();
  const db = independent.db(database);
  api = createApp(runtime, { origins: [web] }).listen(4313, '127.0.0.1');
  await new Promise((r, j) => { api.once('listening', r); api.once('error', j); });
  vite = await createServer({ root:uiRoot, define: { 'import.meta.env.VITE_PORTFOLIO_API_BASE': JSON.stringify('/portfolio-api') }, server: { host: '127.0.0.1', port: webPort, strictPort: true, fs: { allow: [resolve(root, '../..'),resolve(uiRoot,'../..'), await realpath(join(root, 'node_modules')),await realpath(join(uiRoot,'node_modules'))] } } });
  transportTelemetry.attachServer(vite.httpServer);await vite.listen();assertOwnedWebAddress(vite.httpServer,webPort);
  const chromeNetLogPath=join(evidence,'chrome-netlog.json'),chromeRuntimePath=join(evidence,'browser-runtime.json'),chromeBinary=process.env.PORTFOLIO_CHROME_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'),chromeArgs=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,`--log-net-log=${chromeNetLogPath}`,'--net-log-capture-mode=Default','--net-log-max-size-mb=8','about:blank'];
  const browserRuntime={capturedUTC:new Date().toISOString(),ownedWebOrigin:web,launch:{executable:chromeBinary,arguments:chromeArgs},platform:{host:process.platform,architecture:process.arch,browser:null},browserVersion:null,netLog:{path:chromeNetLogPath,captureMode:'Default',configuredMaxSizeMiB:8,flushVerification:'Not checked by this runner; confirm browser exit and parse the external artifact separately.',scope:'Default capture requested without sensitive or socket-byte capture. URLs, IPs and paths may remain; this is not anonymized data.'}};
  await writeFile(chromeRuntimePath,JSON.stringify(browserRuntime,null,2)+'\n',{flag:'wx'});
  await writeFile(chromeNetLogPath,'',{flag:'wx'});
  chrome = spawn(chromeBinary,chromeArgs,{ stdio: ['ignore', 'ignore', 'pipe'] });
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
    transportTelemetry.event(m);
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
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');await call('Log.enable');
  browserRuntime.browserVersion=await call('Browser.getVersion',{},null);
  browserRuntime.platform.browser=await evaluate('navigator.platform');
  await writeFile(chromeRuntimePath,JSON.stringify(browserRuntime,null,2)+'\n');
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
  if(reviewMode.diagnosticOnly){
    console.log(`DIAGNOSTIC ONLY: ${reviewMode.purchasedOnly?'purchased stock fulfillment journey':reviewMode.quoteCatalogOnly?'catalog quotation journey':reviewMode.companyOnly?'company stock journey and any explicitly selected trace':reviewMode.textProbeOnly?'invoice and resolved-ticket text probe':'review journeys'}; prior journey coverage is absent. Full acceptance requires all five diagnostic modes0 and all22 flags.`);
    const cookie=(await call('Network.getCookies',{urls:[web]})).cookies.find(row=>row.name==='portfolio_session');
    assert.ok(cookie?.httpOnly);
    const headers={origin:web,'content-type':'application/json',cookie:`portfolio_session=${cookie.value}`};
    if(reviewMode.textProbeOnly)await runTextProbe({db,headers});else await runReviewJourneys({db,headers});
    assert.deepEqual(exceptions,[]);assert.deepEqual(consoleErrors,[]);
    const diagnosticJourneys=reviewMode.purchasedOnly?['purchased fulfillment; prerequisite HTTP accepted stock and typed SO, native target stock/delivery/billing actions']:reviewMode.quoteCatalogOnly?['catalog quote identity; prerequisite HTTP masters and account, native target commercial actions']:reviewMode.textProbeOnly?['invoice and resolved-ticket text probe; actual HTTP fixture setup, not native E01']:[...(reviewMode.e01?['canonical E01']:[]),...(reviewMode.internalExecution?['supplemental internal execution']:[]),...(reviewMode.operator?['operator/source selectors']:[]),...(reviewMode.companyStock?['supplemental one-generation company stock; prerequisite HTTP producer setup']:[]),...(reviewMode.companyTrace?['readonly unit trace; staged actual HTTP fixture']:[]),...(reviewMode.quoteCatalog?['catalog quote identity; prerequisite HTTP masters and account, native target commercial actions']:[]),...(reviewMode.purchasedFulfillment?['purchased fulfillment; prerequisite HTTP stock and SO']:[])];
    await writeFile(join(evidence,reviewMode.resultsFile),JSON.stringify({diagnosticOnly:true,fullAcceptance:false,realBrowser:true,fixtureFetch:false,api:'actual current portfolio-api createApp; guarded business clock only for explicitly selected historical fixture',priorJourneyCoverage:false,prior137JourneyCoverage:'ABSENT',priorOptionalJourneysRun:false,journeys:diagnosticJourneys,checks,exceptions,consoleErrors,network,cleanup:'marker-verified disposable DB and owned processes only'},null,2));
    console.log(JSON.stringify({diagnosticOnly:true,fullAcceptance:false,passed:checks.length,exceptions:exceptions.length,consoleErrors:consoleErrors.length,evidence,resultsFile:reviewMode.resultsFile}));
  }else{
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
  await waitForTechnicalDetails({wait,evaluate},'VERSION_CONFLICT');
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
  await click('Save quote'); await wait(`document.body.innerText.includes('Status: Draft')`);
  const quoteId = await evaluate(`location.pathname.split('/').at(-1)`);
  let quote = await db.collection('quotes').findOne({_id:quoteId});
  assert.equal(quote.revisions[0].lines[0].quantity, '1.250');
  assert.equal(quote.revisions[0].lines[0].unitPrice, '9999999999999999999999999999.99');
  await click('Approve revision'); await wait(`document.body.innerText.includes('Status: Approved')`);
  await fill('expiresAt', '2027-12-31T00:00:00.000Z'); await fill('description0', ' Revised exact browser item '); await fill('quantity0', '2.500'); await fill('uom0', 'EA'); await fill('unitPrice0', '100.01');
  await click('Save revision'); await wait(`document.body.innerText.includes('Revision: 2')`);
  const competing = await fetch(`http://127.0.0.1:4313/api/commercial/quotes/${quoteId}/approve`, {method:'POST',headers,body:JSON.stringify({expectedVersion:3,revision:2})}); assert.equal(competing.status,200);
  await click('Approve revision'); await waitForTechnicalDetails({wait,evaluate},'VERSION_CONFLICT');
  await screenshot('09-quote-conflict'); await click('Refresh and retry'); await wait(`document.body.innerText.includes('Status: Approved')`);
  await click('Record acceptance'); await wait(`document.body.innerText.includes('Status: Accepted')`);
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
  await click('Open source quote'); await wait(`document.body.innerText.includes('Status: Order created')`);
  const commercialCredential = await db.collection('credentials').findOne({username:'alpha.owner'});
  const commercialMembership = await db.collection('memberships').findOne({userId:commercialCredential._id});
  await db.collection('memberships').updateOne({_id:commercialMembership._id},{$set:{roles:[]}});
  await click('Refresh record'); await wait(`document.body.innerText.includes('Access denied')`); await screenshot('12-quote-forbidden');
  await db.collection('memberships').updateOne({_id:commercialMembership._id},{$set:{roles:commercialMembership.roles}});
  await click('Refresh and retry'); await wait(`document.body.innerText.includes('Status: Order created')`);
  const quoteURL=`${web}/portfolio-api/api/commercial/quotes/${quoteId}`,quoteExpected={_id:quoteId,version:quote.version,status:'CONVERTED',orderId};
  quoteRecoveryEvidence={expected:quoteExpected,events:[],commands:[],clicks:[],completed:false};
  const recoveryState=()=>evaluate(`(${quoteRecoveryDOMState.toString()})()`),stamp=()=>new Date().toISOString(),quoteRequestIds=new Set();
  const recordQuoteNetwork=event=>{const p=event.params;if(!p)return;if(event.method==='Network.requestWillBeSent'&&p.request.method==='GET'&&p.request.url===quoteURL)quoteRequestIds.add(p.requestId);if(!quoteRequestIds.has(p.requestId)||!['Network.requestWillBeSent','Network.responseReceived','Network.loadingFinished','Network.loadingFailed'].includes(event.method))return;quoteRecoveryEvidence.events.push({method:event.method,requestId:p.requestId,receivedUTC:stamp(),timestamp:p.timestamp,wallTime:p.wallTime,status:p.response?.status,errorText:p.errorText,canceled:p.canceled,initiator:p.initiator?.type});};
  const quoteSubscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};listeners.add(recordQuoteNetwork);
  const emulateQuoteNetwork=async offline=>{quoteRecoveryEvidence.commands.push({phase:'before',offline,utc:stamp(),state:await recoveryState()});await call('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});quoteRecoveryEvidence.commands.push({phase:'ack',offline,utc:stamp(),state:await recoveryState()});if(!offline)await wait('navigator.onLine===true','browser reports online before quote retry');quoteRecoveryEvidence.commands.push({phase:offline?'browser-state-observed':'browser-online-ready',offline,utc:stamp(),state:await recoveryState()});};
  const clickQuoteRoot=async(failure,label)=>{const selector=failure?'#portfolio-content > .pf-error[role="alert"] > button':'#portfolio-content > section.pf-panel > button';await wait(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(button=>button.textContent.trim()===${JSON.stringify(label)}&&!button.disabled)`,'exact enabled quote root button');const target=await evaluate(`(async()=>{const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find(button=>button.textContent.trim()===${JSON.stringify(label)}&&!button.disabled);button.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(!button.isConnected)throw Error('Quote root changed before click');const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,button:button.textContent.trim(),scope:${JSON.stringify(failure?'top-level Resource failure':'quote primary record')},state:(${quoteRecoveryDOMState.toString()})()}})()`);quoteRecoveryEvidence.clicks.push({utc:stamp(),...target});await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:target.x,y:target.y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:target.x,y:target.y});};
  try {
    await emulateQuoteNetwork(true);
    const offlineRead=observeOfflineQuoteRead({subscribe:quoteSubscribe,url:quoteURL});
    try {await clickQuoteRoot(false,'Refresh record');quoteRecoveryEvidence.offline=await offlineRead.response;await wait(`(${isOfflineQuoteRoot.toString()})((${quoteRecoveryDOMState.toString()})(),${JSON.stringify(quoteId)})`,'new exact offline quote GET and top-level Resource failure');quoteRecoveryEvidence.offlineDOM=await recoveryState();}finally{offlineRead.close();}
    await screenshot('13-quote-offline');
    await emulateQuoteNetwork(false);
    quoteRecoveryEvidence.networkReady={};
    const {frameTree:{frame:quoteMainFrame}}=await call('Page.getFrameTree');
    await requireOwnedOnlineNetwork({call,ownedOrigin:web,frameId:quoteMainFrame.id,nonce:randomUUID(),evidence:quoteRecoveryEvidence.networkReady});
    const onlineRead=observeTraceRead({subscribe:quoteSubscribe,call,url:quoteURL});
    try {await clickQuoteRoot(true,'Refresh and retry');const fresh=await onlineRead.response;for(const [key,value]of Object.entries(quoteExpected))assert.equal(fresh.data[key],value,`Recovered quote ${key}`);await evaluate('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()');await wait(`(${isRecoveredQuoteRoot.toString()})((${quoteRecoveryDOMState.toString()})(),${JSON.stringify(quoteExpected)})`,'fresh completed converted quote response and settled root');quoteRecoveryEvidence.online={requestId:fresh.requestId,status:fresh.status,attempts:fresh.attempts,observed:{_id:fresh.data._id,version:fresh.data.version,status:fresh.data.status,orderId:fresh.data.orderId}};quoteRecoveryEvidence.onlineDOM=await recoveryState();assert.equal(isRecoveredQuoteRoot(quoteRecoveryEvidence.onlineDOM,quoteExpected),true);quoteRecoveryEvidence.completed=true;}finally{onlineRead.close();}
  } finally {listeners.delete(recordQuoteNetwork);quoteRecoveryEvidence.finalState=await recoveryState().catch(error=>({error:String(error)}));await writeFile(join(evidence,'quote-offline-recovery.json'),JSON.stringify(quoteRecoveryEvidence,null,2));}
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
  const wave4f = { db, runtime, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse, password, web, listeners, exceptions,writeEvidence:(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2)) };
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
  if (process.env.PORTFOLIO_INTERNAL_PLANNING === '1') await internalPlanningJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_CATALOG === '1') await catalogJourney({ db, call, wait, click, evaluate, screenshot, check, headers, loseResponse });
  if (process.env.PORTFOLIO_CATALOG_QC === '1') await catalogDispositionJourney({ db, call, wait, click, evaluate, screenshot, check, headers, loseResponse });
  await runReviewJourneys({db,headers});
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
  await click('Refresh record'); await wait(`document.body.innerText.includes('Check the connection and retry')`);
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
  await click('Quotes'); await click(quoteId); await wait(`document.body.innerText.includes('Status: Order created')`);
  await db.collection('sessions').updateMany({ revoked: false }, { $set: { expiresAt: new Date(0) } });
  await click('Refresh record'); await wait(`document.body.innerText.includes('Your session expired')`);
  await screenshot('08-expired'); await click('Sign in again'); await wait(`document.querySelector('[name=username]')`);
  check('real expired Mongo session renders clear expiry and sign-in recovery');
  assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, []);
  assert.ok(network.some(n => n.status === 409)); assert.ok(network.some(n => n.status === 201)); assert.ok(network.some(n => n.status === 403));
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify({ realBrowser: true, api: 'actual current portfolio-api createApp; optional canonical E01 uses marker-validated owned business clock', mongoVersion: '7.0.14', fixtureFetch: false, checks, layouts, exceptions, consoleErrors, network, databaseAssertions: { accountId, opportunityId, amount: row.amount, version: row.version, history: row.history.length }, cleanup: 'marker-verified disposable DB and owned processes only' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, exceptions: exceptions.length, consoleErrors: consoleErrors.length, evidence }));
  }
} catch (error) {
  try {
  const transportFailure=await transportTelemetry.failure(vite?.httpServer);
  try{if(ws?.readyState===1&&session){const page=await sendCdp('Runtime.evaluate',{expression:'({href:location.href,readyState:document.readyState,online:navigator.onLine,timeOrigin:performance.timeOrigin,title:document.title,text:document.body?.innerText.slice(0,4000)})',returnByValue:true},session,1500);transportFailure.page=page.exceptionDetails?{error:page.exceptionDetails}:page.result?.value;}else transportFailure.page={unavailable:'Browser session not attached'};}catch(diagnosticError){transportFailure.page={error:String(diagnosticError)};}
  await writeFile(join(evidence,'web-transport-failure.json'),JSON.stringify(transportFailure,null,2));
  }catch(diagnosticError){console.warn('Transport failure diagnostics unavailable:',String(diagnosticError));}
  await writeFile(join(evidence, 'failure-diagnostics.json'), JSON.stringify({ diagnosticOnly:reviewMode.diagnosticOnly,fullAcceptance:false,error:String(error), checks, exceptions, consoleErrors, network, networkFailures,quoteRecoveryEvidence }, null, 2));
  if (ws?.readyState === 1 && session) await screenshot('failure').catch(() => {});
  console.log(JSON.stringify({ exceptions, consoleErrors, network, networkFailures }));
  throw error;
} finally {
  if (ws?.readyState === 1) { try { await call('Browser.close', {}, null); } catch {} ws.close(); }
  if (chrome?.exitCode === null) await new Promise(resolve => {
    const ownedChrome=chrome;
    let timer;
    const finish=()=>{clearTimeout(timer);ownedChrome.removeListener('exit',finish);resolve();};
    ownedChrome.once('exit',finish);
    timer=setTimeout(finish,5000);
    if(ownedChrome.exitCode!==null||ownedChrome.signalCode!==null)finish();
  });
  if (chrome?.exitCode === null) chrome.kill();
  if (vite) {transportTelemetry.command('before','OwnedVite.close',{});await vite.close();transportTelemetry.command('ack','OwnedVite.close',{});}
  await writeFile(join(evidence,'web-transport-lifecycle.json'),JSON.stringify(transportTelemetry.snapshot(vite?.httpServer),null,2)).catch(error=>console.warn('Transport lifecycle diagnostics unavailable:',String(error)));
  if (api) await new Promise(r => api.close(r));
  if (independent) await independent.close();
  if (runtime) { assert.ok(await runtime.db.collection('ownedRun').findOne({ _id: marker })); await runtime.db.dropDatabase(); await runtime.client.close(); }
  if (mongo) await mongo.stop();
  await delay(500); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
