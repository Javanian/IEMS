import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand, releaseCommand, recordCommand, qcCommand, nextOperation, manufacturingHint } from '../src/features/portfolio/manufacturing.mjs';

test('plan uses actual SO version and line UOM, splits on whitespace and keeps exact strings', () => {
  const order = { _id: 'so', version: 1, snapshot: { lines: [{ uom: 'EA' }, { uom: 'KG' }] } };
  const body = planCommand(order, { lineIndex: '1', quantities: ' 0.750\n0.5  1 ' }, 'owned-key');
  order.version = 2;
  assert.deepEqual(body, { salesOrderId: 'so', expectedVersion: 1, lineIndex: 1, uom: 'KG', quantities: ['0.750', '0.5', '1'], idempotencyKey: 'owned-key' });
});
test('release builds ordered routing and material rows without coercing ratios', () => {
  const wo = { version: 1 };
  const values = { code0: ' MIX ', instruction0: 'Operator mixes', code1: 'PACK', instruction1: 'Operator packs', receiptId0: 'r1', quantityPerUnit0: '2.000', materialUom0: 'EA' };
  assert.deepEqual(releaseCommand(wo, values, 2, 1, 'owned-key'), { expectedVersion: 1, operations: [{ code: ' MIX ', instruction: 'Operator mixes' }, { code: 'PACK', instruction: 'Operator packs' }], materials: [{ receiptId: 'r1', quantityPerUnit: '2.000', uom: 'EA' }], idempotencyKey: 'owned-key' });
});
test('record derives operation index, input and UOM from the server work order', () => {
  const wo = { version: 3, quantity: '0.75', uom: 'EA', routing: { operations: [{ code: 'MIX' }, { code: 'PACK' }] }, records: [{ goodQuantity: '0.7' }] };
  assert.deepEqual(nextOperation(wo), { index: 1, code: 'PACK', inputQuantity: '0.7' });
  assert.deepEqual(nextOperation({ ...wo, records: [] }), { index: 0, code: 'MIX', inputQuantity: '0.75' });
  assert.deepEqual(recordCommand(wo, { goodQuantity: '0.650', scrapQuantity: '0.05', evidence: 'Operator note' }, 'owned-key'), { expectedVersion: 3, operationIndex: 1, inputQuantity: '0.7', goodQuantity: '0.650', scrapQuantity: '0.05', uom: 'EA', evidence: 'Operator note', idempotencyKey: 'owned-key' });
});
test('qc keeps accepted/rejected strings and work order UOM', () => {
  assert.deepEqual(qcCommand({ version: 4, uom: 'EA' }, { acceptedQuantity: '0.6', rejectedQuantity: '0.05', evidence: 'Inspector note' }, 'owned-key'), { expectedVersion: 4, acceptedQuantity: '0.6', rejectedQuantity: '0.05', uom: 'EA', evidence: 'Inspector note', idempotencyKey: 'owned-key' });
});
test('manufacturing conflict codes explain the domain cause', () => {
  assert.match(manufacturingHint({ code: 'QUANTITY_EXCEEDED' }), /sales order line/);
  assert.match(manufacturingHint({ code: 'CONSERVATION_CONFLICT' }), /good \+ scrap/);
  assert.equal(manufacturingHint({ code: 'VERSION_CONFLICT' }), null);
  assert.equal(manufacturingHint(null), null);
});
