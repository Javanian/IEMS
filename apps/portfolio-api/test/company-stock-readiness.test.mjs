import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned } from './support/owned-mongo.mjs';
import { command, executionPath, sourcePath, allSnapshot, authorizationOnly, denied,
  makeReadinessFixture, makeThreeUnitEventSource, reserve, reserveBody, abandon, abandonBody,
  openingEvidence } from './support/company-stock-readiness-owner-fixture.mjs';

async function traceRead(h, source, unitId) {
  const before = await allSnapshot(h);
  const trace = await h.ok(`${sourcePath(source)}/units/${unitId}/trace`);
  assert.equal(trace.companyReceiptId, source._id);
  assert.equal(trace.companyUnitId, unitId);
  assert.equal(trace.completeness.complete, true);
  assert.deepEqual(await allSnapshot(h), before, 'Historical trace must not change any durable authority');
  return trace;
}

function physical(source) {
  return { openingQuantity: source.openingQuantity, onHandQuantity: source.onHandQuantity,
    reservedQuantity: source.reservedQuantity, issuedQuantity: source.issuedQuantity,
    consumedQuantity: source.consumedQuantity, availableQuantity: source.availableQuantity };
}

test('company-stock readiness matches real claim and event boundaries without replacing physical stock', async t => {
  const h = await startOwned(t), fixture = await makeReadinessFixture(h);
  let source = await fixture.company(), job, lastReservation, lastReserveBody, lastReserveResult;
  const originalOpening = await openingEvidence(h, source), initialPhysical = physical(source);
  const repeatedUnitId = source.units[0]._id;

  await t.test('ninety-nine genuine reserve and abandon histories retain one reservation slot', async () => {
    for (let index = 0; index < 99; index++) {
      if (index % 20 === 0) job = await fixture.consumer('1');
      const active = await reserve(h, fixture, job, source, repeatedUnitId);
      const released = await abandon(h, active.job, active.source, active.claim);
      job = released.job; source = released.source;
      if ((index + 1) % 20 === 0) t.diagnostic(`Actual owner released histories: ${index + 1}`);
    }
    assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ companyReceiptId: source._id }), 99);
    assert.equal(await h.db.collection('companyStockUseEvents').countDocuments({ companyReceiptId: source._id }), 198);
    assert.equal(source.version, 199);
    assert.deepEqual(physical(source), initialPhysical);
    assert.equal(source.canReserve, true);
    assert.equal(source.capacity.remainingReservationSlots, 1);
    assert.deepEqual(source.reserveBlockers, []);
  });

  await t.test('the hundredth actual claim disables only new reservations while stock stays available', async () => {
    const active = await reserve(h, fixture, job, source, repeatedUnitId);
    job = active.job; source = active.source; lastReservation = active.claim;
    lastReserveBody = active.body; lastReserveResult = active.job;
    assert.equal(source.version, 200);
    assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ companyReceiptId: source._id }), 100);
    assert.equal(source.availableQuantity, '1');
    assert.equal(source.eligibleQuantity, '1');
    assert.equal(source.canReserve, false);
    assert.deepEqual(source.blockers, []);
    assert.deepEqual(source.reserveBlockers, ['RESERVATION_HISTORY_LIMIT']);
    assert.equal(source.capacity.reservationLimitReached, true);
    assert.equal(source.capacity.eventLimitReached, false);
    assert.equal(source.canHold, true);
  });

  await t.test('claim101 is refused atomically while exact acknowledged replay still reauthorizes', async () => {
    const candidate = await fixture.consumer('1'), available = source.units.find(unit => unit.status === 'AVAILABLE');
    await denied(h, `${executionPath(candidate)}/reservations`, reserveBody(fixture, candidate, source, available._id), 'STOCK_HISTORY_LIMIT');
    const before = await allSnapshot(h);
    assert.deepEqual(await h.ok(`${executionPath(job)}/reservations`, lastReserveBody), lastReserveResult);
    assert.deepEqual(await allSnapshot(h), authorizationOnly(before, h, 2));
    const restore = await h.setRoles(h.seeded[0], ['internalExecutionReserve', 'companyStockReader']);
    try { await denied(h, `${executionPath(job)}/reservations`, lastReserveBody, 'SCOPE_DENIED', 403); }
    finally { await restore(); }
  });

  await t.test('a full claim history preserves real hold, abandonment, hold release and historical trace', async () => {
    let held = await h.ok(`${sourcePath(source)}/holds`, command({ expectedVersion: source.version, reasonCode: 'QUALITY_SUSPECT' }));
    const released = await abandon(h, job, held, lastReservation); job = released.job; source = released.source;
    assert.equal(source.availableQuantity, '2'); assert.equal(source.eligibleQuantity, '0');
    source = await h.ok(`${sourcePath(source)}/holds/release`, command({ expectedVersion: source.version, expectedHoldId: held.hold._id }));
    assert.equal(source.version, 203);
    assert.deepEqual(physical(source), initialPhysical);
    assert.deepEqual(await openingEvidence(h, source), originalOpening);
    const trace = await traceRead(h, source, repeatedUnitId);
    assert.equal(trace.uses.abandoned.length, 100);
    assert.equal(trace.completeness.counts.useReservations, 100);
    assert.equal(source.canReserve, false);
    assert.equal(source.canHold, true);
    assert.equal(source.canReleaseHold, false);
    assert.deepEqual(source.reserveBlockers, ['RESERVATION_HISTORY_LIMIT']);
  });

  let eventSource, eventOpening, eventJob, eventClaim;
  await t.test('version500 is reached by actual hold cycles and one claim with no active hold', async () => {
    eventSource = await makeThreeUnitEventSource(h, fixture);
    eventOpening = await openingEvidence(h, eventSource);
    for (let index = 0; index < 249; index++) {
      const held = await h.ok(`${sourcePath(eventSource)}/holds`, command({ expectedVersion: eventSource.version, reasonCode: 'TRACE_REVIEW' }));
      eventSource = await h.ok(`${sourcePath(eventSource)}/holds/release`, command({ expectedVersion: held.version, expectedHoldId: held.hold._id }));
      if ((index + 1) % 50 === 0) t.diagnostic(`Actual owner hold/release pairs: ${index + 1}`);
    }
    assert.equal(eventSource.version, 499);
    assert.equal(await h.db.collection('companyStockUseEvents').countDocuments({ companyReceiptId: eventSource._id }), 498);
    eventJob = await fixture.consumer('1');
    const active = await reserve(h, fixture, eventJob, eventSource, eventSource.units[0]._id);
    eventJob = active.job; eventSource = active.source; eventClaim = active.claim;
    assert.equal(eventSource.version, 500);
    assert.equal(eventSource.hold.active, false);
    assert.equal(eventSource.availableQuantity, '2');
    assert.equal(eventSource.canReserve, true, 'Immediate reserve still costs exactly one source event');
    assert.equal(eventSource.capacity.remainingEvents, 1);
    assert.equal(eventSource.canHold, true);
  });

  await t.test('version501 retains positive stock but rejects every further source write with full rollback', async () => {
    const candidate = await fixture.consumer('1'), available = eventSource.units.find(unit => unit.status === 'AVAILABLE');
    const active = await reserve(h, fixture, candidate, eventSource, available._id);
    eventSource = active.source;
    assert.equal(eventSource.version, 501);
    assert.equal(eventSource.availableQuantity, '1'); assert.equal(eventSource.eligibleQuantity, '1');
    assert.equal(eventSource.hold.active, false);
    assert.equal(await h.db.collection('companyStockUseEvents').countDocuments({ companyReceiptId: eventSource._id }), 500);
    assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ companyReceiptId: eventSource._id }), 2);
    const nextJob = await fixture.consumer('1'), free = eventSource.units.find(unit => unit.status === 'AVAILABLE');
    await denied(h, `${executionPath(nextJob)}/reservations`, reserveBody(fixture, nextJob, eventSource, free._id), 'STOCK_HISTORY_LIMIT');
    await denied(h, `${executionPath(eventJob)}/reservations/${eventClaim._id}/release`, abandonBody(eventJob, eventSource), 'STOCK_HISTORY_LIMIT');
    await denied(h, `${sourcePath(eventSource)}/holds`, command({ expectedVersion: eventSource.version, reasonCode: 'QUALITY_SUSPECT' }), 'STOCK_HISTORY_LIMIT');
    assert.deepEqual(await openingEvidence(h, eventSource), eventOpening);
    await traceRead(h, eventSource, eventClaim.companyUnitIds[0]);
    assert.equal(eventSource.canReserve, false);
    assert.equal(eventSource.capacity.eventLimitReached, true);
    assert.equal(eventSource.capacity.reservationLimitReached, false);
    assert.equal(eventSource.capacity.remainingEvents, 0);
    assert.deepEqual(eventSource.reserveBlockers, ['STOCK_EVENT_HISTORY_LIMIT']);
    assert.deepEqual(eventSource.blockers, []);
    assert.equal(eventSource.canHold, false);
    assert.equal(eventSource.canReleaseHold, false);
  });
});
