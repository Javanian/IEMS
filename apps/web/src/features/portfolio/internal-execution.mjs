export const executionBase='/api/internal-execution/orders';
export const executionUi='/portfolio/manufacturing/internal-execution';
export function executionCommand(head,values,key,extra={}) { return { expectedVersion:head?.version || 1,reason:values.reason.trim(),idempotencyKey:key,...extra }; }
export function stockOptionsPath(material,{q='',cursor=''}={}) { return `/api/catalog-stock/receipts?itemId=${encodeURIComponent(material.itemId)}&itemRevision=${material.itemRevision}&q=${encodeURIComponent(q.trim().slice(0,80))}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`; }
export function sourceVersionMatches(captured,current) { return !!captured && !!current && typeof captured.receiptId==='string' && !!captured.receiptId && [captured.version,current.version,captured.receiptVersion,current.receiptVersion].every(value=>Number.isSafeInteger(value) && value>0) && captured.receiptId === current.receiptId && captured.version === current.version && captured.receiptVersion === current.receiptVersion && current.canAllocate === true; }
export function currentStockEvidence(selected,resource) {
  const source=resource.data;
  return !resource.loading && !resource.error && source && !Array.isArray(source) && source.receiptId===selected?.receiptId && source.receipt && !Array.isArray(source.receipt) && typeof source.receipt.uom==='string' && Array.isArray(source.units) ? source : null;
}
export function consumedSourceIdentities(source,view) {
  const own=new Set(view.reservations.filter(row=>row.receiptId===source.receiptId && row.executionId===view._id && row.status==='CONSUMED').flatMap(row=>row.serials));
  return source.units.filter(unit=>unit.status==='CONSUMED' && unit.executionId===view._id && own.has(unit.serial)).map(unit=>unit.serial);
}
export function attributionSources(sources,values) { return sources.flatMap((source,i)=>{const quantity=String(values[`quantity${i}`] || '').trim();if(!quantity || /^0(?:\.0{1,6})?$/.test(quantity))return [];return [{receiptId:source.receiptId,quantity,...(source.source.trackingPolicy === 'SERIAL' ? {serials:values[`serials${i}`] || []} : {})}];}); }
export function outputIdentities(value) { return String(value || '').split(/[\s,]+/).filter(Boolean); }
export function executionNextAction(view) { return ({PLANNED:'Reserve every material requirement, then release production.',RELEASED:'Issue the reserved material to production.',ISSUED:'Record actual work for the first operation.',IN_PROGRESS:'Record the next routing operation.',QUARANTINED:'Attribute consumed material to every output and process loss, then record output QC.',QC_RELEASED:view.qc?.acceptedSerials?.length ? 'Put away the accepted output at a qualified company location.' : 'Review rejected output; no accepted stock can be put away.',STORED:'Review the company stock receipt and retained production evidence.'})[view.status] || 'Review current production evidence.'; }
