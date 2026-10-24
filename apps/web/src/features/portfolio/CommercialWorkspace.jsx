import { useRef, useState } from 'react';
import { OrderStockExceptions } from './HoldsWorkspace.jsx';
import { DocumentIssue } from './DocumentIssue.jsx';
import { MonetarySummary } from './MonetarySummary.jsx';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, Resource, useResource } from './PortfolioWorkspace.jsx';
import { quoteContent, conversionAttempt } from './commercial.mjs';

function Input({ label, ...props }) { return <label className="pf-field">{label}<input {...props} /></label>; }
export function Lines({ snapshot }) {
  return <><ol className="pf-list">{snapshot.lines.map((line, i) => <li key={i}><strong>{line.description}</strong><span>Quantity: {line.quantity} {line.uom}</span><span>Unit price: {line.currency} {line.unitPrice}</span></li>)}</ol><p>Rounding: {snapshot.roundingPolicy}</p><MonetarySummary record={{...snapshot, currency: snapshot.currency || snapshot.lines[0]?.currency}} /></>;
}
function ContentForm({ quote, onSaved }) {
  const [count, setCount] = useState(1), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const latest = quote?.revisions.at(-1);
  return <form className="pf-panel pf-form" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget)); lock.current = true; setBusy(true); setError(null);
    try {
      const body = quoteContent(values, count);
      const result = await request(quote ? `/api/commercial/quotes/${quote._id}/revisions` : '/api/commercial/quotes', { body: quote ? { ...body, expectedVersion: quote.version } : { ...body, accountId: values.accountId } });
      onSaved(result.data);
    } catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }}><h2>{quote ? 'New revision' : 'Quote content'}</h2>{!quote && <Input label="Account ID" name="accountId" required />}
    <Input label="Expires at (UTC ISO)" name="expiresAt" required defaultValue={latest?.expiresAt} placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" />
    <label className="pf-field">Tax policy<select name="taxPolicy" defaultValue={latest?.taxPolicy || 'NO_TAX'} disabled={busy}><option value="NO_TAX">NO_TAX</option><option value="FIXTURE_VAT_11_V1">FIXTURE_VAT_11_V1 (11% fixture, not statutory)</option></select></label>
    <p>Original decimal strings are retained. All lines must share one currency. LINE_HALF_UP and the selected policy are applied by the server. Fixture VAT is not a statutory rate or tax advice. No FX is implied.</p>
    {Array.from({ length: count }, (_, i) => <fieldset key={i}><legend>Line {i + 1}</legend><div className="pf-fields"><Input label="Description" name={`description${i}`} required maxLength={200} /><Input label="Quantity (exact decimal)" name={`quantity${i}`} inputMode="decimal" required /><Input label="UOM" name={`uom${i}`} pattern="[A-Z][A-Z0-9_]{0,15}" required /><Input label="Unit price (fixed scale)" name={`unitPrice${i}`} inputMode="decimal" required /><label className="pf-field">Currency<select name={`currency${i}`}>{['USD','EUR','GBP','IDR','JPY','KWD'].map(c => <option key={c}>{c}</option>)}</select></label></div></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={count >= 100 || busy} onClick={() => setCount(n => n + 1)}>Add line</button>{count > 1 && <button type="button" disabled={busy} onClick={() => setCount(n => n - 1)}>Remove last line</button>}</div>
    <Failure error={error} mutation retry={quote ? onSaved : undefined} /><button className="pf-primary" disabled={busy || error?.status === 409}>{busy ? 'Saving...' : quote ? 'Save revision' : 'Save quote'}</button>
  </form>;
}
export function Quotes() {
  const location = useLocation(), cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/commercial/quotes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Quotes</h1><Link to="/portfolio/quotes/new">Create quote</Link><section className="pf-panel"><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No quotes in this plant. Create a quote for an existing account.</p> : <ul className="pf-list">{data.map(q => <li key={q._id}><Link to={`/portfolio/quotes/${q._id}`}>{q._id}</Link><span>{q.status} · Version {q.version} · Revision {q.revisions.at(-1).number}</span><MonetarySummary record={q.revisions.at(-1)} /></li>)}</ul>}<div className="pf-actions">{cursor && <Link to="/portfolio/quotes">First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></>}</Resource></section></>;
}
export function NewQuote() {
  const navigate = useNavigate();
  return <><h1>Create quote</h1><Link to="/portfolio/accounts">Find account ID</Link><ContentForm onSaved={q => navigate(`/portfolio/quotes/${q._id}`)} /></>;
}
export function Quote() {
  const { id } = useParams(), resource = useResource(`/api/commercial/quotes/${id}`);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [order, setOrder] = useState(null);
  const attempt = useRef(null), lock = useRef(false);
  const refresh = () => { setError(null); attempt.current = null; resource.reload(); };
  async function transition(action, quote) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try {
      if (action === 'convert' && !attempt.current) attempt.current = conversionAttempt(quote, crypto.randomUUID());
      const body = action === 'convert' ? attempt.current : { expectedVersion: quote.version, revision: quote.revisions.at(-1).number };
      const result = await request(`/api/commercial/quotes/${id}/${action}`, { body });
      if (action === 'convert') setOrder(result.data);
      resource.reload();
    } catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }
  return <><Link to="/portfolio/quotes">Back to quotes</Link><Resource resource={resource}>{({ data:q }) => <><h1>Quote</h1><p className="pf-id">Quote ID: {q._id}</p><section className="pf-panel"><p>Status: {q.status}</p><p>Version: {q.version}</p><p>Revision: {q.revisions.at(-1).number}</p><Link to={`/portfolio/accounts/${q.accountId}`}>Open related account</Link><button type="button" onClick={refresh}>Refresh record</button><Failure error={error} mutation retry={refresh} /><div className="pf-actions">{[['DRAFT','approve','Approve revision'],['APPROVED','accept','Record acceptance'],['ACCEPTED','convert','Convert to sales order']].filter(([state]) => q.status === state).map(([, action, label]) => <button key={action} className="pf-primary" disabled={busy || error?.status === 409} onClick={() => transition(action,q)}>{busy ? 'Saving...' : label}</button>)}{attempt.current && error && error.status !== 409 && <button disabled={busy} onClick={() => transition('convert',q)}>Retry same conversion</button>}</div><p>Acceptance records the authenticated internal decision, not an external signature.</p></section>
    <div className="pf-columns"><section className="pf-panel"><h2>Revision history</h2>{q.revisions.map(rev => <section key={rev.number}><h3>Revision {rev.number}</h3><p>Expires: {rev.expiresAt}</p><Lines snapshot={rev} /></section>)}</section><section className="pf-panel"><h2>Approval history</h2>{!q.approvals?.length ? <p>No revisions approved yet.</p> : q.approvals.map((a,i) => <p key={i}>Revision {a.revision} approved by {a.approvedBy} at {a.approvedAt}</p>)}{q.acceptedRevision && <p>Accepted revision: {q.acceptedRevision}</p>}</section></div>
    {q.approvals?.map(a => <DocumentIssue key={`${q._id}:${a.revision}`} kind="quote" sourceId={q._id} sourceVersion={a.revision} />)}
    {q.status !== 'CONVERTED' && <ContentForm key={q.version} quote={q} onSaved={refresh} />}
    {order && <section className="pf-panel" data-order-id={order._id}><h2>Sales order snapshot</h2><p className="pf-id">{order._id}</p><Lines snapshot={order.snapshot} /><Link to={`/portfolio/orders/${order._id}`}>Open sales order</Link></section>}
    {!order && q.orderId && <Link to={`/portfolio/orders/${q.orderId}`}>Open persisted sales order</Link>}
  </>}</Resource></>;
}
export function Orders() {
  const location = useLocation(), cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/commercial/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Sales orders</h1><section className="pf-panel"><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No sales orders yet. Convert an accepted quote first.</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><Link to={`/portfolio/orders/${row._id}`}>{row._id}</Link><span>{row.status} · Quote revision {row.quoteRevision}</span><MonetarySummary record={row.snapshot} /></li>)}</ul>}<div className="pf-actions">{cursor && <Link to="/portfolio/orders">First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></>}</Resource></section></>;
}
export function Order() {
  const { id } = useParams();
  const resource = useResource(`/api/commercial/orders/${id}`);
  return <><h1>Sales order</h1><Link to="/portfolio/orders">Back to sales orders</Link><Resource resource={resource}>{({data}) => <><OrderStockExceptions orderId={data._id} /><OrderContent order={data} /></>}</Resource></>;
}
function OrderContent({order}) { return <section className="pf-panel"><p className="pf-id">Order ID: {order._id}</p><p>Status: {order.status}</p><p>Quote revision: {order.quoteRevision}</p><Link to={`/portfolio/fulfillment/orders/${order._id}`}>Manage fulfillment</Link><Lines snapshot={order.snapshot} /><Link to={`/portfolio/quotes/${order.quoteId}`}>Open source quote</Link><Link to={`/portfolio/accounts/${order.accountId}`}>Open related account</Link></section>; }
