import assert from 'node:assert/strict';
import { parseExpression } from '@babel/parser';
import { scoped } from './wave4f-browser-kit.mjs';
import { allSnapshot, traceFixture, tracePath } from '../../../checkpoints/company-stock-trace/qa/support.mjs';
import { observeTraceRead } from './company-trace-readiness.mjs';

const js=JSON.stringify,root='#company-unit-trace',formSelector='form[aria-label="Trace an actual manufactured unit"]';
const auditScript=`(()=>{const x=document.querySelector('${root} [data-company-unit-trace]');return x?JSON.parse(x.textContent):null})()`;
function measureTrace() {
  const panel=document.querySelector('#company-unit-trace'),visible=element=>element.getClientRects().length && getComputedStyle(element).visibility!=='hidden';
  const rgba=value=>{const numbers=value.match(/[\d.]+/g)?.map(Number);if(!value.startsWith('rgb')||!numbers||numbers.length<3)throw Error('Unrecognized computed color '+value);return [numbers[0],numbers[1],numbers[2],numbers[3]??1];};
  const blend=(front,back)=>[0,1,2].map(i=>front[i]*front[3]+back[i]*(1-front[3]));
  const luminance=color=>color.slice(0,3).map(x=>{const v=x/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const failures=[],seen=new Set(),walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);let count=0,node;
  while(node=walker.nextNode()) {
    const element=node.parentElement;if(!node.textContent.trim()||seen.has(element)||!visible(element)||element.closest('button:disabled,fieldset:disabled,select,option'))continue;seen.add(element);
    const range=document.createRange();range.selectNodeContents(node);if(![...range.getClientRects()].some(box=>box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth))continue;
    const ancestry=[];for(let parent=element;parent;parent=parent.parentElement)ancestry.unshift(parent);
    let background=[255,255,255];for(const parent of ancestry)background=blend(rgba(getComputedStyle(parent).backgroundColor),background);
    const style=getComputedStyle(element),color=rgba(style.color);color[3]*=ancestry.reduce((opacity,parent)=>opacity*Number(getComputedStyle(parent).opacity),1);
    const foreground=blend(color,background),values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a),contrast=(values[0]+0.05)/(values[1]+0.05),size=parseFloat(style.fontSize),minimum=size>=24||size>=18.66&&Number(style.fontWeight)>=700?3:4.5;
    count++;if(contrast<minimum)failures.push({text:node.textContent.trim().slice(0,90),contrast,minimum,color:style.color,background});
  }
  return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,contrastSamples:count,contrastFailures:failures,controls:[...panel.querySelectorAll('button,a,select,summary')].filter(visible).map(element=>({tag:element.tagName,text:element.textContent.trim().slice(0,80),height:element.getBoundingClientRect().height}))};
}

