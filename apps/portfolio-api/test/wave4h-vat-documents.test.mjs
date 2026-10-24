import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';
const fixture = createRequire(import.meta.url)('../../../packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js');
const VAT = 'FIXTURE_VAT_11_V1';

test('Wave4h canonical VAT quote/invoice PDFs, partial6/4 and historical replay after gross settlement', async t => {
  const h = await startOwned(t), { ok, db } = h;
  const post = (path, body) => h.req(path, body, h.alpha);
  const account = await ok('/crm/accounts', { name: 'Synthetic canonical VAT customer' }, 201);
  const canonical = fixture.e01ManufacturingFixture || fixture;
  const revisions = canonical.quotation.revisions;
  const content = r => ({ expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: VAT, roundingPolicy: 'LINE_HALF_UP', lines: r.lines.map(l => ({ description: canonical.inquiry.lines[0].description, quantity: l.quoted_qty, unitPrice: l.unit_price, uom: l.uom, currency: canonical.quotation.currency })) });
  const triple = r => [r.netAmount, r.taxAmount, r.grossAmount];
  const q = await ok('/commercial/quotes', { accountId: account._id, ...content(revisions[0]) }, 201);
  assert.deepEqual(triple(q.revisions[0]), ['128000.00', '14080.00', '142080.00']);
  await ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 1, revision: 1 });
  const revised = await ok(`/commercial/quotes/${q._id}/revisions`, { expectedVersion: 2, ...content(revisions[1]) });
  assert.deepEqual(triple(revised.revisions[1]), ['122500.00', '13475.00', '135975.00']);
  assert.deepEqual(triple(revised.approvals[0].snapshot), ['128000.00', '14080.00', '142080.00']);
  assert.equal((await post(`/commercial/quotes/${q._id}/accept`, { expectedVersion: 3, revision: 1 })).error.code, 'STALE_REVISION');
  await ok(`/commercial/quotes/${q._id}/approve`, { expectedVersion: 3, revision: 2 });
  await ok(`/commercial/quotes/${q._id}/accept`, { expectedVersion: 4, revision: 2 });
  const conversion = { expectedVersion: 5, revision: 2, idempotencyKey: randomUUID() };
  const so = await ok(`/commercial/quotes/${q._id}/convert`, conversion);
  assert.deepEqual(triple(so.snapshot), ['122500.00', '13475.00', '135975.00']);
  assert.equal(so.snapshot.total, '135975.00');
  assert.equal(so.snapshot.taxPolicyVersion, 1);
  assert.equal(so.snapshot.taxRate, '0.11');
  assert.deepEqual(await ok(`/commercial/quotes/${q._id}/convert`, conversion), so);
  const repair = await ok('/repair/cases', { accountId: account._id, serial: 'SYN-VAT-REPAIR', condition: 'Synthetic boundary', currency: 'USD', idempotencyKey: randomUUID() }, 201);
  await ok(`/repair/cases/${repair._id}/diagnostic-authorize`, { expectedVersion: 1, feeCap: '100.00', evidence: 'Synthetic authorization', idempotencyKey: randomUUID() });
  await ok(`/repair/cases/${repair._id}/teardown`, { expectedVersion: 2, findings: [{ component: 'Housing', disposition: 'REPAIR' }], evidence: 'Synthetic teardown', idempotencyKey: randomUUID() });
  const repairBefore = await db.collection('repairCases').findOne({ _id: repair._id });
  const repairScope = await post(`/repair/cases/${repair._id}/scope`, { expectedVersion: 3, quoteId: q._id, revision: 2, depositRequired: '0.00', evidence: 'Synthetic unsupported tax scope', idempotencyKey: randomUUID() });
  // Converted quotes are already denied; a separate approved VAT quote tests the unsupported repair boundary.
  assert.equal(repairScope.status, 409);
  const rq = await ok('/commercial/quotes', { accountId: account._id, ...content(revisions[1]) }, 201);
  await ok(`/commercial/quotes/${rq._id}/approve`, { expectedVersion: 1, revision: 1 });
  assert.equal((await post(`/repair/cases/${repair._id}/scope`, { expectedVersion: 3, quoteId: rq._id, revision: 1, depositRequired: '0.00', evidence: 'Synthetic unsupported tax scope', idempotencyKey: randomUUID() })).error.code, 'TAX_POLICY_UNSUPPORTED');
  assert.deepEqual(await db.collection('repairCases').findOne({ _id: repair._id }), repairBefore);
  const plan = await ok('/manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', quantities: ['6', '4'], idempotencyKey: randomUUID() }, 201);
  const { receipt } = await orderWithStock(h, { receiptQuantity: '20', reserve: null });
  const shipments = [];
  for (const wo of plan.workOrders) {
    const path = `/manufacturing/work-orders/${wo._id}`;
    await ok(`${path}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Bounded monetary fixture production' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: randomUUID() });
    await ok(`${path}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: wo.quantity, scrapQuantity: '0', uom: 'UN', evidence: 'Synthetic monetary fixture', idempotencyKey: randomUUID() });
    await ok(`${path}/qc`, { expectedVersion: 3, acceptedQuantity: wo.quantity, rejectedQuantity: '0', uom: 'UN', evidence: 'Synthetic fixture QC', idempotencyKey: randomUUID() });
    shipments.push(await ok('/fulfillment/shipments', { salesOrderId: so._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: wo.quantity }], reference: 'Synthetic E01 monetary slice', idempotencyKey: randomUUID() }, 201));
  }
  const names = ['fulfillmentInvoices', 'fulfillmentTallies', 'fulfillmentKeys', 'fulfillmentAudit', 'fulfillmentOutbox', 'fulfillmentPayments', 'documentIntents', 'documentAudit', 'documentOutbox', 'salesOrders', 'quotes'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  const invoiceBody = s => ({ salesOrderId: so._id, expectedVersion: 1, lines: [{ shipmentId: s._id, quantity: s.quantity }], idempotencyKey: randomUUID() });
  const body = invoiceBody(shipments[0]);
  for (const name of ['fulfillmentAudit', 'fulfillmentOutbox']) {
    const before = await snapshot();
    await db.command({ collMod: name, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post('/fulfillment/invoices', body)).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await db.command({ collMod: name, validator: {} }); }
  }
  const raced = await Promise.all([post('/fulfillment/invoices', body), post('/fulfillment/invoices', body)]);
  assert.deepEqual(raced.map(r => r.status), [201, 201]); assert.deepEqual(raced[0].data, raced[1].data);
  const i1 = raced[0].data;
  assert.deepEqual(triple(i1), ['73500.00', '8085.00', '81585.00']);
  assert.equal(i1.total, '81585.00'); assert.equal(i1.sourceVersion, 1); assert.equal(i1.quoteRevision, 2);
  let entitlement = await ok(`/fulfillment/orders/${so._id}/entitlement`);
  assert.deepEqual(triple(entitlement.authorized), ['122500.00', '13475.00', '135975.00']);
  assert.deepEqual(triple(entitlement.billed), triple(i1));
  assert.deepEqual(triple(entitlement.remaining), ['49000.00', '5390.00', '54390.00']);
  const second = await Promise.all([1, 2].map(() => post('/fulfillment/invoices', invoiceBody(shipments[1]))));
  assert.deepEqual(second.map(r => r.status).sort(), [201, 409]);
  const i2 = second.find(r => r.status === 201).data;
  assert.deepEqual(triple(i2), ['49000.00', '5390.00', '54390.00']);
  entitlement = await ok(`/fulfillment/orders/${so._id}/entitlement`);
  assert.deepEqual(triple(entitlement.remaining), ['0.00', '0.00', '0.00']);
  assert.deepEqual(triple(entitlement.billed), triple(entitlement.authorized));
  assert.equal(entitlement.sourceVersion, 1); assert.equal(entitlement.quoteRevision, 2);
  assert.equal((await h.req(`/fulfillment/orders/${so._id}/entitlement`, undefined, h.beta)).status, 404);
  const storedInvoice = await db.collection('fulfillmentInvoices').findOne({_id:i1._id});
  for(const update of [{taxPolicy:'UNKNOWN'},{taxPolicyVersion:2},{'lines.0.rounding.afterTaxAmount':'999.00'}]) {
    await db.collection('fulfillmentInvoices').updateOne({_id:i1._id},{$set:update});
    const before = await snapshot();
    assert.equal((await post('/documents/issues',{kind:'invoice',sourceId:i1._id,sourceVersion:1})).status,422);
    assert.deepEqual(await snapshot(),before);
    await db.collection('fulfillmentInvoices').replaceOne({_id:i1._id},storedInvoice);
  }
  const issued = [];
  for (const [kind, sourceId, sourceVersion, gross] of [['quote', q._id, 1, '142080.00'], ['quote', q._id, 2, '135975.00'], ['invoice', i1._id, 1, '81585.00'], ['invoice', i2._id, 1, '54390.00']]) {
    const body = { kind, sourceId, sourceVersion };
    const source = await ok(`/documents/sources/${kind}/${sourceId}?sourceVersion=${sourceVersion}`);
    assert.equal(source.schemaVersion,2); assert.equal(source.template.version,3); assert.equal(source.grossAmount,gross);
    const results=await Promise.all([ok('/documents/issues',body),ok('/documents/issues',body)]);
    assert.deepEqual(results[0],results[1]); const record=results[0];
    assert.equal(record.snapshot.contentHash,source.contentHash);
    assert.deepEqual(await ok(`/documents/issues/${record._id}`),record);
    assert.equal((await h.req(`/documents/issues/${record._id}`,undefined,h.beta)).status,404);
    const pdf=await h.raw(`/documents/issues/${record._id}/pdf`); assert.equal(pdf.status,200); const bytes=Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0,4).toString(),'%PDF');
    issued.push({body,record,bytes});
  }
  assert.equal(await db.collection('documentIntents').countDocuments({state:'READY'}),4);
  assert.equal(await db.collection('documentIssues').countDocuments(),4);
  assert.equal(await db.collection('documentAudit').countDocuments(),4);
  assert.equal(await db.collection('documentOutbox').countDocuments(),4);
  const payment = { accountId: account._id, currency: 'USD', reference: 'Synthetic canonical settlement', amount: '135975.00', allocations: [i1, i2].map(i => ({ invoiceId: i._id, expectedVersion: 1, amount: i.total })), idempotencyKey: randomUUID() };
  for (const name of ['fulfillmentAudit', 'fulfillmentOutbox']) {
    const before = await snapshot();
    await db.command({ collMod: name, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
    try { assert.equal((await post('/fulfillment/payments', payment)).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await db.command({ collMod: name, validator: {} }); }
  }
  const paymentRace = await Promise.all([post('/fulfillment/payments', payment), post('/fulfillment/payments', payment)]);
  assert.deepEqual(paymentRace.map(r => r.status), [201, 201]); assert.deepEqual(paymentRace[0].data, paymentRace[1].data);
  const paid = paymentRace[0].data;
  assert.deepEqual(await ok('/fulfillment/payments', payment, 201), paid);
  for (const invoice of [i1, i2]) {
    const stored = await ok(`/fulfillment/invoices/${invoice._id}`);
    assert.deepEqual(triple(stored), triple(invoice)); assert.deepEqual(stored.lines, invoice.lines);
    assert.deepEqual([stored.status, stored.outstandingAmount, stored.paidAmount], ['PAID', '0.00', invoice.total]);
  }
  assert.deepEqual(await ok('/fulfillment/invoices', body, 201), i1);
  const immutable = await snapshot();
  assert.equal((await post(`/commercial/quotes/${q._id}/revisions`, { expectedVersion: 6, ...content(revisions[0]) })).error.code, 'ALREADY_CONVERTED');
  assert.equal((await post('/fulfillment/invoices', { ...invoiceBody(shipments[0]), taxPolicy: 'NO_TAX' })).status, 400);
  assert.deepEqual(await snapshot(), immutable);
  for(const prior of issued) {
    assert.deepEqual(await ok('/documents/issues',prior.body),prior.record);
    assert.deepEqual(Buffer.from(await (await h.raw(`/documents/issues/${prior.record._id}/pdf`)).arrayBuffer()),prior.bytes);
  }

});