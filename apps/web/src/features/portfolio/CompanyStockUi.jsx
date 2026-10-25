import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { CatalogCommand, CatalogRead } from './CatalogControls.jsx';
import { AuditDetails, OperatorBlockers } from './OperatorUi.jsx';
import { displayReference, operatorStatus } from './operator.mjs';
import { companyStockBase, companyStockCommand, companyStockHint, companyStockOptionsPath, companyStockRestriction, companyStockVersionMatches, companyUnitId, currentCompanyStock } from './company-stock.mjs';

export function CompanyUnitSelect({ name = 'companyUnitIds', label = 'Actual available manufactured units', units }) {
  return <label className="pf-field">{label}<select name={name} multiple size={Math.max(2, Math.min(6, units.length))}>{units.map(unit => <option key={companyUnitId(unit)} value={companyUnitId(unit)}>{unit.serial}</option>)}</select></label>;
}
export function CompanyStockEvidence({ source }) {
  const identity = useContext(IdentityContext);
  return <div data-company-stock-version={source.version} data-company-receipt-id={source._id}>
    <h3>{displayReference('receipts', source)} · {source.itemSnapshot.code}</h3>
    <p>{source.itemSnapshot.content.description} · Revision {source.itemRevision} · Location {source.locationSnapshot.code}</p>
    <p>Original accepted stock: {source.openingQuantity} {source.uom}. Producer quality accepted {source.qc.acceptedSerials.length}, rejected {source.qc.rejectedSerials.length}. {source.qc.evidence}</p>
    <p>{source.sourcePolicy === 'ONE_HOP_SOURCE' ? 'Stored manufactured component source' : 'Final output: further component reuse is unavailable.'}</p>
    <p>On hand {source.onHandQuantity} · Reserved {source.reservedQuantity} · Issued {source.issuedQuantity} · Consumed {source.consumedQuantity} · Available {source.availableQuantity} · Currently eligible {source.eligibleQuantity} · Blocked {source.blockedQuantity} {source.uom}</p>
    <OperatorBlockers codes={source.blockers.filter(code=>!companyStockRestriction(code))} action="company.stock.read" />
    {source.blockers.filter(code=>companyStockRestriction(code)).map(code=><p key={code} role="status">{companyStockRestriction(code)}</p>)}
    {source.hold?.active && <p role="alert">Company stock hold: {source.hold.reasonCode === 'QUALITY_SUSPECT' ? 'Quality suspect' : 'Trace review'} · {source.hold.reason}</p>}
    <div className="pf-actions">
      {identity?.permissions?.includes('internal.execution.read') && <Link to={`/portfolio/manufacturing/internal-execution/${source.producerExecutionId}`}>Open producer job {displayReference('execution', source.producerExecutionId)}</Link>}
      {identity?.permissions?.includes('company.stock.read') && <Link to={`/portfolio/company-stock/receipts/${source._id}`}>Open company stock {displayReference('receipts',source)}</Link>}
    </div>
    <details><summary>Manufactured unit states</summary><ul className="pf-list">{source.units.map(unit => <li key={companyUnitId(unit)}>{unit.serial} · {operatorStatus(unit.status)}</li>)}</ul></details>
    <AuditDetails action="company.stock.read"><pre>{JSON.stringify(source, null, 2)}</pre></AuditDetails>
  </div>;
}
export function CompanyStockPicker({ material, onChange }) {
  return <CatalogRead action="company.stock.read"><CompanyStockPickerData material={material} onChange={onChange} /></CatalogRead>;
}
function CompanyStockPickerData({ material, onChange }) {
  const [cursor,setCursor] = useState(''), [selected,setSelected] = useState(null), resource = useResource(companyStockOptionsPath(material,cursor));
  const select = row => { onChange(row,false); setSelected(row); };
  return <div className="pf-source-picker"><Resource resource={resource}>{({ data,page }) => <>
    <label className="pf-field">Manufactured company stock receipt<select name="companyReceiptId" required value={selected?._id || ''} onChange={event => { const row = data.find(row => row._id === event.target.value); if (row) select(row); }}><option value="">Select manufactured stock</option>{selected && !data.some(row => row._id === selected._id) && <option value={selected._id}>{label(selected)}</option>}{data.map(row => <option key={row._id} value={row._id}>{label(row)}</option>)}</select></label>
    {!data.length && <p>No company stock matches this exact item revision. Produce, inspect and put away eligible source units first.</p>}
    <div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First company stock page</button>}{page?.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>Next company stock page</button>}</div>
  </>}</Resource>{selected && <CompanySelection key={selected._id} selected={selected} onChange={onChange} onRebind={select} />}</div>;
}
const label = source => `${displayReference('receipts',source)} · ${source.itemSnapshot.code} · Eligible ${source.eligibleQuantity} ${source.uom}`;
function CompanySelection({ selected,onChange,onRebind }) {
  const current = useResource(`${companyStockBase}/${selected._id}`), source = currentCompanyStock(selected,current), valid = companyStockVersionMatches(selected,source), callback = useRef(onChange); callback.current = onChange;
  useEffect(() => { callback.current(selected,valid); }, [selected,valid]);
  return <><Resource resource={current}>{() => source ? <><CompanyStockEvidence source={source} />{!valid && <p role="status">The captured company stock is changed or blocked. Review current evidence before updating your selection.</p>}{source.canReserve && !valid && <button type="button" onClick={() => onRebind(source)}>Use current eligible company stock version</button>}</> : <p role="alert">Current company stock evidence is unavailable. Refresh before reserving any unit.</p>}</Resource><button type="button" onClick={() => { callback.current(selected,false); current.reload(); }}>Refresh selected company stock</button></>;
}
export function CompanyStockPanel({ source,locked,setLocked,onSaved }) {
  const props = { locked,setLocked,onSaved,hint:companyStockHint,retryLabel:'Retry same production command',discardLabel:'Discard production command and refresh',reasonLabel:'Production evidence reason' };
  return <section className="pf-panel" id="internal-company-stock" data-company-stock-version={source.version} data-company-receipt-id={source._id} data-company-source-policy={source.sourcePolicy}>
    <h2>Company output stock receipt</h2><CompanyStockEvidence source={source} />
    <p>Company output stock is unvalued. A component issue uses its actual manufactured identity; embodied raw material is not consumed again. Customer dispatch and installation are unavailable.</p>
    <h3>Directly consumed purchased receipts</h3><ReceiptLinks ids={source.consumedReceiptIds} />
    {source.consumedAncestryReceiptIds && <><h3>Embodied purchased receipt ancestry</h3><ReceiptLinks ids={source.consumedAncestryReceiptIds} /></>}
    <CatalogRead action="company.stock.read">
      {!source.hold?.active ? <CatalogCommand {...props} title="Apply company stock hold" action="company.stock.hold" path={`${companyStockBase}/${source._id}/holds`} build={(values,key) => companyStockCommand(source,values,key)}><label className="pf-field">Hold reason<select name="reasonCode"><option value="QUALITY_SUSPECT">Quality suspect</option><option value="TRACE_REVIEW">Trace review</option></select></label><p>A hold blocks fresh component use. Existing custody and historical consumption stay recorded.</p></CatalogCommand> : <CatalogCommand {...props} title="Release company stock hold" action="company.stock.release" path={`${companyStockBase}/${source._id}/holds/release`} build={(values,key) => companyStockCommand(source,values,key,true)}><p>Release this recorded hold after reviewing the source. This does not restore consumed units or permit further reuse of final output.</p></CatalogCommand>}
      <CompanyStockHistory key={source.version} source={source} locked={locked} />
    </CatalogRead>
  </section>;
}
function ReceiptLinks({ ids }) { return <ul className="pf-list">{(ids || []).map(id => <li key={id}><Link to={`/portfolio/catalog-disposition/receipts/${id}`}>{displayReference('receipts',id)}</Link></li>)}</ul>; }
function CompanyStockHistory({ source,locked }) {
  const [cursor,setCursor] = useState(''), resource = useResource(`${companyStockBase}/${source._id}/events?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <section><h3>Company stock history</h3><button type="button" disabled={!!locked} onClick={resource.reload}>Refresh company stock history</button><Resource resource={resource}>{({ data,page }) => <>{!data.length ? <p>No company stock use events recorded.</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><strong>{operatorStatus(row.kind)}</strong><p>{row.reason}</p><AuditDetails action="company.stock.read"><pre>{JSON.stringify(row,null,2)}</pre></AuditDetails></li>)}</ul>}<div className="pf-actions">{cursor && <button type="button" disabled={!!locked} onClick={()=>setCursor('')}>First company stock history page</button>}{page?.nextCursor && <button type="button" disabled={!!locked} onClick={()=>setCursor(page.nextCursor)}>Next company stock history page</button>}</div></>}</Resource></section>;
}
export function CompanyStockDetail() { return <CatalogRead action="company.stock.read"><CompanyStockDetailData /></CatalogRead>; }
function CompanyStockDetailData() {
  const {id} = useParams(), resource = useResource(`${companyStockBase}/${id}`), [locked,setLock] = useState(''), lock = useRef('');
  const setLocked = value => { lock.current=value; setLock(value); }, refresh = () => { if (!lock.current) resource.reload(); };
  return <><h1>Company stock receipt</h1><button type="button" disabled={!!locked} onClick={refresh}>Refresh company stock</button><Resource resource={resource}>{({data})=><CompanyStockPanel source={data} locked={locked} setLocked={setLocked} onSaved={refresh} />}</Resource></>;
}
