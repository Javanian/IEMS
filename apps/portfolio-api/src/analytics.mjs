import { randomUUID } from 'node:crypto';
import { boundedTransaction, CommandError } from '../../../packages/tenant-foundation/commands.mjs';
import { resolveScopeAliases } from '../../../packages/tenant-foundation/index.mjs';

export const analyticsActions = ['analytics.read', 'analytics.export', 'analytics.history.read'];
export const analyticsRoles = { analyticsReader: ['analytics.read'], analyticsAnalyst: analyticsActions };
export function installAnalytics(app, runtime, { reportingBaseUrl, fetchImpl = fetch }) {
  const base = new URL(reportingBaseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || (base.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname))) throw new Error('REPORTING_PRIVATE_TLS_OR_LOOPBACK_REQUIRED');
  const target = req => {
    const selected = { tenantId: req.scope.tenantId, plantId: req.scope.selectedPlantId };
    const aliases = resolveScopeAliases({ body: selected, query: req.query, headers: Object.fromEntries(['x-tenant-id', 'x-plant-id'].filter(k => req.headers[k] !== undefined).map(k => [k, req.headers[k]])) });
    if (aliases.tenantId !== selected.tenantId || aliases.plantId !== selected.plantId) throw new CommandError('SCOPE_DENIED', 403);
    return aliases;
  };
  const authorize = (req, action) => runtime.foundation.authorize(req.scope, { ...target(req), action });
  app.get('/api/analytics/authority', async (req, res) => {
    const grant = await authorize(req, 'analytics.read');
    const actions = ['analytics.read'], datasets = ['order-balances'];
    for (const action of ['analytics.export', 'analytics.history.read']) {
      try { await authorize(req, action); actions.push(action); }
      catch (e) { if (e.code !== 'SCOPE_DENIED') throw e; }
    }
    if (actions.includes('analytics.history.read')) datasets.push('resource-history');
    res.set('Cache-Control', 'no-store').json({ data: { tenantId: grant.tenantId, plantId: grant.plantId, legalEntityId: grant.legalEntityId, userId: grant.userId, actions, datasets } });
  });
  const proxy = (pathFor, action = 'analytics.read') => async (req, res) => {
    await authorize(req, action);
    const url = new URL(pathFor(req), base);
    const allowed = new Set(['runId', 'after', 'limit']);
    for (const [key, value] of Object.entries(req.query)) {
      if (['tenantId', 'plantId'].includes(key)) continue;
      if (!allowed.has(key) || typeof value !== 'string' || value.length > 200) throw new CommandError('INVALID_REPORT_QUERY', 400);
      url.searchParams.set(key, value);
    }
    let response, body;
    try {
      response = await fetchImpl(url, { headers: { cookie: req.headers.cookie || '' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('REPORT_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
      body = Buffer.concat(chunks);
    } catch { throw new CommandError('REPORTING_UNAVAILABLE', 503, 'Reporting is unavailable; retry the read after the data operator restores service.'); }
    await authorize(req, action);
    if (!response.ok) throw new CommandError(response.status === 403 ? 'SCOPE_DENIED' : response.status === 404 ? 'DATASET_UNAVAILABLE' : 'DATASET_NOT_TRUSTED', response.status === 403 ? 403 : response.status === 404 ? 404 : 409);
    if (action === 'analytics.export') {
      await boundedTransaction(runtime.client, async session => {
        const grant = await runtime.foundation.authorizeInTransaction(req.scope, { ...target(req), action }, { session });
        await runtime.db.collection('audit').insertOne({ _id: randomUUID(), ...grant, kind: action, dataset: req.params.dataset, runId: req.query.runId, lineageHash: response.headers.get('x-lineage-hash'), occurredAt: new Date() }, { session });
      });
    }
    res.set('Cache-Control', 'no-store');
    res.type(action === 'analytics.export' ? 'text/csv' : 'application/json');
    if (action === 'analytics.export') res.set('Content-Disposition', 'attachment; filename="iems-report.csv"');
    res.send(body);
  };
  const dataset = req => {
    if (!['order-balances', 'resource-history'].includes(req.params.dataset)) throw new CommandError('RESOURCE_NOT_FOUND', 404);
    return `/v1/datasets/${req.params.dataset}`;
  };
  app.get('/api/analytics/catalog', proxy(() => '/v1/catalog'));
  app.get('/api/analytics/orders', proxy(() => '/v1/orders'));
  app.get('/api/analytics/datasets/:dataset', proxy(dataset));
  app.get('/api/analytics/datasets/:dataset/export', proxy(req => `${dataset(req)}/export`, 'analytics.export'));
}
