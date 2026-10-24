import { CommandForm } from './ManufacturingWorkspace.jsx';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import { laborCommand } from './labor.mjs';

export function LaborWorkspace({ wo, refresh }) {
  const ledger = useResource(`/api/manufacturing/work-orders/${wo._id}/labor?limit=100`, true);
  const identity = useResource('/api/session/me');
  const index = wo.laborCount || 0;
  const eligible = ['RELEASED', 'IN_PROGRESS'].includes(wo.status) && wo.routing && index < wo.routing.operations.length && index <= wo.records.length;
  return <section aria-label="Operator labor evidence">
    <h2>Operator labor/time</h2>
    <p>Self-recorded OPERATOR_RECORDED evidence only. Not payroll, attendance, qualification or verified physical execution. One immutable entry per operation, up to 50. Labor is optional and does not record output.</p>
    <Resource resource={ledger}>{({ data }) => <div className="pf-panel">{!data.length ? <p>No labor evidence recorded for this work order.</p> : <ol className="pf-list">{data.map(entry => <li key={entry._id}><strong>Operation {entry.operationIndex + 1}: {entry.code}</strong><span>{entry.startedAt} to {entry.endedAt}</span><span>Duration: {entry.durationMs} ms</span><span>Evidence: {entry.evidence}</span><span className="pf-id">Operator: {entry.operatorId} · Recorded by: {entry.recordedBy} · {entry.recordedAt}</span><span>Mode: {entry.executionMode} · Work order version: {entry.workOrderVersion}</span></li>)}</ol>}</div>}</Resource>
    {eligible ? <Resource resource={identity}>{({ data }) => <CommandForm title={`Record labor operation ${index + 1}: ${wo.routing.operations[index].code}`} submitLabel="Record labor evidence" path={`/api/manufacturing/work-orders/${wo._id}/labor`} refresh={refresh} onSaved={refresh} build={(values, key) => laborCommand(wo, values, key, data.user.id)} intro={<><p className="pf-id">Recording only your signed-in operator identity: {data.user.id}</p><p>Enter canonical UTC times with milliseconds, after release {wo.routing.releasedAt}. End must be in the past. Duration must exactly equal end minus start, at most 86400000 ms. Intervals may touch but cannot overlap your other work orders.</p></>}>
      <label className="pf-field">Start UTC (YYYY-MM-DDTHH:mm:ss.sssZ)<input name="startedAt" required pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z" /></label>
      <label className="pf-field">End UTC (YYYY-MM-DDTHH:mm:ss.sssZ)<input name="endedAt" required pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z" /></label>
      <label className="pf-field">Exact duration (integer ms)<input name="durationMs" required inputMode="numeric" pattern="[0-9]+" /></label>
      <label className="pf-field">Labor evidence<textarea name="evidence" required maxLength={1000} rows={3} /></label>
    </CommandForm>}</Resource> : <p>New labor entries require a released or in-progress work order and the next eligible operation. Existing evidence remains read-only.</p>}
  </section>;
}
