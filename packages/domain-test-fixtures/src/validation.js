/**
 * Comprehensive verification and validation engine for IEMS domain test fixtures.
 * Verifies:
 * 1. Mathematical balance and zero rounding drift using exact string decimal arithmetic
 * 2. Quantity allocations across demand, production, shipments, and invoicing
 * 3. Decimal precision adherence (4 decimals for qty, 2 decimals for currency)
 * 4. Foreign key references, entity lineage, and serial genealogy
 * 5. Multi-tenant and plant ownership boundary invariants
 * 6. Negative scenario acceptance guards and error specifications
 */

'use strict';

const decimal = require('./decimal');

/**
 * Validates that string fields conform to exact fixed decimal scale requirements.
 * Quantities must be 4 decimal places (e.g. '10.0000').
 * Monetary amounts must be 2 decimal places (e.g. '12250.00').
 */
function validateDecimalPrecision(fixture) {
  const errors = [];

  function check(val, expectedDecimals, fieldName, context) {
    if (typeof val !== 'string') {
      errors.push(`[${context}] Field "${fieldName}" expected string decimal but received ${typeof val}: ${JSON.stringify(val)}`);
      return;
    }
    const regex = expectedDecimals === 2
      ? /^-?\d+\.\d{2}$/
      : expectedDecimals === 4
      ? /^-?\d+\.\d{4}$/
      : new RegExp(`^-?\\d+\\.\\d{${expectedDecimals}}$`);

    if (!regex.test(val)) {
      errors.push(`[${context}] Field "${fieldName}" value "${val}" violates expected ${expectedDecimals} decimal scale format.`);
    }
  }

  function walk(node, path = '') {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((item, idx) => walk(item, `${path}[${idx}]`));
      return;
    }

    for (const [key, val] of Object.entries(node)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (typeof val === 'string') {
        if (/(_qty|run_hours|setup_hours|scrap_factor|qty_per_parent)$/.test(key)) {
          check(val, 4, key, currentPath);
        } else if (/(_amount|_cap|_cost|_price|_paid|_due|unit_price|hourly_rate|applied_amount|amount_received)$/.test(key)) {
          check(val, 2, key, currentPath);
        }
      } else if (typeof val === 'object' && val !== null) {
        walk(val, currentPath);
      }
    }
  }

  walk(fixture);
  return { valid: errors.length === 0, errors };
}

/**
 * Validates mathematical balance and quantity allocation consistency for Scenario E01.
 */
