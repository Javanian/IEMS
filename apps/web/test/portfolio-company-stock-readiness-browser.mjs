import assert from 'node:assert/strict';
import { makeReleasedClaimFixture } from '../../../checkpoints/p2-f5a-dispatch-followup/qa/support.mjs';

const js=JSON.stringify,scope=title=>`form[aria-label="${title}"]`;
const RESERVE=scope('Reserve internal material'),HOLD=scope('Apply company stock hold'),UNHOLD=scope('Release company stock hold'),TRACE=scope('Trace an actual manufactured unit');

export async function companyStockReadinessJourney({db,ok,headers,call,checked,ready,form,button,nativeClick,screenshot,check,writeEvidence}) {
  const state=await makeReleasedClaimFixture({db,ok,alpha:headers.cookie},{count:100}),{receiptId,unitId}=state;
  const source=()=>ok(`/company-stock/receipts/${receiptId}`),original=await source(),spare=state.jobs.find(job=>job.reservations.length===0);
  assert.ok(spare,'The real HTTP fixture includes an unused consumer, independent of reservation ordering');
  assert.equal(original.capacity.reservationCount,100);assert.equal(original.capacity.remainingReservationSlots,0);
  assert.equal(original.capacity.eventLimitReached,false);assert.equal(original.canReserve,false);
  assert.equal(original.availableQuantity,'2');assert.equal(original.eligibleQuantity,'2');assert.equal(original.canHold,true);
  const physical=row=>Object.fromEntries(['openingQuantity','onHandQuantity','reservedQuantity','issuedQuantity','consumedQuantity','availableQuantity','blockedQuantity'].map(key=>[key,row[key]]));
  const navigate=async(path,condition)=>{await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}`});await ready(condition);};
  await navigate(`manufacturing/internal-execution/${spare._id}`,`document.querySelector('#internal-execution')?.dataset.executionVersion===${js(String(spare.version))}`);
  const material=spare.materials.find(row=>row.sourceKind==='COMPANY_OUTPUT');assert.ok(material);
  await form.fillIn(RESERVE,'materialLineId',material.lineId);
  await ready(`document.querySelector(${js(RESERVE)})?.querySelector('option[value="${receiptId}"]')`);
  await form.fillIn(RESERVE,'companyReceiptId',receiptId);
  await ready(`document.querySelector(${js(RESERVE)})?.querySelector('[data-company-stock-version="${original.version}"] [data-company-reservation-readiness="blocked"]')`);
  assert.equal(await checked(`document.querySelector(${js(RESERVE)})?.querySelector('button.pf-primary')?.disabled`),true);
  assert.match(await form.disabledReason(RESERVE,'Reserve internal material'),/eligible|receipt|stock/i);
  assert.match(await checked(`document.querySelector(${js(RESERVE)}).querySelector('[data-company-reservation-readiness]').innerText`),/reservation history limit.*physical stock remains available/s);
  const measures=[];
  for(const width of [360,768,1440]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await checked(`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelector(${js(RESERVE)}).querySelector('[data-company-reservation-readiness]').scrollIntoView({block:'center',behavior:'instant'})})()`);
    const measure=await checked(`(()=>{const root=document.querySelector(${js(RESERVE)}),readiness=root.querySelector('[data-company-reservation-readiness]'),button=root.querySelector('button.pf-primary');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,readiness:readiness.innerText,buttonDisabled:button.disabled,controls:[...root.querySelectorAll('button,input,select,textarea,summary')].filter(x=>x.getClientRects().length&&getComputedStyle(x).visibility!=='hidden').map(x=>({tag:x.tagName,height:x.getBoundingClientRect().height}))}})()`);
    assert.equal(measure.overflow,false);assert.equal(measure.buttonDisabled,true);assert.match(measure.readiness,/reservation history limit/);
    assert.deepEqual(measure.controls.filter(control=>control.height<44),[]);measures.push(measure);
    await screenshot(`company-stock-readiness-count-exhausted-${width}`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  assert.deepEqual(await db.collection('companyMaterialReservations').find({executionId:spare._id}).toArray(),[]);
  await navigate(`company-stock/receipts/${receiptId}`,`document.querySelector('#internal-company-stock')?.dataset.companyStockVersion===${js(String(original.version))}`);
  await form.fillIn(HOLD,'reasonCode','TRACE_REVIEW');await form.fillIn(HOLD,'reason','Native history-cap review: physical stock remains available');
  await button(HOLD,'Apply company stock hold');
  await ready(`document.querySelector('#internal-company-stock')?.dataset.companyStockVersion===${js(String(original.version+1))}`);
  const held=await source();assert.equal(held.hold.active,true);assert.equal(held.canReleaseHold,true);assert.equal(held.capacity.reservationCount,100);assert.deepEqual(physical(held),physical(original));
  await form.fillIn(UNHOLD,'reason','Native review completed without changing custody or history');await button(UNHOLD,'Release company stock hold');
  await ready(`document.querySelector('#internal-company-stock')?.dataset.companyStockVersion===${js(String(original.version+2))}`);
  const released=await source();assert.equal(released.hold.active,false);assert.equal(released.canReserve,false);assert.equal(released.canHold,true);assert.equal(released.eligibleQuantity,'2');assert.deepEqual(physical(released),physical(original));
  await form.fillIn(TRACE,'traceUnitId',unitId);await button(TRACE,'Load manufactured unit trace');
  await ready(`document.querySelector('[data-trace-unit-id="${unitId}"][data-trace-stock-version="${released.version}"][data-trace-complete="true"]')`);
  const trace=await checked('JSON.parse(document.querySelector("[data-company-unit-trace]").textContent)');
  assert.equal(trace.companyUnitId,unitId);assert.equal(trace.current.stockVersion,released.version);assert.equal(trace.uses.abandoned.length,100);
  assert.equal(trace.uses.reserved.length,0);assert.equal(trace.uses.issued.length,0);assert.equal(trace.uses.outputs.length,0);assert.equal(trace.uses.losses.length,0);
  await nativeClick('#company-unit-trace summary');
  assert.equal(await checked('document.querySelector("#company-unit-trace details").open'),true);
  await writeEvidence?.('company-stock-readiness-native-manifest.json',{setup:'Shared independent QA real HTTP fixture: 100 reserve/release pairs across five consumers, plus one unused consumer. No scalar history edits.',receiptId,unitId,consumerId:spare._id,initialVersion:original.version,finalVersion:released.version,capacity:released.capacity,physical:physical(released),measures,scope:'Native disabled new reservation and allowed hold/release below the event cap; historical trace retained. Hard event-cap recovery is covered by real API boundary tests, not this browser fixture.'});
  check('Company-stock readiness: actual 100 released claims retain positive physical stock but disable a new native reservation with an explicit capacity reason at 360/768/1440; native hold/release remain legal below the event cap and historical unit trace keeps all 100 abandoned claims');
}
