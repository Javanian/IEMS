import { createHash, randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { requireCatalogInventoryItem } from './internal-production.mjs';
import { validateCatalogDispositionState } from './catalog-disposition-state.mjs';

export const catalogActions = ['read', 'write', 'approve', 'convert', 'issue', 'receive'].map(action => `catalog.${action}`);
export const catalogRoles = Object.fromEntries(['Reader', 'Writer', 'Approver', 'Converter', 'Issuer', 'Receiver'].map((role, index) => [`catalog${role}`, [...new Set(['catalog.read', catalogActions[index]])]]));
const HEADS = { REQUEST: 'catalogPurchaseRequests', ORDER: 'catalogPurchaseOrders' }, REVS = { REQUEST: 'catalogRequestRevisions', ORDER: 'catalogOrderRevisions' };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const invalid = () => fail(409, 'CATALOG_SOURCE_INVALID');
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const semantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['useFence', 'eventId', 'authorityHash'].includes(key)));
const revisionContent = row => Object.fromEntries(['_id', 'tenantId', 'plantId', 'ownerLegalEntityId', 'subjectId', 'revision', 'content', 'reason', 'recordedBy', 'recordedAt'].map(key => [key, row[key]]));
const quantityPattern = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/;
const units = value => { if (typeof value !== 'string' || !quantityPattern.test(value)) invalid(); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
const qty = value => { if (typeof value !== 'string' || !quantityPattern.test(value) || !/[1-9]/.test(value)) fail(400, 'INVALID_QUANTITY'); return units(value); };
const decimal = value => { const raw = value.toString().padStart(7, '0'); return `${raw.slice(0, -6)}.${raw.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
const withoutHash = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contentHash'));
const physicalOf = row => Object.fromEntries(['purchaseOrderId', 'vendorId', 'lineIndex', 'quantity', 'uom', 'serials', 'lotNumber', 'heatNumber'].filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
const scopeOf = row => ({ tenantId: row.tenantId, plantId: row.plantId });
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
const money = (value, scale) => { const raw = value.toString().padStart(scale + 1, '0'); return scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw; };

async function historicalLine(db, filter, line, owner, session) {
  if (!line || !uuid(line.lineId) || !uuid(line.itemId) || !positive(line.itemVersion) || !positive(line.itemRevision) || line.ownerLegalEntityId !== owner || line.kind !== 'PURCHASED' || line.itemSchema !== 'INVENTORY_ITEM_V2' || !['LOT', 'SERIAL'].includes(line.trackingPolicy)) invalid();
  const revision = await db.collection('inventoryItemRevisions').findOne({ ...filter, subjectId: line.itemId, revision: line.itemRevision }, { session });
  const proof = await db.collection('internalPlanningEvents').findOne({ ...filter, subjectType: 'ITEM', subjectId: line.itemId, version: line.itemVersion }, { session });
  if (!revision || hash(revisionContent(revision)) !== revision.contentHash || revision.contentHash !== line.itemContentHash || revision.ownerLegalEntityId !== owner || !proof || proof.contentHash !== hash(proof.snapshot) || proof.version !== line.itemVersion || proof.status !== 'APPROVED' || proof.snapshot.status !== 'APPROVED' || proof.snapshot.version !== line.itemVersion || proof.snapshot.ownerLegalEntityId !== owner || proof.snapshot.currentRevision !== line.itemRevision || proof.snapshot.contentHash !== revision.contentHash || proof.snapshot.approval?.revision !== line.itemRevision || proof.snapshot.approval?.contentHash !== revision.contentHash || hash(proof.snapshot.content) !== hash(revision.content)) invalid();
  const content = revision.content;
  if (content.schema !== line.itemSchema || content.trackingPolicy !== line.trackingPolicy || content.kind !== line.kind || content.description !== line.description || content.uom !== line.uom || proof.snapshot.code !== line.itemCode) invalid();
  const amount = units(line.quantity);
  if (amount <= 0n || (line.trackingPolicy === 'SERIAL' && (amount % 1000000n !== 0n || amount > 100000000n))) invalid();
}

async function load(db, filter, type, id, session) {
  const row = await db.collection(HEADS[type]).findOne({ ...filter, _id: id }, { session });
  if (!row) fail(404, 'NOT_FOUND');
  if (!positive(row.version) || !positive(row.currentRevision) || row.schema !== 'CATALOG_PURCHASE_V1' || !uuid(row.eventId) || !uuid(row.ownerLegalEntityId)) invalid();
  const event = await db.collection('catalogEvents').findOne({ ...filter, _id: row.eventId, subjectType: type, subjectId: row._id }, { session });
  const rev = await db.collection(REVS[type]).findOne({ ...filter, subjectId: row._id, revision: row.currentRevision }, { session });
  if (!event || event.version !== row.version || event.status !== row.status || event.contentHash !== row.authorityHash || hash(event.snapshot) !== row.authorityHash || hash(semantic(row)) !== row.authorityHash || !rev || hash(revisionContent(rev)) !== rev.contentHash || rev.contentHash !== row.contentHash || hash(rev.content) !== hash(row.content) || rev.ownerLegalEntityId !== row.ownerLegalEntityId) invalid();
  if (!row.content || !uuid(row.content.vendorId) || !Array.isArray(row.content.lines) || !row.content.lines.length || row.content.lines.length > 20 || new Set(row.content.lines.map(line => line.itemId)).size !== row.content.lines.length || new Set(row.content.lines.map(line => line.lineId)).size !== row.content.lines.length) invalid();
  if (!await db.collection('vendors').findOne({ ...filter, _id: row.content.vendorId }, { session })) invalid();
  for (const line of row.content.lines) await historicalLine(db, filter, line, row.ownerLegalEntityId, session);
  if (type === 'REQUEST') {
    if (!['DRAFT', 'APPROVED', 'CONVERTED'].includes(row.status) || (row.status === 'DRAFT' ? row.approval !== null : row.approval?.revision !== row.currentRevision || row.approval?.contentHash !== row.contentHash) || (row.status === 'CONVERTED' ? !uuid(row.orderId) : row.orderId !== null)) invalid();
  } else {
    if (!['DRAFT', 'ISSUED'].includes(row.status) || row.currentRevision !== 1 || !uuid(row.requestId) || !positive(row.requestRevision) || (row.status === 'ISSUED' && (!row.issuedAt || !uuid(row.issuedBy)))) invalid();
    const request = await load(db, filter, 'REQUEST', row.requestId, session);
    if (request.status !== 'CONVERTED' || request.orderId !== row._id || request.currentRevision !== row.requestRevision || request.contentHash !== row.requestContentHash || request.ownerLegalEntityId !== row.ownerLegalEntityId || hash(request.content) !== hash(row.content)) invalid();
  }
  return row;
}

export async function validateCatalogReceiptOrigin(db, receipt, origin, session) {
  const filter = scopeOf(receipt);
  if (!origin || origin.receiptId !== receipt._id || origin.tenantId !== receipt.tenantId || origin.plantId !== receipt.plantId || origin.schema !== 'CATALOG_RECEIPT_ORIGIN_V1' || origin.originType !== 'CATALOG_PURCHASE' || !uuid(origin._id) || !uuid(origin.receiveMovementId) || !uuid(origin.recordedBy) || !origin.recordedAt || hash(withoutHash(origin)) !== origin.contentHash || !Object.hasOwn(receipt, 'catalogSource') || hash(receipt.catalogSource) !== hash(origin.source) || hash(physicalOf(receipt)) !== hash(origin.physical) || !positive(receipt.version) || receipt.availableQuantity !== '0' || receipt.reservedQuantity !== '0' || Object.hasOwn(receipt, 'serialCustody')) invalid();
  if (['shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].some(key => Object.hasOwn(receipt, key) && units(receipt[key]) !== 0n)) invalid();
  const order = await load(db, filter, 'ORDER', receipt.purchaseOrderId, session);
  if (order.status !== 'ISSUED' || order.content.vendorId !== receipt.vendorId || !Number.isSafeInteger(receipt.lineIndex) || receipt.lineIndex < 0) invalid();
  const line = order.content.lines[receipt.lineIndex], source = origin.source;
  if (!line || !source || hash(source) !== hash(sourceFor(order, line)) || receipt.uom !== line.uom || qtyStored(receipt.quantity) > units(line.quantity) || !Array.isArray(receipt.serials)) invalid();
  const trace = traceInput(receipt, line.trackingPolicy, true);
  if (hash(trace) !== hash(Object.fromEntries(['lotNumber', 'heatNumber'].filter(key => Object.hasOwn(receipt, key)).map(key => [key, receipt[key]])))) invalid();
  if (line.trackingPolicy === 'LOT' ? receipt.serials.length !== 0 : receipt.serials.length < 1 || receipt.serials.length > 100 || new Set(receipt.serials).size !== receipt.serials.length || receipt.serials.some(serial => typeof serial !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(serial)) || units(receipt.quantity) !== BigInt(receipt.serials.length) * 1000000n) invalid();
  const movements = await db.collection('warehouseMovements').find({ ...filter, receiptId: receipt._id, kind: 'RECEIVE' }, { session }).limit(2).toArray(), movement = movements[0];
  if (movements.length !== 1 || movement._id !== origin.receiveMovementId || movement.version !== 1 || movement.purchaseOrderId !== receipt.purchaseOrderId || movement.vendorId !== receipt.vendorId || movement.lineIndex !== receipt.lineIndex || movement.quantity !== receipt.quantity || movement.uom !== receipt.uom || movement.from !== null || movement.to !== 'QUARANTINE' || movement.createdBy !== origin.recordedBy || receipt.createdBy !== origin.recordedBy || hash(movement.createdAt) !== hash(origin.recordedAt) || hash(receipt.createdAt) !== hash(origin.recordedAt) || hash(movement.catalogSource) !== hash(source) || hash(movement.materialTrace ?? null) !== hash(Object.keys(trace).length ? { receiptId: receipt._id, ...trace } : null)) invalid();
  const registry = await db.collection('warehouseSerials').find({ ...filter, receiptId: receipt._id }, { session }).limit(101).toArray();
  if (registry.length !== receipt.serials.length || registry.some(row => ['sourceType', 'workOrderId', 'unitId'].some(key => Object.hasOwn(row, key)) || !receipt.serials.includes(row.serial)) || new Set(registry.map(row => row.serial)).size !== registry.length) invalid();
  await validateCatalogDispositionState(db, receipt, origin, session);
  return origin;
}

const qtyStored = value => { const amount = units(value); if (amount <= 0n) invalid(); return amount; };
const sourceFor = (order, line) => ({ schema: 'CATALOG_RECEIPT_V1', purchaseOrderId: order._id, purchaseOrderRevision: 1, purchaseOrderLineId: line.lineId, purchaseOrderLineHash: hash(line), itemId: line.itemId, itemRevision: line.itemRevision, itemContentHash: line.itemContentHash, itemVersion: line.itemVersion, ownerLegalEntityId: line.ownerLegalEntityId, uom: line.uom, trackingPolicy: line.trackingPolicy });
function traceInput(body, policy, stored = false) {
  const traced = Object.hasOwn(body, 'lotNumber') || Object.hasOwn(body, 'heatNumber');
  if ((policy === 'LOT' && !traced) || (traced && ['lotNumber', 'heatNumber'].some(key => typeof body[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(body[key])))) { if (stored) invalid(); fail(400, 'INVALID_MATERIAL_TRACE'); }
  return traced ? { lotNumber: body.lotNumber, heatNumber: body.heatNumber } : {};
}

export async function initializeCatalogProcurement(db) {
  for (const [name, keys] of [
    ['catalogPurchaseOrders', { tenantId: 1, plantId: 1, requestId: 1 }], ['catalogRequestRevisions', { tenantId: 1, plantId: 1, subjectId: 1, revision: 1 }], ['catalogOrderRevisions', { tenantId: 1, plantId: 1, subjectId: 1, revision: 1 }],
    ['catalogRequestLineIds', { tenantId: 1, plantId: 1, requestId: 1, itemId: 1 }], ['catalogReceived', { tenantId: 1, plantId: 1, purchaseOrderId: 1, lineId: 1 }], ['catalogKeys', { tenantId: 1, plantId: 1, key: 1 }], ['warehouseReceiptOrigins', { tenantId: 1, plantId: 1, receiptId: 1 }],
  ]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('warehouseReceiptOrigins').createIndex({ tenantId: 1, plantId: 1, 'source.purchaseOrderId': 1, 'source.purchaseOrderLineId': 1 });
  await db.collection('catalogEvents').createIndex({ tenantId: 1, plantId: 1, subjectType: 1, subjectId: 1, _id: 1 });
}

export function installCatalogProcurement(app, runtime, { guard, fields, id }) {
  const db = runtime.db, c = name => db.collection(name), root = '/api/catalog-procurement';
  const owner = async (req, session) => { const plant = await c('plants').findOne({ _id: req.filter.plantId, tenantId: req.filter.tenantId, active: true }, { session }); if (!plant || !await c('legalEntities').findOne({ _id: plant.legalEntityId, tenantId: req.filter.tenantId, active: true }, { session })) fail(403, 'SCOPE_DENIED'); return plant.legalEntityId; };
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  const use = async (type, req, row, session) => { const result = await c(HEADS[type]).updateOne({ ...req.filter, _id: row._id, version: row.version }, { $inc: { useFence: 1 } }, { session }); if (result.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); };
  const mutation = async (req, kind, effect) => {
    if (!positive(req.body.expectedVersion)) fail(400, 'INVALID_VERSION');
    const reason = req.body.reason, key = req.body.idempotencyKey;
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) fail(400, 'INVALID_REASON');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = hash({ kind, resource: req.params.id || null, body: req.body });
    for (let attempt = 0; ; attempt++) {
      const session = runtime.client.startSession();
      try { return await session.withTransaction(async () => {
        await guard(runtime, req, session, req.catalogAction);
        const prior = await c('catalogKeys').findOne({ ...req.filter, key }, { session });
        if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
        const result = await effect(session, reason.trim(), await owner(req, session));
        const event = { ...req.filter, kind, subjectId: result._id, version: result.version, recordedBy: req.scope.userId, recordedAt: new Date() };
        await c('catalogAudit').insertOne({ _id: randomUUID(), ...event }, { session });
        await c('catalogOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
        await c('catalogKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, result }, { session }); return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
      catch (error) { if (error.code === 11000 && attempt < 3) continue; if (error.code === 11000) fail(409, error.keyPattern?.serial ? 'SERIAL_CONFLICT' : 'CATALOG_CONFLICT'); throw error; }
      finally { await session.endSession(); }
    }
  };
  app.use(root, async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    const action = req.method === 'GET' ? 'read' : req.method === 'POST' ? /^\/requests(?:\/[^/]+\/revisions)?$/.test(req.path) ? 'write' : /^\/requests\/[^/]+\/(approve|convert)$/.exec(req.path)?.[1] || (/^\/orders\/[^/]+\/issue$/.test(req.path) ? 'issue' : req.path === '/receipts' ? 'receive' : null) : null;
    if (!action) fail(404, 'NOT_FOUND'); req.catalogAction = `catalog.${action}`; await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.catalogAction }); next();
  });
  async function dependencies(req, row, session, fence = false) {
    const blockers = [], legalEntityId = await owner(req, session);
    if (row.ownerLegalEntityId !== legalEntityId) invalid();
    for (const line of row.content.lines) {
      try { const item = await requireCatalogInventoryItem(db, req.filter, line.itemId, line.itemVersion, line.itemRevision, session, fence); if (item.ownerLegalEntityId !== legalEntityId || item.contentHash !== line.itemContentHash) invalid(); }
      catch (error) { if (!['CATALOG_DEPENDENCY_CHANGED', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('ITEM_CHANGED'); }
    }
    if (fence && blockers.length) fail(409, 'CATALOG_DEPENDENCY_CHANGED'); return [...new Set(blockers)];
  }
  async function tally(req, order, line, session) {
    const filter = { ...req.filter, purchaseOrderId: order._id, lineId: line.lineId }, stored = await c('catalogReceived').findOne(filter, { session });
    const lineIndex = order.content.lines.findIndex(row => row.lineId === line.lineId), indexes = order.content.lines.map((_, index) => index);
    if (await c('warehouseReceipts').findOne({ ...req.filter, purchaseOrderId: order._id, lineIndex: { $nin: indexes } }, { session }) || await c('warehouseMovements').findOne({ ...req.filter, purchaseOrderId: order._id, kind: 'RECEIVE', lineIndex: { $nin: indexes } }, { session })) invalid();
    const origins = await c('warehouseReceiptOrigins').find({ ...req.filter, $or: [{ 'source.purchaseOrderId': order._id, 'source.purchaseOrderLineId': line.lineId }, { 'physical.purchaseOrderId': order._id, 'physical.lineIndex': lineIndex }] }, { session }).limit(101).toArray();
    const receipts = await c('warehouseReceipts').find({ ...req.filter, purchaseOrderId: order._id, lineIndex }, { session }).limit(101).toArray();
    const movements = await c('warehouseMovements').find({ ...req.filter, purchaseOrderId: order._id, lineIndex, kind: 'RECEIVE' }, { session }).limit(101).toArray();
    if (origins.length > 100 || receipts.length !== origins.length || movements.length !== origins.length || new Set(origins.map(row => row.receiptId)).size !== origins.length || receipts.some(row => !origins.some(origin => origin.receiptId === row._id)) || movements.some(row => !origins.some(origin => origin.receiveMovementId === row._id && origin.receiptId === row.receiptId))) invalid(); let total = 0n;
    for (const origin of origins) { const receipt = await c('warehouseReceipts').findOne({ ...req.filter, _id: origin.receiptId }, { session }); if (!receipt) invalid(); await validateCatalogReceiptOrigin(db, receipt, origin, session); total += qtyStored(receipt.quantity); }
    if (total > units(line.quantity) || (stored ? !positive(stored.version) || stored.quantity !== decimal(total) || stored.receiptCount !== origins.length : origins.length !== 0)) invalid();
    return { stored, total, origins };
  }
  async function view(type, req, row, session) {
    const blockers = await dependencies(req, row, session), common = { ...semantic(row), authorityHash: row.authorityHash, blockers };
    if (type === 'REQUEST') return { ...common, canApprove: row.status === 'DRAFT' && !blockers.length, canConvert: row.status === 'APPROVED' && !blockers.length };
    const receiving = [];
    for (const line of row.content.lines) { const total = await tally(req, row, line, session); receiving.push({ lineId: line.lineId, receivedQuantity: decimal(total.total), remainingQuantity: decimal(units(line.quantity) - total.total), receiptCount: total.origins.length, receiptIds: total.origins.map(origin => origin.receiptId) }); }
    return { ...common, canIssue: row.status === 'DRAFT' && !blockers.length, receiving };
  }
  async function receiptView(req, row, session) {
    const origin = await c('warehouseReceiptOrigins').findOne({ ...req.filter, receiptId: row._id }, { session }); await validateCatalogReceiptOrigin(db, row, origin, session);
    const order = await load(db, req.filter, 'ORDER', row.purchaseOrderId, session);
    return { ...row, receiptOrigin: { cohort: 'CATALOG', legacyEligible: false }, usable: false, blockers: [Object.hasOwn(row, 'catalogDisposition') ? 'TYPED_ALLOCATION_NOT_IMPLEMENTED' : 'TYPED_QUARANTINE_ONLY', ...await dependencies(req, order, session)] };
  }
  async function save(type, req, row, previous, kind, reason, session) {
    const snapshot = semantic(row), eventId = randomUUID(), contentHash = hash(snapshot);
    await c('catalogEvents').insertOne({ _id: eventId, ...req.filter, subjectType: type, subjectId: row._id, version: row.version, status: row.status, kind, reason, recordedBy: req.scope.userId, recordedAt: new Date(), snapshot, contentHash }, { session });
    row.eventId = eventId; row.authorityHash = contentHash;
    if (previous) { const result = await c(HEADS[type]).replaceOne({ ...req.filter, _id: row._id, version: previous }, row, { session }); if (result.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
    else await c(HEADS[type]).insertOne(row, { session });
    return view(type, req, row, session);
  }
  async function addRevision(type, req, row, reason, session) {
    const rev = { _id: randomUUID(), ...req.filter, ownerLegalEntityId: row.ownerLegalEntityId, subjectId: row._id, revision: row.currentRevision, content: row.content, reason, recordedBy: req.scope.userId, recordedAt: new Date() }; rev.contentHash = hash(revisionContent(rev)); await c(REVS[type]).insertOne(rev, { session }); row.contentHash = rev.contentHash;
  }
  const args = req => { const limit = req.query.limit === undefined ? 25 : Number(req.query.limit); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION'); return { limit, cursor: req.query.cursor === undefined ? null : id(req.query.cursor) }; };
  const page = (rows, limit) => ({ data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } });
  for (const [path, type] of [['requests', 'REQUEST'], ['orders', 'ORDER'], ['receipts', 'RECEIPT']]) {
    app.get(`${root}/${path}`, async (req, res) => res.json(await read(async session => {
      const { limit, cursor } = args(req), receipt = type === 'RECEIPT', rows = await c(receipt ? 'warehouseReceiptOrigins' : HEADS[type]).find({ ...req.filter, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(), result = page(rows, limit), data = [];
      for (const row of result.data) { if (receipt) { const physical = await c('warehouseReceipts').findOne({ ...req.filter, _id: row.receiptId }, { session }); if (!physical) invalid(); data.push(await receiptView(req, physical, session)); } else data.push(await view(type, req, await load(db, req.filter, type, row._id, session), session)); }
      return { data, page: result.page };
    })));
    app.get(`${root}/${path}/:id`, async (req, res) => res.json({ data: await read(async session => { const key = id(req.params.id); if (type !== 'RECEIPT') return view(type, req, await load(db, req.filter, type, key, session), session); const row = await c('warehouseReceipts').findOne({ ...req.filter, _id: key }, { session }); if (!row) fail(404, 'NOT_FOUND'); return receiptView(req, row, session); }) }));
    app.get(`${root}/${path}/:id/events`, async (req, res) => res.json(await read(async session => { if (type === 'RECEIPT') { const row = await c('warehouseReceipts').findOne({ ...req.filter, _id: id(req.params.id) }, { session }); if (!row) fail(404, 'NOT_FOUND'); await receiptView(req, row, session); } else await load(db, req.filter, type, id(req.params.id), session); const { limit, cursor } = args(req); return page(await c('catalogEvents').find({ ...req.filter, subjectType: type, subjectId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(), limit); })));
    if (type === 'RECEIPT') continue;
    app.get(`${root}/${path}/:id/revisions`, async (req, res) => res.json(await read(async session => { await load(db, req.filter, type, id(req.params.id), session); const { limit, cursor } = args(req); return page(await c(REVS[type]).find({ ...req.filter, subjectId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session, projection: { revision: 1, contentHash: 1, reason: 1, recordedBy: 1, recordedAt: 1 } }).sort({ _id: 1 }).limit(limit + 1).toArray(), limit); })));
    app.get(`${root}/${path}/:id/revisions/:revision`, async (req, res) => res.json({ data: await read(async session => { await load(db, req.filter, type, id(req.params.id), session); const number = Number(req.params.revision); if (!positive(number) || !/^[1-9][0-9]*$/.test(req.params.revision)) fail(400, 'INVALID_REVISION'); const row = await c(REVS[type]).findOne({ ...req.filter, subjectId: req.params.id, revision: number }, { session }); if (!row) fail(404, 'NOT_FOUND'); if (hash(revisionContent(row)) !== row.contentHash) invalid(); return row; }) }));
  }
  async function content(req, requestId, session, legalEntityId) {
    const body = req.body;
    if (body.taxPolicy !== 'NO_TAX' || body.roundingPolicy !== 'LINE_HALF_UP') fail(400, 'INVALID_POLICY');
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 20) fail(400, 'INVALID_LINES');
    const vendorId = id(body.vendorId); if (!await c('vendors').findOne({ ...req.filter, _id: vendorId }, { session })) fail(404, 'NOT_FOUND');
    const lines = [], seen = new Set(); let currency, total = 0n;
    for (const line of body.lines) {
      fields(line, ['itemId', 'itemVersion', 'itemRevision', 'quantity', 'unitPrice', 'currency']);
      const itemId = id(line.itemId), amount = qty(line.quantity); if (!positive(line.itemVersion) || !positive(line.itemRevision)) fail(400, 'INVALID_VERSION'); if (seen.has(itemId)) fail(400, 'INVALID_LINES'); seen.add(itemId);
      const item = await requireCatalogInventoryItem(db, req.filter, itemId, line.itemVersion, line.itemRevision, session, true);
      if (item.ownerLegalEntityId !== legalEntityId) invalid();
      if (item.content.trackingPolicy === 'SERIAL' && (amount % 1000000n !== 0n || amount > 100000000n)) fail(400, 'INVALID_QUANTITY');
      if (!Object.hasOwn(scales, line.currency) || (currency && currency !== line.currency)) fail(400, 'INVALID_CURRENCY'); currency = line.currency;
      const scale = scales[currency]; if (typeof line.unitPrice !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(line.unitPrice)) fail(400, 'INVALID_PRICE');
      const denominator = 10n ** BigInt(line.quantity.split('.')[1]?.length || 0), lineTotal = (BigInt(line.quantity.replace('.', '')) * BigInt(line.unitPrice.replace('.', '')) * 2n + denominator) / (denominator * 2n); total += lineTotal;
      const registry = { ...req.filter, requestId, itemId }, previous = await c('catalogRequestLineIds').findOne(registry, { session }), lineId = previous?.lineId || randomUUID(); if (!uuid(lineId)) invalid(); if (!previous) await c('catalogRequestLineIds').insertOne({ _id: randomUUID(), ...registry, lineId }, { session });
      lines.push({ lineId, itemId, itemVersion: item.version, itemRevision: item.currentRevision, itemContentHash: item.contentHash, itemCode: item.code, description: item.content.description, uom: item.content.uom, kind: item.content.kind, itemSchema: item.content.schema, trackingPolicy: item.content.trackingPolicy, ownerLegalEntityId: legalEntityId, quantity: line.quantity, unitPrice: line.unitPrice, currency, lineTotal: money(lineTotal, scale) });
    }
    return { vendorId, lines, currency, total: money(total, scales[currency]), taxPolicy: body.taxPolicy, roundingPolicy: body.roundingPolicy };
  }
  const common = ['expectedVersion', 'reason', 'idempotencyKey'];
  for (const revise of [false, true]) app.post(`${root}/requests${revise ? '/:id/revisions' : ''}`, async (req, res) => {
    fields(req.body, [...common, 'vendorId', 'lines', 'taxPolicy', 'roundingPolicy']);
    const data = await mutation(req, revise ? 'request.revise' : 'request.create', async (session, reason, legalEntityId) => {
      let row, previous = null;
      if (revise) { row = await load(db, req.filter, 'REQUEST', id(req.params.id), session); if (row.version !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT'); if (row.status === 'CONVERTED') fail(409, 'STATE_CONFLICT'); if (row.currentRevision >= 100) fail(409, 'REVISION_CONFLICT'); if (row.ownerLegalEntityId !== legalEntityId) invalid(); previous = row.version; row.version++; row.currentRevision++; }
      else { if (req.body.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT'); row = { _id: randomUUID(), ...req.filter, ownerLegalEntityId: legalEntityId, schema: 'CATALOG_PURCHASE_V1', version: 1, currentRevision: 1 }; }
      row.content = await content(req, row._id, session, legalEntityId); row.status = 'DRAFT'; row.approval = null; row.orderId = null;
      await addRevision('REQUEST', req, row, reason, session); return save('REQUEST', req, row, previous, revise ? 'REVISED' : 'CREATED', reason, session);
    }); res.status(revise ? 200 : 201).json({ data });
  });
  for (const operation of ['approve', 'convert', 'issue']) app.post(`${root}/${operation === 'issue' ? 'orders' : 'requests'}/:id/${operation}`, async (req, res) => {
    fields(req.body, [...common, ...(operation === 'approve' ? ['revision'] : [])]); if (operation === 'approve' && !positive(req.body.revision)) fail(400, 'INVALID_REVISION');
    const data = await mutation(req, `catalog.${operation}`, async (session, reason) => {
      const type = operation === 'issue' ? 'ORDER' : 'REQUEST', row = await load(db, req.filter, type, id(req.params.id), session), previous = row.version;
      if (previous !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (row.status !== ({ approve: 'DRAFT', convert: 'APPROVED', issue: 'DRAFT' }[operation])) fail(409, 'STATE_CONFLICT');
      await dependencies(req, row, session, true);
      if (operation === 'approve') { if (req.body.revision !== row.currentRevision) fail(409, 'REVISION_CONFLICT'); row.status = 'APPROVED'; row.approval = { revision: row.currentRevision, contentHash: row.contentHash, approvedBy: req.scope.userId, approvedAt: new Date() }; }
      if (operation === 'issue') { row.status = 'ISSUED'; row.issuedAt = new Date(); row.issuedBy = req.scope.userId; }
      if (operation === 'convert') {
        const order = { _id: randomUUID(), ...req.filter, ownerLegalEntityId: row.ownerLegalEntityId, schema: row.schema, version: 1, currentRevision: 1, status: 'DRAFT', requestId: row._id, requestRevision: row.currentRevision, requestContentHash: row.contentHash, content: structuredClone(row.content) };
        await addRevision('ORDER', req, order, reason, session); row.status = 'CONVERTED'; row.orderId = order._id; row.version++;
        await save('REQUEST', req, row, previous, 'CONVERTED', reason, session); return save('ORDER', req, order, null, 'CREATED', reason, session);
      }
      row.version++; return save(type, req, row, previous, operation.toUpperCase(), reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/receipts`, async (req, res) => {
    fields(req.body, [...common, 'purchaseOrderId', 'vendorId', 'lineId', 'quantity', 'serials', 'lotNumber', 'heatNumber']);
    const purchaseOrderId = id(req.body.purchaseOrderId), vendorId = id(req.body.vendorId), lineId = id(req.body.lineId), amount = qty(req.body.quantity), serials = Object.hasOwn(req.body, 'serials') ? req.body.serials : [];
    if (!Array.isArray(serials) || serials.length > 100 || serials.some(serial => typeof serial !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(serial)) || new Set(serials).size !== serials.length) fail(400, 'INVALID_SERIALS');
    const data = await mutation(req, 'receipt.received', async (session, reason) => {
      const order = await load(db, req.filter, 'ORDER', purchaseOrderId, session); if (order.version !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT'); if (order.status !== 'ISSUED') fail(409, 'STATE_CONFLICT'); if (order.content.vendorId !== vendorId) fail(409, 'VENDOR_CONFLICT');
      const lineIndex = order.content.lines.findIndex(line => line.lineId === lineId), line = order.content.lines[lineIndex]; if (!line) fail(400, 'INVALID_LINE');
      const trace = traceInput(req.body, line.trackingPolicy);
      if (line.trackingPolicy === 'LOT' ? serials.length !== 0 : serials.length < 1 || amount !== BigInt(serials.length) * 1000000n) fail(400, 'INVALID_SERIALS');
      await dependencies(req, order, session, true); await use('ORDER', req, order, session);
      const received = await tally(req, order, line, session); if (received.origins.length >= 100 || received.total + amount > units(line.quantity)) fail(409, 'QUANTITY_EXCEEDED');
      const total = { quantity: decimal(received.total + amount), receiptCount: received.origins.length + 1 };
      if (received.stored) { const result = await c('catalogReceived').updateOne({ _id: received.stored._id, ...req.filter, version: received.stored.version }, { $set: total, $inc: { version: 1 } }, { session }); if (result.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
      else await c('catalogReceived').insertOne({ _id: randomUUID(), ...req.filter, purchaseOrderId, lineId, version: 1, ...total }, { session });
      const time = new Date(), source = sourceFor(order, line), row = { _id: randomUUID(), ...req.filter, version: 1, createdAt: time, createdBy: req.scope.userId, purchaseOrderId, vendorId, lineIndex, quantity: req.body.quantity, uom: line.uom, serials, ...trace, status: 'QUARANTINED', availableQuantity: '0', reservedQuantity: '0', catalogSource: source };
      for (const serial of serials) { if (await c('warehouseSerials').findOne({ ...req.filter, serial }, { session })) fail(409, 'SERIAL_CONFLICT'); await c('warehouseSerials').insertOne({ _id: randomUUID(), ...req.filter, serial, receiptId: row._id }, { session }); }
      const movement = { _id: randomUUID(), ...req.filter, version: 1, createdAt: time, createdBy: req.scope.userId, receiptId: row._id, purchaseOrderId, vendorId, lineIndex, uom: line.uom, quantity: row.quantity, kind: 'RECEIVE', from: null, to: 'QUARANTINE', catalogSource: source, ...(Object.keys(trace).length ? { materialTrace: { receiptId: row._id, ...trace } } : {}) };
      const origin = { _id: randomUUID(), ...req.filter, receiptId: row._id, originType: 'CATALOG_PURCHASE', schema: 'CATALOG_RECEIPT_ORIGIN_V1', source, physical: physicalOf(row), receiveMovementId: movement._id, recordedBy: req.scope.userId, recordedAt: time }; origin.contentHash = hash(origin);
      await c('warehouseReceipts').insertOne(row, { session }); await c('warehouseMovements').insertOne(movement, { session }); await c('warehouseReceiptOrigins').insertOne(origin, { session });
      await c('catalogEvents').insertOne({ _id: randomUUID(), ...req.filter, subjectType: 'RECEIPT', subjectId: row._id, version: 1, status: row.status, kind: 'RECEIVED', reason, recordedBy: req.scope.userId, recordedAt: time, contentHash: origin.contentHash, originId: origin._id }, { session });
      return receiptView(req, row, session);
    }); res.status(201).json({ data });
  });
}
