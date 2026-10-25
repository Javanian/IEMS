import { randomUUID, createHash } from 'node:crypto';
import { loadConsumedCustodyForInstallation } from './serial-custody.mjs';
import { validHoldCache, receiptHoldState, requireEligibleReceipt } from './stock-holds.mjs';
import { requireLegacyReceipt } from './receipt-origin.mjs';

export const installationActions = ['installation.read', 'installation.record', 'installation.finalize', 'installation.remove'];
export const installationRoles = Object.fromEntries(['Reader', 'Recorder', 'Finalizer', 'Remover'].map((name, index) => [`installation${name}`, ['manufacturing.read', 'installation.read', ...(index ? [installationActions[index]] : [])]]));
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v)) ?? 'undefined').digest('hex');
const scope = wo => ({ tenantId: wo.tenantId, plantId: wo.plantId });
const filter = wo => ({ ...scope(wo), workOrderId: wo._id });
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const qty = v => { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(v)) fail(409, 'INSTALLATION_SOURCE_INVALID'); return BigInt(v.split('.')[0]) * 1000000n + BigInt((v.split('.')[1] || '').padEnd(6, '0')); };
const decimal = n => { const s = n.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
const note = v => { if (typeof v !== 'string' || v.trim().length < 3 || v.trim().length > 500) fail(400, 'INVALID_INSTALLATION'); return v.trim(); };
const positive = v => { if (!Number.isSafeInteger(v) || v < 1) fail(400, 'INVALID_VERSION'); return v; };
const k1Content = row => Object.fromEntries(['workOrderId', 'revision', 'status', 'reason', 'recordedBy', 'recordedAt', 'allocations', 'losses', 'sources'].map(k => [k, row[k]]));
const revisionContent = row => Object.fromEntries(['workOrderId', 'revision', 'status', 'graphVersion', 'k1', 'sources', 'edges', 'losses', 'reason', 'recordedBy', 'recordedAt'].map(k => [k, row[k]]));
const publicLink = row => Object.fromEntries(['_id', 'version', 'childType', 'childId', 'serial', ...(row.outputUnitId ? ['outputUnitId'] : []), 'receiptId', 'claimId', 'uom', 'movementId', 'materialTrace', 'status'].map(k => [k, row[k]]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateHead(head, revision) {
  if (!Number.isSafeInteger(head.version) || head.version < 1 || !Number.isSafeInteger(head.currentRevision) || head.currentRevision < 1 || !['DRAFT', 'COMPLETE', 'FROZEN'].includes(head.status) || !revision || revision.revision !== head.currentRevision || !['DRAFT', 'COMPLETE'].includes(revision.status)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  if (head.status === 'FROZEN') {
    if (revision.status !== 'COMPLETE' || !head.frozen || head.frozen.revision !== head.currentRevision || head.frozen.contentHash !== head.contentHash || typeof head.frozen.firstShipmentId !== 'string' || !UUID.test(head.frozen.firstShipmentId)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  } else if (head.status !== revision.status || (head.frozen !== undefined && head.frozen !== null)) fail(409, 'INSTALLATION_SOURCE_INVALID');
}

export async function initializeComponentInstallation(db) {
  for (const [collection, fields] of [
    ['componentInstallationHeads', { tenantId: 1, plantId: 1, workOrderId: 1 }],
    ['componentInstallationRevisions', { tenantId: 1, plantId: 1, workOrderId: 1, revision: 1 }],
    ['componentInstallationLinks', { tenantId: 1, plantId: 1, childType: 1, childId: 1 }],
    ['componentInstallationGraph', { tenantId: 1, plantId: 1 }],
  ]) await db.collection(collection).createIndex(fields, { unique: true });
  await db.collection('componentInstallationEvents').createIndex({ tenantId: 1, plantId: 1, workOrderId: 1, _id: 1 });
}

async function sourceHolds(db, wo, sources, session, enforce = false) {
  const result = [];
  for (const source of sources) {
    const receipt = await db.collection('warehouseReceipts').findOne({ ...scope(wo), _id: source.receiptId }, { session });
    if (!receipt) fail(409, 'INSTALLATION_SOURCE_INVALID');
    const invalid = receipt.hold !== undefined && receipt.hold !== null && !validHoldCache(receipt.hold);
    if (enforce) {
      await requireLegacyReceipt(db, receipt, session);
      if (invalid) fail(409, 'STOCK_ENCUMBERED'); await requireEligibleReceipt(db, receipt, session);
      const changed = await db.collection('warehouseReceipts').updateOne({ ...scope(wo), _id: receipt._id }, { $inc: { installationFence: 1 } }, { session });
      if (changed.matchedCount !== 1) fail(409, 'INSTALLATION_SOURCE_INVALID');
    } else {
      const state = await receiptHoldState(db, receipt, session);
      if (invalid || state.held) result.push({ receiptId: receipt._id, holdIds: state.activeHolds.map(h => h._id), reasonCodes: invalid ? ['INVALID_HOLD_CACHE'] : state.activeHolds.map(h => h.reasonCode), legacy: invalid || state.legacy.length > 0 || (state.cacheActive && !state.activeHolds.length) });
    }
  }
  return result;
}

async function k1State(db, wo, sources, session) {
  const head = await db.collection('genealogyHeads').findOne(filter(wo), { session });
  const allocations = (await db.collection('genealogyAllocations').find(filter(wo), { session }).sort({ outputUnitId: 1, receiptId: 1 }).toArray()).map(row => Object.fromEntries(['outputUnitId', 'serial', 'receiptId', 'quantity', 'uom', 'movementId', 'materialTrace'].map(k => [k, row[k]])));
  const losses = head?.losses || [];
  if (head) {
    const revision = await db.collection('genealogyRevisions').findOne({ ...filter(wo), revision: head.currentRevision }, { session });
    validateHead(head, revision);
    if (!revision || revision.contentHash !== head.contentHash || hash(k1Content(revision)) !== revision.contentHash || hash(revision.allocations) !== hash(allocations) || hash(revision.losses) !== hash(losses) || hash(revision.sources) !== hash(sources)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  } else if (allocations.length) fail(409, 'INSTALLATION_SOURCE_INVALID');
  return { binding: { version: head?.version || 0, currentRevision: head?.currentRevision || 0, status: head?.status || 'UNRECORDED', contentHash: head?.contentHash || null, effectiveHash: hash({ allocations, losses, sources }) }, allocations, losses };
}

async function load(db, wo, session, projectionChanged = false) {
  const head = await db.collection('componentInstallationHeads').findOne(filter(wo), { session }), graph = await db.collection('componentInstallationGraph').findOne(scope(wo), { session });
  if (graph && (!Number.isSafeInteger(graph.version) || graph.version < 1)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  if (!wo.installationRequired || !['QUARANTINED', 'QC_COMPLETED'].includes(wo.status)) return { head, graphVersion: graph?.version || 0, sources: [], components: [], parents: [], edges: [], losses: [], k1: { binding: { version: 0, currentRevision: 0, status: 'UNRECORDED', contentHash: null, effectiveHash: null }, allocations: [], losses: [] } };
  let consumed;
  try { consumed = await loadConsumedCustodyForInstallation(db, wo, session); }
  catch (error) { if (typeof error.code === 'string' && error.code.startsWith('SERIAL_')) fail(409, 'INSTALLATION_SOURCE_INVALID'); throw error; }
  const { sources, components } = consumed, parents = await db.collection('manufacturingOutputUnits').find(filter(wo), { session }).sort({ _id: 1 }).limit(101).toArray();
  if (!Array.isArray(wo.output.serials) || new Set(wo.output.serials).size !== wo.output.serials.length || wo.output.serials.length !== parents.length || parents.length > 100 || BigInt(parents.length) * 1000000n !== qty(wo.output.quantity) || parents.some(p => !wo.output.serials.includes(p.serial) || !Number.isSafeInteger(p.version) || p.version < 1 || !['QUARANTINED', 'ACCEPTED', 'REJECTED', 'SHIPPED'].includes(p.status) || p.salesOrderId !== wo.salesOrderId || p.accountId !== wo.accountId || p.lineIndex !== wo.lineIndex || p.uom !== wo.uom)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  const parentRegistry = await db.collection('warehouseSerials').find({ ...scope(wo), workOrderId: wo._id }, { session }).limit(101).toArray();
  if (parentRegistry.length !== parents.length || parentRegistry.some(row => row.sourceType !== 'MANUFACTURING_OUTPUT' || !parents.some(p => p._id === row.unitId && p.serial === row.serial))) fail(409, 'INSTALLATION_SOURCE_INVALID');
  if (head && (!Number.isSafeInteger(head.version) || head.version < 1 || !Number.isSafeInteger(head.currentRevision) || head.currentRevision < 1 || !['DRAFT', 'COMPLETE', 'FROZEN'].includes(head.status) || !Number.isSafeInteger(graph?.version) || graph.version < 1)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  const links = await db.collection('componentInstallationLinks').find(filter(wo), { session }).sort({ _id: 1 }).limit(2001).toArray();
  if (links.length > 2000) fail(409, 'INSTALLATION_SOURCE_INVALID');
  for (const link of links) {
    const unit = components.find(c => c._id === link.childId), source = sources.find(s => s.receiptId === link.receiptId), marker = { workOrderId: wo._id, linkId: link._id, status: link.status, outputUnitId: link.outputUnitId || null };
    if (link.childType !== 'RECEIVED' || !['ACTIVE', 'PROCESS_LOSS', 'REMOVED_QUARANTINE'].includes(link.status) || !unit || !source || unit.claimId !== link.claimId || unit.serial !== link.serial || unit.uom !== link.uom || unit.receiptId !== link.receiptId || hash(unit.materialTrace) !== hash(link.materialTrace) || link.movementId !== source.movementId || hash(unit.installation) !== hash(marker) || !Number.isSafeInteger(link.version) || link.version < 1 || (link.status !== 'PROCESS_LOSS' && !parents.some(p => p._id === link.outputUnitId))) fail(409, 'INSTALLATION_SOURCE_INVALID');
  }
  for (const unit of components) if (Object.hasOwn(unit, 'installation') && !links.some(link => link.childId === unit._id)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  if (new Set(links.map(link => link.childId)).size !== links.length) fail(409, 'INSTALLATION_SOURCE_INVALID');
  const edges = links.filter(l => l.status !== 'PROCESS_LOSS').map(publicLink), losses = links.filter(l => l.status === 'PROCESS_LOSS').map(publicLink);
  if (!projectionChanged) {
    if (head) {
      const revision = await db.collection('componentInstallationRevisions').findOne({ ...filter(wo), revision: head.currentRevision }, { session });
      validateHead(head, revision);
      if (!revision || hash(revisionContent(revision)) !== revision.contentHash || revision.contentHash !== head.contentHash || hash(revision.edges) !== hash(edges) || hash(revision.losses) !== hash(losses) || hash(revision.sources) !== hash(sources) || !sameK1(head.k1, revision.k1)) fail(409, 'INSTALLATION_SOURCE_INVALID');
    } else if (links.length) fail(409, 'INSTALLATION_SOURCE_INVALID');
  }
  return { head, graphVersion: graph?.version || 0, sources, components, parents, edges, losses, k1: await k1State(db, wo, sources, session) };
}

function reconciliation(state, enforceBudgets = false) {
  const { sources, parents, components, edges, losses, k1 } = state, active = edges.filter(e => e.status === 'ACTIVE'), incompleteParents = [], blockers = [];
  for (const parent of parents) for (const source of sources) {
    const installed = BigInt(active.filter(e => e.outputUnitId === parent._id && e.receiptId === source.receiptId).length) * 1000000n;
    const allocated = k1.allocations.find(a => a.outputUnitId === parent._id && a.receiptId === source.receiptId);
    if (installed > qty(source.quantityPerUnit)) fail(409, 'INSTALLATION_QUANTITY_CONFLICT');
    if (installed > qty(allocated?.quantity || '0')) { if (enforceBudgets) fail(409, 'INSTALLATION_QUANTITY_CONFLICT'); if (!blockers.includes('K1_ALLOCATION_MISMATCH')) blockers.push('K1_ALLOCATION_MISMATCH'); }
    if (installed !== qty(source.quantityPerUnit)) incompleteParents.push({ outputUnitId: parent._id, receiptId: source.receiptId, requiredQuantity: source.quantityPerUnit, installedQuantity: decimal(installed) });
  }
  const balances = sources.map(source => {
    const installed = BigInt(active.filter(e => e.receiptId === source.receiptId).length) * 1000000n, lost = BigInt(losses.filter(e => e.receiptId === source.receiptId).length) * 1000000n, removed = BigInt(edges.filter(e => e.receiptId === source.receiptId && e.status === 'REMOVED_QUARANTINE').length) * 1000000n;
    const allowance = k1.losses.find(l => l.receiptId === source.receiptId);
    if (lost > qty(allowance?.quantity || '0')) { if (enforceBudgets) fail(409, 'INSTALLATION_QUANTITY_CONFLICT'); if (!blockers.includes('K1_LOSS_MISMATCH')) blockers.push('K1_LOSS_MISMATCH'); }
    const unassigned = qty(source.consumedQuantity) - installed - lost - removed;
    if (unassigned < 0n) fail(409, 'INSTALLATION_QUANTITY_CONFLICT');
    return { receiptId: source.receiptId, consumedQuantity: source.consumedQuantity, installedQuantity: decimal(installed), lossQuantity: decimal(lost), removedQuantity: decimal(removed), unassignedQuantity: decimal(unassigned), uom: source.uom };
  });
  if (!['COMPLETE', 'FROZEN'].includes(k1.binding.status)) blockers.push('K1_INCOMPLETE');
  if (incompleteParents.length) blockers.push('PARENTS_INCOMPLETE');
  if (balances.some(b => b.unassignedQuantity !== '0')) blockers.push('CONSUMED_IDENTITIES_UNASSIGNED');
  if (edges.some(e => e.status === 'REMOVED_QUARANTINE')) blockers.push('REMOVED_COMPONENT_QUARANTINE');
  if (active.length + losses.length + edges.filter(e => e.status === 'REMOVED_QUARANTINE').length !== components.length) blockers.push('IDENTITY_COUNT_MISMATCH');
  return { incompleteParents, balances, blockers };
}

const sameK1 = (a, b) => a?.currentRevision === b?.currentRevision && a?.contentHash === b?.contentHash && a?.effectiveHash === b?.effectiveHash;

async function view(db, wo, session, state) {
  state ||= await load(db, wo, session);
  const result = reconciliation(state), sourceBlockers = await sourceHolds(db, wo, state.sources, session);
  if (sourceBlockers.length) result.blockers.push('STOCK_ENCUMBERED');
  if (state.head?.status === 'FROZEN') result.blockers.push('INSTALLATION_FROZEN');
  if (state.head?.status === 'COMPLETE' && !sameK1(state.head.k1, state.k1.binding)) result.blockers.push('K1_BINDING_CHANGED');
  const canFinalize = wo.installationRequired === true && wo.status === 'QC_COMPLETED' && !!state.head && state.head.status !== 'FROZEN' && result.blockers.every(code => code === 'K1_BINDING_CHANGED') && (state.head.status === 'DRAFT' || !sameK1(state.head.k1, state.k1.binding));
  return { workOrderId: wo._id, required: wo.installationRequired === true, workOrderVersion: wo.version, version: state.head?.version || 0, currentRevision: state.head?.currentRevision || 0, status: state.head?.status || 'UNRECORDED', graphVersion: state.graphVersion, k1: state.k1.binding, sources: state.sources, parents: state.parents.map(({ _id, serial, status }) => ({ _id, serial, status })), components: state.components.map(unit => { const link = [...state.edges, ...state.losses].find(l => l.childId === unit._id); return { _id: unit._id, version: unit.version, serial: unit.serial, receiptId: unit.receiptId, claimId: unit.claimId, uom: unit.uom, status: unit.status, materialTrace: unit.materialTrace, disposition: link?.status || null, edgeId: link?._id || null, outputUnitId: link?.outputUnitId || null }; }), edges: state.edges, losses: state.losses, ...result, sourceHolds: sourceBlockers, canFinalize, frozen: state.head?.frozen || null };
}

async function graphWrite(db, wo, session) {
  const row = await db.collection('componentInstallationGraph').findOneAndUpdate(scope(wo), { $inc: { version: 1 }, $setOnInsert: { _id: randomUUID() } }, { session, upsert: true, returnDocument: 'after' });
  if (!Number.isSafeInteger(row?.version) || row.version < 1) fail(409, 'INSTALLATION_SOURCE_INVALID'); return row.version;
}

export async function freezeShipmentInstallation(db, wo, serials, shipmentId, session) {
  if (!wo.installationRequired) return null;
  if (!session?.inTransaction()) throw new Error('installation freeze requires active transaction');
  const state = await load(db, wo, session), head = state.head;
  if (!head || !['COMPLETE', 'FROZEN'].includes(head.status) || !sameK1(head.k1, state.k1.binding)) fail(409, 'INSTALLATION_INCOMPLETE');
  const snapshot = await db.collection('componentInstallationRevisions').findOne({ ...filter(wo), revision: head.currentRevision }, { session });
  const reconciled = reconciliation(state);
  if (!snapshot || snapshot.status !== 'COMPLETE' || hash(revisionContent(snapshot)) !== snapshot.contentHash || snapshot.contentHash !== head.contentHash || hash(snapshot.edges) !== hash(state.edges) || hash(snapshot.losses) !== hash(state.losses) || hash(snapshot.sources) !== hash(state.sources) || !sameK1(snapshot.k1, state.k1.binding)) fail(409, 'INSTALLATION_SOURCE_INVALID');
  if (reconciled.blockers.length || state.parents.filter(p => serials.includes(p.serial) && p.status === 'ACCEPTED').length !== serials.length) fail(409, 'INSTALLATION_INCOMPLETE');
  await sourceHolds(db, wo, state.sources, session, true); await graphWrite(db, wo, session);
  const pointer = { workOrderId: wo._id, revision: snapshot.revision, contentHash: snapshot.contentHash };
  const changed = await db.collection('componentInstallationHeads').updateOne({ ...filter(wo), version: head.version }, { $inc: { version: 1 }, $set: { status: 'FROZEN', frozen: head.frozen || { revision: pointer.revision, contentHash: pointer.contentHash, firstShipmentId: shipmentId } } }, { session });
  const fenced = await db.collection('manufacturingWorkOrders').updateOne({ ...scope(wo), _id: wo._id, version: wo.version }, { $inc: { version: 1, installationFence: 1 } }, { session });
  if (changed.matchedCount !== 1 || fenced.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  const units = await db.collection('manufacturingOutputUnits').updateMany({ ...filter(wo), serial: { $in: serials }, status: 'ACCEPTED' }, { $set: { installation: pointer } }, { session });
  if (units.matchedCount !== serials.length) fail(409, 'INSTALLATION_SOURCE_INVALID'); return pointer;
}

export function installComponentInstallation(app, runtime, { tx, find, fields, id }) {
  const db = runtime.db, base = '/api/manufacturing/work-orders/:id/installations';
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  app.get(base, async (req, res) => res.json({ data: await read(async session => view(db, await find('manufacturingWorkOrders', req, req.params.id, session), session)) }));
  for (const [path, collection] of [['events', 'componentInstallationEvents'], ['revisions', 'componentInstallationRevisions']]) app.get(`${base}/${path}`, async (req, res) => {
    await find('manufacturingWorkOrders', req, req.params.id);
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const cursor = req.query.cursor === undefined ? null : id(req.query.cursor), rows = await db.collection(collection).find({ ...req.filter, workOrderId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, path === 'revisions' ? { projection: { revision: 1, status: 1, contentHash: 1, recordedBy: 1, recordedAt: 1, reason: 1 } } : {}).sort({ _id: 1 }).limit(limit + 1).toArray();
    res.json({ data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } });
  });
  app.get(`${base}/revisions/:revision`, async (req, res) => {
    await find('manufacturingWorkOrders', req, req.params.id);
    if (!/^[1-9][0-9]*$/.test(req.params.revision) || !Number.isSafeInteger(Number(req.params.revision))) fail(400, 'INVALID_INSTALLATION');
    const row = await db.collection('componentInstallationRevisions').findOne({ ...req.filter, workOrderId: req.params.id, revision: Number(req.params.revision) }); if (!row) fail(404, 'NOT_FOUND'); res.json({ data: row });
  });
  for (const action of ['record', 'losses', 'remove', 'finalize']) app.post(`${base}/${action}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'expectedInstallationVersion', 'reason', 'idempotencyKey', ...(action === 'record' ? ['outputUnitId', 'components'] : action === 'losses' ? ['components'] : action === 'remove' ? ['edgeId', 'expectedEdgeVersion', 'expectedUnitVersion'] : [])]);
    const b = req.body, reason = note(b.reason); if (!Number.isSafeInteger(b.expectedInstallationVersion) || b.expectedInstallationVersion < 0) fail(400, 'INVALID_INSTALLATION');
    if (action === 'record') id(b.outputUnitId);
    if (['record', 'losses'].includes(action)) {
      if (!Array.isArray(b.components) || !b.components.length || b.components.length > 100 || b.components.some(c => !c || typeof c !== 'object' || Array.isArray(c)) || new Set(b.components.map(c => c.serialUnitId)).size !== b.components.length) fail(400, 'INVALID_INSTALLATION');
      for (const c of b.components) { fields(c, ['serialUnitId', 'expectedUnitVersion']); id(c.serialUnitId); positive(c.expectedUnitVersion); }
    }
    if (action === 'remove') { id(b.edgeId); positive(b.expectedEdgeVersion); positive(b.expectedUnitVersion); }
    const data = await tx(req, `installation.${action}`, async session => {
      const wo = await find('manufacturingWorkOrders', req, req.params.id, session);
      if (wo.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!wo.installationRequired) fail(409, 'INSTALLATION_NOT_REQUIRED');
      if (!['QUARANTINED', 'QC_COMPLETED'].includes(wo.status)) fail(409, 'STATE_CONFLICT');
      const state = await load(db, wo, session), head = state.head;
      if ((head?.version || 0) !== b.expectedInstallationVersion) fail(409, 'INSTALLATION_VERSION_CONFLICT');
      if (head?.status === 'FROZEN') fail(409, 'INSTALLATION_FROZEN');
      const k1Head = await db.collection('genealogyHeads').findOne(filter(wo), { session });
      if (k1Head?.status === 'FROZEN' || state.parents.some(p => p.status === 'SHIPPED' || p.genealogy || p.installation)) fail(409, 'INSTALLATION_FROZEN');
      const graphVersion = await graphWrite(db, wo, session), componentIds = [];
      if (action === 'finalize') {
        await sourceHolds(db, wo, state.sources, session, true);
        const ready = await view(db, wo, session, state);
        if (!ready.canFinalize) fail(409, 'INSTALLATION_INCOMPLETE');
      } else if (action === 'remove') {
        const edge = state.edges.find(e => e._id === b.edgeId), unit = state.components.find(c => c._id === edge?.childId);
        if (!edge) fail(404, 'NOT_FOUND');
        if (edge.status !== 'ACTIVE') fail(409, 'INSTALLATION_CHILD_UNAVAILABLE');
        if (edge.version !== b.expectedEdgeVersion || unit.version !== b.expectedUnitVersion) fail(409, 'VERSION_CONFLICT');
        const changed = await db.collection('componentInstallationLinks').updateOne({ ...filter(wo), _id: edge._id, version: edge.version, status: 'ACTIVE' }, { $set: { status: 'REMOVED_QUARANTINE' }, $inc: { version: 1 } }, { session });
        const moved = await db.collection('serialCustodyUnits').updateOne({ ...scope(wo), _id: unit._id, version: unit.version, status: 'CONSUMED' }, { $set: { installation: { workOrderId: wo._id, linkId: edge._id, status: 'REMOVED_QUARANTINE', outputUnitId: edge.outputUnitId } }, $inc: { version: 1 } }, { session });
        if (changed.matchedCount !== 1 || moved.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); componentIds.push(unit._id);
      } else {
        if (action === 'record' && !state.parents.some(p => p._id === b.outputUnitId)) fail(404, 'NOT_FOUND');
        for (const selected of b.components) {
          const unit = state.components.find(c => c._id === selected.serialUnitId), source = state.sources.find(s => s.receiptId === unit?.receiptId);
          if (!unit || !source) fail(409, 'INSTALLATION_SOURCE_INVALID');
          if (unit.version !== selected.expectedUnitVersion) fail(409, 'VERSION_CONFLICT');
          if (Object.hasOwn(unit, 'installation') || [...state.edges, ...state.losses].some(e => e.childId === unit._id)) fail(409, 'INSTALLATION_CHILD_UNAVAILABLE');
          const link = { _id: randomUUID(), ...filter(wo), version: 1, childType: 'RECEIVED', childId: unit._id, serial: unit.serial, ...(action === 'record' ? { outputUnitId: b.outputUnitId } : {}), receiptId: unit.receiptId, claimId: unit.claimId, uom: unit.uom, movementId: source.movementId, materialTrace: structuredClone(unit.materialTrace), status: action === 'record' ? 'ACTIVE' : 'PROCESS_LOSS' };
          await db.collection('componentInstallationLinks').insertOne(link, { session });
          const moved = await db.collection('serialCustodyUnits').updateOne({ ...scope(wo), _id: unit._id, version: unit.version, status: 'CONSUMED', installation: { $exists: false } }, { $set: { installation: { workOrderId: wo._id, linkId: link._id, status: link.status, outputUnitId: link.outputUnitId || null } }, $inc: { version: 1 } }, { session });
          if (moved.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); componentIds.push(unit._id);
        }
      }
      const updated = await load(db, wo, session, true); reconciliation(updated, action !== 'remove');
      const revision = (head?.currentRevision || 0) + 1, version = (head?.version || 0) + 1, recordedAt = new Date(), status = action === 'finalize' ? 'COMPLETE' : 'DRAFT';
      const snapshot = { workOrderId: wo._id, revision, status, graphVersion, k1: updated.k1.binding, sources: updated.sources, edges: updated.edges, losses: updated.losses, reason, recordedBy: req.scope.userId, recordedAt };
      const contentHash = hash(snapshot);
      await db.collection('componentInstallationRevisions').insertOne({ _id: randomUUID(), ...req.filter, ...snapshot, contentHash }, { session });
      const nextHead = { ...filter(wo), version, currentRevision: revision, status, contentHash, k1: updated.k1.binding, frozen: null };
      if (head) { const changed = await db.collection('componentInstallationHeads').updateOne({ ...filter(wo), version: head.version }, { $set: nextHead }, { session }); if (changed.matchedCount !== 1) fail(409, 'INSTALLATION_VERSION_CONFLICT'); }
      else await db.collection('componentInstallationHeads').insertOne({ _id: randomUUID(), ...nextHead }, { session });
      await db.collection('componentInstallationEvents').insertOne({ _id: randomUUID(), ...filter(wo), kind: { record: 'RECORDED', losses: 'LOSSES_RECORDED', remove: 'REMOVED', finalize: 'FINALIZED' }[action], revision, graphVersion, ...(b.outputUnitId ? { outputUnitId: b.outputUnitId } : {}), ...(b.edgeId ? { edgeId: b.edgeId } : {}), componentIds, reason, recordedBy: req.scope.userId, recordedAt }, { session });
      const fenced = await db.collection('manufacturingWorkOrders').updateOne({ ...scope(wo), _id: wo._id, version: wo.version }, { $inc: { version: 1, installationFence: 1 } }, { session });
      if (fenced.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); wo.version++;
      updated.head = nextHead; updated.graphVersion = graphVersion; return view(db, wo, session, updated);
    }); res.json({ data });
  });
}
