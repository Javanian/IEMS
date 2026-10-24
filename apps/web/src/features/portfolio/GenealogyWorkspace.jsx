import { useContext, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { allocationCommand, finalizeGenealogyCommand, genealogyCapability, genealogyHint, genealogyPage, genealogyPath, lossCommand } from './genealogy.mjs';

function Reason() {
  return <label className="pf-field">Attribution or correction reason<textarea name="reason" rows={3} required minLength={3} maxLength={500} /></label>;
}

function GenealogyCommand({ title, action, path, view, build, onSaved, children, blockedReason }) {
  const identity = useContext(IdentityContext), capability = genealogyCapability(action, identity?.permissions);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const reasonId = useId();
  const attempt = useRef(null), lock = useRef(false);
  const denied = !capability.enabled ? capability.reason : error?.status === 403 ? genealogyCapability(action, []).reason : '';
  async function send() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { const result = await request(path, { body:attempt.current }); attempt.current = null; onSaved(result.data); }
    catch (failure) { setError(failure); }
    finally { lock.current = false; setBusy(false); }
  }
  const retained = !!attempt.current, retryable = retained && error && (!error.status || error.status >= 500);
  const hint = genealogyHint(error);
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (attempt.current || lock.current || denied || blockedReason) return;
    attempt.current = build(view, Object.fromEntries(new FormData(event.currentTarget)), crypto.randomUUID()); send();
  }}><h3>{title}</h3><fieldset className="pf-form" disabled={busy || retained || !!denied || !!blockedReason}>{children}<Reason /></fieldset>
    <Failure error={error} mutation />{hint && <p role="alert">{hint}</p>}
    {(denied || blockedReason) && <div id={reasonId}>{denied && <p className="pf-disabled-reason">{denied}</p>}{blockedReason && <p className="pf-disabled-reason">{blockedReason}</p>}</div>}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || retained || !!denied || !!blockedReason} aria-describedby={denied || blockedReason ? reasonId : undefined}>{busy ? 'Saving...' : title}</button>{retryable && <button type="button" disabled={busy || !!denied} onClick={send}>Retry same genealogy command</button>}{retained && error && <button type="button" disabled={busy} onClick={() => { attempt.current = null; setError(null); onSaved(); }}>Discard genealogy command and refresh</button>}</div>
    <p className="pf-muted">An uncertain response retains the exact quantities, versions and command key. Retry that command, or discard it and review refreshed evidence before changing inputs.</p>
  </form>;
}

export function GenealogyWorkspace({ wo, refresh }) {
  const identity = useContext(IdentityContext), read = genealogyCapability('genealogy.read', identity?.permissions);
  return <section id="lot-genealogy" aria-label="Per-unit lot genealogy"><h2>Per-unit lot genealogy</h2>
    <p>Operator attribution of material already consumed. Recording allocations does not consume or reserve stock again. Serialized component installation and physical custody are separate evidence.</p>
    {!wo.genealogyRequired ? <p>Status: UNRECORDED. Lot genealogy was not required when this work order was planned; existing quantity and serial workflows remain available.</p> : !read.enabled ? <p className="pf-disabled-reason">{read.reason}</p> : <GenealogyData wo={wo} refresh={refresh} />}
  </section>;
}

