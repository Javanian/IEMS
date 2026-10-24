import { randomUUID } from 'node:crypto';

export function installLabor(app, { c, find, tx, fail, fields, id, text }) {
  app.get('/api/manufacturing/work-orders/:id/labor', async (req, res) => {
    await find('manufacturingWorkOrders', req, req.params.id);
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter, workOrderId: req.params.id };
    if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c('manufacturingLabor').find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  app.post('/api/manufacturing/work-orders/:id/labor', async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'operationIndex', 'operatorId', 'startedAt', 'endedAt', 'durationMs', 'evidence']);
    const b = req.body;
    id(b.operatorId);
    if (b.operatorId !== req.scope.userId) fail(403, 'OPERATOR_DENIED');
    const date = s => {
      if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)) fail(400, 'INVALID_LABOR');
      const d = new Date(s);
      if (!Number.isFinite(d.getTime()) || d.toISOString() !== s) fail(400, 'INVALID_LABOR');
      return d;
    };
    const startedAt = date(b.startedAt), endedAt = date(b.endedAt), evidence = text(b.evidence);
    if (!Number.isSafeInteger(b.operationIndex) || b.operationIndex < 0 || b.operationIndex >= 50 || !Number.isSafeInteger(b.durationMs) || b.durationMs < 1 || b.durationMs > 86400000 || endedAt - startedAt !== b.durationMs) fail(400, 'INVALID_LABOR');
    const data = await tx(req, 'workOrder.labor', async session => {
      const row = await find('manufacturingWorkOrders', req, req.params.id, session);
      if (row.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (!['RELEASED', 'IN_PROGRESS'].includes(row.status)) fail(409, 'STATE_CONFLICT');
      if (b.operationIndex !== (row.laborCount || 0) || b.operationIndex > row.records.length || !row.routing.operations[b.operationIndex]) fail(409, 'OPERATION_SEQUENCE_CONFLICT');
      const recordedAt = new Date();
      if (startedAt < row.routing.releasedAt || endedAt > recordedAt || (row.lastLaborEndedAt && startedAt < row.lastLaborEndedAt)) fail(409, 'LABOR_TIME_CONFLICT');
      // The transaction's user write fence serializes this predicate across WOs.
      if (await c('manufacturingLabor').findOne({ ...req.filter, operatorId: b.operatorId, startedAt: { $lt: endedAt }, endedAt: { $gt: startedAt } }, { session })) fail(409, 'LABOR_TIME_CONFLICT');
      const version = row.version + 1;
      const entry = { _id: randomUUID(), ...req.filter, workOrderId: row._id, workOrderVersion: version, version, operationIndex: b.operationIndex, code: row.routing.operations[b.operationIndex].code, operatorId: b.operatorId, startedAt, endedAt, durationMs: b.durationMs, evidence, recordedBy: req.scope.userId, recordedAt, executionMode: 'OPERATOR_RECORDED' };
      await c('manufacturingLabor').insertOne(entry, { session });
      const saved = await c('manufacturingWorkOrders').updateOne({ ...req.filter, _id: row._id, version: b.expectedVersion }, { $inc: { version: 1, laborCount: 1 }, $set: { lastLaborEndedAt: endedAt, updatedAt: recordedAt } }, { session });
      if (!saved.matchedCount) fail(409, 'VERSION_CONFLICT');
      return entry;
    });
    res.status(201).json({ data });
  });
}
