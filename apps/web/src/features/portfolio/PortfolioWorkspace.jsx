import { createContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { portfolioRequest as request, errorMessage, validMoney, displayMoney } from './client.mjs';
import './portfolio.css';
import { collectPages } from './pagination.mjs';
import { Inquiries, NewInquiry, Inquiry } from './InquiryWorkspace.jsx';
import { Quotes, NewQuote, Quote, Order, Orders } from './CommercialWorkspace.jsx';
import { ProcurementList, NewPurchaseRequest, ProcurementDetail } from './ProcurementWorkspace.jsx';
import { Bins } from './WmsWorkspace.jsx';
import { EngineeringList, EngineeringNew, EngineeringDetail } from './EngineeringWorkspace.jsx';
import { WarehouseList, WarehouseDetail, ReceiveOrder } from './WarehouseWorkspace.jsx';
import { WorkOrderList, WorkOrderDetail, PlanWorkOrders } from './ManufacturingWorkspace.jsx';
import { FulfillmentList, FulfillmentOrder, FulfillmentDetail } from './FulfillmentWorkspace.jsx';
import { ServiceInbox, ServiceTicket, ServiceConversation } from './CustomerServiceWorkspace.jsx';
import { RepairList, RepairCase, RepairIntake } from './RepairWorkspace.jsx';
import { HoldList } from './HoldsWorkspace.jsx';
import { ServiceBindings, ServiceBinding } from './ServiceBindingsWorkspace.jsx';
import { InventoryMaster } from './InventoryMasterWorkspace.jsx';
import { InternalProduction } from './InternalProductionWorkspace.jsx';
import { CatalogProcurement } from './CatalogProcurementWorkspace.jsx';

// Signed-in identity for permission-aware controls; data.permissions are the effective actions at the selected plant.
export const IdentityContext = createContext(null);


export function Failure({ error, retry, mutation = false }) {
  if (!error) return null;
  return <div className="pf-error" role="alert"><p>{errorMessage(error, mutation)}</p>{error.code && <p>Code: {error.code}</p>}{error.status === 401 ? <Link to="/portfolio/login">Sign in again</Link> : retry && <button type="button" onClick={retry}>Refresh and retry</button>}</div>;
}
export function useResource(path, allPages = false) {
  const [result, setResult] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ loading: true });
    const load = allPages ? collectPages(path, request, { signal: controller.signal }) : request(path, { signal: controller.signal });
    load.then(value => { if (!controller.signal.aborted) setResult({ ...value, loading: false }); }).catch(error => { if (!controller.signal.aborted) setResult({ error, loading: false }); });
    return () => controller.abort();
  }, [path, attempt, allPages]);
  return { ...result, reload: () => setAttempt(n => n + 1) };
}
export function Resource({ resource, children }) {
  if (resource.loading) return <p role="status">Loading current records...</p>;
  if (resource.error) return <Failure error={resource.error} retry={resource.reload} />;
  return children(resource);
}
function Field({ label, name, ...props }) {
  return <label className="pf-field">{label}<input name={name} {...props} /></label>;
}
function MutationForm({ title, submitLabel, children, save, onSaved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState('');
  const lock = useRef(false);
  return <form className="pf-panel pf-form" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return;
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    lock.current = true; setBusy(true); setError(null); setNotice('');
    try { const result = await save(values); form.reset(); setNotice('Saved to the plant server.'); onSaved?.(result.data); }
    catch (err) { setError(err); }
    finally { lock.current = false; setBusy(false); }
  }}><h2>{title}</h2>{children}<Failure error={error} mutation /><p role="status">{notice}</p><button className="pf-primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button></form>;
}
function Login({ onLogin }) {
  const navigate = useNavigate();
  const location = useLocation();
  return <div className="pf-login"><section><h1>Portfolio sign in</h1><p>Use your portfolio identity to manage accounts and opportunities in your assigned plant.</p><p>This workspace uses a server session, separate from the operations application.</p></section><MutationForm title="Your portfolio identity" submitLabel="Sign in" save={async values => { await request('/api/session/login', { body: values }); return request('/api/session/me'); }} onSaved={identity => { onLogin(identity); navigate(location.state?.from || '/portfolio/accounts', { replace: true }); }}><Field label="Username" name="username" autoComplete="username" required maxLength={100} /><Field label="Password" name="password" type="password" autoComplete="current-password" required maxLength={256} /></MutationForm></div>;
}
function Collection({ kind }) {
  const location = useLocation();
  const cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/crm/${kind}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const navigate = useNavigate();
  return <><h1>{kind === 'accounts' ? 'Accounts' : 'Opportunities'}</h1><p className="pf-muted">Records for your assigned plant. Open a record to review relationships and history.</p><div className="pf-columns"><section className="pf-panel"><h2>Current {kind}</h2><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No {kind} yet. {kind === 'accounts' ? 'Create an account to begin.' : 'Open an account to create its first opportunity.'}</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><Link to={`/portfolio/${kind}/${row._id}`}>{row.name || row._id}</Link>{row.stage && <span>{row.stage} · {row.currency} {row.amount}</span>}</li>)}</ul>}<div className="pf-actions">{cursor && <Link to={`/portfolio/${kind}`}>First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></>}</Resource></section>{kind === 'accounts' ? <MutationForm title="Create account" submitLabel="Create account" save={body => request('/api/crm/accounts', { body })} onSaved={row => navigate(`/portfolio/accounts/${row._id}`)}><Field label="Account name" name="name" required maxLength={200} /></MutationForm> : <aside className="pf-panel"><h2>Start with an account</h2><p>Opportunities belong to an existing account. Select the account before entering an amount.</p><Link to="/portfolio/accounts">Open accounts</Link></aside>}</div></>;
}
function Account() {
  const { id } = useParams(), location = useLocation();
  const account = useResource(`/api/crm/accounts/${id}`);
  const cursor = new URLSearchParams(location.search).get('cursor');
  const contacts = useResource(`/api/crm/accounts/${id}/contacts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const navigate = useNavigate();
  return <><Link to="/portfolio/accounts">Back to accounts</Link><Resource resource={account}>{({ data }) => <><h1>{data.name}</h1><p className="pf-id">Account ID: {data._id}</p><div className="pf-columns"><section className="pf-panel"><h2>Contacts</h2><Resource resource={contacts}>{({ data: rows, page }) => <>{!rows.length ? <p>No contacts yet. Add the person responsible for this account.</p> : <ul className="pf-list">{rows.map(row => <li key={row._id}><strong>{row.name}</strong><span>{row.email}</span></li>)}</ul>}<div className="pf-actions">{cursor && <Link to="?">First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></>}</Resource></section><MutationForm title="Add contact" submitLabel="Create contact" save={body => request(`/api/crm/accounts/${id}/contacts`, { body })} onSaved={contacts.reload}><Field label="Contact name" name="name" required maxLength={200} /><Field label="Contact email" name="email" type="email" autoComplete="email" required maxLength={254} /></MutationForm></div><MutationForm title="Create opportunity for this account" submitLabel="Create opportunity" save={body => {
    if (!validMoney(body.amount, body.currency)) throw Object.assign(new Error('Enter an exact amount: USD/EUR/GBP/IDR need 2 decimals, JPY none, KWD 3'), { status: 400 });
    return request('/api/crm/opportunities', { body: { ...body, accountId: id } });
  }} onSaved={row => navigate(`/portfolio/opportunities/${row._id}`)}><div className="pf-fields"><Field label="Opportunity name" name="name" required maxLength={200} /><Field label="Amount (exact decimal)" name="amount" inputMode="decimal" required aria-describedby="pf-money-hint" /><label className="pf-field">Currency<select name="currency">{['USD', 'EUR', 'GBP', 'IDR', 'JPY', 'KWD'].map(c => <option key={c}>{c}</option>)}</select></label></div><p id="pf-money-hint">Use 2 decimals for USD, EUR, GBP and IDR; no decimals for JPY; 3 for KWD. No currency conversion is applied.</p></MutationForm></>}</Resource></>;
}
function Opportunity() {
  const { id } = useParams(), resource = useResource(`/api/crm/opportunities/${id}`);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const lock = useRef(false);
  return <><Link to="/portfolio/opportunities">Back to opportunities</Link><Resource resource={resource}>{({ data }) => <><h1>{data.name || 'Opportunity'}</h1><p className="pf-id">Opportunity ID: {data._id}</p><section className="pf-panel"><div className="pf-summary"><strong className="pf-money">{data.currency} {displayMoney(data.amount)}</strong><span>Stage: {data.stage}</span><span>Version: {data.version}</span></div><Link to={`/portfolio/accounts/${data.accountId}`}>Open related account</Link><p>Updated {new Date(data.updatedAt).toLocaleString()}</p><button type="button" onClick={() => { resource.reload(); setError(null); }}>Refresh record</button></section><div className="pf-columns"><section className="pf-panel"><h2>Stage history</h2><ol className="pf-list">{data.history.map(entry => <li key={entry.version}><strong>{entry.stage} · Version {entry.version}</strong><p>{entry.reason}</p><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time><span className="pf-id">Changed by {entry.userId}</span></li>)}</ol></section><form className="pf-panel pf-form" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget)); lock.current = true; setBusy(true); setError(null); setSaved(false);
    try { await request(`/api/crm/opportunities/${id}/stage`, { body: { ...values, expectedVersion: data.version } }); setSaved(true); resource.reload(); }
    catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }}><h2>Change stage</h2>{['WON', 'LOST'].includes(data.stage) ? <p>This opportunity is closed. Its stage cannot be changed.</p> : <><p>Saving against version {data.version}. Review history before changing stage.</p><label className="pf-field">Next stage<select name="stage" required>{['NEW', 'QUALIFIED', 'QUOTING', 'WON', 'LOST'].filter(s => s !== data.stage).map(s => <option key={s}>{s}</option>)}</select></label><label className="pf-field">Reason<textarea name="reason" required maxLength={1000} rows={3} /></label><button className="pf-primary" disabled={busy || error?.status === 409}>{busy ? 'Saving...' : 'Save stage'}</button></>}<Failure error={error} mutation retry={() => { setError(null); resource.reload(); }} /><p role="status">{saved ? 'Stage saved. History refreshed from the server.' : ''}</p></form></div></>}</Resource></>;
}
export default function PortfolioWorkspace() {
  const location = useLocation(), navigate = useNavigate();
  const [identity, setIdentity] = useState(null), [checked, setChecked] = useState(false), [error, setError] = useState(null), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setChecked(false);
    request('/api/session/me').then(({ data }) => { if (active) { setIdentity(data); setError(null); } }).catch(err => { if (active) { setIdentity(null); setError(err.status === 401 ? null : err); } }).finally(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, [attempt]);
  const login = location.pathname === '/portfolio/login';
  return <div className="portfolio-root"><a className="pf-skip" href="#portfolio-content">Skip to content</a><header className="pf-header"><Link className="pf-brand" to="/portfolio/accounts">IEMS Portfolio</Link><span className="pf-nav-hint">Swipe the sections below for more workspaces</span><nav aria-label="Portfolio">{identity && <><Link to="/portfolio/accounts" aria-current={location.pathname.includes('/accounts') ? 'page' : undefined}>Accounts</Link><Link to="/portfolio/opportunities" aria-current={location.pathname.includes('/opportunities') ? 'page' : undefined}>Opportunities</Link><Link to="/portfolio/inquiries" aria-current={location.pathname.includes('/inquiries') ? 'page' : undefined}>Inquiries</Link><Link to="/portfolio/quotes" aria-current={location.pathname.includes('/quotes') ? 'page' : undefined}>Quotes</Link><Link to="/portfolio/orders">Sales orders</Link><Link to="/portfolio/procurement/vendors">Procurement</Link>{identity.permissions?.includes('catalog.read') && <Link to="/portfolio/catalog-procurement/requests">Catalog procurement</Link>}{identity.permissions?.includes('master.read') && <Link to="/portfolio/inventory-master/items">Inventory items</Link>}<Link to="/portfolio/warehouse/receipts">Warehouse</Link><Link to="/portfolio/manufacturing/work-orders">Manufacturing</Link><Link to="/portfolio/fulfillment/shipments">Fulfillment</Link><Link to="/portfolio/service/tickets">Customer service</Link><Link to="/portfolio/repair/cases">Repair</Link></>}</nav>{identity && <div className="pf-session"><span>{identity.user.username}</span><button disabled={busy} onClick={async () => { setBusy(true); try { await request('/api/session/logout', { body: {} }); setIdentity(null); setError(null); navigate('/portfolio/login'); } catch (err) { if (err.status === 401) { setIdentity(null); navigate('/portfolio/login'); } else setError(err); } finally { setBusy(false); } }}>{busy ? 'Signing out...' : 'Sign out'}</button></div>}</header><main id="portfolio-content" className="pf-main">{!checked ? <p role="status">Checking portfolio session...</p> : error ? <Failure error={error} retry={() => setAttempt(n => n + 1)} /> : login ? <Login onLogin={setIdentity} /> : !identity ? <Navigate to="/portfolio/login" replace state={{ from: location.pathname + location.search }} /> : <IdentityContext.Provider value={identity}><Routes><Route path="catalog-procurement/requests" element={<CatalogProcurement key={location.pathname} />} /><Route path="catalog-procurement/requests/:id" element={<CatalogProcurement key={location.pathname} detail />} /><Route path="catalog-procurement/orders" element={<CatalogProcurement key={location.pathname} kind="orders" />} /><Route path="catalog-procurement/orders/:id" element={<CatalogProcurement key={location.pathname} kind="orders" detail />} /><Route path="catalog-procurement/receipts/:id" element={<CatalogProcurement key={location.pathname} kind="receipts" detail />} /><Route path="inventory-master/items" element={<InventoryMaster key={location.pathname} kind="items" />} /><Route path="inventory-master/items/:id" element={<InventoryMaster key={location.pathname} kind="items" />} /><Route path="inventory-master/locations" element={<InventoryMaster key={location.pathname} kind="locations" />} /><Route path="inventory-master/locations/:id" element={<InventoryMaster key={location.pathname} kind="locations" />} /><Route path="manufacturing/internal-production" element={<InternalProduction />} /><Route path="manufacturing/internal-production/new" element={<InternalProduction key={location.pathname} mode="new" />} /><Route path="manufacturing/internal-production/:id" element={<InternalProduction key={location.pathname} mode="detail" />} /><Route path="inquiries" element={<Inquiries />} /><Route path="inquiries/new" element={<NewInquiry />} /><Route path="inquiries/:id" element={<Inquiry key={location.pathname} />} /><Route path="warehouse/holds" element={<HoldList />} /><Route path="service/bindings" element={<ServiceBindings />} /><Route path="service/bindings/:id" element={<ServiceBinding key={location.pathname} />} /><Route path="manufacturing/engineering" element={<EngineeringList />} /><Route path="manufacturing/engineering/new" element={<EngineeringNew key={location.pathname} />} /><Route path="manufacturing/engineering/new/:id" element={<EngineeringNew key={location.pathname} />} /><Route path="manufacturing/engineering/:id" element={<EngineeringDetail key={location.pathname} />} /><Route path="warehouse/bins" element={<Bins key={location.pathname} />} /><Route path="warehouse/bins/:id" element={<Bins key={location.pathname} />} /><Route path="repair/cases" element={<RepairList />} /><Route path="repair/new" element={<RepairIntake />} /><Route path="repair/cases/:id" element={<RepairCase key={location.pathname} />} />{['invoices','deposits'].map(kind => <Route key={`repair-${kind}`} path={`repair/${kind}`} element={<RepairList key={kind} kind={kind} />} />)}{['invoices','deposits'].map(kind => <Route key={`repair-detail-${kind}`} path={`repair/${kind}/:id`} element={<RepairList key={location.pathname} kind={kind} />} />)}<Route path="fulfillment/shipments" element={<FulfillmentList kind="shipments" />} /><Route path="fulfillment/invoices" element={<FulfillmentList kind="invoices" />} /><Route path="fulfillment/payments" element={<FulfillmentList kind="payments" />} /><Route path="fulfillment/shipments/:id" element={<FulfillmentDetail kind="shipments" />} /><Route path="fulfillment/invoices/:id" element={<FulfillmentDetail kind="invoices" />} /><Route path="fulfillment/payments/:id" element={<FulfillmentDetail kind="payments" />} /><Route path="fulfillment/orders/:id" element={<FulfillmentOrder key={location.pathname} />} /><Route path="service/tickets" element={<ServiceInbox key="tickets" kind="tickets" />} /><Route path="service/conversations" element={<ServiceInbox key="conversations" kind="conversations" />} /><Route path="service/tickets/:id" element={<ServiceTicket key={location.pathname} />} /><Route path="service/conversations/:id" element={<ServiceConversation key={location.pathname} />} /><Route path="manufacturing/work-orders" element={<WorkOrderList />} /><Route path="manufacturing/work-orders/:id" element={<WorkOrderDetail key={location.pathname} />} /><Route path="manufacturing/plan" element={<PlanWorkOrders />} /><Route path="manufacturing/plan/:id" element={<PlanWorkOrders key={location.pathname} />} /><Route path="warehouse/receive" element={<ReceiveOrder />} /><Route path="warehouse/receive/:id" element={<ReceiveOrder key={location.pathname} />} />{['receipts','movements','reservations'].map(kind => <Route key={kind} path={`warehouse/${kind}`} element={<WarehouseList key={kind} kind={kind} />} />)}{['receipts','movements','reservations'].map(kind => <Route key={kind} path={`warehouse/${kind}/:id`} element={<WarehouseDetail key={location.pathname} kind={kind} />} />)}<Route path="orders" element={<Orders />} /><Route path="procurement/requests/new" element={<NewPurchaseRequest />} />{['vendors','requests','orders'].map(kind => <Route key={kind} path={`procurement/${kind}`} element={<ProcurementList key={kind} kind={kind} />} />)}{['vendors','requests','orders'].map(kind => <Route key={kind} path={`procurement/${kind}/:id`} element={<ProcurementDetail key={location.pathname} kind={kind} />} />)}<Route path="quotes" element={<Quotes />} /><Route path="quotes/new" element={<NewQuote />} /><Route path="quotes/:id" element={<Quote key={location.pathname} />} /><Route path="orders/:id" element={<Order />} /><Route path="accounts" element={<Collection kind="accounts" />} /><Route path="accounts/:id" element={<Account />} /><Route path="opportunities" element={<Collection kind="opportunities" />} /><Route path="opportunities/:id" element={<Opportunity />} /><Route path="*" element={<Navigate to="/portfolio/accounts" replace />} /></Routes></IdentityContext.Provider>}</main></div>;
}
