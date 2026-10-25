import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startOwned, allSnapshot, denied, guardedReplay, makeItem, makeCatalogFixture, typedLine, typedBody, quoteBody, makeQuote, reviseMaster, restoreRow } from './support.mjs';

const root = '/commercial/quotes';
const next = quote => ({ expectedVersion: quote.version, revision: quote.revisions.at(-1).number, idempotencyKey: randomUUID() });
const withoutDerived = row => { const { catalogEntitlement, ...stored } = row; return stored; };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const unchangedNames = ['warehouseReceipts', 'warehouseMovements', 'warehouseReservations', 'catalogStockBalances', 'catalogStockUnits', 'catalogStockMovements', 'catalogMaterialReservations', 'catalogMaterialIssues', 'catalogMaterialConsumptions', 'internalExecutions', 'internalOutputUnits', 'internalCompanyStockReceipts', 'internalCompanyStockUnits', 'companyStockUseHeads', 'companyStockUseUnits', 'companyMaterialReservations', 'companyMaterialIssues', 'companyMaterialConsumptions', 'manufacturingWorkOrders', 'manufacturingAllocated', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments'];
const selectedSnapshot = async h => Object.fromEntries(await Promise.all(unchangedNames.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));

test('independent real HTTP quote catalog entitlement boundaries', async t => {
  const h = await startOwned(t), fixture = await makeCatalogFixture(h);
  const { account, serial, lot, draft, foreign } = fixture;
  let accepted, order, convertBody, originalCreateBody;

  await t.test('explicit LOT and SERIAL binding reaches the exact approved SO without physical stock or execution effects', async () => {
    const before = await selectedSnapshot(h), built = await makeQuote(h, account._id, [serial, lot], { stage: 'ACCEPTED' });
    accepted = built.quote; originalCreateBody = built.body;
    assert.equal(accepted.schema, 'CATALOG_QUOTE_V1');
    assert.equal(accepted.catalogEntitlement.historicalBound, true);
    assert.equal(accepted.catalogEntitlement.currentEligible, true);
    assert.equal(accepted.catalogEntitlement.stockDispatchAllowed, false);
    const revision = accepted.revisions[0];
    for (const [index, item] of [serial, lot].entries()) {
      const line = revision.lines[index], binding = line.catalogBinding;
      assert.equal(Object.hasOwn(line, 'catalogItem'), false);
      assert.equal(binding.itemId, item._id); assert.equal(binding.itemVersion, item.version); assert.equal(binding.itemRevision, item.currentRevision);
      assert.equal(binding.ownerLegalEntityId, item.ownerLegalEntityId); assert.equal(binding.contentHash, item.contentHash);
      assert.equal(binding.itemSnapshot.contentHash, item.contentHash); assert.deepEqual(binding.itemSnapshot.content, item.content);
      assert.equal(Object.hasOwn(binding.itemSnapshot, 'useFence'), false);
      assert.equal(line.quantity, built.body.lines[index].quantity); assert.equal(line.unitPrice, '100.01');
    }
    assert.equal(revision.total, '325.03');
    assert.deepEqual(accepted.approvals[0].snapshot, revision);
    convertBody = next(accepted); order = await h.ok(`${root}/${accepted._id}/convert`, convertBody);
    assert.equal(order.schema, 'CATALOG_SALES_ORDER_V1'); assert.deepEqual(order.snapshot, revision);
    assert.equal(order.catalogEntitlement.stockDispatchAllowed, false);
    assert.deepEqual(await selectedSnapshot(h), before);
    const replay = await guardedReplay(h, () => h.ok(`${root}/${accepted._id}/convert`, convertBody));
    assert.deepEqual(replay, order);
    const createReplay = await guardedReplay(h, () => h.ok(root, originalCreateBody, 201));
    assert.equal(createReplay._id, accepted._id); assert.equal(createReplay.version, 1);
  });

  await t.test('malformed, foreign, stale, UOM and SERIAL selectors refuse without any durable changes', async () => {
    const line = typedLine(serial), body = typedBody(account._id, [line]);
    const cases = [
      ['foreign', { ...line, catalogItem: { itemId: foreign._id, itemVersion: foreign.version, itemRevision: foreign.currentRevision } }, 404, 'NOT_FOUND'],
      ['draft', typedLine(draft), 409, 'QUOTE_ITEM_CHANGED'],
      ['stale version', { ...line, catalogItem: { ...line.catalogItem, itemVersion: serial.version + 1 } }, 409, 'QUOTE_ITEM_CHANGED'],
      ['UOM', { ...line, uom: 'KG' }, 400, 'ITEM_UOM_MISMATCH'],
      ['fractional serial', { ...line, quantity: '1.5' }, 400, 'SERIAL_QUANTITY_REQUIRED'],
      ['snapshot injection', { ...line, catalogItem: { ...line.catalogItem, itemSnapshot: serial } }, 400, 'INVALID_CATALOG_ITEM'],
      ['owner injection', { ...line, catalogItem: { ...line.catalogItem, ownerLegalEntityId: foreign.ownerLegalEntityId } }, 400, 'INVALID_CATALOG_ITEM'],
      ['missing version', { ...line, catalogItem: { itemId: serial._id, itemRevision: serial.currentRevision } }, 400, 'INVALID_CATALOG_ITEM'],
    ];
    for (const [label, input, status, code] of cases) await denied(h, root, { ...body, idempotencyKey: randomUUID(), lines: [input] }, { status, code });
    await denied(h, root, { ...body, tenant_id: foreign.tenantId }, { status: 403, code: 'SCOPE_DENIED' });
    await denied(h, root, { ...body, idempotencyKey: originalCreateBody.idempotencyKey, lines: [typedLine(serial)] }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    const unbound = { ...line }; delete unbound.catalogItem;
    await denied(h, root, typedBody(account._id, [line, unbound]), { status: 400, code: 'INVALID_LINE' });
  });

  await t.test('an explicit commercial revision preserves the old approval and never silently accepts its superseded revision', async () => {
    const firstItem = await makeItem(h), replacementItem = await makeItem(h);
    const built = await makeQuote(h, account._id, [firstItem], { stage: 'APPROVED' }), oldApproval = built.quote.approvals[0];
    const payload = { ...typedBody(account._id, [typedLine(replacementItem, { quantity: '3.000', unitPrice: '0.01' })]), expectedVersion: built.quote.version };
    let quote = await h.ok(`${root}/${built.quote._id}/revisions`, payload);
    assert.equal(quote.status, 'DRAFT'); assert.equal(quote.revisions.length, 2); assert.deepEqual(quote.approvals[0], oldApproval);
    assert.equal(quote.revisions[1].lines[0].quantity, '3.000'); assert.equal(quote.revisions[1].total, '0.03');
    await denied(h, `${root}/${quote._id}/accept`, { ...next(quote), revision: 1 }, { status: 409, code: 'STALE_REVISION' });
    await denied(h, `${root}/${quote._id}/revisions`, { ...quoteBody(account._id, [typedLine(serial)]), expectedVersion: quote.version, idempotencyKey: randomUUID() }, { status: 400, code: 'QUOTE_COHORT_CONFLICT' });
    quote = await h.ok(`${root}/${quote._id}/approve`, next(quote)); quote = await h.ok(`${root}/${quote._id}/accept`, next(quote));
    const result = await h.ok(`${root}/${quote._id}/convert`, next(quote));
    assert.deepEqual(result.snapshot, quote.approvals.find(row => row.revision === 2).snapshot);
    await h.ok(`/inventory-master/items/${firstItem._id}/deactivate`, { expectedVersion: firstItem.version, reason: 'Independent withdrawal of superseded R1 source only', idempotencyKey: randomUUID() });
    const current = await h.ok(`${root}/${quote._id}`);
    assert.equal(current.catalogEntitlement.currentEligible, true); assert.equal(current.catalogEntitlement.lines[0].itemId, replacementItem._id);
    const created = await guardedReplay(h, () => h.ok(root, built.body, 201));
    assert.equal(created.version, 1); assert.equal(created.revisions[0].lines[0].catalogBinding.itemId, firstItem._id);
    assert.equal(created.catalogEntitlement.currentEligible, false); assert.equal(created.catalogEntitlement.lines[0].itemId, firstItem._id);
    const historicalApproval = await guardedReplay(h, () => h.ok(`${root}/${quote._id}/approve`, built.actions[0].payload));
    assert.equal(historicalApproval.status, 'APPROVED'); assert.equal(historicalApproval.catalogEntitlement.currentEligible, false); assert.equal(historicalApproval.catalogEntitlement.lines[0].itemId, firstItem._id);
  });

  await t.test('each fresh stage rejects an actual successor master revision, while historical reads and keyed results stay frozen', async () => {
    for (const action of ['create', 'revisions', 'approve', 'accept', 'convert']) {
      const item = await makeItem(h), stage = action === 'accept' ? 'APPROVED' : action === 'convert' ? 'ACCEPTED' : 'DRAFT';
      const built = await makeQuote(h, account._id, [item], { stage }), quote = built.quote;
      await reviseMaster(h, item);
      const changed = await h.ok(`${root}/${quote._id}`);
      assert.equal(changed.catalogEntitlement.currentEligible, false);
      assert.ok(changed.catalogEntitlement.blockers.some(row => row.code === 'QUOTE_ITEM_CHANGED'));
      assert.deepEqual(changed.revisions, quote.revisions);
      const body = action === 'create' ? typedBody(account._id, [typedLine(item)]) : action === 'revisions' ? { ...typedBody(account._id, [typedLine(item)]), expectedVersion: quote.version } : next(quote);
      await denied(h, action === 'create' ? root : `${root}/${quote._id}/${action}`, body, { status: 409, code: 'QUOTE_ITEM_CHANGED' });
      const replay = await guardedReplay(h, () => h.ok(root, built.body, 201));
      assert.equal(replay._id, quote._id); assert.equal(replay.catalogEntitlement.currentEligible, false);
      assert.deepEqual(replay.revisions, [quote.revisions[0]]);
    }
  });

  await t.test('quote-only readers hydrate catalog options without master grants and conversion replay still requires live authorization', async () => {
    const member = h.seeded.find(row => row.username === 'alpha.owner');
    const restore = await h.setRoles(member, ['quoteReader']);
    try {
      const before = await allSnapshot(h), option = await h.ok(`/commercial/catalog-items/${serial._id}`);
      assert.equal(option._id, serial._id); assert.equal(option.eligible, true);
      const options = await h.ok('/commercial/catalog-items?q=QA-QC-&limit=100');
      assert.ok(options.some(item => item._id === serial._id));
      assert.deepEqual(await allSnapshot(h), before);
      await denied(h, `${root}/${accepted._id}/convert`, convertBody, { status: 403, code: 'SCOPE_DENIED' });
      const head = await h.db.collection('quotes').findOne({ _id: accepted._id });
      const stripped = structuredClone(head); delete stripped.schema;
      for (const replacement of [{ ...head, schema: 'LEGACY' }, stripped]) await restoreRow(h, 'quotes', head, replacement, () => denied(h, `${root}/${accepted._id}/convert`, convertBody, { status: 403, code: 'SCOPE_DENIED' }));
      await h.db.collection('quotes').deleteOne({ _id: head._id });
      try { await denied(h, `${root}/${accepted._id}/convert`, convertBody, { status: 403, code: 'SCOPE_DENIED' }); }
      finally { await h.db.collection('quotes').insertOne(head); }
    } finally { await restore(); }
  });

  await t.test('a conversion outbox failure rolls back keys, order, quote and source fences; its original key remains usable', async () => {
    const built = await makeQuote(h, account._id, [serial], { stage: 'ACCEPTED' }), payload = next(built.quote), original = h.runtime.db.collection;
    h.runtime.db.collection = function (name, ...args) { const collection = original.call(this, name, ...args); if (name === 'commercialOutbox') collection.insertOne = async () => { throw new Error('Independent synthetic outbox failure'); }; return collection; };
    try { await denied(h, `${root}/${built.quote._id}/convert`, payload, { status: 500 }); }
    finally { h.runtime.db.collection = original; }
    const result = await h.ok(`${root}/${built.quote._id}/convert`, payload);
    assert.equal(await h.db.collection('salesOrders').countDocuments({ quoteId: built.quote._id }), 1);
    assert.equal(await h.db.collection('quoteConversions').countDocuments({ quoteId: built.quote._id }), 1);
    assert.equal(result.quoteId, built.quote._id);
  });

  await t.test('distinct simultaneous conversion keys produce one order and one durable winner, not duplicate entitlements', async () => {
    const built = await makeQuote(h, account._id, [lot], { stage: 'ACCEPTED' }), payloads = [next(built.quote), next(built.quote)], before = await selectedSnapshot(h);
    const responses = await Promise.all(payloads.map(payload => h.req(`${root}/${built.quote._id}/convert`, payload, h.alpha)));
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.equal(await h.db.collection('salesOrders').countDocuments({ quoteId: built.quote._id }), 1);
    assert.equal(await h.db.collection('quoteConversions').countDocuments({ quoteId: built.quote._id }), 1);
    assert.equal(await h.db.collection('quoteCatalogOrders').countDocuments({ quoteId: built.quote._id }), 1);
    const winner = responses.find(row => row.status === 200).data;
    assert.equal(await h.db.collection('commercialOutbox').countDocuments({ subjectId: winner._id }), 1);
    assert.equal(await h.db.collection('commercialAudit').countDocuments({ subjectId: winner._id, kind: 'quote.converted' }), 1);
    assert.deepEqual(await selectedSnapshot(h), before);
    const loser = payloads[responses.findIndex(row => row.status === 409)];
    assert.equal(await h.db.collection('quoteCatalogKeys').countDocuments({ key: loser.idempotencyKey }), 0);
  });

  await t.test('mutable quote, approval and SO tampering cannot bypass independent typed historical evidence', async () => {
    const stored = await h.db.collection('quotes').findOne({ _id: accepted._id });
    const mutations = [
      row => { delete row.schema; },
      row => { row.schema = 'LEGACY'; },
      row => { delete row.schema; row.revisions = { malformed: true }; },
      row => { row.revisions[0].lines[0].catalogBinding.itemSnapshot.content.description = 'forged historical item'; },
      row => { row.approvals[0].snapshot.lines[0].quantity = '3'; },
    ];
    for (const mutate of mutations) {
      const replacement = structuredClone(stored); mutate(replacement);
      await restoreRow(h, 'quotes', stored, replacement, async () => {
        await denied(h, `${root}/${stored._id}`, undefined, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
        await denied(h, `${root}/${stored._id}/convert`, convertBody, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
        await denied(h, '/commercial/quotes?limit=100', undefined, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
      });
    }
    const storedOrder = await h.db.collection('salesOrders').findOne({ _id: order._id });
    for (const mutate of [row => { delete row.schema; }, row => { delete row.snapshot.lines[0].catalogBinding; }, row => { row.snapshot.lines[1].catalogBinding.itemId = foreign._id; }]) {
      const replacement = structuredClone(storedOrder); mutate(replacement);
      await restoreRow(h, 'salesOrders', storedOrder, replacement, async () => {
        await denied(h, `/commercial/orders/${order._id}`, undefined, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
        await denied(h, `${root}/${accepted._id}/convert`, convertBody, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
      });
    }
    assert.deepEqual(withoutDerived(await h.ok(`/commercial/orders/${order._id}`)), JSON.parse(JSON.stringify(storedOrder)));
  });

  await t.test('corrupt immutable inventory evidence is rejected historically rather than upgraded through a current head', async () => {
    const source = await h.db.collection('inventoryItemRevisions').findOne({ subjectId: serial._id, revision: serial.currentRevision });
    await restoreRow(h, 'inventoryItemRevisions', source, { ...source, content: { ...source.content, uom: 'KG' } }, async () => {
      await denied(h, `${root}/${accepted._id}`, undefined, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
      await denied(h, `${root}/${accepted._id}/convert`, convertBody, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
    });
  });

  await t.test('a self-rehashed historical command result cannot replace the independently recorded event snapshot', async () => {
    const key = await h.db.collection('quoteCatalogKeys').findOne({ key: originalCreateBody.idempotencyKey });
    const forged = structuredClone(key); forged.result.revisions[0].lines[0].quantity = '999'; forged.resultHash = hash(forged.result);
    await restoreRow(h, 'quoteCatalogKeys', key, forged, async () => {
      await denied(h, root, originalCreateBody, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
      await denied(h, `${root}/${accepted._id}`, undefined, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
    });
    await restoreRow(h, 'quoteCatalogKeys', key, { ...key, result: null, resultHash: hash(null) }, () => denied(h, root, originalCreateBody, { status: 409, code: 'QUOTE_SOURCE_INVALID' }));
  });

  await t.test('approved typed quote document sources validate history and corruption rolls back document fences', async () => {
    const sourcePath = `/documents/sources/quote/${accepted._id}?sourceVersion=1`;
    const source = await h.ok(sourcePath);
    assert.equal(source.lines[0].quantity, '2.000'); assert.equal(source.total, '325.03');
    const issue = await h.ok('/documents/issues', { kind: 'quote', sourceId: accepted._id, sourceVersion: 1 });
    assert.ok(issue._id);
    assert.equal((await h.ok(`${root}/${accepted._id}`)).catalogEntitlement.historicalBound, true);
    const stored = await h.db.collection('quotes').findOne({ _id: accepted._id }), forged = structuredClone(stored);
    forged.approvals[0].snapshot.lines[0].quantity = '9';
    await restoreRow(h, 'quotes', stored, forged, async () => {
      await denied(h, sourcePath, undefined, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
      await denied(h, '/documents/issues', { kind: 'quote', sourceId: accepted._id, sourceVersion: 1 }, { status: 409, code: 'QUOTE_SOURCE_INVALID' });
    });
  });

  await t.test('legacy stock dispatch remains supported while typed SO cannot escape through UOM-only legacy writers', async () => {
    const legacyBody = quoteBody(account._id, [{ description: serial.code, quantity: '1.25', uom: 'KG', unitPrice: '2.00', currency: 'USD' }]);
    let legacy = await h.ok(root, legacyBody, 201);
    assert.equal(Object.hasOwn(legacy, 'schema'), false); assert.equal(Object.hasOwn(legacy, 'catalogEntitlement'), false);
    await denied(h, `${root}/${legacy._id}/revisions`, { ...typedBody(account._id, [typedLine(lot)]), expectedVersion: legacy.version }, { status: 400, code: 'QUOTE_COHORT_CONFLICT' });
    legacy = await h.ok(`${root}/${legacy._id}/approve`, { expectedVersion: 1, revision: 1 });
    legacy = await h.ok(`${root}/${legacy._id}/accept`, { expectedVersion: legacy.version, revision: 1 });
    const legacyConversionKey = randomUUID();
    const legacyConvertBody = { expectedVersion: legacy.version, revision: 1, idempotencyKey: legacyConversionKey };
    const legacyOrder = await h.ok(`${root}/${legacy._id}/convert`, legacyConvertBody);
    await denied(h, root, { ...typedBody(account._id, [typedLine(lot)]), idempotencyKey: legacyConversionKey }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    assert.deepEqual(await guardedReplay(h, () => h.ok(`${root}/${legacy._id}/convert`, legacyConvertBody)), legacyOrder);
    const competing = await makeQuote(h, account._id, [lot], { stage: 'ACCEPTED' });
    await denied(h, `${root}/${competing.quote._id}/convert`, { ...next(competing.quote), idempotencyKey: legacyConversionKey }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    const vendor = await h.ok('/procurement/vendors', { name: 'Independent legacy guard supplier' }, 201);
    const content = { taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: lot.code, quantity: '3', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] };
    let pr = await h.ok('/procurement/requests', { ...content, vendorId: vendor._id }, 201);
    pr = await h.ok(`/procurement/requests/${pr._id}/approve`, { expectedVersion: pr.version });
    let po = await h.ok(`/procurement/requests/${pr._id}/convert`, { expectedVersion: pr.version, idempotencyKey: randomUUID() });
    po = await h.ok(`/procurement/orders/${po._id}/issue`, { expectedVersion: po.version });
    let receipt = await h.ok('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: po.version, vendorId: vendor._id, lineIndex: 0, quantity: '3', uom: 'KG', idempotencyKey: randomUUID() }, 201);
    receipt = await h.ok(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: receipt.version, reason: 'Independent valid legacy inspection', idempotencyKey: randomUUID() });
    receipt = await h.ok(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: receipt.version, location: 'QA-LEGACY-BIN', idempotencyKey: randomUUID() });
    const reservationBody = so => ({ expectedVersion: receipt.version, salesOrderId: so._id, accountId: account._id, lineIndex: so._id === order._id ? 1 : 0, quantity: '1.25', uom: 'KG', idempotencyKey: randomUUID() });
    await denied(h, `/warehouse/receipts/${receipt._id}/reserve`, reservationBody(order), { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' });
    await denied(h, '/manufacturing/work-orders', { salesOrderId: order._id, expectedVersion: order.version, lineIndex: 1, quantities: ['1.25'], uom: 'KG', idempotencyKey: randomUUID() }, { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' });
    await denied(h, '/manufacturing/engineering', { expectedVersion: 1, salesOrderId: order._id, salesOrderVersion: order.version, lineIndex: 1, uom: 'KG', operations: [{ code: 'QA', instruction: 'Independent valid legacy route' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: randomUUID() }, { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' });
    await h.ok(`/warehouse/receipts/${receipt._id}/reserve`, reservationBody(legacyOrder));
    const reservation = await h.db.collection('warehouseReservations').findOne({ salesOrderId: legacyOrder._id });
    const shipmentBody = so => ({ salesOrderId: so._id, expectedVersion: so.version, lineIndex: so._id === order._id ? 1 : 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: reservation._id, quantity: '1.25' }], reference: 'Independent legacy shipment guard', idempotencyKey: randomUUID() });
    await denied(h, '/fulfillment/shipments', shipmentBody(order), { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' });
    const shipment = await h.ok('/fulfillment/shipments', shipmentBody(legacyOrder), 201);
    const invoiceBody = so => ({ salesOrderId: so._id, expectedVersion: so.version, lines: [{ shipmentId: shipment._id, quantity: '1.25' }], idempotencyKey: randomUUID() });
    await denied(h, '/fulfillment/invoices', invoiceBody(order), { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' });
    const invoice = await h.ok('/fulfillment/invoices', invoiceBody(legacyOrder), 201);
    const storedInvoice = await h.db.collection('fulfillmentInvoices').findOne({ _id: invoice._id });
    const paymentBody = { accountId: account._id, amount: invoice.outstandingAmount, currency: invoice.currency, reference: 'Independent actual legacy payment', allocations: [{ invoiceId: invoice._id, expectedVersion: invoice.version, amount: invoice.outstandingAmount }], idempotencyKey: randomUUID() };
    await restoreRow(h, 'fulfillmentInvoices', storedInvoice, { ...storedInvoice, salesOrderId: order._id }, () => denied(h, '/fulfillment/payments', paymentBody, { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' }));
    await h.ok('/fulfillment/payments', paymentBody, 201);
    const paidInvoice = await h.db.collection('fulfillmentInvoices').findOne({ _id: invoice._id });
    await restoreRow(h, 'fulfillmentInvoices', paidInvoice, { ...paidInvoice, salesOrderId: order._id }, () => denied(h, '/fulfillment/payments', paymentBody, { status: 409, code: 'CATALOG_ORDER_UNSUPPORTED' }));
    const stored = await h.db.collection('salesOrders').findOne({ _id: order._id }), stripped = structuredClone(stored);
    delete stripped.schema; delete stripped.snapshot.schema; for (const line of stripped.snapshot.lines) delete line.catalogBinding;
    await restoreRow(h, 'salesOrders', stored, stripped, () => denied(h, '/fulfillment/shipments', shipmentBody(order), { status: 409, code: 'QUOTE_SOURCE_INVALID' }));
  });

  await t.test('an actual inquiry with matching catalog text remains unbound and its frozen provenance cannot be retrofitted', async () => {
    let inquiry = await h.ok('/commercial/inquiries', { accountId: account._id, lines: [{ itemCode: serial.code, description: serial.content.description, quantity: '2.000', uom: 'UN', drawingNumber: 'QA-DRAWING', drawingRevision: 'A' }], idempotencyKey: randomUUID() }, 201);
    for (const toStage of ['SUBMITTED', 'IN_REVIEW']) inquiry = await h.ok(`/commercial/inquiries/${inquiry._id}/stage`, { expectedVersion: inquiry.version, toStage, reason: 'Independent inquiry source evidence', idempotencyKey: randomUUID() });
    const result = await h.ok(`/commercial/inquiries/${inquiry._id}/convert`, { expectedVersion: inquiry.version, revision: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', prices: [{ inquiryLineId: inquiry.revisions[0].lines[0].lineId, unitPrice: '1.00', currency: 'USD' }], idempotencyKey: randomUUID() });
    const quote = result.quote, sourceLine = quote.revisions[0].lines[0];
    assert.equal(Object.hasOwn(quote, 'schema'), false); assert.equal(Object.hasOwn(sourceLine, 'catalogBinding'), false); assert.equal(sourceLine.provenance.inquiryId, inquiry._id);
    await denied(h, `${root}/${quote._id}/revisions`, { ...typedBody(account._id, [typedLine(serial)]), expectedVersion: quote.version }, { status: 400, code: 'QUOTE_COHORT_CONFLICT' });
    const read = await h.ok(`${root}/${quote._id}`); assert.deepEqual(read.revisions[0].lines[0], sourceLine); assert.equal(Object.hasOwn(read, 'catalogEntitlement'), false);
  });

  await t.test('actual item deactivation blocks new use but not coherent authorized conversion replay or frozen SO history', async () => {
    const item = await makeItem(h), built = await makeQuote(h, account._id, [item], { stage: 'ACCEPTED' }), payload = next(built.quote);
    const converted = await h.ok(`${root}/${built.quote._id}/convert`, payload);
    await h.ok(`/inventory-master/items/${item._id}/deactivate`, { expectedVersion: item.version, reason: 'Independent actual item withdrawal', idempotencyKey: randomUUID() });
    const historical = await h.ok(`/commercial/orders/${converted._id}`);
    assert.deepEqual(historical.snapshot, converted.snapshot); assert.equal(historical.catalogEntitlement.currentEligible, false);
    const replay = await guardedReplay(h, () => h.ok(`${root}/${built.quote._id}/convert`, payload));
    assert.equal(replay._id, converted._id); assert.equal(replay.catalogEntitlement.currentEligible, false);
    await denied(h, root, typedBody(account._id, [typedLine(item)]), { status: 409, code: 'QUOTE_ITEM_CHANGED' });
  });
});
