import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseExpression } from '@babel/parser';
import fixtureModule from '../../../packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js';
import { scoped } from './wave4f-browser-kit.mjs';

const { e01ManufacturingFixture: fixture } = fixtureModule;
const js = JSON.stringify;
const UNIT = 'form[aria-label="Save unit lot attribution"]';
const LOSSES = 'form[aria-label="Save process losses"]';
const FINALIZE = 'form[aria-label="Finalize lot genealogy"]';
const SHIP = 'form[aria-label="Record shipment"]';
const materialDefinitions = fixture.procurement.goods_receipt.lines.map((line, index) => ({ code:line.item_code, lotNumber:line.lot_number, heatNumber:line.heat_number, uom:line.uom, ratio:fixture.engineering_package.bom.components[index].qty_per_parent, quantity:line.received_qty }));

export async function genealogyJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse }) {
  const checked = expression => { parseExpression(expression); return evaluate(expression); };
  const ready = (expression, label) => { parseExpression(expression); return wait(expression, label); };
  const form = scoped({ evaluate:checked, wait:ready });
  const request = async (path, body, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method:body ? 'POST' : 'GET', headers:{ ...headers, ...extra }, ...(body && { body:JSON.stringify(body) }) });
    return { status:response.status, ...await response.json() };
  };
  const api = async (path, body, extra) => { const response = await request(path, body, extra); assert.ok([200, 201].includes(response.status), `${path}: ${JSON.stringify(response)}`); return response.data; };
  const navigate = async (path, expression) => { await call('Page.navigate', { url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` }); await ready(expression); };
  const base = id => `/manufacturing/work-orders/${id}/genealogy`;
  const versionVisible = version => `document.querySelector('#lot-genealogy')?.innerText.includes(${js(`Genealogy version: ${version} ·`)})`;
  const waitForView = async view => { await ready(versionVisible(view.version)); await ready(`document.querySelector(${js(UNIT)})?.querySelector('fieldset')?.disabled===false`); };
  const effects = () => Promise.all(['manufacturingWorkOrders', 'manufacturingOutputUnits', 'manufacturingAudit', 'manufacturingOutbox', 'manufacturingKeys', 'genealogyHeads', 'genealogyRevisions', 'genealogyAllocations', 'genealogyBalances', 'genealogyAttributionLedger'].map(name => db.collection(name).find({}).sort({ _id:1 }).toArray()));
  const inspectLayout = async mode => {
    const target = mode === 'editable' ? UNIT : '#lot-genealogy';
    for (const width of [1440, 768, 375, 360]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height:1000, deviceScaleFactor:1, mobile:width < 600 }); await ready(`innerWidth===${width}`);
      await checked(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector(${js(target)}).scrollIntoView({block:'start',behavior:'instant'})})()`);
      assert.equal(await checked('document.documentElement.scrollWidth>innerWidth'), false);
      const controls = await checked('[...document.querySelectorAll("#lot-genealogy a,#lot-genealogy button,#lot-genealogy input,#lot-genealogy select,#lot-genealogy textarea,#lot-genealogy summary")].filter(element=>element.getBoundingClientRect().height&&getComputedStyle(element).position!=="absolute"&&element.getBoundingClientRect().height<43.9).map(element=>element.textContent)'); assert.deepEqual(controls, []);
      const top = await checked(`document.querySelector(${js(target)}).getBoundingClientRect().top`); assert.ok(top >= -1 && top < 1000);
      if (mode === 'frozen' && width <= 768) {
        const cells = await checked(`(()=>{const wrap=document.querySelector('.pf-genealogy-scroll');const table=wrap.querySelector('table');return {contained:wrap.scrollWidth>wrap.clientWidth,sourceWidth:table.querySelector('td').getBoundingClientRect().width}})()`);
        assert.equal(cells.contained, true); assert.ok(cells.sourceWidth >= 288);
        await checked(`document.querySelector('.pf-genealogy-scroll').focus()`);
        assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
        await call('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
        await call('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
        await ready(`document.querySelector('.pf-genealogy-scroll').scrollLeft>0`);
        await checked(`document.querySelector('.pf-genealogy-scroll').scrollLeft=0`);
      }

      await screenshot(`wave4k-lot-genealogy-${mode}-${width}`);
    }
    await call('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false });
  };
  const account = await api('/crm/accounts', { name:'Synthetic K1 lot attribution customer' });
  const quote = await api('/commercial/quotes', { accountId:account._id, expiresAt:'2027-01-01T00:00:00.000Z', taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:[{ description:'Synthetic K1 bounded lot attribution output', quantity:'10', uom:'UN', unitPrice:'10.00', currency:'USD' }] });
  await api(`/commercial/quotes/${quote._id}/approve`, { expectedVersion:1, revision:1 });
  await api(`/commercial/quotes/${quote._id}/accept`, { expectedVersion:2, revision:1 });
  const order = await api(`/commercial/quotes/${quote._id}/convert`, { expectedVersion:3, revision:1, idempotencyKey:randomUUID() });
  const vendor = await api('/procurement/vendors', { name:'Synthetic K1 consumed material vendor' });
  const pr = await api('/procurement/requests', { vendorId:vendor._id, taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:materialDefinitions.map(material => ({ description:material.code, quantity:material.quantity, uom:material.uom, unitPrice:'1.00', currency:'USD' })) });
  await api(`/procurement/requests/${pr._id}/approve`, { expectedVersion:1 });
  const po = await api(`/procurement/requests/${pr._id}/convert`, { expectedVersion:2, idempotencyKey:randomUUID() });
  await api(`/procurement/orders/${po._id}/issue`, { expectedVersion:1 });
  const receipts = [];
  for (const [lineIndex, material] of materialDefinitions.entries()) {
    const receipt = await api('/warehouse/receipts', { purchaseOrderId:po._id, vendorId:vendor._id, expectedVersion:2, lineIndex, quantity:material.quantity, uom:material.uom, lotNumber:material.lotNumber, heatNumber:material.heatNumber, idempotencyKey:randomUUID() });
    await api(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion:1, reason:'Synthetic source inspection', idempotencyKey:randomUUID() });
    await api(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion:2, location:'SYNTHETIC-K1-SOURCES', idempotencyKey:randomUUID() });
    receipts.push({ ...receipt, definition:material });
  }
  await navigate(`manufacturing/plan/${order._id}`, 'document.querySelector("[name=genealogyRequired]")');
  await fill('quantities', '6\n4'); await fill('serialized', 'true'); await fill('genealogyRequired', 'true'); await click('Plan work orders');
  await ready('document.body.innerText.includes("Planned 2 work orders")');
  const workOrders = await db.collection('manufacturingWorkOrders').find({ salesOrderId:order._id }).sort({ quantity:-1 }).toArray();
  assert.deepEqual(workOrders.map(row => row.quantity), ['6', '4']); assert.ok(workOrders.every(row => row.serialized && row.genealogyRequired));
  const unitsByWo = new Map();
  for (const [index, wo] of workOrders.entries()) {
    const path = `/manufacturing/work-orders/${wo._id}`, serials = Array.from({ length:Number(wo.quantity) }, (_, n) => `SYNTH-K1-${index + 1}-${n + 1}`);
    await api(`${path}/release`, { expectedVersion:1, operations:[{ code:'K1-ASSEMBLE', instruction:'Synthetic bounded lot attribution preparation' }], materials:receipts.map(receipt => ({ receiptId:receipt._id, quantityPerUnit:receipt.definition.ratio, uom:receipt.uom })), idempotencyKey:randomUUID() });
    await api(`${path}/record`, { expectedVersion:2, operationIndex:0, inputQuantity:wo.quantity, goodQuantity:wo.quantity, scrapQuantity:'0', uom:'UN', evidence:'Synthetic K1 final output evidence', outputSerials:serials, idempotencyKey:randomUUID() });
    await api(`${path}/qc`, { expectedVersion:3, acceptedQuantity:wo.quantity, rejectedQuantity:'0', uom:'UN', evidence:'Synthetic K1 QC partition', acceptedSerials:serials, rejectedSerials:[], idempotencyKey:randomUUID() });
    unitsByWo.set(wo._id, await api(`${path}/output-units`));
  }
  assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ salesOrderId:order._id, status:'ACCEPTED' }), 10);
  const sourceIds = receipts.map(row => row._id);
  const stock = async () => (await db.collection('warehouseReceipts').find({ _id:{ $in:sourceIds } }).sort({ _id:1 }).toArray()).map(row => Object.fromEntries(['_id', 'quantity', 'availableQuantity', 'reservedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity', 'shippedQuantity'].map(field => [field, row[field]])));
  const consumed = () => db.collection('manufacturingMovements').find({ workOrderId:{ $in:workOrders.map(row => row._id) }, kind:'MATERIAL_CONSUMED' }).sort({ _id:1 }).toArray();
  const originalStock = await stock(), originalConsumption = await consumed();
  assert.equal(originalConsumption.length, 10);
  for (const row of originalStock) assert.equal(row.availableQuantity, '0');
  check('K1 browser native opt-in plans real 6/4 serialized WOs; actual five fixture lot/heat sources are released, consumed and QC-completed via authenticated setup');

  const prepareUnit = async (view, unit, reason) => {
    await waitForView(view);
    await form.fillIn(UNIT, 'outputUnitId', unit._id);
    await ready(`document.querySelector(${js(UNIT)})?.querySelector('[name=outputUnitId]')?.value===${js(unit._id)}`);
    for (const [index, source] of view.sources.entries()) {
      const receipt = receipts.find(row => row._id === source.receiptId);
      assert.ok(receipt); assert.equal(source.quantityPerUnit, receipt.definition.ratio.replace(/\.0+$/, '')); assert.equal(source.uom, receipt.definition.uom);
      assert.deepEqual(source.materialTrace, { receiptId:receipt._id, lotNumber:receipt.definition.lotNumber, heatNumber:receipt.definition.heatNumber });
      await form.fillIn(UNIT, `materialQuantity${index}`, receipt.definition.ratio);
    }
    await form.fillIn(UNIT, 'reason', reason);
  };
  const saveUnit = async (wo, unit, reason) => {
    const view = await api(base(wo._id)); await prepareUnit(view, unit, reason); await form.clickIn(UNIT, 'Save unit lot attribution');
    await ready(versionVisible(view.version + 1));
    return api(base(wo._id));
  };
  let replayCommand;
  for (const [woIndex, wo] of workOrders.entries()) {
    await navigate(`manufacturing/work-orders/${wo._id}`, `document.querySelector(${js(UNIT)})`);
    const units = unitsByWo.get(wo._id);
    for (const [unitIndex, unit] of units.entries()) {
      if (woIndex === 0 && unitIndex === 0) {
        const current = await api(base(wo._id)); assert.equal(current.status, 'UNRECORDED'); assert.equal(current.allocations.length, 0);
        await prepareUnit(current, unit, 'Synthetic explicit first unit source attribution');
        let committed;
        const lost = await loseResponse(`*manufacturing/work-orders/${wo._id}/genealogy/allocations`, () => form.clickIn(UNIT, 'Save unit lot attribution'), async ({ command, receipt }) => {
          assert.equal(command.materials.length, 5); assert.equal(receipt.data.version, 1);
          assert.equal(await db.collection('genealogyAllocations').countDocuments({ workOrderId:wo._id, outputUnitId:unit._id }), 5);
          assert.deepEqual(await stock(), originalStock); assert.deepEqual(await consumed(), originalConsumption); committed = await effects();
        });
        replayCommand = lost.command;
        await ready(`document.querySelector(${js(UNIT)})?.innerText.includes('Retry same genealogy command')`);
        assert.equal(await checked(`document.querySelector(${js(UNIT)}).querySelector('fieldset').disabled`), true);
        await form.clickIn(UNIT, 'Retry same genealogy command'); await waitForView(lost.receipt.data);
        assert.deepEqual(await effects(), committed);
        check('K1 native first attribution committed-response loss retains exact unit/quantities/versions/key; retry returns durable view with no duplicate allocation, revision, consumption, audit or outbox');
      } else await saveUnit(wo, unit, 'Synthetic explicit per-output five-source attribution');
    }
    let current = await api(base(wo._id));
    assert.equal(current.allocations.length, units.length * 5); assert.equal(current.incompleteUnits.length, 0); assert.ok(current.balances.every(row => row.remainingQuantity === '0'));
    for (const unit of units) {
      const rows = current.allocations.filter(row => row.outputUnitId === unit._id); assert.equal(rows.length, 5);
      for (const row of rows) { const source = receipts.find(receipt => receipt._id === row.receiptId); assert.equal(row.quantity, source.definition.ratio.replace(/\.0+$/, '')); assert.equal(row.uom, source.uom); }
    }
    await form.fillIn(LOSSES, 'reason', 'Synthetic explicit no-loss disposition after complete allocation');
    await form.clickIn(LOSSES, 'Save process losses'); await ready(versionVisible(current.version + 1));
    current = await api(base(wo._id)); assert.deepEqual(current.losses, []);
    const storedLossRevision = await api(`${base(wo._id)}/revisions/${current.currentRevision}`); assert.deepEqual(storedLossRevision.losses, []);
    if (woIndex === 0) {
      const receipt = await db.collection('warehouseReceipts').findOne({ _id:receipts[0]._id });
      const held = await api(`/warehouse/receipts/${receipt._id}/holds`, { expectedReceiptVersion:receipt.version, reasonCode:'QC_SUSPECT', reasonNote:'Synthetic late source disposition concern' }, { 'Idempotency-Key':randomUUID() });
      await click('Refresh lot genealogy');
      await ready('document.querySelector("#lot-genealogy")?.innerText.includes("Active source receipt holds block")');
      assert.match(await form.disabledReason(FINALIZE, 'Finalize lot genealogy'), /source holds/);
      await form.clickLink('#lot-genealogy', `Review or release source holds on receipt ${receipt._id}`);
      await ready(`document.querySelector('[data-testid=receipt-holds]')&&document.querySelector('[data-hold-id=${js(held.hold.id)}]')`);
      assert.equal(await checked('location.pathname'), `/portfolio/warehouse/receipts/${receipt._id}`);
      await navigate(`manufacturing/work-orders/${wo._id}`, `document.querySelector(${js(UNIT)})&&document.querySelector('#lot-genealogy')?.innerText.includes('Active source receipt holds block')`);
      assert.equal(await checked(`document.querySelector(${js(UNIT)}).querySelector('fieldset').disabled`), false);
      current = await saveUnit(wo, units[0], 'Synthetic historical attribution remains valid during later hold');
      assert.equal(current.sourceHolds.length, 1); assert.equal(current.canFinalize, false);
      await api(`/warehouse/holds/${held.hold.id}/release`, { expectedVersion:held.hold.version, reasonCode:'INSPECTION_PASSED', reasonNote:'Synthetic source disposition reviewed and cleared' }, { 'Idempotency-Key':randomUUID() });
      await click('Refresh lot genealogy');
      await ready(`document.querySelector(${js(FINALIZE)})?.querySelector('button')?.disabled===false`);
      assert.equal((await api(base(wo._id))).sourceHolds.length, 0);
      check('K1 late whole-receipt hold is visible after consumption, permits native historical allocation, disables finalization with a linked reason, and actual hold release restores readiness');
    }
    await form.fillIn(FINALIZE, 'reason', 'Synthetic exact per-unit lot evidence reconciled');
    if (woIndex === 0) {
      await checked(`document.querySelector(${js(FINALIZE)}).querySelector('[name=reason]').focus()`);
      await call('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 }); await call('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
      assert.equal(await checked('document.activeElement.textContent'), 'Finalize lot genealogy'); assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
      await call('Input.dispatchKeyEvent', { type:'char', text:'\r', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
    } else await form.clickIn(FINALIZE, 'Finalize lot genealogy');
    await ready('document.querySelector("#lot-genealogy")?.innerText.includes("Status: COMPLETE")');
    current = await api(base(wo._id)); assert.equal(current.status, 'COMPLETE'); assert.equal(current.incompleteUnits.length, 0);
    const snapshot = await api(`${base(wo._id)}/revisions/${current.currentRevision}`); assert.equal(snapshot.status, 'COMPLETE'); assert.equal(snapshot.allocations.length, units.length * 5);
    const origin = await checked('performance.timeOrigin'); await call('Page.reload'); await ready(`performance.timeOrigin!==${origin}&&document.querySelector('#lot-genealogy')?.innerText.includes('Status: COMPLETE')`);
    assert.deepEqual(await api(`${base(wo._id)}/revisions/${current.currentRevision}`), snapshot);
  }
  assert.deepEqual(await stock(), originalStock); assert.deepEqual(await consumed(), originalConsumption);
  assert.equal(await db.collection('genealogyAllocations').countDocuments({ workOrderId:{ $in:workOrders.map(row => row._id) } }), 50);
  check('K1 ten native per-unit assignments retain canonical five lot ratios 1/1/1/2/1 and UN/SET UOMs, explicit empty-loss disposition, keyboard finalization and immutable reload; original consumption/stock unchanged');

  const first = workOrders[0];
  await navigate(`manufacturing/work-orders/${first._id}`, `document.querySelector(${js(UNIT)})`);
  await inspectLayout('editable');
  check('K1 editable COMPLETE genealogy forms at four widths, unit form scrolled into screenshots, no page overflow or controls below 44px');
  await click('Inspect genealogy revision 1'); await ready('document.body.innerText.includes("Immutable genealogy revision 1")');
  await ready(`document.querySelector('[name=traceReceiptId] option[value=${js(receipts[0]._id)}]')`);
  await form.fillIn('#lot-genealogy', 'traceReceiptId', receipts[0]._id);
  const reverse = await request(`/manufacturing/genealogy/receipts/${receipts[0]._id}?limit=3`); assert.equal(reverse.data.length, 3); assert.ok(reverse.page.nextCursor);
  let cursor = reverse.page.nextCursor, reverseRows = [...reverse.data];
  while (cursor) { const page = await request(`/manufacturing/genealogy/receipts/${receipts[0]._id}?limit=3&cursor=${cursor}`); assert.equal(page.status, 200); reverseRows.push(...page.data); cursor = page.page.nextCursor; }
  assert.equal(reverseRows.length, 10); assert.equal(new Set(reverseRows.map(row => row.outputUnitId)).size, 10);
  const revisionPage = await request(`${base(first._id)}/revisions?limit=2`); assert.equal(revisionPage.data.length, 2); assert.ok(revisionPage.page.nextCursor); assert.ok(revisionPage.data.every(row => !Object.hasOwn(row, 'allocations')));
  check('K1 native immutable revision inspection and receipt selector use real reads; independent paginated reverse lookup returns all ten effective unit identities without duplicate revisions');

  const credential = await db.collection('credentials').findOne({ username:'alpha.owner' }), member = await db.collection('memberships').findOne({ userId:credential._id });
  const beforeDeniedReplay = await effects();
  try {
    await db.collection('memberships').updateOne({ _id:member._id }, { $set:{ roles:[{ role:'manufacturingRead', plantIds:member.plantIds }] } });
    await call('Page.reload'); await ready('document.querySelector("#lot-genealogy")?.innerText.includes("genealogy read permission")');
    assert.equal((await request(base(first._id))).status, 403); assert.equal(await checked(`Boolean(document.querySelector(${js(UNIT)}))`), false);
    await db.collection('memberships').updateOne({ _id:member._id }, { $set:{ roles:[{ role:'genealogyReader', plantIds:member.plantIds }] } });
    await call('Page.reload'); await ready(`document.querySelector(${js(UNIT)})?.querySelector('button')?.disabled===true`);
    assert.match(await form.disabledReason(UNIT, 'Save unit lot attribution'), /genealogy record permission/);
    assert.match(await form.disabledReason(FINALIZE, 'Finalize lot genealogy'), /genealogy finalize permission/);
    const replay = await request(`${base(first._id)}/allocations`, replayCommand); assert.equal(replay.status, 403); assert.deepEqual(await effects(), beforeDeniedReplay);
  } finally { await db.collection('memberships').updateOne({ _id:member._id }, { $set:{ roles:member.roles } }); }
  await call('Page.reload'); await ready(`document.querySelector(${js(UNIT)})?.querySelector('button')?.disabled===false`);
  check('K1 genealogyReader reload shows retained allocations with record/finalize controls disabled and explained; revoked exact replay is403 with unchanged effects; role restoration recovers controls');

  const dispatches = [
    { wo:first, units:unitsByWo.get(first._id).slice(0, 1) },
    { wo:first, units:unitsByWo.get(first._id).slice(1) },
    { wo:workOrders[1], units:unitsByWo.get(workOrders[1]._id) },
  ];
  const frozenPointers = new Map();
  for (const [index, dispatch] of dispatches.entries()) {
    const current = await api(base(dispatch.wo._id)), reference = `Synthetic K1 bounded dispatch ${index + 1}`, serials = dispatch.units.map(unit => unit.serial);
    await navigate(`fulfillment/orders/${order._id}`, 'document.querySelector("[name=sourceId]")');
    await fill('sourceId', dispatch.wo._id);
    await ready(`document.querySelector('[name=serials]')?.options.length>=${serials.length}`);
    await checked(`(()=>{const select=document.querySelector('[name=serials]');for(const option of select.options)option.selected=${js(serials)}.includes(option.value);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await form.fillIn(SHIP, 'quantity', String(serials.length)); await form.fillIn(SHIP, 'reference', reference); await form.clickIn(SHIP, 'Record shipment');
    await ready(`Array.from(document.querySelector('[name=shipmentId]')?.options||[]).some(option=>option.textContent.includes(${js(reference)}))`);
    const shipment = await db.collection('fulfillmentShipments').findOne({ salesOrderId:order._id, reference }); assert.ok(shipment);
    const pointer = shipment.sources[0].genealogy; assert.deepEqual(pointer, { workOrderId:dispatch.wo._id, revision:current.currentRevision, contentHash:(await api(`${base(dispatch.wo._id)}/revisions/${current.currentRevision}`)).contentHash });
    if (frozenPointers.has(dispatch.wo._id)) assert.deepEqual(pointer, frozenPointers.get(dispatch.wo._id)); else frozenPointers.set(dispatch.wo._id, pointer);
    const storedUnits = await db.collection('manufacturingOutputUnits').find({ _id:{ $in:dispatch.units.map(unit => unit._id) } }).toArray(); assert.equal(storedUnits.length, dispatch.units.length); for (const unit of storedUnits) { assert.equal(unit.status, 'SHIPPED'); assert.equal(unit.shipmentId, shipment._id); assert.deepEqual(unit.genealogy, pointer); }
    const move = await db.collection('warehouseMovements').findOne({ shipmentId:shipment._id, kind:'SHIP' }); assert.deepEqual(move.genealogy, pointer);
    await navigate(`fulfillment/shipments/${shipment._id}`, `document.body.innerText.includes(${js(`Frozen lot genealogy revision ${pointer.revision}`)})`); assert.ok(await checked(`document.body.innerText.includes(${js(pointer.contentHash)})`));
    await navigate(`manufacturing/work-orders/${dispatch.wo._id}`, 'document.querySelector("#lot-genealogy")?.innerText.includes("Status: FROZEN")');
    assert.equal(await checked(`Boolean(document.querySelector(${js(UNIT)}))`), false); assert.equal(await checked(`Boolean(document.querySelector(${js(LOSSES)}))`), false); assert.equal(await checked(`Boolean(document.querySelector(${js(FINALIZE)}))`), false);
    if (index === 0) {
      const frozen = await api(base(first._id)), unshipped = unitsByWo.get(first._id)[1];
      assert.equal((await db.collection('manufacturingOutputUnits').findOne({ _id:unshipped._id })).status, 'ACCEPTED');
      const correction = await request(`${base(first._id)}/allocations`, { expectedVersion:frozen.workOrderVersion, expectedGenealogyVersion:frozen.version, outputUnitId:unshipped._id, materials:[], reason:'Attempt correction to remaining unshipped unit', idempotencyKey:randomUUID() });
      assert.equal(correction.status, 409); assert.equal(correction.error.code, 'GENEALOGY_FROZEN');
    }
  }
  assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ salesOrderId:order._id, status:'SHIPPED' }), 10);
  assert.deepEqual(await stock(), originalStock); assert.deepEqual(await consumed(), originalConsumption);
  assert.equal((await api(`/fulfillment/orders/${order._id}/reconciliation`)).matches, true);
  check('K1 native authenticated 1/5/4 bounded dispatches retain immutable genealogy pointers; first partial WO shipment freezes corrections for still-unshipped units; later source shipment keeps identical pointer and no material is consumed again');

  const lossQuote = await api('/commercial/quotes', { accountId:account._id, expiresAt:'2027-01-01T00:00:00.000Z', taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:[{ description:'Synthetic supplemental zero-good loss output', quantity:'1', uom:'UN', unitPrice:'1.00', currency:'USD' }] });
  await api(`/commercial/quotes/${lossQuote._id}/approve`, { expectedVersion:1, revision:1 }); await api(`/commercial/quotes/${lossQuote._id}/accept`, { expectedVersion:2, revision:1 });
  const lossOrder = await api(`/commercial/quotes/${lossQuote._id}/convert`, { expectedVersion:3, revision:1, idempotencyKey:randomUUID() });
  const lossRequest = await api('/procurement/requests', { vendorId:vendor._id, taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:[{ description:'Synthetic supplemental process-loss material', quantity:'1', uom:'UN', unitPrice:'1.00', currency:'USD' }] });
  await api(`/procurement/requests/${lossRequest._id}/approve`, { expectedVersion:1 }); const lossPo = await api(`/procurement/requests/${lossRequest._id}/convert`, { expectedVersion:2, idempotencyKey:randomUUID() }); await api(`/procurement/orders/${lossPo._id}/issue`, { expectedVersion:1 });
  const lossReceipt = await api('/warehouse/receipts', { purchaseOrderId:lossPo._id, vendorId:vendor._id, expectedVersion:2, lineIndex:0, quantity:'1', uom:'UN', lotNumber:'SYNTHETIC-K1-LOSS-LOT', heatNumber:'SYNTHETIC-K1-LOSS-HEAT', idempotencyKey:randomUUID() });
  await api(`/warehouse/receipts/${lossReceipt._id}/release`, { expectedVersion:1, reason:'Synthetic supplemental source inspection', idempotencyKey:randomUUID() }); await api(`/warehouse/receipts/${lossReceipt._id}/putaway`, { expectedVersion:2, location:'SYNTHETIC-K1-LOSS', idempotencyKey:randomUUID() });
  const lossWo = (await api('/manufacturing/work-orders', { salesOrderId:lossOrder._id, expectedVersion:1, lineIndex:0, quantities:['1'], uom:'UN', serialized:true, genealogyRequired:true, idempotencyKey:randomUUID() })).workOrders[0];
  const lossWoPath = `/manufacturing/work-orders/${lossWo._id}`;
  await api(`${lossWoPath}/release`, { expectedVersion:1, operations:[{ code:'SYNTHETIC-LOSS', instruction:'Synthetic zero-good operation with explicit process scrap' }], materials:[{ receiptId:lossReceipt._id, quantityPerUnit:'1', uom:'UN' }], idempotencyKey:randomUUID() });
  await api(`${lossWoPath}/record`, { expectedVersion:2, operationIndex:0, inputQuantity:'1', goodQuantity:'0', scrapQuantity:'1', uom:'UN', evidence:'Synthetic total process loss', outputSerials:[], idempotencyKey:randomUUID() });
  await api(`${lossWoPath}/qc`, { expectedVersion:3, acceptedQuantity:'0', rejectedQuantity:'0', uom:'UN', evidence:'Synthetic zero output QC decision', acceptedSerials:[], rejectedSerials:[], idempotencyKey:randomUUID() });
  const lossStockBefore = await db.collection('warehouseReceipts').findOne({ _id:lossReceipt._id }), lossConsumptionBefore = await db.collection('manufacturingMovements').find({ workOrderId:lossWo._id, kind:'MATERIAL_CONSUMED' }).toArray();
  await navigate(`manufacturing/work-orders/${lossWo._id}`, `document.querySelector(${js(LOSSES)})`);
  for (const [index, quantity] of ['1.000000', '', '1.000000'].entries()) {
    const view = await api(base(lossWo._id)); await ready(versionVisible(view.version));
    await form.fillIn(LOSSES, 'lossQuantity0', quantity); await form.fillIn(LOSSES, 'lossReason0', quantity ? 'Synthetic consumed material became process scrap' : ''); await form.fillIn(LOSSES, 'reason', index === 1 ? 'Synthetic correction clears the previous loss disposition' : 'Synthetic explicit zero-good material disposition');
    await form.clickIn(LOSSES, 'Save process losses'); await ready(versionVisible(view.version + 1));
    const stored = await api(base(lossWo._id)); assert.equal(stored.units.length, 0); assert.equal(stored.allocations.length, 0); assert.equal(stored.losses.length, quantity ? 1 : 0); assert.equal(stored.balances[0].remainingQuantity, quantity ? '0' : '1');
  }
  await form.fillIn(FINALIZE, 'reason', 'Synthetic explicit process-loss budget reconciled'); await form.clickIn(FINALIZE, 'Finalize lot genealogy'); await ready('document.querySelector("#lot-genealogy")?.innerText.includes("Status: COMPLETE")');
  assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ workOrderId:lossWo._id }), 0);
  assert.deepEqual(await db.collection('manufacturingMovements').find({ workOrderId:lossWo._id, kind:'MATERIAL_CONSUMED' }).toArray(), lossConsumptionBefore);
  assert.equal((await db.collection('warehouseReceipts').findOne({ _id:lossReceipt._id })).manufacturingConsumedQuantity, lossStockBefore.manufacturingConsumedQuantity);
  const originalLossRevision = await api(`${base(lossWo._id)}/revisions/1`); assert.equal(originalLossRevision.losses[0].quantity, '1');
  assert.equal((await api(`${base(lossWo._id)}/revisions/2`)).losses.length, 0);
  check('K1 supplemental zero-good browser native positive process loss, explicit clear and reassignment reconcile consumed budget without invented units or repeated consumption; immutable prior loss revision retained');

  await navigate(`manufacturing/work-orders/${first._id}`, 'document.querySelector("#lot-genealogy")?.innerText.includes("Status: FROZEN")');
  await inspectLayout('frozen');
  check('K1 actual frozen genealogy section scrolled into view at four widths, screenshots saved, no page overflow or controls below 44px; this bounded lot proof does not claim serialized component installation or full E01');
}
