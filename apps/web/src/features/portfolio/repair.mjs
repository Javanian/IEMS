export function repairCommand(record, action, values, key) {
 return { expectedVersion: record.version, idempotencyKey: key, ...values };
}
export function repairActions(record) {
 const actions = {INTAKE:['diagnostic-authorize'],DIAGNOSIS_AUTHORIZED:['teardown'],TEARDOWN:['scope'],SCOPE_QUOTED:['scope','decide'],AUTHORIZED:['deposit','start'],IN_PROGRESS:['execute'],TESTING:['test'],REWORK:['rework'],TEST_PASSED:['qc'],READY_FOR_RETURN:['return'],REJECTED:['return'],RETURNED:[]};
 return [...(actions[record.status] || []), ...(record.status === 'RETURNED' ? [] : ['hold'])];
}
