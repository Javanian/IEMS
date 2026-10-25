import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { enforceCompanyTraceResponseLimit } from '../../../apps/portfolio-api/src/company-stock-trace.mjs';
import { stockHash, stockHashless } from '../../../apps/portfolio-api/src/catalog-stock-use-state.mjs';
import { startOwned, command, makeFixture, makeConsumer, getCompany, reserveCompanyBody, executionRoot, tracePath, readTrace, replaceWhile, traceFixture } from './support.mjs';

test('trace envelope enforces the actual 512 KiB UTF8 boundary', () => {
  const maximum = 512 * 1024, overhead = Buffer.byteLength(JSON.stringify({ data: { padding: '' } }), 'utf8');
  const remaining = maximum - overhead, exact = { padding: 'é'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2) };
  assert.equal(Buffer.byteLength(JSON.stringify({ data: exact }), 'utf8'), maximum);
  assert.equal(enforceCompanyTraceResponseLimit(exact), exact);
  assert.throws(() => enforceCompanyTraceResponseLimit({ padding: `${exact.padding}x` }), { status: 409, code: 'TRACE_LIMIT_EXCEEDED' });
});

test('independent actual company unit trace and reverse evidence', async t => {
  const h = await startOwned(t), phaseReads = new Map();
  function exactRoot(trace, fixture, index) {
    assert.equal(trace.schema, 'COMPANY_UNIT_TRACE_V1'); assert.equal(trace.companyReceiptId, fixture.sourceId); assert.equal(trace.companyUnitId, fixture.rootUnits[index]._id);
    assert.equal(trace.outputUnitId, fixture.rootUnits[index].outputUnitId); assert.equal(trace.serial, fixture.produced[index]); assert.equal(trace.sourcePolicy, 'ONE_HOP_SOURCE');
    assert.equal(trace.ancestry.basis, 'EXACT_OUTPUT_ATTRIBUTION'); assert.deepEqual(trace.ancestry.companySources, []);
    const sources = trace.ancestry.purchasedSources;
    assert.equal(sources.length, 2);
    const lot = sources.find(row => row.receiptId === fixture.producerLot._id), serial = sources.find(row => row.receiptId === fixture.producerSerial._id);
    assert.ok(lot); assert.ok(serial); assert.equal(lot.quantity, '1.25'); assert.equal(lot.uom, 'KG'); assert.equal(serial.quantity, '2'); assert.equal(serial.uom, 'UN');
    assert.deepEqual(serial.serials, fixture.incoming.slice(index * 2, index * 2 + 2));
    for (const row of sources) { assert.ok(row.consumptionId); assert.match(row.consumptionHash, /^[a-f0-9]{64}$/); assert.match(row.originHash, /^[a-f0-9]{64}$/); }
    assert.equal(trace.holdPolicy.basis, 'CONSERVATIVE_CONSUMED_BATCH');
    assert.deepEqual(trace.holdPolicy.receiptIds, [fixture.producerLot._id, fixture.producerSerial._id].sort());
    assert.equal(trace.holdPolicy.receiptIds.includes(fixture.abandoned._id), false);
    assert.equal(trace.completeness.complete, true); assert.equal(trace.completeness.oneGeneration, true);
  }
  const f = await traceFixture(h, { onPhase: async current => {
    const traces = [];
    for (let index = 0; index < 2; index++) {
      const trace = await readTrace(h, current.sourceId, current.rootUnits[index]._id); exactRoot(trace, current, index); traces.push(trace);
      const uses = trace.uses;
      assert.deepEqual(Object.keys(uses).sort(), ['reserved', 'issued', 'consumedUnattributed', 'outputs', 'losses', 'abandoned'].sort());
      for (const use of Object.values(uses).flat()) { assert.equal(use.selectedQuantity, '1'); assert.equal(use.reservationQuantity, '2'); assert.equal(use.consumer.executionId, current.job._id); }
      if (current.phase === 'AVAILABLE') assert.ok(Object.values(uses).every(rows => rows.length === 0));
      if (current.phase === 'RESERVED') { assert.equal(uses.reserved.length, 1); assert.equal(uses.abandoned.length, 0); assert.equal(uses.reserved[0].issue, null); }
      if (current.phase === 'ABANDONED') { assert.equal(uses.abandoned.length, 1); assert.equal(uses.abandoned[0].reservationId, current.abandonedReservationId); assert.equal(uses.reserved.length, 0); }
      if (!['AVAILABLE', 'RESERVED', 'ABANDONED'].includes(current.phase)) { assert.equal(uses.abandoned.length, 1); assert.equal(uses.abandoned[0].reservationId, current.abandonedReservationId); }
      if (current.phase === 'ISSUED') { assert.equal(uses.issued.length, 1); assert.ok(uses.issued[0].issue.id); assert.equal(uses.issued[0].consumption, null); }
      if (current.phase === 'CONSUMED_UNATTRIBUTED') { assert.equal(uses.consumedUnattributed.length, 1); assert.ok(uses.consumedUnattributed[0].consumption.id); assert.equal(uses.outputs.length, 0); assert.equal(uses.losses.length, 0); }
      if (current.phase === 'OUTPUT_UNREVIEWED') {
        if (index === 0) { assert.equal(uses.outputs.length, 1); assert.equal(uses.outputs[0].output.status, 'QUARANTINED'); assert.equal(uses.outputs[0].output.qcDisposition, null); assert.equal(uses.outputs[0].output.companyReceiptId, null); }
        else assert.equal(uses.consumedUnattributed.length, 1);
      }
      if (['LOSS_RECORDED', 'QC_ACCEPTED', 'STORED'].includes(current.phase)) {
        assert.equal(uses.consumedUnattributed.length, 0);
        if (index === 0) { assert.equal(uses.outputs.length, 1); assert.equal(uses.losses.length, 0); }
        else { assert.equal(uses.outputs.length, 0); assert.equal(uses.losses.length, 1); assert.equal(uses.losses[0].quantity, '1'); }
      }
      if (current.phase === 'QC_ACCEPTED' && index === 0) { assert.equal(uses.outputs[0].output.qcDisposition, 'ACCEPTED'); assert.equal(uses.outputs[0].output.status, 'ACCEPTED'); assert.equal(uses.outputs[0].output.companyReceiptId, null); }
      if (current.phase === 'STORED' && index === 0) { assert.equal(uses.outputs[0].output.status, 'STORED'); assert.equal(uses.outputs[0].output.companyReceiptId, current.job.companyStock._id); assert.equal(uses.outputs[0].output.companyUnitId, current.job.companyStock.units[0]._id); }
    }
    phaseReads.set(current.phase, traces);
  } });

  await t.test('all actual claim disposition phases retain exact per-unit raw serials and never turn process loss into output', async () => {
    assert.deepEqual([...phaseReads.keys()], ['AVAILABLE', 'RESERVED', 'ABANDONED', 'ISSUED', 'CONSUMED_UNATTRIBUTED', 'OUTPUT_UNREVIEWED', 'LOSS_RECORDED', 'QC_ACCEPTED', 'STORED']);
    assert.equal(phaseReads.get('STORED')[1].uses.outputs.length, 0);
    assert.equal(phaseReads.get('STORED')[0].ancestry.purchasedSources.find(row => row.receiptId === f.producerSerial._id).serials.includes(f.incoming[4]), false, 'rejected producer output raw serials must not be attributed to an accepted company unit');
  });

  await t.test('terminal leaf trace has direct raw plus only the selected upstream company output ancestry', async () => {
    const leaf = f.job.companyStock, unit = leaf.units[0], trace = await readTrace(h, leaf._id, unit._id);
    assert.equal(trace.sourcePolicy, 'LEAF_ONLY'); assert.equal(trace.current.eligible, false); assert.ok(trace.current.blockers.includes('LEAF_ONLY'));
    assert.equal(trace.ancestry.purchasedSources.length, 1); assert.equal(trace.ancestry.purchasedSources[0].receiptId, f.consumerLot._id); assert.equal(trace.ancestry.purchasedSources[0].quantity, '1.25');
    assert.equal(trace.ancestry.companySources.length, 1);
    const ancestor = trace.ancestry.companySources[0]; assert.equal(ancestor.companyUnitId, f.rootUnits[0]._id); assert.equal(ancestor.outputUnitId, f.rootUnits[0].outputUnitId); assert.equal(ancestor.quantity, '1');
    assert.deepEqual(ancestor.purchasedSources.find(row => row.receiptId === f.producerSerial._id).serials, f.incoming.slice(0, 2));
    assert.deepEqual(trace.holdPolicy.receiptIds, [f.consumerLot._id, f.producerLot._id, f.producerSerial._id].sort());
    assert.ok(Object.values(trace.uses).every(rows => rows.length === 0));
  });

  await t.test('company-reader-only grant can trace while revoked, foreign, malformed and mismatched identities refuse without writes', async () => {
    const restoreReader = await h.setRoles(h.seeded[0], ['companyStockReader']);
    try { await readTrace(h, f.sourceId, f.rootUnits[0]._id); }
    finally { await restoreReader(); }
    const restoreRevoked = await h.setRoles(h.seeded[0], ['internalExecutionReader']);
    try { await readTrace(h, f.sourceId, f.rootUnits[0]._id, { status: 403, code: 'SCOPE_DENIED' }); }
    finally { await restoreRevoked(); }
    await readTrace(h, f.sourceId, f.rootUnits[0]._id, { status: 404, code: 'NOT_FOUND', cookie: h.beta });
    await readTrace(h, f.sourceId, randomUUID(), { status: 404, code: 'NOT_FOUND' });
    await readTrace(h, f.sourceId, f.job.companyStock.units[0]._id, { status: 404, code: 'NOT_FOUND' });
    await readTrace(h, 'not-a-uuid', f.rootUnits[0]._id, { status: 400, code: 'INVALID_ID' });
  });

  await t.test('current hold and actual item withdrawal leave immutable historical trace readable', async () => {
    const original = await readTrace(h, f.sourceId, f.rootUnits[0]._id), stock = await getCompany(h, f.sourceId);
    const held = await h.ok(`/company-stock/receipts/${f.sourceId}/holds`, command({ expectedVersion: stock.version, reasonCode: 'TRACE_REVIEW' }));
    const trace = await readTrace(h, f.sourceId, f.rootUnits[0]._id);
    assert.ok(trace.current.blockers.includes('COMPANY_SOURCE_HELD')); assert.equal(trace.current.eligible, false); assert.deepEqual(trace.ancestry, original.ancestry); assert.deepEqual(trace.uses, original.uses);
    await h.ok(`/company-stock/receipts/${f.sourceId}/holds/release`, command({ expectedVersion: held.version, expectedHoldId: held.hold._id }));
    const item = await h.ok(`/inventory-master/items/${f.componentItem._id}`);
    await h.ok(`/inventory-master/items/${item._id}/revisions`, command({ expectedVersion: item.version, ...item.content, description: `${f.prefix} new specification after historical use` }));
    const withdrawn = await readTrace(h, f.sourceId, f.rootUnits[0]._id);
    assert.ok(withdrawn.current.blockers.includes('ITEM_CHANGED')); assert.deepEqual(withdrawn.ancestry, original.ancestry); assert.deepEqual(withdrawn.uses, original.uses);
  });

  await t.test('orphan reverse proof and self-rehashed producer pointers fail closed and restore exactly', async () => {
    const claim = await h.db.collection('companyMaterialReservations').findOne({ _id: f.activeReservationId });
    await h.db.collection('companyMaterialReservations').deleteOne({ _id: claim._id });
    try { await readTrace(h, f.sourceId, f.rootUnits[0]._id, { status: 409, code: 'COMPANY_STOCK_SOURCE_INVALID' }); }
    finally { await h.db.collection('companyMaterialReservations').insertOne(claim); }
    const unit = await h.db.collection('internalCompanyStockUnits').findOne({ _id: f.rootUnits[0]._id }), forged = { ...stockHashless(unit), outputUnitId: randomUUID() }; forged.contentHash = stockHash(forged);
    await replaceWhile(h, 'internalCompanyStockUnits', unit, forged, async () => {
      await readTrace(h, f.sourceId, unit._id, { status: 409, code: 'INTERNAL_EXECUTION_SOURCE_INVALID' });
      await readTrace(h, f.job.companyStock._id, f.job.companyStock.units[0]._id, { status: 409, code: 'INTERNAL_EXECUTION_SOURCE_INVALID' });
    });
    await readTrace(h, f.sourceId, f.rootUnits[0]._id);
  });

  await t.test('actual rejected consumer output remains rejected with no invented company receipt or unit', async () => {
    const rejected = await traceFixture(h, { qcDisposition: 'REJECTED' });
    const trace = await readTrace(h, rejected.sourceId, rejected.rootUnits[0]._id), output = trace.uses.outputs[0].output;
    assert.equal(output.qcDisposition, 'REJECTED'); assert.equal(output.status, 'REJECTED'); assert.equal(output.companyReceiptId, null); assert.equal(output.companyUnitId, null);
    assert.equal((await readTrace(h, rejected.sourceId, rejected.rootUnits[1]._id)).uses.losses.length, 1);
  });

  await t.test('real released claims cross the exact 32-execution cap without returning partial trace or writing state', async () => {
    const fixture = await makeFixture(h), receiptId = fixture.producer.companyStock._id, selectedId = fixture.producer.companyStock.units[0]._id;
    for (let index = 0; index < 32; index++) {
      let consumer = await makeConsumer(h, fixture, { quantity: '1' }), stock = await getCompany(h, receiptId);
      consumer = await h.ok(`${executionRoot}/${consumer._id}/reservations`, reserveCompanyBody(consumer, stock, stock.units.filter(unit => unit._id === selectedId), fixture.componentItem._id));
      stock = await getCompany(h, receiptId);
      const claim = consumer.reservations.find(row => row.status === 'RESERVED' && row.sourceKind === 'COMPANY_OUTPUT');
      await h.ok(`${executionRoot}/${consumer._id}/reservations/${claim._id}/release`, command({ expectedVersion: consumer.version, expectedStockVersion: stock.version }));
      if (index === 30) { const atLimit = await readTrace(h, receiptId, selectedId); assert.equal(atLimit.completeness.counts.executions, 32); assert.equal(atLimit.uses.abandoned.length, 31); }
    }
    await readTrace(h, receiptId, selectedId, { status: 409, code: 'TRACE_LIMIT_EXCEEDED' });
    assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ companyReceiptId: receiptId, status: 'RELEASED' }), 32);
  });
});
