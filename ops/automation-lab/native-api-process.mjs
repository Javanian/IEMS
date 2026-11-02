import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {MongoClient} from '../../apps/portfolio-api/node_modules/mongodb/lib/index.js';
import {initialize,createApp,seedSynthetic} from '../../apps/portfolio-api/src/app.mjs';

const root=resolve(process.env.IEMS_AUTOMATION_LAB_ROOT),read=name=>JSON.parse(readFileSync(join(root,name),'utf8')),config=read('config.json');
if(config.native!==true||read('native-owner.json').marker!==config.marker)throw Error('NATIVE_PROCESS_OWNER_REQUIRED');
const client=await new MongoClient(config.mongoUri).connect(),db=client.db(config.database);
if(!await db.collection('ownedRun').findOne({_id:config.marker}))throw Error('NATIVE_PROCESS_DATABASE_OWNER_REQUIRED');
// Private fixture faults only interrupt timing/ACKs; they never supply receipts or provider results.
const fault=async(boundary,proof)=>{
  let request;try{request=read('native-fault.json');}catch{return;}
  if(request.marker!==config.marker||request.boundary!==boundary||request.commandId&&request.commandId!==proof.command._id)return;
  writeFileSync(join(root,'native-fault-reached.json'),JSON.stringify({marker:config.marker,id:request.id,boundary,attemptId:proof.attempt?._id,commandId:proof.command._id}));
  if(request.action==='crash'){process.exit(99);}
  if(request.action==='ack-loss')throw Error('OWNED_NATIVE_ACK_LOSS');
  if(request.action==='hold'){
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){const current=read('native-fault.json');if(current.id!==request.id||current.action==='release')return;await new Promise(r=>setTimeout(r,25));}
    throw Error('OWNED_NATIVE_HOLD_TIMEOUT');
  }
};
const runtime=await initialize({client,db,ownedRunMarker:config.marker,integrations:{effects:{mode:'NATIVE_LOCAL_N8N',controlFault:fault,nativeN8n:{root,instanceId:config.instanceId,evidenceClass:'NATIVE_RUNTIME',webhookToken:config.webhookToken,n8nPackageRoot:config.n8nPackageRoot,workflows:config.nativeBindings}}}});
runtime.automation={get serviceToken(){return read('config.json').serviceToken;},smtpPort:config.ports.smtp,sinkToken:config.sinkToken,sinkUrl:`http://127.0.0.1:${config.ports.inspector}`,n8nUrl:`http://127.0.0.1:${config.ports.n8n}`};
if(!await db.collection('credentials').countDocuments())await seedSynthetic(runtime,{password:config.password});
const server=createApp(runtime,{origins:[`http://127.0.0.1:${config.ports.web}`]}).listen(config.ports.api,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
writeFileSync(join(root,'native-api-ready.json'),JSON.stringify({marker:config.marker,pid:process.pid,processEpoch:runtime.nativeN8nProvider.processEpoch}));
console.log(JSON.stringify({service:'native-api',pid:process.pid,marker:config.marker,port:config.ports.api,instanceId:config.instanceId,processEpoch:runtime.nativeN8nProvider.processEpoch}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await new Promise(r=>server.close(r));await client.close();process.exitCode=0;});
