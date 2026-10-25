import { useContext, useRef, useState } from 'react';
import { DocumentIssue } from './DocumentIssue.jsx';
import { MonetarySummary } from './MonetarySummary.jsx';
import { SourceLineage } from './SourceLineage.jsx';
import { MaterialTrace } from './MaterialTrace.jsx';
import { Link, useLocation, useParams } from 'react-router-dom';
import { portfolioRequest as request, validMoney, displayMoney } from './client.mjs';
import { Resource, Failure, useResource, IdentityContext } from './PortfolioWorkspace.jsx';
import { capabilityState, permissionReason } from './customer-service.mjs';
import { shipmentCommand, invoiceCommand, paymentCommand, validQuantity } from './fulfillment.mjs';

const Boundary = () => <p className="pf-tag">Synthetic data · Operator-recorded documents</p>;
const money = (currency, amount) => <span className="pf-money">{currency} {displayMoney(amount)}</span>;
const TITLES = { shipments: 'Shipments', invoices: 'Invoices', payments: 'Payments' };

// `permission` (optional) names the action; a server 403, or a session capability list without it, disables submit with a specific reason.
export function CommandForm({ title, action, build, children, onSaved, permission }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [saved, setSaved] = useState(false);
  const attempt = useRef(null), lock = useRef(false);
  const identity = useContext(IdentityContext);
  const allowed = permission ? capabilityState(permission, identity?.permissions) : { enabled: true };
  const deniedReason = permission && (error?.status === 403 ? permissionReason(permission) : !allowed.enabled ? allowed.reason : '');
  const reasonId = deniedReason ? `denied-${action.replace(/[^a-z0-9]/gi, '-')}` : undefined;
  async function send(body) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { const result = await request(action, { body }); attempt.current = null; setSaved(true); onSaved?.(result.data); }
    catch (e) { setError(e); } finally { lock.current = false; setBusy(false); }
  }
  function submit(event) {
    event.preventDefault(); setSaved(false);
    if (attempt.current) return;
    try { const data = new FormData(event.currentTarget), values = Object.fromEntries(data); if (event.currentTarget.querySelector('[name="serials"]')) values.serials = data.getAll('serials'); attempt.current = build(values, crypto.randomUUID()); send(attempt.current); }
    catch (e) { attempt.current = null; setError(e); }
  }
  const retryable = error && attempt.current && (!error.status || error.status >= 500);
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={submit}><h2>{title}</h2><fieldset className="pf-form" disabled={busy || !!attempt.current}>{children}</fieldset>
    {error && (error.status === undefined ? <div className="pf-error" role="alert"><p>{error.message}</p></div> : <Failure error={error} mutation />)}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || !!attempt.current || Boolean(deniedReason)} aria-describedby={reasonId}>{busy ? 'Saving...' : title}</button>{retryable && <button type="button" disabled={busy} onClick={() => send(attempt.current)}>Retry same request</button>}{attempt.current && error && <button type="button" disabled={busy} onClick={() => { attempt.current = null; setError(null); onSaved?.(); }}>Discard command and refresh</button>}{deniedReason && <p className="pf-disabled-reason" id={reasonId}>{deniedReason}</p>}</div>
    {attempt.current && error && <p>The command and its serial selection are retained. Retry the same request after an uncertain response, or discard it and review the refreshed record before changing inputs.</p>}
    <p role="status">{saved ? 'Saved.' : ''}</p></form>;
}
export function Input({ label, name, ...props }) { return <label className="pf-field">{label}<input name={name} required {...props} /></label>; }

function Tabs({ kind }) {
  return <nav className="pf-tabs" aria-label="Fulfillment">{Object.entries(TITLES).map(([k, t]) => <Link key={k} aria-current={kind === k ? 'page' : undefined} to={`/portfolio/fulfillment/${k}`}>{t}</Link>)}<Link to="/portfolio/orders">Sales orders</Link></nav>;
}
function rowSummary(kind, row) {
  if (kind === 'shipments') return <>{row.quantity} {row.uom} · Line {row.lineIndex + 1}</>;
  if (kind === 'invoices') return <MonetarySummary record={row} />;
  return <>{money(row.currency, row.amount)} · {row.allocations.length} allocation{row.allocations.length === 1 ? '' : 's'}</>;
}

