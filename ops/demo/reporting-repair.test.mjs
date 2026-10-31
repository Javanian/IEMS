import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startOwned, orderWithStock } from '../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { runE02Flow, e02Fixture } from '../../apps/portfolio-api/test/support/review-e02-flow.mjs';
import { createReportingSource } from '../../apps/portfolio-api/src/reporting-source.mjs';
import { contentHash } from '../../packages/tenant-foundation/commands.mjs';
import { stockHash } from '../../apps/portfolio-api/src/catalog-stock-values.mjs';
import { shipmentSemantic } from '../../apps/portfolio-api/src/purchased-stock-proof.mjs';

test('actual accepted/rejected E02 returns coexist as visible unsupported coverage; forged, missing and revoked authority fail closed', async t => {
  const fixture = new URL('../../packages/domain-test-fixtures/src/scenarios/e02RepairCustomerAsset.js', import.meta.url);
  const fixtureHash = createHash('sha256').update(await readFile(fixture)).digest('hex');
  assert.equal(fixtureHash, '6baee7beb75983827bd40f0064618af35b41e96ea6eba4ef3cb68dfdaba49d48');
  let clock = new Date(e02Fixture.repair_case.intake_date);
  const h = await startOwned(t, { businessClock: () => clock });
  const flow = await runE02Flow(h, { setClock: value => { clock = value; } });
  const generic = await orderWithStock(h, { orderQuantity: '1', reserve: '1' });
  const shipment = await h.ok('/fulfillment/shipments', { salesOrderId: generic.so._id, expectedVersion: generic.so.version, lineIndex: 0, uom: 'KG', sources: [{ sourceType: 'RESERVATION', sourceId: generic.reservation._id, quantity: '1' }], reference: 'Repair coexistence', idempotencyKey: randomUUID() }, 201);
  const checked = new Set(), scope = await h.scopeOf(h.alpha);
  const adapter = createReportingSource({ ...h.runtime, authorizeResource: ({ collection, grant, resource, session }) => {
    assert.ok(session.inTransaction()); assert.equal(resource.tenantId, grant.tenantId); assert.equal(resource.plantId, grant.plantId);
    checked.add(collection);
  } });
  await adapter.initialize();
  const before = await h.db.collection('reportingSnapshotOutbox').find({}).sort({ _id: 1 }).toArray();
  const { manifest, envelopes } = await adapter.reconcileScope({ scope });
  assert.equal(manifest.coverage, 'INCOMPLETE'); assert.equal(manifest.trustedZero, false);
  assert.equal(manifest.counts.fulfillmentShipments, 3);
  const rows = await h.db.collection('fulfillmentShipments').find({ tenantId: scope.tenantId, plantId: scope.selectedPlantId }).sort({ _id: 1 }).toArray();
  assert.equal(manifest.sourceHashes.fulfillmentShipments, contentHash(JSON.parse(JSON.stringify(rows))));
  const unsupported = manifest.unsupported.filter(entry => entry.kind === 'CUSTOMER_ASSET_RETURN');
  assert.equal(unsupported.length, 2);
  for (const id of [flow.shipment.shipmentId, flow.rejection.case.returnDispatch.shipmentId]) {
    const entry = unsupported.find(entry => entry.id === id), row = rows.find(row => row._id === id);
    assert.equal(entry.version, 1); assert.equal(entry.hash, stockHash(shipmentSemantic(row)));
    assert.equal(entry.reason, 'VALIDATED_REPAIR_RETURN_NO_REGISTERED_REPORTING_V2_TARGET');
    assert.equal(entry.receiptCollection, 'repairKeys'); assert.ok(entry.receiptId); assert.ok(entry.authorityHash);
    assert.ok(!envelopes.some(event => event.aggregateId === id));
  }
  assert.ok(envelopes.some(event => event.aggregateId === shipment._id));
  assert.deepEqual(await h.db.collection('reportingSnapshotOutbox').find({}).sort({ _id: 1 }).toArray(), before);
  await adapter.extractCoverage({ scope, runId: manifest.runId });
  const page = await adapter.reconcile({ scope, collection: 'fulfillmentShipments' });
  assert.deepEqual(page.manifest.unsupported, unsupported);
  for (const collection of ['repairCases', 'repairSalesOrders', 'repairWorkOrders', 'repairReturnAuthorities', 'repairKeys', 'repairAudit', 'deliveryHeads', 'deliveryConfirmations', 'repairInvoices']) assert.ok(checked.has(collection), collection);
  const coverageCount = await h.db.collection('reportingSourceCoverage').countDocuments();
  async function rejectMutation(collection, filter, update, pattern) {
    const saved = await h.db.collection(collection).findOne(filter);
    assert.ok(saved);
    try {
      await h.db.collection(collection).updateOne({ _id: saved._id }, update);
      await assert.rejects(adapter.reconcileScope({ scope }), pattern);
      await assert.rejects(adapter.reconcile({ scope, collection: 'fulfillmentShipments' }), pattern);
      await assert.rejects(adapter.extractCoverage({ scope, runId: manifest.runId }), pattern);
      assert.equal(await h.db.collection('reportingSourceCoverage').countDocuments(), coverageCount);
      assert.deepEqual(await h.db.collection('reportingSnapshotOutbox').find({}).sort({ _id: 1 }).toArray(), before);
      assert.equal((await h.db.collection('reportingSourceQuarantine').findOne({ collection: 'fulfillmentShipments' })).cursorAdvanced, false);
    } finally { await h.db.collection(collection).replaceOne({ _id: saved._id }, saved); }
  }
  const accepted = rows.find(row => row._id === flow.shipment.shipmentId);
  await rejectMutation('fulfillmentShipments', { _id: accepted._id }, { $set: { sourceKind: 'FORGED' } }, /REPAIR_RETURN_SOURCE_INVALID/);
  await rejectMutation('fulfillmentShipments', { _id: accepted._id }, { $set: { authorityId: randomUUID() } }, /SOURCE_SCOPE_DENIED/);
  await rejectMutation('repairKeys', { _id: unsupported.find(entry => entry.id === accepted._id).receiptId }, { $set: { 'result.returnDispatch.shipmentId': randomUUID() } }, /REPAIR_RETURN_RECEIPT_MISSING_OR_CONFLICT/);
  await rejectMutation('repairReturnAuthorities', { _id: accepted.authorityId }, { $set: { revoked: true } }, /SOURCE_RESOURCE_REVOKED/);
  await rejectMutation('repairCases', { _id: accepted.caseId }, { $set: { deleted: true } }, /SOURCE_RESOURCE_REVOKED/);
  await rejectMutation('repairCases', { _id: accepted.caseId }, { $set: { holdActive: true } }, /REPAIR_RETURN_SOURCE_INVALID/);
  await rejectMutation('deliveryConfirmations', { shipmentId: accepted._id }, { $set: { quantity: '2' } }, /DELIVERY_SOURCE_INVALID|WARRANTY_SOURCE_CONFLICT/);
  const restore = await h.setRoles(h.seeded[0], ['quoteReader', 'fulfillmentRead']);
  try { await assert.rejects(adapter.extractCoverage({ scope, runId: manifest.runId })); } finally { await restore(); }
  await adapter.extractCoverage({ scope: await h.scopeOf(h.alpha), runId: manifest.runId });
  assert.equal(createHash('sha256').update(await readFile(fixture)).digest('hex'), fixtureHash);
  t.diagnostic(JSON.stringify({ fixtureHash, unsupported, coverage: manifest.coverage, trustedZero: manifest.trustedZero, evidence: 'Owned synthetic Mongo/HTTP; final independent QA deferred' }));
});
