import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { Failure, IdentityContext, useResource } from './PortfolioWorkspace.jsx';
import { AuditDetails } from './OperatorUi.jsx';
import { displayReference, operatorBlocker, operatorStatus } from './operator.mjs';
import { companyStockRestriction, companyUnitId } from './company-stock.mjs';
import { companyTraceHint, companyUnitTracePath, currentCompanyUnitTrace, traceUseGroups } from './company-stock-trace.mjs';

export function CompanyStockTrace({ source, locked }) {
  const [unitId, setUnitId] = useState(''), [binding, setBinding] = useState(null);
  return <section id="company-unit-trace" className="pf-panel pf-form">
    <h2>Manufactured unit trace</h2>
    <p>Review exact recorded material attribution and affected downstream candidates for one actual unit. This read does not apply a recall, change a hold, or permit dispatch or further reuse.</p>
    <form aria-label="Trace an actual manufactured unit" className="pf-form" onSubmit={event => { event.preventDefault(); if (!locked && source.units.some(unit => companyUnitId(unit) === unitId)) setBinding({ receiptId:source._id, unitId }); }}>
      <fieldset className="pf-form" disabled={!!locked}>
        <label className="pf-field">Actual manufactured unit<select name="traceUnitId" required value={unitId} onChange={event => { setUnitId(event.target.value); setBinding(null); }}><option value="">Select an actual serial</option>{source.units.map(unit => <option key={companyUnitId(unit)} value={companyUnitId(unit)}>{unit.serial}</option>)}</select></label>
        <button className="pf-primary" disabled={!unitId}>Load manufactured unit trace</button>
      </fieldset>
    </form>
    {locked && <p className="pf-disabled-reason">Resolve the retained production command before changing or refreshing the trace.</p>}
    {binding && <TraceRead key={`${binding.receiptId}-${binding.unitId}`} binding={binding} locked={locked} />}
  </section>;
}
function TraceRead({ binding, locked }) {
  const resource = useResource(companyUnitTracePath(binding.receiptId, binding.unitId)), data = currentCompanyUnitTrace(binding, resource);
  return <>
    <button type="button" disabled={!!locked} onClick={resource.reload}>Refresh manufactured unit trace</button>
    <p className="pf-muted">This is a read snapshot. Refresh to review later reservations, attribution and restrictions.</p>
    {resource.loading ? <p role="status">Loading manufactured unit trace...</p> : resource.error ? <><Failure error={resource.error} retry={!locked ? resource.reload : undefined} />{companyTraceHint(resource.error) && <p role="alert">{companyTraceHint(resource.error)}</p>}</> : data ? <TraceEvidence data={data} /> : <p role="alert">A complete trace for the selected unit is unavailable. Refresh the receipt before reviewing another unit.</p>}
  </>;
}
function JobLink({ id, children }) {
  const identity = useContext(IdentityContext);
  return identity?.permissions?.includes('internal.execution.read') ? <Link to={`/portfolio/manufacturing/internal-execution/${id}`}>{children || `Open production job ${displayReference('execution',id)}`}</Link> : <span>{children || displayReference('execution',id)}</span>;
}
function RawSources({ sources }) {
  const identity = useContext(IdentityContext), canRead = identity?.permissions?.includes('catalog.qc.read');
  return !sources.length ? <p>No directly attributed purchased sources are recorded for this unit.</p> : <ul className="pf-list">{sources.map((source,index) => <li key={`${source.receiptId}-${index}`}>
    <strong>{displayReference('receipts',source.receiptId)}{source.lotNumber ? ` · Lot ${source.lotNumber} · Heat ${source.heatNumber}` : ''}</strong>
    <span>Attributed quantity {source.quantity} {source.uom}</span>
    {!!source.serials?.length && <p>Actual received serials: {source.serials.join(', ')}</p>}
    {canRead && <Link to={`/portfolio/catalog-disposition/receipts/${source.receiptId}`}>Review purchased receipt {displayReference('receipts',source.receiptId)}</Link>}
    <AuditDetails action="company.stock.read"><pre>{JSON.stringify(source,null,2)}</pre></AuditDetails>
  </li>)}</ul>;
}
function TraceEvidence({ data }) {
  return <div data-trace-unit-id={data.companyUnitId} data-trace-complete="true" data-trace-stock-version={data.current.stockVersion}>
    <h3>Trace for serial {data.serial}</h3>
    <p>{data.itemSnapshot.code} · {data.itemSnapshot.content.description} · Location {data.locationSnapshot.code}</p>
    <p>Current unit state: {operatorStatus(data.current.status)} · {data.current.eligible ? 'Currently eligible for its permitted use' : 'Currently restricted or already committed'}</p>
    {data.current.blockers.map(code => <p key={code} role="status">{companyStockRestriction(code) || operatorBlocker(code)}</p>)}
    <p>{data.sourcePolicy === 'LEAF_ONLY' ? 'Final output: further reuse and dispatch remain unavailable.' : 'Manufactured component: this trace does not create a new use entitlement.'}</p>
    <div className="pf-actions"><JobLink id={data.producer.executionId} /></div>
    <h3 id="company-trace-exact-purchased">Exact purchased sources attributed to this output</h3><RawSources sources={data.ancestry.purchasedSources} />
    <h3>Exact manufactured sources attributed to this output</h3>
    {!data.ancestry.companySources.length ? <p>No manufactured component was attributed to this output.</p> : <ul className="pf-list">{data.ancestry.companySources.map(source => <li key={source.companyUnitId}><strong>Component serial {source.serial}</strong><span>Attributed quantity {source.quantity}</span><div className="pf-actions"><Link to={`/portfolio/company-stock/receipts/${source.companyReceiptId}`}>Review component stock {displayReference('receipts',source.companyReceiptId)}</Link><JobLink id={source.producerExecutionId} /></div><h4>Purchased sources attributed to this component</h4><RawSources sources={source.purchasedSources} /></li>)}</ul>}
    <section><h3>Current restriction scope</h3><p>Quality hold checks conservatively include all purchased receipts actually consumed by the producer batch. This wider hold set is separate from the exact output attribution above.</p><p>{data.holdPolicy.directHold?.active ? `A direct company hold is active: ${data.holdPolicy.directHold.reason}` : 'No active direct company hold is recorded in this snapshot.'}</p><p>Producer-batch purchased receipts considered for hold checks: {data.holdPolicy.receiptIds.map(id => displayReference('receipts',id)).join(', ') || 'None'}</p><AuditDetails action="company.stock.read"><pre>{JSON.stringify({holdPolicy:data.holdPolicy,current:data.current},null,2)}</pre></AuditDetails></section>
    <h3 id="company-trace-downstream">Downstream use and affected candidates</h3><p>These are recorded candidates for review, not a completed recall or an automatic quality disposition. Process loss and abandoned reservations do not identify a new output.</p>
    {traceUseGroups.map(([key,title]) => <section key={key} data-trace-use-group={key}><h4>{title}</h4>{!data.uses[key].length ? <p>No records in this category.</p> : <ul className="pf-list">{data.uses[key].map((use,index) => <li key={`${use.reservationId}-${use.output?.outputUnitId || index}`}><JobLink id={use.consumer.executionId} /><span>Job: {operatorStatus(use.consumer.status)} · Reservation: {use.reservationStatus === 'RELEASED' ? 'Abandoned' : operatorStatus(use.reservationStatus)} · Selected component quantity {use.selectedQuantity}</span>{use.output && <><strong>Output serial {use.output.serial}</strong><span>Output: {operatorStatus(use.output.status)} · Quality: {use.output.qcDisposition ? operatorStatus(use.output.qcDisposition) : 'Not yet decided'}</span>{use.output.companyReceiptId && <Link to={`/portfolio/company-stock/receipts/${use.output.companyReceiptId}`}>Review resulting company stock {displayReference('receipts',use.output.companyReceiptId)}</Link>}</>}{key === 'losses' && <p>Recorded process loss quantity {use.quantity}. No output identity is implied.</p>}{key === 'consumedUnattributed' && <p>The component was consumed, but its output or loss attribution is not yet recorded.</p>}{key === 'abandoned' && <p>Historical reservation only. It does not establish consumption or an affected output.</p>}<AuditDetails action="company.stock.read"><pre>{JSON.stringify(use,null,2)}</pre></AuditDetails></li>)}</ul>}</section>)}
    <AuditDetails action="company.stock.read"><pre data-company-unit-trace>{JSON.stringify(data,null,2)}</pre></AuditDetails>
  </div>;
}
