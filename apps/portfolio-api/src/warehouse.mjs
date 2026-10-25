import { randomUUID, createHash } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { initializeStockHolds, installStockHolds, requireEligibleReceipt, holdActions, holdRoles } from './stock-holds.mjs';

export const warehouseActions = [...['read', 'receive', 'release', 'putaway', 'reserve', 'bin', 'transfer', 'count'].map(a => `warehouse.${a}`), ...holdActions];
// QC receipt release (`warehouse.release`) and stock-hold release (`warehouse.hold.release`) are separate grants.
export const warehouseRoles = { ...Object.fromEntries(['read', 'receive', 'release', 'putaway', 'reserve', 'bin', 'transfer', 'count'].map(a => [`warehouse${a[0].toUpperCase()}${a.slice(1)}`, [...new Set(['warehouse.read', `warehouse.${a}`])]])), ...holdRoles };
export async function initializeWarehouse(db) {
  for (const [name, keys] of [
    ['warehouseBins', { tenantId: 1, plantId: 1, code: 1 }],
    ['warehouseKeys', { tenantId: 1, plantId: 1, key: 1 }],
    ['warehouseSerials', { tenantId: 1, plantId: 1, serial: 1 }],
    ['warehouseReceived', { tenantId: 1, plantId: 1, purchaseOrderId: 1, lineIndex: 1 }],
    ['warehouseAllocated', { tenantId: 1, plantId: 1, salesOrderId: 1, lineIndex: 1 }],
  ]) await db.collection(name).createIndex(keys, { unique: true });
  await initializeStockHolds(db);
}
const units = s => BigInt(s.split('.')[0]) * 1000000n + BigInt((s.split('.')[1] || '').padEnd(6, '0'));
const decimal = n => { const s = n.toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
export function installWarehouse(app, runtime, { fail, guard, id, fields }) {
  const c = n => runtime.db.collection(n);
  const quantity = s => { if (typeof s !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(s) || !/[1-9]/.test(s)) fail(400, 'INVALID_QUANTITY'); return units(s); };
  const text = s => { if (typeof s !== 'string' || !s.trim() || s.length > 200) fail(400, 'INVALID_TEXT'); return s.trim(); };
  const line = (row, index) => { if (!Number.isSafeInteger(index) || index < 0 || !row.snapshot.lines[index]) fail(400, 'INVALID_LINE'); return row.snapshot.lines[index]; };
  const find = async (name, req, key, session) => { const row = await c(name).findOne({ ...req.filter, _id: id(key) }, { session }); if (!row) fail(404, 'NOT_FOUND'); return row; };
  const base = req => ({ _id: randomUUID(), ...req.filter, version: 1, createdAt: new Date(), createdBy: req.scope.userId });
  app.use('/api/warehouse', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    const holdAction = req.method === 'POST' && (/^\/receipts\/[^/]+\/holds$/.test(req.path) ? 'warehouse.hold.apply' : /^\/holds\/[^/]+\/release$/.test(req.path) ? 'warehouse.hold.release' : null);
    const receiptCommand = /^\/receipts\/[^/]+\/(release|putaway|reserve|transfer|count)$/.exec(req.path)?.[1];
    const command = req.path === '/receipts' ? 'receive' : req.path === '/bins' ? 'bin' : receiptCommand;
    req.warehouseAction = req.method === 'GET' ? 'warehouse.read' : holdAction || (req.method === 'POST' && command ? `warehouse.${command}` : null);
    if (!req.warehouseAction) fail(404, 'NOT_FOUND');
    try { await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.warehouseAction }); }
    catch (e) { if (holdAction && e?.code === 'SCOPE_DENIED') fail(403, 'FORBIDDEN', 'Forbidden'); throw e; }
    next();
  });
  installStockHolds(app, runtime, { guard });
  const tx = async (req, kind, payload, effect) => {
    const { expectedVersion, idempotencyKey: key } = req.body;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_VERSION');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = createHash('sha256').update(JSON.stringify({ kind, id: req.params.id || null, ...payload })).digest('hex');
    for (let attempt = 1; ; attempt++) {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await guard(runtime, req, session, req.warehouseAction);
      const prior = await c('warehouseKeys').findOne({ ...req.filter, key }, { session });
      if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.result; }
      const result = await effect(session);
      const event = { ...req.filter, kind, subjectId: result._id, version: result.version, userId: req.scope.userId, occurredAt: new Date() };
      await c('warehouseAudit').insertOne({ _id: randomUUID(), ...event }, { session });
      await c('warehouseOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
      await c('warehouseKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, result }, { session });
      return result;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
    catch (error) { if (error?.code === 11000 && attempt < 4) continue; if (error?.code === 11000 && error.keyPattern?.serial) fail(409, 'SERIAL_CONFLICT'); throw error; }
    finally { await session.endSession(); }
    }
  };
  const tally = async (name, filter, amount, maximum, session) => {
    const row = await c(name).findOne(filter, { session });
    const next = units(row?.quantity || '0') + amount;
    if (next > maximum) fail(409, 'QUANTITY_EXCEEDED');
    if (row) await c(name).updateOne({ _id: row._id, ...filter }, { $set: { quantity: decimal(next) } }, { session });
    else await c(name).insertOne({ _id: randomUUID(), ...filter, quantity: decimal(next) }, { session });
  };
  app.post('/api/warehouse/bins', async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'code']);
    const code = text(req.body.code);
    const data = await tx(req, 'bin.created', { expectedVersion: req.body.expectedVersion, code }, async session => {
      if (req.body.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT');
      if (await c('warehouseBins').findOne({ ...req.filter, code }, { session })) fail(409, 'BIN_CONFLICT');
      const row = { ...base(req), code };
      await c('warehouseBins').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  for (const [path, name] of [['bins', 'warehouseBins'], ['receipts', 'warehouseReceipts'], ['movements', 'warehouseMovements'], ['reservations', 'warehouseReservations']]) {
    app.get(`/api/warehouse/${path}`, async (req, res) => {
      const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
      const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
      const rows = await c(name).find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
      res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
    });
    app.get(`/api/warehouse/${path}/:id`, async (req, res) => res.json({ data: await find(name, req, req.params.id) }));
  }
  app.get('/api/warehouse/receipts/:id/reconciliation', async (req, res) => {
    const session = runtime.client.startSession();
    try {
      const data = await session.withTransaction(async () => {
        const receipt = await find('warehouseReceipts', req, req.params.id, session);
        const movements = await c('warehouseMovements').find({ ...req.filter, receiptId: receipt._id }, { session }).toArray();
        const materials = await c('manufacturingMovements').find({ ...req.filter, receiptId: receipt._id, kind: { $in: ['MATERIAL_RESERVED', 'MATERIAL_CONSUMED'] } }, { session }).toArray();
        const values = { availableQuantity: 0n, reservedQuantity: 0n, shippedQuantity: 0n, manufacturingReservedQuantity: 0n, manufacturingConsumedQuantity: 0n };
        for (const m of movements) {
          const n = units(m.quantity);
          if (m.kind === 'PUTAWAY') values.availableQuantity += n;
          if (m.kind === 'COUNT') values.availableQuantity += n - units(m.beforeQuantity);
          if (m.kind === 'RESERVE') { values.availableQuantity -= n; values.reservedQuantity += n; }
          if (m.kind === 'SHIP') { values.reservedQuantity -= n; values.shippedQuantity += n; }
        }
        for (const m of materials) {
          const n = units(m.quantity);
          if (m.kind === 'MATERIAL_RESERVED') { values.availableQuantity -= n; values.manufacturingReservedQuantity += n; }
          else { values.manufacturingReservedQuantity -= n; values.manufacturingConsumedQuantity += n; }
        }
        const replayed = Object.fromEntries(Object.entries(values).map(([k, n]) => [k, n < 0n ? `-${decimal(-n)}` : decimal(n)]));
        const cached = Object.fromEntries(Object.keys(values).map(k => [k, receipt[k] || '0']));
        const transfers = movements.filter(m => m.kind === 'TRANSFER').sort((a, b) => a.receiptVersion - b.receiptVersion);
        const location = transfers.length ? { replayed: transfers.at(-1).to, cached: receipt.location, matches: transfers.at(-1).to === receipt.location && transfers.at(-1).binId === receipt.binId } : null;
        return { receiptId: receipt._id, uom: receipt.uom, replayed, cached, matches: Object.keys(values).every(k => values[k] === units(cached[k])) && (!location || location.matches), warehouseMovementCount: movements.length, materialMovementCount: materials.length, ...(location ? { location } : {}) };
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
      res.json({ data });
    } finally { await session.endSession(); }
  });
  app.post('/api/warehouse/receipts', async (req, res) => {
    fields(req.body, ['purchaseOrderId', 'expectedVersion', 'vendorId', 'lineIndex', 'quantity', 'uom', 'serials', 'lotNumber', 'heatNumber', 'idempotencyKey']);
    const { purchaseOrderId, expectedVersion, vendorId, lineIndex, quantity: qty, uom, serials = [] } = req.body;
    id(purchaseOrderId); id(vendorId); const amount = quantity(qty);
    if (!Array.isArray(serials) || serials.length > 1000 || serials.some(s => typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(s)) || new Set(serials).size !== serials.length || (serials.length && amount !== BigInt(serials.length) * 1000000n)) fail(400, 'INVALID_SERIALS');
    const traced = Object.hasOwn(req.body, 'lotNumber') || Object.hasOwn(req.body, 'heatNumber');
    if (traced && ['lotNumber', 'heatNumber'].some(k => typeof req.body[k] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(req.body[k]))) fail(400, 'INVALID_MATERIAL_TRACE');
    const trace = traced ? { lotNumber: req.body.lotNumber, heatNumber: req.body.heatNumber } : {};
    const payload = { purchaseOrderId, expectedVersion, vendorId, lineIndex, quantity: qty, uom, serials, ...trace };
    const data = await tx(req, 'receipt.received', payload, async session => {
      const order = await find('purchaseOrders', req, purchaseOrderId, session);
      await find('vendors', req, vendorId, session);
      if (order.vendorId !== vendorId) fail(409, 'VENDOR_CONFLICT');
      const source = line(order, lineIndex);
      if (source.uom !== uom) fail(409, 'UOM_CONFLICT');
      if (order.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!['ISSUED', 'CONFIRMED'].includes(order.status)) fail(409, 'STATE_CONFLICT');
      await tally('warehouseReceived', { ...req.filter, purchaseOrderId, lineIndex }, amount, units(source.quantity), session);
      const row = { ...base(req), purchaseOrderId, vendorId, lineIndex, quantity: qty, uom, serials, ...trace, status: 'QUARANTINED', availableQuantity: '0', reservedQuantity: '0' };
      for (const serial of serials) {
        if (await c('warehouseSerials').findOne({ ...req.filter, serial }, { session })) fail(409, 'SERIAL_CONFLICT');
        await c('warehouseSerials').insertOne({ _id: randomUUID(), ...req.filter, serial, receiptId: row._id }, { session });
      }
      await c('warehouseReceipts').insertOne(row, { session });
      await movement(req, row, 'RECEIVE', qty, null, 'QUARANTINE', session); return row;
    }); res.status(201).json({ data });
  });
  const traceOf = row => row.lotNumber !== undefined ? { materialTrace: { receiptId: row._id, lotNumber: row.lotNumber, heatNumber: row.heatNumber } } : {};
  const movement = async (req, row, kind, qty, from, to, session, extra = {}) => c('warehouseMovements').insertOne({ ...base(req), receiptId: row._id, purchaseOrderId: row.purchaseOrderId, vendorId: row.vendorId, lineIndex: row.lineIndex, uom: row.uom, quantity: qty, kind, from, to, ...traceOf(row), ...extra }, { session });
  for (const operation of ['transfer', 'count']) app.post(`/api/warehouse/receipts/:id/${operation}`, async (req, res) => {
    const target = operation === 'transfer' ? 'binId' : 'countedQuantity';
    fields(req.body, ['expectedVersion', 'idempotencyKey', target, 'uom', 'reason']);
    text(req.body.reason);
    if (operation === 'transfer') id(req.body.binId);
    else if (typeof req.body.countedQuantity !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(req.body.countedQuantity)) fail(400, 'INVALID_QUANTITY');
    const payload = Object.fromEntries(['expectedVersion', target, 'uom', 'reason'].map(k => [k, req.body[k]]));
    const data = await tx(req, `receipt.${operation}`, payload, async session => {
      const row = await find('warehouseReceipts', req, req.params.id, session);
      if (row.version !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (row.status !== 'STORED') fail(409, 'STATE_CONFLICT');
      if (row.uom !== req.body.uom) fail(409, 'UOM_CONFLICT');
      if (['reservedQuantity', 'shippedQuantity', 'manufacturingReservedQuantity', 'manufacturingConsumedQuantity'].some(k => units(row[k] || '0') !== 0n) || row.held === true || row.hold?.active === true || units(row.heldQuantity || '0') !== 0n) fail(409, 'STOCK_ENCUMBERED');
      // Policy: a held receipt is neither moved (no quarantine-bin exception) nor counted, in either direction.
      await requireEligibleReceipt(runtime.db, row, session);
      if (operation === 'transfer') {
        const bin = await find('warehouseBins', req, req.body.binId, session);
        if (row.binId === bin._id || row.location === bin.code) fail(409, 'LOCATION_CONFLICT');
        const from = row.location;
        row.location = bin.code; row.binId = bin._id;
        await movement(req, row, 'TRANSFER', row.availableQuantity, from, row.location, session, { binId: bin._id, receiptVersion: row.version + 1, reason: req.body.reason.trim() });
      } else {
        if (row.serials?.length) fail(409, 'SERIAL_COUNT_CONFLICT');
        const counted = units(req.body.countedQuantity);
        if (counted > units(row.quantity)) fail(409, 'QUANTITY_EXCEEDED');
        await movement(req, row, 'COUNT', req.body.countedQuantity, row.location, row.location, session, { beforeQuantity: row.availableQuantity, reason: req.body.reason.trim() });
        row.availableQuantity = decimal(counted);
      }
      row.version++; row.updatedAt = new Date();
      const result = await c('warehouseReceipts').replaceOne({ ...req.filter, _id: row._id, version: req.body.expectedVersion }, row, { session });
      if (!result.matchedCount) fail(409, 'VERSION_CONFLICT'); return row;
    }); res.json({ data });
  });
  for (const operation of ['release', 'putaway', 'reserve']) app.post(`/api/warehouse/receipts/:id/${operation}`, async (req, res) => {
    const allowed = operation === 'release' ? ['reason'] : operation === 'putaway' ? ['location'] : ['salesOrderId', 'accountId', 'lineIndex', 'quantity', 'uom'];
    fields(req.body, ['expectedVersion', 'idempotencyKey', ...allowed]);
    const payload = Object.fromEntries(['expectedVersion', ...allowed].map(k => [k, req.body[k]]));
    if (operation === 'release') text(req.body.reason);
    if (operation === 'putaway') text(req.body.location);
    if (operation === 'reserve') { quantity(req.body.quantity); id(req.body.salesOrderId); id(req.body.accountId); }
    const data = await tx(req, `receipt.${operation}`, payload, async session => {
      const row = await find('warehouseReceipts', req, req.params.id, session);
      if (row.version !== req.body.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (row.status !== { release: 'QUARANTINED', putaway: 'RELEASED', reserve: 'STORED' }[operation]) fail(409, 'STATE_CONFLICT');
      if (operation === 'release') { row.status = 'RELEASED'; row.qc = { reason: req.body.reason.trim(), releasedBy: req.scope.userId, releasedAt: new Date() }; await movement(req, row, 'QC_RELEASE', row.quantity, 'QUARANTINE', 'RELEASED', session); }
      if (operation === 'putaway') { row.status = 'STORED'; row.location = req.body.location.trim(); row.availableQuantity = decimal(units(row.quantity)); await movement(req, row, 'PUTAWAY', row.quantity, 'RELEASED', row.location, session); }
      if (operation === 'reserve') {
        const { salesOrderId, accountId, lineIndex, quantity: qty, uom } = req.body, amount = quantity(qty);
        const so = await find('salesOrders', req, salesOrderId, session); await find('accounts', req, accountId, session);
        if (so.accountId !== accountId) fail(409, 'ACCOUNT_CONFLICT');
        const target = line(so, lineIndex);
        if (target.uom !== uom || row.uom !== uom) fail(409, 'UOM_CONFLICT');
        if (so.status !== 'OPEN' || amount > units(row.availableQuantity)) fail(409, 'INSUFFICIENT_STOCK');
        await requireEligibleReceipt(runtime.db, row, session);
        await tally('warehouseAllocated', { ...req.filter, salesOrderId, lineIndex }, amount, units(target.quantity), session);
        const reservation = { ...base(req), receiptId: row._id, salesOrderId, accountId, lineIndex, quantity: qty, uom, status: 'RESERVED', ...traceOf(row) };
        await c('warehouseReservations').insertOne(reservation, { session });
        row.availableQuantity = decimal(units(row.availableQuantity) - amount); row.reservedQuantity = decimal(units(row.reservedQuantity) + amount);
        await movement(req, row, 'RESERVE', qty, row.location, 'RESERVED', session, { reservationId: reservation._id, salesOrderId, accountId });
      }
      row.version++; row.updatedAt = new Date();
      const result = await c('warehouseReceipts').replaceOne({ ...req.filter, _id: row._id, version: req.body.expectedVersion }, row, { session });
      if (!result.matchedCount) fail(409, 'VERSION_CONFLICT'); return row;
    }); res.json({ data });
  });
}
