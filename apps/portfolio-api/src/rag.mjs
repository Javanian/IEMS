import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { createAiDocuments, documentRoles } from '../../../packages/scoped-ai/documents.mjs';
import { createScopedIndex, aiRoles, fail, uuid } from '../../../packages/scoped-ai/indexing.mjs';
import { createApprovedOrderDocumentSource } from '../../../packages/scoped-ai/issued-documents.mjs';

export const ragRoles = { ...aiRoles, ...documentRoles };
export function createRagRuntime(runtime, { embeddings, vectors } = {}) {
  const documents = createAiDocuments({ ...runtime, issuedSource: createApprovedOrderDocumentSource(runtime) });
  const index = embeddings && vectors ? createScopedIndex({ ...runtime, source: documents.source, embeddings, vectors }) : null;
  return Object.freeze({ documents, index,
    async initialize() { await documents.initialize(); if (index) await index.initialize(); },
    async retrieve(scope, input) { if (!index) fail('AI_PROVIDER_UNAVAILABLE', 503); return index.retrieve(scope, input); },
  });
}

export function installRag(app, rag) {
  const input = (req, allowed) => {
    if (!req.body || Object.getPrototypeOf(req.body) !== Object.prototype || Object.keys(req.body).some(k => !allowed.includes(k))) fail('AI_UNKNOWN_FIELD');
    return req.body;
  };
  const plant = req => {
    const selected = { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId };
    const checked = resolveScopeAliases({ body: selected, query: req.query, headers: req.headers });
    if (checked.tenantId !== selected.tenantId || checked.plantId !== selected.plantId) fail('SCOPE_DENIED', 403);
    return checked.plantId;
  };
  const resource = req => { if (!uuid(req.params.id)) fail('AI_INVALID_RESOURCE'); return req.params.id; };
  const respond = (res, data) => res.set('Cache-Control', 'no-store').json({ data });
  app.get('/api/ai/documents', async (req, res) => respond(res, await rag.documents.list(req.scope, plant(req))));
  app.get('/api/ai/documents/:id/index', async (req, res) => {
    const plantId = plant(req), resourceId = resource(req);
    if (!rag.index) fail('AI_PROVIDER_UNAVAILABLE', 503);
    respond(res, await rag.index.status(req.scope, { plantId, resourceId }));
  });
  app.post('/api/ai/documents/:id/index/revoke', async (req, res) => {
    const body = input(req, ['key', 'expectedRevision']);
    const plantId = plant(req), resourceId = resource(req);
    if (!rag.index) fail('AI_PROVIDER_UNAVAILABLE', 503);
    respond(res, await rag.index.revoke(req.scope, { ...body, plantId, resourceId }));
  });
  const publish = async (req, res) => {
    const body = input(req, ['key', 'expectedRevision', 'title', 'text', 'allowedUserIds', 'sourceReference']);
    respond(res, await rag.documents.publish(req.scope, { ...body, plantId: plant(req), resourceId: resource(req) }));
  };
  app.put('/api/ai/documents/:id', publish);
  app.post('/api/ai/documents/:id/publish', publish);
  app.post('/api/ai/documents/:id/revoke', async (req, res) => {
    const body = input(req, ['key', 'expectedRevision']);
    respond(res, await rag.documents.revoke(req.scope, { ...body, plantId: plant(req), resourceId: resource(req) }));
  });
  app.post('/api/ai/documents/:id/rebuild', async (req, res) => {
    const body = input(req, ['key', 'expectedRevision']);
    const plantId = plant(req), resourceId = resource(req);
    if (!rag.index) fail('AI_PROVIDER_UNAVAILABLE', 503);
    respond(res, await rag.index.rebuild(req.scope, { ...body, plantId, resourceId }));
  });
  app.post('/api/ai/retrieve', async (req, res) => {
    const body = input(req, ['query', 'limit']);
    respond(res, await rag.retrieve(req.scope, { ...body, plantId: plant(req) }));
  });
}
