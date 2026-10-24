import { useContext, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { capabilityState } from './customer-service.mjs';
import { inquiryConversion, inquiryLines, inquiryPermission } from './inquiry.mjs';

const fields = [['itemCode', 'Item code'], ['description', 'Description'], ['quantity', 'Quantity (exact decimal)'], ['uom', 'UOM'], ['drawingNumber', 'Drawing number'], ['drawingRevision', 'Drawing revision']];
const currencies = ['USD', 'EUR', 'GBP', 'IDR', 'JPY', 'KWD'];
const Input = ({ label, ...props }) => <label className="pf-field">{label}<input required {...props} /></label>;

export function InquiryCommand({ title, permission, action, build, onSaved, children }) {
  const identity = useContext(IdentityContext), allowed = capabilityState(inquiryPermission(permission), identity?.permissions);
  const lock = useRef(false), attempt = useRef(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const uncertain = error && (!error.status || error.status >= 500) && attempt.current;
  const denied = !allowed.enabled || error?.status === 403;
  async function send(body) {
    if (lock.current || denied) return;
    lock.current = true; setBusy(true); setError(null);
    try { const result = await request(action, { body }); attempt.current = null; onSaved?.(result.data); }
    catch (e) { setError(e); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (busy || uncertain || denied) return;
    attempt.current = build(Object.fromEntries(new FormData(event.currentTarget)), crypto.randomUUID());
    send(attempt.current);
  }}><h2>{title}</h2><fieldset disabled={busy || Boolean(uncertain) || denied || error?.status === 409}>{children}</fieldset>
    <Failure error={error} mutation />
    {denied && <p role="status">Access denied. Requires {permission} in this plant.</p>}
    {uncertain && <p role="status">The result is uncertain. Retry the retained request without changing its key or source revision.</p>}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || Boolean(uncertain) || denied || error?.status === 409}>{busy ? 'Saving...' : title}</button>{uncertain && <button type="button" disabled={busy || denied} onClick={() => send(attempt.current)}>Retry same request</button>}</div>
  </form>;
}

export function InquirySource({ lines }) {
  return <ol className="pf-list">{lines.map((line, i) => <li key={line.lineId || i}><strong>{line.itemCode}: {line.description}</strong><span>Quantity: {line.quantity} {line.uom}</span><span>Drawing: {line.drawingNumber} · Revision {line.drawingRevision}</span>{line.lineId && <span className="pf-id">Source line: {line.lineId}</span>}</li>)}</ol>;
}

function InquiryAccountSelect() {
  const accounts = useResource('/api/crm/accounts?limit=100', true);
  return <Resource resource={accounts}>{({ data }) => data.length ? <label className="pf-field">Customer account<select name="accountId" required defaultValue=""><option value="">Select existing customer</option>{data.map(a => <option key={a._id} value={a._id}>{a.name} ({a._id})</option>)}</select></label> : <p>No customer accounts in this plant. Create an account first.</p>}</Resource>;
}

export function InquiryAccountField({ canReadAccounts }) {
  return canReadAccounts ? <InquiryAccountSelect /> : <><Input label="Known customer account ID" name="accountId" /><p>Enter the ID of an existing customer in this plant. Your role cannot browse customer accounts.</p></>;
}

function SourceForm({ inquiry, onSaved }) {
  const identity = useContext(IdentityContext), canReadAccounts = capabilityState('crm.read', identity?.permissions).enabled;
  const latest = inquiry?.revisions.at(-1), [count, setCount] = useState(latest?.lines.length || 1);
  return <InquiryCommand title={inquiry ? 'Save inquiry revision' : 'Save inquiry'} permission="inquiry.write" action={inquiry ? `/api/commercial/inquiries/${inquiry._id}/revisions` : '/api/commercial/inquiries'} build={(v, key) => ({ ...(inquiry ? { expectedVersion: inquiry.version } : { accountId: v.accountId }), lines: inquiryLines(v, count, latest?.lines), idempotencyKey: key })} onSaved={onSaved}>
    {!inquiry && <InquiryAccountField canReadAccounts={canReadAccounts} />}
    <p>Drawing numbers and revisions are source metadata, not an engineering BOM or release. No prices are required for an inquiry.</p>
    {Array.from({ length: count }, (_, i) => <fieldset key={i}><legend>Inquiry line {i + 1}</legend><div className="pf-fields">{fields.map(([field, label]) => <Input key={field} label={label} name={`${field}${i}`} defaultValue={latest?.lines[i]?.[field]} inputMode={field === 'quantity' ? 'decimal' : undefined} maxLength={field === 'description' ? 200 : 100} />)}</div></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={count >= 100} onClick={() => setCount(n => n + 1)}>Add inquiry line</button>{count > 1 && <button type="button" onClick={() => setCount(n => n - 1)}>Remove last inquiry line</button>}</div>
  </InquiryCommand>;
}

export function Inquiries() {
  const cursor = new URLSearchParams(useLocation().search).get('cursor');
  const resource = useResource(`/api/commercial/inquiries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Inquiries</h1><Link to="/portfolio/inquiries/new">Create inquiry</Link><section className="pf-panel"><button type="button" onClick={resource.reload}>Refresh inquiries</button><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No inquiries in this plant. Create an inquiry for an existing customer.</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><Link to={`/portfolio/inquiries/${row._id}`}>{row._id}</Link><span>Stage: {row.stage} · Version {row.version} · Revision {row.revisions.at(-1).number}</span><Link to={`/portfolio/accounts/${row.accountId}`}>Open customer account</Link></li>)}</ul>}<div className="pf-actions">{cursor && <Link to="/portfolio/inquiries">First page</Link>}{page?.nextCursor && <Link to={`?cursor=${encodeURIComponent(page.nextCursor)}`}>Next page</Link>}</div></>}</Resource></section></>;
}

export function NewInquiry() {
  const navigate = useNavigate();
  return <><h1>Create inquiry</h1><Link to="/portfolio/inquiries">Back to inquiries</Link><Link to="/portfolio/accounts">Manage customer accounts</Link><SourceForm onSaved={row => navigate(`/portfolio/inquiries/${row._id}`)} /></>;
}

function InquiryConversionForm({ inquiry, onSaved }) {
  const latest = inquiry.revisions.at(-1);
  return <InquiryCommand title="Convert inquiry to quote" permission="inquiry.convert" action={`/api/commercial/inquiries/${inquiry._id}/convert`} build={(v, k) => inquiryConversion(inquiry, v, k)} onSaved={onSaved}>
    <p>Source revision {latest.number} is frozen. The server copies its customer, item, quantity, UOM and drawing fields. Enter commercial terms only. One inquiry creates one quote.</p>
    <Input label="Expires at (UTC ISO)" name="expiresAt" placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" />
    <label className="pf-field">Tax policy<select name="taxPolicy"><option value="NO_TAX">NO_TAX</option><option value="FIXTURE_VAT_11_V1">FIXTURE_VAT_11_V1 (11% fixture, not statutory)</option></select></label>
    <p>Exact fixed-scale prices only. One currency across all lines; no FX. Server calculates LINE_HALF_UP totals. Fixture VAT is not statutory or tax advice.</p>
    {latest.lines.map((line, i) => <fieldset key={line.lineId}><legend>Price for {line.itemCode} · Source line {line.lineId}</legend><p>{line.description}: {line.quantity} {line.uom}, drawing {line.drawingNumber} revision {line.drawingRevision}</p><div className="pf-fields"><Input label="Unit price (fixed scale)" name={`unitPrice${i}`} inputMode="decimal" /><label className="pf-field">Currency<select name={`currency${i}`}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label></div></fieldset>)}
  </InquiryCommand>;
}

export function Inquiry() {
  const { id } = useParams(), resource = useResource(`/api/commercial/inquiries/${id}`);
  return <><Link to="/portfolio/inquiries">Back to inquiries</Link><Resource resource={resource}>{({ data: row }) => <><h1>Inquiry</h1><p className="pf-id">Inquiry ID: {row._id}</p><section className="pf-panel"><p>Stage: {row.stage}</p><p>Version: {row.version}</p><p>Revision: {row.revisions.at(-1).number}</p><Link to={`/portfolio/accounts/${row.accountId}`}>Open customer account</Link><button type="button" onClick={resource.reload}>Refresh record</button>{row.quoteId && <Link to={`/portfolio/quotes/${row.quoteId}`}>Open converted quote</Link>}</section>
    <div className="pf-columns"><section className="pf-panel"><h2>Inquiry revisions</h2>{row.revisions.map(rev => <section key={rev.number}><h3>Source revision {rev.number}</h3><InquirySource lines={rev.lines} /></section>)}</section><section className="pf-panel"><h2>Stage history</h2><ol className="pf-list">{row.history.map((entry, i) => <li key={`${row._id}:${i}`}><strong>{entry.from || 'Created'} to {entry.to}</strong><span>{entry.reason}</span><span>Changed by {entry.actorId}</span><time dateTime={entry.occurredAt}>{entry.occurredAt}</time></li>)}</ol></section></div>
    {row.stage === 'DRAFT' ? <SourceForm key={`source:${row.version}`} inquiry={row} onSaved={resource.reload} /> : <p>Source content is frozen after submission. Commercial revisions cannot rewrite the inquiry.</p>}
    {['DRAFT', 'SUBMITTED'].includes(row.stage) && <InquiryCommand key={`stage:${row.version}`} title={row.stage === 'DRAFT' ? 'Submit inquiry' : 'Start inquiry review'} permission="inquiry.transition" action={`/api/commercial/inquiries/${id}/stage`} build={(v, k) => ({ expectedVersion: row.version, toStage: row.stage === 'DRAFT' ? 'SUBMITTED' : 'IN_REVIEW', reason: v.reason, idempotencyKey: k })} onSaved={resource.reload}><label className="pf-field">Reason<textarea name="reason" required maxLength={1000} rows={3} /></label></InquiryCommand>}
    {row.stage === 'IN_REVIEW' && <InquiryConversionForm key={`convert:${row.version}`} inquiry={row} onSaved={resource.reload} />}
  </>}</Resource></>;
}
