import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp, initialize, seedSynthetic } from '../src/app.mjs';

test('Wave4i owned inquiry lifecycle', async t => {
  const repl = await MongoMemoryReplSet.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: '7.0.14' }, replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128'] }] });
  const client = await new MongoClient(repl.getUri()).connect(), db = client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`), marker = randomUUID();
  await db.collection('ownedRun').insertOne({ _id: marker });
  let server;
  t.after(async () => { if (server) await new Promise(r => server.close(r)); assert.ok(await db.collection('ownedRun').findOne({ _id: marker })); await db.dropDatabase(); await client.close(); await repl.stop(); });
  const runtime = await initialize({ client, db }), password = randomUUID(), seeded = await seedSynthetic(runtime, { password });
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  async function req(path, body, cookie) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const alpha = (await req('/api/session/login', { username: 'alpha.owner', password })).cookie;
  const beta = (await req('/api/session/login', { username: 'beta.owner', password })).cookie;
  const account = (await req('/api/crm/accounts', { name: 'Inquiry customer' }, alpha)).data;
  const line = { itemCode: 'ITEM-1', description: 'Frozen component', quantity: '1.250000', uom: 'EA', drawingNumber: 'DR-01', drawingRevision: 'A' };
  const payload = { accountId: account._id, lines: [line, { ...line, itemCode: 'ITEM-2' }], idempotencyKey: 'inquiry-create-1' };
  const post = (path, body, cookie = alpha) => req('/api/commercial/inquiries' + path, body, cookie);
  let inquiry;
  await t.test('creates numbered exact immutable inquiry lines with durable replay', async () => {
    const r = await post('', payload); assert.equal(r.status, 201, JSON.stringify(r)); inquiry = r.data;
    assert.equal(inquiry.stage, 'DRAFT'); assert.equal(inquiry.version, 1); assert.equal(inquiry.revisions[0].number, 1);
    assert.equal(inquiry.revisions[0].lines[0].quantity, line.quantity); assert.match(inquiry.revisions[0].lines[0].lineId, /^[0-9a-f-]{36}$/);
    assert.deepEqual((await post('', payload)).data, inquiry);
    assert.equal((await post('', { ...payload, lines: [line] })).status, 409);
    assert.equal((await post('/' + inquiry._id, undefined, beta)).status, 404);
  });
  await t.test('invalid lines, scope aliases, stale fences and manual QUOTED are rejected', async () => {
    for (const change of [{ quantity: 1 }, { quantity: '0' }, { quantity: '1e2' }, { quantity: '1.1234567' }, { uom: 'ea' }, { drawingRevision: '' }]) {
      assert.equal((await post('', { ...payload, lines: [{ ...line, ...change }], idempotencyKey: randomUUID() })).status, 422);
    }
    assert.equal((await post('', { ...payload, tenant_id: seeded[1].tenantId })).status, 403);
    assert.equal((await post('', { ...payload, idempotencyKey: randomUUID() }, beta)).status, 404);
    assert.equal((await post('/' + inquiry._id + '/stage', { expectedVersion: 99, toStage: 'SUBMITTED', reason: 'Ready', idempotencyKey: randomUUID() })).status, 409);
    assert.equal((await post('/' + inquiry._id + '/stage', { expectedVersion: 1, toStage: 'QUOTED', reason: 'Ready', idempotencyKey: randomUUID() })).status, 422);
    assert.equal((await post('?limit=100', undefined)).data.length, 1);
    assert.equal((await post('?accountId=' + randomUUID(), undefined)).data.length, 0);
  });
  await t.test('revocation fences replay and rollback leaves no effects', async () => {
    const membership = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
    const original = runtime.foundation;
    let revoked = false;
    runtime.foundation = { ...original, authorize: async (...args) => { const result = await original.authorize(...args); if (!revoked && args[1]?.action === 'quote.write') { revoked = true; await db.collection('memberships').updateOne({ _id: membership._id }, { $set: { roles: [] } }); } return result; } };
    assert.equal((await post('', payload)).status, 403);
    runtime.foundation = original;
    await db.collection('memberships').replaceOne({ _id: membership._id }, membership);
    const fresh = { ...payload, idempotencyKey: 'rollback-create-1' };
    for (const collection of ['commercialAudit', 'commercialOutbox']) {
      const before = await db.collection('inquiries').countDocuments();
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try { assert.equal((await post('', fresh)).status, 500); assert.equal(await db.collection('inquiries').countDocuments(), before); assert.equal(await db.collection('inquiryKeys').countDocuments({ key: fresh.idempotencyKey }), 0); }
      finally { await db.command({ collMod: collection, validator: {} }); }
    }
    assert.equal((await post('', fresh)).status, 201);
  });
  await t.test('VAT sourced quote projection issues without losing API provenance', async () => {
    const created = (await post('', { ...payload, idempotencyKey: randomUUID() })).data;
    const path = '/' + created._id;
    await post(path + '/stage', { expectedVersion: 1, toStage: 'SUBMITTED', reason: 'Ready', idempotencyKey: randomUUID() });
    await post(path + '/stage', { expectedVersion: 2, toStage: 'IN_REVIEW', reason: 'Review', idempotencyKey: randomUUID() });
    const body = { expectedVersion: 3, revision: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP', prices: created.revisions[0].lines.map(l => ({ inquiryLineId: l.lineId, unitPrice: '10.00', currency: 'USD' })), idempotencyKey: randomUUID() };
    const results = await Promise.all([post(path + '/convert', body), post(path + '/convert', { ...body, idempotencyKey: randomUUID() })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const q = results.find(r => r.status === 200).data.quote;
    assert.equal(q.revisions[0].total, '27.76');
    await req('/api/commercial/quotes/' + q._id + '/approve', { expectedVersion: 1, revision: 1 }, alpha);
    const issued = await req('/api/documents/issues', { kind: 'quote', sourceId: q._id, sourceVersion: 1 }, alpha);
    assert.equal(issued.status, 200, JSON.stringify(issued));
    assert.equal(issued.data.snapshot.lines[0].provenance, undefined);
    assert.equal((await req('/api/commercial/quotes/' + q._id, undefined, alpha)).data.revisions[0].lines[0].provenance.inquiryId, created._id);
  });
  await t.test('revisions preserve identities, stages freeze history and conversion copies source exactly once', async () => {
    const original = structuredClone(inquiry.revisions[0]);
    const path = '/' + inquiry._id;
    const revisedLines = inquiry.revisions[0].lines.map(l => ({ ...l, drawingRevision: 'B' }));
    let r = await post(path + '/revisions', { expectedVersion: 1, lines: revisedLines, idempotencyKey: 'inquiry-revise-1' });
    assert.equal(r.status, 200, JSON.stringify(r)); inquiry = r.data;
    assert.deepEqual(inquiry.revisions[0], original); assert.equal(inquiry.revisions[1].lines[0].lineId, original.lines[0].lineId);
    for (const [expectedVersion, toStage] of [[2, 'SUBMITTED'], [3, 'IN_REVIEW']]) {
      r = await post(path + '/stage', { expectedVersion, toStage, reason: 'Customer confirmed', idempotencyKey: 'stage-' + toStage });
      assert.equal(r.status, 200, JSON.stringify(r)); inquiry = r.data;
    }
    assert.equal(inquiry.history.length, 2); assert.equal(inquiry.history[0].from, 'DRAFT'); assert.ok(inquiry.history[0].actorId);
    assert.equal((await post(path + '/revisions', { expectedVersion: 4, lines: revisedLines, idempotencyKey: 'frozen-revision' })).status, 409);
    const body = { expectedVersion: 4, revision: 2, expiresAt: new Date(Date.now() + 3600000).toISOString(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', prices: revisedLines.map(l => ({ inquiryLineId: l.lineId, unitPrice: '10.00', currency: 'USD' })), idempotencyKey: 'inquiry-convert-1' };
    for (const collection of ['commercialAudit', 'commercialOutbox']) {
      const before = await db.collection('inquiries').findOne({ _id: inquiry._id });
      await db.command({ collMod: collection, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try {
        assert.equal((await post(path + '/convert', body)).status, 500);
        assert.deepEqual(await db.collection('inquiries').findOne({ _id: inquiry._id }), before);
        assert.equal(await db.collection('quotes').countDocuments({ inquiryId: inquiry._id }), 0);
        assert.equal(await db.collection('inquiryKeys').countDocuments({ key: body.idempotencyKey }), 0);
      } finally { await db.command({ collMod: collection, validator: {} }); }
    }
    const results = await Promise.all(Array.from({ length: 4 }, () => post(path + '/convert', body)));
    assert.deepEqual(results.map(r => r.status), [200,200,200,200]);
    assert.equal(new Set(results.map(r => r.data.quoteId)).size, 1);
    const converted = results[0].data; assert.equal(converted.lineMapping.length, 2);
    assert.equal(converted.quote.revisions[0].lines[0].provenance.drawingRevision, 'B');
    assert.equal(converted.quote.revisions[0].lines[0].quantity, '1.250000');
    assert.equal(await db.collection('quotes').countDocuments({ inquiryId: inquiry._id }), 1);
    assert.equal((await post(path + '/convert', { ...body, idempotencyKey: 'other-conversion' })).status, 409);
    assert.equal((await post(path + '/convert', { ...body, revision: 1 })).status, 409);
    assert.equal((await post(path, undefined)).data.stage, 'QUOTED');
    const q = converted.quote, commercial = (suffix, body) => req('/api/commercial/quotes/' + q._id + suffix, body, alpha);
    const revisionBody = { expectedVersion: 1, expiresAt: body.expiresAt, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: q.revisions[0].lines.map(l => ({ ...l, unitPrice: '12.00' })) };
    let revised = await commercial('/revisions', revisionBody);
    assert.equal(revised.status, 200, JSON.stringify(revised));
    assert.deepEqual(revised.data.revisions[1].lines[0].provenance, q.revisions[0].lines[0].provenance);
    assert.equal((await commercial('/revisions', { ...revisionBody, expectedVersion: 2, lines: revisionBody.lines.map(l => ({ ...l, quantity: '99' })) })).status, 422);
    const approved = await commercial('/approve', { expectedVersion: 2, revision: 2 }); assert.equal(approved.status, 200);
    const doc = await req('/api/documents/issues', { kind: 'quote', sourceId: q._id, sourceVersion: 2 }, alpha);
    assert.equal(doc.status, 200, JSON.stringify(doc));
    assert.equal(doc.data.snapshot.lines[0].provenance, undefined);
    assert.equal((await commercial('/accept', { expectedVersion: 3, revision: 2 })).status, 200);
    const order = await commercial('/convert', { expectedVersion: 4, revision: 2, idempotencyKey: 'sourced-order-key' });
    assert.equal(order.status, 200); assert.deepEqual(order.data.snapshot.lines[0].provenance, q.revisions[0].lines[0].provenance);
    const ok = async (path, body, status = 200) => { const r = await req('/api' + path, body, alpha); assert.equal(r.status, status, JSON.stringify(r)); return r.data; };
    const vendor = await ok('/procurement/vendors', { name: 'Lineage vendor' }, 201);
    const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Frozen component', quantity: '5', uom: 'EA', unitPrice: '12.00', currency: 'USD' }] };
    const pr = await ok('/procurement/requests', { ...content, vendorId: vendor._id }, 201);
    await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
    const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() });
    await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
    const receipt = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '5', uom: 'EA', idempotencyKey: randomUUID() }, 201);
    await ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Inspection', idempotencyKey: randomUUID() });
    await ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'LINEAGE-BIN', idempotencyKey: randomUUID() });
    await ok(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: 3, salesOrderId: order.data._id, accountId: account._id, lineIndex: 0, quantity: '0.5', uom: 'EA', idempotencyKey: randomUUID() });
    const reservation = await db.collection('warehouseReservations').findOne({ salesOrderId: order.data._id });
    const shipment = await ok('/fulfillment/shipments', { salesOrderId: order.data._id, expectedVersion: 1, lineIndex: 0, uom: 'EA', reference: 'LINEAGE-DN', sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '0.5' }], idempotencyKey: randomUUID() }, 201);
    assert.deepEqual(shipment.provenance, q.revisions[0].lines[0].provenance);
    const invoice = await ok('/fulfillment/invoices', { salesOrderId: order.data._id, expectedVersion: 1, lines: [{ shipmentId: shipment._id, quantity: '0.25' }], idempotencyKey: randomUUID() }, 201);
    assert.deepEqual(invoice.lines[0].provenance, shipment.provenance);
    await ok('/documents/issues', { kind: 'invoice', sourceId: invoice._id, sourceVersion: 1 });
    await ok('/fulfillment/payments', { accountId: account._id, amount: invoice.total, currency: 'USD', reference: 'SETTLEMENT', allocations: [{ invoiceId: invoice._id, expectedVersion: 1, amount: invoice.total }], idempotencyKey: randomUUID() }, 201);
    const paid = await db.collection('fulfillmentInvoices').findOne({ _id: invoice._id });
    assert.equal(paid.status, 'PAID'); assert.deepEqual(paid.lines[0].provenance, shipment.provenance);
  });
});
