import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startOwned} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {runE02Prefix,e02Fixture} from '../../apps/portfolio-api/test/support/review-e02-flow.mjs';
import {admissionProfile} from './admission.mjs';
import {businessRegistry,verifySourceSchemas} from './domain-port.mjs';
import {verifyAdmissionSources,admissionRegistry} from './admission-registry.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
test('v9 actual typed repair/POD receipts reauthorize source and never recharge replay',{timeout:240000},async t=>{
 await verifySourceSchemas();await verifyAdmissionSources();
 for(const name of ['repairSalesOrders','repairWorkOrders','repairOrderRevisions','repairReturnAuthorities'])assert.equal(businessRegistry.collections[name].disposition,'BUSINESS');
 for(const path of ['repair-orders','repair-return'])assert.ok(businessRegistry.sources[`apps/portfolio-api/src/${path}.mjs`]);
 assert.equal(admissionRegistry.routes.length,400);
 let clock=new Date(e02Fixture.repair_case.intake_date);const h=await startOwned(t,{businessClock:()=>clock});
 const flow=await runE02Prefix(h,{setClock:value=>clock=value});const a=h.seeded[0],db=h.db;
 // This focused receipt fixture exercises the original rejection return; accepted spare trace remains owner142's failing full-chain prerequisite.
 flow.replay=[];
 const variant=e02Fixture.rejection_variant,path=`/repair/cases/${flow.case._id}`;
 const command=body=>({idempotencyKey:randomUUID(),...body});
 const step=async(action,body)=>{const input=command({expectedVersion:flow.case.version,evidence:'Original synthetic rejection receipt proof',...body});flow.case=await h.ok(`${path}/${action}`,input);flow.replay.push({path:`${path}/${action}`,body:input,result:flow.case});};
 clock=new Date(variant.customer_rejection.rejected_at);
 await step('decide',{decision:'REJECT',revision:flow.case.scopes.at(-1).revision,diagnosticFee:e02Fixture.diagnostic_authorization.capped_diagnostic_fee});
 await step('orders',{});flow.serviceWorkOrder=await h.ok(`/repair/work-orders/${flow.case.serviceOrders.workOrderId}`);
 flow.invoice=await h.ok(`/repair/invoices/${flow.case.diagnosticInvoiceId}`);
 clock=new Date(variant.diagnostic_payment.received_at);
 const payment=command({expectedVersion:flow.invoice.version,amount:variant.diagnostic_payment.amount_received,currency:'USD',reference:variant.diagnostic_payment.payment_reference});
 flow.invoice=await h.ok(`/repair/invoices/${flow.invoice._id}/settle`,payment);flow.replay.push({path:`/repair/invoices/${flow.invoice._id}/settle`,body:payment,result:flow.invoice});
 clock=new Date(variant.return_unrepaired_shipment.dispatched_at);
 await step('return',{shipmentMode:'RETURN_UNREPAIRED',carrier:e02Fixture.return_shipment.carrier,reference:variant.return_unrepaired_shipment.shipment_number,packaging:variant.return_unrepaired_shipment.packaging_notes,uom:variant.return_unrepaired_shipment.lines[0].uom});
 flow.shipment=flow.case.returnDispatch;
 const deliveryPath=`/deliveries/shipments/${flow.shipment.shipmentId}`,view=await h.ok(deliveryPath),podFixture=variant.return_unrepaired_shipment.proof_of_delivery;
 clock=new Date(podFixture.delivered_at);
 const podBody=command({expectedVersion:view.version,expectedShipmentVersion:view.shipmentVersion,quantity:'1',serials:[flow.case.serial],deliveredAt:new Date(podFixture.delivered_at).toISOString(),receiverName:podFixture.receiver_name,receiverReference:podFixture.receiver_badge,evidenceReference:podFixture.pod_id,evidenceNotes:'Original synthetic rejection POD receipt proof'});
 flow.delivery=await h.ok(`${deliveryPath}/confirmations`,podBody,201);flow.replay.push({path:`${deliveryPath}/confirmations`,body:podBody,result:flow.delivery,status:201});
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false}];
 await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});
 await h.ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'Owned v9 replay source proof',admissionProfile});
 const subscription=()=>db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});
 const counts=()=>Promise.all(['repairKeys','deliveryKeys','repairPayments','repairOrderRevisions','repairReturnAuthorities','fulfillmentShipments','deliveryConfirmations','repairAudit','repairOutbox','deliveryAudit','deliveryOutbox'].map(n=>db.collection(n).countDocuments({tenantId:a.tenantId})));
 const before=await counts(),usage=(await subscription()).usage;
 const pod=flow.replay.find(e=>e.path.endsWith('/confirmations')),settle=flow.replay.find(e=>e.path.includes('/invoices/')),orders=flow.replay.find(e=>e.path.endsWith('/orders'));assert.ok(pod&&settle&&orders);
 const savedPod=await db.collection('deliveryKeys').findOne({key:pod.body.idempotencyKey});
 assert.equal(Object.hasOwn(pod.result,'salesOrderId'),false);assert.equal(savedPod.result.salesOrderId,null);
 // Assert the exact historical Mongo response; the first HTTP view omitted this undefined optional field.
 pod.result=JSON.parse(JSON.stringify(savedPod.result));
 await t.test('actual original receipt responses survive later state/version and charge zero',async()=>{
  for(const entry of flow.replay)assert.deepEqual(await h.ok(entry.path,entry.body,entry.status??200),entry.result);
  assert.deepEqual(await counts(),before);assert.deepEqual((await subscription()).usage,usage);
 });
 await t.test('conflicting hash and missing use authority reject without effect',async()=>{
  const conflict=await h.req(pod.path,{...pod.body,evidenceNotes:'Conflicting original receipt'},h.alpha);assert.equal(conflict.error.code,'IDEMPOTENCY_CONFLICT');
  await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:roles.filter(r=>r.role!=='saasUser')}});
  try{for(const entry of [pod,settle,orders])assert.equal((await h.req(entry.path,entry.body,h.alpha)).status,403);}finally{await db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles}});}
  assert.deepEqual(await counts(),before);assert.deepEqual((await subscription()).usage,usage);
 });
 await t.test('current case hold rejects repair and POD replay, restoring source permits original result',async()=>{
  await db.collection('repairCases').updateOne({_id:flow.case._id},{$set:{holdActive:true}});
  try{for(const entry of [pod,settle,orders]){const r=await h.req(entry.path,entry.body,h.alpha);assert.equal(r.status,409,JSON.stringify(r));}}
  finally{await db.collection('repairCases').updateOne({_id:flow.case._id},{$set:{holdActive:false}});}
  assert.deepEqual(await h.ok(pod.path,pod.body,201),pod.result);assert.deepEqual((await subscription()).usage,usage);
 });
 await t.test('deleted work-order source rejects settle/case replay; persisted return authority mismatch never falls through legacy',async()=>{
  const wo=await db.collection('repairWorkOrders').findOne({_id:flow.serviceWorkOrder._id});await db.collection('repairWorkOrders').deleteOne({_id:wo._id});
  try{for(const entry of [settle,orders]){const r=await h.req(entry.path,entry.body,h.alpha);assert.ok([404,409].includes(r.status),JSON.stringify(r));}}
  finally{await db.collection('repairWorkOrders').insertOne(wo);}
  const shipment=await db.collection('fulfillmentShipments').findOne({_id:flow.shipment.shipmentId});await db.collection('fulfillmentShipments').updateOne({_id:shipment._id},{$set:{sourceKind:'MANUFACTURED',schema:'LEGACY'}});
  try{const r=await h.req(pod.path,pod.body,h.alpha);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.error.code,'DELIVERY_SOURCE_INVALID');}
  finally{await db.collection('fulfillmentShipments').replaceOne({_id:shipment._id},shipment);}
  const authority=await db.collection('repairReturnAuthorities').findOne({shipmentId:shipment._id});await db.collection('repairReturnAuthorities').deleteOne({_id:authority._id});
  try{assert.equal((await h.req(pod.path,pod.body,h.alpha)).status,409);}finally{await db.collection('repairReturnAuthorities').insertOne(authority);}
  assert.deepEqual(await counts(),before);assert.deepEqual((await subscription()).usage,usage);
 });
 await t.test('historical delivery event tamper rejects replay and rolls back fences',async()=>{
  const event=await db.collection('deliveryEvents').findOne({shipmentId:flow.shipment.shipmentId,version:pod.result.version});assert.ok(event);await db.collection('deliveryEvents').updateOne({_id:event._id},{$set:{'snapshot.status':'CORRUPT'}});
  try{assert.equal((await h.req(pod.path,pod.body,h.alpha)).status,409);}finally{await db.collection('deliveryEvents').replaceOne({_id:event._id},event);}
  assert.deepEqual(await h.ok(settle.path,settle.body),settle.result);assert.deepEqual(await h.ok(pod.path,pod.body,201),pod.result);assert.deepEqual(await counts(),before);assert.deepEqual((await subscription()).usage,usage);
 });
 await t.test('replay ignores exhausted new-command quota, abort preserves receipts and source fences',async()=>{
  const original=await subscription();await db.collection('saasSubscriptions').updateOne({_id:original._id},{$set:{'usage.apiCalls':'10000'}});
  try{assert.deepEqual(await h.ok(pod.path,pod.body,201),pod.result);assert.equal((await subscription()).usage.apiCalls,'10000');}
  finally{await db.collection('saasSubscriptions').replaceOne({_id:original._id},original);}
  const source=await db.collection('repairCases').findOne({_id:flow.case._id});
  await db.command({collMod:'saasSubscriptions',validator:{$expr:{$eq:[1,2]}},validationLevel:'strict',validationAction:'error'});
  try{assert.equal((await h.req(settle.path,settle.body,h.alpha)).status,500);}
  finally{await db.command({collMod:'saasSubscriptions',validator:{},validationLevel:'strict',validationAction:'error'});}
  assert.equal((await db.collection('repairCases').findOne({_id:flow.case._id})).repairUseFence,source.repairUseFence);assert.deepEqual(await counts(),before);assert.deepEqual((await subscription()).usage,usage);
 });
 await t.test('bounded actual tenant export includes new service authority and history collections',async()=>{
  const unknown=[],privateFields=[],privateNames=/^(?:password|passwordHash|salt|secret|secretKey|privateKey|token|tokenHash|accessToken|refreshToken|cookie|authorization|pin|pinHash|nfcHash|biometric|biometricTemplate|messageBody|rawMessage|recipientToken)$/i,allFields=new Set(Object.values(businessRegistry.sources).flatMap(s=>s.fields));
  for(const [name,spec]of Object.entries(businessRegistry.collections))if(spec.disposition==='BUSINESS') {
    const fields=new Set(spec.fields??spec.sources.flatMap(path=>businessRegistry.sources[path].fields));
    for(const row of await db.collection(name).find({tenantId:a.tenantId}).toArray()) {
      const visit=(value,path=[],depth=0)=>{if(!value||typeof value!=='object'||value instanceof Date||value._bsontype||Buffer.isBuffer(value))return;if(Array.isArray(value)){for(const v of value)visit(v,path,depth+1);return;}for(const [key,v]of Object.entries(value)){if(privateNames.test(key))privateFields.push(name+':'+[...path,key].join('.'));if(!(depth===0?fields:allFields).has(key))unknown.push(name+':'+[...path,key].join('.'));visit(v,[...path,key],depth+1);}};visit(row);
    }
  }
  assert.deepEqual([...new Set(privateFields)].sort(),['repairInvoices:authorization','repairKeys:result.authorization'],'only explicitly registered diagnostic business authorization appears');
  assert.deepEqual([...new Set(unknown)],[],'actual source corpus has unregistered fields');
  const invoice=await db.collection('repairInvoices').findOne({_id:flow.invoice._id});
  for(const authorization of ['Bearer synthetic-forbidden',{...invoice.authorization,secretKey:'synthetic-forbidden'}]) {
    await db.collection('repairInvoices').updateOne({_id:invoice._id},{$set:{authorization}});
    try{const denied=await h.req('/saas/export',{key:randomUUID(),expectedRevision:(await subscription()).revision,reason:'Owned privacy boundary fault'},h.alpha);assert.equal(denied.error.code,'TENANT_PRIVATE_FIELD');}
    finally{await db.collection('repairInvoices').replaceOne({_id:invoice._id},invoice);}
  }
  const exported=await h.ok('/saas/export',{key:randomUUID(),expectedRevision:(await subscription()).revision,reason:'Owned v9 graph proof'});
  const downloaded=await h.ok('/saas/download',{archiveId:exported.data.archiveId});
  for(const name of ['repairSalesOrders','repairWorkOrders','repairOrderRevisions','repairReturnAuthorities'])assert.ok(downloaded.snapshot.resources.some(row=>row.collection===name),name);
  const proof={archiveId:exported.data.archiveId,digest:exported.data.digest},admin=async(action,extra={})=>h.ok('/saas/'+action,{key:randomUUID(),expectedRevision:(await subscription()).revision,reason:'Owned v9 BSON graph restore proof',...extra});
  await admin('suspend');await admin('delete',proof);
  assert.equal(await db.collection('repairReturnAuthorities').countDocuments({tenantId:a.tenantId}),0);
  assert.ok(await db.collection('credentials').findOne({_id:a.userId}));
  await admin('restore',proof);
  const again=await admin('export');assert.equal(again.data.digest,proof.digest,'exact E02 graph/history/BSON authorization survives restore');
  assert.deepEqual(await counts(),before);

 });
 t.diagnostic(JSON.stringify({scope:'synthetic actual E02 source fixture for v9 receipt proof, not independent final acceptance',caseId:flow.case._id,invoiceId:flow.invoice._id,shipmentId:flow.shipment.shipmentId,orders:flow.serviceWorkOrder._id,receiptCommands:flow.replay.length,usageBefore:usage,usageAfter:(await subscription()).usage}));
});
