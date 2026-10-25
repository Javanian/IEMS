import { randomUUID } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { requireInternalExecutionDemand, requireQualifiedCompanyLocation } from './internal-production.mjs';
import { catalogStockContext, catalogStockView, writeCatalogReservation } from './catalog-stock.mjs';
import { stockHash as hash, stockHashless as hashless, stockSemantic as semantic, stockUnits as units, stockDecimal as decimal } from './catalog-stock-use-state.mjs';
import { validateInternalExecution, reconcileInternalAttribution, executionInvalid } from './internal-execution-state.mjs';

const commands = ['create', 'reserve', 'release', 'issue', 'record', 'attribute', 'qc', 'putaway'];
export const internalExecutionActions = ['internal.execution.read', ...commands.map(command => `internal.execution.${command}`)];
export const internalExecutionRoles = Object.fromEntries(['reader', ...commands].map(command => [`internalExecution${command[0].toUpperCase()}${command.slice(1)}`, [...new Set(['internal.execution.read', 'catalog.stock.read', ...(command === 'reader' ? [] : [`internal.execution.${command}`]), ...(command === 'create' ? ['internal.read'] : [])])]]));
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const stamp = row => ({ ...row, contentHash: hash(row) });
const quantity = (value, allowZero = false) => { let result; try { result = units(value); } catch { fail(400, 'INVALID_QUANTITY'); } if (!allowZero && result === 0n) fail(400, 'INVALID_QUANTITY'); return result; };
const text = value => { if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 2000) fail(400, 'INVALID_EVIDENCE'); return value.trim(); };

export async function initializeInternalExecution(db) {
  for (const [name, keys] of [['internalExecutions', { tenantId: 1, plantId: 1, internalOrderId: 1 }], ['internalExecutionEvents', { tenantId: 1, plantId: 1, executionId: 1, version: 1 }], ['internalExecutionKeys', { tenantId: 1, plantId: 1, key: 1 }], ['internalAttributionRevisions', { tenantId: 1, plantId: 1, executionId: 1, revision: 1 }], ['internalOutputUnits', { tenantId: 1, plantId: 1, serial: 1 }], ['internalCompanyStockReceipts', { tenantId: 1, plantId: 1, executionId: 1 }], ['internalCompanyStockUnits', { tenantId: 1, plantId: 1, outputUnitId: 1 }]]) await db.collection(name).createIndex(keys, { unique: true });
  await db.collection('internalExecutions').createIndex({ tenantId: 1, plantId: 1, sourceReceiptIds: 1 });
  for (const name of ['internalExecutionEvents', 'internalExecutionKeys', 'internalExecutionAudit', 'internalExecutionOutbox', 'internalAttributionRevisions', 'internalOutputUnits', 'internalCompanyStockReceipts', 'internalCompanyStockUnits']) await db.collection(name).createIndex({ tenantId: 1, plantId: 1, sourceReceiptIds: 1 });
}

