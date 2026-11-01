import { Server } from 'node:http';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const path=process.env.TPR166_UNIT_RESOURCE_LOG;
if(!path)throw Error('Assigned unit resource log required');
const event=value=>appendFileSync(path,JSON.stringify({at:new Date().toISOString(),pid:process.pid,...value})+'\n');
const listen=Server.prototype.listen;
Server.prototype.listen=function(...args){
  this.once('listening',()=>{
    const address=this.address();
    const identity=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));
    event({kind:'unit-http-listening',address,identity});
    this.once('close',()=>event({kind:'unit-http-closed',address}));
  });
  return listen.apply(this,args);
};
