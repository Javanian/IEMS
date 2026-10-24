import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCustomerServicePort } from '../../wa-demo-bridge/src/customer-service-port.mjs';
import { SIMULATED_CHANNEL_ACCOUNT } from '../../../packages/customer-service/index.mjs';

async function customerPort({db,runtime,headers}) {
  const cs = runtime.customerServicePreview, order = await db.collection('salesOrders').findOne({});
  assert.ok(order.orderNumber, 'API must publish stable owned orderNumber before CS integration');
  const existing=await db.collection('cs_contact_bindings').findOne({customerId:order.accountId});
  const credential = await db.collection('credentials').findOne({ username: 'alpha.owner' });
  const member = await db.collection('memberships').findOne({ userId: credential._id });
  const token = headers.cookie.slice('portfolio_session='.length);
  await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [...member.roles, { role: 'csFixtureAdmin', plantIds: member.plantIds, tenantWide: false }] } });
  const scope = await runtime.foundation.authenticate(token), bindingId = randomUUID(), channel = SIMULATED_CHANNEL_ACCOUNT, contact = 'synthetic-browser-contact';
  try {
    if (!existing) await cs.provisionFixtureCustomer(scope, { plantId: order.plantId, customerId: order.accountId, label: 'Synthetic browser customer' });
    if (!existing) await cs.bindContact(scope, { plantId: order.plantId, bindingId, customerId: order.accountId, channelAccountId: channel, providerContactId: contact });
  } finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  const transaction = async fn => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => fn(session)); } finally { await session.endSession(); } };
  const port = await createCustomerServicePort({ customerService: cs, db: runtime.db, scope: { tenant: order.tenantId, account: channel }, transaction, active: async () => true, isPaused: async () => false, now: () => new Date() });
  return {port,order};
}
export async function orderInquiry({db,runtime,headers,expected}) {
 const {port,order}=await customerPort({db,runtime,headers});
 const r=await port.handle('synthetic-browser-contact',randomUUID(),`IEMS ORDER ${order.orderNumber}`);
 assert.equal(r.error,undefined);const p=await port.dispatch();assert.equal(p.state,'PREVIEWED');assert.ok(p.text.includes(expected),p.text);
}

