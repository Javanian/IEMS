import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

const key = () => randomUUID();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
const reason = 'Synthetic owner catalog identity evidence';
const command = body => ({ reason, idempotencyKey: key(), ...body });
const line = (item, overrides = {}) => ({ description: 'Commercial prose intentionally differs from catalog', quantity: item.content.trackingPolicy === 'SERIAL' ? '2.000' : '1.250', uom: item.content.uom, unitPrice: '3.01', currency: 'USD', catalogItem: { itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision }, ...overrides });
const body = (account, lines) => ({ schema: 'CATALOG_QUOTE_V1', accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines, idempotencyKey: key() });
async function item(h, values = {}) {
  const draft = await h.ok('/inventory-master/items', command({ expectedVersion: 1, code: `OWN-${key().slice(0, 8).toUpperCase()}`, description: 'Owner immutable actual master', uom: 'UN', kind: 'MANUFACTURED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'SERIAL', ...values }), 201);
  return h.ok(`/inventory-master/items/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: draft.currentRevision }));
}
async function snapshot(h) {
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  const result = {};
  for (const name of names) result[name] = await h.db.collection(name).find({}).sort({ _id: 1 }).toArray();
  return result;
}
function withReplayAuthorization(before, h) {
  const expected = { ...before }, member = h.seeded[0];
  const tokenHash = createHash('sha256').update(h.alpha.slice('portfolio_session='.length)).digest('hex');
  const plant = before.plants.find(row => row._id === member.plantId);
  const targets = { users: member.userId, memberships: member.membershipId, tenants: member.tenantId, plants: member.plantId, legalEntities: plant.legalEntityId, sessions: before.sessions.find(row => row.tokenHash === tokenHash)?._id };
  for (const [collection, target] of Object.entries(targets)) {
    const rows = before[collection].filter(row => row._id === target);
    assert.equal(rows.length, 1, `one actual replay authority ${collection}`);
    expected[collection] = before[collection].map(row => row._id === target ? { ...row, crmFence: (row.crmFence || 0) + 1 } : row);
  }
  return expected;
}
async function deny(h, path, payload, status, code) {
  const before = await snapshot(h), response = await h.req(path, payload, h.alpha);
  assert.equal(response.status, status, JSON.stringify(response)); assert.equal(response.error.code, code);
  assert.deepEqual(await snapshot(h), before, `${path} denial mutated data`);
}
async function change(h, collection, row, mutate, effect) {
  const replacement = structuredClone(row); mutate(replacement);
  await h.db.collection(collection).replaceOne({ _id: row._id }, replacement);
  try { return await effect(); } finally { await h.db.collection(collection).replaceOne({ _id: row._id }, row); }
}
async function advance(h, quote, action) {
  const payload = { expectedVersion: quote.version, revision: quote.revisions.at(-1).number, idempotencyKey: key() };
  return { data: await h.ok(`/commercial/quotes/${quote._id}/${action}`, payload), payload };
}

test('Explicit catalog quote identity through real native SO', async t => {
  const h = await startOwned(t), account = await h.ok('/crm/accounts', { name: 'Owner catalog customer' }, 201);
  const serial = await item(h), lot = await item(h, { kind: 'PURCHASED', trackingPolicy: 'LOT', uom: 'KG' });
  let quote, order, convertedPayload, createBody;

  await t.test('typed create/revise/approve/accept/convert freezes exact approved binding without stock effects', async () => {
    createBody = body(account, [line(serial), line(lot)]);
    quote = await h.ok('/commercial/quotes', createBody, 201);
    assert.equal(quote.revisions[0].total, '9.78');
    assert.equal(quote.revisions[0].lines[0].description, createBody.lines[0].description);
    assert.equal(quote.revisions[0].lines[0].catalogBinding.itemId, serial._id);
    assert.equal(quote.revisions[0].lines[0].catalogBinding.itemSnapshot.content.description, serial.content.description);
    const revised = { ...createBody, expectedVersion: quote.version, lines: [line(serial, { description: 'Approved customer wording revision two' }), line(lot)], idempotencyKey: key() };
    delete revised.accountId;
    quote = await h.ok(`/commercial/quotes/${quote._id}/revisions`, revised);
    quote = (await advance(h, quote, 'approve')).data;
    quote = (await advance(h, quote, 'accept')).data;
    const result = await advance(h, quote, 'convert'); order = result.data; convertedPayload = result.payload;
    assert.equal(order.schema, 'CATALOG_SALES_ORDER_V1');
    assert.deepEqual(order.snapshot, quote.approvals.at(-1).snapshot);
    assert.equal(order.catalogEntitlement.stockDispatchAllowed, false);
    for (const name of ['warehouseReceipts', 'warehouseReservations', 'manufacturingWorkOrders', 'fulfillmentShipments', 'fulfillmentInvoices']) assert.equal(await h.db.collection(name).countDocuments(), 0);
    const before = await snapshot(h);
    await h.ok(`/commercial/quotes/${quote._id}`); await h.ok(`/commercial/orders/${order._id}`); await h.ok('/commercial/quotes?limit=1'); await h.ok('/commercial/orders?limit=1');
    assert.deepEqual(await snapshot(h), before, 'catalog reads wrote authority fences');
  });

  await t.test('malformed bindings, wrong UOM, fractional SERIAL, mixed lines and legacy retrofit are refused atomically', async () => {
    await deny(h, '/commercial/quotes', body(account, [line(serial, { quantity: '1.000001' })]), 400, 'SERIAL_QUANTITY_REQUIRED');
    await deny(h, '/commercial/quotes', body(account, [line(serial, { uom: 'KG' })]), 400, 'ITEM_UOM_MISMATCH');
    const plain = { description: 'Unbound', quantity: '1', unitPrice: '1.00', currency: 'USD', uom: 'UN' };
    await deny(h, '/commercial/quotes', body(account, [line(serial), plain]), 400, 'INVALID_LINE');
    const { schema, idempotencyKey, ...legacyBody } = body(account, [plain]);
    const legacy = await h.ok('/commercial/quotes', legacyBody, 201);
    await deny(h, `/commercial/quotes/${legacy._id}/revisions`, { ...body(account, [line(serial)]), expectedVersion: legacy.version }, 400, 'QUOTE_COHORT_CONFLICT');
  });

  await t.test('historical replay survives actual item revision while fresh transition fails current-use authority', async () => {
    const freshItem = await item(h), payload = body(account, [line(freshItem)]), draft = await h.ok('/commercial/quotes', payload, 201);
    await h.ok(`/inventory-master/items/${freshItem._id}/revisions`, command({ expectedVersion: freshItem.version, ...freshItem.content, description: 'Actual newer draft master' }));
    const read = await h.ok(`/commercial/quotes/${draft._id}`);
    assert.equal(read.catalogEntitlement.currentEligible, false);
    const before = await snapshot(h), replay = await h.ok('/commercial/quotes', payload, 201);
    assert.deepEqual(replay.revisions, draft.revisions); assert.equal(replay.catalogEntitlement.currentEligible, false);
    assert.deepEqual(await snapshot(h), withReplayAuthorization(before, h), 'successful replay permits exactly one actual authorization fence increment; domain/master/stock evidence is unchanged');
    await deny(h, `/commercial/quotes/${draft._id}/approve`, { expectedVersion: draft.version, revision: 1, idempotencyKey: key() }, 409, 'QUOTE_ITEM_CHANGED');
    const originalItem = await item(h), originalBody = body(account, [line(originalItem)]), original = await h.ok('/commercial/quotes', originalBody, 201);
    const replacementBody = { ...body(account, [line(serial)]), expectedVersion: original.version };
    await h.ok(`/commercial/quotes/${original._id}/revisions`, replacementBody);
    await h.ok(`/inventory-master/items/${originalItem._id}/revisions`, command({ expectedVersion: originalItem.version, ...originalItem.content, description: 'Actual withdrawal of R1 item through a successor draft' }));
    const current = await h.ok(`/commercial/quotes/${original._id}`);
    assert.equal(current.catalogEntitlement.currentEligible, true);
    assert.equal(current.catalogEntitlement.lines[0].itemId, serial._id);
    const beforeHistoricalReplay = await snapshot(h), historical = await h.ok('/commercial/quotes', originalBody, 201);
    assert.deepEqual(historical.revisions, original.revisions);
    assert.equal(historical.catalogEntitlement.lines[0].itemId, originalItem._id);
    assert.equal(historical.catalogEntitlement.currentEligible, false);
    assert.deepEqual(await snapshot(h), withReplayAuthorization(beforeHistoricalReplay, h));
  });

  await t.test('self-rehashed durable replay result cannot replace immutable event content', async () => {
    const row = await h.db.collection('quoteCatalogKeys').findOne({ key: createBody.idempotencyKey });
    await change(h, 'quoteCatalogKeys', row, replacement => {
      replacement.result.revisions[0].lines[0].quantity = '999'; replacement.resultHash = digest(replacement.result);
    }, () => deny(h, '/commercial/quotes', createBody, 409, 'QUOTE_SOURCE_INVALID'));
    for (const mutate of [replacement => { replacement.result = null; }, replacement => { delete replacement.result; }, replacement => { replacement.result = []; }]) {
      await change(h, 'quoteCatalogKeys', row, replacement => { mutate(replacement); replacement.resultHash = digest(replacement.result); }, () => deny(h, '/commercial/quotes', createBody, 409, 'QUOTE_SOURCE_INVALID'));
    }
    const current = await h.db.collection('quotes').findOne({ _id: quote._id });
    await change(h, 'quotes', current, replacement => { delete replacement.schema; replacement.revisions = 'malformed'; }, () => deny(h, `/commercial/quotes/${quote._id}`, undefined, 409, 'QUOTE_SOURCE_INVALID'));
  });

  await t.test('approval, immutable old master evidence and native SO snapshot corruption fail closed', async () => {
    const current = await h.db.collection('quotes').findOne({ _id: quote._id });
    await change(h, 'quotes', current, row => { row.approvals[0].snapshot.lines[0].quantity = '88'; }, () => deny(h, `/commercial/quotes/${quote._id}`, undefined, 409, 'QUOTE_SOURCE_INVALID'));
    const source = await h.db.collection('inventoryItemRevisions').findOne({ subjectId: serial._id, revision: 1 });
    await change(h, 'inventoryItemRevisions', source, row => { row.recordedBy = randomUUID(); }, () => deny(h, `/commercial/quotes/${quote._id}/convert`, convertedPayload, 409, 'QUOTE_SOURCE_INVALID'));
    const stored = await h.db.collection('salesOrders').findOne({ _id: order._id });
    await change(h, 'salesOrders', stored, row => { delete row.schema; delete row.snapshot.schema; delete row.snapshot.lines[0].catalogBinding; }, () => deny(h, `/commercial/orders/${order._id}`, undefined, 409, 'QUOTE_SOURCE_INVALID'));
  });

  await t.test('typed order never escapes unsupported legacy planning/reservation/dispatch even with markers removed', async () => {
    const legacy = await orderWithStock(h, { reserve: '0.7' });
    const legacyConversion = await h.db.collection('quoteConversions').findOne({ orderId: legacy.so._id });
    await deny(h, '/commercial/quotes', { ...body(account, [line(serial)]), idempotencyKey: legacyConversion.key }, 409, 'IDEMPOTENCY_CONFLICT');
    const beforeLegacyReplay = await snapshot(h);
    assert.deepEqual(await h.ok(`/commercial/quotes/${legacy.so.quoteId}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: legacyConversion.key }), legacy.so);
    assert.deepEqual(await snapshot(h), withReplayAuthorization(beforeLegacyReplay, h));
    let candidate = await h.ok('/commercial/quotes', body(account, [line(serial)]), 201);
    candidate = (await advance(h, candidate, 'approve')).data; candidate = (await advance(h, candidate, 'accept')).data;
    await deny(h, `/commercial/quotes/${candidate._id}/convert`, { expectedVersion: candidate.version, revision: 1, idempotencyKey: legacyConversion.key }, 409, 'IDEMPOTENCY_CONFLICT');
    const reserve = { expectedVersion: 4, idempotencyKey: key(), salesOrderId: order._id, accountId: account._id, lineIndex: 1, quantity: '0.1', uom: 'KG' };
    await deny(h, `/warehouse/receipts/${legacy.receipt._id}/reserve`, reserve, 409, 'CATALOG_ORDER_UNSUPPORTED');
    await deny(h, '/manufacturing/work-orders', { expectedVersion: 1, idempotencyKey: key(), salesOrderId: order._id, lineIndex: 0, quantities: ['1'], uom: 'UN' }, 409, 'CATALOG_ORDER_UNSUPPORTED');
    await deny(h, '/fulfillment/shipments', { expectedVersion: 1, idempotencyKey: key(), salesOrderId: order._id, lineIndex: 1, uom: 'KG', reference: 'Synthetic forbidden catalog dispatch', sources: [{ sourceType: 'RESERVATION', sourceId: legacy.reservation._id, quantity: '0.1' }] }, 409, 'CATALOG_ORDER_UNSUPPORTED');
    const stored = await h.db.collection('salesOrders').findOne({ _id: order._id });
    await change(h, 'salesOrders', stored, row => { delete row.schema; delete row.snapshot.schema; row.snapshot.lines.forEach(l => { delete l.catalogBinding; }); }, () => deny(h, `/warehouse/receipts/${legacy.receipt._id}/reserve`, { ...reserve, idempotencyKey: key() }, 409, 'QUOTE_SOURCE_INVALID'));
    const shipment = await h.ok('/fulfillment/shipments', { expectedVersion: 1, idempotencyKey: key(), salesOrderId: legacy.so._id, lineIndex: 0, uom: 'KG', reference: 'Owner actual legacy shipment', sources: [{ sourceType: 'RESERVATION', sourceId: legacy.reservation._id, quantity: '0.1' }] }, 201);
    const invoice = await h.ok('/fulfillment/invoices', { salesOrderId: legacy.so._id, expectedVersion: 1, lines: [{ shipmentId: shipment._id, quantity: '0.1' }], idempotencyKey: key() }, 201);
    const payment = { accountId: legacy.account._id, amount: invoice.total, currency: 'USD', reference: 'Owner actual legacy settlement', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: invoice.total }], idempotencyKey: key() };
    await h.ok('/fulfillment/payments', payment, 201);
    const paid = await h.db.collection('fulfillmentInvoices').findOne({ _id: invoice._id });
    await change(h, 'fulfillmentInvoices', paid, row => { row.salesOrderId = order._id; }, async () => {
      await deny(h, '/fulfillment/payments', payment, 409, 'CATALOG_ORDER_UNSUPPORTED');
      await deny(h, '/fulfillment/payments', { ...payment, idempotencyKey: key() }, 409, 'CATALOG_ORDER_UNSUPPORTED');
    });
  });

  await t.test('outbox failure rolls conversion and every item/auth fence back before historical retry', async () => {
    let draft = await h.ok('/commercial/quotes', body(account, [line(serial)]), 201);
    draft = (await advance(h, draft, 'approve')).data; draft = (await advance(h, draft, 'accept')).data;
    const payload = { expectedVersion: draft.version, revision: 1, idempotencyKey: key() };
    const original = h.db.collection.bind(h.db);
    const before = await snapshot(h);
    h.db.collection = (name, ...args) => { const collection = original(name, ...args); if (name === 'commercialOutbox') collection.insertOne = async () => { throw new Error('OWNER_INJECTED_OUTBOX_FAILURE'); }; return collection; };
    try { assert.equal((await h.req(`/commercial/quotes/${draft._id}/convert`, payload, h.alpha)).status, 500); }
    finally { h.db.collection = original; }
    assert.deepEqual(await snapshot(h), before);
    assert.equal((await h.ok(`/commercial/quotes/${draft._id}/convert`, payload)).schema, 'CATALOG_SALES_ORDER_V1');
  });

  await t.test('revoked conversion permission blocks retained historical key before replay', async () => {
    const restore = await h.setRoles(h.seeded[0], ['quoteReader']);
    try { await deny(h, `/commercial/quotes/${quote._id}/convert`, convertedPayload, 403, 'SCOPE_DENIED'); }
    finally { await restore(); }
  });

  await t.test('selective prefix options hydrate exact IDs and preserve legacy nonentitlement', async () => {
    const result = await h.req(`/commercial/catalog-items?q=${serial.code.toLowerCase()}&limit=1`, undefined, h.alpha);
    assert.equal(result.status, 200); assert.equal(result.data[0]._id, serial._id); assert.equal(result.data[0].eligible, true);
    assert.equal((await h.ok(`/commercial/catalog-items/${lot._id}`)).content.trackingPolicy, 'LOT');
    const owner = serial.ownerLegalEntityId;
    const plan = await h.db.collection('catalogOptionSearch').find({ tenantId: serial.tenantId, plantId: serial.plantId, type: 'items', ownerLegalEntityId: owner, quoteEligible: true, prefixes: 'zzzz-no-such-prefix' }).hint('quote_catalog_option_prefixes').sort({ _id: 1 }).limit(2).explain('executionStats');
    assert.equal(plan.executionStats.nReturned, 0); assert.equal(plan.executionStats.totalDocsExamined, 0); assert.ok(plan.executionStats.totalKeysExamined <= 1);
  });
});
