import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';
import { createScopedAssistants } from '../../../packages/scoped-ai/assistants.mjs';
import { fail } from '../../../packages/scoped-ai/indexing.mjs';

export const createAssistantRuntime = (runtime, options = {}) => createScopedAssistants({
  foundation: runtime.foundation, customerService: runtime.customerService, rag: runtime.rag, ...options,
});

export function installAssistants(app, assistants) {
  app.post('/api/ai/assistant', async (req, res) => {
    if (!req.body || Object.getPrototypeOf(req.body) !== Object.prototype || Object.hasOwn(req.body, 'plantId') || Object.hasOwn(req.body, 'tenantId')) fail('AI_INVALID_ASSISTANT_REQUEST');
    const selected = { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId };
    const aliases = resolveScopeAliases({ body: selected, query: req.query, headers: req.headers });
    if (aliases.tenantId !== selected.tenantId || aliases.plantId !== selected.plantId) fail('SCOPE_DENIED', 403);
    const data = await assistants.ask(req.scope, { ...req.body, plantId: selected.plantId });
    res.set('Cache-Control', 'no-store').json({ data });
  });
}
