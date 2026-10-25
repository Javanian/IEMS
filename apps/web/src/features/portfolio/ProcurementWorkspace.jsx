import { AuditDetails } from './OperatorUi.jsx';
import { displayReference,operatorStatus } from './operator.mjs';
import { useRef, useState } from 'react';
import { DocumentIssue } from './DocumentIssue.jsx';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, Resource, useResource } from './PortfolioWorkspace.jsx';
import { Lines } from './CommercialWorkspace.jsx';
import { procurementContent, procurementConversion } from './procurement.mjs';

const base = '/portfolio/procurement';
function Input({ label, ...props }) { return <label className="pf-field">{label}<input {...props} /></label>; }
export function ProcurementList({ kind }) {
  const location = useLocation(), navigate = useNavigate();
  const cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/procurement/${kind}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const title = { vendors: 'Vendors', requests: 'Purchase requests', orders: 'Purchase orders' }[kind];
  return <><h1>{title}</h1><nav className="pf-actions" aria-label="Procurement"><Link to={`${base}/vendors`}>Vendors</Link><Link to={`${base}/requests`}>Purchase requests</Link><Link to={`${base}/orders`}>Purchase orders</Link></nav><p>Owned procurement documents. Issue is local only; no purchasing dispatch, stock receipt or payment occurs here.</p>{kind === 'requests' && <Link to={`${base}/requests/new`}>Create purchase request</Link>}<section className="pf-panel"><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No {title.toLowerCase()} in this plant yet. {kind === 'vendors' ? 'Create a vendor below.' : kind === 'requests' ? 'Create a request for an existing vendor.' : 'Approve and convert a purchase request first.'}</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><Link to={`${base}/${kind}/${row._id}`}>{row.name || displayReference(kind === "orders" ? "purchaseOrder" : "request",row)}</Link>{row.status && <span>{operatorStatus(row.status)}</span>}</li>)}</ul>}<div className="pf-actions">{cursor && <Link to={`${base}/${kind}`}>First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></>}</Resource></section>{kind === 'vendors' && <form className="pf-panel pf-form" onSubmit={async e => {
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
  return <><Link to={`${base}/${kind}`}>Back to {kind === 'orders' ? 'purchase orders' : kind === 'requests' ? 'purchase requests' : 'vendors'}</Link><Resource resource={resource}>{({ data:row }) => <><h1>{kind === 'vendors' ? row.name : kind === 'requests' ? 'Purchase request' : 'Purchase order'}</h1><p className="pf-reference">{displayReference(kind === "orders" ? "purchaseOrder" : kind === "requests" ? "request" : "vendor",row)}</p><AuditDetails action="procurement.read"><p className="pf-id">Document ID: {row._id} · Version {row.version}</p></AuditDetails><section className="pf-panel">{row.status && <p>Status: {operatorStatus(row.status)}</p>}<AuditDetails action="procurement.read"><p>Version: {row.version}</p></AuditDetails><button onClick={refresh}>Refresh record</button><Failure error={error} mutation retry={refresh} />{row.vendorId && <Link to={`${base}/vendors/${row.vendorId}`}>Open vendor</Link>}{row.requestId && <Link to={`${base}/requests/${row.requestId}`}>Open source purchase request</Link>}{row.orderId && <Link to={`${base}/orders/${row.orderId}`}>Open purchase order</Link>}{kind === 'vendors' && <Link to={`${base}/requests/new`}>Create purchase request</Link>}<div className="pf-actions">{kind === 'requests' && row.status === 'DRAFT' && <button className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition('approve',row)}>Approve purchase request</button>}{kind === 'requests' && row.status === 'APPROVED' && <button className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition('convert',row)}>Convert to purchase order</button>}{attempt.current && error && error.status !== 409 && <button disabled={busy} onClick={() => transition('convert',row)}>Retry same conversion</button>}{kind === 'orders' && row.status === 'DRAFT' && <button className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition('issue',row)}>Issue locally</button>}</div></section>{kind === 'orders' && ['ISSUED','CONFIRMED'].includes(row.status) && <DocumentIssue key={row._id} kind="purchaseOrder" sourceId={row._id} />}{row.snapshot && <section className="pf-panel"><h2>Document snapshot</h2><Lines snapshot={row.snapshot} /></section>}{row.approval && <section className="pf-panel"><h2>Approval record</h2><p>Approved at {new Date(row.approval.approvedAt).toLocaleString("en-US")}</p><AuditDetails action="procurement.read"><p className="pf-id">Approved by {row.approval.approvedBy}</p></AuditDetails></section>}{row.issuedAt && <><p>Issued locally at {new Date(row.issuedAt).toLocaleString("en-US")}</p><AuditDetails action="procurement.read"><p className="pf-id">Issued by {row.issuedBy}</p></AuditDetails></>}{kind === 'orders' && <p>Vendor confirmation is internal operator recording, not vendor login, signature, external acknowledgement or delivery proof.</p>}{kind === 'orders' && row.status === 'ISSUED' && <form className="pf-panel pf-form" onSubmit={e => { e.preventDefault(); transition('vendor-confirmation', row, { vendorId: row.vendorId, reference: new FormData(e.currentTarget).get('reference') }); }}><h2>Operator confirmation</h2><Input label="Operator-recorded reference" name="reference" required maxLength={200} /><button className="pf-primary" disabled={busy || error?.status === 409}>Record operator confirmation</button></form>}{row.confirmation && <section className="pf-panel"><h2>Operator-recorded confirmation</h2><p>{row.confirmation.reference}</p><p>Source: {row.confirmation.source}</p><p>Recorded at {new Date(row.confirmation.recordedAt).toLocaleString("en-US")}</p><AuditDetails action="procurement.read"><p className="pf-id">Recorded by {row.confirmation.recordedBy}</p></AuditDetails></section>}</>}</Resource></>;
}
