import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';

export function ModelWorkspace() {
  const identity = useContext(IdentityContext), generation = useRef(0), lock = useRef(false);
  const [state, setState] = useState({}), [pending, setPending] = useState(null);
  const storageKey = identity?.scope?.tenantId && identity?.scope?.plantId && identity?.user?.id
    ? `iems.model-selection:${identity.scope.tenantId}:${identity.scope.plantId}:${identity.user.id}` : null;
  useEffect(() => {
    generation.current++; lock.current = false; setState({}); setPending(null);
    try { if (storageKey) setPending(JSON.parse(sessionStorage.getItem(storageKey) || 'null')); }
    catch { setState({ error: new Error('Selection recovery is unavailable. Contact the model operator before changing versions.') }); }
    return () => { generation.current++; };
  }, [identity, storageKey]);
  async function load() {
    if (lock.current) return;
    lock.current = true; const current = generation.current; setState(s => ({ ...s, busy: true, error: null, prediction: null }));
    try { const result = await portfolioRequest('/api/ai/models'); if (current === generation.current) setState({ data: result.data }); }
    catch (error) { if (current === generation.current) setState({ error }); }
    finally { if (current === generation.current) lock.current = false; }
  }
  async function select(body) {
    if (lock.current) return;
    const current = generation.current; lock.current = true; setState(s => ({ ...s, busy: true, error: null, prediction: null }));
    try {
      if (!storageKey) throw new Error('Authenticated recovery identity is unavailable');
      sessionStorage.setItem(storageKey, JSON.stringify(body)); setPending(body);
      await portfolioRequest('/api/ai/models/select', { body });
      if (current !== generation.current) return;
      sessionStorage.removeItem(storageKey); setPending(null); lock.current = false; await load();
    } catch (error) { if (current === generation.current) setState(s => ({ ...s, busy: false, error })); }
    finally { if (current === generation.current) lock.current = false; }
  }
  async function predict(event) {
    event.preventDefault(); if (lock.current) return;
    const f = Object.fromEntries(new FormData(event.currentTarget)), current = generation.current;
    lock.current = true; setState(s => ({ ...s, busy: true, error: null, prediction: null }));
    try {
      const result = await portfolioRequest('/api/ai/predictions', { body: { featureSetId: f.featureSetId,
        businessAsOf: new Date(f.businessAsOf).toISOString(), knowledgeAsOf: new Date(f.knowledgeAsOf).toISOString() } });
      if (current === generation.current) setState(s => ({ ...s, busy: false, prediction: result.data }));
    } catch (error) { if (current === generation.current) setState(s => ({ ...s, busy: false, error })); }
    finally { if (current === generation.current) lock.current = false; }
  }
  const data = state.data;
  return <>
    <header className="pf-page-header"><h1>Models and predictions</h1><p>Select immutable model versions, inspect lineage and request estimates from point-in-time features.</p></header>
    <button disabled={state.busy} onClick={load}>Refresh model configuration</button>
    {pending && <WorkspaceState title="Unresolved model selection"><p>Reconcile the exact saved command before changing the selected model.</p><button disabled={state.busy} onClick={() => select(pending)}>Reconcile saved selection</button></WorkspaceState>}
    {state.busy && <WorkspaceState kind="loading" title="Checking model and source authority" />}
    {state.error && <WorkspaceState kind="error" title="Model action unavailable"><p>{errorMessage(state.error)}</p></WorkspaceState>}
    {!data && !state.busy && !state.error && <WorkspaceState title="Load the selected plant configuration"><p>No model result is assumed. Missing source or model configuration produces abstention.</p></WorkspaceState>}
    {data && <section className="pf-panel"><h2>{data.state}</h2><p>{data.externalBoundary}</p>
      <dl className="pf-dl"><dt>Selection revision</dt><dd>{data.revision}</dd><dt>Feature source</dt><dd>{data.sourceConfigured ? 'Configured' : 'Unavailable'}</dd>
        <dt>Model adapter</dt><dd>{data.modelConfigured ? 'Configured' : 'Unavailable'}</dd><dt>Feature signature</dt><dd>{data.featureKeys.join(', ') || 'Not configured'}</dd></dl>
      {data.model && <><h3>{data.model.name} · version {data.model.version}</h3><p className="pf-id">Artifact SHA-256: {data.model.artifactDigest}</p>
        <p className="pf-id">Training run: {data.lineage.runId} · source manifest: {data.lineage.sourceManifestHash}</p></>}
      <form className="pf-form" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); select({ key: crypto.randomUUID(), expectedRevision: data.revision,
        model: { name: f.name, version: Number(f.version), artifactDigest: f.digest, featureKeys: data.featureKeys }, reason: f.reason, rollback: false }); }}>
        <WorkspaceField name="name" label="Registered model name" required /><WorkspaceField name="version" type="number" min="1" step="1" label="Immutable version" required />
        <WorkspaceField name="digest" label="Artifact SHA-256" pattern="[a-f0-9]{64}" required /><WorkspaceField name="reason" label="Change reason" maxLength={500} required />
        <button disabled={state.busy || !!pending || !data.modelConfigured}>Select pinned version</button></form>
      {data.previousModel && <form className="pf-form" onSubmit={e => { e.preventDefault(); const reason = new FormData(e.currentTarget).get('reason'); select({ key: crypto.randomUUID(), expectedRevision: data.revision, model: data.previousModel, reason, rollback: true }); }}>
        <h3>Rollback to {data.previousModel.name} version {data.previousModel.version}</h3><WorkspaceField name="reason" label="Rollback reason" required maxLength={500} />
        <button disabled={state.busy || !!pending || !data.modelConfigured}>Restore the previous pinned version</button></form>}
    </section>}
    {data && <section className="pf-panel"><h2>Point-in-time prediction</h2><form className="pf-form" onSubmit={predict}>
      <WorkspaceField name="featureSetId" label="Feature set ID" required /><WorkspaceField name="businessAsOf" label="Business cutoff (local time)" type="datetime-local" required />
      <WorkspaceField name="knowledgeAsOf" label="Knowledge cutoff (local time)" type="datetime-local" required hint="Both cutoffs are converted to UTC. Late-arriving facts cannot leak across the knowledge cutoff." />
      <button disabled={state.busy || !!pending}>Request estimate</button></form></section>}
    {state.prediction && <section className="pf-panel" aria-live="polite"><h2>{state.prediction.state}</h2>
      {state.prediction.reason && <p>{state.prediction.reason.replaceAll('_', ' ')}</p>}
      <p>{state.prediction.warning || 'No predictions are displayed without a configured source and validated model.'}</p>
      {state.prediction.model && <p>{state.prediction.model.name} v{state.prediction.model.version} · selection revision {state.prediction.selectionRevision}</p>}
      <ul className="pf-list">{state.prediction.predictions.map(p => <li key={p.entityId}><strong>{p.entityId}</strong><span>{p.value}</span></li>)}</ul>
      {state.prediction.sourceManifestHash && <p className="pf-id">Source manifest: {state.prediction.sourceManifestHash} · business {state.prediction.businessAsOf} · knowledge {state.prediction.knowledgeAsOf}</p>}
    </section>}
  </>;
}
