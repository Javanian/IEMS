import { MongoClient } from 'mongodb';
import { createIssuer } from '../src/index.mjs';
const [uri,dbName,run,mode,encoded]=process.argv.slice(2);
if(!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)||dbName!==`owned_document_${run}`||!/^[a-f0-9]{32}$/.test(run))throw Error('OWNERSHIP_REFUSED');
const client=new MongoClient(uri);await client.connect();const db=client.db(dbName);
if((await db.collection('ownership').findOne({_id:'owner'}))?.run!==run)throw Error('OWNERSHIP_REFUSED');
const snapshot=JSON.parse(Buffer.from(encoded,'base64').toString());
const pause=async phase=>{process.send({phase,pid:process.pid});await new Promise(()=>{setInterval(()=>{},1000);});};
if(mode==='beforeCommit'){
 const start=client.startSession.bind(client);client.startSession=(...args)=>{const session=start(...args),transaction=session.withTransaction.bind(session);session.withTransaction=(callback,opts)=>transaction(async()=>{const receipt=await callback();await pause('beforeCommit');return receipt;},opts);return session;};
}
const issuer=await createIssuer({client,db});const receipt=await issuer.issue(snapshot.scope,snapshot);
if(mode==='afterCommit')await pause('afterCommit');
const artifact=await issuer.read(snapshot.scope,receipt._id);process.send({phase:'result',receipt,pdf:artifact.pdf.toString('base64')});await client.close();process.disconnect();
