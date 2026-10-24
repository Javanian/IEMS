import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

// Wave 4f customer service on owned real Mongo through the mounted HTTP API: onboarding, simulator, reader, thread, metrics.
const key = () => randomUUID();
const address = () => `+62000${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

test('wave4f CS binding onboarding, simulator, authoritative manufacture/repair reader, thread preview and metrics', { timeout: 900000 }, async t => {
  const h = await startOwned(t, { customerService: { orderReaderTimeoutMs: 300, orderMaxStaleMs: 60000 } });
  const { db, runtime, ok, alpha, beta, seeded, send, setRoles } = h, [a, b] = seeded;
  const post = (path, body, cookie = alpha, k = key()) => send(path, { body, cookie, headers: k === null ? {} : { 'idempotency-key': k } });
  const get = (path, cookie = alpha) => send(path, { cookie });
  const okPost = async (path, body, status = 200, cookie = alpha) => { const r = await post(path, body, cookie); assert.equal(r.status, status, `${path} ${JSON.stringify(r)}`); return r.data; };
  const f = await orderWithStock(h, { orderQuantity: '1.5', receiptQuantity: '5', reserve: null });
  const contact = await ok(`/crm/accounts/${f.account._id}/contacts`, { name: 'Synthetic buyer', email: 'buyer@example.invalid' }, 201);
  const other = await ok('/crm/accounts', { name: 'Synthetic other customer' }, 201);
  const otherContact = await ok(`/crm/accounts/${other._id}/contacts`, { name: 'Other buyer', email: 'other@example.invalid' }, 201);
  const betaAccount = await ok('/crm/accounts', { name: 'Synthetic beta customer' }, 201, beta);
  const betaContact = await ok(`/crm/accounts/${betaAccount._id}/contacts`, { name: 'Beta buyer', email: 'beta@example.invalid' }, 201, beta);
  const repair = await ok('/repair/cases', { accountId: f.account._id, serial: 'SYN-SERIAL-1', condition: 'Synthetic intake damage', currency: 'USD', idempotencyKey: key() }, 201);
  const otherRepair = await ok('/repair/cases', { accountId: other._id, serial: 'SYN-SERIAL-2', condition: 'Other intake', currency: 'USD', idempotencyKey: key() }, 201);
  assert.match(repair.caseNumber, /^RP-[0-9A-F]{16}$/);
  const bindingBody = (extra = {}) => ({ accountId: f.account._id, contactId: contact._id, channel: 'SIMULATED', address: address(), ...extra });
  const simulate = (bindingId, text, cookie = alpha, inboundKey = key()) => send('/cs/simulator/inbound', { body: { bindingId, inboundKey, text }, cookie });
  const okSimulate = async (bindingId, text, inboundKey) => { const r = await simulate(bindingId, text, alpha, inboundKey); assert.equal(r.status, 200, `${text} ${JSON.stringify(r)}`); return r.data; };
  const thread = async conversationId => { const all = []; let cursor; do { const p = await get(`/cs/conversations/${conversationId}/thread?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); assert.equal(p.status, 200, JSON.stringify(p)); all.push(...p.data); cursor = p.page.nextCursor; } while (cursor); return all; };
  let primary;

  await t.test('onboarding requires permission, synthetic address, server scope and owned CRM contact; replay and conflicts are explicit', async () => {
    const before = await db.collection('cs_contact_bindings').countDocuments();
    const body = bindingBody();
    assert.deepEqual([(await post('/cs/bindings', body, alpha, null)).error.code], ['VALIDATION']);
    for (const bad of ['+6281234567890', '+62000123', '62000123456', '+62000123456789012']) assert.deepEqual([(await post('/cs/bindings', bindingBody({ address: bad }))).status, (await post('/cs/bindings', bindingBody({ address: bad }))).error.code], [422, 'SYNTHETIC_ADDRESS_REQUIRED'], bad);
    assert.deepEqual([(await post('/cs/bindings', bindingBody({ channel: 'WHATSAPP' }))).error.code], ['VALIDATION']);
    assert.deepEqual([(await post('/cs/bindings', bindingBody({ unknown: 1 }))).error.code], ['VALIDATION']);
    assert.deepEqual([(await post('/cs/bindings', bindingBody({ expiresAt: '2020-01-01T00:00:00.000Z' }))).error.code], ['VALIDATION']);
    assert.equal((await post('/cs/bindings', bindingBody({ contactId: otherContact._id }))).status, 404, 'contact of another account');
    assert.equal((await post('/cs/bindings', bindingBody({ accountId: betaAccount._id, contactId: betaContact._id }))).status, 404, 'other tenant account');
    assert.equal((await post('/cs/bindings', bindingBody(), beta)).status, 404, 'other tenant operator');
    assert.equal((await post('/cs/bindings', bindingBody({ tenant_id: b.tenantId }))).status, 403);
    assert.equal((await post('/cs/bindings', bindingBody({ plantId: b.plantId }))).status, 403);
    for (const roles of [['csViewer'], ['csBindingViewer'], ['csAgent']]) {
      const restore = await setRoles(a, roles);
      try { const r = await post('/cs/bindings', body); assert.deepEqual([r.status, r.error.code], [403, 'FORBIDDEN'], roles.join()); } finally { await restore(); }
    }
    const restoreViewer = await setRoles(a, ['csBindingViewer']);
    try { assert.equal((await get('/cs/bindings')).status, 200); } finally { await restoreViewer(); }
    assert.equal(await db.collection('cs_contact_bindings').countDocuments(), before);

    const k = key();
    const created = await post('/cs/bindings', body, alpha, k);
    assert.equal(created.status, 201, JSON.stringify(created));
    primary = created.data.binding;
    assert.deepEqual([primary.status, primary.version, primary.channel, primary.address, primary.accountId, primary.contactId, primary.verifiedMethod, primary.createdBy, primary.expiresAt], ['ACTIVE', 1, 'SIMULATED', body.address, f.account._id, contact._id, 'OPERATOR_ONBOARDING', a.userId, null]);
    const row = await db.collection('cs_contact_bindings').findOne({ _id: primary.bindingId });
    assert.deepEqual([row.tenantId, row.plantId, row.customerId, row.channelAccountId, row.providerContactId], [a.tenantId, a.plantId, f.account._id, 'SIMULATED', `sim-${body.address.slice(1)}`]);
    const replay = await post('/cs/bindings', body, alpha, k);
    assert.deepEqual([replay.status, replay.data], [201, created.data]);
    assert.deepEqual([(await post('/cs/bindings', { ...body, expiresAt: new Date(Date.now() + 86400000).toISOString() }, alpha, k)).error.code], ['IDEMPOTENCY_KEY_REUSED']);
    assert.deepEqual([(await post('/cs/bindings', body)).error.code], ['BINDING_CONFLICT']);
    assert.equal(await db.collection('cs_contact_bindings').countDocuments(), before + 1);

    const list = await get('/cs/bindings?status=ACTIVE');
    assert.ok(list.data.items.some(x => x.bindingId === primary.bindingId));
    assert.ok(!JSON.stringify(list.data).includes('sim-'), 'provider contact id stays internal');
    assert.deepEqual((await get('/cs/bindings', beta)).data.items, []);
    await okPost('/cs/bindings', bindingBody(), 201);
    const first = await get(`/cs/bindings?limit=1&accountId=${f.account._id}`);
    assert.equal(first.data.items.length, 1); assert.equal(typeof first.data.nextCursor, 'string');
    const second = await get(`/cs/bindings?limit=1&accountId=${f.account._id}&cursor=${encodeURIComponent(first.data.nextCursor)}`);
    assert.notEqual(second.data.items[0].bindingId, first.data.items[0].bindingId);
    for (const q of ['limit=0', 'status=BAD', 'cursor=bad', 'other=1']) assert.equal((await get(`/cs/bindings?${q}`)).status, 400, q);
    // Knowing an address or an order number never yields a principal or a binding.
    await assert.rejects(runtime.customerService.resolveCustomerPrincipal({ tenantId: a.tenantId, channelAccountId: 'SIMULATED', providerContactId: 'sim-62000999999999' }), e => e.code === 'DENIED');
    assert.equal((await simulate(randomUUID(), `IEMS ORDER ${f.so.orderNumber}`)).status, 404);
  });

  await t.test('simulator replies with rendered manufacture and repair status from the owning collections', async () => {
    const one = await okSimulate(primary.bindingId, `IEMS ORDER ${f.so.orderNumber}`);
    assert.equal(one.command, 'ORDER');
    const r = one.reply;
    assert.deepEqual([r.direction, r.origin, r.kind, r.deliveryState, r.state, r.template, r.sentAt], ['OUTBOUND', 'BOT', 'BOT_REPLY', 'PREVIEWED', 'PREVIEWED', { id: 'order_status', version: 1 }, null]);
    assert.ok(r.body.startsWith(`${f.so.orderNumber}: ACCEPTED.`), r.body);
    assert.ok(r.body.includes('Authoritative owned order.'), r.body);
    assert.equal(r.source.kind, 'MANUFACTURE_ORDER'); assert.match(r.source.id, /^[0-9a-f]{64}$/); assert.ok(r.source.sourceVersion >= 1);
    assert.deepEqual([r.order.kind, r.order.publicStage, r.order.confirmedDates, r.order.milestones.map(m => `${m.code}:${m.state}`)], ['MANUFACTURE', 'ACCEPTED', {}, ['ACCEPTED:CURRENT', 'PLANNING:PENDING', 'PRODUCTION:PENDING', 'QUALITY_INSPECTION:PENDING', 'READY_TO_SHIP:PENDING', 'SHIPPED:PENDING']]);
    assert.equal(r.order.milestones[1].at, null);
    for (const secret of [f.so._id, f.account._id, a.tenantId, a.plantId, 'unitPrice', 'USD']) assert.ok(!JSON.stringify(one).includes(secret), `simulator response leaks ${secret}`);
    // Domain change (real WO planning) moves the derived stage and source version.
    await ok('/manufacturing/work-orders', { salesOrderId: f.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1.5'], idempotencyKey: key() }, 201);
    const two = await okSimulate(primary.bindingId, `ORDER ${f.so.orderNumber}`);
    assert.equal(two.reply.order.publicStage, 'PLANNING');
    assert.ok(two.reply.source.sourceVersion > r.source.sourceVersion);
    assert.deepEqual(two.reply.order.progress, { released: 0, total: 1 });
    assert.ok(two.reply.body.includes('0 of 1 units released. Next: In production.'), two.reply.body);

    // Repair order through the same reader and binding.
    await ok(`/repair/cases/${repair._id}/diagnostic-authorize`, { expectedVersion: 1, feeCap: '50.00', evidence: 'Synthetic diagnostic authorization', idempotencyKey: key() });
    const rep = (await okSimulate(primary.bindingId, `IEMS ORDER ${repair.caseNumber}`)).reply;
    assert.deepEqual([rep.order.kind, rep.order.publicStage, rep.source.kind, rep.order.confirmedDates, rep.order.progress], ['REPAIR', 'DIAGNOSIS', 'REPAIR_ORDER', {}, null]);
    assert.deepEqual(rep.order.milestones.map(m => `${m.code}:${m.state}`), ['RECEIVED:DONE', 'DIAGNOSIS:CURRENT', 'AWAITING_APPROVAL:PENDING', 'APPROVED:PENDING', 'REPAIR:PENDING', 'TESTING:PENDING', 'READY_TO_RETURN:PENDING', 'RETURNED:PENDING']);
    assert.ok(rep.order.milestones[0].at && rep.order.milestones[1].at);
    assert.ok(rep.body.includes('Authoritative owned repair order.'), rep.body);
    const status = await get(`/cs/bindings/${primary.bindingId}/order-status?orderNumber=${repair.caseNumber}`);
    assert.deepEqual([status.status, status.data.kind, status.data.publicStage, status.data.liveLookup], [200, 'REPAIR', 'DIAGNOSIS', true]);
    // Repair/manufacture miss and other-customer numbers: NOT_FOUND (HTTP 404) and an unavailable-status reply in the channel.
    for (const n of ['RP-0000000000000000', otherRepair.caseNumber, 'SO-0000000000000000']) {
      assert.deepEqual([(await get(`/cs/bindings/${primary.bindingId}/order-status?orderNumber=${n}`)).status], [404], n);
      const miss = await okSimulate(primary.bindingId, `IEMS ORDER ${n}`);
      assert.deepEqual([miss.error, miss.reply.template.id, miss.reply.source], ['NOT_FOUND', 'status_unavailable', null], n);
    }
    assert.equal((await get(`/cs/bindings/${primary.bindingId}/order-status?orderNumber=${repair.caseNumber}`, beta)).status, 404);
    assert.equal(await db.collection('cs_order_snapshots').countDocuments(), 0, 'no manual snapshot rows');
  });

  let ticket, conversationId;
  await t.test('complaint, handoff, human reply and resolution through product paths; thread is a safe projection; metrics exclude bot acks', async () => {
    const windowFrom = new Date(Date.now() - 3600000).toISOString(), windowTo = () => new Date(Date.now() + 60000).toISOString();
    const metrics = async () => { const r = await get(`/cs/metrics?from=${windowFrom}&to=${windowTo()}`); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; };
    const baseline = await metrics();
    assert.equal(baseline.firstHumanResponse, null); assert.equal(baseline.resolution, null);
    for (const text of ['IEMS COMPLAINT', `IEMS COMPLAINT ORDER ${f.so.orderNumber}`, 'IEMS COMPLAINT CATEGORY QUALITY', 'IEMS COMPLAINT DESCRIBE Synthetic surface defect']) await okSimulate(primary.bindingId, text);
    const confirmKey = key();
    const confirmed = await okSimulate(primary.bindingId, 'IEMS COMPLAINT CONFIRM', confirmKey);
    ticket = confirmed.ticket; conversationId = confirmed.conversationId;
    assert.match(ticket.ticketNumber, /^CS-\d{6}$/);
    const ack = confirmed.deliveries.find(d => d.kind === 'TICKET_ACK');
    assert.deepEqual([ack.deliveryState, ack.body], ['PREVIEWED', `IEMS preview: complaint received as ticket ${ticket.ticketNumber}. A team member will review it.`]);
    // Same inbound key replays the stored result without a second ticket, inbound row or outbox row.
    const counts = async () => Promise.all(['cs_tickets', 'cs_inbound', 'cs_outbox'].map(n => db.collection(n).countDocuments()));
    const before = await counts();
    const replay = await okSimulate(primary.bindingId, 'IEMS COMPLAINT CONFIRM', confirmKey);
    assert.deepEqual([replay.ticket, replay.reply?.messageId ?? null], [ticket, confirmed.reply?.messageId ?? null]);
    assert.deepEqual(await counts(), before);

    await ok(`/cs/tickets/${ticket.ticketId}/internal-notes`, { text: 'PRIVATE-NOTE margin 42 percent', commandKey: key() }, 201);
    const handoff = await okSimulate(primary.bindingId, 'IEMS HUMAN');
    assert.ok(handoff.deliveries.some(d => d.kind === 'HANDOFF_ACK' && d.deliveryState === 'PREVIEWED'));
    const pending = await metrics();
    assert.equal(pending.firstHumanResponse, null, 'bot/system acknowledgements are not human responses');
    assert.ok(pending.open >= 1 && pending.unassigned >= 1);
    assert.deepEqual(pending.overdue, { count: 0, slaMinutes: 240 });
    // Suppressed while waiting for a human: the bot does not answer.
    const suppressed = await okSimulate(primary.bindingId, `IEMS ORDER ${f.so.orderNumber}`);
    assert.deepEqual([suppressed.suppressed, suppressed.mode, suppressed.reply], [true, 'HUMAN_PENDING', null]);

    const conv = await ok(`/cs/conversations/${conversationId}`);
    await ok(`/cs/conversations/${conversationId}/takeover`, { expectedVersion: conv.version, commandKey: key() });
    const reply = await ok(`/cs/conversations/${conversationId}/reply`, { text: 'We are inspecting your parts today.', commandKey: key() });
    assert.equal(reply.state, 'QUEUED');
    let rows = await thread(conversationId);
    assert.equal(rows.find(m => m.messageId === reply.deliveryId).deliveryState, 'QUEUED');
    const dispatched = await okPost('/cs/simulator/dispatch', {});
    assert.ok(dispatched.previewedDeliveryIds.includes(reply.deliveryId));
    rows = await thread(conversationId);
    const human = rows.find(m => m.messageId === reply.deliveryId);
    assert.deepEqual([human.origin, human.body, human.template, human.deliveryState, human.source, human.sentAt], ['OPERATOR', 'We are inspecting your parts today.', { id: 'operator_text', version: 1 }, 'PREVIEWED', null, null]);
    assert.ok(rows.some(m => m.direction === 'INBOUND' && m.text === 'IEMS COMPLAINT DESCRIBE Synthetic surface defect'));
    assert.ok(rows.filter(m => m.direction === 'OUTBOUND').every(m => typeof m.body === 'string' && m.body.length && m.template.id && m.deliveryState));
    assert.ok(!rows.some(m => ['SENT', 'DELIVERED', 'READ'].includes(m.deliveryState)), 'preview is never reported as sent');
    const json = JSON.stringify(rows);
    for (const secret of ['PRIVATE-NOTE', 'margin', 'unitPrice', '"0.05"', f.so._id, a.tenantId]) assert.ok(!json.includes(secret), `thread leaks ${secret}`);

    const responded = await metrics();
    assert.equal(responded.firstHumanResponse.n, 1);
    assert.ok(responded.firstHumanResponse.p50Minutes >= 0 && responded.firstHumanResponse.p50Minutes < 60);
    let version = (await ok(`/cs/tickets/${ticket.ticketId}`)).version;
    for (const [toStage, extra] of [['ASSIGNED', { assigneeId: a.userId }], ['IN_PROGRESS', {}], ['RESOLVED', {}]]) version = (await ok(`/cs/tickets/${ticket.ticketId}/stage`, { expectedVersion: version, toStage, reason: `Synthetic ${toStage}`, commandKey: key(), ...extra })).version;
    const resolved = await metrics();
    assert.deepEqual([resolved.resolution.n, resolved.firstHumanResponse.n, typeof resolved.definitions.firstHumanResponse], [1, 1, 'string']);
    assert.ok(resolved.open < pending.open);
    for (const q of [`from=${windowTo()}&to=${windowFrom}`, 'from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z', 'from=yesterday', 'other=1']) assert.equal((await get(`/cs/metrics?${q}`)).status, 400, q);
    const restore = await setRoles(a, ['csBindingAdmin']);
    try { assert.equal((await get('/cs/metrics')).status, 403); } finally { await restore(); }
    assert.equal((await get('/cs/metrics', beta)).data.open, 0, 'metrics are tenant/plant scoped');
  });

  await t.test('revocation and expiry are enforced at query and dispatch without stale leaks', async () => {
    const created = await okPost('/cs/bindings', bindingBody(), 201);
    const binding = created.binding;
    const principal = await runtime.customerService.resolveCustomerPrincipal({ tenantId: a.tenantId, channelAccountId: 'SIMULATED', providerContactId: `sim-${binding.address.slice(1)}` });
    assert.equal((await runtime.customerService.getOrderStatusForCustomer(principal, { orderNumber: f.so.orderNumber })).publicStage, 'PLANNING');
    const handoff = await okSimulate(binding.bindingId, 'IEMS HUMAN');
    const conv = await ok(`/cs/conversations/${handoff.conversationId}`);
    await ok(`/cs/conversations/${handoff.conversationId}/takeover`, { expectedVersion: conv.version, commandKey: key() });
    const queued = await ok(`/cs/conversations/${handoff.conversationId}/reply`, { text: 'Queued before revocation', commandKey: key() });
    const stale = await post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'Customer left company', expectedVersion: 2 });
    assert.deepEqual([stale.status, stale.error.code, stale.error.currentVersion], [409, 'VERSION_CONFLICT', 1]);
    assert.deepEqual([(await post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'x', expectedVersion: 1 })).error.code], ['VALIDATION']);
    assert.equal((await post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'Customer left company', expectedVersion: 1 }, beta)).status, 404);
    const rk = key();
    const revoked = await post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'Customer left company', expectedVersion: 1 }, alpha, rk);
    assert.equal(revoked.status, 200, JSON.stringify(revoked));
    assert.deepEqual([revoked.data.binding.status, revoked.data.binding.version, revoked.data.binding.revokeReason, revoked.data.cancelledDeliveries], ['REVOKED', 2, 'Customer left company', 1]);
    assert.deepEqual((await post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'Customer left company', expectedVersion: 1 }, alpha, rk)).data, revoked.data);
    assert.deepEqual([(await post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'Customer left company', expectedVersion: 2 })).error.code], ['BINDING_REVOKED']);
    const row = await db.collection('cs_outbox').findOne({ _id: queued.deliveryId });
    assert.deepEqual([row.state, row.cancelReason], ['CANCELLED', 'BINDING_REVOKED']);
    assert.deepEqual([(await simulate(binding.bindingId, 'IEMS MENU')).status, (await simulate(binding.bindingId, 'IEMS MENU')).error.code], [409, 'BINDING_REVOKED']);
    assert.equal((await get(`/cs/bindings/${binding.bindingId}/order-status?orderNumber=${f.so.orderNumber}`)).status, 404);
    await assert.rejects(runtime.customerService.getOrderStatusForCustomer(principal, { orderNumber: f.so.orderNumber }), e => e.code === 'DENIED', 'cached principal is not reusable after revocation');
    assert.equal((await h.req(`/cs/conversations/${handoff.conversationId}/reply`, { text: 'After revocation', commandKey: key() }, alpha)).status, 403);
    assert.ok((await get('/cs/bindings?status=REVOKED')).data.items.some(x => x.bindingId === binding.bindingId));

    // Expiry: a short-lived binding stops answering, its queued replies are cancelled at dispatch, and the address can be rebound.
    const shortBody = bindingBody({ expiresAt: new Date(Date.now() + 4000).toISOString() });
    const short = (await okPost('/cs/bindings', shortBody, 201)).binding;
    const handoff2 = await okSimulate(short.bindingId, 'IEMS HUMAN');
    const conv2 = await ok(`/cs/conversations/${handoff2.conversationId}`);
    await ok(`/cs/conversations/${handoff2.conversationId}/takeover`, { expectedVersion: conv2.version, commandKey: key() });
    const queued2 = await ok(`/cs/conversations/${handoff2.conversationId}/reply`, { text: 'Queued before expiry', commandKey: key() });
    await sleep(Math.max(0, new Date(short.expiresAt) - Date.now()) + 300);
    assert.deepEqual([(await simulate(short.bindingId, 'IEMS MENU')).error?.code], ['BINDING_REVOKED']);
    assert.equal((await get(`/cs/bindings/${short.bindingId}/order-status?orderNumber=${f.so.orderNumber}`)).status, 404);
    await okPost('/cs/simulator/dispatch', {});
    const expired = await db.collection('cs_outbox').findOne({ _id: queued2.deliveryId });
    assert.deepEqual([expired.state, expired.cancelReason], ['CANCELLED', 'BINDING_EXPIRED']);
    assert.ok((await get('/cs/bindings?status=EXPIRED')).data.items.some(x => x.bindingId === short.bindingId));
    const rebound = await okPost('/cs/bindings', { ...shortBody, expiresAt: null }, 201);
    assert.equal(rebound.binding.status, 'ACTIVE');
    assert.equal((await db.collection('cs_contact_bindings').findOne({ _id: short.bindingId })).status, 'EXPIRED');
  });

  await t.test('revocation racing simulated inbound never previews after revocation', async () => {
    for (let i = 0; i < 3; i++) {
      const binding = (await okPost('/cs/bindings', bindingBody(), 201)).binding;
      const [inbound, revoked] = await Promise.all([simulate(binding.bindingId, `IEMS ORDER ${f.so.orderNumber}`), post(`/cs/bindings/${binding.bindingId}/revoke`, { reason: 'Race revoke', expectedVersion: 1 })]);
      assert.equal(revoked.status, 200, JSON.stringify(revoked));
      assert.ok([200, 409].includes(inbound.status), JSON.stringify(inbound));
      if (inbound.status === 409) assert.equal(inbound.error.code, 'BINDING_REVOKED');
      const revokedAt = (await db.collection('cs_contact_bindings').findOne({ _id: binding.bindingId })).revokedAt;
      const rows = await db.collection('cs_outbox').find({ bindingId: binding.bindingId }).toArray();
      assert.ok(rows.every(r => r.state !== 'PREVIEWED' || r.previewedAt <= revokedAt), JSON.stringify(rows.map(r => [r.state, r.previewedAt, revokedAt])));
      assert.ok(rows.every(r => r.state !== 'QUEUED'), 'nothing remains queued for a revoked binding');
      await okPost('/cs/simulator/dispatch', {});
      assert.ok((await db.collection('cs_outbox').find({ bindingId: binding.bindingId }).toArray()).every(r => ['PREVIEWED', 'CANCELLED'].includes(r.state)));
      console.log('CS_REVOKE_RACE', i, inbound.status, rows.map(r => r.state).join(','));
    }
  });

  await t.test('reader timeout, stale authorization and cross-plant scope fail closed', async () => {
    const real = runtime.orderReader;
    try {
      runtime.orderReader = { readCustomerOrder: input => new Promise(r => setTimeout(() => r(real.readCustomerOrder(input)), 600)) };
      const slow = await get(`/cs/bindings/${primary.bindingId}/order-status?orderNumber=${f.so.orderNumber}`);
      assert.deepEqual([slow.status, slow.error.code], [503, 'STATUS_UNAVAILABLE']);
      const reply = await okSimulate(primary.bindingId, 'IEMS MENU');
      assert.ok(reply.suppressed || reply.reply, 'conversation exists');
    } finally { runtime.orderReader = real; }
    // A fresh binding (bot active) shows the unavailable reply in the channel during reader timeout.
    const fresh = (await okPost('/cs/bindings', bindingBody(), 201)).binding;
    try {
      runtime.orderReader = { readCustomerOrder: input => new Promise(r => setTimeout(() => r(real.readCustomerOrder(input)), 600)) };
      const timed = await okSimulate(fresh.bindingId, `IEMS ORDER ${f.so.orderNumber}`);
      assert.deepEqual([timed.error, timed.reply.template.id, timed.reply.deliveryState], ['STATUS_UNAVAILABLE', 'status_unavailable', 'PREVIEWED']);
      assert.equal(timed.reply.body, 'IEMS preview: status cannot be confirmed right now. Send IEMS HUMAN for a team member.');
    } finally { runtime.orderReader = real; }
    // Authorization revoked between the pre-check and the transaction is enforced in-transaction.
    const member = await db.collection('memberships').findOne({ _id: a.membershipId });
    const foundation = runtime.foundation;
    const downgrade = () => db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'csViewer', plantIds: member.plantIds, tenantWide: false }] } });
    const before = await Promise.all(['cs_contact_bindings', 'cs_inbound', 'cs_outbox', 'cs_idempotency'].map(n => db.collection(n).countDocuments()));
    try {
      runtime.foundation = { ...foundation, authorize: async (...args) => { const r = await foundation.authorize(...args); await downgrade(); return r; } };
      assert.equal((await post('/cs/bindings', bindingBody())).status, 403);
      await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
      assert.equal((await simulate(fresh.bindingId, 'IEMS MENU')).status, 403);
      await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
      assert.equal((await post(`/cs/bindings/${fresh.bindingId}/revoke`, { reason: 'Stale grant', expectedVersion: 1 })).status, 403);
    } finally { runtime.foundation = foundation; await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    assert.deepEqual(await Promise.all(['cs_contact_bindings', 'cs_inbound', 'cs_outbox', 'cs_idempotency'].map(n => db.collection(n).countDocuments())), before);
    for (const path of [`/cs/bindings?plantId=${b.plantId}`, `/cs/metrics?plant_id=${b.plantId}`, `/cs/bindings/${primary.bindingId}/order-status?orderNumber=${f.so.orderNumber}&plantId=${b.plantId}`]) assert.equal((await get(path)).status, 403, path);
    assert.equal((await simulate(primary.bindingId, 'IEMS MENU', beta)).status, 404, 'other tenant cannot drive a binding');
    assert.equal((await send('/cs/simulator/inbound', { body: { bindingId: primary.bindingId, inboundKey: key(), text: 'IEMS MENU' }, cookie: null })).status, 401);
    const restore = await setRoles(a, ['csAgent']);
    try { assert.deepEqual([(await simulate(primary.bindingId, 'IEMS MENU')).status, (await post('/cs/simulator/dispatch', {})).status], [403, 403]); } finally { await restore(); }
  });
});
