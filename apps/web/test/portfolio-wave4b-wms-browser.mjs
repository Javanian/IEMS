import assert from 'node:assert/strict';
import { waitForTechnicalDetails } from './browser-readiness.mjs';
export async function editWmsField({wait,evaluate},title,name,value) {
  await wait(`(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent===${JSON.stringify(title)});const x=f?.querySelector('[name=${name}]');return Boolean(x&&!x.disabled);})()`, `${title}: enabled ${name} control`);
  return evaluate(`(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent===${JSON.stringify(title)});const x=f.querySelector('[name=${name}]');const p=x.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(x,${JSON.stringify(value)});x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
export async function wmsJourney({db,call,wait,click,fill,evaluate,screenshot,check,headers,loseResponse}) {
  const req=async(path,body,extra={})=>{const r=await fetch(`http://127.0.0.1:4313/api/${path}`,{method:body?'POST':'GET',headers:{...headers,...extra},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};};
  const post=async(path,body)=>{const r=await req(path,body);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.data;};
  const navigate=async path=>{await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/warehouse/${path}`});await wait(`document.body.innerText.includes('Warehouse') && !document.body.innerText.includes('Checking portfolio session')`);};
  const edit=(title,name,value)=>editWmsField({wait,evaluate},title,name,value);
  await navigate('bins'); await wait(`document.querySelector('[name=code]')`); await fill('code','W4B-A'); await click('Create bin'); await waitForTechnicalDetails({wait,evaluate},'Bin ID:');
  const bin=await db.collection('warehouseBins').findOne({code:'W4B-A'}); assert.ok(bin); await call('Page.reload');await waitForTechnicalDetails({wait,evaluate},bin._id);assert.ok(await evaluate(`document.body.innerText.includes('W4B-A')`));
  const existing=await db.collection('purchaseOrders').findOne({});
  const pr=await post('procurement/requests',{vendorId:existing.vendorId,taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'W4b operator material',quantity:'5.000000',uom:'KG',unitPrice:'0.05',currency:'USD'}]});
  await post(`procurement/requests/${pr._id}/approve`,{expectedVersion:1});const po=await post(`procurement/requests/${pr._id}/convert`,{expectedVersion:2,idempotencyKey:crypto.randomUUID()});await post(`procurement/orders/${po._id}/issue`,{expectedVersion:1});
  let row=await post('warehouse/receipts',{purchaseOrderId:po._id,vendorId:po.vendorId,expectedVersion:2,lineIndex:0,quantity:'5.000000',uom:'KG',idempotencyKey:crypto.randomUUID()});
  const id=row._id,path=`warehouse/receipts/${id}`;
  await post(`${path}/release`,{expectedVersion:1,reason:'Operator inspection',idempotencyKey:crypto.randomUUID()});await post(`${path}/putaway`,{expectedVersion:2,location:'W4B-SOURCE',idempotencyKey:crypto.randomUUID()});
  await navigate(`receipts/${id}`);await wait(`document.querySelector('[data-warehouse-record-version="3"]')`);
  await edit('Transfer whole receipt','binId',bin._id);await edit('Transfer whole receipt','uom','KG');await edit('Transfer whole receipt','reason','Whole stored receipt');await click('Transfer whole receipt');await wait(`document.querySelector('[data-warehouse-record-version="4"]')`);
  row=await db.collection('warehouseReceipts').findOne({_id:id});assert.equal(row.binId,bin._id);assert.equal(row.availableQuantity,'5');
  check('WMS bin creation/deep reload and whole STORED receipt transfer through actual Chrome controls');
  const countFields=async()=>{await edit('Record absolute count','countedQuantity','4.250000');await edit('Record absolute count','uom','KG');await edit('Record absolute count','reason','Operator absolute count');};
  await countFields();
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});await click('Record absolute count');await wait(`document.body.innerText.includes('Retry same warehouse command')`);
  assert.equal((await db.collection('warehouseReceipts').findOne({_id:id})).version,4);
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await click('Retry same warehouse command');await wait(`document.querySelector('[data-warehouse-record-version="5"]')`);
  const movement=await db.collection('warehouseMovements').findOne({receiptId:id,kind:'COUNT'});assert.equal(movement.quantity,'4.250000');assert.equal(movement.beforeQuantity,'5');
  const counts=async()=>Promise.all(['warehouseBins','warehouseMovements','warehouseKeys','warehouseAudit','warehouseOutbox'].map(n=>db.collection(n).countDocuments({})));
  const before=await counts();
  const rec=await req(`${path}/reconciliation`);assert.equal(rec.data.matches,true);assert.equal(rec.data.replayed.availableQuantity,'4.25');assert.deepEqual(rec.data.location,{replayed:'W4B-A',cached:'W4B-A',matches:true});
  await call('Page.reload');await wait(`document.body.innerText.includes('Available: 4.25 KG')`);
  check('WMS offline-before-submit identical command retry, exact count strings and independent Mongo movement/location reconciliation');
  const original=await db.collection('warehouseReceipts').findOne({_id:id});
  const countForm=`[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent==='Record absolute count')`;
  const countFailure=async code=>{
    const diagnostic=`Diagnostic code: ${code}`;
    await wait(`(${countForm})?.querySelector('[role=alert]')?.textContent.includes(${JSON.stringify(diagnostic)})`, `count form actual ${code} diagnostic`);
    await evaluate(`(()=>{const detail=(${countForm}).querySelector('[role=alert] details');if(!detail.open)detail.querySelector('summary').click();})()`);
    await wait(`(${countForm})?.querySelector('[role=alert]')?.innerText.includes(${JSON.stringify(diagnostic)})`, `count form disclosed ${code}`);
    if(code==='STOCK_ENCUMBERED')assert.equal(await evaluate(`(${countForm}).querySelector('[role=alert] p').innerText`),'Stock is held or already committed. Refresh its availability before continuing.');
  };
  const deny=async(patch,code)=>{
    await db.collection('warehouseReceipts').updateOne({_id:id},{$set:patch});
    try { await click('Refresh record');await wait(`(${countForm})?.querySelector('[name=countedQuantity]:not(:disabled)')`);await countFields();await click('Record absolute count');await countFailure(code);assert.deepEqual(await counts(),before); }
    finally { await db.collection('warehouseReceipts').replaceOne({_id:id},original); }
    await click('Refresh and retry');await wait(`(${countForm})?.querySelector('[name=countedQuantity]:not(:disabled)')`);
  };
  for(const patch of [{held:true},{reservedQuantity:'0.1'},{manufacturingReservedQuantity:'0.1'},{manufacturingConsumedQuantity:'0.1'},{shippedQuantity:'0.1'},{serials:['FIXTURE_ONLY']}]) await deny(patch,Object.hasOwn(patch,'serials')?'SERIAL_COUNT_CONFLICT':'STOCK_ENCUMBERED');
  const command={expectedVersion:5,idempotencyKey:crypto.randomUUID(),countedQuantity:'4',uom:'KG',reason:'Second writer'};
  const secondWriter=await post(`${path}/count`,command);await countFields();await click('Record absolute count');await countFailure('VERSION_CONFLICT');await click('Refresh and retry');await wait(`document.querySelector('[data-warehouse-record-version="6"]')`);
  const replayBefore=await counts(); const replay=(await req(`${path}/count`,command)).data; assert.equal(replay.version,6); assert.equal(replay.availableQuantity,'4'); assert.deepEqual(await counts(),replayBefore);
  assert.equal((await req(`${path}/count`,{...command,reason:'Changed'})).status,409);
  assert.equal((await req(`${path}/count`,{...command,idempotencyKey:crypto.randomUUID(),plantId:crypto.randomUUID()})).status,403);
  const credential=await db.collection('credentials').findOne({username:'alpha.owner'}),member=await db.collection('memberships').findOne({userId:credential._id});
  await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:[{role:'warehouseRead',plantIds:member.plantIds,tenantWide:false}]}});
  await countFields();await click('Record absolute count');await wait(`document.body.innerText.includes('Access denied')`);await screenshot('wave4b-wms-role-denied');await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:member.roles}});await click('Refresh and retry');await wait(`document.querySelector('[data-warehouse-record-version="6"]')`);
  check('WMS real version conflict, changed replay/scoped plant denial, read-only role, held/serial/sales/manufacturing/shipped count denials without effects');
  for(const width of [360,375,768,1024,1440]){await call('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await screenshot(`wave4b-wms-${width}`);}
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:500,deviceScaleFactor:1,mobile:true});await edit('Record absolute count','countedQuantity','4.000000');await edit('Record absolute count','uom','KG');await edit('Record absolute count','reason','Keyboard count');await evaluate(`(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent==='Record absolute count');f.querySelector('[name=reason]').focus();})()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate('document.activeElement.textContent'),'Record absolute count');assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'),'solid');await call('Input.dispatchKeyEvent',{type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(`document.querySelector('[data-warehouse-record-version="7"]')`);
  await evaluate(`document.querySelector('[aria-label="Whole-receipt WMS"]').scrollIntoView();[...document.querySelectorAll('.portfolio-root *')].forEach(x=>x.dataset.w4size=getComputedStyle(x).fontSize);[...document.querySelectorAll('.portfolio-root *')].forEach(x=>x.style.fontSize=(parseFloat(x.dataset.w4size)*2)+'px')`);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await screenshot('wave4b-wms-text200-keyboard');await evaluate(`document.querySelectorAll('.portfolio-root *').forEach(x=>{x.style.removeProperty('font-size');delete x.dataset.w4size})`);
  assert.equal((await req(`${path}/reconciliation`)).data.matches,true);assert.equal(await db.collection('warehouseMovements').countDocuments({receiptId:id}),7);
  check('WMS five widths, narrow keyboard Tab/Enter count, 200% text reflow and final independent seven movement ledger');
  await edit('Record absolute count','countedQuantity','3.750000');await edit('Record absolute count','uom','KG');await edit('Record absolute count','reason','Committed response loss');
  const lost=await loseResponse(`*${path}/count`,()=>click('Record absolute count'),async({receipt})=>{assert.equal(receipt.data.version,8);const durable=await db.collection('warehouseReceipts').findOne({_id:id});assert.equal(durable.version,8);assert.equal(durable.availableQuantity,'3.75');});
  await wait(`document.body.innerText.includes('Retry same warehouse command')`);const durableCounts=await counts();await click('Retry same warehouse command');await wait(`document.querySelector('[data-warehouse-record-version="8"]')`);assert.deepEqual(await counts(),durableCounts);assert.deepEqual((await req(`${path}/count`,lost.command)).data,lost.receipt.data);assert.deepEqual((await req(`${path}/count`,command)).data,secondWriter);
  await evaluate(`(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent==='Record absolute count');f.scrollIntoView();})()`);await screenshot('wave4b-wms-count-controls-mobile');
  const final=await db.collection('warehouseReceipts').findOne({_id:id});
  for(const patch of [{held:true},{reservedQuantity:'0.1'},{manufacturingReservedQuantity:'0.1'},{manufacturingConsumedQuantity:'0.1'},{shippedQuantity:'0.1'}]){await db.collection('warehouseReceipts').updateOne({_id:id},{$set:patch});const unchanged=await counts();assert.equal((await req(`${path}/transfer`,{expectedVersion:8,idempotencyKey:crypto.randomUUID(),binId:bin._id,uom:'KG',reason:'Protected transfer'})).status,409);assert.deepEqual(await counts(),unchanged);await db.collection('warehouseReceipts').replaceOne({_id:id},final);}
  assert.equal((await req(`${path}/reconciliation`)).data.matches,true);assert.equal(await db.collection('warehouseMovements').countDocuments({receiptId:id}),8);
  const events=await db.collection('warehouseAudit').find({subjectId:id}).toArray();assert.equal(events.length,8);
  const outgoing=await db.collection('warehouseOutbox').find({subjectId:id}).toArray();assert.equal(outgoing.length,8);assert.ok(outgoing.every(e=>e.state==='PENDING'));
  assert.equal(await db.collection('warehouseKeys').countDocuments({'result._id':id}),8);
  assert.equal(final.quantity,'5.000000');assert.equal(final.availableQuantity,'3.75');assert.equal(final.reservedQuantity,'0');assert.equal(final.binId,bin._id);
  const allMoves=await db.collection('warehouseMovements').find({receiptId:id}).toArray();assert.deepEqual(allMoves.map(m=>m.kind).sort(),['RECEIVE','QC_RELEASE','PUTAWAY','TRANSFER','COUNT','COUNT','COUNT','COUNT'].sort());
  assert.equal(allMoves.find(m=>m.kind==='TRANSFER').from,'W4B-SOURCE');assert.equal(allMoves.find(m=>m.kind==='TRANSFER').to,'W4B-A');
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:350,deviceScaleFactor:1,mobile:true});
  await evaluate(`(()=>{const f=[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent==='Record absolute count');const x=f.querySelector('[name=reason]');x.focus();x.scrollIntoView({block:'center'});})()`);
  assert.equal(await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`),true);await screenshot('wave4b-wms-reduced-viewport-focus');
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:700,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelectorAll('.portfolio-root *').forEach(x=>x.dataset.w4size=getComputedStyle(x).fontSize);document.querySelectorAll('.portfolio-root *').forEach(x=>x.style.fontSize=(parseFloat(x.dataset.w4size)*2)+'px');[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent==='Record absolute count').scrollIntoView()`);
  await wait(`(()=>{const h=[...document.querySelectorAll('form h2')].find(h=>h.textContent==='Record absolute count');return Math.abs(parseFloat(getComputedStyle(h).fontSize)/parseFloat(h.dataset.w4size)-2)<0.01})()`, 'WMS count heading text doubled');await evaluate(`[...document.querySelectorAll('form')].find(f=>f.querySelector('h2')?.textContent==='Record absolute count').scrollIntoView()`);
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await screenshot('wave4b-wms-count-text200');await evaluate(`document.querySelectorAll('.portfolio-root *').forEach(x=>{x.style.removeProperty('font-size');delete x.dataset.w4size})`);
  check('WMS real committed-response loss verified in independent Mongo before withholding, UI original-key replay once, advanced original snapshot and protected transfer denials');
}
