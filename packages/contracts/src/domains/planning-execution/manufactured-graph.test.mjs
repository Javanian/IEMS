import test from 'node:test';
import assert from 'node:assert/strict';
import { manufacturedTraversal, visitManufacturedNode, consumedManufacturedAncestry } from './manufactured-graph.mjs';
import { reconcileInternalAttribution } from '../../../../../apps/portfolio-api/src/internal-execution-state.mjs';
import { companyReservationFields } from '../../../../../apps/web/src/features/portfolio/company-stock.mjs';

test('a shared upstream producer is valid while a back edge fails closed', async () => {
  const edges = { assembly: ['left', 'right'], left: ['raw'], right: ['raw'], raw: [] };
  const walk = manufacturedTraversal(), reads = [];
  const sequential = id => visitManufacturedNode(walk, id, async () => { reads.push(id); const sources = []; for (const child of edges[id]) sources.push(await sequential(child)); return { id, sources }; });
  assert.equal((await sequential('assembly')).sources[1].sources[0].id, 'raw');
  assert.equal(reads.filter(id => id === 'raw').length, 1);
  edges.raw.push('assembly');
  const cycleWalk = manufacturedTraversal();
  const cyclic = id => visitManufacturedNode(cycleWalk, id, async () => { for (const child of edges[id]) await cyclic(child); });
  await assert.rejects(cyclic('assembly'), { code: 'MANUFACTURED_GRAPH_CYCLE' });
  assert.equal(cycleWalk.active.size, 0);
});

test('oversized genealogy is rejected before unbounded reads and raw ancestry keeps all generations', async () => {
  const walk = manufacturedTraversal(); let reads = 0;
  const deep = id => visitManufacturedNode(walk, id, async () => { reads++; return deep(id + 1); });
  await assert.rejects(deep(0), { code: 'MANUFACTURED_GRAPH_LIMIT' });
  assert.equal(reads, 32);
  assert.deepEqual(consumedManufacturedAncestry([
    { consumedReceiptIds: ['raw-parent'], consumedAncestryReceiptIds: ['raw-root', 'raw-parent'] },
    { consumedReceiptIds: ['raw-root'] }
  ], ['raw-current']), ['raw-current', 'raw-parent', 'raw-root']);
});

test('serialized manufactured components have one parent or loss and conserve consumed quantity', () => {
  const source = (ids, quantity = String(ids.length)) => ({ sourceKind: 'COMPANY_OUTPUT', companyReceiptId: 'receipt', companyUnitIds: ids, quantity });
  const head = { schema: 'INTERNAL_EXECUTION_V2', materials: [{ lineId: 'material', quantityPerUnit: '1' }], allocations: [
    { outputUnitId: 'output-1', sources: [source(['child-1'])] },
    { outputUnitId: 'output-2', sources: [source(['child-2'])] }
  ], losses: [source(['child-3'])] };
  const reservations = [{ ...source(['child-1','child-2','child-3']), status: 'CONSUMED', materialLineId: 'material', sourceSnapshot: { trackingPolicy: 'SERIAL' } }];
  const outputs = [{ _id: 'output-1' }, { _id: 'output-2' }];
  assert.equal(reconcileInternalAttribution(head, reservations, outputs, true), true);
  const duplicate = structuredClone(head); duplicate.allocations[1].sources = [source(['child-1'])];
  assert.throws(() => reconcileInternalAttribution(duplicate, reservations, outputs, true), { code: 'INTERNAL_EXECUTION_SOURCE_INVALID' });
  const missingLoss = { ...head, losses: [] };
  assert.throws(() => reconcileInternalAttribution(missingLoss, reservations, outputs, true), { code: 'INTERNAL_EXECUTION_SOURCE_INVALID' });
  const overuse = structuredClone(head); overuse.losses = [source(['child-3'], '2')];
  assert.throws(() => reconcileInternalAttribution(overuse, reservations, outputs, true), { code: 'INTERNAL_EXECUTION_SOURCE_INVALID' });
});

test('operator can select actual multi-generation stock while legacy terminal output stays unavailable', () => {
  const source = { _id: 'receipt', sourcePolicy: 'MULTI_GENERATION_SOURCE', canReserve: true, version: 4,
    units: [{ _id: 'child', version: 4, status: 'AVAILABLE', eligible: true }] };
  const values = { companyUnitIds: ['child'], quantity: '1' };
  assert.deepEqual(companyReservationFields(source, values).units, [{ companyUnitId: 'child', expectedUnitVersion: 4 }]);
  assert.throws(() => companyReservationFields({ ...source, sourcePolicy: 'LEAF_ONLY' }, values), { local: true });
  assert.throws(() => companyReservationFields(source, { ...values, quantity: '2' }), { local: true });
});
