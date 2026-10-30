import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';

const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const when = value => value ? new Date(value).toLocaleString('en-US') : 'Not recorded';

export function VendorPortalWorkspace() {
  const identity = useContext(IdentityContext);
  const [state, setState] = useState({});
  const [pending, setPending] = useState(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const recoveryKey = identity?.user?.id && identity?.scope?.tenantId && identity?.scope?.plantId
    ? `iems.vendor-response.v1:${identity.scope.tenantId}:${identity.scope.plantId}:${identity.user.id}` : null;
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setState({}); setPending(null);
    if (recoveryKey) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
        if (saved?.body?.commandKey && saved?.order && saved.path === `/api/portals/vendors/${encodeURIComponent(saved.order.vendorId)}/orders/${encodeURIComponent(saved.order.orderId)}`) {
          setPending(saved);
          setState({ order: saved.order, path: saved.path, query: `cohort=${saved.order.cohort}` });
        }
      } catch { setState({ error: new Error('Saved response recovery is unavailable. Contact purchasing before creating another response.') }); }
    }
    return () => { generation.current += 1; };
  }, [identity, recoveryKey]);
  useEffect(() => {
    if (!pending) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  async function lookup(event) {
    event.preventDefault();
    if (busy.current || pending) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const path = `/api/portals/vendors/${encodeURIComponent(values.vendorId.trim())}/orders/${encodeURIComponent(values.orderId.trim())}`;
    const query = `cohort=${values.cohort}`;
    const current = ++generation.current;
    busy.current = true; setState({ loading: true });
    try {
      const order = await portfolioRequest(`${path}?${query}`);
      if (current === generation.current) setState({ order: order.data, path, query });
    } catch (error) {
      if (current === generation.current) setState({ error });
    } finally { if (current === generation.current) busy.current = false; }
  }

  async function history(after) {
    if (busy.current) return;
    const current = generation.current;
    busy.current = true; setState(s => ({ ...s, historyLoading: true, historyError: null }));
    try {
      const result = await portfolioRequest(`${state.path}/responses?${state.query}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      if (current === generation.current) setState(s => ({ ...s, history: result.data, historyLoading: false }));
    } catch (error) {
      if (current === generation.current) setState(s => ({ ...s, historyError: error, historyLoading: false }));
    } finally { if (current === generation.current) busy.current = false; }
  }

  async function send(command) {
    if (busy.current) return;
    try {
      if (!recoveryKey) throw new Error('Authenticated recovery identity is unavailable');
      sessionStorage.setItem(recoveryKey, JSON.stringify(command));
    } catch (error) {
      setState(s => ({ ...s, sendError: error }));
      return;
    }
    const current = generation.current;
    busy.current = true; setPending(command);
    setState(s => ({ ...s, sending: true, sendError: null, receipt: null }));
    try {
      const result = await portfolioRequest(`${command.path}/responses`, { body: command.body });
      if (current === generation.current) {
        sessionStorage.removeItem(recoveryKey);
        setPending(null);
        setState(s => ({ ...s, sending: false, receipt: result.data, history: null }));
      }
    } catch (error) {
      if (current === generation.current) setState(s => ({ ...s, sending: false, sendError: error }));
    } finally { if (current === generation.current) busy.current = false; }
  }

  function respond(event) {
    event.preventDefault();
    if (pending || busy.current) return;
    const values = new FormData(event.currentTarget);
    const decision = values.get('decision');
    const promises = decision === 'ACCEPT' ? state.order.lines.flatMap(line => {
      const date = values.get(line.lineId);
      return date ? [{ lineId: line.lineId, promisedAt: new Date(date).toISOString() }] : [];
    }) : [];
    void send({ path: state.path, order: state.order, body: { responseId: crypto.randomUUID(), commandKey: crypto.randomUUID(),
      cohort: state.order.cohort, documentRevision: state.order.documentRevision,
      sourceHash: state.order.sourceHash, decision, promises } });
  }

  const order = state.order;
  return <>
    <header className="pf-page-header"><h1>Vendor portal</h1><p>Review an approved purchase order and record your response.</p></header>
    <form className="pf-panel pf-form" onSubmit={lookup} aria-label="Find purchase order">
      <fieldset disabled={!!pending || state.loading || state.sending}><legend>Purchase order lookup</legend>
        <WorkspaceField name="vendorId" label="Vendor ID" pattern={uuidPattern} required />
        <WorkspaceField name="orderId" label="Purchase order ID" pattern={uuidPattern} required />
        <WorkspaceField as="select" name="cohort" label="Order source"><option value="LEGACY">Legacy purchasing</option><option value="CATALOG">Catalog purchasing</option></WorkspaceField>
        <button className="pf-primary">Load approved order</button>
      </fieldset>
    </form>
    {state.loading && <WorkspaceState kind="loading" title="Loading approved order" />}
    {state.error && <WorkspaceState kind="error" title="Order unavailable"><p>{errorMessage(state.error)}</p></WorkspaceState>}
    {!order && !state.loading && !state.error && <WorkspaceState title="Find your purchase order"><p>Use the vendor ID, order ID and source provided with your portal access.</p></WorkspaceState>}
    {order && <section className="pf-panel" aria-labelledby="vendor-order-heading">
      <h2 id="vendor-order-heading">Approved purchase order</h2>
      <dl className="pf-dl"><dt>Order ID</dt><dd className="pf-id">{order.orderId}</dd><dt>Document revision</dt><dd>{order.documentRevision}</dd><dt>Current revision</dt><dd>{order.currentDocumentRevision}</dd><dt>Status</dt><dd>{order.status}</dd><dt>Currency</dt><dd>{order.currency || 'Not recorded'}</dd><dt>Total</dt><dd>{order.total ?? 'Not recorded'}</dd></dl>
      <details><summary>Approved source hash</summary><p className="pf-id">{order.sourceHash}</p></details>
      <form className="pf-form" onSubmit={respond} aria-label="Respond to purchase order">
        <fieldset disabled={!!pending || !!state.receipt || !identity?.permissions?.includes('portal.vendor.respond') || order.documentRevision !== order.currentDocumentRevision}>
          <legend>Your response to revision {order.documentRevision}</legend>
          <WorkspaceField as="select" name="decision" label="Decision"><option value="ACCEPT">Accept</option><option value="DECLINE">Decline</option></WorkspaceField>
          <p>Optional promised dates use your local time and are saved in UTC. Dates are ignored when declining. These statements do not reserve stock or change the approved document.</p>
          <ul className="pf-list">{order.lines.map((line, index) => <li key={line.lineId}><strong>{line.description || line.itemCode || `Line ${index + 1}`}</strong><p>{line.quantity} {line.uom}</p><WorkspaceField type="datetime-local" name={line.lineId} label={`Promised date for line ${index + 1}`} /></li>)}</ul>
          <button className="pf-primary">Record response</button>
        </fieldset>
      </form>
      {!identity?.permissions?.includes('portal.vendor.respond') && <p>Recording responses requires vendor response permission and an active grant for this vendor.</p>}
      {order.documentRevision !== order.currentDocumentRevision && <p>This approved revision has been superseded. Load the current order before recording a new response.</p>}
      {state.receipt && <WorkspaceState title="Response recorded"><p className="pf-id">Response {state.receipt.data?.responseId || state.receipt.responseId || pending?.body.responseId}</p><p>Load the order again to record a correction as a new response.</p></WorkspaceState>}
      {pending && <WorkspaceState title={state.sending ? 'Recording response' : 'Response needs reconciliation'}>
        <p>Recovery is saved in this browser tab for your account and plant. It uses the same response ID, command key and approved document. Clearing browser storage loses this recovery reference.</p><p className="pf-id">Response {pending.body.responseId} · command {pending.body.commandKey}</p>
        {!state.sending && <button type="button" onClick={() => send(pending)}>Reconcile same response</button>}
      </WorkspaceState>}
      {state.sendError && <WorkspaceState kind="error" title="Response not confirmed"><p>{errorMessage(state.sendError, true)}</p><p>Do not submit a new response. Reconcile the saved command; if access or document validation fails, contact your purchasing administrator with the response reference.</p></WorkspaceState>}
      <h3>Response history</h3><p>Pages are ordered by response ID. Each entry records its own approved document revision.</p>
      <button type="button" disabled={state.historyLoading || state.sending} onClick={() => history()}>Refresh history</button>
      {state.historyLoading && <WorkspaceState kind="loading" title="Loading responses" />}
      {state.historyError && <WorkspaceState kind="error" title="History unavailable"><p>{errorMessage(state.historyError)}</p></WorkspaceState>}
      {state.history && <><ul className="pf-list">{state.history.items.map(row => <li key={row.responseId}><strong>{row.decision} · revision {row.documentRevision}</strong><p>{when(row.createdAt)}</p><p className="pf-id">{row.responseId}</p><ul>{row.promises.map(promise => <li key={promise.lineId}><span className="pf-id">{promise.lineId}</span> · {when(promise.promisedAt)}</li>)}</ul></li>)}</ul>{!state.history.items.length && <p>No responses on this page.</p>}{state.history.nextCursor && <button type="button" disabled={state.historyLoading} onClick={() => history(state.history.nextCursor)}>Next page</button>}</>}
    </section>}
  </>;
}
