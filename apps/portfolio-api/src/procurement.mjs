import { randomUUID, createHash } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';

export const procurementRoles = Object.fromEntries(['read', 'write', 'approve', 'convert', 'issue', 'confirm'].map(action => [`procurement${action[0].toUpperCase()}${action.slice(1)}`, [...new Set(['procurement.read', `procurement.${action}`])]]));
export const procurementActions = ['read', 'write', 'approve', 'convert', 'issue', 'confirm'].map(a => `procurement.${a}`);
export async function initializeProcurement(db) {
  await db.collection('purchaseOrders').createIndex({ tenantId: 1, plantId: 1, requestId: 1 }, { unique: true });
  await db.collection('procurementConversions').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
}
export function installProcurement(app, runtime, { fail, guard, id, fields }) {
  const c = name => runtime.db.collection(name);
  const snapshot = body => {
    if (body.taxPolicy !== 'NO_TAX' || body.roundingPolicy !== 'LINE_HALF_UP') fail(400, 'INVALID_POLICY');
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) fail(400, 'INVALID_LINES');
    const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
    let total = 0n, currency;
    const lines = body.lines.map(line => {
      if (!line || typeof line !== 'object' || Object.keys(line).sort().join(',') !== 'currency,description,quantity,unitPrice,uom') fail(400, 'INVALID_LINE');
      if (!Object.hasOwn(scales, line.currency) || (currency && currency !== line.currency)) fail(400, 'INVALID_CURRENCY');
      currency = line.currency; const scale = scales[currency];
      if (typeof line.quantity !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(line.quantity) || !/[1-9]/.test(line.quantity)) fail(400, 'INVALID_QUANTITY');
      if (typeof line.unitPrice !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(line.unitPrice)) fail(400, 'INVALID_PRICE');
      if (typeof line.uom !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(line.uom) || typeof line.description !== 'string' || !line.description.trim() || line.description.length > 200) fail(400, 'INVALID_LINE');
      const denominator = 10n ** BigInt(line.quantity.split('.')[1]?.length || 0);
      total += (BigInt(line.quantity.replace('.', '')) * BigInt(line.unitPrice.replace('.', '')) * 2n + denominator) / (denominator * 2n);
      return { ...line };
    });
    const scale = scales[currency], raw = total.toString().padStart(scale + 1, '0');
    return { lines, currency, total: scale ? raw.slice(0, -scale) + '.' + raw.slice(-scale) : raw, taxPolicy: body.taxPolicy, roundingPolicy: body.roundingPolicy };
  };
  app.use('/api/procurement', async (req, res, next) => {
    const scope = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (scope.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.filter = scope;
    const requestCommand = /^\/requests\/[^/]+\/(approve|convert)$/.exec(req.path)?.[1];
    const orderCommand = /^\/orders\/[^/]+\/(issue|vendor-confirmation)$/.exec(req.path)?.[1];
    const command = ['/vendors', '/requests'].includes(req.path) ? 'write' : requestCommand || (orderCommand === 'vendor-confirmation' ? 'confirm' : orderCommand);
    req.procurementAction = req.method === 'GET' ? 'procurement.read' : req.method === 'POST' && command ? `procurement.${command}` : null;
    if (!req.procurementAction) fail(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...scope, action: req.procurementAction }); next();
  });
  const find = async (collection, req, key, session) => {
    const row = await c(collection).findOne({ ...req.filter, _id: id(key) }, { session });
    if (!row) fail(404, 'NOT_FOUND'); return row;
  };
  const tx = async (req, kind, effect) => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await guard(runtime, req, session, req.procurementAction);
      const result = await effect(session);
      if (!result.replay) {
        const event = { ...req.filter, kind, subjectId: result._id, version: result.version, userId: req.scope.userId, occurredAt: new Date() };
        await c('procurementAudit').insertOne({ _id: randomUUID(), ...event }, { session });
        await c('procurementOutbox').insertOne({ _id: randomUUID(), ...event, state: 'PENDING' }, { session });
      }
      return result;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
    finally { await session.endSession(); }
  };
  const base = req => ({ _id: randomUUID(), ...req.filter, version: 1, createdAt: new Date(), createdBy: req.scope.userId });
  for (const [path, collection] of [['vendors', 'vendors'], ['requests', 'purchaseRequests'], ['orders', 'purchaseOrders']]) {
    app.get(`/api/procurement/${path}`, async (req, res) => {
      const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
      const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
      const rows = await c(collection).find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
      res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
    });
    app.get(`/api/procurement/${path}/:id`, async (req, res) => res.json({ data: await find(collection, req, req.params.id) }));
  }
  app.post('/api/procurement/vendors', async (req, res) => {
    fields(req.body, ['name']);
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 200) fail(400, 'INVALID_TEXT');
    const data = await tx(req, 'vendor.created', async session => { const row = { ...base(req), name: req.body.name.trim() }; await c('vendors').insertOne(row, { session }); return row; });
    res.status(201).json({ data });
  });
  app.post('/api/procurement/requests', async (req, res) => {
    fields(req.body, ['vendorId', 'lines', 'taxPolicy', 'roundingPolicy']);
    const vendorId = id(req.body.vendorId), content = snapshot(req.body);
    const data = await tx(req, 'purchaseRequest.created', async session => {
      await find('vendors', req, vendorId, session);
      const row = { ...base(req), vendorId, snapshot: content, status: 'DRAFT' };
      await c('purchaseRequests').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  for (const operation of ['approve', 'convert', 'issue', 'vendor-confirmation']) {
    const requestOperation = ['approve', 'convert'].includes(operation), collection = requestOperation ? 'purchaseRequests' : 'purchaseOrders';
    app.post(`/api/procurement/${requestOperation ? 'requests' : 'orders'}/:id/${operation}`, async (req, res) => {
      fields(req.body, ['expectedVersion', ...(operation === 'convert' ? ['idempotencyKey'] : operation === 'vendor-confirmation' ? ['vendorId', 'reference'] : [])]);
      const { expectedVersion, idempotencyKey } = req.body;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_VERSION');
      if (operation === 'convert' && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))) fail(400, 'INVALID_IDEMPOTENCY_KEY');
      if (operation === 'vendor-confirmation' && (typeof req.body.reference !== 'string' || !req.body.reference.trim() || req.body.reference.length > 200)) fail(400, 'INVALID_REFERENCE');
      const payloadHash = createHash('sha256').update(JSON.stringify({ requestId: req.params.id, expectedVersion })).digest('hex');
      const data = await tx(req, `purchase${requestOperation ? 'Request' : 'Order'}.${operation}`, async session => {
        const row = await find(collection, req, req.params.id, session);
        if (operation === 'convert') {
          const prior = await c('procurementConversions').findOne({ ...req.filter, key: idempotencyKey }, { session });
          if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return { ...await find('purchaseOrders', req, prior.orderId, session), replay: true }; }
        }
        if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
        await find('vendors', req, row.vendorId, session);
        const required = { approve: 'DRAFT', convert: 'APPROVED', issue: 'DRAFT', 'vendor-confirmation': 'ISSUED' }[operation];
        if (row.status !== required) fail(409, 'STATE_CONFLICT');
        let order;
        if (operation === 'approve') { row.approval = { snapshot: structuredClone(row.snapshot), approvedBy: req.scope.userId, approvedAt: new Date() }; row.status = 'APPROVED'; }
        if (operation === 'convert') {
          order = { ...base(req), requestId: row._id, vendorId: row.vendorId, snapshot: structuredClone(row.approval.snapshot), status: 'DRAFT' };
          await c('purchaseOrders').insertOne(order, { session });
          await c('procurementConversions').insertOne({ _id: randomUUID(), ...req.filter, key: idempotencyKey, payloadHash, requestId: row._id, orderId: order._id }, { session });
          row.status = 'CONVERTED'; row.orderId = order._id;
        }
        if (operation === 'issue') { row.status = 'ISSUED'; row.issuedAt = new Date(); row.issuedBy = req.scope.userId; }
        if (operation === 'vendor-confirmation') {
          if (id(req.body.vendorId) !== row.vendorId) fail(409, 'VENDOR_CONFLICT');
          row.status = 'CONFIRMED'; row.confirmation = { vendorId: row.vendorId, reference: req.body.reference.trim(), recordedAt: new Date(), recordedBy: req.scope.userId, source: 'OPERATOR_RECORDED' };
        }
        row.version++; row.updatedAt = new Date();
        const result = await c(collection).replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session });
        if (!result.matchedCount) fail(409, 'VERSION_CONFLICT'); return order || row;
      });
      const { replay, ...record } = data; res.json({ data: record });
    });
  }
}
