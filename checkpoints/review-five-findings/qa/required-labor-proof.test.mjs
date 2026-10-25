import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { domainSnapshot, withReplacement } from '../../wave4map/qa/mapping-fixture.mjs';

const key = () => randomUUID();

test('required labor gates each operation before it becomes unreachable and validates stored evidence at QC', async t => {
  const h = await startOwned(t, { seedOptions: { e01Operators: true } }), stock = await orderWithStock(h, { orderQuantity: '1', receiptQuantity: '2', reserve: false });
  const operator = h.seeded.find(row => row.username === 'alpha.operator.cnc'), cookie = await h.login(operator.username);
  const batch = await h.ok('/manufacturing/work-orders', { salesOrderId: stock.so._id, expectedVersion: stock.so.version, lineIndex: 0, quantities: ['1'], uom: 'KG', requiredLaborOperationIndices: [0, 1], idempotencyKey: key() }, 201);
  const route = `/manufacturing/work-orders/${batch.workOrders[0]._id}`;
  let wo = await h.ok(`${route}/release`, { expectedVersion: 1, operations: [{ code: 'QA-LABOR-0', instruction: 'Actual labor before first operation' }, { code: 'QA-LABOR-1', instruction: 'Actual labor before final operation' }], materials: [{ receiptId: stock.receipt._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: key() });
  const record = index => ({ expectedVersion: wo.version, operationIndex: index, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', uom: 'KG', evidence: `Synthetic actual operation${index} outcome`, idempotencyKey: key() });
  async function denied(path, payload) { const before = await domainSnapshot(h), response = await h.req(path, payload, h.alpha); assert.equal(response.status, 409, JSON.stringify(response)); assert.equal(response.error.code, 'LABOR_EVIDENCE_REQUIRED'); assert.deepEqual(await domainSnapshot(h), before); }
  let lastEnded;
  async function labor(index) {
    const start = new Date(lastEnded || wo.routing.releasedAt);
    while (Date.now() - start.getTime() < 3) await new Promise(resolve => setTimeout(resolve, 5));
    const end = new Date(), duration = end - start;
    const entry = await h.ok(`${route}/labor`, { expectedVersion: wo.version, operationIndex: index, operatorId: operator.userId, startedAt: start.toISOString(), endedAt: end.toISOString(), durationMs: duration, activeDurationMs: duration, evidence: `Synthetic actual operator entry for operation${index}`, idempotencyKey: key() }, 201, cookie);
    lastEnded = end; wo = await h.ok(route); return entry;
  }

  await denied(`${route}/record`, record(0));
  await labor(0); wo = await h.ok(`${route}/record`, record(0)); assert.equal(wo.status, 'IN_PROGRESS');
  await denied(`${route}/record`, record(1));
  await labor(1); wo = await h.ok(`${route}/record`, record(1)); assert.equal(wo.status, 'QUARANTINED');
  const qc = () => ({ expectedVersion: wo.version, acceptedQuantity: '1', rejectedQuantity: '0', uom: 'KG', evidence: 'Synthetic actual QC after both required labor entries', idempotencyKey: key() });
  const proof = await h.db.collection('manufacturingLabor').findOne({ workOrderId: wo._id, operationIndex: 0 });
  await h.db.collection('manufacturingLabor').deleteOne({ _id: proof._id });
  try { await denied(`${route}/qc`, qc()); }
  finally { await h.db.collection('manufacturingLabor').insertOne(proof); }
  for (const change of [
    { durationMs: String(proof.durationMs) },
    { activeDurationMs: null },
    { activeDurationMs: proof.durationMs + 1 },
    { startedAt: 'not-a-date' },
    { endedAt: new Date(proof.startedAt.getTime() - 1) },
    { evidence: '' },
    { operatorId: h.seeded.find(row => row.username === 'beta.owner').userId },
    { recordedBy: randomUUID() },
    { operatorId: '-'.repeat(36), recordedBy: '-'.repeat(36) },
  ]) await withReplacement(h, 'manufacturingLabor', proof, { ...proof, ...change }, () => denied(`${route}/qc`, qc()));
  wo = await h.ok(`${route}/qc`, qc()); assert.equal(wo.status, 'QC_COMPLETED');
  assert.equal(await h.db.collection('manufacturingLabor').countDocuments({ workOrderId: wo._id }), 2);
  assert.equal((await h.ok(`${route}/labor`)).length, 2);
});
