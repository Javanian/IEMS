import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function paginationJourney({ db, runtime, headers, call, wait, click, fill, evaluate, screenshot, check }) {
  const order = await db.collection('salesOrders').findOne({});
  const wo = await db.collection('manufacturingWorkOrders').findOne({ status: 'QC_COMPLETED' });
  async function post(path, body) {
    const response = await fetch('http://127.0.0.1:4313/api/' + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify({ path, status: response.status, value }));
    return value.data;
  }
  const quote = await post('commercial/quotes', { accountId: order.accountId, expiresAt: '2027-10-22T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic source pagination capacity', quantity: '1', uom: wo.uom, unitPrice: '1.00', currency: 'USD' }] });
  await post(`commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await post(`commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const sourceOrder = await post(`commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: randomUUID() });
  await post('manufacturing/work-orders', { salesOrderId: sourceOrder._id, expectedVersion: sourceOrder.version, lineIndex: 0, uom: wo.uom, quantities: Array(100).fill('0.001'), idempotencyKey: randomUUID() });
  assert.ok(await db.collection('manufacturingWorkOrders').countDocuments({}) > 100);
  const shipments = [], invoices = [], payments = [];
  for (let i = 0; i < 101; i++) {
    const shipment = await post('fulfillment/shipments', { salesOrderId: order._id, expectedVersion: order.version, lineIndex: 0, uom: wo.uom, reference: `Synthetic traversal ${i}`, sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: i < 26 ? '0.01' : '0.000001' }], idempotencyKey: randomUUID() });
    shipments.push(shipment);
    if (i < 26) {
      const invoice = await post('fulfillment/invoices', { salesOrderId: order._id, expectedVersion: order.version, lines: [{ shipmentId: shipment._id, quantity: '0.01' }], idempotencyKey: randomUUID() });
      invoices.push(invoice);
      payments.push(await post('fulfillment/payments', { accountId: order.accountId, amount: invoice.total, currency: invoice.currency, reference: `Synthetic traversal payment ${i}`, allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: invoice.total }], idempotencyKey: randomUUID() }));
    }
  }
  assert.equal(await db.collection('fulfillmentShipments').countDocuments({ salesOrderId: order._id }), 103);
  await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/fulfillment/orders/${order._id}` });
  await wait(`document.querySelectorAll('[name=shipmentId] option').length===104`);
  const last = shipments.toSorted((a,b) => a._id.localeCompare(b._id)).at(-1);
  await fill('shipmentId', last._id);
  assert.equal(await evaluate(`document.querySelector('[name=shipmentId]').value`), last._id);
  await call('Page.reload');
  await wait(`document.querySelectorAll('[name=shipmentId] option').length===104`);
  check('103 real API shipments: source selector crosses 100, selects final sorted record and survives refresh');

  const token = headers.cookie.slice('portfolio_session='.length), cs = runtime.customerService;
  const binding = await db.collection('cs_contact_bindings').findOne({ customerId: order.accountId });
  const principal = await cs.resolveCustomerPrincipal({ tenantId: order.tenantId, channelAccountId: binding.channelAccountId, providerContactId: binding.providerContactId });
  for (let i = 0; i < 26; i++) {
    let draft = await cs.startComplaintDraft(principal, { requestKey: randomUUID() });
    for (const action of [{ type: 'GENERAL_INQUIRY' }, { type: 'SELECT_CATEGORY', category: 'OTHER' }, { type: 'DESCRIBE', text: `Synthetic traversal complaint ${i}` }]) draft = await cs.updateComplaintDraft(principal, { draftId: draft.draftId, expectedVersion: draft.version, action });
    await cs.confirmComplaint(principal, { draftId: draft.draftId, expectedVersion: draft.version, inboundKey: randomUUID() });
  }
  assert.ok(await runtime.foundation.authenticate(token));
  for (const [path, collection, idKey] of [['fulfillment/invoices', 'fulfillmentInvoices', '_id'], ['fulfillment/payments', 'fulfillmentPayments', '_id'], ['service/tickets', 'cs_tickets', 'ticketId']]) {
    const expected = await db.collection(collection).countDocuments({ tenantId: order.tenantId, plantId: order.plantId });
    assert.ok(expected > 25);
    await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` });
    await wait(`location.pathname==='/portfolio/${path}' && document.querySelectorAll('.pf-rows > li').length===25 && [...document.querySelectorAll('a')].some(a=>a.textContent==='Next page')`);
    const seen = new Set();
    for (;;) {
      for (const href of await evaluate(`[...document.querySelectorAll('.pf-rows li > a')].map(a=>a.getAttribute('href'))`)) { assert.ok(!seen.has(href)); seen.add(href); }
      const nextPage = await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Next page')?.getAttribute('href')`);
      console.log('Traversal', path, seen.size, expected, nextPage);
      if (!nextPage) break;
      const previous = await evaluate('location.search');
      await click('Next page'); await wait(`location.search!==${JSON.stringify(previous)} && document.querySelectorAll('.pf-rows > li').length===${Math.min(25, expected - seen.size)}`);
      const origin=await evaluate('performance.timeOrigin');
      await call('Page.reload'); await wait(`performance.timeOrigin!==${origin}&&document.querySelectorAll('.pf-rows > li').length===${Math.min(25, expected - seen.size)}`);
    }
    assert.equal(seen.size, expected, `${path} exact Mongo count`);
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await click(path.startsWith('service') ? 'Refresh inbox' : 'Refresh list'); await wait(`document.body.innerText.includes('The current records could not be loaded')`);
    await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await click('Refresh and retry'); await wait(`document.querySelector('.pf-rows')`);
    const credential = await db.collection('credentials').findOne({ username: 'alpha.owner' }), membership = await db.collection('memberships').findOne({ userId: credential._id });
    await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } });
    await click(path.startsWith('service') ? 'Refresh inbox' : 'Refresh list'); await wait(`document.body.innerText.includes('Access denied')`);
    await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: membership.roles } });
    await click('Refresh and retry'); await wait(`document.querySelector('.pf-rows')`);
    check(`${path}: ${expected} records traversed once, cursor hard reload, offline retry, actual role denial/recovery`);
  }
  for (const [name, path, ready] of [['invoice', `fulfillment/invoices/${invoices[0]._id}`, '.pf-dl'], ['ticket', `service/tickets/${(await db.collection('cs_tickets').findOne({}))._id}`, '[name=publicText]']]) {
    await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` });
    await wait(`document.readyState==='complete' && document.querySelector('${ready}')`);
    await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: true });
    await wait(`location.pathname==='/portfolio/${path}' && document.querySelector('${ready}') && !document.body.innerText.includes('Loading current records')`);
    await call('Page.setBypassCSP', { enabled: true });
    const resized = await evaluate(`(()=>{const nodes=[document.querySelector('.portfolio-root'),...document.querySelectorAll('.portfolio-root *')];const sizes=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));nodes.forEach((n,i)=>n.style.setProperty('font-size',sizes[i]*2+'px','important'));return {before:sizes[0],inline:nodes[0].getAttribute('style'),after:parseFloat(getComputedStyle(nodes[0]).fontSize)}})()`);
    await wait(`parseFloat(getComputedStyle(document.querySelector('.portfolio-root')).fontSize)===${resized.before * 2}`);
    console.log('Text resize', name, { ...resized, after: await evaluate(`parseFloat(getComputedStyle(document.querySelector('.portfolio-root')).fontSize)`) });
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
    assert.equal(await evaluate(`(()=>{const h=document.querySelector('h1');return parseFloat(getComputedStyle(h).lineHeight)>=parseFloat(getComputedStyle(h).fontSize)*1.19})()`), true);
    await screenshot(`final-b-${name}-text200-mobile`);
    await evaluate(`document.querySelectorAll('.portfolio-root,.portfolio-root *').forEach(n=>n.style.removeProperty('font-size'));document.documentElement.style.fontSize=''`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  check('200% root text resize at 375px: invoice and ticket real records, zero page overflow, actual screenshots');
}
