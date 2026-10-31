import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';
import WorkspaceTable from '../../components/tables/WorkspaceTable.jsx';

export function TenantLifecycleWorkspace() {
  const identity=useContext(IdentityContext), generation=useRef(0), lock=useRef(false), errorRef=useRef(null);
  const [view,setView]=useState({}), [pending,setPending]=useState(null), [archive,setArchive]=useState(null);
  const storageKey=identity?.scope?.tenantId && identity?.scope?.plantId && identity?.user?.id
    ? `iems.saas:${identity.scope.tenantId}:${identity.scope.plantId}:${identity.user.id}` : null;
  useEffect(()=>{if(view.error)errorRef.current?.focus();},[view.error]);
  useEffect(()=>{
    generation.current++; lock.current=false; setView({});setPending(null);setArchive(null);
    try {if(storageKey) setPending(JSON.parse(sessionStorage.getItem(storageKey)||'null'));}
    catch {setView({error:new Error('Command recovery unavailable. Ask the SaaS operator to reconcile before making changes.')});}
    return ()=>{generation.current++;};
  },[identity,storageKey]);
  async function load() {
    if(lock.current)return;lock.current=true;const current=generation.current;setView(s=>({...s,busy:true,error:null}));
    try {const result=await portfolioRequest('/api/saas/status');if(current===generation.current)setView({data:result.data});}
    catch(error){if(current===generation.current)setView({error});}
    finally {if(current===generation.current)lock.current=false;}
  }
  async function submit(command) {
    if(lock.current)return;lock.current=true;const current=generation.current;setView(s=>({...s,busy:true,error:null}));
    try {
      if(!storageKey)throw new Error('Authenticated command recovery identity unavailable');
      sessionStorage.setItem(storageKey,JSON.stringify(command));setPending(command);
      const result=await portfolioRequest(`/api/saas/${command.action}`,{body:command.body});
      if(current!==generation.current)return;
      if(result.data.data.archiveId)setArchive(result.data.data);
      sessionStorage.removeItem(storageKey);setPending(null);lock.current=false;await load();
    } catch(error){if(current===generation.current){
      const rejected=['INVALID_SAAS_PLAN','SAAS_REASON_REQUIRED','INVALID_METER','REVISION_CONFLICT','SAAS_QUOTA_EXCEEDED','PLAN_BELOW_USAGE','SAAS_INVALID_STATE','TENANT_DATA_PORT_UNAVAILABLE','TENANT_EXPORT_INCOMPLETE','TENANT_EXPORT_TOO_LARGE','ARCHIVE_NOT_CURRENT','ARCHIVE_INTEGRITY_INVALID','EXPORT_STALE'];
      if(rejected.includes(error.code)){try{sessionStorage.removeItem(storageKey);setPending(null);}catch{/* Keep recovery pending if session storage is unavailable. */}}
      setView(s=>({...s,busy:false,error}));
    }}
    finally{if(current===generation.current)lock.current=false;}
  }
  function command(event,action) {
    event.preventDefault();const f=Object.fromEntries(new FormData(event.currentTarget));
    submit({action,body:{...f,key:crypto.randomUUID(),expectedRevision:view.data?.subscription?.revision??0}});
  }
  async function download(event) {
    event.preventDefault();if(lock.current)return;lock.current=true;const current=generation.current;
    setView(s=>({...s,busy:true,error:null}));
    try {
      const archiveId=new FormData(event.currentTarget).get('archiveId');
      const result=await portfolioRequest('/api/saas/download',{body:{archiveId}});
      if(current!==generation.current)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(result.data,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`tenant-export-${archiveId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setView(s=>({...s,busy:false}));
    }catch(error){if(current===generation.current)setView(s=>({...s,busy:false,error}));}
    finally{if(current===generation.current)lock.current=false;}
  }
  const data=view.data,row=data?.subscription,disabled=view.busy||!!pending;
  return <>
    <header className="pf-page-header"><h1>Tenant subscription and lifecycle</h1><p>Manage tenant-wide SaaS entitlements, usage and reversible data archives. Tenant invoices remain in finance.</p></header>
    <button disabled={view.busy} onClick={load}>Refresh subscription</button>
    {view.busy&&<WorkspaceState kind="loading" title="Checking tenant authority"/>}
    {view.error&&<div tabIndex={-1} ref={errorRef}><WorkspaceState kind="error" title="SaaS action unavailable"><p>{errorMessage(view.error,true)}</p></WorkspaceState></div>}
    {pending&&<WorkspaceState title="Unresolved command"><p>Reconcile the exact saved command before submitting another action. Access is checked again.</p><button disabled={view.busy} onClick={()=>submit(pending)}>Reconcile saved command</button></WorkspaceState>}
    {!data&&!view.busy&&!view.error&&<WorkspaceState title="Load the current tenant"><p>A tenant-wide SaaS role is required. No subscription or usage is assumed.</p></WorkspaceState>}
    {data&&<>
      <section className="pf-panel"><h2>{row?.state??'No subscription'}</h2><p>{data.boundary}</p><p>Billing: metering only; no payment collection.</p>
        {row&&<><dl className="pf-dl"><dt>Plan</dt><dd>{row.plan}</dd><dt>Revision</dt><dd>{row.revision}</dd><dt>Usage month (UTC)</dt><dd>{row.period}</dd><dt>Last change (UTC)</dt><dd>{row.changedAt}</dd></dl>
          <WorkspaceTable caption="SaaS usage" columns={[{key:'metric',label:'Meter'},{key:'used',label:'Used',numeric:true},{key:'limit',label:'Included limit',numeric:true}]}
            rows={Object.entries(row.usage).map(([metric,used])=>({metric,used,limit:row.limits[metric]}))} rowKey={r=>r.metric}/></>}
        {(!row||['ACTIVE','SUSPENDED'].includes(row.state))&&<form className="pf-form" onSubmit={e=>command(e,'subscribe')}>
          <WorkspaceField as="select" name="plan" label="SaaS plan" required>{Object.keys(data.plans).map(p=><option key={p} value={p}>{p}</option>)}</WorkspaceField>
          <WorkspaceField name="reason" label="Subscription change reason" maxLength={500} required/><button disabled={disabled}>Save subscription</button></form>}
      </section>
      {row&&<section className="pf-panel"><h2>Lifecycle actions</h2><p>Domain archive adapter: {data.domainLifecycleConfigured?'Configured; complete-scope proof still required':'Unavailable. Domain export, delete and restore are disabled.'}</p>
        {['ACTIVE','SUSPENDED'].includes(row.state)&&<form className="pf-form" onSubmit={e=>command(e,row.state==='ACTIVE'?'suspend':'resume')}><WorkspaceField name="reason" label="Admission change reason" required maxLength={500}/><button disabled={disabled}>{row.state==='ACTIVE'?'Suspend SaaS admission':'Resume SaaS admission'}</button></form>}
        {['ACTIVE','SUSPENDED'].includes(row.state)&&<form className="pf-form" onSubmit={e=>command(e,'export')}><WorkspaceField name="reason" label="Tenant export reason" required maxLength={500}/><button disabled={disabled||!data.domainLifecycleConfigured}>Create scoped tenant export</button></form>}
        {archive&&<p className="pf-id">Export ID: {archive.archiveId} · SHA-256: {archive.digest}</p>}
        <form className="pf-form" onSubmit={download}><WorkspaceField name="archiveId" label="Export UUID to download" required/><button disabled={disabled||!data.domainLifecycleConfigured}>Download authorized export</button></form>
        {['SUSPENDED','ARCHIVED'].includes(row.state)&&<form className="pf-form" onSubmit={e=>command(e,row.state==='ARCHIVED'?'restore':'delete')}>
          <WorkspaceField name="archiveId" label="Current export UUID" required/><WorkspaceField name="digest" label="Confirmed export SHA-256" pattern="[a-f0-9]{64}" required/>
          <WorkspaceField name="reason" label="Reversible archive or restore reason" required maxLength={500}/>
          <p>Archive removes the covered domain dataset into restricted recovery storage. It retains audit and recovery evidence. Restore returns to suspended admission.</p>
          <button disabled={disabled||!data.domainLifecycleConfigured}>{row.state==='ARCHIVED'?'Restore archived tenant data':'Archive tenant data'}</button></form>}
      </section>}
    </>}
  </>;
}
