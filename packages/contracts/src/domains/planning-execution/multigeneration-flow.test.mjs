import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { companyOwnerFixture, companyCommand as command } from '../../../../../apps/portfolio-api/test/support/company-stock-owner-fixture.mjs';
import { stockHash } from '../../../../../apps/portfolio-api/src/catalog-stock-values.mjs';

test('three manufactured generations retain exact parentage, frozen provenance and current ancestor holds', async t => {
  const h = await startOwned(t), f = await companyOwnerFixture(h);
  let second = await f.consumer();
  second = await f.reserveCompany(second);
  second = await f.reserveRaw(second, f.directReceipt, f.direct, '2.5');
  async function finish(execution, serials, sourcesFor) {
    execution = await f.mutate(execution, 'release');
    execution = await f.mutate(execution, 'issue');
    for (let operationIndex = 0; operationIndex < 2; operationIndex++) execution = await f.mutate(execution, 'records', {
      operationIndex, inputQuantity: '2', goodQuantity: '2', scrapQuantity: '0', laborMinutes: '2', machineMinutes: '1',
      evidence: 'Synthetic multigeneration operation', ...(operationIndex === 1 ? { outputSerials: serials } : {})
    });
    for (const [index, unit] of execution.outputUnits.entries()) execution = await f.mutate(execution, 'allocations', { outputUnitId: unit._id, sources: sourcesFor(index) });
    execution = await f.mutate(execution, 'qc', { acceptedSerials: serials, rejectedSerials: [], evidence: 'Synthetic multigeneration accepted inspection' });
    const putaway = command({ expectedVersion: execution.version, locationId: f.location._id, expectedLocationVersion: f.location.version });
    const path = `${f.root}/${execution._id}/putaway`;
    const stored = await h.ok(path, putaway);
    assert.deepEqual(await h.ok(path, putaway), stored);
    assert.deepEqual(await f.get(stored), stored);
    assert.equal(stored.manufacturedGenealogy.length, 2);
    return stored;
  }
  const firstUnits = second.reservations.find(row => row.sourceKind === 'COMPANY_OUTPUT').companyUnitIds;
  second = await finish(second, ['GEN-2-A','GEN-2-B'], index => [
    { sourceKind: 'COMPANY_OUTPUT', companyReceiptId: f.producer.companyStock._id, companyUnitIds: [firstUnits[index]], quantity: '1' },
    { sourceKind: 'CATALOG_RECEIPT', receiptId: f.directReceipt._id, quantity: '1.25' }
  ]);
  const secondPath = `/company-stock/receipts/${second.companyStock._id}`;
  let source = await h.ok(secondPath);
  assert.equal(source.sourcePolicy, 'MULTI_GENERATION_SOURCE');
  assert.equal(source.canReserve, true);
  const before = await h.db.collection('internalExecutions').findOne({ _id: second._id });
  source = await h.ok(`${secondPath}/holds`, command({ expectedVersion: source.version, reasonCode: 'TRACE_REVIEW' }));
  const after = await h.db.collection('internalExecutions').findOne({ _id: second._id });
  assert.ok(after.useFence > (before.useFence || 0), 'first hold fences existing producer authority even without a use head');
  assert.equal(source.canReserve, false);
  source = await h.ok(`${secondPath}/holds/release`, command({ expectedVersion: source.version, expectedHoldId: source.hold._id }));
  const draft = await h.ok('/inventory-master/items', command({ code: 'GEN_THREE', description: 'Synthetic third generation output', kind: 'MANUFACTURED', uom: 'UN', schema: 'INVENTORY_ITEM_V2', trackingPolicy: 'SERIAL' }), 201);
  const thirdItem = await h.ok(`/inventory-master/items/${draft._id}/approve`, command({ expectedVersion: draft.version, revision: 1 }));
  let third = await f.execute(await f.plan(thirdItem, '2', [[f.output,'1']], true));
  third = await f.mutate(third, 'reservations', { sourceKind: 'COMPANY_OUTPUT', materialLineId: third.materials[0].lineId, companyReceiptId: source._id, expectedStockVersion: source.version, quantity: '2', units: source.units.map(unit => ({ companyUnitId: unit._id, expectedUnitVersion: unit.version })) });
  const secondUnits = third.reservations[0].companyUnitIds;
  third = await finish(third, ['GEN-3-A','GEN-3-B'], index => [{ sourceKind: 'COMPANY_OUTPUT', companyReceiptId: source._id, companyUnitIds: [secondUnits[index]], quantity: '1' }]);
  const thirdPath = `/company-stock/receipts/${third.companyStock._id}`, root = await h.ok(thirdPath);
  const trace = await h.ok(`${thirdPath}/units/${root.units[0]._id}/trace`);
  assert.equal(trace.schema, 'COMPANY_UNIT_TRACE_V2');
  assert.equal(trace.completeness.multiGeneration, true);
  assert.equal(trace.ancestry.companySources[0].companySources[0].purchasedSources[0].receiptId, f.consumed._id);
  assert.deepEqual(root.consumedAncestryReceiptIds, [f.consumed._id, f.directReceipt._id].sort());
  const frozen = await h.db.collection('manufacturedGenealogySnapshots').find({ referenceId: third._id }).sort({ companyUnitId: 1 }).toArray();
  assert.equal(frozen.length, 2);
  for (const row of frozen) assert.equal(stockHash(row.snapshot), row.contentHash);
  const first = await f.company();
  await h.ok(`${f.companyPath}/holds`, command({ expectedVersion: first.version, reasonCode: 'QUALITY_SUSPECT' }));
  const held = await h.ok(thirdPath);
  assert.ok(held.blockers.includes('ANCESTOR_HELD'));
  assert.equal(held.eligibleQuantity, '0');
  assert.deepEqual(await h.db.collection('manufacturedGenealogySnapshots').find({ referenceId: third._id }).sort({ companyUnitId: 1 }).toArray(), frozen);
  assert.equal(await h.db.collection('manufacturedGenealogyAudit').countDocuments({ referenceId: third._id }), 2);
  assert.equal(await h.db.collection('manufacturedGenealogyOutbox').countDocuments({ referenceId: third._id }), 2);
});
