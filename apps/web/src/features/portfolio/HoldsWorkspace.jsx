import { useContext, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { portfolioRequest as request, errorMessage } from './client.mjs';
import { IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { HOLD_REASONS, RELEASE_REASONS, HOLD_STATUSES, reasonLabel, normalizePage, unwrap, holdsPath, applyHoldCommand, releaseHoldCommand, holdState, actionState, commandOutcome, impactRows, orderReceiptIds, stockExceptionText, STOCK_EXCEPTION_NOTE } from './holds.mjs';

const when = at => (at ? new Date(at).toLocaleString('en-US') : '');
const actor = a => a?.displayName || a?.userId || 'Unknown user';
const short = id => (id ? id.slice(0, 8) : '');

// One command with a stable Idempotency-Key per attempt; an uncertain result retries the same key and body.
export function useKeyedCommand({ path, onSaved }) {
  const [busy, setBusy] = useState(false), [outcome, setOutcome] = useState(null), [notice, setNotice] = useState('');
  const attempt = useRef(null), lock = useRef(false);
  async function send() {
    if (lock.current || !attempt.current) return;
    lock.current = true; setBusy(true); setOutcome(null); setNotice('');
    try {
      const result = await request(path, { body: attempt.current.body, headers: { 'Idempotency-Key': attempt.current.key } });
      attempt.current = null; onSaved(unwrap(result));
    } catch (error) {
      const next = { ...attempt.current.outcome(error), code: error.code, status: error.status };
      if (!next.retry) attempt.current = null;
      setOutcome(next);
    } finally { lock.current = false; setBusy(false); }
  }
  function start(body, outcome) { attempt.current = { body, key: crypto.randomUUID(), outcome }; return send(); }
  function discard() { attempt.current = null; setOutcome(null); }
  return { busy, outcome, notice, setNotice, start, send, discard, pending: () => Boolean(attempt.current) };
}

function Reason({ id, state }) {
  return state.enabled ? null : <p className="pf-disabled-reason" id={id}>{state.reason}</p>;
}
function Outcome({ outcome, onReload, onRetry, onDiscard, busy }) {
  if (!outcome) return null;
  return <div className="pf-error" role="alert"><p>{outcome.message}</p>{outcome.code && <p className="pf-id">Code: {outcome.code}</p>}
    <div className="pf-actions">{outcome.retry && <button type="button" disabled={busy} onClick={onRetry}>Retry same request</button>}
      {outcome.retry && <button type="button" disabled={busy} onClick={onDiscard}>Discard and reload</button>}
      {outcome.conflict && <button type="button" onClick={onReload}>Reload holds</button>}</div></div>;
}

function ReleaseForm({ hold, ctx }) {
  const { denied, setDenied, conflict, setConflict, permissions, reloadAll, saved } = ctx;
  const command = useKeyedCommand({ path: `/api/warehouse/holds/${hold.id}/release`, onSaved: () => saved('Hold released. Other active holds on this receipt are unchanged.') });
  const [localError, setLocalError] = useState('');
  const state = actionState('release', { permissions, denied, conflict, hold, busy: command.busy });
  const describe = `release-reason-${hold.id}`;
  return <form className="pf-form pf-hold-release" aria-label={`Release hold ${reasonLabel(hold.reasonCode)}`} onSubmit={e => {
    e.preventDefault(); if (!state.enabled || command.pending()) return; setLocalError('');
    let body; try { body = releaseHoldCommand(hold, Object.fromEntries(new FormData(e.currentTarget))); } catch (err) { setLocalError(err.message); return; }
    command.start(body, error => { const o = commandOutcome('release', error, hold); if (o.denied) setDenied(d => ({ ...d, release: true })); if (o.conflict) setConflict(c => ({ ...c, [o.conflict]: true })); return o; });
  }}>
    <fieldset disabled={command.busy || command.pending()} className="pf-fields">
      <label className="pf-field">Release reason<select name="reasonCode" required defaultValue=""><option value="" disabled>Select reason</option>{RELEASE_REASONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="pf-field">Release note<textarea name="reasonNote" required minLength={3} maxLength={500} rows={2} /></label>
    </fieldset>
    {localError && <p className="pf-error" role="alert">{localError}</p>}
    <Outcome outcome={command.outcome} busy={command.busy} onRetry={command.send} onDiscard={() => { command.discard(); reloadAll(); }} onReload={reloadAll} />
    <div className="pf-actions"><button className="pf-primary" disabled={!state.enabled || command.pending()} aria-describedby={state.enabled ? undefined : describe}>{command.busy ? 'Releasing...' : 'Release hold'}</button><Reason id={describe} state={state} /></div>
  </form>;
}

function ApplyForm({ receipt, ctx }) {
  const { denied, setDenied, conflict, setConflict, permissions, reloadAll, saved } = ctx;
  const command = useKeyedCommand({ path: `/api/warehouse/receipts/${receipt.id}/holds`, onSaved: () => saved('Hold applied. The whole receipt is now on hold.') });
  const [localError, setLocalError] = useState('');
  const state = actionState('apply', { permissions, denied, conflict, receipt, busy: command.busy });
  return <form className="pf-panel pf-form" aria-labelledby="apply-hold-heading" onSubmit={e => {
    e.preventDefault(); if (!state.enabled || command.pending()) return; setLocalError('');
    let body; try { body = applyHoldCommand(receipt, Object.fromEntries(new FormData(e.currentTarget))); } catch (err) { setLocalError(err.message); return; }
    command.start(body, error => { const o = commandOutcome('apply', error); if (o.denied) setDenied(d => ({ ...d, apply: true })); if (o.conflict) setConflict(c => ({ ...c, [o.conflict]: true })); return o; });
  }}>
    <h2 id="apply-hold-heading">Apply hold</h2>
    <p className="pf-muted">Covers the whole receipt ({receipt.quantity}{receipt.uom ? ` ${receipt.uom}` : ''}). Partial holds are not supported. Existing reservations stay recorded and are flagged, not cancelled.</p>
    <fieldset disabled={command.busy || command.pending()} className="pf-fields">
      <label className="pf-field">Hold reason<select name="reasonCode" required defaultValue=""><option value="" disabled>Select reason</option>{HOLD_REASONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="pf-field">Hold note<textarea name="reasonNote" required minLength={3} maxLength={500} rows={2} /></label>
    </fieldset>
    <p className="pf-id">Saving against receipt version {receipt.version}.</p>
    {localError && <p className="pf-error" role="alert">{localError}</p>}
    <Outcome outcome={command.outcome} busy={command.busy} onRetry={command.send} onDiscard={() => { command.discard(); reloadAll(); }} onReload={reloadAll} />
    <div className="pf-actions"><button className="pf-primary" disabled={!state.enabled || command.pending()} aria-describedby={state.enabled ? undefined : 'apply-hold-reason'}>{command.busy ? 'Applying...' : 'Apply hold'}</button><Reason id="apply-hold-reason" state={state} /></div>
  </form>;
}

function HoldItem({ hold, ctx, children }) {
  return <li className="pf-hold" data-hold-id={hold.id}>
    <div className="pf-hold-head"><strong>{reasonLabel(hold.reasonCode)}</strong><span className={`pf-status ${hold.status === 'ACTIVE' ? 'pf-status-hold' : ''}`}>{hold.status === 'ACTIVE' ? 'Active' : 'Released'}</span></div>
    <p>{hold.reasonNote}</p>
    <span className="pf-id">Applied by {actor(hold.appliedBy)} · {when(hold.appliedAt)} · Version {hold.version}</span>
    {hold.status === 'RELEASED' && <span className="pf-id">Released by {actor(hold.releasedBy)} · {when(hold.releasedAt)} · {reasonLabel(hold.releaseReasonCode)}{hold.releaseReasonNote ? `: ${hold.releaseReasonNote}` : ''}</span>}
    {children}
  </li>;
}

// Panel on the receipt record: hold state, active holds, impacts and the two separate commands.
export function ReceiptHolds({ receiptId, refresh }) {
  const identity = useContext(IdentityContext);
  const resource = useResource(`/api/warehouse/receipts/${receiptId}/holds`);
  const [denied, setDenied] = useState({}), [conflict, setConflict] = useState({}), [notice, setNotice] = useState('');
  const reloadAll = () => { setConflict({}); setNotice(''); resource.reload(); refresh?.(); };
  const ctx = { denied, setDenied, conflict, setConflict, permissions: identity?.permissions, reloadAll, saved: message => { setConflict({}); resource.reload(); refresh?.(); setNotice(message); } };
  if (resource.loading) return <section className="pf-panel" aria-labelledby="stock-holds-heading"><h2 id="stock-holds-heading">Stock holds</h2><p role="status">Loading holds...</p></section>;
  if (resource.error) return <section className="pf-panel" aria-labelledby="stock-holds-heading"><h2 id="stock-holds-heading">Stock holds</h2><div className="pf-error" role="alert"><p>Holds could not be loaded. {errorMessage(resource.error)}</p>{resource.error.code && <p>Code: {resource.error.code}</p>}<button type="button" onClick={reloadAll}>Reload holds</button></div></section>;
  return <section className="pf-panel" aria-labelledby="stock-holds-heading" data-testid="receipt-holds">{(envelope => {
    const data = unwrap(envelope), receipt = data.receipt, holds = data.holds ?? [], state = holdState(receipt);
    const active = holds.filter(h => h.status === 'ACTIVE'), released = holds.filter(h => h.status !== 'ACTIVE'), impacts = impactRows(data.impacts);
    return <>
      <div className="pf-toolbar"><h2 id="stock-holds-heading">Stock holds</h2><span className={`pf-status ${state.held ? 'pf-status-hold' : ''}`} data-hold-state={state.held ? 'held' : 'clear'}>{state.label}</span><button type="button" onClick={reloadAll}>Reload holds</button></div>
      <p className="pf-muted">A hold blocks reserving, consuming, moving and shipping this receipt. Releasing a hold is separate from QC release; neither grants the other.</p>
      <p role="status">{notice}</p>
      <h3>Active holds</h3>
      {!active.length ? <p>No active holds on this receipt.</p> : <ul className="pf-list">{active.map(hold => <HoldItem key={hold.id} hold={hold} ctx={ctx}><ReleaseForm key={`${hold.id}-${hold.version}`} hold={hold} ctx={ctx} /></HoldItem>)}</ul>}
      <h3>Impacted reservations and work orders</h3>
      {!impacts.total ? <p>No reservations or work orders draw on this receipt.</p> : <ul className="pf-list" aria-label="Hold impacts">
        {impacts.reservations.map(r => <li key={r.key}><strong>{r.kind} · {r.quantity}</strong><span className="pf-status pf-status-hold">{r.state}</span><Link to={r.link}>{r.linkLabel}</Link></li>)}
        {impacts.workOrders.map(w => <li key={w.key}><strong>{w.kind} · {w.status}</strong><span className="pf-status pf-status-hold">{w.state}</span><Link to={w.link}>{w.linkLabel}</Link></li>)}
      </ul>}
      {state.held && impacts.total > 0 && <p className="pf-muted">{STOCK_EXCEPTION_NOTE}</p>}
      {released.length > 0 && <details><summary>Released holds ({released.length})</summary><ul className="pf-list">{released.map(hold => <HoldItem key={hold.id} hold={hold} ctx={ctx} />)}</ul></details>}
      <ApplyForm key={`apply-${receipt.version}`} receipt={{ ...receipt, id: receipt.id || receiptId }} ctx={ctx} />
    </>;
  })(resource)}</section>;
}

export function HoldList() {
  const query = new URLSearchParams(useLocation().search), status = HOLD_STATUSES.includes(query.get('status')) ? query.get('status') : 'ACTIVE', cursor = query.get('cursor');
  const resource = useResource(holdsPath({ status, cursor }));
  const link = (s, c) => { const q = new URLSearchParams({ status: s }); if (c) q.set('cursor', c); return `?${q}`; };
  return <><h1>Stock holds</h1>
    <nav className="pf-actions" aria-label="Warehouse"><Link to="/portfolio/warehouse/receipts">Receipts</Link><Link to="/portfolio/warehouse/bins">Bins</Link><Link to="/portfolio/warehouse/movements">Movement history</Link><Link to="/portfolio/warehouse/reservations">Reservations</Link></nav>
    <p className="pf-muted">Holds cover whole receipts. Open a receipt to apply or release a hold and review impacted reservations.</p>
    <nav className="pf-tabs" aria-label="Hold status">{HOLD_STATUSES.map(s => <Link key={s} aria-current={s === status ? 'page' : undefined} to={link(s)}>{s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Released'}</Link>)}</nav>
    <section className="pf-panel"><div className="pf-toolbar"><h2>{status === 'ALL' ? 'All holds' : status === 'ACTIVE' ? 'Active holds' : 'Released holds'}</h2><button type="button" onClick={resource.reload}>Refresh holds</button></div>
      <Resource resource={resource}>{envelope => { const { items, nextCursor } = normalizePage(envelope); return <>
        {!items.length ? <p>{status === 'ACTIVE' ? 'No active holds in this plant.' : 'No holds in this view.'}</p> : <ul className="pf-list pf-rows">{items.map(hold => <li key={hold.id}>
          <Link to={`/portfolio/warehouse/receipts/${hold.receiptId}`}>Receipt {short(hold.receiptId)}</Link>
          <span className={`pf-status ${hold.status === 'ACTIVE' ? 'pf-status-hold' : ''}`}>{hold.status === 'ACTIVE' ? 'Active' : 'Released'}</span>
          <span>{reasonLabel(hold.reasonCode)} · {hold.reasonNote}</span>
          <span className="pf-id">Applied by {actor(hold.appliedBy)} · {when(hold.appliedAt)}{hold.releasedAt ? ` · Released by ${actor(hold.releasedBy)} · ${when(hold.releasedAt)}` : ''}</span>
        </li>)}</ul>}
        <div className="pf-actions">{cursor && <Link to={link(status)}>First page</Link>}{nextCursor && <Link to={link(status, nextCursor)}>Next page</Link>}</div>
      </>; }}</Resource></section></>;
}

// Shown on a work order or sales order affected by an active hold. States facts only.
export function StockExceptions({ exceptions }) {
  if (!exceptions?.length) return null;
  return <section className="pf-panel pf-exception" role="region" aria-labelledby="stock-exception-heading" data-testid="stock-exceptions">
    <h2 id="stock-exception-heading">Stock exception</h2>
    <ul className="pf-list">{exceptions.map(x => <li key={`${x.holdId}-${x.receiptId}`}><strong>{stockExceptionText(x)}</strong><Link to={`/portfolio/warehouse/receipts/${x.receiptId}`}>Review hold on receipt</Link></li>)}</ul>
    <p>{STOCK_EXCEPTION_NOTE}</p>
  </section>;
}

function ExceptionAvailability({ resources }) {
  const error = resources.find(r => r.error)?.error;
  return <section className="pf-panel" aria-label="Stock exception availability">{error ? <div role="alert"><p>Stock exception data unavailable. Do not treat this as stock clearance. {errorMessage(error)}</p><button type="button" onClick={() => resources.forEach(r => r.reload())}>Reload stock exceptions</button></div> : <p role="status">Checking stock exceptions...</p>}</section>;
}
export function OrderStockExceptions({ orderId }) {
  const reservations = useResource('/api/warehouse/reservations?limit=100', true);
  const workOrders = useResource('/api/manufacturing/work-orders?limit=100', true);
  const resources = [reservations, workOrders];
  if (resources.some(r => r.loading || r.error)) return <ExceptionAvailability resources={resources} />;
  const receiptIds = orderReceiptIds(orderId, reservations.data, workOrders.data);
  return receiptIds.length ? <OrderReceiptHolds receiptIds={receiptIds} orderId={orderId} /> : null;
}
function OrderReceiptHolds({ receiptIds, orderId }) {
  const resource = useResource(holdsPath({ status: 'ACTIVE', limit: 100 }), true);
  if (resource.loading || resource.error) return <ExceptionAvailability resources={[resource]} />;
  const { items } = normalizePage(resource);
  const exceptions = items.filter(h => receiptIds.includes(h.receiptId)).map(h => ({ holdId: h.id, receiptId: h.receiptId, reasonCode: h.reasonCode, since: h.appliedAt }));
  return <div data-order-exceptions={orderId}><StockExceptions exceptions={exceptions} /></div>;
}
