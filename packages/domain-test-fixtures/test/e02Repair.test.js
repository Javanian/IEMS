/**
 * Test Suite: Scenario E02 (Repair Customer Asset End-to-End & Rejection Variant)
 * Uses Node.js native test runner (node:test, node:assert).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { e02RepairFixture, decimal, validation } = require('../index');

test('E02 - Customer Asset Repair Scenario and Rejection Variant', async (t) => {
  await t.test('Customer asset ownership is preserved and non-inventory', () => {
    const asset = e02RepairFixture.customer_asset;
    assert.equal(asset.ownership_type, 'CUSTOMER_OWNED');
    assert.equal(asset.owner_party_id, 'PRT-CUST-KPC');
    assert.equal(asset.serial_no, '793D-SUSP-B2199');
  });

  await t.test('Repair Case and Custody Transfer tracking', () => {
    const rc = e02RepairFixture.repair_case;
    assert.equal(rc.custody_events.length, 2);

    const intake = rc.custody_events[0];
    assert.equal(intake.event_type, 'RECEIVING_INTAKE');
    assert.equal(intake.custody_state, 'IN_CUSTODY_IEMS');

    const ret = rc.custody_events[1];
    assert.equal(ret.event_type, 'DISPATCH_RETURN');
    assert.equal(ret.custody_state, 'RETURNED_TO_CUSTOMER');
  });

  await t.test('Diagnostic Authorization sets capped fee prior to teardown', () => {
    const diag = e02RepairFixture.diagnostic_authorization;
    assert.equal(diag.status, 'AUTHORIZED');
    assert.equal(diag.capped_diagnostic_fee, '1200.00');
    assert.equal(diag.currency, 'USD');
  });

  await t.test('Teardown findings contain exactly 3 components with distinct dispositions', () => {
    const findings = e02RepairFixture.teardown.findings;
    assert.equal(findings.length, 3);

    const f1 = findings.find(f => f.finding_no === 1);
    const f2 = findings.find(f => f.finding_no === 2);
    const f3 = findings.find(f => f.finding_no === 3);

    assert.equal(f1.disposition, 'REUSE');
    assert.equal(f2.disposition, 'REPAIR');
    assert.equal(f3.disposition, 'REPLACE');
  });

  await t.test('Quotation Rev 1 (Budgetary) is superseded by Rev 2 (Teardown Scope)', () => {
    const q = e02RepairFixture.quotation;
    const rev1 = q.revisions.find(r => r.revision_no === 1);
    const rev2 = q.revisions.find(r => r.revision_no === 2);

    assert.equal(rev1.status, 'SUPERSEDED');
    assert.equal(rev1.superseded_by_revision_no, 2);

    assert.equal(rev2.status, 'ACCEPTED');
    assert.equal(rev2.totals.net_amount, '9000.00');
    assert.equal(rev2.totals.tax_amount, '990.00');
    assert.equal(rev2.totals.gross_amount, '9990.00');
    assert.equal(rev2.required_advance_deposit_amount, '3000.00');
  });

  await t.test('Prepayment deposit is collected before repair job release', () => {
    const prepay = e02RepairFixture.prepayment;
    assert.equal(prepay.initial_amount, '3000.00');
    assert.equal(prepay.status, 'FULLY_APPLIED');
  });

  await t.test('Repair Work Order executes, assembly consumes company replacement part', () => {
    const wo = e02RepairFixture.repair_work_order;
    assert.equal(wo.work_order_type, 'REPAIR');
    assert.equal(wo.customer_asset_id, 'AST-CAT-793D-CYL-88412');
    assert.equal(wo.status, 'COMPLETED');

    const issue = wo.material_issues[0];
    assert.equal(issue.item_code, 'KIT-SEAL-793D-OEM');
    assert.equal(issue.qty, '1.0000');
    assert.equal(issue.total_cost, '1450.00');
  });

  await t.test('Functional test run 1 FAILS, triggers NCR and rework order, run 2 PASSES', () => {
    const ft = e02RepairFixture.functional_testing;

    // Run 1 Fails
    assert.equal(ft.run_1_failed.outcome, 'FAILED');
    assert.equal(ft.run_1_failed.non_conformance_report.ncr_id, 'NCR-2026-RPR-014');
    assert.equal(ft.run_1_failed.non_conformance_report.disposition, 'REWORK');

    // Rework Order
    assert.equal(ft.rework_order.id, 'RWK-2026-055-01');
    assert.equal(ft.rework_order.status, 'REWORK_COMPLETED');
    assert.equal(ft.rework_order.rework_material.chargeable_to_customer, false);

    // Run 2 Passes
    assert.equal(ft.run_2_passed.outcome, 'PASSED');
    assert.equal(ft.run_2_passed.observed_pressure_drop_bar, '0.0');
  });

  await t.test('Final QC release signs off on restored asset', () => {
    const qc = e02RepairFixture.final_qc_release;
    assert.equal(qc.status, 'RELEASED_FOR_RETURN');
    assert.equal(qc.serial_no, '793D-SUSP-B2199');
  });

  await t.test('Return shipment uses CUSTOMER_ASSET_RETURN mode and POD is confirmed', () => {
    const shp = e02RepairFixture.return_shipment;
    assert.equal(shp.shipment_mode, 'CUSTOMER_ASSET_RETURN');
    assert.equal(shp.status, 'DELIVERED');
    assert.equal(shp.proof_of_delivery.status, 'CONFIRMED');
  });

  await t.test('Deposit application is deducted from final invoice and balance settled', () => {
    const inv = e02RepairFixture.final_invoice;
    assert.equal(inv.totals.gross_amount, '9990.00');
    assert.equal(inv.totals.deposit_applied, '3000.00');
    assert.equal(inv.totals.cash_paid, '6990.00');
    assert.equal(inv.totals.balance_due, '0.00');
    assert.equal(inv.status, 'PAID');
  });

  await t.test('Warranty record links serial, repair work order, and invoice', () => {
    const war = e02RepairFixture.warranty;
    assert.equal(war.status, 'ACTIVE_WARRANTY');
    assert.equal(war.serial_no, '793D-SUSP-B2199');
    assert.equal(war.repair_work_order_id, 'WO-2026-RPR-0055');
    assert.equal(war.invoice_id, 'INV-2026-RPR-01');
    assert.equal(war.coverage_term_months, 12);
  });

  await t.test('Rejection Variant: Quote rejected -> Return Unrepaired with diagnostic fee', () => {
    const rej = e02RepairFixture.rejection_variant;
    assert.equal(rej.customer_rejection.status, 'REJECTED');
    assert.equal(rej.work_order_action.status, 'CANCELLED');

    // Diagnostic fee invoice
    assert.equal(rej.diagnostic_fee_invoice.totals.net_amount, '1200.00');
    assert.equal(rej.diagnostic_fee_invoice.totals.tax_amount, '132.00');
    assert.equal(rej.diagnostic_fee_invoice.totals.gross_amount, '1332.00');
    assert.equal(rej.diagnostic_fee_invoice.status, 'PAID');

    // Return-unrepaired shipment
    assert.equal(rej.return_unrepaired_shipment.shipment_mode, 'RETURN_UNREPAIRED');
    assert.equal(rej.return_unrepaired_shipment.proof_of_delivery.status, 'CONFIRMED');
    assert.equal(rej.return_unrepaired_shipment.final_custody_state, 'RETURNED_UNREPAIRED_TO_CUSTOMER');
  });

  await t.test('Validation Engine passes E02 with zero errors', () => {
    const res = validation.validateE02Balance(e02RepairFixture);
    assert.equal(res.valid, true, `Validation errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });
});
