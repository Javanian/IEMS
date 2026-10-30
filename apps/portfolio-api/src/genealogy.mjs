import { randomUUID, createHash } from 'node:crypto';
import { receiptHoldState, requireEligibleReceipt, validHoldCache } from './stock-holds.mjs';
import { requireLegacyReceipt } from './receipt-origin.mjs';

export const genealogyActions = ['genealogy.read', 'genealogy.record', 'genealogy.finalize'];
export const genealogyRoles = {
  genealogyReader: ['manufacturing.read', 'genealogy.read'],
  genealogyRecorder: ['manufacturing.read', 'genealogy.read', 'genealogy.record'],
  genealogyFinalizer: ['manufacturing.read', 'genealogy.read', 'genealogy.finalize'],
};
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
const scopeOf = wo => ({ tenantId: wo.tenantId, plantId: wo.plantId });
const abort = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const units = value => BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0'));
const decimal = value => { const s = value.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
const quantity = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value) || !/[1-9]/.test(value)) abort(400, 'INVALID_GENEALOGY');
  return units(value);
};
const reason = value => { if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) abort(400, 'INVALID_GENEALOGY'); return value.trim(); };
const headFilter = wo => ({ ...scopeOf(wo), workOrderId: wo._id });
const revisionContent = row => Object.fromEntries(['workOrderId', 'revision', 'status', 'reason', 'recordedBy', 'recordedAt', 'allocations', 'losses', 'sources'].map(k => [k, row[k]]));

export async function initializeGenealogy(db) {
  for (const [collection, fields] of [
    ['genealogyHeads', { tenantId: 1, plantId: 1, workOrderId: 1 }],
    ['genealogyRevisions', { tenantId: 1, plantId: 1, workOrderId: 1, revision: 1 }],
    ['genealogyAllocations', { tenantId: 1, plantId: 1, workOrderId: 1, outputUnitId: 1, receiptId: 1 }],
    ['genealogyBalances', { tenantId: 1, plantId: 1, workOrderId: 1, receiptId: 1 }],
  ]) await db.collection(collection).createIndex(fields, { unique: true });
  await db.collection('genealogyAllocations').createIndex({ tenantId: 1, plantId: 1, receiptId: 1, _id: 1 });
  await db.collection('manufacturedGenealogySnapshots').createIndex({ tenantId: 1, plantId: 1, companyReceiptId: 1, companyUnitId: 1, referenceType: 1, referenceId: 1 }, { unique: true });
}

export async function readManufacturedGraph(db, filter, companyReceiptId, companyUnitId, session, { fence = false } = {}) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const { companyStockContext } = await import('./company-stock.mjs');
  const { buildCompanyUnitTrace } = await import('./company-stock-trace.mjs');
  const root = await companyStockContext(db, filter, companyReceiptId, session, { fresh: fence, fence });
  const trace = await buildCompanyUnitTrace(db, filter, root, companyUnitId, session, receiptId => companyStockContext(db, filter, receiptId, session, { fresh: fence, fence }));
  const snapshot = { schema: 'MANUFACTURED_GRAPH_V1', ...filter, ownerLegalEntityId: root.receipt.ownerLegalEntityId,
    companyReceiptId, companyUnitId, outputUnitId: trace.outputUnitId, serial: trace.serial,
    producer: { executionId: trace.producer.executionId, attributionRevision: root.producer.head.attributionRevision, provenanceHash: trace.producer.provenanceHash },
    ancestry: trace.ancestry };
  return { snapshot, contentHash: hash(snapshot), stockVersion: root.use.version, unit: root.use.units.find(unit => unit._id === companyUnitId), blockers: root.blockers };
}

