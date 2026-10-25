import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';

export { startOwned };
export const command = values => ({ reason: 'Independent synthetic quote catalog evidence', idempotencyKey: randomUUID(), ...values });

export async function allSnapshot(h) {
  const names = (await h.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await h.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
}

export async function denied(h, path, body, { status, code, cookie = h.alpha } = {}) {
  const before = await allSnapshot(h), result = await h.req(path, body, cookie);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result)}`);
  if (code) assert.equal(result.error?.code, code);
  assert.equal(Object.hasOwn(result, 'data'), false);
  assert.deepEqual(await allSnapshot(h), before, `${path} refusal changed durable data, including authority fences`);
  return result;
}

export async function guardedReplay(h, effect, cookie = h.alpha) {
  const scope = await h.scopeOf(cookie), before = await allSnapshot(h), expected = before;
  const tokenHash = createHash('sha256').update(cookie.slice('portfolio_session='.length)).digest('hex');
  const plant = before.plants.find(row => row._id === scope.selectedPlantId && row.tenantId === scope.tenantId);
  assert.ok(plant);
  const targets = {
    sessions: row => row.tokenHash === tokenHash,
    memberships: row => row._id === scope.membershipId && row.tenantId === scope.tenantId,
    users: row => row._id === scope.userId,
    tenants: row => row._id === scope.tenantId,
    plants: row => row._id === scope.selectedPlantId && row.tenantId === scope.tenantId,
    legalEntities: row => row._id === plant.legalEntityId && row.tenantId === scope.tenantId,
  };
  for (const [name, predicate] of Object.entries(targets)) {
    const matched = expected[name].filter(predicate); assert.equal(matched.length, 1, `One current ${name} authority row`);
    const previous = Object.hasOwn(matched[0], 'crmFence') ? matched[0].crmFence : 0;
    assert.ok(Number.isSafeInteger(previous) && previous >= 0);
    matched[0].crmFence = previous + 1;
  }
  const result = await effect();
  assert.deepEqual(await allSnapshot(h), expected, 'Successful replay may advance only the six exact current authorization crmFence fields by one');
  return result;
}

export async function makeItem(h, { kind = 'MANUFACTURED', trackingPolicy = 'SERIAL', uom = 'UN', approve = true, cookie = h.alpha, code } = {}) {
  const item = await h.ok('/inventory-master/items', command({ expectedVersion: 1, code: code || `QA-QC-${randomUUID().slice(0, 8).toUpperCase()}`, description: 'Independent catalog entitlement item', uom, kind, schema: 'INVENTORY_ITEM_V2', trackingPolicy }), 201, cookie);
  return approve ? h.ok(`/inventory-master/items/${item._id}/approve`, command({ expectedVersion: item.version, revision: item.currentRevision }), 200, cookie) : item;
}

export async function makeCatalogFixture(h) {
  const account = await h.ok('/crm/accounts', { name: 'Independent quote catalog customer' }, 201);
  const serial = await makeItem(h);
  const lot = await makeItem(h, { kind: 'PURCHASED', trackingPolicy: 'LOT', uom: 'KG' });
  const draft = await makeItem(h, { approve: false });
  const foreign = await makeItem(h, { cookie: h.beta });
  return { account, serial, lot, draft, foreign };
}

export const quoteBody = (accountId, lines) => ({ accountId, expiresAt: new Date(Date.now() + 86400000).toISOString(), taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines });

export const typedLine = (item, values = {}) => ({ description: 'Independent prose is not item identity', quantity: item.content.trackingPolicy === 'SERIAL' ? '2.000' : '1.250', uom: item.content.uom, unitPrice: '100.01', currency: 'USD', catalogItem: { itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision }, ...values });
export const typedBody = (accountId, lines) => ({ ...quoteBody(accountId, lines), schema: 'CATALOG_QUOTE_V1', idempotencyKey: randomUUID() });

export async function makeQuote(h, accountId, items, { stage = 'DRAFT' } = {}) {
  const body = typedBody(accountId, items.map(item => typedLine(item)));
  let quote = await h.ok('/commercial/quotes', body, 201);
  const actions = [];
  for (const action of stage === 'DRAFT' ? [] : stage === 'APPROVED' ? ['approve'] : ['approve', 'accept']) {
    const payload = { expectedVersion: quote.version, revision: quote.revisions.at(-1).number, idempotencyKey: randomUUID() };
    quote = await h.ok(`/commercial/quotes/${quote._id}/${action}`, payload);
    actions.push({ action, payload });
  }
  return { quote, body, actions };
}

export async function reviseMaster(h, item) {
  return h.ok(`/inventory-master/items/${item._id}/revisions`, command({ expectedVersion: item.version, ...item.content, description: 'Independent actual successor master revision' }));
}

export async function restoreRow(h, collection, original, replacement, effect) {
  await h.db.collection(collection).replaceOne({ _id: original._id }, replacement);
  try { return await effect(); }
  finally { await h.db.collection(collection).replaceOne({ _id: original._id }, original); }
}
