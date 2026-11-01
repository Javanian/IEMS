import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, statfsSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';

const repo = process.cwd(), root = resolve(process.argv[2]);
assert.ok(root.startsWith('D:\\Project AI\\GITHUB\\IEMS-evidence\\agent-checkpoints\\TPR-157\\6e70f0a8-d639-44c1-92db-0b23cdc10ab0\\'));
mkdirSync(root, { recursive: false });
const record = row => appendFileSync(join(root, 'timings.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ...row }) + '\n');
const cpu = () => os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a,b) => a+b,0) }));
const a=cpu(); await new Promise(r=>setTimeout(r,1000)); const b=cpu();
const total=b.reduce((n,c,i)=>n+c.total-a[i].total,0), idle=b.reduce((n,c,i)=>n+c.idle-a[i].idle,0);
const preflight={freeRamBytes:os.freemem(),cpuPercent:100*(1-idle/total),freeDiskBytes:statfsSync(root).bavail*statfsSync(root).bsize};
record({kind:'preflight',...preflight});
assert.ok(preflight.freeRamBytes>=2*1024**3 && preflight.cpuPercent<80 && preflight.freeDiskBytes>=1024**3);
const others=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object {$_.Name -like 'mongod*' -or $_.Name -in @('java.exe','docker.exe')} | Select-Object ProcessId,CreationDate,Name) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true})||'[]');
record({kind:'exclusive',others}); assert.equal(others.length,0);
const cached='D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(hash(join(cached,'package-lock.json')),hash('ops/automation-lab/runtime-package-lock.json'));
assert.equal(JSON.parse(readFileSync(join(cached,'node_modules/n8n/package.json'))).version,'1.121.3');
mkdirSync(join(root,'runtime')); symlinkSync(join(cached,'node_modules'),join(root,'runtime/node_modules'),'junction');
const config={marker:randomUUID(),username:'alpha.owner',password:randomBytes(24).toString('base64url'),n8nEmail:'operator@iems.local',n8nPassword:'Iems-'+randomBytes(24).toString('base64url')+'9a',sinkToken:randomBytes(32).toString('hex'),webhookToken:randomBytes(32).toString('hex'),encryptionKey:randomBytes(32).toString('hex'),ports:{api:32740,smtp:32741,inspector:32742,n8n:32743,web:32744,mongo:32745},database:'portfolio_owned_n8n_'+randomUUID().replaceAll('-','')};
writeFileSync(join(root,'config.json'),JSON.stringify(config),{mode:0o600});
mkdirSync(join(root,'workflows'));
for(const name of ['wf-sla-escalation','wf-cs-weekly-digest','wf-approved-resolution','wf-automation-recovery','wf-automation-error']){
  const workflow=readFileSync(join(repo,'ops/automation-lab/workflows',name+'.json'),'utf8').replaceAll('http://127.0.0.1:4319','http://127.0.0.1:32740').replaceAll('http://127.0.0.1:5187','http://127.0.0.1:32744');
  writeFileSync(join(root,'workflows',name+'.json'),workflow);
}
let source=readFileSync('ops/automation-lab/lab-runtime.mjs','utf8');
const originalHash=hash('ops/automation-lab/lab-runtime.mjs');
source=source.replaceAll("'../../apps/", "'"+pathToFileURL(join(repo,'apps')).href+'/');
source=source.replace("'./smtp-sink.mjs'",JSON.stringify(pathToFileURL(join(repo,'ops/automation-lab/smtp-sink.mjs')).href));
source=source.replace("const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));",'const repo = '+JSON.stringify(repo)+';');
source=source.replace("join(repo, 'ops', 'automation-lab', 'workflows', workflowId + '.json')","join(root, 'workflows', workflowId + '.json')");
source=source.replace("const status = extra => {", "const status = extra => { console.log('PHASE '+JSON.stringify({phase:extra.phase,at:Date.now()}));");
source=source.replace("const child = launch(name, [n8nBin, ...args], n8nEnv);", "console.log('CLI_BEGIN '+name+' '+Date.now()); const child = launch(name, [n8nBin, ...args], n8nEnv);");
source=source.replace('if (code !== 0) throw new Error(`${name} failed',"console.log('CLI_END '+name+' '+Date.now()); if (code !== 0) throw new Error(`${name} failed");
// This adapter drops only its fresh marker-owned database during normal shutdown.
source=source.replace('if (client) await client.close();',"if (client) { const db=client.db(config.database); if (!await db.collection('automationLabOwner').findOne({_id:config.marker})) throw Error('Ownership marker missing at drop'); await db.dropDatabase(); console.log('MARKER_DROP '+config.database); await client.close(); }");
writeFileSync(join(root,'lab-adapted.mjs'),source);
const started=Date.now();
const child=spawn(process.execPath,[join(root,'lab-adapted.mjs')],{cwd:repo,windowsHide:true,env:{...process.env,IEMS_AUTOMATION_LAB_ROOT:root,MONGOMS_SYSTEM_BINARY:'C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe',MONGOMS_RUNTIME_DOWNLOAD:'false',TEMP:process.env.PAPERCLIP_RUN_SCRATCH_DIR,TMP:process.env.PAPERCLIP_RUN_SCRATCH_DIR},stdio:['ignore','pipe','pipe']});
record({kind:'launch',pid:child.pid,sourceHash:originalHash,lockHash:hash(join(cached,'package-lock.json')),command:[process.execPath,join(root,'lab-adapted.mjs')]});
for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',data=>appendFileSync(join(root,name+'.log'),data));
let done=false; const exit=new Promise(r=>child.once('exit',(code,signal)=>{done=true;r({code,signal});}));
let ready=false;
while(!done && Date.now()-started<600000){
  await new Promise(r=>setTimeout(r,1000));
  try { const state=JSON.parse(readFileSync(join(root,'status.json'))); record({kind:'sample',elapsedMs:Date.now()-started,phase:state.phase,ready:state.ready,freeRamBytes:os.freemem()}); if(state.ready){ready=true;break;} } catch {}
}
const elapsedMs=Date.now()-started; record({kind:'setup-result',elapsedMs,ready,withinOriginal300s:ready&&elapsedMs<=300000});
assert.ok(done||ready,'Inspect pending owned stack; do not start another');
let scenarioCode=null;
if(ready&&elapsedMs<=300000&&process.env.IEMS_RUN_SCENARIOS==='1'){
  const probe=spawn(process.execPath,['checkpoints/acceptance-fixes/automation/native-scenarios.mjs',root,join(root,'native-scenarios')],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
  record({kind:'scenarios-started',pid:probe.pid});
  for(const [stream,name] of [[probe.stdout,'scenarios-stdout'],[probe.stderr,'scenarios-stderr']])stream.on('data',data=>appendFileSync(join(root,name+'.log'),data));
  scenarioCode=await new Promise(r=>probe.once('exit',r));record({kind:'scenarios-exit',code:scenarioCode});
}
if(ready){const state=JSON.parse(readFileSync(join(root,'status.json')));writeFileSync(join(root,'control.json'),JSON.stringify({id:randomUUID(),action:'stop',marker:config.marker,supervisorPid:child.pid,supervisorRunId:state.supervisorRunId}));}
const outcome=await exit; record({kind:'exit',...outcome});
writeFileSync(join(root,'result.json'),JSON.stringify({ready,elapsedMs,withinOriginal300s:ready&&elapsedMs<=300000,scenarioCode,outcome},null,2));
assert.equal(outcome.code,0); assert.ok(ready&&elapsedMs<=300000,'Original300s setup failed; evidence retained');
if(scenarioCode!==null)assert.equal(scenarioCode,0);
