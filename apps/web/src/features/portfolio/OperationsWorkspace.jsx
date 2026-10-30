import { useState } from 'react';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import Field from '../../components/forms/WorkspaceField.jsx';
import Table from '../../components/tables/WorkspaceTable.jsx';
import State from '../../components/ui/WorkspaceState.jsx';
import { operationsRoot, showTime, showValue } from './operations.mjs';

const names = { orders: 'Sales orders', production: 'Production', shipments: 'Shipments', invoices: 'Invoices', receipts: 'Warehouse receipts' };
const columns = [
  { key: 'id', label: 'Record' }, { key: 'status', label: 'Stage' },
  { key: 'quantity', label: 'Quantity', numeric: true, render: r => showValue(r.quantity, r.uom) },
  { key: 'orderAmount', label: 'Order total', numeric: true, render: r => showValue(r.orderAmount, r.currency) },
  { key: 'outstandingAmount', label: 'Invoice outstanding', numeric: true, render: r => showValue(r.outstandingAmount, r.currency) },
  { key: 'ageDays', label: 'Days since update', numeric: true, render: r => showValue(r.ageDays) },
  { key: 'stageAgeDays', label: 'Days in stage', numeric: true, render: r => showValue(r.stageAgeDays) },
  { key: 'updatedAt', label: 'Last recorded update', render: r => showTime(r.updatedAt) },
];
export function OperationsWorkspace() {
  const resource = useResource(`${operationsRoot}/dashboard`), [source, setSource] = useState('production');
  return <div className="pf-operations"><style>{`.pf-operations .pf-workspace-table table{min-width:74rem;table-layout:auto}.pf-operations .pf-workspace-table th{white-space:nowrap}.pf-operations .pf-workspace-table td{min-width:8rem}.pf-operations meter{width:100%;min-width:8rem}`}</style><h1>Operations</h1><p>Current plant activity, recorded aging and available equipment capacity.</p>
    <Resource resource={resource}>{({ data }) => <>
      <section className="pf-panel"><div className="pf-actions"><h2>Plant overview</h2><button onClick={resource.reload}>Refresh overview</button></div>
        <p>Read at {showTime(data.observedAt)}. Source freshness uses the last recorded update, not a device heartbeat.</p>
        <Table caption="Operational sources" rows={Object.entries(data.metrics).map(([id, m]) => ({ id, ...m }))} rowKey={r => r.id} columns={[
          { key: 'id', label: 'Source', render: r => <button onClick={() => setSource(r.id)} aria-pressed={source === r.id}>{names[r.id]}</button> },
          { key: 'status', label: 'Availability' }, { key: 'total', label: 'Records', numeric: true, render: r => showValue(r.total) },
          { key: 'freshness', label: 'Freshness', render: r => `${r.freshness?.status || 'Unknown'} · ${showTime(r.freshness?.observedAt)}` },
          { key: 'completeness', label: 'Coverage' }, { key: 'quantities', label: 'Observed quantities', render: r => r.quantities?.buckets?.map(q => showValue(q.quantity, q.uom)).join('; ') || 'No quantity data' },
        ]}/><p>Quantity totals cover the displayed source page. Different units are kept separate. Financial amounts appear once per order or invoice in the drilldown.</p>
        <p>Metrics use the current domain snapshot. Reporting reconciliation: {data.reportingCoverage.status}. {data.reportingCoverage.manifestId ? `Manifest ${data.reportingCoverage.manifestId}; ${data.reportingCoverage.completeness}; ${data.reportingCoverage.freshness?.status}; observed ${showTime(data.reportingCoverage.observedAt)}.` : 'A reconciled source manifest is not available.'}</p>
        {data.reportingCoverage.manifestId && <details><summary>Reconciliation provenance</summary><p>{data.reportingCoverage.baseline?'Source baseline reconciliation':'Live source reconciliation'}. Valid only as of its observation time. Order watermark: {data.reportingCoverage.sourceHighWater?.salesOrders || 'No source record'}. Fulfillment watermark: {data.reportingCoverage.sourceHighWater?.fulfillmentKeys || 'No source record'}.</p></details>}
      </section>
      <section className="pf-panel"><h2>Order invoice balances</h2><p>One financial row per order, separate from quantity buckets. Balances cover issued invoices only; unallocated deposits and unbilled order value remain outside this balance.</p><Table caption="Observed order invoice balances" rows={data.balances?.rows || []} rowKey={r=>r.orderId} empty="No verified order invoice balances are available." columns={[{key:'orderId',label:'Order'},{key:'status',label:'Completeness'},{key:'orderAmount',label:'Approved order amount',numeric:true,render:r=>showValue(r.orderAmount,r.currency)},{key:'invoicedAmount',label:'Invoiced',numeric:true,render:r=>showValue(r.invoicedAmount,r.currency)},{key:'paidAmount',label:'Paid',numeric:true,render:r=>showValue(r.paidAmount,r.currency)},{key:'creditedAmount',label:'Credited',numeric:true,render:r=>showValue(r.creditedAmount,r.currency)},{key:'outstandingAmount',label:'Invoice balance',numeric:true,render:r=>showValue(r.outstandingAmount,r.currency)}]}/></section>
      <section className="pf-panel"><h2>Early warnings</h2><Table caption="Records needing attention" rows={data.warnings} rowKey={r => r.id} empty="No aging warnings in the observed page. Source gaps remain visible above." columns={[
        { key: 'source', label: 'Source', render: r => names[r.source] }, { key: 'stage', label: 'Stage' }, { key: 'days', label: 'Oldest update (days)', numeric: true },
        { key: 'id', label: 'Action', render: r => <button onClick={() => setSource(r.source)}>Inspect records</button> },
      ]}/></section>
      <Drilldown key={source} source={source}/>
      <section className="pf-panel"><h2>Legacy observations</h2><p>Read adapters share aggregate measurements only. Identity credentials and biometric data are excluded.</p>
        {Object.entries(data.legacy).map(([kind, feed]) => <details key={kind}><summary>{kind}: {feed.status} {feed.freshness?.status || ''}</summary>
          {feed.reason && <p>{feed.reason==='ADAPTER_NOT_CONFIGURED'?'No read adapter is configured for this source.':feed.reason==='SOURCE_ACCESS_DENIED'?'Access to this source is denied.':'The source adapter could not provide a valid observation. Contact the system owner.'}</p>}
          <Table caption={`${kind} observations`} rows={feed.samples} rowKey={r => `${r.resourceId}:${r.sampleAt}`} columns={[{key:'resourceId',label:'Resource'},{key:'value',label:'Value',render:r=>showValue(r.value,r.uom)},{key:'sampleAt',label:'Sample time',render:r=>showTime(r.sampleAt)},{key:'freshness',label:'Sample freshness',render:r=>r.freshness?.status || 'Unknown'},{key:'sourceRevision',label:'Source revision'}]}/>
        </details>)}
      </section>
      <section className="pf-panel"><h2>Registered telemetry</h2><Table caption="Latest registered samples" rows={data.telemetry?.samples || []} rowKey={r=>r.resourceId} empty="No registered telemetry samples have been received." columns={[{key:'mapping',label:'Measurement'},{key:'resourceId',label:'Sample'},{key:'value',label:'Value',numeric:true,render:r=>showValue(r.value,r.uom)},{key:'sampleAt',label:'Sample time',render:r=>showTime(r.sampleAt)},{key:'freshness',label:'Freshness',render:r=>r.freshness.status},{key:'version',label:'Business revision',numeric:true}]}/></section>
    </>}</Resource><Capacity/></div>;
}
function Drilldown({ source }) {
  const [after, setAfter] = useState(''), resource = useResource(`${operationsRoot}/drilldown/${source}${after ? `?after=${encodeURIComponent(after)}` : ''}`);
  return <section className="pf-panel"><h2>{names[source]} drilldown</h2><Resource resource={resource}>{({ data }) => <>
    {data.status === 'ACCESS_DENIED' ? <State kind="error" title="Source access denied">Ask the plant administrator for access to this source.</State> : <>
      <Table caption={`${names[source]} records`} rows={data.records} rowKey={r => r.id} columns={columns}/>
      <p>Production stage aging uses recorded planning, release, operation and quality timestamps. Missing stage times remain unknown.</p>
      <Table caption="Stage aging" rows={data.stages} rowKey={r=>r.stage} columns={[{key:'stage',label:'Stage'},{key:'count',label:'Records',numeric:true},{key:'oldestDaysInStage',label:'Oldest in stage (days)',numeric:true,render:r=>showValue(r.oldestDaysInStage)},{key:'missingStageTimes',label:'Missing stage timestamps',numeric:true},{key:'oldestDaysSinceUpdate',label:'Oldest update (days)',numeric:true,render:r=>showValue(r.oldestDaysSinceUpdate)}]}/>
      <div className="pf-actions">{after && <button onClick={()=>setAfter('')}>First page</button>}{data.nextCursor && <button onClick={()=>setAfter(data.nextCursor)}>Next page</button>}<button onClick={resource.reload}>Refresh records</button></div>
    </>}
  </>}</Resource></section>;
}
function Capacity() {
  const [query, setQuery] = useState(null);
  return <section className="pf-panel"><h2>Equipment capacity</h2><p>Available minutes come from recorded maintenance windows and active equipment holds. No throughput rate is assumed.</p>
    <form className="pf-form" onSubmit={e=>{e.preventDefault(); setQuery(Object.fromEntries(new FormData(e.currentTarget)));}}>
      <Field label="Equipment ID (leave blank for plant heatmap)" name="id" pattern="[0-9a-fA-F-]{36}"/>
      <Field label="Window start (UTC)" name="from" required placeholder="2026-11-01T00:00:00.000Z"/>
      <Field label="Window end (UTC)" name="until" required placeholder="2026-11-02T00:00:00.000Z"/>
      <button>Read capacity</button>
    </form>{query && <CapacityResult key={JSON.stringify(query)} query={query}/>}</section>;
}
function CapacityResult({query}) {
  const resource=useResource(`${operationsRoot}/capacity${query.id?`/${encodeURIComponent(query.id)}`:''}?from=${encodeURIComponent(query.from)}&until=${encodeURIComponent(query.until)}`);
  return <Resource resource={resource}>{({data})=><><p>Capacity uses recorded equipment and maintenance revisions. Coverage: {data.completeness || 'Selected equipment'}.</p><Table caption="Capacity heatmap" rows={data.rows || [data]} rowKey={r=>r.equipmentId} columns={[{key:'equipmentId',label:'Equipment',render:r=>r.label || r.equipmentId},{key:'availableMinutes',label:'Available minutes',numeric:true},{key:'unavailableMinutes',label:'Unavailable minutes',numeric:true},{key:'totalMinutes',label:'Total minutes',numeric:true},{key:'share',label:'Available share',render:r=><meter aria-label={`${r.label || r.equipmentId} available minutes`} min="0" max={Number(r.totalMinutes)} value={Number(r.availableMinutes)}>{r.availableMinutes} / {r.totalMinutes} minutes</meter>},{key:'activeHolds',label:'State',render:r=>`${r.disabled?'Disabled':'Enabled'}; ${r.activeHolds.length} active holds`}]}/></>}</Resource>;
}
