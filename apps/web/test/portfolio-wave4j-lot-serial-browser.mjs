import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { scoped } from './wave4f-browser-kit.mjs';

export async function lotSerialJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse }) {
  const api = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method: body ? 'POST' : 'GET', headers, ...(body && { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`);
    return result.data;
  };
  const navigate = async (path, predicate) => {
    await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` });
    await wait(predicate);
  };
  const form = scoped({ evaluate, wait });
  const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic Wave4j finished unit', quantity: '10', uom: 'EA', unitPrice: '10.00', currency: 'USD' }] };
  const account = await api('/crm/accounts', { name: 'Synthetic Wave4j lot/serial customer' });
  const quote = await api('/commercial/quotes', { ...content, accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z' });
  await api(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await api(`/commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const order = await api(`/commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: randomUUID() });
  const vendor = await api('/procurement/vendors', { name: 'Synthetic Wave4j material vendor' });
  const pr = await api('/procurement/requests', { ...content, vendorId: vendor._id, lines: [{ ...content.lines[0], description: 'Synthetic Wave4j lot material' }] });
  await api(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await api(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() });
  await api(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });

  await navigate(`warehouse/receive/${po._id}`, 'document.querySelector("[name=lotNumber]")');
  for (const [name, value] of Object.entries({ quantity: '10', uom: 'EA', lotNumber: 'SYNTH-LOT-4J', heatNumber: 'SYNTH-HEAT-4J' })) await fill(name, value);
  await click('Receive into quarantine');
  await wait('document.body.innerText.includes("Status: Awaiting inspection")&&document.querySelector("[name=reason]")');
  const receiptId = await evaluate('location.pathname.split("/").at(-1)');
  let receipt = await db.collection('warehouseReceipts').findOne({ _id: receiptId });
  assert.equal(receipt.lotNumber, 'SYNTH-LOT-4J'); assert.equal(receipt.heatNumber, 'SYNTH-HEAT-4J');
  await fill('reason', 'Synthetic material inspection'); await click('Record QC release');
  await wait('document.body.innerText.includes("Status: Quality released")&&document.querySelector("[name=location]")');
  await fill('location', 'SYNTH-4J-RACK'); await click('Put away');
  await wait('document.body.innerText.includes("Status: Stored")');
  assert.ok(await evaluate('document.body.innerText.includes("SYNTH-LOT-4J")&&document.body.innerText.includes("SYNTH-HEAT-4J")'));
  check('wave4j native traced receipt, QC and putaway preserve immutable lot/heat in actual Mongo');

  await navigate(`manufacturing/plan/${order._id}`, 'document.querySelector("[name=serialized]")');
  await fill('quantities', '6\n4'); await fill('serialized', 'true'); await click('Plan work orders');
  await wait('document.body.innerText.includes("Planned 2 work orders")');
  const workOrders = await db.collection('manufacturingWorkOrders').find({ salesOrderId: order._id }).toArray();
  assert.deepEqual(workOrders.map(w => w.quantity).sort(), ['4', '6']); assert.ok(workOrders.every(w => w.serialized === true));
  const trace = { receiptId, lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber };
  const serialsByWorkOrder = new Map();
  for (const [index, workOrder] of workOrders.entries()) {
    await navigate(`manufacturing/work-orders/${workOrder._id}`, 'document.querySelector("[name=receiptId0]")');
    await wait(`document.querySelector('[name=receiptId0] option[value="${receiptId}"]')`);
    for (const [name, value] of Object.entries({ code0: 'SYNTH-ASSEMBLE', instruction0: 'Synthetic operator assembly record', receiptId0: receiptId, quantityPerUnit0: '1' })) await form.fillIn('form[aria-label="Release work order"]', name, value);
    await click('Release work order');
    await wait('document.body.innerText.includes("Status: Ready to start")&&document.querySelector("[name=outputSerials]")');
    const serials = Array.from({ length: Number(workOrder.quantity) }, (_, i) => `SYNTH-4J-${index + 1}-${i + 1}`);
    serialsByWorkOrder.set(workOrder._id, serials);
    for (const [name, value] of Object.entries({ goodQuantity: workOrder.quantity, scrapQuantity: '0', evidence: 'Synthetic final operation', outputSerials: serials.join('\n') })) await form.fillIn('form[aria-label="Record operation"]', name, value);
    await click('Record operation');
    await wait('document.body.innerText.includes("Status: Awaiting inspection")&&document.querySelector("[name=acceptedSerials]")');
    const quarantined = await db.collection('manufacturingWorkOrders').findOne({ _id: workOrder._id });
    assert.deepEqual(quarantined.output.serials, serials); assert.deepEqual(quarantined.output.materialTrace, [trace]);
    assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ workOrderId: workOrder._id, status: 'QUARANTINED' }), serials.length);
    for (const [name, value] of Object.entries({ acceptedQuantity: workOrder.quantity, rejectedQuantity: '0', evidence: 'Synthetic identity QC', acceptedSerials: serials.join('\n'), rejectedSerials: '' })) await form.fillIn('form[aria-label="Record QC"]', name, value);
    await click('Record QC');
    await wait('document.body.innerText.includes("Status: Quality complete")&&!document.querySelector("[name=acceptedSerials]")');
    const ready = await db.collection('manufacturingWorkOrders').findOne({ _id: workOrder._id });
    assert.deepEqual(ready.qc.acceptedSerials, serials); assert.deepEqual(ready.routing.materials[0].materialTrace, trace);
    const origin = await evaluate('performance.timeOrigin'); await call('Page.reload');
    await wait(`performance.timeOrigin!==${origin}&&document.body.innerText.includes("${serials[0]}")`);
  }
  assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ salesOrderId: order._id, status: 'ACCEPTED' }), 10);
  const units = await db.collection('manufacturingOutputUnits').find({ salesOrderId: order._id }).toArray();
  assert.equal(new Set(units.map(unit => unit.serial)).size, 10);
  receipt = await db.collection('warehouseReceipts').findOne({ _id: receiptId });
  assert.equal(receipt.availableQuantity, '0'); assert.equal(receipt.manufacturingReservedQuantity, '0'); assert.equal(receipt.manufacturingConsumedQuantity, '10');
  const materialMoves = await db.collection('manufacturingMovements').find({ workOrderId: { $in: workOrders.map(w => w._id) }, kind: { $in: ['MATERIAL_RESERVED', 'MATERIAL_CONSUMED'] } }).toArray();
  assert.equal(materialMoves.length, 4); assert.ok(materialMoves.every(move => JSON.stringify(move.materialTrace) === JSON.stringify(trace)));
  check('wave4j native 6/4 serialized work orders, ten unique quarantined-to-accepted units, traced material consumption and hard reload');

  for (const [index, workOrder] of workOrders.entries()) {
    const serials = serialsByWorkOrder.get(workOrder._id), reference = `Synthetic Wave4j dispatch ${index + 1}`;
    await navigate(`fulfillment/orders/${order._id}`, 'document.querySelector("[name=sourceId]")');
    await wait(`document.querySelector('[name=sourceId] option[value="${workOrder._id}"]')`);
    await fill('sourceId', workOrder._id);
    await wait(`document.querySelector('[name=serials] option[value="${serials[0]}"]')`);
    await evaluate(`(()=>{const select=document.querySelector('[name=serials]');for(const option of select.options)option.selected=${JSON.stringify(serials)}.includes(option.value);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await form.fillIn('form[aria-label="Record shipment"]', 'quantity', workOrder.quantity);
    await form.fillIn('form[aria-label="Record shipment"]', 'reference', reference);
    if (index === 0) {
      const effects = () => Promise.all(['fulfillmentShipments', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox', 'warehouseMovements', 'manufacturingOutputUnits'].map(name => db.collection(name).find({}).sort({ _id: 1 }).toArray()));
      let committed;
      const loss = await loseResponse('*/api/fulfillment/shipments', () => click('Record shipment'), async ({ command }) => {
        assert.deepEqual(command.sources[0].serials, serials);
        assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ workOrderId: workOrder._id, status: 'SHIPPED' }), serials.length);
        committed = await effects();
      });
      await wait(`document.querySelector('[aria-label="Record shipment"]').innerText.includes('Retry same request')`);
      assert.equal(await evaluate(`document.querySelector('[aria-label="Record shipment"] fieldset').disabled`), true);
      await form.clickIn('form[aria-label="Record shipment"]', 'Retry same request');
      await wait(`document.querySelector('[aria-label="Record shipment"] fieldset')?.disabled===false`);
      assert.ok(loss.command.idempotencyKey); assert.deepEqual(await effects(), committed);
      check('wave4j real committed shipment response loss freezes selected serials and identical retry creates no duplicate effects');
    } else await click('Record shipment');
    await wait(`document.querySelector('[name=shipmentId] option')&&[...document.querySelectorAll('[name=shipmentId] option')].some(option=>option.textContent.includes(${JSON.stringify(reference)}))`);
    const shipment = await db.collection('fulfillmentShipments').findOne({ reference, salesOrderId: order._id });
    assert.deepEqual(shipment.sources[0].serials, serials); assert.deepEqual(shipment.sources[0].materialTrace, [trace]);
    assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ workOrderId: workOrder._id, status: 'SHIPPED', shipmentId: shipment._id }), serials.length);
    const move = await db.collection('warehouseMovements').findOne({ shipmentId: shipment._id, kind: 'SHIP' });
    assert.deepEqual(move.serials, serials); assert.deepEqual(move.materialTrace, [trace]);
    await navigate(`fulfillment/shipments/${shipment._id}`, `document.body.innerText.includes("${serials[0]}")`);
    assert.ok(await evaluate('document.body.innerText.includes("SYNTH-LOT-4J")'));
  }
  assert.equal(await db.collection('manufacturingOutputUnits').countDocuments({ salesOrderId: order._id, status: 'SHIPPED' }), 10);
  assert.equal((await api(`/fulfillment/orders/${order._id}/reconciliation`)).matches, true);
  check('wave4j selected unit identities ship once in 6/4 partial shipments, with stock movement trace and exact reconciliation');

  await navigate(`manufacturing/work-orders/${workOrders[0]._id}`, `document.body.innerText.includes("${serialsByWorkOrder.get(workOrders[0]._id)[0]}")`);
  for (const width of [1440, 768, 375, 360]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
    const small = await evaluate('[...document.querySelectorAll(".portfolio-root a,.portfolio-root button,.portfolio-root input,.portfolio-root select,.portfolio-root textarea")].filter(x=>x.getBoundingClientRect().height&&getComputedStyle(x).position!=="absolute"&&x.getBoundingClientRect().height<43.9).map(x=>x.textContent)');
    assert.deepEqual(small, []);
    if ([1440, 375].includes(width)) await screenshot(`wave4j-serial-units-${width}`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  check('wave4j real serial/trace detail at four viewport widths, zero overflow and no controls below 44px');
}
