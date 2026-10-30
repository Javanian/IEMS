import { useState } from 'react';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import { GateCommand } from './QualityWorkspace.jsx';
import Field from '../../components/forms/WorkspaceField.jsx';
import Table from '../../components/tables/WorkspaceTable.jsx';
import RecordShell from '../../components/layout/RecordShell.jsx';

const root = '/api/repair/maintenance/equipment';
export function MaintenanceWorkspace() {
  const [equipmentId, setEquipmentId] = useState('');
  return <><h1>Maintenance and capacity</h1><p>Register equipment in Quality gates, then plan downtime or record maintenance completion.</p>
    <form className="pf-panel pf-form" onSubmit={event => { event.preventDefault(); setEquipmentId(new FormData(event.currentTarget).get('equipmentId')); }}>
      <Field label="Equipment ID" name="equipmentId" required pattern="[0-9a-fA-F-]{36}"/><button>Open equipment</button>
    </form>{equipmentId && <Equipment key={equipmentId} equipmentId={equipmentId}/>}</>;
}
function Equipment({ equipmentId }) {
  const path = `${root}/${equipmentId}`, resource = useResource(path), [interval, setInterval] = useState(null);
  return <Resource resource={resource}>{({ data }) => <RecordShell title="Equipment maintenance" reference={equipmentId} status={`Revision ${data.version}`} updatedAt={data.updatedAt}>
    <button onClick={resource.reload}>Refresh equipment</button>
    <section className="pf-panel"><Table caption="Maintenance windows" rows={data.windows} rowKey={w => w._id} columns={[{key:'kind',label:'Kind'},{key:'from',label:'From (UTC)'},{key:'until',label:'Scheduled until (UTC)'},{key:'status',label:'Status'},{key:'actualUntil',label:'Actual until (UTC)',render:w=>w.actualUntil||'Not completed'},{key:'_id',label:'Actions',render:w=><>{['PLANNED','ACTIVE'].includes(w.status)&&<details><summary>Maintenance actions</summary>{(w.status==='PLANNED'?['start','cancel','complete']:['complete']).map(action=><GateCommand key={`${action}:${data.version}`} action={`maintenance.${action}`} title={`${action[0].toUpperCase()+action.slice(1)} maintenance`} path={`${path}/${action}`} version={data.version} build={v=>({...v,windowId:w._id})} refresh={resource.reload}/>)}</details>}</>}]}/></section>
    <div className="pf-columns"><GateCommand action="maintenance.schedule" title="Schedule downtime" path={`${path}/schedule`} version={data.version} refresh={resource.reload}>
      <Field label="Kind" name="kind" as="select">{['PREVENTIVE','CORRECTIVE','CALIBRATION'].map(kind=><option key={kind}>{kind}</option>)}</Field>
      <Field label="From (UTC, whole minute)" name="from" required placeholder="2026-11-01T08:00:00.000Z"/><Field label="Until (UTC, whole minute)" name="until" required placeholder="2026-11-01T10:00:00.000Z"/>
    </GateCommand><section className="pf-panel"><h2>Available capacity</h2><p>Overlapping downtime is counted once. Active maintenance blocks capacity until completion, including after its scheduled end.</p>
      <form className="pf-form" onSubmit={event=>{event.preventDefault();setInterval(Object.fromEntries(new FormData(event.currentTarget)));}}><Field label="From (UTC, whole minute)" name="from" required/><Field label="Until (UTC, whole minute)" name="until" required/><button>Calculate capacity</button></form>
      {interval&&<Capacity key={`${data.version}:${interval.from}:${interval.until}`} path={`${path}/capacity?${new URLSearchParams(interval)}`}/>}</section></div>
  </RecordShell>}</Resource>;
}
function Capacity({ path }) { const resource=useResource(path); return <Resource resource={resource}>{({data})=><div role="status"><p>Available: {data.availableMinutes} {data.uom}; downtime: {data.unavailableMinutes} {data.uom}; interval: {data.totalMinutes} {data.uom}.</p><p>Equipment revision {data.equipmentVersion}; maintenance revision {data.maintenanceVersion}.</p><button onClick={resource.reload}>Refresh capacity</button></div>}</Resource>; }
