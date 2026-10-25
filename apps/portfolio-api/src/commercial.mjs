import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { installInquiries, initializeInquiries } from './inquiries.mjs';
import { fixtureVat, fixtureTax, taxAmounts, formatMoney } from './fixture-tax.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { businessNow } from './business-clock.mjs';
export const commercialActions = ['quote.read', 'quote.write', 'quote.approve', 'quote.accept', 'quote.convert'];
export const roleActions = { owner: ['crm.read', 'crm.write', ...commercialActions], quoteEditor: ['quote.read', 'quote.write'], quoteApprover: ['quote.read', 'quote.approve'], quoteAcceptor: ['quote.read', 'quote.accept'], quoteConverter: ['quote.read', 'quote.convert'], quoteReader: ['quote.read'] };
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
// Public customer-facing order number: stable, unique per tenant+plant (unique index), never the raw UUID.
export const orderNumberFor = ({ tenantId, plantId }, orderId) => `SO-${createHash('sha256').update(`${tenantId}:${plantId}:${orderId}`).digest('hex').slice(0, 16).toUpperCase()}`;
export async function initializeCommercial(db) {
  await initializeInquiries(db);
  await db.collection('salesOrders').createIndex({ tenantId: 1, plantId: 1, quoteId: 1 }, { unique: true });
  await db.collection('salesOrders').createIndex({ tenantId: 1, plantId: 1, orderNumber: 1 }, { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } });
  await db.collection('quoteConversions').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
}
export function installCommercial(app, runtime, { fail, guard, id, fields }) {
  const c = name => runtime.db.collection(name);
  const validate = body => {
    if (!['NO_TAX', 'FIXTURE_VAT_11_V1'].includes(body.taxPolicy) || body.roundingPolicy !== 'LINE_HALF_UP') fail(400, 'INVALID_POLICY');
    if (typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt || Date.parse(body.expiresAt) <= businessNow(runtime).getTime()) fail(400, 'INVALID_EXPIRY');
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) fail(400, 'INVALID_LINES');
    let total = 0n, taxTotal = 0n, currency;
    const lines = body.lines.map(line => {
      if (!line || typeof line !== 'object' || Object.keys(line).filter(k => k !== 'provenance').sort().join(',') !== 'currency,description,quantity,unitPrice,uom') fail(400, 'INVALID_LINE');
      const scale = scales[line.currency];
      if (scale === undefined || (currency && currency !== line.currency)) fail(400, 'INVALID_CURRENCY');
      currency = line.currency;
      if (typeof line.quantity !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(line.quantity) || !/[1-9]/.test(line.quantity)) fail(400, 'INVALID_QUANTITY');
      if (typeof line.unitPrice !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,27})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(line.unitPrice)) fail(400, 'INVALID_PRICE');
      if (typeof line.uom !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(line.uom) || typeof line.description !== 'string' || !line.description.trim() || line.description.length > 200) fail(400, 'INVALID_LINE');
      const places = line.quantity.split('.')[1]?.length || 0;
      const denominator = 10n ** BigInt(places);
      const product = BigInt(line.quantity.replace('.', '')) * BigInt(line.unitPrice.replace('.', ''));
      const net = (product * 2n + denominator) / (denominator * 2n);
      total += net;
      if (!fixtureVat(body.taxPolicy)) return { ...line };
      const tax = fixtureTax(net); taxTotal += tax;
      return { ...line, ...taxAmounts(net, tax, scale) };
    });
    const scale = scales[currency];
    const raw = total.toString().padStart(scale + 1, '0');
    return { lines, currency, ...(fixtureVat(body.taxPolicy) ? { ...taxAmounts(total, taxTotal, scale), taxRate: '0.11', taxPolicyVersion: 1 } : {}), total: fixtureVat(body.taxPolicy) ? formatMoney(total + taxTotal, scale) : scale ? raw.slice(0, -scale) + '.' + raw.slice(-scale) : raw, expiresAt: new Date(body.expiresAt), taxPolicy: body.taxPolicy, roundingPolicy: body.roundingPolicy };
  };
  installInquiries(app, runtime, { fail, guard, id, fields, validateQuote: validate });
  app.use('/api/commercial', async (req, res, next) => {
    const scope = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (scope.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    req.filter = scope;
    const command = /^\/quotes\/[^/]+\/(revisions|approve|accept|convert)$/.exec(req.path)?.[1];
    req.commercialAction = req.method === 'GET' ? 'quote.read' : req.method === 'POST' && (req.path === '/quotes' || command === 'revisions') ? 'quote.write' : req.method === 'POST' && command ? `quote.${command}` : null;
    if (!req.commercialAction) fail(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...scope, action: req.commercialAction });
    next();
  });
  const find = async (req, key, session) => {
    const row = await c('quotes').findOne({ ...req.filter, _id: id(key) }, { session });
    if (!row) fail(404, 'NOT_FOUND'); return row;
  };
  const tx = async (req, kind, effect) => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      await guard(runtime, req, session, req.commercialAction);
      const result = await effect(session);
      if (!result.replay) await c('commercialAudit').insertOne({ _id: randomUUID(), ...req.filter, userId: req.scope.userId, kind, subjectId: result._id, version: result.version, occurredAt: new Date() }, { session });
      return result;
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' }); }
    finally { await session.endSession(); }
  };
  app.get('/api/commercial/quotes', async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c('quotes').find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(); const data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  app.get('/api/commercial/orders', async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c('salesOrders').find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  app.get('/api/commercial/orders/:id', async (req, res) => {
    const data = await c('salesOrders').findOne({ ...req.filter, _id: id(req.params.id) });
    if (!data) fail(404, 'NOT_FOUND'); res.json({ data });
  });
  app.get('/api/commercial/quotes/:id', async (req, res) => res.json({ data: await find(req, req.params.id) }));
  app.post('/api/commercial/quotes', async (req, res) => {
    fields(req.body, ['accountId', 'expiresAt', 'lines', 'taxPolicy', 'roundingPolicy']);
    if (Array.isArray(req.body.lines) && req.body.lines.some(l => l?.provenance !== undefined)) fail(422, 'SOURCE_TAMPER');
    const accountId = id(req.body.accountId), revision = validate(req.body);
    const data = await tx(req, 'quote.created', async session => {
      if (!await c('accounts').findOne({ ...req.filter, _id: accountId }, { session })) fail(404, 'NOT_FOUND');
      const row = { _id: randomUUID(), ...req.filter, accountId, version: 1, status: 'DRAFT', revisions: [{ ...revision, number: 1 }], createdAt: new Date(), updatedAt: new Date() };
      await c('quotes').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  for (const operation of ['revisions', 'approve', 'accept', 'convert']) app.post(`/api/commercial/quotes/:id/${operation}`, async (req, res) => {
    fields(req.body, operation === 'revisions' ? ['expectedVersion', 'expiresAt', 'lines', 'taxPolicy', 'roundingPolicy', 'accountId'] : operation === 'convert' ? ['expectedVersion', 'revision', 'idempotencyKey'] : ['expectedVersion', 'revision']);
    const { expectedVersion, revision, idempotencyKey } = req.body;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || (operation !== 'revisions' && (!Number.isSafeInteger(revision) || revision < 1))) fail(400, 'INVALID_VERSION');
    const nextRevision = operation === 'revisions' ? validate(req.body) : null;
    if (operation === 'convert' && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    const payloadHash = createHash('sha256').update(JSON.stringify({ quoteId: req.params.id, expectedVersion, revision })).digest('hex');
    const data = await tx(req, operation === 'convert' ? 'quote.converted' : `quote.${operation}`, async session => {
      const row = await find(req, req.params.id, session);
      if (operation === 'convert') {
        const prior = await c('quoteConversions').findOne({ ...req.filter, key: idempotencyKey }, { session });
        if (prior) {
          if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
          const order = await c('salesOrders').findOne({ ...req.filter, _id: prior.orderId }, { session });
          return { ...order, replay: true };
        }
      }
      if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (row.status === 'CONVERTED') fail(409, 'ALREADY_CONVERTED');
      const latest = row.revisions.at(-1);
      if (operation === 'revisions') {
        if (req.body.accountId !== undefined && req.body.accountId !== row.accountId) fail(400, 'ACCOUNT_CONFLICT');
        if (row.inquiryId) {
          if (nextRevision.lines.length !== latest.lines.length || nextRevision.lines.some((line, i) => ['description', 'quantity', 'uom'].some(k => line[k] !== latest.lines[i][k]) || !isDeepStrictEqual(line.provenance, latest.lines[i].provenance))) fail(422, 'SOURCE_TAMPER');
          nextRevision.lines = nextRevision.lines.map((line, i) => ({ ...line, provenance: structuredClone(latest.lines[i].provenance) }));
        } else if (nextRevision.lines.some(l => l.provenance !== undefined)) fail(422, 'SOURCE_TAMPER');
        row.revisions.push({ ...nextRevision, number: latest.number + 1 }); row.status = 'DRAFT';
        delete row.acceptedRevision;
      } else {
        if (latest.number !== revision) fail(409, 'STALE_REVISION');
        if (latest.expiresAt <= businessNow(runtime)) fail(409, 'QUOTE_EXPIRED');
        if (operation === 'approve') {
          if (row.status !== 'DRAFT') fail(409, 'STATE_CONFLICT');
          row.approvals = [...(row.approvals || []), { revision, snapshot: structuredClone(latest), approvedBy: req.scope.userId, approvedAt: new Date() }]; row.status = 'APPROVED';
        } else if (operation === 'accept') {
          if (row.status !== 'APPROVED' || !row.approvals?.some(a => a.revision === revision)) fail(409, 'NOT_APPROVED');
          row.acceptedRevision = revision; row.acceptedBy = req.scope.userId; row.acceptedAt = new Date(); row.status = 'ACCEPTED';
        } else {
          if (row.status !== 'ACCEPTED' || row.acceptedRevision !== revision) fail(409, 'NOT_ACCEPTED');
          const orderId = randomUUID();
          const order = { _id: orderId, ...req.filter, orderNumber: orderNumberFor(req.filter, orderId), quoteId: row._id, quoteRevision: revision, accountId: row.accountId, version: 1, status: 'OPEN', snapshot: structuredClone(row.approvals.find(a => a.revision === revision).snapshot), createdAt: new Date(), createdBy: req.scope.userId };
          await c('salesOrders').insertOne(order, { session });
          await c('quoteConversions').insertOne({ _id: randomUUID(), ...req.filter, key: idempotencyKey, payloadHash, quoteId: row._id, orderId: order._id }, { session });
          await c('commercialOutbox').insertOne({ _id: randomUUID(), ...req.filter, kind: 'salesOrder.created', subjectId: order._id, quoteId: row._id, occurredAt: new Date(), state: 'PENDING' }, { session });
          row.status = 'CONVERTED'; row.orderId = order._id;
          row.version++; row.updatedAt = new Date();
          await c('quotes').replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session });
          return order;
        }
      }
      row.version++; row.updatedAt = new Date();
      await c('quotes').replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session }); return row;
    });
    const { replay, ...record } = data;
    res.json({ data: record });
  });
}
