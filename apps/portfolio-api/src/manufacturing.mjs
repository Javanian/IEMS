import { randomUUID, createHash } from 'node:crypto';
import { installEngineering } from './engineering.mjs';
import { installLabor } from './labor.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { requireEligibleReceipt, workOrderStockExceptions } from './stock-holds.mjs';
import { initializeGenealogy, installGenealogy, genealogyActions, genealogyRoles } from './genealogy.mjs';

const verbs = ['read', 'plan', 'release', 'record', 'qc'];
export const manufacturingActions = [...verbs.map(v => `manufacturing.${v}`), ...genealogyActions];
export const manufacturingRoles = { ...Object.fromEntries(verbs.map(v => [`manufacturing${v[0].toUpperCase()}${v.slice(1)}`, [...new Set(['manufacturing.read', `manufacturing.${v}`])]])), ...genealogyRoles };
export async function initializeManufacturing(db) {
  await db.collection('manufacturingLabor').createIndex({ tenantId: 1, plantId: 1, workOrderId: 1, operationIndex: 1 }, { unique: true });
  await db.collection('manufacturingLabor').createIndex({ tenantId: 1, plantId: 1, operatorId: 1, startedAt: 1, endedAt: 1 });
  await db.collection('manufacturingKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('engineeringRevisions').createIndex({ tenantId: 1, plantId: 1, engineeringId: 1, revision: 1 }, { unique: true });
  await db.collection('manufacturingAllocated').createIndex({ tenantId: 1, plantId: 1, salesOrderId: 1, lineIndex: 1 }, { unique: true });
  await db.collection('manufacturingOutputUnits').createIndex({ tenantId: 1, plantId: 1, serial: 1 }, { unique: true });
  await db.collection('manufacturingOutputUnits').createIndex({ tenantId: 1, plantId: 1, workOrderId: 1 });
  await initializeGenealogy(db);
}
const units = s => BigInt(s.split('.')[0]) * 1000000n + BigInt((s.split('.')[1] || '').padEnd(6, '0'));
const decimal = n => { const s = n.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
export function installManufacturing(app, runtime, { fail, guard, id, fields }) {
  const c = n => runtime.db.collection(n);
  const qty = (s, zero = false) => {
    if (typeof s !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(s) || (!zero && !/[1-9]/.test(s))) fail(400, 'INVALID_QUANTITY');
    return units(s);
  };
  const text = s => { if (typeof s !== 'string' || !s.trim() || s.length > 1000) fail(400, 'INVALID_TEXT'); return s.trim(); };
  const serials = (value, amount) => {
    if (!Array.isArray(value) || value.length > 1000 || value.some(s => typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(s)) || new Set(value).size !== value.length) fail(400, 'INVALID_SERIALS');
    if (BigInt(value.length) * 1000000n !== amount) fail(409, 'SERIAL_QUANTITY_CONFLICT');
    return value;
  };
  // Legacy representations stay fail-closed; the stockHolds authority is read in the caller's transaction.
  const requireUnheld = async (receipt, session) => {
    if (receipt.held === true || receipt.hold?.active === true || units(receipt.heldQuantity || '0') !== 0n) fail(409, 'STOCK_ENCUMBERED');
    await requireEligibleReceipt(runtime.db, receipt, session);
  };
  const find = async (name, req, key, session) => { const row = await c(name).findOne({ ...req.filter, _id: id(key) }, { session }); if (!row) fail(404, 'NOT_FOUND'); return row; };
  const base = req => ({ _id: randomUUID(), ...req.filter, version: 1, createdBy: req.scope.userId, createdAt: new Date() });
  app.use('/api/manufacturing', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    const tail = req.path.split('/').at(-1);
    const genealogyPath = /^\/work-orders\/[^/]+\/genealogy(?:\/|$)/.test(req.path) || req.path.startsWith('/genealogy/');
    req.manufacturingAction = genealogyPath ? req.method === 'GET' ? 'genealogy.read' : ['allocations', 'losses'].includes(tail) ? 'genealogy.record' : tail === 'finalize' ? 'genealogy.finalize' : null : `manufacturing.${req.method === 'GET' ? 'read' : ['/work-orders', '/engineering'].includes(req.path) || (req.path.startsWith('/engineering/') && tail === 'revisions') ? 'plan' : ['release-engineering', 'revoke'].includes(tail) ? 'release' : tail === 'labor' ? 'record' : tail}`;
    if (!req.manufacturingAction) fail(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.manufacturingAction }); next();
  });
  const tx = async (req, kind, effect) => {
    const { expectedVersion, idempotencyKey: key, ...payload } = req.body;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_VERSION');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    const payloadHash = createHash('sha256').update(JSON.stringify(canonical({ kind, id: req.params.id || null, expectedVersion, payload }))).digest('hex');
    for (let attempt = 1; ; attempt++) {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await guard(runtime, req, session, req.manufacturingAction);
      const prior = await c('manufacturingKeys').findOne({ ...req.filter, key }, { session });
      if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
      const result = await effect(session);
      const event = { ...base(req), kind, subjectId: result._id || result.workOrderId, subjectVersion: result.version, executionMode: 'OPERATOR_RECORDED' };
      await c('manufacturingAudit').insertOne(event, { session });
      await c('manufacturingOutbox').insertOne({ ...event, _id: randomUUID(), state: 'PENDING' }, { session });
      await c('manufacturingKeys').insertOne({ ...base(req), key, payloadHash, result }, { session });
      return result;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
    catch (error) { if (error?.code === 11000 && attempt < 4) continue; if (error?.code === 11000 && error.keyPattern?.serial) fail(409, 'SERIAL_CONFLICT'); throw error; }
    finally { await session.endSession(); }
    }
  };
  installGenealogy(app, runtime, { tx, find, fail, fields, id });
  app.get('/api/manufacturing/work-orders', async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c('manufacturingWorkOrders').find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  // stockExceptions is opt-in (?include=stockExceptions) so historical command responses stay byte-comparable with GET.
  app.get('/api/manufacturing/work-orders/:id', async (req, res) => {
    if (req.query.include === undefined) return res.json({ data: await find('manufacturingWorkOrders', req, req.params.id) });
    if (req.query.include !== 'stockExceptions') fail(400, 'VALIDATION', 'include must be stockExceptions');
    const session = runtime.client.startSession();
    try {
      const data = await session.withTransaction(async () => {
        const wo = await find('manufacturingWorkOrders', req, req.params.id, session);
        return { ...wo, stockExceptions: await workOrderStockExceptions(runtime.db, wo, session), stockExceptionsAsOf: new Date() };
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
      res.json({ data });
    } finally { await session.endSession(); }
  });
  app.get('/api/manufacturing/work-orders/:id/output-units', async (req, res) => {
    const wo = await find('manufacturingWorkOrders', req, req.params.id);
    const data = await c('manufacturingOutputUnits').find({ ...req.filter, workOrderId: wo._id }).sort({ serial: 1 }).toArray();
    res.json({ data });
  });
  app.post('/api/manufacturing/work-orders', async (req, res) => {
    fields(req.body, ['salesOrderId', 'expectedVersion', 'lineIndex', 'quantities', 'uom', 'serialized', 'genealogyRequired', 'idempotencyKey']);
    const { salesOrderId, lineIndex, quantities, uom, expectedVersion } = req.body;
    id(salesOrderId);
    if (!Number.isSafeInteger(lineIndex) || lineIndex < 0 || !Array.isArray(quantities) || !quantities.length || quantities.length > 100) fail(400, 'INVALID_SPLIT');
    const amounts = quantities.map(q => qty(q));
    if (Object.hasOwn(req.body, 'serialized') && typeof req.body.serialized !== 'boolean') fail(400, 'INVALID_SERIALIZED');
    if (req.body.serialized && amounts.some(a => a % 1000000n !== 0n || a > 1000000000n)) fail(400, 'INVALID_SERIALIZED');
    if (Object.hasOwn(req.body, 'genealogyRequired') && typeof req.body.genealogyRequired !== 'boolean') fail(400, 'INVALID_GENEALOGY');
    if (req.body.genealogyRequired && (!req.body.serialized || amounts.some(a => a > 100000000n))) fail(400, 'INVALID_GENEALOGY');
    const data = await tx(req, 'workOrders.planned', async session => {
      const so = await find('salesOrders', req, salesOrderId, session);
      if (so.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (so.status !== 'OPEN') fail(409, 'STATE_CONFLICT');
      const line = so.snapshot.lines[lineIndex]; if (!line) fail(400, 'INVALID_LINE');
      if (uom !== line.uom) fail(409, 'UOM_CONFLICT');
      const filter = { ...req.filter, salesOrderId, lineIndex }, allocated = await c('manufacturingAllocated').findOne(filter, { session });
      const total = units(allocated?.quantity || '0') + amounts.reduce((a, b) => a + b, 0n);
      if (total > units(line.quantity)) fail(409, 'QUANTITY_EXCEEDED');
      if (allocated) await c('manufacturingAllocated').updateOne({ _id: allocated._id }, { $set: { quantity: decimal(total) } }, { session });
      else await c('manufacturingAllocated').insertOne({ ...base(req), ...filter, quantity: decimal(total) }, { session });
      const batch = base(req), workOrders = amounts.map(a => ({ ...base(req), splitId: batch._id, salesOrderId, salesOrderVersion: so.version, accountId: so.accountId, lineIndex, sourceLine: line, quantity: decimal(a), uom, ...(req.body.serialized ? { serialized: true } : {}), ...(req.body.genealogyRequired ? { genealogyRequired: true } : {}), status: 'PLANNED', executionMode: 'OPERATOR_RECORDED', records: [] }));
      await c('manufacturingWorkOrders').insertMany(workOrders, { session });
      return { ...batch, workOrders };
    }); res.status(201).json({ data });
  });
  installLabor(app, { c, find, tx, fail, fields, id, text });
  const engineeringRouting = installEngineering(app, { c, find, base, tx, fail, fields, id, qty, text });
  const movement = async (req, wo, kind, values, session) => c('manufacturingMovements').insertOne({ ...base(req), workOrderId: wo._id, kind, ...values }, { session });
  for (const action of ['release', 'release-engineering', 'record', 'qc']) app.post(`/api/manufacturing/work-orders/:id/${action}`, async (req, res) => {
    const allowed = { 'release-engineering': ['engineeringId', 'engineeringVersion', 'revision'], release: ['operations', 'materials'], record: ['operationIndex', 'inputQuantity', 'goodQuantity', 'scrapQuantity', 'uom', 'evidence', 'outputSerials'], qc: ['acceptedQuantity', 'rejectedQuantity', 'uom', 'evidence', 'acceptedSerials', 'rejectedSerials'] }[action];
    fields(req.body, ['expectedVersion', 'idempotencyKey', ...allowed]);
    const b = req.body;
    if (['record', 'qc'].includes(action)) text(b.evidence);
    const data = await tx(req, `workOrder.${action}`, async session => {
      const row = await find('manufacturingWorkOrders', req, req.params.id, session);
      if (row.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (['release', 'release-engineering'].includes(action)) {
        const releaseBody = action === 'release-engineering' ? await engineeringRouting(req, row, session) : b;
        if (row.status !== 'PLANNED') fail(409, 'STATE_CONFLICT');
        if (!Array.isArray(releaseBody.operations) || !releaseBody.operations.length || releaseBody.operations.length > 50 || !Array.isArray(releaseBody.materials) || !releaseBody.materials.length || releaseBody.materials.length > 100) fail(400, 'INVALID_ROUTING');
        if ([...releaseBody.operations, ...releaseBody.materials].some(v => !v || typeof v !== 'object' || Array.isArray(v))) fail(400, 'INVALID_ROUTING');
        if (row.genealogyRequired && releaseBody.materials.length > 20) fail(400, 'INVALID_GENEALOGY');
        const operations = releaseBody.operations.map(op => { fields(op, ['code', 'instruction']); return { code: text(op.code), instruction: text(op.instruction) }; });
        if (new Set(operations.map(o => o.code)).size !== operations.length || new Set(releaseBody.materials.map(m => m.receiptId)).size !== releaseBody.materials.length) fail(400, 'INVALID_ROUTING');
        const materials = [];
        for (const m of releaseBody.materials) {
          fields(m, ['receiptId', 'quantityPerUnit', 'uom']);
          const ratio = qty(m.quantityPerUnit), product = qty(row.quantity) * ratio;
          if (product % 1000000n) fail(400, 'INEXACT_MATERIAL_QUANTITY');
          const required = product / 1000000n, receipt = await find('warehouseReceipts', req, m.receiptId, session);
          if (row.genealogyRequired && (!receipt.lotNumber || !receipt.heatNumber)) fail(409, 'MATERIAL_TRACE_REQUIRED');
          await requireUnheld(receipt, session);
          if (receipt.uom !== m.uom) fail(409, 'UOM_CONFLICT');
          if (receipt.status !== 'STORED' || required > units(receipt.availableQuantity)) fail(409, 'INSUFFICIENT_STOCK');
          const reserved = await c('warehouseReceipts').updateOne({ ...req.filter, _id: receipt._id, version: receipt.version }, { $set: { availableQuantity: decimal(units(receipt.availableQuantity) - required), manufacturingReservedQuantity: decimal(units(receipt.manufacturingReservedQuantity || '0') + required) }, $inc: { version: 1 } }, { session });
          if (!reserved.matchedCount) fail(409, 'VERSION_CONFLICT');
          const material = { receiptId: receipt._id, quantityPerUnit: decimal(ratio), quantity: decimal(required), uom: m.uom, ...(receipt.lotNumber !== undefined ? { materialTrace: { receiptId: receipt._id, lotNumber: receipt.lotNumber, heatNumber: receipt.heatNumber } } : {}) };
          materials.push(material); await movement(req, row, 'MATERIAL_RESERVED', material, session);
        }
        row.routing = { operations, materials, releasedBy: req.scope.userId, releasedAt: new Date() }; row.status = 'RELEASED';
      }
      if (action === 'record') {
        if (!['RELEASED', 'IN_PROGRESS'].includes(row.status)) fail(409, 'STATE_CONFLICT');
        if (!Number.isSafeInteger(b.operationIndex) || b.operationIndex !== row.records.length || !row.routing.operations[b.operationIndex]) fail(409, 'OPERATION_SEQUENCE_CONFLICT');
        if (b.uom !== row.uom) fail(409, 'UOM_CONFLICT');
        const input = qty(b.inputQuantity, true), good = qty(b.goodQuantity, true), scrap = qty(b.scrapQuantity, true);
        const expected = units(row.records.at(-1)?.goodQuantity || row.quantity);
        if (input !== expected || good + scrap !== input) fail(409, 'CONSERVATION_CONFLICT');
        const finalOperation = b.operationIndex === row.routing.operations.length - 1;
        if (row.serialized && [input, good, scrap].some(n => n % 1000000n !== 0n)) fail(409, 'SERIAL_QUANTITY_CONFLICT');
        if ((!row.serialized || !finalOperation) && Object.hasOwn(b, 'outputSerials')) fail(400, 'INVALID_SERIALS');
        const outputSerials = row.serialized && finalOperation ? serials(b.outputSerials, good) : null;
        if (!row.records.length) for (const m of row.routing.materials) {
          const receipt = await find('warehouseReceipts', req, m.receiptId, session), amount = units(m.quantity);
          await requireUnheld(receipt, session);
          if (units(receipt.manufacturingReservedQuantity || '0') < amount) fail(409, 'INSUFFICIENT_STOCK');
          const consumed = await c('warehouseReceipts').updateOne({ ...req.filter, _id: receipt._id, version: receipt.version }, { $set: { manufacturingReservedQuantity: decimal(units(receipt.manufacturingReservedQuantity) - amount), manufacturingConsumedQuantity: decimal(units(receipt.manufacturingConsumedQuantity || '0') + amount) }, $inc: { version: 1 } }, { session });
          if (!consumed.matchedCount) fail(409, 'VERSION_CONFLICT');
          await movement(req, row, 'MATERIAL_CONSUMED', m, session);
        }
        const record = { operationIndex: b.operationIndex, code: row.routing.operations[b.operationIndex].code, inputQuantity: decimal(input), goodQuantity: decimal(good), scrapQuantity: decimal(scrap), uom: row.uom, evidence: text(b.evidence), recordedBy: req.scope.userId, recordedAt: new Date(), executionMode: 'OPERATOR_RECORDED' };
        row.records.push(record); row.totalScrapQuantity = decimal(row.records.reduce((a, r) => a + units(r.scrapQuantity), 0n));
        row.status = row.records.length === row.routing.operations.length ? 'QUARANTINED' : 'IN_PROGRESS';
        if (row.status === 'QUARANTINED') {
          const materialTrace = row.routing.materials.flatMap(m => m.materialTrace ? [structuredClone(m.materialTrace)] : []);
          row.output = { quantity: decimal(good), uom: row.uom, status: 'QUARANTINED', ...(outputSerials ? { serials: outputSerials, materialTrace } : materialTrace.length ? { materialTrace } : {}) };
          for (const serial of outputSerials || []) {
            if (await c('warehouseSerials').findOne({ ...req.filter, serial }, { session })) fail(409, 'SERIAL_CONFLICT');
            const unit = { ...base(req), workOrderId: row._id, salesOrderId: row.salesOrderId, accountId: row.accountId, lineIndex: row.lineIndex, serial, uom: row.uom, status: 'QUARANTINED', materialTrace: structuredClone(materialTrace) };
            await c('warehouseSerials').insertOne({ ...base(req), serial, sourceType: 'MANUFACTURING_OUTPUT', workOrderId: row._id, unitId: unit._id }, { session });
            await c('manufacturingOutputUnits').insertOne(unit, { session });
          }
        }
        await movement(req, row, 'OPERATION_RECORDED', record, session);
      }
      if (action === 'qc') {
        if (row.status !== 'QUARANTINED') fail(409, 'STATE_CONFLICT');
        if (b.uom !== row.uom) fail(409, 'UOM_CONFLICT');
        const accepted = qty(b.acceptedQuantity, true), rejected = qty(b.rejectedQuantity, true);
        if (accepted + rejected !== units(row.output.quantity)) fail(409, 'CONSERVATION_CONFLICT');
        if (!row.serialized && (Object.hasOwn(b, 'acceptedSerials') || Object.hasOwn(b, 'rejectedSerials'))) fail(400, 'INVALID_SERIALS');
        if (row.serialized) {
          const acceptedSerials = serials(b.acceptedSerials, accepted), rejectedSerials = serials(b.rejectedSerials, rejected), partition = [...acceptedSerials, ...rejectedSerials];
          if (new Set(partition).size !== partition.length || partition.length !== row.output.serials.length || partition.some(s => !row.output.serials.includes(s))) fail(409, 'SERIAL_SOURCE_CONFLICT');
          for (const [selected, status] of [[acceptedSerials, 'ACCEPTED'], [rejectedSerials, 'REJECTED']]) {
            if (!selected.length) continue;
            const changed = await c('manufacturingOutputUnits').updateMany({ ...req.filter, workOrderId: row._id, serial: { $in: selected }, status: 'QUARANTINED' }, { $set: { status, updatedAt: new Date() }, $inc: { version: 1 } }, { session });
            if (changed.matchedCount !== selected.length) fail(409, 'SERIAL_STATE_CONFLICT');
          }
        }
        row.qc = { acceptedQuantity: decimal(accepted), rejectedQuantity: decimal(rejected), uom: row.uom, evidence: text(b.evidence), recordedBy: req.scope.userId, recordedAt: new Date() };
        if (row.serialized) Object.assign(row.qc, { acceptedSerials: [...b.acceptedSerials], rejectedSerials: [...b.rejectedSerials] });
        row.output.status = 'QC_COMPLETED'; row.status = 'QC_COMPLETED';
        await movement(req, row, 'QC_RECORDED', row.qc, session);
      }
      row.version++; row.updatedAt = new Date();
      const saved = await c('manufacturingWorkOrders').replaceOne({ ...req.filter, _id: row._id, version: b.expectedVersion }, row, { session });
      if (!saved.matchedCount) fail(409, 'VERSION_CONFLICT'); return row;
    }); res.json({ data });
  });
}
