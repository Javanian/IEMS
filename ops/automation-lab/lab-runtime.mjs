import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { MongoMemoryReplSet } from '../../apps/portfolio-api/node_modules/mongodb-memory-server/index.js';
import { MongoClient } from '../../apps/portfolio-api/node_modules/mongodb/lib/index.js';
import { createSmtpSink } from './smtp-sink.mjs';
import { nativeWorkflowRevisions, nativeWorkflowBindings } from './native-workflows.mjs';
import { assertFreshNativeDatabase, activateNativeWorkflows } from './native-activation.mjs';

const root = resolve(process.env.IEMS_AUTOMATION_LAB_ROOT || 'D:/IEMS-Automation-Lab/n8n-corrective-acceptance-20261027');
const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceHashes = Object.fromEntries(['app.mjs', 'automation.mjs', 'automation-transport.mjs'].map(name => [name, createHash('sha256').update(readFileSync(join(repo, 'apps', 'portfolio-api', 'src', name))).digest('hex')]));
for (const directory of ['logs', 'mongo', 'n8n-user', 'runtime']) mkdirSync(join(root, directory), { recursive: true });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(path + '.tmp', path); };
const configPath = join(root, 'config.json');
const config = existsSync(configPath) ? json(configPath) : { marker: randomUUID(), username: 'alpha.owner', password: randomBytes(24).toString('base64url'), n8nEmail: 'operator@iems.local', n8nPassword: 'Iems-' + randomBytes(24).toString('base64url') + '9a', sinkToken: randomBytes(32).toString('hex'), webhookToken: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), ports: { api: 4319, smtp: 2527, inspector: 8027, n8n: 5687, web: 5187, mongo: 27197 }, database: 'portfolio_owned_n8n_corrective_20261027' };
const nativeWorkflows=config.native?nativeWorkflowRevisions({apiPort:config.ports.api,smtpPort:config.ports.smtp,webPort:config.ports.web}):null;
if(config.native){
  if(!config.instanceId||!config.n8nPackageRoot||!Object.values(config.ports).every(port=>Number.isInteger(port)&&port>=32740&&port<=32759))throw Error('NATIVE_CONFIG_REQUIRED');
  assertFreshNativeDatabase(root);
  config.nativeBindings=nativeWorkflowBindings(nativeWorkflows,config.ports.proxy??config.ports.n8n);
  const owner={schema:'IEMS_NATIVE_N8N_OWNER_V1',marker:config.marker,instanceId:config.instanceId,databaseName:config.database,n8nVersion:'1.121.3',evidenceClass:'NATIVE_RUNTIME'};
  if(existsSync(join(root,'native-owner.json'))&&JSON.stringify(json(join(root,'native-owner.json')))!==JSON.stringify(owner))throw Error('NATIVE_OWNER_CONFLICT');
  save(join(root,'native-owner.json'),owner);
}
save(configPath, config);
const base = `http://127.0.0.1:${config.ports.api}`;
const n8nBase = `http://127.0.0.1:${config.ports.n8n}`;
const webBase = `http://127.0.0.1:${config.ports.web}`;
config.webUrl = webBase; save(configPath, config);
const statusPath = join(root, 'status.json');
const children = new Map();
const exited = child => child.exitCode !== null || child.signalCode !== null;
const supervisorRunId = randomUUID();
let repl, client, server, sink, proxy, cookie, ownedDb, closing = false;
const processIdentity=pid=>{try{return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,timeout:10000}));}catch{return null;}};
let current = { marker: config.marker, supervisorPid: process.pid, supervisorIdentity:processIdentity(process.pid),supervisorRunId, supervisorStartedAt: new Date().toISOString(), ready: false, phase: 'preflight', root, configPath, repo, base, n8nBase, webBase, n8nVersion: '1.121.3', sourceHashes };
const status = extra => { current = { ...current, ...extra, observedAt: new Date().toISOString(), processes: Object.fromEntries([...children].map(([name, child]) => [name, { pid: child.pid, exited: exited(child) }])) }; save(statusPath, current); };
const log = message => console.log(`${new Date().toISOString()} ${message}`);
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function freePort(port) {
  await new Promise((resolvePort, reject) => { const listener = net.createServer(); listener.once('error', () => reject(new Error(`Port ${port} is already in use; inspect its owner`))); listener.listen(port, '127.0.0.1', () => listener.close(resolvePort)); });
}
async function ready(url, timeout = 180000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {} await wait(1000); }
  throw new Error(`Readiness timeout for ${url}; inspect ${root}/logs`);
}
function launch(name, args, env = {}) {
  const stdout = openSync(join(root, 'logs', `${name}.out.log`), 'a');
  const stderr = openSync(join(root, 'logs', `${name}.err.log`), 'a');
  const child = spawn(process.execPath, args, { cwd: name === 'web' ? join(repo, 'apps', 'web') : repo, windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  children.set(name, child);child.ownedIdentity=processIdentity(child.pid);save(join(root,'logs',`${name}-${child.pid}.identity.json`),child.ownedIdentity); child.on('error', error => log(`${name}: ${error.message}`)); child.on('exit', code => { log(`${name} exit ${code}`); status({ ready: false }); });
  return child;
}
async function stopChild(name) {
  const child = children.get(name);
  if (!child || exited(child)) return;
  if(config.native){const currentIdentity=processIdentity(child.pid);if(!currentIdentity||!child.ownedIdentity||currentIdentity.CreationDate!==child.ownedIdentity.CreationDate||currentIdentity.CommandLine!==child.ownedIdentity.CommandLine)throw Error('NATIVE_PROCESS_IDENTITY_CHANGED');}
  const stopped = new Promise(resolveExit => child.once('exit', resolveExit));
  child.kill('SIGTERM'); await Promise.race([stopped, wait(12000)]);
  if (!exited(child)) child.kill('SIGKILL');
  await Promise.race([stopped, wait(3000)]);
}
async function api(path, body) {
  const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: webBase, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(`${path}: ${response.status} ${result.error?.code || ''}`); return result.data;
}
const n8nPackageRoot=config.native?config.n8nPackageRoot:join(root,'runtime','node_modules','n8n');
const n8nBin = join(n8nPackageRoot, 'bin', 'n8n');
const n8nEnv = {
  DB_SQLITE_POOL_SIZE: '2', N8N_USER_FOLDER: join(root, 'n8n-user'), N8N_PORT: String(config.ports.n8n), N8N_LISTEN_ADDRESS: '127.0.0.1', N8N_HOST: '127.0.0.1',
  N8N_PROTOCOL: 'http', N8N_SECURE_COOKIE: 'false', N8N_ENCRYPTION_KEY: config.encryptionKey,
  WEBHOOK_URL: n8nBase + '/', N8N_EDITOR_BASE_URL: n8nBase + '/', GENERIC_TIMEZONE: 'Asia/Bangkok',
  N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_TEMPLATES_ENABLED: 'false', N8N_PERSONALIZATION_ENABLED: 'false',
  N8N_HIRING_BANNER_ENABLED: 'false', N8N_COMMUNITY_PACKAGES_ENABLED: 'false', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
  N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true', N8N_RUNNERS_ENABLED: 'false', N8N_CONCURRENCY_PRODUCTION_LIMIT: '1',
  ...(config.native?{NODE_FUNCTION_ALLOW_BUILTIN:'crypto,net'}:{}),
  N8N_LICENSE_AUTO_RENEW_ENABLED: 'false', N8N_LICENSE_ACTIVATION_KEY: '', EXECUTIONS_DATA_PRUNE: 'true', EXECUTIONS_DATA_MAX_AGE: '168',
  NODE_OPTIONS: '--max-old-space-size=1536'
};
async function cli(name, args) {
  const started=Date.now();log(`${name} start`);
  const child = launch(name, [n8nBin, ...args], n8nEnv);
  const code = await new Promise(resolveExit => child.once('exit', resolveExit));
  log(`${name} completed in ${Date.now()-started}ms with ${code}`);
  if (code !== 0) throw new Error(`${name} failed with ${code}; inspect owned logs`);
}
async function startEngine(packageRoot=join(root,'runtime','node_modules','n8n')) {
  const version = json(join(packageRoot, 'package.json')).version;
  if (version !== '1.121.3') throw new Error(`Expected n8n 1.121.3, found ${version}`);
  launch('n8n', [n8nBin, 'start'], n8nEnv);
  await ready(n8nBase + '/healthz');
  let settings;
  const setupDeadline = Date.now() + 120000;
  while (Date.now() < setupDeadline) {
    try {
      const response = await fetch(n8nBase + '/rest/settings', { signal: AbortSignal.timeout(2000) });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        settings = await response.json();
        if (settings.data?.userManagement) break;
      }
    } catch {}
    await wait(1000);
  }
  if (!settings?.data?.userManagement) throw new Error('n8n REST settings did not become ready; inspect owned n8n logs');
  if (settings.data?.userManagement?.showSetupOnFirstLoad) {
    const response = await fetch(n8nBase + '/rest/owner/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: config.n8nEmail, firstName: 'Synthetic', lastName: 'Operator', password: config.n8nPassword }) });
    if (!response.ok) throw new Error(`Local n8n owner setup ${response.status}`);
  }
  // An active authenticated webhook rejects an absent credential with 403; an unregistered path returns 404.
  for (const path of ['iems-sla-escalation', 'iems-cs-weekly-digest', 'iems-approved-resolution', 'iems-automation-recovery']) {
    let code;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${n8nBase}/webhook/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2000) });
        code = response.status;
      } catch { code = 'UNREACHABLE'; }
      if (code === 403) break;
      await wait(1000);
    }
    if (code !== 403) throw new Error(`Webhook ${path} not ready: ${code}`);
  }
  status({ n8nRunning: true });
}
async function startNativeApi(){
  const child=launch('native-api',[join(repo,'ops','automation-lab','native-api-process.mjs')],{IEMS_AUTOMATION_LAB_ROOT:root}),until=Date.now()+120000;
  while(Date.now()<until&&!exited(child)){try{const ready=json(join(root,'native-api-ready.json'));if(ready.marker===config.marker&&ready.pid===child.pid)return;}catch{}await wait(250);}
  throw Error('NATIVE_API_NOT_READY');
}
async function stopAll() {
  if (closing) return; closing = true; status({ ready: false, phase: 'stopping' });
  for (const name of [...children.keys()].reverse()) await stopChild(name);
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
  if (sink) await sink.stop();
  if(config.native&&ownedDb){if(!await ownedDb.collection('ownedRun').findOne({_id:config.marker})||json(join(root,'native-owner.json')).marker!==config.marker)throw Error('NATIVE_CLEANUP_OWNER_CONFLICT');await ownedDb.dropDatabase();status({databaseDropped:true});}
  if (client) await client.close();
  if (repl) await repl.stop({ doCleanup: false });
  status({ ready: false, phase: 'stopped', n8nRunning: false });
}
// A setup timeout can request normal owned cleanup before the main control loop exists.
const setupControl=config.native?setInterval(async()=>{
  let command;try{command=json(join(root,'control.json'));}catch{return;}
  if(command.action!=='stop'||command.marker!==config.marker||command.supervisorPid!==process.pid||command.supervisorRunId!==supervisorRunId)return;
  clearInterval(setupControl);
  try{await stopAll();status({lastControl:{id:command.id,action:'stop',ok:true}});process.exit(0);}catch(error){status({phase:'cleanup-failed',error:error.message});process.exitCode=1;}
},500):null;
try {
  for (const port of Object.values(config.ports)) await freePort(port);
  if (!existsSync(n8nBin)) throw new Error('Pinned n8n runtime is missing; run start.ps1 to install it');
  process.env.IEMS_AUTOMATION_SMTP_PORT = String(config.ports.smtp);
  process.env.IEMS_AUTOMATION_SINK_URL = `http://127.0.0.1:${config.ports.inspector}`;
  process.env.IEMS_AUTOMATION_SINK_TOKEN = config.sinkToken;
  process.env.IEMS_AUTOMATION_N8N_URL = n8nBase;
  process.env.IEMS_AUTOMATION_WEBHOOK_TOKEN = config.webhookToken;
  process.env.IEMS_AUTOMATION_SLA_MINUTES = String(5 / 60);
  status({ phase: 'owned-mongo' });
  repl = await MongoMemoryReplSet.create({ binary: { version: '7.0.14', ...(process.env.MONGOMS_SYSTEM_BINARY ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } : {}) }, replSet: { count: 1, name: 'iemsAutomation', storageEngine: 'wiredTiger' }, instanceOpts: [{ port: config.ports.mongo, dbPath: join(root, 'mongo'), launchTimeout: 60000, args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  client = await new MongoClient(repl.getUri()).connect();
  const db = client.db(config.database);
  ownedDb=db;
  const marker = await db.collection('automationLabOwner').findOne({ _id: config.marker });
  if (!marker && await db.collection('credentials').countDocuments()) throw new Error('Database is not owned by this lab marker');
  await db.collection('automationLabOwner').updateOne({ _id: config.marker }, { $setOnInsert: { root, createdAt: new Date() } }, { upsert: true });
  if(config.native){
    if(await db.collection('ownedRun').countDocuments()&&!await db.collection('ownedRun').findOne({_id:config.marker}))throw Error('NATIVE_DATABASE_OWNER_CONFLICT');
    await db.collection('ownedRun').updateOne({_id:config.marker},{$setOnInsert:{root,createdAt:new Date()}},{upsert:true});
    config.mongoUri=repl.getUri();save(configPath,config);
    const mongo=repl.servers[0]?.instanceInfo;save(join(root,'logs','mongo.identity.json'),{marker:config.marker,port:config.ports.mongo,root:join(root,'mongo'),identity:processIdentity(mongo?.instance?.mongodProcess?.pid)});
    await startNativeApi();
  }else{
    const { createApp, initialize, seedSynthetic } = await import('../../apps/portfolio-api/src/app.mjs');
    const runtime = await initialize({ client, db });
    if (!await db.collection('credentials').countDocuments()) await seedSynthetic(runtime, { password: config.password });
    server = createApp(runtime, { origins: [webBase, 'http://localhost:4173'] }).listen(config.ports.api, '127.0.0.1');
    await new Promise(resolveListen => server.once('listening', resolveListen));
  }
  const login = await fetch(base + '/api/session/login', { method: 'POST', headers: { origin: webBase, 'content-type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) });
  if (!login.ok) throw new Error('Synthetic IEMS owner sign-in failed');
  cookie = login.headers.get('set-cookie').split(';')[0];
  if (config.serviceSessionId) {
    try { await api(`/cs/automation/service-credentials/${config.serviceSessionId}/revoke`, {}); }
    catch { log('Previous local service credential could not be revoked; inspect its scoped session state'); }
  }
  const credential = await api('/cs/automation/service-credentials', { label: 'Owned n8n local orchestrator', ttlMinutes: 1440 });
  config.serviceToken = credential.token; config.serviceSessionId = credential.sessionId; save(configPath, config);
  process.env.IEMS_AUTOMATION_SERVICE_TOKEN = credential.token;
  sink = createSmtpSink({ smtpPort: config.ports.smtp, httpPort: config.ports.inspector, token: config.sinkToken, dataFile: config.native?join(root,'smtp','receipts.ndjson'):join(root, 'sink-receipts.jsonl') });
  await sink.start();
  if(config.native&&config.ports.proxy){
    const applied=new Set();
    proxy=http.createServer(async(req,res)=>{
      try{
        if(req.method!=='POST'||!config.nativeBindings.some(w=>new URL(w.webhookUrl).pathname===req.url)||req.headers['x-iems-webhook-token']!==config.webhookToken){res.writeHead(403).end();return;}
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw Error('NATIVE_REQUEST_TOO_LARGE');}
        const binding=JSON.parse(body).iemsNative;
        let before;try{before=json(join(root,'native-proxy-fault.json'));}catch{}
        if(before?.marker===config.marker&&before.commandId===binding.commandId&&before.action==='hold-before-forward'){
          save(join(root,'native-proxy-fault-reached.json'),{marker:config.marker,id:before.id,commandId:binding.commandId,attemptId:binding.attemptId,boundary:'before-forward'});
          const deadline=Date.now()+30000;
          while(Date.now()<deadline&&json(join(root,'native-proxy-fault.json')).action==='hold-before-forward')await wait(25);
          if(json(join(root,'native-proxy-fault.json')).action!=='release')throw Error('NATIVE_PROXY_HOLD_TIMEOUT');
        }
        const upstream=await fetch(n8nBase+req.url,{method:'POST',headers:{'content-type':'application/json','x-iems-webhook-token':config.webhookToken},body,redirect:'error',signal:AbortSignal.timeout(30000)}),reply=await upstream.arrayBuffer();
        let fault;try{fault=json(join(root,'native-proxy-fault.json'));}catch{}
        if(fault?.marker===config.marker&&fault.commandId===binding.commandId&&fault.action==='drop-ack'&&!applied.has(fault.id)){applied.add(fault.id);save(join(root,'native-proxy-fault-reached.json'),{marker:config.marker,id:fault.id,commandId:binding.commandId,attemptId:binding.attemptId,actualUpstreamStatus:upstream.status});res.destroy();return;}
        res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});res.end(Buffer.from(reply));
      }catch{res.destroy();}
    });await new Promise((r,j)=>{proxy.once('error',j);proxy.listen(config.ports.proxy,'127.0.0.1',r);});
  }
  status({ phase: 'importing-pinned-workflows', mongoUri: repl.getUri(), database: config.database });
  const credentialsPath = join(root, 'n8n-credentials.private.json');
  save(credentialsPath, [
    { id: 'iems-service-api', name: 'IEMS scoped automation service', type: 'httpHeaderAuth', data: { name: 'Cookie', value: `portfolio_session=${config.serviceToken}` } },
    { id: 'iems-webhook-auth', name: 'IEMS private webhook', type: 'httpHeaderAuth', data: { name: 'x-iems-webhook-token', value: config.webhookToken } }
  ]);
  await cli('import-credentials', ['import:credentials', `--input=${credentialsPath}`]);
  const workflowIds = nativeWorkflows?nativeWorkflows.map(w=>w.id):['wf-sla-escalation', 'wf-cs-weekly-digest', 'wf-approved-resolution', 'wf-automation-recovery', 'wf-automation-error'];
  const workflowsPath = join(root, 'n8n-workflows.json');
  save(workflowsPath, nativeWorkflows??workflowIds.map(workflowId => json(join(repo, 'ops', 'automation-lab', 'workflows', workflowId + '.json'))));
  await cli('import-workflows', ['import:workflow', `--input=${workflowsPath}`]);
  if(config.native){
    const activation=await activateNativeWorkflows({root,config,db,workflows:nativeWorkflows,cli,assertStopped:()=>{if(children.has('n8n')||closing)throw Error('NATIVE_ACTIVATION_REQUIRES_STOPPED_ENGINE');}});
    save(join(root,'native-activation.json'),activation);
  }else{
    for (const workflowId of workflowIds.filter(id => id !== 'wf-automation-error')) await cli(`activate-${workflowId}`, ['update:workflow', `--id=${workflowId}`, '--active=true']);
  }
  status({ phase: 'starting-engine' }); await startEngine(n8nPackageRoot);
  if(!config.native){launch('web', [join(repo, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js'), join(repo, 'apps', 'web'), '--host', '127.0.0.1', '--port', String(config.ports.web), '--strictPort'], { VITE_PORTFOLIO_API_BASE: base, VITE_PORTFOLIO_PROXY_TARGET: base });await ready(webBase + '/portfolio/login');}
  if(setupControl)clearInterval(setupControl);
  status({ ready: true, phase: 'ready', workflowIds }); log('Owned lab ready; credentials remain in config.json outside Git');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stopAll().then(() => process.exit()));
  const handled = new Set();
  while (!closing) {
    const control = join(root, 'control.json');
    if (existsSync(control)) {
      const command = json(control);
      if (command.marker === config.marker && command.supervisorPid === process.pid && command.supervisorRunId === supervisorRunId && !handled.has(command.id)) {
        handled.add(command.id);
        try {
          if (command.action === 'stop-n8n') { await stopChild('n8n'); status({ n8nRunning: false, phase: 'engine-stopped', ready: false }); }
          else if (command.action === 'start-n8n') { if (!children.get('n8n') || exited(children.get('n8n'))) await startEngine(n8nPackageRoot); status({ n8nRunning: true, phase: 'ready', ready: true }); }
          else if(command.action==='restart-api'&&config.native){await stopChild('native-api');await startNativeApi();status({ready:true,phase:'ready'});}
          else if (command.action === 'stop') { await stopAll(); }
          else if (command.action === 'status') status({});
          else throw new Error('Unsupported lab control');
          status({ lastControl: { id: command.id, action: command.action, ok: true } });
        } catch (error) { status({ lastControl: { id: command.id, action: command.action, ok: false, error: error.message } }); }
      }
    }
    await wait(500);
  }
} catch (error) {
  if(setupControl)clearInterval(setupControl);
  log(`BLOCKED: ${error.message}`); await stopAll(); status({ ready: false, phase: 'failed', error: error.message }); process.exitCode = 1;
}
