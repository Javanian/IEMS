import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwned, command, makeFixture, makeConsumer, getCompany, reserveCompanyBody, reserveDirectLot, executionRoot, allSnapshot, unchanged, denied, replay, revokedReplay, reserve, release, hold, makeReleasedClaimFixture } from './support.mjs';

const tracePath = (source, unitId) => `/company-stock/receipts/${source._id}/units/${unitId}/trace`;

async function read(h, receiptId) {
  return unchanged(h, () => getCompany(h, receiptId));
}

async function trace(h, source, unitId, expectedUses) {
  const value = await unchanged(h, () => h.ok(tracePath(source, unitId)));
  assert.equal(value.completeness.complete, true);
  assert.equal(value.completeness.oneGeneration, true);
  assert.equal(value.current.stockVersion, source.version);
  assert.equal(value.completeness.counts.useReservations, expectedUses);
  assert.deepEqual(value.holdPolicy.receiptIds, source.consumedReceiptIds);
  return value;
}

async function counts(h, source, references, events) {
  assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ companyReceiptId: source._id }), references);
  assert.equal(await h.db.collection('companyMaterialReservationRevisions').countDocuments({ companyReceiptId: source._id }), references * 2);
  assert.equal(await h.db.collection('companyStockUseEvents').countDocuments({ companyReceiptId: source._id }), events);
  assert.equal(source.version, events + 1);
  capacity(source, references);
}

function capacity(source, references) {
  assert.deepEqual(source.capacity, {
    reservationCount: references, reservationLimit: 100, remainingReservationSlots: 100 - references,
    eventCount: source.version - 1, eventLimit: 500, remainingEvents: 501 - source.version,
    reservationLimitReached: references >= 100, eventLimitReached: source.version >= 501,
  });
}

