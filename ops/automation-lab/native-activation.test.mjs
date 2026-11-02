import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {nativeWorkflowRevisions} from './native-workflows.mjs';
import {activateNativeWorkflows,assertFreshNativeDatabase,verifyNativeActivationRows} from './native-activation.mjs';

const workflows=nativeWorkflowRevisions({apiPort:32740,smtpPort:32741,webPort:32744});

test('pinned repository bulk activation and explicit error deactivation preserve the per-ID active set',async()=>{
  const packageRoot=process.env.IEMS_N8N_PACKAGE_ROOT??'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n';
  assert.equal(JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8')).version,'1.121.3');
  const source=readFileSync(resolve(packageRoot,'../@n8n/db/dist/repositories/workflow.repository.js'),'utf8');
  const start=source.indexOf('async updateActiveState('),end=source.indexOf('async findByActiveState(');
  assert.ok(start>=0&&end>start);
  const repository=runInNewContext('({'+source.slice(start,end).trim().replace(/}\s+async /g,'}, async ')+'})');
  const apply=()=>({rows:workflows.map(w=>({id:w.id,active:false})),...repository,async update(where,patch){for(const row of this.rows)if(Object.entries(where).every(([key,value])=>row[key]===value))Object.assign(row,patch);}});
  const old=apply(),bulk=apply();
  for(const w of workflows.filter(w=>w.id!=='wf-automation-error'))await old.updateActiveState(w.id,true);
  await bulk.activateAll();await bulk.updateActiveState('wf-automation-error',false);
  assert.deepEqual(bulk.rows,old.rows);
});

test('activation inventory rejects missing, additional, modified and wrongly active workflows',()=>{
  const rows=workflows.map(w=>({...structuredClone(w),active:0}));
  verifyNativeActivationRows(workflows,rows,'imported');
  for(const invalid of [rows.slice(1),[...rows,{...rows[0],id:'foreign-workflow'}],rows.map((w,i)=>i? w:{...w,name:'changed'})])assert.throws(()=>verifyNativeActivationRows(workflows,invalid,'imported'),/NATIVE_WORKFLOW_(INVENTORY|REVISION)/);
  const final=rows.map(w=>({...w,active:Number(w.id!=='wf-automation-error')}));
  verifyNativeActivationRows(workflows,final,'final');
  assert.throws(()=>verifyNativeActivationRows(workflows,final.map(w=>({...w,active:1})),'final'),/NATIVE_WORKFLOW_ACTIVE_STATE/);
});

function fixture(t){
  // Only a synthetic workflow table is mutated here; no native execution or SMTP proof is produced.
  const root=mkdtempSync(join(tmpdir(),'iems-synthetic-activation-')),marker=randomUUID();
  assertFreshNativeDatabase(root);
  mkdirSync(join(root,'n8n-user','.n8n'),{recursive:true});
  const config={native:true,marker,instanceId:randomUUID(),database:'portfolio_owned_native_'+marker.replaceAll('-','')};
  const owner={schema:'IEMS_NATIVE_N8N_OWNER_V1',marker,instanceId:config.instanceId,databaseName:config.database,n8nVersion:'1.121.3',evidenceClass:'NATIVE_RUNTIME'};
  const ownerPath=join(root,'native-owner.json');writeFileSync(ownerPath,JSON.stringify(owner));
  const sqlite=new DatabaseSync(join(root,'n8n-user','.n8n','database.sqlite'));t.after(()=>sqlite.close());
  sqlite.exec('CREATE TABLE workflow_entity(id TEXT PRIMARY KEY,name TEXT,nodes TEXT,connections TEXT,settings TEXT,pinData TEXT,staticData TEXT,active INTEGER); CREATE TABLE execution_entity(id TEXT PRIMARY KEY)');
  const insert=sqlite.prepare('INSERT INTO workflow_entity VALUES(?,?,?,?,?,NULL,NULL,0)');
  for(const w of workflows)insert.run(w.id,w.name,JSON.stringify(w.nodes),JSON.stringify(w.connections),JSON.stringify(w.settings));
  let markerPresent=true,stopped=true;
  const calls=[],db={databaseName:config.database,collection:name=>{assert.equal(name,'ownedRun');return {findOne:async query=>{assert.deepEqual(query,{_id:marker});return markerPresent?{_id:marker}:null;}};}};
  const options={root,config,db,workflows,assertStopped:()=>assert.ok(stopped,'ENGINE_RUNNING'),cli:async(name,args)=>{calls.push({name,args});if(args.includes('--all'))sqlite.exec('UPDATE workflow_entity SET active=1 WHERE active=0');else sqlite.prepare('UPDATE workflow_entity SET active=0 WHERE id=?').run('wf-automation-error');}};
  return {root,owner,ownerPath,sqlite,options,calls,setMarker:value=>{markerPresent=value;},setStopped:value=>{stopped=value;}};
}