export async function freezeManufacturedGraph(db, filter, companyReceiptId, expectedStockVersion, selected, reference, actor, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (!Number.isSafeInteger(expectedStockVersion) || expectedStockVersion < 1 || !Array.isArray(selected) || !selected.length || selected.length > 100 || new Set(selected.map(unit => unit?.companyUnitId)).size !== selected.length || !['INTERNAL_EXECUTION','REPAIR','SHIPMENT'].includes(reference?.type) || !uuid(reference.id) || !uuid(actor)) abort(400, 'INVALID_GENEALOGY');
  const pointers = [];
  for (const unit of selected) {
    if (!uuid(unit?.companyUnitId) || !Number.isSafeInteger(unit.expectedUnitVersion) || unit.expectedUnitVersion < 1) abort(400, 'INVALID_GENEALOGY');
    const graph = await readManufacturedGraph(db, filter, companyReceiptId, unit.companyUnitId, session, { fence: true });
    if (graph.stockVersion !== expectedStockVersion || graph.unit?.version !== unit.expectedUnitVersion) abort(409, 'VERSION_CONFLICT');
    if (graph.blockers.length || graph.unit.status !== 'AVAILABLE') abort(409, 'STOCK_ENCUMBERED');
    const match = { ...filter, companyReceiptId, companyUnitId: unit.companyUnitId, referenceType: reference.type, referenceId: reference.id };
    let row = await db.collection('manufacturedGenealogySnapshots').findOne(match, { session });
    if (row) {
      if (row.contentHash !== graph.contentHash || hash(row.snapshot) !== row.contentHash) abort(409, 'GENEALOGY_SOURCE_INVALID');
    } else {
      row = { _id: randomUUID(), ...match, snapshot: graph.snapshot, contentHash: graph.contentHash, recordedBy: actor, recordedAt: new Date() };
      await db.collection('manufacturedGenealogySnapshots').insertOne(row, { session });
      const event = { ...match, snapshotId: row._id, contentHash: row.contentHash, kind: 'manufacturedGraph.frozen', recordedBy: actor, recordedAt: row.recordedAt };
      await db.collection('manufacturedGenealogyAudit').insertOne({ _id: randomUUID(), ...event }, { session });
      await db.collection('manufacturedGenealogyOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
    }
    pointers.push({ snapshotId: row._id, companyReceiptId, companyUnitId: unit.companyUnitId, contentHash: row.contentHash });
  }
  return pointers;
}

async function context(db, wo, session) {
  if (!wo.genealogyRequired || !['QUARANTINED', 'QC_COMPLETED'].includes(wo.status)) return { sources: [], units: [] };
  const filter = headFilter(wo), sources = [];
  if (!Array.isArray(wo.routing?.materials) || !wo.routing.materials.length || wo.routing.materials.length > 20) abort(409, 'GENEALOGY_SOURCE_INVALID');
  for (const material of wo.routing.materials) {
    const movements = await db.collection('manufacturingMovements').find({ ...filter, receiptId: material.receiptId, kind: 'MATERIAL_CONSUMED' }, { session }).limit(2).toArray();
    const movement = movements[0], trace = material.materialTrace;
    if (movements.length !== 1 || !trace?.lotNumber || !trace?.heatNumber || trace.receiptId !== material.receiptId || movement.uom !== material.uom || movement.quantity !== material.quantity || movement.quantityPerUnit !== material.quantityPerUnit || hash(movement.materialTrace) !== hash(trace)) abort(409, 'GENEALOGY_SOURCE_INVALID');
    sources.push({ receiptId: material.receiptId, quantityPerUnit: material.quantityPerUnit, consumedQuantity: material.quantity, uom: material.uom, movementId: movement._id, materialTrace: structuredClone(trace) });
  }
  if (new Set(sources.map(s => s.receiptId)).size !== sources.length) abort(409, 'GENEALOGY_SOURCE_INVALID');
  const outputUnits = await db.collection('manufacturingOutputUnits').find(filter, { session }).sort({ _id: 1 }).limit(101).toArray();
  if (outputUnits.length > 100 || BigInt(outputUnits.length) * 1000000n !== units(wo.output.quantity) || outputUnits.some(u => !wo.output.serials.includes(u.serial))) abort(409, 'GENEALOGY_SOURCE_INVALID');
  return { sources, units: outputUnits };
}

async function sourceHolds(db, wo, sources, session, fence = false) {
  const holds = [];
  for (const source of sources) {
    const receipt = await db.collection('warehouseReceipts').findOne({ ...scopeOf(wo), _id: source.receiptId }, { session });
    if (!receipt) abort(409, 'GENEALOGY_SOURCE_INVALID');
    const invalidCache = receipt.hold !== undefined && receipt.hold !== null && !validHoldCache(receipt.hold);
    if (fence) {
      await requireLegacyReceipt(db, receipt, session);
      if (invalidCache) abort(409, 'STOCK_ENCUMBERED');
      await requireEligibleReceipt(db, receipt, session);
      const changed = await db.collection('warehouseReceipts').updateOne({ ...scopeOf(wo), _id: receipt._id }, { $inc: { genealogyFence: 1 } }, { session });
      if (changed.matchedCount !== 1) abort(409, 'GENEALOGY_SOURCE_INVALID');
    } else {
      const state = await receiptHoldState(db, receipt, session);
      if (state.held || invalidCache) holds.push({ receiptId: receipt._id, holdIds: state.activeHolds.map(h => h._id), reasonCodes: invalidCache ? ['INVALID_HOLD_CACHE'] : state.activeHolds.map(h => h.reasonCode), legacy: invalidCache || state.legacy.length > 0 || (state.cacheActive && !state.activeHolds.length) });
    }
  }
  return holds;
}

function reconcile(sources, outputUnits, allocations, losses) {
  const balances = sources.map(source => {
    const allocated = allocations.filter(a => a.receiptId === source.receiptId).reduce((n, a) => n + units(a.quantity), 0n);
    const lost = losses.filter(a => a.receiptId === source.receiptId).reduce((n, a) => n + units(a.quantity), 0n), remaining = units(source.consumedQuantity) - allocated - lost;
    if (remaining < 0n) abort(409, 'GENEALOGY_QUANTITY_CONFLICT');
    return { receiptId: source.receiptId, consumedQuantity: source.consumedQuantity, allocatedQuantity: decimal(allocated), lossQuantity: decimal(lost), remainingQuantity: decimal(remaining), uom: source.uom };
  });
  const incompleteUnits = [];
  for (const unit of outputUnits) for (const source of sources) {
    const allocated = allocations.filter(a => a.outputUnitId === unit._id && a.receiptId === source.receiptId).reduce((n, a) => n + units(a.quantity), 0n);
    if (allocated > units(source.quantityPerUnit)) abort(409, 'GENEALOGY_QUANTITY_CONFLICT');
    if (allocated !== units(source.quantityPerUnit)) incompleteUnits.push({ outputUnitId: unit._id, receiptId: source.receiptId, requiredQuantity: source.quantityPerUnit, allocatedQuantity: decimal(allocated) });
  }
  return { balances, incompleteUnits };
}

async function load(db, wo, session) {
  const filter = headFilter(wo), head = await db.collection('genealogyHeads').findOne(filter, { session });
  const { sources, units: outputUnits } = await context(db, wo, session);
  const stored = await db.collection('genealogyAllocations').find(filter, { session }).sort({ outputUnitId: 1, receiptId: 1 }).toArray();
  const allocations = stored.map(({ outputUnitId, serial, receiptId, quantity, uom, movementId, materialTrace }) => ({ outputUnitId, serial, receiptId, quantity, uom, movementId, materialTrace }));
  return { head, sources, outputUnits, stored, allocations, losses: head?.losses || [] };
}

async function view(db, wo, session, state) {
  const { head, sources, outputUnits, allocations, losses } = state || await load(db, wo, session);
  const { balances, incompleteUnits } = reconcile(sources, outputUnits, allocations, losses), holds = await sourceHolds(db, wo, sources, session);
  return { workOrderId: wo._id, required: wo.genealogyRequired === true, workOrderVersion: wo.version, version: head?.version || 0, currentRevision: head?.currentRevision || 0, status: head?.status || 'UNRECORDED', allocations, losses, sources, units: outputUnits.map(({ _id, serial, status }) => ({ _id, serial, status })), balances, incompleteUnits, sourceHolds: holds, canFinalize: wo.genealogyRequired === true && wo.status === 'QC_COMPLETED' && head?.status === 'DRAFT' && !incompleteUnits.length && balances.length > 0 && balances.every(b => b.remainingQuantity === '0') && !holds.length, frozen: head?.frozen || null };
}

export async function freezeShipmentGenealogy(db, wo, serials, shipmentId, session) {
  if (!wo.genealogyRequired) return null;
  if (!session?.inTransaction()) throw new Error('genealogy freeze requires active transaction');
  const state = await load(db, wo, session), { head, sources, outputUnits } = state;
  if (!head || !['COMPLETE', 'FROZEN'].includes(head.status)) abort(409, 'GENEALOGY_INCOMPLETE');
  const snapshot = await db.collection('genealogyRevisions').findOne({ ...headFilter(wo), revision: head.currentRevision }, { session });
  if (!snapshot || snapshot.status !== 'COMPLETE' || snapshot.contentHash !== head.contentHash || hash(revisionContent(snapshot)) !== snapshot.contentHash || hash(snapshot.sources) !== hash(sources) || hash(snapshot.allocations) !== hash(state.allocations) || hash(snapshot.losses) !== hash(state.losses)) abort(409, 'GENEALOGY_SOURCE_INVALID');
  const selected = outputUnits.filter(u => serials.includes(u.serial));
  if (selected.length !== serials.length || selected.some(u => u.status !== 'ACCEPTED')) abort(409, 'SERIAL_STATE_CONFLICT');
  await sourceHolds(db, wo, sources, session, true);
  const pointer = { workOrderId: wo._id, revision: snapshot.revision, contentHash: snapshot.contentHash };
  const changed = await db.collection('genealogyHeads').updateOne({ ...headFilter(wo), version: head.version, status: head.status }, { $set: { status: 'FROZEN', frozen: head.frozen || { revision: pointer.revision, contentHash: pointer.contentHash, firstShipmentId: shipmentId } }, $inc: { version: 1 } }, { session });
  if (changed.matchedCount !== 1) abort(409, 'GENEALOGY_VERSION_CONFLICT');
  const fenced = await db.collection('manufacturingWorkOrders').updateOne({ ...scopeOf(wo), _id: wo._id, version: wo.version }, { $inc: { version: 1, genealogyFence: 1 } }, { session });
  if (fenced.matchedCount !== 1) abort(409, 'VERSION_CONFLICT');
  const annotated = await db.collection('manufacturingOutputUnits').updateMany({ ...headFilter(wo), _id: { $in: selected.map(u => u._id) }, status: 'ACCEPTED' }, { $set: { genealogy: pointer } }, { session });
  if (annotated.matchedCount !== selected.length) abort(409, 'SERIAL_STATE_CONFLICT');
  return pointer;
}

export function installGenealogy(app, runtime, { tx, find, fail, fields, id }) {
  const db = runtime.db, c = name => db.collection(name), base = '/api/manufacturing/work-orders/:id/genealogy';
  const read = async (req, effect) => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(() => effect(session), transactionOptions); }
    finally { await session.endSession(); }
  };
  const pagination = req => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    return { limit, ...(req.query.cursor !== undefined ? { cursor: id(req.query.cursor) } : {}) };
  };
  app.get(base, async (req, res) => res.json({ data: await read(req, async session => view(db, await find('manufacturingWorkOrders', req, req.params.id, session), session)) }));
  app.get(`${base}/revisions`, async (req, res) => {
    const { limit, cursor } = pagination(req);
    await find('manufacturingWorkOrders', req, req.params.id);
    const rows = await c('genealogyRevisions').find({ ...req.filter, workOrderId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { projection: { revision: 1, status: 1, contentHash: 1, recordedBy: 1, recordedAt: 1, reason: 1 } }).sort({ _id: 1 }).limit(limit + 1).toArray();
    res.json({ data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } });
  });
  app.get(`${base}/revisions/:revision`, async (req, res) => {
    await find('manufacturingWorkOrders', req, req.params.id);
    if (!/^[1-9][0-9]*$/.test(req.params.revision) || !Number.isSafeInteger(Number(req.params.revision))) fail(400, 'INVALID_GENEALOGY');
    const row = await c('genealogyRevisions').findOne({ ...req.filter, workOrderId: req.params.id, revision: Number(req.params.revision) });
    if (!row) fail(404, 'NOT_FOUND'); res.json({ data: row });
  });
  app.get('/api/manufacturing/genealogy/receipts/:id', async (req, res) => {
    const { limit, cursor } = pagination(req); await find('warehouseReceipts', req, req.params.id);
    const rows = await c('genealogyAllocations').find({ ...req.filter, receiptId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).limit(limit + 1).toArray();
    res.json({ data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } });
  });
  for (const action of ['allocations', 'losses', 'finalize']) app.post(`${base}/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'expectedGenealogyVersion', 'reason', 'idempotencyKey', ...(action === 'allocations' ? ['outputUnitId', 'materials'] : action === 'losses' ? ['losses'] : [])]);
    const b = req.body, commandReason = reason(b.reason);
    if (!Number.isSafeInteger(b.expectedGenealogyVersion) || b.expectedGenealogyVersion < 0) fail(400, 'INVALID_GENEALOGY');
    let input;
    if (action !== 'finalize') {
      const entries = action === 'allocations' ? b.materials : b.losses;
      if (!Array.isArray(entries) || entries.length > 20 || entries.some(e => !e || typeof e !== 'object' || Array.isArray(e))) fail(400, 'INVALID_GENEALOGY');
      input = entries.map(entry => {
        fields(entry, ['receiptId', 'quantity', 'uom', ...(action === 'losses' ? ['reason'] : [])]);
        const receiptId = id(entry.receiptId), amount = quantity(entry.quantity);
        if (typeof entry.uom !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(entry.uom)) fail(400, 'INVALID_GENEALOGY');
        return { receiptId, quantity: decimal(amount), uom: entry.uom, ...(action === 'losses' ? { reason: reason(entry.reason) } : {}) };
      });
      if (new Set(input.map(e => e.receiptId)).size !== input.length) fail(400, 'INVALID_GENEALOGY');
      if (action === 'allocations') id(b.outputUnitId);
    }
    const data = await tx(req, `genealogy.${action}`, async session => {
      const wo = await find('manufacturingWorkOrders', req, req.params.id, session);
      if (wo.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!wo.genealogyRequired) fail(409, 'GENEALOGY_NOT_REQUIRED');
      if (!['QUARANTINED', 'QC_COMPLETED'].includes(wo.status)) fail(409, 'STATE_CONFLICT');
      const state = await load(db, wo, session), { head, sources, outputUnits, stored } = state;
      if ((head?.version || 0) !== b.expectedGenealogyVersion) fail(409, 'GENEALOGY_VERSION_CONFLICT');
      if (head?.status === 'FROZEN') fail(409, 'GENEALOGY_FROZEN');
      let allocations = [...state.allocations], losses = [...state.losses];
      if (action === 'finalize') {
        if (wo.status !== 'QC_COMPLETED' || head?.status !== 'DRAFT') fail(409, 'STATE_CONFLICT');
      } else {
        const derived = input.map(entry => {
          const source = sources.find(s => s.receiptId === entry.receiptId);
          if (!source || source.uom !== entry.uom) fail(409, 'GENEALOGY_SOURCE_INVALID');
          return { ...entry, movementId: source.movementId, materialTrace: structuredClone(source.materialTrace) };
        });
        if (action === 'allocations') {
          const unit = outputUnits.find(u => u._id === b.outputUnitId);
          if (!unit) fail(404, 'NOT_FOUND');
          if (unit.status === 'SHIPPED' || unit.genealogy) fail(409, 'GENEALOGY_FROZEN');
          allocations = allocations.filter(a => a.outputUnitId !== unit._id).concat(derived.map(entry => ({ outputUnitId: unit._id, serial: unit.serial, ...entry })));
        } else losses = derived;
      }
      allocations.sort((a, z) => a.outputUnitId.localeCompare(z.outputUnitId) || a.receiptId.localeCompare(z.receiptId));
      losses.sort((a, z) => a.receiptId.localeCompare(z.receiptId));
      const { balances, incompleteUnits } = reconcile(sources, outputUnits, allocations, losses);
      if (action === 'finalize') {
        if (incompleteUnits.length || balances.some(balance => balance.remainingQuantity !== '0')) fail(409, 'GENEALOGY_INCOMPLETE');
        await sourceHolds(db, wo, sources, session, true);
      }
      const now = new Date(), revision = (head?.currentRevision || 0) + 1, version = (head?.version || 0) + 1;
      const snapshot = { workOrderId: wo._id, revision, status: action === 'finalize' ? 'COMPLETE' : 'DRAFT', reason: commandReason, recordedBy: req.scope.userId, recordedAt: now, allocations, losses, sources };
      const contentHash = hash(snapshot);
      await c('genealogyRevisions').insertOne({ _id: randomUUID(), ...req.filter, ...snapshot, contentHash }, { session });
      const nextHead = { ...headFilter(wo), version, currentRevision: revision, status: snapshot.status, contentHash, losses, frozen: null, updatedAt: now };
      if (head) {
        const changed = await c('genealogyHeads').updateOne({ ...headFilter(wo), version: head.version }, { $set: nextHead }, { session });
        if (changed.matchedCount !== 1) fail(409, 'GENEALOGY_VERSION_CONFLICT');
      } else await c('genealogyHeads').insertOne({ _id: randomUUID(), ...nextHead }, { session });
      await c('genealogyAllocations').deleteMany(headFilter(wo), { session });
      if (allocations.length) await c('genealogyAllocations').insertMany(allocations.map(a => ({ _id: stored.find(s => s.outputUnitId === a.outputUnitId && s.receiptId === a.receiptId)?._id || randomUUID(), ...headFilter(wo), ...a, revision })), { session });
      for (const balance of balances) {
        const filter = { ...headFilter(wo), receiptId: balance.receiptId };
        const before = await c('genealogyBalances').findOne(filter, { session });
        await c('genealogyBalances').updateOne(filter, { $set: { ...balance, revision, version }, $setOnInsert: { _id: randomUUID() } }, { session, upsert: true });
        await c('genealogyAttributionLedger').insertOne({ _id: randomUUID(), ...filter, revision, kind: action, before: before ? { allocatedQuantity: before.allocatedQuantity, lossQuantity: before.lossQuantity } : { allocatedQuantity: '0', lossQuantity: '0' }, after: { allocatedQuantity: balance.allocatedQuantity, lossQuantity: balance.lossQuantity }, recordedBy: req.scope.userId, recordedAt: now, reason: commandReason }, { session });
      }
      const changed = await c('manufacturingWorkOrders').updateOne({ ...req.filter, _id: wo._id, version: wo.version }, { $inc: { version: 1, genealogyFence: 1 }, $set: { updatedAt: now } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      wo.version++;
      return view(db, wo, session, { head: nextHead, sources, outputUnits, allocations, losses });
    });
    res.json({ data });
  });
}
