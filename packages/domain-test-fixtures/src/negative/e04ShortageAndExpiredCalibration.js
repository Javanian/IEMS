/**
 * Negative Acceptance Scenario E04: Material Shortage, Expired Calibration, and Unqualified Operator
 * Verifies that work order release or operation execution is blocked when prerequisites fail.
 */

'use strict';

const e04NegativeFixture = {
  scenario_id: 'E04',
  scenario_name: 'Release and Execution Guards: Material Shortage, Expired Calibration, and Unqualified Operator',

  case_a_material_shortage: {
    name: 'Work order release blocked due to inventory shortage',
    work_order_id: 'WO-2026-BLOCKED-01',
    item_code: 'ASY-SLP-250-HC',
    target_qty: '10.0000',
    uom: 'UN',
    required_components: [
      {
        item_code: 'CST-HC-250',
        required_qty: '10.0000',
        available_stock_qty: '3.0000',
        shortage_qty: '7.0000',
        uom: 'UN'
      }
    ],
    attempted_action: 'RELEASE_WORK_ORDER',
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'INSUFFICIENT_STOCK_FOR_RELEASE',
      error_message: 'Cannot release work order WO-2026-BLOCKED-01: shortage of 7.0000 UN for component CST-HC-250 (required 10.0000, available 3.0000).',
      resulting_status: 'PLANNED'
    }
  },

  case_b_expired_calibration: {
    name: 'Operation start blocked due to expired instrument calibration',
    work_order_id: 'WO-2026-MFG-001',
    operation_no: 40,
    attempted_equipment_id: 'EQP-TW-EXPIRED',
    equipment_code: 'EQP-TW-044',
    equipment_name: 'Snap-on Calibrated Click-Type Torque Wrench 40-200 Nm',
    calibration_status: 'EXPIRED',
    calibration_expired_at: '2026-09-15',
    current_attempt_date: '2026-10-20',
    attempted_action: 'LOG_EXECUTION_SESSION',
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'EQUIPMENT_CALIBRATION_EXPIRED',
      error_message: 'Equipment EQP-TW-044 calibration expired on 2026-09-15 and is not valid for production execution.',
      session_created: false
    }
  },

  case_c_unqualified_operator: {
    name: 'Operation execution blocked due to expired or missing operator qualification',
    work_order_id: 'WO-2026-MFG-001',
    operation_no: 10,
    required_skill_code: 'SKILL-ASME-IX-6G',
    attempted_employee_id: 'EMP-0112',
    operator_name: 'Agus Priyanto',
    operator_qualification: {
      skill_code: 'SKILL-ASME-IX-6G',
      valid_until: '2025-12-31',
      status: 'EXPIRED'
    },
    attempted_action: 'SIGN_OFF_OPERATION',
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'OPERATOR_QUALIFICATION_EXPIRED',
      error_message: 'Operator EMP-0112 does not hold a valid active certification for SKILL-ASME-IX-6G (expired 2025-12-31).',
      signoff_accepted: false
    }
  }
};

module.exports = { e04NegativeFixture };
