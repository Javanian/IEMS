import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';

export function VendorDraftWorkspace() {
  const identity = useContext(IdentityContext);
  const [draftId, setDraftId] = useState(''), [record, setRecord] = useState(null), [error, setError] = useState(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(null);
  const generation = useRef(0), controller = useRef(null), operation = useRef(false);
  const storageKey = identity?.scope?.tenantId && identity?.scope?.plantId && identity?.user?.id
    ? `vendor-draft:${identity.scope.tenantId}:${identity.scope.plantId}:${identity.user.id}` : null;
  useEffect(() => {
    generation.current++; operation.current = false; controller.current?.abort(); setRecord(null); setError(null); setBusy(false); setDraftId('');
    try { setPending(storageKey ? JSON.parse(sessionStorage.getItem(storageKey) || 'null') : null); }
    catch { setPending(null); setError(new Error('Saved command recovery is unavailable. Contact purchasing before submitting another command.')); }
    return () => { generation.current++; controller.current?.abort(); };
  }, [identity, storageKey]);
  async function read(id = draftId) {
    if (operation.current) return;
    operation.current = true;
    const token = ++generation.current; controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(null);
    try {
      const result = await portfolioRequest(`/api/ai/vendor-drafts/${encodeURIComponent(id)}`, { signal: controller.current.signal });
      if (generation.current === token) { setDraftId(id); setRecord(result.data); }
    } catch (e) { if (generation.current === token && e.name !== 'AbortError') { setError(e); setRecord(null); } }
    finally { if (generation.current === token) { operation.current = false; setBusy(false); } }
  }
  async function submit(action, body, id = draftId, replay = false) {
    if (operation.current) return;
    operation.current = true;
    const token = ++generation.current; setBusy(true); setError(null);
    const attempt = { id, action, body };
    try {
      // Persist the exact command before POST; failures retain it for explicit reconciliation.
      if (!storageKey) throw new Error('Authenticated recovery identity is unavailable');
      if (!replay) { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); setPending(attempt); }
      await portfolioRequest(`/api/ai/vendor-drafts/${encodeURIComponent(id)}/${action}`, { body });
      if (generation.current !== token) return;
      sessionStorage.removeItem(storageKey); setPending(null); setDraftId(id); operation.current = false; await read(id);
    } catch (e) { if (generation.current === token) { operation.current = false; setError(e); setBusy(false); } }
  }
  const command = extra => ({ key: crypto.randomUUID(), expectedRevision: record.revision, ...extra });
  const create = event => {
    event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget));
    const id = crypto.randomUUID();
    submit('create', { key: crypto.randomUUID(), expectedRevision: 0, text: f.text,
      source: { cohort: f.cohort, vendorId: f.vendorId.trim(), orderId: f.orderId.trim(),
        documentRevision: Number(f.documentRevision), sourceHash: f.sourceHash.trim() } }, id);
  };
  return <>
    <header className="pf-page-header"><h1>Vendor follow-up drafts</h1><p>Compose from an approved purchase order, review the exact recipient and evidence, then record human approval.</p></header>
    <WorkspaceState title="External delivery disabled"><p>Email and WhatsApp contacts are not configured. Local delivery receipts are explicitly simulated; approval never sends a message.</p></WorkspaceState>
    {pending && <section className="pf-panel" aria-label="Unresolved command"><h2>Resolve the previous command</h2><p>The outcome may be unknown. Preserve this tab and reconcile the same command before creating another.</p>
      <button disabled={busy} onClick={() => pending.action === 'dispatch' ? read(pending.id) : submit(pending.action, pending.body, pending.id, true)}>Reconcile saved command</button>
      <button disabled={busy} onClick={() => read(pending.id)}>Inspect current server record</button>
      {record?.draftId === pending.id && <button disabled={busy} onClick={() => { sessionStorage.removeItem(storageKey); setPending(null); }}>Use inspected server state and clear tab command</button>}
      {pending.action === 'dispatch' && <button disabled={busy} onClick={() => submit('reconcile', pending.body, pending.id)}>Reconcile delivery attempt</button>}
    </section>}
    <section className="pf-panel"><h2>Open a draft</h2><form className="pf-form" onSubmit={e => { e.preventDefault(); read(); }}>
      <WorkspaceField label="Draft ID" value={draftId} onChange={e => { setDraftId(e.target.value); setRecord(null); }} required disabled={busy || !!pending} />
      <button disabled={busy || !!pending}>Open draft</button></form></section>
    {!record && <section className="pf-panel"><h2>Compose a draft</h2><form className="pf-form" onSubmit={create}>
      <WorkspaceField as="select" name="cohort" label="Purchase order cohort"><option>LEGACY</option><option>CATALOG</option></WorkspaceField>
      <WorkspaceField name="vendorId" label="Vendor ID" required /><WorkspaceField name="orderId" label="Purchase order ID" required />
      <WorkspaceField name="documentRevision" label="Approved document revision" type="number" min="1" step="1" required />
      <WorkspaceField name="sourceHash" label="Original approved source hash" pattern="[a-f0-9]{64}" required />
      <WorkspaceField as="textarea" name="text" label="Follow-up text" maxLength={5000} required hint="Draft text is a proposal. It does not change the purchase order or promise dates." />
      <button className="pf-primary" disabled={busy || !!pending}>Save draft</button></form></section>}
    {busy && <WorkspaceState kind="loading" title="Checking draft authority" />}
    {error && <WorkspaceState kind="error" title="Draft action unavailable"><p>{errorMessage(error)}</p></WorkspaceState>}
    {record && <section className="pf-panel" aria-live="polite"><h2>Draft revision {record.revision} · {record.state}</h2><p className="pf-id">{record.draftId}</p>
      <h3>Exact draft text</h3><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.text}</p>
      <h3>Approved source evidence</h3><dl className="pf-dl"><dt>Cohort</dt><dd>{record.source.cohort}</dd><dt>Order</dt><dd className="pf-id">{record.source.orderId}</dd>
        <dt>Document revision</dt><dd>{record.source.documentRevision}</dd><dt>Original hash</dt><dd className="pf-id">{record.source.sourceHash}</dd>
        <dt>Content hash</dt><dd className="pf-id">{record.contentHash}</dd></dl>
      <h3>Recipient</h3>{record.recipient ? <p>{record.recipient.displayLabel} · {record.recipient.channel} · grant revision {record.recipient.revision} · expires {record.recipient.expiresAt}</p> : <p>No verified recipient selected. Composition is saved; approval is blocked.</p>}
      {['DRAFT', 'PREVIEWED'].includes(record.state) && <form className="pf-form" onSubmit={e => { e.preventDefault(); const value = new FormData(e.currentTarget).get('grantId').trim(); submit('preview', command({ recipientGrantId: value || null })); }}>
        <WorkspaceField name="grantId" label="Existing vendor portal grant ID" hint="Use an active vendor grant. Leave blank to preview without a recipient; approval will remain blocked." />
        <button disabled={busy || !!pending}>Create immutable preview</button></form>}
      {record.preview && <p>{record.preview.historical ? 'Historical purchase order revision: approval blocked.' : 'Current revision at preview time; approval rechecks source and recipient.'} Preview {record.preview.previewId}</p>}
      {record.state === 'PREVIEWED' && <button className="pf-primary" disabled={busy || !!pending || !record.recipient || record.preview.historical}
        onClick={() => submit('approve', command({ previewId: record.preview.previewId, contentHash: record.contentHash, actionId: crypto.randomUUID() }))}>Approve this exact text and recipient</button>}
      {record.approval && <p>Approved by {record.approval.actorId} at {record.approval.approvedAt}.</p>}
      {record.state !== 'REVOKED' && <button disabled={busy || !!pending} onClick={() => submit('revoke', command({ actionId: crypto.randomUUID() }))}>Revoke approval / stop pending delivery</button>}
      {record.mode === 'LOCAL_SIMULATED' && record.state === 'APPROVED' && <button disabled={busy || !!pending} onClick={() => submit('intent', command({ attemptId: crypto.randomUUID(), deliveryKey: crypto.randomUUID() }))}>Create local simulated delivery intent</button>}
      {record.attempt && <><h3>Delivery attempt · {record.attempt.mode}</h3><p>{record.attempt.state} · {record.attempt.attemptId}</p>
        {record.state === 'PENDING' && <button disabled={busy || !!pending} onClick={() => submit('dispatch', { attemptId: record.attempt.attemptId })}>Run local simulated attempt</button>}
        {['DISPATCHING', 'UNKNOWN', 'ACCEPTED'].includes(record.attempt.state) && <button disabled={busy} onClick={() => submit('reconcile', { attemptId: record.attempt.attemptId })}>Reconcile the same attempt</button>}
        <p>Unknown delivery never automatically resends. Revocation after handoff cannot confirm recall.</p></>}
    </section>}
  </>;
}
