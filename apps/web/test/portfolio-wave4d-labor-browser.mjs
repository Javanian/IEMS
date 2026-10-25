import { waitForTechnicalDetails } from './browser-readiness.mjs';
import assert from 'node:assert/strict';
export async function laborJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse }) {
  const showLabor = async ms => { await wait(`document.querySelector('[aria-label="Operator labor evidence"]')?.innerText.includes('Elapsed window:')&&document.querySelector('[aria-label="Operator labor evidence"]')?.innerText.includes('Active work:')`); await waitForTechnicalDetails({wait,evaluate},`Elapsed ${ms} ms · Active ${ms} ms`); };
  const req = async (path, body) => { const r = await fetch(`http://127.0.0.1:4313/api/${path}`, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) }); return { status:r.status, ...await r.json() }; };
  const post = async (path, body) => { const r = await req(path,body); assert.ok([200,201].includes(r.status),JSON.stringify(r)); return r.data; };
  const first = await db.collection('manufacturingWorkOrders').findOne({status:'RELEASED',engineeringSnapshot:{$exists:true}});
  assert.ok(first,'engineering journey provides real released work order');
  const material = first.routing.materials[0];
  const split = await post('manufacturing/work-orders',{salesOrderId:first.salesOrderId,expectedVersion:1,lineIndex:0,uom:first.uom,quantities:['1','1'],idempotencyKey:crypto.randomUUID()});
  const others=[];
  for (const wo of split.workOrders) others.push(await post(`manufacturing/work-orders/${wo._id}/release`,{expectedVersion:1,idempotencyKey:crypto.randomUUID(),operations:[{code:'LABOR',instruction:'Record bounded self evidence'}],materials:[{receiptId:material.receiptId,quantityPerUnit:'0.1',uom:material.uom}]}));
  const actor=await db.collection('credentials').findOne({username:'alpha.owner'}),member=await db.collection('memberships').findOne({userId:actor._id});
  const nav=async wo=>{await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/manufacturing/work-orders/${wo._id}`});await wait(`document.querySelector('[name=durationMs]')`);};
  const enter=async(start,end,evidence)=>{await fill('startedAt',start);await fill('endedAt',end);await fill('durationMs',String(Date.parse(end)-Date.parse(start)));await evaluate(`(()=>{const x=document.querySelector('[aria-label="Operator labor evidence"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(x,${JSON.stringify(evidence)});x.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
  const effects=async()=>Promise.all(['manufacturingLabor','manufacturingKeys','manufacturingAudit','manufacturingOutbox'].map(n=>db.collection(n).countDocuments({})));
  await nav(first);
  const start=new Date(Math.max(Date.parse(first.routing.releasedAt),...others.map(x=>Date.parse(x.routing.releasedAt)))+1).toISOString(),end=new Date(Date.parse(start)+101).toISOString();
  // The server refuses labor ending after its own record time; wait for the shared clock to pass the interval end.
  await wait(`Date.now()>${Date.parse(end) + 5}`, 'clock past labor interval end');
  await enter(start,end,'Exact 101 ms committed Chrome labor');
  const before=await effects();
  const lost=await loseResponse(`*manufacturing/work-orders/${first._id}/labor`,()=>click('Record labor evidence'),async({receipt})=>{
    assert.equal(receipt.data.durationMs,101);assert.equal(receipt.data.operatorId,actor._id);
    assert.ok(await db.collection('manufacturingLabor').findOne({_id:receipt.data._id,durationMs:101,recordedBy:actor._id,executionMode:'OPERATOR_RECORDED'}));
    assert.equal((await db.collection('manufacturingWorkOrders').findOne({_id:first._id})).version,first.version+1);
  });
  await wait(`document.body.innerText.includes('Retry same manufacturing command')`);const committed=await effects();assert.deepEqual(committed,before.map(x=>x+1));
  await click('Retry same manufacturing command');await showLabor(101);assert.deepEqual(await effects(),committed);
  assert.deepEqual((await req(`manufacturing/work-orders/${first._id}/labor`,lost.command)).data,lost.receipt.data);assert.deepEqual(await effects(),committed);
  assert.equal(await db.collection('manufacturingAudit').countDocuments({kind:'workOrder.labor',subjectId:lost.receipt.data._id}),1);
  assert.equal(await db.collection('manufacturingOutbox').countDocuments({kind:'workOrder.labor',subjectId:lost.receipt.data._id,state:'PENDING'}),1);
  check('labor Chrome exact 101 integer ms/self identity, committed-response loss and original receipt replay; independent labor/WO/key/audit/PENDING outbox once');
  const origin=await evaluate('performance.timeOrigin');await call('Page.reload');await wait(`performance.timeOrigin!==${origin}`);await showLabor(101);assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify(start)})&&document.body.innerText.includes(${JSON.stringify(end)})`));
  check('labor deep-link hard reload restores exact canonical UTC, integer duration and immutable evidence');
  await nav(others[0]);await enter(start,end,'Overlapping cross-WO attempt');const denied=await effects();await click('Record labor evidence');await waitForTechnicalDetails({wait,evaluate},'LABOR_TIME_CONFLICT');assert.deepEqual(await effects(),denied);await click('Discard command and refresh');await wait(`document.querySelector('[name=durationMs]:not(:disabled)')`);
  const start2=end,end2=new Date(Date.parse(end)+103).toISOString();await enter(start2,end2,'Adjacent 103 ms offline retry');
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});await click('Record labor evidence');await wait(`document.body.innerText.includes('Retry same manufacturing command')`);assert.deepEqual(await effects(),denied);
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await click('Retry same manufacturing command');await showLabor(103);assert.deepEqual(await effects(),denied.map(x=>x+1));
  check('labor cross-WO overlap409 leaves all four effect counts unchanged; adjacent interval permitted after genuine offline identical-command retry');
  await nav(others[1]);const start3=end2,end3=new Date(Date.parse(end2)+107).toISOString();await enter(start3,end3,'Role denied labor evidence');
  await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:[{role:'manufacturingRead',plantIds:member.plantIds}]}});const roleBefore=await effects();await click('Record labor evidence');await wait(`document.body.innerText.includes('Access denied')`);assert.deepEqual(await effects(),roleBefore);
  assert.equal((await req(`manufacturing/work-orders/${first._id}/labor`,lost.command)).status,403);assert.deepEqual(await effects(),roleBefore);
  await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:member.roles}});await click('Discard command and refresh');await wait(`document.querySelector('[name=durationMs]:not(:disabled)')`);
  const other=await db.collection('credentials').findOne({username:'beta.owner'});assert.equal((await req(`manufacturing/work-orders/${others[1]._id}/labor`,{...lost.command,expectedVersion:others[1].version,idempotencyKey:crypto.randomUUID(),operatorId:other._id})).status,403);assert.deepEqual(await effects(),roleBefore);
  await enter(start3,end3,'Stale version denied evidence');await post(`manufacturing/work-orders/${others[1]._id}/labor`,{expectedVersion:others[1].version,idempotencyKey:crypto.randomUUID(),operationIndex:0,operatorId:actor._id,startedAt:start3,endedAt:end3,durationMs:107,evidence:'Independent second writer'});const staleBefore=await effects();await click('Record labor evidence');await waitForTechnicalDetails({wait,evaluate},'VERSION_CONFLICT');assert.deepEqual(await effects(),staleBefore);await click('Discard command and refresh');await showLabor(107);
  check('labor actual membership403 including replay, different operator403, second-writer version409; independent denial rollback counts');
  await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/manufacturing/work-orders/${first._id}`});await showLabor(101);
  for(const width of [360,375,768,1024,1440]) {await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<600});assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);}
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:700,deviceScaleFactor:1,mobile:true});await evaluate(`document.querySelectorAll('.portfolio-root *').forEach(x=>x.dataset.w4dsize=getComputedStyle(x).fontSize);document.querySelectorAll('.portfolio-root *').forEach(x=>x.style.fontSize=(parseFloat(x.dataset.w4dsize)*2)+'px')`);await wait(`(()=>{const x=document.querySelector('h1');return Math.abs(parseFloat(getComputedStyle(x).fontSize)/parseFloat(x.dataset.w4dsize)-2)<0.01})()`, 'labor h1 text doubled');assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await evaluate(`document.querySelector('[aria-label="Operator labor evidence"]').scrollIntoView()`);await screenshot('wave4d-labor-text200');await evaluate(`document.querySelectorAll('.portfolio-root *').forEach(x=>{x.style.removeProperty('font-size');delete x.dataset.w4dsize})`);
  await evaluate(`([...document.querySelectorAll('button')].find(x=>x.textContent==='Refresh record')).focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate('document.activeElement.textContent'),'Open source sales order');assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'),'solid');await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(`location.pathname==='/portfolio/orders/${first.salesOrderId}'`);
  check('labor five measured widths, measured text-only200 without page overflow and real Tab/Enter navigation; bounded checks, not full accessibility certification');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
}
