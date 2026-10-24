import { randomUUID, createHash } from 'node:crypto';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
export async function initializeInquiries(db) {
  await db.collection('inquiryKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('quotes').createIndex({ tenantId: 1, plantId: 1, inquiryId: 1 }, { unique: true, partialFilterExpression: { inquiryId: { $type: 'string' } } });
}
export function installInquiries(app, runtime, { fail, guard, id, fields, validateQuote }) {
  const c = name => runtime.db.collection(name);
  const lines = (input, previous) => {
    if (!Array.isArray(input) || !input.length || input.length > 100) fail(422, 'INVALID_LINES');
    const seen = new Set();
    return input.map(line => {
      fields(line, ['itemCode', 'description', 'quantity', 'uom', 'drawingNumber', 'drawingRevision', ...(previous ? ['lineId'] : [])]);
      if (line.lineId !== undefined && (!previous?.some(l => l.lineId === line.lineId) || seen.has(line.lineId))) fail(422, 'INVALID_LINE_ID');
      if (line.lineId) seen.add(line.lineId);
      for (const key of ['itemCode', 'description', 'drawingNumber', 'drawingRevision']) if (typeof line[key] !== 'string' || !line[key].trim() || line[key].length > 200) fail(422, 'INVALID_LINE');
      if (typeof line.quantity !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(line.quantity) || !/[1-9]/.test(line.quantity)) fail(422, 'INVALID_QUANTITY');
      if (typeof line.uom !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(line.uom)) fail(422, 'INVALID_UOM');
      return { ...line, lineId: line.lineId || randomUUID() };
    });
  };
  app.use('/api/commercial/inquiries', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.inquiryAction = req.method === 'GET' ? 'quote.read' : 'quote.write';
    await runtime.foundation.authorize(req.scope, { ...req.filter, action: req.inquiryAction }); next();
  });
  app.get('/api/commercial/inquiries', async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter };
    if (req.query.accountId !== undefined) filter.accountId = id(req.query.accountId);
    if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c('inquiries').find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  for (const operation of ['revisions', 'stage', 'convert']) app.post(`/api/commercial/inquiries/:id/${operation}`, async (req, res) => {
    fields(req.body, operation === 'revisions' ? ['expectedVersion', 'lines', 'idempotencyKey'] : operation === 'stage' ? ['expectedVersion', 'toStage', 'reason', 'idempotencyKey'] : ['expectedVersion', 'revision', 'expiresAt', 'taxPolicy', 'roundingPolicy', 'prices', 'idempotencyKey']);
    const { expectedVersion, idempotencyKey: key } = req.body;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(422, 'INVALID_VERSION');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(422, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = createHash('sha256').update(JSON.stringify({ operation, id: req.params.id, body: req.body })).digest('hex');
    const session = runtime.client.startSession();
    try {
      const data = await session.withTransaction(async () => {
        await guard(runtime, req, session, 'quote.write');
        const row = await c('inquiries').findOne({ ...req.filter, _id: id(req.params.id) }, { session });
        if (!row) fail(404, 'NOT_FOUND');
        const prior = await c('inquiryKeys').findOne({ ...req.filter, key }, { session });
        if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.data; }
        if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
        const latest = row.revisions.at(-1), now = new Date();
        let result = row;
        if (operation === 'revisions') {
          if (row.stage !== 'DRAFT') fail(409, 'STATE_CONFLICT');
          row.revisions.push({ number: latest.number + 1, lines: lines(req.body.lines, latest.lines) });
        } else if (operation === 'stage') {
          const { toStage, reason } = req.body;
          if (!['SUBMITTED', 'IN_REVIEW'].includes(toStage)) fail(422, 'INVALID_STAGE');
          if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) fail(422, 'INVALID_REASON');
          if (!((row.stage === 'DRAFT' && toStage === 'SUBMITTED') || (row.stage === 'SUBMITTED' && toStage === 'IN_REVIEW'))) fail(409, 'STATE_CONFLICT');
          row.history.push({ actorId: req.scope.userId, occurredAt: now, reason, from: row.stage, to: toStage }); row.stage = toStage;
        } else {
          if (row.stage !== 'IN_REVIEW') fail(409, 'STATE_CONFLICT');
          if (req.body.revision !== latest.number) fail(409, 'STALE_REVISION');
          const prices = req.body.prices;
          if (!Array.isArray(prices) || prices.length !== latest.lines.length || new Set(prices.map(p => p?.inquiryLineId)).size !== prices.length) fail(422, 'INVALID_PRICES');
          for (const price of prices) { fields(price, ['inquiryLineId', 'unitPrice', 'currency']); if (!latest.lines.some(l => l.lineId === price.inquiryLineId)) fail(422, 'INVALID_PRICES'); }
          const revision = validateQuote({ ...req.body, lines: latest.lines.map(l => { const p = prices.find(p => p.inquiryLineId === l.lineId); return { description: l.description, quantity: l.quantity, uom: l.uom, unitPrice: p.unitPrice, currency: p.currency }; }) });
          revision.lines = revision.lines.map((line, i) => { const l = latest.lines[i]; return { ...line, provenance: { inquiryId: row._id, inquiryRevision: latest.number, inquiryLineId: l.lineId, itemCode: l.itemCode, drawingNumber: l.drawingNumber, drawingRevision: l.drawingRevision } }; });
          const quote = { _id: randomUUID(), ...req.filter, inquiryId: row._id, inquiryRevision: latest.number, accountId: row.accountId, version: 1, status: 'DRAFT', revisions: [{ ...revision, number: 1 }], createdAt: now, updatedAt: now };
          await c('quotes').insertOne(quote, { session });
          row.history.push({ actorId: req.scope.userId, occurredAt: now, reason: 'Converted to quote', from: row.stage, to: 'QUOTED' }); row.stage = 'QUOTED'; row.quoteId = quote._id;
          result = { inquiryId: row._id, inquiryRevision: latest.number, quoteId: quote._id, quote, lineMapping: latest.lines.map((l, quoteLineIndex) => ({ inquiryLineId: l.lineId, quoteLineIndex })) };
        }
        row.version++; row.updatedAt = now;
        await c('inquiries').replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session });
        await c('inquiryKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, data: result }, { session });
        await c('commercialAudit').insertOne({ _id: randomUUID(), ...req.filter, kind: `inquiry.${operation}`, subjectId: row._id, version: row.version, userId: req.scope.userId, occurredAt: now }, { session });
        await c('commercialOutbox').insertOne({ _id: randomUUID(), ...req.filter, kind: `inquiry.${operation}`, subjectId: row._id, state: 'PENDING', occurredAt: now }, { session });
        return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
      res.json({ data });
    } finally { await session.endSession(); }
  });
  app.get('/api/commercial/inquiries/:id', async (req, res) => {
    const row = await c('inquiries').findOne({ ...req.filter, _id: id(req.params.id) });
    if (!row) fail(404, 'NOT_FOUND'); res.json({ data: row });
  });
  app.post('/api/commercial/inquiries', async (req, res) => {
    fields(req.body, ['accountId', 'lines', 'idempotencyKey']);
    const accountId = id(req.body.accountId), content = lines(req.body.lines), key = req.body.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(422, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex'), session = runtime.client.startSession();
    try {
      const data = await session.withTransaction(async () => {
        await guard(runtime, req, session, req.inquiryAction);
        const prior = await c('inquiryKeys').findOne({ ...req.filter, key }, { session });
        if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT'); return prior.data; }
        if (!await c('accounts').findOne({ ...req.filter, _id: accountId }, { session })) fail(404, 'NOT_FOUND');
        const row = { _id: randomUUID(), ...req.filter, accountId, version: 1, stage: 'DRAFT', revisions: [{ number: 1, lines: content }], history: [], createdAt: new Date(), updatedAt: new Date() };
        await c('inquiries').insertOne(row, { session });
        await c('inquiryKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, data: row }, { session });
        await c('commercialAudit').insertOne({ _id: randomUUID(), ...req.filter, kind: 'inquiry.created', subjectId: row._id, version: 1, userId: req.scope.userId, occurredAt: new Date() }, { session });
        await c('commercialOutbox').insertOne({ _id: randomUUID(), ...req.filter, kind: 'inquiry.created', subjectId: row._id, state: 'PENDING', occurredAt: new Date() }, { session });
        return row;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
      res.status(201).json({ data });
    } finally { await session.endSession(); }
  });
}