test('synthetic SQLite guard rejects foreign inventory before any CLI and verifies both real readbacks',async t=>{
  const f=fixture(t);
  assert.throws(()=>assertFreshNativeDatabase(f.root),/NATIVE_SETUP_REQUIRES_FRESH_DATABASE/);
  f.sqlite.exec("INSERT INTO workflow_entity SELECT 'foreign',name,nodes,connections,settings,pinData,staticData,active FROM workflow_entity LIMIT 1");
  await assert.rejects(activateNativeWorkflows(f.options),/NATIVE_WORKFLOW_INVENTORY/);assert.equal(f.calls.length,0);
  f.sqlite.exec("DELETE FROM workflow_entity WHERE id='foreign'");
  f.sqlite.prepare('UPDATE workflow_entity SET pinData=? WHERE id=?').run('{"node":[]}',workflows[0].id);
  await assert.rejects(activateNativeWorkflows(f.options),/NATIVE_WORKFLOW_SNAPSHOT_INVALID/);assert.equal(f.calls.length,0);
  f.sqlite.exec('UPDATE workflow_entity SET pinData=NULL');
  const receipt=await activateNativeWorkflows(f.options);
  assert.deepEqual(f.calls.map(c=>c.args),[['update:workflow','--all','--active=true'],['update:workflow','--id=wf-automation-error','--active=false']]);
  assert.equal(receipt.workflows.filter(w=>w.active===1).length,7);
  assert.equal(receipt.workflows.find(w=>w.id==='wf-automation-error').active,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM execution_entity').get().n,0);
});

test('marker, engine and final-state failures cannot authorize native engine startup',async t=>{
  const f=fixture(t);
  f.setMarker(false);await assert.rejects(activateNativeWorkflows(f.options),/NATIVE_ACTIVATION_OWNER/);
  f.setMarker(true);writeFileSync(f.ownerPath,JSON.stringify({...f.owner,marker:randomUUID()}));
  await assert.rejects(activateNativeWorkflows(f.options),/NATIVE_ACTIVATION_OWNER/);
  writeFileSync(f.ownerPath,JSON.stringify(f.owner));f.setStopped(false);
  await assert.rejects(activateNativeWorkflows(f.options),/ENGINE_RUNNING/);assert.equal(f.calls.length,0);
  f.setStopped(true);
  const cli=f.options.cli;f.options.cli=async(name,args)=>{if(args.includes('--all'))await cli(name,args);};
  await assert.rejects(activateNativeWorkflows(f.options),/NATIVE_WORKFLOW_ACTIVE_STATE/);
});

test('inventory inspection is read-only when a CLI fails to change the expected state',async t=>{
  const f=fixture(t),path=join(f.root,'n8n-user','.n8n','database.sqlite');
  const hash=()=>createHash('sha256').update(readFileSync(path)).digest('hex'),before=hash();
  f.options.cli=async()=>{};
  await assert.rejects(activateNativeWorkflows(f.options),/NATIVE_WORKFLOW_ACTIVE_STATE/);
  assert.equal(hash(),before);
});

test('stop arriving during marker inspection prevents the next CLI launch',async t=>{
  const f=fixture(t);
  f.options.db.collection=()=>({findOne:async()=>{f.setStopped(false);return {_id:f.options.config.marker};}});
  await assert.rejects(activateNativeWorkflows(f.options),/ENGINE_RUNNING/);
  assert.equal(f.calls.length,0);
});
