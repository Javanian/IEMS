import { useContext, useEffect, useRef, useState } from 'react';
import { ShipmentDelivery, ShipmentReturns } from './DeliveryWorkspace.jsx';
import { AuditDetails } from './OperatorUi.jsx';
import { displayReference, operatorStatus } from './operator.mjs';
import { DocumentIssue } from './DocumentIssue.jsx';
import { MonetarySummary } from './MonetarySummary.jsx';
import { SourceLineage } from './SourceLineage.jsx';
import { MaterialTrace } from './MaterialTrace.jsx';
import { Link, useLocation, useParams } from 'react-router-dom';
import { portfolioRequest as request, validMoney, displayMoney } from './client.mjs';
import { Resource, Failure, useResource, IdentityContext } from './PortfolioWorkspace.jsx';
import { capabilityState, permissionReason } from './customer-service.mjs';
import { shipmentCommand, invoiceCommand, paymentCommand, validQuantity, dispatchHandling, fulfillmentHint } from './fulfillment.mjs';
import { PurchasedFulfillmentLink,PurchasedFulfillmentOrder } from './PurchasedFulfillmentUi.jsx';
import { purchasedDocumentAccess,purchasedHint } from './purchased-fulfillment.mjs';
import WorkspaceTable from '../../components/tables/WorkspaceTable.jsx';

const Boundary = () => <p className="pf-tag">Synthetic data · Operator-recorded documents</p>;
const money = (currency, amount) => <span className="pf-money">{currency} {displayMoney(amount)}</span>;
const TITLES = { shipments: 'Shipments', invoices: 'Invoices', payments: 'Payments' };

