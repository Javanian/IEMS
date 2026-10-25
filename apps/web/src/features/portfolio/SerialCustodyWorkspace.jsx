import { useContext, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { abandonCustodyCommand, adoptCustodyCommand, claimCustodyCommand, custodyCapability, custodyEventPath, custodyHint, hasCustodyMarker, receiptCustodyPath, workOrderClaimsPath } from './serial-custody.mjs';

function CustodyCommand({ title, action, path, build, onSaved, blockedReason, children, onRetained }) {
  const identity = useContext(IdentityContext), capability = custodyCapability(action, identity?.permissions), reasonId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), attempt = useRef(null), lock = useRef(false);
  const denied = !capability.enabled ? capability.reason : error?.status === 403 ? custodyCapability(action, []).reason : '';
  async function send() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { const result = await request(path, { body:attempt.current }); attempt.current = null; onRetained?.(false); onSaved(result.data); }
    catch (failure) { setError(failure); } finally { lock.current = false; setBusy(false); }
  }
  const hint = custodyHint(error), retained = !!attempt.current, retryable = retained && error && (!error.status || error.status >= 500);
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (attempt.current || lock.current || denied || blockedReason) return;
    const data = new FormData(event.currentTarget), values = Object.fromEntries(data);
    if (event.currentTarget.querySelector('[name=serialUnitIds]')) values.serialUnitIds = data.getAll('serialUnitIds');
    attempt.current = build(values, crypto.randomUUID()); onRetained?.(true); send();
  }}><h3>{title}</h3><fieldset className="pf-form" disabled={busy || retained || !!denied || !!blockedReason}>{children}<label className="pf-field">Custody action reason<textarea name="reason" rows={3} required minLength={3} maxLength={500} /></label></fieldset>
    <Failure error={error} mutation />{hint && <p role="alert">{hint}</p>}
    {(denied || blockedReason) && <div id={reasonId}>{denied && <p className="pf-disabled-reason">{denied}</p>}{blockedReason && <p className="pf-disabled-reason">{blockedReason}</p>}</div>}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || retained || !!denied || !!blockedReason} aria-describedby={denied || blockedReason ? reasonId : undefined}>{busy ? 'Saving...' : title}</button>{retryable && <button type="button" disabled={busy || !!denied} onClick={send}>Retry same custody command</button>}{retained && error && <button type="button" disabled={busy} onClick={() => { attempt.current = null; onRetained?.(false); setError(null); onSaved(); }}>Discard custody command and refresh</button>}</div>
    <p className="pf-muted">An uncertain response retains the exact identities, versions and key. Retry that command, or discard it and review the refreshed source before changing inputs.</p>
  </form>;
}

function HoldNotice({ view }) {
  return !view.sourceHolds.length ? null : <div><p role="alert">Source holds block fresh adoption, claims, release and consumption. An AVAILABLE identity is not proof that a held source is usable.</p><ul className="pf-list">{view.sourceHolds.map(hold => <li key={hold.receiptId}><Link to={`/portfolio/warehouse/receipts/${hold.receiptId}`}>Review source holds on receipt {hold.receiptId}</Link><span>{hold.reasonCodes.join(', ') || 'Legacy source hold requiring review'}</span>{hold.holdIds.map(id => <span key={id} className="pf-id">Hold: {id}</span>)}</li>)}</ul></div>;
}

function ReceiptAuthority({ view }) {
  return <><p>Custody mode: {view.mode}</p><p>Quantity available counter: {view.quantityAvailable} {view.uom} · Claimable incoming identities: {view.claimableQuantity === null ? 'Unavailable (UNTRACKED)' : `${view.claimableQuantity} ${view.uom}`}</p><p>The quantity counter includes pending CLAIMED identities. Claimable identities are a separate authority; registry uniqueness does not establish availability or physical installation.</p><HoldNotice view={view} />{view.adoptionBlockers.length > 0 && <p>Adoption blockers: {view.adoptionBlockers.join(', ')}</p>}</>;
}

export function SerialCustodyReceipt({ row, refresh }) {
  const identity = useContext(IdentityContext), read = custodyCapability('custody.read', identity?.permissions);
  return read.enabled ? <ReceiptCustodyData row={row} refresh={refresh} /> : <section id="receipt-serial-custody"><h2>Incoming serial custody</h2><p className="pf-disabled-reason">{read.reason}</p><p>Receipt serials remain traceability identifiers until current custody authority is read. No identity availability is inferred.</p></section>;
}

