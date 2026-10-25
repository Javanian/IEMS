import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateInventoryItemAuthority } from './internal-production.mjs';
import { catalogOptionProjection } from './catalog-option-index.mjs';

export const catalogQuoteSchema = 'CATALOG_QUOTE_V1';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update((JSON.stringify(canonical(value)) ?? 'undefined')).digest('hex');
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const semantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['eventId', 'authorityHash', 'catalogEntitlement', 'documentFence'].includes(key)));
const itemSemantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['useFence', 'eventId', 'authorityHash'].includes(key)));
const revisionContent = row => Object.fromEntries(['_id', 'tenantId', 'plantId', 'ownerLegalEntityId', 'subjectId', 'revision', 'content', 'reason', 'recordedBy', 'recordedAt'].map(key => [key, row[key]]));
const supported = item => item.content?.schema === 'INVENTORY_ITEM_V2' && (item.content.kind === 'PURCHASED' && ['LOT', 'SERIAL'].includes(item.content.trackingPolicy) || item.content.kind === 'MANUFACTURED' && item.content.trackingPolicy === 'SERIAL');
const invalid = () => fail(409, 'QUOTE_SOURCE_INVALID');

export async function initializeQuoteCatalog(db) {
  for (const [name, keys] of [
    ['quoteCatalogEvents', { tenantId: 1, plantId: 1, quoteId: 1, version: 1 }],
    ['quoteCatalogKeys', { tenantId: 1, plantId: 1, key: 1 }],
    ['quoteCatalogOrders', { tenantId: 1, plantId: 1, orderId: 1 }],
    ['quoteCatalogOrders', { tenantId: 1, plantId: 1, quoteId: 1 }],
  ]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('catalogOptionSearch').createIndex({ tenantId: 1, plantId: 1, type: 1, ownerLegalEntityId: 1, quoteEligible: 1, prefixes: 1, _id: 1 }, { name: 'quote_catalog_option_prefixes' });
}

export async function quoteCatalogOwner(db, filter, session) {
  const plant = await db.collection('plants').findOne({ _id: filter.plantId, tenantId: filter.tenantId, active: true }, { session });
  const entity = plant && await db.collection('legalEntities').findOne({ _id: plant.legalEntityId, tenantId: filter.tenantId, active: true }, { session });
  if (!entity) fail(403, 'SCOPE_DENIED');
  return entity._id;
}

export function typedQuoteInput(body) {
  if (body.schema !== catalogQuoteSchema) fail(400, 'INVALID_POLICY');
  if (!Array.isArray(body.lines)) fail(400, 'INVALID_LINES');
  return body.lines.map(line => {
    if (!line || Object.keys(line).sort().join(',') !== 'catalogItem,currency,description,quantity,unitPrice,uom') fail(400, 'INVALID_LINE');
    const selector = line.catalogItem;
    if (!selector || Object.keys(selector).sort().join(',') !== 'itemId,itemRevision,itemVersion' || !uuid(selector.itemId) || !Number.isSafeInteger(selector.itemVersion) || selector.itemVersion < 1 || !Number.isSafeInteger(selector.itemRevision) || selector.itemRevision < 1) fail(400, 'INVALID_CATALOG_ITEM');
    const { catalogItem, ...financial } = line;
    return { selector: catalogItem, financial };
  });
}

export async function bindQuoteRevision(db, filter, revision, selectors, session) {
  const owner = await quoteCatalogOwner(db, filter, session);
  const lines = [];
  for (let index = 0; index < revision.lines.length; index++) {
    const selected = selectors[index], line = revision.lines[index];
    const item = await validateInventoryItemAuthority(db, filter, selected.itemId, session);
    if (item.ownerLegalEntityId !== owner) fail(404, 'NOT_FOUND');
    if (item.status !== 'APPROVED' || item.version !== selected.itemVersion || item.currentRevision !== selected.itemRevision || !supported(item)) fail(409, 'QUOTE_ITEM_CHANGED');
    if (line.uom !== item.content.uom) fail(400, 'ITEM_UOM_MISMATCH');
    if (item.content.trackingPolicy === 'SERIAL' && /[1-9]/.test(line.quantity.split('.')[1] || '')) fail(400, 'SERIAL_QUANTITY_REQUIRED');
    const changed = await db.collection('inventoryItems').updateOne({ ...filter, _id: item._id, version: item.version, authorityHash: item.authorityHash }, { $inc: { useFence: 1 } }, { session });
    if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
    const { useFence, ...itemSnapshot } = item;
    lines.push({ ...line, catalogBinding: { itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, ownerLegalEntityId: owner, code: item.code, contentHash: item.contentHash, itemSnapshot } });
  }
  return { ...revision, schema: catalogQuoteSchema, lines };
}

async function historicalBinding(db, filter, binding, session) {
  if (!binding || !uuid(binding.itemId) || !binding.itemSnapshot || !Number.isSafeInteger(binding.itemVersion) || binding.itemVersion < 1 || !Number.isSafeInteger(binding.itemRevision) || binding.itemRevision < 1) invalid();
  const source = binding.itemSnapshot;
  if (source._id !== binding.itemId || source.tenantId !== filter.tenantId || source.plantId !== filter.plantId || source.ownerLegalEntityId !== binding.ownerLegalEntityId || source.version !== binding.itemVersion || source.currentRevision !== binding.itemRevision || source.code !== binding.code || source.contentHash !== binding.contentHash || source.status !== 'APPROVED' || !supported(source) || source.approval?.revision !== binding.itemRevision || source.approval.contentHash !== binding.contentHash) invalid();
  const event = await db.collection('internalPlanningEvents').findOne({ ...filter, _id: source.eventId, subjectType: 'ITEM', subjectId: source._id }, { session });
  const revision = await db.collection('inventoryItemRevisions').findOne({ ...filter, subjectId: source._id, revision: binding.itemRevision }, { session });
  if (!event || event.version !== source.version || event.status !== 'APPROVED' || event.contentHash !== source.authorityHash || hash(event.snapshot) !== source.authorityHash || hash(itemSemantic(source)) !== source.authorityHash || !revision || revision.ownerLegalEntityId !== source.ownerLegalEntityId || hash(revisionContent(revision)) !== revision.contentHash || revision.contentHash !== source.contentHash || hash(revision.content) !== hash(source.content)) invalid();
}

export async function hasQuoteCatalogEvidence(db, filter, quote, session) {
  if (Object.hasOwn(quote, 'schema') || Array.isArray(quote.revisions) && quote.revisions.some(revision => revision && (Object.hasOwn(revision, 'schema') || Array.isArray(revision.lines) && revision.lines.some(line => line && Object.hasOwn(line, 'catalogBinding'))))) return true;
  return Boolean(await db.collection('quoteCatalogEvents').findOne({ ...filter, quoteId: quote._id }, { session }) || await db.collection('quoteCatalogKeys').findOne({ ...filter, quoteId: quote._id }, { session }) || await db.collection('quoteCatalogOrders').findOne({ ...filter, quoteId: quote._id }, { session }));
}

export async function validateCatalogQuote(db, filter, row, session) {
  if (!await hasQuoteCatalogEvidence(db, filter, row, session)) return false;
  if (row.schema !== catalogQuoteSchema || !uuid(row.ownerLegalEntityId) || !Number.isSafeInteger(row.version) || row.version < 1 || !['DRAFT', 'APPROVED', 'ACCEPTED', 'CONVERTED'].includes(row.status) || !Array.isArray(row.revisions) || !row.revisions.length || row.revisions.length > 50) invalid();
  const events = await db.collection('quoteCatalogEvents').find({ ...filter, quoteId: row._id }, { session }).sort({ version: 1 }).limit(202).toArray();
  if (events.length !== row.version || events.length > 201) invalid();
  let previousHash = null;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const key = await db.collection('quoteCatalogKeys').findOne({ ...filter, key: event.key, quoteId: row._id }, { session });
    if (event.version !== index + 1 || event.snapshot?._id !== row._id || event.snapshot?.schema !== catalogQuoteSchema || event.snapshot?.version !== event.version || event.previousHash !== previousHash || hash(event.snapshot) !== event.contentHash || !key || !key.result || typeof key.result !== 'object' || Array.isArray(key.result) || key.quoteHash !== event.contentHash || hash(key.result) !== key.resultHash || event.snapshot.commandProof?.key !== event.key || event.snapshot.commandProof?.kind !== event.kind || event.snapshot.commandProof?.payloadHash !== key.payloadHash || key.kind !== event.kind) invalid();
    if (key.kind !== 'convert') {
      if (!isDeepStrictEqual(semantic(key.result), event.snapshot) || key.result.eventId !== event._id || key.result.authorityHash !== event.contentHash) invalid();
    } else {
      const order = await db.collection('salesOrders').findOne({ ...filter, _id: event.snapshot.orderId }, { session });
      const proof = await db.collection('quoteCatalogOrders').findOne({ ...filter, orderId: event.snapshot.orderId, quoteId: row._id }, { session });
      if (!order || !proof || !isDeepStrictEqual(order, key.result) || proof.orderHash !== hash(order) || proof.quoteHash !== event.contentHash) invalid();
    }
    previousHash = event.contentHash;
  }
  if (events.at(-1)._id !== row.eventId || previousHash !== row.authorityHash || hash(semantic(row)) !== previousHash) invalid();
  const seen = new Map();
  for (const revision of row.revisions) {
    if (revision.number !== seen.size + 1 || revision.schema !== catalogQuoteSchema || !Array.isArray(revision.lines) || !revision.lines.length || revision.lines.length > 100) invalid();
    seen.set(revision.number, revision);
    for (const line of revision.lines) {
      await historicalBinding(db, filter, line.catalogBinding, session);
      if (Object.hasOwn(line, 'catalogItem') || Object.hasOwn(line, 'provenance') || line.catalogBinding.ownerLegalEntityId !== row.ownerLegalEntityId || line.uom !== line.catalogBinding.itemSnapshot.content.uom || line.catalogBinding.itemSnapshot.content.trackingPolicy === 'SERIAL' && /[1-9]/.test(line.quantity?.split('.')[1] || '')) invalid();
    }
  }
  for (const approval of row.approvals || []) if (!isDeepStrictEqual(approval.snapshot, seen.get(approval.revision)) || !uuid(approval.approvedBy) || !(approval.approvedAt instanceof Date)) invalid();
  const latest = row.revisions.at(-1);
  if (['APPROVED', 'ACCEPTED', 'CONVERTED'].includes(row.status) && !(row.approvals || []).some(approval => approval.revision === latest.number)) invalid();
  if (['ACCEPTED', 'CONVERTED'].includes(row.status) && (row.acceptedRevision !== latest.number || !uuid(row.acceptedBy) || !(row.acceptedAt instanceof Date))) invalid();
  return true;
}

