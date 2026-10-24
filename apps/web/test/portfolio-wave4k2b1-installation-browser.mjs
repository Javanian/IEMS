import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseExpression } from '@babel/parser';
import { scoped } from './wave4f-browser-kit.mjs';

const js = JSON.stringify;
const RECORD = 'form[aria-label="Record received component installation"]';
const FINALIZE = 'form[aria-label="Finalize received component installation"]';
const REMOVE = 'form[aria-label="Remove installed received component"]';
const LOSSES = 'form[aria-label="Record received component process loss"]';
const SHIP = 'form[aria-label="Record shipment"]';

export async function installationJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse }) {
  const checked = expression => { parseExpression(expression); return evaluate(expression); };
  const ready = expression => { parseExpression(expression); return wait(expression); };
  const form = scoped({ evaluate:checked, wait:ready });
  const send = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method:body ? 'POST' : 'GET', headers, ...(body && { body:JSON.stringify(body) }) });
    return { status:response.status, ...await response.json() };
  };
  const api = async (path, body) => { const response = await send(path, body); assert.ok([200,201].includes(response.status), `${path}: ${JSON.stringify(response)}`); return response.data; };
  const navigate = async (path, condition) => { await call('Page.navigate', { url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` }); await ready(condition); };
  const base = id => `/manufacturing/work-orders/${id}/installations`;
  const woPath = id => `/manufacturing/work-orders/${id}`;
  const visibleVersion = version => `document.querySelector('#component-installation')?.getAttribute('data-installation-version')===${js(String(version))}`;
  const selectMany = async (selector, name, values) => {
    await ready(`document.querySelector(${js(selector)})?.querySelector('[name=${name}]')`);
    await checked(`(()=>{const select=document.querySelector(${js(selector)}).querySelector('[name=${name}]');for(const option of select.options)option.selected=${js(values)}.includes(option.value);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const businessEffects = () => Promise.all(['manufacturingWorkOrders','manufacturingOutputUnits','manufacturingMovements','manufacturingAudit','manufacturingOutbox','manufacturingKeys','serialCustodyUnits','serialCustodyClaims','serialCustodyEvents','warehouseReceipts','warehouseMovements','componentInstallationHeads','componentInstallationLinks','componentInstallationRevisions','componentInstallationEvents','componentInstallationGraph'].map(name => db.collection(name).find({}).sort({ _id:1 }).toArray()));
  const account = await api('/crm/accounts', { name:'Synthetic K2b1 received installation customer' });
  const quote = await api('/commercial/quotes', { accountId:account._id, expiresAt:'2027-01-01T00:00:00.000Z', taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:[{ description:'Synthetic supplemental installed outputs',quantity:'3',uom:'UN',unitPrice:'1.00',currency:'USD' }] });
  await api(`/commercial/quotes/${quote._id}/approve`,{expectedVersion:1,revision:1}); await api(`/commercial/quotes/${quote._id}/accept`,{expectedVersion:2,revision:1});
  const so = await api(`/commercial/quotes/${quote._id}/convert`,{expectedVersion:3,revision:1,idempotencyKey:randomUUID()});
  const vendor = await api('/procurement/vendors',{name:'Synthetic K2b1 incoming serial supplier'});
  const specs = [{quantity:'3',uom:'UN',ratio:'1',serials:['SYNTH-K2B1-A1','SYNTH-K2B1-A2','SYNTH-K2B1-A3']},{quantity:'6',uom:'SET',ratio:'2',serials:Array.from({length:6},(_,i)=>`SYNTH-K2B1-B${i+1}`)}];
  const pr = await api('/procurement/requests',{vendorId:vendor._id,taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:specs.map((spec,i)=>({description:`Synthetic K2b1 component ${i}`,quantity:spec.quantity,uom:spec.uom,unitPrice:'1.00',currency:'USD'}))});
  await api(`/procurement/requests/${pr._id}/approve`,{expectedVersion:1}); const po=await api(`/procurement/requests/${pr._id}/convert`,{expectedVersion:2,idempotencyKey:randomUUID()}); await api(`/procurement/orders/${po._id}/issue`,{expectedVersion:1});
  const receipts=[];
  for(const [lineIndex,spec] of specs.entries()) {
    const receipt=await api('/warehouse/receipts',{purchaseOrderId:po._id,vendorId:vendor._id,expectedVersion:2,lineIndex,quantity:spec.quantity,uom:spec.uom,serials:spec.serials,lotNumber:`SYNTH-K2B1-LOT-${lineIndex}`,heatNumber:`SYNTH-K2B1-HEAT-${lineIndex}`,idempotencyKey:randomUUID()});
    await api(`/warehouse/receipts/${receipt._id}/release`,{expectedVersion:1,reason:'Synthetic incoming inspection',idempotencyKey:randomUUID()});
    await api(`/warehouse/receipts/${receipt._id}/putaway`,{expectedVersion:2,location:'SYNTHETIC-K2B1',idempotencyKey:randomUUID()});
    await api(`/warehouse/receipts/${receipt._id}/serial-custody/adopt`,{expectedVersion:3,reason:'Synthetic explicit received identity adoption',idempotencyKey:randomUUID()});
    receipts.push({...receipt,spec});
  }
  await navigate(`manufacturing/plan/${so._id}`,'document.querySelector("[name=installationRequired]")');
  await fill('quantities','2\n1');await fill('serialized','true');await fill('genealogyRequired','true');await fill('serialCustodyRequired','true');await fill('installationRequired','true');await click('Plan work orders');
  await ready('document.body.innerText.includes("Planned 2 work orders")');
  const wos=await db.collection('manufacturingWorkOrders').find({salesOrderId:so._id}).sort({quantity:-1}).toArray();assert.deepEqual(wos.map(wo=>wo.quantity),['2','1']);assert.ok(wos.every(wo=>wo.installationRequired));
  const parents=new Map();
  for(const [index,wo] of wos.entries()) {
    for(const receipt of receipts) {
      const view=await api(`/warehouse/receipts/${receipt._id}/serial-custody`),current=await api(`${woPath(wo._id)}/serial-claims`);
      const selected=view.units.filter(unit=>unit.status==='AVAILABLE').slice(0,Number(wo.quantity)*Number(receipt.spec.ratio));
      await api(`${woPath(wo._id)}/serial-claims`,{expectedVersion:current.workOrderVersion,expectedReceiptVersion:view.receiptVersion,receiptId:receipt._id,serialUnitIds:selected.map(unit=>unit._id),reason:'Synthetic supplemental input claim',idempotencyKey:randomUUID()});
    }
    let current=await api(`${woPath(wo._id)}/serial-claims`);
    await api(`${woPath(wo._id)}/release`,{expectedVersion:current.workOrderVersion,operations:[{code:'K2B1-ASSEMBLE',instruction:'Synthetic explicit installation preparation'}],materials:receipts.map(receipt=>({receiptId:receipt._id,quantityPerUnit:receipt.spec.ratio,uom:receipt.uom})),serialClaims:current.claims.map(claim=>({receiptId:claim.receiptId,claimId:claim._id})),idempotencyKey:randomUUID()});
    current=await api(woPath(wo._id)); const serials=Array.from({length:Number(wo.quantity)},(_,i)=>`SYNTH-K2B1-OUT-${index}-${i}`);
    await api(`${woPath(wo._id)}/record`,{expectedVersion:current.version,operationIndex:0,inputQuantity:wo.quantity,goodQuantity:wo.quantity,scrapQuantity:'0',uom:'UN',evidence:'Synthetic installation final output evidence',outputSerials:serials,idempotencyKey:randomUUID()});
    current=await api(woPath(wo._id));await api(`${woPath(wo._id)}/qc`,{expectedVersion:current.version,acceptedQuantity:wo.quantity,rejectedQuantity:'0',uom:'UN',evidence:'Synthetic K2b1 QC partition',acceptedSerials:serials,rejectedSerials:[],idempotencyKey:randomUUID()});
    const units=await api(`${woPath(wo._id)}/output-units`);parents.set(wo._id,units);
    for(const unit of units) {
      const view=await api(`${woPath(wo._id)}/genealogy`);
      await api(`${woPath(wo._id)}/genealogy/allocations`,{expectedVersion:view.workOrderVersion,expectedGenealogyVersion:view.version,outputUnitId:unit._id,materials:receipts.map(receipt=>({receiptId:receipt._id,quantity:receipt.spec.ratio,uom:receipt.uom})),reason:'Synthetic exact per-output lot allocation',idempotencyKey:randomUUID()});
    }
    const view=await api(`${woPath(wo._id)}/genealogy`);await api(`${woPath(wo._id)}/genealogy/finalize`,{expectedVersion:view.workOrderVersion,expectedGenealogyVersion:view.version,reason:'Synthetic reconciled lot baseline',idempotencyKey:randomUUID()});
  }
  const receiptIds=receipts.map(receipt=>receipt._id);
  const stock=async()=>(await db.collection('warehouseReceipts').find({_id:{$in:receiptIds}}).sort({_id:1}).toArray()).map(row=>Object.fromEntries(['_id','quantity','availableQuantity','reservedQuantity','manufacturingReservedQuantity','manufacturingConsumedQuantity','shippedQuantity'].map(key=>[key,row[key]])));
  const consumption=()=>db.collection('manufacturingMovements').find({workOrderId:{$in:wos.map(wo=>wo._id)},kind:'MATERIAL_CONSUMED'}).sort({_id:1}).toArray();
  const stockBefore=await stock(),consumptionBefore=await consumption();assert.equal(consumptionBefore.length,4);
  check('K2b1 native plan opt-in produces new required WOs; real supplemental ratio1/2 adoption, claims, consumption, output QC and K1 finalization establish authority without modifying canonical E01');

  const main=wos[0];let replayBody;
  await navigate(`manufacturing/work-orders/${main._id}`,`document.querySelector(${js(RECORD)})`);
  for(const [index,parent] of parents.get(main._id).entries()) {
    const view=await api(base(main._id));await ready(visibleVersion(view.version));
    await form.fillIn(RECORD,'outputUnitId',parent._id);
    const selected=receipts.flatMap(receipt=>view.components.filter(component=>component.receiptId===receipt._id&&!component.disposition).slice(0,Number(receipt.spec.ratio)));
    await selectMany(RECORD,'serialUnitIds',selected.map(component=>component._id));await form.fillIn(RECORD,'reason','Synthetic explicit same-WO installed identity evidence');
    if(index===0) {
      let afterCommit;
      const lost=await loseResponse(`*manufacturing/work-orders/${main._id}/installations/record`,()=>form.clickIn(RECORD,'Record received component installation'),async({command,receipt})=>{assert.equal(command.components.length,3);assert.equal(receipt.data.version,view.version+1);assert.deepEqual(await stock(),stockBefore);afterCommit=await businessEffects();});
      replayBody=lost.command;
      await ready('document.body.innerText.includes("Retry same installation command")');
      await click('Retry same installation command');await ready(visibleVersion(view.version+1));assert.deepEqual(await businessEffects(),afterCommit);
      check('K2b1 native explicit parent and received UUID selection survives uncertain acknowledgement; exact retry preserves one installation effect and unchanged consumed stock');
    } else {await form.clickIn(RECORD,'Record received component installation');await ready(visibleVersion(view.version+1));}
  }
  let current=await api(base(main._id));assert.equal(current.edges.filter(edge=>edge.status==='ACTIVE').length,6);assert.equal(current.canFinalize,true);assert.equal(current.incompleteParents.length,0);
  await form.fillIn(FINALIZE,'reason','Synthetic exact installation reconciliation');
  await checked(`document.querySelector(${js(FINALIZE)}).querySelector('[name=reason]').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await checked('document.activeElement.textContent'),'Finalize received component installation');assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'),'solid');
  await call('Input.dispatchKeyEvent',{type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await ready(visibleVersion(current.version+1));current=await api(base(main._id));assert.equal(current.status,'COMPLETE');
  check('K2b1 native two output parents explicitly bind six consumed identities with exact source ratios and finalize only after K1 and identity conservation agree');

  const inspectLayout=async label=>{for(const width of [1440,768,375,360]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await ready(`innerWidth===${width}`);await checked(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector('#component-installation').scrollIntoView({block:'start',behavior:'instant'})})()`);assert.equal(await checked('document.documentElement.scrollWidth>innerWidth'),false);assert.deepEqual(await checked(`[...document.querySelectorAll('#component-installation a,#component-installation button,#component-installation input,#component-installation select,#component-installation textarea,#component-installation summary')].filter(element=>element.getBoundingClientRect().height&&getComputedStyle(element).position!=='absolute'&&element.getBoundingClientRect().height<43.9).map(element=>element.textContent)`),[]);await screenshot(`wave4k2b1-${label}-${width}`);}await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});};
  await inspectLayout('complete');

  const secondary=wos[1],parent=parents.get(secondary._id)[0];
  await navigate(`manufacturing/work-orders/${secondary._id}`,`document.querySelector(${js(RECORD)})`);let secondaryView=await api(base(secondary._id));
  await form.fillIn(RECORD,'outputUnitId',parent._id);await selectMany(RECORD,'serialUnitIds',secondaryView.components.map(component=>component._id));await form.fillIn(RECORD,'reason','Synthetic removable installed identity evidence');await form.clickIn(RECORD,'Record received component installation');await ready(visibleVersion(secondaryView.version+1));
  secondaryView=await api(base(secondary._id));const removed=secondaryView.edges.find(edge=>edge.status==='ACTIVE');
  await form.fillIn(REMOVE,'edgeId',removed._id);await form.fillIn(REMOVE,'reason','Synthetic controlled removal without stock restoration');await form.clickIn(REMOVE,'Remove installed received component');await ready(visibleVersion(secondaryView.version+1));
  secondaryView=await api(base(secondary._id));assert.equal(secondaryView.canFinalize,false);assert.equal(secondaryView.components.find(component=>component._id===removed.childId).disposition,'REMOVED_QUARANTINE');
  const beforeReuse=await businessEffects();const retired=secondaryView.components.find(component=>component._id===removed.childId);
  const reuse=await send(`${base(secondary._id)}/record`,{expectedVersion:secondaryView.workOrderVersion,expectedInstallationVersion:secondaryView.version,outputUnitId:parent._id,components:[{serialUnitId:retired._id,expectedUnitVersion:retired.version}],reason:'Synthetic retired identity reuse denied',idempotencyKey:randomUUID()});assert.equal(reuse.status,409);assert.deepEqual(await businessEffects(),beforeReuse);
  await inspectLayout('removed');check('K2b1 native removal preserves original parent/source and permanently quarantines installation disposition; reuse is denied, parent remains incomplete and input inventory stays CONSUMED');

  await navigate(`manufacturing/work-orders/${main._id}`,'document.querySelector("#component-installation")');
  const credential=await db.collection('credentials').findOne({username:'alpha.owner'}),member=await db.collection('memberships').findOne({userId:credential._id}),beforeRevocation=await businessEffects();
  await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:[{role:'installationReader',plantIds:member.plantIds}]}});
  try {await call('Page.reload');await ready('document.querySelector("#component-installation")');assert.match(await form.disabledReason(RECORD,'Record received component installation'),/record permission/);assert.match(await form.disabledReason(REMOVE,'Remove installed received component'),/removal permission/);assert.match(await form.disabledReason(FINALIZE,'Finalize received component installation'),/finalize permission/);assert.equal((await send(`${base(main._id)}/record`,replayBody)).status,403);assert.deepEqual(await businessEffects(),beforeRevocation);assert.ok(await checked('document.querySelector("#component-installation").innerText.includes("COMPLETE")'));}
  finally {await db.collection('memberships').updateOne({_id:member._id},{$set:{roles:member.roles}});}
  await call('Page.reload');await ready('document.querySelector("#component-installation")');check('K2b1 installationReader hard reload retains scoped evidence and revoked exact command replay403 leaves domain effects unchanged');

  let frozenPointer;
  for(const [index,unit]of parents.get(main._id).entries()) {
    const reference=`Synthetic K2b1 partial dispatch ${index+1}`;
    await navigate(`fulfillment/orders/${so._id}`,'document.querySelector("[name=sourceId]")');await fill('sourceId',main._id);await ready(`Array.from(document.querySelector('[name=serials]')?.options||[]).some(option=>option.value===${js(unit.serial)})`);
    await selectMany(SHIP,'serials',[unit.serial]);await form.fillIn(SHIP,'quantity','1');await form.fillIn(SHIP,'reference',reference);await form.clickIn(SHIP,'Record shipment');
    await ready(`Array.from(document.querySelector('[name=shipmentId]')?.options||[]).some(option=>option.textContent.includes(${js(reference)}))`);
    const shipment=await db.collection('fulfillmentShipments').findOne({salesOrderId:so._id,reference}),pointer=shipment.sources[0].installation;assert.ok(pointer?.contentHash);if(frozenPointer)assert.deepEqual(pointer,frozenPointer);else frozenPointer=pointer;
    assert.deepEqual((await db.collection('warehouseMovements').findOne({shipmentId:shipment._id,kind:'SHIP'})).installation,pointer);assert.deepEqual((await db.collection('manufacturingOutputUnits').findOne({_id:unit._id})).installation,pointer);
    await navigate(`fulfillment/shipments/${shipment._id}`,`document.body.innerText.includes(${js(pointer.contentHash)})`);
    await navigate(`manufacturing/work-orders/${main._id}`,'document.querySelector("#component-installation")?.innerText.includes("FROZEN")');
    const frozen=await api(base(main._id));assert.equal(frozen.status,'FROZEN');assert.equal(await checked(`Boolean(document.querySelector(${js(RECORD)}))`),false);
    if(index===0){const failed=await send(`${base(main._id)}/remove`,{expectedVersion:frozen.workOrderVersion,expectedInstallationVersion:frozen.version,edgeId:frozen.edges[0]._id,expectedEdgeVersion:frozen.edges[0].version,expectedUnitVersion:frozen.components.find(component=>component._id===frozen.edges[0].childId).version,reason:'Synthetic frozen remaining unit edit denied',idempotencyKey:randomUUID()});assert.equal(failed.status,409);assert.equal(failed.error.code,'INSTALLATION_FROZEN');}
  }
  await inspectLayout('frozen');assert.deepEqual(await stock(),stockBefore);assert.deepEqual(await consumption(),consumptionBefore);assert.ok((await db.collection('serialCustodyUnits').find({receiptId:{$in:receiptIds}}).toArray()).every(unit=>unit.status==='CONSUMED'));
  const history=await send(`${base(main._id)}/revisions?limit=1`);assert.equal(history.status,200);assert.equal(history.data.length,1);assert.ok(history.page.nextCursor);const more=await send(`${base(main._id)}/revisions?limit=1&cursor=${history.page.nextCursor}`);assert.equal(more.status,200);assert.notEqual(more.data[0]._id,history.data[0]._id);
  await click(`Inspect installation revision ${frozenPointer.revision}`);await ready(`document.querySelector('#component-installation').innerText.includes(${js(`Immutable installation revision ${frozenPointer.revision}`)})`);assert.equal(await checked(`document.querySelector('#component-installation').innerText.includes(${js(frozenPointer.contentHash)})`),true);
  check('K2b1 native partial dispatches freeze the entire installation head and retain identical immutable source/movement/output pointers through reload; later edits fail and no material is consumed twice');

  const lossQuote=await api('/commercial/quotes',{accountId:account._id,expiresAt:'2027-01-01T00:00:00.000Z',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'Synthetic zero-good installation loss',quantity:'1',uom:'UN',unitPrice:'1.00',currency:'USD'}]});
  await api(`/commercial/quotes/${lossQuote._id}/approve`,{expectedVersion:1,revision:1});await api(`/commercial/quotes/${lossQuote._id}/accept`,{expectedVersion:2,revision:1});const lossSo=await api(`/commercial/quotes/${lossQuote._id}/convert`,{expectedVersion:3,revision:1,idempotencyKey:randomUUID()});
  const lossPr=await api('/procurement/requests',{vendorId:vendor._id,taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'Synthetic process-loss serials',quantity:'2',uom:'SET',unitPrice:'1.00',currency:'USD'}]});await api(`/procurement/requests/${lossPr._id}/approve`,{expectedVersion:1});const lossPo=await api(`/procurement/requests/${lossPr._id}/convert`,{expectedVersion:2,idempotencyKey:randomUUID()});await api(`/procurement/orders/${lossPo._id}/issue`,{expectedVersion:1});
  const lossReceipt=await api('/warehouse/receipts',{purchaseOrderId:lossPo._id,vendorId:vendor._id,expectedVersion:2,lineIndex:0,quantity:'2',uom:'SET',serials:['SYNTH-K2B1-LOSS-1','SYNTH-K2B1-LOSS-2'],lotNumber:'SYNTH-K2B1-LOSS-LOT',heatNumber:'SYNTH-K2B1-LOSS-HEAT',idempotencyKey:randomUUID()});
  await api(`/warehouse/receipts/${lossReceipt._id}/release`,{expectedVersion:1,reason:'Synthetic loss input inspection',idempotencyKey:randomUUID()});await api(`/warehouse/receipts/${lossReceipt._id}/putaway`,{expectedVersion:2,location:'SYNTHETIC-K2B1-LOSS',idempotencyKey:randomUUID()});await api(`/warehouse/receipts/${lossReceipt._id}/serial-custody/adopt`,{expectedVersion:3,reason:'Synthetic explicit loss input adoption',idempotencyKey:randomUUID()});
  const lossBatch=await api('/manufacturing/work-orders',{salesOrderId:lossSo._id,expectedVersion:lossSo.version,lineIndex:0,quantities:['1'],uom:'UN',serialized:true,genealogyRequired:true,serialCustodyRequired:true,installationRequired:true,idempotencyKey:randomUUID()});const lossWo=lossBatch.workOrders[0];
  let lossClaim=await api(`${woPath(lossWo._id)}/serial-claims`),lossSource=await api(`/warehouse/receipts/${lossReceipt._id}/serial-custody`);
  await api(`${woPath(lossWo._id)}/serial-claims`,{expectedVersion:lossClaim.workOrderVersion,expectedReceiptVersion:lossSource.receiptVersion,receiptId:lossReceipt._id,serialUnitIds:lossSource.units.map(unit=>unit._id),reason:'Synthetic explicit loss input claim',idempotencyKey:randomUUID()});lossClaim=await api(`${woPath(lossWo._id)}/serial-claims`);
  await api(`${woPath(lossWo._id)}/release`,{expectedVersion:lossClaim.workOrderVersion,operations:[{code:'K2B1-LOSS',instruction:'Synthetic zero-good process'}],materials:[{receiptId:lossReceipt._id,quantityPerUnit:'2',uom:'SET'}],serialClaims:lossClaim.claims.map(claim=>({receiptId:claim.receiptId,claimId:claim._id})),idempotencyKey:randomUUID()});
  let lossCurrent=await api(woPath(lossWo._id));await api(`${woPath(lossWo._id)}/record`,{expectedVersion:lossCurrent.version,operationIndex:0,inputQuantity:'1',goodQuantity:'0',scrapQuantity:'1',uom:'UN',evidence:'Synthetic zero-good output loss evidence',outputSerials:[],idempotencyKey:randomUUID()});lossCurrent=await api(woPath(lossWo._id));await api(`${woPath(lossWo._id)}/qc`,{expectedVersion:lossCurrent.version,acceptedQuantity:'0',rejectedQuantity:'0',uom:'UN',evidence:'Synthetic zero-output QC evidence',acceptedSerials:[],rejectedSerials:[],idempotencyKey:randomUUID()});
  let lossGenealogy=await api(`${woPath(lossWo._id)}/genealogy`);await api(`${woPath(lossWo._id)}/genealogy/losses`,{expectedVersion:lossGenealogy.workOrderVersion,expectedGenealogyVersion:lossGenealogy.version,losses:[{receiptId:lossReceipt._id,quantity:'2',uom:'SET',reason:'Synthetic all consumed input lost in process'}],reason:'Synthetic explicit lot process loss',idempotencyKey:randomUUID()});lossGenealogy=await api(`${woPath(lossWo._id)}/genealogy`);await api(`${woPath(lossWo._id)}/genealogy/finalize`,{expectedVersion:lossGenealogy.workOrderVersion,expectedGenealogyVersion:lossGenealogy.version,reason:'Synthetic reconciled zero-output lots',idempotencyKey:randomUUID()});
  await navigate(`manufacturing/work-orders/${lossWo._id}`,`document.querySelector(${js(LOSSES)})`);let lossView=await api(base(lossWo._id));assert.equal(lossView.parents.length,0);await selectMany(LOSSES,'lossSerialUnitIds',lossView.components.map(component=>component._id));await form.fillIn(LOSSES,'reason','Synthetic explicit consumed process-loss identities');await form.clickIn(LOSSES,'Record received component process loss');await ready(visibleVersion(lossView.version+1));lossView=await api(base(lossWo._id));assert.equal(lossView.losses.length,2);assert.equal(lossView.canFinalize,true);
  await form.fillIn(FINALIZE,'reason','Synthetic all identities explicitly lost with no invented parent');await form.clickIn(FINALIZE,'Finalize received component installation');await ready(visibleVersion(lossView.version+1));lossView=await api(base(lossWo._id));assert.equal(lossView.status,'COMPLETE');assert.equal(lossView.edges.length,0);assert.equal(lossView.components.every(component=>component.disposition==='PROCESS_LOSS'&&component.status==='CONSUMED'),true);
  check('K2b1 native process-loss selection accounts for two already-consumed ratio2 identities and finalizes zero-good output without inventing an installation parent or restoring inventory');
}
