import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';
import { createOrderReader } from '../src/order-reader.mjs';

const ACCOUNT = 'synthetic-preview-account';
test('authoritative order reader: CS status follows real SO/WO/QC/shipment state', async t => {
  const h = await startOwned(t, { customerService: { orderReaderTimeoutMs: 300, orderMaxStaleMs: 60000 } });
  const { db, runtime, ok, alpha, beta, seeded, setRoles, scopeOf } = h, cs = runtime.customerService, [a, b] = seeded;
  const { account, so, reservation, key } = await orderWithStock(h, { orderQuantity: '1.5', receiptQuantity: '5', reserve: '0.5' });
  const otherAccount = await ok('/crm/accounts', { name: 'Synthetic other customer' }, 201);
  const betaAccount = await ok('/crm/accounts', { name: 'Synthetic beta customer' }, 201, beta);
  // Trusted harness: CS customers are the CRM account ids, provisioned through the package fixture API (never HTTP).
  const bind = async (cookie, member, customerId, contact) => {
    const restore = await setRoles(member, ['owner', 'csFixtureAdmin']);
    try {
      const scope = await scopeOf(cookie), bindingId = randomUUID();
      await cs.provisionFixtureCustomer(scope, { plantId: member.plantId, customerId, label: `Synthetic ${contact}` });
      await cs.bindContact(scope, { plantId: member.plantId, bindingId, customerId, channelAccountId: ACCOUNT, providerContactId: contact });
      return { bindingId, principal: await cs.resolveCustomerPrincipal({ tenantId: member.tenantId, channelAccountId: ACCOUNT, providerContactId: contact }) };
    } finally { await restore(); }
  };
  const own = await bind(alpha, a, account._id, 'synthetic-own'), other = await bind(alpha, a, otherAccount._id, 'synthetic-other');
  const foreign = await bind(beta, b, betaAccount._id, 'synthetic-beta'), orphan = await bind(alpha, a, randomUUID(), 'synthetic-orphan');
  const status = () => cs.getOrderStatusForCustomer(own.principal, { orderNumber: so.orderNumber });
  const code = async promise => { try { await promise; return 'OK'; } catch (e) { return e.code; } };
  const versions = [];
  const expectStage = async (publicStage, progress) => {
    const s = await status();
    assert.deepEqual([s.publicStage, s.progress, s.source, s.liveLookup, s.orderNumber], [publicStage, progress, 'PORTFOLIO_API_OWNED', true, so.orderNumber]);
    assert.ok(Number.isSafeInteger(s.sourceVersion) && s.sourceVersion > (versions.at(-1) ?? 0), `sourceVersion must advance: ${versions} -> ${s.sourceVersion}`);
    versions.push(s.sourceVersion);
    const json = JSON.stringify(s);
    for (const secret of [so._id, account._id, a.tenantId, a.plantId, '0.05', 'USD']) assert.ok(!json.includes(secret), `public snapshot leaks ${secret}`);
    return s;
  };

  await t.test('stored order number is public, stable and unique; the raw SO id is never the order number', async () => {
    assert.match(so.orderNumber, /^SO-[0-9A-F]{16}$/);
    assert.ok(!so.orderNumber.includes(so._id));
    assert.equal((await ok(`/commercial/orders/${so._id}`)).orderNumber, so.orderNumber);
    await assert.rejects(db.collection('salesOrders').insertOne({ _id: randomUUID(), tenantId: so.tenantId, plantId: so.plantId, quoteId: randomUUID(), orderNumber: so.orderNumber }), e => e.code === 11000);
  });

  await t.test('status changes after each real WO, QC and shipment mutation', async () => {
    await expectStage('ACCEPTED', null);
    const plan = await ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', quantities: ['1.5'], idempotencyKey: key() }, 201);
    const wo = plan.workOrders[0], path = `/manufacturing/work-orders/${wo._id}`;
    await expectStage('PLANNING', { released: 0, total: 1 });
    await ok(`${path}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Make' }, { code: 'PACK', instruction: 'Pack' }], materials: [{ receiptId: (await db.collection('warehouseReceipts').findOne({}))._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: key() });
    await expectStage('PLANNING', { released: 1, total: 1 });
    await ok(`${path}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '1.5', goodQuantity: '1.5', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic make', idempotencyKey: key() });
    await expectStage('PRODUCTION', { released: 1, total: 1 });
    await ok(`${path}/record`, { expectedVersion: 3, operationIndex: 1, inputQuantity: '1.5', goodQuantity: '1.5', scrapQuantity: '0', uom: 'KG', evidence: 'Synthetic pack', idempotencyKey: key() });
    await expectStage('QUALITY_INSPECTION', { released: 1, total: 1 });
    await ok(`${path}/qc`, { expectedVersion: 4, acceptedQuantity: '1', rejectedQuantity: '0.5', uom: 'KG', evidence: 'Synthetic inspector', idempotencyKey: key() });
    await expectStage('READY_TO_SHIP', { released: 1, total: 1 });
    const ship = sources => ({ salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', reference: 'SYN-DN-CS', sources, idempotencyKey: key() });
    await ok('/fulfillment/shipments', ship([{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: '0.8' }]), 201);
    await expectStage('PARTIALLY_SHIPPED', { released: 1, total: 1 });
    // The bot reply consumed by the bridge carries the live stage, not a stored snapshot.
    const inbound = await cs.handleInboundCommand(own.principal, { inboundKey: randomUUID(), text: `ORDER ${so.orderNumber}`, command: { op: 'ORDER', orderNumber: so.orderNumber } });
    const reply = await db.collection('cs_outbox').findOne({ _id: inbound.reply.deliveryId });
    assert.deepEqual([reply.payload.template, reply.payload.params.publicStage, reply.payload.params.source], ['order_status', 'PARTIALLY_SHIPPED', 'PORTFOLIO_API_OWNED']);
    await ok('/fulfillment/shipments', ship([{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: '0.2' }, { sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '0.5' }]), 201);
    await expectStage('SHIPPED', { released: 1, total: 1 });
    assert.equal(await db.collection('cs_order_snapshots').countDocuments(), 0, 'no snapshot rewriting');
  });

  await t.test('complaint draft binds the real order and the ticket is sourced from the portfolio API', async () => {
    const receipt = await (async () => {
      let d = await cs.startComplaintDraft(own.principal, { requestKey: randomUUID() });
      for (const action of [{ type: 'SELECT_ORDER', orderNumber: so.orderNumber }, { type: 'SELECT_CATEGORY', category: 'QUALITY' }, { type: 'DESCRIBE', text: 'Synthetic quality note' }]) d = await cs.updateComplaintDraft(own.principal, { draftId: d.draftId, expectedVersion: d.version, action });
      return cs.confirmComplaint(own.principal, { draftId: d.draftId, expectedVersion: d.version, inboundKey: randomUUID() });
    })();
    const ticket = await db.collection('cs_tickets').findOne({ _id: receipt.ticketId });
    assert.deepEqual([ticket.orderNumber, ticket.orderSource], [so.orderNumber, 'PORTFOLIO_API_OWNED']);
  });

  await t.test('foreign customer, foreign tenant, non-CRM customer and missing order all answer NOT_FOUND', async () => {
    assert.equal(await code(cs.getOrderStatusForCustomer(other.principal, { orderNumber: so.orderNumber })), 'NOT_FOUND');
    assert.equal(await code(cs.getOrderStatusForCustomer(foreign.principal, { orderNumber: so.orderNumber })), 'NOT_FOUND');
    assert.equal(await code(cs.getOrderStatusForCustomer(orphan.principal, { orderNumber: so.orderNumber })), 'NOT_FOUND');
    assert.equal(await code(cs.getOrderStatusForCustomer(own.principal, { orderNumber: 'SO-0000000000000000' })), 'NOT_FOUND');
    const reader = createOrderReader({ client: h.client, db });
    assert.equal(await reader.readCustomerOrder({ tenantId: a.tenantId, plantId: b.plantId, customerId: account._id, orderNumber: so.orderNumber }), null, 'plant mismatch');
    assert.equal(await reader.readCustomerOrder({ tenantId: b.tenantId, plantId: a.plantId, customerId: account._id, orderNumber: so.orderNumber }), null, 'tenant mismatch');
    await assert.rejects(reader.readCustomerOrder({ tenantId: 'x', plantId: a.plantId, customerId: account._id, orderNumber: so.orderNumber }), TypeError);
  });

  await t.test('reader failure, timeout and stale snapshot map to STATUS_UNAVAILABLE, never a guessed stage', async () => {
    const real = runtime.orderReader;
    try {
      runtime.orderReader = { readCustomerOrder: async () => { throw new Error('synthetic outage'); } };
      assert.equal(await code(status()), 'STATUS_UNAVAILABLE');
      runtime.orderReader = { readCustomerOrder: input => new Promise(r => setTimeout(() => r(real.readCustomerOrder(input)), 600)) };
      assert.equal(await code(status()), 'STATUS_UNAVAILABLE');
      runtime.orderReader = { readCustomerOrder: async input => ({ ...(await real.readCustomerOrder(input)), asOf: new Date(Date.now() - 120000) }) };
      assert.equal(await code(status()), 'STATUS_UNAVAILABLE');
      const inbound = await cs.handleInboundCommand(own.principal, { inboundKey: randomUUID(), text: 'ORDER', command: { op: 'ORDER', orderNumber: so.orderNumber } });
      assert.equal((await db.collection('cs_outbox').findOne({ _id: inbound.reply.deliveryId })).payload.template, 'status_unavailable');
    } finally { runtime.orderReader = real; }
    assert.equal((await status()).publicStage, 'SHIPPED');
  });

  await t.test('revoked binding is rejected before any read', async () => {
    const real = runtime.orderReader;
    let calls = 0;
    runtime.orderReader = { readCustomerOrder: input => { calls++; return real.readCustomerOrder(input); } };
    try {
      const restore = await setRoles(a, ['owner', 'csFixtureAdmin']);
      try { await cs.revokeBinding(await scopeOf(alpha), { plantId: a.plantId, bindingId: own.bindingId, expectedVersion: 1 }); } finally { await restore(); }
      assert.equal(await code(status()), 'DENIED');
      assert.equal(calls, 0);
    } finally { runtime.orderReader = real; }
  });
});
