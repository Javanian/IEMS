import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { api, poster, key, scoped, openContext } from './wave4f-browser-kit.mjs';
import { metricsView } from '../src/features/portfolio/customer-service.mjs';

// Wave 4f named scenarios: synthetic binding onboarding, manufacture/repair status through the simulator,
// complaint to ticket, rendered previews in the thread, takeover/reply/resume/resolve, metrics and revocation.
// The simulator is the product path for inbound messages in this wave; no live WhatsApp. Fixtures: one contact
// and one repair case created through the API for setup only.
const CREATE = 'form[aria-labelledby="create-binding-heading"]';
const SIM = 'section[aria-labelledby="simulator-heading"] form';
const REVOKE = 'form[aria-labelledby="revoke-binding-heading"]';

export async function csOnboardingJourney(ctx) {
  const { db, call, wait, evaluate, screenshot, check, headers, web } = ctx;
  const request = api(headers), post = poster(request);
  const { fillIn, clickIn, clickLink, disabledReason } = scoped({ evaluate, wait });
  const owner = await db.collection('credentials').findOne({ username: 'alpha.owner' });
  const account = await db.collection('accounts').findOne({ name: 'Synthetic browser account' });
  const contact = await db.collection('contacts').findOne({ accountId: account._id, email: 'synthetic-browser@example.invalid' });
  assert.ok(contact, 'reuse the contact already created through Chrome; preserve baseline contact-count assertion');
  const so = await db.collection('salesOrders').findOne({ accountId: account._id, orderNumber: { $type: 'string' } }, { sort: { createdAt: 1 } });
  assert.ok(so, 'manufacture order with public number');
  const repair = await post('repair/cases', { accountId: account._id, serial: 'W4F-CS-UNIT-01', condition: 'Synthetic unit for CS status inquiry', currency: 'USD', idempotencyKey: key() });
  assert.match(repair.caseNumber, /^RP-/);
  const bindings = () => db.collection('cs_contact_bindings').countDocuments({});
  const inbound = () => db.collection('cs_inbound').countDocuments({});

  // ---- W4F-C1: trusted operator onboarding of a synthetic contact ----
  await call('Page.navigate', { url: `${web}/portfolio/service/bindings` });
  await wait(`document.querySelector('${CREATE} select[name=accountId] option[value="${account._id}"]')`, 'binding form ready');
  await fillIn(CREATE, 'accountId', account._id); await fillIn(CREATE, 'contactId', contact._id);
  await fillIn(CREATE, 'address', '+628123456789');
  const before = await bindings();
  await clickIn(CREATE, 'Create binding');
  await wait(`document.querySelector('${CREATE}').innerText.includes('Use a synthetic address')`, 'non-synthetic address refused in UI');
  const realNumber = await request('cs/bindings', { accountId: account._id, contactId: contact._id, channel: 'SIMULATED', address: '+628123456789' }, { 'idempotency-key': key() });
  assert.equal(realNumber.status, 422); assert.equal(realNumber.error.code, 'SYNTHETIC_ADDRESS_REQUIRED');
  assert.equal(await bindings(), before, 'no binding from a real-looking number');
  await fillIn(CREATE, 'address', '+62000555101');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickIn(CREATE, 'Create binding');
  await wait(`[...document.querySelectorAll('${CREATE} button')].some(b=>b.textContent==='Retry same request'&&!b.disabled)`, 'offline binding offers retry');
  assert.equal(await bindings(), before, 'offline binding creates no row');
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickIn(CREATE, 'Retry same request');
  await wait(`location.pathname.startsWith('/portfolio/service/bindings/') && document.querySelector('h1')?.textContent.includes('+62000555101') && document.querySelector('${SIM} [name=simulatorText]')`, 'binding detail');
  const bindingId = await evaluate(`location.pathname.split('/').at(-1)`);
  const binding = await db.collection('cs_contact_bindings').findOne({ _id: bindingId });
  assert.equal(binding.status, 'ACTIVE'); assert.equal(binding.channel, 'SIMULATED'); assert.equal(binding.address, '+62000555101'); assert.equal(binding.contactId, contact._id);
  assert.equal(binding.accountId ?? binding.customerId, account._id); assert.equal(await bindings(), before + 1);
  check('W4F-C1 CS onboarding: Chrome binds synthetic +62000 contact to a real account/contact; real number refused in UI and by server 422 without effect; independent Mongo binding ACTIVE');

  // ---- W4F-C2: manufacture and repair status through the simulator, rendered preview with provenance ----
  const exchanges = () => evaluate(`document.querySelectorAll('.pf-exchange').length`);
  async function send(text) {
    const n = await exchanges();
    await fillIn(SIM, 'simulatorText', text); await clickIn(SIM, 'Send simulated message');
    await wait(`document.querySelectorAll('.pf-exchange').length===${n + 1}`, `simulator reply for ${text}`);
    return evaluate(`(()=>{const x=document.querySelector('.pf-exchange');return {text:x.innerText,body:x.querySelector('.pf-preview-body')?.textContent??null,state:x.querySelector('[data-delivery-state]')?.dataset.deliveryState??null,kind:x.querySelector('[data-order-kind]')?.dataset.orderKind??null,source:x.querySelector('.pf-provenance a')?.getAttribute('href')??null}})()`);
  }
  const inboundBefore = await inbound();
  const made = await send(`IEMS ORDER ${so.orderNumber}`);
  assert.equal(made.state, 'PREVIEWED'); assert.ok(made.body && made.body.includes(so.orderNumber), JSON.stringify(made));
  assert.equal(made.kind, 'MANUFACTURE'); assert.equal(made.source, null, 'opaque source hash is provenance, not a product record URL');
  assert.match(made.text, /Template /); assert.match(made.text, /Nothing was sent to the customer/);
  const conversationId = await evaluate(`document.querySelector('.pf-exchange a[href*="/service/conversations/"]').getAttribute('href').split('/').at(-1)`);
  const sourceHash = createHash('sha256').update(`${so.tenantId}:${so.plantId}:${so._id}`).digest('hex');
  const madeRow = await db.collection('cs_outbox').findOne({ conversationId, 'payload.source.id': sourceHash });
  assert.equal(madeRow.state, 'PREVIEWED'); assert.equal(madeRow.providerMessageId ?? null, null);
  const fixed = await send(`IEMS ORDER ${repair.caseNumber}`);
  assert.equal(fixed.state, 'PREVIEWED'); assert.equal(fixed.kind, 'REPAIR'); assert.equal(fixed.source, null, 'repair source hash is not a record URL');
  assert.ok(fixed.body.includes(repair.caseNumber));
  const thread = await request(`cs/conversations/${conversationId}/thread?limit=100`);
  const apiBodies = thread.data.filter(m => m.direction === 'OUTBOUND').map(m => m.body);
  assert.ok(apiBodies.includes(made.body) && apiBodies.includes(fixed.body), 'UI shows the API-rendered body verbatim');
  assert.equal(await inbound(), inboundBefore + 2);
  await screenshot('wave4f-cs-simulator-status');
  check('W4F-C2 CS status: simulator inbound through the product resolves owned manufacture SO and repair case, rendered preview body with template/source links, PREVIEWED in Mongo with no provider id');

  // ---- W4F-C3: complaint to committed ticket through the simulator ----
  const ticketsBeforeComplaint = await db.collection('cs_tickets').countDocuments({});
  for (const step of ['IEMS COMPLAINT', `IEMS COMPLAINT ORDER ${so.orderNumber}`, 'IEMS COMPLAINT CATEGORY QUALITY', 'IEMS COMPLAINT DESCRIBE W4F coating flaking on delivered unit']) await send(step);
  const confirmed = await send('IEMS COMPLAINT CONFIRM');
  await wait(`[...document.querySelectorAll('.pf-exchange a')].some(a=>a.textContent.startsWith('Open ticket'))`, 'ticket link');
  const ticket = await db.collection('cs_tickets').findOne({ category: 'QUALITY', description: 'W4F coating flaking on delivered unit' });
  assert.ok(ticket, JSON.stringify(confirmed)); assert.equal(ticket.stage, 'NEW'); assert.ok(confirmed.text.includes(ticket.ticketNumber));
  assert.equal(await db.collection('cs_tickets').countDocuments({}), ticketsBeforeComplaint + 1, 'exactly one complaint ticket');
  check('W4F-C3 CS complaint: five simulator steps commit one QUALITY ticket for the bound customer; ticket link rendered from the API response');

  // ---- W4F-C4: thread previews, takeover, reply, preview dispatch, resume and resolution ----
  await clickLink('.pf-exchange', 'Open conversation');
  await wait(`document.querySelector('.pf-thread .pf-preview-body') && document.body.innerText.includes('Take over conversation')`, 'conversation thread');
  const states = await evaluate(`[...document.querySelectorAll('.pf-thread [data-delivery-state]')].map(x=>x.dataset.deliveryState)`);
  assert.ok(states.length >= 7 && states.every(s => s === 'PREVIEWED'), JSON.stringify(states));
  const labels = await evaluate(`[...document.querySelectorAll('.pf-thread .pf-out > strong')].map(x=>x.textContent)`);
  assert.ok(labels.every(l => l.endsWith('Preview only (not sent)')), JSON.stringify(labels));
  const forbiddenDeliveryLabel = new RegExp('\\b(Delivered|Read)\\b');
  assert.equal(forbiddenDeliveryLabel.test('Delivered'), true, 'negative assertion detects forbidden labels');
  assert.equal(forbiddenDeliveryLabel.test(await evaluate(`document.querySelector('.pf-thread').innerText`)), false);
  await clickIn('.pf-main', 'Take over conversation');
  await wait(`document.querySelector('[name=replyText]:not(:disabled)')`, 'reply form after takeover');
  await fillIn('form:has([name=replyText])', 'replyText', 'W4F agent: we are reviewing the coating with quality.');
  await clickIn('form:has([name=replyText])', 'Reply to customer');
  await wait(`document.body.innerText.includes('W4F agent: we are reviewing the coating') && document.body.innerText.includes('Preview queued replies')`, 'queued agent reply');
  const queued = await db.collection('cs_outbox').findOne({ conversationId, origin: 'OPERATOR', 'payload.text': 'W4F agent: we are reviewing the coating with quality.' });
  assert.equal(queued.state, 'QUEUED');
  for (let page = 0; page < 10; page++) {
    const remaining = await db.collection('cs_outbox').countDocuments({ tenantId: queued.tenantId, state: 'QUEUED' });
    await clickIn('.pf-main', 'Preview queued replies');
    await wait(`!document.querySelector('form:has(button:disabled)') && !document.body.innerText.includes('Saving...')`, 'preview dispatch completed');
    await clickIn('.pf-main', 'Refresh conversation');
    await wait(`document.querySelector('.pf-thread')`, 'thread refreshed after dispatch');
    if ((await db.collection('cs_outbox').findOne({ _id: queued._id })).state === 'PREVIEWED') break;
    assert.ok(await db.collection('cs_outbox').countDocuments({ tenantId: queued.tenantId, state: 'QUEUED' }) < remaining, 'bounded dispatcher must make durable progress');
  }
  await wait(`[...document.querySelectorAll('.pf-thread .pf-out')].some(x=>x.innerText.includes('W4F agent')&&x.dataset.deliveryState==='PREVIEWED')`, 'agent reply previewed');
  assert.equal((await db.collection('cs_outbox').findOne({ _id: queued._id })).state, 'PREVIEWED');
  await fillIn('form:has([name=reason])', 'reason', 'W4F agent handed back'); await clickIn('form:has([name=reason])', 'Resume bot');
  await wait(`document.querySelector('.pf-summary')?.innerText.includes('Bot active')`, 'bot resumed');
  await call('Page.navigate', { url: `${web}/portfolio/service/tickets/${ticket._id}` });
  for (const stage of ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED']) {
    await wait(`[...document.querySelectorAll('[name=toStage] option')].some(o=>o.value==='${stage}') && document.querySelector('form:has([name=toStage]) button.pf-primary:not(:disabled)')`, `stage ${stage} available`);
    await fillIn('form:has([name=toStage])', 'toStage', stage); await fillIn('form:has([name=toStage])', 'reason', stage === 'RESOLVED' ? 'W4F coating replaced under warranty' : 'W4F agent review');
    await clickIn('form:has([name=toStage])', 'Update stage');
    await wait(`(()=>{const t=document.querySelector('.pf-summary')?.innerText||'';return t.includes(${JSON.stringify(stage === 'ASSIGNED' ? 'Assigned' : stage === 'IN_PROGRESS' ? 'In progress' : 'Resolved')})})()`, `ticket ${stage}`);
    assert.equal((await db.collection('cs_tickets').findOne({ _id: ticket._id })).stage, stage);
  }
  check('W4F-C4 CS thread: every bot reply rendered PREVIEWED (never Sent/Delivered/Read); Chrome takeover, agent reply QUEUED then PREVIEWED via preview dispatcher, resume bot, ticket resolved; independent Mongo states');

  // ---- W4F-C5: metrics from the API with denominators and explicit no-data ----
  await call('Page.navigate', { url: `${web}/portfolio/service/tickets` });
  await wait(`document.querySelector('[data-testid=cs-metrics] .pf-metrics') && document.querySelector('.pf-rows')`, 'metrics ready');
  const shown = await evaluate(`(()=>{const s=document.querySelector('[data-testid=cs-metrics]');return {from:s.dataset.windowFrom,to:s.dataset.windowTo,cells:[...s.querySelectorAll('[data-metric]')].map(x=>({key:x.dataset.metric,value:x.querySelector('strong').textContent,detail:x.querySelector('span').textContent}))}})()`);
  const metrics = await request(`cs/metrics?from=${encodeURIComponent(shown.from)}&to=${encodeURIComponent(shown.to)}`);
  assert.equal(metrics.status, 200, JSON.stringify(metrics));
  assert.deepEqual(shown.cells, metricsView(metrics.data).map(({ key, value, detail }) => ({ key, value, detail })), 'UI shows exactly the API metrics');
  assert.ok(metrics.data.resolution?.n >= 1, 'resolved ticket counted'); assert.ok(metrics.data.firstHumanResponse?.n >= 1, 'agent reply counted as human response');
  const openTickets = await db.collection('cs_tickets').countDocuments({ tenantId: ticket.tenantId, plantId: ticket.plantId, stage: { $nin: ['RESOLVED', 'CLOSED'] } });
  assert.equal(metrics.data.open, openTickets, 'open count matches independent Mongo');
  await screenshot('wave4f-cs-metrics');
  const beta = await openContext(ctx, 'beta.owner', '/portfolio/service/tickets');
  try {
    await beta.wait(`document.querySelector('[data-testid=cs-metrics] .pf-metrics')`, 'beta metrics');
    const empty = await beta.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-metric]')].map(x=>[x.dataset.metric,x.querySelector('strong').textContent]))`);
    assert.deepEqual(empty, { open: '0', unassigned: '0', overdue: '0', firstHumanResponse: 'No data', resolution: 'No data' });
  } finally { await beta.close(); }
  check('W4F-C5 CS metrics: Chrome panel equals the API values for the same window (open matches independent Mongo, resolution and first human response n>=1); other tenant shows explicit No data, never invented numbers');

  // ---- W4F-C6: permission-aware onboarding and revocation at query/dispatch time ----
  const viewer = await openContext(ctx, 'alpha.viewer', '/portfolio/service/bindings');
  try {
    assert.equal(await viewer.disabledReason(CREATE, 'Create binding'), 'You need binding management permission');
    const count = await bindings();
    const denied = await request('cs/bindings', { accountId: account._id, contactId: contact._id, channel: 'SIMULATED', address: '+62000555199' }, { cookie: viewer.cookie, 'idempotency-key': key() });
    assert.equal(denied.status, 403); assert.equal(await bindings(), count);
  } finally { await viewer.close(); }
  await call('Page.navigate', { url: `${web}/portfolio/service/conversations/${conversationId}` });
  await wait(`document.body.innerText.includes('Take over conversation')`, 'conversation ready before revoke');
  await clickIn('.pf-main', 'Take over conversation');
  await wait(`document.querySelector('[name=replyText]:not(:disabled)')`, 'reply ready before revoke');
  const withheldText = 'W4F queued reply must never dispatch after contact revocation';
  await fillIn('form:has([name=replyText])', 'replyText', withheldText);
  await clickIn('form:has([name=replyText])', 'Reply to customer');
  await wait(`document.body.innerText.includes(${JSON.stringify('W4F queued reply must never dispatch')}) && document.body.innerText.includes('Preview queued replies')`, 'queued reply before revoke');
  const withheld = await db.collection('cs_outbox').findOne({ conversationId, origin: 'OPERATOR', 'payload.text': withheldText });
  assert.equal(withheld.state, 'QUEUED');
  await call('Page.navigate', { url: `${web}/portfolio/service/bindings/${bindingId}` });
  await wait(`document.querySelector('${REVOKE} [name=revokeReason]')`, 'revoke form');
  await fillIn(REVOKE, 'revokeReason', 'W4F contact left the customer'); await clickIn(REVOKE, 'Revoke binding');
  await wait(`document.querySelector('[data-binding-status=REVOKED]')`, 'binding revoked');
  assert.equal(await disabledReason(SIM, 'Send simulated message'), 'Binding revoked. Inbound messages are refused.');
  const revoked = await db.collection('cs_contact_bindings').findOne({ _id: bindingId });
  assert.equal(revoked.status, 'REVOKED'); assert.equal(revoked.revokedBy?.userId ?? revoked.revokedBy, owner._id);
  assert.equal((await db.collection('cs_outbox').findOne({ _id: withheld._id })).state, 'CANCELLED', 'revocation cancels the real queued human reply');
  const dispatchAfterRevoke = await request('cs/simulator/dispatch', {});
  assert.equal(dispatchAfterRevoke.status, 200);
  assert.ok(!dispatchAfterRevoke.data.previewedDeliveryIds.includes(withheld._id));
  assert.equal((await db.collection('cs_outbox').findOne({ _id: withheld._id })).state, 'CANCELLED');
  const inboundCount = await inbound();
  const refused = await request('cs/simulator/inbound', { bindingId, inboundKey: key(), text: `IEMS ORDER ${so.orderNumber}` });
  assert.ok([404, 409].includes(refused.status), JSON.stringify(refused));
  assert.equal(await inbound(), inboundCount, 'revoked binding records no inbound');
  const origin = await evaluate('performance.timeOrigin');
  await call('Page.reload'); await wait(`performance.timeOrigin!==${origin} && document.querySelector('[data-binding-status=REVOKED]')`, 'revocation persists');
  await screenshot('wave4f-cs-binding-revoked');
  check('W4F-C6 CS permissions/revocation: alpha.viewer create disabled with reason and server 403 without effect; Chrome revoke persists, simulator disabled with reason, server refuses revoked inbound with zero inbound rows');

  // Separate owned binding keeps the revoked customer capability closed.
  await call('Page.navigate', { url: `${web}/portfolio/service/bindings` });
  await fillIn(CREATE, 'accountId', account._id); await fillIn(CREATE, 'contactId', contact._id);
  await fillIn(CREATE, 'address', '+6200012345102'); await clickIn(CREATE, 'Create binding');
  await wait(`document.querySelector('${SIM} [name=simulatorText]') && document.querySelector('h1')?.textContent.includes('+6200012345102')`, 'recovery binding created');
  const recoveryId = await evaluate(`location.pathname.split('/').at(-1)`);
  const reader = ctx.runtime.orderReader;
  ctx.runtime.orderReader = { async readCustomerOrder() { await new Promise(resolve => setTimeout(resolve, 2200)); return null; } };
  try {
    const unavailable = await send(`IEMS ORDER ${so.orderNumber}`);
    assert.match(unavailable.text, /Status unavailable/i);
    assert.doesNotMatch(unavailable.body || '', new RegExp(so.orderNumber));
  } finally { ctx.runtime.orderReader = reader; }
  const recovered = await send(`IEMS ORDER ${so.orderNumber}`);
  assert.equal(recovered.state, 'PREVIEWED'); assert.ok(recovered.body.includes(so.orderNumber));
  check('W4F-C7 native reader timeout returns unavailable with no order disclosure; separate new inquiry after reader recovery renders actual manufacture preview');
  const manufacturing = await db.collection('manufacturingWorkOrders').find({ tenantId: so.tenantId, status: 'RELEASED' }).toArray();
  let manufactureOnly;
  for (const wo of manufacturing) {
    if (wo.salesOrderId !== so._id && await db.collection('warehouseReservations').countDocuments({ salesOrderId: wo.salesOrderId }) === 0) {
      const candidate = await db.collection('salesOrders').findOne({ _id: wo.salesOrderId, accountId: account._id });
      if (candidate) { manufactureOnly = candidate; break; }
    }
  }
  assert.ok(manufactureOnly, 'real released manufacture fixture with no sales reservations');
  const only = await send(`IEMS ORDER ${manufactureOnly.orderNumber}`);
  assert.equal(only.kind, 'MANUFACTURE'); assert.equal(only.state, 'PREVIEWED'); assert.ok(only.body.includes(manufactureOnly.orderNumber));
  assert.equal(await db.collection('warehouseReservations').countDocuments({ salesOrderId: manufactureOnly._id }), 0);
  check('W4F-C10 native manufacture-only inquiry uses an actual released WO order with zero sales reservations and renders PREVIEWED authoritative status');

  const secondWriter = await request(`cs/bindings/${recoveryId}/revoke`, { expectedVersion: 1, reason: 'Independent writer revoked stale browser binding' }, { 'idempotency-key': key() });
  assert.equal(secondWriter.status, 200);
  const countBeforeStale = await inbound();
  await fillIn(REVOKE, 'revokeReason', 'Stale browser must not overwrite revocation'); await clickIn(REVOKE, 'Revoke binding');
  await wait(`document.querySelector('${REVOKE}').innerText.includes('Reload binding')`, 'stale revoke conflict');
  assert.equal((await db.collection('cs_contact_bindings').findOne({ _id: recoveryId })).version, 2);
  await fillIn(SIM, 'simulatorText', `IEMS ORDER ${so.orderNumber}`); await clickIn(SIM, 'Send simulated message');
  await wait(`document.querySelector('${SIM}').innerText.includes('BINDING_REVOKED')`, 'stale simulator refused');
  assert.equal(await inbound(), countBeforeStale);
  await clickIn(REVOKE, 'Reload binding'); await wait(`document.querySelector('[data-binding-status=REVOKED]')`, 'native stale binding reload');
  check('W4F-C8 real second-writer revoke leaves stale native revoke conflicted and native inquiry refused with zero inbound effects; explicit reload shows revoked state');

  await call('Page.navigate', { url: `${web}/portfolio/service/bindings` });
  await fillIn(CREATE, 'accountId', account._id); await fillIn(CREATE, 'contactId', contact._id);
  await fillIn(CREATE, 'address', '+6200012345103'); await clickIn(CREATE, 'Create binding');
  await wait(`document.querySelector('${SIM} [name=simulatorText]') && document.querySelector('h1')?.textContent.includes('+6200012345103')`, 'expiry binding created');
  const expiringId = await evaluate(`location.pathname.split('/').at(-1)`);
  await db.collection('cs_contact_bindings').updateOne({ _id: expiringId }, { $set: { expiresAt: new Date(0) } });
  const beforeExpiry = await inbound();
  await fillIn(SIM, 'simulatorText', `IEMS ORDER ${so.orderNumber}`); await clickIn(SIM, 'Send simulated message');
  await wait(`document.querySelector('${SIM} [role=alert]')`, 'expired stale browser request rejected');
  assert.equal(await inbound(), beforeExpiry);
  await clickIn('.pf-main', 'Reload binding'); await wait(`document.querySelector('[data-binding-status=EXPIRED]')`, 'expiry reload');
  assert.match(await disabledReason(SIM, 'Send simulated message'), /expired/i);
  check('W4F-C9 owned expiry clock fixture: native stale inquiry refused without inbound effects, native reload shows Expired and disables simulator with reason');
}
