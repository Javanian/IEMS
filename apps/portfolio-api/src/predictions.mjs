import { createModelWorkflow, modelRoles } from '../../../packages/scoped-ai/models.mjs';
import { fail, uuid } from '../../../packages/scoped-ai/indexing.mjs';
export { modelRoles };
export const createPredictionRuntime = (runtime, options = {}) => createModelWorkflow({ ...runtime, ...options });
export function installPredictions(app, models) {
  const input = (req, read = false) => {
    if (!req.scope || !uuid(req.scope.selectedPlantId)) fail('SCOPE_DENIED', 403);
    if (Object.keys(req.query ?? {}).length) fail('AI_INVALID_MODEL_REQUEST');
    const body = read ? {} : req.body;
    if (!body || Object.getPrototypeOf(body) !== Object.prototype || ['plantId', 'tenantId', 'userId'].some(k => Object.hasOwn(body, k))) fail('AI_INVALID_MODEL_REQUEST');
    return { ...body, plantId: req.scope.selectedPlantId };
  };
  app.get('/api/ai/models', async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await models.status(req.scope, input(req, true)) }));
  app.post('/api/ai/models/select', async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await models.select(req.scope, input(req)) }));
  app.post('/api/ai/predictions', async (req, res) => res.set('Cache-Control', 'no-store').json({ data: await models.predict(req.scope, input(req)) }));
}