function GenealogyData({ wo, refresh }) {
  const path = genealogyPath(wo._id), resource = useResource(path);
  const saved = () => { resource.reload(); refresh(); };
  return <Resource resource={resource}>{({ data:view }) => <>
    <section className="pf-panel"><div className="pf-toolbar"><h3>Current attribution</h3><button type="button" onClick={resource.reload}>Refresh lot genealogy</button></div>
      <p>Status: {view.status} · Genealogy version: {view.version} · Revision: {view.currentRevision} · Work order version: {view.workOrderVersion}</p>
      {view.frozen && <><p>The first shipment froze all lot allocations and process losses for this work order.</p><p>Frozen revision: {view.frozen.revision}</p><p className="pf-id">Content hash: {view.frozen.contentHash}</p><Link to={`/portfolio/fulfillment/shipments/${view.frozen.firstShipmentId}`}>Open first shipment</Link></>}
      {!!view.sourceHolds.length && <><p role="alert">Active source receipt holds block new finalization and shipment. Historical lot attribution remains recordable; prior consumption is unchanged.</p><ul className="pf-list">{view.sourceHolds.map(hold => <li key={hold.receiptId}><Link to={`/portfolio/warehouse/receipts/${hold.receiptId}`}>Review or release source holds on receipt {hold.receiptId}</Link><span>Reasons: {hold.reasonCodes.join(', ') || 'Legacy hold requiring review'}</span>{hold.holdIds.map(id => <span key={id} className="pf-id">Active hold: {id}</span>)}</li>)}</ul></>}
      <SourceBalances view={view} />
      <details><summary>Stored unit allocations ({view.allocations.length})</summary><AllocationRows rows={view.allocations} /></details>
      <h3>Stored process losses</h3><LossRows rows={view.losses} />
      <p>Incomplete per-unit material requirements: {view.incompleteUnits.length}. Finalization also requires exact source reconciliation, completed QC and cleared source holds.</p>
    </section>
    {view.required && ['QUARANTINED', 'QC_COMPLETED'].includes(wo.status) && view.status !== 'FROZEN' ? <>
      {!!view.units.length && <UnitAttribution key={`units-${view.version}`} path={path} view={view} onSaved={saved} />}
      {!!view.sources.length && <ProcessLosses key={`loss-${view.version}`} path={path} view={view} onSaved={saved} />}
      <GenealogyCommand key={`finalize-${view.version}`} title="Finalize lot genealogy" action="genealogy.finalize" path={`${path}/finalize`} view={view} build={finalizeGenealogyCommand} onSaved={saved} blockedReason={view.canFinalize ? '' : view.status === 'COMPLETE' ? 'This genealogy is already COMPLETE. Any new attribution correction must be finalized again before shipment.' : 'Not ready to finalize. Review incomplete unit ratios, source balances, QC status and source holds above.'}><p>Finalize only the explicit allocations and losses recorded above. A later correction returns the genealogy to DRAFT; the first shipment freezes the entire work order.</p></GenealogyCommand>
    </> : view.status !== 'FROZEN' && <p>Lot attribution becomes available after the final operation creates output. Finalization requires completed QC. Zero-good output needs an explicit process-loss disposition for all consumed material.</p>}
    <GenealogyHistory key={`history-${view.currentRevision}`} path={path} />
    {!!view.sources.length && <ReverseReceiptLookup sources={view.sources} />}
  </>}</Resource>;
}

function SourceBalances({ view }) {
  return <><h3>Consumed source reconciliation</h3>{!view.sources.length ? <p>No final-output consumption sources are available yet. Complete the work order operations to establish the source evidence.</p> : <><p className="pf-muted">Scroll the table horizontally to compare all source quantities.</p><div className="pf-table-wrap pf-genealogy-scroll" role="region" aria-label="Consumed source quantities" tabIndex={0}><table className="pf-balance pf-genealogy-table"><thead><tr><th>Source lot / heat</th><th>Required per unit</th><th>Consumed</th><th>Allocated</th><th>Process loss</th><th>Unattributed</th></tr></thead><tbody>{view.sources.map(source => { const balance = view.balances.find(row => row.receiptId === source.receiptId); return <tr key={source.receiptId}><td><Link to={`/portfolio/warehouse/receipts/${source.receiptId}`}>{source.materialTrace.lotNumber} / {source.materialTrace.heatNumber}</Link><p className="pf-id">Receipt: {source.receiptId}</p><p className="pf-id">Consumption movement: {source.movementId}</p></td><td>{source.quantityPerUnit} {source.uom}</td><td>{balance?.consumedQuantity} {source.uom}</td><td>{balance?.allocatedQuantity} {source.uom}</td><td>{balance?.lossQuantity} {source.uom}</td><td>{balance?.remainingQuantity} {source.uom}</td></tr>; })}</tbody></table></div></>}</>;
}

function AllocationRows({ rows }) {
  return !rows.length ? <p>No per-unit material allocations recorded in this revision.</p> : <ul className="pf-list">{rows.map(row => <li key={`${row.outputUnitId}-${row.receiptId}`}><strong>Output serial: {row.serial}</strong><span>{row.quantity} {row.uom} · Lot {row.materialTrace.lotNumber} · Heat {row.materialTrace.heatNumber}</span><Link to={`/portfolio/warehouse/receipts/${row.receiptId}`}>Open source receipt {row.receiptId}</Link></li>)}</ul>;
}

function LossRows({ rows }) {
  return !rows.length ? <p>No process losses recorded in this revision.</p> : <ul className="pf-list">{rows.map(row => <li key={row.receiptId}><span>{row.quantity} {row.uom} · Lot {row.materialTrace.lotNumber} · Heat {row.materialTrace.heatNumber}</span><span>Reason: {row.reason}</span><Link to={`/portfolio/warehouse/receipts/${row.receiptId}`}>Open source receipt {row.receiptId}</Link></li>)}</ul>;
}

