import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseExpression } from '@babel/parser';
import { scoped } from './wave4f-browser-kit.mjs';

const js = JSON.stringify, selector = title => `form[aria-label="${title}"]`;
const CREATE = selector('Create tracked inventory item'), APPROVE_ITEM = selector('Approve inventory item revision');
const REQUEST = selector('Create catalog purchase request'), REVISE = selector('Save catalog purchase request revision');
const APPROVE = selector('Approve catalog purchase request'), CONVERT = selector('Convert catalog request to purchase order');
const ISSUE = selector('Issue catalog purchase order'), RECEIVE = selector('Receive catalog PO line into quarantine');

export async function catalogJourney({ db, call, wait, click, evaluate, screenshot, check, headers, loseResponse }) {
  const checked = expression => { parseExpression(expression); return evaluate(expression); };
  const ready = expression => { parseExpression(expression); return wait(expression); };
  const form = scoped({ evaluate: checked, wait: ready });
  const send = async (path, body, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method: body ? 'POST' : 'GET', headers: { ...headers, ...extra }, ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, ...await response.json() };
  };
  const api = async (path, body, extra) => { const response = await send(path, body, extra); assert.ok([200, 201].includes(response.status), `${path}: ${JSON.stringify(response)}`); return response.data; };
  const navigate = async (path, condition) => { await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` }); await ready(condition); };
  const itemReady = version => `document.querySelector('#inventory-item')?.getAttribute('data-item-version')===${js(String(version))}`;
  const requestReady = version => `document.querySelector('#catalog-request')?.getAttribute('data-request-version')===${js(String(version))}`;
  const orderReady = version => `document.querySelector('#catalog-order')?.getAttribute('data-order-version')===${js(String(version))}`;
  const forbiddenNames = ['salesOrders', 'manufacturingWorkOrders', 'manufacturingOutputUnits', 'manufacturingMovements', 'warehouseReservations', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'serialCustodyUnits', 'serialCustodyClaims', 'componentInstallationLinks'];
  const snapshot = names => Promise.all(names.map(name => db.collection(name).find().sort({ _id: 1 }).toArray()));
  const beforeForbidden = await snapshot(forbiddenNames);
  const effects = async () => {
    const names = (await db.listCollections().toArray()).map(row => row.name).filter(name => /^(catalog|warehouse|inventory)/.test(name)).sort();
    return snapshot(names);
  };
  const layout = async (root, label, widths = [1440, 360]) => {
    for (const width of widths) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 }); await ready(`innerWidth===${width}`);
      await checked(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector(${js(root)}).scrollIntoView({block:'start',behavior:'instant'})})()`);
      assert.equal(await checked('document.documentElement.scrollWidth>innerWidth'), false);
      assert.deepEqual(await checked(`[...document.querySelectorAll(${js(`${root} a,${root} button,${root} input,${root} select,${root} textarea,${root} summary`)})].filter(element=>element.getBoundingClientRect().height&&getComputedStyle(element).position!=='absolute'&&element.getBoundingClientRect().height<43.9).map(element=>element.textContent)`), []);
      await screenshot(`wave4map-${label}-${width}`);
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  };
  const vendor = await api('/procurement/vendors', { name: 'Synthetic MAP native receiving supplier' });
  const items = [];
  for (const [policy, uom] of [['LOT', 'KG'], ['SERIAL', 'UN']]) {
    const code = `SYNTH-MAP-${policy}`;
    await navigate('inventory-master/items', `document.querySelector(${js(CREATE)})`);
    for (const [name, value] of Object.entries({ code, description: `Synthetic explicit ${policy} purchased specification`, kind: 'PURCHASED', uom, trackingPolicy: policy, reason: 'Synthetic explicit tracking policy revision' })) await form.fillIn(CREATE, name, value);
    await form.clickIn(CREATE, 'Create tracked inventory item'); await ready('document.querySelector("#inventory-item")');
    const row = (await api('/inventory-master/items?limit=100')).find(item => item.code === code); assert.ok(row);
    let item = await api(`/inventory-master/items/${row._id}`); assert.equal(item.status, 'DRAFT'); assert.equal(item.content.schema, 'INVENTORY_ITEM_V2'); assert.equal(item.content.trackingPolicy, policy);
    await form.fillIn(APPROVE_ITEM, 'reason', 'Synthetic approval of exact explicit tracking revision'); await form.clickIn(APPROVE_ITEM, 'Approve inventory item revision'); await ready(itemReady(item.version + 1));
    item = await api(`/inventory-master/items/${row._id}`); assert.equal(item.status, 'APPROVED'); items.push(item);
  }
  check('MAP native explicit LOT/SERIAL V2 item revisions and exact approvals create source identity without inferring old master policy');

  const orders = [];
  for (const item of items) {
    const quantity = item.content.trackingPolicy === 'LOT' ? '2.5' : '2';
    await navigate('catalog-procurement/requests', `document.querySelector(${js(REQUEST)})`);
    await ready(`document.querySelector(${js(REQUEST)})?.querySelector('[name=itemId0]')?.querySelector('option[value="${item._id}"]')`);
    for (const [name, value] of Object.entries({ vendorId: vendor._id, itemId0: item._id, quantity0: quantity, unitPrice0: '10.00', currency0: 'USD', reason: 'Synthetic actual typed procurement demand' })) await form.fillIn(REQUEST, name, value);
    if (item.content.trackingPolicy === 'LOT') await layout(REQUEST, 'request-form');
    await form.clickIn(REQUEST, 'Create catalog purchase request'); await ready('document.querySelector("#catalog-request")');
    let request = (await api('/catalog-procurement/requests?limit=100')).find(row => row.content.lines[0].itemId === item._id); assert.ok(request);
    const old = await api(`/catalog-procurement/requests/${request._id}/revisions/1`), lineId = request.content.lines[0].lineId;
    if (item.content.trackingPolicy === 'LOT') {
      await form.fillIn(REVISE, 'reason', 'Synthetic explicit procurement content revision'); await form.clickIn(REVISE, 'Save catalog purchase request revision'); await ready(requestReady(request.version + 1));
      request = await api(`/catalog-procurement/requests/${request._id}`); assert.equal(request.currentRevision, 2); assert.equal(request.content.lines[0].lineId, lineId); assert.deepEqual(await api(`/catalog-procurement/requests/${request._id}/revisions/1`), old);
    }
    await form.fillIn(APPROVE, 'reason', 'Synthetic exact procurement revision approval');
    if (item.content.trackingPolicy === 'LOT') {
      await checked(`document.querySelector(${js(APPROVE)}).querySelector('[name=reason]').focus()`);
      await call('Input.dispatchKeyEvent', { type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9 }); await call('Input.dispatchKeyEvent', { type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9 });
      assert.equal(await checked('document.activeElement.textContent'), 'Approve catalog purchase request'); assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
      await call('Input.dispatchKeyEvent', { type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13 });
    } else await form.clickIn(APPROVE, 'Approve catalog purchase request');
    await ready(requestReady(request.version + 1)); request = await api(`/catalog-procurement/requests/${request._id}`); assert.equal(request.status, 'APPROVED');
    await form.fillIn(CONVERT, 'reason', 'Synthetic real typed purchase order conversion'); await form.clickIn(CONVERT, 'Convert catalog request to purchase order'); await ready('document.querySelector("#catalog-order")');
    let order = (await api('/catalog-procurement/orders?limit=100')).find(row => row.requestId === request._id); assert.ok(order); assert.equal(order.content.lines[0].lineId, lineId); assert.equal(order.status, 'DRAFT');
    await form.fillIn(ISSUE, 'reason', 'Synthetic explicit issue of frozen typed PO'); await form.clickIn(ISSUE, 'Issue catalog purchase order'); await ready(orderReady(order.version + 1)); order = await api(`/catalog-procurement/orders/${order._id}`); assert.equal(order.status, 'ISSUED'); orders.push(order);
  }
  check('MAP native request revision preserves stable line identity and immutable history through approval, real typed PO conversion and issue');

  const receipts = [];
  for (const order of orders) {
    const line = order.content.lines[0], serial = line.trackingPolicy === 'SERIAL', amount = serial ? '1' : '1.25';
    await navigate(`catalog-procurement/orders/${order._id}`, orderReady(order.version));
    for (const [name, value] of Object.entries({ lineId: line.lineId, quantity: amount, lotNumber: `SYNTH-MAP-${line.trackingPolicy}-LOT`, heatNumber: `SYNTH-MAP-${line.trackingPolicy}-HEAT`, ...(serial ? { serials: 'SYNTH_MAP_ACTUAL_001' } : {}), reason: 'Synthetic operator recorded actual receiving evidence' })) await form.fillIn(RECEIVE, name, value);
    if (!serial) await layout(RECEIVE, 'receive-form');
    let committed;
    if (!serial) {
      await loseResponse('*catalog-procurement/receipts', () => form.clickIn(RECEIVE, 'Receive catalog PO line into quarantine'), async ({ command, receipt }) => {
        assert.equal(command.lineId, line.lineId); assert.equal(command.quantity, amount); assert.equal(receipt.data.status, 'QUARANTINED'); committed = await effects();
      });
      await ready('document.body.innerText.includes("Retry same catalog command")');
      assert.equal(await checked(`[...document.querySelectorAll('#catalog-order form input,#catalog-order form select,#catalog-order form textarea')].every(control=>control.disabled||control.closest('fieldset:disabled'))`), true);
      await click('Retry same catalog command');
    } else await form.clickIn(RECEIVE, 'Receive catalog PO line into quarantine');
    await ready('document.querySelector("#catalog-receipt")'); if (committed) assert.deepEqual(await effects(), committed);
    const receipt = (await api('/catalog-procurement/receipts?limit=100')).find(row => row.purchaseOrderId === order._id); assert.ok(receipt); receipts.push(receipt);
    assert.equal(receipt.availableQuantity, '0'); assert.equal(receipt.reservedQuantity, '0'); assert.equal(receipt.usable, false); assert.equal(receipt.catalogSource.itemId, line.itemId); assert.equal(receipt.catalogSource.itemRevision, line.itemRevision); assert.equal(receipt.catalogSource.purchaseOrderLineId, line.lineId); assert.equal(receipt.catalogSource.trackingPolicy, line.trackingPolicy);
    const fresh = await api(`/catalog-procurement/orders/${order._id}`); assert.equal(fresh.receiving[0].receivedQuantity, amount); assert.equal(fresh.receiving[0].remainingQuantity, amount); assert.equal(fresh.receiving[0].receiptCount, 1);
    assert.equal(await db.collection('warehouseMovements').countDocuments({ receiptId: receipt._id, kind: 'RECEIVE' }), 1); assert.equal(await db.collection('warehouseReceiptOrigins').countDocuments({ receiptId: receipt._id }), 1);
  }
  check('MAP native fractional LOT and actual SERIAL partial receipts bind exact approved item/line revision into quarantine; lost receipt response retries once without duplicate movement, origin or entitlement');

  const receipt = receipts[0];
  let cursor = '';
  for (;;) {
    const response = await send(`/warehouse/receipts?limit=25${cursor ? `&cursor=${cursor}` : ''}`); assert.equal(response.status, 200);
    if (response.data.some(row => row._id === receipt._id)) break;
    assert.ok(response.page.nextCursor, 'Actual typed receipt remains discoverable in scoped warehouse pages'); cursor = response.page.nextCursor;
  }
  const target = `/portfolio/catalog-procurement/receipts/${receipt._id}`;
  await navigate(`warehouse/receipts${cursor ? `?cursor=${cursor}` : ''}`, `document.querySelector('a[href="${target}"]')`);
  await click(receipt._id); await ready('document.querySelector("#catalog-receipt")');
  await navigate(`warehouse/receipts/${receipt._id}`, 'document.querySelector("h1")?.textContent==="Warehouse receipt"&&document.querySelector("[data-warehouse-record-version]")?.innerText.includes("Status: Awaiting inspection")');
  assert.deepEqual(await checked(`[...document.querySelectorAll('button,h2')].filter(element=>['Record QC release','Put away','Reserve for sales order','Adopt incoming serial custody','Transfer whole receipt','Record absolute count'].includes(element.textContent.trim())).map(element=>element.textContent)`), []);
  const beforeDenied = await effects(), denied = await send(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: receipt.version, reason: 'Synthetic denied legacy release', idempotencyKey: randomUUID() }); assert.equal(denied.error.code, 'CATALOG_RECEIPT_UNSUPPORTED'); assert.deepEqual(await effects(), beforeDenied);
  check('MAP warehouse list opens the typed receipt namespace; direct legacy receipt URL and API cannot release typed quarantine into usable stock');

  await navigate(`catalog-procurement/receipts/${receipt._id}`, 'document.querySelector("#catalog-receipt")');
  await layout('#catalog-receipt', 'quarantine', [1440, 768, 375, 360]);
  const item = items[0], immutable = await api(`/catalog-procurement/orders/${orders[0]._id}/revisions/1`);
  await api(`/inventory-master/items/${item._id}/revisions`, { expectedVersion: item.version, reason: 'Synthetic source revision changed after issue', idempotencyKey: randomUUID(), description: 'Synthetic changed LOT specification', uom: 'KG', kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' });
  await navigate(`catalog-procurement/orders/${orders[0]._id}`, orderReady(orders[0].version));
  const blocked = await api(`/catalog-procurement/orders/${orders[0]._id}`); assert.ok(blocked.blockers.includes('ITEM_CHANGED') || blocked.blockers.includes('ITEM_NOT_APPROVED')); assert.deepEqual(await api(`/catalog-procurement/orders/${orders[0]._id}/revisions/1`), immutable);
  assert.equal(await checked(`document.querySelector(${js(RECEIVE)})?.querySelector('button[type=submit],button.pf-primary')?.disabled`), true);
  assert.equal((await api(`/catalog-procurement/receipts/${receipt._id}`)).catalogSource.itemRevision, 1);
  assert.deepEqual(await snapshot(forbiddenNames), beforeForbidden);
  check('MAP historical receipt/PO identity survives current master revision drift; native fresh receiving blocks without customer, manufacturing, stock reservation or financial effects');
}
