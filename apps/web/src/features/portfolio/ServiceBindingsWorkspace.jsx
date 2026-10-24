import { useContext, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { useKeyedCommand } from './HoldsWorkspace.jsx';
import { normalizePage } from './holds.mjs';
import { Boundary, ServiceTabs, ThreadMessage } from './CustomerServiceWorkspace.jsx';
import { bindingCommand, revokeCommand, bindingStatus, bindingIdOf, capabilityState, csOutcome, permissionReason, humanize } from './customer-service.mjs';

const when = at => (at ? new Date(at).toLocaleString('en-US') : '');

function Outcome({ outcome, busy, onRetry, onDiscard, onReload }) {
  if (!outcome) return null;
  return <div className="pf-error" role="alert"><p>{outcome.message}</p>{outcome.code && <p className="pf-id">Code: {outcome.code}</p>}
    <div className="pf-actions">{outcome.retry && <button type="button" disabled={busy} onClick={onRetry}>Retry same request</button>}
      {outcome.retry && <button type="button" disabled={busy} onClick={onDiscard}>Discard</button>}
      {outcome.conflict && onReload && <button type="button" onClick={onReload}>Reload binding</button>}</div></div>;
}
function Submit({ label, busyLabel, busy, state, id }) {
  return <div className="pf-actions"><button className="pf-primary" disabled={busy || !state.enabled} aria-describedby={state.enabled ? undefined : id}>{busy ? busyLabel : label}</button>{!state.enabled && <p className="pf-disabled-reason" id={id}>{state.reason}</p>}</div>;
}
// Capability check first; a server 403 for this action also disables the control with the same reason.
function useActionState(action, denied) {
  const identity = useContext(IdentityContext);
  return denied ? { enabled: false, reason: permissionReason(action) } : capabilityState(action, identity?.permissions);
}
function ContactSelect({ accountId }) {
  const contacts = useResource(`/api/crm/accounts/${accountId}/contacts?limit=100`, true);
  return <Resource resource={contacts}>{({ data }) => data.length ? <label className="pf-field">Contact<select name="contactId" required defaultValue=""><option value="" disabled>Select contact</option>{data.map(c => <option key={c._id} value={c._id}>{c.name} · {c.email}</option>)}</select></label> : <p>This account has no contacts. <Link to={`/portfolio/accounts/${accountId}`}>Add a contact</Link> first.</p>}</Resource>;
}

function CreateBinding({ onSaved }) {
  const [accountId, setAccountId] = useState(''), [denied, setDenied] = useState(false), [localError, setLocalError] = useState('');
  const accounts = useResource('/api/crm/accounts?limit=100', true);
  const command = useKeyedCommand({ path: '/api/cs/bindings', onSaved: result => onSaved(result.binding ?? result) });
  const state = useActionState('cs.binding.manage', denied);
  return <form className="pf-panel pf-form" aria-labelledby="create-binding-heading" onSubmit={e => {
    e.preventDefault(); if (!state.enabled || command.pending()) return; setLocalError('');
    let body; try { body = bindingCommand(Object.fromEntries(new FormData(e.currentTarget))); } catch (err) { setLocalError(err.message); return; }
    command.start(body, error => { const o = csOutcome('cs.binding.manage', error); if (o.denied) setDenied(true); return o; });
  }}>
    <h2 id="create-binding-heading">Bind a synthetic contact</h2>
    <p className="pf-muted">Links a synthetic address to one contact of an account in your plant. Knowing a phone or order number never creates a binding.</p>
    <fieldset className="pf-fields" disabled={command.busy || command.pending()}>
      <Resource resource={accounts}>{({ data }) => <label className="pf-field">Account<select name="accountId" required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="" disabled>Select account</option>{data.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}</select></label>}</Resource>
      {accountId ? <ContactSelect key={accountId} accountId={accountId} /> : <p className="pf-muted">Select an account to list its contacts.</p>}
      <label className="pf-field">Synthetic address<input name="address" required inputMode="tel" autoComplete="off" placeholder="+62000123456" aria-describedby="binding-address-hint" /></label>
      <label className="pf-field">Expires (optional)<input name="expiresAt" type="datetime-local" /></label>
    </fieldset>
    <p id="binding-address-hint" className="pf-id">Channel: Simulated. Address must be +62000 followed by 6 to 9 digits.</p>
    {localError && <p className="pf-error" role="alert">{localError}</p>}
    <Outcome outcome={command.outcome} busy={command.busy} onRetry={command.send} onDiscard={command.discard} />
    <Submit label="Create binding" busyLabel="Creating..." busy={command.busy} state={state} id="create-binding-reason" />
  </form>;
}

export function ServiceBindings() {
  const query = new URLSearchParams(useLocation().search), cursor = query.get('cursor'), navigate = useNavigate();
  const resource = useResource(`/api/cs/bindings?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Customer service</h1><Boundary /><ServiceTabs current="bindings" />
    <div className="pf-columns">
      <section className="pf-panel"><div className="pf-toolbar"><h2>Contact bindings</h2><button type="button" onClick={resource.reload}>Refresh bindings</button></div>
        <Resource resource={resource}>{envelope => { const { items, nextCursor } = normalizePage(envelope); return <>
          {!items.length ? <p>No bindings yet. Bind a synthetic contact to start a simulated conversation.</p> : <ul className="pf-list pf-binding-rows">{items.map(b => { const s = bindingStatus(b); return <li key={bindingIdOf(b)}>
            <Link to={`/portfolio/service/bindings/${bindingIdOf(b)}`}>{b.address || `Fixture binding ${bindingIdOf(b).slice(0, 8)}`}</Link><span className={`pf-status ${s.usable ? '' : 'pf-status-hold'}`}>{s.label}</span>
            <span className="pf-id">{b.accountName || `Account ${b.accountId?.slice(0, 8)}`} · {b.contactName || `Contact ${b.contactId?.slice(0, 8)}`}{b.expiresAt ? ` · Expires ${when(b.expiresAt)}` : ''}</span></li>; })}</ul>}
          <div className="pf-actions">{cursor && <Link to="?">First page</Link>}{nextCursor && <Link to={`?cursor=${encodeURIComponent(nextCursor)}`}>Next page</Link>}</div>
        </>; }}</Resource></section>
      <CreateBinding onSaved={binding => navigate(`/portfolio/service/bindings/${bindingIdOf(binding)}`)} />
    </div></>;
}

function RevokeBinding({ binding, reload }) {
  const [denied, setDenied] = useState(false), [conflict, setConflict] = useState(false), [localError, setLocalError] = useState('');
  const command = useKeyedCommand({ path: `/api/cs/bindings/${bindingIdOf(binding)}/revoke`, onSaved: reload });
  const base = useActionState('cs.binding.manage', denied);
  const state = conflict ? { enabled: false, reason: 'Binding changed, reload to continue' } : base;
  return <form className="pf-panel pf-form" aria-labelledby="revoke-binding-heading" onSubmit={e => {
    e.preventDefault(); if (!state.enabled || command.pending()) return; setLocalError('');
    let body; try { body = revokeCommand(binding, { reason: new FormData(e.currentTarget).get('revokeReason') }); } catch (err) { setLocalError(err.message); return; }
    command.start(body, error => { const o = csOutcome('cs.binding.manage', error); if (o.denied) setDenied(true); if (o.conflict) setConflict(true); return o; });
  }}>
    <h2 id="revoke-binding-heading">Revoke binding</h2>
    <p className="pf-muted">Revocation applies immediately: queued replies are cancelled and reads through this binding return not found.</p>
    <label className="pf-field">Revoke reason<textarea name="revokeReason" required minLength={3} maxLength={500} rows={2} /></label>
    {localError && <p className="pf-error" role="alert">{localError}</p>}
    <Outcome outcome={command.outcome} busy={command.busy} onRetry={command.send} onDiscard={command.discard} onReload={() => { setConflict(false); command.discard(); reload(); }} />
    <Submit label="Revoke binding" busyLabel="Revoking..." busy={command.busy} state={state} id="revoke-binding-reason" />
  </form>;
}

const PRESETS = [['Order or repair status', 'IEMS ORDER '], ['Start complaint', 'IEMS COMPLAINT'], ['Ask for a person', 'IEMS HUMAN'], ['Menu', 'IEMS MENU']];
function Simulator({ binding, status }) {
  const [text, setText] = useState(''), [denied, setDenied] = useState(false), [exchanges, setExchanges] = useState([]);
  const pendingText = useRef('');
  const command = useKeyedCommand({ path: '/api/cs/simulator/inbound', onSaved: result => setExchanges(list => [{ ...result, sent: pendingText.current }, ...list]) });
  const base = useActionState('cs.simulator.use', denied);
  const state = !status.usable ? { enabled: false, reason: status.reason } : base;
  return <section className="pf-panel" aria-labelledby="simulator-heading">
    <h2 id="simulator-heading">Inbound simulator</h2>
    <p className="pf-muted">Sends a customer message through the same handler as the WhatsApp bridge, with the preview dispatcher. Nothing leaves this workspace.</p>
    <div className="pf-actions" role="group" aria-label="Message presets">{PRESETS.map(([label, value]) => <button key={label} type="button" disabled={!state.enabled} onClick={() => setText(value)}>{label}</button>)}</div>
    <form className="pf-form" onSubmit={e => {
      e.preventDefault(); if (!state.enabled || command.pending() || !text.trim()) return;
      pendingText.current = text.trim();
      command.start({ bindingId: bindingIdOf(binding), inboundKey: crypto.randomUUID(), text: text.trim() }, error => { const o = csOutcome('cs.simulator.use', error); if (o.denied) setDenied(true); return o; });
    }}>
      <label className="pf-field">Customer message<input name="simulatorText" value={text} onChange={e => setText(e.target.value)} required maxLength={1000} autoComplete="off" /></label>
      <Outcome outcome={command.outcome} busy={command.busy} onRetry={command.send} onDiscard={command.discard} />
      <Submit label="Send simulated message" busyLabel="Sending..." busy={command.busy} state={state} id="simulator-reason" />
    </form>
    {exchanges.length > 0 && <><h3>Replies in this session</h3><ol className="pf-list pf-thread" aria-label="Simulator replies">{exchanges.map((x, i) => <li key={`${x.conversationId}-${exchanges.length - i}`} className="pf-exchange">
      <p className="pf-id">Customer: {x.sent}</p>
      {x.reply ? <ol className="pf-list pf-sim-reply"><ThreadMessage m={{ direction: 'OUTBOUND', origin: 'BOT', at: x.reply.at || new Date().toISOString(), ...x.reply }} /></ol> : !x.suppressed && <p>No reply was prepared for this message.</p>}
      {x.suppressed && <p>No bot reply: the conversation is with an agent ({humanize(x.mode)}).</p>}
      {x.error && <p className="pf-id">Result: {humanize(x.error)}</p>}
      {x.draft && <p className="pf-id">Complaint draft stage: {humanize(x.draft.stage)}</p>}
      <div className="pf-actions">{x.ticket && <Link to={`/portfolio/service/tickets/${x.ticket.ticketId}`}>Open ticket {x.ticket.ticketNumber}</Link>}{x.conversationId && <Link to={`/portfolio/service/conversations/${x.conversationId}`}>Open conversation</Link>}</div>
    </li>)}</ol></>}
  </section>;
}

export function ServiceBinding() {
  const { id } = useParams();
  const resource = useResource('/api/cs/bindings?limit=100', true);
  return <><Link to="/portfolio/service/bindings">Back to bindings</Link><Resource resource={resource}>{envelope => {
    const binding = normalizePage(envelope).items.find(b => bindingIdOf(b) === id);
    if (!binding) return <div className="pf-error" role="alert"><p>Binding not found in your plant.</p><button type="button" onClick={resource.reload}>Reload binding</button></div>;
    const status = bindingStatus(binding);
    return <>
      <h1>Binding {binding.address || bindingIdOf(binding).slice(0, 8)}</h1><Boundary />
      <div className="pf-summary"><span className={`pf-status ${status.usable ? '' : 'pf-status-hold'}`} data-binding-status={status.code}>{status.label}</span><span>Channel: {humanize(binding.channel || 'SIMULATED')}</span><span>Version {binding.version}</span></div>
      <div className="pf-actions"><Link to={`/portfolio/accounts/${binding.accountId}`}>Open account</Link><button type="button" onClick={resource.reload}>Reload binding</button></div>
      <dl className="pf-dl pf-dl-left"><dt>Contact</dt><dd>{binding.contactName || binding.contactId}</dd><dt>Created</dt><dd>{when(binding.createdAt)}{binding.createdBy ? ` by ${binding.createdBy.displayName || binding.createdBy.userId || binding.createdBy}` : ''}</dd>{binding.expiresAt && <><dt>Expires</dt><dd>{when(binding.expiresAt)}</dd></>}{binding.revokedAt && <><dt>Revoked</dt><dd>{when(binding.revokedAt)}{binding.revokeReason ? ` · ${binding.revokeReason}` : ''}</dd></>}</dl>
      <div className="pf-columns">
        <Simulator key={`${id}-${binding.version}`} binding={binding} status={status} />
        {status.code === 'ACTIVE' && <RevokeBinding key={`revoke-${binding.version}`} binding={binding} reload={resource.reload} />}
      </div>
    </>;
  }}</Resource></>;
}
