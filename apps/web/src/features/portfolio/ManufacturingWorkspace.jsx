import { AuditDetails,CustomerName } from './OperatorUi.jsx';
import { displayReference,operatorStatus,quantitySummary } from './operator.mjs';
import { useId, useRef, useState } from 'react';
import { StockExceptions } from './HoldsWorkspace.jsx';
import { Link, useLocation, useParams } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { EngineeringWorkOrderRelease } from './EngineeringWorkspace.jsx';
import { LaborWorkspace } from './LaborWorkspace.jsx';
import { MaterialTrace } from './MaterialTrace.jsx';
import { GenealogyWorkspace } from './GenealogyWorkspace.jsx';
import { SerialCustodyWorkOrder, WithSerialClaims } from './SerialCustodyWorkspace.jsx';
import { InstallationWorkspace } from './InstallationWorkspace.jsx';
import { custodyHint, hasCustodyMarker } from './serial-custody.mjs';
import { Failure, Resource, useResource } from './PortfolioWorkspace.jsx';
import { planCommand, releaseCommand, recordCommand, qcCommand, nextOperation, manufacturingHint } from './manufacturing.mjs';

const base = '/portfolio/manufacturing';
function Input({ label, ...props }) { return <label className="pf-field">{label}<input {...props} /></label>; }
function Navigation() { return <nav className="pf-actions" aria-label="Manufacturing"><Link to={`${base}/work-orders`}>Work orders</Link><Link to={`${base}/plan`}>Plan from sales order</Link><Link to={`${base}/engineering`}>Engineering packages</Link><Link to={`${base}/internal-production`}>Internal production</Link><Link to="/portfolio/inventory-master/items">Inventory items</Link><Link to="/portfolio/inventory-master/locations">Company locations</Link></nav>; }
function Boundary() { return <p>Every work order is operator recorded: people enter routing, quantities and evidence. No machine telemetry, scheduling, BOM catalog or UOM conversion is involved. QC results stay on the work order; nothing is put away, shipped or marked fulfilled here.</p>; }
export function CommandForm({ title, submitLabel, intro, build, path, onSaved, refresh, children, disabledReason }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const attempt = useRef(null), lock = useRef(false), reasonId = useId();
  async function send() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { const { data } = await request(path, { body: attempt.current }); attempt.current = null; onSaved(data); }
    catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  }
  const reset = () => { attempt.current = null; setError(null); refresh(); };
  const hint = manufacturingHint(error) || custodyHint(error);
  return <form className="pf-panel pf-form" aria-label={submitLabel} onSubmit={e => { e.preventDefault(); if (disabledReason || lock.current) return; try { if (!attempt.current) attempt.current = build(Object.fromEntries(new FormData(e.currentTarget)), crypto.randomUUID()); send(); } catch(failure) { setError(failure); } }}>
    <h2>{title}</h2>{intro}<fieldset className="pf-form" disabled={busy || !!attempt.current || !!disabledReason}>{children}</fieldset>
    <Failure error={error} mutation retry={reset} />{hint && <p role="alert">{hint}</p>}
    {disabledReason && <p id={reasonId} className="pf-disabled-reason">{disabledReason}</p>}
    {attempt.current && error ? <button type="button" disabled={busy || !!disabledReason || [400, 401, 403, 409].includes(error.status)} onClick={send}>Retry same manufacturing command</button> : <button className="pf-primary" disabled={busy || !!disabledReason} aria-describedby={disabledReason ? reasonId : undefined}>{busy ? 'Saving...' : submitLabel}</button>}
    {attempt.current && <button type="button" disabled={busy} onClick={reset}>Discard command and refresh</button>}
    <p className="pf-muted">If the result is uncertain, retry the same command. Discard it to review the server record before changing inputs.</p>
  </form>;
}
function Pager({ cursor, page, first }) { return <div className="pf-actions">{cursor && <Link to={first}>First page</Link>}{page.nextCursor && <Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div>; }
export function WorkOrderList() {
  const location = useLocation(), cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(`/api/manufacturing/work-orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Manufacturing work orders</h1><Navigation /><Boundary /><section className="pf-panel"><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No work orders in this plant yet. Plan work orders from an open sales order line to begin.</p> : <ul className="pf-list">{data.map(wo => <li key={wo._id}><Link to={`${base}/work-orders/${wo._id}`}>{displayReference("workOrders",wo)}</Link><span>{operatorStatus(wo.status)} · {wo.quantity} {wo.uom} · SO line {wo.lineIndex + 1}</span></li>)}</ul>}<Pager cursor={cursor} page={page} first={`${base}/work-orders`} /></>}</Resource></section></>;
}
function PlannedForOrder({ orderId }) {
  const resource = useResource('/api/manufacturing/work-orders?limit=100');
  return <section className="pf-panel"><h2>Work orders for this sales order</h2><p>Shows matches on the first plant page of 100 work orders. The server enforces the line limit across all pages.</p><Resource resource={resource}>{({ data }) => { const rows = data.filter(w => w.salesOrderId === orderId); return !rows.length ? <p>None planned on this page yet.</p> : <ul className="pf-list">{rows.map(w => <li key={w._id}><Link to={`${base}/work-orders/${w._id}`}>{displayReference("workOrders",w)}</Link><span>{w.status} · Line {w.lineIndex + 1} · {w.quantity} {w.uom}</span></li>)}</ul>; }}</Resource></section>;
}
export function PlanWorkOrders() {
  const { id } = useParams(), location = useLocation(), cursor = new URLSearchParams(location.search).get('cursor');
  const resource = useResource(id ? `/api/commercial/orders/${id}` : `/api/commercial/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const [created, setCreated] = useState(null);
  return <><h1>{id ? 'Plan work orders' : 'Select sales order to plan'}</h1><Navigation /><Boundary /><Resource resource={resource}>{({ data, page }) => !id ? <section className="pf-panel"><p>Only OPEN sales orders can be planned. Other orders open their commercial record.</p>{!data.length && <p>No sales orders yet. Convert an accepted quote first.</p>}<ul className="pf-list">{data.map(so => <li key={so._id}>{so.status === 'OPEN' ? <Link to={`${base}/plan/${so._id}`}>{displayReference("orders",so)}</Link> : <Link to={`/portfolio/orders/${so._id}`}>{displayReference("orders",so)}</Link>}<span>{so.status} · Quote revision {so.quoteRevision}</span></li>)}</ul><Pager cursor={cursor} page={page} first={`${base}/plan`} /></section> : <>
    <section className="pf-panel"><h2>{displayReference("orders",data)}</h2><p>Status: {operatorStatus(data.status)}</p><AuditDetails action="manufacturing.read"><p className="pf-id">Sales order ID: {data._id} · Version {data.version}</p></AuditDetails><ol className="pf-list">{data.snapshot.lines.map((line, i) => <li key={i}><strong>Line {i + 1}: {line.description}</strong><span>Ordered: {line.quantity} {line.uom}</span></li>)}</ol><Link to={`/portfolio/orders/${data._id}`}>Open sales order</Link></section>
    {data.status === 'OPEN' ? <CommandForm key={`plan-${created?._id || ''}`} title="Split line into work orders" submitLabel="Plan work orders" path="/api/manufacturing/work-orders" refresh={resource.reload} build={(v, key) => planCommand(data, v, key)} onSaved={setCreated} intro={<p>Each quantity becomes one PLANNED work order in the line UOM. All planned work orders for a line together cannot exceed its ordered quantity. Planning reserves production capacity, not finished goods.</p>}>
      <label className="pf-field">Sales order line<select name="lineIndex">{data.snapshot.lines.map((line, i) => <option key={i} value={i}>Line {i + 1}: {line.description} ({line.quantity} {line.uom})</option>)}</select></label>
      <label className="pf-field">Split quantities (exact decimals, one per work order, separated by spaces or new lines)<textarea name="quantities" rows={3} required inputMode="decimal" /></label>
<label className="pf-field">Required labor operation indices (optional, zero based)<textarea name="requiredLaborOperationIndices" rows={2} placeholder="0, 3" /><span>Enter distinct routing operation indices separated by commas or new lines. Required labor must be recorded before QC.</span></label>
      <label className="pf-field">Output identification<select name="serialized" defaultValue="false"><option value="false">Quantity only</option><option value="true">Individual serial identities</option></select></label>
      <label className="pf-field">Per-unit lot genealogy<select name="genealogyRequired" defaultValue="false"><option value="false">Not required</option><option value="true">Required before shipment</option></select></label>
      <label className="pf-field">Incoming serial custody<select name="serialCustodyRequired" defaultValue="false"><option value="false">Not required</option><option value="true">Required before material release and consumption</option></select></label>
      <label className="pf-field">Received component installation<select name="installationRequired" defaultValue="false"><option value="false">Not required</option><option value="true">Required before shipment</option></select></label>
      <p>Required installation also needs received serial custody, lot genealogy and individual outputs. Explicitly assign consumed received identities to real parent outputs. Process loss and removal are permanent; no manufactured-child or replacement workflow is included.</p>
      <p>Required incoming custody also needs individual output serials and lot genealogy. Explicitly adopt untouched incoming stock, then claim exact identities while PLANNED. Material ratios must be positive integral source quantities, at most 100 identities per source.</p>
      <p>Required genealogy needs individual serial identities, at most 100 units per work order, and at most 20 released materials with recorded lot and heat. Operators explicitly assign consumed material to each output and record any process losses before finalization.</p>
      <p>Serial identification is fixed at planning. Each serialized work order needs an integral quantity of at most 1,000 units. Register final output identities before QC.</p>
    </CommandForm> : <p>This sales order is {data.status}. Only OPEN orders can be planned.</p>}
    {created && <section className="pf-panel" role="status"><h2>Planned {created.workOrders.length} work orders</h2><ul className="pf-list">{created.workOrders.map(w => <li key={w._id}><Link to={`${base}/work-orders/${w._id}`}>{displayReference("workOrders",w)}</Link><span>{w.status} · {w.quantity} {w.uom}</span></li>)}</ul></section>}
    <PlannedForOrder key={`planned-${created?._id || ''}`} orderId={data._id} />
  </>}</Resource></>;
}
function ReleaseForm({ wo, refresh }) {
  const [operations, setOperations] = useState(1), [materials, setMaterials] = useState(1);
  const receipts = useResource('/api/warehouse/receipts?limit=100', true);
  return <WithSerialClaims wo={wo}>{claims => <Resource resource={receipts}>{({ data }) => { const stored = data.filter(r => r.status === 'STORED' && (wo.serialCustodyRequired ? r.serialCustody?.mode === 'RECEIVED_V1' : !hasCustodyMarker(r))); return <CommandForm title="Release with routing and materials" submitLabel="Release work order" path={`/api/manufacturing/work-orders/${wo._id}/release`} refresh={refresh} onSaved={refresh} disabledReason={wo.serialCustodyRequired && !claims.claims.some(claim => claim.status === 'CLAIMED') ? 'Claim incoming source identities before release. Every selected source must match the complete active claim set.' : ''}
    build={(v, key) => { for (let i = 0; i < materials; i++) v[`materialUom${i}`] = stored.find(r => r._id === v[`receiptId${i}`])?.uom; return releaseCommand({ ...wo, version:claims.workOrderVersion }, v, operations, materials, key, claims.claims); }}
    intro={<p>Release freezes the routing and reserves material from STORED receipts: required = {wo.quantity} {wo.uom} x quantity per unit, in the receipt UOM. Operations are recorded later in this order.</p>}>
    {!stored.length && <p>No STORED receipts on the first plant page. <Link to="/portfolio/warehouse/receipts">Open warehouse receipts</Link> to receive and put away material first.</p>}
    {Array.from({ length: operations }, (_, i) => <fieldset key={`op${i}`} className="pf-fields"><legend>Operation {i + 1}</legend><Input label="Operation code" name={`code${i}`} required maxLength={1000} /><Input label="Operator instruction" name={`instruction${i}`} required maxLength={1000} /></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={operations >= 50} onClick={() => setOperations(n => n + 1)}>Add operation</button>{operations > 1 && <button type="button" onClick={() => setOperations(n => n - 1)}>Remove last operation</button>}</div>
    {Array.from({ length: materials }, (_, i) => <fieldset key={`m${i}`} className="pf-fields"><legend>Material {i + 1}</legend><label className="pf-field">Source receipt (available stock)<select name={`receiptId${i}`} required>{stored.map(r => <option key={r._id} value={r._id}>{displayReference("receipts",r)} · {r.lotNumber || "Lot not recorded"} / {r.heatNumber || "Heat not recorded"} · {r.availableQuantity} {r.uom} available</option>)}</select></label><Input label={`Quantity per 1 ${wo.uom} output (exact decimal, receipt UOM)`} name={`quantityPerUnit${i}`} required inputMode="decimal" /></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={materials >= (wo.serialCustodyRequired ? 20 : 100) || materials >= stored.length} onClick={() => setMaterials(n => n + 1)}>Add material</button>{materials > 1 && <button type="button" onClick={() => setMaterials(n => n - 1)}>Remove last material</button>}</div>
  </CommandForm>; }}</Resource>}</WithSerialClaims>;
}
function RecordForm({ wo, refresh }) {
  const next = nextOperation(wo), operation = wo.routing.operations[next.index];
  return <CommandForm title={`Record operation ${next.index + 1} of ${wo.routing.operations.length}: ${next.code}`} submitLabel="Record operation" path={`/api/manufacturing/work-orders/${wo._id}/record`} refresh={refresh} onSaved={refresh} build={(v, key) => recordCommand(wo, v, key)}
    intro={<><p>Instruction: {operation.instruction}</p><p>Input: {next.inputQuantity} {wo.uom} ({next.index ? 'good output of the previous operation' : 'work order quantity'}). Good + scrap must equal the input.{next.index === 0 && ' Recording this first operation consumes the reserved material.'}</p></>}>
    <div className="pf-fields"><Input label={`Good quantity (${wo.uom})`} name="goodQuantity" required inputMode="decimal" /><Input label={`Scrap quantity (${wo.uom})`} name="scrapQuantity" required inputMode="decimal" /></div>
    <label className="pf-field">Operator evidence<textarea name="evidence" rows={3} required maxLength={1000} /></label>
    {wo.serialized && next.index === wo.routing.operations.length - 1 && <><label className="pf-field">Final output serial identifiers (whitespace separated)<textarea name="outputSerials" rows={5} /></label><p>Enter one unique serial for every good unit, using letters, numbers, underscores or hyphens, at most 100 characters each. Leave empty only when good quantity is zero.</p></>}
  </CommandForm>;
}
function QcForm({ wo, refresh }) {
  return <CommandForm title="Record QC decision" submitLabel="Record QC" path={`/api/manufacturing/work-orders/${wo._id}/qc`} refresh={refresh} onSaved={refresh} build={(v, key) => qcCommand(wo, v, key)}
    intro={<p>Final output in quarantine: {wo.output.quantity} {wo.uom}. Accepted + rejected must equal it.</p>}>
    <div className="pf-fields"><Input label={`Accepted quantity (${wo.uom})`} name="acceptedQuantity" required inputMode="decimal" /><Input label={`Rejected quantity (${wo.uom})`} name="rejectedQuantity" required inputMode="decimal" /></div>
    {wo.serialized && <><p>Classify every final output serial exactly once. Accepted and rejected serial counts must match their quantities. Registered output: {wo.output.serials.join(', ') || 'None (zero good output)'}.</p><label className="pf-field">Accepted serial identifiers (whitespace separated)<textarea name="acceptedSerials" rows={4} /></label><label className="pf-field">Rejected serial identifiers (whitespace separated)<textarea name="rejectedSerials" rows={4} /></label></>}
    <label className="pf-field">Inspector evidence<textarea name="evidence" rows={3} required maxLength={1000} /></label>
  </CommandForm>;
}
export function WorkOrderDetail() {
  const { id } = useParams(), resource = useResource(`/api/manufacturing/work-orders/${id}?include=stockExceptions`);
  return <><Navigation /><Resource resource={resource}>{({ data: wo }) => <><h1>Work order</h1><p className="pf-reference">{displayReference("workOrders",wo)}</p><AuditDetails action="manufacturing.read"><p className="pf-id">Work order ID: {wo._id} · Version {wo.version}</p></AuditDetails><Boundary /><StockExceptions exceptions={wo.stockExceptions} />
    <section className="pf-panel"><div className="pf-summary"><strong>Status: {operatorStatus(wo.status)}</strong><span>Quantity: {wo.quantity} {wo.uom}</span></div>
      <p>Source: sales order line {wo.lineIndex + 1}, {wo.sourceLine.description} ({wo.sourceLine.quantity} {wo.sourceLine.uom} ordered)</p><AuditDetails action="manufacturing.read"><p>SO version: {wo.salesOrderVersion}</p></AuditDetails>
      <p>Output identification: {wo.serialized ? 'Individual serial identities' : 'Quantity only'}</p>
      {wo.totalScrapQuantity && <p>Total scrap: {wo.totalScrapQuantity} {wo.uom}</p>}
      {wo.output && <p>Final output: {wo.output.quantity} {wo.output.uom} · {wo.output.status}</p>}
      {wo.output && <MaterialTrace trace={wo.output.materialTrace} output />}
      <p className="pf-next-action">Next: {wo.routing && wo.requiredLaborOperationIndices?.[wo.laborCount || 0] === wo.records.length ? 'Record the required labor evidence for this operation before recording its output.' : ({PLANNED:"Review routing and material sources, then release the work order.",RELEASED:"Record the first actual operation.",IN_PROGRESS:"Record the next routing operation.",QUARANTINED:"Record output quality after reviewing genealogy and installation requirements.",QC_COMPLETED:"Open fulfillment to dispatch accepted output."})[wo.status] || "Review work order records."}</p><AuditDetails action="manufacturing.read"><p className="pf-id">Planned by {wo.createdBy} at {wo.createdAt} · split {wo.splitId}</p></AuditDetails>
      <div className="pf-actions"><button type="button" onClick={resource.reload}>Refresh record</button><Link to={`/portfolio/orders/${wo.salesOrderId}`}>Open source sales order</Link><Link to={`/portfolio/accounts/${wo.accountId}`}>Open customer</Link></div></section>
    {wo.routing && <div className="pf-columns"><section className="pf-panel"><h2>Routing and operator records</h2><ol className="pf-list">{wo.routing.operations.map((op, i) => { const r = wo.records[i]; return <li key={op.code}><strong>{i + 1}. {op.code}</strong><span>{op.instruction}</span>{r ? <><span>Input {r.inputQuantity} · Good {r.goodQuantity} · Scrap {r.scrapQuantity} {r.uom}</span><span>Evidence: {r.evidence}</span><AuditDetails action="manufacturing.read"><p className="pf-id">Recorded by {r.recordedBy} at {r.recordedAt}</p></AuditDetails></> : <span>Not recorded yet</span>}</li>; })}</ol></section>
      <section className="pf-panel"><h2>Released materials</h2><ul className="pf-list">{wo.routing.materials.map(m => <li key={m.receiptId}><Link to={`/portfolio/warehouse/receipts/${m.receiptId}`}>{displayReference("receipts",m.receiptId)}</Link><span>{m.quantity} {m.uom} ({m.quantityPerUnit} per 1 {wo.uom}) · {wo.records.length ? 'Consumed' : 'Reserved'}</span>{m.serialCustody && <><AuditDetails action="manufacturing.read"><p className="pf-id">Incoming claim: {m.serialCustody.claimId}</p></AuditDetails><p>Frozen incoming identities: {m.serialCustody.serials.join(', ')}</p><p>{wo.installationRequired ? 'Incoming consumption evidence only. Inspect the received component installation section for parent links.' : 'Per-output installation: UNRECORDED.'}</p></>}</li>)}</ul><p>Released at {new Date(wo.routing.releasedAt).toLocaleString("en-US")}</p><AuditDetails action="manufacturing.read"><p className="pf-id">Released by {wo.routing.releasedBy}</p></AuditDetails></section></div>}
    {wo.routing?.materials.some(material => material.materialTrace) && <section className="pf-panel"><h2>Frozen material receipt context</h2><MaterialTrace trace={wo.routing.materials.flatMap(material => material.materialTrace ? [material.materialTrace] : [])} output /></section>}
    {wo.qc && <section className="pf-panel"><h2>QC decision</h2><p>Accepted: {wo.qc.acceptedQuantity} {wo.qc.uom} · Rejected: {wo.qc.rejectedQuantity} {wo.qc.uom}</p>{wo.serialized && <><p>Accepted serials: {wo.qc.acceptedSerials.join(', ') || 'None'}</p><p>Rejected serials: {wo.qc.rejectedSerials.join(', ') || 'None'}</p></>}<p>Evidence: {wo.qc.evidence}</p><p>Recorded at {new Date(wo.qc.recordedAt).toLocaleString("en-US")}</p><AuditDetails action="manufacturing.read"><p className="pf-id">Recorded by {wo.qc.recordedBy}</p></AuditDetails><p>Accepted output is not put away or shipped by this workspace.</p></section>}
    {wo.serialized && wo.output && <OutputUnits key={`units-${wo.version}`} workOrderId={wo._id} />}
    <GenealogyWorkspace wo={wo} refresh={resource.reload} />
    <SerialCustodyWorkOrder wo={wo} refresh={resource.reload} />
    <InstallationWorkspace wo={wo} refresh={resource.reload} />
    {wo.engineeringSnapshot && <section className="pf-panel"><h2>Frozen work order engineering snapshot</h2><Link to={`${base}/engineering/${wo.engineeringSnapshot.engineeringId}`}>Approved engineering revision {wo.engineeringSnapshot.revision}</Link><p>Revision: {wo.engineeringSnapshot.revision}</p><AuditDetails action="manufacturing.read"><p>Engineering version at release: {wo.engineeringSnapshot.engineeringVersion}</p></AuditDetails><p>Routing and material reservations remain frozen through later package revisions or revocation.</p></section>}
    {wo.status === 'PLANNED' && <><EngineeringWorkOrderRelease key={`engineering-${wo.version}`} wo={wo} refresh={resource.reload} /><ReleaseForm key={wo.version} wo={wo} refresh={resource.reload} /></>}
    {['RELEASED', 'IN_PROGRESS'].includes(wo.status) && <RecordForm key={wo.version} wo={wo} refresh={resource.reload} />}
    {wo.status === 'QUARANTINED' && <QcForm key={wo.version} wo={wo} refresh={resource.reload} />}
    <LaborWorkspace key={`labor-${wo._id}-${wo.version}`} wo={wo} refresh={resource.reload} />
  </>}</Resource></>;
}

function OutputUnits({ workOrderId }) {
  const resource = useResource(`/api/manufacturing/work-orders/${workOrderId}/output-units`);
  return <section className="pf-panel"><div className="pf-toolbar"><h2>Output serial identities</h2><button type="button" onClick={resource.reload}>Refresh serial statuses</button></div><Resource resource={resource}>{({ data }) => data.length ? <ul className="pf-list">{data.map(unit => <li key={unit._id}><strong>{unit.serial}</strong><span>Status: {unit.status}</span>{unit.shipmentId && <Link to={`/portfolio/fulfillment/shipments/${unit.shipmentId}`}>Open shipment</Link>}</li>)}</ul> : <p>No output units were registered. A final operation with zero good quantity creates no serial identities.</p>}</Resource></section>;
}