function ReceiptCustodyData({ row, refresh }) {
  const path = receiptCustodyPath(row._id), resource = useResource(path);
  const saved = () => { resource.reload(); refresh(); };
  return <Resource resource={resource}>{({ data:view }) => <section id="receipt-serial-custody" data-receipt-version={view.receiptVersion}><h2>Incoming serial custody</h2><div className="pf-panel"><button type="button" onClick={resource.reload}>Refresh incoming serial custody</button><ReceiptAuthority view={view} />{!view.tracked && <p>No incoming custody units are established. {hasCustodyMarker(row) ? 'An existing marker requires valid authority; unsupported quantity paths remain blocked.' : 'Adoption is explicit and permanent; old registry entries are not automatically available stock.'}</p>}{!!view.units.length && <ul className="pf-list">{view.units.map(unit => <li key={unit._id}><strong>{unit.serial}</strong><span>Status: {unit.status} · {unit.uom}</span>{unit.workOrderId && <Link to={`/portfolio/manufacturing/work-orders/${unit.workOrderId}`}>Open custody work order</Link>}<span className="pf-id">Incoming unit: {unit._id}{unit.claimId ? ` · Claim: ${unit.claimId}` : ''}</span></li>)}</ul>}<p>This custody view records incoming identity ownership and consumption. Inspect linked work orders for separate received installation evidence; custody alone does not establish parent links.</p></div>
    {!view.tracked && <CustodyCommand key={`adopt-${view.receiptVersion}`} title="Adopt incoming serial custody" action="custody.adopt" path={`${path}/adopt`} build={(values, key) => adoptCustodyCommand(view, values, key)} onSaved={saved} blockedReason={view.canAdopt ? '' : `Receipt is not eligible for permanent adoption. Review blockers: ${view.adoptionBlockers.join(', ') || 'current receipt state'}.`}><p>Permanent adoption requires untouched, STORED and unheld incoming serial stock with matching lot, heat and registry origin. Quantity-only reservation and counting will no longer be available.</p></CustodyCommand>}
    <CustodyEvents path={path} key={`events-${view.receiptVersion}`} />
  </section>}</Resource>;
}

export function ReceiptCustodyGate({ row, children }) {
  const identity = useContext(IdentityContext), read = custodyCapability('custody.read', identity?.permissions);
  if (!hasCustodyMarker(row)) return children(null);
  if (!read.enabled) return children(undefined);
  return <ReceiptCustodyRead receiptId={row._id}>{children}</ReceiptCustodyRead>;
}
function ReceiptCustodyRead({ receiptId, children }) {
  const resource = useResource(receiptCustodyPath(receiptId));
  return <Resource resource={resource}>{({ data }) => children(data)}</Resource>;
}

export function WithSerialClaims({ wo, children }) {
  const identity = useContext(IdentityContext), read = custodyCapability('custody.read', identity?.permissions);
  if (!wo.serialCustodyRequired) return children({ claims:[], workOrderVersion:wo.version });
  if (!read.enabled) return <p className="pf-disabled-reason">{read.reason} Release needs a complete source-to-claim mapping.</p>;
  return <WorkOrderClaimsRead wo={wo}>{children}</WorkOrderClaimsRead>;
}
function WorkOrderClaimsRead({ wo, children }) {
  const resource = useResource(workOrderClaimsPath(wo._id));
  return <Resource resource={resource}>{({ data }) => children(data)}</Resource>;
}

