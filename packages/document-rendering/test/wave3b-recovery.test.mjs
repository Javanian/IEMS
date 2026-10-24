import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { fork,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createSnapshot,createIssuer } from '../src/index.mjs';
const scope={tenantId:'t',legalEntityId:'e',plantId:'p'};
function snapshot(version=1,templateVersion=2){return createSnapshot('invoice',scope,{_id:'invoice',version,...scope,currency:'KWD',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',total:'9007199254740993.123',lines:[{description:'Exact total',quantity:'1',unitPrice:'9007199254740993.123',currency:'KWD',uom:'KG'}]},{templateVersion});}
function identity(pid){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,CommandLine,@{Name='CreationDate';Expression={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress`],{encoding:'utf8'}));}
function workerPath(commandLine) {
 const match = /^(?:"[^"]+"|\S+)\s+(?:"([^"]+)"|(\S+))(?:\s|$)/.exec(commandLine);
 return match?.[1] ?? match?.[2];
}
test('worker identity accepts Windows quoting variants and preserves the exact script path', () => {
 const spaced = String.raw`D:\Project AI\renderer\test\wave3b-child.mjs`;
 const plain = String.raw`D:\a\IEMS\renderer\test\wave3b-child.mjs`;
 assert.equal(workerPath(`"C:\\Program Files\\nodejs\\node.exe" "${spaced}" arg`), spaced);
 assert.equal(workerPath(`C:\\node\\node.exe ${plain} arg`), plain);
 assert.equal(workerPath(`"C:\\Program Files\\nodejs\\node.exe" ${plain} arg`), plain);
 assert.equal(workerPath(`C:\\node\\node.exe "${spaced}" arg`), spaced);
 assert.equal(workerPath('node.exe'), undefined);
 assert.notEqual(workerPath(`node.exe ${plain}.other arg`), plain);
 assert.notEqual(workerPath(`node.exe other.mjs ${plain}`), plain);
});
test('owned real Mongo killed transaction and lost receipt recover once; unknown commit retries; template and stored hashes fail closed',async()=>{
 const run=randomUUID().replaceAll('-',''),dbName=`owned_document_${run}`,root=path.resolve('.runtime',run),dir=`evidence/wave3b/recovery-${run}`;
 await fs.mkdir(root,{recursive:true});await fs.mkdir(dir,{recursive:true});
 const repl=await MongoMemoryReplSet.create({binary:{systemBinary:process.env.MONGOMS_SYSTEM_BINARY,version:'7.0.14'},instanceOpts:[{dbPath:root,args:['--setParameter','transactionLifetimeLimitSeconds=2','--setParameter','enableTestCommands=1']}],replSet:{count:1,ip:'127.0.0.1',storageEngine:'wiredTiger'}});
 const client=new MongoClient(repl.getUri());await client.connect();const db=client.db(dbName),owner={_id:'owner',run,dbName};await db.collection('ownership').insertOne(owner);const children=new Set(),evidence={run,dbName,uri:repl.getUri(),kills:[]};
 async function child(mode,snap){
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=fork(path.resolve('test/wave3b-child.mjs'),[repl.getUri(),dbName,run,mode,Buffer.from(JSON.stringify(snap)).toString('base64')],{env,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});children.add(child);let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const exited=once(child,'exit');child.once('exit',()=>children.delete(child));
  const creation=mode==='replay'?null:identity(child.pid);if(creation){assert.ok(Date.parse(creation.CreationDate));assert.equal(creation.ProcessId,child.pid);child.ownedIdentity=creation;assert.equal(workerPath(creation.CommandLine),path.resolve('test/wave3b-child.mjs'));}
  const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CHILD_TIMEOUT '+output)),30000);child.once('message',m=>{clearTimeout(timer);resolve(m);});child.once('error',reject);child.once('exit',code=>{if(code)reject(Error(`CHILD_EXIT ${code} ${output}`));});});
  if(mode==='replay'){const [code,signal]=await exited;children.delete(child);assert.equal(code,0,output);return message;}
  assert.equal(message.phase,mode);assert.equal(message.pid,child.pid);const live=identity(child.pid);assert.equal(live.CreationDate,creation.CreationDate);assert.equal(live.ProcessId,child.pid);assert.equal(workerPath(live.CommandLine),path.resolve('test/wave3b-child.mjs'));
  const exit=once(child,'exit');child.kill('SIGKILL');const [code,signal]=await exit;children.delete(child);evidence.kills.push({mode,pid:creation.ProcessId,creationDate:creation.CreationDate,code,signal});return message;
 }
 try{
  assert.deepEqual(await db.collection('ownership').findOne({_id:'owner'}),owner);
  const issuer=await createIssuer({client,db});
  await child('beforeCommit',snapshot());await new Promise(r=>setTimeout(r,5000));assert.equal(await db.collection('documentIssues').countDocuments(),0);assert.equal(await db.collection('documentArtifacts').countDocuments(),0);
  const recovered=await child('replay',snapshot());assert.equal(recovered.receipt.snapshot.total,'9007199254740993.123');
  await child('afterCommit',snapshot(2));const committed=await db.collection('documentIssues').findOne({sourceVersion:2});assert.ok(committed);const replay=await child('replay',snapshot(2));assert.equal(replay.receipt._id,committed._id);assert.equal(replay.receipt.pdfHash,committed.pdfHash);assert.equal(createHash('sha256').update(Buffer.from(replay.pdf,'base64')).digest('hex'),committed.pdfHash);
  const old=await issuer.issue(scope,snapshot(3,1));await assert.rejects(issuer.issue(scope,snapshot(3,2)),/ISSUE_CONFLICT/);assert.equal((await issuer.read(scope,old._id)).record.template.version,1);
  // Actual mongod commit-command failure, not a driver mock.
  await client.db('admin').command({configureFailPoint:'failCommand',mode:{times:1},data:{failCommands:['commitTransaction'],errorCode:91,errorLabels:['UnknownTransactionCommitResult']}});
  const unknown=await issuer.issue(scope,snapshot(4));assert.equal((await issuer.issue(scope,snapshot(4)))._id,unknown._id);
  assert.equal(await db.collection('documentIssues').countDocuments(),4);assert.equal(await db.collection('documentArtifacts').countDocuments(),4);
  await db.collection('documentIssues').updateOne({_id:unknown._id},{$set:{'snapshot.total':'0.000'}});
  await assert.rejects(issuer.read(scope,unknown._id),/SNAPSHOT_INTEGRITY/);
  await assert.rejects(issuer.issue(scope,snapshot(4)),/SNAPSHOT_INTEGRITY/);
  evidence.unknownCommit=true;evidence.issues=4;evidence.artifacts=4;evidence.receiptRecoveredExactly=true;
 }finally{
  for(const c of children){const exited=once(c,'exit');const live=identity(c.pid);assert.ok(c.ownedIdentity);assert.equal(live.CreationDate,c.ownedIdentity.CreationDate);c.kill('SIGKILL');await exited;}
  assert.deepEqual(await db.collection('ownership').findOne({_id:'owner'}),owner);await db.dropDatabase();await client.close();await repl.stop();await fs.rm(root,{recursive:true,force:true});evidence.cleanup='owner verified, database dropped, client closed, replica stopped, owned directory removed';await fs.writeFile(`${dir}/result.json`,JSON.stringify(evidence,null,2));console.log('WAVE3B_RECOVERY_EVIDENCE '+dir);
 }
});