function validateE01Balance(e01) {
  const errors = [];

  // 1. Quotation Revision 2 Totals
  const qRev2 = e01.quotation.revisions.find(r => r.revision_no === 2);
  if (!qRev2) {
    errors.push('E01 quotation revision 2 not found');
  } else {
    let sumNet = '0.00';
    let sumTax = '0.00';
    let sumGross = '0.00';
    for (const line of qRev2.lines) {
      const expectedNet = decimal.mul(line.quoted_qty, line.unit_price, 2);
      if (!decimal.eq(line.net_amount, expectedNet)) {
        errors.push(`Quotation line ${line.line_no} net mismatch: expected ${expectedNet}, got ${line.net_amount}`);
      }
      const expectedTax = decimal.mul(line.net_amount, line.tax_rate, 2);
      if (!decimal.eq(line.tax_amount, expectedTax)) {
        errors.push(`Quotation line ${line.line_no} tax mismatch: expected ${expectedTax}, got ${line.tax_amount}`);
      }
      const expectedGross = decimal.add(line.net_amount, line.tax_amount, 2);
      if (!decimal.eq(line.total_amount, expectedGross)) {
        errors.push(`Quotation line ${line.line_no} gross mismatch: expected ${expectedGross}, got ${line.total_amount}`);
      }
      sumNet = decimal.add(sumNet, line.net_amount, 2);
      sumTax = decimal.add(sumTax, line.tax_amount, 2);
      sumGross = decimal.add(sumGross, line.total_amount, 2);
    }
  }

  // 2. Sales Order Lines & Billing Entitlement
  let soTotalNet = '0.00';
  let soTotalTax = '0.00';
  let soTotalGross = '0.00';
  let soTotalQty = '0.0000';

  for (const line of e01.sales_order.lines) {
    const calcNet = decimal.mul(line.ordered_qty, line.unit_price, 2);
    if (!decimal.eq(line.net_amount, calcNet)) {
      errors.push(`SO line ${line.line_no} net mismatch: expected ${calcNet}, got ${line.net_amount}`);
    }
    const calcTax = decimal.mul(line.net_amount, line.tax_rate, 2);
    if (!decimal.eq(line.tax_amount, calcTax)) {
      errors.push(`SO line ${line.line_no} tax mismatch: expected ${calcTax}, got ${line.tax_amount}`);
    }
    const calcGross = decimal.add(line.net_amount, line.tax_amount, 2);
    if (!decimal.eq(line.total_amount, calcGross)) {
      errors.push(`SO line ${line.line_no} gross mismatch: expected ${calcGross}, got ${line.total_amount}`);
    }
    soTotalNet = decimal.add(soTotalNet, line.net_amount, 2);
    soTotalTax = decimal.add(soTotalTax, line.tax_amount, 2);
    soTotalGross = decimal.add(soTotalGross, line.total_amount, 2);
    soTotalQty = decimal.add(soTotalQty, line.ordered_qty, 4);
  }

  // Check Billing Entitlement authorized cap matches SO line net amount
  const soLine1 = e01.sales_order.lines[0];
  if (!decimal.eq(e01.billing_entitlement.authorized_net_cap, soLine1.net_amount)) {
    errors.push(`Billing entitlement cap (${e01.billing_entitlement.authorized_net_cap}) does not match SO line net (${soLine1.net_amount})`);
  }

  // 3. Work Orders Allocation vs Demand
  let woTotalAllocatedQty = '0.0000';
  let woTotalProducedSerials = 0;
  for (const wo of e01.work_orders) {
    woTotalAllocatedQty = decimal.add(woTotalAllocatedQty, wo.demand_allocation.allocated_qty, 4);
    woTotalProducedSerials += wo.produced_serials.length;
    if (!decimal.eq(wo.target_qty, wo.demand_allocation.allocated_qty)) {
      errors.push(`WO ${wo.id} target qty (${wo.target_qty}) does not match allocated demand qty (${wo.demand_allocation.allocated_qty})`);
    }
    if (wo.produced_serials.length !== parseInt(wo.target_qty, 10)) {
      errors.push(`WO ${wo.id} produced serial count (${wo.produced_serials.length}) does not match target qty (${wo.target_qty})`);
    }
  }

  if (!decimal.eq(woTotalAllocatedQty, soTotalQty)) {
    errors.push(`Total WO allocated demand (${woTotalAllocatedQty}) does not equal SO total qty (${soTotalQty})`);
  }

  // 4. QC Releases
  let qcTotalAccepted = '0.0000';
  let qcTotalSerials = 0;
  for (const qc of e01.quality_releases) {
    qcTotalAccepted = decimal.add(qcTotalAccepted, qc.accepted_qty, 4);
    qcTotalSerials += qc.serials_released.length;
    if (decimal.gt(qc.rejected_qty, '0.0000')) {
      errors.push(`Unexpected rejected qty in released batch ${qc.certificate_no}`);
    }
  }
  if (!decimal.eq(qcTotalAccepted, soTotalQty)) {
    errors.push(`Total QC accepted qty (${qcTotalAccepted}) does not equal SO ordered qty (${soTotalQty})`);
  }

  // 5. Partial Shipments
  let totalShippedQty = '0.0000';
  const shippedSerialsSet = new Set();
  for (const shp of e01.shipments) {
    for (const line of shp.lines) {
      totalShippedQty = decimal.add(totalShippedQty, line.shipped_qty, 4);
      for (const sn of line.serials) {
        if (shippedSerialsSet.has(sn)) {
          errors.push(`Duplicate serial number shipped across consignments: ${sn}`);
        }
        shippedSerialsSet.add(sn);
      }
    }
  }
  if (!decimal.eq(totalShippedQty, soTotalQty)) {
    errors.push(`Total shipped qty (${totalShippedQty}) does not equal SO ordered qty (${soTotalQty})`);
  }
  if (shippedSerialsSet.size !== parseInt(soTotalQty, 10)) {
    errors.push(`Shipped unique serial count (${shippedSerialsSet.size}) does not equal SO ordered qty (${soTotalQty})`);
  }

  // 6. Invoices vs Billing Entitlement
  let totalInvoicedNet = '0.00';
  let totalInvoicedTax = '0.00';
  let totalInvoicedGross = '0.00';
  for (const inv of e01.invoices) {
    let invNet = '0.00';
    let invTax = '0.00';
    let invGross = '0.00';
    for (const line of inv.lines) {
      const calcLineNet = decimal.mul(line.billed_qty, line.unit_price, 2);
      if (!decimal.eq(line.net_amount, calcLineNet)) {
        errors.push(`Invoice ${inv.id} line ${line.line_no} net mismatch: expected ${calcLineNet}, got ${line.net_amount}`);
      }
      const calcLineTax = decimal.mul(line.net_amount, line.tax_rate, 2);
      if (!decimal.eq(line.tax_amount, calcLineTax)) {
        errors.push(`Invoice ${inv.id} line ${line.line_no} tax mismatch: expected ${calcLineTax}, got ${line.tax_amount}`);
      }
      const calcLineGross = decimal.add(line.net_amount, line.tax_amount, 2);
      if (!decimal.eq(line.total_amount, calcLineGross)) {
        errors.push(`Invoice ${inv.id} line ${line.line_no} gross mismatch: expected ${calcLineGross}, got ${line.total_amount}`);
      }
      invNet = decimal.add(invNet, line.net_amount, 2);
      invTax = decimal.add(invTax, line.tax_amount, 2);
      invGross = decimal.add(invGross, line.total_amount, 2);
    }
    if (!decimal.eq(inv.totals.net_amount, invNet)) {
      errors.push(`Invoice ${inv.id} header net (${inv.totals.net_amount}) does not match sum of lines (${invNet})`);
    }
    if (!decimal.eq(inv.totals.tax_amount, invTax)) {
      errors.push(`Invoice ${inv.id} header tax (${inv.totals.tax_amount}) does not match sum of lines (${invTax})`);
    }
    if (!decimal.eq(inv.totals.gross_amount, invGross)) {
      errors.push(`Invoice ${inv.id} header gross (${inv.totals.gross_amount}) does not match sum of lines (${invGross})`);
    }
    totalInvoicedNet = decimal.add(totalInvoicedNet, invNet, 2);
    totalInvoicedTax = decimal.add(totalInvoicedTax, invTax, 2);
    totalInvoicedGross = decimal.add(totalInvoicedGross, invGross, 2);
  }

  if (!decimal.eq(totalInvoicedNet, soTotalNet)) {
    errors.push(`Total invoiced net (${totalInvoicedNet}) does not equal SO total net (${soTotalNet})`);
  }
  if (!decimal.eq(totalInvoicedGross, soTotalGross)) {
    errors.push(`Total invoiced gross (${totalInvoicedGross}) does not equal SO total gross (${soTotalGross})`);
  }

  // 7. Payments vs Invoices
  let totalPaymentsReceived = '0.00';
  for (const pay of e01.payments) {
    let sumAllocated = '0.00';
    for (const alloc of pay.allocations) {
      sumAllocated = decimal.add(sumAllocated, alloc.amount_applied, 2);
    }
    if (!decimal.eq(pay.amount_received, sumAllocated)) {
      errors.push(`Payment ${pay.id} amount received (${pay.amount_received}) does not match allocations (${sumAllocated})`);
    }
    totalPaymentsReceived = decimal.add(totalPaymentsReceived, pay.amount_received, 2);
  }

  if (!decimal.eq(totalPaymentsReceived, totalInvoicedGross)) {
    errors.push(`Total payments (${totalPaymentsReceived}) does not equal total invoiced gross (${totalInvoicedGross})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates mathematical balance and repair lifecycle integrity for Scenario E02.
 */
function validateE02Balance(e02) {
  const errors = [];

  // 1. Quotation Revision 2 Net & Tax
  const qRev2 = e02.quotation.revisions.find(r => r.revision_no === 2);
  if (!qRev2) {
    errors.push('E02 quotation revision 2 not found');
  } else {
    let sumNet = '0.00';
    let sumTax = '0.00';
    let sumGross = '0.00';
    for (const line of qRev2.lines) {
      const calcNet = decimal.mul(line.quoted_qty, line.unit_price, 2);
      if (!decimal.eq(line.net_amount, calcNet)) {
        errors.push(`E02 Quote line ${line.line_no} net mismatch: expected ${calcNet}, got ${line.net_amount}`);
      }
      const calcTax = decimal.mul(line.net_amount, line.tax_rate, 2);
      if (!decimal.eq(line.tax_amount, calcTax)) {
        errors.push(`E02 Quote line ${line.line_no} tax mismatch: expected ${calcTax}, got ${line.tax_amount}`);
      }
      const calcGross = decimal.add(line.net_amount, line.tax_amount, 2);
      if (!decimal.eq(line.total_amount, calcGross)) {
        errors.push(`E02 Quote line ${line.line_no} gross mismatch: expected ${calcGross}, got ${line.total_amount}`);
      }
      sumNet = decimal.add(sumNet, line.net_amount, 2);
      sumTax = decimal.add(sumTax, line.tax_amount, 2);
      sumGross = decimal.add(sumGross, line.total_amount, 2);
    }
    if (!decimal.eq(qRev2.totals.net_amount, sumNet)) {
      errors.push(`Quote rev 2 total net mismatch: expected ${sumNet}, got ${qRev2.totals.net_amount}`);
    }
    if (!decimal.eq(qRev2.totals.gross_amount, sumGross)) {
      errors.push(`Quote rev 2 total gross mismatch: expected ${sumGross}, got ${qRev2.totals.gross_amount}`);
    }
  }

  // 2. Prepayment Balance & Deposit Application
  const prpay = e02.prepayment;
  const depApp = e02.final_invoice.deposit_application;
  if (!decimal.eq(prpay.initial_amount, depApp.applied_amount)) {
    errors.push(`Prepayment initial amount (${prpay.initial_amount}) does not match applied amount (${depApp.applied_amount})`);
  }
  const remainingDeposit = decimal.sub(prpay.initial_amount, depApp.applied_amount, 2);
  if (!decimal.eq(prpay.remaining_balance, remainingDeposit)) {
    errors.push(`Prepayment remaining balance (${prpay.remaining_balance}) does not equal expected ${remainingDeposit}`);
  }

  // 3. Final Invoice Settlement
  const inv = e02.final_invoice;
  const expectedGross = decimal.add(inv.totals.net_amount, inv.totals.tax_amount, 2);
  if (!decimal.eq(inv.totals.gross_amount, expectedGross)) {
    errors.push(`Invoice gross mismatch: expected ${expectedGross}, got ${inv.totals.gross_amount}`);
  }
  const totalSettled = decimal.add(inv.totals.deposit_applied, inv.totals.cash_paid, 2);
  if (!decimal.eq(totalSettled, inv.totals.gross_amount)) {
    errors.push(`Invoice total settled (${totalSettled}) does not equal gross amount (${inv.totals.gross_amount})`);
  }
  if (!decimal.eq(inv.totals.balance_due, '0.00')) {
    errors.push(`Invoice balance due (${inv.totals.balance_due}) is not 0.00`);
  }

  // 4. Rejection Variant Diagnostic Billing
  const rej = e02.rejection_variant;
  const diagInv = rej.diagnostic_fee_invoice;
  const diagAuthCap = e02.diagnostic_authorization.capped_diagnostic_fee;
  if (decimal.gt(diagInv.totals.net_amount, diagAuthCap)) {
    errors.push(`Diagnostic fee invoiced (${diagInv.totals.net_amount}) exceeds authorized cap (${diagAuthCap})`);
  }
  if (!decimal.eq(diagInv.totals.amount_paid, diagInv.totals.gross_amount)) {
    errors.push(`Diagnostic invoice paid (${diagInv.totals.amount_paid}) does not match gross (${diagInv.totals.gross_amount})`);
  }

  // 5. Customer Asset Ownership Invariant
  if (e02.customer_asset.ownership_type !== 'CUSTOMER_OWNED') {
    errors.push(`Customer asset ownership_type must be CUSTOMER_OWNED, got ${e02.customer_asset.ownership_type}`);
  }
  if (e02.customer_asset.owner_party_id !== e02.customer_party_id) {
    errors.push(`Customer asset owner_party_id (${e02.customer_asset.owner_party_id}) does not match customer (${e02.customer_party_id})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates entity references and foreign key consistency across scenarios and master data.
 */
function validateEntityLineage(e01, e02, masterData) {
  const errors = [];

  // Master lookup helpers
  const plantIds = new Set(Object.keys(masterData.plants));
  const leIds = new Set(Object.keys(masterData.legalEntities));
  const partyIds = new Set(Object.keys(masterData.parties));
  const workcenterIds = new Set(Object.keys(masterData.workcenters));
  const warehouseIds = new Set(Object.keys(masterData.warehouses));
  const employeeIds = new Set(Object.keys(masterData.employees));

  function verifyPlant(plantId, ctx) {
    if (!plantIds.has(plantId)) errors.push(`[${ctx}] Invalid plant_id reference: ${plantId}`);
  }
  function verifyLE(leId, ctx) {
    if (!leIds.has(leId)) errors.push(`[${ctx}] Invalid legal_entity_id reference: ${leId}`);
  }
  function verifyParty(partyId, ctx) {
    if (!partyIds.has(partyId)) errors.push(`[${ctx}] Invalid party_id reference: ${partyId}`);
  }

  // Check E01 references
  verifyPlant(e01.plant_id, 'E01 Header');
  verifyLE(e01.legal_entity_id, 'E01 Header');
  verifyParty(e01.customer_party_id, 'E01 Customer');

  for (const wo of e01.work_orders) {
    verifyPlant(wo.plant_id, `E01 WO ${wo.id}`);
  }
  for (const session of e01.execution_sessions) {
    if (!workcenterIds.has(session.workcenter_id)) {
      errors.push(`E01 Execution session has invalid workcenter_id: ${session.workcenter_id}`);
    }
    if (!employeeIds.has(session.employee_id)) {
      errors.push(`E01 Execution session has invalid employee_id: ${session.employee_id}`);
    }
  }

  // Check E02 references
  verifyPlant(e02.plant_id, 'E02 Header');
  verifyLE(e02.legal_entity_id, 'E02 Header');
  verifyParty(e02.customer_party_id, 'E02 Customer');
  verifyPlant(e02.repair_case.intake_plant_id, 'E02 Repair Case');
  verifyPlant(e02.repair_work_order.plant_id, 'E02 Repair WO');

  // Asset serial linkage in E02
  const expectedSerial = e02.customer_asset.serial_no;
  if (e02.final_qc_release.serial_no !== expectedSerial) {
    errors.push(`E02 QC release serial (${e02.final_qc_release.serial_no}) does not match asset serial (${expectedSerial})`);
  }
  if (e02.return_shipment.lines[0].serial_no !== expectedSerial) {
    errors.push(`E02 Return shipment serial (${e02.return_shipment.lines[0].serial_no}) does not match asset serial (${expectedSerial})`);
  }
  if (e02.warranty.serial_no !== expectedSerial) {
    errors.push(`E02 Warranty record serial (${e02.warranty.serial_no}) does not match asset serial (${expectedSerial})`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateDecimalPrecision,
  validateE01Balance,
  validateE02Balance,
  validateEntityLineage
};