// `permission` (optional) names the action; a server 403, or a session capability list without it, disables submit with a specific reason.
export function CommandForm({ title, action, build, children, onSaved, permission, locked = '', onLockChange }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [saved, setSaved] = useState(false);
  const attempt = useRef(null), lock = useRef(false);
  const mounted = useRef(false), errorSummary = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  const identity = useContext(IdentityContext);
  const allowed = permission ? capabilityState(permission, identity?.permissions) : { enabled: true };
  const deniedReason = permission && (error?.status === 403 ? permissionReason(permission) : !allowed.enabled ? allowed.reason : '');
  const siblingLocked = Boolean(locked && locked !== title);
  const reasonId = deniedReason ? `denied-${action.replace(/[^a-z0-9]/gi, '-')}` : undefined;
  async function send(body) {
    if (lock.current || deniedReason || siblingLocked) return; lock.current = true; setBusy(true); setError(null);
    try { const result = await request(action, { body }); if (!mounted.current) return; attempt.current = null; onLockChange?.(''); setSaved(true); onSaved?.(result.data); }
    catch (e) { if (mounted.current) setError(e); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function submit(event) {
    event.preventDefault(); setSaved(false);
    if (attempt.current || deniedReason || siblingLocked) return;
    try { const data = new FormData(event.currentTarget), values = Object.fromEntries(data); if (event.currentTarget.querySelector('[name="serials"]')) values.serials = data.getAll('serials'); attempt.current = build(values, crypto.randomUUID()); onLockChange?.(title); send(attempt.current); }
    catch (e) { attempt.current = null; setError(e); }
  }
  const retryable = error && attempt.current && (!error.status || error.status >= 500);
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={submit}><h2>{title}</h2><fieldset className="pf-form" disabled={busy || !!attempt.current || !!deniedReason || siblingLocked}>{children}</fieldset>
    {error && <div ref={errorSummary} tabIndex={-1}>{error.status === undefined ? <div className="pf-error" role="alert"><p>{error.message}</p></div> : <Failure error={error} mutation />}</div>}
    {(purchasedHint(error) || fulfillmentHint(error)) && <p role="alert">{purchasedHint(error) || fulfillmentHint(error)}</p>}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || !!attempt.current || Boolean(deniedReason) || siblingLocked} aria-describedby={reasonId}>{busy ? 'Saving...' : title}</button>{retryable && <button type="button" disabled={busy} onClick={() => send(attempt.current)}>Retry same request</button>}{attempt.current && error && <button type="button" disabled={busy} onClick={() => { attempt.current = null; onLockChange?.(''); setError(null); onSaved?.(); }}>Discard command and refresh</button>}{deniedReason && <div id={reasonId}><p className="pf-disabled-reason">You do not have permission to perform this action.</p><details><summary>Technical details</summary><p>{deniedReason}</p></details></div>}</div>
    {siblingLocked && <p className="pf-disabled-reason">Another fulfillment command is retained. Resolve it before starting this action.</p>}
    {attempt.current && error && <p>The command and its serial selection are retained. Retry the same request after an uncertain response, or discard it and review the refreshed record before changing inputs.</p>}
    <p role="status">{saved ? 'Saved.' : ''}</p></form>;
}
export function Input({ label, name, ...props }) { return <label className="pf-field">{label}<input name={name} required {...props} /></label>; }

function Tabs({ kind }) {
  return <nav className="pf-tabs" aria-label="Fulfillment">{Object.entries(TITLES).map(([k, t]) => <Link key={k} aria-current={kind === k ? 'page' : undefined} to={`/portfolio/fulfillment/${k}`}>{t}</Link>)}<PurchasedFulfillmentLink /><Link to="/portfolio/orders">Sales orders</Link></nav>;
}
function rowSummary(kind, row) {
  if (kind === 'shipments' && row.sourceKind === 'CUSTOMER_ASSET_RETURN') return <>{row.quantity} {row.uom} · Customer asset {row.serial || row.assetId} · <Link to={`/portfolio/repair/cases/${row.caseId}`}>Open repair</Link></>;
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
        {!data.length ? <p>No {kind} yet. Open a sales order and choose Manage fulfillment.</p> : <ul className="pf-list pf-rows">{data.map(row => <li key={row._id}><Link to={`/portfolio/fulfillment/${kind}/${row._id}`}>{row.reference || displayReference(kind, row)}</Link><span className="pf-status">{operatorStatus(row.status)}</span><div>{rowSummary(kind, row)}</div></li>)}</ul>}
        <div className="pf-actions">{cursor && <Link to="?">First page</Link>}{page?.nextCursor && <Link to={`?cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</Link>}</div>
      </>}</Resource></section></>;
}

function Balances({ order, resource }) {
  return <section className="pf-panel"><h2>Line balances</h2><Resource resource={resource}>{({ data }) => <div className="pf-table-wrap"><table className="pf-balance"><thead><tr><th>Line</th><th className="pf-num">Ordered</th><th className="pf-num">Shipped</th><th className="pf-num">Invoiced</th></tr></thead><tbody>{data.lines.map(l => <tr key={l.lineIndex}><td>{l.lineIndex + 1}. {order.snapshot.lines[l.lineIndex]?.description}</td><td className="pf-num">{l.orderedQuantity} {l.uom}</td><td className="pf-num">{l.shippedQuantity} {l.uom}</td><td className="pf-num">{l.invoicedQuantity} {l.uom}</td></tr>)}</tbody></table></div>}</Resource></section>;
}

export function FulfillmentOrder() {
  const query=new URLSearchParams(useLocation().search);
  return query.get('catalog')==='1' ? <PurchasedFulfillmentOrder /> : <LegacyFulfillmentOrder />;
}
function LegacyFulfillmentOrder() {
  const { id } = useParams(), r = useResource(`/api/commercial/orders/${id}`), balances = useResource(`/api/fulfillment/orders/${id}/balances`);
  const [sourceType, setSourceType] = useState('WORK_ORDER'), [lineIndex, setLineIndex] = useState(0), [sourceId, setSourceId] = useState('');
  const [commandLocked,setCommandLock]=useState(''), commandLock=useRef('');
  const setLocked=value=>{commandLock.current=value;setCommandLock(value);};
  const sources = useResource(sourceType === 'WORK_ORDER' ? '/api/manufacturing/work-orders?limit=100' : '/api/warehouse/reservations?limit=100', true);
  const shipments = useResource('/api/fulfillment/shipments?limit=100', true);
  const packing = useResource(`/api/fulfillment/packing?limit=100&salesOrderId=${id}`, true);
  const [dispatchStep, setDispatchStep] = useState('pick');
  useEffect(() => { setLocked(''); setSourceId(''); setLineIndex(0); }, [id]);
  const refresh = () => { if(commandLock.current)return; r.reload(); balances.reload(); sources.reload(); shipments.reload(); packing.reload(); };
  const eligible = s => s.salesOrderId === id && s.lineIndex === lineIndex && (sourceType === 'WORK_ORDER' ? s.status === 'QC_COMPLETED' : ['RESERVED', 'PARTIALLY_SHIPPED'].includes(s.status));
  return <><Link to={`/portfolio/orders/${id}`}>Back to sales order</Link><Resource resource={r}>{({ data: order }) => <>
    <h1>Order fulfillment {order.orderNumber || order._id.slice(0, 8)}</h1><Boundary />
    <div className="pf-summary"><span className="pf-status">{order.status}</span><span>{order.snapshot.currency}</span><AuditDetails action="fulfillment.read"><p>Version: {order.version}</p></AuditDetails></div>
    <div className="pf-actions"><Link to={`/portfolio/accounts/${order.accountId}`}>Open account</Link><Link to="/portfolio/fulfillment/invoices">Open invoices</Link><button type="button" disabled={!!commandLocked} onClick={refresh}>Refresh fulfillment</button></div>
    <Balances order={order} resource={balances} />
    <OrderCompletion key={`closure-${order._id}`} orderId={order._id} locked={commandLocked} />
    <AccountSettlement key={`account-${order.accountId}`} accountId={order.accountId} currency={order.snapshot.currency} locked={commandLocked} onLockChange={setLocked} onSaved={refresh} />
    <section className="pf-panel"><h2>Prepare dispatch</h2><label className="pf-field">Dispatch step<select value={dispatchStep} disabled={!!commandLocked} onChange={event => setDispatchStep(event.target.value)}><option value="pick">Record a pick for packing</option><option value="ship">Record direct dispatch</option></select></label><p>A pick records the selected goods. Packing records their package reference. Stock availability is checked again when goods are dispatched.</p></section>
    <div className="pf-columns">
      <CommandForm key={`${id}-${dispatchStep}`} title={dispatchStep === 'pick' ? 'Record pick' : 'Record shipment'} permission="fulfillment.ship" action={dispatchStep === 'pick' ? '/api/fulfillment/packing' : '/api/fulfillment/shipments'} locked={commandLocked} onLockChange={setLocked} build={(v, k) => { if (!v.sourceId) throw Error('Select a source.'); if (!validQuantity(v.quantity)) throw Error('Enter a positive quantity with up to 6 decimals.'); if (sourceType === 'WORK_ORDER' && sources.data?.find(source => source._id === v.sourceId)?.serialized && !v.serials?.length) throw Error('Select accepted output serials for this shipment.'); return shipmentCommand(order, v, k); }} onSaved={refresh}>
        <label className="pf-field">Order line<select name="lineIndex" value={lineIndex} onChange={e => { setLineIndex(Number(e.target.value)); setSourceId(''); }}>{order.snapshot.lines.map((l, i) => <option key={i} value={i}>{i + 1}. {l.description} ({l.quantity} {l.uom})</option>)}</select></label>
        <label className="pf-field">Source type<select name="sourceType" value={sourceType} onChange={e => { setSourceType(e.target.value); setSourceId(''); }}><option value="WORK_ORDER">QC-completed work order</option><option value="RESERVATION">Warehouse reservation</option></select></label>
        <Resource resource={sources}>{({ data }) => { const rows = data.filter(eligible), selected = rows.find(s => s._id === sourceId); return rows.length ? <><label className="pf-field">Source<select name="sourceId" required value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">Select source</option>{rows.map(s => <option key={s._id} value={s._id}>{sourceType === 'WORK_ORDER' ? `Work order ${s._id.slice(0, 8)} · accepted ${s.qc?.acceptedQuantity} ${s.uom}` : `Reservation ${s._id.slice(0, 8)} · ${s.remainingQuantity ?? s.quantity} ${s.uom}`}</option>)}</select></label>{sourceType === 'WORK_ORDER' && selected?.serialized && <ShipmentSerials key={`${selected._id}-${order.version}`} workOrderId={selected._id} />}</> : <p>No eligible {sourceType === 'WORK_ORDER' ? 'QC-completed work orders' : 'reservations'} for this line.</p>; }}</Resource>
        <Input label={`Quantity (${order.snapshot.lines[lineIndex]?.uom})`} name="quantity" inputMode="decimal" autoComplete="off" />
        <Input label="Dispatch reference" name="reference" maxLength={200} autoComplete="off" />{dispatchStep === 'ship' && <DispatchHandling />}
      </CommandForm>
      <CommandForm key={`${id}-invoice`} title="Issue invoice" permission="fulfillment.invoice" action="/api/fulfillment/invoices" locked={commandLocked} onLockChange={setLocked} build={(v, k) => { if (!v.shipmentId) throw Error('Select a shipment.'); if (!validQuantity(v.invoiceQuantity)) throw Error('Enter a positive quantity with up to 6 decimals.'); return invoiceCommand(order, { shipmentId: v.shipmentId, quantity: v.invoiceQuantity, dueAt: v.dueAt }, k); }} onSaved={refresh}>
        <Resource resource={shipments}>{({ data }) => { const rows = data.filter(s => s.salesOrderId === id); return rows.length ? <label className="pf-field">Shipment<select name="shipmentId" required defaultValue=""><option value="">Select shipment</option>{rows.map(s => <option key={s._id} value={s._id}>{s.reference} · {s.quantity} {s.uom}</option>)}</select></label> : <p>No shipments yet. Record a shipment first.</p>; }}</Resource>
        <Input label="Quantity to invoice" name="invoiceQuantity" inputMode="decimal" autoComplete="off" />
        <label className="pf-field">Due date (UTC, optional)<input name="dueAt" type="datetime-local" /></label>
        <p className="pf-muted">Billed from shipped quantity at the order price in {order.snapshot.currency}.</p>
      </CommandForm>
    </div>
    <Resource resource={packing}>{({ data }) => <section><h2>Pick and pack records</h2>{!data.length && <p>No picks recorded for this order.</p>}<div className="pf-columns">{data.filter(row => row.salesOrderId === id).map(row => <section key={row._id} className="pf-panel"><h3>{row.reference}</h3><p>{row.quantity} {row.uom} · {row.status}</p>{row.sources.map(part => <p key={part.sourceId}>{part.sourceType} · {part.quantity} {row.uom}{part.serials?.length ? ` · ${part.serials.join(', ')}` : ''}</p>)}{row.status === 'PICKED' && <CommandForm title={`Pack ${row.reference}`} permission="fulfillment.ship" action={`/api/fulfillment/packing/${row._id}/pack`} locked={commandLocked} onLockChange={setLocked} build={(values, key) => ({ expectedVersion: row.version, packageReference: values.packageReference, idempotencyKey: key })} onSaved={refresh}><Input name="packageReference" label="Package reference" maxLength={200} /></CommandForm>}{row.status === 'PACKED' && <CommandForm title={`Dispatch ${row.reference}`} permission="fulfillment.ship" action="/api/fulfillment/shipments" locked={commandLocked} onLockChange={setLocked} build={(values, key) => ({ salesOrderId: order._id, expectedVersion: order.version, lineIndex: row.lineIndex, uom: row.uom, sources: row.sources, packingId: row._id, expectedPackingVersion: row.version, reference: values.reference, ...dispatchHandling(values), idempotencyKey: key })} onSaved={refresh}><p>Package {row.packageReference}. Dispatch the exact packed quantities and serials.</p><Input name="reference" label="Dispatch reference" maxLength={200} /><DispatchHandling /></CommandForm>}{row.shipmentId && <Link to={`/portfolio/fulfillment/shipments/${row.shipmentId}`}>Open dispatched shipment</Link>}</section>)}</div></section>}</Resource>
  </>}</Resource></>;
}

export function FulfillmentDetail({ kind }) {
  const { id } = useParams(), r = useResource(`/api/fulfillment/${kind}/${id}`);
  const identity=useContext(IdentityContext),documentAccess=purchasedDocumentAccess(identity?.permissions);
  const name = { shipments: 'Shipment', invoices: 'Invoice', payments: 'Payment' }[kind];
  const [commandLocked,setCommandLocked]=useState(''),commandLock=useRef('');
  const setLocked=value=>{commandLock.current=value;setCommandLocked(value);};
  const onDeliveryLock=value=>setLocked(value?'Confirm delivery':'');
  const refresh=()=>{if(!commandLock.current)r.reload();};
  return <><Link to={`/portfolio/fulfillment/${kind}`}>Back to {kind}</Link><Resource resource={r}>{({ data: row }) => <>
    <h1>{name} {row.reference || row._id.slice(0, 8)}</h1><Boundary />
    <div className="pf-summary"><span className="pf-status">{operatorStatus(row.status)}</span>{kind === 'shipments' && <strong>{row.quantity} {row.uom}</strong>}{kind === 'payments' && <strong>{money(row.currency, row.amount)}</strong>}{kind === 'invoices' && <span>Quote revision {row.quoteRevision || 'not recorded'}</span>}</div>
    <div className="pf-actions">{row.salesOrderId && <Link to={`/portfolio/fulfillment/orders/${row.salesOrderId}${['PURCHASED_SHIPMENT_V1','PURCHASED_INVOICE_V1','PURCHASED_PAYMENT_V1','MANUFACTURED_SHIPMENT_V1','CATALOG_INVOICE_V2','CATALOG_PAYMENT_V2'].includes(row.schema)?'?catalog=1':''}`}>Open order fulfillment</Link>}{identity?.permissions?.includes('crm.read') && <Link to={`/portfolio/accounts/${row.accountId}`}>Open account</Link>}<button type="button" disabled={!!commandLocked} onClick={refresh}>Refresh record</button></div>
    {kind === 'shipments' && <><SourceLineage line={row} /><ShipmentDelivery key={row._id} shipment={row} onLockChange={onDeliveryLock} disabled={!!commandLocked && commandLocked !== 'Confirm delivery'} /><ShipmentReturns key={`returns-${row._id}`} shipment={row} locked={commandLocked} onLockChange={setLocked} /></>}
    {kind === 'invoices' && <AccountSettlement key={`settlement-${row._id}`} accountId={row.accountId} currency={row.currency} invoice={row} locked={commandLocked} onLockChange={setLocked} onSaved={refresh} />}
    {kind === 'payments' && <p>Settlement: {row.settlementKind || 'CASH'}{row.settlementKind === 'CREDIT' ? ' · Credit adjustment; no cash received.' : row.settlementKind === 'DEPOSIT' ? ' · Applied from an earlier deposit; no new cash receipt.' : ' · Operator-recorded cash receipt.'}</p>}
    <fieldset disabled={!!commandLocked} data-fulfillment-documents>{kind === 'invoices' && <DocumentIssue key={row._id} kind="invoice" sourceId={row._id} {...(row.schema==='PURCHASED_INVOICE_V1'?documentAccess:{})} />}
    {kind === 'shipments' && row.status === 'SHIPPED' && <DocumentIssue key={row._id} kind="shipment" sourceId={row._id} {...(row.schema==='PURCHASED_SHIPMENT_V1'?documentAccess:{})} />}</fieldset>
    <div className="pf-columns">
      <section className="pf-panel">
        {kind === 'invoices' && <><h2>Balance</h2><MonetarySummary record={row} /><p>Credits applied: {row.creditedAmount === undefined ? 'Not recorded' : `${row.currency} ${row.creditedAmount}`} · Due date: {row.dueAt || 'Not recorded'}</p><p>Posted line contents are immutable. Payment and credit allocations update the settlement projection.</p></>}
        <h2>Linked records</h2>
        <ul className="pf-list">
          {kind === 'shipments' && row.sources.map((s, i) => <li key={i}>{s.sourceType === 'COMPANY_OUTPUT' ? <Link to={`/portfolio/company-stock/receipts/${s.companyReceiptId}`}>Manufactured company stock</Link> : s.sourceType==='CATALOG_RESERVATION'?<PurchasedShipmentSource source={s} orderId={row.salesOrderId} />:<Link to={s.sourceType === 'WORK_ORDER' ? `/portfolio/manufacturing/work-orders/${s.sourceId}` : `/portfolio/warehouse/reservations/${s.sourceId}`}>{s.sourceType === 'WORK_ORDER' ? 'Work order' : 'Reservation'} {s.sourceId.slice(0, 8)}</Link>}<span>{s.quantity} {row.uom}</span>{s.serials && <p>Shipped serials: {s.serials.join(', ')}</p>}<>{s.genealogy && <div><Link to={`/portfolio/manufacturing/work-orders/${s.genealogy.workOrderId}#lot-genealogy`}>Frozen lot genealogy revision {s.genealogy.revision}</Link><AuditDetails action="fulfillment.read"><p className="pf-id">Content hash: {s.genealogy.contentHash}</p></AuditDetails></div>}</><>{s.installation && <div><Link to={`/portfolio/manufacturing/work-orders/${s.installation.workOrderId}#component-installation`}>Frozen received installation revision {s.installation.revision}</Link><AuditDetails action="fulfillment.read"><p className="pf-id">Installation content hash: {s.installation.contentHash}</p></AuditDetails></div>}</>{s.sourceType === 'COMPANY_OUTPUT' && <AuditDetails action="fulfillment.read"><p>Frozen genealogy and descendant evidence</p><pre>{JSON.stringify(s.graph, null, 2)}</pre></AuditDetails>}{!['CATALOG_RESERVATION', 'COMPANY_OUTPUT'].includes(s.sourceType)&&<MaterialTrace trace={s.materialTrace} output={s.sourceType === 'WORK_ORDER'} />}</li>)}
          {kind === 'invoices' && row.lines.map((l, i) => <li key={i}><Link to={`/portfolio/fulfillment/shipments/${l.shipmentId}`}>Shipment {l.shipmentId.slice(0, 8)}</Link><span>{l.description} · {l.quantity} {l.uom} × {money(l.currency, l.unitPrice)} = {money(l.currency, l.amount)}</span><SourceLineage line={l} /></li>)}
          {kind === 'invoices' && row.allocations.map((a, i) => <li key={`p${i}`}><Link to={`/portfolio/fulfillment/payments/${a.paymentId}`}>Payment {a.paymentId.slice(0, 8)}</Link><span>{money(row.currency, a.amount)}</span></li>)}
          {kind === 'payments' && row.allocations.map((a, i) => <li key={i}><Link to={`/portfolio/fulfillment/invoices/${a.invoiceId}`}>Invoice {a.invoiceId.slice(0, 8)}</Link><span>{money(a.currency, a.amount)} · invoice now {a.invoiceStatus}</span></li>)}
        </ul>
        <h2>History</h2><p className="pf-muted">Created {new Date(row.createdAt).toLocaleString('en-US')}</p><AuditDetails action="fulfillment.read"><p>Version: {row.version}</p></AuditDetails>
      </section>
      {kind === 'invoices' && /[1-9]/.test(row.outstandingAmount) && <CommandForm key={`cash-${row._id}`} title="Allocate payment" permission="fulfillment.pay" action="/api/fulfillment/payments" locked={commandLocked} onLockChange={setLocked} build={(v, k) => { if (!validMoney(v.amount, row.currency) || !/[1-9]/.test(v.amount)) throw Error(`Enter a positive ${row.currency} amount at the currency scale.`); return paymentCommand(row, v, k); }} onSaved={refresh}>
        <Input label={`Amount (${row.currency})`} name="amount" inputMode="decimal" autoComplete="off" />
        <Input label="Payment reference" name="reference" maxLength={200} autoComplete="off" />
        <p className="pf-muted">Applies to this invoice only. Outstanding {row.currency} {displayMoney(row.outstandingAmount)}.</p>
      </CommandForm>}
    </div>
  </>}</Resource></>;
}

export function AccountSettlement({ accountId, currency, invoice, locked, onLockChange, onSaved }) {
  const ledger = useResource(`/api/fulfillment/accounts/${accountId}/ledger`);
  const refresh = () => { ledger.reload(); onSaved?.(); };
  const amount = values => { if (!validMoney(values.amount, currency) || !/[1-9]/.test(values.amount)) throw Error(`Enter a positive ${currency} amount at its currency scale.`); return values.amount; };
  return <section className="pf-panel"><h2>Account settlement and aging</h2><Resource resource={ledger}>{({ data: view }) => <>
    <p>As of {new Date(view.asOf).toLocaleString('en-US')}. Amounts stay in their recorded currency. Fixture tax is not statutory compliance.</p>
    {!view.complete && <p role="alert">This account exceeds the bounded ledger view. Totals and aging are unavailable; displayed rows are incomplete.</p>}
    <WorkspaceTable caption="Invoice aging" rowKey={row => row._id} rows={view.invoices} columns={[
      { key: 'invoice', label: 'Invoice', render: row => <Link to={`/portfolio/fulfillment/invoices/${row._id}`}>{displayReference('invoice', row)}</Link> },
      { key: 'outstanding', label: 'Outstanding', numeric: true, render: row => `${row.currency} ${row.outstandingAmount}` },
      { key: 'dueAt', label: 'Due date (UTC)', render: row => row.dueAt || 'Not recorded' },
      { key: 'agingBucket', label: 'Aging', render: row => row.agingBucket.replaceAll('_', ' ') }
    ]} empty="No invoices recorded for this account." />
    {view.aging && Object.entries(view.aging).map(([code, buckets]) => <p key={code}>{code}: {Object.entries(buckets).map(([bucket, value]) => `${bucket.replaceAll('_', ' ')} ${value}`).join(' · ')}</p>)}
    <h3>Deposits</h3>{!view.deposits.length ? <p>No unallocated deposit receipts recorded.</p> : <ul className="pf-list">{view.deposits.map(row => <li key={row._id}><strong>{row.reference}</strong><span>Received {row.currency} {row.amount} · Applied {row.allocatedAmount} · Available {row.availableAmount}</span></li>)}</ul>}
    <CommandForm key={`deposit-${accountId}`} title="Record deposit" permission="fulfillment.pay" action="/api/fulfillment/deposits" locked={locked} onLockChange={onLockChange} build={(values, key) => ({ accountId, currency, amount: amount(values), reference: values.reference, idempotencyKey: key })} onSaved={refresh}><Input name="amount" label={`Deposit received (${currency})`} inputMode="decimal" /><Input name="reference" label="Deposit receipt reference" maxLength={200} /><p>Records an account-bound receipt. It is available for an explicit invoice allocation and does not invent a sales order.</p></CommandForm>
    {invoice && /[1-9]/.test(invoice.outstandingAmount) && <div className="pf-columns">
      <CommandForm key={`apply-${invoice._id}-${invoice.version}`} title="Apply deposit" permission="fulfillment.pay" action="/api/fulfillment/payments" locked={locked} onLockChange={onLockChange} build={(values, key) => { const deposit = view.deposits.find(row => row._id === values.depositId); if (!deposit) throw Error('Select a deposit receipt.'); amount(values); return { ...paymentCommand(invoice, values, key), settlementKind: 'DEPOSIT', depositId: deposit._id, expectedDepositVersion: deposit.version }; }} onSaved={refresh}><label className="pf-field">Deposit receipt<select name="depositId" required defaultValue=""><option value="">Select deposit</option>{view.deposits.filter(row => row.currency === currency && /[1-9]/.test(row.availableAmount)).map(row => <option key={row._id} value={row._id}>{row.reference} · {row.currency} {row.availableAmount}</option>)}</select></label><Input name="amount" label={`Amount to apply (${currency})`} inputMode="decimal" /><Input name="reference" label="Allocation reference" maxLength={200} /></CommandForm>
      <CommandForm key={`credit-${invoice._id}-${invoice.version}`} title="Issue credit adjustment" permission="fulfillment.invoice" action="/api/fulfillment/payments" locked={locked} onLockChange={onLockChange} build={(values, key) => { amount(values); return { ...paymentCommand(invoice, values, key), settlementKind: 'CREDIT', creditReason: values.creditReason }; }} onSaved={refresh}><Input name="amount" label={`Credit amount (${currency})`} inputMode="decimal" /><Input name="reference" label="Credit note reference" maxLength={200} /><Input name="creditReason" label="Approved adjustment reason" maxLength={200} /><p>Requires both invoice and payment authority. Reduces receivables without recording cash or changing posted invoice lines.</p></CommandForm>
    </div>}
    <button type="button" disabled={!!locked} onClick={ledger.reload}>Refresh account ledger</button>
  </>}</Resource></section>;
}

export function OrderCompletion({ orderId, locked }) {
  const resource = useResource(`/api/fulfillment/orders/${orderId}/closure`);
  const labels = { HISTORY_LIMIT: 'The history exceeds this bounded view; completion is unknown.', DELIVERY_NOT_CONFIRMED: 'Confirm actual customer delivery for every shipment.', QUARANTINED_RETURNS: 'Returned customer goods remain in quarantine and require disposition review.', OPEN_RECEIVABLE: 'Settle the remaining invoice balances.', LEGACY_POSTING_REVIEW: 'An authorized reviewer must verify legacy invoice posting evidence.', UNSHIPPED_QUANTITY: 'Dispatch the remaining order quantity.', UNINVOICED_QUANTITY: 'Invoice the remaining order quantity.', ORDER_LINE_EVIDENCE_REQUIRED: 'Review the missing order line evidence.' };
  return <section className="pf-panel"><h2>Fulfillment completion</h2><Resource resource={resource}>{({ data: view }) => <><p className="pf-status">{view.status === 'FULFILLED_EVIDENCED' ? 'Fulfilled with delivery and settlement evidence' : view.complete ? 'Open obligations' : 'Completion unknown'}</p>{view.reasons.length > 0 ? <ul>{view.reasons.map(reason => <li key={reason}>{labels[reason] || reason}</li>)}</ul> : <p>Every ordered quantity is dispatched and invoiced, all delivery evidence is confirmed, invoice balances are settled, and no customer return is awaiting disposition.</p>}<p>As of {new Date(view.asOf).toLocaleString('en-US')}. This view checks recorded obligations; shipment dispatch alone does not establish completion.</p></>}</Resource><button type="button" disabled={!!locked} onClick={resource.reload}>Refresh completion evidence</button></section>;
}

export function ManufacturedDispatch({ orderId, locked, onLockChange, onSaved }) {
  const identity = useContext(IdentityContext);
  return identity?.permissions?.includes('company.stock.read') ? <ManufacturedDispatchData orderId={orderId} locked={locked} onLockChange={onLockChange} onSaved={onSaved} /> : <section className="pf-panel"><h2>Manufactured stock dispatch</h2><p>Company stock read permission is required to inspect eligible manufactured serials.</p></section>;
}

function ManufacturedDispatchData({ orderId, locked, onLockChange, onSaved }) {
  const resource = useResource(`/api/fulfillment/manufactured/orders/${orderId}`), identity = useContext(IdentityContext);
  const canUseStock = ['company.stock.reserve', 'company.stock.issue'].every(action => identity?.permissions?.includes(action));
  const refresh = () => { resource.reload(); onSaved?.(); };
  return <section className="pf-panel"><h2>Manufactured stock dispatch</h2><Resource resource={resource}>{({ data: view }) => <>
    <p>Select actual company-owned serials released from production. Dispatch freezes their approved ancestry and records canonical stock use atomically.</p>
    {!canUseStock && <p role="status">Dispatch requires company stock reserve and issue permissions as well as fulfillment shipping permission.</p>}
    {!view.lines.length && <p>This order has no catalog manufactured lines.</p>}
    {view.lines.map(line => <section key={line.lineIndex}><h3>{line.lineIndex + 1}. {line.description}</h3><p>Ordered {line.quantity} {line.uom} · Dispatched {line.shippedQuantity} {line.uom}</p>
      {!line.sourcesComplete && <p role="status">The source list is bounded. Only the displayed stock receipts have been inspected.</p>}
      {!line.sources.length && <p>No stored manufactured stock matches this item and revision.</p>}
      {line.sources.map(source => { const available = source.units.filter(unit => unit.eligible && unit.status === 'AVAILABLE'); return <section key={source._id} className="pf-panel"><h4>{source.itemSnapshot.code} · {source.locationSnapshot.code || 'Qualified company location'}</h4><p>Available {source.availableQuantity} {source.uom} · Eligible {source.eligibleQuantity} {source.uom}</p><Link to={`/portfolio/company-stock/receipts/${source._id}`}>Review stock and genealogy</Link>{source.blockers.length > 0 && <p role="status">Dispatch blocked: {source.blockers.join(', ').replaceAll('_', ' ').toLowerCase()}.</p>}
        {available.length > 0 && source.canDispatch && canUseStock ? <CommandForm key={`${source._id}-${source.version}`} title={`Pack and dispatch line ${line.lineIndex + 1} from ${source._id.slice(0, 8)}`} permission="fulfillment.ship" action="/api/fulfillment/manufactured-shipments" locked={locked} onLockChange={onLockChange} build={(values, key) => { const selected = available.filter(unit => values.serials?.includes(unit._id)); if (!selected.length) throw Error('Select the actual manufactured serials in this package.'); return { salesOrderId: view.salesOrder._id, expectedVersion: view.salesOrder.version, lineIndex: line.lineIndex, uom: line.uom, reference: values.reference, packageReference: values.packageReference, ...dispatchHandling(values), sources: [{ companyReceiptId: source._id, expectedStockVersion: source.version, units: selected.map(unit => ({ companyUnitId: unit._id, expectedUnitVersion: unit.version })) }], idempotencyKey: key }; }} onSaved={refresh}>
          <label className="pf-field">Actual serials packed<select name="serials" multiple required size={Math.max(2, Math.min(8, available.length))}>{available.map(unit => <option key={unit._id} value={unit._id}>{unit.serial}</option>)}</select></label><Input name="packageReference" label="Package reference" minLength={3} maxLength={200} /><Input name="reference" label="Dispatch reference" minLength={3} maxLength={200} /><DispatchHandling /><p>Each selected serial is one {line.uom}. Other available serials remain in company stock.</p>
        </CommandForm> : <p>No eligible dispatch action for this receipt under the current stock state and permissions.</p>}
      </section>; })}
    </section>)}
    <h3>Manufactured dispatch records</h3>{!view.shipments.length ? <p>No manufactured shipments recorded for this order.</p> : <ul className="pf-list">{view.shipments.map(row => <li key={row._id}><Link to={`/portfolio/fulfillment/shipments/${row._id}`}>{row.reference}</Link><span>{row.quantity} {row.uom} · {row.status} · Package {row.packageReference}</span></li>)}</ul>}
    <button type="button" disabled={!!locked} onClick={resource.reload}>Refresh manufactured stock</button>
  </>}</Resource></section>;
}

export function DispatchHandling() {
  const identity = useContext(IdentityContext);
  return ['quality.read', 'maintenance.read'].every(action => identity?.permissions?.includes(action)) ? <DispatchEquipmentChoices /> : <p>If handling equipment is used, an operator with quality and maintenance read access must record its operating window.</p>;
}

function DispatchEquipmentChoices() {
  const resources = useResource('/api/repair/quality/resources', true), [equipmentId, setEquipmentId] = useState('');
  return <details><summary>Handling equipment used for this dispatch</summary><p>Record equipment only when it is used. Current holds, calibration and maintenance availability are checked in the dispatch transaction.</p><Resource resource={resources}>{({ data }) => {
    const rows = data.filter(row => row.resourceType === 'EQUIPMENT' && row.label), selected = rows.find(row => row.resourceId === equipmentId);
    return <><label className="pf-field">Handling equipment<select name="equipmentId" value={equipmentId} onChange={event => setEquipmentId(event.target.value)}><option value="">No equipment recorded</option>{rows.map(row => <option key={row.resourceId} value={row.resourceId}>{row.label}{row.disabled ? ' · Disabled' : ''}</option>)}</select></label>{selected && <><input type="hidden" name="equipmentVersion" value={selected.version} /><DispatchEquipmentWindow key={selected.resourceId} equipmentId={selected.resourceId} /></>}</>;
  }}</Resource></details>;
}

function DispatchEquipmentWindow({ equipmentId }) {
  const maintenance = useResource(`/api/repair/maintenance/equipment/${equipmentId}`);
  return <Resource resource={maintenance}>{({ data }) => <><input type="hidden" name="maintenanceVersion" value={data.version} /><Input label="Handling window starts (UTC)" name="handlingFrom" type="datetime-local" step={60} /><Input label="Handling window ends (UTC)" name="handlingUntil" type="datetime-local" step={60} /><Input label="Equipment minutes required" name="requiredMinutes" inputMode="numeric" pattern="[1-9][0-9]{0,6}" /></>}</Resource>;
}

function ShipmentSerials({ workOrderId }) {
  const resource = useResource(`/api/manufacturing/work-orders/${workOrderId}/output-units`);
  return <Resource resource={resource}>{({ data }) => { const available = data.filter(unit => unit.status === 'ACCEPTED'); return <><p>Select one accepted serial for each unit in this shipment. Already shipped and rejected units cannot be selected. The server checks current availability when saving.</p>{available.length ? <label className="pf-field">Output serials to ship (select multiple)<select name="serials" multiple size={Math.min(8, Math.max(3, available.length))} required defaultValue={[]}>{available.map(unit => <option key={unit._id} value={unit.serial}>{unit.serial}</option>)}</select></label> : <p>No accepted, unshipped serials remain for this work order. Select another source or refresh fulfillment.</p>}</>; }}</Resource>;
}

function PurchasedShipmentSource({source,orderId}) {
  const identity=useContext(IdentityContext),permissions=identity?.permissions||[];
  return <><div className="pf-actions">{permissions.includes('catalog.stock.read')&&permissions.includes('fulfillment.read')?<Link to={`/portfolio/fulfillment/orders/${orderId}?catalog=1`}>Purchased reservation {displayReference('reservation',source.sourceId)}</Link>:<span>Purchased stock reservation</span>}{permissions.includes('catalog.qc.read')&&<Link to={`/portfolio/catalog-disposition/receipts/${source.receiptId}`}>Review received stock and QC</Link>}</div>{source.materialTrace?.lotNumber&&<p>Lot {source.materialTrace.lotNumber} · Heat {source.materialTrace.heatNumber}</p>}<AuditDetails action="fulfillment.read"><pre>{JSON.stringify(source,null,2)}</pre></AuditDetails></>;
}
