import { initializeLocalCommandReceipt, localCommandTransaction, checkLocalCommandKeys, localCommandPolicies } from '../../../packages/tenant-lifecycle/local-commands.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { saveCatalogOptionProjection } from './catalog-option-index.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { initializeMaterialShortages, installMaterialShortages } from './material-shortages.mjs';
import { initializePurchaseOrderRevisions, purchaseOrderLineIds, applyOrderAmendment, archiveInitialOrderRevision, readApprovedOrderRevision } from '../../../packages/contracts/src/domains/commercial/purchase-orders.mjs';

export const procurementRoles = Object.fromEntries(['read', 'write', 'approve', 'convert', 'issue', 'confirm'].map(action => [`procurement${action[0].toUpperCase()}${action.slice(1)}`, [...new Set(['procurement.read', `procurement.${action}`])]]));
export const procurementActions = ['read', 'write', 'approve', 'convert', 'issue', 'confirm'].map(a => `procurement.${a}`);
export async function initializeProcurement(db) {
  await initializeLocalCommandReceipt(db,'procurementCommandResults');
  await initializePurchaseOrderRevisions(db);
  await initializeMaterialShortages(db);
  await db.collection('purchaseOrders').createIndex({ tenantId: 1, plantId: 1, requestId: 1 }, { unique: true });
  await db.collection('procurementConversions').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('procurementPromiseKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
  await db.collection('procurementRfqKeys').createIndex({ tenantId: 1, plantId: 1, key: 1 }, { unique: true });
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
    const requestCommand = /^\/requests\/[^/]+\/(approve|convert|rfq|rfq-response)$/.exec(req.path)?.[1];
    const orderCommand = /^\/orders\/[^/]+\/(issue|vendor-confirmation|vendor-promise)$/.exec(req.path)?.[1];
    const amendment = /^\/orders\/[^/]+\/amendments(?:\/[^/]+\/(approve|issue))?$/.exec(req.path);
    const command = amendment ? amendment[1] || 'write' : ['/vendors', '/requests', '/requests/from-shortage'].includes(req.path) || req.path.startsWith('/material-shortages/') || ['rfq', 'rfq-response'].includes(requestCommand) ? 'write' : requestCommand || (['vendor-confirmation', 'vendor-promise'].includes(orderCommand) ? 'confirm' : orderCommand);
    req.procurementAction = req.method === 'GET' ? 'procurement.read' : req.method === 'POST' && command ? `procurement.${command}` : null;
    if (!req.procurementAction) fail(404, 'NOT_FOUND');
    await runtime.foundation.authorize(req.scope, { ...scope, action: req.procurementAction }); next();
  });
  installMaterialShortages(app, runtime, { guard, fields, id });
  const find = async (collection, req, key, session) => {
    const row = await c(collection).findOne({ ...req.filter, _id: id(key) }, { session });
    if (row && collection === 'purchaseOrders') row.lineIds = purchaseOrderLineIds(row);
    if (!row) fail(404, 'NOT_FOUND'); return row;
  };
  const tx = async (req,kind,effect) => {
    const session=runtime.client.startSession();
    try { return await localCommandTransaction(session,async()=>{
      await guard(runtime,req,session,req.procurementAction);
      const local=Object.hasOwn(localCommandPolicies.procurementCommandResults,kind);
      checkLocalCommandKeys(req.body,{allowed:local});
      if(!local && !kind.startsWith('purchaseOrder.amendment.')&&!['purchaseRequest.rfq','purchaseRequest.rfq-response','purchaseOrder.vendor-promise','purchaseRequest.convert'].includes(kind)) await runtime.saasAdmission.unsupported(req.scope,{plantId:req.scope.selectedPlantId,session});
      const perform=async(admit=async()=>{})=>{
        const result=await effect(session,admit);
        if(!result.replay) { const event={...req.filter,kind,subjectId:result._id,version:result.version,userId:req.scope.userId,occurredAt:new Date()};
          await c('procurementAudit').insertOne({_id:randomUUID(),...event},{session});
          await c('procurementOutbox').insertOne({_id:randomUUID(),...event,state:'PENDING'},{session}); }
        return result;
      };
      if(local) return runtime.localCommands.run({scope:req.scope,session,namespace:'procurementCommandResults',action:kind,resourceId:req.params.id?id(req.params.id):null,body:req.body,
        authorizeSources:async previous=>{ if(kind==='vendor.created') { if(previous) await find('vendors',req,previous._id,session); }
          else { const collection=kind.startsWith('purchaseRequest.')?'purchaseRequests':'purchaseOrders'; const current=req.params.id?await find(collection,req,req.params.id,session):previous?await find(collection,req,previous._id,session):null; await find('vendors',req,current?.vendorId??req.body.vendorId,session); } }},perform);
      return perform();
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'}); }
    finally { await session.endSession(); }
  };
  const base = req => ({ _id: randomUUID(), ...req.filter, version: 1, createdAt: new Date(), createdBy: req.scope.userId });
  for (const operation of ['create', 'approve', 'issue']) app.post(`/api/procurement/orders/:id/amendments${operation === 'create' ? '' : `/:amendmentId/${operation}`}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'baseDocumentRevision', 'reason', 'idempotencyKey', ...(operation === 'create' ? ['lines'] : ['amendmentHash'])]);
    const input = req.body, key = input.idempotencyKey;
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !Number.isSafeInteger(input.baseDocumentRevision) || input.baseDocumentRevision < 1) fail(400, 'INVALID_VERSION');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 500 || typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_AMENDMENT');
    const payloadHash = createHash('sha256').update(JSON.stringify([operation, req.params, input])).digest('hex');
    const data = await tx(req, `purchaseOrder.amendment.${operation}`, async session => {
      const prior = await c('purchaseOrderAmendmentKeys').findOne({ ...req.filter, cohort: 'LEGACY', key }, { session });
      if(prior && prior.payloadHash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT');
      const sourceOrder=await find('purchaseOrders',req,req.params.id,session); await find('vendors',req,sourceOrder.vendorId,session);
      await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'purchaseOrderAmendmentKeys',key:key,action:req.procurementAction,payloadHash,replayed:Boolean(prior)});
      if(prior) return {...prior.result,replay:true};
      const row = await find('purchaseOrders', req, req.params.id, session), previous = row.version;
      await find('vendors', req, row.vendorId, session);
      const build = async lines => {
        if (!Array.isArray(lines) || !lines.length || lines.length > 100) fail(400, 'INVALID_LINES');
        if (lines.some(line => line?.retired)) fail(409, 'FINANCIAL_COMMITMENT_READER_REQUIRED');
        const lineIds = lines.map(line => id(line.lineId));
        const content = snapshot({ ...row.snapshot, lines: lines.map(line => ({ description: line.description, uom: line.uom, quantity: line.quantity, unitPrice: line.unitPrice, currency: line.currency })) });
        return { snapshot: content, lineIds };
      };
      const validateCurrent = async () => {
        const receipts = await c('warehouseReceipts').find({ ...req.filter, purchaseOrderId: row._id }, { session }).limit(501).toArray();
        if (receipts.length) fail(409, 'LEGACY_COMMITMENT_READER_REQUIRED');
        for (const collection of ['warehouseReceived', 'warehouseMovements']) if (await c(collection).findOne({ ...req.filter, purchaseOrderId: row._id }, { session })) fail(409, 'LEGACY_COMMITMENT_READER_REQUIRED');
      };
      await applyOrderAmendment(runtime.db, req.filter, 'LEGACY', row, input, req.scope.userId, operation, req.params.amendmentId, build, validateCurrent, session);
      const changed = await c('purchaseOrders').replaceOne({ ...req.filter, _id: row._id, version: previous }, row, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await c('purchaseOrderAmendmentKeys').insertOne({ _id: randomUUID(), ...req.filter, cohort: 'LEGACY', key, payloadHash, result: row }, { session }); return row;
    });
    const { replay, ...record } = data; res.json({ data: record });
  });
  app.get('/api/procurement/orders/:id/document-revisions/:revision', async (req, res) => {
    const session = runtime.client.startSession();
    try { res.json({ data: await session.withTransaction(async () => {
      await guard(runtime, req, session, 'procurement.read'); if (req.method !== 'GET') await runtime.saasAdmission.unsupported(req.scope, { plantId: req.scope.selectedPlantId, session });
      const row = await find('purchaseOrders', req, req.params.id, session);
      return readApprovedOrderRevision(runtime.db, req.filter, 'LEGACY', row, Number(req.params.revision), session);
    }) }); } finally { await session.endSession(); }
  });
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
    checkLocalCommandKeys(req.body); fields(req.body, ['name','commandKey']);
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 200) fail(400, 'INVALID_TEXT');
    const data = await tx(req, 'vendor.created', async (session,admit) => { const row = { ...base(req), name: req.body.name.trim() }; await admit(); await c('vendors').insertOne(row, { session }); await saveCatalogOptionProjection(runtime.db, 'vendors', row, session); return row; });
    res.status(201).json({ data });
  });
  app.post('/api/procurement/requests', async (req, res) => {
    checkLocalCommandKeys(req.body); fields(req.body, ['vendorId', 'lines', 'taxPolicy', 'roundingPolicy','commandKey']);
    const vendorId = id(req.body.vendorId), content = snapshot(req.body);
    const data = await tx(req, 'purchaseRequest.created', async (session,admit) => {
      await find('vendors', req, vendorId, session);
      const row = { ...base(req), vendorId, snapshot: content, status: 'DRAFT', lineIds: content.lines.map(() => randomUUID()) };
      await admit(); await c('purchaseRequests').insertOne(row, { session }); return row;
    }); res.status(201).json({ data });
  });
  for (const operation of ['rfq', 'rfq-response']) app.post(`/api/procurement/requests/:id/${operation}`, async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'reference', ...(operation === 'rfq-response' ? ['rfqId', 'prices'] : [])]);
    const { expectedVersion, idempotencyKey: key, reference } = req.body;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_VERSION');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    if (typeof reference !== 'string' || !reference.trim() || reference.length > 200) fail(400, 'INVALID_REFERENCE');
    const payloadHash = createHash('sha256').update(JSON.stringify([operation, req.params.id, req.body])).digest('hex');
    const data = await tx(req, `purchaseRequest.${operation}`, async session => {
      const row = await find('purchaseRequests', req, req.params.id, session);
      await find('vendors', req, row.vendorId, session);
      const prior = await c('procurementRfqKeys').findOne({ ...req.filter, key }, { session });
      if(prior && prior.payloadHash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT');
      await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'procurementRfqKeys',key:key,action:req.procurementAction,payloadHash,replayed:Boolean(prior)});
      if(prior) return {...prior.data,replay:true};
      if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (row.status !== 'DRAFT') fail(409, 'STATE_CONFLICT');
      row.lineIds ||= row.snapshot.lines.map(() => randomUUID());
      const event = { _id: randomUUID(), requestId: row._id, requestVersion: expectedVersion, vendorId: row.vendorId, reference: reference.trim(), recordedAt: new Date(), recordedBy: req.scope.userId, source: 'OPERATOR_RECORDED' };
      if (operation === 'rfq') {
        Object.assign(event, { kind: 'RFQ_PREPARED', lineIds: [...row.lineIds], snapshot: structuredClone(row.snapshot) });
      } else {
        const rfq = row.rfqHistory?.find(item => item._id === id(req.body.rfqId) && item.kind === 'RFQ_PREPARED');
        if (!rfq || rfq.vendorId !== row.vendorId) fail(409, 'RFQ_CONFLICT');
        if (row.rfqHistory.some(item => item.rfqId === rfq._id)) fail(409, 'RFQ_RESPONSE_RECORDED');
        const prices = req.body.prices;
        if (!Array.isArray(prices) || prices.length !== rfq.lineIds.length || new Set(prices.map(price => price?.lineId)).size !== prices.length) fail(400, 'INVALID_RFQ_PRICES');
        for (const price of prices) { fields(price, ['lineId', 'unitPrice', 'currency']); if (!rfq.lineIds.includes(price.lineId)) fail(400, 'INVALID_RFQ_PRICES'); }
        const selected = snapshot({ ...rfq.snapshot, lines: rfq.snapshot.lines.map((line, index) => { const price = prices.find(item => item.lineId === rfq.lineIds[index]); return { ...line, unitPrice: price.unitPrice, currency: price.currency }; }) });
        Object.assign(event, { kind: 'RFQ_RESPONSE_SELECTED', rfqId: rfq._id, lineIds: [...rfq.lineIds], snapshot: structuredClone(selected) });
        row.snapshot = selected; row.lineIds = [...rfq.lineIds]; row.selectedRfqResponseId = event._id;
      }
      row.rfqHistory = [...(row.rfqHistory || []), event];
      row.version++; row.updatedAt = event.recordedAt;
      const changed = await c('purchaseRequests').replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await c('procurementRfqKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, data: row }, { session });
      return row;
    });
    const { replay, ...record } = data; res.json({ data: record });
  });
  app.post('/api/procurement/orders/:id/vendor-promise', async (req, res) => {
    fields(req.body, ['expectedVersion', 'vendorId', 'promisedAt', 'reference', 'reason', 'idempotencyKey']);
    const { expectedVersion, promisedAt, reference, reason, idempotencyKey: key } = req.body;
    const vendorId = id(req.body.vendorId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_VERSION');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
    if (typeof promisedAt !== 'string' || !Number.isFinite(Date.parse(promisedAt)) || new Date(promisedAt).toISOString() !== promisedAt) fail(400, 'INVALID_PROMISED_DATE');
    for (const value of [reference, reason]) if (typeof value !== 'string' || !value.trim() || value.length > 500) fail(400, 'INVALID_PROMISE_REASON');
    const payloadHash = createHash('sha256').update(JSON.stringify([req.params.id, expectedVersion, vendorId, promisedAt, reference, reason])).digest('hex');
    const data = await tx(req, 'purchaseOrder.vendor-promise', async session => {
      const row = await find('purchaseOrders', req, req.params.id, session);
      await find('vendors', req, row.vendorId, session);
      if (row.vendorId !== vendorId) fail(409, 'VENDOR_CONFLICT');
      const prior = await c('procurementPromiseKeys').findOne({ ...req.filter, key }, { session });
      if (prior) {
        if (prior.payloadHash !== payloadHash) fail(409, 'IDEMPOTENCY_CONFLICT');
        await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'procurementPromiseKeys',key:key,action:req.procurementAction,payloadHash,replayed:true});
        return { ...prior.data, replay: true };
      }
      if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!['ISSUED', 'CONFIRMED'].includes(row.status)) fail(409, 'STATE_CONFLICT');
      await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'procurementPromiseKeys',key:key,action:req.procurementAction,payloadHash,replayed:false});
      const promise = { _id: randomUUID(), vendorId, promisedAt: new Date(promisedAt), reference: reference.trim(), reason: reason.trim(), recordedAt: new Date(), recordedBy: req.scope.userId, source: 'OPERATOR_RECORDED', previousPromiseId: row.promiseHistory?.at(-1)?._id || null };
      row.promiseHistory = [...(row.promiseHistory || []), promise];
      row.promisedAt = promise.promisedAt;
      row.version++; row.updatedAt = promise.recordedAt;
      const changed = await c('purchaseOrders').replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session });
      if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
      await c('procurementPromiseKeys').insertOne({ _id: randomUUID(), ...req.filter, key, payloadHash, data: row }, { session });
      return row;
    });
    const { replay, ...record } = data; res.json({ data: record });
  });
  for (const operation of ['approve', 'convert', 'issue', 'vendor-confirmation']) {
    const requestOperation = ['approve', 'convert'].includes(operation), collection = requestOperation ? 'purchaseRequests' : 'purchaseOrders';
    app.post(`/api/procurement/${requestOperation ? 'requests' : 'orders'}/:id/${operation}`, async (req, res) => {
      checkLocalCommandKeys(req.body,{allowed:operation!=='convert'});
      fields(req.body, ['expectedVersion', ...(operation === 'convert' ? ['idempotencyKey'] : operation === 'vendor-confirmation' ? ['vendorId', 'reference','commandKey'] : ['commandKey'])]);
      const { expectedVersion, idempotencyKey } = req.body;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail(400, 'INVALID_VERSION');
      if (operation === 'convert' && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))) fail(400, 'INVALID_IDEMPOTENCY_KEY');
      if (operation === 'vendor-confirmation' && (typeof req.body.reference !== 'string' || !req.body.reference.trim() || req.body.reference.length > 200)) fail(400, 'INVALID_REFERENCE');
      const payloadHash = createHash('sha256').update(JSON.stringify({ requestId: req.params.id, expectedVersion })).digest('hex');
      const data = await tx(req, `purchase${requestOperation ? 'Request' : 'Order'}.${operation}`, async (session,admit) => {
        const row = await find(collection, req, req.params.id, session);
        if (operation === 'convert') {
          const prior = await c('procurementConversions').findOne({ ...req.filter, key: idempotencyKey }, { session });
          if(prior) { if(prior.payloadHash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT'); const order=await find('purchaseOrders',req,prior.orderId,session); await find('vendors',req,row.vendorId,session); await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'procurementConversions',key:idempotencyKey,action:req.procurementAction,payloadHash,replayed:true}); return {...order,replay:true}; }
        }
        if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT');
        await find('vendors', req, row.vendorId, session);
        const required = { approve: 'DRAFT', convert: 'APPROVED', issue: 'DRAFT', 'vendor-confirmation': 'ISSUED' }[operation];
        if (row.status !== required) fail(409, 'STATE_CONFLICT');
        let order;
        if (operation === 'approve') { row.approval = { snapshot: structuredClone(row.snapshot), approvedBy: req.scope.userId, approvedAt: new Date() }; row.status = 'APPROVED'; }
        if (operation === 'convert') {
          await runtime.saasAdmission.effect({scope:req.scope,session,namespace:'procurementConversions',key:idempotencyKey,action:req.procurementAction,payloadHash,replayed:false});
          order = { ...base(req), requestId: row._id, vendorId: row.vendorId, snapshot: structuredClone(row.approval.snapshot), status: 'DRAFT', ...(row.lineIds ? { lineIds: [...row.lineIds] } : {}), ...(row.selectedRfqResponseId ? { selectedRfqResponseId: row.selectedRfqResponseId } : {}) };
          await c('purchaseOrders').insertOne(order, { session });
          await c('procurementConversions').insertOne({ _id: randomUUID(), ...req.filter, key: idempotencyKey, payloadHash, requestId: row._id, orderId: order._id }, { session });
          row.status = 'CONVERTED'; row.orderId = order._id;
        }
        if (operation === 'issue') { row.status = 'ISSUED'; row.issuedAt = new Date(); row.issuedBy = req.scope.userId; row.documentRevision = 1; await admit(); await archiveInitialOrderRevision(runtime.db, req.filter, 'LEGACY', row, session); }
        if (operation === 'vendor-confirmation') {
          if (id(req.body.vendorId) !== row.vendorId) fail(409, 'VENDOR_CONFLICT');
          row.status = 'CONFIRMED'; row.confirmation = { vendorId: row.vendorId, reference: req.body.reference.trim(), recordedAt: new Date(), recordedBy: req.scope.userId, source: 'OPERATOR_RECORDED' };
        }
        row.version++; row.updatedAt = new Date();
        await admit();
        const result = await c(collection).replaceOne({ ...req.filter, _id: row._id, version: expectedVersion }, row, { session });
        if (!result.matchedCount) fail(409, 'VERSION_CONFLICT'); return order || row;
      });
      const { replay, ...record } = data; res.json({ data: record });
    });
  }
}