export function FulfillmentList({ kind = 'shipments' }) {
  const query = new URLSearchParams(useLocation().search), cursor = query.get('cursor');
  const r = useResource(`/api/fulfillment/${kind}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Fulfillment</h1><Boundary /><Tabs kind={kind} />
    <section className="pf-panel"><div className="pf-toolbar"><h2>{TITLES[kind]}</h2><button type="button" onClick={r.reload}>Refresh list</button></div>
      <Resource resource={r}>{({ data, page }) => <>
        {!data.length ? <p>No {kind} yet. Open a sales order and choose Manage fulfillment.</p> : <ul className="pf-list pf-rows">{data.map(row => <li key={row._id}><Link to={`/portfolio/fulfillment/${kind}/${row._id}`}>{row.reference || `Invoice ${row._id.slice(0, 8)}`}</Link><span className="pf-status">{row.status}</span><div>{rowSummary(kind, row)}</div></li>)}</ul>}
        <div className="pf-actions">{cursor && <Link to="?">First page</Link>}{page?.nextCursor && <Link to={`?cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</Link>}</div>
      </>}</Resource></section></>;
}

function Balances({ order, resource }) {
  return <section className="pf-panel"><h2>Line balances</h2><Resource resource={resource}>{({ data }) => <div className="pf-table-wrap"><table className="pf-balance"><thead><tr><th>Line</th><th className="pf-num">Ordered</th><th className="pf-num">Shipped</th><th className="pf-num">Invoiced</th></tr></thead><tbody>{data.lines.map(l => <tr key={l.lineIndex}><td>{l.lineIndex + 1}. {order.snapshot.lines[l.lineIndex]?.description}</td><td className="pf-num">{l.orderedQuantity} {l.uom}</td><td className="pf-num">{l.shippedQuantity} {l.uom}</td><td className="pf-num">{l.invoicedQuantity} {l.uom}</td></tr>)}</tbody></table></div>}</Resource></section>;
}

