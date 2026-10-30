import { AuditDetails } from './OperatorUi.jsx';
import { displayReference,operatorStatus } from './operator.mjs';
import { useEffect, useRef, useState } from 'react';
import { DocumentIssue } from './DocumentIssue.jsx';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, Resource, useResource } from './PortfolioWorkspace.jsx';
import { Lines } from './CommercialWorkspace.jsx';
import { procurementContent, procurementConversion } from './procurement.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import { InquiryCommand } from './InquiryWorkspace.jsx';

const base = '/portfolio/procurement';
function Input({ label, ...props }) { return <label className="pf-field">{label}<input {...props} /></label>; }
function ShortageSource({ sourceId }) {
  const resource = useResource(`/api/procurement/material-shortages/${sourceId}`);
  const [created, setCreated] = useState(null);
  return <Resource resource={resource}>{({ data: { snapshot: source, claims } }) => <section className="pf-panel">
    <h3>Material shortage: {source.materialLineId}</h3>
    <p>Evidence revision {source.revision}, observed {new Date(source.observedAt).toLocaleString('en-US')}. Required {source.requiredQuantity} {source.uom}; eligible stock {source.eligibleQuantity}; active claims at observation {source.activeClaimQuantity}; uncovered {source.shortageQuantity}. Claiming revalidates current demand and stock.</p>
    <AuditDetails action="procurement.read"><p>Source {source.sourceId}; hash {source.authorityHash}</p></AuditDetails>
    <InquiryCommand title="Create catalog PR from shortage" permission="procurement.write" action="/api/procurement/requests/from-shortage" build={(values, key) => ({ sourceId: source.sourceId, sourceRevision: source.revision, sourceHash: source.authorityHash, materialLineId: source.materialLineId, quantity: values.quantity, vendorId: values.vendorId, pricing: { unitPrice: values.unitPrice, currency: values.currency, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP' }, reason: values.reason, idempotencyKey: key })} onSaved={result => { setCreated(result); resource.reload(); }}>
      <WorkspaceField label="Vendor ID" name="vendorId" required />
      <WorkspaceField label={`Quantity (${source.uom})`} name="quantity" inputMode="decimal" required />
      <WorkspaceField label="Unit price" name="unitPrice" inputMode="decimal" required />
      <WorkspaceField as="select" label="Currency" name="currency">{['USD','EUR','GBP','IDR','JPY','KWD'].map(currency => <option key={currency}>{currency}</option>)}</WorkspaceField>
      <WorkspaceField label="Procurement reason" name="reason" minLength={3} maxLength={500} required />
    </InquiryCommand>
    {created && <p role="status"><Link to={`/portfolio/catalog-procurement/requests/${created.requestId}`}>Open created catalog purchase request</Link></p>}
    <h4>Claims</h4>{!claims.length ? <p>No procurement claims.</p> : claims.map(claim => <section key={`${claim.claimId}:${claim.version}`}><p>{claim.status}: {claim.quantity} {source.uom}. <Link to={`/portfolio/catalog-procurement/requests/${claim.requestId}`}>Open catalog PR</Link></p>
      {claim.status === 'ACTIVE' && <InquiryCommand title="Release unconverted claim" permission="procurement.write" action={`/api/procurement/material-shortages/${sourceId}/release`} build={(values, key) => ({ claimId: claim.claimId, expectedClaimVersion: claim.version, expectedRequestVersion: Number(values.expectedRequestVersion), reason: values.reason, idempotencyKey: key })} onSaved={resource.reload}>
        <p>Only a wholly unconverted PR can be cancelled. Read its current version before releasing. Converted commitments require an approved amendment.</p>
        <WorkspaceField label="Current PR version" name="expectedRequestVersion" type="number" min="1" step="1" required />
        <WorkspaceField label="Cancellation reason" name="reason" minLength={3} maxLength={500} required />
      </InquiryCommand>}
    </section>)}
    <button type="button" onClick={resource.reload}>Refresh shortage and claims</button>
  </section>}</Resource>;
}
function ShortageProcurement() {
  const [sources, setSources] = useState([]), [sourceId, setSourceId] = useState(''), [refreshed, setRefreshed] = useState(false);
  return <section className="pf-panel"><h2>Approved demand shortages</h2><p>Refresh evidence from approved internal production demand. Purchased material claims create catalog PRs. This evidence does not reserve stock. Requires manufacturing and catalog stock access.</p>
    <InquiryCommand title="Refresh shortage evidence" permission="procurement.write" action="/api/procurement/material-shortages/refresh" build={(values, key) => ({ demandId: values.demandId, expectedDemandVersion: Number(values.expectedDemandVersion), engineeringRevision: Number(values.engineeringRevision), expectedShortageRevision: Number(values.expectedShortageRevision), ...(values.materialLineId.trim() ? { materialLineId: values.materialLineId.trim() } : {}), reason: values.reason, idempotencyKey: key })} onSaved={result => { setSources(result.snapshots.map(source => source.sourceId)); setRefreshed(true); }}>
      <WorkspaceField label="Internal production demand ID" name="demandId" required />
      <WorkspaceField label="Engineering material line ID (optional: refresh one line)" name="materialLineId" hint="Use a line ID when material lines have different evidence revisions or a newly approved line needs its first snapshot." />
      <WorkspaceField label="Demand version" name="expectedDemandVersion" type="number" min="1" step="1" required />
      <WorkspaceField label="Approved engineering revision" name="engineeringRevision" type="number" min="1" step="1" required />
      <WorkspaceField label="Previous shortage revision (0 for first refresh)" name="expectedShortageRevision" type="number" min="0" step="1" defaultValue="0" required />
      <WorkspaceField label="Refresh reason" name="reason" minLength={3} maxLength={500} required />
    </InquiryCommand>
    {refreshed && !sources.length && <p role="status">No purchased material shortages were produced for this approved demand. Company output materials use manufacturing supply planning.</p>}
    <form className="pf-form" onSubmit={event => { event.preventDefault(); setSourceId(new FormData(event.currentTarget).get('sourceId')); }}><WorkspaceField label="Existing shortage source ID" name="sourceId" required /><button>Open shortage</button></form>
    {[...new Set([...sources, ...(sourceId ? [sourceId] : [])])].map(id => <ShortageSource key={id} sourceId={id} />)}
  </section>;
}
export function ProcurementList({ kind }) {
  const location = useLocation(), navigate = useNavigate();
  const cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/procurement/${kind}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const title = { vendors: 'Vendors', requests: 'Purchase requests', orders: 'Purchase orders' }[kind];
  return <><h1>{title}</h1>{kind === 'requests' && <ShortageProcurement />}<nav className="pf-actions" aria-label="Procurement"><Link to={`${base}/vendors`}>Vendors</Link><Link to={`${base}/requests`}>Purchase requests</Link><Link to={`${base}/orders`}>Purchase orders</Link></nav><p>Owned procurement documents. Issue is local only; no purchasing dispatch, stock receipt or payment occurs here.</p>{kind === 'requests' && <Link to={`${base}/requests/new`}>Create purchase request</Link>}<section className="pf-panel"><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No {title.toLowerCase()} in this plant yet. {kind === 'vendors' ? 'Create a vendor below.' : kind === 'requests' ? 'Create a request for an existing vendor.' : 'Approve and convert a purchase request first.'}</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><Link to={`${base}/${kind}/${row._id}`}>{row.name || displayReference(kind === "orders" ? "purchaseOrder" : "request",row)}</Link>{row.status && <span>{operatorStatus(row.status)}</span>}</li>)}</ul>}<div className="pf-actions">{cursor && <Link to={`${base}/${kind}`}>First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></>}</Resource></section>{kind === 'vendors' && <form className="pf-panel pf-form" onSubmit={async e => {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try { const { data } = await request('/api/procurement/vendors', { body }); navigate(`${base}/vendors/${data._id}`); }
    catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }}><h2>Create vendor</h2><Input label="Vendor name" name="name" required maxLength={200} /><Failure error={error} mutation /><button className="pf-primary" disabled={busy}>{busy ? 'Saving...' : 'Create vendor'}</button></form>}</>;
}
export function NewPurchaseRequest() {
  const navigate = useNavigate(), [count, setCount] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const lock = useRef(false);
  return <><h1>Create purchase request</h1><Link to={`${base}/vendors`}>Find vendor ID</Link><form className="pf-panel pf-form" onSubmit={async e => {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try { const { data } = await request('/api/procurement/requests', { body: procurementContent(values, count) }); navigate(`${base}/requests/${data._id}`); }
    catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }}><Input label="Vendor ID" name="vendorId" required /><p>Use exact decimal strings and one currency. Server applies NO_TAX and LINE_HALF_UP; no FX or UOM conversion.</p>{Array.from({ length: count }, (_, i) => <fieldset key={i}><legend>Line {i + 1}</legend><div className="pf-fields"><Input label="Description" name={`description${i}`} required maxLength={200} /><Input label="Quantity (exact decimal)" name={`quantity${i}`} inputMode="decimal" required /><Input label="UOM" name={`uom${i}`} pattern="[A-Z][A-Z0-9_]{0,15}" required /><Input label="Unit price (fixed scale)" name={`unitPrice${i}`} inputMode="decimal" required /><label className="pf-field">Currency<select name={`currency${i}`}>{['USD','EUR','GBP','IDR','JPY','KWD'].map(c => <option key={c}>{c}</option>)}</select></label></div></fieldset>)}<div className="pf-actions"><button type="button" disabled={busy || count >= 100} onClick={() => setCount(n => n + 1)}>Add line</button>{count > 1 && <button type="button" disabled={busy} onClick={() => setCount(n => n - 1)}>Remove last line</button>}</div><Failure error={error} mutation /><button className="pf-primary" disabled={busy}>{busy ? 'Saving...' : 'Save purchase request'}</button></form></>;
}
function RequestForQuote({ row, onSaved, cohort = 'LEGACY' }) {
  const apiRoot = cohort === 'CATALOG' ? '/api/catalog-procurement' : '/api/procurement', permission = cohort === 'CATALOG' ? 'catalog.write' : 'procurement.write';
  const history = row.rfqHistory || [];
  const open = history.filter(item => item.kind === 'RFQ_PREPARED' && !history.some(response => response.rfqId === item._id));
  return <section className="pf-panel"><h2>Requests for quotation</h2>
    <p>Prepare a local RFQ for this request's vendor and record the selected response. No external message is sent. Selected prices still require purchase request approval.</p>
    {!history.length ? <p>No RFQ history yet.</p> : <ol className="pf-list">{history.map(event => <li key={event._id}><strong>{event.kind === 'RFQ_PREPARED' ? 'RFQ prepared' : 'Response selected'}: {event.reference}</strong><span>{new Date(event.recordedAt).toLocaleString('en-US')}</span><Lines snapshot={event.snapshot} /><AuditDetails action="procurement.read"><p>Record {event._id}; request version {event.requestVersion}; actor {event.recordedBy}</p></AuditDetails></li>)}</ol>}
    {row.status === 'DRAFT' && !row.shortageCancellation && <>
      <InquiryCommand title="Prepare vendor RFQ" permission={permission} action={`${apiRoot}/requests/${row._id}/rfq`} build={(values, key) => ({ expectedVersion: row.version, reference: values.reference, idempotencyKey: key, ...(cohort === 'CATALOG' ? { reason: values.reason } : {}) })} onSaved={onSaved}>
        <WorkspaceField label="RFQ reference" name="reference" required maxLength={200} />
        {cohort === 'CATALOG' && <WorkspaceField label="RFQ reason" name="reason" required minLength={3} maxLength={500} />}
      </InquiryCommand>
      {open.map(rfq => <InquiryCommand key={rfq._id} title={`Record selected response for ${rfq.reference}`} permission={permission} action={`${apiRoot}/requests/${row._id}/rfq-response`} build={(values, key) => ({ expectedVersion: row.version, rfqId: rfq._id, reference: values.reference, idempotencyKey: key, ...(cohort === 'CATALOG' ? { reason: values.reason } : {}), prices: rfq.lineIds.map((lineId, index) => ({ lineId, unitPrice: values[`price${index}`], currency: values.currency })) })} onSaved={onSaved}>
        <WorkspaceField label="Vendor response reference" name="reference" required maxLength={200} />
        {cohort === 'CATALOG' && <WorkspaceField label="Selection reason" name="reason" required minLength={3} maxLength={500} />}
        <WorkspaceField as="select" label="Response currency" name="currency" defaultValue={rfq.snapshot.currency}>{['USD','EUR','GBP','IDR','JPY','KWD'].map(currency => <option key={currency}>{currency}</option>)}</WorkspaceField>
        {rfq.snapshot.lines.map((line, index) => <WorkspaceField key={rfq.lineIds[index]} label={`${line.description}, ${line.quantity} ${line.uom}: unit price`} name={`price${index}`} defaultValue={line.unitPrice} inputMode="decimal" required />)}
      </InquiryCommand>)}
    </>}
  </section>;
}
function VendorPromises({ order, onSaved, cohort = 'LEGACY' }) {
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const pending = useRef(null), attempt = useRef(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  async function submit(event) {
    event.preventDefault(); if (pending.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { ...values, expectedVersion: order.version, vendorId: order.vendorId };
    const signature = JSON.stringify(payload);
    if (attempt.current && attempt.current.signature !== signature) {
      setError(new Error('Check the recorded history before changing an unconfirmed submission. Refresh the order to start a new attempt.')); return;
    }
    if (!attempt.current) attempt.current = { signature, body: { ...payload, idempotencyKey: crypto.randomUUID() } };
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(null);
    try {
      await request(`${cohort === 'CATALOG' ? '/api/catalog-procurement' : '/api/procurement'}/orders/${order._id}/vendor-promise`, { body: attempt.current.body, signal: controller.signal });
      if (!controller.signal.aborted) { attempt.current = null; onSaved(); }
    } catch (err) { if (!controller.signal.aborted) setError(err); }
    finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }
  return <section className="pf-panel"><h2>Vendor promise history</h2>
    <p>Operator-recorded delivery dates. These dates do not change the issued order or prove vendor acknowledgement.</p>
    {!order.promiseHistory?.length ? <p>No delivery promises recorded.</p> : <ol className="pf-list">{order.promiseHistory.map(promise => <li key={promise._id}><strong>Promised: <time dateTime={promise.promisedAt}>{new Date(promise.promisedAt).toLocaleString('en-US')}</time></strong><span>{promise.reference}: {promise.reason}</span><span>Recorded: {new Date(promise.recordedAt).toLocaleString('en-US')}</span><AuditDetails action="procurement.read"><p>Recorded by {promise.recordedBy}</p></AuditDetails></li>)}</ol>}
    {['ISSUED', 'CONFIRMED'].includes(order.status) && <form className="pf-form" onSubmit={submit}>
      <WorkspaceField label="Promised delivery (UTC ISO)" name="promisedAt" placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" required />
      <WorkspaceField label="Vendor reference" name="reference" required maxLength={500} />
      <WorkspaceField label="Reason for this promise" name="reason" required maxLength={500} />
      <Failure error={error} mutation />
      <button className="pf-primary" disabled={busy || error?.status === 409}>{busy ? 'Recording promise...' : 'Record delivery promise'}</button>
    </form>}
  </section>;
}
export function PurchaseOrderAmendments({ row, cohort = 'LEGACY', onSaved }) {
  const [extra, setExtra] = useState([]);
  const typed = cohort === 'CATALOG', snapshot = typed ? row.content : row.snapshot;
  const apiRoot = typed ? '/api/catalog-procurement' : '/api/procurement', documentRevision = row.documentRevision || 1;
  const lineIds = typed ? snapshot.lines.map(line => line.lineId) : row.lineIds;
  if (!['ISSUED', 'CONFIRMED'].includes(row.status)) return null;
  return <section className="pf-panel"><h2>Approved purchase order revisions</h2>
    <p>Active document revision {documentRevision}. A draft requires separate approval and issue before it changes the commitment. Current support permits quantity increases and new lines. Reductions, retirement and repricing require the validated financial commitment reader and currently fail closed.</p>
    {Array.from({ length: documentRevision }, (_, index) => <DocumentIssue key={`${row._id}:${index + 1}`} kind={typed ? 'catalogPurchaseOrder' : 'purchaseOrder'} sourceId={row._id} sourceVersion={index + 1} />)}
    {lineIds && <InquiryCommand title="Draft PO amendment" permission={typed ? 'catalog.write' : 'procurement.write'} action={`${apiRoot}/orders/${row._id}/amendments`} build={(values, key) => ({ expectedVersion: row.version, baseDocumentRevision: documentRevision, reason: values.reason, idempotencyKey: key, lines: [...snapshot.lines.map((line, index) => ({ ...line, lineId: lineIds[index], quantity: values[`quantity${index}`] })), ...extra.map((lineId, index) => ({ lineId, quantity: values[`newQuantity${index}`], unitPrice: values[`newPrice${index}`], currency: snapshot.currency, ...(typed ? { itemId: values[`itemId${index}`], itemVersion: Number(values[`itemVersion${index}`]), itemRevision: Number(values[`itemRevision${index}`]) } : { description: values[`description${index}`], uom: values[`uom${index}`] }) }))] })} onSaved={onSaved}>
      {snapshot.lines.map((line, index) => <WorkspaceField key={lineIds[index]} label={`${line.description}: total commitment (${line.uom}), unit price ${line.currency} ${line.unitPrice}`} name={`quantity${index}`} defaultValue={line.quantity} inputMode="decimal" required />)}
      {extra.map((lineId, index) => <fieldset key={lineId}><legend>New commitment line {index + 1}</legend>{typed ? <><WorkspaceField label="Approved purchased item ID" name={`itemId${index}`} required /><WorkspaceField label="Item version" name={`itemVersion${index}`} type="number" min="1" required /><WorkspaceField label="Item revision" name={`itemRevision${index}`} type="number" min="1" required /></> : <><WorkspaceField label="Description" name={`description${index}`} maxLength={200} required /><WorkspaceField label="UOM" name={`uom${index}`} required /></>}<WorkspaceField label="New line quantity" name={`newQuantity${index}`} inputMode="decimal" required /><WorkspaceField label={`Unit price (${snapshot.currency})`} name={`newPrice${index}`} inputMode="decimal" required /></fieldset>)}
      <button type="button" disabled={snapshot.lines.length + extra.length >= (typed ? 20 : 100)} onClick={() => setExtra(values => [...values, crypto.randomUUID()])}>Append new line</button>
      <WorkspaceField label="Amendment reason" name="reason" minLength={3} maxLength={500} required />
    </InquiryCommand>}
    {!row.amendments?.length ? <p>No amendment history.</p> : row.amendments.map(amendment => <section key={amendment.amendmentId}><h3>{amendment.status}: {amendment.reason}</h3><p>Base revision {amendment.baseDocumentRevision}; proposed total {amendment.snapshot.currency} {amendment.snapshot.total}</p><AuditDetails action={typed ? 'catalog.read' : 'procurement.read'}><p>Amendment hash {amendment.amendmentHash}</p></AuditDetails>
      {amendment.baseDocumentRevision !== documentRevision && amendment.status !== 'ISSUED' ? <p>This amendment has a superseded base. Create a draft against the current revision.</p> : ['DRAFT', 'APPROVED'].includes(amendment.status) && <InquiryCommand title={amendment.status === 'DRAFT' ? 'Approve PO amendment' : 'Issue PO amendment'} permission={`${typed ? 'catalog' : 'procurement'}.${amendment.status === 'DRAFT' ? 'approve' : 'issue'}`} action={`${apiRoot}/orders/${row._id}/amendments/${amendment.amendmentId}/${amendment.status === 'DRAFT' ? 'approve' : 'issue'}`} build={(values, key) => ({ expectedVersion: row.version, baseDocumentRevision: documentRevision, amendmentHash: amendment.amendmentHash, reason: values.reason, idempotencyKey: key })} onSaved={onSaved}><WorkspaceField label="Decision reason" name="reason" minLength={3} maxLength={500} required /></InquiryCommand>}
    </section>)}
  </section>;
}
export function CatalogCommercialExtras({ row, kind, onSaved }) {
  const adapted = { ...row, snapshot: row.content, vendorId: row.content.vendorId };
  return kind === 'requests' ? <><RequestForQuote key={`rfq:${row.version}`} row={adapted} cohort="CATALOG" onSaved={onSaved} />{['APPROVED', 'CONVERTED'].includes(row.status) && <DocumentIssue kind="catalogPurchaseRequest" sourceId={row._id} sourceVersion={row.currentRevision} />}</> : <><VendorPromises key={`promise:${row.version}`} order={adapted} cohort="CATALOG" onSaved={onSaved} /><PurchaseOrderAmendments key={`amendment:${row.version}`} row={row} cohort="CATALOG" onSaved={onSaved} /></>;
}
export function ProcurementDetail({ kind }) {
  const { id } = useParams(), navigate = useNavigate();
  const resource = useResource(`/api/procurement/${kind}/${id}`);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const lock = useRef(false), attempt = useRef(null);
  const refresh = () => { setError(null); attempt.current = null; resource.reload(); };
  async function transition(action, row, values = {}) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try {
      if (action === 'convert' && !attempt.current) attempt.current = procurementConversion(row, crypto.randomUUID());
      const body = action === 'convert' ? attempt.current : { expectedVersion: row.version, ...values };
      const { data } = await request(`/api/procurement/${kind}/${id}/${action}`, { body });
      if (action === 'convert') navigate(`${base}/orders/${data._id}`); else resource.reload();
    } catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }
  return <><Link to={`${base}/${kind}`}>Back to {kind === 'orders' ? 'purchase orders' : kind === 'requests' ? 'purchase requests' : 'vendors'}</Link><Resource resource={resource}>{({ data:row }) => <><h1>{kind === 'vendors' ? row.name : kind === 'requests' ? 'Purchase request' : 'Purchase order'}</h1><p className="pf-reference">{displayReference(kind === "orders" ? "purchaseOrder" : kind === "requests" ? "request" : "vendor",row)}</p><AuditDetails action="procurement.read"><p className="pf-id">Document ID: {row._id} · Version {row.version}</p></AuditDetails><section className="pf-panel">{row.status && <p>Status: {operatorStatus(row.status)}</p>}<AuditDetails action="procurement.read"><p>Version: {row.version}</p></AuditDetails><button onClick={refresh}>Refresh record</button><Failure error={error} mutation retry={refresh} />{row.vendorId && <Link to={`${base}/vendors/${row.vendorId}`}>Open vendor</Link>}{row.requestId && <Link to={`${base}/requests/${row.requestId}`}>Open source purchase request</Link>}{row.orderId && <Link to={`${base}/orders/${row.orderId}`}>Open purchase order</Link>}{kind === 'vendors' && <Link to={`${base}/requests/new`}>Create purchase request</Link>}<div className="pf-actions">{kind === 'requests' && row.status === 'DRAFT' && <button className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition('approve',row)}>Approve purchase request</button>}{kind === 'requests' && row.status === 'APPROVED' && <button className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition('convert',row)}>Convert to purchase order</button>}{attempt.current && error && error.status !== 409 && <button disabled={busy} onClick={() => transition('convert',row)}>Retry same conversion</button>}{kind === 'orders' && row.status === 'DRAFT' && <button className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition('issue',row)}>Issue locally</button>}</div></section>{kind === 'orders' && ['ISSUED','CONFIRMED'].includes(row.status) && <PurchaseOrderAmendments key={`${row._id}:${row.version}`} row={row} onSaved={refresh} />}{kind === 'orders' && <VendorPromises key={`${row._id}:${row.version}`} order={row} onSaved={refresh} />}{kind === 'requests' && ['APPROVED', 'CONVERTED'].includes(row.status) && <DocumentIssue key={`pr:${row._id}`} kind="purchaseRequest" sourceId={row._id} />}{kind === 'requests' && <RequestForQuote key={`rfq:${row._id}:${row.version}`} row={row} onSaved={refresh} />}{row.snapshot && <section className="pf-panel"><h2>Document snapshot</h2><Lines snapshot={row.snapshot} /></section>}{row.approval && <section className="pf-panel"><h2>Approval record</h2><p>Approved at {new Date(row.approval.approvedAt).toLocaleString("en-US")}</p><AuditDetails action="procurement.read"><p className="pf-id">Approved by {row.approval.approvedBy}</p></AuditDetails></section>}{row.issuedAt && <><p>Issued locally at {new Date(row.issuedAt).toLocaleString("en-US")}</p><AuditDetails action="procurement.read"><p className="pf-id">Issued by {row.issuedBy}</p></AuditDetails></>}{kind === 'orders' && <p>Vendor confirmation is internal operator recording, not vendor login, signature, external acknowledgement or delivery proof.</p>}{kind === 'orders' && row.status === 'ISSUED' && <form className="pf-panel pf-form" onSubmit={e => { e.preventDefault(); transition('vendor-confirmation', row, { vendorId: row.vendorId, reference: new FormData(e.currentTarget).get('reference') }); }}><h2>Operator confirmation</h2><Input label="Operator-recorded reference" name="reference" required maxLength={200} /><button className="pf-primary" disabled={busy || error?.status === 409}>Record operator confirmation</button></form>}{row.confirmation && <section className="pf-panel"><h2>Operator-recorded confirmation</h2><p>{row.confirmation.reference}</p><p>Source: {row.confirmation.source}</p><p>Recorded at {new Date(row.confirmation.recordedAt).toLocaleString("en-US")}</p><AuditDetails action="procurement.read"><p className="pf-id">Recorded by {row.confirmation.recordedBy}</p></AuditDetails></section>}</>}</Resource></>;
}
