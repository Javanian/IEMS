export async function explainFoundation(db, { tenantId, plantId, userId }) {
  if (![tenantId, plantId, userId].every(value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value))) throw new TypeError('UUID scope required');
  const queries = [
    { collection: 'memberships', filter: { tenantId, userId, active: true } },
    { collection: 'sessions', filter: { tenantId, selectedPlantId: plantId, userId, revoked: false } },
    { collection: 'audit', filter: { tenantId }, sort: { occurredAt: -1, _id: -1 } },
    { collection: 'foundationCommandResults', filter: { tenantId, plantId, userId, action: 'fixture.write', key: 'fixture-1' } },
    { collection: 'outbox', filter: { tenantId, publishedAt: null }, sort: { occurredAt: 1 } }
  ];
  const results = [];
  for (const query of queries) {
    let cursor = db.collection(query.collection).find(query.filter).limit(100).maxTimeMS(5000);
    if (query.sort) cursor = cursor.sort(query.sort);
    const explain = await cursor.explain('executionStats');
    const stats = explain.executionStats;
    results.push({ collection: query.collection, query, winningPlan: explain.queryPlanner.winningPlan, nReturned: stats.nReturned, keysExamined: stats.totalKeysExamined, documentsExamined: stats.totalDocsExamined, executionTimeMillis: stats.executionTimeMillis });
  }
  return { schemaVersion: 1, occurredAt: new Date().toISOString(), results, acceptance: 'MEASUREMENT_ONLY', limitations: ['No contention or production workload acceptance', 'Aggregate-specific query tuning remains with domain owners'] };
}
