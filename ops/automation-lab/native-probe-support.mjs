import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,statfsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {freemem,cpus} from 'node:os';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {MongoClient} from '../../apps/portfolio-api/node_modules/mongodb/lib/index.js';

export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export const read=path=>JSON.parse(readFileSync(path,'utf8'));
export function save(path,value){writeFileSync(path+'.tmp',JSON.stringify(value,null,2),{mode:0o600});renameSync(path+'.tmp',path);}
export async function until(predicate,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const value=await predicate();if(value)return value;await wait(50);}throw Error('NATIVE_PROBE_DEADLINE');}
export async function stopNativeSupervisor({child,state,requestStop}){
  const exited=()=>child.exitCode!==null||child.signalCode!==null;
  if(exited())return;
  // Self-failure has already left the control loop; an unconsumed stop ACK cannot prove cleanup.
  if(!['stopping','stopped','failed'].includes(state()?.phase))await requestStop();
  await until(exited,30000);
}
const repo=fileURLToPath(new URL('../..',import.meta.url));
const identity=pid=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,timeout:10000})||'null');

export async function startNativeLab(){
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  assert.equal(process.env.IEMS_NATIVE_REVIEWED_SHA,sha,'An explicit exact-SHA coordinator review is required');
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),'','Native proof requires a clean reviewed tree');
  assert.equal(process.versions.node.split('.')[0],'24');
  assert.ok(freemem()/1024/1024>=3584,'Existing 3584 MiB startup guard');
  const parent=resolve(process.env.IEMS_NATIVE_EVIDENCE_ROOT??'D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/orca-iems-20261102/native-integration/runs');
  mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'native-'));
  // Secrets and native history are restricted before the first config file is written.
  const account=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();
  execFileSync('icacls.exe',[root,'/inheritance:r','/grant:r',`${account}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F'],{windowsHide:true});
  mkdirSync(join(root,'logs'));
  const cpu=()=>cpus().map(c=>({idle:c.times.idle,total:Object.values(c.times).reduce((a,b)=>a+b,0)})),a=cpu();await wait(1000);const b=cpu();
  const total=b.reduce((n,c,i)=>n+c.total-a[i].total,0),idle=b.reduce((n,c,i)=>n+c.idle-a[i].idle,0),disk=statfsSync(root);
  const preflight={freeRamBytes:freemem(),cpuPercent:100*(1-idle/total),freeDiskBytes:disk.bavail*disk.bsize};save(join(root,'preflight.json'),preflight);
  assert.ok(preflight.freeRamBytes>=3584*1024**2&&preflight.cpuPercent<80&&preflight.freeDiskBytes>=1024**3,'Original resource guards must pass');
  const others=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object {$_.Name -like 'mongod*' -or $_.Name -in @('java.exe','docker.exe')} | Select-Object ProcessId,CreationDate,Name) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true})||'[]');save(join(root,'exclusive.json'),others);assert.equal(others.length,0,'Another heavy runtime owns the host');
  const secret=()=>randomBytes(32).toString('hex'),marker=randomUUID();
  const config={native:true,marker,instanceId:randomUUID(),username:'alpha.owner',password:secret(),n8nEmail:'operator@iems.local',n8nPassword:'Iems-'+secret()+'9a',sinkToken:secret(),webhookToken:secret(),encryptionKey:secret(),ports:{api:32740,smtp:32741,inspector:32742,n8n:32743,web:32744,mongo:32745,proxy:32746},database:'portfolio_owned_native_'+marker.replaceAll('-',''),n8nPackageRoot:process.env.IEMS_N8N_PACKAGE_ROOT??'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n'};
  assert.equal(read(join(config.n8nPackageRoot,'package.json')).version,'1.121.3');
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');assert.equal(hash(resolve(config.n8nPackageRoot,'../../package-lock.json')),hash(join(repo,'ops/automation-lab/runtime-package-lock.json')),'Existing dependency cache must match the pinned lock');
  save(join(root,'config.json'),config);save(join(root,'source-review.json'),{sha,reviewedAt:new Date().toISOString(),marker});
  const stdout=openSync(join(root,'logs/supervisor.out.log'),'a'),stderr=openSync(join(root,'logs/supervisor.err.log'),'a');
  const child=spawn(process.execPath,[join(repo,'ops/automation-lab/lab-runtime.mjs')],{cwd:repo,windowsHide:true,env:{...process.env,IEMS_AUTOMATION_LAB_ROOT:root,MONGOMS_RUNTIME_DOWNLOAD:'false'},stdio:['ignore',stdout,stderr]});closeSync(stdout);closeSync(stderr);
  const supervisor=identity(child.pid);save(join(root,'logs/supervisor.identity.json'),supervisor);
  const lab={root,config,child,supervisor,client:null,db:null};
  lab.state=()=>{try{return read(join(root,'status.json'));}catch{return null;}};
  lab.control=async action=>{const state=lab.state();assert.equal(state?.marker,marker);assert.equal(state.supervisorPid,child.pid);assert.equal(identity(child.pid)?.CreationDate,supervisor.CreationDate);const id=randomUUID();save(join(root,'control.json'),{id,action,marker,supervisorPid:child.pid,supervisorRunId:state.supervisorRunId});return until(()=>{const result=lab.state()?.lastControl;if(result?.id!==id)return null;assert.equal(result.ok,true,JSON.stringify(result));return result;},action==='start-n8n'?120000:60000);};
  lab.close=async()=>{
    if(lab.client)await lab.client.close();
    await stopNativeSupervisor({child,state:lab.state,requestStop:()=>lab.control('stop')});
    const state=lab.state();assert.equal(state?.databaseDropped,true,'Owned database must be marker-checked and dropped');
    for(const port of Object.values(config.ports))await new Promise((r,j)=>{const socket=net.createServer();socket.once('error',j);socket.listen(port,'127.0.0.1',()=>socket.close(r));});
    const checked=[];
    for(const file of readdirSync(join(root,'logs')).filter(name=>name.endsWith('.identity.json'))){const record=read(join(root,'logs',file)),owned=record?.identity??record;assert.ok(owned?.ProcessId&&owned?.CreationDate,`Missing process ownership: ${file}`);const actual=identity(owned.ProcessId);assert.ok(!actual||actual.CreationDate!==owned.CreationDate,`Owned process remains: ${file}`);checked.push({file,pid:owned.ProcessId,creationDate:owned.CreationDate,ownedProcessGone:true});}
    save(join(root,'cleanup.json'),{marker,sha,supervisor,completedAt:new Date().toISOString(),databaseDropped:state.databaseDropped,portsFree:Object.values(config.ports),supervisorExit:child.exitCode,processes:checked});
  };
  try{
    await until(()=>{if(child.exitCode!==null)throw Error(`NATIVE_SETUP_EXIT_${child.exitCode}: ${root}`);const state=lab.state();if(state?.phase==='failed')throw Error(state.error);return state?.ready;},300000);
    Object.assign(config,read(join(root,'config.json')));
    lab.client=await new MongoClient(config.mongoUri).connect();lab.db=lab.client.db(config.database);
    assert.ok(await lab.db.collection('ownedRun').findOne({_id:marker}));
    return lab;
  }catch(error){try{await lab.close();}catch(cleanup){error.message+=`; cleanup requires inspection: ${cleanup.message}`;}throw error;}
}

// These snapshots are read-only diagnostics. Only the branded provider can authorize settlement.
export function history(lab){
  const parse=createRequire(join(lab.config.n8nPackageRoot,'package.json'))('flatted').parse;
  const sqlite=new DatabaseSync(join(lab.root,'n8n-user/.n8n/database.sqlite'),{readOnly:true});
  try{sqlite.exec('PRAGMA query_only=ON; BEGIN');return sqlite.prepare('SELECT e.id,e.workflowId,e.status,e.finished,e.mode,e.retryOf,e.retrySuccessId,e.stoppedAt,e.deletedAt,d.data,d.workflowData FROM execution_entity e LEFT JOIN execution_data d ON d.executionId=e.id ORDER BY e.id').all().map(row=>({...row,data:row.data?parse(row.data):null,workflowData:row.workflowData?JSON.parse(row.workflowData):null}));}finally{sqlite.close();}
}
export function mail(lab){try{return readFileSync(join(lab.root,'smtp/receipts.ndjson'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
