export function repairCommand(record, action, values, key) {
 return { expectedVersion: record.version, idempotencyKey: key, ...values };
}
export function repairActions(record) {
 const actions = {INTAKE:['diagnostic-authorize'],DIAGNOSIS_AUTHORIZED:['teardown'],TEARDOWN:['scope'],SCOPE_QUOTED:['scope','decide'],AUTHORIZED:['deposit','start'],IN_PROGRESS:['execute'],TESTING:['test'],REWORK:['rework'],TEST_PASSED:['qc'],READY_FOR_RETURN:['return'],REJECTED:['return'],RETURNED:[]};
 if(record.serviceProfile==='REPAIR_SERVICE_V1'&&!record.serviceOrders){actions.AUTHORIZED=['deposit','orders'];actions.REJECTED=['orders'];}
 const warranty = record.status === 'RETURNED' && record.decision?.decision === 'ACCEPT' ? !record.warranty ? record.serviceProfile&& !record.finalInvoiceId ? [] : ['warranty'] : record.warranty.status === 'ACTIVE' ? ['warranty-claim', 'warranty-void'] : [] : [];
 const controlled = ['TEARDOWN','SCOPE_QUOTED','AUTHORIZED','IN_PROGRESS','TESTING','REWORK'].includes(record.status) ? ['test-plan'] : [];
 const components = [...(['IN_PROGRESS','REWORK'].includes(record.status) && record.scopes?.at(-1)?.findings?.some(f=>(['REPLACE','SCRAP'].includes(f.disposition)||record.status==='REWORK'&&record.spareMaterials?.some(m=>m.component===f.component&&m.cycle===record.tests.at(-1)?.run))&&(!record.componentRemovals?.some(c=>c.component===f.component)||record.replacements?.some(r=>r.component===f.component&&!record.componentRemovals?.some(c=>c.sourceReplacementId===r._id)))) ? ['component-remove'] : []), ...(record.componentRemovals?.some(c=>c.status==='QUARANTINED') ? ['component-dispose'] : [])];
 return [...(actions[record.status] || []), ...controlled, ...components, ...warranty, ...(record.status === 'RETURNED' ? [] : ['hold'])];
}
