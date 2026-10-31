import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { installVendorDrafts } from '../../apps/portfolio-api/src/vendor-drafts.mjs';

test('vendor HTTP rejects machine approval and scope substitution, preserves authenticated scope', async () => {
  const routes = new Map(), calls = [];
  const app = { get(path, handler) { routes.set(`GET ${path}`, handler); }, post(path, handler) { routes.set(`POST ${path}`, handler); } };
  const service = Object.fromEntries(['read', 'create', 'preview', 'approve', 'revoke', 'intent', 'dispatch', 'reconcile']
    .map(action => [action, async (scope, input) => { calls.push({ action, scope, input }); return { state: 'TEST' }; }]));
  installVendorDrafts(app, service);
  const scope = { selectedPlantId: randomUUID() }, draftId = randomUUID();
  const req = { scope, params: { draftId }, body: { key: 'approve', expectedRevision: 2 }, query: {} };
  const res = { set() { return this; }, json() {} }, handler = routes.get('POST /api/ai/vendor-drafts/:draftId/approve');
  await assert.rejects(handler({ ...req, automationService: true }, res), { code: 'HUMAN_APPROVAL_REQUIRED' });
  await assert.rejects(handler({ ...req, body: { ...req.body, plantId: randomUUID() } }, res), { code: 'AI_INVALID_VENDOR_DRAFT' });
  assert.equal(calls.length, 0);
  await handler(req, res); assert.equal(calls[0].scope, scope); assert.equal(calls[0].input.plantId, scope.selectedPlantId);
});
