import { useContext, useEffect, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceTable from '../../components/tables/WorkspaceTable.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';

const balanceColumns = [
  { key: 'order_id', label: 'Order' }, { key: 'currency', label: 'Currency' }, { key: 'uom', label: 'Unit' },
  ...[['ordered_amount', 'Order amount'], ['deposited_amount', 'Deposits'], ['unpaid_amount', 'Unpaid amount'], ['ordered_quantity', 'Ordered quantity'], ['fulfilled_quantity', 'Fulfilled quantity'], ['remaining_quantity', 'Remaining quantity']].map(([key, label]) => ({ key, label, numeric: true })),
];
const historyColumns = [['event_id', 'Event'], ['aggregate_id', 'Resource'], ['aggregate_version', 'Version'], ['resource_type', 'Type'], ['occurred_at', 'Occurred (UTC)'], ['available_at', 'Available (UTC)'], ['valid_to', 'Valid until (UTC)'], ['deleted', 'Deleted']].map(([key, label]) => ({ key, label, render: row => typeof row[key] === 'boolean' ? String(row[key]) : row[key] ?? 'Open' }));
const failure = error => error.code === 'DATASET_NOT_TRUSTED' ? 'The dataset is stale, corrupt, or failed a quality gate. Ask the data operator to refresh or reconcile it.' : error.code === 'REPORTING_UNAVAILABLE' ? 'Reporting is unavailable. Retry after the data operator restores the service.' : errorMessage(error);

export default function AnalyticsWorkspace() {
  const identity = useContext(IdentityContext), canRead = identity?.permissions?.includes('analytics.read');
  const canExport = identity?.permissions?.includes('analytics.export');
  const scopeKey = `${identity?.scope?.tenantId}:${identity?.scope?.plantId}:${identity?.user?.id}`;
  const [catalog, setCatalog] = useState({}), [dataset, setDataset] = useState('order-balances');
  const [cursor, setCursor] = useState(null), [attempt, setAttempt] = useState(0), [result, setResult] = useState({});
  const [download, setDownload] = useState({});
  useEffect(() => { setCursor(null); setDataset('order-balances'); setDownload({}); }, [scopeKey]);
  useEffect(() => {
    if (!canRead) return undefined;
    const controller = new AbortController(); setCatalog({ loading: true, scopeKey });
    portfolioRequest('/api/analytics/catalog', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setCatalog({ ...value, scopeKey }); })
      .catch(error => { if (!controller.signal.aborted) setCatalog({ error, scopeKey }); });
    return () => controller.abort();
  }, [canRead, scopeKey, attempt]);
  useEffect(() => {
    if (!canRead) return undefined;
    const controller = new AbortController(); setResult({ loading: true, scopeKey, dataset });
    const path = dataset === 'relational-orders' ? '/api/analytics/orders' : `/api/analytics/datasets/${encodeURIComponent(dataset)}`;
    portfolioRequest(`${path}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult({ ...value, scopeKey, dataset }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ error, scopeKey, dataset }); });
    return () => controller.abort();
  }, [canRead, scopeKey, dataset, cursor, attempt]);
  const current = result.scopeKey === scopeKey && result.dataset === dataset ? result : { loading: true };
  const visibleCatalog = catalog.scopeKey === scopeKey ? catalog : {};
  const exportHref = current.runId && canExport ? `${(import.meta.env?.VITE_PORTFOLIO_API_BASE || '/portfolio-api').replace(/\/$/, '')}/api/analytics/datasets/${encodeURIComponent(dataset)}/export?runId=${encodeURIComponent(current.runId)}` : null;
  if (!canRead) return <WorkspaceState title="Analytics access required"><p>Your selected plant role does not allow reading analytics.</p></WorkspaceState>;
  return <section className="pf-panel" aria-labelledby="analytics-title">
    <h1 id="analytics-title">Analytics and reporting</h1>
    <p>Read reconciled order balances and governed history for your current plant. Amounts and quantities retain their source precision and units.</p>
    <p>These reports are projections. Use the operational workspace for business changes.</p>
    <WorkspaceField as="select" label="Dataset" name="analytics-dataset" value={dataset} onChange={event => { setDataset(event.target.value); setCursor(null); setDownload({}); }}>
      <option value="order-balances">Order balances · governed snapshot</option>
      <option value="relational-orders">Order balances · relational projection</option>
      {(visibleCatalog.data || []).filter(row => row.id !== 'order-balances').map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
    </WorkspaceField>
    {visibleCatalog.error && <WorkspaceState kind="error" title="Catalog unavailable"><p>{failure(visibleCatalog.error)}</p></WorkspaceState>}
    <div className="pf-actions"><button type="button" disabled={current.loading} onClick={() => setAttempt(n => n + 1)}>Refresh report</button>
      {cursor && <button type="button" disabled={current.loading} onClick={() => setCursor(null)}>First page</button>}
      {current.nextCursor && <button type="button" disabled={current.loading} onClick={() => setCursor(current.nextCursor)}>Next page</button>}
      {exportHref && !current.error && !current.loading && <a href={exportHref}>Export this snapshot as CSV</a>}
    </div>
    {current.runId && <p>Snapshot: {current.runId}. Published (UTC): <time dateTime={current.publishedAt}>{current.publishedAt}</time>. Lineage: <code>{current.lineageHash}</code>.</p>}
    {dataset === 'relational-orders' && !current.loading && !current.error && <p>Latest source availability (UTC): {current.sourceAvailableAt || 'No events projected yet'}. Projection freshness must be checked before operational decisions.</p>}
    {current.observedAt && <p>Read at (UTC): <time dateTime={current.observedAt}>{current.observedAt}</time>.</p>}
    <WorkspaceTable caption={dataset === 'resource-history' ? 'Governed resource history' : 'Order balances'} columns={dataset === 'resource-history' ? historyColumns : balanceColumns} rows={current.data || []} rowKey={row => row.event_id || row.order_id} loading={current.loading} error={current.error && failure(current.error)} retry={() => setAttempt(n => n + 1)} empty="No reporting records are available for your selected plant." />
    {exportHref && <p>CSV exports require current permission, retain lineage, and are limited to 10,000 rows. The server reports unavailable or denied exports directly.</p>}
  </section>;
}