export async function serviceJourney({ db, runtime, call, wait, click, fill, evaluate, screenshot, check, headers }) {
  const {port,order}=await customerPort({db,runtime,headers});
  async function exchange(text, expected) {
    const result = await port.handle('synthetic-browser-contact', randomUUID(), text);
    assert.equal(result.error, undefined, JSON.stringify(result));
    const previews = [];
    for (let i = 0; i < 30; i++) { const p = await port.dispatch(); if (!p) break; assert.equal(p.state, 'PREVIEWED'); assert.equal(p.providerMessageId, null); previews.push(p); }
    assert.ok(previews.some(p => p.text?.includes(expected)), `Missing preview ${expected}: ${JSON.stringify(previews)}`);
    return result;
  }
  await exchange(`IEMS ORDER ${order.orderNumber}`, 'PARTIALLY_SHIPPED');
  assert.equal(await db.collection('cs_orders').countDocuments({}), 0, 'No synthetic order snapshot rewriting');
  await exchange('IEMS COMPLAINT', 'Select an order');
  await exchange(`IEMS COMPLAINT ORDER ${order.orderNumber}`, 'Select category');
  await exchange('IEMS COMPLAINT CATEGORY DELIVERY_DELAY', 'Describe the issue');
  await exchange('IEMS COMPLAINT DESCRIBE Synthetic customer asks about remaining shipment', 'Review:');
  const result = await exchange('IEMS COMPLAINT CONFIRM', 'ticket');
  const ticket = result.receipt;
  assert.ok(ticket?.ticketId, JSON.stringify(result));
  assert.equal(await db.collection('cs_tickets').countDocuments({ _id: ticket.ticketId }), 1);
  await exchange(`IEMS TICKET ${ticket.ticketNumber}`, 'NEW');
  await click('Customer service'); await wait(`document.body.innerText.includes('${ticket.ticketNumber}')`); await click(ticket.ticketNumber);
  await wait(`document.querySelector('[name=internalText]')`);
  await fill('internalText', 'Synthetic staff-only warehouse review'); await click('Add internal note');
  await wait(`document.body.innerText.includes('Synthetic staff-only warehouse review')`);
  assert.equal(await db.collection('cs_internal_notes').countDocuments({ ticketId: ticket.ticketId }), 1);
  await fill('publicText', 'Synthetic customer-visible shipment review'); await click('Add public update');
  await wait(`document.body.innerText.includes('Synthetic customer-visible shipment review')`);
  for (const stage of ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED']) {
    await fill('toStage', stage); await fill('reason', stage === 'RESOLVED' ? 'Synthetic shipment schedule confirmed' : 'Synthetic agent review'); await click('Update stage');
    await wait(`document.querySelector('.pf-summary')?.innerText.includes('${stage === 'ASSIGNED' ? 'Assigned' : stage === 'IN_PROGRESS' ? 'In progress' : 'Resolved'}')`);
    assert.equal((await db.collection('cs_tickets').findOne({ _id: ticket.ticketId })).stage, stage);
    if (stage === 'IN_PROGRESS') {
      await screenshot('wave2d-ticket-desktop');
      await click('Customer service'); await click('Conversations'); await wait(`document.body.innerText.includes('Synthetic browser customer')`); await click('Synthetic browser customer');
      await wait(`document.body.innerText.includes('Customer thread')`);
      assert.equal(await evaluate(`document.body.innerText.includes('Synthetic staff-only warehouse review')`), false);
      await click('Take over conversation'); await wait(`document.querySelector('[name=replyText]')`);
      await fill('replyText', 'Synthetic agent confirms remaining shipment review'); await click('Reply to customer');
      await wait(`document.body.innerText.includes('Synthetic agent confirms remaining shipment review')`);
      const preview = await port.dispatch(); assert.equal(preview.state, 'PREVIEWED'); assert.match(preview.text, /Synthetic agent/);
      await click('Refresh conversation'); await wait(`document.body.innerText.includes('Preview only (not sent)')`);
      await call('Page.reload'); await wait(`document.querySelector('[name=replyText]')`);
      await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
      await screenshot('wave2d-thread-mobile');
      await wait(`!document.body.innerText.includes('Loading current records') && document.querySelector('[name=replyText]')`);
      const cred=await db.collection('credentials').findOne({username:'alpha.owner'}), membership=await db.collection('memberships').findOne({userId:cred._id});
      await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[]}});
      await click('Refresh conversation'); await wait(`document.body.innerText.includes('Access denied')`);
      await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:membership.roles}});
      await call('Page.reload'); await wait(`document.querySelector('[name=replyText]')`);
      await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await click('Refresh conversation'); await wait(`document.body.innerText.includes('Retry to load')`);
      await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await call('Page.reload'); await wait(`document.querySelector('[name=replyText]')`);
      await fill('replyText','Synthetic uncertain reply'); await click('Reply to customer');
      await wait(`document.body.innerText.includes('Synthetic uncertain reply')`);
      const unknown=await port.dispatch('ambiguous');assert.equal(unknown.state,'UNKNOWN');
      await click('Refresh conversation');await wait(`document.body.innerText.includes('Unknown (delivery unconfirmed)')`);
      await fill('evidence','Synthetic ambiguous provider; no live send');await click('Resolve delivery');
      await wait(`!document.querySelector('[name=evidence]')`);
      assert.equal((await db.collection('cs_outbox').findOne({_id:unknown.deliveryId})).state,'CANCELLED');
      for(let n=0;n<12;n++) await port.handle('synthetic-browser-contact',randomUUID(),'IEMS MENU');
      await click('Refresh conversation');await wait(`document.body.innerText.includes('More messages')`);
      await click('More messages');await wait(`document.querySelector('a') && document.body.innerText.includes('Newest page')`);
      assert.ok(await evaluate(`new URLSearchParams(location.search).has('cursor')`));
      assert.equal(await evaluate(`document.body.innerText.includes('Synthetic staff-only warehouse review')`),false);
      await call('Page.reload');await wait(`document.body.innerText.includes('Newest page')`);
      await click('Newest page');await wait(`!new URLSearchParams(location.search).has('cursor')`);

      await fill('reason', 'Synthetic operator finished'); await click('Resume bot'); await wait(`document.body.innerText.includes('Bot active')`);
      await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await click('Open active ticket'); await wait(`document.querySelector('[name=toStage]')`);
    }
  }
  const resolvedPreview = await port.dispatch(); assert.equal(resolvedPreview.state, 'PREVIEWED'); assert.match(resolvedPreview.text, /resolved/);
  await call('Page.reload'); await wait(`document.querySelector('.pf-summary')?.innerText.includes('Resolved')`);
  check('CS real role denial, offline recovery, UNKNOWN review, thread cursor page and deep-link reload, mobile 375px');
  check('CS real owned order inquiry and durable preview prompts -> committed ticket -> staff/public notes -> takeover, agent reply, resume and resolved preview; independent Mongo and reload');
}
