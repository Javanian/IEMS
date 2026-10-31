import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage, useLocalEffects } from './client.mjs';
import { LocalEffectStatus } from './CustomerServiceWorkspace.jsx';
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
    <DocumentControls />
  </>;
}

function DocumentControls() {
  const identity = useContext(IdentityContext), generation = useRef(0), lock = useRef(false);
  const effects=useLocalEffects('document-index',identity);
  const [state, setState] = useState({}), [selected, setSelected] = useState(null), [pending, setPending] = useState(null), [mode, setMode] = useState('MANUAL');
  const storageKey = identity?.scope?.tenantId && identity?.scope?.plantId && identity?.user?.id
    ? `iems.ai-document:${identity.scope.tenantId}:${identity.scope.plantId}:${identity.user.id}` : null;
  useEffect(() => {
    generation.current++; lock.current = false; setState({}); setSelected(null); setPending(null);
    try { if (storageKey) setPending(JSON.parse(sessionStorage.getItem(storageKey) || 'null')); }
    catch { setState({ error: new Error('Document command recovery is unavailable. Contact the index operator before submitting changes.') }); }
    return () => { generation.current++; };
  }, [identity, storageKey]);
  async function read(resourceId) {
    if (lock.current) return;
    lock.current = true; const current = generation.current; setState(s => ({ ...s, busy: true, error: null }));
    try {
      const result = await portfolioRequest(resourceId ? `/api/ai/documents/${resourceId}/index` : '/api/ai/documents');
      if (current === generation.current) setState(s => ({ ...s, busy: false, ...(resourceId ? { index: result.data } : { list: result.data }) }));
    } catch (error) { if (current === generation.current) setState(s => ({ ...s, busy: false, error, index: null })); }
    finally { if (current === generation.current) lock.current = false; }
  }
  async function mutate(command) {
    if (lock.current) return;
    const current = generation.current; lock.current = true; setState(s => ({ ...s, busy: true, error: null, index: null }));
    try {
      if (!storageKey) throw new Error('Authenticated recovery identity is unavailable');
      sessionStorage.setItem(storageKey, JSON.stringify(command)); setPending(command);
      const result=await portfolioRequest(command.path, { body: command.body });
      if (current !== generation.current) return;
      if(result.data?.accepted===true){if(!result.data.commandId)throw new Error('The accepted intent reference is missing. Reconcile the same command.');effects.remember(result.data.commandId,command.path.endsWith('/rebuild')?['EMBED','UPSERT']:['DELETE'],'Document index');}
      sessionStorage.removeItem(storageKey); setPending(null); setSelected(null); lock.current = false; await read();
    } catch (error) { if (current === generation.current) setState(s => ({ ...s, busy: false, error })); }
    finally { if (current === generation.current) lock.current = false; }
  }
  async function readCleanup(resourceId) {
    if (lock.current) return;
    lock.current=true;const current=generation.current;setState(s=>({...s,busy:true,error:null,cleanup:null}));
    try {
      const result=await portfolioRequest(`/api/ai/documents/${resourceId}/index/cleanup`);
      if(result.data?.schema!=='AI_INDEX_CLEANUP_STATUS_V1'||result.data.resourceId!==resourceId)throw new Error('Cleanup authority could not be verified.');
      if(current===generation.current)setState(s=>({...s,busy:false,cleanup:result.data}));
    } catch(error){if(current===generation.current)setState(s=>({...s,busy:false,error,cleanup:null}));}
    finally{if(current===generation.current)lock.current=false;}
  }
  function publish(event) {
    event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget)), resourceId = selected?.resourceId || crypto.randomUUID();
    const body = { key: crypto.randomUUID(), expectedRevision: selected?.revision || 0, title: f.title || 'Approved purchase order',
      allowedUserIds: f.allowedUserIds.split(/[\s,]+/).filter(Boolean), ...(mode === 'MANUAL' ? { text: f.text } :
        { sourceReference: { cohort: f.cohort, vendorId: f.vendorId.trim(), orderId: f.orderId.trim(), documentRevision: Number(f.documentRevision), sourceHash: f.sourceHash.trim() } }) };
    mutate({ path: `/api/ai/documents/${resourceId}/publish`, body });
  }
  const action = (suffix, expectedRevision) => mutate({ path: `/api/ai/documents/${selected.resourceId}/${suffix}`, body: { key: crypto.randomUUID(), expectedRevision } });
  return <section className="pf-panel" aria-labelledby="ai-documents-heading"><h2 id="ai-documents-heading">Documents and index</h2>
    <p>Publish scoped plain text or bind an approved purchase order. Source changes and revoked access invalidate old index generations. PDF/OCR and remote URL imports are unsupported.</p>
    <LocalEffectStatus control={effects}/>
    <details><summary>Cleanup an inactive or superseded document index</summary>
      <p>Enter an existing document ID to inspect cleanup authority. Current ACL and original source permission are required. Cleanup removes at most 100 retired or proven orphan points and preserves the published generation.</p>
      <form className="pf-form" onSubmit={event=>{event.preventDefault();readCleanup(new FormData(event.currentTarget).get('cleanupResourceId').trim());}}>
        <WorkspaceField name="cleanupResourceId" label="Cleanup document ID" required pattern="[a-fA-F0-9-]{36}" />
        <button disabled={state.busy||!!pending}>Inspect cleanup authority</button>
      </form>
      {state.cleanup&&<><p className="pf-id">{state.cleanup.resourceId}</p><p>{state.cleanup.metadata.active?'Active':'Inactive'} document · {state.cleanup.metadata.provenance} · document revision {state.cleanup.metadata.revision} · index revision {state.cleanup.revision}. Tracked retired points: {state.cleanup.retiredPointCount}.</p>
        <button disabled={state.busy||!!pending||state.cleanup.revision===0} onClick={()=>{const value=state.cleanup;setState(s=>({...s,cleanup:null}));mutate({path:`/api/ai/documents/${value.resourceId}/index/cleanup`,body:{key:crypto.randomUUID(),expectedRevision:value.revision}});}}>Clean verified retired or orphan points</button></>}
    </details>
    <button disabled={state.busy} onClick={() => read()}>Load authorized documents</button>
    {pending && <WorkspaceState title="Unresolved document command"><p>Reconcile the saved command before submitting another change.</p><button disabled={state.busy} onClick={() => mutate(pending)}>Reconcile same command</button></WorkspaceState>}
    {state.error && <WorkspaceState kind="error" title="Document or index unavailable"><p>{errorMessage(state.error)}</p><p>An unavailable embedding/vector provider does not prevent manual document persistence.</p></WorkspaceState>}
    {state.busy && <WorkspaceState kind="loading" title="Checking document and index authority" />}
    {state.list && <><p>Coverage: {state.list.coverage}. Only current authorized records are listed.</p>
      {!state.list.resources.length && <p>No authorized documents found.</p>}
      <ul className="pf-list">{state.list.resources.map(row => <li key={row.resourceId}><button disabled={state.busy || !!pending} onClick={() => { setSelected(row); setState(s => ({ ...s, index: null })); }}>{row.title}</button>
        <span>Document {row.revision} · ACL {row.aclRevision} · {row.provenance}</span></li>)}</ul></>}
    {selected && <><h3>{selected.title}</h3><p className="pf-id">{selected.resourceId}</p>
      <button disabled={state.busy || !!pending} onClick={() => read(selected.resourceId)}>Inspect current index / recovery action</button>
      <button disabled={state.busy || !!pending} onClick={() => action('revoke', selected.revision)}>Revoke document access</button>
      <button disabled={state.busy || !!pending} onClick={() => { setSelected(null); setState(s => ({ ...s, index: null })); }}>Compose another document</button></>}
    {selected && state.index && <><p>{state.index.state} · source revision {state.index.sourceRevision} · index revision {state.index.revision} · model {state.index.model}. Next: {state.index.nextAction}.</p>
      <p>Tracked retired points: {state.index.retiredPointCount}. Cleanup removes at most 100 old points per action.</p>
      <button disabled={state.busy || !!pending} onClick={() => action('rebuild', state.index.revision)}>Rebuild current source with configured model</button>
      <button disabled={state.busy || !!pending || state.index.revision===0} onClick={() => action('index/cleanup', state.index.revision)}>Clean retired or managed orphan points</button>
      <button disabled={state.busy || !!pending || state.index.revision === 0} onClick={() => action('index/revoke', state.index.revision)}>Deactivate index generation</button></>}
    <details><summary>{selected ? 'Replace text or ACL with a new revision' : 'Publish a document'}</summary>
      <WorkspaceField as="select" label="Ingestion source" value={mode} onChange={e => setMode(e.target.value)}><option value="MANUAL">Manual plain text</option><option value="ISSUED">Approved purchase order</option></WorkspaceField>
      <form className="pf-form" onSubmit={publish} key={`${selected?.resourceId || 'new'}:${mode}`}>
        {mode === 'MANUAL' ? <><WorkspaceField name="title" label="Document title" required maxLength={240} defaultValue={selected?.title || ''} />
          <WorkspaceField as="textarea" name="text" label="Complete replacement text" required maxLength={100000} hint="Manual text is labelled MANUAL_TEXT and does not establish business authority." /></> : <>
          <WorkspaceField as="select" name="cohort" label="Purchase order cohort"><option>LEGACY</option><option>CATALOG</option></WorkspaceField>
          <WorkspaceField name="vendorId" label="Vendor ID" required /><WorkspaceField name="orderId" label="Purchase order ID" required />
          <WorkspaceField type="number" min="1" step="1" name="documentRevision" label="Current approved revision" required />
          <WorkspaceField name="sourceHash" label="Original approved SHA-256" pattern="[a-f0-9]{64}" required hint="Text is extracted from the approved source. Readers also require current procurement source permission." /></>}
        <WorkspaceField as="textarea" name="allowedUserIds" label="Allowed reader user IDs" required hint="Separate UUIDs with commas or whitespace. Include yourself to list or index the document. No account or role is created." />
        <button className="pf-primary" disabled={state.busy || !!pending}>Publish {selected ? 'next revision' : 'document'}</button>
      </form></details>
  </section>;
}
