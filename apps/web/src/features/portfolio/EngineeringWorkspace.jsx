import { AuditDetails } from './OperatorUi.jsx';
import { displayReference } from './operator.mjs';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import { CommandForm } from './ManufacturingWorkspace.jsx';
import { WithSerialClaims } from './SerialCustodyWorkspace.jsx';
import { PlanningRead } from './PlanningControls.jsx';
import { engineeringContent, engineeringDraft, engineeringTransition, engineeringRelease } from './engineering.mjs';

const base='/portfolio/manufacturing/engineering';
function Field({label,...props}) { return <label className="pf-field">{label}<input {...props}/></label>; }
function Navigation() { return <nav className="pf-actions" aria-label="Engineering"><Link to={base}>Engineering packages</Link><Link to={`${base}/new`}>Draft from sales order</Link><Link to="/portfolio/manufacturing/work-orders">Work orders</Link></nav>; }
function Boundary() { return <p>Engineering binds a sales order line to operator instructions, receipt materials and approved purchased-item demand. Release freezes a revision. Bind purchased demand to a planned work order for shortage planning; work order release remains a separate stock operation. Revocation blocks new demand claims and future use. No UOM conversion is inferred.</p>; }
function ContentForm({head,order,refresh,onSaved}) {
  const receipts=useResource('/api/warehouse/receipts?limit=100',true);
  const [operations,setOperations]=useState(1),[materials,setMaterials]=useState(1);
  return <><PlanningRead action="master.read"><TypedEngineeringEditor head={head} order={order} refresh={refresh} onSaved={onSaved} /></PlanningRead><Resource resource={receipts}>{({data})=><CommandForm title={head?'Create next engineering revision':'Draft engineering package'} submitLabel={head?'Save engineering revision':'Save engineering draft'} path={head?`/api/manufacturing/engineering/${head._id}/revisions`:'/api/manufacturing/engineering'} refresh={refresh} onSaved={onSaved} build={(v,key)=>{const content=engineeringContent(v,operations,materials,data); return head?{expectedVersion:head.version,idempotencyKey:key,...content}:engineeringDraft(order,v,content,key);}} intro={<p>Enter the complete next revision. Prior revisions are retained. Decimal BOM strings mean material UOM per one output UOM; product equivalence is not inferred.</p>}>
    {!head&&<label className="pf-field">Engineering sales order line<select name="lineIndex">{order.snapshot.lines.map((line,i)=><option key={i} value={i}>Line {i+1}: {line.description} ({line.quantity} {line.uom})</option>)}</select></label>}
    {Array.from({length:operations},(_,i)=><fieldset className="pf-fields" key={`op-${i}`}><legend>Engineering operation {i+1}</legend><Field label="Engineering operation code" name={`code${i}`} required maxLength={1000}/><Field label="Engineering operator instruction" name={`instruction${i}`} required maxLength={1000}/></fieldset>)}
    <div className="pf-actions"><button type="button" disabled={operations>=50} onClick={()=>setOperations(n=>n+1)}>Add engineering operation</button>{operations>1&&<button type="button" onClick={()=>setOperations(n=>n-1)}>Remove last engineering operation</button>}</div>
    {Array.from({length:materials},(_,i)=><fieldset className="pf-fields" key={`material-${i}`}><legend>Engineering material {i+1}</legend><label className="pf-field">Engineering source receipt<select name={`receiptId${i}`} required defaultValue=""><option disabled value="">Select scoped receipt</option>{data.map(r=><option key={r._id} value={r._id}>{displayReference("receipts",r)} · {r.lotNumber || "Lot not recorded"} / {r.heatNumber || "Heat not recorded"} · {r.status} · {r.availableQuantity} {r.uom} available</option>)}</select></label><Field label="Quantity per output unit (exact decimal, selected receipt UOM)" name={`quantityPerUnit${i}`} required inputMode="decimal"/></fieldset>)}
    {!data.length&&<p>No receipts in this plant. Receive actual purchase order material in the warehouse first.</p>}
    <div className="pf-actions"><button type="button" disabled={materials>=100||materials>=data.length} onClick={()=>setMaterials(n=>n+1)}>Add engineering material</button>{materials>1&&<button type="button" onClick={()=>setMaterials(n=>n-1)}>Remove last engineering material</button>}</div>
  </CommandForm>}</Resource></>;
}
function TypedEngineeringEditor({ head, order, refresh, onSaved }) {
  const items = useResource('/api/inventory-master/items?limit=100', true);
  return <Resource resource={items}>{({ data }) => head ? <CurrentTypedEngineering head={head} items={data} refresh={refresh} onSaved={onSaved} /> : <TypedEngineeringFields order={order} items={data} refresh={refresh} onSaved={onSaved} />}</Resource>;
}
function CurrentTypedEngineering({ head, ...props }) {
  const revision = useResource(`/api/manufacturing/engineering/${head._id}/revisions/${head.currentRevision}`);
  return <Resource resource={revision}>{({ data }) => <TypedEngineeringFields key={head.version} head={head} stored={data} {...props} />}</Resource>;
}
function TypedEngineeringFields({ head, order, stored, items, refresh, onSaved }) {
  const [count, setCount] = useState(stored?.purchasedMaterials?.length || 1);
  const eligible = items.filter(item => item.status === 'APPROVED' && item.content.schema === 'INVENTORY_ITEM_V2' && item.content.kind === 'PURCHASED' && ['LOT','SERIAL'].includes(item.content.trackingPolicy));
  return <CommandForm title={head ? 'Revise purchased material demand' : 'Draft item-based engineering demand'} submitLabel="Save purchased material demand draft"
    path={head ? `/api/manufacturing/engineering/${head._id}/revisions` : '/api/manufacturing/engineering'} refresh={refresh} onSaved={onSaved}
    disabledReason={!eligible.length ? 'Approve a purchased inventory item before drafting material demand.' : ''}
    build={(values, key) => {
      const purchasedMaterials = Array.from({ length: count }, (_, index) => {
        const item = eligible.find(row => row._id === values[`demandItem${index}`]);
        if (!item) throw Object.assign(new Error('Choose a current approved purchased item.'), { local: true });
        return { itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantityPerUnit: values[`demandRatio${index}`], uom: item.content.uom };
      });
      const content = { operations: stored?.operations || [{ code: values.operationCode, instruction: values.operationInstruction }], materials: stored?.materials || [], purchasedMaterials };
      return head ? { expectedVersion: head.version, idempotencyKey: key, ...content } : engineeringDraft(order, values, content, key);
    }} intro={<p>Approve item requirements before purchasing. Quantities are material UOM per output UOM. This draft does not reserve or consume stock. After release, bind the exact package to a planned customer work order.</p>}>
    {!head && <><label className="pf-field">Sales order line<select name="lineIndex">{order.snapshot.lines.map((line,index) => <option key={index} value={index}>Line {index + 1}: {line.description} ({line.quantity} {line.uom})</option>)}</select></label><Field label="Operation code" name="operationCode" required maxLength={1000} /><Field label="Operator instruction" name="operationInstruction" required maxLength={1000} /></>}
    {Array.from({ length: count }, (_, index) => <fieldset className="pf-fields" key={index}><legend>Purchased requirement {index + 1}</legend>
      <label className="pf-field">Approved purchased item<select name={`demandItem${index}`} defaultValue={stored?.purchasedMaterials?.[index]?.itemId || ''} required><option value="" disabled>Select current approved item</option>{eligible.map(item => <option key={item._id} value={item._id}>{item.code} · {item.content.description} · Revision {item.currentRevision} · {item.content.uom}</option>)}</select></label>
      <Field label="Material quantity per output unit" name={`demandRatio${index}`} defaultValue={stored?.purchasedMaterials?.[index]?.quantityPerUnit || ''} inputMode="decimal" required />
    </fieldset>)}
    <div className="pf-actions"><button type="button" disabled={count >= 20} onClick={() => setCount(value => value + 1)}>Add purchased requirement</button>{count > 1 && <button type="button" onClick={() => setCount(value => value - 1)}>Remove last purchased requirement</button>}</div>
    {stored?.materials?.length > 0 && <p>Existing receipt requirements and routing operations are retained in this new revision.</p>}
  </CommandForm>;
}
export function EngineeringList() {
  const location=useLocation(), cursor=new URLSearchParams(location.search).get('cursor');
  const resource=useResource(`/api/manufacturing/engineering${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);
  return <><h1>Engineering packages</h1><Navigation/><Boundary/><Resource resource={resource}>{({data,page})=><section className="pf-panel">{!data.length?<p>No engineering packages yet. Draft from a persisted sales order line.</p>:<ul className="pf-list">{data.map(h=><li key={h._id}><Link to={`${base}/${h._id}`}>{displayReference("engineering",h)}</Link><span>{h.status} · Revision {h.currentRevision}</span><AuditDetails action="manufacturing.read"><p>Version: {h.version}</p></AuditDetails></li>)}</ul>}<div className="pf-actions">{cursor&&<Link to={base}>First page</Link>}{page.nextCursor&&<Link to={`?cursor=${page.nextCursor}`}>Next page</Link>}</div></section>}</Resource></>;
}
export function EngineeringNew() {
  const {id}=useParams(),navigate=useNavigate();
  const orders=useResource(id?`/api/commercial/orders/${id}`:'/api/commercial/orders?limit=100',!id);
  return <><h1>Draft engineering from sales order</h1><Navigation/><Boundary/><Resource resource={orders}>{({data})=>!id?<section className="pf-panel"><ul className="pf-list">{data.filter(o=>o.status==='OPEN').map(o=><li key={o._id}><Link to={`${base}/new/${o._id}`}>{displayReference("orders",o)}</Link></li>)}</ul>{!data.some(o=>o.status==='OPEN')&&<p>No open sales orders. Convert an accepted quote first.</p>}</section>:<><section className="pf-panel"><AuditDetails action="manufacturing.read"><p className="pf-id">Source sales order: {data._id}</p></AuditDetails><p>Status: {data.status}</p><AuditDetails action="manufacturing.read"><p>Version: {data.version}</p></AuditDetails><Link to={`/portfolio/orders/${data._id}`}>Open source sales order</Link></section>{data.status==='OPEN'&&<ContentForm order={data} refresh={orders.reload} onSaved={h=>navigate(`${base}/${h._id}`)}/>}</>}</Resource></>;
}
function Revision({id,revision}) {
  const resource=useResource(`/api/manufacturing/engineering/${id}/revisions/${revision}`);
  return <Resource resource={resource}>{({data})=><section className="pf-panel"><h2>Stored engineering revision {revision}</h2><ol className="pf-list">{data.operations.map((op,i)=><li key={i}><strong>{op.code}</strong><span>{op.instruction}</span></li>)}</ol><ul className="pf-list">{data.materials.map(m=><li key={m.receiptId}><Link to={`/portfolio/warehouse/receipts/${m.receiptId}`}>{displayReference("receipts",m.receiptId)}</Link><span>{m.quantityPerUnit} {m.uom} per output unit</span></li>)}</ul>
    {!!data.purchasedMaterials?.length && <><h3>Purchased item demand</h3><ul className="pf-list">{data.purchasedMaterials.map(material => <li key={material.lineId}><Link to={`/portfolio/inventory-master/items/${material.itemId}`}>{material.itemSnapshot.code}</Link><span>{material.quantityPerUnit} {material.uom} per output UOM · Item revision {material.itemRevision}</span></li>)}</ul></>}
    {data.releaseSnapshot&&<><h3>Immutable release snapshot</h3><AuditDetails action="manufacturing.read"><p className="pf-id">Released by {data.releaseSnapshot.releasedBy} at {data.releaseSnapshot.releasedAt}</p></AuditDetails><p>Retained through later revisions and prospective revocation.</p></>}</section>}</Resource>;
}
export function EngineeringDemandBinding({ wo, refresh }) {
  const packages = useResource('/api/manufacturing/engineering?limit=100', true);
  return <Resource resource={packages}>{({ data }) => {
    const eligible = data.filter(head => head.status === 'RELEASED' && head.salesOrderId === wo.salesOrderId && head.salesOrderVersion === wo.salesOrderVersion && head.lineIndex === wo.lineIndex && head.uom === wo.uom);
    return <CommandForm title="Bind approved purchased demand" submitLabel="Bind engineering demand to work order" path={`/api/manufacturing/work-orders/${wo._id}/material-demand`} refresh={refresh} onSaved={refresh}
      disabledReason={!eligible.length ? 'Release engineering for this sales order line before binding demand.' : ''}
      build={(values, key) => { const head = eligible.find(row => row._id === values.engineeringId); if (!head) throw Object.assign(new Error('Select released engineering for this work order.'), { local: true }); return { expectedVersion: wo.version, idempotencyKey: key, engineeringId: head._id, engineeringVersion: head.version, revision: head.currentRevision }; }}
      intro={<p>Bind an explicitly approved purchased-item requirement set. The server scales material quantities to this work order and checks source approvals again on refresh and claim. This does not release the work order or reserve stock.</p>}>
      <label className="pf-field">Released engineering package<select name="engineeringId" defaultValue="" required><option value="" disabled>Select approved demand package</option>{eligible.map(head => <option key={head._id} value={head._id}>{displayReference('engineering',head)} · Revision {head.currentRevision}</option>)}</select></label>
      {wo.materialDemandEngineering && <p>Current binding: revision {wo.materialDemandEngineering.revision}. <Link to={`${base}/${wo.materialDemandEngineering.engineeringId}`}>Review demand engineering</Link></p>}
    </CommandForm>;
  }}</Resource>;
}
export function EngineeringDetail() {
  const {id}=useParams(),resource=useResource(`/api/manufacturing/engineering/${id}`);
  const [selected,setSelected]=useState(null);
  return <><Navigation/><Resource resource={resource}>{({data:h})=><><h1>Engineering package</h1><Boundary/><section className="pf-panel" data-engineering-version={h.version}><AuditDetails action="manufacturing.read"><p className="pf-id">Engineering ID: {h._id}</p></AuditDetails><p>Status: {h.status} · Revision: {h.currentRevision}</p><p>Output UOM: {h.uom} · SO line {h.lineIndex+1}</p><AuditDetails action="manufacturing.read"><p>Version: {h.version} · Pinned SO version: {h.salesOrderVersion}</p></AuditDetails><Link to={`/portfolio/orders/${h.salesOrderId}`}>Open source sales order</Link><button type="button" onClick={resource.reload}>Refresh engineering package</button>{h.revocation&&<p>Revocation reason: {h.revocation.reason}</p>}<label className="pf-field">Inspect retained revision<select value={selected||h.currentRevision} onChange={e=>setSelected(Number(e.target.value))}>{Array.from({length:h.currentRevision},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label></section><Revision key={`${h.version}-${selected||h.currentRevision}`} id={id} revision={selected||h.currentRevision}/>
    {h.status==='DRAFT'&&<CommandForm key={`release-${h.version}`} title="Release engineering revision" submitLabel="Release engineering revision" path={`/api/manufacturing/engineering/${id}/release`} build={(_,key)=>engineeringTransition(h,key)} refresh={resource.reload} onSaved={resource.reload} intro={<p>Freeze latest revision {h.currentRevision}. This does not reserve stock.</p>}/>}
    {h.status==='RELEASED'&&<CommandForm key={`revoke-${h.version}`} title="Revoke future engineering use" submitLabel="Revoke engineering revision" path={`/api/manufacturing/engineering/${id}/revoke`} build={(v,key)=>engineeringTransition(h,key,v.reason)} refresh={resource.reload} onSaved={resource.reload} intro={<p>Already released work orders keep their frozen routing and reservations.</p>}><Field label="Engineering revocation reason" name="reason" required maxLength={1000}/></CommandForm>}
    {h.currentRevision<100&&<ContentForm key={`revision-${h.version}`} head={h} refresh={resource.reload} onSaved={()=>{setSelected(null);resource.reload();}}/>}
  </>}</Resource></>;
}
export function EngineeringWorkOrderRelease({wo,refresh}) {
  const packages=useResource('/api/manufacturing/engineering?limit=100',true);
  return <WithSerialClaims wo={wo}>{claims => <Resource resource={packages}>{({data})=>{const eligible=data.filter(h=>h.status==='RELEASED'&&h.salesOrderId===wo.salesOrderId&&h.salesOrderVersion===wo.salesOrderVersion&&h.lineIndex===wo.lineIndex&&h.uom===wo.uom);return <CommandForm title="Release from frozen engineering" submitLabel="Release work order from engineering" path={`/api/manufacturing/work-orders/${wo._id}/release-engineering`} refresh={refresh} onSaved={refresh} disabledReason={wo.serialCustodyRequired && !claims.claims.some(claim => claim.status === 'CLAIMED') ? 'Claim every engineering source before release. The frozen receipt, ratio and UOM set must exactly match all active claims.' : ''} build={(v,key)=>engineeringRelease({ ...wo, version:claims.workOrderVersion },eligible.find(h=>h._id===v.engineeringId),key,claims.claims)} intro={<p>Select a currently released package for this exact source line and UOM. Server copies its frozen snapshot and reserves material atomically.</p>}><label className="pf-field">Released engineering package<select name="engineeringId" required defaultValue=""><option value="" disabled>Select matching released package</option>{eligible.map(h=><option key={h._id} value={h._id}>{displayReference("engineering",h)} · Revision {h.currentRevision}</option>)}</select></label>{!eligible.length&&<p>No matching released package. <Link to={base}>Review engineering packages</Link>.</p>}</CommandForm>;}}</Resource>}</WithSerialClaims>;
}
