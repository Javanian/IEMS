import { AuditDetails } from './OperatorUi.jsx';
import { useEffect,useId,useRef,useState } from 'react';
import { portfolioRequest as request } from './client.mjs';
import { Failure } from './PortfolioWorkspace.jsx';
import { MonetarySummary } from './MonetarySummary.jsx';
export function DocumentIssue({kind, sourceId, sourceVersion=1,issueBlockedReason='',downloadBlockedReason=''}) {
 const issueReasonId=useId(),downloadReasonId=useId();
 const [loaded,setLoaded]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false);
 const sourceKey=JSON.stringify([kind,sourceId,sourceVersion]),pending=useRef(null);
 const record=loaded?.sourceKey===sourceKey?loaded.record:null;
 useEffect(()=>{setLoaded(null);setError(null);setBusy(false);return()=>{pending.current?.abort();pending.current=null;};},[sourceKey]);
 async function run(effect){
   if(pending.current)return;
   const controller=new AbortController();pending.current=controller;setBusy(true);setError(null);
   try{await effect(controller.signal);}
   catch(e){if(!controller.signal.aborted)setError(e);}
   finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
 }
 async function issue(){if(issueBlockedReason)return;await run(async signal=>{
   const {data}=await request('/api/documents/issues',{body:{kind,sourceId,sourceVersion},signal});
   if(!signal.aborted)setLoaded({sourceKey,record:data});
 });}
 async function download(){if(downloadBlockedReason||!record)return;await run(async signal=>{
   const base=(import.meta.env?.VITE_PORTFOLIO_API_BASE||'/portfolio-api').replace(/\/$/,'');
   const r=await fetch(`${base}/api/documents/issues/${record._id}/pdf`,{credentials:'include',cache:'no-store',signal});
   if(!r.ok){const body=await r.json();throw Object.assign(new Error(body.error?.message),{status:r.status,code:body.error?.code});}
   const bytes=await r.arrayBuffer();
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(signal.aborted)return;
   if(hash!==record.pdfHash)throw Error('PDF hash does not match issued metadata');
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   const a=document.createElement('a');a.href=url;a.download=`${kind}-${record._id}.pdf`;document.body.append(a);
   try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 });}
 return <section className="pf-panel"><h2>Immutable issued document</h2><p>Source {kind}, revision {sourceVersion}. Amounts come from the issued snapshot, not current settlement balances. Reissuing retrieves the same stored document. Downloads are checked before opening.</p><AuditDetails><p className="pf-id">Source ID: {sourceId}</p></AuditDetails><p role="status">{record ? 'Issued artifact loaded. Issuing again retrieves the same PDF.' : 'No artifact loaded. Issue or retrieve the authorized snapshot below.'}</p><button disabled={busy||!!issueBlockedReason} aria-describedby={issueBlockedReason?issueReasonId:undefined} onClick={issue}>{busy?'Loading document...':'Issue immutable PDF'}</button>{issueBlockedReason&&<p className="pf-disabled-reason" id={issueReasonId}>{issueBlockedReason}</p>}<Failure error={error} retry={issueBlockedReason?undefined:issue}/>{record&&<><AuditDetails><p>Content SHA-256: <span className="pf-id">{record.contentHash}</span></p><p>PDF SHA-256: <span className="pf-id">{record.pdfHash}</span></p></AuditDetails>{kind === 'shipment' ? <p>Non-financial shipment document. No monetary total applies.</p> : <div><p>Issued total: {record.snapshot.currency} {record.snapshot.grossAmount || record.snapshot.total}</p>{record.snapshot.taxPolicy === 'FIXTURE_VAT_11_V1' && <MonetarySummary record={record.snapshot} />}</div>}<button disabled={busy||!!downloadBlockedReason} aria-describedby={downloadBlockedReason?downloadReasonId:undefined} onClick={download}>Download verified PDF</button>{downloadBlockedReason&&<p className="pf-disabled-reason" id={downloadReasonId}>{downloadBlockedReason}</p>}</>}</section>;
}