export async function companyStockTraceJourney({db,call,wait,evaluate,screenshot,check,headers,subscribe,writeEvidence}) {
  const checked=expression=>{parseExpression(expression);return evaluate(expression);},ready=expression=>{parseExpression(expression);return wait(expression);},form=scoped({evaluate:checked,wait:ready});
  const request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:4313/api${path}`,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json()};};
  const ok=async(path,body,status=200)=>{const response=await request(path,body);assert.equal(response.status,status,`${path}: ${JSON.stringify(response)}`);return response.data;};
  const nativeClick=async(selector)=>{
    await ready(`(()=>{const x=document.querySelector(${js(selector)});return x&&!x.disabled&&!x.closest('fieldset:disabled')})()`);
    const point=await checked(`(async()=>{const x=document.querySelector(${js(selector)});x.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const box=x.getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const button=async(scope,label)=>{await checked(`(()=>{const x=[...document.querySelector(${js(scope)}).querySelectorAll('button')].find(x=>x.textContent.trim()===${js(label)});if(!x)throw Error('Missing trace action');x.dataset.nativeTraceAction='selected'})()`);try{await nativeClick(`${scope} [data-native-trace-action="selected"]`);}finally{await checked(`document.querySelectorAll('[data-native-trace-action]').forEach(x=>delete x.dataset.nativeTraceAction)`);}};
  const navigate=async(receiptId)=>{await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/company-stock/receipts/${receiptId}`});await ready(`document.querySelector('#internal-company-stock')?.dataset.companyReceiptId===${js(receiptId)}&&document.querySelector('${formSelector}')`);};
  const traceReady=async(unitId,job)=>ready(`(()=>{const d=${auditScript};return d?.companyUnitId===${js(unitId)}${job?`&&Object.values(d.uses).flat().some(x=>x.consumer.executionId===${js(job._id)}&&x.consumer.version===${job.version})`:''}})()`);
  const reads=[];
  const freshRead=async(unitId,action,{job,stockVersion}={})=>{
    const receiptId=await checked(`document.querySelector('#internal-company-stock').dataset.companyReceiptId`),url=`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio-api/api${tracePath(receiptId,unitId)}`;
    const observed=observeTraceRead({subscribe,call,url});
    try {
      await action();const response=await observed.response;assert.equal(response.data.companyReceiptId,receiptId);assert.equal(response.data.companyUnitId,unitId);if(stockVersion!==undefined)assert.equal(response.data.current.stockVersion,stockVersion);
      await checked('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()');
      await ready(`(()=>{const panel=document.querySelector('${root}'),data=${auditScript};return !!panel?.querySelector('[data-trace-complete="true"]')&&!panel.querySelector('[role="alert"]')&&![...panel.querySelectorAll('[role="status"]')].some(x=>x.textContent.includes('Loading manufactured unit trace'))&&JSON.stringify(data)===${js(JSON.stringify(response.data))}})()`);
      await traceReady(unitId,job);assert.deepEqual(await checked(auditScript),response.data);assert.equal(await checked(`document.querySelector('${formSelector} [name=traceUnitId]').selectedOptions[0].textContent`),response.data.serial);reads.push({requestId:response.requestId,status:response.status,attempts:response.attempts,companyUnitId:unitId,stockVersion:response.data.current.stockVersion,unitVersion:response.data.current.unitVersion,exactResponseMatch:true});
      return response.data;
    } finally {observed.close();}
  };
  const choose=async(unitId,{keyboard=false}={})=>freshRead(unitId,async()=>{
    await form.fillIn(formSelector,'traceUnitId',unitId);assert.equal(await checked(`!!document.querySelector('${root} [data-trace-complete]')`),false,'Changing selected unit must remove previous evidence');
    if(keyboard){await checked(`document.querySelector('${formSelector} [name=traceUnitId]').focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await checked('document.activeElement.textContent.trim()'),'Load manufactured unit trace');assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'),'solid');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
    else await button(formSelector,'Load manufactured unit trace');
  });
  const refresh=async(unitId,job,stockVersion)=>freshRead(unitId,()=>button(root,'Refresh manufactured unit trace'),{job,stockVersion});
  const snapshot=()=>allSnapshot({db}),noWriteRead=async(action)=>{const before=await snapshot();await action();assert.deepEqual(await snapshot(),before,'Native trace GET changed durable data');};
  const layouts=[];
  const layout=async(name,kiosk=false,scrollSelector=root,widths=[360,768,1440])=>{
    for(const width of widths) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await ready(`innerWidth===${width}`);
      await checked(`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelector(${js(scrollSelector)}).scrollIntoView({block:'start',behavior:'instant'})})()`);
      const measurement=await checked(`(${measureTrace.toString()})()`);assert.equal(measurement.overflow,false);assert.ok(measurement.contrastSamples>0);assert.deepEqual(measurement.contrastFailures,[]);assert.deepEqual(measurement.controls.filter(row=>row.height<(kiosk?47.9:43.9)),[]);layouts.push({name,kiosk,...measurement});
      await screenshot(`company-unit-trace-${name}${kiosk?'-kiosk':''}-${width}`);
    }
  };
  const phases=[];let selectedId;
  const fixture=await traceFixture({db,ok},{onPhase:async state=>{
    const unit=state.rootUnits[0];selectedId=unit._id;
    if(state.phase==='AVAILABLE') {
      await navigate(state.sourceId);await noWriteRead(()=>choose(unit._id,{keyboard:true}));
      const trace=await checked(auditScript),expected=state.producer.allocations.find(row=>row.outputUnitId===unit.outputUnitId).sources.find(source=>source.receiptId===state.producerSerial._id).serials;
      assert.deepEqual(trace.ancestry.purchasedSources.find(source=>source.receiptId===state.producerSerial._id).serials,expected);assert.equal(expected.length,2);assert.equal(trace.holdPolicy.receiptIds.includes(state.abandoned._id),false);assert.deepEqual(Object.values(trace.uses).map(rows=>rows.length),[0,0,0,0,0,0]);
      const visible=await checked(`document.querySelector('${root}').innerText`);for(const serial of expected)assert.ok(visible.includes(serial));for(const serial of state.incoming.filter(serial=>!expected.includes(serial)))assert.equal(visible.includes(serial),false);
      assert.equal(await checked(`document.querySelector('${root}').innerText.includes('separate from the exact output attribution')`),true);
    } else {
      await noWriteRead(()=>refresh(unit._id,state.job));const trace=await checked(auditScript);
      if(state.phase==='RESERVED')assert.equal(trace.uses.reserved.length,1);
      if(state.phase==='ABANDONED'){assert.equal(trace.uses.reserved.length,0);assert.equal(trace.uses.abandoned.length,1);assert.equal(trace.uses.outputs.length,0);assert.equal(await checked(`document.querySelector('[data-trace-use-group="abandoned"]').innerText.includes('Reservation: Abandoned')`),true);}
      if(state.phase==='ISSUED'){assert.equal(trace.uses.issued.length,1);assert.equal(trace.uses.reserved.length,0);}
      if(state.phase==='CONSUMED_UNATTRIBUTED'){assert.equal(trace.uses.consumedUnattributed.length,1);assert.equal(trace.uses.outputs.length,0);}
      if(state.phase==='OUTPUT_UNREVIEWED'){assert.equal(trace.uses.outputs[0].output.serial,state.output.serial);assert.equal(trace.uses.outputs[0].output.qcDisposition,null);}
      if(state.phase==='QC_ACCEPTED')assert.equal(trace.uses.outputs[0].output.qcDisposition,'ACCEPTED');
      if(state.phase==='STORED'){assert.equal(trace.uses.outputs[0].output.companyReceiptId,state.job.companyStock._id);assert.equal(state.job.companyStock.sourcePolicy,'LEAF_ONLY');}
    }
    phases.push({phase:state.phase,trace:await checked(auditScript)});
  }});
  check('Company trace prerequisite mutations are actual HTTP setup; native unit selection and refresh show each real reserved, abandoned, issued, consumed-unattributed, output/QC/storage phase with byte-equal all-collection read snapshots');
  await noWriteRead(()=>choose(fixture.rootUnits[1]._id));let trace=await checked(auditScript);assert.equal(trace.uses.losses.length,1);assert.equal(trace.uses.outputs.length,0);assert.equal(trace.uses.abandoned.length,1);await layout('process-loss',false,'[data-trace-use-group="losses"]',[360,1440]);
  await noWriteRead(()=>choose(selectedId));await layout('upstream');await layout('downstream',false,'#company-trace-downstream');await layout('affected-output',false,'[data-trace-use-group="outputs"]',[360,1440]);
  const auditSummary=`${root} [data-trace-complete] > [data-audit-details] > summary`;
  await nativeClick(auditSummary);await ready(`document.querySelector(${js(auditSummary)}).parentElement.open`);assert.equal(await checked(`document.querySelector(${js(auditSummary)}).parentElement.innerText.includes(${js(fixture.sourceId)})`),true);await nativeClick(auditSummary);await ready(`!document.querySelector(${js(auditSummary)}).parentElement.open`);
  await nativeClick(`${root} a[href="/portfolio/catalog-disposition/receipts/${fixture.producerLot._id}"]`);await ready(`location.pathname===${js(`/portfolio/catalog-disposition/receipts/${fixture.producerLot._id}`)}&&document.querySelector('#catalog-receipt')&&document.body.innerText.includes(${js(fixture.producerLot.lotNumber)})`);
  await navigate(fixture.sourceId);await noWriteRead(()=>choose(selectedId));
  await nativeClick(`${root} [data-trace-use-group="outputs"] a[href="/portfolio/manufacturing/internal-execution/${fixture.job._id}"]`);await ready(`location.pathname===${js(`/portfolio/manufacturing/internal-execution/${fixture.job._id}`)}&&document.querySelector('#internal-execution')?.dataset.executionVersion===${js(String(fixture.job.version))}`);
  await navigate(fixture.sourceId);await noWriteRead(()=>choose(selectedId));
  assert.equal(typeof subscribe,'function');let resolvePause;const paused=new Promise(resolve=>{resolvePause=resolve;}),unsubscribe=subscribe(event=>{if(event.method==='Fetch.requestPaused')resolvePause(event.params);});let timer;
  await freshRead(selectedId,async()=>{try {
    await call('Fetch.enable',{patterns:[{urlPattern:`*${tracePath(fixture.sourceId,selectedId)}`,requestStage:'Response'}]});
    await button(root,'Refresh manufactured unit trace');const response=await Promise.race([paused,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Actual trace response was not intercepted')),30000);})]);
    assert.equal(response.responseStatusCode,200);await ready(`document.querySelector('${root}').innerText.includes('Loading manufactured unit trace')`);assert.equal(await checked(`!!document.querySelector('${root} [data-trace-complete]')`),false);await call('Fetch.continueRequest',{requestId:response.requestId});
  } finally {clearTimeout(timer);unsubscribe();await call('Fetch.disable');}},{job:fixture.job});
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  try {await button(root,'Refresh manufactured unit trace');await ready(`document.querySelector('${root}').innerText.includes('records could not be loaded')`);assert.equal(await checked(`!!document.querySelector('${root} [data-trace-complete]')`),false);}finally{await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
  await noWriteRead(()=>refresh(selectedId,fixture.job));
  let stock=await ok(`/company-stock/receipts/${fixture.sourceId}`);
  stock=await ok(`/company-stock/receipts/${fixture.sourceId}/holds`,{expectedVersion:stock.version,reason:'Trace fixture historical evidence under a current company hold',reasonCode:'TRACE_REVIEW',idempotencyKey:crypto.randomUUID()});
  await noWriteRead(()=>refresh(selectedId,fixture.job,stock.version));assert.equal((await checked(auditScript)).holdPolicy.directHold.active,true);assert.equal(await checked(`document.querySelector('${root}').innerText.includes('A direct company hold is active')`),true);
  await ok(`/company-stock/receipts/${fixture.sourceId}/holds/release`,{expectedVersion:stock.version,expectedHoldId:stock.hold._id,reason:'Trace fixture current restriction review complete',idempotencyKey:crypto.randomUUID()});
  await nativeClick(`${root} [data-trace-use-group="outputs"] a[href="/portfolio/company-stock/receipts/${fixture.job.companyStock._id}"]`);await ready(`location.pathname===${js(`/portfolio/company-stock/receipts/${fixture.job.companyStock._id}`)}&&document.querySelector('#internal-company-stock')?.dataset.companyReceiptId===${js(fixture.job.companyStock._id)}&&document.querySelector('${formSelector}')`);await noWriteRead(()=>choose(fixture.job.companyStock.units[0]._id));trace=await checked(auditScript);assert.equal(trace.sourcePolicy,'LEAF_ONLY');assert.equal(trace.ancestry.companySources.length,1);assert.equal(trace.ancestry.companySources[0].companyUnitId,selectedId);assert.equal(trace.ancestry.purchasedSources[0].receiptId,fixture.consumerLot._id);assert.equal(trace.ancestry.purchasedSources[0].quantity,'1.25');
  await layout('terminal-exact-ancestry',false,'#company-trace-exact-purchased');await button('.portfolio-root','Use kiosk controls');await layout('terminal-exact-ancestry',true,'#company-trace-exact-purchased');await layout('downstream',true,'#company-trace-downstream');await button('.portfolio-root','Use desktop controls');
  check('Native readonly trace preserves exact serial subsets, explicit process loss versus affected output, loading/offline recovery and terminal upstream attribution; three widths, painted-text contrast,44px desktop/48px kiosk and native Tab/Enter verified');
  let rejectedUnit;
  await traceFixture({db,ok},{qcDisposition:'REJECTED',onPhase:async state=>{if(state.phase!=='QC_REJECTED')return;await navigate(state.sourceId);rejectedUnit=state.rootUnits[0]._id;await noWriteRead(()=>choose(rejectedUnit));assert.equal((await checked(auditScript)).uses.outputs[0].output.qcDisposition,'REJECTED');}});
  const credential=await db.collection('credentials').findOne({username:'alpha.owner'}),membership=await db.collection('memberships').findOne({userId:credential._id});
  try {
    await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[{role:'internalExecutionReader',plantIds:membership.plantIds}]}});
    await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/manufacturing/internal-execution/${fixture.producer._id}`});await ready('document.querySelector("#internal-company-stock")');assert.equal(await checked(`!!document.querySelector('${formSelector}')`),false,'Execution read alone must not enable the trace');
    await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[{role:'companyStockReader',plantIds:membership.plantIds}]}});await navigate(fixture.sourceId);await noWriteRead(()=>choose(selectedId));
    assert.equal(await checked(`!!document.querySelector('#internal-company-stock a[href^="/portfolio/manufacturing/internal-execution/"]')`),false);assert.equal(await checked(`!!document.querySelector('#internal-company-stock a[href^="/portfolio/catalog-disposition/"]')`),false);
    await call('Page.reload');await ready(`document.querySelector('${formSelector}')`);await noWriteRead(()=>choose(selectedId));
    await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[{role:'manufacturingRead',plantIds:membership.plantIds}]}});
    await noWriteRead(async()=>{await button(root,'Refresh manufactured unit trace');await ready(`document.querySelector('${root}').innerText.includes('Access denied')`);});assert.equal(await checked(`!!document.querySelector('${root} [data-trace-complete]')`),false);
    const before=await snapshot();assert.equal((await request(tracePath(fixture.sourceId,selectedId))).status,403);assert.deepEqual(await snapshot(),before);
  } finally {await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:membership.roles}});await navigate(fixture.sourceId);}
  check('Company-stock-only Reader loads trace after real hard reload without unrelated execution/catalog links; actual rejected output stays rejected, and revoked read permission gives403 without stale trace or durable writes');
  await writeEvidence?.('company-unit-trace-native-manifest.json',{setup:'Actual HTTP business mutations; new trace selection/refresh are trusted native read actions, values set via React setters/change events',sourceReceiptId:fixture.sourceId,sourceUnitIds:fixture.rootUnits.map(unit=>unit._id),consumerId:fixture.job._id,terminalReceiptId:fixture.job.companyStock._id,phases,reads,layouts,scope:'Existing V1-to-V2 cohort only; candidate evidence, no recall disposition, graph mutation, reuse or dispatch entitlement'});
}
