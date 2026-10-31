import { validatePurchasedDocumentSource } from './purchased-financial.mjs';
import { validateCatalogQuote } from './quote-catalog.mjs';
import { randomUUID } from 'node:crypto';
import { fixtureVat } from './fixture-tax.mjs';
import { isDeepStrictEqual } from 'node:util';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { createSnapshot, createIssuer } from '../../../packages/document-rendering/src/index.mjs';
import { readApprovedOrderRevision } from '../../../packages/contracts/src/domains/commercial/purchase-orders.mjs';
import { readCatalogOrderRevision, readCatalogRequestApproval } from './catalog-procurement.mjs';

export const documentActions = ['document.read', 'document.issue'];
export const documentRoles = { documentReader: ['document.read'], documentIssuer: documentActions };
const kinds = { quote: ['quotes', 'quote.read'], purchaseRequest: ['purchaseRequests', 'procurement.read'], purchaseOrder: ['purchaseOrders', 'procurement.read'], catalogPurchaseRequest: ['catalogPurchaseRequests', 'catalog.read'], catalogPurchaseOrder: ['catalogPurchaseOrders', 'catalog.read'], invoice: ['fulfillmentInvoices', 'fulfillment.read'], repairInvoice: ['repairInvoices', 'repair.read'], shipment: ['fulfillmentShipments', 'fulfillment.read'] };
const options = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' };
function validReceipt(intent,record) {
  return intent.rendererId===record._id && isDeepStrictEqual(intent.record,{...record,_id:intent._id})
    && isDeepStrictEqual(intent.snapshot,record.snapshot)
    && record.kind===(intent.kind==='repairInvoice'?'invoice':intent.kind)
    && record.sourceId===intent.sourceId && record.sourceVersion===intent.sourceVersion
    && ['tenantId','plantId','legalEntityId'].every(k=>intent[k]===record[k]);
}
export async function initializeDocuments(runtime) {
  await runtime.db.collection('documentIntents').createIndex({ tenantId: 1, legalEntityId: 1, plantId: 1, kind: 1, sourceId: 1, sourceVersion: 1 }, { unique: true });
  const issuer=await createIssuer({client:runtime.client,db:runtime.db});
  return {...issuer,async validateTenantHistory({tenantId,session}) {
    const intents=await runtime.db.collection('documentIntents').find({tenantId},{session}).limit(1001).toArray();
    const issues=await runtime.db.collection('documentIssues').find({tenantId},{session}).limit(1001).toArray();
    const artifacts=await runtime.db.collection('documentArtifacts').find({tenantId},{session}).limit(1001).toArray();
    const ids=new Set();
    if(intents.length>1000 || intents.length!==issues.length || intents.length!==artifacts.length) throw new Error('DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');
    for(const intent of intents) {
      if(intent.state!=='READY' || ids.has(intent.rendererId)) throw new Error('DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');
      ids.add(intent.rendererId);
      const stored=await issuer.read(intent,intent.rendererId,{session});
      if(!stored || !validReceipt(intent,stored.record)) throw new Error('DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');
    }
    if(issues.some(row=>!ids.has(row._id)) || artifacts.some(row=>!ids.has(row._id))) throw new Error('DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');
  }};
}
export function installDocuments(app, runtime, { fail, guard, id }) {
  const c = name => runtime.db.collection(name);
  const tx = async (req, actions, effect, {issuing=false}={}) => {
    const session = runtime.client.startSession();
    try { return await session.withTransaction(async () => {
      for (const action of actions) await guard(runtime, req, session, action); if (req.method !== 'GET' && !issuing) await runtime.saasAdmission.unsupported(req.scope, { plantId: req.scope.selectedPlantId, session });
      const plant = await c('plants').findOne({ _id: req.filter.plantId, tenantId: req.filter.tenantId }, { session });
      const scope = { ...req.filter, legalEntityId: plant.legalEntityId };
      return effect(session, scope);
    }, options); } finally { await session.endSession(); }
  };
  const input = (kind, sourceId, sourceVersion) => {
    if (!Object.hasOwn(kinds, kind)) fail(400, 'INVALID_KIND');
    id(sourceId);
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) fail(400, 'INVALID_VERSION');
    if (!['quote', 'purchaseOrder', 'catalogPurchaseOrder', 'catalogPurchaseRequest'].includes(kind) && sourceVersion !== 1) fail(400, 'INVALID_VERSION');
    return { kind, sourceId, sourceVersion };
  };
  const snapshot = async (req, scope, key, session, {readOnly=false}={}) => {
    const row = readOnly ? await c(kinds[key.kind][0]).findOne({...req.filter,_id:key.sourceId},{session}) : await c(kinds[key.kind][0]).findOneAndUpdate({ ...req.filter, _id: key.sourceId }, { $inc: { documentFence: 1 } }, { session, returnDocument: 'after' });
    if (!row) fail(404, 'NOT_FOUND');
    await validatePurchasedDocumentSource(runtime.db, req.filter, key.kind, row, session);
    let source;
    if (key.kind === 'quote') {
      await validateCatalogQuote(runtime.db, req.filter, row, session);
      const approval = row.approvals?.find(a => a.revision === key.sourceVersion);
      if (!approval) fail(409, 'SOURCE_NOT_ISSUED');
      source = { snapshot: approval.snapshot };
    } else if (key.kind === 'catalogPurchaseRequest') {
      source = { snapshot: await readCatalogRequestApproval(runtime.db, req.filter, row._id, key.sourceVersion, session) };
    } else if (key.kind === 'catalogPurchaseOrder') {
      source = { snapshot: (await readCatalogOrderRevision(runtime.db, req.filter, row._id, key.sourceVersion, session)).snapshot };
    } else if (key.kind === 'purchaseRequest') {
      if (!['APPROVED', 'CONVERTED'].includes(row.status) || !row.approval?.snapshot) fail(409, 'SOURCE_NOT_ISSUED');
      source = { snapshot: row.approval.snapshot };
    } else if (key.kind === 'purchaseOrder') {
      if (!['ISSUED', 'CONFIRMED'].includes(row.status)) fail(409, 'SOURCE_NOT_ISSUED');
      source = { snapshot: (await readApprovedOrderRevision(runtime.db, req.filter, 'LEGACY', row, key.sourceVersion, session)).snapshot };
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
  const checkedReceipt=(intent,record)=>{if(!validReceipt(intent,record)) fail(500,'ARTIFACT_INTEGRITY'); return {...record,_id:intent._id};};
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
    const preparation=await tx(req,actions,async(session,scope)=>({scope,content:await snapshot(req,scope,key,session,{readOnly:true})}),{issuing:true});
    const prepared=await runtime.documents.prepare(preparation.scope,preparation.content);
    let data;
    for(let attempt=0;;attempt++) {
      try {
        data=await tx(req,actions,async(session,scope)=>{
          const content=await snapshot(req,scope,key,session);
          if(content.contentHash!==preparation.content.contentHash || !isDeepStrictEqual(scope,preparation.scope)) fail(409,'ISSUE_CONFLICT');
          const current=await c('documentIntents').findOne({...scope,...key},{session});
          if(current && current.state!=='READY') fail(409,'DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');
          if(current && current.snapshot.contentHash!==content.contentHash) fail(409,'ISSUE_CONFLICT');
          const record=await mapped(()=>runtime.documents.issueInTransaction({scope,snapshot:content,prepared,session,admission:async descriptor=>{
            if(descriptor.replayed!==Boolean(current)) fail(409,'DOCUMENT_HISTORY_RECONCILIATION_REQUIRED');
            await runtime.saasAdmission.effect({...descriptor,scope:req.scope,session,action:'document.issue'});
          }}));
          if(current) return checkedReceipt(current,record);
          const intentId=randomUUID(),now=new Date(),published={...record,_id:intentId};
          await c('documentIntents').insertOne({_id:intentId,...scope,...key,state:'READY',snapshot:content,preparedBy:req.scope.userId,membershipId:req.scope.membershipId,membershipVersion:req.scope.membershipVersion,preparedAt:now,finalizedAt:now,rendererId:record._id,record:published},{session});
          const event={...scope,kind:'document.issued',subjectId:intentId,sourceId:key.sourceId,sourceVersion:key.sourceVersion,contentHash:record.contentHash,pdfHash:record.pdfHash,userId:req.scope.userId,occurredAt:now};
          await c('documentAudit').insertOne({_id:intentId,...event},{session});
          await c('documentOutbox').insertOne({_id:intentId,...event,state:'PENDING'},{session});
          return published;
        },{issuing:true}); break;
      } catch(error) { if(error.code===11000 && attempt<5) continue; throw error; }
    }
    res.json({ data });
  });
  const read = async req => tx(req, ['document.read'], async (session, scope) => {
    const intent = await c('documentIntents').findOne({ ...scope, _id: id(req.params.id), state: 'READY' }, { session });
    if (!intent) fail(404, 'NOT_FOUND');
    await guard(runtime, req, session, kinds[intent.kind][1]); if (req.method !== 'GET') await runtime.saasAdmission.unsupported(req.scope, { plantId: req.scope.selectedPlantId, session });
    const stored = await runtime.documents.read(scope, intent.rendererId,{session});
    if (!stored) fail(500, 'ARTIFACT_INTEGRITY');
    return { record: checkedReceipt(intent, stored.record), pdf: stored.pdf };
  });
  app.get('/api/documents/issues/:id', async (req, res) => res.json({ data: (await read(req)).record }));
  app.get('/api/documents/issues/:id/pdf', async (req, res) => {
    const stored = await read(req);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${stored.record.kind}-${stored.record._id}.pdf"`, 'Cache-Control': 'private, no-store' }).send(stored.pdf);
  });
}