export function SerialCustodyWorkOrder({ wo, refresh }) {
  const identity = useContext(IdentityContext), read = custodyCapability('custody.read', identity?.permissions);
  if (!wo.serialCustodyRequired) return null;
  return read.enabled ? <WorkOrderCustodyData wo={wo} refresh={refresh} /> : <section id="work-order-serial-custody"><h2>Incoming serial claims</h2><p className="pf-disabled-reason">{read.reason}</p></section>;
}
function WorkOrderCustodyData({ wo, refresh }) {
  const path = workOrderClaimsPath(wo._id), resource = useResource(path);
  const saved = () => { resource.reload(); refresh(); };
  return <Resource resource={resource}>{({ data:view }) => <section id="work-order-serial-custody" data-work-order-version={view.workOrderVersion}><h2>Incoming serial claims</h2><div className="pf-panel"><button type="button" onClick={resource.reload}>Refresh incoming serial claims</button><p>Work order status: {view.status} · Version: {view.workOrderVersion}</p><p>Claim exact incoming identities before release. Claims do not change stock quantities; release reserves them and the first operation consumes them. {wo.installationRequired ? 'Inspect the received component installation section for current parent evidence.' : 'Installation into an output unit is UNRECORDED.'}</p>{!view.claims.length ? <p>No active incoming serial claims. Select a source and identities explicitly while the work order is PLANNED.</p> : <ul className="pf-list">{view.claims.map(claim => <li key={claim._id}><Link to={`/portfolio/warehouse/receipts/${claim.receiptId}`}>Claimed source {claim.receiptId}</Link><strong>{claim.status} · {claim.quantity} {claim.uom}</strong><span>Lot {claim.materialTrace.lotNumber} · Heat {claim.materialTrace.heatNumber}</span><span>Serials: {claim.serials.join(', ')}</span><span className="pf-id">Claim: {claim._id} · Version: {claim.version}</span><ClaimSourceHold receiptId={claim.receiptId} /></li>)}</ul>}</div>
    {view.status === 'PLANNED' ? <><NewClaim key={`claim-${view.workOrderVersion}`} view={view} path={path} onSaved={saved} /><AbandonClaim key={`abandon-${view.workOrderVersion}`} view={view} path={path} onSaved={saved} /></> : <p>Claims are read-only after work order release. RESERVED and CONSUMED identities cannot be abandoned, cancelled or reused in this slice.</p>}
    <CustodyEvents path={path} key={`events-${view.workOrderVersion}`} />
  </section>}</Resource>;
}
function ClaimSourceHold({ receiptId }) {
  return <ReceiptCustodyRead receiptId={receiptId}>{view => <><p>Source quantity available counter: {view.quantityAvailable} {view.uom} · Claimable identities: {view.claimableQuantity ?? 'Unavailable'}</p><HoldNotice view={view} /></>}</ReceiptCustodyRead>;
}
function NewClaim({ view, path, onSaved }) {
  const receipts = useResource('/api/warehouse/receipts?limit=100', true), [receiptId, setReceiptId] = useState(''), [selectionLocked, setSelectionLocked] = useState(false), selectionLock = useRef(false);
  const retained = value => { selectionLock.current = value; setSelectionLocked(value); };
  return <Resource resource={receipts}>{({ data }) => { const adopted = data.filter(row => row.serialCustody?.mode === 'RECEIVED_V1'); return <div className="pf-panel"><label className="pf-field">Incoming source receipt<select name="receiptId" value={receiptId} disabled={selectionLocked} onChange={event => { if (!selectionLock.current) setReceiptId(event.target.value); }}><option value="">Select adopted incoming receipt</option>{adopted.map(row => <option key={row._id} value={row._id}>{row.lotNumber} / {row.heatNumber} · {row._id}</option>)}</select></label>{!adopted.length && <p>No adopted receipts were found. Open an untouched serialized receipt and explicitly adopt custody first.</p>}{receiptId ? <ReceiptCustodyRead key={receiptId} receiptId={receiptId}>{receipt => <ClaimForm view={view} receipt={receipt} path={path} onSaved={onSaved} onRetained={retained} />}</ReceiptCustodyRead> : <p>Select a receipt to read current claimable identities. UOM alone does not establish material equivalence.</p>}</div>; }}</Resource>;
}
function ClaimForm({ view, receipt, path, onSaved, onRetained }) {
  const available = receipt.units.filter(unit => unit.status === 'AVAILABLE');
  const blocked = !receipt.tracked || receipt.mode !== 'RECEIVED_V1' ? 'The source has no valid incoming custody authority.' : receipt.sourceHolds.length ? 'Source holds block a fresh claim. Review or release the receipt holds.' : !available.length || !Number(receipt.claimableQuantity) ? 'No current incoming identities are claimable. Refresh the source or choose another receipt.' : view.claims.some(claim => claim.receiptId === receipt.receiptId) ? 'This work order already has an active claim for the receipt. Abandon the PLANNED claim explicitly before replacing it.' : '';
  return <CustodyCommand title="Claim incoming serial identities" action="custody.claim" path={path} build={(values, key) => claimCustodyCommand(view, receipt, values, key)} onSaved={onSaved} onRetained={onRetained} blockedReason={blocked}><ReceiptAuthority view={receipt} /><input type="hidden" name="receiptId" value={receipt.receiptId} /><p>Select the exact source identities needed by the intended released material quantity. One serial represents one source UOM; positive integral material ratios are supported, at most 100 identities per source. Nothing is selected automatically.</p><label className="pf-field">Incoming identities to claim<select name="serialUnitIds" multiple size={Math.min(8, Math.max(3, available.length))} required defaultValue={[]}>{available.map(unit => <option key={unit._id} value={unit._id} data-status={unit.status}>{unit.serial} · {unit.status}</option>)}</select></label></CustodyCommand>;
}
function AbandonClaim({ view, path, onSaved }) {
  const claims = view.claims.filter(claim => claim.status === 'CLAIMED');
  return <CustodyCommand title="Abandon planned serial claim" action="custody.abandon" path={`${path}/abandon`} build={(values, key) => abandonCustodyCommand(view, values, key)} onSaved={onSaved} blockedReason={!claims.length ? 'No CLAIMED identities can be abandoned while this work order is PLANNED.' : ''}><p>Abandon frees only the selected incoming identity claim. It does not alter stock quantities. Later RESERVED or CONSUMED claims cannot be released here.</p><label className="pf-field">Planned claim<select name="claimId" required defaultValue=""><option value="">Select claim to abandon</option>{claims.map(claim => <option key={claim._id} value={claim._id}>{claim._id} · {claim.quantity} {claim.uom}</option>)}</select></label></CustodyCommand>;
}
function CustodyEvents({ path }) {
  const [cursor, setCursor] = useState(''), resource = useResource(custodyEventPath(path, cursor));
  return <section className="pf-panel"><h3>Incoming custody events</h3><p>Immutable evidence. UUID page order does not imply chronological order.</p><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No incoming custody events recorded yet.</p> : <ul className="pf-list">{data.map(event => <li key={event._id}><strong>{event.kind} · Version {event.version}</strong><span>{event.reason}</span><span>Incoming serials: {event.serials.join(', ')}</span><span className="pf-id">Recorded by {event.recordedBy} at {event.recordedAt}</span><span className="pf-id">Event: {event._id}</span></li>)}</ul>}<div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First custody event page</button>}{page.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>Next custody event page</button>}</div></>}</Resource></section>;
}
