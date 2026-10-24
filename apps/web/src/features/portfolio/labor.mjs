export function laborCommand(wo, values, key, operatorId) {
  return { expectedVersion: wo.version, idempotencyKey: key, operationIndex: wo.laborCount || 0, operatorId, startedAt: values.startedAt, endedAt: values.endedAt, durationMs: Number(values.durationMs), evidence: values.evidence };
}
