import assert from 'node:assert/strict';
import { catalogStockContext, writeCatalogReservation } from '../../../apps/portfolio-api/src/catalog-stock.mjs';
import { purchasedFulfillmentContext, buildCustomerReservation, writePurchasedReservation } from '../../../apps/portfolio-api/src/purchased-fulfillment.mjs';
import { allSnapshot } from './support.mjs';

export async function existingSourceCAS(h, receiptId, productionClaim, customerClaim) {
  assert.notEqual(productionClaim._id, customerClaim._id);
  assert.equal(productionClaim.receiptId, receiptId); assert.equal(customerClaim.receiptId, receiptId);
  assert.equal(productionClaim.status, 'RESERVED'); assert.equal(customerClaim.status, 'RESERVED');
  const scope = await h.scopeOf(h.alpha), filter = { tenantId: scope.tenantId, plantId: scope.selectedPlantId };
  const before = await allSnapshot(h), first = h.client.startSession(), second = h.client.startSession();
  let proof;
  try {
    first.startTransaction({ readConcern: { level: 'snapshot' } }); second.startTransaction({ readConcern: { level: 'snapshot' } });
    const a = await catalogStockContext(h.db, filter, receiptId, first, { fresh: false, fence: false });
    const b = await catalogStockContext(h.db, filter, receiptId, second, { fresh: false, fence: false });
    assert.equal(a.use.version, b.use.version); assert.ok(a.use.head); assert.equal(a.receipt.version, b.receipt.version);
    const sourceVersion = a.use.version, receiptVersion = a.receipt.version;
    const releasedProduction = { ...productionClaim, status: 'RELEASED' };
    await writeCatalogReservation(h.db, filter, a, releasedProduction, scope.userId, 'Independent uncommitted production release CAS', first);
    const pendingHead = await h.db.collection('catalogUseHeads').findOne({ ...filter, _id: receiptId }, { session: first });
    assert.equal(pendingHead.version, sourceVersion + 1);
    assert.equal(pendingHead.refs.find(ref => ref.reservationId === productionClaim._id).version, productionClaim.version + 1);
    const releasedCustomer = { ...customerClaim, status: 'RELEASED', remainingQuantity: '0', releasedQuantity: customerClaim.quantity };
    let conflict;
    try { await writeCatalogReservation(h.db, filter, b, releasedCustomer, scope.userId, 'Independent competing uncommitted customer release CAS', second); }
    catch (error) { conflict = error; }
    assert.ok(conflict, 'Two distinct claim writes must conflict at their common source, while the first transaction is still open');
    assert.equal(conflict.code, 112, `Expected actual Mongo source write conflict, received ${conflict.code}: ${conflict.message}`);
    assert.equal(first.inTransaction(), true);
    proof = { mode: 'EXISTING_SOURCE_ABORT_BOTH', receiptId, sourceVersion, receiptVersion, firstClaimId: productionClaim._id, secondClaimId: customerClaim._id, firstPendingSourceVersion: pendingHead.version, secondErrorCode: conflict.code, secondErrorName: conflict.codeName ?? conflict.name, committed: false, authorizationOverlapClaim: false };
  } finally {
    if (first.inTransaction()) await first.abortTransaction(); if (second.inTransaction()) await second.abortTransaction();
    await first.endSession(); await second.endSession();
  }
  assert.deepEqual(await allSnapshot(h), before, 'Both actual domain transactions were aborted: all business and authorization/source fences must remain exact');
  return proof;
}

export async function absentSourceCAS(h, receiptId, firstOrder, secondOrder, unitId) {
  const scope = await h.scopeOf(h.alpha), filter = { tenantId: scope.tenantId, plantId: scope.selectedPlantId };
  const before = await allSnapshot(h), first = h.client.startSession(), second = h.client.startSession();
  let proof;
  try {
    first.startTransaction({ readConcern: { level: 'snapshot' } }); second.startTransaction({ readConcern: { level: 'snapshot' } });
    const a = await catalogStockContext(h.db, filter, receiptId, first, { fresh: false, fence: false });
    const b = await catalogStockContext(h.db, filter, receiptId, second, { fresh: false, fence: false });
    assert.equal(a.use.head, null); assert.equal(b.use.head, null); assert.equal(a.use.version, 1); assert.equal(b.use.version, 1);
    const firstConsumer = await purchasedFulfillmentContext(h.db, filter, firstOrder._id, first), secondConsumer = await purchasedFulfillmentContext(h.db, filter, secondOrder._id, second);
    const firstLine = firstOrder.snapshot.lines.findIndex(line => line.catalogBinding.itemId === a.origin.source.itemId), secondLine = secondOrder.snapshot.lines.findIndex(line => line.catalogBinding.itemId === b.origin.source.itemId);
    const left = buildCustomerReservation(a, firstConsumer, { lineIndex: firstLine, quantity: '1', unitIds: [unitId], actor: scope.userId });
    const right = buildCustomerReservation(b, secondConsumer, { lineIndex: secondLine, quantity: '1', unitIds: [unitId], actor: scope.userId });
    assert.notEqual(left._id, right._id); assert.notEqual(left.salesOrderId, right.salesOrderId);
    await writePurchasedReservation(h.db, filter, a, left, scope.userId, 'Independent first source authority creation', first);
    const pendingHead = await h.db.collection('catalogUseHeads').findOne({ ...filter, _id: receiptId }, { session: first }); assert.equal(pendingHead.version, 2);
    let conflict;
    try { await writePurchasedReservation(h.db, filter, b, right, scope.userId, 'Independent competing source authority creation', second); }
    catch (error) { conflict = error; }
    assert.ok(conflict, 'Virgin source authority cannot be created by two distinct claims in overlapping transactions');
    assert.equal(conflict.code, 112, `Expected actual Mongo common source write conflict, received ${conflict.code}: ${conflict.message}`);
    assert.equal(first.inTransaction(), true);
    proof = { mode: 'ABSENT_SOURCE_ABORT_BOTH', receiptId, unitId, sourceVersion: 1, firstPendingSourceVersion: 2, firstClaimId: left._id, secondClaimId: right._id, secondErrorCode: conflict.code, secondErrorName: conflict.codeName ?? conflict.name, committed: false, authorizationOverlapClaim: false, construction: 'ACTUAL_ENDPOINT_BUILDER' };
  } finally {
    if (first.inTransaction()) await first.abortTransaction(); if (second.inTransaction()) await second.abortTransaction();
    await first.endSession(); await second.endSession();
  }
  assert.deepEqual(await allSnapshot(h), before, 'No uncommitted domain row, source head, history or authority fence may survive either aborted transaction');
  return proof;
}
