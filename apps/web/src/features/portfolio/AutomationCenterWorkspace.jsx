import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useResource, Resource } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import { ServiceTabs, Boundary } from './CustomerServiceWorkspace.jsx';

function generateKey() {
  return 'ui-' + Math.random().toString(36).substring(2, 12) + '-' + Date.now();
}

export function AutomationCenterWorkspace() {
  const [activeTab, setActiveTab] = useState('overview');
  const [triggerState, setTriggerState] = useState({ busy: false, result: null, error: null });
  const [emails, setEmails] = useState({ list: [], loading: false, error: null });

  const statusResource = useResource('/api/cs/automation/status');
  const breachesResource = useResource('/api/cs/automation/sla-breaches?thresholdMinutes=15');
  const auditLogsResource = useResource('/api/cs/automation/audit-logs?limit=25');
  const digestResource = useResource('/api/cs/automation/digest?days=7');

  const refreshAll = () => {
    statusResource.reload();
    breachesResource.reload();
    auditLogsResource.reload();
    digestResource.reload();
    fetchEmails();
  };

  const fetchEmails = async () => {
    setEmails(prev => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch('http://127.0.0.1:1080/api/emails', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setEmails({ list: json.data || [], loading: false, error: null });
      } else {
        setEmails({ list: [], loading: false, error: 'Sink HTTP returned ' + res.status });
      }
    } catch {
      setEmails({ list: [], loading: false, error: 'Local SMTP sink not reachable on port 1080' });
    }
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  const runSlaEscalation = async ticket => {
    setTriggerState({ busy: true, result: null, error: null });
    try {
      // 1. Re-check first (anti-stale verification)
      const recheck = await portfolioRequest('/api/cs/automation/recheck', {
        body: { ticketId: ticket.ticketId, expectedVersion: ticket.expectedVersion, action: 'ESCALATE' }
      });

      if (!recheck.data?.eligible) {
        setTriggerState({
          busy: false,
          result: {
            title: 'SLA Escalation Skipped (Anti-stale Guard)',
            details: `Ticket #${ticket.ticketNumber} is not eligible: ${recheck.data?.reason || 'Status mismatch'}. No modification made.`
          },
          error: null
        });
        refreshAll();
        return;
      }

      // 2. Escalate with Idempotency Key
      const key = generateKey();
      const esc = await portfolioRequest('/api/cs/automation/escalate', {
        body: {
          ticketId: ticket.ticketId,
          expectedVersion: ticket.expectedVersion,
          reason: `Automatic SLA breach escalation (Age: ${ticket.ageMinutes} mins, Threshold: ${ticket.thresholdMinutes} mins)`
        },
        headers: { 'idempotency-key': key }
      });

      // 3. Send notification to Local SMTP Sink
      try {
        await fetch('http://127.0.0.1:1080/api/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'sla-monitor@iems.local',
            to: 'cs-lead@iems.local',
            subject: `[SLA Breached] Ticket #${ticket.ticketNumber} escalated to ${esc.data.newStage}`,
            body: `Ticket #${ticket.ticketNumber} exceeded SLA target (${ticket.ageMinutes}m). Transitioned from ${esc.data.previousStage} to ${esc.data.newStage}. Version: ${esc.data.version}. Audit ID: ${esc.data.auditId}`
          })
        });
      } catch {
        // Local sink notification non-blocking
      }

      setTriggerState({
        busy: false,
        result: {
          title: 'SLA Escalation Completed',
          details: `Ticket #${ticket.ticketNumber} escalated from ${esc.data.previousStage} to ${esc.data.newStage}. Audit ID: ${esc.data.auditId}. Idempotency Key: ${key}`
        },
        error: null
      });
      refreshAll();
    } catch (err) {
      setTriggerState({ busy: false, result: null, error: errorMessage(err, true) });
    }
  };

  const runReconcile = async () => {
    setTriggerState({ busy: true, result: null, error: null });
    try {
      const res = await portfolioRequest('/api/cs/automation/reconcile', { body: {} });
      setTriggerState({
        busy: false,
        result: {
          title: 'Reconciliation Execution Report',
          details: res.data?.message || 'Reconciliation completed successfully'
        },
        error: null
      });
      refreshAll();
    } catch (err) {
      setTriggerState({ busy: false, result: null, error: errorMessage(err, true) });
    }
  };

  const runSendDigest = async () => {
    setTriggerState({ busy: true, result: null, error: null });
    try {
      const digRes = await portfolioRequest('/api/cs/automation/digest?days=7');
      const digestData = digRes.data;
      const key = generateKey();

      const recordRes = await portfolioRequest('/api/cs/automation/digest/record', {
        body: {
          summary: digestData.summary,
          recipientEmail: 'reports@iems.local',
          subject: 'Weekly CS Operations Digest'
        },
        headers: { 'idempotency-key': key }
      });

      setTriggerState({
        busy: false,
        result: {
          title: 'Weekly Digest Generated & Recorded',
          details: `Digest ID: ${recordRes.data._id}. Compliance: ${digestData.summary.slaComplianceRatePercent}%. Status: ${recordRes.data.receiptStatus}`
        },
        error: null
      });
      refreshAll();
    } catch (err) {
      setTriggerState({ busy: false, result: null, error: errorMessage(err, true) });
    }
  };

  return (
    <>
      <h1>Customer service</h1>
      <Boundary />
      <ServiceTabs current="automation" />

      {/* Control Banner & Trigger Feedback */}
      {triggerState.busy && (
        <section className="pf-panel" role="status" aria-live="polite">
          <p>Processing automation workflow...</p>
        </section>
      )}

      {triggerState.error && (
        <section className="pf-panel pf-error" role="alert">
          <p><strong>Automation Error:</strong> {triggerState.error}</p>
          <button type="button" onClick={() => setTriggerState(prev => ({ ...prev, error: null }))}>Dismiss</button>
        </section>
      )}

      {triggerState.result && (
        <section className="pf-panel" role="region" aria-label="Workflow result">
          <div className="pf-toolbar">
            <h3>{triggerState.result.title}</h3>
            <button type="button" onClick={() => setTriggerState(prev => ({ ...prev, result: null }))}>Clear</button>
          </div>
          <p>{triggerState.result.details}</p>
        </section>
      )}

      {/* Engine & Runtime Status */}
      <section className="pf-panel" aria-labelledby="automation-runtime-heading">
        <div className="pf-toolbar">
          <h2 id="automation-runtime-heading">Automation Runtime & Infrastructure</h2>
          <div className="pf-actions">
            <button type="button" onClick={refreshAll}>Refresh all status</button>
            <button type="button" onClick={runReconcile}>Run durable reconciliation</button>
          </div>
        </div>

        <Resource resource={statusResource}>
          {({ data: status }) => (
            <>
              <dl className="pf-metrics">
                <div className="pf-metric">
                  <dt>n8n Orchestration Layer</dt>
                  <dd>
                    <strong className={status.engine?.n8n?.status === 'HEALTHY' ? 'pf-status-ok' : ''}>
                      {status.engine?.n8n?.status}
                    </strong>
                    <span>{status.engine?.n8n?.mode} · Loopback only (127.0.0.1)</span>
                  </dd>
                </div>
                <div className="pf-metric">
                  <dt>Local SMTP Sink</dt>
                  <dd>
                    <strong>{status.engine?.smtpSink?.status}</strong>
                    <span>Port {status.engine?.smtpSink?.port} · Captured: {emails.list.length}</span>
                  </dd>
                </div>
                <div className="pf-metric">
                  <dt>Open Tickets</dt>
                  <dd>
                    <strong>{status.metrics?.openTicketsCount ?? 0}</strong>
                    <span>Domain Mongo</span>
                  </dd>
                </div>
                <div className="pf-metric">
                  <dt>Automations Executed</dt>
                  <dd>
                    <strong>{status.metrics?.totalAutomationsExecuted ?? 0}</strong>
                    <span>{status.metrics?.successfulAutomations ?? 0} succeeded</span>
                  </dd>
                </div>
              </dl>

              <h3 style={{ marginTop: '1.5rem' }}>Configured Workflows</h3>
              <ul className="pf-list pf-rows">
                {status.workflows?.map(wf => (
                  <li key={wf.id}>
                    <strong>{wf.name}</strong>
                    <span className="pf-status">{wf.state}</span>
                    <span>Type: {wf.type} · Guard: {wf.guard || wf.deliveryGuarantee || wf.destination}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Resource>
      </section>

      {/* SLA Breaches & Live Escalation Trigger */}
      <section className="pf-panel" aria-labelledby="sla-monitor-heading">
        <div className="pf-toolbar">
          <h2 id="sla-monitor-heading">Live SLA Breach Monitor (Anti-Stale Guarded)</h2>
          <button type="button" onClick={() => breachesResource.reload()}>Scan SLA breaches</button>
        </div>

        <Resource resource={breachesResource}>
          {({ data: breaches }) => (
            <>
              {!breaches.items?.length ? (
                <p>No SLA breaches detected. All active tickets are within compliance targets.</p>
              ) : (
                <ul className="pf-list pf-rows">
                  {breaches.items.map(t => (
                    <li key={t.ticketId}>
                      <Link to={`/portfolio/service/tickets/${t.ticketId}`}>
                        Ticket #{t.ticketNumber}
                      </Link>
                      <span className="pf-status pf-status-hold">{t.stage}</span>
                      <span>
                        Age: <strong>{t.ageMinutes} min</strong> (Threshold: {t.thresholdMinutes} min) · v{t.expectedVersion}
                      </span>
                      <button
                        type="button"
                        disabled={triggerState.busy}
                        onClick={() => runSlaEscalation(t)}
                      >
                        Re-check & Escalate
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Resource>
      </section>

      {/* Weekly Digest Generator & Viewer */}
      <section className="pf-panel" aria-labelledby="digest-heading">
        <div className="pf-toolbar">
          <h2 id="digest-heading">Weekly CS Operations Digest</h2>
          <button type="button" disabled={triggerState.busy} onClick={runSendDigest}>
            Generate & Record Weekly Digest
          </button>
        </div>

        <Resource resource={digestResource}>
          {({ data: digest }) => (
            <div>
              <p>
                Period: Last {digest.summary?.periodDays} days · SLA Compliance:{' '}
                <strong>{digest.summary?.slaComplianceRatePercent}%</strong> · Tickets Created:{' '}
                {digest.summary?.ticketsCreated} · Resolved: {digest.summary?.ticketsResolved} · Escalated:{' '}
                {digest.summary?.escalationsTriggered}
              </p>
              <div
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  padding: '12px',
                  background: '#f8fafc',
                  marginTop: '12px'
                }}
                dangerouslySetInnerHTML={{ __html: digest.html }}
              />
            </div>
          )}
        </Resource>
      </section>

      {/* Local SMTP Sink Captured Receipts */}
      <section className="pf-panel" aria-labelledby="sink-heading">
        <div className="pf-toolbar">
          <h2 id="sink-heading">Local SMTP Sink Captured Messages (Zero-Internet Guarantee)</h2>
          <div className="pf-actions">
            <button type="button" onClick={fetchEmails}>Refresh sink</button>
            <button
              type="button"
              onClick={async () => {
                await fetch('http://127.0.0.1:1080/api/emails', { method: 'DELETE' });
                fetchEmails();
              }}
            >
              Clear sink
            </button>
          </div>
        </div>

        {emails.loading ? (
          <p>Loading captured sink emails...</p>
        ) : emails.error ? (
          <p className="pf-muted">{emails.error}</p>
        ) : !emails.list.length ? (
          <p>No captured emails in local mail sink. Messages dispatched by workflows will appear here.</p>
        ) : (
          <ul className="pf-list pf-rows">
            {emails.list.map(em => (
              <li key={em.id}>
                <strong>{em.subject}</strong>
                <span className="pf-status">{em.receiptStatus}</span>
                <span>To: {em.to} · Received: {new Date(em.receivedAt).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Live Audit Log Feed */}
      <section className="pf-panel" aria-labelledby="audit-logs-heading">
        <div className="pf-toolbar">
          <h2 id="audit-logs-heading">Automation Audit & Reconciliation Trail</h2>
          <button type="button" onClick={() => auditLogsResource.reload()}>Refresh audit trail</button>
        </div>

        <Resource resource={auditLogsResource}>
          {({ data: logs }) => (
            <>
              {!logs?.length ? (
                <p>No automation audit events recorded yet.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid #cbd5e1' }}>
                      <th style={{ padding: '8px' }}>Time</th>
                      <th style={{ padding: '8px' }}>Workflow</th>
                      <th style={{ padding: '8px' }}>Action</th>
                      <th style={{ padding: '8px' }}>Target</th>
                      <th style={{ padding: '8px' }}>Status</th>
                      <th style={{ padding: '8px' }}>Idempotency Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log._id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '8px', fontSize: '12px' }}>
                          {new Date(log.occurredAt).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '8px' }}>{log.workflowId}</td>
                        <td style={{ padding: '8px' }}>
                          <code>{log.action}</code>
                        </td>
                        <td style={{ padding: '8px' }}>
                          {log.targetEntity?.type} #{log.targetEntity?.id?.slice(0, 8)}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span className={`pf-status ${log.status === 'SUCCESS' ? 'pf-status-ok' : ''}`}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px', fontSize: '11px', fontFamily: 'monospace' }}>
                          {log.idempotencyKey?.slice(0, 24)}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Resource>
      </section>
    </>
  );
}
