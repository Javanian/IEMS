import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';

const label = text => text?.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const when = value => value ? new Date(value).toLocaleString('en-US') : 'Not recorded';
const reasons = { SOURCE_UNAVAILABLE: 'The source could not be reached. Retry the lookup or contact the source owner.',
  SOURCE_STALE: 'The source is outside the freshness window. Refresh its upstream data before trying again.',
  LIVE_SOURCE_REQUIRED: 'This source is a fixture snapshot. A current owned order source is required.',
  INCOMPLETE_METRICS: 'The service scan is incomplete. Counts and response times are withheld.',
  NO_AUTHORIZED_EVIDENCE: 'No current authorized document excerpts matched this query. Check the document access and index status.' };

export function AssistantWorkspace() {
  const identity = useContext(IdentityContext);
  const [kind, setKind] = useState('ORDER');
  const [state, setState] = useState({});
  const active = useRef(null), generation = useRef(0);
  useEffect(() => {
    generation.current++;
    active.current?.abort(); setState({});
    return () => { generation.current++; active.current?.abort(); };
  }, [identity, kind]);
  async function ask(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body = kind === 'INTENT' ? { message: values.message.trim() } : kind === 'ORDER' ? { kind, bindingId: values.bindingId.trim(), orderNumber: values.orderNumber.trim() } :
      kind === 'DOCUMENTS' ? { kind, query: values.query.trim(), limit: 5 } :
        { kind, from: `${values.from}T00:00:00.000Z`, to: `${values.to}T00:00:00.000Z` };
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const current = ++generation.current;
    setState({ loading: true });
    try {
      const result = await portfolioRequest(kind === 'INTENT' ? '/api/ai/cs-intent' : '/api/ai/assistant', { body, signal: controller.signal });
      if (current === generation.current) setState({ data: result.data });
    } catch (error) {
      if (error.name !== 'AbortError' && current === generation.current) setState({ error });
    }
  }
  const result = state.data, evidence = result?.evidence;
  return <>
    <header className="pf-page-header"><h1>Assistant workspace</h1><p>Check current orders and service metrics, or read versioned document excerpts in your selected plant.</p></header>
    <section className="pf-panel">
      <WorkspaceField as="select" label="Evidence source" value={kind} onChange={event => setKind(event.target.value)}>
        <option value="ORDER">Live order status</option><option value="SERVICE_METRICS">Service metrics</option><option value="DOCUMENTS">Document retrieval</option><option value="INTENT">Customer request triage</option>
      </WorkspaceField>
      <form key={`${identity?.user?.id || ''}:${identity?.selectedPlantId || ''}:${kind}`} className="pf-form" onSubmit={ask} aria-label="Look up scoped evidence">
        {kind === 'ORDER' && <>
          <WorkspaceField name="bindingId" label="Customer contact binding ID" required hint="Use an active binding from Customer Service. The order must belong to that customer." />
          <WorkspaceField name="orderNumber" label="Order or repair number" required pattern="[A-Z0-9][A-Z0-9-]{0,39}" placeholder="SO-… or RP-…" />
        </>}
        {kind === 'SERVICE_METRICS' && <>
          <WorkspaceField name="from" type="date" label="From date (UTC, inclusive)" required />
          <WorkspaceField name="to" type="date" label="To date (UTC, exclusive)" required hint="Choose a completed period of up to 31 days." />
        </>}
        {kind === 'DOCUMENTS' && <WorkspaceField name="query" as="textarea" label="Search documents" required maxLength={2000} hint="Excerpts are document evidence. Use live order status to check current progress." />}
        {kind === 'INTENT' && <WorkspaceField name="message" as="textarea" label="Current customer request" required maxLength={2000} hint="Submit only this request. No conversation history is stored. Model summaries require human review and never send automatically." />}
        <button className="pf-primary" disabled={state.loading}>{state.loading ? 'Checking sources…' : 'Check evidence'}</button>
      </form>
    </section>
    {state.loading && <WorkspaceState kind="loading" title="Checking authorized sources" />}
    {state.error && <WorkspaceState kind="error" title="Evidence unavailable"><p>{errorMessage(state.error)}</p></WorkspaceState>}
    {!state.loading && !state.error && !result && <WorkspaceState title="Choose a source"><p>Results include source revisions or observation times. No conversation history is saved.</p></WorkspaceState>}
    {result?.state === 'ABSTAIN' && <WorkspaceState title="No supported answer"><p>{reasons[result.reason] || 'The source could not support this lookup.'}</p></WorkspaceState>}
    {result?.schema === 'CS_INTENT_V1' && <section className="pf-panel" aria-live="polite"><h2>{label(result.intent)} · {label(result.state)}</h2>
      <p>{result.summary}</p><p>{result.generated ? 'Model proposal: verify the cited excerpts before responding.' : 'Deterministic triage; no model result is claimed.'}</p>
      <ul className="pf-list">{result.citations.map((c, i) => <li key={`${c.resourceId}:${i}`}><h3>{c.title}</h3><p>{c.text}</p><p>Document revision {c.sourceRevision} · ACL {c.aclRevision} · index {c.indexRevision}</p></li>)}</ul>
    </section>}
    {evidence && <section className="pf-panel" aria-live="polite" aria-labelledby="assistant-result-heading">
      <h2 id="assistant-result-heading">{result.state === 'DOCUMENT_EVIDENCE' ? 'Document excerpts' : 'Current source snapshot'}</h2>
      <p>Checked {when(result.asOf)}. Refresh this lookup before making a decision.</p>
      {result.kind === 'ORDER' && <>
        <h3>{evidence.orderNumber}</h3>
        <dl className="pf-dl"><dt>Stage</dt><dd>{label(evidence.publicStage)}</dd><dt>Source revision</dt><dd>{evidence.sourceVersion}</dd><dt>Observed at</dt><dd>{when(evidence.asOf)}</dd>
          {evidence.progress && <><dt>Released work orders</dt><dd>{evidence.progress.released} of {evidence.progress.total}</dd></>}</dl>
        <h3>Milestones</h3><ul className="pf-list">{evidence.milestones?.map(item => <li key={item.code}><strong>{item.label}</strong><span>{label(item.state)} · {when(item.at)}</span></li>)}</ul>
        <h3>Confirmed dates</h3>{Object.keys(evidence.confirmedDates || {}).length ? <dl className="pf-dl">{Object.entries(evidence.confirmedDates).map(([name, date]) => <div key={name}><dt>{label(name)}</dt><dd>{when(date)}</dd></div>)}</dl> : <p>No confirmed dates recorded.</p>}
      </>}
      {result.kind === 'SERVICE_METRICS' && <>
        <p>Observed {when(evidence.asOf)}. Coverage: {label(evidence.coverage)}.</p>
        <dl className="pf-dl"><dt>Open tickets</dt><dd>{evidence.open}</dd><dt>Unassigned</dt><dd>{evidence.unassigned}</dd><dt>Overdue</dt><dd>{evidence.overdue.count} (SLA {evidence.overdue.slaMinutes} minutes)</dd></dl>
        {['firstHumanResponse', 'resolution'].map(name => <div key={name}><h3>{name === 'resolution' ? 'Resolution' : 'First human response'}</h3>{evidence[name] ? <p>Median {evidence[name].p50Minutes} minutes; p90 {evidence[name].p90Minutes} minutes across {evidence[name].n} tickets.</p> : <p>No supported timing summary for this period.</p>}</div>)}
        <details><summary>Definitions and data origin</summary><dl className="pf-dl">{Object.entries(evidence.provenance || {}).map(([name, count]) => <div key={name}><dt>{label(name.replace(/([A-Z])/g, '_$1'))}</dt><dd>{count}</dd></div>)}</dl>{Object.entries(evidence.definitions || {}).map(([name, text]) => <p key={name}>{text}</p>)}</details>
      </>}
      {result.kind === 'DOCUMENTS' && <>
        <p>These excerpts are untrusted document content. They do not establish current order status. Coverage: bounded top matches.</p>
        <ul className="pf-list">{evidence.citations.map((citation, index) => <li key={`${citation.resourceId}:${citation.chunkIndex}:${index}`}>
          <h3>{citation.title}</h3><p>{citation.text}</p><p>Document revision {citation.sourceRevision}, ACL revision {citation.aclRevision}, index revision {citation.indexRevision}.</p>
          <details><summary>Source reference</summary><p className="pf-id">{citation.resourceId}</p><p>Embedding model: {citation.model}</p></details>
        </li>)}</ul>
      </>}
    </section>}
  </>;
}
