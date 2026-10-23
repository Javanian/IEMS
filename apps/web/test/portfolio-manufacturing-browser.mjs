import assert from 'node:assert/strict';
// Mounted manufacturing journey: actual SO line and STORED receipt left by the commercial and warehouse journeys.
export async function manufacturingJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers }) {
  const api = (path, body) => fetch(`http://127.0.0.1:4313/api/${path}`, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
  const tab = async () => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); };
  const so = await db.collection('salesOrders').findOne({}), receiptBefore = await db.collection('warehouseReceipts').findOne({ status: 'STORED' });
  assert.equal(receiptBefore.availableQuantity, '1.5'); assert.equal(so.snapshot.lines[0].quantity, '2.500');
  await click('Manufacturing'); await wait(`document.querySelector('h1')?.textContent==='Manufacturing work orders'`);
  await wait(`document.body.innerText.includes('No work orders in this plant yet')`);
  await click('Plan from sales order'); await wait(`document.body.innerText.includes('${so._id}')`);
  await click(so._id); await wait(`document.querySelector('[name=quantities]')`);
  await fill('lineIndex', '0'); await fill('quantities', '0.75\n0.5'); await click('Plan work orders');
  await wait(`document.body.innerText.includes('Planned 2 work orders')`);
  const workOrders = await db.collection('manufacturingWorkOrders').find({ salesOrderId: so._id }).toArray();
  assert.deepEqual(workOrders.map(w => w.quantity).sort(), ['0.5', '0.75']);
  assert.ok(workOrders.every(w => w.status === 'PLANNED' && w.uom === 'EA' && w.lineIndex === 0 && w.accountId === so.accountId && w.salesOrderVersion === so.version && w.splitId === workOrders[0].splitId && w.executionMode === 'OPERATOR_RECORDED'));
  assert.equal((await db.collection('manufacturingAllocated').findOne({ salesOrderId: so._id })).quantity, '1.25');
  const first = workOrders.find(w => w.quantity === '0.75'), second = workOrders.find(w => w.quantity === '0.5');
  // Over-capacity split: 1.25 planned + 1.5 exceeds the 2.500 EA line; the server must reject without effects.
  await fill('quantities', '1.5'); await click('Plan work orders'); await wait(`document.body.innerText.includes('exceed the sales order line')`);
  assert.equal(await db.collection('manufacturingWorkOrders').countDocuments({}), 2);
  await click('Discard command and refresh'); await wait(`document.body.innerText.includes('${first._id}')`);
  await click(first._id); await wait(`document.body.innerText.includes('Release with routing and materials')`); await wait(`document.querySelector('[name=receiptId0] option')`);
  await fill('code0', 'MIX'); await fill('instruction0', 'Operator records mixing'); await click('Add operation'); await wait(`document.querySelector('[name=code1]')`);
  await fill('code1', 'PACK'); await fill('instruction1', 'Operator records packing'); await fill('receiptId0', receiptBefore._id); await fill('quantityPerUnit0', '2');
  await click('Release work order'); await wait(`document.body.innerText.includes('Status: RELEASED')`);
  let receipt = await db.collection('warehouseReceipts').findOne({ _id: receiptBefore._id });
  assert.equal(receipt.availableQuantity, '0'); assert.equal(receipt.manufacturingReservedQuantity, '1.5'); assert.equal(receipt.version, receiptBefore.version + 1);
  check('manufacturing split WOs from real SO line, over-capacity 409 without effects, release freezes routing and reserves 1.5 EA from STORED receipt (independent Mongo)');
  // Second API writer records operation 1 while the browser still holds version 2.
  const competing = await api(`manufacturing/work-orders/${first._id}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '0.75', goodQuantity: '0.7', scrapQuantity: '0.05', uom: 'EA', evidence: 'Synthetic second operator MIX entry', idempotencyKey: crypto.randomUUID() });
  assert.equal(competing.status, 200);
  await fill('goodQuantity', '0.75'); await fill('scrapQuantity', '0'); await fill('evidence', 'Synthetic stale browser entry'); await click('Record operation');
  await wait(`document.body.innerText.includes('Refresh the record')`);
  let wo = await db.collection('manufacturingWorkOrders').findOne({ _id: first._id });
  assert.equal(wo.records.length, 1); assert.equal(wo.version, 3); assert.equal(await db.collection('manufacturingMovements').countDocuments({ kind: 'MATERIAL_CONSUMED' }), 1);
  await screenshot('18-manufacturing-record-conflict');
  await click('Refresh and retry'); await wait(`document.body.innerText.includes('Record operation 2 of 2: PACK')&&document.body.innerText.includes('Input: 0.7 EA')`);
  await fill('goodQuantity', '0.650'); await fill('scrapQuantity', '0.05'); await fill('evidence', 'Synthetic browser PACK entry'); await click('Record operation');
  await wait(`document.body.innerText.includes('Status: QUARANTINED')&&document.body.innerText.includes('Final output: 0.65 EA')`);
  // Role grant limited to read: QC must be forbidden by the server while reads still work.
  const credential = await db.collection('credentials').findOne({ username: 'alpha.owner' }), membership = await db.collection('memberships').findOne({ userId: credential._id });
  await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [{ role: 'manufacturingRead', plantIds: membership.plantIds }] } });
  await fill('acceptedQuantity', '0.6'); await fill('rejectedQuantity', '0.05'); await fill('evidence', 'Synthetic forbidden QC attempt'); await click('Record QC');
  await wait(`document.body.innerText.includes('Access denied')`);
  assert.equal((await db.collection('manufacturingWorkOrders').findOne({ _id: first._id })).status, 'QUARANTINED');
  await screenshot('19-manufacturing-qc-forbidden');
  await click('Discard command and refresh'); await wait(`document.body.innerText.includes('Record QC decision')`);
  await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } });
  for (const width of [360, 375, 768, 1024, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false, `overflow ${width}`);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.portfolio-root button,.portfolio-root input,.portfolio-root select,.portfolio-root textarea,.portfolio-root a')].filter(x=>x.getBoundingClientRect().height&&getComputedStyle(x).position!=='absolute'&&x.getBoundingClientRect().height<43.9).map(x=>x.textContent)`), [], `small ${width}`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: true });
  await fill('acceptedQuantity', '0.6'); await fill('rejectedQuantity', '0.05'); await fill('evidence', 'Synthetic inspector sample record');
  await evaluate(`document.querySelector('[name=evidence]').focus()`); await tab();
  assert.equal(await evaluate('document.activeElement.textContent'), 'Record QC');
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
  await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`document.body.innerText.includes('Status: QC_COMPLETED')`);
  await call('Page.reload'); await wait(`document.body.innerText.includes('Accepted: 0.6 EA')&&document.body.innerText.includes('Synthetic browser PACK entry')`);
  await screenshot('20-manufacturing-qc-mobile');
  wo = await db.collection('manufacturingWorkOrders').findOne({ _id: first._id });
  assert.equal(wo.status, 'QC_COMPLETED'); assert.equal(wo.version, 5);
  assert.deepEqual(wo.routing.operations.map(o => o.code), ['MIX', 'PACK']);
  assert.deepEqual(wo.routing.materials, [{ receiptId: receiptBefore._id, quantityPerUnit: '2', quantity: '1.5', uom: 'EA' }]);
  assert.deepEqual(wo.records.map(r => [r.operationIndex, r.inputQuantity, r.goodQuantity, r.scrapQuantity, r.recordedBy]), [[0, '0.75', '0.7', '0.05', credential._id], [1, '0.7', '0.65', '0.05', credential._id]]);
  assert.equal(wo.totalScrapQuantity, '0.1'); assert.deepEqual([wo.output.quantity, wo.output.status], ['0.65', 'QC_COMPLETED']);
  assert.deepEqual([wo.qc.acceptedQuantity, wo.qc.rejectedQuantity, wo.qc.evidence, wo.qc.recordedBy], ['0.6', '0.05', 'Synthetic inspector sample record', credential._id]);
  receipt = await db.collection('warehouseReceipts').findOne({ _id: receiptBefore._id });
  assert.deepEqual([receipt.availableQuantity, receipt.manufacturingReservedQuantity, receipt.manufacturingConsumedQuantity, receipt.reservedQuantity, receipt.version], ['0', '0', '1.5', '0.5', receiptBefore.version + 2]);
  // Release the second split against the now-empty receipt: insufficient stock must leave balances untouched.
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click('Work orders'); await wait(`document.body.innerText.includes('${second._id}')`); await click(second._id);
  await wait(`document.querySelector('[name=receiptId0] option')`);
  await fill('code0', 'MIX'); await fill('instruction0', 'Operator records mixing'); await fill('receiptId0', receiptBefore._id); await fill('quantityPerUnit0', '1');
  await click('Release work order'); await wait(`document.body.innerText.includes('lacks available quantity')`);
  assert.equal((await db.collection('manufacturingWorkOrders').findOne({ _id: second._id })).status, 'PLANNED');
  assert.equal((await db.collection('warehouseReceipts').findOne({ _id: receiptBefore._id })).version, receiptBefore.version + 2);
  const movements = await db.collection('manufacturingMovements').find({}).toArray();
  assert.deepEqual(movements.map(m => m.kind).sort(), ['MATERIAL_CONSUMED', 'MATERIAL_RESERVED', 'OPERATION_RECORDED', 'OPERATION_RECORDED', 'QC_RECORDED']);
  const audits = await db.collection('manufacturingAudit').find({}).toArray(), outbox = await db.collection('manufacturingOutbox').find({}).toArray();
  assert.deepEqual(audits.map(a => a.kind).sort(), ['workOrder.qc', 'workOrder.record', 'workOrder.record', 'workOrder.release', 'workOrders.planned']);
  assert.equal(outbox.length, 5); assert.ok(outbox.every(o => o.state === 'PENDING' && o.executionMode === 'OPERATOR_RECORDED'));
  assert.equal(await db.collection('manufacturingKeys').countDocuments({}), 5);
  assert.equal((await db.collection('salesOrders').findOne({ _id: so._id })).version, so.version);
  await click('Discard command and refresh'); await wait(`document.body.innerText.includes('Release with routing and materials')`);
  await click('Work orders'); await click(first._id); await click('Open source sales order'); await wait(`document.body.innerText.includes('250.03')`);
  await click('Manufacturing'); await click(first._id); await click(receiptBefore._id); await wait(`document.querySelector('h1')?.textContent==='Warehouse receipt'&&document.body.innerText.includes('Trace_01')`);
  check('manufacturing ordered operator records with genuine second-writer 409, read-only role QC 403, mobile Tab/Enter QC, insufficient-stock 409, five viewports, persisted deep links');
  check('manufacturing independent Mongo: exact WO/record/QC strings, receipt reserved->consumed 1.5 exactly once, 5 movements/audit/PENDING outbox/keys, SO untouched');
}
