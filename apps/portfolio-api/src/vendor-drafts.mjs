import { createVendorDrafts, vendorDraftRoles } from '../../../packages/scoped-ai/vendor-drafts.mjs';
import { createVendorDraftAuthority } from '../../../packages/scoped-ai/vendor-source.mjs';
import { fail, uuid } from '../../../packages/scoped-ai/indexing.mjs';

export { vendorDraftRoles };
export const createVendorDraftRuntime = (runtime, options = {}) => createVendorDrafts({ ...runtime,
  authority: createVendorDraftAuthority(runtime), ...options });

export function installVendorDrafts(app, service) {
  const input = (req, read = false) => {
    if (!req.scope || !uuid(req.scope.selectedPlantId)) fail('SCOPE_DENIED', 403);
    if (Object.keys(req.query ?? {}).length) fail('AI_INVALID_VENDOR_DRAFT');
    const body = read ? {} : req.body;
    if (!body || Object.getPrototypeOf(body) !== Object.prototype ||
        ['plantId', 'tenantId', 'draftId', 'userId'].some(k => Object.hasOwn(body, k))) fail('AI_INVALID_VENDOR_DRAFT');
    return { ...body, plantId: req.scope.selectedPlantId, draftId: req.params.draftId };
  };
  app.get('/api/ai/vendor-drafts/:draftId', async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await service.read(req.scope, input(req, true)) }));
  for (const action of ['create', 'preview', 'approve', 'revoke', 'intent', 'dispatch', 'reconcile']) {
    app.post(`/api/ai/vendor-drafts/:draftId/${action}`, async (req, res) => {
      if (action === 'approve' && req.automationService) fail('HUMAN_APPROVAL_REQUIRED', 403);
      res.set('Cache-Control', 'no-store').json({ data: await service[action](req.scope, input(req)) });
    });
  }
}
