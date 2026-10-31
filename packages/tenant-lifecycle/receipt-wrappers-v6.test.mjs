import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startOwned,orderWithStock} from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import {ownerPurchasedFixture,command} from '../../apps/portfolio-api/test/support/purchased-owner-fixture.mjs';
import {companyOwnerFixture} from '../../apps/portfolio-api/test/support/company-stock-owner-fixture.mjs';
import {admissionProfile} from './admission.mjs';
import {allSnapshot} from '../../apps/portfolio-api/test/support/company-stock-readiness-owner-fixture.mjs';
process.env.MONGOMS_RUNTIME_DOWNLOAD='false';
const financial={taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'V6 real source fixture',quantity:'2',uom:'KG',unitPrice:'1.00',currency:'USD'}]};

test('v6 actual local receipt wrappers: quota abort once conflict revoked replay', {timeout:240000},async t=>{
 const h=await startOwned(t,{integrations:{workforce:{pepper:'synthetic-owned-test-pepper-at-least-32-bytes'}}});
 const a=h.seeded[0],filter={tenantId:a.tenantId,plantId:a.plantId},ok=h.ok;
 const purchased=await ownerPurchasedFixture(h),company=await companyOwnerFixture(h),legacy=await orderWithStock(h);
 const shipment=await ok('/fulfillment/shipments',{salesOrderId:legacy.so._id,expectedVersion:legacy.so.version,lineIndex:0,uom:'KG',reference:'V6 owned shipment',sources:[{sourceType:'RESERVATION',sourceId:legacy.reservation._id,quantity:'0.7'}],idempotencyKey:randomUUID()},201);
 const demand=await company.plan(company.output,'1',[[company.direct,'1.25']]);
 const vendor=await ok('/procurement/vendors',{name:'V6 original source vendor'},201);
 const rfq=await ok('/procurement/requests',{...financial,vendorId:vendor._id},201);
 let convertPr=await ok('/procurement/requests',{...financial,vendorId:vendor._id},201);
 convertPr=await ok(`/procurement/requests/${convertPr._id}/approve`,{expectedVersion:convertPr.version});
 let amendPr=await ok('/procurement/requests',{...financial,vendorId:vendor._id},201);
 amendPr=await ok(`/procurement/requests/${amendPr._id}/approve`,{expectedVersion:amendPr.version});
 let amendPo=await ok(`/procurement/requests/${amendPr._id}/convert`,{expectedVersion:amendPr.version,idempotencyKey:randomUUID()});
 amendPo=await ok(`/procurement/orders/${amendPo._id}/issue`,{expectedVersion:amendPo.version});
 let legacyQuote=await ok('/commercial/quotes',{...financial,accountId:purchased.account._id,expiresAt:'2027-01-01T00:00:00.000Z'},201);
 for(const action of ['approve','accept'])legacyQuote=await ok(`/commercial/quotes/${legacyQuote._id}/${action}`,{expectedVersion:legacyQuote.version,revision:1});
 const catalogBody=()=>command({vendorId:vendor._id,taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{itemId:purchased.lot._id,itemVersion:purchased.lot.version,itemRevision:purchased.lot.currentRevision,quantity:'2',unitPrice:'1.00',currency:'USD'}]});
 let catalogRequest=await ok('/catalog-procurement/requests',catalogBody(),201);
 catalogRequest=await ok(`/catalog-procurement/requests/${catalogRequest._id}/approve`,command({expectedVersion:catalogRequest.version,revision:1}));
 let catalogOrder=await ok(`/catalog-procurement/requests/${catalogRequest._id}/convert`,command({expectedVersion:catalogRequest.version}));
 catalogOrder=await ok(`/catalog-procurement/orders/${catalogOrder._id}/issue`,command({expectedVersion:catalogOrder.version}));
 const incoming=await ok('/catalog-procurement/receipts',command({expectedVersion:catalogOrder.version,purchaseOrderId:catalogOrder._id,vendorId:vendor._id,lineId:catalogOrder.content.lines[0].lineId,quantity:'1',lotNumber:'V6_REAL_LOT',heatNumber:'V6_REAL_HEAT'}),201);
 const roles=[{role:'owner',plantIds:[a.plantId],tenantWide:false},{role:'saasOperator',plantIds:[],tenantWide:true},{role:'saasUser',plantIds:[a.plantId],tenantWide:false},{role:'workforceSelf',plantIds:[a.plantId],tenantWide:false}];
 await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{tenantWide:true,roles}});
 await ok('/saas/subscribe',{key:randomUUID(),expectedRevision:0,plan:'pilot',reason:'Owned v6 wrapper proof',admissionProfile});
 const sub=()=>h.db.collection('saasSubscriptions').findOne({tenantId:a.tenantId});
 const excluded=new Set(['tenants','users','plants','legalEntities','memberships','sessions','credentials','ownedRun','saasSubscriptions','audit','outbox']);
 async function snapshot(){const rows={};for(const {name}of await h.db.listCollections({},{nameOnly:true}).toArray())if(!excluded.has(name))rows[name]=await h.db.collection(name).find({tenantId:a.tenantId}).sort({_id:1}).limit(5001).toArray();return rows;}
 const results=new Map();
 const cases=[
 ['repairKeys',async()=>({path:'/repair/cases',body:{idempotencyKey:randomUUID(),accountId:purchased.account._id,serial:'V6-REPAIR',condition:'Owned damaged fixture',currency:'USD'},status:201,change:b=>({...b,condition:'Changed owned condition'})})],
 ['internalPlanningKeys',async()=>({path:'/inventory-master/items',body:command({schema:'INVENTORY_ITEM_V2',trackingPolicy:'LOT',code:'V6_NEW_SOURCE',description:'V6 owned inventory source',kind:'PURCHASED',uom:'KG'}),status:201,change:b=>({...b,description:'Changed source description'})})],
 ['internalExecutionKeys',async()=>({path:'/internal-execution/orders',body:command({internalOrderId:demand._id,expectedOrderVersion:demand.version,engineeringRevision:1}),status:201})],
 ['stockHoldKeys',async()=>({path:`/warehouse/receipts/${legacy.receipt._id}/holds`,body:{expectedReceiptVersion:(await h.db.collection('warehouseReceipts').findOne({_id:legacy.receipt._id})).version,reasonCode:'QC_SUSPECT',reasonNote:'Owned source hold proof'},headers:{'idempotency-key':randomUUID()},status:201,change:b=>({...b,reasonNote:'Changed source hold note'})})],
 ['inquiryKeys',async()=>({path:'/commercial/inquiries',body:{idempotencyKey:randomUUID(),accountId:purchased.account._id,lines:[{itemCode:'V6',description:'V6 owned inquiry',quantity:'1',uom:'KG',drawingNumber:'V6-DRAWING',drawingRevision:'A'}]},status:201,change:b=>({...b,lines:b.lines.map(l=>({...l,description:'Changed inquiry'}))})})],
 ['materialShortageKeys',async()=>({path:'/procurement/material-shortages/refresh',body:{demandKind:'INTERNAL_PRODUCTION',demandId:demand._id,expectedDemandVersion:demand.version,engineeringRevision:1,expectedShortageRevision:0,reason:'V6 actual source shortage',idempotencyKey:randomUUID()}})],
 ['catalogKeys',async()=>({path:'/catalog-procurement/requests',body:catalogBody(),status:201})],
 ['catalogDispositionKeys',async()=>{const v=await ok(`/catalog-disposition/receipts/${incoming._id}`);return {path:`/catalog-disposition/receipts/${incoming._id}/inspections`,body:command({expectedVersion:v.version,expectedReceiptVersion:v.receiptVersion,acceptedQuantity:'1',rejectedQuantity:'0',evidence:'V6 actual incoming inspection'})};}],
 ['purchasedFulfillmentKeys',async()=>{const current=await purchased.read(),stock=await purchased.stock(purchased.lotReceipt);return {path:`${purchased.path}/reservations`,body:command({expectedVersion:current.version,expectedSalesOrderVersion:purchased.so.version,lineIndex:0,receiptId:purchased.lotReceipt._id,expectedReceiptVersion:stock.receiptVersion,expectedStockVersion:stock.version,quantity:'1',unitIds:[]})};}],
 ['deliveryKeys',async()=>{const v=await ok(`/deliveries/shipments/${shipment._id}`);return {path:`/deliveries/shipments/${shipment._id}/confirmations`,body:{expectedVersion:v.version,expectedShipmentVersion:shipment.version,quantity:'0.7',deliveredAt:new Date().toISOString(),receiverName:'V6 owned receiver',receiverReference:'V6 receiver authority',evidenceReference:'V6 owned evidence',evidenceNotes:'V6 operator recorded delivery',idempotencyKey:randomUUID()},status:201,change:b=>({...b,evidenceNotes:'Changed delivery note'})};}],
 ['fulfillmentReturnKeys',async()=>{const v=await ok(`/deliveries/shipments/${shipment._id}/returns`);return {path:`/deliveries/shipments/${shipment._id}/returns`,body:{expectedVersion:v.version,quantity:'0.1',serials:[],reference:'V6 actual return',reason:'V6 returned damaged fixture',idempotencyKey:randomUUID()},status:201};}],
 ['workforceResults',async()=>({path:`/workforce/operators/${a.userId}/consent`,body:{expectedVersion:0,idempotencyKey:randomUUID(),active:true,expiresAt:new Date(Date.now()+86400000).toISOString(),purpose:'ATTENDANCE_VERIFICATION'},change:b=>({...b,expectedVersion:1})})],
 ['purchaseOrderAmendmentKeys',async()=>({path:`/procurement/orders/${amendPo._id}/amendments`,body:{expectedVersion:(await h.db.collection('purchaseOrders').findOne({_id:amendPo._id})).version,baseDocumentRevision:1,reason:'V6 existing amendment authority',idempotencyKey:randomUUID(),lines:(await h.db.collection('purchaseOrders').findOne({_id:amendPo._id})).snapshot.lines.map((line,i)=>({...line,quantity:'3',lineId:amendPo.lineIds?.[i]||line.lineId}))}})],
 ['procurementRfqKeys',async()=>({path:`/procurement/requests/${rfq._id}/rfq`,body:{expectedVersion:rfq.version,idempotencyKey:randomUUID(),reference:'V6 actual RFQ'},change:b=>({...b,reference:'Changed RFQ reference'})})],
 ['procurementPromiseKeys',async()=>({path:`/procurement/orders/${amendPo._id}/vendor-promise`,body:{expectedVersion:(await h.db.collection('purchaseOrders').findOne({_id:amendPo._id})).version,vendorId:vendor._id,promisedAt:'2026-12-01T00:00:00.000Z',reference:'V6 supplier promise',reason:'V6 source-confirmed promise',idempotencyKey:randomUUID()},change:b=>({...b,reference:'Changed promise reference'})})],
 ['procurementConversions',async()=>({path:`/procurement/requests/${convertPr._id}/convert`,body:{expectedVersion:convertPr.version,idempotencyKey:randomUUID()},change:b=>({...b,expectedVersion:b.expectedVersion+1})})],
 ['quoteCatalogKeys',async()=>({path:'/commercial/quotes',body:{schema:'CATALOG_QUOTE_V1',accountId:purchased.account._id,expiresAt:'2027-01-01T00:00:00.000Z',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'V6 typed source quote',quantity:'1',uom:purchased.lot.content.uom,unitPrice:'2.00',currency:'USD',catalogItem:{itemId:purchased.lot._id,itemVersion:purchased.lot.version,itemRevision:purchased.lot.currentRevision}}],idempotencyKey:randomUUID()},status:201,change:b=>({...b,expiresAt:'2027-02-01T00:00:00.000Z'})})],
 ['quoteConversions',async()=>({path:`/commercial/quotes/${legacyQuote._id}/convert`,body:{expectedVersion:legacyQuote.version,revision:1,idempotencyKey:randomUUID()},change:b=>({...b,expectedVersion:b.expectedVersion+1})})],
 ['inquiryKeys:stage',async()=>{const inquiry=results.get('inquiryKeys');return {path:`/commercial/inquiries/${inquiry._id}/stage`,body:{expectedVersion:inquiry.version,toStage:'SUBMITTED',reason:'V6 actual inquiry review',idempotencyKey:randomUUID()}};}],
 ['quoteCatalogKeys:approve',async()=>{const quote=results.get('quoteCatalogKeys');return {path:`/commercial/quotes/${quote._id}/approve`,body:{expectedVersion:quote.version,revision:1,idempotencyKey:randomUUID()},change:b=>({...b,expectedVersion:b.expectedVersion+1})};}],
 ['companyStockKeys',async()=>{const c=await company.company();return {path:`${company.companyPath}/holds`,body:command({expectedVersion:c.version,reasonCode:'TRACE_REVIEW'})};}],
 ];
 for(const [label,prepare]of cases)await t.test(label,async()=>{
  const namespace=label.split(':')[0];
  const c=await prepare(),key=c.headers?.['idempotency-key']??c.body.idempotencyKey;
  const send=body=>h.send(c.path,{body,cookie:h.alpha,headers:c.headers??{}});
  const before=await snapshot(),initial=await sub(),usage=initial.usage.apiCalls;
  const meters=()=>Promise.all([h.db.collection('audit').countDocuments({tenantId:a.tenantId,kind:'saas.effect.metered',namespace}),h.db.collection('outbox').countDocuments({tenantId:a.tenantId,type:'saas.effect.metered','data.namespace':namespace})]);
  const meterBefore=await meters();
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':'10000'}});
  const quotaBefore=await allSnapshot(h);
  const quota=await send(c.body);assert.equal(quota.status,429,JSON.stringify({namespace,quota}));assert.equal(quota.error.code,'SAAS_QUOTA_EXCEEDED');assert.deepEqual(await snapshot(),before);assert.deepEqual(await meters(),meterBefore);
  assert.deepEqual(await allSnapshot(h),quotaBefore,'quota denial rolls back authorization, enrollment and rate fences too');
  await h.db.collection('saasSubscriptions').updateOne({tenantId:a.tenantId},{$set:{'usage.apiCalls':usage}});
  const info=await h.db.listCollections({name:namespace}).next();assert.ok(info,'initialized receipt collection');
  await h.db.command({collMod:namespace,validator:{key:{$ne:key}},validationLevel:'strict'});
  const abortBefore=await allSnapshot(h);
  try{const abort=await send(c.body);assert.equal(abort.status,500,JSON.stringify({namespace,abort}));assert.deepEqual(await snapshot(),before);assert.equal((await sub()).usage.apiCalls,usage);assert.deepEqual(await meters(),meterBefore);}
  finally{await h.db.command({collMod:namespace,validator:info.options?.validator??{},validationLevel:info.options?.validationLevel??'strict'});}
  assert.deepEqual(await allSnapshot(h),abortBefore,'receipt failure rolls back every durable write');
  const once=await send(c.body);assert.equal(once.status,c.status??200,JSON.stringify({namespace,once}));
  assert.equal((await sub()).usage.apiCalls,String(BigInt(usage)+1n));results.set(label,once.data);assert.deepEqual(await meters(),meterBefore.map(n=>n+1));
  const identity={...filter,key,...(namespace==='workforceResults'?{actorId:a.userId}:{}),...(namespace==='purchaseOrderAmendmentKeys'?{cohort:'LEGACY'}:{})};
  assert.equal(await h.db.collection(namespace).countDocuments(identity),1);
  const conflicting=c.change?c.change(c.body):{...c.body,reason:c.body.reason+' changed'};
  const conflict=await send(conflicting);assert.equal(conflict.status,409,JSON.stringify({namespace,conflict}));assert.ok(['IDEMPOTENCY_CONFLICT','IDEMPOTENCY_KEY_REUSED'].includes(conflict.error.code));
  const after=await snapshot();await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles:roles.filter(r=>r.role!=='saasUser')}});
  const revokedBefore=await allSnapshot(h);
  try{const revoked=await send(c.body);assert.equal(revoked.status,403,JSON.stringify({namespace,revoked}));assert.deepEqual(await snapshot(),after);}
  finally{assert.deepEqual(await allSnapshot(h),revokedBefore,'revoked replay cannot commit even an authorization fence');await h.db.collection('memberships').updateOne({_id:a.membershipId},{$set:{roles}});}
  const replay=await send(c.body);assert.equal(replay.status,c.status??200,JSON.stringify({namespace,replay}));
  assert.equal((await sub()).usage.apiCalls,String(BigInt(usage)+1n));assert.equal(await h.db.collection(namespace).countDocuments(identity),1);assert.deepEqual(await meters(),meterBefore.map(n=>n+1));
 });
});