export async function quoteCurrentDependencies(db, filter, row, session, fence = false) {
  const owner = await quoteCatalogOwner(db, filter, session), blockers = [], lines = [];
  for (const [lineIndex, line] of row.revisions.at(-1).lines.entries()) {
    const binding = line.catalogBinding;
    let item;
    try { item = await validateInventoryItemAuthority(db, filter, binding.itemId, session); }
    catch (error) { if (error.status !== 404) throw error; }
    const eligible = owner === row.ownerLegalEntityId && item && item.ownerLegalEntityId === owner && item.status === 'APPROVED' && item.version === binding.itemVersion && item.currentRevision === binding.itemRevision && item.contentHash === binding.contentHash && item.authorityHash === binding.itemSnapshot.authorityHash && supported(item);
    if (!eligible) blockers.push({ lineIndex, code: 'QUOTE_ITEM_CHANGED' });
    else if (fence) {
      const changed = await db.collection('inventoryItems').updateOne({ ...filter, _id: item._id, version: item.version, authorityHash: item.authorityHash }, { $inc: { useFence: 1 } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
    }
    const content = binding.itemSnapshot.content;
    lines.push({ lineIndex, itemId: binding.itemId, itemVersion: binding.itemVersion, itemRevision: binding.itemRevision, code: binding.code, uom: content.uom, kind: content.kind, trackingPolicy: content.trackingPolicy });
  }
  if (fence && blockers.length) fail(409, 'QUOTE_ITEM_CHANGED');
  return { schema: catalogQuoteSchema, historicalBound: true, stockDispatchAllowed: false, currentEligible: blockers.length === 0, blockers, lines };
}

export async function catalogQuoteView(db, filter, row, session) {
  if (!await validateCatalogQuote(db, filter, row, session)) return row;
  return { ...row, catalogEntitlement: await quoteCurrentDependencies(db, filter, row, session) };
}

export async function saveCatalogQuote(db, filter, row, session, { key, kind, payloadHash, result }) {
  if (row.version > 201) fail(409, 'REVISION_CONFLICT');
  row.commandProof = { key, kind, payloadHash };
  const snapshot = semantic(row), contentHash = hash(snapshot), eventId = randomUUID();
  await db.collection('quoteCatalogEvents').insertOne({ _id: eventId, ...filter, quoteId: row._id, version: row.version, key, kind, previousHash: row.authorityHash || null, contentHash, snapshot, recordedAt: new Date() }, { session });
  row.eventId = eventId; row.authorityHash = contentHash;
  const output = result || row;
  await db.collection('quoteCatalogKeys').insertOne({ _id: randomUUID(), ...filter, key, kind, quoteId: row._id, payloadHash, quoteHash: contentHash, result: structuredClone(output), resultHash: hash(output) }, { session });
}

export async function validateCatalogOrder(db, filter, order, session) {
  const proof = await db.collection('quoteCatalogOrders').findOne({ ...filter, orderId: order._id }, { session });
  const marked = Object.hasOwn(order, 'schema') || order.snapshot?.schema !== undefined || Array.isArray(order.snapshot?.lines) && order.snapshot.lines.some(line => line && Object.hasOwn(line, 'catalogBinding'));
  const quote = await db.collection('quotes').findOne({ ...filter, _id: order.quoteId }, { session });
  const typedQuote = quote && await hasQuoteCatalogEvidence(db, filter, quote, session);
  if (!proof && !marked && !typedQuote) return false;
  if (!proof || !quote || !await validateCatalogQuote(db, filter, quote, session) || order.schema !== 'CATALOG_SALES_ORDER_V1' || order.ownerLegalEntityId !== quote.ownerLegalEntityId || proof.quoteId !== quote._id || proof.orderHash !== hash(order) || proof.quoteHash !== quote.authorityHash || quote.status !== 'CONVERTED' || quote.orderId !== order._id || order.quoteRevision !== quote.acceptedRevision || order.accountId !== quote.accountId || !isDeepStrictEqual(order.snapshot, quote.approvals.find(approval => approval.revision === order.quoteRevision)?.snapshot)) invalid();
  return quote;
}

export async function catalogOrderView(db, filter, order, session) {
  const quote = await validateCatalogOrder(db, filter, order, session);
  return quote ? { ...order, catalogEntitlement: await quoteCurrentDependencies(db, filter, quote, session) } : order;
}

export async function requireUnboundSalesOrder(db, filter, order, session) {
  if (await validateCatalogOrder(db, filter, order, session)) fail(409, 'CATALOG_ORDER_UNSUPPORTED');
}

export async function saveCatalogOrder(db, filter, quote, order, session) {
  await db.collection('quoteCatalogOrders').insertOne({ _id: randomUUID(), ...filter, orderId: order._id, quoteId: quote._id, quoteHash: quote.authorityHash, orderHash: hash(order) }, { session });
}

export function quoteCatalogKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
  return key;
}
export const quoteCatalogPayloadHash = hash;

export async function quoteCatalogReplay(db, filter, key, payloadHash, session) {
  const prior = await db.collection('quoteCatalogKeys').findOne({ ...filter, key }, { session });
  if (!prior) return null;
  if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
  if (!prior.result || typeof prior.result !== 'object' || Array.isArray(prior.result) || hash(prior.result) !== prior.resultHash) invalid();
  const current = await db.collection('quotes').findOne({ ...filter, _id: prior.quoteId }, { session });
  if (!current || !await validateCatalogQuote(db, filter, current, session)) invalid();
  const event = await db.collection('quoteCatalogEvents').findOne({ ...filter, quoteId: current._id, key }, { session });
  if (!event || event.contentHash !== prior.quoteHash) invalid();
  if (prior.kind === 'convert') {
    const order = await db.collection('salesOrders').findOne({ ...filter, _id: prior.result._id }, { session });
    if (!order || !isDeepStrictEqual(order, prior.result)) invalid();
    return { ...await catalogOrderView(db, filter, order, session), replay: true };
  }
  // Readiness describes the bindings returned in this historical result.
  return { ...prior.result, catalogEntitlement: await quoteCurrentDependencies(db, filter, prior.result, session), replay: true };
}

export async function catalogItemOption(db, filter, itemId, session) {
  const owner = await quoteCatalogOwner(db, filter, session), item = await validateInventoryItemAuthority(db, filter, itemId, session);
  if (item.ownerLegalEntityId !== owner) fail(404, 'NOT_FOUND');
  const eligible = item.status === 'APPROVED' && supported(item);
  return { _id: item._id, code: item.code, version: item.version, currentRevision: item.currentRevision, content: item.content, ownerLegalEntityId: owner, eligible, blockers: eligible ? [] : ['QUOTE_ITEM_CHANGED'] };
}

export function installQuoteCatalogOptions(app, runtime, { id, fail }) {
  const read = async effect => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); }
    finally { await session.endSession(); }
  };
  app.get('/api/commercial/catalog-items', async (req, res) => {
    if (Object.keys(req.query).some(key => !['q', 'cursor', 'limit', 'tenantId', 'plantId'].includes(key))) fail(400, 'INVALID_FIELDS');
    const q = req.query.q ?? '', limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (typeof q !== 'string' || q.length > 80) fail(400, 'INVALID_SEARCH');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit)) fail(400, 'INVALID_PAGINATION');
    const cursor = req.query.cursor === undefined ? null : id(req.query.cursor);
    const data = await read(async session => {
      const owner = await quoteCatalogOwner(runtime.db, req.filter, session);
      const filter = { ...req.filter, type: 'items', ownerLegalEntityId: owner, quoteEligible: true, prefixes: q.toLowerCase(), ...(cursor ? { _id: { $gt: cursor } } : {}) };
      const candidates = await runtime.db.collection('catalogOptionSearch').find(filter, { session }).hint('quote_catalog_option_prefixes').sort({ _id: 1 }).limit(limit + 1).toArray();
      const options = [];
      for (const candidate of candidates) {
        const source = await validateInventoryItemAuthority(runtime.db, req.filter, candidate._id, session);
        if (!isDeepStrictEqual(candidate, catalogOptionProjection('items', source))) fail(409, 'CATALOG_SEARCH_SOURCE_INVALID');
        const option = await catalogItemOption(runtime.db, req.filter, source._id, session);
        if (!option.eligible) fail(409, 'CATALOG_SEARCH_SOURCE_INVALID');
        options.push(option);
      }
      return { data: options.slice(0, limit), page: { limit, nextCursor: options.length > limit ? options[limit - 1]._id : null } };
    });
    res.json(data);
  });
  app.get('/api/commercial/catalog-items/:id', async (req, res) => res.json({ data: await read(session => catalogItemOption(runtime.db, req.filter, id(req.params.id), session)) }));
}
