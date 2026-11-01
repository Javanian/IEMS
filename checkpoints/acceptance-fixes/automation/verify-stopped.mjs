import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import net from 'node:net';
const evidence='D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-157/6e70f0a8-d639-44c1-92db-0b23cdc10ab0';
const roots=['cold-baseline-3e23afde','cold-baseline-v2-3e23afde','cold-fixed-3e23afde'];
const all=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -or $_.Name -like 'mongod*'} | Select-Object ProcessId,ParentProcessId,CreationDate,Name,CommandLine) | ConvertTo-Json -Depth 4 -Compress"],{encoding:'utf8',windowsHide:true})||'[]');
const survivors=all.filter(p=>roots.some(root=>p.CommandLine?.includes(root)));
const mongo=all.filter(p=>p.Name.startsWith('mongod'));
assert.deepEqual(survivors,[]); assert.deepEqual(mongo,[]);
const ports=[];
for(let port=32740;port<=32745;port++){
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); ports.push(port);
}
const states=roots.map(root=>{
  const state=JSON.parse(readFileSync(join(evidence,root,'status.json')));
  return {root,storedPhase:state.phase,storedSupervisorPid:state.supervisorPid,storedProcesses:state.processes,actualOwnedProcessCount:0,meaning:root==='cold-baseline-3e23afde'?'Interrupted initial adapter: stored preflight phase is historical, all owned native processes absent. Private interrupted data retained.':'Normal exact-marker database drop and supervisor shutdown in stdout.log; data/SQLite retained privately.'};
});
writeFileSync(new URL('./CLEANUP.json',import.meta.url),JSON.stringify({observedAt:new Date().toISOString(),survivors,mongo,portsBoundAndClosed:ports,states,limitation:'CLI PIDs and launch/exit times are recorded, but historical per-CLI OS CreationDate was not sampled. Captured running supervisor/Mongo/engine OS identities are in external os-identities*.json. No identities are invented.',unrelatedStopOrDelete:false},null,2)+'\n');
console.log('Cleanup PASS:0 matching owned runtime,0 Mongo,6 reserved ports bind/close. Private data retained.');
