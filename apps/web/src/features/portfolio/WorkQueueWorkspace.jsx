import { useContext,useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { IdentityContext,Resource,useResource } from './PortfolioWorkspace.jsx';
import { displayReference,operatorStatus,quantitySummary,executionQueueAction,operatorBlocker } from './operator.mjs';
import { normalizePage,reasonLabel } from './holds.mjs';
import { AuditDetails } from './OperatorUi.jsx';
import { portfolioRequest } from './client.mjs';
import { operationalQueueEvidence,planningQueueAction,deliveryQueueAction } from './operator-queue.mjs';
const SOURCES = [
  { key:'inquiries',group:'Sales',label:'Inquiries to progress',permission:'quote.read',path:'/api/commercial/inquiries?limit=25',url:'/portfolio/inquiries',kind:'inquiry',next:row => row.stage === 'QUOTED' ? null : row.stage === 'DRAFT' ? 'Complete and submit inquiry' : 'Review inquiry and prepare quotation' },
  { key:'quotes',group:'Sales',label:'Quotations to progress',permission:'quote.read',path:'/api/commercial/quotes?limit=25',url:'/portfolio/quotes',kind:'quote',next:row => row.status === 'DRAFT' ? 'Approve quotation' : row.status === 'APPROVED' ? 'Record customer acceptance' : row.status === 'ACCEPTED' ? 'Create sales order' : null },
  { key:'requests',group:'Operations',label:'Purchasing approvals',permission:'catalog.read',path:'/api/catalog-procurement/requests?limit=25',url:'/portfolio/catalog-procurement/requests',kind:'request',next:row => row.status === 'DRAFT' ? 'Review and approve purchase request' : row.status === 'APPROVED' ? 'Create purchase order' : null },
  { key:'receiving',group:'Operations',label:'Purchase orders to receive',permission:'catalog.read',path:'/api/catalog-procurement/orders?limit=25',url:'/portfolio/catalog-procurement/orders',kind:'purchaseOrder',next:row => row.status === 'DRAFT' ? 'Issue purchase order' : row.status === 'ISSUED' && row.receiving.some(line => line.remainingQuantity !== '0') ? 'Record actual receipt' : null },
  { key:'quality',group:'Operations',label:'Receiving quality and putaway',permission:'catalog.read',path:'/api/catalog-procurement/receipts?limit=25',url:'/portfolio/catalog-procurement/receipts',kind:'receipt',next:row => row.status === 'QUARANTINED' ? 'Record and approve inspection' : row.status === 'CATALOG_QC_APPROVED' ? 'Put away accepted stock' : null },
  { key:'planning',group:'Operations',label:'Internal production planning',permission:'internal.read',path:'/api/internal-production/orders?limit=25',url:'/portfolio/manufacturing/internal-production',kind:'internalOrder',next:planningQueueAction },
  { key:'internal-execution',group:'Operations',label:'Internal production execution',permission:'internal.execution.read',path:'/api/internal-execution/orders?limit=25',url:'/portfolio/manufacturing/internal-execution',kind:'execution',next:executionQueueAction },
  { key:'holds',group:'Operations',label:'Active material holds',permission:'warehouse.read',path:'/api/warehouse/holds?status=ACTIVE&limit=25',url:'/portfolio/warehouse/holds?status=ACTIVE',kind:'receipt',next:()=> 'Review the actual receipt quality hold' },
  { key:'production',group:'Operations',label:'Customer production',permission:'manufacturing.read',path:'/api/manufacturing/work-orders?limit=25',url:'/portfolio/manufacturing/work-orders',kind:'workOrder',next:row => ['QC_COMPLETED','CANCELLED'].includes(row.status) ? null : row.status === 'PLANNED' ? 'Review materials and release work' : row.status === 'QUARANTINED' ? 'Record output quality decision' : 'Record the next operation' },
  { key:'delivery',group:'Sales',label:'Dispatch and delivery',permission:'fulfillment.read',path:'/api/fulfillment/shipments?limit=25',url:'/portfolio/fulfillment/shipments',kind:'shipment',next:deliveryQueueAction },
  { key:'billing',group:'Sales',label:'Payments to follow up',permission:'fulfillment.read',path:'/api/fulfillment/invoices?limit=25',url:'/portfolio/fulfillment/invoices',kind:'invoice',next:row => row.status === 'PAID' ? null : 'Review invoice and allocate payment' },
];
export function WorkQueue() {
  const identity=useContext(IdentityContext),sources=SOURCES.filter(source => identity?.permissions?.includes(source.permission));
  return <section id="operator-work-queue"><header className="pf-record-heading"><div><h1>Work queue</h1><p>Choose the next sales or plant task. Every row opens its actual record.</p></div><p className="pf-next-action"><strong>Scope of this view</strong><span>Up to 25 current records per permitted source. These are page results, not company-wide totals.</span></p></header>{!sources.length ? <p>No work sources are available with your current permissions. Ask an administrator to review your role.</p> : <>{['Sales','Operations'].map(group => <section key={group} aria-label={`${group} work`}><h2>{group} work</h2>{sources.filter(source => source.group === group).map(source => <QueueSource key={source.key} source={source} />)}</section>)}</>}<section className="pf-panel"><h2>Planning and delivery evidence</h2><p>Open a task to see item quantities, its current blocker and the next action. Shipped quantity and confirmed delivery are separate.</p></section></section>;
}
function QueueSource({ source }) {
  if(['delivery','planning'].includes(source.key))return <OperationalQueueSource source={source} />;
  return <OrdinaryQueueSource source={source} />;
}
function OrdinaryQueueSource({ source }) {
  const resource=useResource(source.path);
  return <section className="pf-panel" data-queue-source={source.key}><div className="pf-toolbar"><h3>{source.label}</h3><button type="button" onClick={resource.reload}>Refresh {source.label.toLowerCase()}</button></div><Resource resource={resource}>{({ data,page }) => {
    const currentPage=normalizePage({data,page}),records=currentPage.items,rows=records.map(row => ({ row,next:source.next(row) })).filter(entry => entry.next);
    return <><p className="pf-muted">{rows.length} action{rows.length === 1 ? '' : 's'} among {records.length} records on this page{currentPage.nextCursor ? '; more source records exist.' : '.'}</p>{!rows.length ? <p>No action is needed among these records. Refresh or open the source list to review other pages.</p> : <ul className="pf-list">{rows.map(({ row,next }) => <li key={row._id || row.id}><Link to={source.key === "holds" ? `/portfolio/warehouse/receipts/${row.receiptId}` : `${source.url}/${row._id}`}>{displayReference(source.kind,source.key === "holds" ? row.receiptId : row)}</Link><strong>{next}</strong>{source.key === 'holds' && <p>{reasonLabel(row.reasonCode)}{row.appliedBy?.displayName ? ` · Applied by ${row.appliedBy.displayName}` : ''}</p>}{source.key === 'internal-execution' && <><p>{row.sourceDemand.itemSnapshot.code} · {row.sourceDemand.itemSnapshot.content.description}</p><p>Required materials: {row.materials.map(material=>`${material.itemSnapshot.code}: ${material.requiredQuantity} ${material.uom}`).join('; ')}</p>{!!row.blockers?.length && <p>{row.blockers.map(operatorBlocker).join(' ')}</p>}<AuditDetails action={source.permission}><p>Current source restrictions: {row.blockers?.join(', ') || 'None'}</p></AuditDetails></>}<span>{operatorStatus(row.status || row.stage)}{quantitySummary(row.revisions?.at(-1) || row) ? ` · ${quantitySummary(row.revisions?.at(-1) || row)}` : ''}</span>{row.dueAt || row.dueDate ? <span>Due {row.dueAt || row.dueDate}</span> : null}{source.key === "billing" && !row.dueAt && !row.dueDate && <p className="pf-muted">No invoice due date is available here; no overdue metric is inferred.</p>}{row.assignee?.displayName && <span>Assigned to {row.assignee.displayName}</span>}</li>)}</ul>}{source.key !== 'quality' && <Link to={source.url}>Open all {source.label.toLowerCase()}</Link>}<AuditDetails action={source.permission}><p>Source query: {source.path}. Cursor ordering follows the source API. No unrequested collections or later pages are counted.</p></AuditDetails></>;
  }}</Resource></section>;
}

function OperationalQueueSource({source}) {
  const resource=useResource(source.path),identity=useContext(IdentityContext),canReadExecution=identity?.permissions?.includes('internal.execution.read');
  return <section className="pf-panel" data-queue-source={source.key}><div className="pf-toolbar"><h3>{source.label}</h3><button type="button" onClick={resource.reload}>Refresh {source.label.toLowerCase()}</button></div><Resource resource={resource}>{({data,page})=><OperationalRows source={source} records={data} page={page} canReadExecution={canReadExecution} refresh={resource.reload} />}</Resource></section>;
}
function OperationalRows({source,records,page,canReadExecution,refresh}) {
  const [resource,setResource]=useState({loading:true});
  useEffect(()=>{
    const controller=new AbortController();setResource({loading:true});
    operationalQueueEvidence(source.key,records,portfolioRequest,{signal:controller.signal,canReadExecution}).then(data=>{if(!controller.signal.aborted)setResource({data});}).catch(error=>{if(!controller.signal.aborted)setResource({error});});
    return ()=>controller.abort();
  },[source.key,records,canReadExecution]);
  return <Resource resource={{...resource,reload:refresh}}>{({data})=>{
    const actions=data.map(row=>({row,next:source.next(row)})).filter(entry=>entry.next);
    return <><p className="pf-muted">{actions.length} action{actions.length===1?'':'s'} among {records.length} records on this page{page?.nextCursor?'; more source records exist.':'.'}</p>{!actions.length?<p>No action is needed among these records. Refresh or open the source list to review other pages.</p>:<ul className="pf-list">{actions.map(({row,next})=><li key={row._id}><Link to={`${source.url}/${row._id}`}>{displayReference(source.kind,row)}</Link><strong>{next}</strong>{source.key==='delivery'?<><span>{operatorStatus(row.delivery.status)}</span><span>Dispatched: {row.quantity} {row.uom} · Confirmed received: {row.delivery.deliveredQuantity} · Still to confirm: {row.delivery.remainingQuantity} {row.uom}</span></>:<><span>{operatorStatus(row.engineering.status)}</span><span>{quantitySummary(row)}</span></>}</li>)}</ul>}<Link to={source.url}>Open all {source.label.toLowerCase()}</Link><AuditDetails action={source.permission}><p>Source query: {source.path}. Current delivery or existing-job evidence is hydrated with at most four concurrent scoped reads. Counts cover this source page only.</p></AuditDetails></>;
  }}</Resource>;
}
