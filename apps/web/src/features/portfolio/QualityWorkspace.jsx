import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext, Failure, Resource, useResource } from './PortfolioWorkspace.jsx';
import { portfolioRequest } from './client.mjs';
import Field from '../../components/forms/WorkspaceField.jsx';
import Table from '../../components/tables/WorkspaceTable.jsx';
import RecordShell from '../../components/layout/RecordShell.jsx';

const root = '/api/repair/quality/resources';
export function GateCommand({ action, title, path, version, build = v => v, refresh, children }) {
  const identity = useContext(IdentityContext), [busy, setBusy] = useState(false), [error, setError] = useState(null), [pending, setPending] = useState(false);
  const attempt = useRef(null), lock = useRef(false), mounted = useRef(false), alert = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  if (!identity?.permissions?.includes(action)) return null;
  const discard = () => { attempt.current = null; setPending(false); setError(null); refresh(); };
  async function send() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { await portfolioRequest(path, { body: attempt.current }); if (mounted.current) discard(); }
    catch (e) { if (mounted.current) setError(e); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className="pf-panel pf-form" onSubmit={event => {
    event.preventDefault(); if (pending || lock.current) return;
    try { attempt.current = { ...build(Object.fromEntries(new FormData(event.currentTarget))), expectedVersion: version, idempotencyKey: crypto.randomUUID() }; setPending(true); send(); }
    catch (e) { setError(e); }
  }}><h3>{title}</h3><fieldset className="pf-form" disabled={busy || pending}>{children}<Field label="Evidence" name="evidence" as="textarea" required maxLength={1000}/></fieldset>
    {error && <div ref={alert} tabIndex={-1}><Failure error={error} mutation/></div>}
    {!pending && <button className="pf-primary" disabled={busy}>{title}</button>}
    {pending && error && <><p>Check the current record before discarding an uncertain result. Retrying sends the same command and key.</p>{(!error.status || error.status >= 500) && <button type="button" onClick={send} disabled={busy}>Retry same command</button>}<button type="button" onClick={discard} disabled={busy}>Discard command and refresh</button></>}
    {busy && <p role="status">Saving...</p>}
  </form>;
}
export function QualityWorkspace() {
  const [cursor, setCursor] = useState(''), [target, setTarget] = useState(null), resources = useResource(`${root}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h1>Quality gates</h1><p>Track holds, equipment calibration and operator qualifications for the selected plant.</p>
    <form className="pf-panel pf-form" onSubmit={event => { event.preventDefault(); const v = Object.fromEntries(new FormData(event.currentTarget)); setTarget({ type: v.type, id: v.resourceId }); }}>
      <h2>Open a resource</h2><Field label="Resource type" name="type" as="select">{['REPAIR_CASE','WORK_ORDER','COMPANY_UNIT','RECEIPT','EQUIPMENT','OPERATOR'].map(type => <option key={type}>{type}</option>)}</Field>
      <Field label="Resource ID" name="resourceId" required pattern="[0-9a-fA-F-]{36}" hint="Use the record identifier from the repair, stock, work order or operator record."/>
      <button>Open quality record</button><button type="button" onClick={() => setTarget({ type: 'EQUIPMENT', id: crypto.randomUUID() })}>Register equipment</button>
    </form>
    <Resource resource={resources}>{({ data, page }) => <section className="pf-panel"><h2>Plant quality records</h2><Table caption="Quality register" rows={data} rowKey={r => r._id} columns={[
      { key: 'label', label: 'Resource', render: r => <button type="button" onClick={() => setTarget({ type: r.resourceType, id: r.resourceId })}>{r.label || r.resourceId}</button> },
      { key: 'resourceType', label: 'Type' }, { key: 'version', label: 'Revision', numeric: true }, { key: 'holds', label: 'Active holds', render: r => r.holds.filter(h => h.active).length },
      { key: 'calibration', label: 'Calibration valid until', render: r => r.calibration?.validUntil || 'Not recorded' }
    ]}/><div className="pf-actions">{cursor && <button onClick={() => setCursor('')}>First page</button>}{page.nextCursor && <button onClick={() => setCursor(page.nextCursor)}>Next page</button>}<button onClick={resources.reload}>Refresh register</button></div></section>}</Resource>
    {target && <QualityRecord key={`${target.type}:${target.id}`} target={target} onSaved={resources.reload}/>}
  </>;
}
function QualityRecord({ target, onSaved }) {
  const path = `${root}/${target.type}/${target.id}`, resource = useResource(path);
  const refresh = () => { resource.reload(); onSaved(); };
  return <Resource resource={resource}>{({ data }) => {
    const command = (action, title, children, build) => <GateCommand key={`${action}:${data.version}`} action={`quality.${action}`} title={title} path={`${path}/${action}`} version={data.version} refresh={refresh} build={build}>{children}</GateCommand>;
    return <RecordShell title={data.label || `${target.type} quality record`} reference={target.id} status={data.disabled ? 'Disabled' : `${data.holds.filter(h => h.active).length} active holds`} updatedAt={data.updatedAt}>
      <p>Revision {data.version}. Calibration and qualification validity are checked when a controlled operation is submitted.</p>
      <Table caption="Hold history" rows={data.holds} rowKey={h => h._id} columns={[{ key: 'reasonCode', label: 'Reason' }, { key: 'evidence', label: 'Evidence' }, { key: 'active', label: 'State', render: h => h.active ? 'Active' : 'Released' }, { key: '_id', label: 'Action', render: h => h.active && <GateCommand action="quality.release" title="Release hold" path={`${path}/release`} version={data.version} build={v => ({ ...v, holdId: h._id })} refresh={refresh}/> }]}/>
      <div className="pf-columns"><section>{command('configure', 'Save resource details', <><Field label="Label" name="label" defaultValue={data.label} required maxLength={1000}/><Field label="Availability" name="disabled" as="select" defaultValue={String(Boolean(data.disabled))}><option value="false">Enabled</option><option value="true">Disabled</option></Field></>, v => ({ ...v, disabled: v.disabled === 'true' }))}
        {command('hold', 'Place quality hold', <Field label="Reason" name="reasonCode" as="select">{['QUALITY_SUSPECT','TRACE_REVIEW','SAFETY','MAINTENANCE'].map(reason => <option key={reason}>{reason}</option>)}</Field>)}
      </section><section>{target.type === 'EQUIPMENT' && <><p>Calibration certificate: {data.calibration?.certificate || 'Not recorded'}. Valid until: {data.calibration?.validUntil || 'Not recorded'}.</p>{command('calibrate', 'Record calibration', <><ValidityFields/><Field label="Certificate reference" name="certificate" required maxLength={1000}/></>)}</>}
      {target.type === 'OPERATOR' && <><Table caption="Operator qualifications" rows={data.qualifications} rowKey={q => q.operation} columns={[{key:'operation',label:'Operation'},{key:'active',label:'State',render:q=>q.active?'Active':'Revoked'},{key:'validUntil',label:'Valid until'}]}/>{command('qualify', 'Record qualification', <><Field label="Operation code" name="operation" required maxLength={1000}/><ValidityFields/><Field label="Qualification state" name="active" as="select"><option value="true">Active</option><option value="false">Revoked</option></Field></>, v => ({ ...v, active: v.active === 'true' }))}</>}
      </section></div>
    </RecordShell>;
  }}</Resource>;
}
function ValidityFields() { return <><Field label="Valid from (UTC)" name="validFrom" required placeholder="2026-10-31T00:00:00.000Z"/><Field label="Valid until (UTC)" name="validUntil" required placeholder="2027-10-31T00:00:00.000Z"/></>; }
