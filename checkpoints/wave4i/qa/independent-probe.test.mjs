import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

// Deliberately refuse before loading application, Mongo, or renderer modules.
if (process.env.WAVE4I_QA_HEAVY_TOKEN !== 'lead-granted') {
  throw new Error('WAVE4I_QA_HEAVY_TOKEN=lead-granted required; preparation is syntax-only');
}
const { startOwned } = await import('../../../apps/portfolio-api/test/support/owned-mongo.mjs');
const key = () => randomUUID();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const VAT = 'FIXTURE_VAT_11_V1';
const expiry = () => new Date(Date.now() + 86400000).toISOString();
const effects = ['inquiries', 'quotes', 'inquiryKeys', 'commercialAudit', 'commercialOutbox', 'salesOrders', 'quoteConversions'];

test('independent Wave4i hypotheses — owned disposable Mongo only', async t => {
  const h = await startOwned(t);
  const { db, runtime, seeded, alpha } = h;
  assert.match(db.databaseName, /^portfolio_test_[0-9a-f]{32}$/);
  assert.equal(await db.collection('ownedRun').countDocuments(), 1);
  const ownedMarker = await db.collection('ownedRun').findOne();
  const owned = async () => assert.deepEqual(await db.collection('ownedRun').findOne(), ownedMarker);
  const ok = (...args) => h.ok(...args);
  const post = (path, body) => h.req(path, body, alpha);
  const snapshot = async () => {
    await owned();
    return Promise.all(effects.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  };
  const account = await ok('/crm/accounts', { name: 'Independent Wave4i customer' }, 201);
  const sourceLine = { itemCode: 'QA-ITEM-1', description: 'Independent frozen component', quantity: '1.250000', uom: 'EA', drawingNumber: 'QA-DRAW-1', drawingRevision: 'A' };
  async function review() {
    const inquiry = await ok('/commercial/inquiries', { accountId: account._id, lines: [sourceLine], idempotencyKey: key() }, 201);
    for (const [expectedVersion, toStage] of [[1, 'SUBMITTED'], [2, 'IN_REVIEW']]) {
      await ok(`/commercial/inquiries/${inquiry._id}/stage`, { expectedVersion, toStage, reason: 'Independent QA review', idempotencyKey: key() });
    }
    return inquiry;
  }
  const convertPath = inquiry => `/commercial/inquiries/${inquiry._id}/convert`;
  const convertBody = (inquiry, idempotencyKey = key(), taxPolicy = 'NO_TAX') => ({ expectedVersion: 3, revision: 1, expiresAt: expiry(), taxPolicy, roundingPolicy: 'LINE_HALF_UP', prices: inquiry.revisions[0].lines.map(l => ({ inquiryLineId: l.lineId, unitPrice: '10.00', currency: 'USD' })), idempotencyKey });
  async function conversionCount(inquiry, count) {
    assert.equal(await db.collection('quotes').countDocuments({ inquiryId: inquiry._id }), count);
    for (const name of ['commercialAudit', 'commercialOutbox']) assert.equal(await db.collection(name).countDocuments({ kind: 'inquiry.convert', subjectId: inquiry._id }), count);
    const row = await db.collection('inquiries').findOne({ _id: inquiry._id });
    assert.equal(row.stage, count ? 'QUOTED' : 'IN_REVIEW');
    assert.equal(row.version, count ? 4 : 3);
    assert.equal(row.history.filter(v => v.to === 'QUOTED').length, count);
    if (!count) assert.equal(row.quoteId, undefined);
  }

  await t.test('conversion revocation after first transactional fence rejects fresh and replay with zero effects', async () => {
    const inquiry = await review(), body = convertBody(inquiry);
    async function revokeAtFence(requestBody) {
      const member = await db.collection('memberships').findOne({ _id: seeded[0].membershipId });
      const before = await snapshot(), originalCollection = db.collection;
      let hit = 0;
      db.collection = function (name, ...args) {
        const collection = originalCollection.call(this, name, ...args);
        if (name !== 'sessions') return collection;
        const originalUpdate = collection.findOneAndUpdate.bind(collection);
        collection.findOneAndUpdate = async (...updateArgs) => {
          const result = await originalUpdate(...updateArgs);
          if (updateArgs[2]?.session && hit === 0) {
            hit++;
            await originalCollection.call(db, 'memberships').updateOne({ _id: member._id }, { $set: { roles: [] } });
          }
          return result;
        };
        return collection;
      };
      try {
        const result = await post(convertPath(inquiry), requestBody);
        assert.equal(hit, 1, 'must reach transactional session fence, not merely middleware');
        assert.equal(result.status, 403, JSON.stringify(result));
        assert.deepEqual(await snapshot(), before, 'denied conversion/replay must leave all domain effects unchanged');
      } finally {
        db.collection = originalCollection;
        await db.collection('memberships').replaceOne({ _id: member._id }, member);
      }
    }
    await revokeAtFence(body);
    await conversionCount(inquiry, 0);
    const converted = await ok(convertPath(inquiry), body);
    await conversionCount(inquiry, 1);
    await revokeAtFence(body);
    assert.deepEqual(await ok(convertPath(inquiry), body), converted);
    await conversionCount(inquiry, 1);
  });

  await t.test('same key on different inquiries races to one conversion without orphan effects', async () => {
    const a = await review(), b = await review(), sharedKey = key();
    const bodies = [convertBody(a, sharedKey), convertBody(b, sharedKey)];
    const beforeKeys = await db.collection('inquiryKeys').countDocuments();
    const responses = await Promise.all([post(convertPath(a), bodies[0]), post(convertPath(b), bodies[1])]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winnerIndex = responses.findIndex(r => r.status === 200), loserIndex = 1 - winnerIndex;
    const inquiries = [a, b];
    await conversionCount(inquiries[winnerIndex], 1); await conversionCount(inquiries[loserIndex], 0);
    assert.equal(await db.collection('inquiryKeys').countDocuments(), beforeKeys + 1);
    const receipt = await db.collection('inquiryKeys').findOne({ key: sharedKey });
    assert.equal(receipt.data.inquiryId, inquiries[winnerIndex]._id);
    assert.equal(receipt.data.quoteId, responses[winnerIndex].data.quoteId);
    const before = await snapshot();
    assert.equal((await post(convertPath(inquiries[loserIndex]), bodies[loserIndex])).status, 409);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await ok(convertPath(inquiries[winnerIndex]), bodies[winnerIndex]), responses[winnerIndex].data);
    await ok(convertPath(inquiries[loserIndex]), { ...bodies[loserIndex], idempotencyKey: key() });
    await conversionCount(inquiries[loserIndex], 1);
  });

  await t.test('same inquiry same-key and changed-key races preserve one quote and one receipt', async () => {
    for (const sameKey of [true, false]) {
      const inquiry = await review(), body = convertBody(inquiry);
      const responses = await Promise.all(Array.from({ length: 4 }, () => post(convertPath(inquiry), sameKey ? body : { ...body, idempotencyKey: key() })));
      assert.deepEqual(responses.map(r => r.status).sort(), sameKey ? [200, 200, 200, 200] : [200, 409, 409, 409]);
      assert.equal(new Set(responses.filter(r => r.status === 200).map(r => r.data.quoteId)).size, 1);
      if (sameKey) for (const response of responses) assert.deepEqual(response.data, responses[0].data);
      await conversionCount(inquiry, 1);
      assert.equal(await db.collection('inquiryKeys').countDocuments({ 'data.inquiryId': inquiry._id }), 1);
    }
  });

  await t.test('sourced VAT quote/invoice PDF projection, tamper refusal and historical bytes after settlement', async () => {
    const inquiry = await review(), source = inquiry.revisions[0].lines[0];
    const conversion = convertBody(inquiry, key(), VAT);
    for (const changed of [{ ...conversion, lines: [sourceLine] }, { ...conversion, prices: [{ ...conversion.prices[0], quantity: '99' }] }]) {
      const before = await snapshot();
      assert.equal((await post(convertPath(inquiry), changed)).status, 400);
      assert.deepEqual(await snapshot(), before);
    }
    const { quote } = await ok(convertPath(inquiry), conversion), qpath = `/commercial/quotes/${quote._id}`;
    const q1 = structuredClone(quote.revisions[0]), provenance = q1.lines[0].provenance;
    assert.deepEqual([q1.lines[0].quantity, q1.lines[0].unitPrice, q1.lines[0].uom, q1.lines[0].currency, q1.total], ['1.250000', '10.00', 'EA', 'USD', '13.88']);
    assert.deepEqual(provenance, { inquiryId: inquiry._id, inquiryRevision: 1, inquiryLineId: source.lineId, itemCode: source.itemCode, drawingNumber: source.drawingNumber, drawingRevision: source.drawingRevision });
    const revision = { expectedVersion: 1, expiresAt: conversion.expiresAt, taxPolicy: VAT, roundingPolicy: 'LINE_HALF_UP', lines: q1.lines.map(({ description, quantity, uom, currency, provenance }) => ({ description, quantity, uom, currency, provenance, unitPrice: '12.00' })) };
    for (const change of [{ quantity: '99' }, { description: 'tampered' }, { uom: 'KG' }, { provenance: undefined }, { provenance: { ...provenance, inquiryId: key() } }, { provenance: { ...provenance, itemCode: 'OTHER' } }, { provenance: { ...provenance, drawingRevision: 'B' } }]) {
      const before = await snapshot();
      assert.equal((await post(qpath + '/revisions', { ...revision, lines: [{ ...revision.lines[0], ...change }] })).status, 422);
      assert.deepEqual(await snapshot(), before);
    }
    const preserved = [];
    async function issue(kind, sourceId, sourceVersion) {
      const body = { kind, sourceId, sourceVersion }, record = await ok('/documents/issues', body);
      assert.equal(record.snapshot.schemaVersion, 2);
      assert.equal(record.snapshot.template.version, 3);
      assert.equal(record.snapshot.lines[0].provenance, undefined);
      const response = await h.raw(`/documents/issues/${record._id}/pdf`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
      preserved.push({ body, record: structuredClone(record), bytes, sha256: sha(bytes) });
      return record;
    }
    await ok(qpath + '/approve', { expectedVersion: 1, revision: 1 });
    await issue('quote', quote._id, 1);
    const revised = await ok(qpath + '/revisions', { ...revision, expectedVersion: 2 });
    assert.deepEqual(revised.revisions[0], q1);
    assert.deepEqual(revised.revisions[1].lines[0].provenance, provenance);
    assert.deepEqual([revised.revisions[1].lines[0].quantity, revised.revisions[1].lines[0].unitPrice, revised.revisions[1].total], ['1.250000', '12.00', '16.65']);
    await ok(qpath + '/approve', { expectedVersion: 3, revision: 2 });
    await issue('quote', quote._id, 2);
    await ok(qpath + '/accept', { expectedVersion: 4, revision: 2 });
    const so = await ok(qpath + '/convert', { expectedVersion: 5, revision: 2, idempotencyKey: key() });
    assert.deepEqual(so.snapshot.lines[0].provenance, provenance);
    const vendor = await ok('/procurement/vendors', { name: 'Independent QA vendor' }, 201);
    const pr = await ok('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: sourceLine.description, quantity: '5', uom: 'EA', unitPrice: '12.00', currency: 'USD' }] }, 201);
    await ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
    const po = await ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
    await ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
    const receipt = await ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '5', uom: 'EA', idempotencyKey: key() }, 201);
    await ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'QA inspection', idempotencyKey: key() });
    await ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'QA-BIN', idempotencyKey: key() });
    await ok(`/warehouse/receipts/${receipt._id}/reserve`, { expectedVersion: 3, salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: '0.5', uom: 'EA', idempotencyKey: key() });
    const reservation = await db.collection('warehouseReservations').findOne({ salesOrderId: so._id });
    const shipment = await ok('/fulfillment/shipments', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'EA', reference: 'QA-DN', sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '0.5' }], idempotencyKey: key() }, 201);
    assert.deepEqual(shipment.provenance, provenance);
    const invoice = await ok('/fulfillment/invoices', { salesOrderId: so._id, expectedVersion: 1, lines: [{ shipmentId: shipment._id, quantity: '0.25' }], idempotencyKey: key() }, 201);
    assert.deepEqual(invoice.lines[0].provenance, provenance);
    assert.deepEqual([shipment.quantity, shipment.uom, invoice.lines[0].quantity, invoice.lines[0].uom, invoice.lines[0].unitPrice, invoice.lines[0].currency], ['0.5', 'EA', '0.25', 'EA', '12.00', 'USD']);
    assert.deepEqual([invoice.netAmount, invoice.taxAmount, invoice.grossAmount, invoice.total, invoice.currency], ['3.00', '0.33', '3.33', '3.33', 'USD']);
    const issued = await issue('invoice', invoice._id, 1);
    assert.equal(issued.snapshot.grossAmount, '3.33');
    await ok('/fulfillment/payments', { accountId: account._id, amount: '3.33', currency: 'USD', reference: 'QA settlement', allocations: [{ invoiceId: invoice._id, expectedVersion: 1, amount: '3.33' }], idempotencyKey: key() }, 201);
    const paid = await ok(`/fulfillment/invoices/${invoice._id}`);
    assert.equal(paid.status, 'PAID'); assert.deepEqual(paid.lines, invoice.lines);
    assert.deepEqual((await ok(qpath)).revisions[0], q1);
    // A direct legacy NO_TAX quote remains lineage-free and issuable.
    const direct = await ok('/commercial/quotes', { accountId: account._id, expiresAt: expiry(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Legacy QA', quantity: '1.250000', uom: 'EA', unitPrice: '10.00', currency: 'USD' }] }, 201);
    assert.equal(direct.revisions[0].total, '12.50'); assert.equal(direct.revisions[0].lines[0].provenance, undefined);
    await ok(`/commercial/quotes/${direct._id}/approve`, { expectedVersion: 1, revision: 1 });
    const legacy = await ok('/documents/issues', { kind: 'quote', sourceId: direct._id, sourceVersion: 1 });
    assert.equal(legacy.snapshot.lines[0].provenance, undefined);
    for (const prior of preserved) {
      assert.deepEqual(await ok('/documents/issues', prior.body), prior.record);
      const response = await h.raw(`/documents/issues/${prior.record._id}/pdf`); assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha(bytes), prior.sha256); assert.deepEqual(bytes, prior.bytes);
      t.diagnostic(JSON.stringify({ kind: prior.body.kind, sourceVersion: prior.body.sourceVersion, sha256: prior.sha256 }));
    }
    await owned();
  });
});