function UnitAttribution({ path, view, onSaved }) {
  const units = view.units.filter(unit => unit.status !== 'SHIPPED'), [selectedId, setSelectedId] = useState(units[0]?._id || '');
  return <GenealogyCommand title="Save unit lot attribution" action="genealogy.record" path={`${path}/allocations`} view={view} build={allocationCommand} onSaved={onSaved} blockedReason={!units.length ? 'No unshipped output units are available for attribution.' : ''}>
    <p>Enter material quantities for one output, including rejected units. Required ratios are reference values. Blank quantities remove that source from this unit; saving replaces only the selected unit's material set.</p>
    <label className="pf-field">Output unit<select name="outputUnitId" value={selectedId} onChange={event => setSelectedId(event.target.value)} required>{units.map(unit => <option key={unit._id} value={unit._id}>{unit.serial} · {unit.status}</option>)}</select></label>
    <div key={selectedId} className="pf-form">{view.sources.map((source, index) => { const stored = view.allocations.find(row => row.outputUnitId === selectedId && row.receiptId === source.receiptId); return <label className="pf-field" key={source.receiptId}>Lot {source.materialTrace.lotNumber} / Heat {source.materialTrace.heatNumber}: attributed quantity ({source.uom}), required {source.quantityPerUnit} per unit<input name={`materialQuantity${index}`} inputMode="decimal" autoComplete="off" defaultValue={stored?.quantity || ''} /></label>; })}</div>
  </GenealogyCommand>;
}

function ProcessLosses({ path, view, onSaved }) {
  return <GenealogyCommand title="Save process losses" action="genealogy.record" path={`${path}/losses`} view={view} build={lossCommand} onSaved={onSaved}>
    <p>Record actual consumed material that did not become an output unit. This replaces the complete current process-loss set. Blank quantities remove the corresponding loss; each entered quantity needs its own reason. No residual is assigned automatically.</p>
    {view.sources.map((source, index) => { const stored = view.losses.find(row => row.receiptId === source.receiptId); return <fieldset key={source.receiptId} className="pf-form"><legend>Lot {source.materialTrace.lotNumber} / Heat {source.materialTrace.heatNumber}</legend><label className="pf-field">Process-loss quantity ({source.uom})<input name={`lossQuantity${index}`} inputMode="decimal" autoComplete="off" defaultValue={stored?.quantity || ''} /></label><label className="pf-field">Process-loss reason for this source<textarea name={`lossReason${index}`} rows={2} minLength={3} maxLength={500} defaultValue={stored?.reason || ''} /></label></fieldset>; })}
  </GenealogyCommand>;
}

function GenealogyHistory({ path }) {
  const [cursor, setCursor] = useState(''), [revision, setRevision] = useState(null), resource = useResource(genealogyPage(`${path}/revisions`, cursor));
  return <section className="pf-panel"><h3>Immutable genealogy revisions</h3><p>Pages use UUID order, which does not imply chronological order. Inspect a numbered revision to read its retained allocation evidence.</p><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No genealogy revisions yet. Save an explicit unit attribution or process-loss disposition to begin.</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><button type="button" onClick={() => setRevision(row.revision)}>Inspect genealogy revision {row.revision}</button><span>{row.status} · {row.reason}</span><span className="pf-id">Recorded by {row.recordedBy} at {row.recordedAt}</span></li>)}</ul>}<div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First revision page</button>}{page.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>Next revision page</button>}</div></>}</Resource>{revision && <RevisionSnapshot key={revision} path={`${path}/revisions/${revision}`} revision={revision} />}</section>;
}

function RevisionSnapshot({ path, revision }) {
  const resource = useResource(path);
  return <Resource resource={resource}>{({ data }) => <section><h3>Immutable genealogy revision {revision}</h3><p>Status: {data.status} · Reason: {data.reason}</p><p className="pf-id">Content hash: {data.contentHash}</p><p className="pf-id">Recorded by {data.recordedBy} at {data.recordedAt}</p><AllocationRows rows={data.allocations} /><LossRows rows={data.losses} /></section>}</Resource>;
}

function ReverseReceiptLookup({ sources }) {
  const [receiptId, setReceiptId] = useState(sources[0].receiptId), [cursor, setCursor] = useState('');
  const resource = useResource(genealogyPage(`/api/manufacturing/genealogy/receipts/${encodeURIComponent(receiptId)}`, cursor));
  return <section className="pf-panel"><h3>Trace a consumed receipt to current output allocations</h3><p>This lookup shows current effective allocations. Retained revisions provide historical evidence. UUID page order does not imply chronology.</p><label className="pf-field">Receipt to trace<select name="traceReceiptId" value={receiptId} onChange={event => { setReceiptId(event.target.value); setCursor(''); }}>{sources.map(source => <option key={source.receiptId} value={source.receiptId}>{source.materialTrace.lotNumber} / {source.materialTrace.heatNumber} · {source.receiptId}</option>)}</select></label><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No current per-unit allocations reference this receipt yet.</p> : <ul className="pf-list">{data.map(row => <li key={`${row.workOrderId}-${row.outputUnitId}-${row.receiptId}`}><Link to={`/portfolio/manufacturing/work-orders/${row.workOrderId}#lot-genealogy`}>Open work order {row.workOrderId}</Link><strong>Output serial: {row.serial}</strong><span>{row.quantity} {row.uom} · Revision {row.revision}</span></li>)}</ul>}<div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First receipt allocation page</button>}{page.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>Next receipt allocation page</button>}</div></>}</Resource></section>;
}
