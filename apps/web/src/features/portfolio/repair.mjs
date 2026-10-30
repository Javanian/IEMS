export function repairCommand(record, action, values, key) {
 return { expectedVersion: record.version, idempotencyKey: key, ...values };
}
export function repairActions(record) {
 const actions = {INTAKE:['diagnostic-authorize'],DIAGNOSIS_AUTHORIZED:['teardown'],TEARDOWN:['scope'],SCOPE_QUOTED:['scope','decide'],AUTHORIZED:['deposit','start'],IN_PROGRESS:['execute'],TESTING:['test'],REWORK:['rework'],TEST_PASSED:['qc'],READY_FOR_RETURN:['return'],REJECTED:['return'],RETURNED:[]};
 const warranty = record.status === 'RETURNED' && record.decision?.decision === 'ACCEPT' ? !record.warranty ? ['warranty'] : record.warranty.status === 'ACTIVE' ? ['warranty-claim', 'warranty-void'] : [] : [];
 const controlled = ['TEARDOWN','SCOPE_QUOTED','AUTHORIZED','IN_PROGRESS','TESTING','REWORK'].includes(record.status) ? ['test-plan'] : [];
 const components = [...(['IN_PROGRESS','REWORK'].includes(record.status) && record.scopes?.at(-1)?.findings?.some(f=>['REPLACE','SCRAP'].includes(f.disposition)&&!record.componentRemovals?.some(c=>c.component===f.component)) ? ['component-remove'] : []), ...(record.componentRemovals?.some(c=>c.status==='QUARANTINED') ? ['component-dispose'] : [])];
 return [...(actions[record.status] || []), ...controlled, ...components, ...warranty, ...(record.status === 'RETURNED' ? [] : ['hold'])];
}
