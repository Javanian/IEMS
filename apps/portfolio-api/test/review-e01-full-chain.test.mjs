import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startOwned } from './support/owned-mongo.mjs';
import { runE01Flow, e01Fixture } from './support/review-e01-flow.mjs';

const fixtureUrl = new URL('../../../packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('canonical E01 actual inquiry revisions through 6/4 labor lot output POD VAT invoices and settlement', async t => {
  const fixtureHash = digest(await readFile(fixtureUrl));
  assert.equal(fixtureHash, '88ccf40a5808d7682d16fc83527156f58237c7ab5a404914348337ca6d5a31b6', 'Canonical original E01 fixture changed');
  let clock = new Date(e01Fixture.inquiry.inquiry_date);
  const h = await startOwned(t, { businessClock: () => clock, seedOptions: { e01Operators: true } });
  const flow = await runE01Flow(h, { setClock: date => { clock = date; } });
  const f = flow.fixture;
  await t.test('real inquiry provenance and immutable negotiated quote revisions bind exact order entitlement', async () => {
    const quote = await h.ok(`/commercial/quotes/${flow.quote._id}`);
    assert.equal(quote.revisions.length, 2);
    assert.equal(quote.revisions[0].lines[0].unitPrice, '12800.00');
    assert.equal(quote.revisions[0].total, '142080.00');
    assert.equal(quote.revisions[1].lines[0].unitPrice, '12250.00');
    assert.equal(quote.revisions[1].total, '135975.00');
    assert.equal(flow.so.snapshot.lines[0].provenance.inquiryId, flow.inquiry._id);
    assert.equal(flow.so.snapshot.lines[0].provenance.itemCode, f.item_code);
    const entitlement = await h.ok(`/fulfillment/orders/${flow.so._id}/entitlement`);
    assert.deepEqual(entitlement.authorized, { netAmount: '122500.00', taxAmount: '13475.00', grossAmount: '135975.00' });
    assert.deepEqual(entitlement.billed, entitlement.authorized);
    assert.deepEqual(entitlement.remaining, { netAmount: '0.00', taxAmount: '0.00', grossAmount: '0.00' });
  });
  await t.test('revision2 five-source routing and actual four labor sessions retain elapsed and active hours separately', async () => {
    assert.equal(flow.engineering.currentRevision, 2);
    assert.equal(flow.frozenEngineering.operations.length, 5);
    assert.equal(flow.frozenEngineering.materials.length, 5);
    assert.equal(flow.frozenEngineering.materials[3].quantityPerUnit, '2.0000');
    assert.deepEqual(await h.ok(`/manufacturing/engineering/${flow.engineering._id}/revisions/2`), flow.frozenEngineering);
    const labor = [];
    for (const [index, wo] of flow.workOrders.entries()) {
      const actual = await h.ok(`/manufacturing/work-orders/${wo._id}`), entries = await h.ok(`/manufacturing/work-orders/${wo._id}/labor`);
      assert.equal(actual.records.length, 5); assert.deepEqual(actual.requiredLaborOperationIndices, [0, 3]); assert.equal(actual.laborEvidence.length, 2);
      assert.deepEqual(actual.output.serials, f.work_orders[index].produced_serials);
      for (const entry of entries) {
        const source = f.execution_sessions.find(row => row.work_order_id === f.work_orders[index].id && row.operation_no === f.engineering_package.routing.operations[entry.operationIndex].operation_no);
        assert.ok(source); assert.equal(entry.operatorId, flow.manifest.employeeBindings[source.employee_id]); assert.equal(entry.recordedBy, entry.operatorId);
        assert.equal(entry.startedAt, new Date(source.start_time).toISOString()); assert.equal(entry.endedAt, new Date(source.end_time).toISOString());
        assert.equal(entry.durationMs, new Date(source.end_time) - new Date(source.start_time)); assert.equal(entry.activeDurationMs, Number(source.run_hours) * 3600000);
        labor.push(entry);
      }
    }
    assert.equal(labor.length, 4); assert.equal(labor.reduce((sum, row) => sum + row.activeDurationMs, 0), 45 * 3600000);
  });
  await t.test('five actual received lots conserve 10/10/10/20/10 without invented incoming serials or second genealogy consumption', async () => {
    for (const [index, receipt] of flow.receipts.entries()) {
      const actual = await h.ok(`/warehouse/receipts/${receipt._id}`), source = f.procurement.goods_receipt.lines[index];
      assert.equal(actual.lotNumber, source.lot_number); assert.equal(actual.heatNumber, source.heat_number);
      assert.equal(actual.availableQuantity, '0'); assert.equal(actual.manufacturingReservedQuantity, '0'); assert.equal(Number(actual.manufacturingConsumedQuantity), Number(source.received_qty));
      assert.equal(await h.db.collection('warehouseSerials').countDocuments({ receiptId: receipt._id }), 0);
      const moves = await h.db.collection('manufacturingMovements').find({ receiptId: receipt._id, kind: 'MATERIAL_CONSUMED' }).toArray();
      assert.equal(moves.length, 2); assert.equal(moves.reduce((sum, move) => sum + Number(move.quantity), 0), Number(source.received_qty));
    }
    for (const [index, wo] of flow.workOrders.entries()) {
      const view = await h.ok(`/manufacturing/work-orders/${wo._id}/genealogy`);
      assert.equal(view.status, 'FROZEN'); assert.equal(view.allocations.length, Number(f.work_orders[index].target_qty) * 5); assert.deepEqual(view.losses, []);
      assert.ok(view.balances.every(row => row.remainingQuantity === '0'));
      assert.equal(flow.shipments[index].sources[0].genealogy.revision, view.currentRevision);
    }
  });
  await t.test('exact serial shipments 6/4 and original dated POD confirmations preserve dispatch and delivery separately', async () => {
    const all = [];
    for (const [index, shipment] of flow.shipments.entries()) {
      assert.equal(shipment.shippedAt, new Date(f.shipments[index].dispatched_at).toISOString());
      assert.deepEqual(shipment.sources[0].serials, f.shipments[index].lines[0].serials); all.push(...shipment.sources[0].serials);
      const delivery = await h.ok(`/deliveries/shipments/${shipment._id}`);
      assert.equal(delivery.status, 'DELIVERED'); assert.equal(Number(delivery.deliveredQuantity), Number(f.shipments[index].lines[0].shipped_qty));
      assert.equal(delivery.confirmations[0].deliveredAt, new Date(f.shipments[index].proof_of_delivery.delivered_at).toISOString());
      assert.equal(delivery.confirmations[0].evidenceReference, f.shipments[index].proof_of_delivery.pod_id);
      assert.equal((await h.ok(`/fulfillment/shipments/${shipment._id}`)).status, 'SHIPPED');
    }
    assert.equal(new Set(all).size, 10);
    const balance = await h.ok(`/fulfillment/orders/${flow.so._id}/balances`);
    assert.equal(balance.lines[0].shippedQuantity, '10'); assert.equal(balance.lines[0].invoicedQuantity, '10');
  });
  await t.test('two actual VAT invoices and payment allocations settle exactly135975 without overbilling or overship', async () => {
    for (const [index, invoice] of flow.invoices.entries()) {
      const actual = await h.ok(`/fulfillment/invoices/${invoice._id}`);
      assert.equal(actual.total, f.invoices[index].totals.gross_amount); assert.equal(actual.netAmount, f.invoices[index].totals.net_amount); assert.equal(actual.taxAmount, f.invoices[index].totals.tax_amount);
      assert.equal(actual.status, 'PAID'); assert.equal(actual.outstandingAmount, '0.00'); assert.equal(actual.paidAmount, actual.total);
    }
    assert.equal(flow.payments.reduce((sum, payment) => sum + BigInt(payment.amount.replace('.', '')), 0n), 13597500n);
    const snapshot = async () => Promise.all(['warehouseReceipts', 'manufacturingOutputUnits', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentTallies', 'deliveryHeads', 'deliveryConfirmations'].map(name => h.db.collection(name).find().sort({ _id: 1 }).toArray()));
    const before = await snapshot();
    const billed = await h.req('/fulfillment/invoices', { salesOrderId: flow.so._id, expectedVersion: flow.so.version, lines: [{ shipmentId: flow.shipments[0]._id, quantity: '1' }], idempotencyKey: randomUUID() }, h.alpha);
    assert.equal(billed.status, 409);
    const over = await h.req('/fulfillment/shipments', { salesOrderId: flow.so._id, expectedVersion: flow.so.version, lineIndex: 0, uom: 'UN', sources: [{ sourceType: 'WORK_ORDER', sourceId: flow.workOrders[0]._id, quantity: '11', serials: [...f.work_orders[0].produced_serials, ...f.work_orders[1].produced_serials, 'SN-INVALID-011'] }], reference: 'E01-OVERSHIP-REFUSED', idempotencyKey: randomUUID() }, h.alpha);
    assert.equal(over.status, 409); assert.deepEqual(await snapshot(), before);
    for (const entry of flow.replay) assert.deepEqual(await h.ok(entry.path, entry.body, entry.status || 200), entry.result);
    assert.deepEqual(await snapshot(), before);
  });
  assert.equal(digest(await readFile(fixtureUrl)), fixtureHash);
  t.diagnostic(JSON.stringify({ fixtureHash, manifest: flow.manifest, dates: flow.events, scope: 'Owned actual mounted API, recorded fixture evidence; no external supplier/carrier/hardware verification' }));
});
