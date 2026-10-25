import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

const root = '/catalog-procurement/options', key = () => randomUUID(), reason = 'Independent source search authority evidence';
const exclusion = new Set(['ownedRun', 'sessions', 'memberships', 'users', 'tenants', 'plants', 'legalEntities', 'credentials']);
async function domain(h) { const result = {}; for (const collection of await h.db.listCollections().toArray()) if (!exclusion.has(collection.name)) result[collection.name] = await h.db.collection(collection.name).find().sort({ _id: 1 }).toArray(); return result; }
const v2 = { description: 'QA item common prefix', kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'LOT', uom: 'KG' };
const query = (type, parameters = {}) => `${root}/${type}?${new URLSearchParams({ eligibility: type === 'items' ? 'PURCHASED_V2_APPROVED' : 'ACTIVE_VENDOR', ...parameters })}`;

test('independent 250-source search, pagination, hydration and mutation authority', async t => {
  assert.ok(process.env.IEMS_QA_EVIDENCE, 'Set external IEMS_QA_EVIDENCE for query-plan evidence');
  const h = await startOwned(t), items = [], vendors = [];
  async function newItem(code, content = v2, cookie = h.alpha, approved = true) {
    let row = await h.ok('/inventory-master/items', { ...content, code, expectedVersion: 1, reason, idempotencyKey: key() }, 201, cookie);
    if (approved) row = await h.ok(`/inventory-master/items/${row._id}/approve`, { expectedVersion: row.version, revision: row.currentRevision, reason, idempotencyKey: key() }, 200, cookie);
    return row;
  }
  for (let i = 0; i < 250; i++) {
    items.push(await newItem(`QA-SEARCH-${String(i).padStart(3, '0')}`, { ...v2, description: i === 249 ? 'QA item [literal] .* needle' : v2.description, trackingPolicy: i % 2 ? 'SERIAL' : 'LOT' }));
    vendors.push(await h.ok('/procurement/vendors', { name: i === 249 ? 'QA vendor [literal] .* needle' : `QA Vendor Similar ${String(i).padStart(3, '0')}` }, 201));
  }
  const draft = await newItem('QA-INELIGIBLE-DRAFT', v2, h.alpha, false), manufactured = await newItem('QA-INELIGIBLE-MANUFACTURED', { ...v2, kind: 'MANUFACTURED' }), v1 = await newItem('QA-INELIGIBLE-V1', { description: 'QA old policy', kind: 'PURCHASED', uom: 'KG' }), withdrawn = await newItem('QA-INELIGIBLE-INACTIVE');
  await h.ok(`/inventory-master/items/${withdrawn._id}/deactivate`, { expectedVersion: withdrawn.version, reason, idempotencyKey: key() });
  const foreign = await newItem('QA-SEARCH-FOREIGN', v2, h.beta), foreignVendor = await h.ok('/procurement/vendors', { name: 'QA Vendor Foreign' }, 201, h.beta);
  const sortedItems = [...items].sort((a,b) => a._id.localeCompare(b._id)), sortedVendors = [...vendors].sort((a,b) => a._id.localeCompare(b._id));
  const tailItem = sortedItems[249], otherTailItem = sortedItems[248], tailVendor = sortedVendors[249];
  const read = async route => { const response = await h.req(route, undefined, h.alpha); assert.equal(response.status, 200, JSON.stringify(response)); return response; };

  await t.test('stable 25-row cursor walks include all 250 approved sources exactly once beyond the old first100', async () => {
    const before = await domain(h);
    for (const [type, expected] of [['items', sortedItems], ['vendors', sortedVendors]]) {
      const actual = []; let cursor;
      do {
        const response = await read(query(type, { limit: '25', ...(cursor ? { cursor } : {}) }));
        assert.equal(response.query.ordering, '_id_asc'); assert.equal(response.query.consistency, 'LIVE'); assert.ok(response.data.length <= 25);
        actual.push(...response.data.map(row => row._id)); assert.ok(response.data.every(row => row.eligible && row.blockers.length === 0));
        if (cursor) assert.ok(response.data.every(row => row._id > cursor)); cursor = response.page.nextCursor;
      } while (cursor);
      assert.equal(new Set(actual).size, 250); assert.deepEqual(actual, expected.map(row => row._id));
      assert.equal(actual.indexOf(type === 'items' ? tailItem._id : tailVendor._id), 249);
    }
    assert.deepEqual(await domain(h), before);
  });

  await t.test('literal prefix search escapes regex syntax and rejects caller Mongo operators or unbounded requests', async () => {
    const before = await domain(h);
    const itemResult = await read(query('items', { q: 'QA item [literal] .*', limit: '25' })), vendorResult = await read(query('vendors', { q: 'QA vendor [literal] .*', limit: '25' }));
    assert.deepEqual(itemResult.data.map(row => row._id), [items[249]._id]); assert.deepEqual(vendorResult.data.map(row => row._id), [vendors[249]._id]);
    assert.equal((await read(query('items', { q: 'qa-search-24' }))).data.length, 10);
    for (const route of [`${root}/items?eligibility=PURCHASED_V2_APPROVED&q[$ne]=x`, `${root}/vendors?eligibility=ACTIVE_VENDOR&name[$regex]=.*`, query('items', { q: 'x'.repeat(81) }), query('items', { limit: '101' }), query('vendors', { limit: '1.5' }), query('items', { eligibility: 'ANY_APPROVED' }), query('items', { cursor: 'not-an-id' })]) assert.equal((await h.req(route, undefined, h.alpha)).status, 400, route);
    assert.deepEqual(await domain(h), before);
  });

  await t.test('hydration exposes explicit ineligibility and never crosses scope or silently returns an old approval', async () => {
    assert.equal((await read(`${root}/items/${tailItem._id}`)).data._id, tailItem._id); assert.equal((await read(`${root}/vendors/${tailVendor._id}`)).data._id, tailVendor._id);
    for (const [item, blocker] of [[draft, 'ITEM_NOT_APPROVED'], [manufactured, 'ITEM_NOT_PURCHASED'], [v1, 'TRACKING_POLICY_REQUIRED'], [withdrawn, 'ITEM_NOT_APPROVED']]) { const hydrated = (await read(`${root}/items/${item._id}`)).data; assert.equal(hydrated.eligible, false); assert.ok(hydrated.blockers.includes(blocker)); }
    for (const [type, row] of [['items', foreign], ['vendors', foreignVendor]]) assert.equal((await h.req(`${root}/${type}/${row._id}`, undefined, h.alpha)).status, 404);
    const denied = await h.send(query('items'), { headers: { 'x-plant-id': h.seeded[1].plantId } }); assert.equal(denied.status, 403);
    const original = await h.db.collection('vendors').findOne({ _id: tailVendor._id });
    try {
      await h.db.collection('vendors').updateOne({ _id: original._id }, { $set: { active: false } });
      const hydrated = (await read(`${root}/vendors/${original._id}`)).data; assert.equal(hydrated.eligible, false); assert.deepEqual(hydrated.blockers, ['VENDOR_INACTIVE']);
      const page = await h.req(query('vendors', { cursor: sortedVendors[248]._id, limit: '25' }), undefined, h.alpha); assert.equal(page.status, 409); assert.equal(page.error.code, 'CATALOG_SOURCE_INVALID');
    } finally { await h.db.collection('vendors').replaceOne({ _id: original._id }, original); }
  });

  const requestBody = (item, version) => ({ expectedVersion: version, reason, idempotencyKey: key(), vendorId: tailVendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity: item.content.trackingPolicy === 'LOT' ? '1.25' : '2', unitPrice: '1.00', currency: 'USD' }] });
  await t.test('actual create, revise and approval accept selected sources outside the first100', async () => {
    const vendor = await h.db.collection('vendors').findOne({ _id: tailVendor._id });
    try {
      for (const [active, code] of [[false, 'VENDOR_INACTIVE'], [null, 'CATALOG_SOURCE_INVALID'], ['true', 'CATALOG_SOURCE_INVALID']]) {
        await h.db.collection('vendors').updateOne({ _id: vendor._id }, { $set: { active } });
        const before = await domain(h), denied = await h.req('/catalog-procurement/requests', requestBody(tailItem, 1), h.alpha);
        assert.equal(denied.status, 409, JSON.stringify(denied)); assert.equal(denied.error.code, code); assert.deepEqual(await domain(h), before);
      }
    } finally { await h.db.collection('vendors').replaceOne({ _id: vendor._id }, vendor); }
    let request = await h.ok('/catalog-procurement/requests', requestBody(tailItem, 1), 201);
    assert.equal(request.content.vendorId, tailVendor._id); assert.equal(request.content.lines[0].itemId, tailItem._id);
    request = await h.ok(`/catalog-procurement/requests/${request._id}/revisions`, requestBody(otherTailItem, request.version));
    assert.equal(request.currentRevision, 2); assert.equal(request.content.lines[0].itemId, otherTailItem._id);
    request = await h.ok(`/catalog-procurement/requests/${request._id}/approve`, { expectedVersion: request.version, revision: request.currentRevision, reason, idempotencyKey: key() });
    assert.equal(request.status, 'APPROVED'); assert.equal(request.content.lines[0].itemId, otherTailItem._id);
  });

  await t.test('a later master revision invalidates captured selection for fresh mutation without rewriting its old evidence', async () => {
    const immutable = await h.db.collection('inventoryItemRevisions').findOne({ subjectId: tailItem._id, revision: tailItem.currentRevision });
    const revised = await h.ok(`/inventory-master/items/${tailItem._id}/revisions`, { expectedVersion: tailItem.version, reason, idempotencyKey: key(), ...tailItem.content, description: 'QA later draft requiring explicit reselection' });
    const hydrated = (await read(`${root}/items/${tailItem._id}`)).data; assert.equal(hydrated.eligible, false); assert.equal(hydrated.version, revised.version); assert.ok(hydrated.blockers.includes('ITEM_NOT_APPROVED'));
    const before = await domain(h), response = await h.req('/catalog-procurement/requests', requestBody(tailItem, 1), h.alpha); assert.equal(response.status, 409); assert.deepEqual(await domain(h), before);
    assert.deepEqual(await h.db.collection('inventoryItemRevisions').findOne({ _id: immutable._id }), immutable);
  });

  await t.test('corrupted eligible head cannot be advertised or hydrated as trustworthy source', async () => {
    const original = await h.db.collection('inventoryItems').findOne({ _id: otherTailItem._id });
    try {
      await h.db.collection('inventoryItems').updateOne({ _id: original._id }, { $set: { contentHash: '0'.repeat(64) } });
      const before = await domain(h);
      for (const route of [`${root}/items/${original._id}`, query('items', { q: original.code })]) { const response = await h.req(route, undefined, h.alpha); assert.equal(response.status, 409); assert.equal(response.error.code, 'MASTER_SOURCE_INVALID'); }
      assert.deepEqual(await domain(h), before);
    } finally { await h.db.collection('inventoryItems').replaceOne({ _id: original._id }, original); }
  });

  await t.test('dedicated query permissions are required even with catalog read and familiar IDs', async () => {
    const member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), before = await domain(h);
    try {
      await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'catalogReader', plantIds: member.plantIds }] } });
      for (const route of [query('items'), query('vendors'), `${root}/items/${otherTailItem._id}`, `${root}/vendors/${tailVendor._id}`]) assert.equal((await h.req(route, undefined, h.alpha)).status, 403);
      assert.deepEqual(await domain(h), before);
    } finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  });

  await t.test('actual equality-prefix queries bound rare and absent searches on250source fixture', async () => {
    const alpha = h.seeded[0], owner = (await h.db.collection('plants').findOne({ _id: alpha.plantId })).legalEntityId, plans = [];
    for (const type of ['items', 'vendors']) for (const variant of ['empty', 'rare', 'absent', 'cursor']) {
      const rare = type === 'items' ? sortedItems[100] : vendors[249], prefix = variant === 'rare' ? (type === 'items' ? rare.code : rare.name).toLowerCase() : variant === 'absent' ? 'qa-no-matching-source-anywhere' : '';
      const filter = { tenantId: alpha.tenantId, plantId: alpha.plantId, type, ownerLegalEntityId: type === 'items' ? owner : null, eligible: true, prefixes: prefix, ...(variant === 'cursor' ? { _id: { $gt: type === 'items' ? sortedItems[199]._id : sortedVendors[199]._id } } : {}) };
      const index = 'catalog_option_prefixes', plan = await h.db.collection('catalogOptionSearch').find(filter).hint(index).sort({ _id: 1 }).limit(26).explain('executionStats');
      assert.ok(JSON.stringify(plan.queryPlanner.winningPlan).includes(index)); assert.ok(plan.executionStats.nReturned <= 26);
      if (variant === 'rare') { assert.equal(plan.executionStats.nReturned, 1); assert.equal(plan.executionStats.totalDocsExamined, 1); assert.ok(plan.executionStats.totalKeysExamined <= 2, JSON.stringify(plan.executionStats)); const rows = await h.db.collection('catalogOptionSearch').find(filter).hint(index).toArray(); assert.deepEqual(rows.map(row => row._id), [rare._id]); }
      if (variant === 'absent') { assert.equal(plan.executionStats.nReturned, 0); assert.equal(plan.executionStats.totalDocsExamined, 0); assert.ok(plan.executionStats.totalKeysExamined <= 1, JSON.stringify(plan.executionStats)); }
      plans.push({ type, variant, filter, index, plan });
    }
    await mkdir(process.env.IEMS_QA_EVIDENCE, { recursive: true }); await writeFile(path.join(process.env.IEMS_QA_EVIDENCE, 'independent-picker-query-plans.json'), JSON.stringify(plans, null, 2));
  });
});
