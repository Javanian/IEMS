/**
 * Negative Acceptance Scenario E13: Double Billing and Prepayment Re-use Prevention
 * Verifies that:
 * 1. A shared billing entitlement cap enforces that cumulative delivery and milestone
 *    billings cannot exceed the authorized Sales Order line net amount.
 * 2. An advance deposit / prepayment cannot be applied more than once or exceed its balance.
 */

'use strict';

const e13NegativeFixture = {
  scenario_id: 'E13',
  scenario_name: 'Cross-Mode Double Billing and Deposit Re-use Prevention',

  billing_entitlement: {
    entitlement_id: 'ENT-SO-0881-01',
    sales_order_id: 'SO-2026-0881',
    sales_order_line_no: 1,
    authorized_net_cap: '122500.00',
    delivery_billed_net: '73500.00',
    milestone_billed_net: '0.00',
    remaining_billable_net: '49000.00',
    currency: 'USD'
  },

  case_a_cross_mode_double_billing: {
    name: 'Attempt to bill milestone exceeding remaining billing entitlement cap',
    attempted_billing: {
      sales_order_id: 'SO-2026-0881',
      sales_order_line_no: 1,
      billing_type: 'MILESTONE',
      attempted_net_amount: '60000.00',
      currency: 'USD'
    },
    calculation: {
      authorized_cap: '122500.00',
      current_billed_net: '73500.00',
      attempted_net_amount: '60000.00',
      resulting_total: '133500.00',
      excess_amount: '11000.00'
    },
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'BILLING_CAP_EXCEEDED',
      error_message: 'Cannot bill 60000.00 USD. Shared entitlement ENT-SO-0881-01 has only 49000.00 USD remaining billable cap (Authorized: 122500.00, Already Billed: 73500.00).',
      invoice_created: false
    }
  },

  case_b_double_deposit_application: {
    name: 'Attempt to apply prepayment deposit twice after balance is exhausted',
    prepayment: {
      id: 'PRPAY-2026-055',
      customer_party_id: 'PRT-CUST-KPC',
      initial_amount: '3000.00',
      already_applied_amount: '3000.00',
      remaining_balance: '0.00',
      status: 'FULLY_APPLIED'
    },
    attempted_application: {
      prepayment_id: 'PRPAY-2026-055',
      target_invoice_id: 'INV-2026-RPR-02',
      attempted_application_amount: '3000.00'
    },
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'PREPAYMENT_BALANCE_EXHAUSTED',
      error_message: 'Prepayment PRPAY-2026-055 has 0.00 USD remaining balance. Cannot apply 3000.00 USD to invoice INV-2026-RPR-02.',
      application_created: false
    }
  }
};

module.exports = { e13NegativeFixture };
