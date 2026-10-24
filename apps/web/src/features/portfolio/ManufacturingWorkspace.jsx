import { useRef, useState } from 'react';
import { StockExceptions } from './HoldsWorkspace.jsx';
import { Link, useLocation, useParams } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { EngineeringWorkOrderRelease } from './EngineeringWorkspace.jsx';
import { LaborWorkspace } from './LaborWorkspace.jsx';
import { Failure, Resource, useResource } from './PortfolioWorkspace.jsx';
import { planCommand, releaseCommand, recordCommand, qcCommand, nextOperation, manufacturingHint } from './manufacturing.mjs';

const base = '/portfolio/manufacturing';
function Input({ label, ...props }) { return <label className="pf-field">{label}<input {...props} /></label>; }
function Navigation() { return <nav className="pf-actions" aria-label="Manufacturing"><Link to={`${base}/work-orders`}>Work orders</Link><Link to={`${base}/plan`}>Plan from sales order</Link><Link to={`${base}/engineering`}>Engineering packages</Link></nav>; }
function Boundary() { return <p>Every work order is operator recorded: people enter routing, quantities and evidence. No machine telemetry, scheduling, BOM catalog or UOM conversion is involved. QC results stay on the work order; nothing is put away, shipped or marked fulfilled here.</p>; }
export function CommandForm({ title, submitLabel, intro, build, path, onSaved, refresh, children }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const attempt = useRef(null), lock = useRef(false);
  async function send() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { const { data } = await request(path, { body: attempt.current }); attempt.current = null; onSaved(data); }
    catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }
  const reset = () => { attempt.current = null; setError(null); refresh(); };
  const hint = manufacturingHint(error);
  return <form className="pf-panel pf-form" onSubmit={e => { e.preventDefault(); if (!attempt.current) attempt.current = build(Object.fromEntries(new FormData(e.currentTarget)), crypto.randomUUID()); send(); }}>
    <h2>{title}</h2>{intro}<fieldset className="pf-form" disabled={busy || !!attempt.current}>{children}</fieldset>
    <Failure error={error} mutation retry={reset} />{hint && <p role="alert">{hint}</p>}
    {attempt.current && error ? <button type="button" disabled={busy || [400, 401, 403, 409].includes(error.status)} onClick={send}>Retry same manufacturing command</button> : <button className="pf-primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>}
    {attempt.current && <button type="button" disabled={busy} onClick={reset}>Discard command and refresh</button>}
    <p className="pf-muted">If the result is uncertain, retry the same command. Discard it to review the server record before changing inputs.</p>
  </form>;
}
function Pager({ cursor, page, first }) { return <div className="pf-actions">{cursor && <Link to={first}>First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div>; }
export function WorkOrderList() {
  const location = useLocation(), cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/manufacturing/work-orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Manufacturing work orders</h1><Navigation /><Boundary /><section className="pf-panel"><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No work orders in this plant yet. Plan work orders from an open sales order line to begin.</p> : <ul className="pf-list">{data.map(wo => <li key={wo._id}><Link to={`${base}/work-orders/${wo._id}`}>{wo._id}</Link><span>{wo.status} · {wo.quantity} {wo.uom} · SO line {wo.lineIndex + 1}</span></li>)}</ul>}<Pager cursor={cursor} page={page} first={`${base}/work-orders`} /></>}</Resource></section></>;
}
function PlannedForOrder({ orderId }) {
  const resource = useResource('/api/manufacturing/work-orders?limit=100');
  return <section className="pf-panel"><h2>Work orders for this sales order</h2><p>Shows matches on the first plant page of 100 work orders. The server enforces the line limit across all pages.</p><Resource resource={resource}>{({ data }) => { const rows = data.filter(w => w.salesOrderId === orderId); return !rows.length ? <p>None planned on this page yet.</p> : <ul className="pf-list">{rows.map(w => <li key={w._id}><Link to={`${base}/work-orders/${w._id}`}>{w._id}</Link><span>{w.status} · Line {w.lineIndex + 1} · {w.quantity} {w.uom}</span></li>)}</ul>; }}</Resource></section>;
}
export function PlanWorkOrders() {
  const { id } = useParams(), location = useLocation(), cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(id ? `/api/commercial/orders/${id}` : `/api/commercial/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const [created, setCreated] = useState(null);
  return <><h1>{id ? 'Plan work orders' : 'Select sales order to plan'}</h1><Navigation /><Boundary /><Resource resource={resource}>{({ data, page }) => !id ? <section className="pf-panel"><p>Only OPEN sales orders can be planned. Other orders open their commercial record.</p>{!data.length && <p>No sales orders yet. Convert an accepted quote first.</p>}<ul className="pf-list">{data.map(so => <li key={so._id}>{so.status === 'OPEN' ? <Link to={`${base}/plan/${so._id}`}>{so._id}</Link> : <Link to={`/portfolio/orders/${so._id}`}>{so._id}</Link>}<span>{so.status} · Quote revision {so.quoteRevision}</span></li>)}</ul><Pager cursor={cursor} page={page} first={`${base}/plan`} /></section> : <>
    <section className="pf-panel"><p className="pf-id">Sales order ID: {data._id}</p><p>Status: {data.status} · Version: {data.version}</p><ol className="pf-list">{data.snapshot.lines.map((line, i) => <li key={i}><strong>Line {i + 1}: {line.description}</strong><span>Ordered: {line.quantity} {line.uom}</span></li>)}</ol><Link to={`/portfolio/orders/${data._id}`}>Open sales order</Link></section>
    {data.status === 'OPEN' ? <CommandForm key={`plan-${created?._id || ''}`} title="Split line into work orders" submitLabel="Plan work orders" path="/api/manufacturing/work-orders" refresh={resource.reload} build={(v, key) => planCommand(data, v, key)} onSaved={setCreated} intro={<p>Each quantity becomes one PLANNED work order in the line UOM. All planned work orders for a line together cannot exceed its ordered quantity. Planning reserves production capacity, not finished goods.</p>}>
      <label className="pf-field">Sales order line<select name="lineIndex">{data.snapshot.lines.map((line, i) => <option key={i} value={i}>Line {i + 1}: {line.description} ({line.quantity} {line.uom})</option>)}</select></label>
      <label className="pf-field">Split quantities (exact decimals, one per work order, separated by spaces or new lines)<textarea name="quantities" rows={3} required inputMode="decimal" /></label>
    </CommandForm> : <p>This sales order is {data.status}. Only OPEN orders can be planned.</p>}
    {created && <section className="pf-panel" role="status"><h2>Planned {created.workOrders.length} work orders</h2><ul className="pf-list">{created.workOrders.map(w => <li key={w._id}><Link to={`${base}/work-orders/${w._id}`}>{w._id}</Link><span>{w.status} · {w.quantity} {w.uom}</span></li>)}</ul></section>}
    <PlannedForOrder key={`planned-${created?._id || ''}`} orderId={data._id} />
  </>}</Resource></>;
}
function ReleaseForm({ wo, refresh }) {
  const [operations, setOperations] = useState(1), [materials, setMaterials] = useState(1);
  const receipts = useResource('/api/warehouse/receipts?limit=100', true);
  return <Resource resource={receipts}>{({ data }) => { const stored = data.filter(r => r.status === 'STORED'); return <CommandForm title="Release with routing and materials" submitLabel="Release work order" path={`/api/manufacturing/work-orders/${wo._id}/release`} refresh={refresh} onSaved={refresh}
    build={(v, key) => { for (let i = 0; i < materials; i++) v[`materialUom${i}`] = stored.find(r => r._id === v[`receiptId${i}`])?.uom; return releaseCommand(wo, v, operations, materials, key); }}
    intro={<p>Release freezes the routing and reserves material from STORED receipts: required = {wo.quantity} {wo.uom} x quantity per unit, in the receipt UOM. Operations are recorded later in this order.</p>}>
    {!stored.length && <p>No STORED receipts on the first plant page. <Link to="/portfolio/warehouse/receipts">Open warehouse receipts</Link> to receive and put away material first.</p>}
    {Array.from({ length: operations }, (_, i) => <fieldset key={`op${i}`} className="pf-fields"><legend>Operation {i + 1}</legend><Input label="Operation code" name={`code${i}`} required maxLength={1000} /><Input label="Operator instruction" name={`instruction${i}`} required maxLength={1000} /></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={operations >= 50} onClick={() => setOperations(n => n + 1)}>Add operation</button>{operations > 1 && <button type="button" onClick={() => setOperations(n => n - 1)}>Remove last operation</button>}</div>
    {Array.from({ length: materials }, (_, i) => <fieldset key={`m${i}`} className="pf-fields"><legend>Material {i + 1}</legend><label className="pf-field">Source receipt (available stock)<select name={`receiptId${i}`} required>{stored.map(r => <option key={r._id} value={r._id}>{r._id} · {r.availableQuantity} {r.uom} available</option>)}</select></label><Input label={`Quantity per 1 ${wo.uom} output (exact decimal, receipt UOM)`} name={`quantityPerUnit${i}`} required inputMode="decimal" /></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={materials >= 100 || materials >= stored.length} onClick={() => setMaterials(n => n + 1)}>Add material</button>{materials > 1 && <button type="button" onClick={() => setMaterials(n => n - 1)}>Remove last material</button>}</div>
  </CommandForm>; }}</Resource>;
}
function RecordForm({ wo, refresh }) {
  const next = nextOperation(wo), operation = wo.routing.operations[next.index];
  return <CommandForm title={`Record operation ${next.index + 1} of ${wo.routing.operations.length}: ${next.code}`} submitLabel="Record operation" path={`/api/manufacturing/work-orders/${wo._id}/record`} refresh={refresh} onSaved={refresh} build={(v, key) => recordCommand(wo, v, key)}
    intro={<><p>Instruction: {operation.instruction}</p><p>Input: {next.inputQuantity} {wo.uom} ({next.index ? 'good output of the previous operation' : 'work order quantity'}). Good + scrap must equal the input.{next.index === 0 && ' Recording this first operation consumes the reserved material.'}</p></>}>
    <div className="pf-fields"><Input label={`Good quantity (${wo.uom})`} name="goodQuantity" required inputMode="decimal" /><Input label={`Scrap quantity (${wo.uom})`} name="scrapQuantity" required inputMode="decimal" /></div>
    <label className="pf-field">Operator evidence<textarea name="evidence" rows={3} required maxLength={1000} /></label>
  </CommandForm>;
}
function QcForm({ wo, refresh }) {
  return <CommandForm title="Record QC decision" submitLabel="Record QC" path={`/api/manufacturing/work-orders/${wo._id}/qc`} refresh={refresh} onSaved={refresh} build={(v, key) => qcCommand(wo, v, key)}
    intro={<p>Final output in quarantine: {wo.output.quantity} {wo.uom}. Accepted + rejected must equal it.</p>}>
    <div className="pf-fields"><Input label={`Accepted quantity (${wo.uom})`} name="acceptedQuantity" required inputMode="decimal" /><Input label={`Rejected quantity (${wo.uom})`} name="rejectedQuantity" required inputMode="decimal" /></div>
    <label className="pf-field">Inspector evidence<textarea name="evidence" rows={3} required maxLength={1000} /></label>
  </CommandForm>;
}
export function WorkOrderDetail() {
  const { id } = useParams(), resource = useResource(`/api/manufacturing/work-orders/${id}?include=stockExceptions`);
  return <><Navigation /><Resource resource={resource}>{({ data: wo }) => <><h1>Work order</h1><p className="pf-id">Work order ID: {wo._id}</p><Boundary /><StockExceptions exceptions={wo.stockExceptions} />
    <section className="pf-panel"><div className="pf-summary"><strong>Status: {wo.status}</strong><span>Version: {wo.version}</span><span>Quantity: {wo.quantity} {wo.uom}</span></div>
      <p>Source: sales order line {wo.lineIndex + 1}, {wo.sourceLine.description} ({wo.sourceLine.quantity} {wo.sourceLine.uom} ordered, SO version {wo.salesOrderVersion})</p>
      {wo.totalScrapQuantity && <p>Total scrap: {wo.totalScrapQuantity} {wo.uom}</p>}
      {wo.output && <p>Final output: {wo.output.quantity} {wo.output.uom} · {wo.output.status}</p>}
      <p className="pf-id">Planned by {wo.createdBy} at {wo.createdAt} · split {wo.splitId}</p>
      <div className="pf-actions"><button type="button" onClick={resource.reload}>Refresh record</button><Link to={`/portfolio/orders/${wo.salesOrderId}`}>Open source sales order</Link><Link to={`/portfolio/accounts/${wo.accountId}`}>Open customer</Link></div></section>
    {wo.routing && <div className="pf-columns"><section className="pf-panel"><h2>Routing and operator records</h2><ol className="pf-list">{wo.routing.operations.map((op, i) => { const r = wo.records[i]; return <li key={op.code}><strong>{i + 1}. {op.code}</strong><span>{op.instruction}</span>{r ? <><span>Input {r.inputQuantity} · Good {r.goodQuantity} · Scrap {r.scrapQuantity} {r.uom}</span><span>Evidence: {r.evidence}</span><span className="pf-id">Recorded by {r.recordedBy} at {r.recordedAt}</span></> : <span>Not recorded yet</span>}</li>; })}</ol></section>
      <section className="pf-panel"><h2>Released materials</h2><ul className="pf-list">{wo.routing.materials.map(m => <li key={m.receiptId}><Link to={`/portfolio/warehouse/receipts/${m.receiptId}`}>{m.receiptId}</Link><span>{m.quantity} {m.uom} ({m.quantityPerUnit} per 1 {wo.uom}) · {wo.records.length ? 'Consumed' : 'Reserved'}</span></li>)}</ul><p className="pf-id">Released by {wo.routing.releasedBy} at {wo.routing.releasedAt}</p></section></div>}
    {wo.qc && <section className="pf-panel"><h2>QC decision</h2><p>Accepted: {wo.qc.acceptedQuantity} {wo.qc.uom} · Rejected: {wo.qc.rejectedQuantity} {wo.qc.uom}</p><p>Evidence: {wo.qc.evidence}</p><p className="pf-id">Recorded by {wo.qc.recordedBy} at {wo.qc.recordedAt}</p><p>Accepted output is not put away or shipped by this workspace.</p></section>}
    {wo.engineeringSnapshot && <section className="pf-panel"><h2>Frozen work order engineering snapshot</h2><Link to={`${base}/engineering/${wo.engineeringSnapshot.engineeringId}`}>{wo.engineeringSnapshot.engineeringId}</Link><p>Revision: {wo.engineeringSnapshot.revision} · Engineering version at release: {wo.engineeringSnapshot.engineeringVersion}</p><p>Routing and material reservations remain frozen through later package revisions or revocation.</p></section>}
    {wo.status === 'PLANNED' && <><EngineeringWorkOrderRelease key={`engineering-${wo.version}`} wo={wo} refresh={resource.reload} /><ReleaseForm key={wo.version} wo={wo} refresh={resource.reload} /></>}
    {['RELEASED', 'IN_PROGRESS'].includes(wo.status) && <RecordForm key={wo.version} wo={wo} refresh={resource.reload} />}
    {wo.status === 'QUARANTINED' && <QcForm key={wo.version} wo={wo} refresh={resource.reload} />}
    <LaborWorkspace key={`labor-${wo._id}-${wo.version}`} wo={wo} refresh={resource.reload} />
  </>}</Resource></>;
}
