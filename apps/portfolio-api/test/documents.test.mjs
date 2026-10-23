import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

async function quote(h) {
  const account = await h.ok('/crm/accounts', { name: 'Document customer' }, 201);
  const row = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Exact repair', quantity: '1.250000', uom: 'EA', unitPrice: '999999999999999999.001', currency: 'KWD' }] }, 201);
  return row;
}

test('document HTTP builds only approved server snapshots and publishes one authorized issue', { timeout: 120000 }, async t => {
  const h = await startOwned(t);
  console.log(JSON.stringify({ ownedDatabase: h.db.databaseName, marker: (await h.db.collection('ownedRun').findOne())._id }));
  const q = await quote(h), body = { kind: 'quote', sourceId: q._id, sourceVersion: 1 };
  assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 409);
  await h.ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  const source = await h.ok(`/documents/sources/quote/${q._id}?sourceVersion=1`);
  assert.equal(source.lines[0].quantity, '1.250000');
  assert.equal(source.total, '1249999999999999998.751');
  assert.equal((await h.req('/documents/issues', { ...body, snapshot: source }, h.alpha)).status, 400);
  assert.equal((await h.req('/documents/issues', body, h.beta)).status, 404);
  const restore = await h.setRoles(h.seeded[0], ['documentIssuer']);
  try { assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 403); }
  finally { await restore(); }
  const results = await Promise.all(Array.from({ length: 6 }, () => h.req('/documents/issues', body, h.alpha)));
  assert.deepEqual(results.map(r => r.status), Array(6).fill(200), JSON.stringify(results));
  for (const result of results) assert.deepEqual(result.data, results[0].data);
  const record = results[0].data;
  assert.deepEqual(await h.ok(`/documents/issues/${record._id}`), record);
  assert.equal((await h.req(`/documents/issues/${record._id}`, undefined, h.beta)).status, 404);
  assert.equal(await h.db.collection('documentIntents').countDocuments({ state: 'READY' }), 1);
  assert.equal(await h.db.collection('documentAudit').countDocuments(), 1);
  assert.equal(await h.db.collection('documentOutbox').countDocuments(), 1);
  assert.deepEqual(await h.ok('/documents/issues', body), record);
  const pdf = await h.raw(`/documents/issues/${record._id}/pdf`);
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const restoreReader = await h.setRoles(h.seeded[0], ['documentReader']);
  try { assert.equal((await h.req(`/documents/issues/${record._id}`, undefined, h.alpha)).status, 403); }
  finally { await restoreReader(); }
});

test('document finalization failure remains private and authorized replay repairs one audit/outbox', { timeout: 120000 }, async t => {
  const h = await startOwned(t), q = await quote(h);
  await h.ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  const body = { kind: 'quote', sourceId: q._id, sourceVersion: 1 };
  await h.db.createCollection('documentOutbox', { validator: { forbidden: { $exists: true } } });
  assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 500);
  const intent = await h.db.collection('documentIntents').findOne();
  assert.equal(intent.state, 'PREPARED');
  assert.equal(await h.db.collection('documentAudit').countDocuments(), 0);
  assert.equal((await h.req(`/documents/issues/${intent._id}`, undefined, h.alpha)).status, 404);
  await h.db.command({ collMod: 'documentOutbox', validator: {} });
  const restore = await h.setRoles(h.seeded[0], ['documentReader', 'quoteReader']);
  try {
    assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 403);
    assert.equal((await h.req(`/documents/issues/${intent._id}`, undefined, h.alpha)).status, 404);
    assert.equal(await h.db.collection('documentAudit').countDocuments(), 0);
  } finally { await restore(); }
  const results = await Promise.all(Array.from({ length: 4 }, () => h.req('/documents/issues', body, h.alpha)));
  assert.deepEqual(results.map(r => r.status), [200, 200, 200, 200], JSON.stringify(results));
  assert.equal(results[0].data._id, intent._id);
  assert.equal(await h.db.collection('documentAudit').countDocuments(), 1);
  assert.equal(await h.db.collection('documentOutbox').countDocuments(), 1);
});

test('document session revocation races real issue commits without unauthorized replay or orphan publication', { timeout: 120000 }, async t => {
  const h = await startOwned(t), q = await quote(h);
  await h.ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  const body = { kind: 'quote', sourceId: q._id, sourceVersion: 1 };
  const results = await Promise.all([
    ...Array.from({ length: 6 }, () => h.req('/documents/issues', body, h.alpha)),
    h.req('/session/logout', {}, h.alpha)
  ]);
  for (const result of results) assert.ok([200, 401].includes(result.status), JSON.stringify(results));
  assert.equal((await h.req('/documents/issues', body, h.alpha)).status, 401);
  const intents = await h.db.collection('documentIntents').find().toArray();
  const ready = intents.filter(i => i.state === 'READY');
  assert.ok(ready.length <= 1);
  assert.equal(await h.db.collection('documentAudit').countDocuments(), ready.length);
  assert.equal(await h.db.collection('documentOutbox').countDocuments(), ready.length);
  if (ready.length) assert.equal((await h.req(`/documents/issues/${ready[0]._id}`, undefined, h.alpha)).status, 401);
  console.log(JSON.stringify({ revocationRaceStatuses: results.map(r => r.status), ready: ready.length, prepared: intents.length - ready.length }));
});

test('document issued PO shipment invoice use real HTTP source workflows and reject changed aliases', { timeout: 120000 }, async t => {
  const h = await startOwned(t), flow = await orderWithStock(h, { orderQuantity: '2', receiptQuantity: '2', reserve: '2' });
  const po = await h.db.collection('purchaseOrders').findOne();
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: flow.so._id, expectedVersion: 1, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: flow.reservation._id, quantity: '1' }], reference: 'Dispatch evidence', idempotencyKey: flow.key() }, 201);
  const invoice = await h.ok('/fulfillment/invoices', { salesOrderId: flow.so._id, expectedVersion: 1, lines: [{ shipmentId: shipment._id, quantity: '1' }], idempotencyKey: flow.key() }, 201);
  for (const [kind, source] of [['purchaseOrder', po], ['shipment', shipment], ['invoice', invoice]]) {
    const body = { kind, sourceId: source._id, sourceVersion: 1 };
    const record = await h.ok('/documents/issues', body);
    assert.equal(record.kind, kind); assert.equal(record.snapshot.sourceId, source._id);
    assert.equal((await h.req(`/documents/issues/${record._id}?plantId=${h.seeded[1].plantId}`, undefined, h.alpha)).status, 403);
  }
});
