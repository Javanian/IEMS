import { useContext, useEffect, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceTable from '../../components/tables/WorkspaceTable.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';

const columns = [
  { key: 'kind', label: 'Job' },
  { key: 'status', label: 'Status' },
  { key: 'attempt', label: 'Attempts', numeric: true, render: row => `${row.attempt} / ${row.maxAttempts}` },
  { key: 'revision', label: 'Revision', numeric: true },
  { key: 'updatedAt', label: 'Updated (UTC)', render: row => <time dateTime={row.updatedAt}>{row.updatedAt}</time> },
  { key: 'nextState', label: 'Next action' },
  { key: 'errorCode', label: 'Diagnostic', render: row => row.errorCode || 'None' },
];
export default function PlatformWorkspace() {
  const identity = useContext(IdentityContext), canRead = identity?.permissions?.includes('platform.read');
  const scopeKey = `${identity?.scope?.tenantId}:${identity?.scope?.plantId}:${identity?.user?.id}`;
  const [cursor, setCursor] = useState(null), [attempt, setAttempt] = useState(0), [result, setResult] = useState({ loading: true });
  useEffect(() => { setCursor(null); }, [scopeKey]);
  useEffect(() => {
    if (!canRead) return undefined;
    const controller = new AbortController();
    setResult({ loading: true, scopeKey });
    portfolioRequest(`/api/platform/jobs${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult({ ...value, scopeKey }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ error, scopeKey }); });
    return () => controller.abort();
  }, [canRead, scopeKey, cursor, attempt]);
  const current = result.scopeKey === scopeKey ? result : { loading: true };
  if (!canRead) return <WorkspaceState title="Job access required"><p>Your current plant role does not allow viewing platform jobs.</p></WorkspaceState>;
  return <section className="pf-panel" aria-labelledby="platform-jobs-title"><h1 id="platform-jobs-title">Background jobs</h1>
    <p>Your jobs in the selected plant. Review failed job diagnostics before requesting another operation.</p>
    <p>Completed work remains in the durable job history. A queued job is waiting for a worker.</p>
    <div className="pf-actions"><button type="button" disabled={current.loading} onClick={() => setAttempt(n => n + 1)}>Refresh jobs</button>
      {cursor && <button type="button" disabled={current.loading} onClick={() => setCursor(null)}>First page</button>}
      {current.nextCursor && <button type="button" onClick={() => setCursor(current.nextCursor)}>Next page</button>}</div>
    {current.observedAt && <p>Read from the server at <time dateTime={current.observedAt}>{current.observedAt}</time> (UTC).</p>}
    <WorkspaceTable caption="Durable background jobs" columns={columns} rows={current.data || []} rowKey={row => row.id} loading={current.loading} error={current.error ? errorMessage(current.error) : undefined} retry={() => setAttempt(n => n + 1)} empty="You have no background jobs on this page." />
  </section>;
}
