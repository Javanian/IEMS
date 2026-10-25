import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseExpression } from '@babel/parser';
import { scoped } from './wave4f-browser-kit.mjs';

const js = JSON.stringify;
const ADOPT = 'form[aria-label="Adopt incoming serial custody"]';
const CLAIM = 'form[aria-label="Claim incoming serial identities"]';
const ABANDON = 'form[aria-label="Abandon planned serial claim"]';
const RELEASE = 'form[aria-label="Release work order"]';
const ENGINEERING = 'form[aria-label="Release work order from engineering"]';

export async function serialCustodyJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse }) {
  const checked = expression => { parseExpression(expression); return evaluate(expression); };
  const ready = expression => { parseExpression(expression); return wait(expression); };
  const form = scoped({ evaluate:checked, wait:ready });
  const send = async (path, body, extra = {}) => { const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method:body ? 'POST' : 'GET', headers:{ ...headers, ...extra }, ...(body && { body:JSON.stringify(body) }) }); return { status:response.status, ...await response.json() }; };
  const api = async (path, body, extra) => { const response = await send(path, body, extra); assert.ok([200, 201].includes(response.status), `${path} ${JSON.stringify(response)}`); return response.data; };
  const navigate = async (path, condition) => { await call('Page.navigate', { url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` }); await ready(condition); };
  const receiptPath = id => `/warehouse/receipts/${id}/serial-custody`;
  const claimPath = id => `/manufacturing/work-orders/${id}/serial-claims`;
  const receiptReady = version => `document.querySelector('#receipt-serial-custody')?.getAttribute('data-receipt-version')===${js(String(version))}`;
  const woReady = version => `document.querySelector('#work-order-serial-custody')?.getAttribute('data-work-order-version')===${js(String(version))}`;
  const effects = () => Promise.all(['warehouseReceipts','warehouseAudit','warehouseOutbox','warehouseKeys','serialCustodyUnits','serialCustodyClaims','serialCustodyEvents','manufacturingWorkOrders','manufacturingAudit','manufacturingOutbox','manufacturingKeys','manufacturingMovements'].map(name => db.collection(name).find({}).sort({ _id:1 }).toArray()));
  const account = await api('/crm/accounts', { name:'Synthetic K2a received serial customer' });
  const quote = await api('/commercial/quotes', { accountId:account._id, expiresAt:'2027-01-01T00:00:00.000Z', taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:[{ description:'Synthetic supplemental custody output', quantity:'3', uom:'UN', unitPrice:'1.00', currency:'USD' }] });
  await api(`/commercial/quotes/${quote._id}/approve`, { expectedVersion:1, revision:1 }); await api(`/commercial/quotes/${quote._id}/accept`, { expectedVersion:2, revision:1 });
  const so = await api(`/commercial/quotes/${quote._id}/convert`, { expectedVersion:3, revision:1, idempotencyKey:randomUUID() });
  const vendor = await api('/procurement/vendors', { name:'Synthetic K2a serial source vendor' });
  const specs = [{ quantity:'3', uom:'UN', ratio:'1', serials:['SYNTH-K2A-A1','SYNTH-K2A-A2','SYNTH-K2A-A3'] }, { quantity:'6', uom:'SET', ratio:'2', serials:Array.from({ length:6 }, (_, i) => `SYNTH-K2A-B${i + 1}`) }];
  const pr = await api('/procurement/requests', { vendorId:vendor._id, taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:specs.map((spec, i) => ({ description:`Synthetic serial component ${i + 1}`, quantity:spec.quantity, uom:spec.uom, unitPrice:'1.00', currency:'USD' })) });
  await api(`/procurement/requests/${pr._id}/approve`, { expectedVersion:1 }); const po = await api(`/procurement/requests/${pr._id}/convert`, { expectedVersion:2, idempotencyKey:randomUUID() }); await api(`/procurement/orders/${po._id}/issue`, { expectedVersion:1 });
  const receipts = [];
  for (const [lineIndex, spec] of specs.entries()) {
    const receipt = await api('/warehouse/receipts', { purchaseOrderId:po._id, vendorId:vendor._id, expectedVersion:2, lineIndex, quantity:spec.quantity, uom:spec.uom, serials:spec.serials, lotNumber:`SYNTH-K2A-LOT-${lineIndex}`, heatNumber:`SYNTH-K2A-HEAT-${lineIndex}`, idempotencyKey:randomUUID() });
    await api(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion:1, reason:'Synthetic incoming serial inspection', idempotencyKey:randomUUID() }); await api(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion:2, location:'SYNTHETIC-K2A-INITIAL', idempotencyKey:randomUUID() });
    receipts.push({ ...receipt, spec });
  }
  const ids = receipts.map(row => row._id);
  const stock = async () => (await db.collection('warehouseReceipts').find({ _id:{ $in:ids } }).sort({ _id:1 }).toArray()).map(row => Object.fromEntries(['_id','quantity','availableQuantity','reservedQuantity','manufacturingReservedQuantity','manufacturingConsumedQuantity','shippedQuantity'].map(field => [field,row[field]])));
  const initialStock = await stock();
  for (const receipt of receipts) {
    const before = await api(receiptPath(receipt._id)); assert.equal(before.tracked, false); assert.deepEqual(before.units, []); assert.equal(before.claimableQuantity, null); assert.equal(before.canAdopt, true);
    await navigate(`warehouse/receipts/${receipt._id}`, `document.querySelector(${js(ADOPT)})`); await form.fillIn(ADOPT, 'reason', 'Synthetic explicit untouched received identity adoption');
    if(receipt._id===receipts[0]._id){
      await checked(`document.querySelector(${js(ADOPT)}).querySelector('[name=reason]').focus()`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await checked('document.activeElement.textContent'),'Adopt incoming serial custody');assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'),'solid');
      await call('Input.dispatchKeyEvent',{type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    }else await form.clickIn(ADOPT,'Adopt incoming serial custody');
    await ready(receiptReady(before.receiptVersion+1));
    const after = await api(receiptPath(receipt._id)); await ready(receiptReady(after.receiptVersion)); assert.equal(after.tracked, true); assert.equal(after.units.length, receipt.spec.serials.length); assert.equal(after.claimableQuantity, receipt.spec.quantity); assert.ok(after.units.every(unit => unit.status === 'AVAILABLE'));
    assert.deepEqual(await stock(), initialStock);
  }
  check('K2a native explicit adoption converts only verified untouched received identities; untracked registry has no fabricated availability and adoption changes no stock quantity');
  const bin = await api('/warehouse/bins', { expectedVersion:1, code:'SYNTHETIC-K2A-TRANSFER', idempotencyKey:randomUUID() });
  let receiptView = await api(receiptPath(receipts[0]._id));
  await api(`/warehouse/receipts/${receipts[0]._id}/transfer`, { expectedVersion:receiptView.receiptVersion, binId:bin._id, uom:'UN', reason:'Synthetic whole receipt move while all identities remain available', idempotencyKey:randomUUID() }); assert.deepEqual(await stock(), initialStock);
  await navigate(`manufacturing/plan/${so._id}`, 'document.querySelector("[name=serialCustodyRequired]")'); await fill('quantities','2\n1'); await fill('serialized','true'); await fill('genealogyRequired','true'); await fill('serialCustodyRequired','true'); await click('Plan work orders'); await ready('document.body.innerText.includes("Planned 2 work orders")');
  const workOrders = await db.collection('manufacturingWorkOrders').find({ salesOrderId:so._id }).sort({ quantity:-1 }).toArray(); assert.deepEqual(workOrders.map(row => row.quantity), ['2','1']); assert.ok(workOrders.every(row => row.serialCustodyRequired && row.genealogyRequired && row.serialized));
  const adopted = await Promise.all(receipts.map(receipt => api(receiptPath(receipt._id))));
  const selected = workOrders.map((wo, i) => adopted.map((view, source) => view.units.slice(i === 0 ? 0 : Number(workOrders[0].quantity) * Number(specs[source].ratio), i === 0 ? Number(wo.quantity) * Number(specs[source].ratio) : undefined)));
  const prepareClaim = async (wo, source, units) => {
    const view = await api(claimPath(wo._id)); await ready(woReady(view.workOrderVersion)); await form.fillIn('#work-order-serial-custody','receiptId',receipts[source]._id);
    await ready(`(()=>{const input=document.querySelector(${js(CLAIM)})?.querySelector('[name=serialUnitIds]');return input&&${js(units.map(unit => unit._id))}.every(id=>[...input.options].some(option=>option.value===id&&!option.disabled))})()`);
    await checked(`(()=>{const select=document.querySelector(${js(CLAIM)}).querySelector('[name=serialUnitIds]');for(const option of select.options)option.selected=${js(units.map(unit => unit._id))}.includes(option.value);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await form.fillIn(CLAIM,'reason','Synthetic explicit received serial custody claim'); return view;
  };
  let replayBody;
  for (const [index, wo] of workOrders.entries()) {
    await navigate(`manufacturing/work-orders/${wo._id}`, `document.querySelector('#work-order-serial-custody [name=receiptId]')`);
    for (const source of [0,1]) {
      const before = await prepareClaim(wo,source,selected[index][source]);
      if (index === 0 && source === 0) {
        let committed;
        const lost = await loseResponse(`*manufacturing/work-orders/${wo._id}/serial-claims`, () => form.clickIn(CLAIM,'Claim incoming serial identities'), async ({ command,receipt }) => { assert.deepEqual([...command.serialUnitIds].sort(), selected[index][source].map(unit => unit._id).sort()); assert.equal(receipt.data.claims.length,1); assert.deepEqual(await stock(),initialStock); committed=await effects(); });
        replayBody=lost.command; await ready(`document.querySelector(${js(CLAIM)})?.innerText.includes('Retry same custody command')`); await form.clickIn(CLAIM,'Retry same custody command'); await ready(woReady(lost.receipt.data.workOrderVersion)); assert.deepEqual(await effects(),committed);
        const claim=(await api(claimPath(wo._id))).claims[0], currentReceipt=await db.collection('warehouseReceipts').findOne({ _id:receipts[0]._id });
        const held=await api(`/warehouse/receipts/${currentReceipt._id}/holds`,{ expectedReceiptVersion:currentReceipt.version,reasonCode:'QC_SUSPECT',reasonNote:'Synthetic later hold keeps custody evidence' },{ 'Idempotency-Key':randomUUID() });
        await form.fillIn(ABANDON,'claimId',claim._id); await form.fillIn(ABANDON,'reason','Synthetic explicit abandoned planning claim during source hold'); await form.clickIn(ABANDON,'Abandon planned serial claim'); await ready(woReady(lost.receipt.data.workOrderVersion+1));
        const abandoned=await api(claimPath(wo._id)); await ready(woReady(abandoned.workOrderVersion)); assert.equal(abandoned.claims.length,0);
        receiptView=await api(receiptPath(receipts[0]._id)); assert.equal(receiptView.claimableQuantity,'0'); assert.equal(receiptView.sourceHolds.length,1); assert.ok(receiptView.units.every(unit=>unit.status==='AVAILABLE')); assert.deepEqual(await stock(),initialStock);
        await navigate(`warehouse/receipts/${receipts[0]._id}`,receiptReady(receiptView.receiptVersion)); await ready('document.querySelector("#receipt-serial-custody")?.innerText.includes("QC_SUSPECT")');
        await api(`/warehouse/holds/${held.hold.id}/release`,{ expectedVersion:held.hold.version,reasonCode:'INSPECTION_PASSED',reasonNote:'Synthetic custody source disposition cleared' },{ 'Idempotency-Key':randomUUID() });
        await navigate(`manufacturing/work-orders/${wo._id}`,`document.querySelector('#work-order-serial-custody [name=receiptId]')`); const reclaimBefore=await prepareClaim(wo,source,selected[index][source]); await form.clickIn(CLAIM,'Claim incoming serial identities'); await ready(woReady(reclaimBefore.workOrderVersion+1)); const reclaimed=await api(claimPath(wo._id)); await ready(woReady(reclaimed.workOrderVersion)); assert.notEqual(reclaimed.claims[0]._id,claim._id);
        check('K2a native claim response loss retries identical identities/versions/key once; explicit abandon during later hold frees metadata only, remains unclaimable until actual hold release, then native reclaim preserves event history');
      } else { await form.clickIn(CLAIM,'Claim incoming serial identities'); await ready(woReady(before.workOrderVersion+1)); }
    }
    const claims=await api(claimPath(wo._id)); assert.equal(claims.claims.length,2); for(const claim of claims.claims){const source=receipts.findIndex(receipt=>receipt._id===claim.receiptId);assert.equal(claim.serialUnitIds.length,Number(wo.quantity)*Number(specs[source].ratio));assert.equal(claim.status,'CLAIMED');}
  }
  assert.deepEqual(await stock(),initialStock);
  receiptView=await api(receiptPath(receipts[0]._id)); assert.equal(receiptView.quantityAvailable,'3'); assert.equal(receiptView.claimableQuantity,'0');
  const beforeQuantityDenials=await effects();
  const count=await send(`/warehouse/receipts/${receipts[0]._id}/count`,{ expectedVersion:receiptView.receiptVersion,countedQuantity:'3',uom:'UN',reason:'Synthetic quantity-only count must not overwrite identities',idempotencyKey:randomUUID() }); assert.equal(count.status,409); assert.equal(count.error.code,'SERIAL_CUSTODY_REQUIRED');
  const refusedMove=await send(`/warehouse/receipts/${receipts[0]._id}/transfer`,{ expectedVersion:receiptView.receiptVersion,binId:bin._id,uom:'UN',reason:'Synthetic claimed receipt transfer rejected',idempotencyKey:randomUUID() }); assert.equal(refusedMove.status,409);assert.equal(refusedMove.error.code,'SERIAL_CUSTODY_STATE_CONFLICT');assert.deepEqual(await effects(),beforeQuantityDenials);
  check('K2a three supplemental outputs explicitly claim nine received identities at integral ratios1/2; quantity-available remains distinct from claimable identities, adopted count and claimed transfer fail without stock changes');
  const inspectLayout=async(target,label)=>{for(const width of [1440,768,375,360]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await ready(`innerWidth===${width}`);await checked(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector(${js(target)}).scrollIntoView({block:'start',behavior:'instant'})})()`);assert.equal(await checked('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(await checked(`[...document.querySelector(${js(target)}).querySelectorAll('a,button,input,select,textarea,summary')].filter(element=>element.getBoundingClientRect().height&&getComputedStyle(element).position!=='absolute'&&element.getBoundingClientRect().height<43.9).map(element=>element.textContent)`),[]);await screenshot(`wave4k2a-${label}-${width}`);}await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});};
  await navigate(`manufacturing/work-orders/${workOrders[0]._id}`,`document.querySelector(${js(ABANDON)})`); await inspectLayout('#work-order-serial-custody','claimed');
  const credential=await db.collection('credentials').findOne({username:'alpha.owner'}),member=await db.collection('memberships').findOne({userId:credential._id}),beforeRevocation=await effects();
  await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:[{role:'custodyReader',plantIds:member.plantIds}]}});
  try {await call('Page.reload');await ready("document.querySelector('#work-order-serial-custody [name=receiptId]')");await form.fillIn('#work-order-serial-custody','receiptId',receipts[0]._id);await ready(`document.querySelector(${js(CLAIM)})?.querySelector('button')?.disabled===true`);assert.match(await form.disabledReason(CLAIM,'Claim incoming serial identities'),/permission/i);assert.match(await form.disabledReason(ABANDON,'Abandon planned serial claim'),/permission/i);assert.equal((await send(claimPath(workOrders[0]._id),replayBody)).status,403);assert.deepEqual(await effects(),beforeRevocation);}
  finally {await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:member.roles}});}
  await call('Page.reload');await ready(`document.querySelector(${js(ABANDON)})?.querySelector('button')?.disabled===false`);
  check('K2a custodyReader native reload retains evidence with explained disabled claim/abandon actions; revoked exact replay403 preserves domain effects and owner restoration recovers controls');
  const engineering=await api('/manufacturing/engineering',{expectedVersion:1,idempotencyKey:randomUUID(),salesOrderId:so._id,salesOrderVersion:so.version,lineIndex:0,uom:'UN',operations:[{code:'K2A-ASSEMBLE',instruction:'Synthetic received identity consumption'}],materials:receipts.map(receipt=>({receiptId:receipt._id,quantityPerUnit:receipt.spec.ratio,uom:receipt.uom}))});await api(`/manufacturing/engineering/${engineering._id}/release`,{expectedVersion:1,revision:1,idempotencyKey:randomUUID()});
  for(const [index,wo]of workOrders.entries()){
    await navigate(`manufacturing/work-orders/${wo._id}`,`document.querySelector(${js(index===0?RELEASE:ENGINEERING)})`);
    if(index===0){await form.fillIn(RELEASE,'code0','K2A-ASSEMBLE');await form.fillIn(RELEASE,'instruction0','Synthetic received identity consumption');await form.clickIn(RELEASE,'Add material');for(const [source,receipt]of receipts.entries()){await form.fillIn(RELEASE,`receiptId${source}`,receipt._id);await form.fillIn(RELEASE,`quantityPerUnit${source}`,receipt.spec.ratio);}await form.clickIn(RELEASE,'Release work order');}
    else {await form.fillIn(ENGINEERING,'engineeringId',engineering._id);await form.clickIn(ENGINEERING,'Release work order from engineering');}
    await ready('document.body.innerText.includes("Status: Ready to start")');let claims=await api(claimPath(wo._id));assert.ok(claims.claims.every(claim=>claim.status==='RESERVED'));
    const stored=await db.collection('manufacturingWorkOrders').findOne({_id:wo._id});for(const material of stored.routing.materials){const claim=claims.claims.find(row=>row.receiptId===material.receiptId);assert.deepEqual(material.serialCustody,{claimId:claim._id,serialUnitIds:claim.serialUnitIds,serials:claim.serials});}
    const serials=Array.from({length:Number(wo.quantity)},(_,i)=>`SYNTH-K2A-OUTPUT-${index}-${i}`),record='form[aria-label="Record operation"]';await form.fillIn(record,'goodQuantity',wo.quantity);await form.fillIn(record,'scrapQuantity','0');await form.fillIn(record,'evidence','Synthetic first operation consumes reserved identities once');await form.fillIn(record,'outputSerials',serials.join('\n'));await form.clickIn(record,'Record operation');await ready('document.body.innerText.includes("Status: Awaiting inspection")');claims=await api(claimPath(wo._id));assert.ok(claims.claims.every(claim=>claim.status==='CONSUMED'));
    const qc='form[aria-label="Record QC"]';await form.fillIn(qc,'acceptedQuantity',wo.quantity);await form.fillIn(qc,'rejectedQuantity','0');await form.fillIn(qc,'acceptedSerials',serials.join('\n'));await form.fillIn(qc,'rejectedSerials','');await form.fillIn(qc,'evidence','Synthetic K2a output QC record');await form.clickIn(qc,'Record QC');await ready('document.body.innerText.includes("Status: Quality complete")');
    assert.equal(await checked(`Boolean(document.querySelector(${js(CLAIM)}))`),false);assert.equal(await checked(`Boolean(document.querySelector(${js(ABANDON)}))`),false);
  }
  const consumption=await db.collection('manufacturingMovements').find({workOrderId:{$in:workOrders.map(row=>row._id)},kind:'MATERIAL_CONSUMED'}).toArray();assert.equal(consumption.length,4);for(const movement of consumption){const claim=await db.collection('serialCustodyClaims').findOne({_id:movement.serialCustody.claimId});assert.equal(claim.status,'CONSUMED');assert.deepEqual(movement.serialCustody,{claimId:claim._id,serialUnitIds:claim.serialUnitIds,serials:claim.serials});}
  for(const receipt of receipts){const final=await api(receiptPath(receipt._id));assert.equal(final.quantityAvailable,'0');assert.equal(final.claimableQuantity,'0');assert.ok(final.units.every(unit=>unit.status==='CONSUMED'));const row=await db.collection('warehouseReceipts').findOne({_id:receipt._id});assert.equal(row.manufacturingConsumedQuantity,receipt.spec.quantity);assert.equal(row.manufacturingReservedQuantity,'0');}
  check('K2a native manual and frozen-engineering release reserve exact complete claims; first native operation consumes the same nine identities and quantity budgets once, with immutable source pointers in four real consumption movements');
  const events=await send(`${claimPath(workOrders[0]._id)}/events?limit=2`);assert.equal(events.status,200);assert.equal(events.data.length,2);assert.ok(events.page.nextCursor);let cursor=events.page.nextCursor,history=[...events.data];while(cursor){const page=await send(`${claimPath(workOrders[0]._id)}/events?limit=2&cursor=${cursor}`);assert.equal(page.status,200);history.push(...page.data);cursor=page.page.nextCursor;}assert.ok(history.some(event=>event.kind==='ABANDONED'));assert.equal(new Set(history.map(event=>event._id)).size,history.length);
  const origin=await checked('performance.timeOrigin');await call('Page.reload');await ready(`performance.timeOrigin!==${origin}&&document.querySelector('#work-order-serial-custody')?.innerText.includes('CONSUMED')`);assert.ok(await checked(`document.querySelector('#work-order-serial-custody').innerText.includes('UNRECORDED')`));await inspectLayout('#work-order-serial-custody','consumed');
  await navigate(`warehouse/receipts/${receipts[0]._id}`,`document.querySelector('#receipt-serial-custody')?.innerText.includes('Status: Consumed')`);await inspectLayout('#receipt-serial-custody','receipt');
  assert.equal(await db.collection('manufacturingMovements').countDocuments({workOrderId:{$in:workOrders.map(row=>row._id)},kind:'MATERIAL_CONSUMED'}),4);
  check('K2a consumed identity evidence survives native reload and event pagination; three real custody sections measured at four widths with no page overflow or targets below44px; installation remains explicitly UNRECORDED and full K2/E01 remain open');
}
