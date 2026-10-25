import { useEffect,useRef,useState } from 'react';
import { portfolioRequest as request } from './client.mjs';
import { Failure } from './PortfolioWorkspace.jsx';
import { AuditDetails } from './OperatorUi.jsx';
import { createLatestOptions,optionPath,selectionValidity } from './server-options.mjs';

export function ServerOptionPicker({ kind,name,label,initial,onBindingChange }) {
  const [selected,setSelected]=useState(initial || null),[current,setCurrent]=useState(null),[draft,setDraft]=useState(''),[query,setQuery]=useState(''),[cursor,setCursor]=useState(''),[attempt,setAttempt]=useState(0),[result,setResult]=useState({ loading:true,data:[] }),[hydrateError,setHydrateError]=useState(null);
  const callback=useRef(onBindingChange),loader=useRef(null);callback.current=onBindingChange;
  if(!loader.current)loader.current=createLatestOptions(request,setResult);
  useEffect(() => { loader.current.load(optionPath(kind,{ q:query,cursor }));return () => loader.current.cancel(); },[kind,query,cursor,attempt]);
  useEffect(() => {
    if(!selected?._id){setCurrent(null);setHydrateError(null);return;}
    const controller=new AbortController();setHydrateError(null);
    request(`/api/catalog-procurement/options/${kind}/${selected._id}`,{ signal:controller.signal }).then(response => { if(!controller.signal.aborted)setCurrent(prior => prior?._id === response.data._id && prior.version > response.data.version ? prior : response.data); }).catch(error => { if(!controller.signal.aborted){setCurrent(null);setHydrateError(error);} });
    return () => controller.abort();
  },[kind,selected?._id,attempt]);
  useEffect(() => { const found=result.data?.find(row => row._id === selected?._id);if(found)setCurrent(prior => prior?._id === found._id && prior.version > found.version ? prior : found); },[result.data,selected?._id]);
  const status=selectionValidity(kind,selected,current),stale=kind === 'items' && current?.eligible && selected && (selected.version !== current.version || selected.currentRevision !== current.currentRevision),noun=kind === 'items' ? 'items' : 'vendors';
  useEffect(() => { callback.current?.(selected,{ ...selectionValidity(kind,selected,current),...(hydrateError ? { ready:true,valid:false,reason:'The selected source could not be checked. Refresh it or choose another source.' } : {}) }); },[kind,selected,current,hydrateError]);
  const search=() => { setQuery(draft.trim());setCursor('');setAttempt(value => value+1); };
  const optionLabel=row => kind === 'items' ? `${row.code || 'Item'}: ${row.content?.description || ''} · Revision ${row.currentRevision} · ${row.content?.uom || ''}` : row.name || current?.name || 'Selected vendor';
  const choices=(result.data || []).filter(row => row._id !== selected?._id);
  return <fieldset className="pf-source-picker pf-form" data-option-picker={name}><legend>{label}</legend><div className="pf-fields"><label className="pf-field">Search {noun} by {kind === 'items' ? 'code or description' : 'name'}<input name={`${name}Search`} value={draft} maxLength={80} onChange={event => setDraft(event.target.value)} onKeyDown={event => {if(event.key === 'Enter'){event.preventDefault();search();}}} /></label><button type="button" onClick={search}>Search {noun}</button></div>
    <label className="pf-field">{label}<select name={name} required value={selected?._id || ''} onChange={event => { if(event.target.value === selected?._id)return;const row=(result.data || []).find(option => option._id === event.target.value);setSelected(row || null);setCurrent(row || null);setHydrateError(null); }}><option value="">Choose {kind === 'items' ? 'an approved item' : 'a vendor'}</option>{selected && <option value={selected._id}>{optionLabel(selected)} (selected)</option>}{choices.map(row => <option key={row._id} value={row._id}>{optionLabel(row)}</option>)}</select></label>
    {result.loading && <p role="status">Searching current {noun}...</p>}{result.error && <Failure error={result.error} retry={() => setAttempt(value => value+1)} />}{!result.loading && !result.error && !result.data?.length && <p>No eligible {noun} match this search. Try a different prefix.</p>}
    <div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First {noun} results</button>}{!result.loading && result.page?.nextCursor && <button type="button" onClick={() => setCursor(result.page.nextCursor)}>Next {noun} results</button>}{selected && <button type="button" onClick={() => setAttempt(value => value+1)}>Refresh selected {kind === 'items' ? 'item' : 'vendor'}</button>}</div>
    {selected && !status.valid && <p className="pf-disabled-reason" role="status">{hydrateError ? 'The selected source could not be checked. Refresh it or choose another source.' : status.reason}</p>}{stale && <button type="button" onClick={() => setSelected(current)}>Use current approved revision</button>}
    <p className="pf-muted">Results are live and paginated. Your selected source stays fixed when you search or change pages.</p><AuditDetails action={kind === 'items' ? 'master.read' : 'procurement.read'}><p>Selected identity: {selected?._id || 'None'}</p>{kind === 'items' && <p>Captured revision: {selected?.currentRevision} · Captured version: {selected?.version} · Current version: {current?.version}</p>}<p>Source diagnostics: {current?.blockers?.join(', ') || 'None'}</p></AuditDetails>
  </fieldset>;
}
