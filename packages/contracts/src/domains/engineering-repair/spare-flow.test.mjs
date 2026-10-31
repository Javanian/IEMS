import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { companyOwnerFixture, companyCommand } from '../../../../../apps/portfolio-api/test/support/company-stock-owner-fixture.mjs';
import { readRepairManufacturedGraph } from '../../../../../apps/portfolio-api/src/repair-stock.mjs';

test('repair uses canonical company and catalog stock through replacement and rework without rewriting frozen sources', async t => {
  const h = await startOwned(t), f = await companyOwnerFixture(h), key = values => ({ idempotencyKey: randomUUID(), ...values });
  const account = await h.ok('/crm/accounts', { name: 'Synthetic repair stock customer' }, 201);
  let row = await h.ok('/repair/cases', key({ accountId: account._id, serial: 'CUSTOMER-PARENT-01', condition: 'Module failed', currency: 'USD' }), 201);
  const path = `/repair/cases/${row._id}`;
  const step = async (action, values = {}) => row = await h.ok(`${path}/${action}`, key({ expectedVersion: row.version, ...(['start'].includes(action) ? {} : { evidence: 'Synthetic authorized repair evidence' }), ...values }));
  await step('diagnostic-authorize', { feeCap: '10.00' });
  await step('teardown', { findings: [{ component: 'Module', disposition: 'REPLACE' }] });
  const quote = await h.ok('/commercial/quotes', { accountId: account._id, expiresAt: '2030-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Replace module', quantity: '1', uom: 'EA', unitPrice: '100.00', currency: 'USD' }] }, 201);
  await h.ok(`/commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await step('scope', { quoteId: quote._id, revision: 1, depositRequired: '0.00' });
  await step('decide', { decision: 'ACCEPT', revision: 1 }); await step('start');
  assert.equal((await h.req(`${path}/execute`, key({ expectedVersion: row.version, dispositions: row.scopes[0].findings, evidence: 'Cannot skip replacement' }), h.alpha)).error.code, 'REPLACEMENT_REQUIRED');
  await step('spare-authorize', { component: 'Module', sourceKind: 'COMPANY_OUTPUT', itemId: f.component._id, itemVersion: f.component.version, itemRevision: 1, quantity: '1', uom: 'UN' });
  await step('component-remove', { component: 'Module', serial: 'CUSTOMER-MODULE-OLD', condition: 'Damaged' });
  let stock = await f.company(), material = row.spareMaterials[0];
  const selected = stock.units.find(u => u.status === 'AVAILABLE');
  const reserve = key({ expectedVersion: row.version, materialLineId: material.lineId, sourceId: stock._id, expectedStockVersion: stock.version, quantity: '1', units: [{ companyUnitId: selected._id, expectedUnitVersion: selected.version }], evidence: 'Reserve approved module' });
  assert.equal((await h.req(`${path}/spare-reserve`, reserve, h.beta)).status, 404);
  const restore = await h.setRoles(h.seeded[0], ['repairRead']);
  try { assert.equal((await h.req(`${path}/spare-reserve`, reserve, h.alpha)).status, 403); } finally { await restore(); }
  assert.equal((await h.req(`${path}/spare-reserve`, { ...reserve, quantity: '0.0000001' }, h.alpha)).status, 400);
  assert.equal((await h.req(`${path}/spare-reserve`, { ...reserve, expectedStockVersion: stock.version + 1 }, h.alpha)).status, 409);
  row = await h.ok(`${path}/spare-reserve`, reserve); assert.deepEqual(await h.ok(`${path}/spare-reserve`, reserve), row);
  stock = await f.company(); assert.equal(stock.reservedQuantity, '1');
  assert.equal((await h.ok(`${f.companyPath}/units/${selected._id}/trace`)).uses.repair[0].caseId, row._id);
  const authority = await h.db.collection('repairCases').findOne({ _id: row._id });
  await h.db.collection('repairCases').updateOne({ _id: row._id }, { $set: { stockAuthorityHash: 'corrupt synthetic proof' } });
  try { assert.equal((await h.req(f.companyPath, undefined, h.alpha)).status, 409); } finally { await h.db.collection('repairCases').replaceOne({ _id: row._id }, authority); }
  assert.equal(await h.db.collection('internalExecutions').countDocuments(), 1);
  const frozen = await h.db.collection('manufacturedGenealogySnapshots').find({ referenceId: row._id }).toArray(); assert.equal(frozen.length, 1);
  stock = await h.ok(`${f.companyPath}/holds`, companyCommand({ expectedVersion: stock.version, reasonCode: 'QUALITY_SUSPECT' }));
  assert.equal((await h.req(`${path}/spare-reserve`, reserve, h.alpha)).error.code, 'STOCK_ENCUMBERED');
  let claim = row.spareClaims[0];
  const transition = async (action, extra = {}) => {
    const current = claim.sourceKind === 'COMPANY_OUTPUT' ? await f.company() : await h.ok(`/catalog-stock/receipts/${claim.sourceId}`);
    return step(action, { materialLineId: claim.materialLineId, reservationId: claim.reservationId, expectedReservationVersion: claim.version, expectedStockVersion: current.version, ...(claim.sourceKind === 'CATALOG_RECEIPT' ? { expectedReceiptVersion: current.receiptVersion } : {}), ...extra });
  };
  await assert.rejects(transition('spare-issue'), /STOCK_ENCUMBERED/);
  await transition('spare-release');
  stock = await f.company(); assert.equal(stock.reservedQuantity, '0');
  stock = await h.ok(`${f.companyPath}/holds/release`, companyCommand({ expectedVersion: stock.version, expectedHoldId: stock.hold._id }));
  const available = stock.units.find(u => u._id === selected._id);
  await step('spare-reserve', { materialLineId: material.lineId, sourceId: stock._id, expectedStockVersion: stock.version, quantity: '1', units: [{ companyUnitId: available._id, expectedUnitVersion: available.version }] });
  claim = row.spareClaims.at(-1);
  await transition('spare-issue'); claim = row.spareClaims.find(c => c.reservationId === claim.reservationId);
  const before = await h.db.collection('companyMaterialConsumptions').countDocuments();
  await h.db.command({ collMod: 'repairOutbox', validator: { forbidden: { $exists: true } } });
  try { await assert.rejects(transition('spare-install', { removedComponentId: row.componentRemovals[0].componentId })); } finally { await h.db.command({ collMod: 'repairOutbox', validator: {} }); }
  assert.equal(await h.db.collection('companyMaterialConsumptions').countDocuments(), before);
  assert.equal((await f.company()).issuedQuantity, '1');
  await transition('spare-install', { removedComponentId: row.componentRemovals[0].componentId });
  assert.equal((await f.company()).consumedQuantity, '1');
  await step('execute', { dispositions: row.scopes[0].findings });
  await step('test', { result: 'FAIL' });
  await step('component-remove', { component: 'Module', serial: selected.serial, condition: 'Replacement failed under test' });
  assert.equal(row.componentRemovals.at(-1).sourceReplacementId, row.replacements[0]._id);
  await step('spare-authorize', { component: 'Module', sourceKind: 'CATALOG_RECEIPT', itemId: f.direct._id, itemVersion: f.direct.version, itemRevision: 1, quantity: '0.25', uom: 'KG' });
  material = row.spareMaterials.at(-1); let raw = await h.ok(`/catalog-stock/receipts/${f.directReceipt._id}`);
  await step('spare-reserve', { materialLineId: material.lineId, sourceId: f.directReceipt._id, expectedStockVersion: raw.version, expectedReceiptVersion: raw.receiptVersion, quantity: '0.25' });
  claim = row.spareClaims.at(-1); await transition('spare-issue'); claim = row.spareClaims.find(c => c.reservationId === claim.reservationId);
  await transition('spare-install', { removedComponentId: row.componentRemovals.at(-1).componentId });
  raw = await h.ok(`/catalog-stock/receipts/${f.directReceipt._id}`); assert.equal(raw.consumedQuantity, '0.25'); assert.equal(raw.availableQuantity, '9.75');
  await step('rework'); await step('test', { result: 'PASS' }); await step('qc');
  assert.equal(row.replacementFreeze.replacements.length, 2);
  assert.deepEqual(await h.db.collection('manufacturedGenealogySnapshots').find({ referenceId: row._id }).toArray(), frozen);
  assert.equal((await f.company()).units.find(u => u._id === selected._id).status, 'CONSUMED');
  const trace = await h.ok(`${f.companyPath}/units/${selected._id}/trace`);
  assert.equal(trace.uses.repair.length, 2);
  assert.equal(trace.uses.repair.find(r => r.reservationStatus === 'CONSUMED').removals[0].sourceReplacementId, row.replacements[0]._id);
  const session = h.client.startSession();
  try {
    const graph = await session.withTransaction(() => readRepairManufacturedGraph(h.db, { tenantId: row.tenantId, plantId: row.plantId }, stock._id, selected._id, session));
    assert.equal(graph.contentHash, frozen[0].contentHash);
  } finally { await session.endSession(); }
  const old = await h.db.collection('catalogMaterialReservations').findOne({ _id: claim.reservationId });
  await h.db.collection('catalogMaterialReservations').updateOne({ _id: old._id }, { $set: { authorityKind: 'UNKNOWN' } });
  try { assert.equal((await h.req(`/catalog-stock/receipts/${f.directReceipt._id}`, undefined, h.alpha)).status, 409); } finally { await h.db.collection('catalogMaterialReservations').replaceOne({ _id: old._id }, old); }
  assert.equal((await h.req(`${path}/spare-authorize`, key({ expectedVersion: row.version, component: 'Module', sourceKind: 'CATALOG_RECEIPT', itemId: f.direct._id, itemVersion: f.direct.version, itemRevision: 1, quantity: '1', uom: 'KG', evidence: 'Frozen repair' }), h.alpha)).error.code, 'REPAIR_SCOPE_CLOSED');
  await step('return');
  assert.equal(row.status, 'RETURNED');
});