test('independent real company-stock command-capacity boundaries', { timeout: 1500000 }, async t => {
  const h = await startOwned(t), { fixture: f, receiptId, unitId, jobs } = await makeReleasedClaimFixture(h, { count: 99 });
  let capturedReserve, capturedRelease, source;

  await t.test('99 claims allow a fresh100th;100 retains positive physical stock but refuses101 without changing any collection', async () => {
    source = await read(h, receiptId);
    assert.equal(source.availableQuantity, '2'); assert.equal(source.canReserve, true);
    assert.equal(source.reserveBlockers.includes('RESERVATION_HISTORY_LIMIT'), false);
    await counts(h, source, 99, 198);
    const path = `${executionRoot}/${jobs[4]._id}/reservations`;
    const body = reserveCompanyBody(jobs[4], source, [source.units.find(row => row._id === unitId)], f.componentItem._id);
    const options = (await h.db.listCollections({ name: 'internalExecutionOutbox' }).toArray())[0].options;
    await h.db.command({ collMod: 'internalExecutionOutbox', validator: { $jsonSchema: { required: ['INDEPENDENT_OUTBOX_FAILURE'] } }, validationLevel: 'strict', validationAction: 'error' });
    try { await denied(h, path, body, 'INTERNAL_ERROR', 500); }
    finally { await h.db.command({ collMod: 'internalExecutionOutbox', validator: options.validator || {}, validationLevel: options.validationLevel || 'strict', validationAction: options.validationAction || 'error' }); }
    const result = await h.ok(path, body), added = result.reservations.filter(row => !jobs[4].reservations.some(previous => previous._id === row._id));
    assert.equal(added.length, 1); assert.deepEqual(added[0].companyUnitIds, [unitId]);
    const hundred = { path, body, result, job: result, claim: added[0] }; jobs[4] = result; capturedReserve = hundred;
    source = await read(h, receiptId);
    assert.equal(source.availableQuantity, '1'); assert.equal(source.onHandQuantity, '2');
    assert.equal(source.canReserve, false); assert.ok(source.reserveBlockers.includes('RESERVATION_HISTORY_LIMIT'));
    assert.equal(source.blockers.includes('RESERVATION_HISTORY_LIMIT'), false, 'Claim capacity must not become a global physical dependency blocker');
    assert.equal(source.canHold, true); assert.equal(source.canReleaseHold, false); capacity(source, 100);
    const attempted = reserveCompanyBody(jobs[5], source, [source.units.find(row => row.status === 'AVAILABLE')], f.componentItem._id);
    await denied(h, `${executionRoot}/${jobs[5]._id}/reservations`, attempted, 'STOCK_HISTORY_LIMIT');
    capturedRelease = await release(h, jobs[4], hundred.claim); jobs[4] = capturedRelease.job;
    source = await read(h, receiptId);
    assert.equal(source.availableQuantity, '2'); assert.equal(source.canReserve, false);
    assert.ok(source.units.every(row => row.status === 'AVAILABLE'));
    await counts(h, source, 100, 200);
    const value = await trace(h, source, unitId, 100);
    assert.equal(value.uses.abandoned.length, 100);
    assert.ok(Object.entries(value.uses).filter(([name]) => name !== 'abandoned').every(([, rows]) => rows.length === 0));
  });

  await t.test('claim capacity leaves existing release and real hold/release available; exact historical replays have only their precise authorization writes', async () => {
    const held = await hold(h, receiptId); assert.equal(held.result.version, 202);
    assert.equal(held.result.availableQuantity, '2'); assert.equal(held.result.canReserve, false);
    assert.equal(held.result.canHold, false); assert.equal(held.result.canReleaseHold, true);
    const released = await hold(h, receiptId, true); assert.equal(released.result.version, 203);
    assert.equal(released.result.canHold, true); assert.equal(released.result.canReleaseHold, false);
    await replay(h, capturedReserve.path, capturedReserve.body, capturedReserve.result, 2);
    await replay(h, capturedRelease.path, capturedRelease.body, capturedRelease.result, 2);
    await replay(h, held.path, held.body, held.result, 1);
    await revokedReplay(h, capturedReserve.path, capturedReserve.body, ['internalExecutionReserve', 'companyStockReader']);
    await revokedReplay(h, capturedRelease.path, capturedRelease.body, ['internalExecutionReserve', 'companyStockReader']);
    await revokedReplay(h, held.path, held.body, ['companyStockReader']);
    source = await read(h, receiptId); assert.equal(source.version, 203);
    assert.equal(source.hold.active, false); assert.equal(source.availableQuantity, '2');
  });

  await t.test('real hold history reaches500 then501; last release succeeds but further fresh hold is refused without rewriting physical stock/history', async () => {
    while ((await getCompany(h, receiptId)).version < 499) { await hold(h, receiptId); await hold(h, receiptId, true); }
    source = await read(h, receiptId); assert.equal(source.version, 499);
    const held = await hold(h, receiptId); assert.equal(held.result.version, 500);
    assert.equal(held.result.hold.active, true); assert.equal(held.result.availableQuantity, '2');
    assert.equal(held.result.canReleaseHold, true); capacity(held.result, 100);
    const released = await hold(h, receiptId, true); assert.equal(released.result.version, 501);
    source = await read(h, receiptId);
    assert.equal(source.hold.active, false); assert.equal(source.availableQuantity, '2');
    assert.equal(source.canReserve, false); assert.ok(source.reserveBlockers.includes('STOCK_EVENT_HISTORY_LIMIT'));
    assert.equal(source.blockers.includes('STOCK_EVENT_HISTORY_LIMIT'), false);
    assert.equal(source.canHold, false); assert.equal(source.canReleaseHold, false);
    await counts(h, source, 100, 500);
    await denied(h, `/company-stock/receipts/${receiptId}/holds`, command({ expectedVersion: 501, reasonCode: 'QUALITY_SUSPECT' }), 'STOCK_HISTORY_LIMIT');
    await replay(h, released.path, released.body, released.result, 1);
    const value = await trace(h, source, unitId, 100); assert.equal(value.uses.abandoned.length, 100);
  });

  await t.test('one-event reservation at500 is allowed;501 preserves positive available stock and denies later issue/abandon as an explicit hard-cap recovery boundary', async () => {
    const other = await makeFixture(h, { acceptedCount: 3 }), otherId = other.producer.companyStock._id;
    let firstJob = await makeConsumer(h, other, { quantity: '1' }), secondJob = await makeConsumer(h, other, { quantity: '1' });
    const thirdJob = await makeConsumer(h, other, { quantity: '1' });
    firstJob = await reserveDirectLot(h, other, firstJob, '1.25');
    const opening = await getCompany(h, otherId), first = await reserve(h, other, firstJob, opening.units[0]._id); firstJob = first.job;
    while ((await getCompany(h, otherId)).version < 500) { await hold(h, otherId); await hold(h, otherId, true); }
    let current = await read(h, otherId);
    assert.equal(current.version, 500); assert.equal(current.availableQuantity, '2'); assert.equal(current.canReserve, true);
    assert.equal(current.reserveBlockers.includes('STOCK_EVENT_HISTORY_LIMIT'), false);
    assert.equal(current.canHold, true); capacity(current, 1);
    assert.equal(await h.db.collection('companyStockUseEvents').countDocuments({ companyReceiptId: otherId }), 499);
    const second = await reserve(h, other, secondJob, current.units.find(row => row.status === 'AVAILABLE')._id); secondJob = second.job;
    current = await read(h, otherId);
    assert.equal(current.version, 501); assert.equal(current.availableQuantity, '1'); assert.equal(current.onHandQuantity, '3');
    assert.equal(current.canReserve, false); assert.ok(current.reserveBlockers.includes('STOCK_EVENT_HISTORY_LIMIT'));
    assert.equal(current.reserveBlockers.includes('RESERVATION_HISTORY_LIMIT'), false);
    assert.equal(current.canHold, false); capacity(current, 2);
    const attempted = reserveCompanyBody(thirdJob, current, [current.units.find(row => row.status === 'AVAILABLE')], other.componentItem._id);
    await denied(h, `${executionRoot}/${thirdJob._id}/reservations`, attempted, 'STOCK_HISTORY_LIMIT');
    const releaseBody = command({ expectedVersion: secondJob.version, expectedStockVersion: 501 });
    await denied(h, `${executionRoot}/${secondJob._id}/reservations/${second.claim._id}/release`, releaseBody, 'STOCK_HISTORY_LIMIT');
    firstJob = await h.ok(`${executionRoot}/${firstJob._id}/release`, command({ expectedVersion: firstJob.version }));
    assert.equal((await getCompany(h, otherId)).version, 501, 'Work-order release consumes no company source event');
    await denied(h, `${executionRoot}/${firstJob._id}/issue`, command({ expectedVersion: firstJob.version }), 'STOCK_HISTORY_LIMIT');
    await denied(h, `/company-stock/receipts/${otherId}/holds`, command({ expectedVersion: 501, reasonCode: 'QUALITY_SUSPECT' }), 'STOCK_HISTORY_LIMIT');
    await replay(h, second.path, second.body, second.result, 2);
    await revokedReplay(h, second.path, second.body, ['internalExecutionReserve', 'companyStockReader']);
    const value = await trace(h, current, opening.units[0]._id, 1);
    assert.equal(value.uses.reserved.length, 1); assert.equal(value.current.status, 'RESERVED');
    assert.equal(await h.db.collection('companyStockUseEvents').countDocuments({ companyReceiptId: otherId }), 500);
    assert.deepEqual((await read(h, otherId)).units.map(row => row.status).sort(), ['AVAILABLE', 'RESERVED', 'RESERVED']);
  });
  assert.ok((await allSnapshot(h)).companyStockUseHeads.length >= 2);
});
