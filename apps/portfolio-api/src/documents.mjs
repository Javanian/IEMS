import { randomUUID } from 'node:crypto';
import { fixtureVat } from './fixture-tax.mjs';
import { isDeepStrictEqual } from 'node:util';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { createSnapshot, createIssuer } from '../../../packages/document-rendering/src/index.mjs';

export const documentActions = ['document.read', 'document.issue'];
export const documentRoles = { documentReader: ['document.read'], documentIssuer: documentActions };
const kinds = { quote: ['quotes', 'quote.read'], purchaseOrder: ['purchaseOrders', 'procurement.read'], invoice: ['fulfillmentInvoices', 'fulfillment.read'], repairInvoice: ['repairInvoices', 'repair.read'], shipment: ['fulfillmentShipments', 'fulfillment.read'] };
const options = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
export async function initializeDocuments(runtime) {
  await runtime.db.collection('documentIntents').createIndex({ tenantId: 1, legalEntityId: 1, plantId: 1, kind: 1, sourceId: 1, sourceVersion: 1 }, { unique: true });
  return createIssuer({ client: runtime.client, db: runtime.db });
}
export function installDocuments(app, runtime, { fail, guard, id }) {
  const c = name => runtime.db.collection(name);
  const tx = async (req, actions, effect) => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      for (const action of actions) await guard(runtime, req, session, action);
      const plant = await c('plants').findOne({ _id: req.filter.plantId, tenantId: req.filter.tenantId }, { session });
      const scope = { ...req.filter, legalEntityId: plant.legalEntityId };
      return effect(session, scope);
    }, options); } finally { await session.endSession(); }
  };
  const input = (kind, sourceId, sourceVersion) => {
    if (!Object.hasOwn(kinds, kind)) fail(400, 'INVALID_KIND');
    id(sourceId);
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) fail(400, 'INVALID_VERSION');
    if (kind !== 'quote' && sourceVersion !== 1) fail(400, 'INVALID_VERSION');
    return { kind, sourceId, sourceVersion };
  };
  const snapshot = async (req, scope, key, session) => {
    const row = await c(kinds[key.kind][0]).findOneAndUpdate({ ...req.filter, _id: key.sourceId }, { $inc: { documentFence: 1 } }, { session, returnDocument: 'after' });
    if (!row) fail(404, 'NOT_FOUND');
    let source;
    if (key.kind === 'quote') {
      const approval = row.approvals?.find(a => a.revision === key.sourceVersion);
      if (!approval) fail(409, 'SOURCE_NOT_ISSUED');
      source = { snapshot: approval.snapshot };
    } else if (key.kind === 'purchaseOrder') {
      if (!['ISSUED', 'CONFIRMED'].includes(row.status)) fail(409, 'SOURCE_NOT_ISSUED');
      source = { snapshot: row.snapshot };
    } else if (key.kind === 'repairInvoice') {
      if (!['FINAL', 'DIAGNOSTIC'].includes(row.kind) || !['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(row.status)) fail(409, 'SOURCE_NOT_ISSUED');
      source = row.snapshot;
    } else if (key.kind === 'shipment') {
      if (row.status !== 'SHIPPED') fail(409, 'SOURCE_NOT_ISSUED');
      source = row;
    } else {
      if (!['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(row.status)) fail(409, 'SOURCE_NOT_ISSUED');
      source = row.lines.every(line => line.rounding) ? { ...row, roundingPolicy: 'CUMULATIVE_HALF_UP' } : row;
    }
    const vat = fixtureVat(source.snapshot?.taxPolicy || source.taxPolicy);
    if (vat && key.kind === 'repairInvoice') fail(409, 'TAX_POLICY_UNSUPPORTED');
    if (vat && !['quote','invoice'].includes(key.kind)) fail(422, 'TAX_PDF_UNSUPPORTED');
    if (vat && key.kind === 'invoice') source = { ...source, salesOrderVersion:source.sourceVersion };
    try { return createSnapshot(key.kind === 'repairInvoice' ? 'invoice' : key.kind, scope, { ...source, ...scope, _id: row._id, version: key.sourceVersion }); }
    catch (error) { fail(422, error.message); }
  };
  const mapped = async effect => {
    try { return await effect(); }
    catch (error) { if (error.message === 'ISSUE_CONFLICT') fail(409, 'ISSUE_CONFLICT'); throw error; }
  };
  const checkedReceipt = (intent, record) => {
    const expected = { ...record, _id: intent._id };
    if (intent.rendererId !== record._id || !isDeepStrictEqual(intent.record, expected)
      || !isDeepStrictEqual(intent.snapshot, record.snapshot)
      || record.kind !== (intent.kind === 'repairInvoice' ? 'invoice' : intent.kind)
      || record.sourceId !== intent.sourceId || record.sourceVersion !== intent.sourceVersion
      || ['tenantId', 'plantId', 'legalEntityId'].some(k => intent[k] !== record[k])) fail(500, 'ARTIFACT_INTEGRITY');
    return expected;
  };
  app.use('/api/documents', async (req, res, next) => {
    req.filter = resolveScopeAliases({ body: { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId, ...req.body }, query: req.query, headers: req.headers });
    if (req.filter.plantId !== req.scope.selectedPlantId) fail(403, 'SCOPE_DENIED');
    next();
  });
  app.get('/api/documents/sources/:kind/:id', async (req, res) => {
    if (typeof req.query.sourceVersion !== 'string' || !/^[1-9][0-9]*$/.test(req.query.sourceVersion)) fail(400, 'INVALID_VERSION');
    const key = input(req.params.kind, req.params.id, Number(req.query.sourceVersion));
    res.json({ data: await tx(req, [kinds[key.kind][1]], (session, scope) => snapshot(req, scope, key, session)) });
  });
  app.post('/api/documents/issues', async (req, res) => {
    if (!req.body || Object.keys(req.body).some(k => !['kind', 'sourceId', 'sourceVersion'].includes(k))) fail(400, 'UNKNOWN_FIELD');
    const key = input(req.body.kind, req.body.sourceId, req.body.sourceVersion), actions = ['document.issue', kinds[key.kind][1]];
    let intent;
    for (let attempt = 0; ; attempt++) {
      try {
        intent = await tx(req, actions, async (session, scope) => {
          const content = await snapshot(req, scope, key, session);
          const prior = await c('documentIntents').findOne({ ...scope, ...key }, { session });
          if (prior) {
            if (prior.snapshot.contentHash !== content.contentHash) fail(409, 'ISSUE_CONFLICT');
            return prior;
          }
          const row = { _id: randomUUID(), ...scope, ...key, state: 'PREPARED', snapshot: content, preparedBy: req.scope.userId, membershipId: req.scope.membershipId, membershipVersion: req.scope.membershipVersion, preparedAt: new Date() };
          await c('documentIntents').insertOne(row, { session }); return row;
        }); break;
      } catch (error) { if (error.code === 11000 && attempt < 5) continue; throw error; }
    }
    // The renderer commits independently; READY publication is the API visibility boundary.
    const record = await mapped(() => runtime.documents.issue({ tenantId: intent.tenantId, legalEntityId: intent.legalEntityId, plantId: intent.plantId }, intent.snapshot));
    const data = await tx(req, actions, async (session, scope) => {
      const current = await c('documentIntents').findOne({ ...scope, _id: intent._id }, { session });
      if (!current) fail(404, 'NOT_FOUND');
      if (current.state === 'READY') return checkedReceipt(current, record);
      const published = { ...record, _id: intent._id };
      await c('documentIntents').updateOne({ _id: intent._id, ...scope, state: 'PREPARED' }, { $set: { state: 'READY', rendererId: record._id, record: published, finalizedAt: new Date() } }, { session });
      const event = { ...scope, kind: 'document.issued', subjectId: intent._id, sourceId: key.sourceId, sourceVersion: key.sourceVersion, contentHash: record.contentHash, pdfHash: record.pdfHash, userId: req.scope.userId, occurredAt: new Date() };
      await c('documentAudit').insertOne({ _id: intent._id, ...event }, { session });
      await c('documentOutbox').insertOne({ _id: intent._id, ...event, state: 'PENDING' }, { session });
      return published;
    });
    res.json({ data });
  });
  const read = async req => tx(req, ['document.read'], async (session, scope) => {
    const intent = await c('documentIntents').findOne({ ...scope, _id: id(req.params.id), state: 'READY' }, { session });
    if (!intent) fail(404, 'NOT_FOUND');
    await guard(runtime, req, session, kinds[intent.kind][1]);
    const stored = await runtime.documents.read(scope, intent.rendererId);
    if (!stored) fail(500, 'ARTIFACT_INTEGRITY');
    return { record: checkedReceipt(intent, stored.record), pdf: stored.pdf };
  });
  app.get('/api/documents/issues/:id', async (req, res) => res.json({ data: (await read(req)).record }));
  app.get('/api/documents/issues/:id/pdf', async (req, res) => {
    const stored = await read(req);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${stored.record.kind}-${stored.record._id}.pdf"`, 'Cache-Control': 'private, no-store' }).send(stored.pdf);
  });
}
