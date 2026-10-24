import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';

const ACCOUNT = 'synthetic-preview-account';
test('operator CS HTTP pagination, thread, reply and public update', async t => {
  const h = await startOwned(t), { db, runtime, seeded, alpha, beta, ok, req, setRoles, scopeOf } = h, [a, b] = seeded, cs = runtime.customerService;
  const make = async (member, cookie, label) => {
    const customer = await ok('/crm/accounts', { name: `Synthetic ${label}` }, 201, cookie);
    const restore = await setRoles(member, ['owner', 'csFixtureAdmin']);
    let principal;
    try {
      const scope = await scopeOf(cookie);
      await cs.provisionFixtureCustomer(scope, { plantId: member.plantId, customerId: customer._id, label });
      await cs.bindContact(scope, { plantId: member.plantId, bindingId: randomUUID(), customerId: customer._id, channelAccountId: ACCOUNT, providerContactId: label });
      principal = await cs.resolveCustomerPrincipal({ tenantId: member.tenantId, channelAccountId: ACCOUNT, providerContactId: label });
    } finally { await restore(); }
    await cs.handleInboundCommand(principal, { inboundKey: randomUUID(), text: 'MENU', command: { op: 'MENU' } });
    let d = await cs.startComplaintDraft(principal, { requestKey: randomUUID() });
    for (const action of [{ type: 'GENERAL_INQUIRY' }, { type: 'SELECT_CATEGORY', category: 'OTHER' }, { type: 'DESCRIBE', text: `Synthetic ${label} complaint` }]) d = await cs.updateComplaintDraft(principal, { draftId: d.draftId, expectedVersion: d.version, action });
    const ticket = await cs.confirmComplaint(principal, { draftId: d.draftId, expectedVersion: d.version, inboundKey: randomUUID() });
    const handoff = await cs.requestHandoff(principal, { inboundKey: randomUUID() });
    return { principal, ticket, handoff };
  };
  const one = await make(a, alpha, 'synthetic-contact-one'), two = await make(a, alpha, 'synthetic-contact-two'), foreign = await make(b, beta, 'synthetic-contact-beta');
  const commandKey = () => randomUUID();
  const threadPath = `/cs/conversations/${one.handoff.conversationId}/thread`, replyPath = `/cs/conversations/${one.handoff.conversationId}/reply`, publicPath = `/cs/tickets/${one.ticket.ticketId}/public-update`;

  await t.test('ticket/conversation cursor pagination traverses every scoped record without duplicates', async () => {
    for (const [path, idKey, expected] of [['tickets', 'ticketId', [one.ticket.ticketId, two.ticket.ticketId]], ['conversations', 'conversationId', [one.handoff.conversationId, two.handoff.conversationId]]]) {
      const first = await req(`/cs/${path}?limit=1`, undefined, alpha);
      assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.data.length, 1); assert.equal(first.page.limit, 1); assert.equal(typeof first.page.nextCursor, 'string');
      const last = await req(`/cs/${path}?limit=1&cursor=${encodeURIComponent(first.page.nextCursor)}`, undefined, alpha);
      assert.equal(last.status, 200, JSON.stringify(last)); assert.equal(last.page.nextCursor, null);
      assert.deepEqual([...first.data, ...last.data].map(v => v[idKey]).sort(), expected.sort());
      for (const query of ['limit=0', 'limit=101', 'limit=1e2', 'cursor=not-a-cursor', 'unexpected=1']) assert.equal((await req(`/cs/${path}?${query}`, undefined, alpha)).status, 400, `${path} ${query}`);
    }
    assert.equal((await req('/cs/conversations?mode=HUMAN_PENDING', undefined, alpha)).data.length, 2);
    assert.deepEqual((await req('/cs/conversations?mode=BOT_ACTIVE', undefined, alpha)).data, []);
    assert.equal((await req('/cs/conversations?mode=INVALID', undefined, alpha)).status, 400);
    assert.equal((await req('/cs/conversations')).status, 401);
    assert.equal((await req(`/cs/conversations?plantId=${b.plantId}`, undefined, alpha)).status, 403);
    const list = await req('/cs/conversations', undefined, alpha);
    assert.ok(list.data.every(c => c.customerLabel && typeof c.hasUnknownDelivery === 'boolean' && c.lastActivityAt));
    assert.ok(!JSON.stringify(list).includes('synthetic-contact-beta'));
  });

  await t.test('reply requires takeover, cs.reply and the assigned operator; same-key retry is one outbound', async () => {
    const body = { text: 'Synthetic operator response', commandKey: commandKey() };
    assert.equal((await req(replyPath, body, alpha)).error.code, 'INVALID_TRANSITION');
    await ok(`/cs/conversations/${one.handoff.conversationId}/takeover`, { expectedVersion: one.handoff.version, commandKey: commandKey() });
    const restore = await setRoles(a, ['csViewer']);
    try { assert.equal((await req(replyPath, body, alpha)).status, 403); } finally { await restore(); }
    const restoreAgent = await setRoles(a, ['csAgent']);
    try {
      const results = await Promise.all([1, 2].map(() => req(replyPath, body, alpha)));
      assert.deepEqual(results.map(r => r.status), [200, 200], JSON.stringify(results));
      assert.equal(results[0].data.deliveryId, results[1].data.deliveryId);
      assert.equal(results[0].data.state, 'QUEUED');
      assert.equal(await db.collection('cs_outbox').countDocuments({ _id: results[0].data.deliveryId, kind: 'OPERATOR_REPLY', origin: 'OPERATOR', state: 'QUEUED' }), 1);
      assert.equal((await req(replyPath, { ...body, text: 'Different' }, alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await req(replyPath, { ...body, unknown: true }, alpha)).status, 400);
      assert.equal((await req(replyPath, { text: ' ', commandKey: commandKey() }, alpha)).status, 400);
    } finally { await restoreAgent(); }
    assert.equal((await req(replyPath, { text: 'Foreign', commandKey: commandKey() }, beta)).status, 404);
    assert.equal((await req(`/cs/conversations/${foreign.handoff.conversationId}/reply`, { text: 'Foreign', commandKey: commandKey() }, alpha)).status, 404);
  });

  await t.test('public update is versioned/idempotent and customer-visible, internal notes never enter thread', async () => {
    const body = { expectedVersion: 1, text: 'Synthetic public progress', commandKey: commandKey() };
    const restore = await setRoles(a, ['csViewer']);
    try { assert.equal((await req(publicPath, body, alpha)).status, 403); } finally { await restore(); }
    const results = await Promise.all([1, 2].map(() => req(publicPath, body, alpha)));
    assert.deepEqual(results.map(r => r.status), [200, 200]); assert.deepEqual(results[0].data, { ticketId: one.ticket.ticketId, version: 2 }); assert.deepEqual(results[1].data, results[0].data);
    assert.equal((await req(publicPath, { ...body, commandKey: commandKey() }, alpha)).error.code, 'VERSION_CONFLICT');
    assert.equal((await req(publicPath, body, beta)).status, 404);
    assert.equal((await req(publicPath, { ...body, unknown: true }, alpha)).status, 400);
    const customer = await cs.getTicketForCustomer(one.principal, { ticketNumber: one.ticket.ticketNumber });
    assert.equal(customer.updates.filter(e => e.kind === 'PUBLIC_UPDATE' && e.text === body.text).length, 1);
    await ok(`/cs/tickets/${one.ticket.ticketId}/internal-notes`, { text: 'INTERNAL-ONLY-SENTINEL', commandKey: commandKey() }, 201);
    const first = await req(`${threadPath}?limit=1`, undefined, alpha);
    assert.equal(first.status, 200); assert.equal(first.data.length, 1); assert.ok(first.page.nextCursor);
    const all = [...first.data]; let cursor = first.page.nextCursor;
    while (cursor) { const p = await req(`${threadPath}?limit=1&cursor=${encodeURIComponent(cursor)}`, undefined, alpha); assert.equal(p.status, 200, JSON.stringify(p)); all.push(...p.data); cursor = p.page.nextCursor; }
    assert.equal(new Set(all.map(m => m.messageId)).size, all.length);
    assert.ok(all.some(m => m.direction === 'INBOUND' && m.origin === 'CUSTOMER' && m.text === 'MENU'));
    assert.ok(all.some(m => m.origin === 'OPERATOR' && m.text === 'Synthetic operator response'));
    assert.ok(!JSON.stringify(all).includes('INTERNAL-ONLY-SENTINEL'));
    assert.equal((await req(threadPath, undefined, beta)).status, 404);
    assert.equal((await req(`${threadPath}?limit=101`, undefined, alpha)).status, 400);
    assert.equal((await req(`${threadPath}?cursor=bad`, undefined, alpha)).status, 400);
    assert.equal((await req(`${threadPath}?unknown=1`, undefined, alpha)).status, 400);
  });

  await t.test('dispatcher, fixture admin and customer-principal ports stay unrouted', async () => {
    for (const path of ['/cs/deliveries/claim', '/cs/deliveries/record', '/cs/dispatch/claim', '/cs/reconcile', '/cs/fixtures/customers', '/cs/fixtures/orders', '/cs/customer/order-status', '/cs/inbound']) assert.equal((await req(path, { commandKey: commandKey() }, alpha)).status, 404, path);
    assert.equal(await db.collection('cs_outbox').countDocuments({ state: { $in: ['SENDING', 'SENT'] } }), 0);
  });
});
