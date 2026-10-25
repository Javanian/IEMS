export function optionPath(kind,{ q='',cursor='' } = {}) {
  const eligibility=kind === 'items' ? 'PURCHASED_V2_APPROVED' : 'ACTIVE_VENDOR';
  return `/api/catalog-procurement/options/${kind}?eligibility=${eligibility}&q=${encodeURIComponent(q.trim().slice(0,80))}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}
export function selectionValidity(kind,selected,current) {
  if(!selected?._id)return { ready:true,valid:false,reason:`Choose ${kind === 'items' ? 'an approved item' : 'a vendor'}.` };
  if(!current)return { ready:false,valid:false,reason:'Checking the selected source. Keep its current selection while the check completes.' };
  if(current._id !== selected._id || current.eligible !== true)return { ready:true,valid:false,reason:'The selected source is no longer eligible. Choose another current source.',blockers:current.blockers || [] };
  if(kind === 'items' && (selected.version !== current.version || selected.currentRevision !== current.currentRevision))return { ready:true,valid:false,reason:'The selected item revision changed. Review it and explicitly use the current approved revision, or choose another item.',blockers:['ITEM_CHANGED'] };
  return { ready:true,valid:true,reason:'',blockers:[] };
}
export function createLatestOptions(request,publish) {
  let generation=0,controller;
  return {
    async load(path) {
      controller?.abort();controller=new AbortController();const active=controller,sequence=++generation;
      publish({ loading:true,data:[] });
      try { const result=await request(path,{ signal:active.signal });if(sequence === generation && !active.signal.aborted)publish({ ...result,loading:false }); }
      catch(error) { if(sequence === generation && !active.signal.aborted)publish({ error,loading:false,data:[] }); }
    },
    cancel() { generation++;controller?.abort(); },
  };
}
export function capturedRequestItem(line) { return { _id:line.itemId,code:line.itemCode,version:line.itemVersion,currentRevision:line.itemRevision,content:{ description:line.description,uom:line.uom,trackingPolicy:line.trackingPolicy,kind:line.kind } }; }
