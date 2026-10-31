import { randomUUID } from 'node:crypto';
import { stockHash as hash, stockHashless as hashless, stockSemantic as semantic, stockUnits as units, stockDecimal as decimal } from './catalog-stock-values.mjs';
import { shipmentSemantic } from './purchased-stock-proof.mjs';
import { validateCatalogOrder } from './quote-catalog.mjs';
import { validateInventoryItemAuthority } from './internal-production.mjs';
import { requireQualityGates } from './quality.mjs';
import { freezeDispatchDescendants, validateDispatchFreeze, requireDispatchResources } from './descendant-freeze.mjs';
import { businessNow } from './business-clock.mjs';

const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const invalid = () => fail(409, 'FULFILLMENT_STOCK_AUTHORITY_INVALID');
const same = (left, right) => hash(left) === hash(right);
const stamp = row => ({ ...row, contentHash: hash(row) });
export const fulfillmentClaimBinding = row => Object.fromEntries(['authorityKind', 'shipmentId', 'salesOrderId', 'sourceLineId', 'lineIndex', 'salesOrderSnapshotHash', 'authorizationHash', 'authorizedShipmentVersion'].map(key => [key, row[key]]));

export async function initializeManufacturedDispatch(db) {
  for (const [name, keys] of [['manufacturedShipmentAuthorizations', { tenantId: 1, plantId: 1, shipmentId: 1 }], ['manufacturedShipmentEvents', { tenantId: 1, plantId: 1, shipmentId: 1, version: 1 }], ['shipmentDescendantFreezes', { tenantId: 1, plantId: 1, shipmentId: 1, companyUnitId: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('manufacturedShipmentHeads').createIndex({ tenantId: 1, plantId: 1, salesOrderId: 1 });
}

async function authority(db, filter, shipmentId, session) {
  const options = { session }, auth = await db.collection('manufacturedShipmentAuthorizations').findOne({ ...filter, _id: shipmentId }, options);
  const head = await db.collection('manufacturedShipmentHeads').findOne({ ...filter, _id: shipmentId }, options);
  const event = head && await db.collection('manufacturedShipmentEvents').findOne({ ...filter, _id: head.eventId, shipmentId, version: head.version }, options);
  if (!auth?.snapshot || !Array.isArray(auth.snapshot.sources) || !auth.snapshot.sources.length || auth.snapshot.sources.length > 20 || auth.snapshot.version !== 1 || auth.snapshot.status !== 'APPROVED' || !head || !event || auth.shipmentId !== shipmentId || auth.snapshot.shipmentId !== shipmentId || hash(auth.snapshot) !== auth.contentHash || head.authorizationHash !== auth.contentHash || hash(semantic(head)) !== head.authorityHash || hash(event.snapshot) !== event.contentHash || event.contentHash !== head.authorityHash || !same(event.snapshot, semantic(head)) || !Array.isArray(head.refs) || new Set(head.refs.map(row => row.reservationId)).size !== head.refs.length) invalid();
  const events = await db.collection('manufacturedShipmentEvents').find({ ...filter, shipmentId }, options).sort({ version: 1 }).limit(63).toArray();
  if (events.length !== head.version || events.length > 62) invalid();
  for (const [index, prior] of events.entries()) if (prior.version !== index + 1 || prior.previousHash !== (events[index - 1]?.contentHash || null) || hash(prior.snapshot) !== prior.contentHash || prior.snapshot.authorizationHash !== auth.contentHash) invalid();
  const order = await db.collection('salesOrders').findOne({ ...filter, _id: auth.snapshot.salesOrderId }, options);
  if (!order || !await validateCatalogOrder(db, filter, order, session) || hash(order.snapshot) !== auth.snapshot.salesOrderSnapshotHash || order.accountId !== auth.snapshot.accountId || order.ownerLegalEntityId !== auth.snapshot.ownerLegalEntityId) invalid();
  if (head.status === 'DISPATCHED') {
    const key = await db.collection('fulfillmentKeys').findOne({ ...filter, 'result._id': shipmentId }, options);
    const audit = await db.collection('fulfillmentAudit').find({ ...filter, subjectId: shipmentId, kind: 'shipment.recorded' }, options).limit(2).toArray();
    const outbox = await db.collection('fulfillmentOutbox').find({ ...filter, subjectId: shipmentId, kind: 'shipment.recorded' }, options).limit(2).toArray();
    if (!key || key.result.schema !== 'MANUFACTURED_SHIPMENT_V1' || hash(shipmentSemantic(key.result)) !== head.shipmentHash || audit.length !== 1 || outbox.length !== 1 || audit[0].version !== 1 || outbox[0].version !== 1 || audit[0].userId !== auth.snapshot.authorizedBy || outbox[0].userId !== auth.snapshot.authorizedBy) invalid();
  }
  return { auth, head, order };
}

export async function validateFulfillmentStockClaim(db, filter, claim, session) {
  if (claim.authorityKind !== 'FULFILLMENT_SHIPMENT' || Object.hasOwn(claim, 'executionId') || Object.hasOwn(claim, 'caseId') || Object.hasOwn(claim, 'schema') || claim.authorizedShipmentVersion !== 1) invalid();
  const current = await authority(db, filter, claim.shipmentId, session), approved = current.auth.snapshot;
  const part = approved.sources.find(row => row.reservationId === claim._id), ref = current.head.refs.find(row => row.reservationId === claim._id);
  const effect = await db.collection('manufacturedShipmentEvents').findOne({ ...filter, shipmentId: claim.shipmentId, version: claim.effectShipmentVersion }, { session });
  if (!part || !ref || !effect || effect.kind !== claim.status || hash(effect.snapshot) !== effect.contentHash || !effect.snapshot.refs.some(row => row.reservationId === claim._id && row.contentHash === claim.contentHash && row.version === claim.version) || ref.version !== claim.version || ref.contentHash !== claim.contentHash || ref.status !== claim.status || claim.authorizationHash !== current.auth.contentHash || claim.salesOrderId !== approved.salesOrderId || claim.sourceLineId !== approved.sourceLineId || claim.lineIndex !== approved.lineIndex || claim.salesOrderSnapshotHash !== approved.salesOrderSnapshotHash || claim.companyReceiptId !== part.companyReceiptId || claim.quantity !== part.quantity || claim.uom !== approved.uom || claim.itemId !== approved.itemBinding.itemId || claim.itemRevision !== approved.itemBinding.itemRevision || claim.ownerLegalEntityId !== approved.ownerLegalEntityId || !same(claim.companyUnitIds, part.companyUnitIds) || !same(claim.serials, part.serials) || !same(claim.sourceSnapshot, part.sourceSnapshot) || claim.openingHash !== part.openingHash) invalid();
  for (const pointer of part.graph) await validateDispatchFreeze(db, filter, pointer, claim.shipmentId, session);
  if (current.head.status === 'DISPATCHED') {
    const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: claim.shipmentId }, { session });
    if (!shipment || current.head.shipmentHash !== hash(shipmentSemantic(shipment)) || claim.status !== 'CONSUMED' || !shipment.sources.some(row => row.sourceId === claim._id && row.companyReceiptId === claim.companyReceiptId)) invalid();
  }
  return { ...current, approved, part };
}

export function validateFulfillmentStockMovement(claim, movement) {
  if (!same(fulfillmentClaimBinding(claim), fulfillmentClaimBinding(movement)) || movement.materialLineId !== claim.materialLineId || movement.sourceKind !== 'COMPANY_OUTPUT' || movement.itemId !== claim.itemId || movement.itemRevision !== claim.itemRevision || movement.uom !== claim.uom || movement.ownerLegalEntityId !== claim.ownerLegalEntityId) invalid();
}

async function saveState(db, filter, shipmentId, authorizationHash, refs, status, kind, actor, session, shipmentHash = null) {
  const previous = await db.collection('manufacturedShipmentHeads').findOne({ ...filter, _id: shipmentId }, { session });
  const snapshot = { _id: shipmentId, ...filter, schema: 'MANUFACTURED_SHIPMENT_AUTHORITY_V1', shipmentId, authorizationHash, version: (previous?.version || 0) + 1, refs, status, shipmentHash };
  const eventId = randomUUID(), head = { ...snapshot, eventId, authorityHash: hash(snapshot) };
  await db.collection('manufacturedShipmentEvents').insertOne({ _id: eventId, ...filter, shipmentId, version: head.version, previousHash: previous?.authorityHash || null, kind, snapshot, contentHash: head.authorityHash, recordedBy: actor, recordedAt: new Date() }, { session });
  if (previous) { const changed = await db.collection('manufacturedShipmentHeads').replaceOne({ ...filter, _id: shipmentId, version: previous.version }, head, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
  else await db.collection('manufacturedShipmentHeads').insertOne(head, { session });
  return head;
}

async function currentLine(db, filter, order, lineIndex, session, fence = false) {
  if (!await validateCatalogOrder(db, filter, order, session)) fail(409, 'MANUFACTURED_ORDER_LINE_REQUIRED');
  const line = order.snapshot.lines[lineIndex], binding = line?.catalogBinding;
  if (!binding || binding.itemSnapshot.content.kind !== 'MANUFACTURED' || binding.itemSnapshot.content.trackingPolicy !== 'SERIAL') fail(409, 'MANUFACTURED_ORDER_LINE_REQUIRED');
  const item = await validateInventoryItemAuthority(db, filter, binding.itemId, session);
  if (order.status !== 'OPEN' || item.status !== 'APPROVED' || item.version !== binding.itemVersion || item.currentRevision !== binding.itemRevision || item.contentHash !== binding.contentHash || item.ownerLegalEntityId !== order.ownerLegalEntityId || line.uom !== item.content.uom) fail(409, 'MANUFACTURED_ITEM_CHANGED');
  if (fence) {
    const itemFence = await db.collection('inventoryItems').updateOne({ ...filter, _id: item._id, version: item.version, authorityHash: item.authorityHash }, { $inc: { useFence: 1 } }, { session });
    const orderFence = await db.collection('quoteCatalogOrders').updateOne({ ...filter, orderId: order._id, orderHash: hash(order) }, { $inc: { dispatchUseFence: 1 } }, { session });
    if (itemFence.matchedCount !== 1 || orderFence.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  }
  return line;
}

export async function validateManufacturedShipment(db, filter, shipmentId, session) {
  const shipment = await db.collection('fulfillmentShipments').findOne({ ...filter, _id: shipmentId }, { session });
  if (shipment?.schema !== 'MANUFACTURED_SHIPMENT_V1') return null;
  const current = await authority(db, filter, shipmentId, session), approved = current.auth.snapshot;
  if (current.head.status !== 'DISPATCHED' || current.head.shipmentHash !== hash(shipmentSemantic(shipment)) || shipment.status !== 'SHIPPED' || shipment.version !== 1 || shipment.salesOrderId !== approved.salesOrderId || shipment.lineIndex !== approved.lineIndex || shipment.accountId !== approved.accountId || shipment.uom !== approved.uom || !Array.isArray(shipment.sources) || shipment.sources.length !== approved.sources.length || shipment.stockMovementCount !== shipment.sources.length || current.head.refs.length !== shipment.sources.length) invalid();
  const { companyStockContext } = await import('./company-stock.mjs');
  const serials = [], movementRefs = []; let quantity = 0n;
  for (const part of shipment.sources) {
    const context = await companyStockContext(db, filter, part.companyReceiptId, session);
    const claim = context.use.reservations.find(row => row._id === part.sourceId);
    if (!claim || claim.authorityKind !== 'FULFILLMENT_SHIPMENT' || claim.shipmentId !== shipmentId || claim.status !== 'CONSUMED' || part.sourceType !== 'COMPANY_OUTPUT' || part.quantity !== claim.quantity || !same(part.companyUnitIds, claim.companyUnitIds) || !same(part.serials, claim.serials)) invalid();
    quantity += units(part.quantity); serials.push(...part.serials); movementRefs.push({ movementId: claim.consumptionId, contentHash: claim.consumptionHash });
  }
  if (quantity !== units(shipment.quantity) || new Set(serials).size !== serials.length || quantity !== BigInt(serials.length) * 1000000n) invalid();
  return { shipment: shipmentSemantic(shipment), proof: { shipmentHash: current.head.shipmentHash, movementRefs, sourceReceiptIds: shipment.sourceReceiptIds }, serials: serials.sort(), sourceReceiptIds: shipment.sourceReceiptIds, current };
}

export async function buildFulfillmentCompanyTrace(db, filter, context, companyUnitId, session, original) {
  const claims = context.use.reservations.filter(row => row.companyUnitIds.includes(companyUnitId));
  if (!claims.some(row => row.authorityKind === 'FULFILLMENT_SHIPMENT')) return original();
  const unit = context.use.units.find(row => row._id === companyUnitId), head = context.producer.head;
  if (!unit) invalid();
  const uses = { reserved: [], issued: [], consumedUnattributed: [], outputs: [], losses: [], abandoned: [], repair: [], shipments: [] };
  let graph;
  for (const claim of claims) {
    if (claim.authorityKind === 'FULFILLMENT_SHIPMENT') {
      const current = await validateFulfillmentStockClaim(db, filter, claim, session);
      const pointer = current.part.graph.find(row => row.companyUnitId === companyUnitId);
      if (!pointer) invalid();
      const frozen = await validateDispatchFreeze(db, filter, pointer, claim.shipmentId, session);
      if (graph && graph.contentHash !== frozen.contentHash) invalid(); graph = frozen;
      uses.shipments.push({ authorityKind: claim.authorityKind, shipmentId: claim.shipmentId, salesOrderId: claim.salesOrderId, sourceLineId: claim.sourceLineId, lineIndex: claim.lineIndex, reservationId: claim._id, reservationVersion: claim.version, reservationStatus: claim.status, shipmentStatus: current.head.status === 'DISPATCHED' ? 'SHIPPED' : current.head.status, quantity: '1', uom: claim.uom, authorizationHash: claim.authorizationHash, sourceHash: claim.openingHash, graph: pointer, issueId: claim.issueId, consumptionId: claim.consumptionId });
    } else if (claim.authorityKind === 'REPAIR_CASE') {
      if (claim.status !== 'RELEASED') invalid();
      const { validateRepairStockClaim } = await import('./repair-stock.mjs');
      const { row, material } = await validateRepairStockClaim(db, filter, claim, session);
      uses.repair.push({ authorityKind: 'REPAIR_CASE', reservationId: claim._id, reservationVersion: claim.version, reservationStatus: claim.status, caseId: row._id, caseNumber: row.caseNumber, caseVersion: row.version, caseStatus: row.status, component: material.component, quantity: claim.quantity, uom: claim.uom });
    } else {
      if (claim.status !== 'RELEASED' || claim.authorityKind !== undefined && claim.authorityKind !== 'INTERNAL_EXECUTION') invalid();
      const { validateInternalExecution } = await import('./internal-execution-state.mjs');
      const current = await validateInternalExecution(db, filter, claim.executionId, session);
      if (!current.reservations.some(row => same(row, claim))) invalid();
      uses.abandoned.push({ reservationId: claim._id, reservationVersion: claim.version, reservationStatus: claim.status, materialLineId: claim.materialLineId, reservationQuantity: claim.quantity, selectedQuantity: '1', consumer: { executionId: current.head._id, internalOrderId: current.head.internalOrderId, schema: current.head.schema, status: current.head.status, version: current.head.version, provenanceHash: current.head.attributionHash }, issue: null, consumption: null });
    }
  }
  if (!graph || graph.snapshot.outputUnitId !== unit.outputUnitId || graph.snapshot.serial !== unit.serial || graph.snapshot.ownerLegalEntityId !== context.receipt.ownerLegalEntityId || graph.snapshot.producer.executionId !== head._id || graph.snapshot.producer.provenanceHash !== head.attributionHash) invalid();
  const { enforceCompanyTraceResponseLimit } = await import('./company-stock-trace.mjs');
  return enforceCompanyTraceResponseLimit({ schema: context.sourcePolicy === 'MULTI_GENERATION_SOURCE' ? 'COMPANY_UNIT_TRACE_V2' : 'COMPANY_UNIT_TRACE_V1', shipmentUsesVersion: 1, companyReceiptId: context.receipt._id, companyUnitId, outputUnitId: unit.outputUnitId, serial: unit.serial, sourcePolicy: context.sourcePolicy, itemSnapshot: head.sourceDemand.itemSnapshot, ownerLegalEntityId: context.receipt.ownerLegalEntityId, locationSnapshot: context.receipt.locationSnapshot, current: { stockVersion: context.use.version, unitVersion: unit.version, status: uses.shipments.some(row => row.shipmentStatus === 'SHIPPED') ? 'SHIPPED' : unit.status, canonicalStatus: unit.status, eligible: false, hold: context.use.hold, blockers: context.blockers }, producer: { executionId: head._id, internalOrderId: head.internalOrderId, schema: head.schema, status: head.status, version: head.version, engineeringRevision: head.sourceDemand.engineering.currentRevision, provenanceHash: head.attributionHash, qc: head.qc }, ancestry: graph.snapshot.ancestry, uses, holdPolicy: { basis: 'CONSERVATIVE_CONSUMED_BATCH', receiptIds: context.receipt.consumedAncestryReceiptIds || context.receipt.consumedReceiptIds, directHold: context.use.hold }, completeness: { complete: true, oneGeneration: context.sourcePolicy !== 'MULTI_GENERATION_SOURCE', multiGeneration: context.sourcePolicy === 'MULTI_GENERATION_SOURCE', counts: { useReservations: claims.length } } });
}

export function installManufacturedDispatch(app, runtime, { guard, id, fields, tx, find, tally, base, read }) {
  const db = runtime.db;
  app.get('/api/fulfillment/manufactured/orders/:id', async (req, res) => res.json({ data: await read(async session => {
    await guard(runtime, req, session, 'company.stock.read');
    const order = await find('salesOrders', req, req.params.id, session);
    if (!await validateCatalogOrder(db, req.filter, order, session)) fail(409, 'MANUFACTURED_ORDER_LINE_REQUIRED');
    const { companyStockContext, companyStockView } = await import('./company-stock.mjs'), lines = [];
    for (const [lineIndex, line] of order.snapshot.lines.entries()) {
      if (line.catalogBinding?.itemSnapshot.content.kind !== 'MANUFACTURED') continue;
      const receipts = await db.collection('internalCompanyStockReceipts').find({ ...req.filter, itemId: line.catalogBinding.itemId, itemRevision: line.catalogBinding.itemRevision }, { session }).sort({ _id: 1 }).limit(101).toArray(), sources = [];
      for (const receipt of receipts.slice(0, 100)) sources.push(companyStockView(await companyStockContext(db, req.filter, receipt._id, session)));
      const shipped = await db.collection('fulfillmentTallies').findOne({ ...req.filter, kind: 'SO_LINE_SHIPPED', subjectId: order._id, lineIndex }, { session });
      lines.push({ ...line, lineIndex, shippedQuantity: shipped?.quantity || '0', sources, sourcesComplete: receipts.length <= 100 });
    }
    const shipments = await db.collection('fulfillmentShipments').find({ ...req.filter, salesOrderId: order._id, schema: 'MANUFACTURED_SHIPMENT_V1' }, { session }).sort({ _id: 1 }).limit(101).toArray();
    if (shipments.length > 100) fail(409, 'FULFILLMENT_HISTORY_LIMIT');
    for (const shipment of shipments) await validateManufacturedShipment(db, req.filter, shipment._id, session);
    return { salesOrder: order, lines, shipments };
  }) }));
  app.post('/api/fulfillment/manufactured-shipments', async (req, res) => {
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lineIndex', 'uom', 'reference', 'packageReference', 'handling', 'sources', 'idempotencyKey']);
    const b = req.body; id(b.salesOrderId);
    if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 1 || !Number.isSafeInteger(b.lineIndex) || b.lineIndex < 0 || !Array.isArray(b.sources) || !b.sources.length || b.sources.length > 20 || new Set(b.sources.map(row => row?.companyReceiptId)).size !== b.sources.length) fail(400, 'INVALID_MANUFACTURED_DISPATCH');
    for (const field of ['reference', 'packageReference']) if (typeof b[field] !== 'string' || b[field].trim().length < 3 || b[field].length > 200) fail(400, 'INVALID_TEXT');
    let unitCount = 0;
    for (const part of b.sources) {
      fields(part, ['companyReceiptId', 'expectedStockVersion', 'units']); id(part.companyReceiptId);
      if (!Number.isSafeInteger(part.expectedStockVersion) || part.expectedStockVersion < 1 || !Array.isArray(part.units) || !part.units.length || new Set(part.units.map(row => row?.companyUnitId)).size !== part.units.length) fail(400, 'INVALID_UNITS');
      unitCount += part.units.length;
      for (const unit of part.units) { fields(unit, ['companyUnitId', 'expectedUnitVersion']); id(unit.companyUnitId); if (!Number.isSafeInteger(unit.expectedUnitVersion) || unit.expectedUnitVersion < 1) fail(400, 'INVALID_VERSION'); }
    }
    if (unitCount > 100) fail(400, 'INVALID_UNITS');
    req.manufacturedDispatch = true;
    const data = await tx(req, 'shipment.recorded', async session => {
      const order = await find('salesOrders', req, b.salesOrderId, session);
      if (order.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      const line = await currentLine(db, req.filter, order, b.lineIndex, session, true);
      const handling = await requireDispatchResources(db, req.filter, req.scope.userId, b.handling, session, businessNow(runtime));
      if (line.uom !== b.uom) fail(409, 'UOM_CONFLICT');
      const { companyStockContext, writeCompanyReservation } = await import('./company-stock.mjs');
      const { companySourceSnapshot } = await import('./company-stock-state.mjs');
      const shipmentId = randomUUID(), contexts = new Map(), sources = [], serials = [];
      for (const part of b.sources) {
        const context = await companyStockContext(db, req.filter, part.companyReceiptId, session, { fresh: true, fence: true }); contexts.set(part.companyReceiptId, context);
        if (context.use.version !== part.expectedStockVersion) fail(409, 'VERSION_CONFLICT');
        if (context.receipt.itemId !== line.catalogBinding.itemId || context.receipt.itemRevision !== line.catalogBinding.itemRevision || context.receipt.ownerLegalEntityId !== order.ownerLegalEntityId || context.receipt.uom !== line.uom) fail(409, 'MATERIAL_SOURCE_CONFLICT');
        const selected = part.units.map(ref => { const unit = context.use.units.find(row => row._id === ref.companyUnitId); if (!unit || unit.version !== ref.expectedUnitVersion || unit.status !== 'AVAILABLE') fail(409, 'STOCK_ENCUMBERED'); return unit; });
        const graph = []; for (const ref of part.units) graph.push(await freezeDispatchDescendants(db, req.filter, part.companyReceiptId, ref, shipmentId, req.scope.userId, session));
        const companyUnitIds = selected.map(row => row._id), partSerials = selected.map(row => row.serial); serials.push(...partSerials);
        sources.push({ reservationId: randomUUID(), companyReceiptId: context.receipt._id, openingHash: context.receipt.contentHash, quantity: String(selected.length), companyUnitIds, serials: partSerials, sourceSnapshot: companySourceSnapshot(context.producer, companyUnitIds), graph });
      }
      if (new Set(serials).size !== serials.length) fail(409, 'SERIAL_SOURCE_CONFLICT');
      const quantity = BigInt(unitCount) * 1000000n;
      await tally(req, 'SO_LINE_SHIPPED', order._id, b.lineIndex, quantity, units(line.quantity), session);
      const snapshot = { ...req.filter, shipmentId, version: 1, status: 'APPROVED', salesOrderId: order._id, salesOrderVersion: order.version, salesOrderSnapshotHash: hash(order.snapshot), sourceLineId: line.lineId || null, lineIndex: b.lineIndex, accountId: order.accountId, ownerLegalEntityId: order.ownerLegalEntityId, uom: line.uom, itemBinding: line.catalogBinding, sources, handling, packageReference: b.packageReference.trim(), authorizedBy: req.scope.userId, authorizedAt: businessNow(runtime) }, authorizationHash = hash(snapshot);
      await db.collection('manufacturedShipmentAuthorizations').insertOne({ _id: shipmentId, ...req.filter, shipmentId, snapshot, contentHash: authorizationHash }, { session });
      let head = await saveState(db, req.filter, shipmentId, authorizationHash, [], 'PREPARING', 'AUTHORIZED', req.scope.userId, session);
      const refs = [];
      for (const source of sources) {
        let context = contexts.get(source.companyReceiptId), claim = { _id: source.reservationId, ...req.filter, authorityKind: 'FULFILLMENT_SHIPMENT', shipmentId, salesOrderId: order._id, sourceLineId: snapshot.sourceLineId, lineIndex: b.lineIndex, salesOrderSnapshotHash: snapshot.salesOrderSnapshotHash, authorizationHash, authorizedShipmentVersion: 1, materialLineId: snapshot.sourceLineId || `LINE_INDEX_${b.lineIndex}`, sourceKind: 'COMPANY_OUTPUT', companyReceiptId: source.companyReceiptId, openingHash: source.openingHash, itemId: line.catalogBinding.itemId, itemRevision: line.catalogBinding.itemRevision, ownerLegalEntityId: order.ownerLegalEntityId, uom: line.uom, quantity: source.quantity, companyUnitIds: source.companyUnitIds, serials: source.serials, sourceSnapshot: source.sourceSnapshot, status: 'RESERVED', issueId: null, issueHash: null, consumptionId: null, consumptionHash: null, recordedBy: req.scope.userId, recordedAt: new Date() };
        for (const status of ['RESERVED', 'ISSUED', 'CONSUMED']) {
          if (status !== 'RESERVED') {
            context = await companyStockContext(db, req.filter, source.companyReceiptId, session, { fresh: true, fence: true });
            const movement = stamp({ _id: randomUUID(), ...req.filter, ...fulfillmentClaimBinding(claim), materialLineId: claim.materialLineId, sourceKind: claim.sourceKind, companyReceiptId: claim.companyReceiptId, openingHash: claim.openingHash, itemId: claim.itemId, itemRevision: claim.itemRevision, uom: claim.uom, ownerLegalEntityId: claim.ownerLegalEntityId, reservationId: claim._id, quantity: claim.quantity, companyUnitIds: claim.companyUnitIds, serials: claim.serials, sourceSnapshot: claim.sourceSnapshot, ...(status === 'CONSUMED' ? { issueId: claim.issueId } : {}), recordedBy: req.scope.userId, recordedAt: new Date() });
            await db.collection(status === 'ISSUED' ? 'companyMaterialIssues' : 'companyMaterialConsumptions').insertOne(movement, { session });
            claim = { ...claim, status, ...(status === 'ISSUED' ? { issueId: movement._id, issueHash: movement.contentHash } : { consumptionId: movement._id, consumptionHash: movement.contentHash }) };
          }
          claim = await writeCompanyReservation(db, req.filter, context, { ...claim, effectShipmentVersion: head.version + 1 }, req.scope.userId, b.reference.trim(), session);
          const ref = { reservationId: claim._id, version: claim.version, contentHash: claim.contentHash, status: claim.status };
          const position = refs.findIndex(row => row.reservationId === ref.reservationId); if (position >= 0) refs[position] = ref; else refs.push(ref);
          head = await saveState(db, req.filter, shipmentId, authorizationHash, structuredClone(refs), 'PREPARING', status, req.scope.userId, session);
        }
      }
      const row = { ...base(req), _id: shipmentId, schema: 'MANUFACTURED_SHIPMENT_V1', salesOrderId: order._id, accountId: order.accountId, lineIndex: b.lineIndex, uom: line.uom, quantity: decimal(quantity), stockMovementCount: sources.length, sources: sources.map(source => ({ sourceType: 'COMPANY_OUTPUT', sourceId: source.reservationId, companyReceiptId: source.companyReceiptId, companyUnitIds: source.companyUnitIds, serials: source.serials, quantity: source.quantity, sourceSnapshot: source.sourceSnapshot, graph: source.graph })), sourceReceiptIds: [...new Set([...contexts.values()].flatMap(context => context.receipt.consumedAncestryReceiptIds || context.receipt.consumedReceiptIds))], reference: b.reference.trim(), packageReference: b.packageReference.trim(), status: 'SHIPPED', dispatchMode: 'OPERATOR_RECORDED', shippedBy: req.scope.userId, shippedAt: businessNow(runtime), authorizationHash };
      if (handling) row.handling = handling;
      await db.collection('fulfillmentShipments').insertOne(row, { session });
      await saveState(db, req.filter, shipmentId, authorizationHash, refs, 'DISPATCHED', 'DISPATCHED', req.scope.userId, session, hash(shipmentSemantic(row)));
      return row;
    }); res.status(201).json({ data });
  });
}
