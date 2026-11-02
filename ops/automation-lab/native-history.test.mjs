import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {startNativeLab,until,save,read,history,mail} from './native-probe-support.mjs';
import {contentHash} from '../../packages/tenant-foundation/commands.mjs';
import {effectHash} from '../../packages/tenant-lifecycle/effects.mjs';
import {admissionProfile} from '../../packages/tenant-lifecycle/admission.mjs';
import {nativeN8nBinding,inspectNativeN8nHistory,createNativeN8nProvider} from '../../packages/tenant-lifecycle/native-n8n-provider.mjs';

const enabled=Boolean(process.env.IEMS_NATIVE_REVIEWED_SHA);
let lab,db,send,call,cookie,beta,tenant,member;
before(async()=>{
  if(!enabled)return;
  lab=await startNativeLab();db=lab.db;
  console.log(JSON.stringify({nativeEvidenceRoot:lab.root,marker:lab.config.marker,supervisorPid:lab.child.pid}));
  send=async(path,body,options={})=>{
    const response=await fetch(`http://127.0.0.1:${lab.config.ports.api}/api${path}`,{method:body===undefined?'GET':'POST',headers:{origin:`http://127.0.0.1:${lab.config.ports.web}`,'content-type':'application/json',...(options.cookie??cookie?{cookie:options.cookie??cookie}:{}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
    return {status:response.status,headers:response.headers,...await response.json()};
  };
  for(const username of ['alpha.owner','beta.owner']){const result=await send('/session/login',{username,password:lab.config.password});assert.equal(result.status,200);const value=result.headers.get('set-cookie').split(';')[0];if(username==='alpha.owner')cookie=value;else beta=value;}
  call=(path,body={},key=randomUUID(),options={})=>send('/cs/automation'+path,body,{...options,headers:{'Idempotency-Key':key,...options.headers}});
  const credential=await db.collection('credentials').findOne({username:'alpha.owner'});member=await db.collection('memberships').findOne({userId:credential._id});tenant=member.tenantId;
  const plant=(await db.collection('plants').findOne({tenantId:tenant}))._id;
  await db.collection('memberships').updateOne({_id:member._id},{$set:{tenantWide:true,roles:[{role:'owner',plantIds:[plant],tenantWide:false},{role:'saasUser',plantIds:[plant],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true}]}});
  const subscribed=await send('/saas/subscribe',{key:randomUUID(),expectedRevision:0,reason:'Owned native integration proof',plan:'pilot',admissionProfile});assert.equal(subscribed.status,200,JSON.stringify(subscribed));
},{timeout:300000});
after(async()=>{if(lab)await lab.close();},{timeout:60000});

test('actual owned n8n history and SMTP preserve managed attempt identity',{skip:!enabled,timeout:180000},async t=>{
  const sub=()=>db.collection('saasSubscriptions').findOne({tenantId:tenant});
  const control=(commandId,phase,action='continue')=>send(`/saas/effects/${commandId}/${action}`,phase?{phase}:{});
  const attempt=commandId=>db.collection('saasEffectAttempts').findOne({commandId},{sort:{ordinal:-1}});
  const digest=async()=>{const result=await call('/digest/dispatch',{mode:'DEMO',periodKey:randomUUID()});assert.equal(result.status,200,JSON.stringify(result));return db.collection('cs_outbox').findOne({_id:result.data.deliveryId});};
  const recover=async delivery=>{const r=await call('/reconcile',{deliveryIds:[delivery._id]});assert.equal(r.status,202,JSON.stringify(r));return r.effect.commandId;};
  const exact=async delivery=>{
    const a=await attempt(delivery.controlCommandId),binding=nativeN8nBinding(a,{providerId:'native.n8n',instanceId:lab.config.instanceId}),workflow=lab.config.nativeBindings.find(w=>w.workflowId===binding.workflowId);
    const proof=await until(()=>{const p=inspectNativeN8nHistory({binding,workflow,executions:history(lab),mail:mail(lab)});return p.state==='TERMINAL'&&p;});
    assert.equal(proof.smtp.receiptId,mail(lab).find(row=>row.headers['x-iems-native-correlation']===a.providerKey)?.id);
    assert.equal(a.providerKey,contentHash({tenantId:tenant,commandId:a.commandId,phase:a.phase,ordinal:a.ordinal}));assert.equal(a.inputHash,effectHash(a.input));
    return {a,binding,workflow,proof};
  };
  const fault=(delivery,boundary,action='hold')=>{const value={id:randomUUID(),marker:lab.config.marker,commandId:delivery.controlCommandId,boundary,action};save(join(lab.root,'native-fault.json'),value);return value;};
  const reached=f=>until(()=>{try{const r=read(join(lab.root,'native-fault-reached.json'));return r.id===f.id&&r;}catch{return null;}});
  const release=f=>save(join(lab.root,'native-fault.json'),{...f,action:'release'});
  let original,originalParent,originalProof;

  await t.test('API engine acceptance, native execution, managed child, SMTP and explicit reconciliation',async()=>{
    const initialUsage=BigInt((await sub()).usage.apiCalls);
    const periodKey=randomUUID(),key=randomUUID(),accepted=await call('/run/wf-cs-weekly-digest',{mode:'DEMO',periodKey},key);assert.equal(accepted.status,202,JSON.stringify(accepted));
    assert.equal(BigInt((await sub()).usage.apiCalls),initialUsage+1n,'One engine acceptance root');
    const engineId=accepted.effect.commandId,engineReceipt=await db.collection('automation_audit_logs').findOne({tenantId:tenant,idempotencyKey:key});
    let result=await control(engineId);if(result.status!==200)result=await control(engineId,null,'observe');assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(BigInt((await sub()).usage.apiCalls),initialUsage+2n,'The workflow creates one distinct digest business intent');
    const engineAttempt=await attempt(engineId);assert.equal(engineAttempt.state,'SETTLED');assert.equal(engineAttempt.provider.receipt.result.deliveryState,null);assert.ok(history(lab).some(row=>String(row.id)===engineAttempt.provider.receipt.result.executionId));
    original=await db.collection('cs_outbox').findOne({tenantId:tenant,'controlCommandId':{$exists:true},kind:'DIGEST'},{sort:{createdAt:-1}});assert.ok(original);
    originalParent=await recover(original);const usage=(await sub()).usage.apiCalls;
    assert.equal(BigInt(usage),initialUsage+3n,'One separate explicit recovery selection root; its delivery child is nonbillable');
    const outcomes=await Promise.all([control(originalParent),control(originalParent)]);assert.ok(outcomes.some(r=>r.status===200),JSON.stringify(outcomes));
    originalProof=await exact(original);if((await attempt(original.controlCommandId)).state!=='SETTLED')assert.equal((await send(`/saas/effects/${originalParent}/children/${original.controlCommandId}/continue`,{phase:original._id})).status,200);
    assert.equal((await db.collection('cs_outbox').findOne({_id:original._id})).deliveryState,'ACCEPTED_LOCAL');assert.equal((await sub()).usage.apiCalls,usage);
    assert.deepEqual((await db.collection('automation_audit_logs').findOne({_id:engineReceipt._id})).result,engineReceipt.result);
    const child=await db.collection('saasEffectCommands').findOne({_id:original.controlCommandId});assert.deepEqual((await db.collection('automation_audit_logs').findOne(child.owner.identity)).result,child.acceptedResult);
    assert.equal((await call('/run/wf-cs-weekly-digest',{mode:'DEMO',periodKey},key)).data.state,'ACCEPTED');assert.equal((await call('/run/wf-cs-weekly-digest',{mode:'DEMO',periodKey:'changed'},key)).status,409);
  });

  await t.test('lost actual webhook ACK survives engine and API/provider restart without resend',async()=>{
    const d=await digest(),parent=await recover(d),f={id:randomUUID(),marker:lab.config.marker,commandId:d.controlCommandId,action:'drop-ack'};save(join(lab.root,'native-proxy-fault.json'),f);
    const result=await control(parent);assert.equal(result.data.status,'NEEDS_REVIEW',JSON.stringify(result));
    assert.equal(read(join(lab.root,'native-proxy-fault-reached.json')).id,f.id);const before=await exact(d);assert.equal(before.a.state,'UNKNOWN');const count=mail(lab).length,usage=(await sub()).usage.apiCalls;
    await lab.control('stop-n8n');await lab.control('restart-api');await lab.control('start-n8n');
    const epoch=read(join(lab.root,'native-api-ready.json')).processEpoch;assert.notEqual(epoch,before.a.instanceEpoch);
    const recovery=await recover(d),charged=(await sub()).usage.apiCalls;assert.equal(BigInt(charged),BigInt(usage)+1n);
    assert.equal((await control(recovery)).data.status,'RECONCILED_LOCAL');const after=await attempt(d.controlCommandId);
    for(const field of ['_id','commandId','phase','ordinal','fence','epoch','instanceEpoch','providerKey','inputHash'])assert.equal(after[field],before.a[field],field);
    assert.deepEqual(after.parent,before.a.parent);assert.equal(after.provider.receipt.result.executionId,before.proof.executionId);assert.equal(after.provider.receipt.result.smtp.receiptId,before.proof.smtp.receiptId);assert.equal(mail(lab).length,count);assert.equal((await sub()).usage.apiCalls,charged);
    assert.equal(await db.collection('saasEffectAttempts').countDocuments({commandId:d.controlCommandId}),1);
  });

  await t.test('original history rejects wrong scope, fence, selection, missing and contradictory diagnostics',async()=>{
    const {binding,workflow}=originalProof,executions=history(lab),receipts=mail(lab);
    for(const changed of [{tenantId:randomUUID()},{attemptId:randomUUID()},{fence:binding.fence+1},{epoch:binding.epoch+1},{inputHash:'0'.repeat(64)},{recipientHash:'0'.repeat(64)},{workflowHash:'0'.repeat(64)}])assert.equal(inspectNativeN8nHistory({binding:{...binding,...changed},workflow,executions,mail:receipts}).state,'UNKNOWN');
    const selected=executions.filter(row=>String(row.id)===originalProof.proof.executionId);
    for(const rows of [[],[...selected,...selected],[{...selected[0],deletedAt:new Date().toISOString()}],[{...selected[0],status:'error'}]])assert.equal(inspectNativeN8nHistory({binding,workflow,executions:rows,mail:receipts}).state,'UNKNOWN');
    assert.equal(inspectNativeN8nHistory({binding,workflow,executions,mail:[]}).state,'UNKNOWN');
    // These negative copies never enter the NATIVE_RUNTIME SQLite database or SMTP journal.
  });

  await t.test('all status reads and scoped negatives leave the database unchanged',async()=>{
    const snapshot=async()=>{const rows={};for(const {name} of await db.listCollections().toArray())rows[name]=await db.collection(name).find({}).sort({_id:1}).toArray();return rows;};
    const before=await snapshot();for(const id of [original.controlCommandId,originalParent])assert.equal((await send(`/saas/effects/${id}`)).status,200);
    assert.equal((await send(`/saas/effects/${original.controlCommandId}`,undefined,{cookie:beta})).status,404);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await call('/reconcile',{mode:'LOCAL_OBSERVE_V1',deliveryIds:[original._id]})).status,409);
    assert.equal((await call('/reconcile',{deliveryIds:[original._id]},randomUUID(),{headers:{origin:'http://untrusted.invalid'}})).status,403);
    assert.equal((await send(`/saas/effects/${originalParent}/children/${randomUUID()}/continue`,{phase:original._id})).status,404);
  });

  await t.test('service revocation and source mutation before BEGIN prevent native send',async()=>{
    for(const change of ['service','source']){
      const d=await digest(),f=fault(d,'beforeProviderBegin'),running=control(d.controlCommandId,d._id);await reached(f);const count=mail(lab).length;
      if(change==='service')await db.collection('sessions').updateOne({_id:lab.config.serviceSessionId},{$set:{revoked:true}});
      else await db.collection('cs_outbox').updateOne({_id:d._id},{$set:{contentHash:'0'.repeat(64)}});
      release(f);const result=await running;assert.notEqual(result.status,200,JSON.stringify(result));assert.equal((await attempt(d.controlCommandId)).provider,undefined);assert.equal(mail(lab).length,count);
      if(change==='service')await db.collection('sessions').updateOne({_id:lab.config.serviceSessionId},{$set:{revoked:false}});
      else await db.collection('cs_outbox').updateOne({_id:d._id},{$set:{contentHash:d.contentHash}});
    }
  });

  await t.test('late real SMTP proof survives source change and revocation without publication',async()=>{
    for(const change of ['source','service']){
      const d=await digest(),f=fault(d,'afterInvoke'),running=control(d.controlCommandId,d._id);await reached(f);const proof=await exact(d);
      if(change==='service')await db.collection('sessions').updateOne({_id:lab.config.serviceSessionId},{$set:{revoked:true}});
      else await db.collection('cs_outbox').updateOne({_id:d._id},{$set:{contentHash:'0'.repeat(64)}});
      release(f);const result=await running;assert.equal(result.data?.state,'PUBLICATION_DENIED',JSON.stringify(result));
      assert.equal((await attempt(d.controlCommandId)).provider.receipt.result.smtp.receiptId,proof.proof.smtp.receiptId);assert.equal((await db.collection('cs_outbox').findOne({_id:d._id})).deliveryState,'SENDING');
      if(change==='service')await db.collection('sessions').updateOne({_id:lab.config.serviceSessionId},{$set:{revoked:false}});
      else await db.collection('cs_outbox').updateOne({_id:d._id},{$set:{contentHash:d.contentHash}});
    }
  });

  await t.test('API crash after actual send recovers original proof and never renders a new intent',async()=>{
    const d=await digest();fault(d,'afterInvoke','crash');await control(d.controlCommandId,d._id).catch(()=>{});const before=await exact(d),count=mail(lab).length;
    assert.notEqual(before.a.state,'SETTLED');await lab.control('restart-api');
    const result=await control(d.controlCommandId,d._id,'observe');assert.equal(result.status,200,JSON.stringify(result));assert.equal((await attempt(d.controlCommandId))._id,before.a._id);assert.equal(mail(lab).length,count);
  });

  await t.test('native engine source mutation after execution retains private proof and denies publication',async()=>{
    const credential=await db.collection('credentials').findOne({username:'alpha.owner'}),bindingId=randomUUID(),ticketId=randomUUID(),customerId=randomUUID(),scope={tenantId:tenant,plantId:credential.plantId};
    await db.collection('cs_contact_bindings').insertOne({_id:bindingId,...scope,customerId,synthetic:true,channelAccountId:'SIMULATED',status:'ACTIVE',expiresAt:null,version:1});
    await db.collection('cs_tickets').insertOne({_id:ticketId,...scope,customerId,bindingId,version:1,stage:'RESOLVED'});
    const accepted=await call('/run/wf-sla-escalation',{ticketId});assert.equal(accepted.status,202,JSON.stringify(accepted));const commandId=accepted.effect.commandId;
    const f=fault({controlCommandId:commandId},'afterInvoke'),running=control(commandId);await reached(f);
    await db.collection('cs_tickets').updateOne({_id:ticketId},{$inc:{version:1}});release(f);
    const result=await running;assert.equal(result.data?.state,'PUBLICATION_DENIED',JSON.stringify(result));assert.equal(result.data.reason,'ENGINE_RUN_SOURCE_CHANGED');
    const a=await attempt(commandId);assert.equal(a.provider.state,'TERMINAL');assert.ok(history(lab).some(row=>String(row.id)===a.provider.receipt.result.executionId));assert.equal((await db.collection('automation_engine_runs').findOne({_id:commandId})).state,'ACCEPTED');
  });

  await t.test('delayed child and racing recovery are fenced by exact stop epoch and attempt barrier',async()=>{
    const d=await digest(),parent=await recover(d),f=fault(d,'beforeProviderBegin'),running=control(parent);await reached(f);
    const originalAttempt=await attempt(d.controlCommandId),count=mail(lab).length;
    const active=await digest(),held={id:randomUUID(),marker:lab.config.marker,commandId:active.controlCommandId,action:'hold-before-forward'};save(join(lab.root,'native-proxy-fault.json'),held);
    const crossing=control(active.controlCommandId,active._id);await until(()=>{try{return read(join(lab.root,'native-proxy-fault-reached.json')).id===held.id;}catch{return false;}});
    assert.equal((await attempt(active.controlCommandId)).provider.state,'BEGUN');
    const s=await sub(),suspended=await send('/saas/suspend',{key:randomUUID(),expectedRevision:s.revision,reason:'Owned native delayed-child drain'});assert.equal(suspended.status,200,JSON.stringify(suspended));
    const competing=control(parent);const drain=send('/saas/quiesce',{});release(f);await running;await competing;
    const pending=await drain;assert.equal(pending.data?.state,'PENDING',JSON.stringify(pending));assert.equal(mail(lab).length,count);
    save(join(lab.root,'native-proxy-fault.json'),{...held,action:'release'});const crossed=await crossing;assert.equal(crossed.data?.state,'PUBLICATION_DENIED',JSON.stringify(crossed));await exact(active);
    const result=await send('/saas/quiesce',{});assert.equal(result.data?.state,'QUIESCENT',JSON.stringify(result));assert.equal(mail(lab).length,count+1);
    const canceled=await attempt(d.controlCommandId);assert.equal(canceled._id,originalAttempt._id);assert.equal(canceled.state,'NOT_PERFORMED');assert.equal(canceled.provider,undefined);
    const barrier=await db.collection('saasEffectBarriers').findOne({tenantId:tenant,adapterId:'native.n8n'},{sort:{verifiedAt:-1}}),owner=await db.collection('tenants').findOne({_id:tenant});assert.ok(barrier);
    assert.equal(barrier.proof.highWater,owner.saasEffectHighWater);assert.equal(barrier.proof.stopEpoch,owner.saasEffectEpoch);assert.equal(barrier.proofHash,effectHash(barrier.proof));
    const attempts=await db.collection('saasEffectAttempts').find({tenantId:tenant,adapterId:'native.n8n'}).toArray();assert.deepEqual(barrier.proof.attemptSet.map(x=>x.attemptId).sort(),attempts.map(x=>x._id).sort());
    for(const a of attempts){const item=barrier.proof.attemptSet.find(x=>x.attemptId===a._id);for(const field of ['commandId','phase','ordinal','instanceEpoch','epoch','fence','inputHash','providerKey'])assert.equal(item[field],a[field],field);assert.equal(item.receiptHash,a.provider?.proofHash??null);}
    await lab.control('restart-api');assert.notEqual(read(join(lab.root,'native-api-ready.json')).processEpoch,barrier.instanceEpoch);assert.notEqual((await control(d.controlCommandId,d._id)).status,200);assert.equal(mail(lab).length,count+1);
    assert.equal((await send('/saas/quiesce',{})).data.state,'QUIESCENT');
  });

  await t.test('actual owned engine pruning makes a fresh branded history observation fail closed',async()=>{
    const cfg=lab.config,provider=await createNativeN8nProvider({client:lab.client,db,ownedRunMarker:cfg.marker,root:lab.root,instanceId:cfg.instanceId,n8nPackageRoot:cfg.n8nPackageRoot,webhookToken:cfg.webhookToken,workflows:cfg.nativeBindings});
    const a=await attempt(original.controlCommandId);assert.ok(await provider.observe(a));
    save(join(lab.root,'pre-prune-history.private.json'),{marker:cfg.marker,executions:history(lab),mail:mail(lab)});
    const base=`http://127.0.0.1:${cfg.ports.n8n}`,login=await fetch(base+'/rest/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({emailOrLdapLoginId:cfg.n8nEmail,password:cfg.n8nPassword})});assert.equal(login.status,200);
    const ownerCookie=login.headers.get('set-cookie').split(';')[0],removed=await fetch(base+'/rest/executions/delete',{method:'POST',headers:{'content-type':'application/json',cookie:ownerCookie},body:JSON.stringify({ids:[originalProof.proof.executionId]})});assert.equal(removed.status,200);
    assert.equal(await provider.observe(a),null,'No reconstructed terminal proof after actual native history deletion');
    assert.equal((await attempt(original.controlCommandId)).provider.receipt.result.executionId,originalProof.proof.executionId,'Previously retained private receipt remains immutable');
  });

  await t.test('private payload and tokens stay outside all four orchestration collections',async()=>{
    const secrets=[lab.config.password,lab.config.serviceToken,lab.config.webhookToken,lab.config.sinkToken,original.body];
    for(const name of ['saasEffectCommands','saasEffectAttempts','saasEffectEvents','saasEffectBarriers']){const value=JSON.stringify(await db.collection(name).find({}).toArray());for(const secret of secrets)assert.ok(secret&&!value.includes(secret),name);}
    save(join(lab.root,'assertion-ledger.json'),{marker:lab.config.marker,reviewedSha:process.env.IEMS_NATIVE_REVIEWED_SHA,completedAt:new Date().toISOString(),executionIds:history(lab).map(x=>String(x.id)),smtpReceiptIds:mail(lab).map(x=>x.id),fullEndpointCoverage:false,product:'UNACCEPTED',qualification:'Producer native integration; actual service-owned prune plus read-only malformed/contradictory diagnostic copies; no manufactured native rows'});
  });
});
