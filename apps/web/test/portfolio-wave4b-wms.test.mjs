import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warehouseCommand } from '../src/features/portfolio/warehouse.mjs';

test('warehouse exposes mounted bins and receipt WMS controls', () => {
  const view=readFileSync(new URL('../src/features/portfolio/WarehouseWorkspace.jsx',import.meta.url),'utf8');
  assert.match(view,/WmsReceipt/);
  assert.match(view,/\/bins/);
});
test('count retains absolute decimal string without quantity or owner overrides', () => {
  assert.deepEqual(warehouseCommand('count',{version:4},{countedQuantity:'0.000000',uom:'EA',reason:'Count',quantity:'9',ownerId:'forged'},'owned-key'),{expectedVersion:4,idempotencyKey:'owned-key',countedQuantity:'0.000000',uom:'EA',reason:'Count'});
});
test('whole receipt transfer only submits scoped bin, exact UOM and reason', () => {
  assert.deepEqual(warehouseCommand('transfer',{version:7},{binId:'bin',uom:'KG',reason:'Move',quantity:'0.5',accountId:'forged'},'owned-key'),{expectedVersion:7,idempotencyKey:'owned-key',binId:'bin',uom:'KG',reason:'Move'});
});
