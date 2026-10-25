import { useContext, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Failure, IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest as request } from './client.mjs';
import { planningCapability, planningHint } from './internal-planning.mjs';

export function PlanningRead({ action, children }) {
  const identity = useContext(IdentityContext), read = planningCapability(action, identity?.permissions);
  return read.enabled ? children : <div><p className="pf-disabled-reason">You do not have access to this workspace with your current role.</p><details><summary>Technical details</summary><p>{read.reason}</p></details></div>;
}
export function PlanningNavigation() { return <nav className="pf-actions" aria-label="Internal planning"><Link to="/portfolio/manufacturing/work-orders">Customer work orders</Link><Link to="/portfolio/manufacturing/internal-execution">Internal execution</Link><Link to="/portfolio/manufacturing/internal-production">Internal production</Link><Link to="/portfolio/inventory-master/items">Inventory items</Link><Link to="/portfolio/inventory-master/locations">Company locations</Link></nav>; }
export function PlanningField({ label, ...props }) { return <label className="pf-field">{label}<input {...props} /></label>; }
export function PlanningCommand({ title, action, path, build, onSaved, children, blockedReason = '', locked = '', setLocked }) {
  const identity = useContext(IdentityContext), capability = planningCapability(action, identity?.permissions), reasonId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), attempt = useRef(null), sending = useRef(false);
  const denied = !capability.enabled ? capability.reason : error?.status === 403 ? planningCapability(action, []).reason : '';
  const other = locked && locked !== title ? 'Resolve the retained planning command before changing another record.' : '';
  const reason = denied || blockedReason || other, retained = !!attempt.current;
  async function send() {
    if (sending.current || denied || other) return;
    sending.current = true; setBusy(true); setError(null);
    try { const result = await request(path, { body:attempt.current }); attempt.current = null; setLocked?.(''); onSaved(result.data); }
    catch (failure) { setError(failure); } finally { sending.current = false; setBusy(false); }
  }
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (attempt.current || sending.current || reason) return;
    try { attempt.current = build(Object.fromEntries(new FormData(event.currentTarget)), crypto.randomUUID()); setLocked?.(title); send(); } catch(failure) { setError(failure); }
  }}><h2>{title}</h2><fieldset className="pf-form" disabled={busy || retained || !!reason}>{children}<label className="pf-field">Planning evidence reason<textarea name="reason" rows={3} required minLength={3} maxLength={500} /></label></fieldset>
    <Failure error={error} mutation />{planningHint(error) && <p role="alert">{planningHint(error)}</p>}{reason && <div id={reasonId}><p className="pf-disabled-reason">{denied ? "You do not have permission to perform this action." : reason}</p>{denied && <details><summary>Technical details</summary><p>{denied}</p></details>}</div>}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || retained || !!reason} aria-describedby={reason ? reasonId : undefined}>{busy ? 'Saving...' : title}</button>{retained && error && (!error.status || error.status >= 500) && <button type="button" disabled={busy || !!denied || !!other} onClick={send}>Retry same planning command</button>}{retained && error && <button type="button" disabled={busy} onClick={() => { attempt.current = null; setError(null); setLocked?.(''); onSaved(); }}>Discard planning command and refresh</button>}</div>
    <p className="pf-muted">An uncertain result keeps the complete body, source versions and key locked. Retry that command or discard it and read current evidence before changing inputs.</p>
  </form>;
}
