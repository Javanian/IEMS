import { useContext, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IdentityContext, useResource, Resource } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import { ServiceTabs, Boundary } from './CustomerServiceWorkspace.jsx';
import { createSyntheticComplaint } from './automation-demo.mjs';

const PREFIX = '/api/cs/automation';
const when = value => value ? new Date(value).toLocaleString('en-US') : 'Not recorded';
const rows = data => Array.isArray(data) ? data : data?.items || [];
const label = value => value === 'NOT_OBSERVED' ? 'No business result recorded' : String(value || 'Not observed').replaceAll('_', ' ');
const receiptLabel = state => state === 'ACCEPTED_LOCAL' ? 'Accepted by local mail sink' : label(state);
const payloadKey = async payload => 'draft:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))].map(value => value.toString(16).padStart(2, '0')).join('');

export function AutomationCenterWorkspace() {
  const identity = useContext(IdentityContext);
  const canExecute = identity?.permissions?.includes('cs.automation.execute');
  const canApprove = identity?.permissions?.includes('cs.ticket.write');
  const canAdmin = identity?.permissions?.includes('cs.automation.admin');
  const [tab, setTab] = useState('automations');
  const [operation, setOperation] = useState({ busy: false });
  const locked = useRef(false);
  const [demo, setDemo] = useState(() => { try { return JSON.parse(sessionStorage.getItem('iems-automation-demo') || 'null'); } catch { return null; } });
  const [runFilter, setRunFilter] = useState('ALL');
  const status = useResource(`${PREFIX}/status`);
  const breaches = useResource(`${PREFIX}/sla-breaches?limit=100`);
  const digest = useResource(`${PREFIX}/digest?days=7`);
  const drafts = useResource(`${PREFIX}/resolution-drafts`);
  const deliveries = useResource(`${PREFIX}/deliveries`);
  const audit = useResource(`${PREFIX}/audit-logs?limit=50`);
  const sink = useResource(`${PREFIX}/sink-messages`);
  const resolved = useResource('/api/cs/tickets?stage=RESOLVED&limit=100');
  const refresh = () => [status, breaches, digest, drafts, deliveries, audit, sink, resolved].forEach(resource => resource.reload());
  const perform = async (description, action) => {
    if (locked.current) return;
    locked.current = true; setOperation({ busy: true, description });
    try {
      const result = await action();
      const data = result?.data || result;
      setOperation({ busy: false, description, result: data });
      refresh();
    } catch (error) { setOperation({ busy: false, description, error }); refresh(); }
    finally { locked.current = false; }
  };
  const post = (path, body = {}, key) => portfolioRequest(PREFIX + path, { body, ...(key ? { headers: { 'Idempotency-Key': key } } : {}) });
  const engine = (workflow, body = {}) => perform('Run workflow in n8n', () => post(`/run/${workflow}`, body));
  const decide = (draft, action) => perform(`${action} resolution draft`, () => post(`/resolution-drafts/${draft._id}/${action}`, { expectedVersion: draft.version }));
  const draftForm = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const ticket = rows(resolved.data).find(row => (row.ticketId || row._id) === values.ticketId);
    if (!ticket) return;
    const payload = { ticketId: values.ticketId, expectedTicketVersion: ticket.version, channel: values.channel, recipient: values.recipient, proposedResolution: values.proposedResolution };
    perform('Create resolution draft', async () => post('/resolution-draft', payload, await payloadKey(payload)));
  };
  const demoDigest = () => perform('Run demo digest in n8n', async () => {
    const saved = sessionStorage.getItem('iems-automation-digest-occurrence');
    const periodKey = saved || `demo:${crypto.randomUUID()}`;
    sessionStorage.setItem('iems-automation-digest-occurrence', periodKey);
    const response = await post('/run/wf-cs-weekly-digest', { mode: 'DEMO', periodKey });
    const state = response.data?.result?.result?.deliveryState;
    if (state && state !== 'UNKNOWN' && state !== 'SENDING') sessionStorage.removeItem('iems-automation-digest-occurrence');
    return response;
  });
  const createDemo = () => perform('Create synthetic complaint', async () => {
    const result = await createSyntheticComplaint(portfolioRequest);
    sessionStorage.setItem('iems-automation-demo', JSON.stringify(result)); setDemo(result);
    return { ticketId: result.ticketId, message: 'Synthetic complaint saved. Wait for its configured Demo SLA, then run the SLA scan.' };
  });

  return <>
    <h1>Customer service</h1><Boundary /><ServiceTabs current="automation" />
    <section className="pf-panel" aria-labelledby="automation-heading">
      <div className="pf-toolbar"><div><h2 id="automation-heading">Automation Center</h2><p>Review approvals, run local workflows and inspect delivery evidence.</p></div><button type="button" disabled={operation.busy} onClick={refresh}>Refresh records</button></div>
      <nav className="pf-actions" aria-label="Automation sections">{[['automations', 'Automations'], ['approvals', 'Approvals'], ['runs', 'Runs and recovery'], ['demo', 'Demo']].map(([id, title]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}</nav>
    </section>
    {operation.busy && <section className="pf-panel" role="status" aria-live="polite"><p>{operation.description}… Waiting for the authoritative response.</p></section>}
    {operation.error && <section className="pf-error" role="alert"><p>{errorMessage(operation.error, true)}</p><p>Code: {operation.error.code || 'CONNECTION_UNCONFIRMED'}. Refresh records before another submission.</p><button type="button" onClick={refresh}>Check current records</button></section>}
    {operation.result && <section className="pf-panel" role="status" aria-live="polite"><p><strong>{operation.description}: response received.</strong></p>{operation.result.message && <p>{operation.result.message}</p>}<details><summary>Result details</summary>{(operation.result.n8nExecutionId || operation.result.executionId) && <p>n8n execution {operation.result.n8nExecutionId || operation.result.executionId}</p>}<pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(operation.result, null, 2)}</pre></details></section>}
    {tab === 'automations' && <>
      <section className="pf-panel" aria-labelledby="runtime-heading"><h2 id="runtime-heading">Local runtime</h2><Resource resource={status}>{({ data }) => <>
        <dl className="pf-dl"><dt>n8n engine</dt><dd>{label(data.engine?.n8n?.status)}</dd><dt>SMTP sink</dt><dd>{label(data.engine?.smtpSink?.status)}</dd><dt>Open tickets</dt><dd>{data.metrics?.openTicketsCount ?? 'No data'}</dd><dt>Pending approvals</dt><dd>{data.metrics?.pendingDraftsCount ?? 'No data'}</dd><dt>{data.policy?.label || 'Unassigned SLA'}</dt><dd>{data.policy?.minutes !== undefined ? `${Math.round(data.policy.minutes * 60)} seconds` : 'No policy observed'}</dd></dl>
        <p className="pf-muted">Engine health and recorded business results are separate observations. This list is not a complete engine execution inventory; no-effect scheduled runs may have no business result. Local SMTP acceptance does not prove customer delivery. WhatsApp remains preview only.</p>
        <ul className="pf-list">{data.workflows?.map(workflow => <li key={workflow.id}><strong>{workflow.name}</strong><span className="pf-status">{label(workflow.state)}</span><span>Last recorded IEMS observation: {when(workflow.lastRun?.completedAt || workflow.lastRun?.occurredAt)}</span>{workflow.lastRun?.executionId && <details><summary>Execution reference</summary><span>n8n execution {workflow.lastRun.executionId}</span></details>}</li>)}</ul>
        <button type="button" disabled={!canAdmin || operation.busy} onClick={() => perform(data.paused ? 'Resume automation' : 'Pause automation', () => post('/pause', { paused: !data.paused }))}>{data.paused ? 'Resume automation' : 'Pause automation'}</button>
      </>}</Resource></section>
      <section className="pf-panel" aria-labelledby="sla-heading"><div className="pf-toolbar"><h2 id="sla-heading">Unassigned tickets due for escalation</h2><button type="button" disabled={!canExecute || operation.busy} onClick={() => engine('wf-sla-escalation')}>Run SLA scan in n8n</button></div><Resource resource={breaches}>{({ data }) => <><p>{data.totalBreached ?? rows(data).length} due tickets. Preview shows at most 100 records; actions recheck current eligibility.</p>{!rows(data).length ? <p>No eligible overdue tickets in this plant. This is not an SLA compliance score.</p> : <ul className="pf-list">{rows(data).map(ticket => <li key={ticket.ticketId}><Link to={`/portfolio/service/tickets/${ticket.ticketId}`}>Ticket {ticket.ticketNumber}</Link><span>{label(ticket.stage)} · version {ticket.expectedVersion} · age {ticket.ageMinutes} minutes</span></li>)}</ul>}</>}</Resource></section>
      <section className="pf-panel" aria-labelledby="digest-heading"><div className="pf-toolbar"><h2 id="digest-heading">Weekly CS digest</h2><button type="button" disabled={!canExecute || operation.busy} onClick={demoDigest}>Run demo digest in n8n</button></div><Resource resource={digest}>{({ data }) => <><p>Scheduled Monday at 08:00, Asia/Bangkok. Each demo run creates a separate manual occurrence.</p><dl className="pf-dl"><dt>Open backlog</dt><dd>{data.summary?.currentlyOpenCount ?? data.summary?.openTicketsCount ?? 'No data'}</dd><dt>Created in period</dt><dd>{data.summary?.ticketsCreated ?? 'No data'}</dd><dt>Resolved in period</dt><dd>{data.summary?.ticketsResolved ?? 'No data'}</dd><dt>Unassigned overdue</dt><dd>{data.summary?.overdueCount ?? 'No data'}</dd></dl><details><summary>Digest preview and metric definitions</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.markdown || JSON.stringify(data.summary, null, 2)}</pre></details></>}</Resource></section>
    </>}
    {tab === 'approvals' && <>
      <form className="pf-panel pf-form" onSubmit={draftForm}><h2>Create resolution update</h2><p>Resolve the source ticket through its normal handling flow first. A notification never changes the ticket stage.</p><Resource resource={resolved}>{({ data }) => <label className="pf-field">Resolved source ticket<select name="ticketId" required defaultValue=""><option value="" disabled>Select a resolved ticket</option>{rows(data).map(ticket => <option key={ticket.ticketId || ticket._id} value={ticket.ticketId || ticket._id}>Ticket {ticket.ticketNumber} · version {ticket.version}</option>)}</select></label>}</Resource><label className="pf-field">Channel<select name="channel"><option value="EMAIL">Local email</option><option value="SIMULATED">WhatsApp preview</option></select></label><label className="pf-field">Synthetic recipient<input type="email" name="recipient" defaultValue="customer@iems.local" required pattern="[^@\s]+@iems\.local" /></label><label className="pf-field">Message for approval<textarea name="proposedResolution" required minLength={5} maxLength={2000} rows={4} defaultValue="Your synthetic complaint has been resolved. This local demonstration update is ready for review." /></label><button className="pf-primary" disabled={!canExecute || operation.busy}>Create draft for review</button></form>
      <section className="pf-panel" aria-labelledby="approvals-heading"><h2 id="approvals-heading">Resolution approvals</h2><Resource resource={drafts}>{({ data }) => !rows(data).length ? <p>No resolution drafts. Create an update for a resolved ticket.</p> : <ul className="pf-list">{rows(data).map(draft => <li key={draft._id} data-draft-id={draft._id}><Link to={`/portfolio/service/tickets/${draft.ticketId}`}>Source ticket {draft.ticketNumber || draft.ticketId.slice(0, 8)}</Link><strong>{label(draft.status)}</strong><span>Recipient: {draft.recipient} · {draft.channel}</span><span>Approval authorizes the next n8n dispatch or recovery cycle. Version {draft.version} · source version {draft.expectedTicketVersion} · expires {when(draft.expiresAt)}</span><p>{draft.proposedResolution}</p>{draft.decisionReason && <p>Decision: {draft.decisionReason}</p>}{draft.deliveryState && <p>{receiptLabel(draft.deliveryState)}</p>}<div className="pf-actions">{draft.status === 'PENDING_APPROVAL' && <><button type="button" disabled={!canApprove || operation.busy} onClick={() => decide(draft, 'approve')}>Approve draft</button><button type="button" disabled={!canApprove || operation.busy} onClick={() => decide(draft, 'reject')}>Reject draft</button></>}{['APPROVED', 'FAILED'].includes(draft.status) && <button type="button" disabled={!canExecute || operation.busy} onClick={() => engine('wf-approved-resolution', { draftId: draft._id })}>Dispatch approved update in n8n</button>}{['PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(draft.status) && <button type="button" disabled={!canApprove || operation.busy} onClick={() => decide(draft, 'cancel')}>Cancel draft</button>}</div><details><summary>Immutable approval reference</summary><p className="pf-id">Draft {draft._id} · content {draft.approvalHash || draft.contentHash}</p></details></li>)}</ul>}</Resource></section>
    </>}
    {tab === 'runs' && <>
      <section className="pf-panel" aria-labelledby="recovery-heading"><div className="pf-toolbar"><h2 id="recovery-heading">Delivery recovery</h2><button type="button" disabled={!canExecute || operation.busy} onClick={() => perform('Reconcile delivery evidence', () => post('/reconcile'))}>Reconcile delivery evidence</button></div><p>Expired sending leases become UNKNOWN. Reconciliation verifies durable receipts. An uncertain submission is never automatically resent.</p><Resource resource={deliveries}>{({ data }) => !rows(data).length ? <p>No automation delivery intents yet.</p> : <ul className="pf-list">{rows(data).map(delivery => <li key={delivery.deliveryId} data-delivery-id={delivery.deliveryId}><strong>{delivery.subject}</strong><span className="pf-status">{receiptLabel(delivery.deliveryState)}</span><span>To: {delivery.recipient} · attempt {delivery.attempt}</span>{delivery.lastError && <p>Error: {delivery.lastError}</p>}{delivery.deliveryState === 'UNKNOWN' && <form className="pf-form" onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); perform('Record manual delivery decision', () => post(`/deliveries/${delivery.deliveryId}/review`, values)); }}><label className="pf-field">Evidence for manual decision<input name="evidence" minLength={10} maxLength={1000} required /></label><label className="pf-field">Decision<select name="decision"><option value="ABANDON">Abandon without resend</option><option value="CONFIRMED_NOT_SUBMITTED">Confirmed not submitted; allow controlled retry</option></select></label><button disabled={!canAdmin || operation.busy}>Record delivery decision</button></form>}<details><summary>Delivery details</summary><p className="pf-id">Intent {delivery.deliveryId} · receipt {delivery.sinkMessageId || 'None verified'} · lease {when(delivery.leaseUntil)}</p><p>{delivery.body}</p></details></li>)}</ul>}</Resource></section>
      <section className="pf-panel" aria-labelledby="sink-heading"><h2 id="sink-heading">Verified local mail receipts</h2><Resource resource={sink}>{({ data }) => !rows(data).length ? <p>No verified local receipts in this plant.</p> : <ul className="pf-list">{rows(data).map(email => <li key={email.id || email.deliveryId}><strong>{email.subject}</strong><span>Accepted by local mail sink</span><span>To: {Array.isArray(email.to) ? email.to.join(', ') : email.to || email.recipient} · {when(email.receivedAt)}</span><details><summary>Receipt evidence</summary><p className="pf-id">Receipt {email.id || email.sinkMessageId}</p><p>{email.body}</p></details></li>)}</ul>}</Resource></section>
      <section className="pf-panel" aria-labelledby="runs-heading"><div className="pf-toolbar"><h2 id="runs-heading">Audit history</h2><label className="pf-field">Workflow filter<select value={runFilter} onChange={event => setRunFilter(event.target.value)}><option value="ALL">All workflows</option><option value="wf-sla-escalation">SLA escalation</option><option value="wf-cs-weekly-digest">Weekly digest</option><option value="wf-approved-resolution">Resolution update</option></select></label></div><Resource resource={audit}>{({ data }) => <ul className="pf-list">{rows(data).filter(log => runFilter === 'ALL' || log.workflowId === runFilter).map(log => <li key={log._id}><strong>{label(log.action)}</strong><span>{label(log.status)} · {when(log.occurredAt)}</span><details><summary>Run reference</summary><p className="pf-id">Workflow {log.workflowId} · n8n execution {log.executionId || 'Not recorded'} · audit {log._id}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(log.result, null, 2)}</pre></details></li>)}</ul>}</Resource></section>
    </>}
    {tab === 'demo' && <section className="pf-panel" aria-labelledby="demo-heading"><h2 id="demo-heading">Synthetic complaint demo</h2><p>This creates a synthetic CRM account, contact and preview binding, then confirms a complaint through the supported inbound simulator. No real customer or WhatsApp account is used.</p><div className="pf-actions"><button type="button" disabled={!canExecute || operation.busy} onClick={createDemo}>Create synthetic complaint</button><button type="button" disabled={!canExecute || operation.busy} onClick={() => engine('wf-sla-escalation')}>Run SLA scan in n8n</button></div>{demo && <><p>Complaint ticket {demo.ticketNumber} is saved.</p><div className="pf-actions"><Link to={`/portfolio/service/tickets/${demo.ticketId}`}>Open demo ticket</Link><Link to={`/portfolio/service/bindings/${demo.bindingId}`}>Open demo conversation simulator</Link><button type="button" disabled={operation.busy} onClick={() => perform('Revoke demo contact', async () => { const result = await portfolioRequest(`/api/cs/bindings/${demo.bindingId}/revoke`, { body: { expectedVersion: demo.bindingVersion, reason: 'Synthetic automation demo contact reset' }, headers: { 'Idempotency-Key': `demo-revoke-${demo.occurrence}` } }); sessionStorage.removeItem('iems-automation-demo'); setDemo(null); return result; })}>Revoke demo contact</button></div></>}<ol><li>Create a complaint and wait for the displayed Demo SLA.</li><li>Run the SLA scan. Open the ticket and inspect its escalation history.</li><li>Handle the ticket using the normal stage controls, then resolve it.</li><li>Open Approvals, create an update, review and approve its immutable content.</li><li>Dispatch through n8n. Inspect the local receipt under Runs and recovery.</li><li>Use the lab stop/start controls to demonstrate engine outage and recovery. Ticket handling stays available.</li></ol><p className="pf-muted">Revoking the demo contact disables that binding. It preserves business records and audit evidence. A new demo creates a separate synthetic occurrence.</p></section>}
  </>;
}
