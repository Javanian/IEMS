import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startOwned } from '../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { runE01Flow, e01Fixture } from '../../../apps/portfolio-api/test/support/review-e01-flow.mjs';
import { bindBusinessClock } from '../../../apps/portfolio-api/src/business-clock.mjs';
import { afterAuthorization, domainSnapshot } from '../../wave4map/qa/mapping-fixture.mjs';

const quantity = value => { assert.match(value, /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/); const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); };
const money = value => { assert.match(value, /^(0|[1-9][0-9]*)\.[0-9]{2}$/); return BigInt(value.replace('.', '')); };
const digest = value => createHash('sha256').update(value).digest('hex');

test('independent canonical E01 reconciliation with explicit historical adapter limits', async t => {
  const fixtureUrl = new URL('../../../packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js', import.meta.url), beforeFixture = digest(await readFile(fixtureUrl));
  assert.equal(beforeFixture, '88ccf40a5808d7682d16fc83527156f58237c7ab5a404914348337ca6d5a31b6');
  let clock = new Date(e01Fixture.inquiry.inquiry_date);
  const h = await startOwned(t, { businessClock: () => clock, seedOptions: { e01Operators: true } }), observations = [];
  // The shared API driver creates the fixture; assertions below independently reconcile stored effects.
  const flow = await runE01Flow(h, { setClock: date => { clock = date; }, onCheckpoint: async ({ date }) => {
    observations.push({ date, reserved: await h.db.collection('manufacturingMovements').countDocuments({ kind: 'MATERIAL_RESERVED' }), consumed: await h.db.collection('manufacturingMovements').countDocuments({ kind: 'MATERIAL_CONSUMED' }) });
  } });

  await t.test('synthetic clock binding requires owned namespace and exact existing marker', async () => {
    const clock = () => new Date('2000-01-01T00:00:00Z');
    for (const databaseName of ['portfolio', 'iems_production', 'portfolio_test']) await assert.rejects(bindBusinessClock({ db: { databaseName } }, clock, 'marker'), error => error.code === 'OWNED_DATABASE_REQUIRED');
    await assert.rejects(bindBusinessClock(h.runtime, clock, 'missing-marker'), error => error.code === 'OWNED_DATABASE_REQUIRED');
    assert.equal(h.runtime.businessClockMode, 'SYNTHETIC_BUSINESS_CLOCK_REPLAY');
    const identity = await h.ok('/session/me'); assert.equal(identity.fixtureReplay.mode, 'SYNTHETIC_BUSINESS_CLOCK_REPLAY'); assert.ok(Math.abs(Date.now() - Date.parse(identity.fixtureReplay.recordedAt)) < 10000);
  });

  await t.test('actual source movements and shipped identities reconcile exact five-source 6/4 production', async () => {
    const outputs = await h.db.collection('manufacturingOutputUnits').find({ workOrderId: { $in: flow.workOrders.map(row => row._id) } }).toArray();
    assert.equal(outputs.length, 10); assert.equal(new Set(outputs.map(row => row.serial)).size, 10);
    assert.deepEqual(outputs.map(row => row.serial).sort(), e01Fixture.work_orders.flatMap(row => row.produced_serials).sort());
    for (const [index, receipt] of flow.receipts.entries()) {
      const raw = await h.db.collection('warehouseReceipts').findOne({ _id: receipt._id }), expected = quantity(e01Fixture.procurement.goods_receipt.lines[index].received_qty);
      assert.equal(quantity(raw.manufacturingConsumedQuantity), expected); assert.equal(quantity(raw.availableQuantity), 0n); assert.equal(quantity(raw.manufacturingReservedQuantity), 0n);
      const movements = await h.db.collection('manufacturingMovements').find({ receiptId: receipt._id, kind: 'MATERIAL_CONSUMED' }).toArray();
      assert.equal(movements.length, 2); assert.equal(movements.reduce((sum, row) => sum + quantity(row.quantity), 0n), expected);
      assert.equal(await h.db.collection('warehouseSerials').countDocuments({ receiptId: receipt._id }), 0);
      for (const output of outputs) { const trace = output.materialTrace.find(row => row.receiptId === receipt._id); assert.ok(trace); assert.equal(trace.lotNumber, raw.lotNumber); assert.equal(trace.heatNumber, raw.heatNumber); }
    }
    for (const [index, shipment] of flow.shipments.entries()) {
      assert.equal(quantity(shipment.quantity), quantity(e01Fixture.work_orders[index].target_qty));
      assert.ok(outputs.filter(row => row.shipmentId === shipment._id).every(row => row.status === 'SHIPPED'));
      assert.equal(outputs.filter(row => row.shipmentId === shipment._id).length, index === 0 ? 6 : 4);
      const delivery = await h.ok(`/deliveries/shipments/${shipment._id}`); assert.equal(delivery.status, 'DELIVERED'); assert.equal(quantity(delivery.remainingQuantity), 0n);
      assert.equal(delivery.confirmations[0].deliveredAt, new Date(e01Fixture.shipments[index].proof_of_delivery.delivered_at).toISOString());
    }
  });

  await t.test('exact gross settlement and acknowledged replay do not duplicate effects; revoked replay denies before key', async () => {
    const invoices = await Promise.all(flow.invoices.map(row => h.ok(`/fulfillment/invoices/${row._id}`)));
    assert.equal(invoices.reduce((sum, row) => sum + money(row.netAmount), 0n), 12250000n); assert.equal(invoices.reduce((sum, row) => sum + money(row.taxAmount), 0n), 1347500n);
    assert.equal(invoices.reduce((sum, row) => sum + money(row.paidAmount), 0n), 13597500n); assert.ok(invoices.every(row => row.status === 'PAID' && row.outstandingAmount === '0.00'));
    const before = await domainSnapshot(h);
    for (const entry of flow.replay) assert.deepEqual(await h.ok(entry.path, entry.body, entry.status || 200), entry.result);
    assert.deepEqual(await domainSnapshot(h), before);
    const member = await h.db.collection('memberships').findOne({ _id: h.seeded[0].membershipId }), shipmentReplay = flow.replay.find(row => row.path === '/fulfillment/shipments');
    try { const denied = await afterAuthorization(h, 'fulfillment.ship', () => h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [] } }), () => h.req(shipmentReplay.path, shipmentReplay.body, h.alpha)); assert.equal(denied.status, 403); assert.deepEqual(await domainSnapshot(h), before); }
    finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  });

  await t.test('historical adapter deviations stay observable instead of being counted as exact event-date parity', async () => {
    assert.match(flow.manifest.engineering.dateLimitation, /Apr15.*Apr17/);
    for (const [index, issue] of e01Fixture.material_issues.entries()) {
      const atIssue = observations.find(row => row.date === new Date(issue.posted_at).toISOString()); assert.ok(atIssue); assert.equal(atIssue.reserved, (index + 1) * 5); assert.equal(atIssue.consumed, index * 5);
    }
    assert.equal(await h.db.collection('manufacturingMovements').countDocuments({ kind: 'WORK_ORDER_ISSUE' }), 0);
    t.diagnostic('April15 engineering approval is represented by April17 receipt-backed release; April18/25 issue points are reservation, then first-record consumption. Payment and allocation share one command; original later applied_at timestamps are not represented. Supplemental routing evidence is operator-recorded, with no machine telemetry claim.');
    assert.equal(digest(await readFile(fixtureUrl)), beforeFixture);
  });
});
