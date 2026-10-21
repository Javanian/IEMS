/**
 * Verification runner for IEMS Domain Test Fixtures (P002).
 * Verifies mathematical balance, quantity allocations, decimal precision,
 * foreign key/lineage integrity, and negative scenarios.
 * Returns exit code 0 on complete pass, or non-zero on error.
 */

'use strict';

const {
  masterData,
  e01ManufacturingFixture,
  e02RepairFixture,
  negativeFixtures,
  validation,
  decimal
} = require('../index');

function runVerification() {
  console.log('===============================================================');
  console.log('IEMS DOMAIN TEST FIXTURES VERIFICATION (P002)');
  console.log('===============================================================');

  let passedChecks = 0;
  let failedChecks = 0;

  function reportCheck(name, valid, errors = []) {
    if (valid) {
      console.log(`[PASS] ${name}`);
      passedChecks++;
    } else {
      console.error(`[FAIL] ${name}`);
      errors.forEach(err => console.error(`       - ${err}`));
      failedChecks++;
    }
  }

  // 1. Decimal Precision Verification
  const e01Precision = validation.validateDecimalPrecision(e01ManufacturingFixture);
  reportCheck('E01 Decimal Precision (4 decimals for qty, 2 decimals for currency)', e01Precision.valid, e01Precision.errors);

  const e02Precision = validation.validateDecimalPrecision(e02RepairFixture);
  reportCheck('E02 Decimal Precision (4 decimals for qty, 2 decimals for currency)', e02Precision.valid, e02Precision.errors);

  // 2. Mathematical Balance & Quantity Allocations
  const e01Balance = validation.validateE01Balance(e01ManufacturingFixture);
  reportCheck('E01 Mathematical Balance and Quantity Allocations (10 units end-to-end)', e01Balance.valid, e01Balance.errors);

  const e02Balance = validation.validateE02Balance(e02RepairFixture);
  reportCheck('E02 Mathematical Balance, Custody, Deposit Application, and Warranty', e02Balance.valid, e02Balance.errors);

  // 3. Entity Lineage and Master Data Integrity
  const lineage = validation.validateEntityLineage(e01ManufacturingFixture, e02RepairFixture, masterData);
  reportCheck('Entity Lineage, Foreign Keys, and Plant Boundaries', lineage.valid, lineage.errors);

  // 4. Negative Scenario Assertions
  const e03 = negativeFixtures.e03NegativeFixture;
  const e03Valid = e03.case_a_superseded_revision.expected_result.error_code === 'QUOTE_REVISION_SUPERSEDED'
    && e03.case_b_expired_quote.expected_result.error_code === 'QUOTE_EXPIRED';
  reportCheck('Negative Scenario E03 (Expired / Superseded Quote Rejection)', e03Valid);

  const e04 = negativeFixtures.e04NegativeFixture;
  const e04Valid = e04.case_a_material_shortage.expected_result.error_code === 'INSUFFICIENT_STOCK_FOR_RELEASE'
    && e04.case_b_expired_calibration.expected_result.error_code === 'EQUIPMENT_CALIBRATION_EXPIRED'
    && e04.case_c_unqualified_operator.expected_result.error_code === 'OPERATOR_QUALIFICATION_EXPIRED';
  reportCheck('Negative Scenario E04 (Material Shortage, Expired Calibration, Unqualified Operator)', e04Valid);

  const e05 = negativeFixtures.e05NegativeFixture;
  const e05Valid = e05.concurrent_requests[1].expected_outcome.error_code === 'STOCK_ALLOCATION_EXHAUSTED'
    && !e05.invariant_guarantees.allow_negative_balance;
  reportCheck('Negative Scenario E05 (Concurrent Stock Allocation & Non-negative Inventory Guard)', e05Valid);

  const e06 = negativeFixtures.e06NegativeFixture;
  const e06Valid = e06.replay_exact_duplicate.expected_response.is_idempotent_replay === true
    && e06.tampered_payload_same_key.expected_response.error_code === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';
  reportCheck('Negative Scenario E06 (Duplicate Idempotency Key: Replay vs Payload Tamper)', e06Valid);

  const e07 = negativeFixtures.e07NegativeFixture;
  const e07Valid = e07.session_a_stale_mutation_attempt.expected_result.error_code === 'OPTIMISTIC_LOCK_LOST_UPDATE'
    && e07.session_a_stale_mutation_attempt.expected_result.http_status === 409;
  reportCheck('Negative Scenario E07 (Lost Update 409 Optimistic Concurrency Conflict)', e07Valid);

  const e08 = negativeFixtures.e08NegativeFixture;
  const e08Valid = e08.unauthorized_actions.every(a => [403, 404].includes(a.expected_result.http_status));
  reportCheck('Negative Scenario E08 (Cross-Plant Boundary Leak Prevention & Scoped Isolation)', e08Valid);

  const e12 = negativeFixtures.e12NegativeFixture;
  const e12Valid = e12.case_a_quantity_over_shipment.expected_result.error_code === 'OVER_SHIPMENT_EXCEEDS_ORDERED_QUANTITY'
    && e12.case_b_duplicate_serial_dispatch.expected_result.error_code === 'SERIAL_ALREADY_DISPATCHED';
  reportCheck('Negative Scenario E12 (Over-Shipment and Duplicate Serial Prevention)', e12Valid);

  const e13 = negativeFixtures.e13NegativeFixture;
  const e13Valid = e13.case_a_cross_mode_double_billing.expected_result.error_code === 'BILLING_CAP_EXCEEDED'
    && e13.case_b_double_deposit_application.expected_result.error_code === 'PREPAYMENT_BALANCE_EXHAUSTED';
  reportCheck('Negative Scenario E13 (Cross-Mode Double Billing Cap and Deposit Re-use Prevention)', e13Valid);

  console.log('---------------------------------------------------------------');
  console.log(`TOTAL VERIFIED CHECKS: ${passedChecks} passed, ${failedChecks} failed.`);
  console.log('===============================================================');

  if (failedChecks > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runVerification();
}

module.exports = { runVerification };
