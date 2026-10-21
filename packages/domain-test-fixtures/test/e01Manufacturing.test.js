/**
 * Test Suite: Scenario E01 (Manufacturing 10 Units End-to-End)
 * Uses Node.js native test runner (node:test, node:assert).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { e01ManufacturingFixture, decimal, validation } = require('../index');

test('E01 - Master Plan Scenario Consistency and Completeness', async (t) => {
  await t.test('Quotation lifecycle: Rev 1 is SUPERSEDED, Rev 2 is ACCEPTED', () => {
    const rev1 = e01ManufacturingFixture.quotation.revisions.find(r => r.revision_no === 1);
    const rev2 = e01ManufacturingFixture.quotation.revisions.find(r => r.revision_no === 2);

    assert.ok(rev1, 'Quotation Rev 1 must exist');
    assert.ok(rev2, 'Quotation Rev 2 must exist');
    assert.equal(rev1.status, 'SUPERSEDED');
    assert.equal(rev1.superseded_by_revision_no, 2);
    assert.equal(rev2.status, 'ACCEPTED');
    assert.equal(rev2.lines[0].unit_price, '12250.00');
    assert.equal(rev2.lines[0].quoted_qty, '10.0000');
  });

  await t.test('Customer acceptance and Sales Order linkage', () => {
    const acc = e01ManufacturingFixture.quote_acceptance;
    const so = e01ManufacturingFixture.sales_order;

    assert.equal(acc.accepted_qty, '10.0000');
    assert.equal(acc.accepted_unit_price, '12250.00');
    assert.equal(acc.accepted_net_amount, '122500.00');

    assert.equal(so.lines.length, 1);
    const line = so.lines[0];
    assert.equal(line.quote_acceptance_id, acc.id);
    assert.equal(line.ordered_qty, '10.0000');
    assert.equal(line.net_amount, '122500.00');
    assert.equal(line.tax_amount, '13475.00');
    assert.equal(line.total_amount, '135975.00');
    assert.equal(line.status, 'FULFILLED');
  });

  await t.test('Billing Entitlement cap matches Sales Order net amount', () => {
    const ent = e01ManufacturingFixture.billing_entitlement;
    const soLine = e01ManufacturingFixture.sales_order.lines[0];

    assert.equal(ent.authorized_net_cap, soLine.net_amount);
    assert.equal(ent.delivery_billed_net, '122500.00');
    assert.equal(ent.milestone_billed_net, '0.00');
    assert.equal(ent.remaining_billable_net, '0.00');
    assert.equal(ent.status, 'FULLY_BILLED');
  });

  await t.test('BOM and Routing revisions exist in released engineering package', () => {
    const pkg = e01ManufacturingFixture.engineering_package;
    assert.equal(pkg.status, 'RELEASED_FOR_PRODUCTION');
    assert.equal(pkg.revision_code, 'REV-B');

    assert.equal(pkg.bom.components.length, 5);
    const casting = pkg.bom.components.find(c => c.item_code === 'CST-HC-250');
    assert.ok(casting);
    assert.equal(casting.qty_per_parent, '1.0000');

    const bearings = pkg.bom.components.find(c => c.item_code === 'BRG-SKF-22220');
    assert.ok(bearings);
    assert.equal(bearings.qty_per_parent, '2.0000');

    assert.equal(pkg.routing.operations.length, 5);
  });

  await t.test('Two Work Orders split (6 units and 4 units) equal exact demand of 10 units', () => {
    const wos = e01ManufacturingFixture.work_orders;
    assert.equal(wos.length, 2);

    const wo1 = wos.find(w => w.id === 'WO-2026-MFG-001');
    const wo2 = wos.find(w => w.id === 'WO-2026-MFG-002');

    assert.ok(wo1);
    assert.ok(wo2);
    assert.equal(wo1.target_qty, '6.0000');
    assert.equal(wo2.target_qty, '4.0000');

    const totalAllocated = decimal.add(wo1.demand_allocation.allocated_qty, wo2.demand_allocation.allocated_qty, 4);
    assert.equal(totalAllocated, '10.0000');

    assert.equal(wo1.produced_serials.length, 6);
    assert.equal(wo2.produced_serials.length, 4);

    // Verify all 10 serials are mutually exclusive
    const allSerials = [...wo1.produced_serials, ...wo2.produced_serials];
    const uniqueSerials = new Set(allSerials);
    assert.equal(uniqueSerials.size, 10);
  });

  await t.test('Goods Receipt lots released by QA', () => {
    const gr = e01ManufacturingFixture.procurement.goods_receipt;
    assert.equal(gr.status, 'QC_RELEASED');
    assert.equal(gr.lines.length, 5);
    const castingLine = gr.lines.find(l => l.item_code === 'CST-HC-250');
    assert.equal(castingLine.lot_number, 'LOT-2026-CST-088');
    assert.equal(castingLine.heat_number, 'H-7741');
  });

  await t.test('Material issues to both work orders match BOM scaling', () => {
    const issues = e01ManufacturingFixture.material_issues;
    const iss1 = issues.find(i => i.work_order_id === 'WO-2026-MFG-001');
    const iss2 = issues.find(i => i.work_order_id === 'WO-2026-MFG-002');

    assert.ok(iss1);
    assert.ok(iss2);

    // WO 1: 6 units -> 6 castings, 12 bearings
    const cst1 = iss1.lines.find(l => l.item_code === 'CST-HC-250');
    const brg1 = iss1.lines.find(l => l.item_code === 'BRG-SKF-22220');
    assert.equal(cst1.qty, '6.0000');
    assert.equal(brg1.qty, '12.0000');

    // WO 2: 4 units -> 4 castings, 8 bearings
    const cst2 = iss2.lines.find(l => l.item_code === 'CST-HC-250');
    const brg2 = iss2.lines.find(l => l.item_code === 'BRG-SKF-22220');
    assert.equal(cst2.qty, '4.0000');
    assert.equal(brg2.qty, '8.0000');
  });

  await t.test('QC Release orders cover all 10 serials with zero rejection', () => {
    const releases = e01ManufacturingFixture.quality_releases;
    assert.equal(releases.length, 2);

    const rel1 = releases.find(r => r.certificate_no === 'QC-REL-001');
    const rel2 = releases.find(r => r.certificate_no === 'QC-REL-002');

    assert.equal(rel1.accepted_qty, '6.0000');
    assert.equal(rel1.rejected_qty, '0.0000');
    assert.equal(rel2.accepted_qty, '4.0000');
    assert.equal(rel2.rejected_qty, '0.0000');
  });

  await t.test('Partial Shipment 1 (6 units) and Partial Shipment 2 (4 units) match PODs', () => {
    const shps = e01ManufacturingFixture.shipments;
    assert.equal(shps.length, 2);

    const shp1 = shps.find(s => s.id === 'SHP-2026-0041');
    const shp2 = shps.find(s => s.id === 'SHP-2026-0042');

    assert.equal(shp1.lines[0].shipped_qty, '6.0000');
    assert.equal(shp1.lines[0].serials.length, 6);
    assert.equal(shp1.proof_of_delivery.status, 'SIGNED_AND_CONFIRMED');

    assert.equal(shp2.lines[0].shipped_qty, '4.0000');
    assert.equal(shp2.lines[0].serials.length, 4);
    assert.equal(shp2.proof_of_delivery.status, 'SIGNED_AND_CONFIRMED');
  });

  await t.test('Delivery Invoices 1 & 2 sum exactly to total order amount', () => {
    const invs = e01ManufacturingFixture.invoices;
    assert.equal(invs.length, 2);

    const inv1 = invs.find(i => i.id === 'INV-2026-0104');
    const inv2 = invs.find(i => i.id === 'INV-2026-0118');

    assert.equal(inv1.totals.net_amount, '73500.00');
    assert.equal(inv1.totals.tax_amount, '8085.00');
    assert.equal(inv1.totals.gross_amount, '81585.00');

    assert.equal(inv2.totals.net_amount, '49000.00');
    assert.equal(inv2.totals.tax_amount, '5390.00');
    assert.equal(inv2.totals.gross_amount, '54390.00');

    const totalNet = decimal.add(inv1.totals.net_amount, inv2.totals.net_amount, 2);
    const totalTax = decimal.add(inv1.totals.tax_amount, inv2.totals.tax_amount, 2);
    const totalGross = decimal.add(inv1.totals.gross_amount, inv2.totals.gross_amount, 2);

    assert.equal(totalNet, '122500.00');
    assert.equal(totalTax, '13475.00');
    assert.equal(totalGross, '135975.00');
  });

  await t.test('Payments settle both invoices to 0.00 balance', () => {
    const pays = e01ManufacturingFixture.payments;
    assert.equal(pays.length, 2);

    const pay1 = pays.find(p => p.id === 'PAY-2026-0301');
    const pay2 = pays.find(p => p.id === 'PAY-2026-0342');

    assert.equal(pay1.amount_received, '81585.00');
    assert.equal(pay1.allocations[0].amount_applied, '81585.00');

    assert.equal(pay2.amount_received, '54390.00');
    assert.equal(pay2.allocations[0].amount_applied, '54390.00');

    const totalPayments = decimal.add(pay1.amount_received, pay2.amount_received, 2);
    assert.equal(totalPayments, '135975.00');
  });

  await t.test('Validation Engine passes E01 with zero errors', () => {
    const res = validation.validateE01Balance(e01ManufacturingFixture);
    assert.equal(res.valid, true, `Validation errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });
});
