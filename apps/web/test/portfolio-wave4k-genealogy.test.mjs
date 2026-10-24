import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/features/portfolio/manufacturing.mjs';
import { allocationCommand, finalizeGenealogyCommand, genealogyCapability, genealogyHint, genealogyPage, genealogyPath, lossCommand } from '../src/features/portfolio/genealogy.mjs';

const view = () => ({ workOrderVersion:9, version:0, sources:[{ receiptId:'receipt-a', uom:'UN', quantityPerUnit:'1', materialTrace:{ lotNumber:'LOT-A', heatNumber:'HEAT-A' } }, { receiptId:'receipt-b', uom:'SET', quantityPerUnit:'2' }] });

test('genealogy planning opts in explicitly without changing legacy serialized planning', () => {
  const order = { _id:'so', version:1, snapshot:{ lines:[{ uom:'UN' }] } }, values = { lineIndex:'0', quantities:'6\n4', serialized:'true' };
  const legacy = planCommand(order, values, 'legacy-key');
  assert.equal(Object.hasOwn(legacy, 'genealogyRequired'), false);
  assert.deepEqual(planCommand(order, { ...values, genealogyRequired:'false' }, 'legacy-key'), legacy);
  const required = planCommand(order, { ...values, genealogyRequired:'true' }, 'required-key');
  assert.equal(required.genealogyRequired, true);
  assert.equal(required.serialized, true);
  assert.deepEqual(required.quantities, ['6', '4']);
});

test('unit allocation binds exact entered quantities to server sources without accepting caller authority', () => {
  const state = view(), values = { outputUnitId:'unit-1', materialQuantity0:'0.500000', materialQuantity1:'2.000000', reason:'Observed lot attribution', receiptId:'foreign', uom:'KG', movementId:'forged', contentHash:'forged', lotNumber:'forged' };
  const command = allocationCommand(state, values, 'unit-key');
  state.version = 8; state.workOrderVersion = 19; values.materialQuantity0 = '9';
  assert.deepEqual(command, { expectedVersion:9, expectedGenealogyVersion:0, reason:'Observed lot attribution', idempotencyKey:'unit-key', outputUnitId:'unit-1', materials:[{ receiptId:'receipt-a', quantity:'0.500000', uom:'UN' }, { receiptId:'receipt-b', quantity:'2.000000', uom:'SET' }] });
});

test('blank unit fields explicitly clear that unit and never invent released-ratio allocations', () => {
  const state = view();
  assert.deepEqual(allocationCommand(state, { outputUnitId:'unit-1', reason:'Clear wrong source' }, 'clear-key').materials, []);
  assert.deepEqual(allocationCommand(state, { outputUnitId:'unit-1', materialQuantity0:'', materialQuantity1:'0.250000', reason:'Partial historical evidence' }, 'partial-key').materials, [{ receiptId:'receipt-b', quantity:'0.250000', uom:'SET' }]);
});

test('process loss is explicit, keeps per-source reasons, and replaces the complete loss scope', () => {
  const state = view(), values = { lossQuantity0:'0.125000', lossReason0:'Observed process scrap', lossQuantity1:'', lossReason1:'Not a loss', reason:'Correct consumed loss evidence' };
  assert.deepEqual(lossCommand(state, values, 'loss-key'), { expectedVersion:9, expectedGenealogyVersion:0, reason:'Correct consumed loss evidence', idempotencyKey:'loss-key', losses:[{ receiptId:'receipt-a', quantity:'0.125000', uom:'UN', reason:'Observed process scrap' }] });
  assert.deepEqual(lossCommand(state, { reason:'Remove incorrect loss' }, 'clear-loss-key').losses, []);
});

test('finalization carries both captured versions without caller quantities or completion authority', () => {
  assert.deepEqual(finalizeGenealogyCommand({ ...view(), version:7 }, { reason:'All explicit evidence reconciled', status:'COMPLETE', canFinalize:true, losses:[{ quantity:'99' }] }, 'final-key'), { expectedVersion:9, expectedGenealogyVersion:7, reason:'All explicit evidence reconciled', idempotencyKey:'final-key' });
});

test('separate genealogy grants fail closed for missing permissions and do not imply mutation rights', () => {
  assert.equal(genealogyCapability('genealogy.read', ['manufacturing.read']).enabled, false);
  assert.equal(genealogyCapability('genealogy.record', ['genealogy.read']).enabled, false);
  assert.equal(genealogyCapability('genealogy.finalize', ['genealogy.read', 'genealogy.record']).enabled, false);
  assert.equal(genealogyCapability('genealogy.read', undefined).enabled, false);
  assert.equal(genealogyCapability('genealogy.record', ['genealogy.record']).enabled, true);
  assert.match(genealogyCapability('genealogy.finalize', []).reason, /finalize permission/);
});

test('revision and reverse lookup pagination retains the selected source path and encodes cursors', () => {
  assert.equal(genealogyPath('wo-id'), '/api/manufacturing/work-orders/wo-id/genealogy');
  assert.equal(genealogyPage(`${genealogyPath('wo-id')}/revisions`, null), '/api/manufacturing/work-orders/wo-id/genealogy/revisions?limit=25');
  assert.equal(genealogyPage('/api/manufacturing/genealogy/receipts/receipt-id', 'cursor&other=1'), '/api/manufacturing/genealogy/receipts/receipt-id?limit=25&cursor=cursor%26other%3D1');
});

test('conflict hints distinguish historical attribution, reconciliation and entire-WO freeze', () => {
  assert.match(genealogyHint({ code:'STOCK_ENCUMBERED' }), /Historical lot attribution remains recordable/);
  assert.match(genealogyHint({ code:'GENEALOGY_QUANTITY_CONFLICT' }), /each output quantity/);
  assert.match(genealogyHint({ code:'GENEALOGY_FROZEN' }), /entire work order/);
  assert.equal(genealogyHint({ code:'UNKNOWN' }), null);
});
