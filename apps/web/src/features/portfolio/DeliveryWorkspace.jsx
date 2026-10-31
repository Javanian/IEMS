import { useContext, useEffect, useId, useRef, useState } from 'react';
import { IdentityContext, Resource, useResource, Failure } from './PortfolioWorkspace.jsx';
import { portfolioRequest as request } from './client.mjs';
import { AuditDetails } from './OperatorUi.jsx';
import { CommandForm, Input } from './FulfillmentWorkspace.jsx';
import { displayReference, operatorStatus } from './operator.mjs';

export function deliveryCommand(view, values, serials, key) {
  const body = { expectedVersion: view.version, expectedShipmentVersion: view.shipmentVersion, quantity: values.quantity, deliveredAt: new Date(`${values.deliveredAt}Z`).toISOString(), receiverName: values.receiverName, receiverReference: values.receiverReference, evidenceReference: values.evidenceReference, evidenceNotes: values.evidenceNotes, idempotencyKey: key };
  if (view.serials.length) body.serials = [...serials];
  return body;
}
function recovery(code) {
  return { DELIVERY_QUANTITY_EXCEEDED: 'The confirmed amount exceeds what remains undelivered. Refresh the shipment and enter the remaining amount.', INVALID_DELIVERY_SERIALS: 'Select the actual shipped serials received in this delivery. Each serial can be confirmed once. Any remaining quantity must come from the untracked part of this shipment.', INVALID_DELIVERY_EVIDENCE: 'Enter the receiver and the delivery document reference, with a brief description of the evidence.', INVALID_DELIVERY_DATE: 'Enter a valid reported delivery time in UTC. A future delivery cannot be confirmed.', DELIVERY_STATE_CONFLICT: 'This shipment has no further delivery confirmation available. Refresh to review the recorded evidence.', DELIVERY_SOURCE_INVALID: 'Shipment and delivery evidence do not reconcile. Ask an authorized supervisor to review the audit details.', VERSION_CONFLICT: 'Another confirmation changed this shipment. Discard this attempt and review the current delivery balance.', IDEMPOTENCY_CONFLICT: 'This attempt belongs to a different captured confirmation. Discard it and review the current evidence.' }[code];
}
export function ShipmentDelivery({ shipment, onLockChange, disabled = false }) {
  const path = `/api/deliveries/shipments/${shipment._id}`, resource = useResource(path), retained = useRef(false), [locked, setLock] = useState(false);
  const refresh = () => { if (!retained.current) resource.reload(); };
  const lock = value => { retained.current = value; setLock(value); onLockChange?.(value); };
  return <section id="shipment-delivery" data-delivery-locked={locked}><Resource resource={resource}>{({ data: view }) => <><header className="pf-panel"><h2>Delivery confirmation</h2><p>{displayReference('shipment', shipment)} · {operatorStatus(view.status)}</p><p>Dispatched: {view.shippedQuantity} {view.uom} · Confirmed received: {view.deliveredQuantity} {view.uom} · Still to confirm: {view.remainingQuantity} {view.uom}</p><p>Dispatch records goods leaving the site. Delivery confirmation records the receiver and evidence of their arrival.</p><button type="button" disabled={locked} onClick={refresh}>Refresh delivery evidence</button></header><ConfirmationForm key={view.version} view={view} path={path} refresh={refresh} setLocked={lock} disabled={disabled} /><section className="pf-panel"><h2>Recorded delivery evidence</h2>{!view.confirmations.length ? <p>No receipt by the customer has been confirmed yet.</p> : <ul className="pf-list">{view.confirmations.map(row => <li key={row._id}><strong>{row.evidenceReference}</strong><span>{row.quantity} {view.uom} received by {row.receiverName}</span><span>Reported delivery time (UTC): {row.deliveredAt}</span><span>Receiver reference: {row.receiverReference}</span><span>{row.evidenceNotes}</span>{row.serials?.length > 0 && <span>Received serials: {row.serials.join(', ')}</span>}<AuditDetails action="fulfillment.read"><p>Recorded by {row.recordedBy} at {row.recordedAt}</p><p className="pf-id">Confirmation: {row._id} · Source hash: {row.sourceHash} · Content hash: {row.contentHash}</p></AuditDetails></li>)}</ul>}<p>Evidence is recorded by an authorized operator. Carrier verification and a digital signature are separate checks.</p><AuditDetails action="fulfillment.read"><p>Dispatch state: {view.shipmentStatus} · Delivery version: {view.version} · Shipment version: {view.shipmentVersion}</p><p className="pf-id">Shipment: {view.shipmentId} · Source hash: {view.sourceHash} · Delivery authority: {view.authorityHash || 'No confirmation yet'}</p></AuditDetails></section></>}</Resource></section>;
}
function ConfirmationForm({ view, path, refresh, setLocked, disabled }) {
  const identity = useContext(IdentityContext), reasonId = useId(), attempt = useRef(null), submitting = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [retained, retain] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const denied = !identity?.permissions?.includes('fulfillment.deliver') || error?.status === 403;
  const reason = disabled ? 'Resolve the retained fulfillment command before confirming delivery.' : denied ? 'You need delivery confirmation permission. Ask an authorized delivery operator to record the customer receipt.' : !view.canConfirm ? 'All dispatched goods have already been confirmed, or the confirmation limit was reached. Review the evidence below.' : '';
  const unlock = () => { attempt.current = null; retain(false); setLocked(false); };
  async function send() {
    if (submitting.current || denied) return;
    submitting.current = true; setBusy(true); setError(null);
    try { await request(`${path}/confirmations`, { body: attempt.current }); if (mounted.current) { unlock(); refresh(); } }
    catch (failure) { if (mounted.current) setError(failure); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className="pf-panel pf-form" aria-label="Confirm delivery" onSubmit={event => {
    event.preventDefault(); if (submitting.current || attempt.current || reason) return;
    const data = new FormData(event.currentTarget);
    try { attempt.current = deliveryCommand(view, Object.fromEntries(data), data.getAll('serials'), crypto.randomUUID()); }
    catch { setError({ code: 'INVALID_DELIVERY_DATE', message: 'Enter a valid reported delivery time in UTC.' }); return; }
    retain(true); setLocked(true); send();
  }}><h2>Confirm delivery</h2><fieldset className="pf-form" disabled={busy || retained || !!reason}><label className="pf-field">Quantity received ({view.uom})<input name="quantity" required inputMode="decimal" /></label>{view.serials.length > 0 && <><label className="pf-field">Actual serials received<select name="serials" multiple size={Math.max(2, Math.min(8, view.remainingSerials.length))}>{view.remainingSerials.map(serial => <option key={serial} value={serial}>{serial}</option>)}</select></label><p>Select every tracked serial included in this receipt. Already confirmed serials cannot be selected again. Untracked quantity still available: {view.remainingUnserializedQuantity} {view.uom}.</p></>}<label className="pf-field">Reported delivery time (UTC)<input name="deliveredAt" type="datetime-local" required /></label><label className="pf-field">Receiver name on evidence<input name="receiverName" required minLength={3} maxLength={100} /></label><label className="pf-field">Receiver reference<input name="receiverReference" required minLength={3} maxLength={100} /></label><label className="pf-field">Delivery document reference<input name="evidenceReference" required minLength={3} maxLength={200} /></label><label className="pf-field">What confirms receipt<textarea name="evidenceNotes" required minLength={3} maxLength={1000} rows={3} /></label></fieldset><Failure error={error} mutation />{recovery(error?.code) && <p role="alert">{recovery(error.code)}</p>}{reason && <p className="pf-disabled-reason" id={reasonId}>{reason}</p>}<div className="pf-actions"><button className="pf-primary" disabled={busy || retained || !!reason} aria-describedby={reason ? reasonId : undefined}>{busy ? 'Recording delivery...' : 'Confirm delivery'}</button>{retained && error && (!error.status || error.status >= 500) && <button type="button" disabled={busy || denied} onClick={send}>Retry delivery confirmation</button>}{retained && error && <button type="button" disabled={busy} onClick={() => { unlock(); setError(null); refresh(); }}>Discard confirmation and refresh</button>}</div>{retained && <p role="status">This confirmation and its evidence stay locked until the result is resolved. Retry the same confirmation or discard it and read the current delivery balance.</p>}</form>;
}

export function ShipmentReturns({ shipment, locked, onLockChange }) {
  const resource = useResource(`/api/deliveries/shipments/${shipment._id}/returns`);
  return <section className="pf-panel"><h2>Customer returns</h2><Resource resource={resource}>{({ data: view }) => <>
    <p>Confirmed delivered: {view.deliveredQuantity} {view.uom} · Returned: {view.returnedQuantity} {view.uom} · Available to return: {view.returnableQuantity} {view.uom}</p>
    <p>Returned goods enter customer custody quarantine. This record grants no available inventory and issues no credit. An authorized operator must review stock disposition and any financial adjustment separately.</p>
    {view.canReturn ? <CommandForm key={`${shipment._id}-${view.version}`} title="Receive customer return" permission="fulfillment.deliver" action={`/api/deliveries/shipments/${shipment._id}/returns`} locked={locked} onLockChange={onLockChange} build={(values, key) => ({ expectedVersion: view.version, quantity: values.quantity, serials: values.serials || [], reference: values.reference, reason: values.reason, idempotencyKey: key })} onSaved={resource.reload}>
      <Input name="quantity" label={`Quantity received into quarantine (${view.uom})`} inputMode="decimal" />
      {view.returnableSerials.length > 0 && <label className="pf-field">Actual serials returned<select name="serials" multiple size={Math.max(2, Math.min(8, view.returnableSerials.length))}>{view.returnableSerials.map(serial => <option key={serial} value={serial}>{serial}</option>)}</select></label>}
      <Input name="reference" label="Return receipt reference" minLength={3} maxLength={500} />
      <Input name="reason" label="Return reason and condition" minLength={3} maxLength={500} />
    </CommandForm> : <p>No confirmed delivered quantity is available for another return. Record delivery evidence first where applicable.</p>}
    {!view.returns.length ? <p>No customer returns recorded.</p> : <ul className="pf-list">{view.returns.map(row => <li key={row._id}><strong>{row.reference}</strong><span>{row.quantity} {row.uom} · Quarantined</span><span>{row.reason}</span>{row.serials.length > 0 && <span>Returned serials: {row.serials.join(', ')}</span>}<span>Recorded at {new Date(row.recordedAt).toLocaleString('en-US')}</span></li>)}</ul>}
    <button type="button" disabled={!!locked} onClick={resource.reload}>Refresh returns</button>
  </>}</Resource></section>;
}
