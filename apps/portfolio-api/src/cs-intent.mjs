import { createCustomerIntent } from '../../../packages/scoped-ai/intents.mjs';
import { fail, uuid } from '../../../packages/scoped-ai/indexing.mjs';

export const createIntentRuntime = (runtime, options = {}) => createCustomerIntent({ foundation: runtime.foundation, rag: runtime.rag, ...options });
export function installCustomerIntent(app, intent) {
  app.post('/api/ai/cs-intent', async (req, res) => {
    if (!req.scope || !uuid(req.scope.selectedPlantId)) fail('SCOPE_DENIED', 403);
    if (Object.keys(req.query ?? {}).length || !req.body || Object.getPrototypeOf(req.body) !== Object.prototype ||
        Object.keys(req.body).some(k => k !== 'message')) fail('AI_INVALID_INTENT_REQUEST');
    res.set('Cache-Control', 'no-store').json({ data: await intent.classify(req.scope,
      { message: req.body.message, plantId: req.scope.selectedPlantId }) });
  });
}
