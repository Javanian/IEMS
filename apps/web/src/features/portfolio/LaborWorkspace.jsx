import { CommandForm } from './ManufacturingWorkspace.jsx';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import { AuditDetails } from './OperatorUi.jsx';
import { laborCommand,nextLaborIndex,laborHours } from './labor.mjs';

export function LaborWorkspace({ wo, refresh }) {
  const ledger = useResource(`/api/manufacturing/work-orders/${wo._id}/labor?limit=100`, true);
  const identity = useResource('/api/session/me');
  const index = nextLaborIndex(wo);
  const eligible = ['RELEASED', 'IN_PROGRESS'].includes(wo.status) && wo.routing && Number.isSafeInteger(index) && index < wo.routing.operations.length && index <= wo.records.length;
  return <section aria-label="Operator labor evidence">
    <h2>Operator labor/time</h2>
    <p>Self-recorded OPERATOR_RECORDED evidence only. Not payroll, attendance, qualification or verified physical execution. One immutable entry per operation, up to 50. Labor is optional and does not record output.</p>
    <Resource resource={ledger}>{({ data }) => <div className="pf-panel">{!data.length ? <p>No labor evidence recorded for this work order.</p> : <ol className="pf-list">{data.map(entry => <li key={entry._id}><strong>Operation {entry.operationIndex + 1}: {entry.code}</strong><span>{entry.startedAt} to {entry.endedAt}</span><span>Elapsed window: {laborHours(entry.durationMs)} hours · Active work: {laborHours(entry.activeDurationMs ?? entry.durationMs)} hours</span><span>Evidence: {entry.evidence}</span><AuditDetails action="manufacturing.read"><p className="pf-id">Operator: {entry.operatorId} · Recorded by: {entry.recordedBy} · {entry.recordedAt}</p><p>Mode: {entry.executionMode} · Work order version: {entry.workOrderVersion} · Elapsed {entry.durationMs} ms · Active {entry.activeDurationMs ?? entry.durationMs} ms</p></AuditDetails></li>)}</ol>}</div>}</Resource>
    {eligible ? <Resource resource={identity}>{({ data }) => <CommandForm title={`Record labor operation ${index + 1}: ${wo.routing.operations[index].code}`} submitLabel="Record labor evidence" path={`/api/manufacturing/work-orders/${wo._id}/labor`} refresh={refresh} onSaved={refresh} build={(values, key) => laborCommand(wo, values, key, data.user.id)} intro={<><p>Recording your signed-in operator identity.</p><AuditDetails action="manufacturing.read"><p className="pf-id">Operator: {data.user.id}</p></AuditDetails><p>Enter canonical UTC times with milliseconds, after release {wo.routing.releasedAt}. End must be in the past. Elapsed duration must exactly equal end minus start. Without an active-work entry the window is at most 24 hours; with explicit active work, the window may span up to 7 days and active work must be positive, no longer than 24 hours or the elapsed window. Intervals may touch but cannot overlap your other work orders.</p></>}>
      <label className="pf-field">Start UTC (YYYY-MM-DDTHH:mm:ss.sssZ)<input name="startedAt" required pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z" /></label>
      <label className="pf-field">End UTC (YYYY-MM-DDTHH:mm:ss.sssZ)<input name="endedAt" required pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z" /></label>
      <label className="pf-field">Exact duration (integer ms)<input name="durationMs" required inputMode="numeric" pattern="[0-9]+" /></label>
      <label className="pf-field">Active work duration (ms, if breaks excluded)<input name="activeDurationMs" inputMode="numeric" pattern="[0-9]+" /></label>
      <label className="pf-field">Labor evidence<textarea name="evidence" required maxLength={1000} rows={3} /></label>
    </CommandForm>}</Resource> : <p>New labor entries require a released or in-progress work order and the next eligible operation. Existing evidence remains read-only.</p>}
  </section>;
}
