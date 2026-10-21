/**
 * Negative Acceptance Scenario E06: Duplicate Idempotency Key Handling
 * Verifies that:
 * 1. An identical request replayed with the same Idempotency-Key returns the cached response
 *    with exactly one business effect (no double issue).
 * 2. A mutated request with the same Idempotency-Key but different payload is rejected with 422/409.
 */

'use strict';

const e06NegativeFixture = {
  scenario_id: 'E06',
  scenario_name: 'Duplicate Idempotency Key Replay and Payload Tamper Prevention',

  idempotency_key: 'idemp-mfg-issue-001',

  initial_request: {
    command: 'ISSUE_MATERIAL_TO_WORK_ORDER',
    idempotency_key: 'idemp-mfg-issue-001',
    payload: {
      work_order_id: 'WO-2026-MFG-001',
      item_code: 'CST-HC-250',
      lot_number: 'LOT-2026-CST-088',
      quantity: '6.0000',
      uom: 'UN',
      warehouse_id: 'WH-RAW-CKR'
    },
    payload_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    expected_response: {
      http_status: 201,
      movement_id: 'MOV-ISS-WO001-A',
      issued_qty: '6.0000',
      created: true
    }
  },

  replay_exact_duplicate: {
    command: 'ISSUE_MATERIAL_TO_WORK_ORDER',
    idempotency_key: 'idemp-mfg-issue-001',
    payload: {
      work_order_id: 'WO-2026-MFG-001',
      item_code: 'CST-HC-250',
      lot_number: 'LOT-2026-CST-088',
      quantity: '6.0000',
      uom: 'UN',
      warehouse_id: 'WH-RAW-CKR'
    },
    payload_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    expected_response: {
      http_status: 200,
      movement_id: 'MOV-ISS-WO001-A',
      issued_qty: '6.0000',
      is_idempotent_replay: true,
      extra_movement_created: false
    }
  },

  tampered_payload_same_key: {
    command: 'ISSUE_MATERIAL_TO_WORK_ORDER',
    idempotency_key: 'idemp-mfg-issue-001',
    payload: {
      work_order_id: 'WO-2026-MFG-001',
      item_code: 'CST-HC-250',
      lot_number: 'LOT-2026-CST-088',
      quantity: '10.0000', // Modified quantity!
      uom: 'UN',
      warehouse_id: 'WH-RAW-CKR'
    },
    payload_sha256: 'f9e8d7c6b5a4039281706f5e4d3c2b1a0f9e8d7c6b5a4039281706f5e4d3c2b1',
    expected_response: {
      http_status: 422,
      error_code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
      error_message: 'Idempotency-Key idemp-mfg-issue-001 has already been used with a different request payload digest.',
      extra_movement_created: false
    }
  }
};

module.exports = { e06NegativeFixture };