export function FulfillmentOrder() {
  const { id } = useParams(), r = useResource(`/api/commercial/orders/${id}`), balances = useResource(`/api/fulfillment/orders/${id}/balances`);
  const [sourceType, setSourceType] = useState('WORK_ORDER'), [lineIndex, setLineIndex] = useState(0), [sourceId, setSourceId] = useState('');
  const sources = useResource(sourceType === 'WORK_ORDER' ? '/api/manufacturing/work-orders?limit=100' : '/api/warehouse/reservations?limit=100', true);
  const shipments = useResource('/api/fulfillment/shipments?limit=100', true);
  const refresh = () => { r.reload(); balances.reload(); sources.reload(); shipments.reload(); };
  const eligible = s => s.salesOrderId === id && s.lineIndex === lineIndex && (sourceType === 'WORK_ORDER' ? s.status === 'QC_COMPLETED' : ['RESERVED', 'PARTIALLY_SHIPPED'].includes(s.status));
  return <><Link to={`/portfolio/orders/${id}`}>Back to sales order</Link><Resource resource={r}>{({ data: order }) => <>
    <h1>Order fulfillment {order.orderNumber || order._id.slice(0, 8)}</h1><Boundary />
    <div className="pf-summary"><span className="pf-status">{order.status}</span><span>{order.snapshot.currency}</span><span>Version {order.version}</span></div>
    <div className="pf-actions"><Link to={`/portfolio/accounts/${order.accountId}`}>Open account</Link><Link to="/portfolio/fulfillment/invoices">Open invoices</Link><button type="button" onClick={refresh}>Refresh fulfillment</button></div>
    <Balances order={order} resource={balances} />
    <div className="pf-columns">
      <CommandForm title="Record shipment" action="/api/fulfillment/shipments" build={(v, k) => { if (!v.sourceId) throw Error('Select a source.'); if (!validQuantity(v.quantity)) throw Error('Enter a positive quantity with up to 6 decimals.'); if (sourceType === 'WORK_ORDER' && sources.data?.find(source => source._id === v.sourceId)?.serialized && !v.serials?.length) throw Error('Select accepted output serials for this shipment.'); return shipmentCommand(order, v, k); }} onSaved={refresh}>
        <label className="pf-field">Order line<select name="lineIndex" value={lineIndex} onChange={e => { setLineIndex(Number(e.target.value)); setSourceId(''); }}>{order.snapshot.lines.map((l, i) => <option key={i} value={i}>{i + 1}. {l.description} ({l.quantity} {l.uom})</option>)}</select></label>
        <label className="pf-field">Source type<select name="sourceType" value={sourceType} onChange={e => { setSourceType(e.target.value); setSourceId(''); }}><option value="WORK_ORDER">QC-completed work order</option><option value="RESERVATION">Warehouse reservation</option></select></label>
        <Resource resource={sources}>{({ data }) => { const rows = data.filter(eligible), selected = rows.find(s => s._id === sourceId); return rows.length ? <><label className="pf-field">Source<select name="sourceId" required value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">Select source</option>{rows.map(s => <option key={s._id} value={s._id}>{sourceType === 'WORK_ORDER' ? `Work order ${s._id.slice(0, 8)} · accepted ${s.qc?.acceptedQuantity} ${s.uom}` : `Reservation ${s._id.slice(0, 8)} · ${s.remainingQuantity ?? s.quantity} ${s.uom}`}</option>)}</select></label>{sourceType === 'WORK_ORDER' && selected?.serialized && <ShipmentSerials key={`${selected._id}-${order.version}`} workOrderId={selected._id} />}</> : <p>No eligible {sourceType === 'WORK_ORDER' ? 'QC-completed work orders' : 'reservations'} for this line.</p>; }}</Resource>
        <Input label={`Quantity (${order.snapshot.lines[lineIndex]?.uom})`} name="quantity" inputMode="decimal" autoComplete="off" />
        <Input label="Dispatch reference" name="reference" maxLength={200} autoComplete="off" />
      </CommandForm>
      <CommandForm title="Issue invoice" action="/api/fulfillment/invoices" build={(v, k) => { if (!v.shipmentId) throw Error('Select a shipment.'); if (!validQuantity(v.invoiceQuantity)) throw Error('Enter a positive quantity with up to 6 decimals.'); return invoiceCommand(order, { shipmentId: v.shipmentId, quantity: v.invoiceQuantity }, k); }} onSaved={refresh}>
        <Resource resource={shipments}>{({ data }) => { const rows = data.filter(s => s.salesOrderId === id); return rows.length ? <label className="pf-field">Shipment<select name="shipmentId" required defaultValue=""><option value="">Select shipment</option>{rows.map(s => <option key={s._id} value={s._id}>{s.reference} · {s.quantity} {s.uom}</option>)}</select></label> : <p>No shipments yet. Record a shipment first.</p>; }}</Resource>
        <Input label="Quantity to invoice" name="invoiceQuantity" inputMode="decimal" autoComplete="off" />
        <p className="pf-muted">Billed from shipped quantity at the order price in {order.snapshot.currency}.</p>
      </CommandForm>
    </div>
  </>}</Resource></>;
}

export function FulfillmentDetail({ kind }) {
  const { id } = useParams(), r = useResource(`/api/fulfillment/${kind}/${id}`);
  const name = { shipments: 'Shipment', invoices: 'Invoice', payments: 'Payment' }[kind];
  return <><Link to={`/portfolio/fulfillment/${kind}`}>Back to {kind}</Link><Resource resource={r}>{({ data: row }) => <>
    <h1>{name} {row.reference || row._id.slice(0, 8)}</h1><Boundary />
    <div className="pf-summary"><span className="pf-status">{row.status}</span>{kind === 'shipments' && <strong>{row.quantity} {row.uom}</strong>}{kind === 'payments' && <strong>{money(row.currency, row.amount)}</strong>}{kind === 'invoices' && <span>Quote revision {row.quoteRevision || 'not recorded'}</span>}</div>
    <div className="pf-actions">{row.salesOrderId && <Link to={`/portfolio/fulfillment/orders/${row.salesOrderId}`}>Open order fulfillment</Link>}<Link to={`/portfolio/accounts/${row.accountId}`}>Open account</Link><button type="button" onClick={r.reload}>Refresh record</button></div>
    {kind === 'shipments' && <SourceLineage line={row} />}
    {kind === 'invoices' && <DocumentIssue key={row._id} kind="invoice" sourceId={row._id} />}
    {kind === 'shipments' && row.status === 'SHIPPED' && <DocumentIssue key={row._id} kind="shipment" sourceId={row._id} />}
    <div className="pf-columns">
      <section className="pf-panel">
        {kind === 'invoices' && <><h2>Balance</h2><MonetarySummary record={row} /></>}
        <h2>Linked records</h2>
        <ul className="pf-list">
          {kind === 'shipments' && row.sources.map((s, i) => <li key={i}><Link to={s.sourceType === 'WORK_ORDER' ? `/portfolio/manufacturing/work-orders/${s.sourceId}` : `/portfolio/warehouse/reservations/${s.sourceId}`}>{s.sourceType === 'WORK_ORDER' ? 'Work order' : 'Reservation'} {s.sourceId.slice(0, 8)}</Link><span>{s.quantity} {row.uom}</span>{s.serials && <p>Shipped serials: {s.serials.join(', ')}</p>}<>{s.genealogy && <div><Link to={`/portfolio/manufacturing/work-orders/${s.genealogy.workOrderId}#lot-genealogy`}>Frozen lot genealogy revision {s.genealogy.revision}</Link><p className="pf-id">Content hash: {s.genealogy.contentHash}</p></div>}</><>{s.installation && <div><Link to={`/portfolio/manufacturing/work-orders/${s.installation.workOrderId}#component-installation`}>Frozen received installation revision {s.installation.revision}</Link><p className="pf-id">Installation content hash: {s.installation.contentHash}</p></div>}</><MaterialTrace trace={s.materialTrace} output={s.sourceType === 'WORK_ORDER'} /></li>)}
          {kind === 'invoices' && row.lines.map((l, i) => <li key={i}><Link to={`/portfolio/fulfillment/shipments/${l.shipmentId}`}>Shipment {l.shipmentId.slice(0, 8)}</Link><span>{l.description} · {l.quantity} {l.uom} × {money(l.currency, l.unitPrice)} = {money(l.currency, l.amount)}</span><SourceLineage line={l} /></li>)}
          {kind === 'invoices' && row.allocations.map((a, i) => <li key={`p${i}`}><Link to={`/portfolio/fulfillment/payments/${a.paymentId}`}>Payment {a.paymentId.slice(0, 8)}</Link><span>{money(row.currency, a.amount)}</span></li>)}
          {kind === 'payments' && row.allocations.map((a, i) => <li key={i}><Link to={`/portfolio/fulfillment/invoices/${a.invoiceId}`}>Invoice {a.invoiceId.slice(0, 8)}</Link><span>{money(a.currency, a.amount)} · invoice now {a.invoiceStatus}</span></li>)}
        </ul>
        <h2>History</h2><p className="pf-muted">Created {new Date(row.createdAt).toLocaleString('en-US')} · Version {row.version}</p>
      </section>
      {kind === 'invoices' && row.status !== 'PAID' && <CommandForm title="Allocate payment" action="/api/fulfillment/payments" build={(v, k) => { if (!validMoney(v.amount, row.currency) || !/[1-9]/.test(v.amount)) throw Error(`Enter a positive ${row.currency} amount at the currency scale.`); return paymentCommand(row, v, k); }} onSaved={r.reload}>
        <Input label={`Amount (${row.currency})`} name="amount" inputMode="decimal" autoComplete="off" />
        <Input label="Payment reference" name="reference" maxLength={200} autoComplete="off" />
        <p className="pf-muted">Applies to this invoice only. Outstanding {row.currency} {displayMoney(row.outstandingAmount)}.</p>
      </CommandForm>}
    </div>
  </>}</Resource></>;
}

function ShipmentSerials({ workOrderId }) {
  const resource = useResource(`/api/manufacturing/work-orders/${workOrderId}/output-units`);
  return <Resource resource={resource}>{({ data }) => { const available = data.filter(unit => unit.status === 'ACCEPTED'); return <><p>Select one accepted serial for each unit in this shipment. Already shipped and rejected units cannot be selected. The server checks current availability when saving.</p>{available.length ? <label className="pf-field">Output serials to ship (select multiple)<select name="serials" multiple size={Math.min(8, Math.max(3, available.length))} required defaultValue={[]}>{available.map(unit => <option key={unit._id} value={unit.serial}>{unit.serial}</option>)}</select></label> : <p>No accepted, unshipped serials remain for this work order. Select another source or refresh fulfillment.</p>}</>; }}</Resource>;
}
