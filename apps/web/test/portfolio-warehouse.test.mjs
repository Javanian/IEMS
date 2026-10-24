import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptCommand, warehouseCommand } from '../src/features/portfolio/warehouse.mjs';

test('receipt command uses actual PO version and preserves quantity and serial identifiers', () => {
  const po = { _id:'po', vendorId:'vendor', version:3 };
  assert.deepEqual(receiptCommand(po, {lineIndex:'0',quantity:'2.000',uom:'EA',serials:'Trace_01\nTrace-02'}, 'owned-key'), {purchaseOrderId:'po',vendorId:'vendor',expectedVersion:3,lineIndex:0,quantity:'2.000',uom:'EA',serials:['Trace_01','Trace-02'],idempotencyKey:'owned-key'});
});
test('reservation captures receipt version and real SO/customer, never coerces quantity', () => {
  const row = {version:3};
  const body = warehouseCommand('reserve',row,{salesOrderId:'so',accountId:'customer',lineIndex:'1',quantity:'0.250000',uom:'KG'},'owned-key');
  row.version=4;
  assert.deepEqual(body,{expectedVersion:3,idempotencyKey:'owned-key',salesOrderId:'so',accountId:'customer',lineIndex:1,quantity:'0.250000',uom:'KG'});
});
