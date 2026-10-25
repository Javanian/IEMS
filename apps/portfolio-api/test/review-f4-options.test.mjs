import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from './support/owned-mongo.mjs';
import { catalogOptionQuery, catalogOptionIndexes } from '../src/catalog-options.mjs';
import { catalogOptionCollection, catalogOptionProjection, initializeCatalogOptionIndex } from '../src/catalog-option-index.mjs';

test('F4 query builder treats search metacharacters literally and preserves source eligibility', () => {
  const query = catalogOptionQuery({ tenantId: 'tenant', plantId: 'plant' }, 'items', 'owner', 'A.*[x]', 'cursor');
  assert.equal(query.prefixes, 'a.*[x]'); assert.equal(query.ownerLegalEntityId, 'owner'); assert.equal(query.eligible, true); assert.equal(query._id.$gt, 'cursor');
  const projection = catalogOptionProjection('items', { _id: 'id', code: 'A'.repeat(200), content: { description: 'B'.repeat(200) } });
  assert.equal(projection.prefixes.length, 161); assert.ok(projection.prefixes.every(prefix => prefix.length <= 80));
});

test('F4 real >=250 items/vendors remain selectable through scoped eligible search and cursor hydration', async t => {
  const h = await startOwned(t), command = values => ({ expectedVersion: 1, reason: 'Supplemental F4 source query fixture', idempotencyKey: randomUUID(), ...values }), sources = [];
  for (let index = 0; index < 250; index++) {
    const code = `PICKER_${String(index).padStart(3, '0')}`, item = await h.ok('/inventory-master/items', command({ code, description: `Similar source ${String(index).padStart(3, '0')}`, kind: 'PURCHASED', uom: 'UN', schema: 'INVENTORY_ITEM_V2', trackingPolicy: index % 2 ? 'LOT' : 'SERIAL' }), 201), approved = await h.ok(`/inventory-master/items/${item._id}/approve`, command({ expectedVersion: item.version, revision: 1 })), vendor = await h.ok('/procurement/vendors', { name: `Similar vendor ${String(index).padStart(3, '0')}` }, 201);
    sources.push({ item: approved, vendor });
  }
  const draft = await h.ok('/inventory-master/items', command({ code: 'PICKER_DRAFT', description: 'Ineligible draft', kind: 'PURCHASED', uom: 'UN', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT' }), 201);
  const collect = async (type, eligibility) => { const rows = []; let cursor; do { const result = await h.req(`/catalog-procurement/options/${type}?eligibility=${eligibility}&limit=25${cursor ? `&cursor=${cursor}` : ''}`, undefined, h.alpha); assert.equal(result.status, 200); rows.push(...result.data); cursor = result.page.nextCursor; } while (cursor); return rows; };
  const items = await collect('items', 'PURCHASED_V2_APPROVED'), vendors = await collect('vendors', 'ACTIVE_VENDOR'); assert.equal(items.length, 250); assert.equal(vendors.length, 250); assert.equal(new Set(items.map(row => row._id)).size, 250); assert.ok(items.every(row => row.eligible));
  const beyond = items[200], outsideVendor = vendors[200], resolved = await h.ok(`/catalog-procurement/options/items/${beyond._id}`); assert.equal(resolved._id, beyond._id); assert.equal(resolved.eligible, true); assert.equal((await h.ok(`/catalog-procurement/options/items/${draft._id}`)).eligible, false);
  const selected = await h.ok('/catalog-procurement/requests', command({ vendorId: outsideVendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ itemId: beyond._id, itemVersion: beyond.version, itemRevision: beyond.currentRevision, quantity: '1', unitPrice: '1.00', currency: 'USD' }] }), 201); assert.equal(selected.content.vendorId, outsideVendor._id); assert.equal(selected.content.lines[0].itemId, beyond._id);
  const literal = await h.req('/catalog-procurement/options/items?eligibility=PURCHASED_V2_APPROVED&q=.*', undefined, h.alpha); assert.equal(literal.status, 200); assert.equal(literal.data.length, 0);
  assert.equal((await h.req(`/catalog-procurement/options/items/${beyond._id}`, undefined, h.beta)).status, 404);
  assert.equal((await h.req('/catalog-procurement/options/items?eligibility=PURCHASED_V2_APPROVED&q[$ne]=x', undefined, h.alpha)).status, 400);
  const changed = await h.ok(`/inventory-master/items/${beyond._id}/deactivate`, command({ expectedVersion: beyond.version })); assert.equal(changed.status, 'INACTIVE'); const hydration = await h.ok(`/catalog-procurement/options/items/${beyond._id}`); assert.equal(hydration.eligible, false); assert.ok(hydration.blockers.includes('ITEM_NOT_APPROVED'));
  const raw = await h.db.collection('plants').findOne({ _id: h.seeded[0].plantId }), filter = { tenantId: raw.tenantId, plantId: raw._id };
  await t.test('literal normalized prefix equality is selective for zero and rare matches with actual EXPLAIN', async () => {
    for (const type of ['items', 'vendors']) for (const q of ['', 'sImIlAr', type === 'items' ? 'picker_249' : 'similar vendor 249', 'no-such-prefix']) {
      const explain = await h.db.collection(catalogOptionCollection).find(catalogOptionQuery(filter, type, raw.legalEntityId, q, null)).hint(catalogOptionIndexes[type]).sort({ _id: 1 }).limit(26).explain('executionStats');
      assert.ok(JSON.stringify(explain.queryPlanner.winningPlan).includes('IXSCAN'));
      if (q === 'no-such-prefix') { assert.equal(explain.executionStats.nReturned, 0); assert.equal(explain.executionStats.totalDocsExamined, 0); assert.ok(explain.executionStats.totalKeysExamined <= 1); }
      else if (q.endsWith('249')) { assert.equal(explain.executionStats.nReturned, 1); assert.ok(explain.executionStats.totalDocsExamined <= 1); assert.ok(explain.executionStats.totalKeysExamined <= 2); }
      process.stdout.write(`${JSON.stringify({ label: 'F4-query-plan', collection: catalogOptionCollection, type, q, winningPlan: explain.queryPlanner.winningPlan, executionStats: { nReturned: explain.executionStats.nReturned, totalKeysExamined: explain.executionStats.totalKeysExamined, totalDocsExamined: explain.executionStats.totalDocsExamined, executionTimeMillis: explain.executionStats.executionTimeMillis } })}\n`);
    }
    const rare = await h.req('/catalog-procurement/options/vendors?eligibility=ACTIVE_VENDOR&q=sIMiLar%20Vendor%20249', undefined, h.alpha); assert.equal(rare.status, 200); assert.equal(rare.data.length, 1); assert.equal(rare.data[0].name, 'Similar vendor 249');
  });
  await t.test('malformed vendor activation and tampered cache fail closed; inactive remains explicitly ineligible', async () => {
    for (const active of [null, 'false']) {
      await h.db.collection('vendors').updateOne({ _id: outsideVendor._id }, { $set: { active } });
      assert.equal((await h.req(`/catalog-procurement/options/vendors/${outsideVendor._id}`, undefined, h.alpha)).error.code, 'CATALOG_SOURCE_INVALID');
      const list = await h.req(`/catalog-procurement/options/vendors?eligibility=ACTIVE_VENDOR&q=${encodeURIComponent(outsideVendor.name)}`, undefined, h.alpha); assert.equal(list.status, 409); assert.equal(list.error.code, 'CATALOG_SOURCE_INVALID');
    }
    await h.db.collection('vendors').updateOne({ _id: outsideVendor._id }, { $set: { active: false } });
    assert.equal((await h.ok(`/catalog-procurement/options/vendors/${outsideVendor._id}`)).eligible, false);
    await h.db.collection('vendors').updateOne({ _id: outsideVendor._id }, { $unset: { active: '' } });
    const projection = await h.db.collection(catalogOptionCollection).findOne({ _id: outsideVendor._id });
    await h.db.collection(catalogOptionCollection).updateOne({ _id: projection._id }, { $set: { sourceVersion: 999 } });
    assert.equal((await h.req(`/catalog-procurement/options/vendors?eligibility=ACTIVE_VENDOR&q=${encodeURIComponent(outsideVendor.name)}`, undefined, h.alpha)).error.code, 'CATALOG_SOURCE_INVALID');
    await h.db.collection(catalogOptionCollection).replaceOne({ _id: projection._id }, projection);
  });
  await t.test('source and technical projection commit atomically and existing-source bootstrap repairs missing cache', async () => {
    const beforeVendor = await h.db.collection('vendors').countDocuments(), beforeEvents = await h.db.collection('procurementOutbox').countDocuments();
    await h.db.command({ collMod: catalogOptionCollection, validator: { prohibited: { $exists: true } }, validationLevel: 'strict' });
    try {
      assert.equal((await h.req('/procurement/vendors', { name: 'Rollback cache vendor' }, h.alpha)).status, 500);
      assert.equal(await h.db.collection('vendors').countDocuments(), beforeVendor); assert.equal(await h.db.collection('procurementOutbox').countDocuments(), beforeEvents);
      const revision = await h.req(`/inventory-master/items/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: 1 }), h.alpha); assert.equal(revision.status, 500); assert.equal((await h.ok(`/inventory-master/items/${draft._id}`)).status, 'DRAFT');
    } finally { await h.db.command({ collMod: catalogOptionCollection, validator: {} }); }
    await h.db.collection(catalogOptionCollection).deleteOne({ _id: outsideVendor._id });
    await initializeCatalogOptionIndex(h.db);
    assert.deepEqual(await h.db.collection(catalogOptionCollection).findOne({ _id: outsideVendor._id }), catalogOptionProjection('vendors', await h.db.collection('vendors').findOne({ _id: outsideVendor._id })));
    assert.equal((await h.req(`/catalog-procurement/options/vendors?eligibility=ACTIVE_VENDOR&q=${encodeURIComponent(outsideVendor.name)}`, undefined, h.alpha)).data.length, 1);
  });
  await t.test('fresh vendor authority is rechecked on every typed mutation while inactive history and committed replay remain usable', async () => {
    const source = sources.find(({ item }) => item._id !== beyond._id && item.content.trackingPolicy === 'LOT').item, vendor = await h.ok('/procurement/vendors', { name: 'F4 live mutation authority supplier' }, 201), content = { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ itemId: source._id, itemVersion: source.version, itemRevision: source.currentRevision, quantity: '2', unitPrice: '1.00', currency: 'USD' }] }, root = '/catalog-procurement', saved = [];
    const names = ['vendors', 'catalogPurchaseRequests', 'catalogRequestRevisions', 'catalogPurchaseOrders', 'catalogOrderRevisions', 'catalogRequestLineIds', 'catalogReceived', 'warehouseReceipts', 'warehouseReceiptOrigins', 'warehouseMovements', 'warehouseSerials', 'catalogKeys', 'catalogEvents', 'catalogAudit', 'catalogOutbox'], snapshot = () => Promise.all(names.map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray()));
    const check = async attempts => {
      for (const active of [false, null, 'false']) {
        await h.db.collection('vendors').updateOne({ _id: vendor._id }, { $set: { active } });
        const before = await snapshot();
        for (const [path, body] of attempts) { const response = await h.req(path, body, h.alpha); assert.equal(response.status, 409, `${path} ${JSON.stringify(response)}`); assert.equal(response.error.code, active === false ? 'VENDOR_INACTIVE' : 'CATALOG_SOURCE_INVALID'); }
        assert.deepEqual(await snapshot(), before);
        for (const entry of saved) assert.deepEqual(await h.ok(entry.path, entry.body, entry.status || 200), entry.result);
        assert.deepEqual(await snapshot(), before);
      }
      await h.db.collection('vendors').updateOne({ _id: vendor._id }, { $unset: { active: '' } });
    };
    let request = await h.ok(`${root}/requests`, command(content), 201);
    const approve = command({ expectedVersion: request.version, revision: 1 });
    await check([[`${root}/requests`, command(content)], [`${root}/requests/${request._id}/revisions`, command({ ...content, expectedVersion: request.version })], [`${root}/requests/${request._id}/approve`, approve]]);
    request = await h.ok(`${root}/requests/${request._id}/approve`, approve); saved.push({ path: `${root}/requests/${request._id}/approve`, body: approve, result: request });
    const convert = command({ expectedVersion: request.version }); await check([[`${root}/requests/${request._id}/convert`, convert]]);
    let order = await h.ok(`${root}/requests/${request._id}/convert`, convert); saved.push({ path: `${root}/requests/${request._id}/convert`, body: convert, result: order });
    const issue = command({ expectedVersion: order.version }); await check([[`${root}/orders/${order._id}/issue`, issue]]);
    order = await h.ok(`${root}/orders/${order._id}/issue`, issue); saved.push({ path: `${root}/orders/${order._id}/issue`, body: issue, result: order });
    const receive = command({ expectedVersion: order.version, purchaseOrderId: order._id, vendorId: vendor._id, lineId: order.content.lines[0].lineId, quantity: '1', lotNumber: 'F4-ACTUAL', heatNumber: 'F4-HEAT' }); await check([[`${root}/receipts`, receive]]);
    const receipt = await h.ok(`${root}/receipts`, receive, 201); saved.push({ path: `${root}/receipts`, body: receive, result: receipt, status: 201 });
    const raw = await h.db.collection('vendors').findOne({ _id: vendor._id }); assert.ok(raw.catalogUseFence >= 5); assert.equal(raw.version, 1);
    await h.db.collection('vendors').updateOne({ _id: vendor._id }, { $set: { active: false } });
    assert.ok((await h.ok(`${root}/requests/${request._id}`)).blockers.includes('VENDOR_INACTIVE'));
    assert.equal((await h.ok(`${root}/orders/${order._id}`)).receiving[0].receivedQuantity, '1');
    assert.equal((await h.ok(`${root}/receipts/${receipt._id}`))._id, receipt._id);
    for (const entry of saved) assert.deepEqual(await h.ok(entry.path, entry.body, entry.status || 200), entry.result);
    await h.db.collection('vendors').updateOne({ _id: vendor._id }, { $unset: { active: '' } });
    const restore = await h.setRoles(h.seeded[0], ['catalogReader']);
    try {
      assert.equal((await h.req('/catalog-procurement/options/items?eligibility=PURCHASED_V2_APPROVED', undefined, h.alpha)).status, 403);
      assert.equal((await h.req('/catalog-procurement/options/vendors?eligibility=ACTIVE_VENDOR', undefined, h.alpha)).status, 403);
      assert.equal((await h.req(`${root}/receipts`, receive, h.alpha)).status, 403);
    } finally { await restore(); }
    for (const [roles, permitted, denied] of [[['catalogReader', 'masterReader'], 'items?eligibility=PURCHASED_V2_APPROVED', 'vendors?eligibility=ACTIVE_VENDOR'], [['catalogReader', 'procurementRead'], 'vendors?eligibility=ACTIVE_VENDOR', 'items?eligibility=PURCHASED_V2_APPROVED']]) {
      const reset = await h.setRoles(h.seeded[0], roles);
      try { assert.equal((await h.req(`/catalog-procurement/options/${permitted}`, undefined, h.alpha)).status, 200); assert.equal((await h.req(`/catalog-procurement/options/${denied}`, undefined, h.alpha)).status, 403); } finally { await reset(); }
    }
    await h.db.collection('vendors').updateOne({ _id: vendor._id }, { $unset: { active: '' } });
  });
});
