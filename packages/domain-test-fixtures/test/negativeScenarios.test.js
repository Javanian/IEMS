/**
 * Test Suite: Negative Acceptance Scenarios (E03, E04, E05, E06, E07, E08, E12, E13)
 * Uses Node.js native test runner (node:test, node:assert).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { negativeFixtures } = require('../index');

test('Negative Acceptance Scenarios Suite', async (t) => {
  await t.test('E03 - Expired or Superseded Quote Rejection', () => {
    const e03 = negativeFixtures.e03NegativeFixture;

    // Case A: Superseded revision
    assert.equal(e03.case_a_superseded_revision.expected_result.success, false);
    assert.equal(e03.case_a_superseded_revision.expected_result.http_status, 422);
    assert.equal(e03.case_a_superseded_revision.expected_result.error_code, 'QUOTE_REVISION_SUPERSEDED');
    assert.equal(e03.case_a_superseded_revision.expected_result.mutations_occurred, false);

    // Case B: Expired quote
    assert.equal(e03.case_b_expired_quote.expected_result.success, false);
    assert.equal(e03.case_b_expired_quote.expected_result.http_status, 422);
    assert.equal(e03.case_b_expired_quote.expected_result.error_code, 'QUOTE_EXPIRED');
    assert.equal(e03.case_b_expired_quote.expected_result.mutations_occurred, false);
  });

  await t.test('E04 - Material Shortage, Expired Calibration, and Unqualified Operator', () => {
    const e04 = negativeFixtures.e04NegativeFixture;

    // Case A: Shortage
    assert.equal(e04.case_a_material_shortage.expected_result.success, false);
    assert.equal(e04.case_a_material_shortage.expected_result.error_code, 'INSUFFICIENT_STOCK_FOR_RELEASE');
    assert.equal(e04.case_a_material_shortage.expected_result.resulting_status, 'PLANNED');

    // Case B: Expired calibration
    assert.equal(e04.case_b_expired_calibration.expected_result.success, false);
    assert.equal(e04.case_b_expired_calibration.expected_result.error_code, 'EQUIPMENT_CALIBRATION_EXPIRED');
    assert.equal(e04.case_b_expired_calibration.expected_result.session_created, false);

    // Case C: Unqualified operator
    assert.equal(e04.case_c_unqualified_operator.expected_result.success, false);
    assert.equal(e04.case_c_unqualified_operator.expected_result.error_code, 'OPERATOR_QUALIFICATION_EXPIRED');
    assert.equal(e04.case_c_unqualified_operator.expected_result.signoff_accepted, false);
  });

  await t.test('E05 - Concurrent Stock Allocation (No Negative Stock Balance)', () => {
    const e05 = negativeFixtures.e05NegativeFixture;
    const reqA = e05.concurrent_requests[0];
    const reqB = e05.concurrent_requests[1];

    assert.equal(reqA.expected_outcome.success, true);
    assert.equal(reqA.expected_outcome.resulting_stock_available, '0.0000');

    assert.equal(reqB.expected_outcome.success, false);
    assert.equal(reqB.expected_outcome.http_status, 409);
    assert.equal(reqB.expected_outcome.error_code, 'STOCK_ALLOCATION_EXHAUSTED');
    assert.equal(reqB.expected_outcome.reserved_qty, '0.0000');

    assert.equal(e05.invariant_guarantees.allow_negative_balance, false);
  });

  await t.test('E06 - Duplicate Idempotency Key Handling', () => {
    const e06 = negativeFixtures.e06NegativeFixture;

    // Initial call
    assert.equal(e06.initial_request.expected_response.http_status, 201);
    assert.equal(e06.initial_request.expected_response.created, true);

    // Exact replay returns cached result without creating second movement
    assert.equal(e06.replay_exact_duplicate.expected_response.http_status, 200);
    assert.equal(e06.replay_exact_duplicate.expected_response.is_idempotent_replay, true);
    assert.equal(e06.replay_exact_duplicate.expected_response.extra_movement_created, false);

    // Tampered payload with same key is rejected
    assert.equal(e06.tampered_payload_same_key.expected_response.http_status, 422);
    assert.equal(e06.tampered_payload_same_key.expected_response.error_code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    assert.equal(e06.tampered_payload_same_key.expected_response.extra_movement_created, false);
  });

  await t.test('E07 - Lost Update 409 Conflict Prevention', () => {
    const e07 = negativeFixtures.e07NegativeFixture;

    // Committed mutation moves version to 4
    assert.equal(e07.session_b_mutation_committed.resulting_state.version, 4);

    // Stale update passing version 3 fails with 409 Conflict
    assert.equal(e07.session_a_stale_mutation_attempt.expected_result.success, false);
    assert.equal(e07.session_a_stale_mutation_attempt.expected_result.http_status, 409);
    assert.equal(e07.session_a_stale_mutation_attempt.expected_result.error_code, 'OPTIMISTIC_LOCK_LOST_UPDATE');
    assert.equal(e07.session_a_stale_mutation_attempt.expected_result.overwrite_prevented, true);
  });

  await t.test('E08 - Cross-Plant Boundary Leak Prevention', () => {
    const e08 = negativeFixtures.e08NegativeFixture;

    // User in CKR trying to read BPN work order
    const readAction = e08.unauthorized_actions.find(a => a.action === 'READ_WORK_ORDER');
    assert.equal(readAction.expected_result.http_status, 404);
    assert.equal(readAction.expected_result.error_code, 'RESOURCE_NOT_FOUND_OR_FORBIDDEN');
    assert.equal(readAction.expected_result.leaked_metadata, null);

    // User trying to mutate BPN repair case
    const mutateAction = e08.unauthorized_actions.find(a => a.action === 'MUTATE_REPAIR_CASE');
    assert.equal(mutateAction.expected_result.http_status, 403);
    assert.equal(mutateAction.expected_result.error_code, 'CROSS_PLANT_ACCESS_DENIED');
    assert.equal(mutateAction.expected_result.mutation_applied, false);
  });

  await t.test('E12 - Over-Shipment and Duplicate Serial Prevention', () => {
    const e12 = negativeFixtures.e12NegativeFixture;

    // Over-shipment qty
    assert.equal(e12.case_a_quantity_over_shipment.expected_result.success, false);
    assert.equal(e12.case_a_quantity_over_shipment.expected_result.http_status, 422);
    assert.equal(e12.case_a_quantity_over_shipment.expected_result.error_code, 'OVER_SHIPMENT_EXCEEDS_ORDERED_QUANTITY');
    assert.equal(e12.case_a_quantity_over_shipment.expected_result.shipment_created, false);

    // Duplicate serial
    assert.equal(e12.case_b_duplicate_serial_dispatch.expected_result.success, false);
    assert.equal(e12.case_b_duplicate_serial_dispatch.expected_result.http_status, 409);
    assert.equal(e12.case_b_duplicate_serial_dispatch.expected_result.error_code, 'SERIAL_ALREADY_DISPATCHED');
    assert.equal(e12.case_b_duplicate_serial_dispatch.expected_result.duplicate_prevented, true);
  });

  await t.test('E13 - Cross-Mode Double Billing and Deposit Re-use Prevention', () => {
    const e13 = negativeFixtures.e13NegativeFixture;

    // Cross-mode billing cap exceeded
    assert.equal(e13.case_a_cross_mode_double_billing.expected_result.success, false);
    assert.equal(e13.case_a_cross_mode_double_billing.expected_result.http_status, 422);
    assert.equal(e13.case_a_cross_mode_double_billing.expected_result.error_code, 'BILLING_CAP_EXCEEDED');
    assert.equal(e13.case_a_cross_mode_double_billing.expected_result.invoice_created, false);

    // Prepayment deposit double application
    assert.equal(e13.case_b_double_deposit_application.expected_result.success, false);
    assert.equal(e13.case_b_double_deposit_application.expected_result.http_status, 422);
    assert.equal(e13.case_b_double_deposit_application.expected_result.error_code, 'PREPAYMENT_BALANCE_EXHAUSTED');
    assert.equal(e13.case_b_double_deposit_application.expected_result.application_created, false);
  });
});
