export function laborCommand(wo, values, key, operatorId) {
  return { expectedVersion: wo.version, idempotencyKey: key, operationIndex: nextLaborIndex(wo), operatorId, startedAt: values.startedAt, endedAt: values.endedAt, durationMs: Number(values.durationMs), ...(String(values.activeDurationMs || '').trim() ? {activeDurationMs:Number(values.activeDurationMs)} : {}), evidence: values.evidence };
}
export function nextLaborIndex(wo) { return wo.requiredLaborOperationIndices ? wo.requiredLaborOperationIndices[wo.laborCount || 0] : wo.laborCount || 0; }
export function laborHours(milliseconds) { return new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(milliseconds/3600000); }