export function installInternalExecution(app, runtime, { guard, fields, id }) {
  const db = runtime.db, c = name => db.collection(name), root = '/api/internal-execution/orders';
  const owner = async (req, session) => { const plant = await c('plants').findOne({ tenantId: req.filter.tenantId, _id: req.filter.plantId, active: true }, { session }); if (!plant || !await c('legalEntities').findOne({ tenantId: req.filter.tenantId, _id: plant.legalEntityId, active: true }, { session })) fail(403, 'SCOPE_DENIED'); return plant.legalEntityId; };
  const read = async effect => { const session = runtime.client.startSession(); try { return await session.withTransaction(() => effect(session), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); } finally { await session.endSession(); } };
  app.use('/api/internal-execution', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers }); if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    const last = req.path.split('/').at(-1), command = req.path === '/orders' ? 'create' : last === 'reservations' || /\/reservations\/[^/]+\/release$/.test(req.path) ? 'reserve' : last === 'records' ? 'record' : ['allocations', 'losses'].includes(last) ? 'attribute' : ['release', 'issue', 'qc', 'putaway'].includes(last) ? last : null;
    req.executionAction = req.method === 'GET' ? 'internal.execution.read' : req.method === 'POST' && command ? `internal.execution.${command}` : null;
    if (!req.executionAction) fail(404, 'NOT_FOUND'); await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.executionAction }); next();
  });
  async function context(req, session) {
    const current = await validateInternalExecution(db, req.filter, id(req.params.id), session); if (current.head.ownerLegalEntityId !== await owner(req, session)) executionInvalid();
    const stocks = new Map(); for (const receiptId of current.head.sourceReceiptIds) stocks.set(receiptId, await catalogStockContext(db, req.filter, receiptId, session));
    reconcileInternalAttribution(current.head, current.reservations, current.outputs, ['QC_RELEASED', 'STORED'].includes(current.head.status));
    return { ...current, stocks };
  }
  async function live(req, current, session) {
    const blockers = [];
    try { await requireInternalExecutionDemand(db, req.filter, current.head.internalOrderId, current.head.sourceDemand.version, current.head.sourceDemand.engineering.currentRevision, current.head.ownerLegalEntityId, session); }
    catch (error) { if (!['INTERNAL_DEMAND_CHANGED', 'CATALOG_DEPENDENCY_CHANGED', 'VERSION_CONFLICT', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('DEMAND_CHANGED'); }
    for (const row of current.reservations.filter(row => row.status !== 'RELEASED')) for (const blocker of current.stocks.get(row.receiptId).blockers) blockers.push(blocker);
    if (current.companyReceipt) { const location = current.companyReceipt.locationSnapshot; try { const actual = await requireQualifiedCompanyLocation(db, req.filter, location._id, location.version, current.head.ownerLegalEntityId, session); if (actual.authorityHash !== location.authorityHash) blockers.push('OUTPUT_LOCATION_CHANGED'); } catch (error) { if (!['CATALOG_DEPENDENCY_CHANGED', 'VERSION_CONFLICT', 'NOT_FOUND'].includes(error.code)) throw error; blockers.push('OUTPUT_LOCATION_CHANGED'); } }
    return [...new Set(blockers)];
  }
  async function fresh(req, current, session) {
    await requireInternalExecutionDemand(db, req.filter, current.head.internalOrderId, current.head.sourceDemand.version, current.head.sourceDemand.engineering.currentRevision, current.head.ownerLegalEntityId, session, true);
    for (const row of current.reservations.filter(row => row.status !== 'RELEASED')) await catalogStockContext(db, req.filter, row.receiptId, session, { fresh: true, fence: true });
  }
  async function view(req, current, session) {
    const head = current.head, blockers = await live(req, current, session), enough = head.materials.every(material => current.reservations.filter(row => row.materialLineId === material.lineId && row.status === 'RESERVED').reduce((total, row) => total + units(row.quantity), 0n) === units(material.requiredQuantity));
    return { ...semantic(head), authorityHash: head.authorityHash, reservations: current.reservations, outputUnits: current.outputs, companyStock: current.companyReceipt ? { ...current.companyReceipt, onHandQuantity: current.companyReceipt.quantity, availableQuantity: current.companyReceipt.quantity, eligibleQuantity: blockers.length ? '0' : current.companyReceipt.quantity, canAllocate: false, units: current.companyUnits.map(unit => ({ ...unit, eligible: !blockers.length })) } : null, stockSources: [...current.stocks.values()].map(catalogStockView), blockers, canReserve: head.status === 'PLANNED' && !blockers.length, canRelease: head.status === 'PLANNED' && enough && !blockers.length, canIssue: head.status === 'RELEASED' && !blockers.length, canRecord: ['ISSUED', 'IN_PROGRESS'].includes(head.status) && !blockers.length, canAttribute: head.status === 'QUARANTINED', canQC: head.status === 'QUARANTINED' && !blockers.length, canPutaway: head.status === 'QC_RELEASED' && head.qc.acceptedSerials.length > 0 && !blockers.length };
  }
  async function save(req, head, previous, kind, reason, session) {
    const snapshot = semantic(head), eventId = randomUUID(); head.eventId = eventId; head.authorityHash = hash(snapshot);
    await c('internalExecutionEvents').insertOne({ _id: eventId, ...req.filter, executionId: head._id, sourceReceiptIds: head.sourceReceiptIds, version: head.version, status: head.status, kind, reason, recordedBy: req.scope.userId, recordedAt: new Date(), snapshot, contentHash: head.authorityHash }, { session });
    if (previous) { const result = await c('internalExecutions').replaceOne({ ...req.filter, _id: head._id, version: previous }, head, { session }); if (result.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); }
    else await c('internalExecutions').insertOne(head, { session });
    return view(req, await context({ ...req, params: { ...req.params, id: head._id } }, session), session);
  }
  async function mutation(req, kind, effect) {
    const body = req.body, key = body.idempotencyKey; if (!positive(body.expectedVersion)) fail(400, 'INVALID_VERSION'); if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 500) fail(400, 'INVALID_REASON'); if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY'); const payloadHash = hash({ kind, resource: req.params.id || null, body });
    for (let attempt = 0; ; attempt++) {
      const session = runtime.client.startSession();
      try { return await session.withTransaction(async () => {
        await guard(runtime, req, session, req.executionAction); const prior = await c('internalExecutionKeys').findOne({ ...req.filter, key }, { session }); if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
        const current = req.params.id ? await context(req, session) : null; if (current && current.head.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT');
        const result = await effect(current, body.reason.trim(), session), event = { ...req.filter, executionId: result._id, sourceReceiptIds: result.sourceReceiptIds, version: result.version, kind, recordedBy: req.scope.userId, recordedAt: new Date() };
        await c('internalExecutionAudit').insertOne({ _id: randomUUID(), ...event }, { session }); await c('internalExecutionOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session }); await c('internalExecutionKeys').insertOne({ _id: randomUUID(), ...req.filter, executionId: result._id, sourceReceiptIds: result.sourceReceiptIds, key, payloadHash, result }, { session }); return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
      catch (error) { if (error.code === 11000 && attempt < 3) continue; if (error.code === 11000) fail(409, error.keyPattern?.serial ? 'SERIAL_CONFLICT' : 'INTERNAL_EXECUTION_CONFLICT'); throw error; }
      finally { await session.endSession(); }
    }
  }
  const common = ['expectedVersion', 'reason', 'idempotencyKey'];
  app.get(root, async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit), cursor = req.query.cursor === undefined ? null : id(req.query.cursor), internalOrderId = req.query.internalOrderId === undefined ? null : id(req.query.internalOrderId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_PAGINATION');
    res.json(await read(async session => {
      let query = c('internalExecutions').find({ ...req.filter, ...(internalOrderId ? { internalOrderId } : {}), ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session });
      if (internalOrderId) query = query.hint({ tenantId: 1, plantId: 1, internalOrderId: 1 });
      const rows = await query.sort({ _id: 1 }).limit(internalOrderId ? 2 : limit + 1).toArray(), data = [];
      for (const row of rows.slice(0, limit)) data.push(await view(req, await context({ ...req, params: { id: row._id } }, session), session));
      return { data, page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } };
    }));
  });
  app.get(`${root}/:id`, async (req, res) => res.json({ data: await read(async session => view(req, await context(req, session), session)) }));
  app.get(`${root}/:id/events`, async (req, res) => res.json(await read(async session => { await context(req, session); const limit = req.query.limit === undefined ? 25 : Number(req.query.limit), cursor = req.query.cursor === undefined ? null : id(req.query.cursor); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_PAGINATION'); const rows = await c('internalExecutionEvents').find({ ...req.filter, executionId: req.params.id, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { session }).sort({ _id: 1 }).limit(limit + 1).toArray(); return { data: rows.slice(0, limit), page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]._id : null } }; })));
  app.post(root, async (req, res) => {
    fields(req.body, [...common, 'internalOrderId', 'expectedOrderVersion', 'engineeringRevision']); const orderId = id(req.body.internalOrderId); if (!positive(req.body.expectedOrderVersion) || !positive(req.body.engineeringRevision)) fail(400, 'INVALID_VERSION');
    const data = await mutation(req, 'internal.execution.create', async (_, reason, session) => {
      if (req.body.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT'); const legalEntityId = await owner(req, session), demand = await requireInternalExecutionDemand(db, req.filter, orderId, req.body.expectedOrderVersion, req.body.engineeringRevision, legalEntityId, session, true);
      if (units(demand.quantity) % 1000000n || units(demand.quantity) > 100000000n) fail(400, 'INVALID_EXECUTION_DEMAND');
      for (const material of demand.engineering.content.materials) if (material.itemSnapshot.content.trackingPolicy === 'SERIAL' && units(material.quantityPerUnit) % 1000000n) fail(400, 'INVALID_EXECUTION_DEMAND');
      const head = { _id: randomUUID(), ...req.filter, ownerLegalEntityId: legalEntityId, schema: 'INTERNAL_EXECUTION_V1', version: 1, status: 'PLANNED', internalOrderId: orderId, sourceDemand: demand, quantity: demand.quantity, uom: demand.itemSnapshot.content.uom, materials: demand.engineering.content.materials, operations: demand.engineering.content.operations, reservations: [], sourceReceiptIds: [], records: [], outputHashes: [], allocations: [], losses: [], attributionRevision: 0, attributionHash: null, release: null, issued: null, qc: null, companyStock: null };
      return save(req, head, null, 'CREATED', reason, session);
    }); res.status(201).json({ data });
  });
  app.post(`${root}/:id/reservations`, async (req, res) => {
    fields(req.body, [...common, 'materialLineId', 'receiptId', 'expectedReceiptVersion', 'expectedStockVersion', 'quantity', 'serials']); const receiptId = id(req.body.receiptId), materialLineId = id(req.body.materialLineId), amount = quantity(req.body.quantity); if (!positive(req.body.expectedReceiptVersion) || !positive(req.body.expectedStockVersion)) fail(400, 'INVALID_VERSION');
    const data = await mutation(req, 'internal.material.reserve', async (current, reason, session) => {
      if (current.head.status !== 'PLANNED') fail(409, 'STATE_CONFLICT'); if (current.reservations.length >= 20 || current.reservations.some(row => row.receiptId === receiptId)) fail(409, 'RESERVATION_LIMIT'); await fresh(req, current, session);
      const material = current.head.materials.find(row => row.lineId === materialLineId); if (!material) fail(400, 'INVALID_MATERIAL'); const source = await catalogStockContext(db, req.filter, receiptId, session, { fresh: true, fence: true });
      if (source.receipt.version !== req.body.expectedReceiptVersion || source.use.version !== req.body.expectedStockVersion) fail(409, 'VERSION_CONFLICT'); if (source.origin.source.itemId !== material.itemId || source.origin.source.itemRevision !== material.itemRevision || source.receipt.uom !== material.uom) fail(409, 'MATERIAL_SOURCE_CONFLICT');
      const allocated = current.reservations.filter(row => row.materialLineId === materialLineId && row.status !== 'RELEASED').reduce((total, row) => total + units(row.quantity), 0n); if (allocated + amount > units(material.requiredQuantity) || amount > units(source.use.availableQuantity)) fail(409, 'INSUFFICIENT_STOCK');
      const policy = source.origin.source.trackingPolicy, serials = req.body.serials;
      if (policy === 'LOT' ? Object.hasOwn(req.body, 'serials') : !Array.isArray(serials) || !serials.length || new Set(serials).size !== serials.length || amount !== BigInt(serials.length) * 1000000n || serials.some(serial => !source.use.units.some(unit => unit.serial === serial && unit.status === 'AVAILABLE'))) fail(400, 'INVALID_SERIALS');
      if (current.reservations.filter(row => row.status !== 'RELEASED').reduce((sum, row) => sum + row.serials.length, 0) + (serials?.length || 0) > 100) fail(400, 'SERIAL_LIMIT');
      const row = { _id: randomUUID(), ...req.filter, receiptId, executionId: current.head._id, materialLineId, originHash: source.origin.contentHash, openingBalanceHash: source.opening.balance.contentHash, itemId: material.itemId, itemRevision: material.itemRevision, uom: material.uom, ownerLegalEntityId: current.head.ownerLegalEntityId, quantity: decimal(amount), serials: serials || [], status: 'RESERVED', sourceSnapshot: { ...source.origin.source, locationSnapshot: source.opening.balance.locationSnapshot, lotNumber: source.receipt.lotNumber ?? null, heatNumber: source.receipt.heatNumber ?? null }, issueId: null, issueHash: null, consumptionId: null, consumptionHash: null, recordedBy: req.scope.userId, recordedAt: new Date() };
      const saved = await writeCatalogReservation(db, req.filter, source, row, req.scope.userId, reason, session), head = { ...semantic(current.head), version: current.head.version + 1, reservations: [...current.head.reservations, { reservationId: saved._id, version: saved.version, contentHash: saved.contentHash }], sourceReceiptIds: [...current.head.sourceReceiptIds, receiptId] };
      return save(req, head, current.head.version, 'MATERIAL_RESERVED', reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/:id/reservations/:reservationId/release`, async (req, res) => {
    fields(req.body, [...common, 'expectedReceiptVersion', 'expectedStockVersion']); id(req.params.reservationId);
    const data = await mutation(req, 'internal.material.abandon', async (current, reason, session) => {
      if (current.head.status !== 'PLANNED') fail(409, 'STATE_CONFLICT'); const row = current.reservations.find(row => row._id === req.params.reservationId); if (!row || row.status !== 'RESERVED') fail(409, 'STATE_CONFLICT'); const source = current.stocks.get(row.receiptId);
      if (source.receipt.version !== req.body.expectedReceiptVersion || source.use.version !== req.body.expectedStockVersion) fail(409, 'VERSION_CONFLICT'); const saved = await writeCatalogReservation(db, req.filter, source, { ...hashless(row), status: 'RELEASED' }, req.scope.userId, reason, session), head = { ...semantic(current.head), version: current.head.version + 1, reservations: current.head.reservations.map(ref => ref.reservationId === saved._id ? { reservationId: saved._id, version: saved.version, contentHash: saved.contentHash } : ref) };
      return save(req, head, current.head.version, 'RESERVATION_ABANDONED', reason, session);
    }); res.json({ data });
  });
  async function transition(req, current, status, reason, session) {
    const refs = [];
    for (const previous of current.reservations) {
      if (previous.status === 'RELEASED') { refs.push({ reservationId: previous._id, version: previous.version, contentHash: previous.contentHash }); continue; }
      const source = await catalogStockContext(db, req.filter, previous.receiptId, session, { fresh: true, fence: true });
      const ledger = stamp({ _id: randomUUID(), ...req.filter, receiptId: previous.receiptId, executionId: current.head._id, reservationId: previous._id, originHash: previous.originHash, openingBalanceHash: previous.openingBalanceHash, quantity: previous.quantity, serials: previous.serials, sourceSnapshot: previous.sourceSnapshot, ...(status === 'CONSUMED' ? { issueId: previous.issueId } : {}), reason, recordedBy: req.scope.userId, recordedAt: new Date() }); await c(status === 'ISSUED' ? 'catalogMaterialIssues' : 'catalogMaterialConsumptions').insertOne(ledger, { session });
      const saved = await writeCatalogReservation(db, req.filter, source, { ...hashless(previous), status, ...(status === 'ISSUED' ? { issueId: ledger._id, issueHash: ledger.contentHash } : { consumptionId: ledger._id, consumptionHash: ledger.contentHash }) }, req.scope.userId, reason, session); refs.push({ reservationId: saved._id, version: saved.version, contentHash: saved.contentHash });
    }
    return refs;
  }
  for (const command of ['release', 'issue']) app.post(`${root}/:id/${command}`, async (req, res) => {
    fields(req.body, common);
    const data = await mutation(req, `internal.execution.${command}`, async (current, reason, session) => {
      if (current.head.status !== (command === 'release' ? 'PLANNED' : 'RELEASED')) fail(409, 'STATE_CONFLICT'); await fresh(req, current, session);
      for (const material of current.head.materials) if (current.reservations.filter(row => row.materialLineId === material.lineId && row.status === 'RESERVED').reduce((total, row) => total + units(row.quantity), 0n) !== units(material.requiredQuantity)) fail(409, 'MATERIAL_SHORTAGE');
      const head = { ...semantic(current.head), version: current.head.version + 1, status: command === 'release' ? 'RELEASED' : 'ISSUED', ...(command === 'release' ? { release: { engineeringRevision: current.head.sourceDemand.engineering.currentRevision, releasedBy: req.scope.userId, releasedAt: new Date(), reservationHashes: current.reservations.filter(row => row.status === 'RESERVED').map(row => row.contentHash) } } : { reservations: await transition(req, current, 'ISSUED', reason, session), issued: { issuedBy: req.scope.userId, issuedAt: new Date() } }) };
      return save(req, head, current.head.version, command.toUpperCase(), reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/:id/records`, async (req, res) => {
    fields(req.body, [...common, 'operationIndex', 'inputQuantity', 'goodQuantity', 'scrapQuantity', 'laborMinutes', 'machineMinutes', 'evidence', 'outputSerials']); const input = quantity(req.body.inputQuantity, true), good = quantity(req.body.goodQuantity, true), scrap = quantity(req.body.scrapQuantity, true), labor = quantity(req.body.laborMinutes, true), machine = quantity(req.body.machineMinutes, true), evidence = text(req.body.evidence);
    const data = await mutation(req, 'internal.operation.record', async (current, reason, session) => {
      if (!['ISSUED', 'IN_PROGRESS'].includes(current.head.status) || req.body.operationIndex !== current.head.records.length || !Number.isSafeInteger(req.body.operationIndex)) fail(409, 'STATE_CONFLICT'); await fresh(req, current, session);
      if (input !== units(current.head.records.at(-1)?.goodQuantity || current.head.quantity) || good + scrap !== input) fail(400, 'INVALID_OPERATION_QUANTITY');
      const final = req.body.operationIndex === current.head.operations.length - 1, serials = req.body.outputSerials;
      if (final ? !Array.isArray(serials) || serials.length > 100 || new Set(serials).size !== serials.length || good !== BigInt(serials.length) * 1000000n || serials.some(serial => typeof serial !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(serial)) : Object.hasOwn(req.body, 'outputSerials')) fail(400, 'INVALID_SERIALS');
      const refs = [];
      if (final) for (const serial of serials) {
        if (await c('warehouseSerials').findOne({ ...req.filter, serial }, { session })) fail(409, 'SERIAL_CONFLICT');
        const output = stamp({ _id: randomUUID(), ...req.filter, executionId: current.head._id, sourceReceiptIds: current.head.sourceReceiptIds, internalOrderId: current.head.internalOrderId, engineeringRevision: current.head.sourceDemand.engineering.currentRevision, ownerLegalEntityId: current.head.ownerLegalEntityId, itemId: current.head.sourceDemand.itemSnapshot._id, itemRevision: current.head.sourceDemand.itemSnapshot.currentRevision, uom: current.head.uom, serial, version: 1, status: 'QUARANTINED', recordedBy: req.scope.userId, recordedAt: new Date() }); await c('internalOutputUnits').insertOne(output, { session }); await c('warehouseSerials').insertOne({ _id: randomUUID(), ...req.filter, serial, sourceType: 'INTERNAL_OUTPUT', internalExecutionId: current.head._id, unitId: output._id }, { session }); refs.push({ unitId: output._id, contentHash: output.contentHash });
      }
      const reservations = current.head.records.length ? current.head.reservations : await transition(req, current, 'CONSUMED', reason, session), record = { operationIndex: req.body.operationIndex, code: current.head.operations[req.body.operationIndex].code, inputQuantity: decimal(input), goodQuantity: decimal(good), scrapQuantity: decimal(scrap), laborMinutes: decimal(labor), machineMinutes: decimal(machine), evidence, executionMode: 'OPERATOR_RECORDED', recordedBy: req.scope.userId, recordedAt: new Date() }, head = { ...semantic(current.head), version: current.head.version + 1, status: final ? 'QUARANTINED' : 'IN_PROGRESS', reservations, records: [...current.head.records, record], outputHashes: refs };
      return save(req, head, current.head.version, 'OPERATION_RECORDED', reason, session);
    }); res.json({ data });
  });
  function sources(req) {
    if (!Array.isArray(req.body.sources) || req.body.sources.length > 20) fail(400, 'INVALID_ATTRIBUTION');
    return req.body.sources.map(source => { fields(source, ['receiptId', 'quantity', 'serials']); id(source.receiptId); const amount = quantity(source.quantity); if (Object.hasOwn(source, 'serials') && (!Array.isArray(source.serials) || source.serials.length > 100)) fail(400, 'INVALID_ATTRIBUTION'); return { receiptId: source.receiptId, quantity: decimal(amount), ...(Object.hasOwn(source, 'serials') ? { serials: source.serials } : {}) }; });
  }
  for (const kind of ['allocations', 'losses']) app.post(`${root}/:id/${kind}`, async (req, res) => {
    fields(req.body, [...common, 'sources', ...(kind === 'allocations' ? ['outputUnitId'] : [])]); const sourceRows = sources(req); if (kind === 'allocations') id(req.body.outputUnitId);
    const data = await mutation(req, `internal.provenance.${kind}`, async (current, reason, session) => {
      if (current.head.status !== 'QUARANTINED') fail(409, 'STATE_CONFLICT'); if (current.head.attributionRevision >= 500) fail(409, 'REVISION_CONFLICT');
      const head = { ...semantic(current.head), version: current.head.version + 1, attributionRevision: current.head.attributionRevision + 1, ...(kind === 'allocations' ? { allocations: [...current.head.allocations.filter(row => row.outputUnitId !== req.body.outputUnitId), { outputUnitId: req.body.outputUnitId, sources: sourceRows }] } : { losses: sourceRows }) };
      try { reconcileInternalAttribution(head, current.reservations, current.outputs); } catch { fail(400, 'INVALID_ATTRIBUTION'); }
      const revision = stamp({ _id: randomUUID(), ...req.filter, executionId: head._id, sourceReceiptIds: head.sourceReceiptIds, revision: head.attributionRevision, allocations: head.allocations, losses: head.losses, reason, recordedBy: req.scope.userId, recordedAt: new Date() }); await c('internalAttributionRevisions').insertOne(revision, { session }); head.attributionHash = revision.contentHash;
      return save(req, head, current.head.version, 'PROVENANCE_RECORDED', reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/:id/qc`, async (req, res) => {
    fields(req.body, [...common, 'acceptedSerials', 'rejectedSerials', 'evidence']); const evidence = text(req.body.evidence); if (!Array.isArray(req.body.acceptedSerials) || !Array.isArray(req.body.rejectedSerials)) fail(400, 'INVALID_SERIALS');
    const data = await mutation(req, 'internal.output.qc', async (current, reason, session) => {
      if (current.head.status !== 'QUARANTINED') fail(409, 'STATE_CONFLICT'); const accepted = req.body.acceptedSerials, rejected = req.body.rejectedSerials, all = [...accepted, ...rejected]; if (all.length !== current.outputs.length || new Set(all).size !== all.length || all.some(serial => !current.outputs.some(output => output.serial === serial))) fail(400, 'INVALID_SERIALS');
      await fresh(req, current, session); try { reconcileInternalAttribution(current.head, current.reservations, current.outputs, true); } catch { fail(409, 'PROVENANCE_INCOMPLETE'); }
      const refs = []; for (const previous of current.outputs) { const output = stamp({ ...hashless(previous), version: 2, status: accepted.includes(previous.serial) ? 'ACCEPTED' : 'REJECTED' }); const changed = await c('internalOutputUnits').replaceOne({ ...req.filter, _id: output._id, version: previous.version }, output, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); refs.push({ unitId: output._id, contentHash: output.contentHash }); }
      const head = { ...semantic(current.head), version: current.head.version + 1, status: 'QC_RELEASED', outputHashes: refs, qc: { acceptedSerials: [...accepted].sort(), rejectedSerials: [...rejected].sort(), evidence, provenanceHash: current.head.attributionHash, inspectedBy: req.scope.userId, inspectedAt: new Date(), source: 'OPERATOR_RECORDED' } };
      return save(req, head, current.head.version, 'OUTPUT_QC_RELEASED', reason, session);
    }); res.json({ data });
  });
  app.post(`${root}/:id/putaway`, async (req, res) => {
    fields(req.body, [...common, 'locationId', 'expectedLocationVersion']); id(req.body.locationId); if (!positive(req.body.expectedLocationVersion)) fail(400, 'INVALID_VERSION');
    const data = await mutation(req, 'internal.company.stock', async (current, reason, session) => {
      if (current.head.status !== 'QC_RELEASED' || !current.head.qc.acceptedSerials.length) fail(409, 'STATE_CONFLICT'); await fresh(req, current, session); const location = await requireQualifiedCompanyLocation(db, req.filter, req.body.locationId, req.body.expectedLocationVersion, current.head.ownerLegalEntityId, session, true);
      const consumedReceiptIds = current.reservations.filter(row => row.status === 'CONSUMED').map(row => row.receiptId).sort();
      const receipt = stamp({ _id: randomUUID(), ...req.filter, executionId: current.head._id, internalOrderId: current.head.internalOrderId, ownerLegalEntityId: current.head.ownerLegalEntityId, itemId: current.head.sourceDemand.itemSnapshot._id, itemRevision: current.head.sourceDemand.itemSnapshot.currentRevision, uom: current.head.uom, quantity: String(current.head.qc.acceptedSerials.length), serials: current.head.qc.acceptedSerials, sourceReceiptIds: current.head.sourceReceiptIds, consumedReceiptIds, provenanceHash: current.head.attributionHash, qc: current.head.qc, locationSnapshot: location, valuation: 'UNVALUED', source: 'ACTUAL_INTERNAL_OUTPUT', reason, recordedBy: req.scope.userId, recordedAt: new Date() }); await c('internalCompanyStockReceipts').insertOne(receipt, { session });
      const refs = [], companyUnitHashes = [];
      for (const previous of current.outputs) {
        let output = previous;
        if (current.head.qc.acceptedSerials.includes(previous.serial)) { output = stamp({ ...hashless(previous), version: 3, status: 'STORED' }); const changed = await c('internalOutputUnits').replaceOne({ ...req.filter, _id: output._id, version: previous.version }, output, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT'); const companyUnit = stamp({ _id: randomUUID(), ...req.filter, executionId: current.head._id, companyReceiptId: receipt._id, outputUnitId: output._id, serial: output.serial, itemId: output.itemId, itemRevision: output.itemRevision, ownerLegalEntityId: output.ownerLegalEntityId, uom: output.uom, status: 'AVAILABLE', locationSnapshot: location, sourceReceiptIds: current.head.sourceReceiptIds, consumedReceiptIds }); await c('internalCompanyStockUnits').insertOne(companyUnit, { session }); companyUnitHashes.push({ unitId: companyUnit._id, contentHash: companyUnit.contentHash }); }
        refs.push({ unitId: output._id, contentHash: output.contentHash });
      }
      const head = { ...semantic(current.head), version: current.head.version + 1, status: 'STORED', outputHashes: refs, companyStock: { receiptId: receipt._id, contentHash: receipt.contentHash, unitHashes: companyUnitHashes } };
      return save(req, head, current.head.version, 'COMPANY_STOCK_RECEIVED', reason, session);
    }); res.json({ data });
  });
}
